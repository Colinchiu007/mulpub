/**
 * focusable-ring-contract.test.js — 凡模板里带 `tabindex="0"` 的元素必须有 `:focus-visible` 焦点环
 * （UX 审计 3.6 与 4.4 之间的缺口 / WCAG 2.4.7 Focus Visible；动因是 #4088 的 QM-6 评审 i1）
 *
 * 为什么单独一把锁：`styles/focus-ring.test.js`（3.6）的判定域**按设计只收按钮类**，
 * 它自己的头注释写着「`<div class="cohere-btn-*" @click>` ⇒ 属阶段 4.4，不在本判据域内」。
 * 而 4.4 那批把 6 张卡片变成了 `tabindex="0"` 可聚焦元素，却没有同时给焦点环 ——
 * 也就是说：**3.6 不管它，4.4 不看环**，两把锁之间留了一条缝，键盘用户按 Tab 走到卡片上
 * 看不到焦点在哪。这条锁就是把缝闭上：**判定域 = 模板里所有 tabindex="0" 的元素**。
 *
 * 判据取"环是否存在"而不是"环长什么样"：颜色由 `tokens.css` 的 `--color-focus-ring` 单一真源持有
 * （浅/暗两档各自映射），所以本锁只要求"有一条命中该类的 :focus-visible 规则且用了该令牌"，
 * 不重复规定线宽 —— 那是 3.6 那把锁的域。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(HERE, '.')
const RING_TOKEN = '--color-focus-ring'

/**
 * 存量欠账（文件 → { 缺环 | 环色不走单一真源, 理由 }）。**只能缩小**；
 * 条目修好后必须删除（留着就是永久豁免）。
 * 上线三步序（评审否证后补的本仓纪律）：新门禁先建"只可缩小"的基线，
 * 不得要求本批把全仓历史一次修完——那会把这道锁变成阻塞所有 PR 的常量红。
 */
export const FOCUSABLE_DEBT = {
  'components/SidebarServiceStatus.vue': {
    kind: 'missing',
    reason: '该 span 的 tabindex="0" 早于本批（阶段 1「服务状态」接线批次引入），不在 4.4 的改动面上。'
      + '补环会改渲染结果、需与像素门禁同批 —— 归阶段 1 收尾批（与审计 2.4 的通知批次）一起做。',
  },
}

/**
 * 环色未走单一真源（`--color-focus-ring`）的**站点数基线**。
 *
 * 为什么按计数而不是逐文件记账：本批实测有 10 处（分布在 9 个文件），每条理由都会写成
 * "改焦点态像素需与像素门禁同批" —— 十份同样的散文只会稀释信号。改走本仓既有的基线式门禁
 * 口径：**只可缩小、上涨即红、当场打印现值**，收敛一批就抬一次（与
 * 「基线式门禁一律只可缩小」「新门禁上线三步序」两条纪律一致）。
 */
export const RING_TOKEN_DEBT_BASELINE = 10

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

/** 等长涂白：注释里的 tabindex 示例不得算站点（同叶子角色锁判据） */
function blankComments (src) {
  const n = src.length
  const hide = new Uint8Array(n)
  for (let at = src.indexOf('<!--'); at >= 0;) {
    const close = src.indexOf('-->', at + 4)
    const stop = close < 0 ? n : close + 3
    hide.fill(1, at, stop)
    at = close < 0 ? -1 : src.indexOf('<!--', stop)
  }
  for (let at = src.indexOf('/*'); at >= 0;) {
    const close = src.indexOf('*/', at + 2)
    if (close < 0) break
    hide.fill(1, at, close + 2)
    at = src.indexOf('/*', close + 2)
  }
  let out = ''
  for (let i = 0; i < n;) {
    let j = i
    while (j < n && hide[j] === hide[i]) j += 1
    out += hide[i] ? src.slice(i, j).replace(/[^\n]/g, ' ') : src.slice(i, j)
    i = j
  }
  return out
}

