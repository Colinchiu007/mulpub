/**
 * useBgmLibrary composable 独立测试（拆分方案 v3 §2.3：新 composable 随实现同步写独立测试）
 *
 * 覆盖：CRUD 行为、浮层 owner 挂起/释放成对、删除选中项回退、deps 未注入 fail-closed、
 * 模块级单例复位。不经过 CreateView 壳，直接以 deps 注入驱动。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/publisher', () => ({
  story2videoBgmLibraryList: vi.fn(),
  story2videoBgmLibraryAdd: vi.fn(),
  story2videoBgmLibraryRename: vi.fn(),
  story2videoBgmLibraryDelete: vi.fn(),
  story2videoBgmLibraryStatus: vi.fn(),
}))
vi.mock('@/composables/useEmbeddedViewSuspension', () => ({
  suspendEmbeddedViewsForOverlay: vi.fn().mockResolvedValue(true),
  releaseEmbeddedViewsForOverlay: vi.fn().mockResolvedValue(true),
}))

import {
  bgmLibraryMethods,
  bgmLibraryRefs,
  setupBgmLibraryDeps,
  resetBgmLibraryForTest,
  BGM_LIBRARY_OVERLAY_OWNER,
  BGM_LIBRARY_DELETE_OVERLAY_OWNER,
} from './useBgmLibrary'
import { story2videoBgmLibraryList, story2videoBgmLibraryAdd, story2videoBgmLibraryDelete, story2videoBgmLibraryStatus } from '@/api/publisher'
import { suspendEmbeddedViewsForOverlay, releaseEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'

function makeDeps (overrides = {}) {
  const s2vConfig = { bgmPath: '' }
  return {
    s2vConfig,
    getS2vConfig: () => s2vConfig,
    showStory2VideoErrorDialog: vi.fn(),
    resolveMediaImportFailure: vi.fn((r, k) => ({ messageKey: 'story2video.media_invalid', messageParams: { kindLabel: k } })),
    validateStory2VideoFile: vi.fn(() => true),
    story2videoKindLabel: vi.fn(() => '背景音乐'),
    ...overrides,
  }
}

describe('useBgmLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBgmLibraryForTest()
    if (typeof window !== 'undefined') delete window.__bgmLibraryDeps
  })

  it('deps 未注入时 fail-closed（抛错而非静默）', async () => {
    await expect(bgmLibraryMethods.addFileToBgmLibrary({ name: 'a.mp3' })).rejects.toThrow('deps not injected')
  })

  it('openBgmLibraryDialog：挂起 owner + 加载列表', async () => {
    setupBgmLibraryDeps(makeDeps())
    story2videoBgmLibraryList.mockResolvedValue({ code: 0, data: [{ id: 'b1', name: 'x', path: 'C:/x.mp3' }] })
    await bgmLibraryMethods.openBgmLibraryDialog()
    expect(bgmLibraryRefs.s2vBgmLibraryDialogOpen.value).toBe(true)
    expect(suspendEmbeddedViewsForOverlay).toHaveBeenCalledWith(BGM_LIBRARY_OVERLAY_OWNER)
    expect(bgmLibraryRefs.s2vBgmLibrary.value).toHaveLength(1)
  })

  it('closeBgmLibraryDialog：释放素材库 owner + 级联关闭删除弹窗', async () => {
    setupBgmLibraryDeps(makeDeps())
    bgmLibraryRefs.s2vBgmLibraryDialogOpen.value = true
    bgmLibraryRefs.s2vBgmLibraryDeleteDialogOpen.value = true
    bgmLibraryMethods.closeBgmLibraryDialog()
    expect(bgmLibraryRefs.s2vBgmLibraryDialogOpen.value).toBe(false)
    expect(bgmLibraryRefs.s2vBgmLibraryDeleteDialogOpen.value).toBe(false)
    expect(releaseEmbeddedViewsForOverlay).toHaveBeenCalledWith(BGM_LIBRARY_OVERLAY_OWNER)
  })

  it('addFileToBgmLibrary 成功：入库并自动选中（写 s2vConfig.bgmPath）', async () => {
    const deps = makeDeps()
    setupBgmLibraryDeps(deps)
    story2videoBgmLibraryAdd.mockResolvedValue({ code: 0, data: { path: 'C:/new.mp3', name: 'new' } })
    story2videoBgmLibraryList.mockResolvedValue({ code: 0, data: [{ id: 'n1', name: 'new', path: 'C:/new.mp3' }] })
    const result = await bgmLibraryMethods.addFileToBgmLibrary({ name: 'new.mp3' })
    expect(result.path).toBe('C:/new.mp3')
    expect(deps.s2vConfig.bgmPath).toBe('C:/new.mp3')
  })

  it('addFileToBgmLibrary 主进程拒绝：清空配置 + 细分提示', async () => {
    const deps = makeDeps()
    setupBgmLibraryDeps(deps)
    story2videoBgmLibraryAdd.mockResolvedValue({ code: -1, message: '不支持的媒体格式' })
    const result = await bgmLibraryMethods.addFileToBgmLibrary({ name: 'bad.txt' })
    expect(result).toBeNull()
    expect(deps.s2vConfig.bgmPath).toBe('')
    expect(deps.resolveMediaImportFailure).toHaveBeenCalledWith({ code: -1, message: '不支持的媒体格式' }, '背景音乐')
  })

  it('confirmBgmDelete 删除当前选中项：回退为不使用背景音乐', async () => {
    const deps = makeDeps()
    deps.s2vConfig.bgmPath = 'C:/sel.mp3'
    setupBgmLibraryDeps(deps)
    bgmLibraryRefs.s2vBgmLibrary.value = [{ id: 's1', name: 'sel', path: 'C:/sel.mp3' }]
    bgmLibraryRefs.s2vBgmLibraryDeleteTargetId.value = 's1'
    story2videoBgmLibraryDelete.mockResolvedValue({ code: 0 })
    story2videoBgmLibraryList.mockResolvedValue({ code: 0, data: [] })
    await bgmLibraryMethods.confirmBgmDelete()
    expect(deps.s2vConfig.bgmPath).toBe('')
    expect(bgmLibraryRefs.s2vBgmLibraryDeleteDialogOpen.value).toBe(false)
  })

  it('requestBgmDelete：二级浮窗挂起独立 owner', () => {
    setupBgmLibraryDeps(makeDeps())
    bgmLibraryMethods.requestBgmDelete({ id: 'x1', name: 'x' })
    expect(bgmLibraryRefs.s2vBgmLibraryDeleteDialogOpen.value).toBe(true)
    expect(suspendEmbeddedViewsForOverlay).toHaveBeenCalledWith(BGM_LIBRARY_DELETE_OVERLAY_OWNER)
  })

  it('releaseAllOverlays：卸载兜底双 owner 都释放', async () => {
    await bgmLibraryMethods.releaseAllOverlays()
    expect(releaseEmbeddedViewsForOverlay).toHaveBeenCalledWith(BGM_LIBRARY_OVERLAY_OWNER)
    expect(releaseEmbeddedViewsForOverlay).toHaveBeenCalledWith(BGM_LIBRARY_DELETE_OVERLAY_OWNER)
  })

  it('resetBgmLibraryForTest：单例状态全量复位', () => {
    bgmLibraryRefs.s2vBgmLibrary.value = [{ id: 'a' }]
    bgmLibraryRefs.s2vBgmLibraryDialogOpen.value = true
    resetBgmLibraryForTest()
    expect(bgmLibraryRefs.s2vBgmLibrary.value).toHaveLength(0)
    expect(bgmLibraryRefs.s2vBgmLibraryDialogOpen.value).toBe(false)
  })
})

// 历史背景音乐状态机（s2v-bgm-legacy-repair）：
// 「未入库」必须细分为 可用 / 已丢失 / 不可用 / 未知，未知不得阻断（失败开放）。
describe('useBgmLibrary 历史路径核验与修复', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBgmLibraryForTest()
    if (typeof window !== 'undefined') delete window.__bgmLibraryDeps
  })

  function makeLegacyDeps (bgmPath = 'C:/old-import/legacy.mp3') {
    const deps = makeDeps()
    deps.s2vConfig.bgmPath = bgmPath
    setupBgmLibraryDeps(deps)
    return deps
  }

  const inspectData = (overrides = {}) => ({
    path: 'C:/old-import/legacy.mp3',
    exists: true,
    readable: true,
    size: 4,
    extension: '.mp3',
    inLibrary: false,
    libraryItemId: null,
    reason: 'ok',
    ...overrides,
  })

  it('可用未入库 → available（exists/readable 透传）', async () => {
    makeLegacyDeps()
    story2videoBgmLibraryStatus.mockResolvedValue({ code: 0, data: inspectData() })

    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')

    expect(story2videoBgmLibraryStatus).toHaveBeenCalledWith('C:/old-import/legacy.mp3')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value).toMatchObject({
      state: 'available',
      path: 'C:/old-import/legacy.mp3',
      reason: 'ok',
      exists: true,
    })
  })

  it('文件缺失 → missing；不可用原因 → unusable；通道失败 → unknown', async () => {
    makeLegacyDeps()

    story2videoBgmLibraryStatus.mockResolvedValueOnce({ code: 0, data: inspectData({ exists: false, readable: false, reason: 'missing' }) })
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('missing')

    story2videoBgmLibraryStatus.mockResolvedValueOnce({ code: 0, data: inspectData({ readable: false, reason: 'size_exceeded' }) })
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('unusable')

    story2videoBgmLibraryStatus.mockResolvedValueOnce({ code: -1, message: 'electronAPI not available' })
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('unknown')

    story2videoBgmLibraryStatus.mockRejectedValueOnce(new Error('boom'))
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('unknown')
  })

  it('请求代际：过期响应不得覆盖最新路径的状态', async () => {
    makeLegacyDeps()
    let resolveFirst
    story2videoBgmLibraryStatus
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ code: 0, data: inspectData({ path: 'C:/new.mp3', inLibrary: false }) })

    const first = bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/new.mp3')
    resolveFirst({ code: 0, data: inspectData({ exists: false, readable: false, reason: 'missing' }) })
    await first

    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value).toMatchObject({ state: 'available', path: 'C:/new.mp3' })
  })

  it('空路径 → idle 且不发请求', async () => {
    makeLegacyDeps()
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('   ')
    expect(story2videoBgmLibraryStatus).not.toHaveBeenCalled()
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('idle')
  })

  it('加入素材库成功：自动选中库内新路径并复位状态', async () => {
    const deps = makeLegacyDeps()
    story2videoBgmLibraryStatus.mockResolvedValue({ code: 0, data: inspectData() })
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')
    story2videoBgmLibraryAdd.mockResolvedValue({ code: 0, data: { id: 'b9', name: 'legacy', path: 'C:/lib/legacy.mp3' } })
    story2videoBgmLibraryList.mockResolvedValue({ code: 0, data: [{ id: 'b9', name: 'legacy', path: 'C:/lib/legacy.mp3' }] })

    const adopted = await bgmLibraryMethods.adoptLegacyBgmLibrary()

    expect(adopted.path).toBe('C:/lib/legacy.mp3')
    expect(story2videoBgmLibraryAdd).toHaveBeenCalledWith('C:/old-import/legacy.mp3')
    expect(deps.s2vConfig.bgmPath).toBe('C:/lib/legacy.mp3')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('idle')
    expect(bgmLibraryRefs.s2vBgmLibrary.value).toHaveLength(1)
  })

  it('加入素材库失败：不改写 bgmPath，走细分错误提示，状态保留可重试', async () => {
    const deps = makeLegacyDeps()
    story2videoBgmLibraryStatus.mockResolvedValue({ code: 0, data: inspectData() })
    await bgmLibraryMethods.verifyLegacyBgmLibraryPath('C:/old-import/legacy.mp3')
    story2videoBgmLibraryAdd.mockResolvedValue({ code: -1, message: '媒体文件不存在或不可读' })

    const adopted = await bgmLibraryMethods.adoptLegacyBgmLibrary()

    expect(adopted).toBeNull()
    expect(deps.s2vConfig.bgmPath).toBe('C:/old-import/legacy.mp3')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('available')
    expect(deps.resolveMediaImportFailure).toHaveBeenCalled()
  })

  it('清除选择：bgmPath 置空并复位状态', async () => {
    const deps = makeLegacyDeps()
    await bgmLibraryMethods.clearLegacyBgmLibrarySelection()
    expect(deps.s2vConfig.bgmPath).toBe('')
    expect(bgmLibraryRefs.s2vLegacyBgmStatus.value.state).toBe('idle')
  })
})
