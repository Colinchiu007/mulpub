// @ts-check
'use strict'
/**
 * kit-asset-validators — v7 新增数据资产的 schema 校验器
 *
 * 从 kit-loader.js 拆出（该文件因 v7 扩容越过 500 行债务阈值）。
 * 本模块只做**纯结构校验**：不读盘、不依赖 kit-loader 的任何状态，
 * 因此可被单测直接引用，也可被将来的资产版本迁移工具复用。
 *
 * 纪律：校验器只回答「这份数据能不能用」，不回答「怎么修」——
 * 可修复建议写进错误文案（例如「请重新导入配套资产，不要手工改版本号」）。
 */

/**
 * 校验 `schemaVersion`（v7 对抗评审 i4）。
 *
 * 动因：v7 给 prompt-doctrine 升到 schemaVersion=2、给三份新资产声明 schemaVersion=1，
 * 但没有任何 validate* 读过这个字段——版本号纯装饰，未来做破坏性 schema 变更时
 * 加载期检不出来，只会表现为「某个字段莫名 undefined」。
 *
 * 口径：`allowed` 是受支持版本集合；`allowMissing` 时缺失按 `legacyDefault` 处理
 * （prompt-doctrine 的历史文件没有该字段，不能因此让老 kit 整体不可用）。
 * @param {any} obj
 * @param {string} label
 * @param {number[]} allowed
 * @param {{allowMissing?: boolean, legacyDefault?: number}} [opts]
 * @returns {{ok: boolean, error?: string}}
 */
function checkSchemaVersion (obj, label, allowed, opts) {
  const o = opts || {}
  const raw = obj && obj.schemaVersion
  if (raw === undefined || raw === null) {
    if (o.allowMissing === true) return { ok: true }
    return { ok: false, error: label + '.schemaVersion 缺失（要求 ' + allowed.join('/') + '）' }
  }
  const n = Number(raw)
  if (!Number.isInteger(n)) {
    return { ok: false, error: label + '.schemaVersion 必须为整数（实际 ' + String(raw) + '）' }
  }
  if (!allowed.includes(n)) {
    return {
      ok: false,
      error: label + '.schemaVersion=' + n + ' 不受支持（本版本支持 ' + allowed.join('/') + '）：'
        + '这通常意味着资产由更新/更旧的应用版本产出，请重新导入配套资产，不要手工改版本号',
    }
  }
  return { ok: true }
}


/**
 * 校验 shot-grammar.json（镜头语言枚举）
 * 只校验结构与 key 唯一性；取值域由使用方按 key 查表，不做语义有效性判断。
 * @returns {{ok: boolean, error?: string}}
 */
