/**
 * AppMenu 保存结果的提示装配（2026-10-17）— 纯函数，便于单测。
 *
 * 从 AppMenu.vue 的 saveAll 里抽出：.vue 单文件在 node 环境无法直接 import，
 * 而「保存成功后该说什么」是有契约的（PRD C2/C3/C4），必须可测。
 * 组件只负责调 ElMessage，措辞与分支在这里定。
 *
 * PRD：ops-center/docs/PRD-ops-center-restart-hint.md
 */
import { RESTART_HINT, RESTART_HINT_DURATION, shouldShowRestartHint } from '../constants/runtime-delivery'

/**
 * 按保存结果弹出对应提示。
 *
 * @param {{ok: boolean, count?: number, corrections?: string[], detail?: string}} result
 * @param {{success: Function, warning: Function, error: Function}} ElMessage
 * @param {string} [prefix] 成功时的前缀动作名（如「已恢复默认」）；省略则用「已保存 N 项」
 * @returns {'success'|'warning'|'error'|'none'} 实际走了哪条分支（便于测试断言）
 */
export function saveMessageFor (result, ElMessage, prefix) {
  if (!shouldShowRestartHint(result)) {
    ElMessage.error(result && result.detail ? result.detail : '保存失败')
    return 'error'
  }

  const corrections = Array.isArray(result.corrections) ? result.corrections : []
  const opts = { duration: RESTART_HINT_DURATION }

  if (corrections.length) {
    ElMessage.warning(
      (prefix || '已保存') + '。以下核心入口被系统纠正为「显示在一级导航」：' + corrections.join('、')
        + '；' + RESTART_HINT,
      opts,
    )
    return 'warning'
  }

  const head = prefix || ('已保存 ' + (result.count ?? 0) + ' 项')
  ElMessage.success(head + '；' + RESTART_HINT, opts)
  return 'success'
}
