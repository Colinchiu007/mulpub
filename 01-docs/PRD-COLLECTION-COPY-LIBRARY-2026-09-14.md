# PRD — 采集页「文案库」标签页

> **⚠️ 已被取代（2026-09-16）**：本 PRD 的三标签设计已由 `PRD-COLLECTION-LIBRARY-MERGE-2026-09-16.md`（采集记录 + 文案库两标签合并）取代。本文档 §4 数据校验与 §10 存储契约（`collected_items` / `copy_library_rewrites` / fromKey 形态）仍然有效，作为合并版的数据契约引用。

- 文档编号：PRD-COLLECTION-COPY-LIBRARY-2026-09-14
- 状态：已实现（被合并版取代）
- 关联分支：`codex/collection-copy-library`
- 关联模块：`apps/desktop/src/views/Collection.vue`、`apps/desktop/src/components/CopyLibraryPanel.vue`、`apps/desktop/src/components/CopyRewriteModal.vue`、`apps/desktop/src/composables/useCopyLibrary.js`
- 创建日期：2026-09-14

## 1. 背景与目标

采集页（`/collection`）目前有两个标签：「内容采集」（采集入口 + 采集结果 + 草稿箱）与「采集记录」（历史采集结果卡片网格，见 PRD-COLLECTION-RECORDS-TAB-2026-09-10）。

用户的真实工作流是「采集正文 → 改写 → 复用文案」，但两侧内容分散：

- **采集到的正文**只出现在「采集记录」里；
- **改写后的文案**只存在于改写结果框（刷新即丢），需要用户手动「存入草稿」才会留痕，且与採集正文不在同一列表里，无法一眼看出"哪些是原文、哪些是改写稿"。

本需求在采集页新增第三个标签 **文案库**，把「采集到的正文」与「改写后的文案」聚合成一个文案列表，用**性质标识**区分来源，并让**每一条文案都能直接发起改写**（弹窗内提供全部改写选项）。

### 1.1 目标

1. 一站式查看所有文案（采集正文 + 改写文案），带「采集 / 改写」性质标识。
2. 列表内任意文案右侧可点【改写】→ 弹窗选择改写选项 → 改写结果自动回到文案库（标识为「改写」）。
3. 不改动既有「内容采集」「采集记录」标签的行为；采集正文不重复存储（单一数据源）。

### 1.2 非目标

- 不做文案库的跨设备同步 / 云端存储。
- 不做文案库的富文本编辑（编辑仍走既有「创建草稿 → 内容编辑页」链路）。
- 不引入跨页面（例如 `/rewrite` 文案改写页）写入文案库的联动（见 §9 已知边界）。

## 2. 术语定义

| 术语 | 含义 |
|------|------|
| 文案 | 一篇可直接使用或继续加工的文章正文（可能是采集原文，也可能是改写稿） |
| 采集正文 | 由采集流程落库的 `collected_items` 条目的 `content`（无 `content` 时回退 `description`） |
| 改写文案 | 由改写引擎（`ai:rewrite` → `RewriteEngineService`）产出的正文，落库在 `copy_library_rewrites` |
| 来源键 fromKey | 改写记录的溯源键：`collect:<采集记录 id>` 或 `rewrite:<改写记录 id>` |
| 性质标识 | 列表卡片上的「采集」/「改写」徽标 |

## 3. 功能范围

### 3.1 标签切换（P0）

- 顶部标签组扩展为三个：**内容采集**（`collect`）、**采集记录**（`records`）、**文案库**（`library`）。
- 默认选中「内容采集」。
- 仅 `collect` / `records` / `library` 为合法值，其他值忽略（保持当前标签）。
- 保持 `role="tablist"` / `role="tab"` / `aria-selected` 无障碍语义；三个标签共用同一 `switchTab` 入口与 `activeTab` 状态。
- 「文案库」面板按 `v-else-if` 惰性挂载：切到该标签才加载数据，切走即卸载（下次进入重新读取，保证与「内容采集」最新采集结果一致）。

### 3.2 文案库列表（P0）

列表 = **采集正文（实时合成）+ 改写文案（持久化）** 的并集：

