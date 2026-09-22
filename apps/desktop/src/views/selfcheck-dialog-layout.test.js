import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 限流自检弹窗布局契约（源码断言）：
// <style scoped> 不会注入 jsdom，mount 拿不到计算样式，
// 故读组件源码文本断言 .selfcheck-row 有对齐布局规则、输入框宽度统一。
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const vue = readFileSync(join(srcDir, 'views/ModelProviders.vue'), 'utf8')

function ruleBody (selector) {
  const idx = vue.indexOf(selector)
  if (idx === -1) return null
  const open = vue.indexOf('{', idx)
  if (open === -1) return null
  const close = vue.indexOf('}', open)
  return vue.slice(open + 1, close)
}

describe('限流自检弹窗布局契约', () => {
  it('.selfcheck-row 定义了 flex 行布局（label 与输入框同行对齐，不再随机换行）', () => {
    const body = ruleBody('.selfcheck-row {')
    expect(body).toBeTruthy()
    expect(body).toMatch(/display:\s*flex/)
    expect(body).toMatch(/align-items:\s*center/)
  })

  it('.selfcheck-row label 有固定列宽（所有输入框对齐同一基线）', () => {
    const body = ruleBody('.selfcheck-row label')
    expect(body).toBeTruthy()
    expect(body).toMatch(/flex:\s*0 0 [\d.]+px|min-width:\s*[\d.]+px|width:\s*[\d.]+px/)
  })

  it('自检表单内 el-input-number 宽度统一（不再参差不齐）', () => {
    const body = ruleBody('.selfcheck-row .el-input-number')
    expect(body).toBeTruthy()
    expect(body).toMatch(/width:\s*\d+px/)
  })
})
