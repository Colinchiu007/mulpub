// @ts-check

/**
 * 规划期的**提示词变量装配**（design D20 / D21 / D22）。
 *
 * 职责：把「方法论资产」（doctrine + 任务模板）接到**每镜**上 ——
 * 7 个任务变量 + 缺失**五**分类 + 清单闸门。**零 provider 调用、零落盘**。
 *
 * ⚠ 本文件是**装配层**；配套的职责已按单一职责拆到同目录：
 *   · `shot-prompt-contract.js` —— 常量与闭集（变量名 / 五类缺失原因 / 长度上限）**单一真源**
 *   · `shot-prompt-locale.js`   —— 统一语种回退
 *   · `shot-prompt-hash.js`     —— 两级哈希（资产面 / 渲染面）
 *   · `shot-prompt-sanitize.js` —— 不可信输入净化 + 清单闸门
 *   · `shot-prompt-render.js`   —— 任务模板渲染
 *   · `shot-prompt-context.js`  —— plan 级上下文（尾帧约束 + promptContext）
 *
 * 拆分动因：本仓 `check-max-lines.js` 的 `NEW_OVER_LIMIT` 判据（单文件 ≤ 500 行）。
 * ⚠ 本文件**继续导出全部对外符号**（re-export）⇒ 消费方（auto-plan / auto-project / service / ipc）
 *   的 import **不需要改**。
 */

// ⚠ 模块级绑定统一加 `Mod` 后缀：`locale` 这类短名会被函数内的局部变量**遮蔽**
//   （`buildShotTaskVars` 里就有 `const locale = ...`）⇒ 遮蔽后模块对象取不到，
//   而这种遮蔽在 JS 里**不报错** ⇒ 只能靠命名纪律躲开。
const contractMod = require('./shot-prompt-contract')
const localeMod = require('./shot-prompt-locale')
const hashMod = require('./shot-prompt-hash')
const sanitizeMod = require('./shot-prompt-sanitize')
const renderMod = require('./shot-prompt-render')
const contextMod = require('./shot-prompt-context')

const { MAX_KIT_VAR_LEN, MAX_SHOT_FIELD_LEN, TASK_VARS, BY_DESIGN_VARS, REASON_BY_DESIGN, REASON_ASSET_MISSING, REASON_OVERSIZE_VAR } = contractMod
const { pickLocaleText } = localeMod
const { capMissingList, sanitizeUntrustedText } = sanitizeMod

/**
 * 装配 7 个任务变量（缺失四分类在这里产生 —— design D21.3）。
 *
 * @param {object} opts
 * @param {any} [opts.shot] - 本镜
 * @param {any} [opts.kit] - kit（取 palette / manifest.filmMeta.characters）
 * @param {string} [opts.locale]
 * @param {number} [opts.durationSec] - 本镜时长（秒）
 * @returns {{vars: Record<string, string>, missing: Array<{name: string, reason: string}>, fallbacks: Record<string, string>}}
 */
