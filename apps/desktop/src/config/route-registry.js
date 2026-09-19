/**
 * route-registry.js —— 路由入口登记表（2026-09-17，desktop-ui-consistency T0-5）
 *
 * 为什么需要这张表：
 * src/router/index.js 只声明「路由怎么匹配」，不回答「用户从哪进来」。历史结果是
 * 存在一批路由没有任何导航入口（暗路由），运营中心「应用菜单」也管不到它们 ——
 * 既无法配置显示/隐藏，也无法排查用户是怎么走进来的。本表把「路由 ⇄ 入口」
 * 显式化，并由 .github/scripts/check-route-registry.js 在 CI 强制：
 * router/index.js 新增非 redirect 路由而未在本表登记 → 门禁失败（exit 1）。
 *
 * 字段契约（登记一条路由必须填全）：
 * - path       路由路径，必须与 router/index.js 完全一致（含 :param）
 * - name       vue-router 路由名；redirect 路由无 name，填 null
 * - view       视图文件名（如 'Home.vue'）；redirect 路由填 ''（空串 = redirect）
 * - navEntry   侧边栏菜单项；不进侧边栏填 null
 *              —— { key, group, labelI18nKey, to, icon }，字段结构与
 *                 sidebar-menu.js 的 SIDEBAR_MENU_DEFINITION 逐项一致。
 *                 key/group 是运营中心「应用菜单」配置的主键与分组，一旦发布不得改名。
 * - internal   true = 暗路由（无侧边栏菜单入口，只能从其它页面进入）
 * - entryFrom  internal:true 时必填：宿主入口路径（必须指向表内已登记的 path）
 *
 * CI 强制的约束（.github/scripts/check-route-registry.js）：
 * 1. router/index.js 每条非 redirect 路由都必须在本表登记（path 一一对应）
 * 2. 非 redirect 路由必须能回答入口：navEntry 非空，或 internal:true + entryFrom 非空
 * 3. navEntry 非空的 key 集合必须与 SIDEBAR_MENU_KEY_ORDER 完全一致
 * 4. view 必须等于 router/index.js 中 import 的视图文件名；redirect 路由 view 必须为 ''
 * 5. entryFrom 必须指向表内已登记的 path（防登记死链）
 *
 * 维护规则：新增页面时**先**在本表登记，再去 router/index.js 加路由；顺序反了 CI 会拦。
 * 详见 docs/frontend-interaction-spec.md 第 9 节。
 */
import {
  Calendar,
  ChatDotRound,
  Collection,
  Cpu,
  DataAnalysis,
  Document,
  FolderOpened,
  HomeFilled,
  MagicStick,
  Search,
  TrendCharts,
  User,
  VideoCamera,
} from '@element-plus/icons-vue'

/** 菜单分组标识：primary = 一级导航（平铺）；more = 「更多」折叠菜单 */
export const SIDEBAR_GROUP_PRIMARY = 'primary'
export const SIDEBAR_GROUP_MORE = 'more'

/**
 * 路由入口登记表。
 *
 * 顺序与 src/router/index.js 的 routes 数组保持一致，便于逐条对照。
 * 侧边栏的渲染顺序不取决于本表顺序，而由 SIDEBAR_MENU_KEY_ORDER 决定。
 */
