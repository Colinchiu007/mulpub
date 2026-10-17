---
record: dom-login-check-registry
task: 登录态隐藏窗口兜底加「准入登记表 + 配对锁」——把准入纪律从口头变成机械拦截（不改变运行时行为）
date: 2026-10-17
# ↓ 三字段只在「远程同步」无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（dom-login-check-registry）尚未合并，merge SHA 尚不存在，无法取证收口
sync_backfill_owner: 下一个会话（同一次提交内改表格行 + 删这三个字段）
---

## 本次执行记录：准入登记表 + 配对锁（dom-login-check-registry，2026-10-17）

背景：PR #3759 已把"隐藏窗口抓 DOM 判登录态"这条崩溃路径**默认关掉**（允许集空集），但**没有任何机械判据**阻止"只加一行平台名、不交真机证据"的提交。本 PR 补上这层闸门。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | 改 `apps/desktop/electron/publishers/account-manager.js`（+3 行准入指针、删 1 行重复声明）、`account-manager-http-only-policy.test.js`（+1 例配对锁）；新增 `scripts/dom-login-check-registry.json`；文档 `01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md` §13、`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §18.6、`CHANGELOG.md` ⇒ docs-only=false。隔离 worktree `D:\Data\projects\mp-worktrees\mp-dom-login-registry`（**D 盘，非 C 盘**）+ 裸分支 `dom-login-check-registry`；共享根保持 main（**本轮未在共享根做任何 git 写**——实测共享根当时有另一会话的未提交改动，按并发铁律避让） |
| 第一性原因（QM-5 ①） | ✅ | 允许集 `DOM_LOGIN_CHECK_ALLOWED_PLATFORMS`（#3759 起默认空集）是**唯一**的开窗许可，但"往集合里加平台"这一动作**没有任何配对判据**。而该平台能否安全开窗**只有真机能验证**（真实平台页面 + 真实账号 Cookie + 隐藏窗口渲染），CI 永远凑不齐 ⇒ 四例事故（toutiao 09-16 → wechat_mp 10-06 → 知乎 10-14 #3726 → kuaishou 10-16）的共同形态都是「CI 全绿、用户机器上崩」。没有证据的准入 = 把赌注留给用户 |
| 逃逸分析（QM-5 ②） | ✅ | 单测层：既有策略锁只保证"默认空集 + 否决先于允许"，**对"加入时的证据"零约束**；审查层：`new Set(['x'])` 看起来像无害配置改动，评审很难意识到它等价于"重开一条能杀进程的路径"；流程层：纪律只写在注释与文档里——本仓已有先例证明"写进文档拦不住同类失误"；观测层：崩溃无 minidump、日志戛然而止，事后无法从 CI 产物反推是谁开的窗 |
| 系统性漏洞定位（QM-5 ③） | ✅ | 分类：**测试场景缺失**（"变更允许集"这一事件没有配对断言，只有"当前集合是什么"的静态断言）；**审查盲区**（配置化的一行改动，风险量级与代码改动不匹配）；**流程缺失**（准入无载体：没有可复核的"这平台凭什么能开窗"的落盘证据） |
| 修复 + 回归保护（QM-5 ④） | ✅ | **修复**：新增 `scripts/dom-login-check-registry.json`（今日 `platforms:{}`，与空集一一对应），每行强制 7 字段：`accessedAt` / `operator` / `realMachineRounds`(**≥2**) / `realMachineMinutes`(**≥60**) / `loginPageShape` / `loggedInPageShape` / `evidenceRef`；`requiredEvidenceFields` 缺项亦红（防登记表被改成空壳）。**回归保护**：`account-manager-http-only-policy.test.js` 第 5 例「准入配对锁」做**双向**判定——正向：允许集 ⊆ 登记表且证据齐备；反向：登记表 ⊆ 允许集（装饰性登记即红）。**顺带修掉一处上轮合并残留**：`checkLoginStatus` 函数内重复声明 `RENDER_CRASH_PRONE_OPEN_PLATFORMS`（遮蔽模块级那份；同内容故无行为差异，但属死代码），已删除 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 允许集旁加 3 行**准入指针**注释（改这里的人第一眼看到规则与判据文件位置）；② `01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md` 新增 §13（为什么需要机械准入 / 登记表 schema 逐字段 / 双向判据表 / 探针证据 / **准入操作清单 5 步** / 取不到页面形态时的替代路径）；③ `PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §18.6 回退通道同步要求登记表；④ CHANGELOG 收口；⑤ 判据落在**既有 vitest 套件**里（`electron/publishers/**`），由 QG Unit Tests / Shards 自动执行，**无需改 workflow** |
| TDD | ✅ | 先 RED 后 GREEN：新建测试而登记表不存在 ⇒ **RED**（`AssertionError: scripts/dom-login-check-registry.json 必须存在（准入登记表）: expected false to be true`，`1 failed | 4 passed`）→ 建登记表 + 修码 ⇒ **GREEN**（`5 passed`；同批 `account-manager.test.js` 89/89、共 rc=0） |
| 探针反证（锁是否真会咬人） | ✅ | A 允许集加 `weibo`、登记表不登记 ⇒ **RED**（配对锁 + 结构锁同时红）；B 登记表加 `weibo`、代码不接 ⇒ **RED**（装饰性登记）；C 两侧都加但 `realMachineRounds=1 / realMachineMinutes=30` ⇒ **RED**（证据不足）；**还原后 5/5 GREEN**。三次探针均先 `Copy-Item` 备份、后逐字恢复 |
| QM-1 打包 | ✅ | `vite build` rc=0（`dist/index.html`=True）+ `electron-builder --win --x64` **rc=0**；asar 清单 **15029** 条且含 `electron/services/playwright-manager.js`（`dev-launcher.js` 不在 asar 属预期）；启动验证按三层判据 + **存活断言**：`alive=true`、**stderr 字节=0** ⇒ **PASS**；子进程 env 经 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE`，`envDefectNotice()` 如实出声告警（父环境带该变量=1） |
| QM-2 代码必检项 | ✅ | 未改 preload / IPC 签名 / require 路径；无新增同步 CPU 密集原语；未新增全局组件或顶层 CSS；运行时行为**零变化**（允许集仍为空集） |
| QM-4 视觉 | N/A | 不涉及渲染端 UI/样式/文案；`unverified` 第三态与文案沿用既有（§17.4），未新增 locales 条目 |
| QM-6 CCG 双模型评审 | 见 `.ccg/reviews/` | 判定随提交生成；若命中敏感语义则按 `scripts/deep-review.sh`（Git for Windows Bash）复核并把结论写回判定记录 |
| 行尾与 diff 对账 | ✅ | 全部改动文件统一 LF、**均带末尾换行**（本轮实测三处初次写入缺末尾换行，已补齐——上一轮的 `--ignore-cr-at-eol` 差 1 行正是这个根因）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 品牌残留 | ✅ | `check-no-brand-residue.js`（docs-only 保留面之一）：本轮新增文案只写「参考产品A/B」口径 |
| 文档门禁 | ✅ | `check-doc-abs-paths.js`：新增/改写文档全部用相对路径引用 |
| 接线棘轮 | ✅ | 新测试落在已登记的 `electron/publishers/**` 通配内，无需新增接线 |
| 已知边界（不假装闭合） | ✅ | ① 这是**流程闸门**，不是崩溃修复：不改变运行时行为（允许集仍空），只保证"将来谁开窗谁必须带真机证据进场"。② 证据**字段齐备 ≠ 证据质量**：`loginPageShape` 写得敷衍（如 `"x"`）仍能过锁——探针 C 正是用这种敷衍值证明"数值门槛能拦，语义质量拦不住"，那一层仍需人工评审。③ 锁读的是**源码字面量**，若将来允许集改成从别处装配（如从 env/JSON 读），本锁会因解析不到字面量而红——那是**预期**行为（改契约必须同时改锁）。④ 未做：把 DOM 判定搬进独立进程的隔离方案（#3759 已让默认路径不触碰它，等真需求再上） |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话同一次提交改写 PASS + merge SHA 并删除上方 sync_* 三字段 |

## 关联

- 上游（把崩溃路径默认关掉）：PR #3759 / 记录 `openspec/records/fix-login-check-http-only.md`
- 详细文档：`01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md` §13
- 需求侧：`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §18.6
- 登记表：`scripts/dom-login-check-registry.json`
