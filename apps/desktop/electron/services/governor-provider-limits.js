// @ts-check
/**
 * governor-provider-limits.js — 按 provider 的 API 限流预算配置（W3 技术债务闭环）
 *
 * DEFAULT_LIMITS（api-usage-governor.js）按类别（llm/tts/image/video/audio）给出保守默认，
 * 但真实供应商限额差异大（如 OpenAI 高 RPM、MiniMax 异步 T2A 高频、视频生成按任务限额）。
 * 本模块为已知 provider 提供按 id 的限流预算，让 governor 的 `_pace` 时间槽/并发更贴近真实：
 *   - 数值为保守估计，非官方保证；429 自适应（rateFactor 0.75 下调）仍会兜底真实限流。
 *   - 本地/免费类 provider（ollama/piper/local-diffusion/comfyui/music-library 等）无外部
 *     RPM 限制，给高预算避免误排队。
 *   - 优先级：精确 key 覆盖 > 本表（providerId）> 类别默认 > 全局默认。
 */
'use strict'

// 仅对主进程内已知 provider id 生效；未列入的 provider 回退类别默认。
const PROVIDER_LIMITS = Object.freeze({
  // ── LLM ──
  openai: Object.freeze({ rpm: 120, maxConcurrent: 3, cooldownMs: 30000, retry429: 3 }),
  anthropic: Object.freeze({ rpm: 60, maxConcurrent: 3, cooldownMs: 30000, retry429: 3 }),
  gemini: Object.freeze({ rpm: 60, maxConcurrent: 3, cooldownMs: 30000, retry429: 3 }),
  openrouter: Object.freeze({ rpm: 60, maxConcurrent: 3, cooldownMs: 30000, retry429: 3 }),
  deepseek: Object.freeze({ rpm: 60, maxConcurrent: 3, cooldownMs: 30000, retry429: 3 }),
  'doubao-llm': Object.freeze({ rpm: 60, maxConcurrent: 3, cooldownMs: 30000, retry429: 3 }),
  'mimo-llm': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'sensenova-llm': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'tianyiyun-coding-plan': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'agnes-llm': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'opencode-go': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  ollama: Object.freeze({ rpm: 120, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }), // 本地

  // ── TTS ──
  'openai-tts': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'minimax-tts': Object.freeze({ rpm: 20, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'doubao-tts': Object.freeze({ rpm: 20, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'google-tts': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  elevenlabs: Object.freeze({ rpm: 20, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'mimo-tts': Object.freeze({ rpm: 20, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  piper: Object.freeze({ rpm: 120, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }), // 本地

  // ── 语音识别 ──
  whisper: Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'google-stt': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'doubao-stt': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'baidu-stt': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'local-whisper': Object.freeze({ rpm: 60, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }), // 本地

  // ── 图片 ──
  flux: Object.freeze({ rpm: 15, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
  'dall-e': Object.freeze({ rpm: 10, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
  recraft: Object.freeze({ rpm: 15, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
  imagen: Object.freeze({ rpm: 15, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
  'grok-image': Object.freeze({ rpm: 15, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
  'minimax-image': Object.freeze({ rpm: 15, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
  'agnes-image': Object.freeze({ rpm: 15, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
  pixabay: Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  pexels: Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'local-diffusion': Object.freeze({ rpm: 60, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }), // 本地
  comfyui: Object.freeze({ rpm: 60, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }), // 本地

  // ── 视频（多为异步任务制，并发低、冷却长）──
  hunyuan: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  cogvideo: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  'grok-video': Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  heygen: Object.freeze({ rpm: 8, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  kling: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  runway: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  veo: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  wan: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  minimax: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  'agnes-video': Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  ltx: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  seedance: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),
  higgsfield: Object.freeze({ rpm: 6, maxConcurrent: 2, cooldownMs: 60000, retry429: 2 }),

  // ── 音频 ──
  suno: Object.freeze({ rpm: 6, maxConcurrent: 1, cooldownMs: 60000, retry429: 2 }),
  musicgen: Object.freeze({ rpm: 6, maxConcurrent: 1, cooldownMs: 60000, retry429: 2 }),
  'pixabay-music': Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  freesound: Object.freeze({ rpm: 30, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }),
  'music-library': Object.freeze({ rpm: 120, maxConcurrent: 2, cooldownMs: 30000, retry429: 3 }), // 本地

  // ── 多模态 ──
  'agnes-multimodal': Object.freeze({ rpm: 20, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 }),
})

/** 将 provider 限流预算注入 governor（幂等，可在构造后调用） */
function applyProviderLimits(governor) {
  if (!governor || typeof governor.setProviderLimits !== 'function') return
  for (const [providerId, limits] of Object.entries(PROVIDER_LIMITS)) {
    governor.setProviderLimits(providerId, limits)
  }
}

module.exports = { PROVIDER_LIMITS, applyProviderLimits }
