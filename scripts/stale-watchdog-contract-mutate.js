#!/usr/bin/env node
/**
 * 「无更新」看门狗接线的反证驱动（UX 审计 1.8，ux-audit-stale-watchdog）
 *
 * 骨架与 1.2/1.3/1.4 同源，五条纪律一条都不能省：
 *   ① 变异必须是**可执行形态**且攻击受保护行为，不得攻击断言本身；
 *   ② 解析前剥 ANSI；③ 基线 `collected>0` 下界；④ 收集期死亡单列 RUN_UNCLEAN（不得读成 MISSED）；
 *   ⑤ finally 还原 + 独立 md5 回读，不一致 rc=4（由 main() 返回，不能靠 process.exitCode），
 *      并挂 SIGINT/SIGTERM/SIGHUP 还原兜底。
 *
 * 本驱动的两条独有教训（都来自本轮实现过程，不是设想）：
 *  ① S2/S3/S4/S10 的"被禁形态"都是**看起来更像正确实现**的写法（把陈旧当真失败、
 *     让 tick 常驻、把 publicApi 退回普通对象），所以每条都必须各自指名红集，不接受"反正有红"。
 *  ② S6 是本轮真实写错又被改回的那一格：读数从 `nowTs` 换成当场 `Date.now()`
 *     直觉上"更准"，实际切断 computed 的失效链 ⇒ 第一次求值后永久冻结。
 *     它当时让两条 store 级用例变红，改回后必须留一条反证钉住，否则下次"顺手优化"会重演。
 *
 * 派生层为什么不在 store 里：见 publishProgressStall.js 头部（≥500 行熔断 + 只读派生）。
 *
 * 用法：node scripts/stale-watchdog-contract-mutate.js [--only=S3] [--keep-going]
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const F = (rel) => path.join(DESKTOP, rel)

const STALL = F('src/stores/publishProgressStall.js')
const PANEL = F('src/components/PublishProgressPanel.vue')
const SESSION = F('src/components/PublishProgressSession.vue')

const TEST_FILES = [
  'src/stores/publishProgress.stale.test.js',
  'src/components/PublishProgressPanel.test.js',
]

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

const MUTATIONS = [
  {
    id: 'S1',
    label: '阈值改成 Infinity（看门狗永不发火，字段照旧写、读者照旧瞎）',
    file: STALL,
    pairs: [{ from: 'export const STALL_AFTER_MS = 3 * 60 * 1000', to: 'export const STALL_AFTER_MS = Infinity' }],
    expect: ['无事件满 3 分钟 ⇒ 该任务进陈旧集合并给出分钟数'],
  },
  {
    id: 'S2',
    label: '把陈旧直接写进 phase（把"没有新事件"当失败证据 —— spec 的只读派生口径被推翻）',
    file: STALL,
    pairs: [{
      from: '        visit(taskId, stallAnchor(task, session), now - stallAnchor(task, session))',
      to: "        if (now - stallAnchor(task, session) >= STALL_AFTER_MS) task.phase = 'failed'\n        visit(taskId, stallAnchor(task, session), now - stallAnchor(task, session))",
    }],
    expect: ['陈旧是附加展示态：phase 与 aggregate 一律不得被改写成失败'],
  },
  {
    id: 'S3',
    label: '摘掉自泊的 clearInterval ⇒ tick 常驻（每条路由都付它用不到的唤醒成本）',
    file: STALL,
    pairs: [{ from: '        clearInterval(timer)\n        timer = null', to: '        timer = null' }],
    expect: ['begin 后恰好 1 个 tick；仍有非终态任务不得停，全部终态后一个 tick 内自泊'],
  },
  {
    id: 'S4',
    label: '摘掉单实例守卫 ⇒ 重复注册定时器（autoUpdater 同型事故）',
    file: STALL,
    pairs: [{ from: '    if (timer !== null) return\n', to: '' }],
    expect: ['重复 begin 不得叠加第二个定时器；end 必须真的交还句柄（同 autoUpdater 教训）'],
  },
  {
    id: 'S5',
    label: '判据从 >= 改成 >（差一毫秒那一侧的边界契约失守）',
    file: STALL,
    pairs: [{ from: '      if (idle >= STALL_AFTER_MS) out.push(taskId)', to: '      if (idle > STALL_AFTER_MS) out.push(taskId)' }],
    expect: ['无事件满 3 分钟 ⇒ 该任务进陈旧集合并给出分钟数'],
  },
  {
    // 这一条是本轮实现过程**自己踩出来**的形态，不是设想：读数改成当场 Date.now() 看起来
    // 更准（"永远不过期"），但 computed 的缓存只被 nowTs 的写入失效 ⇒ 第一次求值后冻结，
    // 表现为"永远不陈旧"。写回这个"更聪明"的写法必须变红。
    id: 'S6',
    label: '读数从 nowTs 换成当场 Date.now()（computed 缓存失效链被切断 ⇒ 分钟数冻结）',
    file: STALL,
    pairs: [{ from: '    const now = nowTs.value\n    for (const session of sessions.value) {\n      for (const taskId of Object.keys(session.tasks)) {', to: '    const now = Date.now()\n    for (const session of sessions.value) {\n      for (const taskId of Object.keys(session.tasks)) {' }],
    expect: ['无事件满 3 分钟 ⇒ 该任务进陈旧集合并给出分钟数'],
  },
  {
    id: 'S7',
    label: '关闭按钮退回 :disabled="store.hasRunning"（本批的主症状回归）',
    file: PANEL,
    pairs: [{ from: ':disabled="store.hasRunning && !stall.hasStalledRunning"', to: ':disabled="store.hasRunning"' }],
    expect: ['1.8 部分陈旧仍禁用关闭；全部无更新才解禁'],
  },
  {
    id: 'S8',
    label: 'handleClose 退回只在 sessions 空时收起（按钮解禁了但点了没反应）',
    file: PANEL,
    pairs: [{
      from: '  if (store.sessions.length === 0 || stall.hasStalledRunning) store.panelVisible = false',
      to: '  if (store.sessions.length === 0) store.panelVisible = false',
    }],
    expect: ['1.8 关闭 ≠ 取消：只隐藏可见性，不动 sessions、不碰取消/重试入口'],
  },
  {
    id: 'S9',
    label: 'Session 不再把分钟数传给任务行（任务行永远看不到无更新）',
    file: SESSION,
    pairs: [{ from: ':stall-minutes="stall.taskStallMinutes(taskId)"', to: ':stall-minutes="0"' }],
    expect: ['1.8 任务行按真实无更新分钟数追加后缀，未陈旧的行不得追加'],
  },
  {
    // 这一条钉的是"派生层不得退回普通对象"（ComputedRef 不解包 ⇒ 模板恒为真值）。
    id: 'S10',
    label: 'publicApi 退回普通对象（模板拿到 ComputedRef ⇒ 徽标恒真、转圈永不停）',
    file: STALL,
    pairs: [{ from: '  const publicApi = reactive({', to: '  const publicApi = ({' }],
    expect: [
      '1.8 全部无更新时头部徽标转中性文案并停掉转圈',
      '1.8 部分陈旧仍禁用关闭；全部无更新才解禁',
    ],
  },
  {
    // QM-6 i1（Critical）的修法反证：把"这个会话没命中"重新写成"这个任务不陈旧"。
    // 这条形态在单会话夹具下**永远绿**，所以它必须由多会话用例本身来红。
    id: 'S11',
    label: 'taskStallMinutes 在第一个会话 miss 时就 return 0（多会话的第 2+ 会话永远显示 0 分钟）',
    file: STALL,
    pairs: [{ from: '      if (!task) continue\n      if (isTerminal(task.phase)) return 0', to: '      if (!task || isTerminal(task.phase)) return 0' }],
    expect: ['第 2 个会话里的陈旧任务也必须给出分钟数（QM-6 i1 Critical）'],
  },
]

// 命令名按平台选：`pnpm.cmd` 是 Windows 专有，Linux runner 上 spawn 失败 ⇒ 基线读成 blind，
// 八道反证一条不跑却看起来像"环境问题"。
const RUNNER = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function collectFailedTitles (out) {
  const list = []
  for (const line of out.split('\n')) {
    const m = line.match(/FAIL[^\n]*>\s*(.+?)\s*$/)
    if (m) list.push(m[1].trim())
  }
  return list
}

function runVitest () {
  const res = spawnSync(RUNNER, ['exec', 'vitest', 'run', ...TEST_FILES], {
    cwd: DESKTOP, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, shell: true,
  })
  const out = ((res.stdout || '') + (res.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
  const sum = out.match(/Tests\s+(?:(\d+) failed[^0-9]*)?/)
  const passedSum = out.match(/Tests\s+[^0-9]*(\d+) passed/)
  const errSum = out.match(/Errors\s+(\d+)/)
  return {
    rc: res.status,
    failedTitles: collectFailedTitles(out),
    failedCount: sum ? Number(sum[1] || 0) : 0,
    passedCount: passedSum ? Number(passedSum[1]) : 0,
    errorCount: errSum ? Number(errSum[1]) : 0,
    blind: !sum && !/Test Files/.test(out),
    out,
  }
}

function locate (src, needle) {
  for (const form of [needle, needle.split('\n').join('\r\n')]) {
    const idx = src.indexOf(form)
    if (idx >= 0) return { idx, text: form }
  }
  return null
}

function main () {
  const args = process.argv.slice(2)
  const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '')
  const keepGoing = args.includes('--keep-going')
  const targets = only ? MUTATIONS.filter((m) => m.id === only) : MUTATIONS
  if (only && !targets.length) { console.error('UNKNOWN_ID ' + only); return 2 }

  const baseline = runVitest()
  const collected = baseline.passedCount + baseline.failedCount
  console.log(`[BASELINE] rc=${baseline.rc} failed=${baseline.failedCount} passed=${baseline.passedCount} collected=${collected} errors=${baseline.errorCount} blind=${baseline.blind}`)
  for (const t of baseline.failedTitles) console.log(`[BASELINE]   既有红: ${t}`)
  if (baseline.rc !== 0 || baseline.failedCount > 0 || baseline.errorCount > 0 || baseline.blind || collected === 0) {
    console.log('[BASELINE] 基线不干净（或一条都没收集到）—— 先修基线，否则变异红集不可归因')
    return 2
  }

  const rows = []
  let restoreFailed = false
  const active = { file: null, before: null }
  const restoreActive = () => {
    if (!active.file || active.before === null) return
    try {
      fs.writeFileSync(active.file, active.before)
      console.error(`[SIGNAL] 已还原 ${active.file}`)
    } catch (e) {
      console.error(`[SIGNAL] 还原失败：${e.message} —— 请手工核对 ${active.file}`)
    }
    active.file = null
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { restoreActive(); process.exit(130) })
  }

  for (const mu of targets) {
    const file = mu.file
    const before = fs.existsSync(file) ? fs.readFileSync(file) : null
    if (before === null) {
      console.log(`[${mu.id}] FILE_MISSING :: ${file}`)
      rows.push({ id: mu.id, verdict: 'FILE_MISSING' })
      continue
    }
    active.file = file
    active.before = before
    let applied = false
    let anchorMissing = false
    try {
      let src = before.toString('utf8')
      for (const pair of mu.pairs) {
        const found = locate(src, pair.from)
        if (!found) {
          console.log(`[${mu.id}] ANCHOR_NOT_FOUND :: ${mu.label} —— 锚点过期：${JSON.stringify(pair.from.slice(0, 60))}`)
          rows.push({ id: mu.id, verdict: 'ANCHOR_NOT_FOUND' })
          anchorMissing = true
          break
        }
        const eol = found.text.includes('\r\n') ? '\r\n' : '\n'
        src = src.slice(0, found.idx) + pair.to.split('\n').join(eol) + src.slice(found.idx + found.text.length)
      }
      if (anchorMissing) { if (!keepGoing) return 2; continue }
      if (md5(Buffer.from(src)) === md5(before)) {
        console.log(`[${mu.id}] NO_BYTE_CHANGE :: ${mu.label}`)
        rows.push({ id: mu.id, verdict: 'NO_BYTE_CHANGE' })
        if (!keepGoing) return 2
        continue
      }
      fs.writeFileSync(file, src)
      applied = true

      const run = runVitest()
      if (run.blind) {
        console.log(`[${mu.id}] PROBE_BLIND :: ${mu.label} —— 没解析到测试汇总，红/绿不可知`)
        rows.push({ id: mu.id, verdict: 'PROBE_BLIND' })
        if (!keepGoing) return 2
        continue
      }
      const silent = mu.expect.filter((n) => !run.failedTitles.some((t) => t.includes(n)))
      const fileLevelFail = /FAIL\s+\S+\s*\[/.test(run.out) && run.failedTitles.length === 0
      const uncleans = run.errorCount > 0 || (run.rc !== 0 && run.failedCount === 0) || fileLevelFail
      const verdict = run.failedCount === 0
        ? (uncleans ? 'RUN_UNCLEAN' : 'MISSED')
        : (silent.length ? 'PARTIAL_RED' : 'CAUGHT')
      const unexpected = run.failedTitles.filter((t) => !mu.expect.some((n) => t.includes(n)))
      console.log(`[${mu.id}] ${verdict} :: ${mu.label} — 红 ${run.failedCount} 条（探针命中 ${mu.expect.length - silent.length}/${mu.expect.length}）`
        + (silent.length ? `；沉默：${silent.join(' / ')}` : '')
        + (unexpected.length ? `；非预期红 ${unexpected.length} 条：${unexpected.join(' / ')}` : '')
        + (verdict === 'RUN_UNCLEAN' ? `；rc=${run.rc} errors=${run.errorCount} 具名红=0 ⇒ 不可归因` : ''))
      rows.push({ id: mu.id, verdict })
    } finally {
      if (applied) {
        fs.writeFileSync(file, before)
        const back = fs.readFileSync(file)
        if (md5(back) !== md5(before)) {
          console.error(`[${mu.id}] RESTORE_MISMATCH :: ${file} 还原后字节不一致`)
          restoreFailed = true
        } else {
          console.log(`[${mu.id}] RESTORE_OK`)
        }
      }
      active.file = null
    }
  }

  const bad = rows.filter((r) => r.verdict !== 'CAUGHT')
  console.log(`[SUMMARY] 共 ${rows.length} 条：CAUGHT=${rows.length - bad.length} 其余=${bad.length}` + (bad.length ? `  ${bad.map((r) => r.id + '=' + r.verdict).join(' ')}` : ''))
  if (restoreFailed) {
    console.log('[SUMMARY] RESTORE_FAILED —— 有文件还原后字节不一致，请立即 git status/diff 核对')
    return 4
  }
  return bad.length ? 1 : 0
}

process.exitCode = main()
