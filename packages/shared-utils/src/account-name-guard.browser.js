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

export function isNoiseAccountName (name) {
  const raw = typeof name === 'string' ? name.trim() : ''
  if (!raw) return true // 空值无可展示信息，视同噪声（由调用方决定兜底文案）
  if (NOISE_KEYWORDS.some(kw => raw.includes(kw))) return true
  const metricHits = METRIC_WORDS.reduce((n, w) => n + (raw.split(w).length - 1), 0)
  if (metricHits >= 2) return true
  const lowered = raw.toLowerCase()
  if (KNOWN_PAGE_TITLES.includes(lowered)) return true
  return false
}
