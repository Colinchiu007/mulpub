import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const {
  DEFAULT_TEST_URL,
  PIXEL_TESTS,
  assertApprovedBaselines,
  isCiFailure,
  resolveVisualTestUrl,
  runAgentJudge,
  runPixelTests,
  writePixelResultReport,
} = require('./visual-testing/scripts/visual-ci')
const { buildJudgeResults, selectLatestReportFile } = require('./visual-testing/scripts/agent-visual-judge')
const { pixelTests } = require('./visual-testing/scripts/run-pixel-tests')
const { viewTests } = require('./visual-testing/views/all-views.visual.test.js')

describe('visual-ci 像素门禁', () => {
  it('CI 和日常像素门禁共享同一份测试注册表，并拒绝缺失批准基线', () => {
    expect(PIXEL_TESTS).toBe(pixelTests)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-baselines-'))

    try {
      expect(() => assertApprovedBaselines(pixelTests.slice(0, 2), tempDir))
        .toThrow(/缺少人工审核的视觉基线/)
      for (const test of pixelTests.slice(0, 2)) {
        fs.writeFileSync(path.join(tempDir, `${test.name}.png`), 'baseline')
      }
      expect(assertApprovedBaselines(pixelTests.slice(0, 2), tempDir)).toEqual([])
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('未指定 TEST_URL 时与桌面 E2E 使用同一默认地址', () => {
    expect(DEFAULT_TEST_URL).toBe('http://127.0.0.1:5174')
    expect(resolveVisualTestUrl({ env: {} })).toBe(DEFAULT_TEST_URL)
    expect(resolveVisualTestUrl({ env: { TEST_URL: 'http://127.0.0.1:5176' } }))
      .toBe('http://127.0.0.1:5176')
  })

  it('全量视觉聚合器按单一来源覆盖四套注册表，id 顺序即 CI 日志顺序', () => {
    const { visualSuites } = require('./visual-testing/scripts/run-all-visual')
    const { viewTests } = require('./visual-testing/views/all-views.visual.test.js')
    const { supplementaryViewTests } = require('./visual-testing/views/supplementary-views.visual.test.js')
    const { workflowTests } = require('./visual-testing/workflows/all-workflows.visual.test.js')
    const { supplementaryWorkflowTests } = require('./visual-testing/workflows/supplementary-workflows.visual.test.js')

    expect(visualSuites.map(suite => suite.id)).toEqual([
      'views', 'supplementary-views', 'workflows', 'supplementary-workflows',
    ])
    // 引用相等而非长度相等：聚合器一旦自己抄一份清单，注册表就会漂移成两份真源
    expect(visualSuites[0].registry).toBe(viewTests)
    expect(visualSuites[1].registry).toBe(supplementaryViewTests)
    expect(visualSuites[2].registry).toBe(workflowTests)
    expect(visualSuites[3].registry).toBe(supplementaryWorkflowTests)
  })

  it('第一套红不得中止后面三套，且逐套汇总行格式精确', async () => {
    const { runAllVisualSuites } = require('./visual-testing/scripts/run-all-visual')
    const callOrder = []
    const failedSuiteError = new Error('单视图视觉门禁失败: home: boom')
    failedSuiteError.failures = [{ test: 'home', error: failedSuiteError }]
    const suites = [
      {
        id: 'views',
        registry: [{ name: 'home' }, { name: 'publish' }],
        run: async () => { callOrder.push('views'); throw failedSuiteError },
      },
      {
        id: 'supplementary-views',
        registry: [{ name: 'first-run' }],
        run: async () => { callOrder.push('supplementary-views'); return { total: 1, passed: 1 } },
      },
      {
        id: 'workflows',
        registry: [{ name: 'wf-a' }, { name: 'wf-b' }],
        // all-workflows 的既有契约：不抛错，返回 {results, failed}
        run: async () => {
          callOrder.push('workflows')
          return { results: [{ test: 'wf-a', status: 'PASSED' }, { test: 'wf-b', status: 'FAILED' }], failed: 1 }
        },
      },
      {
        id: 'supplementary-workflows',
        registry: [{ name: 'wf-c' }],
        // 运行器起不来：没有任何一条结论，不得谎报成"这一套全红"
        run: async () => { callOrder.push('supplementary-workflows'); throw new Error('browserType.launch: boom') },
      },
    ]

    vi.useFakeTimers()
    try {
      const lines = []
      const summary = await runAllVisualSuites({ suites, log: line => lines.push(line) })

      expect(callOrder).toEqual(['views', 'supplementary-views', 'workflows', 'supplementary-workflows'])
      expect(lines).toEqual([
        '[VISUAL-SUMMARY] suite=views total=2 passed=1 failed=1 elapsed_ms=0',
        '[VISUAL-SUMMARY] suite=supplementary-views total=1 passed=1 failed=0 elapsed_ms=0',
        '[VISUAL-SUMMARY] suite=workflows total=2 passed=1 failed=1 elapsed_ms=0',
        '[VISUAL-SUMMARY] suite=supplementary-workflows total=1 passed=0 failed=0 elapsed_ms=0 aborted=1',
        '[VISUAL-ALL-SUMMARY] suites=4 total=6 passed=3 failed=2 aborted=1',
      ])
      expect(summary).toMatchObject({ total: 6, passed: 3, failed: 2, aborted: 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('形状不认识 / 启动失败一律 aborted，绝不默认「全通过」', () => {
    const { normalizeOutcome } = require('./visual-testing/scripts/run-all-visual')
    const suite = { id: 'workflows', registry: [{ name: 'a' }, { name: 'b' }], run: async () => ({}) }

    // all-workflows 既有契约是不抛错、把每条回填 FAILED；必须靠 runnerLaunchFailed 区分「全红」与「没有结论」
    expect(normalizeOutcome(suite, { results: [{ status: 'FAILED' }, { status: 'FAILED' }], failed: 2, runnerLaunchFailed: true }, null, 1))
      .toEqual({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 1 })
    expect(normalizeOutcome(suite, { results: [{ status: 'FAILED' }, { status: 'PASSED' }], failed: 1 }, null, 1))
      .toEqual({ total: 2, passed: 1, failed: 1, aborted: false, elapsedMs: 1 })
    expect(normalizeOutcome(suite, undefined, null, 1)).toEqual({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 1 })
    expect(normalizeOutcome(suite, { passed: 2 }, null, 1)).toEqual({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 1 })
    // 套件自报的条数与注册表对不上 = 账不平，不得「就近取数」当结论
    expect(normalizeOutcome(suite, { total: 9, passed: 9 }, null, 1)).toEqual({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 1 })
    expect(normalizeOutcome(suite, { results: [], failed: 0 }, null, 1)).toEqual({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 1 })
    expect(normalizeOutcome(suite, { results: [{ status: 'PASSED' }].concat([{ status: 'PASSED' }, { status: 'PASSED' }]), failed: 0 }, null, 1))
      .toEqual({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 1 })
    // 抛错但一条都没归因，同样不是「全通过」
    expect(normalizeOutcome(suite, null, Object.assign(new Error('boom'), { failures: [] }), 1))
      .toEqual({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 1 })
  })

  it('耗时按注入时钟如实计算，results 条数不得反过来定义用例总数，报告可落文件', async () => {
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const { runAllVisualSuites } = require('./visual-testing/scripts/run-all-visual')
    const ticks = [1000, 3500]
    const suites = [{
      id: 'workflows',
      registry: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      run: async () => ({ results: [{ status: 'PASSED' }, { status: 'PASSED' }, { status: 'FAILED' }], failed: 1 }),
    }]
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-all-report-'))
    const reportPath = path.join(dir, 'reports', 'visual-all-summary.json')
    const lines = []

    try {
      const summary = await runAllVisualSuites({
        suites,
        log: line => lines.push(line),
        now: () => { const t = ticks.shift(); return t === undefined ? 3500 : t },
        reportPath,
      })
      expect(lines).toEqual([
        '[VISUAL-SUMMARY] suite=workflows total=3 passed=2 failed=1 elapsed_ms=2500',
        '[VISUAL-ALL-SUMMARY] suites=1 total=3 passed=2 failed=1 aborted=0',
      ])
      expect(summary.suites[0].total).toBe(3)
      expect(summary.suites[0].aborted).toBe(false)
      expect(JSON.parse(fs.readFileSync(reportPath, 'utf8'))).toEqual(summary)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('汇总不猜数：用例数超出注册表时按注册表收口，异常无 failures 时记 aborted', () => {
    const { normalizeOutcome, formatSummaryLine } = require('./visual-testing/scripts/run-all-visual')
    const suite = { id: 'views', registry: [{ name: 'a' }, { name: 'b' }], run: async () => ({}) }
    const tooMany = new Error('boom')
    tooMany.failures = [{}, {}, {}]

    expect(normalizeOutcome(suite, null, tooMany, 5)).toEqual({ total: 2, passed: 0, failed: 2, aborted: false, elapsedMs: 5 })
    expect(formatSummaryLine({ total: 2, passed: 0, failed: 2, aborted: false, elapsedMs: 5 }, 'views'))
      .toBe('[VISUAL-SUMMARY] suite=views total=2 passed=0 failed=2 elapsed_ms=5')
    expect(formatSummaryLine({ total: 2, passed: 0, failed: 0, aborted: true, elapsedMs: 5 }, 'views'))
      .toBe('[VISUAL-SUMMARY] suite=views total=2 passed=0 failed=0 elapsed_ms=5 aborted=1')
  })

  it('本轮像素报告保留自身的截图和差异工件路径', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-report-'))
    const outputPath = path.join(tempDir, 'pixel-results.json')

    try {
      writePixelResultReport({
        total: 1,
        passed: 0,
        failed: 1,
        details: [{
          name: 'publish-form',
          route: '/publish',
          status: 'FAILED',
          screenshotPath: 'C:/run/current.png',
          baselinePath: 'C:/run/baseline.png',
          diffImagePath: 'C:/run/diff.png',
          threshold: 0.05,
        }],
      }, outputPath)

      expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).results[0]).toMatchObject({
        screenshotPath: 'C:/run/current.png',
        baselinePath: 'C:/run/baseline.png',
        diffImagePath: 'C:/run/diff.png',
        threshold: 0.05,
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('底层意外返回 BASELINE_CREATED 时仍然失败关闭', async () => {
    const runner = {
      launch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      generateReport: vi.fn(),
      pixelRegressionTest: vi.fn()
        .mockResolvedValueOnce({ status: 'BASELINE_CREATED', passed: true })
        .mockResolvedValueOnce({ passed: true }),
    }

    const result = await runPixelTests({
      runner,
      tests: [
        { name: 'missing-baseline', route: '/accounts' },
        { name: 'approved', route: '/publish' },
      ],
      validateBaselines: false,
    })

    expect(result).toMatchObject({ total: 2, passed: 1, failed: 1 })
    expect(result.details).toContainEqual(expect.objectContaining({
      name: 'missing-baseline',
      status: 'FAILED',
      error: 'CI 拒绝自动创建视觉基线',
    }))
    expect(runner.close).toHaveBeenCalledTimes(1)
  })

  it('底层像素对比明确失败时不能计为通过', async () => {
    const runner = {
      launch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      generateReport: vi.fn(),
      pixelRegressionTest: vi.fn().mockResolvedValue({
        passed: false,
        misMatchPercentage: 12.5,
      }),
    }

    const result = await runPixelTests({
      runner,
      tests: [{ name: 'mismatch', route: '/publish' }],
      validateBaselines: false,
    })

    expect(result).toMatchObject({ total: 1, passed: 0, failed: 1 })
    expect(result.details).toContainEqual(expect.objectContaining({
      name: 'mismatch',
      status: 'FAILED',
    }))
    expect(runner.close).toHaveBeenCalledTimes(1)
  })

  it('底层像素 runner 返回空值时必须失败关闭', async () => {
    const runner = {
      launch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      generateReport: vi.fn(),
      pixelRegressionTest: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runPixelTests({
      runner,
      tests: [{ name: 'empty-result', route: '/publish' }],
      validateBaselines: false,
    })

    expect(result).toMatchObject({ total: 1, passed: 0, failed: 1 })
    expect(result.details).toContainEqual(expect.objectContaining({
      name: 'empty-result',
      status: 'FAILED',
    }))
  })

  it('浏览器启动失败时仍关闭已部分初始化的 runner', async () => {
    const runner = {
      launch: vi.fn().mockRejectedValue(new Error('browser launch failed')),
      close: vi.fn().mockResolvedValue(undefined),
      generateReport: vi.fn(),
      pixelRegressionTest: vi.fn(),
    }

    await expect(runPixelTests({
      runner,
      tests: [{ name: 'unused', route: '/' }],
      validateBaselines: false,
    })).rejects.toThrow('browser launch failed')
    expect(runner.close).toHaveBeenCalledTimes(1)
    expect(runner.pixelRegressionTest).not.toHaveBeenCalled()
  })

  it('关闭失败时保留原始启动失败原因', async () => {
    const runner = {
      launch: vi.fn().mockRejectedValue(new Error('browser launch failed')),
      close: vi.fn().mockRejectedValue(new Error('browser close failed')),
      generateReport: vi.fn(),
      pixelRegressionTest: vi.fn(),
    }

    await expect(runPixelTests({ runner, tests: [], validateBaselines: false })).rejects.toThrow('browser launch failed')
    expect(runner.close).toHaveBeenCalledTimes(1)
  })

  it('Agent 报告生成失败或像素汇总不完整时不能让 CI 总流程判定成功', () => {
    const valid = {
      total: 1,
      passed: 1,
      failed: 0,
      details: [{ name: 'approved', status: 'PASSED' }],
    }

    expect(isCiFailure(valid, 'failed')).toBe(true)
    expect(isCiFailure({ ...valid, failed: 1, passed: 0 }, 'success')).toBe(true)
    expect(isCiFailure({ total: 0, passed: 0, failed: 0, details: [] }, 'success')).toBe(true)
    expect(isCiFailure({ total: 2, passed: 1, failed: 0, details: valid.details }, 'success')).toBe(true)
    expect(isCiFailure({
      total: 1,
      passed: 1,
      failed: 0,
      details: [{ name: 'unknown', status: 'UNKNOWN' }],
    }, 'success')).toBe(true)
    expect(isCiFailure(valid, 'success')).toBe(false)
  })

  it('Agent 报告必须是本轮生成且与当前像素结果结构一致', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-agent-'))
    const outputJsonPath = path.join(tempDir, 'agent-judge-results.json')
    const outputMarkdownPath = path.join(tempDir, 'judge-report.md')
    const pixelReportPath = path.join(tempDir, 'pixel-results.json')
    const pixelResult = {
      total: 1,
      passed: 1,
      failed: 0,
      details: [{ name: 'approved', route: '/accounts', status: 'PASSED' }],
    }

    try {
      const result = runAgentJudge({
        pixelResult,
        pixelReportPath,
        outputJsonPath,
        outputMarkdownPath,
        runNodeScript: (_script, args) => {
          expect(args).toEqual(['--report', pixelReportPath])
          fs.writeFileSync(outputJsonPath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            summary: { total: 1, pixelFailed: 0, pixelPassed: 1 },
            tests: [{ testName: 'approved', route: '/accounts', needsAgentReview: false }],
          }))
          fs.writeFileSync(outputMarkdownPath, '# Agent Visual Judge Report\n\n## Summary\n')
          return 'report generated'
        },
      })

      expect(result).toBe('success')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('混合通过和失败的像素批次必须按全量结果校验 Agent 报告', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-agent-mixed-'))
    const outputJsonPath = path.join(tempDir, 'agent-judge-results.json')
    const outputMarkdownPath = path.join(tempDir, 'judge-report.md')
    const pixelReportPath = path.join(tempDir, 'pixel-results.json')
    const pixelResult = {
      total: 2,
      passed: 1,
      failed: 1,
      details: [
        { name: 'approved', route: '/accounts', status: 'PASSED' },
        { name: 'mismatch', route: '/publish', status: 'FAILED', error: 'pixel mismatch' },
      ],
    }

    try {
      const result = runAgentJudge({
        pixelResult,
        pixelReportPath,
        outputJsonPath,
        outputMarkdownPath,
        runNodeScript: () => {
          fs.writeFileSync(outputJsonPath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            summary: { total: 2, pixelFailed: 1, pixelPassed: 1 },
            tests: [
              { testName: 'approved', route: '/accounts', needsAgentReview: false },
              { testName: 'mismatch', route: '/publish', needsAgentReview: true },
            ],
          }))
          fs.writeFileSync(outputMarkdownPath, '# Agent Visual Judge Report\n\n## Summary\n')
          return 'report generated'
        },
      })

      expect(result).toBe('success')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('Agent 报告的 generatedAt 早于本轮开始时必须判过期（新鲜度看内容时间戳，不看文件系统 mtime）', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-agent-stale-'))
    const outputJsonPath = path.join(tempDir, 'agent-judge-results.json')
    const outputMarkdownPath = path.join(tempDir, 'judge-report.md')
    const pixelResult = {
      total: 1,
      passed: 1,
      failed: 0,
      details: [{ name: 'approved', route: '/accounts', status: 'PASSED' }],
    }

    try {
      const result = runAgentJudge({
        pixelResult,
        outputJsonPath,
        outputMarkdownPath,
        runNodeScript: () => {
          // 上一轮遗留的报告：结构完全合规、mtime 是本轮刚写的，只有内容时间戳是旧的。
          fs.writeFileSync(outputJsonPath, JSON.stringify({
            generatedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
            summary: { total: 1, pixelFailed: 0, pixelPassed: 1 },
            tests: [{ testName: 'approved', route: '/accounts', needsAgentReview: false }],
          }))
          fs.writeFileSync(outputMarkdownPath, '# Agent Visual Judge Report\n\n## Summary\n')
          return 'report generated'
        },
      })

      expect(result).toBe('failed')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('Agent 报告缺少或非法定位 generatedAt 时必须失败关闭（无判据即视为过期）', () => {
    for (const generatedAt of [undefined, 'not-a-timestamp', 1700000000000]) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-agent-nots-'))
      const outputJsonPath = path.join(tempDir, 'agent-judge-results.json')
      const outputMarkdownPath = path.join(tempDir, 'judge-report.md')
      const pixelResult = {
        total: 1,
        passed: 1,
        failed: 0,
        details: [{ name: 'approved', route: '/accounts', status: 'PASSED' }],
      }

      try {
        const payload = {
          summary: { total: 1, pixelFailed: 0, pixelPassed: 1 },
          tests: [{ testName: 'approved', route: '/accounts', needsAgentReview: false }],
        }
        if (generatedAt !== undefined) payload.generatedAt = generatedAt

        const result = runAgentJudge({
          pixelResult,
          outputJsonPath,
          outputMarkdownPath,
          runNodeScript: () => {
            fs.writeFileSync(outputJsonPath, JSON.stringify(payload))
            fs.writeFileSync(outputMarkdownPath, '# Agent Visual Judge Report\n\n## Summary\n')
            return 'report generated'
          },
        })

        expect(result).toBe('failed')
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    }
  })

  it('Agent 报告为空或结构不完整时必须失败关闭', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-agent-invalid-'))
    const outputJsonPath = path.join(tempDir, 'agent-judge-results.json')
    const outputMarkdownPath = path.join(tempDir, 'judge-report.md')

    try {
      const result = runAgentJudge({
        outputJsonPath,
        outputMarkdownPath,
        runNodeScript: () => {
          fs.writeFileSync(outputJsonPath, JSON.stringify({ summary: { total: 0 }, tests: [] }))
          fs.writeFileSync(outputMarkdownPath, '# Agent Visual Judge Report')
          return 'report generated'
        },
      })

      expect(result).toBe('failed')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('Agent 判断器只能从本轮像素报告构造结果，不能读取共享历史元数据', () => {
    const judgeSource = fs.readFileSync(
      path.join(__dirname, 'visual-testing/scripts/agent-visual-judge.js'),
      'utf8',
    )

    expect(judgeSource).toContain('function buildJudgeResults')
    expect(judgeSource).not.toContain('const meta = loadMeta()')
    expect(judgeSource).not.toContain('const diffImages = scanDiffImages()')

    const results = buildJudgeResults({
      results: [{
        test: 'current-run',
        route: '/publish',
        status: 'FAILED',
        misMatchPercentage: 3.25,
        diffImagePath: 'C:/current-run-diff.png',
        threshold: 0.05,
      }],
    })

    expect(results).toEqual([expect.objectContaining({
      testName: 'current-run',
      route: '/publish',
      threshold: 0.05,
      pixelDiff: {
        passed: false,
        misMatchPercentage: 3.25,
        diffImagePath: 'C:/current-run-diff.png',
        threshold: 0.05,
      },
    })])
  })

  it('Agent 判断器保留失败像素结果中缺失的差异指标，不能伪装成零差异', () => {
    const [result] = buildJudgeResults({
      results: [{
        test: 'missing-metrics',
        route: '/publish',
        status: 'FAILED',
      }],
    })

    expect(result.pixelDiff).toMatchObject({
      passed: false,
      misMatchPercentage: null,
      threshold: null,
      invalidMetrics: true,
    })
  })

  it('Agent 判断器把未知像素状态视为无效失败，不能误计为通过', () => {
    const [result] = buildJudgeResults({
      results: [{
        test: 'unknown-status',
        route: '/publish',
        status: 'UNKNOWN',
        misMatchPercentage: 0,
        threshold: 0.05,
      }],
    })

    expect(result.pixelDiff).toMatchObject({
      passed: false,
      invalidMetrics: true,
    })
  })

  it('Agent 判断器按修改时间选择最新报告，而不是按文件名排序', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-ci-latest-report-'))
    const oldFile = path.join(tempDir, 'report-z.json')
    const newFile = path.join(tempDir, 'report-a.json')

    try {
      fs.writeFileSync(oldFile, '{}')
      fs.writeFileSync(newFile, '{}')
      fs.utimesSync(oldFile, new Date('2026-07-22T10:00:00Z'), new Date('2026-07-22T10:00:00Z'))
      fs.utimesSync(newFile, new Date('2026-07-22T10:01:00Z'), new Date('2026-07-22T10:01:00Z'))

      expect(selectLatestReportFile(tempDir)).toBe(newFile)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('视觉门禁路由选择器', () => {
  it('账号页使用稳定的页面容器而不是隐藏标题选择器', () => {
    const accountsTest = pixelTests.find((test) => test.name === 'accounts-list')
    expect(accountsTest?.waitFor).toBe('.mp-workspace .accounts-page')
  })

  it('首页使用参考产品复刻后的页面容器而不是旧版 cohere 标题选择器', () => {
    const homeTest = pixelTests.find((test) => test.name === 'home-baseline')
    expect(homeTest?.waitFor).toBe('.mp-home .mp-home-welcome')
  })

describe('视觉用例双清单一致性', () => {
  // CI 的 `QG Visual` 只执行 `run-pixel-tests.js` 的 `pixelTests`；只登记进 `all-views` 的用例**等于没跑**
  // （实测踩过：`accounts-list-flag-on` 首版只在 `viewTests` 里，于是 QG Visual 直接绿 —— 那条绿是必然的假绿，
  //  日志里 18 个视图各出现一次全 PASSED，而新用例名 0 次）。这里不要求两份清单整体等价（范围本就不同），
  //  只锁"必须进 CI 的那几条"，以及"等入口本身的用例必须自带开启该入口的条件"。
  const MUST_BE_IN_CI = ['accounts-list-flag-on']

  for (const name of MUST_BE_IN_CI) {
    it(`${name} 必须同时存在于 viewTests 与 CI 执行的 pixelTests`, () => {
      const inViews = viewTests.find((t) => t.name === name)
      const inPixel = pixelTests.find((t) => t.name === name)
      expect(inViews, `${name} 不在 all-views 的 viewTests 里（全量路径会漏它）`).toBeTruthy()
      expect(inPixel, `${name} 不在 pixelTests 里 ⇒ QG Visual 对它的绿是假绿`).toBeTruthy()
      // 两份清单靠名字各写一遍，最容易漂移的是等待条件与路由：不一致时 CI 拍的就不是同一张图
      expect(inPixel.waitFor).toBe(inViews.waitFor)
      expect(inPixel.route).toBe(inViews.route)
    })
  }

  it('pixelTests 里等待应用入口本身的用例，路由必须自带开启该入口的条件', () => {
    const flagged = pixelTests.filter((t) => /data-testid="account-cloud-sync"/.test(String(t.waitFor || '')))
    expect(flagged.length).toBeGreaterThan(0)
    for (const t of flagged) {
      // 否则这条用例恒等于"截一张没有该入口的页面"，像素门禁会稳定通过而什么都没说
      expect(t.route, `用例 ${t.name} 等的是入口本身，路由却没开它`).toContain('mpFlag=account_cloud_sync=1')
    }
  })


  it('两份清单里**所有同名用例**的 route 与 waitFor 必须逐字一致', () => {
    // 上面那条只守"必须进 CI 的那几条"。真正咬过人的是**反向漂移**：同一个用例名在两份清单里
    // 各写一遍等待条件，改了一份忘了另一份。实测本仓 first-run 就是这样漂的 ——
    // `App.vue` 把 `/first-run` 划到全屏布局（`isFullScreenRoute`）后，`pixelTests` 侧改成了
    // `.fullscreen-main h2`，`viewTests` 侧仍留着 `.cohere-main h2`，于是
    // `npm run test:all:visual`（跑 viewTests）从 first-run 起就绪超时，而 CI 的 `QG Visual`
    // 照跑照绿 —— 两边都"没问题"，坏掉的是那条没人跑的路径。
    // 判据取"同名即须一致"，且**不预留豁免表**：真要分叉必须在这里显式登记理由，否则即红。
    const byPixel = new Map(pixelTests.map((t) => [t.name, t]))
    const drifted = viewTests
      .filter((v) => byPixel.has(v.name))
      .map((v) => {
        const p = byPixel.get(v.name)
        return {
          name: v.name,
          routeDiff: String(v.route) !== String(p.route),
          waitForDiff: String(v.waitFor) !== String(p.waitFor),
          view: v,
          pixel: p,
        }
      })
      .filter((d) => d.routeDiff || d.waitForDiff)
    const detail = drifted.map((d) => `${d.name}: view{route=${d.view.route}, waitFor=${d.view.waitFor}} ` +
      `vs pixel{route=${d.pixel.route}, waitFor=${d.pixel.waitFor}}`).join("\n")
    expect(drifted, `两份清单出现漂移（${drifted.length} 条）:\n${detail}`).toEqual([])
    // 顺带钉住"当前确实有可比对的重名用例"，否则这条锁会在某侧被清空后静默恒真
    expect(viewTests.filter((v) => byPixel.has(v.name)).length, 'viewTests 与 pixelTests 无重名用例 ⇒ 本锁退化为 no-op').toBeGreaterThan(5)
  })
  it('pixelTests 每条用例的基线都必须被 base-screenshots/.gitignore 显式放行', () => {
    // 根 .gitignore 有 `*.png`，基线目录靠一份**逐个点名**的 negation 白名单才被跟踪。漏登记的后果
    // 不是报错而是静默：新基线 PNG 进不了 git ⇒ CI 上永远缺基线 ⇒ 这条门禁永远红，或有人改用
    // `git add -f` 补图，白名单与清单从此漂移（实测踩过：accounts-list-flag-on.png 落盘后 `git status`
    // 完全不显示它，`git add` 也静默不收）。方向只锁"清单要求跟踪的都必须放行"，反向不锁
    // （白名单里留着已下线视图的条目无害）。
    const ignorePath = path.join(__dirname, 'visual-testing', 'base-screenshots', '.gitignore')
    const allow = new Set(fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/)
      .map((l) => l.trim()).filter((l) => l.startsWith('!')).map((l) => l.slice(1)))
    const missing = pixelTests.map((t) => t.name).filter((n) => !allow.has(`${n}.png`))
    expect(missing, `以下 pixelTests 的基线未被 .gitignore 白名单放行：${missing.join(', ')}`).toEqual([])
  })
  it('暗色基线同样必须被显式放行（批次 1 建立暗色通道后，同一静默失败面同样存在）', () => {
    // 2026-09-29（批次 1/6 收口）：暗色基线 `<view>-dark.png` 首次入库时，根 `.gitignore` 的 `*.png`
    // 同样会静默吞掉它们 —— 与上一条浅色锁是**同一个失败面**。此处对每个 pixelTest 断言深色条目
    // 也在白名单里，避免「浅色登记了、暗色漏了」这种只在一半面上生效的假绿。
    const ignorePath = path.join(__dirname, 'visual-testing', 'base-screenshots', '.gitignore')
    const allow = new Set(fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/)
      .map((l) => l.trim()).filter((l) => l.startsWith('!')).map((l) => l.slice(1)))
    const missing = pixelTests.map((t) => t.name).filter((n) => !allow.has(`${n}-dark.png`))
    expect(missing, `以下 pixelTests 的**暗色**基线未被 .gitignore 白名单放行：${missing.join(', ')}`).toEqual([])
  })})
})