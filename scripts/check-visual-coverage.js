'use strict'
/**
 * scripts/check-visual-coverage.js —— 「注册表 = 判定域」的对账门禁（缺失必须带理由登记，清单只能缩小）
 *
 * 一句话：CI 的绿色只覆盖 `pixelTests` 那 20 个视图；`all-views`（37）与 `supplementary-views`（19）
 * 两套**只采集不比对**，于是"注册一个新视图却不配基线"是免费的。本门禁把这件事变成显式付代价的动作。
 *
 * 实测出处（origin/main b96276b1f，2026-10-11）：
 *   - `apps/desktop/tests/visual-testing/views/all-views.visual.test.js` 的 `runViewSuite` 调
 *     `runner.aiVisionTest(...)`，全文没有比对分支；CI 那一步的注释自陈
 *     "Running views suites (**to produce the authoritative render for Gate 7b**)"。
 *   - 真比对只发生在 `apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js` 的 `pixelTests`。
 *   - `scripts/check-baseline-freshness.js` 的迭代域是 `readdirSync(基线目录)`
 *     ⇒ 只看**存在的**基线，对"该有却没有"结构性失明。
 *   - `all-views` 原有两处不实注释已在本 PR 纠正：`ERR_VISUAL_BASELINE_MISSING` 只在 `test-runner.js`
 *     的 `pixelRegressionTest` 里抛，走 `aiVisionTest` 的套件**永远不会报它**。
 *
 * ⚠ 判定域**不是**写死的三张表（本会话被这个错抓过一次）：QM-6 前端轴指出仓里还有别的
 *   `const *Tests = [` 声明，实测确认共 8 张。其中 `autonomous-loop.js` 的 `pixelTests`(20)
 *   与 `screenshotViewTests`(14) 同样按视图名消费 `base-screenshots/*.png`，必须进判定域；
 *   不进的直接后果是把 3 张**其实有主**的基线（`analytics-overview` / `login-form` / `settings-general`，
 *   三个名字都在 `autonomous-loop.js#pixelTests` 里）误判成"无主基线"。
 *   所以除 SOURCES 外还有一条**发现式清扫**（纪律 5)）：新出现的注册表要么进 SOURCES、
 *   要么带 reason 登记豁免，否则当场红 —— 门禁的域由"扫到什么"决定，不由"我记得几张"决定。
 *
 * 六条不让自己变成装饰性门禁的纪律：
 *   1) **扫描域非空**：任一注册表解析成 0 条 ⇒ 直接抛错，不报"没有缺口"。
 *   2) 登记表 `scripts/visual-coverage-debt.json` **只能缩小**：已补上基线的视图仍留在表里 ⇒ 陈旧红。
 *   3) 每条登记必须有 `reason`；无理由的登记等于绕过，不是留痕。
 *   4) **顶层元素数必须等于取到的 id 数**。取 id 的两种写法（`routeView('x', …)` 与 `{ name: 'x' }`）
 *      按"这张表用的是哪种"选，不取并集 —— 取并会把断言用的中文标签
 *      （`name: '页面主标题'`，实测 all 表里有 4 个）当成视图混进判定域，凭空造假缺口。
 *      数组边界必须**跳过字符串字面量做括号配对**：按第一个 `]` 截会被内联的
 *      `waitFor: '[data-testid^="platform-"]'` 咬断（实测把 19 读成 3），按"行首 `]`"截会被
 *      `routeView(..., [ {...} ])` 的内层闭合咬断（实测把 37 读成 6、19 读成 1）。
 *      引号形态同样由这条兜住：`autonomous-loop.js` 整份用**双引号**，第一版只认单引号时
 *      它取到 0 个 id 而数组里有 20 个元素 ⇒ 抛错，而不是被读成"这张表没有视图"。
 *   5) **发现式清扫**：扫 `SCAN_ROOT` 下所有 `const <X>Tests = [`，发现集合必须
 *      ⊆（SOURCES ∪ 已登记豁免）。新命中且未豁免 ⇒ 红；豁免项不再被发现 ⇒ 陈旧红；豁免缺 reason ⇒ 红。
 *      这条守的是"门禁自己的域会不会静默缩小"。读不动的目录一律抛错 ——
 *      不完整的遍历判成"没有新注册表"就是假绿（与 worktree 链接扫描 R3 同款坑）。
 *   6) **规模上界棘轮**：`MAX_GAPS` / `MAX_ORPHANS` / `MAX_OUT_OF_DOMAIN` 是登记面的**上界**。
 *      新增一条登记必须同时抬起对应常量 —— 把"一次静默确认"变成"两处可见编辑"，
 *      堵住"同一 PR 里新增视图 + 同步登记 gap ⇒ 机械门禁全程无声"（QM-6 后端轴 CRITICAL）。
 *
 * 退出码：0 自洽 / 1 不自洽（未登记缺口、陈旧登记、无主基线、域外注册表、缺 reason、超上界）/ 2 判定域失联（读盘或解析失败）。
 *
 * 用法：node scripts/check-visual-coverage.js [--root=<repoRoot>] [--json]
 */
