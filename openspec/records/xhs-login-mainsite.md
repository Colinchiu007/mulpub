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
| 修复 + 回归保护（QM-5 ④） | ✅ | `PLATFORM_POST_LOGIN_REDIRECT` 表 + auth-view-manager 二段式接入（Promise.race 15s 兜底）；回归保护 `apps/desktop/electron/tests/xhs-mainsite-login.test.js` 六条契约（表锁/结构锁/行为锁），TDD 红灯先行（C2/C3a/C3b/C4 先红后绿），实现后 6/6 绿；相关既有测试 5 文件 120/120 绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | 未配置 redirect 的平台零回归由 C3c 行为锁把关；redirect URL 查表而非字面量（C3a 刻意不锁 www 字面量，防「改表必须同步改 manager」反向耦合）；15s 兜底不阻断登录由 C4 锁定 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 207 增 0 删（A=1 M=2），`--ignore-cr-at-eol --numstat` 同值，无行尾噪声；新文件 LF 由 git autocrlf 正常化 |
| 接线棘轮 | ✅ | 新增 `electron/tests/xhs-mainsite-login.test.js` 命中 vitest.config.js include 通配 `electron/tests/**/*.test.{js,ts}`（既有接线，非新增 workflow） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置与视觉面 |
| QM-6 CCG 双模型外部评审 | ✅ | pre-commit CCG 判定 DUAL（207 行 > 200 阈值），后端就绪（claude + opencode）；决策层提示「范围漂移」系 TDD 流程自声明（方案文件未建，改动即方案），验证层 diff 审查已落盘 `.ccg/reviews/f931ce4e8*.json` |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#3309)$' --format=%H|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin xhs-login-mainsite` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 遗留（不假装已闭合）

- 真机验证未做：重新登录抓全量 cookie（应含 web_session）→ probe 重测 note → 草稿落箱。验证结论与 PRD §15 / learnings 随下一轮补录
- 主站补跳的用户可见性（登录窗短暂跳到主站首页再关闭）未做 UX 确认，如用户反馈突兀可加提示文案
