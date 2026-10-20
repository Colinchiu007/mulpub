// @ts-check
/**
 * StageExecutor - 阶段执行器
 *
 * 职责：
 *   - 定义阶段类型枚举（STAGE_TYPES）
 *   - 为每种阶段类型注册对应的执行器函数
 *   - 支持自定义执行器注册（插件扩展点）
 *   - 提供统一的 execute() 入口供 PipelineEngine 调用
 *
 * 设计意图：
 *   PipelineEngine 原 start()/advance() 仅做状态机切换，不执行真实工作。
 *   StageExecutor 补齐这一缺口：每个阶段对应一次 ServiceBus 调用，
 *   阶段间通过 context 对象传递数据。
 *
 *   旧的 13 条流水线无 stage.type 字段，会回退为 MANUAL_CHECKPOINT，
 *   保持与原状态机行为完全一致。
 */

'use strict';

const {
  createLocalSplitResult,
  isSplitterUnavailableError,
  normalizeServiceSplitResult,
} = require('./story2video-segmentation');
const { collectStory2VideoTtsSamples } = require('./story2video-tts-samples');
// 注意：story2video-compose-engine 顶层执行 findFfmpeg()/findFfprobe()，且 container.setup.test.js 会 mock
// path 模块（无 win32/posix）。因此不能在此顶层 require —— 改为在进度校验处惰性 require。
const {
  buildPromptEngineOptimizeRequest,
  extractOptimizedPrompt,
  selectBestCandidate,
} = require('./prompt-engine-contract');
const { emitStageStart, emitStageItem, emitStageComplete } = require('./stage-progress');

function _firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function _isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const STAGE_PROGRESS_DETAIL_KINDS = new Set(['scene', 'resource', 'image', 'video', 'tts', 'platform', 'segment']);

function _isProgressParamValue(value, depth = 0) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value) || typeof value !== 'number';
  }
  if (depth >= 2 || !_isPlainObject(value)) return false;
  return Object.values(value).every((item) => _isProgressParamValue(item, depth + 1));
}

function _normalizeProgressLocalization(update, key, paramsKey) {
  if (update[key] === undefined || update[key] === null) return null;
  if (typeof update[key] !== 'string' || !update[key].trim() || !update[key].startsWith('stageProgress.')) return false;
  const params = update[paramsKey];
  if (params === undefined || params === null) return { key: update[key].trim() };
  if (!_isPlainObject(params) || !_isProgressParamValue(params)) return false;
  return { key: update[key].trim(), params: { ...params } };
}

/**
 * compose 子进度字段级校验（fail-closed，IPC 边界最后防线）。
 * 语义比引擎的 normalizeComposeProgressUpdate 更严（引擎钳制越界 percent，这里拒绝）：
 * phase 须为 KNOWN_COMPOSE_PHASES 已知枚举；percent 为 number 且有限且 [0,100]，
 * 且「percent 取整 ≥100 仅在 phase === 'done' 时允许」（杜绝假成功信号）；
 * segmentsTotal 存在时为 ≥1 整数；segmentsDone 存在时为 [0, segmentsTotal] 整数；
 * 结构为纯原始值对象。任一约束失败返回 null，调用方应丢弃该次更新。
 * @param {object} update
 * @returns {{phase: string, percent: number, segmentsDone?: number, segmentsTotal?: number, message?: string}|null}
 */
function _normalizeComposeProgressForContext(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  const phase = typeof update.phase === 'string' && update.phase.trim() ? update.phase.trim() : '';
  // 惰性 require：避免模块加载期触发 compose 引擎顶层 findFfmpeg()/findFfprobe()（测试 mock 环境无 path.win32/posix）
  const { KNOWN_COMPOSE_PHASES } = require('./story2video-compose-engine');
  if (!KNOWN_COMPOSE_PHASES.includes(phase)) return null;
  // 严格数值校验：拒绝 Number() 强转穿透（null→0 / []→0 / true→1 / '39'→39）
  if (typeof update.percent !== 'number' || !Number.isFinite(update.percent) || update.percent < 0 || update.percent > 100) return null;
  const roundedPercent = Math.round(update.percent);
  // W1：percent === 100 只允许在 done 阶段出现
  if (roundedPercent >= 100 && phase !== 'done') return null;
  const normalized = { phase, percent: roundedPercent };
  if (update.segmentsTotal !== undefined && update.segmentsTotal !== null) {
    if (typeof update.segmentsTotal !== 'number' || !Number.isInteger(update.segmentsTotal) || update.segmentsTotal < 1) return null;
    normalized.segmentsTotal = update.segmentsTotal;
  }
  if (update.segmentsDone !== undefined && update.segmentsDone !== null) {
    if (typeof update.segmentsDone !== 'number' || !Number.isInteger(update.segmentsDone) || update.segmentsDone < 0) return null;
    if (normalized.segmentsTotal !== undefined && update.segmentsDone > normalized.segmentsTotal) return null;
    normalized.segmentsDone = update.segmentsDone;
  }
  if (typeof update.message === 'string' && update.message) normalized.message = update.message;
  return normalized;
}

/**
 * 阶段进度统一校验（fail-closed，IPC/快照边界最后防线）。
 * 语义与 _normalizeComposeProgressForContext 对齐但更通用：
 * - percent 为 number 且有限且 [0,100]，取整为整数；
 * - message 为非空字符串且 ≤80 字符（用户可见进行中文案，内部生成、纯文本插值）；
 * - summary（可选）为非空字符串且 ≤80 字符（完成态摘要）；
 * - detail（可选）为纯对象 { done, total, kind? }：done/total 为非负整数、total ≥ 1、done ≤ total。
 * - messageKey/summaryKey（可选）必须是 stageProgress.* locale key，参数为浅层纯对象。
 * 任一约束失败返回 null，调用方应丢弃该次更新（fail-closed），不得向 renderer 下发非法值。
 * @param {object} update
 * @returns {{percent: number, message: string, detail?: {done: number, total: number, kind?: string}, summary?: string, messageKey?: string, messageParams?: object, summaryKey?: string, summaryParams?: object}|null}
 */
