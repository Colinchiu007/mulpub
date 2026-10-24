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
const { AuditWriter } = require('../services/film-engineering/kit-import-audit')
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
 * 写一行**结果**审计（未进入导入流程的那些早退路径）。
 *
 * ⚠ 为什么在 IPC 层写（2026-10-23 验证层外部评审 codex i4 修）：
 *   契约（`SCHEMA.md` §11.5）要求「每次 IPC 调用都有审计痕迹」，而初版里
 *   **未授权 / 对话框不可用 / 对话框失败 / 用户取消** 这四条路径
 *   **一行都不写** ⇒ 一次未授权的调用在审计里**完全不存在**。
 *
 * ⚠ `reason` 必须落在**导入流程的 reason 闭集**内（`SCHEMA.md` §11.4）：
 *   `DIALOG_UNAVAILABLE` / `DIALOG_FAILED` 是 **IPC 层**的错误码，不在闭集里
 *   ⇒ 审计行记 `VALIDATION_ERROR`（"请求无法准备"这一类），**精确错误码仍回传给渲染端**。
 * ⚠ 目标目录不可用（`USERDATA_UNAVAILABLE`）⇒ **物理上无处可写** ⇒ 该行不存在
 *   （写不出审计不是"漏写"，是"没有可写的审计文件"；`SCHEMA.md` §11.5 已写明这条例外）。
 */
