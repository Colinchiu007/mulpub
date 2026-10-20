/**
 * llm-result.js — llmClient.chat 返回值归一化（rewrite-segment-and-finish-reason 第一刀）
 *
 * 背景：finish_reason 透传（模型侧输出截断可见化）要求 chat 能返回
 * `{text, finishReason}`；但既有实现（主进程 rewrite-engine.js 内置 chatClient、
 * 第三方注入 llmClient、测试 mock）返回 string。两形态并存的窗口期，
 * 所有消费方必须经本函数归一化后再取 `.text`。
 *
 * 消费方（两处，都容易踩坑）：
 *   1. RewriteEngine.rewrite —— 主链路，归一化后判空（EMPTY_RESULT）；
 *   2. extractWithLLM（keyword-extractor.js）—— 关键词兜底，历史上对非 string
 *      fail-open 静默返回 []；不归一化会让「chat 改返回 object」这件事
 *      静默杀死关键词兜底且无任何报错。
 */

/**
 * 把 llmClient.chat 的返回值归一化为 {text, finishReason}。
 *
 * @param {unknown} raw - chat 返回值：string（旧）或 {text, finishReason}（新）
 * @returns {{text: string, finishReason: string|null}}
 */
function normalizeChatResult (raw) {
  if (typeof raw === 'string') {
    return { text: raw, finishReason: null }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const text = typeof raw.text === 'string' ? raw.text : String(raw.text ?? '')
    const finishReason = typeof raw.finishReason === 'string' ? raw.finishReason : null
    return { text, finishReason }
  }
  return { text: '', finishReason: null }
}

/**
 * provider 的 finish_reason / stop_reason 是否表示「输出被上限截断」。
 * OpenAI 系 finish_reason=length；Anthropic 系 stop_reason=max_tokens
 * （anthropic.js 已在 adapter 层归一出 finish_reason 字段）。
 *
 * @param {unknown} reason
 * @returns {boolean}
 */
function isTruncatedFinishReason (reason) {
  return reason === 'length' || reason === 'max_tokens'
}

module.exports = { normalizeChatResult, isTruncatedFinishReason }
