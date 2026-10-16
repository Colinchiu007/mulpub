/**
 * freq-unwired-mutate.driver.js — change: publish-frequency-unwired-surfaces 的变异反证驱动
 *
 * 为什么入库而不是会话草稿：反证必须**可复跑**，否则下一个会话只能采信我这次的转述
 * （先例 `.ccg/reviews/freq-v3-mutate.driver.js` / `freq-v4-mutate.driver.js`）。
 *
 * 沿用 v3/v4 驱动已验证的语义（每条都对应本仓踩过的坑，别再发明一次）：
 *   ① pristine 快照与"变异后内容"**分离**：还原一律写回快照 Buffer，不复用同一个 Map
 *      （v4 就是两者合成一个 Map ⇒ "还原"写回变异态，五条改动叠加留在源码里而驱动自称成功）。
 *   ② 每条变异先验**锚点真的命中**（`String.replace` 找不到锚点时静默返回原串），
 *      不命中单独报 ANCHOR_NOT_FOUND，不得混进 MISSED。
 *   ③ 子进程 `FORCE_COLOR=0` / `NO_COLOR=1` 并剥 ANSI；`rc≠0 而 red=0` 是**探针失明**，
 *      有独立的 PROBE_BLIND 档（把失明读成"变异没被抓到"是 v4 实犯过的错）。
 *   ④ 红集必须**点名**到预期用例 ⇒ WRONG_CAUSE 与 MISSED 分档。
 *   ⑤ 收尾逐文件 `Buffer.equals` 自证还原；异常路径也先还原。
 *   ⑥ 不用 `pnpm`/`.bin/vitest.cmd`：Node ≥18.20 在非 shell 模式下拒绝 .cmd，会把"根本没跑"
 *      读成"锁没抓到"。这里直接用 `node node_modules/vitest/vitest.mjs`。
 *
 * 用法：node .ccg/reviews/freq-unwired-mutate.driver.js
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const WT = path.resolve(__dirname, '..', '..')
const VITEST = path.join(WT, 'node_modules', 'vitest', 'vitest.mjs')
const SU = 'packages/shared-utils'
const AD = 'apps/desktop'

const MUTS = [
  {
    id: 'U1', desc: 'env 日配额解析摘掉上界（退回"无上界"）',
    file: SU + '/src/publish-frequency-policy.js',
    from: '{ integer: true, max: MAX_DAILY_QUOTA }', to: '{ integer: true }',
    cwd: SU, args: ['run', 'tests/publish-frequency-policy.test.js'],
    expect: ['env 超上界'],
  },
  {
    id: 'U2', desc: '设置页全局日配额覆盖的上界退回 undefined',
    file: SU + '/src/publish-frequency-policy.js',
    from: "['accountDailyMax', 0, MAX_DAILY_QUOTA],", to: "['accountDailyMax', 0, undefined],",
    cwd: SU, args: ['run', 'tests/publish-frequency-policy.test.js'],
    expect: ['设置页覆盖的两条日配额路径共用同一上界'],
  },
  {
    id: 'U3', desc: '设置页分档 dailyMax[tier] 的上界条件摘掉（与 U2 同用例，两条各测一个入口）',
    file: SU + '/src/publish-frequency-policy.js',
    from: 'if (!Number.isInteger(n) || n < 0 || n > MAX_DAILY_QUOTA) {',
    to: 'if (!Number.isInteger(n) || n < 0) {',
    cwd: SU, args: ['run', 'tests/publish-frequency-policy.test.js'],
    expect: ['设置页覆盖的两条日配额路径共用同一上界'],
  },
  {
    id: 'U4', desc: '把死常量 PLATFORM_BUCKET_DAILY_KEY_PREFIX 的导出加回来',
    file: SU + '/src/publish-interval-guard.js',
    from: 'module.exports.PLATFORM_BUCKET_ACCOUNT_ID = PLATFORM_BUCKET_ACCOUNT_ID',
    to: "module.exports.PLATFORM_BUCKET_ACCOUNT_ID = PLATFORM_BUCKET_ACCOUNT_ID\nmodule.exports.PLATFORM_BUCKET_DAILY_KEY_PREFIX = 'platform-daily'",
    cwd: SU, args: ['run', 'tests/publish-interval-guard.test.js'],
    expect: ['守卫导出里不存在 PLATFORM_BUCKET_DAILY_KEY_PREFIX'],
  },
  {
    id: 'U5', desc: '把 clearRollbackDisabled 加回来（可悄悄重新允许回滚的接口复活）',
    file: SU + '/src/task-queue-frequency.js',
    from: 'module.exports = {  /**',
    to: "module.exports = {\n  clearRollbackDisabled (platform) { if (platform === undefined) this._rollbackDisabledPlatforms.clear(); else this._rollbackDisabledPlatforms.delete(platform) },\n  /**",
    cwd: SU, args: ['run', 'tests/task-queue-guard-integration.test.js'],
    expect: ['【探针 I4】'],
  },
  {
    id: 'U6', desc: '告警文案退回假承诺「重启或用户在设置页确认后解除」',
    file: SU + '/src/task-queue-frequency.js',
    from: "      + '重启进程后自动解除（本进程内不可撤销 —— 设置页没有该入口，也不提供手动解除）'",
    to: "      + '重启或用户在设置页确认后解除'",
    cwd: SU, args: ['run', 'tests/task-queue-guard-integration.test.js'],
    expect: ['【探针 I4】'],
  },
  {
    id: 'U7', desc: '裁剪改成一条不带 owner_subject 的 DELETE（跨 owner 一把删）',
    file: AD + '/electron/services/store/publish-daily-store.js',
    // ⚠️ 不用跨行 needle：本仓工作副本是 `i/lf w/crlf`，跨行锚点在 CRLF 文件上永不命中
    // （第一版就是这样，报的是 ANCHOR_NOT_FOUND 而不是"锁没抓到"）。逐行各改各的。
    pairs: [
      ["      'DELETE FROM publish_daily_count WHERE owner_subject = ? AND day_key < ?'",
        "      'DELETE FROM publish_daily_count WHERE day_key < ?'"],
      ['    ).run(owner, cutoff)', '    ).run(cutoff)'],
    ],
    cwd: AD, args: ['run', 'electron/services/store-owner-isolation.test.js'],
    expect: ['每条 DELETE 都必须带 owner_subject 谓词'],
  },
  {
    id: 'U8', desc: '日键校验退回"只看形状"（2026-13-40 会滚到 2027-02 ⇒ 整表被删）',
    file: AD + '/electron/services/store/publish-daily-store.js',
    // 反证必须取**被禁形态本身**：只改 round-trip 那一行时，月份/日期区间校验仍然挡着
    // 2026-13-40 ⇒ 变异没有真的退化成"只看形状"，MISSED 是变异写错了而不是锁失灵的（第一版即如此）。
    pairs: [
      ['  if (m < 1 || m > 12 || d < 1 || d > 31) return false', '  if (false) return false'],
      ['  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d',
        '  return true'],
    ],
    cwd: AD, args: ['run', 'electron/services/store-owner-isolation.test.js'],
    expect: ['形状对但日历不存在的日期必须拒绝'],
  },
  {
    id: 'U9', desc: '启动期裁剪调用摘掉（cleanup 又变成没有生产调用点的死代码）',
    file: AD + '/electron/bootstrap/phase1-context.js',
    from: '      const r = store.prunePublishDailyCountAllOwners(guardForRetention.today())',
    to: "      const r = { owners: 0, removed: 0, basis: 'measured' }",
    cwd: AD, args: ['run', 'electron/bootstrap/phase1-context.test.js'],
    expect: ['启动期裁剪日计数表'],
  },
  {
    id: 'U10', desc: 'IPC 下发的上界改成硬编码 999',
    file: AD + '/electron/ipc-handlers/publish-frequency.js',
    from: 'dailyMaxUpperBound: policyModule.MAX_DAILY_QUOTA,', to: 'dailyMaxUpperBound: 999,',
    cwd: AD, args: ['run', 'electron/ipc-handlers/publish.test.js'],
    expect: ['一并下发'],
  },
  {
    id: 'U11', desc: '设置页 :max 退回硬编码 999（渲染层再抄一份数字）',
    file: AD + '/src/components/PublishFrequencySettings.vue',
    from: ':max="bounds.dailyMax"', to: ':max="999"', all: true,
    cwd: AD, args: ['run', 'src/components/PublishFrequencySettings.test.js'],
    expect: ['合法域上界必须来自 IPC 下发'],
  },
]

const ANSI = /\u001b\[[0-9;]*m/g
function strip (s) { return String(s).replace(ANSI, '') }

function runVitest (cwd, args) {
  let out = ''
  let rc = 0
  try {
    out = execFileSync(process.execPath, [VITEST, ...args], {
      cwd: path.join(WT, cwd),
      encoding: 'utf8',
      maxBuffer: 200 * 1024 * 1024,
      env: Object.assign({}, process.env, { FORCE_COLOR: '0', NO_COLOR: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    rc = (e && typeof e.status === 'number') ? e.status : -1
    out = strip((e && e.stdout ? String(e.stdout) : '') + '\n' + (e && e.stderr ? String(e.stderr) : ''))
  }
  out = strip(out)
  // ⚠️ vitest **全绿时根本不打印 `N failed` 段**（输出是 `Tests  41 passed (41)`）。
  // 因此"没匹配到 failed"必须先证明"跑完了且有 passed 汇总"，才可判 0；否则就是没读到东西，
  // 不是没有失败 —— 本驱动第一版正是把全绿读成 null 而误判 CONTROL_NOT_GREEN（rc=0）。
  const failM = out.match(/Tests\s+(\d+) failed/)
  const passM = out.match(/Tests\s+(?:\d+ failed \| )*(\d+) passed/)
  const failed = failM ? Number(failM[1]) : (passM ? 0 : null)
  const completed = passM !== null
  const blind = !completed || (rc !== 0 && failed === 0 && completed)
  const names = []
  out.split('\n').forEach((l) => { if (/FAIL\b/.test(l)) names.push(l) })
  return { rc, failed, completed, blind, names, out }
}

function snapshot () {
  const map = new Map()
  for (const f of new Set(MUTS.map((m) => m.file))) {
    map.set(f, fs.readFileSync(path.join(WT, f)))
  }
  return map
}

function restoreAll (snap) {
  for (const [f, buf] of snap) fs.writeFileSync(path.join(WT, f), buf)
}

function main () {
  if (!fs.existsSync(VITEST)) { console.log('VERDICT=VITEST_MISSING ' + VITEST); process.exit(2) }
  const snap = snapshot()

  // 控制对照：未变异时目标测试文件必须全绿，否则"变异后红了"不能归因给变异。
  // 按 (cwd,args) 去重——多条变异常打在同一个文件上，重复跑只是白烧时间。
  console.log('=== PRISTINE control ===')
  const runs = []
  const seen = new Set()
  for (const m of MUTS) {
    const key = m.cwd + ' :: ' + m.args.join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    const r = runVitest(m.cwd, m.args)
    runs.push({ key, r })
    console.log(`  ${key} rc=${r.rc} failed=${r.failed}${r.blind ? ' PROBE_BLIND' : ''}`)
  }
  const blindRun = runs.find((x) => x.r.blind)
  if (blindRun) {
    restoreAll(snap)
    console.log('VERDICT=CONTROL_BLIND 基线跑就没读到失败数：' + blindRun.key)
    process.exit(3)
  }
  const notGreen = runs.filter((x) => x.r.failed !== 0)
  if (notGreen.length) {
    restoreAll(snap)
    console.log('VERDICT=CONTROL_NOT_GREEN ' + JSON.stringify(notGreen.map((x) => x.key + '=' + x.r.failed)))
    process.exit(3)
  }
  console.log('CONTROL_GREEN files=' + runs.length)

  const verdicts = []
  for (const m of MUTS) {
    const p = path.join(WT, m.file)
    const original = snap.get(m.file).toString('utf8')
    const pairs = m.pairs || [[m.from, m.to]]
    const missing = pairs.filter(([from]) => !original.includes(from))
    if (missing.length) {
      verdicts.push([m.id, 'ANCHOR_NOT_FOUND'])
      console.log(`${m.id} ANCHOR_NOT_FOUND（${missing.length} 个锚点不在源码里，多半是跨行/CRLF 锚点）:: ${missing.map((x) => JSON.stringify(String(x[0]).slice(0, 40)))}`)
      continue
    }
    let mutated = original
    for (const [from, to] of pairs) {
      mutated = m.all ? mutated.split(from).join(to) : mutated.replace(from, to)
    }
    if (mutated === original) {
      verdicts.push([m.id, 'NO_OP_REPLACEMENT'])
      console.log(`${m.id} NO_OP_REPLACEMENT :: ${m.desc}`)
      continue
    }
    try {
      fs.writeFileSync(p, mutated, 'utf8')
      const r = runVitest(m.cwd, m.args)
      let verdict
      if (r.blind) verdict = 'PROBE_BLIND'
      else if (r.failed === null) verdict = 'PARSE_FAIL'
      else if (r.failed === 0) verdict = 'MISSED'
      else {
        const hit = m.expect.every((e) => r.names.some((n) => n.includes(e)))
        verdict = hit ? 'CAUGHT' : 'WRONG_CAUSE'
        if (!hit) console.log(`  ${m.id} 红集不含预期用例；FAIL 行=${JSON.stringify(r.names.slice(0, 4))}`)
      }
      verdicts.push([m.id, verdict])
      console.log(`${m.id} ${verdict} failed=${r.failed} rc=${r.rc} :: ${m.desc}`)
    } finally {
      fs.writeFileSync(p, snap.get(m.file))
    }
  }

  let restoreMatch = true
  for (const [f, buf] of snap) {
    if (!fs.readFileSync(path.join(WT, f)).equals(buf)) { restoreMatch = false; console.log('RESTORE_MISMATCH ' + f) }
  }
  const counts = {}
  verdicts.forEach(([, v]) => { counts[v] = (counts[v] || 0) + 1 })
  console.log('MUTS=' + MUTS.length + ' VERDICTS=' + JSON.stringify(counts) +
    ' FINAL_RESTORE_MATCH=' + restoreMatch)
  const bad = verdicts.filter(([, v]) => v !== 'CAUGHT')
  process.exit(restoreMatch && bad.length === 0 ? 0 : 1)
}

main()
