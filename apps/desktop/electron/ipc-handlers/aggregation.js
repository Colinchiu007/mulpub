// @ts-check
/**
 * Aggregation IPC handlers — 热文采集模块前端桥接
 *
 * 通过 pythonBridge.requestBackend 调用 Python 后端的 aggregation API。
 * 通道：
 *   aggregation:collect      → POST /aggregation/collect
 *   aggregation:collect-video→ POST /aggregation/collect-video
 *   aggregation:collect-batch→ POST /aggregation/collect/batch
 *   aggregation:rewrite      → POST /aggregation/rewrite
 *   aggregation:sources      → GET  /aggregation/sources
 *   aggregation:task-status  → GET  /aggregation/tasks/{id}
 *
 * 错误码（P2 细化）：
 *   -99: UNKNOWN        未知错误
 *   -1:  TIMEOUT        请求超时
 *   -2:  SOURCE_UNREACHABLE  源不可达（DNS/连接拒绝）
 *   -3:  QUOTA_EXHAUSTED     LLM API 配额耗尽
 *   -4:  CONTENT_UNEXTRACTABLE  内容无法提取
 *   -5:  BACKEND_UNAVAILABLE    后端不可用
 *   -6:  ASR_ENGINE_UNAVAILABLE 语音转写引擎不可用
 *   -7:  TRANSCRIBE_TIMEOUT     转写超时
 *   -8:  NO_AUDIO_TRACK         视频无音轨
 */

/**
 * 根据异常对象推断错误码
 * @param {Error & { status?: number, response?: { status?: number } }} e
 * @returns {{ code: number, message: string }}
 */
function classifyError(e, fallbackMsg) {
  const msg = (e && e.message) ? String(e.message) : String(e || fallbackMsg)
  const status = (e && (e.status || (e.response && e.response.status))) || 0

  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNABORTED') || status === 408) {
    return { code: -1, message: '请求超时，请稍后重试' }
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN') ||
      msg.includes('getaddrinfo') || msg.includes('DNS') || status === 502 || status === 503) {
    return { code: -2, message: '源不可达，请检查链接或网络连接' }
  }
  if (msg.includes('quota') || msg.includes('429') || msg.includes('rate') || msg.includes('exceeded') ||
      msg.includes('billing') || msg.includes('insufficient') || status === 429) {
    return { code: -3, message: 'API 配额耗尽，请稍后重试或切换模型' }
  }
  if (msg.includes('无结果') || msg.includes('无法提取') || msg.includes('no content') ||
      msg.includes('empty') || status === 422) {
    return { code: -4, message: '无法提取内容，请检查链接是否有效' }
  }
  if (msg.includes('ASR_EMPTY') || msg.includes('转写结果为空')) {
    return { code: -99, message: '语音转写结果为空，该视频可能无清晰语音内容' }
  }
  if (msg.includes('ASR_ENGINE_UNAVAILABLE') || msg.includes('语音转写引擎不可用') || msg.includes('faster-whisper')) {
    return { code: -6, message: msg || '语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper' }
  }
  if (msg.includes('TRANSCRIBE_TIMEOUT') || msg.includes('转写超时')) {
    return { code: -7, message: '转写超时，请尝试较短的短视频' }
  }
  if (msg.includes('NO_AUDIO_TRACK') || msg.includes('无音轨')) {
    return { code: -8, message: '该视频无音轨，无法进行语音转写' }
  }
  if (msg.includes('ECONNRESET') || msg.includes('backend') || msg.includes('未安装') || status === 500) {
    return { code: -5, message: '后端服务不可用，请稍后重试' }
  }
  return { code: -99, message: msg }
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   pythonBridge: { requestBackend: (method: string, path: string, body?: unknown, timeout?: number) => Promise<unknown> },
 *   log?: { info: Function, warn: Function, error: Function }
 * }} deps
 */
