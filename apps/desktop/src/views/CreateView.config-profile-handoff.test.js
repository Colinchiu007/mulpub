// @ts-check
/**
 * CreateView.config-profile-handoff.test.js — 「去发布」弹窗带入的配置档案在创作页自动套用
 * （publish-config-picker，2026-10-21）
 *
 * 契约（与弹窗侧 `buildCreateHandoffQuery` 一一对应）：
 *   /create?draft=<id>&pipeline=<pid>&configProfile=<profileId>
 *   - configProfile 缺省 ⇒ 不套用任何配置（流水线默认参数），且不提示；
 *   - 配置属于别的流水线 ⇒ 拒绝套用并提示（跨流水线套用是错误语义）；
 *   - 配置已被删除 ⇒ 提示「不存在或已被删除」，按默认参数继续，不静默失败。
 *
 * 独立成文件而不是并入 CreateView.test.js：CI 债务熔断限制单测试文件膨胀（容差 200 行）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, config } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
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
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: { id: "openai" } }),
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: "AI生成的正文" } }),
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
  storeSetSetting: vi.fn().mockResolvedValue({ code: 0, data: true }),
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
  story2videoBgmLibraryStatus: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoConfigProfileCreate: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileRename: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileDelete: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoBatchCreate: vi.fn().mockResolvedValue({ code: 0, data: { batchId: "batch_test_1", items: [] } }),
  story2videoBatchStatus: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBatchCancel: vi.fn().mockResolvedValue({ code: 0, data: { success: true, cancelled: 1 } }),
  story2videoPickBatchFiles: vi.fn().mockResolvedValue({ code: 0, data: [] }),
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
import CreateView from "./CreateView.vue";
import CreateViewHistory from './CreateViewHistory.vue'
import { settingsDialogRevision } from "@/stores/settings-dialog";
import { PipelineSelector, StageProgress } from './video-creation'
import { resetBgmLibraryForTest } from './video-creation/composables/useBgmLibrary'
import { resetTtsVoicesForTest } from './video-creation/composables/useTtsVoices'
import { resetBatchCreateForTest } from './video-creation/composables/useBatchCreate'
import i18n from "@/i18n";

config.global.stubs = { ...(config.global.stubs || {}), teleport: true };

const PROFILE_ID = "profile-000000000001";

/** 编排型快照：只带最小字段，够走通「套用 → 记录已应用配置名」这条链。 */
const orchestratedSnapshot = () => ({
  schemaVersion: 1,
  capturedAt: "2026-10-21T00:00:00.000Z",
  kind: "orchestrated",
  s2vConfig: { title: "来自配置的标题" },
  s2vOutputConfig: { resolution: "1080x1920", fps: 30, format: "mp4" },
  ui: { expandedGroups: [] },
});

async function mountWithQuery (query) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/create", name: "create", component: { template: "<div>create</div>" } },
      { path: "/create/result", name: "result", component: { template: "<div>result</div>" } },
    ],
  });
  await router.push({ path: "/create", query });
  await router.isReady();
  const w = mount(CreateView, {
    global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } }
  });
  await nextTick();
  return w;
}

describe("CreateView 配置档案交接（publish-config-picker）", () => {
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

  it("URL 带上 configProfile 时自动套用该配置并提示「已应用配置」", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValue({
      code: 0,
      data: [{ id: "draft_1", title: "标题", content: "改写后的文案内容" }],
    });
    mocks.pipelineList.mockResolvedValue({
      code: 0,
      data: [{ name: "story2video-compose", available: true, stages: [] }],
    });
    mocks.story2videoConfigProfileList.mockResolvedValue({
      code: 0,
      data: [{
        id: PROFILE_ID,
        name: "口播竖屏",
        pipelineId: "story2video-compose",
        snapshot: orchestratedSnapshot(),
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      }],
    });

    const w = await mountWithQuery({
      draft: "draft_1",
      pipeline: "story2video-compose",
      configProfile: PROFILE_ID,
    });
    await vi.waitFor(() => expect(w.vm.s2vActiveConfigProfile).toBe("口播竖屏"));
    expect(w.vm.s2vConfig.title).toBe("来自配置的标题");
    w.unmount();
  });

  it("配置属于别的流水线时拒绝套用并给出可读提示", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValue({
      code: 0,
      data: [{ id: "draft_1", title: "标题", content: "改写后的文案内容" }],
    });
    mocks.pipelineList.mockResolvedValue({
      code: 0,
      data: [{ name: "story2video-compose", available: true, stages: [] }],
    });
    mocks.story2videoConfigProfileList.mockResolvedValue({
      code: 0,
      data: [{
        id: PROFILE_ID,
        name: "别的流水线的配置",
        pipelineId: "video-clone",
        snapshot: orchestratedSnapshot(),
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      }],
    });

    const w = await mountWithQuery({
      draft: "draft_1",
      pipeline: "story2video-compose",
      configProfile: PROFILE_ID,
    });
    await vi.waitFor(() => expect(w.vm.s2vOptionsToast).toContain("属于其他流水线"));
    expect(w.vm.s2vActiveConfigProfile).toBe("");
    w.unmount();
  });

  it("配置已被删除时如实提示，不静默当作「没选配置」", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValue({
      code: 0,
      data: [{ id: "draft_1", title: "标题", content: "改写后的文案内容" }],
    });
    mocks.pipelineList.mockResolvedValue({
      code: 0,
      data: [{ name: "story2video-compose", available: true, stages: [] }],
    });
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [] });

    const w = await mountWithQuery({
      draft: "draft_1",
      pipeline: "story2video-compose",
      configProfile: PROFILE_ID,
    });
    await vi.waitFor(() => expect(w.vm.s2vOptionsToast).toContain("不存在或已被删除"));
    expect(w.vm.s2vActiveConfigProfile).toBe("");
    w.unmount();
  });

  it("没有 configProfile 参数时不套用也不提示（用流水线默认参数）", async () => {
    const mocks = await import("@/api/publisher");
    mocks.draftList.mockResolvedValue({
      code: 0,
      data: [{ id: "draft_1", title: "标题", content: "改写后的文案内容" }],
    });
    mocks.pipelineList.mockResolvedValue({
      code: 0,
      data: [{ name: "story2video-compose", available: true, stages: [] }],
    });

    const w = await mountWithQuery({ draft: "draft_1", pipeline: "story2video-compose" });
    await nextTick();
    await nextTick();
    expect(w.vm.s2vActiveConfigProfile).toBe("");
    expect(mocks.story2videoConfigProfileList).not.toHaveBeenCalled();
    w.unmount();
  });
});
