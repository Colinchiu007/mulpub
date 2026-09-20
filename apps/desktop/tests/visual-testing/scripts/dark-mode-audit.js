/**
 * 深色模式走查第二批（P2）：本地 playwright 截图逐视图验证
 *
 * 方法：vite dev 起渲染层 → 每个路由先截 light 再截 dark（data-theme 切换）
 * → 对比 dark 截图中是否残留大面积白色区域（dark 破坏检测）。
 * 输出：tests/visual-testing/reports/dark-audit/*.png + 审计 JSON。
 */
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')

const BASE = process.env.TEST_URL || 'http://127.0.0.1:5174'
const OUT_DIR = path.resolve(__dirname, '../reports/dark-audit')

// 主路由（与 run-pixel-tests 的 17 视图对齐）
const ROUTES = [
  { name: 'home', route: '/' },
  { name: 'accounts', route: '/accounts' },
  { name: 'publish', route: '/publish' },
  { name: 'publish-history', route: '/publish/history' },
  { name: 'create', route: '/create' },
  { name: 'model-providers', route: '/model-providers' },
  { name: 'first-run', route: '/first-run' },
  { name: 'dashboard', route: '/dashboard' },
  { name: 'calendar', route: '/calendar' },
  { name: 'cloud-publish', route: '/cloud-publish' },
  { name: 'viral-analysis', route: '/viral-analysis' },
  { name: 'intelligence', route: '/intelligence' },
  { name: 'collection', route: '/collection' },
  { name: 'hot-topics', route: '/hot-topics' },
  { name: 'copy-library', route: '/copy-library' },
  { name: 'keywords', route: '/keywords' },
  { name: 'comments', route: '/comments' },
  { name: 'member-center', route: '/member-center' },
]

// dark 破坏启发式：截图后统计接近纯白（>= #f0f0f0）像素占比
// dark 模式下画布底色 #1a1a1e，若大面积白说明有未 token 化的浅色残留
async function whiteRatio (page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const w = Math.min(window.innerWidth, 1280)
    const h = Math.min(window.innerHeight, 800)
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    // drawImage 不适用于跨域截图；改用 DOM 遍历启发式：
    // 统计 computed background 接近白的元素面积占比
    // 逐像素采样（4px 网格）避免嵌套重复计面积：读取 body 渲染后的实际颜色
    // 用 elementFromPoint 采样网格点，统计落在白色背景元素上的比例
    let white = 0, total = 0
    const step = 16
    for (let x = 0; x < window.innerWidth; x += step) {
      for (let y = 0; y < window.innerHeight; y += step) {
        total++
        const el = document.elementFromPoint(x, y)
        if (!el) continue
        const cs = getComputedStyle(el)
        const m = (cs.backgroundColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
        if (!m) continue
        const [r, g, b] = [+m[1], +m[2], +m[3]]
        if (r >= 240 && g >= 240 && b >= 240 && (cs.opacity === '' || +cs.opacity > 0.9)) white++
      }
    }
    return total > 0 ? white / total : 0
  })
}

async function main () {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const report = []
  for (const { name, route } of ROUTES) {
    try {
      await page.goto(BASE + '/#' + route, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(800)
      // 强制 dark（绕过 electron store 依赖）
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await page.waitForTimeout(400)
      const ratio = await whiteRatio(page)
      await page.screenshot({ path: path.join(OUT_DIR, `${name}-dark.png`) })
      report.push({ view: name, route, darkWhiteRatio: Number((ratio * 100).toFixed(2)) + '%' })
      console.log(`${name}: dark 白色残留 ${ (ratio * 100).toFixed(2) }%`)
    } catch (e) {
      report.push({ view: name, route, error: e.message.split('\n')[0] })
      console.log(`${name}: ERROR ${e.message.split('\n')[0]}`)
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'dark-audit-report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  // 判定：>15% 视为可疑（需人工看图）
  const suspects = report.filter(r => parseFloat(r.darkWhiteRatio) > 15)
  console.log(`\n[dark-audit] 完成 ${report.length} 视图；可疑（白色残留>15%）：${suspects.length}`)
  if (suspects.length) {
    suspects.forEach(s => console.log('  ⚠ ' + s.view + ' ' + s.darkWhiteRatio))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
