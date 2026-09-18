import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, config } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";

const mockEnsureLogin = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: mockEnsureLogin,
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}));

vi.mock("@/api/publisher", () => ({
  renderStart: vi.fn(),
  renderCancel: vi.fn(),
  renderGetStatus: vi.fn().mockResolvedValue({ code: 0, data: { ready: true } }),
  renderInstallDeps: vi.fn().mockResolvedValue({ code: 0, data: { success: true } }),
  onRenderProgress: vi.fn().mockReturnValue(vi.fn()),
  onRenderComplete: vi.fn().mockReturnValue(vi.fn()),
  onRenderError: vi.fn().mockReturnValue(vi.fn()),
  onRenderInstallProgress: vi.fn().mockReturnValue(vi.fn()),
  onPipelineUpdate: vi.fn().mockReturnValue(vi.fn()),
  // P0-1 修复后的契约：aiGenerate 走 ai:generate（响应字段 content），provider 由 modelProviderGetDefault 查询
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: { id: "openai" } }),
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: "AI生成文案内容" } }),
  pipelineList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  pipelineStart: vi.fn(),
  pipelinePause: vi.fn(),
  pipelinePauseRun: vi.fn(),
  pipelineResume: vi.fn(),
  pipelineCancel: vi.fn(),
  pipelineStatus: vi.fn(),
  pipelineAdvance: vi.fn(),
  pipelineHistory: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  pipelineStartOrchestrated: vi.fn(),
  pipelineResumeOrchestration: vi.fn(),
  pipelineAdvanceToNextCheckpoint: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelineConfirmSceneAssets: vi.fn(),
  pipelineDeleteRun: vi.fn(),
  draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoCreateShareUrl: vi.fn(async () => ({ code: 0, data: { url: "media://x" } })),
  storeGetSetting: vi.fn(),
  storeSetSetting: vi.fn(),
  story2videoImportMedia: vi.fn(),
  story2videoTranscribe: vi.fn(),
  story2videoListProjects: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoGetThumbnail: vi.fn().mockResolvedValue({ code: 0, data: { status: "missing", url: null } }),
  story2videoSaveAs: vi.fn().mockResolvedValue({ code: 0, data: { path: "/saved/video.mp4", cancelled: true } }),
  story2videoDeleteProject: vi.fn(),
  story2videoBgmLibraryList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBgmLibraryAdd: vi.fn(),
  story2videoBgmLibraryRename: vi.fn(),
  story2videoBgmLibraryDelete: vi.fn(),
  // 流水线「保存配置」（2026-08-28 s2v-pipeline-config-profiles）
  story2videoConfigProfileList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoConfigProfileCreate: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileRename: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileDelete: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  // 批量创作（2026-08-15 story2video-batch-create）
  story2videoBatchCreate: vi.fn().mockResolvedValue({ code: 0, data: { batchId: "batch_test_1", items: [] } }),
  story2videoBatchStatus: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBatchCancel: vi.fn().mockResolvedValue({ code: 0, data: { success: true, cancelled: 1 } }),
  story2videoPickBatchFiles: vi.fn().mockResolvedValue({ code: 0, data: { files: [] } }),
}));

vi.mock("@/api/tts-voice-catalog", () => ({
  getTtsVoiceCatalog: vi.fn().mockResolvedValue({
    code: 0,
    data: { providerId: "", model: "", selectedVoiceId: null, voices: [] },
  }),
  getTtsVoiceCapability: vi.fn().mockResolvedValue({
    code: 0,
    data: { type: "user_clone", clone: { enabled: true } },
  }),
  selectTtsVoice: vi.fn().mockResolvedValue({
    code: 0,
    data: { providerId: "", model: "", selectedVoiceId: null, voices: [] },
  }),
  clearTtsVoicePreference: vi.fn().mockResolvedValue({
    code: 0,
    data: { providerId: "", model: "", selectedVoiceId: null },
  }),
}));

vi.mock("@/api/tts-voice-clone", () => ({
  addTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
  chooseTtsVoiceCloneSamples: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
  deleteTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
  getTtsVoiceCloneRequirements: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
  listTtsVoiceClones: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
  renameTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
}));

import UiButton from "@/components/UiButton.vue";
import UiSelect from "@/components/UiSelect.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/create/result", name: "result", component: { template: "<div>result</div>" } }]
});
// _loadDraftForRewrite 场景需要 /create 路由使 query 生效（2026-09-13 rewrite-to-video-entry）
router.addRoute({ path: "/create", name: "create", component: { template: "<div>create</div>" } });

import CreateView from "./CreateView.vue";
import CreateViewHistory from './CreateViewHistory.vue'
import { settingsDialogRevision } from "@/stores/settings-dialog";
import { PipelineSelector, StageProgress } from './video-creation'
import i18n from "@/i18n";

// Production renders the progress modal through Teleport. Page tests keep the
// modal inside the wrapper; UiModal tests cover the real body mount contract.
config.global.stubs = { ...(config.global.stubs || {}), teleport: true };

describe("CreateView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    window.localStorage.clear();
    // 设置弹窗 revision 是模块级单例：复位避免跨用例 watcher 触发（2026-08-12 审查 m4）
    settingsDialogRevision.value = 0;
  });

  it("renders page header", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    expect(w.text()).toContain("视频创作");
  });

  it("流水线创作视图包含视频克隆入口卡片（与其他流水线同款 UI）", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "pipelines";
    await nextTick();
    const card = w.find('[data-pipeline-id="video-clone"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("视频克隆");
    expect(card.text()).toContain("对标拆解");
  });

  it("点击视频克隆入口卡片路由到 /video-clone", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "pipelines";
    await nextTick();
    const push = vi.spyOn(w.vm.$router, "push");
    await w.find('[data-pipeline-id="video-clone"]').trigger("click");
    expect(push).toHaveBeenCalledWith("/video-clone");
  });

  it("shows three view tabs", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    const tabs = w.findAll(".view-tab");
    expect(tabs.length).toBe(3);
  });

  it("switches to quick view shows mode tabs", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    await nextTick();
    const tabs = w.findAll(".mode-tab");
    expect(tabs.length).toBe(2);
  });

  it("switches quick mode to gallery shows upload", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    await nextTick();
    const tabs = w.findAll(".mode-tab");
    await tabs[1].trigger("click");
    await nextTick();
    expect(w.text()).toContain("上传图片");
  });

  it("canQuickRender is false with empty quickText", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    await nextTick();
    expect(w.vm.canQuickRender).toBe(false);
  });

  it("canQuickRender is true with non-empty quickText", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    w.vm.quickText = "hello world";
    await nextTick();
    expect(w.vm.canQuickRender).toBe(true);
  });

  it("canQuickRender is false when quickRendering", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    w.vm.quickText = "test";
    w.vm.quickRendering = true;
    expect(w.vm.canQuickRender).toBe(false);
  });

  it("canQuickRender is false when gallery mode with no images", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    w.vm.quickMode = "gallery";
    expect(w.vm.canQuickRender).toBe(false);
  });

  it("canQuickRender is true when gallery has images", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    w.vm.quickMode = "gallery";
    w.vm.quickImages = [{ path: "/img.png", preview: "blob:1" }];
    expect(w.vm.canQuickRender).toBe(true);
  });

  it("gets renderStatus on mount", async () => {
    const mocks = await import("@/api/publisher");
    mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 0));
    expect(mocks.renderGetStatus).toHaveBeenCalled();
  });

  it("loads pipelines on mount", async () => {
    const mocks = await import("@/api/publisher");
    mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    expect(mocks.pipelineList).toHaveBeenCalled();
  });

  it("挂载时不自动接管主进程仍在运行的编排流水线（运行态统一后台）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStatus.mockImplementation((name) => {
      if (name === "story2video-compose") {
        return Promise.resolve({ code: 0, data: { status: "running", orchestrationMode: "orchestrator", id: "run_resume_1", stages: [] } });
      }
      return Promise.resolve({ code: 0, data: { status: "idle" } });
    });
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: { status: { status: "running" }, currentStage: 2, stages: [{ name: "split", status: "completed" }, { name: "optimize", status: "running" }], context: {} },
    });
    mocks.pipelineList.mockResolvedValue({
      code: 0,
      data: [{ name: "story2video-compose", available: true, stages: ["split", "scene_context", "optimize", "generate_assets", "compose", "publish"] }],
    });
    try {
      const w = mount(CreateView, {
        global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
      });
      await new Promise((r) => setTimeout(r, 100));
      await nextTick();
      expect(w.vm.orchestrationRunId).toBeNull();
      expect(w.vm.pipelineRunStatus?.status).not.toBe("running");
      expect(mocks.pipelineGetRunContext).not.toHaveBeenCalled();
      w.unmount();
    } finally {
      // 恢复 mock 实现，避免泄漏到后续用例（beforeEach 的 clearAllMocks 不重置实现）
      mocks.pipelineStatus.mockRestore();
      mocks.pipelineGetRunContext.mockRestore();
      mocks.pipelineList.mockRestore();
    }
  });

  it("流水线详情头展示创作模式标签（旁白式/口播式，无模式不显示）", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    await nextTick();
    const label = w.find('[data-testid="pipeline-mode-label"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toContain("旁白式");
    w.vm.selectedPipeline = { name: "cinematic", available: true, stages: [] };
    await nextTick();
    expect(w.find('[data-testid="pipeline-mode-label"]').exists()).toBe(false);
    w.unmount();
  });

  it("阶段清单展示场景数/优化进度/资源进度详情", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    const now = new Date().toISOString();
    w.vm.pipelineRunStatus = {
      status: "running",
      currentStage: 2,
      progress: 50,
      stages: [
        { name: "split", status: "completed", startedAt: now },
        { name: "optimize", status: "completed", startedAt: now },
        { name: "generate_assets", status: "running", startedAt: now },
        { name: "compose", status: "pending" },
      ],
    };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split", "optimize", "generate_assets", "compose"] };
    w.vm.orchestrationContext = {
      split: { scenes: [{}, {}] },
      optimize_progress: { done: 2, total: 2 },
      assets_progress: { imagesDone: 0, imagesTotal: 2, ttsDone: 1, ttsTotal: 2 },
    };
    w.vm.story2videoRunMeta = { createdAt: new Date(Date.now() - 65000).toISOString(), endedAt: null };
    w.vm.pipelineProgressModalOpen = true;
    await nextTick();
    expect(w.text()).toContain("拆分为了 2 个场景");
    expect(w.text()).toContain("共 2 个场景，已完成 2 个");
    expect(w.text()).toContain("图片 0/2");
    expect(w.text()).toContain("旁白 1/2");
    expect(w.text()).toContain("已用时");
    expect(w.find('[data-testid="story2video-stage-detail-generate_assets"]').text()).toContain("图片 0/2");
    // 进度头部固定容器：包含进度条/已用时，且位于阶段列表内（不随滚动离开视口）
    const stickyHeader = w.find('[data-testid="story2video-stage-sticky-header"]');
    expect(stickyHeader.exists()).toBe(true);
    expect(stickyHeader.find('[data-testid="story2video-orchestration-progress"]').exists()).toBe(true);
    const timeline = w.find('[data-testid="story2video-stage-list"]');
    expect(timeline.element.contains(stickyHeader.element)).toBe(true);
    w.unmount();
  });

  it("compose 阶段展示子进度条与片段文案", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    const now = new Date().toISOString();
    w.vm.pipelineRunStatus = {
      status: "running",
      currentStage: 3,
      progress: 66,
      stages: [
        { name: "split", status: "completed", startedAt: now },
        { name: "optimize", status: "completed", startedAt: now },
        { name: "generate_assets", status: "completed", startedAt: now },
        { name: "compose", status: "running", startedAt: now },
      ],
    };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split", "optimize", "generate_assets", "compose"] };
    w.vm.orchestrationContext = {
      split: { scenes: [{}, {}] },
      optimize_progress: { done: 2, total: 2 },
      assets_progress: { imagesDone: 2, imagesTotal: 2, ttsDone: 2, ttsTotal: 2 },
      compose_progress: { phase: "segments", percent: 39, segmentsDone: 3, segmentsTotal: 5 },
    };
    w.vm.story2videoRunMeta = { createdAt: new Date(Date.now() - 65000).toISOString(), endedAt: null };
    w.vm.pipelineProgressModalOpen = true;
    await nextTick();
    expect(w.text()).toContain("正在合成片段 3/5 · 39%");
    const bar = w.find('[data-testid="story2video-stage-compose-progress"]');
    expect(bar.exists()).toBe(true);
    expect(bar.find(".stage-sub-fill").attributes("style")).toContain("width: 39%");
    w.unmount();
  });

  it("compose 分块 message 经过 CreateView 透传到阶段详情", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    const now = new Date().toISOString();
    const message = "正在拼接视频片段（分块 3/5）";
    w.vm.pipelineRunStatus = {
      status: "running",
      currentStage: 0,
      progress: 88,
      stages: [{ name: "compose", status: "running", startedAt: now }],
    };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["compose"] };
    w.vm.orchestrationContext = {
      compose_progress: { phase: "concat", percent: 88.2, segmentsDone: 12, segmentsTotal: 12, message },
    };
    w.vm.pipelineProgressModalOpen = true;
    await nextTick();
    const detail = w.find('[data-testid="story2video-stage-detail-compose"]');
    expect(detail.exists()).toBe(true);
    expect(detail.text()).toBe(message);
    expect(w.find('[data-testid="story2video-stage-compose-progress"]').attributes("aria-valuenow")).toBe("88");
    w.unmount();
  });

  it("CreateView 兼容详情解析遵守 summary/progress/message 优先级并拒绝越界 percent", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.orchestrationContext = {
      compose_progress: { phase: "concat", percent: 88, message: "旧快照分块消息" },
    };
    expect(w.vm.stageDetailText({
      name: "compose",
      status: "running",
      progress: { percent: 50, message: "统一阶段消息" },
    }, 0)).toBe("统一阶段消息");
    expect(w.vm.stageDetailText({
      name: "compose",
      status: "completed",
      progress: { percent: 100, message: "统一阶段消息" },
      summary: "视频合成完成",
    }, 0)).toBe("视频合成完成");
    w.vm.orchestrationContext = {
      compose_progress: { phase: "concat", percent: 101, message: "越界消息" },
    };
    expect(w.vm.stageDetailText({ name: "compose", status: "running" }, 0)).toBe("");
    w.unmount();
  });

  it("compose 阶段无子进度数据时安全降级（不渲染子进度条）", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    const now = new Date().toISOString();
    w.vm.pipelineRunStatus = {
      status: "running",
      currentStage: 1,
      progress: 50,
      stages: [
        { name: "split", status: "completed", startedAt: now },
        { name: "compose", status: "running", startedAt: now },
      ],
    };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split", "compose"] };
    w.vm.orchestrationContext = { split: { scenes: [{}, {}] } };
    await nextTick();
    expect(w.find('[data-testid="story2video-stage-compose-progress"]').exists()).toBe(false);
    // 阶段名「视频合成」仍展示，但无 compose_progress 时不得渲染子进度文案
    expect(w.text()).not.toContain("正在合成片段");
    expect(w.find('[data-testid="story2video-stage-detail-compose"]').exists()).toBe(false);
    w.unmount();
  });

  it("恢复上次保存的图片轮播选项（跳过已禁用 provider，恢复折叠状态并提示）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: {
        version: 1,
        s2vConfig: {
          imageStyle: "anime", voiceSpeed: 1.5, voiceProvider: "disabled-provider",
          splitLanguage: "en", splitTargetSeconds: 8,
          // 参数治理（7.1.19）：旧快照可能带已移除的系统管理参数，恢复时必须被白名单忽略
          voicePitch: -2, creativeLevel: 7, splitBaseWordsPerSecond: 9.9,
        },
        s2vOutputConfig: { resolution: "1920x1080", fps: 60 },
        ui: { expandedGroups: ["appearance", "voice"] },
      },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vVoiceProviders = [{ id: "minimax-tts" }, { id: "edge-tts" }];
    w.vm.s2vImageProviders = [{ id: "minimax-image" }];
    await w.vm.restoreS2VLastOptions();
    expect(w.vm.s2vConfig.imageStyle).toBe("anime");
    expect(w.vm.s2vConfig.voiceSpeed).toBe(1.5);
    expect(w.vm.s2vConfig.splitLanguage).toBe("en");
    expect(w.vm.s2vConfig.voiceProvider).not.toBe("disabled-provider");
    expect(w.vm.s2vOutputConfig.fps).toBe(60);
    // 旧快照缺新字段 → 恢复后保留默认值（字数主控 20 / follow-audio / N=6 / 时长视图）
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(20);
    expect(w.vm.s2vConfig.sceneDurationMode).toBe("follow-audio");
    expect(w.vm.s2vConfig.minSceneDuration).toBe(6);
    expect(w.vm.s2vConfig.splitViewMode).toBe("seconds");
    // 旧快照带回陈旧 splitTargetSeconds=8 → restore 按主控字数 20 + 恢复后的语言 en(2.8) × voice.speed 1.5 自愈为 round(20/4.2)=5
    expect(w.vm.s2vConfig.splitTargetSeconds).toBe(5);
    // 参数治理（7.1.19）：旧快照中的已移除系统管理参数被忽略，不污染当前配置
    expect(w.vm.s2vConfig).not.toHaveProperty("voicePitch");
    expect(w.vm.s2vConfig).not.toHaveProperty("creativeLevel");
    expect(w.vm.s2vConfig).not.toHaveProperty("splitBaseWordsPerSecond");
    // 恢复表单折叠状态
    expect(w.vm.s2vOpenSections.appearance).toBe(true);
    expect(w.vm.s2vOpenSections.voice).toBe(true);
    // 恢复轻提示
    expect(w.vm.s2vOptionsToast).toContain("已恢复");
    // 恢复 mock 实现，避免泄漏到后续用例（beforeEach 的 clearAllMocks 不重置实现）
    mocks.storeGetSetting.mockReset();
    w.unmount();
  });

  it("选择图片轮播流水线后自动恢复上次选项（真实交互路径，2026-08-09 Bug 反哺）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: {
        version: 1,
        s2vConfig: { imageStyle: "anime", voiceSpeed: 1.5 },
        s2vOutputConfig: { resolution: "1920x1080", fps: 60 },
        ui: { expandedGroups: ["appearance"] },
      },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    // mounted 时 selectedPipeline 为 null（真实场景）→ mounted 的 restore 守卫不执行；
    // 用户点击图片轮播卡片触发 selectPipeline → 才恢复
    expect(w.vm.selectedPipeline).toBeNull();
    w.vm.selectPipeline({ name: "story2video-compose", available: true, stages: [] });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    expect(w.vm.s2vConfig.imageStyle).toBe("anime");
    expect(w.vm.s2vConfig.voiceSpeed).toBe(1.5);
    expect(w.vm.s2vOutputConfig.fps).toBe(60);
    expect(w.vm.s2vOpenSections.appearance).toBe(true);
    expect(w.vm._s2vRestoredOnce).toBe(true);
    w.unmount();
  });

  it("同会话重复选择图片轮播不重复恢复（保留当前编辑，不覆盖）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: { version: 1, s2vConfig: { imageStyle: "anime" }, s2vOutputConfig: {}, ui: {} },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectPipeline({ name: "story2video-compose", available: true, stages: [] });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    expect(w.vm.s2vConfig.imageStyle).toBe("anime");
    // 用户继续编辑 → 切走再切回，不得被旧快照覆盖
    w.vm.s2vConfig.imageStyle = "cyberpunk";
    w.vm.selectPipeline({ name: "animated-explainer", available: true, stages: [] });
    w.vm.selectPipeline({ name: "story2video-compose", available: true, stages: [] });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    expect(w.vm.s2vConfig.imageStyle).toBe("cyberpunk");
    w.unmount();
  });

  it("恢复上次选项时把不在选项列表中的枚举值归一化（陈旧值回退默认，避免下拉为空）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: {
        version: 1,
        s2vConfig: {
          contentType: "mystery",
          imageStyle: "anime-mslpadvn",
          promptStyle: "unknown-style",
          imageEffect: "unknown-effect",
          transition: "unknown-transition",
          subtitleSize: "size99",
          subtitleStyleName: "style99",
          splitLanguage: "xx",
          splitMode: "random",
          splitViewMode: "weird",
          voiceSpeed: 1.2,
        },
        s2vOutputConfig: { resolution: "1920x1080", fps: 25, format: "avi" },
        ui: {},
      },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vVoiceProviders = [{ id: "minimax-tts" }];
    w.vm.s2vImageProviders = [{ id: "minimax-image" }];
    await w.vm.restoreS2VLastOptions();
    // 陈旧枚举值回退到当前选项列表内的默认值
    expect(w.vm.s2vConfig.contentType).toBe("general");
    expect(w.vm.s2vConfig.imageStyle).toBe("cinematic");
    expect(w.vm.s2vConfig.promptStyle).toBe("realistic");
    expect(w.vm.s2vConfig.imageEffect).toBe("zoom-in");
    expect(w.vm.s2vConfig.transition).toBe("fade");
    expect(w.vm.s2vConfig.subtitleSize).toBe("size3");
    expect(w.vm.s2vConfig.subtitleStyleName).toBe("style1");
    expect(w.vm.s2vConfig.splitLanguage).toBe("auto");
    expect(w.vm.s2vConfig.splitMode).toBe("balanced");
    expect(w.vm.s2vConfig.splitViewMode).toBe("seconds");
    // 输出配置归一化
    expect(w.vm.s2vOutputConfig.fps).toBe(30);
    expect(w.vm.s2vOutputConfig.format).toBe("mp4");
    // 非枚举字段保持恢复值
    expect(w.vm.s2vConfig.voiceSpeed).toBe(1.2);
    // 合法枚举值仍被保留：重新执行归一化也不被重置（claude review I4）
    w.vm.s2vConfig.imageStyle = "anime";
    w.vm.normalizeS2VRestoredEnums();
    expect(w.vm.s2vConfig.imageStyle).toBe("anime");
    mocks.storeGetSetting.mockReset();
    w.unmount();
  });

  it("图片提示词最大长度：默认 2000，下拉渲染 8 档并绑定 maxPromptLength（2026-08-16 上限放开）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue(null);
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    await w.vm.restoreS2VLastOptions();
    // 默认 2000（契约上限）
    expect(w.vm.s2vConfig.maxPromptLength).toBe(2000);
    // 下拉渲染 8 档（200..2000），当前值选中
    const select = w.find('[data-testid="s2v-max-prompt-length-select"]');
    expect(select.exists()).toBe(true);
    const options = select.findAll("option");
    expect(options.map((o) => Number(o.attributes("value")))).toEqual([200, 300, 400, 500, 700, 1000, 1500, 2000]);
    expect(options.map((o) => Number(o.attributes("value")))).toContain(Number(select.element.value));
    // 标签走 i18n 而非 raw key
    expect(w.vm.s2vMaxPromptLengthLabel).toContain("提示词最大长度");
    expect(w.vm.s2vMaxPromptLengthHint).toContain("2000");
    // 用户改档后透传 buildStory2VideoTextConfig
    w.vm.s2vConfig.maxPromptLength = 1000;
    const config = w.vm.buildStory2VideoTextConfig();
    expect(config.optimize.maxLength).toBe(1000);
    w.unmount();
  });

  it("图片提示词最大长度恢复钳制：越界/缺失回退 2000，合法值保留（2026-08-16 上限放开）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: {
        version: 1,
        s2vConfig: {
          maxPromptLength: 30000,
          promptStyle: "realistic",
        },
        s2vOutputConfig: {},
        ui: {},
      },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vVoiceProviders = [{ id: "minimax-tts" }];
    w.vm.s2vImageProviders = [{ id: "minimax-image" }];
    await w.vm.restoreS2VLastOptions();
    expect(w.vm.s2vConfig.maxPromptLength).toBe(2000);
    // 越界低值同样回退默认（契约区间 200..2000）
    w.vm.s2vConfig.maxPromptLength = 150;
    w.vm.normalizeS2VRestoredEnums();
    expect(w.vm.s2vConfig.maxPromptLength).toBe(2000);
    // 缺失字段（陈旧快照）回退默认
    w.vm.s2vConfig.maxPromptLength = undefined;
    w.vm.normalizeS2VRestoredEnums();
    expect(w.vm.s2vConfig.maxPromptLength).toBe(2000);
    // 区间内非档位值吸附到最近档位（下拉 8 档避免 select 无匹配项）
    w.vm.s2vConfig.maxPromptLength = 650;
    w.vm.normalizeS2VRestoredEnums();
    expect(w.vm.s2vConfig.maxPromptLength).toBe(700);
    // 合法档位值保持不被重置（idempotent）
    w.vm.s2vConfig.maxPromptLength = 700;
    w.vm.normalizeS2VRestoredEnums();
    expect(w.vm.s2vConfig.maxPromptLength).toBe(700);
    mocks.storeGetSetting.mockReset();
    w.unmount();
  });

  it("水印选项恢复吸附：陈旧位置/字号/透明度归一化到合法档位（watermark-options）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: {
        version: 1,
        s2vConfig: {
          watermarkText: "品牌",
          watermarkConfig: { enabled: false, position: "middle", fontSize: 30, opacity: 0.55, color: "white" },
        },
        s2vOutputConfig: {},
        ui: {},
      },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vVoiceProviders = [{ id: "minimax-tts" }];
    w.vm.s2vImageProviders = [{ id: "minimax-image" }];
    await w.vm.restoreS2VLastOptions();
    expect(w.vm.s2vConfig.watermarkText).toBe("品牌");
    expect(w.vm.s2vConfig.watermarkConfig.position).toBe("bottom-right");
    expect(w.vm.s2vConfig.watermarkConfig.fontSize).toBe(32);
    expect(w.vm.s2vConfig.watermarkConfig.opacity).toBe(0.6);
    // 合法档位保持不被重置（idempotent）
    w.vm.s2vConfig.watermarkConfig.position = "moving";
    w.vm.s2vConfig.watermarkConfig.fontSize = 48;
    w.vm.s2vConfig.watermarkConfig.opacity = 1;
    w.vm.normalizeS2VRestoredEnums();
    expect(w.vm.s2vConfig.watermarkConfig.position).toBe("moving");
    expect(w.vm.s2vConfig.watermarkConfig.fontSize).toBe(48);
    expect(w.vm.s2vConfig.watermarkConfig.opacity).toBe(1);
    mocks.storeGetSetting.mockReset();
    w.unmount();
  });

  it("水印选项恢复吸附：null/空串字号与透明度回退默认值，不吸附到最小档（watermark-options）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: {
        version: 1,
        s2vConfig: {
          watermarkText: "品牌",
          watermarkConfig: { enabled: false, position: "moving", fontSize: null, opacity: "", color: "white" },
        },
        s2vOutputConfig: {},
        ui: {},
      },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vVoiceProviders = [{ id: "minimax-tts" }];
    w.vm.s2vImageProviders = [{ id: "minimax-image" }];
    await w.vm.restoreS2VLastOptions();
    expect(w.vm.s2vConfig.watermarkConfig.position).toBe("moving");
    expect(w.vm.s2vConfig.watermarkConfig.fontSize).toBe(24);
    expect(w.vm.s2vConfig.watermarkConfig.opacity).toBe(0.6);
    mocks.storeGetSetting.mockReset();
    w.unmount();
  });

  it("语音生成器选项首项带「自动 Edge TTS」显示名（下拉标签不再为空）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vVoiceProviders = [{ id: "minimax-tts", name: "MiniMax TTS", category: "tts", models: ["speech-2.8-turbo"] }];
    const options = w.vm.s2vVoiceProviderOptions;
    expect(options[0]).toEqual({ id: "", name: "自动 Edge TTS", displayName: "自动 Edge TTS" });
    expect(options[1].displayName).toBe("MiniMax TTS");
    w.unmount();
  });

  it("保存并重置图片轮播选项设置", async () => {
    const mocks = await import("@/api/publisher");
    mocks.storeGetSetting.mockResolvedValue(null);
    mocks.storeSetSetting.mockResolvedValue({ code: 0 });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vConfig.imageStyle = "cyberpunk";
    await w.vm.saveS2VLastOptions();
    expect(mocks.storeSetSetting).toHaveBeenCalledWith("story2video.lastOptions.v1", expect.objectContaining({
      version: 1,
      s2vConfig: expect.objectContaining({ imageStyle: "cyberpunk" }),
    }));
    // 折叠状态随快照保存，保存后显示轻提示
    const savedCall = mocks.storeSetSetting.mock.calls.find(([key]) => key === "story2video.lastOptions.v1");
    expect(savedCall[1].ui.expandedGroups).toEqual(expect.arrayContaining(["basic"]));
    expect(w.vm.s2vOptionsToast).toContain("已保存");
    await w.vm.resetS2VLastOptions();
    expect(w.vm.s2vConfig.imageStyle).toBe("cinematic");
    expect(mocks.storeSetSetting).toHaveBeenCalledWith("story2video.lastOptions.v1", null);
    w.unmount();
  });

  it("音色克隆：渲染上传要求提示并映射全部克隆错误码", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vVoiceCloneRequirements = {
      allowedExtensions: [".mp3", ".m4a", ".wav"],
      maxSampleCount: 1,
      maxSampleBytes: 20971520,
      minSampleDurationSeconds: 10,
      maxSampleDurationSeconds: 300,
    };
    const hint = w.vm.s2vVoiceCloneHint();
    expect(hint).toContain("mp3、m4a、wav");
    expect(hint).toContain("10 秒");
    expect(hint).toContain("5 分钟");
    expect(hint).toContain("20 MB");
    // 未映射到函数文本（回归：method 需调用而非直接插值）
    expect(String(hint)).not.toContain("function");

    expect(w.vm.friendlyVoiceCatalogError("VOICE_CLONE_SAMPLE_DURATION_INVALID")).toContain("时长不符合要求");
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CLONE_SAMPLE_EXTENSION_UNSUPPORTED")).toContain("mp3、m4a 或 wav");
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CLONE_SAMPLE_TOO_LARGE")).toContain("大小超出限制");
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CLONE_SELECTION_UNAVAILABLE")).toContain("音频样本暂存不可用");
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CLONE_UNAVAILABLE")).toContain("音色克隆服务暂时不可用");
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CLONE_DIALOG_UNAVAILABLE")).toContain("文件选择窗口");
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CLONE_MODEL_MISMATCH")).toContain("模型设置");
    // 配置类错误（缺 API Key 等）→ 引导去模型设置，而非「请稍后重试」
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CATALOG_CONFIG_UNAVAILABLE")).toContain("模型设置");
    expect(w.vm.friendlyVoiceCatalogError("VOICE_CATALOG_CONFIG_UNAVAILABLE")).toContain("配置");
    // 未知错误仍走兜底，不回退到函数文本
    expect(w.vm.friendlyVoiceCatalogError("SOME_UNKNOWN_X")).toContain("无法加载音色列表");
    w.unmount();
  });

  it("语音生成器默认选择已配置的多模态 TTS 模型（minimax-multimodal 优先于普通 TTS 服务商）", async () => {
    window.electronAPI.modelProviderList = vi.fn(async (category) => {
      if (category === "tts") {
        return {
          code: 0,
          data: [
            { id: "elevenlabs", name: "ElevenLabs", category: "tts", enabled: true, is_configured: true, models: ["eleven_multilingual_v2"] },
            { id: "minimax-multimodal", name: "MiniMax", category: "multimodal", enabled: true, is_configured: true, capabilities: ["llm", "tts", "image", "video"], capability_models: { tts: "speech-2.8-turbo" }, models: ["speech-2.8-turbo", "image-01"] },
          ],
        };
      }
      return { code: 0, data: [] };
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    await w.vm.loadS2VProviders();
    expect(w.vm.s2vConfig.voiceProvider).toBe("minimax-multimodal");
    expect(w.vm.s2vConfig.voiceModel).toBe("speech-2.8-turbo");
    w.unmount();
  });

  it("语音生成器默认选择多模态 TTS 模型时仍尊重用户显式保存过的选择", async () => {
    window.electronAPI.modelProviderList = vi.fn(async (category) => {
      if (category === "tts") {
        return {
          code: 0,
          data: [
            { id: "elevenlabs", name: "ElevenLabs", category: "tts", enabled: true, is_configured: true, models: ["eleven_multilingual_v2"] },
            { id: "minimax-multimodal", name: "MiniMax", category: "multimodal", enabled: true, is_configured: true, capabilities: ["tts"], capability_models: { tts: "speech-2.8-turbo" }, models: ["speech-2.8-turbo"] },
          ],
        };
      }
      return { code: 0, data: [] };
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "elevenlabs";
    w.vm.s2vConfig.voiceModel = "eleven_multilingual_v2";
    await w.vm.loadS2VProviders();
    expect(w.vm.s2vConfig.voiceProvider).toBe("elevenlabs");
    w.unmount();
  });

  it("无多模态 TTS 模型时回退普通 TTS 服务商首项", async () => {
    window.electronAPI.modelProviderList = vi.fn(async (category) => {
      if (category === "tts") {
        return {
          code: 0,
          data: [
            { id: "elevenlabs", name: "ElevenLabs", category: "tts", enabled: true, is_configured: true, models: ["eleven_multilingual_v2"] },
            { id: "openai-tts", name: "OpenAI TTS", category: "tts", enabled: true, is_configured: true, models: ["gpt-4o-mini-tts"] },
          ],
        };
      }
      return { code: 0, data: [] };
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    await w.vm.loadS2VProviders();
    expect(w.vm.s2vConfig.voiceProvider).toBe("elevenlabs");
    w.unmount();
  });

  it("选择本地音频文件后自动保存为克隆音色（默认名音色001，无需手动添加）", async () => {
    const cloneApi = await import("@/api/tts-voice-clone");
    cloneApi.chooseTtsVoiceCloneSamples.mockResolvedValue({
      code: 0,
      data: { selectionId: "sel-1", samples: [{ name: "a.wav", contentType: "audio/wav", durationSeconds: 12 }] },
    });
    cloneApi.addTtsVoiceClone.mockResolvedValue({
      code: 0,
      data: { voice: { id: "MiniMaxVoice_auto1", name: "音色001" } },
    });
    const catalogApi = await import("@/api/tts-voice-catalog");
    catalogApi.selectTtsVoice.mockResolvedValue({ code: 0, data: { selectedVoiceId: "MiniMaxVoice_auto1" } });

    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    w.vm.s2vVoiceCapability = { type: "user_clone", clone: { enabled: true } };
    await w.vm.chooseS2VVoiceCloneSamples();

    expect(cloneApi.chooseTtsVoiceCloneSamples).toHaveBeenCalled();
    expect(cloneApi.addTtsVoiceClone).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "minimax-multimodal",
      model: "speech-2.8-turbo",
      name: "音色001",
      selectionId: "sel-1",
      consent: true,
    }));
    expect(w.vm.s2vVoiceClones).toContainEqual(expect.objectContaining({ id: "MiniMaxVoice_auto1", name: "音色001" }));
    expect(w.vm.s2vConfig.voiceId).toBe("MiniMaxVoice_auto1");
    w.unmount();
  });

  it("自动克隆默认名按音色XXX递增，重命名后不回退旧序号", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vVoiceClones = [{ id: "a", name: "音色001" }, { id: "b", name: "音色002" }];
    expect(w.vm.nextS2VVoiceCloneName()).toBe("音色003");
    w.vm.s2vVoiceClones = [{ id: "a", name: "我的声音" }];
    expect(w.vm.nextS2VVoiceCloneName()).toBe("音色002");
    w.vm.s2vVoiceClones = [];
    expect(w.vm.nextS2VVoiceCloneName()).toBe("音色001");
    w.unmount();
  });

  it("克隆音色可在列表中重命名（保存后名称与下拉同步）", async () => {
    const cloneApi = await import("@/api/tts-voice-clone");
    cloneApi.renameTtsVoiceClone.mockResolvedValue({
      code: 0,
      data: { voice: { id: "MiniMaxVoice_auto1", name: "我的声音" } },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    w.vm.s2vVoiceClones = [{ id: "MiniMaxVoice_auto1", name: "音色001" }];
    w.vm.startS2VVoiceCloneRename("MiniMaxVoice_auto1");
    expect(w.vm.s2vVoiceCloneRenamingId).toBe("MiniMaxVoice_auto1");
    expect(w.vm.s2vVoiceCloneRenameDraft).toBe("音色001");
    w.vm.s2vVoiceCloneRenameDraft = "我的声音";
    await w.vm.renameS2VVoiceClone("MiniMaxVoice_auto1");
    expect(cloneApi.renameTtsVoiceClone).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "minimax-multimodal",
      model: "speech-2.8-turbo",
      voiceId: "MiniMaxVoice_auto1",
      name: "我的声音",
    }));
    expect(w.vm.s2vVoiceClones[0].name).toBe("我的声音");
    expect(w.vm.s2vVoiceCloneRenamingId).toBe("");
    expect(w.vm.s2vVoiceCloneRenameDraft).toBe("");
    w.unmount();
  });

  it("重命名失效克隆时保留 invalid 标记（不复活坏音色）", async () => {
    const cloneApi = await import("@/api/tts-voice-clone");
    cloneApi.renameTtsVoiceClone.mockResolvedValue({
      code: 0,
      data: { voice: { id: "01", name: "我的声音" } },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    w.vm.s2vVoiceClones = [{ id: "01", name: "音色001", invalid: true }];
    w.vm.startS2VVoiceCloneRename("01");
    w.vm.s2vVoiceCloneRenameDraft = "我的声音";
    await w.vm.renameS2VVoiceClone("01");
    expect(w.vm.s2vVoiceClones[0]).toMatchObject({ id: "01", name: "我的声音", invalid: true });
    w.unmount();
  });

  it("显式选择「自动 Edge TTS」后 loadS2VProviders 重入不被多模态默认覆盖", async () => {
    window.electronAPI.modelProviderList = vi.fn(async (category) => {
      if (category === "tts") {
        return {
          code: 0,
          data: [
            { id: "minimax-multimodal", name: "MiniMax", category: "multimodal", enabled: true, is_configured: true, capabilities: ["tts"], capability_models: { tts: "speech-2.8-turbo" }, models: ["speech-2.8-turbo"] },
          ],
        };
      }
      return { code: 0, data: [] };
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    // 模拟用户显式选择「自动 Edge TTS」（下拉选中 id='' 或快照恢复）
    w.vm.s2vVoiceProviderExplicitEdge = true;
    w.vm.s2vConfig.voiceProvider = "";
    w.vm.s2vConfig.voiceModel = "";
    await w.vm.loadS2VProviders();
    expect(w.vm.s2vConfig.voiceProvider).toBe("");
    w.unmount();
  });

  it("音色克隆区域不再显示「添加克隆音色」操作框（选择文件后自动保存）", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    // 旧的「名称输入 + 添加按钮」状态与计算属性已移除
    expect(w.vm.s2vVoiceCloneName).toBeUndefined();
    expect(w.vm.canAddS2VVoiceClone).toBeUndefined();
    // 展开克隆面板后：自动保存提示存在、手动添加按钮不存在
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vOpenSections.voice = true;
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    w.vm.s2vVoiceCapability = { type: "user_clone", clone: { enabled: true } };
    w.vm.s2vCloneOpen = true;
    await nextTick();
    expect(w.text()).toContain("自动保存为克隆音色");
    expect(w.text()).not.toContain("添加克隆音色");
    expect(w.find("input[placeholder='克隆音色名称']").exists()).toBe(false);
    w.unmount();
  });

  it("选择本地音频文件后克隆期间立即显示占位行与进行中反馈（2026-08-13 体验优化）", async () => {
    const cloneApi = await import("@/api/tts-voice-clone");
    cloneApi.chooseTtsVoiceCloneSamples.mockResolvedValue({
      code: 0,
      data: { selectionId: "sel-1", samples: [{ name: "a.wav", contentType: "audio/wav", durationSeconds: 12 }] },
    });
    let resolveAdd;
    cloneApi.addTtsVoiceClone.mockImplementation(() => new Promise((resolve) => { resolveAdd = resolve; }));
    const catalogApi = await import("@/api/tts-voice-catalog");
    catalogApi.selectTtsVoice.mockResolvedValue({ code: 0, data: { selectedVoiceId: "MiniMaxVoice_auto1" } });

    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vOpenSections.voice = true;
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    w.vm.s2vVoiceCapability = { type: "user_clone", clone: { enabled: true } };
    w.vm.s2vCloneOpen = true;
    await nextTick();

    const flow = w.vm.chooseS2VVoiceCloneSamples();
    // 等 choose-samples 解析、add 进入挂起（克隆远端未返回）
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(cloneApi.addTtsVoiceClone).toHaveBeenCalled();
    expect(w.vm.s2vVoiceClonePending).toMatchObject({ name: "音色001", sampleCount: 1 });
    expect(w.vm.s2vVoiceCloneLoading).toBe(true);
    // 模板：占位行 + 进行中按钮文案 + role=status 状态行
    expect(w.find('[data-testid="s2v-voice-clone-pending-row"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-voice-clone-status"]').exists()).toBe(true);
    expect(w.text()).toContain("创建中…");
    expect(w.text()).toContain("正在克隆…");
    expect(w.text()).toContain("正在上传并克隆音色");

    // 完成：占位行替换为真实行 + 自动选中 + 成功轻提示
    resolveAdd({ code: 0, data: { voice: { id: "MiniMaxVoice_auto1", name: "音色001" } } });
    await flow;
    await nextTick();
    expect(w.vm.s2vVoiceClonePending).toBe(null);
    expect(w.vm.s2vVoiceClones).toContainEqual(expect.objectContaining({ id: "MiniMaxVoice_auto1", name: "音色001" }));
    expect(w.vm.s2vConfig.voiceId).toBe("MiniMaxVoice_auto1");
    expect(w.vm.s2vOptionsToast).toContain("已添加克隆音色");
    w.unmount();
  });

  it("克隆失败时占位行先出现后清除并显示错误（不残留创建中状态，2026-08-13）", async () => {
    const cloneApi = await import("@/api/tts-voice-clone");
    cloneApi.chooseTtsVoiceCloneSamples.mockResolvedValue({
      code: 0,
      data: { selectionId: "sel-1", samples: [{ name: "a.wav", contentType: "audio/wav", durationSeconds: 12 }] },
    });
    let resolveAdd;
    cloneApi.addTtsVoiceClone.mockImplementation(() => new Promise((resolve) => { resolveAdd = resolve; }));

    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    w.vm.s2vVoiceCapability = { type: "user_clone", clone: { enabled: true } };
    const flow = w.vm.chooseS2VVoiceCloneSamples();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    // 失败前占位行确实出现过（进行中反馈成立）
    expect(w.vm.s2vVoiceClonePending).not.toBe(null);

    resolveAdd({ code: -1, message: "VOICE_CLONE_UNAVAILABLE" });
    await flow;
    await nextTick();
    expect(w.vm.s2vVoiceClonePending).toBe(null);
    expect(w.vm.s2vVoiceCloneSelection).toBe(null);
    expect(w.vm.s2vVoiceCloneError).toContain("音色克隆服务暂时不可用");
    expect(w.vm.s2vVoiceClones).toEqual([]);
    w.unmount();
  });

  it("克隆进行中 provider/设置重载后旧请求返回不复活占位行、不卡 loading（2026-08-13 竞态回归）", async () => {
    const cloneApi = await import("@/api/tts-voice-clone");
    cloneApi.chooseTtsVoiceCloneSamples.mockResolvedValue({
      code: 0,
      data: { selectionId: "sel-1", samples: [{ name: "a.wav", contentType: "audio/wav", durationSeconds: 12 }] },
    });
    let resolveAdd;
    cloneApi.addTtsVoiceClone.mockImplementation(() => new Promise((resolve) => { resolveAdd = resolve; }));
    const catalogApi = await import("@/api/tts-voice-catalog");
    catalogApi.selectTtsVoice.mockResolvedValue({ code: 0, data: { selectedVoiceId: "MiniMaxVoice_auto1" } });

    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    w.vm.s2vVoiceCapability = { type: "user_clone", clone: { enabled: true } };
    const flow = w.vm.chooseS2VVoiceCloneSamples();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(w.vm.s2vVoiceClonePending).not.toBe(null);
    expect(w.vm.s2vVoiceCloneLoading).toBe(true);

    // 模拟 loadS2VVoiceData 重载：requestId 自增 + reset 清状态（2026-08-12 弹窗关闭刷新信号同语义）
    w.vm.s2vVoiceCloneRequestId += 1;
    w.vm.resetS2VVoiceData();
    expect(w.vm.s2vVoiceClonePending).toBe(null);
    expect(w.vm.s2vVoiceCloneLoading).toBe(false);

    // 旧请求此刻返回成功 → 守卫拦截：不 push 旧 voice、不复活占位行、loading 保持 false
    resolveAdd({ code: 0, data: { voice: { id: "MiniMaxVoice_auto1", name: "音色001" } } });
    await flow;
    await nextTick();
    expect(w.vm.s2vVoiceClonePending).toBe(null);
    expect(w.vm.s2vVoiceCloneLoading).toBe(false);
    expect(w.vm.s2vVoiceClones).toEqual([]);
    w.unmount();
  });

  it("pipelineList 返回异常格式时展示默认加载错误", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValueOnce({});
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 0));

    expect(w.vm.pipelineError).toBe("加载失败");
    expect(w.vm.pipelineLoading).toBe(false);
  });

  it("pipelineList 拒绝时保留错误并结束加载态", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockRejectedValueOnce(new Error("IPC 不可用"));
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 0));

    expect(w.vm.pipelineError).toBe("IPC 不可用");
    expect(w.vm.pipelineLoading).toBe(false);
  });
});

