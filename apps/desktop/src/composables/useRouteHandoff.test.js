// @ts-check
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * S3 交接参数收敛（PRD-UI-FLOW-CLARITY §5-S3）的入口裁定契约。
 *
 * 测的是 `useRouteHandoff` 这个「单一入口」的裁定与委托，不测各 composable 内部
 * （那由 usePublishDrafts.test.js / Publish.test.js 的既有用例覆盖）：
 *  1. 优先级：批量 ?drafts= > 单篇 ?draft= > ?republish=
 *  2. 互斥一次性裁定：?draft= 与 ?republish= 同现时只有草稿被装载，
 *     republish 不得产生任何快照读取（PRD 验收 13：appliedIds 不消耗 Y）
 *  3. ?video_path= 与 1/2/3 可叠加（历史视频预填与草稿装载不互斥）
 *  4. 幂等委托：重复调用（onMounted + onActivated 双触发）不重复装载
 */

const { applyDraftHandoff, handoffIdsFromQuery, applyRepublishFromQuery, applyHistoryVideoQuery } = vi.hoisted(() => ({
  applyDraftHandoff: vi.fn(),
  handoffIdsFromQuery: vi.fn(),
  applyRepublishFromQuery: vi.fn(),
  applyHistoryVideoQuery: vi.fn(),
}))

vi.mock('./useHotTopicsDraftHandoff', () => ({
  HANDOFF_DRAFT_LIMIT: 50,
  parseHandoffDraftIds: (value) => {
    const raw = Array.isArray(value) ? value.join(',') : (typeof value === 'string' ? value : '')
    return [...new Set(raw.split(',').map(id => id.trim()).filter(Boolean))].slice(0, 50)
  },
  useHotTopicsDraftHandoff: () => ({
    handoffAppliedKey: ref(''),
    batchTargetPlatforms: ref([]),
    handoffPlatformOptions: ref([]),
    buildDefaultTargets: () => ({}),
    applyBatchTargetsToAll: vi.fn(),
    applyDraftHandoff,
    handoffIdsFromQuery,
    parseHandoffDraftIds: (value) => {
      const raw = Array.isArray(value) ? value.join(',') : (typeof value === 'string' ? value : '')
      return [...new Set(raw.split(',').map(id => id.trim()).filter(Boolean))].slice(0, 50)
    },
  }),
}))

vi.mock('./usePublishRepublish', () => ({
  usePublishRepublish: () => ({ applyRepublishFromQuery, watchRepublishQuery: vi.fn() }),
}))

vi.mock('./usePublishHistoryPrefill', () => ({
  usePublishHistoryPrefill: () => ({ applyHistoryVideoQuery }),
}))

import { useRouteHandoff } from './useRouteHandoff'

/** 构造最小 deps：route 用 ref 承载 query，其余全部是可断言的桩 */
function makeDeps (query) {
  const route = ref({ query })
  const calls = {
    loadDrafts: vi.fn(async () => [{ id: 'd1' }]),
    loadDraft: vi.fn(async () => true),
    applyCopyDetailHandoff: vi.fn(),
  }
  return { route, calls }
}

