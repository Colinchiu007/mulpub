#!/usr/bin/env node
// @ts-check
/**
 * check-vfor-stable-key.js — `v-for` 的 `:key` 不得用索引变量（存量按文件份数只可缩小）
 *
 * 动因（UX 审计 §14 audit-33 / 阶段 4.8）：`<tr v-for="(r,i) in rows" :key="i">` 让 Vue 的 diff
 * 把"位置"当身份。列表一旦**增删/重排**，DOM 节点与组件实例会被搬到别的行上：
 * 行内输入框的内容、`<img>` 的加载态、子组件内部状态会**跟着位置走而不是跟着数据走**，
 * 表现是"删掉第 2 行后，第 3 行的备注框里留着第 2 行的字"。这类缺陷在像素门禁与单测里都不可见
 * （它只在"删/插/排序 + 行内有局部状态"同时成立时显形）。
 *
 * ## 为什么不"顺手全修"
 * 现场读数（2026-10-19 当场实跑，判据就是本文件的 scan()）：**46 处 / 31 文件**，
 * 其中 6 个文件同时存在 `.splice()/.shift()/.pop()/.unshift()`（真会增删的列表）。
 * 逐处改需要判断"每份列表的稳定身份字段是哪个"，那是**每页各自的语义裁决**；
 * 把它和"这条判据有没有牙"混成一次变更，归因会互相污染。
 * 所以本门禁的口径与 `check-toast-single-exit.js` 完全一致：**存量不许增长、新文件不得开口子**，
 * 存量清单只可缩小。
 *
 * ## 四条口径（都有现场理由）
 *  ① **索引变量名从 `v-for` 自己解析**，不硬编码 `i/index/idx` 词表 ——
 *     硬编码词表是枚举式黑名单（本仓「枚举式黑名单必须配结构化正向契约」点名的同型），
 *     下一个会话写个 `:key="pos"` 就绕过了。
 *  ② **只判"`:key` 的表达式恰好等于某个索引变量"**（trim 后全等）。
 *     `` :key="`${r.id}-${i}`" ``、`:key="r.id"`、`:key="i + '_x'"` 一律**不判**——
 *     前两者是正确写法，第三者虽仍含位置但至少有数据参与，不该被同一条判据一把打死。
 *  ③ **同文件跨循环的变量重名会过判**（两个循环都用 `i`）：取向是**宁可多收**。
 *     漏判要靠"新写的人自己负责"，而过判只多花一次人工确认；不引入 AST 解析器（零依赖约束）。
 *     这一条写进注释而不是藏进实现，是为了让下一个会话知道边界在哪。
 *  ④ **判据自身失明必须出声**：扫描域为空、基线读不到、解析不出任何 `v-for` 都要以 rc=2
 *     走"工具故障"档，不得把"0 命中"读成"0 违规"。
 *
 * 用法：
 *   node scripts/check-vfor-stable-key.js                 # 判据（默认对比基线）
 *   node scripts/check-vfor-stable-key.js --json          # 机器可读
 *   node scripts/check-vfor-stable-key.js --write-baseline # 重算基线（在别处人工过目）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const BASELINE_PATH = path.join(__dirname, 'vfor-stable-key-baseline.json')
const SCAN_ROOT = 'apps/desktop/src'
/**
 * `:key="X"` 的两条命中来源（口径 ⑤）：
 *  (a) X 等于本文件任一 `v-for` 的**非首位形参名** —— 结构化判据，覆盖任意命名；
 *  (b) X 是 `index` / `idx` 这两个**语义无歧义**的名字 —— 补召回（防止 v-for 写在别的文件、
 *      或形参解析退化时整条判据静默漏掉最典型的写法）。
 * 单引号与不加引号两种属性形态都要认（同 href 判据的"四种形态"纪律）：
 * 只认双引号的写法给绕过留了口子，即便**当场实测本仓 0 处单引号**（实测口径见记录）。
 */
const RESERVED_INDEX_NAMES = new Set(['index', 'idx', 'i', 'j', 'k', 'n', 'ind', 'pos', 'num'])
const VFOR_RE = /(?:v-for)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const KEY_RE = /(?::key|v-bind:key)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
/** 成对注释与块注释要先剥掉：文档里举例写 `:key="i"` 不得计数（同 5.3 / toast 棘轮的同型纪律） */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const JS_BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g

