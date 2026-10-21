import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/i18n";
import { nextTick } from "vue";

const publisherApi = vi.hoisted(() => ({
  modelProviderIsConfigured: vi.fn((category) => window.electronAPI?.modelProviderIsConfigured?.(category)),
  aiIsConfigured: vi.fn(() => window.electronAPI?.aiIsConfigured?.()),
  aiGenerateTitles: vi.fn((topic) => window.electronAPI?.aiGenerateTitles?.(topic)),
  aiEnhanceContent: vi.fn((content, style) => window.electronAPI?.aiEnhanceContent?.(content, style)),
  aiGenerateSummary: vi.fn((content) => window.electronAPI?.aiGenerateSummary?.(content)),
  aiRewrite: vi.fn((params) => window.electronAPI?.aiRewrite?.(params)),
  aiListRewriteStrategies: vi.fn(() => window.electronAPI?.aiListRewriteStrategies?.()),
  aiGetRecommendedStrategies: vi.fn((settings) => window.electronAPI?.aiGetRecommendedStrategies?.(settings)),
  applyKnowledgeFeedback: vi.fn((action, refs) => window.electronAPI?.applyKnowledgeFeedback?.(action, refs)),
}));

const mockEnsureLogin = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/api/publisher", () => publisherApi);

vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: mockEnsureLogin,
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { path: "/" } }
  })
}));

import AiWriterPanel from "./AiWriterPanel.vue";

// Helper: wait for async onMounted checkConfig to complete
async function waitConfig() {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
}

