// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let listeners = new Map()
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const updater = {
    logger: console,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: vi.fn((event, listener) => {
      const eventListeners = listeners.get(event) || []
      eventListeners.push(listener)
      listeners.set(event, eventListeners)
      return updater
    }),
    emit(event, ...args) {
      for (const listener of listeners.get(event) || []) listener(...args)
    },
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  }

  function reset() {
    listeners = new Map()
    updater.logger = console
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = false
    updater.on.mockClear()
    updater.checkForUpdates.mockReset()
    updater.downloadUpdate.mockReset()
    updater.quitAndInstall.mockReset()
    Object.values(logger).forEach(mock => mock.mockReset())

    updater.on('error', error => {
      updater.logger?.error?.(`Error: ${error.stack || error.message}`)
    })
  }

  return { logger, reset, updater }
})

describe('AutoUpdater 生产错误降级', () => {
  let autoUpdaterService
  let mainWindow
  let statuses
  let originalNodeEnv

  beforeEach(async () => {
    vi.resetModules()
    mocks.reset()
    __resetElectronMock()
    __enableElectronMock()
    __electronMock.app.isPackaged = true
    __registerMock('electron-updater', { autoUpdater: mocks.updater })
    __registerMock('./logger', mocks.logger)
    statuses = []
    originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    const imported = await import('./auto-updater')
    autoUpdaterService = imported.default || imported
    mainWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    }
    autoUpdaterService.init(mainWindow, status => statuses.push(status))
  })

  afterEach(() => {
    __electronMock.app.isPackaged = false
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    vi.restoreAllMocks()
  })

  it('打包应用不能被 development 环境变量重新启用 console logger', () => {
    expect(mocks.updater.logger).not.toBe(console)
    expect(mocks.updater.logger).toEqual(expect.objectContaining({ error: expect.any(Function) }))
  })

  it('latest.yml 404 事件静默降级且不写入 stderr', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('Cannot find latest.yml in the latest release artifacts: HttpError: 404')

    mocks.updater.emit('error', error)

    expect(statuses.at(-1)).toEqual({ type: 'not-available', data: '当前已是最新版本' })
    expect(stderr).not.toHaveBeenCalled()
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it('打包应用缺少本地 app-update.yml 时静默降级', () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, open 'C:/app/resources/app-update.yml'"),
      { code: 'ENOENT', path: 'C:/app/resources/app-update.yml' },
    )

    mocks.updater.emit('error', error)

    expect(statuses.at(-1)).toEqual({ type: 'not-available', data: '当前已是最新版本' })
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it('app-update.yml 的非缺失错误仍按真实错误上报', () => {
    const error = Object.assign(
      new Error("EACCES: permission denied, open 'C:/app/resources/app-update.yml'"),
      { code: 'EACCES', path: 'C:/app/resources/app-update.yml' },
    )

    mocks.updater.emit('error', error)

    expect(statuses.at(-1)).toEqual({ type: 'error', data: error.message })
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining(error.message))
  })

  it('检查更新的 latest.yml 404 Promise 也静默降级', async () => {
    mocks.updater.checkForUpdates.mockRejectedValue(
      new Error('Cannot find latest.yml in the latest release artifacts: HttpError: 404'),
    )

    autoUpdaterService.check()

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toEqual({ type: 'not-available', data: '当前已是最新版本' })
    })
  })

  it('检查更新遇到结构化 latest.yml 404 时静默降级', async () => {
    const error = Object.assign(
      new Error('Cannot find latest.yml in the latest release artifacts'),
      { statusCode: 404 },
    )
    mocks.updater.checkForUpdates.mockRejectedValue(error)

    autoUpdaterService.check()

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toEqual({ type: 'not-available', data: '当前已是最新版本' })
    })
  })

  it('检查更新遇到 HttpError 404 和 manifest URL 时静默降级', async () => {
    const error = Object.assign(
      new Error('HttpError: 404'),
      { statusCode: 404, url: 'https://github.com/example/app/releases/latest.yml' },
    )
    mocks.updater.checkForUpdates.mockRejectedValue(error)

    autoUpdaterService.check()

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toEqual({ type: 'not-available', data: '当前已是最新版本' })
    })
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it('下载更新的网络阻断 Promise 静默降级', async () => {
    mocks.updater.downloadUpdate.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'))

    autoUpdaterService.download()

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toEqual({ type: 'not-available', data: '当前已是最新版本' })
    })
  })

  it('非预期更新错误仍上报 UI 和应用日志', () => {
    const error = new Error('签名校验失败')

    mocks.updater.emit('error', error)

    expect(statuses.at(-1)).toEqual({ type: 'error', data: '签名校验失败' })
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining('签名校验失败'))
  })

  it('包含 latest.yml 和 404 字样的签名错误仍按真实错误上报', () => {
    const error = new Error('signature verification failed for latest.yml after HttpError: 404')

    mocks.updater.emit('error', error)

    expect(statuses.at(-1)).toEqual({ type: 'error', data: error.message })
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining(error.message))
  })

  it('结构化 404 的签名错误仍按真实错误上报', () => {
    const error = Object.assign(
      new Error('signature verification failed'),
      { statusCode: 404, url: 'https://github.com/example/app/releases/latest.yml' },
    )

    mocks.updater.emit('error', error)

    expect(statuses.at(-1)).toEqual({ type: 'error', data: error.message })
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining(error.message))
  })

  it('同一个检查错误经事件和 Promise 双通道到达时只通知一次', async () => {
    const error = new Error('Cannot find latest.yml in the latest release artifacts: HttpError: 404')
    mocks.updater.checkForUpdates.mockImplementation(() => {
      mocks.updater.emit('error', error)
      return Promise.reject(error)
    })

    autoUpdaterService.check()

    await vi.waitFor(() => {
      expect(statuses).toEqual([{ type: 'not-available', data: '当前已是最新版本' }])
    })
  })

  it('主窗口重建时复用全局监听器并将状态切换到新窗口', () => {
    const nextStatuses = []
    const nextWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    }

    autoUpdaterService.init(nextWindow, status => nextStatuses.push(status))
    mocks.updater.emit('checking-for-update')

    expect(mocks.updater.on).toHaveBeenCalledTimes(7)
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
    expect(statuses).toEqual([])
    expect(nextWindow.webContents.send).toHaveBeenCalledTimes(1)
    expect(nextWindow.webContents.send).toHaveBeenCalledWith(
      'update:status',
      { type: 'checking', data: '正在检查更新...' },
    )
    expect(nextStatuses).toEqual([{ type: 'checking', data: '正在检查更新...' }])
  })
})