function buildShotTaskVars (opts) {
  const o = opts || {}
  const shot = o.shot && typeof o.shot === 'object' ? o.shot : {}
  const kit = o.kit && typeof o.kit === 'object' ? o.kit : {}
  const locale = o.locale === 'en' ? 'en' : 'zh'
  /** @type {Record<string, string>} */
  const vars = {}
  /** @type {Array<{name: string, reason: string}>} */
  const missing = []
  /** @type {Record<string, string>} */
  const fallbacks = {}
  /** 超长而**不提供**的变量（第 9 轮 i4：独立一类 `oversizeVar`，不混进 `assetMissing`） */
  const oversizeVars = new Set()

  // ① shot_json：**固定键序**（design D22 —— 键序变了哈希就变）
  //    ⚠ 逐镜字段同样是不可信输入（第 8 轮 i8）⇒ 超上限就**不提供** `shot_json`。
  const shotTitle = typeof shot.title === 'string' ? shot.title : ''
  const shotModel = typeof shot.model === 'string' ? shot.model : ''
  const shotChars = Array.isArray(shot.characterNames)
    ? shot.characterNames.filter(n => typeof n === 'string')
    : []
  const shotFieldsOk =
    shotTitle.length <= MAX_SHOT_FIELD_LEN &&
    shotModel.length <= MAX_SHOT_FIELD_LEN &&
    shotChars.every(n => n.length <= MAX_SHOT_FIELD_LEN)
  if (shotFieldsOk) {
    vars.shot_json = JSON.stringify({
      index: shot.index === undefined ? null : shot.index,
      shotId: shot.shotId === undefined ? null : shot.shotId,
      title: shotTitle,
      beatIndex: shot.beatIndex === undefined ? null : shot.beatIndex,
      characterNames: shotChars,
      model: shotModel,
    })
  } else {
    oversizeVars.add('shot_json')
  }

  // ② palette_line：kit 色盘声明（缺该语种回退 zh）
  //    ⚠ kit 不可信（第 8 轮 i8）⇒ 超上限**不提供**（⇒ assetMissing ⇒ deliverable=false），
  //    **不静默截断**（截断会把「资产异常」伪装成「资产正常」）。
  const pickedPalette = pickLocaleText(kit.palette && kit.palette.paletteLine, locale)
  // ⚠ 净化**先于**长度判定（第 15 轮 i3）：否则「先判长、后净化」会漏
  const paletteText = sanitizeUntrustedText(pickedPalette.text)
  if (paletteText && paletteText.length <= MAX_KIT_VAR_LEN) {
    vars.palette_line = paletteText
    if (pickedPalette.fallback) fallbacks.palette_line = pickedPalette.resolved
  } else if (paletteText) {
    oversizeVars.add('palette_line')
  } else {
    // ⚠ **资产缺失** ⇒ 提供**空串**（⇒ 渲染为空、**不留占位符**），与 `assetMissing` 的语义一致（第 17 轮）
    //   —— 不提供的话渲染文本会留着 `{{palette_line}}`，那与「assetMissing ⇒ 渲染为空串」的口径**矛盾**。
    vars.palette_line = ''
  }

  // ③ style_prefix：**设计上不填**（无资产源）⇒ 不提供 ⇒ 渲染文本保留 `{{style_prefix}}`
  missing.push({ name: 'style_prefix', reason: REASON_BY_DESIGN })

  // ④ geo_block：**本批次不取**（第 17 轮 i3）——
  //    跨模板取 GEO 块的**选取规则未定义**（kit 存量 153 模板里只有 1 个带 GEO 块，取它得先定「取哪个模板的块」），
  //    所以「缺」的不是资产，而是**我们决定不取** ⇒ 归 **byDesign**（与 style_prefix 同类），
  //    **不是** assetMissing（那会说成「资产里没有」—— 与事实不符）。
  //    不提供 ⇒ 渲染文本保留 `{{geo_block}}` 原样（用户能看出「这个槽位没接上」）。
  missing.push({ name: 'geo_block', reason: REASON_BY_DESIGN })

  // ⑤ character_descriptors：manifest 里的角色身份描述符（逐字粘贴，不得缩写）
  //    ⚠ kit 不可信（第 8 轮 i8）⇒ **合计长度**超上限就**整个变量不提供**
  //    （部分提供会产出「看着完整、其实缺角色」的提示词，比不提供更危险）。
  //    ⚠ 上限是**拼接后合计**（第 14 轮 i1）—— 逐角色各判一次会让 N 个角色把上限乘 N 倍，
  //    而「单镜落盘体积」那条上限的余量推导就失效了。
  const chars = kit.manifest && kit.manifest.filmMeta && Array.isArray(kit.manifest.filmMeta.characters)
    ? kit.manifest.filmMeta.characters
    : []
  const descs = []
  let descsTooLong = false
  for (const c of chars) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) continue
    const d = sanitizeUntrustedText(typeof c.descriptor === 'string' ? c.descriptor : '').trim()
    if (!d) continue
    const line = c.name.trim() + '：' + d
    descs.push(line)
  }
  const descsJoined = descs.length ? descs.join('\n') : ''
  if (descsJoined.length > MAX_KIT_VAR_LEN) descsTooLong = true
  if (descs.length && !descsTooLong) vars.character_descriptors = descsJoined
  else if (descsTooLong) oversizeVars.add('character_descriptors')
  else {
    // ⚠ 同上：资产**缺失** ⇒ 提供**空串**（⇒ 渲染为空、不留占位符）
    vars.character_descriptors = ''
  }

  // ⑥ duration_sec：逐镜时长
  const dur = Number(o.durationSec)
  vars.duration_sec = Number.isFinite(dur) && dur > 0 ? String(dur) : ''

  // ⑦ model：本镜模型
  vars.model = typeof shot.model === 'string' ? shot.model : ''

  // 资产缺口：拿到空串的变量（byDesign 除外）⇒ 进清单
  //   ⚠ 超长的变量**不算**「资产缺口」⇒ 独立一类 `oversizeVar`（第 9 轮 i4）
  for (const name of TASK_VARS) {
    if (BY_DESIGN_VARS.includes(name)) continue
    if (oversizeVars.has(name)) {
      missing.push({ name, reason: REASON_OVERSIZE_VAR })
      continue
    }
    if (typeof vars[name] !== 'string' || vars[name] === '') {
      missing.push({ name, reason: REASON_ASSET_MISSING })
    }
  }

  // ⚠ **闸门在产出源**（第 17 轮 i7 的要害）：**落盘**的清单来自这里（不是来自渲染路径）⇒
  //   若只在这里不截断，模板要 100 个变量就会把 100 条写进**逐镜项目文件**。
  const capped = capMissingList(missing)
  return { vars, missing: capped.list, fallbacks, truncated: capped.truncated }
}

