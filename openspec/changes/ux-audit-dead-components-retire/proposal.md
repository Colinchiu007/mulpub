# Proposal: ux-audit-dead-components-retire

## Why

UX 审计阶段 1 的 1.3「不允许存在但无人渲染」。审计条目原文：
**`TrialBanner` 接进 MemberCenter 或删除；`LoadingState` 删除或接上**。

现场取证（逐条可重跑）：

| 件 | 事实 | 取证 |
|---|---|---|
| `components/TrialBanner.vue` | 生产模板零用法；只有两处测试自己 `mount` 它（`more-tests.test.js` 4 条、`TrialBanner.test.js` 若干） | `git grep -n "<TrialBanner" origin/main -- apps/desktop` 零命中；`grep -rna TrialBanner apps/desktop/src` 只命中自身、测试与注释 |
| 它的文案 | 「当前为免费版，部分功能受限」在**看板页**已被产品决策判为误导并撤下：该页三个数据源的门禁都是**登录**而非套餐，没有任何内容因套餐受限 | `views/Dashboard.style-guard.test.js` 的两版反转史注释（2026-10-16 要求必须在 `.cohere-content` 内 → 2026-10-17 用户决策方案 C：撤下）+ `views/Dashboard.test.js` 的 `no longer shows TrialBanner` |
| 套餐差异的真实承载 | 已改由各区块的「锁区块占位」表达（`DashboardLockedPanel.vue`，PRD §3.2） | 读该组件 |
| `components/LoadingState.vue` | 在 `main.js` 全局注册，但 `<LoadingState>` 模板用法 **0**；骨架屏实际由 `EmptyState` / `UiSkeleton` 承担 | `grep -rna "<LoadingState" apps/desktop/src` 零命中 |
| 隐藏的第二个注册点 | `apps/desktop/test-setup.js` 把 `LoadingState` 注册进测试全局组件表（**在 `src/` 之外**）⇒ 只 grep `src/` 会漏，删掉组件后整套测试以 `Failed to resolve import` 挂死 | 本批实测：首次删除后 4 个测试文件整片无法加载 |

**为什么是"删除"而不是"接进 MemberCenter"**：这是一条产品裁决项，而本仓已有**相反方向的既成决策**——
套餐差异由区块锁占位表达（见上表第 3 行），横幅式"你正在用免费版"的提示在看板页刚被撤下，
理由（文案误导）在会员中心同样成立（该页也按区块表达权益）。把同一个文案换一页去挂，
等于绕过那次决策、并新增一处与区块锁占位口径重复的真源。
审计条目的判据是「二选一，不允许存在但无人渲染」——**删除满足它**，且不与已编码的 UX 契约冲突。
反向选择（挂进会员中心）需要新的产品决定与文案设计，不属本批。

## What Changes

- 删除 `TrialBanner.vue` / `TrialBanner.test.js` / `LoadingState.vue` / `LoadingState.test.js`。
- `more-tests.test.js`：删掉 TrialBanner 的 4 条用例后文件只剩 import 与 mock、零用例
  （vitest 报 `No test suite found`），连同其**未被使用的 `UpgradeModal` import** 一并删除该文件
  （`UpgradeModal` 的真实测试在 `UpgradeModal.test.js`）。
- `main.js`：去掉 `LoadingState` 的 import 与 `app.component('LoadingState', …)` 全局注册。
- `test-setup.js`：去掉测试全局组件表里的 `LoadingState`（镜像 main.js 的那份注册表）。
- 新增**防复活锁** `components/dead-components.test.js`（6 条）：组件文件不得复活、代码行不得再出现
  两个名字（注释与"断言它不存在"的反向守卫除外，且反向守卫本身被验证仍在做缺席断言）、
  `main.js` 与 `test-setup.js` 不得再注册 `LoadingState`、扫描域规模下界（防空集合假绿）。
- 更正两处指向已删除文件的注释（`DashboardExtraPanels.vue` / `DashboardLockedPanel.vue`），
  改为指向 `git log --follow` 取证路径。

不新增用户可见文案（只减不增）、不改视觉呈现（两组件本就不渲染 ⇒ 像素判定域不含它们）。

## Impact

- Affected specs: `desktop-ui-consistency`（ADDED：已退役组件不得复活 + 全局注册表与真实用法必须同域对账）
- Affected code: `apps/desktop/src/main.js`、`apps/desktop/test-setup.js`、
  `apps/desktop/src/features/dashboard/{DashboardExtraPanels,DashboardLockedPanel}.vue`（注释）
- Affected tests: 删 3 个测试文件（含 1 个空壳）+ 新增 1 把锁（6 条）
- 风险：低但**非零** —— 删除的判据是"零渲染用法"，而注册点在 `src/` 之外还有一处（本批已实测踩到并修正）。
  因此本批的验证域按"谁 import 了它"反查（`git grep` 全域 + `test-setup.js` 显式核对），不只按模板用法。
