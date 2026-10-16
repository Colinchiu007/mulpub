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
  // 归属主体判定只有一份唯一实现（helpers.resolveIpcOwnerSubject，QM-6 后端轴 FB5）。
  // 本文件与 publish-helpers.js 都只转发，不得再抄一份（owner-subject-single-source.test.js 结构锁）。
  const { withSenderCheck, resolveIpcOwnerSubject } = require('./helpers')
  const { createPublishHelpers } = require('./publish-helpers')
  // eslint-disable-next-line no-unused-vars
  // eslint-disable-next-line no-unused-vars
  const { taskQueue, history, BrowserWindow, log, identityService, riskSuspender, store } = deps

  // 发布历史读写与「再次发布」快照（history:list/get/delete + 快照读口）已拆到独立模块：
  // 本文件顶到逐文件行数门禁上限，而历史/快照的生命周期与发布链路无关，见 publish-history-ipc.js。
  const { registerHistoryHandlers } = require('./publish-history-ipc')

  // 发布 IPC 局部工具：路径段校验 / 统一日志 / 文章摘要（见 publish-helpers.js）
  const { isSafePathSegment, ipcLog, summarizeArticle } = createPublishHelpers({ log })
  // 归属主体转发唯一实现（三态：undefined=legacy / null=认不出身份 / 非空串=subject）
  const getOwnerSubject = () => resolveIpcOwnerSubject(identityService)

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
      const style = ['cinematic', 'realistic', 'cartoon', 'anime', 'cyberpunk', 'watercolor', 'minimalist'].includes(payload.style) ? payload.style : 'cinematic'
      const ratio = ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(payload.ratio) ? payload.ratio : '16:9'
      const assetGenerator = deps.assetGenerator
      // 2026-09-29 图文发布兜底：无 AI 生图 provider（assetGenerator 未注入）或 AI 生成失败时，
      // 回退本地标题卡封面（SVG→sharp→PNG，零生图模型依赖）——小红书/快手/抖音图文要求
      // 至少 1 张图片，无兜底则「一键发布图文」在这些平台必然失败。
      const fallbackLocalCover = async (reason) => {
        try {
          // 依赖注入（2026-09-30）：deps.localCoverGenerator 可注入替身，使 IPC 合同测试
          // 无需加载 sharp 原生模块（CI 高负载下首载 >30s，真实 30s 超时仍被打穿）。生产不注入时
          // 走真实实现；本地渲染的真实性由 local-cover-generator.test.js 覆盖（PNG 尺寸/比例/折行）。
          const localCoverGenerator = (deps && deps.localCoverGenerator) || require('../services/local-cover-generator')
          // 2026-10-06 内容感知封面：标题与正文摘要一并下传，兜底封面才能与文章内容相关
          // （此前只传用户手输的 prompt，产出恒为同一张蓝红金渐变「平台标识」卡）。
          // 标题优先取文章标题（内容本身），缺失时退回 prompt；正文截断避免 IPC 传大包。
          const coverTitle = String(payload.title || prompt).trim().slice(0, 120)
          const coverContent = String(payload.content || '').slice(0, 2000)
          const localResult = await localCoverGenerator.generateLocalCover(coverTitle, {
            ratio,
            content: coverContent,
          })
          if (localResult && localResult.code === 0 && localResult.data && localResult.data.path) {
            const d = localResult.data
            ipcLog('info', 'cover:generate-ai', 'local-fallback',
              `reason=${reason} theme=${d.theme} label=${d.themeLabel} keywords=${(d.keywords || []).join('/')} path=${d.path.slice(-80)}`)
            return {
              code: 0,
              data: {
                coverPath: d.path,
                source: 'local-fallback',
                theme: d.theme,
                themeLabel: d.themeLabel,
                keywords: d.keywords || [],
              },
              message: '本地封面生成成功（AI 生图不可用，已按文章内容生成封面）',
            }
          }
          return { code: EC.REQUEST_ERROR, message: (localResult && localResult.message) || 'AI 与本地封面生成均失败' }
        } catch (e) {
          return { code: EC.REQUEST_ERROR, message: '封面生成失败：' + e.message }
        }
      }
      if (!assetGenerator || typeof assetGenerator.generateImage !== 'function') {
        ipcLog('info', 'cover:generate-ai', 'fallback', 'assetGenerator 未注入，走本地封面兜底')
        return await fallbackLocalCover('assetGenerator-unavailable')
      }
      const path = require('path')
      const os = require('os')
      const outputDir = path.join(os.tmpdir(), 'multi-publish-cover-ai')
      const result = await assetGenerator.generateImage(prompt.slice(0, 300), {
        index: Date.now() % 10000,
        style,
        aspect_ratio: ratio,
        outputDir,
      })
      // 2026-10-09 快手图文 tofu：ffmpeg 占位图（degraded:true，Windows 无 CJK 字形）中文全方块，绝不能冒充「AI 封面」——判定 AI 失败走本地兜底。
      const isDegradedPlaceholder = result && result.data && result.data.degraded === true
      if (!result || result.code !== 0 || !result.data || !result.data.path || isDegradedPlaceholder) {
        const msg = isDegradedPlaceholder
          ? 'AI 生图返回的是 ffmpeg 占位图（无真实生图 provider），拒绝作为封面'
          : ((result && result.message) || 'AI 封面生成失败')
        ipcLog('warn', 'cover:generate-ai', 'failed', `error=${msg} 耗时=${Date.now() - startedAt}ms，走本地封面兜底`)
        return await fallbackLocalCover(isDegradedPlaceholder ? 'ai-generate-degraded-placeholder' : 'ai-generate-failed')
      }
      ipcLog('info', 'cover:generate-ai', 'ok', `path=${result.data.path.slice(-80)} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { coverPath: result.data.path, source: 'ai' }, message: 'AI 封面生成成功' }
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
    // 2026-10-15：一次 publish:batch 产生的 N 个任务共享一个 batchId。
    // 历史记录仍按平台各写一行（状态/审核/作品链接/互动数据都是平台级动作，合并成
    // 一条「集合记录」会丢掉可执行性），但「这几条属于同一次发布」此前无从回答——
    // taskQueue 早已归一 batchId 字段（packages/shared-utils/src/task-queue.js:184），
    // 只是从来没有人传过它。
    const batchId = 'batch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const taskIds = normalizedTargets.map(({ platform, accountId }) => {
      return taskQueue.add({
        platform,
        article: { ...plainArticle, accountId },
        accountId,
        batchId,
        // 视频发布要等大文件真实上传完成（强判定最长 15 分钟）+转码/表单等待，
        // 队列默认 180s 会在上传中途杀任务（2026-09 smoke5 实锤），视频任务放宽到 30 分钟
        ...(plainArticle.video_path ? { timeout: 1800000 } : {}),
      })
    })
      ipcLog('info', 'publish:batch', 'ok', `taskIds=[${taskIds.join(',')}] 耗时=${Date.now() - startedAt}ms`)
      log.notify('PublishIPC', 'batch-ok', { params: { taskIds, durationMs: Date.now() - startedAt }, level: 'INFO' })
      return { code: 0, data: { taskIds }, message: taskIds.length + " tasks added" }
    } catch (e) {
      ipcLog('error', 'publish:batch', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)
      log.notify('PublishIPC', 'batch-error', { params: { durationMs: Date.now() - startedAt }, errorCategory: 'publish_batch', level: 'ERROR', error: String(e.message) })
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

  // 发布历史读写（history:list/get/delete）与「再次发布」快照：见 publish-history-ipc.js
  registerHistoryHandlers(ipcMain, { EC, withSenderCheck, getOwnerSubject, ipcLog, history, store })


  // ─── W1 §5 enforcement：风控挂起守卫查询/恢复 ───
  function isRiskPlatformValid(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)
  }

  ipcMain.handle('publishRisk:listSuspended', withSenderCheck(async () => {
    try {
      if (!riskSuspender) return { code: EC.REQUEST_ERROR, message: '风控挂起服务未初始化' }
      return { code: 0, data: riskSuspender.listSuspended() }
    } catch (e) { ipcLog('error', 'publishRisk:listSuspended', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('publishRisk:resume', withSenderCheck(async (event, payload) => {
    const startedAt = Date.now()
    ipcLog('info', 'publishRisk:resume', 'enter', `payload=${JSON.stringify(payload)}`)
    try {
      if (!riskSuspender) return { code: EC.REQUEST_ERROR, message: '风控挂起服务未初始化' }
      const platform = payload && payload.platform
      const accountId = payload && payload.accountId
      if (!isRiskPlatformValid(platform)) {
        ipcLog('warn', 'publishRisk:resume', 'validation-failed', 'platform 格式无效')
        return { code: EC.VALIDATION_ERROR, message: 'platform 必须为合法平台标识' }
      }
      if (accountId != null && !isRiskPlatformValid(String(accountId))) {
        ipcLog('warn', 'publishRisk:resume', 'validation-failed', 'accountId 格式无效')
        return { code: EC.VALIDATION_ERROR, message: 'accountId 格式无效' }
      }
      // §5 合规红线：resume 仅显式人工触发，不存在自动恢复
      const changed = riskSuspender.resume(platform, accountId == null ? null : String(accountId))
      const suspended = riskSuspender.listSuspended()
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win && !win.isDestroyed()) win.webContents.send('publish:risk-suspended', { suspended })
        }
      } catch (e) { ipcLog('warn', 'publishRisk:resume', 'broadcast-failed', e.message) }
      ipcLog('info', 'publishRisk:resume', 'ok', `platform=${platform} accountId=${accountId ?? '-'} changed=${changed} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { changed, suspended } }
    } catch (e) { ipcLog('error', 'publishRisk:resume', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('publishRisk:isSuspended', withSenderCheck(async (event, payload) => {
    try {
      if (!riskSuspender) return { code: EC.REQUEST_ERROR, message: '风控挂起服务未初始化' }
      const platform = payload && payload.platform
      const accountId = payload && payload.accountId
      if (!isRiskPlatformValid(platform)) {
        return { code: EC.VALIDATION_ERROR, message: 'platform 必须为合法平台标识' }
      }
      return { code: 0, data: riskSuspender.isSuspended(platform, accountId == null ? null : String(accountId)) }
    } catch (e) { ipcLog('error', 'publishRisk:isSuspended', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('dashboard:stats', withSenderCheck(async () => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'dashboard:stats', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      const stats = history.getStats(owner)
      // 原样打印 `stats.published` 会永远输出 undefined —— getStats 从不返回该键，
      // 而这条日志正是排障「看板数字为什么不对」的唯一现场，字段必须取真有的那几个。
      ipcLog('info', 'dashboard:stats', 'ok', `owner=${owner} total=${stats?.total} success=${stats?.success} failed=${stats?.failed} unclassified=${stats?.unclassified} rate=${stats?.successRate}%`)
      return { code: 0, data: stats }
    } catch (e) { ipcLog('error', 'dashboard:stats', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
}

module.exports = registerHandlers
