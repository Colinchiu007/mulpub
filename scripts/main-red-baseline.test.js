'use strict'
/**
 * scripts/main-red-baseline.test.js — 「主干基线化」判据的回归锁
 *
 * 被测对象：`lib/main-red.js` 的纯函数 `pickBaseline({ chain, rowsAt, maxStale })`。
 * 它在一条**已经取好的**提交链上，找出「主干最后一次完整跑完的那一版」。
 *
 * 为什么要有这个判据（现场，2026-10-21~22）：
 *   闸门原先读 `origin/main` 的**当前 tip**，而主干每 15–30 分钟被推进一次、整条
 *   quality-gate 要 44 分钟 ⇒「全部检查已完成」这个窗口期望时长为负 ⇒ 闸门常态落 rc=3。
 *   实测一份 24 项全绿、mergeable=MERGEABLE 的 PR 被卡约 8 小时。
 *   改成「回看最后一次完整结论」后，tip 上有检查在跑不再是否决条件。
 *
 * 三条不可让的口径：
 *  1. **先判 fail 再判 pending**（顺序承重）：若先判 pending，「中间某提交真红、更新的提交
 *     还在跑」会被跳过 ⇒ 把红读成绿。有变异反证的对应条目（见 tasks 1.1.7）。
 *  2. **零 run 的提交必须跳过**（不得读成绿）：「没有 run」≠「全部通过」。
 *     2026-10-22 真机实测 `85dc44ddc` 就是这一形态（`event != workflow_run` 的 run 数为 0）。
 *  3. **找不到绿基线一律 fail-closed**：`too-stale` / `unknown` 都不得判绿。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { pickBaseline } = require('./lib/main-red')

// ─── 构造器：把「某 sha 上的检查行」写成最省事的形式 ──────────────────────
const passRow = (name) => ({ name, status: 'completed', conclusion: 'success' })
const failRow = (name) => ({ name, status: 'completed', conclusion: 'failure' })
const pendingRow = (name) => ({ name, status: 'in_progress', conclusion: null })

/** chain 从新到旧；rowsAt 是 sha → 行数组的映射；未列出的 sha 视为「零 run」 */
function makeInput (chain, rowsByIndex, maxStale = 3) {
  const rowsAt = (sha) => {
    const i = chain.indexOf(sha)
    return i >= 0 && rowsByIndex[i] != null ? rowsByIndex[i] : []
  }
  return { chain, rowsAt, maxStale }
}

// ─── 1. 基准形态 ────────────────────────────────────────────────────────
test('tip 全绿 ⇒ green，staleness=0', () => {
  const chain = ['A', 'B', 'C']
  const r = pickBaseline(makeInput(chain, [
    [passRow('QG Static'), passRow('electron-tests')],
    [passRow('QG Static')],
    [passRow('QG Static')],
  ]))
  assert.equal(r.kind, 'green')
  assert.equal(r.sha, 'A')
  assert.equal(r.staleness, 0)
})

test('tip 有 pending、上一提交全绿 ⇒ green，staleness=1（本判据存在的理由）', () => {
  const chain = ['A', 'B', 'C']
  const r = pickBaseline(makeInput(chain, [
    [pendingRow('QG Coverage'), passRow('electron-tests')],
    [passRow('QG Coverage'), passRow('electron-tests')],
    [],
  ]))
  assert.equal(r.kind, 'green')
  assert.equal(r.sha, 'B', '必须回看到 B，而不是停在 tip A')
  assert.equal(r.staleness, 1)
})

// ─── 2. 顺序承重：先判 fail ─────────────────────────────────────────────
test('tip 有 pending、但回溯链中间某提交有 fail ⇒ red，且点名那一版（不得被更前的绿盖过）', () => {
  const chain = ['A', 'B', 'C', 'D']
  const r = pickBaseline(makeInput(chain, [
    [pendingRow('QG Coverage')],            // A: tip 在跑
    [failRow('electron-tests')],            // B: 真红 ← 必须先于「再往前找绿」被发现
    [passRow('electron-tests')],            // C: 绿
    [passRow('electron-tests')],            // D: 绿
  ]))
  assert.equal(r.kind, 'red', '中间的真红绝不能被「更旧的绿基线」掩盖')
  assert.equal(r.sha, 'B')
  assert.equal(r.staleness, 1)
})

