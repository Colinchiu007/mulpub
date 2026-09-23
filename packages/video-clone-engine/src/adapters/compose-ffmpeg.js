'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { VideoCloneError } = require('../errors');
const { resolveBinary, runCommand, runFfprobe, runFfmpegSceneDetect, timesToShots } = require('./runners');

const DEFAULT_TARGET = { w: 1080, h: 1920 }; // 默认 9:16 竖屏
const ASPECT_TARGETS = {
  '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 }, '3:4': { w: 1080, h: 1440 },
};

function resolveTargetSize(report) {
  const meta = (report && report.meta) || {};
  let w = meta.width;
  let h = meta.height;
  if ((!w || !h) && typeof meta.resolution === 'string') {
    const m = meta.resolution.match(/^([0-9]+)x([0-9]+)$/);
    if (m) { w = Number(m[1]); h = Number(m[2]); }
  }
  if (w && h) return { w, h };
  const aspect = (report && report.platformParams && report.platformParams.aspect) || '9:16';
  return ASPECT_TARGETS[aspect] || DEFAULT_TARGET;
}

/** ASS 字幕（script.lines → Dialogue 行；样式简版：白字描边居中底部） */
function buildAssScript(lines, style = {}) {
  const BS = String.fromCharCode(92);
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    'Style: Default,' + (style.font || 'Microsoft YaHei') + ',' + (style.size || 48) + ',&H00FFFFFF,&H00000000,&H80000000,0,2,2,2,60,60,60', '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const fmt = (s) => {
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
    const cs = Math.round((s - Math.floor(s)) * 100);
    return String(h).padStart(1, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
  };
  for (const l of lines || []) {
    if (!l || !l.text) continue;
    header.push('Dialogue: 0,' + fmt(l.t0 || 0) + ',' + fmt(l.t1 || (l.t0 || 0) + 1) + ',Default,,0,0,0,,{' + BS + 'an2}' + String(l.text).replace(new RegExp(String.fromCharCode(10), 'g'), BS + 'N'));
  }
  return header.join('\n');
}

/** ASS 字幕路径转义（反斜杠→正斜杠；冒号/引号转义，规避工具链转义折叠用 fromCharCode） */
function escapeAssPath(p) {
  const bs = String.fromCharCode(92);
  return String(p).split(bs).join('/').split(':').join(bs + ':').split(String.fromCharCode(39)).join(bs + String.fromCharCode(39));
}

