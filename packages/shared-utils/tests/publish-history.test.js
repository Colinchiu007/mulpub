/**
 * Test: src/publish-history.js — P1-10（体检报告问题10）依赖治理
 * 覆盖: 顶层不得 require('electron')、显式注入优先（filePath > userDataDir > app）、
 *       纯 Node 未注入时报错可操作（而不是 TypeError / MODULE_NOT_FOUND）、
 *       入口 index.js 导出、package.json optional peerDependency。
 *
 * 注意：root node_modules 里确实装了 electron，纯 Node 下 require('electron') 返回
 * 一个"可执行文件路径字符串"而 **不抛错**，所以 .app 为 undefined。
 * 旧实现 `const { app } = require('electron')` 之后 app.getPath 直接 TypeError，
 * 这条链路必须由用例 4 钉住（否则"懒加载兜底"在最常见的环境下形同虚设）。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const history = require('../src/publish-history')
const api = require('../src/index.js')

function tmpUserDataDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('P1-10 publish-history 依赖治理', () => {
  beforeEach(() => {
    // 模块级单例，每个用例前重新注入，避免相互污染
    history.configurePublishHistory({})
  })

  test('源码顶层不得 require("electron")（纯 Node / CI / vitest 环境一引入就崩）', () => {
    const srcPath = (typeof require !== 'undefined' && require.resolve)
      ? require.resolve('../src/publish-history')
      : path.join(__dirname, '..', 'src', 'publish-history.js')
    const src = fs.readFileSync(srcPath, 'utf-8')
    // 顶层 import：行首（无缩进）出现 require('electron')
    expect(src).not.toMatch(/^\s*(const|let|var)[^\n]*require\(['"]electron['"]\)/m)
    expect(src).not.toMatch(/^require\(['"]electron['"]\)/m)
    // electron 只允许出现在函数体内（有缩进、且非注释行）
    const code = src.split('\n').filter(l => !l.trim().startsWith('//'))
    const electronLines = code.filter(l => l.includes("require('electron')"))
    expect(electronLines.length).toBeGreaterThan(0)
    for (const l of electronLines) expect(/^\s+/.test(l)).toBe(true)
  })

  test('纯 Node 环境 require 模块本身不抛错', () => {
    expect(() => require('../src/publish-history')).not.toThrow()
  })

  test('入口 index.js 必须导出 publishHistory（避免调用方各自 require 内部路径）', () => {
    expect(api.publishHistory).toBeTruthy()
    expect(typeof api.publishHistory.addRecord).toBe('function')
    expect(typeof api.publishHistory.listRecords).toBe('function')
    expect(typeof api.publishHistory.configurePublishHistory).toBe('function')
  })

  test('未注入且无 Electron 运行时报错可操作（指明注入方式，而非 TypeError/MODULE_NOT_FOUND）', () => {
    let err
    try { history.getHistoryPath() } catch (e) { err = e }
    expect(err).toBeTruthy()
    expect(err.message).toContain('configurePublishHistory')
    expect(err.message).not.toContain("Cannot find module 'electron'")
    expect(err.message).not.toMatch(/getPath/)
  })

  test('注入 userDataDir：不依赖 Electron 完成 写入→查询→单条→统计 全链路', () => {
    const dir = tmpUserDataDir('su-hist-usr-')
    history.configurePublishHistory({ userDataDir: dir })
    expect(history.getHistoryPath()).toBe(path.join(dir, 'publish-history.jsonl'))

    const ok = history.addRecord({ platform: 'douyin', success: true })
    const bad = history.addRecord({ platform: 'xiaohongshu', success: false })

    const all = history.listRecords({})
    expect(all.total).toBe(2)
    expect(all.records[0].id).toBe(bad.id) // 新的在前

    const onlyDouyin = history.listRecords({ platform: 'douyin' })
    expect(onlyDouyin.total).toBe(1)
    expect(onlyDouyin.records[0].platform).toBe('douyin')

    expect(history.getRecord(ok.id).platform).toBe('douyin')
    expect(history.getRecord('not-exists')).toBe(null)

    const stats = history.getStats()
    expect(stats.total).toBe(2)
    expect(stats.success).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.perPlatform.douyin.success).toBe(1)
    expect(stats.perPlatform.xiaohongshu.failed).toBe(1)
  })

  test('注入 filePath：完全路径优先于 userDataDir（支持自定义存储位置）', () => {
    const dir = tmpUserDataDir('su-hist-file-')
    const file = path.join(dir, 'custom-history.jsonl')
    history.configurePublishHistory({ filePath: file, userDataDir: tmpUserDataDir('su-hist-ignored-') })
    expect(history.getHistoryPath()).toBe(file)
    history.addRecord({ platform: 'kuaishou', success: true })
    expect(fs.existsSync(file)).toBe(true)
  })

  test('注入 app（桌面端传 electron.app）：走 app.getPath("userData")', () => {
    const dir = tmpUserDataDir('su-hist-app-')
    history.configurePublishHistory({
      app: { getPath: (name) => { expect(name).toBe('userData'); return dir } },
    })
    expect(history.getHistoryPath()).toBe(path.join(dir, 'publish-history.jsonl'))
  })

  test('package.json 把 electron 声明为 optional peerDependency（不装也能跑）', () => {
    const pkg = require('../package.json')
    expect(pkg.peerDependencies.electron).toBeTruthy()
    expect(pkg.peerDependenciesMeta.electron.optional).toBe(true)
    expect(pkg.dependencies.electron).toBeUndefined()
  })
})
