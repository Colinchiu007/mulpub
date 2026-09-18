// @ts-check
/**
 * RenderEngine — Electron 主进程模块
 * 管理 Remotion 子进程：启动、进度解析、取消
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CompositionManager } = require('./composition-manager');
const { getComposerDir } = require('./path-utils');
const log = require('./logger');

const COMPOSER_DIR = getComposerDir();
const QUICK_RENDER_DIR = path.join(os.tmpdir(), 'story2video', 'quick-render');

/**
 * 解析 Remotion CLI 渲染进度文本，返回 { percent, stage } 或 null。
 *
 * Remotion CLI 实际输出的进度格式（@remotion/cli/dist/progress-bar.js）：
 *   - getGuiProgressSubtitle → "Rendered 45/900"（无 "frame" 字样）
 *   - makeRenderingProgress   → "Rendered frames 45/900"（复数 "frames"，带 ANSI 颜色码）
 *   - 拼接阶段                → "Encoded 45/900"
 *   - 渲染阶段                → "Rendering frames 45/900"
 *
 * 旧实现用 /Rendered frame (\d+)\/(\d+)/ 匹配单数 "frame"，与 Remotion 实际
 * 输出（无 "frame" 或复数 "frames"）永远不匹配，导致进度条一直停在 0%。
 * 本函数剥离 ANSI 转义码后同时兼容两种格式，并处理 total=0 除零边界。
 *
 * @param {string} text 单块输出文本
 * @returns {{ percent: number, stage: string } | null}
 */
function parseRenderProgress(text) {
  if (typeof text !== 'string' || !text) return null;
  // 剥离 ANSI 转义码（Remotion 输出带颜色/光标控制码）
  const ESC = String.fromCharCode(27); // ESC 0x1b
  const clean = text
    .replace(new RegExp(ESC + '\\[[0-9;]*[A-Za-z]', 'g'), '')
    .replace(new RegExp(ESC + '\\][^' + ESC + ']*' + ESC, 'g'), '');
  // 兼容 "Rendered 45/900"、"Rendered frames 45/900"、"Rendering frames 45/900"
  const match = /(?:Rendered|Rendering)(?: frames?)?\s+(\d+)\/(\d+)/.exec(clean);
  if (match) {
    const done = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { percent, stage: '渲染中' };
  }
  // 拼接阶段 "Encoded 45/900"
  const encoded = /Encoded\s+(\d+)\/(\d+)/.exec(clean);
  if (encoded) {
    const done = parseInt(encoded[1], 10);
    const total = parseInt(encoded[2], 10);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { percent, stage: '编码中' };
  }
  return null;
}

function getDefaultOutputPath(timestamp = Date.now()) {
  return path.join(QUICK_RENDER_DIR, `remotion_${timestamp}.mp4`);
}

function resolveRemotionCli(composerDir = COMPOSER_DIR, resolveModule = require.resolve, readFile = fs.readFileSync) {
  const cliPackageJson = resolveModule('@remotion/cli/package.json', { paths: [composerDir] });
  const remotionPackageJson = resolveModule('remotion/package.json', { paths: [composerDir] });
  const cliManifest = JSON.parse(readFile(cliPackageJson, 'utf8'));
  const cliEntry = cliManifest.bin && cliManifest.bin.remotion;
  if (typeof cliEntry !== 'string' || !cliEntry) throw new Error('Remotion CLI 未声明 remotion 命令入口');
  return {
    cliPath: path.resolve(path.dirname(cliPackageJson), cliEntry),
    remotionPackageJson,
  };
}

const MEDIA_PROFILES = {
  'youtube-landscape': { width: 1920, height: 1080, fps: 30 },
  'youtube-4k': { width: 3840, height: 2160, fps: 30 },
  'youtube-shorts': { width: 1080, height: 1920, fps: 30 },
  'tiktok': { width: 1080, height: 1920, fps: 30 },
  'instagram-reels': { width: 1080, height: 1920, fps: 30 },
  'wechat': { width: 1080, height: 1920, fps: 30 },
  'bilibili': { width: 1920, height: 1080, fps: 30 },
  'xiaohongshu': { width: 1080, height: 1440, fps: 30 },
  'generic-hd': { width: 1920, height: 1080, fps: 30 },
};

class RenderEngine {
  constructor() {
    this._currentProcess = null;
    this._canceled = false;
    this._compositionManager = new CompositionManager();
  }

  getStatus() {
    const composerExists = fs.existsSync(path.join(COMPOSER_DIR, 'package.json'));
    let nodeModulesExist = false;
    try {
      resolveRemotionCli();
      nodeModulesExist = true;
    } catch (_) { /* Renderer status reports missing dependencies below. */ }
    return { ready: composerExists && nodeModulesExist, composerExists, nodeModulesExist, composerDir: COMPOSER_DIR };
  }

