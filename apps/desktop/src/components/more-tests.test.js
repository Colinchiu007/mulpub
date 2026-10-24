import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

const mockStore = {
  isPro: false,
  isTrial: false,
  isFree: true,
  daysRemaining: 0,
  licenseType: "free",
  info: { type: "free", isPro: false, isTrial: false, daysRemaining: 0 },
  load: vi.fn(),
  activate: vi.fn().mockResolvedValue(false),
  deactivate: vi.fn(),
  activateTrial: vi.fn().mockResolvedValue(false),
};

// Mock the license store module - use shared object so tests and component use the same instance
vi.mock("@/stores/license", () => ({
  useLicenseStore: () => mockStore,
}));

import TrialBanner from "./TrialBanner.vue";
// 2026-10-24 member-center-revamp：UpgradeModal 随 P0-6 退役（死胡同 + 假陈述
// 文案「已开通」），其 import 与独立测试文件一并移除。原 i18n 说明保留——
// TrialBanner 的用户可见文案仍受 locale 成对门禁约束。
// 口径与 BackToTop.test.js 一致：`import i18n from "@/i18n"`，**不 stub `t`**。
import i18n from "@/i18n";

describe("TrialBanner", () => {
  it("renders banner when not dismissed (free mode)", () => {
    const w = mount(TrialBanner);
    expect(w.find(".trial-banner").exists()).toBe(true);
    expect(w.find(".trial-banner.free").exists()).toBe(true);
  });

  it("does not render when dismissed", () => {
    const w = mount(TrialBanner, { props: { dismissed: true } });
    expect(w.find(".trial-banner").exists()).toBe(false);
  });

  it("has upgrade button", () => {
    const w = mount(TrialBanner);
    expect(w.find(".banner-btn").text()).toContain("升级");
  });

  it("has close button", () => {
    const w = mount(TrialBanner);
    expect(w.find(".banner-close").exists()).toBe(true);
  });
});
