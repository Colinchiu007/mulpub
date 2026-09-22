// @ts-check
'use strict'
/**
 * kit-loader - film-kit 数据资产加载与 schema 校验
 *
 * film-kit 是随包携带的《Hell Grind》影视工程数据资产：
 *   film-manifest.json       电影元数据 + 场景树（sceneId/名称/计数/层级/来源URL）
 *   shot-library.json        分镜库：每场景代表性真实提示词 + 模型 + 参考 token + 结果 URL
 *   reference-registry.json  token → 参考素材索引（角色/场景/道具 + 图 URL + 描述）
 *   prompt-doctrine.json     Hell Grind 提示词架构（块模板 + 铁律 + 词汇表，中英双语）
 *   images/                  精选参考图（min 版）
 *
 * fail-closed 契约：任一文件缺失 / JSON 损坏 / schema 非法 → kit 整体不可用，
 * 不允许静默降级为部分数据。调用方（IPC）据此返回 FILM_KIT_UNAVAILABLE。
 */

const fs = require('fs')
const path = require('path')

const KIT_FILES = ['film-manifest.json', 'shot-library.json', 'reference-registry.json', 'prompt-doctrine.json']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// D4 四处同源：与 fetch-hell-grind-kit.py FILM_PROMPT_MAX_LEN 同值（导入/校验单一契约）
const FILM_PROMPT_MAX_LEN = 50000
const MAX_PROMPT_LENGTH = FILM_PROMPT_MAX_LEN // 兼容别名，勿在新代码中使用
const MAX_TOKEN_LENGTH = 64

function isUuidLike (value) {
  return typeof value === 'string' && UUID_RE.test(value)
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

function loadFilmKit (opts) {
  opts = opts || {}
  const kitDir = opts.kitDir
  if (typeof kitDir !== 'string' || !kitDir) return { ok: false, error: 'kitDir 必须为非空字符串' }
  const errors = []

  const manifest = readJsonFile(path.join(kitDir, 'film-manifest.json'), 'film-manifest.json', errors)
  const shots = readJsonFile(path.join(kitDir, 'shot-library.json'), 'shot-library.json', errors)
  const references = readJsonFile(path.join(kitDir, 'reference-registry.json'), 'reference-registry.json', errors)
  const doctrine = readJsonFile(path.join(kitDir, 'prompt-doctrine.json'), 'prompt-doctrine.json', errors)

  if (errors.length > 0) return { ok: false, error: errors.join('; ') }

  const checks = [
    ['film-manifest.json', validateManifest(manifest)],
    ['shot-library.json', validateShotLibrary(shots)],
    ['reference-registry.json', validateReferences(references)],
    ['prompt-doctrine.json', validateDoctrine(doctrine)],
    ['shot-library.json', validateShotSceneRefs(shots, manifest)],
  ]
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

  return {
    ok: true,
    kit: {
      dir: kitDir,
      manifest,
      shots,
      references,
      doctrine,
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
 * @param {{dirs: Array<{dir: string, label: string}>, log?: {warn: function}}} opts
 */
function loadFilmKitChain (opts) {
  opts = opts || {}
  const dirs = Array.isArray(opts.dirs) ? opts.dirs : []
  const log = opts.log || console
  const fallbacks = []
  const missing = []
  for (const entry of dirs) {
    const dir = entry && entry.dir
    const label = (entry && entry.label) || String(dir)
    if (typeof dir !== 'string' || !dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      missing.push({ dir: String(dir), label, reason: '目录不存在（未导入）' })
      continue
    }
    const r = loadFilmKit({ kitDir: dir })
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
}
