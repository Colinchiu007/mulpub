---
title: "ui-visual-premium：桌面端视觉系统升级（高级感与统一性）"
change: ui-visual-premium
branch: ui-visual-premium
date: 2026-10-20
status: executed
---

# 执行记录：桌面端视觉系统升级

## 任务目标

用户诉求：「整个应用前端界面需要视觉优化……从视觉上不太统一，而且很混乱、很粗糙、不精致。
目标是提高档次，实现高级感和精致感」，参考风格为过渡色 / 毛玻璃 / 半透明 / 柔和。

## 变更类型与隔离声明

- **变更类型**：混合 PR（运行时样式代码 + 文档 + 视觉基线 + 测试脚本 + 巡检证据资产）。
- **隔离方式**：独立 worktree `<仓库父目录>/mp-worktrees/mp-ui-visual-premium`（非 C 盘），
  分支 `ui-visual-premium`（非 C 盘），由 `scripts/start-mp-task.ps1 -TaskName ui-visual-premium` 创建。
  共享主目录保持 `main` clean，未直接改动。
- **不改**：业务逻辑、数据结构、IPC 契约、信息架构、导航层级。

### 文件范围声明（供 CCG 决策层做范围漂移核对）

| 类别 | 路径 | 说明 |
|---|---|---|
| 令牌层 | `apps/desktop/src/styles/tokens.css` | 表面/描边/高度/渐变/玻璃/动效/字体栈令牌 + 暗色同构 |
| 设计系 | `apps/desktop/src/styles/cohere-design-system.css` | 共享类观感口径（标题/按钮/输入/徽章/统计卡/模态/卡片/图标） |
| 设计系（新增） | `apps/desktop/src/styles/premium-design-system.css` | 高级感视觉层：画布/玻璃带/标题体系/分段胶囊/滚动条/焦点环/空态 |
| 外壳 | `apps/desktop/src/styles/sidebar.css`、`apps/desktop/src/App.vue` | 侧栏毛玻璃 + 壳层透明化 |
| 展示页 | `apps/desktop/src/views/Home.vue`、`Dashboard.vue`、`features/dashboard/DashboardLockedPanel.vue` | 首页/看板/锁定面板 |
| 入口 | `apps/desktop/src/main.js` | 引入高级感视觉层（1 行 import） |
| 测试 | `apps/desktop/src/views/Dashboard.style-guard.test.js` | hero 卡断言改为「已定义渐变 token」+ 暗色同构断言 |
| 测试（新增） | `apps/desktop/tests/visual-testing/ui-audit-scripts.test.js` | 巡检脚本冒烟 + 路由覆盖守卫 |
| 巡检脚本（新增） | `apps/desktop/tests/visual-testing/scripts/ui-audit-{recon,capture,preview}.js`、`accept-baselines.js`、`curate-ui-audit-evidence.js` | 界面面枚举 / 全量截图 / 单页预览 / 基线接受 / 证据挑选 |
| 视觉基线 | `apps/desktop/tests/visual-testing/base-screenshots/*.png` | 40 张（20 视图 × 亮/暗）随本次**有意视觉变更**重生成 |
| 文档 | `01-docs/UI-VISUAL-AUDIT-2026-10-20.md`、`01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md`、`01-docs/design-system-usage.md` | 巡检报告 / PRD / 令牌口径 |
| 证据资产（新增） | `01-docs/assets/ui-visual-audit-2026-10-20/*.png` | 10 组 before/after（约 3.5MB） |
| 配置 | `.gitignore` | 为证据资产加 `!` 例外（根规则有全局 `*.png`） |
| 审计轨迹 | `.ccg/reviews/*.json`、`.adversarial/ccg-deep-780717af/*` | CCG 判定记录 + 双家族评审与裁决 |

## 执行内容

| # | 内容 | 落地 |
|---|---|---|
| 1 | 全量界面面侦察（机器枚举） | `tests/visual-testing/scripts/ui-audit-recon.js` |
| 2 | 全量界面面截图巡检（6 维度 177 张） | `tests/visual-testing/scripts/ui-audit-capture.js` |
| 3 | 令牌层：表面/描边/高度/渐变/玻璃/动效/字体栈 + 暗色同构 | `src/styles/tokens.css` |
| 4 | 共享类观感升级 | `src/styles/cohere-design-system.css` |
| 5 | 高级感视觉层（新增） | `src/styles/premium-design-system.css` + `src/main.js` |
| 6 | 应用外壳（侧栏玻璃带 + 壳层透明化） | `src/styles/sidebar.css`、`src/App.vue` |
| 7 | 展示页升级（首页 / 数据看板 / 锁定面板） | `src/views/Home.vue`、`src/views/Dashboard.vue`、`src/features/dashboard/DashboardLockedPanel.vue` |
| 8 | 文档 | `01-docs/UI-VISUAL-AUDIT-2026-10-20.md`、`01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md`、`01-docs/design-system-usage.md` |

## 量化结果（32 路由计算样式审计）

