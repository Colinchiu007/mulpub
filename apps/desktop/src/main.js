import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { QuillEditor } from '@vueup/vue-quill'
import '@vueup/vue-quill/dist/vue-quill.snow.css'
import './styles/tokens.css'
import './styles/cohere-design-system.css'
import './styles/ep-theme.css'
import './styles/video-creation-tokens.css'
import './styles/video-creation-buttons.css'
import './styles/video-creation-forms.css'
import './styles/video-creation-shared.css'
import './styles/skeleton.css'
import App from './App.vue'
import i18n from './i18n'
import router from './router'
import { reportError } from './utils/report-error'
import { getApi } from './api/electron-bridge'
import { onRiskHold } from './api/publisher'
import { createRiskHoldNotifier } from './services/risk-hold-notifier'
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
app.use(ElementPlus)
app.component('QuillEditor', QuillEditor)
app.component('EmptyState', EmptyState)
app.component('LoadingState', LoadingState)
app.component('UiSkeleton', UiSkeleton)
app.mount('#app')

// W1 §6.1 风控挂起通知消费端：主进程 publish:risk-hold → 渲染层统一通知通道。
// 仅信息提示（不宣称已自动挂起队列 / 自动恢复）；真正的挂起守卫由 §5 后续切片承担。
try {
  const { notifyWarning } = useNotify()
  createRiskHoldNotifier({
    onRiskHold,
    notify: (event) => notifyWarning('publish.riskHold.body', {
      params: { platform: event.platform || '' },
      module: 'publish',
    }),
  }).start()
} catch (_) { /* 通知接线失败不影响主流程 */ }
