---
record: wxmp-draft-mediaid-fix
task: 微信公众号草稿保存 mediaId 采集补「响应体 appMsgId」第三条通道 + 平台提示可见性判据（innerText 隐藏节点实测取证）
date: 2026-10-12
---

## 本次执行记录：公众号草稿保存「缺少媒体 ID」报错修复（wxmp-draft-mediaid-fix，2026-10-12）【混合 PR】

- **变更类型**：运行时代码（`apps/desktop/electron/**`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-wxmp-draft-mediaid-fix`（标准入口 `scripts/start-mp-task.ps1 -TaskName wxmp-draft-mediaid-fix` 创建，非 C 盘），裸分支 `wxmp-draft-mediaid-fix`（基线 `origin/main` = `8770e65c9`）。
- **本 PR 不是 docs-only**：含运行时代码，`classify-docs-only.js` → false。
- **共享根保持 main**：任务开始时共享根有 1 个**前序会话遗留**的未提交修改（`01-docs/learnings.md` 追加 Gate 9 复盘，非本任务产物），按纪律 `git stash push -- <精确路径>` 保护后恢复干净，worktree 方可创建。全程只在 worktree 落盘。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-wxmp-draft-mediaid-fix`（D 盘）+ 裸分支 `wxmp-draft-mediaid-fix`；`verify-worktree-deps.js` OK（11 项消费方解析到本 worktree）；`ensure-electron.js` v43.7.7 就绪 |
| 第一性原因（QM-5 ①） | PASS | ①读码：保存段 mediaId 只从 URL / 响应 URL 两处取，均要求 URL 含 `appmsgid=`，而编辑器 URL 是 `isNew=1` 新建态、保存按钮是 `a#js_sync_save`（原地保存语义）⇒ 通道缺失；②实测：Playwright fixture 证明 `innerText` 对 `display:none` / `left:-9999px` 节点**照样返回文本**（`offsetParent=null` / `rects=0` 仍读到文案）⇒ `readEditorToast` 把编辑器常驻说明当「平台提示」 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链四层：**单元层**——既有 3 个 wechat 测试文件的 `_waitForResponse` 一律 `mockResolvedValue(null)`，即「保存 XHR 有响应」这条路径**从未被任何用例覆盖**；**集成层**——`_publish_wechat_mp` 的保存段无「URL 不跳转但保存成功」用例（所有用例的 `getURL` 都直接返回带 `appmsgid=` 的 URL，等于只测通道 ①）；**E2E 层**——平台 DOM 自动化断言不了草稿箱内容，需人工；**审查层**——`readEditorToast` 的调用点把它当「平台错误原文」，而它实际读的是「页面上任何带 toast/tips 类名的文本」，这个语义错位在单文件审查里看不出来 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 `wechat-mp-draft-mediaid.js`（三条采集通道 + 可见性 toast + 可操作文案）；`rpa-view-platforms.js` 保存段下沉（1483 → 1415 行，targets 点名文件**负增长 68 行**）；新增 14 例回归锁 |
| 防止再次发生（QM-5 ⑤） | PASS | ①通道 ③ 单独断言（URL/响应 URL 均无 ID 时仍算成功）；②`appMsgId=0` 显式判「未创建」（与 API 轨 L149 同口径，防两轨分裂）；③toast 脚本形态锁（`offsetParent \|\|` 与 `getClientRects` 必须同时在场）；④失败文案必须含可操作下一步；⑤既有「三条全空仍 fail-closed」用例保留，防补通道被误读为放宽判据 |
| 行尾与 diff 对账 | PASS | 新增文件 LF / UTF-8 无 BOM；`node scripts/check-text-encoding-integrity.js` PASS；未改动既有文件既有行尾 |
| 新增文件行数门禁 | PASS | `node .github/scripts/check-max-lines.js` → 无新增超大文件；`rpa-view-platforms.js`（targets 点名、容差 0）1415 ≤ 1484 |
| ESLint | PASS | `pnpm run lint` 0 error |
| 相关域测试 | PASS | 7 文件 **152 passed / 0 failed**（`wechat-mp-draft-mediaid` 14 + `rpa-view-platforms` + `rpa-view-wechat-publish-judgement` + `wechat-mp-dom-guard` + `wechat-mp-article` + `rpa-view-helpers` + `rpa-view-helpers-wait-queue`） |
| 变异反证 | PASS | **4/4 全部变红**：M1 摘响应体通道 → 2 红；M2 不拒 `appMsgId=0` → 1 红；M3 去可见性守卫 → 3 红；M4 去可操作提示 → 2 红。每个变异施加后变红、`--revert` 后 14/14 复绿（脚本内置 .bak 整体还原，不用正则反向替换） |
| QM-1 打包 | 见下 | 改 `apps/desktop/electron/**` ⇒ 需打包证据（本记录「打包」小节） |
| QM-4 视觉 | N/A | 无渲染层 / CSS / 模板改动 |
| QM-6 CCG 双模型外部评审 | 部分 | 已用一次**真实浏览器实测**（Playwright fixture 取证 `innerText` 语义）替代「凭记忆猜 DOM 行为」；正式 CCG 双模型评审未在本轮执行，如实记录 |
| 远程同步 | PENDING | 见 `scripts/gate-record-debt-ledger.json` 本条登记；合并后回填 |

