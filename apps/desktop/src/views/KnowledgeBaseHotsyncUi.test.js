// 知识库「爆款库/模式分析/个人知识库」视图一致性 + 手动添加爆款弹窗入口（kb-hotsync-ui-fix 2026-09-21）
// 1) 三个标签在任何 activeTab 下都恒定渲染（修复：个人知识库视图缺"模式分析"标签）
// 2) ViralFormDialog 标题"手动添加爆款"+ 标题右侧【用链接采集】入口，点击关闭弹窗并跳转采集页
// 3) 个人知识库视图【添加知识】按钮文案改为"添加内容"
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

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
  PERSONAL_CATEGORIES: [],
  PERSONAL_CATEGORY_LABELS: {},
}));

vi.mock("@/api/electron-bridge", () => ({
  getApi: () => null,
}));

// 子面板/子弹窗以轻量桩替换：避免 element-plus 内部渲染（el-table/el-drawer/v-loading）干扰标签与入口断言
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
import ViralFormDialog from "@/components/ViralFormDialog.vue";

function mountPage() {
  return mount(KnowledgeBasePage, { global: { plugins: [i18n] } });
}

function tabTexts(w) {
  return w.findAll(".kb-tab-btn").map(b => b.text());
}

async function clickTab(w, label) {
  const btn = w.findAll(".kb-tab-btn").find(b => b.text() === label);
  expect(btn, `标签「${label}」应存在`).toBeTruthy();
  await btn.trigger("click");
}

describe("KnowledgeBasePage 标签视图一致性", () => {
  beforeEach(() => pushMock.mockClear());

  it("默认（爆款库）视图显示 3 个标签", () => {
    const w = mountPage();
    expect(tabTexts(w)).toEqual(["爆款库", "模式分析", "个人知识库"]);
  });

  it("切到个人知识库标签后仍显示 3 个标签（含模式分析）", async () => {
    const w = mountPage();
    await clickTab(w, "个人知识库");
    expect(tabTexts(w)).toEqual(["爆款库", "模式分析", "个人知识库"]);
  });

  it("切到模式分析标签后仍显示 3 个标签", async () => {
    const w = mountPage();
    await clickTab(w, "模式分析");
    expect(tabTexts(w)).toHaveLength(3);
  });

  it("个人知识库视图的添加按钮文案为「添加内容」", async () => {
    const w = mountPage();
    await clickTab(w, "个人知识库");
    const addBtn = w.find(".page-actions .cohere-btn-primary");
    expect(addBtn.text()).toContain("添加内容");
    expect(addBtn.text()).not.toContain("添加知识");
  });
});

describe("ViralFormDialog 手动添加爆款", () => {
  it("新增模式标题为「手动添加爆款」", () => {
    const w = mount(ViralFormDialog, { global: { plugins: [i18n] } });
    expect(w.find(".dialog-title").text()).toBe("手动添加爆款");
  });

  it("编辑模式标题仍为「编辑」，且不显示采集入口", () => {
    const w = mount(ViralFormDialog, {
      global: { plugins: [i18n] },
      props: { item: { id: "v1", title: "t", content: "c" } },
    });
    expect(w.find(".dialog-title").text()).toBe("编辑");
    expect(w.find("[data-testid='viral-form-collect-link']").exists()).toBe(false);
  });

  it("标题右侧显示「用链接采集」入口", () => {
    const w = mount(ViralFormDialog, { global: { plugins: [i18n] } });
    const link = w.find("[data-testid='viral-form-collect-link']");
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain("用链接采集");
  });

  it("点击「用链接采集」emit collect 事件", async () => {
    const w = mount(ViralFormDialog, { global: { plugins: [i18n] } });
    await w.find("[data-testid='viral-form-collect-link']").trigger("click");
    expect(w.emitted("collect")).toHaveLength(1);
  });
});

describe("KnowledgeBasePage 用链接采集跳转", () => {
  beforeEach(() => pushMock.mockClear());

  it("弹窗触发 collect 后关闭弹窗并跳转 /collection", async () => {
    const w = mountPage();
    await w.find(".page-actions .cohere-btn-primary").trigger("click");
    const dialog = w.findComponent(ViralFormDialog);
    expect(dialog.exists()).toBe(true);
    dialog.vm.$emit("collect");
    await w.vm.$nextTick();
    expect(pushMock).toHaveBeenCalledWith("/collection");
    expect(w.findComponent(ViralFormDialog).exists()).toBe(false);
  });
});
