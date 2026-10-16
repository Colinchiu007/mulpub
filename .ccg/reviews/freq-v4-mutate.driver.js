/* v4 变异反证驱动（照 mutate-freq-v3-b.js 的已验证语义重写；N1–N6 数值面，N7–N10 QM-6 采纳项）
 * 每条：锚点命中=1 → 落盘 → 跑目标测试 → 记录指名红 → 还原 → Buffer.equals 逐字节校验。
 * 用法：node .ccg/reviews/freq-v4-mutate.driver.js   （从仓库内任意 cwd 皆可，路径由 __dirname 推导）
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// WT 由本文件位置推导：.ccg/reviews/ 在仓库根下两级 ⇒ 不写死机器绝对路径const WT = path.resolve(__dirname, '..', '..')
const PKG = path.join(WT, 'packages/shared-utils')
const VITEST = path.join(WT, 'node_modules/vitest/vitest.mjs')
const T_POLICY = 'tests/publish-frequency-policy.test.js'
const T_GUARD = 'tests/publish-interval-guard.test.js'
const P_POLICY = 'packages/shared-utils/src/publish-frequency-policy.js'
const P_GUARD = 'packages/shared-utils/src/publish-interval-guard.js'
const LF = String.fromCharCode(10)
const T_DTS = 'src/__tests__/frequency-declaration-contract.test.js'
const P_DTS = 'packages/shared-utils/index.d.ts'

function withFileEol (text, buf) {
  const crlf = buf.toString('utf8').split('\r\n').length > 1
  return crlf ? text.split('\n').join('\r\n') : text
}
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\[[0-9;]*m', 'g')
const stripAnsi = (s) => s.replace(ANSI_RE, '')
const stripDur = (s) => s.replace(/\s+\d+(?:\.\d+)?\s(?:ms|s)$/, '').trim()

function runVitest (files) {
  const r = spawnSync(process.execPath, [VITEST, 'run', ...files], {
    cwd: PKG, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024,
    env: Object.assign({}, process.env, { FORCE_COLOR: '0', NO_COLOR: '1' }),
  })
  const out = stripAnsi((r.stdout || '') + '\n' + (r.stderr || ''))
  const red = new Set()
  const re = /FAIL\s+\S+\.test\.js > (?:[^>\n]+ > )+([^>\n]+)$/gm
  let m
  while ((m = re.exec(out)) !== null) red.add(stripDur(m[1]))
  const fm = out.match(/Tests\s+(?:(\d+) failed[^|\n]*\|)?\s*\d+ passed/)
  return { rc: r.status, red: [...red], out, ran: /Test Files\s/.test(out),
    failedCount: fm ? Number(fm[1] || 0) : null }
}

const LONG = '[TIER_LONG]: Object.freeze({ accountMinMs: 5 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 200 })'
const CLIP = '[TIER_CLIP]: Object.freeze({ accountMinMs: 3 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 350 })'
const SHORT = '[TIER_SHORT]: Object.freeze({ accountMinMs: 1 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 500 })'

const MUTS = [
  { id: 'N1', files: [T_POLICY, T_GUARD],
    why: 'long 档平台间隔退回 3′（v4 明令三档统一 1′）',
    edits: [[P_POLICY, LONG, LONG.replace('platformMinMs: 1 * MIN', 'platformMinMs: 3 * MIN')]],
    expectRed: ['三组代表平台逐档精确等于策略表', 'v4：平台间隔三档统一 1′', '_intervals 必须回传 tier'] },
  { id: 'N2', files: [T_POLICY],
    why: 'clip 档日配额退回 v3 的 50',
    edits: [[P_POLICY, CLIP, CLIP.replace('accountDailyMax: 350', 'accountDailyMax: 50')]],
    expectRed: ['三组代表平台逐档精确等于策略表', '日配额钉成数据表', '合法值覆盖所有平台的两档', '非整数/负数回落并出声'] },
  { id: 'N3', files: [T_POLICY],
    why: 'short 档日配额压到与 long 同值（档间单调被抹平）',
    edits: [[P_POLICY, SHORT, SHORT.replace('accountDailyMax: 500', 'accountDailyMax: 200')]],
    expectRed: ['三组代表平台逐档精确等于策略表', '档间单调：长文最慢', '日配额钉成数据表'] },
  { id: 'N4', files: [T_POLICY],
    why: '回落基线配额写得比任何已登记平台都宽（独立常量最常犯的错）',
    edits: [[P_POLICY, '  accountDailyMax: 200,\n})', '  accountDailyMax: 600,\n})']],
    expectRed: ['回落基线不得弱于任何已登记平台', '日配额钉成数据表'] },
  { id: 'N5', files: [T_GUARD],
    why: '回滚许可退回 max(2, dailyMax)（v3 立的硬顶被拆）',
    edits: [[P_GUARD, 'return Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)', 'return Math.max(2, accountDailyMax)']],
    expectRed: ['v4：三档真实日配额下回滚许可仍恒等于封顶'] },
  { id: 'N6', files: [T_POLICY],
    why: '整条删掉平台桶（三档平台间隔归 0）—— 用户问过的那个方案',
    edits: [[P_POLICY, LONG, LONG.replace('platformMinMs: 1 * MIN', 'platformMinMs: 0')],
      [P_POLICY, CLIP, CLIP.replace('platformMinMs: 1 * MIN', 'platformMinMs: 0')],
      [P_POLICY, SHORT, SHORT.replace('platformMinMs: 1 * MIN', 'platformMinMs: 0')]],
    expectRed: ['v4：平台间隔三档统一 1′', '三组代表平台逐档精确等于策略表'] },
  { id: 'N7', files: [T_GUARD],
    why: '拆掉回滚许可的地板 max(2, …)（QM-6 后端轴 C2：v4 数值下该分支永不生效，无人测过）',
    edits: [[P_GUARD, 'return Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)', 'return Math.min(accountDailyMax, MAX_ROLLBACK_PER_DAY)']],
    expectRed: ['回滚许可的**地板** 2 必须被真实测到'] },
  { id: 'N8', files: [T_POLICY],
    why: '摘掉模块加载时的基线自检调用（判据函数仍有测试，但运行期守护消失）',
    edits: [[P_POLICY, LF + 'checkBaselineStrength()' + LF, LF + 'checkBaselineStrength /** 反证 N8：加载调用被摘掉 */' + LF]],
    expectRed: ['回落基线强度运行期自检'] },
  { id: 'N9a', files: [T_POLICY],
    why: '归属错档：zhihu 由 long 挪到 clip（标签变了、档位数值没变）—— 只有归属锁该红；逐平台数值交叉锁不该红（zhihu 仍等于它自己档位的代表平台），第一版把它写进期望是错的',
    edits: [[P_POLICY, '  zhihu: TIER_LONG,', '  zhihu: TIER_CLIP,']],
    expectRed: ['平台 → 档位归属逐平台钉住'] },
  { id: 'N9b', files: [T_POLICY],
    why: '派生表被局部篡改：构建时给 zhihu 换成 clip 的预设但 tier 标签仍写 long —— 这才测「某平台与自身档位数值不一致」（归属锁该保持绿）',
    edits: [[P_POLICY,
      '      Object.freeze({ tier, ...TIER_PRESETS[tier] }),',
      '      Object.freeze({ tier, ...(platform === \'zhihu\' ? TIER_PRESETS[TIER_CLIP] : TIER_PRESETS[tier]) }),']],
    expectRed: ['逐平台数值必须等于其档位代表平台的数值'] },
  { id: 'N10', files: [T_DTS],
    why: '新增导出忘记在 index.d.ts 声明（枚举式声明契约锁必须有牙）',
    edits: [[P_DTS, 'checkBaselineStrength(options?: {', 'checkBaselineStrengthX(options?: {']],
    expectRed: ['策略模块的每一个公开导出都必须在 d.ts 里声明'] },
]

