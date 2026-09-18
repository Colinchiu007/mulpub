# PRD — 采集页「文案库」合并（采集记录 + 文案库 两标签合一）

- 文档编号：PRD-COLLECTION-LIBRARY-MERGE-2026-09-16
- 状态：已实现
- 关联分支：`mp-copy-library-merge`
- 取代文档：`PRD-COLLECTION-COPY-LIBRARY-2026-09-14.md`（三标签设计，本需求将其合并为两标签；该文档的数据契约 §4、存储契约 §10 仍然有效）
- 关联文档：`PRD-COLLECTION-RECORDS-TAB-2026-09-10.md`（采集记录卡片规范）、`PRD-REWRITE-STRATEGY-UI-2026-09-15.md`（改写策略传参契约）
- 创建日期：2026-09-16

## 1. 背景与目标

### 1.1 问题

采集页自 2026-09-14 起有三个标签：**内容采集** / **采集记录** / **文案库**。实际使用中发现：

1. **内容重复**：文案库的「采集」类目就是 `collected_items` 实时合成（`buildCopyLibraryItems`），与「采集记录」展示的是**同一份数据**，两标签 100% 重复展示采集正文。
2. **能力不对称**：同一篇采集正文，在「采集记录」里有完整操作（编辑/创建草稿/视频创作/发布/删除），在「文案库」里只有查看/改写，用户需要在两个标签间来回切换。
3. **信息更全**：采集记录卡片显示来源、字数、视频时长、平台、采集时间；文案库卡片只有徽标、标题、字数、时间。

### 1.2 决策（2026-09-16 用户确认）

- **合并**：两个标签合为一个，标签名用「**文案库**」。
- **以采集记录为准**：卡片信息与操作按钮沿用采集记录的完整集合。
- **新增【改写】按钮**：点击后**跳转到改写页（/rewrite）并直接进行改写**（不再使用弹窗）。

### 1.3 目标

1. 标签栏从三个减为两个：**内容采集**（`collect`）/ **文案库**（`records`）。
2. 合并后的文案库一次性提供：采集正文全操作 + 改写文案管理 + 改写闭环（页内一键改写、跳转改写页改写均回写文案库）。
3. 删除不再使用的 `CopyLibraryPanel` 组件，消除重复实现。

### 1.4 非目标

- 不改动 `collected_items` / `copy_library_rewrites` 两个 settings 键的存储契约（向后兼容，老数据零迁移）。
- 不删除 `CopyRewriteModal` 组件文件（仅解除引用；其测试保留，作为后续清理的技术债，见 §10）。
- 不做文案库跨设备同步、富文本编辑。

## 2. 数据模型（不变，引用）

存储契约见 `PRD-COLLECTION-COPY-LIBRARY-2026-09-14.md` §4/§10：

| 键 | 内容 | 说明 |
|----|------|------|
| `collected_items` | 采集记录数组 | 文案库「采集」条目的唯一数据源（实时合成，不复制） |
| `copy_library_rewrites` | 改写文案数组（上限 200，同 `fromKey` 覆盖） | 文案库「改写」条目 |

`fromKey` 形态不变：`collect:<采集id>` / `rewrite:<改写记录id>`。

**新增（sessionStorage，非持久化）**：`rewrite_handoff_v1` —— 文案库→改写页的一次性交接载荷：

```json
{
  "content": "改写源正文（必填，写入前 trim 校验非空）",
  "title": "源文案标题",
  "platform": "目标平台（可能为空）",
  "sourceUrl": "原文链接（可能为空）",
  "fromKey": "collect:<id> | rewrite:<id>（改写成功后回写文案库的定位键）",
  "fromTitle": "回写记录的「改写自」标题"
}
```

## 3. 功能逻辑

### 3.1 标签结构（P0）

| 项 | 值 |
|----|----|
| 合法标签页 | `TAB_KEYS = ['collect', 'records']` |
| 第二标签显示名 | i18n `collection.tabRecords`（zh：「文案库」，en：「Copy Library」） |
| testid | `collection-tab-library`（保留原 testid，落在 records 标签按钮上） |
| 非法值处理 | `switchTab` 直接忽略，保持当前标签 |

原 `library` 标签、`CopyLibraryPanel` 引用一并移除。

