// @ts-check
'use strict'
/**
 * kit-loader - film-kit 数据资产加载与 schema 校验
 *
 * film-kit 是随包携带的《Hell Grind》影视工程数据资产：
 *   film-manifest.json       电影元数据 + 场景树（sceneId/名称/计数/层级/来源URL）
 *   shot-library.json        分镜库：每场景代表性真实提示词 + 模型 + 参考 token + 结果 URL
 *   reference-registry.json  token → 参考素材索引（角色/场景/道具 + 图 URL + 描述）
 *   prompt-doctrine.json     提示词架构（块模板 + 铁律 + 配方 + 失败模式台账 + 词汇表，中英双语）
 *   shot-grammar.json        镜头语言枚举（景别/运镜/机位/光线/特效/情绪档/时长档）
 *   compliance-checklist.json 剧本合规审核清单（12 条，blocker/warn 两级）
 *   palette.json             剧组色盘声明（4 主色 + ≤2 扩展色 + 情绪色彩映射 + 漂移治理）
 *   prompts/tasks/<task>/{zh,en}/{system,user}.md  任务化中英成对 prompt 库（目录即契约）
 *   images/                  精选参考图（min 版）
 *
 * fail-closed 契约：任一文件缺失 / JSON 损坏 / schema 非法 → kit 整体不可用，
 * 不允许静默降级为部分数据。调用方（IPC）据此返回 FILM_KIT_UNAVAILABLE。
 */

const fs = require('fs')
const path = require('path')
const { loadPromptLibrary } = require('./prompt-library')

const KIT_FILES = [
  'film-manifest.json',
  'shot-library.json',
  'reference-registry.json',
  'prompt-doctrine.json',
  'shot-grammar.json',
  'compliance-checklist.json',
  'palette.json',
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// D4 四处同源：与 fetch-hell-grind-kit.py FILM_PROMPT_MAX_LEN 同值（导入/校验单一契约）
const FILM_PROMPT_MAX_LEN = 50000
const MAX_PROMPT_LENGTH = FILM_PROMPT_MAX_LEN // 兼容别名，勿在新代码中使用
const MAX_TOKEN_LENGTH = 64

function isUuidLike (value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

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
 * 校验 film-manifest.json
 * @returns {{ok: boolean, error?: string}}
 */
function validateManifest (manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: 'manifest 必须为对象' }
  }
  if (manifest.schemaVersion !== 1) {
    return { ok: false, error: 'manifest.schemaVersion 必须为 1，实际 ' + String(manifest.schemaVersion) }
  }
  const meta = manifest.filmMeta
  if (!meta || typeof meta !== 'object') {
    return { ok: false, error: 'manifest.filmMeta 缺失' }
  }
  if (typeof meta.title !== 'string' || !meta.title.trim()) return { ok: false, error: 'filmMeta.title 必须为非空字符串' }
  if (!Number.isFinite(Number(meta.durationSec)) || Number(meta.durationSec) <= 0) {
    return { ok: false, error: 'filmMeta.durationSec 必须为正数' }
  }
  if (typeof meta.logline !== 'string' || !meta.logline.trim()) return { ok: false, error: 'filmMeta.logline 必须为非空字符串' }
  if (!Array.isArray(meta.characters) || meta.characters.length === 0) {
    return { ok: false, error: 'filmMeta.characters 必须为非空数组' }
  }
  for (const c of meta.characters) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) {
      return { ok: false, error: 'characters 每项必须含非空 name' }
    }
  }
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    return { ok: false, error: 'manifest.scenes 必须为非空数组' }
  }
  const ids = new Set()
  for (const s of manifest.scenes) {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) return { ok: false, error: 'scenes 每项必须含非空 id' }
    if (ids.has(s.id)) return { ok: false, error: 'scenes id 重复: ' + s.id }
    ids.add(s.id)
    if (typeof s.name !== 'string' || !s.name.trim()) return { ok: false, error: 'scenes[' + s.id + '] name 必须为非空字符串' }
    if (!Number.isFinite(Number(s.count)) || Number(s.count) < 0) {
      return { ok: false, error: 'scenes[' + s.id + '] count 必须 >= 0' }
    }
    if (s.parentId !== null && s.parentId !== undefined && (!ids.has(s.parentId) && s.parentId !== s.id)) {
      // parent 可能是后置声明，先收集再统一校验（见下方树校验）
    }
    if (!Number.isFinite(Number(s.level)) || Number(s.level) < 0) {
      return { ok: false, error: 'scenes[' + s.id + '] level 必须 >= 0' }
    }
  }
  // 树校验：parentId 必须存在（允许 root：parentId === null），无环
  for (const s of manifest.scenes) {
    if (s.parentId === null || s.parentId === undefined) continue
    if (!ids.has(s.parentId)) return { ok: false, error: 'scenes[' + s.id + '] parentId 指向不存在的场景' }
    if (s.parentId === s.id) return { ok: false, error: 'scenes[' + s.id + '] 自引用（环）' }
  }
  return { ok: true }
}

