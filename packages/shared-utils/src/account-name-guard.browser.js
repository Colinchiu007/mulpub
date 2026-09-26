// 渲染端（vite dev / build）使用的 ESM 账号昵称噪声判定孪生文件。
// 主进程仍使用 account-name-guard.js（CommonJS），避免改变 Node 端契约。
// 关键词表由 account-name-guard.js 同源生成；两侧判定必须一致，
// 漂移由 packages/shared-utils/src/__tests__/account-name-guard.test.js 的 parity 回归拦截。
export const NOISE_KEYWORDS = [
  "退出登录",
  "账号认证",
  "扫码登录",
  "请登录",
  "立即登录",
  "创作者中心",
  "创作中心",
  "数据中心",
  "发布记录",
  "作品管理",
  "内容管理",
  "首页",
  "设置",
  "提现",
  "收益"
]

export const METRIC_WORDS = [
  "粉丝",
  "获赞",
  "关注者",
  "粉丝数",
  "关注数"
]

export const KNOWN_PAGE_TITLES = [
  "作品发布",
  "头条号",
  "百家号",
  "视频号助手",
  "视频号",
  "bilibili 创作者中心",
  "bilibili",
  "哔哩哔哩",
  "哔哩哔哩创作中心",
  "微信公众号",
  "公众号",
  "大鱼号",
  "搜狐号",
  "网易号",
  "一点号",
  "爱奇艺号",
  "企鹅号",
  "网易订阅号"
]

// 以下五组是 2026-09-26 新增的结构化判定，必须与 account-name-guard.js 逐字一致，
// 漂移由 __tests__/account-name-guard.test.js 的 parity 回归拦截。
export const CHROME_SUFFIXES = [
  "创作者中心",
  "创作者服务平台",
  "创作服务平台",
  "服务平台",
  "工作台",
  "管理后台",
  "开放平台",
  "数据中心"
]

export const METRIC_PATTERNS = [
  /\d+(?:\.\d+)?\s*[万亿wk]?\s*(?:人看过|人观看|人浏览|次阅读|次播放|条评价|位粉丝|个粉丝)/i,
  /^\d+(?:\.\d+)?\s*[万亿wk]?\s*(?:粉丝|关注|获赞|播放|阅读|浏览|作品|动态|赞)$/i
]

export const ELLIPSIS_PATTERN = /\.{3}|…|。{2,}/

export const TITLE_SEPARATOR_PATTERN = /\s[-–—|·]\s/

export const OPEN_BRACKETS = '([{（［【〔「『〈《'
export const CLOSE_BRACKETS = ')]}）］】〕」』〉》'

export function hasUnbalancedBrackets (s) {
  let open = 0
  let close = 0
  for (const ch of s) {
    if (OPEN_BRACKETS.includes(ch)) open++
    else if (CLOSE_BRACKETS.includes(ch)) close++
  }
  return open !== close
}

export function isNoiseAccountName (name) {
  const raw = typeof name === 'string' ? name.trim() : ''
  if (!raw) return true // 空值无可展示信息，视同噪声（由调用方决定兜底文案）
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
