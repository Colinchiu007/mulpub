import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

const pushSpy = vi.fn();
let mockRouteParams = { projectId: "p1" };
const approvalRequestListeners = new Set();

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: mockRouteParams }),
  useRouter: () => ({ push: pushSpy }),
}));

import ContactSheetView from "./ContactSheetView.vue";
import { config as vtuConfig } from '@vue/test-utils'
import i18n from '@/i18n'
vtuConfig.global.plugins = [i18n]

describe("ContactSheetView", () => {
  let listFn, approveFn, rejectFn, onApprovalFn;

  beforeEach(() => {
    vi.clearAllMocks();
    approvalRequestListeners.clear();
    mockRouteParams = { projectId: "p1" };
    listFn = vi.fn();
    approveFn = vi.fn();
    rejectFn = vi.fn();
    onApprovalFn = vi.fn((cb) => {
      approvalRequestListeners.add(cb);
      return () => approvalRequestListeners.delete(cb);
    });
    window.electronAPI = {
      contactSheet: {
        list: listFn,
        approve: approveFn,
        reject: rejectFn,
        onApprovalRequest: onApprovalFn,
      },
    };
  });

  it("renders page title and back link", async () => {
    listFn.mockResolvedValue({ code: 0, data: [] });
    const w = mount(ContactSheetView);
    await flushPromises();
    expect(w.find(".cs-title").text()).toBe("场景审批");
    const backLink = w.find(".back-link");
    expect(backLink.attributes("to")).toBe("/board/p1");
  });

  it("shows loading state initially", async () => {
    listFn.mockReturnValue(new Promise(() => {}));
    const w = mount(ContactSheetView);
    await nextTick();
    expect(w.find(".cs-loading").exists()).toBe(true);
  });

  it("shows empty state when no scenes", async () => {
    listFn.mockResolvedValue({ code: 0, data: [] });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    expect(w.find(".mp-empty-state").exists()).toBe(true);
    expect(w.text()).toContain("暂无待审批场景");
  });

  it("renders scene list with scenes", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [
        { id: "s1", index: 1, name: "Scene 1", status: "AWAITING", takes: [] },
        { id: "s2", index: 2, name: "Scene 2", status: "APPROVED", takes: [] },
      ],
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    expect(w.findAll(".scene-approval-card").length).toBe(2);
    expect(w.text()).toContain("Scene 1");
    expect(w.text()).toContain("Scene 2");
  });

  it("shows approval progress", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [
        { id: "s1", status: "APPROVED", takes: [] },
        { id: "s2", status: "AWAITING", takes: [] },
        { id: "s3", status: "APPROVED", takes: [] },
      ],
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    expect(w.find(".cs-progress").text()).toContain("2/3");
  });

  it("renders take thumbnails", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [{
        id: "s1", index: 1, name: "S1", status: "AWAITING",
        takes: [
          { id: "t1", thumbnail: "a.jpg", prompt: "p1", cost: 0.1, qualityScore: 8 },
          { id: "t2", thumbnail: "b.jpg", prompt: "p2", cost: 0.2, qualityScore: 7 },
        ],
      }],
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    const takeCards = w.findAll(".take-card");
    expect(takeCards.length).toBe(2);
    expect(takeCards[0].find("img").attributes("src")).toBe("a.jpg");
  });

  it("selects take on click", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [{
        id: "s1", index: 1, name: "S1", status: "AWAITING",
        takes: [{ id: "t1", thumbnail: "a.jpg" }],
      }],
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    await w.find(".take-card").trigger("click");
    expect(w.find(".take-card").classes()).toContain("selected");
  });

  it("approves scene via IPC", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [{
        id: "s1", index: 1, name: "S1", status: "AWAITING",
        takes: [{ id: "t1", thumbnail: "a.jpg" }],
      }],
    });
    approveFn.mockResolvedValue({
      code: 0,
      data: { approved: true, scene: { id: "s1", status: "APPROVED", selectedTakeId: "t1" } },
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    // Select take first
    await w.find(".take-card").trigger("click");
    // Click approve
    const approveBtn = w.findAll("button").find(b => b.text().includes("批准"));
    await approveBtn.trigger("click");
    await flushPromises();
    expect(approveFn).toHaveBeenCalledWith("s1", "t1");
  });

  it("reject scene shows feedback input", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [{ id: "s1", index: 1, name: "S1", status: "AWAITING", takes: [] }],
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    const rejectBtn = w.findAll("button").find(b => b.text() === "驳回");
    await rejectBtn.trigger("click");
    expect(w.find(".reject-input").exists()).toBe(true);
  });

  it("rejects scene via IPC", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [{ id: "s1", index: 1, name: "S1", status: "AWAITING", takes: [] }],
    });
    rejectFn.mockResolvedValue({
      code: 0,
      data: { rejected: true, requeued: true, scene: { id: "s1", status: "QUEUED", takes: [] } },
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    // Toggle reject input
    const rejectBtn = w.findAll("button").find(b => b.text() === "驳回");
    await rejectBtn.trigger("click");
    // Click confirm
    const confirmBtn = w.findAll("button").find(b => b.text() === "确认驳回");
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(rejectFn).toHaveBeenCalledWith("s1", "");
  });

  it("registers onApprovalRequest listener on mount", async () => {
    listFn.mockResolvedValue({ code: 0, data: [] });
    mount(ContactSheetView);
    await flushPromises();
    expect(onApprovalFn).toHaveBeenCalledTimes(1);
  });

  it("refreshes on approval:request push", async () => {
    listFn.mockResolvedValue({ code: 0, data: [] });
    const w = mount(ContactSheetView);
    await flushPromises();
    // Simulate approval push
    listFn.mockResolvedValue({ code: 0, data: [{ id: "s1", status: "AWAITING", takes: [] }] });
    for (const cb of approvalRequestListeners) {
      cb({ type: "contact_sheet", projectId: "p1", sceneId: "s1" });
    }
    await flushPromises();
    await nextTick();
    expect(listFn).toHaveBeenCalledTimes(2);
    expect(w.findAll(".scene-approval-card").length).toBe(1);
  });

  it("ignores approval push for other project", async () => {
    listFn.mockResolvedValue({ code: 0, data: [] });
    const w = mount(ContactSheetView);
    await flushPromises();
    const initialCallCount = listFn.mock.calls.length;
    for (const cb of approvalRequestListeners) {
      cb({ type: "contact_sheet", projectId: "other", sceneId: "s1" });
    }
    await flushPromises();
    expect(listFn.mock.calls.length).toBe(initialCallCount);
  });

  it("shows error state on list failure", async () => {
    listFn.mockRejectedValue(new Error("network down"));
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    expect(w.find(".cs-error").exists()).toBe(true);
    expect(w.text()).toContain("network down");
  });

  it("shows all status badges correctly", async () => {
    const statuses = ["QUEUED", "GENERATING", "AWAITING", "APPROVED", "REJECTED", "FAILED"];
    listFn.mockResolvedValue({
      code: 0,
      data: statuses.map((s, i) => ({ id: "s" + i, index: i + 1, name: "S" + i, status: s, takes: [] })),
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    const badges = w.findAll(".scene-status-badge");
    expect(badges.length).toBe(6);
    expect(badges[0].text()).toBe("队列中");
    expect(badges[1].text()).toBe("生成中");
    expect(badges[2].text()).toBe("待审批");
    expect(badges[3].text()).toBe("已批准");
    expect(badges[4].text()).toBe("已驳回");
    expect(badges[5].text()).toBe("失败");
  });

  it("shows awaiting card with orange border", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [{ id: "s1", index: 1, name: "S1", status: "AWAITING", takes: [] }],
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    expect(w.find(".scene-approval-card").classes()).toContain("awaiting");
  });

  it("approve button disabled when no take selected", async () => {
    listFn.mockResolvedValue({
      code: 0,
      data: [{
        id: "s1", index: 1, name: "S1", status: "AWAITING",
        takes: [{ id: "t1", thumbnail: "a.jpg" }],
      }],
    });
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    const approveBtn = w.findAll("button").find(b => b.text().includes("批准"));
    expect(approveBtn.attributes("disabled")).toBeDefined();
  });

  it("handles missing electronAPI gracefully", async () => {
    delete window.electronAPI;
    const w = mount(ContactSheetView);
    await flushPromises();
    await nextTick();
    expect(w.find(".mp-empty-state").exists()).toBe(true);
  });
});
