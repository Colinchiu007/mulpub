// @ts-check
/**
 * prompt-memory.js — 提示词引擎自进化记忆库 V0
 *
 * 规格：openspec/changes/prompt-engine-evolution-p1b-memory
 * - prompt-library/library.json 索引 + templates/<id>@<version>.json 版本化模板文件
 * - full + fragment 两级；learnt fragment 仅允许 compositionType/action/object/creativeLevel 四类可控参数
 * - 模板含 mode、sourceText（concept 原文）、fingerprint（由 concept 计算落盘）
 * - 版本化优先级：checksum 完全碰撞拒绝 / 同源指纹相似升版 / 否则新 id
 * - 写盘原子性（临时文件 + rename）；损坏库 fail-close 重建
 *
 * 契约铁律：零外部依赖、纯同步、测试 os.tmpdir() 隔离。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { buildFingerprint, DICT_VERSION } = require('./fingerprint')

const SCHEMA_VERSION = 1
const MAX_SOURCE_TEXT = 2000
const ID_PREFIX = 'tpl_'

/** learnt fragment 四类可控参数白名单（越界字段入库即拒绝） */
const FRAGMENT_ALLOWED_KEYS = ['compositionType', 'action', 'object', 'creativeLevel']
const TEMPLATE_STATES = ['draft', 'active', 'deprecated', 'disabled']
const ENGINES = ['image', 'video']
const MODES = ['story2video', 'standalone', 'storyboard']
const TYPES = ['composition', 'style', 'keyword', 'metaphor', 'full', 'fragment']

/** 状态机合法边 */
const STATE_TRANSITIONS = {
  draft: ['active'],
  active: ['deprecated'],
  deprecated: ['disabled'],
  disabled: [],
}

function newId () {
  return ID_PREFIX + crypto.randomBytes(8).toString('hex')
}

function sha256 (text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex')
}

function canonicalJson (obj) {
  // 稳定序列化：key 排序，保证 checksum 确定性
  return JSON.stringify(sortKeys(obj))
}

function sortKeys (obj) {
  if (Array.isArray(obj)) return obj.map(sortKeys)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k])
    return out
  }
  return obj
}

