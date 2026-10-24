// @ts-check
/**
 * 极简零依赖 logger — 与 shared-utils/logger 接口一致
 * 用于 api-publish-engine 内部模块（api-router 等需要 require('./logger')）
 */
function _fmt (level, tag, msg, meta) {
  const ts = new Date().toISOString()
  const base = '[' + ts + '] [' + level + '] [' + tag + '] ' + msg
  if (meta !== undefined) {
    try { return base + ' ' + JSON.stringify(meta) } catch (_) { return base }
  }
  return base
}

const _fs = require('fs')
const _path = require('path')
const _os = require('os')
// file-mirror（2026-10-24）：包内 logger 只写 stdout，而应用日志不收 stdout ⇒ 诊断永远不可见。
// 这里再写一份到临时文件，作为唯一可靠的可观测出口（可用 MP_PKG_LOG 覆盖路径）。
const _LOG_FILE = process.env.MP_PKG_LOG || '' // 只有显式设了 MP_PKG_LOG 才写文件（逃生口，默认不落盘）
function _toFile(line) { if (!_LOG_FILE) return; try { _fs.appendFileSync(_LOG_FILE, line + '\n') } catch (_e) {} }

const logger = {
  info: function (tag, msg, meta) { const l=_fmt('INFO', tag, msg, meta); console.log(l); _toFile(l) },
  warn: function (tag, msg, meta) { const l=_fmt('WARN', tag, msg, meta); console.warn(l); _toFile(l) },
  error: function (tag, msg, meta) { const l=_fmt('ERROR', tag, msg, meta); console.error(l); _toFile(l) },
  debug: function (tag, msg, meta) { if (process.env.DEBUG) console.log(_fmt('DEBUG', tag, msg, meta)) }
}

module.exports = logger
