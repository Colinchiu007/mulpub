## Context

现有电影工程 IPC 通道由 withSenderCheck 和本地 withKit 组合包装。Electron 调用 handler 时，第一个参数始终是 event；带参数的内部 handler 也遵循 event-first 签名，但 withKit 当前只转发业务参数，使参数化通道发生位置错位。无参数查询通道不会暴露这个缺陷，因此必须用真实带参数调用覆盖。

## Goals / Non-Goals

**Goals:**

- 让 withKit 保留 IPC event 并按原顺序转发业务参数。
- 用回归测试覆盖页面首屏使用的 list-shots 以及其它同步参数化通道。
- 保持现有 sender 检查、业务校验、错误信封和异步通道行为不变。

**Non-Goals:**

- 不重构通用 IPC helper，不改变 preload API。
- 不改电影工程生成 provider 参数或数据资产；对前端交互仅修真实 E2E 暴露的详情抽屉与 IPC 纯 JSON 负载问题。
- 不把 E2E 使用的离线占位图生成当作人工可接受的 AI 图片产物。
- 不放宽任何输入校验或 sender 白名单。

## Decisions

### 保留统一的 event-first handler 契约

将 withKit 改为调用 fn(event, ...args)。这与 Electron handler 和 withSenderCheck 的既有契约一致，也能一次修复 list-shots、get-shot、复制和导出等所有同步参数化通道。

备选方案是逐个删除内部 handler 的第一个参数。这会让当前通道暂时工作，但破坏项目统一的 IPC handler 形状，并且新增通道仍容易重复同一错误，因此不采用。

### 以合法参数转发测试锁定边界

在 IPC 契约测试中用受信 sender 调用 list-shots、get-shot、copy-text 和 export，断言 service 收到的参数及规范化结果。现有非法入参和 sender 拒绝测试继续保留，形成成功与拒绝两侧的保护。

## Risks / Trade-offs

- [风险] 包装器修复会让此前被错误吞掉的参数化通道真正进入业务逻辑 → [缓解] 只恢复原始参数位置，不改业务校验；新增合法参数断言并运行现有全套电影工程 IPC 测试。
- [风险] 某些 service mock 可能错误依赖旧的参数错位行为 → [缓解] 只更新本次受影响测试的真实契约断言，不添加兼容分支。

## Migration Plan

1. 先运行新增回归测试确认旧实现失败。
2. 修改 withKit 的单点参数转发并运行电影工程 IPC 测试。
3. 运行静态检查、相关 renderer composable 测试和 Electron 构建门禁。
4. 若需要回滚，回退该单点包装器修改即可，不涉及数据迁移。
5. 用真实打包 Electron E2E 覆盖入口、分镜详情、复制、导出、剧本套用、方法论和生成入口，确认无参数校验/克隆错误，并保存截图与日志证据。
