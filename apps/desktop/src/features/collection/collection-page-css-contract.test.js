/**
 * collection-page-css-contract.test.js — 采集页控件规范契约锁
 *
 * **动因（2026-10-17 用户真机走查，判据全部取产物）**：
 *   用户反馈采集页「视觉上都很散乱，不够统一和清晰，也不够精致高级」。
 *   逐条取证（PRD §1 共 15 项）后定位到三层根因，其中**最关键的一层是
 *   「消费了不存在的 class」**：
 *     · `is-primary`（CollectedResultsList.vue:99/100）—— 全仓 0 处样式定义，
 *       于是「创建草稿/发布为 primary、查看/视频创作为 secondary」这条分级
 *       在**视觉上完全不成立**（两者长得一模一样）；
 *     · `class="primary"`（Collection.vue:328、CollectionDraftsPanel.vue:56）—— 同理；
 *     · `collection-tab-badge`（两个页签组件在用）—— 无定义 ⇒ 角标是裸文本。
 *   而既有测试只断言「class 名存在」，不断言「class 有样式」⇒ 功能测试全绿
 *   也永远看不见这批缺陷。本文件把这条判据补上。
 *
 * 四条不可省：
 *   ① `--col-*` 新槽在 tokens.css 亮/暗两档均有定义且暗色真覆盖；
 *   ② 采集域 7 个渲染层文件的 `<style>` 块无 hex 字面量（SCOPE 比
 *      collection-tokens.test.js 多 3 个：QuickCollectPanel / QuickCollectCommandDialog /
 *      CollectionDraftsPanel —— 后者此前不在任何 hex 门禁里，属门禁盲区）；
 *   ③ **「消费的类必须有定义」**：枚举各文件 `<template>` 里的静态 class token，
 *      域内命名空间（col-/zb-/qc-/card-/batch-/stat-/copy-/tag-/library-/asr-/creator-/history-）
 *      逐个必须在 collection-page.css 或该组件自身 `<style>` 中找到 `.token {` 规则；
 *   ④ 两个历史死类 `is-primary` / `primary` 在采集域 0 消费。
 *
 * 判据有效性自反锁（AGENTS QM-2）：
 *   · 结构解析类判据**必须打印命中条数并对命中数做下界断言** ——
 *     裸 `/from\s+…/` 形态会匹配 0 条并算出「闭包 = 已导入」的假结论（同族事故见
 *     element-plus 按需引入那轮）。故 `collectStaticClassTokens()` 返回后断言
 *     `tokens.length >= 20`，`findRule()` 的命中数同样有下界。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 采集域渲染层文件（相对本测试目录） */
const SCOPE_VUE = [
  '../../views/Collection.vue',
  './BatchCollectPanel.vue',
  './CollectedResultsList.vue',
  './ColProgressBlock.vue',
  './CollectionDraftsPanel.vue',
  './QuickCollectPanel.vue',
  './QuickCollectCommandDialog.vue',
  './CollectionDraftsTab.vue',
  './CollectionCreatorTab.vue',
]

const PAGE_CSS_REL = './collection-page.css'
const LEGACY_CSS_REL = './collection-page-legacy.css'
const TOKENS_CSS_REL = '../../styles/tokens.css'

/** 规范层 = 主规范 + 历史类名收编（check-max-lines 500 行硬限的拆分产物，两者同属一层） */
const pageCssOf = () => stripComments(read(PAGE_CSS_REL)) + '\n' + stripComments(read(LEGACY_CSS_REL))

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g

/** 域内命名空间前缀：这些 token 必须在采集域样式层有定义。
 *  全局层（cohere-/mp-/el-/empty-state/…）不归本判据管——那是 cohere-design-system 的面。 */
const DOMAIN_PREFIXES = [
  'col-', 'zb-', 'qc-', 'card-', 'batch-', 'stat-', 'copy-', 'tag-',
  'library-', 'asr-', 'creator-', 'history-', 'col', 'batch', 'stat',
]

/** 两个历史死类：全仓 0 处样式定义，却被三处消费 ⇒ 分级/角标在视觉上不成立 */
const DEAD_CLASSES = ['is-primary', 'primary']

