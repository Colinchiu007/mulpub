#!/usr/bin/env node
/**
 * visible-navigation-contract-mutate.js —— UX 审计 1.5「可见导航」的反证驱动
 *
 * 目的：证明 `useVisibleNavigation` 的十条契约锁**真的有牙**。每条变异把一个被禁止的
 * 形态写回生产代码，跑一次相关测试，要求：
 *   ① 该次跑必须变红（否则锁是装饰性的）；
 *   ② 变红的用例集合必须命中预期的那几条（否则锁保护面比说明窄）；
 *   ③ 变异必须真的改变字节（md5 前后不同），且还原后与原始字节逐字节相同。
 *
 * 口径与同仓 `publish-staleness-contract-mutate.js` / `offline-live-contract-mutate.js` 一致：
 * - 注入产物必须**可编译**（禁止把语法本身改坏 —— 那会红在解析期而不是契约上）；
 * - 注入必须落到**可执行语句**，锚点先断言存在，缺失即 ANCHOR_NOT_FOUND（不当通过）；
 * - 还原放在 `finally`，且驱动**自报的还原成功不作数**：跑完后由本文件外层再做一次
 *   独立字节回读比对；
 * - 退出码分档：0 全部按预期变红 / 1 有 MISSED / 2 驱动自身故障 / 4 还原失败（最严重）。
 *
 * 用法：node scripts/visible-navigation-contract-mutate.js [--only=M3] [--keep-going]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const APP_VUE = path.join(DESKTOP, 'src', 'App.vue')
const SIDEBAR = path.join(DESKTOP, 'src', 'layouts', 'MpSidebar.vue')
const COMPOSABLE = path.join(DESKTOP, 'src', 'composables', 'useVisibleNavigation.js')

const TEST_FILES = [
  'src/composables/useVisibleNavigation.test.js',
  'src/App.visible-navigation.test.js',
  'src/layouts/MpSidebar.sidebar-focus-nav.test.js',
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
    id: 'M1',
    label: 'App.vue 回退为裸 router.push（快捷键跳转落在看不见的背后）',
    file: APP_VUE,
    from: 'unsubscribeNavigate = api.onNavigate((route) => navigateVisibly(route))',
    to: 'unsubscribeNavigate = api.onNavigate((route) => {\n      router.push(route)\n    })',
    expect: ['停在网页标签时按快捷键', 'onNavigate 回调必须走 navigateVisibly'],
  },
  {
    id: 'M2',
    label: '侧边栏不再复用共享实现（回退为直连 router.push）',
    file: SIDEBAR,
    from: 'const { navigateVisibly: onNavClick } = useVisibleNavigation({ tabStore, router, apiGetter: () => getApi() })',
    to: 'const onNavClick = async (to) => { try { await router.push(to) } catch (e) { console.warn(e) } }',
    // M2 的注入只是「绕开共享实现」，没有复制定向判断 ⇒ 侧边栏结构锁必须保持绿；
    // 把那条锁写成预期是过度声明（实测它沉默）。真正打那条锁的是 M13（复制一份判断）。
    expect: ['聚焦 home-shell 标签：点击菜单经 IPC 定向导航', '先切回首页标签再导航，使变化可见'],
  },
  {
    id: 'M3',
    label: 'App.vue 调用点漏传 apiGetter（定向导航静默失效）',
    file: APP_VUE,
    from: 'useVisibleNavigation({ tabStore, router, apiGetter: () => getApi() })',
    to: 'useVisibleNavigation({ tabStore, router })',
    expect: ['App.vue 的 useVisibleNavigation 调用必须注入 apiGetter'],
  },
  {
    id: 'M4',
    label: '共享实现无视 home-shell（恒不定向）',
    file: COMPOSABLE,
    from: 'if (!tabStore.activeTabIsHomeShell) return false',
    to: 'if (true) return false',
    expect: ['IPC 回执 handled:true ⇒ 主窗口不 push、也不切标签', '定向让它自己跳', '点击菜单经 IPC 定向导航'],
  },
  {
    id: 'M5',
    label: '把「调用过 IPC」当成「已处理」（无回执也返回 true）',
    file: COMPOSABLE,
    from: 'return !!(res && res.code === 0 && res.data && res.data.handled)',
    to: 'return !!res',
    expect: ['⇒ 回落到主窗口路径（继续切标签 + push）', '回退为切回首页 + 主窗口导航', '回落可见路径'],
  },
  {
    // 反证现场教训（已实跑否证）：把 `if (tabStore.isHomeTab) return` 改成恒假**零条红**——
    // 因为后面的 `activeTabId === homeTab.tabId` 比较本来就把同一种状态挡住了，那条短路是
    // 冗余防御。真正有牙的是 id 比较，所以变异必须打在它身上，否则这条 M 是恒真的装饰。
    id: 'M6',
    label: '去掉「已在 home 标签就不重复切」的 id 比较（每次多发一次无谓 IPC）',
    file: COMPOSABLE,
    from: 'if (tabStore.activeTabId === homeTab.tabId) return',
    to: 'if (false) return',
    // 只命中 composable 层那条：App 层"已在首页标签"走的是 isHomeTab 短路（M6 没碰它），
    // 所以那里必须保持绿——那正是"两个守卫各守一格"的现场证据。
    expect: ['不重复切'],
  },
  {
    id: 'M7',
    label: '顺序反转：先 push 再切回首页标签（整块换序，不多一次 push）',
    file: COMPOSABLE,
    from: [
      '    if (await tryNavigateHomeShell(to)) return',
      '    await ensureVisibleTab()',
      '    try {',
      '      await router.push(to)',
      '    } catch (error) {',
      "      warn('[sidebar] navigate failed', error)",
      '    }',
    ].join('\n'),
    to: [
      '    if (await tryNavigateHomeShell(to)) return',
      '    try {',
      '      await router.push(to)',
      '    } catch (error) {',
      "      warn('[sidebar] navigate failed', error)",
      '    }',
      '    await ensureVisibleTab()',
    ].join('\n'),
    // 评审 R2-i3 的处置：上一版注入体**另加**了一次 push，红因里混进了「多一次跳转」。
    // 现在整块换序 —— 红的唯一理由就是顺序。
    expect: ['顺序不可反'],
  },

  {
    id: 'M14',
    label: '快捷键回调改为「先用中间变量存 route，再裸 push」（绕过字面形态匹配）',
    file: APP_VUE,
    from: 'unsubscribeNavigate = api.onNavigate((route) => navigateVisibly(route))',
    to: 'unsubscribeNavigate = api.onNavigate((route) => {\n      const target = route\n      router.push(target)\n    })',
    expect: ['onNavigate 回调必须走 navigateVisibly', '停在网页标签时按快捷键'],
  },
  {
    id: 'M8',
    label: '入参判据退化为真值判空 + 误杀根路径（回首页 "/" 静默失效）',
    file: COMPOSABLE,
    // 锚点取"非字符串那一格"：R2-i7 把两格拆开后，旧锚 `typeof to !== 'string' || !to` 已不存在，
    // 沿用它会让本条变异定位失败（而定位失败必须报错，不能读成"这条没红所以锁没牙"）。
    from: "if (typeof to !== 'string') {",
    to: "if (typeof to !== 'string' || !to || to === '/') {",
    expect: ['根路径 "/" 必须被当作合法目标'],
  },
  {
    id: 'M9',
    label: '定向成功后不收口（继续切标签 + push，两侧路由漂移）',
    file: COMPOSABLE,
    from: 'if (await tryNavigateHomeShell(to)) return',
    to: 'await tryNavigateHomeShell(to)',
    expect: ['定向让它自己跳，主窗口隐藏路由不动', '主窗口 router.push 不被调用'],
  },
  {
    id: 'M10',
    label: 'IPC 抛错被读成「已处理」（异常静默且不再降级）',
    file: COMPOSABLE,
    from: "      warn('[sidebar] navigate home-shell failed', error)\n      return false",
    to: "      warn('[sidebar] navigate home-shell failed', error)\n      return true",
    expect: ['IPC 抛错 ⇒ 出声告警并回落到主窗口路径'],
  },
  {
    id: 'M11',
    label: '「找不到 home 标签」的覆盖层背后跳转重新变成无日志的沉默（评审 i4）',
    file: COMPOSABLE,
    from: "      warn('[nav] no home tab; target route pushed behind the active tab overlay')\n      return",
    to: '      return',
    expect: ['并如实登记'],
  },
  {
    id: 'M12',
    label: '非法入参被静默丢弃（评审 i1：按了没反应且零痕迹）',
    file: COMPOSABLE,
    from: "      warn('[nav] ignored navigate request: target is not a route string', { type: typeof to })\n      return",
    to: '      return',
    expect: ['但必须出声'],
  },
  {
    id: 'M13',
    label: '侧边栏复制一份定向判断（不调组合式，绕过"调用点集合锁"）',
    file: SIDEBAR,
    from: 'const { navigateVisibly: onNavClick } = useVisibleNavigation({ tabStore, router, apiGetter: () => getApi() })',
    to: 'const onNavClick = async (to) => { const api = getApi(); await api.pageManager.navigateActiveHomeShell(to) }',
    expect: ['恒等于共享实现', '不得再自带一份定向导航/切标签判断（单一实现）'],
  },
  {
    id: 'M15',
    label: '去掉连发串行化：两次快捷键并发判定「需要切回首页」（评审 R2-i2）',
    file: COMPOSABLE,
    from: 'const run = queue.then(() => runNavigation(to))',
    to: 'const run = runNavigation(to)',
    expect: ['两次连发：切标签只做一次'],
  },
  {
    id: 'M16',
    label: '默认告警出口不分 arity：单实参也塞一个 undefined（评审 R2-i1）',
    file: COMPOSABLE,
    from: 'warn = (msg, err) => (err === undefined ? console.warn(msg) : console.warn(msg, err)),',
    to: 'warn = (msg, err) => console.warn(msg, err),',
    expect: ['不得往控制台塞一个尾随 undefined'],
  },
  {
    id: 'M17',
    // 与 M15 是同一个不变量的**另一处注入点**：M15 摘「链头」（不从 queue 起跳），
    // M17 摘「链进」（每次都用已 resolve 的空链）。两格各测各的，不合并计一条。
    // 原先这里挂的是「链尾吞 rejection」那条防护——反证跑出来零条红，
    // 因为 runNavigation 内部已 catch 全部异常，那条防护守的是一个到不了的状态，已删。
    label: '串行化链进退回空链：连发的第二次不等第一次收尾',
    file: COMPOSABLE,
    from: 'queue = run',
    to: 'queue = Promise.resolve()',
    expect: ['两次连发：切标签只做一次'],
  },
  {
    id: 'M18',
    // 评审 R2-i7 的形态本身：两格合并回一条文案 ⇒ 空串那条日志会自称「不是路由字符串」，
    // 而它的 typeof 恰恰是 string。这条变异打的不是"有没有告警"（M12 已覆盖），
    // 而是"两条被拒原因是否可区分"。
    label: '空串与非字符串合并回同一条文案（自相矛盾的诊断痕迹复活）',
    file: COMPOSABLE,
    from: "warn('[nav] ignored navigate request: target is an empty route string')",
    to: "warn('[nav] ignored navigate request: target is not a route string', { type: typeof to })",
    expect: ['空串与非法类型必须是两条不同的文案'],
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
      const name = String(a.fullName || a.title || '').trim()
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
    const matched = mu.expect.filter((needle) => run.failed.some((n) => n.includes(needle)))
    const unexpected = run.failed.filter((n) => !mu.expect.some((needle) => n.includes(needle)))
    // 零条具名红 + Errors>0 = 套件被未处理错误打断，不能读成"锁没牙"（MISSED），
    // 也不能读成"锁有牙"（CAUGHT）：单列 RUN_UNCLEAN，按驱动不可归因处理。
    // 严格判据（评审 i3）：CAUGHT 要求**每一条**预期探针都命中。
    // "≥1 命中即过"会把"只打红一条、其余声明的锁在变异下沉默"读成锁有牙。
    const verdict = run.failed.length === 0
      ? (run.errorCount > 0 ? 'RUN_UNCLEAN' : 'MISSED')
      : (matched.length < mu.expect.length ? 'PARTIAL_RED' : 'CAUGHT')
    rows.push({ id: mu.id, verdict, red: run.failed.length, matched: matched.length, unexpected: unexpected.length })
    console.log(
      `[${mu.id}] ${verdict} :: ${mu.label} — 红 ${run.failed.length} 条（探针命中 ${matched.length}/${mu.expect.length}）` +
      (verdict === 'PARTIAL_RED' ? `；沉默的声明：${mu.expect.filter((n) => !matched.includes(n)).join(' / ')}` : '') +
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
