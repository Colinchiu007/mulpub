# PRD：博主监控与采集（Creator Monitor & Collect）

| 项 | 值 |
|---|---|
| 文档编号 | PRD-CREATOR-MONITOR-COLLECT-2026-10-07 |
| 版本 | v1.0 |
| 日期 | 2026-10-07 |
| 状态 | 待 CCG 外部评审 |
| 特性分支 | `blogger-collection` |
| 关联主文档 | `01-docs/PRD.md` §8.5 博主监控与采集 |
| 目标能力契约 | 新增 `openspec/specs/creator-monitor/spec.md` |

---

## 1. 背景与根因

### 1.1 需求

用户需要对抖音、小红书、知乎、视频号、公众号、X、YouTube 的博主账号做**长期关注**：定期监控，发现新作品后展示，并支持**一键批量采集**（有默认数量与硬上限）；同时也支持**手动采集指定博主的作品**（可设数量）。单条采集需从用户端体验上被明确解决。

### 1.2 现状根因（代码实证，非推测）

本仓**不存在任何「博主/账号」维度概念**，这不是"给已有采集加监控"，而是从零引入一个领域模型：

| 缺口 | 实证 |
|---|---|
| 无博主实体 | 全仓 `author` 仅是一个字符串字段（`store-schema.js:168` `viral_library.author`） |
| 无关注关系表 | 无 `creator*` / `follow*` 表 |
| 无"按账号列作品"能力 | 无任何频道/主页列表采集；`Collection.test.js:686` 明确断言 `space.bilibili.com` 不走该链路 |
| 无周期内容监控 | 既有轮询仅两类且都与内容监控无关：`comment-manager.js:200` 评论轮询、`hot-topics-service.js:44` 仅在 UI 点刷新时拉取 |
| 无持久"已采集"状态 | `已采集` 是运行时用 `collectedUrlSet` 现算的（`Collection.vue:1190`），刷新即丢 |
| 采集落库极弱 | `collected_items` 是 settings 表的**单个 JSON key**（`Collection.vue:2245`）；`viral_library` **无唯一约束**，`source_url` 无索引（`store-schema.js:168-187` 仅 created_at / platform 两个索引） |

### 1.3 平台能力现实（决定 MVP 范围）

`packages/collection-engine/src/platform-adapters/` 的 5 个 adapter **全部是死代码，一行未接入生产链路**：

| Adapter | 状态 |
|---|---|
| `bilibili-adapter.js` | ✅ 唯一真发请求（WBI 签名 + `api.bilibili.com`），但 B 站不在需求清单 |
| `zhihu-adapter.js` | ⚠️ 无浏览器注入时返回空壳 |
| `douyin-adapter.js` | ⚠️ 同上 |
| `xiaohongshu-adapter.js` | ⚠️ 同上 |
| `wechatmp-adapter.js` | ❌ **完全没有 `_doFetch`**，永远抛 `not implemented` |
| 视频号 | ❌ Python 侧显式拒绝：`video_service.py:167` `VIDEOCLONE_CHANNELS_UNSUPPORTED` |
| X | ❌ NOT FOUND（`service.py:331` 列 phase2） |

**结论：7 个平台的"按博主维度列作品"能力实测为 0。**

### 1.4 YouTube 的关键有利条件（已取证，非推测）

外部依赖包 `content-aggregator` 的 `YouTubeCollector`（实现在 `content_aggregator_shared/shared/collectors/youtube_collector.py`，366 行）**已完整实现频道枚举**：

- `youtube_collector.py:156` 调 `https://www.googleapis.com/youtube/v3/channels` 解析频道 ID
- `:195` 调 `https://www.googleapis.com/youtube/v3/playlistItems` 拉上传列表（上传列表 ID 为 `UU...`）
- `:144-180` 支持 `UC...` ID、`@handle`、`/c/name`、`/user/name` 四种输入形式

返回字段（`:252-267`）**恰好覆盖本特性所需**：

```python
{
  "title": str,
  "content": str,        # 字幕优先，无字幕回落描述
  "url": "https://www.youtube.com/watch?v={video_id}",
  "author": channelTitle,
  "published_at": str,
  "summary": str,
  "metadata": {
      "video_id": str,          # ← 天然去重键
      "channel_id": str,        # ← 天然博主 external_id
      "thumbnails": {...},      # ← UI 封面
      "transcript_source": "subtitle" | "description",   # ← 内容质量指示
  }
}
```

`content-aggregator` 已在 `packages/python-backend/pyproject.toml:21` 声明为可选依赖。

**⚠ 重要更正（2026-10-07 实测，修正本文早期论断）**

本文早期版本称 YouTube「是唯一能在**不依赖反爬**的前提下证明链路成立的平台」。**这句话只对「发现」成立，对「取正文」不成立。** 实测 `youtube_transcript_api` 的实现：

| 环节 | 实现 | 性质 |
|---|---|---|
| 频道/作品枚举 | `googleapis.com/youtube/v3/{channels,playlistItems,search}` | ✅ **官方 Data API** |
| **字幕正文** | ① GET `youtube.com/watch?v=<id>` ② 正则从 HTML 刮出 `INNERTUBE_API_KEY` ③ POST `youtube.com/youtubei/v1/player` ④ 请求体伪装 `clientName: ANDROID, clientVersion: 20.10.38` | ⚠️ **非官方**：抓页面 + 调内部 Innertube 接口 + **客户端伪装** |

该库自带文档即在讨论 **「Working around IP bans」** 与 **Webshare 代理**配置——即其作者已知该路径存在 IP 封禁。

**修正后的风险定位**：

| 环节 | 反爬强度 | 失败后果 |
|---|---|---|
| 发现（探测） | **低**——纯官方 API | 监控停止新发现（可自愈：配额/网络） |
| **取正文（字幕）** | **中**——轻量抓取 + 客户端伪装 | 该条正文降级为 description，**监控本身不受影响** |

**为什么仍选 YouTube**：抖音/小红书/视频号需要处理**签名算法、风控体系、登录态对抗**（持续对抗军备）；字幕抓取是**每次一个页面请求、可缓存、无状态**，量级完全不同。**"轻量抓取" ≠ "平台级反爬对抗"**，但也不能说"完全无反爬"。

**因此正文路径必须有降级与缓存**（见 §8.0.1）：同一 `videoId` 的字幕**本地缓存、永不重复抓取**；字幕抓取失败时**降级为 description 且不计入博主连续失败**（§8.6）——抓不到字幕是内容降级，不是监控故障。

### 1.5 不可回避的风险声明

**抖音、小红书、视频号三个平台，本方案不承诺长期稳定可用。** 其反爬是持续对抗（签名算法、频控、登录态风控持续变化），属长期军备而非一次性投入。本方案能做的是把架构设计成**这类平台失效时不拖垮整体**：能力分层标记 + 熔断降级 + 失败自动暂停 + UI 诚实标注。此风险不可被"规划掉"。

---

## 2. 目标与非目标

### 2.1 目标

| 编号 | 目标 |
|---|---|
| G1 | 建立博主实体、关注关系、发现记录三层数据模型，去重落在 DB 唯一约束层 |
| G2 | 支持长期关注博主，按可配频率定期检查新作品 |
| G3 | 新作品在 UI 上以角标 + 列表高亮呈现，支持**一键批量采集**（默认数量 + 硬上限） |
| G4 | 支持**手动采集**指定博主作品（可设数量），超限必须显式提示 |
| G5 | 单条采集零填参一键入库，已采集项持久标记且不再重复 |
| G6 | 采集内容可**一键送入 AI 写作**（复用既有 pipeline DAG） |
| G7 | 平台能力分层，UI 显式标注官方接口 / 尽力而为 / 暂不支持 |
| G8 | 监控失败可自愈降级：连续失败 3 次自动暂停并提示，提供立即重试 |

### 2.2 非目标（明确排除）

| 编号 | 非目标 | 排除理由 |
|---|---|---|
| N1 | 一键搬运发布原作者作品 | 引入洗稿判定与多平台重复内容限流一整套子问题，会撑爆方案 |
| N2 | 本期实现抖音/小红书/视频号/公众号/X 的采集 | 4/5 平台无官方接口，见 §1.5 风险声明 |
| N3 | 团队共享博主库 / 多用户 | 当前为本地单用户产品，多账号在数据模型预留但 UI 不暴露 |
| N4 | 已有采集内容（`collected_items` / `viral_library`）的历史数据迁移 | 现有数据无 `(platform, external_id)`，无法可靠回填；新表从零开始 |

---

## 3. 术语

| 术语 | 定义 |
|---|---|
| 博主 / Creator | 被长期关注的账号实体，平台侧唯一标识为 `external_id` |
| 关注 / Follow | 用户与博主的关系，含监控配置与运行状态 |
| 发现记录 / Discovery | 监控探测到但**尚未采集**的作品 |
| 采集 / Collect | 将作品正文（字幕或描述）落进采集库的动作 |
| 探测 / Probe | 只取列表元数据、不取正文的轻量检查 |
| 能力等级 / Capability Tier | `official` / `best_effort` / `unsupported` |

---

## 4. 平台能力矩阵

| 平台 | 采集能力等级 | 依据 | 本期状态 |
|---|---|---|---|
| **YouTube** | `official`（发现）/ `official`+轻量抓取（正文） | **发现**：Data API v3，依赖包已实现。⚠️ **正文**：字幕经 `youtube-transcript-api`（抓 watch 页 + 内部 Innertube 接口 + 客户端伪装），属**非官方轻量抓取**，见 §1.4 更正 | ✅ **本期交付** |
| 知乎 | `best_effort` | cookie 鉴权 + 已有 stealth 采集；收藏夹官方 API 已可用 | 后续 |
| X (Twitter) | `best_effort` | API v2 付费档，或登录 cookie | 后续 |
| 抖音 | `best_effort` | 无开放接口，需 cookie + Playwright，**有封号风险** | 后续 |
| 小红书 | `best_effort` | 同上，反爬极强 | 后续 |
| 公众号 | `best_effort` | 素材接口仅限自有号；第三方号需客户端自动化 | 后续 |
| 视频号 | `unsupported` | 无任何 API；Python 侧显式拒绝 | ❌ 不承诺 |

---

## 5. 总体架构与数据流

```
┌──────────────── 渲染层 (Collection.vue 新增第三个 tab) ────────────────┐
│  「博主监控」tab                                                        │
│    ├─ 博主列表（关注状态 / 能力徽章 / 失败标记 / 暂停开关）             │
│    └─ 发现列表（新作品 / 封面 / 发布时间 / 字幕质量 / 单条采集按钮）     │
└───────────────┬────────────────────────────────────────────────────────┘
                │ IPC: creator:list / creator:follow / creator:unfollow
                │       creator:discoveries / creator:collect / creator:collectOne
                │       creator:sendToWriter / creator:checkNow / creator:toggle
┌───────────────▼────────────────────────────────────────────────────────┐
│ 主进程 ipc-handlers/creator.js                                         │
└───────────────┬────────────────────────────────────────────────────────┘
                │
      ┌─────────┴──────────┬──────────────────┬─────────────────────┐
      ▼                    ▼                  ▼                     ▼
 creator-store.js    creator-monitor.js   creator-collector.js   automation-
 (3 张新表 CRUD)     (探测 + 增量对比       (YouTube adapter       scheduler.js
                     + 失败降级状态机)      包装 + 数量上限)       (新增 action
                                                                        type)
                                                                              │
                            ┌─────────────────────────────────────────────────┘
                            ▼
                Python: content_aggregator.YouTubeCollector
                        (channels + playlistItems + transcript)
                            │
                            ├─ 探测：fetch_transcript=False（只取元数据）
                            └─ 采集：fetch_transcript=True（取正文）
                                    │
                                    ▼
                         viral_library（既有采集库，source='creator'）
                                    │
                                    ▼
                    full-auto-pipeline: startRun({urls:[1条], sourceType:'url'})
                            → rewrite → create → publish
```

### 5.1 关键设计取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 监控调度宿主 | 复用 `automation-scheduler.js`，新增 `action.type='creatorMonitor'` | 复用触发器匹配、持久化（`automation_tasks`）、间隔钳制（5~1440 分钟）；**但 `action.type` 当前被硬编码**，见 §6.4 改造点 |
| 探测与采集是否共用配额 | **否**，双轨配额 | 现有 `default-strategies.json` 抖音/小红书 `dailyBudget:20`，若探测共用，一次轮询即耗尽，功能不可用 |
| 发现记录与采集内容是否同表 | **否**，分表 + `collect_state` 状态位 | 发现是"待办"，采集是"资产"，生命周期不同；同表会让列表查询反复 JOIN |
| 去重落在哪 | **DB 唯一约束** `(platform, external_id)` | 现有 `collectedUrlSet` 是内存态，刷新即丢；去重必须在持久层 |
| 正文提取 | 复用 `services/readable-text.js` | `collection-engine` 已知 bug：用 `body.replace(/<[^>]+>/g,'')` 会**丢换行**（`BUGFIX-COLLECT-NEWLINE-PRESERVE-2026-09-16.md:206`） |

---

## 6. 数据模型

DDL 按 `store-schema.js` 既有模式：追加进 `SCHEMA_SQL` 数组（全部 `IF NOT EXISTS`），索引为独立 `CREATE INDEX IF NOT EXISTS` 字符串。该文件**无 schema version 机制**，采用幂等重放（`base-store.js:85` `_createTables()` + 串行迁移），新增表无需改版本。

```sql
-- ── 博主实体 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_accounts (
  id               TEXT PRIMARY KEY,
  platform         TEXT NOT NULL,
  external_id      TEXT NOT NULL,             -- youtube: channel_id (UC...)
  display_name     TEXT DEFAULT '',
  handle           TEXT DEFAULT '',           -- @handle
  avatar_url       TEXT DEFAULT '',
  platform_url     TEXT DEFAULT '',
  capability_tier  TEXT NOT NULL DEFAULT 'official',
  credential_alias TEXT DEFAULT '',           -- 预留多账号，MVP UI 不暴露
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_accounts_uniq
  ON creator_accounts(platform, external_id);

-- ── 关注关系 + 监控配置 + 运行状态 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_follows (
  id                   TEXT PRIMARY KEY,
  creator_id           TEXT NOT NULL,
  platform             TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  check_interval_min   INTEGER NOT NULL DEFAULT 60,   -- 1~1440
  per_creator_limit    INTEGER,            -- NULL = 用全局；取值 <= 100
  status               TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at      TEXT,
  last_success_at      TEXT,
  last_error_code      TEXT,
  last_error_message   TEXT,
  paused_reason        TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_follows_uniq
  ON creator_follows(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_follows_scan
  ON creator_follows(status, enabled);

-- ── 发现的视频（未采集） ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_discoveries (
  id                TEXT PRIMARY KEY,
  creator_id        TEXT NOT NULL,
  platform          TEXT NOT NULL,
  external_id       TEXT NOT NULL,           -- youtube: video_id
  title             TEXT DEFAULT '',
  url               TEXT NOT NULL,
  thumbnail_url     TEXT DEFAULT '',
  published_at      TEXT,
  discovered_at     TEXT NOT NULL,
  collect_state     TEXT NOT NULL DEFAULT 'pending',  -- pending|collecting|collected|failed|skipped
  collected_at      TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,       -- 采集尝试次数（CCG i7）
  last_error        TEXT DEFAULT '',                  -- 最近一次采集失败原因（CCG i7）
  claim_token       INTEGER NOT NULL DEFAULT 0,       -- fencing token，单调递增（CCG i2）
  claimed_by        TEXT DEFAULT '',                  -- claim 持有者（CCG i2）
  lease_expires_at  INTEGER,                          -- claim 租约到期时间戳（CCG i2）
  retry_after_at    INTEGER,                          -- 失败冷却到期时间戳（CCG i2）
  transcript_source TEXT DEFAULT '',         -- subtitle | description
  content_quality  TEXT DEFAULT 'unknown',  -- full | partial | stub | unknown（见 §7.6）
  summary           TEXT DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_discoveries_uniq
  ON creator_discoveries(platform, external_id);
CREATE INDEX IF NOT EXISTS idx_creator_discoveries_list
  ON creator_discoveries(creator_id, collect_state, discovered_at);
```

### 6.1 采集库反向映射（CCG 评审 i1/v2-i2 修订）

**问题**：`viral_library` 现有字段为 `id/title/cover_url/author/url/content/tags/likes/collections/comments/like_collect_ratio/published_at/platform/source/created_at/updated_at`（`store-schema.js:168-185`），**没有 `external_id` 也没有 `creator_id`**。若不补，采集后的内容无法反查来源博主，也无法在采集库层识别"重复采集同一条"。

**迁移机制**：本仓 `store-schema.js` **无 schema version 字段**（全文件无 `schema_version` / `PRAGMA user_version`），其版本化手段是**一组按顺序串行执行的幂等迁移函数**（`base-store.js:86-89` 依次调 `migrateOwnerIsolationSchema` → `migrateModelProvidersSchema` → …）。因此新增迁移须遵循同一模式，不得自造版本号机制：

```js
function migrateCreatorLinkageSchema (db) {
  // 两表都对 (platform, external_id) 有唯一约束，迁移必须原子完成：
  // 中途失败若留下半迁移状态，会造成「discoveries 已建索引但 viral_library 未加列」
  // 的分叉——重采集时因缺列抛错，而 CREATE TABLE IF NOT EXISTS 又不会补列，形成死锁。
  db.run('BEGIN')
  try {
    // SQLite 无 ADD COLUMN IF NOT EXISTS：先查列是否存在，存在则跳过（幂等）
    const cols = db.exec('PRAGMA table_info(viral_library)')[0].map(c => c.name)
    for (const [name, ddl] of [
      ['external_id', "ALTER TABLE viral_library ADD COLUMN external_id TEXT DEFAULT ''"],
      ['creator_id',  "ALTER TABLE viral_library ADD COLUMN creator_id  TEXT DEFAULT ''"],
    ]) {
      if (!cols.includes(name)) db.run(ddl)
    }
    // ⚠ partial 唯一索引不可用普通 UNIQUE：存量行 external_id 全为 ''，
    // 普通唯一索引会在创建瞬间因重复键失败。WHERE 子句把存量行排除在外。
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_viral_library_external
              ON viral_library(platform, external_id) WHERE external_id <> ''`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_viral_library_creator
              ON viral_library(creator_id) WHERE creator_id <> ''`)
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err   // 整次迁移原子失败：启动时报错优于带病运行
  }
}
```

