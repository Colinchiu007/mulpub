// @ts-check
/**
 * model-provider-seeds — 预设模型服务商种子数据
 *
 * 5 类模型：llm / tts / speech_recognition / image / video
 * 初始化时通过 INSERT OR IGNORE 写入 model_providers 表
 */

const CATEGORIES = {
  LLM: 'llm',
  TTS: 'tts',
  SPEECH_RECOGNITION: 'speech_recognition',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  MULTIMODAL: 'multimodal',
};

const CATEGORY_LABELS = {
  llm: '推理模型',
  tts: 'TTS语音',
  speech_recognition: '语音识别',
  image: '图片生成',
  video: '视频模型',
  audio: '音频生成',
  multimodal: '多模态模型',
};

/**
 * 多模态能力标识（对应类别/能力域）：
 * llm=文字推理 / tts=TTS语音 / speech_recognition=语音识别 / image=生图 / video=生成视频。
 * 多模态预设必须声明至少 MULTIMODAL_MIN_CAPABILITIES 项能力。
 */
const MULTIMODAL_CAPABILITY_IDS = ['llm', 'tts', 'speech_recognition', 'image', 'video'];
const MULTIMODAL_MIN_CAPABILITIES = 2;

/**
 * 预设服务商列表
 * is_preset = 1 表示预设，不允许删除，只能禁用
 */
