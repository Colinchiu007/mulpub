#!/usr/bin/env node
// @ts-check
/**
 * launch-worktree.js — 以指定 worktree + 已登录 profile 启动桌面应用（开发模式）
 *
 * 从 C:\tmp\launch-worktree-4k.js 泛化收编（2026-08-09）：
 * - worktree / profile / CDP / 各后端端口均可参数化
 * - 支持 --env-file 注入 provider 密钥等环境变量（KEY=VALUE，逐行解析）
 * - macOS 前瞻：electron 可执行路径按平台解析
 *
 * 用法：
 *   node scripts/launch-worktree.js [--worktree <dir>] [--profile <dir>]
 *       [--cdp 9333] [--env-file .env]
 *
 * 说明：与项目规范一致——运行时代码变更走分支+PR；本脚本为 scripts/ 工具脚本。
 */
'use strict'

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

function printHelp() {
  console.log(`用法: node scripts/launch-worktree.js [选项]
选项:
  --worktree <dir>      项目 worktree 根目录（默认 D:/Data/projects/mp-worktrees/mp-output-resolution-capability）
  --profile <dir>       Electron userData 目录（默认 D:/Data/projects/mp-worktrees/debug-profile，已登录 profile）
  --cdp <port>          remote-debugging-port（默认 9333）
  --backend-port <p>    Python 后端端口（默认 8301）
  --prompt-port <p>     PromptBridge 端口（默认 8015）
  --splitter-port <p>   SplitterBridge 端口（默认 8004）
  --dev-server-port <p> Vite dev server 端口（默认 5200）
  --callback-port <p>   CallbackServer 端口（默认 16523）
  --env-file <file>     额外环境变量文件（KEY=VALUE）
  -h, --help            显示帮助`)
}

function parseArgs(argv) {
  const args = {
    worktree: 'D:/Data/projects/mp-worktrees/mp-output-resolution-capability',
    profile: 'D:/Data/projects/mp-worktrees/debug-profile',
    cdp: 9333,
    backendPort: '8301',
    promptPort: '8015',
    splitterPort: '8004',
    devServerPort: '5200',
    callbackPort: '16523',
    envFile: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const next = () => { const v = argv[i + 1]; if (v === undefined) { console.error('missing value for ' + key); process.exit(1) }; i += 1; return v }
    switch (key) {
      case '--worktree': args.worktree = next(); break
      case '--profile': args.profile = next(); break
      case '--cdp': args.cdp = Number(next()); break
      case '--backend-port': args.backendPort = next(); break
      case '--prompt-port': args.promptPort = next(); break
      case '--splitter-port': args.splitterPort = next(); break
      case '--dev-server-port': args.devServerPort = next(); break
      case '--callback-port': args.callbackPort = next(); break
      case '--env-file': args.envFile = next(); break
      case '-h': case '--help': printHelp(); process.exit(0)
      default: console.error('unknown arg: ' + key); printHelp(); process.exit(1)
    }
  }
  return args
}

/** 读取 KEY=VALUE 环境文件（忽略注释/空行；去引号）。 */
function loadEnvFile(file) {
  const out = {}
  if (!file) return out
  try {
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value
    }
  } catch (e) {
    console.warn('[launch-worktree] env-file read failed: ' + (e && e.message ? e.message : String(e)))
  }
  return out
}

/** 按平台解析 electron 可执行文件路径（macOS 前瞻）。 */
function electronExecutable(repoRoot) {
  const base = path.join(repoRoot, 'node_modules', 'electron', 'dist')
  if (process.platform === 'win32') return path.join(base, 'electron.exe')
  if (process.platform === 'darwin') return path.join(base, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return path.join(base, 'electron')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = path.resolve(args.worktree)
  const desktopDir = path.join(repoRoot, 'apps/desktop')
  const electronBinary = electronExecutable(repoRoot)
  const profile = path.resolve(args.profile)

  if (!fs.existsSync(electronBinary)) {
    console.error('[launch-worktree] electron binary not found: ' + electronBinary)
    process.exit(1)
  }
  if (!fs.existsSync(desktopDir)) {
    console.error('[launch-worktree] desktop dir not found: ' + desktopDir)
    process.exit(1)
  }

  let buildElectronArgs
  let buildElectronEnv
  try {
    // eslint-disable-next-line global-require
    buildElectronArgs = require(path.join(desktopDir, 'scripts/dev-launcher.js')).buildElectronArgs
    // eslint-disable-next-line global-require
    buildElectronEnv = require(path.join(desktopDir, 'scripts/electron-runtime-env.js')).buildElectronEnv
  } catch (e) {
    console.error('[launch-worktree] failed to load dev-launcher: ' + (e && e.message ? e.message : String(e)))
    process.exit(1)
  }

  const electronArgs = buildElectronArgs({
    electronUserDataDir: profile,
    electronCacheDir: path.join(profile, 'cache'),
    desktopDir,
    // CDP 端口走 buildElectronArgs（默认 9222），避免 splice 产生双 --remote-debugging-port
    cdpPort: args.cdp,
  })

  const child = spawn(electronBinary, electronArgs, {
    cwd: desktopDir,
    stdio: 'inherit',
    shell: false,
    // 与 apps/desktop/scripts/dev.js 同源：剔除 ELECTRON_RUN_AS_NODE，
    // 否则 Electron 退化为纯 Node，Chromium 开关全部 "bad option"（应用无窗口）。
    env: buildElectronEnv(process.env, {
      ...loadEnvFile(args.envFile),
      ELECTRON_USER_DATA_DIR: profile,
      CALLBACK_SERVER_PORT: args.callbackPort,
      BACKEND_PORT: args.backendPort,
      PROMPT_PORT: args.promptPort,
      SPLITTER_PORT: args.splitterPort,
      DEV_SERVER_PORT: args.devServerPort,
    }),
  })

  child.on('spawn', () => console.log('[launch-worktree] electron spawned pid=' + child.pid + ' worktree=' + repoRoot + ' profile=' + profile))
  child.on('exit', (code, signal) => {
    console.log('[launch-worktree] electron exited code=' + code + ' signal=' + signal)
    process.exit(code ?? 0)
  })
  child.on('error', (err) => {
    console.error('[launch-worktree] electron error: ' + err.message)
    process.exit(1)
  })
}

main()
