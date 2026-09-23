'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const cacheService = require('./cache-service')

function makeTempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cache-svc-test-'))
}

describe('cache-service', () => {
  let roots
  beforeEach(() => {
    roots = {
      story2video: makeTempDir(),
      filmEngineering: makeTempDir(),
    }
  })

  afterEach(() => {
    for (const dir of Object.values(roots)) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  function putFile (absPath, content) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content)
  }

  it('getCacheRoots 返回两个 tmpdir 缓存根，且不含 userData 持久项目', () => {
    const list = cacheService.getCacheRoots()
    const keys = list.map(r => r.key)
    expect(keys).toEqual(['story2video', 'filmEngineering'])
    for (const root of list) {
      expect(root.dir).toContain(path.join(os.tmpdir()))
      expect(root.dir).not.toContain('story2video-projects')
    }
  })

  it('getCacheStats 递归统计各目录文件字节与数量', () => {
    putFile(path.join(roots.story2video, 'a.mp4'), 'x'.repeat(100))
    putFile(path.join(roots.story2video, 'sub', 'b.mp4'), 'y'.repeat(50))
    putFile(path.join(roots.filmEngineering, 'final.mp4'), 'z'.repeat(30))

    const stats = cacheService.getCacheStats({ roots })
    expect(stats.totalBytes).toBe(180)
    expect(stats.fileCount).toBe(3)
    const s2v = stats.items.find(i => i.key === 'story2video')
    expect(s2v.totalBytes).toBe(150)
    expect(s2v.fileCount).toBe(2)
    const fe = stats.items.find(i => i.key === 'filmEngineering')
    expect(fe.totalBytes).toBe(30)
  })

  it('目录不存在时统计为 0，不抛错', () => {
    const stats = cacheService.getCacheStats({ roots: { story2video: path.join(roots.story2video, 'nope'), filmEngineering: roots.filmEngineering } })
    const s2v = stats.items.find(i => i.key === 'story2video')
    expect(s2v.totalBytes).toBe(0)
    expect(s2v.fileCount).toBe(0)
  })

  it('clearCache 删除根目录内容但保留根目录本身，返回释放字节', () => {
    putFile(path.join(roots.story2video, 'a.mp4'), 'x'.repeat(100))
    putFile(path.join(roots.story2video, 's2v_session', 'output.mp4'), 'y'.repeat(200))
    putFile(path.join(roots.filmEngineering, 'final.mp4'), 'z'.repeat(40))

    const result = cacheService.clearCache({ roots })
    expect(result.freedBytes).toBe(340)
    expect(fs.existsSync(roots.story2video)).toBe(true) // 根保留
    expect(fs.readdirSync(roots.story2video)).toHaveLength(0)
    expect(fs.readdirSync(roots.filmEngineering)).toHaveLength(0)
    expect(result.removedDirs).toBeGreaterThanOrEqual(1)
    expect(result.removedFiles).toBeGreaterThanOrEqual(2)
  })

  it('clearCache 后统计归零', () => {
    putFile(path.join(roots.story2video, 'a.mp4'), 'x'.repeat(10))
    cacheService.clearCache({ roots })
    expect(cacheService.getCacheStats({ roots }).totalBytes).toBe(0)
  })

  it('跳过越界符号链接，不计入统计也不删除目标', () => {
    const outside = makeTempDir()
    try {
      const secret = path.join(outside, 'secret.mp4')
      putFile(secret, 'keepme')
      const link = path.join(roots.story2video, 'evil-link')
      try {
        fs.symlinkSync(outside, link, 'dir')
      } catch {
        return // Windows 无符号链接权限则跳过本用例
      }
      const stats = cacheService.getCacheStats({ roots })
      // 符号链接本身不贡献文件计数（其内容不应被统计）
      expect(stats.items.find(i => i.key === 'story2video').fileCount).toBe(0)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})
