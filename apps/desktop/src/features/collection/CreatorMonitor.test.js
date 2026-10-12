import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}))

const { ElMessage } = await import('element-plus')

import CreatorMonitor from './CreatorMonitor.vue'

/** i18n 桩：给出真实模板，vue-i18n 才会替换 {count} / {max} / {remain} 等占位符。
 *  空 messages 时 t() 只回显 key，插值不会被替换，断言占位符数值就会假失败。 */
const messages = {
  zh: {
    collection: {
      creatorTab: '博主监控',
      creatorListTitle: '关注的博主',
      creatorAddSubmit: '关注',
      // ⚠ 含裸 `@` 的词条必须写成 Message Function：vue-i18n 的**字符串**消息会把
      // `@xxx` 当链接消息语法，编译期抛 `Invalid linked format`。生产侧
      // `src/i18n/index.js` 的 toMessageFunctions 会把所有字符串叶子转成函数
      // （为绕开 Electron CSP 的 new Function 限制），所以真实文案没问题；
      // 本桩直接喂字符串，必须自己保持同形状。
      creatorAddPlaceholder: () => '粘贴 YouTube 频道链接、@handle 或频道 ID',
      creatorPendingBadge: '{count} 条新作品',
      creatorCollectNew: '一键采集新作品',
      creatorCollectOne: '采集',
      creatorCollectedAt: '已采集 · {time}',
      creatorCapOfficial: '官方接口',
      creatorCapBestEffort: '尽力而为（可能不稳定）',
      creatorCapUnsupported: '暂不支持',
      creatorQualityFull: '字幕正文，质量高',
      creatorQualityPartial: '描述正文，质量有限',
      creatorQualityStub: '仅标题与简介',
      creatorAutoPaused: '连续失败 {times} 次，已自动暂停。{reason}',
      creatorFatalPaused: '无法检查新作品：{reason}。请在设置中检查 API Key。',
      creatorBatchSuccess: '已采集 {collected} 条内容',
      creatorTruncated: '共发现 {found} 条，已采集最新 {collected} 条，剩余 {remain} 条留待下次',
      creatorErrCountExceedsLimit: '本次最多采集 {max} 条，请调整数量。',
      creatorErrCollectFailed: '采集失败：{message}',
      creatorErrDependencyMissing: '缺少采集依赖。请执行：{command}',
      creatorNoNewWorks: '暂无新作品。系统会每 {interval} 自动检查一次。',
      creatorEmptyTitle: '还没有关注的博主',
      creatorEmptyDesc: '添加 YouTube 博主后，系统会定期检查新作品并在这里提示。',
      creatorPause: '暂停监控',
      creatorResume: '恢复监控',
      creatorCheckNow: '立即检查',
      creatorUnfollow: '取消关注',
      // ── creator-monitor-depfix 新增（2026-10-12）──
      creatorErrServiceUnavailable: '博主监控服务未就绪（主进程 creator 服务未装配）。请重启应用后重试。',
      creatorRetry: '重试',
      creatorAddTitle: '添加博主',
      creatorAddDialogIntro: () => '支持频道链接、@handle、旧式 /c/ 或 /user/ 链接，或 UC 开头的频道 ID。',
      creatorAddLabel: '频道地址或 ID',
      creatorAddHint: () => '例如 https://www.youtube.com/@GoogleDevelopers',
      creatorAddCancel: '取消',
      creatorAddSubmitting: '正在解析频道…',
      creatorAddSuccess: '已关注 {name}，正在检查新作品…',
      creatorErrInputTooLong: '输入过长，请只粘贴一条频道链接或频道 ID。',
      creatorErrInvalidInput: '无法识别该频道。',
      creatorErrNotAChannel: '这是作品链接，请粘贴博主主页链接。',
      creatorErrChannelNotFound: '找不到该频道。',
      creatorErrCredentialMissing: '未配置 YouTube API Key。',
      creatorCredentialOpen: '配置 API Key',
      creatorCredentialTitle: 'YouTube Data API v3 密钥',
      creatorCredentialIntro: '密钥只保存在本机。',
      creatorCredentialLabel: 'API Key',
      creatorCredentialPlaceholder: '粘贴以 AIza 开头的 API Key',
      creatorCredentialHint: '获取方式：Google Cloud Console。',
      creatorCredentialSave: '保存',
      creatorCredentialSaving: '保存中…',
      creatorCredentialSaved: '已保存（末四位 {fingerprint}）。',
      creatorCredentialWarnShape: '已保存，但该值不像 Google API Key。',
      creatorCredentialClear: '清除',
      creatorCredentialCleared: '已清除密钥。',
      creatorCredentialClose: '关闭',
      creatorCredentialInvalid: 'API Key 格式不正确。',
      creatorCredentialUnavailable: '系统密钥库不可用。',
      creatorCredentialPersistFailed: '保存失败，请重试。',
      creatorCredentialStatusUnknown: '正在读取密钥状态…',
      creatorCredentialStatusOk: '已配置（末四位 {fingerprint}）',
      creatorCredentialStatusNotConfigured: '未配置 YouTube API Key —— 添加博主前请先配置。',
      creatorCredentialStatusUnavailable: '系统密钥库不可用。',
      creatorCredentialStatusDecryptFailed: '已保存的 API Key 无法解密。请重新填写。',
      creatorCredentialStatusReadFailed: '本地存储读取失败，无法确认密钥状态。',
      creatorDependencyOptionalHint: '字幕增强依赖未就绪：仍可发现与采集，正文质量会降级。可执行：{command}',
      creatorPlatformLabel: '平台',
      creatorPlatformDouyin: '抖音',
      creatorPlatformXiaohongshu: '小红书',
      creatorPlatformYoutube: 'YouTube',
      creatorAddPlatformAuto: '已识别为 {platform}',
      creatorErrWrongPlatform: '这是其他平台的链接。',
      creatorErrUnsupportedPlatform: '暂不支持该平台。',
      creatorErrCredentialMissingForPlatform: '未登录 {platform} 账号。',
      creatorErrSignatureFailed: '{platform} 接口校验失败，登录态可能已过期。请重新登录。',
    },
  },
  en: { collection: {} },
}

