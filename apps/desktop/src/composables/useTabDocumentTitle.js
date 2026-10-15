/**
 * useTabDocumentTitle — home-shell SPA 页面标题 → document.title → 标签栏标题链路
 *
 * 背景（2026-10-03 Bug 修复）：「+」新标签（home-shell 标签，内嵌本应用独立 SPA 实例）
 * 此前标题恒为「新标签页」：App.vue 创建时传入锁定 title，主进程 titleLocked=true 后
 * page-title-updated 永远被忽略；且 SPA 从不更新 document.title，即使不锁定也没有
 * 新标题可上报。本 composable 补齐「路由 → 页面标题」这一环：
 *
 *   路由变化 → resolveRouteTabTitle（路由登记表映射 i18n 文案）→
 *   document.title 同步（Electron 将其作为 page-title-updated 事件上报主进程）→
 *   主进程更新 _tabStates.title → tab-title-updated 广播 → TabBar/NavBar 实时刷新。
 *
 * IPC 上报（pageManager.reportTabTitle）是显式兜底：真实 Electron 中 page-title-updated
 * 由 Chromium 在 document.title 变化时自动触发，本可依赖；但显式上报让主进程无需依赖
 * 该事件时序（如 title 被锁定后手动解锁重发），也让非 Electron 环境（纯浏览器调试）
 * 天然降级为只改 document.title、不发 IPC。
 *
 * 调用方：App.vue（isHomeShell 分支内 start()，onBeforeUnmount stop()）。
 * 外层主窗口实例（非 home-shell）不启动本 composable——其标题栏由 OS 窗口标题承担。
 */
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import i18n from '@/i18n'
import { invokePageManager } from '@/api/electron-bridge'

/**
 * 内部路由 path → tab 标题 i18n 键映射。
 *
 * 键与 src/config/route-registry.js 登记的路由 path 对齐（含 :param 前缀路由）。
 * 文案复用侧边栏既有条目（sidebar.nav.*），页面级标题优先（页面无独立标题键时回退）。
 * 新增路由必须在 resolveRouteTabTitle 的判定或本表中补齐，否则回退品牌名。
 */
const ROUTE_TITLE_KEYS = [
  // 精确 path（与 route-registry.js 顺序一致）
  ['/', 'sidebar.nav.home'],
  ['/comments', 'sidebar.nav.comments'],
  ['/publish', 'nav.publish'],
  ['/publish/history', 'historyPage.pageTitle'],
  ['/accounts', 'sidebar.nav.accounts'],
  ['/dashboard', 'sidebar.nav.dashboard'],
  ['/collection', 'sidebar.nav.collection'],
  ['/automation', 'sidebar.nav.automation'],
  ['/copy-library', 'sidebar.nav.copyLibrary'],
  ['/keywords', 'sidebar.nav.keywords'],
  ['/viral-analysis', 'sidebar.nav.viral'],
  ['/model-providers', 'sidebar.nav.modelProviders'],
  ['/create', 'sidebar.nav.create'],
  ['/member-center', 'memberCenter.menuEntry'],
  ['/cloud-publish', 'sidebar.nav.cloudPublish'],
  ['/intelligence', 'intelligence.trendingTitle'],
  ['/calendar', 'sidebar.nav.calendar'],
  ['/library', 'sidebar.nav.library'],
  ['/prompt-eval', 'sidebar.nav.promptEval'],
  ['/knowledge-base', 'knowledgeBase.title'],
  ['/performance-insights', 'perfInsights.title'],
  ['/rewrite', 'sidebar.nav.rewrite'],
  ['/hot-topics', 'hotTopics.menuLabel'],
  ['/film-engineering', 'tabs.filmEngineering'],
  ['/auto-pipeline', 'autoPipeline.title'],
  ['/podcast', 'podcast.pageTitle'],
]

/** :param 前缀路由（startsWith 判定；独立表避免 '/' 精确键误入前缀匹配）。
 *  值为字符串 = 前缀内任意页面；值为 { suffix, key } = 仅前缀后以 suffix 结尾的子路由。 */
const ROUTE_PREFIX_KEYS = [
  ['/board/', 'tabs.productionBoard'],
  ['/board/', { suffix: '/contact-sheet', key: 'tabs.contactSheet' }],
  ['/replay/', 'tabs.replayTimeline'],
]

