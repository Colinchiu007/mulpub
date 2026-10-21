'use strict'
/**
 * zhihu-fav-rewrite.js — 知乎收藏「单条改写」调用 + 失败诊断脱敏 + 字数区间归一
 *
 * ## 为什么是这个模块（feat-zhihu-fav-batch-wordcount，2026-10-21）
 *
 * ① **行数**：`ipc-handlers/zhihu-favlist.js` 当时 498 行，距 max-lines 的 500 行天花板只剩 2 行
 *    （`check-max-lines.js` 的 NEW_OVER_LIMIT：未登记的文件超 500 即阻断，且**不能**调基线）。
 *    本片要给它加「区间透传 + 字数回传 + 超限统计」，加不动 ⇒ 把「单条改写 + 诊断脱敏」这一
 *    自包含单元整体搬到这里（纯搬迁，行为逐字不变），主文件因此腾出行数。
 *    同族先例：`segment-rewriter.js` / `word-count-instruction.js` 都是从核心文件拆出的独立能力。
 *
 * ② **能力对齐**：知乎收藏批量是**唯一**一条「改写长度不可控、且看不见结果长度」的改写链路
 *    （采集页主改写按钮已在 #4111 修好）。本模块给它补上字数区间。
 *
 * ## 字数区间契约（三层，不是三份真源）
 *
 *   - 渲染层（`useWordCountValidation`）：**给用户看的红字**——非法即禁用「采集并改写」按钮；
 *   - 主进程（本模块 `normalizeRewriteWordCountRange`）：**降级到旧行为**——非法就不带新字段，
 *     Python 回落 `length:'keep'`（老客户端/绕过 UI 的调用方不受影响）；
 *   - Python（`RewriteRequest` 的 `ge/le` + `model_validator`）：**越界的最终裁决**。
 *
 * 区间上下界的真源仍是 `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_OUTPUT_CHARS`；
 * 本模块的 49999/50000 与 `packages/python-backend/.../models.py` 的 `ge/le` 是同一口径的镜像
 * （models.py 同样以注释指向该真源）——**不新造第三份口径**。
 */

/** min 上界（码点）：与引擎 MAX_OUTPUT_CHARS - 1 同值（models.py 的 ge=0/le=49999 同源） */
const MAX_MIN = 49999
/** max 上界（码点）：与引擎 MAX_OUTPUT_CHARS 同值 */
const MAX_MAX = 50000

/**
 * 诊断文本脱敏 + 截断：内网 IP/localhost 端点替换为通用说法，保留可读性。
 * @param {string} text
 * @returns {string} ≤200 字符
 */
function sanitizeDiagText (text) {
  return String(text)
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g, '后端服务')
    .replace(/\blocalhost(?::\d+)?/gi, '后端服务')
    .slice(0, 200)
}

/**
 * 改写失败的诊断摘要（可读 + 脱敏）。
 * @param {unknown} e
 * @returns {string}
 */
function summarizeRewriteError (e) {
  let msg
  if (e && typeof e === 'object' && typeof e.message === 'string' && e.message) msg = e.message
  else if (typeof e === 'string') msg = e
  else { try { msg = JSON.stringify(e) } catch { msg = String(e) } }
  // 内网端点脱敏 + 截断（单一实现见 sanitizeDiagText）
  return sanitizeDiagText(msg)
}

/**
 * 归一用户传来的字数区间。
 *
 * 合法 ⇒ `{min, max}`；缺省/非法 ⇒ `null`（调用方据此**不带**新字段，让 Python 回落 length 三档）。
 *
 * 合法域：min 0-49999 的整数、max 1-50000 的整数、max >= min。
 * min=0 是**合法值**，含义是「不设下限」——不能因为 0 是假值就当成缺省。
 *
 * @param {{min?:unknown,max?:unknown}|null|undefined} input
 * @returns {{min:number,max:number}|null}
 */
function normalizeRewriteWordCountRange (input) {
  if (!input || typeof input !== 'object') return null
  const min = Number(input.min)
  const max = Number(input.max)
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null
  if (min < 0 || min > MAX_MIN) return null
  if (max < 1 || max > MAX_MAX) return null
  if (max < min) return null
  return { min, max }
}

