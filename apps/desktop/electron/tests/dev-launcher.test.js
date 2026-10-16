import { describe, expect, it } from 'vitest'

const { buildElectronArgs } = require('../../scripts/dev-launcher')

describe('dev-launcher', () => {
  it('uses software compositing so the Electron window is not blank', () => {
    const args = buildElectronArgs({
      electronUserDataDir: 'C:/tmp/multi-publish-dev-user',
      electronCacheDir: 'C:/tmp/multi-publish-dev-user/cache',
      desktopDir: 'C:/tmp/multi-publish-dev-desktop',
      platform: 'win32',
    })

    // 2026-10-16 契约变更：默认**不得**带 --no-sandbox —— 它与下面的 swiftshader 三件套
    // 同时开启时，登录检测拉起的隐藏 BrowserWindow 会触发原生渲染崩溃（主进程直接消失、
    // crashpad not connected、无 minidump）。旧断言把崩溃组合写成期望，正是本仓
    // 「默认配置即崩溃配置」得以长期存在的原因之一。见
    // openspec/records/fix-hidden-window-render-crash.md。
    expect(args).not.toContain('--no-sandbox')
    expect(args).toContain('--disable-gpu')
    expect(args).toContain('--disable-gpu-compositing')
    expect(args).toContain('--use-gl=angle')
    expect(args).toContain('--use-angle=swiftshader')
    expect(args).toContain('--enable-unsafe-swiftshader')
    // 全组合性质锁：四种 (noSandbox, softwareGpu) 取值都不得产回崩溃组合
    for (const [noSandbox, softwareGpu] of [[true, true], [true, false], [false, true], [false, false]]) {
      const combo = buildElectronArgs({
        electronUserDataDir: 'C:/tmp/u', electronCacheDir: 'C:/tmp/u/c', desktopDir: 'C:/tmp/d',
        platform: 'win32', noSandbox, softwareGpu,
      })
      expect(combo.includes('--no-sandbox') && combo.some(a => String(a).includes('swiftshader'))).toBe(false)
    }
    expect(args).not.toContain('--in-process-gpu')
    expect(args[args.length - 1]).toBe('C:/tmp/multi-publish-dev-desktop')
  })

  it('keeps explicit user data and cache directories', () => {
    const args = buildElectronArgs({
      electronUserDataDir: 'C:/tmp/multi-publish-dev-user',
      electronCacheDir: 'C:/tmp/multi-publish-dev-user/cache',
      desktopDir: 'C:/tmp/multi-publish-dev-desktop',
      platform: 'win32',
    })

    expect(args).toContain('--user-data-dir=C:/tmp/multi-publish-dev-user')
    expect(args).toContain('--disk-cache-dir=C:/tmp/multi-publish-dev-user/cache')
  })
})
