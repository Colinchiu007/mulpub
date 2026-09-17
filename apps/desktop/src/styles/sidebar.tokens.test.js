/**
 * sidebar 样式契约测试（T0-2）
 *
 * 钉死三件事，防止后续迁移回退：
 * 1. MpSidebar.vue 内不再出现任何硬编码色值（颜色只能来自 token）；
 * 2. sidebar.css 引用的每个 --color-* / --shadow-* 变量都在 tokens.css 有定义；
 * 3. 亮/暗两套 sidebar 槽位一一对应（暗色覆盖不漏项），且暗色文字档有可读值。
 *
 * 断言规范（QM-3）：结构类断言用 toEqual/toBe，避免清一色 toContain。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const sidebarCss = read('./sidebar.css')
const tokensCss = read('./tokens.css')
const sidebarVue = read('../layouts/MpSidebar.vue')

/** 取 CSS 变量定义：返回 { name: value }，scope 为 :root 或 dark */
function readVarBlock (scope) {
  const startIdx = scope === 'dark'
    ? tokensCss.indexOf('[data-theme="dark"]')
    : tokensCss.indexOf(':root {')
  const block = tokensCss.slice(startIdx, startIdx + tokensCss.slice(startIdx).indexOf('\n}'))
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]),
  )
}

describe('sidebar 样式 token 化（T0-2）', () => {
  it('MpSidebar.vue 内无硬编码色值', () => {
    const hexMatches = sidebarVue.match(/#[0-9a-fA-F]{3,8}\b/g) || []
    expect(hexMatches).toEqual([])
  })

  it('sidebar.css 引用的 token 全部在 tokens.css 定义', () => {
    const used = [...new Set([...sidebarCss.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]))]
    const defined = { ...readVarBlock('root'), ...readVarBlock('dark') }
    // --mp-sidebar-width 由 cohere-design-system.css 定义（布局宽度，非颜色 token），单独断言
    const missing = used.filter((name) => !(name in defined) && name !== '--mp-sidebar-width')
    expect(missing).toEqual([])
    // 反向确认：sidebar 专用槽位确实被消费，不是死变量
    expect(used.filter((name) => name.startsWith('--color-sidebar')).length).toBeGreaterThan(5)
    expect(read('../styles/cohere-design-system.css')).toContain('--mp-sidebar-width: 200px')
  })

  it('亮色与暗色 sidebar 槽位一一对应（暗色不漏覆盖）', () => {
    const pick = (vars) => Object.keys(vars).filter((n) => n.startsWith('--color-sidebar') || n === '--shadow-sidebar-active')
    const light = pick(readVarBlock('root')).sort()
    const dark = pick(readVarBlock('dark')).sort()
    expect(dark).toEqual(light)
  })

  it('品牌主色经 --color-sidebar-accent 间接取 --color-primary', () => {
    const root = readVarBlock('root')
    expect(root['--color-sidebar-accent']).toBe('var(--color-primary)')
    expect(root['--color-primary']).toBe('#5048E5')
  })

  it('暗色文字档与背景对比度 ≥ 4.5:1（WCAG AA 正文）', () => {
    const dark = readVarBlock('dark')
    const bg = hexToRgb(dark['--color-sidebar-bg-start'])
    const textSlots = [
      '--color-sidebar-text',
      '--color-sidebar-text-secondary',
      '--color-sidebar-text-tertiary',
      '--color-sidebar-text-muted',
      '--color-sidebar-text-footer',
      '--color-sidebar-icon',
    ]
    const failures = textSlots
      .map((slot) => [slot, contrastRatio(hexToRgb(dark[slot]), bg)])
      .filter(([, ratio]) => ratio < 4.5)
    expect(failures).toEqual([])
    // accent（hover/active 文字）在暗底与 active 底色上都要可读
    const activeBg = flatten(hexToRgb(dark['--color-sidebar-bg-start']), hexToRgb('#7b74ff'), 0.18)
    expect(contrastRatio(hexToRgb(dark['--color-sidebar-accent']), bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(hexToRgb(dark['--color-sidebar-accent']), activeBg)).toBeGreaterThanOrEqual(4.5)
  })

  it('折叠断点与宽度变量未被改动（行为不变护栏）', () => {
    expect(sidebarCss).toContain('@media (max-width: 900px)')
    expect(sidebarCss).toContain('var(--mp-sidebar-width, 200px)')
  })
})

// ── 对比度计算（WCAG 2.1 相对亮度公式）──
function hexToRgb (hex) {
  const v = hex.trim().replace('#', '')
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}

function luminance ([r, g, b]) {
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio (a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 半透明前景叠加在背景上的合成色 */
function flatten (bg, fg, alpha) {
  return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha)))
}