test('tip 自身有 fail ⇒ red，staleness=0（与今天行为一致）', () => {
  const chain = ['A', 'B']
  const r = pickBaseline(makeInput(chain, [
    [failRow('electron-tests')],
    [passRow('electron-tests')],
  ]))
  assert.equal(r.kind, 'red')
  assert.equal(r.sha, 'A')
  assert.equal(r.staleness, 0)
})

// ─── 3. 零 run 的提交必须跳过（1.1.8 / 1.1.9） ───────────────────────────
test('零 run 的提交不得被读成绿基线，必须继续往回找（真机形态：85dc44ddc）', () => {
  const chain = ['A', 'B', 'C']
  const r = pickBaseline(makeInput(chain, [
    [pendingRow('QG Coverage')],   // A: tip 在跑
    [],                            // B: 零 run ← 若当成「全绿」就会假绿
    [passRow('electron-tests')],   // C: 真绿
  ]))
  assert.equal(r.kind, 'green')
  assert.equal(r.sha, 'C', '必须跳过零 run 的 B，落到 C')
  assert.equal(r.staleness, 2)
})

test('回溯窗口内全是零 run ⇒ unknown（不得读成绿）', () => {
  const chain = ['A', 'B', 'C']
  const r = pickBaseline(makeInput(chain, [[], [], []]))
  assert.equal(r.kind, 'unknown')
})

// ─── 4. fail-closed 的其余形态 ──────────────────────────────────────────
test('全程 pending ⇒ unknown（不得读成绿）', () => {
  const chain = ['A', 'B', 'C']
  const r = pickBaseline(makeInput(chain, [
    [pendingRow('QG Coverage')],
    [pendingRow('QG Coverage')],
    [pendingRow('QG Coverage')],
  ]))
  assert.equal(r.kind, 'unknown')
})

test('绿基线落后超过 maxStale ⇒ too-stale（不认旧账）', () => {
  const chain = ['A', 'B', 'C', 'D', 'E']
  const r = pickBaseline(makeInput(chain, [
    [pendingRow('QG Coverage')],   // A
    [pendingRow('QG Coverage')],   // B
    [pendingRow('QG Coverage')],   // C
    [pendingRow('QG Coverage')],   // D
    [passRow('electron-tests')],   // E: 绿，但 staleness=4 > maxStale=3
  ], 3))
  assert.equal(r.kind, 'too-stale')
  assert.equal(r.sha, 'E')
  assert.equal(r.staleness, 4)
})

test('maxStale=0 ⇒ 等价于今天的「只看 tip」行为（回到旧语义的旋钮）', () => {
  const chain = ['A', 'B']
  const r = pickBaseline(makeInput(chain, [
    [pendingRow('QG Coverage')],
    [passRow('electron-tests')],
  ], 0))
  assert.equal(r.kind, 'too-stale', 'staleness=1 > maxStale=0 ⇒ 不认')
  assert.equal(r.sha, 'B')
})

// ─── 5. 取数异常必须抛（由上层收敛到 rc=4，不得静默当绿） ─────────────────
test('rowsAt 抛错 ⇒ 异常向上抛（上层据此判 rc=4，不得吞成「没有红」）', () => {
  const chain = ['A', 'B']
  assert.throws(
    () => pickBaseline({ chain, rowsAt: () => { throw new Error('gh rc=1') }, maxStale: 3 }),
    /gh rc=1/
  )
})

test('空链 ⇒ unknown（不得抛，也不得当绿）', () => {
  const r = pickBaseline({ chain: [], rowsAt: () => [], maxStale: 3 })
  assert.equal(r.kind, 'unknown')
})

