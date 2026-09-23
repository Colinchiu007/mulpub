'use strict'

/**
 * 缓存 IPC handlers（设置-通用设置）
 *
 * 通道：
 *   - cache:stats  返回缓存目录统计（各缓存根/总大小/文件数），供设置页展示
 *   - cache:clear  手动清空缓存目录内容（保留根目录），返回释放字节与删除计数
 *
 * 缓存范围仅 os.tmpdir() 下的合成/影视工程临时产物，不含 userData 持久项目；
 * 具体边界与安全见 services/cache-service.js。
 *
 * cacheService 经 deps 注入（生产由 index.js 传入），测试注入 mock 以隔离真实临时目录。
 */
function registerHandlers (ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { log } = deps
  const cacheService = deps.cacheService || require('../services/cache-service')

  ipcMain.handle('cache:stats', () => {
    try {
      return { code: 0, data: cacheService.getCacheStats() }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  })

  ipcMain.handle('cache:clear', () => {
    try {
      const result = cacheService.clearCache()
      if (log && typeof log.info === 'function') {
        log.info('Cache', '用户手动清理缓存', { freedBytes: result.freedBytes, removedFiles: result.removedFiles, removedDirs: result.removedDirs })
      }
      return { code: 0, data: result }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  })
}

module.exports = registerHandlers