describe('AutoUpdater 版本发布策略（运营后台下发）', () => {
  let autoUpdaterService
  let mainWindow
  let statuses

  beforeEach(async () => {
    vi.resetModules()
    mocks.reset()
    __resetElectronMock()
    __enableElectronMock()
    __electronMock.app.isPackaged = true
    __electronMock.app.getVersion = () => '0.1.0'
    __registerMock('./logger', mocks.logger)
    statuses = []
    const imported = await import('./auto-updater')
    autoUpdaterService = imported.default || imported
    mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    autoUpdaterService.init(mainWindow, status => statuses.push(status))
    mocks.updater.checkForUpdates.mockResolvedValue({})
  })

  afterEach(() => {
    __electronMock.app.getVersion = undefined
    vi.restoreAllMocks()
  })

  it('策略未设置时 check 正常调用 checkForUpdates', () => {
    autoUpdaterService.check()
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('force_version 高于当前版本 → 跳过灰度直接检查并启用自动下载', () => {
    autoUpdaterService.applyPolicy({ min_version: '', force_version: '0.2.0', gray_ratio: 0, enabled: true })
    autoUpdaterService.check()
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1) // 灰度 0% 仍检查（强制）
    expect(mocks.updater.autoDownload).toBe(true) // 强制路径自动下载
  })

  it('gray_ratio=0 时稳定跳过检查（skipped-by-policy）', () => {
    autoUpdaterService.applyPolicy({ min_version: '', force_version: '', gray_ratio: 0, enabled: true })
    autoUpdaterService.check()
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(statuses.at(-1).type).toBe('skipped-by-policy')
  })

  it('gray_ratio=100 全量检查并推送 policy-min-version 提示', () => {
    autoUpdaterService.applyPolicy({ min_version: '0.2.0', force_version: '', gray_ratio: 100, enabled: true })
    autoUpdaterService.check()
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(statuses).toContainEqual({ type: 'policy-min-version', data: { version: '0.2.0' } })
  })

  it('enabled=false 的策略视为未设置', () => {
    autoUpdaterService.applyPolicy({ min_version: '9.9.9', force_version: '', gray_ratio: 0, enabled: false })
    autoUpdaterService.check()
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
