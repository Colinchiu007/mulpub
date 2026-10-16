// p9a.cjs —— v5 变异反证驱动（8 道）。每道：备份 → 注入被禁形态 → 跑指定测试 → 记录红集 → 还原 → md5 逐字节校验。
// 反证必须取"规则明文禁止的那个形态"本身，且每道都必须指名它声称抓住的那条锁。
const fs = require('node:fs')
const cp = require('node:child_process')
const W = 'D:/Data/projects/mp-worktrees/mp-publish-frequency-per-platform-intervals/'
const POL = W + 'packages/shared-utils/src/publish-frequency-policy.js'
const VUE = W + 'apps/desktop/src/components/PublishFrequencySettings.vue'
const IPC = W + 'apps/desktop/electron/ipc-handlers/publish-frequency.js'
const ACC = 'tests/publish-frequency-account-interval.test.js'
const SET = 'src/components/PublishFrequencySettings.test.js'
const PUB = 'electron/ipc-handlers/publish.test.js'

function read (f) { return fs.readFileSync(f, 'utf8') }
function md5 (s) { return cp.execFileSync('node', ['-e', 'process.stdout.write(require("crypto").createHash("md5").update(require("fs").readFileSync(process.argv[1],"utf8")).digest("hex"))', f_arg], { encoding: 'utf8' }) }
let f_arg = ''
function hash (f) {
  return cp.execFileSync('node', ['-e', 'const c=require("crypto"),fs=require("fs");process.stdout.write(c.createHash("md5").update(fs.readFileSync(process.argv[1])).digest("hex"))', f], { encoding: 'utf8' })
}
function subOnce (text, from, to, label) {
  const parts = text.split(from)
  if (parts.length !== 2) throw new Error(label + ' 锚点命中 ' + (parts.length - 1) + ' 次（期望 1）')
  return parts.join(to)
}
function runTests (cwd, file, labelRe) {
  let out = ''
  try {
    // 必须走 execSync（cmd.exe）：execFileSync('npx.cmd') 在本机 Node 24 上会 EINVAL / 静默不跑，
    // 而"驱动没跑成"读起来完全像"变异没被抓到"。
    out = cp.execSync('npx vitest run ' + file, { cwd: W + cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
  }
  const m = out.match(/Failed Tests (\d+)/)
  const count = m ? Number(m[1]) : -1
  const failLines = (out.match(/FAIL[^\n]*/g) || [])
  const named = failLines.filter((l) => l.indexOf(labelRe) >= 0).length
  const anyFailLine = failLines.length
  if (count === -1 && anyFailLine === 0) {
    // 失明必须出声并留现场：否则"驱动没跑成"会被读成"变异没被抓到"
    console.log('[p9a] PROBE_BLIND raw 前 600 字 ↓\n' + out.slice(0, 600).replace(/\u001b\[[0-9;]*m/g, ''))
  }
  return { count, named, anyFailLine, blind: count === -1 && anyFailLine === 0 }
}

const MUTS = [
  { id: 'M1', why: '优先级翻转：env 平台专属盖掉设置页全局覆盖（被禁形态＝链序本身）',
    file: POL, from: 'const globalRaw = pick(ov.accountMinMs, envPlatform, env[ENV_ACCOUNT_MIN_INTERVAL])',
    to: 'const globalRaw = pick(envPlatform, ov.accountMinMs, env[ENV_ACCOUNT_MIN_INTERVAL])',
    cwd: 'packages/shared-utils', test: ACC, name: '优先级：平台专属覆盖' },
  { id: 'M2', why: 'env 一半生效：值非法时只跳过该键（被禁形态＝continue）',
    file: POL, from: "      warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 的 ' + platform + '=' + JSON.stringify(value) + ' 非法（需 >=0 的有限数），整条作废、全部平台回落默认表')\n      return null",
    to: "      warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 的 ' + platform + ' 非法，已忽略该键')\n      continue",
    cwd: 'packages/shared-utils', test: ACC, name: 'env JSON：值非法整条作废' },
  { id: 'M3', why: '兜底绕过覆盖链：未登记平台直接返回基线常量',
    file: POL, from: '  const tableDefault = known ? PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform] : BASELINE_INTERVALS.accountMinMs',
    to: '  const tableDefault = known ? PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform] : BASELINE_INTERVALS.accountMinMs\n  if (!known && !ov.accountMinMs) return BASELINE_INTERVALS.accountMinMs',
    cwd: 'packages/shared-utils', test: ACC, name: '未登记平台：账号档落基线值' },
  { id: 'M4', why: '两个解析函数互相调用（未知平台那一支问上层要基线）',
    file: POL, from: '  const tableDefault = known ? PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform] : BASELINE_INTERVALS.accountMinMs',
    to: '  const tableDefault = known ? PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform]\n    : resolveIntervals(platform, { env, warn, overrides: ov }).accountMinMs',
    cwd: 'packages/shared-utils', test: ACC, name: '两个解析函数不得互相调用' },
  { id: 'M5', why: '派生表不采用逐平台账号档（同一量在两张表里各有一份）',
    file: POL, from: '      Object.freeze({ tier, ...TIER_PRESETS[tier], accountMinMs: PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform] }),',
    to: '      Object.freeze({ tier, ...TIER_PRESETS[tier] }),',
    cwd: 'packages/shared-utils', test: ACC, name: '派生表与逐平台表必须是同一个账号档' },
  { id: 'M6', why: '渲染层提交空 map（"清空覆盖"被写成"覆盖成空"）',
    file: VUE, from: '  if (Object.keys(byPlatform).length > 0) policy.accountMinMsByPlatform = byPlatform',
    to: '  policy.accountMinMsByPlatform = byPlatform',
    cwd: 'apps/desktop', test: SET, name: '全部留空 ⇒ 不产生 accountMinMsByPlatform 键' },
  { id: 'M7', why: '渲染层自带第二份平台数字',
    file: VUE, from: 'const platformKeys = computed(',
    to: 'const FALLBACK_ACCOUNT_MS = { tencent_video: 60 * 60000 }\nconst platformKeys = computed(',
    cwd: 'apps/desktop', test: SET, name: '载荷缺 accountMinDefaults 时显示占位' },
  { id: 'M8', why: 'IPC 不下发逐平台默认表（界面只能猜）',
    file: IPC, from: '          accountMinDefaults: policyModule.PLATFORM_ACCOUNT_MIN_INTERVAL_MS,',
    to: '',
    cwd: 'apps/desktop', test: PUB, name: 'getPolicy 必须把' },
]

const results = []
for (const m of MUTS) {
  const before = hash(m.file)
  const src = read(m.file)
  let mutated
  try { mutated = subOnce(src, m.from.replace(/\n/g, /\r?\n/.test(src) ? '\r\n' : '\n'), m.to.replace(/\n/g, /\r?\n/.test(src) ? '\r\n' : '\n'), m.id) } catch (e) {
    results.push({ id: m.id, status: 'ANCHOR_NOT_FOUND', note: e.message }); continue
  }
  fs.writeFileSync(m.file, mutated, 'utf8')
  const r = runTests(m.cwd, m.test, m.name)
  fs.writeFileSync(m.file, src, 'utf8')
  const after = hash(m.file)
  results.push({
    id: m.id,
    status: r.blind ? 'PROBE_BLIND' : (r.named > 0 ? 'CAUGHT' : (r.count > 0 ? 'RED_BUT_NOT_NAMED' : 'MISSED')),
    failedTotal: r.count, namedRed: r.named, restored: before === after, why: m.why,
  })
  console.log('[p9a] ' + results[results.length - 1].status + ' ' + m.id + ' ' + JSON.stringify(results[results.length - 1]))
}
console.log('[p9a] SUMMARY ' + JSON.stringify(results.map((r) => r.id + '=' + r.status + (r.restored === false ? '/RESTORE_FAIL' : ''))))
process.exit(results.every((r) => r.status === 'CAUGHT' && r.restored !== false) ? 0 : 1)