function normalizeStageProgress(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  const { percent, message } = update;
  // 严格数值校验：拒绝 Number() 强转穿透（null→0 / []→0 / true→1 / '39'→39）
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  if (typeof message !== 'string' || !message.trim()) return null;
  const normalizedMessage = message.trim();
  if (normalizedMessage.length > 80) return null;
  const normalized = { percent: Math.round(percent), message: normalizedMessage };
  const messageLocalization = _normalizeProgressLocalization(update, 'messageKey', 'messageParams');
  const summaryLocalization = _normalizeProgressLocalization(update, 'summaryKey', 'summaryParams');
  if (messageLocalization === false || summaryLocalization === false) return null;
  if (messageLocalization) {
    normalized.messageKey = messageLocalization.key;
    if (messageLocalization.params) normalized.messageParams = messageLocalization.params;
  }
  if (update.summary !== undefined && update.summary !== null) {
    if (typeof update.summary !== 'string' || !update.summary.trim()) return null;
    const summary = update.summary.trim();
    if (summary.length > 80) return null;
    normalized.summary = summary;
  }
  if (summaryLocalization) {
    normalized.summaryKey = summaryLocalization.key;
    if (summaryLocalization.params) normalized.summaryParams = summaryLocalization.params;
  }
  if (update.detail !== undefined && update.detail !== null) {
    if (!_isPlainObject(update.detail)) return null;
    const { done, total } = update.detail;
    if (typeof done !== 'number' || !Number.isInteger(done) || done < 0) return null;
    if (typeof total !== 'number' || !Number.isInteger(total) || total < 1) return null;
    if (done > total) return null;
    const detail = { done, total };
    if (update.detail.kind !== undefined && update.detail.kind !== null) {
      if (typeof update.detail.kind !== 'string' || !STAGE_PROGRESS_DETAIL_KINDS.has(update.detail.kind)) return null;
      detail.kind = update.detail.kind;
    }
    normalized.detail = detail;
  }
  return normalized;
}

/** 将 Story2Video 的界面别名转换为 8002 SplitRequest.config 的真实结构。 */
function _buildStorySplitterOptions(options) {
  const source = _isPlainObject(options) ? options : {};
  const request = {};
  for (const key of ['language', 'mode', 'enable_era', 'enable_topic_segmentation', 'enable_llm']) {
    if (source[key] !== undefined) request[key] = source[key];
  }

  const config = _isPlainObject(source.config) ? { ...source.config } : {};
  const maxSentenceLength = _firstDefined(source.max_sentence_length, source.maxSentenceLength);
  if (maxSentenceLength !== undefined) {
    const tokenizer = _isPlainObject(config.sentence_tokenizer)
      ? { ...config.sentence_tokenizer }
      : {};
    const languageSpecific = _isPlainObject(tokenizer.language_specific)
      ? { ...tokenizer.language_specific }
      : {};
    tokenizer.max_sentence_length = maxSentenceLength;
    tokenizer.language_specific = {
      ...languageSpecific,
      zh: { ...(_isPlainObject(languageSpecific.zh) ? languageSpecific.zh : {}), max_sentence_length: maxSentenceLength },
      en: { ...(_isPlainObject(languageSpecific.en) ? languageSpecific.en : {}), max_sentence_length: maxSentenceLength },
    };
    config.sentence_tokenizer = tokenizer;
  }

  const scene = _isPlainObject(config.scene) ? { ...config.scene } : {};
  const sceneAliases = [
    ['target_seconds', _firstDefined(source.target_seconds, source.target_duration, source.targetDuration)],
    ['base_words_per_second', _firstDefined(source.base_words_per_second, source.baseWordsPerSecond)],
    ['speech_rate', _firstDefined(source.speech_rate, source.speechRate)],
    ['min_words_per_segment', _firstDefined(source.min_words_per_segment, source.min_words, source.minWords)],
    ['max_words_per_segment', _firstDefined(source.max_words_per_segment, source.max_words, source.maxWords)],
    ['enforce_sentence_boundary', _firstDefined(source.enforce_sentence_boundary, source.enforceSentenceBoundary)],
    ['allow_single_sentence_overflow', _firstDefined(
      source.allow_single_sentence_overflow,
      source.allowSingleSentenceOverflow,
      source.overflow_to_next,
      source.overflowToNext,
    )],
  ];
  for (const [key, value] of sceneAliases) {
    if (value !== undefined) scene[key] = value;
  }
  if (Object.keys(scene).length > 0) config.scene = scene;

  // 字幕分块参数透传（v1.2）：subtitle_min_chars / subtitle_max_chars / subtitle_timing
  // → config.subtitle.min_chars_per_block / max_chars_per_block / time_calculation_method
  const subtitle = _isPlainObject(config.subtitle) ? { ...config.subtitle } : {};
  const subtitleAliases = [
    ['min_chars_per_block', _firstDefined(source.subtitle_min_chars, source.subtitleMinChars, source.min_chars_per_block)],
    ['max_chars_per_block', _firstDefined(source.subtitle_max_chars, source.subtitleMaxChars, source.max_chars_per_block)],
    ['time_calculation_method', _firstDefined(source.subtitle_timing, source.subtitleTiming)],
  ];
  for (const [key, value] of subtitleAliases) {
    if (value !== undefined) subtitle[key] = value;
  }
  if (Object.keys(subtitle).length > 0) config.subtitle = subtitle;
  if (source.enable_paragraph_aware !== undefined) {
    config.enable_paragraph_aware = source.enable_paragraph_aware;
  }
  if (source.enable_script_analysis !== undefined) {
    config.enable_script_analysis = source.enable_script_analysis;
  }
  if (Object.keys(config).length > 0) request.config = config;
  return request;
}