/**
 * 校验 shot-library.json
 * @returns {{ok: boolean, error?: string}}
 */
function validateShotLibrary (shots) {
  if (!Array.isArray(shots)) return { ok: false, error: 'shot-library 必须为数组' }
  const ids = new Set()
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const at = 'shots[' + i + ']'
    if (!s || typeof s !== 'object') return { ok: false, error: at + ' 必须为对象' }
    if (typeof s.shotId !== 'string' || !s.shotId.trim()) return { ok: false, error: at + '.shotId 必须为非空字符串' }
    if (ids.has(s.shotId)) return { ok: false, error: at + '.shotId 重复: ' + s.shotId }
    ids.add(s.shotId)
    if (typeof s.sceneId !== 'string' || !s.sceneId.trim()) return { ok: false, error: at + '.sceneId 必须为非空字符串' }
    if (typeof s.prompt !== 'string' || !s.prompt.trim()) return { ok: false, error: at + '.prompt 必须为非空字符串' }
    if (s.prompt.length > MAX_PROMPT_LENGTH) {
      return { ok: false, error: at + '.prompt 超过上限 ' + MAX_PROMPT_LENGTH + ' 字符' }
    }
    if (typeof s.model !== 'string' || !s.model.trim()) return { ok: false, error: at + '.model 必须为非空字符串' }
    if (s.refTokens !== undefined) {
      if (!Array.isArray(s.refTokens)) return { ok: false, error: at + '.refTokens 必须为数组' }
      for (const t of s.refTokens) {
        if (!isUuidLike(t)) return { ok: false, error: at + '.refTokens 含非法 token（须为非空字符串 <=64 字符）' }
      }
    }
    if (s.resultUrl !== undefined && s.resultUrl !== null && typeof s.resultUrl !== 'string') {
      return { ok: false, error: at + '.resultUrl 必须为字符串或 null' }
    }
    if (s.width !== undefined && s.width !== null && (!Number.isFinite(Number(s.width)) || Number(s.width) <= 0)) {
      return { ok: false, error: at + '.width 必须为正数或 null' }
    }
    if (s.height !== undefined && s.height !== null && (!Number.isFinite(Number(s.height)) || Number(s.height) <= 0)) {
      return { ok: false, error: at + '.height 必须为正数或 null' }
    }
    // L1 全量导入扩展字段（film-full-corpus-production 任务 3.3）
    if (s.durationSec !== undefined && s.durationSec !== null && (!Number.isFinite(Number(s.durationSec)) || Number(s.durationSec) <= 0)) {
      return { ok: false, error: at + '.durationSec 必须为正数或 null' }
    }
    if (s.aspectRatio !== undefined && s.aspectRatio !== null && !(typeof s.aspectRatio === 'string' && /^\d+:\d+$/.test(s.aspectRatio))) {
      return { ok: false, error: at + '.aspectRatio 必须为 "W:H" 字符串（如 "21:9"）或 null' }
    }
    if (s.iterationCount !== undefined && s.iterationCount !== null && (!Number.isInteger(s.iterationCount) || s.iterationCount < 0)) {
      return { ok: false, error: at + '.iterationCount 必须为非负整数或 null' }
    }
    if (s.adoptedJobAt !== undefined && s.adoptedJobAt !== null && !Number.isFinite(Number(s.adoptedJobAt))) {
      return { ok: false, error: at + '.adoptedJobAt 必须为数值时间戳或 null' }
    }
  }
  return { ok: true }
}

