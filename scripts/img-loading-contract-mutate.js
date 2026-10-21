// scripts/img-loading-contract-mutate.js
//
// img 加载合同锁（apps/desktop/src/img-loading-contract.test.js）的反证驱动。
// 与 scripts/leaf-role-contract-mutate.js、scripts/keyboard-cards-contract-mutate.js 同一形态：
// 驱动本身入库，从干净 checkout 一条命令可复跑（QM-6 评审 r2-i7 / 一轮 i1 的教训：
// 反证脚本躺在临时目录里 ⇒ "锁的牙"只存在于文字叙述中）。
//
// 变异集合随解析层一起换代：第一版有 M5 涂白 / M6 自闭合 / M7 属性值里的 `>` / M11 属性名字面量
// 四道"手写解析器专用"变异；锁改成 @vue/compiler-sfc 模板 AST 后那四类形态天然不存在，
// 变异也一并删除 —— **留下它们就等于假装还在防那些坑**（QM-6 二轮 i3）。
// 新增的三道各防一个新形状：M9 遍历不下钻、M10 解析退回文本扫描、M11 解析失败静默返回空。
//
// 用法：node scripts/img-loading-contract-mutate.js
// 退出码 0 = 每道变异都让它声称要防的那条用例变红（M13 反过来：合规形态必须保持绿），且源文件逐字节还原。
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
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
const VIEW3 = path.join(DESKTOP, 'src', 'views', 'PromptEvalView.vue')
// vitest 的 ESM 入口：用当前 node 可执行文件直接跑，不用 `pnpm exec`（QM-6 二轮 i10：
// `pnpm.cmd` 只在 Windows 存在，且 shell:true 下 args 无引号拼接，含空格的临时目录会断成两个参数）
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const OUT = path.join(os.tmpdir(), 'mp-img-loading-mutate-' + process.pid + '.json')
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')

const DOMAIN = '扫描域非空'
const DECLARE = '每个 <img> 都必须声明合法的 loading 与 decoding'
const AUTH = 'eager 逐锚点授权'
const ASTB = 'AST 边界'
const FORM = '声明形态口径'
const SELF = '判据自身必须可被观测到在跑'

