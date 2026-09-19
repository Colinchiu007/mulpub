# PRD — 一级菜单「文案库」：全应用文案来源聚合

> **日期**: 2026-09-19 | **类型**: 新功能 | **分支**: codex/copy-library-primary-menu（worktree mp-copy-library-primary-menu）
> **状态**: ✅ 已实现（v1 四来源聚合）

---

## 1. 背景与目标

用户反馈两点：
1. 文案库藏在采集页的「文案库」标签里，入口太深，应作为一级菜单直达；
2. 文案库逻辑不全面——应用中主要产生的文案（采集的、改写的、热门选题页文案创作的、生成视频过程中的文案）都应在这里。

**目标**：一级菜单新增「文案库」，聚合全应用主要文案来源，成为用户查找/复用文案的唯一入口。

## 2. 文案来源盘点（含差异审计）

| # | 来源 | 存储位置 | v1 是否接入 | 说明 |
|---|------|---------|:---:|------|
| 1 | 采集正文 | settings key `collected_items` | ✅ | 采集页 URL/RSS/API/批量采集的正文，实时合成不复制 |
| 2 | 改写文案 | settings key `copy_library_rewrites` | ✅ | 改写页/采集页改写闭环产物，上限 200 条，同 fromKey 覆盖 |
| 3 | 草稿 | settings key `drafts` | ✅ | **含热门选题页文案创作产物**（rewriteOne → draftSave）与采集页「创建草稿」 |
| 4 | 视频创作文案 | story2video 项目 `sourceText` | ✅ | CreateView 流水线文案 + 热门选题「一键生成视频」文案，经 story2videoListProjects IPC |
| 5 | 改写历史 | SQLite `rewrite_history` 表 | ⏸ v2 | 与 #2 内容高度重复；且 listRewriteHistory 无 owner 过滤（需先修数据隔离） |
| 6 | 发布历史 | JSONL publish-history.jsonl | ⏸ v2 | 写入端只存 platform/title/taskId/status/result，**无正文**（record.description 仅读取兜底） |
| 7 | AiWriter 标题/摘要 | 纯内存 | ❌ | 瞬态不落盘，应用后经草稿/发布进入持久层 |

**用户问「还有什么漏掉的」的答案**：草稿箱（热门选题创作产物）、视频创作 sourceText、（v2 候选）改写历史与发布历史。AiWriter 瞬态产物与模板库（输入素材非产出）不接入。

## 3. 功能逻辑

### 3.1 数据聚合（useCopyLibrarySources.js）

统一条目形状（UNIFIED_ITEM）：

```js
{
  id: 'collect:<id>' | 'rewrite:<id>' | 'draft:<id>' | 'video:<projectId>',  // 全局唯一
  origin: 'collect' | 'rewrite' | 'draft' | 'video',
  title: String,          // 截断 200
  content: String,        // 视频源截断 500（SOURCE_PREVIEW_LIMIT），其余全文
  wordCount: Number,
  platform: String,
  sourceUrl: String,      // 截断 2048
  createdAt: String,      // ISO 8601，倒序排序键
  metadata: { videoProjectId?, truncated?, fromTitle? }
}
```

**数据校验规则**：
- collected_items：条目须有 id 且（content 或 description），否则过滤
- rewrites：条目须有 id 且非空 content
- drafts：条目须有 id 且（content 或 title）
- videoProjects：条目须有 projectId 且（sourceText 或 title）
- settings 解析失败回退 []（不抛错）；单源 IPC 失败不阻塞其余源（Promise.allSettled）
- sourceText > 500 字截断预览，metadata.truncated = true，全文按需走 story2videoGetProject

### 3.2 排序与去重

- 排序：createdAt 倒序（复用 compareByCreatedAtDesc，无时间排末尾稳定）
- **不做内容级去重**：同一正文跨阶段（采集→草稿→发布）是不同业务实体，按来源独立展示

## 4. 交互逻辑

### 4.1 页面结构（/copy-library）

1. **页头**：标题「文案库」+ 副标题「聚合采集、改写、草稿与视频创作的全部文案」
2. **工具栏**：
   - 来源筛选按钮组（aria group）：全部 / 采集 / 改写 / 草稿 / 视频创作，单选，aria-pressed 标记
   - 搜索框：标题+内容模糊匹配（不区分大小写），与筛选可叠加
