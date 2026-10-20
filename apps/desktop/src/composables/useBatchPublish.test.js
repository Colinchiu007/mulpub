// @ts-check
/**
 * useBatchPublish.test.js — 批量发布 composable 测试（Phase 4.3 TDD）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

const {
  mockBatchCreate,
  mockRetryTask,
  mockOnProgress,
  mockElMessage,
  mockElMessageBox,
  mockEnsureLogin,
} = vi.hoisted(function () {
  return {
    mockBatchCreate: vi.fn(),
    mockRetryTask: vi.fn(),
    mockOnProgress: vi.fn(function () { return vi.fn() }),
    mockElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
    mockElMessageBox: { confirm: vi.fn() },
    // 主动操作登录门：默认直接放行（登录门行为由 useLoginGate.test.js 覆盖）
    mockEnsureLogin: vi.fn(async () => true),
  }
})

vi.mock('@/composables/useLoginGate', function () {
  return {
    useLoginGate: () => ({
      ensureLogin: mockEnsureLogin,
      requireLogin: vi.fn(async (fn) => fn()),
      openSignIn: vi.fn(async () => true),
    }),
  }
})

vi.mock('@/api/publisher', function () {
  return {
    batchCreate: mockBatchCreate,
    retryTask: mockRetryTask,
    onProgress: mockOnProgress,
    batchExecute: (...args) => window.electronAPI?.batchExecute?.(...args),
    batchSchedule: (...args) => window.electronAPI?.batchSchedule?.(...args),
    batchCancel: (...args) => window.electronAPI?.batchCancel?.(...args),
    batchGet: (...args) => window.electronAPI?.batchGet?.(...args),
    onBatchProgress: (callback) => window.electronAPI?.onBatchProgress?.(callback),
    // 其他 API 不用，但需要导出避免 import 错误
    publishBatch: vi.fn(),
    sensitiveCheck: vi.fn(),
    storeGetSetting: vi.fn(),
    // 离线检测与单篇对齐：走 window.electronAPI 转发，测试可控制（原为死 mock 无法控制）
    offlineStatus: (...args) => window.electronAPI?.offlineStatus?.(...args),
    offlineAddToCache: (...args) => window.electronAPI?.offlineAddToCache?.(...args),
  }
})

vi.mock('element-plus', function () {
  return {
    ElMessage: mockElMessage,
    ElMessageBox: mockElMessageBox,
  }
})

// publish-progress-ux：全局进度 store mock（reactive 使 composable 可读 sessions）
const mockRegisterSession = vi.hoisted(() => vi.fn())
vi.mock('@/stores/publishProgress', async () => {
  const { reactive } = await import('vue')
  const store = reactive({
    sessions: [],
    panelVisible: false,
    panelMinimized: false,
    registerSession: mockRegisterSession,
  })
  return { usePublishProgressStore: () => store }
})

import { reactive } from 'vue'
import { useBatchPublish, selectHandoffPresetPlatforms } from '../composables/useBatchPublish'
// 与被测校验 validatePlatformContent 同源的上限读取（单一真源）：
// 超限测试数据从注册表实时推导（limit+1），平台上限调整时测试不再漂移
import { getPlatformContentLimit } from '../features/publish/publish-contract'

function futurePublishTime (minutes = 10) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

describe('useBatchPublish — composable setup', () => {
  let originalElectronAPI
  let article
  let licenseStore

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    vi.clearAllMocks()
    article = reactive({ title: '', content: '' })
    licenseStore = { isPro: true }
    window.electronAPI = {
      batchSchedule: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
      batchExecute: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
      onBatchProgress: vi.fn(function () { return vi.fn() }),
      // 默认在线：现有用例不受离线分支影响（离线用例自行覆写）
      offlineStatus: vi.fn(function () { return Promise.resolve({ code: 0, data: { offline: false } }) }),
      offlineAddToCache: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    window.electronAPI = originalElectronAPI
  })

  it('返回响应式状态和方法', () => {
    const r = useBatchPublish({ article, licenseStore })
    expect(r.batchMode).toBeDefined()
    expect(r.batchPublishing).toBeDefined()
    expect(r.articles).toBeDefined()
    expect(r.batchProgress).toBeDefined()
    expect(r.templateTargetIdx).toBeDefined()
    expect(r.showTemplatePicker).toBeDefined()
    expect(r.precheckEnabled).toBeDefined()
    expect(r.batchDone).toBeDefined()
    expect(r.batchFail).toBeDefined()
    expect(r.totalPlatformTasks).toBeDefined()
    expect(r.failedBatchTasks).toBeDefined()
    expect(r.retryingFailed).toBeDefined()
    expect(typeof r.addArticle).toBe('function')
    expect(typeof r.removeArticle).toBe('function')
    expect(typeof r.duplicateArticle).toBe('function')
    expect(typeof r.handleBatchPublish).toBe('function')
    expect(typeof r.retryFailedBatch).toBe('function')
    expect(typeof r.applyTemplate).toBe('function')
    expect(typeof r.checkBatchAccess).toBe('function')
    expect(typeof r.toggleBatchAccount).toBe('function')
    expect(typeof r.isBatchAccountSelected).toBe('function')
  })

  it('初始状态', () => {
    const r = useBatchPublish({ article, licenseStore })
    expect(r.batchMode.value).toBe(false)
    expect(r.batchPublishing.value).toBe(false)
    expect(r.articles.value).toEqual([])
    expect(r.batchProgress.value).toEqual([])
    expect(r.templateTargetIdx.value).toBe(-1)
    expect(r.showTemplatePicker.value).toBe(false)
    expect(r.precheckEnabled.value).toBe(false)
    expect(r.batchDone.value).toBe(0)
    expect(r.batchFail.value).toBe(0)
    expect(r.totalPlatformTasks.value).toBe(0)
    expect(r.failedBatchTasks.value).toEqual([])
    expect(r.retryingFailed.value).toBe(false)
  })

  // ─── addArticle / removeArticle / duplicateArticle ────
  it('addArticle 添加空文章', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    expect(r.articles.value).toHaveLength(1)
    expect(r.articles.value[0].title).toBe('')
    expect(r.articles.value[0].content).toBe('')
    expect(r.articles.value[0].platforms).toEqual([])
    expect(r.articles.value[0]._key).toBeTruthy()
  })

  it('addArticle 多次添加生成不同 _key', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    r.addArticle()
    expect(r.articles.value).toHaveLength(2)
    expect(r.articles.value[0]._key).not.toBe(r.articles.value[1]._key)
  })

  it('removeArticle 按索引删除', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    r.addArticle()
    r.removeArticle(0)
    expect(r.articles.value).toHaveLength(1)
  })

  it('removeArticle 越界不报错', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    expect(function () { r.removeArticle(999) }).not.toThrow()
    expect(r.articles.value).toHaveLength(1)
  })

  it('duplicateArticle 复制文章', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    r.articles.value[0].title = '原标题'
    r.duplicateArticle(0)
    expect(r.articles.value).toHaveLength(2)
    expect(r.articles.value[1].title).toBe('原标题 (复制)')
    expect(r.articles.value[1]._key).not.toBe(r.articles.value[0]._key)
  })

  it('duplicateArticle publishTime 清空', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    r.articles.value[0].publishTime = futurePublishTime()
    r.duplicateArticle(0)
    expect(r.articles.value[1].publishTime).toBe('')
  })

  it('批量文章账号选择支持多选和再次点击取消', () => {
    const r = useBatchPublish({ article, licenseStore })
    const item = { accounts: { wechat_mp: ['wx-a'] } }

    r.toggleBatchAccount(item, 'wechat_mp', 'wx-b')
    expect(item.accounts.wechat_mp).toEqual(['wx-a', 'wx-b'])
    expect(r.isBatchAccountSelected(item, 'wechat_mp', 'wx-b')).toBe(true)

    r.toggleBatchAccount(item, 'wechat_mp', 'wx-a')
    expect(item.accounts.wechat_mp).toEqual(['wx-b'])
    expect(r.isBatchAccountSelected(item, 'wechat_mp', 'wx-a')).toBe(false)
  })

  // ─── batchDone / batchFail / totalPlatformTasks ────
  it('batchDone 统计成功数量', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.batchProgress.value = [
      { type: 'success' }, { type: 'danger' }, { type: 'success' },
    ]
    expect(r.batchDone.value).toBe(2)
  })

  it('batchFail 统计失败数量', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.batchProgress.value = [
      { type: 'success' }, { type: 'danger' }, { type: 'danger' },
    ]
    expect(r.batchFail.value).toBe(2)
  })

  it('totalPlatformTasks 统计所有文章平台数', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [
      { platforms: ['wx', 'zhihu'] },
      { platforms: ['douyin'] },
    ]
    expect(r.totalPlatformTasks.value).toBe(3)
  })

  it('totalPlatformTasks 无 platforms 视为 0', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{}, { platforms: ['wx'] }]
    expect(r.totalPlatformTasks.value).toBe(1)
  })

  it('totalPlatformTasks 按平台账号目标展开', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      platforms: ['wechat_mp', 'zhihu'],
      accounts: { wechat_mp: ['wx-a', 'wx-b'], zhihu: ['zh-a'] },
    }]
    expect(r.totalPlatformTasks.value).toBe(3)
  })

  // ─── applyTemplate ────────────────────────────
  it('applyTemplate 单篇模式（batchMode=false）填充 article', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.applyTemplate({ title: 'T', content: 'C' })
    expect(article.title).toBe('T')
    expect(article.content).toBe('C')
  })

  it('applyTemplate 批量模式填充指定文章', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    r.addArticle()
    r.templateTargetIdx.value = 0
    r.applyTemplate({ title: '批量T', content: '批量C' })
    expect(r.articles.value[0].title).toBe('批量T')
    expect(r.articles.value[0].content).toBe('批量C')
  })

  it('applyTemplate 批量模式关闭模板选择器', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.showTemplatePicker.value = true
    r.applyTemplate({ title: 'T', content: 'C' })
    expect(r.showTemplatePicker.value).toBe(false)
  })

  // ─── checkBatchAccess ────────────────────────
  it('checkBatchAccess 非 Pro 用户禁止批量模式', () => {
    licenseStore.isPro = false
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(false)
  })

  it('checkBatchAccess Pro 用户允许批量模式', () => {
    licenseStore.isPro = true
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(true)
  })

  it('checkBatchAccess batchMode=false 时不检查', () => {
    licenseStore.isPro = false
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = false
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(false)
  })

  // ─── watch batchMode ─────────────────────────
  it('batchMode 切换为 true 时自动 addArticle（articles 为空）', async () => {
    const r = useBatchPublish({ article, licenseStore })
    expect(r.articles.value).toHaveLength(0)
    r.batchMode.value = true
    await nextTick()
    expect(r.articles.value).toHaveLength(1)
  })

  it('batchMode 切换为 true 时 articles 非空不自动添加', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    r.batchMode.value = true
    await nextTick()
    expect(r.articles.value).toHaveLength(1)
  })

  it('校验期间发生重入时只执行一次校验，并在结束后释放锁', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '', content: '正文', platforms: ['wechat_mp'] }]
    let nestedPublish
    mockElMessage.warning.mockImplementationOnce(function () {
      expect(r.batchPublishing.value).toBe(true)
      nestedPublish = r.handleBatchPublish()
    })

    await r.handleBatchPublish()
    await nestedPublish

    expect(mockElMessage.warning).toHaveBeenCalledTimes(1)
    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(r.batchPublishing.value).toBe(false)
  })

  it('发布前展示任务数确认，取消后不创建批次', async () => {
    mockElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp', 'zhihu'] }]

    await r.handleBatchPublish()

    expect(mockElMessageBox.confirm).toHaveBeenCalledWith(
      '即将发布 1 篇内容，共 2 个平台账号任务。请确认各平台表单信息完整。',
      '确认批量发布',
      expect.objectContaining({ confirmButtonText: '确认发布', cancelButtonText: '取消' }),
    )
    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(r.batchPublishing.value).toBe(false)
  })

  it('从创建挂起到批次终态期间始终忽略重复发布', async () => {
    let resolveCreate
    let emitBatchProgress
    mockBatchCreate.mockImplementationOnce(function () {
      return new Promise(function (resolve) { resolveCreate = resolve })
    })
    window.electronAPI.onBatchProgress.mockImplementationOnce(function (callback) {
      emitBatchProgress = callback
      return vi.fn()
    })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    const firstPublish = r.handleBatchPublish()
    // 主动操作登录门与离线检测均为异步：等待到 batchCreate 真正被调用再断言，
    // 不数 microtask 拍数（离线检测的引入会改变拍数，数拍数的断言是脆的）。
    await vi.waitFor(function () {
      expect(mockBatchCreate).toHaveBeenCalledTimes(1)
    })
    expect(r.batchPublishing.value).toBe(true)
    const secondPublish = r.handleBatchPublish()
    await secondPublish

    expect(mockBatchCreate).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.batchExecute).not.toHaveBeenCalled()

    resolveCreate({ code: 0, data: { id: 'batch1' } })
    await firstPublish

    expect(window.electronAPI.batchExecute).toHaveBeenCalledTimes(1)
    expect(r.batchPublishing.value).toBe(true)

    await r.handleBatchPublish()
    expect(mockBatchCreate).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.batchExecute).toHaveBeenCalledTimes(1)

    emitBatchProgress({
      kind: 'batch-complete',
      batchId: 'batch1',
      total: 1,
      completed: 1,
      succeeded: 1,
      failed: 0,
    })
    expect(r.batchPublishing.value).toBe(false)
  })

  it.each([
    {
      name: '创建业务失败',
      arrange: function () {
        mockBatchCreate.mockResolvedValueOnce({ code: 1, message: '创建失败' })
      },
    },
    {
      name: '执行业务失败',
      arrange: function () {
        mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
        window.electronAPI.batchExecute.mockResolvedValueOnce({ code: 1, message: '执行失败' })
      },
    },
    {
      name: '同步异常',
      arrange: function () {
        mockOnProgress.mockImplementationOnce(function () { throw new Error('同步异常') })
      },
    },
  ])('$name 后释放批量执行锁', async ({ arrange }) => {
    arrange()
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(r.batchPublishing.value).toBe(false)
  })
  it('publish-progress-ux：batchExecute 成功后登记全局会话（batchId 归属），不再订阅页面级 onProgress', async () => {
    // 旧缺陷：阶段级本地监听在 finally 无条件注销，而批次任务此后才真正执行——
    // 阶段事件本就无人接收（死代码）。新契约：全局 store 承载，页面零阶段订阅。
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(mockRegisterSession).toHaveBeenCalledTimes(1)
    expect(mockRegisterSession).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch1' }))
    expect(mockOnProgress).not.toHaveBeenCalled()
  })
  it('batch-complete 事件到达后解除发布锁（终态解锁不依赖已删除的阶段订阅清理）', async () => {
    let emitBatchProgress
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockImplementationOnce(function (callback) {
      emitBatchProgress = callback
      return vi.fn()
    })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await expect(r.handleBatchPublish()).resolves.toBeUndefined()

    expect(r.batchPublishing.value).toBe(true)
    emitBatchProgress({
      kind: 'batch-complete',
      batchId: 'batch1',
      total: 1,
      completed: 1,
      succeeded: 1,
      failed: 0,
    })

    expect(r.batchPublishing.value).toBe(false)
  })
  // ─── handleBatchPublish ──────────────────────
  it('handleBatchPublish 文章缺标题时警告', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    await nextTick()
    r.addArticle()
    // 文章无标题
    await r.handleBatchPublish()
    expect(mockElMessage.warning).toHaveBeenCalled()
  })

  it('handleBatchPublish 文章缺正文时警告', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    await nextTick()
    r.addArticle()
    r.articles.value[0].title = '有标题'
    await r.handleBatchPublish()
    expect(mockElMessage.warning).toHaveBeenCalled()
  })

  it('handleBatchPublish 文章缺平台时警告', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    await nextTick()
    r.addArticle()
    r.articles.value[0].title = '标题'
    r.articles.value[0].content = '正文'
    await r.handleBatchPublish()
    expect(mockElMessage.warning).toHaveBeenCalled()
  })

  it('批量文章引用已失效账号时在创建批次前阻止发布', async () => {
    const r = useBatchPublish({ article, licenseStore, isAccountAvailable: () => false })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['wechat_mp'],
      accounts: { wechat_mp: ['deleted-account'] },
    }]

    await r.handleBatchPublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: '批量文章中有账号已失效，请重新选择发布账号' }))
    expect(mockElMessageBox.confirm).not.toHaveBeenCalled()
    expect(mockBatchCreate).not.toHaveBeenCalled()
  })

  it('handleBatchPublish 成功创建批量任务（无定时）', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.batchExecute.mockResolvedValueOnce({ code: 0 })
    window.electronAPI.onBatchProgress.mockReturnValueOnce(function () {})
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    await nextTick()
    // watch batchMode=true 已自动 addArticle
    r.articles.value[0].title = '标题'
    r.articles.value[0].content = '正文'
    r.articles.value[0].platforms = ['wechat_mp']
    await r.handleBatchPublish()
    expect(mockBatchCreate).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.batchExecute).toHaveBeenCalledWith('batch1')
    expect(r.batchProgress.value.length).toBeGreaterThan(0)
  })

  it('handleBatchPublish 有定时时调用 batchSchedule', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.batchSchedule.mockResolvedValueOnce({ code: 0 })
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    await nextTick()
    r.articles.value[0].title = '标题'
    r.articles.value[0].content = '正文'
    r.articles.value[0].platforms = ['toutiao']
    r.articles.value[0].publishTime = futurePublishTime()
    await r.handleBatchPublish()
    expect(window.electronAPI.batchSchedule).toHaveBeenCalledWith('batch1')
  })

  it('排期接口返回业务失败时显示后端消息且不提示已排期', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.batchSchedule.mockResolvedValueOnce({
      code: -1,
      message: '排期失败：任务不存在',
    })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['toutiao'],
      publishTime: futurePublishTime(),
    }]

    await r.handleBatchPublish()

    expect(r.batchProgress.value.at(-1)).toMatchObject({ type: 'danger' })
    expect(r.batchProgress.value.at(-1).text).toContain('排期失败：任务不存在')
    expect(r.batchProgress.value.some(function (item) { return item.text.includes('已排期') })).toBe(false)
  })

  it('handleBatchPublish batchCreate 失败时记录错误', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 1, message: '创建失败' })
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    await nextTick()
    r.articles.value[0].title = '标题'
    r.articles.value[0].content = '正文'
    r.articles.value[0].platforms = ['wechat_mp']
    await r.handleBatchPublish()
    expect(r.batchProgress.value.some(function (p) { return p.type === 'danger' })).toBe(true)
  })

  it('handleBatchPublish batchCreate 抛错时记录错误', async () => {
    mockBatchCreate.mockRejectedValueOnce(new Error('网络错误'))
    const r = useBatchPublish({ article, licenseStore })
    r.batchMode.value = true
    await nextTick()
    r.articles.value[0].title = '标题'
    r.articles.value[0].content = '正文'
    r.articles.value[0].platforms = ['wechat_mp']
    await r.handleBatchPublish()
    expect(r.batchProgress.value.some(function (p) { return p.type === 'danger' })).toBe(true)
  })

  it('空白标题会被拦截且不会创建批次', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '  ', content: '正文', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: '有文章缺少标题' }))
    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(mockOnProgress).not.toHaveBeenCalled()
  })

  it('空白正文会被拦截且不会创建批次', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '\n  ', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: '有文章缺少正文' }))
    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(mockOnProgress).not.toHaveBeenCalled()
  })

  it('创建批次时精确透传文章、排期和预检配置', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    const r = useBatchPublish({ article, licenseStore })
    r.precheckEnabled.value = true
    const publishTime = futurePublishTime()
    r.articles.value = [{
      _key: 'ui-only',
      title: '标题',
      content: '正文',
      platforms: ['toutiao'],
      publishTime,
    }]

    await r.handleBatchPublish()

    expect(mockBatchCreate).toHaveBeenCalledTimes(1)
    // P2-7：键集与单篇 buildArticleData 同口径——封面/图片/标签/话题/@好友 一律
    // 「有值才挂键」（此前恒发空数组/空串，与单篇形状不一致）；新增
    // contentFormat / platformOverrides 两键（visibilitySemantic 有值才挂）。
    expect(mockBatchCreate.mock.calls[0][0].articles).toEqual([{
      title: '标题',
      content: '正文',
      contentFormat: 'html',
      platformOverrides: {},
      platforms: ['toutiao'],
      publishTime,
      precheck: true,
      author: '',
      cover_url: '',
      video_path: '',
      // P0-2：批量 payload 含 AI 声明（fail-safe 默认 true）
      aiGenerated: true,
    }])
    expect(window.electronAPI.batchSchedule).toHaveBeenCalledWith('batch1')
    expect(window.electronAPI.batchExecute).not.toHaveBeenCalled()
  })

  it('创建批次时透传多账号目标', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['toutiao'],
      accounts: { toutiao: ['wx-a', 'wx-b'] },
      publishTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }]

    await r.handleBatchPublish()

    expect(mockBatchCreate.mock.calls[0][0].articles[0].platforms).toEqual([
      { platform: 'toutiao', accountId: 'wx-a' },
      { platform: 'toutiao', accountId: 'wx-b' },
    ])
  })

  it('创建批次时传入 IPC 的嵌套文章数据可结构化克隆', async () => {
    mockBatchCreate.mockImplementationOnce(async function (payload) {
      expect(function () { structuredClone(payload) }).not.toThrow()
      return { code: 0, data: { id: 'batch1' } }
    })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['toutiao'],
      publishTime: futurePublishTime(),
    }]

    await r.handleBatchPublish()

    expect(mockBatchCreate).toHaveBeenCalledTimes(1)
  })

  it('批次响应缺少 data 时记录失败（publish-progress-ux：阶段订阅已删除，无页面级订阅可释放）', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 0 })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await expect(r.handleBatchPublish()).resolves.toBeUndefined()

    expect(r.batchProgress.value.at(-1)).toMatchObject({ type: 'danger' })
    expect(r.batchProgress.value.at(-1).text).toContain('批量发布失败')
    expect(mockOnProgress).not.toHaveBeenCalled()
  })

  it('Electron API 缺失时记录失败而不是向调用方抛错', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI = undefined
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await expect(r.handleBatchPublish()).resolves.toBeUndefined()

    expect(r.batchProgress.value.at(-1)).toMatchObject({ type: 'danger' })
    expect(r.batchProgress.value.at(-1).text).toContain('批量发布失败')
  })

  it('执行批次失败时记录错误并释放批量进度订阅（阶段订阅已删除）', async () => {
    const unsubscribeBatch = vi.fn()
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockReturnValueOnce(unsubscribeBatch)
    window.electronAPI.batchExecute.mockRejectedValueOnce(new Error('执行失败'))
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(r.batchProgress.value.at(-1)).toMatchObject({ type: 'danger' })
    expect(r.batchProgress.value.at(-1).text).toContain('执行失败')
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1)
    expect(mockOnProgress).not.toHaveBeenCalled()
  })

  it('执行接口返回业务失败时显示后端消息、不提示提交成功并释放批量订阅', async () => {
    const unsubscribeBatch = vi.fn()
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockReturnValueOnce(unsubscribeBatch)
    window.electronAPI.batchExecute.mockResolvedValueOnce({
      code: 1,
      message: '执行失败：账号未登录',
    })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(r.batchProgress.value.at(-1)).toMatchObject({ type: 'danger' })
    // 「未登录」类错误经统一文案映射为「原因 + 建议」，不再直出后端拼接文本
    expect(r.batchProgress.value.at(-1).text).not.toContain('执行失败：账号未登录')
    expect(r.batchProgress.value.at(-1).text).toContain('登录')
    expect(r.batchProgress.value.some(function (item) { return item.text.includes('已提交发布') })).toBe(false)
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1)
  })

  it('批次进度同时映射成功和失败事件', async () => {
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockImplementationOnce(function (callback) {
      callback({ ok: true, platform: 'wechat_mp', title: '成功文章', message: '' })
      callback({ ok: false, platform: 'zhihu', title: '失败文章', message: '未登录' })
      return vi.fn()
    })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(r.batchDone.value).toBe(1)
    expect(r.batchFail.value).toBe(1)
    expect(r.batchProgress.value.some(function (p) { return p.text.includes('未登录') })).toBe(true)
  })

  it('批次提交后持续接收异步进度，并在部分失败时汇总后释放订阅', async () => {
    const unsubscribeBatch = vi.fn()
    let emitBatchProgress
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockImplementationOnce(function (callback) {
      emitBatchProgress = callback
      return unsubscribeBatch
    })
    window.electronAPI.batchExecute.mockResolvedValueOnce({ code: 0 })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['wechat_mp', 'zhihu'],
    }]

    await r.handleBatchPublish()

    expect(unsubscribeBatch).not.toHaveBeenCalled()
    emitBatchProgress({ batchId: 'batch1', ok: true, platform: 'wechat_mp', title: '标题' })
    expect(unsubscribeBatch).not.toHaveBeenCalled()
    emitBatchProgress({ batchId: 'batch1', ok: false, platform: 'zhihu', title: '标题', message: '账号未登录' })

    expect(r.batchDone.value).toBe(1)
    expect(r.batchFail.value).toBe(1)
    expect(mockElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: '批量发布完成：1 个成功，1 个失败' }))
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1)
  })

  it('记录可重试的失败任务并重新加入发布队列', async () => {
    let emitBatchProgress
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockImplementationOnce(function (callback) {
      emitBatchProgress = callback
      return vi.fn()
    })
    window.electronAPI.batchExecute.mockResolvedValueOnce({ code: 0 })
    mockRetryTask.mockResolvedValueOnce({ code: 0, data: { taskId: 'retry-1', retryOf: 'failed-1' } })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['zhihu'] }]

    await r.handleBatchPublish()
    emitBatchProgress({
      batchId: 'batch1',
      taskId: 'failed-1',
      ok: false,
      platform: 'zhihu',
      title: '标题',
      message: '账号未登录',
    })

    expect(r.failedBatchTasks.value).toEqual([{
      taskId: 'failed-1',
      platform: 'zhihu',
      title: '标题',
    }])

    await r.retryFailedBatch()

    expect(mockRetryTask).toHaveBeenCalledWith('failed-1')
    expect(r.failedBatchTasks.value).toEqual([])
    expect(mockElMessage.success).toHaveBeenCalledWith(expect.objectContaining({ message: '已重新提交 1 个失败任务' }))
  })

  it('全部任务失败时显示明确错误汇总，并忽略其他批次事件', async () => {
    const unsubscribeBatch = vi.fn()
    let emitBatchProgress
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockImplementationOnce(function (callback) {
      emitBatchProgress = callback
      return unsubscribeBatch
    })
    window.electronAPI.batchExecute.mockResolvedValueOnce({ code: 0 })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['wechat_mp', 'zhihu'],
    }]

    await r.handleBatchPublish()
    emitBatchProgress({ batchId: 'other-batch', ok: false, platform: 'wechat_mp', title: '其他任务', message: '失败' })
    expect(r.batchFail.value).toBe(0)

    emitBatchProgress({ batchId: 'batch1', ok: false, platform: 'wechat_mp', title: '标题', message: '超时' })
    emitBatchProgress({ batchId: 'batch1', ok: false, platform: 'zhihu', title: '标题', message: '账号未登录' })

    expect(r.batchDone.value).toBe(0)
    expect(r.batchFail.value).toBe(2)
    expect(mockElMessage.error).toHaveBeenCalledWith(expect.objectContaining({ message: '批量发布失败：2 个任务全部失败' }))
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1)
  })

  it('收到 batch-complete 后以批次终态计数汇总并立即释放监听', async () => {
    const unsubscribeBatch = vi.fn()
    let emitBatchProgress
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockImplementationOnce(function (callback) {
      emitBatchProgress = callback
      return unsubscribeBatch
    })
    window.electronAPI.batchExecute.mockResolvedValueOnce({
      code: 0,
      data: { batchId: 'batch1', total: 2, accepted: 1, failed: 1 },
    })
    window.electronAPI.batchGet = vi.fn()
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['wechat_mp', 'zhihu'],
    }]

    await r.handleBatchPublish()
    emitBatchProgress({
      kind: 'batch-complete',
      batchId: 'batch1',
      total: 2,
      accepted: 1,
      completed: 2,
      succeeded: 1,
      failed: 1,
    })

    expect(mockElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: '批量发布完成：1 个成功，1 个失败' }))
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.batchGet).not.toHaveBeenCalled()
  })

  it('batch-complete 事件丢失时通过有界状态轮询确认终态并释放监听', async () => {
    vi.useFakeTimers()
    const unsubscribeBatch = vi.fn()
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockReturnValueOnce(unsubscribeBatch)
    window.electronAPI.batchExecute.mockResolvedValueOnce({
      code: 0,
      data: { batchId: 'batch1', total: 2, accepted: 2, failed: 0 },
    })
    window.electronAPI.batchGet = vi.fn().mockResolvedValueOnce({
      code: 0,
      data: { id: 'batch1', status: 'done', total: 2, completed: 2, failed: 1 },
    })
    const r = useBatchPublish({
      article,
      licenseStore,
      batchStatusPollIntervalMs: 10,
      batchStatusPollMaxAttempts: 2,
    })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['wechat_mp', 'zhihu'],
    }]

    await r.handleBatchPublish()
    expect(unsubscribeBatch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)

    expect(window.electronAPI.batchGet).toHaveBeenCalledWith('batch1')
    expect(mockElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: '批量发布完成：1 个成功，1 个失败' }))
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('状态轮询达到边界仍无终态时提示超时并可靠取消监听', async () => {
    vi.useFakeTimers()
    const unsubscribeBatch = vi.fn()
    mockBatchCreate.mockResolvedValueOnce({ code: 0, data: { id: 'batch1' } })
    window.electronAPI.onBatchProgress.mockReturnValueOnce(unsubscribeBatch)
    window.electronAPI.batchExecute.mockResolvedValueOnce({
      code: 0,
      data: { batchId: 'batch1', total: 1, accepted: 1, failed: 0 },
    })
    window.electronAPI.batchGet = vi.fn().mockResolvedValue({
      code: 0,
      data: { id: 'batch1', status: 'running', total: 1, completed: 0, failed: 0 },
    })
    const r = useBatchPublish({
      article,
      licenseStore,
      batchStatusPollIntervalMs: 10,
      batchStatusPollMaxAttempts: 2,
    })
    r.articles.value = [{ title: '标题', content: '正文', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()
    await vi.advanceTimersByTimeAsync(20)

    expect(window.electronAPI.batchGet).toHaveBeenCalledTimes(2)
    expect(mockElMessage.error).toHaveBeenCalledWith(expect.objectContaining({ message: '批量发布状态确认超时，请在任务记录中查看最终结果' }))
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useBatchPublish — 离线检测与取消排期（与单篇语义对齐）', () => {
  let originalElectronAPI
  let article
  let licenseStore

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    vi.clearAllMocks()
    article = reactive({ title: '', content: '' })
    licenseStore = { isPro: true }
    mockBatchCreate.mockResolvedValue({ code: 0, data: { id: 'batch1' } })
    window.electronAPI = {
      batchSchedule: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
      batchCancel: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
      batchExecute: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
      onBatchProgress: vi.fn(function () { return vi.fn() }),
      offlineStatus: vi.fn(function () { return Promise.resolve({ code: 0, data: { offline: false } }) }),
      offlineAddToCache: vi.fn(function () { return Promise.resolve({ code: 0 }) }),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    window.electronAPI = originalElectronAPI
  })

  it('离线时逐篇进离线缓存且不创建批量任务（不把离线当在线硬发）', async () => {
    window.electronAPI.offlineStatus.mockResolvedValue({ code: 0, data: { offline: true } })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [
      { title: '文章A', content: '正文A', platforms: ['wechat_mp'] },
      { title: '文章B', content: '正文B', platforms: ['zhihu'] },
    ]

    await r.handleBatchPublish()

    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(window.electronAPI.batchExecute).not.toHaveBeenCalled()
    expect(window.electronAPI.offlineAddToCache).toHaveBeenCalledTimes(2)
    expect(window.electronAPI.offlineAddToCache).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.any(Array),
        data: expect.objectContaining({ title: '文章A' }),
      }),
    )
  })

  // 平台侧定时（2026-10-07）：带 publishTime 的条目创建排期不依赖渲染层在线态，
  // 而离线缓存形状 {targets, data} **不含 publishTime** ⇒ 网络恢复后立即发布。
  // 与单篇 usePublishFlow 同构，这条锁防止批量侧回退。
  it('带定时的批次即使离线也走 batch:schedule，不落离线缓存', async () => {
    window.electronAPI.offlineStatus.mockResolvedValue({ code: 0, data: { offline: true } })
    const r = useBatchPublish({ article, licenseStore })
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    r.articles.value = [
      { title: '文章A', content: '正文A', platforms: ['toutiao'], publishTime: future },
    ]

    await r.handleBatchPublish()

    expect(window.electronAPI.offlineAddToCache).not.toHaveBeenCalled()
    expect(mockBatchCreate).toHaveBeenCalled()
    expect(window.electronAPI.batchSchedule).toHaveBeenCalledWith('batch1')
  })

  it('离线缓存写入失败时提示失败，不静默当作成功', async () => {
    window.electronAPI.offlineStatus.mockResolvedValue({ code: 0, data: { offline: true } })
    window.electronAPI.offlineAddToCache.mockResolvedValue({ code: -1, message: '磁盘写入失败' })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '文章A', content: '正文A', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(r.batchProgress.value.some(function (item) { return item.type === 'danger' })).toBe(true)
  })

  it('排期成功后暴露 scheduledBatchId，取消排期调用 batchCancel 并清除状态', async () => {
    window.electronAPI.batchCancel = vi.fn(function () { return Promise.resolve({ code: 0 }) })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '文章A', content: '正文A', platforms: ['toutiao'], publishTime: futurePublishTime() }]

    await r.handleBatchPublish()
    expect(r.scheduledBatchId.value).toBe('batch1')

    await r.cancelScheduledBatch()

    expect(window.electronAPI.batchCancel).toHaveBeenCalledWith('batch1')
    expect(r.scheduledBatchId.value).toBe(null)
  })

  it('取消排期失败时保留 scheduledBatchId 供重试，并提示失败', async () => {
    window.electronAPI.batchCancel = vi.fn(function () { return Promise.resolve({ code: -1, message: '该批次未在排期中' }) })
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '文章A', content: '正文A', platforms: ['toutiao'], publishTime: futurePublishTime() }]

    await r.handleBatchPublish()
    await r.cancelScheduledBatch()

    expect(r.scheduledBatchId.value).toBe('batch1')
    expect(mockElMessage.error).toHaveBeenCalled()
  })

  it('非排期批次（立即执行）不暴露 scheduledBatchId，取消排期无副作用', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{ title: '文章A', content: '正文A', platforms: ['wechat_mp'] }]

    await r.handleBatchPublish()

    expect(r.scheduledBatchId.value).toBe(null)
    await r.cancelScheduledBatch()
    expect(window.electronAPI.batchCancel).not.toHaveBeenCalled()
  })
})

/**
 * P2-7 批量模式字段面
 *
 * 三条锁各自对应一个真实缺陷形态：
 * ① 条目结构必须有写点（此前 cover_* 只有读点、没有写点 ⇒ 恒为空，「字段恒空」诊断法）；
 * ② payload 必须与单篇同口径（此前少 contentFormat / platformOverrides / visibilitySemantic）；
 * ③ 提交前必须过注册表内容限制校验（此前批量完全不调 validatePlatformContent，
 *    超长内容由平台侧报错，用户在进度流里只看到一条模糊失败）。
 */
