'use strict'
/**
 * gate9-classify.js 的回归锁（2026-10-12）。
 *
 * 反证纪律：每条判据都配一条「把判据改宽必须立刻变红」的用例，
 * 只证「业务输入得到预期输出」不能证明锁在跑。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { classifyGate9 } = require('./gate9-classify.js')

// 结构判据只看代码本体：注释里会如实写出被禁的标识符（说明它为什么被禁），
// 不剥注释就会把「解释这条禁令的注释」当成违例，反向假红。
function stripComments (src) {
  return String(src)
    .replace(/\r\n/g, String.fromCharCode(10))
    .replace(/\/\*[\s\S]*?\*\//g, String.fromCharCode(10))
    .split(String.fromCharCode(10))
    .filter((l) => !/^[ \t]*\/\//.test(l))
    .join(String.fromCharCode(10))
}

const DESKTOP = 'apps/desktop/src/views/Foo.vue'
const OPS = 'ops-center/frontend/src/views/ChangePassword.vue'
const DOC = '01-docs/PRD.md'

test('⛔ 标题不决定 mode：同一批变更文件下六种前缀判定逐字一致', () => {
  const titles = ['feat(x): a', 'fix(x): a', 'chore(x): a', 'docs(x): a', 'refactor(x): a', 'test(x): a']
  const results = titles.map((t) => classifyGate9({ title: t, changedFiles: [DESKTOP] }))
  assert.deepEqual([...new Set(results.map((r) => r.mode))], ['full'])
  assert.deepEqual([...new Set(results.map((r) => r.srcDir))], ['apps/desktop/src'])
})

test('⛔ label 不决定 mode：打满维护型 label 与不打 label 的结果完全相同', () => {
  const a = classifyGate9({ title: 'feat(x): a', labels: 'bug,fix,docs,chore,test', changedFiles: [DESKTOP] })
  const b = classifyGate9({ title: 'feat(x): a', labels: '', changedFiles: [DESKTOP] })
  assert.deepEqual(a, b)
})

test('⛔ 纯文档 PR 仍 report-only，且不因维护型标题而变化（判据只剩文件）', () => {
  const docFiles = [DOC, '.quality-gates.md', 'CHANGELOG.md']
  const feat = classifyGate9({ title: 'feat(x): a', changedFiles: docFiles })
  const fix = classifyGate9({ title: 'fix(x): a', changedFiles: docFiles })
  assert.equal(feat.mode, 'report-only')
  assert.deepEqual(feat, fix)
})

test('反证：源码不得再有按标题/label 关审计的判据（剥注释后检查，含防失明正控）', () => {
  const code = fs.readFileSync(require.resolve('./gate9-classify.js'), 'utf8')
  const body = stripComments(code)
  // 正控：剥完还剩东西，否则下面三条 doesNotMatch 全部恒真（空集不是证据）
  assert.ok(body.length > 400)
  assert.doesNotMatch(body, /MAINTENANCE_TITLE_RE|MAINTENANCE_LABEL_RE/)
  assert.doesNotMatch(body, /input\.title|input\.labels/)
  assert.match(body, /changedFiles/)
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
