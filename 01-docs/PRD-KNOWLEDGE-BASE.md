# 知识库功能 — 产品需求文档

> 立项日期: 2026-09-09 | 状态: 已实现（PR #1604 已合并 + PR #1617 补发）| 复杂度: L | 风险: 中
> 分支: codex/knowledge-base | 工作树: D:/Data/projects/mp-worktrees/mp-knowledge-base

## 一、产品概述

知识库功能为内容创作者提供两大知识资产管理系统：

1. **爆款库（ViralLibrary）**：搜集、管理网上自媒体平台的爆款内容，为改写引擎提供「风格参考」和「模式提取」
2. **个人知识库（PersonalKnowledgeBase）**：管理创作者的 IP 人设、背景、经历、观点，为改写引擎提供「素材引用」和「人设约束」

两类知识库通过改写引擎的三层 Prompt 融合机制，与现有用户偏好知识库（v2 Ebbinghaus 遗忘曲线 + RRF 混合搜索）协同工作。

## 二、数据模型

### 2.1 爆款库表 viral_library

| 字段 | 类型 | 约束 |
|------|------|------|
| id | TEXT PK | UUID |
| title | TEXT | 可选，<=500字符 |
| cover_url | TEXT | 可选，http(s) URL |
| author | TEXT | 可选，<=100字符 |
| url | TEXT | 可选，http(s) URL |
| content | TEXT | 必填，1-50000字符 |
| tags | TEXT | JSON数组，每项<=100字符，最多50个 |
| likes | INTEGER | >=0，默认0 |
| collections | INTEGER | >=0，默认0 |
| comments | INTEGER | >=0，默认0 |
| like_collect_ratio | REAL | 自动计算 likes/max(collections,1)，2位小数 |
| published_at | TEXT | ISO8601，可选 |
| platform | TEXT | 可选，<=50字符 |
| source | TEXT | 'manual' 或 'collection' |
| created_at / updated_at | TEXT | ISO8601 UTC 自动生成 |

搜索实现：sql.js（WASM SQLite）不支持 FTS5 虚拟表，因此全文检索采用与现有 `knowledge-base.js` 一致的纯 JS 分词（中文字符 + 英文/数字 token）+ `LIKE '%token%'` 匹配，或加载时内存过滤。不引入原生 better-sqlite3。

### 2.2 个人知识库表 personal_knowledge

| 字段 | 类型 | 约束 |
|------|------|------|
| id | TEXT PK | UUID |
| category | TEXT | 必填，9个预定义值之一 |
| title | TEXT | 可选，<=500字符 |
| content | TEXT | 必填，1-50000字符 |
| source_file | TEXT | 仅文件名，<=1024字符 |
| file_type | TEXT | txt/md/doc/docx |
| created_at / updated_at | TEXT | ISO8601 UTC |

搜索实现：同爆款库，纯 JS 分词 + `LIKE` / 内存过滤（sql.js 无 FTS5）。

9 个类别（枚举）：
personal_ip_persona（个人IP人设·约束型）/ personal_background（个人背景·素材型）/ personal_stories（个人故事·素材型）/ growth_experience（成长经历·素材型）/ emotional_experience（情感经历·素材型）/ work_experience（工作经历·权威型）/ project_experience（项目经验·权威型）/ personal_opinions（个人观点·立场型）/ family_stories（家人故事·素材型）

### 2.3 飞书 API 配置（settings 表 key=feishu_api_config）

JSON：{appId, appSecret(加密), enabled, verifiedAt}。App Secret 使用 account-credential-crypto 同款加密。

## 三、功能清单

### 3.1 侧边栏入口
「更多」菜单末尾添加【知识库】→ /knowledge-base（MpSidebar.vue moreItems + router）

### 3.2 知识库主页（KnowledgeBasePage.vue）
两个 Tab：爆款库 / 个人知识库，默认爆款库，切换保留各自状态（v-show）

### 3.3 爆款库 Tab
- 表格 13 列：序号/标题/封面缩略图(60x60)/博主/链接/正文(前100字)/话题标签/点赞数/收藏数/评论数/赞藏比/发布时间/平台 + 操作列
- 排序：点赞/收藏/评论/赞藏比/发布时间 支持表头点击排序
- 搜索：FTS5 全文检索（标题+正文+标签）
- 分页：20条/页
- 手动添加：弹窗表单（标题/链接可选，正文必填，其余可空）
- 编辑 / 删除（删除需确认「删除后不可恢复」）
- 导出飞书云文档

