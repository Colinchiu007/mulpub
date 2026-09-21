/**
 * 像素基线内容守卫测试（QM-5 回归保护 · PR #2114 事故反哺）
 *
 * 验证 updateBaseline 拒绝「明显未渲染」的空白截图入库（空白基线会让像素回归
 * 恒等于自洽），并校准守卫能通过全部现存真实基线。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PNG } from "pngjs";
import fs from "fs";
import path from "path";
import os from "os";
import { assertBaselineContent, analyzePngContent, DEFAULTS } from "./providers/baseline-content-guard";
import { PixelDiffProvider } from "./providers/pixel-diff";

function makePng(width, height, painter) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = painter(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const WHITE = () => [255, 255, 255];
const WITH_CONTENT = (x, y) => (y > 300 && y < 900 && x > 100 && x < 1800 ? [30, 27, 75] : [255, 255, 255]);

describe("baseline-content-guard", () => {
  it("整页纯白截图被拒绝（dominant + 着墨率双指标命中）", () => {
    const buf = makePng(1920, 1080, WHITE);
    expect(() => assertBaselineContent(buf)).toThrow(/基线内容校验未通过/);
    try {
      assertBaselineContent(buf);
    } catch (e) {
      expect(e.code).toBe("ERR_VISUAL_BASELINE_SUSPECT_EMPTY");
    }
  });

  it("尺寸低于下限被拒绝", () => {
    const buf = makePng(800, 600, WITH_CONTENT);
    expect(() => assertBaselineContent(buf)).toThrow(/尺寸/);
  });

  it("有正常内容区的 1920x1080 截图通过", () => {
    const buf = makePng(1920, 1080, WITH_CONTENT);
    expect(() => assertBaselineContent(buf)).not.toThrow();
  });

  it("非 PNG 字节被拒绝", () => {
    expect(() => assertBaselineContent(Buffer.from("not a png"))).toThrow(/解码失败/);
  });

  // 已知空白基线（本守卫引入时发现的存量缺陷，与 PR #2075 dashboard.png 同源：
  // 1920x1080 纯白，像素对比恒自洽）——单独建档重建后从列表移除。
  const KNOWN_EMPTY_BASELINES = ["analytics-overview.png"];

  it("现存全部真实基线均通过守卫（阈值校准）", () => {
    const dir = path.join(__dirname, "base-screenshots");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".png") && !KNOWN_EMPTY_BASELINES.includes(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const buf = fs.readFileSync(path.join(dir, f));
      expect(() => assertBaselineContent(buf, { label: f }), `${f} 应通过内容守卫`).not.toThrow();
    }
  });

  it("已知空白基线确实会被守卫拦截（确认存量缺陷定性）", () => {
    expect(KNOWN_EMPTY_BASELINES.length).toBeGreaterThan(0);
    for (const f of KNOWN_EMPTY_BASELINES) {
      const buf = fs.readFileSync(path.join(__dirname, "base-screenshots", f));
      expect(() => assertBaselineContent(buf, { label: f }), `${f} 应被拦截`).toThrow(/基线内容校验未通过/);
    }
  });
});

describe("PixelDiffProvider.updateBaseline 集成", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-guard-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.BASELINE_ALLOW_EMPTY;
  });

  it("空白截图拒绝入库，基线文件不落盘", async () => {
    const provider = new PixelDiffProvider({ outputDir: tmpDir });
    const current = path.join(tmpDir, "blank-current.png");
    const baseline = path.join(tmpDir, "blank.png");
    fs.writeFileSync(current, makePng(1920, 1080, WHITE));
    await expect(provider.updateBaseline(current, baseline)).rejects.toThrow(/基线内容校验未通过/);
    expect(fs.existsSync(baseline)).toBe(false);
  });

  it("BASELINE_ALLOW_EMPTY=1 人工审核后显式放行", async () => {
    process.env.BASELINE_ALLOW_EMPTY = "1";
    const provider = new PixelDiffProvider({ outputDir: tmpDir });
    const current = path.join(tmpDir, "blank-current.png");
    const baseline = path.join(tmpDir, "blank.png");
    fs.writeFileSync(current, makePng(1920, 1080, WHITE));
    await expect(provider.updateBaseline(current, baseline)).resolves.toBe(baseline);
    expect(fs.existsSync(baseline)).toBe(true);
  });
});
