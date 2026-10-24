'use strict'

/**
 * 主进程 stdout/stderr → 应用日志 桥（2026-10-24）
 *
 * 问题（PRD 8.32）：`packages/*` 里的 logger 一律 `console.log`，而应用日志只收
 * 自家 logger 写文件、**不抓 stdout** ⇒ 包内所有诊断在开发与生产中都不可见。
 * 实测代价：2026-10-24 头条排查中多次出现「改了→跑了→看不到→误判成没执行」。
 *
 * 做法：进程启动最早期接管 `process.stdout.write` / `process.stderr.write`，
 * 把每一行同时写进应用日志。**必须有重入保护**——应用 logger 自身可能写 console，
 * 不保护会无限递归。
 *
 * 只做透传，不改变原有输出行为（终端照常能看到）。
 */

let _installed = false
let _depth = 0

/**
 * @param {{logger?: {info:Function,warn:Function,error:Function}, tag?: string}} [opts]
 * @returns {boolean} 是否本次完成安装
 */
function install (opts) {
  if (_installed) return false
  const o = opts || {}
  let logger = o.logger
  if (!logger) {
    try { logger = require('./logger') } catch (_e) { return false }
  }
  if (!logger || typeof logger.info !== 'function') return false
  const tag = o.tag || 'Stdout'

  const bridge = function (orig, method, stream) {
    return function (chunk) {
      if (_depth === 0) {
        _depth++
        try {
          const s = typeof chunk === 'string' ? chunk : String(chunk)
          const line = s.replace(/\s+$/, '')
          if (line) logger[method](tag, line)
        } catch (_e) {
          // 日志桥自身失败绝不能影响主流程
        } finally {
          _depth--
        }
      }
      return orig.apply(stream, arguments)
    }
  }

  const outWrite = process.stdout.write.bind(process.stdout)
  const errWrite = process.stderr.write.bind(process.stderr)
  process.stdout.write = bridge(outWrite, 'info', process.stdout)
  process.stderr.write = bridge(errWrite, 'error', process.stderr)

  _installed = true
  return true
}

/** 仅供测试：复位安装状态（生产代码不要调用） */
function _resetForTest () {
  _installed = false
  _depth = 0
}

module.exports = { install, _resetForTest }
