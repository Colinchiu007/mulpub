import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import fs from "node:fs";
import path from "node:path";

import { config as __vtuConfig } from '@vue/test-utils'
import { createI18n as __createI18n } from 'vue-i18n'
import __zhLocale from '@/locales/zh'
import __enLocale from '@/locales/en'
__vtuConfig.global.plugins = [
  ...(__vtuConfig.global.plugins || []),
  __createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'en',
    messages: { zh: __zhLocale, en: __enLocale },
  }),
]
import { nextTick } from "vue";

vi.mock("../components/UiModal.vue", () => ({
  default: {
    name: "UiModal",
    template: '<div class="ui-modal-mock"><slot /></div>',
    props: ["visible", "title", "width", "closeOnClickModal", "destroyOnClose"]
  }
}));

// Mock @/api/publisher 模块（组件通过 import 调用，不再用全局注入）
vi.mock("@/api/publisher", () => ({
  intelligenceFindReferences: vi.fn()
}));

import { intelligenceFindReferences } from "@/api/publisher";
import ReferenceFinder from "./ReferenceFinder.vue";

describe("ReferenceFinder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows initial empty state", async () => {
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    expect(w.text()).toContain("\u8f93\u5165\u5173\u952e\u8bcd\u641c\u7d22\u6743\u5a01\u6765\u6e90");
  });

  it("shows searching state", async () => {
    vi.mocked(intelligenceFindReferences).mockImplementation(() => new Promise(() => {}));
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    const input = w.find("input");
    await input.setValue("AI\u6280\u672f");
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("\u641c\u7d22"));
    await searchBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("\u641c\u7d22\u4e2d");
  });

  it("shows no results state", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({ code: 0, data: { references: [] } });
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    const input = w.find("input");
    await input.setValue("\u4e0d\u5b58\u5728\u7684\u5173\u952e\u8bcd");
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("\u641c\u7d22"));
    await searchBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("\u672a\u627e\u5230\u76f8\u5173\u6765\u6e90");
  });

  it("shows results after search", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({
      code: 0,
      data: {
        references: [
          { title: "AI\u6280\u672f\u53d1\u5c55\u8d8b\u52bf", url: "https://example.com/ai", source: "\u77e5\u4e4e", engagement: "1.2k", snippet: "\u4eba\u5de5\u667a\u80fd\u6280\u672f\u6b63\u5728\u5feb\u901f\u53d1\u5c55...", relevance: 45 },
          { title: "\u6df1\u5ea6\u5b66\u4e60\u5165\u95e8", url: "https://example.com/dl", source: "CSDN", engagement: "856", snippet: "\u6df1\u5ea6\u5b66\u4e60\u662f\u673a\u5668\u5b66\u4e60\u7684\u4e00\u4e2a\u5206\u652f...", relevance: 30 },
        ]
      }
    });
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    const input = w.find("input");
    await input.setValue("AI\u6280\u672f");
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("\u641c\u7d22"));
    await searchBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("AI\u6280\u672f\u53d1\u5c55\u8d8b\u52bf");
    expect(w.text()).toContain("\u6df1\u5ea6\u5b66\u4e60\u5165\u95e8");
    expect(w.text()).toContain("\u77e5\u4e4e");
    expect(w.text()).toContain("CSDN");
  });

  // ── 稳定键（UX 审计 4.8）：结果行的 :key="idx" 让节点身份跟着位置而不是跟着条目 ──
  // ⛔ 本组件**没有**可复现的用户可见缺陷，这点必须先说清楚：两次搜索之间 `searching` 为真会把
  // 结果块整体 v-if 掉再重建，节点必然全新挂载，于是"旧条目的行内样式残留在新条目上"这一形态
  // 在这里结构性不可达（我写过一条这样的行为用例，它在**修复前**就绿 —— 那说明测的不是被修的键，
  // 已删除）。所以本组件只落两条可机械判定的：行身份存在且互不相同、:key 不得退回裸位置。
  const twoResults = (a, b) => ({
    code: 0,
    data: {
      references: [
        { title: a, url: "https://example.com/" + a, source: "S1", engagement: "1", snippet: "x", relevance: 40 },
        { title: b, url: "https://example.com/" + b, source: "S2", engagement: "2", snippet: "y", relevance: 20 },
      ]
    }
  });

  async function searchOnce (w, keyword) {
    const input = w.find("input");
    await input.setValue(keyword);
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("\u641c\u7d22"));
    await searchBtn[0].trigger("click");
    await nextTick();
    await nextTick();
  }

  it("结果行必须携带一个本次搜索内唯一的身份", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue(twoResults("R3A", "R3B"));
    const w = mount(ReferenceFinder, { props: { visible: true, searchText: "" } });
    await nextTick();
    await searchOnce(w, "\u8eab\u4efd");
    const rows = w.findAll('[data-testid^="rf-row-"]');
    expect(rows.length, "扫描域必须真的命中结果行（命中 0 处说明这条锁的锚点已失效，不是已收敛）").toBe(2);
    const ids = rows.map(r => r.attributes("data-testid"));
    expect(new Set(ids).size, "同一次搜索内两行的身份不得相同（重复键会让 Vue 直接把两个条目并进一个节点）").toBe(ids.length);
    w.unmount();
  });

  it("结果行的 :key 必须是条目身份，不得退回裸位置", () => {
    const src = fs.readFileSync(path.join(__dirname, "ReferenceFinder.vue"), "utf8");
    const keyHit = /v-for="ref in results" :key="([^"]+)"/.exec(src);
    expect(keyHit, "结果行 v-for 的锚点必须命中（命中 0 处不是已收敛，是扫描器失明）").not.toBeNull();
    expect(keyHit[1], "键必须取行身份本身，而不是位置别名").toBe("ref._rid");
    // 反向：整个组件不得再出现"第二个参数当键"的形态（换成别的变量名也不许）
    expect(/v-for="\([^)]*,\s*\w+\)\s+in\s+[^"]*"\s*:key="\s*\w+\s*"/.test(src), "仍有一处 v-for 用位置别名作 :key").toBe(false);
  });

  it("auto-searches when visible flips to true with searchText", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({
      code: 0,
      data: {
        references: [
          { title: "\u673a\u5668\u5b66\u4e60", url: "https://example.com/ml", source: "\u77e5\u4e4e", engagement: "2k", snippet: "\u673a\u5668\u5b66\u4e60\u6982\u8ff0...", relevance: 50 }
        ]
      }
    });
    // Mount not visible first, then flip to visible
    const w = mount(ReferenceFinder, {
      props: { visible: false, searchText: "\u673a\u5668\u5b66\u4e60" }
    });
    await nextTick();
    await w.setProps({ visible: true });
    await nextTick();
    expect(intelligenceFindReferences).toHaveBeenCalledWith("\u673a\u5668\u5b66\u4e60", { limit: 5 });
  });

  it("emits insert-reference on insert button click", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({
      code: 0,
      data: {
        references: [
          { title: "\u6d4b\u8bd5\u6587\u7ae0", url: "https://example.com/test", source: "\u77e5\u4e4e", engagement: "100", snippet: "\u6d4b\u8bd5\u5185\u5bb9", relevance: 40 }
        ]
      }
    });
    const w = mount(ReferenceFinder, {
      props: { visible: false, searchText: "\u6d4b\u8bd5" }
    });
    await nextTick();
    await w.setProps({ visible: true });
    await nextTick();
    // Wait for async search to complete
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    const insertBtn = w.findAll("button").filter(b => b.text().includes("\u63d2\u5165"));
    expect(insertBtn.length).toBeGreaterThan(0);
    await insertBtn[0].trigger("click");
    expect(w.emitted("insert-reference")).toBeTruthy();
    expect(w.emitted("insert-reference")[0][0]).toMatchObject({
      title: "\u6d4b\u8bd5\u6587\u7ae0",
      url: "https://example.com/test"
    });
  });
  it('参考结果 url 非 http/https 时不产出锚点（PRD-HREF-SCHEME-GUARD）', async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({
      code: 0,
      data: {
        references: [
          { title: "安全参考", url: "https://example.com/ok", source: "知乎", engagement: "1.2k", snippet: "", relevance: 40 },
          { title: "恶意参考", url: "data:text-html-base64-PHNjcmlwdD4=", source: "CSDN", engagement: "856", snippet: "", relevance: 30 },
        ]
      }
    });
    const w = mount(ReferenceFinder, { props: { visible: true, searchText: "" } });
    await nextTick();
    const input = w.find("input");
    await input.setValue("参考");
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("搜索"));
    await searchBtn[0].trigger("click");
    await nextTick();
    expect(w.findAll("a").map(a => a.attributes("href"))).toEqual(["https://example.com/ok"]);
    expect(w.text()).toContain("恶意参考");
  });
});
