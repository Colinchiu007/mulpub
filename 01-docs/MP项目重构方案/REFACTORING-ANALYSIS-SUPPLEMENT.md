# Multi-Publish 深度重构分析 — 补充报告（基于源码级审查）

> **说明**：本报告基于对项目实际源码的逐文件审查，对初版分析（《REFACTORING-ANALYSIS.md》）中的若干判断进行修正、补充和深化。所有结论均来自 `apps/desktop/electron/`、`packages/rpa-engine/`、`packages/shared-utils/` 等目录下的真实代码。

---

## 一、重大修正：之前分析中需要推翻或调整的结论

### ✅ 修正一：主进程"巨石模块"问题 — 已部分解决，但新问题浮现

**原结论**：`electron/` 下有 35+ 个主进程模块直接挂在 main.js 中，是典型的"上帝模块"反模式。

**源码实际情况**：

经过多轮重构后，`main.js` 已被拆分为 **bootstrap / window / shutdown 三件套**：

```
main.js          → 仅 39 行：编排启动流程 + 全局异常处理
bootstrap.js     → ~430 行：DI 容器消费 + taskQueue 接线 + 基础设施构建
window.js        → BrowserWindow 创建 + 菜单
shutdown.js      → 退出清理逻辑
ipc-handlers/    → 20 个独立 handler 模块（store/proxy/account/publish/analytics...）
preload/         → index.js + publish.js + account.js + system.js（工厂函数模式）
core/container.js      → 自研轻量 DI 容器（82 行）
core/container.setup.js → 集中注册 30+ 服务到 DI 容器（97 行）
services/         → 30+ 服务类（每个独立文件）
```

**新的核心问题**：`bootstrap.js` 本身成为了 **新的上帝模块**（~430 行），承担了以下职责：

| 职责 | 行数范围 | 问题 |
|---|---|---|
| DI 容器创建与服务获取 | L34-56 | 一次性从容器取出 20+ 个服务实例 |
| 任务执行器闭包定义 | L86-107 | 内联 async 函数，publisher 创建逻辑硬编码 |
| 任务事件监听器注册 | L110-181 | 5 个事件监听器，每个包含复杂回调 |
| 渲染引擎/管线引擎初始化 | L183-188 | 与发布逻辑无关的视频管线初始化 |
| 平台配置/敏感词/数据同步 | L190-200+ | 杂项基础设施接线 |

**修正后的重构建议**：

`bootstrap.js` 应按职责进一步拆分为 **启动阶段编排器**：

```javascript
// bootstrap/index.js — 仅编排启动顺序
function createAppContext() {
  const container = createContainer()
  
  // Phase 1: 基础设施（无依赖）
  const infra = initInfrastructure(container)
  
  // Phase 2: 数据层（依赖 store）
  const data = initDataLayer(container, infra)
  
  // Phase 3: 业务服务（依赖 data）
  const business = initBusinessServices(container, data, infra)
  
  // Phase 4: 事件总线接线
  wireEventHandlers(container, business)
  
  // Phase 5: IPC 注册
  registerIpcHandlers(ipcMain, { container, ...business })
  
  return { container, ...infra, ...data, ...business }
}
```

---

### ✅ 修正二：IPC 协议管理 — 已建立命名空间体系，但暴露面过大

**原结论**：35+ 个模块各自注册 IPC handler，没有统一的 IPC 协议管理。

**源码实际情况**：

IPC handler 已按领域组织为 **20 个独立模块**，通过 `ipc-handlers/index.js` 统一注册：

```javascript
// ipc-handlers/index.js — 20 个已组织的 handler 模块
require('./store')(ipcMain, deps)
require('./proxy')(ipcMain, deps)
require('./account')(ipcMain, deps)
require('./keyword')(ipcMain, deps)
require('./publish')(ipcMain, deps)
require('./analytics')(ipcMain, deps)
require('./sync')(ipcMain, deps)
require('./update')(ipcMain, deps)
require('./upload')(ipcMain, deps)
require('./scheduler')(ipcMain, deps)
require('./sensitive')(ipcMain, deps)
require('./render')(ipcMain, deps)
require('./platform')(ipcMain, deps)
require('./templates')(ipcMain, deps)
require('./license')(ipcMain, deps)
require('./ai')(ipcMain, deps)
require('./offline')(ipcMain, deps)
require('./payment')(ipcMain, deps)
require('./pipeline')(ipcMain, deps)
require('./video')(ipcMain, deps)
require('./misc')(ipcMain, deps)
require('./onboarding')(ipcMain, deps)
```

