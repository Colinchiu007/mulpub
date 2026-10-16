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
      // ★ CCG 第五轮 i5（upheld）：期望值直接来自导出的单一来源 `router.isApiTrack`，
      //   不再本地复写「缺省派生 + 合取」（那正是 i4 指出的第二/第三份实现）。
      Object.keys(platforms).forEach(function(key) {
        expect(router.shouldUseApi(key)).toBe(router.isApiTrack(platforms[key]));
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
      // ★ CCG 第五轮 i5（upheld）：期望集合直接由**导出的单一来源** `router.isApiTrack`
      //   推导，不再在本文件重写一遍「缺省派生 + 合取」。
      var expected = Object.keys(platforms)
        .filter(function(k) { return router.isApiTrack(platforms[k]); })
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
      // ★ CCG 第四轮 i4（upheld）：原判据按**单行**匹配，而自写合取完全可以拆成两行
      //   （能力轴一行 + 换行 `&& (轨道轴比较)`）从而逃逸——实测踩到。
      //   改为**窗口匹配**：含轨道轴比较的非注释行，若其前后 3 行内出现能力轴引用，
      //   即判为自写合取（覆盖同行与跨行两种形态）。
      //
      // ⚠️ 自指陷阱（已踩两次）：本扫描读**自己这个文件**，故下面构造正则的片段
      //   一律用字符串拼接，不让源码里出现可被匹配的完整模式。
      var AXIS_CAP = "has" + "_api";                 // 能力轴字段名（拼接，防自匹配）
      var AXIS_TRK = "publish" + "Mode";             // 轨道轴字段名（拼接，防自匹配）
      var cmpRe = new RegExp(AXIS_TRK + "\\s*(===|!==)");
      var capRe = new RegExp(AXIS_CAP);
      var codeLines = self.split("\n").filter(function(l) { return !/^\s*\/\//.test(l); });
      var offenders = [];
      codeLines.forEach(function(l, i) {
        if (!cmpRe.test(l)) return;
        // 合取推导的两种形态，都要求能力轴与轨道轴属于**同一个布尔表达式**：
        //   ① 同一行；
        //   ② 续行拆分 —— 下一行以 `&&` / `||` 开头，或本行以它们结尾（跨行连接的同一表达式）。
        // ⚠️ 不能用「前后 N 行窗口」：那会把**合法的按轨道值筛平台**（同行无能力轴、
        //    只是恰好靠近一段提到能力轴的代码）误报为合取推导（第五轮实测误报一次）。
        var sameExpr = capRe.test(l)
          || /(\|\||&&)\s*$/.test(l)
          || /^\s*(\|\||&&)/.test(codeLines[i + 1] || '')
          || /(\|\||&&)\s*$/.test(codeLines[i - 1] || '');
        if (!sameExpr) return;
        if (!capRe.test(l)) {
          // 续行形态：在紧邻的连接行里找能力轴
          var near = [codeLines[i - 1] || '', codeLines[i + 1] || ''].join("\n");
          if (!capRe.test(near)) return;
        }
        offenders.push("L" + (i + 1) + ": " + l.trim());
      });
      expect(offenders.length,
        "本文件不得自写两轴合取推导（含跨行拆分；请改用 router.isApiTrack()），命中: " + offenders.join(" || "))
        .toBe(0);
      // 单一来源必须真的可用（防「删了自写、也没了来源」的空转）
      expect(typeof router.isApiTrack).toBe("function");
      expect(router.isApiTrack(platforms.douyin)).toBe(true);
      expect(router.isApiTrack(platforms.youtube)).toBe(false);
    });
  });
});
