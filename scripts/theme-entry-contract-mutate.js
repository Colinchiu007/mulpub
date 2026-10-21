// scripts/theme-entry-contract-mutate.js
//
// 「暗色主题入口」（UX 审计 阶段 1.1）三把锁的反证驱动：
//   apps/desktop/src/composables/useTheme.test.js        （单例 / 词表 / 首帧镜像 / 过期回包）
//   apps/desktop/src/components/AppearanceSettings.test.js（radiogroup 结构 / 行为 / 键盘）
//   apps/desktop/src/components/SettingsDialog.test.js    （Tab 清单 / 面板挂载）
// 形态与 `keyboard-cards-contract-mutate.js` 一致：**驱动本身入库**，从干净 checkout 一条命令可复跑
// —— 反证脚本躺在临时目录里，"锁的牙"就只存在于文字叙述中。
//
// 用法：node scripts/theme-entry-contract-mutate.js
// 退出码 0 = 每道变异都让它声称要防的那条用例变红（M10 反过来：合规形态必须**保持绿**），
//           且所有源文件逐字节还原。
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
const SRC = (p) => path.join(DESKTOP, 'src', p)
const THEME = SRC('composables/useTheme.js')
const PANEL = SRC('components/AppearanceSettings.vue')
const DIALOG = SRC('components/SettingsDialog.vue')
const MAIN = SRC('main.js')
const ZH = SRC('locales/settings/zh.js')
const OUT = path.join(os.tmpdir(), 'mp-theme-entry-mutate-' + process.pid + '.json')
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')

const WIRING = '接线锁：生产代码必须真的在 mount 之前调用首帧落色'
const SINGLETON = '两个消费者读到**同一份**状态'
const LISTENER = '消费者增减不放大宿主监听'
const VOCAB = '偏好词表闭合'
const MIRROR = '镜像只服务首帧'
const UNCHANGED = 'preference 未变化时也要 commit'
const ROVING = 'roving tabindex'
const ARIA = 'aria-checked 恰一项为 true'
const CLICK_DARK = '点「暗色」⇒ 根元素 data-theme 立即为 dark'
const TABS7 = '渲染七个 Tab'
const PANEL_MOUNT = '点击外观设置渲染 AppearanceSettings 面板'

const MUTANTS = [
  {
    id: 'M1', file: MAIN, label: '摘掉挂载前的首帧落色调用（回到"等异步 IPC = 先闪一帧浅色"）',
    expectRed: [WIRING],
    edits: [{ from: 'applyKnownThemeBeforeMount()\napp.mount', to: 'app.mount' }],
  },
  {
    id: 'M2', file: MAIN, label: '把首帧落色挪到 mount 之后（调了，但顺序错 = 契约仍然破）',
    // M1 证明"没调用会红"，这一条证明锁真正测的是**顺序**——只摘不测顺序的话，
    // 把调用写在 mount 之后同样能过，而用户看到的 FOUC 一字未改。
    expectRed: [WIRING],
    edits: [{ from: 'applyKnownThemeBeforeMount()\napp.mount(\'#app\')', to: 'app.mount(\'#app\')\napplyKnownThemeBeforeMount()' }],
  },
  {
    id: 'M3', file: THEME, label: '返回值退回"每个消费者各建一份"（单例失效的典型形态）',
    expectRed: [SINGLETON],
    edits: [{ from: '  return { theme, isDark, loaded, preference, setPreference, resetToSystem, toggle }',
      to: '  return { theme: computed(() => theme.value), isDark, loaded, preference, setPreference, resetToSystem, toggle }' }],
  },
  {
    id: 'M4', file: THEME, label: '宿主监听不做引用计数（每个消费者各注册一次）',
    expectRed: [LISTENER],
    edits: [{ from: '  consumers += 1\n  if (mediaQuery) return', to: '  consumers += 1' }],
  },
  {
    id: 'M5', file: THEME, label: '偏好词表放宽（把任意字符串当合法偏好）',
    expectRed: [VOCAB],
    edits: [{ from: "const THEME_PREFERENCES = ['light', 'dark', 'system']",
      to: "const THEME_PREFERENCES = ['light', 'dark', 'system', 'auto', 'night']" }],
  },
  {
    id: 'M6', file: THEME, label: '真源被首帧镜像顶替（缓存赢了真源）',
    // ⚠ 第一版把变异打在 `readFailed ? currentMirror() : raw` 上 ⇒ **MISSED**，
    //   但红数=0 说明那不是"锁没牙"而是"变异根本没造出行为差异"：镜像测试走的是**成功读回**分支，
    //   只改失败分支的写法对该路径完全等价。变异必须落在被测路径上，否则 MISSED 会骗人。
    expectRed: [MIRROR],
    edits: [{ from: '  const resolved = normalizeThemePreference(readFailed ? null : raw)',
      to: '  const resolved = normalizeThemePreference(currentMirror())' }],
  },
  {
    id: 'M11', file: THEME, label: 'commit 不回写镜像（下次冷启动又闪一次旧色）',
    expectRed: [MIRROR],
    edits: [{ from: 'function commit () {\n  applyToDom(theme.value)\n  writeMirror(preference.value)\n}',
      to: 'function commit () {\n  applyToDom(theme.value)\n}' }],
  },
  {
    id: 'M7', file: THEME, label: 'preference 无变化时不 commit（过期镜像色永久留在界面上）',
    // 这条锁的是最不容易想到的一格：watch 只在**值变化**时触发，
    // 而"镜像写着 dark、真源是 system"恰好是一次**无变化**的赋值。
    expectRed: [UNCHANGED],
    edits: [{ from: '  if (unchanged) commit()', to: '  if (false && unchanged) commit()' }],
  },
  {
    id: 'M8', file: PANEL, label: 'roving tabindex 退回"每项都可 Tab"（键盘用户每切一次要走三站）',
    expectRed: [ROVING],
    edits: [{ from: ':tabindex="preference === opt.value ? 0 : -1"', to: ':tabindex="0"' }],
  },
  {
    id: 'M9', file: PANEL, label: '未选中项不发 aria-checked（读屏念不出"当前未选"）',
    expectRed: [ARIA],
    edits: [{ from: `:aria-checked="preference === opt.value ? 'true' : 'false'"`,
      to: `:aria-checked="preference === opt.value ? 'true' : undefined"` }],
  },
  {
    id: 'M10', file: ZH, label: '正控：改一句说明文案（措辞不是契约 ⇒ 锁不得红）',
    expectGreen: true,
    edits: [{ from: "themeHint: '选择后立即生效，并记住到下次启动。'", to: "themeHint: '选择后立即生效，下次启动仍会记住。'" }],
  },
  {
    id: 'M12', file: DIALOG, label: 'Tab 在、面板没挂上（本仓「注册≠注入≠生效」的同型落点）',
    expectRed: [PANEL_MOUNT],
    edits: [{ from: `        <AppearanceSettings v-else-if="activeTab === 'appearance'" />`, to: '        <!-- MUT: 面板分支被摘掉 -->' }],
  },
  {
    id: 'M13', file: DIALOG, label: '外观 Tab 被置灰（看得见点不到 = 暗色依旧不可达）',
    expectRed: [TABS7],
    edits: [{ from: `    { key: 'appearance', label: t('settings.tabAppearance'), icon: Brush, disabled: false },`,
      to: `    { key: 'appearance', label: t('settings.tabAppearance'), icon: Brush, disabled: true },` }],
  },
  {
    id: 'M14', file: PANEL, label: '点选只改界面不落真源（重进应用就丢偏好）',
    expectRed: [CLICK_DARK],
    edits: [{ from: "  if (value === 'system') resetToSystem()\n  else setPreference(value)",
      to: "  if (value === 'system') resetToSystem()" }],
  },
]