describe("CreateView - quick render", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  it("startQuickRender calls renderStart with text cuts", async () => {
    const mocks = await import("@/api/publisher");
    mocks.renderStart.mockResolvedValue({ code: 0, data: { outputPath: "/tmp/test.mp4" } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    w.vm.quickText = "scene1\nscene2\nscene3";
    await w.vm.startQuickRender();
    await nextTick();
    expect(mocks.renderStart).toHaveBeenCalled();
    const arg = mocks.renderStart.mock.calls[0][0];
    expect(arg.props.cuts.length).toBe(3);
    expect(arg.props.cuts[0].text).toBe("scene1");
  });

  it("startQuickRender sets quickError on failure", async () => {
    const mocks = await import("@/api/publisher");
    mocks.renderStart.mockResolvedValue({ code: 1, message: "render failed" });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    w.vm.quickText = "test";
    await w.vm.startQuickRender();
    await nextTick();
    expect(w.vm.quickError).toBe("render failed");
    expect(w.vm.quickRendering).toBe(false);
  });

  it("cancelQuickRender calls renderCancel", async () => {
    const mocks = await import("@/api/publisher");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.quickRendering = true;
    await w.vm.cancelQuickRender();
    expect(mocks.renderCancel).toHaveBeenCalled();
    expect(w.vm.quickRendering).toBe(false);
  });

  it("aiWrite generates content", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "quick";
    await nextTick();
    w.vm.aiWrite();
    await new Promise(r => setTimeout(r, 1100));
    await nextTick();
    expect(w.vm.quickText.length).toBeGreaterThan(0);
  });

  it("viewQuickResult navigates to result page", async () => {
    const push = vi.fn();
    router.push = push;
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.quickResult = { outputPath: "/tmp/video.mp4" };
    w.vm.viewQuickResult();
    expect(push).toHaveBeenCalledWith({ path: "/create/result", query: { path: "/tmp/video.mp4" } });
  });

  // ── 带文案进入（rewrite-to-video-entry 2026-09-13）：_loadDraftForRewrite 预填 + 灰显 ──

  it("_loadDraftForRewrite 预填成功后置 textPrefilledFromDraft 并填入文案", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValueOnce({
      code: 0,
      data: [{ id: "draft_1", content: "改写后的文案内容" }],
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await w.vm._loadDraftForRewrite("draft_1");
    await nextTick();
    expect(w.vm.pipelineText).toBe("改写后的文案内容");
    expect(w.vm.inputMode).toBe("text");
    expect(w.vm.textPrefilledFromDraft).toBe(true);
    w.unmount();
  });

  it("_loadDraftForRewrite 草稿带 title 时带入发布标题字段（≤20 字）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValueOnce({
      code: 0,
      data: [{ id: "draft_title", content: "改写后的文案内容", title: "夏天来了" }],
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await w.vm._loadDraftForRewrite("draft_title");
    await nextTick();
    expect(w.vm.pipelineText).toBe("改写后的文案内容");
    expect(w.vm.s2vConfig.title).toBe("夏天来了");
    w.unmount();
  });

  it("_loadDraftForRewrite 草稿不存在时显示失败提示且不置灰显 flag", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValueOnce({ code: 0, data: [] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await w.vm._loadDraftForRewrite("missing");
    await nextTick();
    expect(w.vm.textPrefilledFromDraft).toBe(false);
    expect(w.vm.s2vOptionsToast).toContain("未找到要带入的草稿");
    w.unmount();
  });

  it("_loadDraftForRewrite 空 content 草稿不置灰显 flag 也不预填", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValueOnce({
      code: 0,
      data: [{ id: "draft_empty", content: "" }],
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await w.vm._loadDraftForRewrite("draft_empty");
    await nextTick();
    // 空文案草稿不视为「带文案进入」：不预填、不灰显非文案型流水线
    expect(w.vm.pipelineText).toBe("");
    expect(w.vm.textPrefilledFromDraft).toBe(false);
    w.unmount();
  });

  it("textPrefilledFromDraft 时 selectPipeline 拦截非文案型流水线", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.textPrefilledFromDraft = true;
    w.vm.selectPipeline({ name: "cinematic", category: "cinematic" });
    await nextTick();
    expect(w.vm.selectedPipeline).toBeNull();
    // 文案型流水线正常进入
    w.vm.selectPipeline({ name: "story2video-compose", category: "generated" });
    await nextTick();
    expect(w.vm.selectedPipeline?.name).toBe("story2video-compose");
    w.unmount();
  });

  it("超长草稿预填不在加载时截断，选中编排流水线时才截断到 6000 码点", async () => {
    const mocks = await import("@/api/publisher");
    const longText = "字".repeat(6500);
    mocks.draftList.mockResolvedValueOnce({
      code: 0,
      data: [{ id: "draft_long", content: longText }],
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await w.vm._loadDraftForRewrite("draft_long");
    await nextTick();
    // 预填时不截断：非编排流水线（如 talking-head）无 6000 上限
    expect(w.vm.pipelineText.length).toBe(6500);
    // 选中编排流水线时截断 + 弹窗提示
    w.vm.selectPipeline({ name: "story2video-compose", category: "generated" });
    await nextTick();
    expect(Array.from(w.vm.pipelineText).length).toBe(6000);
    expect(w.vm.story2videoErrorDialog?.visible).toBe(true);
    w.unmount();
  });

  it("renderStart 拒绝时展示异常并复位渲染状态", async () => {
    const mocks = await import("@/api/publisher");
    mocks.renderStart.mockRejectedValueOnce(new Error("渲染 IPC 缺失"));
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.quickText = "测试文案";

    await expect(w.vm.startQuickRender()).resolves.toBeUndefined();

    expect(w.vm.quickError).toBe("渲染异常: 渲染 IPC 缺失");
    expect(w.vm.quickRendering).toBe(false);
    expect(w.vm.quickResult).toBeNull();
  });

  it("renderStart 返回异常格式时展示默认错误并复位", async () => {
    const mocks = await import("@/api/publisher");
    mocks.renderStart.mockResolvedValueOnce({});
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.quickText = "测试文案";

    await w.vm.startQuickRender();

    expect(w.vm.quickError).toBe("渲染失败");
    expect(w.vm.quickRendering).toBe(false);
  });

  it("图库渲染只提交图片预览并按五秒生成镜头", async () => {
    const mocks = await import("@/api/publisher");
    mocks.renderStart.mockResolvedValueOnce({ code: 0, data: { taskId: "r1" } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.quickMode = "gallery";
    w.vm.quickImages = [
      { name: "a.png", preview: "data:image/png;base64,a" },
      { name: "b.png", preview: "data:image/png;base64,b" },
    ];

    await w.vm.startQuickRender();

    const cuts = mocks.renderStart.mock.calls.at(-1)[0].props.cuts;
    expect(cuts).toEqual([
      { id: "scene-0", type: "anime_scene", images: ["data:image/png;base64,a"], animation: "ken-burns", in_seconds: 0, out_seconds: 4.5 },
      { id: "scene-1", type: "anime_scene", images: ["data:image/png;base64,b"], animation: "ken-burns", in_seconds: 5, out_seconds: 9.5 },
    ]);
  });
});

describe("CreateView - callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  it("onRenderComplete sets quickResult", async () => {
    const mocks = await import("@/api/publisher");
    mocks.onRenderComplete.mockImplementation(cb => { cb({ outputPath: "/tmp/test.mp4" }); return vi.fn(); });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 0));
    expect(w.vm.quickResult).toEqual({ outputPath: "/tmp/test.mp4" });
  });

  it("onRenderError sets quickError", async () => {
    const mocks = await import("@/api/publisher");
    mocks.onRenderError.mockImplementation(cb => { cb({ message: "render failed" }); return vi.fn(); });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 0));
    expect(w.vm.quickError).toBe("render failed");
  });

  it("onRenderInstallProgress updates installLog", async () => {
    const mocks = await import("@/api/publisher");
    mocks.onRenderInstallProgress.mockImplementation(cb => { cb({ text: "installing..." }); return vi.fn(); });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 0));
    expect(w.vm.installLog).toContain("installing");
  });
});

