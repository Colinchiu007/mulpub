/**
 * BatchCollectPanel — 知乎收藏夹批量行为锁（自 Collection.test.js 迁入，collection-ui-refinement）
 *
 * 九条不可省（P0/QM-6 系列回归锁原样保留，断言对象从 w.vm.* 换为组件内部状态访问）：
 * ① 无 secret 必填提示；② 成功填充下拉；③ 失败错误提示；④ 空收藏夹提示；
 * ⑤ P0 字段不丢失（双层展开回归锁）；⑥ C2 已采集标记；⑦ unified 通道 + capped 提示；
 * ⑧ 新通道结果入库（QM-6 C1）；⑨ cancelZhihuFavBatch 通道存在。
 *
 * IPC 走真实 getApi() 桥（window.electronAPI 桩）—— 不 mock 组件内部函数。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

// 真实 electron-bridge 桥（getApi 返回 window.electronAPI），不 mock
vi.mock('@/api/publisher', () => ({
  storeSetSetting: vi.fn(async () => ({ code: 0 })),
}))

// 「前往设置」出口走 settings-dialog 信号：请求函数必须是可观测的 spy，
// 版本号要是真 ref（组件 watch 它来在弹窗关闭后刷新凭据状态）
vi.mock('@/stores/settings-dialog', async () => {
  const { ref } = await import('vue')
  return {
    settingsDialogRevision: ref(0),
    requestSettingsDialog: vi.fn(),
    notifySettingsDialogClosed: vi.fn(),
  }
})

const BatchCollectPanel = (await import('./BatchCollectPanel.vue')).default
const { settingsDialogRevision, requestSettingsDialog } = await import('@/stores/settings-dialog')

/** 凭据状态桩：默认「已配置且可读」，需要未配置/旧版明文的用例自行覆盖 */
function secretConfig (overrides = {}) {
  return {
    configured: true, readable: true, maskedSecret: 'zhih****7890',
    updatedAt: '2026-10-15T10:00:00.000Z', verifiedAt: null, favlistCount: null,
    legacyDetected: false, source: 'config', ...overrides,
  }
}

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      collection: {
        batchCollectTitle: '批量采集',
        rssBatch: 'RSS 批量采集',
        urlListBatch: 'URL 列表批量采集',
        rssPlaceholder: 'RSS 订阅源地址',
        urlListPlaceholder: '每行一个链接',
        urlListHint: '提示',
        batchCollect: '开始批量采集',
        batchCollecting: '批量采集中...',
        batchProgress: '批量采集进度',
        cancelBatch: '取消',
        zhihuFavlist: {
          title: '知乎收藏夹', loadBtn: '加载收藏夹', loading: '加载中',
          collectBtn: '采集', collecting: '采集中', rewriteBtn: '改写', rewriting: '改写中', hint: '提示',
          progressTitle: '采集并改写进度', progressText: '{done} / {total}',
          configMissing: '请先在「设置 → 知乎 API」中配置 Access Secret',
          configBadge: '已配置',
          configNotConfigured: '未配置',
          configDenied: '暂不可读',
          configUnreadable: '已保存的密钥无法读取，请到设置中重新保存',
          configLegacy: '检测到旧版明文密钥，建议到设置中重新保存以完成加密迁移',
          goSettings: '前往设置',
          loadFailed: '加载失败', empty: '没有收藏夹', emptyFavlist: '收藏夹没有内容',
          fetchingContents: '获取收藏内容...', collectingProgress: '共 {count} 条，采集中...',
          batchDone: '完成，成功 {completed} 失败 {failed}',
          batchDoneCancelledSuffix: '（已取消）', batchDoneCircuitBrokenSuffix: '（熔断）',
          noRewritable: '没有可改写的内容', rewritingProgress: '改写 {count} 条...',
          noSelection: '请先勾选要采集的内容',
          pickFavlistFirst: '请先获取收藏夹并选择要采集的收藏夹',
          rewriteNeedsSource: '没有可改写的内容，请先采集',
          emptyItems: '收藏夹清单为空',
          fewerThanRequested: '实际获取 {actual} 条，少于申请的 {requested} 条',
          favlistsCapped: '收藏夹数量已达上限', fullModeCap: '全量模式单次最多 200 条',
          mappingMismatch: '进度汇总与实际产出不一致',
          expandDetail: '展开明细', collapseDetail: '收起明细',
        },
        zhihuFav: {
          scopeFavlist: '指定收藏夹', scopeAll: '全部收藏', countPlaceholder: '数量', fullMode: '全量',
          includeCollected: '包含已采集', loadContents: '加载内容', loadingContents: '加载中',
          selectAll: '全选', selectedCount: '已选 {count} 条', collectAndRewrite: '采集并改写',
          collecting: '采集中', markCollected: '已采集',
          progressSummary: '成功 {success} 失败 {failed} 跳过 {skipped} 改写失败 {rewriteFailed}',
          collectingNote: '采集 {url}', doneNote: '完成', registerOnlyNote: '仅登记',
          collectOkRewriteFailNote: '采集成功但改写失败', fallbackSuffix: '（{count} 张图片降级）',
          kindAnswer: '回答', kindArticle: '文章', kindColumn: '专栏', kindPin: '想法', kindVideo: '视频', kindUnknown: '未知',
        },
      },
    },
  },
})

