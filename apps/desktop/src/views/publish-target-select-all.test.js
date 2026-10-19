/**
 * publish-target-select-all.test.js — 发布页「全选 / 清空」的接线层断言（2026-10-17）
 *
 * 为什么单独一个文件：`src/views/Publish.test.js` 已被 max-lines-baseline 的 testFiles
 * 挂账（登记 1735 + 容差 200），往里堆用例就是_TEST_LEDGER_GREW。按被测场景拆文件
 * 是本仓对这一条的既定处方。
 *
 * 本文件锁的是**接线**（视图 ↔ composable ↔ 判据本体），不是判据本身：
 *   · 判据分类/顺序/幂等 → `src/features/publish/usePublishTargetBulk.test.js`
 *   · 播报文案与数字同源 → `src/composables/usePublishTargetBulkTargets.test.js`
 *   · 组件 DOM 与视觉中性 → `src/features/publish/components/publish-target-bulk.component.test.js`
 * 这里只回答一个问题：**用户在发布页点下去，选中集与提示真的对上了吗。**
 *
 *   pnpm exec vitest run src/views/publish-target-select-all.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";
import { ElMessage } from "element-plus";
import i18n from "@/i18n";

const routes = [{ path: "/", name: "home", component: { template: "<div>home</div>" } }];
const router = createRouter({ history: createWebHistory(), routes });

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    platforms: [
      { id: "wechat_mp", label: "微信" },
      { id: "zhihu", label: "知乎" },
    ],
    getCategory: () => "中文",
  })
}));

/**
 * 账号目录的容器。与 Publish.test.js 同口径，但**必须是 ref**：真实 Pinia store 的
 * `byPlatform` 是对 `accounts` 派生的 computed，"账号到了 ⇒ 界面跟着变"是响应式保证的。
 * 用普通对象 + getter 会让任何依赖 byPlatform 的 computed/watch 都不重算 ——
 * 那会让「按钮永远不出现」这类真机不存在的缺陷只在测试里成立（Mock 边界漏洞）。
 */
const accountState = { byPlatform: ref(null) };
function populateAccounts() {
  accountState.byPlatform.value = {
    wechat_mp: [{ id: "acc1", name: "My Account", is_default: true }],
    baijiahao: [{ id: "bj1", name: "百家号账号", is_default: true }],
    xiaohongshu: [{ id: "xhs1", name: "小红书账号", is_default: true }],
  };
}
const mockAccountLoad = vi.fn(async () => { populateAccounts(); });
vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({
    load: mockAccountLoad,
    ensureLoaded: mockAccountLoad,
    get byPlatform() { return accountState.byPlatform.value || {}; },
    getDefault: (p) => {
      if (p === "wechat_mp") return { id: "acc1", name: "My Account" };
      if (p === "baijiahao") return { id: "bj1", name: "百家号账号" };
      if (p === "xiaohongshu") return { id: "xhs1", name: "小红书账号" };
      return null;
    }
  })
}));

vi.mock("@/stores/license", () => ({ useLicenseStore: () => ({ isPro: true }) }));
vi.mock("@/stores/templates", () => ({ useTemplateStore: () => ({ load: vi.fn() }) }));
vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn() }
}));

vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}));

vi.mock("@element-plus/icons-vue", () => {
  const base = { UploadFilled: { template: "<span>U</span>" }, Refresh: { template: "<span>R</span>" } };
  const __icon = { template: "<span />" };
  const __guard = ["__esModule", "then", "catch", "default", "Symbol(Symbol.toStringTag)"];
  return new Proxy(base, { has: () => true, get: (t, p) => (p in t ? t[p] : (typeof p === "string" && !__guard.includes(p) ? __icon : undefined)) });
});

// 导入顺序与 Publish.test.js 一致（mock 必须在被 mock 的模块之前注册）
import PublishView from "./Publish.vue";
import { messageIs, messageContains, messageOf } from '../utils/toast-assert-helpers'

