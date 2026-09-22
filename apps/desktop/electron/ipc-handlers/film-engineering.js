// @ts-check
'use strict'
/**
 * film-engineering IPC handlers
 *
 * 通道（全部 withSenderCheck + 入参运行时校验）：
 *   film-engineering:status
 *   film-engineering:list-scenes
 *   film-engineering:list-shots          (sceneId)
 *   film-engineering:get-shot            (shotId)
 *   film-engineering:doctrine
 *   film-engineering:copy-text           (shotId, mode)
 *   film-engineering:copy-texts          (shotIds, mode)
 *   film-engineering:adapt-script        (script, characterMap, llmEnabled?)
 *   film-engineering:export              (selectedShots, format)
 *   film-engineering:generate-selected   (selectedShots, opts)
 */

const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('./helpers')
const fs = require('fs')
const {
  generateShotVideo, resolveFilmVideoProvider, getFilmRunDir, FILM_ASPECTS, FILM_DURATIONS,
} = require('../services/film-engineering/video-gen')

const MAX_SCRIPT_LENGTH = 10000
const MAX_CHARACTER_MAP_KEYS = 10
const MAX_SHOTS_ARRAY = 50
const MAX_GENERATE_BATCH = 20

function registerHandlers (ipcMain, deps) {
  const log = deps.log || { info () {}, warn () {}, error () {} }
  const service = deps.filmEngineeringService
  const pipelineEngine = deps.pipelineEngine
  const aiGenerator = deps.aiGenerator

  function kitError (e) {
    const message = e instanceof Error ? e.message : String(e)
    return message.startsWith('FILM_KIT_UNAVAILABLE')
      ? { code: EC.REQUEST_ERROR, message }
      : null
  }

  function withKit (fn) {
    return (event, ...args) => {
      try {
        return { code: 0, data: fn(event, ...args) }
      } catch (e) {
        const kitErr = kitError(e)
        if (kitErr) return kitErr
        if (e && Number.isInteger(e.code)) {
          return { code: e.code, message: e instanceof Error ? e.message : String(e) }
        }
        log.warn('[film-engineering] error:', e instanceof Error ? e.message : String(e))
        return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
      }
    }
  }

  ipcMain.handle('film-engineering:status', withSenderCheck(withKit(() => service.getStatus())))

  ipcMain.handle('film-engineering:list-scenes', withSenderCheck(withKit(() => service.listScenes())))

  ipcMain.handle('film-engineering:list-shots', withSenderCheck(withKit((_e, sceneId, pageOpts) => {
    if (typeof sceneId !== 'string' || !sceneId.trim()) {
      throw Object.assign(new Error('sceneId 必须为非空字符串'), { code: EC.VALIDATION_ERROR })
    }
    // 分页参数负载守卫（任务 4.2）：必须是纯对象；limit/offset 必须是整数（或省略）。
    if (pageOpts !== undefined && pageOpts !== null) {
      if (typeof pageOpts !== 'object' || Array.isArray(pageOpts)) {
        throw Object.assign(new Error('分页参数必须为对象 {limit, offset}'), { code: EC.VALIDATION_ERROR })
      }
      for (const key of ['limit', 'offset']) {
        const v = pageOpts[key]
        if (v !== undefined && v !== null && !Number.isInteger(v)) {
          throw Object.assign(new Error('分页参数 ' + key + ' 必须为整数'), { code: EC.VALIDATION_ERROR })
        }
      }
    }
    return service.listShots(sceneId, pageOpts)
  })))

  ipcMain.handle('film-engineering:get-shot', withSenderCheck(withKit((_e, shotId) => {
    if (typeof shotId !== 'string' || !shotId.trim()) {
      throw Object.assign(new Error('shotId 必须为非空字符串'), { code: EC.VALIDATION_ERROR })
    }
    return service.getShot(shotId)
  })))

  ipcMain.handle('film-engineering:doctrine', withSenderCheck(withKit(() => service.getDoctrine())))

  ipcMain.handle('film-engineering:copy-text', withSenderCheck(withKit((_e, shotId, mode) => {
    if (typeof shotId !== 'string' || !shotId.trim()) {
      throw Object.assign(new Error('shotId 必须为非空字符串'), { code: EC.VALIDATION_ERROR })
    }
    const m = typeof mode === 'string' && mode.trim() ? mode.trim() : 'full'
    return { text: service.buildCopyText(shotId, m), mode: m }
  })))

  ipcMain.handle('film-engineering:copy-texts', withSenderCheck(withKit((_e, shotIds, mode) => {
    if (!Array.isArray(shotIds) || shotIds.length === 0 || shotIds.length > MAX_SHOTS_ARRAY) {
      throw Object.assign(new Error('shotIds 必须为 1-' + MAX_SHOTS_ARRAY + ' 项的数组'), { code: EC.VALIDATION_ERROR })
    }
    for (const id of shotIds) {
      if (typeof id !== 'string' || !id.trim()) {
        throw Object.assign(new Error('shotIds 含非法分镜 id'), { code: EC.VALIDATION_ERROR })
      }
    }
    const m = typeof mode === 'string' && mode.trim() ? mode.trim() : 'full'
    return { text: service.buildCopyTexts(shotIds, m), mode: m, count: shotIds.length }
  })))

  ipcMain.handle('film-engineering:adapt-script', withSenderCheck(async (_event, payload) => {
    const params = payload || {}
    const script = params.script
    const characterMap = params.characterMap
    if (typeof script !== 'string' || !script.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '剧本不能为空' }
    }
    if (script.length > MAX_SCRIPT_LENGTH) {
      return { code: EC.VALIDATION_ERROR, message: '剧本不能超过 ' + MAX_SCRIPT_LENGTH + ' 字' }
    }
    if (!characterMap || typeof characterMap !== 'object' || Array.isArray(characterMap)) {
      return { code: EC.VALIDATION_ERROR, message: '角色映射必须为对象' }
    }
    const keys = Object.keys(characterMap)
    if (keys.length > MAX_CHARACTER_MAP_KEYS) {
      return { code: EC.VALIDATION_ERROR, message: '角色映射最多 ' + MAX_CHARACTER_MAP_KEYS + ' 个键' }
    }
    for (const k of keys) {
      if (typeof characterMap[k] !== 'string' || !characterMap[k].trim()) {
        return { code: EC.VALIDATION_ERROR, message: '角色映射[' + k + '] 必须为非空字符串' }
      }
    }
    try {
      const result = await service.adaptScript({
        script,
        characterMap,
        llmEnabled: params.llmEnabled === true,
      })
      if (!result.ok) {
        return { code: EC.REQUEST_ERROR, message: result.error }
      }
      return { code: 0, data: { adaptedShots: result.adaptedShots, llmEnhanced: result.llmEnhanced, warnings: result.warnings || [] } }
    } catch (e) {
      log.warn('[film-engineering] adapt-script error:', e instanceof Error ? e.message : String(e))
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  ipcMain.handle('film-engineering:export', withSenderCheck(withKit((_e, selectedShots, format) => {
    if (!Array.isArray(selectedShots) || selectedShots.length === 0 || selectedShots.length > MAX_SHOTS_ARRAY) {
      throw Object.assign(new Error('selectedShots 必须为 1-' + MAX_SHOTS_ARRAY + ' 项的数组'), { code: EC.VALIDATION_ERROR })
    }
    for (const s of selectedShots) {
      if (!s || typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > 50000) {
        throw Object.assign(new Error('selectedShots 每项必须含非空 prompt（<=50000 字符）'), { code: EC.VALIDATION_ERROR })
      }
    }
    const fmt = format === 'markdown' ? 'markdown' : 'json'
    return service.exportPrompts(selectedShots, fmt)
  })))

  ipcMain.handle('film-engineering:generate-selected', withSenderCheck(async (_event, selectedShots, opts) => {
    if (!Array.isArray(selectedShots) || selectedShots.length === 0 || selectedShots.length > MAX_GENERATE_BATCH) {
      return { code: EC.VALIDATION_ERROR, message: 'selectedShots 必须为 1-' + MAX_GENERATE_BATCH + ' 项的数组' }
    }
    for (const s of selectedShots) {
      if (!s || typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > 50000) {
        return { code: EC.VALIDATION_ERROR, message: 'selectedShots 每项必须含非空 prompt（<=50000 字符）' }
      }
    }
    try {
      const result = await service.generateSelected(selectedShots, opts || {})
      if (!result.ok) {
        return { code: EC.REQUEST_ERROR, message: result.error, data: result.results ? { results: result.results } : undefined }
      }
      return { code: 0, data: { results: result.results, partialFailure: result.partialFailure } }
    } catch (e) {
      log.warn('[film-engineering] generate-selected error:', e instanceof Error ? e.message : String(e))
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  // 单镜重试（D7）：service 直调，覆盖该镜 shot_NNN.mp4，绝不触碰流水线阶段状态机；
  // 原文直送合同——prompt 取 run 内 selectedShots[shotIndex].prompt 逐字符提交，不经优化器。
  ipcMain.handle('film-engineering:retry-shot', withSenderCheck(async (_event, payload) => {
    const params = payload || {}
    const runId = params.runId
    const shotIndex = params.shotIndex
    if (typeof runId !== 'string' || !runId.trim()) {
      return { code: EC.VALIDATION_ERROR, message: 'runId 必须为非空字符串' }
    }
    if (!Number.isInteger(shotIndex) || shotIndex < 0) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIndex 必须为非负整数' }
    }
    const snapshot = pipelineEngine && typeof pipelineEngine.getRunSnapshot === 'function'
      ? pipelineEngine.getRunSnapshot(runId)
      : null
    if (!snapshot) {
      return { code: EC.VALIDATION_ERROR, message: 'runId 不属于任何运行中的流水线: ' + runId }
    }
    const shots = (snapshot.context && Array.isArray(snapshot.context.selectedShots)) ? snapshot.context.selectedShots : []
    if (shots.length === 0) {
      return { code: EC.VALIDATION_ERROR, message: 'selectedShots 为空，该 run 无可重试分镜' }
    }
    if (shotIndex >= shots.length) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIndex 不属于该 run（有效范围 0-' + (shots.length - 1) + '）' }
    }
    const shot = shots[shotIndex]
    if (!shot || typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '该镜提示词为空，无法重试' }
    }
    const aspect = FILM_ASPECTS.includes(params.aspect) ? params.aspect : '16x9'
    const seconds = FILM_DURATIONS.includes(Number(params.seconds)) ? Number(params.seconds) : 5
    const providerCfg = resolveFilmVideoProvider(aiGenerator)
    if (!providerCfg) {
      return {
        code: EC.REQUEST_ERROR,
        errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
        message: '影视工程视频重试需要视频模型（如 Seedance / Kling / Veo / CogVideo 等），请在模型设置中配置并设为默认视频 Provider 后重试',
      }
    }
    const runDir = getFilmRunDir(runId)
    try { fs.mkdirSync(runDir, { recursive: true }) } catch (e) { /* 目录已存在，忽略 */ }
    const result = await generateShotVideo({
      shot, index: shotIndex, runDir, aspect, seconds, providerCfg,
      sleep: deps._testSleep, download: deps._testDownload, log,
    })
    if (!result.success) {
      return {
        code: EC.REQUEST_ERROR,
        message: result.error || '单镜重试失败',
        data: { index: shotIndex, shotId: result.shotId, success: false },
      }
    }
    return { code: 0, data: { index: shotIndex, shotId: result.shotId, success: true, path: result.path } }
  }))
}

module.exports = registerHandlers
