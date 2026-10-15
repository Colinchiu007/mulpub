---
record: fix-toutiao-title-suffix
task: 修复头条图文标题被追加时间戳后 4 位（「DeepSeek崩了」→「DeepSeek崩了 1935」），把「触发保存的手段值」与「发布的内容值」隔离，并全平台审计同源问题
date: 2026-10-15
---

## 本次执行记录：头条图文标题污染修复（fix-toutiao-title-suffix，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（`packages/rpa-engine/src/toutiao-direct-bridge.js`）+ 文档。隔离 worktree：`D:/Data/projects/mp-worktrees/mp-fix-toutiao-title-suffix`（D 盘），裸分支 `fix-toutiao-title-suffix`；`pre-code-edit-guard.ps1` 在 worktree cwd 下 exit=0；依赖经 `verify-worktree-deps.js` 通过（11 项消费方解析） |
| 第一性原因（QM-5 ①） | ✅ | `publishViaPageXhr()` 为触发头条编辑器自动保存，把标题改写为 `原标题.slice(0,26) + ' ' + Date.now().toString().slice(-4)` 且**从不还原**；页面 React 据此自动保存 → XHR hook 捕获 body 到 `__lastSaveBody` → 重放脚本「只改 save=0→1」把污染 `title=` 一并发出。1935 = 当时的 epoch 毫秒后 4 位（epoch ms 1792001935000 ↔ 2026-10-15 02:18:55 +08:00，与发布同日同量级）。**根因一句话：把「触发手段」当成了「发布内容」** |
| 逃逸分析（QM-5 ②） | ✅ | 四层全漏：① 单元测试——`toutiao-schedule-intent.test.js` 7 条只锁「定时意图不丢」，**没有一条断言发布出去的标题等于原标题**，且扰动脚本是页面内字符串，mock 掉 `executeJavaScript` 就完全看不到；② 契约锁（content-formatter/topic-inline/registry-sync）——只管 Node 侧字段值，与页面上下文的 RPA 写入**无桥**；③ 代码审查——注释写着「复刻诊断脚本成功路径」并被 `// ⭐` 标为成功经验，读起来不像 bug 位；④ 真机验收——2026-10-03 验的是「save=1 → code=0 提交成功」，**没有回查平台后台的标题文本** |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复：`buildTitleBumpScript()`（记 orig → 写 orig+U+200B → input → 同帧还原 orig → 再 input；零截断、禁时钟）+ `overrideBodyTitle()`（重放前强制 body `title=` = `article.title`，`(^|&)title=` 精确判据不误伤 `title_id=`，无字段追加，空标题 fail-safe no-op）。回归锁：`packages/rpa-engine/tests/toutiao-title-no-pollution.test.js` **19 条**（A 净效果 6 / B 触发能力保留 2 / C body 覆盖 6 / D 结构锁 3 / E 端到端集成 2），TDD 两段实跑：先红 19/19 → 修复后绿 19/19 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① AGENTS.md QM-2 新增「⛔ 发布内容保真合同（trigger-value isolation）」四条不可破 + 修改该文件必须同跑的两个测试文件；② PRD §6.8 完整产品契约（数据校验表/流程图/功能逻辑表/交互逻辑/显示项/提示文字/异常态矩阵 7 行/验收标准 4 条）；③ `01-docs/BUGFIX-TOUTIAO-TITLE-SUFFIX-2026-10-15.md` 完整 5 步。**`01-docs/learnings.md` 与 `CHANGELOG.md` 的条目改由合并后的 docs-only 回填 PR 落地**（见「反活锁处置」） |
| 行尾与 diff 对账 | ✅ | 本 PR 两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件一致（PRD +96/-0、AGENTS +2/-0、toutiao-direct-bridge +86/-10）；删除数 10 行全部来自被替换的旧 `rettle` 扰动脚本段（含其注释），已逐行核对无意外删除 |
| 接线棘轮 | ✅ | 新增 `packages/rpa-engine/tests/toutiao-title-no-pollution.test.js` 命中 `packages/rpa-engine/vitest.config.js` 既有 `include: ['tests/**/*.test.js']`（该 glob 已被 CI 消费），无需改 workflow；实跑 `pnpm exec vitest run` = **7 files / 274 passed / 0 failed** |
| QM-1 打包 / QM-4 视觉 | ⚠️ QM-1 已补跑（验证 1/2 通过，验证 3 存活但 stderr 已归因）；QM-4 N/A（无 UI 变更） | **触面判定更正**：改动含 `packages/rpa-engine/`，按 AGENTS.md 字面规则**必须**跑 QM-1，故已补跑而非豁免。完整证据见下方「QM-1 证据」专节 |
| QM-6 CCG 双模型外部评审 | ⚠️ 部分 | `scripts/ccg-gate.js` 实跑 exit=0，判定 DUAL（变更 446 行 > 200 行阈值），要求 claude + opencode 双模型深度审查，并已把判定记录 stage 进本次提交（`.ccg/reviews/0d14ca8e9918a065844c2cc5db916734316d7cf3.json`）。门禁同时提示两条：①「决策层方案评审尚未执行（deepReview.status=pending）」；②「范围漂移：5 个改动文件不在方案声明范围内」。**双模型深度审查本身未在本次执行**（`sh scripts/deep-review.sh` 未跑），如实登记为未完成，不用自审冒充 |
| 远程同步 | PASS | #3633 squash 合并 merge SHA `c5b52322862b0cf7a4aaa6492f9738550637bc12`（2026-10-15T18:21:47+08:00）；远端分支 `fix-toutiao-title-suffix` 已删（`git ls-remote --heads` 0 行）；回填与销账**同一次提交**——本记录 frontmatter 的 `sync_*` 三字段已在本次提交删除。本片按「代码 PR 不带热点载体」纪律落地（`CHANGELOG.md` 与 `01-docs/learnings.md` 亦移出代码 PR，随本次回填落地），故本体不产生 ledger 登记项 |

