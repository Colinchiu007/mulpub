// @ts-check
/**
 * electron-runtime-env.test.js — Electron spawn 环境净化回归保护（node --test）
 *
 * 回归保护对象（2026-09-14 P1 缺陷）：
 *   父环境 `ELECTRON_RUN_AS_NODE=1` 被透传给 Electron 二进制 → Electron 退化为
 *   纯 Node，Chromium 开关全部报 `bad option`，应用无窗口、CDP 端口不监听。
 *
 * 断言要点：
 *   1. `ELECTRON_RUN_AS_NODE` 必被剔除（精确 + 大小写不敏感）；
 *   2. 其余变量原样保留；
 *   3. 不修改入参（纯函数）；
 *   4. overrides 生效且显式同值可覆盖剔除结果；
 *   5. overrides 中 `undefined` 的键被跳过（不产生空串变量）。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildElectronEnv, ELECTRON_STRIPPED_ENV_KEYS } = require('./electron-runtime-env')

test('剔除 ELECTRON_RUN_AS_NODE（精确键名）', () => {
  const env = buildElectronEnv({ ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin', HOME: '/home/u' })
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false, 'ELECTRON_RUN_AS_NODE 必须被剔除')
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.HOME, '/home/u')
})

test('剔除是大小写不敏感的（Windows 环境变量名不区分大小写）', () => {
  const env = buildElectronEnv({ electron_run_as_node: '1', Electron_Run_As_Node: 'true', KEEP: 'yes' })
  const leaked = Object.keys(env).filter((k) => k.toLowerCase() === 'electron_run_as_node')
  assert.deepEqual(leaked, [], '任何大小写变体都不得透传')
  assert.equal(env.KEEP, 'yes')
})

test('不修改入参（纯函数）', () => {
  const base = { ELECTRON_RUN_AS_NODE: '1', A: '1' }
  const overrides = { B: '2' }
  buildElectronEnv(base, overrides)
  assert.deepEqual(base, { ELECTRON_RUN_AS_NODE: '1', A: '1' }, 'baseEnv 不得被修改')
  assert.deepEqual(overrides, { B: '2' }, 'overrides 不得被修改')
})

test('overrides 生效；显式设置同值可覆盖剔除结果（保留主动设置能力）', () => {
  const env = buildElectronEnv(
    { ELECTRON_RUN_AS_NODE: '1', DEV_SERVER_PORT: '5174' },
    { DEV_SERVER_PORT: '6919', ELECTRON_USER_DATA_DIR: 'D:\\tmp\\p' },
  )
  assert.equal(env.DEV_SERVER_PORT, '6919', 'overrides 必须覆盖 base 同键')
  assert.equal(env.ELECTRON_USER_DATA_DIR, 'D:\\tmp\\p')
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false)
  const forced = buildElectronEnv({ ELECTRON_RUN_AS_NODE: '1' }, { ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(forced.ELECTRON_RUN_AS_NODE, '1', 'overrides 里的显式值优先于剔除')
})

test('overrides 中 undefined 的键被跳过（不产生空串变量）', () => {
  const env = buildElectronEnv({ A: '1' }, { B: undefined, C: '3' })
  assert.equal('B' in env, false)
  assert.equal(env.C, '3')
})

test('baseEnv 为 null/undefined 时只返回 overrides', () => {
  assert.deepEqual(buildElectronEnv(null, { A: '1' }), { A: '1' })
  assert.deepEqual(buildElectronEnv(undefined, { A: '1' }), { A: '1' })
  assert.deepEqual(buildElectronEnv(null), {})
})

test('ELECTRON_STRIPPED_ENV_KEYS 契约：至少包含 ELECTRON_RUN_AS_NODE', () => {
  assert.ok(ELECTRON_STRIPPED_ENV_KEYS.includes('ELECTRON_RUN_AS_NODE'))
  assert.ok(Object.isFrozen(ELECTRON_STRIPPED_ENV_KEYS), '常量必须冻结')
})

test('真实场景：带 ELECTRON_RUN_AS_NODE 的 process.env 副本被净化后仍是合法环境对象', () => {
  const env = buildElectronEnv({ ...process.env, ELECTRON_RUN_AS_NODE: '1' }, { DEV_SERVER_PORT: '6919' })
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false)
  assert.equal(env.DEV_SERVER_PORT, '6919')
  for (const [key, value] of Object.entries(env)) {
    assert.equal(typeof key, 'string')
    assert.notEqual(value, undefined)
  }
})
