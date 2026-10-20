/**
 * Accounts 页文本色的两档主题对比度合同（UX 审计 4.2 首批）
 *
 * 动因是当场可复现的一条：**暗色档下页面标题 1.02:1**（近乎不可见）。
 * 成因不是"颜色选错了"，而是该文件的文字色**全部写成裸 hex**（`#1f2340` / `#4d4e57` /
 * `#28282f` / `#92939c` …），因此 `tokens.css` 的暗色覆盖（`--color-text-*` 在
 * `[data-theme="dark"]` 块里被改成 `#f5f5f7 / #e8e8ed / #b4b2c6 / #a9a7bd`）**一条都到不了它们**。
 *
 * 判据走"解析 token 链 → 拿真值 → 算 WCAG 相对亮度比"，不写"源码里有没有 var()"这种字符串判据：
 * 后者对 `var(--text-primary, #28282f)` 这种"带了 token 但保留 hex 回退"的写法会误判为合规，
 * 而回退值在 token 存在时确实不参与渲染 —— 但**token 被改名/删除的那一天它就生效了**。
 *
 * ⛔ 采集实现只有的一份：`../styles/text-contrast-sites.js`。
 * 基线里的 `need` / `ratio` / `surface` 三个读数由它产出，测试**用同一个函数重算核对**。
 * 这条是 QM-6 可维护性轴点名的本单元最高危单点：生成侧与校验侧各写一份判据时，
 * 一个人改了口径而另一份没改，基线就会要么恒红要么恒绿，而两者读起来都"像有门禁"。
 *
 * 三条如实声明的判据边界（越界就是假绿）：
 *  1. 底色取「该规则自己的 background → 祖先前缀规则的 background → 页面 inset」的**候选集最差值**；
 *     祖先按选择器前缀猜（`.a .b` ⇒ `.a`），**不解析真实 DOM**，所以嵌在别的带色容器里仍可能漏。
 *  2. 不覆盖 `rgb()/rgba()/hsl()`：解析不出即 `unresolved`，登记并出声，**不得**当合规。
 *  3. 字号/字重只认该规则自己声明的值；继承来的读不到 ⇒ 按正文档 4.5（保守方向）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resolveColor, contrast, scanStyleRules } from '../styles/color-token-reader'
import { collectSites, siteFails } from '../styles/text-contrast-sites'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8').replace(/\r\n/g, '\n')

const tokensCss = read('../styles/tokens.css')
const vue = read('./Accounts.vue')
const BASE = JSON.parse(read('./Accounts.text-contrast-baseline.json'))
const EXEMPT = BASE.exemptions
const EXEMPT_BY_SELECTOR = new Map(EXEMPT.map((e) => [e.selector, e]))

const { themes, sites } = collectSites(vue, tokensCss)
const textSites = sites
const pageBg = (theme) => resolveColor('var(--color-bg-inset)', theme)

/** 现场重算一条登记项：per 的 need/ratio/surface 必须与基线逐字段相等 */
function recompute (selector) {
  const site = textSites.find((s) => s.selector === selector)
  return site ? site.per : null
}

