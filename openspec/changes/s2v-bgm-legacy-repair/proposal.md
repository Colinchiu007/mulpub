# 背景音乐分组归属修正 + 历史音频存在性修复（s2v-bgm-legacy-repair）

## Why

用户真实反馈两个问题（2026-10-17）：

1. **分组归属错位**：故事讲述流水线详情页把「背景音乐」和「背景音乐音量」放在「画面」折叠区，而二者描述的是声音，用户找不到、且与「声音」区的旁白音色割裂。二者 optionKey 早已是 `voice.bgm` / `voice.bgmVolume`（`PRD-S2V-PIPELINE-PAGE-UX.md` §11.4 已登记），只是模板物理位置留在 `appearance` 分组，属渲染实现与运营选项目录不一致。
2. **「已选音频（未入库）」语义含混**：BGM 下拉在“当前 `s2vConfig.bgmPath` 不在素材库中”时追加该选项。它只做**索引成员判定**，不做文件存在性判定，因此无法区分三种本质不同的状态：
   - 文件仍在、可用，只是没进素材库（旧版本直接选本地文件 / 历史模板 / 配置快照）；
   - 文件已被清理（`%TEMP%\story2video\selected-media` 的 7 天惰性老化回收、操作系统临时目录清理、手动删除）；
   - 文件仍在但已不可用（格式/大小/位置不满足 compose 的受控读取合同）。

   第二种与第三种在用户界面上都表现为“未入库”，用户点「启动流水线」后 compose 按既有降级语义 `bgmSkipped` **静默跳过背景音乐**——花了几分钟与额度，成片却没有音乐，且用户此前没有任何可操作提示。

### 根因溯源（QM-5 ①）

- 2026-08-14 之前：BGM 走单文件选择 → `story2videoImportMedia` 复制到 `%TEMP%\story2video\selected-media\bgm-*.mp3`，`s2vConfig.bgmPath` 指向该临时路径；`lastOptions` 快照、配置快照与历史记录都持久化该路径。
- `story2video-paths.js` 的 `gcImportedMedia` 对 `selected-media` 实施 **7 天**惰性老化回收（`DEFAULT_IMPORTED_MEDIA_MAX_AGE_MS`），操作系统也会清理 `%TEMP%`。文件消失后，快照里的绝对路径成为悬空路径。
- 2026-08-14 的 BGM 素材库把**新选择**落到 `userData/story2video-bgm/`（持久目录），但没有迁移/校验**旧快照里的临时路径**，于是“未入库”选项长期存在，且没有存在性信息。

### 逃逸链（QM-5 ②）

| 层级 | 为什么没拦住 |
|------|--------------|
| 单元测试 | `s2vLegacyBgmPath` 用固定字符串路径断言“不在库即显示”，从不校验文件是否存在 |
| 组件测试 | 无「文件已丢失」状态用例；`CreateView.test.js` 只断言 `s2vLegacyBgmPath` 等于给定路径 |
| 集成/E2E | 真实 Electron 验证只覆盖“新选 BGM → 采样受控路径”，未覆盖“7 天后旧临时路径失效” |
| 代码审查 | 「未入库」被当作纯兼容分支，未追问“未入库的文件还在吗”；compose 的 `bgmSkipped` 降级被当成兜底，掩盖了前置可发现性 |

### 系统性漏洞（QM-5 ③）

`apps/desktop/src/views/CreateView.vue` 的 `s2vLegacyBgmPath` 只读前端内存中的 `s2vBgmLibrary`（主进程 `list()` 的自愈只清理“库索引里文件缺失”的条目），renderer 没有任何**文件系统可见性**——主进程也从未提供“给定 BGM 路径是否可被 compose 读取”的只读查询通道。既有信息面（`story2video:bgm-library-list`）回答的是“库里有什么”，无法回答“当前配置引用的那个文件还在不在”。

## What Changes

1. **分组迁移（纯渲染层）**
   - `S2vConfigPanels.vue`：把「背景音乐」`UiField`（`voice.bgm`）与「背景音乐音量」`UiSlider`（`voice.bgmVolume`）从 `appearance` 折叠区移动到 `voice` 折叠区（位置：旁白「语音 / 音色 ID」之后、音色克隆面板之前）。
   - `CreateView.vue`：`S2V_SUMMARY_FIELDS.voice` 纳入 `bgmPath` / `bgmVolume`；`s2vSectionSummary('voice')` 追加背景音乐摘要（库内曲名 / 历史音频 / 文件已丢失 / 无背景音乐）。
   - 运营选项目录与 PRD 的 `voice.bgm` / `voice.bgmVolume` 归属保持一致，不改 optionKey，不改持久化字段。

