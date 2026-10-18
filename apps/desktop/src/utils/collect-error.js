// @ts-check
/**
 * collect-error.js — 采集错误分类器（纯函数）
 *
 * 把采集链路（Python 聚合层 / Node url-collector / 前端异常）产生的
 * 错误输入归一化为机器可读的 reason，供 UI 层按 detailKey 渲染细分提示。
 *
 * 输入形态：
 *   - string：错误消息文本
 *   - { code, message }：IPC 返回的错误对象
 *   - { code, message, reason }：带**结构化 reason** 的 IPC 错误（主进程已分类时优先采信）
 *   - Error：异常对象（取 message）
 *
 * 分类规则按优先级从上到下匹配，首个命中即返回。结构化 reason 排在最前：
 * 主进程（url-collector）已把「百度安全验证页」等形态判定为 security_challenge，
 * 渲染层再做文本猜测属于二次推断——文本一旦被本地化/改写就会漂移（2026-10-18）。
 */

/** 不可重试的分类（参数/输入类/资源超限错误，重试无意义） */
const NON_RETRYABLE = new Set([
  'invalid_url', 'internal_url', 'protocol',
  'video_too_long', 'video_file_too_large', 'no_audio_track', 'asr_engine_unavailable',
  'video_private', 'video_membership', 'video_region', 'video_invalid_platform', 'asr_empty',
  'video_channels_unsupported', 'video_no_video',
])

/**
 * 可被 IPC 结构化 reason 直接采用的分类白名单。
 * 与 locales/collection 的 collectErrors.* 键一一对应；不在表内的 reason 继续走文本匹配，
 * 避免把上游拼错的字符串当成合法分类、渲染出一个没有文案的 detailKey。
 */
const STRUCTURED_REASONS = new Set([
  'invalid_url', 'internal_url', 'protocol', 'budget_exhausted', 'cooldown', 'circuit_open',
  'rate_limited', 'weekend_throttle', 'security_challenge', 'timeout', 'unreachable',
  'content_unextractable', 'backend_unavailable', 'network_error',
  'video_too_long', 'video_file_too_large', 'no_audio_track', 'asr_engine_unavailable',
  'asr_download_failed', 'video_transcribe_timeout', 'video_private', 'video_membership',
  'video_region', 'video_anti_bot', 'video_invalid_platform', 'video_channels_unsupported',
  'video_no_video', 'asr_empty', 'unknown',
])

/**
 * 归一化输入为 { message, code }。
 * @param {unknown} input
 * @returns {{ message: string, code: number | undefined }}
 */
function normalizeInput(input) {
  if (typeof input === 'string') {
    return { message: input, code: undefined }
  }
  if (input && typeof input === 'object') {
    const message = input.message != null ? String(input.message) : ''
    const code = typeof input.code === 'number' ? input.code : undefined
    return { message, code }
  }
  return { message: input == null ? '' : String(input), code: undefined }
}

/**
 * 构造分类结果。
 * @param {string} reason
 * @returns {{ reason: string, retryable: boolean, detailKey: string }}
 */
function result(reason) {
  return {
    reason,
    retryable: !NON_RETRYABLE.has(reason),
    detailKey: 'collectErrors.' + reason,
  }
}

/**
 * 分类采集错误。
 * @param {string | { code?: number, message?: string } | Error} input
 * @returns {{ reason: string, retryable: boolean, detailKey: string }}
 */
