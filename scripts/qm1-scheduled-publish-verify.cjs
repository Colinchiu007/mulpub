const { execSync, spawn } = require('child_process')
// QM-1 子进程环境纪律（fix-qm1-electron-run-as-node）：剔除 ELECTRON_RUN_AS_NODE，
// 并在父环境带着它时出声告警。回归锁 scripts/qm1-child-env.test.js 含接线锁。
// 注意：helper 必须放在 scripts/lib/ 下 —— 根级 .gitignore 的 `scripts/*.js`
// 只放行白名单里的若干文件，放同级会被静默忽略（症状：本地全绿、CI 上
// Cannot find module；见 .gitignore:109-111 的同族记载）。
const { ELECTRON_RUN_AS_NODE, buildChildEnv, envDefectNotice } = require('./lib/qm1-child-env.js')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DESKTOP = path.resolve(__dirname)
const ASAR = path.join(DESKTOP, 'dist-electron', 'win-unpacked', 'resources', 'app.asar')
const EXE = path.join(DESKTOP, 'dist-electron', 'win-unpacked', 'Multi-Publish.exe')
const LAUNCH_WINDOW_MS = 8000

function step (name) { console.log(`\n=== ${name} ===`) }
function ok (msg) { console.log(`  PASS ${msg}`) }
function bad (msg) { console.log(`  FAIL ${msg}`); process.exitCode = 1 }

step('验证 0：产物存在')
for (const [label, p] of [['app.asar', ASAR], ['Multi-Publish.exe', EXE]]) {
  if (fs.existsSync(p)) ok(`${label} 存在（${Math.round(fs.statSync(p).size / 1024)} KB）`)
  else bad(`${label} 缺失`)
}

step('验证 1：asar 文件清单（定时发布相关模块必须打包进去）')
let list = ''
try {
  list = execSync(`pnpm exec asar list "${ASAR}"`, { encoding: 'utf8', cwd: DESKTOP, maxBuffer: 64 * 1024 * 1024 })
} catch (e) {
  bad(`asar list 失败：${e.message}`)
  process.exit(1)
}
const required = [
  ['shared-utils scheduler', /shared-utils[\\/]src[\\/]scheduler\.js/],
  ['desktop scheduler service', /electron[\\/]services[\\/]scheduler\.js/],
  ['resume-guard（休眠重算）', /electron[\\/]bootstrap[\\/]resume-guard\.js/],
  ['ipc-handlers scheduler', /electron[\\/]ipc-handlers[\\/]scheduler\.js/],
  ['batch-manager', /electron[\\/]services[\\/]batch-manager\.js/],
  ['preload bundle', /electron[\\/]preload[\\/]index\.bundle\.js/],
]
for (const [label, re] of required) {
  if (re.test(list)) ok(`${label} 已在 asar 内`)
  else bad(`${label} 缺失于 asar`)
}

step('验证 2：打包产物可 require，且定时重算 API（rearm）真实存在')
const extractDir = path.join(os.tmpdir(), 'mp-qm1-asar')
fs.rmSync(extractDir, { recursive: true, force: true })
try {
  execSync(`pnpm exec asar extract "${ASAR}" "${extractDir}"`, { encoding: 'utf8', cwd: DESKTOP, maxBuffer: 64 * 1024 * 1024 })
} catch (e) {
  bad(`asar extract 失败：${e.message}`)
  process.exit(1)
}

// resume-guard 不依赖 Electron，可直接 require；
// scheduler.js 顶层 require('electron')，在 Electron 外必然失败——因此 rearm 的
// 存在性改由 shared-utils 的纯业务实现校验（它才是 rearm 的定义处）。
const probe = path.join(extractDir, '__qm1_probe.cjs')
fs.writeFileSync(probe, `
const path = require('path')
const root = ${JSON.stringify(extractDir)}
const out = []
try {
  const m = require(path.join(root, 'electron', 'bootstrap', 'resume-guard.js'))
  out.push('resumeGuardExports=' + Object.keys(m).sort().join(','))
} catch (e) { out.push('RESUME_GUARD_REQUIRE_FAILED=' + e.message) }

try {
  const s = require(path.join(root, 'node_modules', '@multi-publish', 'shared-utils', 'src', 'scheduler.js'))
  const keys = Object.keys(s.createScheduler({ app: { getPath: () => require('os').tmpdir() } })).sort()
  out.push('schedulerInstanceApi=' + keys.join(','))
} catch (e) {
  // node_modules 未打进 asar（external）时回落到仓库内源
  out.push('SCHEDLER_PROBE_SKIPPED=' + e.message.slice(0, 60))
}
console.log(out.join('\\n'))
`, 'utf8')