describe("CreateView - S2V orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  it("isOrchestratedPipeline returns true for story2video-compose", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    expect(w.vm.isOrchestratedPipeline("story2video-compose")).toBe(true);
  });

  it("isOrchestratedPipeline returns false for other pipelines", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    expect(w.vm.isOrchestratedPipeline("cinematic")).toBe(false);
    expect(w.vm.isOrchestratedPipeline("talking-head")).toBe(false);
  });

  it("has s2vConfig with required fields", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    expect(w.vm.s2vConfig).toHaveProperty("imageStyle");
    expect(w.vm.s2vConfig).toHaveProperty("imageProvider");
    expect(w.vm.s2vConfig).toHaveProperty("voiceId");
    expect(w.vm.s2vConfig).toHaveProperty("voiceProvider");
    expect(w.vm.s2vConfig).toHaveProperty("voiceSpeed");
    expect(w.vm.s2vConfig).toHaveProperty("voiceVolume");
    // 参数治理（7.1.19/R2）：系统管理参数前端不声明（R1：voicePitch/creativeLevel/splitBaseWordsPerSecond；R2：splitSpeechRate/concurrency/autoAdvance）
    expect(w.vm.s2vConfig).not.toHaveProperty("voicePitch");
    expect(w.vm.s2vConfig).not.toHaveProperty("creativeLevel");
    expect(w.vm.s2vConfig).not.toHaveProperty("splitBaseWordsPerSecond");
    expect(w.vm.s2vConfig).not.toHaveProperty("splitSpeechRate");
    expect(w.vm.s2vConfig).not.toHaveProperty("concurrency");
    expect(w.vm.s2vConfig).not.toHaveProperty("autoAdvance");
    expect(w.vm.s2vConfig.splitLanguage).toBe("auto");
  });

  it("does not expose unconfigured static image providers in the Story2Video selector", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    const optionValues = w.findAll("option").map(option => option.attributes("value"));
    expect(optionValues).toContain("");
    expect(optionValues).not.toContain("dall-e");
    expect(optionValues).not.toContain("openai-image");
    expect(optionValues).not.toContain("comfyui");
    w.unmount();
  });

  it("Story2Video 隐藏通用视觉、LLM、预算和手动检查点控制", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    expect(w.text()).not.toContain("视觉风格");
    expect(w.text()).not.toContain("LLM 模型");
    expect(w.text()).not.toContain("温度:");
    expect(w.text()).not.toContain("预算模式");
    expect(w.text()).not.toContain("预算上限");
    expect(w.text()).not.toContain("检查点策略");
    w.unmount();
  });

  it("Story2Video 隐藏无效的比例、情绪、字体和离线占位图选项", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    expect(w.text()).not.toContain("宽高比");
    expect(w.text()).not.toContain("情绪");
    expect(w.text()).not.toContain("字幕字体");
    expect(w.text()).not.toContain("离线占位图");
    expect(w.find("#s2v-voice-options").exists()).toBe(false);
    expect(w.text()).not.toContain("音调:");
    expect(w.text()).not.toContain("并发数");
    expect(w.text()).not.toContain("创意强度:");
    expect(w.text()).not.toContain("自动推进");
    expect(w.text()).not.toContain("仅创建运行");
    w.unmount();
  });

  it("Story2Video 负向提示词输入与运行配置保持 500 字符上限一致", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    const negativePrompt = w.findAll(".config-item").find(item => item.find("label").text() === "负向提示词");
    expect(negativePrompt.find("textarea").attributes("maxlength")).toBe("500");
    w.unmount();
  });

  it("Story2Video 图片生成器只列出已启用且已配置的图片服务商", async () => {
    const listImageProviders = vi.fn().mockResolvedValue({
      code: 0,
      data: [
        { id: "minimax-image", name: "MiniMax Image", category: "image", enabled: true, is_configured: true },
        { id: "unconfigured-image", name: "未配置图片", category: "image", enabled: true, is_configured: false },
        { id: "disabled-image", name: "Disabled Image", category: "image", enabled: false, is_configured: true },
      ],
    });
    window.electronAPI = { modelProviderList: listImageProviders };
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    const imageProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "图片生成器");
    expect(listImageProviders).toHaveBeenCalledWith("image");
    expect(imageProviderItem.find('option[value="minimax-image"]').text()).toContain("MiniMax Image");
    expect(imageProviderItem.find('option[value="unconfigured-image"]').exists()).toBe(false);
    expect(imageProviderItem.find('option[value="disabled-image"]').exists()).toBe(false);
    w.unmount();
  });

  it("Story2Video 图片/语音下拉并入多模态模型并限定语音模型为 tts 能力模型", async () => {
    const multimodal = {
      id: "minimax-multimodal",
      name: "MiniMax",
      category: "multimodal",
      enabled: true,
      is_configured: true,
      capabilities: ["llm", "tts", "image", "video"],
      capability_models: { llm: "MiniMax-M2.7", tts: "speech-2.8-turbo", image: "image-01", video: "MiniMax-Hailuo-2.3" },
      models: ["speech-2.8-turbo", "image-01", "MiniMax-Hailuo-2.3", "MiniMax-M2.7"],
    };
    const listProviders = vi.fn(async (category) => {
      if (category === "image") return { code: 0, data: [
        { id: "minimax-image", name: "MiniMax Image", category: "image", enabled: true, is_configured: true },
        { id: "unconfigured-image", name: "未配置图片", category: "image", enabled: true, is_configured: false },
        multimodal,
      ] };
      if (category === "tts") return { code: 0, data: [
        { id: "minimax-tts", name: "MiniMax TTS", category: "tts", enabled: true, is_configured: true, models: ["speech-2.8-turbo"] },
        { id: "unconfigured-tts", name: "未配置语音", category: "tts", enabled: true, is_configured: false, models: ["speech-2.8-turbo"] },
        multimodal,
      ] };
      return { code: 0, data: [] };
    });
    window.electronAPI = { modelProviderList: listProviders };
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    // 图片生成器：多模态以「（多模态）」后缀展示；未配置 provider 不出现
    const imageProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "图片生成器");
    expect(imageProviderItem.find('option[value="minimax-multimodal"]').text()).toContain("MiniMax（多模态）");
    expect(imageProviderItem.find('option[value="unconfigured-image"]').exists()).toBe(false);

    // 语音生成器：多模态出现在 tts 能力选择器中；未配置 provider 不出现
    const voiceProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "语音生成器");
    expect(voiceProviderItem.find('option[value="minimax-multimodal"]').text()).toContain("MiniMax（多模态）");
    expect(voiceProviderItem.find('option[value="unconfigured-tts"]').exists()).toBe(false);

    // 选中多模态：语音模型只显示 tts 能力模型，默认模型取 capability_models.tts
    w.vm.s2vConfig.voiceProvider = "minimax-multimodal";
    await nextTick();
    expect(w.vm.s2vVoiceModelOptions).toEqual(["speech-2.8-turbo"]);
    expect(w.vm.getS2VDefaultVoiceModel("minimax-multimodal")).toBe("speech-2.8-turbo");
    w.unmount();
  });

  it("Story2Video 无可用图片生成器时下拉显示「无」并给出配置提示（2026-08-12 Bug 回归）", async () => {
    window.electronAPI = {
      modelProviderList: vi.fn(async () => ({ code: 0, data: [] })),
    };
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    const imageProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "图片生成器");
    expect(imageProviderItem.find('option[value=""]').text()).toBe("无");
    expect(imageProviderItem.text()).toContain("未找到可用的图片生成器");
    expect(w.vm.s2vConfig.imageProvider).toBe("");
    w.unmount();
  });

  it("Story2Video 设置弹窗关闭后重新加载服务商列表（新增多模态模型立即出现在下拉且音色克隆可用，2026-08-12 Bug 回归）", async () => {
    const { notifySettingsDialogClosed } = await import("@/stores/settings-dialog");
    const multimodal = {
      id: "minimax-multimodal",
      name: "MiniMax",
      category: "multimodal",
      enabled: true,
      is_configured: true,
      capabilities: ["llm", "tts", "image"],
      capability_models: { tts: "speech-2.8-turbo", image: "image-01" },
      models: ["speech-2.8-turbo", "image-01"],
    };
    // 首次挂载：还没有任何模型 → 图片生成器显示「无」，下拉中不出现 MiniMax
    window.electronAPI = {
      modelProviderList: vi.fn(async () => ({ code: 0, data: [] })),
    };
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    let imageProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "图片生成器");
    expect(imageProviderItem.find('option[value="minimax-multimodal"]').exists()).toBe(false);
    expect(imageProviderItem.find('option[value=""]').text()).toBe("无");
    expect(w.vm.s2vVoiceCapability).toBeNull();

    // 模拟「设置 → 模型设置」新增 MiniMax 后关闭弹窗：CreateView 应重新拉取服务商列表
    window.electronAPI = {
      modelProviderList: vi.fn(async (category) => {
        if (category === "image" || category === "tts") return { code: 0, data: [multimodal] };
        return { code: 0, data: [] };
      }),
    };
    notifySettingsDialogClosed();
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    await nextTick();

    // 图片生成器下拉出现 MiniMax（多模态后缀），「无」占位项消失
    imageProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "图片生成器");
    expect(imageProviderItem.find('option[value="minimax-multimodal"]').text()).toContain("MiniMax（多模态）");
    expect(imageProviderItem.find('option[value=""]').exists()).toBe(false);

    // 语音生成器下拉出现 MiniMax，且自动选中 → 音色克隆面板可用
    const voiceProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "语音生成器");
    expect(voiceProviderItem.find('option[value="minimax-multimodal"]').text()).toContain("MiniMax（多模态）");
    expect(w.vm.s2vConfig.voiceProvider).toBe("minimax-multimodal");
    expect(w.vm.s2vVoiceCapability).toMatchObject({ type: "user_clone", clone: { enabled: true } });
    expect(w.find('[data-testid="s2v-voice-clone-toggle"]').exists()).toBe(true);
    expect(w.text()).toContain("音色复制 / 克隆");
    w.unmount();
  });

  it("Story2Video 重新加载时清空已不存在的图片生成器选中值（避免下拉空白选中项，2026-08-12 Bug 回归）", async () => {
    window.electronAPI = {
      modelProviderList: vi.fn(async () => ({ code: 0, data: [] })),
    };
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    // 用户曾选择图片 provider，但该 provider 已被删除/停用 → 重新加载后清空，而不是空白选中
    w.vm.s2vConfig.imageProvider = "stale-provider";
    w.vm.s2vConfig.imageModel = "stale-model";
    await w.vm.loadS2VProviders();
    expect(w.vm.s2vConfig.imageProvider).toBe("");
    expect(w.vm.s2vConfig.imageModel).toBe("");
    w.unmount();
  });

  it("Story2Video 重载时 IPC 失败保留旧列表与已选图片生成器（不把临时故障当未配置，2026-08-12 审查 M1 回归）", async () => {
    const imageProvider = { id: "minimax-image", name: "MiniMax Image", category: "image", enabled: true, is_configured: true };
    window.electronAPI = {
      modelProviderList: vi.fn(async (category) => {
        if (category === "image") return { code: 0, data: [imageProvider] };
        return { code: 0, data: [] };
      }),
    };
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    expect(w.vm.s2vImageProviders[0].id).toBe("minimax-image");
    expect(w.vm.s2vConfig.imageProvider).toBe("minimax-image");

    // 模拟重载时 IPC 瞬时失败（reject）：必须保留旧列表与旧选中值，禁止清空
    window.electronAPI = {
      modelProviderList: vi.fn(async () => { throw new Error("ipc busy"); }),
    };
    await w.vm.loadS2VProviders();
    expect(w.vm.s2vImageProviders[0].id).toBe("minimax-image");
    expect(w.vm.s2vConfig.imageProvider).toBe("minimax-image");
    w.unmount();
  });

  it("Story2Video 无可用视频生成器时下拉显示「无」（与图片对齐，2026-08-12 审查 M2 回归）", async () => {
    window.electronAPI = {
      modelProviderList: vi.fn(async () => ({ code: 0, data: [] })),
    };
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.s2vConfig.videoMode = "fixed";
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    const videoProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "视频生成器");
    expect(videoProviderItem.find('option[value=""]').text()).toBe("无");
    expect(videoProviderItem.text()).toContain("未找到可用的视频生成器");
    w.unmount();
  });

  it("Story2Video 无 TTS 服务商时语音生成器保留「自动 Edge TTS」并给出配置引导（2026-08-12 复审 W1 回归）", async () => {
    window.electronAPI = {
      modelProviderList: vi.fn(async () => ({ code: 0, data: [] })),
    };
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    const voiceProviderItem = w.findAll(".config-item").find(item => item.find("label").text() === "语音生成器");
    // 常驻「自动 Edge TTS」兜底（value=""）仍存在，下拉不空白
    expect(voiceProviderItem.find('option[value=""]').text()).toBe("自动 Edge TTS");
    // 空态配置引导提示 + 前往配置链接
    expect(voiceProviderItem.text()).toContain("自动 Edge TTS");
    expect(voiceProviderItem.text()).toContain("音色克隆");
    expect(voiceProviderItem.find('a.config-hint-link').exists()).toBe(true);
    w.unmount();
  });

  it.each([
    { code: 1, message: "轮询 IPC 失败" },
    { code: 0, data: null },
  ])("编排轮询遇到无效响应时保留安全状态并显示可重试提示", async (response) => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValueOnce(response);
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.orchestrationRunId = "run-poll-error";
    w.vm.pollTimer = 1;

    await w.vm.updateOrchestrationStatus();

    expect(w.vm.orchestrationError).toBe("");
    expect(w.vm.story2videoErrorDialog.visible).toBe(false);
    expect(w.vm.pipelineProgressStatusError).toContain("进度暂时不可用");
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.pollTimer).toBe(1);
    w.unmount();
  });

  it("编排轮询终态失败时显示状态中的具体错误并停止轮询", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValueOnce({
      code: 0,
      data: {
        context: {},
        status: { status: "failed", error: "图片生成服务拒绝请求" },
      },
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.orchestrationRunId = "run-terminal-error";
    w.vm.pollTimer = 1;

    await w.vm.updateOrchestrationStatus();

    expect(w.vm.orchestrationError).toBe("");
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.operation_failed");
    expect(w.vm.pipelineRunStatus).toMatchObject({ status: "failed" });
    expect(w.vm.pollTimer).toBeNull();
    w.unmount();
  });

  it("检查点推进返回失败结果时显示具体错误", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineAdvanceToNextCheckpoint.mockResolvedValueOnce({
      code: 0,
      data: { success: false, error: "图片服务商未配置 API Key" },
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.orchestrationRunId = "run-advance-error";

    await w.vm.advanceOrchestration();

    expect(w.vm.orchestrationError).toBe("");
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.model_api_key_required");
    expect(w.vm.pipelineRunStatus).toMatchObject({ status: "failed" });
    w.unmount();
  });

  it("完成但缺少可预览视频时使用应用内弹窗", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    const handled = w.vm.applyOrchestrationOutcome({
      completed: true,
      context: { story2videoProject: { projectId: "project-no-preview" } },
    });

    expect(handled).toBe(true);
    expect(w.vm.orchestrationError).toBe("");
    expect(w.vm.story2videoErrorDialog).toEqual({ visible: true, detail: '', messageKey:  "story2video.preview_missing",
      messageParams: {},
      rawError: '',
    });
    expect(alertSpy).not.toHaveBeenCalled();

    alertSpy.mockRestore();
    w.unmount();
  });
  it("Story2Video 模型配置错误使用应用内弹窗，不调用原生 alert", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({
      code: -1,
      message: "Story2Video 默认 LLM 不可用，请先完成模型设置",
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", description: "test", stages: [], category: "generated" };
    w.vm.pipelineText = "测试文案";

    await w.vm.startPipeline();
    await nextTick();

    expect(w.vm.story2videoErrorDialog).toEqual({ visible: true, detail: '', messageKey:  "story2video.model_configuration_required",
      messageParams: {},
      rawError: "Story2Video 默认 LLM 不可用，请先完成模型设置",
    });
    expect(alertSpy).not.toHaveBeenCalled();

    w.vm.closeStory2VideoErrorDialog();
    await nextTick();
    expect(w.vm.story2videoErrorDialog.visible).toBe(false);
    alertSpy.mockRestore();
    w.unmount();
  });
  it("Story2Video IPC 权限拒绝显示登录/权益提示，不回退为泛化失败", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({
      code: -3,
      message: "当前许可证无权访问 pipeline:startOrchestrated",
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", description: "test", stages: [], category: "generated" };
    w.vm.pipelineText = "1";

    await w.vm.startPipeline();

    expect(w.vm.story2videoErrorDialog).toEqual({ visible: true, detail: '', messageKey:  "story2video.access_denied",
      messageParams: {},
      rawError: "当前许可证无权访问 pipeline:startOrchestrated",
    });
    w.unmount();
  });
  it("Story2Video 在调用 IPC 前拒绝超过 6000 个 Unicode 字符的文案", async () => {
    const mocks = await import("@/api/publisher");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "😀".repeat(6001);

    await w.vm.startPipeline();

    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
    expect(w.vm.story2videoErrorDialog).toMatchObject({
      visible: true,
      messageKey: "story2video.text_too_long",
      messageParams: { max: 6000, maxFormatted: "6,000" },
    });
    w.unmount();
  });

  it("startPipeline dispatches to orchestrated for story2video-compose", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-123" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "running" }, context: {} } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", description: "test", stages: [], category: "generated" };
    w.vm.pipelineText = "test text";
    await w.vm.startPipeline();
    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalled();
    expect(mocks.pipelineStart).not.toHaveBeenCalled();
    // 启动即前台跟踪（2026-08-21 交互修订）：保留 runId、拉取实时进度并启动轮询
    expect(w.vm.orchestrationRunId).toBe("run-123");
    expect(w.vm.pipelineRunStatus).not.toBeNull();
    expect(mocks.pipelineGetRunContext).toHaveBeenCalled();
    expect(w.vm.pollTimer).not.toBeNull();
    expect(w.vm.s2vOptionsToast).toContain("实时展示进度");
    expect(w.vm.canStartPipeline).toBe(false);
    expect(w.vm.startingPipeline).toBe(false);
    w.unmount();
  });

  it("后端返回乱序列表时仍将 Story2Video 显示在首位", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({
      code: 0,
      data: [
        { name: "cinematic", description: "电影", category: "generated" },
        { name: "story2video-compose", description: "Story2Video", category: "generated" },
        { name: "animated-explainer", description: "动画", category: "generated" },
      ],
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await w.vm.loadPipelines();

    expect(w.vm.pipelines.map(pipeline => pipeline.name)).toEqual([
      "story2video-compose", "video-clone", "film-engineering", "cinematic", "animated-explainer",
    ]);
    expect(w.find('[data-pipeline-id="story2video-compose"]').exists()).toBe(true);
    expect(w.find('[data-pipeline-id="video-clone"]').exists()).toBe(true);
    expect(w.find('[data-pipeline-id="film-engineering"]').exists()).toBe(true);
    w.unmount();
  });
  it("流水线卡片优先显示后端 stageCount", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.pipelineLoading = false;
    w.vm.pipelines = [{
      name: "story2video-compose",
      description: "test",
      category: "generated",
      stageCount: 6,
      estimatedCost: "high",
    }];
    await nextTick();
    expect(w.find(".stage-count").text()).toBe("6 阶段");
    w.unmount();
  });

  it("S2V 编排发送版本化 text 配置并使用独立输出参数", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-contract" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "唐朝长安的夜景";
    w.vm.selectedStyle = "cinematic-dark";
    w.vm.checkpointPolicy = "none";
    w.vm.outputConfig = { resolution: "3840x2160", fps: 60, format: "mp4" };
    w.vm.s2vOutputConfig = { resolution: "1080x1920", fps: 24, format: "webm" };
    w.vm.s2vConfig = {
      ...w.vm.s2vConfig,
      contentType: "history",
      imageStyle: "watercolor",
      imageProvider: "local-diffusion",
      imageEffect: "pan-left",
      voiceProvider: "piper",
      voiceId: "custom-voice-id",
      voiceSpeed: 1.2,
      voiceVolume: 0.8,
      transition: "slide-right",
      subtitleEnabled: false,      subtitleSize: "size4",
      subtitleStyleName: "style2",
      bgmPath: "C:/media/bgm.mp3",
      bgmVolume: 7,
      splitLanguage: "auto",
      splitMode: "precise",
      splitMaxSentenceLength: 120,
      splitTargetSeconds: 4,
      promptStyle: "anime",
      maxPromptLength: 700,
      watermarkText: "测试水印",
      watermarkConfig: { enabled: false, position: "center", fontSize: 32, opacity: 0.4, color: "white" },
      platforms: ["bilibili"],
      publishEnabled: true,
      title: "长安夜景",
      tagsText: "历史,夜景",
    };

    await w.vm.startPipeline();

    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalledWith("story2video-compose", expect.objectContaining({
      text: "唐朝长安的夜景",
      inputMode: "text",
      checkpointPolicy: "none",
      autoAdvance: true,
      story2videoTextConfig: expect.objectContaining({
        version: 1,
        mode: "text",
        prompt: "唐朝长安的夜景",
        size: "1080x1920",
        contentType: "history",
        split: expect.objectContaining({ language: "auto", mode: "precise", maxSentenceLength: 120, targetSeconds: 4, baseWordsPerSecond: 3.3 }),
        optimize: expect.objectContaining({ style: "anime", maxLength: 700 }),
        image: expect.objectContaining({ provider: "local-diffusion", style: "watercolor", effect: "pan-left", aspectRatio: "9:16" }),
        voice: expect.objectContaining({ provider: "piper", id: "custom-voice-id", speed: 1.2, volume: 0.8 }),
        subtitle: expect.objectContaining({ enabled: false, size: "size4", style: "style2" }),
        bgm: { enabled: true, path: "C:/media/bgm.mp3", volume: 7 },
        transition: "slide-right",
        // 水印选项（watermark-options）：UI 配置原样透传，enabled/text 由文字输入派生
        watermark: expect.objectContaining({ position: "center", fontSize: 32, opacity: 0.4, enabled: true, text: "测试水印" }),
        output: { fps: 24, format: "webm" },
        publish: expect.objectContaining({ enabled: true, platforms: ["bilibili"], title: "长安夜景", tags: ["历史", "夜景"] }),
      }),
    }));
    const request = mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1].story2videoTextConfig;
    expect(request).not.toHaveProperty("seconds");
    // 参数治理（7.1.19）：提交不携带系统管理参数（creativeLevel/voice.pitch），由 normalizer 默认兜底
    expect(request.optimize).not.toHaveProperty("creativeLevel");
    expect(request.voice).not.toHaveProperty("pitch");
    // 参数治理 R2：提交不携带 split.speechRate（normalizer 以 voice.speed 派生）与顶层 concurrency（默认 3 兜底）
    expect(request.split).not.toHaveProperty("speechRate");
    expect(request).not.toHaveProperty("concurrency");
    // split.baseWordsPerSecond 仍随提交按语言表显式下发（auto → 3.3），与 normalizer 语言表兜底同源
    expect(request.split.baseWordsPerSecond).toBe(3.3);
    // params 保留字面量 autoAdvance: true（流水线自动推进）
    expect(mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1].autoAdvance).toBe(true);
    // 创作模式（2026-08-12）：默认 auto + all-images；uiLocale 随提交（非 en 触发历史提示词翻译）
    expect(request.creation).toEqual({ mode: 'auto', materialMode: 'all-images' });
    expect(mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1].uiLocale).toBe('zh');
    expect(request).not.toHaveProperty("versions");
    expect(request).not.toHaveProperty("perImageDuration");
    expect(w.vm.outputConfig).toEqual({ resolution: "3840x2160", fps: 60, format: "mp4" });
    w.unmount();
  });

  it("创作模式 UI：默认全自动；选择分镜素材自选后显示成本提示与素材模式，提交 creation 段", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-manual" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "分镜素材自选测试文案";
    await nextTick();

    // 默认全自动 + 素材模式区隐藏
    expect(w.vm.s2vConfig.creationMode).toBe("auto");
    expect(w.find('[data-testid="s2v-material-mode"]').exists()).toBe(false);
    expect(w.find('[data-testid="s2v-creation-mode-auto"]').element.checked).toBe(true);

    // 切换到分镜素材自选 → 显示成本提示与素材模式，默认全部图片轮播
    await w.find('[data-testid="s2v-creation-mode-manual"]').setValue();
    await nextTick();
    expect(w.find('[data-testid="s2v-creation-mode-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-material-mode"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-material-mode-all-images"]').element.checked).toBe(true);

    // 选择 视频+图片轮播
    await w.find('[data-testid="s2v-material-mode-video-image"]').setValue();
    await nextTick();
    expect(w.vm.s2vConfig.manualMaterialMode).toBe("video-image");

    await w.vm.startPipeline();
    const request = mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1].story2videoTextConfig;
    expect(request.creation).toEqual({ mode: "manual", materialMode: "video-image" });
    w.unmount();
  });

  it("handleStartPipeline：登录门被拒（未登录/取消）时不启动流水线", async () => {
    mockEnsureLogin.mockResolvedValueOnce(false);
    const mocks = await import("@/api/publisher");
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "登录门测试";
    await w.vm.handleStartPipeline();
    expect(mockEnsureLogin).toHaveBeenCalled();
    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
    expect(mocks.pipelineStart).not.toHaveBeenCalled();
    w.unmount();
  });

  it("handleStartPipeline：登录通过后调用 startPipeline", async () => {
    mockEnsureLogin.mockResolvedValue(true);
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-login-gate" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "登录门测试2";
    await w.vm.handleStartPipeline();
    expect(mockEnsureLogin).toHaveBeenCalled();
    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalled();
    w.unmount();
  });

  it("S2V 编排提交字数主控与最短场景时长参数（默认 + 显式开启）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-duration-contract" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const mountS2V = () => {
      const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
      w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
      w.vm.pipelineText = "分镜时长契约";
      return w;
    };

    // 默认：字数主控 20 + follow-audio + minSceneDuration 6
    const w1 = mountS2V();
    await w1.vm.startPipeline();
    const defaultConfig = mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1].story2videoTextConfig;
    expect(defaultConfig.split.targetCharsPerScene).toBe(20);
    expect(defaultConfig.sceneDurationMode).toBe("follow-audio");
    expect(defaultConfig.minSceneDuration).toBe(6);
    w1.unmount();

    // 显式：字数 30 + min-duration + N=8
    const w2 = mountS2V();
    w2.vm.s2vConfig = { ...w2.vm.s2vConfig, splitTargetCharsPerScene: 30, sceneDurationMode: "min-duration", minSceneDuration: 8 };
    await w2.vm.startPipeline();
    const explicitConfig = mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1].story2videoTextConfig;
    expect(explicitConfig.split.targetCharsPerScene).toBe(30);
    expect(explicitConfig.sceneDurationMode).toBe("min-duration");
    expect(explicitConfig.minSceneDuration).toBe(8);
    w2.unmount();
  });

  it("Story2Video 只显示文字输入并拒绝旧图片模式", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-images" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "running" }, context: {} } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.inputMode = "images";
    w.vm.pipelineImages = [{ preview: "data:image/png;base64,aW1hZ2U=" }];
    await nextTick();

    await w.vm.startPipeline();

    const inputTabs = w.findAll(".input-tab").map(tab => tab.text());
    expect(inputTabs).toContain("文案");
    expect(inputTabs).not.toContain("图片");
    expect(inputTabs).not.toContain("旁白/批量音频");
    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
    w.unmount();
  });

  it("普通流水线仍保留图片、音频和视频输入", async () => {
    const mocks = await import("@/api/publisher");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "screen-demo", stages: [] };
    await nextTick();
    const inputTabs = w.findAll(".input-tab").map(tab => tab.text());
    expect(inputTabs).toEqual(expect.arrayContaining(["文案", "图片", "旁白/批量音频", "视频素材"]));
    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
    w.unmount();
  });

  it("普通流水线仍可识别上传旁白", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoTranscribe.mockResolvedValue({ code: 0, data: { text: "识别后的第一段" } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "podcast-repurpose", stages: [] };
    w.vm.inputMode = "audio";
    w.vm.pipelineAudio = [{ name: "voice.mp3", path: "C:/controlled/voice.mp3", transcript: "" }];

    await w.vm.transcribePipelineAudio(0);

    expect(w.vm.pipelineAudio[0].transcript).toBe("识别后的第一段");
    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
    w.unmount();
  });

  it("BGM 文件经 preload 解析后入库并自动选中", async () => {
    const mocks = await import("@/api/publisher");
    const importer = vi.fn().mockResolvedValue({ code: 0, data: { path: "C:/controlled/bgm.mp3", name: "bgm" } });
    mocks.story2videoBgmLibraryAdd.mockImplementation(importer);
    mocks.story2videoBgmLibraryList.mockResolvedValue({ code: 0, data: [{ id: "bgm-1", name: "bgm", path: "C:/controlled/bgm.mp3" }] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    await w.vm.handleS2VBgmFile({ target: { files: [{ name: "bgm.mp3", size: 5 }] } });

    expect(importer).toHaveBeenCalledTimes(1);
    expect(w.vm.s2vConfig.bgmPath).toBe("C:/controlled/bgm.mp3");
    expect(w.vm.s2vBgmLibrary).toHaveLength(1);
    w.unmount();
  });

  it("BGM 入库被拒绝时清空配置并提示，不发送不可用文件名", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBgmLibraryAdd.mockResolvedValue({ code: -1 });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    await w.vm.handleS2VBgmFile({ target: { files: [{ name: "bgm.mp3", size: 5 }] } });

    expect(w.vm.s2vConfig.bgmPath).toBe("");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.media_invalid");
    alertSpy.mockRestore();
    w.unmount();
  });


  it("BGM 格式不支持时细分提示具体格式与允许列表", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    await w.vm.handleS2VBgmFile({ target: { files: [{ name: "bgm.flac", size: 100 }] } });

    expect(w.vm.s2vConfig.bgmPath).toBe("");
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.media_format_invalid");
    expect(w.vm.story2videoErrorDialog.messageParams.extension).toBe(".FLAC");
    expect(w.vm.story2videoErrorDialog.messageParams.kindLabel).toBe("背景音乐");
    w.unmount();
  });

  it("BGM 大小超限时细分提示最大与当前大小", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    // 16MB > 15MB（bgm 上限）
    await w.vm.handleS2VBgmFile({ target: { files: [{ name: "big.mp3", size: 16 * 1024 * 1024 }] } });

    expect(w.vm.s2vConfig.bgmPath).toBe("");
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.media_size_exceeded");
    expect(w.vm.story2videoErrorDialog.messageParams.maxMb).toBe(15);
    expect(w.vm.story2videoErrorDialog.messageParams.actualMb).toBe(16);
    w.unmount();
  });

  it("主进程拒绝入库时把具体原因透传为细分提示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBgmLibraryAdd.mockResolvedValue({ code: -1, message: "不支持的媒体格式" });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    await w.vm.handleS2VBgmFile({ target: { files: [{ name: "bgm.mp3", size: 5 }] } });

    expect(w.vm.s2vConfig.bgmPath).toBe("");
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.media_format_invalid");
    w.unmount();
  });

  it("主进程报告文件不可读时细分提示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBgmLibraryAdd.mockResolvedValue({ code: -1, message: "媒体文件不存在或不可读" });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    await w.vm.handleS2VBgmFile({ target: { files: [{ name: "bgm.mp3", size: 5 }] } });

    expect(w.vm.s2vConfig.bgmPath).toBe("");
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.media_unreadable");
    w.unmount();
  });

  // === 背景音乐素材库（2026-08-14）===
  it("BGM 下拉渲染素材库条目，选中项映射到 bgmPath", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBgmLibraryList.mockResolvedValue({
      code: 0,
      data: [
        { id: "bgm-1", name: "清晨旋律", path: "C:/lib/dawn.mp3" },
        { id: "bgm-2", name: "夜航", path: "C:/lib/night.mp3" },
      ],
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectPipeline({ name: "story2video-compose", available: true, stages: [] });
    await nextTick();
    await w.vm.loadS2VBgmLibrary({ silent: true });

    const select = w.find('[data-testid="s2v-bgm-select"]');
    expect(select.exists()).toBe(true);
    const options = select.findAll("option");
    // 空选项 + 2 个库条目
    expect(options.length).toBe(3);
    expect(options[1].text()).toBe("清晨旋律");

    await select.setValue("C:/lib/night.mp3");
    expect(w.vm.s2vConfig.bgmPath).toBe("C:/lib/night.mp3");
    w.unmount();
  });

  it("打开管理弹窗时加载素材库，空库显示空态", async () => {
    const mocks = await import("@/api/publisher");
    const loader = vi.fn().mockResolvedValue({ code: 0, data: [] });
    mocks.story2videoBgmLibraryList.mockImplementation(loader);
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectPipeline({ name: "story2video-compose", available: true, stages: [] });
    await nextTick();

    await w.vm.openBgmLibraryDialog();

    expect(w.vm.s2vBgmLibraryDialogOpen).toBe(true);
    expect(loader).toHaveBeenCalled();
    // 本文件统一将 Teleport stub 到 wrapper 内；UiModal 的真实 body 挂载由 UiModal.test 覆盖。
    expect(w.find('[data-testid="s2v-bgm-library-dialog"]').exists()).toBe(true);
    w.unmount();
  });

  it("管理弹窗内添加文件入库并自动选中，input 清空以支持连续选择", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBgmLibraryList.mockResolvedValue({
      code: 0,
      data: [{ id: "bgm-9", name: "新音乐", path: "C:/lib/new.mp3" }],
    });
    mocks.story2videoBgmLibraryAdd.mockResolvedValue({
      code: 0,
      data: { id: "bgm-9", name: "新音乐", path: "C:/lib/new.mp3" },
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();

    await w.vm.openBgmLibraryDialog();
    await w.vm.handleBgmLibraryAddFile({ target: { files: [{ name: "new.mp3", size: 5 }] } });

    expect(mocks.story2videoBgmLibraryAdd).toHaveBeenCalledTimes(1);
    expect(w.vm.s2vConfig.bgmPath).toBe("C:/lib/new.mp3");
    expect(w.vm.s2vBgmLibrary).toHaveLength(1);
    w.unmount();
  });

  it("重命名素材库条目成功后刷新列表并退出编辑态", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBgmLibraryList.mockResolvedValue({
      code: 0,
      data: [{ id: "bgm-1", name: "新名字", path: "C:/lib/dawn.mp3" }],
    });
    mocks.story2videoBgmLibraryRename.mockResolvedValue({ code: 0, data: { id: "bgm-1" } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    await w.vm.loadS2VBgmLibrary({ silent: true });

    w.vm.startBgmRename({ id: "bgm-1", name: "旧名字" });
    expect(w.vm.s2vBgmLibraryRenamingId).toBe("bgm-1");
    w.vm.s2vBgmLibraryRenameDraft = "新名字";
    await w.vm.saveBgmRename();

    expect(mocks.story2videoBgmLibraryRename).toHaveBeenCalledWith("bgm-1", "新名字");
    expect(w.vm.s2vBgmLibraryRenamingId).toBe("");
    expect(w.vm.s2vBgmLibrary[0].name).toBe("新名字");
    w.unmount();
  });

  it("删除当前选中的素材库条目后回退为不使用背景音乐", async () => {
    const mocks = await import("@/api/publisher");
    const bgmItem = { id: "bgm-1", name: "清晨旋律", path: "C:/lib/dawn.mp3" };
    // mounted 的异步加载链与显式调用顺序不定，用可变数据源保证删除后刷新返回空库
    let bgmLibraryData = [bgmItem];
    mocks.story2videoBgmLibraryList.mockImplementation(() => Promise.resolve({ code: 0, data: bgmLibraryData }));
    mocks.story2videoBgmLibraryDelete.mockImplementation(async (id) => {
      bgmLibraryData = [];
      return { code: 0, data: { deleted: true, id } };
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    await w.vm.loadS2VBgmLibrary({ silent: true });
    w.vm.s2vConfig.bgmPath = "C:/lib/dawn.mp3";

    w.vm.requestBgmDelete({ id: "bgm-1", name: "清晨旋律" });
    expect(w.vm.s2vBgmLibraryDeleteDialogOpen).toBe(true);
    await w.vm.confirmBgmDelete();

    expect(mocks.story2videoBgmLibraryDelete).toHaveBeenCalledWith("bgm-1");
    expect(w.vm.s2vConfig.bgmPath).toBe("");
    expect(w.vm.s2vBgmLibraryDeleteDialogOpen).toBe(false);
    expect(w.vm.s2vBgmLibrary).toHaveLength(0);
    w.unmount();
  });

  it("历史 BGM 路径不在素材库时保留为独立选项，入库后不再显示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBgmLibraryList.mockResolvedValue({
      code: 0,
      data: [{ id: "bgm-1", name: "清晨旋律", path: "C:/lib/dawn.mp3" }],
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    await w.vm.loadS2VBgmLibrary({ silent: true });
    w.vm.s2vConfig.bgmPath = "C:/old-import/legacy.mp3";

    expect(w.vm.s2vLegacyBgmPath).toBe("C:/old-import/legacy.mp3");

    w.vm.s2vConfig.bgmPath = "C:/lib/dawn.mp3";
    expect(w.vm.s2vLegacyBgmPath).toBe("");
    w.unmount();
  });

  it("媒体文件要求提示文字按类别渲染", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    expect(w.vm.mediaRequirementsBgmText).toContain("15MB");
    expect(w.vm.mediaRequirementsAudioText).toContain("50MB");
    expect(w.vm.mediaRequirementsImageText).toContain("10MB");
    expect(w.vm.mediaRequirementsVideoText).toContain("512MB");
    w.unmount();
  });
  it("startPipeline uses normal pipelineStart for non-orchestrated", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStart.mockResolvedValue({ code: 0, data: {} });
    mocks.pipelineStatus.mockResolvedValue({ code: 0, data: { status: "running", stages: [] } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "custom-pipeline", description: "test", stages: [], category: "custom", available: true };
    w.vm.pipelineText = "test text";
    await w.vm.startPipeline();
    expect(mocks.pipelineStart).toHaveBeenCalled();
    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
  });

  it("普通流水线精确透传文本、输入模式和输出配置", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStart.mockResolvedValueOnce({ code: 1, message: "暂不启动" });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "custom-pipeline", stages: [], available: true };
    w.vm.pipelineText = "创作内容";
    w.vm.inputMode = "text";

    await w.vm.startPipeline();

    expect(mocks.pipelineStart).toHaveBeenCalledWith("custom-pipeline", expect.objectContaining({
      text: "创作内容",
      inputMode: "text",
      images: [],
      video: null,
      output: w.vm.outputConfig,
    }));
    expect(w.vm.story2videoErrorDialog.visible).toBe(true);
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.operation_failed");
    expect(w.vm.story2videoErrorDialog.rawError).toBe("暂不启动");
    w.unmount();
  });

  it("普通视频流水线传递已解析的绝对路径而不是文件名", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStart.mockResolvedValueOnce({ code: 1, message: "暂不启动" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "custom-pipeline", stages: [], available: true };
    w.vm.inputMode = "video";
    w.vm.pipelineVideo = { name: "source.mp4", path: "C:/media/source.mp4" };

    await w.vm.startPipeline();

    expect(mocks.pipelineStart).toHaveBeenCalledWith("custom-pipeline", expect.objectContaining({
      video: "C:/media/source.mp4",
    }));
    alertSpy.mockRestore();
    w.unmount();
  });

  it("Story2Video 视频素材模式明确拒绝启动，不静默丢弃参数", async () => {
    const mocks = await import("@/api/publisher");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.inputMode = "video";
    w.vm.pipelineVideo = { name: "source.mp4", path: "C:/media/source.mp4" };

    await w.vm.startPipeline();

    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
    expect(w.vm.story2videoErrorDialog).toEqual({ visible: true, detail: '', messageKey:  "story2video.text_input_only",
      messageParams: {},
      rawError: '',
    });
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    w.unmount();
  });

  it("编排完成后携带 compose 视频路径进入结果页", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        runId: "run-completed",
        completed: true,
        context: { compose: { videoPath: "C:/media/output.mp4" } },
      },
    });
    const pushSpy = vi.spyOn(router, "push");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "测试文案";

    await w.vm.startPipeline();

    expect(pushSpy).toHaveBeenCalledWith({
      path: "/create/result",
      query: { path: "C:/media/output.mp4", runId: "run-completed" },
    });
    pushSpy.mockRestore();
    w.unmount();
  });

  it("llmConfig only has temperature (no provider/model)", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    expect(w.vm.llmConfig).toHaveProperty("temperature");
    expect(w.vm.llmConfig).not.toHaveProperty("provider");
    expect(w.vm.llmConfig).not.toHaveProperty("model");
  });
});

