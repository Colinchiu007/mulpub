'use strict'
/**
 * account-name-guard.js — 账号昵称「噪声」判定（单一数据源）
 *
 * 存在理由（PRD-ACCOUNT-CARD-DISPLAY-FIX-2026-09-24）：
 * 早期 DOM 采集把「页面容器 textContent」和「页面标题」当成昵称写进 account_name，
 * 产出一批垃圾显示名，例如：
 *   - 快手：「0粉丝0关注0获赞账号认证退出登录…」（抓到了整块统计/会话区文本）
 *   - 抖音：「作品发布」、今日头条：「头条号」、百家号：「百家号」、
 *     视频号：「视频号助手」、B 站：「Bilibili 创作者中心」（全是页面标题/菜单名）
 * 采集端（account-profile）与展示端（AccountManagementCard）必须用同一份判定，
 * 否则口径漂移会重演。真实昵称（如「数字生命丘丘」）不得被误杀。
 *
 * 判定分两类，命中任一即视为噪声：
 * A. 枚举式（历史遗留，只覆盖已见过的形态）
 *    1) 会话/UI chrome 关键词：退出登录、创作者中心、发布记录等（昵称不会含这些）。
 *    2) 平台指标块文本：同串里出现 ≥2 个「粉丝/关注/获赞/关注者」计数词
 *       （「0粉丝0关注0获赞」即典型；单个「关注」不算，避免误杀含「关注」的真实昵称）。
 *    3) 已知页面标题精确命中（大小写/首尾空格无关）。
 * B. 结构化（2026-09-26 新增，可泛化到新平台/新文案）
 *    枚举黑名单是打地鼠：生产库 7 个账号里 6 个 account_name 是脏的，枚举只拦住了 1 个。
 *    下列五条按「垃圾文本的形态指纹」判定，不再依赖逐个列举：
 *    4) 站点 chrome 后缀：以「创作者服务平台 / 工作台 / 开放平台…」结尾 —— 这是页面名。
 *       只认结尾不认包含，避免误杀「XX工作室」这类真名。
 *    5) 指标量词：数字 + 量词 + 统计项（「485.9万人看过」「1.2万次阅读」）。
 *    6) 占位文案指纹：含省略号（「分享此刻的想法...同步到圈子发想法」）。
 *    7) 截断指纹：括号不闭合（「哔哩哔哩 (゜」来自把标题按首个连字符截断）。
 *    8) 标题形态指纹：空格包裹的分隔符（「头条号 - 个人中心」= 页面名 - 站点名）。
 *
 * 已知取舍：B4 的后缀规则会误杀「XX服务平台」这类品牌号真名。后果仅是卡片回落平台名
 * 且下次 HTTP 回填会用真昵称覆盖，不丢数据；与既有 NOISE_KEYWORDS 用 `includes('设置')`
 * `includes('首页')` 的宽松度同级，故按同一口径接受。
 */

// 会话入口 / 后台 chrome 关键词：出现在 account_name 里必为抓错容器或标题。
const NOISE_KEYWORDS = [
  '退出登录', '账号认证', '扫码登录', '请登录', '立即登录',
  '创作者中心', '创作中心', '数据中心', '发布记录', '作品管理',
  '内容管理', '首页', '设置', '提现', '收益'
]

// 平台指标计数词：命中 ≥2 个才判噪声（避免误杀含单个「关注/粉丝」的真实昵称）。
const METRIC_WORDS = ['粉丝', '获赞', '关注者', '粉丝数', '关注数']

// 已知「页面标题/菜单名」被误当昵称的精确集合（比较前小写去空格）。
const KNOWN_PAGE_TITLES = [
  '作品发布', '头条号', '百家号', '视频号助手', '视频号',
  'bilibili 创作者中心', 'bilibili', '哔哩哔哩', '哔哩哔哩创作中心',
  '微信公众号', '公众号', '大鱼号', '搜狐号', '网易号', '一点号',
  '爱奇艺号', '企鹅号', '网易订阅号'
]

// B4：以这些结尾的是「平台页面名」，不是账号名。
const CHROME_SUFFIXES = [
  '创作者中心', '创作者服务平台', '创作服务平台', '服务平台',
  '工作台', '管理后台', '开放平台', '数据中心'
]

// B5：数字 + 可选量词 + 统计项。刻意要求统计项成词，故「36氪」「1998年的夏天」不误杀。
const METRIC_PATTERNS = [
  /\d+(?:\.\d+)?\s*[万亿wk]?\s*(?:人看过|人观看|人浏览|次阅读|次播放|条评价|位粉丝|个粉丝)/i,
  /^\d+(?:\.\d+)?\s*[万亿wk]?\s*(?:粉丝|关注|获赞|播放|阅读|浏览|作品|动态|赞)$/i
]

// B6：输入框占位文案的指纹。
const ELLIPSIS_PATTERN = /\.{3}|…|。{2,}/

// B8：空格包裹的分隔符是「网页标题 = 页面名 - 站点名」的形态指纹。旧实现试图剥掉后缀
// 把标题救成昵称，而正则匹配的是第一个分隔符，于是真实 B 站标题
// 「哔哩哔哩 (゜-゜)つロ 干杯~-bilibili」被切成「哔哩哔哩 (゜」入库。整串不采纳才是正解。
// 只认「两侧都有空白」的包裹形态，故「A-B」「K-Line」「小·明」这类真实写法不误杀。
const TITLE_SEPARATOR_PATTERN = /\s[-–—|·]\s/

// B7：中英文括号种类一并计数，开合数量不等即视为被截断的片段。
const OPEN_BRACKETS = '([{（［【〔「『〈《'
const CLOSE_BRACKETS = ')]}）］】〕」』〉》'

function hasUnbalancedBrackets (s) {
  let open = 0
  let close = 0
  for (const ch of s) {
    if (OPEN_BRACKETS.includes(ch)) open++
    else if (CLOSE_BRACKETS.includes(ch)) close++
  }
  return open !== close
}

function isNoiseAccountName (name) {
  const raw = typeof name === 'string' ? name.trim() : ''
  if (!raw) return true // 空值没有可展示信息，视同噪声（由调用方决定兜底文案）
  if (NOISE_KEYWORDS.some(kw => raw.includes(kw))) return true
  const metricHits = METRIC_WORDS.reduce((n, w) => n + (raw.split(w).length - 1), 0)
  if (metricHits >= 2) return true
  const lowered = raw.toLowerCase()
  if (KNOWN_PAGE_TITLES.includes(lowered)) return true
  if (CHROME_SUFFIXES.some(suffix => lowered.endsWith(suffix.toLowerCase()))) return true
  if (METRIC_PATTERNS.some(re => re.test(raw))) return true
  if (ELLIPSIS_PATTERN.test(raw)) return true
  if (TITLE_SEPARATOR_PATTERN.test(raw)) return true
  if (hasUnbalancedBrackets(raw)) return true
  return false
}

module.exports = {
  isNoiseAccountName,
  hasUnbalancedBrackets,
  NOISE_KEYWORDS,
  METRIC_WORDS,
  KNOWN_PAGE_TITLES,
  CHROME_SUFFIXES,
  METRIC_PATTERNS,
  ELLIPSIS_PATTERN,
  TITLE_SEPARATOR_PATTERN,
  OPEN_BRACKETS,
  CLOSE_BRACKETS,
}
