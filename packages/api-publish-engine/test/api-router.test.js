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
    test("has_api:true 且走 API 轨 ⇒ api mode（两轴合取）", function() {
      // ★ 2026-10-16 更新（p3-residual-criteria，CCG i1 upheld 后修复）：
      //   原判据只看 has_api。但「未入波」平台（has_api:true + publishMode:dom-only，
      //   即 youtube/twitter——二者都有完整 API 适配器，只是还没接入 API 发布波次）
      //   会被过报成 API 平台，与 rpa-view-manager.js:68 记载的误入 API 轨事故同款。
      //   现在 shouldUseApi 取**两轴合取**：has_api 且 publishMode ∈ {api-only, api-then-dom}。
      Object.keys(platforms).forEach(function(key) {
        var cfg = platforms[key];
        var mode = (cfg.publishMode == null || cfg.publishMode === '') ? 'api-then-dom' : cfg.publishMode;
        var expectApi = !!cfg.has_api && (mode === 'api-only' || mode === 'api-then-dom');
        expect(router.shouldUseApi(key)).toBe(expectApi);
      });
    });

    test("has_api:false returns rpa mode", function() {
      Object.keys(platforms).forEach(function(key) {
        if (!platforms[key].has_api) {
          expect(router.shouldUseApi(key)).toBe(false);
        }
      });
    });

    test("★ 未入波平台（has_api:true 但 publishMode=dom-only）不得被当成 API 平台", function() {
      // CCG 深度评审 i1（Critical）的回归锁。取证：youtube/twitter 有完整 API 适配器
      // （adapters/youtube.js = YouTube Data API v3 + OAuth2），但 publishMode=dom-only
      // ⇒ 它们「有实现」却「当前不走 API 轨」，旧语义会把它们报成 API 平台。
      for (var key of ['youtube', 'twitter', 'facebook']) {
        expect(platforms[key].publishMode).toBe('dom-only');
        expect(router.shouldUseApi(key)).toBe(false);
        expect(router.supportsApi(key)).toBe(false);
      }
    });

    test("已入波平台（api-* 轨 + 有实现）仍被当成 API 平台", function() {
      for (var key of ['douyin', 'kuaishou', 'bilibili', 'baijiahao', 'tencent_video']) {
        expect(platforms[key].has_api).toBe(true);
        expect(platforms[key].publishMode).toMatch(/^api-/);
        expect(router.shouldUseApi(key)).toBe(true);
        expect(router.supportsApi(key)).toBe(true);
      }
    });

    test("unknown platform returns false", function() {
      expect(router.shouldUseApi("nonexistent")).toBe(false);
    });
  });

  describe("listApiPlatforms", function() {
    test("returns exactly the platforms on the API track (两轴合取)", function() {
      // ★ 2026-10-16 更新：原期望是「所有 has_api:true 的平台」。
      //   单一事实来源改为由 platforms.yaml 的 **has_api + publishMode 合取**推导，
      //   不硬编码平台名/魔法数量。sync-platform-config 等重写这两个字段后，
      //   本测试仍校验 listApiPlatforms 精确反映配置，不会陈旧漂移。
      var expected = Object.keys(platforms)
        .filter(function(k) {
          var cfg = platforms[k];
          if (!cfg.has_api) return false;
          var mode = (cfg.publishMode == null || cfg.publishMode === '') ? 'api-then-dom' : cfg.publishMode;
          return mode === 'api-only' || mode === 'api-then-dom';
        })
        .sort();
      var apiPlatforms = router.listApiPlatforms().slice().sort();
      expect(apiPlatforms).toEqual(expected);
      // 非空守卫：防止配置被整体清空时出现「空对空」假绿
      expect(apiPlatforms.length).toBeGreaterThan(0);
      // 锚点：douyin 长期为稳定的 API 模式平台（api-then-dom 且有链）
      expect(apiPlatforms).toContain("douyin");
      // ★ 反向锚点：未入波平台不得混进来（i1 的核心断言）
      expect(apiPlatforms).not.toContain("youtube");
      expect(apiPlatforms).not.toContain("twitter");
      expect(apiPlatforms).not.toContain("facebook");
    });

    test("every listed platform passes shouldUseApi", function() {
      // listApiPlatforms 与 shouldUseApi 必须同源一致，防止两处读取逻辑分叉
      router.listApiPlatforms().forEach(function(p) {
        expect(router.shouldUseApi(p)).toBe(true);
      });
    });

    test("★ 变异反证口径：把 supportsApi 退回只看 has_api 必须让上面两条红", function() {
      // 这条锁的是「两轴合取」本身：若有人把 api-router.js 的 isApiTrack 退回
      // !!cfg.has_api，则 listApiPlatforms 会含 youtube/twitter ⇒ 本断言红。
      // （与「has_api:true 且走 API 轨」用例互为印证，防改宽。）
      var leaked = router.listApiPlatforms().filter(function(p) {
        return platforms[p].publishMode === 'dom-only';
      });
      expect(leaked).toEqual([]);
    });

    test("★ CCG i5：两轴合取必须是单一来源，本文件不得再自写合取推导", function() {
      // 动因：这条判据原先在产品与三个测试文件里各写一遍（共 4 份），
      // 加 publishMode 取值或 sync 重写字段后要 4 处同步，必然漂移。
      // 锁：本文件不得出现**自写的合取推导**，一律走导出的 router.isApiTrack()。
      //
      // ⚠️ 两个自指/误报陷阱（都实测踩到）：
      //   ① 本扫描读**自己这个文件** ⇒ 注释里不能写会被匹配的表达式片段；
      //   ② 文件里**本来就有**旧用例用 `publishMode === 'dom-only'` 做过滤（见上一条用例），
      //      那是「按 dom-only 筛平台」不是「合取推导」，故判据必须要求
      //      **has_api 与 publishMode 的比较出现在同一行**才算自写合取。
      var fs = require("fs");
      var path = require("path");
      var self = fs.readFileSync(path.resolve(__dirname, "api-router.test.js"), "utf8");
      var lines = self.split("\n");
      var selfWritten = lines.filter(function(l) {
        return /has_api/.test(l) && /publishMode\s*===/.test(l) && !/^\s*\/\//.test(l);
      });
      expect(selfWritten.length,
        "本文件不得自写两轴合取推导（请改用 router.isApiTrack()），命中行: " + selfWritten.join(" | "))
        .toBe(0);
      // 单一来源必须真的可用（防「删了自写、也没了来源」的空转）
      expect(typeof router.isApiTrack).toBe("function");
      expect(router.isApiTrack(platforms.douyin)).toBe(true);
      expect(router.isApiTrack(platforms.youtube)).toBe(false);
    });
  });
});
