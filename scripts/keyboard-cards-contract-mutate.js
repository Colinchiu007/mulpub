// scripts/keyboard-cards-contract-mutate.js
//
// 键盘可达 + 焦点环两把锁的反证驱动（PR #4088 的 QM-6 评审处置现场）：
//   apps/desktop/src/views/Collection.keyboard-cards.test.js （四件套 / 身份枚举 / 六张行为）
//   apps/desktop/src/focusable-ring-contract.test.js        （tabindex=0 必须有 :focus-visible 环）
// 与 scripts/leaf-role-contract-mutate.js、scripts/img-loading-contract-mutate.js 同一形态：
// 驱动本身入库，从干净 checkout 一条命令可复跑 —— 反证脚本躺在临时目录里，
// "锁的牙"就只存在于文字叙述中（QM-6 评审 r2-i7 的教训）。
//
// 用法：node scripts/keyboard-cards-contract-mutate.js
// 退出码 0 = 每道变异都让它声称要防的那条用例变红（M11 反过来：合规形态必须**保持绿**），
//            且所有源文件逐字节还原。
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
const VIEW = path.join(DESKTOP, 'src', 'views', 'Collection.vue')
const CSS = path.join(DESKTOP, 'src', 'features', 'collection', 'collection-page-legacy.css')
const OUT = path.join(os.tmpdir(), 'mp-keyboard-ring-mutate-' + process.pid + '.json')
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')

const STRUCT = '每张卡四件套齐备，且 Enter / Space 表达式与 @click 逐字一致'
const DOMAIN = '判定域逐张点名'
const BEHAV = '六张卡片的 click / Enter / Space 各自都把用户带到同一个目的地'
const RING = '每个可聚焦元素都要有一条命中它的 :focus-visible 规则'
const RATCHET = '欠账基线不得变松'
const WORD = '类名匹配必须整词'
const AST = '解析器自身（AST 化）'
const NORM = '归一化器自身'
const KBTEST = path.join(DESKTOP, 'src', 'views', 'Collection.keyboard-cards.test.js')
const RINGTEST = path.join(DESKTOP, 'src', 'focusable-ring-contract.test.js')
// vitest 的 ESM 入口（hoisted 布局在仓库根 node_modules）；用它而不是 `pnpm exec vitest`，
// 见 run() 里 i5 的注释。解析失败即走 blind 档，不得静默当成"没有红 ⇒ 全过"。
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