/**
 * 转成 Python `/aggregation/rewrite` 的请求字段。
 * @param {{min:number,max:number}|null|undefined} range - 已归一的区间
 * @returns {{min_word_count:number,max_word_count:number}|null}
 */
function buildRewriteRangeFields (range) {
  if (!range || typeof range !== 'object') return null
  return { min_word_count: range.min, max_word_count: range.max }
}

/**
 * 改写稿是否超出用户设定的上限。
 *
 * ⚠️ **只判定、不截断**：截断 = 静默丢内容（可能切在半句）。本仓理念是**可见化**
 * （Node 引擎按上限砍尾时会置 `outputTruncated` 并在界面横幅告知），这里同理——
 * 超出即计数、如实告知，不动内容。
 *
 * @param {number} wordCount - 改写稿实际字数
 * @param {number|null|undefined} max - 用户设定的上限；无上限时永不算超限
 * @returns {boolean}
 */
function isOverWordCountLimit (wordCount, max) {
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) return false
  if (typeof wordCount !== 'number' || !Number.isFinite(wordCount) || wordCount < 0) return false
  return wordCount > max
}

/**
 * 单条改写：成功返回 `{ text, wordCount }`；失败返回 `{ error }`（调用方回退原文）。
 *
 * 失败原因可诊断（2026-10-17，change: collected-results-fix）：
 * 旧版调用方 `catch {}` 把真实异常吞掉，用户只看到「改写失败用原文」却不知道是
 * Python 后端没起（ECONNREFUSED）、接口 500 还是返回了空结果 —— 三种情况对应三种
 * 用户该做的事（起后端 / 看日志 / 换风格重试）。因此把失败原因以字符串形式抛给调用方：
 *   - 成功：返回 { text, wordCount }（error 为 undefined）
 *   - 接口异常：error = 异常 message（截断 200 字符）
 *   - 返回空 result_content：error = 明确的「空结果」说明
 *
 * 两道护栏（QM-6 评审 #1/#6，2026-10-17）：
 *   ① 非 Error 抛出值（字符串/对象）也要有可读摘要，不能产出 "[object Object]"；
 *   ② 摘要里的内网端点（127.* / localhost / 内网 IP:端口）替换为通用说法 ——
 *      完整原文仍在 log.warn，UI 不暴露内部拓扑。
 *
 * 2026-10-18（fav-force-recollect 自评）：脱敏逻辑抽成 sanitizeDiagText 供采集失败
 * 的 reason 复用 —— reason 同样直传 UI（进度行 + 结果徽标），暴露面与 rewriteError 同级。
 *
 * 2026-10-21（feat-zhihu-fav-batch-wordcount）：新增字数区间（wordCountRange）与
 * **改写稿实际字数**回传（wordCount，来自 Python 的 `word_count`，码点口径）。
 *
 * @param {object} pythonBridge
 * @param {string} content
 * @param {string} [style]
 * @param {object} [llm]
 * @param {{min:number,max:number}|null} [wordCountRange] - 已归一的区间；null ⇒ 不带新字段
 * @returns {Promise<{text?:string,wordCount?:number,error?:string}>}
 */
async function rewriteOne (pythonBridge, content, style, llm, wordCountRange) {
  let res
  try {
    const body = {
      content,
      style: style || '轻松易懂',
      length: 'keep',
      ...(buildRewriteRangeFields(wordCountRange) || {}),
      ...(llm ? { llm } : {}),
    }
    res = await pythonBridge.requestBackend('POST', '/aggregation/rewrite', body)
  } catch (e) {
    return { error: summarizeRewriteError(e) }
  }
  const out = res && typeof res.result_content === 'string' ? res.result_content.trim() : ''
  if (!out) {
    return { error: '改写接口返回空结果（result_content 为空），请查看后端日志或换个改写风格重试' }
  }
  const rawCount = Number(res && res.word_count)
  return { text: out, wordCount: Number.isFinite(rawCount) && rawCount > 0 ? rawCount : out.length }
}

module.exports = {
  rewriteOne,
  sanitizeDiagText,
  summarizeRewriteError,
  normalizeRewriteWordCountRange,
  buildRewriteRangeFields,
  isOverWordCountLimit,
  MAX_MIN,
  MAX_MAX,
}
