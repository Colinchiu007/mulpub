---
# 用法：复制本文件为 `openspec/records/<分支名或任务 slug>.md`。
record: ops-change-password
task: 运营中心新增「更改密码」功能，实现登录密码的修改（含改密后旧会话失效）
date: 2026-10-12
---

## 本次执行记录：运营中心新增「更改密码」（ops-change-password，2026-10-12）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（ops-center 前端 + 后端）：隔离 worktree `mp-ops-change-password`（D 盘，非 C 盘）+ 裸分支 `ops-change-password`；pre-flight 守卫确认共享根禁改未越界；writeGuard running |
| 第一性原因（QM-5 ①） | PASS | **该流程此前根本不存在，文档指向的是一条断掉的链路**：PRD §6.4 与 OPERATIONS §11.3 均写「改 `.env` 口令不会同步进库，要么用『修改密码』流程…」，但 `auth_service.ensure_admin_seeded` 在 `existing is not None` 时直接 return（auth_service.py:74-76），从不更新已有行 → 「修改密码」无处可做 |
| 逃逸分析（QM-5 ②） | PASS | 单元层：无改密相关测试（功能不存在，无从覆盖）；集成层：菜单/路由/pageGuide 三处接线无任何一致性断言，漏接不报错；文档层：两处文档反复指向一条不存在的流程，无人按文档执行过；审查层：`create_access_token` 无凭据指纹，改密无法让旧 token 失效这一事实从未被显式讨论 |
| 修复 + 回归保护（QM-5 ④） | PASS | 后端：`validate_new_password` 复用 `config._validate_admin_password`（不写第二套判据）；`change_password` 含原密码校验/两次一致/不同于旧密码/独立限流/换盐重哈希；`password_fingerprint` + `_reject_revoked` 实现改密即失效。前端：菜单项/路由/pageGuide/API/视图五处接线 + ChangePassword.vue 状态机。回归保护：`tests/test_change_password_api.py` 17 例、`src/config/changePasswordWiring.test.js` 7 例 |
| 防止再次发生（QM-5 ⑤） | PASS | 新增接线一致性测试（菜单↔路由一一对应、adminOnly 口径成对、pageGuide 存在、adminOnly 数量从单一事实源推导），从机制上堵住「加菜单漏路由/漏说明」；PRD §6.5 完整落规格（数据校验表/流程/显示项/提示文字/与 .env 关系），OPERATIONS §11.3 与接口速查同步 |
| 行尾与 diff 对账 | PASS | 变更 12 文件（A=4 M=8 D=0）；无删除 |
| 接线棘轮 | PASS | 新增 `*.test.js` 均在 `vitest.config.js` 的 include（`src/**`、`tests/**`）覆盖内；后端新测试由 CI `ops-center 后端测试` job 实跑 |
| QM-1 打包 / QM-4 视觉 | N/A / 部分 | 未触 `apps/`、`packages/`，无需打包。前端新增页面属 UI 变更，但无视觉回归基线设施（本项目 ops-center 前端无 Playwright 像素对比），已按门禁规则评估为「无可跑工具」，改以 build 通过 + 接线测试替代，如实登记 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录，不以自审冒充 |
| 远程同步 | PASS | PR #3413 已 squash 合并：merge SHA `7ea442f`（2026-10-12T16:08:20+08:00）；`git ls-remote --heads origin ops-change-password` 返回 0 行，远端分支已删。合并途中 QG Autonomous（非 required、且审计对象为桌面端 PRD 覆盖的基线欠账）曾 FAIL 阻塞，重跑后 LLM 判定翻转 PASS 后合并——该波动性已登记为本任务遗留 |

### 实现要点（值得留存的判断）

**1. 改密后如何让无状态的 JWT 失效。** JWT 签发后无法「删除」，故引入口令凭据指纹：登录时把 `sha256(库中口令哈希)[:16]` 写进 payload 的 `pwd_fp`，每次鉴权与库中当前指纹比对。两个刻意的边界：① 取二次摘要而非哈希片段——JWT payload 只签名不加密，直接放哈希片段等于向持票人泄露哈希材料；② **有 `pwd_fp` 才校验**（"有则校验"非"没有就拒绝"），否则会一刀切打死桌面端 Bearer 通道与既有测试。

**2. 判据绝不写第二份。** 弱口令表与长度门槛复用 `config._validate_admin_password`（启动期校验 `OPS_ADMIN_PASSWORD` 的同一套）。历史教训：`platform_def_service` 曾因种子与渲染端各自维护而漂移（douyin/xiaohongshu 5000 vs 1000）。前端也刻意**不**实现弱口令表，否则两表必然漂移。

**3. 踩到的坑（已修）：默认参数值会让 monkeypatch 静默失效。** 初版把 `MAX_LOGIN_FAILURES` 写成 `_record_failure` 的默认参数值，Python 在 def 时求值并绑定，`monkeypatch.setattr(module, "MAX_LOGIN_FAILURES", 3)`（既有测试提速限流的手法）改不动已绑定的默认值 → 2 个既有测试变红。修正为在函数体内读取模块级常量。已补注释钉住，防回潮。

### 遗留（不假装已闭合）

- **`/rollout` 权限口径不一致（既有缺口，非本次引入）**：`MENU_ITEMS` 标了 `adminOnly`，但 `router` 的 `meta` 未标 —— 菜单对非 admin 隐藏，地址栏直达却放行。可能是「只读看板有意放开」，也可能是漏接。本次不擅改他人页面权限，已在 `changePasswordWiring.test.js` 登记为例外并断言「例外只允许减少」。**待你确认**：生效看板是否应对非 admin 放行？
- **`menu-visibility.test.js` 标题与断言双错（既有）**：标题写「6 个 adminOnly 项」但只列 5 个 path，实际是 9 个。写死个数而不从 `MENU_ITEMS` 推导 = 每次新增都要人肉改，不改就假绿。本次未改该文件（避免越界），但新测试已示范正确写法（从单一事实源推导）。
- **无视觉回归设施**：ops-center 前端没有 Playwright 像素对比，新增页面的视觉验证只有 build 通过。建议后续补 `npm run test:visual:pixel`（属基建，不在本任务范围）。
- **JWT 指纹校验引入一次 DB 查询**：`_reject_revoked` 在每个带 `pwd_fp` 的请求上查一次 `admins` 表。当前单管理员、QPS 极低，可接受；若未来管理员数量或请求量上升，应改为缓存指纹（如进程内带 TTL）。
- **改密未接入审计日志**：`AuditLog` 记录配置类操作，改密（凭据变更）未纳入。安全上理想应记录，本次未做，登记待办。
