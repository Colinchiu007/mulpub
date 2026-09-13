import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { createI18n } from "vue-i18n";

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    getLabel: (key) => {
      const labels = { zhihu: "知乎", weibo: "微博", bilibili: "B站" };
      return labels[key] || key;
    }
  })
}));

vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn() }
}));

// 组件已 import { intelligenceSuggestTags } from '@/api/publisher'
// 必须用 vi.mock 拦截 ESM import
// 工厂内创建 vi.fn()，通过 import 拿引用（vi.mock 是 hoisted，不能引用外部变量）
vi.mock("@/api/publisher", () => ({
  intelligenceSuggestTags: vi.fn(),
}));

import { intelligenceSuggestTags } from "@/api/publisher";
import TagSuggester from "./TagSuggester.vue";

import zh from "@/locales/zh";
import en from "@/locales/en";

function makeI18n(locale = "zh") {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en",
    messages: { zh, en },
  });
}

function successResponse() {
  return {
    keywords: ["#测试", "文章"],
    relatedTerms: ["技术", "编程"],
    byPlatform: { zhihu: ["知乎", "科技", "知乎热榜"], weibo: ["#微博", "#热门话题", "科技前沿"] },
    byPlatformDetail: {
      zhihu: { content: ["知乎", "科技"], traffic: ["知乎热榜"] },
      weibo: { content: ["#微博"], traffic: ["#热门话题", "科技前沿"] },
    },
    source: "llm",
    calibrated: true,
    matchedTopics: {
      zhihu: [{ tag: "知乎热榜", heat: 92 }],
      weibo: [{ tag: "#热门话题", heat: 88 }, { tag: "科技前沿", heat: 70 }],
    },
  };
}

function fallbackResponse() {
  return {
    keywords: ["#测试", "文章"],
    relatedTerms: ["技术", "编程"],
    byPlatform: { zhihu: ["#知乎", "科技"], weibo: ["#微博", "热门"] },
    source: "extractor",
    calibrated: false,
  };
}

function createWrapper(i18n) {
  return mount(TagSuggester, {
    props: { content: "" },
    attachTo: document.body,
    global: i18n ? { plugins: [i18n] } : {},
  });
}

async function triggerAnalyzeTimed(w, content) {
  await w.setProps({ content });
  vi.advanceTimersByTime(900);
  await nextTick();
}

