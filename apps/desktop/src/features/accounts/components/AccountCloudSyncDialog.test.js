// @ts-check
/**
 * AccountCloudSyncDialog 渲染层测试（PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §10 / §11）
 *
 * mock 口径（AGENTS.md「门禁断言随实现迁移同步」）：
 *   - 只 mock 被测组件当前真实调用的依赖：publisher 的五个新方法、useNotify、useEmbeddedViewSuspension；
 *   - 界面文案一律与 i18n **键** 的解析结果比较（不写 locale 字面量），文案调整不会造成假红；
 *   - 断言用 data-testid / 语义 class，不用内部枚举值断言已本地化文本。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const _publisher = vi.hoisted(() => ({
  accountsCloudDigest: vi.fn(),
  accountsCloudSync: vi.fn(),
  accountsCloudSyncAbort: vi.fn(),
  accountsCloudDisconnect: vi.fn(),
  onAccountsCloudSyncProgress: vi.fn(),
}))

const _notify = vi.hoisted(() => ({
  notifyConfirm: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}))

const _suspension = vi.hoisted(() => ({
  suspendEmbeddedViewsForOverlay: vi.fn(async () => true),
  releaseEmbeddedViewsForOverlay: vi.fn(async () => true),
}))

vi.mock('@/api/publisher', () => _publisher)
vi.mock('@/composables/useNotify', () => ({ useNotify: () => _notify }))
vi.mock('@/composables/useEmbeddedViewSuspension', () => _suspension)

import AccountCloudSyncDialog from './AccountCloudSyncDialog.vue'

const OVERLAY_OWNER = 'account-cloud-sync-dialog'
const LABELS = { douyin: 'DY', wechat_mp: 'WX', zhihu: 'ZH', bilibili: 'BL' }

function tk (key, params) {
  return params ? i18n.global.t(key, params) : i18n.global.t(key)
}

function digestOk (overrides = {}) {
  return {
    code: 0,
    data: {
      total: 7,
      byPlatform: [
        { platform: 'zhihu', count: 2 },
        { platform: 'douyin', count: 3 },
        { platform: 'wechat_mp', count: 2 },
      ],
      tombstones: 2,
      localCount: 4,
      reachable: true,
      ...overrides,
    },
  }
}

async function flush (times = 8) {
  for (let index = 0; index < times; index += 1) await nextTick()
}

function mountDialog (props = {}) {
  return mount(AccountCloudSyncDialog, {
    props: {
      visible: true,
      localCount: 4,
      platformLabel: id => LABELS[id] || id,
      platformIcon: () => '',
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        Transition: { template: '<div><slot /></div>' },
      },
    },
  })
}

/** 安装进度事件桩：返回 (payload) => void 的出码器与退订计数 */
function installProgressSource () {
  let emit = null
  let unsubscribed = 0
  _publisher.onAccountsCloudSyncProgress.mockImplementation(cb => {
    emit = cb
    return () => { unsubscribed += 1; emit = null }
  })
  return {
    push: payload => { if (emit) emit(payload) },
    get subscribed () { return Boolean(emit) },
    get unsubscribed () { return unsubscribed },
  }
}

