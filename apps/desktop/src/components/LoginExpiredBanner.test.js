import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/i18n";

import LoginExpiredBanner from "./LoginExpiredBanner.vue";

function mountBanner(props = {}) {
  return mount(LoginExpiredBanner, {
    props: { visible: true, expiredCount: 1, ...props },
    global: { plugins: [i18n] },
  });
}

describe("LoginExpiredBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18n.global.locale.value = "zh";
  });

  it("renders nothing when visible is false", async () => {
    const w = mountBanner({ visible: false });
    await nextTick();
    expect(w.find(".login-expired-banner").exists()).toBe(false);
  });

  it("renders title, description with count and batch login button", async () => {
    const w = mountBanner({ expiredCount: 3 });
    await nextTick();
    expect(w.find(".login-expired-banner").exists()).toBe(true);
    expect(w.text()).toContain("登录失效提醒");
    expect(w.text()).toContain("3 个账号待处理");
    expect(w.text()).toContain("批量登录");
  });

  it("emits batch-login on button click", async () => {
    const w = mountBanner();
    await nextTick();
    await w.find(".banner-btn").trigger("click");
    expect(w.emitted("batch-login")).toBeTruthy();
  });

  it("disables batch button and shows loading text while batchLoading", async () => {
    const w = mountBanner({ batchLoading: true });
    await nextTick();
    const btn = w.find(".banner-btn");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.text()).toContain("打开中");
    await btn.trigger("click");
    expect(w.emitted("batch-login")).toBeFalsy();
  });

  it("emits dismiss on close click", async () => {
    const w = mountBanner();
    await nextTick();
    await w.find(".banner-close").trigger("click");
    expect(w.emitted("dismiss")).toBeTruthy();
  });
});

describe("LoginExpiredBanner 全部保存（方案三）", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh";
  });

  function mountB(props = {}) {
    return mount(LoginExpiredBanner, {
      props: { visible: true, expiredCount: 1, ...props },
      global: { plugins: [i18n] },
    });
  }

  it("unsavedCount>0 时渲染「全部保存（N）」按钮并 emit save-all", async () => {
    const w = mountB({ unsavedCount: 2 });
    await nextTick();
    const btn = w.find('[data-testid="banner-save-all"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("全部保存（2）");
    await btn.trigger("click");
    expect(w.emitted("save-all")).toBeTruthy();
  });

  it("unsavedCount=0 时不渲染全部保存按钮", async () => {
    const w = mountB({ unsavedCount: 0 });
    await nextTick();
    expect(w.find('[data-testid="banner-save-all"]').exists()).toBe(false);
  });
});
