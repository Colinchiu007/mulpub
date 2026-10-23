// 变异反证 harness —— **入仓**以便审计复现。
// 动因（2026-10-22 CCG 外部评审第三轮 i2）：此前把变异证据写进评审记录时，
// 引用的是仓外的一次性临时脚本 ⇒ 评审记录里的「全 CAUGHT」**不可复现**。
// 本文件是那条证据的可复现载体：逐条把实现改坏 → 断言对应用例必须变红 →
// 跑后把每个被变异文件还原并**分别**比对 md5。
//
// 用法（仓库根目录下）：node openspec/changes/login-observe-domain-coverage/evidence/mutation-harness.cjs .
// 退出码：0 = 全部 CAUGHT 且所有文件已还原；1 = 有 ESCAPED 或还原失败。
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(process.argv[2] || '.')
const testRel = process.argv[3] || 'electron/services/login-network-diagnostics.test.js'
const MON = 'apps/desktop/electron/services/login-network-monitor.js'
const DIA = 'apps/desktop/electron/services/login-network-diagnostics.js'
const GATE = 'if (monitor.OBSERVATION_GUARD.readsResponseBodyPlatforms.indexOf(platform) === -1) return'

const MUTATIONS = [
  { file: MON, name: 'M1 监测域去掉 yhgfb-cn-static.com', from: "'yhgfb-cn-static.com',", to: "'__dropped__'," },
  { file: MON, name: 'M2 监测域去掉 bytetos.com', from: "'bytetos.com'", to: "'__dropped__'" },
  { file: MON, name: 'M3 组合锚点去掉 captcha 段', from: 'return hasVersionDir && hasCaptchaSegment', to: 'return hasVersionDir' },
  { file: MON, name: 'M4 组合锚点去掉版本目录段', from: 'return hasVersionDir && hasCaptchaSegment', to: 'return hasCaptchaSegment' },
  { file: MON, name: 'M5 监测域匹配恒 false', from: 'return matcher.test(host)', to: 'return false' },
  { file: MON, name: 'M6 验证码入口锚点整体失效', from: "CAPTCHA_SDK_DIR_MARKER = '/sec_sdk_build/'", to: "CAPTCHA_SDK_DIR_MARKER = '/__never__/'" },
  { file: MON, name: 'M7 具名组合谓词恒 false', from: 'return hasVersionDir && hasCaptchaSegment', to: 'return false' },
  { file: MON, name: 'M8 具名组合谓词恒 true', from: 'return hasVersionDir && hasCaptchaSegment', to: 'return true' },
  { file: DIA, name: 'M9a 删掉读体闸门（边界退化成纯注释）', from: GATE, to: '' },
  { file: DIA, name: 'M9b 读体闸门改成永真', from: GATE, to: 'if (false) return' },
  { file: DIA, name: 'M9c 读体闸门挪到读体调用之后', from: GATE, to: '' }
]

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex')
const abs = (rel) => path.join(root, rel)
const originals = new Map()
for (const f of new Set(MUTATIONS.map((m) => m.file))) originals.set(f, fs.readFileSync(abs(f), 'utf8'))

// ⚠️ 判定口径 = **vitest 的退出码**：
//   0 = 全绿 ⇒ 该变异没被任何用例抓住 ⇒ ESCAPED
//   1 = 有用例失败 ⇒ 变异被抓住 ⇒ CAUGHT
//   其他 = **环境问题**（命令缺失 / runner 故障）⇒ ENVIRONMENT-ERROR，
//         **不算 CAUGHT**（把「测不动」读成「抓到了」正是本仓反复出事的同型失败），
//         且单独计数、单独退出码 —— 不与 ESCAPED 混为一谈（第五轮 i4）。
// ⚠️ 不使用 `shell: true`（第五轮 i4）：Windows 上 `.cmd` 必须走 shell，
//   于是「命令不存在」与「用例失败」会撞进同一个错误通道。改为**用 node 直接跑
//   vitest 的 js 入口**（仓库根 node_modules 里，pnpm 提升后的真实位置），
//   spawn 失败与用例失败因此天然分开。
// ⚠️ 子进程 stdio 必须 'ignore'：vitest 的 worker 会**继承**父进程的 fd，
//   用 pipe 捕获不住 ⇒ 失败报告会直接灌进本 harness 的输出（第三轮 i7）。
const VITEST_JS = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')

function runTests () {
  try {
    execFileSync(process.execPath, [VITEST_JS, 'run', testRel, '--reporter=dot'], {
      cwd: path.join(root, 'apps', 'desktop'), stdio: 'ignore', timeout: 600000
    })
    return { code: 0 }
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status }
  }
}

