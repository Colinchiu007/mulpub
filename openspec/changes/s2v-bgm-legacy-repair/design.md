# 设计：背景音乐分组迁移 + 历史音频存在性状态机

## 1. 问题拆解

| # | 问题 | 本质 | 本次做法 |
|---|------|------|---------|
| P1 | BGM 控件在「画面」分组 | 渲染模板与运营选项目录不一致（optionKey 已是 `voice.bgm*`） | 纯模板迁移 + 摘要/默认判定同步，不改 optionKey |
| P2 | 「已选音频（未入库）」无法区分文件在/不在 | renderer 无文件系统可见性 | 新增主进程只读 inspect 通道；renderer 状态机 + 显式修复动作 |
| P3 | 丢失文件仍允许启动，compose 静默跳过 | 缺少“启动前可发现性”门禁 | `missing`/`unusable` 阻断启动并给首条原因；`checking` 启动前 await |

## 2. 方案选择与备选方案

### D1（采纳）拆分「未入库」为「可用的历史路径 / 已丢失 / 不可用」

- 主进程 `inspectPath` 是唯一事实源，判定规则与 compose 的 `resolveReadableMediaFile(path, { kind: 'bgm' })` 同源，避免“界面说可用、合成却跳过”的双源真相。
- 只返回机器码 `reason`，用户文案全部在 renderer locales（沿用 `story2video-notifications` 的“服务层不硬编码用户文案”约定）。

**备选 A：自动把可用历史路径复制进素材库并改写 `bgmPath`**
- 优点：一次修复、永不复发。
- 拒绝理由：① 静默复制用户文件到应用目录、改写持久化配置，属未授权副作用；② 同一旧路径可能出现在多个快照/配置里，自动迁移会按恢复次数重复复制；③ 若源文件很大（≤15MB）或位于只读盘，失败路径复杂。改为**显式【加入素材库】**一键操作，效果等价且可解释。

**备选 B：renderer 侧用 `fs` 直接判断**
- 拒绝：renderer 无 `nodeIntegration`，违反 Electron 安全模型；且 `%TEMP%` 清理发生在主进程可见域。

**备选 C：给 BGM 配置新增 `libraryId` 字段作为主键**
- 优点：路径漂移不影响引用。
- 拒绝：改动 `s2vConfig` 持久化 schema、快照兼容、compose 参数合同（`bgm.path`）与历史项目，风险远大于收益；本次不扩字段。

### D2 状态机

```
idle ──(bgmPath 非空且不在库)→ checking ──→ available | missing | unusable | unknown
  ↑                                   │
  └──(bgmPath 为空 / 命中库条目)───────┘
```

| 状态 | 判定 | UI | 启动门禁 |
|------|------|----|---------|
| `idle` | `bgmPath` 空，或命中库条目 | 不显示额外提示 | 放行 |
| `checking` | 已发起 inspect，未返回 | “正在检查该音频是否可用…” | 放行（启动前 await 一次） |
| `available` | `reason=ok` 且 `inLibrary=false` | 提示可用 +【加入素材库】 | 放行 |
| `missing` | `reason=missing` | 丢失提示 +【清除背景音乐选择】 | **阻断** |
| `unusable` | `reason ∈ format_unsupported/size_exceeded/not_allowed/not_a_file/unreadable` | 不可用提示 +【清除背景音乐选择】 | **阻断** |
| `unknown` | IPC 返回非 0 / 通道缺失 / 浏览器态 | 保持“未入库”原样 | 放行（失败开放） |

**竞态**：`verify` 带自增 `requestId` 与 `path` 双条件，只有“最新请求 + 与当前 `bgmPath` 相同”的响应才落地；`adopt` 成功后先写 `bgmPath`（新库内路径）再复位状态，避免一次过期的 `missing` 覆盖新选择。

**为什么 `unknown` 失败开放**：本通道是增强可发现性，不是安全边界；在无 Electron（浏览器/Vitest stub）、旧主进程（未升级）等场景必须保持改造前行为，否则会把“无法核验”误判成“文件已丢失”，造成假阻断。

### D3 主进程 inspect 判定顺序（fail-closed 输入、fail-open 可选性）

1. 非字符串 / 空串 / 超 4096 → `invalid_argument`（不触盘）。
2. `toLocalPath` 失败或非绝对路径 → `invalid_argument`（拒绝 `file://` 越权与相对路径）。
3. 扩展名不在 `.wav/.m4a/.mp3` → `format_unsupported`（**在 stat 之前**，避免任意路径探测）。
4. `lstat`：`ENOENT` → `missing`；其他错误 → `unreadable`。
5. 符号链接 / 非普通文件 → `not_a_file`。
6. `size<=0` → `unreadable`；`size>15MB` → `size_exceeded`。
7. 不在 `getAllowedMediaRoots()`（临时受控目录 / 素材库 / 项目目录）→ `not_allowed`。
8. `resolveReadableMediaFile` 复核失败 → `unreadable`。
9. 全部通过 → `readable=true, reason='ok'`；再用库索引比对 canonical 路径得到 `inLibrary` / `libraryItemId`（只读索引，不触发自愈写）。

