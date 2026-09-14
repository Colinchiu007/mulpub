# 参考产品可复用技术落地开发计划

> 基于 [可复用分析报告](D:/Data/projects/Multi-Publish/01-docs/MP-REUSABLE-ANALYSIS.md)
> 创建日期: 2026-09-11 | 状态: 待确认

## 总目标

将参考产品 4.0 逆向分析中识别的 5 项可复用设计模式，分 3 个阶段移植到 Multi-Publish 的 `packages/rpa-engine`，补齐发布引擎的进度上报规范、取消机制、上传重试和参数校验能力。

---

## Phase 1: 基础设施层（P0）

**目标**：建立统一的进度上报、取消机制、上传重试基础设施。不修改现有平台适配器行为。

### Task 1.1 — 创建 `UploadEmitGate` 上传进度门控

**文件**: `packages/rpa-engine/src/core/upload-emit-gate.js`

**功能**:
- 大文件（>100MB）: 5 秒时间门控，避免高频进度刷新
- 小文件: 每 10% 变化上报一次
- 构造函数接收 `fileSize`、`totalParts`
- `shouldEmit(currentPart): boolean`

**测试**: `upload-emit-gate.test.js`
- 大文件 400MB/2 片 → 首次 emit，2 秒后不 emit
- 小文件 10MB/20 片 → 0% emit，5% 不 emit，10% emit
- 边界: 空文件、单分片、最后一片强制 emit

**验收**: 6 个测试用例全部通过

### Task 1.2 — 创建 `CancelToken` 可取消任务令牌

**文件**: `packages/rpa-engine/src/core/cancel-token.js`

**功能**:
- `cancel(reason)` — 标记取消
- `throwIfCancelled(key)` — 检查并抛出 `CancelError`
- `disable(key)` — 完成后的清理阶段禁用取消检查
- `reset()` — 重置状态
- `isCancelled` — 只读属性

**测试**: `cancel-token.test.js`
- 取消后 throwIfCancelled 抛出 CancelError
- disable 后 throwIfCancelled 不抛异常
- reset 后恢复初始状态
- 多次取消幂等

**验收**: 5 个测试用例全部通过

### Task 1.3 — 创建 `ProgressReporter` 进度上报双通道

**文件**: `packages/rpa-engine/src/core/progress-reporter.js`

**功能**:
- `reportPercent(percent: 0-100, message: string, taskId?: string)` — 百分比通道
- `reportStatus(status: string, message: string, taskId?: string)` — 状态通道
- `percent` 自动钳制 [0, 100]
- 与现有 `pipeline:update` IPC 事件对齐

**测试**: `progress-reporter.test.js`
- 百分比钳制（-1→0，150→100）
- 状态枚举（init/uploading/uploadSuccess/uploadFail/pushing/pushSuccess/pushFail）
- taskId 透传到 IPC 载荷

**验收**: 5 个测试用例全部通过

### Task 1.4 — 创建 `uploadWithRetry` 通用重试上传

**文件**: `packages/rpa-engine/src/core/upload-with-retry.js`

**功能**:
- `maxRetries = 3`，`retryDelay = 2000ms`
- 支持 `CancelToken` 注入
- 成功后检查 `result.success !== false`
- 自动 `delay(retryDelay)` 后重试

**测试**: `upload-with-retry.test.js`
- 一次成功（无重试）
- 第一次失败第二次成功
- 超过 maxRetries 后抛出
- CancelToken 中途取消终止重试

**验收**: 4 个测试用例全部通过

### Phase 1 门禁

```
□ upload-emit-gate.test.js: 6/6 通过
□ cancel-token.test.js: 5/5 通过
□ progress-reporter.test.js: 5/5 通过
□ upload-with-retry.test.js: 4/4 通过
□ 总计 20 个新测试
□ Vite 构建不引入新警告
□ 不影响现有 npm test 结果
```

---

## Phase 2: 适配器层统一（P0→P1）

**目标**：将 Phase 1 基础设施集成到各平台适配器基类，统一适配器写法。

### Task 2.1 — 创建 `PlatformPublisherBase` 基类

**文件**: `packages/rpa-engine/src/adapters/platform-publisher-base.js`

**功能**:
- 继承现有 `BaseAdapter`，新增模板方法 `execute(taskData, cookie, options)`
- `options = { cancelToken, proxyConfig, emitter }`
- 固定流程: 上传视频 → 封面上传 → 构建数据 → 发布 → 结果
- 子类必须实现: `uploadVideo()`, `uploadCover()`, `buildPostData()`, `publish()`
- 子类可选覆盖: `getHeaders()`, `getRefererHeaders()`

### Task 2.2 — 改造示例：抖音适配器

**文件**: `packages/rpa-engine/src/adapters/douyin.js`

