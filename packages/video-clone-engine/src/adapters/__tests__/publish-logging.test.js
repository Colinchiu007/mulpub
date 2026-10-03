'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPublish, deriveMediaType } = require('../publish');
const { VideoCloneError } = require('../../errors');

function makeLogger() {
  const calls = [];
  return {
    calls,
    notify(module, messageKey, meta) {
      calls.push({ module, messageKey, meta });
    },
  };
}

function findNotify(logger, key) {
  return logger.calls.find((c) => c.messageKey === key);
}

test('无 publisher → 记录 publish-skipped（reason:no-publisher）', async () => {
  const logger = makeLogger();
  const p = createPublish({ publisher: null, logger });
  const ctx = { artifacts: { media: { path: 'x.mp4' } }, report: {} };
  await p.run(ctx);
  assert.equal(ctx.publishResult.status, 'skipped');
  const c = findNotify(logger, 'publish-skipped');
  assert.ok(c, '应记录 publish-skipped');
  assert.equal(c.module, 'VideoClonePublish');
  assert.equal(c.meta.params.reason, 'no-publisher');
});

test('enabled=false → 记录 publish-skipped', async () => {
  const logger = makeLogger();
  const p = createPublish({ publisher: async () => ({ published: true }), enabled: false, logger });
  const ctx = { artifacts: { media: { path: 'x.mp4' } }, report: {} };
  await p.run(ctx);
  assert.ok(findNotify(logger, 'publish-skipped'), '应记录 publish-skipped');
});

test('publisher 成功 → 记录 publish-ok（level:INFO，mediaType 取自 media）', async () => {
  const logger = makeLogger();
  const p = createPublish({ publisher: async () => ({ published: true, platform: 'douyin' }), logger });
  const ctx = { artifacts: { output: { path: 'clip.mp4' } }, report: {} };
  await p.run(ctx);
  assert.deepEqual(ctx.publishResult, { published: true, platform: 'douyin' });
  const c = findNotify(logger, 'publish-ok');
  assert.ok(c, '应记录 publish-ok');
  assert.equal(c.meta.level, 'INFO');
  assert.equal(c.meta.params.mediaType, 'video/mp4');
});

test('publisher 成功且 media 带 type → 优先用 type', async () => {
  const logger = makeLogger();
  const p = createPublish({ publisher: async () => ({ published: true }), logger });
  const ctx = { artifacts: { output: { type: 'image/custom', path: 'x.png' } }, report: {} };
  await p.run(ctx);
  const c = findNotify(logger, 'publish-ok');
  assert.equal(c.meta.params.mediaType, 'image/custom');
});

test('publisher 抛错 → 记录 publish-error（level:ERROR，errorCategory:video_clone_publish，error 为 String）', async () => {
  const logger = makeLogger();
  const p = createPublish({ publisher: async () => { throw new Error('pub boom'); }, logger });
  const ctx = { artifacts: { output: { path: 'x.mp4' } }, report: {} };
  await assert.rejects(() => p.run(ctx), (e) => e instanceof VideoCloneError && e.code === 'VIDEOCLONE_PUBLISH_FAILED' && e.retryable === true);
  const c = findNotify(logger, 'publish-error');
  assert.ok(c, '应记录 publish-error');
  assert.equal(c.meta.level, 'ERROR');
  assert.equal(c.meta.errorCategory, 'video_clone_publish');
  assert.equal(c.meta.params.phase, 'publish');
  assert.equal(c.meta.error, 'pub boom');
});

test('未注入 logger → 行为与既有测试一致（不抛错、不记录）', async () => {
  const p = createPublish({ publisher: async () => ({ published: true }) });
  const ctx = { artifacts: { media: { path: 'x.mp4' } }, report: {} };
  await p.run(ctx);
  assert.equal(ctx.publishResult.published, true);
});

test('deriveMediaType 边界：extname 映射 / type 优先 / 无路径 unknown', () => {
  assert.equal(deriveMediaType({ type: 'video/mp4' }), 'video/mp4');
  assert.equal(deriveMediaType({ path: '/a/b/c.MOV' }), 'video/mov');
  assert.equal(deriveMediaType({ path: '/a/b/c.png' }), 'png');
  assert.equal(deriveMediaType({ path: '/a/b/c' }), 'unknown');
  assert.equal(deriveMediaType(null), 'unknown');
  assert.equal(deriveMediaType({}), 'unknown');
});
