/**
 * quick-collect-materials — 素材合并 / 去重 / 时间窗口 / 协议判据
 *
 * 这四条是"结论有没有据"的闸门，每条都要有独立用例：
 *   非法 url 丢弃（AC-8）、窗口过滤（AC-9）、url 去重保高 engagement、缺时间戳在窗口开启时丢弃。
 */
import { describe, it, expect } from 'vitest'

const NOW = Date.parse('2026-10-11T04:00:00.000Z') // 2026-10-11 12:00 UTC+8
const hoursAgo = (h) => Math.floor((NOW - h * 3600 * 1000) / 1000)

function item (over = {}) {
  return {
    url: 'https://example.com/a',
    title: '某条素材',
    source: 'hackernews',
    snippet: '摘要',
    engagement: 1,
    created_utc: hoursAgo(1),
    ...over,
  }
}

async function mod () {
  return import('../services/quick-collect-materials')
}

describe('quick-collect-materials/normalizeMaterial', () => {
  it('非法 url 一律丢弃（javascript: / 缺协议 / 内网字面量）', async () => {
    const { normalizeMaterial } = await mod()
    for (const url of ['javascript:alert(1)', 'example.com/a', 'file:///etc/passwd', '', undefined]) {
      const r = normalizeMaterial(item({ url }), { windowHours: 0, now: NOW })
      expect(r.ok, String(url)).toBe(false)
      expect(r.reason).toBe('invalid_url')
    }
  })

  it('标题为空丢弃；标题/摘要超长截断', async () => {
    const { normalizeMaterial, TITLE_MAX, SNIPPET_MAX } = await mod()
    expect(normalizeMaterial(item({ title: '  ' }), { windowHours: 0, now: NOW }).reason).toBe('missing_title')
    const long = normalizeMaterial(item({ title: 'x'.repeat(500), snippet: 'y'.repeat(500) }), { windowHours: 0, now: NOW })
    expect(long.material.title.length).toBe(TITLE_MAX)
    expect(long.material.snippet.length).toBe(SNIPPET_MAX)
  })

  it('窗口开启时：窗口内通过、窗口外丢弃、缺时间戳丢弃、未来时间戳丢弃', async () => {
    const { normalizeMaterial } = await mod()
    expect(normalizeMaterial(item({ created_utc: hoursAgo(47) }), { windowHours: 48, now: NOW }).ok).toBe(true)
    expect(normalizeMaterial(item({ created_utc: hoursAgo(49) }), { windowHours: 48, now: NOW }).reason).toBe('out_of_window')
    expect(normalizeMaterial(item({ created_utc: undefined }), { windowHours: 48, now: NOW }).reason).toBe('missing_time')
    const future = Math.floor(NOW / 1000) + 3 * 86400
    expect(normalizeMaterial(item({ created_utc: future }), { windowHours: 48, now: NOW }).reason).toBe('future_time')
  })

  it('窗口关闭（0）时不按时间过滤，但仍要求合法 url', async () => {
    const { normalizeMaterial } = await mod()
    expect(normalizeMaterial(item({ created_utc: undefined }), { windowHours: 0, now: NOW }).ok).toBe(true)
    expect(normalizeMaterial(item({ created_utc: hoursAgo(24 * 365) }), { windowHours: 0, now: NOW }).ok).toBe(true)
    expect(normalizeMaterial(item({ url: 'nope' }), { windowHours: 0, now: NOW }).ok).toBe(false)
  })
})

describe('quick-collect-materials/mergeMaterials', () => {
  it('同一 url 去重并保留 engagement 更高者', async () => {
    const { mergeMaterials } = await mod()
    const out = mergeMaterials([
      item({ url: 'https://a.com/x', title: '低热度', engagement: 1 }),
      item({ url: 'https://a.com/x', title: '高热度', engagement: 9 }),
    ], { windowHours: 0, now: NOW })
    expect(out.materials).toHaveLength(1)
    expect(out.materials[0].title).toBe('高热度')
    expect(out.materials[0].engagement).toBe(9)
  })

  it('按 engagement 倒序并截断到 limit（默认 12）', async () => {
    const { mergeMaterials, MATERIAL_LIMIT } = await mod()
    const many = Array.from({ length: 20 }, (_, i) => item({ url: 'https://a.com/' + i, engagement: i }))
    const out = mergeMaterials(many, { windowHours: 0, now: NOW })
    expect(MATERIAL_LIMIT).toBe(12)
    expect(out.materials).toHaveLength(12)
    expect(out.materials[0].engagement).toBe(19)
    expect(out.materials[11].engagement).toBe(8)
  })

  it('时间窗口过滤 + 丢弃原因计数（AC-9）', async () => {
    const { mergeMaterials } = await mod()
    const out = mergeMaterials([
      item({ url: 'https://a.com/in', created_utc: hoursAgo(2) }),
      item({ url: 'https://a.com/out', created_utc: hoursAgo(72) }),
      item({ url: 'javascript:alert(1)', title: '脏 url' }),
    ], { windowHours: 48, now: NOW })
    expect(out.materials).toHaveLength(1)
    expect(out.materials[0].url).toBe('https://a.com/in')
    expect(out.dropped.out_of_window).toBe(1)
    expect(out.dropped.invalid_url).toBe(1)
    expect(out.droppedTotal).toBe(2)
  })

  it('非数组输入返回空集合（不抛错）', async () => {
    const { mergeMaterials } = await mod()
    expect(mergeMaterials(null, { windowHours: 0, now: NOW }).materials).toEqual([])
  })
})

describe('quick-collect-materials/summarizeRetrieval', () => {
  it('四态：skipped / empty / partial / ok', async () => {
    const { summarizeRetrieval } = await mod()
    expect(summarizeRetrieval({ queryCount: 0, materialCount: 0 })).toBe('skipped')
    expect(summarizeRetrieval({ queryCount: 2, materialCount: 0 })).toBe('empty')
    expect(summarizeRetrieval({ queryCount: 2, materialCount: 3, failedQueries: 1 })).toBe('partial')
    expect(summarizeRetrieval({ queryCount: 2, materialCount: 3, failedQueries: 0 })).toBe('ok')
    // 有素材但全查询失败：仍算 partial（不能因为 failedQueries 覆盖 materialCount 判定）
    expect(summarizeRetrieval({ queryCount: 2, materialCount: 1, failedQueries: 2 })).toBe('partial')
  })
})