/**
 * 阶段类型枚举
 */
const STAGE_TYPES = {
  SPLIT: 'split',                       // 文本分句
  OPTIMIZE: 'optimize',                 // 单个提示词优化
  OPTIMIZE_BATCH: 'optimize_batch',     // 批量提示词优化
  GENERATE_ASSETS: 'generate_assets',   // 资源生成（图片/TTS，委托 Python 技能）
  COMPOSE: 'compose',                   // 视频合成（Story2Video 引擎）
  PUBLISH: 'publish',                   // 多平台发布
  FETCH_PIPELINE: 'fetch_pipeline',     // 从 Python 后端拉取流水线定义
  CALL_SKILL: 'call_skill',             // 通用 Python 技能调用
  MANUAL_CHECKPOINT: 'manual_checkpoint', // 人工检查点（不执行，等待 advance）
  CUSTOM: 'custom',                     // 自定义执行器（stage.executor 函数）
};

/**
 * StageExecutor 类
 */
class StageExecutor {
  /**
   * @param {object} deps
   * @param {object} deps.serviceBus - ServiceBus 实例（必需）
   * @param {object} [deps.container] - DI 容器（用于获取 publisherRouter 等）
   * @param {object} [deps.log] - 日志模块
   */
  constructor({ serviceBus, container, log }) {
    if (!serviceBus) {
      throw new Error('StageExecutor requires serviceBus');
    }
    this.serviceBus = serviceBus;
    this.container = container || null;
    this.log = log || require('./logger');
    this._customExecutors = new Map();
    this._composeParallelTasks = new Map();
    this._builtinExecutors = this._buildBuiltinExecutors();
  }

  /**
   * 注册自定义阶段执行器
   * @param {string} stageType - 阶段类型（建议使用 STAGE_TYPES 枚举）
   * @param {Function} fn - async ({ runId, stage, params, context, serviceBus, container }) => { success, output?, error?, checkpoint? }
   */
  register(stageType, fn) {
    if (typeof fn !== 'function') {
      throw new Error('Executor must be a function');
    }
    this._customExecutors.set(stageType, fn);
    this.log.info('StageExecutor', 'Registered custom executor: ' + stageType);
  }

  /**
   * 注册合成阶段的可选并行任务。工厂必须立即返回 { promise, apply?, timeoutMs? }，
   * 以保证任务与 composeVideo 同时启动；Promise 不得写入流水线 context。
   */
  registerComposeParallelTask(taskType, factory) {
    if (typeof taskType !== 'string' || !taskType.trim() || typeof factory !== 'function') {
      throw new Error('Compose parallel task requires a type and factory');
    }
    this._composeParallelTasks.set(taskType, factory);
    this.log.info('StageExecutor', 'Registered compose parallel task: ' + taskType);
  }

  /**
   * 执行单个阶段
   * @param {object} opts
   * @param {string} opts.runId - 运行 ID
   * @param {object} opts.stage - 阶段定义（包含 name/type/options/inputFrom 等）
   * @param {object} opts.params - 流水线启动参数
   * @param {object} opts.context - 阶段间上下文（前序阶段的 output 集合）
   * @param {Function} [opts.onProgress] - 阶段进行中信息上报回调 `({ percent, message, detail?, summary? }) => void`（可选，additive 扩展）
   * @returns {Promise<{success: boolean, output?: any, error?: string, checkpoint?: boolean}>}
   */
  async execute({ runId, stage, params, context, onProgress }) {
    const stageType = stage.type || STAGE_TYPES.MANUAL_CHECKPOINT;

    // 自定义执行器优先
    const customFn = this._customExecutors.get(stageType);
    if (customFn) {
      return this._safeRun(customFn, { runId, stage, params, context, onProgress });
    }

    // 内置执行器
    const builtinFn = this._builtinExecutors.get(stageType);
    if (!builtinFn) {
      this.log.warn('StageExecutor',
        'Unknown stage type: ' + stageType + ', fallback to manual_checkpoint');
      return { success: true, output: null, checkpoint: true };
    }

    return this._safeRun(builtinFn, { runId, stage, params, context, onProgress });
  }

  /**
   * 安全执行（捕获异常，统一返回格式）
   */
  async _safeRun(fn, opts) {
    try {
      const result = await fn({
        runId: opts.runId,
        stage: opts.stage,
        params: opts.params,
        context: opts.context,
        serviceBus: this.serviceBus,
        container: this.container,
        onProgress: opts.onProgress,
      });
      return result || { success: true, output: null };
    } catch (e) {
      this.log.error('StageExecutor',
        'Stage "' + (opts.stage?.name || 'unknown') + '" failed: ' + e.message);
      return { success: false, error: e.message };
    }
  }

