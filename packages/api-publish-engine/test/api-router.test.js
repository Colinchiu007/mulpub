/**
 * API Router TDD ? has_api auto-routing + RPA fallback
 */
const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");

var CONFIG_PATH = path.resolve(__dirname, "..", "..", "..", "config", "platforms.yaml");

describe("API Router", function() {
  var router;
  var platforms;

  beforeAll(function() {
    var raw = fs.readFileSync(CONFIG_PATH, "utf8");
    platforms = yaml.load(raw).platforms;
    router = require("../src/api-router");
  });

  describe("routeDecision", function() {
    test("has_api:true returns api mode", function() {
      Object.keys(platforms).forEach(function(key) {
        if (platforms[key].has_api) {
          expect(router.shouldUseApi(key)).toBe(true);
        }
      });
    });

    test("has_api:false returns rpa mode", function() {
      Object.keys(platforms).forEach(function(key) {
        if (!platforms[key].has_api) {
          expect(router.shouldUseApi(key)).toBe(false);
        }
      });
    });

    test("supportsApi for all API platforms", function() {
      expect(router.supportsApi("youtube")).toBe(true);
      expect(router.supportsApi("tiktok")).toBe(true);
      expect(router.supportsApi("twitter")).toBe(true);
      expect(router.supportsApi("weibo")).toBe(true);
      expect(router.supportsApi("douyin")).toBe(true);
      expect(router.supportsApi("bilibili")).toBe(true);
    });

    test("unknown platform returns false", function() {
      expect(router.shouldUseApi("nonexistent")).toBe(false);
    });
  });

  describe("listApiPlatforms", function() {
    test("returns exactly the config platforms with has_api enabled", function() {
      // 单一事实来源：期望集合直接由 platforms.yaml 的 has_api 推导，
      // 不硬编码平台名/魔法数量。sync-platform-config 等重写 has_api 后，
      // 本测试仍校验 listApiPlatforms 精确反映配置，不会陈旧漂移。
      var expected = Object.keys(platforms)
        .filter(function(k) { return platforms[k].has_api; })
        .sort();
      var apiPlatforms = router.listApiPlatforms().slice().sort();
      expect(apiPlatforms).toEqual(expected);
      // 非空守卫：防止 has_api 被整体清空时出现「空对空」假绿
      expect(apiPlatforms.length).toBeGreaterThan(0);
      // 锚点：youtube 长期为稳定的 API 模式平台
      expect(apiPlatforms).toContain("youtube");
    });

    test("every listed platform passes shouldUseApi", function() {
      // listApiPlatforms 与 shouldUseApi 必须同源一致，防止两处读取逻辑分叉
      router.listApiPlatforms().forEach(function(p) {
        expect(router.shouldUseApi(p)).toBe(true);
      });
    });
  });
});
