#!/usr/bin/env node
// @ts-check
/**
 * check-label-association.js — `<label>` 必须与控件关联（存量按文件份数只可缩小）
 *
 * 动因（UX 审计 §14 audit-50 / 阶段 4.3）：读屏软件靠 **关联** 才知道这块文字是哪个控件的名字。
 * 没关联的 `<label>` 对键盘/读屏用户就是"点不动、念不出"的死文字；而它在像素上完全正常，
 * 所以视觉门禁与肉眼审查都看不见（本仓「装饰性门禁」在无障碍维度的同型）。
 *
 * ## 判据取自 HTML 规范的两种合法关联，不是风格偏好
 *  ① **显式**：`for` / `:for` / `v-bind:for` 指向某个控件的 `id`；
 *  ② **隐式（capturing label）**：`<label>` 的**后代里有一个原生表单控件**
 *     （input / select / textarea / button / meter / output / progress / object，且非 hidden/disabled 之外都算）。
 *
 * ## 关键的一条：自定义组件不算"原生控件"
 * `<label><MyInput /></label>` 或 `<label><el-input /></label>` **不构成关联** ——
 * HTML 规范的 capturing label 只认 form-associated 元素，Vue 组件渲染出的东西在解析期不可知。
 * 所以这类写法必须补 `for`。这一条是判据的主要"抓人"处，也是它容易被写成假判据的地方：
 * 若把 `<el-input>` 也算控件，现场读数会从数百掉到个位数，看起来"几乎没问题"，实际什么都没守。
 *
 * ## 三条口径
 *  ① **按文件计份数**（同 `check-toast-single-exit.js` / `check-vfor-stable-key.js`）：
 *     一个文件从 3 处涨到 4 处必须红；"该文件已在基线里"这种存在性判据对此完全免疫。
 *  ② **扫标签必须带引号状态机**：模板里 `:class="a > b ? 'x' : 'y'"` 的 `>` 不是标签结束，
 *     用朴素 `<label([^>]*)>` 会在属性值里截断，使该处静默漏扫（本仓在同族判据上真实踩过）。
 *  ③ **判据失明必须出声**：扫描域为空 / 一个 `<label` 都没解析出来 / 基线读不到 ⇒ rc=2，
 *     不得把"0 命中"读成"0 违规"。
 *
 * 用法：node scripts/check-label-association.js [--json | --write-baseline]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const BASELINE_PATH = path.join(__dirname, 'label-association-baseline.json')
const SCAN_ROOT = 'apps/desktop/src'

/**
 * HTML 规范里的 form-associated 元素（自定义组件与 el-* 一律不在表内，见文件头）。
 * ⛔ 必须匹配**开标签形态** `<(input|...)\b`，不能只匹配词：
 *   `/\b(input|...)\b/` 会把 `<el-input>` 也算控件（`-` 是非词字符 ⇒ 存在词边界），
 *   于是判据在真实仓上被写宽 —— 本仓第一版就是这样，被自家用例 ② 当场抓出后重算基线。
 */
const NATIVE_CONTROLS = /<(input|select|textarea|button|meter|output|progress|object)\b/i
/** 显式关联：for / :for / v-bind:for（值必须是可读的 id 引用，空串不算） */
const FOR_ATTR = /(?:^|\s)(?::for|v-bind:for|for)\s*=\s*(?:"([^"]*)"|'([^']*)')/
/** `<label>` 与 `<legend>` 都承担命名职责，一并纳入（legend 的关联规则同 label） */
const TAG_RE = /<(label|legend)\b/gi
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

/**
 * 从 `i`（指向 `<` 之后）起按引号状态机取出这个标签的属性串与其结束位置。
 * @returns {{attrs:string, end:number}|null}
 */
function readTag (src, i) {
  let j = i
  let quote = null
  while (j < src.length) {
    const c = src[j]
    if (quote) { if (c === quote) quote = null } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return { attrs: src.slice(i, j), end: j }
    j++
  }
  return null
}

/**
 * 取出与开标签配平的闭标签内容区间（label 不嵌套 label；遇到内层同名开标签时按深度走）。
 * @returns {{body:string, end:number}|null}
 */
function readElement (src, from, tag) {
  const openRe = new RegExp('<' + tag + '\\b', 'gi')
  const closeRe = new RegExp('</' + tag + '\\s*>', 'gi')
  let depth = 1
  let p = from
  while (p < src.length) {
    openRe.lastIndex = p; closeRe.lastIndex = p
    const o = openRe.exec(src); const c = closeRe.exec(src)
    if (!c) return null
    if (o && o.index < c.index) { depth++; p = o.index + o[0].length; continue }
    depth--
    if (depth === 0) return { body: src.slice(from, c.index), end: c.index }
    p = c.index + c[0].length
  }
  return null
}

/**
 * 单个文件的未关联 `<label>`/`<legend>` 处数。
 * @param {string} src
 * @returns {{bad:number, total:number, unclosed:number, lines:number[]}}
 */
