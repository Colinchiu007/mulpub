/**
 * 应用端左侧边栏菜单定义 —— 单一事实源（Single Source of Truth）
 *
 * 背景（2026-09-15）：
 * 运营中心「应用菜单」页面对本文件的菜单项做「显示/隐藏 + 排序」配置，
 * 配置经 GET /api/v1/runtime/bootstrap 下发（Ed25519 签名），
 * 由 resolveSidebarMenu()（./sidebar-menu-merge.js）与本地定义合并后渲染。
 *
 * 职责边界：
 * - 本文件只描述「菜单是什么」（key / 分组 / i18n 文案 key / 路由 / 图标）。
 * - 「菜单怎么显示」（可见性合并、排序、强制项保护、失败降级）在 sidebar-menu-merge.js。
 * - 运营中心侧的同名目录在 ops-center/backend/services/app_menu_service.py，
 *   两处的 key 与分组顺序必须保持一致（运营中心以本文件为种子来源）。
 *
 * 文案约定：所有菜单项文案一律走 i18n（labelI18nKey → src/locales/zh.js|en.js 的
 * sidebar.nav.* 等 key），不在本文件写中文字面量 —— 受 CI 门禁 check-locale-sync.js --cjk
 * 约束（渲染端非 locales 文件禁止新增硬编码中文）。新增菜单项必须同步补齐 zh/en 文案。
 *
 * 硬约束：
 * - SIDEBAR_FORCED_VISIBLE_KEYS 中的项在运营中心不可关闭（开关灰显），
 *   应用端同时做二次保护：即使下发的 visible=false 也强制显示（防御纵深）。
 * - 分组语义为「组内排序」：primary 组与 more 组各自独立排序，
 *   因为 primary 是平铺导航、more 是折叠菜单，跨组穿插无法表达。
 */
import {
  Calendar,
  ChatDotRound,
  Collection,
  Cpu,
  DataAnalysis,
  FolderOpened,
  HomeFilled,
  MagicStick,
  Monitor,
  Search,
  TrendCharts,
  User,
  VideoCamera,
} from '@element-plus/icons-vue'

/**
 * 运营中心不可关闭的菜单项（强制显示）。
 * 与运营中心 ops-center/backend/services/app_menu_service.py 的 FORCED_VISIBLE_KEYS 保持同步。
 */
export const SIDEBAR_FORCED_VISIBLE_KEYS = Object.freeze([
  'publish', // 发布
  'accounts', // 账号
  'create', // 视频创作
  'collection', // 采集
])

/** 菜单分组标识：primary = 一级导航（平铺）；more = 「更多」折叠菜单 */
export const SIDEBAR_GROUP_PRIMARY = 'primary'
export const SIDEBAR_GROUP_MORE = 'more'

/** 全部分组（顺序即页面渲染顺序） */
export const SIDEBAR_MENU_GROUPS = Object.freeze([
  SIDEBAR_GROUP_PRIMARY,
  SIDEBAR_GROUP_MORE,
])

/**
 * 菜单项定义。
 *
 * 字段说明：
 * - key           稳定标识，运营中心配置以此为主键；一旦发布不得改名（改名 = 旧配置失效）
 * - group         'primary' | 'more'
 * - labelI18nKey  vue-i18n key（zh/en 必须同时存在，由 CI check-locale-sync.js --keys 校验）
 * - to            vue-router 目标路径
 * - icon          @element-plus/icons-vue 图标组件
 */
export const SIDEBAR_MENU_DEFINITION = Object.freeze([
  // ── 一级导航（平铺）─────────────────────────────
  { key: 'home', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.home', to: '/', icon: HomeFilled },
  { key: 'publish', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.publish', to: '/publish/history', icon: VideoCamera },
  { key: 'accounts', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.accounts', to: '/accounts', icon: User },
  { key: 'dashboard', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.dashboard', to: '/dashboard', icon: DataAnalysis },
  { key: 'create', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.create', to: '/create', icon: VideoCamera },
  { key: 'collection', group: SIDEBAR_GROUP_PRIMARY, labelI18nKey: 'sidebar.nav.collection', to: '/collection', icon: Collection },

  // ── 「更多」折叠菜单 ────────────────────────────
  { key: 'monitor', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.monitor', to: '/monitor', icon: Monitor },
  { key: 'calendar', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.calendar', to: '/calendar', icon: Calendar },
  { key: 'comments', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.comments', to: '/comments', icon: ChatDotRound },
  { key: 'cloud-publish', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.cloudPublish', to: '/cloud-publish', icon: FolderOpened },
  { key: 'library', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.library', to: '/library', icon: FolderOpened },
  { key: 'keywords', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.keywords', to: '/keywords', icon: Search },
  { key: 'viral', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.viral', to: '/viral-analysis', icon: TrendCharts },
  { key: 'prompt-eval', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.promptEval', to: '/prompt-eval', icon: MagicStick },
  { key: 'rewrite', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.rewrite', to: '/rewrite', icon: MagicStick },
  { key: 'hot-topics', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'hotTopics.menuLabel', to: '/hot-topics', icon: TrendCharts },
  { key: 'model-providers', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'sidebar.nav.modelProviders', to: '/model-providers', icon: Cpu },
  { key: 'knowledge-base', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'knowledgeBase.title', to: '/knowledge-base', icon: Collection },
  { key: 'performance-insights', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'perfInsights.title', to: '/performance-insights', icon: TrendCharts },
  { key: 'member-center', group: SIDEBAR_GROUP_MORE, labelI18nKey: 'memberCenter.menuEntry', to: '/member-center', icon: User },
])

/** 全部菜单项 key（顺序即定义顺序） */
export const SIDEBAR_MENU_KEYS = Object.freeze(SIDEBAR_MENU_DEFINITION.map((item) => item.key))

/** 按分组取出定义（保持定义顺序） */
export function sidebarDefinitionByGroup (group) {
  return SIDEBAR_MENU_DEFINITION.filter((item) => item.group === group)
}

/** 是否为强制显示项 */
export function isForcedVisibleKey (key) {
  return SIDEBAR_FORCED_VISIBLE_KEYS.includes(key)
}
