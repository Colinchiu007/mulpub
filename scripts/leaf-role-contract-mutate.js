// scripts/leaf-role-contract-mutate.js
//
// 叶子角色合同锁（apps/desktop/src/leaf-role-contract.test.js）的反证驱动。
// 为什么进仓：QM-6 二轮评审 i7 命中「九道变异的驱动脚本在临时目录里 ⇒ 从干净 checkout
// 无法机械重跑 COUNTERPROOF=ALL_CAUGHT，'锁的牙'只存在于文字叙述里」。这条与本仓
// 「测试文件必须显式接进 CI，否则等于没写」是同一族纪律的反向形态：**反证也要可复跑**。
//
// 用法（在被审 worktree 根目录）：
//   node scripts/leaf-role-contract-mutate.js
// 退出码 0 = 每道变异都让「它声称要防的那条用例」变红且源文件逐字节还原；非 0 = 有问题。
// 说明：CI 执行的是**锁本身**（vitest 收集 `apps/desktop/src/**`），本驱动是人工反证工具，
// 因此它不进 quality-gate；`check-unwired-tests.js` 的采集域只认 `*.test.*`，本文件不在其中。
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = (() => {
  let d = __dirname
  for (;;) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'apps', 'desktop'))) return d
    const up = path.dirname(d)
    if (up === d) throw new Error('找不到仓库根（含 apps/desktop 的那一级）——拒绝在错误 cwd 上跑反证')
    d = up
  }
})()
const DESKTOP = path.join(ROOT, 'apps', 'desktop')
const TEST = path.join(DESKTOP, 'src', 'leaf-role-contract.test.js')
const COLL = path.join(DESKTOP, 'src', 'views', 'Collection.vue')
const OUT = path.join(ROOT, '.ccg', 'tmp', 'leaf-role-mutate-report.json')
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')

