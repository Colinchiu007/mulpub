// container.setup 加载所有服务模块，多数 require electron + fs + path
__enableElectronMock()

__registerMock("fs", {
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue("[]"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ size: 0, mtime: new Date() }),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(),
  createReadStream: vi.fn(),
})

__registerMock("path", {
  join: vi.fn(function() { return "/mock/path"; }),
  dirname: vi.fn(function(p) { return p; }),
  basename: vi.fn(function(p) { return p; }),
  resolve: vi.fn(function() { return "/mock/resolved"; }),
  extname: vi.fn(function() { return ""; }),
})

// api-publish-engine/src/api-router.js require './logger' 缺失，mock 整个包规避
__registerMock("@multi-publish/api-publish-engine", {
  supportsApi: vi.fn().mockReturnValue(false),
  publishViaApi: vi.fn(),
})

// ── BF-TEST-01 修复 ──────────────────────────────
// Bug: sql.js WebAssembly 在测试环境中加载失败
//   RuntimeError: Aborted(CompileError: WebAssembly.instantiate(): BufferSource argument is empty)
//
// 根因链：
//   container.setup.test.js → require('./container.setup')
//     → require('../services/store') → require('./sqlite-wrapper')
//       → require('sql.js') → initSqlJs() → 读取 .wasm 二进制
//         → fs.readFileSync 被 mock 返回 "[]"（字符串而非 Buffer）
//           → WebAssembly.instantiate(empty) → 崩溃
//
// 修复：在 require container.setup 之前，先 mock 掉 sql.js 模块，
//       让 sqlite-wrapper.js 拿到一个安全的 mock 对象（含 .Database 构造器）。
const mockSqlDatabase = {
  run: vi.fn(),
  exec: vi.fn(),
  prepare: vi.fn().mockReturnValue({
    run: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    all: vi.fn().mockReturnValue([]),
    bind: vi.fn().mockReturnThis(),
  }),
  close: vi.fn(),
}

__registerMock("sql.js", {
  __esModule: true,
  default: vi.fn().mockResolvedValue({ Database: vi.fn().mockReturnValue(mockSqlDatabase) }),
})
// ────────────────────────────────────────────────

const { createContainer } = require('./container.setup');

describe('Container setup', () => {
  test('creates container with all services', () => {
    var c = createContainer();
    expect(c.get('store')).toBeDefined();
    expect(c.get('authViewManager')).toBeDefined();
    expect(c.get('rpaViewManager')).toBeDefined();
    expect(c.get('taskQueue')).toBeDefined();
  });

  test('lazy initialization works', () => {
    var c = createContainer();
    var svc = c.get('rpaViewManager');
    expect(svc).toBeDefined();
    expect(c.get('rpaViewManager')).toBe(svc);
  });

  test('wires QR code login into the virtual login tab lifecycle', () => {
    var c = createContainer();
    var webviewManager = c.get('webviewManager');
    var qrCodeLogin = c.get('qrCodeLogin');

    expect(webviewManager._qrCodeLogin).toBe(qrCodeLogin);
    expect(typeof qrCodeLogin.onOpened).toBe('function');
    expect(typeof qrCodeLogin.onClosed).toBe('function');
  });

  test('dependency injection works', () => {
    var c = createContainer();
    var ci = c.get('contentIntelligence');
    expect(ci).toBeDefined();
    var track = c.get('publishImpactTracker');
    expect(track).toBeDefined();
  });

  // ── 发布频率控制装配锁（openspec/changes/publish-frequency-control）──────────
  // 事故形态：PublishIntervalGuard 注册在容器里、TaskQueue 支持注入、两侧 60+ 条单测全绿，
  // 但生产装配漏了注入 ⇒ _publishIntervalGuard 恒 null ⇒ 发布频率控制在运行时完全不存在
  // （实测 publish_timeline 表 0 行）。以下三条锁必须打在**真实装配路径**上，
  // 在测试里手工 new guard 再注入不构成回归保护。

  test('装配锁：publishIntervalGuard 必须注入 taskQueue', () => {
    var c = createContainer();
    var queue = c.get('taskQueue');
    var guard = c.get('publishIntervalGuard');

    expect(guard).toBeTruthy();
    expect(queue._publishIntervalGuard).toBe(guard);
  });

  test('装配锁：options.taskQueue 不得把守卫覆盖成 undefined（静默关掉门禁）', () => {
    var c = createContainer({
      taskQueue: { maxConcurrent: 1, publishIntervalGuard: null },
    });

    expect(c.get('taskQueue')._publishIntervalGuard).toBe(c.get('publishIntervalGuard'));
    expect(c.get('taskQueue').maxConcurrent).toBe(1);
  });

  test('装配锁：守卫的间隔按平台策略解析，不得回退成硬编码单一值', () => {
    // 策略模块读 process.env，开发机若恰好设了覆盖值会让精确断言假红 —— 测试自己钉住档位。
    const ENV_KEYS = ['MP_PUBLISH_MIN_INTERVAL_MS', 'MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS'];
    const saved = ENV_KEYS.map(function (k) { return process.env[k]; });
    ENV_KEYS.forEach(function (k) { delete process.env[k]; });
    try {
      var guard = createContainer().get('publishIntervalGuard');

      // weibo 属短内容高频容忍档；未登记平台回落最严基线
      expect(guard._intervals('weibo')).toEqual({
        accountMinMs: 10 * 60 * 1000, platformMinMs: 60 * 1000,
      });
      expect(guard._intervals('wechat_mp')).toEqual({
        accountMinMs: 60 * 60 * 1000, platformMinMs: 5 * 60 * 1000,
      });
      expect(guard._intervals('not_a_registered_platform').accountMinMs)
        .toBeGreaterThanOrEqual(guard._intervals('weibo').accountMinMs);
    } finally {
      ENV_KEYS.forEach(function (k, i) {
        if (saved[i] !== undefined) process.env[k] = saved[i];
      });
    }
  });

  test('assertRequired passes', () => {
    expect(() => createContainer()).not.toThrow();
  });
});
