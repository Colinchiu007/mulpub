/**
 * 快捷采集家族的「时钟确定性」结构锁（2026-10-13，change: fix-quick-collect-clock-rot）
 *
 * 起因：2026-10-13 两条 Desktop shard 加一条 Coverage 同时红在 quick-collect 上（本机按真实时钟
 * 复现得到同样的红，与任何人的改动无关）。根因是**夹具与判据不同源**：夹具写死
 * `const NOW = Date.parse('2026-10-11T04:00:00.000Z')` 与
 * `<pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate>`，而窗口过滤读的是真实墙上时间
 * ⇒ 这套用例每过 `windowHours`（48）小时就自己变红。修法是让被驱动的那条路用夹具的时钟：
 * IPC handler 此前只把 `deps.now` 透给了 `createFeedTrendFetcher`，`createQuickCollectEngine`
 * 那半边漏了（半接线缝隙），所以窗口判据绕过注入时钟去读真实时间。
 * 生产侧**刻意不变**：`phase5-ipc.js` 的 handlerDependencies 不含 `now` 键，两侧同时落
 * `() => Date.now()` 兜底 —— 用户要的"最近 48 小时"本来就该读真实时钟，别把这里"修"成假时钟。
 *
 * 判据按**语义**切，不按字符串出现切：只有"会驱动读时钟的那条路"（构造引擎、构造 feed 抓取器、
 * 导入主进程 IPC 注册面）的文件才必须注入时钟；只把 `now: NOW` 当普通实参传给
 * `normalizeMaterial` / `mergeMaterials` / 提示词渲染这类纯函数的，本来就不读墙上时间，不受本锁约束。
 *
 * 三层覆盖关系（别把它们读成一层）：
 *   ① 文件级判据 —— 兜"整个文件一处注入都没有"（engine.test.js 那种单注入点文件靠它）；
 *   ② 调用点级判据（第 4 条）—— 兜主进程 handler 里**两处**调用点（引擎 + feed 抓取器）；
 *   ③ 已知盲区 —— 同一文件里"部分调用点漏注入"（cn-sources 有 7 处注入）仍看不见；
 *      要按调用点通用地判，需要可靠的括号/字符串配平扫描，本次不提前建结构。
 * 扫描域按**文件名**定义（`quick.?collect` 的测试文件），异名同族的新文件不在看守内 ——
 * 那种情况由行为测试红出症状，结构锁只是纵深防御。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(HERE, '..', '..') // apps/desktop
const DOMAIN_ROOTS = [
  path.join(DESKTOP_ROOT, 'electron'),
  path.join(DESKTOP_ROOT, 'src', 'features', 'collection'),
]
const HANDLER = path.join(DESKTOP_ROOT, 'electron/ipc-handlers/quick-collect.js')

/** 家族成员：文件名含 quick-collect / QuickCollect 且是测试文件 */
const IN_DOMAIN = (name) => /\.test\.js$/.test(name) && /quick.?collect/i.test(name)
/**
 * 读时钟的那条路：构造引擎、构造 feed 抓取器、或导入主进程 IPC 注册面（specifier 以 /quick-collect 结尾）。
 * `(?!@)` 是必需的而不是顺手加的：渲染端 `import('@/api/quick-collect')` 命中同一个尾巴，
 * 但那个模块只是 `invokeWithFallback` 的桥接层（src/api/quick-collect.js 头注自证），
 * 既不构造引擎也不读主进程时钟 —— 把它算成驱动者，就会拿"必须注入时钟"去要求一份无法有意义注入的文件。
 * 同时必须保留 `./quick-collect` 与 `../ipc-handlers/quick-collect` 两种命中，否则同目录导入会漏网。
 */
