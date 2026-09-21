import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ViralManualDataInput from "./ViralManualDataInput.vue";
import zhMessages from "@/locales/zh";
import { buildViralSampleJson } from "@/utils/viral-sample-data";

function tZh(key) {
  const v = String(key).split(".").reduce((o, k) => (o && typeof o === "object" && o[k] !== undefined) ? o[k] : undefined, zhMessages);
  return typeof v === "string" ? v : key;
}

function createInput(props = {}) {
  return mount(ViralManualDataInput, {
    props: { modelValue: "", error: "", ...props },
    global: { mocks: { $t: (key) => tZh(key) } },
  });
}

describe("ViralManualDataInput", () => {
  it("M1 说明与三步指引按 locale 渲染（拆组件不丢文案）", async () => {
    const w = createInput();
    await nextTick();
    expect(w.text()).toContain(tZh("viralAnalysis.manualDataSummary"));
    expect(w.text()).toContain(tZh("viralAnalysis.manualDataHelp"));
    expect(w.findAll(".viral-article-steps li").map(li => li.text())).toEqual([
      tZh("viralAnalysis.manualDataStep1"),
      tZh("viralAnalysis.manualDataStep2"),
      tZh("viralAnalysis.manualDataStep3"),
    ]);
    expect(w.find("[data-testid='viral-fill-sample']").exists()).toBe(true);
  });

  it("M2 textarea 占位符 = 示例 JSON（与父视图一键填入同源）", async () => {
    const w = createInput();
    await nextTick();
    const placeholder = w.find("[data-testid='viral-article-textarea']").attributes("placeholder");
    expect(placeholder).toBe(buildViralSampleJson(zhMessages.viralAnalysis.manualDataSampleTitles));
    expect(JSON.parse(placeholder)).toHaveLength(3);
  });

  it("M3 输入回传 update:modelValue（状态归父视图，子组件不自持）", async () => {
    const w = createInput();
    await w.find("[data-testid='viral-article-textarea']").setValue('[{"title":"A"}]');
    expect(w.emitted("update:modelValue")[0]).toEqual(['[{"title":"A"}]']);
  });

  it("M4 点示例按钮只发 fill-sample 事件，填入内容由父视图决定", async () => {
    const w = createInput();
    await w.find("[data-testid='viral-fill-sample']").trigger("click");
    expect(w.emitted("fill-sample")).toHaveLength(1);
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("M5 错误横幅按 error 显隐（空串不渲染，非空带 role=alert）", async () => {
    const hidden = createInput();
    await nextTick();
    expect(hidden.find("[data-testid='viral-article-data-error']").exists()).toBe(false);

    const shown = createInput({ error: tZh("viralAnalysis.articleDataInvalid") });
    await nextTick();
    const banner = shown.find("[data-testid='viral-article-data-error']");
    expect(banner.exists()).toBe(true);
    expect(banner.attributes("role")).toBe("alert");
    expect(banner.text()).toContain(tZh("viralAnalysis.articleDataInvalid"));
  });

  it("M6 父视图传入的既有数据原样回填 textarea（受控组件不回吞内容）", async () => {
    const json = buildViralSampleJson("A|B");
    const w = createInput({ modelValue: json });
    await nextTick();
    expect(w.find("[data-testid='viral-article-textarea']").element.value).toBe(json);
  });
});