function validateShotGrammar (grammar) {
  if (!grammar || typeof grammar !== 'object' || Array.isArray(grammar)) {
    return { ok: false, error: 'shot-grammar 必须为对象' }
  }
  const v = checkSchemaVersion(grammar, 'shot-grammar', [1])
  if (!v.ok) return v
  const groups = ['shotSizes', 'cameraMoves', 'cameraAngles', 'lightingSetups', 'vfxPresets', 'emotionTiers']
  for (const g of groups) {
    if (!Array.isArray(grammar[g]) || grammar[g].length === 0) {
      return { ok: false, error: 'shot-grammar.' + g + ' 必须为非空数组' }
    }
    const seen = new Set()
    for (const item of grammar[g]) {
      if (!item || typeof item.key !== 'string' || !item.key.trim()) {
        return { ok: false, error: 'shot-grammar.' + g + ' 每项必须含非空 key' }
      }
      if (seen.has(item.key)) return { ok: false, error: 'shot-grammar.' + g + ' key 重复: ' + item.key }
      seen.add(item.key)
      if (typeof item.zh !== 'string' || !item.zh.trim()) {
        return { ok: false, error: 'shot-grammar.' + g + '[' + item.key + '].zh 必须为非空字符串' }
      }
      if (typeof item.en !== 'string' || !item.en.trim()) {
        return { ok: false, error: 'shot-grammar.' + g + '[' + item.key + '].en 必须为非空字符串' }
      }
      // v7 对抗评审第二轮 i6：risk / chain / emotion 是**语义字段**，拼错（如 hihg）会静默通过，
      // 而「high 必须单独试镜」这类安全规则正依赖 risk 的取值 —— 拼错等于把规则架空。
      // 故对已声明的语义字段做闭集校验（未声明则不要求）。
      const enumChecks = [
        ['risk', ['low', 'medium', 'high']],
        ['chain', ['wide', 'medium', 'close']],
        ['emotion', ['neutral', 'power', 'weakness', 'fate', 'unease', 'engagement', 'immersion', 'detachment']],
      ]
      for (const [field, allowed] of enumChecks) {
        if (item[field] === undefined) continue
        if (!allowed.includes(item[field])) {
          return {
            ok: false,
            error: 'shot-grammar.' + g + '[' + item.key + '].' + field + ' 取值非法（允许 ' + allowed.join('/') + '，实际 ' + String(item[field]) + '）',
          }
        }
      }
    }
  }
  const tiers = grammar.durationTiers
  if (!tiers || typeof tiers !== 'object') return { ok: false, error: 'shot-grammar.durationTiers 缺失' }
  if (!Array.isArray(tiers.supportedSec) || tiers.supportedSec.length === 0) {
    return { ok: false, error: 'shot-grammar.durationTiers.supportedSec 必须为非空数组' }
  }
  for (const s of tiers.supportedSec) {
    if (!Number.isFinite(Number(s)) || Number(s) <= 0) {
      return { ok: false, error: 'shot-grammar.durationTiers.supportedSec 含非法秒数: ' + String(s) }
    }
  }
  if (!Number.isFinite(Number(tiers.maxSec)) || Number(tiers.maxSec) <= 0) {
    return { ok: false, error: 'shot-grammar.durationTiers.maxSec 必须为正数' }
  }
  if (Number(tiers.maxSec) > Math.max(...tiers.supportedSec.map(Number))) {
    return { ok: false, error: 'shot-grammar.durationTiers.maxSec 不得超过 supportedSec 的最大档位' }
  }
  return { ok: true }
}

/**
 * 校验 compliance-checklist.json（剧本合规清单）
 * @returns {{ok: boolean, error?: string}}
 */
function validateComplianceChecklist (checklist) {
  if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
    return { ok: false, error: 'compliance-checklist 必须为对象' }
  }
  const v = checkSchemaVersion(checklist, 'compliance-checklist', [1])
  if (!v.ok) return v
  if (!Array.isArray(checklist.items) || checklist.items.length === 0) {
    return { ok: false, error: 'compliance-checklist.items 必须为非空数组' }
  }
  const ids = new Set()
  for (const it of checklist.items) {
    if (!it || typeof it.id !== 'string' || !it.id.trim()) {
      return { ok: false, error: 'compliance-checklist.items 每项必须含非空 id' }
    }
    if (ids.has(it.id)) return { ok: false, error: 'compliance-checklist id 重复: ' + it.id }
    ids.add(it.id)
    if (!['blocker', 'warn'].includes(it.severity)) {
      return { ok: false, error: 'compliance-checklist[' + it.id + '].severity 必须为 blocker 或 warn' }
    }
    for (const field of ['zhQuestion', 'enQuestion', 'zhPass', 'enPass', 'zhFix', 'enFix']) {
      if (typeof it[field] !== 'string' || !it[field].trim()) {
        return { ok: false, error: 'compliance-checklist[' + it.id + '].' + field + ' 必须为非空字符串' }
      }
    }
  }
  if (!Array.isArray(checklist.categories) || checklist.categories.length === 0) {
    return { ok: false, error: 'compliance-checklist.categories 必须为非空数组' }
  }
  const catKeys = new Set(checklist.categories.map((c) => c && c.key))
  for (const it of checklist.items) {
    if (!catKeys.has(it.category)) {
      return { ok: false, error: 'compliance-checklist[' + it.id + '].category 引用不存在的分类: ' + String(it.category) }
    }
  }
  return { ok: true }
}

