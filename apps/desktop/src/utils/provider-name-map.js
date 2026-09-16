/**
 * PROVIDER_DISPLAY_NAMES — provider ID → user-visible display name
 * Shared by story2video-notifications and pipeline-error-formatter.
 */
const PROVIDER_DISPLAY_NAMES = Object.freeze({
  kling: 'Kling', minimax: 'MiniMax', 'minimax-image': 'MiniMax Image',
  'minimax-tts': 'MiniMax TTS', 'minimax-llm': 'MiniMax LLM',
  'minimax-multimodal': 'MiniMax', flux: 'Flux', 'dall-e': 'DALL-E',
  recraft: 'Recraft', imagen: 'Imagen', 'grok-image': 'Grok Image',
  'grok-video': 'Grok Video', runway: 'Runway', veo: 'Veo',
  heygen: 'HeyGen', hunyuan: 'Hunyuan', cogvideo: 'CogVideo',
  agnes: 'Agnes', 'agnes-image': 'Agnes Image', 'agnes-video': 'Agnes Video',
  'agnes-llm': 'Agnes AI', 'agnes-multimodal': 'Agnes-AI', suno: 'Suno', elevenlabs: 'ElevenLabs',
  'openai-tts': 'OpenAI TTS', openai: 'OpenAI', anthropic: 'Anthropic',
  gemini: 'Gemini', deepseek: 'DeepSeek', pixabay: 'Pixabay',
  pexels: 'Pexels', ltx: 'LTX Video', seedance: 'Seedance',
  higgsfield: 'Higgsfield', wan: 'Wan', 'doubao-llm': 'Doubao',
  'doubao-tts': 'Doubao TTS', whisper: 'OpenAI Whisper',
  musicgen: 'MusicGen', 'pixabay-music': 'Pixabay Music',
})

const GENERIC_PROVIDER_TOKENS = new Set([
  'account', 'api', 'current', 'model', 'provider', 'unknown', 'unavailable', 'undefined',
])

/**
 * Extract provider display name from raw error text or supplied params.
 * @param {string} rawError - raw error string (may contain "provider: kling" etc.)
 * @param {object} [supplied] - optional supplied params with explicit providerId/provider
 * @returns {string} display name or ''
 */
export function resolveProviderDisplayName (rawError, supplied = {}) {
  const explicitId = String(supplied.providerId || supplied.provider || '').trim()
  if (explicitId) {
    return PROVIDER_DISPLAY_NAMES[explicitId.toLowerCase()] ||
      (Object.values(PROVIDER_DISPLAY_NAMES).includes(explicitId) ? explicitId : '')
  }
  const raw = String(rawError || '')
  const matches = [
    raw.match(/\bprovider(?:Id)?\s*(?:[:=]\s*)?['"]([a-zA-Z0-9_-]+)['"]/i),
    raw.match(/\b(?:image|video|tts)?\s*provider\s*(?:[:=]\s*)?([a-zA-Z0-9_-]+)\b/i),
  ]
  for (const match of matches) {
    const id = match?.[1]?.toLowerCase() || ''
    if (!id || GENERIC_PROVIDER_TOKENS.has(id) || /^\d+$/.test(id)) continue
    if (PROVIDER_DISPLAY_NAMES[id]) return PROVIDER_DISPLAY_NAMES[id]
  }
  return ''
}

/**
 * Locale-aware default provider name.
 * @param {string} locale - 'en' or 'zh' (or other)
 * @returns {string}
 */
export function defaultProviderName (locale) {
  return '@story2video.labels.currentProvider'
}