**迁移前冲突预检**（CCG 评审 i1：两表各有唯一约束，若历史数据已存在重复的 `(platform, external_id)`，建索引会失败）：

```sql
-- 正常应返回 0 行；非 0 说明历史数据已被外部写入污染
SELECT platform, external_id, COUNT(*) AS n FROM viral_library
 WHERE external_id <> '' GROUP BY platform, external_id HAVING n > 1;
```

冲突非空时**不静默去重**（擅自删行即数据损失）。记录冲突明细并在 UI 提示 `creatorMigrationConflict`：「检测到 {count} 条历史数据冲突，请联系支持」，由人工决定保留哪条。

**为什么必须是 partial index**：`viral_library` 的历史行（以及非博主来源的行）`external_id` 均为默认空串。若建普通 `UNIQUE(platform, external_id)`，迁移执行时会因大量重复键抛错，整个 schema 初始化失败——**这会让应用起不来**。partial index 用 `WHERE external_id <> ''` 把它们排除，保证存量数据零影响。

**跨表约束边界**：两表**不建外键**（`viral_library` 含大量无 `creator_id` 的历史/其他来源行，外键会让迁移失败）。一致性由 store 层保证，映射关系如下：

| 方向 | 关联键 | 用途 |
|---|---|---|
| `viral_library` → `creator_discoveries` | `(platform, external_id)` | 反查该采集内容的来源博主 |
| `viral_library` → `creator_accounts` | `creator_id` | 按博主聚合已采集内容 |
| `creator_discoveries.collect_state` | — | 采集状态的真源在发现表；`viral_library` 是**投影**，允许存在孤儿行 |

**重采集语义**：`viral_library` 已有行时走 `INSERT OR REPLACE`（沿用 `knowledge-library-store.js:82` 既有写法），`created_at` 保留首次采集时间，`updated_at` 刷新。因存在 partial unique 索引，重采集命中的是**有 `external_id` 的博主来源行**；其他行不受影响。

**删除与回滚的对齐（CCG 评审 i6）**：两表会漂移，必须定清谁是事实源。

| 操作 | 事实源 | 对齐方式 |
|---|---|---|
| 用户删除采集库条目 | **`viral_library`**（采集库是用户资产） | 级联把对应 `creator_discoveries` 复位为 `pending`（清 `collected_at`），使其重新出现在「待采集」列表——**删除采集内容 ≠ 删除发现记录** |
| 用户删除发现记录 | **`creator_discoveries`** | 不动 `viral_library`（已采集的内容是独立资产，删发现记录不该销毁内容）；下次探测会因唯一索引已释放而**重新发现同一条** |
| 取消关注博主 | `creator_follows` | **保留** discoveries 与已采集内容（内容是资产）；仅停止监控。若需清理，提供独立的「删除该博主全部内容」操作并二次确认 |

**因此 `viral_library` 是采集事实源、`creator_discoveries` 是发现事实源，两者不是主从关系**——这与 §6.2 的 `collect_state` 注释一致：状态真源在发现表，但**已入库内容的存在性**以 `viral_library` 为准。

**删除与复位的原子性（CCG 评审 i7）**：删除采集库条目并复位 discovery 为 `pending` **必须在同一个数据库事务内完成**。分两次写会在中间崩溃时留下「内容已删、discovery 仍为 collected」的状态——此时那条作品**既不在采集库、也不会被重新发现**，用户等于永久丢失该作品。

```sql
BEGIN
  DELETE FROM viral_library WHERE id = ? AND external_id <> '';
  UPDATE creator_discoveries
     SET collect_state='pending', collected_at=NULL, claimed_by='', lease_expires_at=NULL
   WHERE platform=? AND external_id=? AND collect_state='collected';
COMMIT   -- 任一失败则 ROLLBACK，两者要么都成、要么都不成
```

并发防护：条件更新用 `collect_state='collected'` 做前置断言，配合 `(platform, external_id)` 唯一索引，用 **UPSERT 语义**而非「先查后改」，避免与并发的采集提交互相覆盖。

**删除必须收敛到唯一入口 + 状态迁移 + 完整性巡检（CCG 评审 i7 / i8 Critical）**

只做「统一 service」不够——**代码纪律不是机制**。若删除后 `creator_discoveries.collect_state` 仍是 `collected`，后续探测会因 `(platform, external_id)` 唯一索引**跳过该条**，该作品**永久无法重新采集**（既不在采集库、也不会再被发现）。因此删除入口必须原子完成三件事：

```sql
BEGIN IMMEDIATE
  DELETE FROM viral_library WHERE id = ? AND external_id <> '';
  UPDATE creator_discoveries
     SET collect_state = 'pending',          -- ← 不是 'collected'，否则永不重现
         collected_at  = NULL,
         claim_token   = claim_token + 1,    -- ← 使在途 worker 的 token 立即失效
         claimed_by    = '', lease_expires_at = NULL,
         attempt_count = attempt_count + 1
   WHERE platform = ? AND external_id = ?;
  DELETE FROM collection_outbox WHERE ref_id = ? AND state <> 'done';  -- 撤掉未完成的最终化任务
COMMIT
```

| 机制 | 说明 |
|---|---|
| 状态迁移 | 必须落回 **`pending`**（可重新采集）。若产品上要「不再看到这条」，用 `skipped` 而非 `collected` |
| token 失效 | `claim_token + 1` 让任何在途 worker 的后续提交因 token 不匹配被拒——否则它会在删除后把行改回 `collected` |
| 撤 outbox | 删除时同步撤掉未 `done` 的最终化任务，否则 worker 稍后会把产物搬回来，形成「已删除却又复活」 |
| **完整性巡检** | 每日一次全表核对：`collect_state='collected'` 但 `viral_library` 无对应行 → 复位 `pending` + 记日志。这是对「任何未预期路径造成漂移」的兜底，**不能只靠代码纪律** |
| 孤儿行清理 | `viral_library` 有行但 `creator_discoveries` 无对应行（非博主来源的合法数据）——不清理，仅在巡检报表中计数，避免误伤历史内容 |

### 6.2 去重键与 canonical ID 规则（CCG 评审 i6 修订）

`(platform, external_id)` 唯一索引即去重机制。探测到重复项时走 `INSERT OR IGNORE`（或先查后插 + 捕获约束冲突），**幂等**。

**为什么不用 URL 作主键**：URL 形态可变（`@handle` ↔ `/c/name` ↔ `UC…` 互为别名），ID 不会。

**canonical ID 规则（必须显式定义，否则同一博主会被拆成多行）**：

| 层 | 规则 |
|---|---|
| 博主 `external_id` | **一律为 YouTube API 返回的 `channelId`（`UC…`）**。用户输入的 `@handle` / 频道 URL / `/c/name` / `/user/name` 都必须先经 `channels.list` 解析为 `channelId` 后才落库。**禁止把用户原始输入直接当 `external_id`**——否则同一博主的 4 种 URL 写法会产生 4 个 `creator_accounts` 行 |
| 作品 `external_id` | **一律为 `videoId`**。不取自 URL 查询串、不取自定义 ID |
| 归一化 | 落库前统一 `trim()` + 大小写保持原样（YouTube ID 大小写敏感，禁止 toLowerCase） |
| 频道更名/ID 变更 | YouTube `channelId` 不可变，更名只影响 `display_name`，不影响去重 |

**解析失败的 fail-closed**：`channels.list` 解析不出 `channelId` 时**拒绝写入**并提示 `creatorErrChannelNotFound`，**绝不退化成用用户输入当 ID 兜底**——那正是同一博主被拆成多行的根源。

**⚠ P0 冒烟实测发现的依赖库缺陷（2026-10-07，必须由 adapter 兜住）**

`youtube_collector.py:141-180` 的真实契约（实测验证）：

| 输入 | 依赖库行为 | 结论 |
|---|---|---|
| `UC...` 频道 ID | 直接使用 | ✅ |
| 完整 URL（**必须以 `https://` 开头**）+ `UC...` | 正则提取后使用 | ✅ |
| 完整 URL + `/c/Name`、`/user/Name` | 调 `channels.list?forUsername=` 解析 | ✅ |
| 完整 URL + `@handle` | ⚠️ **`search_query=handle`、`channel_id=None`，降级成关键词搜索** | ❌ **静默返回错误频道** |
| 裸串（无 `http` 前缀，如 `youtube.com/@x` 或 `@x`） | **不进 URL 解析分支**，原样塞进 API 的 `channelId` 参数 → HTTP 400 | ❌ |

**实测证据**（E2E-1）：同一频道的三种写法解析正确，但 `@GoogleDevelopers` 返回了 `UC-BsRijgl1O-H-sD4-Zw3UA`——**另一个频道**。日志 `[YouTube] @handle 格式需要搜索: GoogleDevelopers`。

**为什么这比"报错"严重**：关键词搜索会返回**标题/描述含该词的任意视频**，其 `channel_id` 是那些视频作者的频道。系统读到的 `channel_id` "有值且合法"，UI 与日志都不会报错——**用户关注 A 博主，系统把 B 博主的内容当作 A 的作品推给他，全程无异常信号**。这是静默的数据正确性事故，不是可用性问题。

**adapter 必须自己承担解析，不依赖库的 URL 分支**：

| 步骤 | 实现 |
|---|---|
| 1. 归一化输入 | 裸串补全 `https://`；已是 URL 则原样使用 |
| 2. 自行解析（**不走库的 `_fetch`**） | `UC…` 直取；`@handle` → `channels.list?forHandle=`；`/c/`、`/user/` → `channels.list?forUsername=` |
| 3. 拿 canonical ID 后再调库 | 把 `UC…` 传给 `YouTubeCollector._fetch(channel_id=...)` |
| 4. 解析失败即拒绝 | fail-closed，提示文案区分「格式不对」与「频道不存在」 |

**已实测验证解析路径可用**（2026-10-07，真实 Key）：`forHandle=YouTube` → `UCBR8-60-B28hp2BmDPdntcQ`；`forHandle=GoogleDevelopers` → `UC_x5XG1OV2P6uZZ5FSM9Ttw`；`forUsername=Google` → `UCK8sQmJBp8GCxrOtXWBpyEA`；uploads playlist + `playlistItems` 返回真实最新作品与发布时间。

**URL → channelId 解析矩阵（CCG 评审 i5）**：用户输入形态千差万别，必须逐条定义，否则"能解析但解析错"比"解析不了"更危险。

| 输入形态 | 示例 | 解析路径 | units | 失败表现 |
|---|---|---|---|---|
| 频道 ID | `UCxxxx…` | 直接用（正则 `^UC[\w-]{22}$` 校验） | **0** | 格式不符 → `creatorErrInvalidInput` |
| Handle | `@name` | `channels.list?forHandle=name` | 1 | 404 → `creatorErrChannelNotFound` |
| Handle（URL 形态） | `youtube.com/@name` | 提取 handle，同上 | 1 | 同上 |
| 旧式 URL | `youtube.com/c/name` | 提取 `c/xxx` → `channels.list?forUsername=name` | 1 | 旧式用户名可能已失效 → `creatorErrChannelNotFound`（**这是真实高频场景**） |
| 旧式 URL | `youtube.com/user/name` | 提取 `user/xxx` → `forUsername` | 1 | 同上 |
| 完整 URL | `youtube.com/channel/UCxxx` | 提取 `UC…` → 直接用 | **0** | — |
| 观看/播放列表 URL | `watch?v=` / `playlist?list=` | **不支持**（是作品而非频道） | — | `creatorErrNotAChannel`：「这是作品链接，请粘贴博主主页链接」 |
| 非 YouTube 域名 | 其他平台 URL | 不解析 | — | `creatorErrInvalidInput` |

**成本注意**：`forUsername` 对已停用的旧式用户名会返回 404，而用户手上往往正是这类链接——**不能只支持 handle**。三路（ID / handle / username）都必须实现，且失败文案要区分「格式不对」与「频道不存在」，否则用户会反复重试同一个错误链接。

**预检测试**：上表每行至少一条用例，断言 (a) 解析出的 `channelId` 正确、(b) units 消耗符合预期、(c) 失败文案正确。

#### 6.2.1 `claim_token` 的精确协议（CCG 评审 i3 补缺）

只说「按 token CAS」不够——实现时极易在某条 UPDATE 上漏掉条件，造成过期写覆盖。定义如下：

| 项 | 定义 |
|---|---|
| 类型 | 单调递增整数 `generation`，**只在 claim 时 `+1`**，其余操作绝不改动 |
| 签发 | `claim` 时 `claim_token = claim_token + 1` 并随 `UPDATE ... RETURNING` 返回 |
| 持有者身份 | `claimed_by` 与 `claim_token` **同时**校验。token 递增即代表代次变更，旧持有者自动失效 |
| 过期抢占 | 租约到期后新 worker claim ⇒ token 再次递增 ⇒ **旧 worker 全部后续写入被拒** |

**必须带 `AND claim_token = ?` 的全部语句**（一张表，漏一条即失效）：

```sql
-- 1) 续租
UPDATE creator_discoveries SET lease_expires_at=?, updated_at=?
 WHERE id=? AND claim_token=? AND claimed_by=? AND collect_state='collecting';
-- 2) 进度写入（同样受 fencing 约束：旧 worker 不得覆盖新持有者的进度）
UPDATE creator_discoveries SET updated_at=?, last_error=?
 WHERE id=? AND claim_token=? AND collect_state='collecting';
-- 3) 成功提交
UPDATE creator_discoveries SET collect_state='collected', collected_at=?, claimed_by='',
       lease_expires_at=NULL, retry_after_at=NULL, last_error='', updated_at=?
 WHERE id=? AND claim_token=? AND collect_state='collecting';
-- 4) 失败提交
UPDATE creator_discoveries SET collect_state='failed', last_error=?, claimed_by='',
       lease_expires_at=NULL, retry_after_at=?, updated_at=?
 WHERE id=? AND claim_token=? AND collect_state='collecting';
```

**`changes()===0` 的统一处置**：以上任一语句返回 0 ⇒ 本 worker 已过期，**立即放弃后续所有写操作**（含 outbox 入队），
并把本地缓存的结果丢弃——绝不把「我算出来的正文」写进采集库。

**跨表副作用必须同事务**：`claim_token` 只存在于 `creator_discoveries`，而采集库写入在 `viral_library`。
「先查 token 再插另一表」存在 TOCTOU 窗口（查完到插入之间 token 可能已被新持有者提升）。
故校验 + 跨表插入 MUST 在**同一个 `BEGIN IMMEDIATE` 事务**内完成，见 §8.3.1。

**续租的前提**：续租本身也带 token 条件，因此**只有仍在推进的持有者能续租**；
同时续租必须以**有进展**为前提（字节回调 / 阶段边界 / 阶段内心跳，满足其一），
无进展仍续租会让挂死任务永不过期，占着 claim 不放。
### 6.3 关注状态机（CCG 评审 v2-i3 修订：区分「真故障暂停」与「不可自愈暂停」）

```
                    ┌──────────────┐
          创建 ───► │   active     │ ◄──── 用户「恢复监控」/「立即重试」（重置计数）
                    └──┬────────┬──┘
        Tier B 连续失败 3│        │Tier C 不可自愈（keyInvalid/accessNotConfigured）
                       ▼        ▼
              ┌────────────┐  ┌──────────────────┐
              │auto_paused │  │fatal_paused      │ ──► 修复设置后「恢复」→ active
              │(可自愈失败)│  │(需人工改 API Key)│
              └────────────┘  └──────────────────┘
                       ▲
        用户暂停 ─────────┘ (paused_by_user)

  Tier A（配额节流 / 网络瞬时 5xx）：**不离开 active**，不计入连续失败，
  仅按指数退避重试；配额节流时本轮直接跳过，UI 不报警。
```

| 状态 | 含义 | 调度器行为 | 进入条件 |
|---|---|---|---|
| `active` | 正常监控 | 按 `check_interval_min` 调度 | 创建 / 恢复 / 成功一次 |
| `paused_by_user` | 用户手动暂停 | 不调度 | 用户点暂停 |
| `auto_paused` | 可自愈故障累计 3 次 | 不调度，待「立即重试」 | Tier B 连续 3 次 |
| `fatal_paused` | 不可自愈（凭证问题） | 不调度，UI 直达设置页 | Tier C **首次即暂停** |

`consecutive_failures` 成功一次即清零；Tier A **不累加**该计数（见 §8.6）。

**为什么拆出 `fatal_paused`**：API Key 失效时，重试一万次也不会自愈，让用户看「连续失败 3 次」会误导他去点「立即重试」——那是死路。`fatal_paused` 明确指向「去设置里修 Key」这个唯一有效动作。

### 6.4 发现记录状态机（CCG 评审 i7 修订：补齐失败中间态）

**原设计缺陷**：只有 `pending / collected / skipped` 三态。一旦某条视频采集失败（字幕拉取超时、转写为空、API 抖动），它在库里**既不是 pending 也不是 collected**——用户手动重试时无状态可依，UI 也无法展示"上次为什么失败"，等于没有恢复路径。

```
pending ──► collecting ──┬──► collected   （成功；collected_at 落时间）
   ▲                    │
   │                    └──► failed ──┐   attempt_count += 1
   │                                  │   last_error 落原因
   └──── 用户点「重试」 ───────────────┘   （或批量重试把 failed 批量拉回 pending）
   
pending ──► skipped       （用户主动忽略）
```

