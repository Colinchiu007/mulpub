/**
 * focusable-ring-contract.test.js — 凡模板里带 `tabindex="0"` 的元素必须有 `:focus-visible` 焦点环
 * （UX 审计 3.6 与 4.4 之间的缺口 / WCAG 2.4.7；动因是 PR #4088 的 QM-6 评审 i1，二轮 i1/i4 又各补一刀）
 *
 * 为什么单独一把锁：`styles/focus-ring.test.js`（3.6）的判定域**按设计只收按钮类**，
 * 它自己的头注释写着「`<div class="cohere-btn-*" @click>` ⇒ 属阶段 4.4，不在本判据域内」。
 * 而 4.4 那批把 6 张卡片变成 `tabindex="0"` 可聚焦元素 ⇒ 两把锁之间留了一条缝，
 * 键盘用户按 Tab 走到卡片上看不到焦点在哪。本锁闭这条缝：**判定域 = 模板里所有 tabindex="0" 的元素**。
 *
 * 判据两条（都是 PRD §一 的既有契约，不是本锁自创）：
 *   ① 环色必须取 `--color-focus-ring` 单一真源（浅/暗两档各有映射 ⇒ 业务侧不得再写暗色覆盖）；
 *   ② 规则必须显式写 `transition: outline-color 0s, outline-width 0s, outline-offset 0s` ——
 *      组件族普遍带 `transition: all`，会把 `outline-*` 纳入过渡，Tab 后 0ms 读到的是过渡起点。
 *      这条是**二轮评审 i1** 抓出来的：本批第一版只写了环没写 override，
 *      而 §一 明文要求、本锁又完全不看 —— 契约自相矛盾且无门禁可见。
 *
 * ⚠ 本锁只查「规则**引用**了令牌」，**不查令牌本身有没有声明** —— 那一格由同域的
 * `styles/focus-ring.test.js` 持有（实测 `--color-focus-ring 在浅色与暗色两个块内各声明恰一次`，
 * 该文件 :109）。三轮 i2 提过"这里也该补一条声明检查"，处置是**不补**：
 * 那会把同一判据抄成两份，而两份必然漂移；跨文件"断言对方源码里写了某句"又属 AGENTS.md
 * 明令禁止的记录性断言。这里留指针，是为了让下一个会话不必重新怀疑这一格空着。
 *
 * 解析层（二轮评审 i4）：**站点取自 `@vue/compiler-sfc` 模板 AST，样式只取自 `<style>` 块与 .css 文件**。
 * 第一版用正则在整份 SFC 文本上扫 `<tag …>` 并把整份文本当 CSS 喂进去，正是同一 PR 里
 * 键盘锁刚被评审要求退役的「源码文本正则」手法，且四处具体空窗：`<script>` 里的
 * `tabindex` 字符串会变成站点、`<script>` 里的 CSS-in-JS 选择器会变成规则、`:class="fn()"`
 * 取不到类名、嵌套 `&` 选择器不展开。AST 化消掉前两处；后两处如实登记为边界（见下）。
 *
 * 边界（如实声明，不得当成已覆盖）：
 *   - `:tabindex="expr"` 动态绑定不在域内（动态值本质上无法静态判定它是否可聚焦）；
 *   - `:class="computedFn()"` 这类取不到字面量类名的站点，会算作「无类名」并进缺环账（保守红，不静默放行）；
 *   - SCSS 式 `&:focus-visible` 嵌套展开不做（本仓渲染层样式为纯 CSS，实测无该写法）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(HERE, '.')
const RING_TOKEN = '--color-focus-ring'
const TRANSITION_OVERRIDE = 'outline-color 0s, outline-width 0s, outline-offset 0s'

/**
 * 缺环欠账（文件 → { kind, reason }）。**只能缩小**；条目修好后必须删除（留着就是永久豁免）。
 * 上线三步序：新门禁先建"只可缩小"的基线，不得要求本批把全仓历史一次修完。
 */
