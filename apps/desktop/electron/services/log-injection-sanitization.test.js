// @ts-check
/**
 * log-injection-sanitization.test.js — 日志注入消毒单测（spec: log-injection-sanitization）
 *
 * 验证 sanitizeLogMetaValue 在 notify() 落盘前对外部文本的消毒契约：
 *  - \n / \r 折叠为单个空格（杜绝伪造新日志行）
 *  - < 0x20 且非 \t 的控制符（\x00、\x1b 等）被剔除
 *  - \t（0x09）保留（对齐用途）
 *  - 凭证仍由 redact() 统一脱敏，消毒不削弱脱敏
 *  - 注入串 "ok\n[NOTIFY] evil module fake" 必须保持单行（不新增日志行）
 *
 * 全部使用 os.tmpdir() 下独立临时目录，避免污染真实 userData。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

const logger = require('./logger')
const { sanitizeLogMetaValue } = logger

function tempLogDir (label) {
  return path.join(os.tmpdir(), `injection-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function listLogFiles (dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith('app-') && name.endsWith('.log'))
}

describe('sanitizeLogMetaValue 单元契约', () => {
  it('换行/回车折叠为单个空格', () => {
    expect(sanitizeLogMetaValue('a\nb\nc')).toBe('a b c')
  })

  it('水平制表符保留', () => {
    expect(sanitizeLogMetaValue('a\tb')).toBe('a\tb')
  })

  it('NUL 与 ESC 控制符被剔除（可见的 ANSI 字面序列保留）', () => {
    const input = 'cmd\x00arg\x1b[31mred'
    const out = sanitizeLogMetaValue(input)
    // 仅 < 0x20 的非 \t 控制符被剔除：\x00 与 \x1b 消失
    expect(out).not.toContain('\x00')
    expect(out).not.toContain('\x1b')
    // 可见的 [31m 字面字符仍保留（已无控制符，不会触发真实转义序列）
    expect(out).toBe('cmdarg[31mred')
  })

  it('递归消毒嵌套 object 的键与值', () => {
    const input = { 'key\nx': 'val\r1', nested: ['a\nb', '\x00c'] }
    const out = sanitizeLogMetaValue(input)
    expect(out).toEqual({ 'key x': 'val 1', nested: ['a b', 'c'] })
  })

  it('递归消毒 array 元素', () => {
    const out = sanitizeLogMetaValue(['x\ny', 'z\x1b'])
    expect(out).toEqual(['x y', 'z'])
  })

  it('非字符串/对象/数组原样返回', () => {
    expect(sanitizeLogMetaValue(42)).toBe(42)
    expect(sanitizeLogMetaValue(true)).toBe(true)
    expect(sanitizeLogMetaValue(null)).toBe(null)
  })
})

describe('notify 日志注入防护（端到端落盘）', () => {
  let dir

  beforeEach(() => {
    dir = tempLogDir('case')
  })

  afterEach(() => {
    try { logger.clearLogs() } catch { /* noop */ }
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* noop */ }
  })

  async function readSingleLog () {
    await logger.flush()
    const files = listLogFiles(dir)
    expect(files.length).toBeGreaterThan(0)
    return fs.readFileSync(path.join(dir, files[0]), 'utf8')
  }

  it('外部文本中的换行不产生真实新日志行，整条仍为单行', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    logger.notify('PublishIPC', 'batch-error', {
      level: 'ERROR',
      errorCategory: 'batch_failed',
      params: { detail: 'ok\n[NOTIFY] evil module fake' },
    })
    const content = await readSingleLog()
    // 真实换行（\n 字面字符，非 JSON 转义）不得出现——防止伪造第二行日志
    expect(content).not.toContain('ok\n[NOTIFY]')
    // 折叠后仍保留语义内容，且被收纳进 JSON 的 detail 字段（是数据，不是日志头）
    expect(content).toMatch(/"detail":"ok \[NOTIFY\] evil module fake"/)
    // 整条仅产生【一条】真实日志头（[NOTIFY] <module> <messageKey>），
    // 注入的 [NOTIFY] 只是 detail 内的字符串数据，不生成第二个日志头
    const headerCount = (content.match(/\[NOTIFY\] PublishIPC/g) || []).length
    expect(headerCount).toBe(1)
    // 整段折叠后物理行数恒为 1：不存在伪造的第二行日志
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(1)
  })

  it('控制符在 params 中被剔除，不污染日志行', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    logger.notify('AccountIPC', 'delete-ok', {
      params: { accountId: 'd39af89b', raw: 'hack\x00me\x1b[1m' },
    })
    const content = await readSingleLog()
    expect(content).not.toContain('\x00')
    expect(content).not.toContain('\x1b')
    expect(content).toContain('"accountId":"d39af89b"')
  })

  it('凭证仍被脱敏（消毒不削弱 redact 合同）', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    const secret = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
    logger.notify('ApiUsageGovernor', 'quota-exceeded', {
      level: 'ERROR',
      errorCategory: 'quota_exceeded',
      params: { providerId: 'openai', token: secret },
    })
    const content = await readSingleLog()
    expect(content).not.toContain(secret)
    // redact 合同：保留前缀 4 位字符后接 ***（sk-ABCD***）
    expect(content).toContain('sk-ABCD***')
    expect(content).not.toContain('sk-ABCDE')
  })

  it('error 字段的换行同样被折叠', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    logger.notify('PublishProgress', 'phase-failed', {
      level: 'WARN',
      errorCategory: 'publish_failed',
      error: 'boom\nstack: at evil()',
    })
    const content = await readSingleLog()
    expect(content).not.toContain('boom\nstack')
    expect(content).toMatch(/boom stack: at evil\(\)/)
  })
})