// ── 交互测试：通过 UI 点击触发，而非 vm 直调 ──────────────────
describe("CreateView - UI interactions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // W3（codex 5b）：隔离 storeGetSetting 的 mockResolvedValue 实现泄漏到后续用例
    const mocks = await import("@/api/publisher");
    mocks.storeGetSetting.mockReset();
    mocks.storeGetSetting.mockResolvedValue(null);
  });

  it("clicks view-tab switches view (pipelines/quick/history)", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    const tabs = w.findAll(".view-tab");
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    // 点击"快速渲染"tab
    await tabs[1].trigger("click");
    await nextTick();
    expect(w.vm.view).toBe("quick");
    // 点击"历史记录"tab
    await tabs[2].trigger("click");
    await nextTick();
    expect(w.vm.view).toBe("history");
  });

  it("分镜粒度双视图：目标时长输入反推字数主控，切换视图保持一致", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    // 默认时长视图：输入 8 秒（非默认值）→ 反推字数 round(8 × 3.3 × 1.0) = 26，且同步旧 targetSeconds
    const secondsInput = w.find('[data-testid="s2v-split-target-seconds"]');
    expect(secondsInput.exists()).toBe(true);
    await secondsInput.setValue(8);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(26);
    expect(w.vm.s2vConfig.splitTargetSeconds).toBe(8);

    // 切换到字数视图：显示 26；编辑 30 → 主控 30，时长估算 round(30/3.3)=9
    await w.find('[data-testid="s2v-split-view-chars"]').trigger("click");
    await nextTick();
    const charsInput = w.find('[data-testid="s2v-split-target-chars"]');
    expect(charsInput.exists()).toBe(true);
    expect(Number(charsInput.element.value)).toBe(26);
    await charsInput.setValue(30);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(30);
    expect(w.vm.s2vConfig.splitTargetSeconds).toBe(9);

    // 切回时长视图：显示估算整数秒 30/3.3 ≈ 9（与提交口径一致）
    await w.find('[data-testid="s2v-split-view-seconds"]').trigger("click");
    await nextTick();
    expect(Number(w.find('[data-testid="s2v-split-target-seconds"]').element.value)).toBe(9);
    w.unmount();
  });

  it("切出流水线视图只脱离前端跟踪，不取消后台 run，并在重新进入时回到新建列表", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "pipelines";
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.orchestrationRunId = "run-tab-switch";
    w.vm.pipelineRunStatus = { status: "running" };
    w.vm.pollTimer = setInterval(() => {}, 3000);
    await w.vm.switchView("history");
    await nextTick();

    expect(mocks.pipelineCancel).not.toHaveBeenCalled();
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.pollTimer).toBeNull();
    expect(w.vm.selectedPipeline).toBeNull();
    expect(w.vm.view).toBe("history");

    await w.vm.switchView("pipelines");
    await nextTick();
    expect(w.vm.view).toBe("pipelines");
    expect(w.vm.selectedPipeline).toBeNull();
    expect(w.vm.orchestrationRunId).toBeNull();
    w.unmount();
  });

  it("运营后台实时预估（Batch 5b）：静态估算显示分镜数/时长区间/成本", async () => {
    const mocks = await import("@/api/publisher");
    mocks.storeGetSetting.mockResolvedValue({ code: 0, data: null }); // 无样本 → 静态
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "一二三四五六七八九十"; // 10 字，默认每分镜 20 字 → 1 个分镜
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const row = w.find('[data-testid="s2v-estimate-row"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("1 个分镜");
    // 静态：20 字 / (3.3×1.0) ≈ 6 秒，区间 5~7；成本 = 0.10 + 6×0.05 = 0.40
    expect(row.text()).toContain("5~7 秒");
    expect(row.text()).toContain("¥0.40");
    expect(row.text()).toContain("静态估算");
    w.unmount();
  });

  it("运营后台实时预估（Batch 5b）：本地 TTS 样本校准生效并标注", async () => {
    const mocks = await import("@/api/publisher");
    const nowIso = new Date().toISOString();
    const samples = Array.from({ length: 5 }, () => ({
      language: "zh", provider: "edge-tts", voiceId: "v1", speed: 1,
      chars: 9, durationSeconds: 1, recordedAt: nowIso, // 实际 9 字/s → 校准系数 2.0
    }));
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({ code: 0, data: samples });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.s2vConfig = { ...w.vm.s2vConfig, splitLanguage: "zh", voiceProvider: "edge-tts", voiceId: "v1" };
    w.vm.pipelineText = "一二三四五六七八九十";
    // 显式触发样本加载（不依赖 mounted 异步链，聚焦校准→预估链路）
    await w.vm.loadS2VTtsSamples();
    await nextTick();
    expect(w.vm.s2vTtsSamples.length).toBe(5);

    const row = w.find('[data-testid="s2v-estimate-row"]');
    expect(row.exists()).toBe(true);
    // 校准后：20 字 / (4.5×2.0) ≈ 2 秒，区间 1~3；成本 = 0.10 + 2×0.05 = 0.20
    expect(row.text()).toContain("1~3 秒");
    expect(row.text()).toContain("¥0.20");
    expect(row.text()).toContain("按本地 TTS 样本校准");
    w.unmount();
  });

  it("运营后台实时预估（Batch 5b）：storeGetSetting 直接返回数组（生产解包形态）同样生效", async () => {
    const mocks = await import("@/api/publisher");
    const nowIso = new Date().toISOString();
    const samples = Array.from({ length: 4 }, () => ({
      language: "zh", provider: "edge-tts", voiceId: "v1", speed: 1,
      chars: 9, durationSeconds: 1, recordedAt: nowIso,
    }));
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue(samples); // 直接数组（生产 wrapper 解包后的形态）
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.s2vConfig = { ...w.vm.s2vConfig, splitLanguage: "zh", voiceProvider: "edge-tts", voiceId: "v1" };
    w.vm.pipelineText = "一二三四五六七八九十";
    await w.vm.loadS2VTtsSamples();
    await nextTick();
    expect(w.vm.s2vTtsSamples.length).toBe(4);
    const row = w.find('[data-testid="s2v-estimate-row"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("按本地 TTS 样本校准");
    w.unmount();
  });

  it("运营后台实时预估（Batch 5b）：样本不足 3 条时回退静态标注（W3 语义）", async () => {
    const mocks = await import("@/api/publisher");
    const nowIso = new Date().toISOString();
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({ code: 0, data: [
      { language: "zh", provider: "edge-tts", voiceId: "v1", speed: 1, chars: 9, durationSeconds: 1, recordedAt: nowIso },
    ] }); // 仅 1 条 → 不足 CALIBRATION_MIN_SAMPLES=3
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.s2vConfig = { ...w.vm.s2vConfig, splitLanguage: "zh", voiceProvider: "edge-tts", voiceId: "v1" };
    w.vm.pipelineText = "一二三四五六七八九十";
    await w.vm.loadS2VTtsSamples();
    await nextTick();
    const row = w.find('[data-testid="s2v-estimate-row"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("静态估算"); // 未达阈值 → 不标“已校准”
    w.unmount();
  });

  it("运营后台实时预估（Batch 5b）：非 story2video-compose 流水线不显示预估行", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "animated-explainer", stages: [] };
    w.vm.pipelineText = "一二三四五六七八九十";
    await nextTick();
    expect(w.find('[data-testid="s2v-estimate-row"]').exists()).toBe(false);
    w.unmount();
  });

  it("运营后台实时预估（Batch 5b）：空文案不显示预估行", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();
    expect(w.find('[data-testid="s2v-estimate-row"]').exists()).toBe(false);
    w.unmount();
  });

  it("语言感知估算（Batch 5a）：zh/en 基准语速参与时长↔字数换算，auto 回退 3.3", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    // zh：8 秒 → round(8 × 4.5) = 36 字；36/4.5 = 8 秒回显
    w.vm.s2vConfig.splitLanguage = "zh";
    await w.find('[data-testid="s2v-split-target-seconds"]').setValue(8);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(36);
    expect(w.vm.s2vConfig.splitTargetSeconds).toBe(8);
    expect(w.vm.s2vSplitEstimatedSeconds).toBe(8);

    // en：8 秒 → round(8 × 2.8) = 22 字
    w.vm.s2vConfig.splitLanguage = "en";
    await w.find('[data-testid="s2v-split-target-seconds"]').setValue(8);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(22);
    expect(w.vm.s2vConfig.splitTargetSeconds).toBe(8);

    // auto：8 秒 → round(8 × 3.3) = 26 字（默认行为不变）
    w.vm.s2vConfig.splitLanguage = "auto";
    await w.find('[data-testid="s2v-split-target-seconds"]').setValue(8);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(26);
    w.unmount();
  });

  it("分镜粒度换算边界：clamp 到 [minWords,maxWords]、无效输入 no-op、语速驱动估算、N 输入自愈", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    // 时长视图输入 60 秒 → 字数被夹到 maxWords=50
    await w.find('[data-testid="s2v-split-target-seconds"]').setValue(60);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(50);

    // 切到字数视图输入 5 → 夹到 minWords=10
    await w.find('[data-testid="s2v-split-view-chars"]').trigger("click");
    await nextTick();
    await w.find('[data-testid="s2v-split-target-chars"]').setValue(5);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(10);

    // 无效输入 no-op（保持现值）
    const before = w.vm.s2vConfig.splitTargetCharsPerScene;
    await w.find('[data-testid="s2v-split-target-chars"]').setValue(0);
    expect(w.vm.s2vConfig.splitTargetCharsPerScene).toBe(before);

    // 语速 0.5 → 估算时长随动：20 字 / (3.3×0.5) ≈ 12 秒（整数口径）
    w.vm.s2vConfig.splitTargetCharsPerScene = 20;
    w.vm.s2vConfig.voiceSpeed = 0.5;
    await nextTick();
    expect(w.vm.s2vSplitEstimatedSeconds).toBe(12);

    // N 输入越界自愈：100 → 60，0 → no-op
    await w.find('[data-testid="s2v-min-duration-toggle"]').setValue(true);
    await nextTick();
    await w.find('[data-testid="s2v-min-duration-input"]').setValue(100);
    expect(w.vm.s2vConfig.minSceneDuration).toBe(60);
    await w.find('[data-testid="s2v-min-duration-input"]').setValue(0);
    expect(w.vm.s2vConfig.minSceneDuration).toBe(60);
    w.unmount();
  });

  it("最短场景时长开关默认关闭，开启后 N 输入生效并随配置提交", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-min-duration-ui" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "最短场景时长";
    await nextTick();

    const toggle = w.find('[data-testid="s2v-min-duration-toggle"]');
    expect(toggle.exists()).toBe(true);
    expect(toggle.element.checked).toBe(false);
    expect(w.find('[data-testid="s2v-min-duration-input"]').exists()).toBe(false);
    expect(w.vm.s2vConfig.sceneDurationMode).toBe("follow-audio");

    // 开启 → N 输入出现并设置 8
    await toggle.setValue(true);
    await nextTick();
    expect(w.vm.s2vConfig.sceneDurationMode).toBe("min-duration");
    const durationInput = w.find('[data-testid="s2v-min-duration-input"]');
    expect(durationInput.exists()).toBe(true);
    await durationInput.setValue(8);
    expect(w.vm.s2vConfig.minSceneDuration).toBe(8);

    // 提交配置携带 min-duration 与 N
    await w.vm.startPipeline();
    const request = mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1].story2videoTextConfig;
    expect(request.sceneDurationMode).toBe("min-duration");
    expect(request.minSceneDuration).toBe(8);
    w.unmount();
  });

  it("未登录本地模式：listProjects 返回 localMode 时显示本地模式提示条", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [], localMode: true });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.historyLocalMode).toBe(true);
    expect(w.vm.story2videoErrorDialog).toMatchObject({ visible: false });
    expect(w.text()).toContain("本机记录");
    w.unmount();
  });

  it("stale running（长时间无更新）归入已中断而非已暂停：已暂停仅保留手动暂停", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [{
      id: "run-stale-1", pipeline: "story2video-compose", status: "running",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      stages: [{ name: "generate_assets", status: "running" }],
      params: { text: "被中断任务的文案" },
    }, {
      id: "run-fresh-1", pipeline: "story2video-compose", status: "running",
      updatedAt: new Date().toISOString(),
      stages: [{ name: "optimize", status: "running" }],
    }] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    const stale = w.vm.history.find(item => item.id === "run-stale-1");
    // 合同（2026-08-20 修订）：非手动暂停的运行中残留一律为 interrupted，不得进入「已暂停」标签
    expect(stale.status).toBe("interrupted");
    expect(stale._originalStatus).toBe("running");
    expect(stale.pausedStage).toBe("generate_assets");
    const fresh = w.vm.history.find(item => item.id === "run-fresh-1");
    expect(fresh.status).toBe("running");
    expect(w.vm.history.filter(item => item.status === "paused")).toHaveLength(0);
    w.unmount();
  });

  it("无项目匹配的 run 记录用 params 回填标题与原文案：卡片不再显示流水线名词与「未生成」", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [{
      id: "run-orphan-1", pipeline: "story2video-compose", status: "failed",
      error: "provider timeout",
      updatedAt: "2026-08-15T12:00:00.000Z",
      params: { text: "孤儿任务的原始文案", title: "孤儿任务标题" },
    }, {
      id: "run-orphan-2", pipeline: "story2video-compose", status: "failed",
      error: "provider timeout",
      updatedAt: "2026-08-15T11:00:00.000Z",
      params: { text: "只有文案没有标题的孤儿任务" },
    }] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    const first = w.vm.history.find(item => item.id === "run-orphan-1");
    expect(first.title).toBe("孤儿任务标题");
    expect(first.sourceText).toBe("孤儿任务的原始文案");
    const second = w.vm.history.find(item => item.id === "run-orphan-2");
    expect(second.sourceText).toBe("只有文案没有标题的孤儿任务");
    // 渲染断言：卡片标题与文案预览来自 params 回退，而非流水线名词/未生成占位
    expect(w.text()).toContain("孤儿任务标题");
    expect(w.text()).toContain("孤儿任务的原始文案");
    const titles = w.findAll(".history-name").map(node => node.text());
    expect(titles).toContain("孤儿任务标题");
    for (const title of titles) expect(title).not.toContain("故事视频合成");
    // 文案预览区域不得出现「未生成」占位（页面其他合法区域如缩略图占位/视频时长仍可显示「未生成」）
    const previews = w.findAll(".prompt-preview-text").map(node => node.text());
    expect(previews).toContain("孤儿任务的原始文案");
    for (const preview of previews) expect(preview).not.toContain("未生成");
    w.unmount();
  });

  it("历史加载失败时弹窗携带可操作建议（本地存储原因）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: -1, message: "Story2Video 项目存储不可用", data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.story2videoErrorDialog).toMatchObject({ visible: true, messageKey: "story2video.history_load_failed" });
    expect(w.vm.story2videoErrorDialog.detail).toContain("重启");
    w.unmount();
  });

  it("历史加载失败（未登录原因）时弹窗建议登录", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: -1, message: "无法识别当前用户", data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.story2videoErrorDialog).toMatchObject({ visible: true, messageKey: "story2video.history_load_failed" });
    expect(w.vm.story2videoErrorDialog.detail).toContain("登录");
    w.unmount();
  });

  it("未登录（listProjects 返回空本地历史）时历史记录不弹「无法加载」", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.historyLoading).toBe(false);
    expect(w.vm.history).toEqual([]);
    expect(w.vm.story2videoErrorDialog).toMatchObject({ visible: false });
    w.unmount();
  });

  it("历史记录请求超时时停止加载、显示错误并保留已完成来源", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockImplementation(() => new Promise(() => {}));
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [{
      id: "completed-run", pipelineName: "Story2Video", status: "completed", title: "已完成流水线",
    }] });
    vi.useFakeTimers();
    try {
      const w = mount(CreateView, {
        global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
      });
      w.vm.view = "history";
      void w.vm.loadHistory();

      await vi.advanceTimersByTimeAsync(8000);
      await nextTick();

      expect(w.vm.historyLoading).toBe(false);
      expect(w.find(".history-error").exists()).toBe(false);
      expect(w.vm.story2videoErrorDialog).toMatchObject({
        visible: true,
        messageKey: "story2video.history_load_failed",
      });
      expect(w.find(".history-status.completed").exists()).toBe(true);
      expect(w.text()).toContain("已完成流水线");
    } finally {
      vi.useRealTimers();
    }
  });
  it("并发历史请求只保留最新一次响应", async () => {
    const mocks = await import("@/api/publisher");
    let resolveOldProjects;
    let resolveOldRuns;
    mocks.story2videoListProjects
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldProjects = resolve; }))
      .mockResolvedValueOnce({ code: 0, data: [{ projectId: "new-project", title: "新记录", status: "completed" }] });
    mocks.pipelineHistory
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldRuns = resolve; }))
      .mockResolvedValueOnce({ code: 0, data: [] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });

    const first = w.vm.loadHistory();
    await Promise.resolve();
    const second = w.vm.loadHistory();
    await second;
    resolveOldProjects({ code: 0, data: [{ projectId: "old-project", title: "旧记录", status: "completed" }] });
    resolveOldRuns({ code: 0, data: [] });
    await first;
    await nextTick();

    expect(w.vm.history.map(item => item.projectId)).toEqual(["new-project"]);
    expect(w.vm.historyLoading).toBe(false);
  });
  it("clicks btn-start triggers startPipeline", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStart.mockResolvedValueOnce({ code: 1, message: "测试阻止启动" });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { id: "p1", name: "normal-pipeline", available: true };
    w.vm.pipelineText = "通过界面发起的内容";
    await nextTick();
    const startBtn = w.find(".btn-start");
    expect(startBtn.exists()).toBe(true);
    expect(startBtn.attributes("disabled")).toBeUndefined();

    await startBtn.trigger("click");
    await nextTick();

    expect(mocks.pipelineStart).toHaveBeenCalledWith("normal-pipeline", expect.objectContaining({
      text: "通过界面发起的内容",
      inputMode: "text",
    }));
    expect(w.vm.story2videoErrorDialog.visible).toBe(true);
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.operation_failed");
    expect(w.vm.story2videoErrorDialog.rawError).toBe("测试阻止启动");
    w.unmount();
  });

  it("未实现引擎的流水线禁用启动按钮并显示提示", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.pipelines = [{ name: "animation", available: false, stages: [] }];
    w.vm.selectedPipeline = { name: "animation", available: false, stages: [] };
    w.vm.pipelineText = "内容";
    await nextTick();
    expect(w.vm.canStartPipeline).toBe(false);
    const startBtn = w.find('[data-testid="start-story2video"]');
    expect(startBtn.attributes("disabled")).toBeDefined();
    const hint = w.find('[data-testid="pipeline-unavailable-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("尚未实现执行引擎");
    w.unmount();
  });

  it("未实现引擎的流水线 startPipeline 被守卫拦截并弹出提示", async () => {
    const mocks = await import("@/api/publisher");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "animation", available: false, stages: [] };
    w.vm.pipelineText = "内容";
    mocks.pipelineStart.mockClear();
    await w.vm.startPipeline();
    expect(mocks.pipelineStart).not.toHaveBeenCalled();
    expect(w.vm.story2videoErrorDialog.visible).toBe(true);
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.pipeline_not_implemented");
    w.unmount();
  });

  it("自动流水线使用各自真实阶段名（非 s2v 回退）", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.pipelines = [{ name: "documentary-montage", available: true }];
    w.vm.selectPipeline({ name: "documentary-montage", available: true });
    await nextTick();
    expect(w.vm.orchestrationStages.map(s => s.name)).toEqual([
      "research", "ingest", "edit", "narrate", "render",
    ]);
    w.vm.selectPipeline({ name: "animated-explainer", available: true });
    await nextTick();
    expect(w.vm.orchestrationStages.map(s => s.name)).toEqual([
      "research", "proposal", "script", "scenes", "assets", "editing", "compose", "publish",
    ]);
    w.unmount();
  });

  it("s2v 高级区拆分为分句与时长、模板与输出两个子组", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.s2vOpenSections.advanced = true;
    await nextTick();
    const titles = w.findAll(".s2v-subgroup-title").map(t => t.text());
    expect(titles).toEqual(["分句与时长", "模板与输出"]);
    expect(w.text()).toContain("分句语言");
    expect(w.text()).toContain("比例与分辨率");
    expect(w.text()).toContain("9:16竖屏 720x1280");
    w.unmount();
  });

  it("历史记录优先展示可恢复的 Story2Video 项目并可打开", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [{
      projectId: "project-history", pipeline: "story2video-compose", status: "completed",
      title: "历史成片", recoverable: true, updatedAt: "2026-07-22T00:00:00.000Z",
    }] });
    const pushSpy = vi.spyOn(router, "push");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });

    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.text()).toContain("历史成片");
    expect(w.find(".history-status").text()).toContain("已完成");
    expect(w.find(".history-status").classes()).toContain("completed");

    await w.find(".s2v-btn-secondary").trigger("click");
    expect(pushSpy).toHaveBeenCalledWith({ path: "/create/result", query: { project: "project-history" } });
    pushSpy.mockRestore();
  });

  it("历史项目加载后按 projectId hydration 缩略图，缺失或失败保持未生成占位", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [
      { projectId: "project-ready", pipeline: "story2video-compose", status: "completed", sourceText: "有缩略图的任务" },
      { projectId: "project-missing", pipeline: "story2video-compose", status: "failed", sourceText: "没有缩略图的任务" },
    ] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [] });
    mocks.story2videoGetThumbnail.mockImplementation(async (projectId) => projectId === "project-ready"
      ? { code: 0, data: { status: "ready", url: "media://history-ready" } }
      : { code: 0, data: { status: "failed", url: null } });

    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress }, stubs: { teleport: true } },
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    expect(mocks.story2videoGetThumbnail).toHaveBeenCalledWith("project-ready");
    expect(mocks.story2videoGetThumbnail).toHaveBeenCalledWith("project-missing");
    expect(w.vm.history.find(item => item.projectId === "project-ready")).toMatchObject({
      thumbnailUrl: "media://history-ready",
      thumbnailStatus: "ready",
    });
    expect(w.vm.history.find(item => item.projectId === "project-missing")).toMatchObject({
      thumbnailUrl: null,
      thumbnailStatus: "failed",
    });
    expect(w.find('[data-history-id="project-ready"] [data-testid="history-thumbnail"] img').attributes("src")).toBe("media://history-ready");
    expect(w.find('[data-history-id="project-missing"] [data-testid="history-thumbnail"]').text()).toContain("未生成");
    w.unmount();
  });

  it("草稿项目与运行记录合并为一条可编辑历史卡片，并保留运行状态详情", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [{
      projectId: "run-draft-history", pipeline: "story2video-compose", status: "running",
      title: "原任务发布标题", sourceText: "原始文案内容", segments: [{ id: "segment-0", text: "分段文案" }],
    }] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [{
      id: "run-draft-history", projectId: "run-draft-history", pipeline: "story2video-compose",
      status: "failed", currentStage: "optimize", activeMs: 12500, error: "模型余额不足",
      stages: [{ name: "optimize", status: "failed" }],
    }] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.history).toHaveLength(1);
    expect(w.vm.history[0]).toMatchObject({
      projectId: "run-draft-history", title: "原任务发布标题", status: "failed",
      currentStage: "optimize", activeMs: 12500, error: "模型余额不足",
      segments: [{ id: "segment-0", text: "分段文案" }],
    });
    w.unmount();
  });

  it("历史合并保留项目内容优先级并允许运行快照使用 currentStage=0", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [{
      projectId: "history-merge-contract", pipeline: "story2video-compose", status: "completed",
      runId: "history-merge-contract-run", title: "项目标题", sourceText: "项目文案", currentStage: 2,
      segments: [{ id: "project-segment", text: "项目分段" }],
    }] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [{
      id: "history-merge-contract-run", pipeline: "story2video-compose",
      status: "failed", title: "运行快照标题", sourceText: "运行快照文案", currentStage: 0,
      segments: [{ id: "run-segment", text: "运行快照分段" }],
    }] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress }, stubs: { teleport: true } },
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.history).toHaveLength(1);
    expect(w.vm.history[0]).toMatchObject({
      title: "项目标题",
      sourceText: "项目文案",
      currentStage: 0,
      segments: [{ id: "project-segment", text: "项目分段" }],
    });
    w.unmount();
  });

  it("历史记录可按完成、暂停和失败状态精确筛选", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [
      { projectId: "project-ok", pipeline: "story2video-compose", status: "completed", title: "已完成" },
    ] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-failed", pipeline: "story2video-compose", status: "failed", title: "失败任务" },
      { id: "run-cancelled", pipeline: "story2video-compose", status: "cancelled", title: "已取消" },
    ] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });

    w.vm.view = "history";
    await w.vm.loadHistory();
    w.vm.historyFilter = "failed";
    await nextTick();

    expect(w.vm.filteredHistory.map(item => item.id)).toEqual(["run-failed"]);
    expect(w.findAll(".history-name").map(item => item.text())).toEqual(["失败任务"]);
  });

  // R92 回归保护：下载视频按钮点击 → story2videoSaveAs IPC 调用（2026-09-04 QM-5）
  it("历史记录已完成任务点击下载视频按钮调用 story2videoSaveAs", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [{
      projectId: "project-download", pipeline: "story2video-compose", status: "completed",
      title: "可下载任务", videoPath: "/videos/output.mp4", updatedAt: "2026-09-04T10:00:00.000Z",
    }] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [] });
    mocks.story2videoSaveAs.mockResolvedValue({ code: 0, data: { path: "/saved/video.mp4", cancelled: true } });

    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress }, stubs: { teleport: true } },
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    const btn = w.find('[data-testid="history-download-button"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(mocks.story2videoSaveAs).toHaveBeenCalledWith("/videos/output.mp4", expect.any(String));
    w.unmount();
  });

  it("全部历史任务按有效更新时间倒序混排，不提升未完成状态", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [
      { projectId: "project-old", pipeline: "story2video-compose", status: "completed", title: "较早完成", updatedAt: "2026-08-15T09:00:00.000Z" },
      { projectId: "project-new", pipeline: "story2video-compose", status: "completed", title: "较新完成", updatedAt: "2026-08-15T10:00:00.000Z" },
    ] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-failed-latest", pipeline: "story2video-compose", status: "failed", title: "最新失败任务", updatedAt: "2026-08-15T12:00:00.000Z" },
      { id: "run-paused-1", pipeline: "story2video-compose", status: "paused", title: "暂停任务", updatedAt: "2026-08-15T11:00:00.000Z" },
    ] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });

    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.history.map(item => item.id || item.projectId)).toEqual([
      "run-failed-latest", "run-paused-1", "project-new", "project-old",
    ]);
    w.unmount();
  });

  it("较新的已完成项目压过较早的 running/failed 任务按更新时间倒序", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [
      { projectId: "project-latest-completed", pipeline: "story2video-compose", status: "completed", title: "最新完成", updatedAt: "2026-08-15T13:00:00.000Z" },
    ] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-old-running", pipeline: "story2video-compose", status: "running", title: "较早运行", updatedAt: "2026-08-15T08:00:00.000Z" },
      { id: "run-old-failed", pipeline: "story2video-compose", status: "failed", title: "较早失败", updatedAt: "2026-08-15T09:00:00.000Z" },
    ] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.vm.history.map(item => item.id || item.projectId)).toEqual([
      "project-latest-completed", "run-old-failed", "run-old-running",
    ]);
    w.unmount();
  });

  it("失败历史任务显示「从断点继续」并可一键恢复", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "project-for-run-failed-r1", runId: "run-failed-r1", pipeline: "story2video-compose", status: "failed", title: "失败任务", error: "provider 429 限流", stages: [{ name: "split", status: "completed" }, { name: "optimize", status: "failed" }] },
    ] });
    mocks.pipelineResumeOrchestration.mockResolvedValue({ code: 0, data: { success: true, runId: "run-failed-r1" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: "run-failed-r1", pipeline: "story2video-compose", status: { status: "running" }, stages: [] } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.pipelines = [{ name: "story2video-compose", available: true, stages: [] }];
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();
    w.vm.historyFilter = "failed";
    await nextTick();

    const resumeBtn = w.find(".s2v-btn-resume");
    expect(resumeBtn.exists()).toBe(true);
    expect(resumeBtn.text()).toContain("从断点继续");

    await resumeBtn.trigger("click");
    await nextTick();
    expect(mocks.pipelineResumeOrchestration).toHaveBeenCalledWith("run-failed-r1");
    // 断点恢复是用户的显式继续动作：必须跳到流水线视图并实时跟踪该 run，
    // 否则流水线页会因 orchestrationRunId 为空而停留在默认阶段、看不到任何推进。
    expect(w.vm.view).toBe("pipelines");
    expect(w.vm.orchestrationRunId).toBe("run-failed-r1");
    expect(w.vm.pipelineRunStatus?.status).toBe("running");
    expect(mocks.pipelineGetRunContext).toHaveBeenCalledWith("run-failed-r1");
    expect(w.vm.s2vOptionsToast).toContain("继续");
    expect(w.vm.pollTimer).not.toBeNull();
    w.unmount();
  });

  it("openRunningPipeline：保留 runId、跳到流水线视图、拉取运行态并启动轮询（断点恢复根因回归）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: { runId: "run-resume-1", pipeline: "story2video-compose", status: { status: "running" }, stages: [{ name: "split", status: "running" }] },
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
    });
    w.vm.pipelines = [{ name: "story2video-compose", available: true, stages: [] }];
    w.vm.orchestrationRunId = null;
    w.vm.pipelineRunStatus = null;
    expect(w.vm.pollTimer).toBeNull();
    const ok = await w.vm.openRunningPipeline("run-resume-1", "story2video-compose");
    await nextTick();
    expect(ok).toBe(true);
    expect(w.vm.view).toBe("pipelines");
    expect(w.vm.orchestrationRunId).toBe("run-resume-1");
    expect(w.vm.pipelineRunStatus?.status).toBe("running");
    expect(mocks.pipelineGetRunContext).toHaveBeenCalledWith("run-resume-1");
    expect(w.vm.pollTimer).not.toBeNull();
    w.unmount();
  });

  it("启动直接到素材选择暂停点时保留交互面板，不自动后台化", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({
      code: 0,
      data: {
        runId: "run-start-selection",
        success: true,
        paused: true,
        checkpoint: { type: "scene_asset_selection" },
      },
    });
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: {
        status: { status: "paused", currentStage: 4 },
        stages: [{ name: "generate_assets", status: "paused" }, { name: "compose", status: "pending" }],
        context: { generate_assets: { candidates: [{ index: 0, candidates: [{ id: "asset-start-1", kind: "image", path: "C:/tmp/start-1.png" }] }] } },
        checkpoint: { type: "scene_asset_selection" },
      },
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", description: "test", stages: [], category: "generated" };
    w.vm.pipelineText = "test selection checkpoint";

    await w.vm.startPipeline();

    expect(w.vm.view).toBe("pipelines");
    expect(w.vm.orchestrationRunId).toBe("run-start-selection");
    expect(w.vm.pipelineRunStatus?.status).toBe("paused");
    expect(w.vm.sceneAssetSelectionActive).toBe(true);
    expect(w.vm.s2vOptionsToast).not.toContain("后台运行");
    expect(mocks.pipelineGetRunContext).toHaveBeenCalledWith("run-start-selection");
    w.unmount();
  });

  it("历史任务恢复到素材选择暂停点时仍进入交互面板", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-selection-r1", pipeline: "story2video-compose", status: "paused", title: "待选素材任务", stages: [{ name: "generate_assets", status: "paused" }] },
    ] });
    mocks.pipelineResumeOrchestration.mockResolvedValue({ code: 0, data: { success: true, runId: "run-selection-r1", paused: true } });
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: {
        status: { status: "paused", currentStage: 4 },
        currentStage: 4,
        stages: [{ name: "generate_assets", status: "paused" }, { name: "compose", status: "pending" }],
        context: { generate_assets: { candidates: [{ index: 0, candidates: [{ id: "asset-1", kind: "image", path: "C:/tmp/asset-1.png" }] }] } },
        checkpoint: { type: "scene_asset_selection" },
      },
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
    });
    w.vm.pipelines = [{ name: "story2video-compose", available: true, stages: [] }];
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();
    w.vm.historyFilter = "paused";
    await nextTick();

    await w.vm.resumeHistoryItem(w.vm.filteredHistory[0]);
    await nextTick();

    expect(w.vm.view).toBe("pipelines");
    expect(w.vm.orchestrationRunId).toBe("run-selection-r1");
    expect(w.vm.pipelineRunStatus?.status).toBe("paused");
    expect(w.vm.sceneAssetSelectionActive).toBe(true);
    expect(mocks.pipelineGetRunContext).toHaveBeenCalledWith("run-selection-r1");
    w.unmount();
  });

  it("运行中历史任务显示「继续生成」并可一键恢复（重启后 running 快照断点续跑）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-running-r1", pipeline: "story2video-compose", status: "running", title: "进行中任务", error: null, stages: [{ name: "split", status: "completed" }, { name: "optimize", status: "running" }] },
    ] });
    mocks.pipelineResumeOrchestration.mockResolvedValue({ code: 0, data: { success: true, runId: "run-running-r1" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: "run-running-r1", pipeline: "story2video-compose", status: { status: "running" }, stages: [] } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.pipelines = [{ name: "story2video-compose", available: true, stages: [] }];
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();
    w.vm.historyFilter = "running";
    await nextTick();

    const resumeBtn = w.find(".s2v-btn-resume");
    expect(resumeBtn.exists()).toBe(true);
    expect(resumeBtn.text()).toContain("继续生成");

    await w.vm.resumeHistoryItem(w.vm.filteredHistory[0]);
    await nextTick();
    expect(mocks.pipelineResumeOrchestration).toHaveBeenCalledWith("run-running-r1");
    // 重启后 running 快照断点续跑同样是用户的显式继续动作：跳转流水线视图并实时跟踪，
    // 否则同断点继续一样会因 runId 为空停在默认阶段、看不到推进。
    expect(w.vm.view).toBe("pipelines");
    expect(w.vm.orchestrationRunId).toBe("run-running-r1");
    expect(w.vm.pipelineRunStatus?.status).toBe("running");
    expect(mocks.pipelineGetRunContext).toHaveBeenCalledWith("run-running-r1");
    expect(w.vm.pollTimer).not.toBeNull();
    w.unmount();
  });

  it("内容政策类失败历史任务不显示「从断点继续」", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-policy", pipeline: "story2video-compose", status: "failed", title: "违规任务", error: "content policy: 图片生成需要修改文案" },
    ] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();
    w.vm.historyFilter = "failed";
    await nextTick();

    expect(w.find(".s2v-btn-resume").exists()).toBe(false);
    w.unmount();
  });

  it("实时失败对话框对 content-policy（连字符）错误隐藏「从断点继续」", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.orchestrationRunId = "run-policy-live";
    w.vm.showStory2VideoErrorDialog({ error: "Image #49: Image generation requires user input after content-policy review" });
    await nextTick();
    expect(w.vm.canResumeStory2Video).toBe(false);
    // 非政策失败不受影响，仍显示「从断点继续」
    w.vm.showStory2VideoErrorDialog({ error: "provider timeout, please retry" });
    await nextTick();
    expect(w.vm.canResumeStory2Video).toBe(true);
    w.unmount();
  });

  it("可把当前参数保存为自定义模板、重新应用并删除", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.s2vConfig.imageEffect = "pan-up";
    w.vm.s2vConfig.transition = "slide-down";
    w.vm.s2vConfig.subtitleStyle.size = "xl";
    w.vm.s2vOutputConfig.resolution = "1080x1920";
    w.vm.s2vCustomTemplateName = "我的竖屏模板";

    w.vm.saveCurrentS2VTemplate();
    const selectedId = w.vm.s2vConfig.templateId;
    expect(selectedId).toMatch(/^custom-/);
    expect(w.vm.s2vTemplateLibrary.find(template => template.id === selectedId)).toMatchObject({
      name: "我的竖屏模板", category: "custom", imageEffect: "pan-up",
      transitionEffect: "slide-down", size: "1080x1920",
    });

    w.vm.s2vConfig.imageEffect = "none";
    w.vm.applyS2VTemplate();
    expect(w.vm.s2vConfig.imageEffect).toBe("pan-up");
    const confirmSpy = vi.spyOn(window, "confirm");
    w.vm.requestTemplateDeletion();
    expect(w.vm.story2videoTemplateDeleteDialog).toEqual({ visible: true, templateId: selectedId });
    w.vm.closeTemplateDeletionDialog();
    expect(w.vm.s2vTemplateLibrary.some(template => template.id === selectedId)).toBe(true);

    w.vm.requestTemplateDeletion();
    w.vm.confirmTemplateDeletion();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(w.vm.s2vTemplateLibrary.some(template => template.id === selectedId)).toBe(false);
    confirmSpy.mockRestore();
  });
  it("历史记录加载失败时只显示应用内弹窗，不显示页面错误条", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValueOnce({ code: 1, message: "internal path C:/private" });
    mocks.pipelineHistory.mockResolvedValueOnce({ code: 0, data: [] });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });

    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    expect(w.find(".history-error").exists()).toBe(false);
    expect(w.vm.story2videoErrorDialog).toEqual({ visible: true, detail: '', messageKey:  "story2video.history_load_failed",
      messageParams: {},
      rawError: '',
    });
  });

  it("删除 Story2Video 项目须经应用内确认，取消不会调用删除接口", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoDeleteProject.mockResolvedValue({ code: 0 });
    const confirmSpy = vi.spyOn(window, "confirm");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    w.vm.history = [{ projectId: "project-delete" }];

    w.vm.requestProjectDeletion({ projectId: "project-delete" });
    expect(w.vm.story2videoProjectDeleteDialog).toEqual({ visible: true, projectId: "project-delete" });
    w.vm.closeProjectDeletionDialog();
    expect(mocks.story2videoDeleteProject).not.toHaveBeenCalled();

    w.vm.requestProjectDeletion({ projectId: "project-delete" });
    await w.vm.confirmProjectDeletion();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.story2videoDeleteProject).toHaveBeenCalledWith("project-delete");
    expect(w.vm.history).toEqual([]);
    confirmSpy.mockRestore();
  });

  it("批量删除按 projectId/runId 分流，全部成功时移除对应历史项并提示成功数", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoDeleteProject.mockResolvedValue({ code: 0 });
    mocks.pipelineDeleteRun.mockResolvedValue({ code: 0 });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    const items = [
      { projectId: "p-batch-1", title: "项目A" },
      { id: "r-batch-1", pipeline: "story2video-compose" },
      { projectId: "p-batch-2", title: "项目C" },
    ];
    w.vm.history = items.slice();

    w.vm.requestHistoryBatchDeletion(items);
    expect(w.vm.story2videoBatchDeleteDialog.visible).toBe(true);
    expect(w.vm.story2videoBatchDeleteDialog.items.length).toBe(3);

    await w.vm.confirmBatchDeletion();

    expect(mocks.story2videoDeleteProject).toHaveBeenCalledTimes(2);
    expect(mocks.story2videoDeleteProject).toHaveBeenCalledWith("p-batch-1");
    expect(mocks.story2videoDeleteProject).toHaveBeenCalledWith("p-batch-2");
    expect(mocks.pipelineDeleteRun).toHaveBeenCalledTimes(1);
    expect(mocks.pipelineDeleteRun).toHaveBeenCalledWith("r-batch-1");
    expect(w.vm.history).toEqual([]);
    expect(w.vm.s2vOptionsToast).toContain("3");
  });

  it("批量删除部分成功时仅移除成功项并提示部分成功（含成功/失败计数）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoDeleteProject.mockResolvedValueOnce({ code: 0 }); // p-ok
    mocks.story2videoDeleteProject.mockResolvedValueOnce({ code: 1 }); // p-fail
    mocks.pipelineDeleteRun.mockResolvedValueOnce({ code: 0 }); // r-ok
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    const items = [
      { projectId: "p-ok" },
      { projectId: "p-fail" },
      { id: "r-ok", pipeline: "story2video-compose" },
    ];
    w.vm.history = items.slice();

    w.vm.requestHistoryBatchDeletion(items);
    await w.vm.confirmBatchDeletion();

    expect(mocks.story2videoDeleteProject).toHaveBeenCalledTimes(2);
    expect(mocks.pipelineDeleteRun).toHaveBeenCalledTimes(1);
    // 仅失败项保留
    expect(w.vm.history.length).toBe(1);
    expect(w.vm.history[0].projectId).toBe("p-fail");
    expect(w.vm.s2vOptionsToast).toContain("2");
    expect(w.vm.s2vOptionsToast).toContain("1");
  });

  it("批量删除全部失败时保留历史项并弹出错误对话框", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoDeleteProject.mockResolvedValue({ code: 1 });
    mocks.pipelineDeleteRun.mockResolvedValue({ code: 1 });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    const items = [
      { projectId: "p-fail-1" },
      { id: "r-fail-1", pipeline: "story2video-compose" },
    ];
    w.vm.history = items.slice();

    w.vm.requestHistoryBatchDeletion(items);
    await w.vm.confirmBatchDeletion();

    expect(w.vm.history.length).toBe(2);
    expect(w.vm.story2videoErrorDialog.visible).toBe(true);
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.batch_delete_failed");
  });

  it("批量删除进行中（deleting=true）再次触发 confirmBatchDeletion 应提前返回且不调用接口", async () => {
    const mocks = await import("@/api/publisher");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    const items = [{ projectId: "p-guard-1" }, { projectId: "p-guard-2" }];
    w.vm.requestHistoryBatchDeletion(items);
    expect(w.vm.story2videoBatchDeleteDialog.visible).toBe(true);
    expect(w.vm.story2videoBatchDeleteDialog.items.length).toBe(2);

    w.vm.deleting = true;
    await w.vm.confirmBatchDeletion();
    expect(mocks.story2videoDeleteProject).not.toHaveBeenCalled();
    expect(mocks.pipelineDeleteRun).not.toHaveBeenCalled();
    w.vm.deleting = false;
  });

  it("批量删除确认后对话框保持打开并显示删除中，完成后才关闭", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoDeleteProject.mockResolvedValue({ code: 0 });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    const items = [{ projectId: "p-keep-open" }];
    w.vm.history = items.slice();
    w.vm.requestHistoryBatchDeletion(items);
    expect(w.vm.story2videoBatchDeleteDialog.visible).toBe(true);
    const pending = w.vm.confirmBatchDeletion();
    expect(w.vm.deleting).toBe(true);
    expect(w.vm.story2videoBatchDeleteDialog.visible).toBe(true);
    await pending;
    expect(w.vm.story2videoBatchDeleteDialog.visible).toBe(false);
    expect(w.vm.deleting).toBe(false);
    expect(w.vm.history).toEqual([]);
  });

  it("批量删除 IPC 调用抛异常时计入失败并关闭对话框", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoDeleteProject.mockRejectedValue(new Error("ipc boom"));
    mocks.pipelineDeleteRun.mockRejectedValue(new Error("ipc run boom"));
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    const items = [
      { projectId: "p-throw" },
      { id: "r-throw" },
      { },
    ];
    w.vm.history = items.slice();
    w.vm.requestHistoryBatchDeletion(items);
    await w.vm.confirmBatchDeletion();
    expect(w.vm.story2videoBatchDeleteDialog.visible).toBe(false);
    expect(w.vm.deleting).toBe(false);
    expect(w.vm.history.length).toBe(3);
    expect(w.vm.story2videoErrorDialog.visible).toBe(true);
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.batch_delete_failed");
  });

  it("批量删除并行发起 IPC 调用（先全部发起再统一收口）", async () => {
    const mocks = await import("@/api/publisher");
    let callCount = 0;
    const resolvers = [];
    mocks.story2videoDeleteProject.mockImplementation(() => {
      callCount++;
      return new Promise(resolve => {
        resolvers.push(() => resolve({ code: 0 }));
      });
    });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    const items = [{ projectId: "p-par-1" }, { projectId: "p-par-2" }];
    w.vm.history = items.slice();
    w.vm.requestHistoryBatchDeletion(items);
    const pending = w.vm.confirmBatchDeletion();
    expect(callCount).toBe(2);
    expect(w.vm.history.length).toBe(2);
    resolvers.forEach(resolve => resolve());
    await pending;
    expect(w.vm.history).toEqual([]);
  });

});
  it("历史记录按有效时间倒序，运行中流水线显示阶段进度色块", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [{ projectId: "p1", title: "已完成项目", status: "completed" }] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-live", pipeline: "story2video-compose", status: "running", createdAt: "2026-08-07T00:00:00.000Z",
        stages: [{ name: "split", status: "completed" }, { name: "optimize", status: "running" }, { name: "compose", status: "pending" }] },
    ] });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();

    // 运行中流水线有有效创建时间，已完成项目无时间字段排在最后
    expect(w.vm.history[0].id).toBe("run-live");
    expect(w.vm.history[0].status).toBe("running");
    const runningItem = w.find(".history-item.is-running");
    expect(runningItem.exists()).toBe(true);
    expect(runningItem.text()).toContain("进行中");
    expect(runningItem.text()).toContain("任务正在后台运行（仍占用并发名额），可查看实时阶段进度");
    // 阶段进度条（done/active/pending）
    const stageSegs = runningItem.findAll(".history-progress-seg");
    expect(stageSegs.length).toBe(3);
    expect(stageSegs[0].classes()).toContain("done");
    expect(stageSegs[1].classes()).toContain("active");
    expect(stageSegs[2].classes()).toContain("pending");
    // 存在运行中任务时启动 5s 历史轮询
    expect(w.vm.historyPollTimer).not.toBeNull();
    w.unmount();
  });

  it("点击运行中历史项：即使有 projectId 也不进入编辑页、不触发恢复", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-no-proj", pipeline: "story2video-compose", status: "running", createdAt: "2026-08-07T00:00:00.000Z", stages: [] },
      { id: "run-live-2", projectId: "proj-live", pipeline: "story2video-compose", status: "running", createdAt: "2026-08-07T00:01:00.000Z", stages: [] },
    ] });
    mocks.pipelineStatus.mockResolvedValue({ code: 0, data: { id: "run-live-2", status: "running", orchestrationMode: "orchestrator" } });
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue();
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();
    mocks.pipelineResumeOrchestration.mockClear();
    expect(w.findAll(".history-item.is-running")).toHaveLength(2);
    // 无 projectId 的运行记录不可点击：body 无 button role
    const noProjItem = w.find('[data-history-id="run-no-proj"] .history-item-body');
    expect(noProjItem.attributes("role")).toBeUndefined();
    await noProjItem.trigger("click");
    await nextTick();
    expect(pushSpy).not.toHaveBeenCalled();
    // 有 projectId 的运行记录仍只保留流水线控制入口，不能进入编辑页
    await w.find('[data-history-id="run-live-2"] .history-item-body').trigger("click");
    await nextTick();
    expect(w.vm.view).toBe("history");
    expect(mocks.pipelineResumeOrchestration).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalledWith(expect.objectContaining({ path: "/create/result" }));
    pushSpy.mockRestore();
    w.unmount();
  });

  it("refreshRunningHistory 原地更新运行中阶段状态，不重建整个列表", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [{ projectId: "p1", title: "已完成项目", status: "completed" }] });
    const running = { id: "run-live-3", pipeline: "story2video-compose", status: "running", createdAt: "2026-08-07T00:00:00.000Z",
      stages: [{ name: "split", status: "completed" }, { name: "optimize", status: "running" }, { name: "compose", status: "pending" }] };
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [running] });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();
    const before = w.vm.history;
    expect(before.find(i => i.id === "run-live-3").stages[1].status).toBe("running");

    // 刷新：阶段推进 → 原地更新（数组身份不变，避免整表重渲染闪烁）
    const updated = { ...running, currentStage: "compose", checkpoint: { stage: "compose" }, activeMs: 15000, stages: [
      { name: "split", status: "completed" }, { name: "optimize", status: "completed" }, { name: "compose", status: "running" } ] };
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [updated] });
    await w.vm.refreshRunningHistory();
    await nextTick();
    expect(w.vm.history).toBe(before);
    const item = w.vm.history.find(i => i.id === "run-live-3");
    expect(item.stages[1].status).toBe("completed");
    expect(item.stages[2].status).toBe("running");
    expect(item).toMatchObject({ currentStage: "compose", checkpoint: { stage: "compose" }, activeMs: 15000 });
    expect(w.vm.history.some(i => i.projectId === "p1")).toBe(true);
    w.unmount();
  });

  it("refreshRunningHistory 运行结束的项触发完整加载，终态保留在历史中不消失", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoListProjects.mockResolvedValue({ code: 0, data: [] });
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-fin", pipeline: "story2video-compose", status: "running", createdAt: "2026-08-07T00:00:00.000Z", stages: [] },
    ] });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    w.vm.view = "history";
    await w.vm.loadHistory();
    await nextTick();
    expect(w.vm.history.some(i => i.id === "run-fin")).toBe(true);

    // 运行结束：终态（failed）出现在 pipelineHistory，刷新后应触发完整加载并显示终态，而不是消失
    mocks.pipelineHistory.mockResolvedValue({ code: 0, data: [
      { id: "run-fin", pipeline: "story2video-compose", status: "failed", createdAt: "2026-08-07T00:00:00.000Z", error: "boom", stages: [] },
    ] });
    await w.vm.refreshRunningHistory();
    await nextTick();
    expect(mocks.pipelineHistory.mock.calls.length).toBeGreaterThan(1); // 触发了完整加载
    const finished = w.vm.history.find(i => i.id === "run-fin");
    expect(finished).toBeTruthy();
    expect(finished.status).toBe("failed");
    w.unmount();
  });

  it("providerWarningText 为空时隐藏横幅", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    expect(w.vm.providerWarningText).toBe("");
    expect(w.find(".provider-warning-banner").exists()).toBe(false);
    w.unmount();
  });

  it("providerWarningText 汇总异常 provider 并给出友好建议", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    // 横幅位于流水线详情视图内，先选中一条流水线
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineRunStatus = { status: "running", progress: 1, stages: [{ name: "split", status: "running" }] };
    w.vm.pipelineProgressModalOpen = true;
    w.vm.providerWarnings = [
      { providerId: "agnes-llm", category: "llm", latencyMs: 90000, kind: "slow" },
      { providerId: "openai", category: "llm", latencyMs: 31000, kind: "timeout" },
    ];
    await nextTick();
    const text = w.vm.providerWarningText;
    expect(text).toContain("agnes-llm");
    expect(text).toContain("90 秒");
    expect(text).toContain("openai");
    expect(text).toContain("31 秒");
    expect(text).toContain("模型设置");
    expect(w.find(".provider-warning-banner").exists()).toBe(true);
    w.unmount();
  });

  it("providerWarningText 忽略异常数据（非数组/空数组）", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.providerWarnings = "not-an-array";
    await nextTick();
    expect(w.vm.providerWarningText).toBe("");
    w.unmount();

  });
  it("providerWarningText 支持 X 关闭，关闭后本次运行内不再显示", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineRunStatus = { status: "running", progress: 1, stages: [{ name: "split", status: "running" }] };
    w.vm.pipelineProgressModalOpen = true;
    w.vm.providerWarnings = [
      { providerId: "agnes-video", category: "video", latencyMs: 160000, kind: "slow" },
    ];
    await nextTick();
    expect(w.find(".provider-warning-banner").exists()).toBe(true);
    expect(w.find('[data-testid="dismiss-provider-warning"]').exists()).toBe(true);

    await w.find('[data-testid="dismiss-provider-warning"]').trigger("click");
    await nextTick();
    expect(w.vm.providerWarningText).toBe("");
    expect(w.find(".provider-warning-banner").exists()).toBe(false);
    w.unmount();
  });

  it("updateOrchestrationStatus 返回无 providerWarnings 时清空旧警告（跨运行不残留）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "running" }, context: {}, createdAt: "2026-08-13T01:00:00.000Z" } });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.orchestrationRunId = "run-new";
    w.vm.providerWarnings = [{ providerId: "agnes-video", category: "video", latencyMs: 160000, kind: "slow" }];

    await w.vm.updateOrchestrationStatus();
    await nextTick();

    expect(w.vm.providerWarnings).toEqual([]);
    expect(w.vm.providerWarningText).toBe("");
    w.unmount();
  });

  it("切换流水线后旧运行警告不残留（selectPipeline 重置）", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    // 上一运行残留的警告与关闭状态
    w.vm.providerWarnings = [{ providerId: "agnes-video", category: "video", latencyMs: 160000, kind: "slow" }];
    w.vm.dismissedProviderWarnings = true;

    w.vm.selectPipeline({ name: "cinematic", description: "test", stages: [], category: "generated" });
    await nextTick();

    expect(w.vm.providerWarnings).toEqual([]);
    expect(w.vm.dismissedProviderWarnings).toBe(false);
    w.unmount();
  });

  it("cancelPipeline 重置警告列表与关闭状态", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockResolvedValue({ code: 0, data: true });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.providerWarnings = [{ providerId: "agnes-video", category: "video", latencyMs: 160000, kind: "slow" }];
    w.vm.dismissedProviderWarnings = true;

    await w.vm.cancelPipeline();
    await nextTick();

    expect(w.vm.providerWarnings).toEqual([]);
    expect(w.vm.dismissedProviderWarnings).toBe(false);
    w.unmount();
  });

  it("启动新流水线时重置警告列表与关闭状态（跨运行不残留）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: -1, message: "Story2Video 默认 LLM 不可用，请先完成模型设置" });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", description: "test", stages: [], category: "generated" };
    w.vm.pipelineText = "测试文案";
    // 模拟上一运行残留的警告与关闭状态（复现跨运行残留）
    w.vm.providerWarnings = [{ providerId: "agnes-video", category: "video", latencyMs: 160000, kind: "slow" }];
    w.vm.dismissedProviderWarnings = true;

    await w.vm.startPipeline();

    expect(w.vm.providerWarnings).toEqual([]);
    expect(w.vm.dismissedProviderWarnings).toBe(false);
    w.unmount();
  });


  it("BGM 被跳过时显示提示条，可关闭；未跳过不显示", async () => {
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    // 提示条位于流水线详情视图内，先选中一条流水线（与 providerWarningText 用例一致）
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineRunStatus = { status: "running", progress: 1, stages: [{ name: "split", status: "running" }] };
    w.vm.pipelineProgressModalOpen = true;

    // 未跳过：不显示
    w.vm.orchestrationContext = { compose: { bgmSkipped: false } };
    await nextTick();
    expect(w.vm.story2videoBgmSkippedNotice).toBe("");
    expect(w.find('[data-testid="story2video-bgm-skipped-notice"]').exists()).toBe(false);

    // 跳过：显示 i18n 文案
    w.vm.orchestrationContext = { compose: { bgmSkipped: true, bgmSkippedReason: "size_exceeded" } };
    await nextTick();
    expect(w.vm.story2videoBgmSkippedNotice).toContain("背景音乐已跳过");
    expect(w.vm.story2videoBgmSkippedNotice).toContain("超过大小上限");
    expect(w.find('[data-testid="story2video-bgm-skipped-notice"]').exists()).toBe(true);

    // 关闭后隐藏
    await w.find('[data-testid="dismiss-bgm-skipped-notice"]').trigger("click");
    await nextTick();
    expect(w.vm.story2videoBgmSkippedNotice).toBe("");
    expect(w.find('[data-testid="story2video-bgm-skipped-notice"]').exists()).toBe(false);
    w.unmount();
  });

  it("选项自动保存后 toast 短暂显示并自动消失，不影响操作栏", async () => {
    vi.useFakeTimers();
    const mocks = await import("@/api/publisher");
    mocks.storeSetSetting.mockResolvedValue({ code: 0 });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    await nextTick();

    // 修改一个选项 → 触发 1s 防抖保存
    w.vm.s2vConfig.bgmVolume = 6;
    await vi.advanceTimersByTimeAsync(1100);
    await nextTick();
    expect(w.find('[data-testid="s2v-options-toast"]').exists()).toBe(true);
    expect(w.vm.s2vOptionsToast).toContain("已保存");

    // 1.6s 后自动消失
    await vi.advanceTimersByTimeAsync(1700);
    await nextTick();
    expect(w.vm.s2vOptionsToast).toBe("");
    expect(w.find('[data-testid="s2v-options-toast"]').exists()).toBe(false);
    w.unmount();
    vi.useRealTimers();
  });

