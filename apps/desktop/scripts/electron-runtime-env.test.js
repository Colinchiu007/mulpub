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
  isTrustedPythonPath,
  resolveSystemPython,
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

test('baseEnv 为 null/undefined 时返回 overrides（并注入系统 MP_PYTHON）', (t) => {
  const systemPython = resolveSystemPython()
  if (!systemPython) {
    t.skip('本机无法定位系统 Python 3.12，跳过注入断言')
    return
  }
  const envA = buildElectronEnv(null, { A: '1' })
  assert.equal(envA.A, '1')
  assert.equal(envA.MP_PYTHON, systemPython, 'null baseEnv 也应注入系统 MP_PYTHON')
  const envB = buildElectronEnv(undefined, { A: '1' })
  assert.equal(envB.A, '1')
  assert.equal(envB.MP_PYTHON, systemPython)
  const envC = buildElectronEnv(null)
  assert.equal(envC.MP_PYTHON, systemPython)
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

// —— MP_PYTHON 系统 Python 自定位注入（2026-09-18 缺陷回归保护）——
// 背景：父会话 PATH 里 python/py 被工具缓存裸解释器（github-runner/_work/_tool）截胡时，
// SplitterBridge（8002）No module named 'splitter'、PromptBridge（8013）No module named 'pydantic'，
// 视频创作流水线 optimize 阶段健康检查超时 → 项目 failed。

const fs = require('node:fs')

test('MP_PYTHON：baseEnv 未显式设置时注入系统 Python 3.12', (t) => {
  const systemPython = resolveSystemPython()
  if (!systemPython) {
    t.skip('本机无法定位系统 Python 3.12（无 LOCALAPPDATA Python312 且无可信 py），跳过注入断言')
    return
  }
  const env = buildElectronEnv({ PATH: 'C:\\Windows\\System32', HOME: '/home/u' })
  assert.equal(env.MP_PYTHON, systemPython, '应注入 resolveSystemPython() 解析出的系统 Python')
  assert.ok(fs.existsSync(env.MP_PYTHON), 'MP_PYTHON 必须是真实存在的可执行文件: ' + env.MP_PYTHON)
})

test('MP_PYTHON：baseEnv 显式设置时不被覆盖（保留调用方主动选择）', () => {
  const env = buildElectronEnv({ MP_PYTHON: 'C:\\Program Files\\Custom\\python.exe', PATH: 'C:\\Windows' })
  assert.equal(env.MP_PYTHON, 'C:\\Program Files\\Custom\\python.exe')
})

test('MP_PYTHON：大小写变体（mp_python）也被视为显式设置', () => {
  const env = buildElectronEnv({ mp_python: 'C:\\Program Files\\Custom\\python.exe' })
  assert.equal(env.mp_python, 'C:\\Program Files\\Custom\\python.exe', '小写变体原样保留')
  assert.equal('MP_PYTHON' in env, false, '已存在显式设置时不得再注入大写 MP_PYTHON')
})

test('MP_PYTHON：overrides 显式值优先于自动注入', () => {
  const env = buildElectronEnv({ PATH: 'C:\\Windows' }, { MP_PYTHON: 'D:\\Program Files\\Override\\python.exe' })
  assert.equal(env.MP_PYTHON, 'D:\\Program Files\\Override\\python.exe')
})

test('isTrustedPythonPath：工具缓存裸解释器被排除，系统 Python 被接受', () => {
  // 自托管 runner 工具缓存（正/反斜杠形态）
  assert.equal(isTrustedPythonPath('D:\\Data\\github-runner\\_work\\_tool\\Python\\3.12.10\\x64\\python.exe'), false)
  assert.equal(isTrustedPythonPath('D:/Data/github-runner/_work/_tool/Python/3.12.10/x64/python.exe'), false)
  // GitHub hosted runner 工具缓存（C:\hostedtoolcache\windows\Python\...）
  assert.equal(isTrustedPythonPath('C:\\hostedtoolcache\\windows\\Python\\3.12.10\\x64\\python.exe'), false)
  assert.equal(isTrustedPythonPath('C:/hostedtoolcache/windows/Python/3.12.10/x64/python.exe'), false)
  // 系统 Python 3.12（用户级安装）
  assert.equal(isTrustedPythonPath('C:\\Users\\u\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'), true)
  assert.equal(isTrustedPythonPath(''), false)
})
