// @ts-check
/**
 * electron-runtime-env.js — 构造 Electron 主进程 spawn 环境（唯一公共实现）
 *
 * 背景（2026-09-14 实测 P1 缺陷）：
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
 * 因此：spawn Electron 主进程前**必须**剔除 `ELECTRON_RUN_AS_NODE`。
 * 显式 overrides 仍可覆盖（保留用户/脚本主动设置该变量的能力）。
 */

/** 需要从 Electron 主进程环境中剔除的变量名（不区分大小写，Windows 环境变量名不区分大小写）。 */
const ELECTRON_STRIPPED_ENV_KEYS = Object.freeze(['ELECTRON_RUN_AS_NODE'])

/**
 * 构造 Electron 主进程 spawn 环境变量。
 *
 * 规则（顺序敏感）：
 *  1. 复制 baseEnv，剔除 ELECTRON_STRIPPED_ENV_KEYS 中的键（大小写不敏感）；
 *  2. 叠加 overrides（值为 `undefined` 的键跳过，避免把变量写成空串）；
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
    if (stripped.has(String(key).toLowerCase())) continue
    out[key] = base[key]
  }
  const extra = overrides && typeof overrides === 'object' ? overrides : {}
  for (const key of Object.keys(extra)) {
    if (extra[key] === undefined) continue
    out[key] = extra[key]
  }
  return out
}

module.exports = { buildElectronEnv, ELECTRON_STRIPPED_ENV_KEYS }
