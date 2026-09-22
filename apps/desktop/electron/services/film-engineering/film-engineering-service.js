// @ts-check
'use strict'
/**
 * film-engineering-service - 影视工程聚合服务
 *
 * 持有 film-kit（懒加载 + fail-closed），组合 ShotLibrary / ScriptAdapter，
 * 对外提供 IPC handler 所需的全部能力：
 *   - status / listScenes / listShots / getShot / doctrine
 *   - buildCopyText / buildCopyTexts（一键复制）
 *   - adaptScript（剧本套用，可接 LLM 润色）
 *   - exportPrompts（JSON/Markdown）
 *   - generateSelected（勾选分镜 → 复用 assetGenerator 生成图片）
 */

const fs = require('fs')
const path = require('path')

const { loadFilmKitChain } = require('./kit-loader')
const { ShotLibrary } = require('./shot-library')
const { ScriptAdapter } = require('./script-adapt')

const DEFAULT_KIT_DIR = path.join(__dirname, '..', '..', 'film-kit')
const MAX_GENERATE_BATCH = 20

class FilmEngineeringService {
  /**
   * @param {object} opts
   * @param {string} [opts.kitDir] - film-kit 目录（默认 electron/film-kit，回退链末级）
   * @param {string} [opts.userDataKitDir] - userData 全量 kit 目录（回退链首级，任务 3.2）
   * @param {object} [opts.log]
   * @param {object|null} [opts.assetGenerator] - AssetGenerator 实例（勾选生成用）
   * @param {object|null} [opts.llm] - 可选 LLM 润色器（ScriptAdapter 用）
   */
  constructor (opts) {
    opts = opts || {}
    this.kitDir = opts.kitDir || DEFAULT_KIT_DIR
    this.userDataKitDir = opts.userDataKitDir || null
    this.log = opts.log || null
    this.assetGenerator = opts.assetGenerator || null
    this.llm = opts.llm || null
    this._kit = null
    this._loadError = null
    this._shotLibrary = null
    this._scriptAdapter = null
  }

  /** 懒加载 kit（失败缓存，fail-closed） */
  _ensureKit () {
    if (this._kit) return this._kit
    if (this._loadError) throw this._loadError
    // 两级回退链（任务 3.2）：userData 全量优先，损坏回退 asar 精简包（错误可见非静默）
    const dirs = []
    if (this.userDataKitDir) dirs.push({ dir: this.userDataKitDir, label: 'userData-full' })
    dirs.push({ dir: this.kitDir, label: 'asar-bundled' })
    const loaded = loadFilmKitChain({ dirs, log: this.log || undefined })
    if (!loaded.ok) {
      const raw = String(loaded.error || '')
      const err = new Error(raw.startsWith('FILM_KIT_UNAVAILABLE') ? raw : 'FILM_KIT_UNAVAILABLE: ' + raw)
      this._loadError = err
      throw err
    }
    this._kit = loaded.kit
    this._shotLibrary = new ShotLibrary({ kit: this._kit, log: this.log })
    this._scriptAdapter = new ScriptAdapter({ kit: this._kit, llm: this.llm, log: this.log })
    return this._kit
  }