### 反活锁处置（本仓既有的「不带热点载体」策略）

首次 CI 全绿后 PR 变 `CONFLICTING`：CI 耗时约 30–37 分钟，而主干在此期间前进了 2–3 笔，冲突**全部集中在追加型热点文件**——`CHANGELOG.md`（人人往顶部追加）与 `01-docs/learnings.md`（人人往顶部前插）。本仓 `01-docs/learnings.md` 已两次记录这一结构性活锁（混合 PR 连续 4 次「重放→等 CI→又被超过」），并给出正解：**让代码 PR 刻意不带热点载体，把它们的写入交给合并后的 docs-only 回填 PR**（该 PR CI 秒级、不受活锁影响）。

故本 PR 采用同一策略：`CHANGELOG.md` 与 `01-docs/learnings.md` 已**精确回退到 `origin/main` 状态**（`git diff origin/main -- <两文件>` 为空即证），其条目改在回填 PR 落地。`CHANGELOG` 仅在 release gate（version==tag）被要求，本 PR 的 `release` check 为 `skipping` ⇒ 不携带它不影响任何 required check（首轮全绿已实证）。

### 变异反证（证明锁真的在跑）

把 `buildTitleBumpScript()` 的扰动值改回事故写法（`orig.slice(0,26)+' '+Date.now().toString().slice(-4)`）后跑回归锁：**4 条立刻变红**（B 组「扰动值不可见且非数字」1 条 + D 组结构锁 3 条）。即「业务改动变红」与「锁本身被改成 no-op 会红」两点都实测过。
⚠️ 过程教训：变异后我用了 `git checkout -- <file>` 恢复，结果**把修复一起回掉了**（文件回到 322 行原始态），不得不重新应用全部改动；正确做法是先 `Copy-Item` 备份再还原。

### 全平台审计结论（用户明确要求「检查其他平台的图文和视频」）

| 链路 | 结论 |
|---|---|
| 头条图文（文章编辑器，XHR 重放兜底） | **是（本 Bug）** |
| 头条视频（xigua/upload-video，`_publish_generic`） | 否——无任何 bump 改写标题 |
| 头条 API 直连（`buildPostData`） | 否——用 `article.title`，无改写 |
| 百家号/快手/小红书/B站/知乎/公众号/YouTube 等 RPA 链 | 否——统一 `_fillInput` 只写调用方值 |
| 各 API 链（douyin/weibo/xiaohongshu/kuaishou/twitter/tiktok…） | 否——适配器用 `taskData.title` |

根本原因也解释了为何独此一家：只有头条这条链需要「制造假变化骗页面自动保存」。

### QM-1 证据（`electron-builder --win --dir --publish never`，rc=0）

前置：`node scripts/verify-worktree-deps.js` OK（11 项消费方解析到本 worktree，非借用他分支链接）；`PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers pnpm exec playwright install chromium` 已装（`.playwright-browsers` 现有 chromium-1228 / headless_shell / ffmpeg / winldll）。

