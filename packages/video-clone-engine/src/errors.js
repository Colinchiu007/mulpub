'use strict';

/**
 * 错误分类表（PRD §4 错误状态 + §11.4 错误码）。
 * 每个错误码：phase（所属阶段）、retryable（是否有界重试）、userMessageKey（渲染端本地化键）。
 * 约定：所有用户可见文案由渲染端按 key 本地化，engine 不直接输出面向用户的自然语言。
 */
const ERROR_CATALOG = Object.freeze({
  VIDEOCLONE_INVALID_REQUEST: { phase: 'preflight', retryable: false, userMessageKey: 'videoClone.error.invalidRequest' },
  VIDEOCLONE_SOURCE_UNSUPPORTED: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.sourceUnsupported' },
  // P1-11b: SSRF 守卫拦截（内网/回环/元数据地址）独立成码，不复用 LINK_PRIVATE ——
  // 否则用户会看到「该视频为私密内容」，把安全拦截误判为内容权限问题。
  VIDEOCLONE_LINK_BLOCKED: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.linkBlocked' },
  VIDEOCLONE_LINK_UNAVAILABLE: { phase: 'ingest', retryable: true, userMessageKey: 'videoClone.error.linkUnavailable' },
  VIDEOCLONE_LINK_PRIVATE: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.linkPrivate' },
  VIDEOCLONE_LINK_MEMBERSHIP: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.linkMembership' },
  VIDEOCLONE_LINK_REGION: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.linkRegion' },
  VIDEOCLONE_LINK_ANTI_BOT: { phase: 'ingest', retryable: true, userMessageKey: 'videoClone.error.linkAntiBot' },
  VIDEOCLONE_FILE_TOO_LARGE: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.fileTooLarge' },
  VIDEOCLONE_FILE_TOO_LONG: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.fileTooLong' },
  VIDEOCLONE_FILE_NOT_FOUND: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.fileNotFound' },
  VIDEOCLONE_FILE_FORMAT: { phase: 'ingest', retryable: false, userMessageKey: 'videoClone.error.fileFormat' },
  VIDEOCLONE_PROBE_FAILED: { phase: 'ingest', retryable: true, userMessageKey: 'videoClone.error.probeFailed' },
  VIDEOCLONE_ASR_FAILED: { phase: 'analyze', retryable: true, userMessageKey: 'videoClone.error.asrFailed' },
  VIDEOCLONE_ANALYZE_FAILED: { phase: 'analyze', retryable: true, userMessageKey: 'videoClone.error.analyzeFailed' },
  VIDEOCLONE_INVALID_REPORT: { phase: 'analyze', retryable: false, userMessageKey: 'videoClone.error.invalidReport' },
  VIDEOCLONE_REPORT_EDIT_INVALID: { phase: 'plan', retryable: false, userMessageKey: 'videoClone.error.reportEditInvalid' },
  VIDEOCLONE_REWRITE_FAILED: { phase: 'plan', retryable: true, userMessageKey: 'videoClone.error.rewriteFailed' },
  VIDEOCLONE_ASSET_GENERATION_FAILED: { phase: 'generate', retryable: true, userMessageKey: 'videoClone.error.assetGenerationFailed' },
  VIDEOCLONE_PROVIDER_UNAVAILABLE: { phase: 'generate', retryable: true, userMessageKey: 'videoClone.error.providerUnavailable' },
  VIDEOCLONE_COMPOSE_FAILED: { phase: 'compose', retryable: true, userMessageKey: 'videoClone.error.composeFailed' },
  VIDEOCLONE_SIMILARITY_LOW: { phase: 'compose', retryable: false, userMessageKey: 'videoClone.error.similarityLow' },
  VIDEOCLONE_PUBLISH_FAILED: { phase: 'publish', retryable: true, userMessageKey: 'videoClone.error.publishFailed' },
  VIDEOCLONE_STAGE_NOT_IMPLEMENTED: { phase: 'preflight', retryable: false, userMessageKey: 'videoClone.error.stageNotImplemented' },
  VIDEOCLONE_INTERNAL: { phase: 'preflight', retryable: false, userMessageKey: 'videoClone.error.internal' },
});

/** 业务错误：携带 code + phase + 是否可重试 + 附加参数 */
class VideoCloneError extends Error {
  constructor(code, opts = {}) {
    const meta = ERROR_CATALOG[code] || ERROR_CATALOG.VIDEOCLONE_INTERNAL;
    const message = opts.message || code;
    super(message);
    this.name = 'VideoCloneError';
    this.code = code;
    this.phase = opts.phase || meta.phase;
    this.retryable = opts.retryable !== undefined ? !!opts.retryable : meta.retryable;
    this.userMessageKey = meta.userMessageKey;
    this.params = opts.params || null;
    this.cause = opts.cause || null;
  }

  toJSON() {
    return {
      code: this.code,
      phase: this.phase,
      retryable: this.retryable,
      userMessageKey: this.userMessageKey,
      params: this.params,
    };
  }
}

/** 按 phase 过滤目录（供阶段 adapter 快速查表） */
function catalogForPhase(phase) {
  const out = {};
  for (const [code, meta] of Object.entries(ERROR_CATALOG)) {
    if (meta.phase === phase) out[code] = meta;
  }
  return out;
}

module.exports = { ERROR_CATALOG, VideoCloneError, catalogForPhase };