function writeOutcomeAudit (opts) {
  const o = opts || {}
  const userDataDir = o.userDataDir
  if (!userDataDir) return { ok: false, reason: 'USERDATA_UNAVAILABLE' }
  try {
    const audit = new AuditWriter({ userDataDir })
    audit.countLines()
    const row = audit.append({
      time: new Date().toISOString(),
      senderUrl: o.senderUrl || null,
      senderRoute: o.senderRoute || null,
      triggerComponent: o.triggerComponent || null,
      sourceDir: o.sourceDir || null,
      result: o.result || 'failed',
      reason: o.reason || null,
      postCheck: null,
      recoveryState: null,
      recoveryPath: null,
    })
    return row
  } catch (e) {
    return { ok: false, message: String(e && e.message) }
  }
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
  const userDataDir = service && service.userDataDir
  const triggerComponent = o.triggerComponent || 'FilmEngineeringView'

  // ⚠ `onUntrusted`：来源门禁在 handler **之前**拦截 ⇒ handler 里的代码根本不执行
  //   ⇒ 外部来源的未授权调用若要进审计，只能由这一格回调补写
  //   （2026-10-23 验证层外部评审 codex i1 命中：初版「每次 IPC 调用都有痕迹」被自身行为证伪）。
  ipcMain.handle('film-engineering:import-kit', withSenderCheck(async (event) => {
    // ── ① sender 授权断言（硬；写路径不 fail-open）────────────────
    const auth = authorizeSender(event)
    if (!auth.ok) {
      log.warn('[film-engineering:import-kit] 未授权来源:', auth.message)
      writeOutcomeAudit({
        userDataDir,
        triggerComponent,
        result: 'failed',
        reason: REASON.UNAUTHORIZED_SENDER,
      })
      return { code: EC.AUTH_ERROR, errorCode: REASON.UNAUTHORIZED_SENDER, message: auth.message }
    }

    // ── ② 原生对话框（**入参为空** ⇒ 路径只能由用户选）────────────
    const dialogApi = dialog || (() => {
      try { return require('electron').dialog } catch (_e) { return null }
    })()
    if (!dialogApi || typeof dialogApi.showOpenDialog !== 'function') {
      writeOutcomeAudit({
        userDataDir,
        triggerComponent,
        senderUrl: auth.senderUrl,
        senderRoute: auth.senderRoute,
        result: 'failed',
        reason: REASON.VALIDATION_ERROR,
      })
      return { code: EC.REQUEST_ERROR, errorCode: 'DIALOG_UNAVAILABLE', message: '目录选择对话框不可用' }
    }
    let picked
    try {
      picked = await dialogApi.showOpenDialog({
        title: '选择影视工程资产目录',
        properties: ['openDirectory'],
      })
    } catch (e) {
      writeOutcomeAudit({
        userDataDir,
        triggerComponent,
        senderUrl: auth.senderUrl,
        senderRoute: auth.senderRoute,
        result: 'failed',
        reason: REASON.VALIDATION_ERROR,
      })
      return { code: EC.REQUEST_ERROR, errorCode: 'DIALOG_FAILED', message: String(e && e.message) }
    }
    if (!picked || picked.canceled === true || !picked.filePaths || picked.filePaths.length === 0) {
      // 取消**也留痕**（一次取消说明用户点过入口 ⇒ 审计里应当看得见）
      writeOutcomeAudit({
        userDataDir,
        triggerComponent,
        senderUrl: auth.senderUrl,
        senderRoute: auth.senderRoute,
        result: 'cancelled',
        reason: REASON.CANCELLED,
      })
      return { code: 0, data: { cancelled: true, reason: 'CANCELLED' } }
    }

    // ── ③ handler 层也拒：非目录 / UNC 网络路径（S22 两层都执行）──
    const kitDir = picked.filePaths[0]
    if (!kitDir || String(kitDir).startsWith('\\\\')) {
      writeOutcomeAudit({
        userDataDir,
        triggerComponent,
        senderUrl: auth.senderUrl,
        senderRoute: auth.senderRoute,
        result: 'failed',
        reason: REASON.NOT_A_DIRECTORY,
      })
      return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '不支持网络路径（UNC）' }
    }
    try {
      if (!fs.statSync(kitDir).isDirectory()) {
        writeOutcomeAudit({
          userDataDir,
          triggerComponent,
          senderUrl: auth.senderUrl,
          senderRoute: auth.senderRoute,
          result: 'failed',
          reason: REASON.NOT_A_DIRECTORY,
        })
        return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '所选路径不是目录' }
      }
    } catch (_e) {
      writeOutcomeAudit({
        userDataDir,
        triggerComponent,
        senderUrl: auth.senderUrl,
        senderRoute: auth.senderRoute,
        result: 'failed',
        reason: REASON.NOT_A_DIRECTORY,
      })
      return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '所选路径不可读' }
    }

    // ── ④ 执行导入（编排层负责 ⓪-⑦）──────────────────────────────
    if (!userDataDir) {
      // ⚠ 目标目录不可用 ⇒ 审计文件**无处可写** ⇒ 这一行物理上不存在
      return { code: EC.REQUEST_ERROR, errorCode: 'USERDATA_UNAVAILABLE', message: '目标目录不可用' }
    }
    const res = await importFn({
      kitDir,
      userDataDir,
      service,
      loadFilmKit: loadKit,
      senderUrl: auth.senderUrl,
      senderRoute: auth.senderRoute,
      triggerComponent,
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
          // ⚠ **失败路径**的审计行写失败也要透传（2026-10-23 验证层外部评审
          //   claude i1 / codex i6）：初版只查成功路径 ⇒ 「这次失败连审计都没留下」被静默。
          auditWritten: res.auditWritten !== false,
          auditMessage: res.auditMessage || null,
        },
      }
    }
    return {
      code: 0,
      data: {
        ok: true,
        fileCount: res.stats ? res.stats.fileCount : 0,
        totalBytes: res.stats ? res.stats.totalBytes : 0,
        // ⚠ **成功也可能带残留**（`.bak` 未删 ⇒ BAK_LEFT / 锁未删 ⇒ LOCK_LEFT）：
        //   导入**已生效**，但现场有残留要用户手动清 ⇒ 必须透传给渲染端
        //   （2026-10-23 验证层外部评审 claude i3 / codex i6 修：初版这两个字段
        //   只在失败分支回传 ⇒ 成功路径的残留**永远到不了用户眼前**）。
        recoveryState: res.recoveryState || null,
        recoveryPath: res.recoveryPath || null,
        // 审计结果行写失败 ⇒ 导入已生效但审计不完整 ⇒ 显式告知，不静默
        auditWritten: res.auditWritten !== false,
        auditMessage: res.auditMessage || null,
      },
    }
  }, {
    // 来源不可信（外部页面 / 子框架）⇒ handler 不会执行 ⇒ 由这一格补写审计行
    onUntrusted: () => {
      writeOutcomeAudit({
        userDataDir,
        triggerComponent,
        result: 'failed',
        reason: REASON.UNAUTHORIZED_SENDER,
      })
    },
  }))
}

// ⚠ 导出形态**必须与同族一致**（`film-engineering.js` / `film-engineering-auto.js` 都是
//   「模块本身可调用 + 附带具名导出」）：`ipc-handlers/index.js` 里是
//   `require('./film-engineering-import')(ipcMain, deps)` ⇒ 若本模块只导出**对象**，
//   整条 IPC 注册面会在装配时抛 `TypeError: require(...) is not a function`
//   （2026-10-23 CI 首轮抓到：本片首版就是这样 ⇒ 17 条「装配锁」用例全红；
//   本地只跑本模块的单测**测不到**，因为它们直接 import `registerImportHandlers`）。
module.exports = registerImportHandlers
module.exports.registerImportHandlers = registerImportHandlers
module.exports.authorizeSender = authorizeSender
module.exports.parseHashRoute = parseHashRoute
module.exports.writeOutcomeAudit = writeOutcomeAudit
module.exports.ALLOWED_PROTOCOLS = ALLOWED_PROTOCOLS
module.exports.ROUTE_PREFIX = ROUTE_PREFIX