// ─── 7. 接线锁（CCG i1）：main() 必须真的消费 baseline.rows ─────────────
// 为什么需要这几条：本文件第 1–6 节测的是**纯函数** pickBaseline；而
// `check-main-red.test.js` 里的历史夹具被 `run2` 包装成 `kind:'green', staleness:0`，
// 于是「main() 到底有没有把 baseline.rows 用起来」在那一侧不可见——
// 若 main() 误用 `mainRowsAt(tip)`，那批用例仍会全绿（它们的主干行恰好就是 tip 的行）。
// 这三条用**非绿基线**把接线钉住：基线说有红就必须 rc=2，说不知道就必须 rc=3。

const { run } = require('./check-main-red')

function baseMock (baseline, prRows) {
  return {
    repo: 'o/r',
    mainSha: () => 'tips',
    prHeadSha: () => 'p1',
    // 故意让 tip 的行「全绿」：若 main() 绕过 baseline 去读 tip，下面两条会给出 0 而不是 2/3
    mainRowsAt: () => [passRow('A')],
    checksAt: () => prRows,
    mainBaseline: () => baseline,
  }
}

test('接线锁：baseline=red（主干有 fail）⇒ main() 必须判 rc=2，不得因为它去读 tip 的全绿而放行', async () => {
  const code = await run(['--pr', '7', '--retry-seconds', '0'], baseMock(
    { kind: 'red', sha: 'baselineSha', staleness: 1, rows: [failRow('electron-tests')] },
    [passRow('A')]
  ))
  assert.strictEqual(code, 2, 'baseline 报红就必须 rc=2；实到 ' + code + '（说明 main() 没消费 baseline.rows）')
})

test('接线锁：baseline=unknown（主干侧全 pending）⇒ main() 必须判 rc=3，不得读成绿', async () => {
  const code = await run(['--pr', '7', '--retry-seconds', '0'], baseMock(
    { kind: 'unknown', sha: 'tips', staleness: 0, rows: [pendingRow('QG Coverage')] },
    [passRow('A')]
  ))
  assert.strictEqual(code, 3, 'baseline 报未知就必须 rc=3；实到 ' + code)
})

test('接线锁：main() 必须把 tip 传给 mainBaseline（否则回溯起点不对）', async () => {
  let gotTip = null
  const m = baseMock({ kind: 'green', sha: 'tips', staleness: 0, rows: [passRow('A')] }, [passRow('A')])
  m.mainBaseline = (opts) => {
    gotTip = opts && opts.tip
    return { kind: 'green', sha: 'tips', staleness: 0, rows: [passRow('A')] }
  }
  await run(['--pr', '7', '--retry-seconds', '0'], m)
  assert.strictEqual(gotTip, 'tips', 'main() 必须把已取好的 tip 传下去（避免 mainBaseline 再 fetch 一次）')
})

test('接线锁：采集层缺 mainBaseline ⇒ rc=4 硬失败（不得静默回落到读 tip）', async () => {
  const m = baseMock({ kind: 'green', sha: 'tips', staleness: 0, rows: [passRow('A')] }, [passRow('A')])
  delete m.mainBaseline
  const code = await run(['--pr', '7', '--retry-seconds', '0'], m)
  assert.strictEqual(code, 4, '缺 mainBaseline 必须 rc=4；实到 ' + code)
})

// ─── 7b. too-stale 必须在 main() 侧拦成 rc=3（2026-10-22 真机暴露的 Critical） ───
// 现场形态：`baseline=98e94bc3b staleness=4 baseKind=too-stale` 却给了 `verdict=OK exit=0`。
// 根因：too-stale 的 rows 是**全绿**的（确实找到了绿基线，只是太旧），judge 只看 rows ⇒ 判绿
// ⇒ `maxStale` 成了装饰。它不是「绿得远」而是「基准不可用」，必须 fail-closed。
test('接线锁：baseline=too-stale ⇒ main() 必须判 rc=3，即使 rows 全绿', async () => {
  const code = await run(['--pr', '7', '--retry-seconds', '0'], baseMock(
    { kind: 'too-stale', sha: 'oldgreen', staleness: 4, rows: [passRow('A'), passRow('B')] },
    [passRow('A')]
  ))
  assert.strictEqual(code, 3, 'too-stale 必须 rc=3（fail-closed），实到 ' + code + '（说明 maxStale 是装饰）')
})

