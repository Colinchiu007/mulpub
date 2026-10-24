import { describe, it, expect } from "vitest";
import { accountStatusKind, lastLoginCheckAt, needsCleanLoginSession, needsReloginConfirmation } from "@/utils/account-status";

/**
 * 这两个函数是「账号失效 → 打开平台页必须干净会话」这条链路的单一判定。
 * 输入矩阵按外部评审（QM-6 codex W2/I1/I2）补齐：库里已落库的失效态、本轮刚确认
 * 失效但尚未回写 status、大小写/空白脏值、缺失字段，逐格钉住。
 */
describe("accountStatusKind — 登录态归一化", () => {
  it("三态词表 + 错误态按字面命中", () => {
    expect(accountStatusKind({ status: "active" })).toBe("online");
    expect(accountStatusKind({ status: "online" })).toBe("online");
    expect(accountStatusKind({ status: "expired" })).toBe("expired");
    expect(accountStatusKind({ status: "unverified" })).toBe("unverified");
    expect(accountStatusKind({ status: "error" })).toBe("error");
    expect(accountStatusKind({ status: "failed" })).toBe("error");
    expect(accountStatusKind({ status: "failure" })).toBe("error");
  });

  it("大小写与空白一律归一化（卡片展示层与行为层必须同口径）", () => {
    expect(accountStatusKind({ status: "Expired" })).toBe("expired");
    expect(accountStatusKind({ status: " EXPIRED " })).toBe("expired");
    expect(accountStatusKind({ status: "Active" })).toBe("online");
  });

  it("历史脏值 inactive/offline 落到 unknown，不冒充已登录", () => {
    expect(accountStatusKind({ status: "inactive" })).toBe("unknown");
    expect(accountStatusKind({ status: "offline" })).toBe("unknown");
  });

  it("字段缺失或脏类型不抛异常，落到 unknown", () => {
    expect(accountStatusKind({})).toBe("unknown");
    expect(accountStatusKind(undefined)).toBe("unknown");
    expect(accountStatusKind({ status: null })).toBe("unknown");
    expect(accountStatusKind({ status: 42 })).toBe("unknown");
  });
});

describe("needsReloginConfirmation — 重新登录是否需要二次确认", () => {
  it("只有「已登录」态需要确认：它是唯一有可用会话需要保护的状态", () => {
    expect(needsReloginConfirmation({ id: "a1", status: "active" })).toBe(true);
    expect(needsReloginConfirmation({ id: "a1", status: "online" })).toBe(true);
    // 大小写 / 空白与 accountStatusKind 同口径归一化
    expect(needsReloginConfirmation({ id: "a1", status: " ACTIVE " })).toBe(true);
  });

  it("已失效 / 未确认 / 异常 / 无记录都不要求二次确认（没有可用会话需要保护）", () => {
    expect(needsReloginConfirmation({ id: "a1", status: "expired" })).toBe(false);
    expect(needsReloginConfirmation({ id: "a1", status: "unverified" })).toBe(false);
    expect(needsReloginConfirmation({ id: "a1", status: "error" })).toBe(false);
    expect(needsReloginConfirmation({ id: "a1" })).toBe(false);
  });

  it("字段缺失 / 脏类型不抛异常", () => {
    expect(needsReloginConfirmation(undefined)).toBe(false);
    expect(needsReloginConfirmation({})).toBe(false);
    expect(needsReloginConfirmation({ status: null })).toBe(false);
  });

  it("结构锁：needsReloginConfirmation 全仓只有一份实现（第二份即红）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const srcRoot = path.resolve(process.cwd(), "src");
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".vue") || entry.name.endsWith(".js")) {
          const text = fs.readFileSync(full, "utf8");
          if (/function needsReloginConfirmation\s*\(/.test(text)) hits.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(srcRoot);
    // 反失明：遍历退化成空集合会让本条恒绿
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits).toEqual(["src" + path.sep + "utils" + path.sep + "account-status.js"]);
  });
});