| 来源 | 数据来源 | 是否复制存储 |
|------|----------|--------------|
| 采集 | `collected_items`（settings，既有键） | 否（读取时合成，避免正文重复占空间与双写漂移） |
| 改写 | `copy_library_rewrites`（settings，本需求新增键） | 是 |

- 文案库直接读取 `collected_items`，因此「内容采集」标签新采集的正文无需额外写入即可出现在文案库。
- 合并后按 `createdAt` 倒序；无 `createdAt` 的条目保持原有相对顺序排在末尾（稳定排序）。
- `content` 与 `description` 同时为空的采集条目**不进入**文案库（无正文无法改写）。
- 缺少 `id` 的条目被丢弃（避免列表 key 冲突）。

### 3.3 性质标识（P0）

- 每条文案标题前展示徽标：采集 → 「采集」（蓝色系），改写 → 「改写」（主题色系）。
- 徽标文案走 i18n（`collection.libraryOriginCollect` / `collection.libraryOriginRewrite`）。
- 图标区分：采集 `📰`，改写 `✨`。

### 3.4 筛选（P1）

- 列表头部提供 3 个筛选按钮：**全部** / **采集** / **改写**，默认「全部」。
- 筛选只影响展示，不改变数据；筛选后为空时展示独立的筛选空态文案。
- 计数展示**全部条数**（不随筛选变化），避免用户误以为数据丢失。

### 3.5 行内操作（P0）

| 操作 | 位置 | 行为 |
|------|------|------|
| 查看 | 卡片操作区左 | 打开只读预览弹窗，展示全文（长文本换行契约见 §6.3） |
| 改写 | 卡片操作区最右（主按钮） | 打开「改写文案」弹窗，携带该条文案的 `title` / `content` / `platform` / `sourceUrl` 与来源键 |

### 3.6 改写弹窗（P0）

弹窗标题「改写文案」，包含改写相关的全部选项：

| 区块 | 控件 | 取值 | 默认 |
|------|------|------|------|
| 原文 | 只读文本域 + 标题 + 字数 | — | 来自列表项 |
| 改写模式 | 3 个 chip | `imitate` / `expand` / `create` | `imitate` |
| 改写风格 | 下拉 | `casual` / `formal` / `catchy` / `professional` / `anchor`（→ `userSettings.tone`） | `casual` |
| 改写参考 | 2 个复选框 | 结合爆款库（`useViralLibrary`）/ 结合个人经历（`usePersonalKnowledge`） | 爆款库开、个人经历关 |
| 目标字数 | 区间输入（min/max） | min 0–5999、max 1–6000、max ≥ min | 800–2000 |
| 目标平台 | 下拉 | 通用 / 抖音 / 小红书 / 公众号 / B 站 / 知乎 | 通用 |
| 改写策略 | 单选 + 下拉 | 自动匹配（`strategyId=null`）/ 手动选择具体策略 | 自动匹配，并展示匹配预览 |

- 底部按钮：**关闭**（改写中禁用）、**开始改写**（改写中变为「改写中...」并禁用；原文为空或字数区间非法时禁用）。
- 改写成功后弹窗内展示「改写结果」只读文本域 + 提示「改写完成，已存入文案库」；结果由父组件（文案库面板）落库。
- 改写失败时弹窗内展示友好错误文案（经 `formatUserError` + i18n），并弹出错误提示，不写库。

### 3.7 改写落库规则（P0）

- 落库键 `copy_library_rewrites`，与 `collected_items` 同层（settings），按登录用户命名空间隔离。
- **同一来源（fromKey）只保留最新一次改写结果**：重复改写同一篇文案是「更新」而非「追加」，避免同一原文的多次改写刷屏。
- 不同来源各自保留一条；链式改写（对改写稿再改写）产生新来源键 `rewrite:<改写记录 id>`，与源记录共存。
- 上限 200 条，超出时丢弃最旧记录（防 settings 无限膨胀）。
- 空内容不落库。
- **采集页内既有改写路径同样落库**：`rewriteCollected`、`collectAndRewrite`（视频通道 / stealth 通道 / 聚合通道）改写成功后，按 `collect:<采集记录 id>` 写入/更新文案库；写入失败静默（文案库是旁路，不影响改写主流程）。

