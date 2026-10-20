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
 *  1. 底色沿**候选链**取「最近的不透明表面」：该规则自己的 background → 祖先前缀规则 / 类名词干（`.login-state-actions`
 *     在 DOM 里坐在 `.login-state` 上，而 CSS 没有这层前缀关系）→ 页面 inset；遇到解析不出的层就**停住并出声**，
 *     不得穿透它用更远那层（半透明合成结果与更远祖先不是同一个颜色）。祖先仍按选择器前缀/类名词干猜，
 *     **不解析真实 DOM**，所以嵌在别的带色容器里仍可能漏。
 *     ⛔ 早期版本对整条链取"最差值"，会把**自带底色**的合规元素算成假缺陷（`.complete-login` 白字坐自己的
 *     `#5048e5` 是 6.18:1，"最差"却把它脚下 `.login-state` 的 `#f3f2ff` 也算进来 → 1.11:1）。
 *     另有两类"判据定位不了承载面"的形状一律记 unresolved 而不是回落页面底色（QM-6 引擎 critic 轴 i2）：
 *     `position: absolute|fixed` 且自己不画底的文字（`.search-icon` / `.clear-search`），
 *     以及承载底写在**同前缀兄弟后代**上的（`.group-search-box .search-icon` 压在 `.group-search-box input` 的裸底上）。
 *  2. 不覆盖 `rgb()/rgba()/hsl()`：解析不出即 `unresolved`，登记并出声，**不得**当合规。
 *  3. 字号/字重只认该规则自己声明的值；继承来的读不到 ⇒ 按正文档 4.5（保守方向）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resolveColor, contrast, scanStyleRules, declsWithOverrides } from '../styles/color-token-reader'
import { collectSites, siteFails } from '../styles/text-contrast-sites'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8').replace(/\r\n/g, '\n')

const tokensCss = read('../styles/tokens.css')
const vue = read('./Accounts.vue')
const BASE = JSON.parse(read('./Accounts.text-contrast-baseline.json'))
const EXEMPT = BASE.exemptions
const EXEMPT_BY_SELECTOR = new Map(EXEMPT.map((e) => [e.selector, e]))