/** 每道变异 = 把某个能力退回它被写下之前的形态；expectRed 是它必须指名打红的那条用例 */
const MUTANTS = [
  { id: 'M1', file: COLL, label: '把 role="button" 加回采集卡片容器（被禁形态原样重造）', expectRed: ['本批两个被修站点', '违规站点必须命中例外清单'],
    // 锚点必须唯一：`class="cohere-card collection-record-card"` 在 v-if / v-else 两张卡上各出现一次，
    // 旧的临时驱动用 replace(首处) 静默容忍了这点 —— 变异可能落在错的元素上仍报 CAUGHT。
    from: `<div v-if="entry.origin === 'collect'" class="cohere-card collection-record-card" :data-testid=`,
    to: `<div v-if="entry.origin === 'collect'" class="cohere-card collection-record-card" role="button" tabindex="0" :data-testid=` },
  { id: 'M2', file: TEST, label: '例外条目理由清空（把"带理由"变成装饰）', expectRed: ['每个例外条目必须带非空 reason'],
    from: /'components\/TabBar\.vue:tab':\s*\n?\s*'[^']*'/, to: "'components/TabBar.vue:tab': ''" },
  { id: 'M3', file: TEST, label: '塞一条虚挂的例外（对应违规并不存在）', expectRed: ['违规站点必须命中例外清单'],
    from: 'export const KNOWN_LEAF_ROLE_CONFLICTS = {',
    to: "export const KNOWN_LEAF_ROLE_CONFLICTS = {\n  'views/NoSuchFile.vue:button': '正解 = 虚构条目，用来验证陈旧检测会不会响。'," },
  { id: 'M4', file: TEST, label: '把 button 从 LEAF_ROLES 摘掉（解析器瞎掉 ⇒ 违规归零）', expectRed: ['违规站点必须命中例外清单'],
    from: "const LEAF_ROLES = ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'img']",
    to: "const LEAF_ROLES = ['link', 'menuitem', 'checkbox', 'radio', 'img']" },
  { id: 'M5', file: TEST, label: '摘掉注释 / script / 插值涂白（一轮 i1）', expectRed: ['注释与 script/style 里的 </div> 不得截断容器'],
    from: 'const hide = new Uint8Array(n)', to: 'const hide = new Uint8Array(0)' },
  { id: 'M6', file: TEST, label: '容器区间退化成空串（"配对失效"被读成"没内容所以没问题"）', expectRed: ['本批两个被修站点'],
    from: 'return { attrs: src.slice(lt, ot.end + 1), inner: src.slice(ot.end + 1, closeAt) }',
    to: "return { attrs: src.slice(lt, ot.end + 1), inner: '' }" },
  { id: 'M7', file: TEST, label: 'tabindex 判定放宽回"任何 tabindex"（一轮 i7）', expectRed: ['tabindex="-1" 是程序性焦点目标'],
    from: "const focusable = ti !== null && ti[1] !== '-1'", to: 'const focusable = ti !== null' },
  { id: 'M8', file: TEST, label: 'role 值取回退回"内层引号写进字符类"的写法（一轮 i7 的真实错形）', expectRed: ['动态 :role 绑定同样是叶子角色声明'],
    // 变异必须取**被禁形态本身**：只把外层匹配改窄会被后面的剥引号逻辑救回来（实测 MISSED 过一次）。
    // 原始缺陷写法 /["\']([^"\']+)["\']/ —— 遇到 :role="'button'" 时字符类里容不下引号，整条不匹配。
    // 这条锚点刻意只覆盖正则那一行（下一行的剥内层引号逻辑含反引号，不能进模板字面量 ——
    // String.raw 会被内层反引号提前闭合，这是本仓记录过的同型坑）。
    from: "  const m = /(?:^|[\\s:])role\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')/.exec(attrs)",
    to: "  const m = /\\brole\\s*=\\s*[\"']([^\"']+)[\"']/.exec(attrs)" },
  { id: 'M9', file: TEST, label: '交互组件名退回原生 6 个标签（一轮 i2）', expectRed: ['交互组件名必须在判定域内'],
    from: [
      "  'el-button', 'el-checkbox', 'el-radio', 'el-radio-group', 'el-switch', 'el-input',",
      "  'el-input-number', 'el-select', 'el-date-picker', 'el-upload', 'el-link', 'el-tabs',",
      "  'ui-button', 'uibutton', 'router-link',",
    ].join('\n'), to: '' },
  { id: 'M10', file: TEST, label: '扫描主循环不再跳过 void / 自闭合容器（二轮 i1）', expectRed: ['容器边界不得靠"落到文件尾"蒙过去'],
    from: 'if (ot.selfClosing || VOID_TAGS.has(tag.toLowerCase())) { i = ot.end + 1; continue }',
    to: 'if (false) { i = ot.end + 1; continue }' },
  { id: 'M15', file: TEST, label: '配不上对时退回"返回文件尾"的静默形态（二轮 i1 的落点）', expectRed: ['容器边界不得靠"落到文件尾"蒙过去'],
    edits: [
      { from: '  for (const e of events) {\n    depth += e.d\n    if (depth === 0) return e.at\n  }\n  return -1\n}',
        to: '  for (const e of events) {\n    depth += e.d\n    if (depth === 0) return e.at\n  }\n  return src.length\n}' },
      { from: '      if (closeAt < 0) {', to: '      if (false) {' },
    ] },
  { id: 'M11', file: TEST, label: '自闭合开标签重新计入深度（二轮 i1：永远降不到 0）', expectRed: ['容器边界不得靠"落到文件尾"蒙过去'],
    from: 'if (!ot.selfClosing) events.push({ at: m.index, d: 1 })', to: 'events.push({ at: m.index, d: 1 })' },
  { id: 'M12', file: TEST, label: 'role 值退回大小写敏感 + 整串比对（二轮 i2）', expectRed: ['容器边界不得靠"落到文件尾"蒙过去'],
    from: "return v.toLowerCase().split(/\\s+/).filter((t) => /^[\\w-]+$/.test(t))",
    to: 'return [v]' },
  { id: 'M13', file: TEST, label: '插值区不再涂白（二轮 i4：{{ "<button>" }} 被当真实控件）', expectRed: ['容器边界不得靠"落到文件尾"蒙过去'],
    from: "for (let at = src.indexOf('{{'); at >= 0;) {", to: 'for (let at = -1; at >= 0;) {' },
  { id: 'M14', file: TEST, label: '交互属性表去掉 @keyup（二轮 i3：本批自己移除过 @keyup.enter）', expectRed: ['容器边界不得靠"落到文件尾"蒙过去'],
    from: 'const INTERACTIVE_ATTR_RE = /(?:@click|@keydown|@keyup', to: 'const INTERACTIVE_ATTR_RE = /(?:@click|@keydown' },
]