### 3.4 个人知识库 Tab
- 卡片列表，类别标签颜色区分（9色映射）
- 类别筛选：全部 + 9 类
- 单条添加：类别(必选)/标题(可选)/正文(必填)
- 批量导入：多选文件（.txt/.md/.doc/.docx），单文件<=5MB，正文<=50000字，单批最多20个文件；txt/md 直读 UTF-8/GBK，word 用 mammoth 提取（file-parser.js 已实现，importFiles 经 IPC knowledge-library:import-files）
- 导出飞书云文档（按类别分组，exportPersonalToFeishu 经 IPC knowledge-library:export-personal-to-feishu）

### 3.5 采集页集成（Collection.vue）
【加入爆款库】按钮状态机：
- 采集前/采集中 → disabled，tooltip「请先采集内容」
- 采集成功 → enabled
- 已加入 → 「已加入 ✓」disabled

数据映射 CollectResult→viral_library：
title→title, content→content, source_url→url, author→author, tags→tags, metadata.{platform,like_count,collect_count,comment_count,cover_url,published_at}→对应字段（缺失留空不报错），source='collection'，ratio 自动计算。

### 3.6 设置页 — 飞书 API 标签页（FeishuSettingsTab.vue）
- App ID 输入（cli_ 开头，20-40字符）
- App Secret 输入（password 类型 + 显示/隐藏切换，16-128字符）
- 【测试连接】：调 feishu:test-connection，成功「连接成功」/失败分类提示
- 【保存配置】：加密后存 settings 表
- 使用说明：飞书开放平台创建自建应用 → 开启 docx:document + drive:drive 权限 → 发布审批

IPC：feishu:get-config（不回传 Secret）/ save-config / test-connection。渲染进程不持解密密钥，飞书 API 调用全部由主进程发起。

### 3.7 改写引擎集成（核心）

AiWriterPanel 改写 tab 新增两个复选框（默认不勾选）：「结合爆款库」「结合个人经历」。

ai:rewrite 新增参数：
knowledgeOptions: { useViralLibrary: boolean, usePersonalKnowledge: boolean }

三层 Prompt 融合（KnowledgeContextBuilder 新模块）：
- 第1层（原有）：KnowledgeBase.getContextSummary() 用户偏好
- 第2层（新增）：buildViralContext(content, topN=3) — 标题模式 + 开头钩子 + 高频标签；只参考风格模式不复制内容
- 第3层（新增）：buildPersonalContext(content, topN=5) — 按类别作用类型分组注入：
  - 约束型（人设）→「必须符合人设」
  - 立场型（观点）→「不能违背观点」
  - 权威型（工作/项目经验）→「可用背景提升可信度」
  - 素材型（故事/经历/家人）→「可引用素材」

检索：FTS5 全文检索用户输入 → 爆款库按 BM25+互动数加权 Top3；个人库按 BM25 Top5。
优先级链：策略约束 > 人设约束 > 爆款风格 > 用户偏好 > LLM 默认。P0/P1 硬约束，P2/P3 软建议。
边界：检索为空则不注入；未勾选不检索；三层皆空保持原行为。

## 四、IPC 接口

爆款库：knowledge-library:add-viral / add-viral-batch / list-viral / get-viral / update-viral / delete-viral / search-viral / export-viral-to-feishu
个人库：knowledge-library:add-personal / add-personal-batch / import-files / list-personal / get-personal / update-personal / delete-personal / search-personal / export-personal-to-feishu
飞书：feishu:get-config / save-config / test-connection
改写：ai:rewrite 新增 knowledgeOptions

## 四·补 改写引擎三层融合接线（已完成）

分析发现三条断线并全部修复（详见 01-docs/KNOWLEDGE-REWRITE-INTEGRATION.md）：

1. **断线1**：RewriteEngineService._ensureEngine() 未注入 knowledgeLibrary → 新增 setKnowledgeLibrary() + adapter 构造 KnowledgeContextBuilder（rewrite-engine.js）
2. **断线2**：rewrite-engine-core.js _buildPrompt 签名 4 参 vs 调用 5 参 → 修复参数合并（rewrite-engine-core.js）
3. **断线3**：前端 RewriteView.vue / AiWriterPanel.vue 未传 knowledgeOptions → userSettings 新增 knowledgeOptions（useViralLibrary + usePersonalKnowledge）

