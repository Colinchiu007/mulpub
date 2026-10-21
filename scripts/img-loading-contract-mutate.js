// scripts/img-loading-contract-mutate.js
//
// img 加载合同锁（apps/desktop/src/img-loading-contract.test.js）的反证驱动。
// 与 scripts/leaf-role-contract-mutate.js 同一形态：驱动本身入库，从干净 checkout 一条命令可复跑
// （QM-6 评审 r2-i7 的教训：反证脚本躺在临时目录里 ⇒ "锁的牙"只存在于文字叙述中）。
//
// 用法：node scripts/img-loading-contract-mutate.js
// 退出码 0 = 每道变异都让它声称要防的那条用例变红，且源文件逐字节还原。
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
const TEST = path.join(DESKTOP, 'src', 'img-loading-contract.test.js')
const VIEW = path.join(DESKTOP, 'src', 'views', 'PublishHistory.vue')
const VIEW2 = path.join(DESKTOP, 'src', 'views', 'CreateView.vue')
const os = require('node:os')
// 报告写系统临时目录而不是仓库内：它是本机绝对路径的容器，落进仓库就会被
// Gate 12c（受管文档不得新增本机绝对路径）判红，也不该让两个同类驱动为了
// 存放各自的报告而两次去改 .gitignore 的同一区域。
const OUT = path.join(os.tmpdir(), 'mp-img-loading-mutate-' + process.pid + '.json')
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')

