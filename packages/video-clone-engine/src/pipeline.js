'use strict';

const { REPLICATION_LEVELS, REPLICATION_MODES, SOURCE_TYPES, STAGES, VIDEO_TYPES } = require('./constants');
const { VideoCloneError } = require('./errors');
const { createStageExecutor } = require('./stage-executor');
const { emptyReport, validateCloneReport, sanitizeReportForIpc } = require('./clone-report');
const { computeSimilarityReport } = require('./similarity');

const STAGE_IDS = STAGES;

/** 请求校验（PRD §3 F1 + §11.1） */
function validateRequest(request) {
  const errors = [];
  if (!request || typeof request !== 'object') return { ok: false, errors: ['request 缺失'] };
  const src = request.source || {};
  if (!SOURCE_TYPES.includes(src.type)) errors.push('source.type: 非法来源（local|url）');
  if (src.type === 'local') {
    if (typeof src.path !== 'string' || src.path.trim() === '') errors.push('source.path: 本地文件必须提供非空 path');
    if (src.url !== undefined && src.url !== null) errors.push('source.url: 本地来源不允许携带 url');
  }
  if (src.type === 'url') {
    if (typeof src.url !== 'string' || src.url.trim() === '' || !String(src.url).toLowerCase().startsWith('https://')) errors.push('source.url: 必须提供 https 链接');
    if (src.path !== undefined && src.path !== null) errors.push('source.path: 链接来源不允许携带 path');
  }
  const opts = request.options || {};
  if (opts.replicationLevel !== undefined && !REPLICATION_LEVELS.includes(opts.replicationLevel)) errors.push('options.replicationLevel: 非法（L0|L1|L2）');
  if (opts.mode !== undefined && !REPLICATION_MODES.includes(opts.mode)) errors.push('options.mode: 非法复刻模式');
  if (opts.videoTypes !== undefined && !Array.isArray(opts.videoTypes)) errors.push('options.videoTypes: 必须是数组');
  if (Array.isArray(opts.videoTypes)) {
    for (const t of opts.videoTypes) if (!VIDEO_TYPES.includes(t)) errors.push('options.videoTypes: 非法视频类型 ' + t);
  }
  if (opts.rewriteScript !== undefined && typeof opts.rewriteScript !== 'boolean') errors.push('options.rewriteScript: 必须是布尔值');
  if (opts.target !== undefined && !['P1', 'P2'].includes(opts.target)) errors.push('options.target: 非法（P1|P2）');
  if (opts.failOnLowSimilarity !== undefined && typeof opts.failOnLowSimilarity !== 'boolean') errors.push('options.failOnLowSimilarity: 必须是布尔值');
  return { ok: errors.length === 0, errors };
}

/** 统一失败形状 */
function failureResult(runId, context, error) {
  return {
    ok: false, runId: runId || null, error,
    report: context ? sanitizeReportForIpc(context.report) : null,
    artifacts: context ? sanitizeReportForIpc(context.artifacts) : null,
    similarity: context ? context.similarity : null,
    publishResult: context ? context.publishResult : null,
  };
}

function serializeErr(err) {
  return err && err.toJSON && typeof err.toJSON === 'function' ? err.toJSON() : { code: String((err && err.code) || (err && err.message) || 'UNKNOWN') };
}

/**
 * 由产物实测构建 merge clone 报告（不污染 ctx.report）：
 * - probeOk=true → meta.durationSec/resolution/fps 用产物 ffprobe 实测值（provenance=measured）
 * - shots 为数组（≥1 段，零切点=单段）→ timeline/visual.shots 用产物场景实测（provenance=measured）
 *   shots 为 null（检测失败/未注入）→ 沿用 plan 值 + sceneDetectFailed 警告（plan-fallback，不静默）
 * - script/scriptStyle/palette 继承 plan：字幕烧录进产物、风格已应用，为合理代理（plan-constructive）
 *   产物无 ASR/TTS，script/style 并非产物实测 → 由调用方附加 unmeasuredScript 警告
 * - 无产物（fake adapter/部分流水线）→ 整体回退 plan 报告
 */
