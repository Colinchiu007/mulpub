---
record: account-login-ux
task: 登录态提示可执行化（reason→用户可执行提示）+ 能力级授权（登录态×能力二维）+ DOM 判定进程隔离（子进程崩溃不回传主进程）
date: 2026-10-17
# ↓ 三字段只在「远程同步」无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（account-login-ux）尚未合并，merge SHA 尚不存在，无法取证收口
sync_backfill_owner: 下一个会话（同一次提交内改表格行 + 删这三个字段）
---

## 本次执行记录：登录态提示可执行化 + 能力级授权 + DOM 判定进程隔离（account-login-ux，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | 新增 3 个主进程模块 + 3 个测试文件；改 `account-manager.js`（判定链纯净化 + 两个只读包装器 + 隔离 seam）、`ipc-handlers/account.js`（hint/capabilities 显式挂载）、`src/views/Accounts.vue`（单账号提示 + 批量后续操作建议）、locales zh/en 成对、CHANGELOG、PRD §19。隔离 worktree `D:\Data\projects\mp-worktrees\mp-account-login-ux`（**D 盘**）+ 裸分支 `account-login-ux`；共享根全程零 git 写（`main`、脏项 0） |
| 第一性原因（QM-5 ①） | ✅ | 三件事同一根：**判定有了、解释没有、收场没有**。① 主进程带 9 种 `reason` 却只透传 `code`，未确认时用户看到「未取到定论」，不知道该重试还是该重登（参考产品B 把错误码翻成「授权失效,请重新授权」）；② 账号模型一维，回答不了"能读数据/能评论吗"（参考产品B 是登录态 × `im_flag`/`sp_flag` 两维）；③ 隐藏窗口判定在主进程上下文里，原生崩溃时**主进程自己没了**，连降级都来不及返回 |
| 逃逸分析（QM-5 ②） | ✅ | 单测层：既有测试只锁"三态值"，没人锁"用户看到什么"；集成层：IPC 合同测试只断言 `valid/code`，`reason` 从未被断言过（所以缺解释能活到今天）；审查层：`reason` 字段看起来是给日志用的，容易被当成"非产品字段"；流程层：参考产品B 的逆向结论（§18.7）当时只写进文档，没有落到需求项 |
| 系统性漏洞定位（QM-5 ③） | ✅ | 分类：**测试场景缺失**（展示语义无任何锁）+ **审查盲区**（debug 字段与产品字段同形）+ **流程缺失**（外部实证未转成待办） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① `login-status-hints.js`：reason→{locales 键, 兜底文案, action}，**只解释不改判**，未知码回落 null，**不登记** `CHECK_LOGIN_INVALID_PARAMS`（开发缺陷不配产品文案）；② `login-check-capabilities.js`：两能力三态，缺证据一律 unknown、只有明确拒绝才 revoked、未授权≠未登录；③ `dom-login-check-runner.js`：子进程死亡/异常/空结果一律降级 `dom-check-process-died`，**绝不抛、绝不判失效**；④ `account-manager.js` 判定链**保持纯净**，新增 `loginStatusHint`/`loginStatusCapabilities` 只读包装器；⑤ IPC 显式挂载，**缺内容不挂键** |
| 防止再次发生（QM-5 ⑤） | ✅ | ① `item` 键集合被测试**逐键锁定**（多一个键就红）；② 提示表自身有锁（键名前缀/文案长度/action 白名单三要素齐全）；③ 能力表与拒绝信号表**双向对齐**锁；④ 运行器 7 例锁住"死亡必须降级"；⑤ PRD §19 写全数据流/交互/显示项/文案表/4 条边界；⑥ CHANGELOG 收口 |
| TDD | ✅ | 先写测试后实现：`login-status-hints.test.js` 的「INVALID_PARAMS 不得给提示」一例**当场红**（我最初登记了它）⇒ 删掉该登记项后绿。三个新模块 20 例 + IPC 透传 5 例全绿 |
| 探针反证 | ✅ | A 让未知 reason 也返提示 ⇒ **1 failed**；B 把子进程死亡改成向上抛 ⇒ **2 failed**；C 缺证据猜 granted ⇒ **4 failed**；三次均先备份后逐字还原，还原后 20/20 绿 |
| **架构决策记录（本轮最重要的一条）** | ✅ | 曾把 hint/capabilities **直接装饰到 `checkLoginStatus` 返回值**上 ⇒ **实测打破 13 个既有 `toEqual` 精确断言**（`{valid:false,code:'CHECK_LOGIN_INVALID_PARAMS'}` 被加上两个键），且判定与展示语义耦合。改为**判定链纯净 + IPC 层显式挂载**，并在代码注释与 PRD §19.2 写清原因，防止下一个人再踩 |
| 既有回归 | ✅ | 主进程相关 **134/134**（account-manager 89 + policy 5 + 4 个 render-crash + dev-launcher 2 + playwright-manager 6 + 新模块 20 + …）；IPC `account.test.js` **82/82**（含新增 5 例）；渲染端账号 **296 passed / 2 skipped**（16 文件）；基线对照：改动前 `account-manager.test.js` 89/89 绿 ⇒ 证明失败均为我引入并已修 |
| locale 成对 | ✅ | zh/en 各 **246 键完全一致**（无单侧键）；`check-locale-sync.js --cjk` **PASS**（基线 1374，当前 1221，无新增硬编码） |
| QM-1 打包 | ✅ | `vite build` rc=0（`dist/index.html`=True）+ `electron-builder --win --x64` **rc=0**；asar **15033** 条且含 `electron/services/playwright-manager.js`（`dev-launcher.js` 不在 asar 属预期）；启动验证三层判据 + **存活断言**：`alive=true`、**stderr 0 字节** ⇒ **PASS**；子进程 env 剔除 `ELECTRON_RUN_AS_NODE`，`envDefectNotice()` 如实告警 |
| QM-2 代码必检项 | ✅ | 未改 preload/IPC 签名；无新增同步 CPU 密集原语；未新增全局组件或顶层 CSS；`hint`/`capabilities` 只在 IPC 出口计算，不进高频判定路径 |
| QM-4 视觉 | N/A | 未新增视觉组件；账号卡片能力行仅在有确定结论时渲染（全 unknown 不渲染），沿用既有徽章与配色 |
| QM-6 CCG 双模型评审 | 见 `.ccg/reviews/` | 判定随提交生成；若命中敏感语义则按 `scripts/deep-review.sh`（Git for Windows Bash）复核并把结论写回判定记录 |
| 行尾与 diff 对账 | ✅ | 全部改动文件 LF、无裸 CR；`--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 品牌残留 | ✅ | `check-no-brand-residue.js` **PASS**（9769 tracked）；全文「参考产品B」，其厂商自有域名不转录 |
| 文档门禁 | ✅ | `check-doc-abs-paths.js` PASS；`check-unwired-tests.js` OK；`check-gate-record-debt.js --carrier-mode=visible` OK（本记录带 `sync_*` 登记字段） |
| 行数闸 | ✅ | `account-manager.js` **1260 行**（登记 1061 + 容差 200 = 1261）。按门禁意图**压缩崩溃史注释**（65→18 行，细节移入 BUGFIX 文档并留指针），**未抬登记值** |
| 已知边界（不假装闭合） | ✅ | ① `hint` 只覆盖已登记 reason/code，新码先补映射否则回落通用文案；② 能力状态**不主动请求平台**，真实能力接口接入前多数账号长期 `unknown`（不渲染，属预期）；③ 进程隔离默认路径仍在主进程内，保护的是"经准入登记确需 DOM 兜底"的将来场景；④ 文案"可能正在风控或改版"是推测性说明，我们无法从一次失败区分两者 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话同一次提交改写 PASS + merge SHA 并删除上方 sync_* 三字段 |

## 关联

- 上游（崩溃路径默认关闭 + 准入登记表）：`fix-hidden-window-render-crash`、`fix-login-check-http-only`、`dom-login-check-registry`
- 外部实证：`01-docs/REVERSE-REFERENCE-PRODUCT-B-CEF-ACCOUNT-2026-10-17.md`（§4.2 错误码话术 / §5.4 能力级授权）
- 需求侧：`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §19
- 新模块：`login-status-hints.js` / `login-check-capabilities.js` / `dom-login-check-runner.js`（均带单测）
