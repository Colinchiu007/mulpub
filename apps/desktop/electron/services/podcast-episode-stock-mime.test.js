import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const MOD = path.resolve(__dirname, 'podcast-episode-stock-mime.js')
async function load () { return import(MOD) }
const require2 = createRequire(import.meta.url)

function tmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podstock-'))
  const file = path.join(dir, 'episodes.json')
  const idx = path.join(dir, 'index.json')
  return { dir, file, idx }
}

/** §7.9.5 第 1 条：真库往返——真实 fs + 关闭再重开同一文件读回。 */
function makeDeps (t, episodes) {
  fs.writeFileSync(t.idx, JSON.stringify({ version: 1, channels: [{ id: 'c1' }] }))
  fs.writeFileSync(t.file, JSON.stringify({ version: 1, episodes }))
  return {
    listChannels: () => [{ channelId: 'c1', episodesFile: t.file }],
    readEpisodes: (f) => JSON.parse(fs.readFileSync(f, 'utf8')),
    writeEpisodes: (f, store) => fs.writeFileSync(f, JSON.stringify(store)),
    readIndex: () => JSON.parse(fs.readFileSync(t.idx, 'utf8')),
    writeIndex: (i) => fs.writeFileSync(t.idx, JSON.stringify(i)),
    withChannelLock: (id, section, fn) => fn(),
    logger: { info () {}, warn: vi.fn(), error () {} },
  }
}

describe('§7.9.5-1/2 真库往返与幂等', () => {
  it('固化后关闭再重开同一文件读回：脏值被派生、戳记落盘', async () => {
    const { freezeStockMime } = await load()
    const t = tmpStore()
    const deps = makeDeps(t, [
      { id: 'a', mime: 'audio/mpeg', enclosureUrl: 'https://x/a.mp3' },
      { id: 'b', enclosureUrl: 'https://x/b.m4a' },
      { id: 'c', mime: '', enclosureUrl: 'https://x/c.mp3?sig=1' },
    ])
    const r = await freezeStockMime(deps)
    expect(r.filled).toBe(2)
    expect(r.unresolved).toBe(0)
    // 重新起一份 deps（等价于进程重启后重开文件）
    const reopened = JSON.parse(fs.readFileSync(t.file, 'utf8')).episodes
    expect(reopened[1].mime).toBe('audio/mp4')
    expect(reopened[2].mime).toBe('audio/mpeg')
    const idx = JSON.parse(fs.readFileSync(t.idx, 'utf8'))
    expect(idx.stockStamp.filled).toBe(2)
    expect(idx.stockStamp.scanned).toBe(3)
    fs.rmSync(t.dir, { recursive: true, force: true })
  })

  it('幂等：第二次 frozen 直接跳过，filled=0 且 episodes 字节不变', async () => {
    const { freezeStockMime } = await load()
    const t = tmpStore()
    const deps = makeDeps(t, [{ id: 'b', enclosureUrl: 'https://x/b.m4a' }])
    await freezeStockMime(deps)
    const bytes = fs.readFileSync(t.file, 'utf8')
    const deps2 = Object.assign({}, deps, {
      readEpisodes: () => JSON.parse(fs.readFileSync(t.file, 'utf8')),
      writeEpisodes: vi.fn(),
    })
    const r2 = await freezeStockMime(deps2)
    expect(r2.skipped).toBe(true)
    expect(deps2.writeEpisodes).not.toHaveBeenCalled()
    expect(fs.readFileSync(t.file, 'utf8')).toBe(bytes)
    fs.rmSync(t.dir, { recursive: true, force: true })
  })
})