describe("运营开关 videoCreation.maxOutputResolution（4K 能力）", () => {
  it("默认/1080p：前端不出现 4K 分辨率选项", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue(null); // 未配置 → 默认 1080p
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    expect(w.vm.maxOutputResolution).toBe("1080p");
    const values = w.findAll("option").map((o) => o.attributes("value"));
    expect(values).toContain("1920x1080");
    expect(values).not.toContain("3840x2160");
    expect(w.text()).not.toContain("3840×2160");
    w.unmount();
    mocks.storeGetSetting.mockReset();
  });

  it("运营配置 4k：前端出现 4K 分辨率选项", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    mocks.storeGetSetting.mockResolvedValue({ code: 0, data: "4k" });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    expect(w.vm.maxOutputResolution).toBe("4k");
    const values = w.findAll("option").map((o) => o.attributes("value"));
    expect(values).toContain("3840x2160");
    w.unmount();
    mocks.storeGetSetting.mockReset();
  });

  it("1080p：恢复的旧快照含 4K 时归一化到 1920x1080（历史/模板不残留 4K）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineList.mockResolvedValue({ code: 0, data: [] });
    // loadMaxOutputResolution 读到快照对象 → 按 1080p 处理；restoreS2VLastOptions 恢复 4K 快照
    mocks.storeGetSetting.mockResolvedValue({
      code: 0,
      data: {
        version: 1,
        s2vConfig: {},
        s2vOutputConfig: { resolution: "3840x2160", fps: 30 },
        ui: { expandedGroups: [] },
      },
    });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.s2vVoiceProviders = [{ id: "minimax-tts" }, { id: "edge-tts" }];
    w.vm.s2vImageProviders = [{ id: "minimax-image" }];
    await w.vm.restoreS2VLastOptions();
    expect(w.vm.maxOutputResolution).toBe("1080p");
    expect(w.vm.s2vOutputConfig.resolution).toBe("1920x1080");
    w.unmount();
    mocks.storeGetSetting.mockReset();
  });

  describe("克隆音色设为默认与媒体导入细分提示（2026-08-09）", () => {
    it("克隆音色「设为默认」同步下拉、保存偏好并显示默认徽标", async () => {
      const ttsMocks = await import("@/api/tts-voice-catalog");
      const selectSpy = vi.fn().mockResolvedValue({
        code: 0,
        data: { providerId: "minimax-tts", model: "speech-2.8-turbo", selectedVoiceId: "MiniMaxVoice_abc123", voices: [] },
      });
      ttsMocks.selectTtsVoice.mockImplementation(selectSpy);
      const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
      w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
      await nextTick();
      // 让 mounted 触发的异步加载先收敛，避免后续 resetS2VVoiceData 覆盖测试状态
      await w.vm.loadS2VProviders();
      await nextTick();
      w.vm.s2vConfig.voiceProvider = "minimax-tts";
      w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
      w.vm.s2vVoiceCatalog = [];
      w.vm.s2vVoiceClones = [{ id: "MiniMaxVoice_abc123", name: "克隆01" }, { id: "other-voice", name: "克隆02" }];
      w.vm.s2vVoiceCapability = { type: "user_clone", clone: { enabled: true } };
      w.vm.s2vCloneOpen = true;
      await nextTick();

      await w.vm.selectS2VVoice("MiniMaxVoice_abc123");

      // 下拉/配置已同步（并发守卫不再静默丢弃），偏好已保存
      expect(w.vm.s2vConfig.voiceId).toBe("MiniMaxVoice_abc123");
      expect(w.vm.s2vPersistedVoiceId).toBe("MiniMaxVoice_abc123");
      expect(selectSpy).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "MiniMaxVoice_abc123" }));
      // 默认徽标与按钮文案
      expect(w.vm.isS2VDefaultVoice("MiniMaxVoice_abc123")).toBe(true);
      expect(w.vm.isS2VDefaultVoice("other-voice")).toBe(false);
      const list = w.find(".voice-clone-list");
      expect(list.exists()).toBe(true);
      expect(list.text()).toContain("默认");
      expect(list.text()).toContain("已设为默认");
      w.unmount();
    });

    it("设为默认保存失败时回滚下拉与徽标，不显示未持久化的默认音色", async () => {
      const ttsMocks = await import("@/api/tts-voice-catalog");
      ttsMocks.selectTtsVoice.mockResolvedValue({ code: -1, message: "VOICE_PREFERENCE_STORE_UNAVAILABLE" });
      const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
      await nextTick();
      await w.vm.loadS2VProviders();
      await nextTick();
      w.vm.s2vConfig.voiceProvider = "minimax-tts";
      w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
      w.vm.s2vVoiceCatalog = [];
      w.vm.s2vVoiceClones = [{ id: "MiniMaxVoice_abc123", name: "克隆01" }];
      w.vm.s2vConfig.voiceId = "other-voice"; // 当前默认是 other
      await nextTick();

      const ok = await w.vm.selectS2VVoice("MiniMaxVoice_abc123");

      expect(ok).toBe(false);
      // 失败后回滚：不把未持久化的克隆显示成默认
      expect(w.vm.s2vConfig.voiceId).toBe("other-voice");
      expect(w.vm.isS2VDefaultVoice("MiniMaxVoice_abc123")).toBe(false);
      expect(w.vm.s2vVoiceCatalogError).toContain("本地存储");
      w.unmount();
    });

    it("无效克隆「设为默认」按钮禁用并显示已失效徽标", async () => {
      const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
      await nextTick();
      await w.vm.loadS2VProviders();
      await nextTick();
      // 显式选择 story2video-compose 流水线：本用例只关心克隆面板渲染，
      // 不依赖前面用例遗留的 pipelineList mock 状态（消除顺序依赖）
      w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split", "optimize", "generate_assets", "compose"] };
      w.vm.s2vConfig.voiceProvider = "minimax-tts";
      w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
      w.vm.s2vVoiceCapability = { type: "user_clone", clone: { enabled: true } };
      w.vm.s2vCloneOpen = true;
      w.vm.s2vVoiceClones = [{ id: "01", name: "克隆01", invalid: true }];
      // 与 4K 用例一致的稳定等待：S2V 合成区随 mount 异步初始化，纯 nextTick 在隔离/额外 microtask 下时序不稳
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();

      const list = w.find(".voice-clone-list");
      expect(list.text()).toContain("已失效，请重新克隆");
      const setDefault = list.findAll("button").find(b => b.text().includes("设为默认"));
      expect(setDefault).toBeTruthy();
      expect(setDefault.attributes("disabled")).toBeDefined();
      w.unmount();
    });

    it("resolveMediaImportFailure 透传类别宾语并区分路径解析失败", () => {
      const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
      expect(w.vm.resolveMediaImportFailure({ message: "媒体文件不存在或不可读" }, "背景音乐").messageKey).toBe("story2video.media_unreadable");
      expect(w.vm.resolveMediaImportFailure({ message: "媒体文件不存在或不可读" }, "背景音乐").messageParams.kindLabel).toBe("背景音乐");
      expect(w.vm.resolveMediaImportFailure({ message: "无法读取媒体文件路径" }, "背景音乐").messageKey).toBe("story2video.media_path_unresolved");
      expect(w.vm.resolveMediaImportFailure({ message: "无法读取媒体文件路径" }, "背景音乐").messageParams.kindLabel).toBe("背景音乐");
      expect(w.vm.resolveMediaImportFailure({ message: "不支持的媒体格式" }, "旁白音频").messageKey).toBe("story2video.media_format_invalid");
      expect(w.vm.resolveMediaImportFailure({ message: "媒体文件超过大小上限" }, "图片").messageKey).toBe("story2video.media_size_exceeded");
      expect(w.vm.resolveMediaImportFailure({ message: "未知原因" }, "视频素材").messageKey).toBe("story2video.media_invalid");
      w.unmount();
    });

    it("BGM 主进程拒绝不可读时弹带「背景音乐」宾语的细分提示", async () => {
      const mocks = await import("@/api/publisher");
      mocks.story2videoBgmLibraryAdd.mockResolvedValue({ code: -1, message: "媒体文件不存在或不可读" });
      const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
      await nextTick();

      await w.vm.handleS2VBgmFile({ target: { files: [{ name: "bgm.mp3", size: 5 }] } });

      expect(w.vm.s2vConfig.bgmPath).toBe("");
      expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.media_unreadable");
      expect(w.vm.story2videoErrorDialog.messageParams.kindLabel).toBe("背景音乐");
      w.unmount();
    });
  });

  it("音色目录配置类失败显示可操作文案，且不提供刷新按钮（重试无效）", async () => {
    const ttsMocks = await import("@/api/tts-voice-catalog");
    ttsMocks.getTtsVoiceCatalog.mockResolvedValueOnce({ code: -1, message: "VOICE_CATALOG_CONFIG_UNAVAILABLE" });
    ttsMocks.getTtsVoiceCapability.mockResolvedValue({ code: 0, data: { type: "builtin", clone: { enabled: false } } });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    await nextTick();
    await w.vm.loadS2VProviders();
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "minimax-tts";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    await w.vm.loadS2VVoiceData();
    await nextTick();

    expect(w.vm.s2vVoiceCatalogError).toContain("模型设置");
    expect(w.vm.s2vVoiceCatalogRefreshable).toBe(false);
    expect(w.find('[data-testid="s2v-voice-catalog-refresh"]').exists()).toBe(false);
    w.unmount();
  });

  it("瞬时失败（VOICE_CATALOG_UNAVAILABLE）可通过「刷新音色列表」强制重拉", async () => {
    const ttsMocks = await import("@/api/tts-voice-catalog");
    ttsMocks.getTtsVoiceCatalog.mockResolvedValueOnce({ code: -1, message: "VOICE_CATALOG_UNAVAILABLE" });
    ttsMocks.getTtsVoiceCapability.mockResolvedValue({ code: 0, data: { type: "builtin", clone: { enabled: false } } });
    const w = mount(CreateView, { global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } } });
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    await nextTick();
    await w.vm.loadS2VProviders();
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "minimax-tts";
    w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
    await w.vm.loadS2VVoiceData();
    await nextTick();

    expect(w.vm.s2vVoiceCatalogError).toContain("请稍后重试");
    expect(w.vm.s2vVoiceCatalogRefreshable).toBe(true);
    const refreshBtn = w.find('[data-testid="s2v-voice-catalog-refresh"]');
    expect(refreshBtn.exists()).toBe(true);

    ttsMocks.getTtsVoiceCatalog.mockResolvedValue({
      code: 0,
      data: {
        providerId: "minimax-tts",
        model: "speech-2.8-turbo",
        voices: [{ id: "male-qn-qingse", name: "青年男声" }],
        selectedVoiceId: "male-qn-qingse",
        invalidVoices: [],
      },
    });
    await refreshBtn.trigger("click");
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    expect(ttsMocks.getTtsVoiceCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerId: "minimax-tts", model: "speech-2.8-turbo", refresh: true })
    );
    expect(w.vm.s2vVoiceCatalogError).toBe("");
    w.unmount();
  });
});