function buildMeasuredCloneReport(ctx) {
  const plan = ctx.report;
  const provenance = { structure: 'plan-constructive', duration: 'plan-constructive', script: 'plan-constructive', style: 'plan-constructive' };
  const warnings = {};
  const out = ctx.artifacts && ctx.artifacts.output;
  if (!out || typeof out.path !== 'string') {
    return { report: plan, provenance, warnings };
  }
  const measured = emptyReport();
  const meta = {
    source: plan.meta.source,
    platform: plan.meta.platform !== undefined ? plan.meta.platform : null,
    durationSec: plan.meta.durationSec,
    resolution: plan.meta.resolution,
    fps: plan.meta.fps,
  };
  if (out.probeOk === true) {
    if (Number.isFinite(out.durationSec) && out.durationSec > 0) { meta.durationSec = out.durationSec; provenance.duration = 'measured'; }
    if (Number.isFinite(out.width) && Number.isFinite(out.height) && out.width > 0 && out.height > 0) {
      meta.resolution = out.width + 'x' + out.height;
    }
    if (Number.isFinite(out.fps) && out.fps > 0) meta.fps = out.fps;
  } else {
    provenance.duration = 'plan-fallback';
    // 有意降级必须可见：把 compose 记录的原因带到 similarity.warnings（无原因时给 unknown 占位）
    warnings.probeFailed = out.probeError || 'unknown';
  }
  measured.meta = meta;
  if (Array.isArray(out.shots)) {
    measured.narrative.timeline = out.shots.map((s) => ({ t0: s.t0, t1: s.t1, label: 'shot' }));
    measured.visual.shots = out.shots.map((s) => ({ t0: s.t0, t1: s.t1, type: 'unknown', motion: 'unknown' }));
    measured.visual.transitions = out.shots.length > 1 ? ['cut'] : [];
    provenance.structure = 'measured';
  } else {
    measured.narrative.timeline = plan.narrative.timeline;
    measured.visual.shots = plan.visual.shots;
    measured.visual.transitions = plan.visual.transitions;
    warnings.sceneDetectFailed = true;
    warnings.sceneDetectReason = out.sceneError || 'unknown';
    provenance.structure = 'plan-fallback';
  }
  measured.script = plan.script;
  measured.scriptStyle = plan.scriptStyle;
  measured.visual.palette = plan.visual.palette;
  measured.platformParams = plan.platformParams;
  return { report: measured, provenance, warnings };
}

/**
 * 创建视频克隆流水线。executorOptions 支持：
 * - eventSink({type, ...})：stage:started|stage:succeeded|stage:failed|aborted
 * - abortSignal：AbortSignal（阶段边界协作中止）
 */
