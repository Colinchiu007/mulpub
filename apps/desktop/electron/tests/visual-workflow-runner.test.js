import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const workflowRunner = require('../../tests/visual-testing/workflows/all-workflows.visual.test')
const { PixelDiffProvider } = require('../../tests/visual-testing/providers/pixel-diff')
const e2eRunner = require('../../tests/e2e/helpers/run-all')

describe('视觉工作流执行器', () => {
  it('使用 Hash 路由构造应用页面 URL', () => {
    expect(workflowRunner.buildWorkflowUrl('http://127.0.0.1:5174', '/accounts'))
      .toBe('http://127.0.0.1:5174/#/accounts')
    expect(workflowRunner.buildWorkflowUrl('http://127.0.0.1:5174/', '/publish'))
      .toBe('http://127.0.0.1:5174/#/publish')
  })

  it('点击和条件等待使用短超时以快速暴露无效选择器', async () => {
    const page = {
      click: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
    }

    await workflowRunner.executeStep(page, { action: 'click', selector: '#submit' })
    await workflowRunner.executeStep(page, { action: 'waitFor', selector: '#done' })

    expect(page.click).toHaveBeenCalledWith('#submit', { timeout: 3000 })
    expect(page.waitForSelector).toHaveBeenCalledWith('#done', { timeout: 3000 })
  })

  it('拒绝固定时长等待，要求使用可观察条件', async () => {
    await expect(workflowRunner.executeStep({}, { action: 'waitMs', ms: 125 }))
      .rejects.toThrow('不支持的工作流动作: waitMs')
  })

  it('快速文案工作流等待视图和模式激活后再操作输入框', () => {
    const workflow = workflowRunner.workflowTests.find(
      item => item.name === 'create-quick-text-reset',
    )
    const selectors = workflow.steps.map(step => `${step.action}:${step.selector || ''}`)

    expect(selectors).toEqual(expect.arrayContaining([
      'waitFor:.view-tab:nth-child(2).active',
      'click:[data-testid="quick-mode-text"]',
      'waitFor:[data-testid="quick-mode-text"].active',
    ]))
    expect(selectors.indexOf('waitFor:.view-tab:nth-child(2).active'))
      .toBeLessThan(selectors.indexOf('waitFor:[data-testid="quick-ai-prompt"]'))
    expect(selectors.indexOf('waitFor:[data-testid="quick-mode-text"].active'))
      .toBeLessThan(selectors.indexOf('waitFor:[data-testid="quick-ai-prompt"]'))
    expect(selectors.indexOf('click:[data-testid="quick-mode-text"]'))
      .toBeLessThan(selectors.indexOf('waitFor:[data-testid="quick-mode-text"].active'))
  })

  it('账号工作流使用当前筛选器和命令按钮的稳定选择器', () => {
    const accountWorkflows = workflowRunner.workflowTests.filter(item => item.name.startsWith('accounts-'))
    const byName = Object.fromEntries(accountWorkflows.map(item => [item.name, item]))
    const searchSteps = byName['accounts-search-clear'].steps
    const activeSteps = byName['accounts-active-filter-reset'].steps
    const addSteps = byName['accounts-add-dialog-cancel'].steps

    expect(searchSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'fill', selector: 'input[aria-label="搜索账号或平台"]' }),
      expect.objectContaining({ action: 'click', selector: 'button.clear-search' }),
    ]))
    expect(activeSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'click', selector: '.filter-tabs button[role="tab"]:nth-child(2)' }),
      expect.objectContaining({ action: 'waitFor', selector: '.filter-tabs button[role="tab"]:nth-child(2).active' }),
    ]))
    expect(addSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'click', selector: '[data-testid="account-add"]' }),
    ]))
    // 曾断言 `click .page-actions button:has-text("分组管理")` —— 那是**把不存在的选择器钉成契约**：
    // Accounts.vue:3 的页头是 `<h1 class="sr-only">`，该页模板里没有 .page-actions / .page-title
    // （只在 CSS:1236-1239 出现），所以这条契约只读注册表对象、从不跑浏览器，才会与真渲染同时"绿"。
    // 分组管理已改由 shell 模块导航以 ?tab=groups 打开内联面板，视觉工作流无法合法基线化 ⇒ 用例删除。
    expect(byName['accounts-group-dialog-close']).toBeUndefined()

    const selectors = accountWorkflows.flatMap(item => item.steps.map(step => step.selector || ''))
    expect(JSON.stringify(selectors)).not.toMatch(/filter-chips|cohere-filter-chip|search-clear|cohere-btn-primary|cohere-btn-ghost/)
    // 正向锁：/accounts 的页头是 sr-only h1 ⇒ 任何账号工作流都不该再等 .page-title/.page-actions
    expect(JSON.stringify(selectors)).not.toMatch(/\.page-title|\.page-actions/)
  })

  it('执行文件上传和日期输入动作', async () => {
    const page = {
      setInputFiles: vi.fn().mockResolvedValue(undefined),
      keyboard: { type: vi.fn().mockResolvedValue(undefined) },
    }

    await workflowRunner.executeStep(page, {
      action: 'setInputFiles',
      selector: '#file',
      files: ['fixture.json'],
    })
    await workflowRunner.executeStep(page, { action: 'selectDate', value: '2026-07-18 10:00' })

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', ['fixture.json'])
    expect(page.keyboard.type).toHaveBeenCalledWith('2026-07-18 10:00')
  })

  it('拒绝未知动作，避免静默跳过流程步骤', async () => {
    await expect(workflowRunner.executeStep({}, { action: 'unknown' }))
      .rejects.toThrow('不支持的工作流动作: unknown')
  })

  it.each([
    {
      name: '缺失路由',
      workflow: {
        name: 'missing-route',
        route: '/missing',
        steps: [{ action: 'screenshot', name: '结果' }],
        baseline: 'approved',
      },
      code: 'ROUTE_NOT_FOUND',
    },
    {
      name: '动作缺失 selector',
      workflow: {
        name: 'missing-selector',
        route: '/accounts',
        steps: [
          { action: 'click' },
          { action: 'screenshot', name: '结果' },
        ],
        baseline: 'approved',
      },
      code: 'SELECTOR_REQUIRED',
    },
    {
      name: 'data-testid 未在产品源码定义',
      workflow: {
        name: 'missing-testid',
        route: '/accounts',
        steps: [
          { action: 'click', selector: '[data-testid=missing-button]' },
          { action: 'screenshot', name: '结果' },
        ],
        baseline: 'approved',
      },
      code: 'TESTID_NOT_FOUND',
    },
    {
      name: '未知动作',
      workflow: {
        name: 'unknown-action',
        route: '/accounts',
        steps: [
          { action: 'teleport' },
          { action: 'screenshot', name: '结果' },
        ],
        baseline: 'approved',
      },
      code: 'UNKNOWN_ACTION',
    },
    {
      name: '没有步骤',
      workflow: {
        name: 'empty-workflow',
        route: '/accounts',
        steps: [],
        baseline: 'approved',
      },
      code: 'STEPS_REQUIRED',
    },
    {
      name: '没有截图步骤',
      workflow: {
        name: 'no-screenshot',
        route: '/accounts',
        steps: [{ action: 'press', key: 'Escape' }],
        baseline: 'approved',
      },
      code: 'SCREENSHOT_REQUIRED',
    },
  ])('$name会使静态合同失败', ({ workflow, code }) => {
    const errors = workflowRunner.validateWorkflowDefinition(workflow, {
      routePaths: ['/accounts'],
      sourceText: '<button data-testid="real-button"></button>',
      baselineExists: () => true,
    })

    expect(errors.map(error => error.code)).toContain(code)
  })

  it('缺失基线会在启动浏览器前使工作流门禁失败', async () => {
    const launch = vi.fn()
    const result = await workflowRunner.runWorkflowSuite([
      {
        name: 'missing-baseline',
        route: '/accounts',
        steps: [{ action: 'screenshot', name: '结果' }],
        baseline: 'not-reviewed',
      },
    ], {
      runnerFactory: () => ({ launch }),
      validationOptions: {
        routePaths: ['/accounts'],
        sourceText: '',
        baselineExists: () => false,
      },
      silent: true,
    })

    expect(result.failed).toBe(1)
    expect(result.results[0].error).toContain('基线')
    expect(launch).not.toHaveBeenCalled()
  })

  it('截图会命名落盘、消费 baseline 和 threshold，并保留像素结果', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(undefined),
    }
    const compare = vi.fn().mockResolvedValue({
      misMatchPercentage: 4.9,
      diffImagePath: 'diff.png',
    })
    const runner = {
      page,
      settleForCapture: vi.fn().mockResolvedValue(undefined),
      pixelDiff: { compare },
    }
    const workflow = {
      name: 'visual-result',
      route: '/accounts',
      steps: [{ action: 'screenshot', name: '最终状态' }],
      baseline: 'approved-state',
      verify: { method: 'pixel', threshold: 0.05 },
    }

    const result = await workflowRunner.executeWorkflow(runner, workflow, {
      baselineDir: path.join('fixtures', 'baselines'),
      screenshotDir: path.join('artifacts', 'current'),
      baselineExists: () => true,
      ensureDir: vi.fn(),
    })

    const screenshot = result.screenshots[0]
    expect(page.screenshot).toHaveBeenCalledWith({
      path: expect.stringContaining(path.join('artifacts', 'current', 'visual-result--step-1-current.png')),
      fullPage: true,
    })
    expect(compare).toHaveBeenCalledWith(
      expect.stringContaining(path.join('fixtures', 'baselines', 'approved-state.png')),
      expect.stringContaining(path.join('artifacts', 'current', 'visual-result--step-1-current.png')),
      'visual-result--step-1',
    )
    expect(screenshot).toMatchObject({
      status: 'PASSED',
      threshold: 0.05,
      misMatchPercentage: 4.9,
      diffPath: 'diff.png',
    })
  })

  it('使用真实像素比较器验证已审核基线', { timeout: 30000 }, async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-visual-'))
    const baselineDir = path.join(tempDir, 'baselines')
    const screenshotDir = path.join(tempDir, 'current')
    const baselinePath = path.join(baselineDir, 'approved-state.png')
    const reviewedBaseline = path.resolve(
      'tests/visual-testing/base-screenshots/accounts-list.png',
    )
    fs.mkdirSync(baselineDir, { recursive: true })
    fs.copyFileSync(reviewedBaseline, baselinePath)

    try {
      const pixelDiff = new PixelDiffProvider({
        threshold: 0.05,
        outputDir: path.join(tempDir, 'diff'),
      })

      const runner = {
        page: {
          goto: vi.fn().mockResolvedValue(undefined),
          screenshot: vi.fn().mockImplementation(async ({ path: currentPath }) => {
            fs.copyFileSync(reviewedBaseline, currentPath)
          }),
        },
        settleForCapture: vi.fn().mockResolvedValue(undefined),
        pixelDiff,
      }
      const result = await workflowRunner.executeWorkflow(runner, {
        name: 'real-pixel-comparison',
        route: '/accounts',
        steps: [{ action: 'screenshot', name: '最终状态' }],
        baseline: 'approved-state',
        verify: { method: 'pixel', threshold: 0 },
      }, {
        baselineDir,
        screenshotDir,
      })

      expect(result.screenshots[0]).toMatchObject({
        status: 'PASSED',
        threshold: 0,
        misMatchPercentage: 0,
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('真实像素比较返回逐像素差异比例而不是二进制全有或全无', { timeout: 30000 }, async () => {
    const baseline = path.resolve('tests/visual-testing/base-screenshots/accounts-list.png')
    const different = path.resolve('tests/visual-testing/base-screenshots/publish-form.png')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-pixel-ratio-'))

    try {
      const pixelDiff = new PixelDiffProvider({ outputDir: tempDir })
      const result = await pixelDiff.compare(baseline, different, 'fractional-diff')

      expect(result.comparisonMode).toBe('pixelmatch')
      expect(result.misMatchPercentage).toBeGreaterThan(0)
      expect(result.misMatchPercentage).toBeLessThan(100)
      expect(fs.existsSync(result.diffImagePath)).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('真实像素比较器拒绝无效图片', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-invalid-image-'))
    const invalidImage = path.join(tempDir, 'invalid.png')
    fs.writeFileSync(invalidImage, 'not-a-png')

    try {
      const pixelDiff = new PixelDiffProvider({ outputDir: tempDir })

      await expect(pixelDiff.compare(invalidImage, invalidImage, 'invalid'))
        .rejects.toMatchObject({ code: 'ERR_INVALID_IMAGE' })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('像素差异超过工作流阈值时失败且保留失败截图结果', async () => {
    const runner = {
      page: {
        goto: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(undefined),
      },
      settleForCapture: vi.fn().mockResolvedValue(undefined),
      pixelDiff: {
        compare: vi.fn().mockResolvedValue({
          misMatchPercentage: 5.01,
          diffImagePath: 'diff.png',
        }),
        updateBaseline: vi.fn(),
      },
    }
    const workflow = {
      name: 'visual-difference',
      route: '/accounts',
      steps: [{ action: 'screenshot', name: '最终状态' }],
      baseline: 'approved-state',
      verify: { method: 'pixel', threshold: 0.05 },
    }

    await expect(workflowRunner.executeWorkflow(runner, workflow, {
      baselineExists: () => true,
      ensureDir: vi.fn(),
    })).rejects.toMatchObject({
      screenshots: [expect.objectContaining({
        status: 'FAILED',
        threshold: 0.05,
        misMatchPercentage: 5.01,
      })],
    })
    expect(runner.pixelDiff.updateBaseline).not.toHaveBeenCalled()
  })

  it('运行器启动失败必须标 runnerLaunchFailed，不得让上层把整套读成「全红」', async () => {
    // 生产侧的锁：聚合器只认 result.runnerLaunchFailed 这一个字段，而「套件在启动失败时到底有没有置它」
    // 只有跑真 runWorkflowSuite 才能证明 —— 在聚合器测试里手搓 {runnerLaunchFailed: true} 不构成证据。
    const workflows = ['wf-a', 'wf-b'].map(name => ({
      name,
      route: '/accounts',
      steps: [{ action: 'screenshot', name: '最终状态' }],
      baseline: 'approved-state',
      verify: { method: 'pixel', threshold: 0.05 },
    }))
    const close = vi.fn().mockResolvedValue(undefined)

    const result = await workflowRunner.runWorkflowSuite(workflows, {
      runnerFactory: () => ({
        launch: vi.fn().mockRejectedValue(new Error('browserType.launch: boom')),
        close,
      }),
      validationOptions: {
        routePaths: ['/accounts'],
        sourceText: '',
        baselineExists: () => true,
      },
      silent: true,
    })

    expect(result.runnerLaunchFailed).toBe(true)
    // 回填仍逐条存在（人类可读），且条数必须与用例数相等，否则上层按「账不平」处理
    expect(result.results).toHaveLength(2)
    expect(result.failed).toBe(2)
    expect(close).toHaveBeenCalledOnce()
  })

  it('像素差异会落实为套件失败计数', async () => {
    const runner = {
      launch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      page: {
        goto: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(undefined),
      },
      settleForCapture: vi.fn().mockResolvedValue(undefined),
      pixelDiff: {
        compare: vi.fn().mockResolvedValue({ misMatchPercentage: 8.2 }),
      },
    }
    const workflow = {
      name: 'suite-visual-difference',
      route: '/accounts',
      steps: [{ action: 'screenshot', name: '最终状态' }],
      baseline: 'approved-state',
      verify: { method: 'pixel', threshold: 0.05 },
    }

    const result = await workflowRunner.runWorkflowSuite([workflow], {
      runner,
      validationOptions: {
        routePaths: ['/accounts'],
        sourceText: '',
        baselineExists: () => true,
      },
      executionOptions: { ensureDir: vi.fn() },
      silent: true,
    })

    expect(result.failed).toBe(1)
    expect(result.results[0]).toMatchObject({
      status: 'FAILED',
      screenshots: [expect.objectContaining({
        status: 'FAILED',
        misMatchPercentage: 8.2,
      })],
    })
    expect(runner.close).toHaveBeenCalledOnce()
  })

  it('像素提供器跳过比较时按失败处理', async () => {
    const runner = {
      page: {
        goto: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(undefined),
      },
      settleForCapture: vi.fn().mockResolvedValue(undefined),
      pixelDiff: {
        compare: vi.fn().mockResolvedValue({ skipped: true, reason: '不可用', passed: true }),
      },
    }

    await expect(workflowRunner.executeWorkflow(runner, {
      name: 'visual-skipped',
      route: '/accounts',
      steps: [{ action: 'screenshot', name: '最终状态' }],
      baseline: 'approved-state',
    }, {
      baselineExists: () => true,
      ensureDir: vi.fn(),
    })).rejects.toThrow('像素比较不可用')
  })
})

describe('E2E 统一入口', () => {
  it('任一路由检查、控制台或页面错误都使门禁失败', () => {
    expect(e2eRunner.hasFailures({ ok: {
      checks: { failed: 0 },
      consoleErrors: [],
      pageErrors: [],
    } })).toBe(false)

    expect(e2eRunner.hasFailures({ failedCheck: {
      checks: { failed: 1 },
      consoleErrors: [],
      pageErrors: [],
    } })).toBe(true)
    expect(e2eRunner.hasFailures({ consoleError: {
      checks: { failed: 0 },
      consoleErrors: [{}],
      pageErrors: [],
    } })).toBe(true)
  })
})

describe('工作流截图前的确定性渲染收口', () => {
  it('captureWorkflowScreenshot 必须在 page.screenshot 之前调用 settleForCapture', async () => {
    const calls = []
    const runner = {
      settleForCapture: vi.fn(async () => { calls.push('settle') }),
      page: { screenshot: vi.fn(async () => { calls.push('shot') }) },
      pixelDiff: {
        compare: vi.fn(async () => ({ misMatchPercentage: 0, passed: true })),
      },
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-settle-'))
    try {
      await workflowRunner.captureWorkflowScreenshot(runner, {
        name: 'settle-order',
        route: '/dashboard',
        baseline: 'no-such-baseline',
        steps: [{ action: 'screenshot', name: '末态' }],
      }, 0, { baselineDir: tempDir, screenshotDir: tempDir })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    expect(calls).toEqual(['settle', 'shot'])
    expect(runner.settleForCapture).toHaveBeenCalledTimes(1)
  })
})
