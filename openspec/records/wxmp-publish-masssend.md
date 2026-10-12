---
record: wxmp-publish-masssend
task: 公众号「发布/群发」两条发送链（API 轨）+ DOM 轨群发正判据 + 发布方式三态能力
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写为 PASS + merge SHA 并删除三个 sync_* 字段
sync_backfill_owner: 下一个会话（或本会话的合并后回填步骤）
---

## 本次执行记录：公众号发布/群发链 + DOM 群发正判据（wxmp-publish-masssend，2026-10-12）

- **需求来源**：用户确认 A+B+C（修群发弱判据 / 支持「发布」freepublish / 落 API 轨群发）。
- **契约来源**：参考产品 bundle 逐函数取证（`createPublicMsg` / `createSendMsg` / `buildPushData` /
  `pushMsgResponse` / `getSendMassSendPage` / `getAllowSign` / `weixinMassCheck*`），对齐表见
  `openspec/changes/wechat-mp-publish-track/design.md`。

### 变更类型与隔离声明

运行时代码变更（packages/api-publish-engine、apps/desktop/electron、packages/shared-utils）⇒
隔离 worktree `D:\Data\projects\mp-worktrees\mp-wxmp-publish-masssend`（分支 `wxmp-publish-masssend`，
基于 origin/main `37ed3ae55`）。

> 入口说明：`start-mp-task.ps1` 首次被健康检查拦下（**其他会话**的临时 worktree
> `D:/tmp/mp-maincheck-3392` 不符合 `mp-` 命名 ⇒ `outsideWorktrees` 红）。使用健康脚本自带的
> `MP_ALLOWED_WORKTREES` 免落盘放行机制将该已知路径列入 `exemptedWorktrees` 后入口放行；
> 未修改任何门禁脚本。

### 门禁表

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 隔离 | PASS | worktree 创建（`git worktree list` 实证）+ `verify-worktree-deps.js` 11 项消费方解析 OK |
| TDD | PASS | 先测后码：`wechat-mp-publish.test.js` 11 例（fake http 注入，零网络）先行，实现随后 |
| 单元/集成 | PASS | engine 直跑组 **132 文件**全通过（含新增）；vitest 组 39 文件/327 例；desktop `rpa-view-platforms` 86 例、`publisher-router`+`wechat-mp-dom-guard` 88 例、`publish-capabilities` 90 例 |
| QM-1 打包 | PASS | `electron-builder --win --x64` rc=0；asar 清单含 `wechat-mp/publish.js`；解包后 rpa-engine / capabilities require 链 OK |
| 变异反证（QM-5 ④） | PASS | 6/6 变红（见下） |
| OpenSpec | PASS | `openspec/changes/wechat-mp-publish-track/`（proposal/design/tasks/specs 四件） |
| CHANGELOG | PASS | 收口见 `CHANGELOG.md` 条目 |
| 品牌残留 | PASS | 仓库文档只写「参考产品」，未写逆向目录绝对路径 |
| 远程同步 | PENDING | 本 PR 尚未合并。合并后：`git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 取 merge SHA；`git ls-remote --heads origin wxmp-publish-masssend` 返回 0 行证远端分支已删；回填本行与 `.quality-gates.md` 并删除 `sync_*` 三字段（同一次提交，本条不加台账键——记录文件 sync_* 即该源登记机制） |

### 变异反证 6/6（摘掉判据必须变红）

| # | 变异 | 结果 |
| --- | --- | --- |
| M1 | `runPublishChecks` 的原创判据放宽为 `ret===0`（摘掉 `err_msg==='default'`） | 红（copyright 用例断言失败） |
| M2 | `sendPush` 重试后不判 ret（拿到回包即成功） | 红（两次失败用例） |
| M3 | `buildPushBody` 摘掉发布态 `isFreePublish` 双写 | 红（双写计数断言） |
| M4 | `extractOperationSeq` 退回参考产品原正则（不兼容数组形态） | 红（op_seq 用例） |
| M5 | DOM 双判据改为「任一命中即成功」退化为「只看点击」（摘掉 fail-closed 分支） | 红（双缺失用例） |
| M6 | `runMassSendChecks` 摘掉 64715 特判 | 红（300 字文案用例） |

变异脚本 `D:\Temp\run-mutations-pub.js`：逐条改坏 → 跑对应测试 → `git checkout -- <file>` 还原，
结束后 `git status` 干净。

### 判据设计要点（评审关注）

1. **API 轨成功判据 = `base_resp.ret === 0`**（平台业务应答），延续 #3375「受理码 ≠ 完成码」纪律。
2. **DOM 轨双判据**（XHR 200 或页面成功提示，至少一条）：`_waitForResponse` 无响应体能力，
   读 body 需 CDP 捕获（改动面大）；双判据已消除主要假成功面。
3. **互斥优先级 `massSend > freePublish > draft`**：群发是更强承诺，显式勾选不得被静默覆盖
   （capability hint、router、适配器三处同口径）。
4. **「发布」按钮选择器是候选表**（`a.btn_freepublish, a[data-action="freepublish"], .weui-desktop-btn:has-text("发表")`），
   真机未验证；API 轨的发布链是契约驱动的主路径。

### 遗留（不假装已闭）

1. API 轨发布/群发链与 DOM「发布」按钮均待**真机验证**（同 #3375 遗留）。
2. 群发配额/风控错误码未穷举（fail-closed + err_msg 原文兜底）。
3. `platforms.yaml` 仍为 `dom-only`：切换前置 = 真机证据 + 本 change 已消除「勾了群发只存草稿」错位。
