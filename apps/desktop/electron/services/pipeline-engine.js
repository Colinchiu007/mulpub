// @ts-check
/**
 * PipelineEngine - 流水线编排引擎
 *
 * 双模式设计：
 *   1. state_machine（默认）- 仅跟踪状态，不执行阶段工作。与原 13 条流水线行为完全一致。
 *   2. orchestrator（新增）- 通过 StageExecutor 真正执行每个阶段，调用 ServiceBus。
 *
 * 切换方式：
 *   - 旧的同步 start()/advance() 保持 state_machine 行为
 *   - 新的 async startOrchestrated() 进入 orchestrator 模式
 *   - 编排模式下可通过 autoAdvance 自动执行全部阶段
 *
 * 向后兼容：
 *   - 构造函数参数全部可选（无参仍可正常工作，stageExecutor 为 null）
 *   - 所有现有同步方法签名和返回值保持不变
 *   - 现有 13 条流水线无 stage.type 字段，回退为 MANUAL_CHECKPOINT
 */

const os = require('os');
const { StageExecutor, STAGE_TYPES } = require('./stage-executor');
const { cleanupRunInputDir, cleanupImportedMediaPaths } = require('./story2video-paths');
const {
  STORY2VIDEO_PIPELINE,
  normalizeStory2VideoTextParams,
} = require('./story2video-text-config');
const { checkPipelineModelRequirements } = require('./pipeline-model-preflight');
const { buildRunDiagnostics, captureEnvSnapshot } = require('./diagnostics/run-diagnostics');

/**
 * 依据机器资源计算默认后台并发上限（低配保守、高配放宽）：
 * - 可用并行度 ≥8 且可用内存 ≥8GB → 4
 * - 可用并行度 ≥4 且可用内存 ≥4GB → 3
 * - 可用并行度 <2 或可用内存 <2GB → 1
 * - 其余 → 2
 * 最终封顶 [1, 4]。env 可注入（测试用）：{ cpus, freeMemGB }。
 * 说明：compose 阶段 ffmpeg 合成 CPU/内存密集（27 场景曾触发 x264 OOM），
 * API 阶段受 api-usage-governor 限流，因此高配也不超过 4 条。
 */
function computeDefaultMaxConcurrentRuns(env = {}) {
  const cpus = Number.isFinite(Number(env.cpus)) ? Number(env.cpus)
    : (typeof os.availableParallelism === 'function' ? os.availableParallelism() : (os.cpus ? os.cpus().length : 1))
  const freeMemGB = Number.isFinite(Number(env.freeMemGB)) ? Number(env.freeMemGB)
    : (os.freemem ? os.freemem() / (1024 ** 3) : 2)
  let limit = 2
  if (cpus >= 8 && freeMemGB >= 8) limit = 4
  else if (cpus >= 4 && freeMemGB >= 4) limit = 3
  else if (cpus < 2 || freeMemGB < 2) limit = 1
  return Math.max(1, Math.min(4, limit))
}

// --- 流水线元数据（与 Python pipeline_defs 同步） ---
const PIPELINES = [
  {
    name: 'animated-explainer',
    description: 'AI 生成解释视频 - 从主题/创意到完整视频',
    category: 'generated',
    stages: ['research', 'proposal', 'script', 'scenes', 'assets', 'editing', 'compose', 'publish'],
    estimatedCost: 'medium',
    // 真实编排：LLM 规划链（explainer-stages.js 注册）→ 图片+旁白 → FFmpeg 合成 → 发布（可选）
    stageDefs: [
      {
        name: 'research',
        type: 'explainer_research',
        description: '主题研究生成大纲',
        checkpointRequired: false,
      },
      {
        name: 'proposal',
        type: 'explainer_proposal',
        description: '大纲转分镜方案',
        checkpointRequired: false,
      },
      {
        name: 'script',
        type: 'explainer_script',
        description: '分镜转旁白文案',
        checkpointRequired: false,
      },
      {
        name: 'scenes',
        type: 'explainer_scenes',
        description: '文案拆分为视频场景',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'assets',
        type: 'explainer_generate_assets',
        description: '生成图片与旁白',
        checkpointRequired: false,
        options: {
          concurrency: 3,
          imageStyle: 'cinematic',
          imageProvider: null,
          imageModel: null,
          aspectRatio: '16:9',
        },
      },
      {
        name: 'editing',
        type: 'explainer_editing',
        description: '资源清单校验',
        checkpointRequired: false,
      },
      {
        name: 'compose',
        type: 'compose',
        description: '视频合成',
        checkpointRequired: false,
        inputFrom: 'assets',
        options: {
          transition: 'fade',
          imageEffect: 'zoom-in',
          subtitleEnabled: false,
          resolution: '1920x1080',
          fps: 30,
          format: 'mp4',
          defaultSceneDuration: 6,
          generateBase: true,
          generateMerged: true,
        },
      },
      {
        name: 'publish',
        type: 'publish',
        description: '发布（可选）',
        checkpointRequired: false,
        inputFrom: 'compose',
        options: {},
      },
    ],
  },
  {
    name: 'talking-head',
    description: '说话头像视频 - 上传视频 + 文案生成带字幕讲话视频',
    category: 'talking_head',
    stages: ['upload', 'transcribe', 'captions', 'render'],
    estimatedCost: 'low',
    // 真实编排：视频+文案 → 分句 → SRT 字幕 → FFmpeg 烧录（talkinghead-stages.js 注册）
    stageDefs: [
      {
        name: 'upload',
        type: 'talkinghead_upload',
        description: '视频与文案校验',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'transcribe',
        type: 'talkinghead_transcribe',
        description: '文案分句',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'captions',
        type: 'talkinghead_captions',
        description: '生成字幕',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'render',
        type: 'talkinghead_render',
        description: '字幕烧录渲染',
        checkpointRequired: false,
        options: {},
      },
    ],
  },
  {
    name: 'cinematic',
    description: '电影感短片 - 素材视频 → 电影感渲染',
    category: 'cinematic',
    stages: ['ingest', 'grade', 'compose', 'render'],
    estimatedCost: 'medium',
    // 真实编排：本地 FFmpeg 调色→淡入淡出+分辨率合成→渲染（cinematic-stages.js 注册）
    stageDefs: [
      {
        name: 'ingest',
        type: 'cinematic_ingest',
        description: '输入视频校验与探测',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'grade',
        type: 'cinematic_grade',
        description: '电影感调色',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'compose',
        type: 'cinematic_compose',
        description: '淡入淡出与分辨率合成',
        checkpointRequired: false,
        options: { resolution: '1920x1080' },
      },
      {
        name: 'render',
        type: 'cinematic_render',
        description: '渲染输出',
        checkpointRequired: false,
        options: {},
      },
    ],
  },
  {
    name: 'animation',
    description: '动画视频 - AI 生成动画序列',
    category: 'animation',
    stages: ['concept', 'storyboard', 'animate', 'render'],
    estimatedCost: 'high',
    // 真实编排：LLM 概念→分镜→视频生成 provider（未配置时 fail closed 引导设置）→FFmpeg 合成（videogen-stages.js 注册）
    stageDefs: [
      { name: 'concept', type: 'videogen_concept', description: '创意概念与角色设定', checkpointRequired: false, options: { kind: 'animation' } },
      { name: 'storyboard', type: 'videogen_storyboard', description: '分镜场景规划', checkpointRequired: false, options: { kind: 'animation' } },
      { name: 'animate', type: 'videogen_generate', description: '视频生成', checkpointRequired: false, options: {} },
      { name: 'render', type: 'videogen_merge', description: '拼接合成与产物校验', checkpointRequired: false, options: {} },
    ],
  },
  {
    name: 'avatar-spokesperson',
    description: '数字人 spokesperson 视频',
    category: 'talking_head',
    stages: ['avatar_select', 'script', 'generate', 'render'],
    estimatedCost: 'high',
    // 真实编排：数字人选择+LLM 口播文案→视频生成 provider→FFmpeg 合成（videogen-stages.js 注册）
    stageDefs: [
      { name: 'avatar_select', type: 'videogen_avatar', description: '数字人选择与口播文案', checkpointRequired: false, options: {} },
      { name: 'script', type: 'videogen_script', description: '口播文案', checkpointRequired: false, options: {} },
      { name: 'generate', type: 'videogen_generate', description: '数字人视频生成', checkpointRequired: false, options: {} },
      { name: 'render', type: 'videogen_merge', description: '拼接合成与产物校验', checkpointRequired: false, options: {} },
    ],
  },
  {
    name: 'character-animation',
    description: '角色动画 - AI 驱动角色表演',
    category: 'animation',
    stages: ['character_design', 'rigging', 'animate', 'render'],
    estimatedCost: 'high',
    // 真实编排：LLM 角色设计→概念校验→视频生成 provider→FFmpeg 合成（videogen-stages.js 注册）
    stageDefs: [
      { name: 'character_design', type: 'videogen_concept', description: '角色设计', checkpointRequired: false, options: { kind: 'character-animation' } },
      { name: 'rigging', type: 'videogen_storyboard', description: '角色动作分镜', checkpointRequired: false, options: { kind: 'character-animation' } },
      { name: 'animate', type: 'videogen_generate', description: '角色动画生成', checkpointRequired: false, options: {} },
      { name: 'render', type: 'videogen_merge', description: '拼接合成与产物校验', checkpointRequired: false, options: {} },
    ],
  },
  {
    name: 'clip-factory',
    description: '视频切片工厂 - 从长视频自动提取精彩片段',
    category: 'screen_recording',
    stages: ['analyze', 'extract', 'caption', 'export'],
    estimatedCost: 'low',
    // 真实编排：本地 FFmpeg 场景检测→逐段剪辑→标题→合并导出（clipfactory-stages.js 注册）
    stageDefs: [
      {
        name: 'analyze',
        type: 'clipfactory_analyze',
        description: '场景检测与时长分析',
        checkpointRequired: false,
        options: { sceneThreshold: 0.3, maxSegments: 8, minSegmentSeconds: 2, maxTotalSeconds: 60 },
      },
      {
        name: 'extract',
        type: 'clipfactory_extract',
        description: '逐段剪辑',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'caption',
        type: 'clipfactory_caption',
        description: '片段标题',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'export',
        type: 'clipfactory_export',
        description: '合并导出',
        checkpointRequired: false,
        options: {},
      },
    ],
  },
  {
    name: 'documentary-montage',
    description: '纪录蒙太奇 - 素材纪录片风格剪辑',
    category: 'cinematic',
    stages: ['research', 'ingest', 'edit', 'narrate', 'render'],
    estimatedCost: 'medium',
    // 真实编排：LLM 纪录片大纲→场景规划→图片+旁白→资源校验→FFmpeg 合成（documentary-stages.js 注册）
    stageDefs: [
      {
        name: 'research',
        type: 'documentary_research',
        description: '纪录片风格主题研究',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'ingest',
        type: 'documentary_ingest',
        description: '素材画面规划（场景数组）',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'edit',
        type: 'documentary_edit',
        description: '生成图片与旁白素材',
        checkpointRequired: false,
        options: {
          concurrency: 3,
          imageStyle: 'documentary',
          aspectRatio: '16:9',
        },
      },
      {
        name: 'narrate',
        type: 'documentary_narrate',
        description: '旁白与资源清单校验',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'render',
        type: 'compose',
        description: '视频合成',
        checkpointRequired: false,
        inputFrom: 'edit',
        options: {
          transition: 'fade',
          imageEffect: 'ken-burns',
          subtitleEnabled: false,
          resolution: '1920x1080',
          fps: 30,
          format: 'mp4',
          defaultSceneDuration: 6,
          generateBase: true,
          generateMerged: true,
        },
      },
    ],
  },
  {
    name: 'hybrid',
    description: '混合流水线 - AI 生成 + 实拍素材混合',
    category: 'hybrid',
    stages: ['plan', 'generate', 'merge', 'render'],
    estimatedCost: 'high',
    // 真实编排：LLM 方案→视频生成 provider→FFmpeg 拼接（videogen-stages.js 注册）
    stageDefs: [
      { name: 'plan', type: 'videogen_script', description: '混合方案与解说文案', checkpointRequired: false, options: {} },
      { name: 'generate', type: 'videogen_storyboard', description: '生成场景规划', checkpointRequired: false, options: { kind: 'hybrid' } },
      { name: 'merge', type: 'videogen_generate', description: '视频生成', checkpointRequired: false, options: {} },
      { name: 'render', type: 'videogen_merge', description: '拼接合成与产物校验', checkpointRequired: false, options: {} },
    ],
  },
  {
    name: 'localization-dub',
    description: '本地化配音 - 视频翻译 + 多语言配音',
    category: 'hybrid',
    stages: ['transcribe', 'translate', 'tts', 'sync'],
    estimatedCost: 'medium',
    // 真实编排：源视频+文案→分句时间段→LLM 翻译→TTS 配音→FFmpeg 替换音轨（localization-stages.js 注册）
    stageDefs: [
      {
        name: 'transcribe',
        type: 'localization_transcribe',
        description: '源视频与文案校验、时长探测',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'translate',
        type: 'localization_translate',
        description: '台词翻译为目标语言',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'tts',
        type: 'localization_tts',
        description: '逐段生成配音',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'sync',
        type: 'localization_sync',
        description: '拼接配音并替换原音轨',
        checkpointRequired: false,
        options: {},
      },
    ],
  },
  {
    name: 'podcast-repurpose',
    description: '播客转视频 - 音频 → 可视化视频',
    category: 'hybrid',
    stages: ['analyze', 'visualize', 'assemble', 'render'],
    estimatedCost: 'low',
    stageDefs: [
      {
        name: 'analyze',
        type: 'podcast_analyze',
        description: '音频时长探测 + 文案分句成时间段',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'visualize',
        type: 'podcast_visualize',
        description: '每段文案生成配图',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'assemble',
        type: 'podcast_assemble',
        description: '切分音频片段并组装场景',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'render',
        type: 'compose',
        description: '视频合成（图片 + 音频片段 + 转场）',
        checkpointRequired: false,
        inputFrom: 'assemble',
        options: {
          transition: 'fade',
          imageEffect: 'none',
          subtitleEnabled: false,
          resolution: '720x1280',
          fps: 30,
          format: 'mp4',
          defaultSceneDuration: 6,
          voiceVolume: 1,
        },
      },
    ],
  },
  {
    name: 'screen-demo',
    description: '屏幕演示录制 - 录制 + 自动标注',
    category: 'screen_recording',
    stages: ['record', 'annotate', 'render'],
    estimatedCost: 'low',
  },
  {
    name: 'framework-smoke',
    description: '框架冒烟测试 - 快速验证流水线配置',
    category: 'custom',
    stages: ['verify', 'report'],
    estimatedCost: 'low',
    // 真实编排：验证工具链 → 生成冒烟测试视频与报告（smoketest-stages.js 注册）
    stageDefs: [
      {
        name: 'verify',
        type: 'smoketest_verify',
        description: '验证 FFmpeg/ffprobe 与流水线注册表',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'report',
        type: 'smoketest_report',
        description: '生成冒烟测试视频与报告',
        checkpointRequired: false,
        options: {},
      },
    ],
  },
  {
    name: 'film-engineering',
    description: '影视工程（Hell Grind 复刻） - 真实分镜提示词库浏览/一键复制/剧本套用/导出',
    category: 'generated',
    stages: ['load_template', 'adapt_script', 'select_shots', 'export_prompts', 'generate_videos', 'render'],
    estimatedCost: 'high',
    stageDefs: [
      {
        name: 'load_template',
        type: 'film_load_template',
        description: '加载 Hell Grind 影视工程模板（film-kit，fail-closed）',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'adapt_script',
        type: 'film_adapt_script',
        description: '剧本分场并按 Hell Grind 模板组装提示词',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'select_shots',
        type: 'film_select_shots',
        description: '按选中分镜 id 过滤（kit 或 adapted）',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'export_prompts',
        type: 'film_export_prompts',
        description: '导出选中分镜提示词（JSON/Markdown）',
        checkpointRequired: false,
        options: {},
      },
      {
        name: 'generate_videos',
        type: 'film_generate_videos',
        description: '分镜视频生成（成本确认入口闸，原文直送）',
        checkpointRequired: true,
        checkpointType: 'cost_confirm',
        options: {},
      },
      {
        name: 'render',
        type: 'film_render',
        description: '成片合成（concat/归一，产物 final.mp4）',
        checkpointRequired: false,
        options: {},
      },
    ],
  },
  {
    name: 'story2video-compose',
    description: 'Story2Video 文案转视频 - 分句+提示词优化+资源生成+合成+发布',
    category: 'generated',
    stages: ['split', 'scene_context', 'optimize', 'select_video_scenes', 'generate_assets', 'compose', 'publish'],
    estimatedCost: 'high',
    // stageDefs 定义每个阶段的执行类型和参数（供 StageExecutor 使用）
    // 旧流水线无 stageDefs 字段，回退为 MANUAL_CHECKPOINT
    stageDefs: [
      {
        name: 'split',
        type: 'split', // 内置 STAGE_TYPES.SPLIT
        description: '文案分句',
        checkpointRequired: false,
        options: {
          language: 'auto',
          mode: 'balanced',
          max_sentence_length: 200,
          target_duration: 6,
          base_words_per_second: 3.3,
          speech_rate: 1,
          target_chars_per_scene: 20,
          min_words: 10,
          max_words: 50,
          enforce_sentence_boundary: true,
          overflow_to_next: true,
          subtitle_min_chars: 8,
          subtitle_max_chars: 15,
          subtitle_timing: 'proportional',
          fallback_to_local: true,
          require_scene_output: true,
        },
        inputFrom: null, // 从 params.text 取
      },
      {
        name: 'scene_context',
        type: 'story2video_scene_context', // 自定义类型：场景上下文增强中间层（2026-08-11；2026-08-14 吸收 domain_enrich 职责）
        description: '场景上下文增强 + 历史内容增强：读全文提取全局故事背景并融合进每个场景（时代/地域/角色/道具/风格/负面锚点），contentType=history 时为每个场景生成 imagePromptSeed 视觉种子',
        checkpointRequired: false,
        options: {
          enabled: true,
          max_summary_length: 300,
          max_anchors: 8,
          include_negative_anchors: true,
          context_block_max_chars: 400,
          contentType: 'general',
        },
        inputFrom: 'split', // 从 context.split 取（scene_context 内部还读 params.text 全文）
      },
      {
        name: 'optimize',
        type: 'story2video_optimize', // 自定义类型：统一走 prompt-engine（8013）
        description: '图片提示词统一经 prompt-engine 优化（风格检测/改写/输出校验）',
        checkpointRequired: true,
        options: {
          platform: 'generic',
          style: 'realistic',
          creative_level: 5,
          optimization_strategy: 'llm',
          max_length: 2000,
          num_candidates: 1,
          auto_detect_style: true,
          negative_prompt: '',
        },
        inputFrom: 'scene_context', // 从 context.scene_context 取（getOptimizationScenes 优先）
      },
      {
        name: 'select_video_scenes',
        type: 'story2video_select_video_scenes', // 自定义类型：视频+图片轮播混合模式的场景选择（2026-08-11）
        description: 'AI 视频场景选择（fixed 固定比例 / ai-judged 智能判断）',
        checkpointRequired: false,
        options: {
          video: {
            mode: 'off',
            provider: null,
            model: null,
            fixedRatio: 25,
            minRatio: 20,
            maxRatio: 40,
            maxScenes: 3,
          },
        },
        inputFrom: 'optimize', // 从 context.optimize + context.split 取（执行器内部处理）
      },
      {
        name: 'generate_assets',
        type: 'story2video_generate_assets', // 自定义类型，由 story2video-stages.js 注册
        description: '并行资源生成（图片 + TTS + 可选 AI 视频）',
        checkpointRequired: true,
        options: {
          concurrency: 3,
          imageStyle: 'cinematic',
          imageProvider: null,
          imageModel: null,
          aspectRatio: '9:16',
          voiceId: 'default',
          voiceProvider: null,
          voiceModel: null,
          voiceSpeed: 1,
          voicePitch: 0,
          voiceEmotion: 'default',
          contentType: 'general',
          inputMode: 'text',
          templateId: null,
        },
        // 从 context.optimize + context.split 取（执行器内部处理）
      },
      {
        name: 'finalize_assets',
        type: 'story2video_finalize_assets', // 自定义类型：分镜素材自选（manual）确认后生成 TTS 并组装最终素材清单
        description: '素材确认后生成旁白并组装最终素材（分镜素材自选模式）',
        checkpointRequired: false,
        options: {
          creationMode: 'auto',
        },
        inputFrom: 'generate_assets', // 从 context.generate_assets.candidates + context.scene_asset_selection 取
      },
      {
        name: 'compose',
        type: 'compose', // 内置 STAGE_TYPES.COMPOSE
        description: '视频合成',
        checkpointRequired: true,
        options: {
          composeParallelTask: 'story2video_prompt_translation_compose',
          // Story2Video 引擎选项
          transition: 'fade',
          imageEffect: 'zoom-in',
          subtitleEnabled: false,
          subtitleStyle: {
            font: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
            size: 'md',
            style: 'style1',
            color: 'white',
          },
          bgmPath: null,
          bgmVolume: 0.5,
          voiceVolume: 1,
          watermark: false,
          watermarkText: '',
          watermarkConfig: {
            enabled: false,
            text: '',
            position: 'bottom-right',
            fontSize: 24,
            opacity: 0.6,
            color: 'white',
          },
          resolution: '720x1280',
          fps: 30,
          format: 'mp4',
          defaultSceneDuration: 6,
          sceneDurationMode: 'follow-audio',
          minSceneDuration: 6,
          generateBase: true,
          generateMerged: true,
          seconds: 8,
        },
        inputFrom: 'generate_assets', // 从 context.generate_assets 取
      },
      {
        name: 'publish',
        type: 'publish', // 内置 STAGE_TYPES.PUBLISH
        description: '多平台发布',
        checkpointRequired: true,
        options: {
          publishEnabled: false,
          platforms: [],
          title: '',
          content: '',
          tags: [],
          coverUrl: '',
        },
        inputFrom: 'compose', // 从 context.compose 取 videoPath
      },
    ],
  },
];

