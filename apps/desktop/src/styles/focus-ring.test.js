// 键盘焦点环合同（实施方案阶段 3.6 子集 / audit-25 / WCAG 2.4.7 Focus Visible）
//
// 这个文件存在的理由不是"证明我写了 CSS"，而是挡住三类静默失效：
//  1) 只给基类写规则：实测本仓 131 处按钮 class 全部只带变体类（class="cohere-btn-primary"），
//     一个都不带 cohere-btn —— 只写 .cohere-btn:focus-visible 在源码里看起来"已经修了"，
//     对真实按钮却是零覆盖。因此变体域必须**从模板清点得出**再逐个回查选择器，禁止硬编码清单。
//  2) 规则被别的声明吃掉：任何针对同一按钮类的 outline:none 都会静默取消焦点指示。
//  3) 双轨漂移：焦点色只能有一个真源（tokens.css 的 --color-focus-ring），
//     历史死槽 --focus-blue（两档声明、零消费者）由本锁钉住不得复活。
//
// 判据域与规模下界都会打印，扫描器退化成空集合时当场红（"零个变体"读起来完全像"零个问题"）。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { contrast } from './color-token-reader'

const SRC = path.resolve(__dirname, '..')
const TOKENS = path.join(SRC, 'styles/tokens.css')
const COHERE = path.join(SRC, 'styles/cohere-design-system.css')
const UI_BUTTON = path.join(SRC, 'components/UiButton.vue')

const RING = '--color-focus-ring'

function read(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
}

/** 收集 .vue / .css 里所有 `<selector>{...}` 规则块（花括号配平，跳过字符串外注释里的花括号） */
function ruleBlocks(css) {
  const blocks = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) break
    // 选择器 = 上一个 `}` 或文件开头到 open 之间的文本（去掉注释）
    const prevClose = css.lastIndexOf('}', open)
    let selector = css.slice(prevClose === -1 ? 0 : prevClose + 1, open)
    selector = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    blocks.push({ selector, body: css.slice(open + 1, j - 1) })
    i = j
  }
  return blocks
}

/**
 * 模板里挂在**可触发元素**上的按钮类。
 *
 * 判据是"这个类挂在什么元素上"，不是"类名长什么样"：
 *  - `<button class="cohere-btn-text">` ⇒ 是按钮（AutomationView 实测 3 处，且它不在设计系统的
 *    变体清单里 —— 本锁第一次运行就是靠这条把它抓出来的）
 *  - `<span class="ui-btn-spinner">` ⇒ 是按钮内部的装饰节点（aria-hidden、不可聚焦），不算
 *  - `<div class="cohere-btn-*" @click>` ⇒ 属阶段 4.4（非 button 点击元素），不在本判据域内
 */
function templateButtonClasses(rootDir) {
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) files.push(p)
    }
  }
  walk(rootDir)
  const used = new Map() // class 名 -> 使用处数
  let attrCount = 0
  for (const f of files) {
    const src = read(f)
    const tplEnd = src.indexOf('</template>')
    const tpl = tplEnd > 0 ? src.slice(0, tplEnd) : src
    for (const m of tpl.matchAll(/<(button|a|div|span|li|label|input|svg)\b([^>]*)>/gi)) {
      const tag = m[1].toLowerCase()
      const attrs = m[2]
      const cls = attrs.match(/(?:^|\s):?class="([^"]*)"/)
      if (!cls) continue
      const isButton = tag === 'button' || tag === 'a' || /role="button"/.test(attrs)
      if (!isButton) continue
      const btn = cls[1].trim().split(/\s+/).filter((t) => /^(cohere|ui)-btn(-.*)?$/.test(t))
      if (btn.length === 0) continue
      attrCount++
      for (const b of btn) used.set(b, (used.get(b) || 0) + 1)
    }
  }
  return { used, attrCount, files: files.length }
}

function selectorsEndingWith(cssFile, cls) {
  return ruleBlocks(read(cssFile)).filter((b) =>
    b.selector.split(',').some((s) => s.trim().endsWith(`.${cls}:focus-visible`)))
}

