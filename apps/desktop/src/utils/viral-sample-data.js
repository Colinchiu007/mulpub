// @ts-check
/**
 * viral-sample-data — 爆款分析「手动输入文章数据」示例构造器
 *
 * 为什么单独成模块（而不是留在 ViralAnalysis.vue）：
 * 1. 视图文件已逼近债务熔断线（FILES_OVER_1000），示例数据这类纯逻辑必须外置；
 * 2. 示例 JSON 同时被两处消费——输入框 placeholder（ViralManualDataInput）与
 *    「填入示例数据」按钮（父视图 fillSampleData），单一来源避免两边漂移。
 *
 * locale 陷阱（2026-09-21 复盘）：vue-i18n 会把文案里的 `{}` 当插值语法吞掉，
 * 因此 locale 只存管道分隔的标题列表（manualDataSampleTitles），花括号结构在
 * 此处组装，不得把整段 JSON 写入 locale 文件。
 */

/** 示例点赞数（3 篇循环取值，数值区间贴近真实中小账号数据） */
const SAMPLE_LIKES = [12800, 8600, 23500]
/** 示例评论数 */
const SAMPLE_COMMENTS = [960, 420, 1780]
/** 示例平台码（与发布平台 code 对齐） */
const SAMPLE_PLATFORMS = ['xiaohongshu', 'xiaohongshu', 'douyin']

/**
 * 由 locale 标题列表构造示例文章数组。
 * @param {unknown} titlesRaw `manualDataSampleTitles` 文案（`|` 分隔）
 * @returns {Array<{title: string, like_count: number, comment_count: number, platform_code: string}>}
 *          非字符串或空输入返回 []（调用方据此隐藏示例能力，不抛错）
 */
export function buildViralSampleArticles (titlesRaw) {
  if (typeof titlesRaw !== 'string') return []
  const titles = titlesRaw
    .split('|')
    .map(s => s.trim())
    .filter(Boolean)
  if (!titles.length) return []
  return titles.map((title, i) => ({
    title,
    like_count: SAMPLE_LIKES[i % SAMPLE_LIKES.length],
    comment_count: SAMPLE_COMMENTS[i % SAMPLE_COMMENTS.length],
    platform_code: SAMPLE_PLATFORMS[i % SAMPLE_PLATFORMS.length],
  }))
}

/**
 * 示例文章的可读 JSON（2 空格缩进，供 textarea placeholder 与一键填入共用）。
 * @param {unknown} titlesRaw `manualDataSampleTitles` 文案（`|` 分隔；非字符串按空处理）
 * @returns {string} 无有效标题时返回空串（textarea 回落为无 placeholder）
 */
export function buildViralSampleJson (titlesRaw) {
  const articles = buildViralSampleArticles(titlesRaw)
  return articles.length ? JSON.stringify(articles, null, 2) : ''
}
