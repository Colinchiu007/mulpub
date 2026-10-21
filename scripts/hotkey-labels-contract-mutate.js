#!/usr/bin/env node
/**
 * hotkey-labels-contract-mutate.js —— UX 审计 1.6「快捷键显示面」的反证驱动
 *
 * 目的：证明快捷键面板那 36+ 条契约锁**真的有牙**。每条变异把一个被禁止的形态写回
 * 生产代码或锁自身，跑一次相关测试，要求：
 *   ① 该次跑必须变红（否则锁是装饰性的）；
 *   ② 变红的用例集合必须命中**全部**声明的预期探针（否则判 PARTIAL_RED 并点名沉默的那条）；
 *   ③ 变异必须真的改变字节（md5 前后不同），且还原后与原始字节逐字节相同。
 *
 * 与同仓 `visible-navigation-contract-mutate.js` 共享口径（那条驱动已把四条判据实测打通，
 * 这里逐条继承，不重新发明）：
 * - 死探针预筛：每条探针必须命中真实存在的用例标题，且**打印 needle→完整标题**
 *   （评审 R2-i8：子串耦合的坐标必须可复核，否则"全部可命中"这句话本身不可审计）；
 * - 注入产物必须可编译，锚点先断言存在，缺失即 ANCHOR_NOT_FOUND（不当通过）；
 * - 还原放 finally，且**自报不作数**：跑完由外层独立做 md5 / numstat 回读比对；
 * - 退出码：0 全部按预期变红 / 1 有 MISSED 或 PARTIAL_RED / 2 驱动自身故障 / 4 还原失败。
 *
 * 用法：node scripts/hotkey-labels-contract-mutate.js [--only=N4] [--keep-going]
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const LABELS = path.join(DESKTOP, 'src', 'utils', 'hotkey-labels.test.js')
const LABELS_SRC = path.join(DESKTOP, 'src', 'utils', 'hotkey-labels.js')
const HARNESS = path.join(DESKTOP, 'src', 'utils', 'main-shortcuts-harness.js')
const PANEL_TEST = path.join(DESKTOP, 'src', 'components', 'HotkeysSettings.test.js')
const PANEL = path.join(DESKTOP, 'src', 'components', 'HotkeysSettings.vue')
const DIALOG = path.join(DESKTOP, 'src', 'components', 'SettingsDialog.vue')

const TEST_FILES = [
  'src/utils/hotkey-labels.test.js',
  'src/components/HotkeysSettings.test.js',
  'src/components/SettingsDialog.hotkeys-tab.test.js',
  'src/components/SettingsDialog.test.js',
]
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

/** 同时接受 LF 与 CRLF 两种落盘形态：本仓 .vue 多为 CRLF，新建 .js 多为 LF */
function locate (src, needle) {
  const forms = [needle, needle.split('\n').join('\r\n')]
  for (const form of forms) {
    const idx = src.indexOf(form)
    if (idx >= 0) return { idx, text: form, eol: form.includes('\r\n') ? '\r\n' : '\n' }
  }
  return null
}

/**
 * @typedef {{id:string, label:string, file:string, from:string, to:string, expect:string[]}} Mutation
 * @type {Mutation[]}
 */
