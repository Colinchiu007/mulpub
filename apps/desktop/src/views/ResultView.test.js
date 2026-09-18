import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import zh from "@/locales/zh";
import en from "@/locales/en";

vi.mock("@/api/publisher", () => ({
  story2videoExportZip: vi.fn(),
  story2videoCreateShareUrl: vi.fn(),
  story2videoCopyPath: vi.fn(),
  story2videoShowInFolder: vi.fn(),
  story2videoSaveAs: vi.fn(),
  story2videoGetProject: vi.fn(),
  story2videoImportMedia: vi.fn(),
  story2videoUpdateSegments: vi.fn(),
  story2videoReplaceSegmentAudio: vi.fn(),
  story2videoRetrySegment: vi.fn(),
  story2videoRecomposeProject: vi.fn(),
  story2videoSelectSceneMaterial: vi.fn(),
  story2videoGenerateSceneImage: vi.fn(),
  story2videoGenerateSceneVideo: vi.fn(),
  story2videoGenerateSceneAiVideo: vi.fn(),
  story2videoRegenerateSceneSubtitle: vi.fn(),
  story2videoRegenerateSceneAudio: vi.fn(),
  story2videoRegenerateScenePrompt: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelinePauseRun: vi.fn(),
  videoProcess: vi.fn(),
}));

vi.mock("@/api/tts-voice-catalog", () => ({
  getTtsVoiceCatalog: vi.fn(),
}));

const router = createRouter({ history: createWebHistory(), routes: [
  { path: "/", component: { template: "<div>root</div>" } },
  { path: "/create", name: "create", component: { template: "<div>create</div>" } },
  { path: "/create/result", name: "create-result", component: { template: "<div>result</div>" } },
  { path: "/publish", name: "publish", component: { template: "<div>publish</div>" } },
] });

import UiButton from "@/components/UiButton.vue";
import ResultView from "./ResultView.vue";

