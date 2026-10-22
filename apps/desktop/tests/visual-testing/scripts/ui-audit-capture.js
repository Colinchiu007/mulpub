/**
 * UI 视觉巡检 —— 第二步：全量界面截图巡检。
 *
 * 目标：把「所有可能产生不同视觉内容的界面」都截成图，并标注
 *   页面 / 位置 / 操作状态
 * 覆盖维度：
 *   A. 路由默认态（全部 32 条路由）
 *   B. 页面内标签页（tab）逐个切换
 *   C. 浮层（弹窗 / 抽屉 / 下拉 / 提示条）逐个打开
 *   D. 控件交互态（按钮 hover/focus/disabled、输入框 focus/已填/清空）
 *   E. 主要流程运行结果（发布 / 采集 / 创作 / 流水线）
 *   F. 暗色主题（同路由对照）
 *
 * 产物：
 *   tests/visual-testing/screenshots/ui-audit/<编号>-<slug>.png
 *   tests/visual-testing/reports/ui-audit-manifest.json   （带页面/位置/状态标注）
 *   tests/visual-testing/reports/ui-audit-manifest.md     （人读清单）
 *
 * 用法：
 *   node tests/visual-testing/scripts/ui-audit-capture.js [--phase=a|b|c|d|e|f] [--resume]
 */

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')
const { buildInitScript } = require('../../e2e/helpers/fixture-loader')
const { ROUTES, FLOW_SCENARIOS } = require('./ui-audit-scenes')
const { STABLE_RENDERING_CSS, stabilize, gotoRoute, listTabs, detectOverlay, listInteractive } = require('./ui-audit-probes')

const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174'
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const SHOTS_DIR = path.resolve(__dirname, '../screenshots/ui-audit')
const MANIFEST_JSON = path.join(REPORTS_DIR, 'ui-audit-manifest.json')
const MANIFEST_MD = path.join(REPORTS_DIR, 'ui-audit-manifest.md')
const READY_TIMEOUT = 20000
const VIEWPORT = { width: 1440, height: 900 }

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
    request.on('error', cause => reject(new Error(`Vite 未运行（${baseUrl}）：${cause.message}`)))
  })
}

function slugify (value) {
  const ascii = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || 'x'
}

async function capture (page, state, index, opts = {}) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const id = String(index).padStart(3, '0')
  const file = `${id}-${slugify(state.id)}.png`
  const outputPath = path.join(SHOTS_DIR, file)
  await stabilize(page)
  await page.screenshot({ path: outputPath, fullPage: Boolean(opts.fullPage) })
  const record = {
    index: Number(id),
    id: state.id,
    file,
    route: state.route,
    area: state.area,
    page: state.page,
    position: state.position,
    state: state.state,
    theme: opts.theme || 'light',
    viewport: opts.viewport || `${VIEWPORT.width}x${VIEWPORT.height}`,
    note: state.note || '',
  }
  console.log(`  [${id}] ${record.area} / ${record.position} / ${record.state}`)
  return record
}

