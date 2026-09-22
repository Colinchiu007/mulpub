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
  getPatternQueueStats: vi.fn().mockResolvedValue({ code: 0, data: { pending: 0, deferred: 0 } }),
}));

vi.mock("@/components/ViralFormDialog.vue", () => ({
  default: { name: "ViralFormDialog", props: ["item"], template: "<div />" },
}));

import ViralLibraryTable from "./ViralLibraryTable.vue";
import { listViralItems, getPatternQueueStats } from "@/api/knowledge-library";
import i18n from "@/i18n";

// P1 显示契约（viral-library-integration PR-2）：F-205 回采 tooltip / F-204 页头 backlog 提示条
describe("ViralLibraryTable P1 显示契约", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPatternQueueStats.mockResolvedValue({ code: 0, data: { pending: 0, deferred: 0 } });
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

  const base = { id: "v1", title: "t", content: "c", tags: [] };

  it("U-223a: source=collection 且 updated_at>created_at → 标题单元格带回采 tooltip", async () => {
    const w = mountTable([{ ...base, source: "collection", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z" }]);
    await flushPromises(); await nextTick();
    const td = w.findAll("tbody tr")[0].findAll("td")[1];
    expect(td.attributes("title")).toContain(i18n.global.t("knowledgeBase.engagementRecrawled"));
    expect(td.attributes("title")).toContain("2026-09-20");
  });

  it("U-223b: 未回采（updated_at==created_at）→ 无 tooltip", async () => {
    const same = "2026-09-01T00:00:00.000Z";
    const w = mountTable([{ ...base, source: "collection", created_at: same, updated_at: same }]);
    await flushPromises(); await nextTick();
    const td = w.findAll("tbody tr")[0].findAll("td")[1];
    expect(td.attributes("title")).toBeUndefined();
  });

  it("U-223c: manual 行时间不同也不显示（仅采集链路视为回采）", async () => {
    const w = mountTable([{ ...base, source: "manual", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z" }]);
    await flushPromises(); await nextTick();
    expect(w.findAll("tbody tr")[0].findAll("td")[1].attributes("title")).toBeUndefined();
  });
});