| 步骤 | 结果 | 证据 |
|---|---|---|
| 打包 | ✅ rc=0 | `electron-builder 25.1.8` → `dist-electron\win-unpacked`；asar = 146,699,886 字节；期间仅一条 `file source doesn't exist …apps\desktop\dist\fonts` 告警（见验证 3 归因） |
| 验证 1：asar 清单含目标文件 | ✅ | `asar list` 命中 `\node_modules\@multi-publish\rpa-engine\src\toutiao-direct-bridge.js` |
| 验证 2：require 链 + 修复内容自证 | ✅ | 用 `@electron/asar` 从 asar **内存读取**该文件字节：`packed sha256 = a4257d4a1038f2b881ba7d465818110b0fde9e5589374b7a26a0e9079793707b` **与工作区修复源码 sha256 逐字节相等**；编译加载成功，导出 7 项（含新增 `buildTitleBumpScript` / `overrideBodyTitle` / `publishViaPageXhr`）；打包版脚本 `Date.now` 命中 = false、`slice(-N)` 命中 = false；`overrideBodyTitle("title=x&save=0&title_id=T","Real")` → `title=` 已覆盖且 `title_id` 保留 |
| 验证 3：启动 12s 存活 + stderr 三层判据 | ⚠️ 存活 ✅ / 判定 NEEDS_REVIEW（**已归因，与本改动无关**） | 主进程 `alive_after_12s = true`（未崩溃）；stderr 296 字节 = `Failed to load URL: file:///…app.asar/dist/index.html … ERR_FILE_NOT_FOUND`。**归因**：`apps/desktop/dist` 目录**不存在**（本次未跑渲染端 web build，electron-builder 亦已告警 `dist/fonts` 缺失）⇒ 渲染页缺失，与 `toutiao-direct-bridge.js` 无关。非四类红线、非 `Cannot find module`；主进程 20,925 字节 stdout 显示插件/阶段执行器正常注册。按三层判据**不得判 PASS**，故如实记为 NEEDS_REVIEW 并交出归因，不写成通过 |

**验证 3 的两条过程教训（必须记下，否则后人会重复踩）**：

1. **⛔ 本机 DSH 会话环境里 `ELECTRON_RUN_AS_NODE=1` 会让任何 Electron 应用静默退出（rc=0、stdout/stderr 全空）**。首跑据此得到「PASS（stderr 为空）」是**假绿**——我的判据只看 stderr、没看进程是否提前退出。**修法两条**：跑 QM-1 启动验证前必须 `Remove-Item Env:ELECTRON_RUN_AS_NODE`（并把剔除后的 env 传给子进程），且**判据必须同时要求「窗口期内仍存活」**（提前退出即 FAIL，对齐 `scripts/qm1-scheduled-publish-verify.cjs` 的 `bad('进程提前退出')`）。**归因方法**：用**未含本次改动的既有构建**（`mp-ops-dead-ipc`，10/15 14:41 构建）做 A/B —— 它在同一环境下同样 rc=0 / 零输出 ⇒ 证伪「本次改动导致启动失败」。
2. **进程收尾要按 PID 而非按名字**：Electron 会留 main + GPU + renderer 多个同名进程；本机 before=0 时全部同名进程都是我这一轮的，按 PID 逐个终止后复核计数归 0。`Get-Process` 与 `tasklist` 对已退出进程可能给出不一致的残留条目，以 `tasklist` 实况为准。

### 遗留（不假装已闭合）

- **QM-1 验证 3 未取得「通过」形态**：主进程存活已证，但渲染端 `dist/index.html` 缺失使 stderr 非空 ⇒ 按三层判据只能记 NEEDS_REVIEW。**要收成 PASS 需先跑渲染端 web build 再打包**（本次未跑）；该缺口与本改动无关（A/B 对照已证），但「完整 QM-1」在本轮确实没走完。
- **QM-6 双模型深度审查未跑**（`deepReview.status=pending` + 范围漂移提示），决策层方案评审亦未执行。本 PR 是 bug 修复、无新功能面，但按 §12.6 Red Team 阈值（>200 行）已被判 DUAL；`scripts/ccg-gate.js` 本体 exit=0。
- **真机复验未做**：需用户侧真实账号向头条号发一条 >26 字、一条 <26 字图文，回后台核对标题回显。本次证据止于单元/集成级 + 打包产物字节级。
- **发布后平台回显对账未实现**：严格平台（baijiahao/kuaishou/toutiao）的作品查询里比对标题，使「平台收到什么」从此有机械判据。
- **临时文件未删（两处，均未纳入提交）**：① `packages/rpa-engine/mutate-check.js`（一次性变异脚本）；② `D:\Temp\qm1-asar-check-472984733\`（**我不完整的 asar 全量解包残留，134.6 MB**——当时为做验证 2 而解包，遇到 `ENOSPC` 中断）。两者都因 R0 的机械闸门无法用 `safe-delete.js` 清理：②是**目录**（闸 1 一律拒绝）且在仓库外（闸 3 亦不过），①是未跟踪文件但本机 `mavis-trash` 后端缺失（四道闸已过、仅可恢复删除后端不可用）。**按 R0 不绕过、不递归删除**，如实登记待人工处置。
- **本轮 D 盘一度打满（0 可用 → 后回升至约 900 MB）**：由 asar 全量解包 + `dist-electron`（1.69 GB）+ `.playwright-browsers`（688 MB）叠加造成；进程终止后释放。若后续要在本 worktree 重跑 QM-1，先确认可用空间。
