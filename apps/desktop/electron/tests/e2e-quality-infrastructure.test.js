// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const e2eRunner = require('../../tests/e2e/helpers/run-all')
const finalReport = require('../../tests/e2e/helpers/final-report')
const routeSuite = require('../../tests/e2e/helpers/route-functional-suite')
const integrationFlows = require('../../tests/e2e/helpers/integration-flows')
const { FunctionalRunner } = require('../../tests/e2e/helpers/functional-runner')

const desktopRoot = path.resolve(__dirname, '../..')
const projectRoot = path.resolve(desktopRoot, '../..')
const fixturePath = path.join(desktopRoot, 'tests/e2e/fixtures/model-providers.json')
const accountFixturePath = path.join(desktopRoot, 'tests/e2e/fixtures/accounts.json')
const ipcMockPath = path.join(desktopRoot, 'tests/e2e/helpers/ipc-mock.js')

function makeReport() {
  return {
    checks: { total: 1, passed: 1, failed: 0 },
    consoleErrors: [],
    pageErrors: [],
  }
}

function loadProviderMock() {
  const modelProviders = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  const sandbox = {
    window: { __fixtures: { modelProviders } },
    console,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(ipcMockPath, 'utf8'), sandbox)
  return sandbox.window
}

describe('E2E 统一入口门禁', () => {
  afterEach(() => {
    delete process.env.E2E_CONCURRENCY
    vi.restoreAllMocks()
  })

  it.each(['abc', '0', '-1', '1.5', 'Infinity'])('拒绝非法或非正并发值 %s', (value) => {
    expect(() => e2eRunner.parseConcurrency(value)).toThrow(/E2E_CONCURRENCY/)
  })

  it.each(['1', '2', '18'])('接受正整数并发值 %s', (value) => {
    expect(e2eRunner.parseConcurrency(value)).toBe(Number(value))
  })

  it('未配置并发值时默认串行，避免多浏览器重复刷新耗尽资源', () => {
    expect(e2eRunner.parseConcurrency()).toBe(1)
  })

  it('执行器不会绕过非法并发配置', async () => {
    process.env.E2E_CONCURRENCY = '0'
    await expect(e2eRunner.runWithConcurrency(['home'], vi.fn())).rejects.toThrow(/E2E_CONCURRENCY/)
  })

  it('未知运行模式必须在入口失败', async () => {
    expect(() => e2eRunner.validateMode('typo')).toThrow(/未知 E2E 模式/)
    await expect(e2eRunner.main('typo')).rejects.toThrow(/未知 E2E 模式/)
  })

  it('空执行结果和预期数量不符必须失败', () => {
    expect(e2eRunner.hasFailures({}, 1)).toBe(true)
    expect(e2eRunner.hasFailures({ home: makeReport() }, 2)).toBe(true)
    expect(e2eRunner.hasFailures({ home: makeReport() }, 1)).toBe(false)
  })

  it('各执行模式声明固定的预期报告数量', () => {
    expect(e2eRunner.expectedResultCount('routes')).toBe(17)
    expect(e2eRunner.expectedResultCount('flows')).toBe(6)
    expect(e2eRunner.expectedResultCount('all')).toBe(23)
    expect(e2eRunner.expectedResultCount('report')).toBe(0)
  })

  it('最终报告只汇总本轮结果，不能把旧磁盘报告当成本轮通过', () => {
    const report = finalReport.createReport({
      results: {
        home: {
          checks: { total: 1, passed: 1, failed: 0 },
          consoleErrors: [{ text: '本轮控制台错误' }],
          pageErrors: [{ message: '本轮页面错误' }],
        },
      },
    })
    const home = report.routes.matrix.find((item) => item.spec === 'home')

    expect(home).toMatchObject({
      status: '❌ FAIL',
      consoleErrors: 1,
      pageErrors: 1,
    })
    expect(report.summary).toMatchObject({
      totalConsoleErrors: 1,
      totalPageErrors: 1,
    })
  })

  it('统一入口向最终报告传递本轮结果', () => {
    const results = { home: makeReport() }
    const report = { summary: { totalFailed: 0 } }
    const main = vi.spyOn(finalReport, 'main').mockReturnValue(report)

    expect(e2eRunner.buildReport(results)).toBe(report)
    expect(main).toHaveBeenCalledWith({ results })
  })
})