const touched = [...new Set(MUTS.flatMap((m) => m.edits.map((e) => e[0])))]
const pristineAll = new Map(touched.map((rel) => [rel, fs.readFileSync(path.join(WT, rel))]))

{
  const p = runVitest([T_POLICY, T_GUARD])
  console.log(`PRISTINE rc=${p.rc} failedCount=${p.failedCount} red=${p.red.length} ran=${p.ran}`)
  if (!p.ran || p.rc !== 0 || p.failedCount !== 0) {
    console.log('PRISTINE_NOT_GREEN ⇒ 终止（不改判据）'); console.log(p.out.slice(-1200))
    for (const [rel, buf] of pristineAll) fs.writeFileSync(path.join(WT, rel), buf)
    process.exit(3)
  }
}

const results = []
for (const mut of MUTS) {
  const rels = [...new Set(mut.edits.map((e) => e[0]))]
  const snap = new Map(rels.map((rel) => [rel, pristineAll.get(rel)]))
  let info
  try {
    for (const [rel, from0, to0] of mut.edits) {
      const src = snap.get(rel).toString('utf8')
      const from = withFileEol(from0, snap.get(rel))
      const to = withFileEol(to0, snap.get(rel))
      const hits = src.split(from).length - 1
      if (hits !== 1) throw new Error(`锚点命中 ${hits}（需 1）：${rel} :: ${from.slice(0, 40)}`)
      fs.writeFileSync(path.join(WT, rel), Buffer.from(src.replace(from, to), 'utf8'))
    }
    info = runVitest(mut.files)
    for (const [rel, buf] of snap) fs.writeFileSync(path.join(WT, rel), buf)
    for (const [rel, buf] of snap) {
      if (!fs.readFileSync(path.join(WT, rel)).equals(buf)) throw new Error(`还原后字节不同：${rel}`)
    }
  } catch (e) {
    for (const [rel, buf] of snap) fs.writeFileSync(path.join(WT, rel), buf)
    console.log(`${mut.id} DRIVER_ERROR ${e.message}`)
    results.push({ id: mut.id, verdict: 'DRIVER_ERROR' })
    continue
  }
  const blind = info.red.length === 0 && (info.failedCount === null ? info.rc !== 0 : info.failedCount > 0)
  const missed = mut.expectRed.filter((n) => !info.red.some((r) => r.includes(n)))
  const verdict = blind ? 'PROBE_BLIND' : (missed.length === 0 ? 'CAUGHT' : 'MISSED')
  console.log(`${mut.id} ${verdict} rc=${info.rc} failedCount=${info.failedCount} red=${info.red.length} :: ${mut.why}`)
  console.log(`   红集: ${info.red.join(' | ') || '(none)'}`)
  if (missed.length) console.log(`   未点名: ${missed.join(' , ')}`)
  results.push({ id: mut.id, verdict, red: info.red })
}

let drift = []
for (const [rel, buf] of pristineAll) {
  if (!fs.readFileSync(path.join(WT, rel)).equals(buf)) drift.push(rel)
}
console.log('FINAL_RESTORE_MATCH=' + (drift.length === 0) + (drift.length ? ' drift=' + JSON.stringify(drift) : ''))
console.log('MUTS=' + MUTS.length + ' VERDICT=' + (results.every((r) => r.verdict === 'CAUGHT') && drift.length === 0 ? 'ALL_CAUGHT' : 'NOT_ALL_CAUGHT'))
process.exit(results.every((r) => r.verdict === 'CAUGHT') && drift.length === 0 ? 0 : 1)
