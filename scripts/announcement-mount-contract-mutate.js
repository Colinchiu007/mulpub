#!/usr/bin/env node
/**
 * 公告横幅接线的反证驱动（UX 审计 1.2）
 *
 * 与 1.3 / 1.5 / 1.6 的同类驱动同一套骨架，并把那三批踩过的坑写死在这里：
 *   ① 解析前必须剥 ANSI（vitest 把汇总数字包在转义符里，不剥则 failedCount 恒 0，
 *      "基线干净"与"变异没红"共用同一个读数）；
 *   ② 基线必须有 collected>0 下界（TEST_FILES 写错时 vitest 报 "No test files found"
 *      而 rc 可能仍为 0）；
 *   ③ 收集期死亡单列 RUN_UNCLEAN（rc≠0 且具名红=0 ⇒ 不可归因，**不得**读成锁没牙）；
 *   ④ 注入必须是可执行形态，且不得攻击断言本身（删断言不可能被同一条断言抓到）；
 *   ⑤ finally 还原 + 还原后独立 md5 回读，不一致退出码 4。
 *
 * 用法：node scripts/announcement-mount-contract-mutate.js [--only=C3] [--keep-going]
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const APP = path.join(DESKTOP, 'src', 'App.vue')
const BANNER = path.join(DESKTOP, 'src', 'components', 'AnnouncementBanner.vue')

const TEST_FILES = [
  'src/announcement-mount-wiring.test.js',
  'src/components/AnnouncementBanner.test.js',
  'src/locales/announcement-copy.test.js',
]
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

const MOUNT_TAG = '          <AnnouncementBanner />'
const HOME_SHELL_ANCHOR = '      <div class="mp-home-shell-root" data-testid="mp-home-shell">'

const MUTATIONS = [
  {
    id: 'C1',
    label: '挂载被后续改动摘掉（组件还在、测试还在，用户又看不见了）',
    file: APP,
    pairs: [{ from: MOUNT_TAG, to: '          <!-- 公告横幅 -->' }],
    expect: ['App.vue 必须渲染 AnnouncementBanner（零渲染方就是本批要修的缺陷）'],
  },
  {
    id: 'C2',
    label: '挂载被搬进内嵌主页壳态分支（同一份公告会画两遍 / 挂错实例）',
    file: APP,
    // 两拍子：先从外壳删，再往壳态加 ⇒ 全仓仍然恰好一处挂载，
    // 这样只有"分支位置"那条红，不会顺带把"数量=1"那条也打死（红集可归因）。
    pairs: [
      { from: MOUNT_TAG, to: '' },
      { from: HOME_SHELL_ANCHOR, to: HOME_SHELL_ANCHOR + '\n        <AnnouncementBanner />' },
    ],
    expect: ['不得在内嵌主页壳态分支里渲染（同一份公告不得画两遍）'],
  },
  {
    id: 'C3',
    label: '空列表也渲染容器（无公告时留下一个空 landmark 占位）',
    file: BANNER,
    pairs: [{ from: 'v-if="visibleAnnouncements.length > 0"', to: 'v-if="true"' }],
    expect: ['没有公告时不得渲染任何容器（含 landmark）'],
  },
  {
    id: 'C4',
    label: '维护公告也给了关闭按钮（用户可以把"系统维护"消音）',
    file: BANNER,
    pairs: [{ from: "v-if=\"severityOf(a) !== 'maintenance'\"", to: 'v-if="true"' }],
    expect: ['维护公告不得提供关闭按钮，info/warning 可以关'],
  },
  {
    id: 'C5',
    label: '关闭记忆退化成同一个常量键（关掉一条等于关掉全部）',
    file: BANNER,
    pairs: [{ from: "if (id !== undefined && id !== null && id !== '') return 'id:' + id", to: "return 'idx:0'" }],
    expect: ['运营新增公告不得让已关闭项复活、也不得让新项消失（判据不得按下标）'],
  },
  {
    id: 'C6',
    label: '未知 severity 不再降级到 info，而是产出空档位（样式与标签双双落空）',
    file: BANNER,
    pairs: [{ from: "return SEVERITIES.includes(a && a.severity) ? a.severity : 'info'", to: "return SEVERITIES.includes(a && a.severity) ? a.severity : ''" }],
    expect: ['未知 severity 落 info 档且整条不得被丢弃'],
  },
  {
    id: 'C7',
    label: '可访问名退回硬编码中文（英文界面露中文，读屏也读到中文）',
    file: BANNER,
    pairs: [{ from: ":aria-label=\"t('announcement.regionLabel')\"", to: 'aria-label="运营公告"' }],
    expect: ['组件模板与脚本不得自带中文文案（可访问名也是文案）'],
  },
]

// QM-6 i2：`pnpm.cmd` 是 Windows 专有文件名，POSIX 上 spawn 直接失败 ⇒ 基线读成 blind，
// 7 道反证一条都不跑却"看起来只是环境问题"。任务 #23 要把这类驱动接进 CI（Linux runner），
// 所以命令名必须按平台选，不能只在这台机器上成立。
const RUNNER = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function runVitest () {
  const res = spawnSync(RUNNER, ['exec', 'vitest', 'run', ...TEST_FILES], {
    cwd: DESKTOP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true,
  })
  const raw = (res.stdout || '') + (res.stderr || '')
  const out = raw.replace(/\x1b\[[0-9;]*m/g, '')
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

/** 红集取 FAIL 行的叶子标题，与 needle 同一坐标 */
function collectFailedTitles (out) {
  const list = []
  for (const line of out.split('\n')) {
    const m = line.match(/FAIL[^\n]*>\s*(.+?)\s*$/)
    if (m) list.push(m[1].trim())
  }
  return list
}

