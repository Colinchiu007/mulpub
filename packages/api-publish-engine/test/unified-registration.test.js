const assert = require("assert");
const test = require("node:test");

const { BasePlatformAdapter } = require("../src/base-adapter");
const { errorCode, getMsg, isSuccess } = require("../src/error-codes");
const index = require("../src/index");
const router = require("../src/api-router");
const platformConfigs = require("../src/adapters/platform-configs");

test("自定义适配器仍由 REGISTRY 注册", function() {
  assert.strictEqual(typeof index.REGISTRY.zhihu, "function");
  assert.strictEqual(typeof index.REGISTRY.youtube, "function");
});

test("配置化平台可通过统一入口创建并被识别", function() {
  Object.keys(platformConfigs).forEach(function(platform) {
    var adapter = index.getAdapter(platform);
    assert(adapter, "缺少配置化适配器：" + platform);
    assert.strictEqual(adapter.name, platform);
    assert.strictEqual(index.supportsApi(platform), true, "未识别配置化平台：" + platform);
  });
});

test("未知平台不会被识别为 API 平台", function() {
  ["nonexistent", "toString", "__proto__"].forEach(function(platform) {
    assert.strictEqual(index.getAdapter(platform), null);
    assert.strictEqual(index.supportsApi(platform), false);
  });
});

test("api-router 从 platforms.yaml 读取 **走 API 轨**的平台（两轴合取）", function() {
  var listed = router.listApiPlatforms();
  assert(Array.isArray(listed));
  // ★ 2026-10-16 更新（p3-residual-criteria，CCG 深度评审 i1 upheld 后修复）：
  //   原口径是「所有 has_api:true 的平台」。但「未入波」平台
  //   （has_api:true + publishMode:dom-only，如 youtube/twitter）有 API 实现却
  //   当前不走 API 轨，旧口径会把它们**过报**成 API 平台——与 rpa-view-manager.js:68
  //   记载的误入 API 轨事故同款。
  //   ★ CCG 第三轮 i5（upheld）：期望集合改为直接由**导出的单一来源**
  //     `router.isApiTrack` 推导，不再在本文件重写三元式（原先 4 处各写一遍必漂移）。
  var cfg = router.loadConfig();
  var expected = Object.keys(cfg).filter(function(k) { return router.isApiTrack(cfg[k]); }).sort();
  assert.deepStrictEqual(listed.slice().sort(), expected, "listApiPlatforms 应精确反映两轴合取");
  assert(listed.length > 0, "API 轨平台集合不应为空（防空对空假绿）");
  // 反向锚点：未入波平台不得混进来
  assert(!listed.includes("youtube"), "youtube 是 dom-only（未入波），不应列为 API 平台");
  assert(!listed.includes("twitter"), "twitter 是 dom-only（未入波），不应列为 API 平台");
});

test("api-router 同时识别自定义和配置化适配器", function() {
  // ★ 2026-10-16 更新：supportsApi 也改为两轴合取 ⇒ youtube（dom-only）不再算 API 平台。
  assert.strictEqual(router.supportsApi("bilibili"), true);
  assert.strictEqual(router.supportsApi("douyin"), true);
  assert.strictEqual(router.supportsApi("youtube"), false);
  assert.strictEqual(router.supportsApi("nonexistent"), false);
});

test("base-adapter 将发布异常转换为标准失败结果", async function() {
  var TestAdapter = class extends BasePlatformAdapter {
    constructor() { super("test"); }
    getReferer() { return "https://test.com"; }
    async uploadVideo() { return null; }
    async uploadCover() { return null; }
    buildPostData() { return {}; }
    async publish() { throw new Error("Network error"); }
  };
  var result = await new TestAdapter().execute({}, "cookie");
  assert.strictEqual(result.success, false);
  assert.strictEqual(typeof result.error, "string");
  assert.strictEqual(result.platform, "test");
});

test("错误码模块导出完整且可判定成功", function() {
  assert.strictEqual(errorCode.success, 0);
  assert.strictEqual(errorCode.request_error, -1);
  assert.strictEqual(errorCode.data_error, -2);
  assert.strictEqual(errorCode.unknown_error, -3);
  Object.keys(errorCode).forEach(function(key) {
    assert.strictEqual(typeof getMsg(errorCode[key]), "string");
  });
  assert.strictEqual(isSuccess({ code: 0, success: true }), true);
  assert.strictEqual(isSuccess({ code: 0, success: false }), true);
  assert.strictEqual(isSuccess({}), false);
});
