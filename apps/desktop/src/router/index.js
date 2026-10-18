import { shallowRef } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { reportError } from '../utils/report-error'

export const routeLoadError = shallowRef(null)

export function clearRouteLoadError() {
  routeLoadError.value = null
}

export function setRouteLoadError(error, to) {
  const message = error?.message || String(error)
  routeLoadError.value = {
    title: '页面加载失败',
    message: '页面资源没有成功加载，请重试。',
    details: to?.fullPath ? `${to.fullPath}: ${message}` : message,
    path: to?.fullPath || '',
    errorMessage: message,
  }
}

const routes = [
  { path: '/', name: 'Home', component: () => import('@/views/Home.vue') },
  { path: '/comments', name: 'Comments', component: () => import('@/views/Comments.vue') },
  { path: '/first-run', name: 'FirstRun', component: () => import('@/views/FirstRun.vue') },
  { path: '/publish', name: 'Publish', component: () => import('@/views/Publish.vue') },
  { path: '/publish/history', name: 'PublishHistory', component: () => import('@/views/PublishHistory.vue') },
  { path: '/accounts', name: 'Accounts', component: () => import('@/views/Accounts.vue') },
  { path: '/dashboard', name: 'Dashboard', component: () => import('@/views/Dashboard.vue') },
  { path: '/collection', name: 'Collection', component: () => import('@/views/Collection.vue') },
  { path: '/automation', name: 'Automation', component: () => import('@/views/AutomationView.vue') },
  { path: '/copy-library', name: 'CopyLibrary', component: () => import('@/views/CopyLibraryView.vue') },
  { path: '/keywords', name: 'Keywords', component: () => import('@/views/KeywordMonitorView.vue') },
  { path: '/viral-analysis', name: 'ViralAnalysis', component: () => import('@/views/ViralAnalysis.vue') },
  { path: '/providers', redirect: '/model-providers' },
  { path: '/model-providers', name: 'ModelProviders', component: () => import('@/views/ModelProviders.vue') },
  { path: '/create', name: 'Create', component: () => import('@/views/CreateView.vue') },
  { path: '/member-center', name: 'MemberCenter', component: () => import('@/views/MemberCenter.vue') },
  { path: '/create/pipeline', redirect: '/create' },
  { path: '/create/result', name: 'CreateResult', component: () => import('@/views/ResultView.vue') },
  // 历史记录统一收敛到「视频创作」页的历史记录标签（/create?view=history），旧独立页地址做重定向
  { path: '/create/history', redirect: '/create?view=history' },
  { path: '/cloud-publish', name: 'CloudPublish', component: () => import('@/views/CloudPublish.vue') },
  { path: '/intelligence', name: 'Intelligence', component: () => import('@/views/Intelligence.vue') },
  { path: '/calendar', name: 'Calendar', component: () => import('@/views/Calendar.vue') },
  { path: '/library', name: 'ProjectLibrary', component: () => import('@/views/ProjectLibrary.vue') },
  { path: '/board/:projectId', name: 'ProductionBoard', component: () => import('@/views/ProductionBoard.vue') },
  { path: '/board/:projectId/contact-sheet', name: 'ContactSheetView', component: () => import('@/views/ContactSheetView.vue') },
  { path: '/replay/:projectId', name: 'ReplayTimeline', component: () => import('@/views/ReplayTimeline.vue') },
  { path: '/prompt-eval', name: 'PromptEval', component: () => import('@/views/PromptEvalView.vue') },
  { path: '/video-clone', name: 'VideoClone', component: () => import('@/views/VideoCloneView.vue') },
  { path: '/film-engineering', name: 'FilmEngineering', component: () => import('@/views/FilmEngineeringHubView.vue') },
  { path: '/film-engineering/classic', name: 'FilmEngineeringClassic', component: () => import('@/views/FilmEngineeringView.vue') },
  { path: '/auto-pipeline', name: 'AutoPipeline', component: () => import('@/views/AutoPipelineView.vue') },
  { path: '/knowledge-base', name: 'KnowledgeBase', component: () => import('@/views/KnowledgeBasePage.vue') },
  { path: '/performance-insights', name: 'PerformanceInsights', component: () => import('@/views/PerformanceInsights.vue') },
  { path: '/rewrite', name: 'Rewrite', component: () => import('@/views/RewriteView.vue') },
  { path: '/hot-topics', name: 'HotTopics', component: () => import('@/views/HotTopics.vue') },
  { path: '/podcast', name: 'PodcastChannel', component: () => import('@/views/PodcastChannelView.vue') },
  // catch-all（UX-AUDIT-2026-10-17 阶段 1.9）：此前无兜底，访问 `#/typo` 时 router-view
  // 匹配不到组件 ⇒ 整页空白且无提示，用户无法区分"应用坏了"与"地址写错了"。
  // 必须放在最后：vue-router 4 按注册顺序匹配，但 * 的优先级最低，位置只影响可读性。
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFound.vue') },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.onError((error, to) => {
  reportError('[Router Load Error] ' + (error?.message || String(error)) + ' ' + (to?.fullPath || ''))
  setRouteLoadError(error, to)
})

export default router
