// @ts-check
'use strict'
/**
 * kit-import-audit 契约测试（PR-3b 资产导入 · 审计）
 *
 * 覆盖：行格式（制表符分隔 / 空值 `-`）/ 追加写 / 阈值判法（不截断、拒绝写入）/ 父目录预检。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  AuditWriter,
  buildAuditRow,
  auditFilePathOf,
  AUDIT_FILE,
  MAX_AUDIT_LINES,
  MAX_AUDIT_BYTES,
  REASON,
} = require('./kit-import-audit')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-audit-'))
}

describe('kit-import-audit: 行格式', () => {
  it('制表符分隔 + 末尾换行', () => {
    const line = buildAuditRow({
      time: '2026-10-23T00:00:00.000Z',
      senderUrl: 'app://localhost/#/film-engineering',
      senderRoute: '#/film-engineering',
      triggerComponent: 'FilmEngineeringView',
      sourceDir: 'D:/kit',
      result: 'ok',
      reason: null,
      postCheck: 'PASS',
      recoveryState: null,
      recoveryPath: null,
    })
    expect(line.endsWith('\n')).toBe(true)
    const cols = line.replace(/\n$/, '').split('\t')
    expect(cols.length).toBe(10)
    expect(cols[0]).toBe('2026-10-23T00:00:00.000Z')
    expect(cols[6]).toBe('-')
    expect(cols[8]).toBe('-')
  })

  it('空值一律写 `-`，且字段里不出现制表符/换行（不破坏列对齐）', () => {
    const line = buildAuditRow({ reason: 'a\tb\nc', postCheck: null })
    const cols = line.replace(/\n$/, '').split('\t')
    expect(cols.length).toBe(10)
    expect(cols[6]).toBe('a b c')
  })
})

describe('kit-import-audit: 追加与预检', () => {
  it('首次导入：文件不存在是合法的（可创建）', () => {
    const dir = tmpDir()
    const w = new AuditWriter({ userDataDir: dir })
    expect(w.precheck().ok).toBe(true)
    const res = w.append({ time: 't', result: 'start' })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(auditFilePathOf(dir))).toBe(true)
    expect(fs.readFileSync(auditFilePathOf(dir), 'utf8').split('\n').filter(Boolean).length).toBe(1)
  })

  it('追加是追加式：已有内容不被改写', () => {
    const dir = tmpDir()
    const w = new AuditWriter({ userDataDir: dir })
    w.append({ time: 't1', result: 'start' })
    w.append({ time: 't2', result: 'ok' })
    const lines = fs.readFileSync(auditFilePathOf(dir), 'utf8').split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    expect(lines[0].indexOf('t1')).toBe(0)
  })

  it('行数计数：启动时一次计数 + 之后增量累加', () => {
    const dir = tmpDir()
    const w = new AuditWriter({ userDataDir: dir })
    w.append({ time: 't1', result: 'start' })
    expect(w.countLines()).toBe(1)
    w.append({ time: 't2', result: 'ok' })
    expect(w.lineCount).toBe(2)
  })

  it('父目录不可写 ⇒ AUDIT_UNAVAILABLE', () => {
    const dir = tmpDir()
    const w = new AuditWriter({ userDataDir: path.join(dir, 'not-exist-dir') })
    const res = w.precheck()
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.AUDIT_UNAVAILABLE)
  })
})

describe('kit-import-audit: 阈值判法（拒绝写入，不截断）', () => {
  it('行数超阈值 ⇒ 拒绝写入（旧内容不丢）', () => {
    const dir = tmpDir()
    const w = new AuditWriter({ userDataDir: dir })
    w.lineCount = MAX_AUDIT_LINES + 1
    const res = w.append({ time: 't', result: 'ok' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.AUDIT_UNAVAILABLE)
    expect(fs.existsSync(auditFilePathOf(dir))).toBe(false)
  })

  it('字节超阈值 ⇒ 拒绝写入', () => {
    const dir = tmpDir()
    const w = new AuditWriter({ userDataDir: dir })
    fs.writeFileSync(auditFilePathOf(dir), 'x'.repeat(MAX_AUDIT_BYTES + 10), 'utf8')
    const res = w.append({ time: 't', result: 'ok' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.AUDIT_UNAVAILABLE)
  })

  it('审计文件名固定为 film-kit-import.log（与目标 kit 同父）', () => {
    expect(AUDIT_FILE).toBe('film-kit-import.log')
    expect(auditFilePathOf('/data/userData')).toBe(path.join('/data/userData', 'film-kit-import.log'))
  })
})