// ── 原子备份 + finally 强制还原（第五轮 i1 / 第六轮 i4）────────────────
// 变异直接写源文件，若脚本中途崩溃（被 kill / 磁盘满 / node 异常退出），
// 源文件会**永久停在损坏状态**。两道保险：
//   ① **循环开始前**，为**每一个**将被变异的文件各落一份原始内容备份
//      （备份写在**系统临时目录**，不在源文件同目录 —— 第六轮 i4：
//       进程被 SIGKILL 时 finally 不会执行，备份留在源目录会变成工作树里的脏文件）；
//   ② 整个变异循环包在 try/finally 里，finally 从备份**逐字节还原**并删除备份文件。
// 还原后逐文件比对 md5 —— 不比对就没法说「还原了」。
const backups = new Map()
for (const f of originals.keys()) {
  const bk = path.join(os.tmpdir(), `mutation-backup-${process.pid}-${path.basename(f)}`)
  fs.writeFileSync(bk, originals.get(f), 'utf8')
  backups.set(f, bk)
}

// 变异**前**先记下测试文件的 md5（第六轮 i3：此前只算变异后的值，
// 却在评审记录里写成「before == after」⇒ 那个 before 是**没有来源的字段**）。
const testAbs = path.join(root, 'apps', 'desktop', testRel)
const testMd5Before = md5(fs.readFileSync(testAbs, 'utf8'))

// 整体时限（第六轮 i7）：单条变异 600s × 11 条最坏超过 110 分钟，
// 且**没有**整体上限 ⇒ 一个卡死的 harness 能占住整台机器。超过就停并如实标记。
const OVERALL_BUDGET_MS = 1800000
const startedAt = Date.now()

const results = []
try {
  for (const m of MUTATIONS) {
    if (Date.now() - startedAt > OVERALL_BUDGET_MS) {
      results.push({ name: m.name, state: 'SKIPPED-OVERALL-BUDGET' })
      continue
    }
    const base = originals.get(m.file)
    if (!base.includes(m.from)) { results.push({ name: m.name, state: 'ANCHOR-NOT-FOUND' }); continue }
    let mutated = base.replace(m.from, m.to)
    if (m.name.startsWith('M9c')) {
      const callIdx = mutated.indexOf("'Network.getResponseBody'")
      const lineEnd = mutated.indexOf('\n', callIdx) + 1
      mutated = mutated.slice(0, lineEnd) + '      ' + GATE + '\n' + mutated.slice(lineEnd)
    }
    fs.writeFileSync(abs(m.file), mutated, 'utf8')
    const { code } = runTests()
    const state = code === 1 ? 'CAUGHT' : (code === 0 ? 'ESCAPED' : 'ENVIRONMENT-ERROR')
    results.push({ name: m.name, state, exitCode: code })
    fs.writeFileSync(abs(m.file), base, 'utf8')
  }
} finally {
  // 无论怎么退出（含异常），都从备份还原
  for (const [f, bk] of backups) {
    try {
      if (fs.existsSync(bk)) {
        fs.writeFileSync(abs(f), fs.readFileSync(bk, 'utf8'), 'utf8')
        fs.unlinkSync(bk)
      }
    } catch (e) {
      console.error(`还原失败 ${f}：${e.message}（备份仍在 ${bk}，可手工恢复）`)
    }
  }
}

// 还原校验：每个被变异文件**分别**比对 md5
const restore = []
for (const [f, base] of originals) {
  const after = fs.readFileSync(abs(f), 'utf8')
  restore.push({ file: f, md5Before: md5(base), md5After: md5(after), equal: md5(base) === md5(after) })
}
const testMd5After = md5(fs.readFileSync(testAbs, 'utf8'))

const envErrors = results.filter((r) => r.state === 'ENVIRONMENT-ERROR')
const escaped = results.filter((r) => r.state === 'ESCAPED')
const bad = results.filter((r) => r.state !== 'CAUGHT')
console.log('----')
for (const r of results) console.log(`${r.state.padEnd(16)} ${r.name}${r.exitCode !== undefined ? '  (vitest exit=' + r.exitCode + ')' : ''}`)
console.log('----')
for (const r of restore) console.log(`restore ${r.equal ? 'MATCH' : 'MISMATCH'}  ${r.file}  ${r.md5Before}`)
console.log(`test-md5-before ${testMd5Before}  ${testRel}`)
console.log(`test-md5-after  ${testMd5After}  ${testRel}`)
console.log(`overall-elapsed ${Math.round((Date.now() - startedAt) / 1000)}s (budget ${OVERALL_BUDGET_MS / 1000}s)`)
console.log(`mutations ${results.length}  caught ${results.length - bad.length}  escaped ${escaped.length}  environment-errors ${envErrors.length}`)
if (envErrors.length) {
  console.log('⚠ 有 ENVIRONMENT-ERROR ⇒ 本次判定**不成立**：「测不动」既不等于「变异逃逸」，也不等于「抓到了」')
  for (const e of envErrors) console.log(`   ${e.name} (vitest exit=${e.exitCode})`)
}
const restored = restore.every((r) => r.equal)
console.log(bad.length === 0 && restored ? 'ALL CAUGHT' : 'NOT ALL CAUGHT')
// 退出码：0 = 全 CAUGHT 且已还原；2 = 环境问题（判定不成立）；1 = 有逃逸或未还原
process.exit(bad.length === 0 && restored ? 0 : (envErrors.length ? 2 : 1))