const disc = (over = {}) => ({
  id: 'd1', title: '新视频', thumbnail_url: '', content_quality: 'full',
  collect_state: 'pending', ...over,
})
const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

function mountMonitor () {
  return mount(CreatorMonitor, {
    global: { plugins: [i18n], mocks: {} },
  })
}

const creator = (over = {}) => ({
  id: 'c1', platform: 'youtube', external_id: 'UC_a', display_name: '频道A',
  capability_tier: 'official', enabled: 1, status: 'active',
  consecutive_failures: 0, pendingCount: 2, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.electronAPI = {
    creatorList: vi.fn().mockResolvedValue({ code: 0, items: [creator()], totalPending: 2 }),
    creatorFollow: vi.fn().mockResolvedValue({ code: 0, creator: creator(), follow: {} }),
    creatorUnfollow: vi.fn().mockResolvedValue({ code: 0 }),
    creatorToggle: vi.fn().mockResolvedValue({ code: 0, follow: {} }),
    creatorCheckNow: vi.fn().mockResolvedValue({ code: 0, found: 3, inserted: 2 }),
    creatorDiscoveries: vi.fn().mockResolvedValue({ code: 0, items: [] }),
    creatorCollect: vi.fn().mockResolvedValue({ code: 0, collected: 5, remain: 0, truncated: false }),
    creatorCollectOne: vi.fn().mockResolvedValue({ code: 0, collected: 1 }),
    creatorSkipOne: vi.fn().mockResolvedValue({ code: 0 }),
    // 2026-10-12 新增：凭证与依赖状态。**不补这两个桩会让每个用例都假红**——
    // 组件在 onMounted 里会调它们，而 call() 对"桥上有名但方法缺失"的处理是
    // 置降级态（这是刻意的），于是所有用例都会多出一条「服务未就绪」横幅。
    creatorCredentialStatus: vi.fn().mockResolvedValue({ code: 0, status: 'ok', fingerprint: 'ab12' }),
    creatorCredentialSet: vi.fn().mockResolvedValue({ code: 0, status: 'ok', fingerprint: 'ab12', looksLikeGoogleKey: true }),
    creatorCredentialClear: vi.fn().mockResolvedValue({ code: 0, status: 'not_configured' }),
    creatorPlatforms: vi.fn().mockResolvedValue({ code: 0, platforms: [ { id: 'youtube', label: 'YouTube', localeKey: 'creatorPlatformYoutube', supported: true, hasSession: true }, { id: 'douyin', label: '抖音', localeKey: 'creatorPlatformDouyin', supported: true, hasSession: false }, { id: 'xiaohongshu', label: '小红书', localeKey: 'creatorPlatformXiaohongshu', supported: true, hasSession: false } ] }),
    creatorDependencyStatus: vi.fn().mockResolvedValue({
      code: 0,
      discovery: { ready: true, reason: '' },
      transcript: { ready: true, optional: true, reason: '', installHint: '' },
    }),
  }
})

