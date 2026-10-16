// @ts-check
/**
 * dev-launcher.test.js — dev 启动参数/默认 userData 解析（node --test）
 * 回归保护：dev.js 直接启动必须落到固定 D 盘 profile，不得再掉进随机临时目录。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildElectronArgs, resolveUserDataDir, resolveAllowAllOrigins, resolveNoSandbox, resolveSoftwareGpu, DEFAULT_USER_DATA_DIR } = require('./dev-launcher')
const fs = require('node:fs')
const path = require('node:path')

test('resolveUserDataDir 未设置 env 时使用固定 D 盘默认 profile', () => {
  assert.equal(resolveUserDataDir({}), DEFAULT_USER_DATA_DIR)
  assert.ok(DEFAULT_USER_DATA_DIR.startsWith('D:\\'))
  assert.ok(DEFAULT_USER_DATA_DIR.includes('Multi-Publish-debug-profile'))
})

test('resolveUserDataDir 尊重显式 ELECTRON_USER_DATA_DIR（并发隔离/start-desktop.ps1）', () => {
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: 'X:\\custom\\profile' }), 'X:\\custom\\profile')
})

test('buildElectronArgs 透传 userData/cache 并默认 CDP 端口 9222', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:\\tmp\\Multi-Publish-debug-profile',
    electronCacheDir: 'D:\\tmp\\Multi-Publish-debug-profile\\cache',
    desktopDir: 'D:\\app',
    platform: 'win32',
  })
  assert.ok(args.includes('--user-data-dir=D:\\tmp\\Multi-Publish-debug-profile'))
  assert.ok(args.includes('--disk-cache-dir=D:\\tmp\\Multi-Publish-debug-profile\\cache'))
  assert.ok(args.includes('--remote-debugging-port=9222'))
  assert.equal(args[args.length - 1], 'D:\\app')
})

// 2026-10-16 契约变更：旧锁写的是「默认带 --no-sandbox（保持既有 dev 行为）」，而默认
// softwareGpu 也为真 ⇒ 默认配置恰好就是 2026-10-06 记下的崩溃组合，于是「登录检测
// 拉起的隐藏 BrowserWindow 触发原生渲染崩溃」按平台逐个复发（toutiao → wechat_mp →
// 知乎 → kuaishou），白名单（RENDER_CRASH_PRONE_OPEN_PLATFORMS）只能打地鼠。
// 本锁改成对**整个参数空间**断言：崩溃组合不可达。
test('buildElectronArgs 不得同时下发 --no-sandbox 与 swiftshader（崩溃组合不可达）', () => {
  const base = {
    electronUserDataDir: 'D:/tmp/profile',
    electronCacheDir: 'D:/tmp/profile/cache',
    desktopDir: 'D:/app',
    platform: 'win32',
  }
  const hasSwiftshader = args => args.some(a => a.includes('swiftshader'))

  // 默认：软件光栅化在（无 GPU 的机器要画得出窗口），--no-sandbox 不在
  const def = buildElectronArgs(base)
  assert.equal(hasSwiftshader(def), true, '默认仍走软件光栅化')
  assert.equal(def.includes('--no-sandbox'), false, '软件光栅化开启时不得同时下发 --no-sandbox')

  // 全组合性质锁：任一 (noSandbox, softwareGpu) 取值都不得产回崩溃组合
  for (const noSandbox of [true, false]) {
    for (const softwareGpu of [true, false]) {
      const args = buildElectronArgs({ ...base, noSandbox, softwareGpu })
      assert.equal(
        args.includes('--no-sandbox') && hasSwiftshader(args),
        false,
        `崩溃组合不可达（noSandbox=${noSandbox} softwareGpu=${softwareGpu}）`,
      )
    }
  }

  // 显式换取路径仍在：关掉软件光栅化后可用 --no-sandbox（该组合不崩）
  const swapped = buildElectronArgs({ ...base, softwareGpu: false, noSandbox: true })
  assert.equal(swapped.includes('--no-sandbox'), true)
  assert.equal(hasSwiftshader(swapped), false)
})

test('buildElectronArgs 显式关闭 sandbox 时不得再带 --no-sandbox（2026-10-06 崩溃规避）', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:/tmp/profile',
    electronCacheDir: 'D:/tmp/profile/cache',
    desktopDir: 'D:/app',
    platform: 'win32',
    noSandbox: false,
  })
  assert.equal(args.includes('--no-sandbox'), false)
  // 关闭 sandbox 不得顺带改动其它开关
  assert.ok(args.includes('--disable-gpu'))
  assert.equal(args[args.length - 1], 'D:/app')
})

test('buildElectronArgs 显式关闭 GPU 合成时不得再带 swiftshader 软件光栅化', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:/tmp/profile',
    electronCacheDir: 'D:/tmp/profile/cache',
    desktopDir: 'D:/app',
    platform: 'win32',
    softwareGpu: false,
  })
  assert.equal(args.filter(a => a.includes('swiftshader')).length, 0)
})

test('resolveNoSandbox / resolveSoftwareGpu 严格判据：非 1 一律走默认开启', () => {
  assert.equal(resolveNoSandbox({ MP_E2E_NO_SANDBOX: '0' }), false)
  assert.equal(resolveNoSandbox({ MP_E2E_NO_SANDBOX: '1' }), true)
  assert.equal(resolveNoSandbox({ MP_E2E_NO_SANDBOX: ' true ' }), true, 'trim 后必须是 1')
  assert.equal(resolveNoSandbox({ MP_E2E_NO_SANDBOX: 'true' }), true)
  assert.equal(resolveNoSandbox({ MP_E2E_NO_SANDBOX: '' }), true, '未设置走默认开启')
  assert.equal(resolveNoSandbox({}), true)
  assert.equal(resolveSoftwareGpu({ MP_E2E_SOFTWARE_GPU: '0' }), false)
  assert.equal(resolveSoftwareGpu({}), true)
})

test('buildElectronArgs 支持自定义 CDP 端口（worktree 独立端口）', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:/tmp/profile',
    electronCacheDir: 'D:/tmp/profile/cache',
    desktopDir: 'D:/app',
    cdpPort: 9333,
    platform: 'win32',
  })
  assert.ok(args.includes('--remote-debugging-port=9333'))
})

test('resolveUserDataDir 吞并尾随空白（cmd set "VAR=val &" 尾随空格陷阱回归保护）', () => {
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: ' X:\\custom\\profile ' }), 'X:\\custom\\profile')
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: 'X:\\custom\\profile  ' }), 'X:\\custom\\profile')
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: '   ' }), DEFAULT_USER_DATA_DIR)
})

test('buildElectronArgs 默认不得放行任意 Origin（安全默认，不得由调用方遗漏决定）', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:/tmp/profile',
    electronCacheDir: 'D:/tmp/profile/cache',
    desktopDir: 'D:/app',
    platform: 'win32',
  })
  assert.equal(args.filter(a => a.startsWith('--remote-allow-origins')).length, 0)
  assert.equal(args[args.length - 1], 'D:/app')
})

test('buildElectronArgs 显式开启时只追加一条 --remote-allow-origins=* 且 desktopDir 保持末位', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:/tmp/profile',
    electronCacheDir: 'D:/tmp/profile/cache',
    desktopDir: 'D:/app',
    cdpPort: 9333,
    platform: 'win32',
    allowAllOrigins: true,
  })
  const hits = args.filter(a => a.startsWith('--remote-allow-origins'))
  assert.deepEqual(hits, ['--remote-allow-origins=*'])
  assert.equal(args[args.length - 1], 'D:/app')
  // 开关必须排在应用路径之前，否则等于把开关当参数交给 app
  assert.ok(args.indexOf(hits[0]) < args.length - 1)
  assert.ok(args.includes('--remote-debugging-port=9333'))
})

test('resolveAllowAllOrigins 只对 trim 后恰好为 "1" 放行（尾随空格兼容 + 拒绝宽松写法）', () => {
  assert.equal(resolveAllowAllOrigins({}), false)
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: '1' }), true)
  // cmd `set "VAR=1 &"` 的尾随空格陷阱：不 trim 就会静默失效
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: '1 ' }), true)
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: ' 1' }), true)
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: '0' }), false)
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: 'true' }), false)
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: '' }), false)
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: '   ' }), false)
  assert.equal(resolveAllowAllOrigins({ MP_CDP_ALLOW_ALL_ORIGINS: 1 }), false)
})

test('接线锁：dev.js 必须真的读取开关并传给 buildElectronArgs（写了 helper 没人调即红）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'dev.js'), 'utf8')
  assert.ok(/require\('\.\/dev-launcher'\)/.test(src), 'dev.js 不再从 dev-launcher 取参数装配')
  assert.match(src, /const \{[^}]*resolveAllowAllOrigins[^}]*\} = require\('\.\/dev-launcher'\)/)
  assert.match(src, /const allowAllOrigins = resolveAllowAllOrigins\(process\.env\)/)
  assert.match(src, /buildElectronArgs\(\{[^}]*allowAllOrigins[^}]*\}\)/)
})

test('留痕锁：开关生效时 dev.js 必须打印现场（禁止以静默 no-op 表达「已开启」）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'dev.js'), 'utf8')
  assert.match(src, /if \(allowAllOrigins\) \{/)
  assert.match(src, /--remote-allow-origins=\* ENABLED/)
})
