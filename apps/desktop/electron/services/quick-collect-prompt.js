// @ts-check
/**
 * quick-collect-prompt — 提示词组装与「无素材声明行」
 *
 * 两条硬约束：
 *   ① **指令逐字透传**：用户写的快捷采集内容就是提示词本身（PRD §6.3），不得被模板改写、
 *      不得被拼接进别的语义（否则"我的指令"与"实际发出去的指令"不再一致）；
 *   ② **声明行由引擎插入，不交给模型**：无素材时模型可能漏写、含糊写或干脆编，
 *      因此"本次未检索到素材"这句话由代码生成；同时若模型自己已经说了同类的话，
 *      不重复插入（避免正文出现两遍声明）。
 */
const { MATERIAL_LIMIT } = require('./quick-collect-materials')

/** 模型侧硬约束（system） */
const SYSTEM_PROMPT = [
  '你是一名内容情报分析师，服务于内容创作者。',
  '你的输出将被直接当作一篇「采集到的素材」存进用户的采集库，并可能被继续改写发布。',
  '',
  '硬约束（任何情况下不得违反）：',
  '1. 只允许使用「素材清单」中出现的事实（事件、版本号、时间、名称、链接）。清单里没有的，一律不得编造、不得推测、不得用训练数据里的旧信息填补。',
  '2. 需要给出「来源链接」时，只能使用素材清单里给出的链接原文，不得改写、不得拼接、不得自己拼一个 URL。',
  '3. 素材不足以支撑结论时，必须明确说明缺什么（例如"清单中缺少官方公告，无法确认发布时间"），而不是给出看似确定的结论。',
  '4. 严格按用户指令要求的格式输出；用户未指定格式时，用小标题 + 短段落 + 列表，不要长篇铺陈。',
  '5. 用简体中文输出。不要写"作为 AI""以下是""希望对你有所帮助"这类套话，不要输出免责声明，不要重复用户指令。',
].join('\n')

/**
 * 组装一次调用所需的 messages 与采样参数。
 * @param {object} command 归一后的指令
 * @param {object[]} materials mergeMaterials 的输出
 * @returns {{ messages: Array<{role: string, content: string}>, temperature: number, max_tokens: number }}
 */
function buildMessages (command, materials) {
  const list = Array.isArray(materials) ? materials : []
  const windowHours = Number(command && command.windowHours) || 0
  const windowText = windowHours > 0 ? `最近 ${windowHours} 小时` : '不限时间'

  const user = [
    '【指令】',
    String((command && command.prompt) || ''),
    '',
    '【素材清单】',
    list.length ? list.map((m, i) => formatMaterialLine(m, i)).join('\n') : '（本次未获得素材）',
    '',
    '【输出要求】',
    `- 素材时间范围：${windowText}；可用素材条数：${list.length}（上限 ${MATERIAL_LIMIT}）。`,
    '- 若指令要求「来源链接」，用素材清单里的链接；没有对应链接的条目就不要给链接。',
    list.length === 0
      ? '- 本次没有任何可核对素材：不要输出任何具体事件/版本/时间，只按指令如实说明"没有检索到素材"，并给出用户下一步可以怎么做（例如补充检索关键词）。'
      : '- 素材与指令主题无关时，如实说明"检索到的素材与主题不相关"，不要强行凑结论。',
  ].join('\n')

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: 1600,
  }
}

/**
 * 素材清单里的一行。时间按 UTC+8 渲染（用户在国内，UTC 时间会读成"昨天"）。
 * @param {object} m
 * @param {number} index 0-based
 */
function formatMaterialLine (m, index) {
  const parts = [`${index + 1}. ${m.title}`]
  if (m.source) parts.push(`来源=${m.source}`)
  if (m.createdUtc) parts.push(`时间=${formatUtc8(m.createdUtc)}`)
  parts.push(`链接=${m.url}`)
  if (m.engagement) parts.push(`热度=${m.engagement}`)
  if (m.snippet) parts.push(`摘要=${m.snippet}`)
  return parts.join(' | ')
}

/** epoch 秒 → `YYYY-MM-DD HH:mm`（UTC+8，零依赖） */
function formatUtc8 (seconds) {
  const ms = Number(seconds) * 1000
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/**
 * 引擎侧的声明行。`retrieval` 为 `empty` / `skipped` 时正文首行必须带上它。
 * @param {{ windowHours?: number }} command
 * @param {'ok'|'partial'|'empty'|'skipped'} retrieval
 * @returns {string} 空串表示不需要声明行
 */
function buildDisclaimerLine (command, retrieval) {
  const windowHours = Number(command && command.windowHours) || 0
  if (retrieval === 'skipped') {
    return '> 本指令未配置检索关键词，以下内容未联网检索，可能不含最新动态。'
  }
  if (retrieval === 'empty') {
    return windowHours > 0
      ? `> 本次未检索到最近 ${windowHours} 小时内的可核对素材，以下内容未包含联网事实。`
      : '> 本次未检索到可核对的素材，以下内容未包含联网事实。'
  }
  return ''
}

/**
 * 模型正文是否已自述"没检索到 / 没联网"。
 * 命中即不再插入声明行（否则正文会出现两遍同类声明）。
 * @param {string} content
 */
function shouldPrependDisclaimer (content) {
  const text = String(content || '')
  return !/未检索到|没有检索到|未联网|没有联网|未能获取|无法获取|无可用素材|没有可用素材/.test(text)
}

module.exports = {
  SYSTEM_PROMPT,
  buildMessages,
  formatMaterialLine,
  formatUtc8,
  buildDisclaimerLine,
  shouldPrependDisclaimer,
}