  async installDeps(onProgress) {
    return new Promise((resolve) => {
      const child = spawn('npm', ['install'], { cwd: COMPOSER_DIR, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      // 安全修复：保存到 _currentProcess 使 cancel() 能 kill（原未保存导致 installDeps 挂起时无法取消）
      this._currentProcess = child
      // 5 分钟超时保护（防止 npm install 挂起导致 Promise 永久 pending）
      const installTimer = setTimeout(() => {
        try { child.kill() } catch (_) { /* ignore */ }
        resolve({ success: false, error: 'npm install timed out (5min)' })
      }, 5 * 60 * 1000)
      // R28 修复：unref 让定时器不阻止进程退出
      if (installTimer && installTimer.unref) installTimer.unref()
      child.stdout.on('data', (d) => { if (onProgress) onProgress(d.toString()); });
      child.stderr.on('data', (d) => { if (onProgress) onProgress(d.toString()); });
      child.on('close', (code) => { clearTimeout(installTimer); resolve(code === 0 ? { success: true } : { success: false, error: `npm install exited with code ${code}` }); });
      child.on('error', (err) => { clearTimeout(installTimer); resolve({ success: false, error: err.message }); });
    });
  }

  /** 获取 Composition 列表 */
  listCompositions() {
    return this._compositionManager.listCompositions();
  }

  /** 获取单个 Composition 详情 */
  getComposition(id) {
    return this._compositionManager.getComposition(id);
  }

  /** 校验 props */
  validateProps(compositionId, props) {
    return this._compositionManager.validateProps(compositionId, props);
  }

  render(props, options = {}) {
    return new Promise((resolve) => {
      const { composition = 'Explainer', outputPath = getDefaultOutputPath(), onProgress = () => {}, profile } = options;

      if (!props || !Array.isArray(props.cuts) || props.cuts.length === 0) { resolve({ success: false, error: 'Props must contain cuts array' }); return; }
      for (const [i, cut] of props.cuts.entries()) {
        if (!cut.id) { resolve({ success: false, error: `cuts[${i}].id missing` }); return; }
        if (typeof cut.in_seconds !== 'number' || cut.in_seconds < 0) { resolve({ success: false, error: `cuts[${i}].in_seconds invalid` }); return; }
        if (typeof cut.out_seconds !== 'number' || cut.out_seconds <= cut.in_seconds) { resolve({ success: false, error: `cuts[${i}].out_seconds > in_seconds` }); return; }
      }

      this._canceled = false;

      let propsPath;
      try {
        fs.mkdirSync(QUICK_RENDER_DIR, { recursive: true });
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        propsPath = path.join(QUICK_RENDER_DIR, `.remotion_props_${Date.now()}.json`);
        fs.writeFileSync(propsPath, JSON.stringify(props), 'utf-8');
      } catch (error) {
        resolve({ success: false, error: `无法准备渲染输出目录: ${error.message}` });
        return;
      }

      let command;
      try {
        command = resolveRemotionCli();
      } catch (error) {
        this._cleanup(propsPath);
        resolve({ success: false, error: 'Remotion 渲染引擎未就绪: ' + error.message });
        return;
      }
      const cmd = [command.cliPath, 'render', 'src/index.tsx', composition, outputPath, `--props=${propsPath}`];
      if (profile && MEDIA_PROFILES[profile]) { const p = MEDIA_PROFILES[profile]; cmd.push('--width', String(p.width), '--height', String(p.height), '--fps', String(p.fps)); }

      const child = spawn(process.execPath, cmd, {
        cwd: COMPOSER_DIR,
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this._currentProcess = child;

      // eslint-disable-next-line no-unused-vars
      let stdout = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;

        // 解析进度: Remotion 实际输出 "Rendered 45/900" / "Rendered frames 45/900"
        const parsed = parseRenderProgress(text);
        if (parsed) {
          onProgress(parsed.percent, parsed.stage);
        }

        // 解析渲染阶段
        if (text.includes('Computed')) {
          onProgress(0, '计算中');
        } else if (text.includes('Starting')) {
          onProgress(0, '启动渲染');
        } else if (text.includes('Encoding')) {
          onProgress(99, '编码中');
        }
      });

      // logging-coverage-audit：收集 stderr 尾部，失败时进日志（此前完全丢弃）
      const stderrTail = [];
      child.stderr.on('data', (data) => {
        // Remotion 可能在 stderr 输出进度
        const text = data.toString();
        stderrTail.push(text);
        if (stderrTail.length > 20) stderrTail.shift();
        const parsed = parseRenderProgress(text);
        if (parsed) {
          onProgress(parsed.percent, parsed.stage);
        }
      });

      child.on('close', (code) => {
        this._currentProcess = null;
        this._cleanup(propsPath);

        if (this._canceled) {
          resolve({ success: false, error: '渲染已取消' });
          return;
        }

        if (code !== 0) {
          const stderrText = stderrTail.join('').trim();
          log.error('RenderEngine', 'render failed exitCode=' + code + ' stderr_tail=' + String(stderrText).slice(-1500));
          resolve({ success: false, error: `渲染进程退出码: ${code}` });
          return;
        }

        if (!fs.existsSync(outputPath)) {
          resolve({ success: false, error: '渲染完成但未找到输出文件' });
          return;
        }

        resolve({ success: true, outputPath });
      });

      child.on('error', (err) => {
        this._currentProcess = null;
        this._cleanup(propsPath);
        resolve({ success: false, error: `启动渲染失败: ${err.message}` });
      });
    });
  }

  /** 取消当前渲染 */
  cancel() {
    if (this._currentProcess) {
      this._canceled = true;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(this._currentProcess.pid), '/F', '/T']);
      } else {
        this._currentProcess.kill('SIGTERM');
      }
      this._currentProcess = null;
    }
  }

  _cleanup(propsPath) {
    try { fs.unlinkSync(propsPath); } catch { /* ignore */ }
  }
}

RenderEngine.getDefaultOutputPath = getDefaultOutputPath;
RenderEngine.QUICK_RENDER_DIR = QUICK_RENDER_DIR;
RenderEngine.resolveRemotionCli = resolveRemotionCli;
RenderEngine.parseRenderProgress = parseRenderProgress;

module.exports = RenderEngine