describe("PublishView — 发布目标全选 / 清空（publish-target-select-all）", () => {
  beforeEach(async () => {
    i18n.global.locale.value = "zh";
    await router.push('/')
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {
      draftSave: vi.fn().mockResolvedValue({ code: 0 }),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      draftDelete: vi.fn().mockResolvedValue({ code: 0 }),
      storeGetSetting: vi.fn().mockResolvedValue(null),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0 }),
      onProgress: vi.fn(() => vi.fn()),
      onBatchProgress: vi.fn(() => vi.fn()),
      pageManager: {
        suspendEmbeddedViews: vi.fn().mockResolvedValue(true),
        resumeEmbeddedViews: vi.fn().mockResolvedValue(true),
      },
    };
    mockAccountLoad.mockClear();
    mockAccountLoad.mockImplementation(async () => { populateAccounts(); });
    accountState.byPlatform.value = null;
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  async function createLayoutWrapper() {
    const w = mount(PublishView, {
      global: {
        plugins: [router, createPinia(), i18n],
        components: {},
        stubs: {
          "el-checkbox-group": { template: "<div><slot/></div>" },
          "el-checkbox": { template: "<label><input type='checkbox' /><slot/></label>" },
          "el-upload": { template: "<div><slot/></div>" },
          "el-icon": { template: "<span><slot/></span>" },
          TagSuggester: true,
          OptimalTimeTip: true,
          TitleAssistantPanel: true,
          ArticleEditor: true,
          TemplatePicker: true,
          UpgradeModal: true,
          AiWriterPanel: true,
        },
      },
    });
    await nextTick();
    return w;
  }

  /** 等 canSelectAll 翻真：账号目录是 onMounted 里 await ensureLoaded() 异步就绪的，
   *  而 publishableCount 由 watch 在目录就绪后重算（见 usePublishTargetBulkTargets 文件头）。
   *  用 waitFor 轮询而不是写死 flushPromises 次数：挂载 → IPC → watch 是三个异步步，
   *  写死次数会在机器慢时假红（本仓「硬编码等待」纪律）。 */
  async function waitForReady(w) {
    await vi.waitFor(() => {
      expect(w.vm.targetBindings.canSelectAll).toBe(true);
    });
  }

  it("有可发布平台时渲染全选/清空；全选只勾有账号的平台并如实播报", async () => {
    const w = await createLayoutWrapper();
    await waitForReady(w);
    const selectAll = w.find('[data-testid="target-select-all"]');
    expect(selectAll.exists()).toBe(true);
    // 夹具默认预选 wechat_mp（usePlatformSelection 初值）⇒ 此刻"有选中可清空"
    expect(w.find('[data-testid="target-clear-all"]').element.disabled).toBe(false);

    // wechat_mp 恰好是唯一有账号的平台且已被预选 ⇒ 分类是 already=1 / added=0 / skipped=1。
    // 这正是「added=0 但原因不同」的分岔：必须播 alreadyAll，不得播"已选中 0 个平台"。
    await selectAll.trigger("click");
    await flushPromises();

    expect(w.vm.selectedPlatforms).toEqual(["wechat_mp"]);
    const message = messageOf(ElMessage.info.mock.calls.at(-1)[0]);
    expect(message).toBe(i18n.global.t("publishPage.targetBulk.alreadyAll", { count: 1 }));
    expect(message).not.toContain("已选中 0 个平台");
  });

  it("全选把未选中的有账号平台一并勾上，并点名被跳过的无账号平台", async () => {
    const w = await createLayoutWrapper();
    await waitForReady(w);
    // 先清掉默认预选，让 wechat_mp 走"新增"分支
    w.vm.selectedPlatforms = [];
    await nextTick();
    await flushPromises();

    await w.get('[data-testid="target-select-all"]').trigger("click");
    await flushPromises();

    expect(w.vm.selectedPlatforms).toEqual(["wechat_mp"]);
    // 播报数字来自同一次分类：added=1、skipped=1
    const message = messageOf(ElMessage.info.mock.calls.at(-1)[0]);
    expect(message).toContain("已选中 1 个平台");
    expect(message).toContain("1 个平台没有可用账号");
    expect(message).toContain("知乎");
  });

  it("全选后清空可用，点清空把选中集清掉并播报", async () => {
    const w = await createLayoutWrapper();
    await waitForReady(w);
    await w.get('[data-testid="target-select-all"]').trigger("click");
    await flushPromises();
    expect(w.vm.selectedPlatforms).toEqual(["wechat_mp"]);

    const clearAll = w.get('[data-testid="target-clear-all"]');
    expect(clearAll.element.disabled).toBe(false);
    await clearAll.trigger("click");
    await flushPromises();

    expect(w.vm.selectedPlatforms).toEqual([]);
    expect(ElMessage.info).toHaveBeenCalledWith(messageIs(i18n.global.t("publishPage.targetBulk.cleared")));
  });

  it("平台目录里没有任何可用账号时整行不渲染（CI 空 profile 的视觉中性由这条守）", async () => {
    // 必须把 ensureLoaded 换成不灌数据的实现：onMounted 会调它，而默认实现一调用就把
    // 账号灌回来（那是真实加载路径），空态根本留不住。
    mockAccountLoad.mockImplementationOnce(async () => { accountState.byPlatform.value = {}; });
    const w = await createLayoutWrapper();
    await flushPromises();

    expect(w.find('[data-testid="target-bulk-toolbar"]').exists()).toBe(false);
    expect(w.find('[data-testid="target-select-all"]').exists()).toBe(false);
    // 顶层仍恰为 [搜索行, 列表]，且搜索行内只剩搜索框（全选/清空整块缺席）
    const children = w.get("section.target-selector").element.children;
    expect([...children].map(el => el.tagName.toLowerCase())).toEqual(["div", "div"]);
    expect([...children[0].children].map(el => el.tagName.toLowerCase())).toEqual(["input"]);
  });

  it("没有选中任何平台时「清空」禁用（点了无效果，禁用以示无可清空）", async () => {
    const w = await createLayoutWrapper();
    await waitForReady(w);
    w.vm.selectedPlatforms = [];
    await nextTick();
    await flushPromises();

    expect(w.find('[data-testid="target-clear-all"]').element.disabled).toBe(true);
    // 全选仍可用：有账号的平台还没被选中
    expect(w.find('[data-testid="target-select-all"]').element.disabled).toBe(false);
  });

  it("发布进行中（disabled）时全选与清空均禁用", async () => {
    const w = await createLayoutWrapper();
    await waitForReady(w);
    w.vm.publishing = true;
    await nextTick();

    expect(w.find('[data-testid="target-select-all"]').element.disabled).toBe(true);
    expect(w.find('[data-testid="target-clear-all"]').element.disabled).toBe(true);
  });
});
