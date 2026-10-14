// @ts-check
/**
 * story2video-compose-engine 临时文件清理单元测试 (P2-7)
 *
 * 测试 _cleanupSession 和 _cleanupOldSessions 的行为
 * 使用真实临时目录，不 mock fs，确保清理逻辑实际生效
 */
'use strict'

// Mock logger
__registerMock('../services/logger', {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
})

const fs = require('fs')
const path = require('path')
const os = require('os')
const { Story2VideoComposeEngine } = require('./story2video-compose-engine')

/**
 * 创建唯一临时目录用于测试
 */
function createTestOutputDir () {
  const dir = path.join(os.tmpdir(), 's2v-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 创建模拟的 sessionDir（含 segments + output.mp4）
 */
function createMockSessionDir (outputDir, sessionId) {
  const sessionDir = path.join(outputDir, sessionId)
  fs.mkdirSync(sessionDir, { recursive: true })
  // 模拟 segment 文件
  fs.writeFileSync(path.join(sessionDir, 'seg_0000.mp4'), 'fake-segment-1')
  fs.writeFileSync(path.join(sessionDir, 'seg_0001.mp4'), 'fake-segment-2')
  // 模拟 concat_list.txt
  fs.writeFileSync(path.join(sessionDir, 'concat_list.txt'), "file 'seg_0000.mp4'\nfile 'seg_0001.mp4'")
  // 模拟 output.mp4
  fs.writeFileSync(path.join(sessionDir, 'output.mp4'), 'fake-output-video')
  return sessionDir
}

describe('Story2VideoComposeEngine — _cleanupSession (P2-7)', () => {
  let engine, outputDir

  beforeEach(() => {
    outputDir = createTestOutputDir()
    engine = new Story2VideoComposeEngine({ outputDir, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
  })

  afterEach(() => {
    // 清理测试目录
    try { fs.rmSync(outputDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
  })

  it('1. 清理存在的 sessionDir — 目录被删除', () => {
    const sessionDir = createMockSessionDir(outputDir, 's2v_test123')
    expect(fs.existsSync(sessionDir)).toBe(true)
    engine._cleanupSession(sessionDir)
    expect(fs.existsSync(sessionDir)).toBe(false)
  })

  it('2. 清理不存在的 sessionDir — 不报错', () => {
    const nonExist = path.join(outputDir, 's2v_nonexist')
    expect(() => engine._cleanupSession(nonExist)).not.toThrow()
  })

  it('拒绝删除 outputDir 之外的目录', () => {
    const outside = createTestOutputDir()
    const marker = path.join(outside, 'keep.txt')
    fs.writeFileSync(marker, 'keep')
    try {
      engine._cleanupSession(outside)
      expect(fs.existsSync(marker)).toBe(true)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('3. 清理 sessionDir 后 segments 和 concat_list 全部删除', () => {
    const sessionDir = createMockSessionDir(outputDir, 's2v_test_files')
    expect(fs.existsSync(path.join(sessionDir, 'seg_0000.mp4'))).toBe(true)
    expect(fs.existsSync(path.join(sessionDir, 'concat_list.txt'))).toBe(true)
    engine._cleanupSession(sessionDir)
    expect(fs.existsSync(path.join(sessionDir, 'seg_0000.mp4'))).toBe(false)
    expect(fs.existsSync(path.join(sessionDir, 'concat_list.txt'))).toBe(false)
  })

  it('4. 清理时记录日志', () => {
    const sessionDir = createMockSessionDir(outputDir, 's2v_test_log')
    engine._cleanupSession(sessionDir)
    expect(engine.log.info).toHaveBeenCalledWith('Story2VideoCompose', 'Cleaned sessionDir: s2v_test_log')
  })
})

describe('Story2VideoComposeEngine — _cleanupOldSessions (P2-7)', () => {
  let engine, outputDir

  beforeEach(() => {
    outputDir = createTestOutputDir()
    engine = new Story2VideoComposeEngine({ outputDir, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
  })

  afterEach(() => {
    try { fs.rmSync(outputDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
  })

  it('5. 清理超过 maxAge 的旧 sessionDir', () => {
    // 创建一个旧 sessionDir 并修改 mtime 为 2 天前
    const oldSession = createMockSessionDir(outputDir, 's2v_old_session')
    const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 天前
    fs.utimesSync(oldSession, oldTime, oldTime)

    // 创建一个新 sessionDir（当前时间，不应被清理）——同样要按被测方的钟盖章，理由见上
    const newSession = createMockSessionDir(outputDir, 's2v_new_session')
    const newTime = new Date()
    fs.utimesSync(newSession, newTime, newTime)

    const cleaned = engine._cleanupOldSessions(24 * 60 * 60 * 1000) // 24h
    expect(cleaned).toBe(1)
    expect(fs.existsSync(oldSession)).toBe(false)
    expect(fs.existsSync(newSession)).toBe(true)
  })

  it('6. 不清理非 s2v_ 前缀的目录', () => {
    const otherDir = path.join(outputDir, 'other_data')
    fs.mkdirSync(otherDir, { recursive: true })
    const cleaned = engine._cleanupOldSessions(0) // 立即过期
    expect(cleaned).toBe(0)
    expect(fs.existsSync(otherDir)).toBe(true)
  })

  it('7. 不清理普通文件（仅清理目录）', () => {
    const file = path.join(outputDir, 's2v_not_a_dir.txt')
    fs.writeFileSync(file, 'fake')
    const cleaned = engine._cleanupOldSessions(0)
    expect(cleaned).toBe(0)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('8. 返回清理的目录数', () => {
    // 创建 3 个旧 sessionDir
    for (let i = 0; i < 3; i++) {
      const session = createMockSessionDir(outputDir, 's2v_old_' + i)
      const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000) // 48h 前
      fs.utimesSync(session, oldTime, oldTime)
    }
    const cleaned = engine._cleanupOldSessions(24 * 60 * 60 * 1000)
    expect(cleaned).toBe(3)
  })

  it('9. 默认使用 this.maxSessionAgeMs (24h)', () => {
    // 25h 前的应被清理
    const oldSession = createMockSessionDir(outputDir, 's2v_25h')
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    fs.utimesSync(oldSession, oldTime, oldTime)
    // 23h 前的不应被清理
    const recentSession = createMockSessionDir(outputDir, 's2v_23h')
    const recentTime = new Date(Date.now() - 23 * 60 * 60 * 1000)
    fs.utimesSync(recentSession, recentTime, recentTime)

    const cleaned = engine._cleanupOldSessions() // 默认 24h
    expect(cleaned).toBe(1)
    expect(fs.existsSync(oldSession)).toBe(false)
    expect(fs.existsSync(recentSession)).toBe(true)
  })

  it('10. outputDir 不存在时不报错', () => {
    const badEngine = new Story2VideoComposeEngine({
      outputDir: '/nonexistent/path/xyz',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    expect(() => badEngine._cleanupOldSessions()).not.toThrow()
  })
})

describe('Story2VideoComposeEngine — constructor maxSessionAgeMs (P2-7)', () => {
  it('11. 默认 maxSessionAgeMs 为 24h', () => {
    const e = new Story2VideoComposeEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    expect(e.maxSessionAgeMs).toBe(24 * 60 * 60 * 1000)
  })

  it('12. 自定义 maxSessionAgeMs', () => {
    const e = new Story2VideoComposeEngine({
      maxSessionAgeMs: 3600000,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    expect(e.maxSessionAgeMs).toBe(3600000)
  })
})
