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

test("api-router 从 platforms.yaml 读取 has_api 平台", function() {
  var listed = router.listApiPlatforms();
  assert(Array.isArray(listed));
  // 期望集合直接由 platforms.yaml 的 has_api 推导，不硬编码具体平台名，
  // 避免 sync-platform-config 重写 has_api 后本测试陈旧漂移。
  var cfg = router.loadConfig();
  var expected = Object.keys(cfg).filter(function(k) { return cfg[k].has_api; }).sort();
  assert.deepStrictEqual(listed.slice().sort(), expected, "listApiPlatforms 应精确反映 platforms.yaml 的 has_api");
  assert(listed.length > 0, "has_api 平台集合不应为空（防空对空假绿）");
});

test("api-router 同时识别自定义和配置化适配器", function() {
  assert.strictEqual(router.supportsApi("youtube"), true);
  assert.strictEqual(router.supportsApi("bilibili"), true);
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
