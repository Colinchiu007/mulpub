// @ts-check
'use strict'
/**
 * film-engineering-import — 影视工程「资产导入」IPC 通道（PR-3b · F-J 写路径）
 *
 * 通道：
 *   film-engineering:import-kit → 用户导入自己的影视工程资产包（整体替换 userData/film-kit）
 *
 * 关键合同（方案 `pr3b-import-design.md`）：
 *   - **入参为空** ⇒ 路径**只能**来自 handler 内部的原生对话框（renderer 无法指定替换内容）；
 *   - **sender 授权断言（硬）**：① 只允许**主框架**（`senderFrame.parent` 存在 ⇒ 子框架 ⇒ 拒）；
 *     ② URL 协议限 `app:`（打包态）/ `http(s):`（开发态）；③ hash 路由前缀须为 `/film-engineering`
 *     （三个标签页都在这条路由下 ⇒ **不误伤合法调用**）；不命中一律 `UNAUTHORIZED_SENDER`；
 *   - **UNC / 非目录**在 handler 层就拒（S22 在 IPC 层与服务层**都执行**）；
 *   - 取消 ⇒ `{ code: 0, data: { cancelled: true, reason: 'CANCELLED' } }`（取消**不算失败**）；
 *   - 失败 ⇒ 带回 `errorCode`（= 方案 §五 的 `reason` 闭集值，渲染端据此本地化）+ 恢复路径。
 *
 * ⚠ 本文件**独立于** `film-engineering-auto.js`：后者已 446 行、`check-max-lines` 硬限 500；
 *   写路径与只读分文件也与 design D19（写路径单独一批）同向。
 */

const fs = require('fs')

const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('./helpers')
const { importKit, REASON } = require('../services/film-engineering/kit-import')
const { loadFilmKit } = require('../services/film-engineering/kit-loader')

/** 允许的 URL 协议（打包态 app: / 开发态 http(s):） */
const ALLOWED_PROTOCOLS = Object.freeze(['app:', 'http:', 'https:'])
/** 允许的 hash 路由前缀（影视工程三个标签页都在这条路由下） */
const ROUTE_PREFIX = '/film-engineering'

/** 失败 reason ⇒ 粗粒度错误码（细粒度在 errorCode 里，渲染端据此本地化） */
const CODE_BY_REASON = Object.freeze({
  UNAUTHORIZED_SENDER: EC.AUTH_ERROR,
  AUDIT_UNAVAILABLE: EC.IO_ERROR,
  SWAP_FAILED: EC.IO_ERROR,
  ROLLBACK_FAILED: EC.IO_ERROR,
  PARENT_NOT_WRITABLE: EC.IO_ERROR,
})

/**
 * 解析 hash 路由（本仓是 `createWebHashHistory` ⇒ 路由在 `#` 之后，`pathname` 恒为 `/` ⇒ 不参与判断）。
 * @param {string} rawUrl
 * @returns {{protocol: string|null, route: string|null}}
 */
