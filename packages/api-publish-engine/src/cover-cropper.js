/**
 * 封面裁剪 — 各平台封面图适配
 * 参考同类产品 coverRequirements + sharp
 */
const REQUIREMENTS = {
  bilibili: { width: 1146, height: 717, ratio: "16:10" },
  weibo: { width: 1080, height: 1080, ratio: "1:1" },
  zhihu: { width: 1920, height: 1080, ratio: "16:9" },
  douyin: { width: 1080, height: 1440, ratio: "3:4" },
  xiaohongshu: { width: 1080, height: 1440, ratio: "3:4" },
  kuaishou: { width: 1080, height: 1440, ratio: "3:4" },
  tencent_video: { width: 1080, height: 1080, ratio: "1:1" },
  baijiahao: { width: 1216, height: 684, ratio: "16:9" },
};

async function cropCover(imagePath, platform) {
  const req = REQUIREMENTS[platform];
  if (!req) return imagePath;
  try {
    const sharp = require("sharp");
    const meta = await sharp(imagePath).metadata();
    const targetW = req.width;
    const targetH = req.height;
    // Resize with crop
    const outPath = imagePath.replace(/\.(\w+)$/, "_" + platform + ".");
    await sharp(imagePath)
      .resize(targetW, targetH, { fit: "cover", position: "centre" })
      .toFile(outPath);
    return outPath;
  } catch (e) {
    console.warn("Cover crop failed:", e.message);
    return imagePath;
  }
}

module.exports = { cropCover, REQUIREMENTS };