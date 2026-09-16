import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import i18n from "@/i18n";

const pushSpy = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushSpy }),
}));

const confirmDangerMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/utils/confirm-danger", () => ({
  confirmDanger: confirmDangerMock,
}));

import ProjectLibrary from "./ProjectLibrary.vue";

function mountProjectLibrary() {
  return mount(ProjectLibrary, { global: { plugins: [i18n] } });
}

describe("ProjectLibrary", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    delete window.electronAPI;
  });

  it("shows loading skeleton on mount", async () => {
    // Simulate slow loading — list never resolves
    window.electronAPI = {
      project: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    };
    const w = mountProjectLibrary();
    await nextTick();
    expect(w.find(".mp-skeleton-grid").exists()).toBe(true);
    expect(w.findAll(".mp-skeleton-card").length).toBe(6);
    // 统一骨架屏：每张卡片走 UiSkeleton 的 card 变体（骨块挂 .mp-skeleton-surface）
    expect(w.findAll('[data-testid="ui-skeleton"]').length).toBe(6);
    expect(w.findAll(".mp-skeleton-surface").length).toBeGreaterThan(0);
  });

  it("shows empty state when no projects", async () => {
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: [] }) },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    expect(w.find(".mp-empty-state").exists()).toBe(true);
    expect(w.text()).toContain("暂无项目");
  });

  it("shows error state on failure", async () => {
    window.electronAPI = {
      project: { list: vi.fn().mockRejectedValue(new Error("network down")) },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    expect(w.find(".error-state").exists()).toBe(true);
    expect(w.text()).toContain("network down");
  });

  it("shows retry button in error state", async () => {
    window.electronAPI = {
      project: { list: vi.fn().mockRejectedValue(new Error("fail")) },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain("重试");
  });

  it("displays project cards after loading", async () => {
    const mockProjects = [
      { id: "p1", name: "Project A", status: "draft" },
      { id: "p2", name: "Project B", status: "running" },
      { id: "p3", name: "Project C", status: "completed" },
    ];
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: mockProjects }) },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    expect(w.find(".project-grid").exists()).toBe(true);
    expect(w.findAll(".project-card").length).toBe(3);
    expect(w.text()).toContain("Project A");
    expect(w.text()).toContain("Project B");
    expect(w.text()).toContain("Project C");
  });

  // ─── 危险操作门禁（docs/frontend-interaction-spec.md §2）───
  // 删除项目不可逆：必须经 confirmDanger 二次确认，取消时不得调用底层删除 API。
  // 视图内自造确认弹窗已移除（交互原语唯一实现：ElMessageBox / confirmDanger）。

  it("删除走统一确认原语 confirmDanger，且视图内不再自造确认弹窗", async () => {
    confirmDangerMock.mockResolvedValue(true);
    window.electronAPI = {
      project: {
        list: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "p1", name: "Project A", status: "draft" }] }),
        del: vi.fn().mockResolvedValue({ code: 0 }),
      },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    await w.find(".delete-btn").trigger("click");
    await flushPromises();

    expect(confirmDangerMock).toHaveBeenCalledTimes(1);
    // 自造确认弹窗（.confirm-overlay / .confirm-dialog）必须归零
    expect(w.find(".confirm-overlay").exists()).toBe(false);
    expect(w.find(".confirm-dialog").exists()).toBe(false);
  });

  it("确认文案点名受影响项目并说明不可恢复", async () => {
    confirmDangerMock.mockResolvedValue(true);
    window.electronAPI = {
      project: {
        list: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "p1", name: "Project A", status: "draft" }] }),
        del: vi.fn().mockResolvedValue({ code: 0 }),
      },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    await w.find(".delete-btn").trigger("click");
    await flushPromises();

    const options = confirmDangerMock.mock.calls[0][0];
    // 结构类断言（QM-3）：与 i18n 期望值逐字相等，而非宽松子串
    expect(options.message).toBe(i18n.global.t("projectLibrary.deleteConfirmMessage", { name: "Project A" }));
    expect(options.title).toBe(i18n.global.t("projectLibrary.deleteConfirmTitle"));
    expect(options.confirmText).toBe(i18n.global.t("projectLibrary.deleteConfirmButton"));
    expect(options.message).toContain("Project A");
  });

  it("确认后调用一次删除 API", async () => {
    confirmDangerMock.mockResolvedValue(true);
    const delFn = vi.fn().mockResolvedValue({ code: 0 });
    window.electronAPI = {
      project: {
        list: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "p1", name: "Project A", status: "draft" }] }),
        del: delFn,
      },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    await w.find(".delete-btn").trigger("click");
    await flushPromises();

    expect(delFn).toHaveBeenCalledTimes(1);
    expect(delFn).toHaveBeenCalledWith("p1");
    expect(w.findAll(".project-card").length).toBe(0);
  });

  it("取消确认时不调用删除 API，项目仍在列表中", async () => {
    confirmDangerMock.mockResolvedValue(false);
    const delFn = vi.fn().mockResolvedValue({ code: 0 });
    const mockProjects = [{ id: "p1", name: "Project A", status: "draft" }];
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: mockProjects }), del: delFn },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    const before = [...w.vm.projects];

    await w.find(".delete-btn").trigger("click");
    await flushPromises();

    expect(confirmDangerMock).toHaveBeenCalledTimes(1);
    expect(delFn).not.toHaveBeenCalled();
    // 结构类断言（QM-3）：列表整体不变
    expect(w.vm.projects).toEqual(before);
    expect(w.findAll(".project-card").length).toBe(1);
  });

  it("取消后再次点击可重新确认并删除（取消不产生残留状态）", async () => {
    const delFn = vi.fn().mockResolvedValue({ code: 0 });
    window.electronAPI = {
      project: {
        list: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "p1", name: "Project A", status: "draft" }] }),
        del: delFn,
      },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();

    confirmDangerMock.mockResolvedValueOnce(false);
    await w.find(".delete-btn").trigger("click");
    await flushPromises();
    expect(delFn).not.toHaveBeenCalled();

    confirmDangerMock.mockResolvedValueOnce(true);
    await w.find(".delete-btn").trigger("click");
    await flushPromises();

    expect(confirmDangerMock).toHaveBeenCalledTimes(2);
    expect(delFn).toHaveBeenCalledTimes(1);
    expect(delFn).toHaveBeenCalledWith("p1");
  });

  it("retry button reloads projects", async () => {
    let callCount = 0;
    window.electronAPI = {
      project: {
        list: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error("fail"));
          return Promise.resolve({ code: 0, data: [{ id: "p1", name: "P1", status: "draft" }] });
        }),
      },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    expect(w.find(".error-state").exists()).toBe(true);
    // Click retry
    const buttons = w.findAll("button");
    const retryBtn = buttons.find(b => b.text() === "重试");
    await retryBtn.trigger("click");
    await flushPromises();
    await nextTick();
    expect(w.find(".project-grid").exists()).toBe(true);
    expect(w.text()).toContain("P1");
  });

  it("renders page title", () => {
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: [] }) },
    };
    const w = mountProjectLibrary();
    expect(w.text()).toContain("项目库");
  });
});
