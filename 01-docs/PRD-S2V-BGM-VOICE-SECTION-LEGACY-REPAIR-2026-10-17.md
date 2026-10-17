# PRD：故事讲述流水线 · 背景音乐归位「声音」分组 + 历史音频存在性修复

| 项 | 内容 |
|----|------|
| 文档编号 | PRD-S2V-BGM-VOICE-SECTION-LEGACY-REPAIR-2026-10-17 |
| 状态 | 已实现，待合并验收 |
| 日期 | 2026-10-17 |
| 关联 OpenSpec change | `openspec/changes/s2v-bgm-legacy-repair/` |
| 关联任务 | CCG task `s2v-bgm-legacy-repair`；分支 `s2v-bgm-legacy-repair`（worktree `mp-s2v-bgm-legacy-repair`，D 盘） |
| 影响页面 | 视频创作 → 视频创作 → 故事讲述（`story2video-compose`）详情页 → 配置面板 |
| 关联文档 | `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §9/§11/§12、`01-docs/PRD-video-creation.md` §3.1.25、`openspec/specs/story2video-bgm-library/spec.md` |

---

## 1. 背景与用户问题

用户在原页面上报告两件事（2026-10-17，逐字口径）：

1. 「视频创作-故事讲述流水线页面，把“画面”选项区域中的“背景音乐”和“背景音乐音量”这两个选项，移动到“声音”选项区域中。」
2. 「现在的“背景音乐”的下拉选择框中，显示“已选音频（未入库）”。这是什么情况，是不是原来提交的本地音频文件，系统找不到了？这种应该怎么处理。相应如何优化这种机制？」

第 1 件是**信息架构**问题：背景音乐描述的是声音，却被放在「画面」折叠区，与「声音」区的旁白音色割裂；运营选项目录（`PRD-S2V-PIPELINE-PAGE-UX.md` §11.4）里二者 optionKey 早已是 `voice.bgm` / `voice.bgmVolume`，只有模板物理位置留在 `appearance`。

第 2 件是**可发现性 + 数据完整性**问题：该选项只回答“在不在素材库”，不回答“文件还在不在/还能不能用”。用户无法判断该清掉、该重新选、还是可以原样继续；点「启动流水线」后 compose 会按既有降级语义 `bgmSkipped` **静默跳过背景音乐**，用户花完时间与额度才发现成片没有音乐。

---

## 2. 根因溯源与逃逸分析（QM-5）

### 2.1 第一性原因（①）

- **旧选择路径留下悬空路径**：2026-08-14 之前，BGM 只支持「每次选本地文件」，经 `story2video:import-media` 复制到 `%TEMP%\story2video\selected-media\bgm-*.mp3`，`s2vConfig.bgmPath` 指向该临时路径；`story2video.lastOptions.v1` 快照、配置快照与历史记录都持久化了这个绝对路径。
- **临时目录会被清理**：`story2video-paths.js` 的 `gcImportedMedia` 对 `selected-media` 实施 **7 天**惰性老化回收（`DEFAULT_IMPORTED_MEDIA_MAX_AGE_MS`）；操作系统（磁盘清理/临时目录策略）也会删除 `%TEMP%` 内容。
- **素材库没有迁移旧快照**：2026-08-14 的 BGM 素材库把**新选择**落到持久目录 `userData/story2video-bgm/`，但恢复旧快照时只把旧路径当作「未入库」选项保留，从未校验文件是否还在。
- **渲染层没有文件系统可见性**：`s2vLegacyBgmPath` 只做内存索引比对（`s2vBgmLibrary.some(item.path === current)`），主进程也从未提供“给定 BGM 路径是否可被 compose 读取”的只读通道。

### 2.2 逃逸链（②）

| 层级 | 为什么没拦住 |
|------|--------------|
| 单元测试 | `s2vLegacyBgmPath` 用固定字符串路径断言“不在库即显示”，从不校验文件是否存在 |
| 组件测试 | 无「文件已丢失」状态用例；`CreateView.test.js` 只断言 `s2vLegacyBgmPath` 等于给定路径 |
| 集成/E2E | 真实 Electron 验证只覆盖“新选 BGM → 受控临时路径”，未覆盖“7 天后旧临时路径失效” |
| 代码审查 | 「未入库」被当作纯兼容分支，未追问“未入库的文件还在吗”；compose 的 `bgmSkipped` 降级被当成兜底，掩盖了前置可发现性 |

### 2.3 系统性漏洞（③）

`CreateView.vue` 的 BGM 配置链路没有**存在性判定**这一层。既有信息面 `story2video:bgm-library-list` 回答“库里有什么”，无法回答“当前配置引用的那个文件还在不在”。需要新增一个与 compose 同源的只读核验通道，并把“未入库”细分为可操作的状态。

---

## 3. 目标与非目标

### 3.1 目标

| # | 目标 | 可验证判据 |
|---|------|-----------|
| G1 | 背景音乐与音量归属「声音」分组 | 面板测试断言二者位于 `s2v-section-voice` 内、`s2v-section-appearance` 内不存在；运营 optionKey 不变 |
| G2 | 历史 BGM 状态可区分 | 主进程 `inspectPath` 返回 `reason` 机器码；渲染层状态机映射为 `available / missing / unusable / unknown` |
| G3 | 文件丢失不再静默 | `missing`/`unusable` 时启动按钮禁用，首条阻塞原因可见；`handleStartPipeline` 启动前 await 一次核验 |
| G4 | 一次点击即可修复 | `available` →【加入素材库】自动选中库内新路径；`missing`/`unusable` →【清除背景音乐选择】 |
| G5 | 失败开放，不误伤 | IPC 不可用/浏览器态 → `unknown`，不阻断启动，行为与改造前一致 |
| G6 | 不丢历史配置 | 历史 `bgmPath` 在用户显式操作前不被清空或改写 |

### 3.2 非目标

- 不做启动时全盘扫描或**自动**把历史 BGM 复制入库（静默复制会改变用户磁盘状态与持久化路径，多快照会重复复制；改为显式一键操作）。
- 不改 BGM 素材库存储格式/索引迁移，不改 compose 混音实现与 `bgmSkipped` 降级语义（保留为最后防线）。
- 不改 `bgmPath` 字段名/语义（仍为绝对路径字符串），避免影响历史项目与快照兼容。
- 不做跨设备同步/云备份。
- 不顺手把「画面」其他字段迁组，不改任何 visual.* optionKey。

---

## 4. 术语与状态定义

| 术语 | 定义 |
|------|------|
| 历史路径（legacy path） | `s2vConfig.bgmPath` 非空，且不在当前 BGM 素材库条目路径集合中 |
| 素材库条目 | `userData/story2video-bgm/library.json` 索引中、且磁盘文件存在的条目（`list()` 自愈后） |
| 核验（inspect） | 主进程只读判定一个路径是否满足 compose 的 BGM 受控读取合同；不改库、不改文件、不写索引 |
| 可用（available） | 文件存在、可读、格式/大小/允许根均满足，但不在库中 |
| 已丢失（missing） | 该路径当前不存在（`lstat` → `ENOENT`） |
| 不可用（unusable） | 文件存在但无法用于合成：格式不支持、超 15MB、位于允许媒体根之外、符号链接/非普通文件、空文件或其他不可读 |
| 未知（unknown） | 核验通道不可用或返回错误（浏览器态、旧主进程、IPC 异常），**不阻断** |
| 启动门禁 | `canStartPipeline === false` 且 `pipelineBlockedReason` 给出首条可修复原因 |

### 4.1 状态机

```
idle ──(bgmPath 非空且不在库)──→ checking ──┬──→ available  （可用未入库）
  ↑                                          ├──→ missing    （文件已丢失）  → 阻断启动
  │                                          ├──→ unusable   （文件不可用）  → 阻断启动
  └──(bgmPath 为空 / 命中库条目 / 已修复)────┴──→ unknown    （无法核验）    → 不阻断
