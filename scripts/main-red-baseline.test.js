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

// ─── 6. 返回值形状契约（readout 依赖它） ────────────────────────────────
test('返回值必须带 {kind, sha, staleness, rows}，且 rows 就是该 sha 的行', () => {
  const chain = ['A', 'B']
  const rows = [passRow('electron-tests')]
  const r = pickBaseline(makeInput(chain, [rows, []]))
  assert.deepEqual(Object.keys(r).sort(), ['kind', 'rows', 'sha', 'staleness'])
  assert.equal(r.rows, rows, 'rows 必须原样返回该 sha 的行，供 judge() 直接消费')
})
