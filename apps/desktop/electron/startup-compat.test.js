import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  configureGraphics,
  configureUserAgentFallback,
  configureUserDataPath,
  findSharedUserDataDir,
  getExplicitUserDataDir,
} from './startup-compat.js'

describe('startup compatibility', () => {
  it('prefers an explicit userData directory and configures related paths', () => {
    const app = {
      getPath: vi.fn(() => 'ignored'),
      setPath: vi.fn(),
    }

    const result = configureUserDataPath({
      app,
      env: { ELECTRON_USER_DATA_DIR: 'C:/tmp/multi-publish-dev' },
      argv: [],
    })

    expect(result).toMatchObject({
      path: 'C:/tmp/multi-publish-dev',
      explicit: true,
      fallback: false,
    })
    expect(app.setPath).toHaveBeenCalledWith('userData', 'C:/tmp/multi-publish-dev')
    expect(app.setPath).toHaveBeenCalledWith('sessionData', path.join('C:/tmp/multi-publish-dev', 'session'))
    expect(app.setPath).toHaveBeenCalledWith('cache', path.join('C:/tmp/multi-publish-dev', 'cache'))
  })

  it('falls back to LOCALAPPDATA when the default userData path is not writable', () => {
    const app = {
      getPath: vi.fn(() => 'C:/restricted/user-data'),
      setPath: vi.fn(),
    }
    const fsImpl = {
      constants: { W_OK: 2 },
      mkdirSync: vi.fn((directory) => {
        if (directory === 'C:/restricted/user-data') throw new Error('EPERM')
      }),
      accessSync: vi.fn(),
    }

    const result = configureUserDataPath({
      app,
      env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' },
      argv: [],
      fsImpl,
      platform: 'win32',
    })

    expect(result).toMatchObject({
      path: path.join('C:/Users/test/AppData/Local', 'Multi-Publish', 'user-data'),
      fallback: true,
      previousPath: 'C:/restricted/user-data',
    })
    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      path.join('C:/Users/test/AppData/Local', 'Multi-Publish', 'user-data'),
    )
  })

  it('Windows 默认硬件加速（2026-09-12 GPU 帧循环卡死复盘：SwiftShader 软件渲染在部分 Windows 环境合成器停摆，窗口空白但 DOM 存活）；ELECTRON_DISABLE_GPU=1 保留为手动逃生门', () => {
    const app = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    }

    expect(configureGraphics({ app, env: {}, platform: 'win32' })).toMatchObject({
      disabled: false,
      reason: null,
    })
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled()

    app.commandLine.appendSwitch.mockClear()
    app.disableHardwareAcceleration.mockClear()
    expect(configureGraphics({ app, env: { ELECTRON_DISABLE_GPU: '1' }, platform: 'win32' })).toMatchObject({
      disabled: true,
      reason: 'explicit',
    })
    expect(app.disableHardwareAcceleration).toHaveBeenCalled()
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu')
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu-compositing')
  })

  it('enables the explicit safe mode without changing the normal GPU policy', () => {
    const app = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    }

    expect(configureGraphics({ app, env: { ELECTRON_GPU_SAFE_MODE: '1' }, platform: 'linux' }))
      .toMatchObject({ disabled: true, reason: 'safe-mode' })
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu-sandbox')
  })

  it('recognizes the Electron command-line userData override', () => {
    expect(getExplicitUserDataDir({}, ['electron', '.', '--user-data-dir=C:/tmp/profile']))
      .toBe('C:/tmp/profile')
  })
})

