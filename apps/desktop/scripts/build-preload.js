'use strict'

const path = require('path')
const esbuild = require('esbuild')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const ENTRY_FILE = path.join(DESKTOP_ROOT, 'electron', 'preload', 'index.js')
const OUTPUT_FILE = path.join(DESKTOP_ROOT, 'electron', 'preload', 'index.bundle.js')
// 内嵌主页标签（home-shell）preload 入口：bundle 后条件 require('./preload/index.js') 被内联，
// sandbox 运行时可加载（与主窗口 index.bundle.js 同策略）。源文件在 electron/ 根。
const HOME_SHELL_ENTRY_FILE = path.join(DESKTOP_ROOT, 'electron', 'home-shell-preload.js')
const HOME_SHELL_OUTPUT_FILE = path.join(DESKTOP_ROOT, 'electron', 'home-shell-preload.bundle.js')
// 浏览/账号标签 preload（2026-10-15 收敛合并）：它承担**主世界反检测注入**（账号标签是用户
// 「点开账号浏览平台」的路径，此前的接线缺口），而 stealth 源码在同目录 `electron/stealth/` 下，
// 必须内联成单文件——sandbox preload 无法 require 相对路径文件（真机实测 module not found）。
// 消费方：services/webview-manager/utils.js 的 _monitorPreloadPath()（bundle 优先，缺失则回落
// 源文件并出声告警）。与 RPA 窗口的 stealth-preload-enhanced 是两条独立承载，共用同一份源码。
const MONITOR_ENTRY_FILE = path.join(DESKTOP_ROOT, 'electron', 'monitor-preload.js')
const MONITOR_OUTPUT_FILE = path.join(DESKTOP_ROOT, 'electron', 'monitor-preload.bundle.js')

function buildPreload({ write = true, logLevel = 'silent' } = {}) {
  return esbuild.build({
    absWorkingDir: DESKTOP_ROOT,
    entryPoints: [ENTRY_FILE],
    outfile: OUTPUT_FILE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    legalComments: 'none',
    charset: 'utf8',
    logLevel,
    write,
  })
}

function buildHomeShellPreload({ write = true, logLevel = 'silent' } = {}) {
  return esbuild.build({
    absWorkingDir: DESKTOP_ROOT,
    entryPoints: [HOME_SHELL_ENTRY_FILE],
    outfile: HOME_SHELL_OUTPUT_FILE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    legalComments: 'none',
    charset: 'utf8',
    logLevel,
    write,
  })
}

// stealth 增强 preload：sandbox preload 的 require 是受限 polyfill、不支持相对文件，
// 必须把同目录 evasions-bundle.js 内联成单文件（QM-6 Warning-2）。产物与源文件同目录，
// 供 rpa-view-session._resolvePreloadPath 引用（缺失时运行时 fail-closed 回落 baseline，
// QM-6 Critical）；bundle 为受管产物随仓提交（先例：index/home-shell bundle 均 tracked，
// eslint 已 ignore electron/**/*.bundle.js）。
const STEALTH_ENHANCED_ENTRY_FILE = path.join(DESKTOP_ROOT, 'electron', 'services', 'stealth', 'stealth-preload-enhanced.js')
const STEALTH_ENHANCED_OUTPUT_FILE = path.join(DESKTOP_ROOT, 'electron', 'services', 'stealth', 'stealth-preload-enhanced.bundle.js')

function buildStealthEnhancedPreload({ write = true, logLevel = 'silent' } = {}) {
  return esbuild.build({
    absWorkingDir: DESKTOP_ROOT,
    entryPoints: [STEALTH_ENHANCED_ENTRY_FILE],
    outfile: STEALTH_ENHANCED_OUTPUT_FILE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    legalComments: 'none',
    charset: 'utf8',
    logLevel,
    write,
  })
}

function buildMonitorPreload({ write = true, logLevel = 'silent' } = {}) {
  return esbuild.build({
    absWorkingDir: DESKTOP_ROOT,
    entryPoints: [MONITOR_ENTRY_FILE],
    outfile: MONITOR_OUTPUT_FILE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    legalComments: 'none',
    charset: 'utf8',
    logLevel,
    write,
  })
}

async function main() {
  try {
    await buildPreload({ logLevel: 'info' })
    await buildHomeShellPreload({ logLevel: 'info' })
    await buildStealthEnhancedPreload({ logLevel: 'info' })
    await buildMonitorPreload({ logLevel: 'info' })
  } catch (error) {
    console.error('preload 构建失败：', error)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  ENTRY_FILE,
  OUTPUT_FILE,
  HOME_SHELL_ENTRY_FILE,
  HOME_SHELL_OUTPUT_FILE,
  STEALTH_ENHANCED_ENTRY_FILE,
  STEALTH_ENHANCED_OUTPUT_FILE,
  MONITOR_ENTRY_FILE,
  MONITOR_OUTPUT_FILE,
  buildPreload,
  buildHomeShellPreload,
  buildStealthEnhancedPreload,
  buildMonitorPreload,
}
