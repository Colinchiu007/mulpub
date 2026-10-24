/**
 * UI 视觉巡检 —— 第一步：界面面（surface）自动侦察。
 *
 * 目的：把「所有可能产生不同视觉内容的界面」从人工猜测变成机器枚举，
 * 为后续逐面截图提供完整清单（页面 / 位置 / 操作状态）。
 *
 * 用法：
 *   node tests/visual-testing/scripts/ui-audit-recon.js
 *   BASE_URL=http://127.0.0.1:5174 node tests/visual-testing/scripts/ui-audit-recon.js
 *
 * 产物：tests/visual-testing/reports/ui-audit-recon.json
 */

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')
const { buildInitScript } = require('../../e2e/helpers/fixture-loader')

const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174'
const OUTPUT_DIR = path.resolve(__dirname, '../reports')
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'ui-audit-recon.json')
const READY_TIMEOUT = 20000

/** 与 router/index.js 一一对应的全部路由 */
const ROUTES = [
  { route: '/', name: 'Home' },
  { route: '/comments', name: 'Comments' },
  { route: '/first-run', name: 'FirstRun' },
  { route: '/publish', name: 'Publish' },
  { route: '/publish/history', name: 'PublishHistory' },
  { route: '/accounts', name: 'Accounts' },
  { route: '/dashboard', name: 'Dashboard' },
  { route: '/collection', name: 'Collection' },
  { route: '/automation', name: 'Automation' },
  { route: '/copy-library', name: 'CopyLibrary' },
  { route: '/keywords', name: 'KeywordMonitor' },
  { route: '/viral-analysis', name: 'ViralAnalysis' },
  { route: '/model-providers', name: 'ModelProviders' },
  { route: '/create', name: 'Create' },
  { route: '/member-center', name: 'MemberCenter' },
  { route: '/create/result', name: 'CreateResult' },
  { route: '/cloud-publish', name: 'CloudPublish' },
  { route: '/intelligence', name: 'Intelligence' },
  { route: '/calendar', name: 'Calendar' },
  { route: '/library', name: 'ProjectLibrary' },
  { route: '/board/e2e-project', name: 'ProductionBoard' },
  { route: '/board/e2e-project/contact-sheet', name: 'ContactSheet' },
  { route: '/replay/e2e-project', name: 'ReplayTimeline' },
  { route: '/prompt-eval', name: 'PromptEval' },
  { route: '/video-clone', name: 'VideoClone' },
  { route: '/film-engineering', name: 'FilmEngineeringHub' },
  { route: '/film-engineering/classic', name: 'FilmEngineeringClassic' },
  { route: '/auto-pipeline', name: 'AutoPipeline' },
  { route: '/knowledge-base', name: 'KnowledgeBase' },
  { route: '/performance-insights', name: 'PerformanceInsights' },
  { route: '/rewrite', name: 'Rewrite' },
  { route: '/hot-topics', name: 'HotTopics' },
  { route: '/podcast', name: 'PodcastChannel' },
]

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

