/**
 * 改写取消通道（composable）——rewrite-cancel-and-truncation-summary。
 *
 * 为什么独立：`RewriteView.vue` 已接近 max-lines 登记容差；取消逻辑（runId 生命周期 /
 * 请求发出 / 取消中态）与视图的渲染职责无关，且采集页等其它入口将来也能复用。
 *
 * 语义边界（务必保持）：
 * - **协作式**：主进程只置标记，引擎在**下一个片段开始前**检查到才停。in-flight HTTP
 *   不中断（中断需给全部 LLM 调用加信号通路，proposal §2.1 明确不做）。
 *   因此 UI 必须如实说「当前片段完成后停止」，不得暗示立即中止。
 * - **不复位改写中态**：真正停下由改写 promise 结算（含 CANCELLED 分支）驱动。
 *   提前复位会让用户以为已停而重复点开始，而旧请求仍在跑。
 */
import { ref } from 'vue'
import { aiRewriteCancel } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'

/**
 * 生成改写 runId（取消通道寻址键）。
 * 优先 crypto.randomUUID；不可用时退化为时间戳+随机。唯一性只要求
 * 「同一窗口内不复用」，不承担跨端全局唯一语义。
 */
function newRunId () {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* 降级到时间戳 */ }
  return `rw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * @returns {{
 *   activeRunId: import('vue').Ref<string|null>,
 *   cancelling: import('vue').Ref<boolean>,
 *   beginRun: () => string,
 *   cancel: () => Promise<void>,
 *   endRun: () => void,
 * }}
 */
export function useRewriteCancel () {
  const { notifyInfo } = useNotify()
  const activeRunId = ref(null)
  const cancelling = ref(false)

  /** 开始一次改写：生成新 runId（不复用旧 id，避免误取消上一次）并复位取消态 */
  function beginRun () {
    activeRunId.value = newRunId()
    cancelling.value = false
    return activeRunId.value
  }

  /** 改写结算（成功/失败/取消均走）：清 runId 与取消态 */
  function endRun () {
    activeRunId.value = null
    cancelling.value = false
  }

  /**
   * 请求取消。未命中（已结束/非本人）不改状态，让改写 promise 的自然结算收尾。
   */
  async function cancel () {
    if (cancelling.value || !activeRunId.value) return
    cancelling.value = true
    try {
      const res = await aiRewriteCancel(activeRunId.value)
      if (!(res && res.code === 0 && res.data && res.data.cancelled === true)) {
        cancelling.value = false
        return
      }
      // 即时反馈 + 如实说明延迟：不给这条提示，用户会反复点并以为按钮坏了
      notifyInfo('rewritePage.cancellingHint')
    } catch {
      cancelling.value = false
    }
  }

  return { activeRunId, cancelling, beginRun, cancel, endRun }
}
