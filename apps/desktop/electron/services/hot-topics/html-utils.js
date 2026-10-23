/**
 * HTML 文本处理工具（自 channels.js 拆出）
 *
 * 拆出的理由：本文件随渠道解析器一同增长，触发 `NEW_OVER_LIMIT`
 * （新代码不得引入 >= 500 行的超大文件，判据见 .github/scripts/check-max-lines.js）。
 * 这四个函数是**纯文本处理**，与渠道语义无关 ⇒ 单独成模块。
 * 函数体逐字搬移，行为不变。
 */

const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')

// extractLinks 用到它（安全 URL 判据收敛到共享单一实现）
const sanitizeUrl = safeHttpUrl

/** HTML 实体解码（百度/tophub HTML 渠道用） */

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** 剥掉 HTML 标签并解码实体，只留纯文本（行内 span 是强调标记，直接拼接不留空格） */
function stripTags (html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]*>/g, '')).trim()
}

/**
 * 抽取「由多个 `<span>` 组成的字段」并归一成 `A · B`。
 * `item-meta` 三 span 间无空白，`stripTags` 会得 `A·B`，而旧版 `dateline` 是 `A · B`
 * —— 同一语义两种口径，故逐 span 取文本再拼。
 * 不能让 `stripTags` 也加空格：标题 `<span>摩根大通</span>封禁…` 是行内强调，
 * 加空格会变成「摩根大通 封禁…」—— 是错的。
 */
function stripTagsJoined (html) {
  const parts = String(html || '').split(/<span[^>]*>|<\/span>/i)
  return parts
    .map(p => decodeHtmlEntities(p.replace(/<[^>]*>/g, '')).trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}

/** 抽取一段 HTML 里全部 `<a href="...">` 的安全 URL（过滤 javascript: 等非 http(s) 协议） */
function extractLinks (html) {
  const urls = []
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi
  let m
  while ((m = re.exec(html))) {
    const safe = sanitizeUrl(m[1])
    if (safe && !urls.includes(safe)) urls.push(safe)
  }
  return urls
}

module.exports = {
  decodeHtmlEntities,
  stripTags,
  stripTagsJoined,
  extractLinks,
}