describe('shared-data anchor detection', () => {
  it('uses shared-user-data when anchor file exists', () => {
    const repoRoot = '/tmp/test-repo'
    const sharedDir = `${repoRoot}/shared-user-data`
    const fsImpl = {
      constants: { W_OK: 2 },
      existsSync: vi.fn((p) => p === path.join(sharedDir, '.shared-data-anchor')),
      mkdirSync: vi.fn(),
      accessSync: vi.fn(),
    }
    const app = {
      getPath: vi.fn(() => '/tmp/default-user-data'),
      setPath: vi.fn(),
    }

    const result = configureUserDataPath({
      app,
      env: {},
      argv: [],
      fsImpl,
      platform: 'linux',
      moduleDir: repoRoot,
    })

    expect(result).toMatchObject({
      path: path.join(repoRoot, 'shared-user-data'),
      shared: true,
      fallback: false,
      explicit: false,
    })
    expect(app.setPath).toHaveBeenCalledWith('userData', path.join(repoRoot, 'shared-user-data'))
  })

  it('falls back to default when no anchor exists', () => {
    const fsImpl = {
      constants: { W_OK: 2 },
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      accessSync: vi.fn(),
    }
    const app = {
      getPath: vi.fn(() => '/tmp/default-user-data'),
      setPath: vi.fn(),
    }

    const result = configureUserDataPath({
      app,
      env: {},
      argv: [],
      fsImpl,
      platform: 'linux',
      moduleDir: '/tmp/no-anchor',
    })

    expect(result.shared).toBeUndefined()
    expect(result.path).toBe('/tmp/default-user-data')
  })

  it('explicit env var overrides shared anchor', () => {
    const app = {
      getPath: vi.fn(() => 'ignored'),
      setPath: vi.fn(),
    }

    const result = configureUserDataPath({
      app,
      env: { ELECTRON_USER_DATA_DIR: 'C:/explicit-dir' },
      argv: [],
      moduleDir: '/tmp/has-anchor',
    })

    expect(result).toMatchObject({
      path: 'C:/explicit-dir',
      explicit: true,
    })
    expect(result.shared).toBeUndefined()
  })

  it('findSharedUserDataDir walks up from nested directory', () => {
    const fsImpl = {
      existsSync: vi.fn((p) => p === path.join('/repo', 'shared-user-data', '.shared-data-anchor')),
    }
    const result = findSharedUserDataDir(
      fsImpl,
      '/repo/apps/desktop/electron',
    )
    expect(result).toBe(path.join('/repo', 'shared-user-data'))
  })

  it('findSharedUserDataDir returns null when anchor not found', () => {
    const fsImpl = { existsSync: vi.fn(() => false) }
    const result = findSharedUserDataDir(fsImpl, '/deep/nested/path')
    expect(result).toBeNull()
  })
})

// 真实 Electron 的 App 接口只提供 `userAgentFallback`；`userAgent` 属于 WebContents，
// App 上并不存在。夹具必须按这个真实形状构造，否则「净化静默不生效」这类缺陷测不出来。
const ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Multi-Publish/1.2.3 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36'
const SANITIZED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.114 Safari/537.36'

/** 构造与真实 Electron App 同形状的夹具：只有 userAgentFallback，没有 userAgent。 */
function createElectronShapedApp (userAgent = ELECTRON_UA) {
  return { userAgentFallback: userAgent }
}