describe('键盘焦点环合同（阶段 3.6 / audit-25 / WCAG 2.4.7）', () => {
  const { used, attrCount, files } = templateButtonClasses(SRC)
  const variants = [...used.keys()].filter((k) => k !== 'cohere-btn' && k !== 'ui-btn').sort()
  console.log(`[focus-ring] vue=${files} classAttrs=${attrCount} 按钮类=${used.size} 变体=${variants.length}`)
  console.log(`[focus-ring] 变体清单: ${variants.join(', ')}`)

  it('清点域非空且有规模下界（扫描器退化时"零变体"会读起来像零问题）', () => {
    expect(files).toBeGreaterThan(100)
    expect(attrCount).toBeGreaterThanOrEqual(100)
    expect(variants.length).toBeGreaterThanOrEqual(3)
  })

  it('--color-focus-ring 在浅色与暗色两个块内各声明恰一次', () => {
    const css = read(TOKENS)
    const root = css.slice(css.indexOf(':root'), css.indexOf('[data-theme="dark"]'))
    const dark = css.slice(css.indexOf('[data-theme="dark"]'))
    expect(root.split(RING).length - 1).toBe(1)
    expect(dark.split(RING).length - 1).toBe(1)
  })

  it('焦点环取值必须是 token 引用而非硬编码 hex（两档都核）', () => {
    for (const b of ruleBlocks(read(TOKENS))) {
      const decl = b.body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(`${RING}:`))
      if (decl.length === 0) continue
      for (const d of decl) {
        expect(d, `声明应引用语义槽：${d}`).toContain('var(')
        expect(d).not.toMatch(/#[0-9a-fA-F]{3,8}/)
      }
    }
  })

  it('暗色档不得省略（省略即继承浅色 #603af9，暗底上不足 3:1 等于没有焦点指示）', () => {
    const darkBlock = read(TOKENS).slice(read(TOKENS).indexOf('[data-theme="dark"]'))
    const m = darkBlock.match(/--color-focus-ring:\s*var\((--[\w-]+)\)/)
    expect(m, '暗色块内必须显式声明 --color-focus-ring').not.toBeNull()
    expect(m[1]).toBe('--color-primary-dark-tint')
  })

  it('模板里实际使用的每一个按钮类都必须有 :focus-visible 规则（不得只写基类）', () => {
    // 不按类名前把规则"分配"给某个文件（那会把"写在另一个文件里"误判成缺失），
    // 而是要求：两处样式源里至少有一处为该类声明了焦点环。
    const missing = []
    for (const cls of used.keys()) {
      const covered = selectorsEndingWith(COHERE, cls).length + selectorsEndingWith(UI_BUTTON, cls).length
      if (covered === 0) missing.push(cls)
    }
    expect(missing, `这些按钮类没有焦点环：${missing.join(', ')}`).toEqual([])
  })

  it('按钮焦点环口径唯一：2px 实线 + var(--color-focus-ring) + offset 2px', () => {
    const bodies = []
      .concat(selectorsEndingWith(COHERE, 'cohere-btn-primary'))
      .concat(selectorsEndingWith(COHERE, 'cohere-btn'))
      .concat(selectorsEndingWith(UI_BUTTON, 'ui-btn'))
    expect(bodies.length).toBeGreaterThanOrEqual(3)
    for (const b of bodies) {
      expect(b.body).toContain('2px solid var(--color-focus-ring)')
      expect(b.body).toContain('outline-offset: 2px')
      expect(b.body).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })

  it('没有任何规则把按钮类的 outline 关掉（outline:none 会静默取消焦点指示）', () => {
    const offenders = []
    const scan = (file) => {
      for (const b of ruleBlocks(read(file))) {
        if (!/(cohere|ui)-btn/.test(b.selector)) continue
        if (!/focus-visible/.test(b.selector) && /outline:\s*none/.test(b.body)) {
          offenders.push(`${path.basename(file)} :: ${b.selector}`)
        }
      }
    }
    for (const f of fs.readdirSync(path.join(SRC, 'styles'))) {
      if (f.endsWith('.css')) scan(path.join(SRC, 'styles', f))
    }
    expect(offenders, `按钮规则里出现 outline:none：${offenders.join(' | ')}`).toEqual([])
  })

  it('焦点环对两档画布的非文本对比度都 ≥3:1（存在但不看不见等于没有）', () => {
    const css = read(TOKENS)
    const hexOf = (name, from) => {
      const i = css.indexOf(from)
      const seg = css.slice(i)
      const m = seg.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
      if (!m) throw new Error(`解析不到 ${name}（从 ${from} 起）——判据退化时宁可抛错也不放行`)
      return m[1]
    }
    // 公式不再内联：本仓的 WCAG 相对亮度比单一实现是 color-token-reader.js 的 contrast()
    // （收敛前这里自带一份 lum/ratio，收紧一次判据要改两份；见 color-token-reader.test.js
    //  的「对比度公式的收敛欠账」棘轮）。解析不出必须抛错，不得当成"通过"。
    const ratio = (a, b) => {
      const v = contrast(a, b)
      if (v === null) throw new Error(`contrast() 解析不出 ${a} / ${b} —— 判据退化时宁可抛错也不放行`)
      return v
    }
    // 浅档：--color-focus-ring 取 var(--color-primary-hover) → 解析该槽的 hex 实际值
    const lightRing = hexOf('--color-primary-hover', ':root')
    const lightCanvas = hexOf('--color-bg-canvas', ':root')
    const darkRing = hexOf('--color-primary-dark-tint', '[data-theme="dark"]')
    const darkCanvas = hexOf('--color-bg-canvas', '[data-theme="dark"]')
    const lightCard = hexOf('--color-bg-card', ':root')
    const darkCard = hexOf('--color-bg-card', '[data-theme="dark"]')
    const rows = [
      ['light/canvas', ratio(lightRing, lightCanvas)],
      ['light/card', ratio(lightRing, lightCard)],
      ['dark/canvas', ratio(darkRing, darkCanvas)],
      ['dark/card', ratio(darkRing, darkCard)],
    ]
    console.log(`[focus-ring] 对比度: ${rows.map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  ')}`)
    for (const [k, v] of rows) expect(v, `焦点环 ${k} 对比度不足 3:1（实际 ${v.toFixed(2)}）`).toBeGreaterThanOrEqual(3)
  })

  it('焦点环不得被 outline 过渡淡入（transition:all 会把 outline-* 一并纳入）', () => {
    // 实测动因：本族按钮基规则带 `transition: all`，第一次真浏览器读数里 4 个变体
    // Tab 后 0ms 仍是 3px currentColor / offset 0 —— 只有显式关掉 outline 过渡才即时可见。
    const bodies = selectorsEndingWith(COHERE, 'cohere-btn-primary')
    expect(bodies.length).toBe(1)
    expect(bodies[0].body).toMatch(/transition:[^;]*outline-color 0s/)
    expect(bodies[0].body).toMatch(/outline-width 0s/)
    expect(bodies[0].body).toMatch(/outline-offset 0s/)
    const ui = selectorsEndingWith(UI_BUTTON, 'ui-btn')
    expect(ui[0].body, 'UiButton 的焦点环同样不得淡入').toMatch(/outline-color 0s/)
  })

  it('死槽 --focus-blue 不得复活（本批把两档声明收敛为 --color-focus-ring）', () => {
    // 判据只看"是否存在该声明"，不看子串 —— 注释里叙述这个收敛过程是正当的，
    // 用 toContain('--focus-blue') 会把解释自己的那段话判成违规（本锁第一次运行即因此误红）。
    const decls = (file) => read(file).split('\n')
      .map((l) => l.trim())
      .filter((l) => /^--focus-blue\s*:/.test(l))
    expect(decls(COHERE), 'cohere 仍声明 --focus-blue').toEqual([])
    expect(decls(TOKENS), 'tokens 仍声明 --focus-blue').toEqual([])
  })

  it('UiButton 族由组件基类规则承担覆盖（模板扫描看不见它，所以必须单独点名）', () => {
    // <UiButton> 的 class 是 computed 绑定，不在模板的字面 class="..." 里；
    // 若只依赖上面那条"模板清点"判据，整个 UiButton 族对焦点环检查是**结构性隐形**的。
    let usages = 0
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.vue')) usages += (read(p).match(/<UiButton\b/g) || []).length
      }
    }
    walk(SRC)
    console.log(`[focus-ring] <UiButton> 用法=${usages}`)
    expect(usages).toBeGreaterThanOrEqual(100)
    expect(selectorsEndingWith(UI_BUTTON, 'ui-btn').length).toBe(1)
  })

  it('UiButton 根节点 classes 恒含基类 ui-btn（否则上面的基类规则形同虚设）', () => {
    const src = read(UI_BUTTON)
    const m = src.match(/const classes = computed\(\(\) => \[\s*\n\s*"ui-btn",/)
    expect(m, 'UiButton 的 classes 首位必须是 "ui-btn"').not.toBeNull()
  })
})
