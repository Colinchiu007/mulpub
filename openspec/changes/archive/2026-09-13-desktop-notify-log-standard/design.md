## Context

桌面应用通知/错误文案碎片化 + 与日志隔离。方案文档 `01-docs/ARCH-notify-log-standard.md` 经 CCG 双模型评审（架构 + 安全/可观测性），C1-C3 CRITICAL 修复要求已并入正文。本 design 把已确认的分析结论固化为实现层设计。

## Goals / Non-Goals

**Goals:**
- 统一 messageKey 契约 + errorCategory 跨模块关联
- 统一通知通道 notifyCore + useNotify，所有 UI 通知经此发出
- 通知↔日志关联：每条通知一条结构化日志行，可按 messageKey/errorCategory 检索
- 敏感信息双向脱敏（用户文案无技术文本，日志双层脱敏）
- notify:log 主进程侧强制校验（sender/level/白名单/换行/速率）
- renderer 崩溃日志覆盖
- show-notification 死通道收敛
- 存量硬编码文案分批迁移到 locales

**Non-Goals:**
- 不合并三个 formatter 成巨型单文件（story2video-notifications 保留命名空间）
- 不把技术细节暴露进用户文案
- 不重命名既有 `story2video.*` key
- 不涉及 ops-center / API 服务端日志（桌面端先行）
- 不引入数据库/第三方服务

## Decisions

**D1: 通知通道形态 — composable + 纯函数核心**
- `notifyCore` 纯函数核心（不依赖 Vue，负责解析文案 + 组装日志 payload）
- `useNotify` composable 薄封装（注入 i18n.global + 渲染）
- 纯函数核心使非组件上下文可调用

**D2: show-notification 收敛并入统一通道**
- 死通道（主进程发、renderer 无消费方）并入 notify 通道
- 主进程主动推送（keyword-spike）源头写日志 + renderer 只渲染不重复上报

**D3: 日志关联 — messageKey + errorCategory 双键**
- messageKey 定位文案，errorCategory 跨模块检索
- 日志行 `[NOTIFY] [module] [messageKey] {meta}`，meta 含 errorCategory + 白名单 params

**D4: 敏感信息双层防线**
- 第一层 renderer 字段名白名单
- 第二层主进程值级 deny-list（类型约束 + redactText + 技术文本检测 + 长度截断 + 换行消毒）

**D5: notify:log 主进程强制校验**
- sender 校验（QM-2 file URL canonical）
- messageKey/level 白名单
- 速率限制

**D6: 共享规则表 — 真收敛**
- 语义重叠模式收敛为单一规范正则，接受行为变更 + 逐模式回归
- 独有业务模式保留各自命名空间

## Risks / Trade-offs

- [语义收敛行为变更] → 逐模式行为回归断言，接受变更但必须验证
- [迁移文案措辞被改] → 迁移时断言 formatUserError/既有文案输出不变
- [误把 secret 写进 params] → 双层防线 + A5 回归（白名单字段值含 secret/嵌套对象/换行/IP:端口 四类场景）
- [日志量增大] → NOTIFY 行走 INFO/WARN，LOG_LEVEL 控制，高频通知节流/聚合
- [renderer 崩溃无日志] → 全局错误钩子兜底
- [keyword-spike 日志闭环依赖 renderer] → 主进程源头记日志，不依赖 renderer 存活

## Open Questions

- `logger.notify()` 方法形态（新增方法 vs 复用 log 三参）——实现阶段定
- 多窗口/主窗口最小化兜底策略
- keyword-spike 无窗口降级策略（系统 Notification vs 丢弃）