```

- `checking` 期间不阻断按钮（避免闪烁），但 `handleStartPipeline` 会在启动前 `await` 一次核验。
- `idle` 是唯一“无历史路径或已在库”的状态，面板不显示额外提示区。
- 请求代际：每次核验带自增序号与路径双条件，旧响应不得覆盖新路径/复位后的状态。

---

## 5. 数据模型与 IPC 契约

### 5.1 主进程服务

`apps/desktop/electron/services/story2video-bgm-library.js` 新增 `inspectPath(candidate)`（只读）：

```js
{
  path: string,          // 原样回显请求路径（不返回 canonical 路径，避免回传用户目录布局）
  exists: boolean,
  readable: boolean,
  size: number,          // 字节；不存在时为 0
  extension: string,     // 小写扩展名，如 '.mp3'
  inLibrary: boolean,    // 是否命中库索引条目（仅当可读时计算）
  libraryItemId: string|null,
  reason: 'ok'|'invalid_argument'|'format_unsupported'|'missing'|'not_a_file'|'size_exceeded'|'not_allowed'|'unreadable'
}
```

- 允许媒体根与 compose 同源：`getAllowedMediaRoots()`（`%TEMP%/story2video`、`%TEMP%/film-engineering`、`userData/story2video-projects`、`userData/story2video-bgm`）。
- 构造函数新增可选 `allowedRoots`（仅测试注入；生产缺省走 `getAllowedMediaRoots()`），避免纯 Node 测试依赖机器上的 `userData`。
- 库内命中比对：先用 `isPathWithin(canonical, libraryDir)` 确认位于库目录，再按唯一磁盘文件名（`bgm-<token><ext>`，Windows 忽略大小写）匹配索引，只读索引、不触发自愈写。

### 5.2 IPC

| 项 | 值 |
|----|----|
| 通道 | `story2video:bgm-library-status` |
| 入参 | `{ filePath: string }`，trim 后非空、长度 ≤ 4096 |
| 成功 | `{ code: 0, data: <inspectPath 结果> }` |
| 失败 | `{ code: VALIDATION_ERROR/REQUEST_ERROR, message }`（不抛异常给渲染层） |
| 安全 | `withSenderCheck` 可信来源校验；加入主进程 `PUBLIC_CHANNELS` 与 preload `PUBLIC_METHODS`（纯设备本地只读，未登录可用） |
| preload | `story2videoBgmLibraryStatus(filePath)`（空串本地短路返回 code -1） |
| renderer API | `src/api/publisher.js` `story2videoBgmLibraryStatus(filePath)`，失败回落 `invokeWithFallback` 的 `code -1` |

### 5.3 渲染层状态

`apps/desktop/src/views/video-creation/composables/useBgmLibrary.js`：

```js
state.s2vLegacyBgmStatus = { state, path, reason, exists }
LEGACY_BGM_STATUS = { IDLE, CHECKING, AVAILABLE, MISSING, UNUSABLE, UNKNOWN }
LEGACY_BGM_BLOCKING_STATES = [MISSING, UNUSABLE]
```

- 方法：`verifyLegacyBgmLibraryPath(path)`、`adoptLegacyBgmLibrary()`、`clearLegacyBgmLibrarySelection()`、`resetLegacyBgmLibraryStatus()`。
- CreateView 以 computed get/set 桥接 `s2vLegacyBgmStatus`，与 `s2vBgmLibrary*` 七元组同模式；panel 契约白名单同步登记。
- 新增 computed：`s2vLegacyBgmBlockedState`（`''|'missing'|'unusable'`）、`s2vBgmLibrarySummaryText()`（声音摘要片段）。

---

## 6. 数据校验

### 6.1 主进程 `inspectPath` 判定顺序（fail-closed 入参、fail-open 可选性）

| 步 | 条件 | reason | 是否触盘 |
|----|------|--------|----------|
| 1 | 非字符串 / 空串 / trim 后空 / 长度 > 4096 | `invalid_argument` | 否 |
| 2 | `toLocalPath` 失败（非本地路径、非法 scheme）或非绝对路径 | `invalid_argument` | 否 |
| 3 | 扩展名不在 `.wav/.m4a/.mp3` | `format_unsupported` | **否（stat 之前拒绝，避免任意路径探测）** |
| 4 | `lstat` 抛 `ENOENT` | `missing` | 是（失败） |
| 5 | `lstat` 抛其他错误 | `unreadable` | 是（失败） |
| 6 | 符号链接或非普通文件 | `not_a_file` | 是 |
| 7 | 大小 ≤ 0 | `unreadable` | 是 |
| 8 | 大小 > 15MB（`MAX_BGM_FILE_BYTES`） | `size_exceeded` | 是 |
| 9 | 不在允许媒体根内 | `not_allowed` | 是 |
| 10 | `resolveReadableMediaFile(path, { kind: 'bgm' })` 返回 null | `unreadable` | 是 |
| 11 | 全部通过 | `ok`（并计算 `inLibrary` / `libraryItemId`） | 是 |

> 第 9/10 步与 compose 的 `diagnoseBgmSkipReason` / `resolveReadableMediaFile` 同源：界面说“可用”时，compose 不会因同一原因跳过；反之亦然。

### 6.2 渲染层状态映射（唯一映射点）

| `reason` | 状态 | UI 动作 | 启动门禁 |
|----------|------|---------|----------|
| `ok` 且 `inLibrary=false` | `available` | 【加入素材库】 | 放行 |
| `ok` 且 `inLibrary=true` | `idle`（复位，不再是历史路径） | 无 | 放行 |
| `missing` | `missing` | 【清除背景音乐选择】 | **阻断** |
| `invalid_argument` | `unknown`（历史配置理论上都是绝对路径；数据异常按未知处理） | 【重新检查】 | 放行 |
| `format_unsupported` / `not_a_file` / `size_exceeded` / `not_allowed` / `unreadable` | `unusable` | 【清除背景音乐选择】 | **阻断** |
| IPC `code !== 0` / 抛错 / 通道缺失 | `unknown` | 【重新检查】 | 放行 |

### 6.3 启动门禁与竞态

- `canStartPipeline`：在原有“启动中/运行中”短路口之后判断 `s2vLegacyBgmBlockedState`；为真即 `false`。
- `pipelineBlockedReason`：在 `invalidRange` 之后、素材/文案之前插入 `bgmLost` / `bgmUnusable`，与 `canStartPipeline` 的短路顺序一致。
- `handleStartPipeline`：仅当存在历史路径时 `await ensureS2VLegacyBgmVerified()`；若核验结论为阻断态直接返回 `false`（不进入登录门/不启动）。无历史路径时不增加等待点，保持既有启动时序。
- 失败开放边界：`unknown` 永不阻断；核验通道在浏览器 / Vitest / 旧主进程下必然 `unknown`。

### 6.4 数值与文案校验

- `bgmVolume` 仍由 `UiSlider` 限 0–10、步长 1、默认 5；双击复位。
- 新增文案全部走 `locales/create/{zh,en}.js` 成对 key；`src/` 非 locales 文件不新增中文字面量（CI `--cjk` 基线增量扫描）。
- 历史路径摘要使用纯文本，不渲染 HTML、不展示 canonical 绝对路径。

---

## 7. 功能逻辑

### 7.1 分组迁移

- 把「背景音乐」`UiField`（`option-key="voice.bgm"`）与「背景音乐音量」`UiSlider`（`v-if="s2vOptionVisible('voice.bgmVolume')"`）从 `appearance` 的 `s2v-field-grid` 移到 `voice` 的 `s2v-field-grid`，位置在「语音 / 音色 ID」之后、音色克隆面板之前。
- 所有既有 `data-testid`（`s2v-bgm-select` / `s2v-bgm-volume` / `s2v-bgm-manage-button`）保持不变；运营后台 `voice.bgm` / `voice.bgmVolume` 显隐立即与分组归属一致。
- `S2V_SUMMARY_FIELDS.voice` 增加 `bgmPath` / `bgmVolume`：选过背景音乐或调过音量的分组不再显示「（默认）」后缀。
- `s2vSectionSummary('voice')` 在**已选背景音乐时**追加片段：库内曲名 → 历史可用 → 已丢失 → 不可用。未选 BGM 时不追加任何片段——默认折叠态摘要与既有像素基线保持逐字节一致（避免为一次归位改动重取证全量视觉基线）。既有声音摘要模板字面量逐字节保留（CJK 基线按“文件+文案内容”对账），片段用 ASCII ` · ` 拼接。

### 7.2 核验触发

- CreateView watch `s2vLegacyBgmPath`：快照/配置/模板恢复、手动切换、清空、素材库列表刷新导致“是否历史路径”变化时均触发。
- 触发条件：路径非空即核验；路径为空立即复位 `idle`，不发请求。
- 单路径单请求 + 请求代际：旧路径的迟到响应不会覆盖新选择。
- 浏览器态/通道缺失：`unknown`，不重试、不弹错。

### 7.3 修复动作

**【加入素材库】**（仅 `available` 可见）

1. 取当前 `s2vConfig.bgmPath` → 调 `story2videoBgmLibraryAdd`（复用媒体导入的受控复制语义：扩展名/大小/符号链接校验，Windows 占用有界重试）。
2. 成功：静默刷新素材库列表 → `s2vConfig.bgmPath = 新库内路径` → 状态复位 `idle` → toast「已将历史背景音乐保存到素材库」。
3. 失败：`bgmPath` 原样保留、状态保留 `available`（可重试），走既有 `resolveMediaImportFailure` 细分错误弹窗（格式/大小/不可读/被占用）。

**【清除背景音乐选择】**（`missing` / `unusable` 可见）

- `s2vConfig.bgmPath = ''` → 状态复位 `idle` → toast「已清除背景音乐选择」→ 启动门禁立即解除。
- 不触碰素材库、不删除磁盘文件。

**【重新检查】**（仅 `unknown` 可见）

- 对当前历史路径再发一次核验（用于“外部恢复文件后重试”）。

**【管理背景音乐】**（恒定可见）

- 打开既有素材库弹窗（添加/重命名/删除），新增/选择后 `bgmPath` 变为库内路径，历史路径自动消失。

### 7.4 compose 侧保持

- `bgmPath` 仍原样进入 `buildStory2VideoTextConfig` 的 `bgm.enabled/path/volume`。
- compose 的 `resolveReadableMediaFile` 仍按原语义在合成前二次复核；核验通过后到合成前文件被删的窗口仍由 `bgmSkipped` 降级兜底（记录 `bgmSkippedReason`，前端展示既有跳过提示）。

---

## 8. 流程

### 8.1 新选择（正常路径）

```
声音分组 → 管理背景音乐 → 添加音乐 → 主进程复制入库 → 自动选中库内路径 → 状态 idle
```

### 8.2 恢复历史配置（可用未入库）

```
恢复快照/应用配置 → bgmPath 非空且不在库 → 状态 checking
  → 核验 ok/inLibrary=false → available
  → 用户可【加入素材库】（推荐，避免临时目录清理）或保留原样直接启动
