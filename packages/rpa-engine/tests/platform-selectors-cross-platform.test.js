/**
 * platform-selectors-cross-platform.test.js
 * V1.1: Cross-platform selector consistency checks
 * Runs independently from platform-selectors.test.js
 */
const selectors = require("../src/platform-selectors");
const EXPECTED = [
  "wechat_mp","zhihu","weibo","douyin","xiaohongshu",
  "tencent_video","kuaishou","toutiao","youtube","tiktok",
  "bilibili","baijiahao","twitter","instagram","facebook",
];
const VIDEO = ["douyin","tencent_video","kuaishou","youtube","tiktok","facebook","bilibili"];
// bilibili 走 API 优先，但 RPA 兜底同样需要 file_input（2026-09 E2E 实证：
// API 失败回退 RPA 时因缺 file_input 直接跳过上传，导致后续字段全部 timeout）
const ARTICLE = ["wechat_mp","zhihu","weibo","xiaohongshu","toutiao","baijiahao"];
const SOCIAL = ["twitter","instagram"];

describe("V1.1 Platform Verification - Cross-platform Consistency", () => {
  // All platforms must appear in every config
  test.each(EXPECTED)("%s has all configs", (p) => {
    expect(selectors.PLATFORM_LOGIN_URLS[p]).toContain("https://");
    expect(selectors.PLATFORM_LOGIN_SUCCESS_SELECTORS[p]).toBeDefined();
    expect(selectors.PLATFORM_PUBLISH_SELECTORS[p]).toBeDefined();
    expect(selectors.PLATFORM_NAMES[p]).toBeDefined();
  });

  // Video platforms (except bilibili API) must have file_input
  for (const p of VIDEO) {
    test(p + " (video) has file_input", () => {
      expect(selectors.PLATFORM_PUBLISH_SELECTORS[p].file_input).toBeDefined();
      expect(selectors.PLATFORM_PUBLISH_SELECTORS[p].file_input.length).toBeGreaterThan(0);
    });
  }

  // All platforms must have publish_btn
  for (const p of EXPECTED) {
    test(p + " has publish_btn", () => {
      expect(selectors.PLATFORM_PUBLISH_SELECTORS[p].publish_btn).toBeDefined();
      expect(selectors.PLATFORM_PUBLISH_SELECTORS[p].publish_btn.length).toBeGreaterThan(0);
    });
  }

  // Only documented optional controls may be empty. Baijiahao video V2 has no
  // independent tag input; all other configured controls are required.
  for (const p of EXPECTED) {
    test(p + " has no unexpected empty selector arrays", () => {
      const allowedEmptyFields = p === "baijiahao" ? new Set(["tag_input"]) : new Set();
      for (const [field, v] of Object.entries(selectors.PLATFORM_PUBLISH_SELECTORS[p])) {
        expect(Array.isArray(v)).toBe(true);
        if (allowedEmptyFields.has(field)) {
          expect(v).toEqual([]);
          continue;
        }
        expect(v.length).toBeGreaterThan(0);
        expect(v.every((selector) => typeof selector === "string" && selector.length > 0)).toBe(true);
      }
    });
  }

  // bilibili RPA 兜底契约：上传落地页需 file_input，投稿按钮文本为「立即投稿」
  test("bilibili RPA fallback selector contract", () => {
    const sel = selectors.PLATFORM_PUBLISH_SELECTORS.bilibili;
    expect(sel.file_input).toContain('input[type="file"]');
    expect(sel.publish_btn.join('|')).toContain('立即投稿');
  });

  test("baijiahao V2 selector contract", () => {
    const sel = selectors.PLATFORM_PUBLISH_SELECTORS.baijiahao;
    expect(sel.tag_input).toEqual([]);
    for (const field of [
      "write_btn",
      "file_input",
      "editor",
      "desc_textarea",
      "cover_input",
      "cover_trigger",
      "publish_btn",
    ]) {
      expect(Array.isArray(sel[field])).toBe(true);
      expect(sel[field].length).toBeGreaterThan(0);
      expect(sel[field].every((value) => typeof value === "string" && value.length > 0)).toBe(true);
    }
  });

  // All selectors are strings
  test("all selectors are non-empty strings", () => {
    for (const [, f] of Object.entries(selectors.PLATFORM_PUBLISH_SELECTORS)) {
      for (const [, sels] of Object.entries(f)) {
        for (const s of sels) {
          expect(typeof s).toBe("string");
          expect(s.length).toBeGreaterThan(0);
        }
      }
    }
  });

  // Login URLs are valid
  test.each(EXPECTED)("%s has valid login URL", (p) => {
    expect(selectors.PLATFORM_LOGIN_URLS[p]).toMatch(/^https:\/\//);
  });

  // Login success selectors - bilibili is API mode
  test("bilibili login selectors empty (API mode)", () => {
    expect(selectors.PLATFORM_LOGIN_SUCCESS_SELECTORS.bilibili).toEqual([]);
  });
  for (const p of EXPECTED.filter((x) => x !== "bilibili")) {
    test(p + " has non-empty login success selectors", () => {
      expect(selectors.PLATFORM_LOGIN_SUCCESS_SELECTORS[p].length).toBeGreaterThan(0);
    });
  }
});
