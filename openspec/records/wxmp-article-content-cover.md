---
record: wxmp-article-content-cover
task: 微信公众号图文发布的正文与封面完整性（多通道注入 + 回读 fail-closed、封面上传与生效判据）+ 发布历史真实封面缩略图
date: 2026-10-12
---

## 本次执行记录：微信公众号图文正文/封面完整性 + 历史记录真实封面缩略图（wxmp-article-content-cover，2026-10-12）【混合 PR】

- **变更类型**：运行时代码（`apps/desktop/electron/**` + `apps/desktop/src/**` + locales）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-wxmp-article-content-cover`（标准入口 `scripts/start-mp-task.ps1 -TaskName wxmp-article-content-cover` 创建，非 C 盘），裸分支 `wxmp-article-content-cover`（基线 `origin/main` = `19d9a0aea`）。
- **本 PR 不是 docs-only**：含运行时代码与 locales，`classify-docs-only.js` → false。
- **共享根保持 main、零写保护违规**（全程只在 worktree 落盘）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-wxmp-article-content-cover`（D 盘）+ 裸分支 `wxmp-article-content-cover`；`verify-worktree-deps.js` OK（11 项消费方解析到本 worktree） |
| 第一性原因（QM-5 ①） | PASS | 三处读码取证：①`_publish_wechat_mp` 全函数 `grep -c cover` = 0（对照 `_publish_generic` L354 封面段）；②正文走 `_setElementContentSafe` 默认 `innerHTML` 分支（`rpa-view-helpers.js` L93-122）且无回读；③`IMAGE_TEXT_PLATFORMS`（`usePublishFlow.js` L63）不含 `wechat_mp` 且自动封面只写 `images`（L466-467）；④`phase4-events.js` 两个 `addRecord` 一个封面键都没写、`PublishHistory.vue` 读侧表达式恒空 ⇒ 回退平台图标 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链四层：**单元层**——自动封面分支在此前**零测试覆盖**（`usePublishFlow.test.js` 的 `@/api/publisher` mock 根本没提供 `generateAiCover`，调用抛 TypeError 被 `try/catch` 静默吞掉）；**集成层**——公众号平台分支无封面用例（既有 6 条用例 article 均为 `{}`）；**E2E 层**——平台 DOM 自动化断言不了落地页内容，草稿箱核对需人工；**审查层**——第 ④ 层「历史记录封面字段」的两侧（写/读）分属不同文件，各自看都自洽 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 3 模块（`wechat-mp-article.js` / `wechat-mp-cover.js` / `publish-record-cover.js`）+ 1 composable（`useHistoryCoverThumbnails.js`）；新增/扩写 6 个测试文件 **59 条新用例**；外部取证（第三方公众号自动化项目一致用法）纠正了首版封面上传判据（原按 `img` 数判会**恒失败**，因为新版封面预览是 `background-image` 的 div） |
| 防止再次发生（QM-5 ⑤） | PASS | ①自动封面加**双通道**落值断言（漏一侧即红）；②正文/封面各自独立 fail-closed（不许「传了但没生效」记 success）；③封面生效判据显式锁 `preview-bg` 分支（防退回「只看 img 数」）；④`PRD-WECHAT-MP-ARTICLE-PUBLISH-2026-10-12.md` §3.4/§4 写明两条 ⛔ 反例 |
| 行尾与 diff 对账 | PASS | 见下方「行尾对账」小节 |
| 接线棘轮 | PASS | `node scripts/check-unwired-tests.js` → 域内 73 个测试文件「全部测试均已接线或按欠账登记」 |
| 新增文件行数门禁 | PASS | `node .github/scripts/check-max-lines.js` → 「无新增超大文件，挂账清单与现实一致」（首版单文件 585 行 ≥500 被 `NEW_OVER_LIMIT` 拦红 ⇒ 按域拆为 `wechat-mp-article.js` / `wechat-mp-cover.js`，并顺带把 `rpa-view-platforms.js`（点名还账、零增长容差）的接线压到两行、`PublishHistory.vue` 改为单点接线后**负增长**） |
| ESLint（Gate 11） | PASS | `pnpm run lint` 0 error（首轮 5 处 `no-useless-assignment` 已按「去掉无用初值/改 IIFE」修正） |
| 静态门禁组合 | PASS | brand residue / locale-sync（`--cjk` 无新增、`--keys` 1891 key 全存在、`--py-cjk` 无新增）/ spec-purpose / blanket-fs-mock / frontend-consistency / vue-style-parse / color-literals / css-var-defined / font-size-scale / scoped-root / ipc-sender-guard / coverage-include-sfc / route-registry / ipc-bridge / hardcoded-secrets / test-microtask-spin **全 PASS** |
| 相关域测试 | PASS | 7 文件 **256 passed / 0 failed**（含新 59 条）；全量 desktop 套件见下 |
| 变异反证（QM） | PASS | **6/6 全部变红**（M1 摘封面 fail-closed → 对应用例红；M2 摘正文回读判据 → 红；M3 自动封面退回只落 `images` → 红；M4 封面判据退回只看 img 数 → 红；M5 `resolveRecordCover` 恒空 → 红；M6 历史缩略图不解析本地封面 → 红） |
| QM-1 打包 | N/A | 未改 `package.json` 的 `files` / 未新增被 require 的顶层依赖；改动集中在已被 asar 覆盖的 `electron/services`、`electron/bootstrap` 与 `src`。CI 打包 job 为准 |
| QM-4 视觉 | PASS（预期） | `PublishHistory.vue` 模板断言未改，仅缩略图 `<img src>` 的取值来源变化；无 CSS 改动（`vue-style-parse` / `scoped-root` / `color-literals` / `font-size-scale` 全 PASS）。CI QG Visual 为准 |
| QM-6 CCG 双模型外部评审 | 部分 | 已用一次**外部只读取证**（第三方公众号自动化项目一致用法）替代「凭记忆编选择器」，并据其纠正首版封面上传判据的**真实性缺陷**；正式 CCG 双模型评审未在本轮执行，如实记录 |
| 远程同步 | PASS | PR #3364 已 squash 合并，merge SHA `404978089db7150deb33348b73a7e6dbd394e659`（committer 2026-10-12T04:02:30+08:00）；取证 `git log origin/main --grep='(#3364)$' --format=%H|%cI` **唯一 1 行**命中；`git ls-remote --heads origin wxmp-article-content-cover` 返回 **0 行**，证远端分支已删；`sync_*` 三字段与 `scripts/gate-record-debt-ledger.json` 的本条登记已在同一次回填提交中删除 |

