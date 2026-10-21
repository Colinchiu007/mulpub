// @ts-check
'use strict'
/**
 * shot-prompts — 分镜提示词三分的归一化与合计校验（影视工程 v2 · F-A）
 *
 * 为什么独立成文件：`kit-loader.js` 原本就贴着 500 行门禁（check-max-lines），
 * 三分逻辑塞进去会把它顶穿。本仓的既有做法是同型拆分
 * （`network-egress-ledger.js` 从 `network-egress-guard.js` 拆出，注释里写明「别搬回来」）。
 * 本文件**只放三分相关**，不放加载逻辑；`kit-loader.js` 通过 require 复用并 re-export，
 * 既有 import 路径不变。
 */

/** 三分字段名（归一化与合计校验共用一份真源，避免两处各写一份字符串） */
const SHOT_PROMPT_FIELDS = Object.freeze(['imagePrompt', 'videoPrompt', 'endFramePrompt'])

/**
 * 归一化分镜的三分提示词。
 *
 * 口径：
 *   - `imagePrompt ??= prompt`（存量分镜的首帧图提示词 = 旧 prompt，**逐字不变**）；
 *   - `videoPrompt ??= ''`（**空**，不是回落 prompt）；
 *   - `endFramePrompt ??= ''`。
 *
 * ⚠️ 为什么 `videoPrompt` 回落**空**而不是 `prompt`：回落 `prompt` 会让「存量分镜的视频提示词
 * 过长」这件事**被掩盖成已解决**（字段非空、长度不减）。留空 ⇒ 消费侧回落 `imagePrompt`，
 * 边界在数据上可见。存量长提示词的真正治理是后续项（一次性重算 + 人工审核），不是本批次。
 *
 * @param {object} shot - 分镜对象（原地修改）
 * @returns {object} 同一引用
 */
function normalizeShotPrompts (shot) {
  if (!shot || typeof shot !== 'object') return shot
  if (shot.imagePrompt === undefined || shot.imagePrompt === null) shot.imagePrompt = String(shot.prompt || '')
  if (shot.videoPrompt === undefined || shot.videoPrompt === null) shot.videoPrompt = ''
  if (shot.endFramePrompt === undefined || shot.endFramePrompt === null) shot.endFramePrompt = ''
  return shot
}

/**
 * 校验单条分镜的三分提示词**字段本身**（存在即校验类型与长度）。
 * 归一化之后调用：此时三分字段一定存在（缺省已补齐），所以能给出确定结论。
 * @param {object} shot - 分镜对象
 * @param {string} at - 错误定位前缀（如 "shots[3]"）
 * @param {number} maxLen - 单字段长度上限
 * @returns {{ok: boolean, error?: string}}
 */
function validateShotPromptFields (shot, at, maxLen) {
  if (!shot || typeof shot !== 'object') return { ok: true }
  for (const field of SHOT_PROMPT_FIELDS) {
    const v = shot[field]
    // 缺失即跳过：本函数在**归一化之前**跑（存量分镜的三分字段还不存在），
    // 归一化之后三分字段一定存在，由本函数逐项校验类型与长度。
    // 本批次**没有「三分合计上限」**（该判据与单字段上限同值 ⇒ 永不触发，
    // 且会误杀三段各自顶格的合法资产；验证层评审 i4 已删除，口径见 SCHEMA.md §2.2）。
    // ⚠️ 漏掉这个跳过会让所有存量 kit 加载失败（实测 55 例红）。
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') {
      return { ok: false, error: at + '.' + field + ' 必须为字符串' }
    }
    if (v.length > maxLen) {
      return { ok: false, error: at + '.' + field + ' 超过上限 ' + maxLen + ' 字符' }
    }
  }
  return { ok: true }
}

module.exports = {
  SHOT_PROMPT_FIELDS,
  normalizeShotPrompts,
  validateShotPromptFields,
}