  /** kit 状态（不抛错；失败返回 available=false + error） */
  getStatus () {
    try {
      const kit = this._ensureKit()
      return {
        available: true,
        kitSource: kit.source || 'asar-bundled',
        filmMeta: kit.manifest.filmMeta,
        sceneCount: kit.manifest.scenes.length,
        shotCount: kit.shots.length,
        referenceCount: Object.keys(kit.references).length,
        error: null,
      }
    } catch (e) {
      return {
        available: false,
        filmMeta: null,
        sceneCount: 0,
        shotCount: 0,
        referenceCount: 0,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  listScenes () {
    return this._ensure().listScenes()
  }

  listShots (sceneId, opts) {
    return this._ensure().listShots(sceneId, opts)
  }

  getShot (shotId) {
    return this._ensure().getShot(shotId)
  }

  getDoctrine () {
    const kit = this._ensureKit()
    return kit.doctrine
  }

  buildCopyText (shotId, mode) {
    return this._ensure().buildCopyText(shotId, mode)
  }

  buildCopyTexts (shotIds, mode) {
    return this._ensure().buildCopyTexts(shotIds, mode)
  }

  /** 剧本套用 */
  async adaptScript ({ script, characterMap, llmEnabled }) {
    this._ensureKit()
    return this._scriptAdapter.adaptScript({ script, characterMap, llmEnabled })
  }

  /** 导出提示词（JSON/Markdown） */
  exportPrompts (selectedShots, format) {
    if (!Array.isArray(selectedShots) || selectedShots.length === 0) {
      throw new Error('selectedShots 必须为非空数组')
    }
    if (selectedShots.length > 50) {
      throw new Error('一次最多导出 50 个分镜')
    }
    const fmt = format === 'markdown' ? 'markdown' : 'json'
    const json = JSON.stringify(selectedShots.map((s) => ({
      shotId: s.shotId,
      sceneId: s.sceneId,
      prompt: s.prompt,
      model: s.model,
      refTokens: Array.isArray(s.refTokens) ? s.refTokens : [],
    })), null, 2)
    const markdown = selectedShots.map((s, i) =>
      '## [' + (i + 1) + '] ' + s.sceneId + ' · ' + s.model + '\n\n' + s.prompt,
    ).join('\n\n---\n\n')
    return {
      export: { json, markdown },
      fileName: 'film-engineering-prompts-' + new Date().toISOString().slice(0, 10) + '.' + fmt,
    }
  }

  /**
   * 勾选分镜生成图片（复用 assetGenerator；一次最多 20 个）
   * @param {Array<object>} selectedShots
   * @param {object} [opts] - { aspectRatio }
   * @returns {Promise<{ok: boolean, results?: Array<object>, error?: string}>}
   */
  async generateSelected (selectedShots, opts) {
    if (!Array.isArray(selectedShots) || selectedShots.length === 0) {
      return { ok: false, error: '请先勾选分镜' }
    }
    if (selectedShots.length > MAX_GENERATE_BATCH) {
      return { ok: false, error: '一次最多生成 ' + MAX_GENERATE_BATCH + ' 个分镜（当前 ' + selectedShots.length + '）' }
    }
    if (!this.assetGenerator || typeof this.assetGenerator.generateImage !== 'function') {
      return { ok: false, error: '图片生成能力不可用（未配置 assetGenerator/Provider），请先在模型设置中配置图片生成 Provider' }
    }
    const aspectRatio = (opts && opts.aspectRatio) || '16:9'
    const results = []
    for (let i = 0; i < selectedShots.length; i++) {
      const shot = selectedShots[i]
      const prompt = shot && typeof shot.prompt === 'string' ? shot.prompt : ''
      if (!prompt.trim()) {
        return { ok: false, error: '第 ' + (i + 1) + ' 个分镜提示词为空' }
      }
      try {
        const r = await this.assetGenerator.generateImage(prompt, {
          style: 'cinematic',
          index: i,
          aspect_ratio: aspectRatio,
        })
        results.push({ index: i, shotId: shot.shotId, ...(r || { code: -1, message: '生成返回为空' }) })
      } catch (e) {
        results.push({ index: i, shotId: shot.shotId, code: -1, message: e instanceof Error ? e.message : String(e) })
      }
    }
    const failed = results.filter((r) => r.code !== 0)
    if (failed.length === results.length) {
      return { ok: false, error: '分镜生成全部失败：' + failed[0].message, results }
    }
    return { ok: true, results, partialFailure: failed.length > 0 }
  }

  _ensure () {
    const kit = this._ensureKit()
    return this._shotLibrary
  }
}

module.exports = {
  DEFAULT_KIT_DIR,
  MAX_GENERATE_BATCH,
  FilmEngineeringService,
}