const MUTATIONS = [

  {
    id: 'N1',
    // 红在跨包对齐锁的 missing 半区。这一格是本单元的核心风险：漏登记的快捷键不会报错，
    // 只会让用户看到一个裸 accelerator。
    label: '登记表面漏一条（主进程注册了但展示层没文案）',
    file: LABELS_SRC,
    from: "  'CmdOrCtrl+Alt+K': 'keywords',",
    to: "",
    expect: ["双向对齐"],
  },
  {
    id: 'N2',
    // 红在 extra 半区。孤儿项的危害是"未命中"分支从此只有测试能走到 —— 生产走不到的死代码。
    label: '登记表面留一条孤儿（主进程已不注册，映射还留着）',
    file: LABELS_SRC,
    from: "  'CmdOrCtrl+Alt+Q': 'quit',",
    to: "  'CmdOrCtrl+Alt+Z': 'ghost',\n  'CmdOrCtrl+Alt+Q': 'quit',",
    expect: ["双向对齐"],
  },
  {
    id: 'N3',
    // AGENTS.md 记过的锚点失效形态：indexOf 落空返回 -1，而 slice 把负数终点解释成"从末尾倒数"，
    // 区间静默放大到接近整份文件，锁继续绿却不再测量它声称的那张表。
    // 第一版把变异打在 slice 表达式上（另找一个必然落空的 indexOf），实测 MISSED —— 因为
    // `expect(end >= 0)` 那句仍在原地、而 block 变大后解析结果**恰好没变**（注释里的 accelerator
    // 不带引号+冒号，不匹配正则）。真正有牙的是**终点锚的存在断言**，所以变异必须打在它身上：
    // 直接把 end 写成失配值，断言当场红。
    label: '对齐锁的终点锚失配（负数终点会让 slice 静默放大区间）',
    // 变异落在 harness：QM-6 i2 之后解析实现只有一份（两个测试文件都调它），
    // 所以锚点守卫的存在性也只能测在那一份上。harness 里失配即 throw ⇒ 调用它的用例当场红。
    file: HARNESS,
    from: "const end = text.indexOf('\\n}', start)",
    to: 'const end = -1',
    expect: ['判据通路自证'],
  },
  {
    id: 'N4',
    // 一条垃圾建议/一行消失都比裸串更伤：用户照抄、运维查不到。
    label: '未登记的条目被整条丢弃（而不是回显原始标识）',
    file: LABELS_SRC,
    from: "    const { key, rawLabel } = hotkeyActionKey(item)",
    to: "    const { key, rawLabel } = hotkeyActionKey(item)\n    if (!key) continue",
    expect: ["未知 accelerator 保留原文", "未登记的 accelerator 回显原始 route"],
  },
  {
    id: 'N5',
    label: 'formatAccelerator 丢掉它不认识的 token',
    file: LABELS_SRC,
    from: "      return t.length === 1 ? t.toUpperCase() : t",
    to: "      return \"\"",
    expect: ["保持字母大写"],
  },
  {
    id: 'N6',
    label: 'mac 下修饰键不再按苹果惯例排序',
    file: LABELS_SRC,
    from: "      .sort((a, b) => (MAC_ORDER[a.tok] ?? 9) - (MAC_ORDER[b.tok] ?? 9) || a.i - b.i)",
    to: "      .sort((a, b) => a.i - b.i)",
    expect: ["修饰键顺序按苹果惯例"],
  },
  {
    id: 'N7',
    label: 'data-mapped 恒写 true（"忘了补文案"在 DOM 上不可检）',
    file: PANEL,
    from: ":data-mapped=\"row.actionKey ? 'true' : 'false'\"",
    to: ":data-mapped=\"'true'\"",
    expect: ["未登记的 accelerator 回显原始 route"],
  },
  {
    id: 'N8',
    label: '读取失败被吞成空列表（"没响应"与"没有快捷键"同形）',
    file: PANEL,
    from: "v-if=\"state === 'error'\"",
    to: "v-if=\"state === '__never__'\"",
    expect: ["code≠0 ⇒ 报错态", "IPC 抛错 ⇒ 报错态"],
  },
  {
    id: 'N9',
    label: '宿主没有该能力时不再单独成态',
    file: PANEL,
    from: "v-else-if=\"state === 'unavailable'\"",
    to: "v-else-if=\"state === '__never__'\"",
    expect: ["宿主没这个能力 ⇒ 独立提示态"],
  },
  {
    id: 'N10',
    label: '列头丢掉 scope（读屏报不出列名）',
    file: PANEL,
    from: "<th scope=\"col\">{{ t('settings.hotkeys.colKeys') }}</th>",
    to: "<th>{{ t('settings.hotkeys.colKeys') }}</th>",
    expect: ["表格有列头且 scope=col"],
  },
  {
    id: 'N11',
    // 探针取两条同族用例的共同子串：组件面与逻辑面各有一条，摘掉守卫必须两侧一起红。
    label: '把主进程的中文 label 当展示文案（en 语言漏未翻译文本）',
    file: LABELS_SRC,
    from: "      rawLabel,",
    to: "      rawLabel: item.label || rawLabel,",
    expect: ["绝不进展示面"],
  },
  {
    id: 'N12',
    label: '设置页不再有「快捷键」入口（回退为六 Tab）',
    file: DIALOG,
    from: "    { key: 'hotkeys', label: t('settings.tabHotkeys'), icon: Key, disabled: false },",
    to: "",
    expect: ["导航里有「快捷键」", "渲染七个 Tab"],
  },
  {
    // QM-6 i1 的注入点本身被反证：把组件改回「只信宿主探测、忽略注入」，
    // 那么 mac 档用例必须在 Windows runner 上红 —— 否则那个 prop 只是装饰。
    id: 'N13',
    label: '组件忽略注入的 isMac，退回只读 navigator.platform',
    file: PANEL,
    from: "      isMac: props.isMac === null ? detectMac() : props.isMac,",
    to: "      isMac: detectMac(),",
    expect: ['宿主传 mac 档时组合键列渲染苹果符号'],
  },
  {
    // QM-6 i2 的防复发格：在组件测试里重新内联一份主进程表解析 ⇒ 防重复锁必须点名。
    id: 'N14',
    label: '测试文件里再抄一份跨包解析（两份实现重新发散）',
    file: PANEL_TEST,
    from: "    const accelerators = mainAccelerators()",
    to: "    const mainSrc = fs.readFileSync(path.join(DESKTOP_ROOT, 'electron/services/hotkeys.js'), 'utf8')\n    const start = mainSrc.indexOf('const SHORTCUTS')\n    const accelerators = start > 0 ? mainAccelerators() : []",
    expect: ['跨包解析只许有 harness 一份实现'],
  },
]
function parseVitest (out) {
  // ANSI 必须先剥：否则 FAIL/× 前缀里的转义序列会让解析得到 0 条红（探针失明）
  const text = out.replace(/\u001B\[[0-9;]*m/g, '')
  const failed = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:FAIL|×)\s+(.+)$/.exec(line)
    if (!m) continue
    // FAIL 行形如 `FAIL  src/x.test.js > describe > 用例名`；取最后一个 > 段
    const name = m[1].split('>').pop().trim().replace(/\s+\d+ms$/, '').trim()
    if (name && !failed.includes(name)) failed.push(name)
  }
  const sumFail = /Tests\s+(\d+)\s+failed/.exec(text)
  const sumPass = /Tests\s+(\d+)\s+passed/.exec(text)
  // unhandled rejection / 收集期错误会写进 `Errors  N` 行，而 "N passed" 照样打印。
  // 不读这一行就会把"套件根本没跑完"读成绿（基线态）或把它的红误归因给变异。
  const sumErr = /Errors\s+(\d+)/.exec(text)
  // 全绿时 vitest 只打印 `N passed`（没有 failed 段）；两档都没匹配上 = 汇总行没解析到，
  // 此时既不能判 CAUGHT 也不能判 MISSED，必须单列 PROBE_BLIND。
  return {
    failed,
    failCount: sumFail ? Number(sumFail[1]) : 0,
    errorCount: sumErr ? Number(sumErr[1]) : 0,
    blind: !sumFail && !sumPass,
  }
}