describe('useBatchPublish — P2-7 批量条目字段面', () => {
  let article
  let licenseStore

  beforeEach(() => {
    vi.clearAllMocks()
    article = reactive({ title: '', content: '' })
    licenseStore = { isPro: true }
    window.electronAPI = {
      batchSchedule: vi.fn(() => Promise.resolve({ code: 0 })),
      batchExecute: vi.fn(() => Promise.resolve({ code: 0 })),
      onBatchProgress: vi.fn(() => vi.fn()),
      offlineStatus: vi.fn(() => Promise.resolve({ code: 0, data: { offline: false } })),
      offlineAddToCache: vi.fn(() => Promise.resolve({ code: 0 })),
    }
    mockBatchCreate.mockResolvedValue({ code: 0, data: { id: 'batch-p27' } })
  })

  afterEach(() => {
    delete window.electronAPI
  })

  function publishedArticle () {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['wechat_mp'],
      publishTime: '',
    }]
    return r
  }

  it('新条目结构自带 platformOverrides / visibilitySemantic（面板与档位有落点）', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    const fresh = r.articles.value[r.articles.value.length - 1]
    expect(fresh.platformOverrides).toEqual({})
    expect(fresh.visibilitySemantic).toBe('')
  })

  it('setBatchArticleCover 写 cover_file + cover_path；解析失败不改动既有封面', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    const a = r.articles.value[r.articles.value.length - 1]

    expect(r.setBatchArticleCover(a, { path: 'D:/cover.png', name: 'cover.png' })).toBe(true)
    expect(a.cover_path).toBe('D:/cover.png')
    expect(a.cover_file).toEqual({ path: 'D:/cover.png', name: 'cover.png' })

    // 假描述符必须返回 false 且保持原值：把「解析失败」写成空串等于伪装成用户清空封面
    expect(r.setBatchArticleCover(a, null)).toBe(false)
    expect(r.setBatchArticleCover(a, { name: 'no-path.png' })).toBe(false)
    expect(a.cover_path).toBe('D:/cover.png')
  })

  it('clearBatchArticleCover 一次清掉三个封面入口（file/path/url 不得残留半值）', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    const a = r.articles.value[r.articles.value.length - 1]
    a.cover_url = 'https://example.com/a.png'
    r.setBatchArticleCover(a, { path: 'D:/cover.png' })

    r.clearBatchArticleCover(a)
    expect(a.cover_file).toBeNull()
    expect(a.cover_path).toBe('')
    expect(a.cover_url).toBe('')
  })

  it('setBatchArticleVisibility 只接受三个语义档位与清空，非法值保持现状', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    const a = r.articles.value[r.articles.value.length - 1]

    r.setBatchArticleVisibility(a, 'private')
    expect(a.visibilitySemantic).toBe('private')
    r.setBatchArticleVisibility(a, 'PUBLICS')
    expect(a.visibilitySemantic).toBe('private')
    r.setBatchArticleVisibility(a, '')
    expect(a.visibilitySemantic).toBe('')
  })

  it('setBatchArticleOverrides 深拷贝：源对象后续变化不污染条目，两条目互不共享', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    r.addArticle()
    const [first, second] = r.articles.value
    const panelPayload = { wechat_mp: { title: '覆盖', content: '' } }

    r.setBatchArticleOverrides(first, panelPayload)
    panelPayload.wechat_mp.title = '面板随后改了'
    expect(first.platformOverrides.wechat_mp.title).toBe('覆盖')

    r.setBatchArticleOverrides(second, {})
    expect(second.platformOverrides).toEqual({})
    expect(first.platformOverrides.wechat_mp.title).toBe('覆盖')
  })

  it('duplicateArticle 携带条目级字段面且为深拷贝，复制不带排期', () => {
    const r = useBatchPublish({ article, licenseStore })
    r.addArticle()
    const origin = r.articles.value[0]
    origin.title = '原标题'
    origin.content = '正文'
    origin.platforms = ['toutiao']
    origin.visibilitySemantic = 'friends'
    origin.platformOverrides = { wechat_mp: { title: '覆盖标题', content: '' } }
    origin.publishTime = futurePublishTime()

    r.duplicateArticle(0)
    const copy = r.articles.value[1]
    expect(copy.visibilitySemantic).toBe('friends')
    expect(copy.platformOverrides).toEqual({ wechat_mp: { title: '覆盖标题', content: '' } })
    expect(copy.platformOverrides).not.toBe(origin.platformOverrides)
    copy.platformOverrides.wechat_mp.title = '副本改的'
    expect(origin.platformOverrides.wechat_mp.title).toBe('覆盖标题')
    expect(copy.publishTime).toBe('')
  })

  it('payload 携带新字段：Markdown 判定 / 差异化归一 / 可见性档位 / 封面归一', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '# 标题',
      content: '**加粗**正文',
      platforms: ['wechat_mp'],
      cover_file: { path: 'D:/c.png', name: 'c.png' },
      platformOverrides: { wechat_mp: { title: '', content: '' }, zhihu: { title: '知乎覆盖', content: '' } },
      visibilitySemantic: 'private',
    }]

    await r.handleBatchPublish()

    const payload = mockBatchCreate.mock.calls[0][0].articles[0]
    expect(payload.contentFormat).toBe('markdown')
    expect(payload.visibilitySemantic).toBe('private')
    // 空覆盖条目被剔除（冗余覆盖会改写平台默认），非空条目保留
    expect(payload.platformOverrides).toEqual({ zhihu: { title: '知乎覆盖', content: '' } })
    expect(payload.cover_path).toBe('D:/c.png')
    expect(payload.cover_file).toEqual({ path: 'D:/c.png', name: 'c.png' })
  })

  it('无可见性档位时不挂该键（与单篇「有值才挂」同口径，不得发 undefined）', async () => {
    const r = publishedArticle()
    await r.handleBatchPublish()
    const payload = mockBatchCreate.mock.calls[0][0].articles[0]
    expect('visibilitySemantic' in payload).toBe(false)
  })

  it('内容超出注册表限制时整批中止且不创建批次（此前批量完全不调校验）', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '小红书标题',
      // 超限长度 = 注册表 contentMax + 1（同源推导）。勿改回硬编码：
      // 上限值曾从 1000 调到 5000，硬编码 '长'.repeat(5000) 不再超限导致整批放行（CI Gate 4 事故）
      content: '长'.repeat(getPlatformContentLimit('xiaohongshu').contentMax + 1),
      platforms: ['xiaohongshu'],
      publishTime: '',
    }]

    await r.handleBatchPublish()

    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(mockElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('小红书标题') }))
  })

  it('差异化面板里的超长覆盖内容按平台上限自动转换（PRD-PLATFORM-CHAR-LIMITS §F3：截断放行 + 汇总提示，不再整批中止）', async () => {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '合规标题',
      content: '合规正文',
      platforms: ['douyin'],
      publishTime: '',
      // 差异化覆盖超限 = 注册表 contentMax + 1 字符（'正文' 两字一组，向上取整组数）。
      // 勿改回硬编码：douyin 上限 1000→5000 后 repeat(600)=1200 不再超限导致放行（同上事故）
      platformOverrides: { douyin: { title: '', content: '正文'.repeat(Math.ceil((getPlatformContentLimit('douyin').contentMax + 1) / 2)) } },
    }]

    await r.handleBatchPublish()

    // 转换后放行：batchCreate 收到的 payload 里覆盖内容已截到注册表上限
    expect(mockBatchCreate).toHaveBeenCalledTimes(1)
    const payload = mockBatchCreate.mock.calls[0][0]
    const override = payload.articles[0].platformOverrides.douyin
    expect(Array.from(override.content).length).toBe(getPlatformContentLimit('douyin').contentMax)
    // 确认弹窗提示包含该条目的截断汇总（含平台上限与 before/after）
    expect(mockElMessageBox.confirm).toHaveBeenCalledWith(
      expect.stringContaining('合规标题'),
      expect.anything(),
      expect.anything(),
    )
    const confirmText = mockElMessageBox.confirm.mock.calls[0][0]
    expect(confirmText).toContain(String(getPlatformContentLimit('douyin').contentMax))
  })

  it('接线守卫：批量 payload 键集必须覆盖单篇 buildArticleData 的全部键（漏一键即红）', async () => {
    const fs = require('fs')
    const path = require('path')
    const root = path.resolve(__dirname, '..', '..')

    function keysOf (file, fnName) {
      const src = fs.readFileSync(path.join(root, file), 'utf8')
      const start = src.indexOf('function ' + fnName)
      expect(start, file + ' 里找不到 ' + fnName + '（实现被改名/删除，锁不得静默放行）').toBeGreaterThan(-1)
      // 测量域 = 该函数自己的闭合括号，禁止固定字符窗口：
      // 窗口比函数短 ⇒ 后半部分新增的键根本不在判据里，锁失焦却照绿；
      // 窗口比函数长 ⇒ 会把**别的函数**的键算进来，用别人的字段给自己作证。
      // 闭合括号必须按**声明行的实际缩进**找：这两个函数嵌在 composable 工厂里，
      // 收尾是「两空格 + }」而不是第 0 列，按第 0 列找会一路吞到外层函数末尾。
      const declLineStart = src.lastIndexOf('\n', start) + 1
      const indent = /^[ \t]*/.exec(src.slice(declLineStart, start))[0]
      const rest = src.slice(start)
      const endMarker = '\n' + indent + '}'
      const end = rest.indexOf(endMarker)
      expect(end, file + ' 的 ' + fnName + ' 未在同缩进处闭合（缩进形态变了，锁不得放行）').toBeGreaterThan(-1)
      const body = rest.slice(0, end)
      const literalKeys = [...body.matchAll(/^\s{6}([a-zA-Z][\w]*):/gm)].map(m => m[1])
      const assignedKeys = [...body.matchAll(/data\.([a-zA-Z][\w]*)\s*=/g)].map(m => m[1])
      return new Set([...literalKeys, ...assignedKeys])
    }

    const singleKeys = keysOf('src/composables/usePublishFlow.js', 'buildArticleData')
    const batchKeys = keysOf('src/composables/useBatchPublish.js', 'buildBatchArticlePayload')
    // 规模下界：解析退化成小集合时（正则失配）本条先红，避免假绿
    expect(singleKeys.size).toBeGreaterThan(8)
    expect(batchKeys.size).toBeGreaterThan(8)
    const missing = [...singleKeys].filter(key => !batchKeys.has(key))
    expect(missing, '批量 payload 缺少单篇已有字段：' + missing.join(',')).toEqual([])
  })

  /**
   * 封面取值合同（评审 Critical 的回归锁）。
   *
   * 断言刻意复刻主进程的真实取值表达式 `cover_url || cover_path`
   * （publisher-router.js buildPublishArticle → resolved.base），而不是断言「payload 里
   * 出现了本地路径」——后者在两个键同时非空时仍会通过，正好放过本次的失效形态：
   * 渲染层按「本地文件优先」算封面，主进程按「URL 优先」取封面，两层优先级相反，
   * 于是「先填 URL 再选本地文件」= 界面显示本地封面、实际发布那个更早的 URL；
   * 且 DOM RPA 轨会把 URL 字符串塞进 <input type=file>（rpa-view-platforms.js:312）。
   */
  function publishedWithCover (coverFields) {
    const r = useBatchPublish({ article, licenseStore })
    r.articles.value = [{
      title: '标题',
      content: '正文',
      platforms: ['wechat_mp'],
      publishTime: '',
      ...coverFields,
    }]
    return r
  }

  async function routerCover (r) {
    await r.handleBatchPublish()
    const sent = mockBatchCreate.mock.calls[0][0].articles[0]
    return { effective: sent.cover_url || sent.cover_path || null, sent }
  }

  it('本地封面与 URL 同时存在时，主进程取到的必须是本地文件', async () => {
    const r = publishedWithCover({
      cover_url: 'https://cdn.example/stale-cover.jpg',
      cover_path: 'D:/covers/picked.png',
      cover_file: { path: 'D:/covers/picked.png', name: 'picked.png' },
    })
    const { effective } = await routerCover(r)
    expect(effective).toBe('D:/covers/picked.png')
  })

  it('经 setter 选本地封面后，主进程取到的必须是刚选的那张（用户最后意图）', async () => {
    const r = publishedWithCover({ cover_url: 'https://cdn.example/stale-cover.jpg' })
    const item = r.articles.value[0]
    expect(r.setBatchArticleCover(item, { path: 'D:/covers/second.png', name: 'second.png' })).toBe(true)
    const { effective } = await routerCover(r)
    expect(effective).toBe('D:/covers/second.png')
  })

  it('只有 URL 封面时 URL 照常生效（不得把既有形状改成「URL 发不出去」）', async () => {
    const r = publishedWithCover({ cover_url: 'https://cdn.example/only.jpg' })
    const { effective } = await routerCover(r)
    expect(effective).toBe('https://cdn.example/only.jpg')
  })

  it('setBatchArticleCoverUrl 只写 URL，不得静默丢掉已选本地封面', () => {
    const r = useBatchPublish({ article, licenseStore })
    const item = { title: 't', content: 'c', platforms: [], cover_file: null, cover_path: '', cover_url: '' }
    expect(r.setBatchArticleCover(item, { path: 'D:/covers/a.png', name: 'a.png' })).toBe(true)
    r.setBatchArticleCoverUrl(item, 'https://cdn.example/b.jpg')
    // 换封面来源是破坏性动作，必须经「清除封面」显式做出，不能由一次打字代做
    expect(item.cover_url).toBe('https://cdn.example/b.jpg')
    expect(item.cover_path).toBe('D:/covers/a.png')
    expect(item.cover_file).toEqual({ path: 'D:/covers/a.png', name: 'a.png' })
  })

  it('setBatchArticleCoverUrl 对非字符串入参写空串（不把 undefined 漏进 payload）', () => {
    const r = useBatchPublish({ article, licenseStore })
    const item = { cover_url: 'https://cdn.example/keep.jpg' }
    r.setBatchArticleCoverUrl(item, undefined)
    expect(item.cover_url).toBe('')
    r.setBatchArticleCoverUrl(null, 'x')
    expect(item.cover_url).toBe('')
  })

  it('无封面时既不产出 cover_url 也产出空串，主进程取值为 null', async () => {
    const r = publishedWithCover({})
    const { effective, sent } = await routerCover(r)
    expect(sent.cover_url).toBe('')
    expect(effective).toBeNull()
  })

  // ─── 热门选题批量交接（hot-topics-publish-handoff，2026-10-09）─────────────
  describe('seedArticlesFromDrafts — 草稿批量装载', () => {
    it('装载标题/正文/标签并返回条数', () => {
      const r = useBatchPublish({ article, licenseStore })
      const seeded = r.seedArticlesFromDrafts([
        { id: 'd1', title: '选题一', content: '正文一', tags: ['标签A', '标签B'] },
        { id: 'd2', title: '选题二', content: '正文二' },
      ])
      expect(seeded).toBe(2)
      expect(r.articles.value).toHaveLength(2)
      expect(r.articles.value[0]).toMatchObject({ title: '选题一', content: '正文一', tagsText: '标签A,标签B' })
      // 无标签草稿不得写入 undefined（payload 依赖数组口径）
      expect(r.articles.value[1].tags).toEqual([])
      expect(r.articles.value[1].tagsText).toBe('')
    })

    it('忽略无 id 的条目；空入参返回 0 且不动现有条目、不抛错', () => {
      const r = useBatchPublish({ article, licenseStore })
      // 无 id 无法回溯到草稿箱，塞空卡片会让用户无法判断是装载失败还是内容为空
      expect(r.seedArticlesFromDrafts([
        { title: '无 id', content: 'x' }, { id: '   ', title: '空白' }, null, { id: 'd9', title: '有效', content: 'y' },
      ])).toBe(1)
      expect(r.articles.value.map(a => a.title)).toEqual(['有效'])
      r.articles.value[0].title = '用户已编辑'
      for (const empty of [null, 'd1,d2', []]) expect(r.seedArticlesFromDrafts(empty)).toBe(0)
      expect(r.articles.value).toHaveLength(1)
      expect(r.articles.value[0].title).toBe('用户已编辑')
    })

    it('字段面与 addArticle 同键集（防止默认字段面两处漂移）', () => {
      const seeded = useBatchPublish({ article, licenseStore })
      seeded.seedArticlesFromDrafts([{ id: 'd1', title: 't', content: 'c' }])
      const manual = useBatchPublish({ article, licenseStore })
      manual.addArticle()
      expect(Object.keys(seeded.articles.value[0]).sort()).toEqual(Object.keys(manual.articles.value[0]).sort())
    })
  })

  describe('selectHandoffPresetPlatforms — 交接预置平台（冷启动时序）', () => {
    const byPlatform = { wechat_mp: [{ id: 'a1' }], douyin: [{ id: 'd1' }], zhihu: [] }

    it('目录未就绪时回落到账号目录；就绪时与目录求交', () => {
      // 冷重载时平台目录尚未就绪：只读目录会预置出空目标（批量区变成 0 个任务）
      for (const empty of [[], null, undefined]) {
        expect(selectHandoffPresetPlatforms(byPlatform, empty)).toEqual(['wechat_mp', 'douyin'])
      }
      // 账号数据里残留的已下线平台不得被预置进来
      expect(selectHandoffPresetPlatforms(byPlatform, ['wechat_mp', 'douyin', 'bilibili'])).toEqual(['wechat_mp', 'douyin'])
    })

    it('只收「有账号」的平台；非法入参返回空数组', () => {
      expect(selectHandoffPresetPlatforms({ wechat_mp: [], douyin: null, kuaishou: [{ id: 'k' }] }, [])).toEqual(['kuaishou'])
      expect(selectHandoffPresetPlatforms(null, [])).toEqual([])
      expect(selectHandoffPresetPlatforms('not-an-object', ['wechat_mp'])).toEqual([])
    })
  })

  describe('applyTargetsToAll — 批量设置发布目标', () => {
    it('平台与账号一起写入全部条目；空输入返回 0；重复应用覆盖旧选择', () => {
      const r = useBatchPublish({ article, licenseStore })
      expect(r.applyTargetsToAll({ platforms: ['wechat_mp'] })).toBe(0)
      r.seedArticlesFromDrafts([{ id: 'd1', title: 'a', content: 'a' }, { id: 'd2', title: 'b', content: 'b' }])
      expect(r.applyTargetsToAll({ platforms: ['wechat_mp', 'zhihu'], accounts: { wechat_mp: ['acc1'] } })).toBe(2)
      expect(r.articles.value[0].platforms).toEqual(['wechat_mp', 'zhihu'])
      expect(r.articles.value[1].accounts).toEqual({ wechat_mp: ['acc1'] })
      // 无账号映射的平台保持键缺失：让校验文案如实指向该平台
      expect(r.articles.value[0].accounts.zhihu).toBeUndefined()
      expect(r.totalPlatformTasks.value).toBe(4)
      expect(r.applyTargetsToAll({ platforms: [] })).toBe(0)
      expect(r.applyTargetsToAll(null)).toBe(0)
      r.applyTargetsToAll({ platforms: ['zhihu'], accounts: { zhihu: ['z1'] } })
      expect(r.articles.value[0].platforms).toEqual(['zhihu'])
      expect(r.articles.value[0].accounts).toEqual({ zhihu: ['z1'] })
    })
  })
})