describe('AccountCloudSyncDialog — 摘要态', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk())
    _publisher.accountsCloudSync.mockResolvedValue({ code: 0, data: { created: 0, updated: 0, unchanged: 0, restored: 0, skipped: 0, conflicts: 0, invalid: 0, failed: 0, items: [] } })
    _publisher.accountsCloudDisconnect.mockResolvedValue({ code: 0, data: { deletedAccounts: 7, deletedTombstones: 2 } })
    _publisher.onAccountsCloudSyncProgress.mockReturnValue(() => {})
    _notify.notifyConfirm.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('挂在 UiModal 内并暴露合同 test-id；打开时先挂起内嵌视图（overlay 合同）', async () => {
    const wrapper = await (async () => { const w = mountDialog(); await flush(); return w })()
    expect(wrapper.find(`[data-testid="${OVERLAY_OWNER}"]`).exists()).toBe(true)
    expect(_suspension.suspendEmbeddedViewsForOverlay).toHaveBeenCalledWith(OVERLAY_OWNER)
    expect(_suspension.releaseEmbeddedViewsForOverlay).not.toHaveBeenCalled()
    wrapper.unmount()
    await flush()
    expect(_suspension.releaseEmbeddedViewsForOverlay).toHaveBeenCalledWith(OVERLAY_OWNER)
  })

  it('加载中文案先出现，且未拿到数据前不渲染任何计数行（不得先显示「共 0 个」）', async () => {
    let release
    _publisher.accountsCloudDigest.mockReturnValue(new Promise(resolve => { release = resolve }))
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.get('[data-testid="cloud-digest-loading"]').text()).toBe(tk('accountsPage.cloudDigestLoading'))
    expect(wrapper.find('[data-testid="cloud-digest-total"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cloud-digest-local"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('0')

    release(digestOk())
    await flush()
    expect(wrapper.find('[data-testid="cloud-digest-loading"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="cloud-digest-total"]').text()).toBe(tk('accountsPage.cloudDigestTotal', { total: 7 }))
  })

  it('渲染云端真实条数、本机参与数与墓碑说明', async () => {
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.get('[data-testid="cloud-digest-total"]').text()).toBe(tk('accountsPage.cloudDigestTotal', { total: 7 }))
    expect(wrapper.get('[data-testid="cloud-digest-local"]').text()).toBe(tk('accountsPage.cloudDigestLocal', { local: 4 }))
    expect(wrapper.get('[data-testid="cloud-digest-tombstone"]').text()).toBe(tk('accountsPage.cloudDigestTombstone', { count: 2 }))
    expect(wrapper.get('[data-testid="cloud-digest-privacy"]').text()).toBe(tk('accountsPage.cloudDigestPrivacy'))
  })

  it('平台分布顺序稳定：count 降序、platform 升序，不依赖响应数组顺序', async () => {
    const wrapper = mountDialog()
    await flush()

    const rows = wrapper.findAll('[data-testid^="cloud-digest-platform-"]')
    expect(rows.map(row => row.attributes('data-testid'))).toEqual([
      'cloud-digest-platform-douyin',
      'cloud-digest-platform-wechat_mp',
      'cloud-digest-platform-zhihu',
    ])
    expect(rows[0].text()).toContain(LABELS.douyin)
    expect(rows[0].find('.cloud-digest-platform-count').text()).toBe('3')
  })

  it('云端为空时走「首次上传」文案，而不是零计数', async () => {
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk({ total: 0, byPlatform: [], tombstones: 0 }))
    const wrapper = mountDialog()
    await flush()

    const emptyCopy = tk('accountsPage.cloudDigestEmpty')
    expect(wrapper.get('[data-testid="cloud-digest-total"]').text()).toBe(emptyCopy)
    expect(wrapper.text()).not.toContain(tk('accountsPage.cloudDigestTotal', { total: 0 }))
    expect(wrapper.find('[data-testid="cloud-digest-platforms"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cloud-digest-tombstone"]').exists()).toBe(false)
    // 隐私提示恒显示
    expect(wrapper.find('[data-testid="cloud-digest-privacy"]').exists()).toBe(true)
  })

  it('无墓碑时不显示墓碑说明行', async () => {
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk({ tombstones: 0 }))
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.find('[data-testid="cloud-digest-tombstone"]').exists()).toBe(false)
  })

  it('不可达时显示失败文案 + 重试入口，且绝不出现「云端现有 0 个」', async () => {
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk({ total: 0, byPlatform: [], tombstones: 0, reachable: false }))
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.get('[data-testid="cloud-digest-error"]').text()).toBe(tk('accountsPage.cloudDigestFailed'))
    expect(wrapper.find('[data-testid="cloud-digest-total"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cloud-digest-local"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(tk('accountsPage.cloudDigestTotal', { total: 0 }))
    expect(wrapper.text()).not.toContain(tk('accountsPage.cloudDigestEmpty'))
    // 重试替换同步按钮
    expect(wrapper.find('[data-testid="cloud-digest-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-sync-start"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="cloud-disconnect"]').attributes('disabled')).toBeDefined()
  })

  it('摘要调用失败（code!==0）同样进入失败态，点重试再次拉取', async () => {
    _publisher.accountsCloudDigest.mockResolvedValue({ code: -1, message: 'boom' })
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.find('[data-testid="cloud-digest-error"]').exists()).toBe(true)

    _publisher.accountsCloudDigest.mockResolvedValue(digestOk())
    await wrapper.get('[data-testid="cloud-digest-retry"]').trigger('click')
    await flush()

    expect(_publisher.accountsCloudDigest).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="cloud-digest-total"]').exists()).toBe(true)
  })

  it('取消关闭：accountsCloudSync 调用次数为 0，并释放内嵌视图挂起', async () => {
    const wrapper = mountDialog()
    await flush()

    await wrapper.get('[data-testid="cloud-sync-cancel"]').trigger('click')
    await flush()

    expect(_publisher.accountsCloudSync).not.toHaveBeenCalled()
    expect(_publisher.accountsCloudSync.mock.calls.length).toBe(0)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(_suspension.releaseEmbeddedViewsForOverlay).toHaveBeenCalledWith(OVERLAY_OWNER)
  })

  it('本机 0 账号时【同步】禁用（PRD §10.2）', async () => {
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk({ localCount: 0 }))
    const wrapper = mountDialog({ localCount: 0 })
    await flush()
    expect(wrapper.get('[data-testid="cloud-sync-start"]').attributes('disabled')).toBeDefined()
  })
})