**新的核心问题**：Preload 层通过 `contextBridge.exposeInMainWorld('electronAPI', api)` 暴露了 **100+ 个方法**给渲染进程。仅 `system.js` 一个 preload 子模块就暴露了约 **80 个方法**（从 getVersion 到 batchDuplicateArticle）。

| Preload 子模块 | 暴露方法数 | 风险等级 |
|---|---|---|
| publish.js | ~45 | 🔴 高（含发布、管线、云发布、评论等） |
| account.js | ~25 | 🟡 中（含账号、认证、存储） |
| system.js | ~80 | 🔴 极高（含支付、代理、许可证、AI写作、视频处理等） |

**安全风险**：渲染进程（Vue 前端）拥有对支付系统、代理池、AI 写作、视频处理、许可证管理等敏感功能的完整调用能力，缺乏 **细粒度权限控制**。

**修正后的重构建议**：

1. **分层 API 暴露**：将 preload 方法分为 `public` / `authenticated` / `admin` 三级：
```javascript
// preload/index.js
contextBridge.exposeInMainWorld('electronAPI', {
  // 公开 API — 所有用户可用
  ...createPublicApi(ipcRenderer),
  // 认证 API — 登录后可用（前端调用前检查登录态）
  ...createAuthenticatedApi(ipcRenderer),
  // 管理 API — 仅管理员/开发者模式
  ...(isDevMode ? createAdminApi(ipcRenderer) : {}),
})
```

2. **移除渲染进程不应直接调用的方法**：支付确认 (`paymentComplete`)、代理测试 (`proxyTest`)、许可证激活 (`licenseActivate`) 等操作应仅通过主进程内部触发，不暴露给渲染进程。

---

### ✅ 修正三：RPA 发布器抽象 — 架构已迁移至 RpaViewManager

**原结论**：12 个平台发布器缺乏统一抽象基类，各自直接操作 Playwright API。

**源码实际情况**：

`packages/rpa-engine/src/publishers/registry.js` 已被标记为 **废弃**：

```javascript
/**
 * 发布器注册中心（已废弃）
 *
 * P2-E: 所有平台已迁移到 RpaViewManager（executeJavaScript 引擎），
 * 不再使用独立 *-rpa.js 文件发布器。
 * 此模块仅保持 require 兼容，新代码请直接使用 RpaViewManager。
 */
const registry = {}  // 空注册表
```

当前架构采用 **统一 RpaViewManager** + **executeJavaScript 引擎** 模式，而非之前的每平台独立发布器类。

**但发现的新问题**：

1. **选择器配置已集中化**（这点比预期好）：`platform-selectors.js` 包含 16 个平台的登录检测选择器和发布操作选择器，且每个选择器字段都是 **数组形式的 fallback 链**（如 `['#title', 'input.weui-desktop-input']`），这比我最初假设的"硬编码单选择器"要成熟得多。

2. **平台覆盖面扩大**：选择器配置中不仅包含 README 提到的 12 个平台，还新增了 **Twitter/X、Instagram、Facebook**（共 15 个平台），以及对应的登录 URL 和发布选择器。

3. **B站特殊处理**：bilibili 的登录成功选择器为空数组 `[]`，注释标注"API 模式检查"，说明 B站确实采用了 API+RPA 双模式。

**修正后的重构建议**：

虽然架构已迁移至 RpaViewManager，但仍需关注以下问题：

- **RpaViewManager 的接口定义不清晰**：没有找到明确的 TypeScript interface 或 JSDoc 定义其公共方法（`publish()`、`login()`、`onProgress()` 等）。建议补充。
- **选择器版本管理缺失**：`platform-selectors.js` 是静态 JS 文件，没有版本号或平台版本对应关系。当某平台改版时，无法快速定位哪些选择器受影响。
- **选择器健康检查自动化不足**：虽然有 fallback 链，但没有自动化的定期验证机制来检测所有 fallback 是否同时失效。

---

### ✅ 修正四：TypeScript 覆盖率 — 比预期好，但存在"虚假类型安全"

**原结论**：TypeScript 仅占 3.6%，远低于健康水平。

**源码实际情况**：

项目中存在两种 TypeScript 使用模式：