3. **卡片网格**（auto-fill minmax 320px）：
   - 来源徽标（色区分：改写紫/草稿橙/视频蓝/采集灰）
   - 标题（超长省略）
   - 内容预览（3 行 line-clamp，视频源最多 500 字 + 「内容已截断」标记）
   - 元信息：字数 · 时间 · 截断标记

### 4.2 状态机（Page-Level TDD 枚举）

| 状态 | 触发 | UI |
|------|------|-----|
| Loading | 挂载拉取中 | 「加载中...」 |
| Empty（全空） | 4 源均无数据 | EmptyState 📝「暂无文案」+ 副文案 |
| FilterEmpty | 筛选/搜索无匹配 | EmptyState 🔍 + 「清除筛选」按钮（重置筛选+搜索） |
| Success | 有匹配条目 | 卡片网格 |

### 4.3 显示项与提示文字（zh/en 成对）

| key | zh | en |
|-----|----|----|
| sidebar.nav.copyLibrary | 文案库 | Copy Library |
| copyLibrary.pageTitle | 文案库 | Copy Library |
| copyLibrary.pageSubtitle | 聚合采集、改写、草稿与视频创作的全部文案 | Aggregates copies from... |
| copyLibrary.filterAll / Collect / Rewrite / Draft / Video | 全部/采集/改写/草稿/视频创作 | All/Collection/Rewrite/Drafts/Video Creation |
| copyLibrary.searchPlaceholder | 搜索标题或内容... | Search title or content... |
| copyLibrary.emptyTitle / emptyDesc | 暂无文案 / 去采集、改写或创作视频后，文案会自动出现在这里 | No copies yet / ... |
| copyLibrary.filterEmptyTitle / Desc / Action | 没有匹配的文案 / 换个筛选条件或关键词试试 / 清除筛选 | ... |
| copyLibrary.wordCount | {count} 字 | {count} words |
| copyLibrary.truncated | 内容已截断 | Content truncated |
| copyLibrary.untitled | 未命名文案 | Untitled |

## 5. 菜单与路由契约

- route-registry.js 先登记（维护规则）：key=copy-library，group=primary，icon=Document
- SIDEBAR_MENU_KEY_ORDER：collection → **copy-library** → rewrite（文案工作流闭环）
- sidebar-menu.test.js EXPECTED_DERIVED_MENU 冻结基线同步 19→20 项
- 运营中心 app_menu_service.py CATALOG 同步（可配置显示/隐藏，不加强制显示）
- CI 门禁：check-route-registry（key 集合一致）、check-locale-sync（成对/CJK/keys）全过

## 6. 与采集页文案库 tab 的关系（双入口一致性）

- 采集页 tab 保持现状（collected_items + copy_library_rewrites 两源，卡片含操作按钮）
- 一级页面是超集（4 源，只读聚合 + 筛选搜索）
- 两端共享 useCopyLibrary 的数据契约（COPY_REWRITES_KEY/parseCopyRewriteRaw/compareByCreatedAtDesc）
- 写操作（删除改写）经 readCurrent() 磁盘重读保证最终一致；不做实时双向同步

## 7. 验收标准

- [x] 一级菜单显示「文案库」，位于采集与文案改写之间
- [x] /copy-library 渲染 4 源聚合列表，createdAt 倒序
- [x] 来源筛选 + 关键词搜索可叠加
- [x] 视频文案 >500 字截断预览并标记
- [x] 单源 IPC 失败不阻塞其余源
- [x] zh/en locale 成对，CI Gate 7（CJK/keys/pair）通过
- [x] check-route-registry 通过（33 路由/20 菜单项）
- [x] sidebar-menu.test 28 用例 + composable 5 用例 + Collection 91 用例全过

## 8. 风险与边界

- 一级导航 7→8 项：MpSidebar 小图标+文字模式可承受；后续超 9-10 项再评估
- drafts 无上限：极端用户可能数千条，v1 全量加载（settings 单 key 读取），v2 可加懒加载
- 视频项目上限 1000：sourceText 截断后内存可控（~500KB）

## 9. v2 展望

- rewrite_history 接入（先修 owner_subject 过滤）
- 发布历史接入（需先补写入端 content 字段）
- 卡片操作按钮（改写/去发布/去视频创作）
- 全文查看弹窗（视频源 story2videoGetProject 按需加载）
