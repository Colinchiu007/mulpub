import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, config } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";

/**
 * CreateView 删除克隆音色的危险操作门禁回归（docs/frontend-interaction-spec.md §2）
 *
 * 契约：
 * 1. 删除前必须经 confirmDanger 二次确认，确认文案须点名受影响音色；
 * 2. 取消（resolve=false）时不得调用底层 deleteTtsVoiceClone API；
 * 3. 确认时只调用一次。
 */

const confirmDangerMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/utils/confirm-danger", () => ({
  confirmDanger: confirmDangerMock,
}));

vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
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
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: { id: "openai" } }),
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: "AI" } }),
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
  story2videoConfigProfileList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoConfigProfileCreate: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileRename: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
  story2videoConfigProfileDelete: vi.fn().mockResolvedValue({ code: -1, message: "electronAPI not available" }),
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
  deleteTtsVoiceClone: vi.fn().mockResolvedValue({ code: 0 }),
  getTtsVoiceCloneRequirements: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
  listTtsVoiceClones: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
  renameTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: "TTS_VOICE_CLONE_API_UNAVAILABLE" }),
}));

import UiButton from "@/components/UiButton.vue";
import UiSelect from "@/components/UiSelect.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/create/result", name: "result", component: { template: "<div>result</div>" } },
    { path: "/create", name: "create", component: { template: "<div>create</div>" } },
  ],
});

import CreateView from "./CreateView.vue";
import CreateViewHistory from "./CreateViewHistory.vue";
import { PipelineSelector, StageProgress } from "./video-creation";
import i18n from "@/i18n";
import { deleteTtsVoiceClone } from "@/api/tts-voice-clone";

config.global.stubs = { ...(config.global.stubs || {}), teleport: true };

function mountCreateView() {
  return mount(CreateView, {
    global: {
      plugins: [router, i18n],
      components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress },
    },
  });
}

/** 准备好可删除的克隆音色上下文：provider/model 齐备 + 列表中有目标音色 */
async function mountWithClonedVoice(voices) {
  const w = mountCreateView();
  await nextTick();
  await w.vm.loadS2VProviders();
  await nextTick();
  w.vm.s2vConfig.voiceProvider = "minimax-tts";
  w.vm.s2vConfig.voiceModel = "speech-2.8-turbo";
  w.vm.s2vVoiceClones = voices;
  w.vm.s2vVoiceCloneLoading = false;
  await nextTick();
  return w;
}

describe("CreateView 删除克隆音色 — 危险操作门禁", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    window.localStorage.clear();
    confirmDangerMock.mockResolvedValue(true);
    deleteTtsVoiceClone.mockResolvedValue({ code: 0 });
  });

  it("确认后调用一次删除 API，并把音色移出列表", async () => {
    const w = await mountWithClonedVoice([
      { id: "voice-a", name: "音色001" },
      { id: "voice-b", name: "音色002" },
    ]);

    await w.vm.deleteS2VVoiceClone("voice-a");
    await nextTick();

    expect(confirmDangerMock).toHaveBeenCalledTimes(1);
    expect(deleteTtsVoiceClone).toHaveBeenCalledTimes(1);
    expect(deleteTtsVoiceClone).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "voice-a" }));
    // 结构类断言（QM-3）：列表整体而非子串包含
    expect(w.vm.s2vVoiceClones).toEqual([{ id: "voice-b", name: "音色002" }]);
    expect(w.vm.s2vVoiceCloneLoading).toBe(false);
    w.unmount();
  });

  it("取消确认时不调用删除 API，列表保持不变", async () => {
    confirmDangerMock.mockResolvedValue(false);
    const w = await mountWithClonedVoice([
      { id: "voice-a", name: "音色001" },
      { id: "voice-b", name: "音色002" },
    ]);
    const before = [...w.vm.s2vVoiceClones];

    await w.vm.deleteS2VVoiceClone("voice-a");
    await nextTick();

    expect(confirmDangerMock).toHaveBeenCalledTimes(1);
    expect(deleteTtsVoiceClone).not.toHaveBeenCalled();
    expect(w.vm.s2vVoiceClones).toEqual(before);
    expect(w.vm.s2vVoiceCloneLoading).toBe(false);
    w.unmount();
  });

  it("确认文案点名受影响音色且说明不可恢复", async () => {
    const w = await mountWithClonedVoice([{ id: "voice-a", name: "我的声音" }]);

    await w.vm.deleteS2VVoiceClone("voice-a");

    const options = confirmDangerMock.mock.calls[0][0];
    // 结构类断言（QM-3）：文案与 i18n 期望值逐字相等，而非宽松子串
    expect(options.message).toBe(
      i18n.global.t("create.story2video.voice.cloneDeleteConfirmMessage", { name: "我的声音" }),
    );
    expect(options.title).toBe(i18n.global.t("create.story2video.voice.cloneDeleteConfirmTitle"));
    expect(options.confirmText).toBe(i18n.global.t("create.story2video.voice.cloneDeleteConfirmButton"));
    expect(options.message).toContain("我的声音");
    w.unmount();
  });

  it("音色上下文中缺失（未选 provider/model）时不弹确认也不删", async () => {
    const w = mountCreateView();
    await nextTick();
    w.vm.s2vConfig.voiceProvider = "";
    w.vm.s2vConfig.voiceModel = "";
    w.vm.s2vVoiceClones = [{ id: "voice-a", name: "音色001" }];
    await nextTick();

    await w.vm.deleteS2VVoiceClone("voice-a");

    expect(confirmDangerMock).not.toHaveBeenCalled();
    expect(deleteTtsVoiceClone).not.toHaveBeenCalled();
    w.unmount();
  });

  it("删除 API 失败时不移除音色，并给出错误提示", async () => {
    deleteTtsVoiceClone.mockResolvedValue({ code: -1, message: "VOICE_CLONE_NOT_FOUND" });
    const w = await mountWithClonedVoice([{ id: "voice-a", name: "音色001" }]);

    await w.vm.deleteS2VVoiceClone("voice-a");
    await nextTick();

    expect(deleteTtsVoiceClone).toHaveBeenCalledTimes(1);
    expect(w.vm.s2vVoiceClones).toEqual([{ id: "voice-a", name: "音色001" }]);
    expect(w.vm.s2vVoiceCloneError).toBeTruthy();
    w.unmount();
  });
});