describe('CreatorMonitor · 空态', () => {
  it('未关注任何博主时显示引导空态', async () => {
    globalThis.electronAPI.creatorList.mockResolvedValue({ code: 0, items: [], totalPending: 0 })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-empty"]').exists()).toBe(true)
  })
})

describe('CreatorMonitor · 博主列表', () => {
  it('渲染博主与待采集角标', async () => {
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-list"]').exists()).toBe(true)
    expect(w.find('[data-testid="creator-pending"]').text()).toContain('2')
  })

  it('能力等级按 tier 渲染不同徽章', async () => {
    globalThis.electronAPI.creatorList.mockResolvedValue({
      code: 0, totalPending: 0,
      items: [creator({ id: 'c1', capability_tier: 'official' }),
              creator({ id: 'c2', capability_tier: 'best_effort' }),
              creator({ id: 'c3', capability_tier: 'unsupported' })],
    })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-item-c1"] [data-tier="official"]').text()).toBe('官方接口')
    expect(w.find('[data-testid="creator-item-c2"] [data-tier="best_effort"]').exists()).toBe(true)
    expect(w.find('[data-testid="creator-item-c3"] [data-tier="unsupported"]').exists()).toBe(true)
  })

  it('暂停中的任务显示置灰样式', async () => {
    globalThis.electronAPI.creatorList.mockResolvedValue({
      code: 0, totalPending: 0, items: [creator({ enabled: 0 })],
    })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-item-c1"]').classes()).toContain('disabled')
  })

  it('auto_paused 显示连续失败次数与原因', async () => {
    globalThis.electronAPI.creatorList.mockResolvedValue({
      code: 0, totalPending: 0,
      items: [creator({ status: 'auto_paused', consecutive_failures: 3, paused_reason: 'net' })],
    })
    const w = mountMonitor()
    await flushPromises()
    const txt = w.find('[data-testid="creator-item-c1"]').text()
    expect(txt).toContain('3')
    expect(txt).toContain('net')
  })

  it('fatal_paused 与 auto_paused 用不同文案（凭证问题不该让用户去点重试）', async () => {
    globalThis.electronAPI.creatorList.mockResolvedValue({
      code: 0, totalPending: 0, items: [creator({ status: 'fatal_paused', paused_reason: 'keyInvalid' })],
    })
    const w = mountMonitor()
    await flushPromises()
    expect(w.text()).toContain('API Key')
    expect(w.text()).not.toContain('creatorAutoPaused')
  })
})

