// @ts-check
/**
 * hifly-create-modes.js — 飞影「创作模式」端点（prototype mixin）
 *
 * change: hifly-full-api。从 hifly.js 拆出（该文件已 467 行，max-lines 硬线 500）：
 *   Object.assign(HiFlyAdapter.prototype, require('./hifly-create-modes').createModeMethods)
 *
 * 覆盖 6 个收费创作端点（官方全部标注「此接口会产生积分消耗」）：
 *   POST /video/create_by_audio     视频创作（声音驱动）
 *   POST /video/create_by_template  视频创作（网感模板）
 *   POST /video/translate           视频翻译
 *   POST /video/create_by_sing      视频创作（唱歌）
 *   POST /video/create_by_image     视频创作（图片驱动）
 *   POST /audio/create_by_tts       音频创作
 *
 * 共同点：成功响应都只给 `task_id`，随后用 GET /video/task 轮询
 * （**音频创作也是**——官方「查询创作任务状态」注明它接受视频创作、视频翻译、
 * 唱歌视频或图片驱动视频接口返回的 task_id，音频创作复用同一查询）。
 *
 * 计费提醒：这 6 个都会花钱。adapter 不做「预检余额再放行」——
 * 那会让每次生成多一次往返，且余额可能被并发任务吃掉；
 * 余额不足由服务端拒、由 UI 在提交前提示（见 PRD 的「提交前提示」一节）。
 */

const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

/** 作品名称上限（官方：不超过 20 个字）。 */
const MAX_TITLE_LENGTH = 20
/** 文案上限（官方：不超过 10000 字，不支持 html 标签）。 */
const MAX_TEXT_LENGTH = 10000
/** file_id 字符长度上限（官方对 bgm/ambience/cover 明确「不超过 500」）。 */
const MAX_FILE_ID_LENGTH = 500
/** AIGC 水印开关（官方：0 跟随个人中心 / 1 开启 / 2 关闭）。 */
const AIGC_FLAGS = Object.freeze([0, 1, 2])
/** 图片驱动的视频生成模型（官方：5 即 4.0、6 即 4.0 卡通；0 或不传默认 5）。 */
const IMAGE_DRIVE_MODELS = Object.freeze([0, 5, 6])

/** 读一个可选的 trim 后字符串。 */
function optionalString (value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** 校验必填字符串。 */
function requireString (value, field) {
  const s = optionalString(value)
  if (!s) {
    throw new ProviderError(ERROR_CODES.INVALID_CONFIG, `params.${field} is required`)
  }
  return s
}

/** 校验长度上限。 */
function assertMaxLength (value, max, field) {
  if (value.length > max) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `params.${field} must be at most ${max} characters (got ${value.length})`,
    )
  }
  return value
}

/** 校验 AIGC 开关。 */
function normalizeAigcFlag (value) {
  if (value === undefined || value === null || value === '') return undefined
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  if (!AIGC_FLAGS.includes(num)) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `params.aigcFlag must be one of ${AIGC_FLAGS.join('/')} (got ${String(value)})`,
    )
  }
  return num
}

/** 校验非负整数毫秒偏移。 */
function normalizeNonNegativeInt (value, field) {
  if (value === undefined || value === null || value === '') return undefined
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(num) || num < 0) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `params.${field} must be a non-negative integer (got ${String(value)})`,
    )
  }
  return num
}

/** 校验 0~100 的响度值（官方 norm_lufs 系列）。 */
function normalizeLufs (value, field) {
  if (value === undefined || value === null || value === '') return undefined
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `params.${field} must be between 0 and 100 (got ${String(value)})`,
    )
  }
  return num
}

/** 校验 file_id 形态（非空、≤500 字符）。 */
function normalizeFileId (value, field) {
  const s = optionalString(value)
  if (!s) return ''
  return assertMaxLength(s, MAX_FILE_ID_LENGTH, field)
}

/** 发创作请求并统一取 task_id。 */
async function submitCreate (adapter, path, body) {
  const resp = await adapter._request(path, { method: 'POST', body: JSON.stringify(body) })
  const decoded = await adapter._decode(resp)
  if (!decoded.ok) {
    throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: adapter.id })
  }
  const data = decoded.data || {}
  const taskId = data.task_id || data.taskId
  if (!taskId) {
    throw new ProviderError(
      ERROR_CODES.PROVIDER_ERROR,
      `飞影未返回 task_id（${path}）`,
      { providerId: adapter.id },
    )
  }
  return { taskId: String(taskId) }
}

