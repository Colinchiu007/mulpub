'use strict'
/**
 * account-avatar-guard.js — 「平台品牌图」判据（单一数据源）
 *
 * 存在理由（PRD-ACCOUNT-PROFILE-AVATAR-2026-10-22，2026-10-22 生产实测）：
 * 账号卡上出现过**平台 logo** 被当成用户头像。根因有两处，都在这里被封死：
 *
 *  1. **DOM 采集器的兜底链末端抓了 `meta[property="og:image"]`**。og:image 是
 *     **站点级**的品牌图（今日头条创作后台的 og:image = `obj/mp/logo-toutiao.png`），
 *     与「这是谁的账号」毫无关系 —— 落盘后它就成了该账号的头像，且因为
 *     `buildProfilePatch` 的「值不变就不写」语义，再也不会被正确值覆盖。
 *     （本轮已把 og:image 从采集器里移除；本模块是第二道防线。）
 *  2. **DOM 里第一个匹配 `[class*="avatar"]` 的元素未必是用户头像**：平台 SPA 的
 *     导航栏/侧边栏常有品牌头像或运营位图片。
 *
 * 判定口径（刻意保守）：
 * - 只判**站点品牌资产**（logo / favicon / brand 这类文件名形态）；
 * - **不判**「平台默认头像」（如 B 站 `noface.jpg`、小红书默认头像）—— 那是该账号
 *   真实在用的头像（用户没设头像），展示它比展示空白更接近平台真实形态；
 * - 判不出来一律**不判**（宁可不判，也不误杀真头像）。
 *
 * 与「昵称噪声守卫」（account-name-guard）同型：采集端与展示端共用同一份判定，
 * 禁止出现第二份映射。
 */

/**
 * 站点品牌资产的文件名形态。
 * 只认**路径里的独立文件名段**（`logo.png` / `logo-toutiao.png` / `favicon.ico`），
 * 不认域名片段（`logo.example.com` 之类的用户头像 CDN 完全合法）。
 *
 * 允许的前缀是**封闭词表**而不是任意前缀：`catalog.png` 这类普通词里恰好含 "logo"
 * 的文件名必须放行（误判品牌图 = 误杀真头像，比漏判更糟），所以只认
 * site/web/app/default/placeholder/official 这些**站点语义明确**的词，
 * 以及「任意词 + 连字符」这一形态（`brand-logo.svg`）。
 */
const BRAND_ASSET_FILE_RE = /(?:^|[/\\])(?:(?:site|web|app|default|placeholder|official)[-_]?)?(?:[a-z0-9]+[-_])?(?:logo|favicon|brand)(?:[-_.][a-z0-9_-]+)*\.(?:png|jpe?g|gif|webp|svg|ico)(?:[?#].*)?$/i

/**
 * 已知平台把品牌图放在**非文件名形态**路径下的情形（实测值）。
 * 命中即判品牌图。
 */
const BRAND_ASSET_PATH_PATTERNS = [
  /\/obj\/mp\/logo[-\w]*\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i, // 今日头条创作后台
]

/**
 * 判定一个头像候选值是不是「站点品牌图」。
 * @param {unknown} url
 * @returns {boolean}
 */
function isBrandImageUrl (url) {
  if (typeof url !== 'string') return false
  const value = url.trim()
  if (!value) return false
  // 非 URL 形态（相对路径、data:、纯文本）不做判定：判错会误伤真头像
  if (!/^https?:\/\//i.test(value)) return false
  let pathname = value
  try {
    pathname = new URL(value).pathname
  } catch (_) {
    // URL 解析失败 → 不判
    return false
  }
  if (BRAND_ASSET_PATH_PATTERNS.some(re => re.test(pathname))) return true
  return BRAND_ASSET_FILE_RE.test(pathname)
}

/**
 * 从候选列表里剔除品牌图，保留其余（保持原顺序）。
 * 全部被剔除时返回空数组 —— 调用方据此「不产出头像」，而不是退回第一张品牌图。
 * @param {unknown[]} candidates
 * @returns {string[]}
 */
function filterBrandImageUrls (candidates) {
  if (!Array.isArray(candidates)) return []
  return candidates
    .filter(c => typeof c === 'string' && c.trim())
    .map(c => c.trim())
    .filter(c => !isBrandImageUrl(c))
}

module.exports = {
  isBrandImageUrl,
  filterBrandImageUrls,
  BRAND_ASSET_FILE_RE,
  BRAND_ASSET_PATH_PATTERNS,
}
