---
record: fix-risk-hold-false-positive
task: 风控挂起误判修复——结构化信号优先 + 词表加边界并分强弱 + 挂起粒度收敛 + 横幅显示项
date: 2026-10-13
sync_reason: 本 PR 尚未合并，无法取证 merge SHA；合并后由后续 docs 回填 PR 把「远程同步」行由 PENDING 改写为 PASS + merge SHA，并删除本三字段
sync_backfill_owner: fix-risk-hold-false-positive 会话（或后续 docs 回填 PR）
---

## 本次执行记录：风控挂起误判修复（fix-risk-hold-false-positive，2026-10-13）【混合 PR】

- **变更类型**：运行时代码（`packages/api-publish-engine/**`、`packages/shared-utils/**`、`apps/desktop/electron/**`、`apps/desktop/src/**`）+ 文档 ⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-risk-hold-false-positive`（D 盘，非 C 盘），裸分支 `fix-risk-hold-false-positive`（基线 `origin/main`）。
- **本 PR 不是 docs-only**：含运行时代码，`classify-docs-only.js` → false ⇒ 完整质量节拍。
- **共享根保持 main clean**：任务全程只在 worktree 落盘；`pre-code-edit-guard.ps1` exit 0；写保护 `Session Isolation Write Guard` = Running。
- **受管行数文件**：本次初版改动把 `apps/desktop/electron/services/publisher-router.js` 顶破台账容差被 `check-max-lines.js` 判红（`LEDGER_GREW … 629 膨胀 209 行（容差 200）`）。处置：把 `attachRiskSignals` 从该文件移回风控模块 `publish-risk.js`（同时更内聚），该文件改动从 33 行降到 14 行，复跑 PASS。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-fix-risk-hold-false-positive`（D 盘）+ 裸分支 `fix-risk-hold-false-positive`；`verify-worktree-deps.js` OK（11 消费方 / 9 workspace 包解析到本 worktree）；`pre-code-edit-guard.ps1` exit 0 |
| 第一性原因（QM-5 ①） | PASS | ①读码：`api-publish-engine/src/index.js` 的 `publishViaApi` 与 `publisher-router.js` 三个发布器一律 `throw new Error(result.error)`，把适配器**已算出**的 `risk_blocked` 标志与风控码族（`BILI_RISK_601`/`10000015`/`-1e7`）丢在半路 ⇒ 上层只剩「拿错误文本猜关键词」这一条路；②读码：两处 `RISK_RE` 均为**无边界裸子串**（`601`/`10000015`/`risk`/`frequent`/`verify`/`验证`），且桌面与引擎两份已漂移（桌面多 `安全验证|操作频繁|captcha`，注释仍写「保持同义」）；③放大器：`accountId` 缺失时 `risk-suspender` 键退化为 `platform::*` = 平台级，覆盖该平台**所有**账号 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链四层：**单元层**——`publish-risk.test.js` 只有 4 例且全部是「命中/未命中」的宽样例，**没有任何边界样例**（`1601`/`6019`/`100000159`/`infrequent` 从未被测）；**集成层**——`phase4-events.test.js` 的 5 个风控用例里 4 个用 `触发风控` 这类必然强命中的文案，**唯一那条「非命中」用的是 `平台 Cookie 缺失（账号未登录）`**（不含任何词表词），等于没测「含词表词但非风控」的中间地带；**跨包层**——`task-queue` 丢结构化字段这件事**没有任何测试断言 task 上该有 `code`**，而 phase4 的用例是**直接往 task 塞字段**的（搬运缺失时它照样全绿，典型假绿形状）；**审查层**——两份 `RISK_RE` 的注释都写「与桌面侧保持同义」，审查时读注释即通过，无人比对两份正文 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增单一真源 `risk-signals.js`（结构化优先 + 强弱分档 + 边界）；打通 `Error → task` 信号搬运（引擎 `publishViaApi` + 桌面 `attachRiskSignals` + `task-queue`）；桌面/引擎挂起点加强弱闸门与账号兜底；挂起记录携带 `signal`/`strength`；横幅新增 4 个显示项。新增/扩展 8 个测试文件：`risk-signals.test.js`(45) + `publish-risk.test.js`(15) + `phase4-events.test.js`(46，新增 11) + `task-queue.test.js`(37，新增 3) + `risk-suspender.test.js`(引擎，新增 1) + `risk-suspender-store.test.js`(18，新增 2) + `risk-suspended-tracker.test.js`(新增 1) + `RiskSuspendedBanner.source.test.js`(8) |
| 防止再次发生（QM-5 ⑤） | PASS | ①**不变量进单一真源**：`suspends ⇔ (hit && strength==='strong')` 由 `risk-signals` 给出，调用方不得自行推导（有恒等式测试锁）；②**误判面清单进仓库**：附录 A 的 7 类文案成为常驻回归锁（`FALSE_POSITIVES` 数组），任何未来加词都要过这 7 条；③**跨包搬运有独立锁**：task-queue 断言 `errorCode`/`riskBlocked` 落到 task（并做过变异反证）；④**旧记录不伪造依据**：无 `strength` 时 UI 不渲染依据项，且有测试锁；⑤新能力规格 `openspec/changes/.../specs/risk-hold-guard/spec.md` 把「什么信号可挂起、挂到什么粒度」写成可验收契约 |
| 行尾与 diff 对账 | PASS | 本 PR 触及的 17 个既有文件工作副本统一规范为 LF（UTF-8 无 BOM），`git ls-files --eol` 复核 `w/lf`；`check-text-encoding-integrity.js` PASS（无新增 U+FFFD） |
| 新增文件行数门禁 | PASS | `node .github/scripts/check-max-lines.js` → `✅ 无新增超大文件，挂账清单与现实一致`（初版曾判红，见上「受管行数文件」） |
| ESLint | PASS | `cd apps/desktop && pnpm run lint`（`eslint electron/ src/ --quiet`）**exit 0** |
| 相关域测试 | PASS | 引擎全量 `node scripts/run-tests.js` → **391 passed / 40 files**（含新增 `risk-signals` 45 例 + 审查修复 13 例，较首次提交的 379 增 12）+ direct 组全通过；`shared-utils` 全量 → **849 passed / 10 skipped / 41 files**（较 844 增 5）；桌面 6 个受影响文件 → **173 passed**（较 171 增 2） |
| **CI 抓到的缺陷（本地子集漏网）** | 已修 | 首轮 CI `QG Desktop Shards (1/2)` 红：`observability-messagekey.test.js` 报 **`不在允许清单: RiskSuspender:weak-signal-not-suspended`** 与 **`未在清单登记: …`**。真因：本 PR 在 `phase4-events.js` 新增了 `log.notify('RiskSuspender', 'weak-signal-not-suspended', …)`，而 messageKey 允许清单（`observability-messagekey.test.js` 内联 `Set`，且断言「全仓登记键总数 === 四文件 notify 调用总数」）必须同步登记。**教训（已写入 learnings）**：本轮我为提速只跑了「受影响文件子集」，而这条锁属于**跨文件登记契约**（改 A 文件、锁在 B 文件），子集跑法对它天然免疫。改 `log.notify` 类调用后必须跑全量或至少含 `observability-messagekey` 的文件集 |
| **顺带发现并修复：两处「定时炸弹式」主干缺陷** | PASS | CI 另报 `quick-collect.test.js`（2 例）与 `quick-collect-cn-sources.test.js`（1 例）红。取证结论：**与本次改动零文件交集，属主干既有缺陷**，且是同一族**硬编码日历日期 + 真实时钟**的定时炸弹：①`quick-collect.test.js:14` `NOW = Date.parse('2026-10-11T04:00:00.000Z')`，引擎窗口判据为 `mergeMaterials(items, { windowHours, now: Date.now() })`（保留 `created_utc >= 真实now - 48h`），fixture 素材时间 `NOW-1h = 2026-10-11T03:00Z` ⇒ **在真实时刻 2026-10-13T03:00:00Z 越窗**；主干最后一次绿运行是 `2026-10-12T21:41Z`，本 PR 首轮 CI 起于 `2026-10-13T03:13Z` —— 时间线完全吻合，即**这是一条到期后挡住所有 PR 的地雷**；②`quick-collect-cn-sources.test.js:14` 同因（S2 用例走真实时钟），另有 RSS fixture 里 `pubDate>Sun, 11 Oct 2026 02:00:00 +0000`（越窗时刻 `2026-10-13T02:00:00Z`）。修法：`NOW` 改 `Date.now()`（素材恒为 1–2 小时前）、RSS `pubDate` 动态生成（2 小时前，RFC 822 格式），两处均保留原用例意图。**范围说明**：这 3 例不在本 PR 功能范围内，但它们是**阻断全部 PR 的 CI 地雷**，故随本 PR 一并修复并在 PR 正文显著标注，供人工复核。另：全仓扫描 47 处「硬编码 2026-10 日期」，逐一核对后确认其余均为**时钟注入型**（`now`/`nowMs` 显式传入被测函数，内部自洽），无同族风险 |
| 变异反证 | PASS | `task-queue` 的两个赋值改成 no-op ⇒ `Tests 2 failed \| 35 passed (37)`（新增 3 例中 2 例立红，其中 1 例因默认值恰好相等未红属预期）；按字节还原后 ⇒ `Tests 37 passed (37)`。**反证的是锁本身**（把实现改成 no-op 必须立红），不是只证「业务改动变红」 |
| locale 成对 / 键存在 / CJK 基线（Gate 7） | PASS | `check-locale-sync.js --keys` → 2013 个使用中 key 均存在；`--cjk` → 基线 1374 / 当前 1224 无新增硬编码；`--pair-base origin/main` → PASS（`publish/zh.js` 与 `publish/en.js` 成对变更 5 个新 key） |
| 前端一致性 / 样式 / 颜色 / 字号 | PASS | `check-color-literals.js`（129/129）· `check-css-var-defined.js`（0/64）· `check-vue-style-parse.js`（216 vue）· `check-scoped-root.js`（163 scoped）· `check-font-size-scale.js`（35/790）全部 PASS |
| 品牌残留 / 规格 Purpose / CHANGELOG | PASS | `check-no-brand-residue.js`（8499 tracked 文件）PASS；`check-spec-purpose.js`（153 主规格）违规 0；`check-changelog-growth.js` PASS |
| openspec 校验 | PASS | `openspec validate fix-risk-hold-false-positive` → `Change 'fix-risk-hold-false-positive' is valid` |
| QM-1 打包 | PASS | `cd apps/desktop && pnpm run build:win` → **rc=0**（renderer built in 21.14s；`dist-electron\Multi-Publish.Setup.0.2.0.exe` 生成）。产物验证：asar 清单含 `\node_modules\@multi-publish\api-publish-engine\src\publish\core\risk-signals.js`（新模块）、`publish-mode-runner.js`、`risk-suspender.js`、`\electron\services\publish-risk.js`、`risk-suspender-store.js`；**从解包产物实跑判定**：`classifyRisk({error:'Request failed with status code 601'}).suspends === false`、`classifyRisk({error:'B站风控(601)：请完成滑块验证'}).strength === 'strong'` ⇒ 修复确实进了交付产物 |
| QM-4 视觉 | N/A（受限项） | `RiskSuspendedBanner.vue` 有模板 + scoped 样式改动，但**横幅只在存在挂起记录时渲染**，本机无可用风控会话 ⇒ 无法在真实应用里截到该横幅。已改用源级契约测试（8 例）锁显示项接线；未录视觉基线，如实记为受限项 |
| QM-6 CCG 双模型外部评审 | PASS（附 1 条高风险域外部复核待办） | **已执行**：`sh scripts/deep-review.sh` → 判定 `DUAL`（变更 1047 行 > 200 行阈值），跨家族校验 `proposer=opencode critic=claude` 通过；轮 1 claude 评审出 **7 条问题 / 4 维度 / 最低分 6**；进入自扮演裁决（引擎第三档出口，置信权重 0.6），4 条争议已由本会话**逐条填写指控/辩护/裁决**（`.adversarial/ccg-deep-4d8cc19b/adjudication.json`，`critiqueFingerprint=c612aa01847f6edd`）。**四条全部 upheld**，已在 `eb8a157e6` 逐条修复并补锁（引擎 +12 例 / shared-utils +2 例 / 桌面 +2 例）。⚠️ 其中 **i4 属 auth 高危域，按工具规则不允许自扮演豁免**：本轮仅按「单一真源 + 补齐管线」这两条可机械验证的判据落地，**认证协议语义级外部复核仍待办**，如实标注。另记环境坑：`deep-review.sh` 的驱动搜索第 3 顺位 `$HOME/.claude/...` 在 Git Bash 下被 MSYS 拼成 `D:\c\Users\...`（`Cannot find module`）；正解是设 `CCG_ARL_DIR` 为 **Windows 原生路径**（第 2 顺位优先），无需改脚本。 |
| QM-6 审查发现的修复 | PASS | **i1** 强档英文词缺标识符边界（`captcha` ⊂ `recaptcha`/`hcaptcha`，浏览器自动化常见报错 ⇒ 会冻结账号，**正是本次要消灭的裸子串误判同类**）→ 给 `captcha`/`canvas illegal`/`risk control` 加边界；**i2** 字符串码漏判（`RISK_CODES` 里 601 是 number，`has('601')` 判不中 ⇒ 真风控漏判，且与本文档「两形态都收」自相矛盾）→ 抽 `isRiskCode` 认双形态；**i3** 引擎 `outcomeOfResult` 另持私有码表（缺裸 601 与 `RISK_BLOCKED`）⇒ `code:601 + 普通文本` 在引擎轨降级 DOM、桌面轨却挂起，两侧分裂 → 路由与挂起共用同一份 `classifyRisk`；**i4** `attachRiskSignals` 双实现内容不同（引擎只认 `loginExpired`）+ `loginExpired` 到 task 即断（半程假完备）→ 收敛到 `risk-signals.js` 单一实现并补齐 `task.loginExpired` |
| 远程同步 | PENDING | 见下方回填说明 |

