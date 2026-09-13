## ADDED Requirements

### Requirement: messageKey 契约
系统 SHALL 维护一套稳定的 `messageKey` 枚举作为「用户文案 ↔ 错误分类 ↔ 日志」的唯一关联键，并配套共享错误归一化规则表。

#### Scenario: 已知 messageKey 解析
- **WHEN** 通知携带已知 `messageKey`
- **THEN** 系统按该 key 从 locales 解析用户文案，并记录日志

#### Scenario: 未知 messageKey 兜底
- **WHEN** 通知携带未知 `messageKey`
- **THEN** 系统归入 `operation_failed` 兜底文案，且日志侧拒绝该未知 key（静默 drop + 计数）

#### Scenario: key 唯一性
- **WHEN** 契约层加载 messageKey 枚举
- **THEN** 校验所有 key 唯一且形态统一（`namespace.key` 小写点分），重复或形态异常即失败

### Requirement: errorCategory 跨模块关联
系统 SHALL 提供独立于文案 key 的稳定 `errorCategory`，作为跨模块错误关联键，同一语义错误在不同命名空间的多个 messageKey 映射到同一 `errorCategory`。

#### Scenario: 跨命名空间检索
- **WHEN** 同一错误（如 quota_exceeded）在 `userErrors.*` 与 `story2video.*` 各有一个 messageKey
- **THEN** 两者映射到同一 `errorCategory`，日志行同时记录 messageKey 与 errorCategory，可按 errorCategory 跨模块检索

### Requirement: 统一通知通道
系统 SHALL 提供统一通知入口 `notifyCore`（纯函数核心）+ `useNotify`（composable 薄封装），所有 UI 通知（提示/警告/成功/错误/确认）统一经此发出，禁止组件直接 import `ElMessage`。

#### Scenario: 通知渲染
- **WHEN** 调用 `notify({ messageKey, level, module, params })`
- **THEN** 按 level 渲染 ElMessage/ElMessageBox，并上报日志

#### Scenario: 渲染失败不影响主流程
- **WHEN** 通知渲染或 IPC 上报失败
- **THEN** 静默降级，不影响业务主流程

#### Scenario: 非组件上下文调用
- **WHEN** 纯工具函数（非 Vue 组件）需要发通知
- **THEN** 可直接调用 `notifyCore`，不依赖 Vue 上下文

### Requirement: 通知日志关联
系统 SHALL 使每条经通知通道的通知产生一条含 `messageKey` 的结构化日志行，可按 messageKey 精确检索。

#### Scenario: 结构化日志行
- **WHEN** 通知经通道发出
- **THEN** 主进程写入 `[NOTIFY] [module] [messageKey] {meta}` 结构化行，meta 含 errorCategory 与白名单 params，module 仅在前缀不重复

#### Scenario: 级别映射
- **WHEN** 通知 level 为 success/info/warning/error/confirm
- **THEN** 映射为 logger 级别（success→INFO、info→INFO、warning→WARN、error→ERROR、confirm→INFO 或可选不记）

#### Scenario: 高频通知节流
- **WHEN** 批量场景高频触发同 key 成功通知
- **THEN** 做节流/聚合（如 10s 窗口同 key 合并计数），避免日志洪泛

### Requirement: 敏感信息双向脱敏
系统 SHALL 守住「用户文案 ≠ 技术日志」边界：用户文案不含原始 secret/技术文本，日志侧对 params 与 error 做双层脱敏。

#### Scenario: 用户文案无技术文本
- **WHEN** 用户文案插值前 params 值命中技术文本特征（通道名/错误码/IP:端口）
- **THEN** 回退兜底文案，不把技术细节暴露给用户

#### Scenario: 日志双层脱敏
- **WHEN** params 字段值或 error 落盘
- **THEN** 主进程做值级 deny-list：类型约束（仅 string/number/boolean，拒绝嵌套 object/array）+ `redactText` + 技术文本检测 + 长度截断

#### Scenario: 换行注入拦截
- **WHEN** params 或 error 含换行/控制符
- **THEN** 统一 JSON.stringify 进 meta 段并转义，杜绝 log injection

### Requirement: notify:log 主进程校验
系统 SHALL 在 `notify:log` IPC 主进程侧强制校验，不信任 renderer 传入内容。

#### Scenario: sender 校验
- **WHEN** renderer 调用 notify:log
- **THEN** 按 QM-2 校验 sender 的 file:// canonical 边界，拒绝非受信来源

#### Scenario: level 白名单
- **WHEN** 传入 level 非 {info, warn, error}
- **THEN** 拒绝，防止 level 注入日志前缀

#### Scenario: 速率限制
- **WHEN** 单窗口内高频调用 notify:log
- **THEN** 超限降级为聚合计数日志，防止日志洪泛

### Requirement: renderer 崩溃日志
系统 SHALL 捕获 renderer 未捕获异常并记录结构化日志，覆盖崩溃/白屏场景。

#### Scenario: 全局错误钩子
- **WHEN** window.onerror / unhandledrejection / Vue errorHandler 触发
- **THEN** 转发 notify:log（level=error，messageKey=renderer.uncaught_error，error 脱敏入日志）

### Requirement: show-notification 收敛
系统 SHALL 将半成品 `show-notification` 通道收敛并入统一通知通道，不保留独立双通道。

#### Scenario: 清理死通道
- **WHEN** 迁移完成
- **THEN** `show-notification` IPC handler 删除，`showNotification` preload 删除，access-control/license-access-control 白名单同步更新

#### Scenario: 主进程主动推送
- **WHEN** 主进程主动推送（如 keyword-spike）
- **THEN** 主进程源头直接写结构化日志，再发事件给 renderer 仅做 UI 渲染，renderer 不重复上报

### Requirement: 存量文案迁移
系统 SHALL 将存量硬编码中文文案分批迁移到 locales（zh/en 成对），非 toast 用户可见文案（进度列表/内联状态）走 locales + 组件内 i18n 渲染。

#### Scenario: 试点模块迁移
- **WHEN** 迁移 useBatchPublish
- **THEN** ElMessage 调用归零 + 进度列表硬编码文案入 locales，测试断言文案不变

#### Scenario: CI 防回退
- **WHEN** 新增/修改用户可见文案
- **THEN** 必须写入 locales（zh/en 成对），渲染端非 locales 文件无新增中文字面量（CI Gate 7 拦截）

### Requirement: 共享归一化规则表
系统 SHALL 将语义重叠的错误归一化模式收敛为单一规范正则，逐模式行为回归断言通过。

#### Scenario: 语义收敛
- **WHEN** 语义相同的错误（quota_exceeded/rate_limited/compose_timeout 等）在多个 formatter 存在
- **THEN** 收敛为单一规范正则，各模块引用共享表，接受行为变更并逐模式回归

#### Scenario: 独有模式保留
- **WHEN** 某模块独有的业务模式（如 story2video 的 VOICE_INVALID、scene 系列）
- **THEN** 保留在各自命名空间，不进共享表