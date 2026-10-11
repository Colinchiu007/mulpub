// @ts-check
/**
 * 快捷采集 IPC handlers
 *
 * 只有两条通道 + 一个事件：
 *   - quick-collect:list-presets  内置指令目录（只读、无参）
 *   - quick-collect:run           执行一条指令（withSenderCheck：会触发付费模型调用，
 *                                 与 ai:generate 同级）
 *   - quick-collect:progress      主进程 → 发起窗口的阶段推送（不在本文件接收）
 *
 * 引擎按「依赖身份」惰性构造：phase5 装配期 aiGenerator / contentIntelligence 可能尚未就绪，
 * 注册时硬取会把「当时还没好」冻结成永久。因此每次调用前比对依赖身份，变了就重建。
 */
const { wrapIpcHandlerRaw, withSenderCheck } = require('./helpers')
const { createQuickCollectEngine } = require('../services/quick-collect-engine')
const { listPresetCommands } = require('../services/quick-collect-presets')

/** 进度事件名（渲染端 preload 逐字订阅同一个字面量） */
const PROGRESS_CHANNEL = 'quick-collect:progress'

function registerHandlers (ipcMain, deps = {}) {
  // ⚠️ 不在这里解构：phase5 装配期 `aiGenerator` / `contentIntelligence` 可能后到
  // （容器注册顺序与 setModelProviderManager 注入都在注册之后），解构会把"当时还没有"
  // 冻结成永久，表现为「明明配了模型，快捷采集一直说未配置」。一律按当次 deps 读取。
  const log = deps.log

  let cached = null
  let cachedKeys = null

  function searchFnFor () {
    const contentIntelligence = deps.contentIntelligence
    return (contentIntelligence && typeof contentIntelligence.search === 'function')
      ? (query, opts) => contentIntelligence.search(query, opts)
      : null
  }

  function llmFnFor () {
    const aiGenerator = deps.aiGenerator
    if (!aiGenerator || typeof aiGenerator.generateWithDefault !== 'function') {
      return async () => { throw markNotConfigured() }
    }
    return ({ messages, temperature, max_tokens }) =>
      aiGenerator.generateWithDefault('llm', { messages, temperature, max_tokens })
  }

  function getEngine () {
    const keys = [deps.aiGenerator, deps.contentIntelligence]
    if (cached && cachedKeys && cachedKeys[0] === keys[0] && cachedKeys[1] === keys[1]) return cached
    cached = createQuickCollectEngine({
      searchFn: searchFnFor(),
      llmFn: llmFnFor(),
      log,
    })
    cachedKeys = keys
    return cached
  }

  ipcMain.handle('quick-collect:list-presets', wrapIpcHandlerRaw(async () => {
    return { code: 0, data: listPresetCommands() }
  }, { label: 'quick-collect:list-presets' }))

  ipcMain.handle('quick-collect:run', withSenderCheck(wrapIpcHandlerRaw(async (event, payload) => {
    const BrowserWindow = deps.BrowserWindow
    const win = BrowserWindow && typeof BrowserWindow.fromWebContents === 'function' && event && event.sender
      ? BrowserWindow.fromWebContents(event.sender)
      : null
    const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId.slice(0, 64) : ''
    const onProgress = (p) => {
      try {
        const alive = !win || typeof win.isDestroyed !== 'function' || !win.isDestroyed()
        if (win && win.webContents && alive) {
          win.webContents.send(PROGRESS_CHANNEL, { requestId, stage: p.stage, percent: p.percent })
        }
      } catch (_) { /* 进度推送失败不得影响主流程 */ }
    }
    // 引擎自带校验（纵深防御）：非法指令返回 { code: -2, message: <领域码> }
    return getEngine().run(payload && payload.command, { onProgress })
  }, { requireArgs: true, label: 'quick-collect:run' })))
}

module.exports = registerHandlers
module.exports.PROGRESS_CHANNEL = PROGRESS_CHANNEL

/**
 * 构造「未配置默认大模型」错误：引擎按 `quickCollectCode` 归类成 -101。
 * 抽成具名函数（而不是在闭包里用局部 `err` 常量再标注）是为了避开 vitest SSR 转换下
 * `const err = new Error(...)` + 紧随其后的属性赋值被重排成 TDZ 的坑（实测
 * `Cannot access 'err' before initialization`），行为完全等价。
 */
function markNotConfigured () {
  const error = new Error('默认大模型未配置')
  error.quickCollectCode = 'QC_LLM_NOT_CONFIGURED'
  return error
}
