// @ts-check
/**
 * 发布 & 队列 & 历史 IPC handlers
 * publish:wechat → 微信发布
 * publish:batch → 批量发布
 * queue:status / queue:history / queue:cancel / queue:retry → 任务队列
 * history:list / history:get / history:delete → 发布历史
 * dashboard:stats → 发布统计
 */

function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  // eslint-disable-next-line no-unused-vars
  const { taskQueue, history, BrowserWindow, log, identityService } = deps

  // 平台和账号标识会进入发布路由及下游 URL，只允许单一路径段。
  function isSafePathSegment(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)
  }

  // identityService 存在时，历史记录必须以当前认证用户为唯一归属来源。
  function getOwnerSubject () {
    if (!identityService) return undefined
    try {
      const state = identityService.getState()
      const subject = state && state.user && state.user.sub
      if (typeof subject === 'string' && subject.trim()) return subject.trim()
    } catch (_) { /* 身份服务不可用时按未登录处理 */ }
    return null
  }

  // 统一 IPC 日志标准：每个 handler 记录进入/校验/结果/错误，含耗时与关键参数（脱敏由 logger 统一处理）
  function ipcLog(level, channel, stage, detail) {
    if (log && typeof log[level] === 'function') {
      log[level]('PublishIPC', `${channel} ${stage}${detail ? ' :: ' + detail : ''}`)
    }
  }

  function summarizeArticle(article) {
    if (!article || typeof article !== 'object') return 'article=<缺失>'
    const parts = []
    if (typeof article.title === 'string' && article.title) parts.push(`title="${article.title.slice(0, 50)}"`)
    if (typeof article.video_path === 'string' && article.video_path) parts.push(`video="${article.video_path.slice(-60)}"`)
    if (typeof article.cover_path === 'string' && article.cover_path) parts.push(`cover="${article.cover_path.slice(-60)}"`)
    if (typeof article.accountId === 'string' && article.accountId) parts.push(`accountId=${article.accountId}`)
    if (Array.isArray(article.tags) && article.tags.length) parts.push(`tags=${article.tags.length}`)
    if (!parts.length) parts.push('无关键字段')
    return parts.join(' | ')
  }

  // 封面提取：cover:extract
  ipcMain.handle('cover:extract', withSenderCheck(async (event, videoPath) => {
    const startedAt = Date.now()
    ipcLog('info', 'cover:extract', 'enter', `videoPath=${typeof videoPath === 'string' ? videoPath.slice(-80) : String(videoPath)}`)
    try {
      if (typeof videoPath !== 'string' || !videoPath) {
        ipcLog('warn', 'cover:extract', 'validation-failed', 'videoPath 必须为非空字符串')
        return { code: EC.VALIDATION_ERROR, message: 'videoPath 必须为非空字符串' }
      }
      const { extractVideoCover } = require('../services/cover-extractor')
      const coverPath = await extractVideoCover(videoPath)
      if (!coverPath) {
        ipcLog('warn', 'cover:extract', 'failed', `videoPath=${videoPath.slice(-80)} 提取返回空 耗时=${Date.now() - startedAt}ms`)
        return { code: EC.REQUEST_ERROR, message: '封面提取失败' }
      }
      ipcLog('info', 'cover:extract', 'ok', `coverPath=${coverPath.slice(-80)} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { coverPath }, message: '封面提取成功' }
    } catch (e) {
      ipcLog('error', 'cover:extract', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  // AI 生成封面：cover:generate-ai（P2-2：复用 Story2Video 的 asset-generator 生图引擎，
  // 输出落 publish-cover 临时目录，返回本地路径供 cover_path 消费）
  ipcMain.handle('cover:generate-ai', withSenderCheck(async (event, payload) => {
    const startedAt = Date.now()
    ipcLog('info', 'cover:generate-ai', 'enter', `prompt=${typeof payload?.prompt === 'string' ? payload.prompt.slice(0, 60) : String(payload?.prompt)} style=${payload?.style} ratio=${payload?.ratio}`)
    try {
      if (!payload || typeof payload !== 'object') {
        ipcLog('warn', 'cover:generate-ai', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const prompt = String(payload.prompt || '').trim()
      if (!prompt || prompt.length < 2) {
        ipcLog('warn', 'cover:generate-ai', 'validation-failed', 'prompt 必须为至少 2 个字符')
        return { code: EC.VALIDATION_ERROR, message: '封面描述至少 2 个字符' }
      }
      if (prompt.length > 500) {
        ipcLog('warn', 'cover:generate-ai', 'validation-failed', 'prompt 超过 500 字符')
        return { code: EC.VALIDATION_ERROR, message: '封面描述不能超过 500 字符' }
      }
      const assetGenerator = deps.assetGenerator
      if (!assetGenerator || typeof assetGenerator.generateImage !== 'function') {
        ipcLog('warn', 'cover:generate-ai', 'unavailable', 'assetGenerator 未注入')
        return { code: EC.REQUEST_ERROR, message: 'AI 生图服务不可用' }
      }
      const style = ['cinematic', 'realistic', 'cartoon', 'anime', 'cyberpunk', 'watercolor', 'minimalist'].includes(payload.style) ? payload.style : 'cinematic'
      const ratio = ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(payload.ratio) ? payload.ratio : '16:9'
      const path = require('path')
      const os = require('os')
      const outputDir = path.join(os.tmpdir(), 'multi-publish-cover-ai')
      const result = await assetGenerator.generateImage(prompt.slice(0, 300), {
        index: Date.now() % 10000,
        style,
        aspect_ratio: ratio,
        outputDir,
      })
      if (!result || result.code !== 0 || !result.data || !result.data.path) {
        const msg = (result && result.message) || 'AI 封面生成失败'
        ipcLog('warn', 'cover:generate-ai', 'failed', `error=${msg} 耗时=${Date.now() - startedAt}ms`)
        return { code: EC.REQUEST_ERROR, message: msg }
      }
      ipcLog('info', 'cover:generate-ai', 'ok', `path=${result.data.path.slice(-80)} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { coverPath: result.data.path }, message: 'AI 封面生成成功' }
    } catch (e) {
      ipcLog('error', 'cover:generate-ai', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  // P3-7：合集列表拉取 collection:list — 从平台 API 拉当前用户合集（B站 season/百家号 bjhtopic）
  ipcMain.handle('collection:list', withSenderCheck(async (event, payload) => {
    const startedAt = Date.now()
    ipcLog('info', 'collection:list', 'enter', `platform=${payload?.platform}`)
    try {
      const platform = String(payload?.platform || '').trim()
      if (!['bilibili', 'baijiahao'].includes(platform)) {
        return { code: EC.VALIDATION_ERROR, message: 'platform 必须为 bilibili 或 baijiahao' }
      }
      const accountId = String(payload?.accountId || '').trim()
      // 复用发布路由的凭证加载（按账号取 cookie）
      const { accountManager } = deps
      const credentials = accountManager && typeof accountManager.loadSavedCredentials === 'function'
        ? (accountId ? accountManager.loadSavedCredentials(platform, accountId) : accountManager.loadSavedCredentials(platform))
        : null
      const cookies = credentials && Array.isArray(credentials.cookies) ? credentials.cookies : []
      if (cookies.length === 0) {
        return { code: EC.REQUEST_ERROR, message: '平台 Cookie 缺失（账号未登录或凭证不可用）' }
      }
      const cookie = cookies.map((c) => c.name + '=' + c.value).join('; ')
      const { listCollections } = require('@multi-publish/api-publish-engine/src/index')
      const list = await listCollections(platform, cookie)
      ipcLog('info', 'collection:list', 'ok', `platform=${platform} count=${list.length} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: list, message: 'ok' }
    } catch (e) {
      ipcLog('error', 'collection:list', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  // 封面裁剪：cover:crop（渲染层拖拽裁剪框后调用，主进程 offscreen canvas 编码并压缩到 maxBytes）
  ipcMain.handle('cover:crop', withSenderCheck(async (event, payload) => {
    const startedAt = Date.now()
    const rectSummary = payload && payload.rect
      ? `rect={x:${payload.rect.x},y:${payload.rect.y},w:${payload.rect.width},h:${payload.rect.height}}`
      : 'rect=<缺失>'
    ipcLog('info', 'cover:crop', 'enter', `imagePath=${typeof payload?.imagePath === 'string' ? payload.imagePath.slice(-80) : String(payload?.imagePath)} ${rectSummary} maxBytes=${payload?.maxBytes} outputWidth=${payload?.outputWidth}`)
    try {
      if (!payload || typeof payload !== 'object') {
        ipcLog('warn', 'cover:crop', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const { imagePath, rect, maxBytes, outputWidth } = payload
      if (typeof imagePath !== 'string' || !imagePath) {
        ipcLog('warn', 'cover:crop', 'validation-failed', 'imagePath 必须为非空字符串')
        return { code: EC.VALIDATION_ERROR, message: 'imagePath 必须为非空字符串' }
      }
      const { cropImageFile } = require('../services/cover-cropper')
      const result = await cropImageFile(imagePath, { rect, maxBytes, outputWidth })
      if (!result.ok) {
        ipcLog('warn', 'cover:crop', 'failed', `imagePath=${imagePath.slice(-80)} error=${result.error} 耗时=${Date.now() - startedAt}ms`)
        return { code: EC.REQUEST_ERROR, message: result.error || '封面裁剪失败' }
      }
      ipcLog('info', 'cover:crop', 'ok', `cropPath=${result.path.slice(-80)} size=${result.sizeBytes} ${result.width}x${result.height} overLimit=${result.overLimit} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: result, message: '封面裁剪成功' }
    } catch (e) {
      ipcLog('error', 'cover:crop', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  // 封面预览读取：cover:read-data（渲染层经 http 源加载，无法直接引用 file:// 图片）
  ipcMain.handle('cover:read-data', withSenderCheck(async (event, imagePath) => {
    const startedAt = Date.now()
    ipcLog('info', 'cover:read-data', 'enter', `imagePath=${typeof imagePath === 'string' ? imagePath.slice(-80) : String(imagePath)}`)
    try {
      if (typeof imagePath !== 'string' || !imagePath) {
        ipcLog('warn', 'cover:read-data', 'validation-failed', 'imagePath 必须为非空字符串')
        return { code: EC.VALIDATION_ERROR, message: 'imagePath 必须为非空字符串' }
      }
      const { readImageAsDataUrl } = require('../services/cover-cropper')
      const result = readImageAsDataUrl(imagePath)
      if (!result.ok) {
        ipcLog('warn', 'cover:read-data', 'failed', `imagePath=${imagePath.slice(-80)} error=${result.error}`)
        return { code: EC.REQUEST_ERROR, message: result.error || '封面读取失败' }
      }
      ipcLog('info', 'cover:read-data', 'ok', `size=${result.sizeBytes} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: result, message: '封面读取成功' }
    } catch (e) {
      ipcLog('error', 'cover:read-data', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('publish:wechat', withSenderCheck(async (event, articleData) => {
    const startedAt = Date.now()
    ipcLog('info', 'publish:wechat', 'enter', summarizeArticle(articleData))
    try {
      const offlineManager = require('../services/offline-manager')
      if (offlineManager.isOffline()) {
        offlineManager.addToCache({ platform: 'wechat_mp', article: articleData, accountId: null })
        ipcLog('warn', 'publish:wechat', 'offline-cached', '网络离线，任务已缓存')
        return { code: 0, data: { cached: true }, message: '网络离线，任务已缓存，恢复后自动发布' }
      }
      const taskId = taskQueue.add({
        platform: 'wechat_mp',
        article: articleData,
        retry: 2,
        timeout: 180000,
      })
      ipcLog('info', 'publish:wechat', 'ok', `taskId=${taskId} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { taskId }, message: '任务已加入队列' }
    } catch (e) {
      ipcLog('error', 'publish:wechat', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('publish:batch', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    const platformSummary = Array.isArray(arg?.platforms)
      ? arg.platforms.map((t) => (typeof t === 'string' ? t : `${t?.platform || '?'}:${t?.accountId || 'any'}`)).join(',')
      : String(arg?.platforms)
    ipcLog('info', 'publish:batch', 'enter', `platforms=[${platformSummary}] ${summarizeArticle(arg?.article)}`)
    try {
    // R51 P1：解构保护，arg 为 undefined 时解构会抛（M-5 修复不完整补丁）
    if (!arg || typeof arg !== 'object') {
      ipcLog('warn', 'publish:batch', 'validation-failed', '缺少参数对象')
      return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
    }
    const { platforms, article } = arg
    // M-5 修复：参数校验，platforms 为 undefined 时 .map() 必崩
    if (!Array.isArray(platforms) || platforms.length === 0) {
      ipcLog('warn', 'publish:batch', 'validation-failed', 'platforms 不能为空且必须为数组')
      return { code: EC.VALIDATION_ERROR, message: 'platforms 不能为空且必须为数组' }
    }
    if (article !== undefined && (!article || typeof article !== 'object' || Array.isArray(article))) {
      ipcLog('warn', 'publish:batch', 'validation-failed', 'article 必须为对象')
      return { code: EC.VALIDATION_ERROR, message: 'article 必须为对象' }
    }
    const normalizedTargets = []
    for (const target of platforms) {
      if (typeof target === 'string') {
        const platform = target.trim()
        if (!isSafePathSegment(platform)) {
          ipcLog('warn', 'publish:batch', 'validation-failed', `平台格式无效: ${platform}`)
          return { code: EC.VALIDATION_ERROR, message: '发布平台格式无效' }
        }
        normalizedTargets.push({ platform, accountId: null })
        continue
      }
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        ipcLog('warn', 'publish:batch', 'validation-failed', `目标格式无效: ${JSON.stringify(target)}`)
        return { code: EC.VALIDATION_ERROR, message: '发布目标格式无效' }
      }
      const platform = typeof target.platform === 'string' ? target.platform.trim() : ''
      const accountId = typeof target.accountId === 'string' ? target.accountId.trim() : ''
      if (!isSafePathSegment(platform)) {
        ipcLog('warn', 'publish:batch', 'validation-failed', `目标平台格式无效: ${platform}`)
        return { code: EC.VALIDATION_ERROR, message: '发布目标平台格式无效' }
      }
      if (!isSafePathSegment(accountId)) {
        ipcLog('warn', 'publish:batch', 'validation-failed', `目标账号格式无效: ${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '发布目标账号格式无效' }
      }
      normalizedTargets.push({ platform, accountId })
    }
    const plainArticle = JSON.parse(JSON.stringify(article || {}))
    const taskIds = normalizedTargets.map(({ platform, accountId }) => {
      return taskQueue.add({
        platform,
        article: { ...plainArticle, accountId },
        accountId,
        // 视频发布要等大文件真实上传完成（强判定最长 15 分钟）+转码/表单等待，
        // 队列默认 180s 会在上传中途杀任务（2026-09 smoke5 实锤），视频任务放宽到 30 分钟
        ...(plainArticle.video_path ? { timeout: 1800000 } : {}),
      })
    })
      ipcLog('info', 'publish:batch', 'ok', `taskIds=[${taskIds.join(',')}] 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { taskIds }, message: taskIds.length + " tasks added" }
    } catch (e) {
      ipcLog('error', 'publish:batch', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('queue:status', withSenderCheck(async () => {
    try {
      const status = taskQueue.getStatus()
      const running = Array.isArray(status?.running) ? status.running.length : (Array.isArray(status?.tasks) ? status.tasks.filter((t) => t.status === 'running').length : '?')
      const queued = Array.isArray(status?.queue) ? status.queue.length : '?'
      ipcLog('info', 'queue:status', 'ok', `running=${running} queued=${queued}`)
      return { code: 0, data: status }
    } catch (e) { ipcLog('error', 'queue:status', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('queue:history', withSenderCheck(async () => {
    try {
      const history = taskQueue.getHistory()
      ipcLog('info', 'queue:history', 'ok', `historyCount=${Array.isArray(history) ? history.length : '?'}`)
      return { code: 0, data: history }
    } catch (e) { ipcLog('error', 'queue:history', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
  }))
  ipcMain.handle('queue:cancel', withSenderCheck(async (event, taskId) => {
    const startedAt = Date.now()
    ipcLog('info', 'queue:cancel', 'enter', `taskId=${taskId}`)
    try {
      const ok = taskQueue.cancel(taskId)
      ipcLog(ok ? 'info' : 'warn', 'queue:cancel', ok ? 'ok' : 'not-found', `taskId=${taskId} 耗时=${Date.now() - startedAt}ms`)
      return { code: ok ? 0 : EC.NOT_FOUND, data: ok, message: ok ? '任务已取消' : '任务不存在或已完成' }
    } catch (e) { ipcLog('error', 'queue:cancel', 'error', `taskId=${taskId} message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('queue:retry', withSenderCheck(async (event, taskId) => {
    try {
      if (typeof taskId !== 'string' || !taskId.trim()) {
        ipcLog('warn', 'queue:retry', 'validation-failed', 'taskId 不能为空')
        return { code: EC.VALIDATION_ERROR, message: 'taskId 不能为空' }
      }
      const retryTaskId = taskQueue.retry(taskId.trim())
      if (!retryTaskId) {
        ipcLog('warn', 'queue:retry', 'not-retryable', `taskId=${taskId}`)
        return { code: EC.NOT_FOUND, data: null, message: '任务不存在或状态不可重试' }
      }
      ipcLog('info', 'queue:retry', 'ok', `taskId=${taskId} retryTaskId=${retryTaskId}`)
      return {
        code: 0,
        data: { taskId: retryTaskId, retryOf: taskId.trim() },
        message: '任务已重新加入队列',
      }
    } catch (e) { ipcLog('error', 'queue:retry', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('history:list', withSenderCheck(async (event, opts) => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'history:list', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: { total: 0, records: [] } }
      }
      const result = history.listRecords(opts, owner)
      ipcLog('info', 'history:list', 'ok', `owner=${owner} total=${result?.total} records=${Array.isArray(result?.records) ? result.records.length : '?'} page=${opts?.page} pageSize=${opts?.pageSize}`)
      return { code: 0, data: result }
    } catch (e) {
      ipcLog('error', 'history:list', 'error', `message=${e.message}`)
      return { code: EC.REQUEST_ERROR, message: e.message, data: { total: 0, records: [] } }
    }
  }))

  ipcMain.handle('history:get', withSenderCheck(async (event, id) => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'history:get', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      const record = history.getRecord(id, owner)
      if (!record) {
        ipcLog('warn', 'history:get', 'not-found', `id=${id} owner=${owner}`)
        return { code: EC.NOT_FOUND, message: '记录不存在' }
      }
      ipcLog('info', 'history:get', 'ok', `id=${id} platform=${record?.platform} status=${record?.status}`)
      return { code: 0, data: record }
    } catch (e) { ipcLog('error', 'history:get', 'error', `id=${id} message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('history:delete', withSenderCheck(async (event, payload) => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'history:delete', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }

      const ids = Array.isArray(payload) ? payload : payload && payload.ids
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
        ipcLog('warn', 'history:delete', 'validation-failed', `ids=${JSON.stringify(ids)}`)
        return { code: EC.VALIDATION_ERROR, message: '记录 ID 列表无效' }
      }
      const normalizedIds = ids
        .filter(id => typeof id === 'string')
        .map(id => id.trim())
        .filter(Boolean)
      if (normalizedIds.length !== ids.length) {
        ipcLog('warn', 'history:delete', 'validation-failed', '记录 ID 格式无效')
        return { code: EC.VALIDATION_ERROR, message: '记录 ID 格式无效' }
      }

      const result = history.deleteRecords(normalizedIds, owner)
      if (!result || result.deleted === 0) {
        ipcLog('warn', 'history:delete', 'not-found', `ids=${normalizedIds.join(',')}`)
        return { code: EC.NOT_FOUND, data: { deleted: 0 }, message: '记录不存在' }
      }
      ipcLog('info', 'history:delete', 'ok', `deleted=${result.deleted} ids=${normalizedIds.join(',')}`)
      return { code: 0, data: result, message: '发布记录已删除' }
    } catch (e) { ipcLog('error', 'history:delete', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('dashboard:stats', withSenderCheck(async () => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'dashboard:stats', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      const stats = history.getStats(owner)
      ipcLog('info', 'dashboard:stats', 'ok', `owner=${owner} published=${stats?.published} failed=${stats?.failed}`)
      return { code: 0, data: stats }
    } catch (e) { ipcLog('error', 'dashboard:stats', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
}

module.exports = registerHandlers
