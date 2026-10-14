/**
 * useCardsRender — 图文卡片分页渲染的交互状态机（P2-5 第二批）
 *
 * 形态照 `useQuickCollectCommands`：ref 状态 + computed + async function +
 * try/catch/finally + `res.code === 0` 判成功。
 *
 * ★ 三条硬契约（P2-5 规格）：
 *
 * 1. **warnings 非空即必须可见**（规格「失败面」条）。
 *    分页器的 `item-exceeds-page` / `page-limit-reached` 意味着用户的文本
 *    超出一页或触达页数上限 —— 用户必须知情，**不得静默丢弃**。
 *    故 warnings 是独立 ref，不由 `failed` 派生。
 *
 * 2. **失败必须点名原因**，不得只写「生成失败」。
 *    主进程侧已保证：入参非法 → `VALIDATION_ERROR` + 具体 message；
 *    页数不符 → 整体失败且**不返回部分产物**。
 *    这里只做「领域码 → locale 键」的映射，不改写原因。
 *
 * 3. **「暂不可用」与「渲染失败」必须可区分**。
 *    桥接层的 fallback 是 `{ code: -1, message: 'CARDS_IPC_UNAVAILABLE' }`；
 *    若把它和 `REQUEST_ERROR` 混成一句「生成失败」，用户无法判断该重试还是该报障。
 */
import { ref, computed } from 'vue'
import { cardsRender } from '@/api/cards'

/** 领域码 → locale 键（文案集中在 locales/cards/*，不在此处拼句子） */
const CODE_TO_KEY = {
  CARDS_IPC_UNAVAILABLE: 'failedService',
}

export function useCardsRender () {
  /** @type {import('vue').Ref<boolean>} 是否正在渲染（入口按钮 loading + 进度条可见性） */
  const rendering = ref(false)
  /** @type {import('vue').Ref<string[]>} 成功时的 PNG 路径数组 */
  const resultFiles = ref([])
  /** @type {import('vue').Ref<string[]>} 分页器 warnings（**非空即必须展示**） */
  const warnings = ref([])
  /** @type {import('vue').Ref<{ key: string, vars?: object } | null>} 失败信息（locale 键 + 插值变量） */
  const failure = ref(null)

  const hasResult = computed(() => resultFiles.value.length > 0)
  const hasWarnings = computed(() => warnings.value.length > 0)
  const failed = computed(() => failure.value !== null)

  /** 重置到初始态（入口按钮的「重新生成」/ 关闭结果区时调用） */
  function reset () {
    rendering.value = false
    resultFiles.value = []
    warnings.value = []
    failure.value = null
  }

  /**
   * 把主进程返回的失败信封映射成 locale 键 + 插值变量。
   *
   * ★ 不在这里拼中文句子 —— 文案集中在 `locales/cards/*`，按 `t()` 取。
   *   本函数只决定「用哪条键、代入哪些变量」。
   */
  function mapFailure (res) {
    if (!res) return { key: 'failedUnknown', vars: { message: '' } }
    if (res.message && CODE_TO_KEY[res.message]) return { key: CODE_TO_KEY[res.message] }
    if (typeof res.code === 'number' && res.code === -2) {
      return { key: 'failedValidation', vars: { message: res.message || '' } }
    }
    if (typeof res.message === 'string' && res.message.includes('渲染页数不符')) {
      // 主进程的 message 形如「渲染页数不符（期望 2，实得 1）」
      const m = res.message.match(/期望\s*(\d+).*实得\s*(\d+)/)
      return {
        key: 'failedCount',
        vars: { expected: m ? m[1] : '?', actual: m ? m[2] : '?' },
      }
    }
    return { key: 'failedUnknown', vars: { message: res.message || '' } }
  }

  /**
   * 执行渲染。
   *
   * @param {object} payload
   * @param {string[][]} payload.pages 分页结果（每页是块数组）
   * @param {number} [payload.widthPx]
   * @param {number} [payload.heightPx]
   * @returns {Promise<boolean>} 是否成功（调用方可据此决定是否展示结果区）
   */
  async function render (payload) {
    rendering.value = true
    failure.value = null
    resultFiles.value = []
    warnings.value = []
    try {
      const res = await cardsRender(payload)
      const ok = res && res.code === 0 && Array.isArray(res.data)
      if (!ok) {
        failure.value = mapFailure(res)
        return false
      }
      resultFiles.value = res.data
      // ★ warnings 必须透出：主进程给了就不能在这儿丢掉
      warnings.value = Array.isArray(res.warnings) ? res.warnings.slice() : []
      return true
    } catch (e) {
      // 桥接层只对「权限不足」兜底，其余错误照原样抛出 —— 这里接住并映射成文案
      failure.value = { key: 'failedUnknown', vars: { message: (e && e.message) || String(e) } }
      return false
    } finally {
      rendering.value = false
    }
  }

  return {
    rendering,
    resultFiles,
    warnings,
    failure,
    hasResult,
    hasWarnings,
    failed,
    reset,
    render,
  }
}
