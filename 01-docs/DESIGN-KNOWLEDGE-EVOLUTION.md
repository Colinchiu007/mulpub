# 知识库自我进化系统 — 架构设计与分阶段落地计划

> 版本: 1.0 | 日期: 2026-09-10 | 作者: /root
> 前置阅读: DEEP-ANALYSIS-KNOWLEDGE-BASE.md, PRD-KNOWLEDGE-BASE.md, KNOWLEDGE-REWRITE-INTEGRATION.md
> 复杂度: L | 风险: 中 | 涉及范围: packages/rewrite-engine/src/ 全量重构

## 0. 摘要

当前 Multi-Publish 有三套并存的知识存储：偏好库（knowledge-base.js v2, JSON→SQLite KV）、爆款库+个人库（PR #1604, SQLite 两表）、改写引擎三层融合（KnowledgeContextBuilder, Prompt 层面拼接）。它们已经打通了「如何用知识影响改写」这条链路，但缺少「知识如何自己生长」的闭环——没有遗忘、没有巩固、没有质量自检、没有自动升维。

本文以 LLM Wiki v2 的算法骨架（置信度/生命周期/质量评分/矛盾检测/巩固压缩）为蓝本，参考 EverOS 的「事件驱动 + 策略调度」思路，为 rewrite-engine 的知识库设计一套完整的自我进化系统。

全文分为五部分：统一数据契约、五大进化机制、策略调度器、分阶段落地计划（P0-P3）、代码实施方案。

---

## 第一部分：统一数据契约

### 1.1 进化语义统一覆盖

在所有知识条目上叠加统一的「进化语义字段」：confidence、status、access_count、last_accessed。不改变现有表结构，通过 ALTER TABLE 加列实现。

- 偏好库的 rewrite_engine_kb JSON 中的 knowledgeItems[] 每个条目已有独立 frontmatter（已实现，knowledge-base.js v2）
- 爆款库 viral_library 和个人库 personal_knowledge 需要加列
- 新增统一的 knowledge_audit_log 表记录所有知识变更

### 1.2 爆款库进化字段

```sql
ALTER TABLE viral_library ADD COLUMN confidence     REAL    DEFAULT 0.5;
ALTER TABLE viral_library ADD COLUMN status         TEXT    DEFAULT 'active';
ALTER TABLE viral_library ADD COLUMN access_count   INTEGER DEFAULT 0;
ALTER TABLE viral_library ADD COLUMN last_accessed  TEXT;
CREATE INDEX IF NOT EXISTS idx_viral_status ON viral_library(status);
```

语义映射：confidence=模式复用可信度（引用+采纳越多越高）、status=active→stale(90天)→deprecated(180天)→archived、access_count=被 buildViralContext 检索到的次数、last_accessed=驱动遗忘曲线衰减。

### 1.3 个人知识库进化字段

```sql
ALTER TABLE personal_knowledge ADD COLUMN confidence     REAL    DEFAULT 0.5;
ALTER TABLE personal_knowledge ADD COLUMN status         TEXT    DEFAULT 'active';
ALTER TABLE personal_knowledge ADD COLUMN access_count   INTEGER DEFAULT 0;
ALTER TABLE personal_knowledge ADD COLUMN last_accessed  TEXT;
ALTER TABLE personal_knowledge ADD COLUMN quality        REAL    DEFAULT 0.5;
```

个人知识库额外有 quality 字段（结构/引用/可读性评分，权重 0.3/0.4/0.3）。

### 1.4 统一审计日志表

```sql
CREATE TABLE IF NOT EXISTS knowledge_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_table TEXT NOT NULL,
    target_id TEXT NOT NULL,
    event TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    old_confidence REAL,
    new_confidence REAL,
    actor TEXT DEFAULT 'system',
    created_at TEXT NOT NULL
);
```

---

## 第二部分：五大进化机制

### 机制 1：Ebbinghaus 遗忘曲线 — 检索即强化