// ── 对外导出面（与拆分前**逐项相等**；消费方 import 不需要改）────────────────────────
// ⚠ 刻意**不**用 `...module` 展开：展开会把子模块的内部实现（`joinLengthPrefixed` /
//   `capMissingList` / `sanitizeUntrustedText`）也暴露成公开 API ⇒ 公开面会**悄悄变大**。
//   这里逐项列出 ⇒ 公开面与拆分前**逐字相同**，且新增内部实现必须**显式**决定要不要暴露。
module.exports = {
  // 契约与闭集
  SHOT_PROMPT_TASK_ID: contractMod.SHOT_PROMPT_TASK_ID,
  MAX_END_FRAME_LEN: contractMod.MAX_END_FRAME_LEN,
  MAX_KIT_VAR_LEN: contractMod.MAX_KIT_VAR_LEN,
  MAX_SHOT_FIELD_LEN: contractMod.MAX_SHOT_FIELD_LEN,
  TASK_VARS: contractMod.TASK_VARS,
  BY_DESIGN_VARS: contractMod.BY_DESIGN_VARS,
  REASON_BY_DESIGN: contractMod.REASON_BY_DESIGN,
  REASON_ASSET_MISSING: contractMod.REASON_ASSET_MISSING,
  REASON_TEMPLATE_VAR: contractMod.REASON_TEMPLATE_VAR,
  REASON_BAD_VAR_NAME: contractMod.REASON_BAD_VAR_NAME,
  REASON_OVERSIZE_VAR: contractMod.REASON_OVERSIZE_VAR,
  MAX_MISSING_NAME_LEN: contractMod.MAX_MISSING_NAME_LEN,
  MAX_MISSING_ENTRIES: contractMod.MAX_MISSING_ENTRIES,
  MAX_MISSING_BYTES: contractMod.MAX_MISSING_BYTES,
  FRAME_CONSTRAINT_SOURCE: contractMod.FRAME_CONSTRAINT_SOURCE,
  ABSENT_TEMPLATE: contractMod.ABSENT_TEMPLATE,
  HASH_VERSION: contractMod.HASH_VERSION,
  FALLBACK_SOURCES: contractMod.FALLBACK_SOURCES,
  // 语种回退
  pickLocaleText: localeMod.pickLocaleText,
  // 哈希
  computePromptAssetHash: hashMod.computePromptAssetHash,
  computePromptRenderHash: hashMod.computePromptRenderHash,
  // 变量名封顶
  clampVarName: sanitizeMod.clampVarName,
  // 渲染 / 尾帧 / plan 上下文
  buildShotTaskPrompt: renderMod.buildShotTaskPrompt,
  buildEndFrameConstraint: contextMod.buildEndFrameConstraint,
  buildPlanPromptContext: contextMod.buildPlanPromptContext,
  // 装配
  buildShotTaskVars,
}