| 状态 | 含义 | UI |
|---|---|---|
| `pending` | 未采集 | 「采集」按钮可用 |
| `collecting` | **采集进行中**（进程崩溃/强杀会留在此态） | 显示进度；启动时扫描并复位为 `pending`（带 `attempt_count` 保留） |
| `collected` | 已入库 | 「已采集 · {time}」，按钮置灰 |
| `failed` | 采集失败 | 「重试」按钮 + `last_error` 原因文案；计入 `attempt_count` |
| `skipped` | 用户忽略 | 不再提示 |

**崩溃恢复**：`collecting` 是易失态。应用启动时把滞留的 `collecting` 复位为 `pending`（`attempt_count` 保留并递增），避免"永远转圈"的僵尸记录。

**并发抢占：claim + lease + fencing token（CCG 评审 i2）**

`collecting` 易失态本身**不足以防重复采集**：手动点「采集」与自动批量任务可同时命中同一条；两个窗口、调度器重入同理。仅靠先查状态再改是典型 check-then-act 竞态。

**⚠ 只有 lease 不够（评审 i2 指出）**：lease 超时后新 worker 接管 claim，但**旧 worker 可能仍在跑并随后完成**——若无条件 UPDATE，它会覆盖新持有者的结果（lost update），且两个 worker 都向 `viral_library` 写入。必须用 **fencing token**（单调递增 claim 代次）保证"只有当前代次能提交"。

```sql
-- claim：单条原子 UPDATE，同时把 claim_token 递增（fencing token）
UPDATE creator_discoveries
   SET collect_state   = 'collecting',
       claim_token     = claim_token + 1,     -- 单调递增，提交时比对
       claimed_by      = ?,
       lease_expires_at= ?,
       attempt_count   = attempt_count + 1
 WHERE id = ?
   AND collect_state IN ('pending','failed')
   AND (claimed_by IS NULL OR lease_expires_at < ?)
-- changes() === 0 → 未抢到（他人已持有且租约未过期）
```

| 规则 | 说明 |
|---|---|
| **claim 必须原子且可回读** | 用 `UPDATE ... RETURNING claim_token`，一次拿到新 token，避免「先查再改」的竞态 |
| **所有行内变更与副作用都按 token CAS** | 不只是成功/失败提交——**进度写入、lease 续期、`viral_library` 插入、熔断计数**全部必须带 `AND claim_token = ?`。漏掉任何一处，旧 worker 就能覆盖进度或重复插入（CCG 评审 i2） |
| **跨表副作用必须同事务** | ⚠ `claim_token` 只存在于 `creator_discoveries`，而写入 `viral_library` 是**另一张表**——「先查 token 再插另一表」存在 TOCTOU 竞态（查完到插入之间 token 可能已被新 worker 提升，导致重复插入）。token 校验 + 跨表插入必须在**同一个 `BEGIN IMMEDIATE` 事务**内原子完成（CCG 评审 i6 Critical） |
| **⚠ 但事务解决不了双写（CCG 评审 i7 Critical）** | `BEGIN IMMEDIATE` 只保证**数据库内**原子。字幕文本、媒体文件、第三方产物都写在**事务外**的文件系统/网络侧——此时仍存在「DB 已提交 `collected`，产物写失败」的不一致，而 **token CAS 无法撤销一条已提交的插入**。必须走 outbox / 最终化协议，见 §8.3.1 |
| **续租必须有进展条件** | 心跳**仅在本轮有实质进展时**才续租。无进展却持续续租 = 挂起的任务永不过期，占着 claim 永不释放。**「进展」的粒度必须定义**（CCG 评审 i7）：① 字幕/媒体**字节回调**；② 阶段边界跨越（元数据→字幕→入库）；③ 每 5s 一次的阶段内心跳。**只满足其一即续租**，避免长视频字幕下载（单阶段可超 300s）被误判过期而遭抢占 |
| **总时长 deadline** | 单条采集设总 deadline（如 600s），与 lease 续期解耦：无论心跳如何，deadline 到即强制放弃 |
| **分阶段超时** | 元数据拉取 30s / 字幕拉取 120s / 入库 30s，逐段独立超时，避免单段挂死拖垮整体 |
| **提交必须带 token** | 成功/失败的 UPDATE 均加 `AND claim_token = ?`。token 已变 → `changes()===0` → **放弃提交**，绝不覆盖新持有者 |
| 租约过期接管 | 新 worker claim 后 token+1，旧 worker 的任何后续提交都会因 token 不匹配被拒 |
| `attempt_count` 上限 | 连续失败达 **5 次**后不再自动重试，转 `failed` 需用户显式「重试」，避免坏内容无限消耗配额与时间 |
| 冷却策略 | 单条采集失败后进入 **10 分钟冷却**（`retry_after_at`），冷却期内批量/自动流程跳过该条 |
| 释放 | 成功 → `collected` 并清空 `claimed_by`/`lease`；失败 → `failed` + `last_error` + 写 `retry_after_at` |
| 启动清扫 | `collect_state='collecting' AND lease_expires_at < now` → 复位 `pending`（token 保留，天然递增） |

**为什么 token 不能省**：lease 只能保证"不会有两个活跃租约"，不能保证"旧持有者不会写入"。分布式系统的标准解法就是 fencing——下游拒绝代次过期的请求，这在单机多进程下同样成立（两个 Electron 实例共享同一个 SQLite 文件）。

**重复采集走 upsert**：`failed → pending` 重试、`pending/collected` 再次采集，均走 `INSERT OR REPLACE`（见 §6.1 重采集语义），不产生重复行。

### 6.5 监控调度改造点（必须改动，非新增）

`automation-scheduler` 的 `action.type` 当前**被硬编码**，新增任务类型需改 3 处：

| 文件:行 | 现状 | 改造 |
|---|---|---|
| `services/automation-task.js:111` | 校验写死 `type: 'fullAutoPipeline'` | 增加 `creatorMonitor` 为合法值 |
| `services/automation-task.js:164` | 构造写死 `type: 'fullAutoPipeline'` | 允许透传 |
| `services/automation-scheduler.js:277-297` | `_executeWithPolicy` 无 switch，恒调 `this._pipeline.startRun()` | 增加 `switch(task.action.type)` 分发 |
| `core/container.setup.js:206-210` | 执行器装配点 | 注册 creator 探测执行器 |

#### 6.5.1 为何复用而非新建独立调度器（CCG 评审 i3）

| 维度 | 复用 `automation-scheduler` | 新建独立调度器 |
|---|---|---|
| 触发器匹配 | 直接复用（`onAppStart/daily/weekly/interval`） | 需重写，含补触发等边界 |
| 间隔钳制 | 直接复用（5~1440 分钟硬钳制） | 需重写并自证等价 |
| 持久化 | 直接复用（`automation_tasks` 单键） | 新增表 + 新迁移 |
| 任务数上限 | 直接复用（20 个） | 需自定另一套上限 |
| 改动面 | 3 处 + switch，**但影响既有 4 类任务** | 零回归风险，但重复 ~300 行 |

**结论：复用。** 独立调度器虽有零回归优势，但要重复实现一套已验证的触发器与钳制逻辑，长期维护成本更高，且两套调度器并存本身就是新的冲突源。**代价（影响既有 4 类自动化任务）用回归测试对冲，不靠"应该没事"。**

#### 6.5.2 switch 的 default 分支：任务级 fail-closed，不拖垮调度器（CCG 评审 i4 修订）

**原设计错误**：曾直接 `throw`。评审指出这会让**一条脏数据任务炸掉整个 scheduler**——`_executeWithPolicy` 在调度循环里被调用，抛出未捕获异常会导致后续所有任务不再被触发，用户配置的自动化全部静默停摆，且因门禁失败而中断原本可能成功的执行。**这是"为一条坏数据牺牲整个系统"的典型错误设计。**

```js
switch (task.action.type) {
  case 'fullAutoPipeline': return this._executeWithPolicy(task)
  case 'creatorMonitor':    return this._executeCreatorMonitor(task)
  default:
    // 任务级 fail-closed：把这一条挂起并留痕，绝不 fallback 到 pipeline，
    // 也绝不 throw —— throw 会中断调度循环，导致其余任务全部停摆。
    this._markTaskPaused(task.id, 'unknown_type', `未知自动化任务类型: ${task.action.type}`)
    // 保留原始载荷并隔离，供诊断与回滚（CCG 评审 i8）
    this._quarantineTask(task)   // 写入隔离区：原始 JSON + taskId + 发现时间 + 来源
    logger.warn({ taskId: task.id, actionType: task.action.type, quarantined: true }, '未知任务类型已隔离，未执行')
    return { ok: false, skipped: true, reason: 'unknown_type' }
}
```

**未知类型的来源与治理**（CCG 评审 i8：不能只"处理"它，得能查它从哪来）：

| 可能来源 | 治理 |
|---|---|
| 旧版本残留（该类型在新版本已下线） | 隔离区保留原始载荷，UI 提供「此任务来自旧版本，可删除或转换」 |
| 导入/备份损坏 | 同上，隔离区标注 `suspect: true` |
| 未来新增类型未接线 | 开发者补齐 switch 后，隔离区任务可一键恢复 |
| 从不自动删除 | 自动删除 = 静默丢用户配置。**必须保留原始载荷直到用户显式处理** |

隔离区落 settings 单键 `automation_quarantine`（与 `automation_tasks` 同构，不新增表），UI 提供只读查看与显式「恢复 / 删除」两个动作。

**挂起必须主动告知（CCG 评审 i8）**：任务被挂起后若只在列表里静静躺着，用户可能长期不察觉自己的自动化已经停摆——而 UI 上「已启用」的开关还会误导他以为一切正常。因此挂起时 MUST：① 侧边栏/设置页显示**未收口任务徽标**并计数；② 首次挂起弹一次应用内通知；③ 任务卡片的启用开关**视觉上置灰但保持可见**（直接隐藏会让人以为任务不存在）；④ 徽标在用户处理前**持续存在**，不自动消失。

**隔离区的容量与脱敏（CCG 评审 i6：上一版说"从不自动删"却没给上限）**：

| 约束 | 规则 |
|---|---|
| **落库前脱敏** | 原始载荷含任务配置，可能带 token / 账号标识。写入前递归替换 `/(token|secret|password|apiKey|cookie)/i` 命中的字段为 `"<redacted>"`，并对所有字符串做 20 字符以上长 token 掩码 |
| **容量上限** | 最多保留 **50 条**，超出时丢弃最旧的；**丢弃前记日志**（`quarantine_evicted`），保证"数据没了"这件事本身可追溯 |
| **数量告警** | 达到 30 条时在设置页提示「有 {count} 条无法识别的历史自动化任务待处理」 |
| **人工清理审计** | 用户显式删除时记录 `deletedBy='user'`、`deletedAt`、`reason`，写入日志。**系统永不超过上限，用户删除永远留痕** |
| **保留期限** | 无固定期限（用户数据），但提供「清空隔离区」按钮而非自动清空 |

**为什么要有上限又不自动删**：不设上限会无限膨胀（每个损坏备份导入一次就多几条）；自动删则会在用户没注意时销毁自己的配置。**上限 + 日志 + 用户显式删除**三件套同时满足"不膨胀"和"不静默丢失"。

**三层防护的取舍**：

| 方案 | 后果 | 取舍 |
|---|---|---|
| `throw` | 一条脏任务 → 调度循环中断 → **所有自动化停摆** | ❌ 爆炸半径过大 |
| fallback 到 pipeline | 静默跑错任务，日志无线索，用户以为"在跑"实则跑错链路 | ❌ 静默失真 |
| **挂起该任务 + 留痕 + 继续** | 该任务不执行并显示明确错误；**其余任务不受影响** | ✅ **采用** |

fail-closed 的正确边界是**对这条任务**，不是对整个系统。挂起后 `automation:list` 该任务显示 `lastStatus='unknown_paused'` + `lastError`，用户可编辑任务类型后恢复。

**迁移期额外保护**：`automation_tasks` 是单个 JSON 键，schema 或类型迁移若误改了 `action.type` 的合法值集合，历史数据可能含未知类型。因此 `automation-task.js` 的校验**不得**在加载阶段就丢弃未知类型任务（会静默删数据），只能在校验时报错并保留原记录。

#### 6.5.3 回归测试覆盖范围（CCG 评审 i3）

改造必须由以下测试覆盖，否则视为未完成：

| 编号 | 回归项 |
|---|---|
| R1 | 既有 `fullAutoPipeline` 任务仍能正常创建、触发、执行（4 类触发器各一条） |
| R2 | 未知 `action.type` 抛错且**不执行**任何 pipeline |
| R3 | `creatorMonitor` 任务不进入 `pipeline.startRun()` |
| R4 | 既有任务的持久化数据（`automation_tasks` 单键）格式不变，可回滚 |
| R5 | 间隔钳制（<5 或 >1440 分钟）对两类任务一致生效 |

### 6.6 应用生命周期（必须写入设计，不可含糊）

| 场景 | 行为 | 实证 |
|---|---|---|
| 应用运行中 | 按间隔调度 | — |
| 窗口最小化 | **继续调度** | 任务在主进程，不依赖渲染层（`automation-scheduler.js:3`） |
| 关窗到托盘 | **不保证** | `window-close-policy.js:29-39` 仅当「有运行中流水线/发布」且托盘可用才隐藏到托盘；自动化定时任务本身不在该判据内 |
| 完全退出 | **停止，不补跑** | `automation-task.js:12-15`、`automation-scheduler.js:20-23` 明确不做补触发 |

**产品必须诚实告知用户**：「博主监控需要应用保持运行；关闭应用期间不会检查新作品，重新打开后仅检查增量，不会补齐关闭期间的全部内容。」

---

## 7. 数据校验

### 7.1 IPC 入参校验表

| 通道 | 字段 | 类型 | 校验 | 失败提示键 |
|---|---|---|---|---|
| `creator:follow` | `input` | string | 必填非空；trim 后长度 ≤ 512 | `creatorErrInvalidInput` |
| `creator:follow` | `checkIntervalMin` | int | 可选，默认 60；范围 5~1440 | `creatorErrIntervalRange` |
| `creator:follow` | `perCreatorLimit` | int/null | 可选，默认 null；非 null 时 1~100 | `creatorErrLimitRange` |
| `creator:collect` | `creatorId` | string | 必填；必须存在于 `creator_accounts` | `creatorErrCreatorMissing` |
| `creator:collect` | `count` | int | 必填；1 ≤ count ≤ 实际生效上限 | `creatorErrCountExceedsLimit` |
| `creator:collectOne` | `discoveryId` | string | 必填；必须存在于 `creator_discoveries` 且 `collect_state='pending'` | `creatorErrAlreadyCollected` |
| `creator:toggle` | `followId` | string | 必填；必须存在于 `creator_follows` | `creatorErrFollowMissing` |
| `creator:checkNow` | `followId` | string | 必填；同上 | `creatorErrFollowMissing` |

### 7.2 数量与上限规则（双轨）

| 常量 | 值 | 适用 |
|---|---|---|
| `CREATOR_COLLECT_ONECLICK_DEFAULT` | **5** | 「一键采集新作品」按钮默认数量 |
| `CREATOR_COLLECT_MANUAL_DEFAULT` | **50** | 「手动批量采集」弹窗默认数量 |
| `CREATOR_COLLECT_HARD_LIMIT` | **100** | 全局硬上限，任何路径不可超 |
| `per_creator_limit` | ≤ 100 | 单博主可设更低的个人上限，不可超过全局 |
| `CREATOR_MAX_FOLLOWING` | **50** | 最大关注博主数，与探测池（§7.3）联立求解，见 §7.3.3 |
| `CREATOR_AUTO_PAUSE_THRESHOLD` | **3** | 仅 Tier B 真故障累计到此值才暂停；Tier A 不累加 |

**生效上限计算**：`effective = per_creator_limit ?? CREATOR_COLLECT_HARD_LIMIT`，再 `min(effective, CREATOR_COLLECT_HARD_LIMIT)`。

**超限语义（硬要求）**：一律 **fail-closed 拒绝**，不做静默截断。

```
发现 12 条新作品，用户点「一键采集」，count 默认 5
→ 实际采集 5 条
→ 提示：已采集最新 5 条，剩余 7 条留待下次
```

| 场景 | 行为 | 提示 |
|---|---|---|
| count > 生效上限 | 拒绝，不执行 | `creatorErrCountExceedsLimit`：本次最多采集 {max} 条，请调整数量 |
| count ≤ 上限但发现数 > count | 执行 count 条，**必须提示剩余** | `creatorTruncated`：共发现 {found} 条，已采集最新 {collected} 条，剩余 {remain} 条留待下次 |
| 单条采集 | **不受上限约束** | — |
| 单条重复采集 | 拒绝（`collect_state != 'pending'`） | `creatorErrAlreadyCollected`：该作品已于 {time} 采集 |

### 7.3 预算模型（CCG 评审 i2/i4/v2-i1 修订：从物理池反推，不拍数字）

**原始设计是错的**：曾写「探测预算 200 次/天」，但默认 1 小时 × 50 频道 = **1,200 次探测/天**，预算与频率、频道数三者互相矛盾，监控根本跑不满。下表从 YouTube **物理配额**反推逻辑预算，使三者自洽。

#### 7.3.1 物理池与单位成本

YouTube Data API 物理上限 **10,000 units/day**（项目级，不可协商）。相关调用成本：

| 调用 | units | 单次上限 | 本方案用途 |
|---|---|---|---|
| `playlistItems.list` | 1 | 50 条/页 | 每次探测取该博主的最新作品列表 |
| `channels.list` | 1 | — | **仅首次**解析频道 URL → `channelId`（结果落库，之后不再调） |
| `videos.list` | 1 | **50 个 id/次** | 采集时批量补全时长、观看数等元数据 |
| 字幕（`youtube-transcript-api`） | **0** | — | 非 Data API，不消耗配额 |

