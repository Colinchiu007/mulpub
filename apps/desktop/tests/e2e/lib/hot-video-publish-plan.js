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

const SENTENCE_BREAK_RE = /[。！？!?；;\n]/

/**
 * 判断一个字符串是否「像人类写的标题」，用于排除 slug / 引擎标识符
 * （如字幕分段引擎 smart-sentence-splitter）被误当作发布标题。
 * 规则：含 CJK 即可；纯 ASCII 必须是多词短语（带空格）且至少一个 3 字母词。
 * @param {unknown} value
 * @returns {boolean}
 */
function isHumanTitle(value) {
  const s = String(value === null || value === undefined ? '' : value).trim()
  if (s.length < 2 || s.length > 120) return false
  if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(s)) return true
  return /\s/.test(s) && /[a-z]{3,}/i.test(s)
}

/** 长文本判定：含句读或长度 >= 20 的「title」实际是正文片段。 */
function looksLikeBodyText(value) {
  const s = String(value || '').trim()
  return s.length >= 20 || SENTENCE_BREAK_RE.test(s)
}

/** 取 story2video 工程落盘清单里的改写全文。 */
function pickProjectText(manifest) {
  const direct = String(manifest.sourceText || manifest.source_text || '').trim()
  if (direct) return direct
  if (Array.isArray(manifest.segments)) {
    const joined = manifest.segments
      .map((s) => (s && typeof s.text === 'string' ? s.text.trim() : ''))
      .filter(Boolean)
      .join('')
    if (joined) return joined
  }
  return looksLikeBodyText(manifest.title) ? String(manifest.title).trim() : ''
}

/** 从正文首句派生发布标题（去句末标点、按上限截断）。 */
function deriveTitle(text, limit) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const first = s.split(SENTENCE_BREAK_RE).map((x) => x.trim()).find((x) => x.length > 0) || s
  const cut = first.length > limit ? first.slice(0, limit) : first
  return cut.replace(/[，,、；:：。.！!？?\s]+$/, '').trim()
}

/**
 * 从 story2video 落盘工程清单（project.json）恢复发布文案。
 *
 * 背景：pipeline 的 run context 只活在内存，应用重启即清零；而每个成片目录
 * 都有 manifestVersion=2 的 project.json。注意该清单的 title 字段被写成了
 * 「改写文案前 200 字」（正文片段，不是标题），必须与真正的选题标题区分：
 * 只接受 topicTitle / topic.title 等显式字段，且当它恰好是正文前缀时判为
 * 正文片段不予采用，改从正文首句派生。
 *
 * @param {Object|null} manifest project.json 解析结果
 * @param {{maxTitleLength?: number}} [options]
 * @returns {{title: string, text: string, titleSource: string}} 无有效内容时三者皆空
 */
function readProjectCaption(manifest, options = {}) {
  const empty = { title: '', text: '', titleSource: '' }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return empty
  const limit = options.maxTitleLength > 0 ? options.maxTitleLength : DEFAULT_MAX_TITLE_LENGTH
  const text = pickProjectText(manifest)
  const candidates = [
    manifest.topicTitle,
    manifest.topic_title,
    manifest.topic && manifest.topic.title,
    manifest.title,
  ]
  const explicit = candidates.find((v) => isHumanTitle(v) && !(text && text.startsWith(String(v).trim())))
  if (explicit) return { title: String(explicit).trim().slice(0, limit), text, titleSource: 'manifest' }
  const derived = deriveTitle(text || manifest.title, limit)
  return derived ? { title: derived, text, titleSource: 'derived' } : empty
}

module.exports = {
  DEFAULT_MAX_TITLE_LENGTH,
  buildPublishTargets,
  buildPublishArticle,
  buildPublishPlan,
  extractStoryText,
  isHumanTitle,
  readProjectCaption,
}

