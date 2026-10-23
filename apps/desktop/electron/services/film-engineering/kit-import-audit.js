// @ts-check
'use strict'
/**
 * kit-import-audit — 导入审计（追加式日志 + 阈值判法 + 行格式）
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §三 S17 / §五 / §十 附录
 *
 * 契约（逐条来自方案）：
 *   - 文件 `userData/film-kit-import.log`（与目标 kit **同父**）；
 *   - **行格式**：UTC ISO8601 时间戳 + **制表符分隔** + UTF-8 + `\n`；
 *   - 字段：时间 / sender URL / sender 路由 / 触发组件（可空 ⇒ `-`）/ 所选目录（可空 ⇒ `-`）/
 *     结果 / reason / post_check（可空 ⇒ `-`）/ recovery_state（可空 ⇒ `-`）/ 恢复路径（可空 ⇒ `-`）；
 *   - 写入时机：**每次 IPC 调用后**（成功与失败都写）；**写入失败 ⇒ 拒绝导入**（审计不可静默丢失）；
 *   - 保留：单文件追加；**> 10,000 行或 > 10 MB ⇒ 拒绝写入并拒绝新的导入**
 *     （**不追加、不截断** ⇒ 旧内容不丢；轮转是运维约定，步骤见 i18n `filmKitImportAuditFull`）；
 *   - **阈值判法**：大小以 `fs.stat` 读（追加前一次）为主；**行数在启动时一次性计数 + 之后按追加增量累加**
 *     （不每次全量读文件 ⇒ 不随日志增长线性变慢）；**检查时机 = 建锁后、首次追加前**；
 *   - 权限：可追加、不可改写（`fs.open({flags:'a'})`）。
 *
 * ⚠ 诚实边界：审计防的是「**静默**」，**不防恶意篡改**（本机主人能改自己的文件）。
 */

const nodeFs = require('fs')
const nodePath = require('path')

/** 审计文件名（与目标 kit 同父目录） */
const AUDIT_FILE = 'film-kit-import.log'
/** 行数阈值：超过即拒绝写入（不截断） */
const MAX_AUDIT_LINES = 10000
/** 字节阈值：超过即拒绝写入（不截断） */
const MAX_AUDIT_BYTES = 10 * 1024 * 1024

/** 失败原因（闭集见方案 §五） */
const REASON = Object.freeze({
  AUDIT_UNAVAILABLE: 'AUDIT_UNAVAILABLE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
})

/** 审计文件路径 */
function auditFilePathOf (userDataDir) {
  return nodePath.join(userDataDir, AUDIT_FILE)
}

/** 空值占位（`-`） */
function dash (v) {
  if (v === null || v === undefined || v === '') return '-'
  return String(v).replace(/[\t\r\n]+/g, ' ')
}

/**
 * 组装一行审计（**制表符分隔**；顺序即字段顺序，与 `SCHEMA.md` 审计小节一致）。
 * @param {object} f 字段
 * @returns {string}
 */
function buildAuditRow (f) {
  const o = f || {}
  const fields = [
    o.time || new Date().toISOString(),
    dash(o.senderUrl),
    dash(o.senderRoute),
    dash(o.triggerComponent),
    dash(o.sourceDir),
    dash(o.result),
    dash(o.reason),
    dash(o.postCheck),
    dash(o.recoveryState),
    dash(o.recoveryPath),
  ]
  return fields.join('\t') + '\n'
}

/** 审计写入器（持有**增量行数**计数，避免每次全量读文件） */
class AuditWriter {
  /**
   * @param {object} opts
   * @param {string} opts.userDataDir
   * @param {object} [opts.fs]
   * @param {() => number} [opts.now]
   */
  constructor (opts) {
    const o = opts || {}
    this.fs = o.fs || nodeFs
    this.userDataDir = o.userDataDir
    this.now = o.now || Date.now
    this.path = auditFilePathOf(this.userDataDir)
    /** 增量行数（启动时一次性计数，之后按追加累加） */
    this.lineCount = 0
  }

  /**
   * 预检：审计文件**可创建/可写**。
   * ⚠ `fs.access` 对**不存在**的文件返回 ENOENT ⇒ 判**父目录**可写；
   *    **首次导入时审计文件不存在是合法的**（ENOENT ⇒ 视为「可创建」）。
   */
  precheck () {
    try {
      this.fs.accessSync(this.userDataDir, fsConstantsWritable())
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: REASON.AUDIT_UNAVAILABLE, message: '审计父目录不可写: ' + String(e && e.message) }
    }
  }

  /** 启动时一次性计数（之后增量累加） */
  countLines () {
    try {
      const raw = this.fs.readFileSync(this.path, 'utf8')
      if (!raw) { this.lineCount = 0; return 0 }
      this.lineCount = raw.split('\n').filter((l) => l.length > 0).length
    } catch (_e) {
      this.lineCount = 0
    }
    return this.lineCount
  }

  /**
   * 阈值判法：大小以 stat 读；行数用增量计数。
   * @returns {{ok:boolean, reason?:string, message?:string}}
   */
  checkCapacity () {
    let size
    try {
      size = this.fs.statSync(this.path).size
    } catch (_e) {
      size = 0 // 不存在 ⇒ 可创建
    }
    if (size > MAX_AUDIT_BYTES) {
      return { ok: false, reason: REASON.AUDIT_UNAVAILABLE, message: '审计文件超字节阈值，请手动轮转' }
    }
    if (this.lineCount > MAX_AUDIT_LINES) {
      return { ok: false, reason: REASON.AUDIT_UNAVAILABLE, message: '审计文件超行数阈值，请手动轮转' }
    }
    return { ok: true }
  }

  /**
   * 追加一行（**追加式、可追加不可改写**）。
   * ⚠ 写入失败 ⇒ 返回失败（**拒绝导入**，审计不可静默丢失）。
   */
  append (row) {
    const line = typeof row === 'string' ? row : buildAuditRow(row)
    const cap = this.checkCapacity()
    if (!cap.ok) return { ok: false, reason: cap.reason, message: cap.message }
    let fd = null
    try {
      fd = this.fs.openSync(this.path, 'a')
      this.fs.writeSync(fd, line, null, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: REASON.AUDIT_UNAVAILABLE, message: '审计写入失败: ' + String(e && e.message) }
    } finally {
      if (fd !== null) {
        try { this.fs.closeSync(fd) } catch (_e) { /* 关闭失败不影响已写入内容 */ }
      }
      this.lineCount += 1
    }
  }
}

function fsConstantsWritable () {
  try {
    return nodeFs.constants.W_OK
  } catch (_e) {
    return 2 // W_OK
  }
}

module.exports = {
  AUDIT_FILE,
  MAX_AUDIT_LINES,
  MAX_AUDIT_BYTES,
  REASON,
  auditFilePathOf,
  buildAuditRow,
  AuditWriter,
}
