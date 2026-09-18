/**
 * check-color-literals 门禁自测（node --test）
 *
 * 门禁脚本自身必须被测试（历史上 locale-cjk 门禁因「退出码被吞」长期假绿）：
 * - 最小夹具：验证扫描/判定逻辑（大小写不敏感、注释行也拦、tokens.css 豁免由
 *   EXEMPT_FILES 控制、超基线即失败、等于基线通过）
 * - 真实文件：当前仓库必须 PASS 且基线为正数（防脚本静默退化成空扫描假绿）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { HISTORY_COLORS, parseArgs, scanContent, evaluate } = require('./check-color-literals')

const ROOT = path.resolve(__dirname, '..', '..')
const BASELINE_FILE = path.join(__dirname, 'frontend-consistency-baseline.json')
const TOKENS_FILE = path.join(ROOT, 'apps', 'desktop', 'src', 'styles', 'tokens.css')

test('parseArgs 识别 --json 与 --update-baseline', () => {
  assert.deepEqual(parseArgs(['--json']), { json: true, updateBaseline: false })
  assert.deepEqual(parseArgs(['--update-baseline']), { json: false, updateBaseline: true })
  assert.deepEqual(parseArgs([]), { json: false, updateBaseline: false })
})

test('scanContent 大小写不敏感且按行记录', () => {
  const hits = scanContent('a.vue', '.btn { color: #5048E5; }\n.x { border: 1px solid #409EFF; }', [])
  assert.equal(hits.length, 2)
  assert.equal(hits[0].line, 1)
  assert.deepEqual(hits[0].colors, ['#5048e5'])
  assert.deepEqual(hits[1].colors, ['#409eff'])
})

test('scanContent 注释行也拦截（注释里不许提历史色值）', () => {
  const hits = scanContent('b.css', '/* 桥接：原为 #409eff */\n.ok { color: red; }', [])
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 1)
})

test('scanContent 无命中时不产生条目', () => {
  const hits = scanContent('c.vue', '.a { color: var(--color-primary); }\n', [])
  assert.equal(hits.length, 0)
})

test('evaluate：超过基线即失败且给出可操作文案', () => {
  const r = evaluate(146, 145)
  assert.equal(r.pass, false)
  assert.match(r.failures[0], /超出基线/)
  assert.match(r.failures[0], /tokens\.css/)
})

test('evaluate：等于或低于基线通过', () => {
  assert.equal(evaluate(145, 145).pass, true)
  assert.equal(evaluate(100, 145).pass, true)
})

test('HISTORY_COLORS 覆盖 6 个历史色且全小写', () => {
  assert.deepEqual(HISTORY_COLORS, ['#5048e5', '#5149e8', '#409eff', '#3a7be5', '#007aff', '#f472b6'])
})

test('真实文件：tokens.css 存在豁免前提（收编槽位区确在其内）', () => {
  const tokens = fs.readFileSync(TOKENS_FILE, 'utf8')
  assert.match(tokens, /历史槽位收编（T1-1 结构收敛）/)
  assert.match(tokens, /--color-apple-accent:/)
})

test('真实文件：基线为正数（防脚本静默退化成空扫描假绿）', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  assert.equal(typeof baseline.colorLiterals, 'number')
  assert.ok(baseline.colorLiterals > 0, 'colorLiterals 基线必须 > 0')
})
