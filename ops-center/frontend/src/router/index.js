import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/settings/SettingsView.vue'),
    meta: { requiresAuth: true },
  },

  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { guest: true },
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/scene-context-rules',
    name: 'SceneContextRules',
    component: () => import('../views/SceneContextRules.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/feature-flags',
    name: 'FeatureFlags',
    component: () => import('../views/FeatureFlags.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/projects',
    name: 'Projects',
    component: () => import('../views/Projects.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/secrets',
    name: 'Secrets',
    component: () => import('../views/Secrets.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/platforms',
    name: 'Platforms',
    component: () => import('../views/Platforms.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/usage',
    name: 'UsageDashboard',
    component: () => import('../views/UsageDashboard.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/diagnostics',
    name: 'Diagnostics',
    component: () => import('../views/Diagnostics.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/publish-dashboard',
    name: 'PublishDashboard',
    component: () => import('../views/PublishDashboard.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/system-health',
    name: 'SystemHealth',
    component: () => import('../views/SystemHealth.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/licenses',
    name: 'Licenses',
    component: () => import('../views/Licenses.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/keyword-watchlist',
    name: 'KeywordWatchlist',
    component: () => import('../views/KeywordWatchlist.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/pipeline-deps',
    name: 'PipelineDeps',
    component: () => import('../views/PipelineDeps.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/redemption-codes',
    name: 'RedemptionCodes',
    component: () => import('../views/RedemptionCodes.vue'),

    meta: { requiresAuth: true },
  },
  {
    path: '/announcements',
    name: 'Announcements',
    component: () => import('../views/Announcements.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/update-policy',
    name: 'UpdatePolicy',
    component: () => import('../views/UpdatePolicy.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/content-policy',
    name: 'ContentPolicy',
    component: () => import('../views/ContentPolicy.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/sensitive-rewrite-demo',
    name: 'SensitiveRewriteDemo',
    component: () => import('../views/SensitiveRewriteDemo.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/model-presets',
    name: 'ModelPresets',
    component: () => import('../views/ModelPresets.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/rate-limit-verifier',
    name: 'RateLimitVerifier',
    component: () => import('../views/RateLimitVerifier.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/platform-defs',
    name: 'PlatformDefs',
    component: () => import('../views/PlatformDefs.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/runtime-flags',
    name: 'RuntimeFlags',
    component: () => import('../views/RuntimeFlags.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/content-templates',
    name: 'ContentTemplates',
    component: () => import('../views/ContentTemplates.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/parameters',
    name: 'Parameters',
    component: () => import('../views/Parameters.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/snapshots',
    name: 'Snapshots',
    component: () => import('../views/Snapshots.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/env',
    name: 'EnvView',
    component: () => import('../views/EnvView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/audit-log',
    name: 'AuditLog',
    component: () => import('../views/AuditLog.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/feedback',
    name: 'UserFeedback',
    component: () => import('../views/UserFeedback.vue'),
    meta: { requiresAuth: true, adminOnly: true },
  },
  {
    path: '/prompt-eval-workbench',
    name: 'PromptEvalWorkbench',
    component: () => import('../views/PromptEvalWorkbench.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/model-keys',
    name: 'ModelKeys',
    component: () => import('../views/ModelKeys.vue'),
    meta: { requiresAuth: true, adminOnly: true },
  },
  {
    path: '/rewrite-strategies',
    name: 'RewriteStrategies',
    component: () => import('../views/RewriteStrategies.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/rewrite-hard-constraints',
    name: 'RewriteHardConstraints',
    component: () => import('../views/RewriteHardConstraints.vue'),
    meta: { requiresAuth: true, adminOnly: true },
  },
  {
    path: '/pipeline-options',
    name: 'PipelineOptions',
    component: () => import('../views/PipelineOptions.vue'),
    meta: { requiresAuth: true, adminOnly: true },
  },
  {
    path: '/app-menu',
    name: 'AppMenu',
    component: () => import('../views/AppMenu.vue'),
    // 写操作需管理员权限；页面与「选项控制」同口径限定 adminOnly
    meta: { requiresAuth: true, adminOnly: true },
  },
  {
    path: '/content-quality-eval',
    name: 'ContentQualityEval',
    component: () => import('../views/ContentQualityEval.vue'),
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // P1-15：会话凭据在 HttpOnly Cookie 中，前端无法本地判活，
  // 首个导航必须向后端探测一次（后续导航复用内存态，不重复请求）。
  if (!authStore.initialized) {
    await authStore.restore()
  }

  if (to.meta.requiresAuth && !authStore.isLoggedIn) {
    next('/login')
  } else if (to.meta.guest && authStore.isLoggedIn) {
    next('/')
  } else if (to.meta.adminOnly && authStore.role !== 'admin') {
    next('/')
  } else {
    next()
  }
})

export default router