/**
 * 校验 shot-library 与 manifest 的 sceneId 交叉引用（任务 3.3）
 * 任一 shot.sceneId 必须能在 manifest.scenes 中找到，孤儿引用 fail-closed。
 * @returns {{ok: boolean, error?: string}}
 */
function validateShotSceneRefs (shots, manifest) {
  if (!Array.isArray(shots)) return { ok: false, error: 'shot-library 必须为数组' }
  if (!manifest || !Array.isArray(manifest.scenes)) return { ok: false, error: 'manifest.scenes 必须为数组' }
  const sceneIds = new Set(manifest.scenes.map((sc) => sc && sc.id))
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (!s || !sceneIds.has(s.sceneId)) {
      return { ok: false, error: 'shots[' + i + '].sceneId 指向不存在的场景: ' + String(s && s.sceneId) }
    }
  }
  return { ok: true }
}

/**
 * 校验 reference-registry.json
 * @returns {{ok: boolean, error?: string}}
 */
function validateReferences (references) {
  if (!references || typeof references !== 'object' || Array.isArray(references)) {
    return { ok: false, error: 'reference-registry 必须为对象（token → 条目）' }
  }
  const keys = Object.keys(references)
  if (keys.length === 0) return { ok: false, error: 'reference-registry 不能为空' }
  for (const token of keys) {
    if (!isUuidLike(token)) return { ok: false, error: 'reference-registry 含非法 token: ' + String(token).slice(0, 40) }
    const entry = references[token]
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'reference-registry[' + token + '] 必须为对象' }
    const kind = entry.kind
    if (!['character', 'scene', 'prop', 'unknown'].includes(kind)) {
      return { ok: false, error: 'reference-registry[' + token + '] kind 非法: ' + String(kind) }
    }
    if (entry.name !== undefined && (typeof entry.name !== 'string' || !entry.name.trim())) {
      return { ok: false, error: 'reference-registry[' + token + '] name 必须为非空字符串' }
    }
    if (entry.imageUrls !== undefined) {
      if (!Array.isArray(entry.imageUrls)) return { ok: false, error: 'reference-registry[' + token + '] imageUrls 必须为数组' }
      for (const u of entry.imageUrls) {
        if (typeof u !== 'string' || !/^https:\/\//.test(u)) {
          return { ok: false, error: 'reference-registry[' + token + '] imageUrls 仅允许 https URL' }
        }
      }
    }
  }
  return { ok: true }
}

/**
 * 校验 prompt-doctrine.json
 * @returns {{ok: boolean, error?: string}}
 */