class PipelineEngine {
  /**
   * @param {object} [deps] - 依赖（全部可选，保证向后兼容）
   * @param {object} [deps.serviceBus] - ServiceBus 实例
   * @param {object} [deps.container] - DI 容器
   * @param {object} [deps.stageExecutor] - 自定义 StageExecutor 实例（不传则自动构造）
   * @param {object} [deps.aiGenerator] - 当前默认模型调用器
   * @param {object} [deps.log] - 日志模块
   */
  constructor(deps) {
    this._runs = new Map();
    this._currentPipeline = null;
    this._history = [];
    this._eventListeners = new Map(); // Backlot 事件系统

    deps = deps || {};
    this.serviceBus = deps.serviceBus || null;
    this.container = deps.container || null;
    this.log = deps.log || require('./logger');
    // 启动前模型能力前置校验依赖（生产由 phase1-context 注入 ModelProviderManager 实例）
    this.modelProviderManager = deps.modelProviderManager || null;
    this.aiGenerator = deps.aiGenerator || null;
    this.story2videoProjectService = deps.story2videoProjectService || null;
    this.runStateStore = deps.runStateStore || null;
    this.governor = deps.governor || null;
    // 可选：run 终结后的上报/扩展钩子（additive，默认 null；_finalizeRun 内 try/catch 调用）
    this._runFinalizedHook = typeof deps.runFinalizedHook === 'function' ? deps.runFinalizedHook : null;
    // 后台并行运行上限（编排模式）：同机资源有限（ffmpeg 合成 CPU 密集、API 受 governor 限流）。
    // 优先级：deps.maxConcurrentRuns 显式注入（测试/调优）> STORY2VIDEO_MAX_CONCURRENT_RUNS 环境变量开关
    // （如设 2 即固定 2 条，1-8 合法，非法/空回退自适应）> 机器资源自适应（computeDefaultMaxConcurrentRuns，1-4 条）。
    const envLimit = Number(process.env.STORY2VIDEO_MAX_CONCURRENT_RUNS)
    this.maxConcurrentRuns = Number.isFinite(Number(deps.maxConcurrentRuns)) && Number(deps.maxConcurrentRuns) > 0
      ? Number(deps.maxConcurrentRuns)
      : (Number.isFinite(envLimit) && envLimit > 0 ? Math.min(8, Math.floor(envLimit)) : computeDefaultMaxConcurrentRuns());
    // 内存历史上限：_history 保留最近 N 条 run 快照，防止长期运行内存无限增长。
    // 断点恢复跨重启依赖 RunStateStore 持久快照，不受内存历史裁剪影响。
    this.maxHistoryEntries = Number.isFinite(Number(deps.maxHistoryEntries)) && Number(deps.maxHistoryEntries) > 0
      ? Number(deps.maxHistoryEntries)
      : 50;

    // 自动构造 StageExecutor（仅在 serviceBus 可用时）
    if (deps.stageExecutor) {
      this.stageExecutor = deps.stageExecutor;
    } else if (this.serviceBus) {
      try {
        this.stageExecutor = new StageExecutor({
          serviceBus: this.serviceBus,
          container: this.container,
          log: this.log,
        });
      } catch (e) {
        this.log.warn('PipelineEngine',
          'StageExecutor init failed: ' + (e instanceof Error ? e.message : String(e)));
        this.stageExecutor = null;
      }
    } else {
      // 无 serviceBus 时退化为纯状态机（兼容旧测试）
      this.stageExecutor = null;
    }
  }

  // ============================================================
  // Backlot 事件系统（on/off/_emit）
  // ============================================================

