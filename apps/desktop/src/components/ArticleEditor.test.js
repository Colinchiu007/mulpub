import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@vueup/vue-quill", () => ({
  QuillEditor: { name: "QuillEditor", template: "<div class='quill-mock' />", props: ["content", "contentType", "options"] }
}));

import i18n from "@/i18n";
import ArticleEditor from "./ArticleEditor.vue";

const mountEditor = (props) => mount(ArticleEditor, { props, global: { plugins: [i18n] } });

describe("ArticleEditor", () => {
  it("renders in rich text mode by default", () => {
    const w = mountEditor({ modelValue: "" });
    expect(w.find(".quill-mock").exists()).toBe(true);
  });

  it("switches to markdown mode on tab click", async () => {
    const w = mountEditor({ modelValue: "" });
    await nextTick();
    const mdBtn = w.findAll("button").filter(b => b.text().includes("Markdown"));
    await mdBtn[0].trigger("click");
    await nextTick();
    expect(w.find(".quill-mock").exists()).toBe(false);
    expect(w.find("textarea").exists()).toBe(true);
  });

  it("shows placeholder in markdown mode", async () => {
    const w = mountEditor({ modelValue: "", placeholder: "在此编辑内容..." });
    await nextTick();
    const mdBtn = w.findAll("button").filter(b => b.text().includes("Markdown"));
    await mdBtn[0].trigger("click");
    await nextTick();
    expect(w.find("textarea").attributes("placeholder")).toBe("在此编辑内容...");
  });

  it("markdown textarea shows modelValue", async () => {
    const w = mountEditor({ modelValue: "测试内容" });
    await nextTick();
    const mdBtn = w.findAll("button").filter(b => b.text().includes("Markdown"));
    await mdBtn[0].trigger("click");
    await nextTick();
    expect(w.find("textarea").element.value).toBe("测试内容");
  });

  it("emits update:modelValue on markdown edit", async () => {
    const w = mountEditor({ modelValue: "" });
    await nextTick();
    const mdBtn = w.findAll("button").filter(b => b.text().includes("Markdown"));
    await mdBtn[0].trigger("click");
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("新内容");
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect(w.emitted("update:modelValue")[0]).toEqual(["新内容"]);
  });

  // PRD-PLATFORM-CHAR-LIMITS-2026-10-02 §F1：应用端 10000 字上限与计数
  it("markdown textarea 硬上限 maxlength=10000（prop 默认 APP_ARTICLE_CONTENT_MAX）", async () => {
    const w = mountEditor({ modelValue: "" });
    await nextTick();
    const mdBtn = w.findAll("button").filter(b => b.text().includes("Markdown"));
    await mdBtn[0].trigger("click");
    await nextTick();
    expect(w.find("textarea").attributes("maxlength")).toBe("10000");
  });

  it("显示字数计数 {count}/10000 字", async () => {
    const w = mountEditor({ modelValue: "abc字" });
    await nextTick();
    const counter = w.find('[data-testid="article-char-counter"]');
    expect(counter.exists()).toBe(true);
    expect(counter.text()).toContain("4/10000");
  });

  it("计数按码点统计（emoji 不拆半）", async () => {
    const w = mountEditor({ modelValue: "😀😀" });
    await nextTick();
    expect(w.find('[data-testid="article-char-counter"]').text()).toContain("2/10000");
  });

  it("超限时计数出现 over class", async () => {
    const w = mountEditor({ modelValue: "a".repeat(10001) });
    await nextTick();
    const counter = w.find('[data-testid="article-char-counter"]');
    expect(counter.classes()).toContain("article-char-counter--over");
  });

  it("maxChars prop 可覆盖默认上限", async () => {
    const w = mountEditor({ modelValue: "abcde", maxChars: 10 });
    await nextTick();
    expect(w.find('[data-testid="article-char-counter"]').text()).toContain("5/10");
    const mdBtn = w.findAll("button").filter(b => b.text().includes("Markdown"));
    await mdBtn[0].trigger("click");
    await nextTick();
    expect(w.find("textarea").attributes("maxlength")).toBe("10");
  });
});

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// 富文本装载：段落结构不得被吞
// （2026-10-15 百家号「正文一整段」二次报障的**渲染端第一性根因**：
//   Quill 的 content-type="html" 把纯文本里的换行当可忽略空白 ⇒ 装载即塌成一段。）
// ---------------------------------------------------------------------------
const quillProp = (w) => w.findComponent({ name: "QuillEditor" }).props("content");

describe("ArticleEditor — 富文本装载的正文承载形态", () => {
  it("纯文本多段 → 传给 Quill 的是逐段 <p>（不是裸换行）", async () => {
    const w = mountEditor({ modelValue: "第一段\n\n第二段\n第三段" });
    await nextTick();
    expect(quillProp(w)).toBe("<p>第一段</p><p>第二段</p><p>第三段</p>");
  });

  it("已是 HTML 的内容幂等透传（不二次包装）", async () => {
    const w = mountEditor({ modelValue: "<p>甲</p><p>乙</p>" });
    await nextTick();
    expect(quillProp(w)).toBe("<p>甲</p><p>乙</p>");
  });

  it("空/空白内容不产出空 <p>", async () => {
    const w = mountEditor({ modelValue: "   " });
    await nextTick();
    expect(quillProp(w)).toBe("");
  });

  it("代码片段不被当成标签（白名单判据：<stdio.h> 转义保留，不整段吃掉）", async () => {
    const w = mountEditor({ modelValue: "#include <stdio.h>" });
    await nextTick();
    expect(quillProp(w)).toBe("<p>#include &lt;stdio.h&gt;</p>");
  });

  it("Quill 回写变化时 modelValue 收到 HTML（发布链按承载形态再适配）", async () => {
    const w = mountEditor({ modelValue: "a\n\nb" });
    await nextTick();
    await w.findComponent({ name: "QuillEditor" }).vm.$emit("update:content", "<p>a</p><p>b</p>");
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect(w.emitted("update:modelValue").at(-1)).toEqual(["<p>a</p><p>b</p>"]);
  });

  it("Markdown 模式仍按原文编辑（装载不做 HTML 归一）", async () => {
    const w = mountEditor({ modelValue: "第一段\n\n第二段" });
    await nextTick();
    const mdBtn = w.findAll("button").filter(b => b.text().includes("Markdown"));
    await mdBtn[0].trigger("click");
    await nextTick();
    expect(w.find("textarea").element.value).toBe("第一段\n\n第二段");
  });

  it("结构锁：richContent.get 必须经 toHtmlBody 装载，不得回退直传 modelValue", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "ArticleEditor.vue"), "utf8");
    expect(src).toContain("toHtmlBody(props.modelValue)");
    expect(src).toContain("@multi-publish/shared-utils/src/article-body-format");
    // 反例只在**富文本** getter 内成立（Markdown textarea 仍应直读 modelValue）
    const richGetter = src.slice(src.indexOf("const richContent"), src.indexOf("const mdContent"));
    expect(richGetter).not.toMatch(/get:\s*\(\)\s*=>\s*props\.modelValue/);
  });
});