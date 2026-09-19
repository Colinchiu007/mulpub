// @ts-check
/**
 * ASR 依赖安装服务 — faster-whisper 缺失时的自动安装引导
 *
 * 触发场景：视频采集报 -6（语音转写引擎不可用）时，渲染进程弹出安装引导弹窗，
 * 用户确认后经 IPC 调用本服务执行 pip 安装 + 模型下载，进度经 webContents.send 实时推送。
 *
 * 安装策略（2026-09-19）：
 * - pip 源：清华镜像优先，失败自动换阿里源、腾讯源，最后回退官方 PyPI
 * - 模型下载：Python 侧 asr_engine 已内置 hf-mirror.com 优先 + huggingface.co 备用
 * - 安装目标：应用当前绑定的 MP_PYTHON 解释器（与后端一致，避免装错环境）
 * - 进度事件：asr-install:progress（stage/percent/detail），渲染进程订阅展示
 */

const { spawn } = require('child_process')

/** pip 镜像源优先级列表（国内用户友好 + 备用自动切换） */
const PIP_INDEX_URLS = [
  'https://pypi.tuna.tsinghua.edu.cn/simple',
  'https://mirrors.aliyun.com/pypi/simple/',
  'https://mirrors.cloud.tencent.com/pypi/simple',
  'https://pypi.org/simple',
]

/**
 * @param {string} pythonCmd
 * @param {string[]} args
 * @param {(line: string) => void} onStdout
 * @param {(line: string) => void} onStderr
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runPip (pythonCmd, args, onStdout, onStderr) {
  return new Promise((resolve) => {
    const proc = spawn(pythonCmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      const text = d.toString()
      stdout += text
      text.split('\n').filter(Boolean).forEach(onStdout)
    })
    proc.stderr.on('data', (d) => {
      const text = d.toString()
      stderr += text
      text.split('\n').filter(Boolean).forEach(onStderr)
    })
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    proc.on('error', (err) => {
      onStderr(String(err && err.message ? err.message : err))
      resolve({ code: -1, stdout, stderr: stderr + String(err) })
    })
  })
}

/**
 * 安装 faster-whisper（多镜像自动切换）
 * @param {{
 *   pythonCmd?: string,
 *   sendProgress?: (event: { stage: string, percent?: number, detail?: string }) => void,
 *   log?: { info: Function, warn: Function, error: Function }
 * }} opts
 * @returns {Promise<{ code: number, message: string, indexUsed?: string }>}
 */
async function installFasterWhisper (opts = {}) {
  const pythonCmd = opts.pythonCmd || process.env.MP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const sendProgress = opts.sendProgress || (() => {})
  const logger = opts.log || { info: () => {}, warn: () => {}, error: () => {} }

  sendProgress({ stage: 'checking', detail: '检查 Python 环境...' })
  const versionCheck = await runPip(pythonCmd, ['-c', 'import sys; print(sys.version)'], () => {}, () => {})
  if (versionCheck.code !== 0) {
    return { code: -1, message: 'Python 环境不可用，请确认已安装 Python 3.10+ 并加入 PATH' }
  }

  for (let i = 0; i < PIP_INDEX_URLS.length; i++) {
    const indexUrl = PIP_INDEX_URLS[i]
    const source = i === PIP_INDEX_URLS.length - 1 ? '官方 PyPI' : `镜像源 ${i + 1}（${new URL(indexUrl).hostname}）`
    sendProgress({ stage: 'installing', percent: 5, detail: `正在通过${source}安装 faster-whisper（约 500MB 依赖）...` })
    logger.info('[asr-installer] trying index:', indexUrl)

    const result = await runPip(
      pythonCmd,
      ['-m', 'pip', 'install', '--quiet', '--no-warn-script-location', '-i', indexUrl, 'faster-whisper'],
      (line) => {
        // pip 进度行如 "Downloading ctranslate2-...whl (xxx MB)" — 提取百分比不可行，推送阶段信息
        if (line.includes('Downloading') || line.includes('Installing')) {
          sendProgress({ stage: 'installing', percent: 10, detail: line.slice(0, 120) })
        }
      },
      (line) => { if (line) sendProgress({ stage: 'installing', detail: line.slice(0, 120) }) }
    )

    if (result.code === 0) {
      // 验证安装成功
      const verify = await runPip(pythonCmd, ['-c', 'import faster_whisper; print("ok")'], () => {}, () => {})
      if (verify.code === 0 && verify.stdout.includes('ok')) {
        sendProgress({ stage: 'installed', percent: 100, detail: 'faster-whisper 安装成功' })
        return { code: 0, message: '安装成功', indexUsed: indexUrl }
      }
    }
    logger.warn('[asr-installer] index failed:', indexUrl, 'code:', result.code)
    sendProgress({ stage: 'switching', detail: `${source}安装失败，切换下一个下载源...` })
  }

  sendProgress({ stage: 'failed', detail: '全部下载源安装失败，请检查网络后重试' })
  return { code: -1, message: '全部 pip 镜像源安装失败，请检查网络连接或手动执行: pip install faster-whisper' }
}

