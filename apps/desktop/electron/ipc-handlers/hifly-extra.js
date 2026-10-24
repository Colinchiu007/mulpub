/**
 * hifly-extra IPC — 飞影 11 个扩展端点的主进程入口。
 *
 * change: hifly-full-api-ui。上游能力在 `services/adapters/hifly-extra.js`
 * 与 `hifly-create-modes.js`（change: hifly-full-api），本文件只做
 * **形状校验 + 能力探测 + 统一错误信封**，业务范围校验留给 adapter。
 *
 * 分层理由：
 *  - IPC 层校验「形状」（字段在不在、类型对不对、长度是否明显越界）——
 *    形状错了根本不该进主进程深处；
 *  - adapter 层校验「业务范围」（如 size ≤ 200、model ∈ {0,5,6}）——
 *    那需要官方契约知识，放 adapter 才不会两处各写一份而漂移。
 *
 * 能力探测（关键）：上游 11 个方法只有 `hifly-full-api` 合并后才存在。
 * 在它合并之前，`supportsAdapterMethod` 返回 false ⇒ 本层统一回
 * `HIFLY_EXTRA_UNSUPPORTED`，UI 据此不显示入口（fail-closed）。
 * 这样 UI 可以先合，能力随后自动生效，不需要两边互相等。
 */

const { withSenderCheck, EC } = require('./helpers')

/** adapter id —— 本组端点目前只有飞影实现。 */
const PROVIDER_ID = 'hifly'

/** 白名单：通道名 → adapter 方法名。逐一列出，不做前缀拼接。 */
const CHANNEL_METHODS = Object.freeze({
  'hifly-extra:credit': 'getAccountCredit',
  'hifly-extra:lively-templates': 'listLivelyTemplates',
  'hifly-extra:cover-styles': 'listCoverStyles',
  'hifly-extra:create-cover': 'createCover',
  'hifly-extra:delete-work': 'deleteWork',
  'hifly-extra:create-by-audio': 'createVideoByAudio',
  'hifly-extra:create-by-template': 'createVideoByTemplate',
  'hifly-extra:translate': 'translateVideo',
  'hifly-extra:create-by-sing': 'createVideoBySing',
  'hifly-extra:create-by-image': 'createVideoByImage',
  'hifly-extra:audio-tts': 'createAudioByTts',
})

const MAX_TEXT_LENGTH = 10000
const MAX_TITLE_LENGTH = 20
const MAX_FILE_ID_LENGTH = 500

function invalidArguments () {
  return { code: EC.VALIDATION_ERROR, message: 'HIFLY_EXTRA_INVALID_ARGUMENTS' }
}

function logHandlerError (method, error) {
  try {
    console.warn('[hifly-extra] IPC 失败:', method, error && error.message)
  } catch (_) { /* 日志失败不影响返回 */ }
}

/** 安全标识符：非空、≤max、不含控制字符。 */
function isSafeString (value, maxLength = MAX_FILE_ID_LENGTH) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return false
  // 拒绝控制字符（不用正则：eslint 的 no-control-regex 禁止在正则里写控制字符区间）
  for (const ch of trimmed) { if (ch.charCodeAt(0) < 32) return false }
  return true
}

/** 可选字符串：未传返回 ''，传了但不合法返回 null（调用方判 null 即拒）。 */
function optionalString (value, maxLength = MAX_FILE_ID_LENGTH) {
  if (value === undefined || value === null || value === '') return ''
  return isSafeString(value, maxLength) ? value.trim() : null
}

/** 可选正整数（含 0）。 */
function optionalInt (value, min = 0) {
  if (value === undefined || value === null || value === '') return undefined
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isInteger(num) && num >= min ? num : null
}

/** 只允许这些键（拒绝未知字段，避免把前端拼错的字段静默丢掉）。 */
function hasOnlyAllowedKeys (args, allowed) {
  const keys = Object.keys(args)
  return keys.every((key) => allowed.includes(key))
}

// ── 各通道的形状归一 ────────────────────────────────────────────────────