describe('user-agent fallback sanitization', () => {
  it('真实 Electron App 形状（只有 userAgentFallback）下必须完成净化', () => {
    const app = createElectronShapedApp()

    const result = configureUserAgentFallback({ app })

    expect(result).toEqual({ configured: true, userAgent: SANITIZED_UA })
    expect(app.userAgentFallback).toBe(SANITIZED_UA)
    expect(app.userAgentFallback).not.toMatch(/Electron\//)
    expect(app.userAgentFallback).not.toContain('Multi-Publish/')
  })

  it('只从 userAgentFallback 取 UA 源，绝不读 App 上不存在的 userAgent', () => {
    const app = createElectronShapedApp()
    let userAgentReads = 0
    Object.defineProperty(app, 'userAgent', {
      get () {
        userAgentReads += 1
        return ELECTRON_UA
      },
      configurable: true,
    })

    const result = configureUserAgentFallback({ app })

    expect(userAgentReads).toBe(0)
    expect(result).toEqual({ configured: true, userAgent: SANITIZED_UA })
  })

  it('重复调用保持幂等，不会二次改写', () => {
    const app = createElectronShapedApp()

    expect(configureUserAgentFallback({ app })).toEqual({ configured: true, userAgent: SANITIZED_UA })
    expect(configureUserAgentFallback({ app })).toEqual({ configured: false })
    expect(app.userAgentFallback).toBe(SANITIZED_UA)
  })

  it('keeps the UA untouched when it carries no Electron markers', () => {
    const plainUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
    const app = createElectronShapedApp(plainUa)

    const result = configureUserAgentFallback({ app })

    expect(result).toEqual({ configured: false })
    expect(app.userAgentFallback).toBe(plainUa)
  })

  it('returns not-configured for a non-Electron-like app object', () => {
    expect(configureUserAgentFallback({ app: null })).toEqual({ configured: false })
    expect(configureUserAgentFallback({})).toEqual({ configured: false })
    expect(configureUserAgentFallback({ app: {} })).toEqual({ configured: false })
  })

  it('never produces consecutive spaces when stripping tokens', () => {
    const app = createElectronShapedApp(
      'Mozilla/5.0 Chrome/150.0.0.0 Electron/43.1.1 Multi-Publish/1.2.3 Safari/537.36',
    )

    const result = configureUserAgentFallback({ app })

    expect(result.userAgent).toBe('Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36')
    expect(result.userAgent).not.toMatch(/\s\s/)
  })

  it('keeps Edge-family browser tokens when sanitizing', () => {
    const app = createElectronShapedApp(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
    )

    const result = configureUserAgentFallback({ app })

    // 纯浏览器 UA（含 Edg token）不含 Electron 标记 → 不修改
    expect(result.configured).toBe(false)
  })

  // dev 模式（electron . 直接加载 apps/desktop）下 app 名取自 package.json 的
  // name = "@multi-publish/desktop"，Electron 会把它塞进 UA。真实运行态 CDP
  // /json/version 实测残留 `@multi-publish/desktop/0.1.0`：非字母开头的作用域名
  // 标记若不一起剔除，知乎风控仍可据此识别非标准浏览器。
  it('剔除以 @ 开头的作用域包名标记（dev 模式真实 UA 形状）', () => {
    const app = createElectronShapedApp(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) @multi-publish/desktop/0.1.0 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36',
    )

    const result = configureUserAgentFallback({ app })

    expect(result).toEqual({
      configured: true,
      userAgent: SANITIZED_UA,
    })
    expect(app.userAgentFallback).toBe(SANITIZED_UA)
    expect(app.userAgentFallback).not.toContain('@multi-publish')
  })
})

// 真实依赖锁：净化函数的正确性前提「Electron App 上没有 userAgent」直接来自
// 已安装 Electron 的类型声明，而不是我对 API 的记忆。前提一旦被上游改变，
// 这里必须先变红，避免再次出现「按不存在的 API 写字段、单测靠 mock 全绿」。
const installedElectronDts = (() => {
  try {
    const req = createRequire(import.meta.url)
    const electronPkgDir = path.dirname(req.resolve('electron'))
    return readFileSync(path.join(electronPkgDir, 'electron.d.ts'), 'utf8')
  } catch (_) {
    return null
  }
})()

describe.skipIf(installedElectronDts === null)(
  'user-agent source contract against installed Electron typings',
  () => {
    it('App 接口声明 userAgentFallback 且不声明 userAgent', () => {
      const appInterfaceStart = installedElectronDts.indexOf('  interface App extends')
      expect(appInterfaceStart).toBeGreaterThan(-1)
      const appInterfaceEnd = installedElectronDts.indexOf('\n  }', appInterfaceStart)
      expect(appInterfaceEnd).toBeGreaterThan(appInterfaceStart)
      const appInterface = installedElectronDts.slice(appInterfaceStart, appInterfaceEnd)

      expect(appInterface).toMatch(/userAgentFallback: string;/)
      expect(appInterface.includes('userAgent: string;')).toBe(false)
    })
  },
)
