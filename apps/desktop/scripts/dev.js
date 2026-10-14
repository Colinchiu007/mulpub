const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { buildElectronArgs, resolveUserDataDir, resolveAllowAllOrigins, resolveNoSandbox, resolveSoftwareGpu } = require('./dev-launcher');
const { resolveDevPorts } = require('./dev-ports');
const { appendDevExitLog } = require('./dev-exit-log');
const { buildElectronEnv } = require('./electron-runtime-env');
const { ensureFreshViteDepCache } = require('./vite-dep-cache');

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

// Vite optimizeDeps 预构建缓存过期预检（2026-10-13 事故收口）：workspace 源码变化
// （checkout/rebase/合并）不会触发 optimizeDeps 重建，旧缓存缺新导出时渲染层报
// "does not provide an export named 'X'"。stale 即清 node_modules/.vite，
// Vite 启动时自动重新 optimize。判据与边界见 vite-dep-cache.js 头注。
// MP_VITE_DEPS_CACHE_CHECK=0 可跳过（仅排障；跳过即失去该保护，须自行承担复发风险）。
if (process.env.MP_VITE_DEPS_CACHE_CHECK === '0') {
  console.log('[dev] vite deps cache check skipped (MP_VITE_DEPS_CACHE_CHECK=0)');
} else {
  const depsCache = ensureFreshViteDepCache(repoRoot);
  // 判出 stale 却清不掉（占用/权限）：继续启动必然复现缺导出报错，fail closed 并给出唯一修复动作
  if (depsCache.state === 'stale' && !depsCache.cleared) {
    console.error(`[dev] Vite 依赖缓存过期且清除失败：${depsCache.clearError} — 请手动删除 ${depsCache.viteDir} 后重试`);
    process.exit(1);
  }
}

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
      const allowAllOrigins = resolveAllowAllOrigins(process.env);
      const electronArgs = buildElectronArgs({ electronUserDataDir, electronCacheDir, desktopDir, cdpPort, allowAllOrigins, noSandbox: resolveNoSandbox(), softwareGpu: resolveSoftwareGpu() });
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
          // #2459：bridge 侧端口必须一并下发。不下发时 app-config.js 一律回落到
          // 8299/8013/8002/8004/16521 这组共享默认值，并发 worktree 的第二个实例
          // 后端 uvicorn bind 失败（10048）而健康检查被**第一个实例的后端**应答，
          // 于是表现为"起来了"但请求实际路由到别人的数据目录。
          // resolveDevPorts 已让显式环境变量优先于派生值，所以这里回写是幂等的。
          BACKEND_PORT: String(devPorts.backend),
          PROMPT_PORT: String(devPorts.prompt),
          SPLITTER_PORT: String(devPorts.splitter),
          ALIGNER_PORT: String(devPorts.aligner),
          CALLBACK_SERVER_PORT: String(devPorts.callback),
        }),
      });
      electron.on('spawn', () => {
        console.log(`[dev] electron userData: ${electronUserDataDir}`);
        if (allowAllOrigins) {
          console.log('[dev] CDP --remote-allow-origins=* ENABLED (MP_CDP_ALLOW_ALL_ORIGINS=1, dev only)');
        }
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
