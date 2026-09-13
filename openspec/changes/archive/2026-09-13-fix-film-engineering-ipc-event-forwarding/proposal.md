## Why

进入“视频创作 → 电影工程”时，页面会自动加载第一个场景的分镜，但参数化 IPC 包装器丢失了 Electron 的 event 参数，导致合法 sceneId 被判定为空并显示通用校验错误。这个问题阻断了电影工程的首屏使用，需要在继续扩展该流水线前修正参数转发边界。

## What Changes

- 修正电影工程同步 IPC 包装器，使内部 handler 收到原始 event 及保持顺序的业务参数。
- 增加参数化查询、复制和导出通道的合法入参回归测试。
- 修复点击分镜后详情抽屉未打开的真实交互缺陷。
- 修复导出/生成选中分镜时响应式代理导致 IPC “An object could not be cloned”的问题。
- 新增打包 Electron 真实 E2E 脚本，覆盖电影工程主要功能。
- 保留现有 sender 校验、空值校验、数量上限和错误码行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- film-engineering：参数化 IPC 通道必须在安全校验后正确转发合法业务参数。

## Impact

- 影响 apps/desktop/electron/ipc-handlers/film-engineering.js 及其 IPC 契约测试。
- 不新增依赖，不改变 preload API 或电影工程数据格式；对渲染层的详情抽屉与 IPC 负载形态做最小修复。
- 变更限定在电影工程 IPC、composable、视图交互及对应测试；其余流水线不经过这些路径。
