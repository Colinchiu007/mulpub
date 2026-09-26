import { describe, expect, it } from 'vitest'
import { createCloudSyncRows } from './useCloudSyncRows'
import { createCloudSyncResultModel } from './useCloudSyncResultModel'

/**
 * t 返回键名本身：本文件锁的是「计数/键选择/双边界」这些结构口径，
 * 不是译文（译文断言在组件测试与 locale 门禁里各有归属）。
 */
function fakeT (key, params) {
  return params === undefined ? key : `${key}:${JSON.stringify(params)}`
}

function build () {
  const model = createCloudSyncResultModel({ t: fakeT, te: () => true })
  const rows = createCloudSyncRows({
    t: fakeT,
    platformLabel: id => `L-${id}`,
    reasonFor: model.reasonFor,
    OUTCOME_LABEL_KEYS: model.OUTCOME_LABEL_KEYS,
  })
  return { ...model, ...rows }
}

describe('useCloudSyncRows 进度双边界', () => {
  it('start 落一行「已发起」：outcome 为空且不计入 doneCount', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'start', platform: 'wechat_mp', accountId: 'a1', name: '公众号', total: 2 })
    expect(r.rows.value).toHaveLength(1)
    expect(r.rows.value[0].outcome).toBe('')
    expect(r.doneCount.value).toBe(0)
    expect(r.inflight.value).toEqual(['wechat_mp'])
    expect(r.inflightLabels.value).toEqual(['L-wechat_mp'])
    expect(r.progressTotal.value).toBe(2)
  })

  it('done 覆盖同一行：不新增行、outcome 落地、inflight 清空', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'start', platform: 'wechat_mp', accountId: 'a1' })
    r.handleProgressEvent({ phase: 'done', platform: 'wechat_mp', accountId: 'a1', outcome: 'created', code: '' })
    expect(r.rows.value).toHaveLength(1)
    expect(r.rows.value[0].outcome).toBe('created')
    expect(r.doneCount.value).toBe(1)
    expect(r.inflight.value).toEqual([])
  })

  it('done 未带 outcome 时按 failed 收口（不得留一行无终态）', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'done', platform: 'douyin', accountId: 'd1' })
    expect(r.rows.value[0].outcome).toBe('failed')
    expect(r.rows.value[0].reason).toBe('accountsPage.cloudSyncErr.cloudFailed')
  })

  it('终态 items 常带空 code：done 已落地的码不得被抹掉', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'done', platform: 'zhihu', accountId: 'z1', outcome: 'invalid-credential', code: 'CREDENTIAL_REJECTED' })
    const withCode = r.rows.value[0].code
    expect(withCode).toBe('CREDENTIAL_REJECTED')
    r.handleProgressEvent({ phase: 'done', platform: 'zhihu', accountId: 'z1', outcome: 'invalid-credential', code: '' })
    expect(r.rows.value[0].code).toBe(withCode)
  })

  it('无 accountId 时按 platform-index 生成行键（批次序内稳定）', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'start', platform: 'bilibili', index: 0 })
    r.handleProgressEvent({ phase: 'start', platform: 'bilibili', index: 1 })
    expect(r.rows.value.map(row => row.key)).toEqual(['bilibili-0', 'bilibili-1'])
  })

  it('平台名为空时回落原始 platform，行标签不得为空串', () => {
    const r = createCloudSyncRows({
      t: fakeT,
      platformLabel: () => '',
      reasonFor: build().reasonFor,
      OUTCOME_LABEL_KEYS: build().OUTCOME_LABEL_KEYS,
    })
    r.handleProgressEvent({ phase: 'start', platform: 'weibo', accountId: 'w1' })
    expect(r.rows.value[0].label).toBe('weibo')
  })

  it('非对象载荷直接忽略（主进程旁路广播不得把列表打崩）', () => {
    const r = build()
    r.handleProgressEvent(null)
    r.handleProgressEvent('x')
    expect(r.rows.value).toEqual([])
  })

  // ── 行键稳定性（评审发现的真缺陷：恢复阶段 start 还没有 accountId，done 才带上，
  //    旧实现优先取 accountId，于是一条恢复在界面上裂成两行，doneCount 与百分比同时失真）──
  it('start 无 accountId、done 带 accountId 时仍必须落在同一行（rowKey 优先）', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'start', rowKey: 'restore:wechat_mp:uid9', index: 1, platform: 'wechat_mp', name: '老公众号' })
    r.handleProgressEvent({ phase: 'done', rowKey: 'restore:wechat_mp:uid9', index: 1, platform: 'wechat_mp', accountId: 'local-new-1', outcome: 'restored' })
    expect(r.rows.value).toHaveLength(1)
    expect(r.rows.value[0].key).toBe('restore:wechat_mp:uid9')
    expect(r.doneCount.value).toBe(1)
  })

  it('同平台两条恢复项 rowKey 不同 → 两行（旧实现用恒为 0 的 index 会挤成一行）', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'start', rowKey: 'restore:douyin:a', index: 1, platform: 'douyin' })
    r.handleProgressEvent({ phase: 'start', rowKey: 'restore:douyin:b', index: 2, platform: 'douyin' })
    expect(r.rows.value.map(row => row.key)).toEqual(['restore:douyin:a', 'restore:douyin:b'])
  })

  it('载荷既无 rowKey 也无 accountId/index 时，键必须只由载荷决定且不得随调用时序漂移', () => {
    const r = build()
    r.handleProgressEvent({ phase: 'start', platform: 'zhihu', name: 'A' })
    const firstKey = r.rows.value[0].key
    r.handleProgressEvent({ phase: 'done', platform: 'zhihu', name: 'A', outcome: 'updated' })
    expect(r.rows.value).toHaveLength(1)
    expect(r.rows.value[0].key).toBe(firstKey)
    // 第二发同形状事件不得因为 rows 变长而拿到不同键
    r.handleProgressEvent({ phase: 'start', platform: 'zhihu', name: 'A' })
    expect(r.rows.value).toHaveLength(1)
  })

  it('resetRows 清空行与在途集合并写入新 total', () => {

    const r = build()
    r.handleProgressEvent({ phase: 'start', platform: 'douyin', accountId: 'd1' })
    r.resetRows(3)
    expect(r.rows.value).toEqual([])
    expect(r.inflight.value).toEqual([])
    expect(r.progressTotal.value).toBe(3)
    expect(r.syncPercent.value).toBe(0)
  })

  it('syncPercent 以 progressTotal 为分母并封顶 100', () => {
    const r = build()
    r.resetRows(2)
    r.handleProgressEvent({ phase: 'done', platform: 'douyin', accountId: 'd1', outcome: 'created' })
    expect(r.syncPercent.value).toBe(50)
    r.handleProgressEvent({ phase: 'done', platform: 'douyin', accountId: 'd2', outcome: 'created' })
    expect(r.syncPercent.value).toBe(100)
    r.handleProgressEvent({ phase: 'done', platform: 'douyin', accountId: 'd3', outcome: 'created' })
    expect(r.syncPercent.value).toBe(100)
  })
})

