// @ts-check
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  KIND_TOPIC,
  KIND_ITEM,
  normalizeKind,
  pickContentFields,
  hasContentFields,
  validateEntry,
  filterViableEntries,
  withLegacyKind,
} from './hot-topics/item-model.js'
import { parseDouyin, parseXiaohongshu, parseToutiao } from './hot-topics/channels.js'

// 读源码类锁按仓库既有惯例用 __dirname（与 src/href-scheme-contract.test.js 同一写法）
const HERE = __dirname

const topic = (o) => ({ channel: 'douyin', kind: KIND_TOPIC, rank: 1, topic: '测试选题', hotValue: 10, url: null, rawCategory: null, ...o })

describe('normalizeKind：判别位闭集，不猜', () => {
  it('只认 topic / item', () => {
    expect(normalizeKind('topic')).toBe('topic')
    expect(normalizeKind('item')).toBe('item')
  })

  // 规格 Requirement 1「取值闭集」：把非法值静默归一成任一合法值，等于用默认值掩盖产出层的漏写
  it('非法值一律返回 null（不得静默归一）', () => {
    for (const bad of ['topics', 'video', 'ITEM', '', '   ', null, undefined, 0, 1, {}, []]) {
      expect(normalizeKind(bad)).toBeNull()
    }
  })
})

describe('pickContentFields：缺席 / 空值 / 非法值三态分离', () => {
  it('三个字段都缺席 ⇒ 空对象，且 hasContentFields 为假', () => {
    expect(pickContentFields({})).toEqual({})
    expect(hasContentFields(pickContentFields({}))).toBe(false)
  })

  it('author：非干净字符串一律不采纳（禁止用渠道名/平台名兜底）', () => {
    expect(pickContentFields({ author: '  张三  ' })).toEqual({ author: '张三' })
    for (const bad of [null, undefined, '', '   ', 0, 123, {}, [], true]) {
      expect(pickContentFields({ author: bad })).not.toHaveProperty('author')
    }
    // 超长视为来源畸形：截断会得到一个"看起来真"的作者名，比缺席更坏
    expect(pickContentFields({ author: 'x'.repeat(129) })).not.toHaveProperty('author')
  })

  it('publishTime：只接受 ISO 形态；抓取时间戳不是发布时间', () => {
    expect(pickContentFields({ publishTime: '2026-10-18T09:51:15+08:00' })).toEqual({ publishTime: '2026-10-18T09:51:15+08:00' })
    expect(pickContentFields({ publishTime: '2026-10-18' })).toEqual({ publishTime: '2026-10-18' })
    for (const bad of [1700000000000, '刚刚', '今天', '2026/10/18', new Date(1700000000000), null, '']) {
      expect(pickContentFields({ publishTime: bad })).not.toHaveProperty('publishTime')
    }
  })

  // `0` 是真实读数，"没有互动数据"是缺席——把两者写成同一个值会让界面把未知显示成 0
  it('interaction：只保留非负整数；0 必须保留；空对象/全 undefined 视为缺席', () => {
    expect(pickContentFields({ interaction: { like: 0 } })).toEqual({ interaction: { like: 0 } })
    expect(pickContentFields({ interaction: { like: 12, comment: 3 } })).toEqual({ interaction: { like: 12, comment: 3 } })
    for (const bad of [{}, { like: undefined }, { like: null }, { like: -1 }, { like: 'many' }, { like: 1.5 }, [], 'x']) {
      expect(hasContentFields(pickContentFields({ interaction: bad }))).toBe(false)
    }
    // 未登记的键不得混入（O-3 未取证前不得为 play 留空壳）
    expect(pickContentFields({ interaction: { like: 5, favoriteCount: 9 } })).toEqual({ interaction: { like: 5 } })
  })
})

