/**
 * QM-1 打包验证脚本的路径解析（fix-qm1-verify-path，2026-10-17）。
 *
 * 背景（实测，非推测）：
 *   `scripts/qm1-scheduled-publish-verify.cjs` 自 #2985 引入起写的是
 *   `const DESKTOP = path.resolve(__dirname)` —— 脚本住在**仓库根** `scripts/`，
 *   而 electron-builder 的产物在 `<repo>/apps/desktop/dist-electron/...`。
 *   于是它从第一天起就在 `<repo>/scripts/dist-electron/...` 找 asar：
 *   首步「产物存在」报缺失，第二步 `asar list` 直接 ENOENT 退出（2026-10-17 复现）。
 *
 *   后果不是「少一个便利脚本」，而是 AGENTS.md 把它写成「三层判据的脚本侧同源实现」：
 *   一个从未跑通、也没有任何 CI/包脚本调用方的脚本，被当成判据真源引用 ——
 *   本仓反复出现的「装饰性门禁」同型（声称存在的校验实际一次都没执行）。
 *
 * 本模块把「脚本位置 → 应用目录」做成**可单测的纯路径解析 + 可判定的存在性检查**：
 *   不再假设脚本就在 apps/desktop，而是从脚本所在目录向上找，
 *   第一个包含 `apps/desktop/package.json` 的祖先即仓库根。
 *   **找不到就抛错（fail closed），绝不静默退回脚本目录** —— 静默退回正是本缺陷的成因：
 *   错了却不报错，只是把「路径不对」伪装成「产物没打包」。
 *
 * 回归锁：`scripts/qm1-paths.test.js`（含接线锁：真机脚本必须调用本模块）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** 桌面应用目录相对仓库根的路径段（与 pnpm workspace 布局同源）。 */
const DESKTOP_SEGMENTS = ['apps', 'desktop']
/** 桌面应用 package.json 的 name —— 用来把「找错目录」与「产物缺失」分开报。 */
const DESKTOP_PACKAGE_NAME = '@multi-publish/desktop'

/**
 * 从 `startDir` 向上找仓库根（判据：某级祖先下存在 `apps/desktop/package.json`），
 * 再返回该桌面应用目录。
 *
 * @param {string} startDir 起始目录；真机脚本传 `__dirname`
 * @returns {string} 绝对路径 `<repo>/apps/desktop`
 */
function resolveDesktopDir (startDir) {
  if (typeof startDir !== 'string' || startDir.trim() === '') {
    throw new TypeError(`resolveDesktopDir 需要脚本所在目录（收到 ${JSON.stringify(startDir)}）`)
  }
  let dir = path.resolve(startDir)
  for (;;) {
    const candidate = path.join(dir, ...DESKTOP_SEGMENTS)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `无法从 ${path.resolve(startDir)} 向上定位 apps/desktop：QM-1 脚本必须位于 Multi-Publish 仓库内`
    + `（期望某级祖先下存在 ${DESKTOP_SEGMENTS.join('/')}/package.json）。`
    + ' 把脚本复制到仓库外再运行会得到错误路径，故这里 fail closed，不退回脚本所在目录。',
  )
}

/**
 * electron-builder `--dir` 的固定产物布局（验证 0/1/3 都从这两个路径出发）。
 *
 * @param {string} desktopDir `resolveDesktopDir()` 的返回值
 * @returns {{ asar: string, exe: string }}
 */
function artifactPaths (desktopDir) {
  const unpacked = path.join(desktopDir, 'dist-electron', 'win-unpacked')
  return {
    asar: path.join(unpacked, 'resources', 'app.asar'),
    exe: path.join(unpacked, 'Multi-Publish.exe'),
  }
}

/**
 * 断言解析结果真的是桌面应用（package.json 的 name 对得上）。
 * 目的是把「找错目录」从「产物缺失」这类二手症状里拎出来单独报 ——
 * 本缺陷当初就是被伪装成「产物没打包」的。
 *
 * @param {string} desktopDir
 * @returns {string} 原样返回 `desktopDir`，便于链式使用
 */
function assertDesktopDir (desktopDir) {
  const pkgPath = path.join(desktopDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`解析出的桌面应用目录不含 package.json：${desktopDir}`)
  }
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    throw new Error(`读取 ${pkgPath} 失败：${e.message}`)
  }
  if (pkg.name !== DESKTOP_PACKAGE_NAME) {
    throw new Error(
      `解析出的目录不是桌面应用：${desktopDir}（package.json name=${String(pkg.name)}，期望 ${DESKTOP_PACKAGE_NAME}）`,
    )
  }
  return desktopDir
}

module.exports = {
  DESKTOP_SEGMENTS,
  DESKTOP_PACKAGE_NAME,
  resolveDesktopDir,
  artifactPaths,
  assertDesktopDir,
}
