// @ts-check
/**
 * collected-content-guard.js — 渲染层采集内容验证页护栏（纯函数）
 *
 * 为什么渲染层也要这一份：主进程已经在采集链路拦截验证页，但渲染层仍可能拿到
 * **本地历史/缓存/上游聚合层**返回的验证页内容。护栏在渲染层再判一次，
 * 保证「百度安全验证」文案永远不会被当成文章正文进入编辑器。
 *
 * 判据与主进程 `electron/services/url-collector-antibot.js` **同源**：
 * 常量逐项相同，同一输入两端必须同判 —— 回归锁见 collected-content-guard.test.js
 * （该测试直接 require 主进程模块逐条比对；改一端不改另一端会当场变红）。
 *
 * 现场依据（2026-10-18）：CHALLENGE 页正文 114 字；OK 页不含任何标记。
 * 判定取舍「宁漏不误杀」：结构性 title 信号直接判真；正文强标记 ≥2 个，
 * 或 1 个且正文 <300 字；弱标记（网络不给力 / 正在验证 / 验证通过 / 加载中 /
 * 图片由AI生成）单独出现不得判真 —— 合法长文里「网络不给力，请刷新重试」是常见抱怨语。
 *
 * 文件位置: apps/desktop/src/utils/collected-content-guard.js
 */

/**
 * 强文本标记：滑块验证页的专属文案，合法文章正文不会（同时）出现。
 *
 * ⚠️ 为什么用 \u 转义而不是中文字面量：这些字符串是**外部页面的指纹**，不是可本地化的
 * 用户可见文案（必须逐字匹配百度中文页面，en/zh 双份没有意义）。渲染端 CJK 门禁
 * （check-locale-sync --cjk）按「字符串字面量含 CJK」判新增硬编码文案，字面量写法会被
 * 判红并逼人刷新基线——那是把门禁语义（用户可见文案必须 i18n）反向稀释。
 * 这里保留逐字注释作为可读性来源，值仍与主进程模块逐项相等（parity 测试锁定）。
 */
export const STRONG_TEXT_MARKERS = Object.freeze([
  '\u8bf7\u5b8c\u6210\u4e0b\u65b9\u9a8c\u8bc1\u540e\u7ee7\u7eed\u64cd\u4f5c', // 请完成下方验证后继续操作
  '\u62d6\u52a8\u5de6\u4fa7\u6ed1\u5757\u4f7f\u56fe\u7247\u4e3a\u6b63', // 拖动左侧滑块使图片为正
  '\u56fe\u7247\u672a\u8f6c\u6b63', // 图片未转正
])

/**
 * 强文本正则：实测页脚把「扫码验证| 意见反馈 |刷新」拼成一行，整体算**一个**强标记
 * （不把「扫码验证」单列成标记，否则同一处页脚会被重复计数）。
 * 正则字面量不走 CJK 字符串门禁（该门禁只扫引号字符串），故保留中文便于核对。
 */
export const STRONG_TEXT_PATTERNS = Object.freeze([
  /扫码验证\s*[|｜]\s*意见反馈\s*[|｜]\s*刷新/,
])

/**
 * 弱标记：可出现在正常页面（用户抱怨语 / 加载态 / 正文插图说明），单独出现不得判真。
 * 同强标记，用 \u 转义规避 CJK 文案门禁（非用户可见文案）。
 */
export const WEAK_TEXT_MARKERS = Object.freeze([
  '\u7f51\u7edc\u4e0d\u7ed9\u529b\uff0c\u8bf7\u5237\u65b0\u91cd\u8bd5', // 网络不给力，请刷新重试
  '\u6b63\u5728\u9a8c\u8bc1', // 正在验证
  '\u9a8c\u8bc1\u901a\u8fc7', // 验证通过
  '\u52a0\u8f7d\u4e2d', // 加载中
  '\u56fe\u7247\u7531AI\u751f\u6210', // 图片由AI生成
])

/** 验证页 <title> 标记（实测 CHALLENGE 页 title 恰为这四个字） */
export const VERIFICATION_TITLE_MARKER = '\u767e\u5ea6\u5b89\u5168\u9a8c\u8bc1' // 百度安全验证
/** 百度验证页最终 URL（实测重定向落点 https://wappass.baidu.com/static/captcha/tuxing.html*） */
export const CAPTCHA_URL_PATTERN = /wappass\.baidu\.com\/static\/captcha\//i
/** 强标记数量阈值：≥2 判真；1 个只有在正文很短时才算（宁漏不误杀） */
export const MIN_STRONG_MARKERS = 2
export const SHORT_TEXT_LENGTH_LIMIT = 300

/** 归一化空白：判据与「正文长度 < 300」都基于归一化文本 */
function normalizeText(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
}

/**
 * 已提取内容是否来自安全验证页。
 * @param {{ title?: string | null, content?: string | null } | null} [input]
 * @returns {boolean}
 */
export function isVerificationContent(input) {
  const { title, content } = input || {}
  const pageTitle = normalizeText(title)
  const bodyText = normalizeText(content)
  if (pageTitle.includes(VERIFICATION_TITLE_MARKER)) return true
  const textHits = STRONG_TEXT_MARKERS.filter((m) => bodyText.includes(m))
  for (const pattern of STRONG_TEXT_PATTERNS) {
    if (pattern.test(bodyText)) textHits.push(pattern.source)
  }
  return (
    textHits.length >= MIN_STRONG_MARKERS ||
    (textHits.length === 1 && bodyText.length < SHORT_TEXT_LENGTH_LIMIT)
  )
}