| 维度 | 改造前 | 改造后 |
|---|---:|---:|
| 不同颜色值 | 142 | 待复测 |
| 不同圆角值 | 22 | 待复测 |
| 不同间距组合 | 143 | 待复测 |
| 字体栈种类 | 3 | 2（`--font-family-ui` / `--font-family-ui-display`） |
| 页面标题色 | 3 | 1（`--color-text-strong`） |

## 关键判据

- 品牌渐变两端白字对比度 ≥ 4.5:1（实测 `#5B5EE8` 4.91:1、`#8B3FD9` 5.51:1）。
- 侧栏文字档亮/暗两套对比度 ≥ 4.5:1（亮色档因侧栏改玻璃底而加深到 `#5f6280`）。
- 焦点环不得移除（WCAG 2.4.7），`focus-ring.test.js` 保持通过。
- 视觉基线属**有意变更**，随本次提交重生成；CI 按「同一次 CI 渲染」口径核对漂移。

## 遗留

见 `01-docs/UI-VISUAL-AUDIT-2026-10-20.md` §8（R1–R6）。

### R6（CCG 第三轮评审追加）：两项「未实测」的诚实登记

CCG 第三轮评审（critic=claude / proposer=opencode，head 与本提交一致）指出两处
「结论对但取证不足」的地方，登记在此，**在拿到实测数据前不得宣称已解决**：

| 项 | 现状 | 待办 |
|---|---|---|
| **毛玻璃的 GPU 开销** | 模糊半径已从 20px 降到 14px，并加了 `prefers-reduced-transparency: reduce` 守卫 | 降半径是**静态推理**（采样成本与半径正相关）下的风险降低，**不是**实测帧率结论。需在真实 Electron 窗口测滚动/加载下的帧时间 |
| **暗色主题的像素回归** | 亮/暗双主题各 20/20 零漂移（headless Chromium） | 真实 Electron 窗口的合成器行为可能不同（毛玻璃尤其如此），需真实窗口复核 |

performance 维度分**维持评审原值不上调**（correctness 3 / security 3 / performance 4 /
maintainability 2），correctness 亦不上调。

### R7（CCG 第三轮评审追加）：「新增 .adversarial SHA 对齐门禁」列为独立后续项

评审建议新增一条 CI 门禁，校验 `.adversarial/` 里的 SHA 引用与 `git rev-parse HEAD` 一致。
**本轮不实现** —— 按 AGENTS.md「改谁来守门必须人工过目」，新增门禁并接进 changes job
属于改守门结构，不应由 agent 在功能 PR 里顺手做掉。本 PR 的处置是**消除脱节面**：
分支压成单提交、重放残留的旧评审目录整份删除。

---

## 四、CCG 外部双家族评审与处置

### 4.1 评审执行

| 轮次 | head | 判定 | 结论 |
|---|---|---|---|
| 第一轮 | 重放前的提交 | DUAL | 8 条意见 → 修 7 条（i7 以取证方式判定为已消解） |
| 第二轮 | 重放后的提交 | DUAL | 8 条意见 → 全部处置；其中 i2/i3 指出审计轨迹与 head 脱节 ⇒ 删除重放残留目录、本 PR 压成单提交 |
| 第三轮 | 本提交 | DUAL | 8 条意见 → 全部处置；i1 质疑外部复核证据的真实性 ⇒ 补可 API 复核的公开评论 + 高危面零命中取证；i5 要求变异反证 ⇒ 已补 |

**后端**：critic=`claude` 2.1.303 · proposer=`opencode` 1.18.34 · 跨家族校验三轮均通过。

### 4.2 关键处置

| 项 | 处置 |
|---|---|
| **i1/i3 外部复核证据** | PR #4124 评论 `issuecomment-6309670069` 给出三条可独立复现的机器命令：评论真实性（`gh api issues/4124/comments`）、高危面零命中（`git show --name-only HEAD \| grep <HIGH_RISK_SURFACES>`）、新增行鉴权/加密关键字零命中（3124 行全扫） |
| **i2/i8 审计轨迹脱节** | 分支压成**单提交**；`.adversarial/` 只保留与当前 head 对齐的一轮；`.ccg/reviews/` 本 PR 只新增一条（pre-commit 按 diff 内容寻址生成，deep-review 按同一口径命中） |
| **i4 性能** | 模糊半径已降 + 守卫已加，但**不上调 performance 分**；真实窗口帧率实测登记为 R6 |
| **i5 变异反证** | 抽出纯函数 `ui-audit-scripts.lib.js#computeUncoveredRoutes`；用例往 router 注入假路由 `/__mutation-probe`，断言守卫当场判红并点名它（6/6 通过） |
| **i6 证据体积** | 仓内保留 10 组 before/after（约 3.5MB）+ 177 条标注清单；全量 387 张按仓库约定留在 gitignored 目录 |

### 4.3 处置后的验证

