---
record: collection-drafts-tab
task: 采集页草稿箱标签页 + 素材来源入口修正
date: 2026-10-12
sync_status: PENDING
sync_reason: PR #3395 尚未合并，merge SHA 无从取证，故远程同步行写 PENDING 而非闭合词；合并后由回填提交改为 PASS + merge SHA，并同时删除 sync_reason / sync_backfill_owner / sync_status 三字段（回填与销账必须同一次提交）。
sync_backfill_owner: collection-drafts-tab 分支作者（本会话）
---

## 本次执行记录：采集页草稿箱标签页（collection-drafts-tab，2026-10-12）

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | PASS | 运行时代码变更 ⇒ 隔离 worktree `D:/Data/projects/mp-worktrees/mp-collection-drafts-tab`，裸分支 `collection-drafts-tab`；共享主目录保持 main 且 `git status` 干净 |
| 第一性原因（QM-5 ①） | PASS | 两套草稿**共用同一行存储**，不是「并存两套」：`draftSave` 走 `store.getUserSetting('drafts', owner)`，采集页 `storeGetSetting('drafts')` 走 `store:get-setting` → 同一个 `scopedSettingKey('drafts', owner)`（`electron/services/store/settings-store.js:11`）。四个用户可见缺陷全部由此派生 |
| 逃逸分析（QM-5 ②） | PASS | `Collection.test.js` 只断言 `w.vm.drafts.length`（本地 ref），从不校验落库形态 ⇒ 两套方言是否互相污染**没有任何测试覆盖**；`store.test.js` 的 draftSave 用例只测单侧写入，无跨入口混读场景 |
| 系统性漏洞定位 | PASS | 缺「写入方言单一真源」判据：允许页面绕过 `draftSave` 直接写 settings。修复后写入口只剩 `draftSave` 一条，且新 composable 是唯一封装 |
| 修复 + 回归保护（QM-5 ④） | PASS | ①新增 `useCollectionDrafts.js` 统一读写；②采集页 5 处 `drafts.value.unshift + saveDrafts()` 全改 `persistDraft()`；③前端不再自造 id（旧写法使指纹幂等失效）；④新增 `PLATFORM_SOURCE_URLS` 而非改 `PLATFORM_DASHBOARD_URLS`。25 条新回归锁先红后绿 |
| 素材来源定性（本次关键） | PASS | 头条旧值 `mp.toutiao.com` 实测 200 → `profile_v4` 是**头条号创作后台**，属「发布目的地放进了素材来源」的**分类错误**，不是链接过期。改 `PLATFORM_DASHBOARD_URLS` 会连带破坏 `http-login-checker.js` 登录态校验与 `Accounts.vue` 创作者中心入口 ⇒ 新开表是唯一安全解 |
| 取证边界如实记录 | PASS | 微博 `s.weibo.com/**` 全系 302 → `passport.weibo.com`（服务端强制登录墙），换 URL **不改登录要求**，已写进代码注释防后续误判；知乎 `/hot` 403 是反爬（裸首页同 403），免登录性**未证实**；头条 `/hot/` 实测 404、`hot-event/hot-board` 缺 `origin` 参数报 `parameter err` |
| 行数台账（零容差） | PASS | `Collection.vue` 被 targets 点名 **2920 行、容差 0**。最终 2920 行、净增 0：新逻辑全部收入独立组件（Tab/Panel/useSourceEntry/composable），主文件只付 3 行 import + 标签/按钮/面板挂载，并通过删除内嵌草稿区块腾挪。`node .github/scripts/check-max-lines.js` → ✅ |
| i18n 成对 | PASS | zh/en 各新增 22 条；`node .github/scripts/check-locale-sync.js --keys` → PASS（1890 个使用中 key 均存在） |
| 测试 | PASS | `Collection.test.js` 119 全绿（按新契约更新 16 条）；新增 `useCollectionDrafts.test.js` 17 条、`useSourceEntry.test.js` 8 条；`packages/shared-utils` 全量 41 文件 844 用例全过 |
| 顺带修复的竞态 | PASS | `createFromItem` 原为同步函数调用 async `createFromCollected`，造成「已保存但没跳转」。改 async 并 await，用例锁住 push 必达 |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`，纯渲染层 + shared-utils 数据导出 |
| QM-4 视觉 | N/A | 复用既有 `cohere-card` / `EmptyState` / `collection-tab-btn` 样式，无新增视觉体系；按「网页生产任务只保编译与冒烟」口径，未做额外视觉校验 |
| 远程同步 | PENDING | 待 PR 合并后回填 merge SHA 并销账 |

### 遗留（不假装已闭合）

- **知乎 `/hot` 免登录性未证实**：抓取器 403 是反爬拦截，真人浏览器是否免登录需上线前人工开一次确认。
- **微博登录墙不可绕过**：`s.weibo.com/**` 全系 302 到登录，换 URL 只改变「登录后看到热搜榜还是信息流」。已写进 `useSourceEntry.js` 与 `platform-definitions.js` 注释，避免后续被误判为「链接配错」而反复改。
- **头条热榜是 JSON 接口形态**：`hot-event/hot-board/?origin=toutiao_pc` 在浏览器里呈现为 JSON 而非渲染页；`/hot/` 已实测 404。若产品期望可视化热榜页，需后续另寻页面。
- **编辑与发布跳同一路由**：`/publish?draft=<id>` 两者相同，是否拆分为「编辑直达表单 / 发布直达选平台」待定。
- **历史脏数据未迁移**：存量中同时含 `createdAt` 与 `created_at` 的草稿靠读取侧 `resolveCreatedAt` 兼容，未做一次性数据固化（固化会改动用户存储，超出本次范围）。
