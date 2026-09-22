import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: { template: '<div class="el-dialog"><slot></slot></div>' },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/api/knowledge-library", () => ({
  addViralToLibrary: vi.fn().mockResolvedValue({ code: 0, data: { id: "v1" } }),
}));

import CollectionView from "./Collection.vue";
import { addViralToLibrary } from "@/api/knowledge-library";
import i18n from "@/i18n";

// P0 契约（viral-library-integration）：采集结果 engagement/发布时间必须透传进爆款库；
// 未知一律 undefined（store 侧存 NULL），严禁在渲染端压平为 0。
describe("CollectionView addCollectedToViral P0 契约透传", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    addViralToLibrary.mockResolvedValue({ code: 0, data: { id: "v1" } });
  });

  function mountCollection() {
    return mount(CollectionView, { global: { plugins: [createPinia(), i18n] } });
  }

  it("engagement 有值 → likes/comments 原样透传，publishTime 进 published_at", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = {
      title: "爆款一", content: "正文", sourceUrl: "https://example.com/1",
      engagement: { likes: 3000, comments: 200 },
      publishTime: "2026-09-20T10:00:00.000Z",
    };
    await w.vm.addCollectedToViral();
    expect(addViralToLibrary).toHaveBeenCalledWith(expect.objectContaining({
      likes: 3000, comments: 200, published_at: "2026-09-20T10:00:00.000Z",
    }));
  });

  it("engagement 缺失 → likes/comments 为 undefined（不是 0），由 store 存 NULL", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "未知互动", content: "正文", sourceUrl: "https://example.com/2" };
    await w.vm.addCollectedToViral();
    const arg = addViralToLibrary.mock.calls[0][0];
    expect(arg.likes).toBeUndefined();
    expect(arg.comments).toBeUndefined();
  });

  it("engagement 字段级 null（解析失败）→ 透传 undefined 而非 0", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = {
      title: "解析失败", content: "正文", sourceUrl: "https://example.com/3",
      engagement: { likes: null, comments: null },
    };
    await w.vm.addCollectedToViral();
    const arg = addViralToLibrary.mock.calls[0][0];
    expect(arg.likes).toBeUndefined();
    expect(arg.comments).toBeUndefined();
  });
});