test('接线锁：baseline=too-stale 时读数为 newRed=na（未计算），不得涂成 0', async () => {
  const m = baseMock(
    { kind: 'too-stale', sha: 'oldgreen', staleness: 9, rows: [passRow('A')] },
    [passRow('A')]
  )
  const lines = []
  const orig = console.log
  console.log = (...a) => lines.push(a.map(String).join(' '))
  try {
    await run(['--pr', '7', '--retry-seconds', '0'], m)
  } finally {
    console.log = orig
  }
  const out = lines.join('\n')
  assert.match(out, /newRed=na/, 'too-stale 必须打印 newRed=na；实到：' + out)
  assert.match(out, /staleness=9/, '必须点名落后的提交数')
})


// ─── 8. 读数行：newRed 的「未计算」不得涂成 0（CCG i4） ──────────────────
const { readout } = require('./lib/main-red')

test('readout：newRedComputed=false 时必须打印 newRed=na，不得打印 0', () => {
  const s = readout(
    { verdict: 'INCOMPLETE', code: 3, counts: { prFail: 0, mainFail: 0, newRed: 0, uncertain: 0 }, newRedComputed: false },
    { mainSha: 'm', prSha: 'p' }
  )
  assert.match(s, /newRed=na/, '「未计算」必须与「零」可区分；实到：' + s)
  assert.ok(!/newRed=0/.test(s), '不得把未计算涂成 0；实到：' + s)
})

test('readout：newRedComputed 缺省（正常算出）时仍打印真实数字', () => {
  const s = readout(
    { verdict: 'OK', code: 0, counts: { prFail: 0, mainFail: 0, newRed: 0, uncertain: 0 } },
    { mainSha: 'm', prSha: 'p' }
  )
  assert.match(s, /newRed=0/, '算出来的 0 必须照常打印；实到：' + s)
})

// ─── 9. 网络重试的两条结构锁（外部评审 #2/#3/#4） ──────────────────────
// `run()` 是采集层闭包内的函数，注入不了假 gh；这两条用结构锁钉住「顺序」与「退化路径」，
// 因为两者的失败形态都是**静默变慢**（不会红、只会把确定性失败拖成慢失败 / 加速触发限流），
// 靠人读代码发现不了。
test('结构锁：确定性错误（401/403/404）必须先于瞬时错误判定 —— 否则 404 里的 "timeout" 会被重试 3 轮', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-main-red.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const iDefinite = code.indexOf('DEFINITE_RE.test(')
  const iTransient = code.indexOf('!TRANSIENT_RE.test(')
  assert.ok(iDefinite > 0, '必须存在 DEFINITE_RE 判定')
  assert.ok(iTransient > 0, '必须存在 TRANSIENT_RE 判定')
  assert.ok(iDefinite < iTransient, 'DEFINITE_RE 必须排在 TRANSIENT_RE 之前（短路优先），实到 definite@' + iDefinite + ' transient@' + iTransient)
})

test('结构锁：Atomics.wait 不可用时必须退化为「带截止时间的忙等」，不得直接重试', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-main-red.js'), 'utf8')
  const m = src.match(/catch \(_\) \{\s*([\s\S]{0,200}?)\s*\}/)
  assert.ok(m, '必须存在 Atomics.wait 的 catch 退化分支')
  assert.match(m[1], /while\s*\(\s*Date\.now\(\)\s*</, '退化分支必须是带 Date.now() 截止的忙等；实到：' + JSON.stringify(m[1]))
})