describe('CreatorMonitor · 一键采集', () => {
  it('不传 count，由主进程应用默认数量', async () => {
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({ code: 0, items: [disc()] })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    await w.find('[data-testid="creator-collect-all"]').trigger('click')
    await nextTick()
    expect(globalThis.electronAPI.creatorCollect).toHaveBeenCalled()
    expect(globalThis.electronAPI.creatorCollect.mock.calls[0][0].count).toBeUndefined()
  })

  it('超限时提示上限值，不静默截断', async () => {
    globalThis.electronAPI.creatorCollect.mockResolvedValue({
      code: -10, reason: 'creator:count_exceeds_limit', max: 100,
    })
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({ code: 0, items: [disc()] })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    await w.find('[data-testid="creator-collect-all"]').trigger('click')
    await nextTick()
    expect(ElMessage.warning).toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('采少于可采数时 MUST 告知剩余（禁止静默截断）', async () => {
    globalThis.electronAPI.creatorCollect.mockResolvedValue({
      code: 0, collected: 5, available: 12, remain: 7, truncated: true,
    })
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({ code: 0, items: [disc()] })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    await w.find('[data-testid="creator-collect-all"]').trigger('click')
    await nextTick()
    expect(ElMessage.success).toHaveBeenCalled()
    expect(ElMessage.info).toHaveBeenCalled()
    expect(ElMessage.info.mock.calls[0][0]).toContain('7')
  })

  it('全部采完时不提示剩余', async () => {
    globalThis.electronAPI.creatorCollect.mockResolvedValue({
      code: 0, collected: 5, available: 5, remain: 0, truncated: false,
    })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-collect-all"]').trigger('click')
    await nextTick()
    expect(ElMessage.info).not.toHaveBeenCalled()
  })

  it('无新作品时按钮禁用', async () => {
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({ code: 0, items: [] })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-collect-all"]').attributes('disabled')).toBeDefined()
  })
})

describe('CreatorMonitor · 发现列表与单条采集', () => {
  const disc = (over = {}) => ({
    id: 'd1', title: '新视频', thumbnail_url: '', content_quality: 'full',
    collect_state: 'pending', ...over,
  })

  it('渲染新作品与质量徽章', async () => {
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({ code: 0, items: [disc()] })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    expect(w.find('[data-testid="discovery-d1"]').exists()).toBe(true)
    expect(w.find('[data-testid="discovery-d1"] [data-quality="full"]').exists()).toBe(true)
  })

  it('单条采集零填参', async () => {
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({ code: 0, items: [disc()] })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    await w.find('[data-testid="creator-collect-one"]').trigger('click')
    await nextTick()
    expect(globalThis.electronAPI.creatorCollectOne).toHaveBeenCalledWith({ discoveryId: 'd1' })
  })

  it('已采集项不显示采集按钮，改显示已采集状态', async () => {
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({
      code: 0, items: [disc({ collect_state: 'collected', collected_at: '2026-10-07 12:00' })],
    })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    expect(w.find('[data-testid="creator-collect-one"]').exists()).toBe(false)
    expect(w.find('[data-testid="creator-collected"]').exists()).toBe(true)
  })

  it('quality=stub 使用「仅标题与简介」文案（区别于 full）', async () => {
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({
      code: 0, items: [disc({ content_quality: 'stub' })],
    })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    expect(w.find('[data-quality="stub"]').text()).toBe('仅标题与简介')
  })
})

describe('CreatorMonitor · 降级与错误', () => {
  it('服务未就绪时显示降级提示而非空白', async () => {
    globalThis.electronAPI.creatorList.mockResolvedValue({
      code: -1, reason: 'service-unavailable', message: 'x',
    })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-degraded"]').exists()).toBe(true)
  })

  it('service-unavailable 显示「服务未就绪」，**不得**复述成「缺少采集依赖。请执行：」', async () => {
    // 2026-10-12 事故的用户可见面就是这个：11 个 creator 通道全降级后，
    // 整页只剩一句「缺少采集依赖。请执行：」且命令位恒空——把用户引向装 Python 包，
    // 而真因是主进程没接线（重启才对）。这条锁住文案分因，防止回归。
    globalThis.electronAPI.creatorList.mockResolvedValue({
      code: -1, reason: 'service-unavailable', message: 'x',
    })
    const w = mountMonitor()
    await flushPromises()
    const text = w.find('[data-testid="creator-degraded"]').text()
    expect(text).toContain('博主监控服务未就绪')
    expect(text).not.toContain('缺少采集依赖')
    expect(text).not.toContain('请执行：')
  })

  it('IPC 返回非 0 时弹错误（降级返回长得像成功，最容易漏）', async () => {
    globalThis.electronAPI.creatorCollectOne.mockResolvedValue({
      code: -11, reason: 'creator:invalid_input', message: 'bad',
    })
    globalThis.electronAPI.creatorDiscoveries.mockResolvedValue({ code: 0, items: [disc()] })
    const w = mountMonitor()
    await flushPromises(); await nextTick()
    await w.find('[data-testid="creator-collect-one"]').trigger('click')
    await nextTick()
    expect(ElMessage.error).toHaveBeenCalledWith('bad')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('electronAPI 缺失时不抛异常（渲染层先于 preload 就绪的时序）', async () => {
    const saved = globalThis.electronAPI
    delete globalThis.electronAPI
    expect(() => mountMonitor()).not.toThrow()
    globalThis.electronAPI = saved
  })
})

describe('CreatorMonitor · 凭证四态横幅', () => {
  it('未配置时显示横幅并给「配置 API Key」入口', async () => {
    globalThis.electronAPI.creatorCredentialStatus.mockResolvedValue({ code: 0, status: 'not_configured' })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-credential-banner"]').exists()).toBe(true)
    expect(w.find('[data-testid="creator-credential-open"]').exists()).toBe(true)
  })

  it.each([
    ['unavailable', '系统密钥库不可用'],
    ['decrypt_failed', '无法解密'],
    ['read_failed', '读取失败'],
  ])('%s 状态各有专门文案（多种"没配好"不能合成一句）', async (status, expectText) => {
    globalThis.electronAPI.creatorCredentialStatus.mockResolvedValue({ code: 0, status })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-credential-status-text"]').text()).toContain(expectText)
  })

  it('已配置时不显示横幅（不打扰已就绪的用户）', async () => {
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-credential-banner"]').exists()).toBe(false)
  })

  it('凭证服务自身未接线时不冒充「系统密钥库不可用」', async () => {
    // 主进程降级时 credential-status 会回 credential-service-unavailable：
    // 那是"服务没起来"，与"系统密钥库不可用"是两件事，不能顶替 degraded 横幅。
    globalThis.electronAPI.creatorCredentialStatus.mockResolvedValue({
      code: 0, status: 'unavailable', reason: 'credential-service-unavailable',
    })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-credential-banner"]').exists()).toBe(false)
  })

  it('点击入口打开凭证弹窗', async () => {
    globalThis.electronAPI.creatorCredentialStatus.mockResolvedValue({ code: 0, status: 'not_configured' })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-credential-open"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="creator-credential-dialog"]').exists()).toBe(true)
  })
})

describe('CreatorMonitor · 可选依赖提示（非阻塞）', () => {
  it('字幕腿未就绪时显示提示并带确切命令，但**不**显示阻塞横幅', async () => {
    globalThis.electronAPI.creatorDependencyStatus.mockResolvedValue({
      code: 0,
      discovery: { ready: true, reason: '' },
      transcript: { ready: false, optional: true, reason: 'python-backend-not-running', installHint: 'pip install content-aggregator -i https://pypi.tuna.tsinghua.edu.cn/simple' },
    })
    const w = mountMonitor()
    await flushPromises()
    const hint = w.find('[data-testid="creator-dependency-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('pip install content-aggregator')
    expect(w.find('[data-testid="creator-degraded"]').exists()).toBe(false)
  })

  it('字幕腿就绪时不显示提示', async () => {
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-dependency-hint"]').exists()).toBe(false)
  })
})

describe('CreatorMonitor · 添加博主（替换 window.prompt）', () => {
  it('点「关注」打开应用内弹窗，不再调用 window.prompt', async () => {
    // 旧实现是 window.prompt(...)。Electron 渲染进程**不支持** prompt（调用即抛），
    // 所以「添加博主」这条路当时根本不存在。这条锁住"必须走应用内弹窗"。
    const promptSpy = vi.fn()
    const originalPrompt = globalThis.window.prompt
    globalThis.window.prompt = promptSpy
    try {
      const w = mountMonitor()
      await flushPromises()
      await w.find('[data-testid="creator-add"]').trigger('click')
      await nextTick()
      expect(w.find('[data-testid="creator-add-dialog"]').exists()).toBe(true)
      expect(promptSpy).not.toHaveBeenCalled()
    } finally {
      globalThis.window.prompt = originalPrompt
    }
  })

  it('提交后按 canonical 解析结果落库，并立即触发首次检查（PRD §8.1）', async () => {
    globalThis.electronAPI.creatorFollow.mockResolvedValue({
      code: 0, creator: creator({ id: 'c9', display_name: '新频道' }), follow: { id: 'f9' },
    })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="creator-add-input"]').setValue('@NewChannel')
    await w.find('[data-testid="creator-add-confirm"]').trigger('click')
    await flushPromises()
    expect(globalThis.electronAPI.creatorFollow).toHaveBeenCalledWith({ input: '@NewChannel', platform: 'youtube' })
    // 关注后不探测会表现为「加了没用」——必须立刻检查一次
    expect(globalThis.electronAPI.creatorCheckNow).toHaveBeenCalledWith({ followId: 'f9' })
    expect(w.find('[data-testid="creator-add-dialog"]').exists()).toBe(false)
  })

  it('输入为空时提交按钮禁用（不发无意义请求）', async () => {
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="creator-add-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('频道解析失败按 reason 显示对应文案，弹窗保持打开（输入不丢）', async () => {
    globalThis.electronAPI.creatorFollow.mockResolvedValue({
      code: -12, reason: 'creator:not_a_channel', message: '这是作品链接',
    })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="creator-add-input"]').setValue('https://www.youtube.com/watch?v=abc')
    await w.find('[data-testid="creator-add-confirm"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="creator-add-error"]').text()).toContain('作品链接')
    expect(w.find('[data-testid="creator-add-dialog"]').exists()).toBe(true)
  })

  it('未配置 API Key 时直接打开凭证弹窗（不让用户自己去找入口）', async () => {
    globalThis.electronAPI.creatorFollow.mockResolvedValue({
      code: -12, reason: 'creator:credential_missing', message: '未配置',
    })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="creator-add-input"]').setValue('@SomeChannel')
    await w.find('[data-testid="creator-add-confirm"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="creator-credential-dialog"]').exists()).toBe(true)
  })

  it('超过 512 字符本地拦下（不发请求）', async () => {
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="creator-add-input"]').setValue('x'.repeat(600))
    await w.find('[data-testid="creator-add-confirm"]').trigger('click')
    await flushPromises()
    expect(globalThis.electronAPI.creatorFollow).not.toHaveBeenCalled()
    expect(w.find('[data-testid="creator-add-error"]').text()).toContain('输入过长')
  })
})