function runTests () {
  const res = spawnSync('pnpm.cmd', ['exec', 'vitest', 'run', ...TEST_FILES], {
    cwd: DESKTOP,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  })
  const out = (res.stdout || '') + '\n' + (res.stderr || '')
  return { rc: res.status === null ? -1 : res.status, out, ...parseVitest(out) }
}

/**
 * 用例标题域（死探针预筛的坐标）。
 * 取 JSON reporter 而不是解析 stdout：默认 reporter 只打**文件级** ✓ 行
 * （实测 `✓ src/x.test.js (25 tests)`，零条用例名），从这种输出里"取用例标题"
 * 得到的是空集 —— 空集做预筛会让每条探针都判成死探针（工具失明被读成锁坏了）。
 * @returns {{titles:string[], error:string|null, file:string|null}}
 */
function collectTitles () {
  const outFile = path.join(require('os').tmpdir(), `mp-nav-mutate-titles-${process.pid}.json`)
  const res = spawnSync('pnpm.cmd', ['exec', 'vitest', 'run', ...TEST_FILES, '--reporter=json', `--outputFile=${outFile}`], {
    cwd: DESKTOP,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  })
  if (!fs.existsSync(outFile)) {
    return { titles: [], error: `JSON 报告未落盘（rc=${res.status}）`, file: null }
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  } catch (e) {
    return { titles: [], error: 'JSON 报告解析失败：' + e.message, file: outFile }
  }
  const titles = []
  for (const f of parsed.testResults || []) {
    for (const a of f.assertionResults || []) {
      // 取**叶子标题**（a.title）而不是 fullName：红集来自默认 reporter 的
      // 「file > describe > test」行，fullName（「describe test」）不是它的子串 ⇒
      // 按 fullName 判「每条标题都进红集」会让所有变异一起变 PARTIAL_RED（实测）。
      // 坐标必须与被比较的那一侧同源，否则测的是探针拼装方式而不是锁有没有牙。
      const name = String(a.title || '').trim()
      if (name) titles.push(name)
    }
  }
  return { titles, error: null, file: outFile }
}

