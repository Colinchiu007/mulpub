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

  it("② 草稿箱面板 / 列表 / 空态 / 删除按钮的 data-testid 必须存在", () => {
    const panel = read(path.join(COLLECTION_FEATURE, "CollectionDraftsPanel.vue"));
    for (const id of [
      "collection-drafts-panel",
      "collection-drafts-list",
      "collection-drafts-empty",
      "draft-delete",
    ]) {
      expect(panel, `缺失 data-testid=${id}，视觉用例会因此静默漂移`).toContain(`data-testid="${id}"`);
    }
  });

  it("③ 用例必须走「先切页签、再用 data-testid 断言」的形态", () => {
    const suite = read(VISUAL_CASE_FILE);
    const at = suite.indexOf("name: 'collection-confirm-dialog'");
    expect(at, "未找到 collection-confirm-dialog 用例").toBeGreaterThan(-1);

    const block = suite.slice(at, at + 1400);
    expect(
      block,
      "缺少 trigger：草稿箱自 #3395 起是独立页签，默认页签是 collect —— 不切页签就断言必然恒红",
    ).toContain("trigger:");
    expect(block).toContain("collection-tab-drafts");
    expect(block).toContain("collection-drafts-panel");
    expect(
      block,
      "不得再对默认页签断言「草稿箱」区块标题（这正是 2026-09-10 → 2026-10-12 的漂移形态）",
    ).not.toContain('.cohere-section-title:has-text("草稿箱")');
  });
});