describe('§7.9.5-3/4/5 只补不改、不得整体判死、不猜', () => {
  const base = (eps) => ({
    listChannels: () => [{ channelId: 'c1', episodesFile: 'f' }],
    readEpisodes: () => ({ version: 1, episodes: eps }),
    writeEpisodes: vi.fn(),
    readIndex: () => ({}),
    writeIndex: vi.fn(),
    withChannelLock: (id, s, fn) => fn(),
    logger: { info () {}, warn () {}, error () {} },
  })

  it('合法值那一期的每个键逐字节不变，连 mimeSource 都不补', async () => {
    const { freezeStockMimeInArray } = await load()
    const legal = { id: 'a', mime: 'audio/mpeg', enclosureUrl: 'https://x/a.mp3', title: '标题' }
    const r = freezeStockMimeInArray([legal, { id: 'b', url: 'https://x/b.m4a' }])
    expect(r.episodes[0]).toBe(legal)
    expect(Object.keys(r.episodes[0])).toEqual(['id', 'mime', 'enclosureUrl', 'title'])
    expect(r.filled).toBe(1)
  })

  it('键序沿用原对象，新键追加在尾（不重排、不改顺序）', async () => {
    const { freezeStockMimeInArray } = await load()
    const r = freezeStockMimeInArray([{ id: 'b', title: 'T', url: 'https://x/b.m4a' }])
    expect(Object.keys(r.episodes[0])).toEqual(['id', 'title', 'url', 'mime', 'mimeSource'])
  })

  it('派生不出 ⇒ 保持原状并计入 unresolved，绝不填默认值', async () => {
    const { freezeStockMimeInArray } = await load()
    const odd = { id: 'z', mime: 'audio/mp3', url: 'https://x/z.bin' }
    const r = freezeStockMimeInArray([odd])
    expect(r.filled).toBe(0)
    expect(r.unresolved).toBe(1)
    expect(r.changed).toBe(false)
    expect(r.episodes[0]).toBe(odd)
  })

  it('非法但可扩展名派生（空串 / audio/mp3 / 大小写 / 带参数）⇒ 全部按事实改写', async () => {
    const { freezeStockMimeInArray } = await load()
    const eps = [
      { id: '1', mime: '', url: 'https://x/1.mp3' },
      { id: '2', mime: 'audio/mp3', url: 'https://x/2.mp3' },
      { id: '3', mime: 'AUDIO/MPEG', url: 'https://x/3.mp3' },
      { id: '4', mime: 'audio/mpeg;codecs=mpeg3', url: 'https://x/4.mp3' },
    ]
    const r = freezeStockMimeInArray(eps)
    expect(r.filled).toBe(4)
    for (const e of r.episodes) expect(e.mime).toBe('audio/mpeg')
  })

  it('单频道解析失败 ⇒ 跳过并计入 unresolvedChannels，其余照常且不冒泡', async () => {
    const { freezeStockMime } = await load()
    const warn = vi.fn()
    const deps = {
      listChannels: () => [{ channelId: 'bad', episodesFile: 'b' }, { channelId: 'ok', episodesFile: 'o' }],
      readEpisodes: (f) => { if (f === 'b') throw new Error('EJSONPARSE'); return { version: 1, episodes: [{ id: '1', url: 'https://x/1.mp3' }] } },
      writeEpisodes: vi.fn(),
      readIndex: () => ({}),
      writeIndex: vi.fn(),
      withChannelLock: (id, s, fn) => fn(),
      logger: { info () {}, warn, error () {} },
    }
    const r = await freezeStockMime(deps)
    expect(r.channels).toBe(1)
    expect(r.unresolvedChannels).toEqual(['bad'])
    expect(deps.writeEpisodes).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
  })

  it('固化路径全部经按 channelId 的注入锁（本层不新造第二把）', async () => {
    const { freezeStockMime } = await load()
    const withChannelLock = vi.fn((id, section, fn) => fn())
    const deps = Object.assign(base([{ id: '1', url: 'https://x/1.mp3' }]), { withChannelLock })
    await freezeStockMime(deps)
    expect(withChannelLock).toHaveBeenCalledTimes(1)
    expect(withChannelLock.mock.calls[0][0]).toBe('c1')
    expect(withChannelLock.mock.calls[0][1]).toBe('stock-mime-freeze')
  })

  it('缺任一注入实现即抛 PODCAST_EPISODE_INVALID，不许回落真实目录', async () => {
    const { freezeStockMime } = await load()
    for (const k of ['listChannels', 'readEpisodes', 'writeEpisodes', 'readIndex', 'writeIndex', 'withChannelLock']) {
      const deps = base([])
      delete deps[k]
      await expect(freezeStockMime(deps)).rejects.toMatchObject({ code: 'PODCAST_EPISODE_INVALID' })
    }
  })
})

describe('§7.9.5-6/7 判据同源与本层无跨用例状态', () => {
  it('容器判据来自抽取层唯一真源，本文件不自带第二份字面量集合', async () => {
    await load()
    const src = fs.readFileSync(MOD, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).toContain('ttsAudioContainers')
    expect(src).not.toContain('planAudioCodec')
    expect(src).not.toMatch(/['"]audio\/mpeg['"]\s*[,\]]/)
    const { legal, byExt } = (await load()).stockMimeTable()
    const { ttsAudioContainers, planAudioCodec } = require2('./podcast-episode-source')
    // 合法集必须与源层两条计划**逐字相同**（自比自的恒真断言不构成锁）
    const table = ttsAudioContainers()
    expect([...legal].sort()).toEqual(table.map((p) => p.mime).sort())
    // 选型 API 与容器表不得漂移（新增容器时只有一处真源，两条出口必须同源同值）
    for (const p of table) {
      const picked = planAudioCodec(p.codec)
      expect(picked).toBeTruthy()
      expect(picked.codec).toBe(p.codec)
      expect(picked.ext).toBe(p.ext)
      expect(picked.mime).toBe(p.mime)
      expect(picked.args).toEqual(p.args)
    }
    // 只读出口：调用方拿到的是副本，改它不得污染源表
    const again = ttsAudioContainers()
    again[0].codec = 'mutated'
    expect(ttsAudioContainers()[0].codec).not.toBe('mutated')
    expect(byExt.get('.mp3')).toBe(planAudioCodec('libmp3lame').mime)
    expect(byExt.get('.m4a')).toBe(planAudioCodec('aac').mime)
    expect(planAudioCodec('libmp3lame').ext).toBe('.mp3')
    expect(planAudioCodec('aac').ext).toBe('.m4a')
  })

  it('本层不得有模块级可变单例：两次调用互不污染（跨用例状态曾让下一条判据短路）', async () => {
    const m = await load()
    const a = m.freezeStockMimeInArray([{ id: '1', url: 'https://x/1.mp3' }])
    const b = m.freezeStockMimeInArray([{ id: '2', url: 'https://x/2.wav' }])
    expect(a.filled).toBe(1)
    expect(b.unresolved).toBe(1)
    const src = fs.readFileSync(MOD, 'utf8')
    expect(src).not.toMatch(/^const (activeOwners|cache|state)\s*=\s*new (Map|Set|\[)/m)
  })

  it('扩展名解析覆盖 query/fragment 与超长后缀误判', async () => {
    const { extOf } = await load()
    expect(extOf('https://x/a.mp3?sig=1&v=2')).toBe('.mp3')
    expect(extOf('https://x/a.m4a#t=10')).toBe('.m4a')
    expect(extOf('https://x/no-ext')).toBe('')
    expect(extOf('')).toBe('')
    expect(extOf('https://x/a.abcdefg')).toBe('')
  })
})
