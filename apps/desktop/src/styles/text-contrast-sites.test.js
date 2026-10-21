/**
 * text-contrast-sites 的机制锁 —— 「生成基线」与「校验基线」共用的那份采集，它自己必须有独立反证
 *
 * 动因（QM-6 可维护性轴 Q2b，判为本单元最高危单点）：生成脚本与测试曾各算一遍比值，
 * 两边词汇与口径都会漂（`no-token-candidate` vs `compliant-bare` 就是这么漂出来的）。
 * 收敛成一份采集后，风险换成另一形态：**这份采集一坏，两侧同时变绿**。
 * 所以这里用一份"故意做坏"的最小夹具（祖先底色、主题覆盖层、@media 嵌套、transparent、rgb()）
 * 单独锁它的语义，不依赖 Accounts.vue 的真实内容 —— 后者会变，夹具不会。
 */
import { describe, it, expect } from 'vitest'
import { collectSites, siteFails } from './text-contrast-sites'

// 夹具要点：
//  - `.card .title` 自己不写底色，祖先 `.card` 写了裸 hex ⇒ 必须走祖先链
//  - tokens 里有一条 `html[data-theme='dark'] .card { background: ... }` ⇒ 暗色档必须读覆盖层
//  - `.flat` 写 `background: transparent` ⇒ 不得当成"读不出的底色"
//  - `.rgb` 用 rgb() ⇒ 判据不覆盖，必须 ratio=null
//  - `.rgba-bg` 把 rgba() 写在**底色**上 ⇒ 必须停在这一层、把原始值记进 unresolved，不得穿透到页面底色冒充读数
//  - @media 里一条 ⇒ 不得整块漏扫
const TOKENS = `
/* 说明块 */
:root {
  --color-bg-inset: #ffffff;
  --color-text-strong: #111111;
  --color-text-secondary: #707080;
  --color-primary: #5048e5;
  --font-size-lg: 20px;
}
[data-theme="dark"] {
  --color-bg-inset: #101014;
  --color-text-strong: #f5f5f7;
  --color-text-secondary: #b4b2c6;
  --color-primary: #8b85ff;
}
html[data-theme='dark'] .card { background: #1a2030; }
html[data-theme='dark'] .ignored-class { color: #123456; }
`
const SFC = `
<template><div /></template>
<style scoped>
.card { background: #f2f2f5; }
.card .title { color: var(--color-text-secondary); font-size: var(--font-size-lg); font-weight: 700; }
.flat { background: transparent; color: #92939c; }
.rgb { color: rgb(1, 2, 3); }
.rgba-bg { background: rgba(10, 20, 30, .5); color: #ffffff; }
@media (max-width: 900px) {
  .nested { color: var(--color-text-strong); }
}
</style>
<style>
.second-block { color: #1f2340; }
</style>
`
const { sites } = collectSites(SFC, TOKENS)
const bySel = new Map(sites.map((s) => [s.selector, s]))