### 打包（QM-1）

- 命令：`cd apps/desktop && pnpm exec electron-builder --win --dir --publish never`
- 结果：见本记录「打包输出」小节（若本节为空表示打包尚未执行，CI 打包 job 为准前不得声称已打包）

### 变异反证明细

| 变异 | 施加后 | 恢复后 |
|------|--------|--------|
| `drop-body-channel`（摘掉响应体通道 = 真根因修复本身） | `Tests 2 failed \| 12 passed (14)` | `Tests 14 passed (14)` |
| `accept-zero-appmsgid`（不拒 `appMsgId=0`） | `Tests 1 failed \| 13 passed (14)` | `Tests 14 passed (14)` |
| `drop-visibility-guard`（toast 去可见性守卫） | `Tests 3 failed \| 11 passed (14)` | `Tests 14 passed (14)` |
| `drop-actionable-hint`（失败文案去可操作提示） | `Tests 2 failed \| 12 passed (14)` | `Tests 14 passed (14)` |

### 遗留（不假装已闭合）

1. **真机未验证字段名**：本机无可用公众号账号会话（`accounts` 表 0 行、`publish_history` 表 0 行、今日 `app.log` 474 行无任何 `wechat_mp` 记录），因此「保存响应体字段确实是 `appMsgId`」「保存后 URL 确实不跳转」两条**未实测**。依据是三条旁证（`isNew=1` 新建态、`js_sync_save` 原地保存语义、API 轨需单独发 `appmsg_edit&appmsgid=` 回读），非一手证据。`tasks.md` §7 保留该门槛。
2. **`_waitForResponse` 不返回 body**：当前只回 `{url, statusCode, matchedUrls}`。通道 ③ 读 `saveResp.body`，真机上若该字段不存在则**静默跳过**（不抛错，退回两条老通道）。若真机确认需要 body，下一刀给 `_waitForResponseExclusive` 补 CDP `Network.getResponseBody` —— 那会碰到响应体读取的隐私面，需单独评审。
3. **「弹幕提示」的页面归属是推断**：该文案是公众号视频弹幕开关的说明（弹幕只对公众平台上传的非转载视频开放），本仓无一手 DOM 抓取条件；本修复的正确性**不依赖**这个归属判断 —— 无论它属于哪个模块，只要它是「与本次失败无关的常驻说明」，可见性判据就该排除它。
4. **共享根 stash**：本任务开始时保护的前序修改在 `stash@{0}`（`session-preserve: learnings.md gate9 复盘追加`），属前序会话产物，**本 PR 不代为提交**；如需落地应另开 docs PR。
