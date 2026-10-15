import { createApp } from 'vue'
import { createPinia } from 'pinia'
import elementPlusOnDemand from './plugins/element-plus'
import './styles/tokens.css'
import './styles/cohere-design-system.css'
import './styles/ep-theme.css'
import './styles/video-creation-tokens.css'
import './styles/video-creation-buttons.css'
import './styles/video-creation-forms.css'
import './styles/video-creation-shared.css'
import './styles/skeleton.css'
import './styles/member-center.css'
import App from './App.vue'
import i18n from './i18n'
import router from './router'
import { reportError } from './utils/report-error'
import { getApi } from './api/electron-bridge'
import { onRiskHold, onProgress } from './api/publisher'
import { createRiskHoldNotifier } from './services/risk-hold-notifier'
import { createFailureDraftSaver } from './services/publish-failure-draft-saver'
import { useRiskStore } from './stores/risk'
import { useNotify } from './composables/useNotify'
import EmptyState from './components/EmptyState.vue'
import LoadingState from './components/LoadingState.vue'
import UiSkeleton from './components/UiSkeleton.vue'

const app = createApp(App)

// 全局 Vue 错误处理器 — 捕获组件渲染/事件处理中的未处理错误
app.config.errorHandler = (err, instance, info) => {
  const msg = `[Vue Error] ${info}: ${err?.message || err}`
  console.error(msg)
  console.error(err)
  try {
    const api = getApi()
    if (api?.logError) {
      api.logError(msg)
    }
  } catch (_) {}
}
window.addEventListener('error', (e) => {
  if (e.message && !e.message.includes('[Vue Error]')) {
    reportError('[Global Error]', e.message)
  }
})
window.addEventListener('unhandledrejection', (e) => {
  reportError('[Unhandled Rejection]', e.reason?.message || e.reason)
})

app.use(createPinia())
app.use(router)
app.use(i18n)
// element-plus 按需装配（fix-newtab-home-slow）：全量引入会把 124 个组件
// 全部打进首屏 bundle（实测 index.js 1.84MB / index.css 503KB），
// 而本仓只用 36 个。清单与理由见 ./plugins/element-plus.js。
app.use(elementPlusOnDemand)
app.component('EmptyState', EmptyState)
app.component('LoadingState', LoadingState)
app.component('UiSkeleton', UiSkeleton)
app.mount('#app')

// W1 §6.1 风控挂起通知消费端：主进程 publish:risk-hold → 渲染层统一通知通道。
// 仅信息提示（不宣称已自动挂起队列 / 自动恢复）；真正的挂起守卫由 §5 后续切片承担。
try {
  const { notifyWarning, notifyConfirm } = useNotify()
  createRiskHoldNotifier({
    onRiskHold,
    notify: (event) => notifyWarning('publish.riskHold.body', {
      params: { platform: event.platform || '' },
      module: 'publish',
    }),
  }).start()
  // W1 §5 enforcement：订阅权威挂起清单（publish:risk-suspended），供账号页徽标 + 恢复入口。
  // 被动广播只做信息提示；恢复由 RiskSuspendedBanner 主动触发（经 tracker.confirm 人工确认，绝不自动恢复）。
  try {
    useRiskStore().start({
      confirm: (info) => notifyConfirm('publish.riskHold.resumeConfirm', {
        params: { platform: (info && info.platform) || '' },
        module: 'publish',
      }),
      notify: (event) => {
        if (event && event.kind === 'suspended') {
          const first = (event.suspended || [])[0]
          notifyWarning('publish.riskHold.suspended', {
            params: { count: event.count || 0, platform: first ? (first.platform || '') : '' },
            module: 'publish',
          })
        }
      },
    })
  } catch (_) { /* 挂起态接线失败不影响主流程 */ }
  // publish-fail-draft-guard：发布失败自动存草稿的一次性 toast 提示。
  // 写入与去重真源都在主进程（draftSave 内容指纹幂等 + task:failed 自动回存）；
  // 本订阅只消费 failed 边界做提示（同 taskId 一次），不承载进度状态。
  try {
    const { notifyInfo } = useNotify()
    createFailureDraftSaver({
      onProgress,
      notify: () => notifyInfo('publish.failureDraftSaved', { module: 'publish' }),
    }).start()
  } catch (_) { /* 失败存草稿提示接线失败不影响主流程 */ }
} catch (_) { /* 通知接线失败不影响主流程 */ }
