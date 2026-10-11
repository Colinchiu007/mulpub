---
record: xhs-login-mainsite
task: 小红书登录二段式补跳主站补抓 web_session（修 code -100「无登录信息」根因）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR #3309 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（合并后回填 PASS + merge SHA，删除本段三字段）
---

## 本次执行记录：小红书登录二段式补跳主站（xhs-login-mainsite，2026-10-11）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `D:\Data\projects\mp-worktrees\mp-xhs-login-mainsite`，裸分支 `xhs-login-mainsite`，基线 main f931ce4e8 |
| 第一性原因（QM-5 ①） | ✅ | note code -100 根因：登录窗 URL=creator.xiaohongshu.com，登录后主站 web_session 从未被设置，凭据快照缺主站会话（xhs-note-align 执行记录遗留结论，三轮真机 406→-1→-100 递进取证） |
| 逃逸分析（QM-5 ②） | ✅ | 既有测试从未覆盖「登录载体与会话域不一致」场景：单元层全过、真机层才发现。登录快照判据（hasPlatformSessionCookie）只认 creator 标记键，主站会话缺失完全不可见 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `PLATFORM_POST_LOGIN_REDIRECT`/`PLATFORM_POST_LOGIN_PROOF_COOKIES`/`POST_LOGIN_REDIRECT_WAIT_MS` 三表同源 + 二段式自包含模块 auth-post-login-redirect.js（auth-view-manager 挂账 553 行膨胀超容差被 CI 债务熔断拦截后拆分）+ manager 单点接线（未配置平台查表绕开 await，零微任务开销——CI Gate 4 实测回归的修复）；回归保护 `apps/desktop/electron/tests/xhs-mainsite-login.test.js` 八条契约（表锁/结构锁/行为锁：补跳时机、凭证轮询就绪、未配置零回归、短路、15s 兜底+短重试、凭证晚到命中），TDD 红灯先行；auth-view-manager 既有 43 例全绿、相关回归 97/97 绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | 未配置 redirect 的平台零回归由 C3c 行为锁 + 既有 43 例把关；redirect URL 查表而非字面量（结构锁刻意不锁 www 字面量，防反向耦合）；就绪判据=凭证轮询命中（防「页面加载完但会话未种下」假就绪）；兜底路径留 snapshotWillMissMainSiteSession 失败标记日志（降级可观测） |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 逐值相等（2026-10-11 全部五次提交逐次复核），无行尾噪声 |
| 接线棘轮 | ✅ | 新增 `electron/tests/xhs-mainsite-login.test.js` 命中 vitest.config.js include 通配 `electron/tests/**/*.test.{js,ts}`（既有接线，非新增 workflow） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置与视觉面 |
| QM-6 CCG 双模型外部评审 | ✅ | 三轮真实双模型评审（claude critic，opencode proposer 跨家族校验通过），18 条 findings 全部处置：r1（6 条）凭证校验/短路/stop 防护落实；r2（6 条）就绪判据改凭证轮询/测试自证修正/domain 校验/短重试/常量同源/UX；r3（5 条）i2 双时钟竞态、i4 view 销毁 throw 属实已修，i1 stop 时机、i3 host-only 域、i5 延迟设计经实证驳回（i3 有 node 实测四域变体全命中），auth 高危两项按引擎要求外部复核（opencode 直调 600s 超时，finalVerdict 附实证、真机验证兜底）；判定落盘 .ccg/reviews/*.json、裁决 .adversarial/ccg-deep-*/adjudication.json |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#3309)$' --format=%H|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin xhs-login-mainsite` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 遗留（不假装已闭合）

- 真机验证未做：重新登录抓全量 cookie（应含 web_session）→ probe 重测 note → 草稿落箱。验证结论与 PRD §15 / learnings 随下一轮补录
- 主站补跳的用户可见性（登录窗短暂跳到主站首页再关闭）未做 UX 确认，如用户反馈突兀可加提示文案