function registerHandlers(ipcMain, deps) {
  const { pythonBridge, log, asrInstaller } = deps
  const logger = log || { info: () => {}, warn: () => {}, error: () => {} }
  const installer = asrInstaller || require('../services/asr-installer')

  ipcMain.handle('aggregation:collect', async (_event, payload) => {
    try {
      const res = await pythonBridge.requestBackend('POST', '/aggregation/collect', payload || {})
      // 非零码也写日志（此前只有异常才记，400/422 等业务失败在 IPC 层无痕）
      if (res && res.code !== undefined && res.code !== 0) {
        logger.warn('[aggregation] collect returned non-zero:', JSON.stringify({ code: res.code, message: res.message, url: payload && payload.url }))
      }
      return res
    } catch (e) {
      logger.error('[aggregation] collect failed:', e && e.message ? e.message : String(e))
      const err = classifyError(e, '采集失败')
      return { code: err.code, message: err.message }
    }
  })

  ipcMain.handle('aggregation:collect-batch', async (_event, payload) => {
    try {
      return await pythonBridge.requestBackend('POST', '/aggregation/collect/batch', payload || {})
    } catch (e) {
      logger.error('[aggregation] collect-batch failed:', e && e.message ? e.message : String(e))
      const err = classifyError(e, '批量采集失败')
      return { code: err.code, message: err.message }
    }
  })

  ipcMain.handle('aggregation:collect-video', async (_event, payload) => {
    try {
      // 视频管线（下载+ASR 转写）耗时可达数分钟，超时 600s
      return await pythonBridge.requestBackend('POST', '/aggregation/collect-video', payload || {}, 600000)
    } catch (e) {
      logger.error('[aggregation] collect-video failed:', e && e.message ? e.message : String(e))
      const err = classifyError(e, '视频采集失败')
      return { code: err.code, message: err.message }
    }
  })

  ipcMain.handle('aggregation:rewrite', async (_event, payload) => {
    try {
      return await pythonBridge.requestBackend('POST', '/aggregation/rewrite', payload || {})
    } catch (e) {
      logger.error('[aggregation] rewrite failed:', e && e.message ? e.message : String(e))
      const err = classifyError(e, '改写失败')
      return { code: err.code, message: err.message }
    }
  })

  ipcMain.handle('aggregation:sources', async () => {
    try {
      return await pythonBridge.requestBackend('GET', '/aggregation/sources', null)
    } catch (e) {
      logger.error('[aggregation] sources failed:', e && e.message ? e.message : String(e))
      const err = classifyError(e, '获取采集源失败')
      return { code: err.code, message: err.message }
    }
  })

  ipcMain.handle('aggregation:task-status', async (_event, taskId) => {
    try {
      return await pythonBridge.requestBackend('GET', '/aggregation/tasks/' + encodeURIComponent(String(taskId)), null)
    } catch (e) {
      logger.error('[aggregation] task-status failed:', e && e.message ? e.message : String(e))
      const err = classifyError(e, '获取任务状态失败')
      return { code: err.code, message: err.message }
    }
  })

  // ASR 依赖安装（faster-whisper 缺失时的引导安装 + 模型预下载）
  // 进度经 event.sender.send('asr-install:progress', {...}) 实时推送到渲染进程
  ipcMain.handle('aggregation:asr-install', async (event) => {
    try {
      const sendProgress = (p) => {
        try { event.sender.send('asr-install:progress', p) } catch (_) { /* 窗口可能已关闭 */ }
      }
      const installResult = await installer.installFasterWhisper({ sendProgress, log: logger })
      if (installResult.code !== 0) {
        return installResult
      }
      // 安装成功 → 预下载模型（hf-mirror 镜像内置）
      return await installer.downloadAsrModel({ sendProgress, log: logger })
    } catch (e) {
      logger.error('[aggregation] asr-install failed:', e && e.message ? e.message : String(e))
      return { code: -1, message: '安装失败：' + (e && e.message ? e.message : String(e)) }
    }
  })
}

module.exports = registerHandlers