/** 前缀根列表（供覆盖度测试与调用方判定「该 path 是否由前缀条目承担」） */
export const ROUTE_PREFIX_ROOTS = [...new Set(ROUTE_PREFIX_KEYS.map(([p]) => p))]

/**
 * path → i18n 键 的派生表（模块级一次性构建：精确表 + 前缀根条目；
 * contact-sheet 子路由条目以 "/board//contact-sheet" 复合键登记供排查，
 * 运行时查找真源是 resolveRouteTabTitle 的判定逻辑，本表仅供测试与排查）。
 */
export const ROUTE_TAB_TITLES = new Map()
for (const [p, key] of ROUTE_TITLE_KEYS) ROUTE_TAB_TITLES.set(p, key)
for (const [p, target] of ROUTE_PREFIX_KEYS) {
  const lookupKey = typeof target === 'object' ? p + target.suffix : p
  const displayKey = typeof target === 'object' ? target.key : target
  ROUTE_TAB_TITLES.set(lookupKey, displayKey)
}

/**
 * 解析路由 path → 标签标题文案（纯函数，可在任意上下文调用）。
 * @param {string|null} path route.path 或 route.fullPath（query 与 hash 会被剥离）
 * @returns {string} 标题文案；未命中回退品牌名「汤姆鱼」
 */
export function resolveRouteTabTitle (path) {
  // i18n.global.t：组件上下文外可用的全局翻译入口（本项目 legacy:false 模式）
  const t = (key) => i18n.global.t(key)
  if (typeof path !== 'string' || !path) return t('tabs.brandTitle')
  const clean = path.split('#')[0].split('?')[0]
  // 1. 精确命中
  const exact = ROUTE_TAB_TITLES.get(clean)
  if (exact) return t(exact)
  // 2. :param 前缀命中（board/:projectId 及其子路由）——只查独立前缀表，
  //    精确表里的 '/' 键 endsWith('/') 恒真，混入会把所有未知路径误判成主页。
  //    suffix 子路由（如 /board/:id/contact-sheet）按「最长前缀 + 后缀段」优先。
  let best = null
  for (const [p, target] of ROUTE_PREFIX_KEYS) {
    if (!clean.startsWith(p)) continue
    if (typeof target === 'object') {
      const rest = clean.slice(p.length)
      if (rest.endsWith(target.suffix)) {
        if (!best || best.rank < 2) best = { key: target.key, rank: 2 }
        continue
      }
      continue
    }
    if (!best || best.rank < 1) best = { key: target, rank: 1 }
  }
  if (best) return t(best.key)
  // 3. 回退品牌名
  return t('tabs.brandTitle')
}

/**
 * 启动路由 → 标题同步（home-shell 实例专用）。
 * @returns {{ stop: () => void }}
 */
export function useTabDocumentTitle () {
  const route = useRoute()
  let stopWatch = null

  const reportTitle = (path) => {
    try {
      const title = resolveRouteTabTitle(path)
      // ① document.title 同步：真实 Electron 中触发 page-title-updated 事件链
      document.title = title
      // ② 显式 IPC 上报：主进程不依赖事件时序，直接更新 _tabStates.title 并广播。
      //    promise 必须 .catch 兜底——try/catch 拦不住异步 rejection，页面关闭时
      //    IPC 在途 reject 会成为 unhandled rejection（QM-6 评审 MAJOR；同族事故
      //    先例：tab-lifecycle.js loadURL 未 catch 致头条事故日志外溢）。
      const reported = invokePageManager('reportTabTitle', title)
      if (reported && typeof reported.catch === 'function') reported.catch(() => {})
    } catch (_) {
      // 标题同步失败绝不影响页面功能（纯展示性数据）
    }
  }

  const start = () => {
    // 防重入：重复 start 不得注册多个 watch（stop 只能解绑最后一个）
    stop()
    reportTitle(route.fullPath)
    stopWatch = watch(
      // 语言切换时同样重报标题（否则 TabBar 残留旧语言文案直到下次导航）
      () => [route.fullPath, i18n.global.locale.value],
      () => reportTitle(route.fullPath),
    )
  }

  const stop = () => {
    if (typeof stopWatch === 'function') stopWatch()
    stopWatch = null
  }

  return { start, stop }
}