## 4. 数据校验

### 4.1 采集条目（合成输入）

| 字段 | 类型 | 规则 |
|------|------|------|
| `id` | string | 必填；缺失则该条目不进入文案库 |
| `title` | string | 可空；空值渲染为「无标题」 |
| `content` / `description` | string | 二者至少一个非空；`content` 优先 |
| `wordCount` | number | 可空；缺省回退 `content.length` |
| `platform` | string | 可空 |
| `sourceUrl` | string | 可空 |
| `createdAt` / `collectedAt` / `created_at` | string | 按此优先级取第一个非空；全空则不展示时间 |

### 4.2 改写记录（落库输出）

| 字段 | 类型 | 规则 |
|------|------|------|
| `id` | string | 必填；同一 fromKey 复用时沿用既有 id |
| `fromKey` | string | 可空（手工写入时）；用于去重更新 |
| `fromTitle` | string | 截断 200 字符 |
| `title` | string | 截断 200 字符；空值渲染「无标题」 |
| `content` | string | 必填且 trim 后非空，否则不落库 |
| `wordCount` | number | 落库时按 `content.length` 计算（不信任调用方） |
| `platform` | string | 截断 50 字符 |
| `sourceUrl` | string | 截断 2048 字符 |
| `createdAt` | string | 落库时生成 ISO 时间（每次改写刷新） |

### 4.3 反序列化防御

- `collected_items` / `copy_library_rewrites` 读取时：`JSON.parse` 失败或结果非数组 → fail-closed 为 `[]`，不抛异常。
- 读取不可用（`storeGetSetting` 返回 `null`）→ **保持内存现状**，不用空数组覆盖（避免把已有列表清空）。
- 写入前重新读取磁盘现状（而非只用内存副本）后再合并写回：采集页与文案库面板各持一份 composable 实例，只用内存会互相覆盖。

### 4.4 字数区间校验（复用既有契约）

`min` 0–5999 整数、`max` 1–6000 整数、`max ≥ min`；清空输入（`''`）视为非法。错误文案走 `collection.wordCountMinInvalid` / `wordCountMaxInvalid` / `wordCountMaxLtMin`。

## 5. 流程与功能逻辑

### 5.1 打开文案库

1. 用户点击「文案库」标签 → `switchTab('library')`。
2. 面板挂载 → 并行 `storeGetSetting('collected_items')` + `storeGetSetting('copy_library_rewrites')`。
3. 合成列表 → 应用当前筛选 → 渲染卡片网格 / 空状态。

### 5.2 文案库内改写

1. 点击某条文案的【改写】→ 打开弹窗（携带来源键 = 列表项 id）。
2. 用户调整选项 → 点击【开始改写】。
3. 校验：原文非空 → 字数区间合法 → 组装参数 → `aiRewrite`。
4. 成功：弹窗展示结果 → `emit('rewritten', payload)` → 面板 `upsertRewrite` 落库 → 提示「改写完成」。
5. 失败：弹窗展示错误 + 错误提示；不落库。

### 5.3 采集页内改写（既有路径）

- `rewriteCollected` / `collectAndRewrite` 改写成功后追加一步 `recordRewriteToLibrary(content, sourceItem)`：
  1. 以 `collect:<采集记录 id>` 为来源键组装记录；
  2. `upsertRewrite` → 读磁盘现状 → 去重合并 → 落库。
- 该步骤异常时静默（`try/catch`），不改变既有改写成功/失败提示。

### 5.4 请求参数契约（与改写引擎对齐）

```
{
  mode: 'imitate' | 'expand' | 'create',
  content: <待改写原文>,
  userSettings: {
    tone: 'casual' | 'formal' | 'catchy' | 'professional' | 'anchor',
    platform: <平台 id 或 undefined>,
    wordCountRange: { min, max },     // 引擎主约束（_postProcess 上限优先取 wordCountRange.max）
    targetLength: 'short' | 'medium' | 'long',
    knowledgeOptions: { useViralLibrary, usePersonalKnowledge },
  },
  strategyId: <手动模式为策略 id，自动模式为 null>,
}
```