DI 链路：container.setup.js 工厂注入 knowledgeLibraryService → rewriteEngineService.setKnowledgeLibrary()。

## 五、错误处理

- 存储层：DB 未就绪 -1；写入失败 -2；INSERT OR REPLACE 幂等
- 飞书：400 凭证无效 / 401 认证失败 / 403 权限不足 / 429 限频 / 5xx 服务不可用 / 网络超时
- 文件导入：不存在 / 超5MB / 格式不支持 / 读取失败 / 解析失败，逐项分类提示
- 全部用户可见提示走 i18n（zh/en 成对），带参文案用 Message Function

## 六、i18n

新增 knowledgeBase.* 命名空间，zh/en 成对，约 80+ key。产品名词先登记 01-docs/i18n-glossary.md。

## 七、测试计划

- 单元：knowledge-library-store（CRUD/FTS5/分页/排序）、feishu-client（mock HTTP）、file-parser（4格式+编码）、knowledge-context-builder（三层构建+空边界）、rewrite-engine-core（knowledgeOptions 集成）
- 集成：knowledge-library IPC handler 全通道
- 前端：KnowledgeBasePage（Tab/搜索/增删改）、AiWriterPanel（复选框+参数传递）、FeishuSettingsTab（校验/测试连接/保存）
- 视觉回归：新增页面基线截图

## 八、关键文件（20+）

packages/rewrite-engine/src/：viral-library.js、personal-knowledge-base.js、knowledge-context-builder.js、index.js
apps/desktop/electron/：services/store/knowledge-library-store.js、services/knowledge-library-service.js、services/feishu-client.js、services/file-parser.js、ipc-handlers/knowledge-library.js、ipc-handlers/feishu-settings.js、preload/knowledge-library.js、core/container.setup.js、services/store-schema.js
apps/desktop/src/：views/KnowledgeBasePage.vue、components/ViralLibraryTable.vue、components/PersonalKnowledgePanel.vue、components/FeishuSettingsTab.vue、api/knowledge-library.js、router/index.js、layouts/MpSidebar.vue、views/Collection.vue、components/AiWriterPanel.vue、locales/zh.js、locales/en.js


## 八、自我进化系统（新增）

### 8.1 设计目标

知识库不只是静态存储，而是一个会「生长」的记忆系统。借鉴 LLM Wiki v2 的算法骨架（置信度/生命周期/质量评分/巩固压缩）与 EverOS 的「事件驱动 + 策略调度」思路，让爆款库和个人知识库的每一条目都能自动成长、自动清理、自动分级。

### 8.2 进化语义字段

两张知识表各新增以下进化语义列（`confidence`/`status`/`access_count`/`last_accessed`），个人库额外有 `quality`：

| 字段 | 语义 | 驱动因素 |
|------|------|---------|
| confidence | Ebbinghaus 遗忘曲线置信度（0-0.99） | 检索次数 + 用户反馈 + 时间衰减 |
| status | 生命周期状态 active/stale/deprecated/archived | last_accessed 距今天数 |
| access_count | 被改写引擎检索命中的次数 | 每次三层融合检索命中 +1 |
| last_accessed | 最近一次被检索的时间 | 驱动遗忘曲线衰减 |
| quality | 个人知识库条目的质量评分（0-1） | 结构/引用/可读性加权 |

### 8.3 置信度公式（Ebbinghaus 遗忘曲线）

```
confidence = (0.5 + min(sources,3)*0.1 + authority*0.2 + min(access_count,10)*0.02) * 0.5^(days/30)
```

30 天半衰期。爆款库/个人库无 sources/authority 字段，取默认值（sources=0 → source_bonus=0；authority=0.5 → authority_bonus=0.1）。

### 8.4 生命周期状态机

```
active ──(>90天未访问)──► stale ──(>180天)──► deprecated ──(access_count<3)──► archived
```

被重新访问可从 stale 复活回 active。

### 8.5 五大进化机制