### 真机边界（不假装已闭合）

本机**无可用公众号/抖音等真实风控触发会话**，「真实风控命中 → 挂起 → 横幅 → 人工恢复」的**端到端真机回归未做**。本次验收边界为单元 + 集成层，外加「从打包产物实跑判定」这一条靠近交付端的证据。横幅的视觉呈现（4 个显示项实际排版）同样未在真机截到，仅由源级契约锁保证接线存在。

### 已知遗留（本 PR 刻意未修）

- `publisher-router.js` 后端轨失败回退文案是编码损坏串（`'鍙戝竷澶辫触'`，GBK 误读形态）。本次**刻意未顺手修**（属另一议题，避免无关 churn）；同一文件另有大量同类乱码注释，应另开一次性编码治理。
- 弱信号目前只进结构化日志（`RiskSuspender.weak-signal-not-suspended`），设置页/诊断页**无可视化入口**：「为什么这次没暂停」需查日志。
- `check-max-lines.js` 台账里 `publisher-router.js` 已用到 818/829，**仅剩 11 行余量**；后续对该文件的任何增量都应先考虑拆分。

### 远程同步回填说明

本 PR 合并后由后续 docs 回填 PR 完成：`.quality-gates.md` 与本文的「远程同步」行由 `PENDING` 改写为 `PASS` + merge SHA，并在**同一次提交**内删除 `scripts/gate-record-debt-ledger.json` 中按本记录标题登记的条目。