**稳态单次探测成本 = 1 unit**（首次新增博主那次 = 2 units）。

**配额归属的现实约束（CCG 评审 i5：不可假装 10,000 是我们的）**

| 事实 | 影响 |
|---|---|
| 10,000 units/day 是 **Google Cloud 项目级**配额，**不是本应用独占** | 同一个 API Key 若被用户用于其他工具（其他项目、其他本地脚本），配额会被**共享消耗**，本方案的 1,500 探测池可能实际拿不到 |
| 配额可申请扩容 | 扩容后探测池比例不变（仍按物理池的 15% 切分），无需改配置 |
| 配额会按 Google 策略调整 | 因此切分**必须是相对比例**（探测 15% / 采集 60% / 余量 25%），不能写死绝对数字 |
| 本应用**读得到**自己的用量 | `videos.list`/`playlistItems.list` 响应头无配额信息，需另记本地计数；**读不到** Google 侧真实用量 |

**结论**：本方案的预算模型是**建立在物理池之上的逻辑配额**，是"我们最多用多少"的自律约定，**不是对 Google 配额的独占保证**。必须在 UI 上如实表述为「本应用今日配额占用」，而非「YouTube 剩余配额」。若用户同时用同一 Key 跑其他工具，本应用看到的仍是自己的计数——这是已知的可接受局限，需在设置页注明。

#### 7.3.1.1 外部争用时的动态收缩（CCG 评审 i5）

比例切分（15/60/25）在**外部消费均匀**时才有约束力。若同 Key 被其他程序占满，本应用的本地计数仍显示「才用了 200 units」，实际却已被拒。静态阈值对此完全失明，故需**由外部反馈驱动的收缩**：

| 外部信号 | 动作 |
|---|---|
| 收到 `quotaExceeded` / `dailyLimitExceeded` 而本地计数很低 | 判定为**外部争用**，把探测池与采集池同步收缩至当前的 50%（连续 2 次则收缩至 25%），并在 UI 标注「检测到同 Key 被其他程序使用，已自动收紧配额」 |
| 连续 3 天出现外部争用 | 提示用户「该 API Key 可能被其他工具共用，建议申请独立项目 Key」，并给出跳转 Google Cloud Console 的说明 |
| 正常响应恢复 | 每日重置时回到基准比例 |

这条的意义：**配额不可用时必须让用户知道是"额度被占"而不是"程序坏了"**——两者的排查方向完全不同。

#### 7.3.2 采集成本公式与实算

采集时 `videoId` 在**探测阶段就已随 `playlistItems` 拿到**，元数据缺口用 `videos.list` 批量补。因其单次可带 50 个 id，采集成本远低于"每条 1 unit"的直觉：

```
采集成本(units) = ceil(count / 50) × 1     // videos.list，每批至多 50 个 id
```

| 场景 | count | units | 说明 |
|---|---|---|---|
| 一键采集（默认） | 5 | **1** | 1 批 |
| 手动批量（默认） | 50 | **1** | 正好 1 批 |
| 手动批量（上限） | 100 | **2** | 2 批（跨页仅此一处翻页） |

字幕提取消耗 0 units，但**耗时高**（每条视频数秒），故仍走 `BatchRateController` 串行节流。

#### 7.3.3 物理池切分

| 池 | units/天 | 说明 |
|---|---|---|
| 探测池 | **1,500** | `50 频道 × 24 次/天 = 1,200`，留 25% 余量 |
| 采集池 | **6,000** | 每次采集 1 unit（`videos.list`），支持 6,000 条/天，远超实际需求 |
| 安全余量 | **2,500** | 抗重试、抗接口变动、不被任何逻辑消耗 |

#### 7.3.4 求解：预算 × 频率 × 频道数必须自洽

三者**不允许各自拍脑袋**，由下式约束并在 UI 上做实时校验：

```
日探测需求(units) = Σ_每个博主 (1440 / check_interval_min) × 1 unit
约束：日探测需求 ≤ 探测池(1500)  且  博主总数 ≤ MAX_FOLLOWING(50)
```

推论（默认 1 小时间隔下）：

| 关注数 | 全部 @1 小时 | 全部 @5 分钟(下限) | 可否全部 @1 小时 |
|---|---|---|---|
| 10 | 240 units | 2,880 units | ✅ |
| 25 | 600 units | 7,200 units | ✅ |
| 50 | **1,200 units** | **14,400 units** ❌ | ✅ 贴边；**但若有人把间隔调到 5 分钟即超限** |
| 62 | 1,488 units | 17,856 units | ⚠️ 贴边 |
| 63 | 1,512 units | 18,144 units | ❌ 拒绝新增 |

**⚠ 关键约束（CCG 评审 i1：此条此前缺失，导致 Critical）**：上表「全部 @1 小时」是**默认配置下的结果，不是保证**。间隔是可配的，而最小间隔是 **5 分钟**——若 50 个博主全被设为 5 分钟，日需求 = `1440/5 × 50 = 14,400 units`，**是探测池 1,500 的 9.6 倍**。因此约束**必须在每次配置变更时实时校验并强制执行**，绝不能只按默认值假定：

| 变更动作 | 校验时机 | 不满足时 |
|---|---|---|
| 新增关注 | 提交前计算 `Σ(1440/interval_min)` | 拒绝新增，提示 `creatorQuotaWouldExceed` |
| 修改某博主间隔 | 提交前重算总和 | 拒绝该次修改，提示需先调大其他博主间隔 |
| 批量调整间隔 | 提交前重算 | 整体拒绝，不做部分应用（避免进入不可预测状态） |

```js
function assertQuotaFits (follows, addingIntervalMin = null) {
  const total = follows.reduce((s, f) => s + 1440 / (addingIntervalMin ?? f.check_interval_min), 0)
  if (total > PROBE_POOL) throw new QuotaExceedError({
    projected: Math.ceil(total), pool: PROBE_POOL,
    hint: '请调大部分博主的检查频率，或减少关注数量'   // 注意是「调大间隔」而非「调大频率」
  })
  return total
}
```

**⚠ 必须做成 DB 层不变量，不能只做入口校验（CCG 评审 i1）**

只在校验入口调用 `assertQuotaFits` 是不够的——**导入、恢复备份、迁移、启动加载、直接写库**都能绕过它，绕过结果是"监控静默饿死一部分博主"，且用户完全不知情。四道防线：

| 防线 | 时机 | 行为 |
|---|---|---|
| 1. 单一 service 入口 | 所有 CLI/IPC 写入路径 | **所有** `creator_follows` 写入必须经 `creator-follow-service.upsert()`，该函数内强制调 `assertQuotaFits`；禁止其他模块直连 store 写该表 |
| 2. 启动预检 | `phase3-services.js` store 初始化后 | 全量重算；超限则**不删数据**，按间隔升序保底运行并置全局 `quota_degraded=true`，UI 显示 `creatorProbeSkipped` |
| 3. 导入/恢复前 | 导入流程入口 | 先跑冲突预检 + 配额预检，**失败全量拒绝整个导入**（部分导入会留下无法判断来源的混合数据） |
| 4. 批量操作事务 | 批量改间隔 | 全量校验通过后在**单个 DB 事务**内应用；任一条不满足则 `ROLLBACK`，**不做部分应用**（部分应用会进入不可预测状态） |

**为什么第 2 条不能 fail-closed 拒绝启动**：存量数据已经超限时拒绝启动 = 应用不可用，用户无法自救。正确做法是**降级运行 + 可见告警**——数据是用户的，我们无权替他删；让监控继续但明确告知哪些没被检查。

**关于"部分应用"的说明**：函数式上可以"尽量应用能应用的"，但那会让用户以为自己配了 50 个 1 小时间隔、实际只有 30 个在跑，且 UI 显示的间隔与真实调度不一致。**宁可整体拒绝并让用户调整**。

**「每博主最小可支撑间隔」参考表**（探测池 1,500 下，单博主视角）：

| 关注数 | 保证不超池所需的最小间隔 |
|---|---|
| 1~50 | ≥ 60 分钟 |
| 51~62 | ≥ 1440 分钟（一天一次） |
| > 62 | 不支持（拒绝新增） |

**动态降级求解**（当历史数据/导入导致总和超限）：不静默失败，而是**按 `check_interval_min` 从小到大（检查更频繁的优先）保底，剩余博主本轮跳过**，并在 UI 角标显示 `creatorProbeSkipped`。绝不出现"监控看起来在跑但实际饿死一部分博主"的静默失真。

#### 7.3.5 超限行为与告警

| 情形 | 行为 |
|---|---|
| 探测池耗尽 | 跳过本轮，`status` 不变（**不计入连续失败**），记 `CREATOR_PROBE_QUOTA_EXHAUSTED` |
| 采集池耗尽 | 拒绝执行，`creatorErrQuotaExhausted` |
| 物理池用量 ≥ 80%（8,000 units） | 记 WARN 日志 + UI 配额水位条变琥珀色 |

#### 7.3.5.1 采集侧的日计数与硬熔断（CCG 评审 i3）

上文的配额公式只覆盖了「正常路径」。实际运行还有三处消耗，**必须一并计入，否则采集池会被非预期路径吃光**：

| 消耗源 | 计入方式 |
|---|---|
| 手动解析频道（`creator:follow` 时的 `channels.list`） | 计入探测池（1 unit/次） |
| 失败重试与退避重发 | **每次重试重新计费**，不因「已失败」而免计 |
| 批次中途失败后的整批回滚重跑 | 整批重跑 = 重新计费，故须有批次幂等键防重复扣 |

**采集硬熔断**：日采集计数 ≥ 采集池的 **90%** 时，**拒绝新的采集请求并立即提示**（不等耗尽）——耗尽后才拒会让用户在最后一刻才发现，且此时已无配额可用。

**重试预算**：单条内容自动重试上限 **2 次**（与 `attempt_count ≤ 5` 区分：后者是跨会话累计，前者是单次运行内）。超预算转 `failed` 等用户显式重试。

#### 7.3.5.2 启动存量超限的确定性跳过集（CCG 评审 i4）

「降级运行」必须**可复现、可解释**，否则用户看到「有的查了有的没查」却不知道为什么。

| 规则 | 定义 |
|---|---|
| 排序键 | `check_interval_min ASC, created_at ASC` —— **间隔小（检查更频繁）的优先保底**，同间隔按关注先后 |
| 跳过集 | 从排序末尾起，逐个放入本轮跳过集，直到累计需求 ≤ 探测池 |
| 确定性 | 同一份数据 + 同一配额 → **每次启动得到完全相同的跳过集**（不得依赖遍历顺序或随机） |
| 是否耗配额 | **被跳过的博主不发起任何请求，因此不消耗配额** |
| 恢复条件 | 用户调大任一被跳过博主的间隔、或减少关注数，使总量回到池内 → **下一轮自动恢复，无需重启** |
| 可见性 | UI 列出**每一个**被跳过博主及其间隔与被跳原因，不只给总数 |

#### 7.3.5.3 收缩的冷却与恢复（CCG 评审 i8）

单纯收缩到 50%/25% 会因瞬时 `quotaExceeded` 或外部程序退出而**长期停在低水位**，必须给它上界：

| 规则 | 定义 |
|---|---|
| 冷却 | 收到 `quotaExceeded` 后进入 **30 分钟冷却**，冷却期内不发任何探测与采集请求（避免持续撞墙被判定滥用） |
| TTL | 每次收缩带 **24 小时 TTL**，到点无条件回基准比例——宁可第二天再撞一次，也不永久降级 |
| 验证恢复 | 回基准后若首次请求即 `quotaExceeded`，再次收缩并重置 TTL；连续 3 天则判定「Key 确被外部共用」，转 Info 提示申请独立 Key |
| 冷却中的 UI | 显示「配额冷却中，{minutes} 分钟后重试」，**不显示为失败** |

#### 7.3.5.4 跨日重置与已发请求对账（CCG 评审 i8）

内存计数在**崩溃 / 改系统时间 / 应用被强杀**后会与真实消耗脱账，导致超发或误拒。必须持久化：

| 机制 | 定义 |
|---|---|
| 持久 ledger | `collection_quota_ledger(day, kind, units, request_sig, created_at)`，与业务同库；**每个 API 请求成功后写一条** |
| 计数真源 | 当日计数 = ledger 按 `day + kind` 求和，**不用内存累加器**（内存仅作缓存，ledger 才是准） |
| 启动对账 | 启动时重算当日已消耗量并与缓存比对，不一致则以 ledger 为准并记 WARN |
| 跨日重置 | 依赖 `day` 字段自然分界，**不做定时器清零**（定时器在应用关闭时不触发，会漏清或重复清） |
| 幂等 | `request_sig = sha256(platform + kind + external_id + attempt_seq)`，崩溃重发同一请求不重复计费 |
| 巡检的配额准入 | 完整性巡检把 `collected` 复位为 `pending` 会触发重采，属潜在消耗——复位前须过采集池准入校验 |
#### 7.3.6 配额语义澄清（CCG 评审 i4）

「探测配额」的单位是 **API units**，不是"次数"也不是"频道数"。三者换算关系固定为：稳态 1 次探测 = 1 unit = 1 次 `playlistItems.list`。

#### 7.3.7 单条采集的配额边界（CCG 评审 i8）

**单条采集仅豁免「数量上限」，不豁免任何配额**：仍消耗采集池 1 unit（`videos.list`），采集池耗尽时同样拒绝并提示。字幕提取不消耗 Data API 配额。

### 7.4 凭证校验与存储（CCG 评审 i5 修订）

| 平台 | 所需凭证 | 缺失/失效时 |
|---|---|---|
| YouTube | Data API v3 `api_key` | `creatorErrCredentialMissing`：未配置 YouTube API Key，无法检查新作品。请在设置 → 服务配置中填写。 |

**存储要求（安全硬约束）**：

| 要求 | 规则 |
|---|---|
| 加密 | 经 Electron **`safeStorage`** 加密（Linux 需 `safeStorage` 后端可用，否则拒绝保存而非降级明文） |
| 落点 | 密文存 settings（`credential_youtube_api_key_enc`），**密钥本身永不落 SQLite 明文列** |
| 禁止 | 不写日志、不进 `violations.jsonl`、不进 `.adversarial/`、不进崩溃报告、不进任何 Git 跟踪文件 |
| **IPC 边界（双向不对称）** | **写入方向**：允许一次性 `settings:setYoutubeApiKey({ key })` 把用户输入的明文送入主进程——用户必须在渲染层输入，这条无法回避。**读取方向**：**永不回传明文**，所有查询通道只返回 `status` 与 `fingerprint`（末 4 位哈希） |
| 保存后清除 | 主进程 `safeStorage.encryptString` 后立即丢弃明文引用；渲染层在 `set` 成功回调后**立刻把输入框清空**，不写入任何 store/pinia 持久化、不进 `localStorage`、不进前端日志 |
| 内存 | 仅在发起请求时短暂解密，用后即弃，不挂全局变量、不进闭包捕获 |
| `safeStorage` 不可用 | **fail-closed：整个博主监控功能禁用**（非 YouTube 平台的采集不受影响），UI 明确提示「系统密钥库不可用，无法安全保存 API Key」。**绝不允许降级为明文保存** |
| 失效 | API 返回 `keyInvalid` / `accessNotConfigured` → `fatal_paused`（见 §6.3），UI 直达设置页 |

**凭证状态必须可区分（CCG 评审 i7：DPAPI 损坏/换机/升级时用户分不清「没配」还是「配了但读不出来」）**——这三种情况若都报"未配置"，用户会反复重新填 Key 却依然失败：

| 状态 | 判定方式 | UI 文案 |
|---|---|---|
| `not_configured` | settings 无该键 | `未配置 YouTube API Key` → 引导填写 |
| `unavailable` | `safeStorage.isEncryptionAvailable() === false` | `系统密钥库不可用，无法安全保存 API Key` → 引导检查系统环境（Linux 无 keyring） |
| `decrypt_failed` | 有键但 `safeStorage.decryptString` 抛错（DPAPI 损坏、换机、用户账户变更） | `已保存的 API Key 无法解密，可能因更换系统或账户而失效。请重新填写。` |
| `ok` | 解密成功 | 显示 `已配置（末四位 {fingerprint}）` |

IPC 只返回 `{ status, fingerprint }`，**任何分支都不回传 Key 原文**；日志同理（仅 `credentialStatus` + `fingerprint`，无明文）。

**为什么读取方向绝不能回传明文**：渲染层是 XSS 与恶意扩展的高暴露面，preload 会把返回值原样暴露给页面。一旦 Key 被回读，它就会进 DOM、devtools 以及任何注入脚本——即使通道本身"只允许主进程调用"。**写入方向无法避免，但读取方向是单方面可控的，所以只对读取设禁令。**

#### 7.4.1 reason 优先级（CCG 评审 i8）

响应 `errors` 数组可能含多个 `reason`，取第一条会误判。定义显式优先级，**按此顺序匹配，命中即停**：

| 优先级 | reason | 归类 |
|---|---|---|
| 1 | `quotaExceeded` / `dailyLimitExceeded` / `rateLimitExceeded` / `userRateLimitExceeded` | A 节流 |
| 2 | `keyInvalid` / `accessNotConfigured` / `ipRefererBlocked` / `forbidden` | C 致命 |
| 3 | `channelNotFound` / `playlistNotFound` | B 真故障 |
| 4 | `videoNotFound` / `invalidPageToken` | item 单资源 |
| 5 | 其余 / 无 | B 兜底 |

**空 body 时**：记录 HTTP 状态码 + `x-goog-request-id`（用于向 Google 报障）+ 响应体前 200 字脱敏摘要，三者缺一不可——只有状态码无法定位配额问题。

**为什么不用明文存 SQLite**：桌面应用的 SQLite 文件位于用户目录，本机任何脚本或恶意软件可直接读取；API Key 泄露意味着配额被他人盗用甚至账号被关联。`safeStorage` 在 Windows 上走 DPAPI、macOS 走 Keychain、Linux 走 libsecret，是本仓既有的正确选择。

