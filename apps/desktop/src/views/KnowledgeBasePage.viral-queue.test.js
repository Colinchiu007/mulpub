// F-204（PR-2）：爆款库 tab 页头 deferred>0 提示条接线（AC-P1-3 页头部分；挂载配方复用 KnowledgeBaseHotsyncUi.test.js）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@/api/knowledge-library", () => ({
  listViralItems: vi.fn().mockResolvedValue({ code: 0, data: { items: [], total: 0 } }),
  listPatternCards: vi.fn().mockResolvedValue({ code: 0, data: { items: [], total: 0 } }),
  listPersonalItems: vi.fn().mockResolvedValue({ code: 0, data: { items: [], total: 0 } }),
  addViralToLibrary: vi.fn(),
  updateViralItem: vi.fn(),
  addPersonalToLibrary: vi.fn(),
  updatePersonalItem: vi.fn(),
  importFiles: vi.fn(),
  exportViralToFeishu: vi.fn(),
  exportPersonalToFeishu: vi.fn(),
  getPatternQueueStats: vi.fn().mockResolvedValue({ code: 0, data: { pending: 0, deferred: 0 } }),
  PERSONAL_CATEGORIES: [],
  PERSONAL_CATEGORY_LABELS: {},
}));

vi.mock("@/api/electron-bridge", () => ({
  getApi: () => null,
}));

vi.mock("@/components/ViralLibraryTable.vue", () => ({
  default: { name: "ViralLibraryTable", template: "<div data-testid='stub-viral' />", methods: { loadData() {} } },
}));
vi.mock("@/components/PatternAnalysisPanel.vue", () => ({
  default: { name: "PatternAnalysisPanel", template: "<div data-testid='stub-pattern' />", methods: { loadData() {} } },
}));
vi.mock("@/components/PersonalKnowledgePanel.vue", () => ({
  default: { name: "PersonalKnowledgePanel", template: "<div data-testid='stub-personal' />", methods: { loadData() {} } },
}));
vi.mock("@/components/PersonalFormDialog.vue", () => ({
  default: { name: "PersonalFormDialog", template: "<div data-testid='stub-personal-dialog' />" },
}));

const pushMock = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import i18n from "@/i18n";
import KnowledgeBasePage from "@/views/KnowledgeBasePage.vue";
import { getPatternQueueStats } from "@/api/knowledge-library";

describe("KnowledgeBasePage 队列提示条接线（U-224c）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockClear();
    getPatternQueueStats.mockResolvedValue({ code: 0, data: { pending: 500, deferred: 7 } });
  });

  it("U-224c: deferred>0 且 viral tab（默认）→ 提示条渲染于页头、含条数", async () => {
    const w = mount(KnowledgeBasePage, { global: { plugins: [i18n] } });
    await flushPromises(); await nextTick();
    const bar = w.find('[data-testid="pattern-queue-backlog"]');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain("7");
    expect(bar.text()).toContain(i18n.global.t("knowledgeBase.patternQueueBacklog", { n: 7 }));
  });
});