describe('CreatorMonitor · 多平台（PRD-CREATOR-MULTI-PLATFORM）', () => {
  it('提交时把所选平台一起发给主进程', async () => {
    globalThis.electronAPI.creatorFollow.mockResolvedValue({
      code: 0, creator: creator({ id: 'c9', platform: 'douyin', external_id: 'MS4wLjABAAAA' + 'A'.repeat(28) }), follow: { id: 'f9' },
    })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    // 渲染平台 chip 并选择抖音
    expect(w.find('[data-testid="creator-add-platform-douyin"]').exists()).toBe(true)
    await w.find('[data-testid="creator-add-platform-douyin"]').trigger('click')
    await w.find('[data-testid="creator-add-input"]').setValue('MS4wLjABAAAA' + 'A'.repeat(28))
    await w.find('[data-testid="creator-add-confirm"]').trigger('click')
    await flushPromises()
    const call = globalThis.electronAPI.creatorFollow.mock.calls[0][0]
    expect(call.platform).toBe('douyin')
  })

  it('平台 URL 自动识别提示', async () => {
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="creator-add-input"]').setValue('https://www.xiaohongshu.com/user/profile/' + 'a'.repeat(24))
    await nextTick()
    expect(w.find('[data-testid="creator-add-platform-auto"]').exists()).toBe(true)
    expect(w.find('[data-testid="creator-add-platform-auto"]').text()).toContain('小红书')
  })

  it('博主列表项渲染平台徽标（data-platform）', async () => {
    globalThis.electronAPI.creatorList.mockResolvedValue({
      code: 0, totalPending: 0,
      items: [creator({ id: 'c1', platform: 'douyin' }), creator({ id: 'c2', platform: 'youtube' })],
    })
    const w = mountMonitor()
    await flushPromises()
    expect(w.find('[data-testid="creator-item-c1"] [data-platform="douyin"]').exists()).toBe(true)
    expect(w.find('[data-testid="creator-item-c2"] [data-platform="youtube"]').exists()).toBe(true)
  })

  it('抖音链接给小红书平台 → wrong_platform 文案', async () => {
    globalThis.electronAPI.creatorFollow.mockResolvedValue({
      code: -12, reason: 'creator:wrong_platform', message: 'x',
    })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="creator-add-platform-xiaohongshu"]').trigger('click')
    await w.find('[data-testid="creator-add-input"]').setValue('https://www.douyin.com/user/' + 'A'.repeat(28).replace(/A/g, 'A'))
    await w.find('[data-testid="creator-add-confirm"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="creator-add-error"]').text()).toContain('其他平台')
  })

  it('签名失败 → 引导重新登录的文案（带平台名）', async () => {
    globalThis.electronAPI.creatorFollow.mockResolvedValue({
      code: -12, reason: 'creator:signature_failed', message: 'x',
    })
    const w = mountMonitor()
    await flushPromises()
    await w.find('[data-testid="creator-add"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="creator-add-platform-douyin"]').trigger('click')
    await w.find('[data-testid="creator-add-input"]').setValue('MS4wLjABAAAA' + 'A'.repeat(28))
    await w.find('[data-testid="creator-add-confirm"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="creator-add-error"]').text()).toContain('抖音')
    expect(w.find('[data-testid="creator-add-error"]').text()).toContain('登录')
  })
})