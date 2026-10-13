/**
 * 快捷采集家族的「时钟确定性」结构锁（2026-10-13，change: fix-quick-collect-clock-rot）
 *
 * 起因：2026-10-13 两条 Desktop shard 同时红在 quick-collect 上（本机按真实时钟复现得到同样的红，
 * 与任何人的改动无关）。根因是**夹具与判据不同源**：夹具写死 `Date.parse('2026-10-11T04:00:00Z')`
 * 和 `<pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate>`，而窗口过滤读的是真实墙上时间
 * ⇒ 这套用例每过 `windowHours`（48）小时就自己变红。修法是让被驱动的那条路用夹具的时钟：
 * IPC handler 此前只把 `deps.now` 透给了 feed fetcher，`createQuickCollectEngine` 那半边漏了
 * （半接线缝隙），所以窗口判据绕过注入时钟去读真实时间。
 *
 * 判据按**语义**切，不按字符串出现切：只有"会驱动读时钟的那条路"（构造引擎、构造 feed 抓取器、
 * 导入 IPC 注册面）的文件才必须注入时钟；只把 `now: NOW` 当普通实参传给 `normalizeMaterial` /
 * `mergeMaterials` / 提示词渲染这类纯函数的，本来就不读墙上时间，不受本锁约束。
 *
 * 已知边界（不假装覆盖）：文件级判据只要求"驱动者至少提供一个时钟"。同一个文件里
 * **部分**调用点漏注入（其余调用点有）时本锁看不见 —— 所以另有一条按调用点切的主进程接缝锁
 * （下面第 4 条），它守的正是这次真出事的那一处。
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
/** 读时钟的那条路：构造引擎、构造 feed 抓取器、或导入 IPC 注册面（specifier 以 /quick-collect 结尾） */
const DRIVES_CLOCK = /createQuickCollectEngine|createFeedTrendFetcher|import\((['"])[^'"]*\/quick-collect\1\)/
/** 绝对时刻夹具（写死的历史时间点） */
const ABS_FIXTURE = /Date\.parse\('20/
/** 函数形式的时钟注入 —— 只有这一种能被引擎/抓取器消费 */
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

  it('扫描域非空且含"驱动时钟"的那批文件 —— 解析退化成空集合时本锁必须自己变红', () => {
    // 下界取自 2026-10-13 实测：域内 13 个测试文件，其中驱动时钟那条路的有 4 个
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(drivers.length).toBeGreaterThanOrEqual(4)
    expect(drivers.map((d) => d.name)).toContain('electron/ipc-handlers/quick-collect.test.js')
    expect(drivers.map((d) => d.name)).toContain('electron/services/quick-collect-engine.test.js')
  })

  it('真实域内：夹具写死绝对时刻又驱动读时钟路径的文件，必须已注入时钟', () => {
    expect(findClockRot(entries)).toEqual([])
  })

  it('判据自身必须看得见违规（合成夹具，防"恒不成立"的装饰性门禁）', () => {
    const violating = [{
      name: 'synthetic/rot.test.js',
      src: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')\nconst e = createQuickCollectEngine({ llmFn, log })\n",
    }]
    const compliant = [{
      name: 'synthetic/fine.test.js',
      src: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')\nconst e = createQuickCollectEngine({ llmFn, log, now: () => NOW })\n",
    }]
    const notDriver = [{
      name: 'synthetic/pure.test.js',
      src: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')\nnormalizeMaterial(item, { windowHours: 48, now: NOW })\n",
    }]
    expect(findClockRot(violating)).toEqual(['synthetic/rot.test.js'])
    expect(findClockRot(compliant)).toEqual([])
    expect(findClockRot(notDriver)).toEqual([])
  })

  it('主进程接缝（出事的那一处）：IPC handler 必须把 deps.now 同时透给引擎与 feed 抓取器', () => {
    const src = fs.readFileSync(HANDLER, 'utf8')
    for (const call of ['createQuickCollectEngine(', 'createFeedTrendFetcher(']) {
      const at = src.indexOf(call)
      expect(at, '找不到调用点：' + call).toBeGreaterThan(-1)
      const window = src.slice(at, at + 400)
      expect(/now:\s*deps\.now/.test(window), '调用点 400 字符内没有 now: deps.now —— 漏了它就会读真实墙上时间：' + call).toBe(true)
    }
  })
})
