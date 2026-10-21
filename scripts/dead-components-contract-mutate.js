#!/usr/bin/env node
/**
 * dead-components-contract-mutate.js —— UX 审计 1.3「撤下两个存在但无人渲染的组件」的反证驱动
 *
 * 判据与同仓 `visible-navigation-contract-mutate.js` / `hotkey-labels-contract-mutate.js` 同源：
 *   ① 基线不干净（rc≠0 / failed>0 / errors>0）一律拒跑（退出码 2）—— 否则红集不可归因；
 *   ② 严格命中：声明的每条探针**所解析到的每条用例标题**都必须进红集，否则 PARTIAL_RED；
 *   ③ 注入必须真的改变字节；还原放 finally 且**自报不作数**，跑完独立做 md5 回读比对（rc=4）；
 *   ④ 退出码：0 全部按预期变红 / 1 有 MISSED 或 PARTIAL_RED / 2 驱动自身故障 / 4 还原失败。
 *
 * 用法：node scripts/dead-components-contract-mutate.js [--only=C2] [--keep-going]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const SETUP = path.join(DESKTOP, 'test-setup.js')
const GUARD = path.join(DESKTOP, 'src', 'components', 'dead-components.test.js')
const MAIN = path.join(DESKTOP, 'src', 'main.js')
const LOADING = path.join(DESKTOP, 'src', 'components', 'LoadingState.vue')
const DASH_VUE = path.join(DESKTOP, 'src', 'views', 'Dashboard.vue')
const STYLE_GUARD = path.join(DESKTOP, 'src', 'views', 'Dashboard.style-guard.test.js')

const TEST_FILES = ['src/components/dead-components.test.js']
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

/** 同时接受 LF 与 CRLF 两种落盘形态 */
function locate (src, needle) {
  for (const form of [needle, needle.split('\n').join('\r\n')]) {
    const idx = src.indexOf(form)
    if (idx >= 0) return { idx, text: form }
  }
  return null
}

const MUTATIONS = [
  {
    id: 'C1',
    label: '测试宿主的注册表又把 LoadingState 加回来（镜像注册点是第二个写者）',
    file: SETUP,
    from: '  EmptyState,\n  UiSkeleton,',
    // 必须写成「键: 已有值」这种**可执行**形态。上一版写成裸 `LoadingState,`（简写属性），
    // 那是一个未定义标识符 ⇒ test-setup.js 求值期抛 ReferenceError，整个测试文件收集失败，
    // 现场只有 `FAIL <file>` 而没有 `> 叶子标题`，红条数解析成 0 ⇒ 被误判成 MISSED。
    // 实测：rc=1 / failed=0 / 具名红 0 条（见本驱动 RUN_UNCLEAN 档）。
    to: '  EmptyState,\n  LoadingState: EmptyState,\n  UiSkeleton,',
    expect: ['测试宿主（test-setup.js）不得再注册已退役组件'],
  },
  {
    id: 'C2',
    label: '某个真实模板重新使用 <LoadingState />',
    file: MAIN,
    from: "app.component('EmptyState', EmptyState)",
    to: "app.component('LoadingState', EmptyState)\napp.component('EmptyState', EmptyState)",
    expect: ['代码里不得再出现 LoadingState'],
  },
  {
    id: 'C3',
    label: '豁免的反向守卫被掏空（探针换名字 ⇒ 豁免清单变成白拿的洞）',
    file: STYLE_GUARD,
    from: 'tpl.indexOf("<TrialBanner")',
    // 上一版这条是把 `expect(guard, ...)` 那行本身删掉——**删断言不可能被同一条断言抓到**，
    // 那条变异证的不是"锁有没有牙"，而是"锁会不会发现自己被删"，属取错变量。
    // 现在攻击的是被豁免方**真正做的探测**：探针换名字后守卫永远找不到、恒过，
    // 而文件里依然提到 TrialBanner（注释里），所以只查名字的旧判据照样绿。
    to: 'tpl.indexOf("<GhostBanner")',
    expect: ['反向守卫本身必须还在'],
  },
  {
    id: 'C4',
    label: '扫描根退化成不存在的目录（"零命中"不得读成"零引用"）',
    file: GUARD,
    from: "const SRC = path.resolve(DESKTOP_ROOT, 'src')",
    to: "const SRC = path.resolve(DESKTOP_ROOT, 'src-does-not-exist')",
    expect: ['扫描域必须非空'],
  },
  {
    id: 'C5',
    label: '组件文件被重新创建（复活一个空壳也会让"存在但无人渲染"回来）',
    file: DASH_VUE,
    // 变异打在 Dashboard.vue 上没意义，这条改的是"文件存在性"判据 ⇒ 注入点是新建文件本身。
    // 驱动对"新建文件"这一形态单独支持（create/remove），因为 from/to 在这里不存在。
    create: LOADING,
    createBody: '<template><div /></template>\n',
    expect: ['组件文件本身不得复活'],
  },
]