describe('AccountCloudSyncDialog — 过程态与终态', () => {
  /** 让 accountsCloudSync 由测试自己决定何时收口，模拟批次仍在跑 */
  let resolveSync
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk())
    _publisher.accountsCloudSync.mockReturnValue(new Promise(resolve => { resolveSync = resolve }))
    _publisher.accountsCloudSyncAbort.mockResolvedValue({ code: 0, data: { aborted: true } })
    _notify.notifyConfirm.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function syncSummary (data) {
    return {
      code: 0,
      data: { created: 0, updated: 0, unchanged: 0, restored: 0, skipped: 0, conflicts: 0, invalid: 0, failed: 0, items: [], ...data },
    }
  }

  it('点【同步】切到同弹窗过程态：进度行 + 进度条 + 订阅进度事件', async () => {
    const source = installProgressSource()
    const wrapper = mountDialog()
    await flush()

    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    await flush()

    expect(wrapper.emitted('running-change')).toEqual([[true]])
    expect(wrapper.find('[data-testid="cloud-digest-total"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="cloud-sync-progress"]').text()).toBe(tk('accountsPage.cloudSyncProgress', { done: 0, total: 4 }))
    expect(wrapper.find('[data-testid="cloud-digest-platforms"]').exists()).toBe(false)
    expect(source.subscribed).toBe(true)
    expect(wrapper.get('.batch-check-bar-inner').attributes('style')).toContain('width: 0%')

    resolveSync(syncSummary({ created: 1, items: [{ platform: 'douyin', accountId: 'a1', name: 'n', outcome: 'created' }] }))
    await flush()
    expect(source.unsubscribed).toBe(1)
  })

  it('逐条渲染：start 边界先落一行，done 边界再落结果标签与颜色语义', async () => {
    const source = installProgressSource()
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    await flush()

    source.push({ phase: 'start', index: 0, total: 2, platform: 'douyin', accountId: 'a1', name: 'Douyin Main' })
    await nextTick()

    const row = wrapper.get('[data-testid="cloud-sync-item-a1"]')
    expect(row.text()).toContain('Douyin Main')
    expect(row.text()).toContain(LABELS.douyin)
    expect(row.get('[data-testid="cloud-sync-item-outcome-a1"]').text()).toBe('')
    expect(wrapper.get('[data-testid="cloud-sync-current"]').text()).toBe(LABELS.douyin)
    expect(wrapper.get('[data-testid="cloud-sync-progress"]').text()).toBe(tk('accountsPage.cloudSyncProgress', { done: 0, total: 2 }))

    source.push({ phase: 'done', index: 0, total: 2, platform: 'douyin', accountId: 'a1', name: 'Douyin Main', outcome: 'created', elapsedMs: 900 })
    await nextTick()

    expect(wrapper.get('[data-testid="cloud-sync-item-outcome-a1"]').text()).toBe(tk('accountsPage.cloudOutcomeCreated'))
    expect(wrapper.get('[data-testid="cloud-sync-item-outcome-a1"]').classes()).toContain('is-success')
    expect(wrapper.get('[data-testid="cloud-sync-progress"]').text()).toBe(tk('accountsPage.cloudSyncProgress', { done: 1, total: 2 }))
    // in-flight 集合随 done 清空
    expect(wrapper.find('[data-testid="cloud-sync-current"]').exists()).toBe(false)

    source.push({ phase: 'done', index: 1, total: 2, platform: 'zhihu', accountId: 'a2', name: 'Zhihu', outcome: 'invalid-credential', code: 'CREDENTIAL_TOO_LARGE' })
    await nextTick()
    const danger = wrapper.get('[data-testid="cloud-sync-item-outcome-a2"]')
    expect(danger.text()).toBe(tk('accountsPage.cloudOutcomeInvalidCredential'))
    expect(danger.classes()).toContain('is-danger')
    expect(wrapper.get('[data-testid="cloud-sync-item-reason-a2"]').text()).toBe(tk('accountsPage.cloudSyncErr.credentialTooLarge'))

    resolveSync(syncSummary({ created: 1, invalid: 1, items: [] }))
    await flush()
  })

  it('跳过/冲突/身份不可用的标签与色语义各自到位', async () => {
    const source = installProgressSource()
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    await flush()

    source.push({ phase: 'done', index: 0, total: 3, platform: 'zhihu', accountId: 'b1', name: 'Z1', outcome: 'skipped-tombstone' })
    source.push({ phase: 'done', index: 1, total: 3, platform: 'douyin', accountId: 'b2', name: 'D1', outcome: 'conflict-resolved-local' })
    source.push({ phase: 'done', index: 2, total: 3, platform: 'bilibili', accountId: 'b3', name: 'B1', outcome: 'uid-unavailable' })
    await nextTick()

    expect(wrapper.get('[data-testid="cloud-sync-item-outcome-b1"]').text()).toBe(tk('accountsPage.cloudOutcomeSkippedTombstone'))
    expect(wrapper.get('[data-testid="cloud-sync-item-outcome-b1"]').classes()).toContain('is-muted')
    expect(wrapper.get('[data-testid="cloud-sync-item-outcome-b2"]').text()).toBe(tk('accountsPage.cloudOutcomeConflictLocal'))
    expect(wrapper.get('[data-testid="cloud-sync-item-outcome-b2"]').classes()).toContain('is-warning')
    expect(wrapper.get('[data-testid="cloud-sync-item-outcome-b3"]').text()).toBe(tk('accountsPage.cloudOutcomeUidUnavailable'))

    resolveSync(syncSummary({ skipped: 1, conflicts: 1, unchanged: 1 }))
    await flush()
  })

  it('部分成功时汇总句同时给出成功数与失败数，并列出逐类计数', async () => {
    installProgressSource()
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')

    resolveSync(syncSummary({
      created: 2,
      failed: 1,
      items: [
        { platform: 'douyin', accountId: 'c1', name: 'C1', outcome: 'created' },
        { platform: 'wechat_mp', accountId: 'c2', name: 'C2', outcome: 'created' },
        { platform: 'zhihu', accountId: 'c3', name: 'C3', outcome: 'failed', code: 'SYNC_BUDGET_EXCEEDED' },
      ],
    }))
    await flush()

    expect(wrapper.get('[data-testid="cloud-sync-summary-text"]').text())
      .toBe(tk('accountsPage.cloudSyncPartial', { ok: 2, fail: 1 }))
    expect(wrapper.get('[data-testid="cloud-sync-stat-created"]').text()).toBe(`${tk('accountsPage.cloudOutcomeCreated')} 2`)
    expect(wrapper.get('[data-testid="cloud-sync-stat-failed"]').text()).toBe(`${tk('accountsPage.cloudOutcomeFailed')} 1`)
    expect(wrapper.get('[data-testid="cloud-sync-item-reason-c3"]').text()).toBe(tk('accountsPage.cloudSyncErr.budgetExceeded'))
    // 终态只剩【完成】，不再提供「后台继续」
    expect(wrapper.find('[data-testid="cloud-sync-background"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cloud-sync-finish"]').exists()).toBe(true)
    expect(wrapper.emitted('synced')).toHaveLength(1)
    expect(wrapper.emitted('running-change')).toEqual([[true], [false]])
  })

  it('全部成功时汇总为完成句（恢复段为 0 则不出现）', async () => {
    installProgressSource()
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    resolveSync(syncSummary({ created: 3, updated: 1, restored: 0 }))
    await flush()
    expect(wrapper.get('[data-testid="cloud-sync-summary-text"]').text())
      .toBe(tk('accountsPage.cloudSyncDone', { created: 3, updated: 1, restored: 0 }))
  })

  it('全部失败时汇总为失败句', async () => {
    installProgressSource()
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    resolveSync(syncSummary({ failed: 4 }))
    await flush()
    expect(wrapper.get('[data-testid="cloud-sync-summary-text"]').text())
      .toBe(tk('accountsPage.cloudSyncAllFailed', { fail: 4 }))
  })

  it('批次整体失败（code!==0）：如实显示错误码文案，不谎报汇总', async () => {
    installProgressSource()
    _publisher.accountsCloudSync.mockResolvedValue({ code: -1, error: 'CLOUD_SYNC_IN_PROGRESS' })
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    await flush()

    expect(wrapper.find('[data-testid="cloud-sync-summary-text"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="cloud-sync-summary-error"]').text()).toBe(tk('accountsPage.cloudSyncErr.inProgress'))
    expect(_notify.notifyError).toHaveBeenCalledWith('accountsPage.cloudSyncErr.inProgress')
  })

  it('进行中关闭＝后台继续：不退订即取消批次，但必须退订进度事件并释放挂起', async () => {
    const source = installProgressSource()
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    await flush()
    source.push({ phase: 'start', index: 0, total: 4, platform: 'douyin', accountId: 'd1', name: 'D1' })
    await nextTick()

    await wrapper.get('[data-testid="cloud-sync-background"]').trigger('click')
    await flush()

    expect(source.unsubscribed).toBe(1)
    expect(source.subscribed).toBe(false)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(_suspension.releaseEmbeddedViewsForOverlay).toHaveBeenCalledWith(OVERLAY_OWNER)
    // 批次仍在进行：running-change 尚未回到 false
    expect(wrapper.emitted('running-change')).toEqual([[true]])

    resolveSync(syncSummary({ created: 1 }))
    await flush()
    expect(wrapper.emitted('running-change')).toEqual([[true], [false]])
  })

  it('秒表 1s tick；终态与卸载都不残留定时器', async () => {
    installProgressSource()
    const wrapper = mountDialog()
    await flush()

    vi.useFakeTimers()
    await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.get('[data-testid="cloud-sync-elapsed"]').text()).toBe(tk('accountsPage.cloudSyncElapsed', { seconds: 5 }))
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    resolveSync(syncSummary({ created: 1 }))
    await flush()
    vi.useRealTimers()
    expect(wrapper.find('[data-testid="cloud-sync-finish"]').exists()).toBe(true)

    vi.useFakeTimers()
    try {
      wrapper.unmount()
      await flush()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // ── 失败行原因文案：错误码 → 语义分组（PRD §7.5 全表收口）────────────────
  // 口径：
  //   - 断言一律与 i18n **键** 的解析结果比较，不写 locale 字面量（文案调整不假红）；
  //   - 每个分组 1 例，逐码喂进 done 事件，断言该行的原因栏渲染出组文案；
  //   - 未知码必须落兜底句（失败行永远有文字），且后端原始码只出现在 data-error-code
  //     属性上、绝不出现在任何用户可见文字里。
  describe('失败行原因文案（错误码分组与未知码兜底）', () => {
    /** 属于 invalidData 组的全部服务端字段/请求体校验码（validate-account.js 真源） */
    const INVALID_DATA_CODES = [
      'ACCOUNT_FIELD_NOT_ALLOWED',
      'ACCOUNT_PLATFORM_UNSUPPORTED',
      'ACCOUNT_UID_INVALID',
      'ACCOUNT_NAME_NOISE',
      'ACCOUNT_AVATAR_INVALID',
      'ACCOUNT_FOLLOWERS_INVALID',
      'ACCOUNT_TIMESTAMP_INVALID',
      'ACCOUNT_DEVICE_LABEL_INVALID',
      'ACCOUNT_BATCH_INVALID',
    ]

    /** 每次出码换一个 accountId：跨码复用同一 id 会让下一条码覆盖上一行，断言只吃得到最后一码 */
    let rowSeq = 0

    /** 起一个由本测试收口的批次，推入一条（可带码的）done 事件，返回该行的可读片段 */
    async function openFailedRow (code, outcome = 'failed') {
      // 每轮换一个**未收口**的批次 promise：外层 beforeEach 的 resolveSync 是一次性的，
      // 循环里复用会让第二轮起批次立刻"已结束"、进度事件被退订，行根本渲染不出来
      let resolveBatch
      _publisher.accountsCloudSync.mockReturnValue(new Promise(resolve => { resolveBatch = resolve }))
      const source = installProgressSource()
      const wrapper = mountDialog()
      await flush()
      await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
      await flush()
      const id = `e${(rowSeq += 1)}`
      const payload = { phase: 'done', index: 0, total: 1, platform: 'zhihu', accountId: id, name: 'Z1', outcome }
      if (code !== undefined) payload.code = code
      source.push(payload)
      await nextTick()
      return {
        wrapper,
        source,
        id,
        row: () => wrapper.get(`[data-testid="cloud-sync-item-${id}"]`),
        reason: () => wrapper.get(`[data-testid="cloud-sync-item-reason-${id}"]`).text(),
        finish: async () => {
          resolveBatch(syncSummary({ failed: 1 }))
          await flush()
        },
      }
    }

    it('字段格式类码（ACCOUNT_*）逐个都渲染 cloudSyncErr.invalidData，不再留空白原因栏', async () => {
      for (const code of INVALID_DATA_CODES) {
        const row = await openFailedRow(code)
        expect(row.reason(), `code=${code}`).toBe(tk('accountsPage.cloudSyncErr.invalidData'))
        expect(row.reason(), `code=${code}`).not.toBe('')
        await row.finish()
      }
    })

    it('CREDENTIAL_SHAPE_INVALID 渲染 cloudSyncErr.invalidCredential', async () => {
      const row = await openFailedRow('CREDENTIAL_SHAPE_INVALID')
      expect(row.reason()).toBe(tk('accountsPage.cloudSyncErr.invalidCredential'))
      await row.finish()
    })

    it('ACCOUNT_BATCH_TOO_LARGE 渲染 cloudSyncErr.tooMany', async () => {
      const row = await openFailedRow('ACCOUNT_BATCH_TOO_LARGE')
      expect(row.reason()).toBe(tk('accountsPage.cloudSyncErr.tooMany'))
      await row.finish()
    })

    it('断开类码（CLOUD_DISCONNECT_PARTIAL / DISCONNECT_CONFIRMATION_REQUIRED）渲染 cloudSyncErr.disconnectPartial', async () => {
      for (const code of ['CLOUD_DISCONNECT_PARTIAL', 'DISCONNECT_CONFIRMATION_REQUIRED']) {
        const row = await openFailedRow(code)
        expect(row.reason(), `code=${code}`).toBe(tk('accountsPage.cloudSyncErr.disconnectPartial'))
        await row.finish()
      }
    })

    it('云端侧码（ACCOUNT_REJECTED / INTERNAL_SERVER_ERROR / ROUTE_NOT_FOUND / METHOD_NOT_ALLOWED / CLOUD_ACCOUNTS_NOT_CONFIGURED）渲染 cloudSyncErr.cloudFailed', async () => {
      for (const code of ['ACCOUNT_REJECTED', 'INTERNAL_SERVER_ERROR', 'ROUTE_NOT_FOUND', 'METHOD_NOT_ALLOWED', 'CLOUD_ACCOUNTS_NOT_CONFIGURED']) {
        const row = await openFailedRow(code)
        expect(row.reason(), `code=${code}`).toBe(tk('accountsPage.cloudSyncErr.cloudFailed'))
        await row.finish()
      }
    })

    it('未登记的新码（SOMETHING_NEW）同样有文字并走 cloudFailed，界面不出现裸码字符串', async () => {
      const row = await openFailedRow('SOMETHING_NEW')
      const text = row.reason()
      expect(text).toBe(tk('accountsPage.cloudSyncErr.cloudFailed'))
      expect(text.length).toBeGreaterThan(0)
      // 原始码不得直出为文字（本仓规则：UI 不展示内部枚举）
      expect(row.row().text()).not.toContain('SOMETHING_NEW')
      expect(row.wrapper.text()).not.toContain('SOMETHING_NEW')
      await row.finish()
    })

    it('主进程回传的任意非枚举错误串也只走兜底句，不直出原文', async () => {
      const row = await openFailedRow('connect ETIMEDOUT 10.0.0.1:443')
      expect(row.reason()).toBe(tk('accountsPage.cloudSyncErr.cloudFailed'))
      expect(row.row().text()).not.toContain('ETIMEDOUT')
      await row.finish()
    })

    it('原始码保留在该行的 data-error-code 属性上（开发者侧排障钩子，非可见文字）', async () => {
      const row = await openFailedRow('ACCOUNT_UID_INVALID')
      expect(row.row().attributes('data-error-code')).toBe('ACCOUNT_UID_INVALID')
      expect(row.row().text()).not.toContain('ACCOUNT_UID_INVALID')
      await row.finish()
    })

    it('失败行没有码时也给兜底文字（「失败」不允许孤零零没有解释）', async () => {
      const row = await openFailedRow(undefined)
      expect(row.reason()).toBe(tk('accountsPage.cloudSyncErr.cloudFailed'))
      // 无码即不产出该属性，避免行上挂一个空字符串误导排障
      expect(row.row().attributes('data-error-code')).toBeUndefined()
      await row.finish()
    })

    it('成功行不带码时不渲染原因行（兜底不得扩到非失败结果）', async () => {
      const source = installProgressSource()
      const wrapper = mountDialog()
      await flush()
      await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
      await flush()
      source.push({ phase: 'done', index: 0, total: 1, platform: 'zhihu', accountId: 'e2', name: 'Z2', outcome: 'created' })
      await nextTick()

      expect(wrapper.find('[data-testid="cloud-sync-item-reason-e2"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="cloud-sync-item-e2"]').attributes('data-error-code')).toBeUndefined()
      expect(wrapper.get('[data-testid="cloud-sync-item-outcome-e2"]').text()).toBe(tk('accountsPage.cloudOutcomeCreated'))

      resolveSync(syncSummary({ created: 1 }))
      await flush()
    })

    it('终态 items 的 code 为空串时不抹掉 done 事件已落地的分组文案', async () => {
      const source = installProgressSource()
      const wrapper = mountDialog()
      await flush()
      await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
      await flush()
      source.push({ phase: 'done', index: 0, total: 1, platform: 'zhihu', accountId: 'e3', name: 'Z3', outcome: 'failed', code: 'CREDENTIAL_TOO_LARGE' })
      await nextTick()
      expect(wrapper.get('[data-testid="cloud-sync-item-reason-e3"]').text()).toBe(tk('accountsPage.cloudSyncErr.credentialTooLarge'))

      // 批次汇总里同一条账号的 code 为空（normalizeSummaryData 把 null 归一为 ''）
      resolveSync(syncSummary({ failed: 1, items: [{ platform: 'zhihu', accountId: 'e3', name: 'Z3', outcome: 'failed', code: '' }] }))
      await flush()
      expect(wrapper.get('[data-testid="cloud-sync-item-reason-e3"]').text()).toBe(tk('accountsPage.cloudSyncErr.credentialTooLarge'))
      expect(wrapper.get('[data-testid="cloud-sync-item-e3"]').attributes('data-error-code')).toBe('CREDENTIAL_TOO_LARGE')
    })
  })

  describe('【停止同步】中止阀', () => {
    it('过程态渲染出【停止同步】并与【后台继续】并列；批次收口后按钮不再存在', async () => {
      installProgressSource()
      const wrapper = mountDialog()
      await flush()
      // 摘要态不提供停止入口（还没有批次可停）
      expect(wrapper.find('[data-testid="cloud-sync-stop"]').exists()).toBe(false)

      await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
      await flush()

      const stop = wrapper.get('[data-testid="cloud-sync-stop"]')
      expect(stop.text()).toBe(tk('accountsPage.cloudSyncStop'))
      expect(stop.attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="cloud-sync-background"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="cloud-sync-summary"]').exists()).toBe(false)

      resolveSync(syncSummary({ created: 1 }))
      await flush()
      expect(wrapper.find('[data-testid="cloud-sync-stop"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="cloud-sync-finish"]').exists()).toBe(true)
    })

    it('点击后 accountsCloudSyncAbort 恰好调用一次：逐条列表不清空、汇总区不出现（不伪造终态）', async () => {
      const source = installProgressSource()
      const wrapper = mountDialog()
      await flush()
      await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
      await flush()
      source.push({ phase: 'start', index: 0, total: 4, platform: 'douyin', accountId: 's1', name: 'S1' })
      source.push({ phase: 'done', index: 1, total: 4, platform: 'zhihu', accountId: 's2', name: 'S2', outcome: 'created' })
      await nextTick()
      expect(wrapper.findAll('.cloud-sync-item')).toHaveLength(2)

      await wrapper.get('[data-testid="cloud-sync-stop"]').trigger('click')
      await flush()

      expect(_publisher.accountsCloudSyncAbort).toHaveBeenCalledTimes(1)
      // ① 已渲染的逐条结果必须原样保留（含未完成的 in-flight 行与已完成的标签）
      expect(wrapper.findAll('.cloud-sync-item')).toHaveLength(2)
      expect(wrapper.find('[data-testid="cloud-sync-item-s1"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="cloud-sync-item-outcome-s2"]').text()).toBe(tk('accountsPage.cloudOutcomeCreated'))
      // ② 不得伪造终态：无汇总区，running-change 仍停在 true
      expect(wrapper.find('[data-testid="cloud-sync-summary"]').exists()).toBe(false)
      expect(wrapper.emitted('running-change')).toEqual([[true]])
      // ③ 按钮进入「正在停止…」并 disabled
      const stop = wrapper.get('[data-testid="cloud-sync-stop"]')
      expect(stop.text()).toBe(tk('accountsPage.cloudSyncStopping'))
      expect(stop.attributes('disabled')).toBeDefined()

      resolveSync(syncSummary({ created: 1 }))
      await flush()
    })

    it('主进程回报 aborted:false：按钮直接失效、不报错，批次仍正常收口为汇总且不出现「已停止」行', async () => {
      installProgressSource()
      _publisher.accountsCloudSyncAbort.mockResolvedValue({ code: 0, data: { aborted: false } })
      const wrapper = mountDialog()
      await flush()
      await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
      await flush()

      await wrapper.get('[data-testid="cloud-sync-stop"]').trigger('click')
      await flush()

      expect(_publisher.accountsCloudSyncAbort).toHaveBeenCalledTimes(1)
      expect(_notify.notifyError).not.toHaveBeenCalled()
      expect(wrapper.get('[data-testid="cloud-sync-stop"]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid="cloud-sync-summary"]').exists()).toBe(false)

      resolveSync(syncSummary({ created: 4 }))
      await flush()
      expect(wrapper.get('[data-testid="cloud-sync-summary-text"]').text())
        .toBe(tk('accountsPage.cloudSyncDone', { created: 4, updated: 0, restored: 0 }))
      // 中止未被接受 → 不得出现「已停止：剩余账号未同步」
      expect(wrapper.find('[data-testid="cloud-sync-stopped"]').exists()).toBe(false)
    })

    it('中止被接受后收口：汇总保留真实计数，另起一行「已停止：剩余账号未同步」', async () => {
      const source = installProgressSource()
      const wrapper = mountDialog()
      await flush()
      await wrapper.get('[data-testid="cloud-sync-start"]').trigger('click')
      await flush()
      source.push({ phase: 'done', index: 0, total: 4, platform: 'douyin', accountId: 't1', name: 'T1', outcome: 'created' })
      await nextTick()

      await wrapper.get('[data-testid="cloud-sync-stop"]').trigger('click')
      await flush()
      expect(wrapper.find('[data-testid="cloud-sync-summary"]').exists()).toBe(false)

      resolveSync(syncSummary({ created: 1 }))
      await flush()

      expect(wrapper.get('[data-testid="cloud-sync-summary-text"]').text())
        .toBe(tk('accountsPage.cloudSyncDone', { created: 1, updated: 0, restored: 0 }))
      expect(wrapper.get('[data-testid="cloud-sync-stopped"]').text()).toBe(tk('accountsPage.cloudSyncStopped'))
      expect(wrapper.find('[data-testid="cloud-sync-stop"]').exists()).toBe(false)
    })
  })
})

describe('AccountCloudSyncDialog — 断开云端', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk())
    _publisher.accountsCloudSync.mockResolvedValue({ code: 0, data: { items: [] } })
    _publisher.onAccountsCloudSyncProgress.mockReturnValue(() => {})
    _notify.notifyConfirm.mockResolvedValue(true)
    _publisher.accountsCloudDisconnect.mockResolvedValue({ code: 0, data: { deletedAccounts: 7, deletedTombstones: 2 } })
  })

  it('二次确认文案带云端计数，确认后以 cloud 作为确认标记调用', async () => {
    const wrapper = mountDialog()
    await flush()

    await wrapper.get('[data-testid="cloud-disconnect"]').trigger('click')
    await flush()

    expect(_notify.notifyConfirm).toHaveBeenCalledWith('accountsPage.cloudDisconnectConfirm', { params: { count: 7 } })
    expect(_publisher.accountsCloudDisconnect).toHaveBeenCalledWith('cloud')
    expect(_notify.notifySuccess).toHaveBeenCalledWith('accountsPage.cloudDisconnectSuccess')
    // 断开后重载摘要，界面数字不再停留在旧值
    expect(_publisher.accountsCloudDigest).toHaveBeenCalledTimes(2)
  })

  it('用户取消确认时不发任何删除请求', async () => {
    _notify.notifyConfirm.mockResolvedValue(false)
    const wrapper = mountDialog()
    await flush()

    await wrapper.get('[data-testid="cloud-disconnect"]').trigger('click')
    await flush()

    expect(_publisher.accountsCloudDisconnect).not.toHaveBeenCalled()
  })

  it('部分失败：报出已删/剩余并保留断开入口（PRD §11 最后一行）', async () => {
    _publisher.accountsCloudDisconnect.mockResolvedValue({
      code: -1,
      error: 'CLOUD_DISCONNECT_PARTIAL',
      data: { deletedAccounts: 3, deletedTombstones: 0 },
      remaining: 4,
    })
    const wrapper = mountDialog()
    await flush()

    await wrapper.get('[data-testid="cloud-disconnect"]').trigger('click')
    await flush()

    expect(_notify.notifyError).toHaveBeenCalledWith('accountsPage.cloudDisconnectFailed', { params: { deleted: 3, remaining: 4 } })
    expect(wrapper.find('[data-testid="cloud-disconnect"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="cloud-disconnect"]').attributes('disabled')).toBeUndefined()
  })

  it('云端为 0 时断开入口禁用（无镜像可清）', async () => {
    _publisher.accountsCloudDigest.mockResolvedValue(digestOk({ total: 0, byPlatform: [], tombstones: 0 }))
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.get('[data-testid="cloud-disconnect"]').attributes('disabled')).toBeDefined()
  })
})