> 说明：第 7 步的 `not_allowed` 与 compose 的 `diagnoseBgmSkipReason` 同码，用户看到的解释与最终行为一致。

### D4 数据契约（IPC）

请求：`{ filePath: string }`（trim 后非空、≤4096）。
响应：`{ code: 0, data: { path, exists, readable, size, extension, inLibrary, libraryItemId, reason } }`。
错误：`{ code: VALIDATION_ERROR/REQUEST_ERROR, message }`。
`data.path` 原样回显请求路径（不返回 canonical 绝对路径，避免把用户目录布局回传渲染层）。

### D5 分组迁移的连带影响

- `S2V_SUMMARY_FIELDS.voice` 增加 `bgmPath` / `bgmVolume`：用户选了 BGM 或改音量后，声音分组不再显示「（默认）」后缀——与“该组已有改动”的语义一致。
- `s2vSectionSummary('voice')` 追加背景音乐摘要，取值优先级：库内条目名 → 历史可用 → 已丢失 → 无背景音乐。
- 运营后台 `visibility` 仍按 `voice.bgm` / `voice.bgmVolume` 生效（optionKey 未变），迁移后隐藏行为与分组归属一致。

## 3. 改动面

| 层 | 文件 | 说明 |
|----|------|------|
| 主进程服务 | `electron/services/story2video-paths.js` | 导出既有内部助手 `toLocalPath` / `getMediaRule`（无行为变化） |
| 主进程服务 | `electron/services/story2video-bgm-library.js` | 新增 `inspectPath` |
| 主进程 IPC | `electron/ipc-handlers/story2video.js` | 新增 `story2video:bgm-library-status` |
| 权限 | `electron/ipc-handlers/license-access-control.js` | PUBLIC_CHANNELS +1 |
| preload | `electron/preload/publish.js` / `access-control.js` | API + PUBLIC_METHODS |
| renderer API | `src/api/publisher.js` | `story2videoBgmLibraryStatus` |
| composable | `src/views/video-creation/composables/useBgmLibrary.js` | 状态机 + verify/adopt/clear |
| 壳 | `src/views/CreateView.vue` | watcher、桥接、启动门禁、摘要/默认字段 |
| 面板 | `src/views/video-creation/S2vConfigPanels.vue` | 迁移控件 + 状态提示/按钮 |
| 契约 | `src/views/video-creation/s2v-panel-contract.js` | 新状态/方法登记 |
| locales | `src/locales/create/{zh,en}.js` | 成对新增文案 |
| 测试 | 见 tasks.md | 服务/IPC/preload/composable/面板/壳 |

## 4. 风险与回退

| 风险 | 缓解 | 回退 |
|------|------|------|
| 启动门禁过严导致用户被卡 | 仅在“已确认 missing/unusable”时阻断；提供一键清除；`unknown` 不阻断 | 回退 `canStartPipeline` 的该分支即可恢复旧行为 |
| inspect 调用放大 IPC 频率 | 只在 `s2vLegacyBgmPath` 变化时触发；单路径单请求；请求代际丢弃旧响应 | 关闭 watcher（保留手动重试按钮） |
| 旧主进程无该通道 | `invokeWithFallback` 返回 code -1 → `unknown` → 不阻断 | 无需回退 |
| 迁移模板误删控件 | 保留全部 `data-testid`；面板测试断言控件位于 voice 分组且 appearance 不再包含 | 单 commit 可 revert |
| 文案未成对 | CI Gate 7 locale 同步 + 本地 `check-locale-sync` | 补齐 en/zh |

## 5. 验证策略

- 单元：inspect 判定矩阵（可用/丢失/格式/超限/越界/符号链接/目录/非法入参/库内命中）。
- IPC：成功 + 参数校验失败。
- preload/权限：方法在 PUBLIC_METHODS、通道在 PUBLIC_CHANNELS。
- composable：状态映射、请求代际、adopt 成功/失败、clear。
- 面板：分组归属（voice 内、appearance 无）、状态提示与按钮渲染。
- 壳：watcher 触发、启动阻断与原因、清除、adopt 后自动选中、unknown 不阻断。
- 回归：`CreateView` 全量、`S2vConfigPanels`、`story2video-bgm-library`、`story2video` IPC、`preload`、locale 同步、ESLint、QM-1 打包与 8 秒启动 stderr 三层判据。