describe('useCloudSyncRows 终态汇总', () => {
  it('counters：ok 含 created/updated/unchanged/restored/conflicts，fail 含 invalid/failed', () => {
    const r = build()
    r.summary.value = {
      created: 1, updated: 2, unchanged: 3, restored: 4, skipped: 5,
      conflicts: 6, invalid: 7, failed: 8, items: [],
    }
    expect(r.counters.value.ok).toBe(1 + 2 + 3 + 4 + 6)
    expect(r.counters.value.fail).toBe(7 + 8)
  })

  it('summaryText 三档：全失败 / 部分失败 / 全成功 各走不同文案键', () => {
    const r = build()
    r.summary.value = { created: 0, updated: 0, unchanged: 0, restored: 0, skipped: 0, conflicts: 0, invalid: 2, failed: 1, items: [] }
    expect(r.summaryText.value).toContain('cloudSyncAllFailed')
    r.summary.value = { ...r.summary.value, created: 1 }
    expect(r.summaryText.value).toContain('cloudSyncPartial')
    r.summary.value = { ...r.summary.value, invalid: 0, failed: 0 }
    expect(r.summaryText.value).toContain('cloudSyncDone')
  })

  it('summaryStats 优先按 items 终态计数（与逐条列表同源，不出现两个口径）', () => {
    const r = build()
    r.summary.value = {
      created: 9, updated: 0, unchanged: 0, restored: 0, skipped: 0, conflicts: 0, invalid: 0, failed: 0,
      items: [
        { outcome: 'created' },
        { outcome: 'created' },
        { outcome: 'skipped-tombstone' },
      ],
    }
    const stats = r.summaryStats.value
    expect(stats).toEqual([
      { outcome: 'created', count: 2 },
      { outcome: 'skipped-tombstone', count: 1 },
    ])
  })

  it('items 缺席时回落 counters，并把 skipped/uidUnavailable/invalid 映射为对应 outcome', () => {
    const r = build()
    r.summary.value = {
      created: 1, updated: 0, unchanged: 0, restored: 2, skipped: 3, conflicts: 0, invalid: 4, failed: 0, uidUnavailable: 5, items: [],
    }
    expect(r.summaryStats.value).toEqual([
      { outcome: 'created', count: 1 },
      { outcome: 'restored', count: 2 },
      { outcome: 'skipped-tombstone', count: 3 },
      { outcome: 'uid-unavailable', count: 5 },
      { outcome: 'invalid-credential', count: 4 },
    ])
  })

  it('items 缺席时不得给 conflicts 造一个带侧向的标签（主进程把两侧冲突合成一个计数）', () => {
    const r = build()
    r.summary.value = {
      created: 0, updated: 0, unchanged: 0, restored: 0, skipped: 0, conflicts: 2, invalid: 0, failed: 0, uidUnavailable: 0, items: [],
    }
    expect(r.summaryStats.value).toEqual([])
    // 但汇总文字仍如实反映 ok/fail，不因为 chip 缺席就少报成功数
    expect(r.counters.value.ok).toBe(2)
  })

  it('未登记的 outcome 不得出现在汇总区（避免渲染成假标签）', () => {
    const r = build()
    r.summary.value = {
      created: 1, updated: 0, unchanged: 0, restored: 0, skipped: 0, conflicts: 0, invalid: 0, failed: 0,
      items: [{ outcome: 'created' }, { outcome: 'quantum-leap' }],
    }
    expect(r.summaryStats.value).toEqual([{ outcome: 'created', count: 1 }])
  })

  it('summary 为 null 时 counters/summaryText/summaryStats 全部静默（批次未收口不得出现汇总）', () => {
    const r = build()
    expect(r.counters.value).toBe(null)
    expect(r.summaryText.value).toBe('')
    expect(r.summaryStats.value).toEqual([])
  })
})
