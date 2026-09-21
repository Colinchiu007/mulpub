'use strict'
/**
 * check-css-var-defined.test.js — Gate 15c 自测（node --test）
 * 覆盖：无 fallback 才拦、定义集三种写法都认、基线只降不升。
 */
const test = require('node:test')
const assert = require('node:assert')
const {
  DEF_DECL_RE, DEF_SETPROP_RE, DEF_OBJKEY_RE, REF_RE, WHITELIST_PREFIXES,
  parseArgs, collect, evaluate,
} = require('./check-css-var-defined')

test('parseArgs 识别 --json / --update-baseline', () => {
  assert.deepStrictEqual(parseArgs([]), { json: false, updateBaseline: false })
  assert.strictEqual(parseArgs(['--json']).json, true)
  assert.strictEqual(parseArgs(['--update-baseline']).updateBaseline, true)
})

test('REF_RE 只匹配无 fallback 的 var(--x)', () => {
  assert.deepStrictEqual(collect(REF_RE, '  color: var(--brand);'), ['--brand'])
  assert.deepStrictEqual(collect(REF_RE, '  color: var(--brand )'), ['--brand'])
  // 带 fallback 的 var(--x, ...) 不算危险引用（浏览器会用 fallback）
  assert.deepStrictEqual(collect(REF_RE, '  color: var(--brand, #fff);'), [])
  // 一行多个无 fallback 引用全部收集
  assert.deepStrictEqual(collect(REF_RE, 'border: 1px solid var(--a) var(--b);'), ['--a', '--b'])
})

test('DEF 三种写法都被识别为定义', () => {
  assert.deepStrictEqual(collect(DEF_DECL_RE, '  --shadow-sm: 0 1px 2px;'), ['--shadow-sm'])
  assert.deepStrictEqual(collect(DEF_SETPROP_RE, "el.style.setProperty('--x', v)"), ['--x'])
  assert.deepStrictEqual(collect(DEF_OBJKEY_RE, "style: { '--x': '1px' }"), ['--x'])
})

test('变量名统一小写归一', () => {
  assert.deepStrictEqual(collect(DEF_DECL_RE, '  --Brand: red;'), ['--brand'])
  assert.deepStrictEqual(collect(REF_RE, 'color: var(--Brand);'), ['--brand'])
})

test('WHITELIST 前缀用于放行库运行时变量', () => {
  assert.ok(WHITELIST_PREFIXES.includes('--el-'))
})

test('evaluate：未超出基线 PASS，超出 FAIL', () => {
  assert.strictEqual(evaluate(10, 10).pass, true)
  assert.strictEqual(evaluate(9, 10).pass, true)
  const bad = evaluate(11, 10)
  assert.strictEqual(bad.pass, false)
  assert.strictEqual(bad.failures.length, 1)
  assert.match(bad.failures[0], /新增 1 处/)
})