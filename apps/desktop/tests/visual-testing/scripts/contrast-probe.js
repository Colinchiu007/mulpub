// 定点验证：确认 contrast-audit 报出的低对比是真问题还是误报。
//
// 风险点：脚本向上找「第一个 alpha>=0.5 的背景祖先」，若整条链都透明则兜底白色。
// 深色模式下若 body 背景也是深色，兜底就会产生「深字 vs 白底」的假阳性。
// 本脚本对指定选择器直接打印 fg/bg 实值 + 祖先链，验证兜底是否被触发。
const { chromium } = require('playwright-core')
const BASE = process.env.TEST_URL || 'http://127.0.0.1:5188'

async function probe (page, route, selector) {
  return page.evaluate(({ route, selector }) => {
    const parse = s => {
      const m = (s || '').match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/)
      return m ? { s: `rgb(${m[1]},${m[2]},${m[3]})`, a: m[4] === undefined ? 1 : +m[4] } : null
    }
    const el = document.querySelector(selector)
    if (!el) return { found: false }
    const cs = getComputedStyle(el)
    // 打印祖先链背景，判断是否触发兜底
    const chain = []
    let n = el
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n)
      const b = parse(s.backgroundColor)
      chain.push({ tag: n.tagName.toLowerCase(), cls: (n.className || '').toString().slice(0, 40), bg: b ? `${b.s} a=${b.a}` : 'none' })
      n = n.parentElement
    }
    const bodyBg = parse(getComputedStyle(document.body).backgroundColor)
    const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor)
    return {
      found: true,
      text: (el.textContent || '').trim().slice(0, 40),
      color: cs.color,
      chainFoundOpaque: chain.some(c => c.bg !== 'none' && !/a=0$/.test(c.bg)),
      bodyBg: bodyBg ? `${bodyBg.s} a=${bodyBg.a}` : 'none',
      htmlBg: htmlBg ? `${htmlBg.s} a=${htmlBg.a}` : 'none',
      chain: chain.slice(0, 6),
    }
  }, { route, selector })
}

async function main () {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  const CASES = [
    ['publish', '/publish', 'span'],
    // 原为 '.banner-text'（TrialBanner 内文类名）。该组件随 ux-audit-dead-components-retire 撤下后
    // 此选择器在看板页恒 0 命中 —— 探针会打「未找到该选择器」然后跳过（不是假绿，但等于这一档从未被测）。
    // 换成同族的"卡片内小标签文字"：与被撤的横幅同为「深色背景上的小号文字」，对比度量纲一致。
    ['dashboard', '/dashboard', '.stat-label'],
    ['accounts', '/accounts', '.accounts-page'],
    ['home', '/home-not-used', 'h3.mp-home-section-title'],
  ]

  const missed = []
  for (const [name, route, sel] of CASES) {
    const r = route.startsWith('/home-not') ? '/' : route
    await page.goto(BASE + '/#' + r, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(900)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(500)
    const res = await probe(page, route, sel)
    console.log(`\n=== ${name} ${sel} ===`)
    if (!res.found) { console.log(`  未找到该选择器 ${sel}`); missed.push(name + ' ' + sel); continue }
    console.log(`  文本: "${res.text}"`)
    console.log(`  color: ${res.color}`)
    console.log(`  body 背景: ${res.bodyBg}   html 背景: ${res.htmlBg}`)
    console.log(`  祖先链中有不透明背景: ${res.chainFoundOpaque}  ${res.chainFoundOpaque ? '→ 未触发兜底，结果可信' : '→ 触发了白色兜底，可能是假阳性!'}`)
    res.chain.forEach(c => console.log(`    <${c.tag} class="${c.cls}"> bg=${c.bg}`))
  }
  await browser.close()

  // 逐条 continue 会让"跑了 4 条"读起来像"量了 4 条"。缺目标必须**汇总出声并以非零码退出**：
  // 这个脚本是人工诊断入口，它没有断言，唯一的防自欺手段就是退出码与这行汇总。
  console.log(`\n[PROBE-SUMMARY] cases=${CASES.length} measured=${CASES.length - missed.length} missed=${missed.length}`
    + (missed.length ? ' 未量到：' + missed.join(' / ') : ''))
  process.exitCode = missed.length ? 1 : 0
}
main().catch(e => { console.error(e); process.exit(1) })
