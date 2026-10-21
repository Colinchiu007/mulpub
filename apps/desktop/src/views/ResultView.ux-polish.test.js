// @vitest-environment jsdom
/**
 * ResultView 的 UX/无障碍行为锁（2026-10-20 PRD-S2V-RESULT-UX-POLISH）。
 *
 * 为什么独立成文件：`ResultView.test.js` 在 `.github/scripts/max-lines-baseline.json`
 * 的测试账本里有登记值（容差 200 行），这一批新增守护（失败摘要卡 / 筛选搜索 /
 * 计数与展开全部 / 跳转反馈 / roving tabindex / 回到顶部）单独拆出来，
 * 既守住账本，也按「被测关注点」分文件而不是继续堆一个大文件。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import zh from "@/locales/zh";
import UiButton from "@/components/UiButton.vue";
import ResultView from "./ResultView.vue";

vi.mock("@/api/publisher", () => ({
  story2videoExportZip: vi.fn(),
  story2videoCreateShareUrl: vi.fn(),
  story2videoCopyPath: vi.fn(),
  story2videoShowInFolder: vi.fn(),
  story2videoSaveAs: vi.fn(),
  story2videoGetProject: vi.fn(),
  story2videoImportMedia: vi.fn(),
  story2videoUpdateSegments: vi.fn(),
  story2videoReplaceSegmentAudio: vi.fn(),
  story2videoRetrySegment: vi.fn(),
  story2videoRecomposeProject: vi.fn(),
  story2videoSelectSceneMaterial: vi.fn(),
  story2videoGenerateSceneImage: vi.fn(),
  story2videoGenerateSceneVideo: vi.fn(),
  story2videoGenerateSceneAiVideo: vi.fn(),
  story2videoRegenerateSceneSubtitle: vi.fn(),
  story2videoRegenerateSceneAudio: vi.fn(),
  story2videoRegenerateScenePrompt: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelineGetRun: vi.fn(),
  story2videoGetTrim: vi.fn(),
  story2videoSaveTrim: vi.fn(),
  story2videoGetConfig: vi.fn(),
}));

describe("ResultView · UX polish（169 段任务的信息完整性与长列表操作）", () => {
  let router;

  beforeEach(async () => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div/>" } },
        { path: "/create", component: { template: "<div/>" } },
        { path: "/create/result", component: { template: "<div/>" } },
        { path: "/create/result-list", component: { template: "<div/>" } },
      ],
    });
  });

  async function createView() {
    await router.push("/");
    const w = mount(ResultView, {
      global: {
        plugins: [router],
        components: { UiButton },
        mocks: {
          // 文案断言必须打在**真实词条**上（QM-6 深审 i1）：
          // 只回传 key 的 mock 会让「locale 绑定缺失 / 插值参数错 / 文案拼接错」全部漏过。
          // 这里按 key 路径去 zh 词条里取值，再做 {name} 插值——这样 `已显示 20 / 共 169 段`
          // 这类断言才真的在验文案，而不是在验假数据。
          $t: (key, params) => {
            const template = key.split(".").reduce(
              (node, part) => (node && typeof node === "object" ? node[part] : undefined),
              zh
            );
            const text = typeof template === "string" ? template : key;
            if (!params || typeof params !== "object") return text;
            return Object.entries(params).reduce(
              (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
              text
            );
          },
        },
      },
    });
    await nextTick();
    return w;
  }

  // ── 2026-10-20 PRD-S2V-RESULT-UX-POLISH ──
  // 这一组守护「169 段任务页面上关键信息不再缺席」：
  // 为什么失败、目标段在哪、还有多少段没显示、能不能快速回顶。
  describe("失败摘要卡（无成片任务要能回答「为什么没生成」）", () => {
    it("占位区块给出失败/完成段数与首个失败段的下标", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [
        { id: "s1", status: "completed" },
        { id: "s2", status: "failed", failureCode: "policy" },
        { id: "s3", status: "failed", failureCode: "policy" },
        { id: "s4", status: "pending" },
      ];
      await nextTick();

      expect(w.find('[data-testid="failure-summary"]').exists()).toBe(true);
      expect(w.vm.failureSummary).toMatchObject({
        total: 4,
        failedCount: 2,
        completedCount: 1,
        pendingCount: 1,
        firstFailedIndex: 1,
        hasFailure: true,
      });
      // 同因合并且计数为 2
      expect(w.vm.failureSummary.reasons).toEqual([{ code: "policy", count: 2 }]);
      w.unmount();
    });

    it("失败原因码翻成可读文案；未知码回落「其他原因」不编造", async () => {
      // 2026-10-20：原因码 → locale 键的映射表已收口到 composable（单一真源），
      // 渲染成文案在 ResultPreviewPlaceholder 里。这里断言**契约**而不是宿主方法：
      // 已知码必须命中具体键、未知码/空值必须回落 unknown（不得编造成因）。
      const { FAILURE_REASON_LABEL_KEYS } = await import(
        "./video-creation/composables/useResultPreviewMedia"
      );
      expect(FAILURE_REASON_LABEL_KEYS.policy).toBe("failureReasonPolicy");
      expect(FAILURE_REASON_LABEL_KEYS["quota-exceeded"]).toBe("failureReasonQuota");
      expect(FAILURE_REASON_LABEL_KEYS["content-policy"]).toBe("failureReasonPolicy");
      expect(FAILURE_REASON_LABEL_KEYS["generation-timeout"]).toBe("failureReasonTimeout");
      // 未知码在表里没有键 ⇒ 调用方回落 unknown
      expect(FAILURE_REASON_LABEL_KEYS["weird-unknown-code"]).toBeUndefined();
      expect(FAILURE_REASON_LABEL_KEYS.unknown).toBe("failureReasonUnknown");
    });

    it("「定位到首个失败段」把窗口扩到覆盖该段并高亮它", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      // 169 段，只有第 60 段失败（首屏 20 段里看不到）
      const segments = Array.from({ length: 169 }, (_, i) => ({
        id: "s" + i,
        status: i === 60 ? "failed" : "completed",
      }));
      w.vm.segments = segments;
      await nextTick();
      expect(w.vm.previewLayout.renderWindow.to).toBeLessThan(61);

      await w.vm.jumpToFirstFailedSegment();
      await nextTick();

      expect(w.vm.activeSegmentIndex).toBe(60);
      // 窗口扩到覆盖 60 ⇒ 至少渲染 61 段
      expect(w.vm.previewLayout.renderWindow.to).toBeGreaterThanOrEqual(61);
      w.unmount();
    });

    it("没有失败段时不渲染「定位到失败段」按钮", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", status: "completed" }, { id: "s2", status: "completed" }];
      await nextTick();

      expect(w.find('[data-testid="failure-summary-jump"]').exists()).toBe(false);
      w.unmount();
    });
  });

  describe("分段筛选与搜索（169 段里找目标段）", () => {
    it("「只看失败」只渲染失败段，且作用在**全量下标**上", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [
        { id: "s1", status: "completed", text: "第一段" },
        { id: "s2", status: "failed", text: "第二段" },
        { id: "s3", status: "completed", text: "第三段" },
      ];
      await nextTick();

      w.vm.segmentFilterMode = "failed";
      await nextTick();

      expect(w.vm.segmentsFiltered).toBe(true);
      expect(w.vm.displayedSegments.map(item => item.absoluteIndex)).toEqual([1]);
      expect(w.vm.displayedSegments.map(item => item.segment.id)).toEqual(["s2"]);
      w.unmount();
    });

    it("关键词搜索跨越全部 169 段（不只在已展开的 20 段里找）", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      const segments = Array.from({ length: 169 }, (_, i) => ({
        id: "s" + i,
        status: "completed",
        text: i === 150 ? "这里出现了独特关键词 ZEBRA" : "普通文案",
      }));
      w.vm.segments = segments;
      await nextTick();

      w.vm.segmentSearchQuery = "zebra";
      await nextTick();

      // 第 150 段远在首屏 20 段之外，仍然要命中
      expect(w.vm.displayedSegments.map(item => item.absoluteIndex)).toEqual([150]);
      w.unmount();
    });

    it("清空搜索恢复全量可见", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", status: "completed", text: "alpha" }];
      await nextTick();

      w.vm.segmentSearchQuery = "zzz-no-match";
      await nextTick();
      expect(w.vm.displayedSegments).toHaveLength(0);

      w.vm.segmentSearchQuery = "";
      await nextTick();
      expect(w.vm.displayedSegments).toHaveLength(1);
      expect(w.vm.segmentsFiltered).toBe(false);
      w.unmount();
    });
  });

  describe("分段计数与展开全部", () => {
    it("计数文案报出「已显示 N / 共 M」（169 段不再只报总数）", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 169 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();

      const label = w.vm.segmentCountLabel;
      // 真实词条 + 真实插值：zh 是「已显示 {shown} / 共 {total} 段」
      expect(label).toContain("已显示");
      expect(label).toContain("20");
      expect(label).toContain("169");
      expect(label).not.toContain("{shown}");
      expect(label).not.toContain("{total}");
      w.unmount();
    });

    it("全部显示后文案切成「共 N 段」，不再说「已显示」", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 3 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();
      w.vm.segmentRenderCount = 3;
      await nextTick();

      const label = w.vm.segmentCountLabel;
      expect(label).toBe("共 3 段");
      w.unmount();
    });

    it("「展开全部」一次性把窗口推到全部段并只解析新增区间", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 60 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();
      const before = w.vm.previewLayout.renderWindow.to;

      // jsdom 的 window.confirm 是返回 falsy 的占位实现；这里显式 stub 成「用户点了确定」。
      // 生产行为（先确认再一次性渲染全部）保留不变，测试只替换交互输入。
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      try {
        await w.vm.expandAllSegments();
        await nextTick();
      } finally {
        window.confirm = originalConfirm;
      }

      expect(w.vm.previewLayout.renderWindow.to).toBe(60);
      expect(w.vm.previewLayout.renderWindow.to).toBeGreaterThan(before);
      w.unmount();
    });

    it("「展开全部」在用户取消时不做任何事（不静默渲染全部）", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 60 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();
      const before = w.vm.previewLayout.renderWindow.to;

      const originalConfirm = window.confirm;
      window.confirm = () => false;
      try {
        await w.vm.expandAllSegments();
        await nextTick();
      } finally {
        window.confirm = originalConfirm;
      }

      expect(w.vm.previewLayout.renderWindow.to).toBe(before);
      w.unmount();
    });
  });

  describe("跳转反馈与键盘可达", () => {
    it("大跨度跳转结束后不残留「正在展开」状态", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 169 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();

      await w.vm.jumpToSegmentIndex(149);
      await nextTick();
      expect(w.vm.jumpPendingIndex).toBe(-1);
      w.unmount();
    });

    it("越界下标不动作、不抛错", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", status: "completed" }];
      await nextTick();

      await expect(w.vm.jumpToSegmentIndex(999)).resolves.toBe(false);
      await expect(w.vm.jumpToSegmentIndex(-1)).resolves.toBe(false);
      w.unmount();
    });

    it("数字导航是 roving tabindex：整组只有当前项是 tabindex=0", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 5 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();

      const buttons = w.findAll('[data-testid="segment-jump-bar"] .segment-jump-number');
      expect(buttons).toHaveLength(5);
      expect(buttons[0].attributes("tabindex")).toBe("0");
      expect(buttons[1].attributes("tabindex")).toBe("-1");
      w.unmount();
    });

    it("方向键在数字导航内移动焦点并跳转", async () => {
      // 2026-10-20：键盘处理已进 ResultSegmentJumpBar，纯逻辑（目标下标）在 composable。
      // 这里走**真实 DOM 键盘事件**，断言组件间契约（emit → 宿主状态变化），
      // 不直接调宿主方法（那个方法已不存在，直调只能测到调用形态而不是行为）。
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 5 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();
      w.vm.jumpFocusIndex = 1;
      await nextTick();

      const numbers = w.find('[data-testid="segment-jump-bar"] .segment-jump-numbers');
      expect(numbers.exists()).toBe(true);
      await numbers.trigger("keydown", { key: "ArrowRight" });
      await nextTick();

      expect(w.vm.jumpFocusIndex).toBe(2);
      w.unmount();
    });

    it("Tab 键不被拦截（整组只占 1 个 Tab 位的语义不能被吃掉）", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 5 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();

      const numbers = w.find('[data-testid="segment-jump-bar"] .segment-jump-numbers');
      const before = w.vm.jumpFocusIndex;
      await numbers.trigger("keydown", { key: "Tab" });
      await nextTick();

      expect(w.vm.jumpFocusIndex).toBe(before);
      w.unmount();
    });
  });

  describe("滚动高亮的单帧成本（视口裁剪，QM-6 深审 i5）", () => {
    it("读到视口下方的卡片即提前退出，不把 169 段全量读一遍", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = Array.from({ length: 169 }, (_, i) => ({ id: "s" + i, status: "completed" }));
      await nextTick();

      // 造 169 个 ref，只有前 3 个在视口内，其余 top 远在下方
      const reads = { count: 0 };
      const orig = window.innerHeight;
      Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
      try {
        const refs = [];
        for (let i = 0; i < 169; i += 1) {
          refs[i] = {
            getBoundingClientRect: () => {
              reads.count += 1;
              return { top: i < 3 ? i * 10 : 1000 + i * 400, bottom: 0, height: 0 };
            },
            scrollIntoView: () => {},
          };
        }
        w.vm.segmentItemRefs = refs;
        w.vm.computeActiveSegmentIndex();
      } finally {
        Object.defineProperty(window, "innerHeight", { value: orig, configurable: true });
      }

      // 视口内 3 个 + 第一个越过视口底的 1 个 = 4；远小于 169
      expect(reads.count).toBeLessThanOrEqual(6);
      expect(reads.count).toBeLessThan(169);
      expect(w.vm.activeSegmentIndex).toBe(2);
      w.unmount();
    });
  });

  describe("回到顶部", () => {
    it("滚动超过阈值才显示回顶按钮", async () => {
      const w = await createView();
      w.vm.projectId = "p1";
      w.vm.segments = [{ id: "s1", status: "completed" }];
      await nextTick();
      expect(w.find('[data-testid="back-to-top"]').exists()).toBe(false);

      // 模拟滚动位置
      Object.defineProperty(window, "scrollY", { value: 1200, configurable: true });
      w.vm.onSegmentScroll();
      await nextTick();

      expect(w.find('[data-testid="back-to-top"]').exists()).toBe(true);
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
      w.unmount();
    });
  });
});