const MUTANTS = [
  {
    id: 'M1', file: VIEW, label: '摘掉微博卡的 Enter 绑定（键盘路径断裂的另一半）',
    expectRed: [STRUCT, BEHAV],
    edits: [{ from: `data-testid="source-entry-weibo" role="button" tabindex="0" @click="openCollection('weibo')" @keydown.enter.prevent="openCollection('weibo')"`,
      to: `data-testid="source-entry-weibo" role="button" tabindex="0" @click="openCollection('weibo')"` }],
  },
  {
    id: 'M2', file: VIEW, label: 'Space 表达式写成近似逻辑（点了个别的来源）',
    expectRed: [STRUCT],
    edits: [{ from: `@keydown.space.prevent="openCollection('baidu')"`, to: `@keydown.space.prevent="openCollection('toutiao')"` }],
  },
  {
    id: 'M3', file: VIEW, label: '去掉 .prevent（Space 会连带滚页 = 半个键盘可达）',
    expectRed: [STRUCT],
    edits: [{ from: `@keydown.space.prevent="openCollection('baidu')"`, to: `@keydown.space="openCollection('baidu')"` }],
  },
  {
    id: 'M4', file: VIEW, label: '摘掉 tabindex="0"（键盘根本走不到卡片）',
    // 只指 STRUCT：这张卡不再是可聚焦站点，环锁的判定域跟着少一个 ⇒ 它不会红（域由 tabindex 决定）
    expectRed: [STRUCT],
    edits: [{ from: `data-testid="quick-create-draft" role="button" tabindex="0"`, to: `data-testid="quick-create-draft" role="button"` }],
  },
  {
    id: 'M5', file: VIEW, label: '摘掉 role="button"（可聚焦但无障碍树上不是按钮）',
    expectRed: [STRUCT],
    edits: [{ from: `data-testid="quick-drafts-box" role="button" tabindex="0"`, to: `data-testid="quick-drafts-box" tabindex="0"` }],
  },
  {
    id: 'M6', file: VIEW, label: '新增第 7 张卡但不登记进清单（身份枚举的漏项形态）',
    expectRed: [DOMAIN],
    edits: [{ from: `            <div class="cohere-stat-card col-stat-card-click" data-testid="source-entry-toutiao"`,
      to: `            <div class="cohere-stat-card col-stat-card-click" data-testid="source-entry-xigua" role="button" tabindex="0" @click="openCollection('toutiao')" @keydown.enter.prevent="openCollection('toutiao')" @keydown.space.prevent="openCollection('toutiao')">\n              <div class="stat-value">x</div>\n            </div>\n            <div class="cohere-stat-card col-stat-card-click" data-testid="source-entry-toutiao"` }],
  },
  {
    id: 'M7', file: VIEW, label: '同一次触发调用两次下游（模拟双重激活）',
    // 这条是 i2 的"计数断言真的有牙"：第一版用 toHaveBeenLastCalledWith，两参数相同的重复调用
    // 不会让它红；现在断 toBe(1)，重复必须出声。
    expectRed: [BEHAV],
    edits: [{ from: `    router.push('/publish?tab=drafts')`, to: `    router.push('/publish?tab=drafts'); router.push('/publish?tab=drafts')` }],
  },
  {
    id: 'M8', file: CSS, label: '摘掉整条焦点环规则（可聚焦但看不见焦点在哪）',
    // 锚点必须**跟着当前形态走**：二轮 i1 之后这条规则多了一行 transition override，
    // 旧锚点（只含 outline + offset）就命中 0 次 ⇒ MUTATE-FAIL（第一版就是这么挂的）。
    // MUTATE-FAIL 与 MISSED 是两种病：前者是"变异没造出来"，后者才是"锁没牙"。
    expectRed: [RING],
    edits: [{ from: `.col-stat-card-click:focus-visible {\n  outline: 2px solid var(--color-focus-ring);\n  outline-offset: 2px;\n  transition: outline-color 0s, outline-width 0s, outline-offset 0s;\n}`, to: `` }],
  },
  {
    id: 'M9', file: CSS, label: '环色硬编码，不走 --color-focus-ring 单一真源',
    // 只指 RING：新增违规由「计数棘轮 ≤ 基线」那一格拦；「基线不得变松」那格管的是**反方向**
    // （有人把基线调大），它在这里必须是绿的 —— 第一版把两条都期望红，是对这两格语义的误读。
    expectRed: [RING],
    edits: [{ from: `  outline: 2px solid var(--color-focus-ring);`, to: `  outline: 2px solid #ff0055;` }],
  },
  {
    id: 'M10', file: CSS, label: '焦点环规则选择器写成不命中的类名（形似有环）',
    expectRed: [RING],
    edits: [{ from: `.col-stat-card-click:focus-visible {`, to: `.col-stat-card-click-ghost:focus-visible {` }],
  },
  {
    // 合规形态必须绿（反证纪律：只锁"违规变红"会把自己的修复路径焊死）
    id: 'M11', file: VIEW, label: '正控：把 push 字符串换成对象形态（目的地未变 ⇒ 锁不得红）',
    expectGreen: true,
    edits: [{ from: `    router.push('/publish?tab=drafts')`, to: `    router.push({ path: '/publish', query: { tab: 'drafts' } })` }],
  },
  {
    id: 'M12', file: RINGTEST, label: '把环色基线从 10 调到 12（不收敛违规，只放宽额度）',
    // 与 M9 互为对偶：M9 测"违规上涨"由计数棘轮拦，M12 测"额度被调松"由这一格拦。
    // 缺了这条，"基线不得变松"那格就是恒绿的装饰。
    expectRed: [RATCHET],
    edits: [{ from: 'export const RING_TOKEN_DEBT_BASELINE = 10', to: 'export const RING_TOKEN_DEBT_BASELINE = 12' }],
  },
  {
    id: 'M13', file: RINGTEST, label: '摘掉欠账登记（清单只是豁免，不是判据的例外）',
    expectRed: [RING],
    edits: [{ from: "  'components/SidebarServiceStatus.vue': {", to: "  'components/NoSuchFile.vue': {" }],
  },
  {
    id: 'M14', file: RINGTEST, label: '类名匹配退回子串 includes（M10 的成因，锁必须记住它）',
    expectRed: [WORD],
    edits: [{ from: "  return new RegExp('\\\\.' + escapeRe(cls) + '(?![\\\\w-])').test(selector)",
      to: '  return selector.includes(\'.\' + cls)' }],
  },
  // ── 二轮评审（head 5afa9d36）新增：i1 transition / i2 归一化不对称 / i4 解析层 / 递归完整性 ──
  {
    id: 'M15', file: CSS, label: '摘掉刚补的 transition override（回到二轮 i1 的缺陷形态）',
    // 实测从 10 涨到 11 ⇒ 由「环色与 transition 两格的欠账只能缩小」那一格拦下
    expectRed: [RING],
    edits: [{ from: '\n  transition: outline-color 0s, outline-width 0s, outline-offset 0s;', to: '' }],
  },
  {
    id: 'M16', file: RINGTEST, label: '把 transition 基线从 10 调到 12（只放宽额度，不收敛违规）',
    expectRed: [RATCHET],
    edits: [{ from: 'export const TRANSITION_DEBT_BASELINE = 10', to: 'export const TRANSITION_DEBT_BASELINE = 12' }],
  },
  {
    id: 'M17', file: RINGTEST, label: '把整份 SFC 文本当成 style 源返回（模板/脚本里的字面量会变成伪规则 —— 二轮 i4）',
    // 第一版这道变异打在"聚合处"（allCss 里把 styles 换成 raw）——**MISSED**：往 CSS 里**加**伪规则
    // 只会让缺环计数变小，不会让任何断言红，那不是"没牙"，是我造错了对称轴。
    // 正解是打在**产出处**：让 styles 直接返回整份文本，fixture「st3[0] 不得含模板文本」当场红。
    expectRed: [AST],
    edits: [{ from: 'return { sites, styles: descriptor.styles.map((s) => s.content) }', to: 'return { sites, styles: [vueSrc] }' }],
  },
  {
    id: 'M18', file: KBTEST, label: '摘掉"统一补前导斜杠"那一步（二轮 i2：name 与 path 形态重新分叉）',
    // 第一版打在 `else if (arg.name) path = arg.name` 上 —— **MISSED**：下一行的通用兜底
    // `if (!path.startsWith('/')) path = '/' + path` 会把它补回来，于是这道变异根本没改变任何行为。
    // 归一化的牙正是那句通用兜底，所以变异必须摘它。
    expectRed: [NORM],
    edits: [{ from: "  if (!path.startsWith('/')) path = '/' + path", to: '  // 变异：摘掉统一补斜杠' }],
  },
  {
    id: 'M19', file: RINGTEST, label: 'AST 遍历不再下钻子节点（只扫顶层 ⇒ 域静默缩水，站点与规则双双消失）',
    // 「扫描域非空」那条有规模下界，但这里顶层仍有 template 根节点 ⇒ 只有 fixture 与真计数会红
    expectRed: [AST, '判定域非空'],
    edits: [{ from: '    for (const k of (node && node.children) || []) walkAst(k)', to: '    // 变异：不下钻' }],
  },
]

