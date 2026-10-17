/**
 * stores/license.js — Pinia License Store 完整测试
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLicenseStore } from "./license.js";

describe("useLicenseStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    delete window.electronAPI;
  });

  it("initial state is free", () => {
    const store = useLicenseStore();
    expect(store.isPro).toBe(false);
    expect(store.isFree).toBe(true);
    expect(store.isTrial).toBe(false);
    expect(store.licenseType).toBe("free");
    expect(store.daysRemaining).toBe(0);
    expect(store.loading).toBe(false);
    expect(store.info.type).toBe("free");
  });

  describe("load()", () => {
    it("loads license info via electronAPI", async () => {
      window.electronAPI = { licenseInfo: vi.fn().mockResolvedValue({ code: 0, data: { type: "pro", isPro: true, features: ["batch"], daysRemaining: 365 } }) };
      const store = useLicenseStore();
      await store.load();
      expect(window.electronAPI.licenseInfo).toHaveBeenCalled();
      expect(store.isPro).toBe(true);
      expect(store.licenseType).toBe("pro");
      expect(store.daysRemaining).toBe(365);
    });
    it("falls back when electronAPI unavailable", async () => {
      const store = useLicenseStore();
      await store.load();
      expect(store.isPro).toBe(false);
      expect(store.loading).toBe(false);
    });
    it("handles API error gracefully", async () => {
      window.electronAPI = { licenseInfo: vi.fn().mockRejectedValue(new Error("network")) };
      const store = useLicenseStore();
      await store.load();
      expect(store.isPro).toBe(false);
      expect(store.info.type).toBe("free");
    });
  });

  describe("deactivate()", () => {
    it("deactivates and reloads", async () => {
      window.electronAPI = {
        licenseDeactivate: vi.fn().mockResolvedValue({ code: 0 }),
        licenseInfo: vi.fn().mockResolvedValue({ code: 0, data: { type: "free", isPro: false, features: [], daysRemaining: 0 } }),
      };
      const store = useLicenseStore();
      await store.deactivate();
      expect(window.electronAPI.licenseDeactivate).toHaveBeenCalled();
      expect(store.isPro).toBe(false);
    });
    it("handles missing electronAPI", async () => {
      const store = useLicenseStore();
      await store.deactivate();
      expect(store.isPro).toBe(false);
    });
  });

  describe("activateTrial()", () => {
    it("activates trial and reloads", async () => {
      window.electronAPI = {
        licenseActivateTrial: vi.fn().mockResolvedValue({ code: 0 }),
        licenseInfo: vi.fn().mockResolvedValue({ code: 0, data: { type: "trial", isPro: true, isTrial: true, features: [], daysRemaining: 7 } }),
      };
      const store = useLicenseStore();
      const result = await store.activateTrial();
      expect(window.electronAPI.licenseActivateTrial).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(store.isTrial).toBe(true);
      expect(store.daysRemaining).toBe(7);
    });
    it("returns false when trial fails", async () => {
      window.electronAPI = { licenseActivateTrial: vi.fn().mockResolvedValue({ code: 1 }) };
      const store = useLicenseStore();
      const result = await store.activateTrial();
      expect(result).toBe(false);
    });
    it("returns false when electronAPI unavailable", async () => {
      const store = useLicenseStore();
      const result = await store.activateTrial();
      expect(result).toBe(false);
    });
  });

  describe("computed properties", () => {
    it("isFree is true when not pro", () => {
      const store = useLicenseStore();
      expect(store.isFree).toBe(true);
      store.info = { type: "pro", isPro: true, features: [], daysRemaining: 30 };
      expect(store.isFree).toBe(false);
    });
    it("isTrial reflects trial status", () => {
      const store = useLicenseStore();
      expect(store.isTrial).toBe(false);
      store.info = { ...store.info, isTrial: true };
      expect(store.isTrial).toBe(true);
    });
    it("daysRemaining falls back to 0", () => {
      const store = useLicenseStore();
      expect(store.daysRemaining).toBe(0);
    });
  });
});

