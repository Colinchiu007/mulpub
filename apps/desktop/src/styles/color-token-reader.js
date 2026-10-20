/**
 * color-token-reader —— 给测试用的 CSS 颜色真值解析器（不参与运行时打包）
 *
 * 为什么需要它：本仓已有四处测试各自实现了一遍"读 tokens 算对比度"
 * （`tokens.slots` / `tokens.aliases` / `sidebar.tokens` / `ep-theme.tokens`），
 * 每份都只覆盖自己关心的那几条链。再抄第五份会让"同一个不可读组合"在四份里判红、
 * 在第五份里判绿。这里只提供机制（读主题链 → 解析 var() → 算对比度），
 * 判据留在各测试里。收敛那四处副本属另批（见执行记录「遗留」）。
 *
 * 解析规则如实声明，避免被当成"真实渲染结果"：
 *  - 逐块扫描：根级块按选择器形状归类（`:root` / `html` 为浅色，`[data-theme="dark"]`
 *    ——**不带 `html` 前缀也要认**——为暗色覆盖），后者覆盖前者；
 *  - `var(--x, fallback)` 在 `--x` 缺失时才用 fallback（与 CSS 的回退语义一致）；
 *  - 不处理 `rgb()` / `hsl()` / 百分比 / 色管理，遇到即返回 null（**不得**把它当"通过"）。
 *
 * `scanStyleRules` / `needFor` / `effectiveBg` 也放这里，理由不是"凑巧同文件"：
 * 豁免基线（`Accounts.text-contrast-baseline.json`）里记录的 `need` 与 `ratio` 必须能被测试**重算核对**。
 * 若判据在两处各写一份，生成侧算 3:1、校验侧算 4.5:1，基线就会恒红或恒绿 —— 而这两种都读起来像"有门禁"。
 */

const VAR_RE = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+?)\s*)?\)$/

/**
 * 剥掉 `!important` 与首尾空白，得到可用于解析的纯值。
 * ⛔ 这一步不可省（QM-6 逻辑轴 Critical 实测）：`.batch-status { background: #fff !important }`
 * 在 CSS 里是**真的会生效**的底色，而 `^#hex$` 判据读到尾部的 `!important` 就返回 null，
 * 于是判据回落到页面底色算出 5.45:1，而屏幕上的实际比值是 3.04:1 —— 那是"判据说合规、人眼看不见"。
 */
function plainValue (v) {
  return String(v || '').replace(/\s*!important\s*$/i, '').trim()
}

/**
 * @param {string} css 可以一次传多个文件内容拼起来（token 声明在本仓**不止 tokens.css 一处**）
 * @returns {{light: Map<string,string>, dark: Map<string,string>}}
 */
