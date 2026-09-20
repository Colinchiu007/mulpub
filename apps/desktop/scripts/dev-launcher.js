// @ts-check
/**
 * dev-launcher.js — 开发模式 Electron 启动参数
 *
 * 与 scripts/dev.js 解耦，便于单元测试；不启动任何进程。
 */

/**
 * 构造 Electron 开发启动参数（不含 node/electron 可执行文件本身）。
 * @param {{ electronUserDataDir: string, electronCacheDir: string, desktopDir: string, cdpPort?: number, platform?: NodeJS.Platform }} options
 * @returns {string[]}
 */
function buildElectronArgs({ electronUserDataDir, electronCacheDir, desktopDir, cdpPort = 9222, platform = process.platform }) {
  // Windows 无可用 GPU 时，进程内 GPU + SwiftShader 会让窗口只合成背景层。
  // 显式禁用 GPU 与 GPU 合成，走软件合成，否则 Electron 窗口显示空白。
  return [
    `--user-data-dir=${electronUserDataDir}`,
    `--disk-cache-dir=${electronCacheDir}`,
    '--no-sandbox',
    `--remote-debugging-port=${cdpPort}`,
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    desktopDir,
  ]
}

/**
 * 开发模式默认 userData 目录（固定 D 盘，避免 C 盘空间占用）。
 * 登录态（identity-session.json）与模型 key（multi-publish.db）都按 userData 隔离，
 * 固定默认目录可杜绝「随机临时目录 → 数据像丢失」的启动问题。
 */
const DEFAULT_USER_DATA_DIR = 'D:\\tmp\\Multi-Publish-debug-profile'

/**
 * 解析开发模式 userData 目录。
 * 显式设置 ELECTRON_USER_DATA_DIR 时优先（start-desktop.ps1 指定 profile / 并发会话隔离），
 * 否则使用固定默认 profile。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveUserDataDir(env = process.env) {
  const configured = typeof env.ELECTRON_USER_DATA_DIR === 'string' ? env.ELECTRON_USER_DATA_DIR.trim() : ''
  return configured || DEFAULT_USER_DATA_DIR
}

module.exports = { buildElectronArgs, resolveUserDataDir, DEFAULT_USER_DATA_DIR }