/** 在页面上下文中执行的枚举器（所有常量必须内联——该函数会被序列化到浏览器上下文） */
function inspectSurfaces () {
  const TAB_SELECTORS = [
    '[role="tab"]',
    '[role="tabitem"]',
    '.cohere-tab',
    '.history-status-tabs button',
    '.collection-tab-btn',
    '.mp-tab',
    '.tab-btn',
    '[class*="tab-item"]',
    '[class*="tab-btn"]',
    '[class*="-tab"]',
    '[data-testid*="tab"]',
  ]

  const OVERLAY_SELECTORS = [
    '.el-dialog',
    '.el-drawer',
    '.el-popper',
    '.el-message-box',
    '.el-message',
    '.el-notification',
    '.mp-modal',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '.modal-mask',
    '.overlay',
    '.drawer',
    '.popover',
    '.dropdown-menu',
    '.toast',
    '.snackbar',
  ]

  const INPUT_SELECTORS = [
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
  ]

  const BUTTON_SELECTORS = [
    'button',
    '[role="button"]',
    'a.btn',
    '.btn',
    '[class*="button"]',
    '[class*="-btn"]',
    '[data-testid*="button"]',
    '[data-testid*="btn"]',
  ]

  const visible = element => {
    if (!element) return false
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const text = element => (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const cls = element => (typeof element.className === 'string' ? element.className : '').trim().slice(0, 120)

  const collect = (selectors, limit) => {
    const seen = new Set()
    const out = []
    for (const selector of selectors) {
      let nodes = []
      try {
        nodes = Array.from(document.querySelectorAll(selector))
      } catch {
        continue
      }
      for (const node of nodes) {
        if (!visible(node)) continue
        const key = node.tagName + '#' + (node.id || '') + '.' + cls(node) + '|' + text(node)
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          tag: node.tagName.toLowerCase(),
          text: text(node),
          className: cls(node),
          testId: node.getAttribute('data-testid') || '',
          ariaLabel: node.getAttribute('aria-label') || '',
          disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true',
          role: node.getAttribute('role') || '',
          selector: buildSelector(node),
        })
        if (out.length >= limit) return out
      }
    }
    return out
  }

  const buildSelector = node => {
    if (node.id) return `#${node.id}`
    const testId = node.getAttribute('data-testid')
    if (testId) return `[data-testid="${testId}"]`
    const classes = cls(node).split(/\s+/).filter(Boolean).slice(0, 2)
    if (classes.length) return `${node.tagName.toLowerCase()}.${classes.join('.')}`
    return node.tagName.toLowerCase()
  }

  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .filter(visible)
    .slice(0, 8)
    .map(node => ({ level: node.tagName.toLowerCase(), text: text(node) }))

  const body = document.body
  const style = window.getComputedStyle(body)
  const rootStyle = window.getComputedStyle(document.documentElement)

  const colorUsage = (() => {
    const counter = new Map()
    for (const node of Array.from(document.querySelectorAll('*')).slice(0, 6000)) {
      if (!visible(node)) continue
      const nodeStyle = window.getComputedStyle(node)
      for (const prop of ['color', 'backgroundColor', 'borderColor', 'borderTopColor']) {
        const value = nodeStyle[prop]
        if (!value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent') continue
        counter.set(value, (counter.get(value) || 0) + 1)
      }
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([value, count]) => ({ value, count }))
  })()

  const fontUsage = (() => {
    const counter = new Map()
    for (const node of Array.from(document.querySelectorAll('*')).slice(0, 6000)) {
      if (!visible(node)) continue
      const nodeStyle = window.getComputedStyle(node)
      for (const prop of ['fontSize', 'fontFamily', 'fontWeight', 'borderRadius', 'boxShadow', 'lineHeight']) {
        const value = nodeStyle[prop]
        if (!value) continue
        counter.set(value, (counter.get(value) || 0) + 1)
      }
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([value, count]) => ({ value, count }))
  })()

  const radiusUsage = (() => {
    const counter = new Map()
    for (const node of Array.from(document.querySelectorAll('*')).slice(0, 6000)) {
      if (!visible(node)) continue
      const value = window.getComputedStyle(node).borderRadius
      if (!value) continue
      counter.set(value, (counter.get(value) || 0) + 1)
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([value, count]) => ({ value, count }))
  })()

  const spacingUsage = (() => {
    const counter = new Map()
    for (const node of Array.from(document.querySelectorAll('*')).slice(0, 6000)) {
      if (!visible(node)) continue
      const nodeStyle = window.getComputedStyle(node)
      for (const prop of ['padding', 'gap', 'margin']) {
        const value = nodeStyle[prop]
        if (!value) continue
        counter.set(value, (counter.get(value) || 0) + 1)
      }
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 30)
      .map(([value, count]) => ({ value, count }))
  })()

  return {
    url: window.location.hash,
    headings,
    tabs: collect(TAB_SELECTORS, 40),
    overlays: collect(OVERLAY_SELECTORS, 20),
    inputs: collect(INPUT_SELECTORS, 40),
    buttons: collect(BUTTON_SELECTORS, 60),
    metrics: {
      bodyFont: style.fontFamily,
      bodyFontSize: style.fontSize,
      bodyBackground: style.backgroundColor,
      bodyColor: style.color,
      rootFontSize: rootStyle.fontSize,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      elementCount: document.querySelectorAll('*').length,
      visibleElements: Array.from(document.querySelectorAll('*')).filter(visible).length,
    },
    colorUsage,
    fontUsage,
    radiusUsage,
    spacingUsage,
  }
}

async function main () {
  const baseUrl = normalizeBaseUrl(DEFAULT_BASE_URL)
  await assertServerReady(baseUrl)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const context = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 900 },
  })
  await context.addInitScript({ content: buildInitScript() })

  const results = []
  for (const item of ROUTES) {
    const page = await context.newPage()
    const consoleErrors = []
    page.on('pageerror', error => consoleErrors.push(String(error.message || error)))
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().includes('[vite]')) {
        consoleErrors.push(message.text())
      }
    })
    try {
      await page.goto(`${baseUrl}/#${item.route}`, {
        waitUntil: 'domcontentloaded',
        timeout: READY_TIMEOUT,
      })
      await page.waitForFunction(() => {
        const app = document.querySelector('#app')
        return app?.hasAttribute('data-v-app') && (app.textContent || '').trim().length > 0
      }, { timeout: READY_TIMEOUT }).catch(() => {})
      await page.waitForTimeout(1200)
      const data = await page.evaluate(inspectSurfaces)
      results.push({ name: item.name, route: item.route, ok: true, consoleErrors, ...data })
      console.log(`[recon] ${item.name} ${item.route} — tabs:${data.tabs.length} overlays:${data.overlays.length} inputs:${data.inputs.length} buttons:${data.buttons.length}`)
    } catch (error) {
      results.push({ name: item.name, route: item.route, ok: false, error: String(error.message || error), consoleErrors })
      console.log(`[recon] ${item.name} ${item.route} — FAIL ${error.message}`)
    } finally {
      await page.close()
    }
  }
  await context.close()
  await browser.close()

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), results }, null, 2), 'utf8')
  console.log(`\n侦察完成：${OUTPUT_FILE}`)
}

if (require.main === module) {
  main().catch(error => {
    console.error(`侦察失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { ROUTES, inspectSurfaces, normalizeBaseUrl }
