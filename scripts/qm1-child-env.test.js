/**
 * 回归锁：QM-1 启动验证的子进程环境纪律（scripts/lib/qm1-child-env.js）。
 *
 * 为什么值得一条锁：`ELECTRON_RUN_AS_NODE=1` 造成的失败形态与「启动干净」**完全同形**
 * （rc=0、stdout 空、stderr 空），只靠肉眼与文档拦不住；必须有人一改回
 * `spawn(EXE, [], { stdio: ... })`（不传 env）就当场变红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { ELECTRON_RUN_AS_NODE, buildChildEnv, envDefectNotice } = require('./lib/qm1-child-env.js')

test('buildChildEnv：剔除 ELECTRON_RUN_AS_NODE，保留其余变量', () => {
  const parent = { [ELECTRON_RUN_AS_NODE]: '1', PATH: '/usr/bin', MP_RPA_POOL_SIZE: '3' }
  const child = buildChildEnv(parent)
  assert.equal(child[ELECTRON_RUN_AS_NODE], undefined, '该变量必须被剔除')
  assert.equal(child.PATH, '/usr/bin', '其余变量必须保留')
  assert.equal(child.MP_RPA_POOL_SIZE, '3')
})

test('buildChildEnv：不改动入参（调用方常直接传 process.env）', () => {
  const parent = { [ELECTRON_RUN_AS_NODE]: '1', KEEP: 'x' }
  const snapshot = JSON.stringify(parent)
  buildChildEnv(parent)
  assert.equal(JSON.stringify(parent), snapshot, '入参不得被就地修改')
})

test('buildChildEnv：变量缺席时不新增该键（不得凭空造出空串键）', () => {
  const child = buildChildEnv({ A: '1' })
  assert.equal(Object.prototype.hasOwnProperty.call(child, ELECTRON_RUN_AS_NODE), false)
})

test('buildChildEnv：容忍 undefined / null 入参', () => {
  assert.deepEqual(buildChildEnv(undefined), {})
  assert.deepEqual(buildChildEnv(null), {})
})

test('envDefectNotice：带着变量必须出声（不是静默剔除）', () => {
  const n = envDefectNotice({ [ELECTRON_RUN_AS_NODE]: '1' })
  assert.ok(n && n.includes(ELECTRON_RUN_AS_NODE), '告警必须点名该变量')
  assert.ok(n.includes('假绿'), '告警必须说清后果是假绿')
})

test('envDefectNotice：缺席或空串时不出声', () => {
  assert.equal(envDefectNotice({}), null)
  assert.equal(envDefectNotice(undefined), null)
  assert.equal(envDefectNotice({ [ELECTRON_RUN_AS_NODE]: '' }), null)
})

test('接线锁：真机脚本必须用 buildChildEnv 构造子进程 env 且必须出声告警', () => {
  const script = fs.readFileSync(path.join(__dirname, 'qm1-scheduled-publish-verify.cjs'), 'utf8')
  // 结构锁：spawn 必须显式传 env（不传 env 就继承父环境 ⇒ 变量再次生效）
  assert.match(script, /spawn\(\s*EXE[\s\S]{0,120}env\s*:\s*buildChildEnv\(/, 'spawn(EXE...) 必须显式传 env: buildChildEnv(...)')
  assert.match(script, /envDefectNotice\(/, '必须调用 envDefectNotice 出声告警')
  assert.match(script, /提前退出[\s\S]{0,200}ELECTRON_RUN_AS_NODE|ELECTRON_RUN_AS_NODE[\s\S]{0,200}提前退出/, '提前退出分支必须给出该变量的诊断提示')
})
