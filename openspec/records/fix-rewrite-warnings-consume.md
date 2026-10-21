---
record: fix-rewrite-warnings-consume
task: 收尾 rewrite-sensitive-precheck-relax 的两项遗留：采集页 4 个入口消费后置敏感词 warnings；_sensitiveCheck 拆独立模块腾出 max-lines 余量
date: 2026-10-21
---

## 本次执行记录：采集页消费敏感词警告 + _sensitiveCheck 拆模块（fix-rewrite-warnings-consume，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（apps/desktop/src + packages/rewrite-engine/src,tests）：隔离 worktree（`<worktree-root>/mp-fix-rewrite-warnings-consume`，由 `scripts/start-mp-task.ps1 -TaskName fix-rewrite-warnings-consume` 创建）+ 裸分支 `fix-rewrite-warnings-consume`；共享根 pre-code-edit-guard 先行 BLOCKED 验证（EXIT=1，含 Write Guard 违例提示） |
| 第一性原因（QM-5 ①） | ✅ | 两项遗留同源于 PR #4103 的「B+」取舍。① 采集页：`rewriteViaEngine` 成功分支只挑 `result_content/knowledgeRefs/meta`（`Collection.vue` 原 859-868 行），引擎后置 warnings 被**静默丢弃**；改写页与 AI 面板都消费 warnings（虽写进红色错误区、样式不当），而采集页 4 个入口（视频转写 / stealth 自动 / 聚合回退 / 手动改写）零提示 ⇒「保留后置提醒」这半条防线在采集页不成立。② max-lines：`rewrite-engine-core.js` 登记值 578 + 容差 200 = 778 上限，PR #4103 收尾时实测 749 行（余量约 29 行），而敏感词语义是会被反复改动的活跃面——第一版注释写厚即超限 4 行被 CI 判 `LEDGER_GREW` |
| 逃逸分析（QM-5 ②） | ✅ | ① 单元测试层：`Collection.rewrite-wordcount.test.js` / `Collection.rewrite-input-limit.test.js` 都只断言 meta 的四字段形状，**没有一例断言 warnings**——形状断言锁的是「已实现的字段」，新字段加进来时它们本该红却因为只测四字段而漏掉；② 集成层：无测试覆盖「引擎 warnings → 采集页 UI」这条链；③ E2E/视觉：无；④ 代码审查：外部审查（subagent CTO 角色）明确点出「B+ 的后置半条在采集页实际不成立」，但 PR #4103 已合入，遗留至本轮 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复一（采集页）：`rewriteViaEngine` 成功分支把 `warnings` 归一化后收进 `rewriteSensitiveWarnings` 状态与 `meta.warnings`；`clearRewriteResult` 一并复位；漏斗内唯一发声点 `notifyWarning('rewritePage.rewriteSensitiveWarning')`（4 个入口全覆盖，漏一个即静默）；模板加 `data-testid="collection-rewrite-sensitive"` 提示条 + CSS `col-warn-banner`（warning 语义，非红色错误）；locale zh/en 成对新增 `rewriteSensitiveWarning`。修复二（拆模块）：新建 `packages/rewrite-engine/src/sensitive-check.js`（59 行，含完整语义说明），`rewrite-engine-core.js` 的 `_sensitiveCheck` 改为委托，core 749 → 741 行。回归测试：新增 `apps/desktop/src/views/Collection.rewrite-sensitive-warning.test.js`（6 例：透传/无警告/字段缺失/提示条渲染/warning 级而非 error 级/复位）+ `packages/rewrite-engine/tests/sensitive-check.test.js`（7 例：未注入/命中/后置同语义/缺 hits 字段归一化/抛错留痕/logger 缺失/非 Error 归一化）+ `Collection.rewrite-input-limit.test.js` 补 1 例 warnings 透传并更新 2 处形状断言 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 本执行记录登记「形状断言锁已实现字段 ⇒ 新字段进来时它们必须红，这是对的，红的是我的改动而非测试失效」这一辨析；② `Collection.rewrite-input-limit.test.js` 的两处 `toEqual` 已含 `warnings`，后续再加 meta 字段仍会被抓；③ learnings 新增 3 条（见 `01-docs/learnings.md` 顶部） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径一致（新增文件为 LF，仓库 `.gitattributes` 为 `* text=auto`；新增文件尚未入库故无行尾转换，见下方遗留） |
| 接线棘轮 | ✅ | 新增用例全部写在既有测试文件（`Collection.rewrite-input-limit.test.js`）或新建**与既有同前缀**的测试文件（`Collection.rewrite-sensitive-warning.test.js` / `sensitive-check.test.js`），两者均已被 vitest 与 CI 的 `QG Unit Tests` / `QG Desktop Shards` 显式消费；`check-unwired-tests.js` 输出「全部测试均已接线」 |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：`cd apps/desktop && pnpm exec electron-builder --win --dir --publish never` rc=0；asar 内含 `@multi-publish/rewrite-engine/src/sensitive-check.js`；启动三层判据 **PASS**（窗口期 8s 内存活 + stderr 为空），子进程 env 显式剔除 `ELECTRON_RUN_AS_NODE`（本机父环境实测带该变量，已出声告警后剔除）。QM-4 视觉：未改既有视觉呈现（新增提示条为新增元素，非改版），未跑像素回归，见遗留 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`。本轮改动性质为「收尾 PR #4103 已审查出的两项遗留」，审查结论本身即来自上一轮的 subagent CTO 角色对抗审查（只读 + 19 次变异），本轮未重复外部评审，也未以自审冒充 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 测试证据（Fresh）

```
packages/rewrite-engine:  Test Files 18 passed (18) | Tests 290 passed (290)
apps/desktop Collection 系列 + 渲染层:
  Test Files 12 passed (12) | Tests 298 passed (298)
  - Collection.test.js / Collection.rewrite-sensitive-warning.test.js(6 新)
  - Collection.rewrite-wordcount.test.js / Collection.cancel.test.js
  - Collection.rewrite-input-limit.test.js(10) / Collection.step-flow.test.js
  - Collection.viral-contract.test.js / RewriteView.test.js / RewriteView.output-truncated.test.js
  - RewriteView.cancel.test.js / AiWriterPanel.test.js / rewrite-engine-error.test.js
