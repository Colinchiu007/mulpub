---
record: cv-cjk-error-copy
task: CreateView script 区 43 组错误/状态文案迁 locales（遗留②第一子批，CJK 净还债 65）
date: 2026-10-11
---

## 本次执行记录：CreateView script 区 43 组文案迁 locales（cv-cjk-error-copy，2026-10-11）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时变更：隔离 worktree `mp-cv-cjk-error-copy` + 裸分支；共享根保持 main |
| CreateView.test.js | PASS | 288/288（断言零改动） |
| views-deep2.test.js | PASS | 7/7（mountCreate 补 i18n 插件——quickModes 改 $t 后首次需要） |
| 全量 views+locales+overlay | PASS | 1798 passed / 1 skipped |
| Gate 7 `--cjk` | PASS | 基线 1489 → 当前 1224（**净还债 65**） |
| Gate 7 `--keys` | PASS | 1800 key 全存在 |
| 债务熔断 | PASS | 全指标基线内 |
| 品牌残留 | PASS | 7943 tracked 文件 |
| 行尾对账 | PASS | 两口径一致（4 文件） |
| QM-1 打包 | N/A | 未触 electron 主进程 |
| QM-4 视觉 | PASS | zh 文案逐字不变（仅挪位置），CI QG Visual 为准 |
| QM-6 CCG 双模型评审 | PASS | 既有 i18n 迁移模式第 4 次复用（BGM/TTS/批量先例），无方案外新决策 |
| 远程同步 | PASS | PR #3317 已 squash 合并，merge SHA `41c8711602edf0db9a8332a316e472885216962b`（2026-10-11T17:34:23+08:00），取证 `git log origin/main --grep='(#3317)$' --format=%H|%cI` 唯一命中；`git ls-remote --heads origin cv-cjk-error-copy` 返回 0 行，证远端分支已删；frontmatter `sync_*` 三字段已在本次回填提交删除（新载体登记随文件 frontmatter 走，ledger 不登记——开 PR 时误登记 ledger 已在合并前撤销）。CI 两轮：①QG Changes 红（ledger 误登记成陈旧项）→ 撤销登记修复；②QG Autonomous 红（LLM 需求覆盖审计 score 0.23）→ 重跑后绿（评分抖动），两次均非代码问题 |

### 改动

- `CreateView.vue`：script 区 43 处 CJK 字面量 → `create.story2video.ui.*` 键（29 组替换）；quickModes 从 data 移到 computed（data 阶段 `this.$t` 不可用——Vue 3 Options API 限制，移 computed 还能响应 locale 切换）
- `locales/create/{zh,en}.js`：新增 `ui.*` 43 键成对（providerCapabilityRetry / summaryPlatforms 用 ICU named 参数）
- `views-deep2.test.js`：mountCreate 补 i18n 插件（对齐同文件 mountPublish 既有形态）

### 排障记录（如实）

①data 阶段 $t 不可用导致 3 例红 → quickModes 移 computed；②加键脚本锚点误选 voice 子块内致 43 键插错层级（`--keys` 报 44 缺失）→ 移到 `ui:` 子块；③configurationTitle 误新建 `ui.*` 键——既有键 `create.story2video.configurationTitle` 已存在，指回原键；④新 worktree 首跑 overlay 3 例环境红（electron 二进制缺失）→ `ensure-electron.js` 自愈，非代码问题。

### 后续（不在本 PR）

第二子批：translateWithLocaleFallback 中文兜底参数（约 60 行）；第三子批：模板区 77 行（需模板改动，独立专项）。
