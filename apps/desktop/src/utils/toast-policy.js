// @ts-check
/**
 * toast-policy.js — toast 时长与分组的**唯一**策略（UX 审计 §16.2 的三条口径之 ①②）
 *
 * 为什么单独一个纯模块：`useNotify` 是薄封装（文案解析在 `notifyCore`，展示在 element-plus），
 * 把时长/分组写进封装里会让"策略"和"渲染"再次长在一起 —— 下一个调用点想改时长就只能改封装。
 *
 * 三条不显然的口径（都有现场理由）：
 *  ① `0` 是**合法值**，不是非法值。element-plus 的 `duration` 文档原文是
 *     "If set to 0, it will not turn off automatically"（`message.d.ts:19-21` 实测），
 *     即"常驻直到手动关闭"。把 0 当非法去回落默认，会把"要常驻"的请求静默变成 3 秒消失。
 *  ② 上限只夹**显式请求**，不夹默认：默认值本身就是策略的一部分，再夹一次是给自己造第二条真源。
 *  ③ 非法值（NaN / 负数 / 非 number）一律回落该 level 的默认值**并出声**（返回 `{ms, fellBack:true}`），
 *     不得静默 —— 静默会让"我传的时长没生效"永远不被知道。
 *
 * 分组（`grouping`）取 element-plus 的原生能力（`message.d.ts:65` `grouping?: boolean`，
 * 默认 false；配 `repeatNum` 作初始计数），不自造第二份合并逻辑 —— 自造就要自己管实例句柄与关闭时序，
 * 而那是库已经做对的事。
 */

/** 各 level 的默认展示时长（毫秒）。`warn` 是 `warning` 的历史别名，共用一档。 */
export const TOAST_DEFAULT_DURATION_MS = Object.freeze({
  success: 2000,
  info: 3000,
  warning: 4000,
  warn: 4000,
  error: 6000,
})

/** 显式请求的上限：超过就夹到上限（常驻请用 0，不要用"很大的数"表达） */
export const TOAST_MAX_DURATION_MS = 10000

/** 未知 level 的兜底档（与 element-plus 默认一致，避免"改出口"顺带改变没预期的 level） */
export const TOAST_FALLBACK_LEVEL = 'info'

/**
 * level → element-plus 的 `type` 取值。**档位词表只在本模块持有**（与
 * `TOAST_DEFAULT_DURATION_MS` 同一套键，由 `toast-policy.test.js` 的成对锁钉住）。
 *
 * 动因（本批实测差点上线的一处收窄）：出口原先自己列了一份 `['success','info','warning','error']`，
 * 而 `warn` 是 `useNotify` JSDoc 承认的合法 level（也是本仓的历史别名）⇒ 那份数组把
 * `level:'warn'` 静默降级成了 info。两张词表必然漂移，所以词表只留一处。
 */
export const TOAST_TYPE_BY_LEVEL = Object.freeze({
  success: 'success',
  info: 'info',
  warning: 'warning',
  warn: 'warning',
  error: 'error',
})

/**
 * 本次展示该用的 element-plus `type`。未知 level 不抛错，落兜底档（与时长口径一致：
 * 档位问题不该让一次通知变成一次崩溃）。
 * @param {string} level
 * @returns {'success'|'info'|'warning'|'error'}
 */
export function resolveToastType (level) {
  const t = TOAST_TYPE_BY_LEVEL[/** @type {keyof typeof TOAST_TYPE_BY_LEVEL} */ (level)]
  return t === undefined ? /** @type {'success'|'info'|'warning'|'error'} */ (TOAST_FALLBACK_LEVEL) : t
}

/**
 * 解析本次展示该用的时长。
 * @param {string} level
 * @param {number|string|null|undefined} requested 调用点显式传的 duration（可缺省）
 * @returns {{ ms: number, fellBack: boolean, reason: string }}
 */
export function resolveToastDuration (level, requested) {
  const known = Object.prototype.hasOwnProperty.call(TOAST_DEFAULT_DURATION_MS, level)
  const fallbackMs = known ? TOAST_DEFAULT_DURATION_MS[/** @type {keyof typeof TOAST_DEFAULT_DURATION_MS} */ (level)] : TOAST_DEFAULT_DURATION_MS[TOAST_FALLBACK_LEVEL]
  const unknownLevel = !known

  if (requested === undefined || requested === null || requested === '') {
    return { ms: fallbackMs, fellBack: false, reason: unknownLevel ? 'UNKNOWN_LEVEL_DEFAULT' : 'DEFAULT' }
  }
  if (typeof requested !== 'number' || Number.isNaN(requested)) {
    return { ms: fallbackMs, fellBack: true, reason: 'NOT_A_NUMBER' }
  }
  if (!Number.isFinite(requested)) {
    return { ms: fallbackMs, fellBack: true, reason: 'NOT_FINITE' }
  }
  if (requested < 0) {
    return { ms: fallbackMs, fellBack: true, reason: 'NEGATIVE' }
  }
  if (requested === 0) {
    // 0 = 常驻（见文件头①）；未知 level 也照收，因为"常驻"与档位无关
    return { ms: 0, fellBack: false, reason: unknownLevel ? 'PERSISTENT_UNKNOWN_LEVEL' : 'PERSISTENT' }
  }
  if (requested > TOAST_MAX_DURATION_MS) {
    return { ms: TOAST_MAX_DURATION_MS, fellBack: true, reason: 'CLAMPED_TO_MAX' }
  }
  return { ms: requested, fellBack: false, reason: unknownLevel ? 'EXPLICIT_UNKNOWN_LEVEL' : 'EXPLICIT' }
}

/**
 * 是否对本次展示启用同源合并。
 * 调用点可显式关闭（`grouping: false`）—— 有些通知必须各算一次（如带序号的进度提示），
 * 但**默认开**，因为审计现场的"刷屏"就是默认不开造成的。
 * @param {unknown} requested
 */
export function resolveToastGrouping (requested) {
  return requested === false ? false : true
}
