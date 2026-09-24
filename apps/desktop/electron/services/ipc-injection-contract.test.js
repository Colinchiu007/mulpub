/**
 * P1-14 IPC 注入契约回归（service 侧不得回退全局 ipcMain）
 *
 * 背景：services/*.js 的 `registerIpcHandlers(injectedIpcMain)` 历史写法是
 *   `const ipcMain = injectedIpcMain || require('electron').ipcMain`
 * 一旦某个调用点漏传注入对象，就会静默注册到**全局** ipcMain 上：
 * 既绕过 createAccessControlledIpcMain 的 isTrustedSender 来源校验，
 * 也绕过许可证/权益门禁；而在纯 Node 单测里则退化成一个无信息量的 TypeError。
 *
 * 本文件锁死两件事：
 *  1) 静态：全仓生产源码不得再出现"回退全局 ipcMain"的写法；定义了 injectedIpcMain 的文件必须有 fail-closed 守卫；
 *  2) 行为：未注入时抛出的错误必须可操作（点名"受控 ipcMain"），而不是 TypeError。
 */
import { describe, it, expect } from 'vitest'

const fs = require('fs')
const path = require('path')

const SERVICES_DIR = path.resolve(__dirname)
const HANDLERS_DIR = path.resolve(__dirname, '..', 'ipc-handlers')

/** 生产源码判定：排除测试与类型声明 */
function isProdSource (name) {
  return name.endsWith('.js') && !name.endsWith('.test.js') && !name.endsWith('.d.ts')
}

function listProdFiles (dir, recursive = true) {
  const results = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = fs.statSync(full)
    if (stat.isFile() && isProdSource(entry)) {
      results.push(full)
    } else if (stat.isDirectory() && recursive) {
      // 递归扫描子目录（如 webview-manager/ 拆分模块）
      results.push(...listProdFiles(full, true))
    }
  }
  return results
}

const ALL_FILES = [...listProdFiles(SERVICES_DIR), ...listProdFiles(HANDLERS_DIR)]
const REGISTRATION_RE = /registerIpcHandlers\s*\(\s*injectedIpcMain\s*\)\s*\{/
const FALLBACK_RE = /injectedIpcMain\s*\|\|\s*require\(\s*['"]electron['"]\s*\)\s*\.\s*ipcMain/
const GUARD_RE = /if\s*\(\s*!injectedIpcMain\s*\)\s*\{[\s\S]{0,300}?throw\s+new\s+Error/

describe('P1-14 IPC 注入契约（静态）', () => {
  it('生产源码中不存在"回退全局 ipcMain"的写法', () => {
    const offenders = ALL_FILES
      .filter((f) => FALLBACK_RE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
    expect(offenders).toEqual([])
  })

  it('至少覆盖到全部历史受影响文件（防止用例空转）', () => {
    const covered = ALL_FILES
      .filter((f) => REGISTRATION_RE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => {
        const rel = path.relative(SERVICES_DIR, f)
        // webview-manager 拆分后 registerIpcHandlers 在 webview-manager/ipc-handlers.js，
        // 用目录名映射回历史文件名，保持契约断言的语义不变
        return rel.startsWith('webview-manager' + path.sep) ? 'webview-manager.js' : path.basename(f)
      })
    // 11 个服务曾使用回退写法（cloud-publisher 已先行修好，同样落在守卫集合内）
    for (const name of [
      'batch-manager.js', 'comment-manager.js', 'content-intelligence.js',
      'oauth-manager.js', 'provider-manager.js', 'publish-impact-tracker.js',
      'qrcode-login.js', 'url-collector.js', 'viral-engine.js',
      'webview-manager.js', 'cloud-publisher.js',
    ]) {
      expect(covered, `未识别到 ${name} 的 registerIpcHandlers(injectedIpcMain)`).toContain(name)
    }
  })

  it('声明 injectedIpcMain 的文件必须带 fail-closed 守卫', () => {
    const missing = ALL_FILES
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8')
        return REGISTRATION_RE.test(src) && !GUARD_RE.test(src)
      })
      .map((f) => path.basename(f))
    expect(missing).toEqual([])
  })
})

describe('P1-14 IPC 注入契约（行为）', () => {
  const fakeIpcMain = () => ({ handle: () => {}, on: () => {}, removeHandler: () => {} })

  it('PublishImpactTracker 未注入时抛可操作错误（而非 TypeError）', () => {
    const Tracker = require('./publish-impact-tracker')
    const tracker = new Tracker({})
    expect(() => tracker.registerIpcHandlers()).toThrow(/受控 ipcMain|injected ipcMain/)
    expect(() => tracker.registerIpcHandlers(fakeIpcMain())).not.toThrow()
  })

  it('BatchManager 未注入时抛可操作错误，注入后正常注册', () => {
    const BatchManager = require('./batch-manager')
    const manager = new BatchManager({ get: () => [], set: () => {} })
    expect(() => manager.registerIpcHandlers()).toThrow(/受控 ipcMain|injected ipcMain/)
    let registered = 0
    const ipc = { handle: () => { registered += 1 } }
    manager.registerIpcHandlers(ipc)
    expect(registered).toBeGreaterThan(0)
  })

  it('OAuthManager 未注入时抛可操作错误，注入后正常注册', () => {
    const OAuthManager = require('./oauth-manager')
    const manager = new OAuthManager({})
    expect(() => manager.registerIpcHandlers()).toThrow(/受控 ipcMain|injected ipcMain/)
    let registered = 0
    manager.registerIpcHandlers({ handle: () => { registered += 1 } })
    expect(registered).toBeGreaterThan(0)
  })
})
