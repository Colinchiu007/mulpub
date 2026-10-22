---
record: xhs-draft-store
task: 小红书草稿强判据（本地 IndexedDB）与 draft-only 回查接线
date: 2026-10-22
delivered_by_pr: 4235
---

## 本次执行记录：小红书草稿强判据（xhs-draft-store，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `xhs-draft-store` |
| 第一性原因（QM-5 ①） | ✅ | 原判据依赖「草稿箱计数增量」与「保存接口响应」，但真机取证证明小红书草稿存于**浏览器本地 IndexedDB**（`draft-database-v1`），本地写入**不产生任何网络请求**（200s 全窗口监听零保存请求），因此两条通道本质上都读不到真实结果 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层缺 IndexedDB 判据测试；集成层 `draft-only-confirm` 无针对「本地草稿」的用例；E2E 层此前无真机草稿箱条目比对；审查层把「零网络请求」当作「未保存」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `electron/services/xhs-draft-store.js`（readDrafts / findDraftByTitle / waitForDraft，含 minTimeStamp 防同名旧草稿假阳性），接进 `recheckDraftBox`；回归 `apps/desktop/tests/xhs-draft-store.test.js` **11 例**，全仓相关 88 例通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 判定改为「草稿列表出现标题等于本次标题且 timeStamp 在本次流程窗口内」的强判据；记忆库与 EverOS 记录「本地写入无网络请求 ≠ 未保存」这一教训 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致；本 PR 变更 6 文件（A=5 M=1） |
| 接线棘轮 | ✅ | `tests/xhs-draft-store.test.js` 已由 `apps/desktop/tests/run-tests.js` 聚合执行（88 例） |
| QM-1 打包 / QM-4 视觉 | N/A | 仅 electron 主进程服务层新增模块 + 判据接线，未改 UI 与打包配置 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录，不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机尚未在**新判据**下完整跑一遍（`recheckDraftBox` 走 IDB 分支）；计划合并后立刻做一次 E2E，确认日志出现 `idb-title-match`。
- 视频号与头条仍未闭环：视频号待登录态验证，头条缺 artifact 作品列表查询。
