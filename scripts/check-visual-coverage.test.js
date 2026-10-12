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
  SOURCES,
  SCAN_ROOT,
  MAX_GAPS,
  MAX_OUT_OF_DOMAIN,
  parseRegistry,
  collectRegistries,
  discoverRegistries,
  sourceKeys,
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
// 真实形态之一：`autonomous-loop.js` **整份用双引号**。第一版只认单引号时它取到 0 个 id
// 而数组里有 20 个元素 —— 靠元素计数才没被读成"这张表没有视图"。
const LOOP_TEXT = `
const pixelTests = [
  { name: "home-baseline", route: "/" },
  { name: "comments", route: "/comments" },
]
const screenshotViewTests = [
  { name: "comments", route: "/comments" },
  { name: "accounts-with-dialog", route: "/accounts" },
]
`

const FIXTURES = {
  'apps/desktop/tests/visual-testing/views/all-views.visual.test.js': ALL_TEXT,
  'apps/desktop/tests/visual-testing/views/supplementary-views.visual.test.js': SUPP_TEXT,
  'apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js': PIXEL_TEXT,
  'apps/desktop/tests/visual-testing/autonomous-loop.js': LOOP_TEXT,
}
const fixtureRead = (over = {}) => (p) => {
  if (Object.prototype.hasOwnProperty.call(over, p)) return over[p]
  if (Object.prototype.hasOwnProperty.call(FIXTURES, p)) return FIXTURES[p]
  throw new Error('夹具没给这个文件: ' + p)
}

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

test('C3 collectRegistries 按 SOURCES 逐张收齐；任一处解析不出东西即抛错', () => {
  const got = collectRegistries(fixtureRead())
  assert.deepEqual(got.all, ['home-baseline', 'accounts-list', 'film-engineering'])
  assert.equal(got.supp.length, 3)
  assert.deepEqual(got.pixel, ['home-baseline', 'accounts-list'])
  assert.deepEqual(got.loopPixel, ['home-baseline', 'comments'])
  assert.deepEqual(Object.keys(got).sort(), Object.keys(SOURCES).sort(), '进域注册表张数必须等于 SOURCES —— 少了就是域静默缩小')
  // 三种"解析不出东西"的形态都必须出声，绝不返回空数组让缺口读成 0：
  // 空数组（两种写法）与"有元素但取不到 id"走同一条抛错，括号不配平走「不配平」。
  assert.throws(() => collectRegistries(fixtureRead({ 'apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js': 'const pixelTests = [\n]\n' })), /pixelTests[\s\S]*取不到任何 id/)
  assert.throws(() => collectRegistries(fixtureRead({ 'apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js': 'const pixelTests = []\n' })), /pixelTests[\s\S]*取不到任何 id/)
  assert.throws(() => collectRegistries(fixtureRead({ 'apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js': "const pixelTests = [\n  { name: 'a',\n" })), /pixelTests[\s\S]*不配平/)
  // 未知条目形状（第三种写法）不得被读成"这张表没有视图"
  assert.throws(() => collectRegistries(fixtureRead({ 'apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js': 'const pixelTests = [\n  makeCase({ view: "x" }),\n  makeCase({ view: "y" }),\n]\n' })), /取不到任何 id[\s\S]*2/)
  assert.equal(new Set(got.supp).size, 3)
})

