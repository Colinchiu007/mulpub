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

/**
 * 分镜提示词三分的**合计**上限。
 *
 * 为什么单字段上限之外还要一个合计上限：三分各 5 万 ⇒ 合计 15 万字符送进 provider 必然被拒，
 * 且失败点在下游、定位成本高。合计上限与真实承载一致，让**资产损坏在加载期就暴露**。
 *
 * 口径（口径本身也被判据锁住，改动须同步 SCHEMA.md 与测试）：
 *   - 单位：**字符**（`String.length`，不是字节）；
 *   - 计量对象：`imagePrompt + videoPrompt + endFramePrompt` **三者之和**；
 *   - 旧字段 `prompt` **不计入**（它是 imagePrompt 的历史别名，计进去等于重复计量）。
 */
const FILM_PROMPT_BUNDLE_MAX_LEN = 50000

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
 * 校验分镜的三分提示词合计长度。
 * 必须在**归一化之后**调用（否则存量分镜的 `imagePrompt` 还没落位，合计会被低估）。
 * @param {Array<object>} shots
 * @returns {{ok: boolean, error?: string}}
 */
function validateShotPromptBundles (shots) {
  if (!Array.isArray(shots)) return { ok: false, error: 'shot-library 必须为数组' }
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (!s || typeof s !== 'object') continue
    let total = 0
    for (const field of SHOT_PROMPT_FIELDS) {
      const v = s[field]
      if (typeof v === 'string') total += v.length
    }
    if (total > FILM_PROMPT_BUNDLE_MAX_LEN) {
      return {
        ok: false,
        error: 'shots[' + i + '] 三分提示词合计 ' + total + ' 字符，超过上限 ' + FILM_PROMPT_BUNDLE_MAX_LEN +
          '（单位：字符；计量对象：imagePrompt + videoPrompt + endFramePrompt）：请精简该镜提示词',
      }
    }
  }
  return { ok: true }
}

module.exports = {
  FILM_PROMPT_BUNDLE_MAX_LEN,
  SHOT_PROMPT_FIELDS,
  normalizeShotPrompts,
  validateShotPromptBundles,
}