// 组件必须逐例卸载：本组件在挂载期订阅了模块级共享信号（settingsDialogRevision），
// 泄漏的旧实例会在版本号变化时**用当前的 window.electronAPI**再拉一次配置，
// 把后续用例的调用计数污染成「6 次而不是 2 次」（实测踩过）。
const mountedWrappers = []

function mountPanel (props = {}) {
  const w = mount(BatchCollectPanel, {
    global: { plugins: [i18n] },
    props: {
      collectedUrlSet: new Set(),
      categoryTagCtx: { knownCategoryKeys: [] },
      rewriteStyle: '轻松易懂',
      ...props,
    },
  })
  mountedWrappers.push(w)
  return w
}

afterEach(() => {
  while (mountedWrappers.length) {
    try { mountedWrappers.pop().unmount() } catch { /* 已卸载 */ }
  }
})

/** 取组件内部 setup 状态（script setup 变量经 defineExpose 未导出的，走 vm 代理） */
function state (w, key, value) {
  if (value === undefined) return w.vm[key]
  w.vm[key] = value
}

describe('BatchCollectPanel 知乎收藏夹批量行为锁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.electronAPI = {}
    settingsDialogRevision.value = 0
  })

  it('凭据未配置 → 状态条提示「未配置」+ 引导文案，点加载不发请求', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig({ configured: false, readable: false, maskedSecret: '', source: 'none' }) }),
      zhihuFavlistList: vi.fn(),
    }
    const w = mountPanel()
    await flushPromises()
    expect(w.vm.zhihuSecretAvailable).toBe(false)
    expect(w.get('[data-testid="zhihu-config-badge"]').text()).toContain('未配置')
    expect(w.get('[data-testid="zhihu-config-hint"]').text()).toContain('设置')

    await w.vm.loadZhihuFavlists()
    expect(w.vm.zhihuFavlistError).toContain('设置')
    expect(window.electronAPI.zhihuFavlistList).not.toHaveBeenCalled()
  })

  it('凭据已配置 → 显示遮罩与「已配置」徽标（不回显明文）', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
    }
    const w = mountPanel()
    await flushPromises()
    expect(w.vm.zhihuSecretAvailable).toBe(true)
    expect(w.get('[data-testid="zhihu-config-badge"]').text()).toContain('已配置')
    expect(w.get('[data-testid="zhihu-config-masked"]').text()).toBe('zhih****7890')
  })

  it('读取被拒（许可证/未登录 code=-3）→ 说原因、不塌成「未配置」', async () => {
    // 根因（QM-6 跨家族评审 MAJOR #2）：原先只看 r.code===0，非 0 一律静默保持默认态，
    // 于是「已配置但当前无权读」被渲染成「未配置」，把用户引向重复配置。
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: -3, message: '许可证权限不足，无法调用 zhihuGetConfig' }),
      zhihuFavlistList: vi.fn(),
    }
    const w = mountPanel()
    await flushPromises()
    expect(w.vm.zhihuSecretAvailable).toBe(false)
    const badge = w.get('[data-testid="zhihu-config-badge"]').text()
    expect(badge).not.toContain('未配置')
    expect(badge).toContain('暂不可读')
    expect(w.get('[data-testid="zhihu-config-hint"]').text()).toContain('许可证权限不足')
  })

  it('读取抛异常（同步权限拒绝）同样出声，不冒充未配置', async () => {
    const deny = new Error('许可证权限不足，无法调用 zhihuGetConfig')
    deny.name = 'LicensePermissionError'
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockRejectedValue(deny),
    }
    const w = mountPanel()
    await flushPromises()
    expect(w.get('[data-testid="zhihu-config-badge"]').text()).toContain('暂不可读')
    expect(w.get('[data-testid="zhihu-config-hint"]').text()).toContain('许可证权限不足')
  })

  it('旧版明文兼容期：仍可用（source=legacy），但提示去设置里加密迁移', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig({ configured: false, readable: false, maskedSecret: 'last****cret', legacyDetected: true, source: 'legacy' }) }),
    }
    const w = mountPanel()
    await flushPromises()
    expect(w.vm.zhihuSecretAvailable).toBe(true)
    expect(w.get('[data-testid="zhihu-config-hint"]').text()).toContain('加密迁移')
  })

  it('「前往设置」按钮 → 请求打开设置并定位到知乎 API 分区', async () => {
    window.electronAPI = { zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig({ source: 'none', configured: false }) }) }
    const w = mountPanel()
    await flushPromises()
    await w.get('[data-testid="zhihu-go-settings"]').trigger('click')
    await flushPromises()
    expect(requestSettingsDialog).toHaveBeenCalledWith('zhihu')
  })

  it('设置弹窗关闭（版本号 +1）→ 重新读取凭据状态（配好即立即可用）', async () => {
    const getConfig = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: secretConfig({ source: 'none', configured: false, maskedSecret: '' }) })
      .mockResolvedValueOnce({ code: 0, data: secretConfig() })
    window.electronAPI = { zhihuGetConfig: getConfig }
    const w = mountPanel()
    await flushPromises()
    expect(w.vm.zhihuSecretAvailable).toBe(false)

    settingsDialogRevision.value += 1
    await flushPromises()
    expect(getConfig).toHaveBeenCalledTimes(2)
    expect(w.vm.zhihuSecretAvailable).toBe(true)
  })

  it('loadZhihuFavlists 成功 → 下拉数据填充', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
      zhihuFavlistList: vi.fn().mockResolvedValue({ code: 0, data: [
        { urlToken: 111, title: '收藏夹A', isPublic: true },
        { urlToken: 222, title: '收藏夹B', isPublic: false },
      ] }),
    }
    const w = mountPanel()
    await flushPromises()
    await w.vm.loadZhihuFavlists()
    await flushPromises()
    expect(w.vm.zhihuFavlists).toHaveLength(2)
    expect(w.vm.zhihuFavlists[0].title).toBe('收藏夹A')
    expect(w.vm.zhihuFavlistError).toBe('')
  })

  it('loadZhihuFavlists 失败 → 错误提示', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
      zhihuFavlistList: vi.fn().mockResolvedValue({ code: -1, message: '网络连接失败' }),
    }
    const w = mountPanel()
    await flushPromises()
    await w.vm.loadZhihuFavlists()
    await flushPromises()
    expect(w.vm.zhihuFavlistError).toContain('网络连接失败')
  })

  it('zhihuFavlistBatchCollect 空收藏夹 → 提示无内容', async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [], totals: 0 } }),
    }
    const w = mountPanel()
    w.vm.zhihuSelectedFavlist = '111'
    await w.vm.zhihuFavlistBatchCollect()
    await flushPromises()
    expect(w.vm.zhihuFavlistError).toContain('没有内容')
  })

  it('zhihuFavlistBatchCollect 成功 → 结果 emit（P0 回归锁：字段不得丢失）', async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [
        { url: 'https://zhuanlan.zhihu.com/p/1', title: '文章1' },
      ], totals: 1 } }),
      zhihuFavlistBatchCollect: vi.fn().mockResolvedValue({ code: 0, data: {
        completed: 1, failed: 0, cancelled: false, circuitBroken: false,
        results: [{ index: 0, ok: true, data: { success: true, title: '文章1', content: '正文内容' } }],
      } }),
    }
    const w = mountPanel()
    w.vm.zhihuSelectedFavlist = '111'
    await w.vm.zhihuFavlistBatchCollect()
    await flushPromises()
    expect(w.vm.zhihuFavlistResults).toHaveLength(1)
    expect(w.vm.zhihuFavlistProgress).toContain('成功 1')
    // P0 回归锁原样保留：emit 出的条目逐字段断言（父级原样入列表）
    const emitted = w.emitted('collected')[0][0]
    expect(emitted).toHaveLength(1)
    expect(emitted[0].title).toBe('文章1')
    expect(emitted[0].content).toBe('正文内容')
    expect(emitted[0].sourceUrl).toBe('https://zhuanlan.zhihu.com/p/1')
  })

  it('loadZhihuFavItems 指定收藏夹 → 清单渲染 + 已采集标记（C2）', async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [
        { url: 'https://zhuanlan.zhihu.com/p/1', title: '甲', contentType: 'article', favTime: 1700000000 },
        { url: 'https://www.zhihu.com/pin/2', title: '乙', contentType: 'pin', favTime: 1700000001 },
      ], totals: 2 } }),
    }
    const w = mountPanel({ collectedUrlSet: new Set(['https://zhuanlan.zhihu.com/p/1']) })
    w.vm.zhihuFavlists = [{ urlToken: '111', title: '夹' }]
    w.vm.zhihuSelectedFavlist = '111'
    await w.vm.loadZhihuFavItems()
    await flushPromises()
    expect(w.vm.zhihuFavItems).toHaveLength(2)
    expect(w.vm.zhihuFavItems[0].collected).toBe(true)
    expect(w.vm.zhihuFavItems[1].collected).toBe(false)
  })

  it('loadZhihuFavItems 全部收藏 → unified-contents 通道 + favlistsCapped 提示', async () => {
    window.electronAPI = {
      zhihuFavlistUnifiedContents: vi.fn().mockResolvedValue({ code: 0, data: {
        items: [{ url: 'https://zhuanlan.zhihu.com/p/9', title: '统', kind: 'article', favTime: 5 }],
        truncated: false, totalBeforeCut: 1, favlistsCapped: true, fullModeCapped: false,
      } }),
    }
    const w = mountPanel()
    w.vm.zhihuFavlists = [{ urlToken: '111', title: '夹' }]
    w.vm.zhihuFavScope = 'all'
    await w.vm.loadZhihuFavItems()
    await flushPromises()
    expect(window.electronAPI.zhihuFavlistUnifiedContents).toHaveBeenCalled()
    expect(w.vm.zhihuFavItems).toHaveLength(1)
    expect(w.vm.zhihuFavScopeHint).toContain('50')
  })

  it('runZhihuFavCollectRewrite 成功 → 新通道结果 emit（含改写稿/图片字段，QM-6 C1）', async () => {
    window.electronAPI = {
      zhihuFavBatchRun: vi.fn().mockResolvedValue({ code: 0, data: {
        completed: 1, failed: 0, duplicateSkipped: 0, rewriteFailed: 0,
        cancelled: false, circuitBroken: false,
        results: [{ index: 0, ok: true, duplicate: false, data: {
          id: 'fb_1', title: '标题甲', content: '正文甲', coverImage: 'https://picx.zhimg.com/c.jpg',
          sourceUrl: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', favTime: 1,
          images: ['D:\\img\\a.jpg'], imageFallbacks: [], rewrittenContent: '改写稿甲', rewriteFailed: false,
        } }],
      } }),
      onZhihuFavBatchProgress: vi.fn(() => vi.fn()),
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [
        { url: 'https://zhuanlan.zhihu.com/p/1', title: '甲', kind: 'article', favTime: 1 },
      ], totals: 1 } }),
    }
    const w = mountPanel()
    w.vm.zhihuFavlists = [{ urlToken: '111', title: '夹' }]
    w.vm.zhihuSelectedFavlist = '111'
    w.vm.zhihuFavItems = [{ url: 'https://zhuanlan.zhihu.com/p/1', title: '甲', kind: 'article', favTime: 1, collected: false }]
    w.vm.zhihuFavChecked = new Set(['https://zhuanlan.zhihu.com/p/1'])
    await w.vm.runZhihuFavCollectRewrite()
    await flushPromises()
    const emitted = w.emitted('collected')[0][0]
    expect(emitted).toHaveLength(1)
    expect(emitted[0].title).toBe('标题甲')
    expect(emitted[0].content).toBe('正文甲')
    expect(emitted[0].sourceUrl).toBe('https://zhuanlan.zhihu.com/p/1')
    expect(emitted[0].rewrittenContent).toBe('改写稿甲')
    expect(emitted[0].images).toEqual(['D:\\img\\a.jpg'])
    // 事件契约锁（2026-10-16）：`collected-rewrites` 必须**显式声明**在 defineEmits 里。
    // 原先未声明时父级 Collection.vue 靠 fallthrough 侥幸能收到；一旦根节点变为多节点
    // （fragment），监听器会静默失效 —— 组件照 emit、父级收不到，且只在开发期留一条 warning。
    // 判据：w.emitted() 能观察到该事件（= 声明生效），且载荷是「有改写稿 + 有来源」的条目。
    const rewrites = w.emitted('collected-rewrites')
    expect(rewrites, 'collected-rewrites 必须在 defineEmits 中声明').toBeTruthy()
    expect(rewrites[0][0]).toHaveLength(1)
    expect(rewrites[0][0][0].rewrittenContent).toBe('改写稿甲')
    expect(rewrites[0][0][0].sourceUrl).toBe('https://zhuanlan.zhihu.com/p/1')
    // 清单已采集标记刷新（后台异步）
    await new Promise((r) => setTimeout(r, 0))
    expect(window.electronAPI.zhihuFavlistContents).toHaveBeenCalled()
  })

  it('runZhihuFavCollectRewrite 未勾选 → 提示', async () => {
    window.electronAPI = { onZhihuFavBatchProgress: vi.fn(() => vi.fn()) }
    const w = mountPanel()
    w.vm.zhihuFavItems = []
    await w.vm.runZhihuFavCollectRewrite()
    expect(w.vm.zhihuFavlistError).toContain('勾选')
  })

  it('QM-6 M2 回归锁：cancelZhihuFavBatch 必须存在且走 zhihuFavBatchCancel 通道', async () => {
    const cancelSpy = vi.fn().mockResolvedValue({ code: 0 })
    window.electronAPI = { onZhihuFavBatchProgress: vi.fn(() => vi.fn()), zhihuFavBatchCancel: cancelSpy }
    const w = mountPanel()
    expect(typeof w.vm.cancelZhihuFavBatch).toBe('function')
    w.vm.cancelZhihuFavBatch()
    await new Promise((r) => setTimeout(r, 0))
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('zhihuFavlistBatchRewrite 无可改写内容 → 提示', async () => {
    window.electronAPI = {}
    const w = mountPanel()
    w.vm.zhihuFavlistResults = []
    await w.vm.zhihuFavlistBatchRewrite()
    expect(w.vm.zhihuFavlistError).toContain('可改写')
  })
})

