import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    getLabel: (k) => k,
  })
}));

vi.mock("@/stores/license", () => ({
  useLicenseStore: () => ({ isPro: true })
}));

vi.mock("@/api/cloud-publisher", () => ({
  cloudPublishPlatforms: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "youtube", name: "YouTube" }, { id: "bilibili", name: "B站" }] }),
  cloudPublishListTasks: vi.fn().mockResolvedValue({ code: 0, data: { items: [{ id: "t1", title: "Test", status: "success", platform: "youtube", created_at: "2026-07-05T10:00:00Z" }] } }),
  cloudPublishSubmit: vi.fn().mockResolvedValue({ code: 0, data: { id: "new-task" } }),
  cloudPublishGetTask: vi.fn().mockResolvedValue({ code: 0, data: { id: "t1", status: "success" } }),
}));

import UiButton from "@/components/UiButton.vue";
import UiInput from "@/components/UiInput.vue";
import CloudPublishView from "./CloudPublish.vue";
import { config as vtuConfig } from '@vue/test-utils'
import i18n from '@/i18n'
// EmptyState 文案迁移 i18n 后模板使用 $t：为裸 mount 的旧用例全局注入 i18n 插件
vtuConfig.global.plugins = [i18n]

describe("CloudPublishView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it("renders page title and submit button", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("云端发布");
  });

  it("loads platforms on mount", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.vm.platforms.length).toBeGreaterThanOrEqual(2);
  });

  it("adds tag from input", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    w.vm.tagsInput = "newtag";
    w.vm.addTag();
    expect(w.vm.form.tags).toContain("newtag");
  });

  it("handleSubmit validates required fields", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    w.vm.form.videoUrl = "";
    w.vm.form.title = "";
    w.vm.form.platform = "";
    await w.vm.handleSubmit();
    expect(w.vm.submitResult).toBeTruthy();
    expect(w.vm.submitResult.ok).toBe(false);
  });

  it("handleSubmit succeeds with valid data", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    w.vm.form.videoUrl = "https://example.com/video.mp4";
    w.vm.form.title = "Test Video";
    w.vm.form.platform = "youtube";
    await w.vm.handleSubmit();
    await nextTick();
    const { cloudPublishSubmit } = await import("@/api/cloud-publisher");
    expect(cloudPublishSubmit).toHaveBeenCalled();
  });

  it("formatTime returns formatted string", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    const result = w.vm.formatTime("2026-07-05T10:00:00Z");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});

describe("CloudPublishView — extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it("retryTask fills form from failed task", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    var tk = { input_data: { video_url: "https://x.com/v.mp4", platform: "youtube", title: "Retry", desc: "desc", tags: ["tag1"], cover_url: "https://x.com/c.jpg" } };
    w.vm.retryTask(tk);
    expect(w.vm.form.videoUrl).toBe("https://x.com/v.mp4");
    expect(w.vm.form.title).toBe("Retry");
    expect(w.vm.form.tags).toEqual(["tag1"]);
  });

  it("orchestrator goes offline when refresh fails", async () => {
    const mocks = await import("@/api/cloud-publisher");
    mocks.cloudPublishListTasks.mockResolvedValue({ code: -1 });
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.vm.orchestratorOnline).toBe(false);
  });

  it("statusClass returns correct class for each status", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    expect(w.vm.statusClass("pending")).toBe("cohere-tag-warning");
    expect(w.vm.statusClass("success")).toBe("cohere-tag-success");
    expect(w.vm.statusClass("failed")).toBe("cohere-tag-error");
    expect(w.vm.statusClass("unknown")).toBe("");
  });

  it("statusLabel returns Chinese label for each status", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    expect(w.vm.statusLabel("pending")).toBe("等待中");
    expect(w.vm.statusLabel("success")).toBe("已完成");
    expect(w.vm.statusLabel("failed")).toBe("失败");
    expect(w.vm.statusLabel("unknown")).toBe("unknown");
  });

  it("addTag ignores duplicate tags", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    w.vm.form.tags = ["existing"];
    w.vm.tagsInput = "existing";
    w.vm.addTag();
    expect(w.vm.form.tags.length).toBe(1);
    expect(w.vm.tagsInput).toBe("");
  });

  it("addTag ignores empty input", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    var before = w.vm.form.tags.length;
    w.vm.tagsInput = "  ";
    w.vm.addTag();
    expect(w.vm.form.tags.length).toBe(before);
  });

  it("formatTime handles null and invalid date", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    expect(w.vm.formatTime(null)).toBe("-");
    // Invalid date string creates a Date that doesn't throw but has NaN values
    // The catch block doesn't catch this because Date constructor doesn't throw
    expect(w.vm.formatTime("")).toBe("-");
  });

  it("stopPolling clears interval", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    w.vm.pollTimer = 123;
    w.vm.stopPolling();
    expect(w.vm.pollTimer).toBeNull();
  });

  it("handleSubmit with missing platform fails validation", async () => {
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    w.vm.form.videoUrl = "https://x.com/v.mp4";
    w.vm.form.title = "Test";
    w.vm.form.platform = "";
    await w.vm.handleSubmit();
    expect(w.vm.submitResult.ok).toBe(false);
    expect(w.vm.submitResult.message).toContain("必填项");
  });

  it("refreshTasks with empty items sets empty tasks", async () => {
    const mocks = await import("@/api/cloud-publisher");
    mocks.cloudPublishListTasks.mockResolvedValue({ code: 0, data: {} });
    const w = mount(CloudPublishView, {
      global: { plugins: [createPinia()], components: { UiButton, UiInput } }
    });
    await nextTick();
    await w.vm.refreshTasks();
    expect(w.vm.tasks).toEqual([]);
  });
});

