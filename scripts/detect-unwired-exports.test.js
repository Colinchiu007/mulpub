// @ts-check
/**
 * detect-unwired-exports.test.js — 检测脚本单元测试（node:test）
 *
 * 验证「测试覆盖但未接线」死代码检测逻辑：
 * 1. 有测试但生产代码未调用的导出 → 被标记
 * 2. 生产代码调用的导出 → 不被标记
 * 3. 内部辅助函数（同模块调用）→ 不被标记
 * 4. require 引用（require(...).方法名）→ 算生产调用
 * 5. 继承引用（extends 方法名）→ 算生产调用
 * 6. 常量导出 → 不检测
 *
 * 运行：node --test scripts/detect-unwired-exports.test.js
 */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, 'detect-unwired-exports.js')

function tmpRoot () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'detect-unwired-'))
}

function writeFile (root, rel, content) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

function runScript (dir) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, dir, '--root', dir], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status || 1, out: e.stdout || '' }
  }
}

test('有测试但生产代码未调用的导出被标记', () => {
  const root = tmpRoot()
  writeFile(root, 'src/mod.js', `
    function deadFn() { return 1 }
    function usedFn() { return 2 }
    module.exports = { deadFn, usedFn }
  `)
  writeFile(root, 'src/consumer.js', `
    const { usedFn } = require('./mod')
    usedFn()
  `)
  writeFile(root, 'src/mod.test.js', `
    const { deadFn } = require('./mod')
    test('deadFn', () => expect(deadFn()).toBe(1))
  `)
  const r = runScript(root)
  assert.strictEqual(r.code, 1) // 发现死代码
  assert.ok(r.out.includes('deadFn'))
  assert.ok(!r.out.includes('usedFn'))
})

test('生产代码调用的导出不被标记', () => {
  const root = tmpRoot()
  writeFile(root, 'src/mod.js', `
    function usedFn() { return 2 }
    module.exports = { usedFn }
  `)
  writeFile(root, 'src/consumer.js', `
    const { usedFn } = require('./mod')
    usedFn()
  `)
  writeFile(root, 'src/mod.test.js', `
    const { usedFn } = require('./mod')
    test('usedFn', () => expect(usedFn()).toBe(2))
  `)
  const r = runScript(root)
  assert.strictEqual(r.code, 0) // 无死代码
  assert.ok(r.out.includes('未发现'))
})

test('内部辅助函数（同模块调用）不被标记', () => {
  const root = tmpRoot()
  writeFile(root, 'src/mod.js', `
    function helper() { return 1 }
    function main() { return helper() }
    module.exports = { main }
  `)
  writeFile(root, 'src/mod.test.js', `
    const { main } = require('./mod')
    test('main', () => expect(main()).toBe(1))
  `)
  const r = runScript(root)
  assert.strictEqual(r.code, 0) // helper 是内部辅助，不被标记
  assert.ok(r.out.includes('未发现'))
})

test('require 引用（require(...).方法名）算生产调用', () => {
  const root = tmpRoot()
  writeFile(root, 'src/adapter.js', `
    class MyAdapter { run() {} }
    module.exports = { MyAdapter }
  `)
  writeFile(root, 'src/registry.js', `
    const { MyAdapter } = require('./adapter')
    module.exports = { adapters: { my: MyAdapter } }
  `)
  writeFile(root, 'src/adapter.test.js', `
    const { MyAdapter } = require('./adapter')
    test('MyAdapter', () => expect(new MyAdapter()).toBeTruthy())
  `)
  const r = runScript(root)
  assert.strictEqual(r.code, 0) // MyAdapter 通过 require 引用，算生产调用
  assert.ok(r.out.includes('未发现'))
})

test('继承引用（extends 方法名）算生产调用', () => {
  const root = tmpRoot()
  writeFile(root, 'src/base.js', `
    class BaseAdapter {}
    module.exports = { BaseAdapter }
  `)
  writeFile(root, 'src/child.js', `
    const { BaseAdapter } = require('./base')
    class ChildAdapter extends BaseAdapter {}
    module.exports = { ChildAdapter }
  `)
  writeFile(root, 'src/base.test.js', `
    const { BaseAdapter } = require('./base')
    test('BaseAdapter', () => expect(new BaseAdapter()).toBeTruthy())
  `)
  const r = runScript(root)
  assert.strictEqual(r.code, 0) // BaseAdapter 通过 extends 引用，算生产调用
  assert.ok(r.out.includes('未发现'))
})

test('常量导出不被检测（检测目标为函数/类）', () => {
  const root = tmpRoot()
  writeFile(root, 'src/config.js', `
    const POLL_INTERVAL = 10000
    module.exports = { POLL_INTERVAL }
  `)
  writeFile(root, 'src/config.test.js', `
    const { POLL_INTERVAL } = require('./config')
    test('POLL_INTERVAL', () => expect(POLL_INTERVAL).toBe(10000))
  `)
  const r = runScript(root)
  assert.strictEqual(r.code, 0) // 常量不检测
  assert.ok(r.out.includes('未发现'))
})