describe('知乎整夹直采按钮可点性（zhihu-fav-buttons-dead，2026-10-16）', () => {
  // 用户报障：采集 → 知乎收藏文章 → 点「采集」「改写」按钮**没有任何反应**。
  //
  // 第一性原因（取证）：这两个按钮的 disabled 判据是 `!zhihuSelectedFavlist`，而该 ref
  //   初始为 '' 且**代码从不自动赋值**（只有用户手动点下拉框才会变）；下拉框本身又在
  //   `v-if="zhihuFavlists.length"` 内 ⇒ 未加载清单时用户根本看不到下拉框、无从选择
  //   ⇒ 按钮恒灰 ⇒ 点击零事件、零提示（disabled 的 button 不派发 click 事件）。
  // 第二个：**改写根本不需要收藏夹选择**（它改写的是已采集结果/父级传入条目），却共用同一判据。
  // 第三个：scope='all'（全部收藏）时下拉框被 disabled，用户永远无法满足该判据 ⇒ 该模式死锁。
  //
  // 逃逸原因：旧用例 `w.vm.zhihuSelectedFavlist = '111'` 手动塞值后**直接调方法**，
  //   既绕过了「这个值在真实使用中从何而来」，也绕过了「按钮到底能不能点」这一 UI 契约。
  beforeEach(() => {
    vi.clearAllMocks()
    window.electronAPI = {}
    settingsDialogRevision.value = 0
  })

  it('未加载清单：采集按钮 disabled 且给出可见原因（不得静默）', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
    }
    const w = mountPanel()
    await flushPromises()
    expect(w.vm.zhihuSelectedFavlist).toBe('')
    expect(w.get('[data-testid="zhihu-favlist-collect"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="zhihu-favlist-target-hint"]').text()).toContain('获取收藏夹')
  })

  it('加载清单成功 → 自动选中第一个收藏夹（用户无需手动点下拉框）', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
      zhihuFavlistList: vi.fn().mockResolvedValue({
        code: 0,
        data: [{ urlToken: '111', title: '夹一' }, { urlToken: '222', title: '夹二' }],
      }),
    }
    const w = mountPanel()
    await flushPromises()
    await w.vm.loadZhihuFavlists()
    await flushPromises()
    expect(w.vm.zhihuSelectedFavlist).toBe('111')
    expect(w.get('[data-testid="zhihu-favlist-collect"]').attributes('disabled')).toBeUndefined()
  })

  it('scope=全部收藏 → 采集按钮可点（该模式不需要选具体收藏夹）', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
    }
    const w = mountPanel()
    await flushPromises()
    w.vm.zhihuFavScope = 'all'
    await nextTick()
    expect(w.vm.zhihuSelectedFavlist).toBe('')
    expect(w.get('[data-testid="zhihu-favlist-collect"]').attributes('disabled')).toBeUndefined()
  })

  it('全部收藏模式采集 → 走 unified-contents 通道（与 loadZhihuFavItems 同语义）', async () => {
    const unified = vi.fn().mockResolvedValue({
      code: 0,
      data: { items: [{ url: 'https://zhuanlan.zhihu.com/p/9', title: '九' }] },
    })
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
      zhihuFavlistUnifiedContents: unified,
      zhihuFavlistBatchCollect: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          completed: 1, failed: 0, cancelled: false, circuitBroken: false,
          results: [{ index: 0, ok: true, data: { success: true, title: '九', content: '正文' } }],
        },
      }),
    }
    const w = mountPanel()
    await flushPromises()
    w.vm.zhihuFavScope = 'all'
    await w.vm.zhihuFavlistBatchCollect()
    await flushPromises()
    expect(unified).toHaveBeenCalled()
    const emitted = w.emitted('collected')[0][0]
    expect(emitted[0].sourceUrl).toBe('https://zhuanlan.zhihu.com/p/9')
  })

  it('无目标时调采集 → 出声提示，不得静默 return', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
    }
    const w = mountPanel()
    await flushPromises()
    await w.vm.zhihuFavlistBatchCollect()
    expect(w.vm.zhihuFavlistError).not.toBe('')
    expect(w.vm.zhihuFavlistError).toContain('获取收藏夹')
  })

  it('改写按钮的可点性只看「有无可改写来源」，与是否选收藏夹无关', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
    }
    const w = mountPanel({ rewriteFallbackItems: [{ content: '这是一段足够长的可改写正文内容，用于触发改写可用性。' }] })
    await flushPromises()
    expect(w.vm.zhihuSelectedFavlist).toBe('')
    expect(w.get('[data-testid="zhihu-favlist-rewrite"]').attributes('disabled')).toBeUndefined()
  })

  it('改写按钮：无任何可改写来源 → disabled 且给出原因', async () => {
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({ code: 0, data: secretConfig() }),
    }
    const w = mountPanel({ rewriteFallbackItems: [] })
    await flushPromises()
    expect(w.get('[data-testid="zhihu-favlist-rewrite"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="zhihu-favlist-rewrite-hint"]').text()).toContain('可改写')
  })
})
