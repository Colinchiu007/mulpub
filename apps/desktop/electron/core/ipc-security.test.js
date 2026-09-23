// @ts-check
/**
 * IPC 来源校验核心模块测试
 *
 * 目标：sender 来源判断不依赖 bootstrap 或 ipc-handlers，避免安全工具层形成循环依赖。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { isTrustedSender } = require('./ipc-security')

function makeEvent (url) {
  return { senderFrame: { url } }
}

const mockApp = { isPackaged: false }
const mockAppPackaged = { isPackaged: true, getAppPath: () => canonicalAppRoot }

let previousDevServerPort
let tempRoot
let canonicalAppRoot
let junctionAppRoot
let outsideRoot

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-ipc-security-'))
  canonicalAppRoot = path.join(tempRoot, 'canonical-app')
  junctionAppRoot = path.join(tempRoot, 'junction-app')
  outsideRoot = path.join(tempRoot, 'outside')

  fs.mkdirSync(path.join(canonicalAppRoot, 'dist', 'assets'), { recursive: true })
  fs.mkdirSync(path.join(canonicalAppRoot, 'dist-evil'), { recursive: true })
  fs.mkdirSync(outsideRoot, { recursive: true })
  fs.writeFileSync(path.join(canonicalAppRoot, 'dist', 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(canonicalAppRoot, 'dist', 'assets', 'app.js'), 'export {}')
  fs.writeFileSync(path.join(canonicalAppRoot, 'dist-evil', 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(outsideRoot, 'index.html'), '<!doctype html>')
  fs.symlinkSync(canonicalAppRoot, junctionAppRoot, process.platform === 'win32' ? 'junction' : 'dir')
  fs.symlinkSync(outsideRoot, path.join(canonicalAppRoot, 'dist', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
})

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

beforeEach(() => {
  previousDevServerPort = process.env.DEV_SERVER_PORT
  process.env.DEV_SERVER_PORT = '5174'
})

afterEach(() => {
  if (previousDevServerPort === undefined) delete process.env.DEV_SERVER_PORT
  else process.env.DEV_SERVER_PORT = previousDevServerPort
})

describe('ipc-security — isTrustedSender', () => {
  it('信任 app:// 协议', () => {
    expect(isTrustedSender(makeEvent('app://localhost/index.html'), mockAppPackaged)).toBe(true)
  })

  it('仅信任应用 dist 目录内的 file URL', () => {
    const allowedEntryUrl = pathToFileURL(path.join(canonicalAppRoot, 'dist', 'index.html')).href
    expect(isTrustedSender(makeEvent(allowedEntryUrl), mockAppPackaged)).toBe(true)
    expect(isTrustedSender(
      makeEvent(pathToFileURL(path.join(canonicalAppRoot, 'dist', 'missing.js')).href),
      mockAppPackaged,
    )).toBe(false)
    expect(isTrustedSender(makeEvent('file:///C:/app/index.html'), mockAppPackaged)).toBe(false)
    expect(isTrustedSender(
      makeEvent(pathToFileURL(path.join(canonicalAppRoot, 'dist-evil', 'index.html')).href),
      mockAppPackaged,
    )).toBe(false)
  })

  it('appPath 位于 junction 时信任 canonical dist sender URL', () => {
    const app = { isPackaged: true, getAppPath: () => junctionAppRoot }
    const canonicalEntryUrl = pathToFileURL(path.join(canonicalAppRoot, 'dist', 'index.html')).href
    const canonicalAssetUrl = pathToFileURL(path.join(canonicalAppRoot, 'dist', 'assets', 'app.js')).href

    expect(isTrustedSender(makeEvent(canonicalEntryUrl), app)).toBe(true)
    expect(isTrustedSender(makeEvent(canonicalAssetUrl), app)).toBe(true)
  })

  it('拒绝 dist 内链接逃逸到应用目录外的 file URL', () => {
    const escapedEntryUrl = pathToFileURL(path.join(canonicalAppRoot, 'dist', 'escape', 'index.html')).href
    const app = { isPackaged: true, getAppPath: () => canonicalAppRoot }

    expect(isTrustedSender(makeEvent(escapedEntryUrl), app)).toBe(false)
  })

  it('拒绝路径遍历和带凭据的 file URL', () => {
    const app = { isPackaged: true, getAppPath: () => canonicalAppRoot }
    const distUrl = pathToFileURL(path.join(canonicalAppRoot, 'dist')).href.replace(/\/$/, '')

    expect(isTrustedSender(makeEvent(`${distUrl}/%2e%2e/%2e%2e/outside/index.html`), app)).toBe(false)
    expect(isTrustedSender(makeEvent('file://user:secret@localhost/C:/app/index.html'), app)).toBe(false)
  })

  it('开发环境仅信任 localhost / 127.0.0.1 的配置端口', () => {
    expect(isTrustedSender(makeEvent('http://localhost:5174/'), mockApp)).toBe(true)
    expect(isTrustedSender(makeEvent('http://127.0.0.1:5174/'), mockApp)).toBe(true)
    expect(isTrustedSender(makeEvent('http://localhost:5173/'), mockApp)).toBe(false)
    expect(isTrustedSender(makeEvent('http://localhost/'), mockApp)).toBe(false)
  })

  // Bug fix (QM-5) 回归保护：Vite 端口漂移容错仅在 DEV_SERVER_PORT 未显式设置时生效
  // 当 5174 被占用时 Vite 会自动切到 5175/5176 等；显式注入 DEV_SERVER_PORT 后（worktree 独立端口）
  // 该容错带必须关闭，否则兄弟 worktree 派生端口落在 5174-5180 时会穿透 IPC 信任（C1）
  it('DEV_SERVER_PORT 未设置时允许 Vite 端口漂移（5175-5180 范围）', () => {
    delete process.env.DEV_SERVER_PORT
    expect(isTrustedSender(makeEvent('http://localhost:5174/'), mockApp)).toBe(true)
    expect(isTrustedSender(makeEvent('http://localhost:5175/'), mockApp)).toBe(true)
    expect(isTrustedSender(makeEvent('http://localhost:5176/'), mockApp)).toBe(true)
    expect(isTrustedSender(makeEvent('http://localhost:5180/'), mockApp)).toBe(true)
    // 超出范围仍拒绝
    expect(isTrustedSender(makeEvent('http://localhost:5181/'), mockApp)).toBe(false)
    expect(isTrustedSender(makeEvent('http://localhost:5173/'), mockApp)).toBe(false)
  })

  it('DEV_SERVER_PORT 自定义时严格匹配，5174-5180 容错带关闭', () => {
    process.env.DEV_SERVER_PORT = '3000'
    expect(isTrustedSender(makeEvent('http://localhost:3000/'), mockApp)).toBe(true)
    // 显式端口下容错带必须关闭（C1：防止兄弟 worktree 派生端口穿透 IPC 信任）
    expect(isTrustedSender(makeEvent('http://localhost:5174/'), mockApp)).toBe(false)
    expect(isTrustedSender(makeEvent('http://localhost:5175/'), mockApp)).toBe(false)
    expect(isTrustedSender(makeEvent('http://localhost:3001/'), mockApp)).toBe(false)
  })

  it('拒绝 localhost 前缀绕过和 app 协议伪造', () => {
    expect(isTrustedSender(makeEvent('http://localhost.evil.example:5174/'), mockApp)).toBe(false)
    expect(isTrustedSender(makeEvent('http://127.0.0.1.evil.example:5174/'), mockApp)).toBe(false)
    expect(isTrustedSender(makeEvent('app://localhost.evil.example/index.html'), mockAppPackaged)).toBe(false)
    expect(isTrustedSender(makeEvent('app://localhost:5174/index.html'), mockAppPackaged)).toBe(false)
  })

  it('打包环境不信任 localhost', () => {
    expect(isTrustedSender(makeEvent('http://localhost:5173/'), mockAppPackaged)).toBe(false)
  })

  it('打包状态优先于异常的 development 环境变量', () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      expect(isTrustedSender(makeEvent('http://localhost:5174/'), mockAppPackaged)).toBe(false)
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('app 未明确声明未打包时不能隐式信任开发服务器', () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      expect(isTrustedSender(makeEvent('http://localhost:5174/'), {})).toBe(false)
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('拒绝外部站点与无效 event', () => {
    expect(isTrustedSender(makeEvent('https://evil.com/'), mockApp)).toBe(false)
    expect(isTrustedSender(makeEvent('not a valid url'), mockApp)).toBe(false)
    expect(isTrustedSender(null, mockApp)).toBe(false)
    expect(isTrustedSender({}, mockApp)).toBe(false)
    expect(isTrustedSender({ senderFrame: { url: '' } }, mockApp)).toBe(false)
  })
})

// QM-2「IPC file URL canonical 合同」回归保护（P1-14 同批补录）：
// file:// 来源判定必须以 realpath 规范化的“目录边界”为准，不能退化成字符串前缀比较。
// 前缀比较会放过三类真实攻击面：兄弟目录前缀（canonical-app-evil）、junction 形态入口、
// 以及 dist 不存在 / getAppPath 抛错时的宽松兜底。
describe('ipc-security — file URL realpath 目录边界', () => {
  const packaged = (root) => ({ isPackaged: true, getAppPath: () => root })

  it('sender 走 junction 形态、appPath 走 canonical 形态时同样互信（同一 realpath 目标）', () => {
    const junctionEntryUrl = pathToFileURL(path.join(junctionAppRoot, 'dist', 'index.html')).href
    expect(isTrustedSender(makeEvent(junctionEntryUrl), packaged(canonicalAppRoot))).toBe(true)
  })

  it('兄弟目录前缀陷阱：canonical-app-evil/dist 不得被判为 canonical-app/dist 之内', () => {
    // 该用例专门针对 startsWith(trustedDist) 这类实现：`canonical-app-evil/dist/index.html`
    // 以 `canonical-app` 开头，但不在 `canonical-app/dist` 目录内。
    const evilRoot = path.join(tempRoot, 'canonical-app-evil', 'dist')
    fs.mkdirSync(evilRoot, { recursive: true })
    const evilFile = path.join(evilRoot, 'index.html')
    fs.writeFileSync(evilFile, '<!doctype html>')
    expect(isTrustedSender(makeEvent(pathToFileURL(evilFile).href), packaged(canonicalAppRoot))).toBe(false)
  })

  it('dist 目录自身（无文件名）仍在边界内，但兄弟目录自身仍被拒绝', () => {
    expect(isTrustedSender(
      makeEvent(pathToFileURL(path.join(canonicalAppRoot, 'dist')).href),
      packaged(canonicalAppRoot),
    )).toBe(true)
    expect(isTrustedSender(
      makeEvent(pathToFileURL(path.join(canonicalAppRoot, 'dist-evil')).href),
      packaged(canonicalAppRoot),
    )).toBe(false)
  })

  it('app 未注入时回退本包根目录，不得信任任意第三方 dist 路径', () => {
    const url = pathToFileURL(path.join(canonicalAppRoot, 'dist', 'index.html')).href
    expect(isTrustedSender(makeEvent(url), null)).toBe(false)
    expect(isTrustedSender(makeEvent(url), undefined)).toBe(false)
    expect(isTrustedSender(makeEvent(url), {})).toBe(false)
  })

  it('dist 不存在或 getAppPath 抛错时 fail-closed', () => {
    const url = pathToFileURL(path.join(canonicalAppRoot, 'dist', 'index.html')).href
    const boom = { isPackaged: true, getAppPath: () => { throw new Error('app path unavailable') } }
    expect(isTrustedSender(makeEvent(url), boom)).toBe(false)
    // outsideRoot 下没有 dist：realpath 抛 ENOENT → 必须拒绝，而不是“路径不存在所以放过”
    expect(isTrustedSender(makeEvent(url), packaged(outsideRoot))).toBe(false)
  })
})