const fs = require('node:fs')
const path = require('node:path')

const THEMES = ['light', 'dark']
const BASELINE_DIR = 'apps/desktop/tests/visual-testing/base-screenshots'
/** 发现式清扫的扫描根：所有已知视觉注册表都在这棵树里（含 `scripts/run-pixel-tests.js`）。 */
const SCAN_ROOT = 'apps/desktop/tests/visual-testing'
const SOURCES = {
  all: { file: 'apps/desktop/tests/visual-testing/views/all-views.visual.test.js', array: 'viewTests' },
  supp: { file: 'apps/desktop/tests/visual-testing/views/supplementary-views.visual.test.js', array: 'supplementaryViewTests' },
  pixel: { file: 'apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js', array: 'pixelTests' },
  loopPixel: { file: 'apps/desktop/tests/visual-testing/autonomous-loop.js', array: 'pixelTests' },
  loopViews: { file: 'apps/desktop/tests/visual-testing/autonomous-loop.js', array: 'screenshotViewTests' },
}
const DEBT_FILE = 'scripts/visual-coverage-debt.json'

// 纪律 6)：登记面上界，**只能随缺口被修掉而下调**。抬它必须与新增登记同 PR 并写明理由。
// 取值 = 2026-10-11 扩域后实测：判定域 112 条 / 缺 69 / 无主基线 0 / 域外注册表 3。
const MAX_GAPS = 69
const MAX_ORPHANS = 0
const MAX_OUT_OF_DOMAIN = 3

/**
 * 取某个数组声明的原始体。边界必须**跳过字符串字面量做括号配对**（见纪律 4)）。
 * 不配平一律抛错 —— 猜一个范围就是把"读少了"演成"没有缺口"。
 */
function sliceArray (text, arrayName) {
  const openRe = new RegExp('const\\s+' + arrayName + '\\s*=\\s*\\[')
  const m = openRe.exec(text)
  if (!m) throw new Error('注册表数组 ' + arrayName + ' 找不到 —— 数组被改名或搬家，判定域已失联')
  let i = m.index + m[0].length
  let depth = 1
  let quote = null
  while (i < text.length) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i += 2
      else if (c === quote) quote = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i++; continue }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return text.slice(m.index + m[0].length, i)
    }
    i++
  }
  throw new Error('注册表数组 ' + arrayName + ' 括号不配平（文件被截断或语法坏了），拒绝猜测范围')
}

/**
 * 数数组体里的**顶层元素**个数：跳过字符串字面量与注释，跟踪 `( [ {` 三种括号，
 * 只有深度回到 1 时遇到的逗号才是元素分隔符；尾随逗号不产生元素（真实注册表都带尾逗号）。
 */
function countTopLevelElements (body) {
  const trimmed = body.trim()
  if (trimmed.length === 0) return 0
  let depth = 1
  let commas = 0
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < body.length) {
        if (body[i] === '\\') { i += 2; continue }
        if (body[i] === c) { i++; break }
        i++
      }
      continue
    }
    if (c === '/' && body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') i++; continue }
    if (c === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); i = e === -1 ? body.length : e + 2; continue }
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; i++; continue }
    if (c === ',' && depth === 1) commas++
    i++
  }
  return /,$/.test(trimmed) ? commas : commas + 1
}

