// @ts-check
/**
 * apply-config-profile-handoff.test.js — 创作页套用「去发布」带来之配置档案的纯函数契约
 * （publish-config-picker，2026-10-21；QM-6 评审 i4 采纳后新增）
 *
 * 为什么要给这个模块单测：原先它把整个 Vue 实例当入参，模块内部出现
 * `host.$route` / `host.showS2VOptionsToast` 这类「宿主专属」调用 ⇒ 只能被 CreateView 用、
 * 也测不了（分支覆盖只能靠挂载整页）。改为**显式依赖 + 纯决策函数**后，
 * 四个分支（跳过 / 无流水线 / 已删除 / 跨流水线 / 可套用）在这里穷举。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  applyConfigProfileFromRoute,
  resolveConfigProfileTarget,
} from './apply-config-profile-handoff'

const profile = (overrides = {}) => ({
  id: 'profile-000000000001',
  name: '口播竖屏',
  pipelineId: 'story2video-compose',
  snapshot: { schemaVersion: 1 },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...overrides,
})

describe('resolveConfigProfileTarget', () => {
  it('没有带配置 id ⇒ 跳过（不是错误，不提示）', () => {
    expect(resolveConfigProfileTarget({ profileId: '', pipelineId: 'story2video-compose' }).status).toBe('skipped')
    expect(resolveConfigProfileTarget({ profileId: '   ', pipelineId: 'story2video-compose' }).status).toBe('skipped')
    expect(resolveConfigProfileTarget({}).status).toBe('skipped')
  })

  it('没有选中流水线 ⇒ no-pipeline（无从判断配置归属）', () => {
    const r = resolveConfigProfileTarget({ profileId: 'profile-000000000001', pipelineId: '' })
    expect(r.status).toBe('no-pipeline')
  })

  it('库里有 ⇒ apply 并带回档案', () => {
    const target = profile()
    const r = resolveConfigProfileTarget({
      profileId: target.id,
      pipelineId: 'story2video-compose',
      profiles: [target],
    })
    expect(r.status).toBe('apply')
    expect(r.profile).toBe(target)
  })

  it('库里没有 ⇒ not-found（配置被删）', () => {
    const r = resolveConfigProfileTarget({
      profileId: 'profile-000000000009',
      pipelineId: 'story2video-compose',
      profiles: [profile()],
    })
    expect(r.status).toBe('not-found')
  })

  it('配置属于别的流水线 ⇒ wrong-pipeline（跨流水线套用是错误语义）', () => {
    const r = resolveConfigProfileTarget({
      profileId: 'profile-000000000001',
      pipelineId: 'story2video-compose',
      profiles: [profile({ pipelineId: 'video-clone' })],
    })
    expect(r.status).toBe('wrong-pipeline')
  })
})

describe('applyConfigProfileFromRoute', () => {
  function makeDeps (overrides = {}) {
    return {
      profileId: 'profile-000000000001',
      pipelineId: 'story2video-compose',
      profiles: [profile()],
      loadProfiles: vi.fn(),
      applySnapshot: vi.fn().mockResolvedValue(true),
      setActiveProfile: vi.fn(),
      showToast: vi.fn(),
      awaitRestore: vi.fn(),
      ...overrides,
    }
  }

  it('套用成功 ⇒ 记录已应用配置名并提示「已应用配置」', async () => {
    const deps = makeDeps()
    expect(await applyConfigProfileFromRoute(deps)).toBe(true)
    expect(deps.applySnapshot).toHaveBeenCalledTimes(1)
    expect(deps.setActiveProfile).toHaveBeenCalledWith('口播竖屏')
    expect(deps.showToast).toHaveBeenCalledWith('create.story2video.configProfile.applied')
  })

  it('未带配置 id ⇒ 直接返回，不提示、不读库、不套用', async () => {
    const deps = makeDeps({ profileId: '' })
    expect(await applyConfigProfileFromRoute(deps)).toBe(false)
    expect(deps.showToast).not.toHaveBeenCalled()
    expect(deps.loadProfiles).not.toHaveBeenCalled()
    expect(deps.applySnapshot).not.toHaveBeenCalled()
  })

  it('列表为空时先载入配置库再套用（且必须**载入后重新取**列表）', async () => {
    // 回归锁：宿主载入配置库时是**整体替换**数组（不是原地 push），
    // 所以模块若在调用前抓一次快照，载入后拿到的仍是旧数组 ⇒ 配置被判「已删除」。
    let store = []
    const deps = makeDeps({
      profiles: [],
      getProfiles: () => store,
      loadProfiles: vi.fn(async () => { store = [profile()] }),
    })
    expect(await applyConfigProfileFromRoute(deps)).toBe(true)
    expect(deps.loadProfiles).toHaveBeenCalledTimes(1)
    expect(deps.applySnapshot).toHaveBeenCalledTimes(1)
  })

  it('配置已删除 ⇒ 提示 notFound 且不套用', async () => {
    const deps = makeDeps({ profiles: [] })
    expect(await applyConfigProfileFromRoute(deps)).toBe(false)
    expect(deps.showToast).toHaveBeenCalledWith('create.story2video.configProfile.notFound', 2600)
    expect(deps.applySnapshot).not.toHaveBeenCalled()
  })

  it('跨流水线 ⇒ 提示 wrongPipeline 且不套用', async () => {
    const deps = makeDeps({ profiles: [profile({ pipelineId: 'video-clone' })] })
    expect(await applyConfigProfileFromRoute(deps)).toBe(false)
    expect(deps.showToast).toHaveBeenCalledWith('create.story2video.configProfile.wrongPipeline', 2600)
    expect(deps.applySnapshot).not.toHaveBeenCalled()
  })

  it('没有选中流水线 ⇒ 提示 pipelineUnresolved 且不套用', async () => {
    const deps = makeDeps({ pipelineId: '' })
    expect(await applyConfigProfileFromRoute(deps)).toBe(false)
    expect(deps.showToast).toHaveBeenCalledWith('create.story2video.configProfile.pipelineUnresolved', 2600)
    expect(deps.applySnapshot).not.toHaveBeenCalled()
  })

  it('套用执行失败 ⇒ 提示 applyFailed（不阻断创作）', async () => {
    const deps = makeDeps({ applySnapshot: vi.fn().mockResolvedValue(false) })
    expect(await applyConfigProfileFromRoute(deps)).toBe(false)
    expect(deps.showToast).toHaveBeenCalledWith('create.story2video.configProfile.applyFailed', 2600)
  })

  it('先等「恢复上次选项」跑完再套用（配置档案后写 ⇒ 必胜）', async () => {
    const order = []
    const deps = makeDeps({
      awaitRestore: vi.fn(() => Promise.resolve().then(() => { order.push('restore') })),
      applySnapshot: vi.fn(async () => { order.push('apply'); return true }),
    })
    await applyConfigProfileFromRoute(deps)
    expect(order).toEqual(['restore', 'apply'])
  })

  it('恢复失败不阻断配置套用', async () => {
    const deps = makeDeps({ awaitRestore: vi.fn(() => Promise.reject(new Error('restore boom'))) })
    expect(await applyConfigProfileFromRoute(deps)).toBe(true)
    expect(deps.applySnapshot).toHaveBeenCalledTimes(1)
  })

  // QM-6 round 3 i3：恢复失败**不再全静默**——宿主可传 onRestoreError 承接，
  // 让「上次选项没恢复上」对用户可见（否则用户只看到默认值没生效，无从知道原因）
  it('恢复失败时调用 onRestoreError（且仍不阻断配置套用）', async () => {
    const boom = new Error('restore boom')
    const onRestoreError = vi.fn()
    const deps = makeDeps({
      awaitRestore: vi.fn(() => Promise.reject(boom)),
      onRestoreError,
    })
    expect(await applyConfigProfileFromRoute(deps)).toBe(true)
    expect(onRestoreError).toHaveBeenCalledWith(boom)
    expect(deps.applySnapshot).toHaveBeenCalledTimes(1)
  })

  it('宿主未提供 onRestoreError 时也不抛异常（可选依赖）', async () => {
    const deps = makeDeps({ awaitRestore: vi.fn(() => Promise.reject(new Error('restore boom'))) })
    await expect(applyConfigProfileFromRoute(deps)).resolves.toBe(true)
  })

  // QM-6 round 2 i2：载入配置库抛错时必须被吞掉并给出**独立**提示，
  // 不能变成 mounted 链里的未捕获拒绝，也不能伪装成「配置不存在」。
  it('载入配置库失败 ⇒ 不抛异常、提示 handoffLoadFailed、不套用', async () => {
    const deps = makeDeps({
      profiles: [],
      getProfiles: () => [],
      loadProfiles: vi.fn(async () => { throw new Error('load boom') }),
    })
    await expect(applyConfigProfileFromRoute(deps)).resolves.toBe(false)
    expect(deps.showToast).toHaveBeenCalledWith('create.story2video.configProfile.handoffLoadFailed', 2600)
    expect(deps.applySnapshot).not.toHaveBeenCalled()
  })
})