  /**
   * 构建内置执行器映射
   */
  _buildBuiltinExecutors() {
    const map = new Map();
    const self = this;

    // SPLIT - 文本分句
    map.set(STAGE_TYPES.SPLIT, async ({ stage, params, context, runId, onProgress }) => {
      const text = _resolveInput(stage, params, context);
      // split 阶段进行中/完成反馈（统一契约）：调用前发进行中文案，成功后发场景数摘要
      const emitSplitStarted = () => {
        emitStageStart(onProgress, { messageKey: 'stageProgress.splitWorking' });
      };
      const emitSplitDone = (scenesCount) => {
        if (!Number.isInteger(scenesCount) || scenesCount < 1) {
          emitStageComplete(onProgress, { messageKey: 'stageProgress.splitComplete' });
          return;
        }
        emitStageComplete(onProgress, {
          messageKey: 'stageProgress.splitComplete',
          summaryKey: 'stageProgress.splitSummary',
          summaryParams: { count: scenesCount },
          detail: { done: scenesCount, total: scenesCount, kind: 'scene' },
        });
      };
      const sceneCountOf = (output) => {
        const arr = output && (Array.isArray(output.scenes) ? output.scenes : output.sentences);
        return Array.isArray(arr) ? arr.length : 0;
      };
      // 图片轮播模式可以没有文案：为每张用户素材建立一个可优化、可配音的场景。
      // 这样 renderer 传入的图片不会在 split 阶段被误判为缺少输入。
      if (!text && params?.inputMode === 'images' && Array.isArray(params.images) && params.images.length > 0) {
        const scenes = params.images.map((image, index) => {
          const name = typeof image === 'object' ? image.name : ''
          return { index, text: name || ('图片 ' + (index + 1)), sourceImage: image }
        })
        emitSplitDone(scenes.length)
        return { success: true, output: { scenes, sentences: scenes } }
      }
      // 音频模式没有文案时，以每个用户音频建立一个场景；后续阶段会跳过 TTS。
      if (!text && params?.inputMode === 'audio' && Array.isArray(params.audio) && params.audio.length > 0) {
        const scenes = params.audio.map((audio, index) => {
          const item = audio && typeof audio === 'object' ? audio : {}
          const name = typeof item.name === 'string' ? item.name : ''
          const transcript = typeof item.transcript === 'string' ? item.transcript.trim() : ''
          const manualText = typeof item.text === 'string' ? item.text.trim() : ''
          return {
            index,
            text: transcript || manualText || name || ('音频片段 ' + (index + 1)),
            sourceAudio: audio,
          }
        })
        emitSplitDone(scenes.length)
        return { success: true, output: { scenes, sentences: scenes } }
      }
      if (!text) {
        return { success: false, error: 'No text input for split stage' };
      }
      const splitOptions = { ...(stage.options || {}) };
      const fallbackToLocal = splitOptions.fallback_to_local === true;
      const requireSceneOutput = splitOptions.require_scene_output === true;
      delete splitOptions.fallback_to_local;
      delete splitOptions.require_scene_output;
      const serviceOptions = fallbackToLocal || requireSceneOutput
        ? _buildStorySplitterOptions(splitOptions)
        : splitOptions;

      const createFallback = (error) => {
        const output = createLocalSplitResult(text, stage.options || {}, error);
        self.log.warn(
          'StageExecutor',
          'smart-sentence-splitter 不可用，Story2Video 已降级为本地场景分句: ' + output.fallbackReason,
        );
        emitSplitDone(sceneCountOf(output));
        return { success: true, output };
      };

      emitSplitStarted();
      let result;
      try {
        result = await self.serviceBus.splitText(text, { ...serviceOptions, traceId: runId });
      } catch (error) {
        if (!fallbackToLocal || !isSplitterUnavailableError(error)) throw error;
        return createFallback(error);
      }
      // 响应格式适配：Bridge 返回原始数据 { scenes, sentences, ... }
      // 也兼容 Python 后端包装格式 { code: 0, data: ... }
      if (result && (result.scenes || result.sentences || (result.code === 0 && result.data))) {
        const output = result.code === 0 ? (result.data || result) : result;
        if (fallbackToLocal || requireSceneOutput) {
          try {
            const normalized = normalizeServiceSplitResult(output, stage.options || {});
            emitSplitDone(sceneCountOf(normalized));
            return {
              success: true,
              output: normalized,
            };
          } catch (error) {
            return {
              success: false,
              error: 'smart-sentence-splitter 响应无效: ' + error.message,
            };
          }
        }
        emitSplitDone(sceneCountOf(output));
        return { success: true, output };
      }
      if (fallbackToLocal && isSplitterUnavailableError(result)) {
        return createFallback(result);
      }
      const resultError = result && (result.message || result.error);
      return { success: false, error: resultError ? String(resultError) : 'Split failed' };
    });

    // OPTIMIZE - 单个提示词优化（图片提示词统一契约：error 优先 → 结构 → 内容）
    map.set(STAGE_TYPES.OPTIMIZE, async ({ stage, params, context, runId }) => {
      const prompt = _resolveInput(stage, params, context);
      if (!prompt) {
        return { success: false, error: 'No prompt input for optimize stage' };
      }
      const options = stage.options || {};
      // 图片提示词统一契约：构造请求（平台/风格别名归一、自动风格检测、边界收敛）
      const request = buildPromptEngineOptimizeRequest(prompt, options);
      const { prompt: enginePrompt, ...requestOptions } = request;
      const result = await self.serviceBus.optimizePrompt(enginePrompt, { ...requestOptions, traceId: runId });
      const warn = (msg) => { if (self.log && typeof self.log.warn === 'function') self.log.warn('StageExecutor', msg) }
      // 截断上限用契约收敛后的 max_length（I-4：不因原始 stage 越界值误截断/漏截断）
      const validated = extractOptimizedPrompt(result, { maxLength: request.max_length, warn });
      if (validated.ok) {
        // 多候选规则评估择优（num_candidates>1 时外部引擎返回 candidates；
        // 默认启用，options.select_best=false 显式关闭回到现状行为）
        let bestPrompt = validated.prompt
        let bestTruncated = validated.truncated === true
        if (Array.isArray(validated.meta.candidates) && validated.meta.candidates.length > 1 && options.select_best !== false) {
          const best = selectBestCandidate(validated.meta.candidates, prompt)
          if (best) bestPrompt = best.prompt
        }
        // 择优候选未经 extractOptimizedBase 截断：重新施加 max_length 截断（评审 W1）
        if (request.max_length && bestPrompt.length > request.max_length) {
          bestPrompt = Array.from(bestPrompt).slice(0, request.max_length).join('')
          bestTruncated = true
        }
        // 保留原响应字段，但用校验后的 prompt（超长截断时以截断值为准）
        const output = { ...result, optimized_prompt: bestPrompt, ...validated.meta };
        if (bestTruncated) output.truncated = true;
        return { success: true, output };
      }
      // 兼容旧 Bridge 包装 { code: 0, data: { ... } } 成功形态
      let wrapped = null;
      if (result && result.code === 0 && result.data && typeof result.data === 'object') {
        wrapped = extractOptimizedPrompt(result.data, { maxLength: request.max_length, warn });
        if (wrapped.ok) {
          let wrappedBest = wrapped.prompt
          let wrappedTruncated = wrapped.truncated === true
          if (Array.isArray(wrapped.meta.candidates) && wrapped.meta.candidates.length > 1 && options.select_best !== false) {
            const best = selectBestCandidate(wrapped.meta.candidates, prompt)
            if (best) wrappedBest = best.prompt
          }
          // 择优候选未经 extractOptimizedBase 截断：重新施加 max_length 截断（评审 W1）
          if (request.max_length && wrappedBest.length > request.max_length) {
            wrappedBest = Array.from(wrappedBest).slice(0, request.max_length).join('')
            wrappedTruncated = true
          }
          const output = { ...result.data, optimized_prompt: wrappedBest, ...wrapped.meta };
          if (wrappedTruncated) output.truncated = true;
          return { success: true, output };
        }
      }
      // W6：兼容包装路径的失败原因优先用包装内的真实 error/detail，避免「缺少字段」误导
      const reason = (wrapped && wrapped.error) || validated.error ||
        ((result && (result.message || result.detail)) ? String(result.message || result.detail) : 'Optimize failed');
      return { success: false, error: reason };
    });

    // OPTIMIZE_BATCH - 批量提示词优化
    map.set(STAGE_TYPES.OPTIMIZE_BATCH, async ({ stage, params, context, runId }) => {
      let prompts = _resolveInput(stage, params, context);
      // 适配 split 阶段输出：{ scenes: [{ text }], sentences: [{ text }] }
      // 自动从 scenes/sentences 提取文本作为 prompts 数组
      if (prompts && !Array.isArray(prompts)) {
        if (Array.isArray(prompts.scenes)) {
          prompts = prompts.scenes.map(s => s.imagePromptSeed || s.prompt || s.text || s).filter(Boolean);
        } else if (Array.isArray(prompts.sentences)) {
          prompts = prompts.sentences.map(s => s.imagePromptSeed || s.prompt || s.text || s).filter(Boolean);
        }
      }
      if (!Array.isArray(prompts)) {
        return { success: false, error: 'No prompts array for optimize_batch stage' };
      }
      // 批量请求同样按统一契约构造（平台/风格别名归一、自动风格检测、边界收敛），
      // 响应逐项做 error 优先 → 结构 → 内容 校验。
      const requestOptions = buildPromptEngineOptimizeRequest('', stage.options || {});
      delete requestOptions.prompt;
      const result = await self.serviceBus.optimizePromptsBatch(prompts, { ...requestOptions, traceId: runId });
      // 响应格式适配：Bridge 返回数组或 { results: [...] } 或 { code: 0, data: ... }
      if (result && (Array.isArray(result) || Array.isArray(result.results) || (result.code === 0 && result.data))) {
        const output = normalizeBatchOptimizeResult(result);
        if (output.length !== prompts.length) {
          return {
            success: false,
            error: 'Batch optimize result count mismatch: expected ' + prompts.length + ', got ' + output.length,
          };
        }
        const invalidIndex = output.findIndex(item => !hasValidBatchOptimizePrompt(item));
        if (invalidIndex !== -1) {
          return {
            success: false,
            error: 'Batch optimize result item ' + invalidIndex + ' is missing a non-empty prompt',
          };
        }
        return { success: true, output };
      }
      return { success: false, error: (result && (result.message || (result.detail && JSON.stringify(result.detail)))) || 'Batch optimize failed' };
    });

    // GENERATE_ASSETS - 资源生成（委托 Python 技能）
    map.set(STAGE_TYPES.GENERATE_ASSETS, async ({ stage, params, context }) => {
      const input = _resolveInput(stage, params, context);
      const result = await self.serviceBus.callPythonSkill('generate_assets', {
        ...stage.options,
        input,
      });
      if (result && result.code === 0) {
        return { success: true, output: result.data || result };
      }
      return { success: false, error: (result && result.message) || 'Asset generation failed' };
    });

    // COMPOSE - 视频合成（基于 ffmpeg 的真实合成引擎）
    map.set(STAGE_TYPES.COMPOSE, async ({ stage, params, context, runId }) => {
      const assets = _resolveInput(stage, params, context);
      const composeOptionKeys = [
        'transition', 'transitionDuration', 'imageEffect', 'subtitleEnabled', 'subtitleStyle',
        'watermark', 'watermarkText', 'watermarkConfig', 'resolution', 'fps', 'format',
        'bgmPath', 'bgmVolume', 'voiceVolume', 'defaultSceneDuration', 'sceneDurationMode', 'minSceneDuration',
        'videoMode', 'shortVideoHandling',
      ];
      const composeOptions = { ...(stage.options || {}) };
      const parallelTaskType = typeof composeOptions.composeParallelTask === 'string'
        ? composeOptions.composeParallelTask.trim()
        : '';
      delete composeOptions.composeParallelTask;
      if (parallelTaskType && context && typeof context === 'object') {
        delete context.compose_parallel_diagnostic;
      }
      for (const key of composeOptionKeys) {
        if (params[key] !== undefined) composeOptions[key] = params[key];
      }
      // 子进度：重置旧值，保证「无新数据即不渲染」（断点续跑/重试不残留上次冻结进度）。
      if (context && typeof context === 'object') {
        context.compose_progress = undefined;
      }
      // 子进度：把 onProgress 透传给合成引擎，回调字段级校验后写入 context.compose_progress。
      // fail-closed：任一字段非法则丢弃该次更新，绝不向 renderer 下发非法值。
      composeOptions.onProgress = (update) => {
        const normalized = _normalizeComposeProgressForContext(update);
        if (normalized && context && typeof context === 'object') {
          context.compose_progress = normalized;
        }
      };
      const parallelAbortController = typeof AbortController === 'function' ? new AbortController() : null;
      let parallelTaskSpec = null;
      const parallelFactory = parallelTaskType ? self._composeParallelTasks.get(parallelTaskType) : null;
      if (parallelFactory) {
        try {
          const candidate = parallelFactory({
            runId,
            stage,
            params,
            context,
            assets,
            signal: parallelAbortController ? parallelAbortController.signal : undefined,
          });
          parallelTaskSpec = candidate && typeof candidate.then === 'function'
            ? { promise: candidate }
            : candidate;
          if (!parallelTaskSpec || typeof parallelTaskSpec.promise?.then !== 'function') {
            parallelTaskSpec = null;
          }
        } catch (error) {
          parallelTaskSpec = {
            promise: Promise.resolve({
              degraded: true,
              reason: error && error.message ? error.message : String(error),
            }),
          };
        }
      } else if (parallelTaskType && context && typeof context === 'object') {
        context.compose_parallel_diagnostic = {
          taskType: parallelTaskType,
          degraded: true,
          reason: 'parallel task not registered',
        };
      }
      const parallelPromise = parallelTaskSpec
        ? Promise.resolve(parallelTaskSpec.promise).catch((error) => ({
            degraded: true,
            reason: error && error.message ? error.message : String(error),
          }))
        : null;
      const taskTimeout = parallelTaskSpec && Number.isFinite(Number(parallelTaskSpec.timeoutMs))
        ? Number(parallelTaskSpec.timeoutMs)
        : Number((stage.options || {}).composeParallelTimeoutMs);
      const parallelTimeoutMs = Number.isFinite(taskTimeout) ? Math.max(0, taskTimeout) : 60000;
      let parallelTimeoutId;
      const parallelDeadline = parallelPromise
        ? new Promise((resolve) => {
            parallelTimeoutId = setTimeout(() => resolve({ __timeout: true }), parallelTimeoutMs);
          })
        : null;
      const parallelFinalizationPromise = parallelPromise
        ? Promise.race([parallelPromise, parallelDeadline])
        : null;
      const cancelParallelTask = async () => {
        if (parallelAbortController) parallelAbortController.abort();
        if (parallelTaskSpec && typeof parallelTaskSpec.cancel === 'function') {
          try { await parallelTaskSpec.cancel({ runId, stage, params, context, assets }); } catch (_) { /* best effort */ }
        }
      };
      // compose 失败时立即返回 compose 错误；parallelPromise 已绑定 catch，避免后台任务产生未处理 rejection。
      let result;
      try {
        result = await self.serviceBus.composeVideo(assets, composeOptions);
      } catch (error) {
        await cancelParallelTask();
        if (parallelTimeoutId) clearTimeout(parallelTimeoutId);
        throw error;
      }
      // code === 0 或 code === undefined（直接返回数据的桥接）都算成功
      if (result && (result.code === 0 || result.code === undefined)) {
        const composeOutput = result.data || result;
        if (parallelFinalizationPromise) {
          const parallelResult = await parallelFinalizationPromise;
          const timedOut = parallelResult && parallelResult.__timeout === true;
          if (timedOut) {
            await cancelParallelTask();
            if (context && typeof context === 'object') {
              context.compose_parallel_diagnostic = {
                taskType: parallelTaskType,
                degraded: true,
                reason: 'parallel task finalization timeout',
              };
            }
            const apply = parallelTaskSpec && typeof parallelTaskSpec.apply === 'function'
              ? parallelTaskSpec.apply
              : null;
            if (apply) {
              try {
                await apply({
                  runId,
                  stage,
                  params,
                  context,
                  assets,
                  composeOutput,
                  result: { degraded: true, reason: 'parallel task finalization timeout', results: [] },
                });
              } catch (_) { /* 超时后的 fail-open 收尾不得覆盖 compose 成功 */ }
            }
          } else if (parallelResult && (typeof parallelTaskSpec.apply === 'function' || typeof parallelResult.apply === 'function')) {
            try {
              const apply = typeof parallelTaskSpec.apply === 'function' ? parallelTaskSpec.apply : parallelResult.apply;
              await apply({
                runId,
                stage,
                params,
                context,
                assets,
                composeOutput,
                result: parallelResult,
              });
            } catch (error) {
              if (context && typeof context === 'object') {
                context.compose_parallel_diagnostic = {
                  taskType: parallelTaskType,
                  degraded: true,
                  reason: error && error.message ? error.message : String(error),
                };
              }
            }
          }
          if (parallelResult && parallelResult.degraded === true && context && typeof context === 'object' && !context.compose_parallel_diagnostic) {
            context.compose_parallel_diagnostic = {
              taskType: parallelTaskType,
              degraded: true,
              reason: parallelResult.reason || 'parallel task degraded',
            };
          }
          if (parallelResult && !timedOut && parallelResult.degraded !== true && context && typeof context === 'object') {
            delete context.compose_parallel_diagnostic;
          }
        }
        if (parallelTimeoutId) clearTimeout(parallelTimeoutId);
        // 5a：TTS 时长样本采集（best-effort，采集失败不影响流水线；为 5b 自适应校准铺路）
        try {
          collectStory2VideoTtsSamples({
            store: (self.container && typeof self.container.get === 'function') ? self.container.get('store') : null,
            segments: Array.isArray(result?.data?.segments) ? result.data.segments : [],
            config: (params && typeof params === 'object' && !Array.isArray(params) && params.story2videoTextConfig)
              ? params.story2videoTextConfig
              : null,
          })
        } catch (_) { /* 采集为纯增强，异常静默 */ }
        return { success: true, output: result.data || result };
      }
      await cancelParallelTask();
      if (parallelTimeoutId) clearTimeout(parallelTimeoutId);
      // 引擎不可用时返回失败（不再用占位成功）。
      // errorCode/messageParams 必须随失败结果上抛（2026-10-20 error-message-user-friendly-audit）：
      // 否则 compose 预检给出的稳定错误码会被丢在 stage 边界，历史记录失败卡片只能拿到
      // 英文 message，渲染端无法映射自然语言文案。
      return {
        success: false,
        error: (result && result.message) || 'Compose failed',
        errorCode: (result && result.errorCode) || null,
        messageParams: (result && result.messageParams) || null,
      };
    });

    // PUBLISH - 多平台发布
    // P2-10: 重写为 createPublisher 模式，匹配 PublisherRouter 真实 API
    map.set(STAGE_TYPES.PUBLISH, async ({ stage, params, context, onProgress }) => {
      const composeOut = _resolveInput(stage, params, context);
      const configuredPlatforms = stage.platforms || stage.options?.platforms || params.platforms;
      const explicitPublishEnabled = stage.options?.publishEnabled ?? params.publishEnabled;
      // 未显式开启且没有平台选择时，发布是可选步骤，明确标记为跳过。
      // 一旦用户传入平台，则视为明确要求发布，不能静默伪造成功。
      const publishEnabled = explicitPublishEnabled !== undefined
        ? explicitPublishEnabled === true
        : Array.isArray(configuredPlatforms) && configuredPlatforms.length > 0;
      if (!publishEnabled) {
        return {
          success: true,
          output: {
            skipped: true,
            placeholder: false,
            message: 'Publishing disabled or no platforms selected',
            publishedTo: [],
            failedPlatforms: [],
            videoPath: typeof composeOut === 'string'
              ? composeOut
              : (composeOut && composeOut.videoPath) || (params && params.videoPath) || null,
          },
        };
      }

      const router = (self.container && typeof self.container.get === 'function')
        ? self.container.get('publisherRouter')
        : null;

      // 真实发布已开启但 router 未配置时必须失败，避免把“未发布”报告为成功。
      if (!router || typeof router.createPublisher !== 'function') {
        self.log.warn('StageExecutor',
          'PUBLISH: publisherRouter not available while publishing is enabled');
        return { success: false, error: 'PUBLISH: publisherRouter not available' };
      }

      // 1. 解析并验证 videoPath
      // compose 阶段的 output 是 { videoPath, fileSize, segmentCount, duration }
      // _resolveInput 返回整个 compose 对象，需提取 videoPath 字段
      const composeOutput = _resolveInput(stage, params, context);
      let videoPath;
      if (typeof composeOutput === 'string') {
        videoPath = composeOutput;
      } else if (composeOutput && typeof composeOutput === 'object') {
        videoPath = composeOutput.videoPath || composeOutput.path || composeOutput.output;
      } else if (params && params.videoPath) {
        videoPath = params.videoPath;
      }
      if (!videoPath) {
        return { success: false, error: 'PUBLISH: No videoPath resolved from context/params' };
      }
      const fs = require('fs');
      let videoStat;
      try {
        videoStat = fs.statSync(videoPath);
      } catch {
        videoStat = null;
      }
      if (!videoStat || !videoStat.isFile() || videoStat.size <= 0) {
        return {
          success: false,
          error: 'PUBLISH: videoPath does not exist or is empty: ' + videoPath,
        };
      }

      // 2. 解析并验证 platforms
      const platforms = stage.platforms || stage.options?.platforms || params.platforms || [];
      if (!Array.isArray(platforms) || platforms.length === 0) {
        return {
          success: false,
          error: 'PUBLISH: No platforms specified (stage.platforms or params.platforms required)',
        };
      }

      // 3. 构建 publish deps（rpaViewManager + store + pythonBridge 从 container 获取）
      const rpaViewManager = (self.container && typeof self.container.get === 'function')
        ? self.container.get('rpaViewManager') : null;
      const store = (self.container && typeof self.container.get === 'function')
        ? self.container.get('store') : null;
      const pythonBridge = (self.container && typeof self.container.get === 'function')
        ? self.container.get('pythonBridge') : null;
      const publishDeps = { rpaViewManager, store, pythonBridge };

      // 4. 逐平台发布（createPublisher + publisher.publish 模式）
      // 进行中反馈：每完成一个平台上报一次（阶段进度统一契约，openspec pipeline-progress-feedback-unification）
      const results = [];
      const platformTotal = platforms.length;
      for (let platformIndex = 0; platformIndex < platforms.length; platformIndex += 1) {
        const platform = platforms[platformIndex];
        try {
          const publisher = router.createPublisher(platform, publishDeps);
          const task = {
            id: 's2v_' + Date.now() + '_' + platform,
            platform,
            article: {
              video_path: videoPath,
              title: stage.options?.title || params.title || '',
              content: stage.options?.content || params.content || '',
              tags: stage.options?.tags || [],
              cover_url: stage.options?.coverUrl || params.coverUrl || '',
            },
          };
          const r = await publisher.publish(task);
          results.push({
            platform,
            success: !!(r && r.success),
            url: r?.url || r?.postId || '',
            error: r?.success ? null : (r?.error || 'Publish failed'),
          });
          self.log.info('StageExecutor',
            'PUBLISH: ' + platform + ' ' + (r?.success ? 'success' : 'failed') +
            (r?.url ? ' url=' + r.url : ''));
        } catch (e) {
          results.push({
            platform,
            success: false,
            url: '',
            error: e instanceof Error ? e.message : String(e),
          });
          self.log.warn('StageExecutor',
            'PUBLISH: ' + platform + ' exception: ' + (e instanceof Error ? e.message : String(e)));
        }
        // 每平台完成后上报（成功/失败均推进计数；发布阶段不因单个平台失败而停滞反馈）
        emitStageItem(onProgress, platformIndex + 1, platformTotal, {
          messageKey: 'stageProgress.publishing',
          messageParams: { platform },
          kind: 'platform',
        });
      }

      // 5. 汇总结果
      const succeeded = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      const overallSuccess = succeeded.length > 0; // 至少一个平台成功

      return {
        success: overallSuccess,
        output: {
          placeholder: false,
          videoPath,
          publishedTo: succeeded.map(r => r.platform),
          failedPlatforms: failed.map(r => r.platform),
          results,
          stats: {
            total: platforms.length,
            succeeded: succeeded.length,
            failed: failed.length,
          },
        },
        error: overallSuccess ? null : 'All platforms failed: ' +
          failed.map(r => r.platform + '(' + r.error + ')').join(', '),
      };
    });

    // FETCH_PIPELINE - 从 Python 后端拉取流水线定义
    map.set(STAGE_TYPES.FETCH_PIPELINE, async ({ stage, params }) => {
      const name = stage.pipelineName || params.pipelineName;
      if (!name) {
        return { success: false, error: 'No pipelineName for fetch_pipeline stage' };
      }
      const result = await self.serviceBus.fetchPipeline(name);
      if (result && result.code === 0) {
        return { success: true, output: result.data || result };
      }
      return { success: false, error: (result && result.message) || 'Fetch pipeline failed' };
    });

    // CALL_SKILL - 通用 Python 技能调用
    map.set(STAGE_TYPES.CALL_SKILL, async ({ stage, params, context }) => {
      const skillName = stage.skillName;
      if (!skillName) {
        return { success: false, error: 'No skillName for call_skill stage' };
      }
      const skillContext = {
        ...params,
        ...context,
        ...stage.options,
      };
      const result = await self.serviceBus.callPythonSkill(skillName, skillContext);
      if (result && result.code === 0) {
        return { success: true, output: result.data || result };
      }
      return { success: false, error: (result && result.message) || 'Skill call failed' };
    });

    // MANUAL_CHECKPOINT - 人工检查点（不执行，等待 advance）
    map.set(STAGE_TYPES.MANUAL_CHECKPOINT, async () => {
      return { success: true, output: null, checkpoint: true };
    });

    // CUSTOM - 自定义函数（stage.executor 或 params.executor）
    map.set(STAGE_TYPES.CUSTOM, async ({ stage, params, context, runId }) => {
      const fn = stage.executor || params.executor;
      if (typeof fn !== 'function') {
        return { success: false, error: 'No executor function for custom stage' };
      }
      const result = await fn({
        runId,
        stage,
        params,
        context,
        serviceBus: self.serviceBus,
        container: self.container,
      });
      return result || { success: true, output: null };
    });

    return map;
  }
}