describe("视频创作流水线「已用时」步骤执行耗时口径", () => {
  it("已用时优先使用 activeMs（步骤执行耗时累计），不随墙钟 createdAt 膨胀", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.pipelineRunStatus = {
      status: "running",
      stages: [{ name: "split", status: "completed", startedAt: new Date().toISOString() }],
    };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split"] };
    w.vm.pipelineProgressModalOpen = true;
    // 墙钟 createdAt 在 20 小时前，但 activeMs 只有 65 秒 → 必须展示 65 秒量级
    w.vm.story2videoRunMeta = {
      createdAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      endedAt: null,
      activeMs: 65000,
      activeSegmentStartedAt: null,
    };
    await nextTick();
    expect(w.text()).toContain("已用时 1 分 5 秒");
    expect(w.text()).not.toContain("已用时 19 小时");
    w.unmount();
  });

  it("运行中在飞执行段本地每秒补差：elapsedMs = activeMs + (now - activeSegmentStartedAt)", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.pipelineRunStatus = {
      status: "running",
      stages: [{ name: "split", status: "running", startedAt: new Date(Date.now() - 5000).toISOString() }],
    };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split"] };
    w.vm.pipelineProgressModalOpen = true;
    w.vm.story2videoRunMeta = {
      createdAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      endedAt: null,
      activeMs: 65000,
      activeSegmentStartedAt: new Date(Date.now() - 5000).toISOString(),
    };
    await nextTick();
    const elapsed = w.vm.orchestrationElapsedMs;
    expect(elapsed).toBeGreaterThanOrEqual(69500);
    expect(elapsed).toBeLessThanOrEqual(71000);
    w.unmount();
  });

  it("旧数据（无 activeMs）回退墙钟 createdAt→now，展示不为空", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.pipelineRunStatus = { status: "running", stages: [{ name: "split", status: "completed" }] };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split"] };
    w.vm.pipelineProgressModalOpen = true;
    w.vm.story2videoRunMeta = { createdAt: new Date(Date.now() - 65000).toISOString(), endedAt: null };
    await nextTick();
    const elapsed = w.vm.orchestrationElapsedMs;
    expect(elapsed).toBeGreaterThanOrEqual(60000);
    expect(elapsed).toBeLessThanOrEqual(70000);
    w.unmount();
  });

  it("完成汇总「完成时间共 X 分 Y 秒」使用 activeMs 而非墙钟", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.story2videoRunMeta = {
      createdAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      outputSizeBytes: 1048576,
      activeMs: 125000,
      activeSegmentStartedAt: null,
    };
    await nextTick();
    expect(w.vm.orchestrationSummary).toContain("完成时间共 2 分 5 秒");
    expect(w.vm.orchestrationSummary).toContain("文件大小 1.0 M");
    expect(w.vm.orchestrationSummary).not.toContain("19 小时");
    w.unmount();
  });

  it("结果页 durationMs 使用 activeMs（步骤执行耗时累计）", async () => {
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue();
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.story2videoRunMeta = {
      createdAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      activeMs: 125000,
      activeSegmentStartedAt: null,
    };
    w.vm.orchestrationContext = { compose: { data: { videoPath: "C:/tmp/x.mp4" } } };
    const handled = w.vm.applyOrchestrationOutcome({
      completed: true,
      context: { compose: { data: { videoPath: "C:/tmp/x.mp4" } } },
    });
    expect(handled).toBe(true);
    const pushCall = [...pushSpy.mock.calls].reverse().find((args) => args[0] && args[0].path === "/create/result");
    expect(pushCall).toBeTruthy();
    expect(pushCall[0].query.durationMs).toBe(125000);
    pushSpy.mockRestore();
    w.unmount();
  });
});

describe("视频创作「已用时」审查闭环回归（C1/W2）", () => {
  it("activeMs 为 null（生产旧数据标记）时回退墙钟，不误显示 0 秒", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.pipelineRunStatus = { status: "running", stages: [{ name: "split", status: "completed" }] };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split"] };
    w.vm.pipelineProgressModalOpen = true;
    // updateOrchestrationStatus 对无 activeMs 的主进程响应归一化为 null（Number(null)===0 陷阱回归）
    w.vm.story2videoRunMeta = {
      createdAt: new Date(Date.now() - 65000).toISOString(),
      endedAt: null,
      activeMs: null,
      activeSegmentStartedAt: null,
    };
    await nextTick();
    const elapsed = w.vm.orchestrationElapsedMs;
    expect(elapsed).toBeGreaterThanOrEqual(60000);
    expect(elapsed).toBeLessThanOrEqual(70000);
    expect(w.find('[data-testid="pipeline-progress-modal-content"]').text()).toContain("已用时");
    w.unmount();
  });

  it("检查点确认返回的终态 activeMs 覆盖轮询缓存，结果页 durationMs 用新值", async () => {
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue();
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    // 模拟轮询缓存已过期（只有 10 秒）
    w.vm.story2videoRunMeta = {
      createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      activeMs: 10000,
      activeSegmentStartedAt: null,
    };
    w.vm.orchestrationContext = { publish: { data: { videoPath: "C:/tmp/y.mp4" } } };
    const handled = w.vm.applyOrchestrationOutcome({
      completed: true,
      activeMs: 125000, // 终态权威值（主进程 advanceToNextCheckpoint/executeStage 返回）
      context: { publish: { data: { videoPath: "C:/tmp/y.mp4" } } },
    });
    expect(handled).toBe(true);
    const pushCall = [...pushSpy.mock.calls].reverse().find((args) => args[0] && args[0].path === "/create/result");
    expect(pushCall).toBeTruthy();
    expect(pushCall[0].query.durationMs).toBe(125000);
    pushSpy.mockRestore();
    w.unmount();
  });
});

describe("分镜模式 storyboardMode（video-content-fidelity UI）", () => {
  it("默认 auto，animation 流水线启动透传 storyboardMode=auto", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-sbm-auto" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "animation", stages: [] };
    w.vm.pipelineText = "一只戴帽子的猫在月球上喝茶";
    await w.vm.startPipeline();
    expect(w.vm.storyboardMode).toBe("auto");
    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalledWith("animation", expect.objectContaining({
      storyboardMode: "auto",
    }));
    w.unmount();
  });

  it("切换 fidelity 后 animation 启动透传 storyboardMode=fidelity", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-sbm-fid" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "animation", stages: [] };
    w.vm.pipelineText = "关羽那么厉害，为什么三国志里没有细节描写？这是一段用于测试分镜保真的长文案。";
    w.vm.storyboardMode = "fidelity";
    await w.vm.startPipeline();
    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalledWith("animation", expect.objectContaining({
      storyboardMode: "fidelity",
    }));
    // 与 checkpointPolicy 一致：通用高级配置为会话内记忆，不做 lastOptions 持久化
    w.unmount();
  });

  it("分镜模式下拉在动画流水线高级配置区渲染四个选项", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "animation", stages: [] };
    await nextTick();
    const select = w.find("[data-testid='storyboard-mode-select']");
    expect(select.exists()).toBe(true);
    const options = select.findAll("option").map(o => o.attributes("value"));
    expect(options).toEqual(["auto", "creative", "fidelity", "hybrid"]);
    w.unmount();
  });

  it("reportEvolutionFeedback 在 preload API 缺失时静默跳过（P0 反馈管道 fallback）", async () => {
    window.electronAPI = {};
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.orchestrationRunId = "run-fallback-test";
    await expect(w.vm.reportEvolutionFeedback({ type: "accepted", detail: { mode: "scene-asset-selection" } })).resolves.toBeUndefined();
    w.unmount();
  });

  it("reportEvolutionFeedback 调用 preload generationFeedback 并透传类型", async () => {
    const fb = vi.fn(async () => ({ code: 0 }));
    window.electronAPI = { generationFeedback: fb };
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.orchestrationRunId = "run-fb-test";
    await w.vm.reportEvolutionFeedback({ type: "downloaded", detail: { file: "x.png" } });
    expect(fb).toHaveBeenCalledTimes(1);
    expect(fb.mock.calls[0][0]).toMatchObject({ type: "downloaded", sessionId: "run-fb-test" });
    w.unmount();
  });
});

describe("分镜素材自选等待态 UX（2026-08-13）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const mountCreate = async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.orchestrationRunId = "run-sel-ux";
    await nextTick();
    return w;
  };

  const selectionPayload = () => ({
    code: 0,
    data: {
      status: { status: "paused", currentStage: 4 },
      currentStage: 4,
      stages: [
        { name: "split", status: "completed" },
        { name: "domain_enrich", status: "completed" },
        { name: "optimize", status: "completed" },
        { name: "select_video_scenes", status: "completed" },
        { name: "generate_assets", status: "paused", startedAt: new Date().toISOString() },
        { name: "compose", status: "pending" },
        { name: "publish", status: "pending" },
      ],
      context: {
        generate_assets: {
          candidates: [
            { index: 0, candidates: [{ id: "a1", kind: "image", path: "C:/tmp/a1.png" }] },
            { index: 1, candidates: [{ id: "b1", kind: "image", path: "C:/tmp/b1.png" }] },
          ],
        },
      },
      checkpoint: { type: "scene_asset_selection" },
    },
  });

  it("检查点激活：横幅（含场景数）+ 就近面板 + 等待文案出现，且首次激活自动滚动一次", async () => {
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValue(selectionPayload());
    const w = await mountCreate();
    // spy 组件方法而非全局 Element.scrollIntoView（StageProgress 自动滚动也会触发全局 spy，2026-09-13 PR #1770 回归）
    const scrollSpy = vi.spyOn(w.vm, "scrollToSceneAssetPanel");
    await w.vm.updateOrchestrationStatus();
    await nextTick();

    const banner = w.find('[data-testid="s2v-selection-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("2 个场景");
    expect(w.find('[data-testid="s2v-selection-go"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-scene-asset-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-selection-waiting-text"]').exists()).toBe(true);
    expect(w.vm.sceneAssetSelectionActive).toBe(true);
    expect(w.vm.selectionGuided).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    scrollSpy.mockRestore();
    w.unmount();
  });

  it("后续轮询不重复滚动（selectionGuided 一次性）", async () => {
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValue(selectionPayload());
    const w = await mountCreate();
    // spy 组件方法而非全局 Element.scrollIntoView（StageProgress 自动滚动也会触发全局 spy，2026-09-13 PR #1770 回归）
    const scrollSpy = vi.spyOn(w.vm, "scrollToSceneAssetPanel");
    await w.vm.updateOrchestrationStatus();
    await nextTick();
    await w.vm.updateOrchestrationStatus();
    await nextTick();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    scrollSpy.mockRestore();
    w.unmount();
  });

  it("无 scene_asset_selection 检查点时无横幅/面板/等待文案", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: { status: { status: "running" }, stages: [{ name: "generate_assets", status: "running" }], context: {}, checkpoint: null },
    });
    const w = await mountCreate();
    await w.vm.updateOrchestrationStatus();
    await nextTick();
    expect(w.find('[data-testid="s2v-selection-banner"]').exists()).toBe(false);
    expect(w.find('[data-testid="s2v-scene-asset-panel"]').exists()).toBe(false);
    expect(w.find('[data-testid="s2v-selection-waiting-text"]').exists()).toBe(false);
    w.unmount();
  });

  it("取消二次确认：先弹确认框，确认后执行 pipelineCancel 并重置状态", async () => {
    const mocks = await import("@/api/publisher");
    const w = await mountCreate();
    w.vm.pipelineRunStatus = { status: "paused", stages: [{ name: "generate_assets", status: "paused" }] };
    w.vm.sceneAssetSelectionActive = true;
    await nextTick();

    await w.find('[data-testid="s2v-cancel-trigger"]').trigger("click");
    expect(w.vm.cancelConfirmDialog.visible).toBe(true);

    const confirmOk = w.find('[data-testid="s2v-cancel-confirm-ok"]');
    expect(confirmOk.exists()).toBe(true);
    await confirmOk.trigger('click');
    await nextTick();
    expect(mocks.pipelineCancel).toHaveBeenCalled();
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.sceneAssetSelectionActive).toBe(false);
    expect(w.vm.cancelConfirmDialog.visible).toBe(false);
    w.unmount();
  });

  it("暂停编排流水线时防止重复提交", async () => {
    const mocks = await import("@/api/publisher");
    let resolvePause
    mocks.pipelinePauseRun.mockImplementation(() => new Promise((resolve) => { resolvePause = resolve }))
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: { status: { status: "paused" }, stages: [], context: {}, checkpoint: null },
    })
    const w = await mountCreate();
    w.vm.orchestrationRunId = "run-pause-once";
    w.vm.pipelineRunStatus = { status: "running", stages: [] };

    const firstPause = w.vm.pauseOrchestrationPipeline();
    const secondPause = w.vm.pauseOrchestrationPipeline();
    expect(mocks.pipelinePauseRun).toHaveBeenCalledTimes(1);
    expect(w.vm.pauseActionBusy).toBe(true);

    resolvePause({ code: 0, data: { status: "paused" } });
    await firstPause;
    await secondPause;
    expect(w.vm.pauseActionBusy).toBe(false);
    w.unmount();
  });

  it("非素材选择状态取消不弹确认框（一步直达 cancelPipeline，审查 C1）", async () => {
    const mocks = await import("@/api/publisher");
    const w = await mountCreate();
    w.vm.pipelineRunStatus = { status: "running", stages: [{ name: "generate_assets", status: "running" }] };
    w.vm.sceneAssetSelectionActive = false;
    await nextTick();

    await w.find('[data-testid="s2v-cancel-trigger"]').trigger("click");
    await nextTick();
    expect(mocks.pipelineCancel).toHaveBeenCalled();
    expect(w.vm.cancelConfirmDialog.visible).toBe(false);
    w.unmount();
  });

  it("点击「去选择素材」按钮触发滚动 + 高亮（审查 I5）", async () => {
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValue(selectionPayload());
    const w = await mountCreate();
    w.vm.selectionGuided = true; // 关闭自动滚动，仅验证按钮路径
    // spy 组件方法而非全局 Element.scrollIntoView（StageProgress 自动滚动也会触发全局 spy，2026-09-13 PR #1770 回归）；
    // 保留原实现（sceneAssetAttention 置位 + 滚动），仅统计调用次数
    const scrollSpy = vi.spyOn(w.vm, "scrollToSceneAssetPanel");
    await w.vm.updateOrchestrationStatus();
    await nextTick();

    await w.find('[data-testid="s2v-selection-go"]').trigger("click");
    await nextTick();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(w.vm.sceneAssetAttention).toBe(true);
    scrollSpy.mockRestore();
    w.unmount();
  });
});