### 7.5 内容安全校验

| 校验项 | 规则 |
|---|---|
| 标题 | 长度 ≤ 200，超长截断并记 `truncated: true` |
| 正文 | 非空；空则该条判失败（沿用 `normalizeViralItem` 的 fail-closed 约定，`knowledge-library-store.js:19`） |
| URL | 必须 http/https；其余协议拒绝 |
| `thumbnail_url` | 仅取 `content-aggregator` 返回的 thumbnails；不发起额外请求 |

### 7.6 内容质量分级（CCG 评审 i6 修订）

`youtube-transcript-api` 是软依赖，缺失时回落到 `description`——而 description 往往只有一两百字，**直接送 AI 写作会产生低质量结果**。因此必须把内容质量作为**一等字段**贯穿全链路，而不是采集后才知道。

| 等级 | 判据（`metadata.transcript_source`） | 正文来源 | 送 AI 写作建议 |
|---|---|---|---|
| `full` | `subtitle` | 完整字幕 | ✅ 推荐，正文质量高 |
| `partial` | `description` 且长度 ≥ 800 字 | 视频描述 | ⚠️ 可用，提示「正文来自视频描述，质量有限」 |
| `stub` | `description` 且长度 < 800 字 | 视频描述 | ⛔ 默认不推荐，UI 明示「仅标题+简介，AI 写作质量可能不佳」 |

**落库**：`creator_discoveries.transcript_source` 存原始值，`content_quality` 存派生等级（`full`/`partial`/`stub`），两者均在**探测阶段**（`fetch_transcript=False` 时只看 `snippet.description` 长度即可初判）写入，不等到采集时才知道。

**UI**：发现列表每行显示质量徽章（见 §9.3）；`stub` 等级的「送入 AI 写作」按钮**降级为次要样式**并带二次确认。

---

## 8. 功能逻辑

### 8.0 端到端可用性：来源矩阵与 P0 验证标准（CCG 评审 i2 Critical）

> 「频道枚举成功」**不等于**「采集链路成立」。枚举只证明 `playlistItems` 可达；正文从哪来、拿不拿得到、失败长什么样，都必须逐项说清，否则实现阶段才发现就太晚。

#### 8.0.1 正文来源矩阵

| 来源 | API/路径 | 是否消耗 Data API 配额 | 内容质量 | 主要失败形态 | 降级 |
|---|---|---|---|---|---|
| **字幕** | `youtube-transcript-api`（非 Data API） | **0** | `full` | 视频无字幕轨 / 语言不匹配 / 地区限制 | 落到描述 |
| **AI 识别补正文** | `YouTubeCollector(llm_config=...)` | 0（但消耗 LLM 额度） | `derived` | 未配置 LLM / ASR 失败 / 视频过短无语音 | 落到描述 |
| **视频描述** | `snippet.description`（随 `playlistItems` 免费带出） | 0 | `partial` / `stub` | 描述为空或极短 | —— |
| **媒体文件** | `yt-dlp` + ffmpeg | 0（非 Data API） | 不产生正文 | 无 yt-dlp / 地区限制 / 大文件超时 | **不阻塞正文采集**，仅影响封面与时长 |

**关键结论**：**正文链路完全不依赖 Data API 配额**——字幕与描述都随 `playlistItems` 免费返回。这意味着配额只影响"能否发现新作品"，**不影响"能否拿到正文"**。设计上的推论：配额耗尽时，已发现的条目仍可正常采集，不应把两者混为一谈（呼应 §7.3 的双轨分离）。

#### 8.0.2 端到端 P0 验证标准（实现第一步必须先过）

| 编号 | 验证项 | 判据 | 失败则 |
|---|---|---|---|
| **E2E-1** | 频道解析 | 4 种输入形态各取一个真实频道，均解析到 `channelId` 且归并为一行 | 阻断后续，先修解析层 |
| **E2E-2** | 作品枚举 | 返回条数 > 0，且 `video_id` 与 `channel_id` 均非空 | 配额/鉴权问题，查 `reason` 分级 |
| **E2E-3** | **字幕正文** | 取首个视频，正文长度 ≥ 500 字且 `transcript_source='subtitle'` | 若全 `description` 则质量不可用，需评估 `llm_config` 或换频道 |
| **E2E-4** | 幂等 | 同一频道连续探测 3 次，`creator_discoveries` 行数不变 | 唯一索引未生效 |
| **E2E-5** | 采集入库 | 单条采集后 `viral_library` 有行且 `content` 非空非空串 | 正文链路断裂 |
| **E2E-6** | 打包可用 | `electron-builder --dir` 后 asar 内 `require('content_aggregator')` 成功 | 打包缺依赖，须改依赖声明 |
| **E2E-7** | 送 AI 写作 | 单条走 `startRun` 能产出草稿 | pipeline 契约不匹配 |

**P0 冒烟必须在真实 API Key 下跑通 E2E-1~E2E-5 才开始写其余代码**。理由：本特性最大风险不是逻辑复杂度，而是"依赖不可用"——`content-aggregator` 是外部 pip 包且为可选依赖（`pyproject.toml:21`），一旦打包缺失或版本漂移，全部工作归零。先花一次冒烟把这条风险证伪，比先写 4,000 行再发现强。

**风险与应对**：

| 风险 | 后果 | 应对 |
|---|---|---|
| `content-aggregator` 未打进包 | 全盘不可用 | E2E-6 前置；必要时把 YouTube 采集改为本仓内自实现（官方 API 本身不复杂，约 200 行） |
| 该包版本漂移改接口 | 采集结果结构变化 | 在 `creator-collector.js` 做**结构归一化 + schema 断言**，不把外部结构直接透传到业务层 |
| 大频道冷启动慢 | 首轮探测慢 | `pageSize` 滚动窗口 + `probe` 独立配额 |

### 8.1 添加博主

```
用户粘贴输入
  │
  ├─ 归一化：trim → 提取 UC…/@handle//c//user → 得到 rawId
  │    └─ 无法识别 → creatorErrInvalidInput（fail-closed，不猜测）
  │
  ├─ 查重：(platform='youtube', external_id=rawId) 是否已存在
  │    └─ 存在 → 复用 creator_accounts 行，focus 到该博主
  │
  ├─ 解析频道：YouTubeCollector(channels API)
  │    ├─ 成功 → 写 creator_accounts（含 display_name / handle / avatar）
  │    └─ 404   → creatorErrChannelNotFound
  │
  ├─ 建关注：写 creator_follows（status='active', check_interval_min, per_creator_limit）
  │
  └─ 立即首次探测（fetch_transcript=False）
       └─ 有新作品 → 写 creator_discoveries，角标 +1
```

### 8.2 监控探测与增量对比（CCG 评审 i2/i7/v2-i1/i3 修订）

```
调度器触发（check_interval_min 到期）
  │
  ├─ 筛选：status='active' AND enabled=1，按 check_interval_min 从小到大排序
  │
  ├─ 扣探测配额（units）：剩余 < 所需 → 按 §7.3.3 动态降级跳过剩余博主，
  │                        status 不变、不计入连续失败，记 CREATOR_PROBE_QUOTA_EXHAUSTED
  │
  ├─ YouTubeCollector(channel_id=…, fetch_transcript=False)
  │    取 playlistItems，pageSize = min(50, 已采集数 + 10)  ← 滚动窗口，省配额
  │    ⚠ 探测阶段 fetch_transcript=False：字幕不消耗 Data API 配额，
  │      但耗时高，不该在每次巡检时拉
  │
  ├─ 逐条 INSERT OR IGNORE creator_discoveries
  │    ├─ 唯一约束冲突 = 已见过 → 跳过（幂等）
  │    └─ 同时写 content_quality（按 description 长度初判，见 §7.6）
  │
  ├─ classifyFailure(httpStatus, body) 分级（见 §8.6）
  │    ├─ Tier A → 不动 consecutive_failures，指数退避；本轮结束
  │    ├─ Tier B → consecutive_failures += 1；≥3 → status='auto_paused'
  │    └─ Tier C → 立即 status='fatal_paused' + paused_reason
  │
  ├─ 成功：consecutive_failures=0, last_success_at=now
  │
  └─ 推送 UI：角标数字更新 + 配额水位条刷新
```

**滚动窗口的配额意义**：稳态每次探测固定消耗 **1 unit**（`playlistItems.list` 一页），与返回条数无关。`pageSize` 影响的是**首次发现新作品的延迟**而非配额——`pageSize` 过小会导致高频发布博主的作品被挤出窗口。故取 `min(50, 已采集数 + 10)`：50 已是 YouTube 单页上限，再大需翻页（再吃 1 unit）。

### 8.3 一键批量采集

```
用户点「一键采集新作品」
  │
  ├─ count = CREATOR_COLLECT_ONECLICK_DEFAULT（5）
  ├─ effective = 生效上限（见 §7.2）
  ├─ count > effective → creatorErrCountExceedsLimit，拒绝
  │
  ├─ 待采集 = SELECT ... WHERE collect_state='pending' ORDER BY published_at DESC LIMIT count
  │
  ├─ BatchRateController 串行节流（base 8000ms + jitter 4000ms，退避 ×2，最多 3 次后熔断）
  │
  ├─ 每条：YouTubeCollector 拉正文（fetch_transcript=True）
  │    ├─ 成功 → INSERT viral_library (source='creator') + discovery.collect_state='collected'
  │    └─ 失败 → 该条 failed，discovery 保持 pending（可重试）
  │
  └─ 结果提示：
     ├─ 全部成功 → creatorBatchSuccess：已采集 {collected} 条内容
     ├─ 部分成功 → creatorBatchPartial：成功 {collected} 条，失败 {failed} 条
     └─ 有剩余   → creatorTruncated：共发现 {found} 条，已采集最新 {collected} 条，剩余 {remain} 条留待下次
```

**失败隔离**：单条失败不影响其他条目；失败的发现项保持 `pending`，用户可再次一键采集。

#### 8.3.1 outbox / 最终化协议（CCG 评审 i7 Critical：事务解决不了双写）

**问题**：`BEGIN IMMEDIATE` 只能保证数据库内原子。采集一条作品的真实副作用是**三处**：① `creator_discoveries` 状态、② `viral_library` 行、③ **事务外的产物**（字幕文本、媒体文件、第三方缓存）。若先提交 ①② 再写 ③ 失败，或先写 ③ 再崩溃，都会留下不一致，且 **token CAS 无法撤销已提交的插入**。

**方案：先落产物到 staging，再同事务入库，最后异步最终化。**

```sql
-- staging 目录：userData/creator-staging/<discovery_id>/
-- ① 先写产物（可重试、可清理，不污染采集库）
--    字幕/媒体写完后计算内容指纹，与 claim_token 一起记录
-- ② BEGIN IMMEDIATE
--    校验 claim_token 未变 → INSERT/UPSERT viral_library（幂等键 = (platform, external_id)）
--    → UPDATE creator_discoveries SET collect_state='collected', claim_token 失效
--    → INSERT INTO collection_outbox (id, kind, ref_id, payload_json, state)  ← 同事务！
-- COMMIT
-- ③ 异步 worker 消费 outbox：把 staging 产物搬到最终位置 / 清理 staging
--    失败则重试；连续失败超限则告警并保留 staging（不丢数据）
```

| 要素 | 定义 |
|---|---|
| **outbox 表** | `collection_outbox(id, kind, ref_id, payload_json, state, retry_count, next_retry_at, created_at)`；与业务写入**同事务**落盘，是「已提交但未最终化」的唯一真源 |
| **幂等键** | `(platform, external_id)` 唯一索引；重复消费同一条只会覆盖不会重复插入 |
| **删除竞态：tombstone** | 删除发生在最终化之前时，光撤 outbox 不够——worker 可能正在消费它。outbox 记录须携带 `claim_token` 快照，最终化事务内校验 `claim_token` 是否仍有效；删除事务内同时写 **tombstone 标记**，使任何迟到的 finalizer 在校验 token 时必然失败并放弃 |
| **死信与上限** | 重试上限 **5 次**后转 `dead_letter` 状态并**告警**，不再自动重试（永久失败无限重试会耗尽 staging 且永不清扫）；死信由人工在 UI 重放或丢弃 |
| **产物幂等** | 产物文件名含内容指纹（`sha256(正文)[:16]`），重复搬运是覆盖而非追加 |
| **可重试** | outbox 消费失败按指数退避重试（1min→8min→1h），上限 5 次后进死信 |
| **补偿清理** | 崩溃残留的 staging 目录由启动清扫按 `mtime > 24h` 清理；**但 outbox 中仍有未完成记录（含死信）的不清**——死信需要人工介入，产物必须留着 |
| **一致性判据** | ⚠ **终态判据必须与写入时机对齐**（CCG 评审 i1 纠正）。原设计把「写 `viral_library` + `collected`」与「outbox 置 `done`」分在两处，两者之间存在一个窗口：此刻 `collected` 已成立、outbox 却未 `done`，**三者等价的判据在该窗口内不成立**，删除与巡检会误判。<br>正确做法：**把三者放进同一个最终化事务**——`BEGIN IMMEDIATE` → 搬产物入最终位（文件级 rename，失败整体回滚）→ UPSERT `viral_library` → `collect_state=collected` + token 失效 → outbox 置 `done` → `COMMIT`。中间态用 **`collecting` / `ready`** 承载，**不参与终态判据**；只有 `collected` 是终态 |
| **删除的原子性** | 删除采集库条目 MUST 在**同一事务**内完成：删 `viral_library` + discovery 落回 `pending` + `claim_token + 1`（使在途 worker 失效）+ 撤未 `done` 的 outbox。**缺任何一环都会留下漂移**：只删内容不落回 `pending` ⇒ 探测因唯一键跳过，该作品**永久不可再采**；不撤 outbox ⇒ 迟到的 finalizer 会把产物搬回来，出现「已删除却又复活」 |
| **完整性巡检** | 每日全表核对：`collect_state=collected` 但 `viral_library` 无对应行 ⇒ 复位 `pending` + 记日志；`viral_library` 有行但无对应 discovery（历史/其他来源数据）**只计数不清理**，避免误伤。**巡检是对「任何未预期路径造成漂移」的兜底，不能只靠代码纪律** |

**为什么不能用「先入库再补产物」**：那正是会产生「已采集但内容为空」的路径——用户看到已采集却拿不到正文，而 `content NOT NULL` 只挡得住 NULL 挡不住空串。**先落产物再入库**把失败暴露在入库之前，此时 discovery 仍是 `failed`，用户重试即可。

### 8.4 单条采集

```
发现列表每行的「采集」按钮（零填参）
  │
  ├─ discovery.collect_state != 'pending' → 按钮置灰显示「已采集 · {time}」
  │
  └─ pending → 单条采集（不受数量上限约束）
       ├─ 成功 → collect_state='collected' + collected_at
       │        按钮即时切换为「已采集 · {time}」（持久态，刷新不丢）
       ├─ 失败 → creatorCollectFailed：采集失败：{message}
       └─ 成功后提供次级动作：「送入 AI 写作」
```

「送入 AI 写作」走既有 DAG：`full-auto-pipeline.startRun({ urls:[单条URL], sourceType:'url' })`，`collect → rewrite → create` 三段执行，**不执行 publish**（发布由用户显式触发，符合非目标 N1）。

**契约细节（CCG 评审 i7）**：

| 项 | 定义 |
|---|---|
| 入参 | `{ discoveryId }`。主进程内部先 claim 该 discovery（§6.4），再取 `viral_library` 行组装 `{ urls:[item.url], sourceType:'url' }` |
| 正文缺失 | 若 `content` 为空或 `content_quality='stub'`，**不静默降级**：`stub` 时二次确认后仍可送，但日志记 `lowQualityInput: true` |
| 幂等键 | `runId = hash(discoveryId + viralItem.updated_at)`。同一版本内容重复点击返回**同一个 runId** 而非重复起跑，防止重复消耗 LLM 额度 |
| 失败映射 | 既有 `userErrors` 命名空间复用（`NOT_SIGNED_IN` / `access_denied` 等），不新造错误码 |
| 取消 | 返回 `runId` 后 UI 可经既有 `automation:*` 取消通道中止 |
| 产出 | AI 草稿进既有草稿箱，**不回写** `creator_discoveries`（采集状态与写作状态是两回事） |

**幂等性说明**：`viral_library.updated_at` 参与哈希，使「内容更新后重新送 AI」能正常重新生成，而「同一内容反复点」不会重复消耗配额与 LLM 费用——这是该入口最容易被忽略的成本陷阱。

#### 8.4.1 外发边界与合规（CCG 评审 i9）

采集到的正文是**他人创作的内容**，且字幕/描述可能包含创作者的姓名、观点、甚至可识别的个人信息。送入 LLM 是一次**出站传输**，必须说清边界：

| 项 | 定义 |
|---|---|
| **外发字段** | **只外发正文 `content` 与 `title`**。**绝不外发**：`author`、`channel_id`、`url`、`thumbnails`、`subscriber_count`、任何 `metadata` 中的用户标识字段 |
| **出站目标** | 仅用户**已配置**的 LLM 供应商（BYOK 或既有模型设置），**不新增任何隐式出站通道** |
| **留存** | LLM 侧是否留存由供应商政策决定，UI 须在**首次外发前**一次性说明并要求确认（`creatorOutboundConsent`）；用户可随时撤回，撤回后该入口置灰 |
| **脱敏** | 正文中的邮箱、手机号、长数字串在出站前做正则掩码（创作者口播里报的价格/联系方式不应进入我们的模型上下文） |
| **版权提示** | 送入 AI 写作得到的是**参考素材**，不是可发布内容。产品文案须避免暗示「采集即可直接发布」（与非目标 N1 一致） |
| **可追溯** | 每次外发记 `sent_to_writer_at` 与 `writer_run_id`，便于回答「这段草稿的来源是什么」 |