function main () {
  const argv = process.argv.slice(2)
  const only = (argv.find((a) => a.startsWith('--only=')) || '').slice(7)
  const keepGoing = argv.includes('--keep-going')
  const targets = only ? MUTATIONS.filter((mu) => mu.id === only) : MUTATIONS
  if (only && targets.length === 0) {
    console.error('UNKNOWN_MUTATION ' + only)
    return 2
  }

  const originals = new Map()
  for (const f of new Set(MUTATIONS.map((mu) => mu.file))) {
    originals.set(f, fs.readFileSync(f))
  }

  const baseline = runTests()
  console.log(`[BASELINE] rc=${baseline.rc} failed=${baseline.failed.length} errors=${baseline.errorCount} blind=${baseline.blind}`)
  if (baseline.rc !== 0 || baseline.failed.length !== 0 || baseline.errorCount !== 0) {
    console.log('[BASELINE] 基线不干净 —— 先修基线，否则变异红集不可归因')
    console.log(baseline.failed.slice(0, 10).map((n) => '  - ' + n).join('\n'))
    return 2
  }

  const rows = []

  // 死探针预筛（评审 i3 的处置）：每条 expect 探针都必须命中**真实存在的用例标题**。
  // 标题域取自 JSON reporter（默认 reporter 只打文件级 ✓ 行，解析它得到空集 ——
  // 那是工具失明，不是锁坏，必须与"探针写错"分开报）。
  const domain = collectTitles()
  if (domain.error) {
    console.log('[DEAD-PROBE] 标题域取不到读数：' + domain.error + ' —— 不产出结论')
    return 2
  }
  if (domain.titles.length < 20) {
    console.log(`[DEAD-PROBE] 标题域只有 ${domain.titles.length} 条（下界 20）= 解析退化，不产出结论`)
    if (domain.file) fs.unlinkSync(domain.file)
    return 2
  }
  const dead = []
  const resolved = []
  for (const mu of targets) {
    for (const needle of mu.expect) {
      const hit = domain.titles.filter((t) => t.includes(needle))
      if (hit.length === 0) dead.push(`${mu.id}::${needle}`)
      else resolved.push(`${mu.id}::${needle} -> ${hit.length === 1 ? hit[0] : `[${hit.length} 条] ` + hit[0]}`)
    }
  }
  if (domain.file) fs.unlinkSync(domain.file)
  if (dead.length) {
    console.log(`[DEAD-PROBE] 标题域 ${domain.titles.length} 条；探针指向不存在的用例：${dead.join(' , ')}`)
    return 2
  }
  // 评审 R2-i8：探针与标题是纯子串耦合，"全部可命中"这句读数本身必须可复核 ——
  // 于是逐条打印 needle 解析到的**完整标题**。没有这行，读者只能相信我的坐标是新的；
  // 有了这行，重命名造成的错配在日志里就是一眼可读的错位，而不是需要重跑一次才能发现。
  console.log('[DEAD-PROBE] 全部探针可命中（标题域 ' + domain.titles.length + ' 条）')
  console.log(resolved.map((r) => '  [PROBE-MAP] ' + r).join('\n'))

  for (const mu of targets) {
    const before = originals.get(mu.file)
    const src = before.toString('utf8')
    const found = locate(src, mu.from)
    if (!found) {
      rows.push({ id: mu.id, verdict: 'ANCHOR_NOT_FOUND', red: 0, detail: '锚点缺失，锁未测到任何东西' })
      console.log(`[${mu.id}] ANCHOR_NOT_FOUND :: ${mu.label}`)
      if (keepGoing) continue
      return 2
    }
    // 注入体是 LF 书写的；落到 CRLF 文件时必须换回该文件的行尾，否则变异自身制造行尾漂移
    const injectedText = mu.to.split('\n').join(found.eol)
    const after = src.split(found.text).join(injectedText)
    if (after === src) {
      rows.push({ id: mu.id, verdict: 'NO_BYTE_CHANGE', red: 0, detail: '注入未改变字节，等于没变异' })
      console.log(`[${mu.id}] NO_BYTE_CHANGE :: ${mu.label}`)
      continue
    }
    fs.writeFileSync(mu.file, Buffer.from(after, 'utf8'))
    let run
    try {
      run = runTests()
    } finally {
      fs.writeFileSync(mu.file, before)
    }
    if (run.blind) {
      rows.push({ id: mu.id, verdict: 'PROBE_BLIND', red: 0, detail: '没解析到测试汇总，红/绿不可知' })
      console.log(`[${mu.id}] PROBE_BLIND :: ${mu.label}`)
      continue
    }
    // QM-6 i7 的处置：needle 是标题的**子串**，一个 needle 可能解析到多条用例标题
    // （实测 N11 的『绝不进展示面』同时命中逻辑面与组件面两条）。
    // 旧判定「红集里存在含该 needle 的一条」即算命中 ⇒「声明两条都该红、实际只红一条」
    // 会被读成 CAUGHT，与 spec 声称的「必须命中全部声明的预期探针」语义不符。
    // 现在先把 needle 展开成它解析到的**标题全集**，逐条要求出现在红集里。
    const silent = []
    for (const needle of mu.expect) {
      for (const title of domain.titles.filter((t) => t.includes(needle))) {
        if (!run.failed.some((n) => n.includes(title))) silent.push(needle + ' -> ' + title)
      }
    }
    const matched = mu.expect.length - new Set(silent.map((s) => s.split(' -> ')[0])).size
    const unexpected = run.failed.filter((n) => !mu.expect.some((needle) => n.includes(needle)))
    // 零条具名红 + Errors>0 = 套件被未处理错误打断，不能读成"锁没牙"（MISSED），
    // 也不能读成"锁有牙"（CAUGHT）：单列 RUN_UNCLEAN，按驱动不可归因处理。
    // 严格判据（评审 i3 + i7）：CAUGHT 要求声明的每条探针**所解析到的每条用例标题**都进红集。
    const verdict = run.failed.length === 0
      ? (run.errorCount > 0 ? 'RUN_UNCLEAN' : 'MISSED')
      : (silent.length ? 'PARTIAL_RED' : 'CAUGHT')
    rows.push({ id: mu.id, verdict, red: run.failed.length, matched, unexpected: unexpected.length })
    console.log(
      `[${mu.id}] ${verdict} :: ${mu.label} — 红 ${run.failed.length} 条（探针命中 ${matched}/${mu.expect.length}，按标题全集判）` +
      (verdict === 'PARTIAL_RED' ? `；沉默的标题：${silent.join(' / ')}` : '') +
      (unexpected.length ? `；非预期红 ${unexpected.length} 条` : ''),
    )
    if (verdict !== 'CAUGHT' && !keepGoing) {
      console.log('    期望命中：' + mu.expect.join(' / '))
      console.log('    实际红集：' + run.failed.slice(0, 6).join(' | '))
    }
  }

  // 独立回读：驱动自报的"已还原"不作数，逐文件比 md5
  let restoreBad = 0
  for (const [f, buf] of originals) {
    const now = fs.readFileSync(f)
    if (md5(now) !== md5(buf)) {
      console.error('RESTORE_MISMATCH ' + path.relative(REPO, f))
      restoreBad += 1
    }
  }
  const missed = rows.filter((r) => r.verdict !== 'CAUGHT')
  console.log(`[SUMMARY] 共 ${rows.length} 条：CAUGHT=${rows.length - missed.length} 其余=${missed.length}`)
  if (missed.length) console.log('  ' + missed.map((r) => `${r.id}=${r.verdict}`).join(' '))
  if (restoreBad) return 4
  return missed.length ? 1 : 0
}

try {
  process.exitCode = main()
} catch (e) {
  console.error('DRIVER_ERROR ' + (e && e.stack))
  process.exitCode = 2
}