`targetLength` 由字数区间派生（`max ≤ 800 → short`；`min ≥ 1500 或 max ≥ 2500 → long`；其余 `medium`），与采集页既有映射保持一致。

## 6. 交互逻辑与显示项

### 6.1 列表卡片显示项

| 位置 | 显示内容 |
|------|----------|
| 图标 | 采集 `📰` / 改写 `✨` |
| 标题行 | 性质徽标 + 标题（空则「无标题」，超长省略号截断） |
| 元信息行 | 字数 · 时间（采集：「采集于 xxx」/ 改写：「改写于 xxx」；无时间则整段省略）· 改写来源（改写稿且 `fromTitle` 非空时：「改写自：xxx」） |
| 操作区 | 「查看」（次按钮）、「改写」（主按钮，位于最右） |

### 6.2 交互约束

| 场景 | 行为 |
|------|------|
| 切换标签 | 文案库面板卸载，内存态（筛选、弹窗、预览）随之复位 |
| 改写进行中 | 弹窗内所有选项、关闭按钮禁用；重复点击【开始改写】无效（按钮 disabled） |
| 原文为空 | 【开始改写】禁用；即使被调用也提示「该文案没有正文内容，无法改写」 |
| 字数区间非法 | 【开始改写】禁用，并展示区间错误文案 |
| 快速切换目标平台 | 自动匹配预览带请求序列号守卫，只保留最后一次结果 |
| 弹窗关闭 | 点击遮罩（`@click.self`）、关闭按钮或底部【关闭】均可关闭；改写中不可关闭 |
| 预览关闭 | 点击遮罩或关闭按钮关闭 |

### 6.3 长文本换行契约

预览正文容器 `.copy-preview-content` 必须显式声明：

```css
white-space: pre-wrap;
overflow-wrap: anywhere;
word-break: break-word;
```

并由 `CopyLibraryPanel.test.js` 的源码级 CSS 契约测试守住（jsdom 不应用 scoped 样式，纯样式缺陷单测不可见）。

### 6.4 无障碍

- 弹窗 `role="dialog"` + `aria-modal="true"` + `aria-label`（无硬编码中文）。
- 筛选组 `role="group"` + `aria-label`；筛选按钮 `aria-pressed` 反映选中态。
- 面板 `role="tabpanel"` + `aria-label`。

## 7. 提示文字

| 场景 | i18n key | 中文 |
|------|----------|------|
| 标签名 | `collection.tabLibrary` | 文案库 |
| 面板标题 | `collection.libraryTitle` | 文案库 |
| 计数 | `collection.libraryCount` | 共 {count} 篇 |
| 筛选组标签 | `collection.libraryFilterLabel` | 文案筛选 |
| 筛选：全部/采集/改写 | `libraryFilterAll` / `libraryOriginCollect` / `libraryOriginRewrite` | 全部 / 采集 / 改写 |
| 空态 | `libraryEmptyTitle` / `libraryEmptyDesc` | 暂无文案 / 在「内容采集」采集文章，或对已有文案点击「改写」后，会在这里生成文案列表 |
| 筛选空态 | `libraryFilterEmptyTitle` / `libraryFilterEmptyDesc` | 当前筛选下暂无文案 / 切换筛选条件查看其他文案 |
| 无标题 | `libraryUntitled` | 无标题 |
| 字数 | `libraryWordCount` | {count} 字 |
| 时间 | `libraryCollectedAt` / `libraryRewrittenAt` | 采集于 {time} / 改写于 {time} |
| 改写来源 | `libraryFrom` | 改写自：{title} |
| 行内操作 | `libraryView` / `libraryRewrite` | 查看 / 改写 |
| 预览标题 / 关闭 | `libraryPreviewTitle` / `libraryClose` | 文案内容 / 关闭 |
| 弹窗标题 | `libraryRewriteModalTitle` | 改写文案 |
| 选项分组 | `libraryRewriteOptions` / `libraryRewriteStyle` / `libraryRewriteKnowledge` / `libraryRewriteLength` / `libraryRewritePlatform` / `librarySourceSection` / `libraryResultSection` | 改写选项 / 改写风格 / 改写参考 / 目标字数 / 目标平台 / 原文 / 改写结果 |
| 按钮 | `libraryRewriteStart` / `libraryRewriteStarting` | 开始改写 / 改写中... |
| 成功 | `libraryRewriteDone` / `collection.rewriteSuccess` | 改写完成，已存入文案库 / 改写完成 |
| 原文为空 | `libraryRewriteNoContent` | 该文案没有正文内容，无法改写 |
| 改写失败 | `collection.rewriteFailed` | AI 改写失败（详情经 `formatUserError` 展示） |