/**
 * 锚点必须行尾无关：本仓 CSS/MD 的工作副本是 CRLF（`i/lf w/crlf`），
 * 而驱动里的锚点按 LF 书写 —— 第一版 M8 因此「命中 0 次」直接 MUTATE-FAIL，
 * 那不是变异没牙，是**根本没造出变异**。两种行尾各试一次，仍要求唯一。
 */
function findAndReplace (text, from, to) {
  const cands = [from]
  if (from.includes('\n')) {
    cands.push(from.replace(/\n/g, '\r\n'))
    cands.push(from.replace(/\r?\n/g, '\n'))
  }
  for (const f of cands) {
    const n = text.split(f).length - 1
    if (n === 1) return text.split(f).join(to.replace(/\n/g, f.includes('\r\n') ? '\r\n' : '\n'))
  }
  const counts = cands.map((f) => text.split(f).length - 1).join('/')
  throw new Error('anchor 命中 ' + counts + ' 次（期望某一种行尾恰好 1 次）：' + from.slice(0, 60))
}

function apply (text, m) {
  let out = text
  for (const e of m.edits) out = findAndReplace(out, e.from, e.to)
  return out
}

function run () {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.rmSync(OUT, { force: true })
  // 二轮评审 i5：不得用 `spawnSync('pnpm.cmd', …, {shell:true})` ——
  // ① `pnpm.cmd` 只存在于 Windows，Linux/macOS 上直接 ENOENT，与"从干净 checkout 一条命令可复跑"矛盾；
  // ② `shell:true` 时 args 按空格无引号拼接，`--outputFile=` 指向的临时目录一旦含空格就断成两个参数。
  // 正解：用**当前这个 node 可执行文件**直接跑 vitest 的 ESM 入口，无 shell、无平台分支、无引号面。
  if (!fs.existsSync(VITEST)) return { blind: true, rc: null, rawTail: 'vitest 入口不存在：' + VITEST }
  const r = spawnSync(process.execPath, [VITEST, 'run',
    'src/views/Collection.keyboard-cards.test.js', 'src/focusable-ring-contract.test.js',
    '--reporter=json', '--outputFile=' + OUT],
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
    const identical = md5(m.file) === rec(m.file).md5
    console.log('[' + m.id + '] ' + m.label)
    if (m.expectGreen) {
      console.log('   rc=' + res.rc + ' 红数=' + after.size + ' → ' + (after.size === 0 ? 'CAUGHT(合规路径仍绿)' : 'MISSED(把修复判成违规)') + ' 还原字节一致=' + (identical ? 'OK' : 'DIFF'))
      if (after.size !== 0 || !identical) exitCode = 1
      console.log('   红集: ' + [...after].join(' | '))
      continue
    }
    const hit = m.expectRed.filter((w) => [...after].some((n) => n.includes(w)))
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