1. **`@ts-check` + JSDoc 模式**（广泛使用）：
   - `credential-store.js`、`container.js`、`error-codes.js`、`pipeline-engine.js` 等核心文件均使用 `// @ts-check`
   - 这提供了基本的类型推断能力，但不等于真正的 TypeScript

2. **`@ts-nocheck` 模式**（关键入口）：
   - `main.js` 使用 `// @ts-nocheck`（完全禁用类型检查）
   - `bootstrap.js` 使用 `// @ts-nocheck`
   
3. **纯 TypeScript 文件**：
   - `container.test.ts`（DI 容器测试）
   - `packages/api-publish-engine/` 下可能有 TS 文件（第三方逆向集成）

**新的核心问题**：`@ts-nocheck` 出现在最关键的入口文件中，意味着整个应用的类型安全链在起点就断裂了。`bootstrap.js` 作为 430 行的核心编排模块，完全没有类型约束。

**修正后的重构建议**：

优先级调整为：

1. **P0**：移除 `main.js` 和 `bootstrap.js` 的 `@ts-nocheck`，逐步修复类型错误
2. **P1**：为核心服务类编写 `.d.ts` 类型声明文件（即使主体仍是 JS）
3. **P2**：将 `@ts-check` 文件逐步迁移为 `.ts` 文件

---

## 二、全新发现：初版分析完全遗漏的重要子系统

### 🆕 发现一：PipelineEngine — 14 条内容生产管线（完全遗漏）

**这是初版分析最大的遗漏**。项目中存在一个完整的 **内容管线编排引擎**（`services/pipeline-engine.js`），支持 14 条预定义的内容生产管线：

| 管线名称 | 类别 | 阶段数 | 成本估算 |
|---|---|---|---|
| animated-explainer | generated | 8 | medium |
| talking-head | talking_head | 4 | low |
| cinematic | cinematic | 4 | medium |
| animation | animation | 4 | high |
| avatar-spokesperson | talking_head | 4 | high |
| character-animation | animation | 4 | high |
| clip-factory | screen_recording | 4 | low |
| documentary-montage | cinematic | 5 | medium |
| hybrid | hybrid | 4 | high |
| localization-dub | hybrid | 4 | medium |
| podcast-repurpose | hybrid | 4 | low |
| screen-demo | screen_recording | 3 | low |
| framework-smoke | custom | 2 | low |

**架构问题**：

1. **纯内存运行**：`PipelineEngine` 的 `_runs` 和 `_history` 都是内存 Map，应用崩溃或重启后所有管线状态丢失。没有持久化机制。

2. **无实际执行逻辑**：`start()` 方法只创建运行记录并标记状态，但没有真正执行任何阶段的业务逻辑。看起来是一个 **编排框架的骨架**，具体阶段执行可能由 Python 后端或其他服务完成。

3. **runId 生成不够健壮**：使用 `Date.now() + Math.random()`，在高并发场景下可能碰撞。

**重构建议**：

```typescript
interface PipelineStageExecutor {
  execute(stage: string, context: PipelineContext): Promise<StageResult>
}

class PipelineEngine {
  private executors: Map<string, PipelineStageExecutor>
  private persistentStore: PipelineStore  // SQLite 持久化
  
  async start(pipelineName: string, params: object): Promise<RunResult> {
    // 1. 持久化运行记录
    // 2. 按阶段调度 executor
    // 3. 检点保存
    // 4. 失败恢复
  }
}
```

---

### 🆕 发现二：CompositionManager — Remotion 视频合成系统（完全遗漏）

`services/composition-manager.js` 管理了一套基于 **Remotion** 的视频合成 Composition 系统：

| Composition ID | 名称 | 模式 | 场景数 |
|---|---|---|---|
| Explainer | 解释视频 | text | 13 |
| TalkingHead | 说话头像 | video | 1 |
| CinematicRenderer | 电影感短片 | video | 1 |
| CollageBurst | 拼贴爆破 | video | 1 |
| TitledVideo | 标题叠加 | video | 1 |
| LyricOverlay | 歌词同步 | video | 1 |
| HeroTitle | 大标题展示 | text | 1 |

**架构问题**：

1. **Composition 目录硬编码**：`COMPOSER_DIR` 指向 `packages/remotion-composer`，路径使用相对定位（`../../../..`），脆弱且难以维护。

2. **props 校验规则分散**：`validateProps()` 方法内部用 if-else 链校验每种 Composition 的特殊规则，新增 Composition 时容易遗漏。