apps/desktop electron 相关:
  Test Files  3 passed (3) | Tests 100 passed (100)
  - electron/ipc-handlers/sensitive.test.js / ops-center-sync.test.js / ipc-contract.test.js(5)
门禁: max-lines ✅ | brand ✅ | conflict-markers ✅ | encoding ✅ | unwired ✅ | doc-abs-paths ✅
QM-1: electron-builder rc=0 + 启动三层判据 PASS + asar 含 sensitive-check.js
```

### 变异反证（Fresh，非注释）

| 变异 | 结果 |
|---|---|
| M-BLOCK：把 `sensitive-check.js` 的 `blocked` 改回 `stage === 'pre' && hits.length > 0`（恢复前置拦截） | 端到端 `rewrite-engine-core.test.js` 的 **X1 红** + 模块级 `sensitive-check.test.js` 的 **「命中 ⇒ blocked 恒 false」红**（双层都抓住） |

变异后已手动恢复原值并全量复跑（290 例全绿）确认。

### 过程踩坑（本轮新遇到）

- **`git checkout -- <file>` 恢复不了未入库的新文件**：变异还原时先跑了 `git checkout -- packages/rewrite-engine/src/sensitive-check.js`，报 `did not match any file(s) known to git`（该文件尚未 commit），而我用 `grep 'blocked: false,'` 自证时命中的是**第 39 行另一个正常返回**，误以为已恢复。是 `grep blocked:` 列出全部 4 处才看出第 43 行变异还在。**教训：自证必须列全部命中点，不能只 grep 一个字符串就下结论。**
- **新 worktree 跑 `ipc-contract.test.js` 会因缺 `index.bundle.js` 而 ENOENT**：该测试依赖构建产物。先 `pnpm run build:preload` 再跑即 5/5 通过。这是环境缺失，不是回归。

### 遗留（不假装已闭合）

- **`RewriteView.vue:890` 与 `AiWriterPanel.vue` 仍把 warnings 写进红色错误区**（`rewriteError` / `panelError`），与「改写成功了」的视觉语义矛盾；本轮只修了采集页（用户点名的那处）。正解是把 warnings 与 `rewriteError` 分离（前者提示、后者失败），需单独一轮。
- **QM-4 视觉回归未跑**：新增 `collection-rewrite-sensitive` 提示条是新元素（非改版），本轮未跑 `npm run test:visual:pixel`。若该提示条的渲染被后续样式改动破坏，现有单测断言的是 DOM 存在性与文案，不锁像素。
- **`rewrite-engine-core.js` 余量从约 29 行提升到约 37 行**（741/778），仍是「贴着上限走」的状态；彻底解法是继续把其它独立语义（如 `_postProcess`）拆出去，而非继续压缩注释。
- **新增测试文件为 LF 行尾**，而仓库 `.gitattributes` 为 `* text=auto`。入库时 git 会按平台转换，两口径 numstat 在**提交后**才需复验（提交前两口径一致是因为文件未入库）。