function scanSource (src) {
  const clean = src.replace(HTML_COMMENT_RE, '')
  let total = 0, bad = 0, unclosed = 0
  const lines = []
  let m
  const re = new RegExp(TAG_RE.source, 'gi')
  while ((m = re.exec(clean))) {
    const tag = m[1].toLowerCase()
    const at = m.index + m[0].length
    const t = readTag(clean, at)
    if (!t) { unclosed++; continue }
    total++
    const el = readElement(clean, t.end + 1, tag)
    if (!el) { unclosed++; continue }
    const f = FOR_ATTR.exec(t.attrs)
    const forVal = f ? (f[1] === undefined ? f[2] : f[1]) : null
    const hasFor = !!(forVal && forVal.trim())
    const hasControl = NATIVE_CONTROLS.test(el.body)
    if (!hasFor && !hasControl) {
      bad++
      lines.push(clean.slice(0, m.index).split('\n').length)
    }
    re.lastIndex = el.end
  }
  return { bad, total, unclosed, lines }
}

/**
 * @param {string} root 仓库相对扫描根
 */
function scan (root) {
  const listed = execFileSync('git', ['ls-files', '--', root], { cwd: REPO, encoding: 'utf8' })
  const files = listed.split(/\r?\n/).filter((f) => f.endsWith('.vue'))
  const byFile = new Map()
  const unreadable = []
  let totalLabels = 0, totalUnclosed = 0
  for (const f of files) {
    let src
    try { src = fs.readFileSync(path.join(REPO, f), 'utf8') } catch (e) { unreadable.push(f); continue }
    const r = scanSource(src)
    totalLabels += r.total
    totalUnclosed += r.unclosed
    if (r.bad) {
      byFile.set(path.relative(path.join(REPO, root), path.join(REPO, f)).split('\\').join('/'), r.bad)
    }
  }
  return {
    files, byFile, total: [...byFile.values()].reduce((a, b) => a + b, 0),
    totalLabels, totalUnclosed, unreadable,
  }
}

function loadBaseline () {
  try {
    const j = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    if (!j || typeof j !== 'object' || !j.byFile || typeof j.byFile !== 'object') throw new Error('形状不符')
    return j
  } catch (e) { return { __error: String(e.message || e) } }
}

function main () {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const write = args.includes('--write-baseline')
  const r = scan(SCAN_ROOT)

  if (!r.files.length) { console.error('[label-for] 扫描域为空（' + SCAN_ROOT + ' 下没有 .vue）—— 判据失明'); process.exit(2) }
  if (r.totalLabels === 0) { console.error('[label-for] 整个扫描域解析出 0 个 <label>/<legend> —— 解析式或文件形态变了，判据已失明'); process.exit(2) }
  if (r.unreadable.length) { console.error('[label-for] 读取失败 ' + r.unreadable.length + ' 个文件：' + r.unreadable.slice(0, 5).join(', ')); process.exit(2) }

  if (write) {
    const payload = {
      _comment: '未关联 <label>/<legend> 基线（UX 审计 4.3 / audit-50）。byFile=每文件处数，只能缩小；新增文件或某文件处数上涨都判红。计数口径：显式 for/:for/v-bind:for，或内含**原生**表单控件才算已关联；<el-input>/<自定义组件>不算（capturing label 只认 form-associated 元素）。',
      generatedBy: 'node scripts/check-label-association.js --write-baseline',
      generatedAt: new Date().toISOString().slice(0, 10),
      totalLabels: r.totalLabels,
      total: r.total,
      byFile: Object.fromEntries([...r.byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    }
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    console.log('[label-for] 已写基线：全域 label=' + r.totalLabels + ' 未关联=' + r.total + ' 文件=' + r.byFile.size)
    process.exit(0)
  }

  const base = loadBaseline()
  if (base.__error) { console.error('[label-for] 基线读不到或形状不符（' + base.__error + '）—— 无法对比，按故障处理'); process.exit(2) }
  if (typeof base.totalLabels !== 'number' || base.totalLabels <= 0) {
    console.error('[label-for] 基线缺 totalLabels 或其值非正数 —— 分母不在，"违规=0"无从判读')
    process.exit(2)
  }
  const problems = []
  for (const [f, n] of r.byFile) {
    if (!(f in base.byFile)) problems.push('NEW_FILE ' + f + '：' + n + ' 处未关联，基线里没有这个文件（新写法不得开口子）')
    else if (n > base.byFile[f]) problems.push('GREW ' + f + '：基线 ' + base.byFile[f] + ' 处 → 现 ' + n + ' 处（只可缩小）')
  }
  for (const f of Object.keys(base.byFile)) {
    if (!r.byFile.has(f)) problems.push('STALE_BASELINE ' + f + '：现场已 0 处，基线还挂着 ' + base.byFile[f] + ' 处')
  }
  const line = '[label-for] 域=' + r.files.length + ' 文件 / label·legend=' + r.totalLabels +
    ' / 未关联文件=' + r.byFile.size + ' / 处数=' + r.total + ' / 基线处数=' +
    Object.values(base.byFile).reduce((a, b) => a + b, 0) + ' / 标签解析未闭合=' + r.totalUnclosed +
    ' / 违规=' + problems.length
  if (asJson) console.log(JSON.stringify({ totalLabels: r.totalLabels, total: r.total, byFile: Object.fromEntries(r.byFile), problems, line }))
  else {
    console.log(line)
    for (const p of problems) console.log('  ' + p)
    if (!problems.length) console.log('[label-for] PASS（存量未增长）')
  }
  process.exit(problems.length ? 1 : 0)
}

if (require.main === module) main()
module.exports = { scan, scanSource, readTag, readElement, NATIVE_CONTROLS, FOR_ATTR, BASELINE_PATH }
