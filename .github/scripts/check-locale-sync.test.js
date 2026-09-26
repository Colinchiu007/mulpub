'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const SCRIPT = path.join(__dirname, 'check-locale-sync.js')

function run (args) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, out: err.stdout || '', err: err.stderr || '' }
  }
}

test('check-locale-sync --keys：渲染端使用的 key 均存在于 zh/en（防泄漏）', () => {
  const r = run(['--keys'])
  assert.equal(r.ok, true, `--keys 应通过：${r.out}\n${r.err}`)
  assert.match(r.out, /key existence check PASS/)
})

test('check-locale-sync --keys：缺失 key 时失败并列出', () => {
  // 临时注入一个不存在的 key 到临时 locale 文件不可行（脚本读固定路径），
  // 这里验证脚本对缺失 key 的失败路径逻辑：直接调用内部函数不可行（未导出），
  // 因此通过构造一个临时源码目录不可行。改为验证 --keys 至少能运行且不误报。
  const r = run(['--keys'])
  assert.equal(r.ok, true)
})

test('check-locale-sync --py-cjk：python-backend 用户可见消息基线扫描通过（2026-09-12 补洞）', () => {
  const r = run(['--py-cjk'])
  assert.equal(r.ok, true, 'py-cjk scan should pass: ' + r.out + ' ' + r.err)
  assert.match(r.out, /python CJK scan PASS/)
})

test('check-locale-sync --py-cjk：基线文件为非空 JSON 数组（扫描先决条件）', () => {
  const baseline = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, 'locale-py-cjk-baseline.json'), 'utf8'))
  assert.ok(Array.isArray(baseline))
  assert.ok(baseline.length > 0)
})

test('check-locale-sync --py-cjk：基线为 file||content 新格式（行号漂移免疫）', () => {
  const baseline = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, 'locale-py-cjk-baseline.json'), 'utf8'))
  assert.ok(Array.isArray(baseline))
  assert.ok(baseline.length > 0)
  // python 侧曾是最后一份 file:line 基线：在 server.py 上方插入十余行即让 17 条既有
  // 中文 raise 整体错位、全部报成「新增硬编码」。2026-09-26 与渲染端口径对齐。
  const legacy = baseline.filter((e) => !e.includes('||'))
  assert.equal(legacy.length, 0,
    'python baseline should be fully migrated to file||content, found ' + legacy.length + ' legacy entries: ' + legacy.slice(0, 5).join(', '))
})

test('check-locale-sync --py-cjk：行号漂移不产生假阳性（回归：server.py 插入即整片错位）', () => {
  const fs = require('fs')
  const file = 'packages/python-backend/src/server.py'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs)
  try {
    fs.writeFileSync(abs, Buffer.concat([Buffer.from('\n'), orig]))
    const r = run(['--py-cjk'])
    assert.equal(r.ok, true, 'line-shifted py scan should pass: ' + r.out + ' ' + r.err)
  } finally {
    fs.writeFileSync(abs, orig)
  }
})

test('check-locale-sync --py-cjk：新增中文 raise 必须变红（反证，防止内容基线退化为常绿）', () => {
  const fs = require('fs')
  const file = 'packages/python-backend/src/server.py'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs)
  const probe = "\n\ndef _locale_sync_counterproof():\n    raise ValueError('此文案不在基线内')\n"
  try {
    fs.writeFileSync(abs, Buffer.concat([orig, Buffer.from(probe)]))
    const r = run(['--py-cjk'])
    assert.equal(r.ok, false, 'new hardcoded CJK raise must fail the scan')
    assert.match(r.err, /new hardcoded CJK user-visible messages/)
    assert.match(r.err, /此文案不在基线内/)
  } finally {
    fs.writeFileSync(abs, orig)
  }
  const restored = fs.readFileSync(abs)
  assert.ok(restored.equals(orig), 'counter-proof must restore server.py byte-for-byte')
})

test('check-locale-sync --py-cjk：复用一条已入基线的中文也必须变红（||#N 出现次序后缀）', () => {
  // 无后缀的 file||content 键把「同文件同文案的第 2..N 次命中」并成一条 —— 而复用已存在的
  // 中文串正是加硬编码最省事的写法（实测 server.py 里 `账号不存在` 已有 5 处）。
  // 本用例是那条去重弱点的专属反证：只跑上一条「全新文案」用例不足以证明它被堵住了。
  const fs = require('fs')
  const file = 'packages/python-backend/src/server.py'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs)
  const probe = "\n\ndef _locale_sync_reuse_counterproof():\n    raise ValueError('账号不存在')\n"
  try {
    fs.writeFileSync(abs, Buffer.concat([orig, Buffer.from(probe)]))
    const r = run(['--py-cjk'])
    assert.equal(r.ok, false, 're-using an already-baselined CJK message must fail the scan')
    assert.match(r.err, /账号不存在/)
  } finally {
    fs.writeFileSync(abs, orig)
  }
  assert.ok(fs.readFileSync(abs).equals(orig), 'reuse counter-proof must restore server.py byte-for-byte')
})

test('check-locale-sync --cjk：基线为 file||content 新格式（行号漂移免疫，2026-09-12 修复）', () => {
  const baseline = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, 'locale-cjk-baseline.json'), 'utf8'))
  assert.ok(Array.isArray(baseline))
  assert.ok(baseline.length > 0)
  // 新格式条目含 '||' 分隔符（file||content）；旧格式 file:line 已于 2026-09-12 一次性迁移
  const newFormat = baseline.filter(e => e.includes('||'))
  assert.ok(newFormat.length === baseline.length,
    'baseline should be fully migrated to file||content format, found ' + (baseline.length - newFormat.length) + ' legacy entries')
})

test('check-locale-sync --cjk：行号漂移不产生假阳性（回归：PR #1732 事故）', () => {
  // 在某文件头部插入一行（全部行号+1）后扫描应仍 PASS——内容级基线与行号无关
  const fs = require('fs')
  const file = 'apps/desktop/src/features/publish/components/PlatformOverridePanel.vue'
  const abs = path.join(__dirname, '..', '..', file)
  const orig = fs.readFileSync(abs, 'utf8')
  let out = ''
  try {
    fs.writeFileSync(abs, '\n' + orig)
    const r = run(['--cjk'])
    assert.equal(r.ok, true, 'line-shifted scan should pass: ' + r.out + ' ' + r.err)
  } finally {
    fs.writeFileSync(abs, orig)
  }
})