3. **与 PipelineEngine 的关系不清**：两者都涉及"内容生产管线"，但职责边界模糊——PipelineEngine 管宏观编排，CompositionManager 管 Remotion 合成参数，两者的协作靠隐式约定。

---

### 🆕 发现三：DI 容器系统 — 自研轻量实现，但有明显缺陷

`core/container.js` 是一个自研的轻量级 DI 容器（82 行），功能包括：

- ✅ 单例模式支持（factory 延迟初始化）
- ✅ 批量注册 `registerMany()`
- ✅ 必需服务断言 `assertRequired()`
- ✅ 存在性检查 `has()`

**发现的缺陷**：

1. **中文注释乱码**：`container.js` 的 JSDoc 注释出现编码损坏（显示为 `?` 或乱码字符），说明文件编码不是 UTF-8 或编辑器保存时出错。这会影响 IDE 智能提示和团队协作。

2. **循环依赖检测缺失**：如果 Service A 的 factory 依赖 Service B，Service B 又依赖 A，容器会在运行时栈溢出，而不是给出清晰的错误信息。

3. **无生命周期钩子**：缺少 `dispose()` / `destroy()` 机制。对于持有浏览器实例、数据库连接、HTTP 服务的 singleton，无法在应用退出时优雅清理。

4. **工厂函数签名限制**：`register(name, value)` 通过 `value.length >= 0` 判断是否为工厂函数，但这不可靠（箭头函数没有 length 属性反映参数数量）。

**重构建议**：

```javascript
Container.prototype.register = function(name, value, options = {}) {
  // 显式区分值注册 vs 工厂注册
  if (options.factory || typeof value === 'function') {
    this._registry[name] = { 
      factory: value, 
      singleton: options.singleton !== false,
      value: null, 
      initialized: false,
      disposable: options.disposable || false  // 新增：是否可销毁
    }
  } else {
    this._registry[name] = { value, initialized: true }
  }
}

// 新增：优雅销毁
Container.prototype.dispose = async function() {
  for (const [name, entry] of Object.entries(this._registry)) {
    if (entry.disposable && entry.value && typeof entry.value.dispose === 'function') {
      await entry.value.dispose()
    }
  }
  this._registry = {}
}
```

---

### 🆕 发现四：CredentialStore — 安全实践超出预期

**原结论**：Cookie 加密密钥管理需要改进。

**源码实际情况**：

`services/credential-store.js` 的安全实践比我最初评估的要完善得多：

| 安全措施 | 实现 | 评价 |
|---|---|---|
| AES-256-GCM 加密 | ✅ `crypto.createCipheriv('aes-256-gcm', ...)` | 标准 |
| PBKDF2 密钥派生 | ✅ 100000 次迭代，sha512 | 强 |
| 随机 Salt | ✅ 每次加密生成 32 字节随机 salt | 正确 |
| 原子写 | ✅ 写 .tmp 文件后 rename | 防崩溃损坏 |
| 主密钥文件权限 | ✅ `chmodSync(0o600)` | 最小权限 |
| 主密钥备份 | ✅ .masterkey.bak 双副本 | 防单文件损坏 |
| 路径穿越防护 | ✅ 校验 accountId 不含 `..` `/` `\` | 防 path traversal |
| 双层存储 | Session Cookie (Electron partition) + 应用层凭证加密 | 冗余保障 |

**仍需改进的点**：

1. **主密钥未使用操作系统安全存储**：`.masterkey` 文件仍存储在普通磁盘上，虽然权限设为 0o600，但在有物理访问或管理员权限的机器上仍可被读取。建议使用 Electron `safeStorage` 加密主密钥本身。

2. **PBKDF2 迭代次数固定**：100000 次是 2020 年前的推荐值，当前 OWASP 推荐至少 210,000 次（SHA-512）或使用 Argon2。

3. **错误处理静默失败**：`loadCredential()` 在解密失败时返回 `null` 并打印日志，调用方无法区分"凭证不存在"和"凭证损坏"。

---

### 🆕 发现五：Error Codes — 跨包冲突管理体系

`core/error-codes.js` 揭示了一个重要的跨包冲突管理问题：

```
desktop 侧原始错误码：
  -4 = NOT_FOUND
  -5 = TIMEOUT_ERROR
  -6 = NETWORK_ERROR
  -7 = IO_ERROR

api-publish-engine（参考产品逆向分析集成）错误码：
  -2 = data_error
  -3 = unknown_error
  -4 = exception      ← 冲突！
  -5 = io_error       ← 冲突！