/** 同时接受 LF / CRLF 落盘形态 */
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
  // finally 之外还要信号兜底：Node 收到 SIGINT/SIGTERM 时默认不执行 finally，
  // 中途打断会把工作树留在变异态（1.3 驱动 i4 的同一条）。
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
    let applied = false
    let anchorMissing = false
    active.file = file
    active.before = before
    try {
      let src = before.toString('utf8')
      for (const pair of mu.pairs) {
        const found = locate(src, pair.from)
        if (!found) {
          console.log(`[${mu.id}] ANCHOR_NOT_FOUND :: ${mu.label} —— 锚点过期，本条不可归因：${JSON.stringify(pair.from.slice(0, 60))}`)
          rows.push({ id: mu.id, verdict: 'ANCHOR_NOT_FOUND' })
          anchorMissing = true
          break
        }
        const eol = found.text.includes('\r\n') ? '\r\n' : '\n'
        const toText = pair.to.split('\n').join(eol)
        src = src.slice(0, found.idx) + toText + src.slice(found.idx + found.text.length)
      }
      if (anchorMissing) {
        if (!keepGoing) return 2
        continue
      }
      if (before !== null && md5(Buffer.from(src)) === md5(before)) {
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
      const silent = mu.expect.filter((needle) => !run.failedTitles.some((t) => t.includes(needle)))
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
      if (applied && before !== null) {
        fs.writeFileSync(file, before)
        const back = fs.readFileSync(file)
        if (md5(back) !== md5(before)) {
          console.error(`[${mu.id}] RESTORE_MISMATCH :: ${file} 还原后字节不一致`)
          restoreFailed = true
        } else {
          console.log(`[${mu.id}] RESTORE_OK`)
        }
        active.file = null
      }
    }
  }

  const bad = rows.filter((r) => r.verdict !== 'CAUGHT')
  console.log(`[SUMMARY] 共 ${rows.length} 条：CAUGHT=${rows.length - bad.length} 其余=${bad.length}` + (bad.length ? `  ${bad.map((r) => r.id + '=' + r.verdict).join(' ')}` : ''))
  // rc=4 必须比"变异没红"更有优先级，且**不得**被末尾的赋值吃掉：
  // 上一版在 finally 里写 process.exitCode=4，而 main() 回来后 `process.exitCode = main()`
  // 把它覆盖成 0/1 ⇒ 还原失败的信号永远发不出去（1.3 驱动 i4 同一格，这次是我自己重新犯的）。
  if (restoreFailed) {
    console.error('[SUMMARY] RESTORE_FAILED —— 有文件还原后不一致，工作树可能仍在变异态')
    return 4
  }
  return bad.length ? 1 : 0
}

process.exitCode = main()