/** 剥注释：逐行注释按行处理，块注释与模板注释按整体处理 */
function stripComments (src) {
  return src
    .replace(HTML_COMMENT_RE, '')
    .replace(JS_BLOCK_COMMENT_RE, '')
    .split('\n')
    .map((line) => {
      const c = line.indexOf('//')
      const q = line.indexOf('"')
      // 只在"这一行的第一个引号之前"出现 // 时才当注释（否则 `url("http://x")` 会被误剥）
      if (c >= 0 && (q < 0 || c < q)) return line.slice(0, c)
      return line
    })
    .join('\n')
}

/**
 * 从一条 v-for 表达式里取**索引变量名**。
 * 对象形态 `v-for="{a} in list"` 没有索引位；`(item, index)` 的第二位、`(item, index, key)` 的
 * 第二/三位都算索引位（Vue 文档：`(value, index, key)` 里只有对象遍历才有第三位，
 * 但把第三位也收进集合是**刻意过判**，见文件头口径 ③）。
 * @param {string} expr
 * @returns {string[]}
 */
function indexIdentifiers (expr) {
  const m = /^\s*\(\s*([^()]*)\s*\)\s+(?:in|of)\s+/i.exec(expr)
  const raw = m ? m[1] : null
  if (!raw) return []
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.slice(1).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
}

/**
 * 单个文件里的违规处数（scan 的每一格都走这里，判据只有一份实现）。
 * @param {string} src 文件原文
 * @returns {{hits:number, indexVars:string[], reserved:number}}
 */
function hitsIn (src) {
  const clean = stripComments(src)
  const vars = new Set()
  for (const m of clean.matchAll(VFOR_RE)) {
    for (const v of indexIdentifiers(m[1] === undefined ? m[2] : m[1])) vars.add(v)
  }
  let hits = 0
  let reserved = 0
  for (const m of clean.matchAll(KEY_RE)) {
    const expr = (m[1] === undefined ? m[2] : m[1]).trim()
    if (!expr) continue
    if (vars.has(expr)) hits++
    else if (RESERVED_INDEX_NAMES.has(expr)) { reserved++; hits++ }
  }
  return { hits, indexVars: [...vars], reserved }
}

/**
 * @param {string} root 扫描根（仓库相对）
 * @returns {{files:string[], byFile:Map<string,number>, total:number, indexVars:number, reservedRecall:number, unreadable:string[]}}
 */
function scan (root) {
  const out = execFileSync('git', ['ls-files', '--', root], { cwd: REPO, encoding: 'utf8' })
  const files = out.split(/\r?\n/).filter((f) => f.endsWith('.vue'))
  const byFile = new Map()
  const unreadable = []
  let indexVars = 0
  let reservedRecall = 0
  for (const f of files) {
    let src
    try { src = fs.readFileSync(path.join(REPO, f), 'utf8') } catch (e) { unreadable.push(f); continue }
    const h = hitsIn(src)
    indexVars += h.indexVars.length
    reservedRecall += h.reserved
    if (h.hits) byFile.set(path.relative(path.join(REPO, root), path.join(REPO, f)).split('\\').join('/'), h.hits)
  }
  return { files, byFile, total: [...byFile.values()].reduce((a, b) => a + b, 0), indexVars, reservedRecall, unreadable }
}