2. **主进程只读状态通道（新增 IPC）**
   - `story2video-bgm-library.js` 新增 `inspectPath(candidate)`：复用 `story2video-paths.js` 的 `toLocalPath` / `getMediaRule` / `resolveReadableMediaFile` / `isPathWithin(getAllowedMediaRoots())` 合同，返回
     `{ path, exists, readable, size, extension, inLibrary, libraryItemId, reason }`，
     `reason ∈ ok | invalid_argument | format_unsupported | missing | not_a_file | size_exceeded | not_allowed | unreadable`。
   - 新增 IPC `story2video:bgm-library-status`（`withSenderCheck` + 参数校验），加入主进程 `PUBLIC_CHANNELS`、preload `PUBLIC_METHODS` 与 renderer `publisher.js` 封装 `story2videoBgmLibraryStatus`。
   - 安全边界：只对音频扩展名（`.wav/.m4a/.mp3`）做 `stat`，非音频扩展名在 `stat` 之前即返回 `format_unsupported`，避免成为任意路径存在性探测口。

3. **渲染层状态机与一键修复**
   - `useBgmLibrary.js`：新增 `s2vLegacyBgmStatus` 状态（`idle/checking/available/missing/unusable/unknown`）与 `verifyLegacyBgmLibraryPath` / `adoptLegacyBgmLibrary` / `clearLegacyBgmLibrary` 方法；请求代际防串（旧响应不覆盖新路径）。
   - `CreateView.vue`：watch `s2vLegacyBgmPath` 触发核验；`s2vLegacyBgmStatus` 经父子契约投影给面板。
   - `S2vConfigPanels.vue`：「背景音乐」控件下方按状态显示提示行与操作按钮：
     - `checking`：显示“正在检查该音频是否可用…”；
     - `available`：提示“历史引用的本地文件仍可用、未入库”，提供【加入素材库】（复用 `bgm-library-add`，成功后自动选中库内新路径）；
     - `missing`：提示“文件已丢失（可能被系统临时目录清理或手动删除）”，提供【清除背景音乐选择】；
     - `unusable`：提示“格式/大小/位置不符合要求”，提供【清除背景音乐选择】；
     - `unknown`（浏览器态 / IPC 不可用）：保持既有兼容行为，不阻断、不新增噪音。
   - 启动门禁：`missing` / `unusable` 时 `canStartPipeline=false`，`pipelineBlockedReason` 给出首条可修复原因；`checking` 时在真正启动前 `await` 一次核验，避免竞态下静默丢 BGM。
   - 失败开放原则：`unknown` 绝不阻断启动（测试/浏览器/旧主进程等无该通道时行为与改造前一致）。

4. **兼容与迁移**
   - 历史 `bgmPath` 仍完整保留在 `s2vConfig` 与快照里，不清空、不改写，除非用户显式点【清除】或【加入素材库】。
   - compose 的 `bgmSkipped` 降级语义保持不变，作为最后防线（例如核验后到合成前文件被删的窗口）。

5. **文档、测试与记忆**
   - 新增详细 PRD（数据校验 / 流程 / 功能逻辑 / 交互 / 显示项 / 提示文字 / 测试 / 验收 / 风险）。
   - 同步 `PRD-S2V-PIPELINE-PAGE-UX.md`、`PRD-video-creation.md`、OpenSpec spec delta、CHANGELOG、learnings 与三路记忆。
   - 回归测试：服务层 `inspectPath` 8 例、IPC 2 例、preload/权限 1 例、composable 状态机 6 例、面板分组归属 2 例 + 状态渲染 3 例、CreateView 门禁/修复 4 例。

## Non-goals

- 不做“启动时全盘扫描/自动迁移历史 BGM 到素材库”（静默复制会改变用户磁盘状态与路径，且多快照会重复复制；本次只给显式一键操作）。
- 不改 BGM 素材库的存储格式、索引迁移与 compose 混音实现。
- 不改动 `bgmPath` 在提交 payload 中的字段名/语义（仍为绝对路径字符串），避免影响历史项目与快照兼容。
- 不为“未入库但可用”的路径做跨设备同步或云备份。

## Impact

- 渲染端：`S2vConfigPanels.vue`、`CreateView.vue`、`composables/useBgmLibrary.js`、`s2v-panel-contract.js`、`api/publisher.js`、`locales/create/{zh,en}.js`。
- 主进程：`services/story2video-paths.js`（导出两个既有内部助手）、`services/story2video-bgm-library.js`、`ipc-handlers/story2video.js`、`ipc-handlers/license-access-control.js`、`preload/publish.js`、`preload/access-control.js`。
- 测试：上述模块对应测试 + 3 个 CreateView 挂载测试的 API mock 清单。
- 文档：新 PRD、两篇既有 PRD、OpenSpec spec delta、CHANGELOG、learnings。
- 不改数据库 schema、不改 IPC 既有通道语义、不改 CI 工作流。