describe("ResultView", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  async function createView({ localizeSceneMaterial = false } = {}) {
    await router.push("/");
    const w = mount(ResultView, {
      global: {
        plugins: [router],
        components: { UiButton },
        mocks: {
          $t: (key, params) => {
            if (localizeSceneMaterial && key.startsWith("story2video.sceneMaterial.")) {
              const sceneKey = key.slice("story2video.sceneMaterial.".length);
              const localized = zh.story2video.sceneMaterial[sceneKey];
              if (typeof localized === "string") {
                return localized.replace(/\{label\}/g, params?.label || "");
              }
            }
            return params && params.label ? params.label : key;
          }
        }
      }
    });
    await nextTick();
    return w;
  }

  it("renders page title", async () => {
    const w = await createView();
    expect(w.text()).toContain("\u89c6\u9891\u9884\u89c8");
  });

  it("从路由 query 展示 BGM 跳过提示（bgmSkipped=1 + bgmReason）", async () => {
    await router.push({ path: "/create/result", query: { path: "C:/tmp/x.mp4", bgmSkipped: "1", bgmReason: "size_exceeded" } });
    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton } } });
    w.vm.loading = false;
    await nextTick();
    expect(w.vm.bgmSkippedNotice).toContain("背景音乐已跳过");
    expect(w.vm.bgmSkippedNotice).toContain("超过大小上限");
    expect(w.find('[data-testid="story2video-result-bgm-skipped-notice"]').exists()).toBe(true);
    w.unmount();
  });

  it("未带 bgmSkipped 时不显示 BGM 跳过提示", async () => {
    await router.push({ path: "/create/result", query: { path: "C:/tmp/x.mp4" } });
    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton } } });
    w.vm.loading = false;
    await nextTick();
    expect(w.vm.bgmSkippedNotice).toBe("");
    expect(w.find('[data-testid="story2video-result-bgm-skipped-notice"]').exists()).toBe(false);
    w.unmount();
  });

  it("从路由 query 展示完成汇总（时长 + 文件大小）", async () => {
    await router.push({ path: "/create/result", query: { path: "C:/tmp/x.mp4", durationMs: "125000", sizeBytes: "3145728" } });
    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton } } });
    w.vm.loading = false;
    w.vm.videoPath = "C:/tmp/x.mp4";
    w.vm.videoSrc = "file:///C:/tmp/x.mp4";
    await nextTick();
    expect(w.vm.completionSummary).toBe("\u5b8c\u6210\u65f6\u95f4\u5171 2 \u5206 5 \u79d2 \u00b7 \u6587\u4ef6\u5927\u5c0f 3.0 M");
    expect(w.find('[data-testid="completion-summary"]').exists()).toBe(true);
    w.unmount();
  });

  it("provides a back button that navigates to /create?view=history（返回历史记录）", async () => {
    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton }, mocks: { $t: (key) => (key === "create.story2video.backToHistory" ? "返回" : key) } } });
    const back = w.find('[data-testid="back-to-pipeline-list"]');
    expect(back.exists()).toBe(true);
    expect(back.text()).toContain("返回");
    await back.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(router.currentRoute.value.path).toBe("/create");
    expect(router.currentRoute.value.query.view).toBe("history");
  });

  it("running editor shows pause and sends the exact runId, then refreshes to paused", async () => {
    const api = await import("@/api/publisher");
    api.pipelineGetRunContext
      .mockResolvedValueOnce({ code: 0, data: { status: { status: "running" } } })
      .mockResolvedValueOnce({ code: 0, data: { status: { status: "paused" } } });
    api.pipelinePauseRun.mockResolvedValue({ code: 0, data: { status: "paused" } });
    await router.push({ path: "/create/result", query: { runId: "run-editor-42" } });
    const w = mount(ResultView, {
      global: {
        plugins: [router],
        components: { UiButton },
        mocks: { $t: (key) => key },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    const pause = w.find('[data-testid="result-pause-pipeline"]');
    expect(w.vm.loading).toBe(false);
    expect(pause.exists()).toBe(true);
    await pause.trigger("click");
    await nextTick();

    expect(api.pipelinePauseRun).toHaveBeenCalledWith("run-editor-42");
    expect(w.vm.pipelineRunStatus).toBe("paused");
    expect(w.find('[data-testid="result-pause-pipeline"]').exists()).toBe(false);
    w.unmount();
  });

  it("does not show pause for paused, completed, missing, or invalid run IDs", async () => {
    const api = await import("@/api/publisher");
    const cases = [
      { query: { runId: "run-paused" }, status: "paused" },
      { query: { runId: "run-completed" }, status: "completed" },
      { query: {}, status: null },
      { query: { runId: "x".repeat(257) }, status: "running" },
      { query: { runId: ["run-array"] }, status: "running" },
    ];

    for (const testCase of cases) {
      api.pipelineGetRunContext.mockReset();
      api.pipelineGetRunContext.mockResolvedValue({
        code: 0,
        data: testCase.status ? { status: { status: testCase.status } } : null,
      });
      await router.push({ path: "/create/result", query: testCase.query });
      const w = mount(ResultView, {
        global: { plugins: [router], components: { UiButton }, mocks: { $t: (key) => key } },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
      expect(w.find('[data-testid="result-pause-pipeline"]').exists()).toBe(false);
      if (testCase.query.runId && typeof testCase.query.runId === "string" && testCase.query.runId.length <= 256) {
        expect(api.pipelineGetRunContext).toHaveBeenCalledWith(testCase.query.runId);
      } else {
        expect(api.pipelineGetRunContext).not.toHaveBeenCalled();
      }
      w.unmount();
    }
  });

  it("failed pause keeps the running state and reports the operation failure", async () => {
    const api = await import("@/api/publisher");
    api.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "running" } } });
    api.pipelinePauseRun.mockResolvedValue({ code: -1, message: "pause unavailable" });
    await router.push({ path: "/create/result", query: { runId: "run-pause-failed" } });
    const w = mount(ResultView, {
      global: {
        plugins: [router],
        components: { UiButton },
        mocks: { $t: (key) => key },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    await w.find('[data-testid="result-pause-pipeline"]').trigger("click");
    await nextTick();

    expect(api.pipelinePauseRun).toHaveBeenCalledWith("run-pause-failed");
    expect(w.vm.pipelineRunStatus).toBe("running");
    expect(w.vm.story2videoNotificationDialog.visible).toBe(true);
    expect(w.find('[data-testid="result-pause-pipeline"]').exists()).toBe(true);
    w.unmount();
  });

  it("shows empty state when no video path", async () => {
    const w = await createView();
    expect(w.text()).toContain("\u6ca1\u6709\u53ef\u9884\u89c8\u7684\u89c6\u9891");
  });

  it("loads video path and shows video player", async () => {
    const w = await createView();
    w.vm.videoPath = "/videos/test.mp4";
    w.vm.videoSrc = "file:///videos/test.mp4";
    await nextTick();
    const video = w.find("video");
    expect(video.exists()).toBe(true);
    expect(w.vm.loading).toBe(false);
  });

  it("非 en 界面展示分段提示词的只读本地翻译（promptTranslation）", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [
      { id: "s1", text: "旁白一", prompt: "A red apple", promptTranslation: "一个红苹果", imagePath: null, audioPath: null, status: "completed" },
      { id: "s2", text: "旁白二", prompt: "A blue sky", promptTranslation: null, imagePath: null, audioPath: null, status: "completed" },
    ];
    await nextTick();
    const blocks = w.findAll('[data-testid="segment-prompt-translation"]');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text()).toContain("一个红苹果");
    expect(blocks[1].text()).toContain("story2video.sceneMaterial.emptySlot");
  });

  it("分段状态徽标使用本地化标签而非英文原值，failed 分段内联展示可读原因（2026-08-16）", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [
      {
        id: "s1", text: "旁白一", imagePath: null, audioPath: null, status: "failed",
        error: "UnsupportedParamsError: Setting response_format is not supported by provider agnes-t2i-general-model",
      },
      { id: "s2", text: "旁白二", imagePath: null, audioPath: null, status: "completed" },
    ];
    await nextTick();
    const badges = w.findAll(".segment-status");
    expect(badges).toHaveLength(2);
    expect(badges[0].text()).toBe("story2video.segmentStatus.failed");
    expect(badges[1].text()).toBe("story2video.segmentStatus.completed");
    const reasons = w.findAll('[data-testid="segment-status-reason"]');
    expect(reasons).toHaveLength(1);
    expect(reasons[0].text()).toContain("模型账号不支持当前生成设置");
    w.unmount();
  });

  it("兼容旧项目顶层 altVideoPath 并用于视频 2 素材槽", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockImplementation(async (filePath) => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.segments = [{
      id: "legacy-alt-video",
      altVideoPath: "C:/videos/legacy-alt.mp4",
      imagePath: null,
      audioPath: null,
    }];

    await w.vm.refreshSceneMaterialUrls();

    expect(api.story2videoCreateShareUrl).toHaveBeenCalledWith("C:/videos/legacy-alt.mp4", undefined);
    expect(w.vm.sceneMaterialSlots(w.vm.segments[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "video2", path: "C:/videos/legacy-alt.mp4", url: "media://C:/videos/legacy-alt.mp4" }),
    ]));
    w.unmount();
  });

  it("素材预览加载失败时让渲染槽位不可选并保留来源路径", async () => {
    const w = await createView();
    w.vm.segments = [{
      id: "broken-media",
      imagePath: "C:/images/broken.png",
      videoPath: "C:/videos/broken.mp4",
      videoMeta: { sceneVideoPath: "C:/videos/broken.mp4" },
      imageUrl: "media://broken.png",
      videoUrl: "media://broken.mp4",
    }];
    w.vm.clearSceneMaterialUrl(w.vm.segments[0], "image1");
    expect(w.vm.segments[0].imagePath).toBe("C:/images/broken.png");
    expect(w.vm.segments[0].imageUrl).toBeNull();
    expect(w.vm.sceneMaterialSlots(w.vm.segments[0]).find(slot => slot.kind === "image1").path).toBeNull();
    w.vm.clearSceneMaterialUrl(w.vm.segments[0], "video1");
    expect(w.vm.segments[0].videoPath).toBe("C:/videos/broken.mp4");
    expect(w.vm.segments[0].videoMeta.sceneVideoPath).toBe("C:/videos/broken.mp4");
    expect(w.vm.segments[0].videoUrl).toBeNull();
    expect(w.vm.sceneMaterialSlots(w.vm.segments[0]).find(slot => slot.kind === "video1").path).toBeNull();
    expect(w.vm.segmentsDirty).toBe(false);
    w.unmount();
  });

  it("没有完整旁白时保留占位并禁用下载按钮", async () => {
    const w = await createView();
    w.vm.projectId = "project-without-narration";
    w.vm.audioPath = null;
    w.vm.audioSrc = null;
    await nextTick();
    expect(w.find('[data-testid="narration-placeholder"]').exists()).toBe(true);
    expect(w.find('[data-testid="download-narration-button"]').attributes("disabled")).toBeDefined();
    w.unmount();
  });

  it("completed 分段残留 error 时只显示完成标签，不渲染失败原因（2026-08-16）", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [
      { id: "s1", text: "旁白一", imagePath: null, audioPath: null, status: "completed", error: "余额不足" },
    ];
    await nextTick();
    expect(w.find(".segment-status").text()).toBe("story2video.segmentStatus.completed");
    expect(w.find('[data-testid="segment-status-reason"]').exists()).toBe(false);
    w.unmount();
  });

  it("failed 分段 error 未命中任何类别时回退通用失败文案且不暴露原始错误（2026-08-16）", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [
      { id: "s1", text: "旁白一", imagePath: null, audioPath: null, status: "failed", error: "weird internal error 0xDEAD at Object.xyz" },
    ];
    await nextTick();
    const reason = w.find('[data-testid="segment-status-reason"]');
    expect(reason.exists()).toBe(true);
    expect(reason.text()).toContain("未能完成");
    expect(reason.text()).not.toContain("Object.xyz");
    w.unmount();
  });

  it("handleError shows a localized modal", async () => {
    const w = await createView();
    w.vm.handleError();
    expect(w.vm.story2videoNotificationDialog).toEqual({
      visible: true,
      messageKey: "story2video.videoPreviewFailed",
      messageParams: {},
    });
  });

  it("主视频 error 首次触发时自愈：重签同一路径的新 URL 并透传旧地址以便回收令牌", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "media:///videos/refreshed.mp4" } });
    const w = await createView();
    w.vm.videoPath = "C:/videos/test.mp4";
    w.vm.videoSrc = "media:///videos/old.mp4";

    await w.vm.handleError();

    expect(api.story2videoCreateShareUrl).toHaveBeenCalledWith("C:/videos/test.mp4", "media:///videos/old.mp4");
    expect(w.vm.videoSrc).toBe("media:///videos/refreshed.mp4");
    expect(w.vm.videoReloadAttempted).toBe(true);
    expect(w.vm.story2videoNotificationDialog.visible).toBe(false);
    w.unmount();
  });

  it("主视频 error 自愈后再次失败才弹出预览失败提示", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "media:///videos/refreshed.mp4" } });
    const w = await createView();
    w.vm.videoPath = "C:/videos/test.mp4";
    w.vm.videoSrc = "media:///videos/old.mp4";

    await w.vm.handleError();
    await w.vm.handleError();

    expect(w.vm.story2videoNotificationDialog).toEqual({
      visible: true,
      messageKey: "story2video.videoPreviewFailed",
      messageParams: {},
    });
    w.unmount();
  });

  it("主视频 error 重签 URL 失败时直接弹出预览失败且不标记已自愈", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 1, message: "video unavailable" });
    const w = await createView();
    w.vm.videoPath = "C:/videos/test.mp4";
    w.vm.videoSrc = "media:///videos/old.mp4";

    await w.vm.handleError();

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.videoPreviewFailed");
    expect(w.vm.videoReloadAttempted).toBe(false);
    w.unmount();
  });

  it("loadVideoPath 重新加载成功后重置自愈标记并透传旧地址", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///videos/reloaded.mp4" } });
    const w = await createView();
    w.vm.videoPath = "C:/videos/other.mp4";
    w.vm.videoSrc = "media:///videos/old.mp4";
    w.vm.videoReloadAttempted = true;

    await w.vm.loadVideoPath("C:/videos/test.mp4");

    expect(api.story2videoCreateShareUrl).toHaveBeenCalledWith("C:/videos/test.mp4", "media:///videos/old.mp4");
    expect(w.vm.videoReloadAttempted).toBe(false);
    w.unmount();
  });

  it("refreshSegmentImageUrls 重签分段图时透传旧 imageUrl 以便回收令牌", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "media:///segments/new.png" } });
    const w = await createView();
    w.vm.segments = [{ id: "s1", imagePath: "C:/segments/old.png", imageUrl: "media:///segments/old.png" }];

    await w.vm.refreshSegmentImageUrls();

    expect(api.story2videoCreateShareUrl).toHaveBeenCalledWith("C:/segments/old.png", "media:///segments/old.png");
    expect(w.vm.segments[0].imageUrl).toBe("media:///segments/new.png");
    w.unmount();
  });

  it("主视频 URL 解析失败时显示预览缺失，而不是任务级失败", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 1, message: "video unavailable" });
    const w = await createView();

    await w.vm.loadVideoPath("C:/videos/missing.mp4");

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.preview_missing");
  });

  it("download 通过主进程保存对话框保存文件，不再用 <a download> 触发", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoSaveAs.mockResolvedValue({ code: 0, data: { path: "C:/saved/test.mp4" } });
    const w = await createView();
    w.vm.videoPath = "/videos/test.mp4";

    const createElementSpy = vi.spyOn(document, "createElement");
    await w.vm.download();

    expect(mocks.story2videoSaveAs).toHaveBeenCalledWith("/videos/test.mp4", expect.stringMatching(/^video_\d+\.mp4$/));
    // 不再创建 <a> 下载链接（跨源/本地 HTTP 媒体 URL 下载会静默失败）
    expect(createElementSpy.mock.calls.filter(c => c[0] === "a")).toHaveLength(0);
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.save_completed");
    createElementSpy.mockRestore();
    w.unmount();
  });

  it("download 保存被取消时不提示成功，也不抛错", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoSaveAs.mockResolvedValue({ code: 0, data: { cancelled: true } });
    const w = await createView();
    w.vm.videoPath = "/videos/test.mp4";

    await w.vm.download();
    expect(mocks.story2videoSaveAs).toHaveBeenCalledTimes(1);
    expect(w.vm.story2videoNotificationDialog.visible).toBe(false);
    w.unmount();
  });

  it("download does nothing without videoPath", async () => {
    const w = await createView();
    w.vm.videoPath = null;
    // Should not throw and should return early
    expect(() => w.vm.download()).not.toThrow();
  });

  it("does not render a page-level error banner", async () => {
    const w = await createView();
    w.vm.handleError();
    await nextTick();
    expect(w.find(".error-banner").exists()).toBe(false);
    expect(w.find(".result-message").exists()).toBe(false);
  });

  it("shows download and navigate buttons when video loaded", async () => {
    const w = await createView();
    w.vm.videoPath = "/videos/test.mp4";
    w.vm.videoSrc = "file:///videos/test.mp4";
    await nextTick();
    expect(w.text()).toContain("\u4e0b\u8f7d\u89c6\u9891");
    expect(w.text()).toContain("\u53bb\u53d1\u5e03");
  });

  it("安全加载主进程返回的本地视频地址", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///videos/test.mp4" } });
    const w = await createView();

    await w.vm.loadVideoPath("C:/videos/test.mp4");

    expect(api.story2videoCreateShareUrl).toHaveBeenCalledWith("C:/videos/test.mp4", null);
    expect(w.vm.videoSrc).toBe("file:///videos/test.mp4");
  });

  it("可导出 ZIP、复制本地路径并打开所在文件夹", async () => {
    const api = await import("@/api/publisher");
    api.story2videoExportZip.mockResolvedValue({ code: 0, data: { path: "C:/videos/export.zip" } });
    api.story2videoCopyPath.mockResolvedValue({ code: 0, data: { path: "C:/videos/test.mp4" } });
    api.story2videoShowInFolder.mockResolvedValue({ code: 0, data: { path: "C:/videos/test.mp4" } });
    const w = await createView();
    w.vm.videoPath = "C:/videos/test.mp4";

    await w.vm.exportZip();
    await w.vm.copyLocalPath();
    await w.vm.showInFolder();

    expect(api.story2videoExportZip).toHaveBeenCalledWith([
      { path: "C:/videos/test.mp4", name: "test.mp4" },
    ]);
    expect(api.story2videoCopyPath).toHaveBeenCalledWith("C:/videos/test.mp4");
    expect(api.story2videoShowInFolder).toHaveBeenCalledWith("C:/videos/test.mp4");
    expect(w.vm.story2videoNotificationDialog).toEqual({
      visible: true,
      messageKey: "story2video.path_copied",
      messageParams: {},
    });
  });

  it("持久化项目导出 ZIP 时包含成片、完整旁白和所有分段产物", async () => {
    const api = await import("@/api/publisher");
    api.story2videoExportZip.mockResolvedValue({ code: 0, data: { path: "C:/videos/project.zip" } });
    const w = await createView();
    w.vm.videoPath = "C:/project/video.mp4";
    w.vm.audioPath = "C:/project/narration.m4a";
    w.vm.segments = [{
      id: "segment-0",
      imagePath: "C:/project/image.png",
      audioPath: "C:/project/audio.mp3",
      videoPath: "C:/project/segment.mp4",
    }];

    await w.vm.exportZip();

    expect(api.story2videoExportZip).toHaveBeenCalledWith([
      { path: "C:/project/video.mp4", name: "video.mp4" },
      { path: "C:/project/narration.m4a", name: "narration.m4a" },
      { path: "C:/project/image.png", name: "segment-001-image.png" },
      { path: "C:/project/audio.mp3", name: "segment-001-audio.mp3" },
      { path: "C:/project/segment.mp4", name: "segment-001-video.mp4" },
    ]);
  });

  it("加载持久化项目并展示可编辑分段和完整旁白", async () => {
    const api = await import("@/api/publisher");
    api.story2videoGetProject.mockResolvedValue({ code: 0, data: {
      projectId: "project-1",
      videoPath: "C:/projects/project-1/video.mp4",
      audioPath: "C:/projects/project-1/narration.m4a",
      segments: [
        { id: "segment-0", index: 0, text: "第一段", prompt: "画面一", audioPath: "C:/projects/project-1/audio-0.mp3" },
        { id: "segment-1", index: 1, text: "第二段", prompt: "画面二", audioPath: "C:/projects/project-1/audio-1.mp3" },
      ],
    } });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "file:///" + filePath } }));
    const w = await createView();

    await w.vm.loadProject("project-1");
    await nextTick();

    expect(w.findAll(".segment-item textarea")[0].element.value).toBe("第一段");
    expect(w.text()).toContain("完整旁白");
    expect(w.findAll(".segment-item")).toHaveLength(2);
    expect(w.vm.audioSrc).toContain("narration.m4a");
  });

  it("旁白 URL 解析失败不清空已加载项目和成片", async () => {
    const api = await import("@/api/publisher");
    api.story2videoGetProject.mockResolvedValue({ code: 0, data: {
      projectId: "project-audio-degraded",
      videoPath: "C:/projects/project-audio-degraded/video.mp4",
      audioPath: "C:/projects/project-audio-degraded/narration.m4a",
      segments: [],
    } });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => (
      filePath.endsWith("narration.m4a")
        ? { code: 1, message: "narration unavailable" }
        : { code: 0, data: { url: "file:///" + filePath } }
    ));
    const w = await createView();

    await w.vm.loadProject("project-audio-degraded");

    expect(w.vm.projectId).toBe("project-audio-degraded");
    expect(w.vm.project).toBeTruthy();
    expect(w.vm.videoSrc).toContain("video.mp4");
    expect(w.vm.audioSrc).toBeNull();
    expect(w.vm.story2videoNotificationDialog.visible).toBe(false);
  });

  it("场景素材 URL 解析失败不影响成片与项目", async () => {
    const api = await import("@/api/publisher");
    api.story2videoGetProject.mockResolvedValue({ code: 0, data: {
      projectId: "project-scene-degraded",
      videoPath: "C:/projects/project-scene-degraded/video.mp4",
      segments: [{ id: "segment-0", imagePath: "C:/projects/project-scene-degraded/image.png" }],
    } });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => (
      filePath.endsWith("image.png")
        ? { code: 1, message: "scene unavailable" }
        : { code: 0, data: { url: "file:///" + filePath } }
    ));
    const w = await createView();

    await w.vm.loadProject("project-scene-degraded");

    expect(w.vm.projectId).toBe("project-scene-degraded");
    expect(w.vm.videoSrc).toContain("video.mp4");
    expect(w.vm.segments[0].imageUrl).toBeNull();
    expect(w.vm.story2videoNotificationDialog.visible).toBe(false);
  });

  it("分段可重排、保存、单图重试和重新合成", async () => {
    const api = await import("@/api/publisher");
    api.story2videoUpdateSegments.mockResolvedValue({ code: 0, data: { projectId: "project-1", dirty: true, segments: [] } });
    api.story2videoRetrySegment.mockResolvedValue({ code: 0, data: { projectId: "project-1", segments: [] } });
    api.story2videoRecomposeProject.mockResolvedValue({ code: 0, data: { projectId: "project-1", videoPath: "C:/new.mp4", segments: [] } });
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [
      { id: "segment-0", text: "A", prompt: "PA" },
      { id: "segment-1", text: "B", prompt: "PB" },
    ];

    w.vm.moveSegment(1, -1);
    await w.vm.saveSegments();
    await w.vm.retrySegment("segment-1", "image");
    await w.vm.recomposeProject();

    expect(w.vm.segments[0].id).toBe("segment-1");
    expect(api.story2videoUpdateSegments).toHaveBeenCalledWith("project-1", [
      expect.objectContaining({ id: "segment-1" }),
      expect.objectContaining({ id: "segment-0" }),
    ]);
    expect(api.story2videoRetrySegment).toHaveBeenCalledWith("project-1", "segment-1", "image");
    expect(api.story2videoRecomposeProject).toHaveBeenCalledWith("project-1");
  });

  it("重试图片成功后重新解析新图片 URL（防止显示旧图/空白）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRetrySegment.mockResolvedValue({
      code: 0,
      data: { projectId: "project-1", segments: [{ id: "segment-1", imagePath: "C:/project/segment-1-new.png" }] },
    });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-1", imagePath: "C:/project/segment-1-old.png" }];

    await w.vm.retrySegment("segment-1", "image");

    expect(api.story2videoRetrySegment).toHaveBeenCalledWith("project-1", "segment-1", "image");
    // 重试返回的新 imagePath 必须被解析为新的 media URL（回归：旧实现未刷新导致图片不显示）
    expect(w.vm.segments[0].imagePath).toBe("C:/project/segment-1-new.png");
    expect(w.vm.segments[0].imageUrl).toContain("segment-1-new.png");
  });

  it("重试图片失败时透传真实原因并归一化为具体提示（余额不足 → quota 文案）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRetrySegment.mockResolvedValue({ code: -1, message: "余额不足" });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-1", imagePath: "C:/project/segment-1-old.png" }];

    await w.vm.retrySegment("segment-1", "image");

    expect(api.story2videoRetrySegment).toHaveBeenCalledWith("project-1", "segment-1", "image");
    // 错误文本必须进入通知归一化，而不是被吞成固定 operation_failed
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.quota_exceeded");
  });

  it("重试图片失败但错误文本未命中任何已知类别时回退通用文案（不展示 raw 文本）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRetrySegment.mockResolvedValue({ code: -1, message: "未知异常" });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-1", imagePath: "C:/project/segment-1-old.png" }];

    await w.vm.retrySegment("segment-1", "image");

    // 未映射类别：messageKey 落到 operation_failed 兜底（spec：回退通用文案），raw 文本不进入弹窗
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.operation_failed");
    expect(w.vm.story2videoNotificationDialog.messageParams).not.toEqual(expect.objectContaining({ rawError: expect.anything() }));
  });

  it("重试图片失败且命中内容安全审查类别时显示具体提示（needs_user_input）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRetrySegment.mockResolvedValue({ code: -1, message: "Image generation requires user input after content-policy review" });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-1", imagePath: "C:/project/segment-1-old.png" }];

    await w.vm.retrySegment("segment-1", "image");

    // 真实 provider 错误文本必须进入归一化并映射到 content_policy 具体提示
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.needs_user_input");
  });

  it("重试图片失败且多次空结果时显示具体提示（empty_result），而非通用失败文案（2026-08-16 复审补强）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRetrySegment.mockResolvedValue({ code: -1, message: "Image generation repeatedly returned no result (service fluctuation or account issue); adjust the scene prompt and retry, or check the provider account" });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-1", imagePath: "C:/project/segment-1-old.png" }];

    await w.vm.retrySegment("segment-1", "image");

    // 空结果原因必须到达用户：映射为 empty_result 具体提示，而不是 operation_failed 通用文案
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.empty_result");
    expect(w.vm.story2videoNotificationDialog.messageParams).toEqual({ context: "", provider: "当前" });
  });

  it("重试图片失败且 API Key 无效/已过期时显示具体提示（api_key_invalid）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRetrySegment.mockResolvedValue({ code: -1, message: "Image provider \"minimax-multimodal\" failed: Invalid api key" });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-1", imagePath: "C:/project/segment-1-old.png" }];

    await w.vm.retrySegment("segment-1", "image");

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.api_key_invalid");
  });

  it("重试图片失败且 MiniMax 额度用尽时显示额度提示（quota）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRetrySegment.mockResolvedValue({ code: -1, message: "Image provider \"minimax-multimodal\" failed: 已达到 Token Plan 用量上限" });
    api.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-1", imagePath: "C:/project/segment-1-old.png" }];

    await w.vm.retrySegment("segment-1", "image");

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.quota_exceeded");
  });

  it("可导入新旁白并原子替换指定分段音频", async () => {
    const api = await import("@/api/publisher");
    api.story2videoImportMedia.mockResolvedValue({ code: 0, data: { path: "C:/controlled/replacement.mp3" } });
    api.story2videoReplaceSegmentAudio.mockResolvedValue({ code: 0, data: {
      projectId: "project-1", dirty: true,
      segments: [{ id: "segment-0", audioPath: "C:/project/segment-0-replacement.mp3" }],
    } });
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-0", audioPath: "C:/project/old.mp3" }];
    const file = new File(["voice"], "replacement.mp3", { type: "audio/mpeg" });
    const event = { target: { files: [file], value: "replacement.mp3" } };

    await w.vm.replaceSegmentAudio("segment-0", event);

    expect(api.story2videoImportMedia).toHaveBeenCalledWith(file, "audio");
    expect(api.story2videoReplaceSegmentAudio).toHaveBeenCalledWith(
      "project-1", "segment-0", "C:/controlled/replacement.mp3"
    );
    expect(w.vm.segments[0].audioPath).toContain("replacement.mp3");
    expect(event.target.value).toBe("");
  });

  it("通过真实视频处理通道导出裁剪片段", async () => {
    const api = await import("@/api/publisher");
    api.videoProcess.mockResolvedValue({ code: 0, data: { success: true, output: "C:/project/video_trim.mp4" } });
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///project/video_trim.mp4" } });
    const w = await createView();
    w.vm.videoPath = "C:/project/video.mp4";
    w.vm.trimStart = 1;
    w.vm.trimEnd = 3;

    await w.vm.trimVideo();

    expect(api.videoProcess).toHaveBeenCalledWith("trim", expect.objectContaining({
      input_path: "C:/project/video.mp4", start_seconds: 1, end_seconds: 3, codec: "libx264",
    }));
    expect(w.vm.trimmedPath).toBe("C:/project/video_trim.mp4");
    expect(w.vm.trimmedSrc).toBe("file:///project/video_trim.mp4");
  });

  it("使用双范围控件调整裁剪边界并定位预览", async () => {
    const w = await createView();
    w.vm.videoPath = "C:/project/video.mp4";
    w.vm.videoSrc = "file:///project/video.mp4";
    w.vm.handleVideoMetadata({ target: { duration: 10.04 } });
    await nextTick();

    const startRange = w.find('[data-testid="trim-start-range"]');
    const endRange = w.find('[data-testid="trim-end-range"]');
    expect(startRange.exists()).toBe(true);
    expect(endRange.exists()).toBe(true);
    expect(startRange.attributes("aria-label")).toBe("裁剪开始时间");
    expect(endRange.attributes("aria-label")).toBe("裁剪结束时间");
    expect(w.vm.trimEnd).toBe(10.04);

    const player = w.find(".video-player").element;
    Object.defineProperty(player, "currentTime", { value: 0, writable: true });
    player.play = vi.fn(() => Promise.resolve());
    player.pause = vi.fn();

    await startRange.setValue("2.5");
    await endRange.setValue("7.5");
    expect(w.vm.trimStart).toBe(2.5);
    expect(w.vm.trimEnd).toBe(7.5);
    expect(player.currentTime).toBe(7.5);

    await w.vm.previewTrimRange();
    expect(player.currentTime).toBe(2.5);
    expect(player.play).toHaveBeenCalledOnce();
    player.currentTime = 7.5;
    w.vm.handleTrimPreviewProgress({ target: player });
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.currentTime).toBe(2.5);
  });

  it("将裁剪范围收敛到真实视频时长且始终保留最小间隔", async () => {
    const w = await createView();
    w.vm.videoPath = "C:/project/video.mp4";
    w.vm.handleVideoMetadata({ target: { duration: 3.03 } });

    w.vm.setTrimBoundary("start", 9);
    expect(w.vm.trimStart).toBeLessThan(w.vm.trimEnd);
    expect(w.vm.trimEnd).toBeLessThanOrEqual(3.03);

    w.vm.setTrimBoundary("end", -1);
    expect(w.vm.trimStart).toBeGreaterThanOrEqual(0);
    expect(w.vm.trimEnd - w.vm.trimStart).toBeGreaterThanOrEqual(0.099);
    expect(w.vm.canTrim).toBe(true);
  });

  it("结果页通过 project 查询参数自动恢复持久化项目", async () => {
    const api = await import("@/api/publisher");
    api.story2videoGetProject.mockResolvedValue({ code: 0, data: {
      projectId: "project-route", videoPath: "C:/route/video.mp4", segments: [],
    } });
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///route/video.mp4" } });
    await router.push({ path: "/", query: { project: "project-route" } });

    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton } } });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(api.story2videoGetProject).toHaveBeenCalledWith("project-route");
    expect(w.vm.projectId).toBe("project-route");
  });

  it("focusScenes 定位内容政策场景并渲染徽标，越界号码不渲染", async () => {
    const api = await import("@/api/publisher");
    const segments = Array.from({ length: 80 }, (_, i) => ({ id: "seg-" + i, text: "文案 " + (i + 1) }));
    api.story2videoGetProject.mockResolvedValue({ code: 0, data: { projectId: "project-focus", videoPath: "C:/focus/video.mp4", segments } });
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///focus/video.mp4" } });
    await router.push({ path: "/", query: { project: "project-focus", focusScenes: "49,73,74,999" } });

    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton }, mocks: { $t: (key) => key } } });
    await new Promise(resolve => setTimeout(resolve, 0));

    // 场景号 = 分段下标 + 1：49→segments[48]、73→[72]、74→[73]；999 越界不渲染
    expect(w.findAll('[data-testid="segment-policy-flag"]')).toHaveLength(3);
    const flagged = w.findAll(".segment-item").filter(item => item.classes().includes("segment-policy-flagged"));
    expect(flagged).toHaveLength(3);
    expect(flagged[0].find(".segment-header strong").text()).toBe("story2video.sceneMaterial.segmentTitle");
    expect(flagged[2].find(".segment-header strong").text()).toBe("story2video.sceneMaterial.segmentTitle");
    w.unmount();
  });

  it("focusScenes 非十进制形式安全忽略，仅十进制正整数生效", async () => {
    const api = await import("@/api/publisher");
    const segments = Array.from({ length: 3 }, (_, i) => ({ id: "seg-" + i, text: "文案 " + (i + 1) }));
    api.story2videoGetProject.mockResolvedValue({ code: 0, data: { projectId: "project-focus-strict", videoPath: "C:/focus/video.mp4", segments } });
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///focus/video.mp4" } });
    await router.push({ path: "/", query: { project: "project-focus-strict", focusScenes: "0x10,2,1e2,007" } });

    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton }, mocks: { $t: (key) => key } } });
    await new Promise(resolve => setTimeout(resolve, 0));

    // 仅十进制正整数生效：2→segments[1]；0x10/1e2/007 忽略
    expect(w.findAll('[data-testid="segment-policy-flag"]')).toHaveLength(1);
    expect(w.findAll(".segment-policy-flagged")).toHaveLength(1);
    expect(w.findAll(".segment-item")[1].find(".segment-header strong").text()).toBe("story2video.sceneMaterial.segmentTitle");
    w.unmount();
  });

  it("无 focusScenes 时不渲染政策徽标", async () => {
    const api = await import("@/api/publisher");
    api.story2videoGetProject.mockResolvedValue({ code: 0, data: { projectId: "project-x", videoPath: "C:/x/video.mp4", segments: [{ id: "s1", text: "a" }] } });
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///x/video.mp4" } });
    await router.push({ path: "/", query: { project: "project-x" } });

    const w = mount(ResultView, { global: { plugins: [router], components: { UiButton }, mocks: { $t: (key) => key } } });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(w.findAll('[data-testid="segment-policy-flag"]')).toHaveLength(0);
    w.unmount();
  });

  it("重新合成后无法解析成片 URL 时显示预览缺失提示", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRecomposeProject.mockResolvedValue({ code: 0, data: {
      projectId: "project-1", videoPath: "C:/project/recomposed.mp4", segments: [],
    } });
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 1, message: "private provider error" });
    const w = await createView();
    w.vm.projectId = "project-1";

    await w.vm.recomposeProject();

    expect(w.vm.story2videoNotificationDialog).toEqual({
      visible: true,
      messageKey: "story2video.preview_missing",
      messageParams: {},
    });
    expect(w.vm.story2videoNotificationDialog.messageKey).not.toBe("story2video.project_recomposed");
  });

  it("重新合成缺少视频路径时显示预览缺失提示", async () => {
    const api = await import("@/api/publisher");
    api.story2videoRecomposeProject.mockResolvedValue({ code: 0, data: {
      projectId: "project-1", segments: [],
    } });
    const w = await createView();
    w.vm.projectId = "project-1";

    await w.vm.recomposeProject();

    expect(w.vm.story2videoNotificationDialog).toEqual({
      visible: true,
      messageKey: "story2video.preview_missing",
      messageParams: {},
    });
  });

  it("桥接调用拒绝时也显示本地化操作失败提示", async () => {
    const api = await import("@/api/publisher");
    api.story2videoExportZip.mockRejectedValue(new Error("C:/private/path"));
    const w = await createView();
    w.vm.videoPath = "C:/videos/test.mp4";

    await w.vm.exportZip();

    expect(w.vm.story2videoNotificationDialog).toEqual({
      visible: true,
      messageKey: "story2video.operation_failed",
      messageParams: {},
    });
  });

  it("项目含离线降级素材时使用本地化弹窗，而不是页面警告条", async () => {
    const w = await createView();
    w.vm.projectId = "project-degraded";
    w.vm.videoPath = "C:/project/video.mp4";
    w.vm.segments = [{
      id: "segment-0",
      imageMeta: { source: "ffmpeg-placeholder", degraded: true },
      audioMeta: { source: "edge-tts", degraded: false },
    }];
    w.vm.maybeShowDegradedAssetsWarning();
    await nextTick();

    expect(w.find(".asset-warning").exists()).toBe(false);
    expect(w.vm.story2videoNotificationDialog).toEqual({
      visible: true,
      messageKey: "story2video.degraded_assets_warning",
      messageParams: { kinds: "占位图片" },
    });
    w.unmount();
  });

  it("视频任务编辑页渲染固定 4 个视觉素材槽位并展示选中态", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{
      id: "s1",
      imagePath: "C:/img1.png",
      alternateImages: [{ path: "C:/img2.png" }],
      videoPath: "C:/v.mp4",
      videoMeta: { sceneVideoPath: "C:/v.mp4", altSceneVideoPath: "C:/v2.mp4" },
      selectedMaterial: "image2",
      status: "completed",
    }];
    await nextTick();
    const section = w.find('[data-testid="scene-material-section"]');
    expect(section.exists()).toBe(true);
    const slots = section.findAll(".scene-material-slot");
    expect(slots).toHaveLength(4);
    expect(slots.map(slot => slot.attributes("data-testid"))).toEqual([
      "scene-material-slot-image1",
      "scene-material-slot-image2",
      "scene-material-slot-video1",
      "scene-material-slot-video2",
    ]);
    expect(slots[0].attributes("aria-pressed")).toBe("false");
    expect(slots[1].attributes("aria-pressed")).toBe("true");
    expect(slots[2].attributes("aria-pressed")).toBe("false");
    expect(slots[3].attributes("aria-pressed")).toBe("false");
    expect(slots[0].find(".scene-material-radio").attributes("checked")).toBeUndefined();
    expect(slots[1].find(".scene-material-radio").attributes("checked")).toBeDefined();
    expect(slots[2].find(".scene-material-radio").attributes("checked")).toBeUndefined();
    expect(slots[3].find(".scene-material-radio").attributes("checked")).toBeUndefined();
    expect(slots[2].find(".scene-material-radio").attributes("disabled")).toBeUndefined();
    expect(slots[3].find(".scene-material-radio").attributes("disabled")).toBeUndefined();
    expect(section.find(".scene-material-badge").exists()).toBe(true);
    expect(slots[0].element.firstElementChild.tagName).toBe("BUTTON");
    expect(slots[0].element.children[1].className).toContain("scene-material-choice");
    w.unmount();
  });

  it("点击缩略图只打开预览，不调用 select IPC；radio 才能选择", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoSelectSceneMaterial.mockResolvedValue({
      code: 0,
      data: {
        projectId: "p1",
        segments: [{ id: "s1", imagePath: "C:/img1.png", videoPath: "C:/v.mp4", selectedMaterial: "video", status: "completed" }],
      },
    });
    mocks.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "media://preview" } });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{
      id: "s1", imagePath: "C:/img1.png", imageUrl: "media://img1", videoPath: "C:/v.mp4", videoUrl: "media://video", videoMeta: { sceneVideoPath: "C:/v.mp4", altSceneVideoPath: "C:/v2.mp4" }, selectedMaterial: "image1", status: "completed",
    }];
    await nextTick();
    const section = w.find('[data-testid="scene-material-section"]');
    await section.find('[data-testid="scene-material-slot-video1"] .scene-material-thumb').trigger("click");
    expect(mocks.story2videoSelectSceneMaterial).not.toHaveBeenCalled();
    expect(w.vm.sceneMaterialPreview.visible).toBe(true);
    expect(w.vm.sceneMaterialPreview.kind).toBe("video1");
    expect(w.findAllComponents({ name: "UiModal" }).find(modal => modal.props("title") === "story2video.sceneMaterial.previewVideoTitle").props("size")).toBe("xl");

    await section.find('[data-testid="scene-material-slot-video1"] .scene-material-radio').setValue(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.story2videoSelectSceneMaterial).toHaveBeenCalledWith("p1", "s1", "video");
    w.unmount();
  });

  it("持久化 video 只在 canonical video1 卡显示当前使用，video2 不重复徽标", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{
      id: "s1",
      videoPath: "C:/v1.mp4",
      videoUrl: "media://v1",
      videoMeta: { sceneVideoPath: "C:/v1.mp4", altSceneVideoPath: "C:/v2.mp4" },
      altVideoUrl: "media://v2",
      selectedMaterial: "video",
      status: "completed",
    }];
    await nextTick();
    const section = w.find('[data-testid="scene-material-section"]');
    expect(section.find('[data-testid="scene-material-slot-video1"] .scene-material-radio').attributes("checked")).toBeDefined();
    expect(section.find('[data-testid="scene-material-slot-video2"] .scene-material-radio').attributes("checked")).toBeUndefined();
    expect(section.find('[data-testid="scene-material-slot-video1"] .scene-material-badge').exists()).toBe(true);
    expect(section.find('[data-testid="scene-material-slot-video2"] .scene-material-badge').exists()).toBe(false);
    w.unmount();
  });

  it("生成新图/生成 AI 视频按钮出现在所有图片/视频卡内，并在 busy 时禁用", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    await nextTick();
    const section = w.find('[data-testid="scene-material-section"]');
    const buttons = section.findAll(".scene-material-slot-action button");
    expect(buttons).toHaveLength(4);
    expect(section.find('[data-testid="scene-material-slot-image1"] [data-testid="generate-image-button"]').exists()).toBe(true);
    expect(section.find('[data-testid="scene-material-slot-image2"] [data-testid="generate-image-button"]').exists()).toBe(true);
    expect(section.find('[data-testid="scene-material-slot-video1"] [data-testid="generate-ai-video-button"]').exists()).toBe(true);
    expect(section.find('[data-testid="scene-material-slot-video2"] [data-testid="generate-ai-video-button"]').exists()).toBe(true);
    w.vm.segmentBusy = { s1: "genImage" };
    await nextTick();
    expect(buttons.every(button => button.attributes("disabled") !== undefined)).toBe(true);
    expect(section.find('[data-testid="scene-material-slot-image1"] [data-testid="generate-image-button"]').text()).toContain("story2video.sceneMaterial.generating");
    w.unmount();
  });

  it("空素材保持四格背景与固定缩略图，并只显示本地化未生成文案", async () => {
    const w = await createView({ localizeSceneMaterial: true });
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", status: "completed" }];
    await nextTick();
    const slots = w.findAll('[data-testid^="scene-material-slot-"]');
    expect(slots).toHaveLength(4);
    expect(slots.every(slot => slot.find(".scene-material-thumb").exists())).toBe(true);
    expect(slots.every(slot => slot.find(".scene-material-thumb").attributes("disabled") !== undefined)).toBe(true);
    expect(slots.every(slot => slot.find(".scene-material-empty-text").text() === zh.story2video.sceneMaterial.emptySlot)).toBe(true);
    expect(slots.every(slot => slot.findAll(".scene-material-empty-text").length === 1)).toBe(true);
    expect(slots.every(slot => slot.find(".scene-material-radio").attributes("disabled") !== undefined)).toBe(true);
    expect(w.find('[data-testid="scene-material-slot-video1"]').text()).not.toContain("Video 1");
    expect(w.find('[data-testid="scene-material-slot-video2"]').text()).not.toContain("Video 2");
    await slots[2].find(".scene-material-thumb").trigger("click");
    expect(w.vm.sceneMaterialPreview.visible).toBe(false);
    w.unmount();
  });

  it("场景素材新增文案在 zh/en 成对存在且空态只有一条未生成文案", () => {
    const zhMaterial = zh.story2video.sceneMaterial;
    const enMaterial = en.story2video.sceneMaterial;
    expect(zhMaterial.emptySlot).toBe("未生成");
    expect(enMaterial.emptySlot).toBe("Not generated");
    for (const key of ["video1Label", "video2Label", "previewAriaLabel"]) {
      expect(zhMaterial[key]).toBeTruthy();
      expect(enMaterial[key]).toBeTruthy();
    }
  });

  it("素材路径存在但分享 URL 失效时保留固定空框且不打开预览", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    await nextTick();
    const slot = w.find('[data-testid="scene-material-slot-image1"]');
    expect(slot.classes()).toContain("empty");
    expect(slot.find(".scene-material-thumb").attributes("disabled")).toBeDefined();
    expect(slot.find(".scene-material-radio").attributes("disabled")).toBeUndefined();
    await slot.find(".scene-material-thumb").trigger("click");
    expect(w.vm.sceneMaterialPreview.visible).toBe(false);
    w.unmount();
  });

  it("视频预览按 video1/video2 都渲染为 video 元素", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{
      id: "s1", videoUrl: "media://v1", videoMeta: { sceneVideoPath: "C:/v1.mp4", altSceneVideoPath: "C:/v2.mp4" }, altVideoUrl: "media://v2", status: "completed",
    }];
    await nextTick();
    w.vm.previewSceneMaterial(w.vm.sceneMaterialSlots(w.vm.segments[0])[3]);
    await nextTick();
    expect(w.vm.sceneMaterialPreview.kind).toBe("video2");
    expect(document.body.querySelector(".scene-material-preview-body video")).not.toBeNull();
    expect(document.body.querySelector(".scene-material-preview-body img")).toBeNull();
    w.unmount();
  });

  it("只有 videoMeta 路径的异常旧数据可预览但不能伪造 video 选择", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{
      id: "s1", videoMeta: { sceneVideoPath: "C:/v1.mp4", altSceneVideoPath: "C:/v2.mp4" }, videoUrl: "media://v1", altVideoUrl: "media://v2", selectedMaterial: "video", status: "completed",
    }];
    await nextTick();
    const section = w.find('[data-testid="scene-material-section"]');
    expect(section.find('[data-testid="scene-material-slot-video1"] .scene-material-radio').attributes("disabled")).toBeDefined();
    expect(section.find('[data-testid="scene-material-slot-video2"] .scene-material-radio').attributes("disabled")).toBeDefined();
    expect(section.find('[data-testid="scene-material-slot-video1"] .scene-material-thumb').attributes("disabled")).toBeUndefined();
    await section.find('[data-testid="scene-material-slot-video1"] .scene-material-thumb').trigger("click");
    expect(w.vm.sceneMaterialPreview.visible).toBe(true);
    w.unmount();
  });

  it("再次合成按钮复用重新合成流程（recomposeProject）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRecomposeProject.mockResolvedValue({ code: 0, data: { videoPath: "C:/new.mp4", segments: [] } });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    await nextTick();
    await w.find('[data-testid="recompose-final-button"]').trigger("click");
    await nextTick();
    expect(mocks.story2videoRecomposeProject).toHaveBeenCalledWith("p1");
    w.unmount();
  });

  it("再次合成成功后重新解析素材 URL（回归：旧实现素材区/分段图空白）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRecomposeProject.mockResolvedValue({
      code: 0,
      data: {
        projectId: "p1",
        videoPath: "C:/new.mp4",
        segments: [{
          id: "s1", imagePath: "C:/new-image.png", videoPath: "C:/new-seg.mp4", status: "completed",
        }],
      },
    });
    mocks.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    await nextTick();
    await w.vm.recomposeProject();
    await nextTick();
    expect(w.vm.segments[0].imagePath).toBe("C:/new-image.png");
    expect(w.vm.segments[0].imageUrl).toContain("new-image.png");
    expect(w.vm.segments[0].videoPath).toBe("C:/new-seg.mp4");
    expect(w.vm.segments[0].videoUrl).toContain("new-seg.mp4");
    w.unmount();
  });

  it("生成视频缺少旁白音频时错误归一化为 scene_audio_missing 提示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoGenerateSceneVideo.mockRejectedValue(new Error("该场景没有旁白音频，无法生成视频"));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    await nextTick();
    await w.vm.generateSceneVideo("s1");
    await nextTick();
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_audio_missing");
    w.unmount();
  });

  it("AI 视频按钮：无 videoPrompt 禁用且带提示，点击调用 IPC 并提示成功", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoGenerateSceneAiVideo.mockResolvedValue({
      code: 0,
      data: {
        projectId: "p1",
        segments: [{ id: "s1", imagePath: "C:/img1.png", videoPath: "C:/new-ai.mp4", status: "completed" }],
      },
    });
    mocks.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    w.vm.saveSegments = vi.fn(async () => true);
    w.vm.segmentsDirty = true;
    await nextTick();
    const section = w.find('[data-testid="scene-material-section"]');
    const button = w.find('[data-testid="scene-material-slot-video1"] [data-testid="generate-ai-video-button"]');
    expect(button.exists()).toBe(true);
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toContain("aiVideoNeedsPromptHint");

    w.vm.segments[0].videoPrompt = "   ";
    await nextTick();
    expect(w.find('[data-testid="scene-material-slot-video1"] [data-testid="generate-ai-video-button"]').attributes("disabled")).toBeDefined();

    w.vm.segments[0].videoPrompt = { text: "VP" };
    await nextTick();
    expect(w.find('[data-testid="scene-material-slot-video1"] [data-testid="generate-ai-video-button"]').attributes("disabled")).toBeDefined();
    await w.vm.generateSceneAiVideo("s1");
    expect(mocks.story2videoGenerateSceneAiVideo).not.toHaveBeenCalled();

    // 后端契约回退（videoPrompt 缺省时回退 prompt/text）：空 videoPrompt + 有 prompt 时可点
    w.vm.segments[0].videoPrompt = "";
    w.vm.segments[0].prompt = "场景画面提示词";
    await nextTick();
    expect(w.find('[data-testid="scene-material-slot-video1"] [data-testid="generate-ai-video-button"]').attributes("disabled")).toBeUndefined();

    w.vm.segments[0].videoPrompt = "VP";
    await nextTick();
    expect(w.find('[data-testid="scene-material-slot-video1"] [data-testid="generate-ai-video-button"]').attributes("disabled")).toBeUndefined();
    await w.vm.generateSceneAiVideo("s1");
    await nextTick();
    expect(mocks.story2videoGenerateSceneAiVideo).toHaveBeenCalledWith("p1", "s1");
    expect(w.vm.saveSegments).toHaveBeenCalled();
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_ai_video_generated");
    expect(w.vm.segments[0].videoPath).toBe("C:/new-ai.mp4");
    w.unmount();
  });

  it("无 videoPrompt 但有 prompt/text 时 AI 视频按钮可点并真实调用 IPC（后端回退契约）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoGenerateSceneAiVideo.mockResolvedValue({
      code: 0,
      data: {
        projectId: "p1",
        segments: [{ id: "s1", imagePath: "C:/img1.png", videoPath: "C:/new-ai.mp4", status: "completed" }],
      },
    });
    mocks.story2videoCreateShareUrl.mockImplementation(async filePath => ({ code: 0, data: { url: "media://" + filePath } }));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", prompt: "场景画面提示词", status: "completed" }];
    await nextTick();
    const video1 = w.find('[data-testid="scene-material-slot-video1"] [data-testid="generate-ai-video-button"]');
    const video2 = w.find('[data-testid="scene-material-slot-video2"] [data-testid="generate-ai-video-button"]');
    expect(video1.exists()).toBe(true);
    expect(video1.attributes("disabled")).toBeUndefined();
    expect(video2.exists()).toBe(true);
    expect(video2.attributes("disabled")).toBeUndefined();
    await w.vm.generateSceneAiVideo("s1");
    await nextTick();
    expect(mocks.story2videoGenerateSceneAiVideo).toHaveBeenCalledWith("p1", "s1");
    expect(w.vm.segments[0].videoPath).toBe("C:/new-ai.mp4");
    w.unmount();
  });

  it("AI 视频生成失败提示 scene_ai_video_generate_failed", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoGenerateSceneAiVideo.mockRejectedValue(new Error("未配置可用的视频供应商"));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", videoPrompt: "VP", status: "completed" }];
    await nextTick();
    await w.vm.generateSceneAiVideo("s1");
    await nextTick();
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_ai_video_generate_failed");
    w.unmount();
  });

  it("生成新图成功提示 scene_image_generated 并刷新分段数据", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoGenerateSceneImage.mockResolvedValue({
      code: 0,
      data: {
        projectId: "p1",
        segments: [{
          id: "s1", imagePath: "C:/img1.png",
          alternateImages: [{ path: "C:/img2.png" }], status: "completed",
        }],
      },
    });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    await nextTick();
    await w.vm.generateSceneImage("s1");
    await nextTick();
    expect(mocks.story2videoGenerateSceneImage).toHaveBeenCalledWith("p1", "s1");
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_image_generated");
    expect(w.vm.segments[0].alternateImages).toHaveLength(1);
    w.unmount();
  });

  it("保存分段透传 videoPrompt/subtitleBlocks/voice 设置字段", async () => {
    const api = await import("@/api/publisher");
    api.story2videoUpdateSegments.mockResolvedValue({ code: 0, data: { projectId: "project-1", dirty: true, segments: [] } });
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{
      id: "segment-0",
      text: "A",
      prompt: "PA",
      videoPrompt: "VP",
      subtitleBlocks: ["L1", "L2"],
      voiceId: "v1",
      voiceSpeed: 1.2,
      voicePitch: 0.9,
      voiceEmotion: "happy",
    }];
    await w.vm.saveSegments();
    expect(api.story2videoUpdateSegments).toHaveBeenCalledWith("project-1", [
      expect.objectContaining({
        id: "segment-0", text: "A", prompt: "PA", videoPrompt: "VP",
        subtitleBlocks: ["L1", "L2"], voiceId: "v1", voiceSpeed: 1.2, voicePitch: 0.9, voiceEmotion: "happy",
      }),
    ]);
    w.unmount();
  });

  it("保存分段返回含 imagePath 分段后重建图片 URL（回归：保存后图片消失）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockImplementation(async (filePath) => ({
      code: 0,
      data: { url: "file:///" + String(filePath).replace(/^[A-Za-z]:[\\/]/, "") },
    }));
    api.story2videoUpdateSegments.mockResolvedValue({
      code: 0,
      data: { projectId: "project-1", dirty: true, segments: [{
        id: "s1", imagePath: "C:/img1.png",
        alternateImages: [{ path: "C:/img2.png" }],
        videoPath: "C:/v1.mp4", status: "completed",
      }] },
    });
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "s1", text: "A", status: "completed" }];
    await nextTick();
    await w.vm.saveSegments();
    await nextTick();
    expect(w.vm.segments[0].imageUrl).toBe("file:///img1.png");
    expect(w.vm.segments[0].alternateImageUrls).toEqual(["file:///img2.png"]);
    expect(w.vm.segments[0].videoUrl).toBe("file:///v1.mp4");
    w.unmount();
  });

  it("保存返回空 segments 时保留当前分段图片 URL（回归）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///C:/img1.png" } });
    api.story2videoUpdateSegments.mockResolvedValue({ code: 0, data: { projectId: "project-1", dirty: true, segments: [] } });
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", imageUrl: "file:///C:/img1.png", status: "completed" }];
    await nextTick();
    await w.vm.saveSegments();
    await nextTick();
    // 空返回分支保留当前分段，刷新必须以旧 URL 作为 previousUrl 复用/回收令牌（审查 Major 2）
    expect(api.story2videoCreateShareUrl).toHaveBeenCalledWith("C:/img1.png", "file:///C:/img1.png");
    expect(w.vm.segments[0].imageUrl).toBe("file:///C:/img1.png");
    w.unmount();
  });

  it("旁白替换后重建媒体 URL，图片不消失（同类回归）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoImportMedia.mockResolvedValue({ code: 0, data: { path: "C:/imported.mp3" } });
    api.story2videoCreateShareUrl.mockResolvedValue({ code: 0, data: { url: "file:///C:/img1b.png" } });
    api.story2videoReplaceSegmentAudio.mockResolvedValue({
      code: 0,
      data: { projectId: "p1", segments: [{ id: "s1", imagePath: "C:/img1b.png", audioPath: "C:/a.mp3", status: "completed" }] },
    });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", imagePath: "C:/img1.png", status: "completed" }];
    await nextTick();
    await w.vm.replaceSegmentAudio("s1", { target: { files: [{ name: "a.mp3" }] } });
    await nextTick();
    expect(api.story2videoReplaceSegmentAudio).toHaveBeenCalledWith("p1", "s1", "C:/imported.mp3");
    expect(api.story2videoCreateShareUrl).toHaveBeenCalledWith("C:/img1b.png", undefined);
    expect(w.vm.segments[0].imageUrl).toBe("file:///C:/img1b.png");
    w.unmount();
  });

  it("字幕 textarea 编辑后拆分 subtitleBlocks 并透传保存", async () => {
    const api = await import("@/api/publisher");
    api.story2videoUpdateSegments.mockResolvedValue({ code: 0, data: { projectId: "project-1", dirty: true, segments: [] } });
    const w = await createView();
    w.vm.projectId = "project-1";
    w.vm.segments = [{ id: "segment-0", subtitleBlocks: ["第一句", "第二句"] }];
    await nextTick();
    const ta = w.find('[data-testid="segment-subtitle-textarea"]');
    expect(ta.exists()).toBe(true);
    expect(ta.element.value).toContain("第一句");
    await ta.setValue("新字幕1\n新字幕2");
    await nextTick();
    expect(w.vm.segments[0].subtitleBlocks).toEqual(["新字幕1", "新字幕2"]);
    await w.vm.saveSegments();
    expect(api.story2videoUpdateSegments).toHaveBeenCalledWith("project-1", [
      expect.objectContaining({ id: "segment-0", subtitleBlocks: ["新字幕1", "新字幕2"] }),
    ]);
    w.unmount();
  });

  it("重新生成字幕成功提示 scene_subtitle_regenerated 并刷新分段", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateSceneSubtitle.mockResolvedValue({
      code: 0,
      data: { projectId: "p1", segments: [{ id: "s1", text: "新字幕", subtitleBlocks: ["新字幕"], status: "completed" }] },
    });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", text: "旧字幕", status: "completed" }];
    await nextTick();
    await w.vm.regenerateSceneSubtitle("s1");
    await nextTick();
    expect(mocks.story2videoRegenerateSceneSubtitle).toHaveBeenCalledWith("p1", "s1");
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_subtitle_regenerated");
    expect(w.vm.segments[0].subtitleBlocks).toEqual(["新字幕"]);
    w.unmount();
  });

  it("重新生成字幕前自动保存未落盘编辑（审查 W3 回归）", async () => {
    const api = await import("@/api/publisher");
    api.story2videoUpdateSegments.mockResolvedValue({
      code: 0,
      data: { projectId: "p1", dirty: true, segments: [{ id: "s1", text: "本地新文案", status: "completed" }] },
    });
    api.story2videoRegenerateSceneSubtitle.mockResolvedValue({
      code: 0,
      data: { projectId: "p1", segments: [{ id: "s1", text: "本地新文案", subtitleBlocks: ["新块"], status: "completed" }] },
    });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", text: "本地新文案", status: "completed" }];
    w.vm.segmentsDirty = true;
    await nextTick();
    await w.vm.regenerateSceneSubtitle("s1");
    await nextTick();
    expect(api.story2videoUpdateSegments).toHaveBeenCalledTimes(1);
    expect(api.story2videoRegenerateSceneSubtitle).toHaveBeenCalledWith("p1", "s1");
    expect(w.vm.segments[0].subtitleBlocks).toEqual(["新块"]);
    w.unmount();
  });

  it("任一分段生成中禁用保存分段与重新合成按钮（审查 W2 回归）", async () => {
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", status: "completed" }];
    await nextTick();
    const saveBtn = w.find('[data-testid="save-segments-button"]');
    const recomposeBtn = w.find('[data-testid="recompose-final-button"]');
    expect(saveBtn.attributes("disabled")).toBeUndefined();
    expect(recomposeBtn.attributes("disabled")).toBeUndefined();
    w.vm.segmentBusy = { s1: "tts" };
    await nextTick();
    expect(saveBtn.attributes("disabled")).toBeDefined();
    expect(recomposeBtn.attributes("disabled")).toBeDefined();
    w.unmount();
  });

  it("清空字幕输入后不回退旧时间轴，手动编辑同步清空时间轴（审查 I1 回归）", async () => {
    const w = await createView();
    w.vm.segments = [{
      id: "s1", subtitleBlocks: [], subtitleTimeline: [{ text: "旧时间轴", startTime: 0, endTime: 1 }], status: "completed",
    }];
    await nextTick();
    expect(w.vm.subtitleBlocksText(w.vm.segments[0])).toBe("");
    w.vm.updateSegmentSubtitleBlocks(w.vm.segments[0], "新字幕1\n新字幕2");
    expect(w.vm.segments[0].subtitleBlocks).toEqual(["新字幕1", "新字幕2"]);
    expect(w.vm.segments[0].subtitleTimeline).toEqual([]);
    w.unmount();
  });

  it("重新生成旁白成功提示 scene_audio_regenerated 并刷新分段", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateSceneAudio.mockResolvedValue({
      code: 0,
      data: { projectId: "p1", segments: [{ id: "s1", text: "旁白", audioPath: "C:/a.mp3", status: "completed" }] },
    });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", text: "旁白", status: "completed" }];
    await nextTick();
    await w.vm.regenerateSceneAudio("s1");
    await nextTick();
    expect(mocks.story2videoRegenerateSceneAudio).toHaveBeenCalledWith("p1", "s1");
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_audio_regenerated");
    expect(w.vm.segments[0].audioPath).toBe("C:/a.mp3");
    w.unmount();
  });

  it("重新生成视频优化词成功提示 scene_prompt_regenerated 并刷新分段", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateScenePrompt.mockResolvedValue({
      code: 0,
      data: { projectId: "p1", segments: [{ id: "s1", prompt: "新图词", videoPrompt: "新视频词", status: "completed" }] },
    });
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", prompt: "旧图词", videoPrompt: "旧视频词", status: "completed" }];
    await nextTick();
    await w.vm.regenerateScenePrompt("s1", "video");
    await nextTick();
    expect(mocks.story2videoRegenerateScenePrompt).toHaveBeenCalledWith("p1", "s1", "video");
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_prompt_regenerated");
    expect(w.vm.segments[0].videoPrompt).toBe("新视频词");
    w.unmount();
  });

  it("重新生成图片优化词遇到模型用量上限时提示额度耗尽", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateScenePrompt.mockRejectedValue(new Error(
      "Error code: 429 - GoUsageLimitError: 5-hour usage limit reached. Resets in 1hr 32min."
    ));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", prompt: "旧图词", status: "completed" }];
    await nextTick();

    await w.vm.regenerateScenePrompt("s1", "image");
    await nextTick();

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.quota_exceeded");
    expect(w.vm.story2videoNotificationDialog.messageParams.provider).toBe("当前");
    w.unmount();
  });

  it("重新生成字幕失败提示 scene_subtitle_regenerate_failed", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateSceneSubtitle.mockRejectedValue(new Error("无法重新生成字幕"));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", text: "旧字幕", status: "completed" }];
    await nextTick();
    await w.vm.regenerateSceneSubtitle("s1");
    await nextTick();
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_subtitle_regenerate_failed");
    w.unmount();
  });

  it("重新生成旁白失败时保留供应商额度错误分类", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateSceneAudio.mockRejectedValue(new Error("TTS provider failed: insufficient balance"));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", text: "旁白", status: "completed" }];
    await nextTick();

    await w.vm.regenerateSceneAudio("s1");
    await nextTick();

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.quota_exceeded");
    w.unmount();
  });

  it("重新生成旁白失败时保留音色失效分类", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateSceneAudio.mockRejectedValue(new Error("TTS provider failed: voice id wrong"));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", text: "旁白", status: "completed" }];
    await nextTick();

    await w.vm.regenerateSceneAudio("s1");
    await nextTick();

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.voice_invalid");
    w.unmount();
  });

  it("重新生成旁白失败时对未知错误回退到场景失败提示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoRegenerateSceneAudio.mockRejectedValue(new Error("TTS provider temporarily unavailable"));
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{ id: "s1", text: "旁白", status: "completed" }];
    await nextTick();

    await w.vm.regenerateSceneAudio("s1");
    await nextTick();

    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.scene_audio_regenerate_failed");
    w.unmount();
  });

  it("流水线 TTS 失败后重新生成保留具体错误分类（端到端）", async () => {
    const mocks = await import("@/api/publisher");
    
    const w = await createView();
    w.vm.projectId = "p1";
    w.vm.segments = [{
      id: "s1", text: "你好世界", status: "failed",
      error: "Asset scene generation failed: 0/1 scenes have both image and audio. TTS #0: TTS provider failed: insufficient balance",
    }];
    await nextTick();
    
    const reason = w.vm.segmentStatusReason(w.vm.segments[0]);
    expect(reason).toContain("额度");
    
    mocks.story2videoRegenerateSceneAudio.mockRejectedValue(
      new Error("TTS provider failed: insufficient balance")
    );
    await w.vm.regenerateSceneAudio("s1");
    await nextTick();
    expect(w.vm.story2videoNotificationDialog.messageKey).toBe("story2video.quota_exceeded");
    w.unmount();

    const w2 = await createView();
    w2.vm.projectId = "p2";
    w2.vm.segments = [{
      id: "s1", text: "测试", status: "failed",
      error: "Asset scene generation failed: 0/1 scenes have both image and audio. TTS #0: voice id wrong",
    }];
    await nextTick();
    const reason2 = w2.vm.segmentStatusReason(w2.vm.segments[0]);
    expect(reason2).toContain("音色");
    
    mocks.story2videoRegenerateSceneAudio.mockRejectedValue(
      new Error("TTS provider failed: voice id wrong")
    );
    await w2.vm.regenerateSceneAudio("s1");
    await nextTick();
    expect(w2.vm.story2videoNotificationDialog.messageKey).toBe("story2video.voice_invalid");
    w2.unmount();
  });

  describe("未保存修改可见性与离开守卫（2026-08-16）", () => {
    // 经 router-view 真实挂载，确保 vue-router 能调用组件实例的 beforeRouteLeave
    async function createGuardHarness() {
      const guardRouter = createRouter({ history: createWebHistory(), routes: [
        { path: "/", component: { template: "<div>root</div>" } },
        { path: "/create", component: { template: "<div>create-list</div>" } },
        { path: "/create/result", component: ResultView },
      ] });
      const Harness = { template: "<router-view />" };
      const w = mount(Harness, {
        attachTo: document.body,
        global: {
          plugins: [guardRouter],
          components: { UiButton },
          // UiModal 内部 Teleport to body；stub 后就地渲染，才能对弹窗按钮做 DOM 触发
          stubs: { teleport: true },
          mocks: { $t: (key, params) => (params && params.label ? params.label : key) },
        },
      });
      await guardRouter.push("/create/result");
      await nextTick();
      const rv = w.findComponent(ResultView);
      return { guardRouter, rv, w };
    }

    // UiModal 内容经 Transition 插入，需要少量帧等待；轮询到弹窗按钮再触发
    async function findModalButton(wrapper, testid) {
      for (let i = 0; i < 25; i++) {
        const el = wrapper.find(testid);
        if (el.exists()) return el;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error('modal button not found: ' + testid);
    }

    afterEach(() => { document.body.innerHTML = ''; });

    it("无未保存修改时离开直接放行，不弹确认", async () => {
      const { guardRouter, rv, w } = await createGuardHarness();
      rv.vm.projectId = "p1";
      rv.vm.segments = [{ id: "s1", text: "A", prompt: "PA" }];
      await nextTick();
      await guardRouter.push("/create");
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(guardRouter.currentRoute.value.path).toBe("/create");
      expect(rv.vm.unsavedLeaveDialog.visible).toBe(false);
      w.unmount();
    });

    it("dirty 修改后显示「有未保存修改」提示，保存成功后消失", async () => {
      const api = await import("@/api/publisher");
      api.story2videoUpdateSegments.mockResolvedValue({ code: 0, data: { projectId: "p1", segments: [] } });
      const { rv, w } = await createGuardHarness();
      rv.vm.projectId = "p1";
      rv.vm.segments = [{ id: "s1", text: "A", prompt: "PA" }];
      await nextTick();
      expect(w.find('[data-testid="segments-unsaved-chip"]').exists()).toBe(false);
      rv.vm.segmentsDirty = true;
      await nextTick();
      expect(w.find('[data-testid="segments-unsaved-chip"]').exists()).toBe(true);
      await rv.vm.saveSegments();
      await nextTick();
      expect(rv.vm.segmentsDirty).toBe(false);
      expect(w.find('[data-testid="segments-unsaved-chip"]').exists()).toBe(false);
      w.unmount();
    });

    it("dirty 离开弹确认并挂起导航，取消后留在当前页", async () => {
      const { guardRouter, rv, w } = await createGuardHarness();
      rv.vm.projectId = "p1";
      rv.vm.segments = [{ id: "s1", text: "A", prompt: "PA" }];
      rv.vm.segmentsDirty = true;
      await nextTick();
      const navigation = guardRouter.push("/create");
      await nextTick();
      expect(guardRouter.currentRoute.value.path).toBe("/create/result");
      expect(rv.vm.unsavedLeaveDialog.visible).toBe(true);
      await (await findModalButton(w, '[data-testid="unsaved-leave-cancel"]')).trigger("click");
      await nextTick();
      expect(rv.vm.unsavedLeaveDialog.visible).toBe(false);
      await navigation.catch(() => {});
      expect(guardRouter.currentRoute.value.path).toBe("/create/result");
      w.unmount();
    });

    it("保存并离开：先保存分段成功再导航", async () => {
      const api = await import("@/api/publisher");
      api.story2videoUpdateSegments.mockResolvedValue({ code: 0, data: { projectId: "p1", segments: [] } });
      const { guardRouter, rv, w } = await createGuardHarness();
      rv.vm.projectId = "p1";
      rv.vm.segments = [{ id: "s1", text: "A", prompt: "PA" }];
      rv.vm.segmentsDirty = true;
      await nextTick();
      const navigation = guardRouter.push("/create");
      await nextTick();
      expect(rv.vm.unsavedLeaveDialog.visible).toBe(true);
      await (await findModalButton(w, '[data-testid="unsaved-leave-save"]')).trigger("click");
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(api.story2videoUpdateSegments).toHaveBeenCalledWith("p1", [expect.objectContaining({ id: "s1", prompt: "PA" })]);
      await navigation;
      expect(guardRouter.currentRoute.value.path).toBe("/create");
      w.unmount();
    });

    it("保存并离开：保存失败留在当前页且不导航", async () => {
      const api = await import("@/api/publisher");
      api.story2videoUpdateSegments.mockResolvedValue({ code: -1, message: "保存失败" });
      const { guardRouter, rv, w } = await createGuardHarness();
      rv.vm.projectId = "p1";
      rv.vm.segments = [{ id: "s1", text: "A", prompt: "PA" }];
      rv.vm.segmentsDirty = true;
      await nextTick();
      const navigation = guardRouter.push("/create");
      await nextTick();
      await (await findModalButton(w, '[data-testid="unsaved-leave-save"]')).trigger("click");
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(guardRouter.currentRoute.value.path).toBe("/create/result");
      expect(rv.vm.segmentsDirty).toBe(true);
      expect(rv.vm.unsavedLeaveDialog.visible).toBe(true);
      // 保存失败时导航仍被挂起；unmount 触发组件兜底取消导航，navigation 才会 settle
      w.unmount();
      await navigation.catch(() => {});
    });

    it("不保存离开：跳过保存直接导航，修改被放弃", async () => {
      const api = await import("@/api/publisher");
      const { guardRouter, rv, w } = await createGuardHarness();
      rv.vm.projectId = "p1";
      rv.vm.segments = [{ id: "s1", text: "A", prompt: "PA" }];
      rv.vm.segmentsDirty = true;
      await nextTick();
      const navigation = guardRouter.push("/create");
      await nextTick();
      await (await findModalButton(w, '[data-testid="unsaved-leave-discard"]')).trigger("click");
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(api.story2videoUpdateSegments).not.toHaveBeenCalled();
      expect(guardRouter.currentRoute.value.path).toBe("/create");
      await navigation.catch(() => {});
      w.unmount();
    });
  });

  describe("流水线页面 UX 统一（2026-08-17）", () => {
    it("无成片（无 videoPath 但 projectId + segments）任务仍渲染分段编辑区，不再被空态拦截", async () => {
      const w = await createView();
      expect(w.find('[data-testid="segment-edit-section"]').exists()).toBe(false);
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", text: "旁白", prompt: "PA", status: "failed" }];
      await nextTick();
      expect(w.find('[data-testid="segment-edit-section"]').exists()).toBe(true);
      expect(w.text()).not.toContain("没有可预览的视频");
      expect(w.find('[data-testid="result-action-bar"]').exists()).toBe(true);
      w.unmount();
    });

    it("顶部「视频预览」下方显示任务标题（发布标题优先，缺失时回退原文案前 60 字）", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.project = { projectId: "p1", title: "我的纪录片标题" };
      w.vm.segments = [{ id: "s1", text: "旁白", status: "completed" }];
      await nextTick();
      expect(w.find('[data-testid="result-task-title"]').text()).toContain("我的纪录片标题");

      w.vm.project = { projectId: "p1" };
      w.vm.segments = [{ id: "s1", text: "这是一段非常长的原文案用于验证标题回退显示功能测试场景，内容需要填充超过六十个字符的长度界限以触发截断逻辑，以下是补充文本", status: "completed" }];
      await nextTick();
      const title = w.find('[data-testid="result-task-title"]').text();
      expect(title.length).toBeLessThanOrEqual(61);
      expect(title).toContain("…");
      w.unmount();
    });

    it("分段快捷定位：数字跳转 + 上一条/下一条，越界禁用", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [
        { id: "s1", text: "A", status: "completed" },
        { id: "s2", text: "B", status: "completed" },
        { id: "s3", text: "C", status: "completed" },
      ];
      await nextTick();
      const bar = w.find('[data-testid="segment-jump-bar"]');
      expect(bar.exists()).toBe(true);
      const numbers = bar.findAll(".segment-jump-number");
      expect(numbers).toHaveLength(3);
      const prev = w.find('[data-testid="segment-jump-prev"]');
      const next = w.find('[data-testid="segment-jump-next"]');
      expect(prev.attributes("disabled")).toBeDefined();
      expect(next.attributes("disabled")).toBeUndefined();

      await numbers[2].trigger("click");
      await nextTick();
      expect(w.vm.activeSegmentIndex).toBe(2);
      expect(next.attributes("disabled")).toBeDefined();

      await w.find('[data-testid="segment-jump-prev"]').trigger("click");
      await nextTick();
      expect(w.vm.activeSegmentIndex).toBe(1);
      w.unmount();
    });

    it("音色目录可用时渲染下拉（音色），不可用时回退文本框", async () => {
      const voiceApi = await import("@/api/tts-voice-catalog");
      voiceApi.getTtsVoiceCatalog.mockResolvedValue({
        code: 0,
        data: { voices: [{ id: "voice-a", name: "青年男声" }, { id: "voice-b", name: "温柔女声" }] },
      });
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.project = { projectId: "p1", options: { voiceProvider: "minimax-tts", voiceModel: "speech-2.8-turbo" } };
      w.vm.segments = [{ id: "s1", voiceId: "voice-a", status: "completed" }];
      await w.vm.loadVoiceCatalog();
      await nextTick();
      const select = w.find('[data-testid="segment-voice-id-select"]');
      expect(select.exists()).toBe(true);
      expect(w.find('[data-testid="segment-voice-id-input"]').exists()).toBe(false);
      expect(select.findAll("option").length).toBeGreaterThanOrEqual(3);

      // 目录失败 → 回退文本框
      voiceApi.getTtsVoiceCatalog.mockResolvedValue({ code: -1, message: "VOICE_CATALOG_UNAVAILABLE" });
      await w.vm.loadVoiceCatalog();
      await nextTick();
      expect(w.find('[data-testid="segment-voice-id-select"]').exists()).toBe(false);
      expect(w.find('[data-testid="segment-voice-id-input"]').exists()).toBe(true);
      expect(w.find('[data-testid="voice-catalog-error"]').exists()).toBe(true);
      w.unmount();
    });

    it("语速为拖动条（range 0.5-2），音色 dropdown 选中写回 voiceId 并标记 dirty", async () => {
      const voiceApi = await import("@/api/tts-voice-catalog");
      voiceApi.getTtsVoiceCatalog.mockResolvedValue({
        code: 0,
        data: { voices: [{ id: "voice-a", name: "青年男声" }] },
      });
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.project = { projectId: "p1", options: { voiceProvider: "minimax-tts", voiceModel: "speech-2.8-turbo" } };
      w.vm.segments = [{ id: "s1", voiceId: "voice-a", voiceSpeed: 1, status: "completed" }];
      await w.vm.loadVoiceCatalog();
      await nextTick();
      const range = w.find('[data-testid="segment-voice-speed-range"]');
      expect(range.exists()).toBe(true);
      expect(range.attributes("type")).toBe("range");
      expect(range.attributes("min")).toBe("0.5");
      expect(range.attributes("max")).toBe("2");
      expect(range.attributes("step")).toBe("0.1");
      expect(w.vm.segmentVoiceSpeedText(w.vm.segments[0])).toBe("1.0");

      const select = w.find('[data-testid="segment-voice-id-select"]');
      await select.setValue("voice-a");
      expect(w.vm.segments[0].voiceId).toBe("voice-a");
      expect(w.vm.segmentsDirty).toBe(true);
      w.unmount();
    });

    it("旁白操作区不再渲染「重试图片」「重试视频」按钮", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", imagePath: "C:/img.png", status: "completed" }];
      await nextTick();
      const text = w.text();
      expect(text).not.toContain("重试图片");
      expect(text).not.toContain("重试视频");
      expect(w.text()).toContain("替换旁白");
      expect(w.text()).toContain("下载图片");
      w.unmount();
    });

    it("分段标题（分段 N）位于卡片顶部，即分段图片之上", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", imageUrl: "media://img.png", status: "completed" }];
      await nextTick();
      const header = w.find(".segment-item .segment-header");
      const thumb = w.find(".segment-item .segment-thumb");
      expect(header.exists()).toBe(true);
      expect(thumb.exists()).toBe(true);
      // segment-header 必须是卡片第一个子元素（第 1 段标题在图片上方）
      const item = w.find(".segment-item");
      expect(item.element.firstElementChild.className).toContain("segment-header");
      w.unmount();
    });

    it("保存分段/重新合成/再次合成视频移入底部固定操作条", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", status: "completed" }];
      await nextTick();
      const bar = w.find('[data-testid="result-action-bar"]');
      expect(bar.exists()).toBe(true);
      expect(bar.find('[data-testid="save-segments-button"]').exists()).toBe(true);
      expect(bar.find('[data-testid="recompose-button"]').exists()).toBe(true);
      expect(bar.find('[data-testid="recompose-final-button"]').exists()).toBe(true);
      // 分段编辑 section-heading 内不再有这三个按钮
      expect(w.find(".project-section .section-heading [data-testid='save-segments-button']").exists()).toBe(false);
      w.unmount();
    });

    it("视频提示词下方不再渲染独立的生成 AI 视频按钮（已并入场景素材区）", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", videoPrompt: "VP", status: "completed" }];
      await nextTick();
      const buttons = w.findAll('[data-testid="generate-ai-video-button"]');
      expect(buttons).toHaveLength(2);
      // 该按钮位于场景素材操作区
      expect(w.find('[data-testid="scene-material-section"] [data-testid="generate-ai-video-button"]').exists()).toBe(true);
      w.unmount();
    });

    it("缺失详情素材保留图片、翻译、字幕、提示词和旁白的位置并显示未生成", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.audioPath = null;
      w.vm.audioSrc = null;
      w.vm.segments = [{ id: "s1", status: "failed", prompt: "", videoPrompt: "", subtitleBlocks: [] }];
      await nextTick();

      expect(w.find('[data-testid="segment-image-preview"]').text()).toContain("emptySlot");
      expect(w.find('[data-testid="segment-prompt-translation"]').text()).toContain("emptySlot");
      expect(w.find('[data-testid="segment-subtitle-textarea"]').attributes("placeholder")).toContain("emptySlot");
      expect(w.find('[data-testid="segment-video-prompt-textarea"]').attributes("placeholder")).toContain("emptySlot");
      expect(w.find('[data-testid="narration-placeholder"]').text()).toContain("emptySlot");
      w.unmount();
    });
  });

  // 回归保护（2026-09-13 Bug 修复）：查看文案弹窗原实现用 segments[].text 拼「【N】」编号，
  // 既丢失了分句前的原始文案，又把分段序号带进弹窗与复制内容；且 <pre> 无 CSS 导致不换行。
  describe("查看文案弹窗（展示流水线原始文案 + 自动换行）", () => {
    beforeEach(() => { document.body.innerHTML = ""; });
    afterEach(() => { document.body.innerHTML = ""; });

    async function openScriptModal(w) {
      w.vm.viewScript();
      await nextTick();
      return document.body.querySelector('[data-testid="script-text"]');
    }

    it("展示流水线原始文案（分句前全文），不包含分段编号", async () => {
      const w = await createView();
      w.vm.project = { projectId: "p1", sourceText: "第一句原文。第二句原文！\n\n第三段原文？" };
      w.vm.segments = [
        { id: "s1", text: "第一句原文。", status: "completed" },
        { id: "s2", text: "第二句原文！", status: "completed" },
      ];
      await nextTick();
      const el = await openScriptModal(w);
      expect(el).not.toBeNull();
      expect(el.textContent).toBe("第一句原文。第二句原文！\n\n第三段原文？");
      expect(el.textContent).not.toContain("【");
      w.unmount();
    });

    it("历史项目缺失 sourceText 时回退分段文字（不带编号、跳过空段）", async () => {
      const w = await createView();
      w.vm.project = { projectId: "p1" };
      w.vm.segments = [
        { id: "s1", text: " 甲段 ", status: "completed" },
        { id: "s2", text: "   ", status: "completed" },
        { id: "s3", text: "乙段", status: "completed" },
      ];
      await nextTick();
      const el = await openScriptModal(w);
      expect(el).not.toBeNull();
      expect(el.textContent).toBe("甲段\n\n乙段");
      expect(el.textContent).not.toContain("【");
      w.unmount();
    });

    it("既无原始文案也无分段时内容为空且复制按钮禁用", async () => {
      const w = await createView();
      w.vm.project = { projectId: "p1", sourceText: "   " };
      w.vm.segments = [];
      await nextTick();
      const el = await openScriptModal(w);
      expect(el).not.toBeNull();
      expect(el.textContent).toBe("");
      const copy = document.body.querySelector('[data-testid="script-copy-button"]');
      expect(copy).not.toBeNull();
      expect(copy.hasAttribute("disabled")).toBe(true);
      w.unmount();
    });

    it("复制内容为原始文案全文（不含分段编号）", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      try {
        const w = await createView();
        w.vm.project = { projectId: "p1", sourceText: "原始文案全文" };
        w.vm.segments = [{ id: "s1", text: "分段后的第一句。", status: "completed" }];
        await nextTick();
        await w.vm.copyScript();
        expect(writeText).toHaveBeenCalledWith("原始文案全文");
        w.unmount();
      } finally {
        if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
        else delete navigator.clipboard;
      }
    });

    it("弹窗文本容器声明自动换行（源码契约：jsdom 不应用 scoped CSS）", () => {
      const source = fs.readFileSync("./src/views/ResultView.vue", "utf8");
      const rule = source.match(/\.script-text\s*\{([^}]*)\}/);
      expect(rule).toBeTruthy();
      expect(rule[1]).toMatch(/white-space:\s*pre-wrap/);
      expect(rule[1]).toMatch(/overflow-wrap:\s*anywhere/);
      expect(rule[1]).toMatch(/word-break:\s*break-word/);
    });

    it("滚动时右侧分段导航自动高亮当前所在分段（getBoundingClientRect 计算）", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [
        { id: "s1", text: "A", status: "completed" },
        { id: "s2", text: "B", status: "completed" },
        { id: "s3", text: "C", status: "completed" },
      ];
      await nextTick();
      const items = w.findAll(".segment-item");
      expect(items.length).toBe(3);
      // 第 1 段在视口下方，第 2 段顶部进入视口上方区域，第 3 段已滚过视口顶部
      items[0].element.getBoundingClientRect = () => ({ top: 600, bottom: 1000, height: 400 });
      items[1].element.getBoundingClientRect = () => ({ top: 80, bottom: 480, height: 400 });
      items[2].element.getBoundingClientRect = () => ({ top: -320, bottom: 80, height: 400 });
      window.dispatchEvent(new Event("scroll"));
      await nextTick();
      // 顶部进入视口上方最近的分段是第 2 段（index 1）
      expect(w.vm.activeSegmentIndex).toBe(1);
      // 对应数字按钮高亮
      const numbers = w.find('[data-testid="segment-jump-bar"]').findAll(".segment-jump-number");
      expect(numbers[1].classes()).toContain("active");
      w.unmount();
    });

    it("滚动到最下方时高亮最后一个分段", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [
        { id: "s1", text: "A", status: "completed" },
        { id: "s2", text: "B", status: "completed" },
      ];
      await nextTick();
      const items = w.findAll(".segment-item");
      // 两段都已滚过视口顶部
      items[0].element.getBoundingClientRect = () => ({ top: -800, bottom: -400, height: 400 });
      items[1].element.getBoundingClientRect = () => ({ top: -300, bottom: 100, height: 400 });
      window.dispatchEvent(new Event("scroll"));
      await nextTick();
      expect(w.vm.activeSegmentIndex).toBe(1);
      w.unmount();
    });

    it("delete segment recalculates scroll highlight without out-of-bounds", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [
        { id: "s1", text: "A", status: "completed" },
        { id: "s2", text: "B", status: "completed" },
        { id: "s3", text: "C", status: "completed" },
      ];
      await nextTick();
      w.vm.activeSegmentIndex = 2;
      w.vm.removeSegment(2);
      await nextTick();
      expect(w.vm.segments).toHaveLength(2);
      const items = w.findAll(".segment-item");
      expect(items.length).toBe(2);
      items[0].element.getBoundingClientRect = () => ({ top: 500, bottom: 900, height: 400 });
      items[1].element.getBoundingClientRect = () => ({ top: 100, bottom: 500, height: 400 });
      window.dispatchEvent(new Event("scroll"));
      await nextTick();
      expect(w.vm.activeSegmentIndex).toBe(1);
      w.unmount();
    });
  });
});
