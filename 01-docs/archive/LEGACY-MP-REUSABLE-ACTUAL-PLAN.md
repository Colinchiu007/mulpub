# 参考产品可复用技术落地 — 真实方案

> ## 🗄️ LEGACY — 已归档，**不得作为现行依据**（归档于 2026-10-13）
>
> 本文件是**旧的复用规划产物**（原日期：2026-09-11），已被本轮逆向研究的成果文档取代：
> - [RESEARCH-COMPETITOR-REVERSE-2026-10-13.md](../RESEARCH-COMPETITOR-REVERSE-2026-10-13.md) — 本轮逆向研究成果总览
> - [REUSE-CATALOG-2026-10-13.md](../REUSE-CATALOG-2026-10-13.md) — 可复用资产总目录（含 mulpub 代码现状核实）
> - [ARCH-REUSE-INTEGRATION-2026-10-13.md](../ARCH-REUSE-INTEGRATION-2026-10-13.md) — 集成设计与详细实现方案
> - [PLAN-REUSE-ROLLOUT-2026-10-13.md](../PLAN-REUSE-ROLLOUT-2026-10-13.md) — 分阶段实施计划
>
> **为什么归档**：该次审计的**更正产物**（价值在于记录了「先核实代码再写计划」这条教训）。**执行状态**：Task 1 已落地（`apps/desktop/electron/services/rpa-view-manager.js:24-25` 已桥接 `CancelToken`）；Task 2（IPC 参数校验中间件 `ipc-handlers/validate.js`）**未落地**。
>
> **使用指引**：可作历史演进参考；**任何「待做项 / 缺口 / 计划」的结论一律以取代文档为准** ——
> 本项目已有一次教训：旧方案假设 7 项缺失，实测 6 项本就存在（见 `LEGACY-MP-REUSABLE-ACTUAL-PLAN.md`）。

---


> 基于代码审计 2026-09-11 | Worktree: mp-reusable-impl

## 审计结论

原方案假设 7 项 "缺失项"，实际审计发现 6 项已存在于代码库：

| 模块 | 位置 | 状态 |
|------|------|------|
| `CancelToken` | `packages/api-publish-engine/src/cancel-token.js` | ✅ 已存在 |
| `ProgressEmitter` (双通道) | `packages/api-publish-engine/src/progress-emitter.js` | ✅ 已存在 |
| `BasePlatformAdapter.execute()` | `packages/api-publish-engine/src/base-adapter.js` | ✅ 已存在 |
| `createProxyAgent` | `packages/api-publish-engine/src/proxy-manager.js` | ✅ 已存在 |
| `TaskPool` | `packages/api-publish-engine/src/task-pool.js` | ✅ 已存在 |
| `withRetry` + 熔断器 | `packages/api-publish-engine/src/retry-middleware.js` | ✅ 已存在 |
| `RichTextProcessor` | `packages/api-publish-engine/src/rich-text-processor.js` | ✅ 已存在 |
| `ProgressThrottle` | `apps/desktop/electron/services/rpa-progress-throttle.js` | ✅ 已存在 |

**问题是**：这些组件存在于 `api-publish-engine` 包中，但 Electron RPA 引擎（`rpa-view-manager.js`）**没有使用它们**。它在内部有自己的简化版 cancel（仅 `win.destroy()`）和进度上报（内联 emit）。

## 真实缺口

1. **`rpa-view-manager.js` 未桥接 `api-publish-engine` 的成熟组件** — CancelToken / ProgressEmitter / withRetry
2. **IPC handler 参数校验全是手写** — 没有 zod 统一入口，分布在 52 个 handler 中

## 实战方案

### Task 1: rpa-view-manager.js 桥接 api-publish-engine 组件

**文件**: `apps/desktop/electron/services/rpa-view-manager.js`

将现有的 `cancel()` 方法升级为接收外部 `CancelToken`，将现有的内联 `_emitProgress` 对接 `ProgressEmitter`：

```javascript
const { CancelToken, ProgressEmitter } = require('@multi-publish/api-publish-engine/src/base-adapter')

// 替代: win.destroy() → cancelToken.cancel()
// 替代: _emitProgress() → progress.setStatus() / progress.setProgress()
```

不改变现有公共 API 签名，仅内部实现升级。

### Task 2: IPC 校验中间件

**文件**: `apps/desktop/electron/ipc-handlers/validate.js`

```javascript
// 不使用 zod（避免引入新依赖），沿用现有 helpers.js 的 withSenderCheck 风格
function withArgCheck(fn, checks) {
  return (event, arg) => {
    for (const [i, check] of checks.entries()) {
      if (check === 'object' && (!arg || typeof arg !== 'object')) 
        return { code: -1, message: '参数必须是对象' }
      if (check === 'string' && typeof arg !== 'string')
        return { code: -1, message: '参数必须是字符串' }
      if (check === 'array' && !Array.isArray(arg))
        return { code: -1, message: '参数必须是数组' }
    }
    return fn(event, arg)
  }
}
```

**验收**: 接入至少 3 个高频 IPC handler，测试校验拒绝非法参数时返回稳定错误合同而非 crash。

### Task 3: 文档更新

更新 PRD 反映审计结论——复用项实际状态。
