'use strict'
/**
 * gate9-classify.js 的回归锁（2026-10-12）。
 *
 * 反证纪律：每条判据都配一条「把判据改宽必须立刻变红」的用例，
 * 只证「业务输入得到预期输出」不能证明锁在跑。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyGate9 } = require('./gate9-classify.js')

const DESKTOP = 'apps/desktop/src/views/Foo.vue'
const OPS = 'ops-center/frontend/src/views/ChangePassword.vue'
const DOC = '01-docs/PRD.md'

test('维护型标题（fix/chore/docs/refactor/test 前缀）→ report-only', () => {
  for (const t of ['fix(x): a', 'chore(x): a', 'docs(x): a', 'refactor(x): a', 'test(x): a']) {
    const r = classifyGate9({ title: t, changedFiles: [DESKTOP] })
    assert.equal(r.mode, 'report-only', t)
  }
})

test('维护型 label → report-only（与标题同权）', () => {
  const r = classifyGate9({ title: 'feat(x): a', labels: 'bug', changedFiles: [DESKTOP] })
  assert.equal(r.mode, 'report-only')
})

test('反证：标题前缀判据被摘掉 → 立刻红（证明锁在跑）', () => {
  const { MAINTENANCE_TITLE_RE } = require('./gate9-classify.js')
  assert.match('fix(x): a', MAINTENANCE_TITLE_RE)
  // 若有人把 MAINTENANCE_TITLE_RE 放宽成永假，上面那条用例会红
})

test('缺陷①根因回归：只碰 ops-center 的 feat PR → 审 ops-center 自己，不审桌面端存量', () => {
  const r = classifyGate9({
    title: 'feat(ops-center): 更改密码',
    changedFiles: [OPS, 'ops-center/backend/routers/auth.py'],
  })
  assert.equal(r.mode, 'full')
  assert.equal(r.srcDir, 'ops-center/frontend/src')
  assert.deepEqual(r.docPaths, ['ops-center/docs/PRD.md'])
  assert.match(r.reason, /ops-center/)
})

test('碰桌面端 → 全量桌面端审计（既有行为不回归）', () => {
  const r = classifyGate9({ title: 'feat(x): a', changedFiles: [DESKTOP, OPS] })
  assert.equal(r.mode, 'full')
  assert.equal(r.srcDir, 'apps/desktop/src')
  assert.deepEqual(r.docPaths, ['01-docs/PRD.md'])
})

test('桌面端单独变更也走全量', () => {
  const r = classifyGate9({ title: 'feat(x): a', changedFiles: [DESKTOP] })
  assert.equal(r.srcDir, 'apps/desktop/src')
})

test('变更全在文档/流程路径 → report-only', () => {
  const r = classifyGate9({
    title: 'feat(x): a',
    changedFiles: [DOC, '.quality-gates.md', 'openspec/records/x.md', 'CHANGELOG.md'],
  })
  assert.equal(r.mode, 'report-only')
  assert.match(r.reason, /文档/)
})

test('未触及任何前端源码目录（如仅 packages/ 或 scripts/）→ report-only 且不假装审过', () => {
  const r = classifyGate9({ title: 'feat(x): a', changedFiles: ['packages/rpa-engine/src/a.js'] })
  assert.equal(r.mode, 'report-only')
  assert.equal(r.srcDir, '')
})

test('无变更清单（非 PR 上下文）→ fail-closed 按桌面端全量', () => {
  const r = classifyGate9({ title: 'feat(x): a', changedFiles: [] })
  assert.equal(r.mode, 'full')
  assert.equal(r.srcDir, 'apps/desktop/src')
})

test('featureIds 从正文提取 feat_ 标记（去重排序）', () => {
  const r = classifyGate9({
    title: 'feat(x): a',
    body: '需求 feat_login 与 feat_publish，重复 feat_login',
    changedFiles: [DESKTOP],
  })
  assert.deepEqual(r.featureIds, ['feat_login', 'feat_publish'])
})

test('反证：ops-center 分流条件被删 → 用例立刻红（该分流正是缺陷①的修复）', () => {
  const r = classifyGate9({ title: 'feat(x): a', changedFiles: [OPS] })
  // 若 srcDir 回落成 apps/desktop/src（即分流被摘），此断言红
  assert.notEqual(r.srcDir, 'apps/desktop/src')
  assert.equal(r.srcDir, 'ops-center/frontend/src')
})
