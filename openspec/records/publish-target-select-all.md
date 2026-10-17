---
record: publish-target-select-all
task: 发布页「发布目标」区增加「全选 / 清空」与分组选择回视
branch: publish-target-select-all
worktree: D:\Data\projects\mp-worktrees\mp-publish-target-select-all
contract: 01-docs/PRD-PUBLISH-TARGET-SELECT-ALL-2026-10-17.md
sync_status: PENDING
sync_reason: 本 PR（publish-target-select-all，#3861）的远程同步待合并后由后续 docs PR 回填 PASS + merge SHA，并同步删除本条登记字段
sync_backfill_owner: 本记录作者（publish-target-select-all 会话）或其后续 docs PR；回填时须一并删除 sync_* 三字段（登记随文件走，回填后不得残留）
---

## 本次执行记录：发布目标「全选 / 清空」+ 分组选择回视（publish-target-select-all，2026-10-17）

> 需求原文：图片和视频发布页，右侧的「发布目标」区域，增加「全选」选项，和分组选择的选项。从 UE 用户交互上考虑，怎么设计和优化更合适。

| 项 | 结论 | 证据 |
|---|---|---|
| 变更类型 | 渲染层功能新增（无 IPC / 无主进程 / 无数据迁移） | diff 全在 `apps/desktop/src` 与 `01-docs` / `CHANGELOG` |
| 隔离 | ✅ D 盘 worktree `mp-publish-target-select-all`，分支 `publish-target-select-all`，起点 `426e2350b` | `scripts/start-mp-task.ps1` 产出；`pre-code-edit-guard` 在共享根先判 BLOCKED 后转 worktree |
| 会话隔离前置 | ✅ 共享根 clean on main、hooks 已装、Write Guard 运行中 | `mp-worktree-health` 产物 `clean=true / hooks match / writeGuard.ok=true` |
| 先文档再代码 | ✅ 先写 PRD 再实现 | `01-docs/PRD-PUBLISH-TARGET-SELECT-ALL-2026-10-17.md` |
| TDD | ✅ 先红后绿 + 变异反证 | 4 个新测试文件；反证见下 |
| QM-1 打包 | N/A（强制打包只针对 `electron/` 与 `packages/rpa-engine/`，本刀未触碰） | 以 `vite build` + CI `QG Visual` 为渲染层判据 |
| `check-max-lines` | ✅ | `Publish.vue` 1770 ≤ targets 1773；`Publish.test.js` 拆出视图层测试后回容差内 |
| `check-locale-sync` | ✅ pair + ✅ CJK | pair PASS（zh/en 变更均=true 且成对覆盖）；CJK 基线 1374 → 1217，无新增硬编码 |
| ESLint | ✅ exit 0 | 仅 2 处 warning（`Publish.vue:726` 未用 disable 指令、`:1253` `copyDetailMeta`），经 `git diff origin/main` 核对**均不在本刀 diff 内** |
| 测试 | ✅ 25 文件 422 用例全绿（含新 4 文件 34 例）；宽扫 76 文件 1379 用例全绿 | 受影响全量：`src/features/publish` + `usePlatformSelection` + `usePublishTargetBulkTargets` + `Publish.test.js` + `publish-target-select-all.test.js` |
| 远程同步 | PENDING | 待 PR #3861 合并后回填 PASS + merge SHA，并删除 frontmatter 的 `sync_*` 三字段 |

### 反证（每条都实跑并指名红）

| # | 变异 | 结果 |
|---|---|---|
| M1 | 把可发布判据改回读 `platform.accounts.length`（绕开注入的 `getAvailableAccountIds`） | `usePublishTargetBulk.test.js` **9/12 红**（停用账号被当成可发布） |
| M2 | 纯函数插入 `await` | 同段源码锁 L5 红（含"读不到源文件必须失败"的路径扫描） |
| M3 | 清单截断后缀写回纯函数（不经 locale） | `check-locale-sync --cjk` **判红 4 处** |
| M4 | `publishableCount` 写成 computed（非响应式替身下缓存） | 视图层 6 例全红（"按钮永远不出现"）——这是本轮实现期真踩到的坑，不是假想 |
| M5 | 同一元素两个 `v-bind` | Vue 编译期 `Duplicate attribute`，`Publish.test.js` 0 用例可跑 |

### 语义决策（写明理由，便于后续 review）

1. **全选 = 全选「可发布的」**，不是"全选所有平台"。无可用账号的平台不进选中集并在提示里点名，否则它们必然触发 `validatePublishTargets` 的阻断。
2. **增量而非替换**，逆操作只提供「清空」；**不做反选**——反选后选中的恰是无账号平台集合，语义自相矛盾。
3. **分组选择沿用 P2-8b 的 additive 语义**，只补"已选/成员"回视与点击前预告；**不做按组替换/整组取消**（破坏性，P2-8b §一.2 已论证）。
4. **无可发布平台时整行不渲染**，而非渲染 disabled 按钮：既不给死控件，也保持 CI 空 profile 下 `publish-form` 的视觉中性（与 P2-8b「无组不渲染」同型）。

### 诚实边界

- 真机行为验证需已登录 profile；本机不做端到端（牵动共享 userData），行为面以单测为准。
- `QG Visual` 以 CI 为准。本刀的构造性论证是「空 profile 下零 DOM 新增」（由 `publish-target-bulk.component.test.js` 的 section 子节点锁 + 视图层"无可发布平台整行不渲染"用例钉住）；**非空 profile（有账号/有分组）下新增一行属预期界面变化**，若因此触发基线重建，应由 CI 同源产出，不在本 PR 内混入。
- 未提供的能力（明确不做）：反选、按组替换/整组取消、批量模式条目级目标、分组内逐成员跳过原因明细。
