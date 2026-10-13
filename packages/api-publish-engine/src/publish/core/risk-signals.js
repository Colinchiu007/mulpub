'use strict'
/**
 * risk-signals.js — 风控信号单一真源（fix-risk-hold-false-positive，2026-10-13）
 *
 * 为什么要有这个模块：本仓此前存在**两份**各自演化的风控词表 ——
 * 引擎 `publish-mode-runner.js` 的 `RISK_RE` 与桌面 `publish-risk.js` 的 `RISK_RE`。
 * 两者注释都写着「保持同义」，实际内容已经漂移（桌面多 安全验证/操作频繁/captcha）。
 * 两份词表意味着「同一个错误文本，在引擎与桌面可能得到不同结论」，且每次加词都要改两处。
 * 现在收敛为一份，两边都 require 本模块。
 *
 * ── 为什么要分「强/弱」两档（本次修复的核心）──────────────────────────────
 * 旧实现是一条裸子串正则，`601` / `risk` / `frequent` / `验证` 都无边界匹配。
 * 实测误判面（fix-risk-hold-false-positive 取证，见 PRD 附录 A）：
 *   · `Request failed with status code 601` → 命中（HTTP 状态码）
 *   · `publish id 6019 not found`          → 命中（ID 含 601）
 *   · `gateway timeout ts=1601846521`      → 命中（时间戳含 601）
 *   · `errno 100000159: bad request`       → 命中（风控码的邻居）
 *   · `infrequent login detected`          → 命中（英文子串）
 *   · `low-risk content flagged`           → 命中（英文普通词）
 *   · `身份验证失败` / `请先完成实名验证`      → 命中（普通「验证」）
 * 而这些误判的后果不是「少发一篇」，是把该账号（accountId 缺失时是该平台**所有**账号）
 * 冻结到用户手动去平台创作者中心走一遍验证为止 —— 误判代价远高于漏判。
 *
 * 分档判据（与仓内既有纪律一致，见 publish-not-submitted.js 的封闭词表注释、
 * 以及 PRD-XHS-DOM-RPA-HARDENING 的「误判比漏判更有害」）：
 *   · STRONG = 平台风控**专属**措辞/码族，无语义歧义 → `suspends: true`，允许挂起
 *   · WEAK   = 宽泛词，可能出现在普通错误里        → `suspends: false`，只提示不挂起
 * **「弱信号不挂起」这个不变量由本模块给出（`suspends` 字段），调用方不得自行推导**，
 * 否则又是一个「两处各自解释」的漂移点。
 *
 * 实测「真风控」样例全部落在 STRONG（风控/安全验证/滑块/操作频繁/captcha/canvas illegal/
 * 账号存在风险/risk control/risk_blocked 标志/601·10000015 码族），因此收紧不损召回。
 *
 * 合规红线：本模块只做识别，无任何自动恢复/自动换号逻辑。
 */

/** 结构化风控码族（平台自报，无歧义）—— 命中即 strong。 */
const RISK_CODES = new Set([
  'BILI_RISK_601',
  'RISK_BLOCKED',
  601,
  10000015,
  -1e7,
])

/** 我们的守卫自身产生的标记：它不是平台信号，必须排除（否则会自触发再挂起）。 */
const SUSPENDED_MARKER_RE = /risk_suspended/i

/**
 * 强信号：平台风控专属措辞，无语义歧义。
 * 英文词一律加「标识符边界」（`_` 也算边界，故 `BILI_RISK_601` 能命中）；
 * 数字码加「数字边界」，杜绝 `1601` / `6019` 这类子串命中。
 */
const RISK_STRONG_RE = new RegExp([
  '风控',
  '滑块',
  '安全验证',
  '验证弹层',
  '操作频繁',
  'captcha',
  'canvas illegal',
  '账号存在风险',
  'risk control',
  'risk_blocked',
  'riskBlocked',
  'RISK_BLOCKED',
  'BILI_RISK',
  // 抖音 status_code===110 的**文案形态**。为什么单独收：真实链路由适配器显式置
  // `risk_blocked: true`（结构化 strong）覆盖；但该文案可能在错误被重新包装/截断后
  // 只剩文本（如 RPA 轨回传），此时 `验证失败(110)` 是平台专属、无歧义的形态，
  // 而裸「验证」属弱档不挂起 —— 不收会漏掉这一类真风控。
  '验证失败\\(110\\)',
  '(?<!\\d)10000015(?!\\d)',
].join('|'), 'i')

