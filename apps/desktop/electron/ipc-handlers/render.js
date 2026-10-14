// @ts-check
/**
 * 渲染 IPC handlers
 */

function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { renderEngine, BrowserWindow, log, modelProviderManager, generateSceneVideo: injectedGenerateSceneVideo, cardCapture: injectedCardCapture } = deps
  const { generateSceneVideo: generateSceneVideoFromStages } = require('../services/story2video-stages')
  const { resolveProviderDefaultModel } = require('../services/model-provider-manager')
  // 卡片分页渲染（P2-3）：offscreen 窗口截图。按 deps 注入以便测试替换。
  const cardCaptureFromService = require('../services/card-capture')
  const fsp = require('fs/promises')
  const os = require('os')
  const path = require('path')
  // 测试可注入 mock；生产环境回退到流水线 stages 的真实实现
  const generateSceneVideo = injectedGenerateSceneVideo || generateSceneVideoFromStages

  ipcMain.handle('render:start', withSenderCheck(async (event, data) => {
    try {
      // R51 P0 修复：data 为 undefined 时 data.props / data.profile 属性访问必崩
      if (!data || typeof data !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少 data 参数' }
      const win = BrowserWindow.fromWebContents(event.sender)
      const onProgress = (percent, stage) => { win?.webContents.send('render:progress', { percent, stage }) }
      const result = await renderEngine.render(data.props || data, { onProgress, profile: data.profile })
      if (result.success) win?.webContents.send('render:complete', result)
      else win?.webContents.send('render:error', result)
      // R52 修复：统一为标准 { code, data, message } 格式
      return { code: 0, data: result }
    } catch (err) {
      log.error('[render] render:start error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message }
    }
  }))

  /**
   * 快速渲染 text 模式：调用 AI 视频生成模型（提交 + 轮询 + 下载），返回本地视频路径。
   * 复用流水线 generate_assets 阶段的 generateSceneVideo 契约（同一 provider 适配器能力）。
   * 进度经 render:progress 推送（percent 0-100，stage 为阶段文案）。
   */
  ipcMain.handle('render:start-ai-video', withSenderCheck(async (event, data) => {
    try {
      if (!data || typeof data !== 'object' || typeof data.prompt !== 'string' || !data.prompt.trim()) {
        return { code: EC.VALIDATION_ERROR, message: '缺少 prompt 参数' }
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const onProgress = (percent, stage) => { win?.webContents.send('render:progress', { percent, stage }) }
      if (!modelProviderManager || typeof modelProviderManager.callAdapter !== 'function' ||
          typeof modelProviderManager.getDefault !== 'function') {
        return { code: EC.REQUEST_ERROR, message: 'AI 视频生成服务不可用，请在模型设置中启用视频供应商' }
      }
      const provider = modelProviderManager.getDefault('video')
      if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) {
        return { code: EC.REQUEST_ERROR, message: '未配置可用的视频供应商，请在模型设置中启用视频生成能力' }
      }
      const model = resolveProviderDefaultModel(provider, 'video')
      // 快速渲染默认 9:16 竖屏（与流水线 story2video-compose 默认一致），长边封顶 1280
      const size = { width: 720, height: 1280 }
      const fps = 30
      const seconds = 8
      const runDir = path.join(os.tmpdir(), 'story2video', 'quick-render', 'ai-video')
      onProgress(1, '提交视频生成任务')
      const outcome = await generateSceneVideo({
        manager: modelProviderManager,
        providerId: provider.id.trim(),
        model,
        prompt: data.prompt.trim(),
        index: 0,
        seconds,
        size,
        fps,
        runDir,
        pollIntervalMs: 10000,
      })
      if (!outcome || !outcome.success || !outcome.path) {
        const message = (outcome && (outcome.error || outcome.message)) || 'AI 视频生成失败'
        win?.webContents.send('render:error', { success: false, error: message })
        return { code: EC.REQUEST_ERROR, message }
      }
      const result = { success: true, outputPath: outcome.path }
      win?.webContents.send('render:complete', result)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[render] render:start-ai-video error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message }
    }
  }))

  ipcMain.handle('render:cancel', withSenderCheck(() => {
    try {
      // R52 修复：统一为标准格式
      renderEngine.cancel(); return { code: 0, data: true }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('render:status', () => {
    try {
      const status = renderEngine.getStatus()
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: status }
    } catch (e) { log.error('[render:status] error:', e); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('render:install-deps', withSenderCheck(async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await renderEngine.installDeps((text) => win?.webContents.send('render:install-progress', { text }))
      // R52 修复：统一为标准格式
      return { code: 0, data: result }
    } catch (err) {
      log.error('[render] install-deps error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message }
    }
  }))

  // --- Composition 管理（Phase 1）---
  ipcMain.handle('render:list-compositions', () => {
    try {
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: renderEngine.listCompositions() }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
  })

  ipcMain.handle('render:get-composition', (_event, id) => {
    try {
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: renderEngine.getComposition(id) }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('render:validate-props', (_event, compositionId, props) => {
    try {
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: renderEngine.validateProps(compositionId, props) }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  /**
   * 图文卡片分页渲染：把分页结果逐页渲染成 PNG，落临时文件，返回**路径数组**。
   *
   * ## 为什么这条通道的入参校验不能省（§10 X-1）
   *
   * 本仓没有统一的 IPC 入参中间件（X-1 说明了为何不引入）⇒ **每条通道自己校验**。
   * 渲染层传来的东西**不可信**：可能是 undefined、字符串、或被 Vue reactive 包过的代理。
   * 不校验的后果不是「报错」而是「崩在深处」—— `data.pages[0][0]` 对 undefined 必崩。
   *
   * ## 为什么入参必须是**纯 JSON**（Vue ref/reactive 要脱壳）
   *
   * Vue 的 `ref` / `reactive` 是 Proxy。直接经 `ipcRenderer.invoke` 传会报
   * **"An object could not be cloned"** —— 结构化克隆不支持代理。
   * 规则：渲染端从 ref 取出的对象一律 `JSON.parse(JSON.stringify(obj))` 后再传。
   * 本通道在入口再做一次**形状校验**（而非尝试脱壳）——因为主进程拿到的已经是克隆后的值，
   * 到这里的「非纯值」只可能是调用方 bug，应当明确拒绝而不是静默修补。
   *
   * ## 失败纪律（与 card-capture 一致）
   *
   * 任一步失败 ⇒ 返回 `{ code, message }`，**且不返回部分产物**
   * —— 部分产物比没有更危险（用户会以为发全了）。
   */
  ipcMain.handle('render:cards', withSenderCheck(async (event, data) => {
    try {
      // ① 入参校验：逐层 fail-closed，每层给出可定位的提示
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { code: EC.VALIDATION_ERROR, message: '缺少 data 参数（应为对象）' }
      }
      const { pages } = data
      if (!Array.isArray(pages) || pages.length === 0) {
        return { code: EC.VALIDATION_ERROR, message: 'data.pages 必须是非空数组' }
      }
      for (let i = 0; i < pages.length; i++) {
        if (!Array.isArray(pages[i])) {
          return { code: EC.VALIDATION_ERROR, message: `data.pages[${i}] 必须是数组` }
        }
        for (let j = 0; j < pages[i].length; j++) {
          if (typeof pages[i][j] !== 'string') {
            return { code: EC.VALIDATION_ERROR, message: `data.pages[${i}][${j}] 必须是字符串` }
          }
        }
      }
      // 视口尺寸：给了就必须是正整数（0/负数/小数/字符串一律拒绝，不静默回落）
      for (const k of ['widthPx', 'heightPx']) {
        const v = data[k]
        if (v !== undefined && (!Number.isInteger(v) || v <= 0)) {
          return { code: EC.VALIDATION_ERROR, message: `data.${k} 必须是正整数` }
        }
      }

      // ② 渲染（依赖注入，便于测试；生产回退到真实实现）
      const capture = injectedCardCapture || cardCaptureFromService
      if (!capture || typeof capture.renderCardsToPng !== 'function') {
        return { code: EC.REQUEST_ERROR, message: '卡片渲染服务不可用' }
      }
      const pngs = await capture.renderCardsToPng({
        pages,
        ...(data.widthPx === undefined ? {} : { widthPx: data.widthPx }),
        ...(data.heightPx === undefined ? {} : { heightPx: data.heightPx }),
      })
      if (!Array.isArray(pngs) || pngs.length !== pages.length) {
        // 数量不符 ⇒ 视为整体失败，**不返回部分产物**
        return { code: EC.REQUEST_ERROR, message: `渲染页数不符（期望 ${pages.length}，实得 ${Array.isArray(pngs) ? pngs.length : '非数组'}）` }
      }

      // ③ 落临时文件：每页一个 PNG，同一次调用共用一个子目录（便于整批清理）
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mp-cards-'))
      const files = []
      for (let i = 0; i < pngs.length; i++) {
        const f = path.join(dir, `page-${String(i + 1).padStart(3, '0')}.png`)
        await fsp.writeFile(f, pngs[i])
        files.push(f)
      }
      return { code: 0, data: files }
    } catch (err) {
      log.error('[render] render:cards error:', err)
      return { code: EC.REQUEST_ERROR, message: (err && err.message) || String(err) }
    }
  }))
}

module.exports = registerHandlers