describe("流水线启动前台跟踪与离开转后台（2026-08-21）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const mountRunning = async () => {
    // 顺序无关：前序用例可能泄漏 pipelineStatus mock（运行中 run），重置为无运行，避免 mounted 自动重挂干扰断言
    const mocks = await import("@/api/publisher");
    mocks.pipelineStatus.mockResolvedValue({ code: 0, data: null });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "running" }, stages: [], context: {}, checkpoint: null } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress }, stubs: { teleport: true } },
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: ["split", "optimize", "generate_assets", "compose"] };
    w.vm.pipelineRunStatus = {
      status: "running",
      progress: 30,
      stages: [
        { name: "split", status: "completed" },
        { name: "optimize", status: "running" },
      ],
    };
    w.vm.orchestrationStages = w.vm.pipelineRunStatus.stages;
    w.vm.orchestrationRunId = "run-bg-1";
    w.vm.orchestrationContext = { split: { scenes: [{}, {}] } };
    w.vm.story2videoRunMeta = { createdAt: new Date().toISOString(), endedAt: null };
    w.vm.pipelineProgressModalOpen = true;
    await nextTick();
    return w;
  };

  it("openRunningPipeline：无效 runId 不切换视图、不启动轮询（不污染当前运行态）", async () => {
    const mocks = await import("@/api/publisher");
    const w = await mountRunning();
    const before = { runId: w.vm.orchestrationRunId, status: w.vm.pipelineRunStatus, view: w.vm.view };
    const ok = await w.vm.openRunningPipeline("  ");
    await nextTick();
    expect(ok).toBe(false);
    expect(w.vm.view).toBe(before.view);
    expect(w.vm.orchestrationRunId).toBe(before.runId);
    expect(w.vm.pipelineRunStatus).toBe(before.status);
    w.unmount();
  });

  it("运行中编排流水线在进度弹窗中提供后台运行按钮", async () => {
    const w = await mountRunning();
    expect(w.find('[data-testid="s2v-progress-modal"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-progress-modal"]').text()).not.toContain('{name}');
    expect(w.vm.pipelineProgressModalTitle).not.toContain('{name}');
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-cancel-trigger"]').exists()).toBe(true);
    w.unmount();
  });

  it("进度弹窗禁止遮罩和 Escape 关闭，只允许右上角关闭按钮", async () => {
    const w = await mountRunning();
    const overlay = w.find('[data-testid="s2v-progress-modal"]');
    await overlay.trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    expect(w.vm.orchestrationRunId).toBe('run-bg-1');
    await w.find('[data-testid="s2v-progress-modal"] [data-testid="ui-modal-close"]').trigger('click');
    await nextTick();
    expect(w.vm.pipelineProgressModalOpen).toBe(false);
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.s2vOptionsToast).toContain('后台运行');
    w.unmount();
  });

  it("点击后台运行只脱离前端跟踪，不取消主进程 run，并恢复新建态", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    const w = await mountRunning();
    w.vm.pipelineText = 'old text';
    await w.find('[data-testid="s2v-background-trigger"]').trigger('click');
    await nextTick();
    expect(mocks.pipelineCancel).not.toHaveBeenCalled();
    expect(w.vm.pollTimer).toBeNull();
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.pipelineProgressModalOpen).toBe(false);
    expect(w.vm.selectedPipeline).toBeNull();
    expect(w.vm.view).toBe('pipelines');
    expect(w.vm.s2vOptionsToast).toContain('后台运行');
    w.unmount();
  });

  it("弹窗打开时底部暂停按钮仍能调用 pause IPC 并保留弹窗", async () => {
    const mocks = await import("@/api/publisher");
    const w = await mountRunning();
    mocks.pipelinePauseRun.mockResolvedValue({ code: 0, data: { success: true } });
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: { status: { status: "paused" }, stages: [], context: {}, checkpoint: null },
    });

    await w.find('[data-testid="s2v-pause-trigger"]').trigger("click");
    await vi.waitFor(() => expect(mocks.pipelinePauseRun).toHaveBeenCalledWith("run-bg-1"));
    await vi.waitFor(() => expect(w.vm.pipelineRunStatus?.status).toBe("paused"));
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    expect(w.find('[data-testid="s2v-cancel-trigger"]').exists()).toBe(true);
    w.unmount();
  });

  it("弹窗打开时底部取消按钮仍能调用 cancel IPC 并清理前端跟踪", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockResolvedValue({ code: 0, data: true });
    const w = await mountRunning();

    await w.find('[data-testid="s2v-cancel-trigger"]').trigger("click");
    await vi.waitFor(() => expect(mocks.pipelineCancel).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(w.vm.pipelineRunStatus).toBeNull());
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineProgressModalOpen).toBe(false);
    w.unmount();
  });

  it("右上关闭在重复触发时只执行一次后台脱离和历史刷新", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    const w = await mountRunning();
    const loadHistorySpy = vi.spyOn(w.vm, "loadHistory").mockResolvedValue();
    const first = w.vm.detachPipelineToBackground();
    const second = w.vm.detachPipelineToBackground();
    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(loadHistorySpy).toHaveBeenCalledTimes(1);
    expect(mocks.pipelineCancel).not.toHaveBeenCalled();
    w.unmount();
  });

  it("人工检查点不显示后台运行按钮，关闭按钮也不能脱离任务", async () => {
    const w = await mountRunning();
    w.vm.sceneAssetSelectionActive = true;
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'paused',
      checkpoint: { type: 'scene_asset_selection' },
    };
    await nextTick();
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(false);
    expect(w.find('[data-testid="ui-modal-close"]').element.disabled).toBe(true);
    const detachResult = await w.vm.detachPipelineToBackground();
    expect(detachResult).toBe(false);
    expect(w.vm.orchestrationRunId).toBe('run-bg-1');
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    expect(w.find('[data-testid="pipeline-progress-manual-hint"]').text()).toContain('操作');
    w.unmount();
  });

  it("waiting_approval 人工检查点不允许静默后台化", async () => {
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'waiting_approval',
      checkpoint: null,
    };
    await nextTick();
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(false);
    expect(w.find('[data-testid="ui-modal-close"]').element.disabled).toBe(true);
    expect(await w.vm.detachPipelineToBackground()).toBe(false);
    expect(w.vm.orchestrationRunId).toBe('run-bg-1');
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    expect(w.find('[data-testid="pipeline-progress-manual-hint"]').text()).not.toContain('旧版人工检查点');
    w.unmount();
  });

  it("needs_user_input 非内容政策人工检查点不允许静默后台化", async () => {
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'needs_user_input',
      checkpoint: { type: 'needs_user_input', reason: 'other' },
    };
    await nextTick();
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(false);
    expect(w.find('[data-testid="ui-modal-close"]').element.disabled).toBe(true);
    expect(await w.vm.detachPipelineToBackground()).toBe(false);
    expect(w.vm.orchestrationRunId).toBe('run-bg-1');
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    expect(w.find('[data-testid="pipeline-progress-manual-hint"]').text()).not.toContain('旧版人工检查点');
    w.unmount();
  });

  it("内容政策检查点：底部操作条显示「编辑场景」按钮，关闭按钮可点击", async () => {
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'paused',
      checkpoint: {
        type: 'needs_user_input',
        reason: 'content_policy',
        sceneIndex: 66,
        sceneNumber: 67,
        scenes: [{ sceneIndex: 66, sceneNumber: 67 }, { sceneIndex: 68, sceneNumber: 69 }],
      },
      projectId: 'proj-cp-1',
    };
    await nextTick();

    expect(w.vm.isContentPolicyCheckpoint).toBe(true);
    expect(w.vm.contentPolicySceneNumbers).toEqual([67, 69]);
    expect(w.vm.contentPolicyProjectId).toBe('proj-cp-1');
    expect(w.find('[data-testid="s2v-edit-scenes-trigger"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(false);
    // 内容政策检查点关闭按钮可点击（不 disabled）
    expect(w.find('[data-testid="ui-modal-close"]').element.disabled).toBe(false);
    expect(w.vm.pipelineProgressCloseDisabled).toBe(false);
    w.unmount();
  });

  it("内容政策检查点：点击关闭按钮 = 取消任务并关闭弹窗（非后台化）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    mocks.pipelineCancel.mockResolvedValue({ code: 0, data: true });
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'paused',
      checkpoint: { type: 'needs_user_input', reason: 'content_policy', sceneIndex: 0, sceneNumber: 1 },
    };
    await nextTick();

    await w.find('[data-testid="ui-modal-close"]').trigger('click');
    await vi.waitFor(() => expect(mocks.pipelineCancel).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(w.vm.pipelineRunStatus).toBeNull());
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineProgressModalOpen).toBe(false);
    w.unmount();
  });

  it("内容政策「编辑场景」：取消任务后跳转结果页并携带 focusScenes", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    mocks.pipelineCancel.mockResolvedValue({ code: 0, data: true });
    const pushSpy = vi.spyOn(router, 'push').mockResolvedValue();
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'paused',
      checkpoint: {
        type: 'needs_user_input',
        reason: 'content_policy',
        sceneIndex: 66,
        sceneNumber: 67,
        scenes: [{ sceneIndex: 66, sceneNumber: 67 }],
      },
      projectId: 'proj-cp-1',
    };
    await nextTick();

    await w.find('[data-testid="s2v-edit-scenes-trigger"]').trigger('click');
    await vi.waitFor(() => expect(mocks.pipelineCancel).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledWith({
      path: '/create/result',
      query: { project: 'proj-cp-1', focusScenes: '67' },
    }));
    expect(w.vm.orchestrationRunId).toBeNull();
    pushSpy.mockRestore();
    w.unmount();
  });

  it("内容政策「编辑场景」：缺少可编辑项目时不跳转，仅提示到历史记录", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    mocks.pipelineCancel.mockResolvedValue({ code: 0, data: true });
    const pushSpy = vi.spyOn(router, 'push').mockResolvedValue();
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'paused',
      checkpoint: { type: 'needs_user_input', reason: 'content_policy', sceneIndex: 0, sceneNumber: 1 },
      projectId: '',
    };
    await nextTick();

    await w.find('[data-testid="s2v-edit-scenes-trigger"]').trigger('click');
    await vi.waitFor(() => expect(mocks.pipelineCancel).toHaveBeenCalledTimes(1));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(w.vm.s2vOptionsToast).toContain('历史记录');
    pushSpy.mockRestore();
    w.unmount();
  });

  it("内容政策「编辑场景」取消失败：保留运行态并显示错误，不跳转", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    mocks.pipelineCancel.mockResolvedValue({ code: -1, message: 'cancel failed' });
    const pushSpy = vi.spyOn(router, 'push').mockResolvedValue();
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: 'paused',
      checkpoint: { type: 'needs_user_input', reason: 'content_policy', sceneIndex: 0, sceneNumber: 1 },
      projectId: 'proj-cp-1',
    };
    await nextTick();

    await w.find('[data-testid="s2v-edit-scenes-trigger"]').trigger('click');
    await vi.waitFor(() => expect(mocks.pipelineCancel).toHaveBeenCalledTimes(1));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(w.vm.orchestrationRunId).toBe('run-bg-1');
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    pushSpy.mockRestore();
    w.unmount();
  });

  it("普通手动暂停没有人工 checkpoint 时仍可后台化", async () => {
    const w = await mountRunning();
    w.vm.orchestrationRunId = null;
    w.vm.pipelineRunId = "ordinary-run-1";
    w.vm.selectedPipeline = { name: "custom-render", available: true, stages: ["render"] };
    w.vm.pipelineRunStatus = { status: "paused", stages: [{ name: "render", status: "paused" }] };
    await nextTick();

    expect(w.vm.isPipelineManualCheckpoint()).toBe(false);
    expect(w.vm.canDetachPipelineToBackground).toBe(true);
    w.unmount();
  });

  it.each([
    { name: "finalize_assets", status: "paused" },
    { name: "generate_assets", status: "paused", requiresCheckpoint: true },
  ])("旧快照的人工暂停阶段 $name 不允许后台化", async (stage) => {
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: "paused",
      checkpoint: null,
      stages: [stage],
    };
    await nextTick();

    expect(w.vm.isPipelineManualCheckpoint()).toBe(true);
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(false);
    expect(w.find('[data-testid="ui-modal-close"]').element.disabled).toBe(true);
    w.unmount();
  });

  it("旧版暂停快照带候选素材时只显示人工检查点提示，不渲染虚假提交面板", async () => {
    const w = await mountRunning();
    w.vm.pipelineRunStatus = {
      ...w.vm.pipelineRunStatus,
      status: "paused",
      checkpoint: null,
      context: { generate_assets: { candidates: [{ index: 0, candidates: [{ id: "legacy-a1" }] }] } },
      stages: [{ name: "generate_assets", status: "paused" }],
    };
    w.vm.orchestrationContext = w.vm.pipelineRunStatus.context;
    await nextTick();

    expect(w.vm.isPipelineManualCheckpoint()).toBe(true);
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(false);
    expect(w.find('[data-testid="ui-modal-close"]').element.disabled).toBe(true);
    expect(w.find('[data-testid="s2v-selection-banner"]').exists()).toBe(false);
    expect(w.find('[data-testid="s2v-scene-asset-panel"]').exists()).toBe(false);
    expect(w.find('[data-testid="pipeline-progress-manual-hint"]').text()).toContain("旧版人工检查点");
    expect(w.find('[data-testid="s2v-cancel-trigger"]').exists()).toBe(true);
    w.unmount();
  });

  it("没有稳定 runId 的普通流水线不显示后台运行按钮", async () => {
    const w = await mountRunning();
    w.vm.orchestrationRunId = null;
    w.vm.pipelineRunId = null;
    w.vm.selectedPipeline = { name: "custom-render", available: true, stages: ["render"] };
    w.vm.pipelineRunStatus = { status: "running", stages: [{ name: "render", status: "running" }] };
    await nextTick();

    expect(w.vm.canDetachPipelineToBackground).toBe(false);
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(false);
    w.unmount();
  });

  it("普通流水线返回稳定 runId 时使用统一进度弹窗但不伪造编排控制", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStart.mockResolvedValue({ code: 0, data: { runId: "ordinary-run-2" } });
    const w = await mountRunning();
    mocks.pipelineStart.mockResolvedValue({ code: 0, data: { runId: "ordinary-run-2" } });
    mocks.pipelineStatus.mockResolvedValue({
      code: 0,
      data: { id: "ordinary-run-2", status: "running", progress: 42, stages: [{ name: "render", status: "running" }] },
    });
    w.vm.selectedPipeline = { name: "custom-render", available: true, stages: ["render"] };
    w.vm.orchestrationRunId = null;
    w.vm.pipelineRunStatus = null;
    w.vm.pipelineRunId = null;
    await w.vm.startPipeline();
    await nextTick();

    expect(w.vm.pipelineRunId).toBe("ordinary-run-2");
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    expect(w.find('[data-testid="story2video-stage-list"]').exists()).toBe(true);
    expect(w.find('[data-testid="pipeline-progress-basic"]').exists()).toBe(false);
    expect(w.find('[data-testid="s2v-pause-trigger"]').exists()).toBe(false);
    expect(w.find('[data-testid="s2v-background-trigger"]').exists()).toBe(true);
    w.unmount();
  });

  it("普通流水线启动响应没有稳定 runId 时不按名称猜测状态，并恢复新建态", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStart.mockResolvedValue({ code: 0, data: {} });
    mocks.pipelineStatus.mockClear();
    const w = await mountRunning();
    w.vm.selectedPipeline = { name: "custom-render", available: true, stages: ["render"] };
    w.vm.pipelineRunStatus = null;
    w.vm.pipelineRunId = null;

    await w.vm.startPipeline();
    await nextTick();

    expect(mocks.pipelineStatus).not.toHaveBeenCalled();
    expect(w.vm.selectedPipeline).toBeNull();
    expect(w.vm.pipelineRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.view).toBe("pipelines");
    expect(w.vm.s2vOptionsToast).toContain("后台运行");
    w.unmount();
  });

  it("普通流水线首次状态拉取失败时仍建立轮询，后续 tick 可恢复进度弹窗（C1 回归）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStart.mockResolvedValue({ code: 0, data: { runId: "ordinary-run-retry" } });
    const success = { code: 0, data: { id: "ordinary-run-retry", status: "running", progress: 18, stages: [{ name: "render", status: "running" }] } };
    mocks.pipelineStatus
      .mockResolvedValueOnce({ code: 1, message: "temporary" })
      .mockResolvedValueOnce(success);
    const w = await mountRunning();
    w.vm.selectedPipeline = { name: "custom-render", available: true, stages: ["render"] };
    w.vm.pipelineRunStatus = null;
    w.vm.pipelineRunId = null;
    w.vm.orchestrationRunId = null;
    w.vm.pipelineProgressModalOpen = false;

    await w.vm.startPipeline();
    await nextTick();
    expect(w.vm.pipelineRunId).toBe("ordinary-run-retry");
    expect(w.vm.pollTimer).not.toBeNull();
    expect(w.vm.pipelineProgressModalOpen).toBe(false);
    await w.vm.updatePipelineStatus();
    await nextTick();
    expect(w.vm.pipelineRunStatus?.status).toBe("running");
    expect(w.vm.pipelineProgressModalOpen).toBe(true);
    w.unmount();
  });

  it("终态推送没有携带新 context 时不使用旧缓存收尾，而是拉取全量状态（W2 回归）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: {
        runId: "run-bg-1",
        status: { status: "completed" },
        stages: [{ name: "publish", status: "completed" }],
        context: { compose: { data: { videoPath: "C:/tmp/final.mp4" } } },
      },
    });
    const w = await mountRunning();
    w.vm.orchestrationRunId = "run-bg-1";
    w.vm.orchestrationContextRunId = "run-bg-1";
    w.vm.orchestrationContext = { split: { scenes: [] } };
    mocks.pipelineGetRunContext.mockClear();
    w.vm.handlePipelinePush({
      runId: "run-bg-1",
      status: { status: "completed" },
      stages: [{ name: "publish", status: "completed" }],
    });
    await nextTick();
    await vi.waitFor(() => expect(mocks.pipelineGetRunContext).toHaveBeenCalledWith("run-bg-1"));
    w.unmount();
  });

  it("普通流水线启动请求的旧响应不能覆盖切换后的新流水线", async () => {
    const mocks = await import("@/api/publisher");
    let resolveStart;
    mocks.pipelineStart.mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
    mocks.pipelineStatus.mockClear();
    const w = await mountRunning();
    w.vm.selectedPipeline = { name: "custom-render-a", available: true, stages: ["render"] };

    const startPromise = w.vm.startPipeline();
    await nextTick();
    w.vm.selectPipeline({ name: "custom-render-b", available: true, stages: ["render"] });
    resolveStart({ code: 0, data: { runId: "stale-ordinary-run" } });
    await startPromise;
    await nextTick();

    expect(w.vm.selectedPipeline?.name).toBe("custom-render-b");
    expect(w.vm.pipelineRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(mocks.pipelineStatus).not.toHaveBeenCalled();
    w.unmount();
  });

  it.each([
    { label: "缺少 runId", data: { status: "running", progress: 55, stages: [{ name: "render", status: "running" }] } },
    { label: "runId 错配", data: { id: "another-run", status: "running", progress: 55, stages: [{ name: "render", status: "running" }] } },
  ])("普通流水线状态响应$label时不写回状态", async ({ data }) => {
    const mocks = await import("@/api/publisher");
    const w = await mountRunning();
    w.vm.orchestrationRunId = null;
    w.vm.selectedPipeline = { name: "custom-render", available: true, stages: ["render"] };
    w.vm.pipelineRunId = "ordinary-run-status";
    w.vm.pipelineRunStatus = { status: "running", progress: 12, stages: [{ name: "render", status: "running" }] };
    const before = w.vm.pipelineRunStatus;
    mocks.pipelineStatus.mockResolvedValueOnce({ code: 0, data });

    const result = await w.vm.updatePipelineStatus();

    expect(result).toMatchObject({ ok: false, reason: "run-id-mismatch" });
    expect(w.vm.pipelineRunStatus).toBe(before);
    expect(w.vm.pipelineRunStatus.progress).toBe(12);
    expect(w.vm.pipelineProgressStatusError).toContain("进度");
    w.unmount();
  });

  it("无效 runId 不会清理当前运行态", async () => {
    const w = await mountRunning();
    const before = { runId: w.vm.orchestrationRunId, status: w.vm.pipelineRunStatus };
    const result = await w.vm.startOrchestrationForeground("  ");
    expect(result).toBe(false);
    expect(w.vm.orchestrationRunId).toBe(before.runId);
    expect(w.vm.pipelineRunStatus).toBe(before.status);
    w.unmount();
  });

  it("启动前台跟踪：不调用 pipelineCancel，保留 runId、展示进度并轮询，toast 提示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    const w = await mountRunning();
    expect(w.find('[data-testid="start-story2video"]').exists()).toBe(false);
    await w.vm.startOrchestrationForeground("run-bg-1", "story2video-compose");
    await nextTick();
    expect(mocks.pipelineCancel).not.toHaveBeenCalled();
    // 前台跟踪：保留 runId 并展示可见进度，同时启动 3s 轮询（离开页面后才转后台）
    expect(w.vm.orchestrationRunId).toBe("run-bg-1");
    expect(w.vm.pipelineRunStatus).not.toBeNull();
    expect(w.vm.pollTimer).not.toBeNull();
    expect(w.vm.s2vOptionsToast).toContain("实时展示进度");
    expect(w.find('[data-testid="start-story2video"]').exists()).toBe(false);
    w.unmount();
  });

  it("启动 IPC 返回前切换 tab 时丢弃旧响应，不重挂 run", async () => {
    const mocks = await import("@/api/publisher");
    let resolveStart;
    mocks.pipelineStartOrchestrated.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));
    mocks.pipelineCancel.mockClear();
    const w = await mountRunning();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    w.vm.orchestrationRunId = null;
    w.vm.pipelineText = "deferred start";

    const startPromise = w.vm.startPipeline();
    await nextTick();
    expect(w.vm.startingPipeline).toBe(true);

    await w.vm.switchView("history");
    expect(w.vm.view).toBe("history");
    expect(w.vm.selectedPipeline).toBeNull();

    resolveStart({ code: 0, data: { runId: "run-stale-after-tab-switch" } });
    await startPromise;
    await nextTick();

    expect(w.vm.view).toBe("history");
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pollTimer).toBeNull();
    expect(mocks.pipelineCancel).not.toHaveBeenCalled();
    w.unmount();
  });

  it("启动新 run 时清空上一条 run 的展示态，不清理主进程任务", async () => {
    const w = await mountRunning();
    w.vm.needsCheckpoint = true;
    w.vm.providerWarnings = [{ providerId: "old-provider" }];
    w.vm.dismissedProviderWarnings = true;
    w.vm.story2videoRunMeta = { activeMs: 9000 };
    w.vm.sceneAssetSelectionActive = true;
    w.vm.sceneAssetCandidates = [{ sceneId: "old-scene" }];
    w.vm.dismissedBgmSkippedNotice = true;
    await w.vm.startOrchestrationForeground("run-bg-2", "story2video-compose");
    expect(w.vm.orchestrationRunId).toBe("run-bg-2");
    expect(w.vm.needsCheckpoint).toBe(false);
    expect(w.vm.providerWarnings).toEqual([]);
    expect(w.vm.dismissedProviderWarnings).toBe(false);
    expect(w.vm.story2videoRunMeta).not.toBeNull();
    expect(w.vm.story2videoRunMeta.activeMs).toBeNull();
    expect(w.vm.sceneAssetSelectionActive).toBe(false);
    expect(w.vm.sceneAssetCandidates).toEqual([]);
    expect(w.vm.dismissedBgmSkippedNotice).toBe(false);
    w.unmount();
  });

  it("runId 快照守卫：切换 run 后在飞的旧响应不写回状态", async () => {
    const mocks = await import("@/api/publisher");
    let resolveStatus;
    mocks.pipelineGetRunContext.mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));
    const w = await mountRunning();
    const pollPromise = w.vm.updateOrchestrationStatus();
    await nextTick();
    // 模拟用户重新启动/切换到另一条 run：runId 快照变化后，旧响应必须被丢弃
    w.vm.orchestrationRunId = "run-bg-2";
    w.vm.orchestrationContext = { split: { scenes: [{}, {}] } };
    resolveStatus({ code: 0, data: { status: { status: "running" }, stages: [{ name: "optimize", status: "running" }], context: { split: { scenes: [{}] } }, checkpoint: null } });
    await pollPromise;
    await nextTick();
    expect(w.vm.orchestrationRunId).toBe("run-bg-2");
    expect(w.vm.orchestrationContext).toEqual({ split: { scenes: [{}, {}] } });
    w.unmount();
  });

  it("后台化期间在飞的状态响应不能恢复旧弹窗或跳转结果页", async () => {
    const mocks = await import("@/api/publisher");
    let resolveStatus;
    mocks.pipelineGetRunContext.mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue();
    const w = await mountRunning();

    const statusPromise = w.vm.updateOrchestrationStatus();
    await nextTick();
    expect(mocks.pipelineGetRunContext).toHaveBeenCalledWith('run-bg-1');

    await w.vm.detachPipelineToBackground();
    resolveStatus({
      code: 0,
      data: {
        status: { status: 'completed' },
        context: { compose: { data: { videoPath: 'C:/tmp/stale.mp4' } } },
      },
    });
    await statusPromise;
    await nextTick();

    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.pipelineProgressModalOpen).toBe(false);
    expect(pushSpy).not.toHaveBeenCalledWith(expect.objectContaining({ path: '/create/result' }));
    pushSpy.mockRestore();
    w.unmount();
  });

  it("后台化期间在飞的暂停响应不能回写新建态或显示旧错误", async () => {
    const mocks = await import("@/api/publisher");
    let resolvePause;
    mocks.pipelinePauseRun.mockReturnValue(new Promise((resolve) => { resolvePause = resolve; }));
    const w = await mountRunning();

    const pausePromise = w.vm.pauseOrchestrationPipeline();
    await nextTick();
    expect(mocks.pipelinePauseRun).toHaveBeenCalledWith('run-bg-1');
    await w.vm.detachPipelineToBackground();
    resolvePause({ code: 1, message: 'stale pause failure' });
    await pausePromise;
    await nextTick();

    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.pauseActionBusy).toBe(false);
    expect(w.vm.story2videoErrorDialog.visible).toBe(false);
    w.unmount();
  });

  it("后台 run 完成后自动跳转结果页（恢复「完成即跳转」）", async () => {
    const mocks = await import("@/api/publisher");
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue();
    const w = await mountRunning();
    await w.vm.startOrchestrationForeground("run-bg-1", "story2video-compose");
    // mountRunning 已把 pipelineGetRunContext mock 为 running，这里覆盖为终态完成
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: {
        status: { status: "completed" },
        context: { compose: { data: { videoPath: "C:/tmp/bg.mp4" } } },
        activeMs: 2500,
      },
    });
    await w.vm.updateOrchestrationStatus();
    expect(w.vm.orchestrationRunId).toBeNull();
    const pushCall = [...pushSpy.mock.calls].reverse().find((args) => args[0] && args[0].path === "/create/result");
    expect(pushCall).toBeTruthy();
    expect(pushCall[0].query.path).toBe("C:/tmp/bg.mp4");
    expect(pushCall[0].query.durationMs).toBe(2500);
    pushSpy.mockRestore();
    w.unmount();
  });

  it("组件卸载后终态响应不触发结果页跳转（unmount 守卫）", async () => {
    const mocks = await import("@/api/publisher");
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue();
    const w = await mountRunning();
    w.vm._s2vAlive = false;
    mocks.pipelineGetRunContext.mockResolvedValue({
      code: 0,
      data: { status: { status: "completed" }, context: { compose: { data: { videoPath: "C:/tmp/x.mp4" } } }, activeMs: 100 },
    });
    await w.vm.updateOrchestrationStatus();
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
    w.unmount();
  });

  it("离开页面后停止轮询且保留 runId（任务转后台，仅历史可见）", async () => {
    const w = await mountRunning();
    w.vm.pollTimer = setInterval(() => {}, 3000);
    w.unmount();
    expect(w.vm.pollTimer).toBeNull();
    expect(w.vm.orchestrationRunId).toBe("run-bg-1");
    expect(w.vm._s2vAlive).toBe(false);
  });

  it("重新进入创作页为全新新建初始态（不重挂任何 run）", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
    });
    await nextTick();
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    w.unmount();
  });

  it("取消流水线仍调用 pipelineCancel（resetPipelineUiState 抽取后回归）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineCancel.mockClear();
    mocks.pipelineCancel.mockResolvedValue({ code: 0, data: true });
    const w = await mountRunning();
    w.vm.sceneAssetSelectionActive = false;
    await nextTick();
    await w.vm.cancelPipeline();
    await nextTick();
    expect(mocks.pipelineCancel).toHaveBeenCalled();
    expect(w.vm.orchestrationRunId).toBeNull();
    expect(w.vm.pipelineRunStatus).toBeNull();
    w.unmount();
  });
});

describe("pipeline:update 实时推送（openspec pipeline-progress-real-time-push）", () => {
  it("脱离流水线视图后忽略没有当前 run 的推送事件", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.view = "history";
    w.vm.orchestrationRunId = null;
    w.vm.pipelineRunStatus = null;
    w.vm.orchestrationStages = [];

    w.vm.handlePipelinePush({
      runId: "run-detached",
      status: { status: "running", progress: 42 },
      stages: [{ name: "compose", status: "running" }],
    });
    await nextTick();

    expect(w.vm.pipelineRunStatus).toBeNull();
    expect(w.vm.orchestrationStages).toEqual([]);
    w.unmount();
  });

  it("handlePipelinePush 更新阶段进度/run 级 progress 且忽略非当前 run", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 100));
    await nextTick();
    w.vm.orchestrationRunId = "run-1";
    w.vm.orchestrationStages = [{ name: "publish", status: "pending" }];
    w.vm.pipelineRunStatus = { status: "running", progress: 30, stages: [{ name: "publish", status: "pending" }] };
    w.vm.handlePipelinePush({
      runId: "run-1",
      status: { status: "running", currentStage: 0, progress: 66 },
      stages: [{ name: "publish", status: "running", progress: { percent: 50, message: "正在发布到 weibo (2/4)" } }],
      progressOnly: true,
    });
    await nextTick();
    expect(w.vm.orchestrationStages[0].status).toBe("running");
    expect(w.vm.orchestrationStages[0].progress.message).toContain("正在发布到 weibo");
    expect(w.vm.pipelineRunStatus.progress).toBe(66);
    // 非当前 run 事件忽略，不覆盖
    w.vm.handlePipelinePush({ runId: "other-run", status: { status: "completed", progress: 100 }, stages: [] });
    expect(w.vm.pipelineRunStatus.progress).toBe(66);
    w.unmount();
  });

  it("收到事件后重置轮询计时（restartOrchestrationPolling 被调用）", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 100));
    await nextTick();
    w.vm.orchestrationRunId = "run-1";
    const spy = vi.spyOn(w.vm, "restartOrchestrationPolling");
    w.vm.handlePipelinePush({ runId: "run-1", status: { status: "running", progress: 10 }, stages: [] });
    expect(spy).toHaveBeenCalled();
    w.unmount();
  });

  it("检测到内容安全改写重试时触发一次底部 toast（2026-08-30 复盘 mtequszp_enqn）", async () => {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 100));
    await nextTick();
    w.vm.orchestrationRunId = "run-1";
    w.vm.orchestrationStages = [{ name: "generate_assets", status: "running" }];
    w.vm.pipelineRunStatus = { status: "running", progress: 50, stages: [{ name: "generate_assets", status: "running" }] };
    w.vm.s2vContentRewriteToastShown = false;

    const rewritingStage = { name: "generate_assets", status: "running", progress: { percent: 50, messageKey: "stageProgress.assetsImageRewriting", messageParams: { images: 69, imagesTotal: 70 } } };
    w.vm.handlePipelinePush({ runId: "run-1", status: { status: "running", currentStage: 4, progress: 50 }, stages: [rewritingStage], progressOnly: true });
    await nextTick();
    expect(w.vm.s2vOptionsToast).toContain("检测到敏感内容");
    expect(w.vm.s2vContentRewriteToastShown).toBe(true);

    // 再次收到改写事件不重复弹 toast
    w.vm.s2vOptionsToast = "";
    w.vm.handlePipelinePush({ runId: "run-1", status: { status: "running", currentStage: 4, progress: 55 }, stages: [rewritingStage], progressOnly: true });
    await nextTick();
    expect(w.vm.s2vOptionsToast).toBe("");
    w.unmount();
  });

  it("cleanups 注册 onPipelineUpdate 订阅（卸载时清理）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.onPipelineUpdate.mockClear();
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await new Promise(r => setTimeout(r, 100));
    await nextTick();
    expect(mocks.onPipelineUpdate).toHaveBeenCalled();
    expect(w.vm.cleanups.length).toBeGreaterThan(0);
    w.unmount();
  });
});