  /**
   * 订阅事件
   * @param {string} event - 事件名（如 'pipeline:start', 'stage:complete'）
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  on(event, callback) {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, []);
    }
    this._eventListeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  /**
   * 取消订阅事件
   */
  off(event, callback) {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      const idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  /**
   * 发射事件（单个 listener 失败不影响其他）
   * @protected
   */
  _emit(event, data) {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try { cb(data); } catch (_) { /* 单个 listener 失败不影响其他 */ }
      }
    }
  }

  /** 列出所有可用流水线（内置 + 动态注册） */
  listPipelines() {
    const prioritizedBuiltIn = [
      ...PIPELINES.filter((pipeline) => pipeline.name === STORY2VIDEO_PIPELINE),
      ...PIPELINES.filter((pipeline) => pipeline.name !== STORY2VIDEO_PIPELINE),
    ]
    const hasRealStages = (p) => Array.isArray(p.stageDefs) && p.stageDefs.length > 0
    const builtIn = prioritizedBuiltIn.map((p) => ({
      name: p.name,
      description: p.description,
      category: p.category,
      stageCount: p.stages.length,
      estimatedCost: p.estimatedCost,
      // 是否已实现真实执行引擎：有 stageDefs 即认为可真实运行
      available: hasRealStages(p),
    }));
    const custom = this._customPipelines
      ? Array.from(this._customPipelines.values()).map((p) => ({
          name: p.name,
          description: p.description,
          category: p.category,
          stageCount: p.stages.length,
          estimatedCost: p.estimatedCost,
          available: hasRealStages(p),
        }))
      : [];
    return builtIn.concat(custom);
  }

  /** 获取单个流水线详情 */
  getPipeline(name) {
    const pl = PIPELINES.find((p) => p.name === name) ||
               (this._customPipelines && this._customPipelines.get(name));
    if (!pl) return null;
    return { ...pl }; // Return full detail including stages
  }

  /**
   * 动态注册流水线（插件扩展点）
   * 允许 PluginRegistry 或外部模块注册新流水线，无需修改源码中的 PIPELINES 数组
   * @param {object} def - 流水线定义 { name, description, category, stages, stageDefs?, estimatedCost? }
   * @returns {{success: boolean, error?: string}}
   */
  registerPipeline(def) {
    if (!def || !def.name || !Array.isArray(def.stages)) {
      return { success: false, error: 'Pipeline definition requires name and stages array', errorCode: 'PIPELINE_INVALID_DEF' };
    }
    if (PIPELINES.find((p) => p.name === def.name) ||
        (this._customPipelines && this._customPipelines.has(def.name))) {
      return { success: false, error: 'Pipeline already exists: ' + def.name, errorCode: 'PIPELINE_ALREADY_EXISTS' };
    }
    if (!this._customPipelines) this._customPipelines = new Map();
    this._customPipelines.set(def.name, {
      name: def.name,
      description: def.description || '',
      category: def.category || 'custom',
      stages: def.stages,
      stageDefs: def.stageDefs,
      estimatedCost: def.estimatedCost || 'medium',
    });
    this.log.info('PipelineEngine', 'Registered custom pipeline: ' + def.name);
    return { success: true };
  }

  /** 启动流水线执行（state_machine 模式，同步） */
  start(pipelineName, params) {
    const pl = this.getPipeline(pipelineName);
    if (!pl) return { success: false, error: 'Unknown pipeline: ' + pipelineName, errorCode: 'PIPELINE_UNKNOWN' };

    const stageDefs = Array.isArray(pl.stageDefs) ? pl.stageDefs : [];
    const stageDefByName = new Map(stageDefs.map((def) => [def.name, def]));
    const runId = generateRunId();
    const run = {
      id: runId,
      pipeline: pipelineName,
      status: 'running',
      currentStage: 0,
      stages: pl.stages.map((s, i) => ({
        name: s,
        type: stageDefByName.get(s)?.type,
        requiresCheckpoint: Boolean(
          stageDefByName.get(s)?.checkpointRequired ??
          stageDefByName.get(s)?.requiresCheckpoint,
        ),
        checkpointType: stageDefByName.get(s)?.checkpointType || 'stage',
        status: i === 0 ? 'running' : 'pending',
        startedAt: i === 0 ? new Date().toISOString() : null,
        completedAt: null,
        // 阶段级进行中信息（统一契约，见 openspec change pipeline-progress-feedback-unification）
        progress: null,
        summary: null,
      })),
      params: params || {},
      progress: 0,
      checkpoint: null,
      createdAt: new Date().toISOString(),
      // 已用时统计：各执行段实际耗时累计（毫秒），_executeStage 为唯一累计点；暂停/检查点等待/失败→恢复空闲不计入
      activeMs: 0,
      _activeSegmentStartedAt: null,
      // 编排模式扩展字段（默认 state_machine 模式不使用）
      orchestrationMode: 'state_machine',
      // 批量创作标记（2026-08-14）：仅批量队列透传；历史记录/统计据此区分来源。
      source: params.source === 'batch' ? 'batch' : undefined,
      batchId: params.source === 'batch' && typeof params.batchId === 'string' ? params.batchId : undefined,
      batchItemId: params.source === 'batch' && typeof params.batchItemId === 'string' ? params.batchItemId : undefined,
      context: {},
      stageResults: [],
    };

    this._runs.set(runId, run);
    // 批量 run 不写 _<name> 索引/currentPipeline：手动流水线启动页按索引查询状态，
    // 若被批量 run 覆盖，手动页面会读到批量任务进度（状态串扰）。
    if (run.source !== 'batch') {
      this._runs.set('_' + pipelineName, run); // Also index by pipeline name
      this._currentPipeline = pipelineName;
    }

    // Backlot 事件：流水线启动
    this._emit('pipeline:start', { runId, pipelineType: pipelineName, stages: run.stages.map(s => s.name) });

    return { success: true, runId };
  }

  /** 暂停当前流水线 */
  pause() {
    const run = this._getCurrentRun();
    if (!run) return { success: false, error: 'No active pipeline', errorCode: 'PIPELINE_NO_ACTIVE' };
    if (run.status !== 'running') return { success: false, error: 'Pipeline is not running', errorCode: 'PIPELINE_NOT_RUNNING' };
    const stage = Array.isArray(run.stages) && Number.isInteger(run.currentStage)
      ? run.stages[run.currentStage]
      : null;
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return { success: false, error: 'Pipeline stage state is invalid', errorCode: 'PIPELINE_STAGE_INVALID' };

    run.status = 'paused';
    stage.status = 'paused';
    this._syncStory2VideoProjectStatus(run);
    return { success: true };
  }

  /** 恢复流水线执行 */
  resume() {
    const run = this._getCurrentRun();
    if (!run) return { success: false, error: 'No active pipeline', errorCode: 'PIPELINE_NO_ACTIVE' };
    if (run.status !== 'paused') return { success: false, error: 'Pipeline is not paused', errorCode: 'PIPELINE_NOT_PAUSED' };
    const stage = Array.isArray(run.stages) && Number.isInteger(run.currentStage)
      ? run.stages[run.currentStage]
      : null;
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return { success: false, error: 'Pipeline stage state is invalid', errorCode: 'PIPELINE_STAGE_INVALID' };

    run.status = 'running';
    stage.status = 'running';
    this._syncStory2VideoProjectStatus(run);
    return { success: true };
  }

  /** 取消流水线 */
  cancel() {
    const run = this._getCurrentRun();
    if (!run) return { success: false, error: 'No active pipeline', errorCode: 'PIPELINE_NO_ACTIVE' };

    run.cancelled = true;
    run.status = 'cancelled';
    run.stages[run.currentStage].status = 'cancelled';
    // 已用时口径说明（W1 审查闭环）：cancel 为同步操作，若当前执行器在飞，本段耗时由 _executeStage 的
    // finally 在异步结算后累加进该 run 对象；终态 history/快照在 finalize 时浅拷贝 activeMs，因此取消瞬间
    // 的在飞半段不计入已取消记录的展示值（已取消任务不可断点恢复，仅影响取消记录的时长展示，可接受）。
    // Backlot 事件：流水线取消
    this._emit('pipeline:fail', { runId: run.id, pipelineType: run.pipeline, error: 'cancelled' });
    this._finalizeRun(run, 'cancelled', 'cancelled');
    return { success: true };
  }

  /** 获取流水线运行状态 */
  getStatus(pipelineName) {
    // Try exact run id first, then pipeline name
    const run = this._runs.get(pipelineName) || this._runs.get('_' + pipelineName);
    if (!run) return { status: 'idle', pipeline: pipelineName };

    return {
      id: run.id,
      pipeline: run.pipeline,
      status: run.status,
      currentStage: run.currentStage,
      stages: run.stages,
      totalStages: run.stages.length,
      progress: this._calcProgress(run),
      checkpoint: run.checkpoint,
      createdAt: run.createdAt,
      // 编排模式扩展字段
      orchestrationMode: run.orchestrationMode || 'state_machine',
      contextKeys: run.context ? Object.keys(run.context) : [],
    };
  }

  /**
   * 获取历史执行记录（含运行中未完成的编排流水线，便于历史页实时查看进度）。
   * 运行中 run 在前，终态历史在后；_runs 中 <runId> 与 _<pipelineName> 指向同一对象，需去重。
   */
  getHistory() {
    const seen = new Set();
    const seenIds = new Set();
    const active = [];
    for (const run of this._runs.values()) {
      if (seen.has(run)) continue;
      seen.add(run);
      if (run.id) seenIds.add(run.id);
      active.push(run);
    }
    for (const item of this._history) {
      if (item && item.id) seenIds.add(item.id);
    }
    // 合并持久化快照（runStateStore）：应用重启后，失败/取消任务仍显示在历史记录中；
    // 运行中断（强杀/退出兜底）的任务以 running 状态显示，可「从断点继续」。
    // 与内存 run/_history 按 runId 去重，避免同一条任务重复展示。
    const persisted = [];
    if (this.runStateStore) {
      const listers = []
      if (typeof this.runStateStore.listFailed === 'function') listers.push(() => this.runStateStore.listFailed())
      if (typeof this.runStateStore.listRunning === 'function') listers.push(() => this.runStateStore.listRunning())
      try {
        for (const lister of listers) {
        for (const snapshot of lister()) {
          const id = snapshot.runId
          if (!id || seenIds.has(id)) continue
          seenIds.add(id)
          // 运行中快照在应用重启后不再是运行中状态，转为「已中断」（区别于用户手动暂停：
          // 手动暂停经 savePaused 落盘为 paused；running 残留为应用退出/崩溃导致）；记录中断环节
          const normalizedStatus = snapshot.status === 'running' ? 'interrupted' : (snapshot.status || 'failed')
          const pausedStageIndex = Number.isInteger(snapshot.currentStage) ? snapshot.currentStage : -1
          const pausedStageName = (Array.isArray(snapshot.stages) && pausedStageIndex >= 0 && pausedStageIndex < snapshot.stages.length)
            ? (snapshot.stages[pausedStageIndex].name || snapshot.stages[pausedStageIndex].stage || '') : ''
          persisted.push({
            id,
            // 快照须携带 projectId（旧快照缺失时回退 runId 本身）：历史页据此匹配 story2video 项目，
            // 避免 run-only 卡片丢失标题与文案预览（2026-08-20 修复）
            projectId: snapshot.projectId || id,
            pipeline: snapshot.pipeline,
            status: normalizedStatus,
            currentStage: pausedStageIndex >= 0 ? pausedStageIndex : 0,
            pausedStage: pausedStageName || null,
            stages: Array.isArray(snapshot.stages) ? snapshot.stages.map((s) => ({ ...s })) : [],
            context: snapshot.context && typeof snapshot.context === 'object' ? snapshot.context : {},
            params: snapshot.params && typeof snapshot.params === 'object' ? snapshot.params : {},
            error: snapshot.error || null,
            orchestrationMode: snapshot.orchestrationMode || 'orchestrator',
            createdAt: snapshot.createdAt || snapshot.endedAt || null,
            updatedAt: snapshot.endedAt || snapshot.createdAt || null,
            completedAt: snapshot.endedAt || null,
            // 已用时：持久化快照携带 activeMs（旧快照无该字段时为 null，由前端回退链处理）
            activeMs: Number.isFinite(Number(snapshot.activeMs)) ? Number(snapshot.activeMs) : null,
            // 分镜素材自选暂停检查点：透传 checkpoint，前端据此进入选择面板（W1 修复 2026-08-12）
            checkpoint: snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
              ? snapshot.checkpoint
              : null,
          })
        }
        }
      } catch (_) { /* 快照读取失败不影响历史展示 */ }
    }
    return [...active, ...this._history, ...persisted];
  }

  /**
   * 删除一条历史运行记录（含持久化快照）。运行中的 run 拒绝删除。
   * 供历史记录页删除无 projectId 的 run 记录（有 projectId 的任务走 story2video 项目删除）。
   * 仅删除记录本身，不清理 run 输入/输出文件（与取消路径的清理语义分离）。
   */
  deleteRun (runId) {
    if (typeof runId !== 'string' || !runId.trim()) return { success: false, error: 'runId 非法', errorCode: 'PIPELINE_INVALID_RUN_ID' }
    const id = runId.trim()
    const run = this._runs.get(id)
    if (run && run.status === 'running') return { success: false, error: '运行中的流水线不能删除', errorCode: 'PIPELINE_RUN_CANNOT_DELETE' }
    const historyIndex = this._history.findIndex(item => item && item.id === id)
    let hasSnapshot = false
    if (this.runStateStore && typeof this.runStateStore.remove === 'function') {
      // 持久化快照存在性：内存清空（应用重启）后仅剩快照的记录也要可删
      if (typeof this.runStateStore.load === 'function') {
        try {
          hasSnapshot = Boolean(this.runStateStore.load(id))
        } catch (loadError) {
          this.log.warn('PipelineEngine', 'run state snapshot load failed: ' + (loadError && loadError.message ? loadError.message : String(loadError)))
          return { success: false, error: '读取运行记录失败', errorCode: 'PIPELINE_RUN_READ_FAILED' }
        }
      }
      if (!run && historyIndex < 0 && !hasSnapshot) return { success: false, error: '运行记录不存在', errorCode: 'PIPELINE_RUN_NOT_FOUND' }
      try {
        const removeResult = this.runStateStore.remove(id)
        if (removeResult === false) {
          return { success: false, error: '删除运行记录失败：持久化快照未清理', errorCode: 'PIPELINE_SNAPSHOT_CLEANUP_FAILED' }
        }
      } catch (removeError) {
        this.log.warn('PipelineEngine', 'run state snapshot remove failed: ' + (removeError && removeError.message ? removeError.message : String(removeError)))
        return { success: false, error: '删除运行记录失败：持久化快照未清理', errorCode: 'PIPELINE_SNAPSHOT_CLEANUP_FAILED' }
      }
    } else if (!run && historyIndex < 0) {
      return { success: false, error: '运行记录不存在', errorCode: 'PIPELINE_RUN_NOT_FOUND' }
    }
    if (run) {
      this._runs.delete(id)
      if (this._runs.get('_' + run.pipeline) === run) {
        this._runs.delete('_' + run.pipeline)
        if (this._currentPipeline === run.pipeline) this._currentPipeline = null
      }
    }
    if (historyIndex >= 0) this._history.splice(historyIndex, 1)
    return { success: true, runId: id }
  }

  /** 当前正在运行的编排流水线数量（去重 _<name> 索引）。 */
  _countActiveRuns() {
    const seen = new Set();
    let count = 0;
    for (const run of this._runs.values()) {
      if (seen.has(run)) continue;
      seen.add(run);
      if (run.orchestrationMode === 'orchestrator' && run.status === 'running') count += 1;
    }
    return count;
  }

  /** 当前正在运行的「手动」编排流水线数量（去重 _<name> 索引；批量 run 不计入）。 */
  _countActiveManualRuns() {
    const seen = new Set();
    let count = 0;
    for (const run of this._runs.values()) {
      if (seen.has(run)) continue;
      seen.add(run);
      if (run.orchestrationMode === 'orchestrator' && run.status === 'running' && run.source !== 'batch') count += 1;
    }
    return count;
  }

  /** 是否存在运行中的编排流水线（去重 _<name> 索引；供窗口关闭→托盘决策）。 */
  hasRunningOrchestration() {
    const seen = new Set();
    for (const run of this._runs.values()) {
      if (seen.has(run)) continue;
      seen.add(run);
      if (run.orchestrationMode === 'orchestrator' && run.status === 'running') return true;
    }
    return false;
  }

  /**
   * 退出兜底：把所有运行中的编排流水线落盘为 running 快照。
   * 与阶段级 checkpoint（_saveRunningCheckpoint）互补，保证窗口关闭/退出瞬间
   * 的进行中任务在重启后仍可见并可「从断点继续」（2026-08-09 方案B）。
   * @returns {number} 成功落盘的任务数
   */
  saveRunningState() {
    if (!this.runStateStore || typeof this.runStateStore.saveRunning !== 'function') return 0;
    const seen = new Set();
    let saved = 0;
    for (const run of this._runs.values()) {
      if (seen.has(run)) continue;
      seen.add(run);
      if (run.orchestrationMode !== 'orchestrator' || run.status !== 'running') continue;
      try {
        if (this.runStateStore.saveRunning(run)) saved += 1;
      } catch (e) {
        this.log.warn('PipelineEngine', 'running state save failed: ' + (e && e.message ? e.message : String(e)));
      }
    }
    return saved;
  }

  /**
   * 阶段级 checkpoint：编排流水线进入某阶段执行前，把当前进度落盘为 running 快照。
   * 应用被强杀（taskkill /F）或异常退出时，仍能保留「该阶段未完成」的断点；
   * 恢复时从当前阶段重新执行（阶段级原子性：快照在 execute 之前写入）。
   */
  _saveRunningCheckpoint(run) {
    if (!run || run.orchestrationMode !== 'orchestrator' || !this.runStateStore) return;
    try {
      this.runStateStore.saveRunning(run);
    } catch (e) {
      this.log.warn('PipelineEngine', 'running checkpoint save failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  /**
   * 公开的阶段级 checkpoint 保存（供阶段执行器在资产增量生成后调用）。
   * 确保 generate_assets 等长时间阶段中途崩溃后，已完成的资产不丢失。
   * @param {string} runId
   */
  saveRunningCheckpoint(runId) {
    const run = this._runs.get(runId);
    if (!run) return;
    this._saveRunningCheckpoint(run);
  }

  /** 后台并行上限检查：超过 maxConcurrentRuns 时拒绝启动/恢复。 */
  _assertConcurrencyBudget() {
    const activeCount = this._countActiveRuns();
    if (activeCount >= this.maxConcurrentRuns) {
      return {
        success: false,
        error: '根据当前设备的内存占用情况，流水线已满负荷运行，请等待其中一条完成后再启动。',
        errorCode: 'PIPELINE_CONCURRENCY_LIMIT',
        errorParams: { count: activeCount, max: this.maxConcurrentRuns },
      };
    }
    return null;
  }

  /** 确认检查点（继续下一阶段） */
  advance() {
    const run = this._getCurrentRun();
    if (!run) return { success: false, error: 'No active pipeline', errorCode: 'PIPELINE_NO_ACTIVE' };

    return this._advanceRun(run, { skipped: this._isStageSkipped(null, run, run.stages[run.currentStage]) });
  }

  /**
   * 只推进指定运行，避免 orchestrator 按 runId 执行后误用全局 currentPipeline。
   * @param {object} run
   */
  _advanceRun(run, opts) {
    if (!run || !Array.isArray(run.stages) || !run.stages[run.currentStage]) {
      return { success: false, error: 'No active stage', errorCode: 'PIPELINE_NO_ACTIVE_STAGE' };
    }

    const skipped = Boolean(opts && opts.skipped);
    const completedStageName = run.stages[run.currentStage].name;
    // 检查点只代表当前阶段的暂停状态，推进后不能泄漏到下一个运行快照。
    run.checkpoint = null;
    // 未选发布平台等「可选阶段被跳过」语义：以 skipped 而非 completed 收尾，
    // 让 run 阶段快照/历史/进度板能明确区分「真实完成」与「跳过」。
    const stageRef = run.stages[run.currentStage];
    const completedAt = new Date().toISOString();
    stageRef.status = skipped ? 'skipped' : 'completed';
    stageRef.completedAt = completedAt;
    if (skipped) stageRef.skippedAt = completedAt;

    // Backlot 事件：阶段完成（跳过阶段同样触发，供进度板/实时推送同步）
    this._emit('stage:complete', { runId: run.id, stageName: completedStageName, stageIndex: run.currentStage });

    // Advance to next stage
    run.currentStage++;
    if (run.currentStage >= run.stages.length) {
      this._finalizeRun(run, 'completed');
      if (run.status !== 'completed') {
        // 项目持久化失败时只发失败终态，禁止 renderer/批量队列误判为完成。
        const error = run.error || 'Story2Video 项目保存失败';
        this._emit('pipeline:fail', { runId: run.id, pipelineType: run.pipeline, error });
        return { success: false, error, errorCode: 'STORY2VIDEO_PROJECT_SAVE_FAILED' };
      }
      // Backlot 事件：流水线完成（totalDuration 用步骤执行耗时累计口径，不用墙钟 createdAt→now）
      this._emit('pipeline:complete', { runId: run.id, pipelineType: run.pipeline, totalDuration: this._computeElapsedMs(run) });
      return { success: true, message: 'Pipeline completed' };
    }

    run.stages[run.currentStage].status = 'running';
    run.stages[run.currentStage].startedAt = new Date().toISOString();
    run.progress = this._calcProgress(run);

    // Backlot 事件：阶段开始
    this._emit('stage:start', { runId: run.id, stageName: run.stages[run.currentStage].name, stageIndex: run.currentStage });

    // Check if next stage requires user checkpoint
    const checkpoint = run.stages[run.currentStage].requiresCheckpoint || false;

    return { success: true, currentStage: run.stages[run.currentStage].name, checkpoint };
  }

  /**
   * 判断阶段执行结果是否为「跳过」（如发布阶段未选择任何平台）。
   * 优先读执行结果 output.skipped；检查点恢复等没有新执行结果的路径回退读 run.context[stageName]。
   * @param {object|null} execResult
   * @param {object|null} run
   * @param {object|null} stage
   * @returns {boolean}
   */
  _isStageSkipped(execResult, run, stage) {
    if (execResult && execResult.output && execResult.output.skipped === true) return true;
    if (!stage || !run || !run.context) return false;
    const name = stage.name || stage.stage;
    if (!name) return false;
    const out = run.context[name];
    return !!(out && out.skipped === true);
  }
  async fetchPipelineFromBackend(pipelineName) {
  /** 通过 Python 后端加载流水线完整定义 */
    const bridge = this._getPythonBridge();
    if (bridge && bridge.isRunning()) {
      try {
        const result = await bridge.requestBackend('GET', '/api/pipelines/' + pipelineName, null, 10000);
        if (result && result.code === 0 && result.data) {
          // Merge backend data with local metadata
          const local = this.getPipeline(pipelineName);
          return { ...local, fullManifest: result.data };
        }
      } catch {
        // Fall back to local data
      }
    }
    return this.getPipeline(pipelineName);
  }

  // ============================================================
  // 编排模式（Orchestrator）扩展方法
  // ============================================================

  /**
   * 启动编排模式流水线
   * @param {string} pipelineName
   * @param {object} [params] - { autoAdvance?: boolean, ...流水线特定参数 }
   * @returns {Promise<{success: boolean, runId?: string, error?: string, errorCode?: string|null, errorParams?: { max?: number }|null, results?: any[], context?: object, paused?: boolean}>}
   */
  async startOrchestrated(pipelineName, params) {
    if (!this.stageExecutor) {
      return {
        success: false,
        error: 'StageExecutor not configured (ServiceBus missing). Use start() for state_machine mode.',
      };
    }
    const pl = this.getPipeline(pipelineName);
    if (!pl) return { success: false, error: 'Unknown pipeline: ' + pipelineName, errorCode: 'PIPELINE_UNKNOWN' };

    params = params || {};
    if (typeof params !== 'object' || Array.isArray(params)) {
      return { success: false, error: 'Pipeline params must be an object', errorCode: 'PIPELINE_INVALID_PARAMS' };
    }
    // 批量创作标记（2026-08-14）：normalizer 重建 params 会丢弃未知字段，先白名单提取、
    // normalize 后重新附加，保证 run 打标（source/batchId/batchItemId）不丢失。
    const batchMeta = {
      source: params.source === 'batch' ? 'batch' : undefined,
      batchId: params.source === 'batch' && typeof params.batchId === 'string' && params.batchId.trim()
        ? params.batchId.trim()
        : undefined,
      batchItemId: params.source === 'batch' && typeof params.batchItemId === 'string' && params.batchItemId.trim()
        ? params.batchItemId.trim()
        : undefined,
    }
    if (pipelineName === STORY2VIDEO_PIPELINE) {
      try {
        params = normalizeStory2VideoTextParams(params);
      } catch (error) {
        // BGM 可复用（前端配置仍引用），归一化拒绝回滚清理同样跳过，避免重试时 BGM 丢失。
        try { cleanupImportedMediaPaths(params, { skipBgm: true }); } catch (_) { /* 拒绝非法模式时尽力清理已导入媒体。 */ }
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error?.code || 'INVALID_PARAMS',
          errorParams: error?.params || null,
        };
      }
    }
    // 批量创作标记重新附加（normalizer 重建 params 后）
    if (batchMeta.source === 'batch') {
      params.source = 'batch'
      params.batchId = batchMeta.batchId
      params.batchItemId = batchMeta.batchItemId
    }
    const initialContext = params.initialContext !== undefined
      ? params.initialContext
      : (params.context !== undefined ? params.context : {});
    if (!initialContext || typeof initialContext !== 'object' || Array.isArray(initialContext)) {
      return { success: false, error: 'Invalid initialContext: expected an object', errorCode: 'PIPELINE_INVALID_CONTEXT' };
    }
    let serializedContext;
    try {
      serializedContext = JSON.parse(JSON.stringify(initialContext));
    } catch (e) {
      return { success: false, error: 'Invalid initialContext: ' + e.message, errorCode: 'PIPELINE_INVALID_CONTEXT' };
    }

    // 启动前模型能力前置校验（2026-08-28）：按「流水线 → 所需模型能力」映射统一拦截，
    // 模型缺失时在创建 run 之前返回结构化错误（手动/批量同一入口，story2video 参数已归一化）。
    // 断点续跑（resumeOrchestration）不做前置拦截，保持恢复语义。
    const modelPreflight = checkPipelineModelRequirements(
      this.modelProviderManager,
      pipelineName,
      params,
      this.log,
    )
    if (!modelPreflight.success) {
      return {
        success: false,
        error: modelPreflight.error,
        errorCode: modelPreflight.errorCode,
        errorParams: modelPreflight.errorParams,
      };
    }

    // 后台并行上限：超过 maxConcurrentRuns 拒绝启动（资源保护）。
    const concurrencyBlock = this._assertConcurrencyBudget();
    if (concurrencyBlock) return concurrencyBlock;
    // 上下文验证通过后再创建 run，避免非法输入留下孤儿运行。
    const startResult = this.start(pipelineName, params);
    if (!startResult.success) return startResult;

    const runId = startResult.runId;
    const run = this._runs.get(runId);
    if (!run) return { success: false, error: 'Failed to create run', errorCode: 'PIPELINE_CREATE_FAILED' };

    // 标记为编排模式
    run.orchestrationMode = 'orchestrator';
    run.context = serializedContext;
    run.stageResults = [];

    // 分镜素材自选（creation.mode='manual'）：generate_assets 产出候选并以 scene_asset_selection
    // 检查点暂停，用户确认后在 compose 前插入 finalize_assets 阶段生成 TTS 并组装最终素材清单。
    if (pipelineName === 'story2video-compose' && params?.story2videoTextConfig?.creation?.mode === 'manual') {
      const insertIndex = run.stages.findIndex((s) => s && s.name === 'compose')
      if (insertIndex > 0 && !run.stages.some((s) => s && s.name === 'finalize_assets')) {
        run.stages.splice(insertIndex, 0, {
          name: 'finalize_assets',
          type: 'story2video_finalize_assets',
          requiresCheckpoint: false,
          checkpointType: 'stage',
          status: 'pending',
          startedAt: null,
          completedAt: null,
        })
        this.log.info('PipelineEngine', 'story2video-compose manual mode: inserted finalize_assets stage (run=' + runId + ')')
      }
    };

    // 阶段级 checkpoint：启动即落盘 running 快照，应用退出/强杀后任务不丢失。
    this._saveRunningCheckpoint(run);

    if (params.autoAdvance) {
      if (params.background === true) {
        // 后台自动推进：立即返回 runId，renderer 通过 getRunSnapshot 轮询阶段进度。
        // 若同步等待整个流水线完成，IPC 会阻塞数十秒到数分钟，前端启动后无任何交互反馈。
        const promise = this._autoAdvanceRun(runId);
        promise.catch((err) => {
          this.log.warn('PipelineEngine', 'background autoAdvance failed: ' + (err && err.message ? err.message : String(err)));
        });
        return { success: true, runId };
      }
      return await this._autoAdvanceRun(runId);
    }

    return { success: true, runId };
  }

  /**
   * 从失败/中断断点恢复编排流水线（断点续跑）。
   * 数据源：本次会话内存 history，或 RunStateStore 持久化快照（跨应用重启仍可恢复）。
   * - 失败快照：从失败阶段重新执行；
   * - 运行中快照（应用退出/强杀兜底落盘）：从中断阶段重新执行（阶段级原子性）。
   * 前序阶段输出（context）与已完成的资源直接复用。
   * 内容政策失败（needs_user_input）不允许恢复，必须修改文案后重新启动。
   * @param {string} runId
   * @returns {Promise<{success: boolean, runId?: string, alreadyRunning?: boolean, error?: string, errorCode?: string}>}
   */
  async resumeOrchestration(runId) {
    if (typeof runId !== 'string' || !runId.trim()) {
      return { success: false, error: '缺少或非法 runId', errorCode: 'PIPELINE_INVALID_RUN_ID' };
    }
    // 同会话幂等：内存中已是 running 的编排 run 直接返回，避免重复创建运行
    // （renderer 重载/重复点击「继续」时，主进程仍在后台执行该任务）。
    const activeRun = this._runs.get(runId);
    if (activeRun && activeRun.orchestrationMode === 'orchestrator' && activeRun.status === 'running') {
      return { success: true, runId: activeRun.id, alreadyRunning: true };
    }
    // 分镜素材自选：内存中已暂停于选择检查点的 run 直接返回 paused，不重跑 generate_assets
    if (activeRun && activeRun.orchestrationMode === 'orchestrator' && activeRun.status === 'paused' &&
        activeRun.checkpoint && ['scene_asset_selection', 'cost_confirm'].includes(activeRun.checkpoint.type)) {
      return { success: true, runId: activeRun.id, paused: true };
    }
    const historyRun = this._history.find((item) => item.id === runId);
    let snapshot = historyRun || null;
    if (!snapshot && this.runStateStore) {
      try { snapshot = await this.runStateStore.load(runId); } catch (_) { snapshot = null; }
    }
    if (!snapshot) return { success: false, error: '未找到可恢复的运行快照', errorCode: 'RUN_SNAPSHOT_NOT_FOUND' };
    // 需用户确认的暂停检查点（分镜素材自选 / 成本确认入口闸）：恢复为 paused（保留 checkpoint 与
    // 候选/确认卡载荷），前端进入面板继续；未确认的 context 保证重入 executor 仍受闸，不绕过。
    if (snapshot.status === 'paused' && snapshot.checkpoint && ['scene_asset_selection', 'cost_confirm'].includes(snapshot.checkpoint.type)) {
      return this._restorePausedSelectionRun(runId, snapshot);
    }
    if (snapshot.status === 'failed') {
      // 失败快照必须携带 error 才可恢复（无 error 的 failed 属于异常数据）
      if (!snapshot.error) {
        return { success: false, error: '只有失败或中断状态的运行可以恢复', errorCode: 'RUN_NOT_FAILED' };
      }
    } else if (snapshot.status !== 'running' && !(snapshot.status === 'paused' && snapshot.checkpoint && snapshot.checkpoint.type === 'manual_pause')) {
      return { success: false, error: '只有失败或中断状态的运行可以恢复', errorCode: 'RUN_NOT_FAILED' };
    }
    if ((snapshot.orchestrationMode || 'state_machine') !== 'orchestrator') {
      return { success: false, error: '该运行不支持断点恢复', errorCode: 'RUN_NOT_ORCHESTRATOR' };
    }
    if (/needs_user_input|content[_\s-]?policy|CONTENT_POLICY/i.test(String(snapshot.error || ''))) {
      return { success: false, error: '该失败需要人工处理（内容政策），请修改文案后重新启动', errorCode: 'PIPELINE_USER_INPUT_REQUIRED' };
    }
    const failedStageIndex = (Number.isInteger(snapshot.currentStage) && snapshot.currentStage >= 0)
      ? snapshot.currentStage
      : (Array.isArray(snapshot.stages) ? snapshot.stages.findIndex((s) => s.status === 'failed') : -1);
    if (failedStageIndex < 0) {
      return { success: false, error: '未定位到失败阶段', errorCode: 'STAGE_NOT_FOUND' };
    }

    const pl = this.getPipeline(snapshot.pipeline);
    const stages = (Array.isArray(snapshot.stages) && snapshot.stages.length > 0)
      ? snapshot.stages
      : ((pl && Array.isArray(pl.stages)) ? pl.stages.map((name) => ({ name })) : []);
    if (stages.length === 0) return { success: false, error: '失败快照缺少阶段定义', errorCode: 'STAGE_NOT_FOUND' };
    // 后台并行上限：恢复也算占用运行槽位。
    const concurrencyBlock = this._assertConcurrencyBudget();
    if (concurrencyBlock) return concurrencyBlock;

    // 内存 history 条目使用 id，RunStateStore 快照使用 runId
    const runIdentifier = String(snapshot.runId || snapshot.id || '')
    if (!runIdentifier) return { success: false, error: '失败快照缺少 runId', errorCode: 'RUN_SNAPSHOT_NOT_FOUND' }

    const now = new Date().toISOString();
    const restored = {
      id: runIdentifier,
      pipeline: snapshot.pipeline,
      status: 'running',
      currentStage: failedStageIndex,
      stages: stages.map((s, i) => {
        const base = { ...s };
        delete base.error;
        // 恢复路径统一补齐阶段进度字段（老快照无 progress/summary 时置 null）
        base.progress = base.progress || null;
        base.summary = base.summary || null;
        if (i < failedStageIndex) {
          return { ...base, status: 'completed', startedAt: base.startedAt || now, completedAt: base.completedAt || now };
        }
        if (i === failedStageIndex) {
          return { ...base, status: 'running', startedAt: now, completedAt: null };
        }
        return { ...base, status: 'pending', startedAt: null, completedAt: null };
      }),
      // 恢复 Story2Video 时，内容参数仍来自原任务，但图片/TTS/视频路由改由当前设置解析。
      // 其它流水线保持原有参数恢复语义。
      params: prepareResumeParams(snapshot.params || {}, snapshot.pipeline),
      progress: 0,
      checkpoint: null,
      createdAt: snapshot.createdAt || now,
      endedAt: null,
      // 断点恢复继承历史累计执行耗时；在飞段从恢复时刻重新起算（不落盘，防停机时间膨胀）
      activeMs: Number.isFinite(Number(snapshot.activeMs)) ? Number(snapshot.activeMs) : 0,
      _activeSegmentStartedAt: null,
      orchestrationMode: 'orchestrator',
      projectId: snapshot.projectId || runId,
      context: JSON.parse(JSON.stringify(snapshot.context || {})),
      stageResults: [],
      resumedFrom: runId,
      error: null,
    };
    this._runs.set(restored.id, restored);
    this._runs.set('_' + restored.pipeline, restored);
    this._currentPipeline = restored.pipeline;
    this._syncStory2VideoProjectStatus(restored);
    if (this.runStateStore) {
      try { this.runStateStore.remove(runId); } catch (_) { /* 快照清理失败不影响恢复 */ }
    }

    const promise = this._autoAdvanceRun(restored.id);
    promise.catch((err) => {
      // fail-closed：恢复推进若意外抛错，必须把 run 标记为 failed 终态，
      // 否则前端会看到 run 永久停留在 running 而无任何进展，无法定位失败原因。
      const msg = (err && err.stack) ? err.stack : (err && err.message ? err.message : String(err));
      this.log.error('PipelineEngine', 'background resume autoAdvance threw, marking run failed: ' + msg);
      try {
        const run = this._runs.get(restored.id);
        if (run && run.status === 'running') {
          run.status = 'failed';
          run.error = '恢复推进失败：' + (err && err.message ? err.message : String(err));
          run.endedAt = Date.now();
          this._emit('runStatus', run);
          this._syncStory2VideoProjectStatus(run);
        }
      } catch (_) { /* 兜底标记失败本身不应再抛错 */ }
    });
    return { success: true, runId: restored.id };
  }

  /**
   * 恢复「分镜素材自选」暂停检查点：按 currentStage 恢复为 paused（保留 checkpoint/候选/选择），
   * 不删除快照（选择期间崩溃仍可恢复；后续阶段级 running checkpoint 会覆盖）。
   * @param {string} runId
   * @param {object} snapshot
   * @returns {{success: boolean, runId?: string, paused?: boolean, error?: string, errorCode?: string}}
   */
  _restorePausedSelectionRun(runId, snapshot) {
    const pl = this.getPipeline(snapshot.pipeline);
    const stages = (Array.isArray(snapshot.stages) && snapshot.stages.length > 0)
      ? snapshot.stages
      : ((pl && Array.isArray(pl.stages)) ? pl.stages.map((name) => ({ name })) : []);
    const stageIndex = (Number.isInteger(snapshot.currentStage) && snapshot.currentStage >= 0)
      ? snapshot.currentStage
      : 0;
    if (stages.length === 0) {
      return { success: false, error: '恢复失败：阶段定义缺失', errorCode: 'STAGE_NOT_FOUND' };
    }
    const runIdentifier = String(snapshot.runId || snapshot.id || '');
    if (!runIdentifier) {
      return { success: false, error: '恢复失败：缺少 runId', errorCode: 'RUN_SNAPSHOT_NOT_FOUND' };
    }
    const now = new Date().toISOString();
    const restored = {
      id: runIdentifier,
      pipeline: snapshot.pipeline,
      status: 'paused',
      currentStage: stageIndex,
      stages: stages.map((s, i) => {
        const base = { ...s };
        delete base.error;
        // 恢复路径统一补齐阶段进度字段（老快照无 progress/summary 时置 null）
        base.progress = base.progress || null;
        base.summary = base.summary || null;
        if (i < stageIndex) {
          return { ...base, status: 'completed', startedAt: base.startedAt || now, completedAt: base.completedAt || now };
        }
        if (i === stageIndex) {
          return { ...base, status: 'paused', startedAt: base.startedAt || now, completedAt: null };
        }
        return { ...base, status: 'pending', startedAt: null, completedAt: null };
      }),
      params: snapshot.params || {},
      progress: 0,
      checkpoint: snapshot.checkpoint || null,
      createdAt: snapshot.createdAt || now,
      endedAt: null,
      activeMs: Number.isFinite(Number(snapshot.activeMs)) ? Number(snapshot.activeMs) : 0,
      _activeSegmentStartedAt: null,
      orchestrationMode: 'orchestrator',
      projectId: snapshot.projectId || runId,
      context: JSON.parse(JSON.stringify(snapshot.context || {})),
      stageResults: [],
      resumedFrom: runId,
      error: null,
    };
    this._runs.set(restored.id, restored);
    this._runs.set('_' + restored.pipeline, restored);
    this._currentPipeline = restored.pipeline;
    this._syncStory2VideoProjectStatus(restored);
    return { success: true, runId: restored.id, paused: true };
  }

  /**
   * 执行当前阶段（编排模式）
   * @param {string} runId
   * @returns {Promise<{success: boolean, output?: any, error?: string, checkpoint?: boolean}>}
   */
  async executeStage(runId) {
    const result = await this._executeStage(runId);
    const run = this._runs.get(runId);
    if (!result.success) {
      if (run && !run.cancelled) {
        this._emit('stage:fail', { runId, stageName: run.stages[run.currentStage]?.name, error: result.error });
        this._emit('pipeline:fail', { runId, pipelineType: run.pipeline, error: result.error });
        this._finalizeRun(run, 'failed', result.error);
      }
      return result;
    }
    if (!run || run.orchestrationMode !== 'orchestrator') return result;

    if (result.checkpoint) {
      const stage = run.stages[run.currentStage];
      const checkpoint = this._buildCheckpoint(run, result.checkpointMeta || {
        stageName: stage?.name,
        stageIndex: run.currentStage,
        required: true,
        type: result.checkpoint,
      });
      run.checkpoint = checkpoint;
      run.status = 'paused';
      if (stage) stage.status = 'paused';
      this._syncStory2VideoProjectStatus(run);
      this._emit('checkpoint:pause', {
        runId,
        stageName: stage?.name,
        checkpointType: result.checkpoint,
      });
      return { ...result, checkpointData: checkpoint, paused: true };
    }

    const advResult = this._advanceRun(run, { skipped: this._isStageSkipped(result, run, run.stages[run.currentStage]) });
    if (advResult.message === 'Pipeline completed') {
      return { ...result, completed: true, context: run.context, activeMs: this._computeElapsedMs(run) };
    }
    if (!advResult.success) {
      this.log.warn('PipelineEngine', 'advance after executeStage: ' + (advResult.message || advResult.error));
      return {
        ...result,
        success: false,
        error: advResult.error,
        errorCode: advResult.errorCode,
      };
    }
    return result;
  }

  /**
   * 执行并自动推进到下一个检查点或完成
   * @param {string} runId
   * @returns {Promise<{success: boolean, results?: any[], context?: object, paused?: boolean, error?: string}>}
   */
  async advanceToNextCheckpoint(runId) {
    const run = this._runs.get(runId);
    if (!run) return { success: false, error: 'Run not found: ' + runId, errorCode: 'PIPELINE_INVALID_RUN_ID' };
    if (run.orchestrationMode !== 'orchestrator') {
      return { success: false, error: 'Run is not in orchestrator mode', errorCode: 'PIPELINE_NOT_ORCHESTRATOR' };
    }
    if (run.status === 'paused') {
      const checkpoint = run.checkpoint || {};
      if (checkpoint.type === 'needs_user_input' || checkpoint.reason === 'content_policy') {
        return {
          success: false,
          runId,
          paused: true,
          needsUserInput: true,
          checkpoint,
          error: 'Checkpoint requires user input before the pipeline can continue',
          errorCode: 'PIPELINE_USER_INPUT_REQUIRED',
        };
      }
      // 检查点阶段已经执行完毕，确认操作应先完成该阶段，再执行后续阶段。
      const advanced = this._advanceRun(run, { skipped: this._isStageSkipped(null, run, run.stages[run.currentStage]) });
      if (!advanced.success) return advanced;
      if (advanced.message === 'Pipeline completed') {
        return { success: true, runId, context: run.context, completed: true, results: [], activeMs: this._computeElapsedMs(run) };
      }
      run.status = 'running';
      if (run.stages[run.currentStage]) run.stages[run.currentStage].status = 'running';
      this._syncStory2VideoProjectStatus(run);
    }
    return this._autoAdvanceRun(runId);
  }

  /**
   * 获取运行上下文（编排模式）
   * @param {string} runId
   * @returns {object|null}
   */
  /**
   * 分镜素材自选（manual）：确认每个场景的素材选择并推进流水线（finalize_assets → compose → publish）。
   * @param {string} runId
   * @param {Array<{index: number, candidateId: string}>} selections
   * @returns {Promise<{success: boolean, runId?: string, paused?: boolean, completed?: boolean, error?: string, errorCode?: string}>}
   */
  async confirmSceneAssets(runId, selections) {
    if (typeof runId !== 'string' || !runId.trim()) {
      return { success: false, error: '缺少或非法 runId', errorCode: 'INVALID_SCENE_ASSET_SELECTION' }
    }
    if (!Array.isArray(selections) || selections.length === 0) {
      return { success: false, error: '缺少素材选择', errorCode: 'INVALID_SCENE_ASSET_SELECTION' }
    }
    const run = this._runs.get(runId) || this._history.find((item) => item && item.id === runId)
    if (!run || run.orchestrationMode !== 'orchestrator') {
      return { success: false, error: '未找到可选择的流水线运行', errorCode: 'RUN_NOT_FOUND' }
    }
    if (run.status !== 'paused' || !run.checkpoint || run.checkpoint.type !== 'scene_asset_selection') {
      return { success: false, error: '当前流水线不处于素材选择暂停点', errorCode: 'NOT_AT_SCENE_ASSET_SELECTION' }
    }
    if (this._advancingRuns && this._advancingRuns.has(runId)) {
      return { success: true, runId, alreadyAdvancing: true }
    }
    const manifest = run.context && run.context.generate_assets
    const candidates = Array.isArray(manifest && manifest.candidates) ? manifest.candidates : []
    if (candidates.length === 0) {
      return { success: false, error: '候选素材清单缺失', errorCode: 'INVALID_SCENE_ASSET_SELECTION' }
    }
    // 校验：覆盖全部场景、index 唯一、candidateId 属于该场景候选清单
    const sceneIndexes = candidates.map((c) => c && c.index)
    const seen = new Set()
    const normalized = []
    for (const item of selections) {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          !Number.isInteger(item.index) || !sceneIndexes.includes(item.index) || seen.has(item.index) ||
          typeof item.candidateId !== 'string' || !item.candidateId) {
        return { success: false, error: '素材选择参数非法', errorCode: 'INVALID_SCENE_ASSET_SELECTION' }
      }
      seen.add(item.index)
      const scene = candidates.find((c) => c && c.index === item.index)
      const match = Array.isArray(scene && scene.candidates)
        ? scene.candidates.find((c) => c && c.id === item.candidateId)
        : null
      if (!match || typeof match.path !== 'string' || !match.path) {
        return { success: false, error: '场景 ' + item.index + ' 选择了无效素材 ' + item.candidateId, errorCode: 'INVALID_SCENE_ASSET_SELECTION' }
      }
      normalized.push({ index: item.index, candidateId: item.candidateId })
    }
    if (normalized.length !== candidates.length) {
      return {
        success: false,
        error: '素材选择未覆盖全部场景（' + normalized.length + '/' + candidates.length + '）',
        errorCode: 'INVALID_SCENE_ASSET_SELECTION',
      }
    }
    run.context = run.context || {}
    run.context.scene_asset_selection = {
      selections: normalized,
      confirmedAt: new Date().toISOString(),
    }
    if (!this._advancingRuns) this._advancingRuns = new Set()
    this._advancingRuns.add(runId)
    try {
      // 推进：finalize_assets → compose → publish
      return await this.advanceToNextCheckpoint(runId)
    } finally {
      this._advancingRuns.delete(runId)
    }
  }

  /**
   * 确认阶段入口闸并重执行当前阶段（film-engineering-video-gen D2 通用能力）。
   * 与 advanceToNextCheckpoint 的区别：checkpointRequired 入口闸阶段（如成本确认）的执行
   * 语义是「确认前零副作用」——确认动作不是完成该阶段，而是携带确认载荷重入同阶段。
   * @param {string} runId
   * @param {object} contextPatch - 合并进 run.context 的确认载荷（如 cost_confirmation）
   */
  async confirmStageGate(runId, contextPatch) {
    if (typeof runId !== 'string' || !runId.trim()) {
      return { success: false, error: '缺少或非法 runId', errorCode: 'PIPELINE_INVALID_RUN_ID' };
    }
    const run = this._runs.get(runId);
    if (!run || run.orchestrationMode !== 'orchestrator') {
      return { success: false, error: '未找到可确认的流水线运行', errorCode: 'RUN_NOT_FOUND' };
    }
    if (run.status !== 'paused' || !run.checkpoint) {
      return { success: false, error: '当前流水线不处于等待确认的检查点', errorCode: 'NOT_AT_CONFIRMATION_GATE' };
    }
    if (contextPatch !== undefined && (typeof contextPatch !== 'object' || contextPatch === null || Array.isArray(contextPatch))) {
      return { success: false, error: '确认载荷必须是对象', errorCode: 'INVALID_PARAMS' };
    }
    let patch;
    try {
      patch = contextPatch === undefined ? {} : JSON.parse(JSON.stringify(contextPatch));
    } catch (e) {
      return { success: false, error: '确认载荷不可序列化: ' + e.message, errorCode: 'INVALID_PARAMS' };
    }
    run.context = run.context || {};
    Object.assign(run.context, patch);
    const stage = run.stages[run.currentStage];
    if (!stage) {
      return { success: false, error: 'No active stage', errorCode: 'PIPELINE_NO_ACTIVE_STAGE' };
    }
    stage.gateCleared = true;
    run.checkpoint = null;
    run.status = 'running';
    stage.status = 'running';
    this._syncStory2VideoProjectStatus(run);
    this._emit('checkpoint:resume', { runId, stageName: stage.name, via: 'confirmStageGate' });
    if (!this._advancingRuns) this._advancingRuns = new Set();
    this._advancingRuns.add(runId);
    try {
      return await this._autoAdvanceRun(runId);
    } finally {
      this._advancingRuns.delete(runId);
    }
  }

  getRunContext(runId) {
    const run = this._runs.get(runId);
    if (!run) return null;
    return run.context || null;
  }

  /**
   * 获取供 renderer 使用的运行快照。
   * getRunContext 保持返回原始 context 的兼容性；新接口同时返回状态、阶段和检查点。
   */
  /**
   * 获取供 renderer 使用的运行快照。
   * @param {string} runId
   * @param {{ progressOnly?: boolean }} [opts] - progressOnly 时返回轻量快照（不含 context 与运行明细），
   *   用于实时事件推送/轮询进度展示；checkpoint 仅保留类型元数据（不携带 context 快照，避免敏感载荷）。
   */
  getRunSnapshot(runId, opts) {
    const run = this._runs.get(runId) || this._history.find((item) => item.id === runId);
    if (!run) return null;
    const progressOnly = Boolean(opts && opts.progressOnly);
    if (progressOnly) {
      return {
        runId: run.id,
        pipeline: run.pipeline,
        status: {
          status: run.status,
          currentStage: run.currentStage,
          progress: this._calcProgress(run),
        },
        currentStage: run.currentStage,
        stages: run.stages,
        checkpoint: this._sanitizeCheckpoint(run.checkpoint),
        orchestrationMode: run.orchestrationMode || 'state_machine',
        progressOnly: true,
      };
    }
    // 已用时（步骤执行耗时累计口径）：activeMs 为已结算累计，elapsedActiveMs 额外包含运行中在飞段增量
    // （统一走 _computeElapsedMs，避免公式漂移）。
    const activeMs = Number.isFinite(Number(run.activeMs)) ? Number(run.activeMs) : null;
    return {
      runId: run.id,
      pipeline: run.pipeline,
      status: {
        status: run.status,
        currentStage: run.currentStage,
        progress: this._calcProgress(run),
      },
      currentStage: run.currentStage,
      stages: run.stages,
      context: run.context || {},
      checkpoint: run.checkpoint || null,
      orchestrationMode: run.orchestrationMode || 'state_machine',
      createdAt: run.createdAt,
      endedAt: run.endedAt || null,
      error: run.error || null,
      projectId: run.projectId || null,
      outputSizeBytes: this._runOutputSizeBytes(run) || null,
      activeMs,
      activeSegmentStartedAt: Number.isFinite(run._activeSegmentStartedAt) ? new Date(run._activeSegmentStartedAt).toISOString() : null,
      elapsedActiveMs: activeMs !== null ? this._computeElapsedMs(run) : null,
    };
  }

  /**
   * 轻量快照用 checkpoint 裁剪：仅保留类型/阶段元数据，不携带 context 快照（防敏感载荷）。
   */
  _sanitizeCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object') return null;
    const { type, stageName, stageIndex, required } = checkpoint;
    const sanitized = {};
    if (typeof type === 'string' && type) sanitized.type = type;
    if (typeof stageName === 'string' && stageName) sanitized.stageName = stageName;
    if (Number.isInteger(stageIndex)) sanitized.stageIndex = stageIndex;
    if (typeof required === 'boolean') sanitized.required = required;
    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  /**
   * 计算运行已用时长（步骤执行耗时累计口径）：
   * - 编排模式：run.activeMs（各执行段之和）+ 运行中在飞段增量；
   * - state_machine / 旧数据：无 activeMs 时回退 0（不参与编排「已用时」展示，由前端回退链处理）。
   * 暂停/检查点等待/失败→恢复的空闲时间不累计；唯一累计点 _executeStage。
   */
  _computeElapsedMs(run) {
    if (!run) return 0;
    const activeMs = Number.isFinite(Number(run.activeMs)) ? Number(run.activeMs) : 0;
    if (run.status === 'running' && Number.isFinite(run._activeSegmentStartedAt)) {
      return activeMs + Math.max(0, Date.now() - run._activeSegmentStartedAt);
    }
    return activeMs;
  }

  /** 已完成运行的成片文件大小（供「完成汇总」展示），非完成/无成片时返回 null。 */
  _runOutputSizeBytes(run) {
    if (!run || run.status !== 'completed') return null
    const context = run.context || {}
    const composeRaw = context.compose?.data || context.compose
    const exportRaw = context.export?.data || context.export
    const reportRaw = context.report?.data || context.report
    const videoPath = (composeRaw && (composeRaw.videoPath || composeRaw.path)) ||
      (exportRaw && (exportRaw.videoPath || exportRaw.path)) ||
      (reportRaw && (reportRaw.videoPath || reportRaw.path))
    if (typeof videoPath !== 'string' || !videoPath) return null
    try {
      const stat = require('fs').statSync(videoPath)
      return Number.isFinite(stat.size) ? stat.size : null
    } catch {
      return null
    }
  }

  /**
   * 暂停 + 保存检查点（编排模式增强）
   * 检查点包含 currentStage + context 快照
   */
  pauseWithCheckpoint() {
    const run = this._getCurrentRun();
    if (!run) return { success: false, error: 'No active pipeline', errorCode: 'PIPELINE_NO_ACTIVE' };
    const result = this.pause();
    if (!result.success) return result;

    if (run.orchestrationMode === 'orchestrator') {
      run.checkpoint = this._buildCheckpoint(run, {
        stageName: run.stages[run.currentStage]?.name,
        required: true,
      });
    }
    return { success: true, checkpoint: run.checkpoint };
  }

  /**
   * 按 runId 暂停指定运行（2026-08-16 UX 统一：视频任务编辑页手动暂停）。
   * 与 pauseWithCheckpoint 语义一致：编排运行保存检查点并持久化 paused 快照，可断点续跑。
   */
  pauseRun (runId) {
    if (typeof runId !== 'string' || !runId.trim()) return { success: false, error: 'runId 非法', errorCode: 'PIPELINE_INVALID_RUN_ID' }
    const id = runId.trim()
    const run = this._runs.get(id)
    if (!run) return { success: false, error: '运行记录不存在', errorCode: 'PIPELINE_RUN_NOT_FOUND' }
    if (run.status !== 'running') return { success: false, error: '仅运行中的流水线可暂停', errorCode: 'PIPELINE_ERROR' }
    const stage = Array.isArray(run.stages) && Number.isInteger(run.currentStage)
      ? run.stages[run.currentStage]
      : null
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return { success: false, error: '运行记录阶段数据无效', errorCode: 'PIPELINE_ERROR' }
    const previousStatus = run.status
    const previousStageStatus = stage.status
    const previousCheckpoint = run.checkpoint
    let checkpoint = previousCheckpoint
    try {
      if (run.orchestrationMode === 'orchestrator') {
        checkpoint = this._buildCheckpoint(run, {
          stageName: stage.name,
          stageIndex: run.currentStage,
          required: true,
          type: 'manual_pause',
        })
      }
    } catch (checkpointError) {
      this.log.warn('PipelineEngine', 'pause checkpoint build failed: ' + (checkpointError && checkpointError.message ? checkpointError.message : String(checkpointError)))
      return { success: false, error: '保存暂停检查点失败', errorCode: 'PIPELINE_CHECKPOINT_SAVE_FAILED' }
    }
    run.status = 'paused'
    stage.status = 'paused'
    run.checkpoint = checkpoint
    if (this.runStateStore && typeof this.runStateStore.savePaused === 'function') {
      try {
        if (this.runStateStore.savePaused(run) === false) throw new Error('savePaused returned false')
      } catch (saveError) {
        this.log.warn('PipelineEngine', 'pauseRun paused snapshot save failed: ' + (saveError && saveError.message ? saveError.message : String(saveError)))
        run.status = previousStatus
        stage.status = previousStageStatus
        run.checkpoint = previousCheckpoint
        return { success: false, error: '保存暂停检查点失败', errorCode: 'PIPELINE_CHECKPOINT_SAVE_FAILED' }
      }
    }
    this._syncStory2VideoProjectStatus(run)
    return { success: true, runId: id, checkpoint }
  }

  /**
   * 按 runId 取消指定运行（2026-09-12 热门选题一键生成视频）。
   * 与无参 cancel() 的区别：cancel() 取消 _getCurrentRun()（当前活跃 run），
   * 多 run 并发时可能误杀其他入口启动的任务；cancelRun 定向取消指定 runId，
   * 与 pauseRun/deleteRun 同一 runId 寻址模式。取消语义与 cancel() 一致：
   * 标记 cancelled + 当前阶段 cancelled + finalize（不可断点恢复，仅影响取消记录展示）。
   */
  cancelRun (runId) {
    if (typeof runId !== 'string' || !runId.trim()) return { success: false, error: 'runId 非法', errorCode: 'PIPELINE_INVALID_RUN_ID' }
    const id = runId.trim()
    const run = this._runs.get(id)
    if (!run) return { success: false, error: '运行记录不存在', errorCode: 'PIPELINE_RUN_NOT_FOUND' }
    if (run.status !== 'running' && run.status !== 'paused') return { success: false, error: '仅运行中或已暂停的流水线可取消', errorCode: 'PIPELINE_ERROR' }
    run.cancelled = true
    run.status = 'cancelled'
    const stage = Array.isArray(run.stages) && Number.isInteger(run.currentStage)
      ? run.stages[run.currentStage]
      : null
    if (stage && typeof stage === 'object') stage.status = 'cancelled'
    this._emit('pipeline:fail', { runId: id, pipelineType: run.pipeline, error: 'cancelled' })
    this._finalizeRun(run, 'cancelled', 'cancelled')
    return { success: true, runId: id }
  }

  /**
   * 从检查点恢复（编排模式增强）
   */
  resumeFromCheckpoint() {
    const run = this._getCurrentRun();
    if (!run) return { success: false, error: 'No active pipeline', errorCode: 'PIPELINE_NO_ACTIVE' };
    const result = this.resume();
    if (!result.success) return result;

    if (run.checkpoint && run.orchestrationMode === 'orchestrator') {
      // 恢复 context（currentStage 已由 pause 保留，无需重置）
      run.context = run.checkpoint.context || run.context;
    }
    return { success: true };
  }

  /**
   * 注册自定义阶段执行器（插件扩展点）
   * @param {string} stageType
   * @param {Function} fn
   * @returns {{success: boolean, error?: string}}
   */
  registerStageExecutor(stageType, fn) {
    if (!this.stageExecutor) {
      return { success: false, error: 'StageExecutor not configured', errorCode: 'PIPELINE_STAGE_EXECUTOR_MISSING' };
    }
    try {
      this.stageExecutor.register(stageType, fn);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message, errorCode: 'PIPELINE_ERROR' };
    }
  }

  // ============================================================
  // 内部辅助方法
  // ============================================================

  _getCurrentRun() {
    if (!this._currentPipeline) return null;
    return this._runs.get('_' + this._currentPipeline);
  }

  /** 设置 run 终结钩子（additive）：run 完成/失败/取消并附加 diagnostics 后调用。 */
  setRunFinalizedHook (fn) {
    this._runFinalizedHook = typeof fn === 'function' ? fn : null
    return this
  }

  _finalizeRun(run, status, error) {
    if (!run || run.endedAt) return;
    run.status = status;
    // 完成态进度固定为 100%（持久化到历史卡片；_advanceRun 在最后一个阶段不再重算 run.progress）
    if (status === 'completed') run.progress = 100;
    if (error) run.error = error;
    run.endedAt = new Date().toISOString();
    if ((status === 'failed' || status === 'cancelled') && Array.isArray(run.stages) && run.stages[run.currentStage]) {
      const terminalStage = run.stages[run.currentStage];
      terminalStage.status = status;
      if (error) terminalStage.error = error;
      terminalStage.completedAt = new Date().toISOString();
    }
    // 诊断附加字段（additive）：失败分类 + 根因候选 + 环境快照。构建失败仅记 warn，不改变 run 终态。
    try {
      run.diagnostics = buildRunDiagnostics(run, captureEnvSnapshot({
        sidecarProbe: () => {
          const bridge = this._getPythonBridge();
          return bridge && typeof bridge.isRunning === 'function'
            ? { pythonBackend: bridge.isRunning() === true }
            : null;
        },
      }));
    } catch (diagError) {
      this.log.warn('PipelineEngine', 'diagnostics build failed: ' + (diagError instanceof Error ? diagError.message : String(diagError)));
    }
    // 可选上报钩子（additive）：入队诊断样本；失败仅记 warn，不影响终态
    if (typeof this._runFinalizedHook === 'function') {
      try { this._runFinalizedHook(run) } catch (hookError) {
        this.log.warn('PipelineEngine', 'runFinalizedHook failed: ' + (hookError instanceof Error ? hookError.message : String(hookError)));
      }
    }
    // 执行日志：运行终态（完成/失败/取消）+ 总耗时 + 错误摘要（截断，不含敏感原文）
    const finalizeDurationMs = run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : null;
    const finalizeDurationText = Number.isFinite(finalizeDurationMs) ? 'duration_ms=' + finalizeDurationMs : 'duration_ms=null';
    const finalizeErrorText = error ? ' error=' + String(error).slice(0, 500) : '';
    if (status === 'failed' || status === 'cancelled') {
      this.log.warn('PipelineEngine', '[run] finalize run=' + run.id + ' pipeline=' + run.pipeline + ' status=' + status + ' ' + finalizeDurationText + finalizeErrorText);
    } else {
      this.log.info('PipelineEngine', '[run] finalize run=' + run.id + ' pipeline=' + run.pipeline + ' status=' + status + ' ' + finalizeDurationText);
    }
    // 编排模式终态（失败/取消）：持久化断点快照。失败供 pipeline:resumeOrchestration 从断点继续；
    // 取消也落盘，避免「断点续跑后任务从历史记录消失」——恢复时会删除旧快照，若续跑后再次取消，
    // 必须保留新的终态快照，否则应用重启后该任务在历史中丢失。
    if ((status === 'failed' || status === 'cancelled') && run.orchestrationMode === 'orchestrator' && this.runStateStore) {
      try {
        this.runStateStore.saveFailed(run);
      } catch (saveError) {
        this.log.warn('PipelineEngine', 'run-state snapshot save failed: ' + (saveError && saveError.message ? saveError.message : String(saveError)));
      }
    }
    // 运行中 checkpoint 清理：完成态不留 running 快照，否则重启后已完成任务会
    // 以「运行中」状态重新出现在历史（失败/取消已由上方 saveFailed 覆盖同文件）。
    if (status === 'completed' && run.orchestrationMode === 'orchestrator' && this.runStateStore) {
      try {
        this.runStateStore.remove(run.id);
      } catch (removeError) {
        this.log.warn('PipelineEngine', 'completed run-state snapshot remove failed: ' + (removeError && removeError.message ? removeError.message : String(removeError)));
      }
    }
    if (['story2video-compose', 'animated-explainer', 'clip-factory', 'cinematic', 'framework-smoke', 'talking-head', 'documentary-montage', 'localization-dub', 'animation', 'avatar-spokesperson', 'character-animation', 'hybrid'].includes(run.pipeline) && status === 'completed' && this.story2videoProjectService) {
      try {
        const project = this.story2videoProjectService.saveRun(run);
        if (project) {
          run.projectId = project.projectId;
          run.context = run.context || {};
          run.context.story2videoProject = project;
        }
      } catch (persistError) {
        run.status = 'failed';
        run.error = 'Story2Video 项目保存失败: ' + persistError.message;
        const failedStageIndex = Math.min(
          Array.isArray(run.stages) ? run.stages.length - 1 : -1,
          Math.max(0, Number(run.currentStage) - 1),
        );
        const failedStage = failedStageIndex >= 0 ? run.stages[failedStageIndex] : null;
        if (failedStage) {
          failedStage.status = 'failed';
          failedStage.completedAt = new Date().toISOString();
        }
        if (run.orchestrationMode === 'orchestrator' && this.runStateStore && typeof this.runStateStore.saveFailed === 'function') {
          try {
            this.runStateStore.saveFailed(run);
          } catch (snapshotError) {
            this.log.warn('PipelineEngine', 'project persistence failure snapshot save failed: ' + (snapshotError && snapshotError.message ? snapshotError.message : String(snapshotError)));
          }
        }
        this.log.error('PipelineEngine', run.error);
      }
    }
    this._syncStory2VideoProjectStatus(run)
    const historyEntry = {
      ...run,
      stages: Array.isArray(run.stages) ? run.stages.map(stage => ({ ...stage })) : [],
      context: run.context || {},
    };
    // 同 runId 只保留最新一条终态记录：断点续跑复用同一 id，避免新旧终态重复展示。
    const existingIndex = this._history.findIndex(item => item && item.id === run.id);
    if (existingIndex >= 0) this._history[existingIndex] = historyEntry;
    else this._history.push(historyEntry);
    // 裁剪最旧快照，控制内存占用（RunStateStore 是跨重启恢复的权威源）
    if (this._history.length > this.maxHistoryEntries) {
      this._history.splice(0, this._history.length - this.maxHistoryEntries);
    }
    this._runs.delete(run.id);
    if (this._runs.get('_' + run.pipeline) === run) {
      this._runs.delete('_' + run.pipeline);
      if (this._currentPipeline === run.pipeline) this._currentPipeline = null;
    }
    if (run.pipeline === 'story2video-compose') {
      try {
        cleanupRunInputDir(run.id);
        // BGM 为可复用导入（前端配置仍引用该路径），收尾清理必须跳过，
        // 避免重试/断点续跑时 compose 因 BGM 文件被删而失败（2026-08-09 排查）。
        cleanupImportedMediaPaths(run.params, { skipBgm: true });
      } catch (cleanupError) {
        this.log.warn('PipelineEngine', 'Story2Video input cleanup failed: ' + cleanupError.message);
      }
    }
    // W2 技术债务闭环：run 结束（完成/失败/取消）时统一回收 governor 中已过期的排队 waiter，
    // 避免因该 key 无后续释放导致排队请求悬挂到任务链结束。
    if (this.governor && typeof this.governor.sweepAll === 'function') {
      try { this.governor.sweepAll(); } catch (sweepError) {
        this.log.warn('PipelineEngine', 'governor sweepAll failed: ' + (sweepError && sweepError.message ? sweepError.message : String(sweepError)));
      }
    }
  }

  _persistEditableStory2VideoProject (run, replace) {
    if (!run || run.pipeline !== 'story2video-compose' || !this.story2videoProjectService ||
        typeof this.story2videoProjectService.saveEditableRun !== 'function') return null
    if (run.projectId && !replace) return null
    try {
      const project = this.story2videoProjectService.saveEditableRun(run, { replace })
      if (!project) return null
      run.projectId = project.projectId
      run.context = run.context || {}
      run.context.story2videoProject = project
      this._saveRunningCheckpoint(run)
      return project
    } catch (error) {
      this.log.warn('PipelineEngine', 'editable Story2Video project save failed: ' + (error?.message || String(error)))
      return null
    }
  }

  _syncStory2VideoProjectStatus (run) {
    if (!run || run.pipeline !== 'story2video-compose' || !run.projectId || !this.story2videoProjectService ||
        typeof this.story2videoProjectService.syncRunStatus !== 'function') return null
    try {
      const project = this.story2videoProjectService.syncRunStatus(run)
      if (project) {
        run.context = run.context || {}
        run.context.story2videoProject = project
      }
      return project
    } catch (error) {
      this.log.warn('PipelineEngine', 'Story2Video project status sync failed: ' + (error?.message || String(error)))
      return null
    }
  }

  _calcProgress(run) {
    const total = run.stages.length;
    if (!total) return 0;
    // skipped 阶段同样视为已完成（如未选平台的发布），保证完成态进度为 100%。
    const completed = run.stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
    // 阶段内进行中进度加权：running 阶段带合法 stage.progress.percent 时按比例计入，
    // 避免长时间停在阶段边界（阶段数占比 + 当前阶段 percent 加权）。
    let runningShare = 0;
    const running = run.stages[run.currentStage];
    if (running && running.status === 'running' && running.progress &&
      Number.isFinite(running.progress.percent) && running.progress.percent >= 0 && running.progress.percent <= 100) {
      runningShare = running.progress.percent / 100;
    }
    return Math.round(((completed + runningShare) / total) * 100);
  }

  _getPythonBridge() {
    try { return require('./python-bridge'); } catch { return null; }
  }

  /**
   * 执行单个阶段（内部实现）
   * @param {string} runId
   * @returns {Promise<{success: boolean, output?: any, error?: string, checkpoint?: boolean}>}
   */
  async _executeStage(runId) {
    const run = this._runs.get(runId);
    if (!run) return { success: false, error: 'Run not found: ' + runId, errorCode: 'PIPELINE_INVALID_RUN_ID' };
    if (run.orchestrationMode !== 'orchestrator') {
      return { success: false, error: 'Run is not in orchestrator mode', errorCode: 'PIPELINE_NOT_ORCHESTRATOR' };
    }
    const stage = run.stages[run.currentStage];
    if (!stage) return { success: false, error: 'No stage to execute', errorCode: 'PIPELINE_NO_STAGE' };

    // 合并流水线定义中的 stage 元数据（type, options, inputFrom 等）
    // 旧流水线无 stageDefs，stageDef 为空对象，type 为 undefined → 回退为 MANUAL_CHECKPOINT
    const pl = this.getPipeline(run.pipeline);
    const stageDef = (pl && Array.isArray(pl.stageDefs))
      ? (pl.stageDefs.find((s) => s.name === stage.name) || {})
      : {};
    const fullStage = {
      ...stageDef,
      ...stage,
      options: {
        ...(stageDef.options || {}),
        ...(stage.options || {}),
        ...resolveRuntimeStageOptions(stage.name, run.params, run.pipeline),
      },
    };

    const stageStartMs = Date.now();
    const stageIndex = run.currentStage;
    this.log.info('PipelineEngine', '[exec] stage start run=' + runId + ' pipeline=' + run.pipeline + ' stage=' + stage.name + ' (' + (stageIndex + 1) + '/' + run.stages.length + ')');
    // 阶段级 checkpoint：执行前落盘 running 快照（阶段级原子性——中断后从当前阶段重新执行）。
    this._saveRunningCheckpoint(run);
    // 已用时统计（唯一权威源）：以执行器真实运行窗口为段，成功/失败/取消/异常都累计进 run.activeMs；
    // 暂停/检查点等待/失败→恢复空闲期间执行器未运行，自然不计入；在飞段不落盘（防停机时间膨胀）。
    const execStartedAt = Date.now();
    run._activeSegmentStartedAt = execStartedAt;
    let execResult;
    // 阶段进行中信息统一上报通道（additive）：执行器 onProgress → 字段级校验（fail-closed）→
    // 单调性检查 → 双写 stage.progress + context.stage_progress（兼容 3s 轮询读取路径）。
    // 惰性 require 避免模块加载期循环依赖。
    const { normalizeStageProgress } = require('./stage-executor');
    const onProgress = (update) => {
      try {
        const normalized = normalizeStageProgress(update);
        if (!normalized) return;
        const prev = stage.progress;
        // percent 单调不降：低于上次合法值则丢弃该次更新（与 compose 子进度语义对齐）
        if (prev && Number.isFinite(prev.percent) && normalized.percent < prev.percent) return;
        const stamped = { ...normalized, updatedAt: new Date().toISOString() };
        stage.progress = stamped;
        if (normalized.summary) stage.summary = normalized.summary;
        if (run.context && typeof run.context === 'object') run.context.stage_progress = stamped;
        // 实时推送（openspec pipeline-progress-real-time-push）：进度落盘后发射事件，
        // 由 ipc-handlers/pipeline.js 桥接 renderer（500ms 节流合并）。
        this._emit('stage:progress', { runId, stageName: stage.name, stageIndex: run.currentStage });
      } catch (error) {
        // 进度为展示增强：上报/写入异常不得阻断流水线（fail-closed 语义）
        this.log.warn('PipelineEngine', '[progress] onProgress 更新被忽略: ' + (error && error.message ? error.message : String(error)));
      }
    };
    onProgress({
      percent: 0,
      message: 'Working…',
      messageKey: 'stageProgress.stageWorking',
    });
    try {
      execResult = await this.stageExecutor.execute({
        runId,
        stage: fullStage,
        params: run.params,
        context: run.context || {},
        onProgress,
      });
    } finally {
      run.activeMs = (Number.isFinite(run.activeMs) ? run.activeMs : 0) + Math.max(0, Date.now() - execStartedAt);
      run._activeSegmentStartedAt = null;
    }
    if (run.cancelled || this._runs.get(runId) !== run) {
      this.log.warn('PipelineEngine', '[exec] stage cancelled run=' + runId + ' stage=' + stage.name);
      return { success: false, cancelled: true, error: 'Run cancelled' };
    }
    const result = execResult;
    if (result && result.success && (!stage.progress || stage.progress.percent < 100)) {
      onProgress({
        percent: 100,
        message: 'Stage complete.',
        messageKey: 'stageProgress.stageComplete',
        summary: 'Stage complete.',
        summaryKey: 'stageProgress.stageSummary',
      });
    }

    // 阶段执行成功且有输出 -> 写入 context 供后续阶段使用
    if (result.success && result.output !== undefined) {
      run.context = run.context || {};
      run.context[stage.name] = result.output;
      // 分段素材准备完成后立即建立可编辑草稿。这样运行中、暂停或失败的任务
      // 都能从历史记录进入同一个视频任务编辑页，而无需等待最终合成。
      if (stage.name === 'generate_assets' || stage.name === 'finalize_assets') {
        this._persistEditableStory2VideoProject(run, stage.name === 'finalize_assets');
      }
    }
    const normalizedResult = { ...result };
    if (normalizedResult.success && this._shouldCheckpoint(fullStage, run.params)) {
      normalizedResult.checkpoint = normalizedResult.checkpoint || fullStage.checkpointType || 'stage';
      normalizedResult.checkpointMeta = {
        stageName: stage.name,
        stageIndex: run.currentStage,
        required: true,
        type: normalizedResult.checkpoint,
      };
    }

    this.log.info('PipelineEngine', '[exec] stage end run=' + runId + ' pipeline=' + run.pipeline + ' stage=' + stage.name + ' success=' + normalizedResult.success + ' duration_ms=' + (Date.now() - stageStartMs) + (normalizedResult.error ? ' error=' + String(normalizedResult.error).slice(0, 500) : ''));
    run.stageResults.push({
      stage: stage.name,
      success: normalizedResult.success,
      error: normalizedResult.error,
      checkpoint: normalizedResult.checkpointMeta || null,
      timestamp: new Date().toISOString(),
    });

    return normalizedResult;
  }

  _shouldCheckpoint(stage, params) {
    const policy = params && params.checkpointPolicy;
    if (policy === 'none') return false;
    // 成本确认入口闸（film-engineering-video-gen D2）：confirmStageGate 已过闸的阶段
    // 重入执行时不再自动暂停（否则确认→执行→再暂停成死循环）。
    if (stage && stage.gateCleared === true) return false;
    if (policy === 'manual_all') return stage.name !== 'split';
    if (policy === 'auto_noncreative') {
      return ['optimize', 'compose', 'publish'].includes(stage.name);
    }
    return Boolean(stage.requiresCheckpoint || stage.checkpointRequired);
  }

  _buildCheckpoint(run, meta) {
    return {
      ...(meta || {}),
      currentStage: run.currentStage,
      context: JSON.parse(JSON.stringify(run.context || {})),
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * 自动推进执行，直到遇到检查点或完成
   * @param {string} runId
   * @returns {Promise<{success: boolean, results?: any[], context?: object, paused?: boolean, error?: string}>}
   */
  async _autoAdvanceRun(runId) {
    const run = this._runs.get(runId);
    if (!run) return { success: false, error: 'Run not found: ' + runId, errorCode: 'PIPELINE_INVALID_RUN_ID' };

    const results = [];
    while (run.status === 'running') {
      const stage = run.stages[run.currentStage];
      if (!stage) break;

      const execResult = await this._executeStage(runId);
      results.push({ stage: stage.name, ...execResult });

      if (!execResult.success) {
        // Backlot 事件：阶段失败 + 流水线失败
        this._emit('stage:fail', { runId, stageName: stage.name, error: execResult.error });
        this._emit('pipeline:fail', { runId, pipelineType: run.pipeline, error: execResult.error });
        this._finalizeRun(run, 'failed', execResult.error);
        return {
          success: false,
          runId,
          results,
          context: run.context,
          error: execResult.error,
        };
      }

      // 遇到人工检查点 → 暂停并返回
      if (execResult.checkpoint) {
        const checkpoint = this._buildCheckpoint(run, execResult.checkpointMeta || {
          stageName: stage.name,
          stageIndex: run.currentStage,
          required: true,
          type: execResult.checkpoint,
        });
        run.checkpoint = checkpoint;
        run.status = 'paused';
        stage.status = 'paused';
        this._syncStory2VideoProjectStatus(run);
        // Backlot 事件：检查点暂停
        this._emit('checkpoint:pause', { runId, stageName: stage.name, checkpointType: execResult.checkpoint });
        // 需要用户确认的检查点（分镜素材自选 / 成本确认入口闸）：持久化 paused 快照
        //（含 checkpoint 与等待态载荷），应用重启后仍可回到面板/确认卡，不绕过该检查点。
        if ((checkpoint.type === 'scene_asset_selection' || checkpoint.type === 'cost_confirm') && this.runStateStore && typeof this.runStateStore.savePaused === 'function') {
          try {
            this.runStateStore.savePaused(run);
          } catch (saveError) {
            this.log.warn('PipelineEngine', checkpoint.type + ' paused snapshot save failed: ' + (saveError && saveError.message ? saveError.message : String(saveError)));
          }
        }
        return {
          success: true,
          runId,
          results,
          context: run.context,
          checkpoint,
          paused: true,
        };
      }

      // 推进到下一阶段（同步 advance）
      const advResult = this._advanceRun(run, { skipped: this._isStageSkipped(execResult, run, stage) });
      if (!advResult.success) {
        // 持久化失败等推进错误已经由 _advanceRun 发出 pipeline:fail。
        if (advResult.message === 'Pipeline completed') {
          return {
            success: true,
            runId,
            results,
            context: run.context,
            completed: true,
          };
        }
        return {
          success: false,
          runId,
          results,
          context: run.context,
          error: advResult.error,
          errorCode: advResult.errorCode,
        };
      }
    }

    return {
      success: true,
      runId,
      results,
      context: run.context,
      completed: run.status === 'completed',
    };
  }
}

/**
 * 将 renderer 传入的运行时配置合并到阶段 options。
 * 阶段定义提供安全默认值，用户参数只覆盖同一阶段允许的配置键。
 */
function resolveRuntimeStageOptions(stageName, params, pipelineName) {
  const input = params || {};
  const stageOptions = input.stageOptions && input.stageOptions[stageName];
  const result = stageOptions && typeof stageOptions === 'object' ? { ...stageOptions } : {};
  const currentModelsOnResume = pipelineName === STORY2VIDEO_PIPELINE && input.__resumeUseCurrentModels === true;
  if (currentModelsOnResume && stageName === 'generate_assets') {
    delete result.imageProvider;
    delete result.imageModel;
    delete result.voiceProvider;
    delete result.voiceModel;
    if (result.video && typeof result.video === 'object') {
      delete result.video.provider;
      delete result.video.model;
    }
  }
  if (currentModelsOnResume && stageName === 'select_video_scenes' && result.video && typeof result.video === 'object') {
    delete result.video.provider;
    delete result.video.model;
  }
  const set = (key, value) => {
    if (value !== undefined && value !== null) result[key] = value;
  };

  if (stageName === 'split') {
    set('mode', input.splitMode);
    set('language', input.language);
  } else if (stageName === 'optimize') {
    set('style', input.promptStyle || input.imageStyle || input.style);
    set('creative_level', input.creativeLevel);
    set('negative_prompt', input.negativePrompt);
    // 图片提示词最大长度（2026-08-16）：渲染层经 Story2VideoTextConfig.optimize.maxLength 提交；
    // undefined 时 set 不写键，回退 stageDef 默认 max_length=2000（隐式兜底，见 pipeline-story2video-contract 恒含断言）。
    // 执行器 buildPromptEngineOptimizeRequest 契约仍收敛到 [50, 2000]（8013 le=2000），不因放开默认放宽校验。
    set('max_length', input.story2videoTextConfig?.optimize?.maxLength);
  } else if (stageName === 'generate_assets') {
    set('concurrency', input.concurrency);
    set('imageStyle', input.imageStyle);
    set('imageProvider', input.imageProvider);
    set('imageModel', input.imageModel);
    set('aspectRatio', input.aspectRatio);
    set('voiceId', input.voiceId);
    set('voiceProvider', input.voiceProvider);
    set('voiceModel', input.voiceModel);
    set('voiceSpeed', input.voiceSpeed);
    set('voicePitch', input.voicePitch);
    set('voiceEmotion', input.voiceEmotion);
    set('contentType', input.contentType);
    set('inputMode', input.inputMode);
    set('images', input.images);
    set('audio', input.audio);
    set('allowPartialAssets', input.allowPartialAssets);
    set('templateId', input.templateId);
    set('creationMode', input.creationMode);
    set('manualMaterialMode', input.manualMaterialMode);
    set('videoMode', input.videoMode);
    set('video', input.videoConfig);
  } else if (stageName === 'finalize_assets') {
    set('creationMode', input.creationMode);
  } else if (stageName === 'scene_context') {
    // 渲染层未显式提交时走 stageDefs 默认值（enabled=true 等）；已提交的 stageOptions 原样透传。
    // contentType 开关（原 domain_enrich stageOptions，design D4）在此透传。
    set('contentType', input.contentType);
  } else if (stageName === 'select_video_scenes') {
    set('video', input.videoConfig);
    set('videoMode', input.videoMode);
  } else if (stageName === 'compose') {
    set('transition', input.transition);
    set('imageEffect', input.imageEffect);
    set('subtitleEnabled', input.subtitleEnabled);
    set('subtitleStyle', input.subtitleStyle);
    set('bgmPath', input.bgmPath);
    set('bgmVolume', input.bgmVolume);
    set('watermark', input.watermark);
    set('watermarkText', input.watermarkText);
    set('watermarkConfig', input.watermarkConfig);
    set('voiceVolume', input.voiceVolume);
    set('templateId', input.templateId);
    set('resolution', input.resolution || input.output?.resolution);
    set('fps', input.fps || input.output?.fps);
    set('format', input.format || input.output?.format);
    set('sceneDurationMode', input.sceneDurationMode);
    set('minSceneDuration', input.minSceneDuration);
    set('videoMode', input.videoMode);
    set('shortVideoHandling', input.shortVideoHandling);
  } else if (pipelineName === 'clip-factory' && stageName === 'analyze') {
    // clip-factory 选项按 pipeline 名区分（analyze 阶段名与 podcast 共用）。
    set('sceneThreshold', input.sceneThreshold);
    set('maxSegments', input.maxSegments);
    set('minSegmentSeconds', input.minSegmentSeconds);
    set('maxTotalSeconds', input.maxTotalSeconds);
  } else if (stageName === 'publish') {
    set('platforms', input.platforms);
    set('title', input.title || input.output?.title);
    set('content', input.content || input.text);
    set('tags', input.tags);
    set('publishEnabled', input.publishEnabled);
  }

  return result;
}

/**
 * 为 Story2Video 历史恢复准备运行参数。
 *
 * 成功资产通过 context 中的本地路径复用；没有成功资产的调用不应继续携带
 * 启动任务时的 provider/model。只删除模型路由字段，保留提示词、音色 ID、
 * 速度/音调/情绪、视频比例等内容与生成参数。
 * @param {object} params
 * @param {string} pipelineName
 * @returns {object}
 */
function prepareResumeParams(params, pipelineName) {
  let restored
  try {
    restored = JSON.parse(JSON.stringify(params && typeof params === 'object' ? params : {}))
  } catch (_) {
    restored = { ...(params && typeof params === 'object' ? params : {}) }
  }
  if (pipelineName !== STORY2VIDEO_PIPELINE) return restored

  const clearRouting = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    delete value.provider
    delete value.model
    delete value.imageProvider
    delete value.imageModel
    delete value.voiceProvider
    delete value.voiceModel
    delete value.videoProvider
    delete value.videoModel
  }

  delete restored.imageProvider
  delete restored.imageModel
  delete restored.voiceProvider
  delete restored.voiceModel
  delete restored.videoProvider
  delete restored.videoModel
  clearRouting(restored.videoConfig)

  const stageOptions = restored.stageOptions
  if (stageOptions && typeof stageOptions === 'object' && !Array.isArray(stageOptions)) {
    clearRouting(stageOptions.generate_assets)
    clearRouting(stageOptions.select_video_scenes && stageOptions.select_video_scenes.video)
    clearRouting(stageOptions.generate_assets && stageOptions.generate_assets.video)
  }

  const textConfig = restored.story2videoTextConfig
  if (textConfig && typeof textConfig === 'object' && !Array.isArray(textConfig)) {
    clearRouting(textConfig.image)
    clearRouting(textConfig.voice)
    clearRouting(textConfig.video)
  }

  // Internal-only marker. It is consumed by Story2Video stage resolution and is
  // never shown in History or exposed as a model-selection control.
  restored.__resumeUseCurrentModels = true
  return restored
}

/**
 * 生成 story2video 流水线运行 ID（同时作为视频创作项目 ID）。
 * 格式：base36 时间戳(8位) + '_' + base36 随机后缀(4位) ≈ 13 字符。
 * 相比旧格式 'run_' + Date.now() + '_' + 随机(共22位) 缩短约 40%，
 * 且去掉了无运行时代码依赖的 'run_' 前缀；base36 时间戳定宽、字典序即时间序，
 * 保留唯一性与时序可排序性，并满足 SAFE_ID 校验、可作磁盘目录名。
 */
function generateRunId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
}

module.exports = { PipelineEngine, STAGE_TYPES, computeDefaultMaxConcurrentRuns, prepareResumeParams, generateRunId };

