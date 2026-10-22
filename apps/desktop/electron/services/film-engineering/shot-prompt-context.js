// @ts-check

/**
 * **plan 级**的方法论接线（design D21.1 / D21.2 / D21.4 / D22）。
 *
 * · 尾帧约束：来源**只有** doctrine 的 `frame_constraint` 块，**只留哈希与长度、不留原文**
 *   （原文属提示词资产，落用户项目文件多一条外发/日志面）。
 * · `promptContext`：plan 级落盘的那一份（任务名、语种、资产哈希、尾帧约束、回退事实、资产完整性）。
 */

const crypto = require('crypto')
const { SHOT_PROMPT_TASK_ID, MAX_END_FRAME_LEN, FRAME_CONSTRAINT_SOURCE } = require('./shot-prompt-contract')
const { pickLocaleText } = require('./shot-prompt-locale')
const { computePromptAssetHash } = require('./shot-prompt-hash')
const { buildShotTaskPrompt } = require('./shot-prompt-render')

/**
 * 尾帧约束（**plan 级**，design D21.1）：来源**只有** doctrine 的 `frame_constraint` 块。
 *
 * 另一条路径（`generate_shot_prompt` 的尾帧铁律）要 LLM 才产出，而规划期零 provider ⇒ 不可达；
 * 两条都写会得到「一个来源、两个真相」。
 *
 * **只返回哈希与长度，不返回原文**（design D22）：方法论原文属提示词资产，
 * 落进用户项目文件会多出一条外发/日志面；原文本来就在用户本地的 kit 里，需要时按 kit 读。
 *
 * @param {object} opts
 * @param {any} [opts.doctrine] - kit.doctrine（可为 null）
 * @param {string} [opts.locale] - zh / en
 * @param {number} [opts.maxLen] - 长度上限（默认 MAX_END_FRAME_LEN）
 * @returns {{available: boolean, hash: string, length: number, locale: string, fallback: boolean, truncated: boolean, source: string,
 *            originalHash: string, originalLength: number}}
 */
function buildEndFrameConstraint (opts) {
  const o = opts || {}
  const doctrine = o.doctrine
  const locale = o.locale === 'en' ? 'en' : 'zh'
  const empty = {
    available: false, hash: '', length: 0, locale, fallback: false, truncated: false,
    source: FRAME_CONSTRAINT_SOURCE, originalHash: '', originalLength: 0,
  }
  if (!doctrine || !Array.isArray(doctrine.blocks)) return empty
  const block = doctrine.blocks.find((b) => b && b.key === 'frame_constraint')
  if (!block) return empty
  const picked = pickLocaleText(block, locale)
  if (!picked.text) return empty
  const maxLen = Number.isInteger(o.maxLen) && o.maxLen > 0 ? o.maxLen : MAX_END_FRAME_LEN
  const truncated = picked.text.length > maxLen
  let text = picked.text
  if (truncated) {
    text = picked.text.slice(0, maxLen)
    // ⚠ 不切开代理对（第 14 轮 i6）：截断点落在高/低代理之间会留下半个 emoji
    //   （确定性不受影响 —— 同输入同输出 —— 但**显示**是坏的）
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdfff) text = text.slice(0, text.length - 1)
  }
  return {
    available: true,
    // hash 与 length 描述**同一个对象**：都是**截断后**的文本（第 8 轮评审 i2 澄清）。
    hash: crypto.createHash('sha256').update(text).digest('hex'),
    length: text.length,
    locale: picked.resolved,
    fallback: picked.fallback,
    truncated,
    source: FRAME_CONSTRAINT_SOURCE,
    // 截断**前**的原文指纹：没有它，截断点之后的改动**不可见**
    // （两段前 50000 字相同、后半不同的文本，哈希完全一样）。
    originalHash: crypto.createHash('sha256').update(picked.text).digest('hex'),
    originalLength: picked.text.length,
  }
}

/**
 * 规划期的**方法论接线**（plan 级，design D21.1/D21.2/D21.4/D22）。
 *
 * @param {object} opts
 * @param {any} [opts.kit] - kit 上下文（{doctrine, palette, promptLibrary, manifest}）
 * @param {string} [opts.locale]
 * @returns {{promptContext: object, warnings: Array<object>}}
 */
function buildPlanPromptContext (opts) {
  const o = opts || {}
  const kit = o.kit && typeof o.kit === 'object' ? o.kit : null
  const locale = o.locale === 'en' ? 'en' : 'zh'
  const warnings = []

  const frame = buildEndFrameConstraint({ doctrine: kit && kit.doctrine, locale })
  if (!frame.available) {
    warnings.push({
      code: 'W10',
      message: '影视工程资产缺少提示词方法论（prompt-doctrine）⇒ 尾帧约束未接入，'
        + '逐镜尾帧提示词仍为空。资产补齐入口尚未提供（见 PR-3b）。',
    })
  }
  const library = kit && kit.promptLibrary
  const prompts = library
    ? buildShotTaskPrompt({ library, vars: {}, missing: [], locale })
    // ⚠ 没有模板 ⇒ system/user 用 **null**（不是空串）⇒ 哈希里落**显式标记**（第 14 轮 i8）
    : { ok: false, error: '提示词任务库不可用', system: null, user: null, taskFallback: false }
  if (!prompts.ok) {
    warnings.push({
      code: 'W11',
      message: '影视工程资产缺少任务级提示词库（prompts/tasks）⇒ 任务模板未接入。'
        + '资产补齐入口尚未提供（见 PR-3b）。',
    })
  }
  /** @type {Record<string, Record<string, string>>} */
  const fallbacks = { doctrine: {}, palette: {}, task: {} }
  if (frame.fallback) fallbacks.doctrine.frame_constraint = frame.locale
  if (prompts.taskFallback) fallbacks.task.task = 'zh'
  const promptContext = {
    taskId: SHOT_PROMPT_TASK_ID,
    // 任务模板库是否真的接上了（缺库时 taskId 仍在，但没有可渲染的原文）
    taskAvailable: prompts.ok === true,
    locale,
    promptAssetHash: computePromptAssetHash({
      doctrine: kit && kit.doctrine,
      system: prompts.system,
      user: prompts.user,
      locale,
      fallbacks,
    }),
    // 尾帧约束：只留哈希与长度，**不留原文**（design D22：原文属提示词资产，不落用户项目文件）
    frameConstraint: frame,
    // 本批次**不逐镜派生**尾帧文本（要 LLM）⇒ 规则已接入、逐镜待派生，如实标注
    frameConstraintPending: true,
    fallbackLocales: fallbacks,
    // 资产不完整（不是「导出被阻断」—— 本 PR 根本没有导出入口，design D22）
    assetsIncomplete: warnings.length > 0,
  }
  return { promptContext, warnings }
}

module.exports = {
  buildEndFrameConstraint,
  buildPlanPromptContext,
}
