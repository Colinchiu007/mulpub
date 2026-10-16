import { describe, it, expect, vi } from "vitest";

/**
 * publish-republish-snapshot 行为锁
 *
 * 需求（01-docs/PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15.md §4.1/§5.1）：
 * 「再次发布」必须能把**该次发布实际使用的内容与选项**原样还原到发布页。
 * 现状是 phase4-events 的两个落库点只写 title/status/result/封面 —— 正文与选项一个字节都没存。
 *
 * 本文件的锁重点（每条都对应一个具体失效模式）：
 *   1. 白名单提取（**尤其**：任务载荷里真实存在 `article.cookies`，快照绝不能带上它）
 *   2. 落库/读回/淘汰/级联删除
 *   3. 读取侧归一（存储被污染也不能把任意键注回表单）
 *   4. 与渲染层 `normalizeRewriteLineage` 的口径一致（归因链不能因为跨进程而漂移）
 */

/** 与真实 settings-store 同形的内存夹具：落文本、读回解析后的值（见 settings-store.js） */
function makeStore () {
  const rows = new Map();
  const scoped = (key, owner) => (owner === undefined || owner === "__legacy__" ? key : `user:${owner}:${key}`);
  return {
    _rows: rows,
    getSetting (key, defaultValue = null) {
      if (!rows.has(key)) return defaultValue;
      try { return JSON.parse(rows.get(key)); } catch { return rows.get(key); }
    },
    setSetting (key, value) { rows.set(key, JSON.stringify(value)); },
    getUserSetting (key, defaultValue = null, owner) {
      if (owner === undefined || owner === null) return defaultValue;
      return this.getSetting(scoped(key, owner), defaultValue);
    },
    setUserSetting (key, value, owner) {
      if (owner === undefined || owner === null) return;
      this.setSetting(scoped(key, owner), value);
    },
  };
}

function fullArticle (extra = {}) {
  return {
    title: "标题",
    content: "第一段\n第二段",
    author: "作者",
    cover_url: "https://cdn.example.com/a.png",
    cover_path: "D:/covers/a.png",
    cover_file: { path: "D:/covers/a.png", name: "a.png" },
    video_path: "",
    images: ["D:/imgs/1.png", "D:/imgs/2.png"],
    image_files: [{ path: "D:/imgs/1.png", name: "1.png" }],
    tags: ["#话题A"],
    topics: [],
    mentions: ["@某人"],
    contentFormat: "markdown",
    aiGenerated: false,
    visibilitySemantic: "public",
    platformOverrides: { douyin: { title: "抖音标题", content: "" } },
    rewriteHistoryId: "rw1234567890ab",
    accountId: "acc-1",
    // ↓ 凭证：真实存在于任务载荷（publish-audit-requery.js 会读它），绝不能进快照
    cookies: "SID=topsecret; HSID=alsosecret",
    ...extra,
  };
}

