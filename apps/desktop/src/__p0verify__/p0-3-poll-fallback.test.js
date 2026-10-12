// @ts-check
/**
 * M-3 回归锁：Collection 批量轮询的失败兜底
 *
 * 缺陷（报告 M-3）：startBatchPolling 的 catch 分支是空的 ——
 * 只写了注释「轮询失败不立即中断，继续下次轮询」，既不计数、也不设总时长上限、
 * 也不给用户任何提示、也不复位 batchCollecting。于是只要 IPC 持续失败
 * （主进程重启 / 任务记录丢失 / 鉴权失效），batchCollecting 永远为 true，
 * 两个发起按钮永久禁用，进度条停在中间值且零错误文案。
 *
 * 已实证（基线 770967c0，证据见 docs/frontend-deep-review-2026-10-05.md 附录 C）：
 * 连续 20 轮 reject（约 40 秒）后 batchCollecting 仍为 true、batchError 为空、
 * 轮询仍在运行。
 *
 * 装置说明：batchCollecting 等是 Collection.vue 的组件内部闭包 ref，无法从外部注入。
 * 因此把 startBatchPolling 的轮询体提取为可测函数，并用「源码锚点断言」锁住
 * 提取版与真实源码的一致性 —— 提取版一旦与源码漂移，锚点断言立刻红。
 *
 * 本文件断言的是**修复后应然**，不会随缺陷修复而失效（原复现型文件
 * __p0verify__/p0-3-poll-hang.test.js 已在 M-1 修复时一并移除该做法）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const POLL_INTERVAL_MS = 2000        // Collection.vue 的 setInterval 间隔
const MAX_CONSECUTIVE_FAILURES = 10  // ≈20 秒，覆盖主进程重启等常见瞬时故障
const MAX_POLL_DURATION_MS = 600000  // 10 分钟总时长上限，防「每 2 秒成功但永不终结」活锁

/** Collection.vue startBatchPolling 轮询体的提取版（修复后形态） */
function makeBatchPoller ({ api, state, setIntervalImpl, clearIntervalImpl }) {
  const { batchTaskId, batchCollecting, batchError, batchProgress } = state
  let batchPollTimer = null
  let consecutiveFailures = 0
  let startedAt = 0

  function stopBatchPolling () {
    if (batchPollTimer) {
      clearIntervalImpl(batchPollTimer)
      batchPollTimer = null
    }
    batchCollecting.value = false
  }

  function failOut (message) {
    batchError.value = message
    batchCollecting.value = false
    stopBatchPolling()
  }

  function startBatchPolling () {
    if (batchPollTimer) { clearIntervalImpl(batchPollTimer); batchPollTimer = null }
    consecutiveFailures = 0
    startedAt = Date.now()
    batchPollTimer = setIntervalImpl(async () => {
      if (!batchTaskId.value) return
      if (!api || !api.aggregationTaskStatus) return

      // 总时长上限：即使每轮都「成功」但永不终结，也要兜底
      if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
        failOut('采集超时未完成，已停止等待（已收集内容仍保留，可重新发起）')
        return
      }

      try {
        const res = await api.aggregationTaskStatus(batchTaskId.value)
        // 一旦成功即清零计数 —— 只统计「连续」失败
        consecutiveFailures = 0
        const data = res && res.data ? res.data : res
        const status = data.status || res.status
        const total = data.total || 0
        const completed = data.completed !== undefined ? data.completed : data.done || 0

        if (status === 'completed' || status === 'success') {
          batchProgress.value = 100
          batchCollecting.value = false
          const items = data.items || data.results || []
          items.forEach((item) => {
            state.onItem && state.onItem(item)
          })
          stopBatchPolling()
        } else if (status === 'failed' || status === 'error') {
          failOut(data.message || '采集失败')
        } else {
          if (total > 0) {
            batchProgress.value = Math.round((completed / total) * 100)
          }
        }
      } catch (e) {
        // M-3 修复核心：连续失败计数 + 达阈值即提示并复位，不再静默无限重试
        consecutiveFailures += 1
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          failOut(`连续 ${consecutiveFailures} 次查询失败，已停止等待（已收集内容仍保留，可重新发起）`)
        }
      }
    }, POLL_INTERVAL_MS)
  }

  return {
    startBatchPolling,
    stopBatchPolling,
    isRunning: () => batchPollTimer !== null,
  }
}

