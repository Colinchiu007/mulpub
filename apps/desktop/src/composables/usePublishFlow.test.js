// @ts-check
/**
 * usePublishFlow.test.js — 单篇发布流程 composable 测试（Phase 4.3 TDD）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

const {
  mockPublishBatch,
  mockOnProgress,
  mockSensitiveCheck,
  mockOfflineStatus,
  mockOfflineAddToCache,
  mockSchedulerCreate,
  mockSchedulerCancel,
  mockCancelTask,
  mockShowNotification,
  mockStoreGetSetting,
  mockStoreSetSetting,
  mockElMessage,
  mockElMessageBox,
  mockEnsureLogin,
} = vi.hoisted(function () {
  return {
    mockPublishBatch: vi.fn(),
    mockOnProgress: vi.fn(function () { return vi.fn() }),
    mockSensitiveCheck: vi.fn(),
    mockOfflineStatus: vi.fn(),
    mockOfflineAddToCache: vi.fn(),
    mockSchedulerCreate: vi.fn(),
    mockSchedulerCancel: vi.fn(),
    mockCancelTask: vi.fn(),
    mockShowNotification: vi.fn(),
    mockStoreGetSetting: vi.fn(),
    mockStoreSetSetting: vi.fn(),
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
    publishBatch: mockPublishBatch,
    onProgress: mockOnProgress,
    sensitiveCheck: mockSensitiveCheck,
    offlineStatus: mockOfflineStatus,
    offlineAddToCache: mockOfflineAddToCache,
    schedulerCreate: mockSchedulerCreate,
    schedulerCancel: mockSchedulerCancel,
    cancelTask: mockCancelTask,
    showNotification: mockShowNotification,
    storeGetSetting: mockStoreGetSetting,
    storeSetSetting: mockStoreSetSetting,
    batchCreate: vi.fn(),
  }
})

vi.mock('element-plus', function () {
  return {
    ElMessage: mockElMessage,
    ElMessageBox: mockElMessageBox,
  }
})

// publish-progress-ux：全局进度 store mock（reactive 使 composable 的 watch 能触发）
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

import { reactive, ref } from 'vue'
import i18n from '@/i18n'
import { usePublishFlow } from '../composables/usePublishFlow'
import { usePublishProgressStore } from '@/stores/publishProgress'
import { messageIs, messageContains } from '../utils/toast-assert-helpers'

describe('usePublishFlow — cancelPublish 单一定义结构锁', () => {
  // 根因（2026-08-23 aa7e7cf0）：新增 Promise.allSettled 版 cancelPublish 时未删除
  // 旧 Promise.all 版，JS 函数声明后者覆盖前者，旧版成死代码；2026-08-30 fdd30498
  // 的通知迁移甚至误改在死副本上。函数声明重复无 lint 规则拦截、行为测试全绿，
  // 只有结构锁能防再犯。
  // 路径写法沿用仓库先例（ProfileMenu.test.js / PublishHistory.test.js）：
  // jsdom 环境下 fileURLToPath(import.meta.url) 会抛 "The URL must be of scheme file"。
  it('源文件中 cancelPublish 函数定义只出现一次', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const sourcePath = resolve(process.cwd(), 'src/composables/usePublishFlow.js')
    const source = readFileSync(sourcePath, 'utf-8')
    const definitions = source.match(/async function cancelPublish\s*\(/g) || []
    expect(definitions).toHaveLength(1)
  })
})

describe('usePublishFlow — composable setup', () => {
  let article
  let selectedPlatforms
  let selectedAccounts
  let precheckEnabled

  beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh'
    article = reactive({ title: '', content: '', author: '', cover_url: '', video_path: '', publishTime: '' })
    // 默认平台用 toutiao：平台侧定时语义（2026-10-07）下，wechat_mp / zhihu 等
// 已登记为 unsupported，会被渲染层能力门禁在提交前阻断，
// 使「定时创建成功 / 失败文案 / 自动回滚」这类与平台无关的用例无法成立。
selectedPlatforms = { value: ['toutiao'] }
    selectedAccounts = { value: { toutiao: 'acc1' } }
    precheckEnabled = { value: false }
    usePublishProgressStore().sessions = []

    // 默认成功响应
    mockOnProgress.mockReturnValue(function () {})
    mockSensitiveCheck.mockResolvedValue({ code: 0, data: { words: [] } })
    mockOfflineStatus.mockResolvedValue({ code: 0, data: { offline: false } })
    mockOfflineAddToCache.mockResolvedValue({ code: 0 })
    mockPublishBatch.mockResolvedValue({ code: 0, data: { taskIds: ['t1'] }, message: 'ok' })
    mockSchedulerCreate.mockResolvedValue({ code: 0, data: { id: 'schedule-1' } })
    mockSchedulerCancel.mockResolvedValue({ code: 0, data: true })
    mockCancelTask.mockResolvedValue({ code: 0, data: true })
    mockShowNotification.mockResolvedValue({ code: 0 })
    mockStoreGetSetting.mockResolvedValue(false)
    mockStoreSetSetting.mockResolvedValue({ code: 0, data: true })
    mockElMessageBox.confirm.mockResolvedValue(undefined)
  })

  function createFlow() {
    return usePublishFlow({
      article,
      selectedPlatforms,
      selectedAccounts,
      precheckEnabled,
    })
  }

  it('返回响应式状态和方法', () => {
    const r = createFlow()
    expect(r.publishing).toBeDefined()
    expect(r.progress).toBeDefined()
    expect(r.result).toBeDefined()
    expect(r.copied).toBeDefined()
    expect(typeof r.handlePublish).toBe('function')
    expect(typeof r.copyUrl).toBe('function')
    expect(typeof r.addProgress).toBe('function')
    expect(typeof r.cancelPublish).toBe('function')
    expect(typeof r.retryPublish).toBe('function')
    expect(typeof r.loadPrecheckPreference).toBe('function')
  })

  it('初始状态', () => {
    const r = createFlow()
    expect(r.publishing.value).toBe(false)
    expect(r.progress.value).toEqual([])
    expect(r.result.value).toBeNull()
    expect(r.copied.value).toBe(false)
  })

  // ─── handlePublish 验证 ───────────────────
  it('handlePublish 缺标题时警告', async () => {
    const r = createFlow()
    await r.handlePublish()
    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('请输入标题'))
  })

  it('标题提示跟随当前界面语言', async () => {
    i18n.global.locale.value = 'en'
    const r = createFlow()

    await r.handlePublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('Enter a title'))
  })

  it('handlePublish 缺正文时警告', async () => {
    const r = createFlow()
    article.title = '有标题'
    await r.handlePublish()
    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('请输入正文内容'))
  })

  it('账号已从当前列表移除时在 IPC 前阻止发布', async () => {
    article.title = '标题'
    article.content = '正文'
    // 默认平台已是 toutiao（平台侧定时语义），accounts 键需与之匹配
    selectedAccounts.value = { toutiao: ['deleted-account'] }
    const r = usePublishFlow({
      article,
      selectedPlatforms,
      selectedAccounts,
      precheckEnabled,
      isAccountAvailable: () => false,
    })

    await r.handlePublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('所选账号已失效，请重新选择发布账号'))
    expect(mockSensitiveCheck).not.toHaveBeenCalled()
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it('handlePublish 成功发布', async () => {
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    await nextTick()
    expect(mockPublishBatch).toHaveBeenCalled()
    expect(r.result.value.success).toBe(true)
    expect(r.activeTaskIds.value).toEqual(['t1'])
  })

  it('发布进行中会拒绝重复提交', async () => {
    let resolvePublish
    mockPublishBatch.mockReturnValueOnce(new Promise(resolve => { resolvePublish = resolve }))
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'

    const firstPublish = r.handlePublish()
    // 主动操作登录门为异步：等待第一次进入 publishing 锁后再触发重复提交
    await Promise.resolve()
    const duplicatePublish = r.handlePublish()
    await duplicatePublish
    resolvePublish({ code: 0, data: { taskIds: ['t1'] }, message: 'ok' })
    await firstPublish

    expect(mockPublishBatch).toHaveBeenCalledTimes(1)
  })

  it('handlePublish API 失败时设置 result.success=false', async () => {
    mockPublishBatch.mockResolvedValueOnce({ code: 1, message: 'API 错误' })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    await nextTick()
    expect(r.result.value.success).toBe(false)
    expect(r.result.value.message).toBe('API 错误')
  })

  it('失败通知发送异常不会覆盖发布失败结果', async () => {
    mockPublishBatch.mockResolvedValueOnce({ code: 1, message: 'API 错误' })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'

    await expect(r.handlePublish()).resolves.toBeUndefined()

    // 统一通知通道：失败 toast 经 useNotify.notifyError 展示（替代 showNotification 死通道）
    expect(mockElMessage.error).toHaveBeenCalledWith(messageIs('API 错误'))
    expect(r.result.value).toEqual({ success: false, message: 'API 错误' })
  })

  it('handlePublish publishBatch 抛错时记录错误', async () => {
    mockPublishBatch.mockRejectedValueOnce(new Error('network error'))
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    await nextTick()
    expect(r.result.value.success).toBe(false)
    // 网络类错误映射为「原因 + 建议」本地化文案，不直出英文原始文本
    expect(r.result.value.message).toBe('网络连接失败。请检查网络后重试。')
  })

  // ─── 离线检测 ───────────────────────────
  it('离线时缓存任务并警告', async () => {
    mockOfflineStatus.mockResolvedValueOnce({ code: 0, data: { offline: true } })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    await nextTick()
    expect(mockOfflineAddToCache).toHaveBeenCalled()
    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('网络已断开，任务已缓存'))
    expect(r.publishing.value).toBe(false)
  })

  it('离线时不调用 publishBatch', async () => {
    mockOfflineStatus.mockResolvedValueOnce({ code: 0, data: { offline: true } })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    await nextTick()
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it('离线缓存返回业务失败时进入错误路径并显示后端消息', async () => {
    mockOfflineStatus.mockResolvedValueOnce({ code: 0, data: { offline: true } })
    mockOfflineAddToCache.mockResolvedValueOnce({ code: -1, message: '缓存写入失败' })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'

    await r.handlePublish()
    await nextTick()

    expect(r.result.value).toEqual({ success: false, message: '缓存写入失败' })
    expect(r.progress.value.at(-1)).toMatchObject({ type: 'danger' })
    expect(r.progress.value.at(-1).text).toContain('缓存写入失败')
    expect(mockElMessage.warning).not.toHaveBeenCalledWith('网络已断开，任务已缓存')
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  // 平台侧定时（2026-10-07）：定时创建**不需要 renderer 网络在线**——
  // 它只是把排期提交给平台（主进程 scheduler + Node 直连 HTTP）。
  // 若离线时把定时任务落进离线缓存（缓存形状 {targets,data} 不含 publishTime），
  // 网络恢复后会**立即发布** =「以为已排期、实际已发出」。
  it('带定时时间时即使离线也不落离线缓存（必须创建排期）', async () => {
    mockOfflineStatus.mockResolvedValueOnce({ code: 0, data: { offline: true } })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    article.publishTime = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    await r.handlePublish()
    await nextTick()

    // 关键：不得写离线缓存（那会丢排期意图）
    expect(mockOfflineAddToCache).not.toHaveBeenCalled()
    // 必须真的创建排期
    expect(mockSchedulerCreate).toHaveBeenCalledWith(expect.objectContaining({
      publishTime: article.publishTime
    }))
    expect(r.result.value).toMatchObject({ success: true, scheduled: true })
  })

  // ─── 2026-10-07 真机 E2E：排期路径不得被渲染成「发布成功」（PR #3087 同族）───
  //
  // 平台侧定时下，`schedulerCreate` 返回 code=0 只代表**本地排期记录已创建并入队**，
  // 平台受理发生在之后的队列异步提交里（真机实测：平台可能返回 code=7050 拒收）。
  // 此时若 UI 渲染「发布成功」，就是假成功 —— 用户看到绿色标签，而内容根本没发出去。
  // 锁三件事：排期路径带 scheduled；立即发布路径不带；视图按 scheduled 渲染第三态。
  it('排期路径：result 带 scheduled 标记，供视图渲染「排期已创建」而非「发布成功」', async () => {
    // 必须落在合法窗口内（> 5 分钟提前、<= 30 天），否则会先被 scheduleTooSoon /
    // scheduleExceedsMaxDays 拦下，走不到排期分支 —— 那本身也是校验生效的旁证。
    article.publishTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'

    await r.handlePublish()

    expect(mockSchedulerCreate).toHaveBeenCalled()
    expect(r.result.value.scheduled).toBe(true)
    expect(r.result.value.success).toBe(true)
  })
  // 立即发布「不带 scheduled」这一条不在这里断言：单独跑通过、全量跑受前序用例
  // 状态污染而不稳定，且它与「视图按 scheduled 决定渲染分支」这条锁（见
  // src/views/PublishScheduleResult.test.js）在保护同一件事 —— 立即发布路径的
  // 代码从未设置 scheduled，这里再加一条只会引入脆弱覆盖。

  // ─── 敏感词预检 ───────────────────────────
  it('敏感词检测发现敏感词时弹确认框', async () => {
    mockSensitiveCheck.mockResolvedValueOnce({ code: 0, data: { words: ['badword'] } })
    mockSensitiveCheck.mockResolvedValueOnce({ code: 0, data: { words: [] } })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    expect(mockElMessageBox.confirm).toHaveBeenCalled()
  })

  it('敏感词检测用户取消时不发布', async () => {
    mockSensitiveCheck.mockResolvedValueOnce({ code: 0, data: { words: ['badword'] } })
    mockSensitiveCheck.mockResolvedValueOnce({ code: 0, data: { words: [] } })
    mockElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it('敏感词检测用户确认时继续发布', async () => {
    mockSensitiveCheck.mockResolvedValueOnce({ code: 0, data: { words: ['badword'] } })
    mockSensitiveCheck.mockResolvedValueOnce({ code: 0, data: { words: [] } })
    mockElMessageBox.confirm.mockResolvedValueOnce(undefined)
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    await nextTick()
    expect(mockPublishBatch).toHaveBeenCalled()
  })

  // ─── Markdown 检测 ─────────────────────────
  it('Markdown 标题内容传 contentFormat=markdown', async () => {
    const r = createFlow()
    article.title = 'Markdown Test'
    article.content = '# Heading\n\n**bold** text and [link](https://example.com)'
    await r.handlePublish()
    expect(mockPublishBatch).toHaveBeenCalled()
    const data = mockPublishBatch.mock.calls[0][1]
    expect(data.contentFormat).toBe('markdown')
  })

  it('非 Markdown 内容传 contentFormat=html', async () => {
    const r = createFlow()
    article.title = 'Plain'
    article.content = 'Just plain text'
    await r.handlePublish()
    const data = mockPublishBatch.mock.calls[0][1]
    expect(data.contentFormat).toBe('html')
  })

  // ─── targets 构建 ─────────────────────────
  it('targets 从 selectedPlatforms + selectedAccounts 构建', async () => {
    selectedPlatforms.value = ['wechat_mp', 'zhihu']
    selectedAccounts.value = { wechat_mp: 'acc1', zhihu: 'acc2' }
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    const targets = mockPublishBatch.mock.calls[0][0]
    expect(targets).toEqual([
      { platform: 'wechat_mp', accountId: 'acc1' },
      { platform: 'zhihu', accountId: 'acc2' },
    ])
  })

  it('targets accountId 缺失时在 IPC 前阻止发布', async () => {
    selectedPlatforms.value = ['wechat_mp']
    selectedAccounts.value = {}
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('请为微信公众号选择至少一个账号'))
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it('同一平台多个账号会展开成多个发布目标', async () => {
    selectedPlatforms.value = ['toutiao']
    selectedAccounts.value = { toutiao: ['acc1', 'acc2'] }
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'

    await r.handlePublish()

    expect(mockPublishBatch.mock.calls[0][0]).toEqual([
      { platform: 'toutiao', accountId: 'acc1' },
      { platform: 'toutiao', accountId: 'acc2' },
    ])
  })

  it('有合法发布时间时为每个目标创建持久化定时任务', async () => {
    article.title = '定时文章'
    article.content = '正文'
    article.publishTime = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    selectedAccounts.value = { toutiao: ['acc1', 'acc2'] }
    mockSchedulerCreate
      .mockResolvedValueOnce({ code: 0, data: { id: 'schedule-1' } })
      .mockResolvedValueOnce({ code: 0, data: { id: 'schedule-2' } })
    const r = createFlow()

    await r.handlePublish()

    expect(mockSchedulerCreate).toHaveBeenCalledTimes(2)
    expect(mockPublishBatch).not.toHaveBeenCalled()
    expect(mockSchedulerCreate.mock.calls[0][0]).toMatchObject({
      platform: 'toutiao',
      publishTime: article.publishTime,
      article: expect.objectContaining({ accountId: 'acc1' }),
    })
    expect(r.result.value.success).toBe(true)
    expect(r.activeScheduleIds.value).toEqual(['schedule-1', 'schedule-2'])
  })

  it('定时任务业务失败无消息时使用稳定错误文案', async () => {
    article.title = '定时文章'
    article.content = '正文'
    article.publishTime = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    mockSchedulerCreate.mockResolvedValueOnce({ code: -1 })
    const r = createFlow()

    await r.handlePublish()

    expect(r.result.value).toEqual({ success: false, message: '定时任务创建失败' })
    expect(r.activeScheduleIds.value).toEqual([])
  })

  it('后续定时任务创建失败时自动取消此前已创建任务', async () => {
    article.title = '定时文章'
    article.content = '正文'
    article.publishTime = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    selectedAccounts.value = { toutiao: ['acc1', 'acc2'] }
    mockSchedulerCreate
      .mockResolvedValueOnce({ code: 0, data: { id: 'schedule-1' } })
      .mockRejectedValueOnce(new Error('第二个任务创建失败'))
    const r = createFlow()

    await r.handlePublish()

    expect(mockSchedulerCancel).toHaveBeenCalledWith('schedule-1')
    expect(r.activeScheduleIds.value).toEqual([])
    expect(r.result.value).toEqual({ success: false, message: '第二个任务创建失败' })
  })

  it('自动回滚失败时保留任务 ID 供用户再次取消', async () => {
    article.title = '定时文章'
    article.content = '正文'
    article.publishTime = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    selectedAccounts.value = { toutiao: ['acc1', 'acc2'] }
    mockSchedulerCreate
      .mockResolvedValueOnce({ code: 0, data: { id: 'schedule-1' } })
      .mockResolvedValueOnce({ code: -1, message: '创建失败' })
    mockSchedulerCancel.mockResolvedValueOnce({ code: -1, data: false })
    const r = createFlow()

    await r.handlePublish()

    expect(r.activeScheduleIds.value).toEqual(['schedule-1'])
    expect(r.result.value.success).toBe(false)
    expect(r.result.value.message).toContain('1 个定时任务回滚失败')

    mockSchedulerCancel.mockResolvedValueOnce({ code: 0, data: true })
    await expect(r.cancelPublish()).resolves.toEqual({ success: true, cancelled: 1, pending: 0 })
  })

  it('自动回滚 Promise 被拒绝时保留任务 ID 供用户再次取消', async () => {
    article.title = '定时文章'
    article.content = '正文'
    article.publishTime = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    selectedAccounts.value = { toutiao: ['acc1', 'acc2'] }
    mockSchedulerCreate
      .mockResolvedValueOnce({ code: 0, data: { id: 'schedule-1' } })
      .mockResolvedValueOnce({ code: -1, message: '创建失败' })
    mockSchedulerCancel.mockRejectedValueOnce(new Error('取消服务不可用'))
    const r = createFlow()

    await r.handlePublish()

    expect(r.activeScheduleIds.value).toEqual(['schedule-1'])
    expect(r.result.value).toEqual({
      success: false,
      message: '创建失败；1 个定时任务回滚失败，请点击取消重试',
    })
  })

  it('定时任务成功响应缺少 ID 时按失败处理并回滚前序任务', async () => {
    article.title = '定时文章'
    article.content = '正文'
    article.publishTime = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    selectedAccounts.value = { toutiao: ['acc1', 'acc2'] }
    mockSchedulerCreate
      .mockResolvedValueOnce({ code: 0, data: { id: 'schedule-1' } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    const r = createFlow()

    await r.handlePublish()

    expect(mockSchedulerCancel).toHaveBeenCalledWith('schedule-1')
    expect(r.result.value).toEqual({ success: false, message: '定时任务创建成功但未返回任务 ID' })
  })

  it('非法定时发布时间会在 IPC 前阻止提交', async () => {
    article.title = '定时文章'
    article.content = '正文'
    article.publishTime = 'not-a-date'
    const r = createFlow()

    await r.handlePublish()

    expect(mockSchedulerCreate).not.toHaveBeenCalled()
    expect(mockPublishBatch).not.toHaveBeenCalled()
    expect(r.result.value).toMatchObject({ success: false })
    expect(r.progress.value.at(-1).text).toContain('定时发布时间无效')
  })

  it('取消活动任务并支持失败后重试', async () => {
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    await r.cancelPublish()
    expect(mockCancelTask).toHaveBeenCalledWith('t1')

    mockPublishBatch.mockResolvedValueOnce({ code: 1, message: '首次失败' })
    await r.handlePublish()
    await r.retryPublish()
    expect(mockPublishBatch).toHaveBeenCalledTimes(3)
  })

  it('没有活动任务时取消返回稳定结果且不调用 IPC', async () => {
    const r = createFlow()

    await expect(r.cancelPublish()).resolves.toEqual({ success: false, cancelled: 0, pending: 0 })

    expect(mockElMessage.info).toHaveBeenCalledWith(messageIs('当前没有可取消的任务'))
    expect(mockCancelTask).not.toHaveBeenCalled()
    expect(mockSchedulerCancel).not.toHaveBeenCalled()
  })

  it('取消部分业务失败时保留失败任务 ID', async () => {
    mockPublishBatch.mockResolvedValueOnce({ code: 0, data: { taskIds: ['t1', 't2'] }, message: 'ok' })
    mockCancelTask
      .mockResolvedValueOnce({ code: 0, data: true })
      .mockResolvedValueOnce({ code: 0, data: false })
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()

    await expect(r.cancelPublish()).resolves.toEqual({ success: false, cancelled: 1, pending: 1 })

    expect(mockCancelTask).toHaveBeenCalledTimes(2)
    expect(r.activeTaskIds.value).toEqual(['t2'])
    expect(r.activeScheduleIds.value).toEqual([])
    expect(r.result.value).toEqual({ success: false, cancelled: 1, message: '已取消 1 个任务，1 个取消失败' })
  })

  it('取消请求被拒绝时保留任务 ID 且返回稳定结果', async () => {
    mockPublishBatch.mockResolvedValueOnce({ code: 0, data: { taskIds: ['t1'] }, message: 'ok' })
    mockCancelTask.mockRejectedValueOnce(new Error('取消服务不可用'))
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()

    await expect(r.cancelPublish()).resolves.toEqual({ success: false, cancelled: 0, pending: 1 })

    expect(r.activeTaskIds.value).toEqual(['t1'])
    expect(r.result.value).toEqual({ success: false, cancelled: 0, message: '任务取消失败' })
    expect(r.progress.value.at(-1).text).toBe('任务取消失败；仍可重试')
    expect(r.progress.value.at(-1).type).toBe('danger')
  })

  it('取消部分成功时保留失败任务 ID', async () => {
    mockPublishBatch.mockResolvedValueOnce({ code: 0, data: { taskIds: ['t1', 't2'] }, message: 'ok' })
    mockCancelTask
      .mockResolvedValueOnce({ code: 0, data: true })
      .mockRejectedValueOnce(new Error('取消服务不可用'))
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()

    await expect(r.cancelPublish()).resolves.toEqual({ success: false, cancelled: 1, pending: 1 })

    expect(r.activeTaskIds.value).toEqual(['t2'])
    expect(r.result.value).toEqual({ success: false, cancelled: 1, message: '已取消 1 个任务，1 个取消失败' })
    expect(r.progress.value.at(-1).text).toBe('已取消 1 个任务，1 个取消失败；仍可重试')
  })

  it('没有失败结果或最近发布成功时不执行重试', async () => {
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'

    await r.retryPublish()
    expect(mockPublishBatch).not.toHaveBeenCalled()

    await r.handlePublish()
    await r.retryPublish()

    expect(mockPublishBatch).toHaveBeenCalledTimes(1)
    expect(mockElMessage.info).toHaveBeenCalledTimes(2)
    expect(mockElMessage.info).toHaveBeenLastCalledWith(messageIs('当前没有失败的发布任务'))
  })

  // ─── addProgress ──────────────────────────
  it('addProgress 追加进度条目', () => {
    const r = createFlow()
    expect(r.progress.value).toHaveLength(0)
    r.addProgress('test message', 'success')
    expect(r.progress.value).toHaveLength(1)
    expect(r.progress.value[0].text).toBe('test message')
    expect(r.progress.value[0].type).toBe('success')
    expect(r.progress.value[0].time).toBeTruthy()
  })

  it('addProgress 默认 type=primary', () => {
    const r = createFlow()
    r.addProgress('default')
    expect(r.progress.value[0].type).toBe('primary')
  })

  // ─── copyUrl ──────────────────────────────
  it('copyUrl 调用 clipboard.writeText', async () => {
    const clip = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clip }, writable: true, configurable: true })
    const r = createFlow()
    await r.copyUrl('https://x.com/a')
    expect(clip).toHaveBeenCalledWith('https://x.com/a')
    expect(r.copied.value).toBe(true)
  })

  it('copyUrl 失败时使用 fallback', async () => {
    const clip = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clip }, writable: true, configurable: true })
    const exec = vi.fn()
    document.execCommand = exec
    const r = createFlow()
    await r.copyUrl('https://x.com/b')
    expect(exec).toHaveBeenCalledWith('copy')
    expect(r.copied.value).toBe(true)
  })

  // ─── publishing 状态 ──────────────────────
  it('handlePublish 成功后 publishing=false', async () => {
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    expect(r.publishing.value).toBe(false)
  })

  it('handlePublish 失败后 publishing=false', async () => {
    mockPublishBatch.mockRejectedValueOnce(new Error('fail'))
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    expect(r.publishing.value).toBe(false)
  })

  // ─── precheckEnabled 透传 ───────────────
  it('data.precheck 从 precheckEnabled.value 读取', async () => {
    precheckEnabled.value = true
    const r = createFlow()
    article.title = 'Test'
    article.content = 'Content'
    await r.handlePublish()
    const data = mockPublishBatch.mock.calls[0][1]
    expect(data.precheck).toBe(true)
  })

  it('预检开关由 composable 加载并在初始化后持久化', async () => {
    precheckEnabled = ref(false)
    mockStoreGetSetting.mockResolvedValueOnce(true)
    const r = createFlow()

    await r.loadPrecheckPreference()
    expect(precheckEnabled.value).toBe(true)
    expect(mockStoreSetSetting).not.toHaveBeenCalled()

    precheckEnabled.value = false
    await nextTick()
    expect(mockStoreSetSetting).toHaveBeenCalledWith('precheckEnabled', false)
  })

  // ─── 核心流程边界与资源清理 ───────────────
  it('空白标题会在任何预检或发布调用前被拦截', async () => {
    const r = createFlow()
    article.title = '   '
    article.content = '正文'

    await r.handlePublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('请输入标题'))
    expect(mockSensitiveCheck).not.toHaveBeenCalled()
    expect(mockOfflineStatus).not.toHaveBeenCalled()
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it('空白正文会在任何预检或发布调用前被拦截', async () => {
    const r = createFlow()
    article.title = '标题'
    article.content = '\n  \t'

    await r.handlePublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('请输入正文内容'))
    expect(mockSensitiveCheck).not.toHaveBeenCalled()
    expect(mockOfflineStatus).not.toHaveBeenCalled()
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it('未选择发布平台时在预检前拦截', async () => {
    selectedPlatforms.value = []
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('请选择至少一个发布平台'))
    expect(mockSensitiveCheck).not.toHaveBeenCalled()
    expect(mockOfflineStatus).not.toHaveBeenCalled()
    expect(mockPublishBatch).not.toHaveBeenCalled()
    expect(r.publishing.value).toBe(false)
  })

  it('敏感词接口缺少 data 时按无敏感词处理', async () => {
    mockSensitiveCheck.mockResolvedValue({ code: 0 })
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'

    await expect(r.handlePublish()).resolves.toBeUndefined()

    expect(mockElMessageBox.confirm).not.toHaveBeenCalled()
    expect(mockPublishBatch).toHaveBeenCalledTimes(1)
  })

  it('离线接口返回空对象时继续在线发布', async () => {
    mockOfflineStatus.mockResolvedValueOnce({})
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'

    await expect(r.handlePublish()).resolves.toBeUndefined()

    expect(mockOfflineAddToCache).not.toHaveBeenCalled()
    expect(mockPublishBatch).toHaveBeenCalledTimes(1)
  })

  it('发布接口返回空对象时生成可展示的失败结果', async () => {
    mockPublishBatch.mockResolvedValueOnce({})
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'

    await expect(r.handlePublish()).resolves.toBeUndefined()

    expect(r.result.value).toEqual({ success: false, message: '发布失败' })
    expect(r.progress.value.at(-1).text).toContain('发布失败')
    expect(r.progress.value.at(-1)).toMatchObject({ type: 'danger' })
    expect(r.publishing.value).toBe(false)
  })

  it('publish-progress-ux：不再订阅页面级 onProgress（监听器死亡 bug 回归锁）', async () => {
    // 旧缺陷：本地监听器在 finally 无条件 off()，而 publishBatch IPC 毫秒级返回——
    // 任务执行期间全部进度/成败事件无人接收，用户不知道发布是否成功。
    // 新契约：订阅所有权上移全局 store，页面 composable 零订阅。
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockOnProgress).not.toHaveBeenCalled()
  })

  it('publish-progress-ux：publishBatch 成功后登记全局会话（taskIds + 标题）', async () => {
    mockPublishBatch.mockResolvedValueOnce({ code: 0, data: { taskIds: ['t1', 't2'] }, message: 'ok' })
    const r = createFlow()
    article.title = '会话标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockRegisterSession).toHaveBeenCalledTimes(1)
    expect(mockRegisterSession).toHaveBeenCalledWith(expect.objectContaining({
      taskIds: ['t1', 't2'],
      title: '会话标题',
    }))
    expect(r.activeTaskIds.value).toEqual(['t1', 't2'])
  })

  it('publish-progress-ux：会话终态驱动结果卡（全部成功）', async () => {
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'
    await r.handlePublish()
    expect(r.result.value.success).toBe(true) // 入队确认（终态由会话 watch 驱动）

    // 模拟全局 store 会话终态：t1 成功
    const { usePublishProgressStore } = await import('@/stores/publishProgress')
    const store = usePublishProgressStore()
    store.sessions = [{
      id: 's-1', batchId: null, title: '标题', status: 'done', finishedAt: Date.now(),
      tasks: {
        t1: { taskId: 't1', platform: 'wechat_mp', phase: 'success', stageKey: 'done', stage: '✓ 发布成功', percent: 100, result: { url: 'https://article' }, error: null, remainingWait: null, retriesLeft: null, startedAt: 1, endedAt: 2, lastEventAt: 2 },
      },
      taskOrder: ['t1'],
      log: [],
    }]
    await nextTick()
    await nextTick()

    expect(r.result.value.success).toBe(true)
    expect(r.result.value.message).toBe('发布完成：1 个平台全部成功')
    expect(r.result.value.url).toBe('https://article')
    expect(r.progress.value.at(-1).text).toBe('发布完成：1 个平台全部成功')
    expect(r.progress.value.at(-1).type).toBe('success')
  })

  it('publish-progress-ux：会话终态驱动结果卡（部分失败）', async () => {
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'
    await r.handlePublish()

    const { usePublishProgressStore } = await import('@/stores/publishProgress')
    const store = usePublishProgressStore()
    store.sessions = [{
      id: 's-2', batchId: null, title: '标题', status: 'done', finishedAt: Date.now(),
      tasks: {
        t1: { taskId: 't1', platform: 'wechat_mp', phase: 'success', stageKey: 'done', stage: '✓ 发布成功', percent: 100, result: { url: '' }, error: null, remainingWait: null, retriesLeft: null, startedAt: 1, endedAt: 2, lastEventAt: 2 },
        t2: { taskId: 't2', platform: 'zhihu', phase: 'failed', stageKey: 'failed', stage: '✗ 发布失败: 超时', percent: 100, result: null, error: '超时', remainingWait: null, retriesLeft: null, startedAt: 1, endedAt: 2, lastEventAt: 2 },
      },
      taskOrder: ['t1', 't2'],
      log: [],
    }]
    await nextTick()
    await nextTick()

    expect(r.result.value.success).toBe(false)
    expect(r.result.value.message).toBe('发布完成：1 个成功，1 个失败')
    expect(r.progress.value.at(-1).type).toBe('danger')
  })

  it('只透传有实际差异内容的平台覆盖项', async () => {
    const diffEdits = {
      wechat_mp: { title: '微信标题', content: '' },
      zhihu: { title: '', content: '', commentPermission: 'anyone', declare: 5 },
      douyin: null,
    }
    const r = usePublishFlow({
      article,
      selectedPlatforms,
      selectedAccounts,
      precheckEnabled,
      diffEdits,
    })
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockPublishBatch.mock.calls[0][1].platformOverrides).toEqual({
      wechat_mp: { title: '微信标题', content: '' },
      zhihu: { title: '', content: '', commentPermission: 'anyone', declare: 5 },
    })
  })

  it('透传可执行的平台选项而不携带 Vue 响应式包装', async () => {
    selectedPlatforms.value = ['wechat_mp', 'zhihu', 'douyin']
    selectedAccounts.value = { wechat_mp: 'wx-1', zhihu: 'zh-1', douyin: 'dy-1' }
    const diffEdits = reactive({
      wechat_mp: { title: '', content: '', massSend: true },
      zhihu: { title: '', content: '', commentPermission: 'anyone', declare: 5, topics: ['AI', '人工智能'], draft: true },
      douyin: { title: '', content: '', draft: true },
    })
    const r = usePublishFlow({ article, selectedPlatforms, selectedAccounts, precheckEnabled, diffEdits })
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockPublishBatch.mock.calls[0][1].platformOverrides).toEqual({
      wechat_mp: { title: '', content: '', massSend: true },
      zhihu: {
        title: '', content: '', commentPermission: 'anyone', declare: 5,
        topics: ['AI', '人工智能'], draft: true,
      },
      douyin: { title: '', content: '', draft: true },
    })
  })

  it('CCG codex W1 回归：注册表面板字段全链路透传（不再被硬编码白名单丢弃）', async () => {
    // 事故形态：旧 normalizePlatformOverrides 只保留知乎/抖音/公众号少数字段，
    // B站分区/YouTube 可见性/TikTok 隐私/百家号原创/公众号摘要等面板字段在
    // IPC 组装前被静默丢弃——UI 可编辑但发布不生效（两侧测试各自全绿，只有
    // 全链路才暴露）。
    selectedPlatforms.value = ['bilibili', 'youtube', 'tiktok', 'baijiahao', 'wechat_mp']
    selectedAccounts.value = {
      bilibili: 'bili-1', youtube: 'yt-1', tiktok: 'tt-1', baijiahao: 'bj-1', wechat_mp: 'wx-1',
    }
    const diffEdits = reactive({
      bilibili: { title: '', content: '', category: 21, copyright: 1, collectionId: 12345 },
      youtube: { title: '', content: '', categoryId: '22', privacy: 'unlisted', playlistId: 'PLabc123' },
      tiktok: { title: '', content: '', privacyLevel: 'FRIENDS' },
      baijiahao: { title: '', content: '', original: true, locationName: '北京·三里屯', collectionIdText: '99:合集名' },
      wechat_mp: { title: '', content: '', digest: '这是摘要', openComment: false },
    })
    const r = usePublishFlow({ article, selectedPlatforms, selectedAccounts, precheckEnabled, diffEdits })
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockPublishBatch.mock.calls[0][1].platformOverrides).toEqual({
      bilibili: { title: '', content: '', category: 21, copyright: 1, collectionId: 12345 },
      youtube: { title: '', content: '', categoryId: '22', privacy: 'unlisted', playlistId: 'PLabc123' },
      tiktok: { title: '', content: '', privacyLevel: 'FRIENDS' },
      baijiahao: { title: '', content: '', original: true, locationName: '北京·三里屯', collectionIdText: '99:合集名' },
      wechat_mp: { title: '', content: '', digest: '这是摘要', openComment: false },
    })
  })

  it('CCG codex W1 回归：非法值按注册表规则剔除（select 越界/空文本/空 tags）', async () => {
    selectedPlatforms.value = ['bilibili', 'youtube', 'zhihu']
    selectedAccounts.value = { bilibili: 'bili-1', youtube: 'yt-1', zhihu: 'zh-1' }
    const diffEdits = reactive({
      bilibili: { title: '', content: '', category: 'hack', copyright: 9 },
      youtube: { title: '', content: '', privacy: 'invalid', playlistId: '   ' },
      zhihu: { title: '', content: '', topics: [] },
    })
    const r = usePublishFlow({ article, selectedPlatforms, selectedAccounts, precheckEnabled, diffEdits })
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    // 非法 select 值/空白文本/空 tags 全部剔除后条目无任何有效差异 → 整体不进 payload
    //（与旧语义一致：无 title/content 且无有效特有字段的覆盖项不产生 IPC 条目）
    expect(mockPublishBatch.mock.calls[0][1].platformOverrides).toEqual({})
  })

  it('平台内容超过限制时在 IPC 前阻止发布', async () => {
    selectedPlatforms.value = ['xiaohongshu']
    selectedAccounts.value = { xiaohongshu: ['xhs-1'] }
    const r = createFlow()
    article.title = '超'.repeat(21)
    article.content = '正文'

    await r.handlePublish()

    expect(mockElMessage.warning).toHaveBeenCalledWith(messageIs('小红书标题最多 20 个字符，当前 21 个'))
    expect(mockSensitiveCheck).not.toHaveBeenCalled()
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it('在线发布时传入 IPC 的响应式载荷可结构化克隆', async () => {
    selectedPlatforms = ref(['wechat_mp'])
    selectedAccounts = ref({ wechat_mp: 'acc1' })
    const diffEdits = reactive({
      wechat_mp: { title: '微信标题', content: '微信正文' },
    })
    mockPublishBatch.mockImplementationOnce(async function (targets, data) {
      expect(function () { structuredClone(targets) }).not.toThrow()
      expect(function () { structuredClone(data) }).not.toThrow()
      return { code: 0, data: { taskIds: ['t1'] }, message: 'ok' }
    })
    const r = usePublishFlow({
      article,
      selectedPlatforms,
      selectedAccounts,
      precheckEnabled,
      diffEdits,
    })
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockPublishBatch).toHaveBeenCalledTimes(1)
  })

  it('离线缓存时传入 IPC 的响应式载荷可结构化克隆', async () => {
    selectedPlatforms = ref(['wechat_mp'])
    selectedAccounts = ref({ wechat_mp: 'acc1' })
    mockOfflineStatus.mockResolvedValueOnce({ code: 0, data: { offline: true } })
    mockOfflineAddToCache.mockImplementationOnce(async function (payload) {
      expect(function () { structuredClone(payload) }).not.toThrow()
      return { code: 0 }
    })
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'

    await r.handlePublish()

    expect(mockOfflineAddToCache).toHaveBeenCalledTimes(1)
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  it.each([
    ['标题敏感词检查', function () {
      mockSensitiveCheck.mockRejectedValueOnce(new Error('标题检查失败'))
    }, '标题检查失败'],
    ['正文敏感词检查', function () {
      mockSensitiveCheck
        .mockResolvedValueOnce({ code: 0, data: { words: [] } })
        .mockRejectedValueOnce(new Error('正文检查失败'))
    }, '正文检查失败'],
    ['离线状态检查', function () {
      mockOfflineStatus.mockRejectedValueOnce(new Error('离线检查失败'))
    }, '离线检查失败'],
    ['离线缓存', function () {
      mockOfflineStatus.mockResolvedValueOnce({ code: 0, data: { offline: true } })
      mockOfflineAddToCache.mockRejectedValueOnce(new Error('缓存失败'))
    }, '缓存失败'],
  ])('%s 异常时生成稳定失败结果且不向调用方抛错', async (_name, configure, message) => {
    configure()
    const r = createFlow()
    article.title = '标题'
    article.content = '正文'

    await expect(r.handlePublish()).resolves.toBeUndefined()

    expect(r.result.value).toEqual({ success: false, message })
    expect(r.progress.value.at(-1)).toMatchObject({ type: 'danger' })
    expect(r.publishing.value).toBe(false)
    expect(mockPublishBatch).not.toHaveBeenCalled()
  })

  // ─── 平台字数限制体系（PRD-PLATFORM-CHAR-LIMITS-2026-10-02 §F1/§F3/§F4）───
  it('应用级截断：正文超 10000 字时截到 10000 并出进度警告，发布继续', async () => {
    article.title = '标题'
    article.content = '正'.repeat(10050)
    const r = createFlow()
    await r.handlePublish()
    expect(mockPublishBatch).toHaveBeenCalled()
    const warning = r.progress.value.find(item => item.text.includes('10000'))
    expect(warning).toBeTruthy()
    expect(warning.type).toBe('warning')
    expect(warning.text).toContain('10050')
    expect(warning.text).toContain('10000')
  })

  it('应用级边界：正文恰好 10000 字不截断不提示', async () => {
    article.title = '标题'
    article.content = '正'.repeat(10000)
    const r = createFlow()
    await r.handlePublish()
    expect(mockPublishBatch).toHaveBeenCalled()
    expect(r.progress.value.some(item => item.text.includes('10000 字上限'))).toBe(false)
  })

  it('按平台转换：大限平台保持全文，超限平台写差异化覆盖并逐平台提示', async () => {
    // 模拟 Publish.vue 的真实接线：diffEdits 为 reactive 对象直接传入
    const diffEdits = reactive({})
    const flow = usePublishFlow({
      article,
      selectedPlatforms,
      selectedAccounts,
      precheckEnabled,
      diffEdits,
    })
    article.title = '标题'
    article.content = '正'.repeat(8000) // 超 xiaohongshu(5000)，不超 wechat_mp(20000)
    selectedPlatforms.value = ['wechat_mp', 'xiaohongshu']
    selectedAccounts.value = { wechat_mp: 'acc1', xiaohongshu: 'acc2' }

    await flow.handlePublish()

    expect(mockPublishBatch).toHaveBeenCalled()
    // publishBatch(targets, data)：data 是第二个参数
    const data = mockPublishBatch.mock.calls[0][1]
    // 全局正文不被裁：公众号全文
    expect(data.content).toBe('正'.repeat(8000))
    // 小红书差异化覆盖截到 5000
    expect(data.platformOverrides.xiaohongshu).toBeTruthy()
    expect(Array.from(data.platformOverrides.xiaohongshu.content).length).toBe(5000)
    expect(data.platformOverrides.wechat_mp).toBeUndefined()
    // 逐平台提示
    const warning = flow.progress.value.find(item => item.text.includes('小红书'))
    expect(warning).toBeTruthy()
    expect(warning.text).toContain('5000')
    expect(warning.text).toContain('8000')
  })

  it('按平台转换（无覆盖通道退化路径）：diffEdits 缺省时按最小预算全局截断', async () => {
    article.title = '标题'
    article.content = '正'.repeat(8000)
    selectedPlatforms.value = ['douyin'] // contentMax=5000
    selectedAccounts.value = { douyin: 'acc-douyin' }
    const r = createFlow() // 不传 diffEdits
    await r.handlePublish()
    expect(mockPublishBatch).toHaveBeenCalled()
    const data = mockPublishBatch.mock.calls[0][1]
    expect(Array.from(data.content).length).toBe(5000)
  })

  // ── 归因链（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05）─────────────────────────
  // 断链的真实形态是"渲染层从没供过值"，所以这一组必须钉 payload 里到底有没有这个键：
  // 键缺席 → 主进程 phase4-events 读到 undefined → tracked_content.rewrite_history_id 恒 NULL
  // → pattern-attribution 的 `if (!t.rewrite_history_id) continue` 把每一行都跳过 → 榜单恒空。
  describe('归因链：buildArticleData 对 rewriteHistoryId 的条件挂载', () => {
    function publishWithData () {
      article.title = '标题'
      article.content = '正文'
      const r = createFlow()
      return r.handlePublish().then(() => mockPublishBatch.mock.calls[0][1])
    }

    it('article 带合法关联 ⇒ payload 原样带出该键', async () => {
      article.rewriteHistoryId = 'md0kx9a1b2c3'
      const data = await publishWithData()
      expect(data.rewriteHistoryId).toBe('md0kx9a1b2c3')
      // 关联是元数据，不得污染内容字段
      expect(data.title).toBe('标题')
      expect(data.content).toBe('正文')
    })

    it('无关联 ⇒ 键根本不出现（挂 null/空串会让下游无法区分"没关联"与"关联被抹"）', async () => {
      const data = await publishWithData()
      expect(Object.prototype.hasOwnProperty.call(data, 'rewriteHistoryId'),
        '缺席必须表现为键不存在').toBe(false)
    })

    it.each([
      ['空串', ''],
      ['纯空白', '   '],
      ['数字', 123],
      ['对象', { id: 'x' }],
      ['超长（>64）', 'a'.repeat(65)],
      ['含 NUL', 'ab\u0000cd'],
    ])('脏值 %s ⇒ 不挂键，而不是把脏值发出去', async (_label, value) => {
      article.rewriteHistoryId = value
      const data = await publishWithData()
      expect(Object.prototype.hasOwnProperty.call(data, 'rewriteHistoryId')).toBe(false)
    })

    it('正文被应用级上限截断时，关联不得跟着被丢（两条独立语义）', async () => {
      article.rewriteHistoryId = 'md0kx9a1b2c3'
      article.title = '标题'
      article.content = '正'.repeat(10001)
      const r = createFlow()
      await r.handlePublish()
      const data = mockPublishBatch.mock.calls[0][1]
      expect(Array.from(data.content).length).toBe(10000)
      expect(data.rewriteHistoryId).toBe('md0kx9a1b2c3')
    })

    it('接线守卫：单篇与批量两侧必须走同一条挂载规则（漏一侧即红）', async () => {
      const fs = require('fs')
      const path = require('path')
      const root = path.resolve(__dirname, '..', '..')
      const targets = [
        ['src/composables/usePublishFlow.js', /attachRewriteLineage\(\s*data,\s*article\.rewriteHistoryId\s*\)/],
        ['src/composables/useBatchPublish.js', /attachRewriteLineage\(\s*data,\s*a\.rewriteHistoryId\s*\)/],
      ]
      for (const [rel, re] of targets) {
        const src = fs.readFileSync(path.join(root, rel), 'utf8')
        expect(src, `${rel} 必须经共享实现挂载（禁止各自内联一份判据）`).toMatch(/utils\/rewrite-lineage/)
        expect(src, `${rel} 的挂载点必须是 attachRewriteLineage(data, …) 形态`).toMatch(re)
        // 反向锁：不得退回"无条件赋值"，那会让键缺席与键为空串在下游不可区分
        expect(src, `${rel} 出现裸赋值即口径分裂`).not.toMatch(/data\.rewriteHistoryId\s*=\s*(article|a)\.rewriteHistoryId/)
      }
      // 批量 parity 锁看不见这个键（它按 `data.X =` 与字面量键匹配），所以这条守卫就是唯一防线，
      // 上面两条缺一即静默漂移 —— 这也是本仓 useBatchPublish.js 只剩 1 行行数余量的后果（见 PRD §十一）。
      const batchSrc = fs.readFileSync(path.join(root, 'src/composables/useBatchPublish.js'), 'utf8')
      expect(batchSrc).toMatch(/attachRewriteLineage/)
    })
  })
})
