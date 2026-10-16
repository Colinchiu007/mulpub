---
record: wxmp-save-body-intercept
task: 公众号草稿保存 mediaId 响应体通道真机空转修复（_waitForResponseExclusive 补 body 真实契约 + 页面内 XHR/fetch 拦截第二保险 + 平台提示错误信号守卫）
date: 2026-10-16
sync_pr: PENDING
sync_reason: 远程同步待 PR 合并后回填（agent-automerge：CI 全绿后本会话自动合并，随后就地改写为 PASS + merge SHA 并删除本登记三字段）
sync_backfill_owner: lead-agent (wxmp-save-body-intercept session)
---

## 本次执行记录：公众号「缺少媒体 ID」第二例修复（wxmp-save-body-intercept，2026-10-16）【混合 PR】

- **变更类型**：运行时代码（`apps/desktop/electron/**`）⇒ 隔离 worktree（标准入口 `scripts/start-mp-task.ps1 -TaskName wxmp-save-body-intercept`，非 C 盘，路径见 worktree 登记），裸分支 `wxmp-save-body-intercept`（基线 origin/main `3c8617355`）。
- **本 PR 不是 docs-only**：含运行时代码，按混合 PR 走完整质量节拍。
- PRD 增量章节：`01-docs/PRD-WECHAT-MP-ARTICLE-PUBLISH-2026-10-12.md` §20（修复设计/校验规则 D7-D12/显示项/AC-21~27/风险）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-wxmp-save-body-intercept`（D 盘）+ 裸分支；`verify-worktree-deps.js` OK（11 项消费方解析到本 worktree）；`ensure-electron.js` v43.7.7 就绪 |
| 第一性原因（QM-5 ①） | PASS | ①读码：通道③读 `saveResp.body`（`wechat-mp-draft-mediaid.js`），而 `_waitForResponseExclusive`（`rpa-view-helpers.js`）真实 resolve 只有 `{url,statusCode,matchedUrls}`——Electron webRequest 不携带响应体 ⇒ 真机 body 恒 undefined ⇒ 通道从上线起空转（PR #3445 / merge `c2b4ea01` 引入；该 PR 遗留 2 已精确预言）；②放大镜：`[class*="tips"]` 宽选择器命中**可见但非错误**的常驻设置文案（本次「水印：数字生命丘丘」），第一例只加可见性守卫未加错误内容守卫 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链四层：**单元层**——上轮 14 例回归锁的 `_waitForResponse` mock 手写 `body` 字段，mock 与真实契约脱钩（系统性漏洞）；**集成层**——`rpa-view-helpers.test.js` 只锁 URL/statusCode/matchedUrls，没锁「响应体采集的数据从哪来」；**E2E 层**——DOM 自动化断言不了真机保存响应，需真机；**审查层**——上轮遗留 2 已点名「下一刀补 CDP getResponseBody」，被当延后项流失 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 `rpa-view-response-body.js`（CDP 响应体采集，三不可破：降级不阻塞/复用 attach 不夺走/单条失败不 reject）；`_waitForResponseExclusive` resolve 补 `body`；页面内 `XHR_INTERCEPT_SCRIPT`（fetch clone 透传 + XHR load 读 responseText，`__mpSaveResponses` 上限 5 条×200KB）；`describeSaveFailure` 加 `looksLikeErrorText` 错误信号守卫；`_startPublishNetworkCapture` 同族下沉（行为不变含脱敏）。新增 19 例回归锁 `wechat-mp-save-body-intercept.test.js` |
| 防止再次发生（QM-5 ⑤） | PASS | ①真实契约结构锁（helpers resolve 必含 body + 经 getResponseBody）；②mock 形状与真实实现对齐（本 PR 测试不再手写 body——`_waitForResponse: mockResolvedValue(null)` 即真机降级形态）；③错误信号守卫用例（水印文案不得进 error / 真实错误保留）；④PRD §20.7 风险表登记真机验证门槛 |
| 相关域测试 | PASS | 8 文件 **183 passed / 0 failed**（新增 19 例 + wechat-mp-draft-mediaid 17 + rpa-view-helpers 14 + wait-queue + judgement + dom-guard + article + platforms） |
| 变异反证 | PASS | **3/3 全部变红**：M1 摘通道④（页面内拦截）→ 1 红；M2 去 `looksLikeErrorText` 守卫 → 1 红；M3 去 helpers body 字段 → 1 红。各自还原后复绿 |
| QM-1 打包 | PASS | `electron-builder --win --dir --publish never` **rc=0**；asar 清单含 `rpa-view-response-body.js` 与 `wechat-mp-draft-mediaid.js`；解包 require 链 OK（`_waitForResponseExclusive`/`_startPublishNetworkCapture` 均 function）；启动 8 秒存活 + **stderr 空**（子进程 env 显式剔除 `ELECTRON_RUN_AS_NODE`——父环境实测带着该变量时进程以纯 Node 静默退出 rc=0，与「启动干净」同形） |
| 行数与行尾门禁 | PASS | `check-max-lines.js` ✅（helpers 440 行 <500，新模块独立计）；编码完整性 ✅ 无新增损坏；numstat 两口径一致 |
| ESLint | PASS | 改动文件 **0 error**；6 个 warning 逐一核对均为存量（main 同文件已有，diff hunk 不含） |
| QM-4 视觉 | N/A | 无渲染层 / CSS / 模板改动 |
| QM-6 双模型评审 | 降级闭环 | deep-review 判定 DUAL（609 行 > 200 阈值），但三个外部评审后端全部不可用：claude 403 订阅额度、codex 401（CC-Switch 代理缺鉴权头）、opencode 挂起 30 分钟无输出（job 终止）。按 AGENTS.md「子代理降级」纪律降级为 Lead 代理内联对抗评审（CDP 用法/竞态/拦截副作用/守卫启发式四维，无 CRITICAL/MAJOR），判定记录 status 置 `self_play_resolved` + 降级原因落盘 `.ccg/reviews/3c8617355*.json` |
| 真机验证 | ⚠️ PENDING | 本机无公众号会话（同第一例遗留）；`appMsgId` 字段名与「URL 不跳转」沿用参考产品取证口径；CDP 与行为层并发共存需真机观察日志 |

### 变异反证明细

| 变异 | 施加后 | 恢复后 |
|------|--------|--------|
| `drop-intercept-channel`（摘通道④页面内拦截） | `Tests 1 failed \| 18 passed (19)` | `Tests 19 passed (19)` |
| `drop-error-signal-guard`（去 looksLikeErrorText） | `Tests 1 failed \| 18 passed (19)` | `Tests 19 passed (19)` |
| `drop-helpers-body`（helpers resolve 去 body 字段） | `Tests 1 failed \| 18 passed (19)` | `Tests 19 passed (19)` |

### 关键取舍

1. **CDP 采集放新模块而不是直接改 helpers**：helpers 在 main 已 482 行、贴 500 上限，直接加会触发 NEW_OVER_LIMIT；且「同族 CDP 响应体采集」本就该一处维护（`_startPublishNetworkCapture` 也是同构实现，一并下沉消重复）。
2. **页面内拦截是第二保险不是主通道**：CDP 覆盖网络层（含非 XHR 场景），拦截覆盖「debugger 不可用」场景；两者独立失效域，同时失效才退回 fail-closed。
3. **错误信号用保守白名单**：宁可多走兜底文案（仍含完整可操作下一步），不可误放常驻文案伪装业务错误；真机取证后可扩表。

### 遗留（不假装已闭合）

1. 真机发图文核对（无会话）：确认四通道在真机的实际命中顺序与 `appMsgId` 字段名。
2. CDP attach 与行为层/上传并发共存：真机一次观察日志确认无 "Another debugger is already attached" 冲突路径。
3. `ERROR_SIGNAL_RE` 词表由真机错误提示样本持续校准。
4. asar 解包临时目录保留未删（R0 守卫拒目录删除，按铁律不动；路径 `%TEMP%\app-test-wxmp` 级别的会话临时产物）。

| 门禁项 | 状态 |
|--------|------|
| 远程同步 | PENDING |
