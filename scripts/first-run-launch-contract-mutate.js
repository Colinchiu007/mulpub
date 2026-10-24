#!/usr/bin/env node
/**
 * 首启判定接线的反证驱动（UX 审计 1.4）
 * 骨架与 1.2 / 1.3 同源，四条纪律都在这儿：
 *   ① 解析前剥 ANSI；② 基线 collected>0 下界；③ 收集期死亡单列 RUN_UNCLEAN（不得读成 MISSED）；
 *   ④ 注入必须可执行、不得攻击断言本身；⑤ finally 还原 + 独立 md5 回读，不一致 rc=4，
 *      且 rc=4 由 main() 返回（不能靠 process.exitCode —— 末尾赋值会把它吃掉，1.2 驱动重新犯过一次）。
 * 用法：node scripts/first-run-launch-contract-mutate.js [--only=F3] [--keep-going]
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const F = (rel) => path.join(DESKTOP, rel)

const FIRST_RUN = F('electron/services/first-run.js')
const GATE = F('src/composables/useFirstRunGate.js')
const VIEW = F('src/views/FirstRun.vue')
const APP = F('src/App.vue')
const ACL = F('electron/ipc-handlers/license-access-control.js')
const PRELOAD = F('electron/preload/system.js')
const PUBLISHER = F('src/api/publisher.js')

const TEST_FILES = [
  'electron/services/first-run.test.js',
  'src/composables/useFirstRunGate.test.js',
  'src/views/FirstRun.test.js',
  // QM-6 i5：兜底形状改在 API 面，锁定它的那份测试必须在反证域内，
  // 否则 F13/F14 注入后域内零红 = 会被读成「这条锁抓不到东西」。
  'src/api/publisher.test.js',
]
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

const MUTATIONS = [
  {
    id: 'F1',
    label: '出口不调 firstRunComplete（标记永远不落，向导天天见）',
    file: VIEW,
    pairs: [{ from: 'const res = await firstRunComplete()', to: 'const res = { code: 0, data: { setupDone: true } }' }],
    expect: ['点「开始发布」必须先落首启标记再导航'],
  },
  {
    id: 'F2',
    label: '退回"启动即替用户写已完成"（本批要修的那颗雷）',
    file: FIRST_RUN,
    pairs: [{
      from: "  mainWin.webContents.send('first-run:status', { type: 'needed' })",
      to: "  markDone()\n  mainWin.webContents.send('first-run:status', { type: 'done' })",
    }],
    expect: ['无标记时 runSetup 不得写 first-run-done（自动收口就是本批要修的缺陷）', '无标记时广播 needed'],
  },
  {
    id: 'F3',
    label: '新通道漏登记授权白名单（点「完成」被静默挡掉且无错误）',
    file: ACL,
    pairs: [{ from: "'first-run:check', 'first-run:complete',", to: "'first-run:check'," }],
    expect: ['授权白名单必须登记该通道'],
  },
  {
    id: 'F4',
    label: 'preload 未导出对应方法（渲染层拿到 undefined，调用即抛）',
    file: PRELOAD,
    pairs: [{ from: "    firstRunComplete: () => ipcRenderer.invoke('first-run:complete'),", to: '' }],
    expect: ['preload 必须导出对应方法，且访问控制清单同步'],
  },
  {
    id: 'F5',
    label: '把"没读到"当成"还没做过"（dev server 每次访问都跳向导）',
    file: GATE,
    pairs: [{ from: 'if (typeof setupDone !== \'boolean\') {', to: 'if (false) {' }],
    expect: ['桥不可用（兜底档 code=-1）⇒ 不得导航，也不得把"没读到"当成"还没做过"', 'data 里缺 setupDone 或类型不对 ⇒ 同样按"无从判定"处理（不得用 undefined 猜）'],
  },
  {
    id: 'F6',
    label: '步骤①的「下一步」重新被假门槛锁死（新用户卡在第①步）',
    file: VIEW,
    pairs: [{
      from: '            <button class="cohere-btn-primary" @click="currentStep = 2">下一步：添加账号 →</button>',
      to: '            <button v-if="false" class="cohere-btn-primary" @click="currentStep = 2">下一步：添加账号 →</button>',
    }],
    expect: ['步骤①始终可前进：不依赖任何 allDepsDone 之类的假门槛'],
  },
  {
    id: 'F7',
    label: 'App.vue 不再调用启动判定（判定函数写得再好也无人执行）',
    file: APP,
    pairs: [
      { from: "import { maybeEnterFirstRun } from '@/composables/useFirstRunGate'", to: '// import removed by mutation' },
      { from: '  maybeEnterFirstRun({ router }).catch((error) => {', to: '  const mpMutationNoop = () => Promise.resolve(); mpMutationNoop({ router }).catch((error) => {' },
    ],
    expect: ['App.vue 必须真的在挂载时调用判定（否则向导仍然不可达）'],
  },
  {
    id: 'F8',
    label: '出口的两道闸一起摘（闩 + 按钮 disabled）—— 连点两次＝写两次标记、发两次导航',
    file: VIEW,
    // 首跑只摘闩时是 MISSED：`:disabled="finishing"` 才是那条行为用例真正测到的闸。
    // 两道独立闸必须各自有牙，所以 F8 摘两道（要求行为变红），F9 只摘 disabled（要求新的形状锁变红）。
    pairs: [
      { from: '  if (finishing.value) return', to: '  if (false) return' },
      { from: "            <button class=\"cohere-btn-primary\" :disabled=\"finishing\" data-testid=\"first-run-exit-publish\" @click=\"finishAndGo('/publish')\">开始发布 →</button>", to: "            <button class=\"cohere-btn-primary\" data-testid=\"first-run-exit-publish\" @click=\"finishAndGo('/publish')\">开始发布 →</button>" },
    ],
    expect: ['重复点击出口只落一次标记（finishing 闩）'],
  },
  {
    id: 'F9',
    label: '只摘按钮的 :disabled="finishing"（闩还在，但第一道闸没了）',
    file: VIEW,
    pairs: [{
      from: " :disabled=\"finishing\" data-testid=\"first-run-exit-publish\"",
      to: ' data-testid="first-run-exit-publish"',
    }],
    expect: ['出口按钮在落标记期间必须禁用（它与 finishAndGo 里的闩是两道独立的闸）'],
  },
  {
    id: 'F10',
    label: 'push 失败后不放开闩（一次性导航失败＝新用户本会话永久进不了向导）',
    file: GATE,
    pairs: [{
      from: ['    decided = false', "    warn('[first-run] navigation to '"].join('\n'),
      to: ['    // 闩保持置位（QM-6 i2 的旧形态）', "    warn('[first-run] navigation to '"].join('\n'),
    }],
    expect: ['router.push 拒绝时必须放开闩（否则一次性失败把新用户永久挡在向导外）'],
  },
  {
    id: 'F11',
    label: 'gate 默认 warn 退回 noop（生产接线不传 warn ⇒ check 抛错时零输出）',
    file: GATE,
    pairs: [{
      from: 'warn = (msg) => console.warn(msg) } = opts',
      to: 'warn = () => {} } = opts',
    }],
    expect: ['不传 warn 时默认必须真出声（生产接线就是「不传」这一支）'],
  },
  {
    id: 'F12',
    label: '向导出口的 router.push 退回 try/finally 之外（本函数注释第 3 条被自家代码违反）',
    file: VIEW,
    pairs: [{
      from: `  try {
    await router.push(path)
  } catch (error) {
    console.warn('[first-run] navigation after wizard exit failed: ' + ((error && error.message) || String(error)))
  }`,
      to: '  await router.push(path)',
    }],
    expect: ['导航被守卫拒绝时不得逃逸成未处理 rejection，且必须出声'],
  },
  {
    id: 'F13',
    label: 'firstRunCheck 无桥兜底退回旧形态 code:0 + setupDone:false（把「桥不可用」伪装成「还没做过」）',
    file: PUBLISHER,
    pairs: [{
      from: `invokeWithFallback("firstRunCheck", { code: -1, message: 'electronAPI not available', data: null })`,
      to: `invokeWithFallback("firstRunCheck", { code: 0, message: 'ok', data: { setupDone: false } })`,
    }],
    expect: ['firstRunCheck 不得把『桥不可用』伪装成 setupDone:false'],
  },
  {
    id: 'F14',
    label: 'firstRunComplete 无桥兜底谎报成功（写入口没执行却返回 code:0）',
    file: PUBLISHER,
    pairs: [{
      from: `invokeWithFallback("firstRunComplete", { code: -1, message: 'electronAPI not available', data: null })`,
      to: `invokeWithFallback("firstRunComplete", { code: 0, message: 'ok', data: { setupDone: true } })`,
    }],
    expect: ['firstRunComplete 无桥时必须返回非 0，不得声称已落标记'],
  },
  {
    id: 'F15',
    label: 'markDone 退回直接 writeFileSync(最终名)（QM-6 i10：半写/0 字节会被 existsSync 读成已完成）',
    file: FIRST_RUN,
    pairs: [{
      from: '      fs.writeFileSync(tmp, `done:${new Date().toISOString()}`)\n      fs.renameSync(tmp, p)',
      to: '      fs.writeFileSync(p, `done:${new Date().toISOString()}`)',
    }],
    expect: [
      'markDone 落盘后最终名内容完整且不留临时名 residue',
      'markDone 的 rename 失败且最终名不在场时必须原样进失败处理，不得留下半状态',
    ],
  },]

// 命令名按平台选：`pnpm.cmd` 是 Windows 专有，Linux runner 上 spawn 失败 ⇒ 基线读成 blind，
// 八道反证一条不跑却看起来像"环境问题"（任务 #23 要把这类驱动接进 CI）。
const RUNNER = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

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

function collectFailedTitles (out) {
  const list = []
  for (const line of out.split('\n')) {
    const m = line.match(/FAIL[^\n]*>\s*(.+?)\s*$/)
    if (m) list.push(m[1].trim())
  }
  return list
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
    console.error('[SUMMARY] RESTORE_FAILED —— 有文件还原后不一致，工作树可能仍在变异态')
    return 4
  }
  return bad.length ? 1 : 0
}

process.exitCode = main()