function runVitest () {
  const res = spawnSync('pnpm.cmd', ['exec', 'vitest', 'run', ...TEST_FILES], {
    cwd: DESKTOP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true,
  })
  // ANSI 必须先剥：vitest 把汇总行的数字包在 `\x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m` 里，
  // 于是 /Tests\s+(\d+) failed/ 永不命中 ⇒ failedCount 恒 0，"基线不红"与"变异没红"完全同形，
  // 且 blind 判据因 "Test Files" 仍在而不报警。本轮 C1–C5 全部 MISSED 就是这个形状。
  const out = ((res.stdout || '') + (res.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
  const failed = [...out.matchAll(/FAIL[^\n]*>/g)].map((m) => m[0])
  const sum = out.match(/Tests\s+(?:(\d+) failed[^0-9]*)?/)
  const passedSum = out.match(/Tests\s+[^0-9]*(\d+) passed/)
  const errSum = out.match(/Errors\s+(\d+)/)
  return {
    rc: res.status,
    failedTitles: failed.length ? collectFailedTitles(out) : [],
    failedCount: sum ? Number(sum[1] || 0) : 0,
    passedCount: passedSum ? Number(passedSum[1]) : 0,
    errorCount: errSum ? Number(errSum[1]) : 0,
    blind: !sum && !/Test Files/.test(out),
    out,
  }
}

/** 红集用 FAIL 行的**末段**（叶子标题），与守卫侧 needle 同一坐标 */
function collectFailedTitles (out) {
  const list = []
  for (const line of out.split('\n')) {
    const m = line.match(/FAIL[^\n]*>\s*(.+?)\s*$/)
    if (m) list.push(m[1].trim())
  }
  return list
}

function main () {
  const args = process.argv.slice(2)
  const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '')
  const keepGoing = args.includes('--keep-going')
  const targets = only ? MUTATIONS.filter((m) => m.id === only) : MUTATIONS
  if (only && !targets.length) { console.error('UNKNOWN_ID ' + only); return 2 }

  const baseline = runVitest()
  // collected 必须 > 0：TEST_FILES 路径写错时 vitest 报「No test files found」但 rc 可能仍为 0，
  // 于是"基线干净"与"什么都没跑"同形——这是本驱动第一版全 MISSED 的第二条成因。
  const collected = baseline.passedCount + baseline.failedCount
  console.log(`[BASELINE] rc=${baseline.rc} failed=${baseline.failedCount} passed=${baseline.passedCount} collected=${collected} errors=${baseline.errorCount} blind=${baseline.blind}`)
  if (baseline.rc !== 0 || baseline.failedCount > 0 || baseline.errorCount > 0 || baseline.blind || collected === 0) {
    console.log('[BASELINE] 基线不干净（或一条都没收集到）—— 先修基线，否则变异红集不可归因')
    return 2
  }

  const rows = []
  for (const mu of targets) {
    const isCreate = Boolean(mu.create)
    const file = isCreate ? mu.create : mu.file
    const existed = fs.existsSync(file)
    const before = existed ? fs.readFileSync(file) : null
    let applied = false
    try {
      if (isCreate) {
        fs.writeFileSync(file, mu.createBody)
        applied = true
      } else {
        const src = fs.readFileSync(file, 'utf8')
        const found = locate(src, mu.from)
        if (!found) {
          console.log(`[${mu.id}] ANCHOR_NOT_FOUND :: ${mu.label}`)
          rows.push({ id: mu.id, verdict: 'ANCHOR_NOT_FOUND' })
          if (!keepGoing) return 2
          continue
        }
        const eol = found.text.includes('\r\n') ? '\r\n' : '\n'
        const toText = mu.to.split('\n').join(eol)
        const next = src.slice(0, found.idx) + toText + src.slice(found.idx + found.text.length)
        if (md5(Buffer.from(next)) === md5(Buffer.from(src))) {
          console.log(`[${mu.id}] NO_BYTE_CHANGE :: ${mu.label}`)
          rows.push({ id: mu.id, verdict: 'NO_BYTE_CHANGE' })
          if (!keepGoing) return 2
          continue
        }
        fs.writeFileSync(file, next)
        applied = true
      }
      const run = runVitest()
      if (run.blind) {
        console.log(`[${mu.id}] PROBE_BLIND :: ${mu.label} —— 没解析到测试汇总，红/绿不可知`)
        rows.push({ id: mu.id, verdict: 'PROBE_BLIND' })
        if (!keepGoing) return 2
        continue
      }
      const silent = []
      for (const needle of mu.expect) {
        if (!run.failedTitles.some((t) => t.includes(needle))) silent.push(needle)
      }
      // 收集期死亡（模块求值抛错 / 解析失败）在 vitest 输出里只有 `FAIL <file>`，
      // 既没有 `Tests N failed` 也没有 `Errors N` —— 上一版因此把 C1 读成 MISSED（"锁没牙"），
      // 而真相是那一趟根本没跑到断言。判据：rc≠0 或存在无 `>` 的文件级 FAIL ⇒ RUN_UNCLEAN。
      const fileLevelFail = /^FAIL\s+\S+\s*\[*/m.test(run.out) && run.failedTitles.length === 0
      const uncleans = run.errorCount > 0 || (run.rc !== 0 && run.failedCount === 0) || fileLevelFail
      const verdict = run.failedCount === 0
        ? (uncleans ? 'RUN_UNCLEAN' : 'MISSED')
        : (silent.length ? 'PARTIAL_RED' : 'CAUGHT')
      console.log(`[${mu.id}] ${verdict} :: ${mu.label} — 红 ${run.failedCount} 条（探针命中 ${mu.expect.length - silent.length}/${mu.expect.length}）` + (silent.length ? `；沉默：${silent.join(' / ')}` : '') + (verdict === 'RUN_UNCLEAN' ? `；rc=${run.rc} errors=${run.errorCount} 具名红=0 ⇒ 本条不可归因，需把变异改成可执行形态或修驱动解析` : ''))
      rows.push({ id: mu.id, verdict })
    } finally {
      if (applied || existed) {
        if (before === null) { if (fs.existsSync(file)) fs.rmSync(file) }
        else fs.writeFileSync(file, before)
      }
    }
  }

  const bad = rows.filter((r) => r.verdict !== 'CAUGHT')
  console.log(`[SUMMARY] 共 ${rows.length} 条：CAUGHT=${rows.length - bad.length} 其余=${bad.length}` + (bad.length ? `  ${bad.map((r) => r.id + '=' + r.verdict).join(' ')}` : ''))
  return bad.length ? 1 : 0
}

if (require.main === module) {
  const code = main()
  process.exit(code)
}
module.exports = { MUTATIONS }
