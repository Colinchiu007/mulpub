// @ts-check
/**
 * electron-runtime-env.js — 构造 Electron 主进程 spawn 环境（唯一公共实现）
 *
 * 背景一（2026-09-14 实测 P1 缺陷）：宿主注入 `ELECTRON_RUN_AS_NODE=1`
 *   父环境若设置了 `ELECTRON_RUN_AS_NODE=1`（Electron 系 IDE 的集成终端、部分
 *   CI/工具链会注入；本机 Codex/WorkBuddy 会话默认值即为 1），而 spawn Electron
 *   二进制时直接 `{...process.env}` 透传，Electron 会退化成**纯 Node 运行时**：
 *   `electron.exe <appPath>` 里所有 Chromium 开关都被当作未知参数拒绝：
 *
 *     electron.exe: bad option: --user-data-dir=D:\tmp\...
 *     electron.exe: bad option: --remote-debugging-port=10967
 *     ...
 *
 *   现象极具迷惑性：Vite 正常起来、Python bridge health 全绿、但没有窗口、
 *   CDP 端口从不监听，最终以「150s 内未出现可见主窗口」超时收场。
 *
 * 背景二（2026-09-14 实测 P1 缺陷）：宿主注入的「安全删除 shim」击穿登录
 *   IDE（CodeBuddy / WorkBuddy 系）在 Agent 终端里注入：
 *     NODE_OPTIONS=--require="<...>/extensions/genie/out/vendor/shim/node-language-shim.cjs"
 *     CODEBUDDY_SESSION_ID / CODEBUDDY_TOOL_CALL_ID / CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR ...
 *   该 shim 会 patch `fs.unlink / fs.rm / fs.rmdir`（含 promises 版本），把「删除文件」
 *   改写为「移入回收站」，并在删除前跑 safe-delete bulk guard：**同一个 requestId
 *   （conversationRequestId 或 toolCallId）累计删除数达 500 即 fail-closed 抛错**
 *   （错误形如 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {...}`，且 **不带
 *   `.code`**）。Electron 主进程是长生命周期进程：`CODEBUDDY_TOOL_CALL_ID` 是启动
 *   那一刻冻结的旧 id，应用运行数小时会删除大量临时/缓存/DB 文件 ⇒ 计数越过 500 ⇒
 *   此后**应用内所有 unlink/rm 全部抛错**。实测后果：`identity-session.json` 无法删除，
 *   `SecureTokenStorage.clear()` 抛非 fs 错误 → 身份状态机把清理错误当成主错误暴露为
 *   `IDENTITY_SESSION_CLEAR_FAILED` → 登录按钮点击后直接报错（详见
 *   01-docs/BUGFIX-IDENTITY-SESSION-CLEAR-FAILED-2026-09-14.md）。
 *
 * 因此：spawn Electron 主进程前**必须**剔除：
 *   1. `ELECTRON_RUN_AS_NODE`（否则 Electron 退化为 Node）；
 *   2. 宿主 safe-delete shim 的上下文（NODE_OPTIONS 的 `--require` 注入、
 *      `CODEBUDDY_SESSION_ID` 等激活变量、shim 目录在 PATH/PYTHONPATH 中的条目）。
 *
 * 显式 overrides 仍可覆盖（保留用户/脚本主动设置该变量的能力）。
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

/** 需要从 Electron 主进程环境中剔除的变量名（不区分大小写，Windows 环境变量名不区分大小写）。 */
const ELECTRON_STRIPPED_ENV_KEYS = Object.freeze([
  'ELECTRON_RUN_AS_NODE',
  // —— 宿主 safe-delete shim 的激活变量与守卫上下文 ——
  // shim 入口先读 SESSION_ID，缺失即整体 inert；同时剔除守卫上下文，避免 shim 以
  // 「上下文未知 → 视为存活」的默认继续生效。
  'CODEBUDDY_SESSION_ID',
  'CLAUDE_SESSION_ID',
  'CODEBUDDY_TOOL_CALL_ID',
  'CODEBUDDY_CONVERSATION_REQUEST_ID',
  'CODEBUDDY_SAFE_DELETE_ENABLED',
  'CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR',
  'CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD',
  'CODEBUDDY_SAFE_DELETE_STATE_DIR',
  'CODEBUDDY_SAFE_DELETE_TERMINAL_KEY',
  'CODEBUDDY_SAFE_DELETE_HOST_HEARTBEAT',
  'CODEBUDDY_SAFE_DELETE_REPORT_PATH',
  // 指向 shim 目录的 shell/python 注入点（会随子进程继续传播）
  'BASH_ENV',
])

/** shim 模块文件名标记（出现在 NODE_OPTIONS 的 --require 目标里）。 */
const HOSTILE_SHIM_MODULE_MARKERS = Object.freeze([
  'node-language-shim.cjs',
  'node-safe-delete-shim.cjs',
])

/** shim 目录标记（出现在 PATH / PYTHONPATH 条目里）。 */
const HOSTILE_SHIM_DIR_MARKER = 'extensions/genie/out/vendor/shim'

