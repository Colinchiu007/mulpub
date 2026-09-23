/**
 * publish-governance.test.js — 频控 + 双轨路由决策（W1 §5.3 / §5.1-5.2，vitest 组）
 */
const { createPublishSpacer, DEFAULT_MIN_INTERVAL_MS } = require("../src/publish/core/publish-spacer");
const { decideRoute, normalizeMode, MODES, ROUTES } = require("../src/publish/core/publish-mode");

describe("publish-spacer 18 分钟最小间隔（虚拟时钟）", function () {
  const MIN = 18 * 60 * 1000;

  test("默认阈值 18 分钟", function () {
    expect(DEFAULT_MIN_INTERVAL_MS).toBe(MIN);
  });

  test("首次发布放行并记录", function () {
    let now = 0;
    const sp = createPublishSpacer({ clock: () => now });
    const r = sp.tryAcquire("shipinhao", "acct-1");
    expect(r.allow).toBe(true);
    expect(sp.allow("shipinhao", "acct-1").allow).toBe(false); // 刚记 → 立即再发被拒
  });

  test("边界：17:59 拒、18:00 放（临界取等号放行）", function () {
    let now = 1_000_000;
    const sp = createPublishSpacer({ clock: () => now });
    sp.record("bilibili", "acct-9");
    now += MIN - 60 * 1000; // +17:00 → 不足
    expect(sp.allow("bilibili", "acct-9").allow).toBe(false);
    now += 59 * 1000; // 累计 17:59 → 仍不足
    const d1759 = sp.allow("bilibili", "acct-9");
    expect(d1759.allow).toBe(false);
    expect(d1759.waitMs).toBe(MIN - (17 * 60 + 59) * 1000);
    now += 60 * 1000; // 累计 18:00 → 放行
    expect(sp.allow("bilibili", "acct-9").allow).toBe(true);
  });

  test("18:01 放行且 tryAcquire 刷新时间戳", function () {
    let now = 0;
    const sp = createPublishSpacer({ clock: () => now });
    sp.record("baijiahao", "a");
    now = MIN + 60 * 1000; // 18:01
    const r = sp.tryAcquire("baijiahao", "a");
    expect(r.allow).toBe(true);
    now = MIN + 60 * 1000 + 1000; // 距上次仅 1s → 拒
    expect(sp.allow("baijiahao", "a").allow).toBe(false);
  });

  test("不同 (platform,account) 相互独立", function () {
    let now = 0;
    const sp = createPublishSpacer({ clock: () => now });
    sp.record("douyin", "A");
    expect(sp.allow("douyin", "A").allow).toBe(false);
    expect(sp.allow("douyin", "B").allow).toBe(true);
    expect(sp.allow("kuaishou", "A").allow).toBe(true);
  });

  test("缺 platform/accountId fail-closed 抛错", function () {
    const sp = createPublishSpacer();
    expect(() => sp.allow("", "x")).toThrow();
    expect(() => sp.allow("p", "")).toThrow();
  });
});

describe("publish-mode 三态 × 结果 降级矩阵", function () {
  test("normalizeMode：空默认 api-then-dom，非法值抛错", function () {
    expect(normalizeMode(undefined)).toBe(MODES.apiThenDom);
    expect(normalizeMode("")).toBe(MODES.apiThenDom);
    expect(() => normalizeMode("wild")).toThrow(/unknown publishMode/);
  });

  test("dom-only：直接走 DOM，不进 API", function () {
    expect(decideRoute({ mode: "dom-only" }).route).toBe(ROUTES.dom);
  });

  test("api-only / api-then-dom 初始都先进 API", function () {
    expect(decideRoute({ mode: "api-only" }).route).toBe(ROUTES.api);
    expect(decideRoute({ mode: "api-then-dom" }).route).toBe(ROUTES.api);
  });

  test("success：留在 API 轨，不降级", function () {
    const d = decideRoute({ mode: "api-then-dom", outcome: "success" });
    expect(d.route).toBe(ROUTES.api);
    expect(d.degrade).toBe(false);
  });

  test("risk_blocked：任何模式停报、不降级、不换号", function () {
    for (const m of ["api-only", "api-then-dom"]) {
      const d = decideRoute({ mode: m, outcome: "risk_blocked" });
      expect(d.route).toBe(ROUTES.stop);
      expect(d.degrade).toBe(false);
      expect(d.reasonCode).toBe("risk_blocked_stop");
    }
  });

  test("login_expired：停报（不降级绕风控）", function () {
    const d = decideRoute({ mode: "api-then-dom", outcome: "login_expired" });
    expect(d.route).toBe(ROUTES.stop);
    expect(d.degrade).toBe(false);
  });

  test("transient_error：api-then-dom 降级 DOM；api-only 停报", function () {
    const dom = decideRoute({ mode: "api-then-dom", outcome: "transient_error" });
    expect(dom.route).toBe(ROUTES.dom);
    expect(dom.degrade).toBe(true);
    expect(dom.reasonCode).toBe("transient_error_fallback");
    const stop = decideRoute({ mode: "api-only", outcome: "transient_error" });
    expect(stop.route).toBe(ROUTES.stop);
    expect(stop.degrade).toBe(false);
  });

  test("unsupported：api-then-dom 回落 DOM；dom-only 恒 DOM", function () {
    expect(decideRoute({ mode: "api-then-dom", outcome: "unsupported" }).route).toBe(ROUTES.dom);
    expect(decideRoute({ mode: "api-then-dom", outcome: "unsupported" }).reasonCode).toBe("mode_unsupported_fallback");
    expect(decideRoute({ mode: "api-only", outcome: "unsupported" }).route).toBe(ROUTES.stop);
  });

  test("未知失败码：保守停报", function () {
    expect(decideRoute({ mode: "api-then-dom", outcome: "weird" }).route).toBe(ROUTES.stop);
  });
});
