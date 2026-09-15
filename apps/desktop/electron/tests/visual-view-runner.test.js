import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const viewRunner = require('../../tests/visual-testing/views/all-views.visual.test')

const desktopRoot = path.resolve(__dirname, '../..')
const pixelRunnerPath = path.join(
  desktopRoot,
  'tests/visual-testing/scripts/run-pixel-tests.js',
)
const pixelRunnerSource = fs.readFileSync(pixelRunnerPath, 'utf8')
const pixelRunner = require(pixelRunnerPath)
const routerSource = fs.readFileSync(path.join(desktopRoot, 'src/router/index.js'), 'utf8')
const routerPaths = [...routerSource.matchAll(/\bpath:\s*['"]([^'"]+)['"]/g)]
  .map(match => match[1])

function routeMatches(pattern, actual) {
  const normalizedActual = actual.split('?')[0]
  const expression = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z0-9_]+)/g, '[^/]+')
  return new RegExp('^' + expression + '$').test(normalizedActual)
}

describe('单视图视觉门禁合同', () => {
  it('仅覆盖真实路由且不遗漏任何路由入口', () => {
    for (const test of viewRunner.viewTests) {
      expect(
        routerPaths.some(route => routeMatches(route, test.route)),
        test.name + ' 使用了不存在的路由 ' + test.route,
      ).toBe(true)
      expect(
        routerPaths.some(route => routeMatches(route, test.expectedRoute)),
        test.name + ' 使用了不存在的目标路由 ' + test.expectedRoute,
      ).toBe(true)
    }

    for (const route of routerPaths) {
      expect(
        viewRunner.viewTests.some(test => routeMatches(route, test.route)),
        '路由 ' + route + ' 缺少单视图门禁',
      ).toBe(true)
    }
  })

  it('每个视图都声明严格就绪条件和机器可执行断言', () => {
    expect(new Set(viewRunner.viewTests.map(test => test.name)).size)
      .toBe(viewRunner.viewTests.length)

    for (const test of viewRunner.viewTests) {
      expect(test.waitFor, test.name + ' 缺少 waitFor').toEqual(expect.any(String))
      expect(test.waitMs, test.name + ' 禁止使用固定等待').toBeUndefined()
      expect(test.checks.length, test.name + ' 缺少断言').toBeGreaterThan(0)
      for (const check of test.checks) {
        expect(
          Boolean(check.selector || check.text),
          test.name + '/' + check.name + ' 只有提示词，没有机器断言',
        ).toBe(true)
      }
    }
  })

  it('任一视图执行失败都会使套件失败，同时仍完成资源关闭', async () => {
    const runner = {
      launch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      aiVisionTest: vi.fn()
        .mockResolvedValueOnce({ status: 'PASSED' })
        .mockRejectedValueOnce(new Error('页面断言失败')),
      results: [],
    }

    await expect(viewRunner.runViewSuite([
      { name: 'ok', route: '/', waitFor: '#app', checks: [{ name: '应用', selector: '#app' }] },
      { name: 'bad', route: '/accounts', waitFor: '.page-title', checks: [{ name: '标题', text: '账号管理' }] },
    ], { runner })).rejects.toMatchObject({ code: 'ERR_VISUAL_SUITE_FAILED' })

    expect(runner.launch).toHaveBeenCalledOnce()
    expect(runner.close).toHaveBeenCalledOnce()
  })
})

describe('像素视觉门禁合同', () => {
  it('像素用例失败后仍生成可供视觉判断读取的报告', async () => {
    const runner = {
      launch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      generateReport: vi.fn(),
      pixelRegressionTest: vi.fn().mockRejectedValue(new Error('像素差异超限')),
    }

    const summary = await pixelRunner.runPixelSuite([
      { name: 'accounts-list', route: '/accounts', waitFor: '.page-title' },
    ], { runner })

    expect(summary.failed).toBe(1)
    expect(runner.close).toHaveBeenCalledOnce()
    expect(runner.generateReport).toHaveBeenCalledOnce()
    expect(runner.close.mock.invocationCallOrder[0])
      .toBeLessThan(runner.generateReport.mock.invocationCallOrder[0])
  })

  it('发布页必须等待异步平台选项后截图', () => {
    const publishView = viewRunner.viewTests.find(test => test.name === 'publish-form')

    expect(publishView.waitFor).toBe('.mp-workspace .target-selector [data-testid^="platform-"]')
    expect(publishView.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '页面主标题',
        selector: '.mp-workspace .page-title:has-text("一键发布")',
      }),
      expect.objectContaining({
        name: '发布目标平台已加载',
        selector: '.mp-workspace .target-selector [data-testid^="platform-"]',
      }),
    ]))
    expect(pixelRunnerSource).toContain("waitFor: '.mp-workspace .target-selector [data-testid^=\"platform-\"]'")
    expect(pixelRunnerSource).not.toContain('.el-checkbox-group .el-checkbox')
  })

  it('不把跳过和固定等待计入成功，也不强制提前退出进程', () => {
    expect(pixelRunnerSource).not.toMatch(/electronOnly|SKIPPED/)
    expect(pixelRunnerSource).not.toMatch(/waitMs|waitForTimeout/)
    expect(pixelRunnerSource).not.toMatch(/process\.exit\(/)
  })
})