**变更**:
- 继承 `PlatformPublisherBase` 替代 `BaseAdapter`
- 实现 `uploadVideo()`, `uploadCover()`, `buildPostData()`, `publish()`
- 移除分散的 `console.log` 进度上报，改用 `ProgressReporter`
- 上传改为 `uploadWithRetry` 替代手写重试

### Task 2.3 — 改造其余平台适配器（按优先级）

| 平台 | 当前状态 | 改造后 |
|------|---------|--------|
| 微信公众平台 (wechat_mp) | BaseAdapter | PlatformPublisherBase |
| 百家号 (baijiahao) | BaseAdapter | PlatformPublisherBase |
| 小红书 (xiaohongshu) | BaseAdapter | PlatformPublisherBase |
| 知乎 (zhihu) | 待实现 | PlatformPublisherBase |

### Phase 2 门禁

```
□ 抖音适配器测试: 进度/取消/重试 全路径覆盖
□ 至少 2 个平台适配器迁移完成
□ 回归: 现有 RPA 测试不退化
```

---

## Phase 3: 参数校验层（P1）

**目标**：引入 `zod` 统一 IPC handler 参数校验。

### Task 3.1 — 安装 zod

```bash
pnpm add zod --filter @multi-publish/rpa-engine
```

### Task 3.2 — 创建校验中间件

**文件**: `packages/rpa-engine/src/core/validate-ipc.js`

```javascript
import { z } from 'zod'

export function validateIPC(schema, handler) {
  return async (event, ...args) => {
    const result = schema.safeParse(args[0])
    if (!result.success) {
      return { code: -1, message: result.error.issues[0].message }
    }
    return handler(event, result.data, ...args.slice(1))
  }
}
```

### Task 3.3 — 改造核心 IPC handler

| Handler | Schema |
|---------|--------|
| `publishWechat` | `z.object({ platform: z.string(), content: z.object(...) })` |
| `accountCheckLogin` | `z.object({ platform: z.string(), accountId: z.string() })` |
| `pipelineStartOrchestrated` | `z.object({ name: z.string(), params: z.record(z.unknown()) })` |

### Phase 3 门禁

```
□ 至少 5 个 IPC handler 接入 zod 校验
□ 无效参数返回稳定错误合同（非 crash）
□ 不影响现有 IPC 测试
```

---

## Phase 4: 富文本转换层（P2）

**目标**：参考同类产品 `RichTextParser`，建立 Vue Quill 到各平台格式的中间转换层。

### Task 4.1 — 创建 `ContentAdapter` 基类

**文件**: `packages/rpa-engine/src/content/content-adapter.js`

**功能**:
- 接收 Vue Quill JSON delta
- 提取：纯文本、图片列表、话题标签、@提及
- 占位符替换 + 平台格式生成
- 子类覆盖：生成平台特定格式

### Task 4.2 — 示例：微信平台内容格式

**文件**: `packages/rpa-engine/src/content/wechat-content.js`

### Phase 4 门禁

```
□ 微信富文本转换: delta → 纯文本 / 图片映射
□ 至少 2 个平台的格式生成
```

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| BaseAdapter 已有 `execute()` 语义冲突 | 类名/方法名碰撞 | Phase 2 使用 `PlatformPublisherBase` 作为新类名，不修改现有 BaseAdapter |
| zod 增加包体积 | ~14KB gzip | 可以接受，RPA 引擎本身已带 axios/playwright-electron |
| 图片处理依赖 sharp | 跨平台兼容 | 参考产品的 `readImageData` 是纯 Node fs，不需要 sharp |
| 签名算法不完整 | douyin/kuaishou 的 `_signature`/`__NS_sig3` 在反编译产物中只标注存在 | 不作为本次目标，保持现有签名实现 |

---

## 里程碑与时间线

| 里程碑 | 内容 | 预计工作量 |
|--------|------|-----------|
| M1: 基础设施完成 | Phase 1 全部 4 个模块 | 1-2 会话 |
| M2: 第一个适配器上线 | 抖音适配器改造 + 真机验证 | 1 会话 |
| M3: 全平台适配器统一 | 所有平台适配器迁移 | 2-3 会话 |
| M4: zod 校验全量 | 所有 IPC handler 接入 | 1 会话 |
| M5: 富文本转换 | Phase 4 内容转换层 | 1-2 会话 |

## 实施策略

1. **Phase 1 先行**：纯基础设施，不碰现有代码，零回归风险
2. **Phase 2 渐进式**：先改一个适配器验证 → 确认无问题后批量改
3. **Phase 3-4 独立并行**：zod 和富文本不互相依赖，可并行推进

每个 Phase 完成后独立 PR、独立质检、独立合并。
