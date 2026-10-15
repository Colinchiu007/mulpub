import { describe, it, expect } from "vitest";
import {
  applyPublishSnapshot,
  isStaleScheduleTime,
  SNAPSHOT_ARTICLE_FIELDS,
} from "./publish-snapshot";

/**
 * publish-snapshot 行为锁（PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15 §5.1.1）
 *
 * 这个纯函数是**草稿箱「继续编辑」与发布记录「再次发布」共用的唯一字段映射**。
 * 两条路径各写一份必然漂移，而漂移的症状不是报错，是「从草稿恢复有话题、
 * 再次发布没话题」这类静默少字段 —— 所以这里逐字段锁死，并锁住三条易破边界。
 */

function makeTargets (article = {}) {
  return {
    article: { ...article },
    selectedPlatforms: { value: [] },
    selectedAccounts: { value: {} },
    platformOverrides: {},
  };
}

function snapshot (extra = {}) {
  return {
    title: "标题",
    content: "第一段\n第二段",
    author: "作者",
    cover_url: "https://cdn/a.png",
    cover_path: "D:/c/a.png",
    cover_file: "D:/c/a.png",
    video_path: "",
    images: ["D:/i/1.png"],
    image_files: [{ path: "D:/i/1.png" }],
    tags: ["#话题A"],
    topics: ["话题B"],
    mentions: ["@某人"],
    contentFormat: "markdown",
    aiGenerated: false,
    platformOverrides: { douyin: { title: "抖音标题" } },
    rewriteHistoryId: "rw123",
    platforms: ["douyin"],
    accounts: { douyin: ["acc-1"] },
    ...extra,
  };
}

describe("applyPublishSnapshot / 字段映射", () => {
  it("内容字段逐项写回表单", () => {
    const t = makeTargets();
    const outcome = applyPublishSnapshot(snapshot(), t);
    expect(outcome.applied).toBe(true);
    expect(t.article.title).toBe("标题");
    expect(t.article.content).toBe("第一段\n第二段");
    expect(t.article.author).toBe("作者");
    expect(t.article.cover_url).toBe("https://cdn/a.png");
    expect(t.article.cover_path).toBe("D:/c/a.png");
    expect(t.article.cover_file).toBe("D:/c/a.png");
    expect(t.article.images).toEqual(["D:/i/1.png"]);
    expect(t.article.image_files).toEqual([{ path: "D:/i/1.png" }]);
    expect(t.article.mentions).toEqual(["@某人"]);
    expect(t.article.rewriteHistoryId).toBe("rw123");
    // topics 并入 tags 后清空（UI 只有一个「话题标签」入口，两个字段会让话题显示成两份）
    expect(t.article.tags).toEqual(["#话题A", "话题B"]);
    expect(t.article.topics).toEqual([]);
  });

  it("选项（平台/账号/分平台覆盖）写回表单", () => {
    const t = makeTargets();
    applyPublishSnapshot(snapshot(), t);
    expect(t.selectedPlatforms.value).toEqual(["douyin"]);
    expect(t.selectedAccounts.value).toEqual({ douyin: ["acc-1"] });
    expect(t.platformOverrides).toEqual({ douyin: { title: "抖音标题" } });
  });

  it("platformOverrides 是**替换**而不是合并（不清掉上一条快照的残留覆盖）", () => {
    const t = makeTargets();
    t.platformOverrides = { zhihu: { title: "旧覆盖" } };
    applyPublishSnapshot(snapshot({ platformOverrides: {} }), t);
    expect(t.platformOverrides).toEqual({});
  });

  it("数组字段在快照缺失/类型错误时回落 []（空串会触发「images 文件引用无效」）", () => {
    const t = makeTargets();
    applyPublishSnapshot({ title: "t", images: "", tags: null, image_files: {} }, t);
    for (const field of ["images", "image_files", "tags", "topics", "mentions"]) {
      expect(Array.isArray(t.article[field]), `${field} 必须是数组`).toBe(true);
      expect(t.article[field]).toEqual([]);
    }
  });

  it("rewriteHistoryId 落 null 而不是空串（否则「没关联」与「关联被抹」不可区分）", () => {
    const t = makeTargets({ rewriteHistoryId: "旧关联" });
    applyPublishSnapshot(snapshot({ rewriteHistoryId: undefined }), t);
    expect(t.article.rewriteHistoryId).toBe(null);
  });

  it("非法快照不改变表单", () => {
    for (const bad of [null, undefined, 1, "x", []]) {
      const t = makeTargets({ title: "原内容" });
      const outcome = applyPublishSnapshot(bad, t);
      expect(outcome.applied).toBe(false);
      expect(t.article.title).toBe("原内容");
      expect(t.selectedPlatforms.value).toEqual([]);
    }
  });

  it("白名单字段清单与实现一致（新增字段必须同时进白名单，否则静默不还原）", () => {
    const t = makeTargets();
    const full = {};
    for (const field of SNAPSHOT_ARTICLE_FIELDS) {
      full[field] = field === "rewriteHistoryId" ? "rw" : (field === "images" ? ["a"] : "值");
    }
    applyPublishSnapshot(full, t);
    for (const field of SNAPSHOT_ARTICLE_FIELDS) {
      expect(t.article[field], `${field} 未被写回`).toBeDefined();
    }
  });
});

describe("applyPublishSnapshot / 定时时间（过期不静默沿用）", () => {
  it("过期定时被清空并回报时刻（调用方据此提示用户）", () => {
    const t = makeTargets({ publishTime: "2030-01-01T10:00" });
    const outcome = applyPublishSnapshot(
      { title: "t", publishTime: "2020-01-01T10:00" },
      t,
      { now: Date.parse("2026-10-15T00:00:00Z") },
    );
    expect(outcome.staleScheduleTime).toBe("2020-01-01T10:00");
    expect(t.article.publishTime).toBe("");
  });

  it("未来定时时间保留（不能把用户排好的时间清掉）", () => {
    const t = makeTargets();
    const outcome = applyPublishSnapshot(
      { title: "t", publishTime: "2030-01-01T10:00" },
      t,
      { now: Date.parse("2026-10-15T00:00:00Z") },
    );
    expect(outcome.staleScheduleTime).toBe("");
    expect(t.article.publishTime).toBe("2030-01-01T10:00");
  });

  it("不可解析的定时时间保留（不猜、不替用户做决定）", () => {
    const t = makeTargets();
    const outcome = applyPublishSnapshot({ title: "t", publishTime: "不是时间" }, t);
    expect(outcome.staleScheduleTime).toBe("");
    expect(t.article.publishTime).toBe("不是时间");
    expect(isStaleScheduleTime("不是时间")).toBe(false);
    expect(isStaleScheduleTime("")).toBe(false);
  });
});