describe("publish-republish-snapshot / 白名单提取", () => {
  it("归一后键集合精确等于白名单，且不含凭证字段", () => {
    const mod = require("../services/publish-republish-snapshot");
    const snapshot = mod.buildRepublishSnapshot({
      platform: "douyin",
      article: fullArticle(),
      publishMode: "scheduled",
      batchId: "batch_1",
      savedAt: "2026-10-15T00:00:00.000Z",
    });
    const allowed = new Set(mod.SNAPSHOT_FIELDS.concat(["visibilitySemantic", "publishMode", "batchId", "savedAt"]));
    for (const key of Object.keys(snapshot)) {
      expect(allowed.has(key), `快照多出未登记字段 ${key}`).toBe(true);
    }
    // 反向：白名单里的键一个都不能少（缺键＝还原时静默丢内容）
    for (const key of mod.SNAPSHOT_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(snapshot, key), `快照缺少白名单字段 ${key}`).toBe(true);
    }
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("topsecret");
    expect(serialized).not.toContain("cookies");
  });

  it("内容与选项逐字段保留（这是「再次发布」的全部价值）", () => {
    const mod = require("../services/publish-republish-snapshot");
    const snapshot = mod.buildRepublishSnapshot({ platform: "douyin", article: fullArticle() });
    expect(snapshot.title).toBe("标题");
    expect(snapshot.content).toBe("第一段\n第二段");
    expect(snapshot.author).toBe("作者");
    expect(snapshot.cover_url).toBe("https://cdn.example.com/a.png");
    expect(snapshot.cover_path).toBe("D:/covers/a.png");
    expect(snapshot.cover_file).toBe("D:/covers/a.png");
    expect(snapshot.images).toEqual(["D:/imgs/1.png", "D:/imgs/2.png"]);
    expect(snapshot.image_files).toEqual([{ path: "D:/imgs/1.png", name: "1.png" }]);
    expect(snapshot.tags).toEqual(["#话题A"]);
    expect(snapshot.mentions).toEqual(["@某人"]);
    expect(snapshot.contentFormat).toBe("markdown");
    expect(snapshot.aiGenerated).toBe(false);
    expect(snapshot.visibilitySemantic).toBe("public");
    expect(snapshot.platformOverrides).toEqual({ douyin: { title: "抖音标题", content: "" } });
    expect(snapshot.rewriteHistoryId).toBe("rw1234567890ab");
    expect(snapshot.accountId).toBe("acc-1");
    expect(snapshot.platform).toBe("douyin");
    // 平台/账号按**发布表单形状**给出（平台数组 + 账号 id 数组），
    // 让渲染端「快照 → 表单」只需要一份实现（草稿箱与再次发布共用）
    expect(snapshot.platforms).toEqual(["douyin"]);
    expect(snapshot.accounts).toEqual({ douyin: ["acc-1"] });
  });

  it("数组字段缺失回落 [] 而不是空串（空串会让发布契约判 images 引用无效）", () => {
    const mod = require("../services/publish-republish-snapshot");
    const snapshot = mod.buildRepublishSnapshot({ platform: "zhihu", article: { title: "t" } });
    for (const key of ["images", "image_files", "tags", "topics", "mentions"]) {
      expect(Array.isArray(snapshot[key]), `${key} 必须是数组`).toBe(true);
      expect(snapshot[key]).toEqual([]);
    }
  });

  it("aiGenerated 缺省按 true（与 usePublishFlow.buildArticleData 同口径）", () => {
    const mod = require("../services/publish-republish-snapshot");
    expect(mod.buildRepublishSnapshot({ platform: "zhihu", article: { title: "t" } }).aiGenerated).toBe(true);
    expect(mod.buildRepublishSnapshot({ platform: "zhihu", article: { title: "t", aiGenerated: true } }).aiGenerated).toBe(true);
  });

  it("无账号/无平台时 platforms 与 accounts 落为空集合而不是缺键", () => {
    const mod = require("../services/publish-republish-snapshot");
    const snapshot = mod.buildRepublishSnapshot({ platform: "", article: { title: "t" } });
    expect(snapshot.platforms).toEqual([]);
    expect(snapshot.accounts).toEqual({});
  });

  it("rewriteHistoryId 的非法形态折成 null（不得折成空串）", () => {
    const mod = require("../services/publish-republish-snapshot");
    for (const bad of [123, "", "   ", "x".repeat(65), "a\u0000b", null, undefined]) {
      expect(mod.buildRepublishSnapshot({ platform: "zhihu", article: { title: "t", rewriteHistoryId: bad } }).rewriteHistoryId).toBeNull();
    }
  });

  it("归一化拒绝非对象输入，不抛错", () => {
    const mod = require("../services/publish-republish-snapshot");
    for (const bad of [null, undefined, 1, "x", [], true]) {
      expect(mod.normalizeSnapshot(bad)).toBeNull();
    }
  });
});

describe("publish-republish-snapshot / 落库与读回", () => {
  it("save 后 read 逐字段相等", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    const saved = mod.saveSnapshot(
      { recordId: "rec-1", platform: "douyin", article: fullArticle(), savedAt: "2026-10-15T00:00:00.000Z" },
      "user-a",
      { store },
    );
    expect(saved.saved).toBe(true);
    const back = mod.readSnapshot("rec-1", "user-a", { store });
    expect(back.title).toBe("标题");
    expect(back.content).toBe("第一段\n第二段");
    expect(back.savedAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("归属隔离：另一个 owner 读不到", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: fullArticle() }, "user-a", { store });
    expect(mod.readSnapshot("rec-1", "user-b", { store })).toBeNull();
  });

  it("owner 为 null 时 fail-closed：不写不读", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    expect(mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: fullArticle() }, null, { store }))
      .toMatchObject({ saved: false });
    expect(mod.readSnapshot("rec-1", null, { store })).toBeNull();
    expect(store._rows.size).toBe(0);
  });

  it("recordId 非法（空/超长/非串）不写", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    for (const bad of ["", "   ", "x".repeat(65), 1, null, undefined]) {
      expect(mod.saveSnapshot({ recordId: bad, platform: "douyin", article: fullArticle() }, "user-a", { store }).saved).toBe(false);
    }
    expect(store._rows.size).toBe(0);
  });

  it("空快照（title 与 content 都为空）不写", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    const result = mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: { title: "", content: "  " } }, "user-a", { store });
    expect(result).toMatchObject({ saved: false, reason: "empty_snapshot" });
  });

  it("超过体积上限不写，且不抛错", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    const huge = { title: "t", content: "x".repeat(mod.MAX_SNAPSHOT_BYTES + 1) };
    const result = mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: huge }, "user-a", { store });
    expect(result).toMatchObject({ saved: false, reason: "too_large" });
  });

  it("store 不可用时不抛错（旁路红线）", () => {
    const mod = require("../services/publish-republish-snapshot");
    expect(mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: fullArticle() }, "user-a", {})).toMatchObject({ saved: false });
    expect(mod.readSnapshot("rec-1", "user-a", {})).toBeNull();
    expect(mod.deleteSnapshots(["rec-1"], "user-a", {})).toMatchObject({ deleted: 0 });
  });

  it("同一 recordId 重复 save 幂等（覆盖，不产生第二份）", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: fullArticle() }, "user-a", { store });
    mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: fullArticle({ title: "改了" }) }, "user-a", { store });
    expect(mod.readSnapshot("rec-1", "user-a", { store }).title).toBe("改了");
    expect(mod.readSnapshotIndex("user-a", { store })).toEqual(["rec-1"]);
  });
});