describe("TagSuggester", () => {
  let i18n;
  beforeEach(() => {
    vi.mocked(intelligenceSuggestTags).mockReset();
    vi.mocked(intelligenceSuggestTags).mockResolvedValue({ code: 0, data: successResponse() });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setActivePinia(createPinia());
    i18n = makeI18n("zh");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows empty state for short content", async () => {
    const w = mount(TagSuggester, { props: { content: "ab" }, global: { plugins: [makeI18n()] } });
    await nextTick();
    expect(w.text()).toContain("输入内容后自动分析标签");
  });

  it("shows empty state for empty content", async () => {
    const w = mount(TagSuggester, { props: { content: "" }, global: { plugins: [makeI18n()] } });
    await nextTick();
    expect(w.text()).toContain("输入内容后自动分析标签");
  });

  it("shows loading when analyzing", async () => {
    vi.mocked(intelligenceSuggestTags).mockImplementation(() => new Promise(() => {}));
    const w = createWrapper(makeI18n());
    await nextTick();
    await w.setProps({ content: "这是一篇测试文章内容" });
    vi.advanceTimersByTime(900);
    await nextTick();
    // 统一骨架屏：加载态改为骨架（文案只保留给辅助技术）
    expect(w.find('[data-testid="tag-suggester-loading"]').exists()).toBe(true);
    expect(w.findAll(".mp-skeleton-surface").length).toBeGreaterThan(0);
  });

  it("shows suggestions when API succeeds", async () => {
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");
    expect(w.text()).toContain("提取关键词");
    expect(w.text()).toContain("#测试");
    expect(w.text()).toContain("相关话题");
    expect(w.text()).toContain("各平台标签");
    expect(w.text()).toContain("知乎");
    // grouped headers from byPlatformDetail
    expect(w.text()).toContain("内容标签");
    expect(w.text()).toContain("流量标签");
  });

  it("shows error when API fails", async () => {
    vi.mocked(intelligenceSuggestTags).mockRejectedValue(new Error("API error"));
    const w = createWrapper(makeI18n());
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");
    expect(w.text()).toContain("标签分析失败");
  });

  it("handles null API response gracefully", async () => {
    vi.mocked(intelligenceSuggestTags).mockResolvedValue(null);
    const w = createWrapper(makeI18n());
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");
    expect(w.text()).toContain("提取关键词");
  });

  it("emits close on close button click", async () => {
    const w = mount(TagSuggester, { props: { content: "测试内容" }, global: { plugins: [makeI18n()] } });
    await nextTick();
    await w.find(".cohere-btn-ghost").trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("copies platform tags via Clipboard API", async () => {
    const clipboardMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardMock }, writable: true, configurable: true
    });
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");

    const copyBtns = w.findAll("button");
    const copyBtn = copyBtns.find(b => b.text().includes("复制标签"));
    expect(copyBtn).toBeDefined();
    await copyBtn.trigger("click");
    await nextTick();

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("copies via fallback textarea when clipboard.writeText fails", async () => {
    const clipboardMock = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardMock }, writable: true, configurable: true
    });
    // Mock execCommand for fallback path
    document.execCommand = vi.fn().mockReturnValue(true);

    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");

    const copyBtns = w.findAll("button");
    const copyBtn = copyBtns.find(b => b.text().includes("复制标签"));
    expect(copyBtn).toBeDefined();
    await copyBtn.trigger("click");
    await nextTick();

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("debounces rapid changes", async () => {
    vi.mocked(intelligenceSuggestTags).mockClear();
    vi.mocked(intelligenceSuggestTags).mockResolvedValue({ code: 0, data: successResponse() });
    const w = createWrapper(i18n);
    await nextTick();

    await w.setProps({ content: "a" });
    vi.advanceTimersByTime(100);
    await w.setProps({ content: "ab" });
    vi.advanceTimersByTime(100);
    await w.setProps({ content: "abc" });
    vi.advanceTimersByTime(100);
    await w.setProps({ content: "abcd" });
    vi.advanceTimersByTime(100);

    expect(intelligenceSuggestTags).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    await nextTick();
    expect(intelligenceSuggestTags).toHaveBeenCalledTimes(1);
  });

  it("resets state when content is cleared", async () => {
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是测试内容");
    expect(w.text()).toContain("提取关键词");
    await w.setProps({ content: "" });
    await nextTick();
    expect(w.text()).toContain("输入内容后自动分析标签");
  });

  it("shows source AI + calibrated status when source is llm", async () => {
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");
    expect(w.text()).toContain("AI 生成");
    expect(w.text()).toContain("热门库校准 ✓");
  });

  it("shows source local + no grouped headers when byPlatformDetail absent", async () => {
    vi.mocked(intelligenceSuggestTags).mockReset();
    vi.mocked(intelligenceSuggestTags).mockResolvedValue({ code: 0, data: fallbackResponse() });
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");
    expect(w.text()).toContain("本地摘词");
    expect(w.text()).toContain("各平台标签");
    expect(w.text()).not.toContain("内容标签");
    expect(w.text()).not.toContain("流量标签");
    expect(w.text()).toContain("#知乎");
  });

  it("shows AI not configured status when source missing", async () => {
    vi.mocked(intelligenceSuggestTags).mockReset();
    vi.mocked(intelligenceSuggestTags).mockResolvedValue({
      code: 0,
      data: { keywords: ["#测试"], relatedTerms: [], byPlatform: { zhihu: ["#知乎"] } },
    });
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");
    expect(w.text()).toContain("AI 未配置");
  });

  it("renders hot heat badge and tooltip from matchedTopics", async () => {
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");
    // heat badge number present for matched traffic tag
    expect(w.text()).toContain("92");
    expect(w.text()).toContain("88");
    const hotSpan = w.find('[title]');
    expect(hotSpan.exists()).toBe(true);
    expect(hotSpan.attributes("title")).toContain("匹配热门话题");
  });

  it("copies merged content+traffic tags from grouped platform", async () => {
    const clipboardMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardMock }, writable: true, configurable: true
    });
    const w = createWrapper(i18n);
    await nextTick();
    await triggerAnalyzeTimed(w, "这是一篇测试文章内容");

    const copyBtns = w.findAll("button");
    const copyBtn = copyBtns.find(b => b.text().includes("复制标签"));
    expect(copyBtn).toBeDefined();
    await copyBtn.trigger("click");
    await nextTick();

    expect(clipboardMock).toHaveBeenCalledWith("知乎 科技 知乎热榜");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });
});