置信度公式（与 LLM Wiki v2 的 confidence.py 完全一致）：

```
confidence = (0.5 + min(sources,3)*0.1 + authority*0.2 + min(access_count,10)*0.02) * 0.5^(days/30)
```

每次 buildViralContext() 或 buildPersonalContext() 检索命中时，用一句 SQL UPDATE 完成 access_count+1 + 实时置信度重算（sql.js 支持 julianday() 和 POWER()），并写入 knowledge_audit_log。

注意：爆款库和个人库没有 sources 和 authority 字段（面向创作素材而非研究笔记）。公式中这两项用默认值：sources=0（source_bonus=0）、authority=0.5（authority_bonus=0.1）。未来可加 authority 列（用户手动标注权威度）。

### 机制 2：生命周期状态机 — 定时 decay-check

```
active ->(>90天) stale ->(>180天) deprecated ->(access_count<3) archived
```

被重新访问可从 stale 复活回 active。应用启动时立即执行一次（覆盖离线期间时间流逝），之后每 6 小时一次。

### 机制 3：质量评分 — 个人知识库专用

三维度加权：结构完整性 0.3（标题/段落/列表/引用/代码块）+ 引用覆盖率 0.4（来源文件/wikilinks 数）+ 可读性 0.3（平均段落 100-300 字最佳）。

### 机制 4：知识巩固 Consolidate — 每周定时执行

- 强化高置信度条目（confidence >= 0.7）：access_count+1 + 置信度+0.05（封顶 0.99）
- 归档低频条目（status=deprecated 且 access_count < 3）：标记为 archived

### 机制 5：反馈驱动的置信度更新 — 改写完成时触发

| 用户行为 | 置信度影响 |
|---------|----------|
| 采纳 (adopted) | confidence += 0.1（封顶 0.99） |
| 修改 (modified) | 无变化 |
| 拒绝 (rejected) | confidence -= 0.05（不低于 0.01） |

---

## 第三部分：策略调度器（参考 EverOS OME 范式）

EverOS 的核心启示：进化不是靠用户手动触发，而是靠后台策略引擎按事件/定时自动执行。设计 KnowledgeEvolutionScheduler：

| 策略 | 触发时机 | 执行内容 |
|------|---------|---------|
| decay-check | 应用启动时 + 每 6h | 生命周期状态推进 |
| consolidate | 每周一凌晨 2 点 | 强化高置信度 + 归档低频 |
| quality-score | 每周日凌晨 3 点 | 重算个人知识库质量分 |

用 setInterval/setTimeout 而非外部 cron（Electron 无系统 cron）。container.setup.js 中初始化，应用退出清理。

---

## 第四部分：分阶段落地计划

### P0 — 进化语义支柱（预计 3-4h）

内容：
- store-schema.js：新增 migrateKnowledgeEvolutionSchema()
- knowledge-library-store.js：所有 search* 方法检索命中时自动 touchKnowledge()
- 测试：knowledge-library-store.test.js 新增 8 个用例
- 数据迁移：已有数据 confidence=0.5, status='active', access_count=0, last_accessed=created_at

验收：access_count 递增 / decay 推进 stale / 审计日志写入

### P1 — 进化调度器 + 巩固/归档（预计 2-3h）

内容：
- 新建 knowledge-evolution-scheduler.js + knowledge-evolution.js
- container.setup.js 初始化调度器
- IPC: knowledge:evolution-status / knowledge:trigger-consolidate

验收：定时 decay 推进 / 手动 consolidate 置信度+0.05 / 低频条目归档

### P2 — 改写引擎反馈闭环（预计 1-2h）

内容：
- KnowledgeContextBuilder.buildFullContext() 返回 touchedItems
- RewriteEngineService 改写后调 feedbackBoost()
- knowledge-base.js 的 recordFeedback() 扩展追溯 boost

验收：用户采纳 → 被引用条目 confidence 上升 / 拒绝 → 下降不归零