| 机制 | 触发时机 | 行为 |
|------|---------|------|
| 检索即强化 | search 命中时 | access_count+1 + 置信度实时重算 + 审计日志 |
| 生命周期推进 | 应用启动 + 每 6 小时 | decay-check 推进状态 |
| 质量评分 | 每周日凌晨 3 点 | 重算个人库条目 quality |
| 知识巩固 | 每周一凌晨 2 点 | 强化高置信度(≥0.7) + 归档低频(deprecated 且 access<3) |
| 反馈驱动 | 改写完成时 | 用户采纳 → confidence+0.1；拒绝 → -0.05 |

### 8.5.1 P2 反馈闭环实现（2026-09-10）

> 反馈驱动机制已接线，形成完整进化闭环：

1. **KnowledgeContextBuilder 收集 touchedItems**：`buildFullContext()` 内部记录本次检索命中的爆款库/个人库条目（`{table, id}`），新增 `getTouchedItems()` 方法。
2. **改写引擎返回 knowledgeRefs**：`RewriteEngine.rewrite()` 返回 `knowledgeRefs`（本次改写引用的知识条目），供调用方在用户反馈时使用。
3. **Service 层 applyFeedback**：`KnowledgeLibraryService.applyFeedback(action, refs)` 调 `feedbackBoost()`，采纳 +0.1 / 拒绝 -0.05，带 table 白名单防 SQL 注入。
4. **IPC 通道**：`knowledge-library:apply-feedback` + preload `applyKnowledgeFeedback(action, refs)`。

**数据校验**：action 仅允许 adopted/rejected；refs 过滤 table ∈ {viral_library, personal_knowledge} 且 id 非空；空 refs 返回成功（0 影响）。

**前端隐式反馈（2026-09-10 补充）**：为避免用户误解「采纳/拒绝」为「改写结果是否保留」，前端不暴露显式的采纳/拒绝按钮，而是从用户对改写结果的自然操作中隐式推断知识反馈：

| 用户操作 | 推断反馈 |
|---------|---------|
| 应用改写结果（AiWriterPanel「应用」） | adopted（引用知识有用） |
| 保存草稿 / 去发布（RewriteView） | adopted（引用知识有用） |
| 未应用就再次改写 | rejected（上次引用知识没用） |

实现：`AiWriterPanel.vue` 与 `RewriteView.vue` 在改写成功后保存 `data.knowledgeRefs`，在应用/保存/发布时调 `applyKnowledgeFeedback('adopted', refs)`，在再次改写时对上次 refs 调 `applyKnowledgeFeedback('rejected', refs)`。反馈调用静默失败（`try/catch` 包裹），不影响改写主流程。

### 8.6 审计日志

新增 `knowledge_audit_log` 表，记录所有进化事件（access/reinforce/status_change/archive），字段含 target_table/target_id/event/old_status/new_status/old_confidence/new_confidence/actor/created_at。支持知识变化的追溯与调试。

### 8.7 调度器

`KnowledgeEvolutionScheduler`（packages/rewrite-engine/src/knowledge-evolution-scheduler.js）在应用启动时（bootstrap.js runWhenReady）自动启动，应用退出时清理定时器。使用 setInterval/setTimeout 而非外部 cron（Electron 无系统 cron）。

### 8.8 数据校验

- 置信度 clamp 到 [0.01, 0.99]，防止反馈累积溢出
- 状态仅允许 active/stale/deprecated/archived 四值
- access_count 非负整数，上限不影响（检索即强化）
- quality clamp 到 [0, 1]
- 审计日志 actor 仅 system/rewrite_engine/user 三值

### 8.9 关键文件

- packages/rewrite-engine/src/knowledge-evolution.js — 5 个纯函数（decayCheck/consolidate/scoreQuality/batchScoreQuality/feedbackBoost）
- packages/rewrite-engine/src/knowledge-evolution-scheduler.js — 调度器
- apps/desktop/electron/services/store-schema.js — migrateKnowledgeEvolutionSchema
- apps/desktop/electron/services/store/knowledge-library-store.js — _touchKnowledge/_touchAuditLog
- apps/desktop/electron/core/container.setup.js — DI 注册
- apps/desktop/electron/bootstrap.js — 启动调度器

### 8.10 测试

- packages/rewrite-engine/tests/knowledge-evolution.test.js — 11 个用例覆盖 scoreQuality/decayCheck/consolidate/feedbackBoost
- 全量 64 项通过（53 已有 + 11 新增）
