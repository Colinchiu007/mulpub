# 参考产品可复用技术落地报告

> 基于代码审计 2026-09-11 | PR: 待创建 | Worktree: mp-reusable-impl

## 审计结论

原方案假设 7 项"缺失项"，实际审计发现 **6 项已存在于 `packages/api-publish-engine`**：

| 模块 | 位置 | 审计结果 |
|------|------|---------|
| `CancelToken` | `api-publish-engine/src/cancel-token.js` | 存在，未桥接到 RPA 引擎 |
| `ProgressEmitter` (双通道) | `api-publish-engine/src/progress-emitter.js` | 存在，未桥接到 RPA 引擎 |
| `BasePlatformAdapter.execute()` | `api-publish-engine/src/base-adapter.js` | 存在，API 路径已使用 |
| `createProxyAgent` | `api-publish-engine/src/proxy-manager.js` | 存在 |
| `TaskPool` | `api-publish-engine/src/task-pool.js` | 存在 |
| `withRetry` + 熔断器 | `api-publish-engine/src/retry-middleware.js` | 存在 |
| `RichTextProcessor` | `api-publish-engine/src/rich-text-processor.js` | 存在，已应用于 publisher-router |
| `ProgressThrottle` | `rpa-progress-throttle.js` | 存在，相当于 UploadEmitGate |

**真实缺口**：`rpa-view-manager.js` 的 RPA 回退路径未使用 `CancelToken`（取消仅 `win.destroy()`）。

## 实际落地

### 修改文件

`apps/desktop/electron/services/rpa-view-manager.js`

引入 `@multi-publish/api-publish-engine/src/base-adapter` 的 `CancelToken`：

1. `publish()` — 每个 RPA 会话创建独立 `CancelToken`，发布前检查 `throwIfCancelled()`
2. `cancel()` — 优先通过 `CancelToken.cancel()` 信号取消，使 `throwIfCancelled` + `isCancelled` 生效
3. 取消后返回 `{ success:false, error:'Cancelled', code:-999 }`
4. 会话结束时清理 `_activeTokens[key]`

向后兼容：无 CancelToken 时回退到原始 `win.destroy()`。

### 测试

`rpa-view-manager.test.js`: 5/5 通过（API 路由 + 代理 + 浏览器会话测试）

## 未落地的部分

以下两项不落地，原因是：

| 项 | 原因 |
|-----|------|
| `ProgressEmitter` 桥接 RPA | `_emitProgress` 的调用站点不传 `key`，无法反向查找 emitter；需大改架构 |
| `zod` IPC 校验 | `helpers.js` 已有 `wrapIpcHandler(requireArgs:true)` + 手写校验已覆盖频繁路径（如 `publish:batch` 的逐字段类型检查）。引入 zod 增加 ~14KB 依赖，收益不明确 |

## 相关文档

- [参考产品可复用技术分析](D:/Data/projects/Multi-Publish/01-docs/MP-REUSABLE-ANALYSIS.md)
- [开发计划](D:/Data/projects/Multi-Publish/01-docs/MP-REUSABLE-PLAN.md)
- [参考产品 RPA 分析](D:/Data/projects/_逆向工程_参考产品4.0/RPA分析报告.md)