const MUTANTS = [
  {
    id: 'M1', file: VIEW, label: '摘掉一处 loading="lazy"（回到"默认 eager 等于忘了写"）',
    expectRed: [DECLARE],
    edits: [{ from: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt="" loading="lazy"', to: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt=""' }],
  },
  {
    id: 'M2', file: VIEW, label: '把一处 lazy 改成 eager（无理由的"立刻加载"决定）',
    expectRed: [AUTH],
    edits: [{ from: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt="" loading="lazy"', to: '<img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt="" loading="eager"' }],
  },
  {
    id: 'M3', file: TEST, label: '往清单塞一条虚挂锚点（这张图其实不是 eager）',
    expectRed: [AUTH],
    edits: [{ from: 'export const EAGER_ALLOWLIST = [', to: 'export const EAGER_ALLOWLIST = [\n  { file: \'views/NoSuchView.vue\', match: \'class="ghost"\', covers: 1, reason: \'虚构锚点：用来验证陈旧检测会不会响，理由长度也足够长（②）。\' },' }],
  },
  {
    id: 'M4', file: TEST, label: '例外理由改成空话（且**故意带上"点开"字样**，让口径正则抓不到它）',
    expectRed: [AUTH],
    edits: [{ from: "reason: '封面裁剪弹窗：②同上，裁剪器的输入就是这张图，延迟加载等于让用户对着空框操作。' },",
      to: "reason: '以后再说：这张就是用户点开的图，先放着看效果。' }," }],
  },
  {
    // 二轮 i2 的新牙：一条锚点悄悄覆盖多张图 = 文件级豁免的复发形态
    id: 'M5', file: VIEW2, label: '在已授权文件里再加第三张同形态 eager（covers 仍是 2）',
    expectRed: [AUTH],
    edits: [{ from: '                  <img :src="img.preview" loading="eager" decoding="async"/>',
      to: '                  <img :src="img.preview" loading="eager" decoding="async"/>\n                  <img :src="img.preview" loading="eager" decoding="async"/>' }],
  },
  {
    id: 'M6', file: TEST, label: '给同一张 eager 再挂一条重叠锚点（互相认领 ⇒ 逐张授权不成立）',
    expectRed: [AUTH],
    edits: [{ from: "  { file: 'views/PromptEvalView.vue'",
      to: "  { file: 'views/CreateView.vue', match: 'decoding=\"async\"', covers: 2, reason: '第二条重叠锚点：用来验证互相认领会不会响，理由长度足够（③）。' },\n  { file: 'views/PromptEvalView.vue'" }],
  },
  {
    id: 'M7', file: TEST, label: 'AST 遍历不再下钻子节点（只扫顶层 ⇒ 域静默缩水，站点与锚点双双消失）',
    expectRed: [AUTH],
    edits: [{ from: '    for (const k of (node && node.children) || []) walk(k)', to: '    // 变异：不下钻' }],
  },
  {
    id: 'M8', file: TEST, label: '解析退回"在文本里找 <img"（二轮 i1：注释/插值/属性值里的字面量会造伪站点）',
    expectRed: [ASTB],
    edits: [{ from: "    if (node && node.type === 1 && node.tag === 'img') {",
      to: "    if (node && node.type === 3 && /<img[\\s/>]/.test(node.content || '')) {\n      hits.push({ file: relPath, line: node.loc ? node.loc.start.line : 0, loading: null, decoding: null, loadingForm: 'text-scan', attrs: node.content })\n    }\n    if (node && node.type === 1 && node.tag === 'img') {" }],
  },
  {
    id: 'M9', file: TEST, label: 'SFC 解析失败时静默返回空集合（把"读不完"读成"没有违规"）',
    expectRed: [SELF],
    edits: [{ from: "  if (errors.length) throw new Error(relPath + ' SFC 解析失败 ⇒ 判据无从测量：' + errors.map((e) => e.message).join('; '))",
      to: '  if (errors.length) return []' }],
  },
  {
    id: 'M10', file: TEST, label: 'loading/decoding 词表放宽（把任意字符串当合法值）',
    expectRed: [SELF],
    edits: [{ from: "export const ALLOWED_LOADING = ['lazy', 'eager']", to: "export const ALLOWED_LOADING = ['lazy', 'eager', 'immediate', 'later']" }],
  },
  {
    id: 'M11', file: TEST, label: '空话词表恒不命中（"理由不得是空话"变成装饰）',
    expectRed: [SELF],
    edits: [{ from: 'const EMPTY_REASON_RE = /以后再说|先这样|回头再说|顺手|都行|随便|默认值|默认的|问题不大/', to: 'const EMPTY_REASON_RE = /永不命中这种写法zzz/' }],
  },
  {
    id: 'M12', file: TEST, label: '字面量绑定不再被认作声明（把编译期常量当成运行时决定 = 过度拒绝）',
    expectRed: [FORM],
    edits: [{ from: "      if (m) return { value: m[2].trim(), form: 'bound-literal' }", to: "      if (m) return { value: null, form: 'bound-dynamic' }" }],
  },
  {
    // 合规形态必须绿（只锁"违规变红"会把自己的修复路径焊死）
    id: 'M13', file: VIEW3, label: '正控：把一张已授权的 eager 改回 lazy 并同次删掉它的锚点（两处一起改）',
    expectGreen: true,
    edits: [
      { file: VIEW3, from: '<img :src="img.url" :alt="img.name" loading="eager" decoding="async"/>', to: '<img :src="img.url" :alt="img.name" loading="lazy" decoding="async"/>' },
      { file: TEST, from: "  { file: 'views/PromptEvalView.vue', match: ':src=\"img.url\"', covers: 1, reason: '待评测图片本身：③src 由 URL.createObjectURL(file) 生成本地 blob，lazy 无收益且会打断\"图在哪\"的判断。' },\n", to: '' },
    ],
  },
]

/** 锚点必须行尾无关：本仓工作副本多为 CRLF，按 LF 写的锚点会命中 0 次 ⇒ 那不是没牙，是**根本没造出变异** */
function findAndReplace (text, from, to) {
  const cands = from.includes('\n') ? [from, from.replace(/\n/g, '\r\n')] : [from]
  for (const f of cands) {
    const n = text.split(f).length - 1
    if (n === 1) return text.split(f).join(f.includes('\r\n') ? to.replace(/\n/g, '\r\n') : to)
  }
  throw new Error('anchor 命中 ' + cands.map((f) => text.split(f).length - 1).join('/') + ' 次（期望某一种行尾恰好 1 次）：' + from.slice(0, 60))
}

/** 一道变异可以跨多个文件（"改图必须同次改锚点"这类合规形态正控就是这么写的）；每道变异自带文件集合 */
function mutatedFiles (m) {
  const map = new Map()
  for (const e of m.edits) {
    const f = e.file || m.file
    const cur = map.has(f) ? map.get(f) : fs.readFileSync(f, 'utf8')
    map.set(f, findAndReplace(cur, e.from, e.to))
  }
  return map
}

function filesOf (m) {
  return [...new Set(m.edits.map((e) => e.file || m.file))]
}

function run () {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.rmSync(OUT, { force: true })
  if (!fs.existsSync(VITEST)) return { blind: true, rc: null, rawTail: 'vitest 入口不存在：' + VITEST }
  const r = spawnSync(process.execPath, [VITEST, 'run', 'src/img-loading-contract.test.js', '--reporter=json', '--outputFile=' + OUT],
    { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) return { blind: true, rc: null, rawTail: 'spawn 失败 ' + r.error.code + ' ' + r.error.message }
  if (!fs.existsSync(OUT)) return { blind: true, rc: r.status, rawTail: 'no-json ' + String((r.stdout || '') + (r.stderr || '')).slice(-300) }
  let j
  try { j = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) { return { blind: true, rc: r.status, rawTail: 'unparsable ' + e.message } }
  const red = []
  for (const fr of j.testResults || []) for (const a of fr.assertionResults || []) if (a.status === 'failed') red.push((a.ancestorTitles || []).concat(a.title).join(' > '))
  const total = (j.testResults || []).reduce((n, fr) => n + (fr.assertionResults || []).length, 0)
  if (total === 0) return { blind: true, rc: r.status, rawTail: 'collected=0' }
  return { blind: false, rc: r.status, red, total }
}

const ALL_FILES = [...new Set(MUTANTS.flatMap((m) => m.edits.map((e) => e.file || m.file)))]
const orig = ALL_FILES.map((f) => ({ file: f, md5: md5(f), text: fs.readFileSync(f, 'utf8') }))
const rec = (f) => orig.find((o) => o.file === f)
let exitCode = 0
try {
  const base = run()
  if (base.blind) throw new Error('baseline blind: ' + base.rawTail)
  console.log('[BASE] rc=' + base.rc + ' collected=' + base.total + ' red=' + base.red.length)
  if (base.rc !== 0 || base.red.length !== 0) throw new Error('控制跑必须全绿，否则红集不可归属：' + base.red.join(' | '))
  for (const m of MUTANTS) {
    let mutated
    try { mutated = mutatedFiles(m) } catch (e) { console.log('[MUTATE-FAIL] ' + m.id + ' ' + e.message); exitCode = 1; continue }
    const touched = filesOf(m)
    if (touched.every((f) => mutated.get(f) === fs.readFileSync(f, 'utf8'))) { console.log('[MUTATE-FAIL] ' + m.id + ' 未改变内容'); exitCode = 1; continue }
    for (const [f, text] of mutated) fs.writeFileSync(f, text, 'utf8')
    let res
    try { res = run() } finally { for (const o of orig) fs.writeFileSync(o.file, o.text, 'utf8') }
    if (res.blind) { console.log('[MUTATE-BLIND] ' + m.id + ' ' + res.rawTail); exitCode = 1; continue }
    const after = new Set(res.red)
    const identical = touched.every((f) => md5(f) === rec(f).md5)
    console.log('[' + m.id + '] ' + m.label)
    console.log('   rc=' + res.rc + ' 红数=' + after.size + ' 还原字节一致=' + (identical ? 'OK' : 'DIFF'))
    console.log('   红集: ' + ([...after].join(' | ') || '(空)'))
    if (m.expectGreen) {
      if (after.size !== 0 || !identical) { console.log('   → MISSED（合规形态被判红，或源文件没还原）'); exitCode = 1 } else console.log('   → CAUGHT(合规路径仍绿)')
      continue
    }
    const hit = m.expectRed.filter((w) => [...after].some((n) => n.includes(w)))
    console.log('   指名命中=' + hit.length + '/' + m.expectRed.length + ' → ' + (hit.length === m.expectRed.length && identical ? 'CAUGHT' : 'MISSED'))
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
