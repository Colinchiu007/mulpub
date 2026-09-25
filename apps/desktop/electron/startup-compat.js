'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function getExplicitUserDataDir (env, argv) {
  const configured = typeof env.ELECTRON_USER_DATA_DIR === 'string'
    ? env.ELECTRON_USER_DATA_DIR.trim()
    : ''
  if (configured) return configured

  const argument = argv.find((value) => value.startsWith('--user-data-dir='))
  const fromArgument = argument ? argument.slice('--user-data-dir='.length).trim() : ''
  return fromArgument || null
}

function isWritableDirectory (fsImpl, directory) {
  try {
    fsImpl.mkdirSync(directory, { recursive: true })
    fsImpl.accessSync(directory, fsImpl.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function setDataPaths (app, userDataDir) {
  if (typeof app.setPath !== 'function') return
  app.setPath('userData', userDataDir)
  app.setPath('sessionData', path.join(userDataDir, 'session'))
  app.setPath('cache', path.join(userDataDir, 'cache'))
}

/**
 * 向上查找共享数据锚点：从 startDir 逐级上溯，寻找
 * `shared-user-data/.shared-data-anchor` 文件。
 *
 * 这是「零环境变量」的强制共享方案：只要开发者在仓库根创建了
 * `shared-user-data/.shared-data-anchor`，无论从哪个环境（WSL/Windows）
 * 启动，应用都会自动使用仓库根的 shared-user-data 作为 userData，
 * 两个环境的模型配置、流水线选项、发布历史天然一致。
 *
 * 锚点缺失 → 返回 null，行为完全回退到默认 userData（不改变既有逻辑）。
 * 打包应用：asar 内不存在锚点文件，自然回退默认行为，对终端用户零影响。
 */
function findSharedUserDataDir (fsImpl, startDir) {
  let dir = startDir
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, 'shared-user-data')
    try {
      if (fsImpl.existsSync(path.join(candidate, '.shared-data-anchor'))) return candidate
    } catch (_) { /* 权限异常等同锚点不存在 */ }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function configureUserDataPath ({
  app,
  env = process.env,
  argv = process.argv,
  fsImpl = fs,
  osImpl = os,
  platform = process.platform,
  moduleDir = typeof __dirname === 'string' ? __dirname : process.cwd(),
} = {}) {
  if (!app || typeof app.getPath !== 'function') {
    return { path: null, fallback: false, explicit: false }
  }

  const explicit = getExplicitUserDataDir(env, argv)
  if (explicit) {
    setDataPaths(app, explicit)
    return { path: explicit, fallback: false, explicit: true }
  }

  // 共享数据锚点（优先级仅低于显式环境变量/CLI 参数）：
  // 检测到锚点且目录可写 → 自动启用共享 userData。
  const shared = findSharedUserDataDir(fsImpl, moduleDir)
  if (shared && isWritableDirectory(fsImpl, shared)) {
    setDataPaths(app, shared)
    return { path: shared, fallback: false, explicit: false, shared: true }
  }

  const current = app.getPath('userData')
  if (typeof app.setPath !== 'function') {
    return { path: current, fallback: false, explicit: false }
  }

  if (isWritableDirectory(fsImpl, current)) {
    setDataPaths(app, current)
    return { path: current, fallback: false, explicit: false }
  }

  const localRoot = typeof env.LOCALAPPDATA === 'string' && env.LOCALAPPDATA.trim()
    ? env.LOCALAPPDATA
    : platform === 'win32'
      ? path.join(osImpl.homedir(), 'AppData', 'Local')
      : osImpl.tmpdir()
  const fallback = path.join(localRoot, 'Multi-Publish', 'user-data')

  if (!isWritableDirectory(fsImpl, fallback)) {
    throw new Error(`无法写入 Electron userData 目录：${current}；备用目录也不可写：${fallback}`)
  }

  setDataPaths(app, fallback)
  return { path: fallback, fallback: true, explicit: false, previousPath: current }
}

function configureGraphics ({
  app,
  env = process.env,
  platform = process.platform,
} = {}) {
  // 2026-09-12 GPU 帧循环卡死复盘（产品级修复）：
  // 旧策略 Windows 默认强制 SwiftShader 软件渲染（规避历史 GPU 兼容问题），但实测
  // 部分 Windows 环境（高 DPI/多显示器/特定驱动）下 SwiftShader 合成器停摆——
  // requestAnimationFrame 0 帧、窗口空白但 DOM/JS 存活，且影响所有安装用户。
  // 新策略对齐 VS Code/Slack：默认硬件加速（Chromium 自带驱动 blocklist 处理兼容），
  // ELECTRON_DISABLE_GPU=1 保留为手动逃生门；GPU 进程崩溃由 window 层监听并提示。
  const explicitlyDisabled = env.ELECTRON_DISABLE_GPU === '1'
  const safeMode = env.ELECTRON_GPU_SAFE_MODE === '1'
  if (!explicitlyDisabled && !safeMode) {
    return { disabled: false, reason: null }
  }

  const appendSwitch = app?.commandLine?.appendSwitch
  if (typeof appendSwitch === 'function') {
    appendSwitch.call(app.commandLine, 'disable-gpu')
    appendSwitch.call(app.commandLine, 'disable-gpu-compositing')
    if (safeMode) appendSwitch.call(app.commandLine, 'disable-gpu-sandbox')
  }
  if (typeof app?.disableHardwareAcceleration === 'function') {
    app.disableHardwareAcceleration()
  }

  return {
    disabled: true,
    reason: safeMode ? 'safe-mode' : 'explicit',
  }
}

/**
 * 净化 Electron 默认 UA，去掉 Electron/<version> 与 <AppName>/<version> 标记。
 *
 * 背景：知乎等平台的登录风控会识别 UA 中的 Electron 标记并拒绝下发短信验证码
 * （报错 10001:请求参数异常，请升级客户端后重试 / 客户端异常）。参考产品通过设置
 * app.userAgentFallback 为标准浏览器 UA 解决同类问题。本函数采用动态方案：
 * 读取 app.userAgentFallback（Electron 的 App 接口只暴露这一个 UA 入口，
 * `userAgent` 属于 WebContents，读它会得到 undefined 并让净化静默失效），
 * 仅剔除 Electron 相关 token，避免硬编码 UA 版本随内核升级而过期。
 *
 * 仅在 UA 确实包含 Electron 标记时才写入 userAgentFallback，保持幂等与最小侵入。
 *
 * @param {{ app: { userAgentFallback?: string } | null | undefined }} options
 * @returns {{ configured: boolean, userAgent?: string }}
 */
function configureUserAgentFallback ({ app } = {}) {
  const originalUa = typeof app?.userAgentFallback === 'string' ? app.userAgentFallback : ''
  if (!originalUa) return { configured: false }

  // Electron 默认 userAgentFallback 形如：
  // Mozilla/5.0 (...) Multi-Publish/1.2.3 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36
  // 采用标准 token 白名单：只保留 Mozilla/Chrome/Safari/AppleWebKit 等浏览器原生 token，
  // 剔除 Electron/x.y.z 与 <AppName>/x.y.z（位置无关，避免正则误删 Mozilla/5.0）。
  const KEEP_TOKENS = new Set(['Mozilla', 'Chrome', 'Safari', 'AppleWebKit', 'Gecko', 'like', 'Edg'])
  const sanitized = originalUa
    .split(' ')
    .filter((token) => {
      const match = token.match(/^([A-Za-z][A-Za-z0-9_.-]*)\//)
      return !(match && !KEEP_TOKENS.has(match[1]))
    })
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!sanitized || sanitized === originalUa) return { configured: false }

  app.userAgentFallback = sanitized
  return { configured: true, userAgent: sanitized }
}

module.exports = {
  configureGraphics,
  configureUserAgentFallback,
  configureUserDataPath,
  findSharedUserDataDir,
  getExplicitUserDataDir,
  isWritableDirectory,
}
