---
record: fix-sidebar-nav-slow
task: 修复点左侧菜单「账号」反应特别慢——listAccounts 的 PBKDF2 同步串行改异步并行
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（合并后按 .quality-gates.md 同篇记录一并回填）
---

## 本次执行记录：修复点左侧菜单「账号」反应特别慢（fix-sidebar-nav-slow，2026-10-14）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：worktree `D:\Data\projects\mp-worktrees\mp-fix-sidebar-nav-slow` + 裸分支 `fix-sidebar-nav-slow`（基于 `f2e47181e`）；`pre-code-edit-guard.ps1` exit 0；共享根保持 main clean |
| 第一性原因（QM-5 ①） | PASS | `git log -S` 定位两点：`d3cbe6a08`（2026-06-12）引入 credential-store 的 AES-256-GCM + PBKDF2 **同步**派生；`17458ef04`（2026-07-25）在 `listAccounts()` 里接入逐账号 `getAccountProxyStatus()`，把「详情场景的函数」放进「列表场景」⇒ N 账号 = N×125ms 同步串行阻塞主进程 IPC。实测 PBKDF2 占 `loadCredential` 耗时 **99.85%**（getMasterKey 仅 0.195ms），故「缓存主密钥」方向无效 |
| 逃逸分析（QM-5 ②） | PASS | 五层全失效：①单元测试 `mockReturnValue` 掉 `loadCredential`，**把唯一 CPU 热点整个抹掉**（mock 粒度 > 想隔离的依赖）；②凭证层 15 条用例只断言功能正确性，零条断言耗时/阻塞；③无「accounts:list 端到端 + 多账号 + 计时」集成用例；④视觉回归对「画面正确只是迟到」**结构性免疫**；⑤QM-2 审查清单无性能维度；⑥仓库无账号页性能基线可比对 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 `credentialStore.loadProxyStatuses()` 批量并行入口（`crypto.pbkdf2` 走 libuv 线程池 + `fs.promises.readFile`），`listAccounts()` 改走它。**回归锁 11 条**：`credential-store.test.js` C1–C5 + `account-manager.test.js` L1–L6。**变异反证 3 处实测**：① `Promise.all`→`for` 串行 ⇒ C5 判红（**默认线程池与 UV_THREADPOOL_SIZE=1 两种环境都判红**）；② 去掉 `degraded` 分支 ⇒ L4 报 `Number of calls: 3`；③ 旧 wall-time 判据在 `UV_THREADPOOL_SIZE=1` 下把并行实现误判红（i3 复现证据，催生判据形态修正）。还原后全绿 |
| 防止再次发生（QM-5 ⑤） | PASS | ①`01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md`（反思 5 步全文）；②`AGENTS.md` QM-2 新增「高频路径不得含同步 CPU 密集原语」+「详情函数复用到列表路径前必须核算单元素成本」；③`01-docs/learnings.md` +3 条（mock 粒度 > 依赖 / 慢而不错对视觉回归免疫 / 单元素成本须核算）；④`credential-store.js` 的 `PBKDF2_ITERATIONS` 加⛔注释（openspec 基线 ≥200000，不得为性能下调）；⑤CHANGELOG |
| 行尾与 diff 对账 | PASS | 两口径 numstat **逐行相等**（`git diff --numstat` == `--ignore-cr-at-eol --numstat`，16 文件全等）。删除数归因：`account-manager.js` −5（旧逐账号 map + catch 被批量入口替代）、`credential-store.js` −2（原 `100000` 字面量替为常量 + 旧 map 行）、`credential-store.test.js` −1（C5 旧 wall-time 断言被结构性判据替代） |
| 接线棘轮 | N/A | **未新增任何 `*.test.js` 文件** —— 11 条回归锁全部追加进两个已接线文件（`credential-store.test.js`、`account-manager.test.js`，均为既有被 CI 点名文件），无「新测试文件未被 workflow 点名」风险 |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1：`electron-builder --win --dir` **exit 0**；asar 清单含 `electron/services/credential-store.js` 与 `electron/services/proxy-config.js`；**从真实打包产物 require 并成功调用** `loadProxyStatuses(['nope-1','nope-2'], tmp, {})` → `{"nope-1":{"configured":false},"nope-2":{"configured":false}}`，旧 API（`loadCredential`/`decryptData`）未破坏；`configureUserDataPath` 在打包产物内对 `ELECTRON_USER_DATA_DIR` 行为正确（`explicit:true`）。**完整 8 秒启动测试未完成**：本机有用户的应用实例在运行，单实例锁使隔离实例 rc=0 提前退出（stderr 为空＝三层判据的层③，非产品缺陷）；已用「真实产物 require + 实际调用」与「configureUserDataPath 行为验证」两项替代取证。依赖门禁 `node scripts/verify-worktree-deps.js` OK。QM-4：N/A（无前端视觉变更，账号页最终画面不变） |
| QM-6 CCG 双模型外部评审 | PASS | 判定器给 `mode=dual`（526 行 > 200 阈值）。跨家族对抗实跑：proposer=opencode / critic=claude。**轮 1 产出 6 条**（`critique-v1.md`，维度分 correctness=6 security=7 performance=5 maintainability=6）。**i1/i2 被标 crypto 高危域 ⇒ 引擎硬要求外部复核**（自扮演不得豁免），已用 `claude -p`（**不同模型家族**，consult 模式只读 Read/Grep/Glob、禁 Bash/Edit/Write）独立**读码**复核：i2 驳回「CONFIRMED，前提为假」、i1 事实「CONFIRMED」处置「部分可辩护」并指出我两处不准确（「用户显式否决方案 B」夸大记录；遗留项措辞弱化欠账性质）——**两条更正均已落实**。裁决全文 `.adversarial/ccg-deep-f177a00a/adjudication.json`（i1 upheld / i2 dismissed / i3 upheld 且已修复 / i4–i6 Info 已处置） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin fix-sidebar-nav-slow` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段，并同次删除 `scripts/gate-record-debt-ledger.json` 登记项 |

### 实测性能数据（本机 12 核，PBKDF2 10 万次迭代 SHA-512）

| 账号数 | 改造前（同步串行） | 改造后（异步并行） |
|---|---|---|
| 5 | ~600 ms | ~170 ms |
| 10 | ~1.4 s | ~370 ms |
| 20 | ~2.5 s | ~1.3 s |

安全等价性：实测同步/异步两条派生路径产出的 key **逐字节相同**（同 masterKey/salt/100000 次/SHA-512/32 字节）；KDF 参数未降、AES-256-GCM 与密文格式未变。**本次是纯并发改造，不是降强度改造。**

### 遗留（不假装已闭合）

- **列表场景仍对每个账号做冗余整份解密**（CCG i1，外部复核确认）：只把 N 次 PBKDF2 从「串行阻塞」改为「并行占用」，**总 CPU 一字未减**；且 `listAccounts()` 每次进页都跑 ⇒ **复发性**成本。触发阈值 **账号数 >50** 时须实施正解（列表只返回 `configured` 布尔、详情场景才解密）。
- **`proxy` 状态无法区分「未配置」与「读取失败」**（CCG i2 建设性内核）：两者都序列化为 `{configured:false}`，渲染层无从分辨；加 `unknown`/`invalid` 语义需 locale zh/en 成对改文案，属功能契约变更。
- **PBKDF2 迭代数 100000 低于项目自身 openspec 基线（≥200000）**：存量安全欠账，本次刻意不动（调它需配存量密文兼容回退），已在代码常量注释与本文件登记。
- **`accounts:list` IPC 慢日志无阈值告警**（`ipc-handlers/account.js:380` 已打 `耗时=Nms`）：可观测性增强，独立切片。
- **`scripts/deep-review.sh` 的判定记录门恒不命中**（本轮实测发现的项目工具链缺陷）：脚本第 461-479 行按 `.ccg/reviews/<HEAD>.json` 查，而判定器明确把记录写在**父 sha** 上（`ccg-review-decider.js:284-285` 自陈），提交后按新 HEAD 查必然落空 ⇒ 这个**文档化入口**永远打印「判定记录: 无」并 exit 0，深度审查一次都跑不起来。判定器虽写了 `stagedDiffHash` 内容寻址键，但只有驱动消费了它、脚本的门没有。本次绕行：直接调驱动 `--sha <HEAD>`。修法见 `.quality-gates.md` 遗留项 5。
