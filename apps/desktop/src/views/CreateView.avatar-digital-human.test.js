// @ts-check
/**
 * CreateView.avatar-digital-human.test.js — 数字人（avatar-spokesperson）UI 契约
 *
 * 锁定 PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19 §5：
 *  - 仅数字人流水线渲染配置区
 *  - 形象/音色未选 → 启动禁用且原因常驻可见（不是 hover title）
 *  - 启动参数带 avatarId / voiceId / videoProvider=heygen
 *  - 加载中 / 失败 / 空 三态
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";
import i18n from "@/i18n";
import CreateView from "./CreateView.vue";
import UiButton from "@/components/UiButton.vue";
import UiSelect from "@/components/UiSelect.vue";
import CreateViewHistory from "./CreateViewHistory.vue";
import PipelineSelector from "./video-creation/PipelineSelector.vue";
import StageProgress from "./video-creation/StageProgress.vue";

const mockEnsureLogin = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: mockEnsureLogin,
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}));

const getAvatarCatalog = vi.hoisted(() => vi.fn());
const getAvatarVoiceCatalog = vi.hoisted(() => vi.fn());

vi.mock("@/api/avatar-catalog", () => ({
  getAvatarCatalog,
  getAvatarVoiceCatalog,
  invalidateAvatarCatalog: vi.fn(),
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
  story2videoBgmLibraryStatus: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoConfigProfileCreate: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileRename: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileDelete: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoBatchCreate: vi.fn().mockResolvedValue({ code: 0, data: { batchId: "batch_test_1", items: [] } }),
  story2videoBatchStatus: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBatchCancel: vi.fn().mockResolvedValue({ code: 0, data: { success: true, cancelled: 1 } }),
  story2videoPickBatchFiles: vi.fn().mockResolvedValue({ code: 0, data: { files: [] } }),
}));

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div/>" } }],
});

const AVATARS = [{ id: "ava-1", name: "小雅" }, { id: "ava-2", name: "小博" }];
const VOICES = [{ id: "voice-1", name: "甜美女声" }, { id: "voice-2", name: "沉稳男声" }];

async function mountView() {
  const w = mount(CreateView, {
    global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
  });
  await nextTick();
  return w;
}

async function selectPipeline(w, name) {
  w.vm.selectPipeline({ name, available: true, stages: [] });
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

describe("数字人配置区（avatar-spokesperson）", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    getAvatarCatalog.mockReset();
    getAvatarVoiceCatalog.mockReset();
    getAvatarCatalog.mockResolvedValue({ code: 0, data: { avatars: AVATARS } });
    getAvatarVoiceCatalog.mockResolvedValue({ code: 0, data: { voices: VOICES } });
    // 目录状态是模块级单例（跨用例会残留），每条用例前复位，
    // 否则「上一条已加载成功」会让本条走 cachedError 分支而非 error 分支。
    const { resetAvatarCatalogForTest } = await import("./video-creation/composables/useAvatarCatalog");
    resetAvatarCatalogForTest();
  });

  it("数字人流水线渲染配置区，其它流水线不渲染", async () => {
    const w = await mountView();
    await selectPipeline(w, "animation");
    expect(w.find('[data-testid="avatar-config-section"]').exists()).toBe(false);
    await selectPipeline(w, "avatar-spokesperson");
    expect(w.find('[data-testid="avatar-config-section"]').exists()).toBe(true);
    w.unmount();
  });

  it("选中数字人流水线时加载形象与音色目录", async () => {
    const w = await mountView();
    await selectPipeline(w, "avatar-spokesperson");
    expect(getAvatarCatalog).toHaveBeenCalled();
    expect(getAvatarVoiceCatalog).toHaveBeenCalled();
    w.unmount();
  });

  it("目录加载后下拉可选项来自接口", async () => {
    const w = await mountView();
    await selectPipeline(w, "avatar-spokesperson");
    expect(w.vm.avatarOptions.map((o) => o.id)).toEqual(["ava-1", "ava-2"]);
    expect(w.vm.avatarVoiceOptions.map((o) => o.id)).toEqual(["voice-1", "voice-2"]);
    w.unmount();
  });

  it("未选形象 → 启动禁用且原因常驻可见", async () => {
    const w = await mountView();
    await selectPipeline(w, "avatar-spokesperson");
    w.vm.pipelineText = "一段口播主题";
    w.vm.avatarId = "";
    w.vm.avatarVoiceId = "voice-1";
    await nextTick();
    expect(w.vm.canStartPipeline).toBe(false);
    expect(w.vm.pipelineBlockedReason).toContain("数字人形象");
    w.unmount();
  });

  it("未选音色 → 启动禁用且原因常驻可见", async () => {
    const w = await mountView();
    await selectPipeline(w, "avatar-spokesperson");
    w.vm.pipelineText = "一段口播主题";
    w.vm.avatarId = "ava-1";
    w.vm.avatarVoiceId = "";
    await nextTick();
    expect(w.vm.canStartPipeline).toBe(false);
    expect(w.vm.pipelineBlockedReason).toContain("音色");
    w.unmount();
  });

  it("★ 都选好后启动参数带 avatarId / voiceId / videoProvider=heygen", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-avatar-1" } });
    const w = await mountView();
    await selectPipeline(w, "avatar-spokesperson");
    w.vm.pipelineText = "一段口播主题";
    w.vm.avatarId = "ava-1";
    w.vm.avatarVoiceId = "voice-1";
    await nextTick();
    expect(w.vm.canStartPipeline).toBe(true);

    await w.vm.startExplainerPipeline();
    const [name, params] = mocks.pipelineStartOrchestrated.mock.calls.at(-1);
    expect(name).toBe("avatar-spokesperson");
    expect(params.avatarId).toBe("ava-1");
    expect(params.voiceId).toBe("voice-1");
    expect(params.videoProvider).toBe("heygen");
    expect(params.text).toBe("一段口播主题");
    w.unmount();
  });

  it("非数字人流水线不下发数字人参数", async () => {
    const mocks = await import("@/api/publisher");
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { runId: "run-anim-1" } });
    const w = await mountView();
    await selectPipeline(w, "animation");
    w.vm.pipelineText = "主题";
    await nextTick();
    await w.vm.startExplainerPipeline();
    const params = mocks.pipelineStartOrchestrated.mock.calls.at(-1)[1];
    expect(params.avatarId).toBeUndefined();
    expect(params.voiceId).toBeUndefined();
    w.unmount();
  });

  it("加载失败且无数据 → 显示「前往配置」引导，不渲染空下拉", async () => {
    getAvatarCatalog.mockResolvedValueOnce({ code: -1, message: "AVATAR_CATALOG_UNSUPPORTED_PROVIDER" });
    getAvatarVoiceCatalog.mockResolvedValueOnce({ code: -1, message: "AVATAR_CATALOG_UNSUPPORTED_PROVIDER" });
    const w = await mountView();
    await selectPipeline(w, "avatar-spokesperson");
    expect(w.vm.avatarProviderMissing).toBe(true);
    expect(w.find('[data-testid="avatar-provider-missing"]').exists()).toBe(true);
    expect(w.find('[data-testid="avatar-id-select"]').exists()).toBe(false);
    w.unmount();
  });

  it("加载成功但列表为空 → 空态提示且下拉禁用", async () => {
    getAvatarCatalog.mockResolvedValueOnce({ code: 0, data: { avatars: [] } });
    getAvatarVoiceCatalog.mockResolvedValueOnce({ code: 0, data: { voices: [] } });
    const w = await mountView();
    await selectPipeline(w, "avatar-spokesperson");
    expect(w.vm.avatarOptions).toEqual([]);
    expect(w.find('[data-testid="avatar-empty"]').exists()).toBe(true);
    w.unmount();
  });
});
