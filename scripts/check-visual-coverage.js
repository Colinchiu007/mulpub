'use strict'
/**
 * scripts/check-visual-coverage.js —— 「注册表 = 判定域」的对账门禁（缺失必须带理由登记，清单只能缩小）
 *
 * 一句话：现在 CI 的绿色只覆盖 pixelTests 那 20 个视图；`all-views`（37）与
 * `supplementary-views`（19）两套**只采集不比对**，于是注册一个新视图却不配基线是免费的。
 * 本门禁把这件事变成一个必须显式付代价的动作。
 *
 * 实测出处（origin/main b96276b1f，2026-10-11）：
 *   - `apps/desktop/tests/visual-testing/views/all-views.visual.test.js:116` 只有
 *     `console.log('视觉测试: ' + test.name)`，全文没有比对分支；workflow 那一步的注释
 *     自陈 "Running views suites (**to produce the authoritative render for Gate 7b**)"。
 *   - 比对只发生在 `scripts/run-pixel-tests.js` 的 `pixelTests`（20 条，浅+暗基线齐全）。
 *   - `scripts/check-baseline-freshness.js:65` 的迭代域是 `readdirSync(基线目录)`
 *     ⇒ 只看**存在的**基线，对缺失结构性失明。
 *   - CI 现场（run 38129158500）：`[GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0`，
 *     37 条「视觉测试: <name>」之后没有任何结果行 —— 绿是真的，测了东西也是假的。
 *   - 另纠正两处不实注释（同文件 :49 / :92）：`ERR_VISUAL_BASELINE_MISSING` 只在
 *     `test-runner.js:563` 由 **pixel 路径**触达，views 套件根本不会报它。
 *
 * 三条不让自己变成装饰性门禁的纪律：
 *   1) **扫描域非空**是判据的一部分：任一张注册表解析成 0 条 ⇒ 直接抛错，不报"没有缺口"。
 *      数组边界按**跳过字符串字面量的括号配对**判定 —— 按第一个 `]` 截会被内联的
 *      `waitFor: '[data-testid^="platform-"]'` 咬断（实测把 19 读成 3），
 *      按"行首 `]`"截会被 `routeView(..., [ {...} ])` 的内层闭合咬断（实测把 37 读成 6、19 读成 1）。
 *      两种退化都是**静默**的，所以另有第 4 条兜住"取到的 id 比元素少"。
 *   2) 登记表 `scripts/visual-coverage-debt.json` **只能缩小**：已补上基线的视图若还留在表里 ⇒ 报陈旧红。
 *   3) 每条登记必须有 `reason`；无理由的登记等于绕过，不是留痕。
 *   4) **顶层元素数必须等于取到的 id 数**：两种取 id 的写法（`routeView('x', …)` 与
 *      `{ name: 'x' }`）是按"这张表用的是哪种"来选的，不是取并集 —— 取并会把断言用的
 *      中文标签（`name: '页面主标题'`，实测 all 表里有 4 个）当成视图混进判定域。
 *      因此若有人往 routeView 表里加一个对象条目，id 数会静默少 1；元素计数把它变成出声的红。
 *
 * 退出码：0 自洽 / 1 不自洽（有未登记缺口、陈旧登记、无主基线或登记缺 reason）/ 2 判定域失联（读盘或解析失败）。
 *
 * 用法：node scripts/check-visual-coverage.js [--root=<repoRoot>] [--json]
 */
const fs = require('node:fs')
const path = require('node:path')

const THEMES = ['light', 'dark']
const BASELINE_DIR = 'apps/desktop/tests/visual-testing/base-screenshots'
const SOURCES = {
  all: { file: 'apps/desktop/tests/visual-testing/views/all-views.visual.test.js', array: 'viewTests', kind: 'routeView' },
  supp: { file: 'apps/desktop/tests/visual-testing/views/supplementary-views.visual.test.js', array: 'supplementaryViewTests', kind: 'name' },
  pixel: { file: 'apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js', array: 'pixelTests', kind: 'name' },
}
const DEBT_FILE = 'scripts/visual-coverage-debt.json'