// 单引号与双引号都要认：`autonomous-loop.js` 整份用双引号，只认单引号会把 20 条读成 0 条。
const ID_PATTERNS = [
  /routeView\(\s*['"]([^'"]+)['"]/g,
  /\bname:\s*['"]([^'"]+)['"]/g,
]

function parseRegistry (text, arrayName) {
  const body = sliceArray(text, arrayName)
  const elements = countTopLevelElements(body)
  for (const re of ID_PATTERNS) {
    const ids = []
    for (const m of body.matchAll(re)) if (!ids.includes(m[1])) ids.push(m[1])
    if (ids.length === 0) continue
    if (elements !== ids.length) {
      throw new Error('注册表 ' + arrayName + ' 按 ' + re.source + ' 取到 ' + ids.length + ' 个 id，但数组里有 ' + elements
        + ' 个顶层元素 —— 条目形状混用或新增了第三种写法，判定域正在静默缩小。'
        + '正解：给该形状补一条取 id 的规则（并在 scripts/check-visual-coverage.test.js 留下对应夹具），不得放宽本判据。')
    }
    return ids
  }
  // 一条 id 规则都没命中：可能是真空数组，也可能是第四种写法。两者都必须出声。
  throw new Error('注册表 ' + arrayName + ' 里取不到任何 id，但数组里有 ' + elements
    + ' 个顶层元素 —— 空数组或新增了未知条目形状，判据不得在空域上下"通过"结论')
}

/** 按 SOURCES 逐张解析；`read` 由调用方提供（真实仓用 fs，测试用夹具）。 */
function collectRegistries (read) {
  const got = {}
  for (const [k, s] of Object.entries(SOURCES)) got[k] = parseRegistry(read(s.file), s.array)
  return got
}

const sourceKeys = () => Object.values(SOURCES).map((s) => s.file + '#' + s.array)

/**
 * 纪律 5)：发现扫描根里**所有** `const <X>Tests = [` 声明，返回 `<相对路径>#<数组名>` 升序集合。
 */
function discoverRegistries (root, read) {
  const found = []
  const stack = [SCAN_ROOT]
  while (stack.length) {
    const rel = stack.pop()
    let entries
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }) } catch (e) {
      throw new Error('发现式清扫读不动 ' + rel + '：' + e.message + '（不完整的遍历不得判为"没有新注册表"）')
    }
    for (const ent of entries) {
      const childRel = rel + '/' + ent.name
      if (ent.isDirectory()) { stack.push(childRel); continue }
      if (!ent.isFile() || !ent.name.endsWith('.js')) continue
      const text = read(childRel)
      for (const m of text.matchAll(/^const\s+(\w*Tests)\s*=\s*\[/gm)) found.push(childRel + '#' + m[1])
    }
  }
  return found.sort()
}

/** 判定域 = 各注册表视图并集 × 闭合的两档主题；每条记录带它出现在哪些注册表里。 */
function buildDomain (registries) {
  const seen = new Map()
  for (const [suite, ids] of Object.entries(registries)) {
    for (const v of ids) {
      if (!seen.has(v)) seen.set(v, [])
      if (!seen.get(v).includes(suite)) seen.get(v).push(suite)
    }
  }
  const out = []
  for (const [view, suites] of seen) {
    for (const theme of THEMES) out.push({ view, theme, suites, key: view + ':' + theme })
  }
  return out
}

const baselineFileFor = (entry) => (entry.theme === 'light' ? entry.view : entry.view + '-dark')

/**
 * @param {{domain: object[], baselines: string[], exceptions: {gaps: object, orphans: object, outOfDomain: object},
 *          discovered?: string[], ceilings?: {maxGaps: number, maxOrphans: number, maxOutOfDomain: number}}} input
 *        baselines 是**去掉 .png 的文件名**集合（浅=视图名，暗=视图名-dark）。
 *        `discovered` / `ceilings` 省略时分别跳过纪律 5) 与 6)（夹具用）。
 */
