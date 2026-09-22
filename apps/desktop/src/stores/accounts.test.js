import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/api/publisher", () => ({
  listAccounts: vi.fn(),
  accountDelete: vi.fn(),
  accountSetDefault: vi.fn(),
  accountUpdate: vi.fn(),
  getPlatformDefinitions: vi.fn(),
}));

import { useAccountStore } from "./accounts.js";
import { usePlatformStore } from "./platforms.js";
import {
  accountDelete,
  accountSetDefault,
  accountUpdate,
  listAccounts,
} from "@/api/publisher";

const accountsFixture = [
  { id: "wx-1", platform: "wechat_mp", name: "Beta", status: "active", created_at: "2026-02-01" },
  { id: "zh-1", platform: "zhihu", account_name: "Alpha", status: "offline", created_at: "2026-01-01" },
  { id: "wx-2", platform: "wechat_mp", name: "Gamma", status: "online", created_at: null },
];

describe("useAccountStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    vi.resetAllMocks();
    localStorage.clear();
    delete window.electronAPI;
    listAccounts.mockResolvedValue({ code: 0, data: [] });
  });

  describe("初始状态与加载", () => {
    it("初始化所有公开状态和 getter", () => {
      const store = useAccountStore();

      expect(store.accounts).toEqual([]);
      expect(store.groups).toEqual([]);
      expect(store.favoriteIds).toEqual(new Set());
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.searchQuery).toBe("");
      expect(store.filterStatus).toBe("all");
      expect(store.filterPlatform).toBe("");
      expect(store.sortBy).toBe("name");
      expect(store.sortOrder).toBe("asc");
      expect(store.selectedIds).toEqual(new Set());
      expect(store.isAllSelected).toBe(false);
      expect(store.byPlatform).toEqual({});
      expect(store.accountsBeforePlatformFilter).toEqual([]);
      expect(store.filteredAccounts).toEqual([]);
      expect(store.groupedByPlatform).toEqual([]);
    });

    it("从标准成功响应加载账号并恢复本地分组", async () => {
      const groups = [{ id: "grp-1", name: "公众号", platformFilter: null, accountIds: ["wx-1"] }];
      localStorage.setItem("mp_account_groups", JSON.stringify(groups));
      listAccounts.mockResolvedValue({ code: 0, data: accountsFixture });
      const store = useAccountStore();

      await store.load();

      expect(store.accounts).toEqual(accountsFixture);
      expect(store.groups).toEqual(groups);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("兼容直接返回数组的响应", async () => {
      listAccounts.mockResolvedValue(accountsFixture);
      const store = useAccountStore();

      await store.load();

      expect(store.accounts).toEqual(accountsFixture);
    });

    it.each([
      ["空响应", null],
      ["非零状态码", { code: 1, data: accountsFixture }],
      ["data 不是数组", { code: 0, data: {} }],
    ])("%s 时清空已有账号", async (_label, response) => {
      listAccounts.mockResolvedValue(response);
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.accounts).toEqual([]);
      expect(store.loading).toBe(false);
    });

    it("请求期间设置 loading，完成后恢复", async () => {
      let resolveRequest;
      listAccounts.mockImplementation(() => new Promise(resolve => { resolveRequest = resolve; }));
      const store = useAccountStore();

      const pending = store.load();
      expect(store.loading).toBe(true);
      resolveRequest({ code: 0, data: [] });
      await pending;

      expect(store.loading).toBe(false);
    });

    it("请求失败时清空已有账号、记录错误并结束 loading", async () => {
      listAccounts.mockRejectedValue(new Error("network"));
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.accounts).toEqual([]);
      expect(store.error).toBe("network");
      expect(store.loading).toBe(false);
    });

    it("code 非零时记录错误（静默清空会被误显示为「暂无账号」）", async () => {
      listAccounts.mockResolvedValue({
        code: -1, status: 503, errorCode: "AUTH_JWKS_UNAVAILABLE",
        message: "AUTH_JWKS_UNAVAILABLE", data: [],
      });
      const store = useAccountStore();

      await store.load();

      expect(store.error).toBeTruthy();
      expect(store.loading).toBe(false);
    });

    it("上游瞬时失败（errorCode 命中）保留已有账号列表", async () => {
      listAccounts.mockResolvedValue({
        code: -503, status: 503, errorCode: "AUTH_JWKS_UNAVAILABLE",
        message: "AUTH_JWKS_UNAVAILABLE", data: [],
      });
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.accounts).toEqual(accountsFixture);
      expect(store.error).toBeTruthy();
    });

    it("无 errorCode 但 HTTP 状态 >= 500 同样按瞬时失败处理", async () => {
      listAccounts.mockResolvedValue({ code: -502, status: 502, message: "backend crashed", data: [] });
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.accounts).toEqual(accountsFixture);
    });

    it("瞬时失败不标记已加载，下次进入账号页会重新拉取", async () => {
      listAccounts.mockResolvedValue({ code: -503, status: 503, errorCode: "AUTH_JWKS_UNAVAILABLE", data: [] });
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.loaded).toBe(false);
    });

    it("网络 reject 归类为瞬时失败：保留列表且不标记已加载", async () => {
      listAccounts.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8299"));
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.accounts).toEqual(accountsFixture);
      expect(store.errorCode).toBe("NETWORK_ERROR");
      expect(store.loaded).toBe(false);
    });

    it("超时 reject 归类为瞬时失败并保留列表", async () => {
      listAccounts.mockRejectedValue(new Error("request timeout"));
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.accounts).toEqual(accountsFixture);
      expect(store.errorCode).toBe("TIMEOUT");
    });

    it("暴露 AUTH_REQUIRED 错误码供界面分流（登录引导 vs 错误态）", async () => {
      listAccounts.mockResolvedValue({ code: -3, message: "无法识别当前用户", data: [] });
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await store.load();

      expect(store.errorCode).toBe("AUTH_REQUIRED");
      expect(store.accounts).toEqual([]);
    });

    it("重复加载会替换数据并清除上一次错误", async () => {
      listAccounts
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValueOnce({ code: 0, data: accountsFixture });
      const store = useAccountStore();

      await store.load();
      await store.load();

      expect(listAccounts).toHaveBeenCalledTimes(2);
      expect(store.accounts).toEqual(accountsFixture);
      expect(store.error).toBeNull();
    });
  });

  describe("账号 getter、筛选与排序", () => {
    it("按平台聚合账号，包括缺少 platform 的账号", () => {
      const store = useAccountStore();
      store.accounts = [...accountsFixture, { id: "unknown" }];

      expect(store.byPlatform.wechat_mp).toHaveLength(2);
      expect(store.byPlatform.zhihu).toHaveLength(1);
      expect(store.byPlatform.undefined).toEqual([{ id: "unknown" }]);
    });

    it.each([
      ["名称", "be", ["wx-1"]],
      ["账号名", "ALP", ["zh-1"]],
      ["平台", "WECHAT", ["wx-1", "wx-2"]],
      ["无匹配", "missing", []],
    ])("搜索支持%s并忽略大小写", (_label, query, expectedIds) => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.searchQuery = query;

      expect(store.filteredAccounts.map(account => account.id)).toEqual(expectedIds);
    });

    it("搜索支持平台中文名称", () => {
      const platformStore = usePlatformStore();
      platformStore.names = { wechat_mp: "微信公众号", zhihu: "知乎" };
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.searchQuery = "知乎";

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["zh-1"]);
    });

    it("搜索时账号缺少所有可搜索字段也不会报错", () => {
      const store = useAccountStore();
      store.accounts = [{ id: "empty" }];
      store.searchQuery = "query";

      expect(store.filteredAccounts).toEqual([]);
    });

    it("状态筛选将 active 和 online 视为活跃", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;

      store.filterStatus = "active";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["wx-1", "wx-2"]);

      store.filterStatus = "inactive";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["zh-1"]);
    });

    it("平台筛选与搜索条件组合生效且不修改原数组", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.searchQuery = "a";
      store.filterPlatform = "wechat_mp";

      expect(store.accountsBeforePlatformFilter.map(account => account.id)).toEqual(["zh-1", "wx-1", "wx-2"]);
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["wx-1", "wx-2"]);
      expect(store.accounts.map(account => account.id)).toEqual(["wx-1", "zh-1", "wx-2"]);
    });

    it("名称排序使用 account_name 和空字符串作为回退值", () => {
      const store = useAccountStore();
      store.accounts = [
        { id: "empty" },
        { id: "account-name", account_name: "Alpha" },
        { id: "name", name: "beta" },
      ];

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["empty", "account-name", "name"]);
      store.sortOrder = "desc";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["name", "account-name", "empty"]);
    });

    it("名称排序与卡片显示统一优先使用 account_name", () => {
      const store = useAccountStore()
      store.accounts = [
        { id: "canonical-alpha", account_name: "Alpha", name: "Zulu" },
        { id: "canonical-zulu", account_name: "Zulu", name: "Alpha" },
      ]
      store.sortBy = "name"

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["canonical-alpha", "canonical-zulu"])
    })

    it("按创建时间升序和降序排序，缺失时间按 epoch 处理", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.sortBy = "created_at";

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["wx-2", "zh-1", "wx-1"]);
      store.sortOrder = "desc";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["wx-1", "zh-1", "wx-2"]);
    });

    it("按任意字段排序并保持相等值的原始顺序", () => {
      const store = useAccountStore();
      store.accounts = [
        { id: "a", priority: 2 },
        { id: "b", priority: 1 },
        { id: "c", priority: 2 },
        { id: "d" },
      ];
      store.sortBy = "priority";

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["d", "b", "a", "c"]);
      store.sortOrder = "desc";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["a", "c", "b", "d"]);
    });

    it("排序比较器对右侧账号缺失字段使用空值回退", () => {
      const store = useAccountStore();
      store.accounts = [
        { id: "empty" },
        { id: "dated", created_at: "2026-01-01", priority: 1 },
      ];

      store.sortBy = "created_at";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["empty", "dated"]);

      store.sortBy = "priority";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["empty", "dated"]);
    });

    it("平台排序使用平台中文标签并支持升降序", () => {
      const platformStore = usePlatformStore()
      platformStore.names = { douyin: "抖音", wechat_mp: "微信公众号", zhihu: "知乎" }
      const store = useAccountStore()
      store.accounts = [
        { id: "zhihu", platform: "zhihu", name: "同名" },
        { id: "wechat", platform: "wechat_mp", name: "同名" },
        { id: "douyin", platform: "douyin", name: "同名" },
      ]
      store.sortBy = "platform"

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["wechat", "douyin", "zhihu"])
      store.sortOrder = "desc"
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["zhihu", "douyin", "wechat"])
    })

    it("粉丝数排序归一化数字、逗号、万和 k，并保持相等值稳定", () => {
      const store = useAccountStore()
      store.accounts = [
        { id: "missing", followers: "unknown" },
        { id: "two-k", followers: "2k" },
        { id: "ten-thousand", followers: "1万" },
        { id: "comma", followers: "10,000" },
      ]
      store.sortBy = "followers"

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["missing", "two-k", "ten-thousand", "comma"])
      store.sortOrder = "desc"
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["ten-thousand", "comma", "two-k", "missing"])
    })

    it("最后使用排序将非法日期视为最小值", () => {
      const store = useAccountStore()
      store.accounts = [
        { id: "invalid", last_used_at: "not-a-date" },
        { id: "old", last_used_at: "2026-01-01T00:00:00Z" },
        { id: "new", last_used_at: "2026-08-01T00:00:00Z" },
      ]
      store.sortBy = "last_used_at"

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["invalid", "old", "new"])
      store.sortOrder = "desc"
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["new", "old", "invalid"])
    })

    it("登录状态排序将活跃账号置于有效分组并保持同值原始顺序", () => {
      const store = useAccountStore()
      store.accounts = [
        { id: "offline", status: "offline" },
        { id: "online", status: "online" },
        { id: "error", status: "error" },
        { id: "active", status: "active" },
      ]
      store.sortBy = "status"

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["offline", "error", "online", "active"])
      store.sortOrder = "desc"
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["online", "active", "offline", "error"])
    })

    it("筛选后排序仍以筛选结果的原始顺序作为稳定 tie-break", () => {
      const store = useAccountStore()
      store.accounts = [
        { id: "inactive-first", status: "inactive", name: "同名" },
        { id: "active-first", status: "active", name: "同名" },
        { id: "active-second", status: "online", name: "同名" },
      ]
      store.filterStatus = "active"
      store.sortBy = "name"

      expect(store.filteredAccounts.map(account => account.id)).toEqual(["active-first", "active-second"])
    })

    it("平台分组统计活跃和非活跃账号，并按活跃数及总数排序", () => {
      const store = useAccountStore();
      store.accounts = [
        { id: "a1", platform: "a", status: "active" },
        { id: "a2", platform: "a", status: "offline" },
        { id: "b1", platform: "b", status: "online" },
        { id: "b2", platform: "b", status: "offline" },
        { id: "b3", platform: "b", status: "offline" },
        { id: "c1", platform: "c", status: "offline" },
      ];

      expect(store.groupedByPlatform).toEqual([
        { platform: "b", accounts: expect.any(Array), activeCount: 1, inactiveCount: 2 },
        { platform: "a", accounts: expect.any(Array), activeCount: 1, inactiveCount: 1 },
        { platform: "c", accounts: expect.any(Array), activeCount: 0, inactiveCount: 1 },
      ]);
      expect(store.groupedByPlatform[0].accounts.map(account => account.id)).toEqual(["b1", "b2", "b3"]);
    });

    it("平台分组遵循当前筛选条件", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.filterStatus = "inactive";

      expect(store.groupedByPlatform.map(group => group.platform)).toEqual(["zhihu"]);
    });
  });

  describe("本地分组", () => {
    it("loadGroups 从 localStorage 恢复分组", () => {
      const groups = [{ id: "grp-1", name: "知乎组", platformFilter: null, accountIds: ["zh-1"] }];
      localStorage.setItem("mp_account_groups", JSON.stringify(groups));
      const store = useAccountStore();

      store.loadGroups();

      expect(store.groups).toEqual(groups);
    });

    it.each([
      ["没有缓存", null],
      ["缓存 JSON 损坏", "{invalid"],
    ])("%s 时 loadGroups 回退为空数组", (_label, raw) => {
      if (raw !== null) localStorage.setItem("mp_account_groups", raw);
      const store = useAccountStore();
      store.groups = [{ id: "stale" }];

      store.loadGroups();

      expect(store.groups).toEqual([]);
    });

    it("localStorage 读取异常时 loadGroups 回退为空数组", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
      const store = useAccountStore();
      store.groups = [{ id: "stale" }];

      expect(() => store.loadGroups()).not.toThrow();
      expect(store.groups).toEqual([]);
    });

    it("createGroup 创建唯一分组、规范化空平台并持久化", () => {
      vi.spyOn(Date, "now").mockReturnValue(123);
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const store = useAccountStore();

      const group = store.createGroup("常用账号", "");

      expect(group).toEqual({ id: expect.stringMatching(/^grp_123_/), name: "常用账号", platformFilter: null, accountIds: [] });
      expect(store.groups).toEqual([group]);
      expect(JSON.parse(localStorage.getItem("mp_account_groups"))).toEqual([group]);
    });

    it("renameGroup 更新名称并拒绝重复名称", () => {
      const store = useAccountStore();
      store.groups = [{ id: "keep", name: "常用" }, { id: "rename", name: "旧名称" }];

      expect(store.renameGroup("rename", "新名称")).toBe(true);
      expect(store.groups[1].name).toBe("新名称");
      expect(store.renameGroup("rename", "常用")).toBe(false);
      expect(store.renameGroup("rename", "  ")).toBe(false);
      expect(JSON.parse(localStorage.getItem("mp_account_groups"))).toEqual(store.groups);
    });

    it("setGroupPlatform 更新平台并移除不匹配成员", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.groups = [{ id: "group", name: "混合", platformFilter: null, accountIds: ["wx-1", "zh-1"] }];

      expect(store.setGroupPlatform("group", "wechat_mp")).toBe(true);
      expect(store.groups[0]).toMatchObject({ platformFilter: "wechat_mp", accountIds: ["wx-1"] });
      expect(JSON.parse(localStorage.getItem("mp_account_groups"))).toEqual(store.groups);
    });

    it("deleteGroup 删除目标分组并持久化", () => {
      const store = useAccountStore();
      store.groups = [{ id: "keep" }, { id: "delete" }];

      store.deleteGroup("delete");

      expect(store.groups).toEqual([{ id: "keep" }]);
      expect(JSON.parse(localStorage.getItem("mp_account_groups"))).toEqual([{ id: "keep" }]);
    });

    it("重复删除不存在的分组保持状态不变", () => {
      const store = useAccountStore();
      store.groups = [{ id: "keep" }];

      store.deleteGroup("missing");
      store.deleteGroup("missing");

      expect(store.groups).toEqual([{ id: "keep" }]);
    });

    it("getGroupAccounts 对不存在分组返回空数组", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;

      expect(store.getGroupAccounts("missing")).toEqual([]);
    });

    it("getGroupAccounts 按分组平台筛选账号", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.groups = [{ id: "wechat", platformFilter: "wechat_mp", accountIds: ["wx-1", "wx-2"] }];

      expect(store.getGroupAccounts("wechat").map(account => account.id)).toEqual(["wx-1", "wx-2"]);
    });

    it("无平台限制的分组只返回显式成员账号数组副本", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.groups = [{ id: "all", platformFilter: null, accountIds: ["wx-1", "zh-1"] }];

      const result = store.getGroupAccounts("all");

      expect(result.map(account => account.id)).toEqual(["wx-1", "zh-1"]);
      expect(result).not.toBe(store.accounts);
    });

    it("旧分组迁移为显式成员快照并持久化", () => {
      localStorage.setItem("mp_account_groups", JSON.stringify([
        { id: "wechat", name: "微信组", platformFilter: "wechat_mp" },
        { id: "all", name: "全部", platformFilter: null },
      ]));
      const store = useAccountStore();
      store.accounts = accountsFixture;

      store.loadGroups();

      expect(store.groups[0].accountIds).toEqual(["wx-1", "wx-2"]);
      expect(store.groups[1].accountIds).toEqual(["wx-1", "zh-1", "wx-2"]);
      expect(JSON.parse(localStorage.getItem("mp_account_groups"))).toEqual(store.groups);
    });

    it("分组成员可增删并持久化", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      const group = store.createGroup("运营组", "", ["wx-1"]);

      expect(store.isAccountInGroup(group.id, "wx-1")).toBe(true);
      store.toggleAccountInGroup(group.id, "zh-1");
      expect(store.getGroupAccounts(group.id).map(account => account.id)).toEqual(["wx-1", "zh-1"]);
      store.toggleAccountInGroup(group.id, "wx-1");
      expect(store.getGroupAccounts(group.id).map(account => account.id)).toEqual(["zh-1"]);
      expect(JSON.parse(localStorage.getItem("mp_account_groups"))[0].accountIds).toEqual(["zh-1"]);
    });
  });

  describe("账号收藏", () => {
    it("收藏状态可切换、持久化并用于筛选", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;

      store.toggleFavorite("zh-1");
      expect(store.isFavorite("zh-1")).toBe(true);
      expect(JSON.parse(localStorage.getItem("mp_account_favorites"))).toEqual(["zh-1"]);

      store.filterStatus = "favorite";
      expect(store.filteredAccounts.map(account => account.id)).toEqual(["zh-1"]);

      store.toggleFavorite("zh-1");
      expect(store.isFavorite("zh-1")).toBe(false);
    });

    it("加载后清理已不存在账号的收藏和分组成员", async () => {
      localStorage.setItem("mp_account_favorites", JSON.stringify(["wx-1", "missing"]));
      localStorage.setItem("mp_account_groups", JSON.stringify([
        { id: "g1", name: "组", platformFilter: null, accountIds: ["wx-1", "missing"] },
      ]));
      listAccounts.mockResolvedValue({ code: 0, data: [accountsFixture[0]] });
      const store = useAccountStore();

      await store.load();

      expect(store.favoriteIds).toEqual(new Set(["wx-1"]));
      expect(store.groups[0].accountIds).toEqual(["wx-1"]);
    });
  });

  describe("选择与批量操作", () => {
    it("toggleSelect 可选择并再次取消同一账号", () => {
      const store = useAccountStore();

      store.toggleSelect("a1");
      expect(store.selectedIds).toEqual(new Set(["a1"]));
      store.toggleSelect("a1");
      expect(store.selectedIds).toEqual(new Set());
    });

    it("selectAll 只选择筛选结果，再次调用清空选择", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.filterPlatform = "wechat_mp";

      store.selectAll();
      expect(store.selectedIds).toEqual(new Set(["wx-1", "wx-2"]));
      expect(store.isAllSelected).toBe(true);

      store.selectAll();
      expect(store.selectedIds).toEqual(new Set());
      expect(store.isAllSelected).toBe(false);
    });

    it("selectAll 可按页面传入的可见账号范围切换选择", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.toggleSelect("zh-1");

      store.selectAll(["wx-1", "wx-2"]);
      expect(store.selectedIds).toEqual(new Set(["zh-1", "wx-1", "wx-2"]));

      store.selectAll(["wx-1", "wx-2"]);
      expect(store.selectedIds).toEqual(new Set(["zh-1"]));
    });

    it("空列表全选保持空集合且不进入全选状态", () => {
      const store = useAccountStore();

      store.selectAll();

      expect(store.selectedIds).toEqual(new Set());
      expect(store.isAllSelected).toBe(false);
    });

    it("全选后取消一个账号，再次全选会补齐全部账号", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;

      store.selectAll();
      store.toggleSelect("zh-1");
      expect(store.isAllSelected).toBe(false);

      store.selectAll();

      expect(store.selectedIds).toEqual(new Set(["wx-1", "zh-1", "wx-2"]));
      expect(store.isAllSelected).toBe(true);
    });

    it("筛选条件变化后全选状态只反映当前可见账号", () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;
      store.toggleSelect("wx-1");
      store.toggleSelect("wx-2");

      store.filterPlatform = "wechat_mp";
      expect(store.isAllSelected).toBe(true);

      store.filterPlatform = "zhihu";
      expect(store.isAllSelected).toBe(false);
    });

    it("刷新后移除已不存在账号的选择", async () => {
      listAccounts.mockResolvedValue({ code: 0, data: [accountsFixture[0]] });
      const store = useAccountStore();
      store.selectedIds = new Set(["wx-1", "missing"]);

      await store.load();

      expect(store.selectedIds).toEqual(new Set(["wx-1"]));
      expect(store.isAllSelected).toBe(true);
    });

    it("clearSelection 可重复清理选择和全选状态", () => {
      const store = useAccountStore();
      store.selectedIds = new Set(["a1"]);
      store.isAllSelected = true;

      store.clearSelection();
      store.clearSelection();

      expect(store.selectedIds).toEqual(new Set());
      expect(store.isAllSelected).toBe(false);
    });

    it("batchDelete 汇总成功、业务失败和异常并重新加载", async () => {
      accountDelete
        .mockResolvedValueOnce({ code: 0 })
        .mockResolvedValueOnce({ code: 1 })
        .mockRejectedValueOnce(new Error("offline"));
      const store = useAccountStore();
      store.selectedIds = new Set(["a", "b", "c"]);
      store.isAllSelected = true;

      const result = await store.batchDelete();

      expect(result).toEqual({ success: 1, failed: 2 });
      expect(accountDelete.mock.calls).toEqual([["a"], ["b"], ["c"]]);
      expect(store.selectedIds).toEqual(new Set());
      expect(store.isAllSelected).toBe(false);
      expect(listAccounts).toHaveBeenCalledTimes(1);
    });

    it("batchDelete 没有选中账号时不调用删除 API，但仍同步账号列表", async () => {
      const store = useAccountStore();

      await expect(store.batchDelete()).resolves.toEqual({ success: 0, failed: 0 });
      expect(accountDelete).not.toHaveBeenCalled();
      expect(listAccounts).toHaveBeenCalledTimes(1);
    });

    it("batchDelete 传入范围时只删除当前页面选中的账号", async () => {
      accountDelete.mockResolvedValue({ code: 0 });
      const store = useAccountStore();
      store.selectedIds = new Set(["wx-1", "zh-1"]);

      await expect(store.batchDelete(["wx-1"])).resolves.toEqual({ success: 1, failed: 0 });

      expect(accountDelete).toHaveBeenCalledTimes(1);
      expect(accountDelete).toHaveBeenCalledWith("wx-1");
    });

    it("batchSetStatus 为每个选中账号更新状态并汇总结果", async () => {
      accountUpdate
        .mockResolvedValueOnce({ code: 0 })
        .mockResolvedValueOnce({ code: 2 })
        .mockRejectedValueOnce(new Error("timeout"));
      const store = useAccountStore();
      store.selectedIds = new Set(["a", "b", "c"]);

      const result = await store.batchSetStatus("inactive");

      expect(result).toEqual({ success: 1, failed: 2 });
      expect(accountUpdate.mock.calls).toEqual([
        ["a", { status: "inactive" }],
        ["b", { status: "inactive" }],
        ["c", { status: "inactive" }],
      ]);
      expect(store.selectedIds).toEqual(new Set());
      expect(listAccounts).toHaveBeenCalledTimes(1);
    });

    it("batchSetStatus 没有选中账号时不调用更新 API", async () => {
      const store = useAccountStore();

      await expect(store.batchSetStatus("active")).resolves.toEqual({ success: 0, failed: 0 });
      expect(accountUpdate).not.toHaveBeenCalled();
      expect(listAccounts).toHaveBeenCalledTimes(1);
    });

    it("batchSetStatus 传入范围时只更新显式 ID", async () => {
      accountUpdate.mockResolvedValue({ code: 0 });
      const store = useAccountStore();
      store.selectedIds = new Set(["a", "b", "c"]);

      await expect(store.batchSetStatus("active", ["a", "c"])).resolves.toEqual({ success: 2, failed: 0 });

      expect(accountUpdate.mock.calls.map(call => call[0])).toEqual(["a", "c"]);
    });
  });

  describe("单账号操作", () => {
    it("getDefault 优先返回平台默认账号", () => {
      const store = useAccountStore();
      store.accounts = [
        { id: "a1", platform: "wx", is_default: false },
        { id: "a2", platform: "wx", is_default: true },
      ];

      expect(store.getDefault("wx")).toEqual(store.accounts[1]);
    });

    it("getDefault 没有显式默认账号时返回首个账号", () => {
      const store = useAccountStore();
      store.accounts = [{ id: "a1", platform: "wx", is_default: false }];

      expect(store.getDefault("wx")).toEqual(store.accounts[0]);
    });

    it("getDefault 在平台不存在或平台列表为空时返回 null", () => {
      const store = useAccountStore();

      expect(store.getDefault("wx")).toBeNull();
    });

    it("setDefault 成功后重新加载并返回原响应", async () => {
      const response = { code: 0, data: { id: "a1" } };
      accountSetDefault.mockResolvedValue(response);
      const store = useAccountStore();
      store.accounts = [{ id: "a1", platform: "wx" }];

      await expect(store.setDefault("a1", "wx")).resolves.toBe(response);
      expect(accountSetDefault).toHaveBeenCalledWith("wx", "a1");
      expect(listAccounts).toHaveBeenCalledTimes(1);
    });

    it("setDefault 业务失败时返回响应且不重新加载", async () => {
      const response = { code: 1, message: "not found" };
      accountSetDefault.mockResolvedValue(response);
      const store = useAccountStore();
      store.accounts = [{ id: "a1", platform: "wx" }];

      await expect(store.setDefault("a1", "wx")).resolves.toBe(response);
      expect(listAccounts).not.toHaveBeenCalled();
    });

    it("setDefault 拒绝把其他平台账号设为默认账号", async () => {
      const store = useAccountStore();
      store.accounts = accountsFixture;

      await expect(store.setDefault("zh-1", "wechat_mp")).resolves.toEqual({
        code: -2,
        message: "账号不属于指定平台",
      });
      expect(accountSetDefault).not.toHaveBeenCalled();
      expect(listAccounts).not.toHaveBeenCalled();
    });

    it("setDefault API 异常时返回统一失败结果", async () => {
      accountSetDefault.mockRejectedValue(new Error("offline"));
      const store = useAccountStore();
      store.accounts = [{ id: "a1", platform: "wx" }];

      await expect(store.setDefault("a1", "wx")).resolves.toEqual({ code: -1, message: "offline" });
      expect(listAccounts).not.toHaveBeenCalled();
    });

    it("renameAccount 成功后重新加载并返回原响应", async () => {
      const response = { code: 0 };
      accountUpdate.mockResolvedValue(response);
      const store = useAccountStore();

      await expect(store.renameAccount("a1", "新名称")).resolves.toBe(response);
      expect(accountUpdate).toHaveBeenCalledWith("a1", { name: "新名称" });
      expect(listAccounts).toHaveBeenCalledTimes(1);
    });

    it("renameAccount 业务失败时不重新加载", async () => {
      const response = { code: 1, message: "duplicate" };
      accountUpdate.mockResolvedValue(response);
      const store = useAccountStore();

      await expect(store.renameAccount("a1", "重复名称")).resolves.toBe(response);
      expect(listAccounts).not.toHaveBeenCalled();
    });

    it("renameAccount API 异常时返回统一失败结果", async () => {
      accountUpdate.mockRejectedValue(new Error("timeout"));
      const store = useAccountStore();

      // 超时类错误映射为「原因 + 建议」本地化文案，不直出英文原始文本
      await expect(store.renameAccount("a1", "新名称")).resolves.toEqual({ code: -1, message: "操作超时。请稍后重试；若持续出现请重启应用。" });
      expect(listAccounts).not.toHaveBeenCalled();
    });
  });
});