describe("批量创作（story2video-batch-create）", () => {
  const mountS2V = async () => {
    // UiModal 内容经 Teleport 到 body：stub teleport 使弹窗内容留在组件树内可查询
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress }, stubs: { teleport: true } }
    });
    await new Promise(r => setTimeout(r, 50));
    await nextTick();
    w.vm.selectedPipeline = { name: "story2video-compose", available: true, stages: [] };
    await nextTick();
    return w;
  };

  it("批量创作按钮仅在 story2video-compose 流水线显示", async () => {
    const w = await mountS2V();
    expect(w.find('[data-testid="s2v-batch-trigger"]').exists()).toBe(true);
    w.vm.selectedPipeline = { name: "animated-explainer", available: true, stages: [] };
    await nextTick();
    expect(w.find('[data-testid="s2v-batch-trigger"]').exists()).toBe(false);
    w.unmount();
  });

  it("打开批量弹窗：显示规则提示、视频增强下拉与两个标签页", async () => {
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    expect(w.vm.s2vBatchDialogOpen).toBe(true);
    expect(w.find('[data-testid="s2v-batch-dialog"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-batch-rule-hint"]').text()).toContain("最大并行");
    expect(w.find('[data-testid="s2v-batch-video-mode"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-batch-tab-text"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-batch-tab-files"]').exists()).toBe(true);
    // 默认输入文案 tab；无批量任务时显示空态
    expect(w.find('[data-testid="s2v-batch-text-pane"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-batch-status-empty"]').exists()).toBe(true);
    w.unmount();
  });

  it("输入文案：+ 新增最多 10 条，可删除单条", async () => {
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    expect(w.vm.s2vBatchTexts.length).toBe(1);
    for (let i = 0; i < 9; i++) {
      await w.find('[data-testid="s2v-batch-add-text"]').trigger("click");
    }
    await nextTick();
    expect(w.vm.s2vBatchTexts.length).toBe(10);
    expect(w.find('[data-testid="s2v-batch-add-text"]').attributes("disabled")).toBeDefined();
    await w.find('[data-testid="s2v-batch-text-remove-0"]').trigger("click");
    await nextTick();
    expect(w.vm.s2vBatchTexts.length).toBe(9);
    w.unmount();
  });

  it("本地文件：选择文件合并去重，最多 20 个提示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoPickBatchFiles.mockResolvedValueOnce({
      code: 0,
      data: { files: [{ path: "C:/a.txt", name: "a.txt" }, { path: "C:/b.md", name: "b.md" }] },
    });
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    await w.find('[data-testid="s2v-batch-tab-files"]').trigger("click");
    await nextTick();
    await w.find('[data-testid="s2v-batch-pick-files"]').trigger("click");
    await nextTick();
    expect(w.vm.s2vBatchFiles.map(f => f.name)).toEqual(["a.txt", "b.md"]);
    // 重复选择去重
    await w.find('[data-testid="s2v-batch-pick-files"]').trigger("click");
    await nextTick();
    expect(w.vm.s2vBatchFiles.length).toBe(2);
    // 超 20 个：只保留前 20，并提示
    mocks.story2videoPickBatchFiles.mockResolvedValueOnce({
      code: 0,
      data: { files: Array.from({ length: 25 }, (_, i) => ({ path: "C:/f" + i + ".txt", name: "f" + i + ".txt" })) },
    });
    await w.find('[data-testid="s2v-batch-pick-files"]').trigger("click");
    await nextTick();
    expect(w.vm.s2vBatchFiles.length).toBe(20);
    expect(w.vm.s2vBatchError).toContain("最多选择 20 个文件");
    w.unmount();
  });

  it("启动（文案模式）：调用 story2videoBatchCreate 并传全自动模板与弹窗视频模式", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBatchCreate.mockClear();
    mocks.story2videoBatchCreate.mockResolvedValueOnce({ code: 0, data: { batchId: "batch_x", items: [] } });
    // 打开弹窗的首次轮询也会消费 status mock：持久化返回（含运行中批次）
    mocks.story2videoBatchStatus.mockResolvedValue({
      code: 0,
      data: [{ id: "batch_x", mode: "text", createdAt: "2026-08-15T00:00:00.000Z", summary: { total: 1, pending: 0, running: 1, completed: 0, failed: 0, cancelled: 0 }, items: [{ itemId: "batch_x_i0", source: "text", label: "文案 1", status: "running", runId: "run_1", error: null, progress: 42, currentStage: "generate_assets" }] }],
    });
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    await w.find('[data-testid="s2v-batch-text-0"]').setValue("第一条文案");
    await w.find('[data-testid="s2v-batch-add-text"]').trigger("click");
    await nextTick();
    await w.find('[data-testid="s2v-batch-text-1"]').setValue("第二条文案");
    await w.find('[data-testid="s2v-batch-video-mode"]').setValue("fixed");
    await nextTick();
    await w.find('[data-testid="s2v-batch-start"]').trigger("click");
    await nextTick();
    expect(mocks.story2videoBatchCreate).toHaveBeenCalledTimes(1);
    const payload = mocks.story2videoBatchCreate.mock.calls[0][0];
    expect(payload.mode).toBe("text");
    expect(payload.texts).toEqual(["第一条文案", "第二条文案"]);
    expect(payload.story2videoTextConfigTemplate).toBeDefined();
    expect(payload.story2videoTextConfigTemplate.creation).toEqual({ mode: "auto", materialMode: "all-images" });
    expect(payload.story2videoTextConfigTemplate.video.mode).toBe("fixed");
    expect(payload.story2videoTextConfigTemplate.prompt).toBeUndefined();
    // 成功后清空输入并展示队列（运行中状态徽标 + 进度）
    expect(w.vm.s2vBatchTexts).toEqual([""]);
    await nextTick();
    const runningRow = w.find('[data-testid="s2v-batch-item-batch_x_i0"]');
    expect(runningRow.text()).toContain("运行中");
    expect(runningRow.text()).toContain("42%");
    w.unmount();
  });

  it("启动（空文案）：本地校验拦截，不调用 API", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBatchCreate.mockClear();
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    await w.find('[data-testid="s2v-batch-start"]').trigger("click");
    await nextTick();
    expect(mocks.story2videoBatchCreate).not.toHaveBeenCalled();
    expect(w.find('[data-testid="s2v-batch-error"]').text()).toContain("至少输入 1 条文案");
    w.unmount();
  });

  it("启动失败：透传 IPC message 与 failedItems 标签", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBatchCreate.mockClear();
    mocks.story2videoBatchCreate.mockResolvedValueOnce({
      code: -2,
      message: "批量创作输入校验失败：文案 1",
      failedItems: [{ label: "文案 1", index: 0, errorCode: "BATCH_TEXT_TOO_LONG" }],
    });
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    await w.find('[data-testid="s2v-batch-text-0"]').setValue("超长文案");
    await w.find('[data-testid="s2v-batch-start"]').trigger("click");
    await nextTick();
    expect(w.find('[data-testid="s2v-batch-error"]').text()).toContain("文案 1");
    w.unmount();
  });

  it("取消排队项：调用 story2videoBatchCancel 并刷新队列", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoBatchCancel.mockClear();
    mocks.story2videoBatchStatus.mockResolvedValue({
      code: 0,
      data: [{ id: "batch_y", mode: "text", createdAt: "2026-08-15T00:00:00.000Z", summary: { total: 2, pending: 1, running: 1, completed: 0, failed: 0, cancelled: 0 }, items: [
        { itemId: "batch_y_i0", source: "text", label: "文案 1", status: "running", runId: "run_1", error: null, progress: 10, currentStage: null },
        { itemId: "batch_y_i1", source: "text", label: "文案 2", status: "pending", runId: null, error: null, progress: null, currentStage: null },
      ] }],
    });
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    // 仅 pending 项显示取消按钮；running 项不显示
    const cancelButtons = w.findAll('[data-testid="s2v-batch-item-cancel"]');
    expect(cancelButtons.length).toBe(1);
    expect(w.find('[data-testid="s2v-batch-item-batch_y_i0"]').find('[data-testid="s2v-batch-item-cancel"]').exists()).toBe(false);
    await cancelButtons[0].trigger("click");
    await nextTick();
    expect(mocks.story2videoBatchCancel).toHaveBeenCalledWith("batch_y", ["batch_y_i1"]);
    w.unmount();
  });

  it("openHistoryResult 政策失败携带 focusScenes，completed/可恢复失败不带", async () => {
    const pushSpy = vi.spyOn(router, "push");
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.openHistoryResult({
      projectId: "proj-policy", historyType: "story2video-project", status: "failed",
      error: "Image #49: content-policy review; Image #73: content-policy review; Image #74: content-policy review",
    });
    expect(pushSpy).toHaveBeenCalledWith({ path: "/create/result", query: { project: "proj-policy", focusScenes: "49,73,74" } });
    pushSpy.mockClear();
    w.vm.openHistoryResult({ projectId: "proj-done", historyType: "story2video-project", status: "completed", error: "" });
    expect(pushSpy).toHaveBeenCalledWith({ path: "/create/result", query: { project: "proj-done" } });
    pushSpy.mockClear();
    w.vm.openHistoryResult({ projectId: "proj-retry", historyType: "story2video-project", status: "failed", error: "provider timeout, please retry" });
    expect(pushSpy).toHaveBeenCalledWith({ path: "/create/result", query: { project: "proj-retry" } });
    pushSpy.mockClear();
    // completed 任务即使残留门控关键字文本也不携带 focusScenes（与 policyEditTarget 的 failed 前提对齐，审查 M4）
    w.vm.openHistoryResult({ projectId: "proj-done2", historyType: "story2video-project", status: "completed", error: "Image #3: content-policy review" });
    expect(pushSpy).toHaveBeenCalledWith({ path: "/create/result", query: { project: "proj-done2" } });
    pushSpy.mockClear();
    // 门控命中但无法提取 Image #N（如 manual 模式无场景号前缀）时不携带 focusScenes，结果页按缺省安全降级（W1）
    w.vm.openHistoryResult({ projectId: "proj-manual", historyType: "story2video-project", status: "failed", error: "Image generation requires user input after content-policy review" });
    expect(pushSpy).toHaveBeenCalledWith({ path: "/create/result", query: { project: "proj-manual" } });
    // run-only 记录（historyType=pipeline-run）即使带 projectId 也不跳转结果页，避免加载失败（2026-08-30 修复）
    pushSpy.mockClear();
    w.vm.openHistoryResult({ projectId: "run-only-cancelled", historyType: "pipeline-run", status: "cancelled", error: "cancelled" });
    expect(pushSpy).not.toHaveBeenCalled();
    w.unmount();
  });
});

describe("CreateView 流水线「保存配置」（s2v-pipeline-config-profiles）", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mocks = await import("@/api/publisher");
    mocks.story2videoConfigProfileList.mockReset();
    mocks.story2videoConfigProfileCreate.mockReset();
    mocks.story2videoConfigProfileRename.mockReset();
    mocks.story2videoConfigProfileDelete.mockReset();
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [] });
    mocks.story2videoConfigProfileCreate.mockResolvedValue({ code: -1, message: "electronAPI not available" });
    mocks.story2videoConfigProfileRename.mockResolvedValue({ code: -1, message: "electronAPI not available" });
    mocks.story2videoConfigProfileDelete.mockResolvedValue({ code: -1, message: "electronAPI not available" });
    mocks.storeSetSetting.mockReset();
    setActivePinia(createPinia());
    window.electronAPI = {};
    window.localStorage.clear();
    settingsDialogRevision.value = 0;
  });

  function makeProfile(overrides = {}) {
    return {
      id: "profile-00000000000001",
      pipelineId: "story2video-compose",
      name: "口播竖屏 1080p",
      updatedAt: "1700000000000",
      snapshot: {
        schemaVersion: 1,
        capturedAt: "2026-08-28T00:00:00.000Z",
        kind: "orchestrated",
        s2vConfig: {
          contentType: "general", imageStyle: "cinematic",
          imageProvider: "provider-a", imageModel: "m1",
          voiceProvider: "edge-tts", voiceModel: "", voiceId: "zh-CN-XiaoxiaoNeural",
          videoMode: "off",
        },
        s2vOutputConfig: { resolution: "720x1280", fps: 30, format: "mp4" },
        ui: { expandedGroups: ["appearance"] },
      },
      ...overrides,
    };
  }

  async function mountView() {
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    return w;
  }

  async function selectPipeline(w, name = "story2video-compose") {
    w.vm.selectPipeline({ name, available: true, stages: [] });
    await nextTick();
  }

  async function prepareProviders(w) {
    w.vm.s2vVoiceProviders = [{ id: "edge-tts" }, { id: "custom" }];
    w.vm.s2vImageProviders = [{ id: "provider-a" }];
    w.vm.s2vVideoProviders = [{ id: "provider-v" }];
    await nextTick();
  }

  it("编排流水线展示保存配置按钮，点击打开保存弹窗并预填流水线名", async () => {
    const mocks = await import("@/api/publisher");
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    expect(w.find('[data-testid="s2v-config-profile-save"]').exists()).toBe(true);
    expect(w.find('[data-testid="s2v-config-profile-manage"]').exists()).toBe(true);
    await w.find('[data-testid="s2v-config-profile-save"]').trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(w.find('[data-testid="s2v-config-profile-save-dialog"]').exists()).toBe(true);
    expect(w.vm.s2vConfigProfileNameDraft).toBe(w.vm.pipelineName("story2video-compose"));
    expect(mocks.story2videoConfigProfileList).toHaveBeenCalled();
    w.unmount();
  });

  it("保存弹窗空名校验：不调用创建 API 并 toast 提示", async () => {
    const mocks = await import("@/api/publisher");
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileSave();
    w.vm.s2vConfigProfileNameDraft = "   ";
    await w.vm.saveS2VConfigProfile();
    expect(mocks.story2videoConfigProfileCreate).not.toHaveBeenCalled();
    expect(w.vm.s2vOptionsToast).toContain("请输入配置名称");
    w.unmount();
  });

  it("同名配置首次点击提示覆盖，二次点击覆盖保存成功", async () => {
    const mocks = await import("@/api/publisher");
    const existing = makeProfile();
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [existing] });
    mocks.story2videoConfigProfileCreate.mockResolvedValue({ code: 0, data: { ...existing, updatedAt: "1701000000000" } });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileSave();
    w.vm.s2vConfigProfileNameDraft = existing.name;
    await w.vm.saveS2VConfigProfile();
    expect(w.vm.s2vConfigProfileOverwriteNeeded).toBe(true);
    expect(w.vm.s2vOptionsToast).toContain("覆盖");
    expect(mocks.story2videoConfigProfileCreate).not.toHaveBeenCalled();
    await w.vm.saveS2VConfigProfile();
    expect(mocks.story2videoConfigProfileCreate).toHaveBeenCalledWith(expect.objectContaining({
      pipelineId: "story2video-compose",
      name: existing.name,
      overwrite: true,
    }));
    expect(w.vm.s2vConfigProfiles).toHaveLength(1);
    expect(w.vm.s2vConfigProfileDialogOpen).toBe(false);
    expect(w.vm.s2vOptionsToast).toContain("配置已保存");
    w.unmount();
  });

  it("新增配置保存成功并写入列表", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [] });
    const created = makeProfile({ id: "profile-00000000000002", name: "新配置" });
    mocks.story2videoConfigProfileCreate.mockResolvedValue({ code: 0, data: created });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileSave();
    w.vm.s2vConfigProfileNameDraft = "新配置";
    await w.vm.saveS2VConfigProfile();
    expect(mocks.story2videoConfigProfileCreate).toHaveBeenCalledWith(expect.objectContaining({
      pipelineId: "story2video-compose",
      name: "新配置",
      snapshot: expect.objectContaining({ kind: "orchestrated", schemaVersion: 1 }),
      overwrite: false,
    }));
    expect(w.vm.s2vConfigProfiles[0].id).toBe("profile-00000000000002");
    w.unmount();
  });

  it("快照构建：orchestrated 分支包含 s2vConfig/s2vOutputConfig/ui", async () => {
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    const snapshot = w.vm.buildPipelineConfigSnapshot();
    expect(snapshot.kind).toBe("orchestrated");
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.s2vConfig).toBeDefined();
    expect(snapshot.s2vOutputConfig).toBeDefined();
    expect(snapshot.ui.expandedGroups).toEqual(expect.any(Array));
    w.unmount();
  });

  it("服务端返回同名配置时进入覆盖态，二次点击按覆盖保存", async () => {
    const mocks = await import("@/api/publisher");
    const saved = makeProfile({ name: "竞态同名配置" });
    mocks.story2videoConfigProfileCreate.mockResolvedValueOnce({ code: -2, message: "已存在同名配置" });
    mocks.story2videoConfigProfileCreate.mockResolvedValueOnce({ code: 0, data: saved });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileSave();
    w.vm.s2vConfigProfileNameDraft = "竞态同名配置";

    await w.vm.saveS2VConfigProfile();

    expect(w.vm.s2vConfigProfileOverwriteNeeded).toBe(true);
    expect(w.vm.s2vConfigProfileDialogOpen).toBe(true);
    await w.vm.saveS2VConfigProfile();
    expect(mocks.story2videoConfigProfileCreate).toHaveBeenLastCalledWith(expect.objectContaining({ overwrite: true }));
    expect(w.vm.s2vConfigProfileDialogOpen).toBe(false);
    w.unmount();
  });

  it("编排配置快照排除素材路径与发布字段，保留可配置选项", async () => {
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    Object.assign(w.vm.s2vConfig, {
      transition: "slide-left",
      bgmPath: "C:/private/music.mp3",
      coverUrl: "file:///C:/private/cover.png",
      platforms: ["douyin"],
      publishEnabled: true,
      title: "不应保存的标题",
      tagsText: "标签",
      publishContent: "不应保存的发布正文",
    });

    const snapshot = w.vm.buildPipelineConfigSnapshot();

    expect(snapshot.s2vConfig).toMatchObject({ transition: "slide-left" });
    for (const excludedField of ["bgmPath", "coverUrl", "platforms", "publishEnabled", "title", "tagsText", "publishContent"]) {
      expect(snapshot.s2vConfig).not.toHaveProperty(excludedField);
    }
    w.unmount();
  });

  it("管理弹窗加载非空列表，按更新时间倒序渲染跨流水线条目", async () => {
    const mocks = await import("@/api/publisher");
    mocks.story2videoConfigProfileList.mockResolvedValue({
      code: 0,
      data: [
        makeProfile({ id: "p1", name: "旧配置", updatedAt: "1700000000000" }),
        makeProfile({ id: "p2", name: "新配置", pipelineId: "cinematic", updatedAt: "1701000000000" }),
      ],
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileList();
    expect(w.vm.s2vConfigProfiles[0].id).toBe("p2");
    const items = w.findAll(".bgm-library-item");
    expect(items.length).toBe(2);
    expect(w.find('[data-testid="s2v-config-profile-list"]').text()).toContain("新配置");
    expect(w.find('[data-testid="s2v-config-profile-list"]').text()).toContain("旧配置");
    w.unmount();
  });

  it("应用配置（未修改表单）：直接覆盖字段并提示已应用", async () => {
    const profile = makeProfile({
      snapshot: {
        schemaVersion: 1,
        capturedAt: "2026-08-28T00:00:00.000Z",
        kind: "orchestrated",
        s2vConfig: {
          contentType: "general", imageStyle: "realistic",
          imageProvider: "provider-a", imageModel: "m1",
          voiceProvider: "edge-tts", voiceModel: "", voiceId: "zh-CN-XiaoxiaoNeural",
          videoMode: "off",
        },
        s2vOutputConfig: { resolution: "720x1280", fps: 30, format: "mp4" },
        ui: { expandedGroups: ["appearance"] },
      },
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await prepareProviders(w);
    await w.vm.requestApplyS2VConfigProfile(profile);
    expect(w.vm.s2vConfigProfileApplyDialogOpen).toBe(false);
    expect(w.vm.s2vConfig.imageStyle).toBe("realistic");
    expect(w.vm.s2vOutputConfig.resolution).toBe("720x1280");
    expect(w.vm.s2vOptionsToast).toContain("已应用配置");
    w.unmount();
  });

  it("应用配置回退已失效的语音 provider（白名单校验）", async () => {
    const profile = makeProfile({
      snapshot: {
        schemaVersion: 1,
        capturedAt: "2026-08-28T00:00:00.000Z",
        kind: "orchestrated",
        s2vConfig: {
          imageStyle: "cinematic",
          voiceProvider: "dead-provider", voiceModel: "vm", voiceId: "v1",
          videoMode: "off",
        },
        s2vOutputConfig: {},
        ui: {},
      },
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await prepareProviders(w);
    w.vm.s2vConfig.voiceProvider = "edge-tts";
    await w.vm.applyS2VConfigProfileSnapshot(profile);
    expect(w.vm.s2vConfig.voiceProvider).toBe("edge-tts");
    expect(w.vm.s2vConfig.voiceModel).toBe("");
    w.unmount();
  });

  it("应用视频增强配置时清空失效 video provider 与 model", async () => {
    const profile = makeProfile({
      snapshot: {
        schemaVersion: 1,
        kind: "orchestrated",
        s2vConfig: {
          imageStyle: "cinematic",
          videoMode: "fixed",
          videoProvider: "retired-video-provider",
          videoModel: "retired-video-model",
        },
        s2vOutputConfig: {},
        ui: {},
      },
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await prepareProviders(w);

    await w.vm.applyS2VConfigProfileSnapshot(profile);

    expect(w.vm.s2vConfig.videoMode).toBe("fixed");
    expect(w.vm.s2vConfig.videoProvider).toBe("");
    expect(w.vm.s2vConfig.videoModel).toBe("");
    w.unmount();
  });

  it("应用关闭视频增强的配置时同样清空失效 video provider 与 model", async () => {
    const profile = makeProfile({
      snapshot: {
        schemaVersion: 1,
        kind: "orchestrated",
        s2vConfig: {
          imageStyle: "cinematic",
          videoMode: "off",
          videoProvider: "retired-video-provider",
          videoModel: "retired-video-model",
        },
        s2vOutputConfig: {},
        ui: {},
      },
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await prepareProviders(w);

    await w.vm.applyS2VConfigProfileSnapshot(profile);

    expect(w.vm.s2vConfig.videoMode).toBe("off");
    expect(w.vm.s2vConfig.videoProvider).toBe("");
    expect(w.vm.s2vConfig.videoModel).toBe("");
    w.unmount();
  });

  it("应用配置不会写入 story2video.lastOptions.v1", async () => {
    const mocks = await import("@/api/publisher");
    mocks.storeSetSetting.mockResolvedValue({ code: 0 });
    const profile = makeProfile({
      snapshot: {
        schemaVersion: 1,
        kind: "orchestrated",
        s2vConfig: { imageStyle: "realistic", voiceProvider: "edge-tts", videoMode: "off" },
        s2vOutputConfig: { resolution: "720x1280", fps: 30, format: "mp4" },
        ui: {},
      },
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await prepareProviders(w);
    mocks.storeSetSetting.mockClear();

    await w.vm.applyS2VConfigProfileSnapshot(profile);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(mocks.storeSetSetting.mock.calls.filter(([key]) => key === "story2video.lastOptions.v1")).toHaveLength(0);
    w.unmount();
  });

  it("表单已修改时应用需二次确认，确认后应用", async () => {
    const profile = makeProfile({
      snapshot: {
        schemaVersion: 1,
        capturedAt: "2026-08-28T00:00:00.000Z",
        kind: "orchestrated",
        s2vConfig: { imageStyle: "realistic", voiceProvider: "edge-tts", videoMode: "off" },
        s2vOutputConfig: { resolution: "720x1280" },
        ui: {},
      },
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await prepareProviders(w);
    w.vm.s2vConfig.imageStyle = "anime";
    await w.vm.requestApplyS2VConfigProfile(profile);
    expect(w.vm.s2vConfigProfileApplyDialogOpen).toBe(true);
    await w.vm.confirmApplyS2VConfigProfile();
    expect(w.vm.s2vConfigProfileApplyDialogOpen).toBe(false);
    expect(w.vm.s2vConfig.imageStyle).toBe("realistic");
    w.unmount();
  });

  it("跨流水线配置不能应用并 toast 提示", async () => {
    const mocks = await import("@/api/publisher");
    const foreign = makeProfile({ id: "p-other", pipelineId: "cinematic", name: "电影解说" });
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [foreign] });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileList();
    const applyBtn = w.find('[data-testid="s2v-config-profile-apply"]');
    expect(applyBtn.attributes("disabled")).toBeDefined();
    await w.vm.requestApplyS2VConfigProfile(foreign);
    expect(w.vm.s2vConfigProfileApplyDialogOpen).toBe(false);
    expect(w.vm.s2vOptionsToast).toContain("其他流水线");
    w.unmount();
  });

  it("管理弹窗内重命名成功更新列表并退出编辑态", async () => {
    const mocks = await import("@/api/publisher");
    const profile = makeProfile();
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [profile] });
    mocks.story2videoConfigProfileRename.mockResolvedValue({ code: 0, data: { ...profile, name: "新名字" } });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileList();
    w.vm.startS2VConfigProfileRename(profile);
    expect(w.vm.s2vConfigProfileRenamingId).toBe("profile-00000000000001");
    w.vm.s2vConfigProfileRenameDraft = "新名字";
    await w.vm.saveS2VConfigProfileRename();
    expect(mocks.story2videoConfigProfileRename).toHaveBeenCalledWith("profile-00000000000001", "新名字");
    expect(w.vm.s2vConfigProfiles[0].name).toBe("新名字");
    expect(w.vm.s2vConfigProfileRenamingId).toBe("");
    expect(w.vm.s2vOptionsToast).toContain("重命名");
    w.unmount();
  });

  it("删除配置：确认弹窗确认后删除并更新列表", async () => {
    const mocks = await import("@/api/publisher");
    const profile = makeProfile();
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [profile] });
    mocks.story2videoConfigProfileDelete.mockResolvedValue({ code: 0, data: { deleted: true } });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await w.vm.openS2VConfigProfileList();
    w.vm.requestS2VConfigProfileDelete(profile);
    expect(w.vm.s2vConfigProfileDeleteDialogOpen).toBe(true);
    await w.vm.confirmS2VConfigProfileDelete();
    expect(mocks.story2videoConfigProfileDelete).toHaveBeenCalledWith("profile-00000000000001");
    expect(w.vm.s2vConfigProfiles).toHaveLength(0);
    expect(w.vm.s2vConfigProfileDeleteDialogOpen).toBe(false);
    expect(w.vm.s2vOptionsToast).toContain("配置已删除");
    w.unmount();
  });

  it("legacy 流水线：快照为 legacy 形态，应用覆盖字段并归一化陈旧枚举", async () => {
    const w = await mountView();
    await selectPipeline(w, "animated-explainer");
    const snapshot = w.vm.buildPipelineConfigSnapshot();
    expect(snapshot.kind).toBe("legacy");
    expect(snapshot.legacy.inputMode).toBe("text");
    expect(snapshot.legacy.selectedStyle).toBeDefined();
    const legacyProfile = makeProfile({
      pipelineId: "animated-explainer",
      snapshot: {
        schemaVersion: 1,
        kind: "legacy",
        legacy: {
          inputMode: "text",
          selectedStyle: "retired-style",
          llmConfig: {},
          budgetConfig: { mode: "strict", totalUsd: 88 },
          checkpointPolicy: "auto_noncreative",
          storyboardMode: "auto",
          outputConfig: { resolution: "720x1280", fps: 25, format: "avi" },
        },
      },
    });
    await w.vm.applyS2VConfigProfileSnapshot(legacyProfile);
    expect(w.vm.checkpointPolicy).toBe("auto_noncreative");
    expect(w.vm.outputConfig.resolution).toBe("720x1280");
    expect(w.vm.outputConfig.fps).toBe(30);
    expect(w.vm.outputConfig.format).toBe("mp4");
    expect(w.vm.budgetConfig).toMatchObject({ mode: "warn", totalUsd: 88 });
    expect(w.vm.selectedStyle).toBe("clean-professional");
    w.unmount();
  });

  it("应用确认期间切换流水线时重新拒绝跨流水线配置", async () => {
    const profile = makeProfile({
      snapshot: {
        schemaVersion: 1,
        kind: "orchestrated",
        s2vConfig: { imageStyle: "realistic", voiceProvider: "edge-tts", videoMode: "off" },
        s2vOutputConfig: {},
        ui: {},
      },
    });
    const w = await mountView();
    await selectPipeline(w, "story2video-compose");
    await prepareProviders(w);
    w.vm.s2vConfig.imageStyle = "anime";
    await w.vm.requestApplyS2VConfigProfile(profile);
    expect(w.vm.s2vConfigProfileApplyDialogOpen).toBe(true);
    w.vm.selectedPipeline = { name: "animated-explainer", available: true, stages: [] };

    await w.vm.confirmApplyS2VConfigProfile();

    expect(w.vm.s2vConfig.imageStyle).toBe("anime");
    expect(w.vm.s2vConfigProfileApplyDialogOpen).toBe(false);
    expect(w.vm.s2vOptionsToast).toContain("其他流水线");
    w.unmount();
  });
});

describe("CreateView 启动前置校验弹窗（models_required + 去模型设置）", () => {
  const mountCreateView = () => mount(CreateView, {
    global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
  })

  it("缺失模型错误显示「去模型设置」按钮，点击跳转 ModelProviders 并关闭弹窗", async () => {
    const w = mountCreateView()
    await nextTick()
    w.vm.showStory2VideoErrorDialog({
      errorCode: "PIPELINE_MODEL_REQUIREMENTS_MISSING",
      errorParams: { missing: ["video"], providers: {} },
      error: "启动被拦截：缺少模型能力 视频模型。请到「模型设置」中添加对应模型后重试。",
    })
    await nextTick()
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.models_required")
    expect(w.vm.canGoToModelSettings).toBe(true)
    const btn = w.find('[data-testid="go-to-model-settings"]')
    expect(btn.exists()).toBe(true)
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue()
    await btn.trigger("click")
    expect(pushSpy).toHaveBeenCalledWith({ name: "ModelProviders" })
    expect(w.vm.story2videoErrorDialog.visible).toBe(false)
    pushSpy.mockRestore()
    w.unmount()
  })

  it("非 models_required 错误不显示「去模型设置」按钮", async () => {
    const w = mountCreateView()
    await nextTick()
    w.vm.showStory2VideoErrorDialog({
      messageKey: "story2video.model_configuration_required",
      error: "Story2Video 默认 LLM 不可用，请先完成模型设置",
    })
    await nextTick()
    expect(w.vm.canGoToModelSettings).toBe(false)
    expect(w.find('[data-testid="go-to-model-settings"]').exists()).toBe(false)
    w.unmount()
  })

  it("批量项启动前置校验失败（errorCode）→ 轮询刷新弹出提示，且同一 itemId 不重复弹", async () => {
    const mocks = await import("@/api/publisher")
    const failedBatch = {
      id: "batch_models_1",
      createdAt: "2026-08-28T00:00:00.000Z",
      mode: "text",
      items: [{
        itemId: "batch_models_1_i0",
        label: "文案 1",
        status: "failed",
        errorCode: "PIPELINE_MODEL_REQUIREMENTS_MISSING",
        errorParams: { missing: ["image"], providers: {} },
        error: "启动被拦截：缺少模型能力 图片生成。请到「模型设置」中添加对应模型后重试。",
      }],
    }
    mocks.story2videoBatchStatus.mockResolvedValue({ code: 0, data: [failedBatch] })
    const w = mountCreateView()
    await nextTick()

    await w.vm.refreshS2VBatches()
    expect(w.vm.story2videoErrorDialog.visible).toBe(true)
    expect(w.vm.story2videoErrorDialog.messageKey).toBe("story2video.models_required")
    expect(w.vm.story2videoErrorDialog.messageParams.missingLabels).toContain("图片生成")

    // 再次轮询：同一 itemId 不重复弹窗（dialog 内容保持不变，且 showStory2VideoErrorDialog 未被再次调用）
    const showSpy = vi.spyOn(w.vm, "showStory2VideoErrorDialog")
    await w.vm.refreshS2VBatches()
    expect(showSpy).not.toHaveBeenCalled()
    showSpy.mockRestore()
    w.unmount()
  })
});
