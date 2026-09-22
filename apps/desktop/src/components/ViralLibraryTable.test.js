import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/api/knowledge-library", () => ({
  listViralItems: vi.fn().mockResolvedValue({ code: 0, data: { items: [], total: 0 } }),
  deleteViralItem: vi.fn().mockResolvedValue({ code: 0 }),
}));

vi.mock("@/components/ViralFormDialog.vue", () => ({
  default: { name: "ViralFormDialog", props: ["item"], template: "<div />" },
}));

import ViralLibraryTable from "./ViralLibraryTable.vue";
import { listViralItems } from "@/api/knowledge-library";
import i18n from "@/i18n";

// P0 契约显示项（viral-library-integration F-107）：NULL=未知 显示 '-'，真 0 显示 '0'。
// 互动列 td 索引：6=likes 7=collections 8=comments 9=ratio 10=published_at。
describe("ViralLibraryTable NULL/0 显示契约", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountTable(items) {
    listViralItems.mockResolvedValue({ code: 0, data: { items, total: items.length } });
    return mount(ViralLibraryTable, {
      global: {
        plugins: [i18n],
        stubs: { UiSkeleton: true, EmptyState: true, ElTag: true, "el-tag": true, ViralFormDialog: true },
      },
    });
  }

  it("likes/collections/comments/ratio 为 null → 显示 '-'（不得伪造 0）", async () => {
    const w = mountTable([{
      id: "v1", title: "未知互动", content: "c", tags: [], author: "a", platform: "zhihu",
      likes: null, collections: null, comments: null, like_collect_ratio: null, published_at: "",
    }]);
    await flushPromises();
    await nextTick();
    const tds = w.findAll("tbody tr")[0].findAll("td");
    expect(tds[6].text()).toBe("-");
    expect(tds[7].text()).toBe("-");
    expect(tds[8].text()).toBe("-");
    expect(tds[9].text()).toBe("-");
    expect(tds[10].text()).toBe("-");
  });

  it("真 0 → 如实显示 0（ratio 0 → 0.0）", async () => {
    const w = mountTable([{
      id: "v2", title: "零互动", content: "c", tags: [], author: "a", platform: "zhihu",
      likes: 0, collections: 0, comments: 0, like_collect_ratio: 0, published_at: "",
    }]);
    await flushPromises();
    await nextTick();
    const tds = w.findAll("tbody tr")[0].findAll("td");
    expect(tds[6].text()).toBe("0");
    expect(tds[7].text()).toBe("0");
    expect(tds[8].text()).toBe("0");
    expect(tds[9].text()).toBe("0.0");
  });

  it("published_at 有值 → 显示日期前 10 位", async () => {
    const w = mountTable([{
      id: "v3", title: "有日期", content: "c", tags: [], likes: null, collections: null, comments: null,
      like_collect_ratio: null, published_at: "2026-09-20T10:00:00.000Z", platform: "x",
    }]);
    await flushPromises();
    await nextTick();
    const tds = w.findAll("tbody tr")[0].findAll("td");
    expect(tds[10].text()).toBe("2026-09-20");
  });
});
