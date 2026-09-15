// @ts-check
const path = require('path')
const { withSenderCheck } = require('./helpers')

function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const log = require('../services/logger')
  const { _chunkedUploader } = deps

  // 安全：校验路径不包含穿越序列（防止 ../../etc/passwd）
  // 修复：原 path.resolve 后不可能含 '..'，校验形同虚设
  // 改为白名单基目录校验（用户媒体目录 + 临时目录）
  const { app, BrowserWindow } = require('electron')
  const ALLOWED_BASES = [
    path.resolve(app.getPath('userData'), 'media'),
    path.resolve(app.getPath('temp')),
    path.resolve(app.getPath('downloads')),
  ]
  function _isSafeFilePath(p) {
    if (!p || typeof p !== 'string') return false
    const normalized = path.resolve(p)
    // 必须在允许的基目录内
    return ALLOWED_BASES.some(base => normalized === base || normalized.startsWith(base + path.sep))
  }

  ipcMain.handle('upload:chunked', withSenderCheck(async (event, arg) => {
    try {
      // R51 P1：解构保护（CRITICAL 修复 — 原解构在 try 外，arg 为 undefined 时同步抛）
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { filePath } = arg
      // 安全：校验 filePath 防止路径穿越
      if (!_isSafeFilePath(filePath)) {
        return { code: EC.VALIDATION_ERROR, message: 'Invalid file path' }
      }
      // uploadChunkFn 无法跨 IPC 传递（结构化克隆丢弃函数）
      // 各平台分片上传逻辑应由主进程内部根据 platform/account 自行构造
      // 当前未实现具体上传后端，返回明确错误而非崩溃
      const uploadChunkFn = deps.defaultUploadChunkFn || null
      if (typeof uploadChunkFn !== 'function') {
        return { code: EC.REQUEST_ERROR, message: 'Chunked upload requires desktop adapter config' }
      }
      const win = BrowserWindow ? BrowserWindow.fromWebContents(event.sender) : null
      const onProgress = win ? (percent, bytesUploaded, totalBytes) => {
        win.webContents.send('upload:progress', { percent, bytesUploaded, totalBytes, filePath })
      } : null
      const result = await _chunkedUploader.upload(filePath, uploadChunkFn, onProgress)
      return { code: result.success ? 0 : EC.REQUEST_ERROR, data: result }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('upload:cancel', withSenderCheck(async () => {
    try {
      _chunkedUploader.cancel()
      // R52 修复：统一返回格式，补充 data 字段
      return { code: 0, data: true }
    } catch (e) { log.warn('[ipc:upload]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
}

module.exports = registerHandlers