export const FOCUSABLE_DEBT = {
  'components/SidebarServiceStatus.vue': {
    kind: 'missing',
    reason: '该 span 的 tabindex="0" 早于本批（阶段 1「服务状态」接线批次引入），不在 4.4 的改动面上。'
      + '补环会改渲染结果、需与像素门禁同批 —— 归阶段 1 收尾批（与审计 2.4 的通知批次）一起做。',
  },
  'views/CreateHistory.vue': {
    kind: 'missing',
    reason: '运行中横幅的 div tabindex="0"：这一处是**二轮评审 i4 把本锁从源码正则换成模板 AST 后才显形的**'
      + '（旧正则 `[^>]*` 不跨行，而这个标签的属性跨了多行 ⇒ 对旧判据结构性隐形）。'
      + '属阶段 2「发布进度」批次的面，补环需与该批的计算样式取证同做，不在本批顺手改。',
  },
}

/**
 * 环色未走单一真源的**站点数基线**；与「缺环」不同，这类欠账逐条理由都会写成同一句
 * "改焦点态像素需与像素门禁同批" ⇒ 十份同样的散文只会稀释信号，改走计数棘轮。
 *
 * ⚠ 语义是**钉死当前实测**，不是"全时上限"（三轮 i3 指出文案与代码不一致，这里改文案不改判据）。
 * 本文件对每格跑两条方向相反的断言：`实测 ≤ 基线`（上涨即红）与 `基线 ≤ 实测`（基线比实测宽即红），
 * 合起来在代数上就是 `实测 === 基线`。这是**有意的**：只留 `≤` 的那一半，「只能缩小」就没有执行体 ——
 * 有人修好了 3 处却把常量留在 10，后续 3 处新违规会被"还剩 7 个额度"合法吃掉。
 * 因此**收敛一批必须同一次提交把常量改小**，那条红不是假红，它就是"只可缩小"的落地形态。
 * 常量仍可编辑（"加违规 + 同时抬基线"并案提交能过两格），这一格由 M12 变异钉：
 * 它把 actual 固定成 10 之外的值，靠的是判据打印的现值而非代数关系 —— 如实记下这条边界，别把它说成机械闭合。
 */
export const RING_TOKEN_DEBT_BASELINE = 10

/** 缺 transition override 的站点数基线（二轮评审 i1 新增的那一格）。语义与上一条完全相同（含"实测必须等于基线"）。
 *  与环色那一格**同读数**（10）不是巧合：存量那 10 处焦点环是 3.6 批写的，当时既没走令牌也没写 override，
 *  两格量的是同一批历史遗留的两个侧面。两格仍必须**分开记**——收敛其中一格不该让另一格自动变松。 */
export const TRANSITION_DEBT_BASELINE = 10

function walk (dir, exts, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'locales') continue
      walk(join(dir, ent.name), exts, out)
      continue
    }
    if (ent.isFile() && exts.some((e) => ent.name.endsWith(e))) out.push(join(dir, ent.name))
  }
  return out
}

