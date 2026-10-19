import { describe, expect, it, vi } from 'vitest'
import { usePublishHistoryRowFormat } from './usePublishHistoryRowFormat'

// 夹具：t 直接回显键名，platformStore 只答 getContentCategory。
// 不挂 i18n —— 本 composable 的口径是「键选择 + 兜底」，断言键名比断言文案更稳
// （AGENTS.md：渲染端测试断言 i18n 键而不是 locale 字面量）。
// 状态判据不再由夹具提供：`publishModeValue` / `failedCount` 走的是
// `utils/publish-record-status` 这份真源，夹具在这里改写它等于测一个生产不存在的口径。
function makeApi (category = 'TEXT') {
  const t = vi.fn((key) => key)
  const platformStore = { getContentCategory: vi.fn(() => category) }
  return { api: usePublishHistoryRowFormat({ t, platformStore }), t, platformStore }
}

describe('usePublishHistoryRowFormat — 导出完整性（模板解构的全部成员）', () => {
  it('17 个展示值函数全部导出且为函数', () => {
    const { api } = makeApi()
    const keys = [
      'recordTitle', 'publisherName', 'auditLabel', 'auditAlert', 'auditHint',
      'contentTypeValue', 'contentTypeLabel', 'publishModeValue', 'publishModeLabel',
      'deliveryModeValue', 'deliveryModeLabel', 'deliveryModeHint',
      'resultValue', 'failedCount', 'metricValue', 'formatTime', 'contentPreview'
    ]
    for (const k of keys) {
      expect(api, `缺少导出 ${k}`).toHaveProperty(k)
      expect(typeof api[k], `${k} 不是函数`).toBe('function')
    }
    // 反向：不得有多余导出（多一个就多一条没人消费的路径）
    expect(Object.keys(api).sort()).toEqual([...keys].sort())
  })
})

describe('usePublishHistoryRowFormat — 标题 / 发布人兜底', () => {
  it('title → name → 未命名任务，逐层回退', () => {
    const { api, t } = makeApi()
    expect(api.recordTitle({ title: '甲' })).toBe('甲')
    expect(api.recordTitle({ name: '乙' })).toBe('乙')
    expect(api.recordTitle({})).toBe('historyPage.unnamedTask')
    expect(t).toHaveBeenCalledWith('historyPage.unnamedTask')
    expect(api.recordTitle(null)).toBe('historyPage.unnamedTask')
  })

  it('publisher → author → operator → 系统账号', () => {
    const { api } = makeApi()
    expect(api.publisherName({ publisher: '张三' })).toBe('张三')
    expect(api.publisherName({ author: '李四' })).toBe('李四')
    expect(api.publisherName({ operator: '王五' })).toBe('王五')
    expect(api.publisherName({})).toBe('historyPage.systemAccount')
  })
})

describe('usePublishHistoryRowFormat — 内容类型口径', () => {
  it('显式值优先归一：video 三种写法 / image 两种 / 其余非空按 article', () => {
    const { api, platformStore } = makeApi()
    for (const v of ['video', 'short_video', 'short-video', 'VIDEO']) {
      expect(api.contentTypeValue({ contentType: v })).toBe('video')
    }
    for (const v of ['image', 'gallery']) {
      expect(api.contentTypeValue({ type: v })).toBe('image')
    }
    expect(api.contentTypeValue({ contentType: 'text' })).toBe('article')
    // 已有显式值时不得去查平台目录
    expect(platformStore.getContentCategory).not.toHaveBeenCalled()
  })

  it('值缺席时才按平台类目判定，MIXED 也算视频', () => {
    const a = makeApi('VIDEO')
    expect(a.api.contentTypeValue({ platform: 'douyin' })).toBe('video')
    expect(a.platformStore.getContentCategory).toHaveBeenCalledWith('douyin')
    const b = makeApi('MIXED')
    expect(b.api.contentTypeValue({ platform: 'weibo' })).toBe('video')
    const c = makeApi('TEXT')
    expect(c.api.contentTypeValue({ platform: 'zhihu' })).toBe('article')
  })

  it('标签键三值闭合', () => {
    const { api } = makeApi()
    expect(api.contentTypeLabel({ contentType: 'video' })).toBe('historyPage.contentTypeVideo')
    expect(api.contentTypeLabel({ contentType: 'image' })).toBe('historyPage.contentTypeImage')
    expect(api.contentTypeLabel({ contentType: 'article' })).toBe('historyPage.contentTypeArticle')
  })
})

