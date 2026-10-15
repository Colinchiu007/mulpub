// @ts-check
/**
 * rate-limit IPC handlers — 桌面端限流自检（P2）
 *   rate-limit:self-check：运行真实 governor + 假 adapter 自检（authenticated，默认受限）
 *   rate-limit:report：把自检结果上报运营后台 /api/v1/scheduler/verify（simulated=0）
 */

const crypto = require('crypto')
const { runSelfCheck } = require('../services/rate-limit-self-check')

function _clientId (app) {
  try {
    if (!app || typeof app.getPath !== 'function') return ''
    return crypto.createHash('sha256').update(String(app.getPath('userData') || '')).digest('hex').slice(0, 16)
  } catch (_) { return '' }
}

function registerHandlers (ipcMain, deps) {
  const { opsCenterSync, app, log } = deps
  log && log.info('RateLimit', 'registerHandlers')

  ipcMain.handle('rate-limit:self-check', async (_event, params) => {
    try {
      const data = (params && typeof params === 'object') ? params : {}
      const result = await runSelfCheck(data)
      return { code: 0, data: result }
    } catch (e) {
      return { code: -1, message: e.message || String(e) }
    }
  })

  ipcMain.handle('rate-limit:report', async (_event, payload) => {
    try {
      if (!opsCenterSync || typeof opsCenterSync.getConfig !== 'function') {
        return { code: -1, message: '运营后台同步服务未就绪' }
      }
      const cfg = opsCenterSync.getConfig()
      if (!cfg.manualUrl || !cfg.apiKeyConfigured || typeof opsCenterSync.getCatalogApiKey !== 'function') {
        return { code: -1, message: '未配置运营后台同步（地址/Key），无法上报自检结果' }
      }
      const data = (payload && typeof payload === 'object') ? payload : {}
      const result = data.result
      if (!result || !result.metrics) return { code: -1, message: '缺少自检结果' }
      const p = (data.params && typeof data.params === 'object') ? data.params : {}
      const body = {
        preset_id: data.preset_id || null,
        rpm: Number(p.rpm) || 20,
        max_concurrent: p.maxConcurrent != null ? Number(p.maxConcurrent) : null,
        limit_per_5h: p.limitPer5h != null ? Number(p.limitPer5h) : null,
        request_count: Number(p.requestCount) || 1,
        request_duration_ms: Number(p.requestDurationMs) || 0,
        inject_429_at: p.inject429At != null ? Number(p.inject429At) : null,
        exceed_5h: false,
        simulated: false,
        engine: 'real-governor',
        client_id: _clientId(app),
        metrics: result.metrics,
        assertions: result.assertions || [],
        timeline: result.timeline || [],
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), 10000) : null
      try {
        const resp = await fetch(String(cfg.manualUrl).replace(/\/+$/, '') + '/api/v1/scheduler/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Catalog-Key': opsCenterSync.getCatalogApiKey(), Accept: 'application/json' },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: controller && controller.signal,
        })
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        const json = await resp.json().catch(() => ({}))
        return { code: 0, run_id: json.run_id || null, message: '自检结果已上报运营后台' }
      } finally {
        if (timer) clearTimeout(timer)
      }
    } catch (e) {
      const isTimeout = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')
      return { code: -1, message: isTimeout ? '上报超时' : (e.message || String(e)) }
    }
  })
}

module.exports = { registerHandlers }