function validateDoctrine (doctrine) {
  if (!doctrine || typeof doctrine !== 'object') return { ok: false, error: 'prompt-doctrine 必须为对象' }
  // 历史文件没有 schemaVersion，缺失按 v1 处理；但一旦声明就必须受支持（i4）
  const v = checkSchemaVersion(doctrine, 'prompt-doctrine', [1, 2], { allowMissing: true })
  if (!v.ok) return v
  if (!Array.isArray(doctrine.blocks) || doctrine.blocks.length === 0) {
    return { ok: false, error: 'prompt-doctrine.blocks 必须为非空数组' }
  }
  for (const b of doctrine.blocks) {
    if (!b || typeof b.key !== 'string' || !b.key.trim()) return { ok: false, error: 'blocks 每项必须含非空 key' }
    if (typeof b.label !== 'string' || !b.label.trim()) return { ok: false, error: 'blocks[' + b.key + '].label 必须为非空字符串' }
  }
  if (!Array.isArray(doctrine.rules) || doctrine.rules.length === 0) {
    return { ok: false, error: 'prompt-doctrine.rules 必须为非空数组' }
  }
  for (const r of doctrine.rules) {
    if (!r || typeof r.key !== 'string' || !r.key.trim()) return { ok: false, error: 'rules 每项必须含非空 key' }
  }
  if (!Array.isArray(doctrine.glossary)) {
    return { ok: false, error: 'prompt-doctrine.glossary 必须为数组' }
  }
  // v7 批次一（F1 增补）：配方与失败模式台账为可选结构，一旦声明就必须完整——
  // 半张台账比没有台账更危险（会让人以为踩过的坑都有记录）。
  if (doctrine.recipes !== undefined) {
    if (!Array.isArray(doctrine.recipes) || doctrine.recipes.length === 0) {
      return { ok: false, error: 'prompt-doctrine.recipes 声明后必须为非空数组' }
    }
    for (const r of doctrine.recipes) {
      if (!r || typeof r.key !== 'string' || !r.key.trim()) return { ok: false, error: 'recipes 每项必须含非空 key' }
      if (!Array.isArray(r.blockKeys) || r.blockKeys.length === 0) {
        return { ok: false, error: 'recipes[' + r.key + '].blockKeys 必须为非空数组' }
      }
      const blockKeys = new Set(doctrine.blocks.map((b) => b.key))
      for (const bk of r.blockKeys) {
        if (!blockKeys.has(bk)) {
          return { ok: false, error: 'recipes[' + r.key + '].blockKeys 引用不存在的块: ' + String(bk) }
        }
      }
    }
  }
  if (doctrine.failureLedger !== undefined) {
    if (!Array.isArray(doctrine.failureLedger) || doctrine.failureLedger.length === 0) {
      return { ok: false, error: 'prompt-doctrine.failureLedger 声明后必须为非空数组' }
    }
    const ledgerIds = new Set()
    for (const f of doctrine.failureLedger) {
      if (!f || typeof f.id !== 'string' || !f.id.trim()) return { ok: false, error: 'failureLedger 每项必须含非空 id' }
      if (ledgerIds.has(f.id)) return { ok: false, error: 'failureLedger id 重复: ' + f.id }
      ledgerIds.add(f.id)
      for (const field of ['symptom', 'cause', 'fix']) {
        if (typeof f[field] !== 'string' || !f[field].trim()) {
          return { ok: false, error: 'failureLedger[' + f.id + '].' + field + ' 必须为非空字符串' }
        }
      }
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


function readJsonFile (filePath, label, errors) {
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (e) {
    errors.push(label + ' 缺失或不可读: ' + (e instanceof Error ? e.message : String(e)))
    return null
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    errors.push(label + ' JSON 解析失败: ' + (e instanceof Error ? e.message : String(e)))
    return null
  }
}

/**
 * 读取**可选**资产（v7 批次一引入的 shot-grammar / compliance-checklist / palette）。
 *
 * 这里刻意区分两种失败形态（这是 fail-closed 的精确边界）：
 *   - 文件**不存在** → 返回 {missing:true}：这是一份旧版 kit，增强能力不可用，
 *     但不该让整套影视工程瘫痪。缺失由调用方记入 assetWarnings（可见，不静默）。
 *   - 文件**存在但损坏/不可读/JSON 非法** → 推入 errors：绝不允许拿半份数据继续。
 *
 * 需要「缺失也算失败」的场景（导入校验）用 opts.requireAssets 切到严格模式。
 * @returns {{present: boolean, value?: any, missing?: boolean}}
 */
function readOptionalJsonFile (filePath, label, errors, assetWarnings, requireAssets) {
  if (!fs.existsSync(filePath)) {
    if (requireAssets) {
      errors.push(label + ' 缺失（严格模式要求齐备）')
      return { present: false }
    }
    assetWarnings.push(label + ' 缺失：该增强能力不可用（旧版 kit，请重新导入以启用）')
    return { present: false, missing: true }
  }
  const value = readJsonFile(filePath, label, errors)
  // v7 对抗评审 i7：文件存在、JSON 合法但内容是字面 null 时，原先落进「present 但 value 假值」
  // 的第三态——既不算缺失也不报损坏，静默放行。这里明确按损坏处理。
  if (value === null) {
    errors.push(label + ' 内容为空值（JSON 为 null）：文件存在但不是有效对象')
    return { present: false }
  }
  return { present: true, value }
}

function loadFilmKit (opts) {
  opts = opts || {}
  const kitDir = opts.kitDir
  if (typeof kitDir !== 'string' || !kitDir) return { ok: false, error: 'kitDir 必须为非空字符串' }
  const requireAssets = opts.requireAssets === true
  const errors = []
  /** @type {string[]} */
  const assetWarnings = []

  const manifest = readJsonFile(path.join(kitDir, 'film-manifest.json'), 'film-manifest.json', errors)
  const shots = readJsonFile(path.join(kitDir, 'shot-library.json'), 'shot-library.json', errors)
  const references = readJsonFile(path.join(kitDir, 'reference-registry.json'), 'reference-registry.json', errors)
  const doctrine = readJsonFile(path.join(kitDir, 'prompt-doctrine.json'), 'prompt-doctrine.json', errors)

  const grammarOpt = readOptionalJsonFile(path.join(kitDir, 'shot-grammar.json'), 'shot-grammar.json', errors, assetWarnings, requireAssets)
  const complianceOpt = readOptionalJsonFile(path.join(kitDir, 'compliance-checklist.json'), 'compliance-checklist.json', errors, assetWarnings, requireAssets)
  const paletteOpt = readOptionalJsonFile(path.join(kitDir, 'palette.json'), 'palette.json', errors, assetWarnings, requireAssets)
  const shotGrammar = grammarOpt.present ? grammarOpt.value : null
  const compliance = complianceOpt.present ? complianceOpt.value : null
  const palette = paletteOpt.present ? paletteOpt.value : null

  if (errors.length > 0) return { ok: false, error: errors.join('; ') }

  // 任务化 prompt 库（v7 F30）：同上——目录不存在按「可选缺失」处理，
  // 存在但有任一任务缺语种/缺文件则整体不可用（半个库比没有更危险）。
  const promptsTasksRoot = path.join(kitDir, 'prompts', 'tasks')
  let library = null
  if (!fs.existsSync(promptsTasksRoot)) {
    if (requireAssets) errors.push('prompts/tasks 缺失（严格模式要求齐备）')
    else assetWarnings.push('prompts/tasks 缺失：任务化提示词库不可用（旧版 kit，请重新导入以启用）')
  } else {
    const libraryResult = loadPromptLibrary({ tasksRoot: promptsTasksRoot })
    if (!libraryResult.ok) errors.push('prompts/tasks: ' + libraryResult.error)
    else library = libraryResult.library
  }

  const checks = [
    ['film-manifest.json', validateManifest(manifest)],
    ['shot-library.json', validateShotLibrary(shots)],
    ['reference-registry.json', validateReferences(references)],
    ['prompt-doctrine.json', validateDoctrine(doctrine)],
    ['shot-library.json', validateShotSceneRefs(shots, manifest)],
  ]
  if (grammarOpt.present) checks.push(['shot-grammar.json', validateShotGrammar(shotGrammar)])
  if (complianceOpt.present) checks.push(['compliance-checklist.json', validateComplianceChecklist(compliance)])
  if (paletteOpt.present) checks.push(['palette.json', validatePalette(palette)])
  for (const [label, c] of checks) {
    if (!c.ok) errors.push(label + ': ' + c.error)
  }
  if (errors.length > 0) return { ok: false, error: errors.join('; ') }

  const shotById = new Map()
  for (const s of shots) shotById.set(s.shotId, s)
  const sceneIndex = new Map()
  for (const s of manifest.scenes) sceneIndex.set(s.id, s)
  const shotSceneIndex = new Map()
  for (const s of shots) {
    if (!shotSceneIndex.has(s.sceneId)) shotSceneIndex.set(s.sceneId, [])
    shotSceneIndex.get(s.sceneId).push(s)
  }
  // 枚举索引：按 key 快速查表（调用方不必自己 Array.find）；资产缺失时为 null
  const grammarIndex = shotGrammar
    ? {
        shotSizes: new Map(shotGrammar.shotSizes.map((x) => [x.key, x])),
        cameraMoves: new Map(shotGrammar.cameraMoves.map((x) => [x.key, x])),
        cameraAngles: new Map(shotGrammar.cameraAngles.map((x) => [x.key, x])),
        lightingSetups: new Map(shotGrammar.lightingSetups.map((x) => [x.key, x])),
        vfxPresets: new Map(shotGrammar.vfxPresets.map((x) => [x.key, x])),
        emotionTiers: new Map(shotGrammar.emotionTiers.map((x) => [x.key, x])),
      }
    : null

  return {
    ok: true,
    kit: {
      dir: kitDir,
      manifest,
      shots,
      references,
      doctrine,
      shotGrammar,
      grammarIndex,
      compliance,
      palette,
      promptLibrary: library,
      assetWarnings,
      shotById,
      sceneIndex,
      shotSceneIndex,
      errors,
    },
  }
}

/**
 * 两级 kit 回退链（任务 3.1）：按 dirs 优先级依次尝试（userData 全量 → asar 精简包）。
 * - 目录不存在 → 记入 missing（未导入属正常态，不算回退错误、不告警）
 * - 级内损坏/非法 → 记入 fallbacks 并 log.warn('FILM_KIT_FALLBACK')，错误可见非静默
 * - 全部不可用 → ok:false，error 前缀 FILM_KIT_UNAVAILABLE 并聚合各级具体错误
 * - requireAssets=true 时，v7 增强资产（shot-grammar / compliance / palette / prompts）
 *   的**缺失**也算该级不可用，从而回退到下一级——导入校验与运行期读盘用同一函数，
 *   只是严格度不同。
 * @param {{dirs: Array<{dir: string, label: string}>, log?: {warn: function}, requireAssets?: boolean}} opts
 */
function loadFilmKitChain (opts) {
  opts = opts || {}
  const dirs = Array.isArray(opts.dirs) ? opts.dirs : []
  const log = opts.log || console
  const requireAssets = opts.requireAssets === true
  const fallbacks = []
  const missing = []
  for (const entry of dirs) {
    const dir = entry && entry.dir
    const label = (entry && entry.label) || String(dir)
    if (typeof dir !== 'string' || !dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      missing.push({ dir: String(dir), label, reason: '目录不存在（未导入）' })
      continue
    }
    const r = loadFilmKit({ kitDir: dir, requireAssets })
    if (r.ok) {
      return { ok: true, kit: Object.assign({}, r.kit, { source: label }), fallbacks, missing }
    }
    fallbacks.push({ dir, label, reason: r.error })
    if (log && typeof log.warn === 'function') {
      log.warn('[FILM_KIT_FALLBACK] kit 级不可用，回退下一级: ' + label + ' — ' + r.error)
    }
  }
  const detail = []
    .concat(fallbacks.map((f) => '[' + f.label + '] 损坏: ' + f.reason))
    .concat(missing.map((m) => '[' + m.label + '] ' + m.reason))
  const error = 'FILM_KIT_UNAVAILABLE: 所有 kit 级均不可用 — ' + (detail.join(' | ') || 'dirs 为空')
  return { ok: false, error, fallbacks, missing }
}

module.exports = {
  KIT_FILES,
  MAX_PROMPT_LENGTH,
  FILM_PROMPT_MAX_LEN,
  loadFilmKit,
  loadFilmKitChain,
  validateManifest,
  validateShotLibrary,
  validateShotSceneRefs,
  validateReferences,
  validateDoctrine,
  validateShotGrammar,
  validateComplianceChecklist,
  validatePalette,
  checkSchemaVersion,
}
