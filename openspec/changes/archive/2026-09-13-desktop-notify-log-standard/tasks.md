# 实现任务清单（desktop-notify-log-standard）

> 依据：`01-docs/ARCH-notify-log-standard.md`（CCG 评审后修订版）。运行时改动（apps/desktop）在隔离 worktree 进行，文案 zh/en 成对（CI Gate 7）。

## Phase 0：契约层落地（中风险，需逐模式回归）

- [ ] 0.1 新建 `src/utils/message-contract.js`：`MESSAGE_KEYS`（引用现有枚举）+ `ERROR_NORMALIZE_RULES` 共享规则表 + `errorCategory` 映射
- [ ] 0.2 语义重叠模式（quota_exceeded/rate_limited/compose_timeout/compose_duration_exceeded/needs_user_input）收敛为单一规范正则
- [ ] 0.3 单元测试 `message-contract.test.js`：key 唯一性 + 形态统一 + 共享规则表逐模式行为回归断言（合并前 vs 合并后）
- 验收：语义重叠收敛 + 逐模式回归通过；既有测试全通过

## Phase 1：通知通道 + 日志关联（核心样板）

- [ ] 1.1 新建 `notifyCore` 纯函数核心 + `useNotify.js` composable 薄封装
- [ ] 1.2 新建主进程 `notify:log` IPC（C2：sender/level/白名单复验/换行消毒/速率限制）
- [ ] 1.3 新增 `logger.notify()` 结构化日志行 + 级别映射表 + 高频节流/聚合
- [ ] 1.4 renderer 全局错误钩子（onerror/unhandledrejection/Vue errorHandler）→ notify:log
- [ ] 1.5 keyword-spike 主进程源头写日志 + renderer 不重复上报 + ready 握手
- [ ] 1.6 试点模块 `useBatchPublish.js` 全量迁移（ElMessage + 进度列表硬编码入 locales）
- [ ] 1.7 集成测试：notify() → 日志出现 messageKey 行；脱敏生效；渲染失败不影响主流程；换行注入被拦截
- 验收：A3、A5 达成；试点模块 ElMessage 归零 + 进度文案入 locales

## Phase 2：存量批量迁移（按模块分批）

- [ ] 2.1 迁移 usePublishFlow → useProviderCrud → useModelProviderCrud → useLoginGate → usePublishDrafts
- [ ] 2.2 迁移 useVideoClone → useFilmEngineering → useOpsCenterSync
- [ ] 2.3 迁移视图层（Accounts/Collection/Publish/Monitor/Intelligence）
- [ ] 2.4 非 toast 文案（进度列表/内联状态）走 locales + 组件内 i18n 渲染，纳入 A1/A2
- 验收：A1、A2 逐步达成，每批 CI 绿

## Phase 3：CI / lint 强化（防回退）

- [ ] 3.1 lint 规则：src/ 非通道封装文件禁止 import ElMessage / 直接 ElMessage.*('字面量')
- [ ] 3.2 CI 基线扫描扩展：存量中文字面量清零进度纳入检查
- 验收：A2 由人工巡检升级为机器强制

## Phase 4：show-notification 收敛 + 文档收尾

- [ ] 4.1 删除 `show-notification` IPC handler + `showNotification` preload；更新 access-control/license-access-control 白名单 + preload.test.js
- [ ] 4.2 更新 AGENTS.md QM-2 增加「通知必须经 notify() + 必须可日志检索」检查项
- [ ] 4.3 更新 01-docs/i18n-glossary.md 产品名词增量
- [ ] 4.4 全量回归 + 视觉回归（QM-4）+ QM-1 打包验证
- 验收：A1-A6 全部达成

## 门禁与交付

- [ ] 5.1 全量测试（基线 1830 passed 不倒退）+ 契约测试
- [ ] 5.2 中英双语手动验收
- [ ] 5.3 openspec archive 三同步（openspec archive + CCG task 归档 + 质量节拍复盘）