describe('usePublishHistoryRowFormat — 发布模式与送达方式', () => {
  it('scheduled 认三种别名，也认状态派生；其余一律 immediate', () => {
    const { api } = makeApi()
    for (const v of ['scheduled', 'schedule', 'timed']) {
      expect(api.publishModeValue({ publishMode: v })).toBe('scheduled')
    }
    // mode 别名同样有效
    expect(api.publishModeValue({ mode: 'SCHEDULED' })).toBe('scheduled')
    // 状态是 scheduled 但 publishMode 缺失 → 仍算定时
    expect(api.publishModeValue({ status: 'scheduled' })).toBe('scheduled')
    expect(api.publishModeValue({ publishMode: 'now' })).toBe('immediate')
    expect(api.publishModeLabel({ publishMode: 'timed' })).toBe('historyPage.modeScheduled')
    expect(api.publishModeLabel({})).toBe('historyPage.modeImmediate')
  })

  it('送达方式只认三个枚举值，未知值不产出徽标', () => {
    const { api } = makeApi()
    expect(api.deliveryModeValue({ result: { mode: 'api' } })).toBe('api')
    expect(api.deliveryModeValue({ result: { mode: 'dom' } })).toBe('dom')
    expect(api.deliveryModeValue({ result: { mode: 'fallback' } })).toBe('fallback')
    expect(api.deliveryModeValue({ result: { mode: 'magic' } })).toBe('')
    expect(api.deliveryModeValue({})).toBe('')
    expect(api.deliveryModeValue(null)).toBe('')
  })

  it('标签/提示在值未知时回落到 api 键（徽标本身不渲染，取不到值即无出口）', () => {
    const { api } = makeApi()
    expect(api.deliveryModeLabel({ result: { mode: 'dom' } })).toBe('publish.api.modeDom')
    expect(api.deliveryModeHint({ result: { mode: 'fallback' } })).toBe('publish.api.modeFallbackHint')
    expect(api.deliveryModeLabel({})).toBe('publish.api.modeApi')
    expect(api.deliveryModeHint({})).toBe('publish.api.modeApiHint')
  })
})

describe('usePublishHistoryRowFormat — 审核状态', () => {
  it('无合法结论时不产出标签，也不产出告警提示（不得用「无徽标」伪装成已通过）', () => {
    const { api } = makeApi()
    expect(api.auditLabel({})).toBe('')
    expect(api.auditLabel({ auditStatus: 'nonsense' })).toBe('')
    expect(api.auditHint({ auditStatus: 'nonsense' })).toBe('')
    // 监控侧别名（rejected/reviewed）不是存储态：入库前已由 mapMonitorStatusToAuditStatus
    // 归一为 deny/inAudit，这里必须是 fail-closed 的空白，不得在这里再抄一份别名表
    expect(api.auditLabel({ auditStatus: 'rejected' })).toBe('')
    expect(api.auditAlert({ auditStatus: 'rejected' })).toBe(false)
  })

  it('拒绝态给出标签并标红 + 告警提示', () => {
    const { api } = makeApi()
    expect(api.auditLabel({ auditStatus: 'deny' })).not.toBe('')
    expect(api.auditAlert({ auditStatus: 'deny' })).toBe(true)
    expect(api.auditHint({ auditStatus: 'deny' })).toBe('historyPage.auditStatusAlertHint')
    // 非告警态：有标签但不标红、不给处置指引
    expect(api.auditLabel({ auditStatus: 'inAudit' })).not.toBe('')
    expect(api.auditAlert({ auditStatus: 'inAudit' })).toBe(false)
    expect(api.auditHint({ auditStatus: 'inAudit' })).toBe('')
  })
})

describe('usePublishHistoryRowFormat — 计数与指标', () => {
  it('failedCount 优先用记录自带值，0 也当有效值；缺席时才按状态派生', () => {
    const { api } = makeApi()
    expect(api.failedCount({ failedCount: 0 })).toBe(0)
    expect(api.failedCount({ failedCount: 3 })).toBe(3)
    expect(api.failedCount({ status: 'failed' })).toBe(1)
    expect(api.failedCount({ status: 'success' })).toBe(0)
  })

  it('metricValue：undefined/null/空串走占位符，数字 0 原样保留', () => {
    const { api } = makeApi()
    expect(api.metricValue(undefined)).toBe('-')
    expect(api.metricValue(null)).toBe('-')
    expect(api.metricValue('')).toBe('-')
    expect(api.metricValue(0)).toBe(0)
    expect(api.metricValue(undefined, 1)).toBe(1)
  })

  it('resultValue 只收字符串与数字，对象/数组一律当缺席', () => {
    const { api } = makeApi()
    expect(api.resultValue({ result: { url: 'http://x' } }, 'url')).toBe('http://x')
    expect(api.resultValue({ result: { n: 7 } }, 'n')).toBe('7')
    expect(api.resultValue({ result: { o: {} } }, 'o')).toBe('')
    expect(api.resultValue({}, 'url')).toBe('')
  })

  it('contentPreview 压空白并在 48 字符后截断加省略号', () => {
    const { api } = makeApi()
    expect(api.contentPreview('甲  \n  乙')).toBe('甲 乙')
    const long = 'x'.repeat(60)
    const out = api.contentPreview(long)
    expect(out).toHaveLength(51)
    expect(out.endsWith('...')).toBe(true)
  })

  it('formatTime 对空值与非法值分别回落（非法值必须原样出声，不得静默变空）', () => {
    const { api } = makeApi()
    expect(api.formatTime('')).toBe('historyPage.unknownTime')
    expect(api.formatTime('not-a-date')).toBe('not-a-date')
    expect(api.formatTime('2026-10-19T00:00:00.000Z')).toContain('2026')
  })
})
