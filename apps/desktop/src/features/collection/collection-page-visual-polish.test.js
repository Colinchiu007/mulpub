/**
 * 采集页视觉精致化契约（collection-page-visual-polish，2026-10-20）
 *
 * 本文件锁的是**观感的可量化前提**，不是观感本身。每条断言都对应
 * 01-docs/PRD-COLLECTION-PAGE-VISUAL-POLISH-2026-10-20.md §7 的一条验收标准。
 *
 * 写作原则（承接上一轮的教训）：断言必须是「改动前红、改动后绿」的形状。
 * 上一轮的 dead-class 正则因 `^` 陷阱恒真、前缀表因多余连字符集体失效——
 * 两条门禁都是绿的却什么都没守。所以这里每条对账都先做**正样本自检**，
 * 确保判据本身不会退化成空操作。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const PAGE_CSS = './collection-page.css'
const LEGACY_CSS = './collection-page-legacy.css'
const RESULTS_VUE = './CollectedResultsList.vue'
const COHERE_CSS = '../../styles/cohere-design-system.css'

/** 采集域全部样式（去注释，避免注释里的示例文字让判据误绿） */
const domainCss = () => stripComments(read(PAGE_CSS)) + '\n' + stripComments(read(LEGACY_CSS))

/** 取某个选择器的声明块（同选择器多处出现时合并） */
function blocksOf (css, selector) {
  const out = []
  const re = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g')
  let m
  while ((m = re.exec(css)) !== null) out.push(m[1])
  return out
}

function declOf (css, selector) {
  return blocksOf(css, selector).join('\n')
}

// ───────────────────────── A1 面板饰带必须真删 ─────────────────────────
describe('A1 面板饰带与无限扫光动画', () => {
  it('关键帧 col-panel-ribbon 必须已删除（不是注释掉）', () => {
    // 正样本自检：判据要能匹配到"存在的形态"，否则等于空操作
    expect(stripComments('@keyframes col-panel-ribbon { 0%{} }')).toContain('col-panel-ribbon')

    const css = domainCss()
    expect(css).not.toContain('col-panel-ribbon')
  })

  it('面板不得再通过 ::before 画装饰性色条', () => {
    const css = domainCss()
    // 允许 ::before 存在（可能用于其它语义），但不得同时具备绝对定位+顶部贴边+固定高度
    const before = blocksOf(css, '.col-panel::before').join('\n')
    const isDecorativeRibbon =
      /position:\s*absolute/.test(before) &&
      /top:\s*0/.test(before) &&
      /height:\s*\d+px/.test(before) &&
      /background/.test(before)
    expect(isDecorativeRibbon).toBe(false)
  })

  it('采集域不得保留任何 infinite 循环动画', () => {
    const css = domainCss()
    const infinite = css.match(/animation:[^;]*infinite[^;]*;/g) || []
    expect(infinite, `残留无限动画：${infinite.join(' | ')}`).toHaveLength(0)
  })
})

// ───────────────────────── A2 卡片内按钮高度 ─────────────────────────
describe('A2 卡片内操作按钮尺寸', () => {
  it('min-height 必须走 32px 档（--col-btn-h），不得压到 28px', () => {
    const css = domainCss()
    const decl = declOf(css, '.col-card-actions .col-btn')
    expect(decl, '未找到 .col-card-actions .col-btn 声明').toBeTruthy()
    expect(decl).toMatch(/min-height:\s*var\(--col-btn-h\)|min-height:\s*32px/)
    expect(decl).not.toMatch(/min-height:\s*28px/)
  })

  it('卡片内按钮字号不得小于 13px（12px 在 32px 高度里读起来偏挤）', () => {
    const css = domainCss()
    const decl = declOf(css, '.col-card-actions .col-btn')
    expect(decl).not.toMatch(/font-size:\s*var\(--font-size-xs\)/)
  })
})