function createVideoClonePipeline(adapters = {}, executorOptions = {}) {
  const { eventSink = null, abortSignal = null, stageIds = null, ...execOpts } = executorOptions || {};
  const executor = createStageExecutor(execOpts);
  const ACTIVE_STAGES = stageIds && Array.isArray(stageIds) && stageIds.length > 0 ? stageIds : STAGE_IDS;

  function emit(type, data) {
    if (typeof eventSink === 'function') { try { eventSink(Object.assign({ type }, data || {})); } catch { /* 事件回调异常不阻断 */ } }
  }

  function stageFor(id) {
    const adapter = adapters[id];
    if (!adapter || typeof adapter.run !== 'function') return executor.notImplemented(id);
    return { id, run: adapter.run };
  }

  async function run(request) {
    const check = validateRequest(request);
    if (!check.ok) {
      return failureResult(null, null, new VideoCloneError('VIDEOCLONE_INVALID_REQUEST', { params: { errors: check.errors } }));
    }
    if (abortSignal && abortSignal.aborted) {
      emit('aborted', { stage: null, reason: 'request-aborted' });
      return failureResult(null, null, new VideoCloneError('VIDEOCLONE_INTERNAL', { params: { reason: 'aborted' } }));
    }

    const runId = 'vc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const context = {
      request, report: emptyReport(), sourceReport: null,
      artifacts: {}, similarity: null, publishResult: null,
    };
    if (request.options && request.options.initialReport) {
      const v = validateCloneReport(request.options.initialReport);
      if (!v.ok) {
        return failureResult(null, null, new VideoCloneError('VIDEOCLONE_INVALID_REPORT', { params: { errors: v.errors } }));
      }
      context.report = sanitizeReportForIpc(request.options.initialReport);
      context.sourceReport = sanitizeReportForIpc(request.options.initialReport);
    }

    const wrapped = ACTIVE_STAGES.map((id) => {
      const base = stageFor(id);
      return {
        id,
        run: async (ctx) => {
          if (abortSignal && abortSignal.aborted) {
            emit('aborted', { stage: id });
            throw new VideoCloneError('VIDEOCLONE_INTERNAL', { phase: id, params: { reason: 'aborted' } });
          }
          emit('stage:started', { stage: id });
          try {
            const out = await base.run(ctx);
            if (id === 'analyze') {
              if (!ctx.sourceReport) ctx.sourceReport = sanitizeReportForIpc(ctx.report);
              const v = validateCloneReport(ctx.report);
              if (!v.ok) throw new VideoCloneError('VIDEOCLONE_INVALID_REPORT', { phase: 'analyze', params: { errors: v.errors } });
            }
            if (id === 'compose') {
              const v = validateCloneReport(ctx.report);
              if (!v.ok) throw new VideoCloneError('VIDEOCLONE_INVALID_REPORT', { phase: 'compose', params: { errors: v.errors } });
              const target = (ctx.request.options && ctx.request.options.target) || 'P1';
              // 有效层级：请求显式层级 > 报告（plan 自动定级）> L1（v1.16）
              const reqLevel = ctx.request.options && ctx.request.options.replicationLevel;
              const repLevel = ctx.report.replication && ctx.report.replication.level;
              // 相似度用产物实测 merge 报告（结构/时长实测，script/style 为 plan 代理），不污染 ctx.report
              const measured = buildMeasuredCloneReport(ctx);
              const sim = computeSimilarityReport({
                source: ctx.sourceReport || ctx.report, clone: measured.report,
                target, level: reqLevel || repLevel || 'L1',
              });
              sim.provenance = measured.provenance;
              if (measured.warnings.sceneDetectFailed) sim.warnings.sceneDetectFailed = true;
              if (measured.warnings.sceneDetectReason) sim.warnings.sceneDetectReason = measured.warnings.sceneDetectReason;
              if (measured.warnings.probeFailed) sim.warnings.probeFailed = measured.warnings.probeFailed;
              sim.warnings.unmeasuredScript = true; // 产物无 ASR/TTS，script/style 维度非产物实测
              if (ctx.artifacts.assets && ctx.artifacts.assets.degraded === true) sim.warnings.degradedAssets = true;
              ctx.similarity = sim;
              const failOnLow = ctx.request.options && ctx.request.options.failOnLowSimilarity === true;
              if (failOnLow && (sim.verdict === 'needs_review' || sim.verdict === 'insufficient_evidence')) {
                throw new VideoCloneError('VIDEOCLONE_SIMILARITY_LOW', { phase: 'compose', params: { similarity: sim } });
              }
            }
            emit('stage:succeeded', { stage: id });
            return out;
          } catch (err) {
            emit('stage:failed', { stage: id, error: serializeErr(err) });
            throw err;
          }
        },
      };
    });

    const outcome = await executor.runStages(wrapped, context);
    if (!outcome.ok) return failureResult(runId, context, outcome.error);

    return {
      ok: true, runId,
      report: sanitizeReportForIpc(context.report),
      reportSource: sanitizeReportForIpc(context.sourceReport),
      artifacts: sanitizeReportForIpc(context.artifacts),
      similarity: context.similarity,
      publishResult: context.publishResult,
    };
  }

  return { run, stages: STAGE_IDS };
}

// buildMeasuredCloneReport 导出仅为回归用例（降级原因传递），不对外承诺 API 稳定性
module.exports = { createVideoClonePipeline, validateRequest, STAGE_IDS, buildMeasuredCloneReport };
