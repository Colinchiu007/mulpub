/**
 * text-contrast-sites —— 把一个 SFC 的「文字点」枚举成可判定的结构化现场
 *
 * 为什么单独一个文件（而不是各写一份）：QM-6 可维护性轴把「生成基线的脚本」与「校验基线的测试」
 * 各自实现同一判据点名为**本单元最高危单点** —— 两份实现一旦词汇或口径漂移，
 * 下一次重跑生成器就会把已核对过的基线覆盖成另一种形状，而两边都"看起来绿"。
 * 所以现场采集只此一份，测试与生成脚本都消费它；**判断**（登记/棘轮/选型）留在各自的文件里。
 */
import {
  loadThemes, loadThemeOverrides, scanStyleRules, declsWithOverrides,
  surfaceCandidates, worstContrast, needFor, resolveColor,
} from './color-token-reader.js'

const THEMES = ['light', 'dark']

/**
 * @param {string} vueSrc 组件源码（CRLF 需先归一为 LF）
 * @param {string} tokensSrc token 真源（含 `html[data-theme='dark'] .sel { … }` 覆盖层）
 * @param {string} pageBgExpr 页面底色表达式
 */
export function collectSites (vueSrc, tokensSrc, pageBgExpr = 'var(--color-bg-inset)') {
  const themes = loadThemes(tokensSrc)
  const overrides = loadThemeOverrides(tokensSrc)
  const rules = scanStyleRules(vueSrc)

  const sites = []
  // 每个主题各建一份"选择器 → 生效声明"索引：祖先的底色同样可能被 tokens.css 的主题覆盖层改掉
  // （实测 `html[data-theme='dark'] .account-view-toggle { background: var(--color-bg-inset) }`）。
  // 只做"本站点选择器"的覆盖会把**已随主题走的祖先底色**当成固定浅底 ⇒ 虚构出一笔欠账
  // （QM-6 逻辑轴 Info#2 命中的正是这一类，只是它举的是本站点选择器的例子）。
  const declIndex = { light: new Map(), dark: new Map() }
  for (const name of ['light', 'dark']) {
    for (const r of rules) {
      declIndex[name].set(r.selector, { ...(declIndex[name].get(r.selector) || {}), ...declsWithOverrides(r.decls, overrides[name], r.selector) })
    }
  }
  for (const r of rules) {
    if (typeof r.decls.color !== 'string') continue
    const per = THEMES.map((name) => {
      const theme = themes[name]
      const eff = declIndex[name].get(r.selector)
      const pageBg = resolveColor(pageBgExpr, theme)
      const surfaces = surfaceCandidates(r.selector, eff, declIndex[name], theme, pageBg)
      const { ratio, worstHex, unresolved } = worstContrast(eff.color, surfaces, theme)
      return {
        theme: name,
        need: needFor(r.selector, eff, theme),
        value: eff.color,
        ratio: ratio === null ? null : Number(ratio.toFixed(2)),
        surface: worstHex,
        // 候选底色里有解析不出的（rgba / 未定义槽）⇒ 如实标注，不得当成"这条过了"
        unresolved: unresolved.map((u) => u.raw || '(无)'),
      }
    })
    sites.push({ selector: r.selector, value: r.decls.color.trim(), per })
  }
  return { themes, overrides, sites }
}

/** 一条文字点是否"确实读不出来"：任一主题算不出比值、或最差比值低于该主题阈值 */
export function siteFails (site) {
  return site.per.some((p) => p.ratio === null || p.ratio < p.need)
}