describe("publish-republish-snapshot / 索引、淘汰与级联删除", () => {
  it("索引新→旧，且 listEnrichment 用的 hasSnapshot 只读索引", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: fullArticle() }, "user-a", { store });
    mod.saveSnapshot({ recordId: "rec-2", platform: "zhihu", article: fullArticle() }, "user-a", { store });
    expect(mod.readSnapshotIndex("user-a", { store })).toEqual(["rec-2", "rec-1"]);
  });

  it("超过上限淘汰最旧，且其快照键被真删（不是只从索引摘除）", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    const cap = mod.MAX_SNAPSHOTS;
    for (let i = 0; i < cap + 1; i += 1) {
      mod.saveSnapshot({ recordId: `rec-${i}`, platform: "douyin", article: fullArticle() }, "user-a", { store });
    }
    const index = mod.readSnapshotIndex("user-a", { store });
    expect(index.length).toBe(cap);
    expect(index).not.toContain("rec-0");
    expect(mod.readSnapshot("rec-0", "user-a", { store })).toBeNull();
    expect(mod.readSnapshot(`rec-${cap}`, "user-a", { store })).not.toBeNull();
  });

  it("deleteSnapshots 同时摘索引与删键；不存在的 id 计 0", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    mod.saveSnapshot({ recordId: "rec-1", platform: "douyin", article: fullArticle() }, "user-a", { store });
    mod.saveSnapshot({ recordId: "rec-2", platform: "douyin", article: fullArticle() }, "user-a", { store });
    const result = mod.deleteSnapshots(["rec-1", "rec-404", ""], "user-a", { store });
    expect(result.deleted).toBe(1);
    expect(mod.readSnapshot("rec-1", "user-a", { store })).toBeNull();
    expect(mod.readSnapshot("rec-2", "user-a", { store })).not.toBeNull();
    expect(mod.readSnapshotIndex("user-a", { store })).toEqual(["rec-2"]);
  });

  it("读取侧归一：存储里混入的未知键与凭证键不得回流表单", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    store.setUserSetting("publish-republish-snapshot:rec-1", {
      title: "t", content: "c", cookies: "SID=leak", evil: { a: 1 },
    }, "user-a");
    const back = mod.readSnapshot("rec-1", "user-a", { store });
    expect(back.title).toBe("t");
    expect(back).not.toBeNull();
    expect(JSON.stringify(back)).not.toContain("leak");
    expect(Object.prototype.hasOwnProperty.call(back, "evil")).toBe(false);
  });

  it("存储损坏（字符串非法 JSON）返回 null 而不抛错", () => {
    const mod = require("../services/publish-republish-snapshot");
    const store = makeStore();
    store.setSetting("user:user-a:publish-republish-snapshot:rec-1", "{ not json");
    expect(mod.readSnapshot("rec-1", "user-a", { store })).toBeNull();
  });
});

describe("publish-republish-snapshot / 与渲染层口径一致", () => {
  it("rewriteHistoryId 归一与 src/utils/rewrite-lineage 逐用例一致", async () => {
    const mod = require("../services/publish-republish-snapshot");
    const { normalizeRewriteLineage } = await import("../../src/utils/rewrite-lineage");
    const corpus = ["abc", "  abc  ", "", "   ", "x".repeat(64), "x".repeat(65), "a\u0000b", "a\nb", 123, null, undefined, {}, []];
    for (const value of corpus) {
      const main = mod.buildRepublishSnapshot({ platform: "zhihu", article: { title: "t", rewriteHistoryId: value } }).rewriteHistoryId;
      expect(main, `口径漂移：${JSON.stringify(value)}`).toBe(normalizeRewriteLineage(value));
    }
  });
});