/**
 * 预下载 ASR 模型（调用 Python 侧 ensure_model，走 hf-mirror 镜像）
 * @param {{
 *   pythonCmd?: string,
 *   sendProgress?: (event: { stage: string, percent?: number, detail?: string }) => void,
 *   log?: { info: Function, warn: Function, error: Function }
 * }} opts
 * @returns {Promise<{ code: number, message: string }>}
 */
async function downloadAsrModel (opts = {}) {
  const pythonCmd = opts.pythonCmd || process.env.MP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const sendProgress = opts.sendProgress || (() => {})
  const logger = opts.log || { info: () => {}, warn: () => {}, error: () => {} }

  sendProgress({ stage: 'model-checking', detail: '检查语音模型缓存...' })
  // Python 单行脚本：预检模型 → 未缓存则下载（asr_engine 内置 hf-mirror 镜像选择）
  const backendDir = require('./path-utils').getPythonBackendDir()
  const pyScript = [
    'import sys, json',
    `sys.path.insert(0, r'${backendDir.replace(/\\/g, '/')}')`,
    'from multi_publish.aggregation.asr_engine import get_asr_engine',
    'engine = get_asr_engine()',
    'if not engine.is_available():',
    '    print(json.dumps({"code": -6, "message": "faster-whisper 未安装"}))',
    'else:',
    '    try:',
    '        engine.ensure_model()',
    '        print(json.dumps({"code": 0, "message": "ok"}))',
    '    except Exception as e:',
    '        print(json.dumps({"code": -7, "message": str(e)[:300]}))',
  ].join('\n')

  sendProgress({ stage: 'model-downloading', percent: 30, detail: '正在下载语音模型（约 141MB，国内镜像加速）...' })
  const result = await runPip(pythonCmd, ['-c', pyScript], (line) => {
    if (line.includes('"code": 0')) {
      sendProgress({ stage: 'model-downloaded', percent: 100, detail: '模型下载完成' })
    }
  }, (line) => {
    if (line.includes('下载') || line.includes('download')) {
      sendProgress({ stage: 'model-downloading', detail: line.slice(0, 150) })
    }
  })

  try {
    const lastJson = result.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop()
    if (lastJson) {
      const parsed = JSON.parse(lastJson)
      if (parsed.code === 0) {
        sendProgress({ stage: 'done', percent: 100, detail: '全部组件就绪' })
        return { code: 0, message: '模型就绪' }
      }
      return { code: parsed.code, message: parsed.message || '模型下载失败' }
    }
  } catch (e) {
    logger.error('[asr-installer] model download parse error:', e && e.message)
  }
  return { code: -1, message: '模型下载失败，请检查网络后重试' }
}

module.exports = { installFasterWhisper, downloadAsrModel, PIP_INDEX_URLS }
