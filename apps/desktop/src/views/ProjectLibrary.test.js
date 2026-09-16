import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import i18n from "@/i18n";

const pushSpy = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushSpy }),
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
    const empty = w.get('[data-testid="project-library-empty"]');
    expect(empty.classes()).toContain("mp-empty-state");
    expect(empty.get(".mp-empty-state__title").text()).toBe(i18n.global.t("projectLibrary.empty.title"));
    expect(empty.text()).toContain(i18n.global.t("projectLibrary.empty.message"));
  });

  it("empty state CTA navigates to the pipeline page", async () => {
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: [] }) },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();

    await w.get('[data-testid="project-library-empty"] button.mp-empty-state__action').trigger("click");
    expect(pushSpy).toHaveBeenCalledWith("/create");
  });

  it("does not render empty state when projects exist", async () => {
    window.electronAPI = {
      project: {
        list: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "p1", name: "项目一" }] }),
      },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();

    expect(w.find('[data-testid="project-library-empty"]').exists()).toBe(false);
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

  it("shows delete confirmation when delete emitted", async () => {
    const mockProjects = [
      { id: "p1", name: "Project A", status: "draft" },
    ];
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: mockProjects }) },
      project_del: vi.fn(),
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    // Click delete button on the card
    await w.find(".delete-btn").trigger("click");
    expect(w.find(".confirm-dialog").exists()).toBe(true);
    expect(w.text()).toContain("Project A");
  });

  it("cancels delete when cancel clicked", async () => {
    const mockProjects = [
      { id: "p1", name: "Project A", status: "draft" },
    ];
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: mockProjects }) },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    await w.find(".delete-btn").trigger("click");
    expect(w.find(".confirm-dialog").exists()).toBe(true);
    // Click cancel
    const buttons = w.findAll("button");
    const cancelBtn = buttons.find(b => b.text() === "取消");
    await cancelBtn.trigger("click");
    expect(w.find(".confirm-dialog").exists()).toBe(false);
  });

  it("confirms delete and calls electronAPI.project.del", async () => {
    const mockProjects = [
      { id: "p1", name: "Project A", status: "draft" },
    ];
    const delFn = vi.fn().mockResolvedValue({ code: 0 });
    window.electronAPI = {
      project: { list: vi.fn().mockResolvedValue({ code: 0, data: mockProjects }), del: delFn },
    };
    const w = mountProjectLibrary();
    await flushPromises();
    await nextTick();
    await w.find(".delete-btn").trigger("click");
    // Click delete confirm
    const buttons = w.findAll("button");
    const deleteBtn = buttons.find(b => b.text() === "删除");
    await deleteBtn.trigger("click");
    await flushPromises();
    expect(delFn).toHaveBeenCalledWith("p1");
    expect(w.find(".confirm-dialog").exists()).toBe(false);
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
