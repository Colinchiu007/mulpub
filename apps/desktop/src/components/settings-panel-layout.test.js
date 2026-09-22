import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 设置弹窗内容区留白契约（2026-09-22 settings-panel-content-gap）
 * 回归保护：
 *  - .settings-panel 曾 padding:0，导致零内边距的子内容（飞书表单、模型筛选条）
 *    直接贴住左侧导航 border-right，视觉上「接触 / 重叠」。
 *  - 面板改为统一提供水平留白（padding 非 0 + min-width:0），
 *    并用 :deep 去掉子页级左右 padding，避免与面板留白叠加成双重缩进。
 */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const vue = readFileSync(join(srcDir, 'components/SettingsDialog.vue'), 'utf8')

function ruleBody (selector) {
  const idx = vue.indexOf(selector + ' {')
  if (idx === -1) return null
  const open = vue.indexOf('{', idx)
  const close = vue.indexOf('}', open)
  return vue.slice(open + 1, close)
}

describe('设置弹窗内容区留白契约', () => {
  it('.settings-panel 有非零 padding（不再贴住导航分隔线）', () => {
    const body = ruleBody('.settings-panel')
    expect(body).toBeTruthy()
    // 不允许 padding: 0（可带分号 / 换行）
    expect(body).not.toMatch(/padding:\s*0\s*[;\n]/)
    // 必须有显式 padding 且首值非 0
    expect(body).toMatch(/padding:\s*[1-9]/)
  })

  it('.settings-panel 有 min-width:0（防 flex 子项溢出挤压导航）', () => {
    const body = ruleBody('.settings-panel')
    expect(body).toMatch(/min-width:\s*0/)
  })

  it('用 :deep 去掉子页级左右 padding，避免与面板双重留白', () => {
    expect(vue).toMatch(/:deep\(\.cohere-page-header\)/)
    expect(vue).toMatch(/:deep\(\.cohere-content\)/)
    const from = vue.indexOf(':deep(.cohere-page-header)')
    const block = vue.slice(from, vue.indexOf('}', from) + 1)
    expect(block).toMatch(/padding-left:\s*0/)
    expect(block).toMatch(/padding-right:\s*0/)
  })
})
