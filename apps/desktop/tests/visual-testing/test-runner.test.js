import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'

const { VisualTestRunner } = require('./test-runner')

// 含内容区的合法 1920x1080 截图：updateBaseline 现在有基线内容下限守卫
// （拦截「明显未渲染」的空白截图入库，事故原型 PR #2075→#2114），
// 假 PNG 签名会被拒解码，mock 必须产出真实可渲染内容。
function makeContentPng() {
  const png = new PNG({ width: 1920, height: 1080 })
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      const ink = y > 300 && y < 900 && x > 100 && x < 1800
      png.data[i] = ink ? 30 : 255
      png.data[i + 1] = ink ? 27 : 255
      png.data[i + 2] = ink ? 75 : 255
      png.data[i + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

function createRunner(tempDir) {
  const runner = new VisualTestRunner({
    screenshotDir: path.join(tempDir, 'screenshots'),
    reportDir: path.join(tempDir, 'reports'),
    metaDir: path.join(tempDir, 'meta'),
    baselineDir: path.join(tempDir, 'baselines'),
  })
  for (const directory of [
    runner.screenshotDir,
    runner.reportDir,
    runner.metaDir,
    runner.baselineDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true })
  }
    runner.page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('http://127.0.0.1:5174/#/accounts'),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(500),
    screenshot: vi.fn().mockImplementation(async ({ path: outputPath }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, makeContentPng())
    }),
  }
  return runner
}

function makeCheckLocator(visible) {
  return {
    first() { return this },
    isVisible: vi.fn().mockResolvedValue(visible),
  }
}

