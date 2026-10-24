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
const DASH_TEST = path.join(DESKTOP, 'src', 'views', 'Dashboard.test.js')
const PROBE = path.join(DESKTOP, 'tests', 'visual-testing', 'scripts', 'contrast-probe.js')
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
  {
    id: 'C6',
    label: '接线藏在「同一行的块注释」之后（旧 code() 按行首注释符过滤会整行丢弃 ⇒ 漏报）',
    file: MAIN,
    from: "app.component('EmptyState', EmptyState)",
    // 攻击的正是 i2 指出的漏报形态：注释符在行首、代码跟在后面同一行。
    // 旧实现把整行当注释丢掉 ⇒ 真实重新接线在锁下隐身；新实现先整块剥注释、再保留代码。
    to: "/* 恢复试用横幅 */ app.component('LoadingState', EmptyState)\napp.component('EmptyState', EmptyState)",
    expect: ['代码里不得再出现 LoadingState（含 main.js 的全局注册）'],
  },
  {
    id: 'C7',
    label: '豁免文件的缺席断言被改成正面断言（名字还在，洞也还在）',
    file: DASH_TEST,
    from: 'expect(w.findComponent({ name: "TrialBanner" }).exists()).toBe(false);',
    to: 'expect(w.findComponent({ name: "TrialBanner" }).exists()).toBe(true);',
    // 旧判据只 toContain('TrialBanner') ⇒ 这一改完全隐身（QM-6 i1 命中的就是这里）。
    expect: ['反向守卫本身必须还在（防止把豁免清单当成可复用的洞）'],
  },
  {
    id: 'C8',
    label: '对比度探针仍按已撤组件的类名取元素（该档静默变成"从未测过"）',
    file: PROBE,
    from: "['dashboard', '/dashboard', '.stat-label'],",
    to: "['dashboard', '/dashboard', '.banner-text'],",
    expect: ['对比度探针不得再指向已撤组件的类名'],
  },
  {
    id: 'C9',
    label: '守卫探测的模板串被换成硬编码常量（indexOf 恒 -1、守卫恒绿，两个子串却都还在）',
    file: STYLE_GUARD,
    from:
      '    const tpl = descriptor.template.content;' + '\n' +
      '    const bannerIdx = tpl.indexOf("<TrialBanner");',
    to:
      '    const tpl = "<html></html>";' + '\n' +
      '    const bannerIdx = tpl.indexOf("<TrialBanner");',
    // 旧的文件级双子串判据对这一改完全免疫；QM-6 第二轮 i2 命中的就是这里。
    expect: ['反向守卫本身必须还在（防止把豁免清单当成可复用的洞）'],
  },
  {
    id: 'C10',
    label: '探针量不到目标时退回 0 收尾（跑了 4 条会被读成量了 4 条）',
    file: PROBE,
    from: '  process.exitCode = missed.length ? 1 : 0',
    to: '  process.exitCode = 0',
    expect: ['对比度探针不得再指向已撤组件的类名'],
  },
]

// QM-6 i5：`pnpm.cmd` 是 Windows 专有文件名。任务 #23 要把这类驱动接进 CI（Linux runner），
// 那里 spawn 失败 ⇒ vitest 零输出 ⇒ 基线被 blind 判据拒跑（rc=2），7~10 道反证一条都不跑，
// 而失效形态读起来完全像"环境问题"。命令名必须按平台选，不能只在这台机器上成立。
const RUNNER = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function runVitest () {
  const res = spawnSync(RUNNER, ['exec', 'vitest', 'run', ...TEST_FILES], {
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
  // QM-6 i4 的第二半：Node 收到 SIGINT/SIGTERM 时**默认不执行 finally**，
  // 中途被打断会把工作树留在变异态（本仓真的踩过一次，见记忆
  // 「变异电池被打断会把源文件留在变异态」）。所以除 finally 之外还要注册信号兜底。
  let restoreFailed = false
  const active = { file: null, before: null, existed: false }
  const restoreActive = () => {
    if (!active.file) return
    try {
      if (active.before === null) { if (fs.existsSync(active.file)) fs.rmSync(active.file) }
      else fs.writeFileSync(active.file, active.before)
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
    const isCreate = Boolean(mu.create)
    const file = isCreate ? mu.create : mu.file
    const existed = fs.existsSync(file)
    const before = existed ? fs.readFileSync(file) : null
    let applied = false
    active.file = file
    active.before = before
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
      // QM-6 i4：头注释一直写着"还原后独立 md5 回读（rc=4）"，而实现里没有这一段 ——
      // 注释写的是契约，实现没做，就是装饰性承诺。现在补实现，并加信号兜底。
      if (applied || existed) {
        if (before === null) { if (fs.existsSync(file)) fs.rmSync(file) }
        else fs.writeFileSync(file, before)
        const now = fs.existsSync(file) ? fs.readFileSync(file) : null
        const ok = before === null ? now === null : (now !== null && md5(now) === md5(before))
        if (!ok) {
          console.error(`[${mu.id}] RESTORE_MISMATCH :: ${file} 还原后字节与备份不一致 —— 工作树可能被留在变异态`)
          restoreFailed = true
        } else {
          console.log(`[${mu.id}] RESTORE_OK`)
        }
      }
    }
  }

  const bad = rows.filter((r) => r.verdict !== 'CAUGHT')
  console.log(`[SUMMARY] 共 ${rows.length} 条：CAUGHT=${rows.length - bad.length} 其余=${bad.length}` + (bad.length ? `  ${bad.map((r) => r.id + '=' + r.verdict).join(' ')}` : ''))
  if (restoreFailed) {
    console.error('[SUMMARY] RESTORE_FAILED —— 有文件还原后字节不一致，工作树可能仍在变异态，先手工核对再重跑')
    return 4
  }
  return bad.length ? 1 : 0
}

if (require.main === module) {
  const code = main()
  process.exit(code)
}
module.exports = { MUTATIONS }
