// @ts-check
/**
 * sidecar-lock.test.js — tasks 6.3 lock 校验器契约锁
 *
 * 核心不是「字段齐不齐」，而是三件「看起来填好了但其实坏了」的事：
 *  A. 两路 pin 漂移：npm wrapper 的 bundledRelease 与 GitHub release 的 tag 各写一遍就会漂
 *  B. hash 形态错误：63 位 / 非十六进制的 sha256 会让下游比对恒不匹配
 *  C. 未取证组件被当成已钉定：ddddocr 的 requirements 与 4 个 onnx 权重 hash 还没取到
 */
const fs = require('fs')
const path = require('path')

const { validateLock, loadAndValidate, resolveAsset, LOCK_PATH } = require('./sidecar-lock')

/** 深拷贝真实 lock，用于构造变体 */
function realLock () {
  return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'))
}

describe('sidecar-lock — 校验器契约（tasks 6.3）', () => {
  it('仓库内真实 lock 必须通过校验（零 problems）', () => {
    const r = loadAndValidate()
    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('camoufox 已钉定且六个平台的 asset 全部带 64 位十六进制 sha256', () => {
    const lock = realLock()
    const cam = lock.components.camoufox
    expect(cam.status).toBe('pinned')
    const keys = Object.keys(cam.assets)
    expect(keys.sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-ia32', 'win32-x64'])
    for (const k of keys) {
      expect(cam.assets[k].sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(cam.assets[k].size).toBeGreaterThan(0)
      expect(cam.assets[k].asset).toMatch(/^camoufox-152\.0\.4-beta\.30-/)
    }
  })

  it('两路交叉：bundledRelease 与 GitHub release tag 必须一致', () => {
    const lock = realLock()
    const tagNorm = lock.sources.camoufoxRelease.tag.replace(/^v/, '')
    expect(lock.components.camoufox.bundledRelease).toBe(tagNorm)
  })

  // —— 反向锁 A：pin 漂移必须被抓住 ——
  it('反向锁 A：bundledRelease 与 release tag 漂移必须报错', () => {
    const lock = realLock()
    lock.components.camoufox.bundledRelease = '153.0.1-beta.1' // 模拟只改了一侧
    const r = validateLock(lock)
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/bundledRelease.*不一致/)
  })

  // —— 反向锁 A2：asset 名前缀与 bundledRelease 漂移同样必须报错 ——
  it('反向锁 A2：asset 名前缀与 bundledRelease 不符必须报错', () => {
    const lock = realLock()
    lock.components.camoufox.assets['win32-x64'].asset = 'camoufox-153.0.1-beta.1-win.x86_64.zip'
    const r = validateLock(lock)
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/必须以 camoufox-152\.0\.4-beta\.30- 开头/)
  })

  // —— 反向锁 B：hash 形态错误必须被抓住 ——
  it('反向锁 B：sha256 少一位必须报错', () => {
    const lock = realLock()
    lock.components.camoufox.assets['win32-x64'].sha256 = lock.components.camoufox.assets['win32-x64'].sha256.slice(0, 63)
    const r = validateLock(lock)
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/64 位十六进制/)
  })

  it('反向锁 B2：sha256 含非十六进制字符必须报错', () => {
    const lock = realLock()
    lock.components.camoufox.assets['win32-x64'].sha256 = 'z' + lock.components.camoufox.assets['win32-x64'].sha256.slice(1)
    const r = validateLock(lock)
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/64 位十六进制/)
  })

  // —— 反向锁 C：未取证组件 fail-closed ——
  it('反向锁 C：pending 组件 resolveAsset 必须抛错（不得启动）', () => {
    const lock = realLock()
    expect(lock.components.ddddocr.status).toBe('pending')
    expect(() => resolveAsset(lock, 'ddddocr', 'any')).toThrow(/尚未钉定/)
  })

  it('resolveAsset：camoufox/win32-x64 返回带官方 sha256 的构件', () => {
    const lock = realLock()
    const a = resolveAsset(lock, 'camoufox', 'win32-x64')
    expect(a.sha256).toBe('ea52a02fb1cfb1813ef6a326bea03fb2b650c9774143d953a94a27bfc8f10072')
    expect(a.size).toBe(493141328)
  })

  it('resolveAsset：未知平台必须抛错并列出可用平台', () => {
    const lock = realLock()
    expect(() => resolveAsset(lock, 'camoufox', 'win32-arm64')).toThrow(/可用: .*win32-x64/)
  })

  // —— 反向锁 C2：pending 却带 asset 是自相矛盾，必须报错 ——
  it('反向锁 C2：status=pending 却带 asset 必须报矛盾', () => {
    const lock = realLock()
    lock.components.ddddocr.assets['any'] = { asset: 'x', size: 1, sha256: 'a'.repeat(64) }
    const r = validateLock(lock)
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/status=pending 但已带/)
  })

  it('反向锁 C3：pinned 却无 asset 必须报错', () => {
    const lock = realLock()
    lock.components.camoufox.assets = {}
    const r = validateLock(lock)
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/没有 assets/)
  })

  it('lock 文件路径与 media-tools-lock 同级', () => {
    expect(LOCK_PATH).toBe(path.join(__dirname, '..', '..', 'sidecar-lock.json'))
    const media = path.join(__dirname, '..', '..', 'media-tools-lock.json')
    expect(fs.existsSync(media)).toBe(true)
  })
})