describe('视觉基线门禁', () => {
  afterEach(() => {
    delete process.env.UPDATE_BASELINE
  })

  it('默认模式缺少人工审核基线时失败且不写基线', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-baseline-missing-'))
    const runner = createRunner(tempDir)
    const updateBaseline = vi.spyOn(runner.pixelDiff, 'updateBaseline')

    try {
      await expect(runner.pixelRegressionTest('missing', '/accounts'))
        .rejects.toMatchObject({ code: 'ERR_VISUAL_BASELINE_MISSING' })
      expect(updateBaseline).not.toHaveBeenCalled()
      expect(runner.results.at(-1)).toMatchObject({
        test: 'missing',
        status: 'FAILED',
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('显式更新模式才允许创建基线', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-baseline-update-'))
    const runner = createRunner(tempDir)
    process.env.UPDATE_BASELINE = '1'

    try {
      await expect(runner.pixelRegressionTest('approved', '/accounts')).resolves.toMatchObject({
        status: 'BASELINE_CREATED',
      })
      expect(fs.existsSync(path.join(tempDir, 'baselines', 'approved.png'))).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('视觉视图门禁', () => {
  afterEach(() => {
    delete process.env.UPDATE_BASELINE
  })

  it('ready 选择器不存在时必须失败', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ready-selector-'))
    const runner = createRunner(tempDir)
    runner.page.waitForSelector = vi.fn().mockRejectedValue(new Error('selector missing'))

    try {
      await expect(runner.aiVisionTest('bad-ready', '/accounts', [
        { name: '标题', text: '账号管理' },
      ], { waitFor: '.missing' })).rejects.toThrow(/selector missing|选择器/)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('每个视觉检查必须声明可执行的选择器或文字断言', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-machine-check-'))
    const runner = createRunner(tempDir)
    runner.page.waitForSelector = vi.fn().mockResolvedValue(undefined)

    try {
      await expect(runner.aiVisionTest('prompt-only', '/accounts', [
        { name: '仅提示词', prompt: '页面是否正常？' },
      ], { waitFor: '.page-title' })).rejects.toMatchObject({
        code: 'ERR_VISUAL_CHECK_INVALID',
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('机器断言失败时记录 FAILED 并拒绝通过', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-check-failed-'))
    const runner = createRunner(tempDir)
    runner.page.waitForSelector = vi.fn().mockResolvedValue(undefined)
    runner.page.locator = vi.fn(() => makeCheckLocator(false))

    try {
      await expect(runner.aiVisionTest('missing-control', '/accounts', [
        { name: '添加按钮', selector: '.add-account-button' },
      ], { waitFor: '.page-title' })).rejects.toMatchObject({
        code: 'ERR_VISUAL_CHECK_FAILED',
      })
      expect(runner.results).toContainEqual(expect.objectContaining({
        test: 'missing-control',
        check: '添加按钮',
        status: 'FAILED',
      }))
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('重定向入口按声明的目标路由等待应用就绪', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-redirect-route-'))
    const runner = createRunner(tempDir)
    runner.page.waitForFunction = vi.fn().mockResolvedValue(undefined)
    runner.page.locator = vi.fn(() => makeCheckLocator(true))

    try {
      await expect(runner.aiVisionTest('providers-redirect', '/providers', [
        { name: '标题', selector: '.page-title' },
      ], {
        expectedRoute: '/model-providers',
        waitFor: '.page-title',
      })).resolves.toMatchObject({ status: 'PASSED' })
      expect(runner.page.goto).toHaveBeenCalledWith(
        expect.stringContaining('/#/providers'),
        expect.any(Object),
      )
      expect(runner.page.waitForFunction.mock.calls[0][1]).toBe('#/model-providers')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('每次导航前清空 cookie、localStorage 和 sessionStorage', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-state-reset-'))
    const runner = createRunner(tempDir)
    const clearCookies = vi.fn().mockResolvedValue(undefined)
    runner.context = { clearCookies }
    const evaluate = vi.fn().mockResolvedValue(undefined)
    runner.page.evaluate = evaluate

    try {
      await runner._navigateToRoute('/accounts', '.page-title')
      expect(clearCookies).toHaveBeenCalledOnce()
      expect(evaluate).toHaveBeenCalled()
      const resetScript = evaluate.mock.calls[0][0].toString()
      expect(resetScript).toContain('localStorage.clear')
      expect(resetScript).toContain('sessionStorage.clear')
      expect(runner.page.goto.mock.invocationCallOrder[0])
        .toBeGreaterThan(clearCookies.mock.invocationCallOrder[0])
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('首次导航停留在 about:blank 时不访问受限存储', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-blank-state-reset-'))
    const runner = createRunner(tempDir)
    runner.page.url.mockReturnValue('about:blank')
    const clearCookies = vi.fn().mockResolvedValue(undefined)
    runner.context = { clearCookies }

    try {
      await runner._navigateToRoute('/accounts', '.page-title')
      expect(clearCookies).toHaveBeenCalledOnce()
      expect(runner.page.goto).toHaveBeenCalled()
      expect(runner.page.evaluate.mock.invocationCallOrder[0])
        .toBeGreaterThan(runner.page.goto.mock.invocationCallOrder[0])
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('视觉应用就绪预算', () => {
  afterEach(() => {
    delete process.env.VISUAL_READY_TIMEOUT
  })

  it('读取有效的 CI 就绪预算，且显式配置优先', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ready-timeout-'))
    process.env.VISUAL_READY_TIMEOUT = '15000'

    try {
      expect(createRunner(tempDir).readyTimeout).toBe(15000)
      expect(new VisualTestRunner({ readyTimeout: 9000 }).readyTimeout).toBe(9000)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('非法的 CI 就绪预算使用有限默认值', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ready-timeout-invalid-'))
    process.env.VISUAL_READY_TIMEOUT = 'not-a-number'

    try {
      expect(createRunner(tempDir).readyTimeout).toBe(15000)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it.each(['500', '30001', '1000.5', '-1', 'Infinity'])('越界的 CI 就绪预算 %s 使用有限默认值', (value) => {
    process.env.VISUAL_READY_TIMEOUT = value
    expect(new VisualTestRunner().readyTimeout).toBe(15000)
  })

  it('业务选择器只使用 Vue 挂载后的剩余总预算', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ready-budget-'))
    const runner = createRunner(tempDir)
    let now = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    runner.page.waitForFunction = vi.fn().mockImplementation(async () => {
      now = 14999
    })

    try {
      await runner._navigateToRoute('/accounts', '.page-title')
      expect(runner.page.waitForSelector).toHaveBeenCalledWith('.page-title', { timeout: 1 })
    } finally {
      nowSpy.mockRestore()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('应用挂载超时附带路由与挂载状态诊断，且不继续截图', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ready-diagnostics-'))
    const runner = createRunner(tempDir)
    const timeout = new Error('Timeout 5000ms exceeded')
    timeout.name = 'TimeoutError'
    runner.page.waitForFunction = vi.fn().mockRejectedValue(timeout)
    runner.page.url = vi.fn().mockReturnValue('http://127.0.0.1:5174/#/accounts')
    runner.page.evaluate = vi.fn().mockResolvedValue({
      hash: '#/accounts',
      appPresent: true,
      appMounted: false,
      appTextLength: 0,
    })

    try {
      let failure
      try {
        await runner._navigateToRoute('/accounts', '.page-title')
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({ code: 'ERR_VISUAL_APP_READY_TIMEOUT' })
      expect(failure.message).toContain('url=http://127.0.0.1:5174/#/accounts')
      expect(failure.message).toContain('hash=#/accounts')
      expect(failure.message).toContain('appMounted=false')
      expect(runner.page.waitForSelector).not.toHaveBeenCalled()
      expect(runner.page.screenshot).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('业务选择器超时保留独立错误码和阶段信息', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-selector-diagnostics-'))
    const runner = createRunner(tempDir)
    const timeout = new Error('Timeout 15000ms exceeded')
    timeout.name = 'TimeoutError'
    runner.page.waitForFunction = vi.fn().mockResolvedValue(undefined)
    runner.page.waitForSelector = vi.fn().mockRejectedValue(timeout)
    runner.page.url = vi.fn().mockReturnValue('http://127.0.0.1:5174/#/accounts')
    runner.page.evaluate = vi.fn().mockResolvedValue({
      hash: '#/accounts',
      appPresent: true,
      appMounted: true,
      appTextLength: 32,
    })

    try {
      let failure
      try {
        await runner._navigateToRoute('/accounts', '.page-title')
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({ code: 'ERR_VISUAL_READY_SELECTOR_TIMEOUT' })
      expect(failure.message).toContain('stage=业务选择器(.page-title)')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