describe('M-3 回归锁：批量轮询失败兜底已生效', () => {
  let state
  let tickers

  beforeEach(() => {
    state = {
      batchTaskId: ref('task-1'),
      batchCollecting: ref(true),
      batchError: ref(''),
      batchProgress: ref(0),
      onItem: null,
    }
    tickers = []
  })

  it('源码锚点：轮询失败必须有兜底（防止本文件与实现漂移）', () => {
    // collection-ui-refinement：批量轮询整体迁入 features/collection/BatchCollectPanel.vue
    //（Collection.vue 只保留结果落地链路，不再自持轮询）。锚点随代码迁移到新文件，
    // 并在 Collection.vue 侧断言「不得再出现第二轮轮询实现」（单一实现禁令）。
    const panelSrc = readFileSync(
      resolve(process.cwd(), 'src/features/collection/BatchCollectPanel.vue'),
      'utf8',
    )
    const anchor = panelSrc.indexOf('batchPollTimer = setInterval')
    expect(anchor).toBeGreaterThan(-1)
    // 原文件锚到 'function stopBatchPolling'（M-3 修复时声明形态）；迁移版保留同形声明，
    // 但轮询体在声明之后（startBatchPolling 内），slice 到组件 script 的取消函数声明处即可
    const pollBody = panelSrc.slice(anchor, panelSrc.indexOf('function cancelBatchCollect'))

    // 轮询的 catch 分支不得再是空壳：必须走守卫的 recordFailure
    const catchIdx = pollBody.lastIndexOf('} catch (e) {')
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBody = pollBody.slice(catchIdx)
    expect(catchBody).toMatch(/recordFailure\(\)/)
    // 达标后必须复位 batchCollecting（否则按钮仍永久禁用）
    expect(catchBody).toMatch(/failBatchPolling\(/)
    // 守卫本身必须在 composables 里，且有连续失败阈值与时长上限
    const guard = readFileSync(
      resolve(process.cwd(), 'src/composables/useBatchPollGuard.js'),
      'utf8',
    )
    expect(guard).toMatch(/BATCH_POLL_MAX_CONSECUTIVE_FAILURES\s*=\s*\d+/)
    expect(guard).toMatch(/BATCH_POLL_MAX_DURATION_MS\s*=\s*\d+/)
    // 组件必须真的用它，而不是自己再实现一套
    expect(panelSrc).toMatch(/useBatchPollGuard\(\{\s*onFail:\s*failBatchPolling\s*\}\)/)
    // 迁入处必须是唯一实现：Collection.vue 不得再自持 setInterval 轮询
    const viewSrc = readFileSync(
      resolve(process.cwd(), 'src/views/Collection.vue'),
      'utf8',
    )
    expect(viewSrc).not.toMatch(/batchPollTimer = setInterval/)
  })

  it('基线：任务正常完成 → batchCollecting 复位、轮询停止', async () => {
    const api = {
      aggregationTaskStatus: vi.fn(async () => ({
        data: { status: 'completed', total: 1, completed: 1, items: [] },
      })),
    }
    const p = makeBatchPoller({
      api, state,
      setIntervalImpl: (fn) => { tickers.push(fn); return 1 },
      clearIntervalImpl: () => {},
    })
    p.startBatchPolling()
    expect(tickers).toHaveLength(1)
    await tickers[0]()

    expect(state.batchCollecting.value).toBe(false)
    expect(p.isRunning()).toBe(false)
  })

  it('持续失败：达阈值后必须提示并复位（不再静默卡死）', async () => {
    const api = {
      aggregationTaskStatus: vi.fn(async () => { throw new Error('主进程未就绪') }),
    }
    const p = makeBatchPoller({
      api, state,
      setIntervalImpl: (fn) => { tickers.push(fn); return 1 },
      clearIntervalImpl: () => {},
    })
    p.startBatchPolling()

    // 连续失败到阈值
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      await tickers[0]()
    }

    expect(api.aggregationTaskStatus).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES)
    // 关键：按钮不再永久禁用
    expect(state.batchCollecting.value).toBe(false)
    // 关键：用户看得到原因
    expect(state.batchError.value).not.toBe('')
    expect(state.batchError.value).toContain(String(MAX_CONSECUTIVE_FAILURES))
    // 轮询已停止，不再空转
    expect(p.isRunning()).toBe(false)
  })

  it('间歇性失败：成功一次即清零，不应被累计误伤', async () => {
    let n = 0
    const api = {
      aggregationTaskStatus: vi.fn(async () => {
        n += 1
        // 前 5 次失败，第 6 次成功但未完成，第 7 次起继续失败
        if (n <= 5) throw new Error('瞬时抖动')
        if (n === 6) return { data: { status: 'running', total: 10, completed: 1 } }
        throw new Error('再次失败')
      }),
    }
    const p = makeBatchPoller({
      api, state,
      setIntervalImpl: (fn) => { tickers.push(fn); return 1 },
      clearIntervalImpl: () => {},
    })
    p.startBatchPolling()

    for (let i = 0; i < 5; i++) await tickers[0]()   // 5 次失败，未达阈值
    expect(state.batchCollecting.value).toBe(true)    // 仍在采集，未被误停
    expect(state.batchError.value).toBe('')

    await tickers[0]()                               // 第 6 次：成功，计数清零
    expect(state.batchCollecting.value).toBe(true)
    expect(state.batchProgress.value).toBe(10)        // 1/10 = 10%
  })
})
