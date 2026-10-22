/**
 * 快速预览：只截指定路由，用于改造过程中的即时视觉反馈。
 * 用法：node tests/visual-testing/scripts/ui-audit-preview.js / /dashboard
 */
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const { buildInitScript } = require('../../e2e/helpers/fixture-loader')

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5174'
const OUT = path.resolve(__dirname, '../screenshots/ui-preview')
const routes = process.argv.slice(2).filter(a => a.startsWith('/'))
const theme = process.env.THEME === 'dark' ? 'dark' : 'light'

async function main () {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  })
  await context.addInitScript({ content: buildInitScript() })
  for (const route of routes) {
    const page = await context.newPage()
    await page.goto(`${BASE}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForFunction(() => {
      const app = document.querySelector('#app')
      return app?.hasAttribute('data-v-app') && (app.textContent || '').trim().length > 0
    }, { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1400)
    if (theme === 'dark') {
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      await page.waitForTimeout(400)
    }
    await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}' })
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    const file = path.join(OUT, `${route.replace(/\W+/g, '_') || 'home'}${theme === 'dark' ? '-dark' : ''}.png`)
    await page.screenshot({ path: file })
    console.log(file)
    await page.close()
  }
  await context.close()
  await browser.close()
}

main().catch(e => { console.error(e.message); process.exit(1) })