function evaluate ({ domain, baselines, exceptions, discovered, ceilings }) {
  const problems = []
  const have = new Set(baselines)
  const gaps = (exceptions && exceptions.gaps) || {}
  const orphanReg = (exceptions && exceptions.orphans) || {}
  const outReg = (exceptions && exceptions.outOfDomain) || {}
  const ceil = ceilings || {}

  if (domain.length === 0) {
    return { ok: false, problems: ['判定域为空：注册表解析退化或目录读空，"没有缺口"这种结论不成立'], missing: [], unregistered: [], stale: [], orphans: [], undiscovered: [] }
  }

  const missing = domain.filter((e) => !have.has(baselineFileFor(e)))
  const missingKeys = new Set(missing.map((e) => e.key))
  const unregistered = missing.filter((e) => !Object.prototype.hasOwnProperty.call(gaps, e.key))
  for (const e of unregistered) {
    problems.push('缺基线且未登记：' + e.key + '（出现在 ' + e.suites.join('+') + ' 注册表；基线文件 ' + baselineFileFor(e) + '.png）'
      + ' —— 要么补 CI 同源基线，要么把它带 reason 写进 ' + DEBT_FILE)
  }
  for (const [key, val] of Object.entries(gaps)) {
    if (!missingKeys.has(key)) continue
    if (!val || typeof val.reason !== 'string' || val.reason.trim() === '') problems.push('登记项 ' + key + ' 缺 reason（无理由的登记是绕过，不是留痕）')
  }

  const viewsInDomain = new Set(domain.map((e) => e.view))
  const orphans = baselines.filter((n) => !viewsInDomain.has(n.replace(/-dark$/, '')))
  const orphanSet = new Set(orphans)
  for (const o of orphans) {
    if (!Object.prototype.hasOwnProperty.call(orphanReg, o)) problems.push('无主基线 ' + o + '.png：任何进域注册表都不含它 —— 要么删除，要么在 ' + DEBT_FILE + ' 的 orphans 里写 reason')
    else if (!String(orphanReg[o] && orphanReg[o].reason || '').trim()) problems.push('无主基线登记项 ' + o + ' 缺 reason')
  }

  const undiscovered = []
  if (Array.isArray(discovered)) {
    const covered = new Set([...sourceKeys(), ...Object.keys(outReg)])
    for (const key of discovered) {
      if (covered.has(key)) continue
      undiscovered.push(key)
      problems.push('域外注册表 ' + key + '：既不在 SOURCES 也没登记豁免 —— 判定域正在静默缩小。'
        + '正解：视图级截图就加进 SOURCES；不是就在 ' + DEBT_FILE + ' 的 outOfDomain 里带 reason 说明它为什么不是视图级基线')
    }
    for (const [key, val] of Object.entries(outReg)) {
      if (!val || typeof val.reason !== 'string' || val.reason.trim() === '') problems.push('域外豁免 ' + key + ' 缺 reason')
    }
  }

  // 清单只能缩小：登记了但对应事实已不存在 ⇒ 陈旧
  const stale = []
  for (const key of Object.keys(gaps)) if (!missingKeys.has(key)) stale.push(key)
  for (const key of Object.keys(orphanReg)) if (!orphanSet.has(key)) stale.push(key)
  if (Array.isArray(discovered)) {
    const found = new Set(discovered)
    for (const key of Object.keys(outReg)) if (!found.has(key)) stale.push(key)
  }
  if (stale.length) problems.push('登记项已无对应缺口，必须删除（清单只能缩小）：' + stale.join(', '))

  if (typeof ceil.maxGaps === 'number' && Object.keys(gaps).length > ceil.maxGaps) {
    problems.push('gaps 登记 ' + Object.keys(gaps).length + ' 条 > MAX_GAPS=' + ceil.maxGaps
      + '：新增登记必须同时抬起 MAX_GAPS 并写明理由（该常量只能随缺口被修掉而下调）')
  }
  if (typeof ceil.maxOrphans === 'number' && Object.keys(orphanReg).length > ceil.maxOrphans) {
    problems.push('orphans 登记 ' + Object.keys(orphanReg).length + ' 条 > MAX_ORPHANS=' + ceil.maxOrphans)
  }
  if (typeof ceil.maxOutOfDomain === 'number' && Object.keys(outReg).length > ceil.maxOutOfDomain) {
    problems.push('outOfDomain 豁免 ' + Object.keys(outReg).length + ' 条 > MAX_OUT_OF_DOMAIN=' + ceil.maxOutOfDomain)
  }

  return { ok: problems.length === 0, problems, missing, unregistered, stale, orphans, undiscovered }
}

