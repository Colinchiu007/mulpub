const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { buildElectronArgs, resolveUserDataDir } = require('./dev-launcher');
const { resolveDevPorts } = require('./dev-ports');
const { appendDevExitLog } = require('./dev-exit-log');
const { buildElectronEnv } = require('./electron-runtime-env');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
// worktree 独立端口：mp-worktrees 下按路径稳定派生，杜绝并发 worktree 互抢同一端口
const devPorts = resolveDevPorts(repoRoot);
const vitePort = devPorts.vite;
const cdpPort = devPorts.cdp;
const viteUrl = `http://127.0.0.1:${vitePort}`;
// 默认固定 D 盘 profile（登录态/模型 key 持久化在同一 userData）；并发会话隔离请显式设 ELECTRON_USER_DATA_DIR
const electronUserDataDir = resolveUserDataDir();
const electronCacheDir = path.join(electronUserDataDir, 'cache');

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    cwd: desktopDir,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
}

function spawnNodeScript(scriptPath, args = []) {
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd: desktopDir,
    stdio: 'inherit',
    shell: false,
  });
}

const viteScript = path.resolve(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronScript = path.resolve(repoRoot, 'node_modules', 'electron', 'cli.js');
const electronBinary = path.resolve(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');

console.log(`[dev] ports: vite=${vitePort} cdp=${cdpPort} derived=${devPorts.derived}`);
const vite = spawnNodeScript(viteScript, ['--host', '0.0.0.0', '--port', String(vitePort), '--strictPort']);

let electron = null;
let stopping = false;
let viteExit = null;
let electronExit = null;

/** 记录子进程退出（供 stop 时留痕） */
function noteExit(kind, code, signal) {
  const state = { code, signal }
  if (kind === 'vite') viteExit = state
  else electronExit = state
  appendDevExitLog({
    event: kind + '-exit',
    pid: kind === 'vite' ? (vite && vite.pid) : (electron && electron.pid),
    exitCode: code,
    signal,
  })
}

/**
 * 统一停止：kill 双方并记录退出原因到固定日志（并发互杀/外部终止可立即定位）。
 * @param {number} code
 * @param {string} [reason] 触发源，如 vite-exit / electron-exit / SIGTERM / wait-vite-timeout
 */
function stop(code, reason = 'stop-called') {
  if (stopping) return;
  stopping = true;
  appendDevExitLog({
    event: 'stop',
    pid: process.pid,
    exitCode: code,
    extra: JSON.stringify({ reason, userData: electronUserDataDir, viteExit, electronExit }),
  })
  if (electron && !electron.killed) {
    appendDevExitLog({ event: 'kill', pid: electron.pid, extra: 'electron' })
    electron.kill();
  }
  if (vite && !vite.killed) {
    appendDevExitLog({ event: 'kill', pid: vite.pid, extra: 'vite' })
    vite.kill();
  }
  process.exitCode = code;
}

vite.on('exit', (code, signal) => {
  noteExit('vite', code, signal);
  if (code !== 0) console.error(`[dev] vite exited code=${code} signal=${signal}（端口 ${vitePort} 可能被占用/冲突；可用 MP_VITE_PORT 显式换端口）`);
  stop(code ?? 1, 'vite-exit');
});
vite.on('error', (error) => {
  console.error('[dev] vite failed to start:', error);
  stop(1, 'vite-error');
});

function waitForVite(remainingMs) {
  if (stopping) return;
  if (remainingMs <= 0) {
    console.error('[dev] timed out waiting for vite:', viteUrl);
    stop(1, 'wait-vite-timeout');
    return;
  }
  const req = http.get(viteUrl, (res) => {
    res.resume();
    if (res.statusCode && res.statusCode < 500) {
      if (stopping) return;
      const electronCommand = process.platform === 'win32' ? electronBinary : process.execPath;
      const electronArgs = buildElectronArgs({ electronUserDataDir, electronCacheDir, desktopDir, cdpPort });
      const electronSpawnArgs = process.platform === 'win32' ? electronArgs : [electronScript, ...electronArgs];
      electron = spawn(electronCommand, electronSpawnArgs, {
        cwd: desktopDir,
        stdio: 'inherit',
        shell: false,
        // 必须剔除 ELECTRON_RUN_AS_NODE：否则 Electron 退化为纯 Node，
        // 所有 Chromium 开关（--user-data-dir/--remote-debugging-port/...）被拒为
        // "bad option"，表现为「Vite 正常、窗口永不出现」。
        env: buildElectronEnv(process.env, {
          ELECTRON_USER_DATA_DIR: electronUserDataDir,
          // 主进程按该端口加载 renderer + IPC 来源校验，避免回退到 5174 连到别的 worktree
          DEV_SERVER_PORT: String(vitePort),
        }),
      });
      electron.on('spawn', () => {
        console.log(`[dev] electron userData: ${electronUserDataDir}`);
      });
      electron.on('exit', (code, signal) => { noteExit('electron', code, signal); stop(code ?? 0, 'electron-exit'); });
      electron.on('error', (error) => {
        console.error('[dev] electron failed to start:', error);
        stop(1, 'electron-error');
      });
      return;
    }
    setTimeout(() => waitForVite(remainingMs - 250), 250);
  });
  req.on('error', () => {
    setTimeout(() => waitForVite(remainingMs - 250), 250);
  });
  req.setTimeout(1000, () => {
    req.destroy();
    setTimeout(() => waitForVite(remainingMs - 250), 250);
  });
}

setTimeout(() => waitForVite(120000), 250);

process.on('SIGINT', () => stop(0, 'SIGINT'));
process.on('SIGTERM', () => stop(0, 'SIGTERM'));