const PRESET_PROVIDERS = [
  // ─── 推理模型 (LLM) ──────────────────────────
  {
    id: 'anthropic', name: 'Anthropic', category: 'llm',
    base_url: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku', 'claude-3-opus'],
    is_preset: 1,
  },
  {
    id: 'openai', name: 'OpenAI', category: 'llm',
    base_url: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
    is_preset: 1,
  },
  {
    id: 'gemini', name: 'Gemini', category: 'llm',
    base_url: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-pro'],
    is_preset: 1,
  },
  {
    id: 'openrouter', name: 'OpenRouter', category: 'llm',
    base_url: 'https://openrouter.ai/api/v1',
    models: ['auto', 'anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    is_preset: 1,
  },
  {
    id: 'ollama', name: 'Ollama (本地)', category: 'llm',
    base_url: 'http://localhost:11434',
    models: ['llama3', 'qwen2', 'mistral', 'gemma2'],
    is_preset: 1,
  },
  {
    id: 'doubao-llm', name: '豆包', category: 'llm',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-pro-128k', 'doubao-pro-32k', 'doubao-lite-32k'],
    is_preset: 1,
  },
  {
    id: 'deepseek', name: 'DeepSeek', category: 'llm',
    base_url: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    is_preset: 1,
  },
  {
    id: 'mimo-llm', name: 'Xiaomi MiMo', category: 'llm',
    base_url: 'https://api.xiaomimimo.com/v1',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    is_preset: 1,
  },
  {
    id: 'opencode-go', name: 'OpenCode-Go', category: 'llm',
    base_url: 'https://opencode.ai/zen/go/v1',
    models: ['glm-5.2', 'kimi-k2.7-code', 'deepseek-v4-pro', 'deepseek-v4-flash', 'mimo-v2.5', 'mimo-v2.5-pro', 'glm-5.1', 'kimi-k2.6'],
    is_preset: 1,
  },
  {
    id: 'agnes-llm', name: 'Agnes AI', category: 'llm',
    base_url: 'https://apihub.agnes-ai.com/v1',
    models: ['agnes-2.0-flash'],
    is_preset: 1,
  },
  {
    id: 'sensenova-llm', name: 'SenseNova', category: 'llm',
    base_url: 'https://token.sensenova.cn/v1',
    models: ['deepseek-v4-flash'],
    is_preset: 1,
  },
  {
    id: 'tianyiyun-coding-plan', name: '天翼云 Coding Plan', category: 'llm',
    base_url: 'https://eaichat.ctyun.cn/ai/platform/v2/cp',
    models: ['deepseek-v4-flash-0731-oc'],
    is_preset: 1,
  },

  // ─── TTS 语音合成 ────────────────────────────
  {
    id: 'elevenlabs', name: 'ElevenLabs', category: 'tts',
    base_url: 'https://api.elevenlabs.io/v1',
    models: ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_monolingual_v1'],
    is_preset: 1,
  },
  {
    id: 'openai-tts', name: 'OpenAI TTS', category: 'tts',
    base_url: 'https://api.openai.com/v1',
    models: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
    is_preset: 1,
  },
  {
    id: 'doubao-tts', name: '豆包 TTS', category: 'tts',
    base_url: 'https://openspeech.bytedance.com',
    models: ['doubao-tts', 'doubao-streaming-tts'],
    is_preset: 1,
  },
  {
    id: 'google-tts', name: 'Google TTS', category: 'tts',
    base_url: 'https://texttospeech.googleapis.com/v1',
    models: ['google-tts', 'waveNet', 'neural2'],
    is_preset: 1,
  },
  {
    id: 'piper', name: 'Piper (本地)', category: 'tts',
    base_url: '',
    models: ['piper'],
    is_preset: 1,
  },
  {
    id: 'mimo-tts', name: 'MiMo TTS', category: 'tts',
    base_url: 'https://api.xiaomimimo.com/v1',
    models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone'],
    is_preset: 1,
  },
  {
    id: 'minimax-tts', name: 'MiniMax TTS', category: 'tts',
    base_url: 'https://api.minimaxi.com/v1',
    // 需求：去掉模型 ID 输入，默认使用 speech-2.8-turbo（异步长文本 T2A Async）
    models: ['speech-2.8-turbo'],
    is_preset: 1,
  },

  // ─── 语音识别 ────────────────────────────────
  {
    id: 'whisper', name: 'OpenAI Whisper', category: 'speech_recognition',
    base_url: 'https://api.openai.com/v1',
    models: ['whisper-1'],
    is_preset: 1,
  },
  {
    id: 'google-stt', name: 'Google Speech-to-Text', category: 'speech_recognition',
    base_url: 'https://speech.googleapis.com/v1',
    models: ['google-stt', 'google-stt-long'],
    is_preset: 1,
  },
  {
    id: 'doubao-stt', name: '豆包语音识别', category: 'speech_recognition',
    base_url: 'https://openspeech.bytedance.com',
    models: ['doubao-asr', 'doubao-streaming-asr'],
    is_preset: 1,
  },
  {
    id: 'baidu-stt', name: '百度语音识别', category: 'speech_recognition',
    base_url: 'https://vop.baidu.com/server_api',
    models: ['baidu-asr'],
    is_preset: 1,
  },
  {
    id: 'local-whisper', name: '本地 Whisper', category: 'speech_recognition',
    base_url: '',
    models: ['whisper-cpp', 'whisper-large-v3'],
    is_preset: 1,
  },

  // ─── 图片生成 ────────────────────────────────
  {
    id: 'flux', name: 'Flux', category: 'image',
    base_url: 'https://api.bfl.ml/v1',
    models: ['flux-pro', 'flux-dev', 'flux-schnell'],
    is_preset: 1,
  },
  {
    id: 'dall-e', name: 'DALL-E', category: 'image',
    base_url: 'https://api.openai.com/v1',
    models: ['gpt-image-1', 'dall-e-3', 'dall-e-2'],
    is_preset: 1,
  },
  {
    id: 'recraft', name: 'Recraft', category: 'image',
    base_url: 'https://external.api.recraft.ai/v1',
    models: ['recraft-v3', 'recraft-20b'],
    is_preset: 1,
  },
  {
    id: 'imagen', name: 'Imagen', category: 'image',
    base_url: 'https://generativelanguage.googleapis.com',
    models: ['imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001', 'imagen-4.0-ultra-generate-001'],
    is_preset: 1,
  },
  {
    id: 'grok-image', name: 'Grok Image', category: 'image',
    base_url: 'https://api.x.ai/v1',
    models: ['grok-image'],
    is_preset: 1,
  },
  {
    id: 'pixabay', name: 'Pixabay', category: 'image',
    base_url: 'https://pixabay.com/api/',
    models: ['pixabay'],
    is_preset: 1,
  },
  {
    id: 'pexels', name: 'Pexels', category: 'image',
    base_url: 'https://api.pexels.com/v1',
    models: ['pexels'],
    is_preset: 1,
  },
  {
    id: 'local-diffusion', name: '本地扩散', category: 'image',
    base_url: '',
    models: ['sd-1.5', 'sdxl', 'sd3'],
    is_preset: 1,
  },
  {
    id: 'comfyui', name: 'ComfyUI', category: 'image',
    base_url: 'http://localhost:8188',
    models: ['comfyui'],
    is_preset: 1,
  },
  {
    id: 'minimax-image', name: 'MiniMax Image', category: 'image',
    base_url: 'https://api.minimaxi.com/v1',
    models: ['image-01'],
    is_preset: 1,
  },
  {
    id: 'agnes-image', name: 'Agnes Image', category: 'image',
    base_url: 'https://apihub.agnes-ai.com/v1',
    models: ['agnes-image-2.1-flash'],
    is_preset: 1,
  },

  // ─── 视频模型 ────────────────────────────────
  {
    id: 'hunyuan', name: '腾讯混元', category: 'video',
    base_url: 'https://hunyuan.tencentcloudapi.com',
    models: ['hunyuan-video'],
    is_preset: 1,
  },
  {
    id: 'cogvideo', name: 'CogVideo', category: 'video',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['cogvideo'],
    is_preset: 1,
  },
  {
    id: 'grok-video', name: 'Grok Video', category: 'video',
    base_url: 'https://api.x.ai/v1',
    models: ['grok-video'],
    is_preset: 1,
  },
  {
    id: 'heygen', name: 'HeyGen', category: 'video',
    base_url: 'https://api.heygen.com/v2',
    models: ['heygen-video'],
    is_preset: 1,
  },
  {
    id: 'kling', name: 'Kling', category: 'video',
    base_url: 'https://api.klingai.com/v1',
    models: ['kling-video'],
    is_preset: 1,
  },
  {
    id: 'runway', name: 'Runway', category: 'video',
    base_url: 'https://api.runwayml.com/v1',
    models: ['runway-gen3', 'runway-gen4'],
    is_preset: 1,
  },
  {
    id: 'veo', name: 'Veo', category: 'video',
    base_url: 'https://generativelanguage.googleapis.com',
    models: ['veo'],
    is_preset: 1,
  },
  {
    id: 'wan', name: 'Wan (万相)', category: 'video',
    base_url: 'https://dashscope.aliyuncs.com/api/v1',
    models: ['wan-video'],
    is_preset: 1,
  },
  {
    id: 'minimax', name: 'MiniMax', category: 'video',
    base_url: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02', 'T2V-01', 'I2V-01'],
    is_preset: 1,
  },
  {
    id: 'agnes-video', name: 'Agnes Video', category: 'video',
    base_url: 'https://apihub.agnes-ai.com/v1',
    models: ['agnes-video-v2.0'],
    is_preset: 1,
  },
  {
    id: 'ltx', name: 'LTX Video', category: 'video',
    base_url: '',
    models: ['ltx-video'],
    is_preset: 1,
  },
  {
    id: 'seedance', name: 'Seedance', category: 'video',
    base_url: 'https://api.seedance.ai/v1',
    models: ['seedance'],
    is_preset: 1,
  },
  {
    id: 'higgsfield', name: 'Higgsfield', category: 'video',
    base_url: 'https://api.higgsfield.ai/v1',
    models: ['higgsfield-video'],
    is_preset: 1,
  },
  // ─── 音频生成 ────────────────────────────────
  {
    id: 'suno', name: 'Suno', category: 'audio',
    base_url: 'https://api.suno.ai/v1',
    models: ['suno-v4'],
    is_preset: 1,
  },
  {
    id: 'musicgen', name: 'MusicGen', category: 'audio',
    base_url: '',
    models: ['musicgen'],
    is_preset: 1,
  },
  {
    id: 'pixabay-music', name: 'Pixabay Music', category: 'audio',
    base_url: 'https://pixabay.com/api/',
    models: ['pixabay-music'],
    is_preset: 1,
  },
  {
    id: 'freesound', name: 'Freesound', category: 'audio',
    base_url: 'https://freesound.org/apiv2',
    models: ['freesound'],
    is_preset: 1,
  },
  {
    id: 'music-library', name: '本地音乐库', category: 'audio',
    base_url: '',
    models: ['local-library'],
    is_preset: 1,
  },

  // ─── 多模态模型 ──────────────────────────────
  // 多模态预设必须声明 capabilities（至少 MULTIMODAL_MIN_CAPABILITIES 项）与
  // 每个能力对应的默认模型 capability_models；流水线按能力路由时使用。
  {
    id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal',
    base_url: 'https://api.minimaxi.com/v1',
    models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'],
    is_preset: 1,
    capabilities: ['llm', 'tts', 'image', 'video'],
    capability_models: {
      llm: 'MiniMax-M2.7',
      tts: 'speech-2.8-turbo',
      image: 'image-01',
      video: 'MiniMax-Hailuo-2.3',
    },
  },
  {
    // Agnes-AI 多模态：合并 Agnes 文字推理 / 图片生成 / 视频生成三类模型（中国站）
    id: 'agnes-multimodal', name: 'Agnes-AI', category: 'multimodal',
    base_url: 'https://api.agnes-ai.cn/v1',
    models: ['agnes-3.0-flash', 'agnes-image-2.5-flash', 'agnes-video-2.5-flash'],
    is_preset: 1,
    capabilities: ['llm', 'image', 'video'],
    capability_models: {
      llm: 'agnes-3.0-flash',
      image: 'agnes-image-2.5-flash',
      video: 'agnes-video-2.5-flash',
    },
  },
];

/**
 * 预设限流预算（与 ops-center 预设目录对齐；单位：每分钟连接次数）。
 * rate_per_minute 来自 governor-provider-limits 静态表（代码事实）；limit_per_5h 无代码事实
 * 不预填（留空由运营在模型设置/运营后台填写，注入 ApiUsageGovernor 5h 请求窗口）。
 * 未列出的 provider 使用 governor-provider-limits 静态表或类别默认预算。
 */
const PRESET_RATE_LIMITS = {
  // ── LLM ──
  anthropic: { rate_per_minute: 60 },
  openai: { rate_per_minute: 120 },
  gemini: { rate_per_minute: 60 },
  openrouter: { rate_per_minute: 60 },
  'doubao-llm': { rate_per_minute: 60 },
  deepseek: { rate_per_minute: 60 },
  'mimo-llm': { rate_per_minute: 30 },
  'sensenova-llm': { rate_per_minute: 30 },
  'tianyiyun-coding-plan': { rate_per_minute: 30 },
  'opencode-go': { rate_per_minute: 30 },
  'agnes-llm': { rate_per_minute: 30 },
  ollama: { rate_per_minute: 120 },
  // ── TTS ──
  elevenlabs: { rate_per_minute: 20 },
  'openai-tts': { rate_per_minute: 30 },
  'doubao-tts': { rate_per_minute: 20 },
  'google-tts': { rate_per_minute: 30 },
  'mimo-tts': { rate_per_minute: 20 },
  'minimax-tts': { rate_per_minute: 20 },
  piper: { rate_per_minute: 120 },
  // ── 语音识别 ──
  whisper: { rate_per_minute: 30 },
  'google-stt': { rate_per_minute: 30 },
  'doubao-stt': { rate_per_minute: 30 },
  'baidu-stt': { rate_per_minute: 30 },
  'local-whisper': { rate_per_minute: 60 },
  // ── 图片 ──
  flux: { rate_per_minute: 15 },
  'dall-e': { rate_per_minute: 10 },
  recraft: { rate_per_minute: 15 },
  imagen: { rate_per_minute: 15 },
  'grok-image': { rate_per_minute: 15 },
  'minimax-image': { rate_per_minute: 15 },
  'agnes-image': { rate_per_minute: 15 },
  'local-diffusion': { rate_per_minute: 60 },
  comfyui: { rate_per_minute: 60 },
  // ── 视频（异步任务制，低并发）──
  hunyuan: { rate_per_minute: 6 },
  cogvideo: { rate_per_minute: 6 },
  'grok-video': { rate_per_minute: 6 },
  heygen: { rate_per_minute: 8 },
  kling: { rate_per_minute: 6 },
  runway: { rate_per_minute: 6 },
  veo: { rate_per_minute: 6 },
  wan: { rate_per_minute: 6 },
  minimax: { rate_per_minute: 6 },
  'agnes-video': { rate_per_minute: 6 },
  ltx: { rate_per_minute: 6 },
  seedance: { rate_per_minute: 6 },
  higgsfield: { rate_per_minute: 6 },
  // ── 音频 ──
  suno: { rate_per_minute: 6 },
  musicgen: { rate_per_minute: 6 },
  // ── 多模态 ──
  'minimax-multimodal': { rate_per_minute: 20 },
  'agnes-multimodal': { rate_per_minute: 20 },
};

module.exports = {
  CATEGORIES,
  CATEGORY_LABELS,
  PRESET_PROVIDERS: PRESET_PROVIDERS.map((p) => ({ ...p, ...(PRESET_RATE_LIMITS[p.id] || {}) })),
  PRESET_RATE_LIMITS,
  MULTIMODAL_CAPABILITY_IDS,
  MULTIMODAL_MIN_CAPABILITIES,
};