### P3 — 知识图谱 + 矛盾检测（预计 3-5h，按需启动）

wikitilink 解析 + 实体/边表 + bigram Jaccard + DFS 遍历。按需启动：爆款条目间关系稀疏（鲜有 contradicts/depends_on）。

---

## 第五部分：代码实施方案

### 5.1 文件变更清单

| 文件 | 变更 | 复杂度 | 说明 |
|------|------|--------|------|
| packages/rewrite-engine/src/knowledge-evolution-scheduler.js | 新建 | M | 调度器 |
| packages/rewrite-engine/src/knowledge-evolution.js | 新建 | M | 纯函数 |
| packages/rewrite-engine/src/knowledge-context-builder.js | 修改 | S | 返回 touchedItems |
| apps/desktop/electron/services/store-schema.js | 修改 | M | migration |
| apps/desktop/electron/services/knowledge-library-store.js | 修改 | M | touchKnowledge |
| apps/desktop/electron/services/knowledge-library-service.js | 修改 | S | 透出 touchedItems |
| apps/desktop/electron/services/rewrite-engine.js | 修改 | S | 反馈闭环 |
| apps/desktop/electron/core/container.setup.js | 修改 | S | DI + 启动 |
| apps/desktop/electron/core/bootstrap/phase1-context.js | 修改 | S | 提取 |
| apps/desktop/electron/core/bootstrap/phase5-ipc.js | 修改 | S | 传递 |
| packages/rewrite-engine/src/__tests__/knowledge-evolution.test.js | 新建 | M | P0-P2 测试 |
| apps/desktop/electron/tests/knowledge-library-store.test.js | 修改 | M | 进化测试 |
| 01-docs/PRD-KNOWLEDGE-BASE.md | 修改 | S | 补充第 8 章 |

### 5.2 DI 三端同步（复用 PR #998 教训）

新增 KnowledgeEvolutionScheduler 必须在三处同步：container.setup.js register → phase1-context.js extractContext → phase5-ipc.js bootstrap。遗漏任何一步 → undefined → 进化静默失效。

### 5.3 不引入新原生依赖

- 只用 sql.js 基本 SQL（julianday/POWER/UPDATE/INSERT）
- 搜索保持 LIKE，不升级 FTS5
- 不引入 better-sqlite3（原生编译）或向量数据库（LanceDB/Chroma）

---

## 第六部分：与 LLM Wiki v2 差异对照

| 维度 | LLM Wiki v2 | 本系统 | 移植 |
|------|-----------|--------|------|
| 存储 | Markdown + frontmatter | SQLite 行 | 表列 |
| 置信度 | Python 离线算 | SQL 内联算 | 公式一致 |
| 生命周期 | CLI decay-check | setInterval 定时器 | cron→schedule |
| 巩固 | consolidate_ops.py | consolidate() JS | 逻辑一致 |
| 搜索 | FTS5+Chroma | LIKE 子串 | 搜索独立 |
| 审计 | .audit.log 文件 | knowledge_audit_log 表 | 结构化 |

---

## 附录 A：EverOS 策略引擎参考

| EverOS 策略 | 对应实现 | 触发方式 |
|------------|--------|---------|
| extract_atomic_fact (每次 memcell) | touchKnowledge() | 检索时 |
| profile_clustering (事件) | decayCheck + consolidate | 定时 |
| reflect_episodes (每周 cron) | consolidate 强化+归档 | 每周 |
| extract_agent_skill (事件) | feedbackBoost() | 改写完成时 |
| 策略热更新 | 调度器 start/stop | 生命周期 |

核心：在写入/检索/反馈三个关键事件点挂上进化钩子，知识库就能自我生长。

---

## 附录 B：已知限制

1. 无向量语义检索（未来可选 @xenova/transformers WASM 或远程 embedding API）
2. 无跨条目知识压缩（lossy LLM re-merge 对创作素材风险高，建议用户手动）
3. 知识图谱 P3 按需（非研究型知识库实体关系稀疏）