function stripComments (css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 取文件的 <template> 块（无 template 的组件返回 ''） */
function templateOf (src) {
  const m = src.match(/<template[^>]*>([\s\S]*?)<\/template>/)
  return m ? m[1] : ''
}

/** 取文件的 <style scoped> 块内容（合并所有 style 块） */
function styleOf (src) {
  return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
}

/**
 * 抽取模板里的**静态** class token。
 * 只认 `class="..."` 的字符串字面量；`:class="{...}"` / `:class="[expr]"` 的动态部分
 * 不进判据（那需要求值，属组件行为测试的面，不是 CSS 契约的面）。
 * 动态对象里的键名若含域内前缀，由各组件自己的测试断言（本轮不扩到那里）。
 */
function collectStaticClassTokens (src) {
  const tpl = templateOf(src)
  const out = new Set()
  for (const m of tpl.matchAll(/\sclass="([^"]*)"/g)) {
    for (const tok of m[1].split(/\s+/)) {
      if (tok) out.add(tok)
    }
  }
  return [...out]
}

/**
 * 在 CSS 文本中找 `.token` 的规则体。
 * 支持三种形态：`.a {`、`.a, .b {`（选择器列表——**每个成员都要能命中**）、
 * `.a.b {`（复合）。实现上先把每条规则的**选择器部分**按逗号切开逐个比对，
 * 避免「只认第一个选择器」导致的漏判（实测：`.col-btn-cancel, .col-btn-clear {`
 * 用整体正则会漏掉第二个成员）。
 */
function findRule (css, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 抓所有规则的「选择器 { 」前缀
  const ruleHeads = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1])
  const tokenRe = new RegExp('(?:^|[\\s,>+~])?\\.' + esc + '(?:[\\w-]|$)', 'm')
  return ruleHeads.some((head) =>
    head.split(',').some((sel) => tokenRe.test(sel.trim()))
  )
}

// ────────────────────────────────────────────────────────────────────────────

