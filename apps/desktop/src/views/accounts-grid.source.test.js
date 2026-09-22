/**
 * 账号页卡片网格「列口径单一来源」契约测试
 *
 * 背景：账号页加载期骨架栅格（.mp-skeleton-grid，auto-fill minmax(280px)）被放在
 * flex 居中容器（.loading-state，display:flex + justify-content:center）内，
 * flex 子项沿主轴不拉伸 → 栅格宽度塌陷为固有内容宽度，auto-fill 在不确定宽度下
 * 只解析出 1 列；而加载完成后的真实栅格（.account-card-grid）占满面板确定宽度，
 * auto-fill 摆出多列，于是出现「加载中 1 列 → 加载完突然多列」的布局跳动。
 * 同时 .account-card-grid 曾存在双基线声明：第一个 scoped 块的 repeat(4/2/3) 断点
 * 与后加载的第二个 scoped 块的 auto-fill 基线特异性相同、源码更靠后，
 * 使断点成为死代码——两处同名基线本身就是口径漂移隐患。
 *
 * 本测试钉死（方案 B）：
 *  1) 账号页列口径唯一来源 = .account-results-panel 上的 --account-grid-columns / --account-grid-gap；
 *  2) 真实栅格与骨架栅格都消费该变量，两端列数与间距天然一致；
 *  3) 骨架栅格必须 width:100% 撑满面板，消除 flex 居中容器下的单列塌陷；
 *  4) .account-card-grid 不允许再出现任何硬编码 repeat(...) 列口径。
 *
 * 断言规范（QM-3）：结构类断言用 toEqual/toMatch，避免清一色 toContain。
 * 读取方式：用 Vite ?raw 导入源码文本（jsdom 环境下 import.meta.url 非 file scheme，
 * readFileSync+fileURLToPath 会抛 "The URL must be of scheme file"）。
 */
import { describe, expect, it } from 'vitest'
import accountsVue from './Accounts.vue?raw'

describe('Accounts.vue 卡片网格列口径单一来源', () => {
  it('列口径变量在 .account-results-panel 上唯一定义（auto-fill minmax(280px,1fr) / gap 24px）', () => {
    const colDefs = accountsVue.match(/--account-grid-columns:/g) || []
    const gapDefs = accountsVue.match(/--account-grid-gap:/g) || []
    expect(colDefs.length).toEqual(1)
    expect(gapDefs.length).toEqual(1)
    expect(accountsVue).toContain('.account-results-panel { --account-grid-columns: repeat(auto-fill, minmax(280px, 1fr)); --account-grid-gap: 24px; }')
  })

  it('真实栅格 .account-card-grid 消费变量，且不再残留任何硬编码 repeat(...) 列口径', () => {
    expect(accountsVue).toMatch(/\.account-card-grid \{ grid-template-columns: var\(--account-grid-columns\); gap: var\(--account-grid-gap\); \}/)
    const hardcoded = accountsVue.match(/\.account-card-grid[^{]*\{[^}]*repeat\(/g) || []
    expect(hardcoded).toEqual([])
  })

  it('骨架栅格消费同一变量并占满面板宽度（消除加载期 flex 居中塌陷成 1 列的跳动）', () => {
    const skeletonRule = accountsVue.match(/\.loading-state \.mp-skeleton-grid \{([^}]*)\}/)
    expect(skeletonRule).not.toBeNull()
    expect(skeletonRule[1]).toContain('width: 100%')
    expect(skeletonRule[1]).toContain('grid-template-columns: var(--account-grid-columns)')
    expect(skeletonRule[1]).toContain('gap: var(--account-grid-gap)')
  })
})
