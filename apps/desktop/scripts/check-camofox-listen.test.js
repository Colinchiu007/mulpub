/**
 * check-camofox-listen.test.js — 构建期监听安全断言契约（PR-2 §7.5）
 *
 * 用 node:test 而非 vitest：`scripts/` 下的 require 不受 vitest include 接管
 * （同 build-paginator.test.js 先例；vitest include 只收 electron/** 与 src/**、tests/**）。
 *
 * 契约：
 *  1. 字面非回环 host 的 --remote-debugging-port → 判红（IPv4 内网/公网、IPv6 非回环）
 *  2. 回环字面量（127.0.0.1 / localhost / ::1）→ 放行
 *  3. 纯端口（未显式 host）→ 放行（运行期 assertLoopbackEndpoint 兜底）
 *  4. 变量/表达式/配置引用 → 放行（同上，两处各管一段不重复）
 *  5. 真实仓内 camofox 驱动源码 → 必须零违规（run() 冒烟）
 */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { findNonLoopbackDebugPort, collectViolations, run } = require('./check-camofox-listen')

test('字面非回环 host 一律判红', () => {
  for (const bad of [
    '--remote-debugging-port=0.0.0.0:9222',
    '--remote-debugging-port=192.168.1.5:9222',
    '--remote-debugging-port=8.8.8.8:9222',
    '--remote-debugging-port=10.0.0.1:9222',
    '--remote-debugging-port=172.16.0.9:9222',
  ]) {
    const v = findNonLoopbackDebugPort('const a = "' + bad + '"')
    assert.equal(v.length, 1, bad)
    assert.equal(v[0].target, bad.split('=')[1])
  }
})

test('IPv6 非回环判红，回环放行', () => {
  assert.equal(findNonLoopbackDebugPort('"--remote-debugging-port=[2001:db8::1]:9222"').length, 1)
  assert.equal(findNonLoopbackDebugPort('"--remote-debugging-port=[::1]:9222"').length, 0)
  assert.equal(findNonLoopbackDebugPort('"--remote-debugging-port=::1:9222"').length, 0)
})

test('回环字面量放行', () => {
  for (const ok of [
    '--remote-debugging-port=127.0.0.1:9222',
    '--remote-debugging-port=localhost:9222',
    '--remote-debugging-port=127.0.0.1',
  ]) {
    assert.equal(findNonLoopboundHelper(ok), 0, ok)
  }
})

// 小助手：把单引号包裹的形态喂进去（避免上面循环里引号嵌套）
function findNonLoopboundHelper (lit) {
  return findNonLoopbackDebugPort("'" + lit + "'").length
}

test('纯端口放行（未显式 host）', () => {
  assert.equal(findNonLoopbackDebugPort('--remote-debugging-port=9222').length, 0)
  assert.equal(findNonLoopbackDebugPort('--remote-debugging-port 9222').length, 0)
})

test('变量/表达式放行（运行期兜底）', () => {
  assert.equal(findNonLoopbackDebugPort('--remote-debugging-port=${host}:${port}').length, 0)
  assert.equal(findNonLoopbackDebugPort('--remote-debugging-port=' + "' + host + '" + ':9222').length, 0)
  assert.equal(findNonLoopbackDebugPort('args.push(`--remote-debugging-port=${cfg.host}:${cfg.port}`)').length, 0)
})

test('行号指向真实所在行', () => {
  const src = 'line1\nline2\nconst x = "--remote-debugging-port=0.0.0.0:1"\nline4'
  const v = findNonLoopbackDebugPort(src)
  assert.equal(v.length, 1)
  assert.equal(v[0].line, 3)
})

test('一次多形态：只抓非回环，不误报回环与变量', () => {
  const src = [
    'const okA = "--remote-debugging-port=127.0.0.1:9222"',
    'const badA = "--remote-debugging-port=0.0.0.0:9222"',
    'const okB = "--remote-debugging-port=${h}:${p}"',
    'const badB = "--remote-debugging-port=8.8.8.8:1"',
  ].join('\n')
  const v = findNonLoopbackDebugPort(src)
  assert.deepEqual(v.map(x => x.target).sort(), ['0.0.0.0:9222', '8.8.8.8:1'])
})

test('collectViolations 空来源 → ok', () => {
  assert.equal(collectViolations([]).ok, true)
  assert.equal(collectViolations(null).ok, true)
})

test('collectViolations 带 file 字段便于定位', () => {
  const r = collectViolations([{ file: 'a.js', source: '--remote-debugging-port=0.0.0.0:1' }])
  assert.equal(r.ok, false)
  assert.equal(r.violations[0].file, 'a.js')
})

test('run 真实仓内 camofox 驱动源码零违规', () => {
  // __dirname = <repo>/apps/desktop/scripts ⇒ 仓根在 3 级之上（.. → apps/desktop → apps → repo）
  const repoRoot = path.join(__dirname, '..', '..', '..')
  const r = run(repoRoot)
  assert.deepEqual(r.violations, [])
  assert.equal(r.ok, true)
  assert.ok(r.scanned.includes('apps/desktop/electron/services/stealth/stealth-channel-camofox.js'))
})