describe('根脚本入口门禁', () => {
  it('源代码测试文件不得被 .gitignore 静默排除', () => {
    const ignoredFiles = execFileSync(
      'git',
      [
        'ls-files', '--others', '--ignored', '--exclude-standard', '--',
        ':(glob)apps/desktop/electron/**/*.test.js',
        ':(glob)apps/desktop/src/**/*.test.js',
        ':(glob)apps/desktop/tests/**/*.test.js',
        ':(glob)packages/*/src/**/*.test.js',
        ':(glob)packages/*/test/**/*.test.js',
        ':(glob)packages/*/tests/**/*.test.js',
      ],
      { cwd: projectRoot, encoding: 'utf8' },
    )
      .split(/\r?\n/)
      .filter(Boolean)

    expect(ignoredFiles).toEqual([])
  })

  it('package.json 中直接调用的 Node 脚本必须真实存在', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
    const missing = []

    for (const [name, command] of Object.entries(packageJson.scripts || {})) {
      const matches = command.matchAll(/(?:^|&&|\|\|)\s*node\s+([^\s&|]+\.js)/g)
      for (const match of matches) {
        const relativePath = match[1].replace(/^['"]|['"]$/g, '')
        if (!fs.existsSync(path.resolve(projectRoot, relativePath))) {
          missing.push({ name, relativePath })
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('桌面测试脚本引用的 Vitest 配置必须真实存在', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'))
    const missing = []

    for (const [name, command] of Object.entries(packageJson.scripts || {})) {
      const matches = command.matchAll(/(?:--config|-c)\s+([^\s&|]+\.js)/g)
      for (const match of matches) {
        const relativePath = match[1].replace(/^['"]|['"]$/g, '')
        if (!fs.existsSync(path.resolve(desktopRoot, relativePath))) {
          missing.push({ name, relativePath })
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('循环依赖门禁不得吞掉失败退出码', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts['check:circular']).not.toMatch(/\|\||non-blocking|WARN/)
  })

  it('依赖检查门禁不得吞掉失败退出码', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts['check:deps']).not.toMatch(/\|\||non-blocking|WARN/)
  })

  it.each(['build.yml', 'electron-ci.yml'])('%s 的依赖检查失败必须阻止流水线', (workflow) => {
    const source = fs.readFileSync(path.join(projectRoot, '.github/workflows', workflow), 'utf8')
    const dependencyStep = source.match(/- name: Dependency check[\s\S]*?(?=\n\s+- name:|$)/)?.[0] || ''

    expect(dependencyStep).not.toContain('continue-on-error')
    expect(dependencyStep).toContain('pnpm run check:deps')
  })
})

describe('覆盖率与变异测试门禁', () => {
  it('Stryker 使用 Windows 兼容的原地模式并覆盖核心重构文件', () => {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'stryker.conf.json'), 'utf8'))

    expect(config.inPlace).toBe(true)
    expect(config.mutate).toEqual(expect.arrayContaining([
      'apps/desktop/electron/core/**/*.js',
      'apps/desktop/electron/bootstrap/**/*.js',
      'apps/desktop/electron/bootstrap.js',
      'apps/desktop/electron/main.js',
      'apps/desktop/electron/window.js',
      'apps/desktop/electron/shutdown.js',
      'packages/shared-utils/src/scheduler.js',
      '!**/*.test.js',
      '!**/*.spec.js',
    ]))
  })

  it('Stryker 专用配置不再排除已经验证可运行的有效测试套件', () => {
    const configSource = fs.readFileSync(path.join(desktopRoot, 'vitest.stryker.config.js'), 'utf8')
    const validSuites = [
      'ai-generator.test.js',
      'api-platform-adapter.test.js',
      'composition-manager.test.js',
      'pipeline-engine.test.js',
      'service-bus-plugin-registry.test.js',
      'stage-executor-publish.test.js',
      'stage-executor.test.js',
      'video-engine.test.js',
    ]

    for (const suite of validSuites) expect(configSource).not.toContain(`electron/tests/${suite}`)
  })
})

describe('路由通用扫描', () => {
  it('发布正文等待编辑器初始化并确认内容写入', async () => {
    let value = ''
    const editor = {
      first: vi.fn(function first() { return this }),
      waitFor: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn(async (nextValue) => { value = nextValue }),
      evaluate: vi.fn(async () => value),
    }
    const page = {
      locator: vi.fn((selector) => {
        expect(selector).toContain('.ql-editor[contenteditable="true"]')
        expect(selector).toContain('textarea.md-editor')
        return editor
      }),
    }

    await expect(routeSuite.fillPublishBody(page, '正文内容')).resolves.toBe(true)
    expect(editor.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 5000 })
    expect(editor.fill).toHaveBeenCalledWith('正文内容')
    expect(editor.evaluate).toHaveBeenCalledTimes(1)
  })

  it('发布正文编辑器初始化超时时返回失败而不抛错', async () => {
    const timeout = new Error('editor timeout')
    timeout.name = 'TimeoutError'
    const editor = {
      first: vi.fn(function first() { return this }),
      waitFor: vi.fn().mockRejectedValue(timeout),
      fill: vi.fn(),
      evaluate: vi.fn(),
    }
    const page = { locator: vi.fn(() => editor) }

    await expect(routeSuite.fillPublishBody(page, '正文内容')).resolves.toBe(false)
    expect(editor.fill).not.toHaveBeenCalled()
  })

  it('合法重定向按目标路由等待应用就绪', async () => {
    const runner = new FunctionalRunner()
    runner.page = { goto: vi.fn().mockResolvedValue(undefined) }
    runner.waitForAppReady = vi.fn().mockResolvedValue(undefined)

    await runner.goto('/create/pipeline', { expectedRoute: '/create' })

    expect(runner.waitForAppReady).toHaveBeenCalledWith('/create')
  })

  it('重置路由使用唯一地址完成、仅完成一次全页导航并给予更长就绪窗口', async () => {
    const runner = new FunctionalRunner()
    runner.goto = vi.fn().mockResolvedValue(undefined)
    runner.waitForAppReady = vi.fn().mockResolvedValue(undefined)
    runner.page = {
      goto: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
    }

    await runner.resetToRoute('/create/pipeline', { expectedRoute: '/create' })

    expect(runner.goto).not.toHaveBeenCalled()
    expect(runner.page.goto).toHaveBeenCalledWith(
      'http://127.0.0.1:5174/?__e2e_reset=1#/create/pipeline',
      { waitUntil: 'domcontentloaded', timeout: 20000 },
    )
    expect(runner.page.reload).not.toHaveBeenCalled()
    expect(runner.waitForAppReady).toHaveBeenCalledWith('/create', 15000)
  })

  it('重置路由允许特定用例收紧或放宽就绪超时', async () => {
    const runner = new FunctionalRunner()
    runner.waitForAppReady = vi.fn().mockResolvedValue(undefined)
    runner.page = { goto: vi.fn().mockResolvedValue(undefined) }

    await runner.resetToRoute('/accounts', { readyTimeout: 12000 })

    expect(runner.waitForAppReady).toHaveBeenCalledWith('/accounts', 12000)
  })

  it('路由就绪把总预算分配给每个条件，而不是为每步重复计时', async () => {
    const app = { waitFor: vi.fn().mockResolvedValue(undefined) }
    const runner = new FunctionalRunner()
    runner.page = {
      waitForURL: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue(app),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    }
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(2200)

    await runner.waitForAppReady('/accounts', 10000)

    expect(runner.page.waitForURL).toHaveBeenCalledWith(expect.any(Function), { timeout: 10000 })
    expect(app.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 9000 })
    expect(runner.page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), '#/accounts', { timeout: 7900 })
  })

  it('总就绪预算耗尽时向调用方报告失败', async () => {
    const runner = new FunctionalRunner()
    runner.page = {
      waitForURL: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn(),
      waitForFunction: vi.fn(),
    }
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(10100)

    await expect(runner.waitForAppReady('/accounts', 10000)).rejects.toThrow('等待应用就绪超时')
    expect(runner.page.locator).not.toHaveBeenCalled()
  })

  it('保存已过滤报告时不得重新写入 runner 收集到的原始错误', () => {
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-e2e-'))
    const runner = new FunctionalRunner({ reportsDir, specName: 'filtered-report' })
    runner.consoleErrors = [{ text: '已过滤错误' }]
    const filtered = {
      specName: 'filtered-report',
      checks: { total: 1, passed: 1, failed: 0 },
      consoleErrors: [],
      pageErrors: [],
      details: [],
    }

    try {
      const filename = runner.saveReport(filtered)
      expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).toEqual(filtered)
    } finally {
      fs.rmSync(reportsDir, { recursive: true, force: true })
    }
  })

  it('扫描任何控件前先完整重置到定义路由', async () => {
    const emptyCollection = {
      evaluateAll: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    }
    const r = {
      checks: [],
      goto: vi.fn().mockResolvedValue(undefined),
      resetToRoute: vi.fn().mockResolvedValue(undefined),
      page: { locator: vi.fn(() => emptyCollection) },
    }

    await routeSuite.auditInitialControls(r, { route: '/accounts' })

    expect(r.resetToRoute).toHaveBeenCalledWith('/accounts', { expectedRoute: '/accounts' })
    expect(r.page.locator.mock.invocationCallOrder[0]).toBeGreaterThan(r.resetToRoute.mock.invocationCallOrder[0])
  })

  it('每个初始按钮都在重置后的页面状态中单独执行', async () => {
    const button = {
      count: vi.fn().mockResolvedValue(1),
      isDisabled: vi.fn().mockResolvedValue(false),
      click: vi.fn().mockResolvedValue(undefined),
    }
    const buttons = {
      evaluateAll: vi.fn().mockResolvedValue([{ index: 0, text: '打开弹窗', disabled: false }]),
      nth: vi.fn().mockReturnValue(button),
    }
    const emptyCollection = {
      evaluateAll: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    }
    const r = {
      checks: [],
      goto: vi.fn().mockResolvedValue(undefined),
      resetToRoute: vi.fn().mockResolvedValue(undefined),
      page: {
        locator: vi.fn((selector) => selector === '.cohere-main button' ? buttons : emptyCollection),
      },
    }

    await routeSuite.auditInitialControls(r, { route: '/accounts' })

    expect(r.resetToRoute).toHaveBeenCalledWith('/accounts', { expectedRoute: '/accounts' })
    expect(button.click).toHaveBeenCalledTimes(1)
  })

  it('重复文本按钮优先使用各自的 data-testid 重新定位', async () => {
    const firstButton = {
      count: vi.fn().mockResolvedValue(1),
      isDisabled: vi.fn().mockResolvedValue(false),
      click: vi.fn().mockResolvedValue(undefined),
    }
    const secondButton = {
      count: vi.fn().mockResolvedValue(1),
      isDisabled: vi.fn().mockResolvedValue(false),
      click: vi.fn().mockResolvedValue(undefined),
    }
    const buttons = {
      evaluateAll: vi.fn().mockResolvedValue([
        { index: 0, text: '验证', testid: 'check-account-a', disabled: false },
        { index: 1, text: '验证', testid: 'check-account-b', disabled: false },
      ]),
      nth: vi.fn(),
    }
    const emptyCollection = {
      evaluateAll: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    }
    const r = {
      checks: [],
      resetToRoute: vi.fn().mockResolvedValue(undefined),
      page: {
        locator: vi.fn((selector) => {
          if (selector === '.cohere-main button') return buttons
          if (selector === '.cohere-main button[data-testid="check-account-a"]') return firstButton
          if (selector === '.cohere-main button[data-testid="check-account-b"]') return secondButton
          return emptyCollection
        }),
      },
    }

    await routeSuite.auditInitialControls(r, { route: '/accounts' })

    expect(firstButton.click).toHaveBeenCalledTimes(1)
    expect(secondButton.click).toHaveBeenCalledTimes(1)
    expect(buttons.nth).not.toHaveBeenCalled()
  })

  it('按钮在重渲染中失效时仅重新加载并重试一次', async () => {
    const button = {
      isDisabled: vi.fn().mockResolvedValue(false),
      click: vi.fn()
        .mockRejectedValueOnce(new Error('Element is not attached to the DOM'))
        .mockResolvedValueOnce(undefined),
    }
    const buttons = {
      evaluateAll: vi.fn().mockResolvedValue([
        { index: 0, text: '验证', testid: 'check-account-a', disabled: false },
      ]),
      nth: vi.fn(),
    }
    const emptyCollection = {
      evaluateAll: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    }
    const r = {
      checks: [],
      resetToRoute: vi.fn().mockResolvedValue(undefined),
      page: {
        locator: vi.fn((selector) => {
          if (selector === '.cohere-main button') return buttons
          if (selector === '.cohere-main button[data-testid="check-account-a"]') return button
          return emptyCollection
        }),
      },
    }

    await routeSuite.auditInitialControls(r, { route: '/accounts' })

    expect(button.click).toHaveBeenCalledTimes(2)
    expect(r.checks.find(item => item.name === '初始可用按钮均完成点击扫描')).toMatchObject({ passed: true })
  })

  it('任一初始可编辑字段失败时扫描失败并保留字段详情', async () => {
    const descriptors = [
      { index: 0, tag: 'input', type: 'text', visible: true, disabled: false, placeholder: '标题', name: 'title', testid: 'title' },
      { index: 1, tag: 'textarea', type: '', visible: true, disabled: false, placeholder: '正文', name: 'content', testid: 'content' },
    ]
    const fields = [
      { fill: vi.fn().mockResolvedValue(undefined) },
      { fill: vi.fn().mockRejectedValue(new Error('字段被遮挡')) },
    ]
    const collection = {
      evaluateAll: vi.fn().mockResolvedValue(descriptors),
      nth: vi.fn((index) => fields[index]),
    }
    const r = {
      checks: [],
      page: { locator: vi.fn(() => collection) },
    }

    const result = await routeSuite.auditInitialFields(r)

    expect(result.passed).toBe(false)
    expect(result.details).toMatchObject({ fieldCount: 2, editableCount: 2, exercised: 1 })
    expect(result.details.failures).toEqual([
      expect.objectContaining({ index: 1, type: '', placeholder: '正文', error: '字段被遮挡' }),
    ])
    expect(r.checks.at(-1)).toMatchObject({
      name: '全部初始可编辑表单字段完成输入扫描',
      passed: false,
    })
  })

  it('账号页仅合并重复账号行操作，保留不同语义的控件', () => {
    const controls = [
      { testid: 'check-a1', text: '验证' },
      { testid: 'check-a2', text: '验证' },
      { testid: 'proxy-a1', text: '' },
      { testid: 'proxy-a2', text: '' },
      { text: '打开' },
      { text: '删除' },
      { ariaLabel: '添加此平台账号', text: '' },
      { ariaLabel: '添加此平台账号', text: '' },
    ]

    const sampled = routeSuite.selectInitialAuditSamples(
      controls,
      routeSuite.controlSemanticKey,
      'semantic',
    )

    expect(sampled.selected).toEqual([
      controls[0],
      controls[2],
      controls[4],
      controls[5],
      controls[6],
    ])
    expect(sampled.suppressed).toHaveLength(3)
  })

  it('账号页字段采样不会把搜索、全选和账号名混为一类', () => {
    const fields = [
      { tag: 'input', type: 'search', placeholder: '搜索账号或平台', name: '', testid: '', className: '' },
      { tag: 'input', type: 'checkbox', placeholder: '', name: '', testid: '', className: '' },
      { tag: 'input', type: 'checkbox', placeholder: '', name: '', testid: 'select-a1', className: '' },
      { tag: 'input', type: 'checkbox', placeholder: '', name: '', testid: 'select-a2', className: '' },
      { tag: 'input', type: 'text', placeholder: '', name: '', testid: '', className: 'account-name-input' },
      { tag: 'input', type: 'text', placeholder: '', name: '', testid: '', className: 'account-name-input' },
    ]

    const sampled = routeSuite.selectInitialAuditSamples(
      fields,
      routeSuite.fieldSemanticKey,
      'semantic',
    )

    expect(sampled.selected).toEqual([fields[0], fields[1], fields[2], fields[4]])
    expect(sampled.suppressed).toHaveLength(2)
  })

  it('账号页显式启用语义采样，其他路由仍执行完整扫描', () => {
    expect(routeSuite.definitions.accounts.initialAuditStrategy).toBe('semantic')
    expect(routeSuite.definitions.publish.initialAuditStrategy).toBeUndefined()
  })
})

describe('模型服务商 E2E 契约', () => {
  it('fixture 和创建响应全面使用 snake_case', async () => {
    const modelProviders = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    for (const provider of modelProviders.providers) {
      expect(Object.keys(provider).every((key) => /^[a-z][a-z0-9_]*$/.test(key))).toBe(true)
      expect(provider).not.toHaveProperty('createdAt')
      expect(provider).not.toHaveProperty('isDefault')
      expect(provider).not.toHaveProperty('isPreset')
    }

    const mockWindow = loadProviderMock()
    const response = await mockWindow.electronAPI.modelProviderCreate({
      name: '自定义服务商',
      category: 'llm',
      base_url: 'https://example.com/v1',
      api_key: 'sk-test',
    })

    expect(response.code).toBe(0)
    expect(response.data).toMatchObject({ is_default: false, is_preset: false })
    expect(response.data.created_at).toEqual(expect.any(String))
    expect(Object.keys(response.data).every((key) => /^[a-z][a-z0-9_]*$/.test(key))).toBe(true)
    expect(response.data).not.toHaveProperty('isDefault')
    expect(response.data).not.toHaveProperty('createdAt')
  })

  it('设为默认后重读列表时只有目标服务商是默认项', async () => {
    const mockWindow = loadProviderMock()

    await mockWindow.electronAPI.modelProviderSetDefault('llm', 'preset_anthropic')
    const response = await mockWindow.electronAPI.modelProviderList('llm')
    const defaults = response.data.filter((provider) => provider.is_default)

    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).toBe('preset_anthropic')
    const presets = await mockWindow.electronAPI.modelProviderPresets('llm')
    expect(presets.data.length).toBeGreaterThan(0)
    expect(presets.data.every((provider) => provider.is_preset)).toBe(true)
  })

  it('Flow 3 根据重读列表验证唯一默认项', async () => {
    const r = makeFlow3Runner({
      providers: [
        { id: 'preset_openai', category: 'llm', is_default: true },
        { id: 'preset_anthropic', category: 'llm', is_default: true },
      ],
      configuredCalls: 1,
    })

    await integrationFlows.flows['flow-3'].exercise(r)

    expect(r.checks.find((check) => check.name.includes('唯一默认服务商'))).toMatchObject({ passed: false })
  })

  it('Flow 3 的 AI 配置检查不能在零次 IPC 调用时硬编码通过', async () => {
    const r = makeFlow3Runner({
      providers: [{ id: 'preset_anthropic', category: 'llm', is_default: true }],
      configuredCalls: 0,
    })

    await integrationFlows.flows['flow-3'].exercise(r)

    expect(r.checks.find((check) => check.name.includes('AI 服务商'))).toMatchObject({ passed: false })
  })

  it('Flow 3 等待 AI 面板可见和配置 IPC 后通过正常路径', async () => {
    const r = makeFlow3Runner({
      providers: [{ id: 'preset_anthropic', category: 'llm', is_default: true }],
      configuredCalls: 1,
    })

    await integrationFlows.flows['flow-3'].exercise(r)

    expect(r.checks.find((check) => check.name.includes('AI 写作面板'))).toMatchObject({
      passed: true,
      details: { aiPanelOpened: true, aiPanelVisible: true },
    })
    expect(r.checks.find((check) => check.name.includes('AI 服务商'))).toMatchObject({ passed: true })
  })
})