describe("lastLoginCheckAt — 最近一次检测时间", () => {
  it("按字段名清单取第一个可解析的日期", () => {
    expect(lastLoginCheckAt({ last_login_check_at: "2026-10-20T08:00:00.000Z" })?.toISOString())
      .toBe("2026-10-20T08:00:00.000Z");
    expect(lastLoginCheckAt({ lastValidated: "2026-10-21T08:00:00.000Z" })?.toISOString())
      .toBe("2026-10-21T08:00:00.000Z");
  });

  it("取不到或取到非法值时返回 null（不得返回 Invalid Date）", () => {
    expect(lastLoginCheckAt({})).toBeNull();
    expect(lastLoginCheckAt(undefined)).toBeNull();
    expect(lastLoginCheckAt({ last_checked_at: "not-a-date" })).toBeNull();
    expect(lastLoginCheckAt({ last_checked_at: "" })).toBeNull();
    // 非法值后面还有合法值时，继续往后找
    expect(lastLoginCheckAt({ last_checked_at: "not-a-date", last_validated: "2026-10-21T08:00:00.000Z" })?.toISOString())
      .toBe("2026-10-21T08:00:00.000Z");
  });
});

describe("needsCleanLoginSession — 是否必须走干净会话", () => {
  it("库里已落库 expired ⇒ 干净会话", () => {
    expect(needsCleanLoginSession({ id: "a1", status: "expired" })).toBe(true);
    expect(needsCleanLoginSession({ id: "a1", status: " EXPIRED " })).toBe(true);
  });

  it("本轮检测刚确认失效（status 尚未回写）⇒ 干净会话", () => {
    const confirmed = new Set(["a1"]);
    expect(needsCleanLoginSession({ id: "a1", status: "active" }, confirmed)).toBe(true);
    // 未确认的账号不得被连带清空
    expect(needsCleanLoginSession({ id: "a2", status: "active" }, confirmed)).toBe(false);
  });

  it("有效 / 未确认态不得强制重登（fail-open 方向）", () => {
    expect(needsCleanLoginSession({ id: "a1", status: "active" })).toBe(false);
    expect(needsCleanLoginSession({ id: "a1", status: "unverified" })).toBe(false);
    expect(needsCleanLoginSession({ id: "a1", status: "inactive" })).toBe(false);
    expect(needsCleanLoginSession({ id: "a1" })).toBe(false);
  });

  it("集合缺失 / 非 Set / id 缺失均不抛异常", () => {
    expect(needsCleanLoginSession({ id: "a1", status: "active" }, undefined)).toBe(false);
    expect(needsCleanLoginSession({ id: "a1", status: "active" }, null)).toBe(false);
    expect(needsCleanLoginSession({ id: "a1", status: "active" }, {})).toBe(false);
    expect(needsCleanLoginSession({ status: "active" }, new Set(["a1"]))).toBe(false);
    expect(needsCleanLoginSession(undefined, new Set(["a1"]))).toBe(false);
  });

  it("未确认 / 异常 / 无记录都不要求二次确认（没有可用会话需要保护）", () => {
    expect(needsReloginConfirmation({ id: "a1", status: "expired" })).toBe(false);
    expect(needsReloginConfirmation({ id: "a1", status: "unverified" })).toBe(false);
    expect(needsReloginConfirmation({ id: "a1", status: "error" })).toBe(false);
    expect(needsReloginConfirmation({ id: "a1" })).toBe(false);
  });

  it("结构锁：accountStatusKind 全仓只有一份实现（第二份即红）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const srcRoot = path.resolve(process.cwd(), "src");
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".vue") || entry.name.endsWith(".js")) {
          const text = fs.readFileSync(full, "utf8");
          if (/function accountStatusKind\s*\(/.test(text)) hits.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(srcRoot);
    // 反失明：遍历退化成空集合会让本条恒绿
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits).toEqual(["src" + path.sep + "utils" + path.sep + "account-status.js"]);
  });
});
