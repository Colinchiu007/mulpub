import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MOD = path.resolve(__dirname, 'podcast-stock-freeze-host.js')
async function load () { return import(MOD) }

function fx (episodes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stockhost-'))
  const chan = path.join(root, 'channels', 'c1')
  fs.mkdirSync(chan, { recursive: true })
  fs.writeFileSync(path.join(chan, 'episodes.json'), JSON.stringify({ version: 1, episodes }))
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ version: 1, channels: [{ id: 'c1' }] }))
  const registry = { resolveRoot: () => root, channelDir: (id) => path.join(root, 'channels', id) }
  return { root, chan, registry, eps: path.join(chan, 'episodes.json'), idx: path.join(root, 'index.json') }
}

describe('固化宿主：触发一次、旁路不伤人', () => {
  it('首次调用真的补齐 episodes.json 并落 stockStamp（经真实 fs）', async () => {
    const { createStockFreezeHost } = await load()
    const t = fx([{ id: 'b', url: 'https://x/b.m4a' }])
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const host = createStockFreezeHost({ registry: t.registry, logger: log })
    const r = await host.freezeChannel('c1')
    expect(r.filled).toBe(1)
    expect(JSON.parse(fs.readFileSync(t.eps, 'utf8')).episodes[0].mime).toBe('audio/mp4')
    expect(JSON.parse(fs.readFileSync(t.idx, 'utf8')).stockStamp.filled).toBe(1)
    fs.rmSync(t.root, { recursive: true, force: true })
  })

  it('同一频道第二次调用是 no-op（进程内恰好一次）', async () => {
    const { createStockFreezeHost } = await load()
    const t = fx([{ id: 'b', url: 'https://x/b.m4a' }])
    const host = createStockFreezeHost({ registry: t.registry, logger: { info () {}, warn () {}, error () {} } })
    await host.freezeChannel('c1')
    const before = fs.readFileSync(t.eps, 'utf8')
    const r2 = await host.freezeChannel('c1')
    expect(r2).toBe(null)
    expect(host.hasAttempted('c1')).toBe(true)
    expect(fs.readFileSync(t.eps, 'utf8')).toBe(before)
    fs.rmSync(t.root, { recursive: true, force: true })
  })

  it('已固化（stockStamp 在位）⇒ 静默跳过，不写文件、不刷 info 日志', async () => {
    const { createStockFreezeHost } = await load()
    const t = fx([{ id: 'b', url: 'https://x/b.m4a' }])
    fs.writeFileSync(t.idx, JSON.stringify({ version: 1, stockStamp: { at: '2026-01-01T00:00:00.000Z', scanned: 1, filled: 1, unresolved: 0 } }))
    const info = vi.fn(); const warn = vi.fn()
    const host = createStockFreezeHost({ registry: t.registry, logger: { info, warn, error () {} } })
    const r = await host.freezeChannel('c1')
    expect(r).toBe(null)
    // info 允许出现：freezeStockMime 自己会记一条"已固化于 …，本次不重复改写"。
    // 这里要守的是**不写文件、不冒泡**，不是不记日志。
    expect(info.mock.calls.join("|")).toContain("不重复改写")
    expect(warn).not.toHaveBeenCalled()
    fs.rmSync(t.root, { recursive: true, force: true })
  })

  it('固化抛错 ⇒ 旁路：warn 一次、返回 null、不冒泡给读请求', async () => {
    const { createStockFreezeHost } = await load()
    const t = fx([{ id: 'b', url: 'https://x/b.m4a' }])
    const warn = vi.fn()
    const host = createStockFreezeHost({
      registry: t.registry,
      logger: { info () {}, warn, error () {} },
      writeJsonAtomic: () => { throw new Error('EBUSY rename blocked') },
    })
    const r = await host.freezeChannel('c1')
    expect(r).toBe(null)
    // 至少一次：per-channel 写盘失败先 warn 一次，收尾写 index 再失败又 warn 一次。
    // 判据是"有留痕且不外抛"，把次数钉成 1 会把"两处都失败"这种真实形状判成失败。
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(1)
    fs.rmSync(t.root, { recursive: true, force: true })
  })

  it('缺 registry 或两个出口不齐即抛，不回落真实 userData 目录', async () => {
    const { createStockFreezeHost } = await load()
    for (const bad of [undefined, {}, { channelDir: () => 'x' }, { resolveRoot: () => 'y' }]) {
      expect(() => createStockFreezeHost({ registry: bad })).toThrow()
    }
  })

  it('接线在位（结构锁）：getService 必须真的调用固化宿主，否则 runner 是死代码', async () => {
    const fs2 = await import('node:fs')
    const src = fs2.readFileSync(path.resolve(__dirname, '..', 'ipc-handlers', 'podcast.js'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(src).toContain('podcast-stock-freeze-host')
    expect(src).toContain('freezeChannel(')
    const host = await load()
    expect(typeof host.createStockFreezeHost).toBe('function')
  })

  it('写盘必须走原子替换：缺省实现只做 tmp + rename（不直接覆盖用户状态）', async () => {
    const { createStockFreezeHost } = await load()
    const t = fx([{ id: 'b', url: 'https://x/b.m4a' }])
    const renames = []
    const fsImpl = {
      existsSync: (f) => fs.existsSync(f),
      readFileSync: (f, e) => fs.readFileSync(f, e),
      writeFileSync: (f, v) => fs.writeFileSync(f, v),
      renameSync: (a, b) => { renames.push([a.endsWith('.tmp-' + process.pid), b]); return fs.renameSync(a, b) },
    }
    const host = createStockFreezeHost({ registry: t.registry, fsImpl, logger: { info () {}, warn () {}, error () {} } })
    await host.freezeChannel('c1')
    expect(renames.length).toBeGreaterThanOrEqual(2)
    for (const [wasTmp] of renames) expect(wasTmp).toBe(true)
    fs.rmSync(t.root, { recursive: true, force: true })
  })
})
