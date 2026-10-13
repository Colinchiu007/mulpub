/**
 * category-resolver.js — 发布链的分类字段守卫（**零 workspace 依赖**）。
 *
 * ## 为什么本文件不能 require `@multi-publish/shared-utils`
 *
 * 本包是**可独立打包的零 workspace 依赖运行时**（见 `package.json` 的 `files` 与 Docker runner
 * 的 COPY 清单）。同目录先例：`cloud-accounts/validate-account.js:84-89` 为此「按同一批形态规则
 * 重写」并在测试里做 parity 锁。本条**刻意不重写分类表读取** —— 见下。
 *
 * ## 为什么这里不做「中文名 → ID」的解析
 *
 * 因为**它本来就不属于这一层**。`taskData` 按契约是**已备好的**任务数据；把中文分类名翻成平台侧
 * ID 需要读到 `config/platform-taxonomy.json` 与那套 5 种失败原因的语义，那是
 * `@multi-publish/shared-utils` 的 `platformTaxonomy.resolveCategoryId` 的职责，
 * **由上游（桌面主进程）在组包前完成**。
 *
 * 本层需要的只是守卫，而守卫不需要分类表：
 *
 * ## 它修的是什么洞
 *
 * 改前各链写的是「给了就用，给不出就兜底」：
 *   - `bilibili-video.js:77`   `tid: Number(taskData.category || taskData.tid) || 21`
 *   - `baijiahao-article.js:151` `String(taskData.category == null ? '未分类' : taskData.category)`
 *   - `youtube.js:85`          `categoryId: taskData.categoryId || "22"`
 *
 * `bilibili` 那条有个隐蔽的洞：用户传中文名时 `Number('动画')` = `NaN` ⇒ `NaN || 21` = **21**。
 * 即**用户以为按「动画」发了，实际发到 21 号分类，且全程无报错**。
 *
 * 现在：空 ⇒ 交回调用方用默认值（行为不变）；**是合法 ID ⇒ 放行；两者都不是 ⇒ 抛错**。
 * 于是「给了个我们没法采纳的值」永远是响的，而「没给」仍然可以走平台默认值。
 */
'use strict'

/** 平台侧分类 ID 的形态：十进制非负整数（实测数据里都是 '2' / '21' / '60101' 这类，无前导零语义） */
function isExplicitId (v) {
  if (v === null || v === undefined) return false
  const s = String(v).trim()
  return s !== '' && /^\d+$/.test(s)
}

/**
 * 解析 `taskData` 里的分类字段。
 *
 * @param {*} raw 调用方原样给的值（平台侧 ID 字符串/数字，或空）
 * @returns {{ok:true, id:number, source:'explicit-id'}}
 *        | {{ok:false, reason:'not-provided'}}
 * @throws {Error & {code:'CATEGORY_UNRESOLVED', categoryReason:'invalid-format'}}
 *         当给了值但不是合法 ID —— **不回落默认值**，因为静默回落等于发到错分类且用户不可察
 */
function resolvePublishCategory (raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: false, reason: 'not-provided' }
  }
  if (isExplicitId(raw)) {
    return { ok: true, id: Number(String(raw).trim()), source: 'explicit-id' }
  }
  const err = new Error(
    `分类字段不是合法的平台侧 ID：${JSON.stringify(raw)}。` +
    '本层只接受平台侧数字 ID（中文分类名须由上游用 platformTaxonomy.resolveCategoryId 解析后再传入）。' +
    '收到非 ID 值时**不再回落平台默认分类** —— 那会静默发到错误的分类。',
  )
  err.code = 'CATEGORY_UNRESOLVED'
  err.categoryReason = 'invalid-format'
  throw err
}

/** 本层的失败原因只有一种，且它是阻塞性的（供调用方统一按阻塞处理） */
const BLOCKING_REASONS = Object.freeze(['invalid-format'])

function isBlockingReason (reason) {
  return BLOCKING_REASONS.includes(reason)
}

module.exports = { resolvePublishCategory, isExplicitId, isBlockingReason, BLOCKING_REASONS }
