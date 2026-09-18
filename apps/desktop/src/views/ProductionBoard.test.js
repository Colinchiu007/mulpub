import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick, ref } from "vue";

const pushSpy = vi.fn();
const subscribeSpy = vi.fn().mockResolvedValue(undefined);
const unsubscribeSpy = vi.fn().mockResolvedValue(undefined);

// Mock vue-router
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { projectId: "p1" } }),
  useRouter: () => ({ push: pushSpy }),
}));

// Mock useLiveBoard composable — we control the board ref directly
let mockBoardRef = ref(null);
vi.mock("@/composables/useBacklot", () => ({
  useLiveBoard: () => ({
    board: mockBoardRef,
    subscribedProjectId: ref(null),
    subscribe: subscribeSpy,
    unsubscribe: unsubscribeSpy,
    refresh: vi.fn(),
  }),
}));

import ProductionBoard from "./ProductionBoard.vue";
import { config as vtuConfig } from '@vue/test-utils'
import i18n from '@/i18n'
vtuConfig.global.plugins = [i18n]

describe("ProductionBoard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockBoardRef = ref(null);
  });

  it("renders board page structure", async () => {
    const w = mount(ProductionBoard);
    await flushPromises();
    expect(w.find(".board-page").exists()).toBe(true);
    expect(w.find(".board-header").exists()).toBe(true);
    expect(w.find(".back-link").exists()).toBe(true);
    expect(w.find(".board-title").exists()).toBe(true);
  });

  it("shows back link to library", async () => {
    const w = mount(ProductionBoard);
    await flushPromises();
    const backLink = w.find(".back-link");
    expect(backLink.attributes("to")).toBe("/library");
    expect(backLink.text()).toContain("项目库");
  });

  it("shows loading state before board arrives", async () => {
    const w = mount(ProductionBoard);
    await nextTick();
    // Before subscribe resolves, loading should be true and no board
    expect(w.find(".board-loading").exists()).toBe(true);
  });

  it("shows empty state when board is null after load", async () => {
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".mp-empty-state").exists()).toBe(true);
    expect(w.text()).toContain("暂无看板数据");
  });

  it("calls subscribe on mount", async () => {
    mount(ProductionBoard);
    await flushPromises();
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it("calls unsubscribe on unmount", async () => {
    const w = mount(ProductionBoard);
    await flushPromises();
    w.unmount();
    await flushPromises();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it("renders board title from board.projectName", async () => {
    mockBoardRef.value = {
      projectName: "我的视频项目",
      stages: [],
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-title").text()).toBe("我的视频项目");
  });

  it("renders default title when projectName missing", async () => {
    mockBoardRef.value = { stages: [], scenes: [], status: "running" };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-title").text()).toBe("生产看板");
  });

  it("renders stages section when stages present", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: ["script", "scenes", "render"],
      currentStageIndex: 1,
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-stages").exists()).toBe(true);
    // BoardStageIndicator renders stage nodes
    expect(w.findAll(".stage-node").length).toBe(3);
  });

  it("hides stages section when no stages", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-stages").exists()).toBe(false);
  });

  it("renders scenes grid with SceneCard components", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [
        { id: "s1", index: 1, name: "Scene 1", status: "COMPLETED" },
        { id: "s2", index: 2, name: "Scene 2", status: "AWAITING" },
      ],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".scene-grid").exists()).toBe(true);
    expect(w.findAll(".scene-card").length).toBe(2);
  });

  it("shows no-scenes message when scenes array is empty", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: ["script"],
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".mp-empty-state").exists()).toBe(true);
  });

  it("shows total cost when present", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      totalEstimatedCost: 12.5,
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-cost").text()).toContain("12.5");
  });

  it("hides total cost when missing", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-cost").exists()).toBe(false);
  });

  it("shows elapsed time when present", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      elapsed: "5m 30s",
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-elapsed").text()).toContain("5m 30s");
  });

  it("shows replay button when status is completed", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "completed",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    const replayBtn = w.findAll("button").find(b => b.text().includes("查看回放"));
    expect(replayBtn).toBeTruthy();
  });

  it("hides replay button when status is not completed", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    const replayBtn = w.findAll("button").find(b => b.text().includes("查看回放"));
    expect(replayBtn).toBeFalsy();
  });

  it("navigates to replay when replay button clicked", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "completed",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    const replayBtn = w.findAll("button").find(b => b.text().includes("查看回放"));
    await replayBtn.trigger("click");
    expect(pushSpy).toHaveBeenCalledWith("/replay/p1");
  });

  it("navigates to contact-sheet on scene select", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [{ id: "s1", index: 1, name: "S1", status: "AWAITING" }],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    await w.find(".scene-card").trigger("click");
    expect(pushSpy).toHaveBeenCalledWith("/board/p1/contact-sheet");
  });

  it("renders sidebar with currentOperation", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      currentOperation: "正在生成场景 1",
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-sidebar").exists()).toBe(true);
    expect(w.find(".info-value").text()).toBe("正在生成场景 1");
  });

  it("hides sidebar when no currentOperation and no event log", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.find(".board-sidebar").exists()).toBe(false);
  });

  it("records event log on currentOperation change", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      currentOperation: "操作 A",
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    // Update currentOperation
    mockBoardRef.value = { ...mockBoardRef.value, currentOperation: "操作 B" };
    await nextTick();
    await flushPromises();
    const eventItems = w.findAll(".event-item");
    expect(eventItems.length).toBeGreaterThanOrEqual(1);
    expect(w.text()).toContain("操作 B");
  });

  it("caps event log at 20 entries", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      currentOperation: "op0",
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    // Push 25 operations
    for (let i = 1; i <= 25; i++) {
      mockBoardRef.value = { ...mockBoardRef.value, currentOperation: "op" + i };
      await nextTick();
    }
    const eventItems = w.findAll(".event-item");
    expect(eventItems.length).toBeLessThanOrEqual(20);
  });

  // ─── 审批门集成测试 ───

  it("hides approval gate button when no pending gates", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
      pendingGates: 0,
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    const gateBtn = w.findAll("button").find(b => b.text().includes("审批门"));
    expect(gateBtn).toBeUndefined();
  });

  it("shows approval gate button when pendingGates > 0", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
      pendingGates: 2,
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    const gateBtn = w.findAll("button").find(b => b.text().includes("审批门"));
    expect(gateBtn).toBeTruthy();
    expect(gateBtn.text()).toContain("2");
  });

  it("opens approval gate modal on button click", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
      pendingGates: 1,
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    const gateBtn = w.findAll("button").find(b => b.text().includes("审批门"));
    await gateBtn.trigger("click");
    await nextTick();
    // ApprovalGateModal 组件应存在
    expect(w.findComponent({ name: "ApprovalGateModal" }).exists()).toBe(true);
  });

  it("includes ApprovalGateModal component", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    expect(w.findComponent({ name: "ApprovalGateModal" }).exists()).toBe(true);
  });

  it("records event log on gate resolved", async () => {
    mockBoardRef.value = {
      projectName: "P",
      stages: [],
      scenes: [],
      status: "running",
      pendingGates: 1,
    };
    const w = mount(ProductionBoard);
    await flushPromises();
    await nextTick();
    // 打开弹窗
    const gateBtn = w.findAll("button").find(b => b.text().includes("审批门"));
    await gateBtn.trigger("click");
    await nextTick();
    // 触发 resolved 事件
    const modal = w.findComponent({ name: "ApprovalGateModal" });
    modal.vm.$emit("resolved");
    await nextTick();
    expect(w.text()).toContain("审批门已处理");
  });
});
