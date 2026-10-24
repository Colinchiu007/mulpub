// @ts-check
/**
 * base.js — P3.0 BaseAdapter 抽象基类
 *
 * 设计决策（devex review 2.1/2.2/2.3/7.1）：
 * - 接口隔离：BaseAdapter 只含基础 7 方法，LLM/TTS/Image/Video 方法为 mixin
 * - 未实现方法抛 NotImplementedError（非静默返回 undefined）
 * - config 分离为 credentials + options（2.3）
 * - ADAPTER_VERSION 版本号（7.1），registry 注册时检查兼容性
 * - supports(method) 能力协商（7.3）
 * - capabilities() 返回支持的方法列表（2.5）
 */

const { ProviderError, ERROR_CODES } = require('./provider-error')

/**
 * ADAPTER_VERSION — 接口版本号
 * major 变更时递增，registry 检查兼容性
 */
const ADAPTER_VERSION = 1

/**
 * NotImplementedError — 未实现方法专用错误
 */
class NotImplementedError extends ProviderError {
  constructor(methodName) {
    super(ERROR_CODES.NOT_IMPLEMENTED, `Method "${methodName}" not implemented`)
    this.name = 'NotImplementedError'
    this.methodName = methodName
  }
}

/**
 * 已知 mixin 方法列表（用于 supports/capabilities 自动检测）
 * 子类覆盖这些方法后，supports() 自动返回 true
 */
const KNOWN_METHODS = [
  // 基础方法
  'listModels', 'testConnection', 'validateConfig',
  // LLM mixin
  'chatCompletion', 'streamChat', 'embeddings',
  // TTS mixin
  'synthesize', 'listVoices', 'cloneVoice', 'deleteVoice',
  // Speech-to-text mixin
  'transcribe',
  // Image mixin
  'generateImage', 'editImage',
  // Video mixin
  'generateVideo', 'getVideoStatus',
  // Digital human mixin（数字人形象/音色目录；avatar-spokesperson 流水线）
  // 必须与 KNOWN_METHODS 同步登记：callAdapter 用 supports() 做闸门
  // （model-provider-manager.js 的 OPERATION_NOT_SUPPORTED 分支），不在本表里的
  // 方法即便子类实现了也永远不会被调到。
  'listAvatars',
  // 形象/声音克隆（change: digital-human-multiprovider，飞影 HiFly 已实现全套）。
  // 与 heygen-clone mixin 的方法同名同参，便于两家互换；HeyGen 侧暂不登记是
  // 计划内的 fail-closed（无真实 Key 核字段），不是遗漏。
  'createAvatar', 'getAvatarStatus', 'deleteAvatar', 'getVoiceCloneStatus',
  // change: hifly-full-api —— 补齐飞影官方剩余 11 个端点（2026-10-24）。
  // 分两类：辅助管理（免费）与 6 个收费创作模式。每一项都只有真的实现了
  // 对应端点的 adapter 才登记；未实现的保持不登记 ⇒ supports() false ⇒
  // callAdapter 闸门 fail-closed。
  //
  // 辅助与作品管理（全部免费）：
  //   getAccountCredit     GET    /account/credit         查询账户积分
  //   listLivelyTemplates  GET    /video/lively_templates 网感模板列表
  //   listCoverStyles      GET    /project/cover_styles   封面模板列表
  //   createCover          POST   /project/covers         创建封面（唯一的免费创建端点）
  //   deleteWork           DELETE /video/task             删除作品（仅普通视频创作任务）
  'getAccountCredit', 'listLivelyTemplates', 'listCoverStyles', 'createCover', 'deleteWork',
  // 收费创作模式（官方均标注「会产生积分消耗」）：
  //   createVideoByAudio    POST /video/create_by_audio     声音驱动
  //   createVideoByTemplate POST /video/create_by_template  网感模板
  //   translateVideo        POST /video/translate           视频翻译
  //   createVideoBySing     POST /video/create_by_sing      唱歌
  //   createVideoByImage    POST /video/create_by_image     图片驱动
  //   createAudioByTts      POST /audio/create_by_tts       音频创作
  'createVideoByAudio', 'createVideoByTemplate', 'translateVideo',
  'createVideoBySing', 'createVideoByImage', 'createAudioByTts',
]

