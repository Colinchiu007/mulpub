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
  renderStartAiVideo: vi.fn(),
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
  // 历史 BGM 路径核验（s2v-bgm-legacy-repair）：默认返回 code -1 → unknown（失败开放，不阻断旧用例）。
  story2videoBgmLibraryStatus: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
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
import { resetBgmLibraryForTest } from './video-creation/composables/useBgmLibrary'
import { resetTtsVoicesForTest } from './video-creation/composables/useTtsVoices'
import { resetBatchCreateForTest, batchCreateRefs } from './video-creation/composables/useBatchCreate'
import { afterTeleportCleanup } from './teleport-cleanup'
import i18n from "@/i18n";

// Production renders the progress modal through Teleport. Page tests keep the
// modal inside the wrapper; UiModal tests cover the real body mount contract.
config.global.stubs = { ...(config.global.stubs || {}), teleport: true };

// 从 CreateView.test.js 拆出（2026-10-18）：CI 债务熔断限制单测试文件膨胀（容差 200 行）。
// 这两组用例只断言输出配置/字数上限的解析结果，不依赖前置用例留下的语音状态。
describe("CreateView 画幅下发与文案字数上限", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    window.localStorage.clear();
    settingsDialogRevision.value = 0;
    resetBgmLibraryForTest();
    resetTtsVoicesForTest();
    resetBatchCreateForTest();
  });

describe("自动流水线（非故事讲述）画幅随分辨率下发（2026-10-06 回归）", () => {
  it("AI 讲解视频：分辨率 720x1280 时同时下发 aspectRatio=9:16", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-explainer-aspect" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "animated-explainer", stages: [] };
    w.vm.pipelineText = "一只戴帽子的猫在月球上喝茶";
    // activeOutputConfig 是只读 computed：非故事讲述流水线取自 outputConfig（见 CreateView:1223）
    w.vm.outputConfig = { ...w.vm.outputConfig, resolution: "720x1280" };
    await w.vm.startPipeline();

    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalledWith("animated-explainer", expect.objectContaining({
      resolution: "720x1280",
      aspectRatio: "9:16",
    }));
    w.unmount();
  });

  it("AI 讲解视频：横屏 1920x1080 时下发 aspectRatio=16:9（横屏行为不变）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-explainer-aspect-land" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
    });
    await nextTick();
    w.vm.selectedPipeline = { name: "animated-explainer", stages: [] };
    w.vm.pipelineText = "一只戴帽子的猫在月球上喝茶";
    w.vm.outputConfig = { ...w.vm.outputConfig, resolution: "1920x1080" };
    await w.vm.startPipeline();

    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalledWith("animated-explainer", expect.objectContaining({
      aspectRatio: "16:9",
    }));
    w.unmount();
  });
});

describe("Story2Video 文案字数上限（运营中心运行时下发）", () => {
  const mountView = () => mount(CreateView, {
    global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-text-limit" } });
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { status: { status: "paused" }, context: {} } });
    mocks.draftList.mockResolvedValue({ code: 0, data: [] });
  });

  it("未配置运营项时默认上限 10000，计数分母渲染生效值", async () => {
    const w = mountView();
    await nextTick();
    expect(w.vm.storyTextLimit).toBeNull();
    expect(w.vm.story2videoTextMaxChars).toBe(10000);
    expect(w.vm.story2videoTextWarnPercent).toBe(90);
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "字".repeat(10000);
    await nextTick();
    expect(w.text()).toContain("10000/10000");
    // 恰好 10000 不截断；10001 才截断并提示生效值
    w.vm.enforceStory2VideoTextLimit();
    expect(Array.from(w.vm.pipelineText).length).toBe(10000);
    w.vm.pipelineText = "字".repeat(10001);
    w.vm.enforceStory2VideoTextLimit();
    expect(Array.from(w.vm.pipelineText).length).toBe(10000);
    expect(w.vm.story2videoErrorDialog.messageParams.max).toBe(10000);
    w.unmount();
  });

  it("运营下发 12000：计数分母、截断阈值与启动校验全部按 12000 生效", async () => {
    const mocks = await import("@/api/publisher");
    const w = mountView();
    await nextTick();
    w.vm.storyTextLimit = { story2video: { maxChars: 12000, warnPercent: 90 } };
    await nextTick();
    expect(w.vm.story2videoTextMaxChars).toBe(12000);
    w.vm.selectedPipeline = { name: "story2video-compose", stages: [] };
    w.vm.pipelineText = "字".repeat(12000);
    await nextTick();
    expect(w.text()).toContain("12000/12000");
    w.vm.enforceStory2VideoTextLimit();
    expect(Array.from(w.vm.pipelineText).length).toBe(12000);
    // 启动校验同样用 12000：12001 被拒，12000 放行
    w.vm.pipelineText = "字".repeat(12001);
    await w.vm.startPipeline();
    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled();
    expect(w.vm.story2videoErrorDialog).toMatchObject({
      visible: true,
      messageKey: "story2video.text_too_long",
      messageParams: { max: 12000 },
    });
    w.vm.closeStory2VideoErrorDialog();
    w.vm.pipelineText = "字".repeat(12000);
    await w.vm.startPipeline();
    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalled();
    w.unmount();
  });

  it("运营下发非法值时回落内置 10000（字符串数字/浮点/越界均不例外）", async () => {
    const w = mountView();
    await nextTick();
    w.vm.storyTextLimit = { story2video: { maxChars: "12000", warnPercent: 150 } };
    await nextTick();
    expect(w.vm.story2videoTextMaxChars).toBe(10000);
    expect(w.vm.story2videoTextWarnPercent).toBe(90);
    for (const block of [
      { story2video: { maxChars: 99999999 } },
      { story2video: { maxChars: 12000.5 } },
      { story2video: { maxChars: 999 } },
      null,
    ]) {
      w.vm.storyTextLimit = block;
      await nextTick();
      expect(w.vm.story2videoTextMaxChars, JSON.stringify(block)).toBe(10000);
    }
    w.unmount();
  });

  it("预警档位由 warnPercent 驱动：默认 9000 起警示、达上限危险", async () => {
    const w = mountView();
    await nextTick();
    w.vm.pipelineText = "字".repeat(8999);
    await nextTick();
    expect(w.vm.story2videoTextCountLevel).toBe("");
    w.vm.pipelineText = "字".repeat(9000);
    await nextTick();
    expect(w.vm.story2videoTextCountLevel).toBe("is-warning");
    w.vm.pipelineText = "字".repeat(10000);
    await nextTick();
    expect(w.vm.story2videoTextCountLevel).toBe("is-danger");
    // 下发 warnPercent=80 / maxChars=12000 → 预警起点 floor(12000*0.8)=9600
    w.vm.storyTextLimit = { story2video: { maxChars: 12000, warnPercent: 80 } };
    w.vm.pipelineText = "字".repeat(9599);
    await nextTick();
    expect(w.vm.story2videoTextCountLevel).toBe("");
    w.vm.pipelineText = "字".repeat(9600);
    await nextTick();
    expect(w.vm.story2videoTextCountLevel).toBe("is-warning");
    w.unmount();
  });

  it("loadStoryTextLimit 读取失败时静默回落 null，不阻塞创作", async () => {
    const w = mountView();
    await nextTick();
    // 测试环境无 electronAPI ⇒ invokeWithFallback 回落 code=-1，解析结果为内置默认
    await expect(w.vm.loadStoryTextLimit()).resolves.toBeUndefined();
    expect(w.vm.storyTextLimit).toBeNull();
    expect(w.vm.story2videoTextMaxChars).toBe(10000);
    w.unmount();
  });
});
});
