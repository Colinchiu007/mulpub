// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StageProgress from "./StageProgress.vue";
import { getAppLocale, setAppLocale } from "@/i18n";

const tStub = (key, params = {}) => {
  const map = {
    "stageProgress.statusCompleted": "已完成",
    "stageProgress.statusSkipped": "已跳过",
    "stageProgress.publishSkipped": "未选发布，跳过",
    "stageProgress.statusRunning": "运行中",
    "stageProgress.statusFailed": "失败",
    "stageProgress.statusWaitingApproval": "等待确认",
    "stageProgress.statusCancelled": "已取消",
    "stageProgress.statusPending": "等待中",
    "create.story2video.selectionWait.stageLabel": "等待选择素材",
    "pipelines.statuses.paused": "已暂停",
    "stageProgress.startedAt": "开始于 {time}",
    "stageProgress.completedAt": "完成于 {time}",
    "stageProgress.splitScenes": "拆分为了 {count} 个场景",
    "stageProgress.optimizeDone": "共 {total} 个场景，已完成 {done} 个",
    "stageProgress.composeSegments": "正在合成片段 {done}/{total} · {percent}%",
    "stageProgress.composeVideo": "视频合成 {percent}%",
    "stageProgress.composeConcat": getAppLocale() === "en"
      ? "Concatenating video segments · {percent}%"
      : "正在拼接视频片段 · {percent}%",
    "stageProgress.assetsDetail": "图片 {images}/{imagesTotal} · 视频 {videos}/{videosTotal} · 旁白 {tts}/{ttsTotal}",
    "stageProgress.assetsDetailNoVideo": "图片 {images}/{imagesTotal} · 旁白 {tts}/{ttsTotal}",
    "stageProgress.timeGuidanceTitle": getAppLocale() === "en" ? "About composition time" : "合成时间说明",
    "stageProgress.timeGuidanceIntro": getAppLocale() === "en"
      ? "Overall completion time is related to video duration — the longer the video, the longer it takes to compose — and also to content complexity and LLM inference time."
      : "整体完成时间与视频时长有关：时长越长，合成越久；同时与内容的复杂程度、大模型的推理时间长短也有关系。",
    "stageProgress.timeGuidanceRef1min": getAppLocale() === "en" ? "1-minute video: 5–8 min" : "1 分钟视频：合成时长 5–8 分钟",
    "stageProgress.timeGuidanceRef3min": getAppLocale() === "en" ? "3-minute video: 15–20 min" : "3 分钟视频：合成时长 15–20 分钟",
    "stageProgress.timeGuidanceRef6min": getAppLocale() === "en" ? "6-minute video: 35–45 min" : "6 分钟视频：合成时长 35–45 分钟",
    "stageProgress.timeGuidanceNote": getAppLocale() === "en" ? "The above composition times are all within the normal range." : "以上合成时长均属正常范围。",
    "stageProgress.assetsImage": "正在生成图片 · {images}/{imagesTotal} · 视频 {videos}/{videosTotal} · 旁白 {tts}/{ttsTotal}",
    "stageProgress.assetsImageRewriting": "正在生成图片 · {images}/{imagesTotal} · 视频 {videos}/{videosTotal} · 旁白 {tts}/{ttsTotal} · 正在改写敏感提示词并重试",
    "stageProgress.assetsSummary": "已生成 {done}/{total} 项素材",
    "stageProgress.stageWorking": "正在处理…",
    "stageProgress.stageComplete": "阶段处理完成",
    "stageProgress.stageSummary": "阶段已完成",
  };
  const template = map[key] || key;
  return Object.keys(params).reduce((s, k) => s.replace(`{${k}}`, String(params[k])), template);
};

const makeStage = (overrides = {}) => ({
  name: "generate_assets",
  status: "pending",
  startedAt: null,
  completedAt: null,
  ...overrides,
});

const mountWith = (props) =>
  mount(StageProgress, { props, global: { mocks: { $t: tStub } } });

beforeEach(() => setAppLocale("zh"));

