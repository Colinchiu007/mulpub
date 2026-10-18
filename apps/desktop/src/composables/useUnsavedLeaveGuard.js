import { onBeforeUnmount, onMounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { confirmDanger } from '@/utils/confirm-danger'
import i18n from '@/i18n'

const t = (key, params) => i18n.global.t(key, params)

/**
 * 未保存离开守卫（UX-AUDIT-2026-10-17 阶段 0.5 / audit-3）
 *
 * 覆盖 audit-3 收敛后的成立范围：**不在 `App.vue` keep-alive include 里的编辑态页面**。
 * Publish 页不在范围内 —— `<keep-alive :include="['Publish']">` 已让它在路由切换时保活
 * （锁在 `publish-draft-keepalive.test.js`），给它挂守卫是防一个不会发生的丢失。
 * 谁在范围内由 `src/unsaved-leave-contract.test.js` 逐视图枚举，不许凭印象加。
 *
 * 两条出口都要守：
 *  ① 路由切换 —— `onBeforeRouteLeave`，弹应用内确认（复用统一确认原语，不自造弹窗）
 *  ② 关闭/刷新应用 —— `beforeunload`；浏览器/Electron 在这一层**只允许原生提示**，
 *     setPromptText 在 Chromium 已被忽略，因此只能给「存在未保存内容」的粗粒度信号。
 *
 * @param {{ isDirty: () => boolean, subject?: () => string }} options
 *        isDirty 必须由调用方给出**内容级**判据（有未保存的用户输入），
 *        不得传恒真/恒假 —— 恒真会把每次导航都变成一次打扰，恒假等于没挂。
 */
export function useUnsavedLeaveGuard (options) {
  const { isDirty, subject } = options || {}
  if (typeof isDirty !== 'function') {
    throw new Error('useUnsavedLeaveGuard: isDirty 必须是函数')
  }

  const onBeforeUnload = (event) => {
    if (!isDirty()) return
    event.preventDefault()
    // Electron/Chromium 要求给 returnValue 赋值才认为需要拦截
    event.returnValue = true
    return true
  }

  onMounted(() => {
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload)
  })

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload)
  })

  onBeforeRouteLeave(async () => {
    if (!isDirty()) return true
    const what = subject ? subject() : ''
    return confirmDanger({
      title: t('common.unsavedLeaveTitle'),
      message: what
        ? t('common.unsavedLeaveMessageWithSubject', { subject: what })
        : t('common.unsavedLeaveMessage'),
    })
  })
}
