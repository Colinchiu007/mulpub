/**
 * PNG 像素级图像对比。
 * 使用纯 JavaScript 的 pngjs + pixelmatch，避免原生 canvas 缺失时退化成字节比较。
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { assertBaselineContent } = require('./baseline-content-guard');

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function validatePng(filePath, label) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError(label + '图片路径必须是非空字符串');
  }

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(PNG_SIGNATURE.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (
      bytesRead !== PNG_SIGNATURE.length
      || !header.equals(PNG_SIGNATURE)
    ) {
      const error = new Error(label + '不是有效 PNG 图片：' + filePath);
      error.code = 'ERR_INVALID_IMAGE';
      throw error;
    }
  } finally {
    await handle.close();
  }
}

async function readPng(filePath, label) {
  try {
    return PNG.sync.read(await fs.promises.readFile(filePath));
  } catch (cause) {
    const error = new Error(label + 'PNG 解码失败：' + filePath, { cause });
    error.code = 'ERR_INVALID_IMAGE';
    throw error;
  }
}

class PixelDiffProvider {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.1;
    this.outputDir = options.outputDir || 'reports/pixel-diff';
    this.pixelThreshold = options.pixelThreshold ?? 0.1;
    this.available = true;
  }

  async compare(baseline, current, name = 'diff') {
    await Promise.all([
      validatePng(baseline, '基线'),
      validatePng(current, '当前'),
    ]);

    const startedAt = Date.now();
    const [baselineImage, currentImage] = await Promise.all([
      readPng(baseline, '基线'),
      readPng(current, '当前'),
    ]);

    if (
      baselineImage.width !== currentImage.width
      || baselineImage.height !== currentImage.height
    ) {
      return {
        comparisonMode: 'pixelmatch',
        reason: '图片尺寸不一致',
        dimensions: {
          baseline: [baselineImage.width, baselineImage.height],
          current: [currentImage.width, currentImage.height],
        },
        misMatchPercentage: 100,
        rawMisMatchPercentage: 100,
        diffBounds: null,
        analysisTime: Date.now() - startedAt,
        diffImagePath: null,
        passed: false,
      };
    }

    const diff = new PNG({
      width: baselineImage.width,
      height: baselineImage.height,
    });
    const mismatchedPixels = pixelmatch(
      baselineImage.data,
      currentImage.data,
      diff.data,
      baselineImage.width,
      baselineImage.height,
      {
        threshold: this.pixelThreshold,
        includeAA: false,
        alpha: 0.5,
      },
    );
    const totalPixels = baselineImage.width * baselineImage.height;
    const misMatchPercentage = totalPixels === 0
      ? 0
      : (mismatchedPixels / totalPixels) * 100;
    const outputPath = path.join(this.outputDir, name + '-' + Date.now() + '.png');

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, PNG.sync.write(diff));

    return {
      comparisonMode: 'pixelmatch',
      mismatchedPixels,
      misMatchPercentage,
      rawMisMatchPercentage: misMatchPercentage,
      diffBounds: null,
      analysisTime: Date.now() - startedAt,
      diffImagePath: outputPath,
      passed: misMatchPercentage <= this.threshold * 100,
    };
  }

  async updateBaseline(current, baselinePath) {
    const data = await fs.promises.readFile(current);
    // 基线入库前内容下限校验：拦截「明显未渲染」的空白截图（事故原型 PR #2075→#2114，
    // 空白基线会让后续像素对比恒等于自洽）。人工审核后确属空页可用 BASELINE_ALLOW_EMPTY=1 放行。
    if (process.env.BASELINE_ALLOW_EMPTY !== '1') {
      assertBaselineContent(data, { label: path.basename(baselinePath) });
    }
    await fs.promises.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.promises.writeFile(baselinePath, data);
    return baselinePath;
  }
}

module.exports = { PixelDiffProvider };