describe("StageProgress 等待态渲染（2026-08-13）", () => {
  it("scene_asset_selection 检查点暂停：显示「等待选择素材」+ waiting paused 样式 + ⏸ 图标", () => {
    const w = mountWith({
      stages: [makeStage({ status: "paused", startedAt: new Date().toISOString() })],
      checkpoint: { type: "scene_asset_selection" },
    });
    const item = w.find('[data-testid="story2video-stage-generate_assets"]');
    expect(item.classes()).toContain("waiting");
    expect(item.classes()).toContain("paused");
    expect(item.find(".stage-icon").text()).toBe("⏸");
    expect(item.find(".stage-status").text()).toContain("等待选择素材");
    w.unmount();
  });

  it("手动暂停（无 scene_asset_selection 检查点）：显示「已暂停」，仍为 waiting 样式", () => {
    const w = mountWith({
      stages: [makeStage({ name: "compose", status: "paused", startedAt: new Date().toISOString() })],
      checkpoint: null,
    });
    const item = w.find('[data-testid="story2video-stage-compose"]');
    expect(item.classes()).toContain("waiting");
    expect(item.classes()).toContain("paused");
    expect(item.find(".stage-status").text()).toContain("已暂停");
    w.unmount();
  });

  it("waiting_approval 既有语义不回归（不含 paused 类，避免触发等待用户输入脉冲样式）", () => {
    const w = mountWith({ stages: [makeStage({ status: "waiting_approval" })] });
    const item = w.find('[data-testid="story2video-stage-generate_assets"]');
    expect(item.classes()).toContain("waiting");
    expect(item.classes()).not.toContain("paused");
    expect(item.find(".stage-icon").text()).toBe("⏸");
    expect(item.find(".stage-status").text()).toContain("等待确认");
    w.unmount();
  });

  it("completed / running 既有渲染不回归", () => {
    const w = mountWith({
      stages: [
        makeStage({ name: "split", status: "completed", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:30Z" }),
        makeStage({ name: "generate_assets", status: "running", startedAt: "2026-01-01T00:00:00Z" }),
      ],
    });
    expect(w.find('[data-testid="story2video-stage-split"]').classes()).toContain("completed");
    expect(w.find('[data-testid="story2video-stage-generate_assets"]').classes()).toContain("running");
    expect(w.find('[data-testid="story2video-stage-generate_assets"] .stage-icon').text()).toBe("⟳");
    w.unmount();
  });

  it("发布阶段未选平台（skipped）：显示 class=skipped、⏭ 图标与「未选发布，跳过」", () => {
    const w = mountWith({
      stages: [makeStage({ name: "publish", status: "skipped", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:00Z" })],
      orchestrationContext: { publish: { skipped: true } },
    });
    const item = w.find('[data-testid="story2video-stage-publish"]');
    expect(item.classes()).toContain("skipped");
    expect(item.find(".stage-icon").text()).toBe("⏭");
    expect(item.find(".stage-status").text()).toContain("未选发布，跳过");
    w.unmount();
  });

  it("非发布阶段 skipped：显示通用「已跳过」", () => {
    const w = mountWith({
      stages: [makeStage({ name: "optimize", status: "skipped" })],
    });
    const item = w.find('[data-testid="story2video-stage-optimize"]');
    expect(item.classes()).toContain("skipped");
    expect(item.find(".stage-status").text()).toContain("已跳过");
    w.unmount();
  });
});

describe("StageProgress 阶段级进行中信息统一契约（openspec pipeline-progress-feedback-unification）", () => {
  it("总进度越界或非数值时安全收敛到 0..100", () => {
    const high = mountWith({ stages: [makeStage()], progressPercent: 150 });
    expect(high.find('[data-testid="story2video-orchestration-progress"] .progress-fill').attributes("style")).toContain("width: 100%");
    high.unmount();

    const low = mountWith({ stages: [makeStage()], progressPercent: -1 });
    expect(low.find('[data-testid="story2video-orchestration-progress"] .progress-fill').attributes("style")).toContain("width: 0%");
    low.unmount();

    const invalid = mountWith({ stages: [makeStage()], progressPercent: "not-a-number" });
    expect(invalid.find('[data-testid="story2video-orchestration-progress"] .progress-fill').attributes("style")).toContain("width: 0%");
    invalid.unmount();
  });

  it("阶段子进度只接受有限的 0..100 数值，并将合法小数取整", () => {
    const w = mountWith({
      stages: [
        makeStage({ name: "publish", status: "running", progress: { percent: "51.6", message: "publishing" } }),
        makeStage({ name: "compose", status: "running", progress: { percent: 101, message: "invalid" } }),
        makeStage({ name: "split", status: "running", progress: { percent: -1, message: "invalid" } }),
      ],
    });
    expect(w.find('[data-testid="story2video-stage-progress-publish"]').attributes("aria-valuenow")).toBe("52");
    expect(w.find('[data-testid="story2video-stage-compose-progress"]').exists()).toBe(false);
    expect(w.find('[data-testid="story2video-stage-progress-split"]').exists()).toBe(false);
    w.unmount();
  });

  it("任意阶段带 stage.progress：显示 message + 迷你进度条（非 compose 阶段）", () => {
    const w = mountWith({
      stages: [
        makeStage({
          name: "publish",
          status: "running",
          startedAt: new Date().toISOString(),
          progress: { percent: 50, message: "正在发布到 weibo (2/4)", updatedAt: "2026-08-13T00:00:00.000Z" },
        }),
      ],
    });
    const item = w.find('[data-testid="story2video-stage-publish"]');
    expect(item.find(".stage-detail").text()).toBe("正在发布到 weibo (2/4)");
    const bar = w.find('[data-testid="story2video-stage-progress-publish"]');
    expect(bar.exists()).toBe(true);
    expect(bar.attributes("aria-valuenow")).toBe("50");
    w.unmount();
  });

  it("completed 阶段 summary 优先于 progress.message 展示", () => {
    const w = mountWith({
      stages: [
        makeStage({
          name: "split",
          status: "completed",
          startedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T00:00:30Z",
          progress: { percent: 100, message: "文案分句完成", updatedAt: "2026-08-13T00:00:00.000Z" },
          summary: "拆分为了 12 个场景",
        }),
      ],
    });
    const item = w.find('[data-testid="story2video-stage-split"]');
    expect(item.find(".stage-detail").text()).toBe("拆分为了 12 个场景");
    w.unmount();
  });

  it("结构化本地化 key 优先于 raw message，并在 key 缺失时回退 raw", () => {
    const localized = mountWith({
      stages: [makeStage({
        name: "generate_assets",
        status: "running",
        progress: {
          percent: 50,
          message: "raw fallback",
          messageKey: "stageProgress.assetsImage",
          messageParams: { images: 2, imagesTotal: 4, videos: 0, videosTotal: 0, tts: 1, ttsTotal: 4 },
        },
      })],
    });
    expect(localized.find(".stage-detail").text()).toContain("正在生成图片 · 2/4");
    localized.unmount();

    const fallback = mountWith({
      stages: [makeStage({
        name: "generate_assets",
        status: "running",
        progress: { percent: 50, message: "raw fallback", messageKey: "stageProgress.missing" },
      })],
    });
    expect(fallback.find(".stage-detail").text()).toBe("raw fallback");
    fallback.unmount();
  });

  it("内容安全改写重试进行中：展示「正在改写敏感提示词并重试」提示（2026-08-30 复盘 mtequszp_enqn）", () => {
    const w = mountWith({
      stages: [makeStage({
        name: "generate_assets",
        status: "running",
        progress: {
          percent: 50,
          message: "Rewriting sensitive prompt and retrying…",
          messageKey: "stageProgress.assetsImageRewriting",
          messageParams: { images: 69, imagesTotal: 70, videos: 0, videosTotal: 0, tts: 70, ttsTotal: 70 },
        },
      })],
    });
    expect(w.find(".stage-detail").text()).toContain("正在生成图片 · 69/70");
    expect(w.find(".stage-detail").text()).toContain("正在改写敏感提示词并重试");
    w.unmount();
  });

  it("完成态结构化 summary key 优先于旧 summary", () => {
    const w = mountWith({
      stages: [makeStage({
        name: "generate_assets",
        status: "completed",
        summary: "old summary",
        progress: {
          percent: 100,
          message: "old message",
          summaryKey: "stageProgress.assetsSummary",
          summaryParams: { done: 8, total: 8 },
        },
      })],
    });
    expect(w.find(".stage-detail").text()).toBe("已生成 8/8 项素材");
    w.unmount();
  });

  it("无 stage.progress / summary：安全降级（不渲染迷你进度条，detail 仅保留既有时间文本）", () => {
    const w = mountWith({
      stages: [
        makeStage({ name: "domain_enrich", status: "running", startedAt: new Date().toISOString() }),
      ],
    });
    const item = w.find('[data-testid="story2video-stage-domain_enrich"]');
    // 无统一契约数据：detail 回退既有「开始于 …」时间文本（不显示空文案也不显示进行中 message）
    expect(item.find(".stage-detail").text()).toContain("开始于");
    expect(item.find(".stage-sub-progress").exists()).toBe(false);
    w.unmount();
  });

  it("compose 旧快照降级：无 stage.progress 时读 orchestrationContext.compose_progress 渲染子进度条（testid 兼容）", () => {
    const w = mountWith({
      stages: [makeStage({ name: "compose", status: "running", startedAt: new Date().toISOString() })],
      orchestrationContext: { compose_progress: { phase: "segments", percent: 39, segmentsDone: 3, segmentsTotal: 5 } },
    });
    const bar = w.find('[data-testid="story2video-stage-compose-progress"]');
    expect(bar.exists()).toBe(true);
    expect(bar.attributes("aria-valuenow")).toBe("39");
    expect(w.find(".stage-detail").text()).toContain("正在合成片段 3/5 · 39%");
    w.unmount();
  });

  it("compose 旧快照带 message 时优先显示按块消息，同时保留 percent 子进度条", () => {
    const message = "正在拼接视频片段（分块 3/5）";
    const w = mountWith({
      stages: [makeStage({ name: "compose", status: "running", startedAt: new Date().toISOString() })],
      orchestrationContext: {
        compose_progress: { phase: "concat", percent: 88.2, segmentsDone: 12, segmentsTotal: 12, message },
      },
    });
    const item = w.find('[data-testid="story2video-stage-compose"]');
    expect(item.find(".stage-detail").text()).toBe(message);
    expect(item.find(".stage-detail").text()).not.toContain("视频合成 88%");
    expect(item.find('[data-testid="story2video-stage-compose-progress"]').attributes("aria-valuenow")).toBe("88");
    w.unmount();
  });

  it("compose message 为空白时继续使用 phase/percent 本地化回退", () => {
    const w = mountWith({
      stages: [makeStage({ name: "compose", status: "running", startedAt: new Date().toISOString() })],
      orchestrationContext: { compose_progress: { phase: "concat", percent: 88.2, message: "   " } },
    });
    expect(w.find(".stage-detail").text()).toContain("正在拼接视频片段 · 88%");
    w.unmount();
  });

  it("英文界面不直显中文 compose message，改用本地化 concat 文案", () => {
    setAppLocale("en");
    const w = mountWith({
      stages: [makeStage({ name: "compose", status: "running", startedAt: new Date().toISOString() })],
      orchestrationContext: {
        compose_progress: { phase: "concat", percent: 88.2, message: "正在拼接视频片段（分块 3/5）" },
      },
    });
    expect(w.find(".stage-detail").text()).toBe("Concatenating video segments · 88%");
    w.unmount();
  });

  it("compose percent 越界时不显示 message 与子进度条", () => {
    const w = mountWith({
      stages: [makeStage({ name: "compose", status: "running" })],
      orchestrationContext: {
        compose_progress: { phase: "concat", percent: 101, message: "正在拼接视频片段（分块 5/5）" },
      },
    });
    expect(w.find('[data-testid="story2video-stage-detail-compose"]').exists()).toBe(false);
    expect(w.find('[data-testid="story2video-stage-compose-progress"]').exists()).toBe(false);
    w.unmount();
  });

  it("optimize 运行中：旧快照降级展示 optimize_progress（不再等完成）", () => {
    const w = mountWith({
      stages: [makeStage({ name: "optimize", status: "running", startedAt: new Date().toISOString() })],
      orchestrationContext: { optimize_progress: { done: 2, total: 5 } },
    });
    const item = w.find('[data-testid="story2video-stage-optimize"]');
    expect(item.find(".stage-detail").text()).toBe("共 5 个场景，已完成 2 个");
    w.unmount();
  });
});

describe("StageProgress 合成时间说明块（2026-08-17）", () => {
  it("showTimeGuidance=true 时渲染合成时间说明（标题/说明/三档参考/正常范围）", () => {
    const w = mountWith({ stages: [makeStage()], showTimeGuidance: true });
    const box = w.find('[data-testid="story2video-time-guidance"]');
    expect(box.exists()).toBe(true);
    expect(box.text()).toContain("合成时间说明");
    expect(box.text()).toContain("整体完成时间与视频时长有关");
    expect(box.text()).toContain("1 分钟视频：合成时长 5–8 分钟");
    expect(box.text()).toContain("3 分钟视频：合成时长 15–20 分钟");
    expect(box.text()).toContain("6 分钟视频：合成时长 35–45 分钟");
    expect(box.text()).toContain("以上合成时长均属正常范围。");
    w.unmount();
  });

  it("默认（非 story2video 场景）不渲染说明块", () => {
    const w = mountWith({ stages: [makeStage()] });
    expect(w.find('[data-testid="story2video-time-guidance"]').exists()).toBe(false);
    w.unmount();
  });

  it("英文界面渲染英文合成时间说明", () => {
    setAppLocale("en");
    const w = mountWith({ stages: [makeStage()], showTimeGuidance: true });
    const box = w.find('[data-testid="story2video-time-guidance"]');
    expect(box.exists()).toBe(true);
    expect(box.text()).toContain("About composition time");
    expect(box.text()).toContain("1-minute video: 5–8 min");
    expect(box.text()).toContain("The above composition times are all within the normal range.");
    w.unmount();
  });

  it("说明块不在 sticky 浮层内，而是阶段列表内随滚动条滚动的普通内容（2026-08-28）", () => {
    const w = mountWith({ stages: [makeStage()], showTimeGuidance: true });
    const box = w.find('[data-testid="story2video-time-guidance"]');
    expect(box.exists()).toBe(true);
    // 直接父级是滚动列表（story2video-stage-list），不是粘性头部（story2video-stage-sticky-header）
    expect(box.element.parentElement?.getAttribute('data-testid')).toBe('story2video-stage-list');
    expect(
      w.find('[data-testid="story2video-stage-sticky-header"]').findAll('[data-testid="story2video-time-guidance"]')
    ).toHaveLength(0);
    w.unmount();
  });
});

describe("活动阶段索引去重（vue/no-reserved-keys 回归，2026-09-14）", () => {
  // 回归：data 键原为 `_lastActiveStageIndex`，`_` 前缀是 Vue 保留前缀——
  // 实例代理上读不到该键，watch 去重恒失效（每次 stages 变化都重复 scrollToStage）。
  it("data 键不以 _ 开头且活动阶段索引可被实例读写", async () => {
    const w = mountWith({
      stages: [
        makeStage({ name: "split", status: "completed" }),
        makeStage({ name: "scene_context", status: "running" }),
      ],
    });
    // immediate watch + $nextTick 后应记录当前活动阶段索引（currentActiveStageIndex 优先取 running = 1）
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(w.vm.lastActiveStageIndex).toBe(1);
    w.unmount();
  });
});