describe('validateEntry：item 三全空即不合格（拦装饰性升级）', () => {
  it('topic 合格需要文本', () => {
    expect(validateEntry(topic({}))).toEqual({ ok: true, reason: null })
    expect(validateEntry(topic({ topic: '   ' })).ok).toBe(false)
    expect(validateEntry(topic({ topic: '' })).reason).toBe('TOPIC_TEXT_MISSING')
  })

  it('item 三字段全空 ⇒ ITEM_NO_CONTENT', () => {
    const r = validateEntry(topic({ kind: KIND_ITEM, author: null, publishTime: null, interaction: {} }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ITEM_NO_CONTENT')
  })

  it('item 只要有一个真字段就合格（部分数据是常态）', () => {
    expect(validateEntry(topic({ kind: KIND_ITEM, author: '张三' })).ok).toBe(true)
    expect(validateEntry(topic({ kind: KIND_ITEM, interaction: { like: 0 } })).ok).toBe(true)
  })

  it('kind 缺失/非法 ⇒ KIND_INVALID，不得由消费层推断', () => {
    const noKind = { channel: 'douyin', rank: 1, topic: 'x' }
    expect(validateEntry(noKind).reason).toBe('KIND_INVALID')
    expect(validateEntry(topic({ kind: 'video' })).reason).toBe('KIND_INVALID')
  })
})

describe('filterViableEntries：丢弃发生在采集出口，日志不记文本', () => {
  it(' kept/dropped/reasons 三态如实', () => {
    const input = [
      topic({}),
      topic({ kind: KIND_ITEM }),
      topic({ kind: 'video' }),
      topic({ kind: KIND_ITEM, author: '李四' }),
    ]
    const out = filterViableEntries(input)
    expect(out.kept.map(x => x.kind)).toEqual(['topic', 'item'])
    expect(out.dropped).toBe(2)
    expect(out.reasonCounts).toEqual({ ITEM_NO_CONTENT: 1, KIND_INVALID: 1 })
  })

  // 标题文本此刻是平台公开值，但同一出口将来会承载用户待发布内容：判据一律只记计数与原因
  it('告警只记渠道/计数/原因，不含条目文本', () => {
    const seen = []
    const log = { warn: (m) => seen.push(m) }
    filterViableEntries([topic({ topic: '绝不能出现在日志里', kind: 'video' })], { channel: 'douyin', log })
    expect(seen.length).toBe(1)
    expect(seen[0]).toContain('douyin')
    expect(seen[0]).toContain('KIND_INVALID')
    expect(seen[0]).not.toContain('绝不能出现在日志里')
  })

  it('item 的文本缺席也算不合格（不得产出无题条目）', () => {
    expect(filterViableEntries([{ channel: 'x', kind: KIND_ITEM, author: 'A', topic: '' }]).dropped).toBe(1)
  })
})

describe('withLegacyKind：旧缓存读作 topic，不做反向迁移', () => {
  it('无 kind 补 topic；已有 kind 原样保留', () => {
    expect(withLegacyKind({ topic: 'a' }).kind).toBe('topic')
    expect(withLegacyKind({ topic: 'a', kind: 'item' }).kind).toBe('item')
    // 非法值不得被"修复"成合法值——那是消费层推断
    expect(withLegacyKind({ topic: 'a', kind: 'video' }).kind).toBe('video')
    expect(Array.isArray(withLegacyKind(null))).toBe(false)
  })
})

describe('产出层：kind 由解析器写入，不由消费层补', () => {
  const root = HERE
  const src = fs.readFileSync(path.join(root, 'hot-topics/channels.js'), 'utf8')
  const parserNames = (src.match(/^function (parse[A-Za-z]+)/gm) || []).map(s => s.replace('function ', ''))
  // 反失明：解析域必须非空，否则"计数相等"会变成恒真
  it('扫描到真实的解析器集合（规模下界）', () => {
    expect(parserNames.length).toBeGreaterThanOrEqual(13)
  })

  it('每个解析器都显式产出 kind 判别位', () => {
    const emitted = (src.match(/kind: KIND_TOPIC/g) || []).length
    expect(emitted).toBe(parserNames.length - 1) // parseCnNumber 不产出条目，故减一
  })

  it('真实解析器输出项带 kind=topic（行为锁，不只读源码）', () => {
    const dy = parseDouyin({ data: { word_list: [{ word: '甲', position: 1, hot_value: 9, sentence_id: '1' }] } })
    expect(dy).toHaveLength(1)
    expect(dy[0].kind).toBe('topic')
    expect(validateEntry(dy[0]).ok).toBe(true)

    const xhs = parseXiaohongshu({ data: { items: [{ title: '乙', score: '947.5w', word_type: '热' }] } })
    expect(xhs[0].kind).toBe('topic')
    expect(validateEntry(xhs[0]).ok).toBe(true)

    const tt = parseToutiao({ data: [{ Title: '丙', HotValue: '123', Url: 'https://www.toutiao.com/a1' }] })
    expect(tt[0].kind).toBe('topic')
    expect(validateEntry(tt[0]).ok).toBe(true)
  })

  it('topic 态不得凭空产出内容字段（缺席就是缺席）', () => {
    const dy = parseDouyin({ data: { word_list: [{ word: '甲', position: 1, hot_value: 9, sentence_id: '1' }] } })
    expect(pickContentFields(dy[0])).toEqual({})
  })
})

describe('投影链接线守卫：三道手工白名单必须同时含新字段', () => {
  const servicesDir = HERE
  const read = (p) => fs.readFileSync(p, 'utf8')

  it('服务层两个采集出口都接了资格判据与判别位', () => {
    const svc = read(path.join(servicesDir, 'hot-topics-service.js'))
    const calls = (svc.match(/filterViableEntries\(/g) || []).length
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(svc).toMatch(/kind: x\.kind/)
    expect(svc).toMatch(/pickContentFields\(/)
  })

  it('缓存读取接了旧数据归一', () => {
    const svc = read(path.join(servicesDir, 'hot-topics-service.js'))
    expect(svc).toMatch(/withLegacyKind/)
  })

  it('收藏投影（IPC 入口白名单）含判别位与内容段', () => {
    const h = read(path.resolve(servicesDir, '..', 'ipc-handlers', 'hot-topics.js'))
    expect(h).toMatch(/kind: KIND_TOPIC|kind: normalizeKind/)
    expect(h).toMatch(/pickContentFields/)
  })
})