/** ffmpeg 合成命令构建（纯函数）：图片序列 + 可选音频/水印/字幕 → 输出（PRD F3.2/§17） */
function buildComposeCommand({ report, assets, outputPath, fps = 30 }) {
  const isL0 = assets && assets.level === 'L0';
  const shots = (report && report.visual && report.visual.shots) || [];
  const scenes = (assets && assets.scenes) || [];
  // L0 文案级（v1.16）：单封面图循环全时长 + 字幕 + 音频，不做逐镜头拼接
  if (isL0) {
    if (scenes.length !== 1) {
      throw new VideoCloneError('VIDEOCLONE_COMPOSE_FAILED', { phase: 'compose', params: { reason: 'L0 需要单封面素材' } });
    }
    const target = resolveTargetSize(report);
    const dur = Math.max(0.5, scenes[0].durationSec || (report.meta && report.meta.durationSec) || 10);
    const args = ['-y', '-loop', '1', '-t', String(dur), '-i', scenes[0].path];
    let audioIdx = null;
    if (assets.audio && assets.audio.path) { audioIdx = 1; args.push('-i', assets.audio.path); }
    let wmIdx = null;
    if (assets.watermark && assets.watermark.path) { wmIdx = (audioIdx === null ? 1 : 2); args.push('-i', assets.watermark.path); }
    const fc = ['[0:v]scale=' + target.w + ':' + target.h + ':force_original_aspect_ratio=decrease,pad=' + target.w + ':' + target.h + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + fps + '[outv]'];
    let outLabel = '[outv]';
    if (assets.subtitles && assets.subtitles.path) {
      fc.push(outLabel + 'subtitles=' + "'" + escapeAssPath(assets.subtitles.path) + "'" + '[outv2]');
      outLabel = '[outv2]';
    }
    if (wmIdx !== null) {
      fc.push(outLabel + '[' + wmIdx + ':v]overlay=W-w-16:16[outv3]');
      outLabel = '[outv3]';
    }
    args.push('-filter_complex', fc.join(';'), '-map', outLabel);
    if (audioIdx !== null) args.push('-map', audioIdx + ':a');
    args.push('-t', String(dur), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath);
    return { args, totalDurationSec: dur };
  }
  if (shots.length === 0) {
    throw new VideoCloneError('VIDEOCLONE_COMPOSE_FAILED', { phase: 'compose', params: { reason: '报告无镜头' } });
  }
  if (scenes.length < shots.length) {
    throw new VideoCloneError('VIDEOCLONE_COMPOSE_FAILED', { phase: 'compose', params: { reason: '素材数量不足' } });
  }
  const target = resolveTargetSize(report);
  const args = ['-y'];
  const inputs = [];
  shots.forEach((s, i) => {
    const dur = Math.max(0.5, (s.t1 || 0) - (s.t0 || 0));
    const scene = scenes[i] || {};
    // 视频素材（真实视频模型生成的动态片段）不能使用图片循环参数 -loop 1；
    // 图片素材保留 -loop 1 以循环静态图。依据 kind 优先，其次扩展名兜底。
    const isVideoAsset = scene.kind === 'video' || /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(String(scene.path || ''));
    if (isVideoAsset) {
      args.push('-t', String(dur), '-i', scene.path);
    } else {
      args.push('-loop', '1', '-t', String(dur), '-i', scene.path);
    }
    inputs.push({ dur });
  });
  let audioIdx = null;
  if (assets && assets.audio && assets.audio.path) {
    audioIdx = inputs.length;
    args.push('-i', assets.audio.path);
  }
  let wmIdx = null;
  if (assets && assets.watermark && assets.watermark.path) {
    wmIdx = audioIdx === null ? inputs.length : inputs.length + 1;
    args.push('-i', assets.watermark.path);
  }

  const fc = [];
  const labels = [];
  for (let i = 0; i < inputs.length; i++) {
    const label = 'v' + i;
    fc.push('[' + i + ':v]scale=' + target.w + ':' + target.h + ':force_original_aspect_ratio=decrease,pad=' + target.w + ':' + target.h + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + fps + '[' + label + ']');
    labels.push('[' + label + ']');
  }
  fc.push(labels.join('') + 'concat=n=' + inputs.length + ':v=1:a=0[outv]');

  let outLabel = '[outv]';
  if (assets && assets.subtitles && assets.subtitles.path) {
    const esc = escapeAssPath(assets.subtitles.path);
    fc.push(outLabel + 'subtitles=' + "'" + esc + "'" + '[outv2]');
    outLabel = '[outv2]';
  }
  if (wmIdx !== null) {
    fc.push(outLabel + '[' + wmIdx + ':v]overlay=W-w-16:16[outv3]');
    outLabel = '[outv3]';
  }
  args.push('-filter_complex', fc.join(';'), '-map', outLabel);
  if (audioIdx !== null) args.push('-map', audioIdx + ':a');
  const total = inputs.reduce((a, s) => a + s.dur, 0);
  args.push('-t', String(total), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath);
  return { args, totalDurationSec: total };
}

/**
 * compose adapter（PRD F3.2/§17）：buildComposeCommand → ffmpeg 执行 → ffprobe 校验 + 产物场景实测。
 * 失败 VIDEOCLONE_COMPOSE_FAILED（retryable）；输出写 artifacts.output：
 * - probeOk：ffprobe 是否实测（失败时 durationSec 回退计划值，由消费方按 plan-fallback 处理）
 * - shots 三态：数组（实测切点，≥1 段；零切点=单段=合法实测）| null（场景检测失败/未注入）
 * - probeError / sceneError：降级原因（成功时为 null），经 pipeline 流入 similarity.warnings
 */