调整后 desktop 侧：
  NOT_FOUND      → -10
  TIMEOUT_ERROR  → -11
  NETWORK_ERROR  → -12
  IO_ERROR       → -13
```

**这说明**：项目集成了第三方逆向工程包（参考产品），并且主动进行了错误码空间隔离。这是一个好的实践，但也暗示了 **技术债务来源之一** —— 对第三方闭源/灰产工具的深度依赖。

**风险**：`api-publish-engine` 的语义（`-4=exception`, `-5=io_error`）被冻结不能修改，意味着 desktop 侧的错误码体系永远需要在 -10 以下分配，长期可维护性存疑。

---

## 三、架构层面的新发现

### 🆕 发现六：任务队列的实际能力 — 远超"并发 3"

**原结论**："3 任务并发"是硬编码值，不够灵活。

**源码实际情况**：

`task-queue.js` 的实际能力远超简单并发控制：

| 特性 | 实现细节 |
|---|---|
| 并发控制 | `maxConcurrent` 可配置（默认 3） |
| 重试策略 | 每个任务独立 retry 次数（默认 2） |
| 超时控制 | 每个任务独立 timeout（默认 180 秒 = 3 分钟） |
| 频率控制 | `PublishIntervalGuard` 外部注入，支持按平台限速 |
| 持久化 | `serialize()` / `deserialize()` 支持崩溃恢复 |
| 定时器追踪 | `_pendingTimers` Set 跟踪所有频率控制定时器，shutdown 时清理 |
| 事件驱动 | `task:added` / `task:success` / `task:failed` / `task:cancelled` / `task:retry` / `publish:blocked` |

**新发现的改进点**：

1. **崩溃恢复策略粗糙**：`deserialize()` 将运行中被中断的任务简单重新加入队列尾部，重试次数设为 `Math.max(t.retriesLeft, 1)`。但对于已部分发布的任务（如视频上传完成 80%），重新从头开始可能不合适。

2. **无优先级队列**：所有任务 FIFO，无法区分"紧急发布"和"定时批量发布"。

3. **历史记录无限增长**：`_history` 数组只追加不清理，长时间运行后会持续占用内存。

---

### 🆕 发现七：Preload 架构 — 工厂函数模式（设计良好）

`preload/` 目录的设计出乎意料地良好：

```
preload/
├── index.js      ← 21 行：聚合三个子模块 + contextBridge 暴露
├── publish.js    ← 136 行：发布相关 API（工厂函数 createPublishApi）
├── account.js    ← 111 行：账号相关 API（工厂函数 createAccountApi）
└── system.js     ← 254 行：系统/工具 API（工厂函数 createSystemApi）
```

**设计亮点**：

1. **工厂函数模式**：每个子模块导出 `createXxxApi(ipcRenderer)` 工厂函数，`ipcRenderer` 由 `index.js` 注入。这使得子模块可以脱离 Electron 环境进行单元测试（传入 mock ipcRenderer）。

2. **事件监听器自动清理**：每个 `onXxx(callback)` 方法返回取消订阅函数（`() => ipcRenderer.removeListener(...)`），符合 React/Vue 的 useEffect 清理模式。

3. **向后兼容**：注释明确标注"与原 preload.js 完全一致，不改变方法名/IPC 通道/参数顺序"，保证了重构的安全性。

**唯一问题**：如前所述，`system.js` 承载了过多不属于"系统/工具"范畴的方法（支付、代理、AI 写作、视频处理等），违反了单一职责原则。

---

## 四、代码质量细节发现

### 🔍 发现八：全局状态污染

`bootstrap.js` 中存在全局状态依赖：

```javascript
// 第 111 行
if (typeof global.usageTracker !== 'undefined' && global.usageTracker) {
  global.usageTracker.trackFeatureUsage('publish', 'success')
  global.usageTracker.trackDaily('articles_published', 1)
}
```

`global.usageTracker` 是在某个未知位置设置的全局变量，不在 DI 容器中管理。这导致：
- 无法在测试中 mock
- 初始化顺序依赖隐式约定
- 与 DI 容器的服务管理模式不一致

### 🔍 发现九：CJS/ESM interop 兼容性代码

```javascript
// bootstrap.js 第 23-24 行
const _CloudPublisherModule = require('./services/cloud-publisher')
const CloudPublisher = _CloudPublisherModule.default || _CloudPublisherModule
```

这种兼容代码说明项目中存在 CJS 和 ESM 混用的情况（可能是 vitest mock 使用 ESM default export，而生产代码使用 CJS module.exports）。这种混用会导致 Tree-shaking 失效、打包体积增大、以及潜在的 `this` 指向问题。

### 🔍 发现十：getMainWin() 辅助函数的性能问题

```javascript
// bootstrap.js 第 28 行
function getMainWin() { 
  return require('electron').BrowserWindow.getAllWindows()[0] 
}

