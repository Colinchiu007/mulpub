/**
 * 改写引擎业务错误 → 渲染层统一错误形状。
 *
 * 引擎（packages/rewrite-engine）的业务失败返回 `{ success:false, error, errorCode }`，
 * IPC 信封把它包在 `{ code:0, data:{...} }` 里。采集页漏斗此前把**整个信封**透传给
 * formatUserError，而后者只读顶层 `errorCode` / `message` ⇒ 具体原因全部丢失，只剩兜底
 * 「AI 改写失败」（2026-10-19 实测：知乎正文 6766 字 > 引擎 6000 上限，用户只看到这句话）。
 *
 * 本模块只做「字段位置归一化 + 稳定码映射」；文案仍由 locales/user-errors 提供。
 */
import { REWRITE_ENGINE_MAX_INPUT_CHARS } from './rewrite-engine-limits'

// 引擎错误码 → 渲染层稳定文案码。未登记的码保留原值：formatUserError 对未知码会
// 透传引擎的自然语言 message（中文），也比笼统兜底更可诊断。
const ENGINE_ERROR_CODE_MAP = Object.freeze({
  TOO_LONG: 'REWRITE_CONTENT_TOO_LONG',
  SENSITIVE_CONTENT: 'REWRITE_CONTENT_SENSITIVE',
  EMPTY_RESULT: 'AGGREGATION_REWRITE_FAILED',
  LLM_ERROR: 'AGGREGATION_REWRITE_FAILED',
  NO_LLM_CLIENT: 'LLM_NOT_CONFIGURED',
  EMPTY_CONTENT: 'AGGREGATION_CONTENT_EMPTY',
})

/**
 * 把 `{ code:0, data:{ success:false, error, errorCode } }` 归一化为
 * formatUserError 可消费的 `{ code, errorCode, message, params }`。
 * @param {object} res - aiRewrite 的完整 IPC 信封
 * @returns {{ code: number, errorCode: string, message: string, params: object }}
 */
export function normalizeRewriteEngineError (res) {
  const data = (res && res.data && typeof res.data === 'object') ? res.data : {}
  const rawCode = typeof data.errorCode === 'string' ? data.errorCode : ''
  return {
    code: res && res.code != null ? res.code : -99,
    errorCode: ENGINE_ERROR_CODE_MAP[rawCode] || rawCode,
    message: typeof data.error === 'string' ? data.error : '',
    // TOO_LONG 的 locale 文案含 {max} 占位符；缺参数时 formatUserError 会原样留下 {max}
    params: rawCode === 'TOO_LONG' ? { max: REWRITE_ENGINE_MAX_INPUT_CHARS } : {},
  }
}