/** 模板里 tabindex="0" 的元素 → 它的 class 列表 */
export function focusableSites (vueSrc) {
  const src = blankComments(vueSrc.replace(/\r\n/g, '\n'))
  const sites = []
  const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g
  for (let m; (m = re.exec(src));) {
    const attrs = m[2]
    if (!/(?:^|\s)tabindex\s*=\s*"0"/.test(attrs)) continue
    const cm = /(?:^|\s)(?:::)?class\s*=\s*"([^"]*)"/.exec(attrs)
    const classes = cm ? cm[1].split(/\s+/).filter(Boolean) : []
    // :class="{ 'foo': cond }" / :class="['a', cond ? 'b' : '']" 这类动态绑定也要认：
    // 取里面出现的所有字符串字面量当候选类名（宁滥勿缺 —— 漏了就是本锁要防的那类静默）
    const dyn = /:class\s*=\s*"([^"]*)"/.exec(attrs)
    if (dyn) for (const s of dyn[1].matchAll(/'([^']+)'/g)) classes.push(...s[1].split(/\s+/).filter(Boolean))
    if (classes.length === 0) classes.push('__NO_CLASS__')
    sites.push({ tag: m[1], classes: [...new Set(classes)] })
  }
  return sites
}

/** CSS（含 .vue 的 <style> 块）里所有 `:focus-visible` 规则块 */
export function focusVisibleRules (cssText) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  const src = cssText.replace(/\r\n/g, '\n')
  for (let m; (m = re.exec(src));) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (!selector.includes(':focus-visible')) continue
    out.push({ selector, body: m[2] })
  }
  return out
}

/**
 * 某元素的一组类名是否被这条选择器**整词**命中。
 * ⚠ 不能用 `selector.includes('.' + c)`：那是子串匹配，`.col-stat-card-click-ghost:focus-visible`
 * 会把 `.col-stat-card-click` 算成命中 ⇒ 把环挂到一个不存在的类上，锁照样绿。
 * 这条是反证 M10 实测抓出来的（第一版 MISSED）。
 */
