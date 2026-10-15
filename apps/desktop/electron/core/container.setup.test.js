// container.setup 加载所有服务模块，多数 require electron + fs + path
__enableElectronMock()

// 夹具只对**本测试的沙箱目录**谎报文件系统，沙箱外一律委托真实 fs（#2794 同族收敛，形状同
// apps/desktop/electron/services/asset-generator.test.js）。
// 为什么这个文件必须有牙齿：它 require 全部服务模块，其中 store → sqlite-wrapper → sql.js 会
// 用 fs.readFileSync 读 .wasm —— 一律返回 "[]" 的谎报正是 BF-TEST-01 那次
// `WebAssembly.instantiate(): BufferSource argument is empty` 崩溃的成因（下面对 sql.js 的
// mock 是同一根因的第二处规避）。同一 realm 里 node_modules/electron/index.js 也会被真实执行（实测与
// vitest.config.js 的 deps.inline:['electron'] 无关，摘掉它 banner 照样出现，见 docs/deps-inline-electron-evaluation.md），
// existsSync()=>false 会让它以为二进制没备好并当场 spawn install.js。
// 判定按**路径段**比：裸 startsWith 会把 <沙箱>-evil 判进沙箱，对真实存在的目录持续谎报"不存在"。
const nodeOs = require('node:os')
const nodePath = require('node:path')
const realFs = require('node:fs')
const CONTAINER_SANDBOX = nodePath.join(nodeOs.tmpdir(), 'multi-publish-container-setup-' + process.pid)
const isSandboxPath = (target) => {
  const normalized = String(target).replace(/\\/g, '/')
  const sandbox = CONTAINER_SANDBOX.replace(/\\/g, '/')
  return normalized === sandbox || normalized.startsWith(sandbox + '/')
}
// 只委托"读"。写类动词继续全部空转：夹具不得因为"委托"而把东西真的写到磁盘上。
__registerMock("fs", {
  existsSync: vi.fn((target) => (isSandboxPath(target) ? false : realFs.existsSync(target))),
  readFileSync: vi.fn((target, ...rest) => (isSandboxPath(target) ? '' : realFs.readFileSync(target, ...rest))),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn((target, ...rest) => (isSandboxPath(target) ? [] : realFs.readdirSync(target, ...rest))),
  statSync: vi.fn((target, ...rest) => (isSandboxPath(target) ? { size: 0, mtime: new Date() } : realFs.statSync(target, ...rest))),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(),
  createReadStream: vi.fn((target, ...rest) => (isSandboxPath(target) ? { on: vi.fn() } : realFs.createReadStream(target, ...rest))),
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
    const ENV_KEYS = [
      'MP_PUBLISH_MIN_INTERVAL_MS', 'MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS',
      'MP_PUBLISH_DAILY_MAX_LONG', 'MP_PUBLISH_DAILY_MAX_CLIP', 'MP_PUBLISH_DAILY_MAX_SHORT',
      'MP_PUBLISH_ACCOUNT_DAILY_MAX',
    ];
    const saved = ENV_KEYS.map(function (k) { return process.env[k]; });
    ENV_KEYS.forEach(function (k) { delete process.env[k]; });
    try {
      var guard = createContainer().get('publishIntervalGuard');

      // v3 数值：weibo 属短内容高频容忍档；未登记平台回落最严基线。
      // tier 也在返回形状里（QM-6 前端轴 C2：设置页「当前档位」按它分组，缺键会渲染成 undefined）
      expect(guard._intervals('weibo')).toEqual({
        tier: 'short', accountMinMs: 1 * 60 * 1000, platformMinMs: 1 * 60 * 1000, accountDailyMax: 200,
      });
      expect(guard._intervals('wechat_mp')).toEqual({
        tier: 'long', accountMinMs: 5 * 60 * 1000, platformMinMs: 3 * 60 * 1000, accountDailyMax: 30,
      });
      var unknown = guard._intervals('not_a_registered_platform');
      expect(unknown.tier).toBe('long');
      // 回落必须"不弱于任何已登记平台"：与最**严**的那档比，而不是与最短的那档（weibo=1′）比 ——
      // 后者在 v3 下 5′>=1′ 恒过，挡不住"把基线调得比 long 档还松"（QM-6 B7/B17）。
      expect(unknown.accountMinMs).toBeGreaterThanOrEqual(guard._intervals('wechat_mp').accountMinMs);
      expect(unknown.accountDailyMax).toBeLessThanOrEqual(guard._intervals('wechat_mp').accountDailyMax);
    } finally {
      ENV_KEYS.forEach(function (k, i) {
        if (saved[i] !== undefined) process.env[k] = saved[i];
      });
    }
  });

  // ── v2 装配锁（openspec/changes/publish-frequency-policy-v2）───────────────────
  // 事故形态同上一组：日配额逻辑在守卫里实现且有单测，但生产装配漏注入 dailyStore
  // ⇒ check() 恒返回 daily:null ⇒ 配额维度在运行时完全不存在（静默失效）。
  test('装配锁 v2：dailyStore 三个方法必须注入（否则日配额静默失效）', () => {
    const guard = createContainer().get('publishIntervalGuard');
    expect(guard._dailyStore).toBeTruthy();
    expect(typeof guard._dailyStore.getDay).toBe('function');
    expect(typeof guard._dailyStore.incrDay).toBe('function');
    expect(typeof guard._dailyStore.decrDay).toBe('function');
  });

  test('装配锁 v2：抖动比例与回滚退避已从策略模块注入（不得回退成硬编码）', () => {
    const guard = createContainer().get('publishIntervalGuard');
    expect(typeof guard.jitterRatio).toBe('number');
    expect(guard.jitterRatio).toBeGreaterThanOrEqual(0);
    expect(guard.jitterRatio).toBeLessThan(1);
    expect(guard.releaseGraceMs).toBeGreaterThanOrEqual(10000);
  });

  test('装配锁 v2 行为锁：日配额用尽时 check() 必须给出 bucket=daily（不只是「注入了」）', () => {
    // 这里刻意**打桩 store 的方法**而不是写真实库：装配锁要证明的是
    // 「guard → dailyStore 适配器 → store 方法」这条链路真的接通了。
    // 依赖真实 DB 会让断言变成「DB 是否 init 过」，与装配正确性无关。
    const c = createContainer();
    const guard = c.get('publishIntervalGuard');
    const store = c.get('store');
    const max = guard._intervals('douyin').accountDailyMax;
    expect(max).toBeGreaterThan(0);

    const savedGet = store.getPublishDailyCount;
    store.getPublishDailyCount = function () { return { count: max, rollback_count: 0 } };
    try {
      const verdict = guard.check('douyin', 'acc-lock');
      expect(verdict.allowed).toBe(false);
      expect(verdict.bucket).toBe('daily');
      expect(verdict.reason).toBe('daily_quota');
      expect(verdict.remainingMs).toBe(0);
      expect(verdict.daily).toMatchObject({ used: max, max });
    } finally {
      store.getPublishDailyCount = savedGet;
    }

    // 反向：配额未达上限时必须放行（证明不是「永远报 daily」的假锁）
    const savedGet2 = store.getPublishDailyCount;
    store.getPublishDailyCount = function () { return { count: 0, rollback_count: 0 } };
    try {
      expect(guard.check('douyin', 'acc-lock').bucket).not.toBe('daily');
    } finally {
      store.getPublishDailyCount = savedGet2;
    }
  });

  test('assertRequired passes', () => {
    expect(() => createContainer()).not.toThrow();
  });
});