### 3.2 合并列表（P0）

`libraryItems`（computed）= 采集正文 + 改写文案 并集，统一按 `createdAt` 倒序（无时间条目保持相对顺序排末尾，复用 `compareByCreatedAtDesc`，现由 `useCopyLibrary.js` 导出）：

```
entry = {
  key:       'collect:<id>' | 'rewrite:<id>',   // v-for key，防两类 id 撞车
  origin:    'collect' | 'rewrite',
  item:      采集原始条目（collect 时，保留 mediaType/duration/source 等完整字段）,
  record:    改写记录（rewrite 时）,
  createdAt: 排序键（collect: createdAt||collectedAt||created_at；rewrite: createdAt）
}
```

过滤规则：

- 采集条目入选条件：`id` 存在且 `content || description` 非空（与原 `buildCopyLibraryItems` 一致）。
- 改写条目入选条件：`id` 存在且 `content` 非空。
- `filteredLibraryItems`：按筛选值过滤 `origin`；`all` 显示全部。

头部计数：`libraryItems.length`（合并总数），i18n `collection.libraryCount`（「共 N 篇」）。

### 3.3 卡片显示项

**采集卡**（origin=collect，沿用采集记录规范）：

| 区域 | 显示项 |
|------|--------|
| 图标 | 视频 `🎬` / 图文 `📰`（按 `mediaType`） |
| 标题 | `item.title`，空则 `recordsUntitled`（「无标题」） |
| 元信息 | 来源（URL/RSS/Sitemap/API/batch）· 字数 ·（视频）时长 mm:ss ·（视频）平台名 · 采集时间 |
| 按钮 | 编辑 / 创建草稿 / 视频创作 / 发布 / **改写（新增）** / 删除 |

**改写卡**（origin=rewrite）：

| 区域 | 显示项 |
|------|--------|
| 图标 | `✨` |
| 徽标 | 「改写」（`copy-origin-badge is-rewrite`，testid `copy-library-badge-<id>`） |
| 标题 | `record.title`，空则「无标题」 |
| 元信息 | 字数 · 改写于 <时间> · 改写自：<fromTitle>（后两者缺失时整段省略，不出现空值） |
| 按钮 | 查看 / **改写（链式再改写）** / 删除 |

按钮 testid：

| 按钮 | testid |
|------|--------|
| 采集卡【改写】 | `copy-library-rewrite-<采集id>` |
| 改写卡【改写】 | `copy-library-rewrite-r<改写记录id>`（`r` 前缀防与采集 id 撞车） |
| 改写卡删除 | 沿用 `.danger` 类（无独立 testid） |

### 3.4 筛选与空态

- 筛选组：全部 / 采集 / 改写（`copy-library-filter-all|collect|rewrite`），`aria-pressed` 标注激活态。
- 空态 1（无任何文案）：📰 + `recordsEmptyTitle`（「暂无文案」）+ `recordsEmptyDesc`。
- 空态 2（筛选无结果）：🔍 + `libraryFilterEmptyTitle` + `libraryFilterEmptyDesc`。
- 「清空」按钮：仅清空采集正文（`collected_items`），**不影响改写文案**；禁用条件 `collectedItems.length === 0`。

### 3.5 【改写】按钮行为（P0，本次核心）

点击采集卡或改写卡的【改写】→ `rewriteFromLibrary(entry)`：

1. **取正文**：collect 取 `item.content || item.description`；rewrite 取 `record.content`。trim 后为空 → 警告「该文案没有正文内容，无法改写」（`libraryRewriteNoContent`），**不跳转**。
2. **写交接载荷**：`setRewriteHandoff(payload)` 写入 sessionStorage `rewrite_handoff_v1`：
   - collect 卡：`fromKey = collect:<id>`，`title = item.title`，`platform = item.platform`，`sourceUrl = item.sourceUrl`；
   - rewrite 卡（链式）：`fromKey = rewrite:<id>`，`title = record.title`，`fromTitle = record.title`。
   - 写入失败（存储不可用/超额）→ 错误提示「改写交接失败，请重试」（`rewriteHandoffFailed`），**不跳转**。
