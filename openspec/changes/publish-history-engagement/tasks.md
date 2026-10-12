# 任务：发布记录页作品互动数据回流（publish-history-engagement）

> 状态标记：`[x]` 已完成并附证据；`[ ]` 未完成。判据一律取产物，不取「命令返回成功」。

## 1. 规划与文档（先文档再代码）

- [x] 1.1 现状勘察：三层断链定位 + 68 条真实记录可点性实测（10/68）+ 竞品逆向调研
      —— `01-docs/PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12.md` §1
- [x] 1.2 PRD 定稿（含数据校验 V1–V15、流程、功能逻辑、交互逻辑、显示项、提示文字、验收标准、
      残余限制）—— 同上
- [x] 1.3 openspec change 五件套（proposal / design / tasks / spec）—— 本目录
- [x] 1.4 用户已确认两项关键取舍：走创作者后台 API、允许使用已保存账号 Cookie

## 2. 主进程采集服务（TDD）

- [x] 2.1 `account-metrics/constants.js`：配置真源 + env 覆盖（非法值回落默认并出声）
- [x] 2.2 `account-metrics/throttle.js`：页间抖动 / UTC 日额度 / 连续失败熔断（纯逻辑）
      —— `throttle.test.js` 8 例
- [x] 2.3 `account-metrics/adapters.js`：小红书 / 抖音 / 快手 / 头条四平台适配器
      —— `adapters.test.js` 24 例；含「平台无该字段落 null」「结构不符抛错」「无 postId 丢弃」
- [x] 2.4 `account-metrics/link.js`：三级归因（一级精确 / 二级标题+时间唯一才认）
      —— `link.test.js` 17 例；含歧义留空、跨平台隔离、去重
- [x] 2.5 `account-metrics/http.js`：最小传输层（超时、失败返状态码不抛错、日志不落 Cookie）
- [x] 2.6 `account-metrics/signer-bridge.js`：签名器适配（fail-closed，签不出即 unsupported）
- [x] 2.7 `account-metrics/index.js`：编排（前置门禁 / 分页节流 / 归因落盘 / 调度）
      —— `index.test.js` 25 例

## 3. 存储层（TDD，真 sqlite）

- [x] 3.1 `store/account-metrics-store.js`：`getHistoryMetricsByTaskIds`（修 D1/D2）、
      `applyAccountSyncLinks`（幂等写 + 只补空值回填）、`getLatestSnapshotsForTrackedIds`、
      采集状态读写 —— `account-metrics-store.test.js` 22 例
- [x] 3.2 注册进 `store/index.js` mixin 链

## 4. IPC / preload / 渲染 API

- [x] 4.1 `ipc-handlers/performance-loop.js` 新增三通道（全部带 `withSenderCheck`）
      —— `performance-loop.test.js` 新增 9 例
- [x] 4.2 `preload/knowledge-library.js` 暴露三方法 + `pnpm run build:preload` 重建两个 bundle
- [x] 4.3 `src/api/knowledge-library.js` 三个封装 + 结构完整兜底信封

## 5. 接线与调度

- [x] 5.1 `core/register-engagement-services.js`：三服务装配外移（同时守住 500 行门禁）
- [x] 5.2 `core/container.setup.js` + `bootstrap/phase1-context.js` + `bootstrap/phase5-ipc.js` 接线
- [x] 5.3 `bootstrap.js`：注入归属解析器（三态：串 / null / undefined）+ 启动调度器

## 6. 渲染层

- [x] 6.1 `composables/usePublishHistoryMetrics.js`：取数 / 四类空态 / 刷新 / 数据截至 / 手动录入
      —— `usePublishHistoryMetrics.test.js` 14 例
- [x] 6.2 `views/PublishHistory.vue` 接入（**净减 13 行**：1393 → 1380，守零增长容差）
      —— `publish-history-metrics.test.js` 11 例
- [x] 6.3 `composables/usePublishHistoryContentLink.js`：草稿语义（`result.draft`）
- [x] 6.4 locale `history-page/{zh,en}.js` 15 键成对新增

## 7. 门禁与验证

- [x] 7.1 定向测试全绿（`account-metrics` + store + IPC + preload 契约 + 渲染层）
- [x] 7.2 行数门禁 `check-max-lines.js` ✅（`PublishHistory.vue` 1380 ≤ 1394 目标；无新增超大文件）
- [x] 7.3 locale 门禁 `check-locale-sync.js --cjk/--keys` PASS
- [ ] 7.4 QM-1 本地打包（`electron-builder --win --x64`）+ asar 清单 + 启动 8 秒无 stderr
- [ ] 7.5 QM-6 双模型评审 + findings 回写 `.quality-gates.md`
- [ ] 7.6 反证矩阵实跑（M1–M9，见 PRD §7.2）

## 8. 记忆与收尾

- [ ] 8.1 外部记忆：`01-docs/learnings.md` 置顶追加
- [ ] 8.2 内部记忆：`.agent_context/publish-history-engagement.md`
- [ ] 8.3 gstack `learnings.jsonl` 追加
- [ ] 8.4 EverOS：add + flush + **落盘产物 grep 哨兵词**（判据取产物，不取接口应答）
- [ ] 8.5 CHANGELOG 前插 + `.quality-gates.md` 记录 + `openspec/records/publish-history-engagement.md`
- [ ] 8.6 PR 创建 → CI 全绿 → squash 自动合并 → 回填远程同步 + 清账 → worktree 清理
