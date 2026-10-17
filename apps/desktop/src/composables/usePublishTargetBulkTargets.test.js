/**
 * usePublishTargetBulkTargets.test.js — 「全选 / 清空」接线层的单元测试
 *
 * 被测：`apps/desktop/src/composables/usePublishTargetBulkTargets.js`。
 * 判据本体在 `@/features/publish/usePublishTargetBulk`（纯函数），本文件只锁
 * 「store ↔ 视图」这一段：播报文案的每个数字必须来自同一次分类结果，
 * 且组件不持有选中集（看不到 store，全靠注入）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import i18n from '@/i18n'
import { usePublishTargetBulkTargets } from './usePublishTargetBulkTargets'

function makeSelection (opts = {}) {
  const selectedPlatforms = ref(opts.selectedPlatforms || [])
  return {
    selectedPlatforms,
    getAvailableAccountIds: (id) => (opts.availableByPlatform || {})[id] || [],
    selectPlatform: vi.fn((id) => { if (!selectedPlatforms.value.includes(id)) selectedPlatforms.value.push(id) }),
    clearPlatforms: vi.fn(() => { selectedPlatforms.value = [] }),
  }
}

// 夹具必须是 `groupedPlatforms` 的真实形状（[{label, items}]），不是拍平数组 ——
// 接线层的职责之一就是拍平，喂平铺数组会让这条职责失去覆盖。
const PLATFORMS = [
  { id: 'wechat_mp', label: '微信公众号', accounts: [{ id: 'wx-1' }] },
  { id: 'zhihu', label: '知乎', accounts: [] },
  { id: 'douyin', label: '抖音', accounts: [] },
  { id: 'bilibili', label: '哔哩哔哩', accounts: [{ id: 'bili-1' }] },
  { id: 'weibo', label: '微博', accounts: [] },
]

const GROUPED_PLATFORMS = [{ label: '国内平台', items: PLATFORMS }]

describe('usePublishTargetBulkTargets（全选/清空接线层）', () => {
  let notifyInfo, notifyWarning

  beforeEach(() => {
    notifyInfo = vi.fn()
    notifyWarning = vi.fn()
  })

  it('全选成功：播报 added 与 skipped 两个数，且都来自同一次分类结果', () => {
    const selection = makeSelection({ availableByPlatform: { wechat_mp: ['wx-1'], bilibili: ['bili-1'] } })
    const { selectAll } = usePublishTargetBulkTargets({
      selection,
      platforms: ref(GROUPED_PLATFORMS),
      notifyInfo,
      notifyWarning,
    })

    const result = selectAll()

    expect(result.ok).toBe(true)
    expect(result.added).toEqual(['wechat_mp', 'bilibili'])
    expect(selection.selectPlatform).toHaveBeenCalledTimes(2)
    expect(notifyInfo).toHaveBeenCalledTimes(1)
    // 文案与 messageKey 必须一起给：key 进主进程日志，message 是用户看到的拼装文案
    const [key, options] = notifyInfo.mock.calls[0]
    expect(key).toBe('publishPage.targetBulk.added')
    expect(options.message).toContain('2')
    expect(options.message).toContain('3') // skipped=3
    // 三个被跳过的平台全部列名（≤3 不截断）
    expect(options.message).toContain('知乎')
    expect(options.message).toContain('抖音')
    expect(options.message).toContain('微博')
    expect(options.message).not.toContain('等 1 个')
  })

  it('跳过平台超过 3 个时只列前 3 个 + 「等 N 个」（列表不得变成清单）', () => {
    // 5 个平台里 4 个无账号 ⇒ skipped=4 ⇒ 只列 3 个 + 等 1 个
    const selection = makeSelection({ availableByPlatform: { wechat_mp: ['wx-1'] } })
    const { selectAll } = usePublishTargetBulkTargets({
      selection,
      platforms: ref(GROUPED_PLATFORMS),
      notifyInfo,
      notifyWarning,
    })

    selectAll()

    const [, options] = notifyInfo.mock.calls[0]
    expect(options.message).toContain('4 个平台没有可用账号')
    // 按平台目录顺序取前 3 个：知乎、抖音、哔哩哔哩；第 4 个（微博）只记「等 1 个」
    expect(options.message).toContain('知乎、抖音、哔哩哔哩 等 1 个')
    expect(options.message).not.toContain('微博')
  })

  it('无 skipped 时不出现 skipped 文案（不得给"0 个平台没有可用账号"这种噪音）', () => {
    const allAvailable = {}
    for (const p of PLATFORMS) allAvailable[p.id] = [p.id + '-acc']
    const selection = makeSelection({ availableByPlatform: allAvailable })
    const { selectAll } = usePublishTargetBulkTargets({ selection, platforms: ref(GROUPED_PLATFORMS), notifyInfo, notifyWarning })

    selectAll()

    expect(notifyInfo).toHaveBeenCalledTimes(1)
    const [key, options] = notifyInfo.mock.calls[0]
    expect(key).toBe('publishPage.targetBulk.added')
    expect(options.message).toContain('5') // 5 个平台全部新增
    expect(options.message).not.toContain('未纳入')
    expect(options.message).not.toContain('没有可用账号')
  })

  it('新增里含风控挂起目标时，追加一句挂起提示（一次点击引入多个已知失败目标不得藏起来）', () => {
    const selection = makeSelection({ availableByPlatform: { wechat_mp: ['wx-1'], bilibili: ['bili-1'] } })
    const { selectAll } = usePublishTargetBulkTargets({
      selection,
      platforms: ref(GROUPED_PLATFORMS),
      riskSuspended: [{ platform: 'wechat_mp', accountId: null }],
      notifyInfo,
      notifyWarning,
    })

    selectAll()

    const [, options] = notifyInfo.mock.calls[0]
    expect(options.message).toContain('风控挂起')
    expect(options.message).toContain('1')
  })

  it('全部已选中 ⇒ added=0，播报 alreadyAll，且不调用 selectPlatform', () => {
    const selection = makeSelection({
      selectedPlatforms: ['wechat_mp', 'bilibili'],
      availableByPlatform: { wechat_mp: ['wx-1'], bilibili: ['bili-1'] },
    })
    const { selectAll } = usePublishTargetBulkTargets({ selection, platforms: ref(GROUPED_PLATFORMS), notifyInfo, notifyWarning })

    const result = selectAll()

    expect(result.added).toEqual([])
    // already 按平台目录顺序（与 added 同序），selected 才是排序并集
    expect(result.already).toEqual(['wechat_mp', 'bilibili'])
    expect(result.selected).toEqual(['bilibili', 'wechat_mp'])
    expect(selection.selectPlatform).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledTimes(1)
    const [key, options] = notifyInfo.mock.calls[0]
    expect(key).toBe('publishPage.targetBulk.alreadyAll')
    expect(options.message).toContain('2')
    // added=0 时不得出现"已选中 N 个平台"（成功文案与零新增不得共用）
    expect(key).not.toBe('publishPage.targetBulk.added')
  })

  it('no-targets ⇒ 不写入、不播报（按钮本就 disabled，这里是双保险）', () => {
    const selection = makeSelection({ availableByPlatform: {} })
    const { selectAll } = usePublishTargetBulkTargets({ selection, platforms: ref(GROUPED_PLATFORMS), notifyInfo, notifyWarning })

    const result = selectAll()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-targets')
    expect(selection.selectPlatform).not.toHaveBeenCalled()
    expect(notifyInfo).not.toHaveBeenCalled()
    expect(notifyWarning).not.toHaveBeenCalled()
  })

  it('清空：清空宿主选中集并播报；已有选中才可用', () => {
    const selection = makeSelection({ selectedPlatforms: ['wechat_mp'] })
    const { clearAll } = usePublishTargetBulkTargets({ selection, platforms: ref(GROUPED_PLATFORMS), notifyInfo, notifyWarning })

    clearAll()

    expect(selection.clearPlatforms).toHaveBeenCalledTimes(1)
    expect(selection.selectedPlatforms.value).toEqual([])
    const [key] = notifyInfo.mock.calls[0]
    expect(key).toBe('publishPage.targetBulk.cleared')
  })

  it('平台名清单截断规则：>3 个只列 3 个 + 「等 N 个」（判据取纯函数，不取上层拼装）', () => {
    const selection = makeSelection({ availableByPlatform: { wechat_mp: ['wx-1'], bilibili: ['bili-1'] } })
    const { formatPlatformList } = usePublishTargetBulkTargets({ selection, platforms: ref(GROUPED_PLATFORMS), notifyInfo, notifyWarning })
    // 截断后缀由**接线层**注入 locale：纯函数不得 import i18n，中文不得进渲染层非 locales 文件
    // （CI Gate 7 check-locale-sync --cjk）。
    const restLabel = (rest) => i18n.global.t('publishPage.targetBulk.listRest', { rest })
    const fmt = (labels) => formatPlatformList(labels, { restLabel })

    expect(fmt(['A', 'B'])).toBe('A、B')
    expect(fmt(['A', 'B', 'C'])).toBe('A、B、C')
    expect(fmt(['A', 'B', 'C', 'D'])).toBe('A、B、C 等 1 个')
    expect(fmt(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A、B、C 等 3 个')
    // 不注入 restLabel 时不得自行拼中文 —— 那是纯函数的边界，不是"降级后照旧"
    expect(formatPlatformList(['A', 'B', 'C', 'D'])).toBe('A、B、C、D')
  })
})