3. **跳转**：`router.push('/rewrite?from=collection')`。
4. **为什么用 sessionStorage 而非 URL query**：采集正文可能上万字，query 有 URL 长度与转义风险；交接载荷一次性读后即焚。

### 3.6 改写页消费交接（P0）

`RewriteView.vue` onMounted 路由（与 `?topic=` 热门选题带入同模式，两入口互斥，topic 优先）：

1. `route.query.from === 'collection'` 且存在交接载荷 → `takeRewriteHandoff()`（**读后即焚**，防止刷新页面重复自动改写）。
2. 填入正文；`rewriteMode = 'imitate'`（智能仿写）；平台在白名单（douyin/xiaohongshu/wechat_mp/bilibili/zhihu）内才带入，否则保持「通用」。
3. 自动触发 `startRewrite()`（走既有登录门禁 `ensureLogin`，未登录先弹登录，登录成功后续跑）。
4. 无载荷或载荷 content 为空 → 不做任何事（直接访问 `/rewrite?from=collection` 不误触发）。

### 3.7 改写成功回写文案库（P0，闭环）

`startRewrite()` 成功分支新增 `syncHandoffToLibrary()`（旁路，失败静默）：

- 条件：存在交接载荷且 `fromKey` 非空、`rewriteResult` 非空。
- 动作：`upsertRewrite({ fromKey, fromTitle, title, content: 改写结果, platform, sourceUrl })` → 同一 `fromKey` 覆盖为最新结果（与页内一键改写的 `recordRewriteToLibrary` 同契约）。
- 失败静默：文案库回写不阻塞改写主流程。
- 用户在改写页再次改写：仍按原 `fromKey` 覆盖（「同一来源只保留最新」语义）。

## 4. 数据校验汇总

| 校验点 | 规则 | 失败表现 |
|--------|------|---------|
| 交接写入 | `content` trim 非空 | 警告 `libraryRewriteNoContent`，不写不跳 |
| 交接写入 | sessionStorage 可用（配额/隐私模式） | 错误 `rewriteHandoffFailed`，不跳 |
| 交接读取 | JSON 损坏/缺 content | 返回 null，不自动改写 |
| 交接读取 | 一次性语义 | 读后立即删除键 |
| 平台带入 | 白名单五平台 | 白名单外保持「通用」 |
| 回写 | fromKey 非空 + 结果非空 | 静默跳过 |
| 回写 | fromKey 覆盖 + 上限 200 条 | 丢弃最旧（既有 `upsertRewrite` 逻辑） |
| 删除改写文案 | `record.id` 存在 + confirm | 取消则不动 |
| 清空 | 仅清 `collected_items`，confirm | 取消则不动 |

## 5. 交互逻辑

1. 标签切换：`collect` ↔ `records`（records 即文案库）；非法值忽略。
2. 采集卡整卡可点（role=button）→ 创建草稿并进内容编辑页（沿用 `openRecordForEdit`）；卡内按钮 `@click.stop` 阻断冒泡。
3. 【改写】→ 离开采集页跳 `/rewrite?from=collection`；改写页自动填入并开始改写；改写完成 → 提示「改写完成」+ 结果回写文案库。
4. 改写卡【查看】→ 只读预览弹层（遮罩点击/✕ 关闭，`role="dialog"` + `aria-modal`）；长文本 `pre-wrap + anywhere` 断词防撑破。
5. 改写卡【删除】→ confirm（「确定删除这条文案吗？删除后无法恢复。」）→ 仅删改写记录，采集原文不受影响。
6. 「清空」→ confirm → 清采集正文；改写文案保留（需逐条删除）。
7. 采集页内一键改写（`collectAndRewrite`）结果仍实时同步文案库（既有行为，不变）。

## 6. 提示文字（i18n，zh/en 成对）

