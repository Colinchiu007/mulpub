import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/cohere-design-system.css'), 'utf8')

function ruleBody (selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'))
  return match?.[1] || ''
}

describe('顶部导航布局合同', () => {
  it('主导航保持单行并在空间不足时横向滚动', () => {
    const body = ruleBody('.cohere-topnav .nav-primary')
    expect(body).toMatch(/display:\s*flex/)
    expect(body).toMatch(/min-width:\s*0/)
    expect(body).toMatch(/overflow-x:\s*auto/)
    expect(body).toMatch(/white-space:\s*nowrap/)
  })

  it('导航项和右侧操作区不会被压缩换行', () => {
    expect(ruleBody('.cohere-topnav .nav-item')).toMatch(/flex:\s*0\s+0\s+auto/)
    expect(ruleBody('.cohere-topnav .nav-right')).toMatch(/flex:\s*0\s+0\s+auto/)
    expect(ruleBody('.cohere-topnav .nav-right')).toMatch(/margin-left:\s*auto/)
  })
})

/**
 * 改写页列宽合同（BUGFIX-REWRITE-PAGE-WIDTH，2026-09-16）
 *
 * 背景：.cohere-main 是 flex column 容器，.rewrite-page 原本只有
 * `max-width + margin: 0 auto`。在 flex 布局中，交叉轴方向上的 auto margin
 * 会抑制 align-self:stretch，使页面宽度退化为 fit-content(max-content)——
 * 宽度由「最宽的子元素」决定。改写结果卡片出现后内容变宽，整列从 474.11px
 * 跳到 543.69px（Chromium 实测），表现为「点击改写后页面被撑宽」。
 *
 * 这几条断言是纯 CSS 契约，不依赖浏览器即可在 CI 拦截回退。
 */
describe('改写页列宽合同', () => {
  it('页面根容器声明显式宽度，阻断 flex 交叉轴的 fit-content 退化', () => {
    const body = ruleBody('.rewrite-page')
    expect(body).toMatch(/width:\s*100%/)
    expect(body).toMatch(/max-width:\s*900px/)
    expect(body).toMatch(/box-sizing:\s*border-box/)
  })

  it('结果区元信息允许换行，不用单行内容把列撑宽', () => {
    expect(ruleBody('.rewrite-result-meta')).toMatch(/flex-wrap:\s*wrap/)
  })
})