/**
 * 解析阶段输入：优先从 context 取（前序阶段输出），其次从 params 取
 * @param {object} stage - 阶段定义
 * @param {object} params - 流水线参数
 * @param {object} context - 阶段间上下文
 * @returns {any}
 */
function _resolveInput(stage, params, context) {
  if (stage.inputFrom && context && context[stage.inputFrom] !== undefined) {
    return context[stage.inputFrom];
  }
  if (stage.inputKey && params && params[stage.inputKey] !== undefined) {
    return params[stage.inputKey];
  }
  // 默认 fallback：尝试常见的输入键
  if (params) {
    return params.text || params.prompt || params.prompts ||
           params.assets || params.videoPath || null;
  }
  return null;
}

/** 将不同 Bridge 响应包装统一为提示词结果数组。 */
function normalizeBatchOptimizeResult(result) {
  let value = result;
  if (result && result.code === 0) value = result.data || result;
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.results)) return value.results;
  if (value && Array.isArray(value.optimized_prompts)) return value.optimized_prompts;
  if (value && (value.optimized_prompt !== undefined || value.prompt !== undefined)) return [value];
  return [];
}

function hasValidBatchOptimizePrompt(item) {
  if (typeof item === 'string') return item.trim().length > 0;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  // error 优先：/v1/optimize 失败兜底返回原文+error，忽略即静默降级
  if (typeof item.error === 'string' && item.error.trim()) return false;
  if (Array.isArray(item.detail)) return false;
  const prompt = item.prompt || item.optimized_prompt || item.optimized;
  return typeof prompt === 'string' && prompt.trim().length > 0;
}

module.exports = { StageExecutor, STAGE_TYPES, normalizeBatchOptimizeResult, normalizeStageProgress };
