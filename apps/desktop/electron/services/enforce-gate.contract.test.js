// @vitest-environment node
// enforce-gate 契约锁（forced-update-gate 2026-10-19）：
// 1. zh/en 文案键集合一致（缺键回英文的机制成立前提）；
// 2. phase1-context 接线锁：四条钩子必须接线（照 qm1-child-env.test.js 接线锁先例）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('enforce-gate-text 文案字典', () => {
  const { TEXTS, KEYS, readGateText } = require('./enforce-gate-text.js')

  it('zh/en 键集合完全一致（CI Gate 7 同源约束的主进程侧）', () => {
    expect(Object.keys(TEXTS.zh).sort()).toEqual(KEYS)
    expect(Object.keys(TEXTS.en).sort()).toEqual(KEYS)
  })

  it('locale 前缀选择：zh* → 中文，其他 → 英文', () => {
    expect(readGateText('zh-CN').lang).toBe('zh')
    expect(readGateText('zh').lang).toBe('zh')
    expect(readGateText('en-US').lang).toBe('en')
    expect(readGateText('ja-JP').lang).toBe('en')
    expect(readGateText('').lang).toBe('en')
  })

  it('所有键值非空字符串', () => {
    for (const key of KEYS) {
      expect(typeof TEXTS.zh[key]).toBe('string')
      expect(TEXTS.zh[key].length).toBeGreaterThan(0)
      expect(typeof TEXTS.en[key]).toBe('string')
      expect(TEXTS.en[key].length).toBeGreaterThan(0)
    }
  })

  it('versionLine / downloading 含插值占位符', () => {
    expect(TEXTS.zh.gateVersionLine).toContain('{current}')
    expect(TEXTS.zh.gateVersionLine).toContain('{target}')
    expect(TEXTS.zh.gateDownloading).toContain('{percent}')
    expect(TEXTS.en.gateVersionLine).toContain('{current}')
    expect(TEXTS.en.gateDownloading).toContain('{percent}')
  })
})

describe('phase1-context 接线锁（缺一即红）', () => {
  const phase1Path = join(here, '../bootstrap/phase1-context.js')
  const src = readFileSync(phase1Path, 'utf-8')

  it('setUpdatePolicyConsumer → enforceGate.onPolicy 接线', () => {
    expect(src).toMatch(/setUpdatePolicyConsumer\s*\(/)
    expect(src).toMatch(/enforceGate\.onPolicy/)
  })

  it('setOnSyncOutcome → enforceGate.onSyncOutcome 接线', () => {
    expect(src).toMatch(/setOnSyncOutcome\s*\(/)
    expect(src).toMatch(/enforceGate\.onSyncOutcome/)
  })

  it('identity onAuthenticated → syncNow 刷新接线（phase3：登录成功即刷新策略）', () => {
    const phase3Src = readFileSync(join(here, '../bootstrap/phase3-services.js'), 'utf-8')
    expect(phase3Src).toMatch(/onAuthenticated/)
    expect(phase3Src).toMatch(/opsCenterSync\.syncNow/)
  })

  it('shutdown 路径调用 enforceGate.dispose（shutdown.js before-quit 协调器）', () => {
    const shutdownSrc = readFileSync(join(here, '../shutdown.js'), 'utf-8')
    expect(shutdownSrc).toMatch(/enforce-gate/)
    expect(shutdownSrc).toMatch(/dispose\(\)/)
  })

  it('6h 轮询启动（enforceGate.startPolling）', () => {
    expect(src).toMatch(/enforceGate\.startPolling/)
  })

  it('ops-center-sync 必须公开 setOnSyncOutcome setter（转发同步结果）', () => {
    const syncSrc = readFileSync(join(here, './ops-center-sync.js'), 'utf-8')
    expect(syncSrc).toMatch(/setOnSyncOutcome\s*\(/)
  })

  it('identity auth-service 必须公开 onAuthenticated 订阅器', () => {
    const authSrc = readFileSync(join(here, './identity/auth-service.js'), 'utf-8')
    expect(authSrc).toMatch(/onAuthenticated/)
  })

  it('auto-updater 必须公开 onProgress 订阅器（进度透传给 gate 窗口）', () => {
    const updaterSrc = readFileSync(join(here, './auto-updater.js'), 'utf-8')
    expect(updaterSrc).toMatch(/function onProgress|onProgress\s*[=(]/)
    expect(updaterSrc).toMatch(/module\.exports[^]*onProgress/)
  })
})
