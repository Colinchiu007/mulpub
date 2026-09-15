import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVersion, compareLevel, runGate } from './release-gate.mjs'

const CHANGELOG_WITH = (ver, breaking = false) =>
  `# [未发布] 其他条目\n\n## [v${ver}] - 2026-09-14\n${breaking ? '\n### BREAKING CHANGE: 移除旧 IPC 接口\n' : '\n### feat: 正常功能\n'}`

test('parseVersion 解析 v 前缀与裸版本', () => {
  assert.deepEqual(parseVersion('v0.1.0'), { major: 0, minor: 1, patch: 0, raw: '0.1.0' })
  assert.deepEqual(parseVersion('2.3.53'), { major: 2, minor: 3, patch: 53, raw: '2.3.53' })
  assert.equal(parseVersion('not-a-version'), null)
})

test('compareLevel 判定 bump 级别', () => {
  const t = parseVersion('0.2.0')
  assert.equal(compareLevel(t, parseVersion('0.1.0')), 'minor')
  assert.equal(compareLevel(parseVersion('0.1.1'), parseVersion('0.1.0')), 'patch')
  assert.equal(compareLevel(parseVersion('1.0.0'), parseVersion('0.9.9')), 'major')
  assert.equal(compareLevel(t, null), 'patch')
})

test('runGate 硬失败：tag 与 root 版本不一致（未 bump 就打 tag）', () => {
  const r = runGate({ rootVersion: '0.1.0', changelog: CHANGELOG_WITH('0.1.0'), tag: 'v0.2.0' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('版本号未更新')))
})

test('runGate 硬失败：CHANGELOG 未收口（缺少目标版本小节）', () => {
  const r = runGate({ rootVersion: '0.2.0', changelog: '# [未发布] 还没收口\n', tag: 'v0.2.0' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('CHANGELOG 未收口')))
})

test('runGate 硬失败：root 与 desktop 版本不一致', () => {
  const r = runGate({ rootVersion: '0.2.0', desktopVersion: '0.1.0', changelog: CHANGELOG_WITH('0.2.0'), tag: 'v0.2.0' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('版本不一致')))
})

test('runGate 通过：tag 与 root 一致且 CHANGELOG 已收口', () => {
  const r = runGate({ rootVersion: '0.2.0', desktopVersion: '0.2.0', changelog: CHANGELOG_WITH('0.2.0'), tag: 'v0.2.0' })
  assert.equal(r.ok, true)
  assert.equal(r.errors.length, 0)
})

test('runGate 软警告：破坏性变更标记但本次为 patch 级', () => {
  // 含上一版本 v0.1.0，本次 v0.1.1 为 patch 级且带破坏性标记 → 警告
  const changelog =
    '## [v0.1.0] - 2026-09-13\n\n### feat: 旧功能\n\n' +
    '## [v0.1.1] - 2026-09-14\n\n### BREAKING CHANGE: 移除旧 IPC 接口\n'
  const r = runGate({ rootVersion: '0.1.1', desktopVersion: '0.1.1', changelog, tag: 'v0.1.1' })
  assert.equal(r.ok, true) // 软警告不阻断
  assert.ok(r.warnings.some((w) => w.includes('破坏性变更')))
})

test('runGate 软警告不触发：破坏性变更但 bump 了 minor', () => {
  // 含上一版本 v0.1.0，本次 v0.2.0 为 minor 级且带破坏性标记 → 不警告
  const changelog =
    '## [v0.1.0] - 2026-09-13\n\n### feat: 旧功能\n\n' +
    '## [v0.2.0] - 2026-09-14\n\n### BREAKING CHANGE: 重构发布管线\n'
  const r = runGate({ rootVersion: '0.2.0', desktopVersion: '0.2.0', changelog, tag: 'v0.2.0' })
  assert.equal(r.ok, true)
  assert.equal(r.warnings.length, 0)
})

test('runGate 本地自检（无 tag）：仅校验 CHANGELOG 与一致性', () => {
  const pass = runGate({ rootVersion: '0.3.0', desktopVersion: '0.3.0', changelog: CHANGELOG_WITH('0.3.0') })
  assert.equal(pass.ok, true)
  const fail = runGate({ rootVersion: '0.3.0', changelog: '# [未发布]\n' })
  assert.equal(fail.ok, false)
})
