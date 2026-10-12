// @ts-check
/**
 * 归因回归（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T17 的判据层）
 *
 * 归因错误的后果与「没有数据」不同量级：把 A 作品的 10 万播放挂到 B 作品的发布记录上，
 * 用户会据此判断「这篇爆了」，进而重复一个其实没爆的选题。所以本组用例的重点全在
 * **歧义必须留空**与**唯一才认**上，而不是「能匹配上」。
 */
import { describe, it, expect } from 'vitest'

const { planWorkLinks, normalizeTitle, parseTime } = require('./link')

const row = (id, extra) => ({
  id, platform: 'xiaohongshu', post_id: '', url: '', publish_history_id: null, created_at: '2026-10-01T00:00:00.000Z', ...extra,
})
const record = (taskId, extra) => ({
  id: 'r-' + taskId, taskId, platform: 'xiaohongshu', title: '同一标题', timestamp: '2026-10-01T02:00:00.000Z', ...extra,
})

describe('normalizeTitle', () => {
  it('话题标记、@提及、标点、全半角、大小写都归一到同一形态', () => {
    expect(normalizeTitle('三步学会做红烧肉')).toBe('三步学会做红烧肉')
    expect(normalizeTitle('三步学会做红烧肉 #美食# ')).toBe('三步学会做红烧肉')
    expect(normalizeTitle('三步学会做红烧肉！')).toBe('三步学会做红烧肉')
    expect(normalizeTitle('ＡＢＣ １２３')).toBe('abc123')
    expect(normalizeTitle('Hello, World!')).toBe('helloworld')
    expect(normalizeTitle('@小明 你好')).toBe('你好')
  })

  it('空/非字符串 → 空串（空标题不得参与匹配，否则会把整批无标题作品误配到一起）', () => {
    expect(normalizeTitle('')).toBe('')
    expect(normalizeTitle(null)).toBe('')
    expect(normalizeTitle(undefined)).toBe('')
    expect(normalizeTitle(123)).toBe('')
    expect(normalizeTitle('###')).toBe('')
  })
})

describe('parseTime', () => {
  it('ISO / epoch 秒 / epoch 毫秒都能解析；不可解析返回 NaN（不猜）', () => {
    expect(parseTime('2026-10-01T00:00:00.000Z')).toBe(Date.parse('2026-10-01T00:00:00.000Z'))
    expect(parseTime(1760000000)).toBe(1760000000 * 1000)
    expect(parseTime(1760000000000)).toBe(1760000000000)
    expect(parseTime('1760000000')).toBe(1760000000 * 1000)
    expect(Number.isNaN(parseTime(''))).toBe(true)
    expect(Number.isNaN(parseTime(null))).toBe(true)
    expect(Number.isNaN(parseTime('乱码'))).toBe(true)
    expect(Number.isNaN(parseTime(0))).toBe(true)
  })
})

describe('planWorkLinks 一级：作品 ID 精确命中', () => {
  it('T17a post_id 相等即关联，level 为 1', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { post_id: 'note-1' })],
      works: [{ platform: 'xiaohongshu', postId: 'note-1', title: '任意', metrics: {} }],
      records: [],
    })
    expect(out.links).toHaveLength(1)
    expect(out.links[0]).toMatchObject({ trackedId: 't1', level: 1 })
    expect(out.stats.exact).toBe(1)
  })

  it('T17b 跨平台同名 ID 不得互相关联（平台是一级键的一部分）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { platform: 'xiaohongshu', post_id: '123456' })],
      works: [{ platform: 'douyin', postId: '123456', title: 'x', metrics: {} }],
      records: [],
    })
    expect(out.links).toHaveLength(0)
  })

  it('T17c 两行都指着同一作品 ID 时只关联一行（避免同一份数据被记两次）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { post_id: 'dup' }), row('t2', { post_id: 'dup' })],
      works: [{ platform: 'xiaohongshu', postId: 'dup', title: 'x', metrics: {} }],
      records: [],
    })
    expect(out.links).toHaveLength(1)
  })
})

