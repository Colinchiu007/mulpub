/**
 * .pipeline-grid 单一来源契约测试
 *
 * 背景：`.pipeline-grid` 曾同时定义在 create-view.css（auto-fill minmax(300px)/断点 260px）
 * 与 pipeline-selector.css（多列响应式断点体系）。两处同名类特异性相同，
 * 一旦加载顺序变化（如某入口先加载 create-view.css），后加载的基础规则会静默压掉
 * 先加载的媒体查询断点，宽屏 3/4/5 列行为可能无声退化为 auto-fill。
 * 本测试钉死：流水线网格布局只允许由 pipeline-selector.css 单一来源提供。
 *
 * 断言规范（QM-3）：结构类断言用 toEqual，避免清一色 toContain。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const createViewCss = read('./create-view.css')
const pipelineSelectorCss = read('./pipeline-selector.css')
const pipelineSelectorVue = read('../views/video-creation/PipelineSelector.vue')

describe('.pipeline-grid 单一来源（pipeline-selector.css）', () => {
  it('create-view.css 不再定义 .pipeline-grid（禁止第二来源）', () => {
    const duplicates = createViewCss.match(/\.pipeline-grid\s*\{/g) || []
    expect(duplicates).toEqual([])
  })

  it('pipeline-selector.css 定义基础 auto-fill 与列数断点（行为不变护栏）', () => {
    expect(pipelineSelectorCss).toContain('grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));')
    expect(pipelineSelectorCss).toContain('@media (max-width: 768px)')
    expect(pipelineSelectorCss).toContain('@media (min-width: 1200px) and (max-width: 1439px)')
    expect(pipelineSelectorCss).toContain('grid-template-columns: repeat(3, 1fr);')
    expect(pipelineSelectorCss).toContain('@media (min-width: 1440px) and (max-width: 1919px)')
    expect(pipelineSelectorCss).toContain('grid-template-columns: repeat(4, 1fr);')
    expect(pipelineSelectorCss).toContain('@media (min-width: 1920px)')
    expect(pipelineSelectorCss).toContain('grid-template-columns: repeat(5, 1fr);')
  })

  it('PipelineSelector.vue 随组件导入 pipeline-selector.css（规则必然随视图加载）', () => {
    expect(pipelineSelectorVue).toContain("import '@/styles/pipeline-selector.css'")
  })
})