function parseHashRoute (rawUrl) {
  try {
    const u = new URL(String(rawUrl))
    const hash = String(u.hash || '').replace(/^#/, '')
    const route = hash.split('?')[0].replace(/\/+$/, '')
    return { protocol: u.protocol, route: route || null }
  } catch (_e) {
    return { protocol: null, route: null }
  }
}

/**
 * sender 授权断言（**写路径一律 fail-closed**）。
 * @returns {{ok:boolean, message?:string, senderUrl?:string, senderRoute?:string}}
 */
function authorizeSender (event) {
  const frame = event && event.senderFrame
  if (!frame) return { ok: false, message: '缺少 senderFrame' }
  if (frame.parent) return { ok: false, message: '子框架不得调用写路径' }
  const url = frame.url
  if (!url) return { ok: false, message: '缺少 sender url' }
  const { protocol, route } = parseHashRoute(url)
  if (!protocol || ALLOWED_PROTOCOLS.indexOf(protocol) < 0) {
    return { ok: false, message: '协议不允许: ' + String(protocol) }
  }
  if (!route || (route !== ROUTE_PREFIX && route.indexOf(ROUTE_PREFIX + '/') !== 0)) {
    return { ok: false, message: '路由不匹配: ' + String(route) }
  }
  return { ok: true, senderUrl: url, senderRoute: route }
}

/**
 * 注册导入通道。
 * @param {import('electron').IpcMain} ipcMain
 * @param {object} deps
 */
function registerImportHandlers (ipcMain, deps) {
  const o = deps || {}
  const log = o.log || { info () {}, warn () {}, error () {} }
  const service = o.filmEngineeringService
  const dialog = o.dialog
  const importFn = o._testImportKit || importKit
  const loadKit = o._testLoadFilmKit || loadFilmKit

  ipcMain.handle('film-engineering:import-kit', withSenderCheck(async (event) => {
    // ── ① sender 授权断言（硬；写路径不 fail-open）────────────────
    const auth = authorizeSender(event)
    if (!auth.ok) {
      log.warn('[film-engineering:import-kit] 未授权来源:', auth.message)
      return { code: EC.AUTH_ERROR, errorCode: REASON.UNAUTHORIZED_SENDER, message: auth.message }
    }

    // ── ② 原生对话框（**入参为空** ⇒ 路径只能由用户选）────────────
    const dialogApi = dialog || (() => {
      try { return require('electron').dialog } catch (_e) { return null }
    })()
    if (!dialogApi || typeof dialogApi.showOpenDialog !== 'function') {
      return { code: EC.REQUEST_ERROR, errorCode: 'DIALOG_UNAVAILABLE', message: '目录选择对话框不可用' }
    }
    let picked
    try {
      picked = await dialogApi.showOpenDialog({
        title: '选择影视工程资产目录',
        properties: ['openDirectory'],
      })
    } catch (e) {
      return { code: EC.REQUEST_ERROR, errorCode: 'DIALOG_FAILED', message: String(e && e.message) }
    }
    if (!picked || picked.canceled === true || !picked.filePaths || picked.filePaths.length === 0) {
      return { code: 0, data: { cancelled: true, reason: 'CANCELLED' } }
    }

    // ── ③ handler 层也拒：非目录 / UNC 网络路径（S22 两层都执行）──
    const kitDir = picked.filePaths[0]
    if (!kitDir || String(kitDir).startsWith('\\\\')) {
      return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '不支持网络路径（UNC）' }
    }
    try {
      if (!fs.statSync(kitDir).isDirectory()) {
        return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '所选路径不是目录' }
      }
    } catch (_e) {
      return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '所选路径不可读' }
    }

    // ── ④ 执行导入（编排层负责 ⓪-⑦）──────────────────────────────
    const userDataDir = service && service.userDataDir
    if (!userDataDir) {
      return { code: EC.REQUEST_ERROR, errorCode: 'USERDATA_UNAVAILABLE', message: '目标目录不可用' }
    }
    const res = await importFn({
      kitDir,
      userDataDir,
      service,
      loadFilmKit: loadKit,
      senderUrl: auth.senderUrl,
      senderRoute: auth.senderRoute,
      triggerComponent: o.triggerComponent || 'FilmEngineeringView',
    })
    if (!res.ok) {
      const code = CODE_BY_REASON[res.reason] || EC.VALIDATION_ERROR
      return {
        code,
        errorCode: res.reason || 'VALIDATION_ERROR',
        message: res.message || '导入失败',
        data: {
          recoveryPath: res.recoveryPath || null,
          recoveryState: res.recoveryState || null,
        },
      }
    }
    return {
      code: 0,
      data: {
        ok: true,
        fileCount: res.stats ? res.stats.fileCount : 0,
        totalBytes: res.stats ? res.stats.totalBytes : 0,
      },
    }
  }))
}

module.exports = {
  registerImportHandlers,
  authorizeSender,
  parseHashRoute,
  ALLOWED_PROTOCOLS,
  ROUTE_PREFIX,
}
