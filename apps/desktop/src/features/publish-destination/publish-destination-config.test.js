// @ts-check
/**
 * publish-destination-config.test.js — 「去发布」弹窗的配置选择纯函数契约
 * （publish-config-picker，2026-10-21）
 *
 * 覆盖三条主线：
 *  1. 数据校验：主进程返回的档案里混进非法条目时，只丢坏的、留好的。
 *  2. 流水线联动：配置按 pipelineId 分域；切流水线后旧选择必须作废。
 *  3. 交接载荷：非法/空配置 id 不得进入创作页 query（否则创作页会报「配置不存在」）。
 */
import { describe, it, expect } from 'vitest'
import {
  buildCreateHandoffQuery,
  buildPublishVideoSelection,
  filterConfigProfilesByPipeline,
  normalizeConfigProfiles,
  resolveConfigSelection,
} from './publish-destination-config'

const profile = (overrides = {}) => ({
  id: 'profile-000000000001',
  name: '竖屏配置',
  pipelineId: 'story2video-compose',
  snapshot: { schemaVersion: 1 },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...overrides,
})

describe('normalizeConfigProfiles', () => {
  it('丢弃非法条目、保留合法条目（不因一条坏数据让整列表变空）', () => {
    const list = normalizeConfigProfiles([
      profile({ id: 'profile-000000000002' }),
      null,
      'not-an-object',
      profile({ id: '短' }),                       // id 不满足 8..64
      profile({ id: 'profile-000000000003', name: '   ' }), // 名称 trim 后为空
      profile({ id: 'profile-000000000004', pipelineId: '非法 id' }), // 流水线 id 形态非法
      profile({ id: 'profile-000000000005', pipelineId: 'video-clone' }),
    ])
    expect(list.map(item => item.id)).toEqual([
      'profile-000000000002',
      'profile-000000000005',
    ])
  })

  it('非数组输入返回空列表（不抛错）', () => {
    expect(normalizeConfigProfiles(null)).toEqual([])
    expect(normalizeConfigProfiles(undefined)).toEqual([])
    expect(normalizeConfigProfiles({})).toEqual([])
  })

  it('updatedAt 非法时归零（排序稳定，不产生 NaN）', () => {
    const list = normalizeConfigProfiles([profile({ updatedAt: 'not-a-number' })])
    expect(list[0].updatedAt).toBe(0)
  })
})

describe('filterConfigProfilesByPipeline', () => {
  it('只取本流水线的档案，且按更新时间倒序', () => {
    const list = [
      profile({ id: 'profile-000000000001', updatedAt: 1000 }),
      profile({ id: 'profile-000000000002', pipelineId: 'video-clone', updatedAt: 9000 }),
      profile({ id: 'profile-000000000003', updatedAt: 5000 }),
    ]
    const filtered = filterConfigProfilesByPipeline(list, 'story2video-compose')
    expect(filtered.map(item => item.id)).toEqual([
      'profile-000000000003',
      'profile-000000000001',
    ])
  })

  it('流水线为空 ⇒ 空列表（不做「全部」兜底）', () => {
    expect(filterConfigProfilesByPipeline([profile()], '')).toEqual([])
    expect(filterConfigProfilesByPipeline([profile()], null)).toEqual([])
  })
})

describe('resolveConfigSelection', () => {
  it('无配置时选项为空、选中项为空串（下拉显示「默认」且内容为空）', () => {
    const resolved = resolveConfigSelection([profile({ pipelineId: 'video-clone' })], 'story2video-compose', '')
    expect(resolved.options).toEqual([])
    expect(resolved.selectedId).toBe('')
    expect(resolved.selectedName).toBe('')
  })

  it('选中的 id 不属于当前流水线时回落为空串（不留悬空选中态）', () => {
    const resolved = resolveConfigSelection(
      [profile({ id: 'profile-000000000009', pipelineId: 'video-clone' })],
      'story2video-compose',
      'profile-000000000009',
    )
    expect(resolved.selectedId).toBe('')
    expect(resolved.selectedName).toBe('')
  })

  it('命中的配置返回名称', () => {
    const resolved = resolveConfigSelection(
      [profile({ id: 'profile-000000000009', name: '口播竖屏' })],
      'story2video-compose',
      'profile-000000000009',
    )
    expect(resolved.selectedId).toBe('profile-000000000009')
    expect(resolved.selectedName).toBe('口播竖屏')
  })
})

describe('buildPublishVideoSelection', () => {
  it('配置 id 非法时清空（不让坏 id 走到创作页）', () => {
    const selection = buildPublishVideoSelection({
      pipelineId: 'story2video-compose',
      configProfileId: '短',
      configProfileName: '坏配置',
    })
    expect(selection.pipelineId).toBe('story2video-compose')
    expect(selection.configProfileId).toBe('')
  })

  it('合法配置原样透传', () => {
    const selection = buildPublishVideoSelection({
      pipelineId: ' story2video-compose ',
      configProfileId: 'profile-000000000009',
      configProfileName: '口播竖屏',
    })
    expect(selection).toEqual({
      pipelineId: 'story2video-compose',
      configProfileId: 'profile-000000000009',
      configProfileName: '口播竖屏',
    })
  })

  it('非对象入参不抛错', () => {
    expect(buildPublishVideoSelection(null).pipelineId).toBe('')
  })
})

describe('buildCreateHandoffQuery', () => {
  it('草稿/流水线/配置齐全时三个键都在', () => {
    expect(buildCreateHandoffQuery({
      draftId: 'draft-1',
      pipelineId: 'story2video-compose',
      configProfileId: 'profile-000000000009',
    })).toEqual({
      draft: 'draft-1',
      pipeline: 'story2video-compose',
      configProfile: 'profile-000000000009',
    })
  })

  it('没有选配置时**不**带 configProfile 键（空串会让创作页报「配置不存在」）', () => {
    const query = buildCreateHandoffQuery({ draftId: 'draft-1', pipelineId: 'story2video-compose' })
    expect('configProfile' in query).toBe(false)
  })

  it('配置 id 非法时也不带 configProfile 键', () => {
    const query = buildCreateHandoffQuery({ draftId: 'draft-1', configProfileId: '坏 id' })
    expect('configProfile' in query).toBe(false)
  })

  it('草稿为空时不带 draft 键', () => {
    const query = buildCreateHandoffQuery({ draftId: '  ' })
    expect('draft' in query).toBe(false)
  })
})