describe('Accounts 页文本色对比度（两档主题）', () => {
  it('扫描域不退化：style 块数与 color 声明数都必须有下界', () => {
    // 本文件实测有**两个** `<style scoped>` 块，且 `.page-title` 在第一个里。
    // 只截一段（lastIndexOf / 第一处 match）时整块静默消失，而"条数下界"可能仍然过 ——
    // 所以块数单独钉一次（M5 变异实测）。
    expect((vue.match(/<style[^>]*>/g) || []).length, 'style 块数变了：扫描实现必须仍遍历全部块').toBe(2)
    expect(rulesLen(), `只扫到 ${textSites.length} 条 color 声明，低于现场读数 ⇒ 解析退化而不是"合规"`).toBeGreaterThanOrEqual(textSites.length)
    expect(textSites.length, '本文件的 color 声明数（当日读数 41）低于下界 ⇒ 判据失明，不是通过').toBeGreaterThan(35)
  })

  it('读槽必须先证明"暗色根块被读到了"（tokens.css 的暗色块写的是 [data-theme="dark"]，不带 html 前缀）', () => {
    // 正则若退回 `html[data-theme='dark']`，暗色块整块漏读，dark 档会静默等于 light 档，
    // 而"两档都要过 AA"的判据会全部假绿。
    expect(themes.light.get('--color-bg-inset'), '浅色 inset 现值变了').toBe('#faf6f8')
    expect(themes.dark.get('--color-bg-inset'), '暗色 inset 没被读到（或现值变了）').toBe('#1e1e23')
    expect(themes.dark.get('--color-text-primary'), '暗色文字主槽没被读到').toBe('#e8e8ed')
    expect(themes.light.get('--color-text-primary'), '浅色文字主槽现值变了').toBe('#1e1b4b')
  })

  it('底色候选集必须分主题解析：祖先的主题覆盖层要真的生效（dark 底色不得处处等于 light 底色）', () => {
    // QM-6 逻辑轴 Info#2：只按"裸 #f8f9fc 不随主题走"判，会把**已被 tokens.css 暗色覆盖层换掉的祖先底色**
    // 当成固定浅底 ⇒ 虚构出一笔不存在的欠账。
    // 判据写成"有多少条的暗色底色与浅色不同"，而不是钉住某一条选择器 —— 后者会把"别人合法地把容器换成 token"
    // 也读成失败，那是脆而不是严；而覆盖层/祖先链一坏，dark 底色会**整体退回等于 light**，这一条立刻红。
    const differ = textSites.filter((s) => s.per[0].surface !== s.per[1].surface)
    expect(differ.length, '暗色档底色与浅色档逐条相同 ⇒ 主题覆盖层没生效（判据失明，不是"容器不随主题变"）').toBeGreaterThan(4)
    const sample = textSites.find((s) => s.selector === '.account-view-toggle button')
    expect(sample, '选择器坐标：本文件现场已无该规则，须同步更新取样点').toBeTruthy()
    expect(sample.per.find((p) => p.theme === 'dark').surface).toBe('#1e1e23')
    expect(sample.per.find((p) => p.theme === 'light').surface).toBe('#f8f9fc')
  })

  it('页面底色在两档主题下都解析得出（否则下面的对比度判据是空的）', () => {
    expect(pageBg(themes.light), '浅色档 --color-bg-inset 解析失败').toBeTruthy()
    expect(pageBg(themes.dark), '暗色档 --color-bg-inset 解析失败').toBeTruthy()
    expect(pageBg(themes.light)).not.toBe(pageBg(themes.dark))
  })

  it('不得有"未登记的"裸 hex 文字色（每一条都必须带实测比值与状态）', () => {
    const bare = textSites.filter((s) => /^#[0-9a-f]{3,8}$/i.test(s.value))
    const unregistered = bare.map((s) => s.selector).filter((sel) => !EXEMPT_BY_SELECTOR.has(sel))
    expect(unregistered, `新增裸 hex 未登记（登记必须附当场实测比值 + status）：${unregistered.join(' | ')}`).toEqual([])
    const nowBare = new Set(bare.map((s) => s.selector))
    const stale = EXEMPT.filter((e) => /^#[0-9a-f]{3,8}$/i.test(e.value)).map((e) => e.selector).filter((sel) => !nowBare.has(sel))
    expect(stale, `基线里的裸 hex 登记项现场已不在（已修好却没销账）：${stale.join(' | ')}`).toEqual([])
  })

  it('每一条 AA 不合规都必须落在基线里且 status=needs-design（不得靠"没扫到"过关）', () => {
    const failing = new Set(textSites.filter(siteFails).map((s) => s.selector))
    const unaccounted = [...failing].filter((sel) => EXEMPT_BY_SELECTOR.get(sel)?.status !== 'needs-design')
    expect(unaccounted, `新的 AA 不合规（未登记 needs-design）：${unaccounted.join(' | ')}`).toEqual([])
    // 反向锁：needs-design 的登记项现场必须**仍然**不过 ⇒ 修好了还挂着登记就是陈旧
    const fixed = EXEMPT.filter((e) => e.status === 'needs-design').map((e) => e.selector).filter((sel) => !failing.has(sel))
    expect(fixed, `needs-design 登记项现场已过 AA（须同次销账）：${fixed.join(' | ')}`).toEqual([])
  })

  it('基线里的每个读数必须能被这份采集实现重算核对（登记不是抄数字，是登记一条可复核的事实）', () => {
    const mismatched = []
    for (const e of EXEMPT) {
      const now = recompute(e.selector)
      if (!now) { mismatched.push(`${e.selector}：现场已无该 color 声明`); continue }
      for (const rec of e.per) {
        const p = now.find((x) => x.theme === rec.theme)
        if (!p) { mismatched.push(`${e.selector}/${rec.theme}: 主题档不见了`); continue }
        if (p.need !== rec.need) mismatched.push(`${e.selector}/${rec.theme}: 阈值重算 ${p.need} 而基线记 ${rec.need}`)
        if (p.ratio === null && rec.ratio !== null) mismatched.push(`${e.selector}/${rec.theme}: 现场读不出而基线记了 ${rec.ratio}`)
        if (p.ratio !== null && rec.ratio !== null && Math.abs(p.ratio - rec.ratio) > 0.011) {
          mismatched.push(`${e.selector}/${rec.theme}: 比值重算 ${p.ratio} 而基线记 ${rec.ratio}`)
        }
        if (String(p.surface || '') !== String(rec.surface || '')) mismatched.push(`${e.selector}/${rec.theme}: 底色来源 ${p.surface} vs 基线 ${rec.surface}`)
      }
    }
    expect(mismatched, `基线读数与现场不符（改判据或改颜色时忘了同次更新）：${mismatched.join(' | ')}`).toEqual([])
  })

  it('棘轮：两类欠账的计数都只能缩小（抬起上界属人工裁决）', () => {
    expect(EXEMPT.length, `豁免清单当前 ${EXEMPT.length} 条（当日读数 15）`).toBeLessThanOrEqual(15)
    expect(EXEMPT.filter((e) => e.status === 'needs-design').length, 'needs-design = 换任何同族槽都过不了 ⇒ 待设计裁决（当日读数 3）').toBeLessThanOrEqual(3)
    expect(EXEMPT.filter((e) => e.status === 'compliant-bare').length, 'compliant-bare = 现值已过 AA，只是没收成 token（当日读数 12）').toBeLessThanOrEqual(12)
    for (const e of EXEMPT) {
      expect(['needs-design', 'compliant-bare'], `未知 status：${e.status}（新增档位必须同时给出判据与销账路径）`).toContain(e.status)
      for (const p of e.per) expect(p.surface || p.ratio === null, `${e.selector}/${p.theme} 的登记必须写出底色来源`).toBeTruthy()
    }
  })

  it('未修的那一类也要留现场：底色/边框/描边的裸 hex 清单（暗色档浅底的肇因）', () => {
    const bare = []
    for (const r of scanStyleRules(vue)) {
      for (const k of ['background', 'background-color', 'border', 'border-color', 'outline']) {
        const v = r.decls[k]
        if (!v) continue
        if (/(^|[^-\w])#[0-9a-fA-F]{3,8}/.test(String(v).replace(/var\([^)]*\)/g, ''))) bare.push(`${r.selector} ${k}`)
      }
    }
    const SURFACES = BASE.surfaces || []
    expect(bare.length, `现场裸 hex 底色/边框 ${bare.length} 处，基线只记了 ${SURFACES.length} 条 ⇒ 清单没跟上现场`).toBe(SURFACES.length)
    expect(SURFACES.length, '本类欠账清单只能缩小').toBeLessThanOrEqual(31)
  })

  it('反向锁（oracle 必须测得出这个缺陷本身）：把已知不可读组合喂进去必须落在 1 与 1.2 之间', () => {
    // #1f2340 是该文件原 page-title 的裸 hex；它在暗色 inset 底上就是审计里那句 1.02:1。
    // 这条不是业务断言，是防"解析/计算退化后上一切判据都恒真"的正控。
    const ratio = contrast('#1f2340', pageBg(themes.dark))
    expect(ratio, 'oracle 算不出已知不可读组合 ⇒ 本文件其余判据不可信').toBeLessThan(1.2)
    // ⛔ 这一格是变异 M8 当场逼出来的洞：把 contrast 的排序方向写反，比值会恒 <1，
    // 于是 "<1.2" 这条**在公式坏掉时照样绿**。WCAG 比值定义上恒 ≥1，
    // 所以必须同时断言下界 —— 任何 <1 的读数都是"探针坏了"，不是"缺陷更严重"。
    expect(ratio, '比值 <1 在定义上不成立 ⇒ 只可能是公式/输入退化').toBeGreaterThanOrEqual(1)
    const title = textSites.find((s) => /\.page-title\b/.test(s.selector))
    expect(needForSize(title), '大标题档位丢了（字号经 token 解析不出）⇒ 会按正文档误判').toBe(3)
  })

  it('token 缺失时必须出声，不得静默用回退值蒙过判据', () => {
    expect(resolveColor('var(--mp-nope-missing, #000000)', themes.light), '有回退时才用回退').toBe('#000000')
    expect(resolveColor('var(--mp-nope-missing)', themes.light), '无回退必须 null，不是"跳过"').toBeNull()
    expect(resolveColor('rgba(0,0,0,.5)', themes.light), '本判据不覆盖 rgba ⇒ 必须 null 而不是当成合规').toBeNull()
    expect(resolveColor('#fff !important', themes.light), '!important 是生效值而不是"读不出"（QM-6 逻辑轴 Critical）').toBe('#ffffff')
  })
})

// 选择器数量下界的独立实现：把 style 段按规则块数一遍，防止"采集实现整体读空"时下界断言与它同源失效
function rulesLen () {
  return scanStyleRules(vue).length
}
// 大文本档位：直接问采集结果里的 need（与主判据同源），不再第二处特判类名
function needForSize (site) {
  return site ? Math.min(...site.per.map((p) => p.need)) : null
}