function escapeRe (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
export function selectorHitsClass (selector, cls) {
  return new RegExp('\\.' + escapeRe(cls) + '(?![\\w-])').test(selector)
}

/** 一组规则里命中该元素任一 class 的那些（结构锁与棘轮锁共用同一实现，禁止两份口径漂移） */
export function ringHits (rules, classes) {
  return rules.filter((r) => classes.some((c) => c !== '__NO_CLASS__' && selectorHitsClass(r.selector, c)))
}

describe('可聚焦域合同：模板里 tabindex="0" 的元素必须有 :focus-visible 焦点环', () => {
  const vueFiles = walk(SRC_ROOT, ['.vue'], [])
  const cssFiles = walk(SRC_ROOT, ['.css'], [])
  const styleBlocks = vueFiles.map((p) => readFileSync(p, 'utf8')).join('\n')
  const allCss = cssFiles.map((p) => readFileSync(p, 'utf8')).join('\n') + '\n' + styleBlocks
  const rules = focusVisibleRules(allCss)

  const sites = []
  for (const p of vueFiles) {
    for (const s of focusableSites(readFileSync(p, 'utf8'))) {
      sites.push({ file: p.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'), ...s })
    }
  }

  it('判定域非空（>100 个 .vue，且确实扫到 tabindex="0" 的可聚焦元素）', () => {
    expect(vueFiles.length, '扫描域退化 ⇒ 本锁看不见任何东西').toBeGreaterThan(100)
    expect(sites.length, '全仓没有 tabindex="0" ⇒ 判据没在测东西（域被改写时当场红）').toBeGreaterThan(0)
    // 每次跑打印域与两个违规计数：否则"0 违规"与"探针没测到"在产物里同形
    console.log('[FOCUSABLE-DOMAIN] .vue=' + vueFiles.length + ' 可聚焦站点=' + sites.length
      + ' 缺环=' + sites.filter((s) => ringHits(rules, s.classes).length === 0).length
      + ' 环色违规=' + sites.filter((s) => { const h = ringHits(rules, s.classes); return h.length > 0 && !h.some((r) => r.body.includes(RING_TOKEN)) }).length)
  })

  it('每个可聚焦元素都要有一条命中它的 :focus-visible 规则；环色走令牌的欠账只能缩小', () => {
    const missing = []
    const wrongToken = []
    for (const s of sites) {
      const hit = ringHits(rules, s.classes)
      const debt = FOCUSABLE_DEBT[s.file]
      if (hit.length === 0) {
        if (debt && debt.kind === 'missing') continue
        missing.push(s.file + ' [' + s.tag + ' ' + s.classes.join(' ') + ']')
        continue
      }
      if (!hit.some((r) => r.body.includes(RING_TOKEN))) wrongToken.push(s.file + ' :: ' + hit.map((r) => r.selector.slice(0, 46)).join(' / '))
    }
    expect(missing, '有 tabindex="0" 却没有焦点环规则（键盘用户看不到焦点在哪）：' + missing.join(' | ')).toEqual([])
    // 计数棘轮：现值必须打印（"0 违规"与"探针没测到"必须可区分），且只可缩小
    console.log('[RING-TOKEN-DEBT] 实测=' + wrongToken.length + ' 基线=' + RING_TOKEN_DEBT_BASELINE + ' 站点：' + wrongToken.join(' | '))
    expect(wrongToken.length, '环色未走 ' + RING_TOKEN + ' 的站点数上涨（基线只可缩小）：' + wrongToken.join(' | '))
      .toBeLessThanOrEqual(RING_TOKEN_DEBT_BASELINE)
  })

  it('欠账基线不得变松：清单条目修好即报陈旧，计数基线被调大即红', () => {
    const stillMissing = new Set()
    let ringDebt = 0
    for (const s of sites) {
      const hit = ringHits(rules, s.classes)
      if (hit.length === 0) stillMissing.add(s.file)
      else if (!hit.some((r) => r.body.includes(RING_TOKEN))) ringDebt += 1
    }
    const stale = Object.entries(FOCUSABLE_DEBT).filter(([f, d]) => d.kind !== 'missing' || !stillMissing.has(f)).map(([f]) => f)
    expect(stale, '欠账条目已不再成立 ⇒ 必须删除（留着就是永久豁免）：' + stale.join(' | ')).toEqual([])
    for (const [f, d] of Object.entries(FOCUSABLE_DEBT)) {
      expect(['missing'], '欠账条目 ' + f + ' 的 kind 目前只支持 missing（环色欠账走计数基线）').toContain(d.kind)
      expect(d.reason && d.reason.length, '欠账条目 ' + f + ' 的理由过短').toBeGreaterThan(20)
      expect(d.reason, '欠账条目 ' + f + ' 必须写清归属哪一批').toMatch(/批|阶段|审计|待/)
    }
    // 基线不得高于实测 + 0：故意调大基线（把"我新增了违规"读成"通过"）在这条上会红
    expect(RING_TOKEN_DEBT_BASELINE, '环色基线比实测宽出 ' + (RING_TOKEN_DEBT_BASELINE - ringDebt)
      + ' 个额度 ⇒ 要么在涨违规，要么把基线调松了；收敛一批应当让它**下降**。').toBeLessThanOrEqual(ringDebt + 0)
  })

  it('解析器自身：注释里的 tabindex 示例不得算站点，动态 :class 必须进判定域', () => {
    const commented = ['<template>', '  <!-- 旧写法：<div tabindex="0" class="dead-ghost">x</div> -->', '  <div class="real">y</div>', '</template>'].join('\n')
    expect(focusableSites(commented), '注释里的示例被当成站点 ⇒ 误报').toEqual([])

    const dyn = focusableSites('<template><div class="a" :class="{ \'b\': on }" tabindex="0">x</div></template>')
    expect(dyn).toHaveLength(1)
    expect(dyn[0].classes).toEqual(expect.arrayContaining(['a', 'b']))

    const bare = focusableSites('<template><div tabindex="0">x</div></template>')
    expect(bare[0].classes, '没有 class 的可聚焦元素必须出声而不是静默跳过').toEqual(['__NO_CLASS__'])
  })

  it('类名匹配必须整词：把环挂到 xxx-ghost 这类前缀扩展名上不得算命中', () => {
    // 反证 M10 的现场：第一版判据是 selector.includes('.' + c)，于是
    // `.col-stat-card-click-ghost:focus-visible` 被读成"这张卡有环" ⇒ 摘掉真规则照样绿。
    expect(selectorHitsClass('.col-stat-card-click:focus-visible', 'col-stat-card-click')).toBe(true)
    expect(selectorHitsClass('.col-stat-card-click-ghost:focus-visible', 'col-stat-card-click'),
      '前缀扩展的类名不是同一个类 ⇒ 命中即为假绿').toBe(false)
    expect(selectorHitsClass('.col-stat-card-click-ghost:focus-visible', 'col-stat-card-click-ghost')).toBe(true)
    expect(selectorHitsClass('.a, .col-stat-card-click:hover, .b', 'col-stat-card-click')).toBe(true)
    expect(ringHits([{ selector: '.x-ghost:focus-visible', body: 'outline: 2px solid' }], ['x']).length).toBe(0)
  })
})