function normalizeLivelyTemplates (args) {
  if (!hasOnlyAllowedKeys(args, ['template', 'tag', 'title', 'page', 'size', 'type'])) return null
  const out = {}
  for (const key of ['template', 'tag', 'title']) {
    const v = optionalString(args[key], 200)
    if (v === null) return null
    if (v) out[key] = v
  }
  for (const [key, min] of [['page', 1], ['size', 1], ['type', 0]]) {
    const v = optionalInt(args[key], min)
    if (v === null) return null
    if (v !== undefined) out[key] = v
  }
  return out
}

function normalizeCoverStyles (args) {
  if (!hasOnlyAllowedKeys(args, ['page', 'size'])) return null
  const out = {}
  for (const [key, min] of [['page', 1], ['size', 1]]) {
    const v = optionalInt(args[key], min)
    if (v === null) return null
    if (v !== undefined) out[key] = v
  }
  return out
}

function normalizeCreateCover (args) {
  if (!hasOnlyAllowedKeys(args, [
    'template', 'avatar', 'content', 'slots', 'canvasPreset', 'outputFormat',
  ])) return null
  if (!isSafeString(args.template, 200)) return null
  const out = { template: args.template.trim() }

  const avatar = optionalString(args.avatar, 200)
  if (avatar === null) return null
  if (avatar) out.avatar = avatar

  const content = optionalString(args.content, MAX_TEXT_LENGTH)
  if (content === null) return null
  if (content) out.content = content

  if (args.slots !== undefined) {
    if (!Array.isArray(args.slots)) return null
    // 元素必须是对象且 value 为字符串（官方 slots 结构：name/label/value/max_length/min_length）
    const slotsOk = args.slots.every((slot) => slot && typeof slot === 'object' &&
      !Array.isArray(slot) && typeof slot.value === 'string')
    if (!slotsOk) return null
    out.slots = args.slots
  }
  if (!out.content && !(out.slots && out.slots.length)) return null

  for (const key of ['canvasPreset', 'outputFormat']) {
    const v = optionalString(args[key], 20)
    if (v === null) return null
    if (v) out[key] = v
  }
  return out
}

function normalizeDeleteWork (args) {
  if (!hasOnlyAllowedKeys(args, ['taskId'])) return null
  if (!isSafeString(args.taskId, 200)) return null
  return { taskId: args.taskId.trim() }
}

function normalizeCreateByAudio (args) {
  if (!hasOnlyAllowedKeys(args, [
    'audioUrl', 'fileId', 'avatar', 'videoFileId', 'title', 'aigcFlag', 'videoStartMsec',
  ])) return null
  const out = {}
  for (const key of ['audioUrl', 'fileId', 'avatar', 'videoFileId']) {
    const v = optionalString(args[key], key === 'audioUrl' ? 2000 : MAX_FILE_ID_LENGTH)
    if (v === null) return null
    if (v) out[key] = v
  }
  if (!out.audioUrl && !out.fileId) return null
  if (!out.avatar && !out.videoFileId) return null

  const title = optionalString(args.title, MAX_TITLE_LENGTH)
  if (title === null) return null
  if (title) out.title = title

  const aigcFlag = optionalInt(args.aigcFlag, 0)
  if (aigcFlag === null) return null
  if (aigcFlag !== undefined) out.aigcFlag = aigcFlag

  const start = optionalInt(args.videoStartMsec, 0)
  if (start === null) return null
  if (start !== undefined) out.videoStartMsec = start
  return out
}

function normalizeCreateByTemplate (args) {
  const allowed = [
    'voice', 'text', 'avatar', 'videoFileId', 'title', 'template',
    'aigcFlag', 'bgmFileId', 'ambienceFileId', 'coverFileId',
    'normLufs', 'bgmNormLufs', 'audioAssetsNormLufs', 'ambienceNormLufs',
  ]
  if (!hasOnlyAllowedKeys(args, allowed)) return null
  if (!isSafeString(args.template, 200)) return null
  if (!isSafeString(args.text, MAX_TEXT_LENGTH)) return null
  const out = { template: args.template.trim(), text: args.text.trim() }

  for (const key of ['voice', 'avatar']) {
    const v = optionalString(args[key], MAX_FILE_ID_LENGTH)
    if (v === null) return null
    if (v) out[key] = v
  }
  for (const key of ['videoFileId', 'bgmFileId', 'ambienceFileId', 'coverFileId']) {
    const v = optionalString(args[key], MAX_FILE_ID_LENGTH)
    if (v === null) return null
    if (v) out[key] = v
  }
  if (!out.videoFileId && (!out.voice || !out.avatar)) return null

  const title = optionalString(args.title, MAX_TITLE_LENGTH)
  if (title === null) return null
  if (title) out.title = title

  const aigcFlag = optionalInt(args.aigcFlag, 0)
  if (aigcFlag === null) return null
  if (aigcFlag !== undefined) out.aigcFlag = aigcFlag

  for (const key of ['normLufs', 'bgmNormLufs', 'audioAssetsNormLufs', 'ambienceNormLufs']) {
    const raw = args[key]
    if (raw === undefined || raw === null || raw === '') continue
    const num = typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (!Number.isFinite(num)) return null
    out[key] = num
  }
  return out
}