function loadRepo (root) {
  const cache = new Map()
  const read = (p) => {
    if (cache.has(p)) return cache.get(p)
    const abs = path.join(root, p)
    if (!fs.existsSync(abs)) throw new Error('判定域文件缺失: ' + p)
    const t = fs.readFileSync(abs, 'utf8')
    cache.set(p, t)
    return t
  }
  const registries = collectRegistries(read)
  const discovered = discoverRegistries(root, read)
  const dir = path.join(root, BASELINE_DIR)
  if (!fs.existsSync(dir)) throw new Error('基线目录缺失: ' + BASELINE_DIR)
  const baselines = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort()
  let exceptions = { gaps: {}, orphans: {}, outOfDomain: {} }
  if (fs.existsSync(path.join(root, DEBT_FILE))) {
    const j = JSON.parse(fs.readFileSync(path.join(root, DEBT_FILE), 'utf8'))
    exceptions = { gaps: j.gaps || {}, orphans: j.orphans || {}, outOfDomain: j.outOfDomain || {} }
  }
  return {
    registries, discovered, domain: buildDomain(registries), baselines, exceptions,
    ceilings: { maxGaps: MAX_GAPS, maxOrphans: MAX_ORPHANS, maxOutOfDomain: MAX_OUT_OF_DOMAIN },
  }
}

function main (argv = []) {
  const rootArg = argv.find((a) => a.startsWith('--root='))
  const root = rootArg ? path.resolve(rootArg.slice(7)) : path.resolve(__dirname, '..')
  let repo
  try {
    repo = loadRepo(root)
  } catch (e) {
    console.error('[visual-coverage] 判定域失联: ' + e.message)
    return 2
  }
  const r = evaluate(repo)
  const views = new Set(repo.domain.map((e) => e.view)).size
  const sizes = Object.entries(repo.registries).map(([k, v]) => k + ' ' + v.length).join(' / ')
  console.log('[visual-coverage] 进域注册表 ' + Object.keys(repo.registries).length + ' 张（' + sizes + '）'
    + '| 发现 ' + repo.discovered.length + ' 张（域外豁免 ' + Object.keys(repo.exceptions.outOfDomain).length + '）'
    + '| 视图并集 ' + views + ' → 判定域 ' + repo.domain.length + ' 条（视图×2档）'
    + '| 基线 ' + repo.baselines.length + ' 张 | 缺 ' + r.missing.length
    + '（已登记 ' + (r.missing.length - r.unregistered.length) + '，上界 ' + MAX_GAPS + '）'
    + '| 无主基线 ' + r.orphans.length)
  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      ok: r.ok, discovered: repo.discovered, registries: repo.registries,
      missing: r.missing.map((m) => m.key), unregistered: r.unregistered, stale: r.stale,
      orphans: r.orphans, undiscovered: r.undiscovered, problems: r.problems, ceilings: repo.ceilings,
    }))
  }
  if (!r.ok) {
    for (const p of r.problems) console.error('[visual-coverage] ' + p)
    console.error('[visual-coverage] FAIL —— 判定域与基线不自洽（判据见 scripts/check-visual-coverage.js 头部）')
    return 1
  }
  console.log('[visual-coverage] OK —— 每个注册视图的浅/暗基线都在判定域内或有带理由的登记项，且发现的每张注册表要么进域、要么带理由豁免')
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = {
  THEMES, SOURCES, BASELINE_DIR, SCAN_ROOT, DEBT_FILE, ID_PATTERNS,
  MAX_GAPS, MAX_ORPHANS, MAX_OUT_OF_DOMAIN,
  sliceArray, countTopLevelElements, parseRegistry, collectRegistries, discoverRegistries, sourceKeys,
  buildDomain, evaluate, baselineFileFor, loadRepo, main,
}
