import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import fs from "node:fs";
import path from "node:path";

const mockStore = {
  isPro: false, isTrial: false, isFree: true,
  daysRemaining: 0, load: vi.fn(),
  deactivate: vi.fn(), activateTrial: vi.fn()
};
vi.mock("@/stores/license", () => ({
  useLicenseStore: () => mockStore
}));

import i18n from "@/i18n"
import UpgradeModal from "./UpgradeModal.vue";

/**
 * 本文件在 2026-10-17（remove-buyout-license）**重写**。
 *
 * 原文件有 269 行、十几条用例，其中 7 条锁的是「买断支付流程」：选择支付方式 →
 * 创建订单 → 扫码 → 模拟支付 → 取消订单。买断授权模型已整体移除，那条链路连同
 * `payment-manager` 一起删了——留着这些用例只会永远红，且它们锁的事实已不存在。
 *
 * 重写后只锁**当前仍然成立**的能力，并额外加一条源码锁防止支付 UI 悄悄长回来。
 * 注意这不是"放宽断言"：每条断言都对应组件现在真实会做的事。
 */
function mountInBuild (env = {}) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return mount(UpgradeModal, { global: { plugins: [i18n] } })
}

describe("UpgradeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mockStore.isPro = false; mockStore.isFree = true;
    mockStore.load.mockResolvedValue(undefined);
    mockStore.activateTrial.mockResolvedValue(true);
  });

  // 环境变量 stub 必须逐例还原，否则会泄漏到后续用例、把正式包断言悄悄变成开发包断言
  afterEach(() => { vi.unstubAllEnvs(); });

  it("renders overlay when visible", async () => {
    const w = mountInBuild()
    await nextTick();
    expect(w.find(".upgrade-overlay").exists()).toBe(true);
    expect(w.find(".plan-card").exists()).toBe(true);
    expect(w.text()).toContain("Pro");
  });

  it("emits close on overlay click", async () => {
    const w = mountInBuild()
    await nextTick();
    await w.find(".upgrade-overlay").trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("正式包（DEV=false）：不渲染任何购买入口（无「立即升级」/「确认支付」）", async () => {
    const w = mountInBuild({ DEV: false })
    await nextTick();
    expect(w.text()).not.toContain("立即升级");
    expect(w.text()).not.toContain("确认支付");
  });

  it("正式包（DEV=false）：不再对外宣称买断套餐（无 ¥99 / 永久）", async () => {
    const w = mountInBuild({ DEV: false })
    await nextTick();
    // 买断授权模型已移除；价格唯一权威源是服务端 plan-matrix 的三档订阅，
    // 由会员中心展示，本组件不得再硬编码任何金额
    expect(w.text()).not.toContain("¥99");
    expect(w.text()).not.toContain("永久");
  });

  it("如实说明付费通道现状，而不是留一个确认不了的购买按钮", async () => {
    const w = mountInBuild({ DEV: false })
    await nextTick();
    expect(w.text()).toContain("付费通道筹备中");
  });

  it("激活码入口已迁移到服务端核销（不再渲染本地输入框）", async () => {
    const w = mountInBuild({ DEV: false })
    await nextTick();
    // 本地 activate() 已随买断模型删除；页面只如实说明去向
    expect(w.find("input.upgrade-input").exists()).toBe(false);
    expect(w.text()).toContain("激活码");
  });

  it("isPro 时显示已激活徽章与注销入口", async () => {
    mockStore.isPro = true; mockStore.isFree = false;
    const w = mountInBuild({ DEV: false })
    await nextTick();
    expect(w.text()).toContain("已激活");
    expect(w.text()).toContain("注销许可证");
  });

  // 源码锁：防止支付 UI 顺着「以后要做支付」的念头悄悄长回来。
  // 行为测试证明不了"不存在"，只有对源码本身的断言能。
  it("源码锁：组件不得再引入 payment API 或硬编码买断价格", () => {
    const src = fs.readFileSync(path.join(__dirname, "UpgradeModal.vue"), "utf8")
    const code = src
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    expect(code, "又引入了 payment API 封装").not.toMatch(/paymentCreateOrder|paymentSimulate|paymentCancel/)
    expect(code, "又出现 ¥99 买断价格").not.toContain("¥99")
    expect(code, "又出现 payment-flow 支付流程容器").not.toContain("payment-flow")
  });
});
