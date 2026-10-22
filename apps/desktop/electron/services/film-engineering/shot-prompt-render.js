// @ts-check

/**
 * 任务模板的**渲染**（design D21.3 / D22）。
 *
 * `deliverable === false` ⇒ 渲染文本**不可直送模型**（有占位符或资产缺口）——
 * 消费方必须先校验该字段。
 * ⚠ 模板是**不可信**输入：它可以要 100 个变量 ⇒ 清单闸门在这里也强制生效（渲染路径同样不能漏）。
 */

const { getTaskPrompts, renderTemplate } = require('./prompt-library')
const { SHOT_PROMPT_TASK_ID, REASON_TEMPLATE_VAR, REASON_BAD_VAR_NAME } = require('./shot-prompt-contract')
const { capMissingList, clampVarName } = require('./shot-prompt-sanitize')

/**
 * 渲染「任务级提示词包」。
 *
 * `deliverable === false` ⇒ 渲染文本**不可直送模型**（有占位符或资产缺口）——
 * 消费方必须先校验该字段（design D21.3）。
 *
 * @param {object} opts
 * @param {any} opts.library - kit.promptLibrary
 * @param {Record<string, string>} [opts.vars]
 * @param {Array<{name: string, reason: string}>} [opts.missing]
 * @param {string} [opts.locale]
 * @param {string} [opts.taskId]
 * @returns {{ok: boolean, error?: string, taskId: string, locale: string, system: string, user: string,
 *            renderText: string, missing: Array<{name: string, reason: string}>,
 *            deliverable: boolean, blockedVars: Array<{name: string, reason: string}>}}
 */
function buildShotTaskPrompt (opts) {
  const o = opts || {}
  const taskId = typeof o.taskId === 'string' && o.taskId ? o.taskId : SHOT_PROMPT_TASK_ID
  const locale = o.locale === 'en' ? 'en' : 'zh'
  const base = {
    ok: false,
    taskId,
    locale,
    system: '',
    user: '',
    renderText: '',
    missing: [],
    deliverable: false,
    blockedVars: [],
  }
  // 任务模板的语种回退：en 缺失 ⇒ 回落 zh（与 doctrine/palette 同一套回退规则）
  let prompts = getTaskPrompts(o.library, taskId, locale)
  let taskFallback = false
  if (!prompts.ok && locale === 'en') {
    const zh = getTaskPrompts(o.library, taskId, 'zh')
    if (zh.ok) { prompts = zh; taskFallback = true }
  }
  if (!prompts.ok) {
    return Object.assign({}, base, { error: prompts.error })
  }
  const vars = o.vars && typeof o.vars === 'object' ? o.vars : {}
  /** @type {Array<{name: string, reason: string}>} */
  const missing = Array.isArray(o.missing) ? o.missing.slice() : []
  const rendered = renderTemplate(prompts.user, vars)
  // 模板要但我们没给的变量（templateVar）
  //
  // ⚠ **条目数与字节数的硬闸门**（第 14 轮 i3 / 第 16 轮 i2 · Critical/feasibility）：
  // 模板是**不可信**输入 ⇒ 它可以要 100 个变量 ⇒ 清单会被撑爆
  // （「清单 ≤ 字节预算」与「非任务条目 ≤ 8」两条上限都会被击穿 —— 那是**断言**，不是**闸门**）。
  // ⇒ 这里做**强制闸门**：超出上限的条目**不落清单**（`deliverable` 仍为 false ⇒ 照样拦住直送）。
  // 闸门**两道**：条目数 + **序列化字节数**（名字含引号/反斜杠时 JSON 转义按 6 字节/字算）。
  const capMissing = (list) => capMissingList(list).list
  for (const name of rendered.missing) {
    if (missing.some(m => m.name === name)) continue
    missing.push({ name: clampVarName(name), reason: REASON_TEMPLATE_VAR })
  }
  // 我们给的变量名不合规（badVarName）——视为实现缺陷，同样拦住直送
  for (const name of rendered.unknownVars) {
    if (missing.some(m => m.name === name)) continue
    missing.push({ name: clampVarName(name), reason: REASON_BAD_VAR_NAME })
  }
  const cappedMissing = capMissing(missing)
  // 清单**被截断**了吗（第 17 轮 i7）：截断了 ⇒ 面板要说一句「还有未显示的」，
  // 否则用户看到的 blockedVars 少于真实数量（缺口被**静默丢弃**）。
  const truncated = cappedMissing.length < missing.length
  return {
    ok: true,
    taskId,
    locale,
    system: prompts.system,
    user: prompts.user,
    renderText: rendered.text,
    missing: cappedMissing,
    deliverable: missing.length === 0,
    blockedVars: cappedMissing.slice(),
    truncated,
    taskFallback,
  }
}

module.exports = {
  buildShotTaskPrompt,
}