describe("AiWriterPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = {
      aiIsConfigured: vi.fn(),
      aiGenerateTitles: vi.fn(),
      aiEnhanceContent: vi.fn(),
      aiGenerateSummary: vi.fn()
    };
  });

  it("shows unconfigured state when API not configured", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: false });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    expect(w.text()).toContain("需要配置 LLM API Key");
    expect(w.text()).toContain("前往 Provider 设置");
  });

  it("shows configured state when API is configured", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    expect(w.text()).toContain("AI 辅助写作");
    expect(w.text()).toContain("标题生成");
    expect(w.text()).toContain("内容润色");
    expect(w.text()).toContain("生成摘要");
  });

  it("通过 API 层查询模型服务商配置", async () => {
    window.electronAPI.modelProviderIsConfigured = vi.fn().mockResolvedValue({ code: 0, data: true });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();

    expect(publisherApi.modelProviderIsConfigured).toHaveBeenCalledWith("llm");
    expect(publisherApi.aiIsConfigured).not.toHaveBeenCalled();
    expect(w.text()).toContain("标题生成");
  });

  it("点击关闭按钮时发送 close 事件", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();

    await w.get('[aria-label="关闭 AI 写作"]').trigger("click");
    expect(w.emitted("close")).toEqual([[]]);
  });

  it("navigates to providers on configure button click", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: false });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    // Click "前往 Provider 设置" (second button: first is close button)
    const providerBtn = w.findAll("button").filter(b => b.text().includes("Provider"));
    await providerBtn[0].trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("generates titles and displays results", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiGenerateTitles.mockResolvedValue({
      code: 0,
      data: ["标题一：AI的未来", "标题二：深度学习入门"]
    });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    const input = w.find("input");
    await input.setValue("AI技术");
    const generateBtn = w.findAll("button").filter(b => b.text().includes("生成标题"));
    await generateBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("标题一：AI的未来");
    expect(w.text()).toContain("标题二：深度学习入门");
  });

  it("emits apply-title on title click", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiGenerateTitles.mockResolvedValue({
      code: 0,
      data: ["测试标题"]
    });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    const input = w.find("input");
    await input.setValue("测试");
    const generateBtn = w.findAll("button").filter(b => b.text().includes("生成标题"));
    await generateBtn[0].trigger("click");
    await nextTick();
    const resultItem = w.find(".result-item");
    await resultItem.trigger("click");
    expect(w.emitted("apply-title")).toBeTruthy();
    expect(w.emitted("apply-title")[0]).toEqual(["测试标题"]);
  });

  it("生成结果使用原生按钮，支持键盘聚焦与触发", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiGenerateTitles.mockResolvedValue({ code: 0, data: ["键盘可用标题"] });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    await w.find("input").setValue("无障碍");
    await w.findAll("button").find(b => b.text().includes("生成标题")).trigger("click");
    await nextTick();

    const result = w.get("button.result-item");
    expect(result.attributes("type")).toBe("button");
    await result.trigger("click");
    expect(w.emitted("apply-title")?.at(-1)).toEqual(["键盘可用标题"]);
  });

  it("配置查询失败时显示可恢复错误而不产生未处理拒绝", async () => {
    window.electronAPI.modelProviderIsConfigured = vi.fn().mockRejectedValue(new Error("配置服务不可用"));
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();

    expect(w.get('[role="alert"]').text()).toContain("配置服务不可用");
  });

  it("enhances content and displays result", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiEnhanceContent.mockResolvedValue({
      code: 0,
      data: "这是润色后的内容"
    });
    const w = mount(AiWriterPanel, {
      props: { sourceContent: "这是一段需要润色的原文内容，长度超过十个字" },
      global: { plugins: [i18n] },
    });
    await waitConfig();
    // Click enhance mode tab
    const enhanceTab = w.findAll("button").filter(b => b.text().includes("内容润色"));
    await enhanceTab[0].trigger("click");
    await nextTick();
    // Click enhance action button
    const enhanceBtn = w.findAll("button").filter(b => b.text().includes("润色正文"));
    await enhanceBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("润色后的内容");
  });

  it("generates summary and displays result", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiGenerateSummary.mockResolvedValue({
      code: 0,
      data: "这是生成的摘要内容"
    });
    const w = mount(AiWriterPanel, {
      props: { sourceContent: "这是一段用于生成摘要的原文内容，长度超过二十个字以确保可以正常生成摘要。" },
      global: { plugins: [i18n] },
    });
    await waitConfig();
    // Find summary action button (the one with cohere-btn-primary class, not the mode tab)
    const allButtons = w.findAll("button");
    const actionBtn = allButtons.filter(b => b.classes().includes("cohere-btn-primary") && b.text().includes("生成摘要"));
    if (actionBtn.length === 0) {
      // Click the summary mode tab first, then find the action button
      const summaryTab = allButtons.filter(b => b.text().includes("生成摘要"));
      await summaryTab[0].trigger("click");
      await nextTick();
      const afterSwitch = w.findAll("button");
      const afterAction = afterSwitch.filter(b => b.classes().includes("cohere-btn-primary"));
      await afterAction[0].trigger("click");
    } else {
      await actionBtn[0].trigger("click");
    }
    await nextTick();
    expect(w.text()).toContain("生成的摘要内容");
  });

  // ─── 改写引擎测试 ─────────────────────

  it("shows rewrite tab when configured", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    expect(w.text()).toContain("AI 改写");
    // 切换到改写 tab 后模式选项才可见
    const rewriteTab = w.findAll("button").find(b => b.text().includes("AI 改写"));
    await rewriteTab.trigger("click");
    await nextTick();
    expect(w.text()).toContain("智能仿写");
    expect(w.text()).toContain("扩写爆款");
    expect(w.text()).toContain("选题创作");
  });

  it("loads rewrite strategies on mount", async () => {
    const mockStrategies = [
      { id: "strategy-viral", name: "爆款策略", enabled: true },
      { id: "strategy-ecom", name: "电商策略", enabled: true },
    ];
    window.electronAPI.aiIsConfigured = vi.fn().mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: mockStrategies });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    expect(publisherApi.aiListRewriteStrategies).toHaveBeenCalled();
  });

  it("switches to rewrite mode and shows user settings", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    // Click rewrite tab
    const rewriteTab = w.findAll("button").find(b => b.text().includes("AI 改写"));
    await rewriteTab.trigger("click");
    await nextTick();
    expect(w.text()).toContain("改写模式");
    expect(w.text()).toContain("行业");
    expect(w.text()).toContain("目的");
    expect(w.text()).toContain("语言风格");
    expect(w.text()).toContain("目标平台");
    expect(w.text()).toContain("长度");
    // 2026-09-15：标签改走 i18n（rewritePage.strategyLabel），zh 文案统一为「改写策略」
    expect(w.text()).toContain("改写策略");
    expect(w.text()).toContain("自动匹配");
  });

  it("calls aiRewrite and displays result", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    window.electronAPI.aiRewrite = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        success: true,
        result: "这是改写后的爆款文案内容",
        strategy: { id: "strategy-viral", name: "故事化爆款策略", category: "viral" },
        metadata: { mode: "imitate", originalLength: 50, resultLength: 120, aiTasteLevel: 0.15 },
        warnings: [],
        sensitiveHits: [],
      },
    });
    const w = mount(AiWriterPanel, {
      props: { sourceContent: "这是一段需要改写的测试文案内容，长度超过二十个字" },
      global: { plugins: [i18n] },
    });
    await waitConfig();
    // Click rewrite tab
    const rewriteTab = w.findAll("button").find(b => b.text().includes("AI 改写"));
    await rewriteTab.trigger("click");
    await nextTick();
    // Set content
    const textarea = w.find("textarea");
    await textarea.setValue("这是一段需要改写的测试文案内容，长度超过二十个字");
    // Click rewrite button
    const rewriteBtn = w.findAll("button").find(b => b.text().includes("开始改写"));
    await rewriteBtn.trigger("click");
    await nextTick();
    expect(publisherApi.aiRewrite).toHaveBeenCalled();
    // After rewrite, result should be displayed
    const callArgs = publisherApi.aiRewrite.mock.calls[0][0];
    expect(callArgs.mode).toBe("imitate");
    expect(callArgs.content).toContain("需要改写");
    expect(w.text()).toContain("改写后的爆款文案内容");
  });

  it("displays error when rewrite fails", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    window.electronAPI.aiRewrite = vi.fn().mockResolvedValue({
      code: 0,
      data: { success: false, error: "内容包含敏感词，无法改写", errorCode: "SENSITIVE_CONTENT" },
    });
    const w = mount(AiWriterPanel, {
      props: { sourceContent: "这是一段需要改写的测试文案内容，长度超过二十个字" },
      global: { plugins: [i18n] },
    });
    await waitConfig();
    const rewriteTab = w.findAll("button").find(b => b.text().includes("AI 改写"));
    await rewriteTab.trigger("click");
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("敏感内容测试");
    const rewriteBtn = w.findAll("button").find(b => b.text().includes("开始改写"));
    await rewriteBtn.trigger("click");
    await nextTick();
    expect(w.get('[role="alert"]').text()).toContain("敏感词");
  });

  it("switches strategy mode to manual and shows strategy picker", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({
      code: 0,
      data: [
        { id: "strategy-viral", name: "故事化爆款策略" },
        { id: "strategy-ecom", name: "电商转化策略" },
      ],
    });
    const w = mount(AiWriterPanel, { props: { sourceContent: "" }, global: { plugins: [i18n] } });
    await waitConfig();
    const rewriteTab = w.findAll("button").find(b => b.text().includes("AI 改写"));
    await rewriteTab.trigger("click");
    await nextTick();
    // Click "手动选择" radio
    const manualRadio = w.findAll('input[type="radio"]').find(r => r.element.nextSibling?.textContent?.includes("手动选择"));
    await manualRadio.setValue(true);
    await nextTick();
    // Strategy dropdown should now be visible
    const selects = w.findAll("select");
    const strategySelect = selects.find(s => s.element.value === "");
    expect(w.text()).toContain("故事化爆款策略");
  });

  // ─── P2 隐式反馈：应用=采纳，再次改写=弃用 ───
  it("applying rewrite result sends adopted feedback for knowledgeRefs", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    window.electronAPI.aiRewrite = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        success: true,
        result: "这是应用后的改写文案内容",
        strategy: { id: "strategy-viral", name: "故事化爆款策略", category: "viral" },
        metadata: { mode: "imitate", originalLength: 50, resultLength: 100, aiTasteLevel: 0.1 },
        knowledgeRefs: [{ table: "viral_library", id: "v1" }, { table: "personal_knowledge", id: "p1" }],
        warnings: [],
        sensitiveHits: [],
      },
    });
    window.electronAPI.applyKnowledgeFeedback = vi.fn().mockResolvedValue({ code: 0 });
    const w = mount(AiWriterPanel, { props: { sourceContent: "这是一段需要改写的测试文案内容，长度超过二十个字" }, global: { plugins: [i18n] } });
    await waitConfig();
    const rewriteTab = w.findAll("button").find(b => b.text().includes("AI 改写"));
    await rewriteTab.trigger("click");
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("这是一段需要改写的测试文案内容，长度超过二十个字");
    const rewriteBtn = w.findAll("button").find(b => b.text().includes("开始改写"));
    await rewriteBtn.trigger("click");
    await nextTick();
    // 点击结果项（应用）→ 应触发 adopted 反馈
    const resultItem = w.findAll("button").find(b => b.text().includes("应用"));
    await resultItem.trigger("click");
    await nextTick();
    expect(window.electronAPI.applyKnowledgeFeedback).toHaveBeenCalledWith(
      "adopted",
      expect.arrayContaining([
        expect.objectContaining({ table: "viral_library", id: "v1" }),
        expect.objectContaining({ table: "personal_knowledge", id: "p1" }),
      ])
    );
  });

  it("re-rewriting without applying sends rejected feedback for previous refs", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    window.electronAPI.aiRewrite = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        success: true,
        result: "第一次改写结果",
        strategy: { id: "s1", name: "策略", category: "viral" },
        metadata: { mode: "imitate", originalLength: 50, resultLength: 100, aiTasteLevel: 0.1 },
        knowledgeRefs: [{ table: "viral_library", id: "v1" }],
        warnings: [],
        sensitiveHits: [],
      },
    });
    window.electronAPI.applyKnowledgeFeedback = vi.fn().mockResolvedValue({ code: 0 });
    const w = mount(AiWriterPanel, { props: { sourceContent: "这是一段需要改写的测试文案内容，长度超过二十个字" }, global: { plugins: [i18n] } });
    await waitConfig();
    const rewriteTab = w.findAll("button").find(b => b.text().includes("AI 改写"));
    await rewriteTab.trigger("click");
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("这是一段需要改写的测试文案内容，长度超过二十个字");
    const rewriteBtn = w.findAll("button").find(b => b.text().includes("开始改写"));
    await rewriteBtn.trigger("click");
    await nextTick();
    // 再次点击改写（不应用）→ 上次的 refs 应被 rejected
    await rewriteBtn.trigger("click");
    await nextTick();
    expect(window.electronAPI.applyKnowledgeFeedback).toHaveBeenCalledWith(
      "rejected",
      expect.arrayContaining([expect.objectContaining({ table: "viral_library", id: "v1" })])
    );
  });

  // ── 归因链（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05）─────────────────────────
  // 发布页 AI 面板的改写产物是**页内应用**（emit apply-content → Publish.vue 直接写 article.content），
  // 不经过草稿。所以这一路必须在 emit 载荷里把 rewrite_history 行 id 一起交出去，
  // 否则"在 AI 面板里改写并发布"的作品永远进不了归因榜。
  async function rewriteAndApply (rewriteDataOver) {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    window.electronAPI.aiRewrite = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        success: true,
        result: "这是应用后的改写文案内容",
        strategy: { id: "strategy-viral", name: "故事化爆款策略", category: "viral" },
        metadata: { mode: "imitate", originalLength: 50, resultLength: 100, aiTasteLevel: 0.1 },
        knowledgeRefs: [],
        warnings: [],
        sensitiveHits: [],
        ...rewriteDataOver,
      },
    });
    window.electronAPI.applyKnowledgeFeedback = vi.fn().mockResolvedValue({ code: 0 });
    const w = mount(AiWriterPanel, { props: { sourceContent: "这是一段需要改写的测试文案内容，长度超过二十个字" }, global: { plugins: [i18n] } });
    await waitConfig();
    await w.findAll("button").find(b => b.text().includes("AI 改写")).trigger("click");
    await nextTick();
    await w.find("textarea").setValue("这是一段需要改写的测试文案内容，长度超过二十个字");
    await w.findAll("button").find(b => b.text().includes("开始改写")).trigger("click");
    await nextTick();
    await w.findAll("button").find(b => b.text().includes("应用")).trigger("click");
    await nextTick();
    return w;
  }

  it("归因链：应用改写结果时，apply-content 第二参携带 rewrite_history id", async () => {
    const w = await rewriteAndApply({ rewriteHistoryId: "mdPANEL00001" });
    const events = w.emitted("apply-content");
    expect(events).toBeTruthy();
    // 第一参必须是纯文本（Publish.vue 的绑定靠它拼正文，改成对象会渲染成 [object Object]）
    expect(events[0][0]).toBe("这是应用后的改写文案内容");
    expect(events[0][1]).toBe("mdPANEL00001");
    // 两个"应用"出口必须同口径带 lineage（apply-rewrite 目前无父绑定，但它是同一份产物的第二个出口）
    const rw = w.emitted("apply-rewrite");
    expect(rw, "apply-rewrite 必须仍然发出（父绑定缺失是另一件事，记在 PRD §3.4）").toBeTruthy();
    expect(rw[0][1]).toBe("mdPANEL00001");
  });

  it("归因链：改写没给 id 时第二参是 null，而不是 undefined 或上一次的残留", async () => {
    const w = await rewriteAndApply({});
    const events = w.emitted("apply-content");
    expect(events[0][1]).toBe(null);
  });

  it("归因链：非改写来源的应用（摘要）必须显式传 null 清掉父级旧关联", async () => {
    // 摘要/增强不是改写产物。省略第二参与传 null 在 JS 里等价，
    // 所以这条量的不是"有没有写"，而是"实现有没有把 null 当成一个必须表达的决定"。
    const src = require("fs").readFileSync(require.resolve("./AiWriterPanel.vue"), "utf8");
    expect(src).toMatch(/emit\("apply-content", enhancedResult\.value, null\)/);
    expect(src).toMatch(/emit\("apply-content", summary\.value, null\)/);
  });

  it("归因链接线守卫：Publish.vue 的 @apply-content 必须是接收两个参数的函数形态", async () => {
    // 全仓没有任何测试挂载 Publish.vue（实测 src/views/Publish.vue 只被源码扫描类测试读到），
    // 所以 emit 的第二参若在此处被丢掉（退回 $event 语句形态），CI 不会有任何东西变红，
    // 症状是"在 AI 面板里改写并发布的作品永远进不了归因榜" —— 与本次修掉的原始断链同形。
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.resolve(__dirname, "..", "views", "Publish.vue"), "utf8");
    const binding = /@apply-content="([^"]*)"/.exec(src);
    expect(binding, "Publish.vue 里找不到 @apply-content 绑定，接线已断").toBeTruthy();
    expect(binding[1]).toMatch(/^\(text,\s*lineage\)\s*=>/);
    expect(binding[1]).toMatch(/article\.rewriteHistoryId\s*=\s*lineage\s*\|\|\s*null/);
    expect(binding[1], "正文赋值必须仍来自第一参").toMatch(/article\.content\s*=\s*text/);
  });

  // ── 敏感词警告的严重级（fix-rewrite-warning-severity，2026-10-21）──
  //
  // 事故形态：PR #4103 关了引擎的前置敏感词拦截，方案「B+」是「关前置、留后置」——
  // 改写结果若仍含敏感词，引擎在 warnings 里提醒人工审核。但本面板把 warnings 写进
  // panelError，而 panelError 是 role="alert" 的**红色错误区**，且同一时刻结果已成功落地
  // ⇒ 用户看到「红色错误 + 有结果」并存，要么以为改写失败了，要么以为这个错误能忽略。
  //
  // 采集页 4 入口已在 PR #4141 修掉（warning 级提示条），本文件锁 AI 面板这半条。

  it("敏感词警告走 warning 级：有 warnings ⇒ 红色错误区（role=\"alert\"）不出现，结果照常落地", async () => {
    const w = await rewriteAndApply({
      warnings: ["改写结果可能包含敏感内容，请人工审核"],
      sensitiveHits: [{ word: "爆炸", index: 0, length: 2, category: "暴力" }],
    });
    // 结果必须照常落地（warnings 不是失败，不能挡住结果）
    expect(w.text()).toContain("这是应用后的改写文案内容");
    // 关键契约：红色错误区不得出现
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.vm.panelError).toBeFalsy();
    // warnings 必须以 warning 级呈现（独立提示元素，非红色错误）
    const banner = w.find('[data-testid="panel-sensitive-warning"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("敏感");
  });

  it("敏感词警告不得把真失败一起放宽：success:false 仍进红色错误区", async () => {
    window.electronAPI.aiIsConfigured.mockResolvedValue({ code: 0, data: true });
    window.electronAPI.aiListRewriteStrategies = vi.fn().mockResolvedValue({ code: 0, data: [] });
    window.electronAPI.aiRewrite = vi.fn().mockResolvedValue({
      code: 0,
      data: { success: false, error: "内容包含敏感词，无法改写", errorCode: "SENSITIVE_CONTENT" },
    });
    const w = mount(AiWriterPanel, { props: { sourceContent: "这是一段需要改写的测试文案内容，长度超过二十个字" }, global: { plugins: [i18n] } });
    await waitConfig();
    await w.findAll("button").find(b => b.text().includes("AI 改写")).trigger("click");
    await nextTick();
    await w.find("textarea").setValue("这是一段需要改写的测试文案内容，长度超过二十个字");
    await w.findAll("button").find(b => b.text().includes("开始改写")).trigger("click");
    await nextTick();

    // 失败仍然必须是红色错误（这条不能被本轮放宽破坏）
    expect(w.find('[role="alert"]').exists()).toBe(true);
    expect(w.vm.panelError).toBeTruthy();
    // 且不得出现敏感词提示条（那不是失败路径）
    expect(w.find('[data-testid="panel-sensitive-warning"]').exists()).toBe(false);
  });
});