```

### 8.3 恢复历史配置（文件已丢失）

```
恢复 → checking → missing
  → 面板红色提示 + 【清除背景音乐选择】
  → 启动按钮禁用，常驻提示「所选背景音乐文件已丢失，请重新选择或清除背景音乐后再启动」
  → 用户清除或重新选择后恢复可启动
```

### 8.4 核验不可用

```
浏览器态/旧主进程 → unknown
  → 保留「已选音频（未入库）」兼容选项 + 中性提示 + 【重新检查】
  → 不阻断启动（与改造前一致）
```

### 8.5 修复后

```
加入素材库成功 → bgmPath = 库内路径 → 状态 idle → 声音摘要显示曲名 → 不再出现历史提示
```

---

## 9. 交互逻辑

### 9.1 状态 × 控件矩阵

| 状态 | 下拉选项文案 | 提示行 | 加入素材库 | 清除选择 | 重新检查 | 启动 |
|------|--------------|--------|-----------|----------|----------|------|
| `idle` | 不使用 / 库内条目 | 无 | — | — | — | 放行 |
| `checking` | 已选音频（未入库） | 正在检查… | 隐藏 | 隐藏 | 隐藏 | 放行（启动前 await） |
| `available` | 已选音频（未入库，文件可用） | 可用 + 建议入库 | **显示** | 隐藏 | 隐藏 | 放行 |
| `missing` | 已选音频（文件已丢失） | 错误态：丢失说明 + 修复指引 | 隐藏 | **显示** | 隐藏 | **禁用 + 原因** |
| `unusable` | 已选音频（无法使用） | 错误态：不可用说明 | 隐藏 | **显示** | 隐藏 | **禁用 + 原因** |
| `unknown` | 已选音频（未入库） | 中性：无法核验，按原路径尝试 | 隐藏 | 隐藏 | **显示** | 放行 |

### 9.2 交互细则

- 提示区 `role="status"` + `aria-live="polite"`，状态变化时由读屏播报；错误态提示加 `.inline-error` 视觉分级。
- 状态区仅在存在历史路径时渲染（`v-if="s2vLegacyBgmPath"`），不占常规布局。
- 按钮顺序：主修复动作在前（加入/清除），辅助动作用次按钮样式；未知态只出现【重新检查】。
- 点击【加入素材库】期间不锁全局；重复点击由既有 `story2videoBgmLibraryAdd` 语义兜底（每次都会新增库条目，属可接受；UI 在成功后立即切换为库内路径，历史提示消失）。
- 启动按钮禁用时沿用既有 `:disabled` + `:title` + `:aria-describedby` + 常驻 `.s2v-start-hint`，不新增独立弹窗。
- 文案长度：`missing` 提示约 40–60 字，保持单行/两行内；不显示文件绝对路径（隐私 + 视觉噪音）。
- 暗色模式：提示行复用既有 `config-hint` / `inline-error` 令牌，不新增颜色字面量。

---

## 10. 显示项

| 显示项 | 位置 | 说明 | testid |
|--------|------|------|--------|
| 背景音乐 label + 下拉 | 声音分组，音色 ID 之后 | 「不使用背景音乐」+ 库条目 + 历史路径选项 | `s2v-bgm-select` |
| 管理背景音乐按钮 | 下拉右侧 | 打开素材库弹窗 | `s2v-bgm-manage-button` |
| 媒体要求提示 | 下拉下方 | wav/m4a/mp3，≤15MB | —（`mediaRequirementsBgmText`） |
| 历史状态提示区 | 媒体要求提示下方，仅历史路径时 | 状态文案，`data-state` 标记 | `s2v-bgm-legacy-status` |
| 加入素材库 | 状态区内 | 仅 `available` | `s2v-bgm-adopt` |
| 清除背景音乐选择 | 状态区内 | 仅 `missing`/`unusable` | `s2v-bgm-clear` |
| 重新检查 | 状态区内 | 仅 `unknown` | `s2v-bgm-recheck` |
| 背景音乐音量 | 声音分组，背景音乐之后 | 0–10、步长 1、默认 5、双击复位 | `s2v-bgm-volume` |
| 声音分组摘要 | 折叠态 summary | `音色信息 · 背景音乐片段`（未选 BGM 时只有前者） | — |
| 启动阻塞提示 | 启动按钮下方 | 首条可修复原因 | `pipeline-blocked-reason` |

---

## 11. 提示文字（zh / en 成对）

### 11.1 `create.story2video.bgmLibrary.*`

| key | zh | en |
|-----|----|----|
| `legacyBgm`（既有） | 已选音频（未入库） | Selected audio (not in library) |
| `legacyAvailable` | 已选音频（未入库，文件可用） | Selected audio (not in library, file available) |
| `legacyMissing` | 已选音频（文件已丢失） | Selected audio (file missing) |
| `legacyUnusable` | 已选音频（无法使用） | Selected audio (unusable) |
| `legacyHintChecking` | 正在检查该音频文件是否仍可用… | Checking whether this audio file is still available… |
| `legacyHintAvailable` | 该音频来自历史配置，当前不在素材库中；文件仍可用。建议加入素材库，避免系统清理临时目录后丢失。 | This audio comes from an earlier configuration and is not in the music library, but the file is still available. Add it to the library so temporary-folder cleanup cannot remove it. |
| `legacyHintMissing` | 未找到该音频文件（可能已被系统临时目录清理或手动删除）。请重新选择背景音乐，或清除该选择后再启动，避免成片缺少背景音乐。 | The audio file is missing (it may have been removed by temporary-folder cleanup or deleted manually). Choose another track, or clear this selection before starting so the video is not rendered without music. |
| `legacyHintUnusable` | 该音频存在但无法用于合成（格式、大小或所在位置不符合要求）。请重新选择或清除该选择后再启动。 | The audio exists but cannot be used for rendering (unsupported format, size, or location). Choose another track or clear this selection before starting. |
| `legacyHintUnknown` | 当前环境无法核验该音频是否仍可用；合成时会按原路径尝试使用。 | This environment cannot verify whether the audio is still available; rendering will try the original path. |
| `adoptAction` | 加入素材库 | Add to library |
| `adoptSuccess` | 已将历史背景音乐保存到素材库 | Saved the earlier background music to the library |
| `clearAction` | 清除背景音乐选择 | Clear background music selection |
| `clearedToast` | 已清除背景音乐选择 | Background music selection cleared |
| `verifyRetry` | 重新检查 | Check again |

### 11.2 `create.story2video.ui.blockedReason.*`

| key | zh | en |
|-----|----|----|
| `bgmLost` | 所选背景音乐文件已丢失，请重新选择或清除背景音乐后再启动 | The selected background music file is missing. Choose another track or clear it before starting. |
| `bgmUnusable` | 所选背景音乐无法使用，请重新选择或清除背景音乐后再启动 | The selected background music cannot be used. Choose another track or clear it before starting. |

### 11.3 `create.story2video.ui.summaryBgm*.*`

| key | zh | en |
|-----|----|----|
| `summaryBgmLibrary` | 背景音乐 {name} | Music: {name} |
| `summaryBgmLegacyAvailable` | 背景音乐（历史音频） | Music (legacy audio) |
| `summaryBgmLegacyMissing` | 背景音乐文件已丢失 | Music file missing |
| `summaryBgmLegacyUnusable` | 背景音乐不可用 | Music unavailable |

> 未选背景音乐时不追加摘要片段，故不设「无背景音乐」摘要 key（避免把默认态文案变化带进像素基线）。

---

## 12. 错误处理与边界

| 场景 | 处理 |
|------|------|
| 核验通道缺失/浏览器态 | `unknown`，不阻断、不弹错；面板显示中性提示与【重新检查】 |
| 核验 IPC 返回 `code<0` | 同上（失败开放）；不把“无法核验”写成“已丢失” |
| 加入素材库失败（格式/大小/不可读/占用） | `bgmPath` 不变、状态保留 `available`；复用 `resolveMediaImportFailure` 细分弹窗 |
| 加入素材库时源文件已被删除 | 上述失败路径（`媒体文件不存在或不可读`），可随后重新核验转为 `missing` |
| 用户删除当前选中的库条目 | 既有语义：`confirmBgmDelete` 检测到删除项即当前 `bgmPath` 时回退为空，状态复位 `idle` |
| 素材库文件被外部删除 | `list()` 自愈移除索引；若当前 `bgmPath` 指向该路径 → 变为历史路径 → 核验 `missing` → 阻断并可清除 |
| 路径含 `/` 或超长/相对路径 | 主进程 `invalid_argument` → 渲染层 `unknown`（不触盘） |
| 文件被其他程序占用 | 主进程只做 `lstat`/`readable` 判断，不打开内容；加入素材库时复用占用重试语义 |
| 合成前文件被删（核验后窗口） | compose `bgmSkipped` 降级 + 既有跳过提示（最后防线，不整线失败） |
| 用户不想要该背景音乐 | 【清除背景音乐选择】或下拉选「不使用背景音乐」 |

---

## 13. 兼容与迁移

- 历史 `bgmPath` 在用户显式操作前**不清空、不改写**；快照/配置/历史项目语义不变。
- `bgmPath` 字段名、类型、compose 参数合同不变。
- 素材库 `library.json` 格式与索引版本不变；`inspectPath` 只读，不写索引、不触发自愈写。
- 运营后台 `visibility` 的 optionKey 不变（`voice.bgm` / `voice.bgmVolume`），迁移后隐藏行为与分组归属一致。
- 旧主进程（未升级）下新 preload/API 不存在 → `unknown` → 行为回退为改造前，不阻断。
- 迁移无需数据库/文件迁移步骤；BGM 仍是设备级资源。

---

## 14. 测试计划

| 层 | 文件 | 覆盖 |
|----|------|------|
| 服务 | `electron/services/story2video-bgm-library.test.js` | `inspectPath` 判定矩阵 8 例（库内命中/缺失/格式/超限/越界/符号链接/目录/非法入参） |
| IPC | `electron/ipc-handlers/story2video.test.js` | 透传 + 参数校验（7 种非法入参，不触盘） |
| 权限/preload | `electron/preload.test.js` | `PUBLIC_METHODS` + `PUBLIC_CHANNELS` 公开；键数锁同步（publish 131 / 总 344） |
| composable | `src/views/video-creation/composables/useBgmLibrary.test.js` | 状态映射、请求代际、adopt 成功/失败、clear、空路径 |
| 面板 | `src/views/video-creation/S2vConfigPanels.test.js` | 分组归属（voice 内 / appearance 无）、available/missing/checking 渲染与按钮转发 |
| 壳 | `src/views/CreateView.test.js` | 核验触发、missing 阻断与清除、adopt 自动选中、unknown 不阻断、声音摘要 |
| 契约 | `src/views/video-creation/s2v-panel-contract.parent-keys.test.js` | 新状态/方法在 CreateView 真实存在 |
| 门禁 | `.github/scripts/check-locale-sync.js` | zh/en 成对、key 存在、无新增硬编码中文 |
| 打包 | QM-1 | `electron-builder --win --dir`、asar 清单、require 链、启动 8 秒 stderr 三层判据 |

---

## 15. 验收标准

1. 「声音」分组内出现「背景音乐」下拉与「背景音乐音量」滑杆；「画面」分组内不再出现二者（面板测试 + 页面实测）。
2. 历史 `bgmPath` 仍可用时：显示「已选音频（未入库，文件可用）」+ 可用提示 +【加入素材库】；点击后文件入库、`bgmPath` 更新为库内路径、提示消失。
3. 历史 `bgmPath` 已丢失时：显示「已选音频（文件已丢失）」+ 错误态提示 +【清除背景音乐选择】；启动按钮禁用，提示「所选背景音乐文件已丢失…」；清除后恢复可启动。
4. 文件存在但格式/大小/位置不满足时：`unusable`，同样阻断并可清除。
5. 核验通道不可用（浏览器/旧主进程）：状态 `unknown`，不阻断启动、无错误弹窗、无新增噪音。
6. 历史配置在用户操作前不被改写；删除库条目/外部删文件后的语义与既有实现一致。
7. 定向测试全绿（服务 24、IPC/preload/paths 518 批量、composable 16、面板 11、契约 5、CreateView 300），locale 三口径 PASS，ESLint 0 error。
8. QM-1 打包成功，asar 含 `story2video-bgm-library.js`，require 链通过，打包 exe 8 秒存活且 stderr 三层判据通过。
9. 文档同步：本 PRD、`PRD-S2V-PIPELINE-PAGE-UX.md`、`PRD-video-creation.md`、OpenSpec spec delta、CHANGELOG、learnings 均落地。

---

## 16. 风险与回退

| 风险 | 可能性 | 影响 | 缓解 | 回退 |
|------|--------|------|------|------|
| 启动门禁过严卡住用户 | 低 | 无法启动 | 仅“已确认 missing/unusable”阻断；提供一键清除；`unknown` 不阻断 | 删除 `canStartPipeline` 中的 BGM 分支即恢复旧行为 |
| inspect 调用频率放大 | 低 | IPC 噪音 | 只在历史路径变化时触发；单路径单请求；代际丢弃 | 关闭 watcher，保留手动重试 |
| 旧主进程无通道 | 中 | 无核验 | `unknown` 失败开放 | 无需回退 |
| 页面模板迁移误删控件 | 低 | 配置不可编辑 | 保留全部 testid；面板测试断言归属 | 单 commit revert |
| 文案未成对/硬编码 | 低 | CI 红 | locale 三口径本地先跑 | 补齐 en/zh |
| 加入素材库重复点击产生多份副本 | 低 | 磁盘占用 | 成功后立即切换为库内路径，历史提示消失 | 删除多余库条目（既有删除功能） |

---

## 17. 变更清单

| 层 | 文件 |
|----|------|
| 主进程服务 | `electron/services/story2video-paths.js`（导出 `toLocalPath` / `getMediaRule`）、`electron/services/story2video-bgm-library.js`（`inspectPath`、`allowedRoots`） |
| 主进程 IPC/权限 | `electron/ipc-handlers/story2video.js`、`electron/ipc-handlers/license-access-control.js` |
| preload | `electron/preload/publish.js`、`electron/preload/access-control.js` |
| renderer API | `src/api/publisher.js` |
| composable | `src/views/video-creation/composables/useBgmLibrary.js` |
| 壳/面板/契约 | `src/views/CreateView.vue`、`src/views/video-creation/S2vConfigPanels.vue`、`src/views/video-creation/s2v-panel-contract.js` |
| locales | `src/locales/create/zh.js`、`src/locales/create/en.js` |
| 测试 | 上述模块同名测试 + `CreateView.voice-clone-delete-guard.test.js`、`s2v-options-autosave.test.js` 的 API mock 清单 |
| 文档 | 本 PRD、`PRD-S2V-PIPELINE-PAGE-UX.md`、`PRD-video-creation.md`、OpenSpec change 五件套、`CHANGELOG.md`、`01-docs/learnings.md` |