| key | zh | en | 场景 |
|-----|----|----|------|
| `collection.tabRecords` | 文案库 | Copy Library | 标签名（原「采集记录」更名） |
| `collection.recordsTitle` | 文案库 | Copy Library | 面板标题 |
| `collection.recordsEmptyTitle` | 暂无文案 | No copies yet | 空态标题 |
| `collection.recordsEmptyDesc` | 在「采集」标签页采集内容后，会在这里生成文案列表 | Collected content will appear here as copies... | 空态描述 |
| `collection.recordsDeleteConfirm` | 确定删除这条文案吗？删除后无法恢复。 | Delete this copy?... | 删除确认（采集卡+改写卡共用） |
| `collection.recordsDeleted` | 文案已删除 | Copy deleted | 删除成功 |
| `collection.recordsClearAllConfirm` | 确定清空全部采集正文吗？清空后无法恢复。 | Clear all collected copies?... | 清空确认 |
| `collection.recordsCleared` | 采集正文已清空 | Collected copies cleared | 清空成功 |
| `collection.rewriteHandoffFailed` | 改写交接失败，请重试 | Rewrite handoff failed, please retry | 交接写入失败（**新增**） |
| `collection.libraryRewrite` | 改写 | Rewrite | 新增按钮文字（既有 key 复用） |
| `collection.libraryRewriteNoContent` | 该文案没有正文内容，无法改写 | ... | 正文为空（既有 key 复用） |

CJK 门禁：本次新增用户可见文案全部走 i18n zh/en 成对，`src/` 非 locale 文件零新增中文字面量。

## 7. 测试映射（TDD）

| 测试 | 文件 | 覆盖 |
|------|------|------|
| 交接 util 4 例 | `utils/rewrite-handoff.test.js` | 读写往返/读后即焚/空载荷拒绝/损坏 JSON |
| 合并标签 9 例 | `views/Collection.test.js`（文案库合并标签块） | 双标签结构、合并列表+徽标、筛选、采集卡改写交接、链式改写交接、空正文拦截、删除改写记录、页内改写回写（回归） |
| 改写页交接 4 例 | `views/RewriteView.test.js`（文案库交接块） | 交接自动仿写+平台带入+读后即焚、回写文案库、无载荷不误触发、topic 优先互斥 |
| 存量回归 | `Collection.test.js` 其余 72 例 + `RewriteView.test.js` 44 例 + `useCopyLibrary.test.js` 18 例 | 全部通过 |

## 8. 兼容性

- 老数据零迁移：两个 settings 键不变；无 `createdAt` 的历史采集条目沿用既有的落盘补记逻辑。
- `collectAndRewrite`（页内一键改写）不受影响，仍走 `recordRewriteToLibrary` 同步。
- 深链/书签：原 `library` 标签无独立路由，无深链破坏。
- E2E：`tests/e2e` 若有引用 `collection-tab-library` 点击后断言 `CopyLibraryPanel` 的用例需同步（本次 grep 未发现）。

## 9. 已知边界

1. 跳转改写页后，用户若清空输入框改写其他内容，成功后仍会按原 `fromKey` 覆盖文案库记录（语义：同一来源的最新改写结果）。如需精确溯源可在后续版本引入会话级失效机制。
2. 交接载荷在 sessionStorage 中明文存放，仅本机本窗口生命周期，无敏感信息外泄面（正文本来就是本机明文存储）。
3. 「清空」不清改写文案，属有意设计（改写结果计算成本高）；如需一键全清在文案库加「清空改写」按钮即可（预留）。

## 10. 技术债务

- ~~`CopyRewriteModal.vue` + `CopyRewriteModal.test.js`~~：**已清理（2026-09-18，本 PR）**。弹窗式改写入口被「跳转改写页」取代后成为孤儿组件，连同 `CopyLibraryPanel.vue`/`CopyLibraryPanel.test.js` 与 14 个专用 i18n 死键（zh/en 成对：`libraryRewriteModal*` 系列 11 键 + `libraryTitle`/`libraryEmptyTitle`/`libraryEmptyDesc` 3 键）一并删除；`libraryRewriteNoContent` 因合并版改写空正文拦截仍在使用而保留；`wordCount*`/`rewriteStyle*` 为多页共享键未动。
- **事件记录**：PR #1895（activate-viral-library，2026-09-16）曾将 `CopyLibraryPanel.vue`/`CopyLibraryPanel.test.js` 误恢复进 main——该提案（爆款库检索修复/模式卡片/效果闭环）并未使用这两个组件，属分支基于旧 main 导致的误带入。本 PR 将其再次移除；若后续确需恢复旧面板，必须基于合并版架构重新接线，而非原样复活。
