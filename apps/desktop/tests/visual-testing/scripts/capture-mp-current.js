/**
 * 生成 Multi-Publish 的参考产品对比当前图。
 *
 * 前置条件：Vite 已启动。默认地址为 http://127.0.0.1:5174，
 * 可通过 TEST_URL 覆盖。截图只使用仓库内测试 fixture，不读取真实账号数据。
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const { buildInitScript } = require('../../e2e/helpers/fixture-loader')

const DEFAULT_BASE_URL = 'http://127.0.0.1:5174'
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../screenshots/mp-parity')
const READY_TIMEOUT = 15000
const STABLE_CONTEXT_OPTIONS = Object.freeze({
  colorScheme: 'light',
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
})
const STABLE_RENDERING_CSS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`

const VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ name: 'mobile', width: 480, height: 800 }),
  Object.freeze({ name: 'audit', width: 2560, height: 1328 }),
])

const CAPTURE_SCENARIOS = Object.freeze([
  Object.freeze({
    name: 'accounts',
    route: '/accounts',
    readySelector: '.mp-workspace .accounts-page',
  }),
  Object.freeze({
    name: 'publish',
    route: '/publish/history',
    readySelector: '.mp-workspace .publish-history-page h1:has-text("发布记录")',
  }),
  Object.freeze({
    name: 'batch-publish',
    route: '/publish/history',
    readySelector: '.mp-workspace .publish-history-page h1:has-text("发布记录")',
    actionSelector: '[data-testid="start-selection"]',
    actionReadySelector: '.record-selector input',
  }),
])

function screenshotName (scenarioName, viewport) {
  return viewport.name === 'desktop'
    ? `${scenarioName}.png`
    : `${scenarioName}-${viewport.name}.png`
}

function normalizeBaseUrl (value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function assertServerReady (baseUrl) {
  return new Promise((resolve, reject) => {
    const request = http.get(baseUrl + '/', { timeout: 5000 }, response => {
      response.resume()
      if (response.statusCode >= 200 && response.statusCode < 400) {
        resolve()
        return
      }
      reject(new Error(`Vite 返回 HTTP ${response.statusCode}`))
    })
    request.on('timeout', () => request.destroy(new Error('Vite 连接超时')))
    request.on('error', cause => reject(new Error(
      `Vite 未运行（${baseUrl}）：${cause.message}`,
    )))
  })
}

function inspectLayoutInPage () {
  const issues = []
  const viewportWidth = document.documentElement.clientWidth
  const pageWidth = document.documentElement.scrollWidth
  if (pageWidth > viewportWidth + 1) {
    issues.push(`页面横向溢出：scrollWidth=${pageWidth}，clientWidth=${viewportWidth}`)
  }

  const visibleElements = selector => Array.from(document.querySelectorAll(selector))
    .filter(element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })

  for (const element of visibleElements('.mp-workspace, .publish-history-page, .history-panel, .record-card')) {
    const rect = element.getBoundingClientRect()
    if (rect.left < -1 || rect.right > window.innerWidth + 1) {
      issues.push(`${element.className} 超出视口：left=${rect.left.toFixed(1)}，right=${rect.right.toFixed(1)}`)
    }
  }

  for (const card of visibleElements('.record-card')) {
    const cardRect = card.getBoundingClientRect()
    const main = card.querySelector('.record-main')
    if (!main) continue
    const mainRect = main.getBoundingClientRect()
    if (mainRect.left < cardRect.left - 1 || mainRect.right > cardRect.right + 1) {
      issues.push(`记录主体超出卡片：left=${mainRect.left.toFixed(1)}，right=${mainRect.right.toFixed(1)}`)
    }
  }

  for (const element of visibleElements(
    '.primary-action, .secondary-action, .toolbar-button, .history-tab, .record-count, .selection-count',
  )) {
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
      issues.push(`控件文字溢出：${(element.textContent || '').trim().slice(0, 30)}`)
    }
  }

  const nav = document.querySelector('.mp-module-nav')
  const main = document.querySelector('.mp-workspace')
  if (nav && main) {
    const navRect = nav.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    if (mainRect.top < navRect.bottom - 1) {
      issues.push(`顶部导航与主内容重叠：navBottom=${navRect.bottom.toFixed(1)}，mainTop=${mainRect.top.toFixed(1)}`)
    }
  }

  return issues
}

async function captureScenario (page, scenario, viewport, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR)
  const expectedHash = '#' + scenario.route

  await page.goto(`${baseUrl}/#${scenario.route}`, {
    waitUntil: 'domcontentloaded',
    timeout: READY_TIMEOUT,
  })
  await page.waitForFunction(hash => {
    const app = document.querySelector('#app')
    return window.location.hash === hash
      && app?.hasAttribute('data-v-app')
      && (app.textContent || '').trim().length > 0
  }, expectedHash, { timeout: READY_TIMEOUT })
  try {
    await page.waitForSelector(scenario.readySelector, { timeout: READY_TIMEOUT })
  } catch (cause) {
    throw new Error(
      `${scenario.name} 未在 ${baseUrl} 渲染预期页面（${scenario.route}）。`
      + `请从当前 worktree 启动 Vite 或通过 TEST_URL 指向正确端口：${cause.message}`,
    )
  }
  await page.addStyleTag({ content: STABLE_RENDERING_CSS })

  if (scenario.actionSelector) {
    await page.click(scenario.actionSelector)
    await page.waitForSelector(scenario.actionReadySelector, { timeout: READY_TIMEOUT })
  }

  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })

  const layoutIssues = await page.evaluate(inspectLayoutInPage)
  if (layoutIssues.length > 0) {
    const error = new Error(
      `${scenario.name}/${viewport.name} 布局检查失败：${layoutIssues.join(' | ')}`,
    )
    error.code = 'ERR_MP_CAPTURE_LAYOUT'
    error.issues = layoutIssues
    throw error
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, screenshotName(scenario.name, viewport))
  await page.screenshot({ path: outputPath, fullPage: false })
  return outputPath
}

async function runCapture (options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.TEST_URL)
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR)
  await assertServerReady(baseUrl)

  const browser = await chromium.launch({
    headless: options.headless ?? (process.env.HEADLESS !== 'false'),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const captures = []
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        ...STABLE_CONTEXT_OPTIONS,
        viewport: { width: viewport.width, height: viewport.height },
      })
      await context.addInitScript({ content: buildInitScript() })

      for (const scenario of CAPTURE_SCENARIOS) {
        const page = await context.newPage()
        const runtimeErrors = []
        page.on('pageerror', error => runtimeErrors.push(error.message))
        page.on('console', message => {
          if (message.type() === 'error' && !message.text().includes('[vite]')) {
            runtimeErrors.push(message.text())
          }
        })
        try {
          const outputPath = await captureScenario(page, scenario, viewport, { baseUrl, outputDir })
          if (runtimeErrors.length > 0) {
            throw new Error(`${scenario.name}/${viewport.name} 页面错误：${runtimeErrors.join(' | ')}`)
          }
          captures.push(outputPath)
          console.log(`已捕获 ${scenario.name}/${viewport.name}: ${outputPath}`)
        } finally {
          await page.close()
        }
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
  return captures
}

async function main () {
  const captures = await runCapture()
  console.log(`参考产品当前界面截图完成：${captures.length}/${captures.length}`)
}

if (require.main === module) {
  main().catch(error => {
    console.error(`参考产品当前界面截图失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  CAPTURE_SCENARIOS,
  DEFAULT_BASE_URL,
  DEFAULT_OUTPUT_DIR,
  STABLE_CONTEXT_OPTIONS,
  STABLE_RENDERING_CSS,
  VIEWPORTS,
  assertServerReady,
  captureScenario,
  inspectLayoutInPage,
  normalizeBaseUrl,
  runCapture,
  screenshotName,
}
