import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const getPlatformDefinitions = vi.hoisted(() => vi.fn(() => {
  return window.electronAPI?.getPlatformDefinitions?.() ?? Promise.resolve({ code: -1 });
}));

vi.mock("@/api/publisher", () => ({ getPlatformDefinitions }));

import { usePlatformStore } from "./platforms.js";

describe("usePlatformStore", () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); delete window.electronAPI; });

  it("initial state is empty before load", () => {
    const s = usePlatformStore();
    expect(s.platforms).toEqual([]); expect(s.loaded).toBe(false);
  });

  it("load() uses fallback when electronAPI missing", async () => {
    const s = usePlatformStore(); await s.load();
    expect(s.loaded).toBe(true);
    expect(s.platforms.length).toBeGreaterThan(10);
    expect(s.getLabel("wechat_mp")).toBe("微信公众号");
    expect(s.getIcon("douyin")).toBe("platforms/douyin.svg");
  });

  it("load() fetches from electronAPI when available", async () => {
    window.electronAPI = { getPlatformDefinitions: vi.fn().mockResolvedValue({
      code: 0,
      data: {
        names: { test: "Test Platform" },
        icons: { test: "🔬" },
        dashboardUrls: { test: "https://creator.example.com/" },
        qrCodePlatforms: ["test"],
        categories: { test: "海外" },
      }
    }) };
    const s = usePlatformStore(); await s.load();
    expect(s.platforms).toEqual([{ id: "test", label: "Test Platform" }]);
    expect(s.getIcon("test")).toBe("🔬");
    expect(s.getDashboardUrl("test")).toBe("https://creator.example.com/");
    expect(s.supportsQrCode("test")).toBe(true);
    expect(s.getCategory("test")).toBe("海外");
    expect(getPlatformDefinitions).toHaveBeenCalledTimes(1);
  });

  it("load() falls back on API error", async () => {
    window.electronAPI = { getPlatformDefinitions: vi.fn().mockRejectedValue(new Error("fail")) };
    const s = usePlatformStore(); await s.load();
    expect(s.loaded).toBe(true);
    expect(s.platforms.length).toBeGreaterThan(10); // fallback
  });

  it("load() skips if already loaded", async () => {
    window.electronAPI = { getPlatformDefinitions: vi.fn() };
    const s = usePlatformStore();
    s.loaded = true; // already loaded
    await s.load();
    expect(getPlatformDefinitions).not.toHaveBeenCalled();
  });

  it("getLabel returns id as fallback", () => {
    const s = usePlatformStore();
    expect(s.getLabel("unknown_id")).toBe("unknown_id");
  });

  it("getIcon returns empty string as fallback", () => {
    const s = usePlatformStore();
    expect(s.getIcon("unknown_id")).toBe("");
  });

  // getCategoryGroup 的存在理由：getCategory() 返回的是中文值，UI 层拿它比字符串就得在
  // 渲染端代码里写中文字面量（locale-sync --cjk 门禁会判红）。翻成 ASCII 结构键后，
  // 中文字面量只留在本 store 与 locale 两处。
  it("getCategoryGroup maps the platform directory category to a structural key", () => {
    const s = usePlatformStore();
    expect(s.getCategoryGroup("wechat_mp")).toBe("domestic");
    expect(s.getCategoryGroup("youtube")).toBe("international");
    // 未登记平台回退 domestic（getCategory 返回空串，不匹配海外分支）
    expect(s.getCategoryGroup("unknown_id")).toBe("domestic");
  });

  it("getCategoryGroup follows the category loaded from the platform directory", async () => {
    window.electronAPI = { getPlatformDefinitions: vi.fn().mockResolvedValue({
      code: 0,
      data: { names: { test: "Test Platform" }, categories: { test: "海外" } },
    }) };
    const s = usePlatformStore(); await s.load();
    expect(s.getCategoryGroup("test")).toBe("international");
  });

  // 平台目录尚未加载时，getCategory 仍按**内置的 DEFAULT_CATEGORIES 逐平台**回退，
  // 不是「一律当国内」——否则加载完成前，海外平台会被错分到国内组（QM-6 外部评审 i3 的
  // 指控前提与此相反，用例把真实口径钉住，防止将来把兜底改成「全落 domestic」）。
  it("getCategoryGroup falls back per-platform before the directory is loaded", () => {
    const s = usePlatformStore();
    expect(s.getCategoryGroup("youtube")).toBe("international");
    expect(s.getCategoryGroup("twitter")).toBe("international");
    expect(s.getCategoryGroup("wechat_mp")).toBe("domestic");
    expect(s.getCategoryGroup("douyin")).toBe("domestic");
  });
});

