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
    subscribeEvents: vi.fn().mockResolvedValue({ code: 0, data: { subscriberId: "sub-1-abc" } }),
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

describe('useTabStore 凭证保存态（批量登录保存三方案）', () => {
  const homeTab = { tabId: 'home', url: '', title: '首页', loading: false, canGoBack: false, canGoForward: false, isActive: false, isHome: true }
  function accountTab(tabId, extra) {
    return { ...createTabData(tabId, '账号 ' + tabId, true), accountId: tabId, platform: 'douyin', credentialSaveState: null, ...extra }
  }

  beforeEach(() => { setActivePinia(createPinia()); window.electronAPI = {} })
  afterEach(() => { delete window.electronAPI })

  it('unsavedCount/unsavedTabs 统计 credentialSaveState==="unsaved" 的账号标签', async () => {
    const getAllTabs = vi.fn().mockResolvedValue({
      code: 0,
      data: [homeTab, accountTab('atab-1', { credentialSaveState: 'unsaved' }), accountTab('atab-2', { credentialSaveState: 'saved' })],
    })
    const { api } = createPageManagerApi({ getAllTabs })
    window.electronAPI.pageManager = api
    const store = useTabStore()
    await store.init()
    expect(store.unsavedCount).toBe(1)
    expect(store.unsavedTabs.map((t) => t.tabId)).toEqual(['atab-1'])
  })

  it('tab-credential-state-changed 事件实时熄灭对应标签角标（不重拉列表）', async () => {
    const getAllTabs = vi.fn().mockResolvedValue({
      code: 0, data: [homeTab, accountTab('atab-1', { credentialSaveState: 'unsaved' })],
    })
    const { api, handlers } = createPageManagerApi({ getAllTabs })
    window.electronAPI.pageManager = api
    const store = useTabStore()
    await store.init()
    expect(store.unsavedCount).toBe(1)
    handlers.get('tab-credential-state-changed')({ tabId: 'atab-1', credentialSaveState: 'saved' })
    expect(store.unsavedCount).toBe(0)
    // 仅本地更新，不触发额外 getAllTabs（init 内已调用一次，事件后仍为一次）
    expect(getAllTabs).toHaveBeenCalledTimes(1)
  })

  it('saveAllUnsavedAccounts 调用 API 成功后刷新标签列表', async () => {
    const base = createPageManagerApi()
    const saveAllUnsavedAccounts = vi.fn().mockResolvedValue({ code: 0, data: { attempted: 1, saved: 1, failed: [] } })
    const api = { ...base.api, saveAllUnsavedAccounts }
    window.electronAPI.pageManager = api
    const store = useTabStore()
    await store.init()
    api.getAllTabs.mockClear()
    const data = await store.saveAllUnsavedAccounts()
    expect(saveAllUnsavedAccounts).toHaveBeenCalledTimes(1)
    expect(data).toMatchObject({ saved: 1 })
    expect(api.getAllTabs).toHaveBeenCalled()
  })

  it('saveAllUnsavedAccounts 无 API 时返回 null（不抛错）', async () => {
    const base = createPageManagerApi()
    const api = { ...base.api }
    delete api.saveAllUnsavedAccounts
    window.electronAPI.pageManager = api
    const store = useTabStore()
    await store.init()
    await expect(store.saveAllUnsavedAccounts()).resolves.toBeNull()
  })

  it('getAccountTabSaveState 返回护栏查询 data', async () => {
    const base = createPageManagerApi()
    const getAccountTabSaveState = vi.fn().mockResolvedValue({ code: 0, data: { isAccountTab: true, credentialSaveState: 'unsaved' } })
    const api = { ...base.api, getAccountTabSaveState }
    window.electronAPI.pageManager = api
    const store = useTabStore()
    await store.init()
    const r = await store.getAccountTabSaveState('atab-1')
    expect(getAccountTabSaveState).toHaveBeenCalledWith('atab-1')
    expect(r).toMatchObject({ isAccountTab: true, credentialSaveState: 'unsaved' })
  })
})

describe("useTabStore home-shell 聚焦态与 spaRoute 同步（方案 B 侧边栏跟随）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  function createShellTabApi() {
    const shellTab = {
      tabId: "shell-1",
      url: "",
      title: "新标签页",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      isActive: true,
      isHome: false,
      homeShell: true,
      spaRoute: "/collection",
    };
    return createPageManagerApi({
      getAllTabs: vi.fn().mockResolvedValue({
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
          shellTab,
        ],
      }),
      getActiveTab: vi.fn().mockResolvedValue({ code: 0, data: { ...shellTab } }),
    });
  }

  it("聚焦标签 homeShell=true 时 activeTabIsHomeShell 为 true", async () => {
    const { api } = createShellTabApi();
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();

    expect(store.activeTabId).toBe("shell-1");
    expect(store.activeTabIsHomeShell).toBe(true);
    expect(store.isHomeTab).toBe(false);
  });

  it("onNavigationChanged 携带 spaRoute/homeShell 时实时更新对应 tab", async () => {
    const { api, handlers } = createShellTabApi();
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    handlers.get("navigation-changed")({
      tabId: "shell-1",
      url: "",
      title: "新标签页",
      homeShell: true,
      spaRoute: "/publish",
    });

    const tab = store.tabs.find((t) => t.tabId === "shell-1");
    expect(tab.spaRoute).toBe("/publish");
    expect(tab.homeShell).toBe(true);
  });

  it("普通网页标签聚焦时 activeTabIsHomeShell 为 false（不误判）", async () => {
    const { api } = createPageManagerApi();
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();

    expect(store.activeTabId).toBe("btab-1");
    expect(store.activeTabIsHomeShell).toBe(false);
  });

  it("dispose 用 init 拿到的 subscriberId 注销，不裸调 unsubscribeEvents", async () => {
    const { api } = createPageManagerApi();
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    await store.dispose();

    expect(api.unsubscribeEvents).toHaveBeenCalledWith("sub-1-abc");
  });

  it("订阅未返回 id 时 dispose 传 null，交由主进程忽略而非清空全部订阅", async () => {
    const { api } = createPageManagerApi();
    api.subscribeEvents = vi.fn().mockResolvedValue({ code: 0 });
    window.electronAPI.pageManager = api;
    const store = useTabStore();

    await store.init();
    await store.dispose();

    expect(api.unsubscribeEvents).toHaveBeenCalledWith(null);
  });
});
