import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const {
  CAPTURE_SCENARIOS,
  STABLE_CONTEXT_OPTIONS,
  VIEWPORTS,
  captureScenario,
  screenshotName,
} = require('./scripts/capture-mp-current')

describe('参考产品当前界面截图合同', () => {
  it('三个对比目标映射到账号管理和发布记录页', () => {
    expect(CAPTURE_SCENARIOS).toEqual([
      expect.objectContaining({ name: 'accounts', route: '/accounts' }),
      expect.objectContaining({ name: 'publish', route: '/publish/history' }),
      expect.objectContaining({
        name: 'batch-publish',
        route: '/publish/history',
        actionSelector: '[data-testid="start-selection"]',
      }),
    ])
  })

  it('截图就绪选择器锁定当前参考产品工作区壳层', () => {
    const accounts = CAPTURE_SCENARIOS.find(item => item.name === 'accounts')
    const publish = CAPTURE_SCENARIOS.find(item => item.name === 'publish')
    expect(accounts.readySelector).toContain('.mp-workspace')
    expect(publish.readySelector).toContain('.mp-workspace')
    expect(publish.readySelector).toContain('发布记录')
  })
  it('桌面截图沿用 manifest 文件名，移动端使用独立后缀', () => {
    expect(screenshotName('accounts', VIEWPORTS[0])).toBe('accounts.png')
    expect(screenshotName('accounts', VIEWPORTS[1])).toBe('accounts-mobile.png')
    expect(VIEWPORTS).toContainEqual(expect.objectContaining({ name: 'audit', width: 2560, height: 1328 }))
    const auditViewport = VIEWPORTS.find(item => item.name === 'audit')
    expect(screenshotName('accounts', auditViewport)).toBe('accounts-audit.png')
    expect(STABLE_CONTEXT_OPTIONS).toMatchObject({
      colorScheme: 'light',
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
      timezoneId: 'Asia/Shanghai',
    })
  })

  it('批量发布场景在截图前进入批量选择模式', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      addStyleTag: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
      screenshot: vi.fn().mockResolvedValue(undefined),
    }
    const scenario = CAPTURE_SCENARIOS.find(item => item.name === 'batch-publish')
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)

    try {
      await captureScenario(page, scenario, VIEWPORTS[0], {
        baseUrl: 'http://127.0.0.1:5174',
        outputDir: path.resolve(process.cwd(), 'tests/visual-testing/screenshots/mp-parity-test'),
      })
    } finally {
      mkdirSpy.mockRestore()
    }

    expect(page.goto).toHaveBeenCalledWith(
      'http://127.0.0.1:5174/#/publish/history',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    )
    expect(page.click).toHaveBeenCalledWith('[data-testid="start-selection"]')
    expect(page.waitForSelector).toHaveBeenCalledWith('.record-selector input', expect.any(Object))
    expect(page.addStyleTag).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('animation-duration'),
    }))
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringMatching(/batch-publish\.png$/),
      fullPage: false,
    }))
  })

  it('Vite 指向旧 worktree 时给出可执行的 TEST_URL 提示', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockRejectedValue(new Error('等待页面超时')),
    }
    const scenario = CAPTURE_SCENARIOS.find(item => item.name === 'publish')

    await expect(captureScenario(page, scenario, VIEWPORTS[0], {
      baseUrl: 'http://127.0.0.1:5174',
    })).rejects.toThrow(/TEST_URL.*正确端口/)
  })
})
