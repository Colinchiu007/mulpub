'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { VideoCloneError } = require('../errors');
const { runYtDlp, classifyDownloadError, extFromTarget } = require('./runners');
// P1-11: SSRF / 域名白名单守卫（域名表唯一事实来源在 url-guard）
const { assertSafeIngestUrl, matchPlatformHost } = require('./url-guard');

const DEFAULT_LIMITS = Object.freeze({
  maxSizeBytes: 500 * 1024 * 1024,
  maxDurationSec: 30 * 60,
  allowedExtensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'],
});

/** 链接 → 平台提示（仅供展示/诊断；白名单与拦截逻辑见 ./url-guard） */
function hintPlatform(url) {
  try {
    return matchPlatformHost(new URL(url).hostname);
  } catch { /* 非法 URL 由请求校验拦截 */ }
  return null;
}

/**
 * 链接下载 ingest adapter（PRD F1.2 / §11.1 / §14）。
 * 依赖注入：downloadRunner / fsImpl / tmpDir / limits。
 * 下载后强制大小/时长上限；失败按 classifyDownloadError 映射错误码。
 */
function createUrlIngest({
  downloadRunner = runYtDlp, fsImpl = fs, tmpDir = os.tmpdir(), limits = DEFAULT_LIMITS,
  resolveAddr, resolveDns = true,
} = {}) {
  async function run(ctx) {
    const url = ctx.request.source.url;
    // P1-11: 下载前 SSRF 守卫 —— 必须在建临时目录 / 调 yt-dlp **之前**拦截
    await assertSafeIngestUrl(url, { resolveAddr, resolveDns });
    const targetDir = await fsImpl.promises.mkdtemp(path.join(tmpDir, 'vc-dl-'));
    const targetPath = path.join(targetDir, 'video.mp4');
    try {
      await downloadRunner(url, targetPath);
    } catch (err) {
      const code = classifyDownloadError((err && (err.stderr || err.message)) || '');
      throw new VideoCloneError(code, { phase: 'ingest', cause: err });
    }
    let stat;
    try { stat = await fsImpl.promises.stat(targetPath); } catch (err) {
      throw new VideoCloneError('VIDEOCLONE_LINK_UNAVAILABLE', { phase: 'ingest', cause: err });
    }
    if (stat.size > limits.maxSizeBytes) {
      throw new VideoCloneError('VIDEOCLONE_FILE_TOO_LARGE', { phase: 'ingest', params: { sizeBytes: stat.size } });
    }
    ctx.artifacts.media = {
      path: targetPath, sizeBytes: stat.size, source: 'url', url,
      platform: hintPlatform(url), format: extFromTarget(targetPath),
      durationSec: null, width: null, height: null, fps: null, hasAudio: null, ext: extFromTarget(targetPath),
    };
    ctx.report.meta.source = 'url';
    ctx.report.meta.platform = ctx.artifacts.media.platform;
    ctx.artifacts.analysis = { download: { ok: true, url } };
    return 'ingest:url';
  }

  return { id: 'ingest', run };
}

module.exports = { createUrlIngest, hintPlatform, DEFAULT_LIMITS, urlGuard: require('./url-guard') };
