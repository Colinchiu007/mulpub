// @ts-check
/**
 * electron-runtime-env.test.js — Electron spawn 环境净化回归保护（node --test）
 *
 * 回归保护对象一（2026-09-14 P1 缺陷）：
 *   父环境 `ELECTRON_RUN_AS_NODE=1` 被透传给 Electron 二进制 → Electron 退化为
 *   纯 Node，Chromium 开关全部报 `bad option`，应用无窗口、CDP 端口不监听。
 *
 * 回归保护对象二（2026-09-14 P1 缺陷）：
 *   宿主注入的 safe-delete shim（`NODE_OPTIONS=--require=.../node-language-shim.cjs`
 *   + `CODEBUDDY_SESSION_ID` / `CODEBUDDY_TOOL_CALL_ID` / `CODEBUDDY_SAFE_DELETE_*`）
 *   被透传给 Electron 主进程 → shim patch `fs.unlink/rm`，长生命周期进程的
 *   删除计数（同一 requestId）越过 500 后所有删除 fail-closed 抛错 →
 *   `identity-session.json` 无法清理 → 登录/退出报 `IDENTITY_SESSION_CLEAR_FAILED`。
 *
 * 断言要点：
 *   1. `ELECTRON_RUN_AS_NODE` 必被剔除（精确 + 大小写不敏感）；
 *   2. 宿主 shim 上下文变量必被剔除（`CODEBUDDY_*` / `CLAUDE_SESSION_ID` / `BASH_ENV`）；
 *   3. `NODE_OPTIONS` 里指向 shim 的 `--require` 注入被移除，其他选项保留；
 *   4. `PATH` / `PYTHONPATH` 里的 shim 目录条目被移除，其他条目保留；
 *   5. 其余变量原样保留；不修改入参（纯函数）；
 *   6. overrides 生效且显式同值可覆盖剔除结果；
 *   7. overrides 中 `undefined` 的键被跳过（不产生空串变量）。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  buildElectronEnv,
  ELECTRON_STRIPPED_ENV_KEYS,
  isHostileShimPath,
  sanitizeNodeOptions,
  sanitizePathList,
} = require('./electron-runtime-env')

const SHIM_DIR = 'D:\\Program Files\\CodeBuddy CN\\resources\\app\\extensions\\genie\\out\\vendor\\shim'
const SHIM_REQUIRE_VALUE = `--require="${SHIM_DIR}\\node-language-shim.cjs"`

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
  const base = { ELECTRON_RUN_AS_NODE: '1', A: '1', NODE_OPTIONS: SHIM_REQUIRE_VALUE }
  const overrides = { B: '2' }
  buildElectronEnv(base, overrides)
  assert.deepEqual(base, { ELECTRON_RUN_AS_NODE: '1', A: '1', NODE_OPTIONS: SHIM_REQUIRE_VALUE }, 'baseEnv 不得被修改')
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

// —— 宿主 safe-delete shim 净化（2026-09-14 P1 缺陷回归保护）——

test('剔除宿主 safe-delete shim 的激活变量与守卫上下文', () => {
  const env = buildElectronEnv({
    CODEBUDDY_SESSION_ID: 'session-1',
    CLAUDE_SESSION_ID: 'session-2',
    CODEBUDDY_TOOL_CALL_ID: 'call-1',
    CODEBUDDY_CONVERSATION_REQUEST_ID: 'req-1',
    CODEBUDDY_SAFE_DELETE_ENABLED: '1',
    CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR: 'D:\\Temp\\codebuddy-safe-delete-bulk',
    CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD: '500',
    CODEBUDDY_SAFE_DELETE_STATE_DIR: 'D:\\Temp\\sd-state',
    CODEBUDDY_SAFE_DELETE_TERMINAL_KEY: 'term-1',
    CODEBUDDY_SAFE_DELETE_HOST_HEARTBEAT: 'D:\\Temp\\sd-state\\host-heartbeat.json',
    CODEBUDDY_SAFE_DELETE_REPORT_PATH: 'D:\\Temp\\sd-report.jsonl',
    BASH_ENV: 'D:\\temp\\safe-delete-bash-env.sh',
    KEEP: 'yes',
  })
  const leaked = Object.keys(env).filter((key) => /^(codebuddy_|claude_session_id$|bash_env$)/.test(key.toLowerCase()))
  assert.deepEqual(leaked, [], 'shim 上下文不得透传：' + leaked.join(','))
  assert.equal(env.KEEP, 'yes')
})

test('NODE_OPTIONS：移除指向 shim 的 --require 注入，保留其他选项', () => {
  const env = buildElectronEnv({
    NODE_OPTIONS: `--max-old-space-size=4096 ${SHIM_REQUIRE_VALUE} --trace-warnings`,
  })
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=4096 --trace-warnings')

  const unquoted = buildElectronEnv({ NODE_OPTIONS: `--require=${SHIM_DIR}/node-safe-delete-shim.cjs` })
  assert.equal('NODE_OPTIONS' in unquoted, false, '仅剩 shim 注入时应删除 NODE_OPTIONS')

  const separateArg = buildElectronEnv({ NODE_OPTIONS: `--require "${SHIM_DIR}\\node-language-shim.cjs"` })
  assert.equal('NODE_OPTIONS' in separateArg, false)

  const untouched = buildElectronEnv({ NODE_OPTIONS: '--max-old-space-size=2048' })
  assert.equal(untouched.NODE_OPTIONS, '--max-old-space-size=2048', '无关选项必须原样保留')
})

test('NODE_OPTIONS：本机实际注入形态（正斜杠 + 空格路径 + 引号）被完整清除', () => {
  const observed = process.env.NODE_OPTIONS || ''
  const env = buildElectronEnv({
    NODE_OPTIONS: '--require="D:/Program Files/CodeBuddy CN/resources/app/extensions/genie/out/vendor/shim/node-language-shim.cjs"',
  })
  assert.equal('NODE_OPTIONS' in env, false, '实测注入值必须被整体清除（observed=' + observed + '）')
})

test('PATH / PYTHONPATH：移除 shim 目录条目，保留其他条目', () => {
  const env = buildElectronEnv({
    PATH: [`${SHIM_DIR}\\safe-bin`, 'C:\\Windows\\System32', 'D:\\Tools'].join(path.delimiter),
    PYTHONPATH: SHIM_DIR,
  })
  assert.equal(env.PATH, ['C:\\Windows\\System32', 'D:\\Tools'].join(path.delimiter))
  assert.equal('PYTHONPATH' in env, false, '仅剩 shim 目录时应删除 PYTHONPATH')

  const untouched = buildElectronEnv({ PATH: 'C:\\Windows\\System32' })
  assert.equal(untouched.PATH, 'C:\\Windows\\System32')
})

test('shim 识别工具函数契约', () => {
  assert.equal(isHostileShimPath(`${SHIM_DIR}\\node-language-shim.cjs`), true)
  assert.equal(isHostileShimPath(`${SHIM_DIR}/safe-bin`), true)
  assert.equal(isHostileShimPath('C:\\Windows\\System32'), false)
  assert.equal(isHostileShimPath(''), false)
  assert.equal(sanitizeNodeOptions(''), undefined)
  assert.equal(sanitizePathList('   '), undefined)
})

test('真实宿主环境形态：净化后不含任何 shim 注入（端到端回归）', () => {
  const base = {
    NODE_OPTIONS: SHIM_REQUIRE_VALUE,
    PATH: [`${SHIM_DIR}\\safe-bin`, 'C:\\Windows\\System32'].join(path.delimiter),
    PYTHONPATH: SHIM_DIR,
    CODEBUDDY_SESSION_ID: 'session-1',
    CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR: 'D:\\Temp\\bulk',
    ELECTRON_USER_DATA_DIR: 'D:\\tmp\\profile',
  }
  const env = buildElectronEnv(base, { DEV_SERVER_PORT: '7367' })
  assert.equal('NODE_OPTIONS' in env, false)
  assert.equal('PYTHONPATH' in env, false)
  assert.equal('CODEBUDDY_SESSION_ID' in env, false)
  assert.equal('CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR' in env, false)
  assert.equal(env.ELECTRON_USER_DATA_DIR, 'D:\\tmp\\profile')
  assert.equal(env.DEV_SERVER_PORT, '7367')
  assert.equal(env.PATH, 'C:\\Windows\\System32')
})
