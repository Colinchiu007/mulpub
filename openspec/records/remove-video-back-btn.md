---
record: remove-video-back-btn
task: 删除视频创作流水线（详情页/结果页）的「返回」按钮——现有导航（顶部箭头/视图 tab/左侧菜单）已覆盖返回语义
date: 2026-10-19
branch: remove-video-back-btn
---

# 执行记录：移除流水线「返回」按钮（remove-video-back-btn，2026-10-19）

## 0. 动因（用户截图反馈）

用户贴图指出：视频创作流水线页的「← 返回」按钮（红框）在已有导航功能后属冗余，要求删除，并说明流水线多个页面都有。

**定位（代码实测）**：
- `CreateView.vue` 流水线详情态 `.back-btn`（点击 `goToHistory()`）——红框所圈的按钮；
- `ResultView.vue` 视频预览页 `.back-to-list`（点击 `goBackToHistory()`）——同流程的结果页返回；
- `PromptEvalView.vue` / `HotTopics.vue` 也有返回按钮，但属提示词评估、热门选题模块，**不在视频创作流水线内**，不动。

## 1. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 运行时代码（renderer 层）+ i18n + 视觉基线 |
| 隔离方式 | 独立 worktree `mp-worktrees\mp-remove-video-back-btn`，裸分支 `remove-video-back-btn` |
| 基线 | origin/main（2026-10-19 上午） |

入口走 `scripts/session-init.sh`（`start-mp-task.ps1` 因两个历史外部 worktree 触发健康检查 rc=1，会话改走 bash 入口，worktree 就绪与 verify-worktree-deps 均 OK）。

## 2. 实现（净删除 22 行）

- `CreateView.vue`：删模板 `.back-btn` 按钮 + methods 里唯一调用者 `goToHistory()`（防死方法）；
- `ResultView.vue`：删模板 `.back-to-list` 按钮 + `goBackToHistory()`；
- `create-view.css`：删「详情态隐藏顶部导航箭头」规则（其存在理由就是「.back-btn 已提供返回语义」，前提失效）+ `.back-btn` 三行样式 + reduced-motion 引用；注释改写说明去重逻辑解除；
- `locales/create/zh.js` + `en.js`：删 `backToHistory` key（成对）；
- 顶部导航箭头语义保留：详情态现在可见 ←/→（原被隐藏），返回途径=箭头（对 viewHistory 有栈的路径）/ 三个视图 tab（恒可见，点历史记录即 `switchView` → `detachPipelineView` 清态回历史）/ 左侧菜单。无死态。

## 3. TDD

| 阶段 | 结果 |
|---|---|
| 先加 2 条锁 | **RED**：CreateView 详情态「不渲染 .back-btn + 历史 tab 可点离」、ResultView「按钮与 goBackToHistory 不存在」→ 2 failed |
| 实现后 | **GREEN**：两文件 415/415 全绿 |
| 样式契约 | `src/styles/` 6 文件 43 用例全绿（`.pipeline-grid` 单一来源锁不受影响） |
| 产物验证 | asar 提取后逐符号查 `goToHistory`/`goBackToHistory`/`backToHistory`/`.back-btn` 全部 0 命中 |

## 4. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree，`verify-worktree-deps` OK |
| TDD | PASS | RED(2) → GREEN(415)；样式 43 例全绿 |
| eslint | PASS | 5 个改动文件 rc=0 |
| i18n | PASS | `--keys` 2123 个使用中 key 全存在；`--pair-base origin/main` PASS；`--cjk` 基线 1331 / 当前 1163 无新增 |
| QM-4 视觉回归 | PASS（CI 同源重建） | **流程纠偏如实留痕**：首轮本机 `PIXEL_ONLY + UPDATE_BASELINE` 重捕 4 张基线违反 QM-4 第 7 条，CI Gate 7b 两轮点名 `create-result` 亮/暗确定性漂移（亮 150 px / 暗 8292 px）。正解照 #3916/#3951 先例从 CI artifact 同源渲染重建两张（重建后 vs CI 双轮渲染均 **0 px**）；`create-story2video-detail` 亮/暗实测与 CI 渲染逐像素相等（0 px）保留。**误判修正**：`collection` 本机 1.44% 不是「他人 PR 既有漂移」——CI 上它两轮干净，差异是本机渲染环境 vs CI 渲染的系统性差，正是 Gate 7b 存在的理由 |
| QM-1 打包 | PASS（超出 N/A 基线补做） | 只改 renderer 未触 `electron/`（按门禁本可 N/A），仍跑了 `pnpm run build` rc=0 + asar 产物零残留验证 |
| QM-2 代码必检项 | PASS | 纯删除，无新增同步 CPU 原语 / 全局注册 / IPC / 中文硬编码（删除的中文字面量不入 CI 扫描面） |
| QM-6 双模型评审 | single 档 | UI 微改（7 文件、净删 22 行、无逻辑新增），未调用外部模型，不得读成"已双模型复核" |
| CHANGELOG | PASS | 置顶追加本条 |
| 文档同步 | PASS | PRD 未涉及按钮级 UI 细节，无需改 |

| 远程同步 | 由门禁推导 |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | eslint ✅ | i18n ✅ | QM-4 ✅ | QM-1 ✅ | QM-2 ✅ | CHANGELOG ✅ | 文档同步 ✅

## 5. 已知残留（不假装已闭合）

- `PromptEvalView` / `HotTopics` 的返回按钮是否同样冗余，由用户后续单独裁决。
- 教训（对齐 check-baseline-freshness.js 头注释的原始事故）：基线永远只允许从 CI 同源渲染重建。本机渲染与 CI 渲染存在亚像素级系统性差（本机 4 张基线对本机渲染全绿，但与 CI 渲染差 0.007%–0.4%），views 套件 1% 阈值会把这种差吃掉，Gate 7b 的 0 px 判据才能抓住。