**为什么不默认外发**：采集内容默认留在本地采集库，只有用户**显式点击**才外发。这是「本地优先、外发需同意」的边界，也是本特性不构成内容合规风险的前提。

### 8.5 手动批量采集

```
用户点「手动采集」
  │
  ├─ 数量输入框，默认 50，上限 100（即生效上限）
  │    └─ 输入 > 上限 → 输入框即时标红 + creatorErrCountExceedsLimit
  │
  ├─ 若该博主历史发现项不足 count 条：
  │    └─ 提示 creatorDiscoverShortfall：该博主仅发现 {found} 条待采集作品，将全部采集
  │
  └─ 执行（同 §8.3 流程）
```

### 8.6 失败分级与降级（CCG 评审 i7/v2-i3 修订：按 API reason 分类，不按 HTTP 状态码）

**原设计错误**：曾按 HTTP 4xx/5xx 区分「可自愈 / 计入连续失败」。但 YouTube Data API 的 **`quotaExceeded` 与 `rateLimitExceeded` 都返回 403（4xx）**——若按状态码，它们会被判成"真故障"并累计到 `auto_paused`，与「配额耗尽不惩罚连续失败」的设计**直接矛盾**，用户会因配额耗尽被锁进暂停态。

**修订**：分类依据改为 **API 响应体的 `error.errors[].reason`（或 `error.code`）**，HTTP 状态码仅作兜底。

```js
// YouTube Data API 错误体形如：
// { "error": { "code": 403, "message": "...", "errors": [{ "reason": "quotaExceeded", ... }] } }
// ⚠ 实际调用可能拿到：空 body（代理截断）、HTML 错误页、或 errors 数组缺失。
//    因此必须先处理「reason 缺失」，再按状态码兜底，否则会把节流误判成故障。
function classifyFailure (httpStatus, body, transportErr) {
  // 传输层错误优先：根本没拿到 HTTP 响应
  if (transportErr) {
    if (['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(transportErr.code))
      return { tier: 'transient', reason: transportErr.code }
    return { tier: 'unknown', reason: `transport:${transportErr.code || 'unknown'}` }
  }
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || null

  // Tier A：正常节流 / 瞬时波动 —— 不计入连续失败
  // ⚠ 枚举须覆盖全部官方 reason（CCG 评审 i4 指出遗漏）：
  //   quotaExceeded / dailyLimitExceeded / rateLimitExceeded / userRateLimitExceeded
  //   ⚠ keyInvalid 既可能返回 400 也可能 403，故分类**以 reason 为主因、状态码仅兜底**，
  //     不能写成 "4xx → 可自愈 / 5xx → 瞬时" 这种按状态码的粗判。
  if (['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded',
       'userRateLimitExceeded', 'userRateLimitExceededUnreg'].includes(reason))
    return { tier: 'throttled', reason }
  if (reason === null && httpStatus === 429) return { tier: 'throttled', reason: 'http_429' }  // 无 reason 的 429 仍是节流
  if (['backendError', 'internalError'].includes(reason)) return { tier: 'transient', reason }
  if (reason === null && httpStatus >= 500) return { tier: 'transient', reason: `http_${httpStatus}` }
  // Tier C：不可自愈 —— 立即暂停（keyInvalid 在此处按 reason 命中，与状态码无关）
  if (['keyInvalid', 'keyNotValid', 'badRequest', 'accessNotConfigured',
       'accessForbidden', 'forbidden', 'youtubeSignupRequired'].includes(reason))
    return { tier: 'fatal', reason }
  if (httpStatus === 401) return { tier: 'fatal', reason: `http_${httpStatus}` }
  if (httpStatus === 403 && reason === null) return { tier: 'fatal', reason: 'http_403_no_reason' }
  // Tier B：真故障（**博主级** —— 会让监控持续无意义，故计入连续失败）
  // ⚠ videoNotFound / invalidPageToken 是**单资源级**错误（某条视频被删、翻页游标过期），
  //   不是博主级故障。若计入，会因一条已删视频把整个博主永久停用 —— 必须单列。
  if (['channelNotFound', 'playlistNotFound'].includes(reason)) return { tier: 'permanent', reason }
  if (reason === 'videoNotFound') return { tier: 'item', reason }   // 仅该条，不动博主计数
  // ⚠ invalidPageToken 也**不属于** item 级（CCG 评审 i6 二次纠正）：
  //   它是分页实现缺陷或游标过期，归 item 会「跳过该条后继续翻页」，
  //   结果是**静默丢失后续分页的全部作品**——比报错更糟。归 B 级任务级失败，
  //   触发重试与日志告警，宁可本次探测失败也不能少报作品。
  if (reason === 'invalidPageToken') return { tier: 'permanent', reason }
  // ⚠ ipRefererBlocked 不属于 item 级（CCG 评审 i5 纠正）：
  //   它是 API Key / IP / referrer 被拒导致的**应用级 403**，会让所有请求持续失败，
  //   归入 item 级会变成「每条都失败但博主永不暂停」，监控静默失效。必须归 C 级。
  if (reason === 'ipRefererBlocked') return { tier: 'fatal', reason }
  // 兜底：reason 缺失且状态码无法归类 → unknown。
  // ⚠ fail-closed 取 B（计入失败）而非静默放行：分类失败本身是需要暴露的异常，
  //    放行会让所有无法识别的错误都无声跳过。
  return { tier: 'permanent', reason: reason || `unknown_http_${httpStatus}` }
}
```

**为什么 429 即使没有 reason 也归 Tier A**：429 的语义就是 Too Many Requests，**无论 body 形状如何都是节流**。若因 body 解析失败而落到兜底分支，会把正常的节流计成连续失败并最终暂停——这正是 v1 设计里"配额耗尽被误判成故障"的同类错误，只是换了条路径。

**`unknown` 分支保留诊断摘要**（不保留原文，避免意外带出 Key 或长文本）：

```js
const digest = JSON.stringify(body || {}).slice(0, 200).replace(/[A-Za-z0-9_-]{20,}/g, '<redacted>')
// 落 last_error_message，日志记 rawDigest，便于复现时定位
```

| 等级 | 触发条件 | 计入连续失败 | 重试策略 |
|---|---|---|---|
| **A 正常节流** | `quotaExceeded` / `dailyLimitExceeded` / `rateLimitExceeded`（**HTTP 403**） | ❌ **不计入** | 本轮直接跳过，等下个周期 |
| **A 瞬时波动** | 网络超时 / `ECONNRESET` / 5xx / `backendError` | ❌ **不计入** | 指数退避（1min→4min→16min），最多 3 次 |
| **B 真故障** | `channelNotFound` / `playlistNotFound` / 兜底 4xx | ✅ 计入 | 连续 **3 次** → `auto_paused` |
| **C 不可自愈** | `keyInvalid` / `accessNotConfigured` / `forbidden` | ✅ 计入 | **立即** `auto_paused` |

**为什么把 5xx / 网络抖动移出「计入连续失败」**：默认 1 小时检查一次，连续 3 次瞬时 5xx 需要跨越 3 小时才触发暂停，期间用户白白损失监控；而这类故障几乎都在下一周期自愈。原先的 3 次阈值对瞬时故障**过敏**（CCG 评审 i7）。

**Tier A/B/C 的 UI 表达差异**：

| 等级 | UI 表现 |
|---|---|
| A 节流 | 无警告，仅配额水位条变化（这是正常状态，不是故障） |
| A 瞬时 | 静默重试；连续 3 次仍失败才在列表显示「最近检查不稳定」 |
| B 真故障 | `creatorAutoPaused`：连续失败 {times} 次，已自动暂停。{reason} + 「立即重试」 |
| C 不可自愈 | `creatorFatalPaused`：无法检查新作品：{reason}。请在设置中检查 API Key。+ 直达设置页按钮 |

---

## 9. 交互逻辑与显示项

### 9.1 入口

`Collection.vue` 新增第三个 tab，接入成本：**改 `TAB_KEYS`（`:2283`）一行 + 一个 `v-else-if` 区块**，**不动路由**（新 tab 属采集页子视图，非一级菜单）。

### 9.2 博主列表显示项

| 列 | 内容 | 空值显示 |
|---|---|---|
| 头像 | `avatar_url` | 首字母占位块 |
| 名称 | `display_name` | `external_id` |
| Handle | `@handle` | 隐藏该行 |
| 平台徽章 | 「YouTube」+ 能力徽章（见 §9.4） | — |
| 新作品数 | `pending` 计数 | 不显示该列 |
| 监控状态 | 正常 / 已暂停 / **连续失败 N 次** / 凭证缺失 | — |
| 最近检查 | `last_success_at` 相对时间 | 从未成功 → 「尚未检查」 |
| 操作 | 立即检查 / 暂停·恢复 / 取消关注 / 设置 | — |

### 9.3 发现列表显示项

| 列 | 内容 | 说明 |
|---|---|---|
| 封面 | `thumbnail_url` | 16:9，`thumbnails` 取 medium/hq |
| 标题 | `title` | 单行省略 |
| 发布时间 | `published_at` 相对时间 | — |
| 发现时间 | `discovered_at` | — |
| 内容质量 | `full` 有字幕（绿）/ `partial` 描述可用（蓝）/ `stub` 仅标题简介（琥珀） | 三级，见 §7.6；`stub` 时「送入 AI 写作」降级为次要样式并二次确认 |
| 状态 | 未采集 / 已采集·{time} | 持久态，刷新不丢 |
| 操作 | **采集** / **送入 AI 写作** / 忽略 | 已采集时置灰 |

排序：默认 `published_at DESC`。

**配额水位条**（博主列表顶部常驻）：

| 水位 | 展示 |
|---|---|
| < 60% 探测池 | 细进度条，默认收起 |
| 60% ~ 80% | 展开显示「今日探测配额已用 {used}/{limit} units」 |
| ≥ 80% | 变琥珀色 + `creatorQuotaHigh`：今日 YouTube 配额已用 {percent}%。新作品发现可能延迟。 |
| 物理池 ≥ 80%（8,000 units） | 红色 + `creatorPhysicalQuotaHigh`：接近 YouTube 每日配额上限（10,000 units），部分功能将受限。 |

### 9.4 能力徽章

| 等级 | 文案 | 视觉 |
|---|---|---|
| `official` | 官方接口 | 绿色徽章 |
| `best_effort` | 尽力而为（可能不稳定） | 琥珀色徽章 |
| `unsupported` | 暂不支持 | 灰色徽章 + 禁用添加 |

### 9.5 空态与首次体验

- 未添加任何博主：`creatorEmptyTitle` / `creatorEmptyDesc`，附一行输入框直接引导
- 已添加但无新作品：`creatorNoNewWorks`：暂无新作品。系统会每 {interval} 自动检查一次。
- 探测定时器未运行（如应用刚启动未到周期）：`creatorNextCheck`：下次自动检查：{time}

---

## 10. 提示文字（中英对照）

新增 locale key 统一 `creator*` 前缀，挂 `collection` 命名空间（`zh.js:2614-2871`），**en.js 必须成对提交**（CI Gate 7 `check-locale-sync.js` 拦截）。

| key | zh.js | en.js |
|---|---|---|
| `creatorTab` | 博主监控 | Creator Monitor |
| `creatorAddPlaceholder` | 粘贴 YouTube 频道链接、@handle 或频道 ID | Paste a YouTube channel URL, @handle, or channel ID |
| `creatorAddSubmit` | 关注 | Follow |
| `creatorCapOfficial` | 官方接口 | Official API |
| `creatorCapBestEffort` | 尽力而为（可能不稳定） | Best effort (may be unstable) |
| `creatorCapUnsupported` | 暂不支持 | Not supported |
| `creatorPendingBadge` | {count} 条新作品 | {count} new |
| `creatorCollectNew` | 一键采集新作品 | Collect new posts |
| `creatorCollectOne` | 采集 | Collect |
| `creatorCollectedAt` | 已采集 · {time} | Collected · {time} |
| `creatorSendToWriter` | 送入 AI 写作 | Send to AI Writer |
| `creatorTranscriptSubtitle` | 有字幕 | Transcript |
| `creatorTranscriptDescription` | 仅描述 | Description only |
| `creatorQualityFull` | 字幕正文，质量高 | Transcript (high quality) |
| `creatorQualityPartial` | 描述正文，质量有限 | Description (limited) |
| `creatorQualityStub` | 仅标题+简介 | Title only |
| `creatorQuotaHigh` | 今日 YouTube 配额已用 {percent}%。新作品发现可能延迟。 | {percent}% of today's YouTube quota used. New posts may be detected late. |
| `creatorPhysicalQuotaHigh` | 接近 YouTube 每日配额上限（10,000 units），部分功能将受限。 | Approaching YouTube's daily quota (10,000 units). Some features will be limited. |
| `creatorProbeSkipped` | 因配额限制，{count} 个博主本轮未检查 | {count} creators skipped this round due to quota |
| `creatorMaxFollowing` | 最多关注 {max} 个博主。如需增加，请调大检查频率或移除部分博主。 | You can follow up to {max} creators. Increase the check interval or remove some to add more. |
| `creatorFatalPaused` | 无法检查新作品：{reason}。请在设置中检查 API Key。 | Cannot check for new posts: {reason}. Check your API Key in Settings. |
| `creatorPause` | 暂停监控 | Pause |
| `creatorResume` | 恢复监控 | Resume |
| `creatorRetryNow` | 立即重试 | Retry now |
| `creatorEmptyTitle` | 还没有关注的博主 | No creators followed yet |
| `creatorEmptyDesc` | 添加 YouTube 博主后，系统会定期检查新作品并在这里提示。 | Follow a YouTube creator and new posts will appear here. |
| `creatorNoNewWorks` | 暂无新作品。系统会每 {interval} 自动检查一次。 | No new posts. Checking every {interval}. |
| `creatorNextCheck` | 下次自动检查：{time} | Next automatic check: {time} |
| `creatorBatchSuccess` | 已采集 {collected} 条内容 | Collected {collected} posts |
| `creatorBatchPartial` | 成功 {collected} 条，失败 {failed} 条 | {collected} succeeded, {failed} failed |
| `creatorTruncated` | 共发现 {found} 条，已采集最新 {collected} 条，剩余 {remain} 条留待下次 | Found {found}; collected the latest {collected}, {remain} left for next time |
| `creatorDiscoverShortfall` | 该博主仅发现 {found} 条待采集作品，将全部采集 | Only {found} posts available for this creator; all will be collected |
| `creatorAutoPaused` | 连续失败 {times} 次，已自动暂停。{reason} | Paused after {times} consecutive failures. {reason} |
| `creatorErrInvalidInput` | 无法识别该频道。请粘贴 YouTube 频道链接、@handle 或以 UC 开头的频道 ID。 | Cannot identify this channel. Paste a channel URL, @handle, or a UC-prefixed channel ID. |
| `creatorErrChannelNotFound` | 找不到该频道，可能已注销或链接有误。 | Channel not found. It may be deactivated or the link is incorrect. |
| `creatorErrCredentialMissing` | 未配置 YouTube API Key，无法检查新作品。请在设置中填写。 | YouTube API Key is not configured. Add it in Settings to check for new posts. |
| `creatorErrQuotaExhausted` | YouTube 今日探测额度已用完（{used}/{limit}）。将在额度重置后继续。 | Today's YouTube probe quota is exhausted ({used}/{limit}). Monitoring resumes after reset. |
| `creatorErrCountExceedsLimit` | 本次最多采集 {max} 条，请调整数量。 | You can collect at most {max} posts per run. |
| `creatorErrAlreadyCollected` | 该作品已于 {time} 采集。 | Already collected on {time}. |
| `creatorErrCollectFailed` | 采集失败：{message} | Collection failed: {message} |
| `creatorErrAppClosedNotice` | 博主监控需要应用保持运行。关闭应用期间不会检查新作品，重新打开后仅检查增量。 | Creator monitoring requires the app to stay running. New posts are not checked while closed. |

占位符风格沿用既有约定（`{count}` / `{message}`，参见 `zh.js:2784`）。

---

## 11. IPC 通道契约

| 通道 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `creator:list` | — | `{ creators[], totalPending }` | 博主列表 + 总角标数 |
| `creator:follow` | `{ input, checkIntervalMin?, perCreatorLimit? }` | `{ creator }` | 添加/复用关注 |
| `creator:unfollow` | `{ followId }` | `{ ok }` | 取消关注（二次确认） |
| `creator:toggle` | `{ followId, enabled }` | `{ follow }` | 暂停/恢复 |
| `creator:checkNow` | `{ followId }` | `{ found, created }` | 立即探测 |
| `creator:discoveries` | `{ creatorId?, state?, limit?, offset? }` | `{ items[], total }` | 发现列表，分页 |
| `creator:collect` | `{ creatorId, count }` | `{ collected, failed, remain }` | 批量采集 |
| `creator:collectOne` | `{ discoveryId }` | `{ item }` | 单条采集 |
| `creator:skipOne` | `{ discoveryId }` | `{ ok }` | 忽略 |
| `creator:sendToWriter` | `{ discoveryId }` | `{ runId }` | 送入 AI 写作 |

所有通道在 `ipc-handlers/license-access-control.js` 登记为 **public**（与既有采集通道一致，未登录可用）。

---

## 12. 日志字段

统一 `logger` 前缀 `[CreatorMonitor]`，**禁止**打印 API Key、字幕全文、凭证密文。

| 字段 | 说明 |
|---|---|
| `platform` / `external_id` | 博主标识 |
| `checkIntervalMin` | 本次间隔 |
| `probeQuotaUsed` / `probeQuotaLimit` | 配额水位 |
| `found` / `inserted` / `duplicate` | 探测结果三元组 |
| `collectRequested` / `collectApplied` | 请求数量 vs 实际执行（暴露截断） |
| `consecutiveFailures` / `status` | 降级状态 |
| `apiKeyPresent` | 仅布尔，**不打印值** |