describe('账号 E2E 契约', () => {
  it('账号 fixture 全面使用 snake_case 时间字段', () => {
    const accounts = JSON.parse(fs.readFileSync(accountFixturePath, 'utf8')).accounts

    expect(accounts.length).toBeGreaterThan(0)
    for (const account of accounts) {
      expect(account).toHaveProperty('created_at')
      expect(account).not.toHaveProperty('createdAt')
    }
  })

  it('账号 fixture 必须把显示名放在 account_name（name 是 document.title 落盘位）', () => {
    // 本 PR 撤掉了 IPC 层 `account_name = account_name || name` 的提前合并，并摘除了展示层
    // 对 `name` 的候选资格。夹具若仍按旧模型只填 `name`，视觉/e2e 跑出来的 8 张卡片会全部
    // 退化成平台名 —— 而没有任何一条断言会红：没人检查这些名字，且 Gate 7 的
    // PIXEL_THRESHOLD=0.06 吸收得掉整页文字变化。所以形状必须被钉在这里。
    const accounts = JSON.parse(fs.readFileSync(accountFixturePath, 'utf8')).accounts

    expect(accounts.length).toBeGreaterThan(0)
    for (const account of accounts) {
      expect(typeof account.account_name, account.id + ' 缺少 account_name（显示名会退化成平台名）')
        .toBe('string')
      expect(account.account_name.trim().length, account.id + ' account_name 不得为空').toBeGreaterThan(0)
      if (account.name_source !== undefined) {
        expect(['auto', 'manual'], account.id + ' name_source 取值非法').toContain(account.name_source)
      }
    }
    // 至少一条 manual，使 e2e/视觉数据覆盖「manual 原样显示、不过守卫」这条分支
    expect(accounts.some((a) => a.name_source === 'manual'),
      'fixture 至少要有一条 name_source=manual').toBe(true)
  })

  it('新增账号响应与生产序列化字段一致', async () => {
    const mockWindow = loadProviderMock()
    const response = await mockWindow.electronAPI.accountAdd('weibo')

    expect(response).toMatchObject({ code: 0 })
    expect(response.data).toHaveProperty('created_at')
    expect(response.data).not.toHaveProperty('createdAt')
  })
})

