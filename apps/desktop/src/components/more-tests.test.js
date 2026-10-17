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
import UpgradeModal from "./UpgradeModal.vue";
// 2026-10-07 disable-simulated-payment-in-prod：UpgradeModal 起用了 useI18n()
// （正式包「付费通道筹备中」走 locale，QG Static 的 check-locale-sync 要求
// 渲染端用户可见文案必须 zh/en 成对），故本文件全部 mount 需挂真实 i18n 实例。
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
