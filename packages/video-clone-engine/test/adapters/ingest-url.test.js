'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { createUrlIngest, hintPlatform } = require('../../src/adapters/ingest-url');
const { classifyDownloadError } = require('../../src/adapters/runners');
const { emptyReport } = require('../../src/clone-report');
const { VideoCloneError } = require('../../src/errors');

test('classifyDownloadError 错误分类映射', () => {
  assert.equal(classifyDownloadError('ERROR: This video is private'), 'VIDEOCLONE_LINK_PRIVATE');
  assert.equal(classifyDownloadError('ERROR: members-only content'), 'VIDEOCLONE_LINK_MEMBERSHIP');
  assert.equal(classifyDownloadError('not available in your country'), 'VIDEOCLONE_LINK_REGION');
  assert.equal(classifyDownloadError('ERROR: Sign in to confirm you are not a bot'), 'VIDEOCLONE_LINK_ANTI_BOT');
  assert.equal(classifyDownloadError('ERROR: Video unavailable'), 'VIDEOCLONE_LINK_UNAVAILABLE');
  assert.equal(classifyDownloadError('ERROR: [youtube] Video unavailable'), 'VIDEOCLONE_LINK_UNAVAILABLE');
});

test('hintPlatform 域名识别', () => {
  assert.equal(hintPlatform('https://www.douyin.com/video/123'), 'douyin');
  assert.equal(hintPlatform('https://youtu.be/abc'), 'youtube');
  assert.equal(hintPlatform('https://xhslink.com/x/1'), 'xiaohongshu');
  assert.equal(hintPlatform('https://example.com/x'), null);
});

test('链接下载成功：media + platform hint + meta', async () => {
  const tmp = path.join(os.tmpdir(), 'vc-test-' + Date.now());
  const ingest = createUrlIngest({
    downloadRunner: async () => { /* 真实下载由 runner 负责 */ },
    fsImpl: { promises: { mkdtemp: async () => tmp, stat: async () => ({ size: 1024 }) } },
    // P1-11: 守卫默认校验 DNS 解析结果，单测注入公网地址避免依赖真实解析
    resolveAddr: async () => [{ address: '142.250.190.78' }],
  });
  const ctx = { request: { source: { url: 'https://www.youtube.com/watch?v=abc' } }, report: emptyReport(), artifacts: {} };
  const out = await ingest.run(ctx);
  assert.equal(out, 'ingest:url');
  assert.equal(ctx.artifacts.media.source, 'url');
  assert.equal(ctx.artifacts.media.platform, 'youtube');
  assert.equal(ctx.report.meta.source, 'url');
  assert.equal(ctx.report.meta.platform, 'youtube');
});

test('下载失败 → 按文本映射错误码', async () => {
  const ingest = createUrlIngest({
    downloadRunner: async () => { throw Object.assign(new Error('fail'), { stderr: 'ERROR: This video is private' }); },
    fsImpl: { promises: { mkdtemp: async () => 'tmp', stat: async () => ({ size: 1 }) } },
    resolveAddr: async () => [{ address: '220.181.10.1' }],
  });
  await assert.rejects(
    () => ingest.run({ request: { source: { url: 'https://www.douyin.com/video/1' } }, report: emptyReport(), artifacts: {} }),
    (e) => e instanceof VideoCloneError && e.code === 'VIDEOCLONE_LINK_PRIVATE' && e.retryable === false,
  );
});

test('下载产物超限 → FILE_TOO_LARGE', async () => {
  const ingest = createUrlIngest({
    downloadRunner: async () => {},
    fsImpl: { promises: { mkdtemp: async () => 'tmp', stat: async () => ({ size: 600 * 1024 * 1024 }) } },
    resolveAddr: async () => [{ address: '185.45.5.100' }],
  });
  await assert.rejects(
    () => ingest.run({ request: { source: { url: 'https://www.tiktok.com/@x/video/1' } }, report: emptyReport(), artifacts: {} }),
    (e) => e.code === 'VIDEOCLONE_FILE_TOO_LARGE',
  );
});