/**
 * 弱信号：宽泛词，可能出现在普通错误里 —— 只提示、不挂起。
 * `601` 刻意留在弱档：真实 B站风控文案含「风控」「滑块验证」（强档已覆盖），
 * 而裸 `601` 与 HTTP 状态码/ID/时间戳无法区分。
 */
const RISK_WEAK_RE = new RegExp([
  '验证',
  '频繁',
  '(?<![A-Za-z0-9])risk(?![A-Za-z0-9])',
  '(?<![A-Za-z0-9])frequent(?![A-Za-z0-9])',
  '(?<![A-Za-z0-9])verify(?![A-Za-z0-9])',
  '(?<!\\d)601(?!\\d)',
].join('|'), 'i')

/** 并集：任何一档命中。供「停报不降级」这类只问「像不像风控」的路由判据使用。 */
const RISK_ANY_RE = new RegExp(RISK_STRONG_RE.source + '|' + RISK_WEAK_RE.source, 'i')

/**
 * @typedef {{hit: boolean, strength: ('strong'|'weak'|null), signal: string, suspends: boolean}} RiskVerdict
 * signal 是**封闭词表**里的稳定记号（安全、可持久化、可展示），不是原始错误文本：
 *   'flag'         —— 调用方显式声明 risk_blocked
 *   'code:<code>'  —— 平台风控码族
 *   'strong:<词>'  —— 强信号词表命中
 *   'weak:<词>'    —— 弱信号词表命中
 */

const NOT_HIT = Object.freeze({ hit: false, strength: null, signal: '', suspends: false })

/** 取正则第一条命中的原始子串（词表是封闭的，故该子串可安全外传）。 */
function firstMatch (re, text) {
  const m = re.exec(text)
  return m ? m[0] : ''
}

/**
 * 风控判定（结构化信号优先，文本兜底，分强弱并给出 suspends 不变量）。
 * @param {{error?: unknown, code?: unknown, riskBlocked?: unknown, risk_blocked?: unknown}} [input]
 * @returns {RiskVerdict}
 */
function classifyRisk (input) {
  const src = input || {}

  // ① 结构化信号优先：调用方显式声明 → 直接 strong，完全不依赖文本
  if (src.riskBlocked === true || src.risk_blocked === true) {
    return { hit: true, strength: 'strong', signal: 'flag', suspends: true }
  }
  // ② 平台风控码族（数字码与字符串枚举两形态都收）
  const code = src.code
  if (code != null && RISK_CODES.has(typeof code === 'string' ? code : Number(code))) {
    return { hit: true, strength: 'strong', signal: 'code:' + String(code), suspends: true }
  }

  // ③ 文本兜底
  const text = typeof src.error === 'string' ? src.error : ''
  if (!text) return Object.assign({}, NOT_HIT)
  // 守卫自身标记不是平台信号（自触发防线；桌面侧另有 isRiskSuspendedMessage 双保险）
  if (SUSPENDED_MARKER_RE.test(text)) return Object.assign({}, NOT_HIT)

  const strong = firstMatch(RISK_STRONG_RE, text)
  if (strong) return { hit: true, strength: 'strong', signal: 'strong:' + strong, suspends: true }
  const weak = firstMatch(RISK_WEAK_RE, text)
  if (weak) return { hit: true, strength: 'weak', signal: 'weak:' + weak, suspends: false }
  return Object.assign({}, NOT_HIT)
}

/**
 * 文本是否像风控（并集，不分强弱）。
 * 用途：只需回答「像不像风控」的路由判据（如 API 轨命中即停报不降级）。
 * @param {unknown} text
 * @returns {boolean}
 */
function isRiskText (text) {
  if (typeof text !== 'string' || !text) return false
  if (SUSPENDED_MARKER_RE.test(text)) return false
  return RISK_ANY_RE.test(text)
}

module.exports = {
  RISK_CODES,
  RISK_STRONG_RE,
  RISK_WEAK_RE,
  RISK_ANY_RE,
  classifyRisk,
  isRiskText,
}