function apply (text, m) {
  const edits = m.edits || [{ from: m.from, to: m.to }]
  let out = text
  for (const e of edits) {
    if (e.from instanceof RegExp) {
      if (!e.from.test(out)) throw new Error('anchor missing (regex)')
      out = out.replace(e.from, e.to)
      continue
    }
    const n = out.split(e.from).length - 1
    if (n !== 1) throw new Error('anchor 命中 ' + n + ' 次（期望 1）：' + e.from.slice(0, 40))
    out = out.split(e.from).join(e.to)
  }
  return out
}

function run () {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.rmSync(OUT, { force: true })
  const r = spawnSync('pnpm.cmd', ['exec', 'vitest', 'run', 'src/leaf-role-contract.test.js', '--reporter=json', '--outputFile=' + OUT],
    { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true })
  if (!fs.existsSync(OUT)) return { blind: true, rc: r.status, rawTail: 'no-json ' + String((r.stdout || '') + (r.stderr || '')).slice(-300) }
  let j
  try { j = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) { return { blind: true, rc: r.status, rawTail: 'unparsable ' + e.message } }
  const red = []
  for (const fr of j.testResults || []) for (const a of fr.assertionResults || []) if (a.status === 'failed') red.push((a.ancestorTitles || []).concat(a.title).join(' > '))
  const total = (j.testResults || []).reduce((n, fr) => n + (fr.assertionResults || []).length, 0)
  if (total === 0) return { blind: true, rc: r.status, rawTail: 'collected=0' }
  return { blind: false, rc: r.status, red, total }
}

const files = [...new Set(MUTANTS.map((m) => m.file))]
const orig = files.map((f) => ({ file: f, md5: md5(f), text: fs.readFileSync(f, 'utf8') }))
const rec = (f) => orig.find((o) => o.file === f)
let exitCode = 0
try {
  const base = run()
  if (base.blind) throw new Error('baseline blind: ' + base.rawTail)
  console.log('[BASE] rc=' + base.rc + ' collected=' + base.total + ' red=' + base.red.length)
  if (base.rc !== 0 || base.red.length !== 0) throw new Error('控制跑必须全绿，否则红集不可归属：' + base.red.join(' | '))
  for (const m of MUTANTS) {
    let mutated
    try { mutated = apply(rec(m.file).text, m) } catch (e) { console.log('[MUTATE-FAIL] ' + m.id + ' ' + e.message); exitCode = 1; continue }
    if (mutated === rec(m.file).text) { console.log('[MUTATE-FAIL] ' + m.id + ' 未改变内容'); exitCode = 1; continue }
    fs.writeFileSync(m.file, mutated, 'utf8')
    let res
    try { res = run() } finally { fs.writeFileSync(m.file, rec(m.file).text, 'utf8') }
    if (res.blind) { console.log('[MUTATE-BLIND] ' + m.id + ' ' + res.rawTail); exitCode = 1; continue }
    const after = new Set(res.red)
    const hit = m.expectRed.filter((w) => [...after].some((n) => n.includes(w)))
    const identical = md5(m.file) === rec(m.file).md5
    console.log('[' + m.id + '] ' + m.label)
    console.log('   rc=' + res.rc + ' 红数=' + after.size + ' 指名命中=' + hit.length + '/' + m.expectRed.length
      + ' → ' + (hit.length === m.expectRed.length ? 'CAUGHT' : 'MISSED') + ' 还原字节一致=' + (identical ? 'OK' : 'DIFF'))
    console.log('   红集: ' + [...after].join(' | '))
    if (hit.length !== m.expectRed.length || !identical) exitCode = 1
  }
} catch (e) { console.log('[ABORT] ' + e.message); exitCode = 1 } finally {
  for (const o of orig) {
    if (md5(o.file) !== o.md5) { fs.writeFileSync(o.file, o.text, 'utf8'); console.log('[EXIT-GUARD] 还原 ' + path.basename(o.file)); exitCode = 1 }
  }
  console.log('DRIVER_ROOT=' + ROOT)
  console.log(exitCode === 0 ? 'COUNTERPROOF=ALL_CAUGHT' : 'COUNTERPROOF=PROBLEM')
  process.exitCode = exitCode
}
