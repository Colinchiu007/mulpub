// @ts-check
/**
 * collection-visual-case-contract.test.js — 视觉用例 ↔ 页面选择器的契约锁
 *
 * **动因（2026-10-17 实测，判据全部取产物）**：
 *   `supplementary-views` 的 `collection-confirm-dialog` 用例写于 2026-09-10
 *   （`d74115388`），断言 `/collection` **默认页签**上有「草稿箱」区块标题。
 *   但 2026-10-12 的 `#3395`（`e39dc0a03`）把「草稿箱」改成**独立页签**，
 *   且 `Collection.vue` 的默认页签是 `const activeTab = ref('collect')`。
 *   于是该用例从那次重构起**恒定失败**，而它只跑在 **非 required** 的
 *   `Visual Tests` workflow 里 —— `gh run list --workflow=visual-test.yml --branch main
 *   --limit 60` 显示 **59 失败 / 0 成功**，连红一整天无人发现，
 *   只在每次 main push 上贡献一条红。
 *
 * **本锁要解决的问题**：漂移的发现成本。视觉作业要 20 分钟且不在 required 面，
 *   而「用例写死的选择器在页面源码里还在不在」是**秒级**可判的。
 *   把它做成单测后，跟着 required 的桌面分片一起跑，漂移当天就红。
 *
 * 锁三层：
 *   ① 页签按钮的 `data-testid` 存在；
 *   ② 面板/列表/空态/删除按钮的 `data-testid` 存在；
 *   ③ **用例本身必须是「先切页签再断言」的形态** —— 这一条才是防复发的主锁：
 *      页面再改布局时，用例若被改回「直接断言默认页签」，本锁立刻红。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.dirname(HERE);
const COLLECTION_FEATURE = path.join(SRC, "features", "collection");
const VISUAL_CASE_FILE = path.join(
  SRC, "..", "tests", "visual-testing", "views", "supplementary-views.visual.test.js",
);

const read = (p) => fs.readFileSync(p, "utf8");

describe("视觉用例 collection-confirm-dialog ↔ 页面选择器契约（防静默漂移）", () => {
  it("① 草稿箱页签按钮的 data-testid 必须存在", () => {
    const tab = read(path.join(COLLECTION_FEATURE, "CollectionDraftsTab.vue"));
    expect(tab, "缺少 data-testid=collection-tab-drafts，视觉用例将无处可点")
      .toContain('data-testid="collection-tab-drafts"');
  });

  // S1c：草稿箱面板已从采集页删除（整页迁到 /publish?tab=drafts），
  // 故原「面板 testid 必须存在」的断言反转为「面板组件不得复活」。
  it("② 草稿箱面板组件必须已删除（草稿箱唯一实现为 /publish?tab=drafts）", () => {
    const panelPath = path.join(COLLECTION_FEATURE, "CollectionDraftsPanel.vue");
    expect(
      fs.existsSync(panelPath),
      "CollectionDraftsPanel.vue 不得复活：草稿箱已收敛为 /publish?tab=drafts 单一实现",
    ).toBe(false);
  });

  it("③ 用例不得再点击草稿箱页签（点它会导航离开 /collection）", () => {
    const suite = read(VISUAL_CASE_FILE);
    const at = suite.indexOf("name: 'collection-confirm-dialog'");
    expect(at, "未找到 collection-confirm-dialog 用例").toBeGreaterThan(-1);

    const block = suite.slice(at, at + 1400);
    expect(
      block,
      "该用例不得再 trigger 草稿箱页签：S1c 起点击它会 router.push 到 /publish?tab=drafts，截图会偏离 /collection 基线",
    ).not.toContain("collection-drafts-panel");
    expect(block).not.toContain("collection-drafts-list");
    // 仍必须有 data-testid 形态的锚点（不用随文案变的 :has-text）
    expect(block).toContain("collection-tab-drafts");
  });
});