- 巡检脚本冒烟 + 路由覆盖守卫 + 变异反证：**6/6**
- 样式契约 / 骨架契约 / 令牌 / 看板守卫：**81/81**
- 视觉基线（亮/暗双主题）：各 **20/20 零漂移**
- 对比度审计：18 视图 **0 处**低对比度

---

## 四、CCG 外部双家族评审与处置

### 4.1 评审执行

| 项 | 内容 |
|---|---|
| 判定 | **DUAL**（变更 1588 行 > 200 行阈值，触发 §12.6 Red Team 门禁） |
| critic | `claude` 2.1.303（跨家族校验主力） |
| proposer | `opencode` 1.18.34（出方案后端） |
| 跨家族校验 | 通过 |
| 评审产物 | `.adversarial/ccg-deep-<sha>/{critique-v1.md, proposal-v1.md, adjudication.json}` |
| critic 维度分 | correctness 5 / security 6 / performance 5 / maintainability 3 |

### 4.2 逐条处置

| # | 严重度 | 评审意见 | 裁决 | 处置 |
|---|---|---|---|---|
| i1 | Critical | `.ccg/reviews/*.json` 的 sha 与 stagedDiffHash 指向不同对象；deepReview 字段为空 | **部分成立** | sha/hash 不同维度是既定设计（内容寻址 + pre-commit 写在父 sha 上）；但「提交了 amend/rebase 中间态记录」成立 → **已删**两条中间态记录 |
| i2 | Critical | 记录里的 changedLines/fileCount 与 sha 不同源，审计轨迹不可靠 | **成立** | 同 i1 的根因；**已修**——rebase 后改用 `reset --soft` + 全新 commit 重做（不 amend），保证 `git diff --cached` 与 `git diff HEAD^ HEAD` 同一口径，判定记录按内容寻址成功命中 |
| i3 | Warning | 全局 `backdrop-filter: blur(20px)` 在 Electron 里是 GPU 密集操作 | **成立** | 本仓玻璃区背后是静止内容（画布 `background-attachment: fixed`、工作区自带滚动），实际风险低于指控；仍**已修两道**——模糊半径 20px→14px；新增 `prefers-reduced-transparency: reduce` 守卫退回实心表面 |
| i4 | Warning | 新断言只查 token 存在，缺暗色档同构校验 | **成立** | 暗色缺定义时断言照样绿 ⇒ 暗色 hero 卡回退无背景（PR #2075 同型）。**已修**——新增「品牌渐变 token 亮/暗双档同构」断言，两处作用域都必须定义且都含渐变 |
| i5 | Warning | 20 张二进制 PNG 入库；.gitignore 例外冗余 | **部分成立** | 量化有误（实为 20 张 / 约 3.5MB，非 48MB——48MB 是留在 gitignored 目录的全量集）；「例外冗余」也不对（根 `.gitignore` 有全局 `*.png`，新文件必须靠 `!` 例外才能入库）。已按「最小证据满足评审需求」收敛为 10 组 before/after，例外补注理由与体积 |
| i6 | Info | `accept-baselines.js` 用文件名拼 RegExp 未转义 | **成立** | **已修**——新增 `escapeRegExp()`，文件名中的 `.`/`+`/`(` 等元字符不再被当模式 |
| i7 | Info | 新增的 transform/box-shadow 过渡可能与组件级动画冲突 | **不成立** | `transition` 与 `animation` 是两条独立通道；改动只涉及共享类的 transition 属性列举，组件级 `@keyframes fadeInUp` 不受影响 |
| i8 | Warning | 新巡检脚本共 1150 行，零单测 | **成立** | 核心风险是「覆盖完整性无人看守」，完全可测。**已修**——新增 `tests/visual-testing/ui-audit-scripts.test.js`（5 例），含**路由覆盖守卫**（router 全路径 vs 巡检清单求差集，漏登记即红，正确处理重定向源与 `:param` 动态路由两种豁免）。未采纳「把 playwright 钉成精确版本」——仓库统一 caret 范围，浏览器版本由 CI 的 `playwright install chromium` 决定 |

### 4.3 处置后的验证

- 巡检脚本冒烟 + 路由覆盖守卫：**5/5 通过**
- Dashboard 样式契约（含新增暗色同构断言）：**14/14 通过**
- 视觉基线：亮/暗双主题各 **20/20 零漂移**（模糊半径调整后已重生成）

---

## 五、远程同步

- 保留门禁：变更类型与隔离声明 ✅ | 视觉基线零漂移 ✅ | CCG 双家族评审 ✅ | 远程同步 PR #4124

| 远程同步 | 由门禁推导 |
| --- | --- |

> 状态列写「由门禁推导」而非手写 `PASS`：收口由 `scripts/lib/merge-ledger.js` 按主干历史
> 推导（合并后自动闭合），手写闭合词会被 `check-gate-record-debt.js` 判 `prematureClaim` 红。
> 依据：`openspec/specs/openspec-integration/spec.md`「分层分支策略」Requirement
> + `change: gate-record-sync-derived-status` / `change: ban-record-closure-backfill-pr`。