function normalizeTranslate (args) {
  if (!hasOnlyAllowedKeys(args, ['videoFileId', 'targetLanguageCode'])) return null
  if (!isSafeString(args.videoFileId, MAX_FILE_ID_LENGTH)) return null
  if (!isSafeString(args.targetLanguageCode, 20)) return null
  return {
    videoFileId: args.videoFileId.trim(),
    targetLanguageCode: args.targetLanguageCode.trim(),
  }
}

function normalizeCreateBySing (args) {
  if (!hasOnlyAllowedKeys(args, ['imageFileId', 'audioFileId'])) return null
  if (!isSafeString(args.imageFileId, MAX_FILE_ID_LENGTH)) return null
  if (!isSafeString(args.audioFileId, MAX_FILE_ID_LENGTH)) return null
  return { imageFileId: args.imageFileId.trim(), audioFileId: args.audioFileId.trim() }
}

function normalizeCreateByImage (args) {
  if (!hasOnlyAllowedKeys(args, ['imageFileId', 'voice', 'text', 'model'])) return null
  if (!isSafeString(args.imageFileId, MAX_FILE_ID_LENGTH)) return null
  if (!isSafeString(args.voice, MAX_FILE_ID_LENGTH)) return null
  if (!isSafeString(args.text, MAX_TEXT_LENGTH)) return null
  const out = {
    imageFileId: args.imageFileId.trim(),
    voice: args.voice.trim(),
    text: args.text.trim(),
  }
  const model = optionalInt(args.model, 0)
  if (model === null) return null
  if (model !== undefined) out.model = model
  return out
}

function normalizeAudioTts (args) {
  if (!hasOnlyAllowedKeys(args, ['voice', 'text', 'title', 'aigcFlag'])) return null
  if (!isSafeString(args.voice, MAX_FILE_ID_LENGTH)) return null
  if (!isSafeString(args.text, MAX_TEXT_LENGTH)) return null
  const out = { voice: args.voice.trim(), text: args.text.trim() }
  const title = optionalString(args.title, MAX_TITLE_LENGTH)
  if (title === null) return null
  if (title) out.title = title
  const aigcFlag = optionalInt(args.aigcFlag, 0)
  if (aigcFlag === null) return null
  if (aigcFlag !== undefined) out.aigcFlag = aigcFlag
  return out
}

const NORMALIZERS = Object.freeze({
  'hifly-extra:credit': () => ({}),
  'hifly-extra:lively-templates': normalizeLivelyTemplates,
  'hifly-extra:cover-styles': normalizeCoverStyles,
  'hifly-extra:create-cover': normalizeCreateCover,
  'hifly-extra:delete-work': normalizeDeleteWork,
  'hifly-extra:create-by-audio': normalizeCreateByAudio,
  'hifly-extra:create-by-template': normalizeCreateByTemplate,
  'hifly-extra:translate': normalizeTranslate,
  'hifly-extra:create-by-sing': normalizeCreateBySing,
  'hifly-extra:create-by-image': normalizeCreateByImage,
  'hifly-extra:audio-tts': normalizeAudioTts,
})

/**
 * 注册 11 个飞影扩展通道。
 *
 * @param {object} ipcMain Electron ipcMain
 * @param {{ modelProviderManager?: object }} deps
 */
