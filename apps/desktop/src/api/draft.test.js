/**
 * 草稿箱功能测试 - 参考产品复用
 * 覆盖：API 层 + IPC 层 + Vue 组件
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("草稿箱 API (publisher.js)", () => {
  let publisher;

  beforeEach(async () => {
    vi.resetModules();
    publisher = await import("./publisher.js");
  });

  it("导出 draftSave 函数", () => {
    expect(typeof publisher.draftSave).toBe("function");
  });

  it("导出 draftList 函数", () => {
    expect(typeof publisher.draftList).toBe("function");
  });

  it("导出 draftDelete 函数", () => {
    expect(typeof publisher.draftDelete).toBe("function");
  });

  describe("draftSave", () => {
    it("调用 electronAPI.draftSave 并返回结果", async () => {
      const mockDraft = { id: "test-1", title: "测试草稿", content: "内容" };
      window.electronAPI = {
        draftSave: vi.fn().mockResolvedValue({ code: 0, data: true }),
      };
      const result = await publisher.draftSave(mockDraft);
      expect(window.electronAPI.draftSave).toHaveBeenCalledWith(mockDraft);
      expect(result.code).toBe(0);
    });

    it("electronAPI 不存在时使用 fallback", async () => {
      delete window.electronAPI;
      const result = await publisher.draftSave({ id: "test" });
      expect(result.code).toBe(-1);
      expect(result.message).toContain("electronAPI not available");
    });
  });

  describe("draftList", () => {
    it("调用 electronAPI.draftList 并返回草稿列表", async () => {
      const mockDrafts = [{ id: "1", title: "草稿1" }];
      window.electronAPI = {
        draftList: vi.fn().mockResolvedValue({ code: 0, data: mockDrafts }),
      };
      const result = await publisher.draftList();
      expect(window.electronAPI.draftList).toHaveBeenCalled();
      expect(result.data).toEqual(mockDrafts);
    });

    it("electronAPI 不存在时返回空数组", async () => {
      delete window.electronAPI;
      const result = await publisher.draftList();
      expect(result.code).toBe(0);
      expect(result.data).toEqual([]);
    });
  });

  describe("draftDelete", () => {
    it("调用 electronAPI.draftDelete 并返回结果", async () => {
      window.electronAPI = {
        draftDelete: vi.fn().mockResolvedValue({ code: 0, data: true }),
      };
      const result = await publisher.draftDelete("test-id");
      expect(window.electronAPI.draftDelete).toHaveBeenCalledWith("test-id");
      expect(result.code).toBe(0);
    });

    it("electronAPI 不存在时使用 fallback", async () => {
      delete window.electronAPI;
      const result = await publisher.draftDelete("test-id");
      expect(result.code).toBe(-1);
    });
  });
});

describe("草稿箱 IPC Handlers (store.js)", () => {
  // 模拟 store 和 ipcMain
  const mockStore = {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
  };
  const mockIpcMain = {
    handle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("注册 draftSave handler", () => {
    const registerHandlers = require("../../electron/ipc-handlers/store.js");
    registerHandlers(mockIpcMain, { store: mockStore });
    expect(mockIpcMain.handle).toHaveBeenCalledWith("draftSave", expect.any(Function));
  });

  it("注册 draftList handler", () => {
    const registerHandlers = require("../../electron/ipc-handlers/store.js");
    registerHandlers(mockIpcMain, { store: mockStore });
    expect(mockIpcMain.handle).toHaveBeenCalledWith("draftList", expect.any(Function));
  });

  it("注册 draftDelete handler", () => {
    const registerHandlers = require("../../electron/ipc-handlers/store.js");
    registerHandlers(mockIpcMain, { store: mockStore });
    expect(mockIpcMain.handle).toHaveBeenCalledWith("draftDelete", expect.any(Function));
  });
});