describe('平台定义 E2E 契约', () => {
  it('IPC mock 与生产 platform:definitions 返回结构一致', async () => {
    const mockWindow = loadProviderMock()
    const response = await mockWindow.electronAPI.getPlatformDefinitions()

    expect(response).toMatchObject({
      code: 0,
      data: {
        names: expect.any(Object),
        icons: expect.any(Object),
        content_categories: expect.any(Object),
        categories: expect.any(Object),
        dashboardUrls: expect.any(Object),
        qrCodePlatforms: expect.anything(),
      },
    })
    expect(response.data.names.wechat_mp).toBe('微信公众号')
    expect(response.data.icons.douyin).toBe('🎵')
    expect(Array.isArray(response.data.qrCodePlatforms)).toBe(true)

    const accountPlatforms = new Set(
      JSON.parse(fs.readFileSync(accountFixturePath, 'utf8')).accounts.map(account => account.platform),
    )
    for (const platform of accountPlatforms) {
      expect(response.data.names).toHaveProperty(platform)
      expect(response.data.icons).toHaveProperty(platform)
    }
  })
})

function makeFlow3Runner({ providers, configuredCalls }) {
  const clickable = {
    count: vi.fn().mockResolvedValue(1),
    isVisible: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(undefined),
  }
  const page = {
    evaluate: vi.fn(async (callback) => {
      const source = String(callback)
      if (source.includes('modelProviderSetDefault')) return { code: 0 }
      if (source.includes('modelProviderList')) return { code: 0, data: providers }
      return null
    }),
    locator: vi.fn((selector) => {
      if (selector === '.provider-card') return { count: vi.fn().mockResolvedValue(1) }
      if (selector === 'body') return { innerText: vi.fn().mockResolvedValue('AI 辅助写作') }
      return { first: vi.fn(() => clickable) }
    }),
  }
  return {
    page,
    checks: [],
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    getIpcCalls: vi.fn(async (method) => {
      if (method === 'modelProviderSetDefault') return 1
      if (method === 'modelProviderIsConfigured') return configuredCalls
      if (method === 'aiListProviders') return configuredCalls
      return 0
    }),
  }
}
