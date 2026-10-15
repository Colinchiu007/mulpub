/**
 * preload-path.test.js — sandbox preload「bundle 优先」解析器的锁
 *
 * 为什么这条必须有：sandbox preload **无法 require 相对路径文件**（2026-10-15 真机实测
 * `module not found`），所以任何复用 Node 模块的 preload 都必须加载 esbuild 产物。
 * 若解析器写成"永远返回源文件"，反检测会在**真机静默失效**而在单测里一切正常——
 * 这正是本仓 `stealth-preload.js` 已经踩过一次的坑（隔离世界 patch 主世界无感）。
 */
// 本仓 vitest 配置为 globals:true（describe/it/expect/vi 均为全局），CJS 测试文件
// 不得 `require('vitest')`。
const fs = require('fs')
const os = require('os')
const path = require('path')

const { BUNDLE_SUFFIX, resolveBundledPreloadPath } = require('./preload-path')

let tempDir = null

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-preload-path-'))
})

afterEach(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch (_e) { /* 清理失败不影响断言结论 */ }
  vi.restoreAllMocks()
})

describe('core/preload-path — bundle 优先', () => {
  it('bundle 存在时返回 bundle（sandbox 下唯一可加载形态）', () => {
    const base = path.join(tempDir, 'monitor-preload')
    fs.writeFileSync(base + BUNDLE_SUFFIX, '// bundle')
    fs.writeFileSync(base + '.js', '// source')
    expect(resolveBundledPreloadPath(base)).toEqual({ path: base + BUNDLE_SUFFIX, bundled: true })
  })

  it('bundle 不存在时回退源文件并如实标记 bundled=false（调用方据此出声告警）', () => {
    const base = path.join(tempDir, 'monitor-preload')
    fs.writeFileSync(base + '.js', '// source')
    expect(resolveBundledPreloadPath(base)).toEqual({ path: base + '.js', bundled: false })
  })

  it('两者都不存在时仍返回源文件路径（由 Electron 报加载失败，优于在此抛错阻断建窗）', () => {
    const base = path.join(tempDir, 'missing')
    expect(resolveBundledPreloadPath(base)).toEqual({ path: base + '.js', bundled: false })
  })

  it('探测抛错（权限/锁）时按无 bundle 处理，不得让建窗整体失败', () => {
    const base = path.join(tempDir, 'monitor-preload')
    vi.spyOn(fs, 'existsSync').mockImplementation(() => { throw new Error('EPERM') })
    expect(() => resolveBundledPreloadPath(base)).not.toThrow()
    expect(resolveBundledPreloadPath(base)).toEqual({ path: base + '.js', bundled: false })
  })

  it('非法入参快速失败（避免拼出 "undefined.js" 这类误导性路径）', () => {
    expect(() => resolveBundledPreloadPath('')).toThrow()
    expect(() => resolveBundledPreloadPath(null)).toThrow()
  })
})

describe('core/preload-path — 与真实产物对账', () => {
  it('本仓三个 sandbox preload 的 bundle 均已产出（缺一个即该项反检测/守卫静默失效）', () => {
    // 这条会随 build:preload 漏跑而红——那正是需要被发现的状态
    const electronRoot = path.join(__dirname, '..')
    const expected = [
      path.join(electronRoot, 'monitor-preload'),
      path.join(electronRoot, 'stealth-preload'),
      path.join(electronRoot, 'home-shell-preload'),
    ]
    for (const base of expected) {
      const resolved = resolveBundledPreloadPath(base)
      expect(resolved.bundled, `缺少 ${path.basename(base)}${BUNDLE_SUFFIX}（在 apps/desktop 执行 pnpm run build:preload）`).toBe(true)
    }
  })

  it('monitor / RPA 两个 bundle 必须真的内联了 stealth 源码（否则 sandbox 下 require 会失败）', () => {
    const electronRoot = path.join(__dirname, '..')
    for (const name of ['monitor-preload', 'stealth-preload']) {
      const bundlePath = path.join(electronRoot, name + BUNDLE_SUFFIX)
      const code = fs.readFileSync(bundlePath, 'utf8')
      // 内联证据：evasion id 与标记名出现在产物里（源文件只有 require，不会有这些字面量）
      expect(code, name).toContain('__mpStealthInj')
      expect(code, name).toContain('navigator.userAgentData.brands')
      // 且不得把相对 require 留到运行时（那正是 sandbox 加载失败的原因）
      expect(code, name).not.toMatch(/require\(["']\.\/stealth["']\)/)
    }
  })
})