test('C3b 双引号注册表必须与单引号同权（autonomous-loop.js 整份用双引号，实测）', () => {
  assert.deepEqual(parseRegistry(LOOP_TEXT, 'pixelTests'), ['home-baseline', 'comments'])
  assert.deepEqual(parseRegistry(LOOP_TEXT, 'screenshotViewTests'), ['comments', 'accounts-with-dialog'])
  // 反证：把双引号支持摘掉（只认单引号）时这张表会抛错而不是返回空数组 ——
  // 这条断言锁的是"抛错"这个 fail-closed 出口存在，不是锁它读成 0 条
  const singleQuoteOnly = /routeView\(\s*'([^']+)'/g
  assert.equal([...LOOP_TEXT.matchAll(singleQuoteOnly)].length, 0, '夹具里确实没有单引号形态，双引号支持是被真测到的')
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

// --- 真实仓臂：证明测量域是仓里那五张进域注册表 + 八张被发现注册表，不是夹具 ---------

test('C11 真实仓臂：读盘解析五表 + 基线目录 + 登记账本 ⇒ 判绿，规模下界与成员钉守住解析没退化', () => {
  const { loadRepo } = require('./check-visual-coverage.js')
  const repo = loadRepo(path.resolve(__dirname, '..'))
  const { all, supp, pixel, loopPixel, loopViews } = repo.registries
  // 下界按实测（37 / 19 / 20 / 20 / 14）留一档余量：解析退化会把缺口读成 0，这几条是那种情况的报警器
  assert.ok(all.length >= 30, 'all-views 解析规模退化: ' + all.length)
  assert.ok(supp.length >= 15, 'supplementary 解析规模退化: ' + supp.length)
  assert.ok(pixel.length >= 15, 'pixelTests 解析规模退化: ' + pixel.length)
  assert.ok(loopPixel.length >= 15, 'autonomous-loop pixelTests 解析规模退化: ' + loopPixel.length)
  assert.ok(loopViews.length >= 10, 'autonomous-loop screenshotViewTests 解析规模退化: ' + loopViews.length)
  // 成员钉（QM-6 前端轴 MINOR）：只钉计数的话，"换写法但计数不退化、成员却被整体替换"仍会绿
  assert.ok(all.includes('home-default'), 'all-views 少了 home-default —— 成员被换掉了')
  assert.ok(pixel.includes('home-baseline'), 'pixelTests 少了 home-baseline')
  assert.ok(supp.includes('create-view-default'), 'supplementary 少了 create-view-default')
  assert.ok(loopPixel.includes('comments'), 'loopPixel 少了 comments（双引号表，第一版只认单引号时就是它读成 0 条）')
  assert.ok(loopViews.includes('accounts-with-dialog'), 'loopViews 少了 accounts-with-dialog')
  assert.ok(all.filter((v) => pixel.includes(v)).length > 0, 'all ∩ pixel 必须非空，否则两张表的对应关系已经断了')
  assert.equal(repo.domain.length, new Set([all, supp, pixel, loopPixel, loopViews].flat()).size * THEMES.length)
  const r = evaluate({ ...repo, })
  assert.equal(r.ok, true, '真实仓不自洽：\n' + r.problems.join('\n'))
  assert.equal(r.unregistered.length, 0, '有缺口没登记（要么补基线，要么带理由登记）: ' + r.unregistered.slice(0, 8).join(', '))
  assert.equal(r.stale.length, 0, '登记项已无对应缺口，必须删掉（清单只能缩小）: ' + r.stale.join(', '))
})

test('C12 发现式清扫：真实仓的每张 *Tests 注册表要么进域、要么带 reason 豁免（QM-6 前端轴 MAJOR）', () => {
  const { loadRepo } = require('./check-visual-coverage.js')
  const root = path.resolve(__dirname, '..')
  const repo = loadRepo(root)
  // 下界：实测 8 张。若扫描退化（读不到子目录）条数会掉，域就会静默缩小而"发现"照报全覆盖
  assert.ok(repo.discovered.length >= 8, '发现式清扫规模退化: ' + JSON.stringify(repo.discovered))
  assert.ok(repo.discovered.every((k) => k.startsWith(SCAN_ROOT + '/')), '发现项必须都在扫描根内: ' + JSON.stringify(repo.discovered))
  // 进域集合必须是发现集合的子集 —— 写了 SOURCES 但那个数组其实不存在时，collectRegistries 会抛；这里反向锁
  const found = new Set(repo.discovered)
  for (const k of sourceKeys()) assert.ok(found.has(k), 'SOURCES 指向的注册表没被发现: ' + k + '（路径或数组名与仓里不一致）')
  // 真实仓现状：发现集合被 SOURCES ∪ 豁免 全覆盖，所以 evaluate 的 undiscovered 必须**空**
  // —— 但它为空的原因是"豁免登记齐了"，不是"清扫什么都没扫到"，故上面两条先钉住清扫本身有效
  const verdict = evaluate(repo)
  assert.deepEqual(verdict.undiscovered, [], '真实仓有注册表既没进域也没豁免: ' + JSON.stringify(verdict.undiscovered))
  assert.equal(Object.keys(repo.exceptions.outOfDomain).length, repo.discovered.length - Object.keys(SOURCES).length,
    '豁免条数必须正好等于"发现了但没进域"的条数')
  assert.ok(Object.keys(repo.exceptions.outOfDomain).length <= MAX_OUT_OF_DOMAIN, '豁免超过上界，抬上界必须与新增同 PR 并写理由')
  // 行为面：伪造一张新注册表（既不进 SOURCES 也不豁免）⇒ 必须红，且点名它
  const dom = buildDomain(registries())
  const gaps = {}
  for (const v of ['film-engineering', 'create-view-default', 'model-provider-add-dialog', 'sidebar-platform-list']) {
    for (const t of THEMES) gaps[v + ':' + t] = { reason: 'x' }
  }
  const r = evaluate({
    domain: dom, baselines: pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark'),
    exceptions: { gaps, orphans: {}, outOfDomain: {} },
    discovered: [...sourceKeys(), SCAN_ROOT + '/views/new-suite.visual.test.js#newTests'],
  })
  assert.equal(r.ok, false, '新注册表没登记就判绿 = 门禁自己的域会静默缩小')
  assert.match(r.problems.join('\n'), /new-suite\.visual\.test\.js#newTests/)
  assert.deepEqual(r.undiscovered, [SCAN_ROOT + '/views/new-suite.visual.test.js#newTests'])
  // 豁免了就不再红；而豁免项对应的注册表被删掉后，那条豁免必须报陈旧
  const exempted = evaluate({
    domain: dom, baselines: pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark'),
    exceptions: { gaps, orphans: {}, outOfDomain: { [SCAN_ROOT + '/views/new-suite.visual.test.js#newTests']: { reason: '不是视图级基线' } } },
    discovered: [...sourceKeys(), SCAN_ROOT + '/views/new-suite.visual.test.js#newTests'],
  })
  assert.equal(exempted.ok, true, exempted.problems.join(' / '))
  const gone = evaluate({
    domain: dom, baselines: pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark'),
    exceptions: { gaps, orphans: {}, outOfDomain: { [SCAN_ROOT + '/views/new-suite.visual.test.js#newTests']: { reason: 'x' } } },
    discovered: sourceKeys(),
  })
  assert.ok(gone.stale.includes(SCAN_ROOT + '/views/new-suite.visual.test.js#newTests'), '豁免项已不被发现却没报陈旧 = 清单可以只增不减')
  // 豁免必须有 reason
  const noReason = evaluate({
    domain: dom, baselines: pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark'),
    exceptions: { gaps, orphans: {}, outOfDomain: { [SCAN_ROOT + '/views/new-suite.visual.test.js#newTests']: {} } },
    discovered: [...sourceKeys(), SCAN_ROOT + '/views/new-suite.visual.test.js#newTests'],
  })
  assert.match(noReason.problems.join('\n'), /域外豁免 [\s\S]*缺 reason/)
})

test('C13 规模上界棘轮：新增登记必须同时抬起 MAX_（QM-6 后端轴 CRITICAL：同 PR 新增视图+登记 gap 不得全程无声）', () => {
  const dom = buildDomain(registries())
  const allBaselined = pngs('home-baseline', 'home-baseline-dark', 'accounts-list', 'accounts-list-dark')
  // 夹具里真实缺口是 8 条（12 条判定域 − 4 张已存在基线）。登记必须**从实测缺口取**，
  // 把已有基线的那几格登记进去会立刻变成陈旧项，那样测的就不是上界而是上一条判据了。
  const realMissing = evaluate({ domain: dom, baselines: allBaselined, exceptions: { gaps: {}, orphans: {}, outOfDomain: {} } }).missing.map((e) => e.key)
  assert.equal(realMissing.length, 8, '夹具缺口变了，C13 的上界数字要跟着重算: ' + realMissing.length)
  const mkGaps = (keys) => {
    const g = {}
    for (const k of keys) g[k] = { reason: 'x' }
    return g
  }
  // 上界 == 实测缺口数 ⇒ 绿
  const atCeil = evaluate({ domain: dom, baselines: allBaselined, exceptions: { gaps: mkGaps(realMissing), orphans: {}, outOfDomain: {} }, ceilings: { maxGaps: 8 } })
  assert.equal(atCeil.ok, true, atCeil.problems.join(' / '))
  // 现在演一遍 QM-6 后端轴点出的攻击：新增视图 + **同一 PR 里当场登记** ⇒ unregistered 恒空，
  // 唯一还活着的判据就是上界。夹具用"缺口 8 条但上界仍写 4"代表"有人抬了登记却没抬 MAX_"。
  const overCeil = evaluate({ domain: dom, baselines: allBaselined, exceptions: { gaps: mkGaps(realMissing), orphans: {}, outOfDomain: {} }, ceilings: { maxGaps: 4 } })
  assert.equal(overCeil.ok, false, '超出上界仍判绿 = 登记成了免费的绕过通道')
  assert.match(overCeil.problems.join('\n'), /MAX_GAPS=4/)
  assert.equal(overCeil.unregistered.length, 0, '夹具里 8 条缺口都登记了 ⇒ unregistered 恒空，证明上界是唯一还活着的判据')
  // orphans / outOfDomain 同一判据
  const o = evaluate({ domain: dom, baselines: pngs('login-form'), exceptions: { gaps: mkGaps(realMissing), orphans: { 'login-form': { reason: 'x' } }, outOfDomain: {} }, ceilings: { maxGaps: 8, maxOrphans: 0 } })
  assert.match(o.problems.join('\n'), /MAX_ORPHANS=0/)
  // 真实仓：上界必须等于实测登记数（既不能虚高留余量，也不能低于现状）
  const { loadRepo } = require('./check-visual-coverage.js')
  const repo = loadRepo(path.resolve(__dirname, '..'))
  assert.equal(Object.keys(repo.exceptions.gaps).length, MAX_GAPS, 'MAX_GAPS 与账本实际条数不一致 —— 上界就成了摆设')
  assert.ok(MAX_GAPS > 0, '上界不得为 0（0 会让"清单只能缩小"变成"永远红"）')
})