/**
 * 校验 palette.json（剧组色盘）
 * 上限是硬契约：主色 4 个、扩展色 ≤2 个——超限即判定为「色盘失控」，不允许加载。
 * @returns {{ok: boolean, error?: string}}
 */
function validatePalette (palette) {
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
    return { ok: false, error: 'palette 必须为对象' }
  }
  const v = checkSchemaVersion(palette, 'palette', [1])
  if (!v.ok) return v
  const limits = palette.limits || {}
  const maxPrimary = Number.isInteger(limits.maxPrimary) ? limits.maxPrimary : 4
  const maxExtended = Number.isInteger(limits.maxExtended) ? limits.maxExtended : 2
  if (!Array.isArray(palette.primary) || palette.primary.length === 0) {
    return { ok: false, error: 'palette.primary 必须为非空数组' }
  }
  if (palette.primary.length > maxPrimary) {
    return { ok: false, error: 'palette.primary 超过上限 ' + maxPrimary + '（实际 ' + palette.primary.length + '）' }
  }
  if (!Array.isArray(palette.extended)) return { ok: false, error: 'palette.extended 必须为数组' }
  if (palette.extended.length > maxExtended) {
    return { ok: false, error: 'palette.extended 超过上限 ' + maxExtended + '（实际 ' + palette.extended.length + '）' }
  }
  const HEX_RE = /^#[0-9a-fA-F]{6}$/
  const keys = new Set()
  for (const group of ['primary', 'extended']) {
    for (const c of palette[group]) {
      if (!c || typeof c.key !== 'string' || !c.key.trim()) {
        return { ok: false, error: 'palette.' + group + ' 每项必须含非空 key' }
      }
      if (keys.has(c.key)) return { ok: false, error: 'palette key 重复: ' + c.key }
      keys.add(c.key)
      if (typeof c.hex !== 'string' || !HEX_RE.test(c.hex)) {
        return { ok: false, error: 'palette.' + group + '[' + c.key + '].hex 必须为 #RRGGBB 形式' }
      }
      if (typeof c.zhName !== 'string' || !c.zhName.trim()) {
        return { ok: false, error: 'palette.' + group + '[' + c.key + '].zhName 必须为非空字符串' }
      }
      if (typeof c.enName !== 'string' || !c.enName.trim()) {
        return { ok: false, error: 'palette.' + group + '[' + c.key + '].enName 必须为非空字符串' }
      }
    }
  }
  // paletteLine 是「机械注入」的唯一字符串源，必须中英双份且非空
  const line = palette.paletteLine
  if (!line || typeof line !== 'object') return { ok: false, error: 'palette.paletteLine 必须为对象' }
  for (const loc of ['zh', 'en']) {
    if (typeof line[loc] !== 'string' || !line[loc].trim()) {
      return { ok: false, error: 'palette.paletteLine.' + loc + ' 必须为非空字符串' }
    }
    // 每个主色 hex 都必须出现在注入串里，否则「机械注入」会漏色
    for (const c of palette.primary) {
      if (!line[loc].includes(c.hex)) {
        return { ok: false, error: 'palette.paletteLine.' + loc + ' 未包含主色 ' + c.hex }
      }
    }
  }
  if (!Array.isArray(palette.emotionColorMap)) {
    return { ok: false, error: 'palette.emotionColorMap 必须为数组' }
  }
  return { ok: true }
}


module.exports = {
  checkSchemaVersion,
  validateShotGrammar,
  validateComplianceChecklist,
  validatePalette,
}