function registerHiflyExtraHandlers (ipcMain, deps = {}) {
  const manager = deps.modelProviderManager || null

  /**
   * 构造一个通道处理器。
   *
   * 为什么用工厂 + 11 条显式注册，而不是循环 `ipcMain.handle(channel, ...)`：
   * `check-ipc-sender-guard.js` 是静态判据，只认 `ipcMain.handle(<字面量通道名>, ...)`。
   * 循环写法会被读成 `<expr:channel>`，与 automation.js 的同型表达式判为
   * 「重复注册且守卫状态不一致」而红——那条判据的意图正是让每条通道的守卫看得见，
   * 所以通道名保持字面量，公共逻辑收进工厂。
   */
  const makeHandler = (method, normalize) => withSenderCheck(async (_event, args) => {
    // credit 无参；其余必须传对象
    const rawArgs = args === undefined || args === null ? {} : args
    if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return invalidArguments()
    const params = normalize(rawArgs)
    if (params === null) return invalidArguments()

    if (!manager || typeof manager.callAdapter !== 'function') {
      return { code: EC.REQUEST_ERROR, message: 'HIFLY_EXTRA_UNAVAILABLE' }
    }

    try {
      // 能力探测：上游方法未实现时 fail-closed（UI 据此隐藏入口）
      if (typeof manager.supportsAdapterMethod === 'function') {
        const supported = await manager.supportsAdapterMethod(PROVIDER_ID, method)
        if (!supported) {
          return { code: EC.REQUEST_ERROR, message: 'HIFLY_EXTRA_UNSUPPORTED' }
        }
      }
      const result = await manager.callAdapter(PROVIDER_ID, method, params)
      if (!result || result.code !== 0) {
        return {
          code: EC.REQUEST_ERROR,
          message: (result && result.message) || 'HIFLY_EXTRA_FAILED',
        }
      }
      return { code: 0, data: result.data === undefined ? null : result.data }
    } catch (error) {
      logHandlerError(method, error)
      return {
        code: EC.REQUEST_ERROR,
        message: (error && error.message) || 'HIFLY_EXTRA_FAILED',
      }
    }
  })

  // 11 条显式注册（通道名字面量，供静态判据逐条核对守卫状态）
  ipcMain.handle('hifly-extra:credit', makeHandler('getAccountCredit', NORMALIZERS['hifly-extra:credit']))
  ipcMain.handle('hifly-extra:lively-templates', makeHandler('listLivelyTemplates', NORMALIZERS['hifly-extra:lively-templates']))
  ipcMain.handle('hifly-extra:cover-styles', makeHandler('listCoverStyles', NORMALIZERS['hifly-extra:cover-styles']))
  ipcMain.handle('hifly-extra:create-cover', makeHandler('createCover', NORMALIZERS['hifly-extra:create-cover']))
  ipcMain.handle('hifly-extra:delete-work', makeHandler('deleteWork', NORMALIZERS['hifly-extra:delete-work']))
  ipcMain.handle('hifly-extra:create-by-audio', makeHandler('createVideoByAudio', NORMALIZERS['hifly-extra:create-by-audio']))
  ipcMain.handle('hifly-extra:create-by-template', makeHandler('createVideoByTemplate', NORMALIZERS['hifly-extra:create-by-template']))
  ipcMain.handle('hifly-extra:translate', makeHandler('translateVideo', NORMALIZERS['hifly-extra:translate']))
  ipcMain.handle('hifly-extra:create-by-sing', makeHandler('createVideoBySing', NORMALIZERS['hifly-extra:create-by-sing']))
  ipcMain.handle('hifly-extra:create-by-image', makeHandler('createVideoByImage', NORMALIZERS['hifly-extra:create-by-image']))
  ipcMain.handle('hifly-extra:audio-tts', makeHandler('createAudioByTts', NORMALIZERS['hifly-extra:audio-tts']))
}

module.exports = registerHiflyExtraHandlers
module.exports.CHANNEL_METHODS = CHANNEL_METHODS
module.exports.normalizeCreateCover = normalizeCreateCover
module.exports.normalizeCreateByAudio = normalizeCreateByAudio
module.exports.normalizeCreateByTemplate = normalizeCreateByTemplate
module.exports.normalizeLivelyTemplates = normalizeLivelyTemplates