---

## 13. 验收标准

| 编号 | 验收项 |
|---|---|
| A1 | 可添加 YouTube 博主，4 种输入形式（频道 URL / @handle / `/c/name` / `/user/name` / `UC...`）均正确解析 |
| A2 | 同一 `(platform, external_id)` 重复添加时复用既有记录，不产生重复行 |
| A3 | 探测幂等：同一 video 连续探测 N 次，`creator_discoveries` 行数不变 |
| A4 | 一键采集默认数量为 5；手动批量默认 50；两者上限均为 100 |
| A5 | `count > 生效上限` 被拒绝并提示，**不发生任何采集副作用** |
| A6 | 发现数 > count 时提示剩余条数，剩余项保持 `pending` |
| A7 | 单条采集零填参成功；重复点击返回 `creatorErrAlreadyCollected` 且**按钮状态持久**（刷新页面后仍显示「已采集 · 时间」） |
| A8 | 单条采集不受数量上限约束 |
| A9 | 探测与采集配额独立：探测耗尽不影响采集额度，反之亦然 |
| A10 | 连续失败 3 次 → `status='auto_paused'` + UI 明确原因 + 「立即重试」可用 |
| A11 | `CREATOR_RATE_LIMITED` **不**累计连续失败计数 |
| A12 | 能力徽章正确显示 `official`；平台选择器中 `best_effort` / `unsupported` 正确置灰 |
| A13 | 「送入 AI 写作」进入 `collect→rewrite→create` 三段且**不触发 publish** |
| A14 | 应用完全退出后重启，仅检查增量，**不补跑**关闭期间内容；UI 有 `creatorErrAppClosedNotice` 说明 |

**CCG 评审修订项对应的验收（新增，缺一不可）**：

| 编号 | 验收项 | 对应评审 |
|---|---|---|
| A15 | `migrateCreatorLinkageSchema` 在**已有存量数据**的库上执行成功：`viral_library` 存量行 `external_id=''` 不触发唯一索引冲突，应用可正常启动 | i1 / v2-i2 |
| A16 | 采集后可由 `viral_library.(platform, external_id)` 反查到 `creator_discoveries` 与博主；重采集走 `INSERT OR REPLACE` 且保留原 `created_at` | i1 |
| A17 | 50 博主 @ 1 小时间隔时，日探测消耗 ≤ 1,500 units；第 63 个博主被拒绝并提示 `creatorMaxFollowing` | i2 / v2-i1 |
| A18 | 配额不足以覆盖全部博主时，按 `check_interval_min` 升序保底、其余跳过，并在 UI 显示 `creatorProbeSkipped`，**不产生失败状态** | v2-i1 |
| A19 | API 返回 `quotaExceeded`（HTTP 403）时，`consecutive_failures` **不增加**，状态保持 `active` | v2-i3 |
| A20 | API 返回 `keyInvalid` 时**首次即**进入 `fatal_paused`（不等 3 次），UI 显示 `creatorFatalPaused` 并提供直达设置页入口 | v2-i3 |
| A21 | 5xx / 网络超时连续 3 次**不**触发暂停；Tier B 连续 3 次才 `auto_paused` | i7 |
| A22 | 未知 `action.type` 抛错且**不执行** pipeline；既有 4 类自动化任务回归测试全绿（R1~R5） | i3 |
| A23 | API Key 不出现在 settings 明文、任一日志文件、崩溃报告中；grep 验证 `api_key_present` 为唯一落盘形态 | i5 |
| A24 | `stub` 质量等级的作品，「送入 AI 写作」为次要样式且带二次确认；`full` 等级为推荐样式 | i6 |
| A25 | 单条采集在采集池耗尽时被拒绝并提示，**不豁免配额**（仅豁免数量上限） | i8 |

---

## 14. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| **抖音/小红书/视频号反爬** | 长期不可用 | 本期不实现；架构留 `capability_tier`；接入时熔断 + 自动暂停 + UI 标注「尽力而为」 |
| YouTube API 配额耗尽 | 监控中断 | 双轨配额（探测 200 / 采集 100）；`CREATOR_RATE_LIMITED` 不惩罚连续失败；UI 显示配额水位 |
| API Key 缺失/失效 | 全盘不可用 | 立即 `auto_paused` + 明确指向设置页 |
| `automation-scheduler` 改造引入回归 | 影响既有 4 类自动化任务 | 改动限定在 3 处 + switch 分发；`creatorMonitor` 与 `fullAutoPipeline` 分支互不干扰；补单测 |
| 发现表无限增长 | 存储膨胀 | MVP 不自动清理，但 `collect_state='collected'` 可按 `collected_at` 归档；后续版本加保留策略 |
| 字幕拉取慢导致超时 | 批量采集卡住 | `BatchRateController` 已有退避 ×2、最多 3 次后熔断 |
| 并发采集同一博主 | 重复写入 | 唯一约束 + 单条状态机；批量入口对同一 follow 加互斥锁 |

---

## 15. 预计规模与待改文件清单（CCG 决策层门禁输入）

**预计新增 4,530 行 / 改动 9 个文件 / 本次共涉及 19 个文件。**

### 15.1 新增文件（8 个，约 3,180 行）

| 路径 | 预计行数 | 职责 |
|---|---|---|
| `apps/desktop/electron/services/creator-store.js` | 420 | 3 张表 CRUD、归一化 fail-closed |
| `apps/desktop/electron/services/creator-monitor.js` | 350 | 探测调度、增量对比、失败降级状态机 |
| `apps/desktop/electron/services/creator-collector.js` | 260 | YouTube adapter 包装、双轨配额、数量上限执行 |
| `apps/desktop/electron/ipc-handlers/creator.js` | 180 | IPC 通道与入参校验 |
| `apps/desktop/src/features/collection/CreatorMonitor.vue` | 460 | 新 tab 渲染层 |
| `apps/desktop/electron/tests/creator-store.test.js` | 380 | store 单测 |
| `apps/desktop/electron/tests/creator-monitor.test.js` | 420 | 探测/降级单测 |
| `apps/desktop/electron/tests/creator-collector.test.js` | 350 | 数量上限/配额单测 |

### 15.2 改动文件（11 个，约 1,350 行）

| 路径 | 预计改动 | 内容 |
|---|---|---|
| `apps/desktop/electron/services/store-schema.js` | +75 | 追加 3 表 + 5 索引 |
| `apps/desktop/electron/preload/publish.js` | +25 | 暴露 creator IPC |
| `apps/desktop/electron/services/automation-task.js` | +20 | 允许 `creatorMonitor` |
| `apps/desktop/electron/services/automation-scheduler.js` | +40 | `switch(task.action.type)` 分发 |
| `apps/desktop/electron/core/container.setup.js` | +15 | 注册探测执行器 |
| `apps/desktop/electron/services/url-collector.js` | +3 | `_platformFromHostname` 加 youtube |
| `packages/collection-engine/src/default-strategies.json` | +12 | YouTube 采集策略与配额 |
| `apps/desktop/src/views/Collection.vue` | +40 | `TAB_KEYS` + `v-else-if` |
| `apps/desktop/src/locales/zh.js` | +34 | `creator*` 中文文案 |
| `apps/desktop/src/locales/en.js` | +34 | `creator*` 英文文案（成对） |
| `openspec/specs/creator-monitor/spec.md` | +650 | 能力契约 Requirement/Scenario |

### 15.3 文档文件

| 路径 | 内容 |
|---|---|
| `01-docs/PRD-CREATOR-MONITOR-COLLECT-2026-10-07.md` | 本文档 |
| `01-docs/PRD.md` | §8 新增 8.5 小节 + 头部「功能文档」索引登记 |
| `openspec/records/blogger-collection.md` | 执行记录（门禁证据） |
| `.quality-gates.md` | 质量节拍记录 |

---

## 16. 可行性实测结果（2026-10-07，非推断）

方案早期版本把「YouTube 是否真能跑通」列为待核实项。**已实测**，结论如下：

| 探测项 | 结果 |
|---|---|
| `content_aggregator_shared...YouTubeCollector` 导入 | ✅ 成功（类可正常实例化，无 key 也不抛错） |
| `collect()` 签名 | ✅ 返回 `SourceResult` |
| 字幕依赖 `youtube_transcript_api` | ✅ **已安装** → 正文质量可达 `full` |
| 采集端点 | ✅ **仅官方 Data API**（`channels` / `search` / `playlistItems`），确认**非反爬路径** |
| `yt-dlp`（媒体下载，本方案不依赖） | ✅ 可用 2026.08.19 |

**结论：方案地基假设成立。**「YouTube 非 greenfield」不再只是读代码得出的推断，而是**已执行验证**的事实。

**测试中发现一项此前未知的能力**：`YouTubeCollector.__init__` 带 `llm_config` 参数，源码注释为「LLM 配置（用于**无字幕时 AI 识别**）」。这比 §7.6 原设计的「无字幕 → 质量降级为 `stub`」更优——无字幕视频可通过 ASR/LLM 补正文。

| 情形 | 原设计 | 修正后 |
|---|---|---|
| 有字幕 | `full` | `full`（不变） |
| 无字幕但配了 `llm_config` | `stub`，提示 AI 写作质量有限 | 走 LLM 识别后可得正文，标 `derived`（**与 `full` 区分**，因为它是二手生成内容） |
| 无字幕且未配 `llm_config` | `stub` | `stub`（不变） |

**仍未核实**（须在实现阶段验证）：

| 项 | 需怎么验 |
|---|---|
| 打包产物中能否 `import content_aggregator` | QM-1 打包门禁：`electron-builder --win --dir` 后验证 asar 内 require 链 |
| `default-strategies.json` 中 YouTube 策略键的字段结构 | 实现时读取确认 |
| 真实 API Key 下的端到端一次采集 | 需用户配置 Key 后跑一次 P0 冒烟 |

### 16.1 分发形态实测：Python 依赖**不进打包产物**（2026-10-07）

**这是本特性最大的落地风险，且不是理论风险——是本仓既有的架构事实。**

| 事实 | 证据 |
|---|---|
| 打包后的应用 spawn **系统 `python`**（PATH 上的那个），不是内置解释器 | `python-bridge.js:104`：`process.env.MP_PYTHON \|\| (win32 ? 'python' : 'python3')` |
| Python 依赖靠 **pip 装进全局 site-packages**，不由应用分发 | `splitter-bridge.js:20` 注释明写「该模块本身经 pip 安装（全局 site-packages）」；`build.extraResources` 无 Python 环境条目 |
| `content_aggregator` 是**可选依赖** | `pyproject.toml:20-23` 的 `optional` 分组 `aggregation` |

**推论**：**打完包的机器若没手动 `pip install content-aggregator`，YouTube 采集功能不可用。**

**缓解影响面（已实测）**：`service.py:19-26` 的 `_lazy_import()` 对可选依赖做优雅降级（捕获 `ImportError`），因此**缺包不会导致整个 Python 后端启动失败**，只是聚合能力降级。这是好消息——不会把用户的整个应用搞挂。

**但仍必须补上显式检查**，否则用户会遇到"功能莫名其妙不工作"：

| 要求 | 定义 |
|---|---|
| **复用既有模式（不是新造）** | ⚠ 本仓**已经为 `faster-whisper` 完整解决了同类问题**，博主监控 MUST 复用该模式而非另造轮子：`electron/services/asr-installer.js`（带进度上报 + **pip 国内镜像源 fallback**）→ `aggregation.js:53` 错误码 `-6` 内嵌确切命令 → `src/utils/collect-error.js:74` 前端分类 `retryable:false` → `zh.js:2648`/`en.js:2642` 中英文案 → `Collection.vue:629-633` 的 `<code>` 块 + `data-testid` → `Collection.test.js:848` 回归锁 |
| 启动即探测 | 后端健康检查阶段探测 `content_aggregator` 是否可导入，结果纳入既有 `/health` 响应 |
| 状态透出 UI | `creator:list` 返回 `platformAvailability: { youtube: 'ready' \| 'missing_dependency' }` |
| **明确文案 + 修复指引** | 文案 MUST 含确切命令，并**给出国内镜像写法**（沿用 asr 的 `pip install <pkg> -i https://pypi.tuna.tsinghua.edu.cn/simple`），否则国内用户按默认源装不上，等于没提示 |
| 安装引导 | 复用/扩展 `asr-installer` 的进度 UI 形态，别另做一套 |
| 禁止静默降级 | MUST NOT 在缺依赖时把「博主监控」tab 显示为正常可用；该 tab 应置灰并说明原因 |
| 设置页可见 | 依赖状态在设置 → 服务状态面板中常驻可见（复用既有 `PRD-SERVICE-STATUS-PANEL` 的展示位） |

**为什么这一条比我原本设计的更重要**：我在 §16.1 初稿里只写了"给出确切 pip 命令"，**漏掉了国内镜像源**。而 `asr-installer.js` 已经踩过并解决了这个问题——国内用户用默认 PyPI 源装大包经常超时失败。既有实现里有 `pip install faster-whisper -i https://pypi.tuna.tsinghua.edu.cn/simple` 这类写法，说明这不是理论顾虑而是已发生的事实。复用它的收益不只是省代码，更是**继承已验证的踩坑经验**。

**回退方案**：若判定该依赖的分发不可接受（安装门槛过高），则改为**本仓内自实现 YouTube 采集**——官方 Data API 本身不复杂（`channels` + `playlistItems` + 字幕拉取，约 200 行），且能随应用分发。代价是要自己维护字幕获取（`youtube-transcript-api` 仍需 pip）。**此决策需在 P0 冒烟后按实际安装体验定。**

***

# 17. 面板接线与「添加博主 / 凭证」可用性修复（2026-10-12，creator-monitor-depfix）

> 本章是**实现期事故**的完整记录与规格回写，不是规划。它把「博主监控页整页不可用」的
> 三个独立成因、修复设计、数据校验、流程、交互、显示项、提示文字、回归锁逐条写清，
> 并对本章之前各节的规格做了**两处修正**（§8.1 添加入口、§7.4 凭证入口）。

## 17.1 用户可见现象

采集页 →「博主监控」页签打开后：

1. 页面顶部只有一行警告：**「缺少采集依赖。请执行：」**（冒号后为空，没有任何命令）；
2. 博主列表恒为空，发现列表恒为空；
3. 点右上角「关注」**没有任何反应**（无弹窗、无报错、无 toast）；
4. 页面上**没有任何地方**可以填写 YouTube API Key。

四条现象中，1 与 3 是**两个互不相关的缺陷**，只是恰好同时出现，容易让人误当成一个问题。

## 17.2 根因（三个独立成因 + 一个文案成因）

| # | 成因 | 位置 | 后果 |
|---|---|---|---|
| **C1** | 依赖取值路径写错：`const get = (n) => (context && typeof context.get === 'function' ? context.get(n) : undefined)`。`context` 是 `bootstrap/phase1-context.js` 的分组 Proxy（`{infra,services,windows,pipelines}`），**自身没有 `get`**，只有 `context.container` | `apps/desktop/electron/bootstrap/phase5-ipc.js` | 三元恒为 false ⇒ 三个 creator 服务全为 `undefined` ⇒ `ipc-handlers/creator.js` 判定依赖缺失 ⇒ **11 个通道全部注册为降级** |
| **C2** | `creatorCollector` 的工厂里写 `credentialProvider: c.get('creatorCredentialProvider') \|\| (() => null)`，而 `creatorCredentialProvider` **从未注册**。容器 `get` 对未注册名**抛错**（`core/container.js:78`），不是返回 `undefined` | `apps/desktop/electron/core/container.setup.creator.js` | 只要解析 `creatorCollector` 就抛 ⇒ `creatorRuntime` 一并失败 ⇒ 成为**与 C1 并列的第二个降级成因**（C1 修好也仍然降级） |
| **C3** | `creator:follow` 调 `creatorCollector.resolveChannelId(input)`，而 `createCreatorCollector` 返回的对象**只有 `listPosts` / `collectBody`** | `apps/desktop/electron/services/creator-collector-runtime.js` | 「添加博主」必抛 `undefined is not a function`（走 `toIpcError` 变成 `code:-1, reason:'creator:failed'`） |
| **C4** | 渲染层把 `reason:'service-unavailable'` 渲染成「缺少采集依赖。请执行：」并传 `command: ''` | `apps/desktop/src/features/collection/CreatorMonitor.vue:41,59` | 文案把用户引向「装 Python 包」，而真因是「主进程没接线 ⇒ 重启应用」。两种处置完全不同，且命令位恒空 |

**为什么 C3 逃过了端到端测试**：`creator-wiring.e2e.test.js` 的 `stubCollector()` 手搓了一个 `resolveChannelId`
——**夹具按调用方想象的形状收参数**（本仓 `learnings.md` 已登记的同型教训的第四种落点：
不是「替对方剥壳」也不是「替对方改签名」，而是**替对方造方法**）。真实装配里没有这个方法，
于是「添加博主」在 e2e 全绿的同时在生产必崩。

**为什么 C1/C2 逃过了单元测试**：`phase5-ipc.test.js` 的每个用例都传 `context = {}`，
并且**只**断言 `usageTracker` / `assetGenerator` / `serviceBus` 等既有字段，
没有任何用例断言 `creatorStore` / `creatorMonitor` 这类「经容器解析的字段」。
`creatorCredentialProvider` 更是**没有任何测试引用**（连名字都没出现过）。

**为什么 C4 逃过了文案审查**：`{command}` 的取值来源（`probeDependency().installHint`）
是**恒不可用**的死代码（见 17.3.4），因此「该命令从哪来」这个问题在实现期没有答案，
传 `''` 就成了唯一能让 ESLint 与测试都通过的写法。

## 17.3 修复设计

### 17.3.1 依赖取值：只走容器（C1）

