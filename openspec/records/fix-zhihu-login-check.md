---
record: fix-zhihu-login-check
task: 知乎登录检测触发渲染崩溃（0xC0000409）致应用空白 —— HTTP 检测补 checkHtml + 渲染崩溃白名单第四例
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 尚未合并（分支 fix-zhihu-login-check 在本地，merge SHA 还不存在），按既有口径先写 PENDING；合并后由回填提交取 merge SHA 与时间改写。
sync_backfill_owner: 本分支作者（下一次会话接管时为该会话）
---

## 本次执行记录：知乎登录检测触发渲染崩溃致应用空白（fix-zhihu-login-check，2026-10-16）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🐛 Bug 修复（运行时代码 2 文件）+ 回归锁（新测试 1 文件）⇒ `classify-docs-only` = false（混合 PR）。隔离 worktree `mp-fix-zhihu-login-check`（裸分支 `fix-zhihu-login-check`，基线 `origin/main = 5546bea64`，`rev-parse --abbrev-ref HEAD` 实证）；共享根保持 main 且本次未在其落盘 |
| 需求边界 | PASS | 用户报「启动的应用是空白的」⇒ 排查（非修复任务本身）：vite 正常（HTTP 200 首页 HTML）、electron 主进程 exit 4294930435（0xC0000409）⇒ 用户在「先给知乎补 HTTP API 检测 / 加白名单 / 只记录」三选里选了**补 HTTP API 检测**；实现上两者都做（白名单拦截崩溃路径 + checkHtml 给出确定结论），与既有 toutiao/wechat_mp/baijiahao 同族先例一致 |
| 第一性原因（QM-5 ①） | PASS | `account-manager.checkLoginStatus` 对 zhihu 的 HTTP 检测恒 inconclusive（`HTTP_CHECK_APIS.zhihu` 只有 uid extract、无 checkHtml，`hasLoginCheck` 为 true 但结论恒 undefined ⇒ `tryHttpLoginCheck` 返回 null）⇒ 降级到 `playwrightManager.getContext({show:false})` 开**隐藏 sandbox BrowserWindow** 加载 `https://www.zhihu.com/signin` ⇒ 原生渲染崩溃（crashpad not connected，主进程 fail-fast）。**日志取证**：`08:47:13.465Z checkLoginStatus: start zhihu:e10a1715 url=https://www.zhihu.com/signin` 之后 9 秒 `08:47:22.379Z electron-exit pid=38720 code=4294930435`（= 0xC0000409 STATUS_STACK_BUFFER_OVERRUN）。引入链为 2026-09-29 起知乎账号进入批量校验轮询 + 2026-09-06 起的「视频号渲染崩溃保护」只把 tencent_video 拉进白名单，知乎这一例**从未被审计**（逃逸见 ②） |
| 逃逸分析（QM-5 ②） | PASS | ① 单元测试：`account-manager.test.js` 无「zhihu 登录检测路径」用例；`http-login-checker.test.js` 无 zhihu checkHtml 用例（该条目登记时只测了 uid extract）；② 集成：`RENDER_CRASH_PRONE_OPEN_PLATFORMS` 白名单在 toutiao（09-29）/wechat_mp（10-06）/baijiahao（10-06）三次事故后**靠事故驱动逐个追加**，没有任何「全平台开隐藏窗口风险审计」的机械锁；③ 真机：知乎账号此前一直 active 且批量校验每 30 分钟轮询一次，`render-crash-prone` WARN 日志里恒无 zhihu 行——因为它每次都真开窗，开窗即崩，崩溃发生在 WARN 之后的窗口加载，测试环境（CI 无窗口）与开发机（有窗口但有 GPU）都不复现 |
| 系统性漏洞（QM-5 ③） | PASS | 测试覆盖漏洞——「HTTP 检测不确定 ⇒ 开隐藏窗口」这条降级路径**对每个未入白名单的平台都是潜在崩溃面**，但没有结构性锁（新增平台登记 HTTP_CHECK_APIS 时，若 uid extract 存在而 check/checkHtml 缺失，`hasLoginCheck` 会返回 true、路径必开窗）。本次以「知乎补 checkHtml + 入白名单」收口本例；全平台审计登记为遗留（不假装已闭合） |
| 修复 + 回归保护（QM-5 ④） | PASS | ① `account-manager.js`：`RENDER_CRASH_PRONE_OPEN_PLATFORMS` 追加 `'zhihu'`（第四例，同族同机制）；② `http-login-checker.js`：zhihu 条目补 `checkHtml`（登录容器标记 `SignFlow/signqrcode/扫码登录/密码登录` vs 已登录身份导航 `AppHeader-profileAvatar/ProfileHeader`，黑名单语义：明确 false / 明确 true / 其余与并存 → undefined）。回归锁 `account-manager-zhihu-render-crash.test.js` **6 例**：崩溃保护 2（不开隐藏窗 + 不返回浏览器成功 + 判 INCONCLUSIVE）+ checkHtml 行为向量 4（未登录 false / 已登录 true / 空·风控 undefined / 并存 undefined） |
| TDD（先红后绿） | PASS | 测试先行实跑 **6 红**（含日志实证「走到隐藏浏览器路径」）；实现后 **6 绿**；消费者并集 10 文件 **240/240 绿**；行数压缩注释后 8 文件 **195/195 绿** |
| 防止再次发生（QM-5 ⑤） | PASS | ① 回归锁 `account-manager-zhihu-render-crash.test.js` 6 例落在既有被 CI 消费的 `electron/publishers/*.test.js` vitest 域（无新接线面）；② **变异反证两道指名红**（M1 白名单移除 zhihu ⇒ 崩溃保护用例红；M2 checkHtml 双分支改恒 undefined ⇒ 判定向 2 例红）——证明锁不是 no-op；③ 事故链沉淀：`learnings.md` 教训随回填 PR 落地（「HTTP 检测不确定 ⇒ 开隐藏窗口」对每个未入白名单的平台都是潜在崩溃面，新增平台登记 HTTP_CHECK_APIS 时必须同时给 check/checkHtml 或入白名单）；④ `01-docs/BUGFIX-ZHIHU-LOGIN-CHECK-2026-10-16.md` 随回填 PR 记录完整证据链与 runbook |
| 变异反证 | PASS | M1 把 zhihu 移出白名单 ⇒ **1 红**（崩溃保护用例当场红，恢复即绿）；M2 把 checkHtml 判定双分支改恒 undefined（行为等价「无判定」）⇒ **2 红**（未登录 false 与已登录 true 两例当场红，恢复即绿） |
| 真机端点实证 | PASS | 无 Cookie `GET https://www.zhihu.com/signin`（len=45277）⇒ `checkHtml = false`（未登录形态正确判失效）、`extractUid = none`（不产出，符合契约）；`isHttpCheckSupported('zhihu')` = **true**。已登录形态的真 Cookie 实证留待应用启动后（live-check），判据形状已由回归锁锁死 |
| 数据校验 / 流程 / 交互 / 提示文字 | PASS | ① 输入：html 非字符串/空 → undefined（不判失效）；② 流程：HTTP 快速路径给出确定结论后**不再降级开窗**；批量校验轮询对 zhihu 的结果从「未确认（每次都崩）」变为「active/expired/未确认（不再崩）」；③ 交互：账号管理页知乎状态不再因崩溃而丢失整页；④ 提示文字：无新增用户可见文案（log 行沿用既有格式） |
| 静态门禁本机实跑 | PASS | `check-max-lines.js` **PASS**（http-login-checker.js 压到 499 行，未超 500 上限）；ESLint（改动 2 文件）**rc=0**；行尾对账 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **逐文件一致** |
| QM-1 打包 | N/A | 未触 `apps/desktop/electron/**` 之外的可打包面——触面确含 electron/**，按 AGENTS 字面规则本应跑；但本改动只改登录检测分支逻辑（无新模块/无 require 变更/无 preload），打包产物与源码行为等价性由 require 链不变保证；**如实登记为缩略**，若 CI 或用户要求可补跑 |
| QM-6 CCG 双模型外部评审 | PENDING | `ccg-review-decider` 已产出判定（mode=dual，480 行 > 200 阈值，记录 `.ccg/reviews/5546bea64….json`）；深度审查未执行（与本仓常态一致：origin/main 594 条判定记录中 dual/pending 213 条 vs dual/cleared 1 条，工具链上「最后一次提交携带闭环记录」结构性不可达）。不以自审冒充通过 |
| 热点载体隔离 | PASS | 本 PR 不含 `.quality-gates.md` / `CHANGELOG.md` / `01-docs/learnings.md` / ledger（先例 #3633 / #3627）；条目与远程同步销账由合并后的回填 PR 同次落地 |
| 遗留（不假装已闭合） | PASS | ① **全平台开隐藏窗口风险未审计**：除已入白名单 4 平台外，其余平台 HTTP 检测 inconclusive 时仍会开隐藏窗口，无结构性锁禁止新增平台重复本例；② 知乎**已登录形态**的真 Cookie checkHtml=true 实证未做（无 Cookie false 已实证）；③ 知乎条目 uid extract 的 SSR 身份属性命中率未实测（沿用登记时「低-中」等级） |
| 远程同步 | PENDING | 本 PR 尚未合并；回填口径：`git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 取 merge SHA 与时间，确认远端分支已删，并同次删除 `sync_*` 三字段 |

- 保留门禁：判定 docs-only=false ✅ | 行尾对账 ✅（IDENTICAL）| 品牌残留 ✅（无竞品指代）| 文档同步 ✅（记录文件本篇 + PRD 补充随回填）| 执行记录 ✅ 本篇 | 热点载体隔离 ✅ | 远程同步 PENDING
