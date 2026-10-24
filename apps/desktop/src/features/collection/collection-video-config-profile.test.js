// @ts-check
/**
 * collection-video-config-profile.test.js — 采集页就地执行时「配置档案」解析的回归锁
 * （fix-collection-rewrite-publish-flow，2026-10-21）。
 *
 * 要锁的契约（每条都对应一个真实失效形态）：
 *  ① 选了配置档案 ⇒ 启动快照必须换成**档案的**快照（否则就是「选了等于没选」）；
 *  ② 档案不存在 / 已删除 / 属于别的流水线 ⇒ 回退「上次选项」+ **可见提示**，
 *     且提示必须是主干 create 命名空间的既有 key（不另写一份同义文案）；
 *  ③ 快照形态不适用（legacy 形态没有 s2vConfig/s2vOutputConfig）⇒ 判为不可用
 *     并提示——硬塞进去会被启动参数**静默忽略**（回落到默认参数）；
 *  ④ 配置库载入失败 ⇒ 回退 + 提示，且**不抛错**（抛出去会让整次生成失败）。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  resolveCollectionVideoConfigProfile,
  resolveCollectionVideoStartSnapshot,
} from './collection-video-config-profile'

/** 编排型配置档案的快照（与 buildGenVideoStartParams 消费的键同构） */
const ORCHESTRATED_SNAPSHOT = {
  schemaVersion: 1,
  kind: 'orchestrated',
  s2vConfig: { voiceSpeed: 1.2, imageStyle: 'cinematic' },
  s2vOutputConfig: { resolution: '1080x1920', fps: 30, format: 'mp4' },
}

/** legacy 形态快照（结构不同，套不进启动参数） */
const LEGACY_SNAPSHOT = { schemaVersion: 1, kind: 'legacy', legacy: { inputMode: 'text' } }

const PROFILE = {
  id: 'profile-000000000009',
  name: '口播竖屏',
  pipelineId: 'story2video-compose',
  snapshot: ORCHESTRATED_SNAPSHOT,
  updatedAt: 1,
}

describe('resolveCollectionVideoConfigProfile — 配置档案能不能套用', () => {
  it('没选配置档案时既没有快照也没有提示（不是失败，是「没要求」）', () => {
    const r = resolveCollectionVideoConfigProfile({ profileId: '', pipelineId: 'story2video-compose', profiles: [PROFILE] })
    expect(r).toEqual({ snapshot: null, warningKey: '' })
  })

  it('档案存在且属于该流水线 ⇒ 返回它的快照，无提示', () => {
    const r = resolveCollectionVideoConfigProfile({
      profileId: PROFILE.id,
      pipelineId: 'story2video-compose',
      profiles: [PROFILE],
    })
    expect(r.warningKey).toBe('')
    expect(r.snapshot).toBe(ORCHESTRATED_SNAPSHOT)
  })

  it('档案不存在（已删除）⇒ 提示 notFound，且不返回快照', () => {
    const r = resolveCollectionVideoConfigProfile({
      profileId: 'profile-000000000099',
      pipelineId: 'story2video-compose',
      profiles: [PROFILE],
    })
    expect(r.snapshot).toBe(null)
    expect(r.warningKey).toBe('create.story2video.configProfile.notFound')
  })

  it('档案属于别的流水线 ⇒ 提示 wrongPipeline（不是「找不到」）', () => {
    const r = resolveCollectionVideoConfigProfile({
      profileId: PROFILE.id,
      pipelineId: 'animated-explainer',
      profiles: [PROFILE],
    })
    expect(r.snapshot).toBe(null)
    expect(r.warningKey).toBe('create.story2video.configProfile.wrongPipeline')
  })

  it('快照形态不适用（legacy）⇒ 提示 snapshotInvalid（硬塞会被静默忽略）', () => {
    const r = resolveCollectionVideoConfigProfile({
      profileId: 'profile-000000000010',
      pipelineId: 'animated-explainer',
      profiles: [{ ...PROFILE, id: 'profile-000000000010', pipelineId: 'animated-explainer', snapshot: LEGACY_SNAPSHOT }],
    })
    expect(r.snapshot).toBe(null)
    expect(r.warningKey).toBe('create.story2video.configProfile.snapshotInvalid')
  })
})

describe('resolveCollectionVideoStartSnapshot — 启动快照怎么来', () => {
  it('没选配置档案 ⇒ 沿用「上次选项」快照（既有行为不变）', async () => {
    const readLastOptions = vi.fn().mockResolvedValue({ s2vConfig: { voiceSpeed: 1 } })
    const listConfigProfiles = vi.fn()
    const r = await resolveCollectionVideoStartSnapshot({
      profileId: '',
      pipelineId: 'story2video-compose',
      listConfigProfiles,
      readLastOptions,
    })
    expect(r).toEqual({ snapshot: { s2vConfig: { voiceSpeed: 1 } }, warningKey: '' })
    expect(readLastOptions).toHaveBeenCalledTimes(1)
    // 没选档案就不该去读配置库
    expect(listConfigProfiles).not.toHaveBeenCalled()
  })

  it('选了且可套用 ⇒ 用档案快照，且**不**读「上次选项」', async () => {
    const readLastOptions = vi.fn()
    const listConfigProfiles = vi.fn().mockResolvedValue({ code: 0, data: [PROFILE] })
    const r = await resolveCollectionVideoStartSnapshot({
      profileId: PROFILE.id,
      pipelineId: 'story2video-compose',
      listConfigProfiles,
      readLastOptions,
    })
    expect(r.snapshot).toBe(ORCHESTRATED_SNAPSHOT)
    expect(r.warningKey).toBe('')
    expect(readLastOptions).not.toHaveBeenCalled()
  })

  it('配置库载入失败（code != 0）⇒ 回退上次选项 + 提示，且不抛错', async () => {
    const readLastOptions = vi.fn().mockResolvedValue({ s2vConfig: {} })
    const listConfigProfiles = vi.fn().mockResolvedValue({ code: -1, message: 'boom' })
    const r = await resolveCollectionVideoStartSnapshot({
      profileId: PROFILE.id,
      pipelineId: 'story2video-compose',
      listConfigProfiles,
      readLastOptions,
    })
    expect(r.snapshot).toEqual({ s2vConfig: {} })
    expect(r.warningKey).toBe('create.story2video.configProfile.handoffLoadFailed')
  })

  it('配置库载入抛异常 ⇒ 同样回退 + 提示（异常不许冒泡成整次生成失败）', async () => {
    const readLastOptions = vi.fn().mockResolvedValue(null)
    const listConfigProfiles = vi.fn().mockRejectedValue(new Error('ipc down'))
    const r = await resolveCollectionVideoStartSnapshot({
      profileId: PROFILE.id,
      pipelineId: 'story2video-compose',
      listConfigProfiles,
      readLastOptions,
    })
    expect(r.snapshot).toBe(null)
    expect(r.warningKey).toBe('create.story2video.configProfile.handoffLoadFailed')
  })

  it('「上次选项」读取抛异常 ⇒ 快照为 null，不抛错（流水线走默认参数）', async () => {
    const readLastOptions = vi.fn().mockRejectedValue(new Error('no settings'))
    const r = await resolveCollectionVideoStartSnapshot({
      profileId: '',
      pipelineId: 'story2video-compose',
      listConfigProfiles: vi.fn(),
      readLastOptions,
    })
    expect(r).toEqual({ snapshot: null, warningKey: '' })
  })
})
