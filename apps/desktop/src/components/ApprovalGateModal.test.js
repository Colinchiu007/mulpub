import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, config } from "@vue/test-utils";
import { nextTick } from "vue";

// Stub Teleport/Transition for jsdom compatibility (UiModal uses Teleport to body)
config.global.stubs = config.global.stubs || {};
config.global.stubs.Teleport = { template: '<div><slot /></div>' };
config.global.stubs.Transition = { template: '<div><slot /></div>' };

import ApprovalGateModal from "./ApprovalGateModal.vue";

describe("ApprovalGateModal", () => {
  let getFn, approveFn, onApprovalFn;
  const approvalRequestListeners = new Set();

  beforeEach(() => {
    vi.clearAllMocks();
    approvalRequestListeners.clear();
    getFn = vi.fn();
    approveFn = vi.fn();
    onApprovalFn = vi.fn((cb) => {
      approvalRequestListeners.add(cb);
      return () => approvalRequestListeners.delete(cb);
    });
    window.electronAPI = {
      approvalGate: {
        get: getFn,
        approve: approveFn,
        onApprovalRequest: onApprovalFn,
      },
    };
  });

  function mountModal(props = {}) {
    return mount(ApprovalGateModal, {
      props: {
        visible: true,
        projectId: "p1",
        ...props,
      },
    });
  }

  it("does not render modal when visible=false", async () => {
    getFn.mockResolvedValue({ code: 0, data: null });
    const w = mount(ApprovalGateModal, {
      props: { visible: false, projectId: "p1" },
    });
    await flushPromises();
    expect(w.find(".ui-modal-overlay").exists()).toBe(false);
  });

  it("shows loading state when visible becomes true", async () => {
    getFn.mockReturnValue(new Promise(() => {}));
    const w = mountModal();
    await nextTick();
    expect(w.find(".gate-loading").exists()).toBe(true);
    // 统一骨架屏：断言骨架渲染而非"加载中"文案（文案只保留给辅助技术）
    expect(w.find('[data-testid="approval-gate-loading"]').exists()).toBe(true);
    expect(w.findAll(".mp-skeleton-surface").length).toBeGreaterThan(0);
    expect(w.text()).toContain("加载中");
  });

  it("shows empty state when no gate", async () => {
    getFn.mockResolvedValue({ code: 0, data: null });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-empty").exists()).toBe(true);
    expect(w.text()).toContain("当前无待审批门");
  });

  it("shows error state on get failure", async () => {
    getFn.mockResolvedValue({ code: -1, message: "加载失败" });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-error").exists()).toBe(true);
    expect(w.text()).toContain("加载失败");
  });

  it("shows error state on exception", async () => {
    getFn.mockRejectedValue(new Error("网络错误"));
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-error").exists()).toBe(true);
    expect(w.text()).toContain("网络错误");
  });

  it("renders gate content with script type badge", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        stageName: "script_generation",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "脚本内容示例",
        context: {},
        createdAt: new Date().toISOString(),
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-content").exists()).toBe(true);
    expect(w.find(".badge-script").exists()).toBe(true);
    expect(w.text()).toContain("脚本审批门");
    expect(w.text()).toContain("script_generation");
  });

  it("renders storyboard type badge", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "storyboard",
        stageName: "storyboard",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".badge-storyboard").exists()).toBe(true);
    expect(w.text()).toContain("分镜审批门");
  });

  it("renders scene_assets type badge", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        stageName: "assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".badge-scene_assets").exists()).toBe(true);
    expect(w.text()).toContain("场景素材审批门");
  });

  it("renders generic type badge for unknown type", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "unknown_type",
        stageName: "s",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".badge-generic").exists()).toBe(true);
    expect(w.text()).toContain("审批门");
  });

  it("shows decision hint for approve_or_modify mode", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain("可通过或修改后继续");
  });

  it("shows decision hint for approve-only mode", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain("需要审批通过才能继续");
  });

  it("renders approval content text", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve",
        content: "这是脚本内容\n多行文本",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-content-text").exists()).toBe(true);
    expect(w.text()).toContain("这是脚本内容");
  });

  it("renders context entries", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: { author: "AI", version: 2 },
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-context").exists()).toBe(true);
    expect(w.text()).toContain("author");
    expect(w.text()).toContain("AI");
    expect(w.text()).toContain("version");
    expect(w.text()).toContain("2");
  });

  it("hides context section when no context", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-context").exists()).toBe(false);
  });

  it("shows modification textarea only for approve_or_modify mode", async () => {
    // approve_or_modify 模式显示
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".modification-input").exists()).toBe(true);
  });

  it("hides modification textarea for approve-only mode", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".modification-input").exists()).toBe(false);
  });

  it("shows modify button only for approve_or_modify mode", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const buttons = w.findAll("button");
    const texts = buttons.map(b => b.text());
    expect(texts).toContain("通过");
    expect(texts).toContain("修改后继续");
    expect(texts).toContain("稍后处理");
  });

  it("hides modify button for approve-only mode", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const buttons = w.findAll("button");
    const texts = buttons.map(b => b.text());
    expect(texts).toContain("通过");
    expect(texts).not.toContain("修改后继续");
  });

  it("disables modify button when modification is empty", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const modifyBtn = w.findAll("button").find(b => b.text() === "修改后继续");
    expect(modifyBtn.attributes("disabled")).toBeDefined();
  });

  it("approves gate via IPC on approve click", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    approveFn.mockResolvedValue({
      code: 0,
      data: { resolved: true, gate: { id: "g1", status: "approved" } },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const approveBtn = w.findAll("button").find(b => b.text() === "通过");
    await approveBtn.trigger("click");
    await flushPromises();
    expect(approveFn).toHaveBeenCalledWith("g1", "approve", undefined);
  });

  it("emits resolved event on successful approve", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const resolvedGate = { id: "g1", status: "approved" };
    approveFn.mockResolvedValue({
      code: 0,
      data: { resolved: true, gate: resolvedGate },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const approveBtn = w.findAll("button").find(b => b.text() === "通过");
    await approveBtn.trigger("click");
    await flushPromises();
    const resolvedEvents = w.emitted("resolved");
    expect(resolvedEvents).toBeTruthy();
    expect(resolvedEvents[0][0]).toEqual({
      gate: resolvedGate,
      decision: "approve",
    });
  });

  it("emits close event on successful approve", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    approveFn.mockResolvedValue({
      code: 0,
      data: { resolved: true, gate: { id: "g1" } },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const approveBtn = w.findAll("button").find(b => b.text() === "通过");
    await approveBtn.trigger("click");
    await flushPromises();
    expect(w.emitted("close")).toBeTruthy();
  });

  it("modifies gate via IPC with modification text", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "",
        context: {},
      },
    });
    approveFn.mockResolvedValue({
      code: 0,
      data: { resolved: true, gate: { id: "g1", status: "modified" } },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    // 输入修改意见
    const textarea = w.find(".modification-input");
    await textarea.setValue("调整开头节奏");
    const modifyBtn = w.findAll("button").find(b => b.text() === "修改后继续");
    await modifyBtn.trigger("click");
    await flushPromises();
    expect(approveFn).toHaveBeenCalledWith("g1", "modify", "调整开头节奏");
  });

  it("emits resolved with modification on successful modify", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve_or_modify",
        content: "",
        context: {},
      },
    });
    const resolvedGate = { id: "g1", status: "modified" };
    approveFn.mockResolvedValue({
      code: 0,
      data: { resolved: true, gate: resolvedGate },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    await w.find(".modification-input").setValue("修改意见");
    const modifyBtn = w.findAll("button").find(b => b.text() === "修改后继续");
    await modifyBtn.trigger("click");
    await flushPromises();
    const resolvedEvents = w.emitted("resolved");
    expect(resolvedEvents).toBeTruthy();
    expect(resolvedEvents[0][0]).toEqual({
      gate: resolvedGate,
      decision: "modify",
      modification: "修改意见",
    });
  });

  it("emits close on later button click", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const laterBtn = w.findAll("button").find(b => b.text() === "稍后处理");
    await laterBtn.trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("registers onApprovalRequest listener on mount", async () => {
    getFn.mockResolvedValue({ code: 0, data: null });
    mountModal();
    await flushPromises();
    expect(onApprovalFn).toHaveBeenCalled();
  });

  it("reloads gate when approval request push received", async () => {
    getFn.mockResolvedValue({ code: 0, data: null });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(getFn).toHaveBeenCalledTimes(1);
    // 模拟推送
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g2",
        type: "script",
        status: "pending",
        requiredDecision: "approve",
        content: "新门",
        context: {},
      },
    });
    for (const cb of approvalRequestListeners) {
      cb({ type: "approval_gate", projectId: "p1", gateId: "g2" });
    }
    await flushPromises();
    await nextTick();
    expect(getFn).toHaveBeenCalledTimes(2);
    expect(w.text()).toContain("新门");
  });

  it("ignores approval request for other project", async () => {
    getFn.mockResolvedValue({ code: 0, data: null });
    mountModal();
    await flushPromises();
    expect(getFn).toHaveBeenCalledTimes(1);
    for (const cb of approvalRequestListeners) {
      cb({ type: "approval_gate", projectId: "other-project" });
    }
    await flushPromises();
    expect(getFn).toHaveBeenCalledTimes(1);
  });

  it("reloads when visible changes from false to true", async () => {
    getFn.mockResolvedValue({ code: 0, data: null });
    const w = mount(ApprovalGateModal, {
      props: { visible: false, projectId: "p1" },
    });
    await flushPromises();
    expect(getFn).not.toHaveBeenCalled();
    await w.setProps({ visible: true });
    await flushPromises();
    expect(getFn).toHaveBeenCalledWith("p1");
  });

  it("resets state when visible changes to false", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "script",
        status: "pending",
        requiredDecision: "approve",
        content: "内容",
        context: {},
      },
    });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-content").exists()).toBe(true);
    await w.setProps({ visible: false });
    await nextTick();
    // 再次打开时应重新加载
    getFn.mockResolvedValue({ code: 0, data: null });
    await w.setProps({ visible: true });
    await flushPromises();
    await nextTick();
    expect(w.find(".gate-empty").exists()).toBe(true);
  });

  it("handles missing electronAPI gracefully", async () => {
    delete window.electronAPI;
    const w = mountModal();
    await flushPromises();
    await nextTick();
    // 不崩溃，显示空状态（getFn 未调用）
    expect(w.find(".gate-empty").exists()).toBe(true);
  });

  it("shows approve failure error message", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    approveFn.mockResolvedValue({ code: -1, message: "审批失败" });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const approveBtn = w.findAll("button").find(b => b.text() === "通过");
    await approveBtn.trigger("click");
    await flushPromises();
    expect(w.find(".gate-error").exists()).toBe(true);
    expect(w.text()).toContain("审批失败");
  });

  it("disables approve button while submitting", async () => {
    getFn.mockResolvedValue({
      code: 0,
      data: {
        id: "g1",
        type: "scene_assets",
        status: "pending",
        requiredDecision: "approve",
        content: "",
        context: {},
      },
    });
    approveFn.mockReturnValue(new Promise(() => {})); // 永不resolve
    const w = mountModal();
    await flushPromises();
    await nextTick();
    const approveBtn = w.findAll("button").find(b => b.text() === "通过");
    await approveBtn.trigger("click");
    await nextTick();
    // 提交中按钮文本变化
    expect(approveBtn.text()).toContain("处理中");
  });

  it("does not call approve when no gate loaded", async () => {
    getFn.mockResolvedValue({ code: 0, data: null });
    const w = mountModal();
    await flushPromises();
    await nextTick();
    // 空状态下没有通过按钮
    const approveBtn = w.findAll("button").find(b => b.text() === "通过");
    expect(approveBtn).toBeUndefined();
    expect(approveFn).not.toHaveBeenCalled();
  });
});
