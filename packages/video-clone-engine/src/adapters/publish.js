'use strict';

const path = require('node:path');
const { VideoCloneError } = require('../errors');

/**
 * publish adapter（PRD F3.2 / §17）：可选发布。
 * - enabled=false 或未注入 publisher → publishResult { status:'skipped', reason:'no-publisher' }（不失败）
 * - publisher({ media, report }) 抛错 → VIDEOCLONE_PUBLISH_FAILED（retryable）
 * 观测：logger 经 deps 注入（不包内 import），记录 skipped / 成功 / 失败三态结构化日志，
 * 保持无 logger 时行为与既有测试一致（legacy 不引入包内 logger 依赖）。
 */

const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'm4v', 'ts']);

function deriveMediaType(media) {
  if (media && typeof media.type === 'string' && media.type) return media.type;
  if (media && typeof media.path === 'string' && media.path) {
    const ext = path.extname(media.path).replace(/^\./, '').toLowerCase();
    if (!ext) return 'unknown';
    if (VIDEO_EXT.has(ext)) return 'video/' + ext;
    return ext;
  }
  return 'unknown';
}

function createPublish({ publisher = null, enabled = true, logger = null } = {}) {
  function notify(key, meta) {
    if (logger && typeof logger.notify === 'function') {
      logger.notify('VideoClonePublish', key, meta || {});
    }
  }

  async function run(ctx) {
    if (enabled !== true || typeof publisher !== 'function') {
      ctx.publishResult = { status: 'skipped', reason: 'no-publisher' };
      notify('publish-skipped', { params: { reason: 'no-publisher' } });
      return 'publish:skipped';
    }
    const media = ctx.artifacts.output || ctx.artifacts.media;
    try {
      ctx.publishResult = await publisher({ media, report: ctx.report });
      notify('publish-ok', { params: { mediaType: deriveMediaType(media) }, level: 'INFO' });
      return 'publish';
    } catch (err) {
      notify('publish-error', {
        params: { phase: 'publish' },
        errorCategory: 'video_clone_publish',
        level: 'ERROR',
        error: String(err && err.message != null ? err.message : err),
      });
      throw new VideoCloneError('VIDEOCLONE_PUBLISH_FAILED', { phase: 'publish', cause: err });
    }
  }

  return { id: 'publish', run };
}

module.exports = { createPublish, deriveMediaType };