describe('planWorkLinks 二级：标题 + 时间窗，唯一才认', () => {
  it('T17d 标题相等且时间在窗内、候选唯一 ⇒ level 2 关联', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { publish_history_id: 'task-1' })],
      works: [{ platform: 'xiaohongshu', postId: 'note-9', title: '同一标题', publishedAt: '2026-10-01T03:00:00.000Z', metrics: {} }],
      records: [record('task-1')],
    })
    expect(out.links).toHaveLength(1)
    expect(out.links[0]).toMatchObject({ trackedId: 't1', level: 2 })
    expect(out.stats.fuzzy).toBe(1)
  })

  it('T17e 两个同标题作品都落在窗内 ⇒ 歧义留空，不猜（宁可没有数据）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { publish_history_id: 'task-1' })],
      works: [
        { platform: 'xiaohongshu', postId: 'n1', title: '同一标题', publishedAt: '2026-10-01T03:00:00.000Z', metrics: {} },
        { platform: 'xiaohongshu', postId: 'n2', title: '同一标题', publishedAt: '2026-10-01T04:00:00.000Z', metrics: {} },
      ],
      records: [record('task-1')],
    })
    expect(out.links).toHaveLength(0)
    expect(out.ambiguous).toEqual(['t1'])
    expect(out.stats.ambiguous).toBe(1)
  })

  it('T17f 时间超出窗口 ⇒ 不关联（同名但隔了一周的是不同作品）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { publish_history_id: 'task-1' })],
      works: [{ platform: 'xiaohongshu', postId: 'n1', title: '同一标题', publishedAt: '2026-10-08T03:00:00.000Z', metrics: {} }],
      records: [record('task-1')],
    })
    expect(out.links).toHaveLength(0)
    expect(out.stats.unmatched).toBe(1)
  })

  it('T17g 标题为空的行不参与二级匹配（noTitle 单独计数）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { publish_history_id: 'task-1' })],
      works: [{ platform: 'xiaohongshu', postId: 'n1', title: '', publishedAt: '2026-10-01T03:00:00.000Z', metrics: {} }],
      records: [record('task-1', { title: '' })],
    })
    expect(out.links).toHaveLength(0)
  })

  it('T17h 发布记录侧无时间时退化为「标题唯一即认」，但作品侧无时间同理——不因缺时间就整条丢弃', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { publish_history_id: 'task-1' })],
      works: [{ platform: 'xiaohongshu', postId: 'n1', title: '同一标题', publishedAt: '', metrics: {} }],
      records: [record('task-1', { timestamp: null })],
    })
    expect(out.links).toHaveLength(1)
  })

  it('T17i 二级匹配按平台隔离（同标题不同平台不得互配）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { platform: 'douyin', publish_history_id: 'task-1' })],
      works: [{ platform: 'xiaohongshu', postId: 'n1', title: '同一标题', publishedAt: '2026-10-01T03:00:00.000Z', metrics: {} }],
      records: [record('task-1', { platform: 'douyin' })],
    })
    expect(out.links).toHaveLength(0)
  })

  it('T17j 一级已认领的作品不得被二级再次认领（去重）', () => {
    const out = planWorkLinks({
      trackedRows: [
        row('t1', { post_id: 'n1', publish_history_id: 'task-1' }),
        row('t2', { publish_history_id: 'task-2' }),
      ],
      works: [{ platform: 'xiaohongshu', postId: 'n1', title: '同一标题', publishedAt: '2026-10-01T03:00:00.000Z', metrics: {} }],
      records: [record('task-1'), record('task-2', { id: 'r2' })],
    })
    expect(out.links).toHaveLength(1)
    expect(out.links[0].trackedId).toBe('t1')
  })
})

describe('planWorkLinks 输入健壮性', () => {
  it('空/非法入参不抛错，返回空计划', () => {
    for (const input of [undefined, null, {}, { trackedRows: null, works: null }]) {
      const out = planWorkLinks(input)
      expect(out.links).toEqual([])
      expect(out.stats.exact).toBe(0)
    }
  })

  it('无 postId 的作品被排除（拼不出链接也不该写快照）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { post_id: 'x' })],
      works: [{ platform: 'xiaohongshu', postId: '', title: 't', metrics: {} }],
      records: [],
    })
    expect(out.links).toHaveLength(0)
  })

  it('平台名大小写归一（DOUYIN 与 douyin 是同一平台）', () => {
    const out = planWorkLinks({
      trackedRows: [row('t1', { platform: 'douyin', post_id: 'a1' })],
      works: [{ platform: 'DOUYIN', postId: 'a1', title: 'x', metrics: {} }],
      records: [],
    })
    expect(out.links).toHaveLength(1)
  })
})