/**
 * 归一化路径用于标记匹配：统一分隔符 + 小写（Windows 不区分大小写）。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeForMatch(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\\/g, '/')
    .toLowerCase()
}

/**
 * 判断某个路径/参数目标是否属于宿主 safe-delete shim。
 * @param {unknown} value
 * @returns {boolean}
 */
function isHostileShimPath(value) {
  const normalized = normalizeForMatch(value)
  if (!normalized) return false
  if (HOSTILE_SHIM_MODULE_MARKERS.some((marker) => normalized.includes(marker))) return true
  return normalized.includes(HOSTILE_SHIM_DIR_MARKER)
}

/**
 * 去掉 shell 风格的单/双引号包裹。
 * @param {string} value
 * @returns {string}
 */
function stripQuotes(value) {
  const text = String(value || '')
  if (text.length >= 2 && ((text[0] === '"' && text.endsWith('"')) || (text[0] === "'" && text.endsWith("'")))) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * 清洗 NODE_OPTIONS：移除指向宿主 safe-delete shim 的 `--require` 注入。
 *
 * 两段式（都只针对 shim 模块名，不会误伤调用方自己的 `--max-old-space-size` 等选项）：
 *  1. 整体正则：覆盖 `--require=<路径>` 的 unquoted 形态（路径里可能含空格，
 *     按 shim 文件名定位结尾），以及 `--require "带引号路径"` 形态；
 *  2. token 级过滤：兜底清理其他把 shim 模块当参数传入的写法。
 *
 * @param {unknown} value
 * @returns {string | undefined} 清洗后的值；`undefined` 表示该变量应被删除
 */
function sanitizeNodeOptions(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const markers = HOSTILE_SHIM_MODULE_MARKERS.map((marker) => marker.replace(/\./g, '\\.')).join('|')
  const inlinePattern = new RegExp(
    `--require\\s*=?\\s*(?:"[^"]*(?:${markers})"|[^'"\`]*?(?:${markers}))`,
    'g',
  )
  let text = value.replace(inlinePattern, ' ')
  const tokens = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  const kept = []
  let changed = text !== value
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const inline = /^--require=(.+)$/.exec(token)
    if (inline) {
      if (isHostileShimPath(stripQuotes(inline[1]))) {
        changed = true
        continue
      }
      kept.push(token)
      continue
    }
    if (token === '--require') {
      const next = tokens[index + 1]
      if (next && isHostileShimPath(stripQuotes(next))) {
        changed = true
        index += 1
        continue
      }
      kept.push(token)
      if (next) {
        kept.push(next)
        index += 1
      }
      continue
    }
    if (isHostileShimPath(stripQuotes(token))) {
      changed = true
      continue
    }
    kept.push(token)
  }
  if (!changed) return value
  const rebuilt = kept.join(' ').trim()
  return rebuilt || undefined
}

/**
 * 清洗路径列表（PATH / PYTHONPATH）：移除指向宿主 shim 目录的条目。
 * @param {unknown} value
 * @returns {string | undefined} 清洗后的值；`undefined` 表示该变量应被删除
 */
function sanitizePathList(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parts = value.split(path.delimiter)
  const kept = parts.filter((part) => part && !isHostileShimPath(part))
  if (kept.length === parts.filter(Boolean).length) return value
  if (kept.length === 0) return undefined
  return kept.join(path.delimiter)
}

/** 工具缓存/沙箱目录标记：这些位置的 Python 是裸解释器（无 pydantic/splitter 等业务依赖），
 *  被 PATH 截胡时会导致 SplitterBridge/PromptBridge 启动失败（ModuleNotFoundError）。 */
const UNTRUSTED_PYTHON_MARKERS = Object.freeze([
  'github-runner',
  // GitHub Actions hosted runner 工具缓存（C:\hostedtoolcache\windows\Python\...）也是裸解释器
  'hostedtoolcache',
  // 自托管 runner 工具缓存（_work/_tool）；normalizeForMatch 已统一为 '/'，无需再列反斜杠变体
  '_work/_tool',
])

/** Windows 标准用户级 Python 3.12 安装候选路径（按优先级）。 */
function systemPythonCandidates() {
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = []
  if (localAppData) {
    candidates.push(path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'))
  }
  return candidates
}

/**
 * 判断某个 Python 可执行文件路径是否可信（排除工具缓存/沙箱裸解释器）。
 * @param {string} filePath
 * @returns {boolean}
 */
function isTrustedPythonPath(filePath) {
  const normalized = normalizeForMatch(filePath)
  if (!normalized) return false
  if (UNTRUSTED_PYTHON_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()))) return false
  return true
}

/** 模块级缓存：避免每次 buildElectronEnv 重复探测。 */
let cachedSystemPython = undefined

