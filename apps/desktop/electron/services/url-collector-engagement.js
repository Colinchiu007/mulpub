// @ts-check
/**
 * URL Collector 互动计数解析（viral-library-integration P0 契约核心）
 *
 * 独立模块：从 url-collector.js 拆出（单一契约落点 + 主采集器保持在债务熔断
 * 500 行预算内）。契约：字段级 null = 页面未知（跳过统计分子分母）；
 * 0 = 真实零互动（如实参与，会拉低均值）——绝不猜测填 0，否则爆款分析均值
 * （engagement 0.35 + interaction 0.25 权重）会被缺数条目稀释。
 *
 * 文件位置: apps/desktop/electron/services/url-collector-engagement.js
 */
'use strict'

/**
 * 互动计数字符串 → 非负整数。
 * 支持「1.2万 / 3.4w / 1,234 / 纯数字」；负数/NaN/非数字/超 MAX_SAFE 一律 null。
 * @param {string|number|null|undefined} v
 * @returns {number|null}
 */
function parseEngagementNumber (v) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) return null
    return v
  }
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/,/g, '')
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([万wW])?$/)
  if (!m) return null
  const mult = m[2] === '万' || m[2] === 'w' || m[2] === 'W' ? 10000 : 1
  const val = Number(m[1]) * mult
  if (!Number.isInteger(val) || val < 0 || val > Number.MAX_SAFE_INTEGER) return null
  return val
}

/**
 * 从已加载 DOM + 原始 HTML 提取互动计数（多来源逐级回退，全部失败 → 字段级 null）。
 * 来源优先级：JSON-LD（schema.org 标准）→ 平台内联 JSON（小红书 interactInfo /
 * B站 stat）→ 知乎 VoteButton DOM（stealth 浏览器渲染后可见）。
 * fail-open：任何解析异常不影响采集主结果（调用方拿到 null 字段即"未知"）。
 * @param {object} $ - cheerio 实例
 * @param {string} html - 原始 HTML
 * @returns {{ likes: number|null, comments: number|null }}
 */
function parseEngagement ($, html) {
  let likes = null
  let comments = null
  try {
    // 1) JSON-LD interactionStatistic（标准来源，命中站点最多）
    $('script[type="application/ld+json"]').each((_, el) => {
      if (likes !== null && comments !== null) return
      try {
        const data = JSON.parse($(el).html() || '')
        const stat = data && data.interactionStatistic
        const arr = Array.isArray(stat) ? stat : (stat ? [stat] : [])
        for (const st of arr) {
          const type = String((st && st.interactionType) || '')
          const cnt = parseEngagementNumber(st && st.userInteractionCount)
          if (cnt === null) continue
          if (/LikeAction/i.test(type) && likes === null) likes = cnt
          else if (/CommentAction/i.test(type) && comments === null) comments = cnt
        }
      } catch { /* 非法 JSON-LD：跳过该块（fail-open 测试锁） */ }
    })
    // 2) 平台内联 JSON 正则（字符串/数值两种形态）
    if (likes === null) {
      const m1 = html.match(/"likedCount"\s*:\s*"?([0-9.,]+[万wW]?)"?/)
      if (m1) likes = parseEngagementNumber(m1[1])
      else {
        const m2 = html.match(/"like"\s*:\s*(\d+)/)
        if (m2) likes = parseEngagementNumber(m2[1])
      }
    }
    if (comments === null) {
      const m3 = html.match(/"commentCount"\s*:\s*"?([0-9.,]+[万wW]?)"?/)
      if (m3) comments = parseEngagementNumber(m3[1])
      else {
        const m4 = html.match(/"reply"\s*:\s*(\d+)/)
        if (m4) comments = parseEngagementNumber(m4[1])
      }
    }
    // 3) 知乎回答/文章 DOM 计数（浏览器模式下 VoteButton 已渲染）
    if (likes === null) {
      const $vote = $('.VoteButton .CountNumber').first()
      if ($vote.length) {
        const parsed = parseEngagementNumber($vote.text())
        if (parsed !== null) likes = parsed
      }
    }
  } catch { /* 防御兜底：解析器整体不破坏采集 */ }
  return { likes, comments }
}

module.exports = { parseEngagement, parseEngagementNumber }