// ───────────────────────── A3 标题截断与行高 ─────────────────────────
describe('A3 卡片标题必须 2 行截断且有显式行高', () => {
  const titleDecl = () => {
    // 标题样式由采集域在 cohere 基类上覆盖；两处合并取声明
    return declOf(domainCss(), '.cohere-card .card-platform') ||
           declOf(stripComments(read(COHERE_CSS)), '.cohere-card .card-platform')
  }

  it('必须含 -webkit-line-clamp: 2（长标题不得无限换行）', () => {
    expect(titleDecl()).toMatch(/-webkit-line-clamp:\s*2/)
  })

  it('必须显式声明 line-height（否则行高随全局漂移）', () => {
    expect(titleDecl()).toMatch(/line-height:\s*[\d.]/)
  })

  it('必须同时具备 clamp 三件套（display:-webkit-box + overflow:hidden）', () => {
    const d = titleDecl()
    expect(d).toMatch(/display:\s*-webkit-box/)
    expect(d).toMatch(/overflow:\s*hidden/)
  })

  it('标题必须可承载全文 tooltip（模板里 title 绑定原文）', () => {
    const tpl = read(RESULTS_VUE)
    expect(tpl).toMatch(/:title="item\.title/)
  })
})

// ───────────────────────── A4 间距体系收敛 ─────────────────────────
describe('A4 采集域间距必须落在 4px 刻度上', () => {
  it('不得再使用非刻度值 14px / 2px 作为间距', () => {
    const css = domainCss()
    expect(css).not.toMatch(/\bgap:\s*14px/)
    expect(css).not.toMatch(/\bmargin-top:\s*2px/)
    expect(css).not.toMatch(/\bgap:\s*2px/)
  })

  it('采集域不得引用 --space-* 旧刻度命名空间（应统一到 --spacing-*）', () => {
    const css = domainCss()
    const hits = css.match(/var\(--space-(?:xxs|xs|sm|md|lg|xl|xxl)\)/g) || []
    expect(hits, `发现旧刻度引用：${[...new Set(hits)].join(', ')}`).toHaveLength(0)
  })

  it('必须定义 12px 档卡片内间距常量（供卡片内部复用，避免各写各的）', () => {
    const css = domainCss()
    expect(css).toMatch(/--col-card-gap:\s*var\(--spacing-3\)|--col-card-gap:\s*12px/)
  })
})

// ───────────────────────── A5 无效结果卡状态区分 ─────────────────────────
describe('A5 空/错数据卡必须视觉可分', () => {
  it('模板必须给无效条目挂 col-result-card--invalid 类', () => {
    const tpl = read(RESULTS_VUE)
    expect(tpl).toContain('col-result-card--invalid')
  })

  it('模板必须提供 result-invalid-<id> testid（供视觉/E2E 定位）', () => {
    const tpl = read(RESULTS_VUE)
    expect(tpl).toMatch(/'result-invalid-'\s*\+\s*item\.id/)
  })

  it('无效态必须有真实样式声明（不是只挂类名）', () => {
    const css = domainCss()
    const decl = declOf(css, '.col-result-card--invalid')
    expect(decl).toBeTruthy()
    expect(decl).toMatch(/border|background/)
  })

  it('无效判定必须 fail-safe：标题空白与 0 字都要判入', () => {
    const src = read(RESULTS_VUE)
    expect(src).toMatch(/isInvalidResult/)
    // 判定函数必须同时覆盖 title 空 与 wordCount 0
    expect(src).toMatch(/title/)
    expect(src).toMatch(/wordCount|length/)
  })
})

// ─────────── A5b 无效判定的**行为**断言（不是"函数存在"断言） ───────────
// 来历：本次变异反证实测——把判定改成 `if (false) return true`（恒 false）后，
// 上面那条只查函数名的契约测试**毫无反应**（假绿）。判定有分支就必须断言行为，
// 所以把它抽成 collected-result-validity.js 并在此直接 import。
describe('A5b 无效判定行为（真实样本，非字符串存在性）', () => {
  const cases = [
    { name: '无标题 + 0 字 ⇒ 无效', item: { title: '', wordCount: 0 }, want: true },
    { name: '标题纯空白 + 0 字 ⇒ 无效', item: { title: '   ', wordCount: 0 }, want: true },
    { name: 'title 为 null + wordCount 0 ⇒ 无效', item: { title: null, wordCount: 0 }, want: true },
    { name: "wordCount 为字符串 '0' ⇒ 无效（旧存储形态）", item: { title: '某文', wordCount: '0' }, want: true },
    { name: 'wordCount 缺失但有正文 ⇒ 有效', item: { title: '某文', content: '正文内容' }, want: false },
    { name: 'wordCount 缺失且正文空 ⇒ 无效', item: { title: '某文', content: '' }, want: true },
    { name: '正常条目 ⇒ 有效', item: { title: '某文', wordCount: 3295 }, want: false },
    { name: 'wordCount 为 NaN（脏值）⇒ 无效（fail-closed）', item: { title: '某文', wordCount: NaN }, want: true },
    { name: 'item 为 null ⇒ 有效（不误伤渲染边界）', item: null, want: false },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const { isInvalidResult } = await import('./collected-result-validity')
      expect(isInvalidResult(c.item)).toBe(c.want)
    })
  }
})

// ───────────────────────── A6 可访问性：动效降级 ─────────────────────────
describe('A6 prefers-reduced-motion', () => {
  it('采集域若有动画，必须被 reduced-motion 块覆盖', () => {
    const css = domainCss()
    const animations = [...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1].trim())
    if (animations.length === 0) return // 无动画即天然合规
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

// ───────────────────────── A7 cursor 语义 ─────────────────────────
describe('A7 卡片光标不得承诺未实现的行为', () => {
  it('采集域必须把 .cohere-card 的 pointer 光标还原（卡片本体不可点）', () => {
    const css = domainCss()
    const decl = declOf(css, '.cohere-card')
    expect(decl, '采集域应显式覆盖 .cohere-card 的 cursor').toMatch(/cursor:\s*(?:default|auto)/)
  })
})
