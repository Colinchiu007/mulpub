// @ts-check
'use strict'
/**
 * 自动模式的**只读投影**（方法论接入状态 + 分镜预览）。
 *
 * 为什么要单独成文件：本仓 `check-max-lines.js` 的 `NEW_OVER_LIMIT` 判据（单文件 ≤ 500 行），
 * 且本目录已有同级先例（`film-engineering-auto-inspect.js`）。
 *
 * ⚠ **唯一实现**（第 9 轮 i4 · consistency）：方法论接入状态在**规划结果**与
 * **重开项目的项目投影**两处都要显示，而两处若各写一份实现，结论必然漂移
 * （面板显示的「接上量」会与落盘的清单对不上）⇒ 两处都从这里取**同一个** `buildMethodologySummary`。
 */

const PROMPT_PREVIEW_LENGTH = 200

/**
 * 方法论接入状态摘要（plan 级，只读面板用）。
 *
 * 命中数与阻断变量从**逐镜**的 promptMissing 汇总（填不填得上与资产有关，逐镜一致）；
 * 缺资产时命中数会变少 —— 面板要如实显示，不能只报「7 个变量」的名目。
 * @param {{shots: Array<object>, promptContext: object|null, stale?: boolean}} planned
 * @returns {object|null}
 */
function buildMethodologySummary (planned) {
  const ctx = planned && planned.promptContext
  if (!ctx) return null
  const shots = Array.isArray(planned.shots) ? planned.shots : []
  const blocked = new Map()
  let hit = null
  for (const s of shots) {
    const miss = Array.isArray(s.promptMissing) ? s.promptMissing : []
    for (const m of miss) {
      if (!blocked.has(m.name)) blocked.set(m.name, m.reason)
    }
    if (hit === null) {
      const vars = s.promptVars && typeof s.promptVars === 'object' ? s.promptVars : {}
      const filled = Object.keys(vars).filter(k => typeof vars[k] === 'string' && vars[k] !== '').length
      hit = filled
    }
  }
  return {
    taskId: ctx.taskId,
    locale: ctx.locale,
    promptAssetHash: ctx.promptAssetHash,
    totalVars: 7,
    hitVars: hit === null ? 0 : hit,
    deliverable: blocked.size === 0,
    blockedVars: [...blocked.entries()].map(([name, reason]) => ({ name, reason })),
    assetsIncomplete: ctx.assetsIncomplete === true,
    frameConstraintPending: ctx.frameConstraintPending === true,
    frameConstraintHash: ctx.frameConstraint ? ctx.frameConstraint.hash : '',
    // 第 12 轮 i6：kit 已被替换（当前哈希与落盘值不一致）⇒ 面板必须**说出来**，
    // 否则「从落盘清单重算出来的结论」会**看起来仍然成立**。
    // ⚠ `stale` 是**三态**（第 13 轮 i6）：`true` = 资产被换了；`false` = 没变；
    //   `null` = **判不了**（当前 kit 缺失/不完整）⇒ 不显示这条提示，改走「资产不完整」。
    stale: planned.stale === true,
    // 清单被闸门截断（第 17 轮 i7）⇒ 面板要说「还有未显示的」
    truncated: ctx.missingTruncated === true,
  }
}

function shotPreview (shot) {
  const prompt = typeof shot.prompt === 'string' ? shot.prompt : ''
  return {
    index: shot.index,
    shotId: shot.shotId,
    title: shot.title || '',
    seconds: shot.seconds,
    characterNames: Array.isArray(shot.characterNames) ? shot.characterNames : [],
    refPaths: Array.isArray(shot.refPaths) ? shot.refPaths : [],
    promptLength: prompt.length,
    promptPreview: prompt.length > PROMPT_PREVIEW_LENGTH ? prompt.slice(0, PROMPT_PREVIEW_LENGTH) + ' …' : prompt,
  }
}

module.exports = {
  buildMethodologySummary,
  shotPreview,
}
