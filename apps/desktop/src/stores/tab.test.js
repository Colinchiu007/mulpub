import { setActivePinia, createPinia } from "pinia";
import { useTabStore } from "./tab";

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createTabData(tabId, title, isActive = false) {
  return {
    tabId,
    url: `https://${tabId}.example.test`,
    title,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    isActive,
    isHome: false,
  };
}

function createPageManagerApi({ getAllTabs, getActiveTab } = {}) {
  const handlers = new Map();
  const api = {
    getAllTabs:
      getAllTabs ||
      vi.fn().mockResolvedValue({
        code: 0,
        data: [
          {
            tabId: "home",
            url: "",
            title: "首页",
            loading: false,
            canGoBack: false,
            canGoForward: false,
            isActive: false,
            isHome: true,
          },
          createTabData("btab-1", "抖音创作者中心", true),
          createTabData("btab-2", "快手创作者服务"),
        ],
      }),
    getActiveTab:
      getActiveTab ||
      vi.fn().mockResolvedValue({
        code: 0,
        data: { ...createTabData("btab-1", "抖音创作者中心", true), isHome: false },
      }),
    onTabEvent: vi.fn((event, callback) => {
      handlers.set(event, callback);
      return () => handlers.delete(event);
    }),
    on: vi.fn((event, callback) => {
      handlers.set(event, callback);
      return () => handlers.delete(event);
    }),
    onNavigationChanged: vi.fn((callback) => {
      handlers.set("navigation-changed", callback);
      return () => handlers.delete("navigation-changed");
    }),
    subscribeEvents: vi.fn().mockResolvedValue({ code: 0 }),
    unsubscribeEvents: vi.fn().mockResolvedValue({ code: 0 }),
  };
  return { api, handlers };
}

describe("useTabStore 标签标题同步", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it("收到非活动 tab 的标题事件时只更新对应标签", async () => {
    const { api, handlers } = createPageManagerApi();
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    handlers.get("tab-title-updated")({ tabId: "btab-2", title: "快手数据中心" });

    expect(store.tabs.find((tab) => tab.tabId === "btab-2").title).toBe("快手数据中心");
    expect(store.tabs.find((tab) => tab.tabId === "btab-1").title).toBe("抖音创作者中心");
    expect(store.navigation.title).toBe("抖音创作者中心");
  });

  it("收到活动 tab 的标题事件时同步导航栏标题", async () => {
    const { api, handlers } = createPageManagerApi();
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    handlers.get("tab-title-updated")({ tabId: "btab-1", title: "抖音内容管理" });

    expect(store.tabs.find((tab) => tab.tabId === "btab-1").title).toBe("抖音内容管理");
    expect(store.navigation.title).toBe("抖音内容管理");
  });

  it("切换事件先更新活动 tab，再刷新对应导航栏标题", async () => {
    const getActiveTab = vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        data: { ...createTabData("btab-1", "抖音创作者中心", true), isHome: false },
      })
      .mockResolvedValue({
        code: 0,
        data: { ...createTabData("btab-2", "快手数据中心", true), isHome: false },
      });
    const { api, handlers } = createPageManagerApi({ getActiveTab });
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    await handlers.get("tab-switched")({ tabId: "btab-2", title: "快手数据中心" });

    expect(store.activeTabId).toBe("btab-2");
    expect(store.navigation.title).toBe("快手数据中心");
  });

  it("较早的 getAllTabs 响应不能覆盖较新的标题快照", async () => {
    const initial = {
      code: 0,
      data: [
        {
          tabId: "home",
          url: "",
          title: "首页",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          isActive: false,
          isHome: true,
        },
        createTabData("btab-1", "初始标题", true),
      ],
    };
    const oldResponse = createDeferred();
    const newResponse = createDeferred();
    const getAllTabs = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(newResponse.promise);
    const { api, handlers } = createPageManagerApi({ getAllTabs });
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    handlers.get("tab-created")();
    handlers.get("tab-created")();

    newResponse.resolve({
      code: 0,
      data: [
        {
          tabId: "home",
          url: "",
          title: "首页",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          isActive: false,
          isHome: true,
        },
        createTabData("btab-1", "新标题", true),
      ],
    });
    await Promise.resolve();
    oldResponse.resolve({
      code: 0,
      data: [
        {
          tabId: "home",
          url: "",
          title: "首页",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          isActive: false,
          isHome: true,
        },
        createTabData("btab-1", "旧标题", true),
      ],
    });
    await Promise.all([oldResponse.promise, newResponse.promise]);
    await Promise.resolve();

    expect(store.tabs.find((tab) => tab.tabId === "btab-1").title).toBe("新标题");
  });

  it("列表刷新期间收到的标题事件不会被过期列表响应覆盖", async () => {
    const initial = {
      code: 0,
      data: [
        {
          tabId: "home",
          url: "",
          title: "首页",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          isActive: false,
          isHome: true,
        },
        createTabData("btab-1", "抖音创作者中心", true),
      ],
    };
    const staleResponse = createDeferred();
    const getAllTabs = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(staleResponse.promise);
    const { api, handlers } = createPageManagerApi({ getAllTabs });
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    const refresh = handlers.get("tab-created")();
    handlers.get("tab-title-updated")({ tabId: "btab-1", title: "抖音内容管理" });
    staleResponse.resolve({
      code: 0,
      data: [
        {
          tabId: "home",
          url: "",
          title: "首页",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          isActive: false,
          isHome: true,
        },
        createTabData("btab-1", "过期标题", true),
      ],
    });
    await refresh;

    expect(store.tabs.find((tab) => tab.tabId === "btab-1").title).toBe("抖音内容管理");
  });

  it("切换标签后返回的旧导航响应不会覆盖当前导航栏", async () => {
    const staleNavigation = createDeferred();
    const getActiveTab = vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        data: { ...createTabData("btab-1", "抖音创作者中心", true), isHome: false },
      })
      .mockReturnValueOnce(staleNavigation.promise)
      .mockResolvedValueOnce({
        code: 0,
        data: { ...createTabData("btab-2", "快手数据中心", true), isHome: false },
      });
    const { api, handlers } = createPageManagerApi({ getActiveTab });
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    const firstSwitch = handlers.get("tab-switched")({ tabId: "btab-1" });
    const secondSwitch = handlers.get("tab-switched")({ tabId: "btab-2" });

    await secondSwitch;
    staleNavigation.resolve({
      code: 0,
      data: { ...createTabData("btab-1", "过期抖音标题", true), isHome: false },
    });
    await firstSwitch;

    expect(store.activeTabId).toBe("btab-2");
    expect(store.navigation.title).toBe("快手数据中心");
  });
});
