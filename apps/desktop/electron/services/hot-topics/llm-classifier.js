// @ts-check
/**
 * 热门选题 LLM 分类兜底（方案C）— 主进程 ModelProviderManager 适配器
 *
 * 契约：createLlmTopicClassifier({ modelProviderManager, log })
 *   → async (topics: string[]) => { [选题文本]: 10分类枚举 }
 *
 * fail-open 语义：未配置默认 llm provider / 调用异常 / 输出不可解析 → 返回 {}，
 * 由 HotTopicsService._applyLlmLabels 保持关键词分类结果（静默降级，不抛出）。
 */

const { CATEGORY_KEYS } = require('./classifier')

const BATCH_LIMIT = 40
const TOPIC_TEXT_LIMIT = 200

/**
 * @param {{ modelProviderManager?: object, log?: { info: Function, warn: Function, error: Function } }} opts
 */
function createLlmTopicClassifier({ modelProviderManager, log } = {}) {
  const logger = log || { info: () => {}, warn: () => {}, error: () => {} }

  return async function llmClassify(topics) {
    const list = (Array.isArray(topics) ? topics : [])
      .slice(0, BATCH_LIMIT)
      .map(t => String(t || '').slice(0, TOPIC_TEXT_LIMIT).trim())
      .filter(Boolean)
    if (!list.length) return {}
    try {
      if (!modelProviderManager ||
          typeof modelProviderManager.getDefault !== 'function' ||
          typeof modelProviderManager.callAdapter !== 'function') {
        return {}
      }
      const provider = modelProviderManager.getDefault('llm')
      const providerId = provider && typeof provider.id === 'string' && provider.id ? provider.id : null
      if (!providerId) return {}
      const prompt =
        '你是中文内容分类器。请将下列每条选题各归入一个类别，可选类别（英文键）：' +
        CATEGORY_KEYS.join(', ') +
        '。只能使用上述英文键作为值；无法判断时归入 general。' +
        '只输出一个 JSON 对象：键为选题序号（字符串，从0开始），值为类别英文键。' +
        '示例：{"0":"tech","1":"general"}\n选题：\n' +
        list.map((t, i) => i + '. ' + t).join('\n')
      const data = await modelProviderManager.callAdapter(providerId, 'chatCompletion', {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 800,
      })
      const text = (data && (data.content || data.text || (data.message && data.message.content))) || ''
      const m = String(text).match(/\{[\s\S]*\}/)
      if (!m) return {}
      const parsed = JSON.parse(m[0])
      /** @type {Record<string, string>} */
      const out = {}
      for (const [k, v] of Object.entries(parsed || {})) {
        const idx = Number(k)
        const label = String(v || '').trim()
        if (Number.isInteger(idx) && idx >= 0 && idx < list.length && CATEGORY_KEYS.includes(label)) {
          out[list[idx]] = label
        }
      }
      return out
    } catch (e) {
      logger.warn('[hot-topics] llm classifier unavailable: ' + (e && e.message ? e.message : String(e)))
      return {}
    }
  }
}

module.exports = { createLlmTopicClassifier, BATCH_LIMIT }
