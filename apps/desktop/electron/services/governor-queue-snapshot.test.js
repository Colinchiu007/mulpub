// @ts-check
/**
 * governor-queue-snapshot.test.js — 排队快照聚合的单元测试
 *
 * 跑法（零依赖，node 内置 test runner）：
 *   node --test apps/desktop/electron/services/governor-queue-snapshot.test.js
 *
 * 覆盖场景（正常 / 边界 / 异常 / 竞态形态）：
 *   ① 空输入 ② RPM 槽排队 ③ 槽已过期 ④ 并发槽排队
 *   ⑤ 并发 + RPM 同时存在 ⑥ 多 key 聚合 ⑦ 排序优先级
 *   ⑧ 非法字段容错 ⑨ 普通对象容错 ⑩ 任何输入都不抛
 */

// ⚠️ 本文件在 `electron/services/**` 下 ⇒ 被 apps/desktop/vitest.config.js 的 include 白名单覆盖
// ⇒ **必须用 vitest 风格**（node:test 风格的用例会收集不到 = 假绿）。
// 断言体沿用 node:assert（与 runner 无关，vitest 下同样可用）。
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

const {
  QUEUE_REASON,
  ETA_CONFIDENCE,
  describeQueueEntry,
  buildQueueSnapshot,
} = require('./governor-queue-snapshot')

const NOW = 1_700_000_000_000

describe('governor-queue-snapshot', () => {

it('① 空输入：null / undefined / 空 Map ⇒ 无排队', () => {
  for (const input of [null, undefined, new Map(), {}]) {
    const snap = buildQueueSnapshot(input, NOW)
    assert.equal(snap.totalQueued, 0)
    assert.deepEqual(snap.entries, [])
  }
})

it('② RPM 槽排队：nextSlotAt 在未来 ⇒ ETA 为精确差值、置信度 high', () => {
  const st = { nextSlotAt: NOW + 4200, waiters: [] }
  const entry = describeQueueEntry('doubao-llm:llm:m1', st, NOW)
  assert.ok(entry)
  assert.equal(entry.reason, QUEUE_REASON.RPM)
  assert.equal(entry.etaMs, 4200)
  assert.equal(entry.etaConfidence, ETA_CONFIDENCE.HIGH)
  assert.equal(entry.queued, 1, 'RPM 槽排队时本次调用自己算 1 个在等')
  assert.equal(entry.key, 'doubao-llm:llm:m1', 'key 原样透出，不做拆分')
})

it('③ 槽已过期（很久没调用）⇒ 不进条目，不显示排队', () => {
  const st = { nextSlotAt: NOW - 30_000, waiters: [] }
  assert.equal(describeQueueEntry('k', st, NOW), null)
  const snap = buildQueueSnapshot(new Map([['k', st]]), NOW)
  assert.equal(snap.totalQueued, 0)
  assert.deepEqual(snap.entries, [])
})

it('④ 并发槽排队：有等待者 ⇒ 报位次、ETA 不可知（null）', () => {
  const st = { nextSlotAt: 0, waiters: [{}, {}, {}] }
  const entry = describeQueueEntry('k', st, NOW)
  assert.ok(entry)
  assert.equal(entry.reason, QUEUE_REASON.CONCURRENCY)
  assert.equal(entry.queued, 3)
  assert.equal(entry.etaMs, null, '并发槽排队时不给 ETA（真实等待不可知）')
  assert.equal(entry.etaConfidence, ETA_CONFIDENCE.LOW)
})

it('⑤ 并发 + RPM 同时存在 ⇒ 以并发为准（不给 ETA）', () => {
  const st = { nextSlotAt: NOW + 5000, waiters: [{}] }
  const entry = describeQueueEntry('k', st, NOW)
  assert.equal(entry.reason, QUEUE_REASON.CONCURRENCY)
  assert.equal(entry.etaMs, null)
  assert.equal(entry.queued, 1)
})

it('⑥ 多 key 聚合：totalQueued = 各条目 queued 之和', () => {
  const map = new Map([
    ['a:llm:x', { nextSlotAt: NOW + 1000, waiters: [] }],
    ['b:llm:y', { nextSlotAt: 0, waiters: [{}, {}, {}] }],
    ['c:llm:z', { nextSlotAt: NOW - 5000, waiters: [] }], // 已过期，不计
  ])
  const snap = buildQueueSnapshot(map, NOW)
  assert.equal(snap.entries.length, 2)
  assert.equal(snap.totalQueued, 4) // rpm 1 + concurrency 3
})

it('⑦ 排序：并发排队优先，其次按等待时间升序', () => {
  const map = new Map([
    ['slow', { nextSlotAt: NOW + 9000, waiters: [] }],
    ['fast', { nextSlotAt: NOW + 1000, waiters: [] }],
    ['conc', { nextSlotAt: 0, waiters: [{}] }],
  ])
  const snap = buildQueueSnapshot(map, NOW)
  assert.deepEqual(snap.entries.map(e => e.key), ['conc', 'fast', 'slow'])
})

it('⑧ 非法字段容错：waiters 非数组 / nextSlotAt 非数 / st 为 null ⇒ 不抛且不误报', () => {
  assert.equal(describeQueueEntry('k', { waiters: 'not-array', nextSlotAt: 'x' }, NOW), null)
  assert.equal(describeQueueEntry('k', null, NOW), null)
  assert.equal(describeQueueEntry('k', undefined, NOW), null)
  const snap = buildQueueSnapshot(new Map([['k', { waiters: 'oops' }]]), NOW)
  assert.equal(snap.totalQueued, 0)
  assert.deepEqual(snap.entries, [])
})

it('⑨ 普通对象输入（容错路径）也能聚合', () => {
  const snap = buildQueueSnapshot({ 'x:llm:1': { nextSlotAt: NOW + 2000, waiters: [] } }, NOW)
  assert.equal(snap.entries.length, 1)
  assert.equal(snap.totalQueued, 1)
})

it('⑩ 任何畸形输入都不抛异常（不变量）', () => {
  const junk = [null, undefined, 0, '', [], new Map(), new Map([['k', null]]), { k: 1 }]
  for (const input of junk) {
    assert.doesNotThrow(() => buildQueueSnapshot(input, NOW))
    assert.doesNotThrow(() => buildQueueSnapshot(input, 'not-a-number'))
  }
})

it('now 缺省时用当前时间（不抛）', () => {
  const snap = buildQueueSnapshot(new Map([['k', { nextSlotAt: Date.now() + 1000 }]]))
  assert.equal(snap.entries.length, 1)
  assert.ok(snap.entries[0].etaMs <= 1000)
})
})
