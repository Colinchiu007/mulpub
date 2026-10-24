# Design: ux-audit-dead-components-retire

## Context

审计条目要求 `TrialBanner` / `LoadingState` 二选一（接上 / 删除），不允许"存在但无人渲染"。
两者都不是"忘了接"：`TrialBanner` 的文案在看板页被**产品决策主动撤下**（`Dashboard.style-guard.test.js`
留了两版反转史），`LoadingState` 只是被 `main.js` 全局注册后无人使用。

## Goals / Non-Goals

**Goals**：消除两个"存在但不可达"的组件；留下不会自我误判的防复活锁；把注册表的验证域扩大到
`src` 之外（`test-setup.js` 那面镜像）。

**Non-Goals**：不做"把 TrialBanner 挂到会员中心"（与既成决策冲突，且需要新文案设计）；
不动 `EmptyState` / `UiSkeleton`（有真实用法）；不引入通用的"未接线组件"门禁（属阶段 5.3，本批只锁这两例）。

## Decisions

### D1 选择删除而不是接线

判据不是"哪个组件设计得更好"，而是**是否与已编码的 UX 契约冲突**：
套餐差异已由区块锁占位（`DashboardLockedPanel.vue`）表达，横幅文案的"误导"理由在会员中心同样成立。
接线会新增一处与区块锁重复的真源，并绕过 2026-10-17 那次用户决策。
审计条目原文即"二选一"，删除完全满足。

### D2 防复活锁按"代码行 + 语义"切，而不是按字符串出现切

粗判据（全文件 `includes('TrialBanner')`）会把两类东西判成违规：
① 解释"为什么删"的注释；② **断言它不存在**的反向守卫（`indexOf("<TrialBanner")`、
`findComponent({ name: "TrialBanner" })` 都是代码行）。后果是逼着后来者删掉守卫或放宽判据。
正解：先剥行注释再匹配；豁免两个反向守卫文件；并加一条**验证豁免文件仍在做缺席断言**的对偶锁，
使豁免不能变成可复用的洞（"禁令必须配正向对偶"同族）。

### D3 扫描域必须含 `src` 之外的注册点

本批实测踩到：只 grep `src/` 判"零引用"，但 `apps/desktop/test-setup.js` 静态 import 并注册了
`LoadingState`，删除后 4 个测试文件以 `Failed to resolve import` 整片挂死——症状出现在与删除无关的文件上。
因此除了修注册点，另加一条直接锁 `test-setup.js` 的用例；判据"某个文件是否提到该组件"由锁自己读，不靠记忆。

### D4 `more-tests.test.js` 整文件删除而不是留空壳

删掉 TrialBanner 的 4 条后该文件只剩 import + mock + 零用例，vitest 直接报 `No test suite found`
（不是"跳过"，是**红**）。其中 `UpgradeModal` 的 import 本就未被该文件使用，真实测试在
`UpgradeModal.test.js`。留空壳会制造一条恒红或恒空的假锁，删掉是收敛。

## Risks / Trade-offs

- **风险**：删除是不可逆动作（可逆：git 历史在，恢复路径写进注释与锁文案）。
  缓解：锁的红文案直接给出恢复前置条件（必须同时恢复看板页位置守卫 + 另开 change）。
- **风险**：防复活锁按 needle 匹配，若将来出现同名但不同意图的合法代码（例如新组件恰好叫
  `TrialBannerX`），会误红。刻意的保守方向：宁可误红让作者改名，也不要"存在但无人渲染"再复发。
- **回滚**：本批全部是删除 + 一把新锁；回滚即 `git revert`，无数据迁移。

## Open Questions

- 阶段 5.3 的通用门禁（`check-ui-wired.js`：有 prop 且全仓零引用的 `src/components/*.vue` 即报未接线）
  上线后，本批这两例应被其覆盖并可缩成棘轮的一部分；本批不擅自把全域打开。
