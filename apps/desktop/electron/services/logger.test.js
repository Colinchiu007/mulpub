// @ts-check
/**
 * logger.test.js — 应用日志服务单测
 *
 * 覆盖：日期滚动文件写入、敏感信息脱敏、单文件超限自动删除、
 * 启动核对历史超限文件、clearLogs / getLogsInfo。
 * 全部使用 os.tmpdir() 下独立临时目录，避免污染真实 userData。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

const logger = require('./logger')

function tempLogDir (label) {
  return path.join(os.tmpdir(), `logger-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function listLogFiles (dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith('app-') && name.endsWith('.log'))
}

describe('logger 服务', () => {
  let dir

  beforeEach(() => {
    dir = tempLogDir('case')
  })

  afterEach(async () => {
    await logger.flush()
    logger.clearLogs()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('按日期写入单文件，包含时间戳、级别与消息', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    logger.info('Test', 'hello world')
    await logger.flush()

    const files = listLogFiles(dir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^app-\d{4}-\d{2}-\d{2}\.log$/)
    const content = fs.readFileSync(path.join(dir, files[0]), 'utf8')
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] Test hello world/)
  })

  it('敏感信息脱敏：Bearer 与 sk- 前缀密钥不落盘原文', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    logger.info('Test', 'Bearer sk-abcdef1234567890abcdef', { apiKey: 'sk-secret-xyz', authorization: 'Bearer tok123' })
    await logger.flush()

    const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
    expect(content).toContain('Bearer ***')
    expect(content).not.toContain('sk-abcdef1234567890abcdef')
    expect(content).not.toContain('sk-secret-xyz')
    expect(content).not.toContain('tok123')
    expect(content).toContain('apiKey":"***')
  })

  it('meta 以 JSON 形式落盘并截断超长内容', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    logger.info('Test', 'with meta', { stage: 'split', count: 5 })
    await logger.flush()

    const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
    expect(content).toContain('{"stage":"split","count":5}')
  })

  it('单文件超过上限时滚动到 .1 并重建主文件（多次写入跨 64KB 检查点）', async () => {
    logger.setLogOptions({ dir, maxBytes: 1024 })
    const payload = 'x'.repeat(1024)
    const totalWritten = 100 * payload.length
    for (let i = 0; i < 100; i += 1) {
      logger.info('Test', payload)
      await logger.flush()
    }

    const files = listLogFiles(dir)
    let totalOnDisk = 0
    for (const name of files) totalOnDisk += fs.statSync(path.join(dir, name)).size
    // 删除至少触发过一次：磁盘残留明显小于累计写入量
    expect(totalOnDisk).toBeLessThan(totalWritten * 0.9)
    // 启动核对：首个文件不存在超限文件
    for (const name of files) {
      expect(fs.statSync(path.join(dir, name)).size).toBeLessThan(64 * 1024)
    }
  })

  it('启动核对：历史超限文件在首次写入时被滚动到 .1', async () => {
    logger.setLogOptions({ dir, maxBytes: 1024 })
    // 预置一个超限的当天日志文件
    const today = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const todayFile = `app-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.log`
    fs.mkdirSync(dir, { recursive: true })
    const bigPath = path.join(dir, todayFile)
    fs.writeFileSync(bigPath, 'z'.repeat(5000))

    logger.info('Test', 'after startup')
    await logger.flush()

    // 超限历史文件被滚动到 .1 后重建为新日志行（不再包含 5000 字节旧内容）
    expect(fs.statSync(bigPath).size).toBeLessThan(2000)
    expect(fs.existsSync(bigPath + '.1')).toBe(true)
    const files = listLogFiles(dir)
    expect(files.length).toBe(1)
  })

  it('clearLogs 只清理 app-*.log，getLogsInfo 返回文件列表与总大小', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep me')
    logger.info('Test', 'one')
    logger.info('Test', 'two')
    await logger.flush()

    const before = logger.getLogsInfo()
    expect(before.dir).toBe(dir)
    expect(before.fileCount).toBe(1)
    expect(before.totalBytes).toBeGreaterThan(0)
    expect(Array.isArray(before.files)).toBe(true)
    expect(before.files[0].name).toMatch(/^app-.*\.log$/)

    const removed = logger.clearLogs()
    expect(removed).toBe(1)
    expect(fs.existsSync(path.join(dir, 'keep.txt'))).toBe(true)
    const after = logger.getLogsInfo()
    expect(after.fileCount).toBe(0)
  })

  it('setLogOptions 校验：非法 maxBytes 不生效', async () => {
    logger.setLogOptions({ dir, maxBytes: 1024 })
    const before = logger.getLogsInfo().maxFileBytes
    logger.setLogOptions({ maxBytes: -5 })
    expect(logger.getLogsInfo().maxFileBytes).toBe(before)
  })

  it('appendFile 回调永不触发时写队列超时兜底，不永久挂起且后续写入正常', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024, writeTimeoutMs: 30 })
    const spy = vi.spyOn(fs, 'appendFile').mockImplementation((p, data, enc, cb) => {
      // 故意不调用 cb：模拟极端异常下回调永不触发
    })
    try {
      logger.info('Test', 'stuck write')
      // flush 必须在超时兜底后 resolve，而不是永久 pending
      await expect(logger.flush()).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }

    // 队列释放后，后续写入恢复正常
    logger.info('Test', 'after recover')
    await logger.flush()
    const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
    expect(content).toContain('after recover')
  })

  it('控制台输出与文件同源脱敏：扩展敏感模式不泄露原文', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    const captured = []
    const origConsoleLog = console.log
    // vitest 环境下 vi.spyOn(console,'log') 不可靠（console 被包装），直接赋值替换
    console.log = (...args) => { captured.push(args) }
    const secretMsg = 'Bearer sk-abcdef1234567890 access_token=token123 refresh_token=rt-x "cookie":"sid=abc" eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig12345 password="p@ss"'
    try {
      logger.info('Test', secretMsg)
      await logger.flush()
    } finally {
      console.log = origConsoleLog
    }
    const consoleLine = captured.map((args) => args.join(' ')).join(' | ')
    expect(consoleLine).toContain('Bearer ***')
    expect(consoleLine).not.toContain('sk-abcdef1234567890')
    expect(consoleLine).not.toContain('token123')
    expect(consoleLine).not.toContain('rt-x')
    expect(consoleLine).not.toContain('sid=abc')
    expect(consoleLine).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(consoleLine).not.toContain('p@ss')
    const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
    expect(content).not.toContain('sk-abcdef1234567890')
    expect(content).not.toContain('token123')
    expect(content).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  it('超限滚动保留 .1 备份且主文件继续可写', async () => {
    logger.setLogOptions({ dir, maxBytes: 1024 })
    const payload = 'x'.repeat(1024)
    for (let i = 0; i < 100; i += 1) {
      logger.info('Test', payload)
      await logger.flush()
    }
    const files = fs.readdirSync(dir).filter((name) => name.startsWith('app-'))
    const backups = files.filter((name) => name.endsWith('.1'))
    expect(backups.length).toBeGreaterThanOrEqual(1)
    const main = files.find((name) => name.endsWith('.log') && !name.endsWith('.1'))
    expect(fs.statSync(path.join(dir, main)).size).toBeLessThan(64 * 1024)
  })

  it('按 retentionDays 清理过期日志并保留期内文件', async () => {
    fs.mkdirSync(dir, { recursive: true })
    const pad = (value) => String(value).padStart(2, '0')
    const dateName = (offsetDays) => {
      const d = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000)
      return 'app-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'
    }
    const oldName = dateName(40)
    const recentName = dateName(1)
    fs.writeFileSync(path.join(dir, oldName), 'old')
    fs.writeFileSync(path.join(dir, recentName), 'recent')

    logger.setLogOptions({ dir, retentionDays: 30 })
    logger.info('Test', 'trigger')
    await logger.flush()

    expect(fs.existsSync(path.join(dir, oldName))).toBe(false)
    expect(fs.existsSync(path.join(dir, recentName))).toBe(true)
    expect(logger.getLogsInfo().retentionDays).toBe(30)
  })

  it('超长消息截断并带截断标记', async () => {
    logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
    logger.info('Test', 'y'.repeat(6000))
    await logger.flush()
    const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
    expect(content.length).toBeLessThan(5000)
    expect(content).toContain('…')
  })

  describe('logger.notify() — 通知结构化日志行', () => {
    it('写入 [NOTIFY] 结构化行，含 messageKey / errorCategory / 白名单 params', async () => {
      logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
      logger.notify('batchPublish', 'story2video.quota_exceeded', {
        errorCategory: 'quota_exceeded',
        level: 'warn',
        params: { count: 2, max: 2 },
      })
      await logger.flush()
      const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
      expect(content).toContain('[NOTIFY]')
      expect(content).toContain('batchPublish')
      expect(content).toContain('story2video.quota_exceeded')
      expect(content).toContain('quota_exceeded')
      expect(content).toContain('"count":2')
    })

    it('params 值级脱敏：secret 不落盘原文', async () => {
      logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
      logger.notify('batchPublish', 'story2video.quota_exceeded', {
        errorCategory: 'quota_exceeded',
        level: 'error',
        params: { apiKey: 'sk-secret-xyz', count: 2 },
      })
      await logger.flush()
      const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
      expect(content).not.toContain('sk-secret-xyz')
      expect(content).toContain('***')
    })

    it('换行/控制符被消毒（log injection 防护）', async () => {
      logger.setLogOptions({ dir, maxBytes: 500 * 1024 * 1024 })
      logger.notify('batchPublish', 'story2video.quota_exceeded', {
        errorCategory: 'quota_exceeded',
        level: 'error',
        params: { detail: 'line1\n[FAKE] injected\r\nline2' },
      })
      await logger.flush()
      const content = fs.readFileSync(path.join(dir, listLogFiles(dir)[0]), 'utf8')
      // 换行被转义为 \n 字面量，不产生真实换行注入
      expect(content).not.toContain('line1\n[FAKE]')
      expect(content).toContain('\\n')
    })
  })
})