function escapeRe (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/**
 * 类名匹配必须**整词**。⚠ 不能用 `selector.includes('.' + c)`：那是子串匹配，
 * `.col-stat-card-click-ghost:focus-visible` 会被读成「这张卡有环」⇒ 把环挂到一个不存在的类上，
 * 锁照样绿。这条是首轮反证 M10 实测抓出来的（第一版 MISSED）。
 */
export function selectorHitsClass (selector, cls) {
  return new RegExp('\\.' + escapeRe(cls) + '(?![\\w-])').test(selector)
}

/** 一组规则里命中该元素任一 class 的那些（缺环、环色、transition 三格共用同一实现，禁止口径漂移） */
export function ringHits (rules, classes) {
  return rules.filter((r) => classes.some((c) => c !== '__NO_CLASS__' && selectorHitsClass(r.selector, c)))
}

/** CSS 文本里所有 `:focus-visible` 规则块（只应喂 `<style>` 块与 .css 文件，不得喂整份 SFC） */
export function focusVisibleRules (cssText) {
  const out = []
  // 扫描**之前**先把注释整段涂白（三轮 i1）。两个理由各自独立：
  //  ① 判据侧：`includes` 跑在 body 原文上时，"正文硬编码环色 + 注释里抄一遍 var(--color-focus-ring)"
  //     会同时骗过环色与 transition 两格 ⇒ 违规被判成合规。CSS 注释不产生任何计算值，读它等于读散文。
  //  ② 解析侧：`[^{}]+{…}` 对注释里的花括号没有免疫力 —— `/* .ghost:focus-visible { … } */ .real{…}`
  //     会被切成"选择器 = /* .ghost:focus-visible"的伪规则。涂白（按原长度补空格，不位移偏移量）一次解决两格。
  const src = cssText.replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (let m; (m = re.exec(src));) {
    const selector = m[1].trim()
    if (!selector.includes(':focus-visible')) continue
    out.push({ selector, body: m[2] })
  }
  return out
}

/** 模板 AST 里 tabindex="0" 的元素 → { tag, classes }；`:tabindex` 动态绑定刻意不入域 */
export function focusableSitesFromAst (vueSrc) {
  const { descriptor, errors } = parseSfc(vueSrc, { filename: 'probe.vue' })
  if (errors.length) throw new Error('SFC 解析失败 ⇒ 判据无从测量：' + errors.map((e) => e.message).join(';'))
  const ast = descriptor.template && descriptor.template.ast
  if (!ast) throw new Error('模板 AST 取不到（descriptor.template 为空）⇒ 判据失明')
  const sites = []
  const walkAst = (node) => {
    if (node && node.type === 1 && Array.isArray(node.props)) {
      const ti = node.props.find((p) => p.type === 6 && p.name === 'tabindex')
      if (ti && ti.value && ti.value.content === '0') {
        const classes = []
        const cls = node.props.find((p) => p.type === 6 && p.name === 'class')
        if (cls && cls.value) classes.push(...cls.value.content.split(/\s+/).filter(Boolean))
        // :class="{ 'foo': cond }" / :class="['a', cond ? 'b' : '']"：取所有字符串字面量当候选
        // （宁滥勿缺 —— 漏了就是本锁要防的那类静默）；函数调用形态取不到字面量 ⇒ 落到 __NO_CLASS__
        const dyn = node.props.find((p) => p.type === 7 && p.name === 'bind' && p.arg && p.arg.content === 'class')
        if (dyn && dyn.exp) for (const s of dyn.exp.content.matchAll(/'([^']+)'/g)) classes.push(...s[1].split(/\s+/).filter(Boolean))
        sites.push({ tag: node.tag, classes: [...new Set(classes)].length ? [...new Set(classes)] : ['__NO_CLASS__'] })
      }
    }
    for (const k of (node && node.children) || []) walkAst(k)
  }
  walkAst(ast)
  return { sites, styles: descriptor.styles.map((s) => s.content) }
}

describe('可聚焦域合同：模板里 tabindex="0" 的元素必须有 :focus-visible 焦点环', () => {
  const vueFiles = walk(SRC_ROOT, ['.vue'], [])
  const cssFiles = walk(SRC_ROOT, ['.css'], [])
  const parsed = vueFiles.map((p) => {
    const rel = p.slice(SRC_ROOT.length + 1).replace(/\\/g, '/')
    return { rel, ...focusableSitesFromAst(readFileSync(p, 'utf8')) }
  })
  const allCss = cssFiles.map((p) => readFileSync(p, 'utf8')).join('\n')
    + '\n' + parsed.flatMap((x) => x.styles).join('\n')
  const rules = focusVisibleRules(allCss)
  const sites = parsed.flatMap((x) => x.sites.map((s) => ({ file: x.rel, ...s })))

  const hitOf = (s) => ringHits(rules, s.classes)
  const noRing = sites.filter((s) => hitOf(s).length === 0)
  const badToken = sites.filter((s) => { const h = hitOf(s); return h.length > 0 && !h.some((r) => r.body.includes(RING_TOKEN)) })
  const noTransition = sites.filter((s) => { const h = hitOf(s); return h.length > 0 && !h.some((r) => r.body.includes(TRANSITION_OVERRIDE)) })

  it('判定域非空（>100 个 .vue，且确实扫到 tabindex="0" 的可聚焦元素）；三格读数每次打印', () => {
    expect(vueFiles.length, '扫描域退化 ⇒ 本锁看不见任何东西').toBeGreaterThan(100)
    expect(sites.length, '全仓没有 tabindex="0" ⇒ 判据没在测东西（域被改写时当场红）').toBeGreaterThan(0)
    // 每次跑打印域与三格计数：否则"0 违规"与"探针没测到"在产物里同形
    console.log('[FOCUSABLE-DOMAIN] .vue=' + vueFiles.length + ' 可聚焦站点=' + sites.length
      + ' 缺环=' + noRing.length + ' 环色违规=' + badToken.length + ' 缺transition=' + noTransition.length)
    expect(rules.length, '一条 :focus-visible 规则都没解析到 ⇒ CSS 解析退化').toBeGreaterThan(0)
  })

  it('每个可聚焦元素都要有一条命中它的 :focus-visible 规则；环色与 transition 两格的欠账只能缩小', () => {
    const missing = noRing.filter((s) => !(FOCUSABLE_DEBT[s.file] && FOCUSABLE_DEBT[s.file].kind === 'missing'))
      .map((s) => s.file + ' [' + s.tag + ' ' + s.classes.join(' ') + ']')
    expect(missing, '有 tabindex="0" 却没有焦点环规则（键盘用户看不到焦点在哪）：' + missing.join(' | ')).toEqual([])
    console.log('[RING-TOKEN-DEBT] 实测=' + badToken.length + ' 基线=' + RING_TOKEN_DEBT_BASELINE
      + ' 站点：' + badToken.map((s) => s.file).join(' | '))
    expect(badToken.length, '环色未走 ' + RING_TOKEN + ' 的站点数上涨（基线只可缩小）：'
      + badToken.map((s) => s.file).join(' | ')).toBeLessThanOrEqual(RING_TOKEN_DEBT_BASELINE)
    // PRD §一 的 transition override（二轮 i1）：有环但不写 override ⇒ Tab 后读到过渡起点 = 焦点慢半拍
    console.log('[RING-TRANSITION-DEBT] 实测=' + noTransition.length + ' 基线=' + TRANSITION_DEBT_BASELINE
      + ' 站点：' + noTransition.map((s) => s.file).join(' | '))
    expect(noTransition.length, '焦点环规则缺 "' + TRANSITION_OVERRIDE + '"（PRD §一 交互逻辑）的站点数上涨：'
      + noTransition.map((s) => s.file).join(' | ')).toBeLessThanOrEqual(TRANSITION_DEBT_BASELINE)
  })

  it('欠账基线不得变松：清单条目修好即报陈旧，两条计数基线被调大即红', () => {
    const stillMissing = new Set(noRing.map((s) => s.file))
    const stale = Object.entries(FOCUSABLE_DEBT)
      .filter(([f, d]) => d.kind !== 'missing' || !stillMissing.has(f)).map(([f]) => f)
    expect(stale, '欠账条目已不再成立 ⇒ 必须删除（留着就是永久豁免）：' + stale.join(' | ')).toEqual([])
    for (const [f, d] of Object.entries(FOCUSABLE_DEBT)) {
      expect(['missing'], '欠账条目 ' + f + ' 的 kind 目前只支持 missing（环色/transition 欠账走计数基线）').toContain(d.kind)
      expect(d.reason && d.reason.length, '欠账条目 ' + f + ' 的理由过短').toBeGreaterThan(20)
      expect(d.reason, '欠账条目 ' + f + ' 必须写清归属哪一批').toMatch(/批|阶段|审计|待/)
    }
    // 基线不得高于实测：故意调大基线（把"我新增了违规"读成"通过"）在这条上会红
    expect(RING_TOKEN_DEBT_BASELINE, '环色基线比实测宽出 ' + (RING_TOKEN_DEBT_BASELINE - badToken.length)
      + ' 个额度 ⇒ 要么在涨违规，要么把基线调松了；收敛一批应当让它**下降**。').toBeLessThanOrEqual(badToken.length)
    expect(TRANSITION_DEBT_BASELINE, 'transition 基线比实测宽出 ' + (TRANSITION_DEBT_BASELINE - noTransition.length)
      + ' 个额度 ⇒ 同上一条口径，只能下降。').toBeLessThanOrEqual(noTransition.length)
  })

  it('解析器自身（AST 化）：<script> 里的 tabindex 字符串不是站点、CSS 只取自 style 块', () => {
    const src = [
      '<template>',
      '  <!-- 旧写法：<div tabindex="0" class="dead-ghost">x</div> -->',
      '  <div class="real" tabindex="0">y</div>',
      '</template>',
      '<script setup>',
      'const legacy = "<div tabindex=\'0\' class=\'in-script\'></div>"',
      '</scr' + 'ipt>',
      '<style>',
      '.real:focus-visible { outline: 2px solid var(--color-focus-ring); }',
      '.from-script-class:focus-visible { outline: 2px solid red; }',
      '</style>',
    ].join('\n')
    const { sites: s2, styles: st2 } = focusableSitesFromAst(src)
    expect(s2, '模板注释里的示例、<script> 字符串里的 tabindex 都不得算站点').toEqual([{ tag: 'div', classes: ['real'] }])
    expect(st2.length, 'style 源必须是逐个 <style> 块（第一版是把整份 SFC 当 CSS 喂进去的）').toBe(1)
    // CSS 源只取 <style> 块 ⇒ 模板/脚本里的 ":focus-visible {" 之类文本不会变成伪规则
    const polluted = [
      '<template>',
      '  <div class="c" tabindex="0">文本书写：:focus-visible { color: red }</div>',
      '</template>',
      '<style>',
      '.c:focus-visible { outline: 2px solid var(--color-focus-ring); }',
      '</style>',
    ].join('\n')
    const { styles: st3 } = focusableSitesFromAst(polluted)
    expect(st3[0].includes('文本书写'), '模板文本混进了 CSS 源 ⇒ 那段 ":focus-visible {" 会被当成规则（第一版正是这么读的）').toBe(false)
    expect(focusVisibleRules(st3[0]).map((r) => r.selector.trim()), '从 style 块解析出的规则集被污染').toEqual(['.c:focus-visible'])
  })

  it('解析器自身（三轮 i1）：注释里的令牌不算声明，正文真写了才算', () => {
    // 走私形态：正文硬编码环色、注释里把令牌与 override 原样抄一遍 —— 旧实现在整段 body 上做
    // includes，两格同时被骗。CSS 注释不产生计算值，用户拿到的仍然是硬编码粉色焦点环。
    const smuggled = ['.x:focus-visible {', '  outline: 2px solid #ff0055;',
      '  /* var(--color-focus-ring) 以及 outline-color 0s, outline-width 0s, outline-offset 0s */', '}'].join('\n')
    const [r] = focusVisibleRules(smuggled)
    expect(r, '规则本身要能被解析到（不能因为剥注释把整块吃掉）').toBeTruthy()
    expect(r.body.includes(RING_TOKEN), '注释里的令牌被当成真声明 ⇒ 硬编码环色会判绿').toBe(false)
    expect(r.body.includes(TRANSITION_OVERRIDE), '同上：注释里的 override 不算写了 override').toBe(false)
    // 对偶（合规形态必须绿）：正文真的写了令牌与 override，注释随便写别的
    const honest = ['.y:focus-visible {', '  outline: 2px solid var(--color-focus-ring);',
      '  transition: outline-color 0s, outline-width 0s, outline-offset 0s;', '  /* 见 PRD §一 */', '}'].join('\n')
    const [h] = focusVisibleRules(honest)
    expect(h.body.includes(RING_TOKEN), '合法写法被判红 = 锁把自己的修复路径焊死').toBe(true)
    expect(h.body.includes(TRANSITION_OVERRIDE), '同上').toBe(true)
  })

  // 拆成独立用例的理由（不并进上一条）：vitest 在第一条断言失败即中止该 it，
  // 若两格理由写在一起，M19 只会显出**第一条**红 ⇒ "注释里的花括号会切坏规则边界"这一格
  // 永远拿不到自己的现场证据（每条变异各测一处，不合并计一条）。
  it('解析器自身（三轮 i1·解析侧）：注释里的花括号不得把伪规则切进判定域', () => {
    const commented = '/* .ghost:focus-visible { outline: 1px solid } */ .real:focus-visible { outline: 2px solid var(--color-focus-ring) }'
    const rs = focusVisibleRules(commented)
    expect(rs.map((x) => x.selector), '注释里的伪规则不得进判定域（`[^{}]+{…}` 对注释内的花括号没有免疫力）')
      .toEqual(['.real:focus-visible'])
    // 对偶：真规则后面挂一条普通注释，不得把真规则自己也吃掉
    const tail = '.real:focus-visible { outline: 2px solid var(--color-focus-ring) } /* 收尾说明 */'
    expect(focusVisibleRules(tail).map((x) => x.selector)).toEqual(['.real:focus-visible'])
  })

  it('解析器自身：动态 :class 必须进判定域，无类名的可聚焦元素必须出声', () => {
    const dyn = focusableSitesFromAst(['<template>', '  <div class="a" :class="{ \'b\': on }" tabindex="0">x</div>', '</template>'].join('\n'))
    expect(dyn.sites).toHaveLength(1)
    expect(dyn.sites[0].classes).toEqual(expect.arrayContaining(['a', 'b']))
    const bare = focusableSitesFromAst(['<template>', '  <div tabindex="0">x</div>', '</template>'].join('\n'))
    expect(bare.sites[0].classes, '没有 class 的可聚焦元素必须出声而不是静默跳过').toEqual(['__NO_CLASS__'])
    const neg = focusableSitesFromAst(['<template>', '  <div tabindex="-1" class="not-in-domain">x</div>', '</template>'].join('\n'))
    expect(neg.sites, 'tabindex="-1" 不可 Tab 到达，不该进域（域定义错了会把无关规则算成违规）').toEqual([])
  })

  it('类名匹配必须整词：把环挂到 xxx-ghost 这类前缀扩展名上不得算命中', () => {
    expect(selectorHitsClass('.col-stat-card-click:focus-visible', 'col-stat-card-click')).toBe(true)
    expect(selectorHitsClass('.col-stat-card-click-ghost:focus-visible', 'col-stat-card-click'),
      '前缀扩展的类名不是同一个类 ⇒ 命中即为假绿').toBe(false)
    expect(selectorHitsClass('.col-stat-card-click-ghost:focus-visible', 'col-stat-card-click-ghost')).toBe(true)
    expect(selectorHitsClass('.a, .col-stat-card-click:hover, .b', 'col-stat-card-click')).toBe(true)
    expect(ringHits([{ selector: '.x-ghost:focus-visible', body: 'outline: 2px solid' }], ['x']).length).toBe(0)
  })
})