/** 同文件是否存在真增删（`.splice()/.shift()/.pop()/.unshift()`）⇒ 风险档位 */
function mutatingFiles (r) {
  const set = new Set()
  for (const rel of r.byFile.keys()) {
    const p = path.join(REPO, SCAN_ROOT, rel)
    try {
      if (/\.(splice|shift|pop|unshift)\s*\(/.test(fs.readFileSync(p, 'utf8'))) set.add(rel)
    } catch (e) { /* 读不到已在 scan() 里出声 */ }
  }
  return [...set].sort()
}

function loadBaseline () {
  try {
    const j = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    if (!j || typeof j !== 'object' || !j.byFile || typeof j.byFile !== 'object') throw new Error('形状不符')
    return j
  } catch (e) {
    return { __error: String(e.message || e) }
  }
}

function main () {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const write = args.includes('--write-baseline')

  const r = scan(SCAN_ROOT)
  // 口径 ④：判据自身失明的三种形态，一律 rc=2，不得走"合规"档
  if (!r.files.length) {
    console.error('[vfor-key] 扫描域为空（git ls-files 在 ' + SCAN_ROOT + ' 下没找到 .vue）—— 判据失明，不是"0 违规"')
    process.exit(2)
  }
  if (r.indexVars === 0) {
    console.error('[vfor-key] 整个扫描域解析不出任何 v-for 索引变量 —— 解析式或文件形态变了，判据已失明')
    process.exit(2)
  }
  if (r.unreadable.length) {
    console.error('[vfor-key] 读取失败 ' + r.unreadable.length + ' 个文件：' + r.unreadable.slice(0, 5).join(', '))
    process.exit(2)
  }

  if (write) {
    const payload = {
      _comment: 'v-for 索引 :key 基线（UX 审计 4.8 / audit-33）。byFile=每文件处数，只能缩小；新增文件或某文件处数上涨都判红。本基线由 scan() 自己产出，不是人工点数。',
      generatedBy: 'node scripts/check-vfor-stable-key.js --write-baseline',
      generatedAt: new Date().toISOString().slice(0, 10),
      total: r.total,
      byFile: Object.fromEntries([...r.byFile.entries()].sort((a, b) => a[0].localeCompare(b[0])),),
      mutatingFiles: mutatingFiles(r),
    }
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    console.log('[vfor-key] 已写基线：total=' + r.total + ' files=' + r.byFile.size)
    process.exit(0)
  }

  const base = loadBaseline()
  if (base.__error) {
    console.error('[vfor-key] 基线读不到或形状不符（' + base.__error + '）—— 判据无法对比，按故障处理而不是"通过"')
    process.exit(2)
  }
  const baselineByFile = base.byFile
  const problems = []
  for (const [f, n] of r.byFile) {
    if (!(f in baselineByFile)) problems.push('NEW_FILE ' + f + '：基线里没有这个文件（新写法不得开口子）—— ' + n + ' 处')
    else if (n > baselineByFile[f]) problems.push('GREW ' + f + '：基线 ' + baselineByFile[f] + ' 处 → 现 ' + n + ' 处（只可缩小）')
  }
  for (const f of Object.keys(baselineByFile)) {
    if (!r.byFile.has(f)) problems.push('STALE_BASELINE ' + f + '：现场已 0 处，基线还挂着 ' + baselineByFile[f] + ' 处（清单只能由真实收敛来缩小）')
  }
  // 风险档：基线里登记过的文件才允许带增删调用；新增即红
  const knownMut = new Set(Array.isArray(base.mutatingFiles) ? base.mutatingFiles : [])
  for (const f of mutatingFiles(r)) {
    if (!knownMut.has(f)) problems.push('NEW_RISK_FILE ' + f + '：索引 :key 与 .splice/.shift/.pop/.unshift 同时出现（会真的增删行的列表）—— 必须改用稳定身份，不得登记进基线')
  }

  const line = '[vfor-key] 域=' + r.files.length + ' 文件 / v-for 索引变量=' + r.indexVars +
    ' / 名字补召回=' + r.reservedRecall +
    ' / 违规文件=' + r.byFile.size + ' / 处数=' + r.total + ' / 基线处数=' +
    Object.values(baselineByFile).reduce((a, b) => a + b, 0) + ' / 风险档文件=' + mutatingFiles(r).length +
    ' / 违规=' + problems.length
  if (asJson) {
    console.log(JSON.stringify({ total: r.total, byFile: Object.fromEntries(r.byFile), problems, line }))
  } else {
    console.log(line)
    for (const p of problems) console.log('  ' + p)
    if (!problems.length) console.log('[vfor-key] PASS（存量未增长）')
  }
  process.exit(problems.length ? 1 : 0)
}

if (require.main === module) main()
module.exports = { scan, hitsIn, stripComments, indexIdentifiers, mutatingFiles, RESERVED_INDEX_NAMES, VFOR_RE, KEY_RE, BASELINE_PATH }