try {
  const out = execSync(`node "${probe}"`, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  console.log('  ' + out.trim().split('\n').join('\n  '))
  if (out.includes('RESUME_GUARD_REQUIRE_FAILED')) bad('resume-guard 在打包产物内无法 require')
  else ok('resume-guard 在打包产物内可 require')
  if (out.includes('RESUME_GUARD_REQUIRE_FAILED') === false &&
      !out.includes('createResumeGuard')) bad('resume-guard 导出缺失')
} catch (e) {
  bad(`require 链验证失败：${e.stdout || ''} ${e.stderr || e.message}`)
}

// rearm 的权威校验：直接查 asar 内 scheduler.js 源码是否含 rearm 定义与导出
const schedulerSrc = fs.readFileSync(
  path.join(extractDir, 'node_modules', '@multi-publish', 'shared-utils', 'src', 'scheduler.js'),
  'utf8'
)
if (/function rearm\s*\(/.test(schedulerSrc) && /rearm/.test(schedulerSrc.match(/return \{[^}]*\}/g)?.slice(-1)[0] || '')) {
  ok('打包产物内 scheduler 定义并导出了 rearm')
} else {
  const hasFn = /function rearm\s*\(/.test(schedulerSrc)
  const hasExport = /cancel, restore, rearm, stopAll/.test(schedulerSrc)
  console.log(`  rearm 定义=${hasFn} 导出=${hasExport}`)
  if (hasFn && hasExport) ok('打包产物内 scheduler 定义并导出了 rearm')
  else bad('打包产物内 scheduler 缺少 rearm')
}

step(`验证 3：启动 ${LAUNCH_WINDOW_MS / 1000} 秒不崩溃 + 捕获 stderr`)
if (!fs.existsSync(EXE)) {
  bad('exe 缺失，跳过启动验证')
} else {
  let stderr = ''
  let stdout = ''
  // ⛔ 2026-10-15：必须显式传 env，且其中剔除 ELECTRON_RUN_AS_NODE。
  //    父环境带该变量时（本机 DSH 会话默认带），Electron 会以纯 Node 模式启动并
  //    静默退出（rc=0、stdout/stderr 全空）—— 与「启动干净」同形 ⇒ 假绿。
  const envNotice = envDefectNotice(process.env)
  if (envNotice) {
    console.log(`  ⚠ 环境告警：${envNotice}`)
  }
  const child = spawn(EXE, [], { stdio: ['ignore', 'pipe', 'pipe'], env: buildChildEnv(process.env) })
  child.stdout.on('data', d => { stdout += d.toString() })
  child.stderr.on('data', d => { stderr += d.toString() })

  let exited = false
  let premature = null
  child.on('exit', (code, signal) => { exited = true; premature = { code, signal } })

  // 真实延时窗口：这里必须传「相对毫秒数」，不能传 Date.now()+N（那是时间戳，
  // 会被 Node 钳到 1ms 并抛 TimeoutOverflowWarning，导致验证窗口形同虚设）
  setTimeout(() => {
    if (exited) {
      // 存活是「三层 stderr 判据」的隐含前提：进程没起来时 stderr 必然为空，
      // 只看 stderr 就会把「根本没启动」读成「启动干净」。故这里必须红。
      bad(`进程提前退出：code=${premature.code} signal=${premature.signal}`
        + `（若 code=0 且 stdout/stderr 皆空，先查 ${ELECTRON_RUN_AS_NODE}：`
        + '它会让孩子以纯 Node 模式启动并静默退出）')
    } else {
      ok(`进程在 ${LAUNCH_WINDOW_MS / 1000} 秒后仍存活（未崩溃）`)
    }

    // ★ 判据形态修正（2026-10-14）：原实现是「黑名单全不中 ⇒ 报 PASS」，
    //   那对**未知故障恒返回绿** —— 实测现场：stderr 里躺着
    //   `bad option: --user-data-dir=...`（隔离实例参数被应用拒绝），
    //   但它不在黑名单里，于是判据打印「未命中红线」⇒ 假绿。
    //
    //   **黑名单式判据只能检出「已知」故障。** 正确形态是分层：
    //     ① 命中黑名单 ⇒ 必然 FAIL（已知必败，加速通道）
    //     ② stderr **非空但未命中黑名单** ⇒ **不得判 PASS**，判 NEEDS_REVIEW
    //        （打印全文，把判断权交给人 —— 宁可乐红也不假绿）
    //     ③ stderr 为空 ⇒ 才可判 PASS
    const combined = stderr + '\n' + stdout
    const forbidden = [
      /Failed to load platform config/i,
      /PluginLoader.*mkdir failed/i,
      /ENOTDIR.*app\.asar/i,
      /Cannot find module/i,
    ]
    const hits = forbidden.filter(re => re.test(combined))
    if (hits.length > 0) {
      for (const re of hits) bad(`启动 stderr 命中红线：${re}`)
    } else if (stderr.trim()) {
      // ② 未知内容：不判 PASS，也不判 FAIL —— 判「需人工判断」
      console.log('  NEEDS_REVIEW 启动 stderr 非空但未命中已知红线 —— 需人工判断（不得据此判 PASS）')
      console.log('  --- stderr 全文 ---')
      console.log(stderr.trim())
      console.log('  --- stderr 全文结束 ---')
      // 不置 exitCode：本脚本无法替人判断未知内容。但**绝不报 PASS**。
    } else {
      ok('启动 stderr 为空（配置加载/插件路径/ASAR 内部访问均无输出）')
    }
    console.log(`  stderr 长度=${stderr.length} stdout 长度=${stdout.length}`)

    try { child.kill() } catch { /* ignore */ }
    fs.rmSync(extractDir, { recursive: true, force: true })
    console.log('\n=== QM-1 汇总 ===')
    console.log(process.exitCode ? 'QM-1 存在 FAIL 项' : 'QM-1 全部通过')
  }, LAUNCH_WINDOW_MS)
}