async function main () {
  const argv = process.argv.slice(2)
  const phaseArg = argv.find(a => a.startsWith('--phase='))
  const phases = phaseArg
    ? phaseArg.split('=')[1].split(',').map(s => s.trim().toLowerCase())
    : ['a', 'b', 'c', 'd', 'e', 'f']
  const resume = argv.includes('--resume')

  const baseUrl = normalizeBaseUrl(DEFAULT_BASE_URL)
  await assertServerReady(baseUrl)

  fs.mkdirSync(REPORTS_DIR, { recursive: true })
  fs.mkdirSync(SHOTS_DIR, { recursive: true })

  let manifest = []
  if (resume && fs.existsSync(MANIFEST_JSON)) {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf8'))
  }
  const taken = new Set(manifest.map(item => item.id))
  let counter = manifest.length

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
    viewport: VIEWPORT,
  })
  await context.addInitScript({ content: buildInitScript() })

  const push = async (page, state, opts) => {
    const id = state.id
    if (taken.has(id)) return null
    counter += 1
    const record = await capture(page, state, counter, opts)
    manifest.push(record)
    taken.add(id)
    fs.writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 2), 'utf8')
    return record
  }

  try {
    // ---- Phase A：全部路由默认态 ----
    if (phases.includes('a')) {
      console.log('\n=== Phase A：路由默认态 ===')
      for (const item of ROUTES) {
        const page = await context.newPage()
        try {
          await gotoRoute(page, baseUrl, item.route)
          await push(page, {
            id: `a-${item.name}`,
            route: item.route,
            area: item.area,
            page: item.name,
            position: '页面主体（默认态）',
            state: '初始加载完成、无浮层',
          })
        } catch (error) {
          console.log(`  [A/${item.name}] FAIL ${error.message}`)
        } finally {
          await page.close()
        }
      }
    }

    // ---- Phase B：逐标签页 ----
    if (phases.includes('b')) {
      console.log('\n=== Phase B：标签页 ===')
      for (const item of ROUTES) {
        const page = await context.newPage()
        try {
          await gotoRoute(page, baseUrl, item.route)
          const tabs = await listTabs(page)
          let tabIndex = 0
          for (const tab of tabs) {
            if (!tab.text || tab.text.length < 2) continue
            if (/^(全部|all)$/i.test(tab.text)) continue
            tabIndex += 1
            if (tabIndex > 12) break
            try {
              const locator = page.locator('[role="tab"], [role="tabitem"], .cohere-tab, .history-status-tabs button, .collection-tab-btn, .mp-tab, .tab-btn, [class*="tab-item"], [class*="tab-btn"], [class*="-tab"], [data-testid*="tab"]').filter({ hasText: tab.text }).first()
              if (!(await locator.count())) continue
              await locator.scrollIntoViewIfNeeded().catch(() => {})
              await locator.click({ timeout: 4000 })
              await page.waitForTimeout(900)
              await push(page, {
                id: `b-${item.name}-${slugify(tab.text)}`,
                route: item.route,
                area: item.area,
                page: item.name,
                position: `页面内标签「${tab.text}」`,
                state: '标签切换后的内容区',
              })
            } catch (error) {
              console.log(`  [B/${item.name}/${tab.text}] FAIL ${error.message}`)
            }
          }
        } catch (error) {
          console.log(`  [B/${item.name}] FAIL ${error.message}`)
        } finally {
          await page.close()
        }
      }
    }

    // ---- Phase C：浮层 ----
    if (phases.includes('c')) {
      console.log('\n=== Phase C：浮层 ===')
      for (const item of ROUTES) {
        const page = await context.newPage()
        try {
          await gotoRoute(page, baseUrl, item.route)
          // 穷举式探测：逐个点击页面上的按钮，看是否弹出浮层。
          // 相比按按钮文案猜（第一版只命中 3 个），穷举能覆盖
          // 「登录/绑定/筛选/展开/详情」等各类真实入口。
          const buttonCount = await page.evaluate(() => {
            const visible = el => {
              const s = window.getComputedStyle(el)
              if (s.display === 'none' || s.visibility === 'hidden') return false
              const r = el.getBoundingClientRect()
              return r.width > 12 && r.height > 12 && r.top >= 0 && r.top < window.innerHeight - 4
            }
            return Array.from(document.querySelectorAll('button, [role="button"]'))
              .filter(visible)
              .filter(b => !b.disabled && !b.getAttribute('aria-disabled'))
              .slice(0, 14)
              .length
          })
          let tried = 0
          for (let index = 0; index < buttonCount && tried < 14; index += 1) {
            const beforeHash = await page.evaluate(() => window.location.hash)
            const label = await page.evaluate((i) => {
              const visible = el => {
                const s = window.getComputedStyle(el)
                if (s.display === 'none' || s.visibility === 'hidden') return false
                const r = el.getBoundingClientRect()
                return r.width > 12 && r.height > 12 && r.top >= 0 && r.top < window.innerHeight - 4
              }
              const list = Array.from(document.querySelectorAll('button, [role="button"]'))
                .filter(visible)
                .filter(b => !b.disabled && !b.getAttribute('aria-disabled'))
                .slice(0, 14)
              const node = list[i]
              if (!node) return null
              return ((node.textContent || '').replace(/\s+/g, ' ').trim() || node.getAttribute('aria-label') || node.getAttribute('data-testid') || 'icon-button').slice(0, 30)
            }, index)
            if (!label) continue
            tried += 1
            try {
              const locator = page.locator('button, [role="button"]').nth(index)
              await locator.scrollIntoViewIfNeeded().catch(() => {})
              await locator.click({ timeout: 4000 })
              await page.waitForTimeout(800)
              const overlay = await detectOverlay(page)
              if (overlay) {
                await push(page, {
                  id: `c-${item.name}-${slugify(label)}`,
                  route: item.route,
                  area: item.area,
                  page: item.name,
                  position: `「${label}」触发的浮层（${overlay.selector}）`,
                  state: '浮层打开态',
                })
              }
              await page.keyboard.press('Escape').catch(() => {})
              await page.waitForTimeout(300)
              const afterHash = await page.evaluate(() => window.location.hash)
              if (afterHash !== beforeHash) {
                await page.goto(`${baseUrl}/#${beforeHash.replace('#', '')}`, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT }).catch(() => {})
                await page.waitForTimeout(900)
              }
            } catch (error) {
              console.log(`  [C/${item.name}/${label}] FAIL ${error.message}`)
            }
          }
        } catch (error) {
          console.log(`  [C/${item.name}] FAIL ${error.message}`)
        } finally {
          await page.close()
        }
      }
    }

    // ---- Phase D：控件交互态 ----
    if (phases.includes('d')) {
      console.log('\n=== Phase D：控件交互态 ===')
      for (const item of ROUTES) {
        const page = await context.newPage()
        try {
          await gotoRoute(page, baseUrl, item.route)
          const { buttons, inputs } = await listInteractive(page)

          // D1 主按钮 hover
          const primary = buttons.find(b => !b.disabled && b.text && b.text.length > 1)
          if (primary) {
            try {
              await page.mouse.move(primary.rect.x, primary.rect.y)
              await page.waitForTimeout(450)
              await push(page, {
                id: `d-${item.name}-btn-hover`,
                route: item.route,
                area: item.area,
                page: item.name,
                position: `按钮「${primary.text || primary.testId || primary.className}」`,
                state: 'hover 悬停态',
              })
            } catch (error) { console.log(`  [D-hover/${item.name}] FAIL ${error.message}`) }
          }

          // D2 输入框 focus + 已填写
          const textInput = inputs.find(i => !i.disabled && i.text)
          if (textInput) {
            try {
              // 用 JS 枚举定位真正可见的输入框，避免 Playwright 的
              // filter({hasNot}) 语义把候选集清空（实测第一版取不到任何输入框）。
              const handle = await page.evaluateHandle(() => {
                const visible = el => {
                  const s = window.getComputedStyle(el)
                  if (s.display === 'none' || s.visibility === 'hidden') return false
                  const r = el.getBoundingClientRect()
                  return r.width > 8 && r.height > 8 && r.top >= 0 && r.top < window.innerHeight - 4
                }
                const nodes = Array.from(document.querySelectorAll(
                  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]',
                ))
                return nodes.find(n => visible(n) && !n.disabled) || null
              })
              const element = handle.asElement()
              if (element) {
                await element.scrollIntoViewIfNeeded().catch(() => {})
                await element.click({ timeout: 4000 })
                await page.waitForTimeout(500)
                await push(page, {
                  id: `d-${item.name}-input-focus`,
                  route: item.route,
                  area: item.area,
                  page: item.name,
                  position: `输入框「${textInput.text}」`,
                  state: 'focus 聚焦态（焦点环）',
                })
                await element.fill('示例内容：用于视觉巡检的填充文本').catch(() => {})
                await page.waitForTimeout(500)
                await push(page, {
                  id: `d-${item.name}-input-filled`,
                  route: item.route,
                  area: item.area,
                  page: item.name,
                  position: `输入框「${textInput.text}」`,
                  state: '已填写态',
                })
              } else {
                console.log(`  [D-input/${item.name}] 页面上没有可见可输入控件`)
              }
            } catch (error) { console.log(`  [D-input/${item.name}] FAIL ${error.message}`) }
          }

          // D3 disabled 控件
          const disabledButton = buttons.find(b => b.disabled)
          if (disabledButton) {
            try {
              await page.mouse.move(disabledButton.rect.x, disabledButton.rect.y)
              await page.waitForTimeout(400)
              await push(page, {
                id: `d-${item.name}-btn-disabled`,
                route: item.route,
                area: item.area,
                page: item.name,
                position: `按钮「${disabledButton.text || disabledButton.className}」`,
                state: 'disabled 禁用态',
              })
            } catch (error) { console.log(`  [D-disabled/${item.name}] FAIL ${error.message}`) }
          }
        } catch (error) {
          console.log(`  [D/${item.name}] FAIL ${error.message}`)
        } finally {
          await page.close()
        }
      }
    }

    // ---- Phase E：主要流程运行结果 ----
    if (phases.includes('e')) {
      console.log('\n=== Phase E：主要流程运行结果 ===')
      for (const scenario of FLOW_SCENARIOS) {
        const page = await context.newPage()
        try {
          await gotoRoute(page, baseUrl, scenario.route)
          const ok = await scenario.action(page)
          if (!ok) {
            console.log(`  [E/${scenario.id}] 未命中触发元素，跳过`)
            continue
          }
          await push(page, {
            id: `e-${scenario.id}`,
            route: scenario.route,
            area: scenario.area,
            page: scenario.area,
            position: scenario.position,
            state: scenario.state,
          })
        } catch (error) {
          console.log(`  [E/${scenario.id}] FAIL ${error.message}`)
        } finally {
          await page.close()
        }
      }
    }

    // ---- Phase F：暗色主题对照 ----
    if (phases.includes('f')) {
      console.log('\n=== Phase F：暗色主题 ===')
      const darkContext = await browser.newContext({
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'zh-CN',
        reducedMotion: 'reduce',
        timezoneId: 'Asia/Shanghai',
        viewport: VIEWPORT,
      })
      await darkContext.addInitScript({ content: buildInitScript() })
      await darkContext.addInitScript(() => {
        try {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.classList.add('dark')
          })
        } catch {}
      })
      for (const item of ROUTES) {
        const page = await darkContext.newPage()
        try {
          await gotoRoute(page, baseUrl, item.route)
          await page.evaluate(() => document.documentElement.classList.add('dark'))
          await page.waitForTimeout(500)
          await push(page, {
            id: `f-${item.name}-dark`,
            route: item.route,
            area: item.area,
            page: item.name,
            position: '页面主体（默认态）',
            state: '暗色主题对照',
          }, { theme: 'dark' })
        } catch (error) {
          console.log(`  [F/${item.name}] FAIL ${error.message}`)
        } finally {
          await page.close()
        }
      }
      await darkContext.close()
    }
  } finally {
    await context.close()
    await browser.close()
  }

  // ---- 清单 ----
  const md = []
  md.push('# UI 视觉巡检截图清单')
  md.push('')
  md.push(`- 生成时间：${new Date().toISOString()}`)
  md.push(`- 截图总数：${manifest.length}`)
  md.push(`- 输出目录：\`${path.relative(process.cwd(), SHOTS_DIR)}\``)
  md.push('')
  md.push('| # | 区域 | 页面 | 位置 | 操作状态 | 主题 | 路由 | 文件 |')
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const item of manifest) {
    md.push(`| ${item.index} | ${item.area} | ${item.page} | ${item.position} | ${item.state} | ${item.theme} | \`${item.route}\` | ${item.file} |`)
  }
  fs.writeFileSync(MANIFEST_MD, md.join('\n'), 'utf8')
  fs.writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`\n巡检完成：${manifest.length} 张截图`)
  console.log(`清单：${MANIFEST_MD}`)
}

if (require.main === module) {
  main().catch(error => {
    console.error(`巡检失败：${error.message}\n${error.stack}`)
    process.exitCode = 1
  })
}

module.exports = { ROUTES, FLOW_SCENARIOS, detectOverlay, listTabs, listInteractive }

module.exports = { ROUTES, FLOW_SCENARIOS, detectOverlay, listTabs, listInteractive }
