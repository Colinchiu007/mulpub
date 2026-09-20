/**
 * baseline-content-guard.js — 像素基线入库前的最小内容校验
 *
 * 事故原型（PR #2075 → #2114）：视觉 runner 注入 animation:0s!important 会让
 * 「基础 opacity:0 + 靠动画变可见」的元素永久隐形，用它生成的像素基线是空白页
 * （当时 dashboard.png 48KB 仅含 header+横幅）。空白基线让后续所有像素对比
 * 恒等于自洽，视觉回归形同虚设。
 *
 * 本守卫在 updateBaseline 入库前拦截「明显未渲染」的截图：
 *  1. 尺寸下限（视口截图应为 1920x1080，过小 = 截图/渲染异常）；
 *  2. 单一颜色占比 ≥ 99.5%（整页近纯色）；
 *  3. 折叠线（25% 高度）以下非近白像素占比 < 下限（内容区空白）。
 * 注意：它拦不住「语义空白」（如整页只有顶部横幅），新基线仍必须人工目检内容，
 * 该流程要求见 learnings: visual-runner-animation-disable-blank-baseline。
 */
'use strict';

const { PNG } = require('pngjs');

const DEFAULTS = {
  minWidth: 1280,
  minHeight: 720,
  maxDominantRatio: 0.995,
  minBelowFoldInkRatio: 0.003,
  nearWhiteChannel: 245, // r/g/b 均 ≥ 该值视为近白
};

/** 分析 PNG 内容指标（纯计算，供守卫与测试复用） */
function analyzePngContent(png, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { width, height, data } = png;
  const total = width * height;
  const dominantCounts = new Map();
  const foldY = Math.floor(height * 0.25);
  let belowFoldTotal = 0;
  let belowFoldInk = 0;

  for (let y = 0; y < height; y++) {
    const rowBase = y * width * 4;
    const belowFold = y >= foldY;
    for (let x = 0; x < width; x++) {
      const i = rowBase + x * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = (r << 16) | (g << 8) | b;
      dominantCounts.set(key, (dominantCounts.get(key) || 0) + 1);
      if (belowFold) {
        belowFoldTotal++;
        if (r < o.nearWhiteChannel || g < o.nearWhiteChannel || b < o.nearWhiteChannel) {
          belowFoldInk++;
        }
      }
    }
  }

  let maxCount = 0;
  for (const c of dominantCounts.values()) if (c > maxCount) maxCount = c;

  return {
    width,
    height,
    uniqueColors: dominantCounts.size,
    dominantRatio: total === 0 ? 1 : maxCount / total,
    belowFoldInkRatio: belowFoldTotal === 0 ? 0 : belowFoldInk / belowFoldTotal,
  };
}

/**
 * 校验基线截图内容下限；不通过则 throw（code=ERR_VISUAL_BASELINE_SUSPECT_EMPTY）。
 * @param {Buffer} buffer PNG 文件字节
 * @param {{label?: string, minWidth?: number, minHeight?: number,
 *   maxDominantRatio?: number, minBelowFoldInkRatio?: number}} [opts]
 */
function assertBaselineContent(buffer, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const label = o.label ? `${o.label}: ` : '';
  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch (cause) {
    const error = new Error(`${label}基线 PNG 解码失败，拒绝入库`, { cause });
    error.code = 'ERR_VISUAL_BASELINE_SUSPECT_EMPTY';
    throw error;
  }
  const m = analyzePngContent(png, o);
  const problems = [];
  if (m.width < o.minWidth || m.height < o.minHeight) {
    problems.push(`尺寸 ${m.width}x${m.height} 低于下限 ${o.minWidth}x${o.minHeight}`);
  }
  if (m.dominantRatio >= o.maxDominantRatio) {
    problems.push(`单一颜色占 ${(m.dominantRatio * 100).toFixed(2)}%（≥${o.maxDominantRatio * 100}%，疑似整页空白）`);
  }
  if (m.belowFoldInkRatio < o.minBelowFoldInkRatio) {
    problems.push(`折叠线以下着墨率 ${(m.belowFoldInkRatio * 100).toFixed(3)}% 低于下限 ${o.minBelowFoldInkRatio * 100}%（疑似内容区未渲染）`);
  }
  if (problems.length > 0) {
    const error = new Error(
      `${label}基线内容校验未通过 → ${problems.join('；')}。` +
      '若确认页面本应如此（如登录门控页），人工审核后可用 BASELINE_ALLOW_EMPTY=1 显式放行'
    );
    error.code = 'ERR_VISUAL_BASELINE_SUSPECT_EMPTY';
    error.suspectEmpty = true;
    throw error;
  }
  return m;
}

module.exports = { analyzePngContent, assertBaselineContent, DEFAULTS };