const { themes, overrides, sites } = collectSites(vue, tokensCss)
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
    // ⛔ 不钉字面量（QM-6 引擎 critic 轴 i7）：上一版把 `.account-view-toggle button` 的两档 surface
    // 硬钉成 `#f8f9fc` / `#1e1e23`，而本批的既定计划正是把那个容器的裸底换成 token ——
    // 于是"合法地把容器 token 化"会让这条假红，而它自己的注释还声称这种变化不该判失败。
    // 现在改为**从同一份真源推导期望值**：祖先声明的底，过一遍该主题覆盖层后再解析。
    const bySel = new Map()
    for (const r of scanStyleRules(vue)) bySel.set(r.selector, { ...(bySel.get(r.selector) || {}), ...r.decls })
    const anc = bySel.get('.account-view-toggle')
    expect(anc && anc.background, '取样容器必须自己声明底色，否则这条对账测不到覆盖层').toBeTruthy()
    const sample = textSites.find((s) => s.selector === '.account-view-toggle button')
    expect(sample, '选择器坐标：本文件现场已无该规则，须同步更新取样点').toBeTruthy()
    const wantLight = resolveColor(anc.background, themes.light)
    const wantDark = resolveColor(declsWithOverrides({ background: anc.background }, overrides.dark, '.account-view-toggle').background, themes.dark)
    expect(sample.per.find((p) => p.theme === 'light').surface, '浅色档祖先底必须等于"该声明在该主题下解析出的值"').toBe(wantLight)
    expect(sample.per.find((p) => p.theme === 'dark').surface, '暗色档祖先底必须等于"覆盖层生效后的值"').toBe(wantDark)
    // 覆盖层真的换掉了它（否则上面两句只是同一句的复读）——这一格才是"主题覆盖层生效"的现场证据
    expect(wantDark, '祖先底色两档同值 ⇒ 要么覆盖层没写要么它没被读到（这条取样点就该换）').not.toBe(wantLight)
  })

  it('页面底色在两档主题下都解析得出（否则下面的对比度判据是空的）', () => {
    expect(pageBg(themes.light), '浅色档 --color-bg-inset 解析失败').toBeTruthy()
    expect(pageBg(themes.dark), '暗色档 --color-bg-inset 解析失败').toBeTruthy()
    expect(pageBg(themes.light)).not.toBe(pageBg(themes.dark))
  })

  it('界面文字引用的令牌必须在暗色根块也有声明（否则"双档合格"是假绿）', () => {
    // QM-6 引擎 critic 轴 i4：`dark = [...light, ...dark块]` 这个结构本身分不清
    // "暗色档换过值"与"暗色档从没声明、安静读到浅色值"。合同写的是前者必须成立，
    // 所以判据必须读 `darkDeclared`（只由暗色根块填充的那个集合），不能读 `dark`。
    const refs = []
    for (const s of textSites) {
      for (const m of String(s.value).matchAll(/var\((--[\w-]+)/g)) refs.push({ selector: s.selector, slot: m[1] })
    }
    // 反失明正控：本文件确实有经 token 的文字色；若这一格退化成 0，下面那句"违规 = 0"就恒真了
    expect(refs.length, `只扫到 ${refs.length} 条 var() 文字色引用 ⇒ 判据失明，不是"全部合规"`).toBeGreaterThan(0)
    expect(themes.darkDeclared.size, '暗色根块一个槽都没读到 ⇒ darkDeclared 这条判据不可信').toBeGreaterThan(0)
    const bad = refs.filter((r) => !themes.darkDeclared.has(r.slot))
    expect(bad, `暗色档读的是浅色值（该槽未在暗色根块声明）：${bad.map((b) => `${b.selector}→${b.slot}`).join(' | ')}`).toEqual([])
    // 同一个槽在 light/dark 里若解析出同一个颜色，也必须点名 —— 那是"声明了但没换"，同样不构成双档
    const sameValue = refs.filter((r) => themes.darkDeclared.has(r.slot)
      && resolveColor(`var(${r.slot})`, themes.light) === resolveColor(`var(${r.slot})`, themes.dark))
    expect(sameValue.map((r) => r.slot), '被文字色引用且在暗色块声明过、但两档同值的槽（换主题等于没换）').toEqual([])
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
    // ⛔ 三格上界为什么动（15→18 / nd 3→6 / cb 12→12 未动），逐条给出处：
    // ① 修 QM-6 引擎 critic 轴的 Critical i1 时，`.login-state-actions button` 的 color 从
    //    var(--color-primary) 退回主干原值（裸 #5048e5）⇒ 它进 cb 清单；而 `.platform-filter-panel
    //    button.active` 因判据不再穿透 rgba 半透明层冒充读数（旧那格 6.75 是穿透祖先底算的）从 cb
    //    改判 needs-design ⇒ **cb 一进一出，12 未变**，所以"令牌体系欠账"这一格没有被放宽。
    // ② needs-design 3→6 的第二跳是 `.search-icon` / `.clear-search`：两者 `position: absolute` 且
    //    自己不画底，旧口径按页面 inset 算出 5.58 / 8.02 判"合规"（假绿），现场它们压在
    //    `.group-search-box input` 的裸 `#fafbfe`（暗色不随主题走）上 2.00:1 —— 这是**判据变准后暴露出的
    //    既存缺陷**，不是本批新造的欠账（相对 origin/main 该处色值一行未动）。
    // 抬起上界属人工裁决：本文件把理由与现场读数写在同一格注释里，判据一律取「现场重算」而不是取这里的字面数。
    expect(EXEMPT.length, `豁免清单当前 ${EXEMPT.length} 条（当日读数 18）`).toBeLessThanOrEqual(18)
    expect(EXEMPT.filter((e) => e.status === 'needs-design').length, 'needs-design = 换任何同族槽都过不了，或判据读不出承载底 ⇒ 待设计裁决/人工核对（当日读数 6）').toBeLessThanOrEqual(6)
    expect(EXEMPT.filter((e) => e.status === 'compliant-bare').length, 'compliant-bare = 现值已过 AA，只是没收成 token（当日读数 12，与起点同格：一处进、一处出）').toBeLessThanOrEqual(12)
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
