/**
 * color-token-reader 的行为锁（本模块是"对比度判据的唯一实现"，它自己坏了会让所有下游判据恒真）
 *
 * 为什么单独一份：`Accounts.text-contrast.test.js` 里那些 AA 判据全部**消费**本模块，
 * 所以本模块任何一处退化（扫块漏一段、var 链断掉、亮度公式改错、阈值档位丢）在下游只会表现为
 * "缺陷变少"或"解析不出"，而不是"实现坏了"。锁必须打在机制本身。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadThemes, resolveColor, resolveLength, contrast, luminance, scanStyleRules, needFor, effectiveBg,
  surfaceCandidates,
} from './color-token-reader'

const TOKENS = `
/* 注释里压着一段 :root 形状的文字 { --x: #000000; } 必须被剥掉，否则整块读不出来 */
:root {
  --color-bg-inset: #faf6f8;
  --color-text-primary: #1e1b4b;
  --color-text-secondary: #707080;
  --font-size-lg: 20px;
  --font-size-sm: 13px;
}
[data-theme="dark"] {
  --color-bg-inset: #1e1e23;
  --color-text-primary: #e8e8ed;
}
html[data-theme="dark"] .page-title { color: #123456; }
`
const themes = loadThemes(TOKENS)

describe('color-token-reader', () => {
  it('注释不得吃掉根块（剥注释是逐块扫描的前提）', () => {
    expect(themes.light.get('--color-bg-inset')).toBe('#faf6f8')
    expect(themes.light.get('--x'), '注释内的 { --x: … } 不得进槽表').toBeUndefined()
    expect(themes.light.size, '槽位数量是解析是否退化的现场读数').toBe(5)
  })

  it('暗色根块两种写法都要认，而带后代选择器的覆盖块不得当槽位', () => {
    expect(themes.dark.get('--color-bg-inset'), '[data-theme="dark"] 无 html 前缀必须认').toBe('#1e1e23')
    expect(themes.dark.get('--color-text-primary')).toBe('#e8e8ed')
    expect(themes.dark.get('--color-text-secondary'), '暗色未覆盖的槽必须继承浅色值').toBe('#707080')
    expect(themes.dark.get('--mp-anything'), 'html[data-theme=dark] .page-title 这类覆盖块不得进槽表').toBeUndefined()
  })

  it('var 链要能穿透两跳，断链时返回 null 而不是静默回退', () => {
    const chain = loadThemes(':root { --a: var(--b); --b: #ff0000; --c: var(--missing, #00ff00); }')
    expect(resolveColor('var(--a)', chain.light)).toBe('#ff0000')
    expect(resolveColor('var(--c)', chain.light)).toBe('#00ff00')
    expect(resolveColor('var(--nope)', chain.light)).toBeNull()
    expect(resolveColor('var(--loop)', loadThemes(':root { --loop: var(--loop); }').light), '自引用必须收敛为 null').toBeNull()
  })

  it('声明写成一行也必须全部读到（行首锚定的正则会只读出第一条，其余静默失踪）', () => {
    const oneLine = loadThemes(':root { --a: #111111; --b: #222222; --c: #333333; }')
    expect([...oneLine.light.keys()], '三条都要进槽表').toEqual(['--a', '--b', '--c'])
    expect(resolveColor('var(--c)', oneLine.light)).toBe('#333333')
  })

  it('不覆盖的形态必须返回 null（不得当成"通过"）', () => {
    const t = loadThemes(':root { --x: #ffffff; }')
    for (const v of ['rgba(0,0,0,.5)', 'rgb(0 0 0)', 'currentColor', 'inherit', 'transparent', '#12345']) {
      expect(resolveColor(v, t.light), `${v} 不该被解析成颜色`).toBeNull()
    }
    expect(contrast('#000000', 'rgba(0,0,0,.5)'), '比值任一输入解析不出必须 null').toBeNull()
  })

  it('WCAG 相对亮度比取已知真值（公式退化时这里先红）', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6)
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 6)
    expect(luminance('#808080')).toBeGreaterThan(luminance('#7f7f7f'))
  })

  it('resolveLength：token 要解析成数字，非 px/rem 不得当成 0', () => {
    expect(resolveLength('var(--font-size-lg)', themes.light)).toBe(20)
    expect(resolveLength('14px', themes.light)).toBe(14)
    expect(resolveLength('0.875rem', themes.light)).toBe(14)
    expect(resolveLength('var(--font-size-sm)', themes.light)).toBe(13)
    expect(resolveLength('medium', themes.light)).toBeNull()
    expect(resolveLength(undefined, themes.light)).toBeNull()
  })

  it('needFor：大字号/粗体/图标三档按实测取，读不到字号一律按正文档', () => {
    expect(needFor('.t', { 'font-size': 'var(--font-size-lg)', 'font-weight': '700' }, themes.light), '20px 且 700 ⇒ 大文本 3:1').toBe(3)
    expect(needFor('.t', { 'font-size': 'var(--font-size-lg)' }, themes.light), '20px 常规字重不是大文本 ⇒ 正文档（WCAG：18.66px 需加粗；24px 才免加粗）').toBe(4.5)
    expect(needFor('.t', { 'font-size': '26px' }, themes.light), '26px 常规字重 ⇒ 大文本 3:1').toBe(3)
    expect(needFor('.x', { 'font-size': 'var(--font-size-sm)', 'font-weight': '700' }, themes.light), '13px 粗体不足 14px ⇒ 仍正文档').toBe(4.5)
    expect(needFor('.x', { 'font-size': '14px', 'font-weight': 'bold' }, themes.light), '14px 粗体**不是**大文本：WCAG 的加粗档是 18.66px=14pt，14px=10.5pt ⇒ 正文档（第 1 版把这条写成 3:1，是把 pt 当成 px 的误读，本行由 M6 变异与评审 Warning#3 共同逼出）').toBe(4.5)
    expect(needFor('.x', { 'font-size': '18.66px', 'font-weight': 'bold' }, themes.light), '18.66px + 粗体 ⇒ 大文本').toBe(3)
    expect(needFor('.x', { 'font-size': '14px', 'font-weight': '500' }, themes.light)).toBe(4.5)
    expect(needFor('.search-icon', {}, themes.light), '非文本 UI 组件 3:1').toBe(3)
    expect(needFor('.x', { 'font-size': '12px' }, themes.light)).toBe(4.5)
    expect(needFor('.x', {}, undefined), '没有主题时不得凭空判成大文本档').toBe(4.5)
  })

  it('effectiveBg：规则自带底色优先，解析不出才回落页面底色，两者皆无 ⇒ null', () => {
    expect(effectiveBg({ background: '#5048e5' }, themes.light, '#faf6f8')).toBe('#5048e5')
    expect(effectiveBg({ background: 'rgba(0,0,0,.2)' }, themes.light, '#faf6f8'), '自带底色解析不出必须回落到页面底色而不是 null').toBe('#faf6f8')
    expect(effectiveBg({}, themes.light, '#faf6f8')).toBe('#faf6f8')
    expect(effectiveBg({}, themes.light, null)).toBeNull()
  })

  it('scanStyleRules：必须遍历每一个 style 块（漏一块 = 整块从判据里静默消失）', () => {
    const src = [
      '<template><p class="a">x</p></template>',
      '<style scoped>.a { color: #111111; font-size: 20px; }</style>',
      '<style>.b { color: #222222; background: #333333; }</style>',
    ].join('\n')
    const out = scanStyleRules(src)
    expect(out.map((r) => r.selector), '两块 style 都要有输出').toEqual(['.a', '.b'])
    expect(out[0].decls.color).toBe('#111111')
    expect(out[1].decls.background).toBe('#333333')
    expect(scanStyleRules('<template>没有 style</template>').length, '无 style 块时返回空数组，不是抛错').toBe(0)
  })

  it('扫描器要把带注释前缀与多行的块也认下来（解析退化最常见的两种形态）', () => {
    const src = '<style>\n/* 头部说明 */\n.foo { color: #aaaaaa; }\n.multi {\n  color: #bbbbbb;\n  font-size: 12px;\n}\n</style>'
    const out = scanStyleRules(src)
    expect(out.length).toBe(2)
    expect(out.find((r) => r.selector === '.multi').decls.color).toBe('#bbbbbb')
  })
})

describe('color-token-reader 的第二批判据（QM-6 逻辑轴命中的三种形状）', () => {
  it('带 !important 的声明必须剥掉后再解析（否则生效的底色被读成"判据不覆盖"）', () => {
    const t = loadThemes(':root { --bg: #ffffff; }')
    expect(resolveColor('#fff !important', t.light), '值尾部的 !important 是声明强度，不是"读不出"').toBe('#ffffff')
    expect(resolveColor('var(--bg) !important', t.light), 'token + !important 同样要能解析').toBe('#ffffff')
    const site = { background: '#fff !important' }
    expect(effectiveBg(site, t.light, '#1e1e23'), '自带底色解析得出时绝不允许回落到页面底色').toBe('#ffffff')
    expect(surfaceCandidates('.x', site, new Map(), t.light, '#1e1e23').length).toBe(1)
  })

  it('background: transparent 不是"读不出的底色"，而是"我没有底色"', () => {
    const t = loadThemes(':root { --bg: #ffffff; }')
    const cand = surfaceCandidates('.clear-search', { background: 'transparent' }, new Map(), t.light, '#faf6f8')
    expect(cand.length, 'transparent 必须落到页面底色候选，而不是自己占一个解析不出的格子').toBe(1)
    expect(cand[0].hex).toBe('#faf6f8')
    expect(/页面底色|transparent/.test(cand[0].from), `出声要写清是哪种回落：${cand[0].from}`).toBeTruthy()
  })

  it('必须遍历每一个 style 块，且嵌套进 @media 的规则不得从判据里消失', () => {
    const src = [
      '<style>',
      '/* 说明 */ .a { color: #111111; }',
      '@media (max-width: 1100px) {',
      '  .b { color: #222222; }',
      '}',
      '</style>',
      '<style scoped>.c { color: #333333; }</style>',
    ].join('\n')
    const out = scanStyleRules(src)
    // 嵌套在 at-rule 里的规则，选择器会带上祖先串 —— 这是**故意**的：
    // 否则"把某条已登记的规则挪进 @media"会让它从判据里安静消失（陈旧登记锁也点不到火）。
    expect(out.map((r) => r.selector).sort()).toEqual([
      '.a', '.c', '@media (max-width: 1100px) .b',
    ])
    expect(out.find((r) => r.selector.endsWith(' .b')).decls.color).toBe('#222222')
    expect(out.every((r) => r.decls.color), '体内声明不得丢').toBe(true)
    expect(out.map((r) => r.decls.color).sort()).toEqual(['#111111', '#222222', '#333333'])
  })
})

describe('对比度公式的收敛欠账（可维护性轴 Q1/Q2 命中的"五套并存"）', () => {
  // 评审指出：本仓有四份测试各自内联了 WCAG 公式，而新 reader 只被 Accounts 判据消费 ⇒
  // 公式其实**五套并存**，收紧一次判据要改五处。我不在本批收敛它们（那属"改谁来守门"），
  // 但把现状钉成只能缩小的棘轮：清单里的文件名必须**仍**自带公式，收敛掉一个就删一个。
  // ⛔ 扫描域如实写成 `src/styles/*.test.js`（同级目录逐个读，不递归）——
  // 域外的内联副本本条看不见，所以这条**不是**"全仓只剩 4 份"的断言，只是本目录的存量账。
  const LEGACY_COPIES = [
    'tokens.slots.test.js',
    'tokens.aliases.test.js',
    'sidebar.tokens.test.js',
    'ep-theme.tokens.test.js',
  ]
  const HERE2 = path.dirname(fileURLToPath(import.meta.url))
  function findInlineCopies () {
    const out = []
    for (const e of fs.readdirSync(HERE2, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.test.js') || e.name === 'color-token-reader.test.js') continue
      const s = fs.readFileSync(path.join(HERE2, e.name), 'utf8')
      if (/function\s+contrast\s*\(/.test(s) || /0\.2126/.test(s)) out.push(e.name)
    }
    return out.sort()
  }
  const copies = findInlineCopies()

  it('扫描域非空：命中数必须大于 0（为 0 说明本判据自己失效了，而不是"已收敛干净"）', () => {
    expect(copies.length, `只扫到 ${copies.length} 份内联公式 ⇒ 判据失效，必须先看扫描实现`).toBeGreaterThan(0)
  })

  it('内联公式清单只能缩小，且登记的每一项必须仍然自带公式', () => {
    expect(copies.length, `当前 ${copies.length} 份，上界只能随真实收敛下调`).toBeLessThanOrEqual(LEGACY_COPIES.length)
    const gone = LEGACY_COPIES.filter((n) => !copies.includes(n))
    expect(gone, `已收敛却还挂在清单上（陈旧登记）：${gone.join(', ')} ⇒ 请同次从清单删除`).toEqual([])
  })

  it('新写判据不得再抄一份公式：凡 import 本模块的测试都不得自带 contrast', () => {
    const offenders = copies.filter((n) => {
      const s = fs.readFileSync(path.join(HERE2, n), 'utf8')
      return /color-token-reader|text-contrast-sites/.test(s)
    })
    expect(offenders, `既 import 共享实现又自带公式：${offenders.join(', ')}`).toEqual([])
  })
})
