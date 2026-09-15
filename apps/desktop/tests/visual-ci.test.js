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
})