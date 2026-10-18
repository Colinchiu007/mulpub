/**
 * story-text-limit.js — 「故事讲述」文案字数上限的渲染端解析单一真源
 * （change: story-text-limit-control）
 *
 * 数据来源：运营中心签名下发块 `storyTextLimit`（与 announcements / feature_flags /
 * pipelineOptions 同级，已纳入两端 config_hash 白名单）：
 *
 *   { "story2video": { "maxChars": 10000, "warnPercent": 90 } }
 *
 * 三条不可破的口径：
 *   1. 块缺省 / null / 非对象 → 回落内置默认 { maxChars: 10000, warnPercent: 90 }；
 *      warnPercent 表示预警阈值（百分比整数），生效预警起点 = floor(maxChars * warnPercent / 100)。
 *   2. 逐字段独立判定：非整数或越界只回落该字段的默认值，**不 clamp 到区间端点** ——
 *      clamp 会让「运营配错了」看起来像生效了（PRD E5），且无法从界面看出来。
 *   3. 只接受 JSON 整数：字符串 "12000" 不隐式转换（防 "12000abc" 这类脏值，PRD E3）；
 *      浮点 / NaN / Infinity 一律回落。解析过程绝不抛错（创作流程不允许被配置阻断）。
 *
 * source 判据：仅当 maxChars 被运营值接受时为 'ops-center'；否则 'default'。
 * 该标记只用于排查与将来的生效看板（PRD §13 可观测），warnPercent 单独回落不影响它。
 */

export const DEFAULT_STORY2VIDEO_TEXT_LIMIT = Object.freeze({ maxChars: 10000, warnPercent: 90 })

/** 跨端契约合法区间（闭区间，与运营中心写入口的校验表逐值一致；PRD §5.3） */
export const STORY2VIDEO_TEXT_LIMIT_MIN_CHARS = 1000
export const STORY2VIDEO_TEXT_LIMIT_MAX_CHARS = 50000
export const STORY2VIDEO_TEXT_LIMIT_MIN_WARN_PERCENT = 50
export const STORY2VIDEO_TEXT_LIMIT_MAX_WARN_PERCENT = 99

function isPlainObject (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 严格整数 + 闭区间：非 number（含数字字符串）与越界一律返回 null，由调用方回落默认。 */
function boundedInteger (value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null
}

/**
 * 解析当前生效的字数上限与预警阈值。
 * @param {any} runtimeState 运营中心 runtime 响应 data（含 storyTextLimit 键），
 *   或直接传入 storyTextLimit 块本身（测试/离线重放便利，两种形态等价）。
 * @returns {{ maxChars: number, warnPercent: number, source: 'ops-center'|'default' }}
 */
export function resolveStory2VideoTextLimit (runtimeState) {
  const block = isPlainObject(runtimeState) && Object.prototype.hasOwnProperty.call(runtimeState, 'storyTextLimit')
    ? runtimeState.storyTextLimit
    : runtimeState
  const scope = isPlainObject(block) && isPlainObject(block.story2video) ? block.story2video : null
  const resolvedMaxChars = scope
    ? boundedInteger(scope.maxChars, STORY2VIDEO_TEXT_LIMIT_MIN_CHARS, STORY2VIDEO_TEXT_LIMIT_MAX_CHARS)
    : null
  const resolvedWarnPercent = scope
    ? boundedInteger(scope.warnPercent, STORY2VIDEO_TEXT_LIMIT_MIN_WARN_PERCENT, STORY2VIDEO_TEXT_LIMIT_MAX_WARN_PERCENT)
    : null
  return {
    maxChars: resolvedMaxChars === null ? DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars : resolvedMaxChars,
    warnPercent: resolvedWarnPercent === null ? DEFAULT_STORY2VIDEO_TEXT_LIMIT.warnPercent : resolvedWarnPercent,
    source: resolvedMaxChars === null ? 'default' : 'ops-center',
  }
}

/**
 * 预警档位起点（含）对应的字符数：与既有 `Math.floor(max * 0.9)` 逐值一致，
 * warnPercent=90 / maxChars=10000 时为 9000（PRD §7.2 边界取 floor）。
 * @param {number} maxChars
 * @param {number} warnPercent
 * @returns {number}
 */
export function story2VideoTextWarnThreshold (maxChars, warnPercent) {
  const max = Number(maxChars) || 0
  const percent = Number(warnPercent) || 0
  if (max <= 0 || percent <= 0) return 0
  return Math.floor(max * percent / 100)
}
