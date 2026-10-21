/**
 * check-route-registry 门禁自测（node --test）
 *
 * 门禁脚本自身必须被测试：解析逻辑一次静默失效，就等于这条 CI 卡点形同虚设
 * （历史上 locale-cjk 门禁就因「中间命令退出码被吞」长期假绿）。
 * 这里用「最小夹具 + 真实文件」两层覆盖：
 * - 最小夹具：逐条验证 5 条规则的失败路径（未登记 / 缺 entryFrom / 未申报暗路由 /
 *   顺序表漂移 / view 不一致 / entryFrom 死链）
 * - 真实文件：验证当前仓库状态确实通过，且解析出的规模符合预期（防解析退化）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  checkRouteRegistry,
  parseRouterRoutes,
  parseRegistry,
  parseArgs,
  CATCH_ALL_PATH,
} = require('./check-route-registry')

const ROOT = path.resolve(__dirname, '..', '..')
const REAL_ROUTER = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'src', 'router', 'index.js'), 'utf8')
const REAL_REGISTRY = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'src', 'config', 'route-registry.js'), 'utf8')

const MINI_ROUTER = `const routes = [
  { path: '/', name: 'Home', component: () => import('@/views/Home.vue') },
]
`

const MINI_REGISTRY = `export const SIDEBAR_MENU_KEY_ORDER = Object.freeze([
  'home',
])

export const ROUTE_REGISTRY = Object.freeze([
  {
    path: '/',
    name: 'Home',
    view: 'Home.vue',
    navEntry: { key: 'home', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.home', to: '/', icon: HomeFilled },
    internal: false,
    entryFrom: null,
  },
])
`

function run (routerSource, registrySource) {
  return checkRouteRegistry({ routerSource, registrySource })
}

function expectError (result, needle) {
  assert.equal(result.ok, false, `期望失败但通过了：${needle}`)
  assert.ok(
    result.errors.some((e) => e.includes(needle)),
    `期望包含「${needle}」，实际错误：\n${result.errors.join('\n')}`,
  )
}

test('最小夹具：登记齐全时通过', () => {
  const result = run(MINI_ROUTER, MINI_REGISTRY)
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
})

test('规则 1：router 新增未登记路由 → 失败并给出可操作文案', () => {
  const router = MINI_ROUTER.replace(
    ']\n',
    "  { path: '/sneaky', name: 'Sneaky', component: () => import('@/views/Sneaky.vue') },\n]\n",
  )
  const result = run(router, MINI_REGISTRY)
  expectError(result, '未登记路由：/sneaky')
  assert.ok(result.errors.some((e) => e.includes('route-registry.js')), '错误文案必须指向登记表')
})

test('规则 1 反向：登记表存在 router 没有的 path → 失败（陈旧登记）', () => {
  const registry = MINI_REGISTRY.replace(
    "    path: '/',\n    name: 'Home',",
    "    path: '/ghost',\n    name: 'Ghost',",
  )
  expectError(run(MINI_ROUTER, registry), '陈旧登记：/ghost')
})

test('规则 2：internal:true 缺 entryFrom → 失败', () => {
  const registry = MINI_REGISTRY
    .replace("navEntry: { key: 'home', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.home', to: '/', icon: HomeFilled },", 'navEntry: null,')
    .replace('internal: false,', 'internal: true,')
    .replace("'home',\n]", "'x',\n]")
  expectError(run(MINI_ROUTER, registry), '缺少 entryFrom')
})

test('规则 2：无 navEntry 且未标 internal → 失败（暗路由未申报）', () => {
  const registry = MINI_REGISTRY
    .replace("navEntry: { key: 'home', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.home', to: '/', icon: HomeFilled },", 'navEntry: null,')
    .replace("  'home',\n]", ']')
  expectError(run(MINI_ROUTER, registry), '暗路由未申报：/')
})

test('规则 2：navEntry 与 internal:true 同时存在 → 失败（二者互斥）', () => {
  const registry = MINI_REGISTRY.replace('internal: false,', 'internal: true,')
  expectError(run(MINI_ROUTER, registry), '二者互斥')
})

test('规则 3：navEntry key 不在 SIDEBAR_MENU_KEY_ORDER → 失败', () => {
  const registry = MINI_REGISTRY.replace("  'home',\n]", "  'other',\n]")
  const result = run(MINI_ROUTER, registry)
  expectError(result, '菜单项未登记顺序：home')
  expectError(result, 'SIDEBAR_MENU_KEY_ORDER 存在失效 key：other')
})

test('规则 4：view 与 router 的 component 不一致 → 失败', () => {
  const registry = MINI_REGISTRY.replace("view: 'Home.vue',", "view: 'Homme.vue',")
  expectError(run(MINI_ROUTER, registry), '视图不一致：/')
})

test('规则 4：redirect 路由 view 必须为空串', () => {
  const router = `const routes = [
  { path: '/old', redirect: '/new' },
]
`
  const registry = MINI_REGISTRY
    .replace("    path: '/',\n    name: 'Home',\n    view: 'Home.vue',", "    path: '/old',\n    name: null,\n    view: 'Home.vue',")
    .replace("navEntry: { key: 'home', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.home', to: '/', icon: HomeFilled },", 'navEntry: null,')
    .replace("  'home',\n]", ']')
  expectError(run(router, registry), "view 必须为 ''")
})

test('规则 5：entryFrom 指向未登记路径 → 失败（死链）', () => {
  const router = MINI_ROUTER.replace(
    ']\n',
    "  { path: '/inner', name: 'Inner', component: () => import('@/views/Inner.vue') },\n]\n",
  )
  let registry = MINI_REGISTRY
    .replace("  'home',\n]", ']')
    .replace(
      '  },\n])',
      `  },
  {
    path: '/inner',
    name: 'Inner',
    view: 'Inner.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/nowhere',
  },
])`,
    )
  registry = registry.replace("navEntry: { key: 'home', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.home', to: '/', icon: HomeFilled },", 'navEntry: null,').replace('internal: false,', 'internal: true,')
  expectError(run(router, registry), 'entryFrom 死链')
})

// —— 规则 6：catch-all 兜底路由是一等类型（UX 审计 1.9）——
// 夹具用「一条正常路由 + 一条兜底路由」的最小组合，逐条验证豁免面的**边界**：
// 只有被显式标记 catchAll:true 的那一条可以没有入口，其它一律照旧要求。
const CATCH_ALL = '/:pathMatch(.*)*'

const CATCH_ROUTER = `const routes = [
  { path: '/', name: 'Home', component: () => import('@/views/Home.vue') },
  { path: '${CATCH_ALL}', name: 'NotFound', component: () => import('@/views/NotFound.vue') },
]
`

const CATCH_ENTRY = `  {
    path: '${CATCH_ALL}',
    name: 'NotFound',
    view: 'NotFound.vue',
    navEntry: null,
    internal: false,
    entryFrom: null,
    catchAll: true,
  },
])`

const CATCH_REGISTRY = MINI_REGISTRY.replace('  },\n])', `  },\n${CATCH_ENTRY}`)

test('规则 6 正控：catchAll 登记项不需要回答入口，整套通过', () => {
  const result = run(CATCH_ROUTER, CATCH_REGISTRY)
  assert.deepEqual(result.errors, [])
  assert.equal(result.stats.catchAllRoutes, 1, 'stats 必须报出 catch-all 条数')
})

test('规则 6：同一个标记删掉后，兜底路由立刻变回「暗路由未申报」（豁免面只认这个标记）', () => {
  const registry = CATCH_REGISTRY.replace('    catchAll: true,\n', '')
  expectError(run(CATCH_ROUTER, registry), '暗路由未申报：/:pathMatch(.*)*')
})

test('规则 6：catchAll:false 显式写法不得当成标记（fail-closed）', () => {
  const registry = CATCH_REGISTRY.replace('catchAll: true,', 'catchAll: false,')
  expectError(run(CATCH_ROUTER, registry), '暗路由未申报：/:pathMatch(.*)*')
})

test('规则 6：出现第二条 catchAll → 失败', () => {
  const registry = CATCH_REGISTRY.replace(CATCH_ENTRY, `${CATCH_ENTRY.replace('])', '')}\n${CATCH_ENTRY}`)
  expectError(run(CATCH_ROUTER, registry), 'catchAll 登记项至多一条')
})

test('规则 6：兜底形状常量必须是 vue-router 4 唯一能匹配任意地址的写法', () => {
  // 判据本体若被改成 '*'（v4 已移除）或 '/404' 之类，豁免面就会挂到一条**匹配不到任何东西**的路由上，
  // 而夹具与本仓登记会跟着一起改，测试照绿 —— 所以这里用独立字面量对账。
  assert.equal(CATCH_ALL_PATH, CATCH_ALL)
})

test('规则 6：catchAll 配 redirect（view 为空）→ 失败，未知地址会重新落到空白页', () => {
  const router = CATCH_ROUTER.replace(
    `  { path: '${CATCH_ALL}', name: 'NotFound', component: () => import('@/views/NotFound.vue') },\n`,
    "  { path: '/x', redirect: '/' },\n",
  )
  const registry = CATCH_REGISTRY.replace("    view: 'NotFound.vue',", "    view: '',")
  expectError(run(router, registry), 'catchAll 必须指向真实视图')
})

test('规则 6：catchAll 标记挂在非兜底路径上 → 失败（形状必须全等）', () => {
  const registry = CATCH_REGISTRY.replace(`    path: '${CATCH_ALL}',`, "    path: '/404',")
  const router = CATCH_ROUTER.replace(`'${CATCH_ALL}'`, "'/404'")
  expectError(run(router, registry), 'catchAll 登记项的 path 必须是兜底形状')
})

test('规则 6：catchAll 不得同时是侧边栏项', () => {
  const registry = CATCH_REGISTRY.replace(
    `    path: '${CATCH_ALL}',\n    name: 'NotFound',\n    view: 'NotFound.vue',\n    navEntry: null,`,
    `    path: '${CATCH_ALL}',\n    name: 'NotFound',\n    view: 'NotFound.vue',\n    navEntry: { key: 'notFound', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.notFound', to: '/404', icon: HomeFilled },`,
  )
  expectError(run(CATCH_ROUTER, registry), 'catchAll 不得声明侧边栏入口')
})

test('规则 6：catchAll 不得同时标 internal（它没有宿主）', () => {
  const registry = CATCH_REGISTRY.replace(
    `    path: '${CATCH_ALL}',\n    name: 'NotFound',\n    view: 'NotFound.vue',\n    navEntry: null,\n    internal: false,`,
    `    path: '${CATCH_ALL}',\n    name: 'NotFound',\n    view: 'NotFound.vue',\n    navEntry: null,\n    internal: true,`,
  )
  expectError(run(CATCH_ROUTER, registry), 'catchAll 不得标 internal:true')
})

test('规则 6：router 侧出现两条兜底形状路由 → 失败（后者永不生效，属静默失配）', () => {
  const router = CATCH_ROUTER.replace(
    ']\n',
    `  { path: '${CATCH_ALL}', name: 'NotFound2', component: () => import('@/views/NotFound2.vue') },\n]\n`,
  )
  const result = run(router, CATCH_REGISTRY)
  assert.equal(result.ok, false, '两条兜底路由必须判失败')
  assert.ok(
    result.errors.some((e) => e.includes('router/index.js 出现多条兜底（catch-all）路由')),
    `期望点名「多条兜底路由」，实际：\n${result.errors.join('\n')}`,
  )
})

test('规则 6：catchAll 不得声明宿主入口 entryFrom（QM-6 外部评审 i2）', () => {
  // 只禁 internal 是不够的：规则 5 的死链检查仅在 internal 为真时执行，
  // 于是 `catchAll:true + entryFrom:'/'` 当时能过门禁 —— 假宿主从侧门进表。
  const registry = CATCH_REGISTRY.replace('    entryFrom: null,\n    catchAll: true,', "    entryFrom: '/',\n    catchAll: true,")
  assert.notEqual(registry, CATCH_REGISTRY, '夹具锚点未命中（登记表条目形状变了？）')
  expectError(run(CATCH_ROUTER, registry), 'catchAll 不得声明宿主入口')
})

test('规则 6：catchAll 的 name 必须与 router 声明逐字一致（QM-6 外部评审 i7）', () => {
  // 标题分支认的是**名字**；登记面与声明面若改名不同步，404 页标题会静默回退品牌名。
  const registry = CATCH_REGISTRY.replace("    name: 'NotFound',", "    name: 'NotFond',")
  assert.notEqual(registry, CATCH_REGISTRY, '夹具锚点未命中')
  expectError(run(CATCH_ROUTER, registry), 'catchAll 的 name 必须与 router 声明逐字一致')
})

test('规则 6 不得放宽普通暗路由：internal:true 缺 entryFrom 仍然失败', () => {
  const router = CATCH_ROUTER.replace(
    ']\n',
    "  { path: '/inner', name: 'Inner', component: () => import('@/views/Inner.vue') },\n]\n",
  )
  const registry = CATCH_REGISTRY.replace('  },\n])', `  },
  {
    path: '/inner',
    name: 'Inner',
    view: 'Inner.vue',
    navEntry: null,
    internal: true,
    entryFrom: null,
  },
])`)
  expectError(run(router, registry), '缺少 entryFrom')
})

test('真实文件：当前仓库通过门禁且规模符合预期', () => {
  const result = run(REAL_ROUTER, REAL_REGISTRY)
  assert.deepEqual(result.errors, [])
  assert.equal(result.stats.registryEntries, result.stats.routerRoutes, '登记表与 router 路由数必须一致')
  assert.equal(result.stats.redirectRoutes, 3)
  assert.ok(result.stats.menuItems >= 19, '菜单项不应减少（运营中心种子依赖）')
  assert.ok(result.stats.internalRoutes >= 8, '暗路由不应少于审计发现的 8 条')
  assert.equal(result.stats.catchAllRoutes, 1, '本仓必须恰好一条兜底路由（缺了=用户会看到空白内容区）')
})

test('真实文件：解析出的暗路由都带 entryFrom', () => {
  const { entries } = parseRegistry(REAL_REGISTRY)
  const dark = entries.filter((e) => e.internal)
  assert.ok(dark.length >= 8)
  for (const entry of dark) {
    assert.ok(entry.entryFrom, `暗路由 ${entry.path} 缺少 entryFrom`)
  }
})

test('parseRouterRoutes：无法归类的路由行视为解析失败（不静默放行）', () => {
  const { parseErrors } = parseRouterRoutes("const routes = [\n  { path: '/x', component: 42 },\n]\n")
  assert.equal(parseErrors.length, 1)
})

test('parseArgs：未知参数直接抛错', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option/)
  assert.deepEqual(parseArgs(['--json']), { json: true })
})
