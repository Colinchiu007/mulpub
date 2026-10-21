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
    expect: ['停在网页标签时按快捷键', 'onNavigate 回调必须走 navigateVisibly', '调用同一个组合式'],
  },
  {
    id: 'M2',
    label: '侧边栏不再复用共享实现（回退为直连 router.push）',
    file: SIDEBAR,
    from: 'const { navigateVisibly: onNavClick } = useVisibleNavigation({ tabStore, router, apiGetter: () => getApi() })',
    to: 'const onNavClick = async (to) => { try { await router.push(to) } catch (e) { console.warn(e) } }',
    expect: ['聚焦 home-shell 标签：点击菜单经 IPC 定向导航', '不得再自带一份定向导航/切标签判断'],
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
    expect: ['IPC 回执 handled:true ⇒ 主窗口不 push、也不切标签', '定向让它自己跳'],
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
    from: 'if (!homeTab || tabStore.activeTabId === homeTab.tabId) return',
    to: 'if (!homeTab) return',
    // 只命中 composable 层那条：App 层"已在首页标签"走的是 isHomeTab 短路（M6 没碰它），
    // 所以那里必须保持绿——那正是"两个守卫各守一格"的现场证据。
    expect: ['不重复切'],
  },
  {
    id: 'M7',
    label: '顺序反转：先 push 再切回首页标签（整函数体替换，保证可编译）',
    file: COMPOSABLE,
    from: [
      '  async function navigateVisibly (to) {',
      "    if (typeof to !== 'string' || !to) return",
      '    if (await tryNavigateHomeShell(to)) return',
      '    await ensureVisibleTab()',
      '    try {',
      '      await router.push(to)',
      '    } catch (error) {',
      "      warn('[sidebar] navigate failed', error)",
      '    }',
      '  }',
    ].join('\n'),
    to: [
      '  async function navigateVisibly (to) {',
      "    if (typeof to !== 'string' || !to) return",
      '    if (await tryNavigateHomeShell(to)) return',
      '    try {',
      '      await router.push(to)',
      '    } catch (error) {',
      "      warn('[sidebar] navigate failed', error)",
      '    }',
      '    await ensureVisibleTab()',
      '  }',
    ].join('\n'),
    expect: ['顺序不可反', '先切回首页标签'],
  },
  {
    id: 'M8',
    label: '入参判据退化为真值判空（回首页 "/" 静默失效）',
    file: COMPOSABLE,
    from: "if (typeof to !== 'string' || !to) return",
    to: 'if (!to) return; if (to === "/") return',
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
    const verdict = run.failed.length === 0
      ? (run.errorCount > 0 ? 'RUN_UNCLEAN' : 'MISSED')
      : (matched.length === 0 ? 'WRONG_RED' : 'CAUGHT')
    rows.push({ id: mu.id, verdict, red: run.failed.length, matched: matched.length, unexpected: unexpected.length })
    console.log(
      `[${mu.id}] ${verdict} :: ${mu.label} — 红 ${run.failed.length} 条` +
      (verdict === 'WRONG_RED' ? '（无一命中预期，锁保护面与说明不符）' : '') +
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
