---
record: fix-rewrite-warning-severity
task: RewriteView 与 AiWriterPanel 的敏感词 warnings 从红色错误区改为 warning 级；顺带修 max-lines 基线使 CI 恢复绿
date: 2026-10-21
---

## 本次执行记录：敏感词警告的严重级分离（fix-rewrite-warning-severity，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（apps/desktop/src）：隔离 worktree `<worktree-root>/mp-fix-rewrite-warning-severity` + 裸分支 `fix-rewrite-warning-severity`，由 `scripts/start-mp-task.ps1 -TaskName fix-rewrite-warning-severity` 创建；共享根 pre-code-edit-guard 先行 BLOCKED 验证（EXIT=1） |
| 第一性原因（QM-5 ①） | ✅ | 病灶在 `RewriteView.vue` 与 `AiWriterPanel.vue` 的成功分支：`rewriteError.value = data.warnings.join('；')` / `panelError.value = data.warnings.join("；")`。而这两个变量渲染的是 `role="alert"` 的**红色错误区**，且同一时刻 `notifySuccess` 刚弹成功提示、`rewriteResult` 已赋值 ⇒ 用户看到「红色错误 + 成功提示 + 有结果」三者并存。根因是「warnings 与 error 共用一个状态变量」，而这两个语义相反（一个是「成功但需注意」，一个是「失败」）。采集页 4 入口的同类问题已在 PR #4141 修掉，本轮补齐剩下两个消费点 |
| 逃逸分析（QM-5 ②） | ✅ | ① 单元测试层：`RewriteView.test.js` 与 `AiWriterPanel.test.js` 的 mock 都带 `warnings: []`，**无一例覆盖 warnings 非空路径**——空数组让 `if (data.warnings && data.warnings.length > 0)` 永不成立，病灶被空数组永久掩盖；② 集成层/E2E：无；③ 代码审查：外部 subagent CTO 角色审查在 PR #4141 收尾时明确点出「warnings 被写进红色错误区」，但因用户当轮只点名采集页而登记为遗留 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复：两处各新增独立状态（`rewriteSensitiveWarnings` / `panelSensitiveWarnings`）+ warning 级呈现。RewriteView 侧把呈现抽成独立组件 `apps/desktop/src/components/RewriteSensitiveWarning.vue`（直接动因是该文件已贴住 max-lines 上限，见下行）。复位逻辑补在 `startRewrite` / `doRewrite` 入口，避免上轮警告残留。回归测试：新增 `apps/desktop/src/views/RewriteView.sensitive-warning.test.js`（3 例）+ `AiWriterPanel.test.js` 追加 2 例，锁住 ① 有 warnings 时 `role="alert"` 不得出现、② warnings 以 warning 级提示元素呈现、③ **真失败仍进红色错误区**（防止被一起放宽） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 新增测试的 mock 全部走「warnings 非空」路径，空数组不再能掩盖病灶；② `AiWriterPanel.test.js` 的形状断言（`rewriteAndApply` 辅助函数带 `warnings: []`）仍锁默认路径；③ 两条「不得一起放宽」用例（RewriteView + AiWriterPanel 各一）成为后续放宽改动的刹车 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 接线棘轮 | ✅ | 新增用例写在既有 `AiWriterPanel.test.js` 与新建 `RewriteView.sensitive-warning.test.js`，均被 vitest 与 CI 的 QG Unit Tests / QG Desktop Shards 消费；`check-unwired-tests.js` 输出「全部测试均已接线」 |
| QM-1 打包 / QM-4 视觉 | N/A / 部分执行 | QM-1：本 PR 只改 `apps/desktop/src`（渲染层），未触 `apps/desktop/electron/` 或 `packages/rpa-engine`，按 AGENTS.md 口径非强制。QM-4：跑了 `test:visual:pixel`，20 视图中 9 失败，但**失败清单里没有 rewrite**（失败的是 `/`、`/create`、`/dashboard`、`/keywords`、`/collection` 等与本 PR 无关路由，misMatch 1.01%~7.4% 属环境性）；交叉验证：同一套基线在 CI 的 `QG Visual` 为 success（run 39536247860）。故判定为本地环境缺失（登录态/种子数据），非本 PR 引入，未刷新基线 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`；本轮修复的两处病灶均由上一轮 subagent CTO 角色对抗审查发现并登记为遗留，属「按既有审查结论执行」，未以自审冒充 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 测试证据（Fresh）

```
RewriteView.sensitive-warning.test.js: 3 passed（单独跑）
AiWriterPanel.test.js:               25 passed（含新增 2 例）
两者同跑:                            28 passed
三文件同跑（+RewriteView.test.js）:   126 passed
隔离验证（我的文件单独 / 与 AiWriterPanel 同跑）: 3 passed / 28 passed
稳定性: 5 轮同跑 + 2 组隔离，共 7 次 0 失败
门禁: max-lines ✅ | brand ✅ | conflict-markers ✅ | encoding ✅ | unwired ✅ | doc-abs-paths ✅ | qm5-rows ✅
```

### 变异反证（Fresh，非注释）

| 变异 | 结果 |
|---|---|
| M-1：把 `RewriteView.vue` 的 warnings 改回写进 `rewriteError`（恢复旧病灶） | `RewriteView.sensitive-warning.test.js` 的「有 warnings ⇒ 红色错误区不出现」**红** |
| M-2：把 `AiWriterPanel.vue` 的 warnings 改回写进 `panelError`（恢复旧病灶） | `AiWriterPanel.test.js` 的「敏感词警告走 warning 级」**红** |

两个变异均已恢复原值，并全量复跑确认；恢复后 grep 确认零残留（`rewriteError.value = data.warnings` 与 `panelError.value = data.warnings` 均 0 处）。

### 过程踩坑（本轮新遇到，均已落地为 learnings）

1. **flaky 的真正机制**：新增用例最初在「多文件同跑」时偶发失败（单独跑与 3 文件跑都过）。先后尝试过两种错误修法——① `mockResolvedValueOnce` 改 `mockResolvedValue`（`clearAllMocks` 会清掉一次性队列）；② 把默认信封下沉进 `vi.mock` 工厂（反而 4/5 稳定失败，说明根因判断错误，已撤销）。真正生效的是**每个用例末尾 `w.unmount()`**：前一个用例未卸载的组件，其 async 改写链路会跨用例残留。修完后 8 轮 0 失败。
2. **用脚本改代码必须验证结构**：一次用 Node 脚本批量替换 `vi.mock` 段，替换后文件结构损坏（mock 工厂里残留裸对象字面量），症状是「no tests」而不是语法错误——极易误判为「测试没跑起来」。改用编辑工具逐块替换后才对。
3. **`LEDGER_GREW` 与「谁造成的漂移」**：`RewriteView.vue` 在 origin/main 上已 1418/1419 行（上限），199 行历史漂移由 #4123/#4078/#4063/#4032 等多个他人 PR 累积；本 PR 只净增 12 行却触发门禁。已按用户裁决更新基线（1219 → 1430，单键精准更新，diff 仅 1 行且完全可归因），**未使用 `--update --rewrite`**（脚本注释明确警告它会掩盖他人漂移）。

### 遗留（不假装已闭合）

- **`RewriteView.vue` 仍是「贴住上限走」的文件**（1430/1419 上限内，但只差 200 容差即再次触顶）。彻底解法是把字数控制/策略选择等独立语义拆成 composable，属独立重构任务。
- **QM-4 视觉回归未在本地通过**：本地 9 个视图失败但均与本 PR 无关（详见上行），未刷新任何基线；若 CI 的 `QG Visual` 在本 PR 上变红，需按环境性失败排查而非假定与本 PR 相关。
- **`--update --rewrite` 的诱惑仍在**：本次靠单键精准更新绕过，但下次任何人碰 `RewriteView.vue` 仍会再触顶。根治需要一次真正的文件拆分。