> 弹窗内其余文案（改写模式、知识参考、策略、平台名、字数占位、风格名）**复用既有 key**（`rewritePage.*` / `rewriteEngine.platform*` / `collection.rewriteStyle*` / `collection.wordCount*`），不新增重复语料。zh / en 成对提交。

## 8. 验收标准

1. 采集页顶部出现三个标签，「文案库」可点击切换，切走再切回能读到最新采集结果。
2. 文案库列出「采集记录」中的正文（徽标「采集」）与改写产出的文案（徽标「改写」）。
3. 无任何文案时展示空态；筛选无命中时展示筛选空态。
4. 每条文案最右侧有【改写】按钮，点击弹出含全部改写选项的弹窗。
5. 弹窗改写成功后，文案库出现/更新对应「改写」条目，并提示成功。
6. 同一来源重复改写只保留最新结果（列表条数不增长）。
7. 采集页内「改写 / 一键改写」成功后，其结果同样出现在文案库。
8. 原文为空、字数区间非法时无法提交并给出提示。
9. 改写失败展示友好文案（不含环境变量名等技术细节），且不写库。
10. 筛选（全部/采集/改写）与「查看」预览功能正常；预览长文本正常换行。
11. 既有「内容采集」「采集记录」标签行为与测试不受影响。
12. `--cjk` / `--keys` / `--pair-base` 三项 i18n 门禁与 ESLint（error 级）通过。

## 9. 已知边界与后续

| 边界 | 说明 | 后续 |
|------|------|------|
| `/rewrite` 文案改写页的改写结果不入文案库 | 本需求范围限定采集页；两页写入通道不同 | 可后续把 `useCopyLibrary` 接入改写页 |
| 历史采集记录无 `createdAt` | 旧数据无真实采集时间可考，首次再次落盘时补记为当时时间；展示上无时间则省略该段 | 无 |
| 文案库条目不能删除 | 本需求未要求删除能力；删除采集正文仍走「采集记录」的删除 | 可按需补 `removeRewrite`（数据层已提供） |
| 改写稿与草稿箱不联动 | 「存入草稿 / 去发布」仍在「内容采集」标签的改写结果区完成 | 无 |

## 10. 实现要点

- 数据层：`src/composables/useCopyLibrary.js`（`COPY_REWRITES_KEY`、`buildCopyLibraryItems`、`collectFromKey`、`upsertRewrite`、`removeRewrite`、`load`、`MAX_COPY_REWRITES=200`）。
- 面板：`src/components/CopyLibraryPanel.vue`（列表 + 徽标 + 筛选 + 预览 + 挂载改写弹窗 + 落库）。
- 弹窗：`src/components/CopyRewriteModal.vue`（全部改写选项 + `aiRewrite` 调用 + 失败友好文案；不含存储，便于复用与单测）。
- 采集页：`Collection.vue` 新增第三个标签、`TAB_KEYS` 白名单、`CopyLibraryPanel` 惰性挂载、`recordRewriteToLibrary` 旁路写入；`saveCollectedItems` 顺带补全 `createdAt`（作为时间展示依据，也是「采集记录」时间列的改善）。
- 测试：`useCopyLibrary.test.js`（数据层 16 例）、`CopyRewriteModal.test.js`（8 例）、`CopyLibraryPanel.test.js`（10 例）、`Collection.test.js`（新增 4 例标签与落库回归）。
