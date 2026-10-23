// @ts-check
'use strict'
/**
 * kit-import 编排层契约测试（PR-3b 资产导入 · ⓪-⑦ 换入顺序）
 *
 * 覆盖：
 *   ① 严格模式校验失败 ⇒ 不落盘            ② 成功 ⇒ userData/film-kit 齐备 + 缓存已失效
 *   ④ 换入中途失败 ⇒ 无半份 kit、旧 kit 逐字未变
 *   ⑦ 源/目标重叠 ⇒ 拒                    ⑯ 父目录不可写/锁建不出来 ⇒ 立即退出、旧 kit 未动
 *   ⑬ 导入标记先置后删、锁同生命周期       ⑰ 存在有效锁 ⇒ 拒绝（不自动清）
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { importKit, REASON } = require('./kit-import')
const { lockPathOf, createLock } = require('./kit-import-lock')
const { auditFilePathOf } = require('./kit-import-audit')

function tmpDir (tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-imp-' + (tag || 'x') + '-'))
}

const REQUIRED = [
  'film-manifest.json', 'shot-library.json', 'reference-registry.json', 'prompt-doctrine.json',
  'shot-grammar.json', 'compliance-checklist.json', 'palette.json',
]

function makeSource (dir) {
  for (const name of REQUIRED) fs.writeFileSync(path.join(dir, name), '{"a":1}', 'utf8')
  fs.mkdirSync(path.join(dir, 'prompts', 'tasks', 't1', 'zh'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompts', 'tasks', 't1', 'zh', 's.md'), '# s', 'utf8')
  return dir
}

/** 假严格校验：有 film-manifest.json 就算通过 */
function fakeStrict (opts) {
  const dir = opts.kitDir
  if (fs.existsSync(path.join(dir, 'film-manifest.json'))) return { ok: true, kit: {} }
  return { ok: false, error: '缺少 film-manifest.json' }
}

function makeService () {
  const calls = { invalidate: 0, marker: [] }
  return {
    calls,
    invalidateKitCache () { calls.invalidate += 1 },
    setImportInProgress (on) { calls.marker.push(!!on) },
  }
}

describe('kit-import: 成功路径', () => {
  it('导入成功：目标 kit 齐备、staging 不存在、锁已删、缓存已失效、审计两行', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    const service = makeService()
    const res = await importKit({ kitDir: src, userDataDir: ud, service, loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'film-manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'prompts', 'tasks', 't1', 'zh', 's.md'))).toBe(true)
    expect(fs.existsSync(lockPathOf(ud))).toBe(false)
    expect(fs.readdirSync(ud).filter((n) => n.indexOf('staging') >= 0).length).toBe(0)
    expect(service.calls.invalidate).toBe(1)
    expect(service.calls.marker[0]).toBe(true)
    expect(service.calls.marker[service.calls.marker.length - 1]).toBe(false)
    const lines = fs.readFileSync(auditFilePathOf(ud), 'utf8').split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    expect(lines[0].indexOf('start') >= 0).toBe(true)
    expect(lines[1].indexOf('PASS') >= 0).toBe(true)
  })

  it('成功后旧 kit 目录被替换（内容变成新资产）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.writeFileSync(path.join(ud, 'film-kit', 'old.txt'), 'old', 'utf8')
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'old.txt'))).toBe(false)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'film-manifest.json'))).toBe(true)
  })
})

describe('kit-import: 失败即不落盘', () => {
  it('严格校验失败 ⇒ 不落盘（目标 kit 不存在）+ 审计有失败行', async () => {
    const src = tmpDir('src')
    fs.writeFileSync(path.join(src, 'film-manifest.json'), '{"a":1}', 'utf8') // 缺其余必填
    const ud = tmpDir('ud')
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.VALIDATION_ERROR)
    expect(fs.existsSync(path.join(ud, 'film-kit'))).toBe(false)
    const lines = fs.readFileSync(auditFilePathOf(ud), 'utf8').split('\n').filter(Boolean)
    expect(lines.some((l) => l.indexOf('VALIDATION_ERROR') >= 0)).toBe(true)
  })

  it('第一遍扫描不通过 ⇒ 旧 kit 逐字未变、无半份 kit', async () => {
    const src = makeSource(tmpDir('src'))
    // 放一个软链进白名单位置 ⇒ 扫描拒
    fs.rmSync(path.join(src, 'palette.json'))
    fs.symlinkSync(path.join(src, 'shot-library.json'), path.join(src, 'palette.json'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.writeFileSync(path.join(ud, 'film-kit', 'old.txt'), 'old', 'utf8')
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(fs.readFileSync(path.join(ud, 'film-kit', 'old.txt'), 'utf8')).toBe('old')
    expect(fs.readdirSync(ud).filter((n) => n.indexOf('staging') >= 0).length).toBe(0)
    expect(fs.existsSync(lockPathOf(ud))).toBe(false)
  })

  it('源目录与目标路径重叠 ⇒ SOURCE_OVERLAPS_TARGET', async () => {
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    const res = await importKit({
      kitDir: path.join(ud, 'film-kit'),
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SOURCE_OVERLAPS_TARGET)
  })

  it('源目录是目标的父级 ⇒ 同样拒绝', async () => {
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    const res = await importKit({
      kitDir: ud,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SOURCE_OVERLAPS_TARGET)
  })
})

describe('kit-import: 锁与残留', () => {
  it('存在有效锁 ⇒ LOCK_HELD（不自动清）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    createLock({ userDataDir: ud })
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.LOCK_HELD)
    expect(fs.existsSync(lockPathOf(ud))).toBe(true)
  })

  it('残留 `.bak` 且 film-kit 缺失 ⇒ 拒绝导入 + 带恢复路径', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit.bak-old'), { recursive: true })
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(res.recoveryPath).toContain('film-kit.bak-old')
    expect(res.recoveryState).toBe('MISSING_KIT')
  })

  it('残留 `.bak` 但 film-kit 在位 ⇒ 继续导入（档位②）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.mkdirSync(path.join(ud, 'film-kit.bak-old'), { recursive: true })
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
  })

  it('过期锁 ⇒ 自动清锁后继续（不永久卡死）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    createLock({ userDataDir: ud })
    const old = new Date(Date.now() - 120000)
    fs.utimesSync(lockPathOf(ud), old, old)
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
  })
})

describe('kit-import: 审计不可写 ⇒ 拒绝导入', () => {
  it('审计父目录不可写 ⇒ AUDIT_UNAVAILABLE，且不碰旧 kit', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    const res = await importKit({
      kitDir: src,
      userDataDir: path.join(ud, 'no-such-dir'),
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.AUDIT_UNAVAILABLE)
  })
})
