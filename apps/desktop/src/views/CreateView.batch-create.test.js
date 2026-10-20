import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, config } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 结构锁要读同目录的源文件；本仓 vitest 走 ESM，__dirname 不保证存在，按 import.meta.url 求
const __DIR = path.dirname(fileURLToPath(import.meta.url));

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
// 批量创作域用 useBatchCreate composable + story2videoBatch* IPC，与 TTS/服务商状态无关，
// 独立成文件对主文件的状态隔离影响最小。
describe("CreateView 批量创作", () => {
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

describe("批量创作（story2video-batch-create）", () => {
  // ⚠️ Teleport 弹窗清场模式（batch-teleport-fix，方案 §2.9 前置基建）：
  // UiModal 经 <Teleport to="body"> 渲染，弹窗内交互的事件闭包委托到**模块级单例**
  // （桥接 setter 写 batchCreateRefs）。卸载后残留 DOM 的迟到交互会把状态写进单例、
  // 污染下一用例（实测 s2vBatchTab 残留 'files' 走错分支）。
  // 标准顺序：unmount → 冲刷挂起微任务 → 清 body 残留 → 再冲刷（teleport-cleanup.js）。
  afterEach(async () => {
    await afterTeleportCleanup();
  });
  const mountS2V = async () => {
    // mount 前再复位一次（beforeEach 的 reset 与 mount 之间若有上一用例的迟到写入，
    // 此处强制回到初值——teleport 污染的兜底防线，batch-teleport-fix）
    resetBatchCreateForTest();
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

  // ── 稳定键（UX 审计 4.8）：`:key="index"` 让「模型不拥有的 DOM 状态」跟着位置而不是跟着条目 ──
  // 症状不是显示错乱（v-model 会把 value 补对），而是**光标/撤销栈/输入法合成态跟着节点走**：
  // 删掉靠前的行时，用户正在敲的那个节点被卸载，焦点与未提交的合成串一起丢失。
  it("删除靠前的文案行时，用户正在编辑的那个 DOM 节点必须存活（稳定键，非 index）", async () => {
    const w = await mountS2V();
    // 焦点语义要求树真的挂在 document 里：vue-test-utils 默认把组件挂在游离节点上，
    // 那时 element.focus() 不会改 document.activeElement —— 少了这一步，下面这条
    // "焦点不得被打掉"的断言测的是夹具而不是被测代码。
    document.body.appendChild(w.element);
    try {
      await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
      await nextTick();
      await w.find('[data-testid="s2v-batch-add-text"]').trigger("click");
      await w.find('[data-testid="s2v-batch-add-text"]').trigger("click");
      await nextTick();

      const before = w.findAll("textarea.s2v-batch-text-area");
      expect(before.length).toBe(3);
      await before[0].setValue("AAA");
      await before[1].setValue("BBB");
      await before[2].setValue("CCC");
      // 给每个真实 DOM 节点打一个只有节点自己知道的记号（不是模型里的数据）
      before.forEach((n, i) => { n.element.dataset.nodeProbe = String(i); });
      before[2].element.focus();
      expect(document.activeElement, "夹具前提：挂进 document 后 focus() 必须真的生效").toBe(before[2].element);

      await w.find('[data-testid="s2v-batch-text-remove-0"]').trigger("click");
      await nextTick();

      const after = w.findAll("textarea.s2v-batch-text-area");
      expect(after.length).toBe(2);
      // 内容必须仍然正确（这条不是新行为，是防"改键把值改坏"的对偶）
      expect(after.map((n) => n.element.value)).toEqual(["BBB", "CCC"]);
      // 关键判据：留着 CCC 的那个节点，必须就是删之前留着 CCC 的那个节点
      expect(after[1].element.dataset.nodeProbe, "index 作 key 时 Vue 会复用靠前的节点，最后一个节点被卸载").toBe("2");
      expect(after[0].element.dataset.nodeProbe).toBe("1");
      // 用户正在敲的那一格不得因为"删了别的一格"而丢焦点
      expect(document.activeElement, "删除其它行不得把焦点从用户正在编辑的行上打掉").toBe(after[1].element);
    } finally {
      w.unmount();
      if (w.element.parentNode === document.body) document.body.removeChild(w.element);
    }
  });

  it("对外契约不变：s2vBatchTexts 仍是字符串数组，写入/清空走同一份真源", async () => {
    const w = await mountS2V();
    await w.find('[data-testid="s2v-batch-trigger"]').trigger("click");
    await nextTick();
    expect(Array.isArray(w.vm.s2vBatchTexts)).toBe(true);
    expect(w.vm.s2vBatchTexts).toEqual([""]);
    const rows = w.findAll("textarea.s2v-batch-text-area");
    await rows[0].setValue("hello");
    expect(w.vm.s2vBatchTexts).toEqual(["hello"]);
    // 派生读视图必须是只读的：不冻的话，模板里误写 `s2vBatchTexts[i] = ...` 会写进
    // 一个"下一次读还是它"的缓存数组 —— 静默丢失，比抛错难发现得多（变异 M2 实测）。
    expect(Object.isFrozen(w.vm.s2vBatchTexts), "派生视图必须冻结，误写要当场抛错").toBe(true);
    expect(() => { w.vm.s2vBatchTexts[0] = "oops"; }).toThrow();
    expect(w.vm.s2vBatchTexts).toEqual(["hello"]);
    // 行身份必须存在且互不相同（这是上面那条 DOM 身份断言的载体；缺了它就没有稳定键可用）
    const ids = w.vm.s2vBatchTextRows.map((r) => r.id);
    expect(ids.length).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
    w.unmount();
  });

  it("图片缩略图的键必须是条目自身身份，不得只按位置（本文件 audio.path || i 先例）", () => {
    const src = fs.readFileSync(path.join(__DIR, "CreateView.vue"), "utf8");
    // 逐条点名：这三处 v-for 的 :key 不得是裸 index（`audio.path || i` 那种"身份优先、位置兜底"算合规）
    const sites = [
      { name: "pipelineImages", re: /v-for="\(img, i\) in pipelineImages" :key="([^"]+)"/g },
      { name: "quickImages", re: /v-for="\(img, i\) in quickImages" :key="([^"]+)"/g },
      { name: "s2vBatchTexts", re: /v-for="\(row, index\) in s2vBatchTextRows" :key="([^"]+)"/g },
    ];
    for (const s of sites) {
      const hits = [...src.matchAll(s.re)];
      expect(hits.length, `扫描域必须命中 ${s.name}（命中 0 处说明这条锁的锚点已失效，不是"已收敛"）`).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h[1], `${s.name} 的 :key 退回裸 index 会复用节点，把光标/撤销栈/行内样式留给错误的条目`).not.toBe("i");
        expect(h[1]).not.toBe("index");
      }
    }
  });
});
});