`phase5-ipc.js` 新增 `resolveContextDep(name)`：先取顶层 `context[name]`（测试/显式注入路径），
再取 `context.container.get(name)`（生产路径），容器未注册名**catch 后按缺失处理** ——
缺失只降级 creator 通道，MUST NOT 让整个 IPC 注册失败。

新增回归锁两条：① 断言 `context = { container: { get } }` 时 `creatorStore/creatorCollector/
creatorMonitor/creatorQuota/creatorCredential` 全部到位（C1 的**行为锁**）；
② 源码不得再出现那段不存在的取值写法（C1 的**结构锁**，且带反向断言防止「删掉功能」变绿）。

### 17.3.2 凭证提供者：注册 + 形状适配（C2）

`container.setup.creator.js` 新增 `creatorCredentialProvider` 注册（**在 `creatorCollector` 之前**，
容器按注册顺序惰性求值），并把采集器的 `credentialProvider` 从「直接塞 provider 对象」改为
**形状适配函数**：`() => provider.getApiKey() ? { apiKey, pythonBridge } : null`。

原注释写的是「可选注册项：未接入时回落空实现而不是让 get 抛」，但代码里**没有兜底**。
本次两条都补：注册让它真的可用；`try/catch` 兜底让「将来又被删掉」退化成
「没配 Key（可配置状态）」而不是「整页不可用（接线故障）」。

### 17.3.3 采集器补齐 `resolveChannelId`（C3）

`creator-collector-runtime.js` 增加 `resolveChannelId(raw)`：从注入的 `credentialProvider` 取
`apiKey`，用注入的 `httpGet` 调 `channels.list`（`forHandle` / `forUsername`），
复用 `creator-collector.js` 的**单一实现** `parseChannelInput` + `resolveChannelIdImpl`，
MUST NOT 在渲染层或第二处重新实现形态解析。

同时在 e2e 文件里加**形状对账锁**：替身的方法集 MUST 是真实采集器返回对象的子集。

### 17.3.4 依赖状态分腿 + 文案分因（C4）

新增只读通道 `creator:dependency-status`：

```jsonc
{
  "code": 0,
  "discovery":  { "ready": true, "reason": "" },                      // Node 内置 https + Data API，无第三方包
  "transcript": { "ready": false, "optional": true,                    // Python content-aggregator（字幕）
                  "reason": "python-backend-not-running",
                  "installHint": "pip install content-aggregator -i https://pypi.tuna.tsinghua.edu.cn/simple" }
}
```

**同时修掉一个「假探测」**：旧 `probeDependency()` 用
`require('content_aggregator.sources.collectors.youtube_collector')` 探测依赖 ——
`content_aggregator` 是 **Python** 包，Node 的 `require` 永远解析不到，该函数**恒返回 `ready:false`**。
它当时没有生产调用点（只有测试），一旦接上就会变成「依赖永远缺失」的假告警，比不报更坏。
现改为 `probeTranscriptDependency({ pythonBridge })`，只回答 Node 侧真能回答的事
（桥在不在跑），且如实声明「桥不在跑」与「没装包」在 Node 侧**不可区分**，不假装已确诊。

`creator:credential-status` / `creator:dependency-status` 两个只读通道**不参与降级**：
服务没起来时它们恰恰是用户最需要的排查入口。

### 17.3.5 添加博主：应用内弹窗（替代 `window.prompt`）

**Electron 渲染进程不支持 `window.prompt`**（调用即抛 `prompt() is and will not be supported`），
旧实现 `const input = window.prompt(...)` 使该入口**整条不存在**。现改为
`CreatorAddDialog.vue`（与同页 `QuickCollectCommandDialog.vue` 同构：手写 mask + `role="dialog"`）。

关注成功后 MUST **立即执行首次探测**（`creator:check-now`，主进程侧 `fetch_transcript=False`），
否则用户要等到下一个巡检周期才看到新作品，会得出「加了没用」的结论。

### 17.3.6 凭证配置弹窗

新增 `CreatorCredentialDialog.vue` + 三个通道（`creator:credential-status/-set/-clear`）。
规格见 §7.4（本次实现即该节），补充三条本次明确的判据：

- **形态提示非阻塞**：值不匹配 `^AIza[0-9A-Za-z_-]{35}$` 时 SHOULD 提示核对，
  MUST NOT 据此拒绝保存（Google 若改前缀，硬拒会把可用密钥挡在门外）；
- **无命令可给时不渲染占位符**：`creatorErrDependencyMissing` 保留给真正的
  `creator:dependency_missing` 错误；可选依赖走不含空占位符的
  `creatorDependencyOptionalHint`；
- **状态五分**（QM-6 后端评审 W1 处置，spec 的「凭证安全」Requirement 已同步）：
  `ok` / `not_configured` / `unavailable`（safeStorage 或 store 不可用）/
  `decrypt_failed`（重填有效）/ **`read_failed`（settings 读取失败，重填无效 ⇒
  引导重启或检查磁盘）**。读失败 MUST NOT 并入 decrypt_failed——
  那会让用户对着不可操作的提示反复重填；三类「坏态 + 未配置」在测试里断言互不相等。

## 17.4 数据校验（三层，各自单一来源）

| 层 | 判据 | 实现位置 | 违反后果 |
|---|---|---|---|
| 渲染层（添加博主） | 非空；`trim()` 后长度 ≤ **512** | `CreatorAddDialog.vue` 的 `MAX_INPUT_LENGTH` | 内联报错 + **不发请求**；MUST NOT 用 `maxlength` 截断（静默改内容） |
| 渲染层（凭证） | 非空即可提交；格式由主进程判 | `CreatorCredentialDialog.vue` | 按钮禁用仅针对空输入 |
| 主进程（凭证） | 20–200 字符；可打印 ASCII、无空白；`trim()` 后判定 | `creator-credential.js` `validateApiKey` | 返回 `creator:credential_invalid`（`detail` 为机器可读子类） |
| 主进程（频道输入） | 长度 ≤ 512；站内 JSON 形态判定：`UC…` / `@handle` / `/c/`·`/user/` / 频道 URL；作品与播放列表链接**明确拒绝** | `creator-collector.js` `parseChannelInput`（**唯一实现**） | `creator:invalid_input` / `creator:not_a_channel` / `creator:channel_not_found` |

**SSRF/协议面**：`resolveChannelId` 只对 `youtube.com` 等白名单主机发请求（`YOUTUBE_HOSTS`），
非白名单主机在**零请求**下被判 `invalid_input`。

## 17.5 流程：添加一个博主（端到端）

```
用户点「关注」
  └─ CreatorAddDialog 打开（清空输入与上次错误）
       │ 输入 @handle / 频道 URL / UC… ID（Enter 或点「关注」）
       ├─ 空 → 按钮禁用，不发请求
       ├─ >512 → 内联报错（creatorErrInputTooLong），不发请求
       └─ 提交 → IPC creator:follow({ input })
            ├─ 主进程 requireString(input, max 512) → creator:invalid_input
            ├─ creatorQuota.probePool 预检 assertQuotaFits（超限拒且零副作用）
            ├─ collector.resolveChannelId(input)
            │    ├─ 无 apiKey → creator:credential_missing  → 渲染层**直接打开凭证弹窗**
            │    ├─ 形态不可识别 → creator:invalid_input / creator:not_a_channel
            │    ├─ channels.list 无结果 → creator:channel_not_found
            │    └─ 命中 → 返回 canonical UC…
            ├─ creatorStore.upsertCreator(...) + upsertFollow(...)
            └─ 回包 { code:0, creator, follow }
  └─ 渲染层：toast「已关注 {name}，正在检查新作品…」→ 立即 creator:check-now({ followId })
       └─ 主进程 probeCreator（fetch_transcript=False）→ 写入 discoveries → 角标 +N
  └─ 渲染层：loadCreators() + loadDiscoveries()（列表与待采集角标刷新）
```

## 17.6 显示项与提示文字（zh / en 成对，键名即网关）

| 键 | zh | en | 出现位置 |
|---|---|---|---|
| `creatorErrServiceUnavailable` | 博主监控服务未就绪（主进程 creator 服务未装配）。请重启应用后重试；若仍失败，请查看日志中的「[IPC] 博主监控」警告。 | The creator monitor service is not ready (main-process creator services were not wired). Restart the app and try again; if it still fails, look for the "[IPC] creator" warning in the logs. | 顶部阻塞横幅 |
| `creatorRetry` | 重试 | Retry | 阻塞横幅按钮 |
| `creatorAddTitle` / `creatorAddDialogIntro` / `creatorAddLabel` / `creatorAddHint` / `creatorAddPlaceholder` / `creatorAddCancel` / `creatorAddSubmitting` / `creatorAddSuccess` | 见 locales | 见 locales | 添加弹窗 |
| `creatorErrInputTooLong` | 输入过长，请只粘贴一条频道链接或频道 ID。 | Input is too long. Paste a single channel URL or ID. | 添加弹窗内联错误 |
| `creatorCredentialOpen` / `creatorCredentialTitle` / `creatorCredentialIntro` / `creatorCredentialLabel` / `creatorCredentialPlaceholder` / `creatorCredentialHint` / `creatorCredentialSave` / `creatorCredentialSaving` / `creatorCredentialSaved` / `creatorCredentialWarnShape` / `creatorCredentialClear` / `creatorCredentialCleared` / `creatorCredentialClose` | 见 locales | 见 locales | 凭证弹窗 |
| `creatorCredentialInvalid` / `creatorCredentialUnavailable` / `creatorCredentialPersistFailed` | 输入非法 / 密钥库不可用 / 持久化失败 | 同义 | 凭证弹窗内联错误（**三类分因**） |
| `creatorCredentialStatusUnknown` / `...Ok` / `...NotConfigured` / `...Unavailable` / `...DecryptFailed` | 正在读取 / 已配置（末四位 {fingerprint}）/ 未配置 / 密钥库不可用 / 无法解密 | 同义 | 凭证弹窗状态行 + 页面横幅 |
| `creatorDependencyOptionalHint` | 字幕增强依赖未就绪：新作品仍可正常发现与采集，但正文只能取描述、内容质量会降级。若确认缺少该包，可在终端执行：{command} | The transcript add-on is not ready: new posts are still discovered and collected, but bodies fall back to the description and content quality drops. If the package is indeed missing, run: {command} | 列表上方**非阻塞**提示 |
| `creatorCredentialStatusReadFailed` | 本地存储读取失败，无法确认密钥状态。请重启应用；若持续出现请检查磁盘后重试。 | Reading local storage failed, so the key status is unknown. Restart the app; if it persists, check your disk and retry. | 凭证状态行 + 页面横幅（QM-6 W1 处置） |

**两处既有文案修正**（原指引指向不存在的位置）：

| 键 | 原 | 现 |
|---|---|---|
| `creatorErrCredentialMissing` | …请在设置中填写。（设置页**并无**该字段） | …请在「博主监控」页点「配置 API Key」填写。 |
| `creatorFatalPaused` | …请在设置中检查 API Key。 | …请重新配置 API Key。 |
| `creatorEmptyDesc` | 添加 YouTube 博主后… | 添加 YouTube 博主后…。使用前需先配置 YouTube API Key。 |

> ⚠ i18n 实现约束（本次实测）：vue-i18n 的**字符串**消息把裸 `@xxx` 当「链接消息」语法，
> 编译期抛 `Invalid linked format`。生产侧 `src/i18n/index.js` 的 `toMessageFunctions`
> 会把所有字符串叶子转成 Message Function（为绕开 Electron CSP 的 `new Function` 限制），
> 故真实文案安全；**测试桩**若直接喂字符串，含 `@` 的词条必须写成函数形式。

## 17.7 `reason` 全表（渲染层按此分因，不解析自然语言）

| reason | 处置 | 文案来源 |
|---|---|---|
| `service-unavailable` | 重启应用；看日志 | `creatorErrServiceUnavailable` |
| `creator:credential_missing` | 打开凭证弹窗 | `creatorErrCredentialMissing` |
| `creator:credential_invalid` | 改输入 | `creatorCredentialInvalid` |
| `creator:credential_unavailable` | 检查系统密钥库 | `creatorCredentialUnavailable` |
| `creator:credential_persist_failed` | 重试 / 看日志 | `creatorCredentialPersistFailed` |
| `creator:invalid_input` | 改输入 | `creatorErrInvalidInput` |
| `creator:not_a_channel` | 换主页链接 | `creatorErrNotAChannel` |
| `creator:channel_not_found` | 核对链接 | `creatorErrChannelNotFound` |
| `creator:follow_not_found` / `creator:discovery_not_found` | 刷新列表 | `r.message` |
| `creator:count_exceeds_limit` | 调数量（回传 `max`） | `creatorErrCountExceedsLimit` |
| `creator:dependency_missing` | 装包（回传命令） | `creatorErrDependencyMissing` |
| `pipeline-unavailable` | 检查 AI 写作配置 | `r.message` |

## 17.8 交互逻辑细则

| 规则 | 判据 |
|---|---|
| 唯一「添加」入口 | 页面**只能**经 `CreatorAddDialog`；`grep window.prompt` MUST 为 0 命中 |
| 按钮禁用语义 | 只按「输入为空」禁用；**超长不禁用**（禁用 + 无提示 = 用户点不动且不知为何） |
| 弹窗重开 | 每次打开清空输入与上次错误（上次失败的值不得"复活"） |
| 失败不关弹窗 | 服务端错误内联显示，弹窗保持打开，**输入不丢** |
| 凭证保存成功 | 立即清空输入框（PRD §7.4），刷新状态与列表 |
| 凭证缺失联动 | 关注失败于 `credential_missing` 时**自动打开凭证弹窗**，不让用户自己找入口 |
| 可选依赖提示 | 只提示、不禁用；发现腿 `ready:false`（真阻塞）才走阻塞横幅 |
| 浮层形态 | 与同页 `QuickCollectCommandDialog.vue` 一致（手写 mask + `role="dialog"` + `aria-modal`）。该页不承载 `WebContentsView`，故不适用「浮层互斥挂起」契约（同页先例一致） |

## 17.9 回归锁清单

| 锁 | 文件 | 判据 |
|---|---|---|
| C1 行为锁 | `electron/bootstrap/phase5-ipc.test.js` | `context.container.get` 路径下五个 creator 依赖全部到位 |
| C1 结构锁 | 同上 | 源码不含那段不存在的取值写法 + 反向断言真实取值口在位 |
| C2 注册锁 | `electron/core/container.setup.creator.test.js` | 四项注册齐；缺凭证项时采集器仍可解析 |
| C2 形状锁 | 同上 | 采集器拿到的是函数而非 provider 对象 |
| C3 方法锁 | `electron/services/creator-collector-runtime.test.js` | `resolveChannelId` 存在；`forHandle` 语义；UC 零请求；缺 Key 零请求 |
| C3 夹具锁 | `electron/services/creator-wiring.e2e.test.js` | 替身方法集 ⊆ 真实对象方法集 |
| C4 分因锁 | `electron/ipc-handlers/creator.test.js` | 11 个降级通道消息含「未就绪」且**不含**「依赖」 |
| C4 渲染锁 | `src/features/collection/CreatorMonitor.test.js` | `service-unavailable` 时页面**不含**「缺少采集依赖」「请执行：」 |
| 凭证安全锁 | `electron/services/creator-credential.test.js` | 明文不落盘 / 明文被拒用 / `status()` 序列化无 key / 日志无 key 片段 / 缺 safeStorage 零落盘 |
| 凭证通道锁 | `electron/ipc-handlers/creator.test.js` | 写通道受 sender 守卫且业务函数未被调用（明文入口） |
| 添加流程锁 | `src/features/collection/CreatorMonitor.test.js` | 不调 `window.prompt`、提交走 IPC、成功即 `check-now`、失败按 reason 分因、超长不发请求 |
| 依赖分腿锁 | `electron/ipc-handlers/creator.test.js` | 桥不在跑时发现腿仍 ready、字幕腿给命令且 `optional:true` |
| 死探测锁 | `electron/services/creator-dependency-probe.test.js` | 探测永不抛；只回答桥状态；命令含国内镜像源 |

## 17.10 未闭合与残留风险（诚实登记）

1. **未做真机端到端**：本机没有可用的 YouTube Data API Key，故「点关注 → 真频道解析 → 真探测」
   未在打包应用里跑通；网络路径以注入式 `httpGet` 覆盖，**不假装已验证**。
2. **Python 依赖状态只到「桥在不在跑」**：`content-aggregator` 是否已装，Node 侧无法区分
   （要精确判定需 Python 侧新增依赖自检端点，属后续切片）。文案已如实写成"如果确实是缺包"。
3. **`creator:pending-total` 的许可级别**：本页通道当前按 `authenticated`（需登录）处理，
   与 `apps/desktop/electron/ipc-handlers/creator.js` 头注里「已在 license-access-control 登记为 public」
   的说法**不一致**——本次修正了头注，未改动许可策略（改策略属于「谁来守门」，需人工裁决）。
4. **字幕腿的自动安装引导**未做（仅给命令）：`asr-installer` 那套带进度的自动安装可复用，
   属后续切片（见 §16.1 的复用建议）。

## 17.11 本次变更文件清单

| 层 | 文件 |
|---|---|
| 主进程接线 | `electron/bootstrap/phase5-ipc.js`、`electron/core/container.setup.creator.js` |
| 主进程服务 | `electron/services/creator-credential.js`（新）、`creator-collector.js`、`creator-collector-runtime.js` |
| IPC / preload | `electron/ipc-handlers/creator.js`、`electron/preload/creator.js`（+ 两个 bundle 重生成） |
| 渲染层 | `src/features/collection/CreatorMonitor.vue`、`CreatorAddDialog.vue`（新）、`CreatorCredentialDialog.vue`（新） |
| 文案 | `src/locales/collection/zh.js`、`en.js` |
| 测试 | 8 个测试文件（3 新 / 5 改），本增量 199 例 |
| 规格 | `openspec/specs/creator-monitor/spec.md`（+4 Requirement）、本 PRD §17 |
