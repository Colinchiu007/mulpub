/**
 * 采集页视觉 token 收编契约（Q3：A + 少量 B；Q11 暗色同步）
 *
 * 三条不可省：① 采集相关渲染层文件不得出现亮色硬编码 hex（白名单为空）；
 * ② tokens.css 中本 PR 新增的 6 个语义槽在亮色 :root 与 [data-theme="dark"] 均有定义
 *    且暗色值与亮色不同（「暗色真覆盖」——与 tokens.aliases.test.js 同一判据）；
 * ③ Collection.vue 内联 style 属性不得含 hex（知乎区块类化后的回归锁）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const SCOPE_FILES = [
  '../../views/Collection.vue',
  './BatchCollectPanel.vue',
  './CollectedResultsList.vue',
  './ColProgressBlock.vue',
]

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g

function stripComments (css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('采集页 hex 硬编码门禁', () => {
  it.each(SCOPE_FILES)('%s 的 <style> 块无 hex 字面量', (rel) => {
    const src = read(rel)
    const styleMatch = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)
    expect(styleMatch, '文件应有 style 块').toBeTruthy()
    const body = stripComments(styleMatch[1])
    const hits = body.match(HEX_RE) || []
    expect(hits, `发现硬编码色值: ${hits.join(', ')}`).toEqual([])
  })

  it('Collection.vue 模板内联 style 无 hex', () => {
    const src = read('../../views/Collection.vue')
    const template = src.match(/<template>([\s\S]*?)<\/template>/)[1]
    const inlineStyles = [...template.matchAll(/style="([^"]*)"/g)].map((m) => m[1])
    for (const s of inlineStyles) {
      expect(s, `内联样式含 hex: ${s}`).not.toMatch(HEX_RE)
    }
  })
})

// 本 PR 新增的语义槽（--color-warning 非本次新增：语义色区既有槽且有意亮暗同值
// 显式重声明，tokens.slots.test.js 已有契约，此处只断言存在不重复锁）
const NEW_SLOTS = ['--color-bg-page', '--shadow-card-hover', '--color-ribbon', '--color-ribbon-soft']

describe('新增语义槽亮暗两档契约', () => {
  const tokensCss = read('../../styles/tokens.css')
  function readVarBlock (css, scope) {
    const re = scope === 'dark' ? /^\[data-theme="dark"\]\s*\{/m : /^:root\s*\{/m
    const m = css.match(re)
    expect(m, `${scope} 块应存在`).toBeTruthy()
    let depth = 1
    let i = css.indexOf('{', m.index) + 1
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    return css.slice(m.index, i)
  }

  it.each(NEW_SLOTS)('%s 在亮色与暗色均定义且暗色真覆盖', (slot) => {
    const light = readVarBlock(tokensCss, 'light')
    const dark = readVarBlock(tokensCss, 'dark')
    const lightDecl = light.match(new RegExp(`${slot.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`))
    const darkDecl = dark.match(new RegExp(`${slot.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`))
    expect(lightDecl, `${slot} 缺亮色定义`).toBeTruthy()
    expect(darkDecl, `${slot} 缺暗色定义`).toBeTruthy()
    expect(darkDecl[1].trim()).not.toBe(lightDecl[1].trim())
  })
})