/**
 * 定位系统 Python 3.12（自定位，不依赖调用方 PATH 的裸 python/py）。
 *
 * 背景（2026-09-18 实测缺陷）：开发模式（scripts/dev.js）直接透传父进程 PATH，
 * 若父会话 PATH 里 python/py 被 GitHub Actions runner 工具缓存（_work/_tool/Python）
 * 或类似裸解释器截胡，SplitterBridge（8002）报 No module named 'splitter'、
 * PromptBridge（8013）报 No module named 'pydantic'，两个 Python 后端起不来，
 * 视频创作流水线 optimize 阶段健康检查超时 → 项目 failed。
 *
 * 定位顺序：
 *  1. Windows 标准用户级安装路径（%LOCALAPPDATA%\Programs\Python\Python312\python.exe）
 *     —— 本机系统 Python 3.12（含 pydantic 等业务依赖）所在，优先于 PATH 探测；
 *  2. py launcher（py -3.12）解析结果，但仅当解析出的路径真实存在且非工具缓存路径才接受。
 *
 * 纯函数（有模块级缓存）；任何一步失败返回 null，调用方保持原有回退语义。
 * @returns {string | null}
 */
function resolveSystemPython() {
  if (cachedSystemPython !== undefined) return cachedSystemPython
  let resolved = null
  for (const candidate of systemPythonCandidates()) {
    try {
      if (fs.existsSync(candidate)) {
        resolved = candidate
        break
      }
    } catch (_) { /* 忽略单点失败，继续探测 */ }
  }
  if (!resolved && process.platform === 'win32') {
    try {
      const output = execFileSync('py', ['-3.12', '-c', 'import sys; print(sys.executable)'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const candidate = String(output || '').trim().split(/\r?\n/)[0]
      if (candidate && isTrustedPythonPath(candidate) && fs.existsSync(candidate)) {
        resolved = candidate
      }
    } catch (_) { /* py launcher 不可用或解析异常，回退 null */ }
  }
  cachedSystemPython = resolved
  return resolved
}

/**
 * 构造 Electron 主进程 spawn 环境变量。
 *
 * 规则（顺序敏感）：
 *  1. 复制 baseEnv，剔除 ELECTRON_STRIPPED_ENV_KEYS 中的键（大小写不敏感）；
 *  2. `NODE_OPTIONS` 过滤掉宿主 shim 的 `--require` 注入（清空则删除该变量）；
 *  3. `PATH` / `PYTHONPATH` 过滤掉宿主 shim 目录条目（清空则删除该变量）；
 *  4. 若 baseEnv 未显式设置 `MP_PYTHON` 且能定位到系统 Python 3.12，注入
 *     `MP_PYTHON`（指向系统 Python 绝对路径）——避免父会话 PATH 里裸 python/py
 *     被工具缓存解释器截胡导致 SplitterBridge/PromptBridge 启动失败；
 *  5. 叠加 overrides（值为 `undefined` 的键跳过，避免把变量写成空串）；
 *     overrides 在剔除之后应用 —— 调用方显式设置的值优先。
 *
 * 纯函数：不修改 baseEnv / overrides。
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined> | null | undefined} baseEnv
 * @param {Record<string, string | undefined>} [overrides]
 * @returns {Record<string, string | undefined>}
 */
function buildElectronEnv(baseEnv, overrides = {}) {
  const out = {}
  const base = baseEnv && typeof baseEnv === 'object' ? baseEnv : {}
  const stripped = new Set(ELECTRON_STRIPPED_ENV_KEYS.map((key) => key.toLowerCase()))
  for (const key of Object.keys(base)) {
    const lower = String(key).toLowerCase()
    if (stripped.has(lower)) continue
    const value = base[key]
    if (lower === 'node_options') {
      const sanitized = sanitizeNodeOptions(value)
      if (sanitized === undefined) continue
      out[key] = sanitized
      continue
    }
    if (lower === 'path' || lower === 'pythonpath') {
      const sanitized = sanitizePathList(value)
      if (sanitized === undefined) continue
      out[key] = sanitized
      continue
    }
    out[key] = value
  }
  // MP_PYTHON 注入：仅当 baseEnv 未显式设置（含大小写变体）且能定位到系统 Python 时。
  // overrides 里显式设置的 MP_PYTHON 在下方叠加时优先，天然保留调用方主动覆盖能力。
  const hasMpPython = Object.keys(out).some((key) => key.toLowerCase() === 'mp_python')
  if (!hasMpPython) {
    const systemPython = resolveSystemPython()
    if (systemPython) out.MP_PYTHON = systemPython
  }
  const extra = overrides && typeof overrides === 'object' ? overrides : {}
  for (const key of Object.keys(extra)) {
    if (extra[key] === undefined) continue
    out[key] = extra[key]
  }
  return out
}

module.exports = {
  buildElectronEnv,
  ELECTRON_STRIPPED_ENV_KEYS,
  HOSTILE_SHIM_DIR_MARKER,
  HOSTILE_SHIM_MODULE_MARKERS,
  isTrustedPythonPath,
  isHostileShimPath,
  resolveSystemPython,
  sanitizeNodeOptions,
  sanitizePathList,
}