export function classifyCollectError(input) {
  const { message, code } = normalizeInput(input)

  // ── 结构化 reason 优先（主进程 url-collector 已分类，如 security_challenge） ──
  // 只在 reason 命中白名单时采用：未知字符串退回文本匹配，避免产生无文案的 detailKey。
  if (input && typeof input === 'object' && typeof input.reason === 'string' &&
      STRUCTURED_REASONS.has(input.reason)) {
    return result(input.reason)
  }

  // ── 视频采集管线错误（/aggregation/collect-video，detail 含具体中文提示时优先透传） ──
  // python-bridge 对 HTTP 422 resolve {code:-422, message:"ERROR_CODE: 中文提示"}；
  // 这些错误后端已生成含实际值的完整提示（如「视频过长（15:32）」），直接透传而非替换为模板文案。
  if (message.includes('VIDEOCLONE_FILE_TOO_LARGE') || message.includes('视频过长') || message.includes('视频文件过大')) {
    return result(message.includes('视频文件过大') ? 'video_file_too_large' : 'video_too_long')
  }
  // 中文短关键词仅在已含错误码前缀（英文 VIDEOCLONE/NO_AUDIO_TRACK 或数字 -6/-7/-8，确定来自视频管线）时兜底匹配，
  // 避免误吞图文链路错误（如「该文章为私密内容」）。
  const fromVideoPipeline = message.includes('VIDEOCLONE') || /^-[678]:/.test(message)
  if (message.includes('NO_AUDIO_TRACK') || (message.includes('无音轨') && fromVideoPipeline)) {
    return result('no_audio_track')
  }
  if (message.includes('ASR_ENGINE_UNAVAILABLE') || (message.includes('转写引擎不可用') && fromVideoPipeline) || message.includes('pip install faster-whisper')) {
    return result('asr_engine_unavailable')
  }
  if (message.includes('ASR_DOWNLOAD_FAILED') || (message.includes('模型下载失败') && fromVideoPipeline)) {
    return result('asr_download_failed')
  }
  if (message.includes('TRANSCRIBE_TIMEOUT') || message.includes('转写超时')) {
    return result('video_transcribe_timeout')
  }
  if (message.includes('VIDEOCLONE_LINK_PRIVATE') || (message.includes('私密') && fromVideoPipeline)) {
    return result('video_private')
  }
  if (message.includes('VIDEOCLONE_LINK_MEMBERSHIP') || (message.includes('会员专属') && fromVideoPipeline)) {
    return result('video_membership')
  }
  if (message.includes('VIDEOCLONE_LINK_REGION') || (message.includes('地区限制') && fromVideoPipeline)) {
    return result('video_region')
  }
  if (message.includes('VIDEOCLONE_LINK_ANTI_BOT') || (message.includes('平台风控') && fromVideoPipeline)) {
    return result('video_anti_bot')
  }
  // 2026-09-29（collect-video-platforms）：视频号明确不支持 / 百家号文章无视频
  if (message.includes('VIDEOCLONE_CHANNELS_UNSUPPORTED')) {
    return result('video_channels_unsupported')
  }
  if (message.includes('VIDEOCLONE_NO_VIDEO')) {
    return result('video_no_video')
  }
  if (message.includes('VIDEOCLONE_INVALID_PLATFORM') || (message.includes('仅支持抖音/小红书') && fromVideoPipeline)) {
    return result('video_invalid_platform')
  }
  if (message.includes('ASR_EMPTY') || message.includes('转写结果为空')) {
    return result('asr_empty')
  }

  if (message.includes('无效的 URL') || message.includes('URL 格式不正确') || message.includes('缺少参数')) {
    return result('invalid_url')
  }
  if (message.includes('内网')) return result('internal_url')
  if (message.includes('协议')) return result('protocol')
  if (message.includes('预算')) return result('budget_exhausted')
  if (message.includes('冷却')) return result('cooldown')
  if (message.includes('熔断')) return result('circuit_open')
  if (message.includes('频率受限') || /rate\s?limit/i.test(message) || message.includes('429')) {
    return result('rate_limited')
  }
  if (message.includes('weekend-throttle') || message.includes('周末限流')) {
    return result('weekend_throttle')
  }
  if (message.includes('安全验证') || message.includes('百度安全') || /captcha/i.test(message) ||
      (message.includes('登录') && message.includes('验证'))) {
    return result('security_challenge')
  }
  if (message.includes('超时') || /timeout/i.test(message) || message.includes('ETIMEDOUT') || code === -1) {
    return result('timeout')
  }
  if (message.includes('无法访问') || message.includes('不可达') || message.includes('ENOTFOUND') ||
      message.includes('ECONNREFUSED') || code === -2) {
    return result('unreachable')
  }
  if (message.includes('无结果') || message.includes('无法提取') || code === -4) {
    return result('content_unextractable')
  }
  if ((message.includes('后端') && message.includes('不可用')) || code === -5) {
    return result('backend_unavailable')
  }
  if (/network/i.test(message) || message.includes('ECONNRESET') || message.includes('fetch failed')) {
    return result('network_error')
  }
  return result('unknown')
}
