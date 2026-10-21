---
record: draft-batch-delete
task: 草稿箱支持批量删除，并修掉「草稿点了删除还在」的结构性根因
date: 2026-10-21
---

# 草稿箱批量删除（draft-batch-delete，2026-10-21）

> 分支 `draft-batch-delete`（worktree `D:/全局项目库/mp-worktrees/mp-draft-batch-delete`），起点 `3254ec9` = 当时 origin/main。

## 用户报的是「删不掉」，不是「少个批量按钮」

草稿箱（`/publish?tab=drafts`，`Publish.vue` 的唯一实现）此前每张卡片只有「去发布」+「删除」。用户诉求是批量删除，但先要回答「为什么逐条删不动」。代码层取证到两条独立成因：

1. **id 缺失就永远匹配不上**。`draftSave` 的历史实现只做 `{...draft}`，主进程从不补 id；而 `Collection.vue` 的草稿载荷明确「不再生成 id，交给主进程」。这类条目落库后 `id === undefined`，`draftDelete` 用 `d.id !== draftId` 过滤时，`undefined !== undefined` 为假——看似能删，但 UI 侧 `v-for :key="draft.id"` 全部撞车、`delete-draft-undefined` 重复，点哪张都不确定删的是哪条。
2. **比较口径不统一**。历史数据里存在数字 id，`String(1) !== 1` 会产生假阴性：IPC 正常返回 `code:0`，草稿却还在列表里。

顺带确认「删除链路本身没断」：`preload/publish.js` 暴露、`access-control` 分级、`store.js` handler、`publisher.js` 透传四段都通，所以问题不在权限或通道。

## 落点

| 落点 | 文件 | 承担什么 |
| --- | --- | --- |
| IPC | `apps/desktop/electron/ipc-handlers/store.js` | `draftDelete` 接受「单 id 或 id 数组」，一次读写完成；返回 `{ requested, deleted, remaining }`；`draftSave` 缺 id 时主进程生成；`draftList` 对缺 id/重复 id 的历史草稿惰性补 id 并只落盘一次 |
| 桥接 | `apps/desktop/src/api/publisher.js` | `draftDelete` 入参改为 `draftIdOrIds`，注明批量语义与回执形状 |
| 用例 | `apps/desktop/src/composables/usePublishDrafts.js` | 勾选集（统一字符串口径）、全选/反选、`removeDrafts`（单条与批量共用一次 IPC）、`removeSelectedDrafts`（二次确认）、删除中 `deletingDrafts`、刷新后摘掉失效勾选 |
| 视图 | `apps/desktop/src/views/Publish.vue` | 工具栏（全选 + 已选计数 + 删除选中）、卡片勾选框、单条删除按钮删除中禁用 |
| 文案 | `apps/desktop/src/locales/{publish-page,publish-drafts}/{zh,en}.js` | 4 个 UI 键 + 6 个 toast/确认键，zh/en 成对 |
| 回归锁 | `store.test.js`（8 例）、`usePublishDrafts.test.js`（8 例）、`Publish.test.js`（2 例）、`draft.test.js`（1 例） | 见下 |

## 关键判断

- **批量必须一次 IPC**：循环单删 = N 次落盘 + N 次列表刷新，中途失败留下半删状态，且 UI 无法汇报「删了几条」。主进程一次 `filter` 落盘天然原子。
- **空入参 fail-closed**：`[]` / `undefined` / 全空白一律 `REQUEST_ERROR` 且不写盘。绝不能把「没指定 id」退化成「删除全部」——这是批量删除最危险的失败模式。
- **不存在的 id 不写盘、不伪造条数**：返回 `deleted:0` 并如实提示（`batchDeletePartial` 走 warning），成功 toast 只说实际删除数量。
- **单条删除保留原有无确认行为**：批量才加二次确认（一次能删整屏，误点代价不同）；单条删除复用同一入口，行为不变。
- **id 迁移放在读取侧**：`draftList` 补 id 后立即落盘一次，之后稳定；不写迁移脚本，避免要求用户升级时跑离线工具。

## 执行记录

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码变更（electron + 渲染层 + locales）；隔离 worktree `mp-draft-batch-delete`（D 盘）+ 裸分支 `draft-batch-delete`，起点 `3254ec9` |
| 第一性原因（QM-5 ①） | PASS | 两条独立成因：缺 id ⇒ 无稳定 key 且无法按 id 定位；数字/字符串混比 ⇒ 删除假阴性。均在 `store.js` 读取侧取证 |
| 逃逸分析（QM-5 ②） | PASS | 既有测试只有「删除 handler 注册」与「scoped 键」两条，没有任何用例点过删除结果或列表回执；`Publish.test.js` 从未点过删除按钮 ⇒ 该缺陷此前完全不可见 |
| 修复 + 回归保护（QM-5 ④） | PASS | `store.test.js` 75 例、`usePublishDrafts.test.js` 29 例、`draft.test.js` 13 例、`Publish.test.js` 112 例，四个文件全绿；新增用例覆盖批量/单条/数字 id/空入参/不存在 id/补 id 迁移/迁移后可删/缺 id 保存回传 |
| 防止再次发生（QM-5 ⑤） | PASS | 「缺 id 的草稿在补 id 之后可以被批量删除」为根因回归锁；「空数组必须拒绝且不写盘」为最危险失败模式锁 |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等（12 文件） |
| 品牌残留 | PASS | `node scripts/check-no-brand-residue.js` → PASS（11376 tracked files） |
| i18n 键对齐 | PASS | `src/locales/structure-lock.test.js` 4 例全绿（zh/en 键集合相等） |
| ESLint | PASS | 改动 4 个源文件 0 errors（8 warnings 全为该文件既有的 no-unused-vars，本片未新增） |
| QM-1 打包 | 待 CI | 本片改 `electron/ipc-handlers/store.js`（属 electron 域）。本机 worktree 依赖因跨盘 pnpm 安装限制未装全（store 在 C 盘、worktree 在 D 盘，硬链接退化为逐文件复制），无法本地产包；如实登记未执行，交 CI `QG Desktop Shards` |
| QM-4 视觉 | 待 CI | 草稿箱新增工具栏与卡片勾选框，视觉非中性；基线只能取自 CI 产物（AGENTS 规则 7），本机不产基线 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本片触及「删除」这一不可恢复操作与批量入口的确认语义，属需要外部轴复核的语义面；如实登记「未执行」而非跳过 |
| 远程同步 | PENDING | PR 未合并 |

## 遗留（不假装已闭合）

- 上述 QM-1 / QM-4 / QM-6 三项在本机未执行，交 CI 与后续评审；若 CI 判红，处置按门禁输出逐条跟进。
- 草稿删除仍是**不可恢复**操作（写 SQLite 覆盖，无软删/回收站）。本片只加了批量确认，没有引入软删模型——那需要独立的 `deleted_at` 语义与列表过滤，属另一片。
