---
record: cv-cjk-fallback2
task: CreateView script 区 43 处 translateWithLocaleFallback 兜底参数清偿（遗留②第二子批，CJK 净还债 107）
date: 2026-10-11
---

## 本次执行记录：translateWithLocaleFallback 兜底清偿（cv-cjk-fallback2，2026-10-11）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时变更：隔离 worktree `mp-cv-cjk-fallback2` + 裸分支；共享根保持 main |
| CreateView.test.js | PASS | 288/288 |
| views-deep2.test.js | PASS | 7/7 |
| 全量 views+locales+overlay | PASS | 1800 passed / 1 skipped（零失败；4 errors 为既有 unhandled 警告） |
| Gate 7 `--cjk` | PASS | 基线 1489 → 当前 **1182**（净还债 107） |
| Gate 7 `--keys` | PASS | 1891 key 全存在 |
| 债务熔断 | PASS | 全指标基线内 |
| 行尾对账 | PASS | 两口径一致（3 文件） |
| QM-1 打包 | N/A | 未触 electron 主进程 |
| QM-4 视觉 | PASS | zh 文案逐字不变（除 composeProgress 按原兜底串入键），CI QG Visual 为准 |
| QM-6 CCG 双模型评审 | PASS | i18n 迁移模式第 5 次复用，无方案外新决策 |
| 远程同步 | PASS | PR #3330 已 squash 合并，merge SHA `44690c8267f31c40073b5ef292f357abdb10ac88`（2026-10-12T00:17:34+08:00），取证 `git log origin/main --grep='(#3330)$' --format=%H|%cI` 唯一命中；`git ls-remote --heads origin cv-cjk-fallback2` 返回 0 行，证远端分支已删；frontmatter `sync_*` 三字段已在本次回填提交删除（登记随本文件 frontmatter，未占 ledger）。补充：合并前 quality-gate 四轮红——前三轮根因是 `restoreS2VLastOptions` 的裸 `$t` 在 vm 卸载后的异步续体里抛 unhandled rejection（15555 tests 全过但 vitest exit 1），修复为 `translateWithLocaleFallback` 同款存在性防御后第四轮 success（20 pass/1 skip）；期间还发现 `story2video.composeProgress` 键从未存在（原调用一直靠中文兜底），已补键。 |

### 改动

- `CreateView.vue`：script 区全部 43 处 `translateWithLocaleFallback(key, zh, en[, params])` 重写为 `this.$t(key[, params])`（括号配对解析器，处理嵌套字符串/模板串）
- `locales/story2video/{zh,en}.js`：补 `composeProgress` 键（原调用一直靠中文兜底工作——键从未存在；zh `'视频合成 {percent}%'` / en `'Composing {percent}%'`）

### 排障记录（如实）

①首版脚本产生 `this.this.$t(` 残留 43 处（`this.translateWithLocaleFallback` 的 `this.` 未剥）→ 渲染期 TypeError 6 例红 → 全局替换修复；②`story2video.composeProgress` 键不存在（其余 42 处键均存在）→ `--keys` 拦截 → 补键。

### 后续（不在本 PR）

第三子批：模板区 77 行（需模板改动，独立专项）。