/**
 * 从一份套件源码里取某个数组的视图名。
 *
 * 数组边界必须**跳过字符串字面量做括号配对**，因为两种截断都真实存在：
 *   - 内联 `]`：`waitFor: '[data-testid^="platform-"]'`（按第一个 `]` 截会把 19 个读成 3 个）
 *   - 嵌套数组：`routeView('publish-history', '/publish/history', [ {...}, {...} ])`
 *     的内层 `],` 就顶在行首（按"行首 ]"截会把 37 个读成 6 个 —— 本仓实测，被规模下界当场逮住）
 * 两种都是**静默**退化：不配对就抛错，绝不返回一个短了的数组让人以为"没有缺口"。
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
 * 只有深度回到 1 时遇到的逗号才是元素分隔符。尾随逗号不产生元素（三份真实注册表都带尾逗号）。
 * 用途见文件头纪律 4)：它是"取到的 id 是否比元素少"的唯一探针。
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

function parseRegistry (text, arrayName) {
  const body = sliceArray(text, arrayName)
  const ids = []
  for (const m of body.matchAll(/routeView\(\s*'([^']+)'/g)) if (!ids.includes(m[1])) ids.push(m[1])
  if (ids.length === 0) for (const m of body.matchAll(/\bname:\s*'([^']+)'/g)) if (!ids.includes(m[1])) ids.push(m[1])
  const elements = countTopLevelElements(body)
  // 两种写法混用 / 新增第三种条目形状 ⇒ id 数静默少算，这里把它变成出声的红
  if (elements !== ids.length) {
    throw new Error('注册表 ' + arrayName + ' 取到 ' + ids.length + ' 个 id，但数组里有 ' + elements
      + ' 个顶层元素 —— 条目形状混用或新增了第三种写法，判定域正在静默缩小。'
      + '正解：给该形状补一条取 id 的规则（并在 scripts/check-visual-coverage.test.js 留下对应夹具），不得放宽本判据。')
  }
  return ids
}

function collectRegistries ({ allText, suppText, pixelText }) {
  const got = {
    all: parseRegistry(allText, SOURCES.all.array),
    supp: parseRegistry(suppText, SOURCES.supp.array),
    pixel: parseRegistry(pixelText, SOURCES.pixel.array),
  }
  for (const [k, ids] of Object.entries(got)) {
    // 空数组既可能是"真的没有视图"也可能是解析退化；两者都必须出声，不得读成"没有缺口"
    if (ids.length === 0) throw new Error('注册表 ' + SOURCES[k].array + ' 解析为空（' + SOURCES[k].file + '）—— 判据不得在空域上下"通过"结论')
  }
  return got
}

/** 判定域 = 三表并集的视图 × 闭合的两档主题；每条记录带它出现在哪些注册表里。 */
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
 * @param {{domain: object[], baselines: string[], exceptions: {gaps: object, orphans: object}}} input
 *        baselines 是**去掉 .png 的文件名**集合（浅=视图名，暗=视图名-dark）。
 */
function evaluate ({ domain, baselines, exceptions }) {
  const problems = []
  const have = new Set(baselines)
  const gaps = (exceptions && exceptions.gaps) || {}
  const orphanReg = (exceptions && exceptions.orphans) || {}

  if (domain.length === 0) {
    return { ok: false, problems: ['判定域为空：注册表解析退化或目录读空，"没有缺口"这种结论不成立'], missing: [], unregistered: [], stale: [], orphans: [] }
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
    if (!Object.prototype.hasOwnProperty.call(orphanReg, o)) problems.push('无主基线 ' + o + '.png：任何注册表都不含它 —— 要么删除，要么在 ' + DEBT_FILE + ' 的 orphans 里写 reason')
    else if (!String(orphanReg[o] && orphanReg[o].reason || '').trim()) problems.push('无主基线登记项 ' + o + ' 缺 reason')
  }

  // 清单只能缩小：登记了但缺口已不存在（补上了/文件被删）⇒ 陈旧
  const stale = []
  for (const key of Object.keys(gaps)) if (!missingKeys.has(key)) stale.push(key)
  for (const key of Object.keys(orphanReg)) if (!orphanSet.has(key)) stale.push(key)
  if (stale.length) problems.push('登记项已无对应缺口，必须删除（清单只能缩小）：' + stale.join(', '))

  return { ok: problems.length === 0, problems, missing, unregistered, stale, orphans }
}

function loadRepo (root) {
  const read = (p) => {
    const abs = path.join(root, p)
    if (!fs.existsSync(abs)) throw new Error('判定域文件缺失: ' + p)
    return fs.readFileSync(abs, 'utf8')
  }
  const registries = collectRegistries({
    allText: read(SOURCES.all.file),
    suppText: read(SOURCES.supp.file),
    pixelText: read(SOURCES.pixel.file),
  })
  const dir = path.join(root, BASELINE_DIR)
  if (!fs.existsSync(dir)) throw new Error('基线目录缺失: ' + BASELINE_DIR)
  const baselines = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort()
  const debtPath = path.join(root, DEBT_FILE)
  let exceptions = { gaps: {}, orphans: {} }
  if (fs.existsSync(debtPath)) {
    const j = JSON.parse(fs.readFileSync(debtPath, 'utf8'))
    exceptions = { gaps: j.gaps || {}, orphans: j.orphans || {} }
  }
  return { registries, domain: buildDomain(registries), baselines, exceptions }
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
  console.log('[visual-coverage] 注册视图 ' + views + '（all ' + repo.registries.all.length + ' / supp ' + repo.registries.supp.length + ' / pixel ' + repo.registries.pixel.length + '）'
    + '| 判定域 ' + repo.domain.length + ' 条（视图×2档）| 基线 ' + repo.baselines.length + ' 张'
    + '| 缺 ' + r.missing.length + '（已登记 ' + (r.missing.length - r.unregistered.length) + '）| 无主基线 ' + r.orphans.length)
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ok: r.ok, missing: r.missing.map((m) => m.key), unregistered: r.unregistered, stale: r.stale, orphans: r.orphans, problems: r.problems }))
  }
  if (!r.ok) {
    for (const p of r.problems) console.error('[visual-coverage] ' + p)
    console.error('[visual-coverage] FAIL —— 判定域与基线不自洽（判据见 scripts/check-visual-coverage.js 头部）')
    return 1
  }
  console.log('[visual-coverage] OK —— 每个注册视图的浅/暗基线都在判定域内，或有带理由的登记项')
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { THEMES, SOURCES, BASELINE_DIR, DEBT_FILE, sliceArray, parseRegistry, collectRegistries, buildDomain, evaluate, baselineFileFor, loadRepo, main }
