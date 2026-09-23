// @ts-check
/**
 * AlignerBridge — audio-aligner Python 子进程管理（ASR 词级时间，端口 8004）
 *
 * 对齐层编排：/align 取词级时间 → story2video-engine subtitle-aligner 聚合到分句块。
 * 继承 BasePythonBridge：start/stop/attach/healthCheck/watchdog/restart 由基类提供。
 */
const path = require('path')
const os = require('os')
const { BasePythonBridge } = require('./base-python-bridge')
const { config } = require('../config/app-config')

const ALIGNER_PORT = config.alignerBridge.port
const ALIGNER_HOST = config.alignerBridge.host
// Stage -1 附项：移除硬编码开发机绝对路径，仅保留环境变量 + 打包相对路径
const ALIGNER_DIR = process.env.ALIGNER_DIR || (() => {
  const path = require('path')
  return path.join(__dirname, '..', '..', '..', 'packages', 'audio-aligner')
})()

/**
 * audio-aligner 的音频目录白名单（体检报告 P2 安全小项：audio_path 无目录约束）。
 *
 * Python 侧默认只信系统临时目录（fail-closed），桌面端把真实落盘位置显式告诉它：
 *  - os.tmpdir()：AssetGenerator 的 TTS 产物默认根目录（<tmp>/story2video/assets/...）
 *  - userData：语音克隆样本等跨会话持久文件
 * 外部已设置 AUDIO_ALIGNER_ALLOWED_DIRS 时视为追加项，不静默丢弃部署方的配置。
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string} 以 path.delimiter 连接的允许目录
 */
function resolveAllowedAudioDirs (env = process.env) {
  const extra = String(env.AUDIO_ALIGNER_ALLOWED_DIRS || '').split(path.delimiter).filter(Boolean)
  return [os.tmpdir(), _userDataDir(), ...extra].filter(Boolean).join(path.delimiter)
}

/** 取 userData；纯 Node 单测下 require('electron') 返回的是路径字符串，app 不存在 ⇒ 退化为空 */
function _userDataDir () {
  try {
    const { app } = require('electron')
    return app && typeof app.getPath === 'function' ? app.getPath('userData') : ''
  } catch (_) {
    return ''
  }
}

/** aligner Python 包是否可用（存在 aligner/ 模块）——不可用时对齐服务 fail-fast 跳过，不 spawn */
function isAlignerAvailable () {
  const fs = require('fs')
  try { return fs.existsSync(ALIGNER_DIR + '/aligner') } catch (_) { return false }
}

class AlignerBridge extends BasePythonBridge {
  /**
   * @param {{ log?: any }} opts
   */
  constructor ({ log } = {}) {
    super({
      name: 'AlignerBridge',
      pythonModule: 'aligner',
      port: ALIGNER_PORT,
      host: ALIGNER_HOST,
      workDir: ALIGNER_DIR,
      log,
      requestTimeout: 300000, // ASR base 模型 CPU 单场景 <30s，留 5min 余量
    })
  }

  /**
   * 告诉子进程「哪些目录里的音频才允许被转写」——不注入则 Python 侧只认系统临时目录。
   * @returns {Record<string, string>}
   */
  _spawnEnv () {
    return { AUDIO_ALIGNER_ALLOWED_DIRS: resolveAllowedAudioDirs() }
  }

  /**
   * 音频 → ASR 词级时间
   * @param {string} audioPath - 音频绝对路径
   * @param {object} [options] - { model, language, beamSize, vadFilter, initialPrompt }
   * @returns {Promise<object>} { words, segments, language, duration, elapsedMs, model }
   */
  async transcribeAudio (audioPath, options = {}) {
    await this.ensureRunning()
    // traceId 是控制字段：提取后不进业务 payload，仅用于 X-Request-Id 头
    const { traceId, ...rest } = options || {}
    const body = JSON.stringify({
      audio_path: audioPath,
      options: {
        model: rest.model || 'base',
        language: rest.language || undefined,
        beam_size: rest.beamSize ?? 5,
        vad_filter: rest.vadFilter ?? true,
        initial_prompt: rest.initialPrompt || undefined,
      },
    })
    return this._post('/align', body, undefined, traceId)
  }
}

module.exports = AlignerBridge
module.exports.isAlignerAvailable = isAlignerAvailable
module.exports.ALIGNER_DIR = ALIGNER_DIR
module.exports.resolveAllowedAudioDirs = resolveAllowedAudioDirs