const createModeMethods = {
  /**
   * 视频创作（声音驱动）— POST /video/create_by_audio。**收费**。
   *
   * 官方约束：
   *  - `audio_url` 与 `file_id` 二选一必填（mp3/m4a/wav，100M 以内，5 秒~30 分钟）；
   *  - `avatar` 与 `video_file_id` **至少填一个**（后者可驱动任意视频）；
   *  - `title` ≤20 字；`aigc_flag` ∈{0,1,2}；`video_start_msec` 从指定毫秒开始驱动。
   *
   * @returns {Promise<{taskId: string}>}
   */
  async createVideoByAudio (params = {}) {
    const audioUrl = optionalString(params.audioUrl)
    const fileId = normalizeFileId(params.fileId, 'fileId')
    if (!audioUrl && !fileId) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'params.audioUrl or params.fileId is required (at least one)',
      )
    }

    const avatar = optionalString(params.avatar)
    const videoFileId = normalizeFileId(params.videoFileId, 'videoFileId')
    if (!avatar && !videoFileId) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'params.avatar or params.videoFileId is required (at least one)',
      )
    }

    const body = {}
    if (audioUrl) body.audio_url = audioUrl
    if (fileId) body.file_id = fileId
    if (avatar) body.avatar = avatar
    if (videoFileId) body.video_file_id = videoFileId

    const title = optionalString(params.title)
    if (title) body.title = assertMaxLength(title, MAX_TITLE_LENGTH, 'title')
    const aigcFlag = normalizeAigcFlag(params.aigcFlag)
    if (aigcFlag !== undefined) body.aigc_flag = aigcFlag
    const videoStartMsec = normalizeNonNegativeInt(params.videoStartMsec, 'videoStartMsec')
    if (videoStartMsec !== undefined) body.video_start_msec = videoStartMsec

    return submitCreate(this, '/video/create_by_audio', body)
  },

  /**
   * 视频创作（网感模板）— POST /video/create_by_template。**收费**。
   *
   * 官方约束：
   *  - `template` 必填（来自 lively_templates）；
   *  - `text` 必填 ≤10000 字；
   *  - `voice`/`avatar` 在**不传** `video_file_id` 时必填；传了 video_file_id 可替代二者；
   *  - 4 个响度参数（norm/bgm/audioAssets/ambience）均 0~100，不传或 0 表示不指定；
   *  - `bgm_file_id`/`ambience_file_id`/`cover_file_id` ≤500 字符。
   *
   * @returns {Promise<{taskId: string}>}
   */
  async createVideoByTemplate (params = {}) {
    const template = requireString(params.template, 'template')
    const text = assertMaxLength(requireString(params.text, 'text'), MAX_TEXT_LENGTH, 'text')

    const videoFileId = normalizeFileId(params.videoFileId, 'videoFileId')
    const voice = optionalString(params.voice)
    const avatar = optionalString(params.avatar)
    if (!videoFileId && (!voice || !avatar)) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'params.voice and params.avatar are required unless params.videoFileId is given',
      )
    }

    const body = { template, text }
    if (voice) body.voice = voice
    if (avatar) body.avatar = avatar
    if (videoFileId) body.video_file_id = videoFileId

    const title = optionalString(params.title)
    if (title) body.title = assertMaxLength(title, MAX_TITLE_LENGTH, 'title')

    for (const [key, field] of [
      ['bgmFileId', 'bgmFileId'],
      ['ambienceFileId', 'ambienceFileId'],
      ['coverFileId', 'coverFileId'],
    ]) {
      const id = normalizeFileId(params[key], field)
      if (id) {
        body[{
          bgmFileId: 'bgm_file_id',
          ambienceFileId: 'ambience_file_id',
          coverFileId: 'cover_file_id',
        }[key]] = id
      }
    }

    for (const [key, field] of [
      ['normLufs', 'normLufs'],
      ['bgmNormLufs', 'bgmNormLufs'],
      ['audioAssetsNormLufs', 'audioAssetsNormLufs'],
      ['ambienceNormLufs', 'ambienceNormLufs'],
    ]) {
      const lufs = normalizeLufs(params[key], field)
      if (lufs !== undefined) {
        body[{
          normLufs: 'norm_lufs',
          bgmNormLufs: 'bgm_norm_lufs',
          audioAssetsNormLufs: 'audio_assets_norm_lufs',
          ambienceNormLufs: 'ambience_norm_lufs',
        }[key]] = lufs
      }
    }

    const aigcFlag = normalizeAigcFlag(params.aigcFlag)
    if (aigcFlag !== undefined) body.aigc_flag = aigcFlag

    return submitCreate(this, '/video/create_by_template', body)
  },

  /**
   * 视频翻译 — POST /video/translate。**收费**。
   *
   * 官方约束：`video_file_id` 必填（视频时长 ≤10 分钟）；`target_language_code` 必填
   * （如 en/ja/ko，以服务端支持为准）。
   *
   * 注意：翻译返回的任务**不能**用 DELETE /video/task 删除（官方明确排除）。
   *
   * @returns {Promise<{taskId: string}>}
   */
  async translateVideo (params = {}) {
    const videoFileId = normalizeFileId(params.videoFileId, 'videoFileId')
    if (!videoFileId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.videoFileId is required')
    }
    const targetLanguageCode = requireString(params.targetLanguageCode, 'targetLanguageCode')
    return submitCreate(this, '/video/translate', {
      video_file_id: videoFileId,
      target_language_code: targetLanguageCode,
    })
  },

  /**
   * 视频创作（唱歌）— POST /video/create_by_sing。**收费**。
   *
   * 官方约束：`image_file_id` 与 `audio_file_id` 都必填；
   * 音频时长 ≤60 秒。
   *
   * 注意：唱歌返回的任务**不能**用 DELETE /video/task 删除（官方明确排除）。
   *
   * @returns {Promise<{taskId: string}>}
   */
  async createVideoBySing (params = {}) {
    const imageFileId = normalizeFileId(params.imageFileId, 'imageFileId')
    if (!imageFileId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.imageFileId is required')
    }
    const audioFileId = normalizeFileId(params.audioFileId, 'audioFileId')
    if (!audioFileId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.audioFileId is required')
    }
    return submitCreate(this, '/video/create_by_sing', {
      image_file_id: imageFileId,
      audio_file_id: audioFileId,
    })
  },

  /**
   * 视频创作（图片驱动）— POST /video/create_by_image。**收费**。
   *
   * 官方约束：`image_file_id`/`voice`/`text` 都必填；`model` 只允许 0 / 5 / 6
   * （0 或不传默认 5，即模型 4.0；6 为 4.0 卡通）。
   *
   * 注意：图片驱动返回的任务**不能**用 DELETE /video/task 删除（官方明确排除）。
   *
   * @returns {Promise<{taskId: string}>}
   */
  async createVideoByImage (params = {}) {
    const imageFileId = normalizeFileId(params.imageFileId, 'imageFileId')
    if (!imageFileId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.imageFileId is required')
    }
    const voice = requireString(params.voice, 'voice')
    const text = assertMaxLength(requireString(params.text, 'text'), MAX_TEXT_LENGTH, 'text')

    const body = { image_file_id: imageFileId, voice, text }
    if (params.model !== undefined && params.model !== null && params.model !== '') {
      const num = typeof params.model === 'number' ? params.model : Number(String(params.model).trim())
      if (!IMAGE_DRIVE_MODELS.includes(num)) {
        throw new ProviderError(
          ERROR_CODES.INVALID_CONFIG,
          `params.model must be one of ${IMAGE_DRIVE_MODELS.join('/')} (got ${String(params.model)})`,
        )
      }
      body.model = num
    }
    return submitCreate(this, '/video/create_by_image', body)
  },

  /**
   * 音频创作 — POST /audio/create_by_tts。**收费**。
   *
   * 官方约束：`voice` 与 `text` 必填（text ≤10000 字）；`title` ≤20 字；`aigc_flag` ∈{0,1,2}。
   *
   * 注意：这是**音频**（不是视频），但任务同样用 GET /video/task 查询——
   * 官方「查询创作任务状态」的说明列了它接受四类 task_id，音频创作复用同一查询。
   *
   * @returns {Promise<{taskId: string}>}
   */
  async createAudioByTts (params = {}) {
    const voice = requireString(params.voice, 'voice')
    const text = assertMaxLength(requireString(params.text, 'text'), MAX_TEXT_LENGTH, 'text')
    const body = { voice, text }
    const title = optionalString(params.title)
    if (title) body.title = assertMaxLength(title, MAX_TITLE_LENGTH, 'title')
    const aigcFlag = normalizeAigcFlag(params.aigcFlag)
    if (aigcFlag !== undefined) body.aigc_flag = aigcFlag
    return submitCreate(this, '/audio/create_by_tts', body)
  },
}

module.exports = {
  createModeMethods,
  MAX_TITLE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_FILE_ID_LENGTH,
  AIGC_FLAGS,
  IMAGE_DRIVE_MODELS,
}