/**
 * BaseAdapter — 所有 Adapter 的抽象基类
 *
 * 基础方法（7 个）：
 *   - getProviderInfo()    返回供应商基本信息
 *   - validateConfig()     验证配置是否有效
 *   - listModels()         列出可用模型
 *   - testConnection()     测试连接
 *   - supports(method)     能力协商
 *   - capabilities()       返回支持的方法列表
 *   - estimateCost()       估算调用成本（可选）
 *
 * Mixin 方法（子类按需覆盖，默认抛 NotImplementedError）：
 *   - ILlmAdapter:     chatCompletion / streamChat / embeddings
 *   - ITtsAdapter:     synthesize / listVoices / cloneVoice / deleteVoice
 *   - ISttAdapter:     transcribe
 *   - IImageAdapter:   generateImage / editImage
 *   - IVideoAdapter:   generateVideo / getVideoStatus
 */
class BaseAdapter {
  /**
   * @param {object} credentials - 凭证信息（apiKey/baseUrl 等）
   * @param {object} [options={}] - 可选配置（timeout/maxRetries 等）
   */
  constructor(credentials, options = {}) {
    this.credentials = credentials || {}
    this.options = options || {}
    this.id = this.credentials.id || this.credentials.name || 'unknown'
    this.version = ADAPTER_VERSION
  }

  /** 返回供应商基本信息 */
  getProviderInfo() {
    return {
      id: this.id,
      version: this.version,
      baseUrl: this.credentials.baseUrl || '',
    }
  }

  /** 验证配置（子类可覆盖，默认返回 valid） */
  validateConfig() {
    return { valid: true }
  }

  /** 列出可用模型（子类必须实现） */
  listModels() {
    throw new NotImplementedError('listModels')
  }

  /**
   * 测试连接（子类必须实现）
   * @returns {Promise<unknown>}
   */
  async testConnection() {
    throw new NotImplementedError('testConnection')
  }

  /** 估算调用成本（可选，子类可覆盖） */
  estimateCost() {
    return null
  }

  /**
   * supports(method) — 能力协商
   * 检测子类是否覆盖了指定方法（非 BaseAdapter 原型上的方法）
   */
  supports(method) {
    if (!KNOWN_METHODS.includes(method)) return false
    const impl = this[method]
    if (typeof impl !== 'function') return false
    // 检查是否是 BaseAdapter 原型上的默认实现（抛 NotImplementedError 的）
    const baseImpl = BaseAdapter.prototype[method]
    if (baseImpl && impl === baseImpl) return false
    return true
  }

  /**
   * capabilities() — 返回支持的方法列表
   * 自动扫描 KNOWN_METHODS，返回 supports() === true 的方法
   */
  capabilities() {
    return KNOWN_METHODS.filter(m => this.supports(m))
  }

  // ─── ILlmAdapter mixin（默认抛 NotImplementedError）───
  chatCompletion()    { throw new NotImplementedError('chatCompletion') }
  streamChat()        { throw new NotImplementedError('streamChat') }
  embeddings()        { throw new NotImplementedError('embeddings') }

  // ─── ITtsAdapter mixin ───
  synthesize()        { throw new NotImplementedError('synthesize') }
  listVoices()        { throw new NotImplementedError('listVoices') }
  cloneVoice()        { throw new NotImplementedError('cloneVoice') }
  deleteVoice()       { throw new NotImplementedError('deleteVoice') }

  // ─── ISttAdapter mixin ───
  transcribe()        { throw new NotImplementedError('transcribe') }

  // ─── IImageAdapter mixin ───
  generateImage()     { throw new NotImplementedError('generateImage') }
  editImage()         { throw new NotImplementedError('editImage') }

  // ─── IVideoAdapter mixin ───
  generateVideo()     { throw new NotImplementedError('generateVideo') }
  getVideoStatus()    { throw new NotImplementedError('getVideoStatus') }
}

module.exports = { BaseAdapter, NotImplementedError, ADAPTER_VERSION, KNOWN_METHODS }
