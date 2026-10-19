/**
 * publish-confirm-summary — 发布前摘要的结构化口径（阶段 2.6 / audit-1）
 *
 * 只做「数到什么」，不做「怎么说」：文案一律由调用方经 locales 解析
 * （渲染端 src 目录下非 locales 文件不得新增中文字面量，CI Gate 7 + CJK 基线扫描）。
 * 因此 `resolve` 由调用方注入：`(key, params, fallback) => string`，未命中必须回空串。
 *
 * 计数口径（不可含糊）：
 * - `platformCount`：**去重后**的平台数；
 * - `targetCount`：去重后的 (平台, 账号) 目标数 —— 同一账号发到两个平台算两个目标，
 *   同平台两个账号也算两个。缺 `accountId` 的目标归到 `__default__`，不静默丢弃；
 * - `platforms`：逐平台明细（含该平台的去重账号数），顺序为首次出现顺序（渲染稳定）。
 */

const DEFAULT_ACCOUNT_KEY = '__default__'

export function summarizePublishTargets (targets) {
  const order = []
  const byPlatform = new Map()
  for (const target of Array.isArray(targets) ? targets : []) {
    const platform = target && typeof target.platform === 'string' ? target.platform.trim() : ''
    if (!platform) continue
    const account = target && target.accountId ? String(target.accountId) : DEFAULT_ACCOUNT_KEY
    if (!byPlatform.has(platform)) {
      byPlatform.set(platform, new Set())
      order.push(platform)
    }
    byPlatform.get(platform).add(account)
  }
  let targetCount = 0
  const platforms = order.map((platform) => {
    const accounts = byPlatform.get(platform).size
    targetCount += accounts
    return { platform, accounts }
  })
  return { platformCount: platforms.length, targetCount, platforms }
}

/**
 * @param {{targets: Array<object>, truncationCount?: number, articleCount?: number,
 *          labelFor?: (id: string) => string,
 *          resolve: (key: string, params: object, fallback: string) => string}} options
 * @returns {{text: string, failed: boolean, summary: object}}
 *   `text` 为空串时调用方**必须跳过闸门**（解析失败不得把发布堵死），
 *   并同时置 `failed = true` 让上层出声。
 */
export function buildPublishSummaryMessage (options) {
  const {
    targets,
    truncationCount = 0,
    articleCount = 1,
    labelFor = (id) => id,
    resolve
  } = options || {}
  const summary = summarizePublishTargets(targets)
  const head = resolve('publishPage.publishFlow.confirmSummary', {
    articles: articleCount,
    platforms: summary.platformCount,
    targets: summary.targetCount
  }, '')
  if (!head) return { text: '', failed: true, summary }

  const detailText = summary.platforms
    .map((p) => `${labelFor(p.platform)} × ${p.accounts}`)
    // 分隔符用中点而不是顿号：顿号是 CJK 字符，会让本文件被「渲染端 src 不得新增中文字面量」
    // 的门禁点名（文案归 locales 管，代码里只留结构与计数）。
    .join(' · ')
  const detail = detailText
    ? resolve('publishPage.publishFlow.confirmDetail', { detail: detailText }, '')
    : ''
  const truncation = truncationCount > 0
    ? resolve('publishPage.publishFlow.confirmTruncated', { count: truncationCount }, '')
    : ''
  return { text: [head, detail, truncation].filter(Boolean).join('\n'), failed: false, summary }
}
