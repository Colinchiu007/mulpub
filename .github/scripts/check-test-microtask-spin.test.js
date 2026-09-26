// @ts-check
'use strict'
/**
 * check-test-microtask-spin.test.js — 门禁脚本自身的回归
 *
 * 理由与仓库惯例一致：门禁脚本一次静默失效，等于这条 CI 卡点形同虚设。
 * 前 6 条用夹具判「该拦的拦住、不该拦的放过」，最后一条对真实仓库做棘轮断言。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { findMicrotaskSpins, listTestFiles, scan } = require('./check-test-microtask-spin')

const HITS = (text) => findMicrotaskSpins(text, 'fixture.js').length

test('单行式 while + await Promise.resolve() 必须命中', () => {
  assert.equal(HITS('while (list.length < 1) await Promise.resolve()\n'), 1)
})

test('块式循环内只有微任务让出时必须命中', () => {
  const src = [
    'async function f () {',
    '  while (!ready()) {',
    '    await Promise.resolve()',
    '  }',
    '}',
  ].join('\n')
  assert.equal(HITS(src), 1)
})

test('循环体让出宏任务（setTimeout）时不得命中 —— 合法写法', () => {
  const src = [
    '  while (!ready()) {',
    '    await new Promise((resolve) => setTimeout(resolve, 0))',
    '  }',
  ].join('\n')
  assert.equal(HITS(src), 0)
})

test('循环体用 vi.advanceTimersByTimeAsync 推进（fake timers）时不得命中', () => {
  const src = [
    '  while (!ready()) {',
    '    await vi.advanceTimersByTimeAsync(10)',
    '  }',
  ].join('\n')
  assert.equal(HITS(src), 0)
})

test('带 deadline 的轮询（Date.now() 预算）不得命中', () => {
  const src = [
    '  const deadline = Date.now() + 2000',
    '  while (!ready() && Date.now() < deadline) {',
    '    await Promise.resolve()',
    '  }',
  ].join('\n')
  assert.equal(HITS(src), 0, '有预算的轮询不应被误判')
})

test('非循环内的 await Promise.resolve() 不得命中；注释行不得命中', () => {
  assert.equal(HITS('await Promise.resolve()\nconsole.log(1)\n'), 0)
  assert.equal(HITS('// while (x) await Promise.resolve()  这是文档里的示例\n'), 0)
})

test('棘轮：真实仓库当前必须是 0 处微任务自旋', () => {
  const files = listTestFiles()
  assert.ok(files.length > 100, '扫描器没有拿到测试文件清单（大小 ' + files.length + '）')
  const hits = scan(files)
  assert.deepEqual(hits.map((h) => h.file + ':' + h.line), [], '发现微任务自旋：见列表（改法见脚本头部修复指引）')
})