### 行尾对账

- `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径在本 PR 变更集上一致（新增文件为 LF，仓库 `core.autocrlf` 的告警属既有常态，不改动既有文件的既有行尾）。
- 新增/修改文档均为 LF 与 UTF-8 无 BOM；`node scripts/check-text-encoding-integrity.js` PASS（无新增损坏）。

### 遗留（不假装已闭合）

1. **真机验证 PENDING**：本机无可用公众号账号会话，因此「导出 `appmsg_edit_v2` 真实 DOM 核对选择器」「真机发一条图文核对草稿标题+正文+封面三项齐全」「历史页核对缩略图 = 该次发布使用的封面」三项未完成。`tasks.md` §7 保留该门槛，**未完成前不得声称端到端已通**。
2. **选择器是候选表而非定论**：封面入口/菜单/弹层与正文编辑器选择器取自第三方项目的一致用法（本会话 `web_fetch` 被 SSRF 守卫拒绝、`web_search` 无密钥，未能取得一手 DOM）。所有候选都在返回值与日志里带「命中了哪个」，一次真机失败即可定位到选择器层。
3. **公众号远程封面 URL**：DOM 轨无法把网络地址注入 `input[type=file]`，本期按 fail-closed 明确报错（「需为本地图片文件」）。若要支持，需新增「下载远程封面到临时文件再注入」的一环，属下一刀。
4. **`pre-commit` 的行尾规范化**会在下次 git 触碰时把新增文本文件转 CRLF（`warning: LF will be replaced by CRLF`）。本次未改动既有文件的既有行尾，实际 blob 行尾以 `git ls-files --eol` 为准。
5. **未改 `01-docs/PRD.md` 头部的「功能文档」索引**（原计划改，实测后撤回）：该文件含 **4 处既有**失效本机绝对路径（`D:\Data\mp-extracted` @ L7269 / L7346 / L16039 / L16116）。Gate 12c `check-doc-abs-paths` 的口径是 `git diff --name-only base..head` **整文件扫描**（不是只看新增行），因此**只要本 PR 触碰该文件就会连带判红**；而该门禁自述的修法是「它不该出现在本次改动里——考虑撤掉这次文档改动」（注释原文：全量扫描会命中 100+ 处历史引用，「那些不是缺陷，逐条『修好』等于篡改历史」）。故本期改为：新增专项 PRD + 在 `CHANGELOG.md` / 本记录 / `.quality-gates.md` 中挂链，**不动聚合索引**。下次要把专项 PRD 挂进 `01-docs/PRD.md` 索引时，必须同 PR 一并处理那 4 处历史路径（或把它们移入归档豁免），这是该门禁的已知耦合。
6. **本分支经历 3 轮 rebase（并发 backfill 反复撞车）**：`origin/main` 的并发 backfill PR 会同时改 `.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json`，CHANGELOG 又被每个运行时修复 PR 顶部追加 —— 实测 40 分钟 CI 窗口内 main 前进 1–3 个提交。处置：追加型文件一律**取并集**（不后推覆盖），并把本 PR 的两处新增**放在非末尾的稳定位置**（ledger 键插在已冻结的 2026-08-13 条目之后、CHANGELOG 块置于第二个块），使后续顶部/末尾追加可被三方自动合并。