export function loadThemes (css) {
  const light = new Map()
  const dark = new Map()
  // 先剥注释：本仓根块前面普遍压着一段 CSS 块注释说明，不剥的话注释文本会把选择器一起吃进来，
  // `^:root$` 这类锚定判定当场失败 ⇒ 整个 :root 块被漏读（表现为"槽全是 undefined"，而不是报错）。
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // 逐块扫描而不是按 `:root` / `html[data-theme='dark']` 两条写死的正则找：
  // tokens.css 的暗色根块实测写的是 `[data-theme="dark"]`（不带 html 前缀），
  // 写死的选择器形态会**静默漏读整个暗色块**，于是 dark 档退化成浅色值、
  // 所有"两档都要过 AA"的判据看起来都成立（本文件第 1 版就踩在这里，靠一条反向锁抓到）。
  for (const m of cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    const body = m[2]
    const isDark = /\[data-theme\s*=\s*['"]?dark['"]?\]/.test(selector)
    const isLightRoot = /^(:root|html)$/.test(selector)
    // 根级暗色块：选择器除了 html/data-theme 之外不含任何后代或别的类（`html[data-theme='dark'] .x` 是覆盖某个具体类，不是槽位）
    const isDarkRoot = isDark && !/(?:[\s>+~])[\w.[]/.test(selector.replace(/\[[^\]]*\]/g, ''))
    if (!isLightRoot && !isDarkRoot) continue
    // ⛔ 不得用 `^\s*(--x)\s*:` 这种"行首锚定"的正则：它要求每条声明各占一行，
    // 而 `:root { --a: #fff; --b: #000; }` 这种写成一行（或将来被格式化工具压成一行）的形态，
    // 只会读出第一条，其余**静默失踪** —— 下游表现为"token 解析不出"而不是报错。
    for (const d of body.matchAll(/(-{2}[\w-]+)\s*:\s*([^;{}]+)/g)) {
      ;(isDarkRoot ? dark : light).set(d[1], d[2].trim())
    }
  }
  return { light, dark: new Map([...light, ...dark]) }
}

/**
 * 把一个声明值解析成十六进制颜色。
 * @param {string} value 例如 `#1f2340` / `var(--color-text-primary)` / `var(--text-primary, #28282f)`
 * @param {Map<string,string>} theme
 * @returns {string|null} 解析不出纯色值时返回 null（调用方必须出声，不得当合规）
 */
export function resolveColor (value, theme, depth = 0) {
  if (depth > 10) return null
  const v = plainValue(value)
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return normalizeHex(v)
  const m = VAR_RE.exec(v)
  if (!m) return null
  const raw = theme.get(m[1])
  if (raw === undefined) return m[2] ? resolveColor(m[2], theme, depth + 1) : null
  return resolveColor(raw, theme, depth + 1)
}

function normalizeHex (hex) {
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6) // 取 RGB，忽略 alpha（有 alpha 的组合本判据不覆盖）
  if (h.length !== 6) return null
  return `#${h.toLowerCase()}`
}

function channel (b8) {
  const c = b8 / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** @param {string|null} hex */
export function luminance (hex) {
  const h = hex && normalizeHex(hex)
  if (!h) return null
  const n = parseInt(h.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG 2.x 相对亮度比；任一输入解析不出即返回 null（不得当成 1:1 或"通过"） */
export function contrast (fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  if (l1 === null || l2 === null) return null
  const [a, b] = [l1, l2].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

/**
 * 扫描 SFC / CSS 源码里的**每一个** `<style>` 块，返回 `{selector, decls}` 列表。
 *
 * ⛔ 必须遍历所有块：一个 `.vue` 可以有多个 `<style scoped>`（`Accounts.vue` 实测两个），
 * 用 `lastIndexOf('<style')` 只截最后一段、或只 `match` 第一处，会让前一整块
 * 从判据里**静默消失** —— 现场表现为"变异把某条改回裸 hex，测试照绿"（本仓 M3 实测）。
 *
 * ⛔ 并且必须**递归进 at-rule**（`@media` / `@supports` / 嵌套）：扁平的
 * `([^{}\n]+)\{([^{}]*)\}` 对 `@media x { .foo { color: red } }` 只会把 `@media x` 当选择器、
 * 因为体内还有 `{` 而整条不匹配 ⇒ 被包进去的规则**从判据里消失**（QM-6 可维护性轴 Q3 命中；
 * 本文件当场核对：现有 3 个 @media 块内**没有** color，所以今天是漏报为零，但结构上是洞）。
 * 递归后报告的选择器带上祖先串（`@media (max-width: 1100px) .foo`），
 * 于是"把某条已登记的规则挪进 @media"会撞"陈旧登记"红，而不是安静消失。
 *
 * @param {string} src 已把 CRLF 归一为 LF 的源码
 */
export function scanStyleRules (src) {
  const out = []
  for (const m of String(src).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) parseRules(m[1], [], out)
  return out
}

/** 供 CSS 文件与 `<style>` 段共用的递归下降；`stack` 是祖先 at-rule 串 */
export function parseRules (css, stack = [], out = []) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const selector = text.slice(i, open).trim().replace(/\s+/g, ' ')
    let depth = 1, j = open + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const body = text.slice(open + 1, j - 1)
    const nested = body.includes('{')
    const isContainer = /^[.@&:#\w[*]/.test(selector) && nested
    if (isContainer) parseRules(body, stack.concat(selector), out)
    else if (nested) parseRules(body, stack, out)
    else if (selector) {
      const decls = {}
      for (const d of body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) decls[d[1].trim()] = plainValue(d[2])
      out.push({ selector: stack.concat(selector).join(' '), decls })
    }
    i = j
  }
  return out
}

/**
 * 主干/令牌文件里「按主题覆盖某个具体选择器」的那一层（本仓实测写在 `tokens.css`：
 * `html[data-theme='dark'] .account-toolbar-selects select { background: var(--color-bg-inset); … }`）。
 *
 * 不读它会**双向出错**：暗色档实际底色已被换成 inset，而判据仍按文件里的裸 `#f8f9fc` 算，
 * 于是既可能把已修好的算成欠账（QM-6 逻辑轴 Info#2 命中的正是这一类），
 * 也可能反过来把"只有浅色档坏"的判成"两档都坏"。
 * @returns {{dark: Map<string,object>, light: Map<string,object>}} 键为去掉了主题前缀的目标选择器
 */
export function loadThemeOverrides (css) {
  const dark = new Map()
  const light = new Map()
  for (const r of parseRules(css)) {
    const m = /^(?:html|:root)?\[data-theme\s*=\s*['"]?(dark|light)['"]?\]\s+(\S.*)$/.exec(r.selector)
    if (!m) continue
    const target = m[2].replace(/\s*:\s*/g, ': ').trim().replace(/\s+/g, ' ')
    const bucket = m[1] === 'dark' ? dark : light
    bucket.set(target, { ...(bucket.get(target) || {}), ...r.decls })
  }
  return { dark, light }
}

/** 取某选择器在指定主题下**实际生效**的声明：基础声明 + 该主题的覆盖层（后写者胜） */
export function declsWithOverrides (decls, overrides, selector) {
  return { ...decls, ...((overrides && overrides.get(selector)) || {}) }
}

/**
 * 沿 var() 链把长度值解析成 px 数字（`font-size: var(--font-size-lg)` 必须能算出 20）。
 * 为什么不能只 parseFloat 原始声明值：本仓字号**一律经 token**，直接 parseFloat 会得到 NaN，
 * 于是"大字号放宽到 3:1"这条对所有真实声明都点不到火，全部按 4.5 判 —— 那是**偏严**方向，
 * 看起来安全，实际后果是把本来合规的大标题登记成缺陷、并把真正的缺陷淹在噪音里。
 *
 * @returns {number|null} 非 px/rem 或解析不出 ⇒ null（调用方按"读不到"处理，不得当成 0）
 */
export function resolveLength (value, theme, depth = 0) {
  if (depth > 10) return null
  const v = plainValue(value)
  const m = VAR_RE.exec(v)
  if (m) {
    const raw = theme.get(m[1])
    if (raw === undefined) return m[2] ? resolveLength(m[2], theme, depth + 1) : null
    return resolveLength(raw, theme, depth + 1)
  }
  const n = /^(-?[\d.]+)(px|rem)?$/.exec(v)
  if (!n) return null
  return Number(n[1]) * (n[2] === 'rem' ? 16 : 1)
}

/**
 * 该选择器上的文字按 WCAG 需要达到的最低对比度。
 * 分档依据是**对象类型**，不是"看起来重要"：
 *  - 大文本 = **≥24px 常规字重，或 ≥18.66px 且加粗（≥700）** ⇒ 3:1（WCAG 1.4.3 原文按 pt 定义：
 *    18pt=24px、14pt=18.66px；把"任意 ≥18.66px"都当大文本是**放宽判据**，
 *    QM-6 逻辑轴 Warning#3 命中的正是这一格 —— 未来一个 20px 常规正文会被误判成可豁免）
 *  - 非文本 UI 组件（靠 `currentColor` 上色的图标/箭头）⇒ 3:1（WCAG 1.4.11）
 *  - 其余正文 ⇒ 4.5:1
 * 字号/字重只认**该规则自己声明**的值（继承来的读不到 ⇒ 按正文 4.5 档，属保守方向）；
 * 刻意不按类名特判（`.page-title` 之类写死会让下一个大标题继续被判成正文）。
 */
export function needFor (selector, decls = {}, theme) {
  const size = theme ? resolveLength(decls['font-size'], theme) : null
  const rawWeight = plainValue(decls['font-weight'] || '')
  const bold = /^(bold|bolder)$/.test(rawWeight) || parseFloat(rawWeight) >= 700
  const large = (Number.isFinite(size) && size >= 24) || (Number.isFinite(size) && size >= 18.66 && bold)
  const nonTextUi = /\b(icon|svg|clear-search|arrow|chevron)\b/i.test(selector)
  return large || nonTextUi ? 3 : 4.5
}

/**
 * 一条文字**可能坐在哪些底色上**的候选集（QM-6 逻辑轴 Warning#2 命中：
 * `.login-state span` 自己没写 background，父 `.login-state` 写了裸 `#f3f2ff`，
 * 只用页面 inset 判就会算出 4.54 放行，而屏幕上是 4.39）。
 * 不解析真实 DOM，所以取**保守并集**：自己的 background、每个祖先前缀选择器的 background、页面底色；
 * 调用方必须对**全部候选**判达标（取最差），而不是挑一个好看的。
 * 解析不出的候选底色会记成 `null` 并由调用方出声，不得从集合里悄悄丢掉。
 *
 * @param {string} selector 已归一（空格分隔）的选择器
 * @param {object} decls 该选择器实际生效的声明（含主题覆盖层）
 * @param {Map<string,object>} declBySelector 本文件内 选择器 → 声明 的索引
 * @param {Map<string,string>} theme
 * @param {string|null} pageBgValue 已解析的页面底色
 */
export function surfaceCandidates (selector, decls, declBySelector, theme, pageBgValue) {
  const out = []
  const push = (raw, from) => out.push({ raw, from, hex: raw ? resolveColor(raw, theme) : null })
  const own = decls && (decls.background || decls['background-color'])
  // `transparent` / `none` 不是"一块判据读不到的底色"，而是"我自己没有底色" ⇒ 必须继续往上/往页面找。
  // 把它当未解析候选会让整条判据读出 null（本仓实测：`.clear-search`/`.login-state-actions button`
  // 都写了 `background: transparent`，于是被误判成"解析不出 ⇒ 换任何 token 都过不了"）。
  const ownIsNone = own && /^(transparent|none)$/i.test(own)
  if (own && !ownIsNone) push(own, selector)
  const parts = String(selector).split(/\s+/).filter(Boolean)
  for (let k = parts.length - 1; k >= 1; k--) {
    const anc = parts.slice(0, k).join(' ')
    const d = declBySelector && declBySelector.get(anc)
    const raw = d && (d.background || d['background-color'])
    if (raw && !/^(transparent|none)$/i.test(raw)) push(raw, anc)
  }
  if (!out.length) push(pageBgValue || null, ownIsNone ? `${selector} background:${own} => page-bg` : 'page-bg (caller supplied)')
  return out
}

/**
 * 一段文字真正坐在什么底色上：优先该规则自己声明的 `background` / `background-color`，
 * 解析不出（或没声明）才回落调用方给的页面底色。
 * ⛔ 不得只用页面底色：按钮把 `#fff` 放在品牌紫上是 **6.18:1**，放到页面底色上会算成 1.07:1，
 * 于是把已合规的项登记成缺陷（本仓第 1 版的分析器就是这么错的）。
 * @returns {string|null} 解析不出纯色 ⇒ null，调用方必须出声，不得当合规
 */
export function effectiveBg (decls, theme, fallbackBg) {
  const own = decls && (decls.background || decls['background-color'])
  const resolved = own ? resolveColor(own, theme) : null
  return resolved || fallbackBg || null
}

/**
 * 一条文字在**所有候选底色**上最差的那个比值（候选集来自 surfaceCandidates）。
 * 取最差而不是取一个：判据要问的是"有没有任何一种它实际可能坐在的底色上读不出来"。
 * @returns {{ratio:number|null, worstHex:string|null, unresolved:Array<{raw:string|null, from:string|null}>}}
 */
export function worstContrast (colorValue, surfaces, theme) {
  const fg = resolveColor(colorValue, theme)
  const unresolved = []
  let worst = null
  let worstHex = null
  for (const s of surfaces || []) {
    if (!s.hex) { unresolved.push({ raw: s.raw, from: s.from }); continue }
    if (!fg) continue
    const r = contrast(fg, s.hex)
    if (r === null) { unresolved.push({ raw: s.raw, from: s.from }); continue }
    if (worst === null || r < worst) { worst = r; worstHex = s.hex }
  }
  return { ratio: fg ? worst : null, worstHex, unresolved }
}
