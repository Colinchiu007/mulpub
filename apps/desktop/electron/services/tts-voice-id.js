// @ts-check
/**
 * tts-voice-id.js — 「未指定音色」的占位值判定（单一事实源）
 *
 * 上游（story2video-stages.js）取音色的兜底是 'default'
 * （firstDefined(params.voiceId, stage.options?.voiceId, 'default')），
 * 另有历史遗留的 'male' / 'female-soft'；它们不是真实音色名，只是
 * 「让适配器自己挑默认」的占位符。
 *
 * 为什么必须单独成文件（2026-10-23 实测）：
 *   provider 路径（_tryProviderTTS）早就会过滤这些占位值，但 **edge-tts 路径
 *   （_tryEdgeTTS）没有过滤** —— 'default' 被原样当音色名传下去，edge-tts 抛
 *   `ValueError: Invalid voice 'default'`，整条 TTS 降级成 3 秒静音。
 *   后果：用户**用默认音色 + 没配 TTS provider**（走内置 edge-tts 免 Key 路径）时，
 *   成片**完全没有任何旁白**，界面侧看不出异常（只有主进程日志里一行 WARN）。
 *   两条路径因此统一到本模块，杜绝再次漂移。
 *
 * 独立成文件而不是塞进 asset-generator.js：后者在「还账目标」名单里
 * （零增长容差），新逻辑进新文件才能既修好缺陷又不抬高它的行数。
 */

/** 「未指定音色」的哨兵值集合。 */
const PLACEHOLDER_VOICE_IDS = new Set(['default', 'male', 'female-soft'])

/**
 * 解析「真实音色名」：占位值/空值一律返回 null（= 交给下游挑默认）。
 * @param {unknown} value
 * @returns {string|null}
 */
function resolveConcreteVoiceId (value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  return PLACEHOLDER_VOICE_IDS.has(raw) ? null : raw
}

module.exports = { PLACEHOLDER_VOICE_IDS, resolveConcreteVoiceId }