// 在任务执行器闭包中被频繁调用（每次 emitProgress 都调用）
const win = getMainWin()
```

每次进度通知都会调用 `BrowserWindow.getAllWindows()[0]` 来获取主窗口引用。在高频进度更新场景下（如视频渲染进度），这可能产生不必要的开销。应在 `createAppContext()` 时缓存窗口引用。

---

## 五、修订后的重构路线图

基于源码审查结果，对初版路线图进行如下调整：

### ❌ 从初版路线图中降优先级或移除的项目

| 初版建议 | 调整原因 | 新优先级 |
|---|---|---|
| IPC 注册统一化 | 已完成（20 个 handler 模块 + 命名空间） | ✅ 已完成 |
| 选择器配置外置 | 已完成（platform-selectors.js + fallback 链） | ✅ 已完成 |
| 发布器基类抽象 | 架构已迁移至 RpaViewManager，不再适用 | ❌ 不再需要 |
| Cookie 密钥改用 safeStorage | CredentialStore 已有较好的安全实践 | P2 → P3 |

### ⬆️ 从初版路线图中提升优先级的项目

| 新建议 | 原因 | 优先级 |
|---|---|---|
| **bootstrap.js 拆分** | 新的上帝模块，430 行，6 种混合职责 | **P0** |
| **Preload API 分层与裁剪** | 100+ 方法暴露给渲染进程，含支付/代理等敏感操作 | **P0** |
| **移除 @ts-nocheck** | main.js/bootstrap.js 完全无类型安全 | **P0** |
| **PipelineEngine 持久化** | 纯内存运行，崩溃丢失全部状态 | **P1** |
| **DI 容器增强** | 缺少循环依赖检测、生命周期管理、编码修复 | **P1** |
| **全局状态清理** | global.usageTracker 等 DI 外全局变量 | **P1** |
| **任务队列优先级 & 历史清理** | 无优先级队列、history 无限增长 | **P2** |

### ➕ 新增的重构项目

| 新增项目 | 说明 | 优先级 |
|---|---|---|
| **CompositionManager 与 PipelineEngine 职责边界梳理** | 两个"管线"系统的协作关系需显式化 | P1 |
| **container.js 编码修复** | 中文注释乱码影响维护 | P2（5 分钟修复） |
| **getMainWin() 缓存优化** | 避免高频调用 getAllWindows() | P3 |
| **CJS/ESM 统一** | 消除 interop 兼容代码，统一模块方案 | P2 |
| **错误码体系文档化** | 跨包冲突规则需写入 ARCHITECTURE.md | P3 |
| **选择器版本化管理** | platform-selectors.js 增加平台版本映射 | P2 |

---

## 六、总结：修订后的核心技术债务清单

基于源码级审查，Multi-Publish 项目的技术债务排序如下（按影响 × 概率排序）：

### 🔴 高优先级（应立即着手）

1. **bootstrap.js 上帝模块** — 430 行混合 6 种职责，是当前主进程最大的可维护性风险点
2. **Preload API 暴露面过大** — 100+ 方法给渲染进程，含敏感操作，无权限分级
3. **@ts-nocheck 入口文件** — 类型安全链在起点断裂

### 🟡 中优先级（1-2 月内规划）

4. **PipelineEngine 纯内存运行** — 无持久化、无恢复、无实际执行逻辑
5. **DI 容器缺陷** — 循环依赖检测缺失、生命周期管理缺失、编码乱码
6. **全局状态污染** — DI 外全局变量破坏可测试性
7. **CompositionManager/PipelineEngine 边界模糊**

### 🟢 低优先级（技术债清扫）

8. **任务队列优先级 & 历史清理**
9. **CJS/ESM 统一**
10. **选择器版本化管理**
11. **CredentialStore 主密钥 safeStorage 化**
12. **container.js 编码修复**

---

*补充报告日期：2026-07-11 | 基于 apps/desktop/electron/、packages/rpa-engine/、packages/shared-utils/ 源码逐文件审查*
