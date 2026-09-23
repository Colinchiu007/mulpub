'use strict';

/**
 * 审计 P2·静默 catch 收口（video-clone-engine compose）回归保护。
 *
 * 被保护的行为：ffprobe 校验失败 / 场景检测失败仍是「有意不阻断」的降级，但降级原因
 * 必须留痕并可一路流到 similarity.warnings（用户可见），不得再退化为纯布尔值。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFfmpegCompose } = require('../../src/adapters/compose-ffmpeg');
const { buildMeasuredCloneReport } = require('../../src/pipeline');
const { emptyReport } = require('../../src/clone-report');

function baseCtx() {
  const r = emptyReport();
  r.visual.shots = [{ t0: 0, t1: 2 }, { t0: 2, t1: 5 }];
  r.meta.durationSec = 5;
  r.meta.resolution = '320x240';
  r.platformParams.aspect = '16:9';
  return {
    report: r,
    artifacts: { assets: { scenes: [{ path: 'a.png', dur: 2 }, { path: 'b.png', dur: 3 }] } },
  };
}

test('ffprobe 失败：不阻断但原因进 probeError，并调用注入的 logger.warn', async () => {
  const calls = [];
  const compose = createFfmpegCompose({
    ffmpegRunner: async () => {},
    ffprobeRunner: async () => { throw new Error('probe 打不开文件'); },
    sceneRunner: null,
    logger: { warn: (tag, msg) => calls.push([tag, msg]) },
  });
  const ctx = baseCtx();
  await compose.run(ctx);
  const out = ctx.artifacts.output;
  assert.equal(out.probeOk, false, '仍按降级继续，不抛错');
  assert.match(out.probeError, /probe 打不开文件/, '降级原因必须留痕');
  assert.deepEqual(calls, [['VideoClone:probe', 'probe 打不开文件']]);
  // 时长回退计划值（原语义不变）
  assert.equal(out.durationSec, 5);
});

test('场景检测失败：shots 仍为 null，原因进 sceneError 并留 warn', async () => {
  const calls = [];
  const compose = createFfmpegCompose({
    ffmpegRunner: async () => {},
    ffprobeRunner: async () => ({ durationSec: 4.8, width: 320, height: 240, fps: 10 }),
    sceneRunner: async () => { throw new Error('scene 检测超时'); },
    logger: { warn: (tag, msg) => calls.push([tag, msg]) },
  });
  const ctx = baseCtx();
  await compose.run(ctx);
  assert.equal(ctx.artifacts.output.shots, null);
  assert.equal(ctx.artifacts.output.probeOk, true);
  assert.equal(ctx.artifacts.output.probeError, null, '成功路径不得留错误');
  assert.match(ctx.artifacts.output.sceneError, /scene 检测超时/);
  assert.deepEqual(calls, [['VideoClone:scene-detect', 'scene 检测超时']]);
});

test('未注入 logger 时不外抛（adapter 仍可在纯管道内使用）', async () => {
  const compose = createFfmpegCompose({
    ffmpegRunner: async () => {},
    ffprobeRunner: async () => { throw new Error('boom'); },
    sceneRunner: async () => { throw new Error('boom2'); },
  });
  const ctx = baseCtx();
  await compose.run(ctx);
  assert.equal(ctx.artifacts.output.probeError, 'boom');
  assert.equal(ctx.artifacts.output.sceneError, 'boom2');
});

test('measured 报告：降级原因流入 similarity 可见的 warnings（含 unknown 占位）', () => {
  const ctx = baseCtx();
  ctx.artifacts.output = {
    path: 'x.mp4', probeOk: false, probeError: 'probe 打不开文件',
    shots: null, sceneError: 'scene 检测超时', durationSec: 5,
  };
  const m = buildMeasuredCloneReport(ctx);
  assert.equal(m.warnings.sceneDetectFailed, true, '原布尔口径不变');
  assert.equal(m.warnings.sceneDetectReason, 'scene 检测超时');
  assert.equal(m.warnings.probeFailed, 'probe 打不开文件');
  assert.equal(m.provenance.duration, 'plan-fallback');

  const bare = baseCtx();
  bare.artifacts.output = { path: 'x.mp4', shots: null };
  const m2 = buildMeasuredCloneReport(bare);
  assert.equal(m2.warnings.probeFailed, 'unknown', '缺原因也要留占位，不得静默');
  assert.equal(m2.warnings.sceneDetectReason, 'unknown');
});

test('实测成功路径不产生降级 warnings', () => {
  const ctx = baseCtx();
  ctx.artifacts.output = {
    path: 'x.mp4', probeOk: true, probeError: null, durationSec: 5, width: 320, height: 240, fps: 30,
    shots: [{ t0: 0, t1: 5 }], sceneMethod: 'ffmpeg-scene', sceneError: null,
  };
  const m = buildMeasuredCloneReport(ctx);
  assert.deepEqual(m.warnings, {});
  assert.equal(m.provenance.structure, 'measured');
  assert.equal(m.provenance.duration, 'measured');
});

test('防复发静态不变量：compose adapter 不再有无留痕的空 catch', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/adapters/compose-ffmpeg.js'), 'utf8');
  const silent = src.match(/catch\s*\{\s*(\/\*[^*]*\*\/|\/\/[^\n]*)?\s*\}/g) || [];
  assert.deepEqual(silent, [], 'catch 必须记录原因或转抛：' + JSON.stringify(silent));
});
