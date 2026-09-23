// @ts-check
/**
 * Provider Manager — LLM Provider 配置管理 (Electron 主进程模块)
 *
 * 桥接渲染进程 ↔ orchestrator Provider Admin/User API
 * 复用 viral-engine.js 的 HTTP 调用模式
 *
 * Admin API (prefix: /api/admin):
 *   GET    /providers           — 列出所有 Provider
 *   POST   /providers           — 创建新 Provider
 *   PUT    /providers/{name}    — 更新 Provider
 *   DELETE /providers/{name}    — 删除 Provider
 *   POST   /model-presets/{name}/test — 测试连接（真实 API 调用）
 *
 * User API (prefix: /api/user):
 *   GET    /providers           — 按层级列出可用 Provider
 *   GET    /providers/{name}    — 获取单个（密钥脱敏）
 *   PUT    /providers/{name}/key   — 设置用户 API Key
 *   DELETE /providers/{name}/key   — 移除用户 Key 覆盖
 */
const log = require('./logger')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')

const ORCHESTRATOR_BASE = process.env.ORCHESTRATOR_URL || ''

class ProviderManager {
  constructor () {
    this._axios = null
  }

  _getAxios () {
    if (!this._axios) {
      this._axios = require('axios')
    }
    return this._axios
  }

  async _callApi (method, path, body) {
    const axios = this._getAxios()
    const url = `${ORCHESTRATOR_BASE}${path}`
    try {
      const response = await axios({ method, url, data: body, timeout: 15000 })
      return { code: 0, data: response.data, message: 'ok' }
    } catch (err) {
      const status = err.response?.status
      const detail = err.response?.data?.detail
      log.error('ProviderManager', `${method} ${path} failed: ${status} ${detail || err.message}`)
      return {
        code: status || -1,
        data: null,
        message: detail || err.message || '请求失败'
      }
    }
  }

  // ─── Admin CRUD ────────────────────────────────

  /** 列出所有 Provider */
  async listProviders () {
    return this._callApi('get', '/api/v1/model-presets')
  }

  /** 创建 Provider */
  async createProvider (data) {
    return this._callApi('post', '/api/v1/model-presets', data)
  }

  /** 更新 Provider */
  async updateProvider (name, data) {
    return this._callApi('put', `/api/v1/model-presets/${encodeURIComponent(name)}`, data)
  }

  /** 删除 Provider */
  async deleteProvider (name) {
    return this._callApi('delete', `/api/v1/model-presets/${encodeURIComponent(name)}`)
  }

  /** 测试连接 */
  async testProvider (name) {
    return this._callApi('post', `/api/v1/model-presets/${encodeURIComponent(name)}/test`)
  }

  // ─── User API ──────────────────────────────────

  /** 列出可用 Provider（按用户层级过滤） */
  async listUserProviders () {
    return this._callApi('get', '/api/user/providers')
  }

  /** 获取单个 Provider（密钥脱敏） */
  async getUserProvider (name) {
    return this._callApi('get', `/api/user/providers/${encodeURIComponent(name)}`)
  }

  /** 设置用户自己的 API Key */
  async setUserKey (name, apiKey, baseUrl) {
    return this._callApi('put', `/api/user/providers/${encodeURIComponent(name)}/key`, {
      api_key: apiKey,
      base_url: baseUrl || ''
    })
  }

  /** 移除用户 API Key 覆盖 */
  async deleteUserKey (name) {
    return this._callApi('delete', `/api/user/providers/${encodeURIComponent(name)}/key`)
  }

  // ─── IPC Handler 注册 ──────────────────────────

  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] provider-manager registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    const ipcMain = injectedIpcMain;
    ipcMain.handle('provider:list', async () => {
      try {
        return await this.listProviders()
      } catch (e) {
        log.error('ProviderManager', 'list error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    })

    ipcMain.handle('provider:create', withSenderCheck(async (event, data) => {
      try {
        return await this.createProvider(data)
      } catch (e) {
        log.error('ProviderManager', 'create error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('provider:update', withSenderCheck(async (event, name, data) => {
      try {
        return await this.updateProvider(name, data)
      } catch (e) {
        log.error('ProviderManager', 'update error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('provider:delete', withSenderCheck(async (event, name) => {
      try {
        return await this.deleteProvider(name)
      } catch (e) {
        log.error('ProviderManager', 'delete error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('provider:test', async (event, name) => {
      try {
        return await this.testProvider(name)
      } catch (e) {
        log.error('ProviderManager', 'test error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    })

    ipcMain.handle('provider:get-user', async (event, name) => {
      try {
        return await this.getUserProvider(name)
      } catch (e) {
        log.error('ProviderManager', 'get-user error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    })

    ipcMain.handle('provider:list-user', async () => {
      try {
        return await this.listUserProviders()
      } catch (e) {
        log.error('ProviderManager', 'list-user error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    })

    ipcMain.handle('provider:set-user-key', withSenderCheck(async (event, name, apiKey, baseUrl) => {
      try {
        return await this.setUserKey(name, apiKey, baseUrl)
      } catch (e) {
        log.error('ProviderManager', 'set-user-key error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('provider:delete-user-key', withSenderCheck(async (event, name) => {
      try {
        return await this.deleteUserKey(name)
      } catch (e) {
        log.error('ProviderManager', 'delete-user-key error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))
  }
}

module.exports = ProviderManager
