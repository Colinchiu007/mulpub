'use strict'
/**
 * llm-call — explainer 阶段调用默认 LLM 的**唯一实现**
 *
 * ## 为什么抽出来
 *
 * ① **单一真源**：`callDefaultLlm` 同时被 **scenes 阶段**（留在 `explainer-stages.js`）与
 *    **research / proposal / script 三阶段**（搬到 `explainer-preprod-stages.js`）使用
 *    ⇒ 两边各自写一份就是「两份真源」，改一处忘另一处 ⇒ 行为漂移。
 * ② **行为不变**：本模块是**从原 `explainer-stages.js` 原样搬出**的（语义一字未改）——
 *    包括「配置/能力类错误直接抛出不重试、其它错误与空内容才重试」这条规则。
 *    ⚠ 搬迁时若顺手「优化」重试逻辑 ⇒ 既有测试（`callDefaultLlm 配置错误不重试直接失败`）会红
 *    ⇒ **改契约时不要顺手改无关行为**。
 *
 * ## 关键语义（勿动）
 *
 * - 参数名是 **`max_tokens`**（不是 `maxTokens`），`temperature: 0.7`
 * - messages 形状是 `[{role:'system'}, {role:'user'}]`（**system 在 messages 里**）
 * - 无默认 LLM 配置 ⇒ 抛「未找到需要的相关模型，请在设置中添加模型」
 * - 重试：默认最多 2 次额外重试（上限 4）；**仅**空内容与瞬时错误重试，
 *   错误信息命中 `/未找到|不可用|没有配置|No configured|No adapter|not configured|配置|requires/i`
 *   ⇒ 判定为配置/能力类问题 ⇒ **直接抛出，不重试**
 */

function getDefaultLlmConfig (aiGenerator) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const provider = manager && typeof manager.getDefault === 'function'
    ? manager.getDefault('llm')
    : null
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  const model = Array.isArray(provider.models)
    ? provider.models.find(item => typeof item === 'string' && item.trim())
    : null
  return model ? { providerId: provider.id.trim(), model: model.trim() } : null
}

async function callDefaultLlm (aiGenerator, systemPrompt, userContent, maxTokens, options = {}) {
  if (!aiGenerator || typeof aiGenerator.generateWithDefault !== 'function') {
    throw new Error('默认 LLM 不可用，请先完成模型设置')
  }
  if (!getDefaultLlmConfig(aiGenerator)) {
    throw new Error('未找到需要的相关模型，请在设置中添加模型')
  }
  // 有界重试（2026-08-11 E2E 复盘）：LLM 偶发返回空内容/瞬时错误会让
  // research/proposal/script/scenes 整线失败。默认最多 2 次额外重试，
  // 仅对空内容与可判定为瞬时的错误重试；配置/模型缺失等直接抛出。
  const maxAttempts = Math.max(1, Math.min(Number(options.retries) || 2, 4))
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await aiGenerator.generateWithDefault('llm', {
        temperature: 0.7,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : 1600,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      })
      const content = result && typeof result.content === 'string' ? result.content.trim() : ''
      if (content) return content
      lastError = new Error('默认 LLM 返回空内容')
    } catch (error) {
      lastError = error
      const message = error && error.message ? String(error.message) : String(error)
      // 配置/能力类错误不是瞬时问题，直接抛出不重试
      if (/未找到|不可用|没有配置|No configured|No adapter|not configured|配置|requires/i.test(message)) throw error
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500 * attempt))
    }
  }
  throw lastError
}

module.exports = {
  getDefaultLlmConfig,
  callDefaultLlm,
}
