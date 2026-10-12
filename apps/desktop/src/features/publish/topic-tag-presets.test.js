import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  createGroupId,
  loadTopicTagPresets,
  normalizeGroupName,
  normalizeGroupTopics,
  saveTopicTagPresets,
} from './topic-tag-presets'

// 常用话题标签预设存储（topic-tag-unify，PRD §4.3-4.4 / §7）：
// localStorage v1 结构 { version:1, groups:[{id,name,topics}] }，
// 读取必须容错（损坏数据过滤丢弃而非抛错），写入失败静默 warn。

describe('normalizeGroupName（组名校验）', () => {
  it('trim 非空才合法，超长截断到 30', () => {
    expect(normalizeGroupName('  科技  ')).toBe('科技')
    expect(normalizeGroupName('   ')).toBe('')
    expect(normalizeGroupName(null)).toBe('')
    const long = '组'.repeat(40)
    expect(normalizeGroupName(long)).toHaveLength(30)
  })
})

describe('normalizeGroupTopics（话题名清理）', () => {
  it('剥 # 与空白、过滤空值、组内去重、单个截断 30', () => {
    expect(normalizeGroupTopics([' #科技 ', 'AI', 'AI', '', '##', '生 活'])).toEqual(['科技', 'AI', '生活'])
    const long = '话'.repeat(40)
    expect(normalizeGroupTopics([long])).toEqual(['话'.repeat(30)])
    expect(normalizeGroupTopics('not-array')).toEqual([])
    expect(normalizeGroupTopics([42, {}])).toEqual([])
  })
})

describe('loadTopicTagPresets（读取容错）', () => {
  beforeEach(() => { localStorage.clear() })

  it('空存储返回空 groups', () => {
    expect(loadTopicTagPresets()).toEqual({ version: 1, groups: [] })
  })

  it('正常结构原样读回（含 id）', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      groups: [{ id: 'g_1', name: '科技', topics: ['AI', '科技'] }],
    }))
    expect(loadTopicTagPresets()).toEqual({
      version: 1,
      groups: [{ id: 'g_1', name: '科技', topics: ['AI', '科技'] }],
    })
  })

  it('version 不是 1 视为空并返回空结构', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, groups: [{ name: 'x', topics: [] }] }))
    expect(loadTopicTagPresets()).toEqual({ version: 1, groups: [] })
  })

  it('损坏 JSON / 非对象 / groups 非数组 → 空结构不抛错', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    expect(loadTopicTagPresets()).toEqual({ version: 1, groups: [] })
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2]))
    expect(loadTopicTagPresets()).toEqual({ version: 1, groups: [] })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, groups: 'nope' }))
    expect(loadTopicTagPresets()).toEqual({ version: 1, groups: [] })
  })

  it('坏条目逐个过滤：缺 name / name 非法 / topics 非数组的组被丢弃，坏话题被剔除', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      groups: [
        { id: 'g_ok', name: ' 科技 ', topics: ['AI', '', 42, ' #生活 '] },
        { name: '   ', topics: ['x'] },
        { id: 'g_bad', topics: ['x'] },
        { id: 'g_bad2', name: '合法组', topics: 'nope' },
      ],
    }))
    expect(loadTopicTagPresets()).toEqual({
      version: 1,
      groups: [{ id: 'g_ok', name: '科技', topics: ['AI', '生活'] }],
    })
  })

  it('同名组（大小写不敏感）后者丢弃；组内话题去重由 normalize 兜底', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      groups: [
        { id: 'g_a', name: 'Tech', topics: ['AI'] },
        { id: 'g_b', name: ' tech ', topics: ['x'] },
      ],
    }))
    const loaded = loadTopicTagPresets()
    expect(loaded.groups).toHaveLength(1)
    expect(loaded.groups[0].id).toBe('g_a')
  })
})

describe('saveTopicTagPresets（写入）', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('写入后可读回，输入中的坏数据被归一', () => {
    saveTopicTagPresets([{ name: ' 科技 ', topics: ['AI', ''] }])
    expect(loadTopicTagPresets()).toEqual({
      version: 1,
      groups: [{ id: expect.any(String), name: '科技', topics: ['AI'] }],
    })
  })

  it('QuotaExceeded 等写失败不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = window.Storage.prototype.setItem
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      expect(() => saveTopicTagPresets([{ name: '科技', topics: ['AI'] }])).not.toThrow()
      expect(warn).toHaveBeenCalled()
    } finally {
      window.Storage.prototype.setItem = original
      warn.mockRestore()
    }
  })
})

describe('createGroupId', () => {
  it('唯一且非空', () => {
    const a = createGroupId()
    const b = createGroupId()
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
    expect(a.startsWith('g_')).toBe(true)
  })
})
