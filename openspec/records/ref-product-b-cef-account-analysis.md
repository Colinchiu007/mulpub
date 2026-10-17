---
record: ref-product-b-cef-account-analysis
task: 参考产品B（CEF 壳）账号逻辑静态逆向：判定走 HTTP 单轨、三态 suc/logout/fail、错误码→话术、能力级授权标志；并登记不采用的后台自动重登路径
date: 2026-10-17
# ↓ 三字段只在「远程同步」无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（ref-product-b-cef-account-analysis）尚未合并，merge SHA 尚不存在，无法取证收口
sync_backfill_owner: 下一个会话（同一次提交内改表格行 + 删这三个字段）
---

## 本次执行记录：参考产品B（CEF 壳）账号逻辑逆向分析（ref-product-b-cef-account-analysis，2026-10-17）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=true**（files=3：`01-docs/REVERSE-REFERENCE-PRODUCT-B-CEF-ACCOUNT-2026-10-17.md`、`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md`、`openspec/records/ref-product-b-cef-account-analysis.md`）
- 保留门禁：行尾对账 ✅（`--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致） | 品牌残留 ✅（零竞品实名，统一「参考产品B」，其厂商自有域名不转录） | 文档同步 ✅（PRD §18.7 互证小节 + 分析正文互链） | 远程同步 PENDING
- 备注（可选）：本次为**静态逆向 + 文档产出**，无运行时代码改动，故 QM-1/QM-2/QM-4/TDD 按 docs-only 通道跳过。

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ docs-only | 改动仅 `01-docs/` 与 `openspec/records/`；共享根就地编辑 + PR 落地（不改运行时代码，无需 worktree/打包） |
| 分析范围 | ✅ | 只读安装目录（`libcef.dll` 148.8MB / `WEMedia.exe` 17.3MB / `MediaTaskMgr.dll` 10.0MB / `Asset\sign2` 11.7MB / `Asset\dist` 14 个 view）与 `%APPDATA%` 数据目录；**未运行其程序、未抓包、未登录其服务** |
| 核心结论（可复核） | ✅ | ① 判定走 HTTP 单轨：`windowless`/`offscreen`/`OSR` 命中 **0**，平台侧调 `.../user/info`、`.../authority/account/current`、`.../GetAccountInfo`；② 三态 `suc`/`logout`/`fail`；③ 错误码→话术 `2190008`「授权失效,请重新授权」、`100437`「无法获取私密账号数据」；④ 能力级授权标志 `im_flag`/`sp_flag`/`open_id`；⑤ 它有 `backgroundautoreloginwnd`（后台自动重登）+ 账号密码注入登录页——我们**明确不采用** |
| 第三方 SDK 辨识 | ✅ | `Asset\sign2\sign2.js`/`sign\sign6.js` 中的 `checkLoginWithAction`/`isLogin` 属**平台官方 Launcher SDK**（`@xhs/launcher-plugin-store`、`Auth/*`、`internalSSO`），非自研逻辑——避免把 SDK 误当竞品实现（本轮差点踩） |
| 局限如实登记 | ✅ | 未抓包（链路为三点推断）；未解 SQLite 表结构；未取 CEF 版本；错误码样本仅两个；账号密码存储形态未取证（只证注入） |
| 消费方（衔接） | ✅ | PRD `PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §18.7 新增「外部互证」；后续 P1 项（`PLATFORM_LOGIN_ERROR_HINTS`、能力级授权态）已写入分析 §8 |
| 品牌口径 | ✅ | 全文「参考产品B」；其厂商自有后端域名**不转录**（只给命中条数与取证方法） |
| 行尾/编码 | ✅ | 三个文件均 LF、带末尾换行、无裸 CR；两口径一致 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话同一次提交改写 PASS + merge SHA 并删除本条 PENDING 说明 |