const DRIVES_CLOCK = /createQuickCollectEngine|createFeedTrendFetcher|import\((['"])(?!@)[^'"]*\/quick-collect\1\)/
/**
 * 绝对时刻夹具。形状必须按"这套家族真实写过哪几种"来枚举，而不是只认最初那一种：
 *   Date.parse('2026-10-11T04:00:00Z')  ← 第 1 版只认这个
 *   Date.UTC(2026, 9, 7, 20, 0, 0)
 *   new Date('2026-10-11…') / ISO 串 '2026-10-10T00:00:00.000Z'
 *   RFC-822 pubDate `Sun, 11 Oct 2026 02:00:00 +0000` ← **原始事故夹具的形状本身**
 * 只认第一种的话，把 `Date.parse` 合理清理成 `Date.UTC` 就静默逃逸，而只含 pubDate 的新驱动文件根本看不见。
 */
const ABS_FIXTURE = /Date\.(?:parse|UTC)\s*\(\s*['"]?20\d|new Date\(\s*['"]20\d|20\d{2}-\d{2}-\d{2}|[A-Z][a-z]{2}\s+20\d{2}\s+\d{2}:\d{2}/
/** 函数形式的时钟注入 —— 只有这一种能被引擎/抓取器消费（`now: NOW` 那种是值，走纯函数参数） */
const CLOCK_PROVIDER = /now:\s*\(\)\s*=>/

/** 纯判据：给一批 {name, src}，返回违规文件名（可喂合成夹具，本锁的反证靠它） */
export function findClockRot (entries) {
  return entries
    .filter((e) => DRIVES_CLOCK.test(e.src) && ABS_FIXTURE.test(e.src) && !CLOCK_PROVIDER.test(e.src))
    .map((e) => e.name)
}

function collectDomain () {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (IN_DOMAIN(entry.name)) out.push(full)
    }
  }
  for (const root of DOMAIN_ROOTS) {
    if (!fs.existsSync(root)) throw new Error('扫描域不存在（结构变了必须同步本锁，不得静默跳过）: ' + root)
    walk(root)
  }
  return out.sort()
}

describe('快捷采集时钟确定性结构锁', () => {
  const files = collectDomain()
  const rel = (f) => path.relative(DESKTOP_ROOT, f).split(path.sep).join('/')
  const entries = files.map((f) => ({ name: rel(f), src: fs.readFileSync(f, 'utf8') }))
  const drivers = entries.filter((e) => DRIVES_CLOCK.test(e.src))

  it('扫描域非空且含"驱动时钟"的那批文件（并点名两个核心驱动者）—— 解析退化成空集合时本锁必须自己变红', () => {
    // 2026-10-13 实测：整域 14 个测试文件，其中驱动时钟那条路的 5 个
    // （含本锁自己；渲染端 `@/api/quick-collect` 那两个**不算**，见 DRIVES_CLOCK 注释）。
    // 下界各留余量：files≥10（实测 14）、drivers≥4（实测 5）。
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(drivers.length).toBeGreaterThanOrEqual(4)
    expect(drivers.map((d) => d.name)).toContain('electron/ipc-handlers/quick-collect.test.js')
    expect(drivers.map((d) => d.name)).toContain('electron/services/quick-collect-engine.test.js')
  })

  it('渲染端桥接层的 import 不得被算成驱动者（否则判据会对"无法有意义注入时钟"的文件要账）', () => {
    const renderer = [{
      name: 'src/features/collection/SyntheticPanel.test.js',
      src: "const d = new Date('2026-10-10T00:00:00.000Z')\nconst api = await import('@/api/quick-collect')\n",
    }]
    expect(DRIVES_CLOCK.test(renderer[0].src)).toBe(false)
    expect(findClockRot(renderer)).toEqual([])
  })

  it('真实域内：夹具写死绝对时刻又驱动读时钟路径的文件，必须已注入时钟', () => {
    expect(findClockRot(entries)).toEqual([])
  })

  it('判据自身必须看得见违规（合成夹具三形，防"恒不成立"的装饰性门禁）', () => {
    const dateParse = {
      name: 'synthetic/rot-a.test.js',
      src: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')\nconst e = createQuickCollectEngine({ llmFn, log })\n",
    }
    // 事故夹具本身的形状：只有 RFC-822 pubDate，没有 Date.parse
    const pubDate = {
      name: 'synthetic/rot-b.test.js',
      src: "const rss = '<item><pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate></item>'\nconst f = createFeedTrendFetcher({ fetchFn, log })\n",
    }
    // 合理清理 Date.parse → Date.UTC 不得静默逃逸
    const dateUtc = {
      name: 'synthetic/rot-c.test.js',
      src: 'const NOW = Date.UTC(2026, 9, 7, 20, 0, 0)\nconst e = createQuickCollectEngine({ llmFn, log })\n',
    }
    const compliant = {
      name: 'synthetic/fine.test.js',
      src: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')\nconst e = createQuickCollectEngine({ llmFn, log, now: () => NOW })\n",
    }
    const notDriver = {
      name: 'synthetic/pure.test.js',
      src: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')\nnormalizeMaterial(item, { windowHours: 48, now: NOW })\n",
    }
    expect(findClockRot([dateParse, pubDate, dateUtc, compliant, notDriver])).toEqual([
      'synthetic/rot-a.test.js',
      'synthetic/rot-b.test.js',
      'synthetic/rot-c.test.js',
    ])
    expect(findClockRot([compliant, notDriver])).toEqual([])
  })

  it('主进程接缝（出事的那一处）：IPC handler 的两处调用点都必须把 deps.now 透下去', () => {
    const src = fs.readFileSync(HANDLER, 'utf8')
    for (const call of ['createQuickCollectEngine(', 'createFeedTrendFetcher(']) {
      const at = src.indexOf(call)
      expect(at, '找不到调用点：' + call).toBeGreaterThan(-1)
      // 窗口取 800 字符而不是刚好够用的 400：实测两处偏移分别是 246 与 53，
      // 400 只留 154 余量，一次无害的参数换行就会假红；取不到 now 仍然判红。
      const window = src.slice(at, at + 800)
      expect(/now:\s*deps\.now/.test(window), '调用点 800 字符内没有 now: deps.now —— 漏了它就会读真实墙上时间：' + call).toBe(true)
    }
  })
})