/**
 * 锚点必须行尾无关：本仓工作副本存在 `i/lf w/crlf` 的文件，
 * 而驱动里的锚点按 LF 书写 —— 两种行尾各试一次，仍要求唯一命中。
 */
function findAndReplace (text, from, to) {
  const cands = [[from, to]]
  if (from.includes('\n')) {
    cands.push([from.replace(/\n/g, '\r\n'), to.replace(/\n/g, '\r\n')])
    cands.push([from.replace(/\n/g, '\r\n'), to])
  }
  for (const [f, t] of cands) {
    const n = text.split(f).length - 1
    if (n === 1) return text.split(f).join(t)
    if (n > 1) throw new Error('anchor 命中 ' + n + ' 次（期望 1，必须唯一）：' + f.slice(0, 60))
  }
  throw new Error('anchor 未命中：' + from.slice(0, 60))
}

function apply (text, m) {
  let out = text
  for (const e of m.edits) out = findAndReplace(out, e.from, e.to)
  return out
}

const VITEST = [
  path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
  path.join(DESKTOP, 'node_modules', 'vitest', 'vitest.mjs'),
].find((p) => fs.existsSync(p)) || path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

function run () {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.rmSync(OUT, { force: true })
  // 不用 `pnpm.cmd`（Windows-only）也不用 shell:true（含空格的临时目录会断成两个参数）：
  // 用当前 node 可执行文件直接跑 vitest 的 ESM 入口。取不到入口走 blind 档，不得静默当通过。
  if (!fs.existsSync(VITEST)) return { blind: true, rc: null, rawTail: 'vitest 入口不存在：' + VITEST }
  const r = spawnSync(process.execPath, [VITEST, 'run',
    'src/composables/useTheme.test.js', 'src/components/AppearanceSettings.test.js',
    'src/components/SettingsDialog.test.js',
    '--reporter=json', '--outputFile=' + OUT],
  { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) return { blind: true, rc: null, rawTail: 'spawn 失败 ' + r.error.code + ' ' + r.error.message }
  if (!fs.existsSync(OUT)) return { blind: true, rc: r.status, rawTail: 'no-json ' + String((r.stdout || '') + (r.stderr || '')).slice(-300) }
  let j
  try { j = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) { return { blind: true, rc: r.status, rawTail: 'unparsable ' + e.message } }
  const red = []
  for (const fr of j.testResults || []) for (const a of fr.assertionResults || []) if (a.status === 'failed') red.push((a.ancestorTitles || []).concat(a.title).join(' > '))
  const total = (j.testResults || []).reduce((n, fr) => n + (fr.assertionResults || []).length, 0)
  if (total === 0) return { blind: true, rc: r.status, rawTail: 'collected=0（判据没在测任何东西）' }
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
      console.log('   rc=' + res.rc + ' 红数=' + after.size + ' → ' + (after.size === 0 ? 'CAUGHT(合规路径仍绿)' : 'MISSED(把合规改动判成违规)') + ' 还原字节一致=' + (identical ? 'OK' : 'DIFF'))
      console.log('   红集: ' + [...after].join(' | '))
      if (after.size !== 0 || !identical) exitCode = 1
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
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { force: true })
  console.log('DRIVER_ROOT=' + ROOT)
  console.log(exitCode === 0 ? 'COUNTERPROOF=ALL_CAUGHT' : 'COUNTERPROOF=NOT_ALL_CAUGHT rc=' + exitCode)
}
process.exit(exitCode)