describe('采集页 --col-* 新槽契约（亮暗两档）', () => {
  const tokensCss = read(TOKENS_CSS_REL)

  function readVarBlock (css, scope) {
    const re = scope === 'dark' ? /^\[data-theme="dark"\]\s*\{/m : /^:root\s*\{/m
    const m = re.exec(css)
    expect(m, `${scope} 块应存在`).toBeTruthy()
    const start = m.index
    // 从选择器后的第一个 { 开始配平；depth 先置 1（已进入一层）
    let depth = 1
    let i = css.indexOf('{', start) + 1
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    return css.slice(start, i)
  }

  const light = readVarBlock(tokensCss, 'light')
  const dark = readVarBlock(tokensCss, 'dark')

  const NEW_SLOTS = [
    '--col-field-h', '--col-field-h-sm', '--col-field-pad', '--col-btn-h',
    '--col-panel-pad', '--col-card-pad', '--col-banner-pad',
    '--color-tab-active-bg', '--shadow-tab-active',
  ]

  /** 尺寸类槽：不随主题变（与间距槽、圆角槽同理），只在亮色区声明一次。
   *  把它们也要求「暗色真覆盖」会逼出无意义的重复声明（design token 反模式）。 */
  const SIZE_SLOTS = [
    '--col-field-h', '--col-field-h-sm', '--col-field-pad', '--col-btn-h',
    '--col-panel-pad', '--col-card-pad', '--col-banner-pad',
  ]
  /** 主题敏感槽：暗色必须真覆盖 */
  const THEME_SLOTS = ['--color-tab-active-bg', '--shadow-tab-active']

  it.each(SIZE_SLOTS)('%s 在亮色区有定义且不在暗色区重复（尺寸不随主题变）', (slot) => {
    const lightDecl = light.match(new RegExp(slot.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'))
    expect(lightDecl, `${slot} 缺亮色定义`).toBeTruthy()
    const darkDecl = dark.match(new RegExp(slot.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'))
    expect(darkDecl, `${slot} 不应在暗色区重复声明（尺寸与主题无关）`).toBeFalsy()
  })

  it.each(THEME_SLOTS)('%s 在亮色与暗色均定义且暗色真覆盖', (slot) => {
    const lightDecl = light.match(new RegExp(slot.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'))
    const darkDecl = dark.match(new RegExp(slot.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'))
    expect(lightDecl, `${slot} 缺亮色定义`).toBeTruthy()
    expect(darkDecl, `${slot} 缺暗色定义`).toBeTruthy()
    expect(darkDecl[1].trim(), `${slot} 暗色值与亮色相同，主题切换将失效`).not.toBe(lightDecl[1].trim())
  })

  it('规范层默认值副本与 tokens.css 逐字一致（双声明不得漂移）', () => {
    // collection-page.css 持有一份默认值副本（import 顺序不保证时兜底）。
    // 两处一致性只能靠机械核对 —— 靠「记得同改」必然漂移。
    const pageCss = pageCssOf()
    for (const slot of NEW_SLOTS) {
      const inPage = pageCss.match(new RegExp(slot.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'))
      const inTokens = tokensCss.match(new RegExp(slot.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'))
      if (!inPage) continue // 尺寸槽在规范层有副本；主题槽只在 tokens 声明也合法
      expect(inTokens, `${slot} 在规范层有默认值但 tokens.css 没有权威定义`).toBeTruthy()
      expect(inPage[1].trim(), `${slot} 规范层副本与 tokens.css 不一致`).toBe(inTokens[1].trim())
    }
  })
})

describe('采集域 hex 硬编码门禁（范围含快捷采集面板与指令弹窗）', () => {
  it.each(SCOPE_VUE)('%s 的 <style> 块无 hex 字面量', (rel) => {
    const src = read(rel)
    const styleMatch = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)
    if (!styleMatch) return // 纯结构组件（页签按钮等）无样式块，样式由规范层统一持有
    const hits = stripComments(styleMatch[1]).match(HEX_RE) || []
    expect(hits, `发现硬编码色值: ${hits.join(', ')}`).toEqual([])
  })

  it('Collection.vue 模板内联 style 无 hex', () => {
    const src = read('../../views/Collection.vue')
    const template = templateOf(src)
    const inlineStyles = [...template.matchAll(/style="([^"]*)"/g)].map((m) => m[1])
    for (const s of inlineStyles) {
      expect(s, `内联样式含 hex: ${s}`).not.toMatch(HEX_RE)
    }
  })
})

describe('消费的类必须有定义（防「抄了类名没抄定义」）', () => {
  const pageCss = pageCssOf()

  it('判据自反锁：抽取器确有命中（防解析退化算出假结论）', () => {
    const src = read('../../views/Collection.vue')
    const tokens = collectStaticClassTokens(src)
    // 下界断言：Collection.vue 模板静态 class 远多于 20 个。
    // 若正则改坏导致匹配 0 条，下面所有「必须有定义」都会恒真 —— 这道锁就是为了那种形态。
    expect(tokens.length, 'class token 抽取命中数异常低，解析判据已退化').toBeGreaterThanOrEqual(20)
  })

  it.each(SCOPE_VUE)('%s 的域内静态 class 均有样式定义', (rel) => {
    const src = read(rel)
    const ownStyle = stripComments(styleOf(src))
    const missing = []
    for (const tok of collectStaticClassTokens(src)) {
      const isDomain = DOMAIN_PREFIXES.some((p) => tok === p || tok.startsWith(p + '-') || tok.startsWith(p + '__'))
      if (!isDomain) continue
      if (!findRule(pageCss, tok) && !findRule(ownStyle, tok)) missing.push(tok)
    }
    expect(missing, `以下域内 class 被消费但无定义: ${missing.join(', ')}`).toEqual([])
  })

  it('判据自反锁：findRule 对已知定义的类返回真', () => {
    expect(findRule(pageCss, 'col-btn--primary'), 'col-btn--primary 应在规范层有定义').toBe(true)
    expect(findRule(pageCss, 'col-tab-badge'), 'col-tab-badge 应在规范层有定义').toBe(true)
  })
})

describe('历史死类清零', () => {
  it.each(SCOPE_VUE)('%s 不消费 is-primary / primary 死类', (rel) => {
    const src = read(rel)
    for (const dead of DEAD_CLASSES) {
      // 只查模板里的 class 用法（`class="primary"` / `class="a primary"`），
      // 不查 CSS 里的 `.primary {`（本轮就是要新增它的合法替身，不是这个名字）。
      const usage = new RegExp('class="[^"]*(?:^|\\s)' + dead.replace(/-/g, '\\-') + '(?:\\s|$)"')
      expect(usage.test(src), `${rel} 仍消费死类 ${dead}`).toBe(false)
    }
  })

  it('页面规范层定义了 primary/secondary/danger 三档按钮', () => {
    const pageCss = pageCssOf()
    for (const variant of ['primary', 'secondary', 'danger', 'ghost']) {
      expect(findRule(pageCss, 'col-btn--' + variant), `col-btn--${variant} 应有定义`).toBe(true)
    }
  })
})