function createFfmpegCompose({
  ffmpegRunner = null, ffprobeRunner = runFfprobe, sceneRunner = runFfmpegSceneDetect, outputDir = null, fps = 30,
  logger = null,
} = {}) {
  // 降级留痕（审计 P2·静默 catch 收口）：ffprobe 校验失败与场景检测失败都是「有意不阻断」，
  // 但原先连失败原因都没留下——上游只能看到 probeOk=false / shots=null 两个布尔值，
  // 线上无法区分是路径不存在、超时还是解码失败。这里同时做两件事：
  // 1) 把原因写进 artifacts.output，随 measured 报告一路流到 similarity.warnings（用户可见）；
  // 2) 注入 logger 时补一条 warn（未注入不外抛，保持 adapter 纯函数式）。
  function noteFailure (stage, err) {
    const msg = String((err && err.message) || err);
    if (logger && typeof logger.warn === 'function') logger.warn('VideoClone:' + stage, msg);
    return msg;
  }

  async function run(ctx) {
    const report = ctx.report;
    const assets = ctx.artifacts.assets || {};
    // 传入 outputDir 时在其下创建唯一子目录：避免并发/重新生成互相覆盖，
    // 同时让成品落在调用方可控的媒体白名单根内（桌面端 story2video 临时根）。
    const baseDir = outputDir || (await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vc-out-')));
    if (outputDir) await fs.promises.mkdir(outputDir, { recursive: true });
    const dir = outputDir ? await fs.promises.mkdtemp(path.join(outputDir, 'vc-')) : baseDir;
    const outputPath = path.join(dir, 'clone.mp4');
    let built;
    try {
      built = buildComposeCommand({ report, assets, outputPath, fps });
    } catch (err) {
      if (err instanceof VideoCloneError) throw err;
      throw new VideoCloneError('VIDEOCLONE_COMPOSE_FAILED', { phase: 'compose', cause: err });
    }
    const runner = ffmpegRunner || (async (args) => {
      const bin = resolveBinary('VC_FFMPEG_PATH', 'FFMPEG_PATH', 'ffmpeg');
      await runCommand(bin, args, { timeoutMs: 600000 });
    });
    try {
      await runner(built.args);
    } catch (err) {
      throw new VideoCloneError('VIDEOCLONE_COMPOSE_FAILED', { phase: 'compose', cause: err });
    }
    let meta = null;
    let probeOk = false;
    let probeError = null;
    // 输出校验失败仍返回，由相似度/门禁兜底（时长走 plan-fallback）
    try { meta = await ffprobeRunner(outputPath); probeOk = true; } catch (err) { probeError = noteFailure('probe', err); }
    let shots = null;
    let sceneMethod = null;
    let sceneError = null;
    if (typeof sceneRunner === 'function') {
      try {
        const cutTimes = await sceneRunner(outputPath, { threshold: 0.3 });
        shots = timesToShots(Array.isArray(cutTimes) ? cutTimes : [], meta ? meta.durationSec : built.totalDurationSec);
        sceneMethod = 'ffmpeg-scene';
      } catch (err) {
        // 场景检测失败不阻断：shots=null，由相似度层显式降级
        sceneError = noteFailure('scene-detect', err);
      }
    }
    ctx.artifacts.output = {
      path: outputPath,
      durationSec: meta ? meta.durationSec : built.totalDurationSec,
      width: meta ? meta.width : null,
      height: meta ? meta.height : null,
      fps: meta && Number.isFinite(meta.fps) ? meta.fps : null,
      sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : null,
      probeOk,
      shots,
      sceneMethod,
      probeError,
      sceneError,
    };
    return 'compose';
  }

  return { id: 'compose', run };
}

module.exports = { createFfmpegCompose, buildComposeCommand, buildAssScript, escapeAssPath, resolveTargetSize, ASPECT_TARGETS };
