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
// 高级感视觉层（ui-visual-premium）：必须排在 cohere-design-system.css 之后，
// 同特异性下靠后者胜出；它统一「所有页面都会遇到」的表面与细节观感。
// 组件口径（卡片/按钮/输入/徽章/统计卡）单独一层，便于与「类名契约」分离演进。
import './styles/premium-components.css'
import './styles/premium-design-system.css'
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
// ux-audit-dead-components-retire：`LoadingState` 曾在此全局注册，但全仓 `<LoadingState>` 用法为 0
// （grep 实测），且组件自身的测试是**自己 mount 它**——于是它在界面上永不可达，
// 却每次启动都占一份全局注册与打包体积。骨架屏实际由 EmptyState / UiSkeleton 承担。
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
