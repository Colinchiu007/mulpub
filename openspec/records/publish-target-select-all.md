---
record: publish-target-select-all
task: 发布页「发布目标」区增加「全选 / 清空」与分组选择回视
branch: publish-target-select-all
worktree: <worktreeRoot>/mp-publish-target-select-all
contract: 01-docs/PRD-PUBLISH-TARGET-SELECT-ALL-2026-10-17.md
---

## 本次执行记录：发布目标「全选 / 清空」+ 分组选择回视（publish-target-select-all，2026-10-17）

> 需求原文：图片和视频发布页，右侧的「发布目标」区域，增加「全选」选项，和分组选择的选项。从 UE 用户交互上考虑，怎么设计和优化更合适。
>
> 本记录按新形态（`gate-record-sync-derived-status` 落地后）写：不带 `sync_*` 三字段、状态列不手写状态词 —— 收口由门禁按主干历史推导（`远程同步 PR #3861`）。

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
| `QG Visual` | ⏳ 第 1 轮判红 → 改设计后复跑 | 见下「视觉门禁实测」；终判以第 2 轮 CI 为准 |
| 远程同步 | 由门禁推导 | `远程同步 PR #3861`（不带 `sync_*` 三字段，收口由 `merge-ledger` 按主干历史推导） |

### 反证（每条都实跑并指名红）

| # | 变异 | 结果 |
|---|---|---|
| M1 | 把可发布判据改回读 `platform.accounts.length`（绕开注入的 `getAvailableAccountIds`） | `usePublishTargetBulk.test.js` **9/12 红**（停用账号被当成可发布） |
| M2 | 纯函数插入 `await` | 同段源码锁 L5 红（含"读不到源文件必须失败"的路径扫描） |
| M3 | 清单截断后缀写回纯函数（不经 locale） | `check-locale-sync --cjk` **判红 4 处** |
| M4 | `publishableCount` 写成 computed（非响应式替身下缓存） | 视图层 6 例全红（"按钮永远不出现"）——这是本轮实现期真踩到的坑，不是假想 |
| M5 | 同一元素两个 `v-bind` | Vue 编译期 `Duplicate attribute`，`Publish.test.js` 0 用例可跑 |
| M6 | 全选/清空放回「搜索框下的新一行」 | 视觉中性锁反向红（顶层节点数 2→3）——该锁是改设计后新增的，M6 即"把设计改回去"的反证 |

### 视觉门禁实测（QG Visual 第 1 轮判红 → 改设计）

**第 1 轮失败是可复现的确定性漂移，不是 flake**：`gh run rerun --job` 重跑，两轮甄别结论一致。
产物取证（job log，非推断）：

```
[GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0 workflows=1 workflows-supplement=0
[GATE-7] workflows 套件 rc=1 —— 按两轮甄别重跑一次
[GATE-7] workflows 重跑 rc=1
工作流结果: 25/31 通过，6 失败
  ❌ 视觉差异 1.7783082561728396% 超过阈值 1%   ← ×6 条 /publish 用例
```

- 6 条全是 `/publish` 用例：`publish-title-edit-reset` / `publish-author-edit-reset` / `publish-platform-search-reset` / `publish-cover-url-reset` / `publish-template-panel-toggle` / `publish-ai-panel-toggle`。
- **同一视图在像素套里 PASSED**（`publish-form` 1.778% < 6%）—— 两个套件阈值不同口径（workflows **1%** vs pixel **6%**），拿一个的绿当另一个的绿正是本轮红因。
- diff 图显示红线覆盖**整个右栏下半部**：新增一行把下方所有内容整体下移。
- 修法（构造性中性）：全选/清空**塞进搜索行内部**，不新开一行，下方原地不动；按钮做小号 chip 不撑高行高；顶层子节点数恒为 2。详见 PRD §六（含对初稿"CI 空 profile"前提的推翻与更正）。
- **不采用**：本机 `--update-baseline` 重建基线 —— 本仓纪律明令禁止用基线掩盖回归。若第 2 轮仍红，正解是由 CI 同源产出 `base-screenshots/publish-form{,-dark}.png`。

### 语义决策（写明理由，便于后续 review）

1. **全选 = 全选「可发布的」**，不是"全选所有平台"。无可用账号的平台不进选中集并在提示里点名，否则它们必然触发 `validatePublishTargets` 的阻断。
2. **增量而非替换**，逆操作只提供「清空」；**不做反选**——反选后选中的恰是无账号平台集合，语义自相矛盾。
3. **分组选择沿用 P2-8b 的 additive 语义**，只补"已选/成员"回视与点击前预告；**不做按组替换/整组取消**（破坏性，P2-8b §一.2 已论证）。
4. **无可发布平台时整块不渲染**，而非渲染 disabled 按钮：既不给死控件，也不把"没有可选目标"伪装成"按钮坏了"。
5. **按钮塞进搜索行而非新开一行**：不是排版偏好，是像素门禁的硬约束（新开一行把下方整栏下移，1.778% 撞 workflows 的 1% 阈值）。UE 上也更贴近"批量操作作用于搜索/列表"的心智。

### 诚实边界

- 真机行为验证需已登录 profile；本机不做端到端（牵动共享 userData），行为面以单测为准。
- **本机无 Chromium，跑不了视觉套件** ⇒ 不在本地声称像素结论。构造性论证是「搜索行内改动、下方原地不动」，证据为组件层形状锁（顶层恒 2 节点 + 空态搜索行内仅 `<input>`）+ 视图层"无可发布平台整块不渲染"用例。终判是第 2 轮 CI 的 `QG Visual`。
- 未提供的能力（明确不做）：反选、按组替换/整组取消、批量模式条目级目标、分组内逐成员跳过原因明细。