const MUTANTS = [
  {
    id: 'M1', file: VIEW, label: '摘掉一处 loading="lazy"（回到"默认 eager 等于忘了写"）',
    expectRed: ['每个 <img> 都必须声明合法的 loading 与 decoding'],
    // 锚点必须唯一：PublishHistory.vue 有 3 个 <img>，只用尾部片段会命中 3 次并被"期望 1"拒掉
    edits: [{ from: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt="" loading="lazy"', to: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt=""' }],
  },
  {
    id: 'M2', file: VIEW, label: '把一处 lazy 改成 eager（无理由的"立刻加载"决定）',
    expectRed: ['eager 必须逐张有理由'],
    edits: [{ from: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt="" loading="lazy"', to: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt="" loading="eager"' }],
  },
  {
    id: 'M3', file: TEST, label: '往 eager 白名单塞一条虚挂条目（该文件其实没有这张图）',
    expectRed: ['eager 必须逐张有理由'],
    edits: [{ from: 'export const EAGER_ALLOWLIST = [', to: 'export const EAGER_ALLOWLIST = [\n  { file: \'views/NoSuchView.vue\', match: \'class="ghost"\', reason: \'虚构条目：用来验证陈旧检测会不会响，理由长度也足够长（②）。\' },' }],
  },
  {
    id: 'M4', file: TEST, label: '例外理由改成"以后再说"式空话（把"带理由"变成装饰）',
    expectRed: ['eager 必须逐张有理由'],
    edits: [{ from: "reason: '封面裁剪弹窗：同上（②），裁剪器的输入就是这张图，延迟加载等于让用户对着空框操作。' },",
      // 替换文本刻意**带上"点开"**：这样它满足口径正则（①/②/③/点开…），只有空话词表会拦它
      // ⇒ 红必须归因到 EMPTY_REASON_RE 这一格，而不是被口径正则顺带抓到（第一版就是没做这层归因）
      to: "reason: '以后再说：这张就是用户点开的图，先放着看效果。' }," }],
  },
  {
    id: 'M5', file: TEST, label: '摘掉注释/插值涂白（让注释里的示例 <img> 变成站点）',
    expectRed: ['解析器自身：注释/插值里的示例不得制造站点'],
    edits: [{ from: 'const hide = new Uint8Array(n)', to: 'const hide = new Uint8Array(0)' }],
  },
  {
    id: 'M6', file: TEST, label: '自闭合 <img/> 被跳过（检测域漏掉 Vue 模板里最常见的写法）',
    expectRed: ['解析器自身：注释/插值里的示例不得制造站点'],
    edits: [{ from: '    const ot = readOpenTag(src, lt)', to: '    const ot = readOpenTag(src, lt)\n    if (src[ot.end - 1] === \'/\') { i = ot.end + 1; continue }' }],
  },
  {
    id: 'M7', file: TEST, label: '开标签改回朴素正则匹配（属性值里带 `>` 就截断）',
    expectRed: ['解析器自身：注释/插值里的示例不得制造站点'],
    edits: [{ from: '    const ot = readOpenTag(src, lt)', to: '    const gt = src.indexOf(\'>\', lt + 4)\n    const ot = { attrs: src.slice(lt + 1, gt), end: gt }' }],
  },
  {
    id: 'M8', file: TEST, label: 'loading/decoding 词表放宽（把任意字符串当合法值）',
    // 仓里没人写错值 ⇒ 这条只能由 fixture 观测；指向"词表闭合"那条而不是"每个 <img>"那条，
    // 后者在 M8 下确实仍然全绿（第一版就是这么 MISSED 的）。
    expectRed: ['词表本身必须闭合'],
    edits: [{ from: "const ALLOWED_LOADING = ['lazy', 'eager']", to: "const ALLOWED_LOADING = ['lazy', 'eager', 'immediate', 'later']" }],
  },
  {
    // 评审 i1 之后新增的四道，各自钉一条"锁变强了"而不是"代码没坏"：
    // 旧版对这四格根本无从判断（文件级豁免 / 整串正则 / 关键词白名单）。
    id: 'M9', file: VIEW2, label: '同文件再加第三个 eager（旧版文件级豁免会放行 —— i3 的牙）',
    expectRed: ['eager 必须逐张有理由'],
    edits: [{ from: '                  <img :src="img.preview" loading="eager" decoding="async"/>',
      to: '                  <img :src="img.cover" loading="eager" decoding="async"/>\n                  <img :src="img.preview" loading="eager" decoding="async"/>' }],
  },
  {
    id: 'M10', file: TEST, label: '给同一张 eager 再挂一条重叠锚点（逐张授权退化成"任挑一条挂着"）',
    expectRed: ['eager 必须逐张有理由'],
    edits: [{ from: "  { file: 'views/PromptEvalView.vue'",
      to: "  { file: 'views/CreateView.vue', match: 'decoding=\"async\"', reason: '第二条重叠锚点：用来验证互相认领会不会响，理由长度足够（②）。' },\n  { file: 'views/PromptEvalView.vue'" }],
  },
  {
    id: 'M11', file: TEST, label: '属性解析退回"在整段属性串上找名字子串"（i4：值里的 loading= 字面量会被当真声明）',
    expectRed: ['解析器自身：注释/插值里的示例不得制造站点'],
    edits: [{ from: '  const hit = attrTokens(attrText).find((t) => t.name === name && t.value !== null)\n  return hit ? hit.value.trim() : null',
      to: "  const at = attrText.indexOf(name + '=')\n  return at < 0 ? null : attrText.slice(at + name.length + 2).split(/[\"']/)[1].trim()" }],
  },
  {
    id: 'M12', file: TEST, label: '空话词表恒不命中（"理由不得是空话"变成装饰）',
    // 指「理由词表自身」而不是存量那条：仓里没有空话理由，存量观测不到这个守卫，
    // 所以 M4 造出违规输入、M12 摘掉守卫 —— 两道合起来才证明这一格真有牙（同 M8 的形态）。
    expectRed: ['理由词表自身'],
    edits: [{ from: 'const EMPTY_REASON_RE = /以后再说|先这样|回头再说|顺手|都行|随便|默认值|默认的/',
      to: 'const EMPTY_REASON_RE = /永不命中这种写法zzz/' }],
  },
]

/**
 * 锚点行尾无关（与 scripts/keyboard-cards-contract-mutate.js 同口径）：
 * 本仓 .vue 工作副本多为 CRLF，按 LF 写的锚点会「命中 0 次」⇒ 那不是没牙，是**根本没造出变异**。
 */
function findAndReplace (text, from, to) {
  const cands = from.includes('\n') ? [from, from.replace(/\n/g, '\r\n')] : [from]
  for (const f of cands) {
    const n = text.split(f).length - 1
    if (n === 1) return text.split(f).join(f.includes('\r\n') ? to.replace(/\n/g, '\r\n') : to)
  }
  throw new Error('anchor 命中 ' + cands.map((f) => text.split(f).length - 1).join('/') + ' 次（期望某一种行尾恰好 1 次）：' + from.slice(0, 60))
}

function apply (text, m) {
  let out = text
  for (const e of m.edits) out = findAndReplace(out, e.from, e.to)
  return out
}

function run () {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.rmSync(OUT, { force: true })
  const r = spawnSync('pnpm.cmd', ['exec', 'vitest', 'run', 'src/img-loading-contract.test.js', '--reporter=json', '--outputFile=' + OUT],
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

const orig = [...new Set(MUTANTS.map((m) => m.file))].map((f) => ({ file: f, md5: md5(f), text: fs.readFileSync(f, 'utf8') }))
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