function isPlainObject (v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {object} opts
 * @param {string} opts.libraryRoot - userData/prompt-library
 * @param {object} [opts.config]
 * @param {(templateId:string)=>object|null} [opts.statsProvider]
 * @param {object} [opts.log]
 * @param {()=>Date} [opts.now]
 * @param {(template:object)=>object} [opts.gate] - 门禁函数（governance.runGates），返回 {pass, results, checksum}；未注入时跳过门禁
 */
function createPromptMemory (opts) {
  const libraryRoot = opts.libraryRoot
  const log = opts.log || { info: () => {}, warn: () => {}, error: () => {} }
  const statsProvider = opts.statsProvider || (() => null)
  const nowFn = opts.now || (() => new Date())
  let gate = typeof opts.gate === 'function' ? opts.gate : null

  /** @type {Record<string, object>} 内存索引：id -> {index 摘要} */
  let index = { schemaVersion: SCHEMA_VERSION, dictVersion: DICT_VERSION, items: {} }
  /** @type {Map<string, object>} 内存模板缓存：id -> 最新版本完整模板 */
  const templatesCache = new Map()
  /** @type {Set<string>} stale 模板 id（dictVersion 不匹配且无法重算） */
  const staleIds = new Set()

  function templatesDir () {
    return path.join(libraryRoot, 'templates')
  }

  function indexPath () {
    return path.join(libraryRoot, 'library.json')
  }

  function templatePath (id, version) {
    return path.join(templatesDir(), id + '@' + version + '.json')
  }

  function ensureDir (dir) {
    fs.mkdirSync(dir, { recursive: true })
  }

  /** 原子写：临时文件 + rename（Windows 原子替换语义） */
  function atomicWrite (file, content) {
    ensureDir(path.dirname(file))
    const tmp = file + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
  }

  /** 计算 content 的 checksum（canonical JSON） */
  function contentChecksum (content) {
    return sha256(canonicalJson(content || {}))
  }

  /** 计算指纹相似度（复用 fingerprint 的 score，判定是否"相似"） */
  function fingerprintSimilar (a, b) {
    if (!a || !b) return false
    // 简单相似：compositionIntents 有交集 或 domains 有交集
    const aIntents = new Set(a.compositionIntents || [])
    const bIntents = new Set(b.compositionIntents || [])
    const aDomains = new Set(a.domains || [])
    const bDomains = new Set(b.domains || [])
    const intentHit = [...aIntents].filter((x) => bIntents.has(x)).length
    const domainHit = [...aDomains].filter((x) => bDomains.has(x)).length
    return intentHit >= 1 || domainHit >= 1
  }

  /** 校验 learnt fragment content 仅四类参数 */
  function validateFragmentContent (content) {
    if (!isPlainObject(content)) return false
    const keys = Object.keys(content)
    if (keys.length === 0) return false
    return keys.every((k) => FRAGMENT_ALLOWED_KEYS.includes(k))
  }

  /** 归一化并校验入参，返回 {ok, template?, error?} */
  function normalizeTemplate (input) {
    if (!isPlainObject(input)) return { ok: false, error: 'TEMPLATE_INVALID' }
    const engine = input.engine
    const mode = input.mode
    const type = input.type
    const content = input.content
    const concept = String(input.concept == null ? '' : input.concept).slice(0, MAX_SOURCE_TEXT)
    const eventId = input.eventId

    if (!ENGINES.includes(engine)) return { ok: false, error: 'TEMPLATE_INVALID' }
    if (!MODES.includes(mode)) return { ok: false, error: 'TEMPLATE_INVALID' }
    if (!TYPES.includes(type)) return { ok: false, error: 'TEMPLATE_INVALID' }
    if (typeof eventId !== 'string' || !eventId.startsWith('evt_')) {
      return { ok: false, error: 'TEMPLATE_INVALID' }
    }
    if (!isPlainObject(content)) return { ok: false, error: 'TEMPLATE_INVALID' }
    // learnt fragment 四类参数白名单
    if (type === 'fragment' && !validateFragmentContent(content)) {
      return { ok: false, error: 'TEMPLATE_GATE_FAILED' }
    }

    const fingerprint = buildFingerprint(concept)
    const now = nowFn().toISOString()
    const template = {
      id: '', // 由 saveLearnt 分配
      version: 1,
      engine,
      mode,
      type,
      content,
      sourceText: concept,
      fingerprint,
      source: 'learnt',
      provenance: { learnedFrom: eventId, acceptedEvents: [] },
      stats: { uses: 0, acceptRate: 0, avgScore: null, avgCost: 0, lastUsedAt: null },
      state: 'draft',
      guard: {
        checksum: contentChecksum(content),
        validatedAt: now,
        gateRules: ['structure', 'compliance', 'length', 'noSecrets', 'dedup'],
        evaluatorVersion: 'rule-v0',
      },
      createdAt: now,
      updatedAt: now,
      confirmedBy: null,
    }
    return { ok: true, template }
  }

  /** 加载 library.json + 全部模板文件到内存 */
  function load () {
    templatesCache.clear()
    staleIds.clear()
    // 读取索引；损坏则重建空库
    try {
      if (fs.existsSync(indexPath())) {
        const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf8'))
        if (raw && raw.schemaVersion === SCHEMA_VERSION && raw.items && typeof raw.items === 'object') {
          index = raw
        } else {
          log.warn('PromptMemory', 'library.json 结构非法，重建空库')
          index = { schemaVersion: SCHEMA_VERSION, dictVersion: DICT_VERSION, items: {} }
        }
      } else {
        index = { schemaVersion: SCHEMA_VERSION, dictVersion: DICT_VERSION, items: {} }
      }
    } catch (e) {
      log.warn('PromptMemory', 'library.json 损坏，重建空库: ' + e.message)
      index = { schemaVersion: SCHEMA_VERSION, dictVersion: DICT_VERSION, items: {} }
    }

    // 加载每个模板的最新版本
    const items = index.items || {}
    for (const id of Object.keys(items)) {
      const item = items[id]
      const latestVersion = item.latestVersion
      const tplPath = templatePath(id, latestVersion)
      try {
        if (!fs.existsSync(tplPath)) {
          log.warn('PromptMemory', '模板文件缺失: ' + id + '@' + latestVersion)
          continue
        }
        const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8'))
        if (!tpl || tpl.id !== id) {
          log.warn('PromptMemory', '模板文件 id 不匹配: ' + id)
          continue
        }
        // dictVersion 校验：不一致则以 sourceText 重算；无法重算标 stale
        if (tpl.fingerprint && tpl.fingerprint.dictVersion !== DICT_VERSION) {
          if (typeof tpl.sourceText === 'string' && tpl.sourceText.length > 0) {
            tpl.fingerprint = buildFingerprint(tpl.sourceText)
          } else {
            staleIds.add(id)
            log.warn('PromptMemory', '模板 dictVersion 过期且无 sourceText，标 stale: ' + id)
          }
        }
        // fingerprint 缺失 fail-close
        if (!tpl.fingerprint || typeof tpl.fingerprint !== 'object') {
          staleIds.add(id)
          log.warn('PromptMemory', '模板 fingerprint 缺失，标 stale: ' + id)
          continue
        }
        // 注入实时 stats
        const stats = statsProvider(id)
        if (stats && typeof stats === 'object') tpl.stats = { ...tpl.stats, ...stats }
        templatesCache.set(id, tpl)
      } catch (e) {
        log.warn('PromptMemory', '模板加载失败，跳过: ' + id + ': ' + e.message)
      }
    }
  }

  /** 持久化索引 */
  function persistIndex () {
    atomicWrite(indexPath(), JSON.stringify(index, null, 2))
  }

  /** 持久化单个模板 */
  function persistTemplate (tpl) {
    atomicWrite(templatePath(tpl.id, tpl.version), JSON.stringify(tpl, null, 2))
  }

  /** 更新索引条目 */
  function upsertIndexItem (tpl) {
    const items = index.items || {}
    const existing = items[tpl.id]
    if (existing) {
      existing.latestVersion = tpl.version
      existing.state = tpl.state
      existing.updatedAt = tpl.updatedAt
      if (!existing.versions.includes(tpl.version)) existing.versions.push(tpl.version)
    } else {
      items[tpl.id] = {
        id: tpl.id,
        engine: tpl.engine,
        mode: tpl.mode,
        type: tpl.type,
        versions: [tpl.version],
        latestVersion: tpl.version,
        state: tpl.state,
        createdAt: tpl.createdAt,
        updatedAt: tpl.updatedAt,
      }
    }
    index.items = items
    persistIndex()
  }

  /** 写模板到磁盘（供测试/内部使用） */
  function _writeTemplate (tpl) {
    persistTemplate(tpl)
    upsertIndexItem(tpl)
    // 更新内存缓存
    if (tpl.fingerprint && typeof tpl.fingerprint === 'object') {
      templatesCache.set(tpl.id, tpl)
      staleIds.delete(tpl.id)
    }
  }

  /**
   * 入库主入口：归一化 → fingerprint → 门禁 → 写 draft。
   * @returns {{ok:boolean, id?:string, version?:number, state?:string, code?:string}}
   */
  function saveLearnt (input) {
    const norm = normalizeTemplate(input)
    if (!norm.ok) return { ok: false, code: norm.error }

    const tpl = norm.template
    const checksum = tpl.guard.checksum

    // CCG 评审修复：接入 governance.runGates 门禁（6 规则：structure/compliance/length/noSecrets/dedup/evaluatorVersion）
    // 门禁失败 → 拒绝入库（fail-closed）；未注入 gate 时跳过（兼容测试/降级路径）
    if (gate) {
      const g = gate(tpl)
      if (!g.pass) return { ok: false, code: 'TEMPLATE_GATE_FAILED' }
      // 门禁通过后以门禁计算的 checksum 覆盖（dedup 规则产出）
      if (g.checksum) tpl.guard.checksum = g.checksum
    }

    // 版本优先级（m9）：(1) checksum 完全碰撞拒绝；(2) 同源指纹相似升版；(3) 否则新 id
    let collisionId = null
    let upgradeId = null
    for (const [id, cached] of templatesCache.entries()) {
      if (cached.state === 'disabled') continue
      if (cached.guard && cached.guard.checksum === checksum) {
        collisionId = id
        break
      }
      if (cached.provenance && cached.provenance.learnedFrom === tpl.provenance.learnedFrom &&
          fingerprintSimilar(cached.fingerprint, tpl.fingerprint)) {
        upgradeId = id
      }
    }

    if (collisionId) return { ok: false, code: 'TEMPLATE_GATE_FAILED' }

    if (upgradeId) {
      const existing = templatesCache.get(upgradeId)
      tpl.id = upgradeId
      tpl.version = existing.version + 1
      tpl.createdAt = existing.createdAt
      tpl.provenance = existing.provenance
      tpl.stats = existing.stats
      tpl.state = 'draft' // 升版重置为 draft，需重新确认
      tpl.updatedAt = nowFn().toISOString()
      _writeTemplate(tpl)
      return { ok: true, id: tpl.id, version: tpl.version, state: tpl.state }
    }

    tpl.id = newId()
    _writeTemplate(tpl)
    return { ok: true, id: tpl.id, version: tpl.version, state: tpl.state }
  }

  /** 列表（供 prompt-library:list） */
  function list (filter = {}) {
    const out = []
    for (const [id, tpl] of templatesCache.entries()) {
      if (filter.state && tpl.state !== filter.state) continue
      if (filter.engine && tpl.engine !== filter.engine) continue
      if (filter.type && tpl.type !== filter.type) continue
      out.push({
        id,
        engine: tpl.engine,
        mode: tpl.mode,
        type: tpl.type,
        version: tpl.version,
        state: tpl.state,
        source: tpl.source,
        createdAt: tpl.createdAt,
        updatedAt: tpl.updatedAt,
        stale: staleIds.has(id),
      })
    }
    return out
  }

  /** 仅 active + fingerprint 有效的模板（供 fingerprint 检索） */
  function listActive (filter = {}) {
    const out = []
    for (const [id, tpl] of templatesCache.entries()) {
      if (tpl.state !== 'active') continue
      if (staleIds.has(id)) continue
      if (filter.engine && tpl.engine !== filter.engine) continue
      out.push({ id, fingerprint: tpl.fingerprint, stats: tpl.stats })
    }
    return out
  }

  /** 单模板详情 */
  function get (id, version) {
    const tpl = templatesCache.get(id)
    if (!tpl) return null
    if (version && version !== tpl.version) {
      // CCG 评审修复：version 必须为正整数（防路径穿越，如 ../../ 逃出 templates 目录）
      const v = Number(version)
      if (!Number.isInteger(v) || v <= 0) return null
      // 读取指定历史版本
      const p = templatePath(id, v)
      if (!fs.existsSync(p)) return null
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'))
      } catch {
        return null
      }
    }
    return { ...tpl, stale: staleIds.has(id) }
  }

  /** draft→active（人工确认） */
  function activate (id, { confirmedBy } = {}) {
    const tpl = templatesCache.get(id)
    if (!tpl) return null
    if (tpl.state !== 'draft') return null
    tpl.state = 'active'
    tpl.confirmedBy = typeof confirmedBy === 'string' && confirmedBy.length > 0
      ? crypto.createHmac('sha256', 'mp-confirm-salt').update(confirmedBy).digest('hex')
      : null
    tpl.updatedAt = nowFn().toISOString()
    _writeTemplate(tpl)
    return { id, version: tpl.version, state: tpl.state }
  }

  /** active→deprecated（治理回滚调用） */
  function deprecate (id, { reason } = {}) {
    const tpl = templatesCache.get(id)
    if (!tpl) return null
    if (tpl.state !== 'active') return null
    tpl.state = 'deprecated'
    tpl.deprecationReason = reason || null
    tpl.cooldownUntil = new Date(nowFn().getTime() + 24 * 60 * 60 * 1000).toISOString()
    tpl.updatedAt = nowFn().toISOString()
    _writeTemplate(tpl)
    return { id, version: tpl.version, state: tpl.state }
  }

  /** deprecated→disabled（终态） */
  function disable (id) {
    const tpl = templatesCache.get(id)
    if (!tpl) return null
    if (tpl.state !== 'deprecated') return null
    tpl.state = 'disabled'
    tpl.updatedAt = nowFn().toISOString()
    _writeTemplate(tpl)
    return { id, version: tpl.version, state: tpl.state }
  }

  /** 内部：直接设置状态（供测试状态机校验） */
  function _setState (id, to) {
    const tpl = templatesCache.get(id)
    if (!tpl) return null
    const allowed = STATE_TRANSITIONS[tpl.state] || []
    if (!allowed.includes(to)) throw new Error('非法状态流转: ' + tpl.state + ' -> ' + to)
    tpl.state = to
    tpl.updatedAt = nowFn().toISOString()
    _writeTemplate(tpl)
    return { id, state: tpl.state }
  }

  /** dictVersion 变更时以 sourceText 重算全部指纹 */
  function refreshFingerprints () {
    let changed = 0
    for (const [id, tpl] of templatesCache.entries()) {
      if (tpl.fingerprint && tpl.fingerprint.dictVersion !== DICT_VERSION) {
        if (typeof tpl.sourceText === 'string' && tpl.sourceText.length > 0) {
          tpl.fingerprint = buildFingerprint(tpl.sourceText)
          _writeTemplate(tpl)
          changed++
        } else {
          staleIds.add(id)
        }
      }
    }
    return changed
  }

  /** 注入/更新门禁函数（governance.runGates；解决 governance↔memory 循环依赖，由接线方在创建 governance 后调用） */
  function _setGate (fn) {
    gate = typeof fn === 'function' ? fn : null
  }

  return { load, list, listActive, get, saveLearnt, activate, deprecate, disable, refreshFingerprints, _writeTemplate, _setState, _setGate }
}

module.exports = {
  createPromptMemory,
  FRAGMENT_ALLOWED_KEYS,
  TEMPLATE_STATES,
  STATE_TRANSITIONS,
  SCHEMA_VERSION,
}