describe('useRouteHandoff — 交接参数单一入口（S3）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    applyDraftHandoff.mockResolvedValue(0)
    handoffIdsFromQuery.mockReturnValue([])
    applyRepublishFromQuery.mockResolvedValue(false)
    applyHistoryVideoQuery.mockReturnValue(undefined)
  })

  it('优先级 1：批量 ?drafts= 存在时装载批量，且不再走单篇与 republish', async () => {
    handoffIdsFromQuery.mockReturnValue(['d1', 'd2'])
    applyDraftHandoff.mockResolvedValue(2)
    const { route, calls } = makeDeps({ drafts: 'd1,d2', draft: 'd9', republish: 'r1' })
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    const outcome = await handoff.applyRouteHandoff()
    expect(outcome).toEqual({ kind: 'batch', count: 2 })
    expect(applyDraftHandoff).toHaveBeenCalledWith(['d1', 'd2'])
    expect(calls.loadDraft).not.toHaveBeenCalled()
    expect(applyRepublishFromQuery).not.toHaveBeenCalled()
  })

  it('优先级 2：无批量时单篇 ?draft= 装载，republish 不被消费', async () => {
    const { route, calls } = makeDeps({ draft: 'd7', republish: 'r1' })
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    const outcome = await handoff.applyRouteHandoff()
    expect(outcome).toEqual({ kind: 'draft', id: 'd7' })
    expect(calls.loadDrafts).toHaveBeenCalledTimes(1)
    expect(calls.loadDraft).toHaveBeenCalledWith('d7')
    expect(applyRepublishFromQuery).not.toHaveBeenCalled()
  })

  it('互斥裁定（PRD 验收 13）：?draft=X&republish=Y 时只有草稿被装载，appliedIds 不消耗 Y', async () => {
    // 与上一例互补：这里显式断言 republish 的 IPC 入口零调用（appliedIds 不加 Y 的前提）
    const { route, calls } = makeDeps({ draft: 'X', republish: 'Y' })
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    await handoff.applyRouteHandoff()
    expect(applyRepublishFromQuery).not.toHaveBeenCalled()
  })

  it('优先级 3：无 draft/drafts 时才消费 republish', async () => {
    applyRepublishFromQuery.mockResolvedValue(true)
    const { route, calls } = makeDeps({ republish: 'r9' })
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    const outcome = await handoff.applyRouteHandoff()
    expect(outcome).toEqual({ kind: 'republish', applied: true })
    expect(applyRepublishFromQuery).toHaveBeenCalledTimes(1)
    expect(calls.loadDraft).not.toHaveBeenCalled()
  })

  it('video_path 与草稿可叠加：先预填视频，再装载草稿（现状语义）', async () => {
    const { route, calls } = makeDeps({ draft: 'd3', video_path: 'D%3A%2Fv.mp4' })
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    const outcome = await handoff.applyRouteHandoff()
    expect(applyHistoryVideoQuery).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ kind: 'draft', id: 'd3' })
  })

  it('单篇草稿缺失时走缺失提示（不静默，也不回落 republish）', async () => {
    const { route, calls } = makeDeps({ draft: 'gone', republish: 'r1' })
    calls.loadDraft.mockResolvedValue(false)
    const notifyDraftMissing = vi.fn()
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing })
    const outcome = await handoff.applyRouteHandoff()
    expect(outcome).toEqual({ kind: 'draft-missing', id: 'gone' })
    expect(notifyDraftMissing).toHaveBeenCalledWith('gone')
    // 缺失不等于「用户没选草稿」：此时不得回落 republish（那是另一条数据源，
    // 静默回落正是 PRD 规则 1 反对的隐式副作用）
    expect(applyRepublishFromQuery).not.toHaveBeenCalled()
  })

  it('幂等：同一 query 上重复调用（onMounted+onActivated）不重复装载单篇草稿', async () => {
    const { route, calls } = makeDeps({ draft: 'd1' })
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    await handoff.applyRouteHandoff()
    await handoff.applyRouteHandoff()
    expect(calls.loadDraft).toHaveBeenCalledTimes(1)
    // video_path 预填不设幂等键：它自带「无 query 早退」与幂等（写同值），保持现状每次激活都跑
    expect(applyHistoryVideoQuery).toHaveBeenCalledTimes(2)
  })

  it('幂等：republish 委托保持既有 appliedIds 语义（重复调用只透传一次）', async () => {
    applyRepublishFromQuery.mockResolvedValue(true)
    const { route, calls } = makeDeps({ republish: 'r1' })
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    await handoff.applyRouteHandoff()
    await handoff.applyRouteHandoff()
    // 入口不做二次记账（幂等真源在 usePublishRepublish.appliedIds），
    // 但同 query 下入口自身的「已消费 query 串」键也要挡住第二次透传
    expect(applyRepublishFromQuery).toHaveBeenCalledTimes(1)
  })

  it('无任何交接参数时是 no-op，不触发任何装载', async () => {
    const { route, calls } = makeDeps({})
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    const outcome = await handoff.applyRouteHandoff()
    expect(outcome).toEqual({ kind: 'none' })
    expect(calls.loadDrafts).not.toHaveBeenCalled()
    // video_path 预填是叠加层，无 query 时内部早退——但入口**总是**调它（现状语义：
    // applyHistoryVideoQuery 自带无 query 早退）。no-op 断言只针对装载类副作用。
    expect(applyHistoryVideoQuery).toHaveBeenCalledTimes(1)
  })

  it('query 变化后（keep-alive 激活携带新参数）入口按新 query 重新裁定', async () => {
    const { route, calls } = makeDeps({})
    const handoff = useRouteHandoff({ route, ...calls, notifyDraftMissing: vi.fn() })
    await handoff.applyRouteHandoff()
    route.value = { query: { draft: 'd2' } }
    await nextTick()
    await handoff.applyRouteHandoff()
    expect(calls.loadDraft).toHaveBeenCalledWith('d2')
  })
})
