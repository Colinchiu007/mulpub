import { describe, it, expect } from "vitest";
import { buildViralSampleArticles, buildViralSampleJson } from "./viral-sample-data";

describe("viral-sample-data", () => {
  it("S1 三个标题 → 三篇示例文章，字段齐全且数值/平台按位循环", () => {
    const articles = buildViralSampleArticles("A|B|C");
    expect(articles).toHaveLength(3);
    expect(articles[0]).toEqual({ title: "A", like_count: 12800, comment_count: 960, platform_code: "xiaohongshu" });
    expect(articles[2]).toEqual({ title: "C", like_count: 23500, comment_count: 1780, platform_code: "douyin" });
  });

  it("S2 超过 3 个标题时点赞/评论/平台按下标取模循环，不越界", () => {
    const articles = buildViralSampleArticles("A|B|C|D");
    expect(articles).toHaveLength(4);
    expect(articles[3].like_count).toBe(12800);
    expect(articles[3].platform_code).toBe("xiaohongshu");
  });

  it("S3 空/非法输入 fail-safe：返回空数组与空串（不抛错）", () => {
    for (const raw of ["", "   ", "|", "||", null, undefined, 0, {}, []]) {
      expect(buildViralSampleArticles(raw)).toEqual([]);
      expect(buildViralSampleJson(raw)).toBe("");
    }
  });

  it("S4 标题两端空白被裁剪，空段被丢弃", () => {
    const articles = buildViralSampleArticles("  标题一  | |标题二");
    expect(articles.map(a => a.title)).toEqual(["标题一", "标题二"]);
  });

  it("S5 JSON 可被消费端原样解析（与 buildViralSampleArticles 同源，字段名符合 IPC 合同）", () => {
    const json = buildViralSampleJson("A|B|C");
    expect(json).toBe(JSON.stringify(buildViralSampleArticles("A|B|C"), null, 2));
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(Object.keys(parsed[0]).sort()).toEqual(["comment_count", "like_count", "platform_code", "title"]);
  });

  it("S6 真实 locale 文案可直接产出示例（防止 locale 改动静默打断示例能力）", async () => {
    const { default: zh } = await import("@/locales/zh");
    const json = buildViralSampleJson(zh.viralAnalysis.manualDataSampleTitles);
    const parsed = JSON.parse(json);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    expect(parsed.every(a => a.title && a.title !== zh.viralAnalysis.manualDataSampleTitles)).toBe(true);
  });
});