export const ROUTE_REGISTRY = Object.freeze([
  {
    path: '/',
    name: 'Home',
    view: 'Home.vue',
    navEntry: { key: 'home', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.home', to: '/', icon: HomeFilled },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/comments',
    name: 'Comments',
    view: 'Comments.vue',
    navEntry: { key: 'comments', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.comments', to: '/comments', icon: ChatDotRound },
    internal: false,
    entryFrom: null,
  },
  {
    // 暗路由：全仓库无跳转来源，只能靠 URL 直达（引导流程疑已下线，入口待确认）
    path: '/first-run',
    name: 'FirstRun',
    view: 'FirstRun.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/',
  },
  {
    // 暗路由：入口是侧边栏顶部「新建发布」按钮（MpSidebar.vue goToPublish，全域常驻），
    // 另可从 /create/result、/library 历史记录等处进入。无侧边栏菜单项 ——
    // 菜单「发布」目前指向 /publish/history（语义错位，由 T1 处理，本卡只登记不改语义）
    path: '/publish',
    name: 'Publish',
    view: 'Publish.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/',
  },
  {
    path: '/publish/history',
    name: 'PublishHistory',
    view: 'PublishHistory.vue',
    navEntry: { key: 'publish', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.publish', to: '/publish/history', icon: VideoCamera },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/accounts',
    name: 'Accounts',
    view: 'Accounts.vue',
    navEntry: { key: 'accounts', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.accounts', to: '/accounts', icon: User },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    view: 'Dashboard.vue',
    navEntry: { key: 'dashboard', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.dashboard', to: '/dashboard', icon: DataAnalysis },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/collection',
    name: 'Collection',
    view: 'Collection.vue',
    navEntry: { key: 'collection', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.collection', to: '/collection', icon: Collection },
    internal: false,
    entryFrom: null,
  },
  {
    // 文案库（2026-09-19）：聚合采集/改写/草稿/视频创作四来源的一级页面
    path: '/copy-library',
    name: 'CopyLibrary',
    view: 'CopyLibraryView.vue',
    navEntry: { key: 'copy-library', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.copyLibrary', to: '/copy-library', icon: Document },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/keywords',
    name: 'Keywords',
    view: 'KeywordMonitorView.vue',
    navEntry: { key: 'keywords', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.keywords', to: '/keywords', icon: Search },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/viral-analysis',
    name: 'ViralAnalysis',
    view: 'ViralAnalysis.vue',
    navEntry: { key: 'viral', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.viral', to: '/viral-analysis', icon: TrendCharts },
    internal: false,
    entryFrom: null,
  },
  {
    // redirect：历史别名，收敛到 /model-providers
    path: '/providers',
    name: null,
    view: '',
    navEntry: null,
    internal: false,
    entryFrom: null,
  },
  {
    path: '/model-providers',
    name: 'ModelProviders',
    view: 'ModelProviders.vue',
    navEntry: { key: 'model-providers', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.modelProviders', to: '/model-providers', icon: Cpu },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/create',
    name: 'Create',
    view: 'CreateView.vue',
    navEntry: { key: 'create', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.create', to: '/create', icon: VideoCamera },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/member-center',
    name: 'MemberCenter',
    view: 'MemberCenter.vue',
    navEntry: { key: 'member-center', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'memberCenter.menuEntry', to: '/member-center', icon: User },
    internal: false,
    entryFrom: null,
  },
  {
    // redirect：历史别名，收敛到 /create
    path: '/create/pipeline',
    name: null,
    view: '',
    navEntry: null,
    internal: false,
    entryFrom: null,
  },
  {
    // 暗路由：从 /create（CreateView.vue）与创作历史（CreateHistory.vue）预览进入
    path: '/create/result',
    name: 'CreateResult',
    view: 'ResultView.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/create',
  },
  {
    // redirect：历史记录已收敛到「视频创作」页的历史记录标签（/create?view=history）
    path: '/create/history',
    name: null,
    view: '',
    navEntry: null,
    internal: false,
    entryFrom: null,
  },
  {
    path: '/cloud-publish',
    name: 'CloudPublish',
    view: 'CloudPublish.vue',
    navEntry: { key: 'cloud-publish', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.cloudPublish', to: '/cloud-publish', icon: FolderOpened },
    internal: false,
    entryFrom: null,
  },
  {
    // 暗路由：全仓库无跳转来源，只能靠 URL 直达（入口待确认）
    path: '/intelligence',
    name: 'Intelligence',
    view: 'Intelligence.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/',
  },
  {
    path: '/calendar',
    name: 'Calendar',
    view: 'Calendar.vue',
    navEntry: { key: 'calendar', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.calendar', to: '/calendar', icon: Calendar },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/library',
    name: 'ProjectLibrary',
    view: 'ProjectLibrary.vue',
    navEntry: { key: 'library', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.library', to: '/library', icon: FolderOpened },
    internal: false,
    entryFrom: null,
  },
  {
    // 暗路由：从 /library（素材库项目卡片 ProjectCard.vue）进入
    path: '/board/:projectId',
    name: 'ProductionBoard',
    view: 'ProductionBoard.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/library',
  },
  {
    // 暗路由：从 /board/:projectId（ProductionBoard.vue 联系表入口）进入
    path: '/board/:projectId/contact-sheet',
    name: 'ContactSheetView',
    view: 'ContactSheetView.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/board/:projectId',
  },
  {
    // 暗路由：从 /board/:projectId（ProductionBoard.vue 时间线回放入口）进入
    path: '/replay/:projectId',
    name: 'ReplayTimeline',
    view: 'ReplayTimeline.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/board/:projectId',
  },
  {
    path: '/prompt-eval',
    name: 'PromptEval',
    view: 'PromptEvalView.vue',
    navEntry: { key: 'prompt-eval', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.promptEval', to: '/prompt-eval', icon: MagicStick },
    internal: false,
    entryFrom: null,
  },
  {
    // 暗路由：从 /create（CreateView.vue 选择 video-clone 流水线）进入
    path: '/video-clone',
    name: 'VideoClone',
    view: 'VideoCloneView.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/create',
  },
  {
    // 暗路由：从 /create（CreateView.vue 选择 film-engineering 流水线）进入
    path: '/film-engineering',
    name: 'FilmEngineering',
    view: 'FilmEngineeringView.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/create',
  },
  {
    // 暗路由：全仓库无跳转来源，只能靠 URL 直达（入口待确认）
    path: '/auto-pipeline',
    name: 'AutoPipeline',
    view: 'AutoPipelineView.vue',
    navEntry: null,
    internal: true,
    entryFrom: '/',
  },
  {
    path: '/knowledge-base',
    name: 'KnowledgeBase',
    view: 'KnowledgeBasePage.vue',
    navEntry: { key: 'knowledge-base', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'knowledgeBase.title', to: '/knowledge-base', icon: Collection },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/performance-insights',
    name: 'PerformanceInsights',
    view: 'PerformanceInsights.vue',
    navEntry: { key: 'performance-insights', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'perfInsights.title', to: '/performance-insights', icon: TrendCharts },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/rewrite',
    name: 'Rewrite',
    view: 'RewriteView.vue',
    navEntry: { key: 'rewrite', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.rewrite', to: '/rewrite', icon: MagicStick },
    internal: false,
    entryFrom: null,
  },
  {
    path: '/hot-topics',
    name: 'HotTopics',
    view: 'HotTopics.vue',
    navEntry: { key: 'hot-topics', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'hotTopics.menuLabel', to: '/hot-topics', icon: TrendCharts },
    internal: false,
    entryFrom: null,
  },
])

/**
 * 侧边栏菜单渲染顺序（key 列表）。
 *
 * 为什么单独维护顺序：本表按 router 顺序排列，而菜单的渲染顺序（= 运营中心种子
 * 顺序 CATALOG，决定 sort_order 初值）是另一条独立的历史契约，不能被路由顺序带偏。
 * 新增/删除菜单项必须同步改这里，CI 会校验本表 navEntry 的 key 集合与此列表完全一致。
 */
export const SIDEBAR_MENU_KEY_ORDER = Object.freeze([
  // 一级导航（平铺）
  'home',
  'publish',
  'accounts',
  'dashboard',
  'create',
  'collection',
  'copy-library',
  'rewrite',
  // 「更多」折叠菜单
  'calendar',
  'comments',
  'cloud-publish',
  'library',
  'keywords',
  'viral',
  'prompt-eval',
  'hot-topics',
  'model-providers',
  'knowledge-base',
  'performance-insights',
  'member-center',
])

/**
 * 从路由登记表派生侧边栏菜单定义。
 *
 * 纯函数（不依赖 Vue），输入任意 registry、输出按 SIDEBAR_MENU_KEY_ORDER 排序的
 * navEntry 浅拷贝数组 —— 拷贝是为了让 SIDEBAR_MENU_DEFINITION 与登记表解耦，
 * 任一侧被误改都不会污染另一侧。
 *
 * 顺序表中不存在的 key 追加到末尾并告警（由 CI 规则 3 拦截，这里是运行时兜底，
 * 保证「新增菜单项不会静默消失」）。
 *
 * @param {Array<object>} registry 路由登记表（ROUTE_REGISTRY）
 * @returns {Array<{key:string, group:string, labelI18nKey:string, to:string, icon:object}>}
 */
export function deriveSidebarMenu (registry) {
  const list = Array.isArray(registry) ? registry : []
  const byKey = new Map()
  for (const entry of list) {
    if (entry && entry.navEntry) byKey.set(entry.navEntry.key, entry.navEntry)
  }

  const ordered = []
  for (const key of SIDEBAR_MENU_KEY_ORDER) {
    const nav = byKey.get(key)
    if (nav) ordered.push({ ...nav })
  }
  for (const entry of list) {
    if (entry && entry.navEntry && !SIDEBAR_MENU_KEY_ORDER.includes(entry.navEntry.key)) {
      // 英文告警：本文件受 CI check-locale-sync.js --cjk 约束（渲染端非 locales 文件禁止新增硬编码中文）
      console.warn(`[route-registry] menu key "${entry.navEntry.key}" is missing in SIDEBAR_MENU_KEY_ORDER; appended to the end`)
      ordered.push({ ...entry.navEntry })
    }
  }
  return ordered
}
