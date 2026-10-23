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

// 判定口径：**vitest 的退出码**。
// - 0  = 全绿 ⇒ 该变异没被任何用例抓住 ⇒ ESCAPED
// - 1  = 有用例失败 ⇒ 变异被抓住 ⇒ CAUGHT
// - 其他 = 环境问题（命令缺失、runner 挂了…）⇒ ENVIRONMENT-ERROR，**不算 CAUGHT**
//   （把「测不动」读成「抓到了」正是本仓反复出事的同型失败）。
// ⚠️ 子进程 stdio 必须 'ignore'：vitest 的 worker 会**继承**父进程的 fd，
//   用 pipe 捕获不住 ⇒ 失败报告会直接灌进本 harness 的输出，评审第三轮 i7
//   抱怨的「原始输出重复且格式混乱」就是这么来的。
function runTests () {
  try {
    execFileSync('pnpm.cmd', ['exec', 'vitest', 'run', testRel, '--reporter=dot'], {
      cwd: path.join(root, 'apps', 'desktop'), stdio: 'ignore', shell: true, timeout: 600000
    })
    return { code: 0 }
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status }
  }
}

const results = []
for (const m of MUTATIONS) {
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

// 还原校验：每个被变异文件**分别**比对 md5
const restore = []
for (const [f, base] of originals) {
  const after = fs.readFileSync(abs(f), 'utf8')
  restore.push({ file: f, md5Before: md5(base), md5After: md5(after), equal: md5(base) === md5(after) })
}
const testAbs = path.join(root, 'apps', 'desktop', testRel)
const testMd5 = md5(fs.readFileSync(testAbs, 'utf8'))

console.log('----')
for (const r of results) console.log(`${r.state.padEnd(16)} ${r.name}${r.exitCode !== undefined ? '  (vitest exit=' + r.exitCode + ')' : ''}`)
console.log('----')
for (const r of restore) console.log(`restore ${r.equal ? 'MATCH' : 'MISMATCH'}  ${r.file}  ${r.md5Before}`)
console.log(`test-md5      ${testMd5}  ${testRel}`)
console.log(`mutations ${results.length}  caught ${results.filter((r) => r.state === 'CAUGHT').length}`)
const bad = results.filter((r) => r.state !== 'CAUGHT')
console.log(bad.length === 0 && restore.every((r) => r.equal) ? 'ALL CAUGHT' : 'NOT ALL CAUGHT')
process.exit(bad.length === 0 && restore.every((r) => r.equal) ? 0 : 1)