describe('text-contrast-sites', () => {
  it('采集域：两个 style 块 + @media 里的规则都要出点（漏一块 = 判据静默失真）', () => {
    expect([...bySel.keys()], '必须含 .card .title / .flat / .rgb / .rgba-bg / .nested / .second-block').toEqual([
      '.card .title', '.flat', '.rgb', '.rgba-bg', '@media (max-width: 900px) .nested', '.second-block',
    ])
  })

  it('祖先链：自身没写底色的文字，必须坐在祖先声明的底色上', () => {
    const t = bySel.get('.card .title')
    expect(t.per.map((p) => p.surface), '浅色档实际坐的底 = 祖先的裸底（不是页面白）').toEqual(['#f2f2f5', '#1a2030'])
  })

  it('主题覆盖层：tokens.css 的 html[data-theme=dark] .card 必须换掉暗色档的底色', () => {
    const dark = bySel.get('.card .title').per.find((p) => p.theme === 'dark')
    expect(dark.surface, '不读覆盖层就会把"已随主题走的容器底"当成固定浅底，虚构出一笔欠账').toBe('#1a2030')
    expect(dark.ratio).toBeGreaterThan(4.5)
  })

  it('background: transparent 不是"读不出的底色"，必须继续往祖先与页面回落', () => {
    const f = bySel.get('.flat')
    for (const p of f.per) {
      expect(p.ratio, 'transparent 被当候选会让整条判据读出 null ⇒ 合格项被误判成"换任何槽都过不了"').not.toBeNull()
      expect(p.unresolved, 'transparent 不得进 unresolved 名单').toEqual([])
    }
    expect(f.per[0].surface).toBe('#ffffff')
  })

  it('判据不覆盖的形态（rgb）必须 ratio=null，且 siteFails 视为不通过', () => {
    const r = bySel.get('.rgb')
    expect(r.per[0].ratio, 'rgb() 不解析').toBeNull()
    expect(siteFails(r), '读不出不得读成合规').toBe(true)
  })

  it('底色写成 rgba() 时必须停在这一层：unresolved 记录原始值，且不得穿透到页面底色冒充读数', () => {
    // 这一条守的是 worstContrast 的"遇解析不出即 break"语义（QM-6 引擎 critic 轴之后的口径变更）。
    // 变异 M10 实测：把采集出的 unresolved 洗成空数组时，ratio / surface / need 三项**全都仍然对得上**
    // ⇒ 说明只靠比值与底色两格，"读不出"这件事可以从现场彻底消失而无人察觉（半透明层被祖先底色顶替，
    // 于是 `rgba(139,133,255,.18)` 这类真实存在的不可判层会被记成"已核对过"）。
    const g = bySel.get('.rgba-bg')
    const p = g.per[0]
    expect(p.ratio, 'rgba 底色不得算出比值').toBeNull()
    expect(p.surface, '不得穿透 rgba 层去取页面底色当"实际坐在的那块底"').toBeNull()
    expect(p.unresolved, 'unresolved 必须把原始声明值带出来，供人工核对').toEqual(['rgba(10, 20, 30, .5)'])
    expect(siteFails(g), '读不出 = 不通过').toBe(true)
  })

  it('大文本档位由该规则自己的字号决定（经 token 解析），而不是类名', () => {
    const t = bySel.get('.card .title')
    expect(t.per[0].need, '20px + 700 ⇒ 大文本档 3:1').toBe(3)
    const s = bySel.get('.second-block')
    expect(s.per[0].need, '没写字号 ⇒ 正文档 4.5（保守方向）').toBe(4.5)
  })

  it('siteFails 对"两档之一不过"必须出声，对"两档都过"必须沉默', () => {
    // .second-block 是 #1f2340：浅色档落在 #ffffff（16+）而暗色档落在页面 #101014（约 1.2）
    // ⇒ 这正是本仓那句"暗色档近乎不可见"的形状，必须被算成不通过。
    expect(siteFails(bySel.get('.second-block')), '暗色档 1.2:1 必须出声').toBe(true)
    // .nested 在浅色档落在页面白 ⇒ 两档都过，必须沉默（否则合规项会被淹成一片红）
    expect(siteFails(bySel.get('@media (max-width: 900px) .nested')), '两档都过不得报欠账').toBe(false)
    expect(siteFails(bySel.get('.card .title')), '祖先底色已随主题走 ⇒ 过').toBe(false)
  })

  it('祖先链只认"前缀选择器"，不得把无关规则当底色', () => {
    // `.card .title` 的祖先候选只有 `.card`；`html[data-theme='dark'] .ignored-class` 这类
    // 带后代的选择器不得被当成任何本站点的底色来源（否则底色集合会被无关规则污染，取最差时误红）。
    const t = bySel.get('.card .title')
    expect(t.per[0].surface).toBe('#f2f2f5')
    expect(sites.some((s) => s.selector.includes('ignored-class')), '主题覆盖层的选择器不得被当成站点').toBe(false)
  })
})
