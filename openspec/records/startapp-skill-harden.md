---
record: startapp-skill-harden
task: start-app skill 入口选择硬路由 + preload 缺失排查 + 结构锁（防"重启应用"走错入口盖掉共享数据锚点）
date: 2026-10-17
# ↓ 三字段只在「远程同步」无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（startapp-skill-harden）尚未合并，merge SHA 尚不存在，无法取证收口
sync_backfill_owner: 下一个会话（同一次提交内改表格行 + 删这三个字段）
---

## 本次执行记录：start-app skill 入口选择硬路由 + preload 排查 + 结构锁（startapp-skill-harden，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ docs-only | 改动 3 个文件：`.agents/skills/start-app/SKILL.md`（v1.7.0→v1.8.0）、`CHANGELOG.md`、新增 `apps/desktop/electron/tests/start-app-skill-harden.test.js`。**未改任何启动脚本逻辑**（`sync-app.ps1` / `mp-applive-launcher.ps1` / `start-desktop.ps1` 一行未动）。隔离 worktree `D:\Data\projects\mp-worktrees\mp-startapp-skill-harden`（**D 盘**）+ 裸分支 `startapp-skill-harden`；共享根全程零 git 写（`main`、脏项 0） |
| 第一性原因（QM-5 ①） | ✅ | skill 把「一键启动」写成"**优先**"、把「start-desktop.ps1 长流程」写成"备选"，两节并列且长流程带完整可抄的命令 ⇒ agent 面对「重启应用」时**无法从文字判断默认入口**，于是走了长流程；而长流程示例里的 `-Profile '<debug-profile>'` **会盖掉 `shared-user-data` 锚点** ⇒ 用户看不到已登录账号。第二个同场坑：preload 产物（gitignored）缺失时，`servicesGetStatus` 走主进程 IPC 仍报全 running，极具误导性 |
| 逃逸分析（QM-5 ②） | ✅ | 单测层：**start-app skill 此前没有任何结构锁**（`.agents/skills/**` 不在 vitest include 内，且没人想到要给文档写锁）；审查层：文档改动看起来"只是措辞"，风险被低估；流程层：skill 自己没有"入口路由"这一节，agent 只能按章节顺序读，长流程章节号更靠后但内容更详细（更容易被当成"正式流程"） |
| 系统性漏洞定位（QM-5 ③） | ✅ | 分类：**测试场景缺失**（文档路由规则无机械判据）+ **审查盲区**（skill 文档改动从不进 Code Review 视野）+ **流程缺失**（无"入口选择"显式小节，靠 agent 自行推断） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 「三种场景」节新增 **⛔ 入口选择铁律**小节：无特殊 worktree/环境要求 ⇒ 一键启动是唯一入口，写明判定顺序与「不要再往下读长流程」；② 「关键事实」节把"首选"改为"硬路由"并加 `-Profile` 警告；③ 「一键启动 → 验证」节新增第 5 条 + 「窗口在但 electronAPI 缺失」独立排查小节（含反误判说明）；④ 「失败处理」表补 3 行；⑤ 删除把读者导向长流程的旧措辞 |
| 防止再次发生（QM-5 ⑤） | ✅ | 新增 `electron/tests/start-app-skill-harden.test.js`（7 例，落在 vitest include 白名单内，CI 会跑）：铁律存在且点名 sync-app.ps1 / 场景表不得导向长流程 / **「不得手动传 -Profile」警告句式必须存在** / preload 排查必须存在 / 必须记录事故日期 / 不得教人主动手工包 WMI |
| TDD | ✅ | 先写结构锁后改文档：`SKILL.md` 未改前测试**当场红**（缺铁律小节）；按锁逐条改文档后转绿 |
| 探针反证（3 个，全咬人） | ✅ | A 铁律改回软措辞（「入口选择建议」/「建议优先考虑」）⇒ **1 failed**；B 整段删除 `-Profile` 警告 ⇒ **1 failed**；C 删 preload 排查关键句 ⇒ **1 failed**；还原后 **7/7 passed** |
| **判据宽度的教训（本轮最有价值的一条）** | ✅ | ③ 最初只匹配 `-Profile` / `AUTH_REQUIRED` 这些**词** ⇒ 探针 B 删掉整段警告后**仍然全绿**：事故描述句里就含同批词，`toMatch` 全文匹配抓到了残留 ⇒ **锁假绿**。改为锁**警告句式本身**（`/不得手动传\s*`-Profile`/` + 附近 400 字内的后果词）后才咬人。已把该教训写进测试注释 |
| QM-1 打包 | N/A | docs-only（未改 `apps/desktop/electron/` 运行时代码）；新增文件是测试，不参与打包 |
| QM-2 代码必检项 | ✅ | 测试只用 `fs` + `path`（node 内置），无同步 CPU 密集原语、无 IPC、无全局组件；`read()` 每次调用重读文件（避免缓存导致改文档后读到旧内容） |
| QM-4 视觉 | N/A | 无 UI 改动 |
| QM-6 CCG 双模型评审 | 见 `.ccg/reviews/` | 判定随提交生成；若命中敏感语义则按 `scripts/deep-review.sh`（Git for Windows Bash）复核并把结论写回判定记录 |
| 行尾与 diff 对账 | ✅ | CHANGELOG 按主干约定合并（**main 内容零丢失**：多重集校验 `main 丢失行=0`），末尾换行与主干一致；`--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（98/0 = 98/0） |
| 品牌残留 | ✅ | 未引入竞品实名（全文用 `shared-user-data` / `Multi-Publish-debug-profile` 等本仓路径名） |
| 文档门禁 | ✅ | `check-doc-abs-paths.js` PASS；`check-unwired-tests.js` OK（新测试落在已登记的 `electron/tests/**` 通配内）；`check-gate-record-debt.js` OK（本记录带 `sync_*` 登记字段） |
| 已知边界（不假装闭合） | ✅ | ① 本 PR **不改启动脚本逻辑**，只改 skill 文档与加锁；② 「入口铁律」约束的是**未来 agent 的行为**，挡不住有人绕过 skill 直接跑命令；③ `.agents/` 被 `.gitignore:310` 忽略，但 `SKILL.md` 是已跟踪文件故仍受版本管理（测试文件因此按惯例落在 `electron/tests/`）；④ 结构锁只覆盖本次 6 条判据，未来新增入口/新坑仍需人工补锁 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话同一次提交改写 PASS + merge SHA 并删除上方 sync_* 三字段 |

## 关联

- 事故现场：2026-10-17 「重启应用」→ 走 `start-desktop.ps1 -Profile …` 长流程 → 锚点被盖 → `listAccounts` 报 `AUTH_REQUIRED`
- 同场第二坑：preload 产物缺失 → `window.electronAPI` undefined → 一度误判为登录态问题
- 一键启动（本 PR 未改）：`scripts/sync-app.ps1` + `scripts/mp-applive-launcher.ps1`
- skill-repo 同步目标：`<external-sync>\100-Agent-data\skill-repo\start-app\SKILL.md`
