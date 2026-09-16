// @ts-check
/**
 * rewrite-handoff — 「文案库 → 改写页」跳转交接
 *
 * 为什么走 sessionStorage 而不是 URL query：
 * 采集正文可能上万字，放进 query 有 URL 长度与转义风险；sessionStorage 一次性
 * 交接（读取即清除）配合 `/rewrite?from=collection` 标志，改写页挂载后取回
 * 内容并自动开始改写。
 *
 * 交接载荷字段：
 * - content   改写源正文（必填）
 * - title     源文案标题
 * - platform  目标平台（采集条目自带，可能为空）
 * - sourceUrl 原文链接（可能为空）
 * - fromKey   文案库回写键：`collect:<采集id>` / `rewrite:<改写记录id>`
 * - fromTitle 回写记录的「改写自」标题
 */

const REWRITE_HANDOFF_KEY = 'rewrite_handoff_v1'

/**
 * 写入交接载荷（一次性）。
 * @param {{ content: string, title?: string, platform?: string, sourceUrl?: string, fromKey?: string, fromTitle?: string }} payload
 * @returns {boolean} 写入成功返回 true；sessionStorage 不可用/超额时返回 false
 */
export function setRewriteHandoff (payload) {
  if (!payload || !String(payload.content || '').trim()) return false
  try {
    sessionStorage.setItem(REWRITE_HANDOFF_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/**
 * 取出并清除交接载荷（一次性语义：读后即焚，避免刷新页面重复自动改写）。
 * @returns {object|null} 载荷；不存在或解析失败返回 null
 */
export function takeRewriteHandoff () {
  try {
    const raw = sessionStorage.getItem(REWRITE_HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(REWRITE_HANDOFF_KEY)
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 供测试使用：清空交接键 */
export function clearRewriteHandoff () {
  try { sessionStorage.removeItem(REWRITE_HANDOFF_KEY) } catch { /* noop */ }
}
