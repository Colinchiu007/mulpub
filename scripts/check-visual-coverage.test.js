'use strict'
/**
 * scripts/check-visual-coverage.test.js —— 「注册表就是判定域」这条对账的回归锁
 *
 * 它要消灭的形态（2026-10-11 实测 origin/main b96276b1f）：
 *   all-views 注册 37 个视图、supplementary 注册 19 个，但两套**只采集不比对**
 *   （`all-views.visual.test.js:116` 只 `console.log('视觉测试: ' + name)`，全文没有比对代码；
 *    workflow 里那一步的注释自陈 "to produce the authoritative render for Gate 7b"）。
 *   真比对的只有 pixelTests 那 20 个；而 check-baseline-freshness.js 的迭代域是
 *   `readdirSync(基线目录)` —— **只看存在的基线**，于是"注册一个视图却不配基线"永久免费。
 *
 * 本文件自己也按这条纪律写：凡是"扫到 0 缺口"的断言，都必须同时断言**扫描域非空**，
 * 否则锁会在解析退化成空集时恒绿（这是本仓「装饰性门禁」的既有落点，也是本会话刚踩过的坑：
 * 我用 indexOf(']') 截数组，结果 19 个注册被读成 3 个）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  THEMES,
  parseRegistry,
  collectRegistries,
  buildDomain,
  evaluate,
} = require('./check-visual-coverage.js')

// --- 夹具：与仓里同形的最小三张注册表 -----------------------------------------

const ALL_TEXT = `
const viewTests = [
  routeView('home-baseline', '/', '.mp-home .welcome'),
  routeView('accounts-list', '/accounts', '.accounts-page'),
  routeView('film-engineering', '/film-engineering', '.film-hub-view .fh-title'),
];
module.exports = { viewTests };
`
// 关键形状一：数组里有**内联右方括号**（真实文件里 waitFor: '[data-testid^="platform-"]' 就是这样）。
// 关键形状二：数组元素里**嵌套数组**（routeView 的多步 workflow 参数）。
// 这两处各截断过一次：前者把 19 个读成 3 个，后者把 37 个读成 6 个、19 个读成 1 个。
// 锁的是"数组边界由括号配对决定，且配对必须跳过字符串字面量"。
const SUPP_TEXT = `
const supplementaryViewTests = [
  { name: 'create-view-default', route: '/create', waitFor: '.cohere-main h1' },
  { name: 'model-provider-add-dialog', route: '/model-providers', trigger: '[data-testid^="add-"]' },
  { name: 'sidebar-platform-list', route: '/dashboard', waitFor: '.sidebar' },
]
`
const NESTED_CLEAN_TEXT = `
const workflowTests = [
  routeView('publish-flow', '/publish', '.pub', [
    { act: 'click', sel: '[data-testid^="acc-"]' },
    { act: 'fill', sel: 'input[name="title"]', value: 'x' },
  ]),
  routeView('deep-clone', '/clone', '.clone', [
    { act: 'click', sel: '.btn[' },
  ]),
]
`
// 同表里第 3 个元素换成对象条目 —— 用于验证 C1b 的元素计数不变量会出声
const NESTED_MIXED_TEXT = `
const workflowTests = [
  routeView('publish-flow', '/publish', '.pub', [
    { act: 'click', sel: '.x' },
  ]),
  routeView('deep-clone', '/clone', '.clone', [
    { act: 'click', sel: '.y' },
  ]),
  { name: 'trailing-object-entry', route: '/t' },
]
`
const PIXEL_TEXT = `
const pixelTests = [
  { name: 'home-baseline', route: '/', waitFor: '.mp-home .mp-home-welcome' },
  { name: 'accounts-list', route: '/accounts', waitFor: '.mp-workspace .accounts-page' },
]
`

function registries (over = {}) {
  return Object.assign({ all: ['home-baseline', 'accounts-list', 'film-engineering'], supp: ['create-view-default', 'model-provider-add-dialog', 'sidebar-platform-list'], pixel: ['home-baseline', 'accounts-list'] }, over)
}
const pngs = (...names) => names
const emptyExceptions = { gaps: [], orphans: [] }

// --- 解析层 -------------------------------------------------------------------

test('C1 数组里有内联 ] 或嵌套数组时不得提前截断（本会话真实踩过的两次探针自坏）', () => {
  assert.deepEqual(parseRegistry(SUPP_TEXT, 'supplementaryViewTests'), ['create-view-default', 'model-provider-add-dialog', 'sidebar-platform-list'])
  assert.equal(parseRegistry(SUPP_TEXT, 'supplementaryViewTests').length, 3)
  // 嵌套数组：内层 `]` 不是外层数组的闭合；`sel: '.btn['` 里的方括号在字符串里，也不参与配对
  assert.deepEqual(parseRegistry(NESTED_CLEAN_TEXT, 'workflowTests'), ['publish-flow', 'deep-clone'])
})

test('C1b 两种取 id 的写法混进同一张表时必须出声，不得静默少一个视图', () => {
  // NESTED_MIXED_TEXT 的第 3 个元素是 `{ name: ... }` 而前 2 个是 routeView(...)。
  // 取 id 的规则按"这张表用哪种写法"选，不取并集（并集会把 all 表里 4 个中文断言标签
  // `name: '页面主标题'` 当成视图混进判定域，实测），所以混用时 id 数会少 1 ——
  // 元素计数不变量必须把这一下静默退化变成红。
  assert.throws(() => parseRegistry(NESTED_MIXED_TEXT, 'workflowTests'), /2 个 id[\s\S]*3[\s\S]*顶层元素/)
})

test('C2 注册表规模必须逐字对上，marker 不存在时抛错而不是返回空数组', () => {
  assert.deepEqual(parseRegistry(ALL_TEXT, 'viewTests'), ['home-baseline', 'accounts-list', 'film-engineering'])
  assert.deepEqual(parseRegistry(PIXEL_TEXT, 'pixelTests'), ['home-baseline', 'accounts-list'])
  assert.throws(() => parseRegistry(ALL_TEXT, 'noSuchArray'), /noSuchArray/)
})

test('C3 collectRegistries 把三个来源一次收齐；任一处解析为空即抛错', () => {
  const got = collectRegistries({ allText: ALL_TEXT, suppText: SUPP_TEXT, pixelText: PIXEL_TEXT })
  assert.deepEqual(got.all, ['home-baseline', 'accounts-list', 'film-engineering'])
  assert.equal(got.supp.length, 3)
  assert.equal(got.pixel.length, 2)
  // 三种"解析不出东西"的形态都必须出声，绝不返回空数组让缺口读成 0：
  // 空数组（两种写法，换行与单行）走「解析为空」，括号不配平（文件被截断）走「不配平」。
  assert.throws(() => collectRegistries({ allText: ALL_TEXT, suppText: SUPP_TEXT, pixelText: 'const pixelTests = [\n]\n' }), /pixelTests[\s\S]*解析为空/)
  assert.throws(() => collectRegistries({ allText: ALL_TEXT, suppText: SUPP_TEXT, pixelText: 'const pixelTests = []\n' }), /pixelTests[\s\S]*解析为空/)
  assert.throws(() => collectRegistries({ allText: ALL_TEXT, suppText: SUPP_TEXT, pixelText: 'const pixelTests = [\n  { name: \'a\',\n' }), /pixelTests[\s\S]*不配平/)
  // 数组体里混进了别的 `name:`（如 meta 字段）时，规模下界由真实文件臂 C11 守，这里守"不重复"
  assert.equal(new Set(collectRegistries({ allText: ALL_TEXT, suppText: SUPP_TEXT, pixelText: PIXEL_TEXT }).supp).size, 3)
})

test('C4 判定域按视图并集展开成 视图×主题，且同一视图跨套件只算一条', () => {
  const d = buildDomain(registries())
  const keys = d.map((e) => e.key)
  assert.deepEqual(keys.slice(0, 4), ['home-baseline:light', 'home-baseline:dark', 'accounts-list:light', 'accounts-list:dark'])
  assert.equal(d.length, 6 * THEMES.length, '并集 6 个视图（home/accounts 在 pixel 里重复，只算一次）× 2 档主题')
  const film = d.find((e) => e.view === 'film-engineering')
  assert.deepEqual(film.suites, ['all'], '无基线的视图必须点名它出现在哪些注册表')
})

// --- 判定层 -------------------------------------------------------------------

test('C5 缺基线且未登记 ⇒ 判红，且必须点名视图、主题与所在套件', () => {
  const r = evaluate({ domain: buildDomain(registries()), baselines: pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark'), exceptions: emptyExceptions })
  assert.equal(r.ok, false)
  const miss = r.missing.map((m) => m.key).sort()
  assert.deepEqual(miss, ['film-engineering:dark', 'film-engineering:light', 'model-provider-add-dialog:dark', 'model-provider-add-dialog:light', 'create-view-default:dark', 'create-view-default:light', 'sidebar-platform-list:dark', 'sidebar-platform-list:light'].sort())
  assert.ok(r.problems.join('\n').includes('film-engineering:light'), '问题文案必须可直接照抄去修')
})

test('C6 全部缺口都有登记 ⇒ 判绿；补上图后登记项变陈旧 ⇒ 判红（清单只能缩小）', () => {
  const dom = buildDomain(registries())
  // 登记的是**实测缺口**，不是整张判定域：把已有基线的那格也登记进去，等于自己造一条陈旧项
  const bare = evaluate({ domain: dom, baselines: pngs('home-baseline'), exceptions: emptyExceptions })
  assert.equal(bare.ok, false)
  const gaps = {}
  for (const m of bare.missing) gaps[m.key] = { reason: '基线待由 CI artifact 提升（PR B）' }
  const r = evaluate({ domain: dom, baselines: pngs('home-baseline'), exceptions: { gaps, orphans: [] } })
  assert.equal(r.ok, true, '登记齐备却判红: ' + r.problems.join(' / '))
  assert.deepEqual(r.stale, [], '登记项都仍对应真实缺口时不该有陈旧')

  // 现在把 home-baseline 的暗档也补上 ⇒ 那格登记必须报陈旧并挡住（不能留着当"已登记"混过去）
  const after = evaluate({ domain: dom, baselines: pngs('home-baseline', 'home-baseline-dark'), exceptions: { gaps, orphans: [] } })
  assert.equal(after.ok, false, '补了基线却没销登记项，仍然判绿 = 清单可以只增不减')
  assert.deepEqual(after.stale, ['home-baseline:dark'])
})

test('C7 无主基线必须点名；未登记即红，登记后只能缩小', () => {
  const dom = buildDomain(registries())
  const withOrphan = pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark', 'login-form')
  const gaps = {}
  for (const v of ['film-engineering', 'create-view-default', 'model-provider-add-dialog', 'sidebar-platform-list']) {
    for (const t of THEMES) gaps[v + ':' + t] = { reason: '基线待由 CI artifact 提升（PR B）' }
  }
  const exceptions = { gaps, orphans: { 'login-form': { reason: '历史遗留，随 PR B 决定去留' } } }
  assert.equal(evaluate({ domain: dom, baselines: withOrphan, exceptions: emptyExceptions }).ok, false, '未登记的孤儿基线被放过了')
  assert.equal(evaluate({ domain: dom, baselines: withOrphan, exceptions }).ok, true)
  // 孤儿基线被删掉之后，它的登记项必须报陈旧 —— 清单只能缩小
  const shrunk = evaluate({ domain: dom, baselines: pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark'), exceptions })
  assert.equal(shrunk.stale.length, 1, '孤儿登记项已无对应基线却没报陈旧: ' + JSON.stringify(shrunk.stale))
  assert.ok(shrunk.stale[0].startsWith('login-form'))
})

test('C8 空扫描域不得当成通过（"缺口=0" 与"什么都没扫"必须能区分）', () => {
  const r = evaluate({ domain: [], baselines: pngs('whatever'), exceptions: emptyExceptions })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /判定域为空/)
})

test('C9 主题档位必须是闭合的两档，缺一即锁本身写坏', () => {
  assert.deepEqual(THEMES, ['light', 'dark'])
})

test('C10 登记项没有 reason 时必须判红（否则登记成了绕过而不是留痕）', () => {
  const r = evaluate({
    domain: buildDomain(registries()),
    baselines: pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark'),
    exceptions: { gaps: { 'film-engineering:light': {}, 'film-engineering:dark': { reason: 'ok' }, 'create-view-default:light': { reason: 'ok' }, 'create-view-default:dark': { reason: 'ok' }, 'model-provider-add-dialog:light': { reason: 'ok' }, 'model-provider-add-dialog:dark': { reason: 'ok' }, 'sidebar-platform-list:light': { reason: 'ok' }, 'sidebar-platform-list:dark': { reason: 'ok' } }, orphans: {} },
  })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /reason/)
})

// --- 真实仓臂：证明测量域是仓里那三张注册表，不是夹具 ---------------------------

test('C11 真实仓臂：读盘解析三表 + 基线目录 + 登记账本 ⇒ 判绿，且规模下界守住解析没退化', () => {
  const { loadRepo } = require('./check-visual-coverage.js')
  const repo = loadRepo(path.resolve(__dirname, '..'))
  const { all, supp, pixel } = repo.registries
  // 下界按实测（37 / 19 / 20）留一档余量：解析退化会把缺口读成 0，这三条是那种情况的报警器
  assert.ok(all.length >= 30, 'all-views 解析规模退化: ' + all.length)
  assert.ok(supp.length >= 15, 'supplementary 解析规模退化: ' + supp.length)
  assert.ok(pixel.length >= 15, 'pixelTests 解析规模退化: ' + pixel.length)
  assert.equal(repo.domain.length, new Set([...all, ...supp, ...pixel]).size * THEMES.length)
  const r = evaluate({ domain: repo.domain, baselines: repo.baselines, exceptions: repo.exceptions })
  assert.equal(r.ok, true, '真实仓不自洽：\n' + r.problems.join('\n'))
  assert.equal(r.unregistered.length, 0, '有缺口没登记（要么补基线，要么带理由登记）: ' + r.unregistered.slice(0, 8).join(', '))
  assert.equal(r.stale.length, 0, '登记项已无对应缺口，必须删掉（清单只能缩小）: ' + r.stale.join(', '))
})
