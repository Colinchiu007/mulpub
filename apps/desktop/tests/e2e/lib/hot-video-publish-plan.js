/**
 * hot-video-publish-plan —— 热门选题一键生成视频 E2E 的发布计划纯函数
 *
 * 把「已生成实际视频的热门选题」转换为 publish:batch IPC 所需的
 * targets（平台账号目标）与 article（文章载荷），供
 * tests/e2e/hot-topics-one-click-video-driver.js 的发布阶段使用。
 *
 * 约定（与 electron/ipc-handlers/publish.js publish:batch 对齐）：
 *   - targets: [{ platform, accountId }]，platform 须为 isSafePathSegment
 *   - article: { title, content, video_path, cover_path?, tags }
 *   - 「能发的都发」：凡 status=active（或 is_active）且 has_cookies!==false
 *     的账号全部纳入，同平台多账号不去重。
 */

const DEFAULT_MAX_TITLE_LENGTH = 60

function isUsableAccount(account) {
  if (!account || typeof account !== 'object') return false
  const active = account.status === 'active' || account.is_active === true
  const hasCreds = account.has_cookies !== false
  return Boolean(active && hasCreds && account.platform && account.id)
}

/**
 * @param {Array} accounts accounts:list 返回的账号数组
 * @param {{onlyPlatforms?: string[]}} [options] 可选平台白名单
 * @returns {Array<{platform: string, accountId: string}>}
 */
function buildPublishTargets(accounts, options = {}) {
  if (!Array.isArray(accounts)) return []
  const allow = Array.isArray(options.onlyPlatforms) && options.onlyPlatforms.length > 0
    ? new Set(options.onlyPlatforms)
    : null
  const targets = []
  for (const account of accounts) {
    if (!isUsableAccount(account)) continue
    if (allow && !allow.has(account.platform)) continue
    targets.push({ platform: account.platform, accountId: account.id })
  }
  return targets
}

/**
 * @param {{topic: {title?: string, summary?: string}, rewrittenText?: string,
 *          videoPath?: string, coverPath?: string, tags?: string[],
 *          maxTitleLength?: number}} input
 * @returns {{title: string, content: string, video_path: string, cover_path?: string, tags: string[]}}
 */
function buildPublishArticle(input = {}) {
  const { topic = {}, rewrittenText, videoPath, coverPath, tags, maxTitleLength } = input
  const rawTitle = String(topic.title || '').trim()
  if (!rawTitle) {
    throw new Error('buildPublishArticle: 缺少标题（topic.title 为空）')
  }
  if (!videoPath || typeof videoPath !== 'string') {
    throw new Error('buildPublishArticle: 缺少 video_path（无实际视频产物不得发布）')
  }
  const limit = maxTitleLength > 0 ? maxTitleLength : DEFAULT_MAX_TITLE_LENGTH
  const title = rawTitle.length > limit ? rawTitle.slice(0, limit) : rawTitle
  const content = String(rewrittenText || topic.summary || topic.title || '').trim()
  const article = {
    title,
    content,
    video_path: videoPath,
    tags: Array.isArray(tags) ? tags : [],
  }
  if (coverPath) article.cover_path = coverPath
  return article
}

/**
 * @returns {{targets: Array, article: Object}}
 * @throws {Error} 无可用发布目标时抛 NO_PUBLISH_TARGETS
 */
function buildPublishPlan(input = {}) {
  const targets = buildPublishTargets(input.accounts, input.options || {})
  if (targets.length === 0) {
    throw new Error('NO_PUBLISH_TARGETS: 没有可发布的 active 且带凭证的账号')
  }
  const article = buildPublishArticle(input)
  return { targets, article }
}

/**
 * 从流水线 run context（pipelineGetRunContext().data.context）提取改写全文。
 * 优先 scene_context.scenes[0].context.full_text（scene_context 阶段固化的原始
 * 全文）；缺失时回退拼接 split.scenes[].text。都拿不到返回 ''（发布层再回退）。
 * @param {Object|null} context
 * @returns {string}
 */
function extractStoryText(context) {
  if (!context || typeof context !== 'object') return ''
  const sc = context.scene_context
  const fullText = sc && Array.isArray(sc.scenes) && sc.scenes[0] &&
    sc.scenes[0].context && typeof sc.scenes[0].context.full_text === 'string'
    ? sc.scenes[0].context.full_text.trim()
    : ''
  if (fullText) return fullText
  const split = context.split
  if (split && Array.isArray(split.scenes)) {
    return split.scenes.map((s) => (s && typeof s.text === 'string' ? s.text : '')).join('').trim()
  }
  return ''
}

module.exports = {
  DEFAULT_MAX_TITLE_LENGTH,
  buildPublishTargets,
  buildPublishArticle,
  buildPublishPlan,
  extractStoryText,
}
