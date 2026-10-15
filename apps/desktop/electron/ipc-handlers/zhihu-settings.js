// @ts-check
/**
 * 知乎 API 配置 IPC handlers（设置页「知乎 API」分区）
 *
 * 通道：
 *   zhihu:get-config      → 读配置状态（**不含明文**，见 services/zhihu-credential 三态语义）
 *   zhihu:save-config     → 校验 + safeStorage 加密 + 按用户落盘 + 销账旧版明文
 *   zhihu:test-connection → 连通性测试（可传未保存的明文；无参时用已存配置并在成功后记 verifiedAt）
 *   zhihu:clear-config    → 清除（加密行 + 旧版明文行）
 *
 * 返回格式统一为 { code: 0, data } / { code: <负数>, message, data? }。
 * 明文密钥**只**在这四个通道的内存里出现，绝不回给渲染端（get-config 只回遮罩）。
 *
 * 与 feishu-settings 的差异（有意）：飞书是「AppID + Secret」两段式，知乎只有一段 Secret，
 * 故这里没有 appId 参数；加密与拒绝降级明文的姿态与飞书完全一致（同一套 services/crypto）。
 */

const { withSenderCheck } = require('./helpers')
const { ERROR } = require('../core/error-codes')
const credential = require('../services/zhihu-credential')
const ZhihuFavlistService = require('../services/zhihu-favlist-service')

function _msg (e) {
  return e && e.message ? e.message : String(e)
}

function registerHandlers (ipcMain, deps) {
  const store = deps && deps.store
  if (!store || typeof store.getSetting !== 'function' || typeof store.setSetting !== 'function') return

  const logger = (deps && deps.log) || require('../services/logger')
  // service 可注入（测试缝，与 zhihu-favlist 的 rateControllerFactory 同思路）；生产用真实客户端
  const service = (deps && deps.service) || new ZhihuFavlistService({ log: logger })

  // ─── 读配置状态（不回明文） ───
  ipcMain.handle('zhihu:get-config', withSenderCheck(() => {
    try {
      return { code: 0, data: credential.readConfig(store) }
    } catch (e) {
      return { code: ERROR.REQUEST_ERROR, message: _msg(e) }
    }
  }))

  // ─── 保存配置（加密 + 按用户隔离） ───
  ipcMain.handle('zhihu:save-config', withSenderCheck((_event, accessSecret) => {
    try {
      // 参数校验与落盘失败分码：前者是用户可自行修正的输入问题（-2），后者是环境问题（-1）
      const checked = credential.validateSecret(accessSecret)
      if (!checked.ok) {
        return { code: ERROR.VALIDATION_ERROR, message: checked.error, data: { configured: false } }
      }
      const r = credential.saveConfig(store, checked.value)
      if (!r.ok) {
        return { code: ERROR.REQUEST_ERROR, message: r.error, data: { configured: false } }
      }
      return {
        code: 0,
        data: { configured: true, maskedSecret: r.data.maskedSecret, updatedAt: r.data.updatedAt },
      }
    } catch (e) {
      return { code: ERROR.REQUEST_ERROR, message: _msg(e) }
    }
  }))

  // ─── 连通性测试 ───
  // 传入明文：测「还没保存的这个值」，不落盘（用户还没确认要保存）
  // 无参：测「已保存的配置」，成功后记 verifiedAt（这是唯一能产生「已验证」证据的路径）
  ipcMain.handle('zhihu:test-connection', withSenderCheck(async (_event, accessSecret) => {
    try {
      const explicit = typeof accessSecret === 'string' && accessSecret.trim() !== ''
      let secret = ''
      if (explicit) {
        const checked = credential.validateSecret(accessSecret)
        if (!checked.ok) {
          return { code: ERROR.VALIDATION_ERROR, message: checked.error, data: { ok: false } }
        }
        secret = checked.value
      } else {
        secret = credential.resolveSecret(store).secret
        if (!secret) {
          return {
            code: ERROR.REQUEST_ERROR,
            message: '未配置知乎 Access Secret，请先在「设置 → 知乎 API」中配置',
            data: { ok: false },
          }
        }
      }

      const r = await service.testConnection(secret)
      if (!r || r.success !== true) {
        return {
          code: ERROR.REQUEST_ERROR,
          message: (r && r.error) ? r.error : '知乎 API 调用失败',
          retryable: Boolean(r && r.retryable),
          data: { ok: false, retryable: Boolean(r && r.retryable) },
        }
      }
      const favlistCount = Number.isFinite(r.favlistCount) ? Number(r.favlistCount) : 0
      if (!explicit) credential.markVerified(store, { favlistCount })
      return { code: 0, data: { ok: true, favlistCount } }
    } catch (e) {
      return { code: ERROR.REQUEST_ERROR, message: _msg(e), data: { ok: false } }
    }
  }))

  // ─── 清除配置 ───
  ipcMain.handle('zhihu:clear-config', withSenderCheck(() => {
    try {
      const r = credential.clearConfig(store)
      if (!r.ok) return { code: ERROR.REQUEST_ERROR, message: r.error, data: { cleared: false } }
      return { code: 0, data: { cleared: true } }
    } catch (e) {
      return { code: ERROR.REQUEST_ERROR, message: _msg(e), data: { cleared: false } }
    }
  }))
}

module.exports = registerHandlers
