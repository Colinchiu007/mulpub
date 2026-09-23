## 变更日志（2026-08-10）

- 预设模型目录扩展至 53 项，数据来源=Multi-Publish 桌面端代码事实（适配器端点/种子模型/静态限流表）；limit_per_5h 与 models_url 无代码事实 → 置空由运营填写；新增目录一致性测试。
# OpsCenter — 运营配置中心 PRD v0.1

> 项目 012 / 一站式运营配置后台
> 状态：规划中 | 目标：消除 SSH + 手改 YAML 的运维模式

---

## 1. 产品概述

### 1.1 一句话定义

统一管理 9 个子项目所有配置、参数、凭据、功能开关的一站式运营后台。不依赖它也能运转，有了它不用再 SSH 进服务器改文件。

### 1.2 目标用户

| 用户 | 场景 | 需求 |
|------|------|------|
| 平台运营者 | 日常开关功能、调整参数 | Web UI 一键操作，不用懂服务器 |
| 开发者 | 调试、灰度、配置排障 | 快速定位配置变更历史，对比差异 |
| 系统自动 | 服务启动时拉取最新配置 | API 拉取，本地缓存兜底 |

### 1.3 解决的核心问题

**当前痛点：**
- 功能开关要 SSH 上 ECS，`vim feature_gates.yaml`，改完还得重启服务
- AI 提供商 API Key 散落在 4 个项目的 .env / config.yaml 里，过期了不知道哪个受影响
- 发布平台 cookie/token 过期后，排查是哪个平台、哪个服务用的哪个 key 极其耗时
- 改了个参数（如 SSS 的 max_input_length），过两周忘了改过，出事时无从追溯

**目标体验：**
- 打开网页 → 看到所有项目的所有配置 → 点一下开关 → 30 秒内全服务生效
- 任何配置变更都有记录：谁、什么时候、改了什么、改之前是什么
- 敏感信息（Key、Token）加密存储，UI 上默认掩码

### 1.4 核心设计原则

| 原则 | 说明 |
|------|------|
| **非侵入** | 没有 OpsCenter 时，所有项目照常运行。配置变更的生效依赖各项目已有的配置重载机制 |
| **单一事实源** | 运营配置以 OpsCenter DB 为准，各项目的本地配置文件是只读缓存 |
| **最小权限** | 敏感配置（密钥类）与普通配置（开关类）分权管理，操作日志全记录 |
| **渐进收敛** | 不要求一次性迁移所有配置。先从功能开关做起，逐步覆盖 |
| **独立部署** | 不影响现有项目的前端和 API，作为一个新服务独立存在 |

---

## 2. 当前配置审计（9 项目全景）

> 基于 2026-07-01 全项目代码审计。

### 2.1 配置散落矩阵

| 项目 | 配置形式 | 配置项数 | 有管理 UI | 有鉴权 | 变更生效方式 |
|------|---------|---------|----------|--------|-------------|
| platform-orchestrator | .env (PO_) + feature_gates.yaml | ~30 | 部分（admin/users, admin/providers） | ✅ JWT | 重启服务 |
| trendscope | .env (TS_) + DB 平台凭证 + sensitive_words.json | ~25 | ✅ Vue3 SPA（仪表盘/平台/用户/API Keys） | ✅ JWT admin | 重启服务 |
| content-aggregator | .env | ~8 | ❌ | ❌ | 重启服务 |
| prompt-engine | config.yaml + ${ENV_VAR} | ~20 | ❌ | ❌ | 重启服务 |
| smart-sentence-splitter | YAML + 代码默认值 | ~30 | ❌ | ❌ | 重启服务 |
| Story2Video | Supabase user_settings 表 + .env | ~5 | 部分（ApiSettingsDialog） | ✅ Supabase | 页面刷新 |
| Multi-Publish | config.yaml + platforms.yaml (17平台) | ~40 | ❌ | ❌ | 重启应用 |
| unified-frontend | NEXT_PUBLIC_API_URL | ~2 | 部分（settings, admin/users, admin/providers） | ✅ JWT | 重新构建 |
| content-aggregator-shared | YAML + env var | ~5 | ❌ | ❌ | 重启服务 |

### 2.2 需要收敛的配置分类

| 类别 | 当前存放位置 | 数量 | 变更频率 | 敏感度 | OpsCenter 优先级 |
|------|------------|------|---------|--------|-----------------|
| **功能开关** | orchestrator/feature_gates.yaml | 20 个 | 高（每迭代） | 低 | **P0** |
| **AI Key** | orchestrator .env + prompt-engine config.yaml | 6+ 家 | 中（过期/轮换） | 🔴 高 | **P0** |
| **发布平台凭证** | Multi-Publish platforms.yaml + trendscope DB | 17+ 平台 | 中（cookie 过期） | 🔴 高 | P1 |
| **项目运行参数** | SSS YAML + prompt-engine config + aggregator .env | ~50 | 低 | 低 | P2 |
| **环境级配置** | 各项目 .env（DB URL / Redis / JWT Secret） | ~20 | 极低 | 🔴 高 | P3 |
| **前端配置** | unified-frontend env | ~2 | 极低 | 低 | P3 |

---

## 3. 架构设计

### 3.1 系统定位

```
┌─────────────────────────────────────────────────────────────┐
│                      OpsCenter                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ 配置管理  │  │ 密钥管理  │  │ 开关管理  │  │ 审计日志     │ │
│  │ CRUD API │  │ 加密存储  │  │ 即时生效  │  │ 变更追溯     │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       └──────────────┴─────────────┴───────────────┘        │
│                          │  Config DB (SQLite)               │
└──────────────────────────┼──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                 ▼
   REST API ( pull )  Config File Gen  Webhook ( push )
   各服务启动时拉取    写入共享 volume    通知服务重载配置
```

### 3.2 配置传播机制（三层兜底）

```
Layer 1 — API 拉取（推荐）
  服务启动 → GET /api/v1/config/{project} → OpsCenter DB
  ├── 成功 → 使用最新配置
  └── 失败 → 进入 Layer 2

Layer 2 — 配置文件缓存
  各项目本地 config.yaml / feature_gates.yaml
  ├── 由 OpsCenter 定期写入（cron 每 5 分钟）
  └── 项目已有配置热重载机制（如 orchestrator 的 mtime watch）

Layer 3 — 硬编码默认值
  配置文件不存在或解析失败
  └── 使用代码内置的 DEFAULT_CONFIG（各项目已有）
```

**关键理解**：OpsCenter 不替代各项目的配置加载机制，而是作为配置的「编辑器和分发器」。各项目保持自己的配置加载逻辑不变，只是配置文件的来源从「人工 SSH 编辑」变成「OpsCenter 自动生成」。

### 3.3 不破坏现有项目的保证

- **网络隔离**：OpsCenter 不可用时，各项目使用本地配置文件（已存在），完全不受影响
- **格式兼容**：生成的配置文件格式与各项目当前格式 100% 兼容（YAML 还是 YAML，env 还是 env）
- **不修改代码**：各项目不需要引入新的 SDK 或依赖，除非主动选择 API 拉取模式
- **渐进迁移**：可以先只迁移功能开关，看效果再逐步迁移其他配置

### 3.4 技术选型建议

| 层 | 选型 | 理由 |
|----|------|------|
| 后端框架 | FastAPI (Python 3.12+) | 与现有项目技术栈一致，async 支持好 |
| 数据库 | aiosqlite (WAL 模式) | 与 orchestrator 一致，零运维，够用 |
| 前端 | Vue 3 + Element Plus | 与 TrendScope admin 一致，可复用组件 |
| 构建工具 | Vite | 与 TrendScope admin 一致 |
| 加密 | Python cryptography (Fernet) | 对称加密，密钥由环境变量注入 |
| 部署 | 独立 uvicorn 进程 on ECS | 端口 8010，nginx 反代 |

---

## 4. 数据模型

### 4.1 核心表设计

```sql
-- 配置项主表
CREATE TABLE config_items (
    id          TEXT PRIMARY KEY,           -- "orchestrator.feature_gates.video_full_pipeline"
    project     TEXT NOT NULL,              -- "platform-orchestrator"
    category    TEXT NOT NULL,              -- "feature_flag" | "api_key" | "platform_credential" | "project_param" | "env_var"
    key         TEXT NOT NULL,              -- "video_full_pipeline"
    value       TEXT NOT NULL,              -- JSON-encoded value
    value_type  TEXT NOT NULL DEFAULT 'string',  -- "string" | "boolean" | "number" | "json" | "secret"
    description TEXT,
    is_secret   INTEGER NOT NULL DEFAULT 0, -- 1 = 加密存储
    is_required INTEGER NOT NULL DEFAULT 0,
    default_value TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    updated_by  TEXT
);

-- 变更审计日志
CREATE TABLE config_audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id   TEXT NOT NULL,
    old_value   TEXT,                       -- JSON
    new_value   TEXT,                       -- JSON
    changed_by  TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    change_type TEXT NOT NULL,              -- "create" | "update" | "delete"
    source_ip   TEXT
);

-- 项目注册表
CREATE TABLE projects (
    code        TEXT PRIMARY KEY,           -- "platform-orchestrator"
    name        TEXT NOT NULL,              -- "Platform Orchestrator"
    description TEXT,
    config_file_path TEXT,                  -- ECS 上的配置文件路径
    config_format    TEXT DEFAULT 'yaml',   -- "yaml" | "env" | "json"
    enabled     INTEGER NOT NULL DEFAULT 1
);

-- 配置组（用于批量操作，如"导出所有 AI Key"）
CREATE TABLE config_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT
);

CREATE TABLE config_group_items (
    group_id    TEXT NOT NULL,
    config_id   TEXT NOT NULL,
    PRIMARY KEY (group_id, config_id)
);
```

### 4.2 配置 ID 命名规范

```
{project_code}.{category}.{key}

示例:
  orchestrator.feature_flag.video_full_pipeline
  orchestrator.api_key.openai
  multi-publish.platform_credential.bilibili_cookie
  sss.project_param.max_input_length
  prompt-engine.project_param.default_platform
```

### 4.3 加密策略

- `is_secret=1` 的配置项，value 用 Fernet 对称加密后存储
- 加密密钥 `OPS_ENCRYPTION_KEY` 通过环境变量注入，不存 DB
- API 返回时，secret 类配置默认掩码（`sk-***a1b2`），需额外鉴权才能查看明文
- 导出配置文件时自动解密写入

---

## 5. 功能规格（分版本）

### 5.1 V0.1 — 功能开关管理（P0 痛点）

**范围**：只管理 `feature_gates.yaml` 中的 20 个开关

**功能点：**
- [ ] 开关列表（表格：名称、描述、当前状态、适用 tier、最后修改时间）
- [ ] 开关详情（描述、适用项目、依赖关系）
- [ ] 一键启用/禁用
- [ ] 按 tier 筛选（tier 1/2/3）
- [ ] 批量操作（启用全部 tier-1 开关等）
- [ ] 变更确认弹窗（含影响说明）
- [ ] 保存后自动生成 `feature_gates.yaml` 并写入 ECS 共享路径
- [ ] orchestrator 的 mtime watch 检测到文件变化 → 自动热重载（已有机制）
- [ ] 审计日志：谁、什么时候、改了哪个开关、旧值→新值

**不包含：**
- 新增/删除开关（开关定义由代码控制）
- 开关依赖关系自动检测

**完成标准：** 打开网页 → 切换 `video_full_pipeline` → 30 秒内 ECS 上 orchestrator 生效，无需重启

### 5.2 V0.2 — 官方内置 AI Key 管理（P0）

**范围**：管理平台运营方的官方内置 LLM Key。⚠️ 注意区分：这是**运营后台**的 Key 管理，
不是用户自己配 Key 的前台设置。用户自有 Key 的管理在 unified-frontend 会员前台实现。

两套 Key 体系的区分见 [定价策略 & 用户分级设计](pricing-strategy.md)。

**功能点：**
- [ ] 官方 Key 的 CRUD（多 Provider：OpenAI、豆包、Minimax、Deepseek、Kling 等）
- [ ] Key 掩码显示（`sk-***a1b2`），二次确认查看明文
- [ ] Key → Tier 访问映射：哪些 Key 供免费用户用，哪些供付费用户用
- [ ] Key 过期提醒（到期前 7 天告警）
- [ ] 「测试连接」按钮（调用对应 API 验证 Key 可用）
- [ ] 配置导出：生成 prompt-engine / orchestrator 需要的 Key 配置
- [ ] 成本监控仪表盘（按 Provider 的预估月成本）

**不包含（这些是会员前台/其他模块的范围）：**
- ❌ 用户自有 Key 的 CRUD（已在 unified-frontend Settings/Providers 页）
- ❌ 用户配额管理（已在 orchestrator user_usage 表）
- ❌ Key 自动轮换
- ❌ 支付集成（微信/支付宝）

### 5.3 V0.3 — 发布平台凭证管理（P1）

**范围**：管理 17 个发布平台的 token/cookie/secrets

**功能点：**
- [ ] 平台列表（B站、抖音、小红书、视频号、YouTube 等）
- [ ] 每个平台的认证信息（cookie、token、app_id、app_secret）
- [ ] Cookie 过期检测（手动触发验证）
- [ ] 批量导出 platforms.yaml
- [ ] 平台启用/禁用开关
- [ ] 与 Multi-Publish 和 orchestrator 的 cloud-publisher 对齐字段

### 5.4 V0.4 — 项目级运行参数（P2）

**范围**：各项目的内部可调参数

**示例参数：**
| 项目 | 参数 |
|------|------|
| SSS | max_input_length, enable_era, target_seconds, speech_rate |
| prompt-engine | default_platform, default_style, max_retries |
| content-aggregator | provider, model, timeout |
| orchestrator | queue_max_concurrent, publish_interval_minutes |

**功能点：**
- [ ] 参数列表（按项目分组）
- [ ] 参数编辑（类型校验：number/string/boolean/enum）
- [ ] 默认值展示和重置
- [ ] 参数说明/文档内联展示
- [ ] 变更历史对比（diff 视图）

### 5.5 V0.5 — 配置版本化与回滚（P2）

**功能点：**
- [ ] 配置快照：手动创建全量配置快照
- [ ] 快照对比：选择两个快照，查看差异
- [ ] 一键回滚：从快照恢复配置
- [ ] 配置导入/导出：JSON 格式，可跨环境迁移
- [ ] 变更审批流（可选）：敏感配置变更需要二次确认

### 5.6 V0.6 — 环境级配置只读视图（P3）

**范围**：展示但不编辑环境变量（DB URL / Redis / JWT Secret 等）

**功能点：**
- [ ] 各项目环境变量只读列表（掩码敏感值）
- [ ] 配置一致性检查（如 JWT Secret 跨项目是否一致）
- [ ] 缺失配置告警（如某项目缺了必要环境变量）
- [ ] 配置文档自动生成（Markdown 格式）

---

## 6. API 设计

### 6.1 配置管理 API

| 端点 | 方法 | 说明 | 鉴权 |
|------|------|------|------|
| `/api/v1/config/{project}` | GET | 获取项目全部配置 | JWT |
| `/api/v1/config/{project}/{category}` | GET | 获取某类配置 | JWT |
| `/api/v1/config/{project}/{category}/{key}` | GET | 获取单个配置 | JWT |
| `/api/v1/config/{project}/{category}/{key}` | PUT | 更新配置 | JWT admin |
| `/api/v1/config/batch` | PUT | 批量更新配置 | JWT admin |
| `/api/v1/config/{project}/export` | GET | 导出为配置文件格式 | JWT admin |
| `/api/v1/config/audit-log` | GET | 查询变更日志 | JWT admin |
| `/api/v1/config/snapshots` | POST | 创建配置快照 | JWT admin |
| `/api/v1/config/snapshots/{id}/restore` | POST | 从快照恢复 | JWT admin |

### 6.2 密钥管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/secrets/{project}/{key}` | GET | 获取密钥（掩码） |
| `/api/v1/secrets/{project}/{key}/reveal` | POST | 查看明文（需二次确认） |
| `/api/v1/secrets/{project}/{key}` | PUT | 更新密钥 |
| `/api/v1/secrets/{project}/{key}/test` | POST | 测试密钥可用性 |

### 6.3 健康与同步 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/sync/{project}` | POST | 强制生成并推送配置文件 |
| `/api/v1/sync/status` | GET | 查看各项目配置同步状态 |
| `/health` | GET | 健康检查 |

### 6.4 认证方案

- 复用 orchestrator 的 JWT 体系（共享 `PO_SECRET_KEY`）
- Admin 操作需要 `role: admin`
- 查看密钥明文需要额外二次确认（前端输入密码或 OTP）
- 可选：IP 白名单限制（仅 ECS 内网 + 指定公网 IP 可访问）

**鉴权分级（2026-08-09 修订，与 model-presets 语义对齐）**：

| 资源 | 已登录（任意 role） | Admin（role=admin） |
|------|--------------------|--------------------|
| 模型预设目录读取（`GET /api/v1/model-presets`，默认不含隐藏项） | ✅ | ✅ |
| 模型预设目录读取含隐藏项（`include_hidden=true`） | ❌ 403 | ✅ |
| 模型预设新增/编辑/删除 | ❌ 403 | ✅ |
| 环境变量只读视图 / 一致性检查 | ✅ | ✅ |
| 配置项读取（项目配置、feature-gates） | ✅ | ✅ |
| 配置项写入 / 批量 / 密钥写 / 快照写 | ❌ 403 | ✅ |

> 说明：orchestrator 登录签发的 JWT 不含 `role` 字段，因此普通登录用户天然是「只读」角色；
> 运营管理写操作依赖带 `role: admin` 的 token（由 orchestrator API Key 路径或运营侧签发）。

**环境一致性检查语义（2026-08-09 修订）**：
- 检查对象是 ops-center 进程内可观察的环境变量（`PO_SECRET_KEY`/`TS_SECRET_KEY` 等）。
- 变量未配置 → `status=unknown`（不计为缺陷；这些密钥属于 orchestrator/trendscope 各自进程）。
- 已配置且一致 → `status=ok`；已配置但不一致 → `status=mismatch`（passed=false）。
- 前端对 `unknown` 展示「未配置」标签，不再误报「✗ 未通过」。

---

## 7. 前端设计

### 7.1 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Vue 3 (Composition API) |
| UI 库 | Element Plus |
| 构建 | Vite |
| 状态 | Pinia |
| 路由 | Vue Router |

### 7.2 页面结构

```
OpsCenter
├── /                          # 首页 — 全局仪表盘
│   ├── 配置概览卡片（项目数、开关数、Key 数）
│   ├── 最近变更时间线
│   └── 配置健康检查结果
├── /feature-flags             # 功能开关管理（V0.1 核心）
│   ├── 开关列表 + 筛选
│   └── 开关详情弹窗
├── /projects                  # 项目列表（V0.1+，2026-08-09 实现）
│   ├── 项目表格（代码/名称/描述/格式/状态）
│   └── 点击项目 → 该项目配置项只读表格（普通登录只读；编辑需 admin，见 6.4）
├── /secrets                   # 密钥管理（V0.2）
│   ├── 提供商列表
│   └── 密钥编辑弹窗
├── /platforms                 # 平台凭证（V0.3）
├── /audit-log                 # 审计日志（2026-08-09 实现）
│   ├── 变更记录表格（配置 ID/类型/旧值/新值/操作人/时间）
│   ├── 按配置 ID 过滤
│   └── 变更详情（diff 视图，后续迭代）
├── /snapshots                 # 配置快照（V0.5）
└── /settings                  # OpsCenter 自身设置
```

### 7.3 关键交互

- **开关切换**：Switch 组件 + 确认弹窗（含影响说明） → 即时生效
- **密钥编辑**：Input type=password + 显示/隐藏切换 + 复制按钮
- **批量操作**：表格多选 + 批量编辑/导出
- **实时反馈**：操作后 Toast 通知 + 同步状态指示

---

## 8. 部署方案

### 8.1 ECS 部署架构

```
ECS (Aliyun Linux 3, 4G)
├── nginx (80/443)
│   ├── /api/         → orchestrator:8000
│   ├── /trendscope/  → trendscope:8001
│   ├── /sss/         → sss:8002
│   ├── /prompt/      → prompt-engine:8013
│   └── /ops/         → ops-center:8010          ← 新增
├── ops-center (uvicorn, port 8010)              ← 新增
│   ├── SQLite: /data/ops-center/config.db       ← 新增
│   └── Config file output: /data/configs/       ← 新增（共享目录）
├── orchestrator:8000
├── trendscope:8001
├── sss:8002
└── prompt-engine:8013
```

### 8.2 配置文件输出路径

OpsCenter 生成的配置文件写入 `/data/configs/`，各项目通过符号链接或挂载读取：

```
/data/configs/
├── orchestrator/
│   ├── feature_gates.yaml
│   └── .env.ai_keys
├── trendscope/
│   └── platform_credentials.env
├── multi-publish/
│   ├── platforms.yaml
│   └── config.yaml
├── prompt-engine/
│   └── config.yaml
├── sss/
│   └── config.yaml
└── content-aggregator/
    └── .env
```

### 8.3 环境变量

```bash
# OpsCenter 自身
OPS_ENCRYPTION_KEY=xxx          # Fernet 密钥，用于加密存储敏感配置
OPS_SECRET_KEY=xxx              # JWT 签名密钥（与 orchestrator 共享 PO_SECRET_KEY）
OPS_DB_PATH=/data/ops-center/config.db
OPS_CONFIG_OUTPUT_DIR=/data/configs
OPS_ADMIN_IPS=xxx               # 可选：管理后台 IP 白名单
```

---

## 9. 迁移计划

### 9.1 零风险迁移策略

**原则**：每一步都保证「回退到手动模式」不受影响。

| 阶段 | 内容 | 风险 | 回退方式 |
|------|------|------|---------|
| Step 0 | 部署 OpsCenter，导入现有配置（只读模式） | 无 | 删除服务即可 |
| Step 1 | 开启配置生成（写入 `/data/configs/`），各项目**不读取**新路径 | 极低 | 删除生成的文件 |
| Step 2 | 选 orchestrator 做试点，将其 `feature_gates.yaml` 路径指向 `/data/configs/` | 低 | 改回原路径 |
| Step 3 | 在 OpsCenter 中修改一个开关，验证 orchestrator 热重载生效 | 低 | 手动改回 |
| Step 4 | 逐步迁移其他项目和配置类别 | 中 | 逐项目回退 |
| Step 5 | 关闭各项目的旧配置文件，全量由 OpsCenter 管理 | 中 | 恢复旧文件 |

### 9.2 配置初始化

首版部署时，运行初始化脚本 `seed_config.py`，从各项目现有配置文件读取内容导入 OpsCenter DB。

```bash
python scripts/seed_config.py --project orchestrator --source /path/to/feature_gates.yaml
python scripts/seed_config.py --project orchestrator --source /path/to/.env --type env
# ... 逐个导入
```

---

## 10. 风险与限制

| 风险 | 影响 | 缓解 |
|------|------|------|
| OpsCenter 宕机 | 无法通过 Web 修改配置 | 各项目使用本地缓存配置文件，不受影响 |
| 配置写入错误 | 项目加载到错误配置 | 配置生成前做 schema 校验；生成后保留旧文件备份 |
| 加密密钥丢失 | 无法解密已存储的 Key | `OPS_ENCRYPTION_KEY` 备份；Key 从各项目 .env 可恢复 |
| 多服务配置不一致 | A 服务用了新配置，B 还是旧的 | 配置生成时带版本号；各服务启动日志记录加载的配置版本 |
| 权限失控 | 误操作改了关键配置 | 审计日志全记录；敏感操作二次确认；快照回滚 |

---

## 11. 排除项（明确不做）

- **不替代各项目的前端功能**：TrendScope 管理后台、unified-frontend 设置页保持不变
- **不做监控告警**：已有 `ecs-monitor` 脚本，不重复建设
- **不做部署编排**：不管理各项目的启动/停止/重启
- **不做用户管理**：用户系统由 orchestrator 统一管理
- **不做配置模板市场**：不搞「一键导入最佳配置」
- **不做多环境管理**：首版只管理 ECS 生产环境
- **不做配置 A/B 测试**：开关只管 on/off，不做流量分配

---

## 12. 配套文档

- [定价策略 & 用户分级功能设计](pricing-strategy.md) — 会员等级、配额体系、双 Key 架构、成本估算

## 13. 与其他项目的关系

```
OpsCenter  ←→  platform-orchestrator  (JWT 共享，读取 feature_gates)
OpsCenter  ←→  trendscope             (平台凭证导出)
OpsCenter  ←→  Multi-Publish          (平台配置导出)
OpsCenter  ←→  prompt-engine          (LLM 配置导出)
OpsCenter  ←→  SSS                    (运行参数导出)
OpsCenter  ←→  content-aggregator     (配置导出)
OpsCenter  ←→  unified-frontend       (独立，互不影响)
```

---

## 14. 迭代计划

| 版本 | 内容 | 预计工时 | 交付物 |
|------|------|---------|--------|
| V0.1 | 功能开关管理 | 3-5 天 | Web UI + API + 配置生成 |
| V0.2 | AI Key 管理 | 3-5 天 | 加密存储 + 测试连接 + 导出 |
| V0.3 | 平台凭证管理 | 3-5 天 | 多平台 credential 管理 |
| V0.4 | 项目运行参数 | 3-5 天 | 参数编辑 + 类型校验 |
| V0.5 | 版本化与回滚 | 2-3 天 | 快照 + diff + 回滚 |
| V0.6 | 环境变量只读视图 | 2-3 天 | 一致性检查 + 告警 |

总计：V0.1-V0.6 约 16-26 天。

---

## 12. 预设模型设置 / 多模态能力管理（2026-08-08 新增）

### 12.1 产品概述

运营人员在运营后台维护 Multi-Publish 前端【模型设置】的预设服务商目录：

- **预设模型设置**：设定哪些模型在前端【模型设置】中显示（`is_visible` 开关）；每个模型可填写最多 10 条技术文档网页链接（`doc_links`）；可填写/修改平台预设默认模型 Model ID（`default_model`）。
- **多模态设置**：针对多模态模型，手工配置其支持的每个能力（`capabilities`）、每能力默认模型（`capability_models`）与每能力技术文档链接（`capability_doc_links`，每能力最多 10 条）。

### 12.2 功能列表

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 模型预设目录 CRUD | 新增/编辑/删除模型预设（id/name/category/base_url/models/default_model） | P0 |
| 前端显示开关 | `is_visible` 控制是否在前端【模型设置】展示；`include_hidden=false` 过滤隐藏项 | P0 |
| 默认模型设置 | 每个预设可填写默认 Model ID，系统已知默认模型预填（MiniMax 多模态 `MiniMax-M2.7` 等） | P0 |
| 文档链接管理 | 模型级 `doc_links` ≤10 条、能力级 `capability_doc_links` 每能力 ≤10 条；必须为 http(s) URL | P0 |
| 多模态能力配置 | 多模态预设配置能力数组 + 每能力默认模型（缺省报 400）+ 每能力文档链接 | P0 |
| 种子目录初始化 | 首次启动自动填充内置目录（与 Multi-Publish 预设对齐，含 MiniMax 各能力官方文档链接） | P0 |

### 12.3 数据约束

- `model_presets.id`：唯一主键（如 `minimax-multimodal`）。
- `category`：`llm / tts / speech_recognition / image / video / audio / multimodal` 之一。
- `doc_links` / `capability_doc_links`：JSON 数组/对象；每项必须 `http(s)` 开头；模型级 ≤10 条、每能力 ≤10 条，超限/非法返回 400。
- `capabilities` 中的每个能力必须出现在 `capability_models`（缺默认模型 → 400「缺少默认模型」）。
- `default_model`：字符串，可为空；已知默认值由种子目录预填。

### 12.4 API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/v1/model-presets` | admin | 列表，支持 `category` / `include_hidden` 参数 |
| GET | `/api/v1/model-presets/{id}` | admin | 详情 |
| POST | `/api/v1/model-presets` | admin | 创建（校验同上） |
| PUT | `/api/v1/model-presets/{id}` | admin | 更新 |
| DELETE | `/api/v1/model-presets/{id}` | admin | 删除 |

### 12.5 前端页面「预设模型」

- 菜单入口：「预设模型」（`/model-presets`）。
- 列表：类别筛选、多模态标签、能力 chips、默认模型列、文档链接数（N/10）、前端显示开关、编辑/删除。
- 编辑对话框：基础信息（ID/名称/类别/Base URL/模型列表/默认模型 ID/多模态开关/前端显示）+ 多模态能力配置（能力多选、每能力默认模型、每能力文档链接 ≤10）+ 模型文档链接（≤10）。

### 12.6 验收标准

1. 运营后台可新增/编辑/删除模型预设。
2. 默认模型字段预填已知值（如 MiniMax 多模态 = `MiniMax-M2.7`）且可修改。
3. `doc_links` 超过 10 条或非 URL 被拒绝（400）。
4. 多模态能力缺少默认模型被拒绝（400）。
5. `is_visible=false` 后列表（`include_hidden=false`）不再展示该预设。
5. 多模态能力缺少默认模型被拒绝（400）。

---

## 12A. 模型更多信息字段 / 获取模型ID / 多模态分能力文档URL（2026-08-10 新增）

> 在既有「预设模型设置」基础上扩展运营信息字段，指导前端调度并发与排队，并支持从模型网址拉取模型 ID 列表。

### 12A.1 新增信息项（字段与数据校验）

| 显示项 | 字段 | 类型 | 允许为空 | 校验规则 |
|--------|------|------|---------|---------|
| 接口 Base URL（端口URL） | `base_url` | string | ✅ | 空允许；非空必须 `http(s)` 开头，长度 ≤500 |
| 获取模型ID URL | `models_url` | string | ✅ | 空允许；非空必须 `http(s)` 开头，长度 ≤500；用于「获取模型」按钮拉取模型 ID |
| 默认模型 ID | `default_model` | string | ✅ | 空允许；**非空且模型列表非空时，必须 ∈ 模型列表**，否则 400「默认模型 ID 必须在模型列表中」 |
| 接口技术文档URL | `doc_links` | string[] | ✅ | ≤10 条；每条 `http(s)` 开头 |
| 每分钟连接次数 | `rate_per_minute` | integer | ✅ | 空/None 视为未配置（null）；非空必须为 `[1, 100000]` 的整数（`int()` 严格转换，拒绝 `1.5`/`'abc'`/负数/布尔），否则 400 |
| 5小时限额次数 | `limit_per_5h` | integer | ✅ | 空/None 视为未配置（null）；非空必须为 `[1, 10000000]` 的整数，否则 400 |

- 前端输入框留空 → 保存为 `null`（`rate_per_minute`/`limit_per_5h`）或空串（URL 类）。
- 语义说明：`rate_per_minute`=该模型每分钟允许的 API 请求次数；`limit_per_5h`=每 5 小时请求次数上限。桌面端据此调度并发与排队；留空表示使用默认限流（不报错）。

### 12A.2 默认模型下拉与「获取模型」按钮

- **默认模型 ID 改为下拉选择**：选项来自「模型列表」（`models` 数组），支持过滤/清空；模型列表为空时下拉为空（仅可留空）。
- **「获取模型」按钮**（编辑/新增弹窗内，默认模型下拉旁）：
  - 点击后调用 `POST /api/v1/model-presets/{id}/fetch-models`（body 可带 `models_url` 覆盖未保存的表单值）；
  - 成功：`models` 被更新为返回的模型 ID 列表，`default_model` 若不在新列表则清空，前端回填模型列表文本框与默认模型下拉，提示「获取成功，共 N 个模型 ID」；
  - 失败：不修改已有 `models`，弹出错误详情（URL 未配置 / 超时 / 非 JSON / SSRF 拒绝 / HTTP 状态码）。
- 前端必填校验：点击获取模型前需有「预设 ID」与「获取模型ID URL」；未填写时提示「请先填写…」。

### 12A.3 获取模型ID 端点（fetch-models）

| 项 | 契约 |
|----|------|
| 方法/路径 | `POST /api/v1/model-presets/{preset_id}/fetch-models` |
| 鉴权 | admin-only（普通用户 403） |
| 请求体 | `{"models_url": "https://..."}`（可选；未传用预设已保存的 `models_url`） |
| 成功响应 | `{"models": [...], "default_model": "...", "count": N}`；回写 `models`（`models_url` 覆盖时一并回写）、`default_model` 不在新列表则清空 |
| 失败 | 400 + 中文错误（不修改已有数据） |

> **鉴权说明（2026-08-27）**：fetch-models 不携带供应商鉴权头；白名单官方端点均需鉴权（OpenAI 系 `Bearer`、Anthropic `x-api-key` 等），预填官方 URL 后直连「获取模型」将返回 401/403。预填仅为地址预置；实际拉取建议经内部网关或后续扩展鉴权适配。


**SSRF 防护清单**：
1. URL 必须是 `http(s)` 且长度 ≤500（`ftp://` 等拒绝）；
2. 仅本机环回主机（`localhost` / `127.0.0.1` / `::1`）允许 `http`（供本地 ollama 等）；非环回主机必须 `https`；
3. DNS 解析后任一地址为私网/环回/链路本地/组播/保留/未指定 → 拒绝；**拒绝文案区分两类场景**：
   - **真实私网/保留地址**（10.x / 192.168.x / 172.16–31.x / 127.x / 169.254.x / 100.64–127.x CGNAT / 224.x 组播 / 0.0.0.0 未指定等）→ 提示「获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）」；
   - **fake-IP 代理基准段 198.18.0.0/15（RFC 2544）** → 提示明确指向代理场景与放行方式（见 12A.3.1），默认开关 `OPS_ALLOW_PROXY_BENCHMARK_IPS=false` 仍按保留地址拒绝（fail-closed，不削弱 SSRF）。
4. `follow_redirects=False`：任何 3xx 重定向视为失败（HTTP ≥300 → 400）；
5. 超时 10s；响应体 ≤512KB；
6. JSON 契约：支持 `{models:[...]}` / `{data:[...]}` / `{data:[{id:...}]}` / `{model_ids|modelIds}` / `{items}` / 纯数组；元素提取优先级 id（OpenAI 兼容）→ model_id/modelId（ElevenLabs 真实 API 标识）→ name（Gemini `models/xxx` 自动剥离前缀、Ollama tags）；非空去重，最多 500 个；无模型 ID → 400「未找到任何模型ID」。

### 12A.3.1 fake-IP 代理（Clash/TUN）场景与放行（2026-09-16 修复）

**现象**：在开启 fake-IP / DNS 劫持模式的代理（Clash、Surge、Mihomo、sing-box 等）环境下，点击「获取模型」拉取官方公网模型 API（如 agnes-llm、MiniMax、OpenAI 等），报错：
> 获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）

但这是**误报**——域名解析到的 `198.18.x.x` 并非真实内网目标。

**根因**：`198.18.0.0/15` 是 RFC 2544 基准测试段（TEST-NET-2）。Clash/TUN 类代理用该段接管公网流量：开启 fake-IP 后，所有公网域名经系统解析会被改写为 `198.18.x.x`（IANA 保留段，Python ≥3.12 将其标记为 `is_private=True`）。`fetch_models_from_url` 的 `_is_private_or_reserved` 默认（`OPS_ALLOW_PROXY_BENCHMARK_IPS=false`）把该段按保留/私网拒绝，于是报「私网/保留地址」。原报错文案笼统，用户无法判断是真实内网还是代理假象，无法自助解决。

**修复（代码）**：在 `ops-center/backend/services/model_preset_service.py`：
- 新增 `_is_benchmark_segment(ip)` 判定 IP 是否落在 `198.18.0.0/15`；
- `fetch_models_from_url` 的 DNS 解析拒绝循环中，对「命中基准段且开关关闭」单独抛**可操作错误**，与真实私网明确区分：
  - 基准段（开关关闭）：`ValueError("获取模型ID URL 在 fake-IP 代理环境下解析到 198.18.x.x（RFC 2544 基准测试段），被 SSRF 守卫按保留地址拒绝。这不是真实内网目标，而是 Clash/TUN 类代理接管公网流量的正常现象。请二选一解决：① 在运行 ops-center 的环境设置 OPS_ALLOW_PROXY_BENCHMARK_IPS=true 后重启服务；② 关闭代理的 fake-IP / DNS 劫持模式后重试。")`
  - 真实私网/保留地址：`ValueError("获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）")`（保持原样）。

**两条解决路径（运营/用户自助）**：
1. **放行基准段（推荐，保留 SSRF 默认）**：在运行 ops-center 的环境设置 `OPS_ALLOW_PROXY_BENCHMARK_IPS=true` 并重启服务。该开关仅放行 `198.18.0.0/15`（代理假象段），真实私网（`10.x` / `192.168.x` / `172.16–31.x` / `127.x` / `169.254.x` / CGNAT `100.64–127.x` / 组播 / 未指定）仍严格拒绝，不削弱 SSRF 防护。**生产/ECS 环境请保持关闭。**
2. **关闭代理 fake-IP / DNS 劫持**：让公网域名解析到真实公网 IP，SSRF 守卫自然放行（前提是域名确为合法公网 HTTPS 端点）。

**数据校验 / 流程**：
- 校验顺序不变：`http(s)`+长度 ≤500 → 环回放行 http 否则强制 https → `socket.getaddrinfo` 解析 → 逐条 IP 判私网/保留（区分基准段）→ `follow_redirects=False` 取响应 → 10s 超时 → ≤512KB → JSON 契约提取。
- DNS 解析与 httpx 实际连接为两次独立解析（已知 TOCTOU 窗口，follow_redirects=False 已防 3xx 跳转），本端点不声称阻断 DNS 重绑定；`198.18.0.0/15` 判别仅在「解析结果」层生效。
- 开关 `allow_proxy_benchmark_ips` 由 `OPS_ALLOW_PROXY_BENCHMARK_IPS` 经 pydantic-settings `env_prefix="OPS_"` 映射，默认 `False`。

**交互逻辑 / 显示项 / 提示文字**：
- 前端「获取模型」按钮点击后调用 `POST .../fetch-models`；失败时后端返回 `400 + detail`（上述中文错误），前端 `ElMessage` 弹窗直接展示 `detail` 全文（错误详情不改写）。
- 两种文案在 UI 上的差异：**基准段文案会明确出现「fake-IP」「198.18」「OPS_ALLOW_PROXY_BENCHMARK_IPS」** 三个关键词，便于运营一眼识别为「代理假象」而非「真实内网」；真实私网文案仅含「私网/保留地址」。
- 建议运营处理 SOP：看到「fake-IP / 198.18」→ 设 `OPS_ALLOW_PROXY_BENCHMARK_IPS=true` 或关代理 fake-IP；看到「私网/保留地址」→ 确认 `models_url` 是否误填内网地址。

**回归保护测试**：`tests/test_model_presets_api.py` 新增/更新断言——
- `test_fetch_models_proxy_benchmark_segment_rejected_when_disabled`：开关关闭，`198.18.0.241` 仍 400，且 `detail` 含 `198.18` / `fake-IP` / `OPS_ALLOW_PROXY_BENCHMARK_IPS`；
- 新增 `test_fetch_models_benchmark_off_message_distinct_from_real_private`：验证基准段文案含 `fake-IP`+`OPS_ALLOW_PROXY_BENCHMARK_IPS` 且**不含**「私网」，而真实私网 `10.0.0.1` 文案含「私网」且**不含** `fake-IP`，确保两类提示可区分。

### 12A.4 多模态分能力技术文档 URL

多模态模型（`is_multimodal=true`）编辑弹窗显示 **7 个固定能力标签的单 URL 输入框**（不再仅按已勾选能力动态显示）：

| 能力键 | 显示 label | 存储 |
|--------|-----------|------|
| `llm` | 文字推理接口技术文档URL | `capability_doc_links.llm` |
| `image` | 图片生成技术文档URL | `capability_doc_links.image` |
| `video` | 视频生成技术文档URL | `capability_doc_links.video` |
| `tts` | TTS语音生成技术文档URL | `capability_doc_links.tts` |
| `voice_clone` | TTS语音克隆技术文档URL | `capability_doc_links.voice_clone` |
| `speech_recognition` | 语音识别技术文档URL | `capability_doc_links.speech_recognition` |
| `vision` | 视觉识别技术文档URL | `capability_doc_links.vision` |

- 结构保持 `capability -> links 数组`（单 URL 也存为单元素数组），兼容存量多链接数据（编辑回填取首条，保存时保留首条避免数据丢失）。
- 校验：`capability_doc_links` 的键必须是 7 能力键之一（另兼容历史 `audio`），未知键 → 400「未知的能力文档键」；每条链接 `http(s)`、≤10 条。

### 12A.5 数据迁移与种子

- `init_db` 后执行幂等列迁移：存量 `model_presets` 表补充 `models_url`（VARCHAR DEFAULT ''）、`rate_per_minute`（INTEGER）、`limit_per_5h`（INTEGER）。
- 启动种子（`services/config_seed_service.py`）：幂等注册 6 个预置项目（含 `platform-orchestrator`，功能开关页面依赖）+ 从 `feature_gates.yaml` 导入功能开关（源可经 `OPS_FEATURE_GATES_SOURCE` 指定；显式配置时只使用该源，文件缺失即跳过不 fallback；未配置则探测 `D:/Data/projects/platform-orchestrator/feature_gates.yaml` 与 `~/feature_gates.yaml`）。修复「功能开关页面 404 → 加载失败」：原依赖手动 `scripts/seed.py`，新库为空导致项目缺失。
- 种子目录（`PRESET_CATALOG`）**由 Multi-Publish 桌面端代码事实生成**（见 12A.8 数据来源）：覆盖桌面端全部 53 个预设；`base_url`=适配器默认端点/桌面预设值、`models`/`capabilities`/`capability_models`=桌面 `model-provider-seeds`、`rate_per_minute`=桌面 `governor-provider-limits` 静态表；`limit_per_5h` **无代码事实 → 不预填（留空由运营填写）**；`models_url` 仅白名单预设（`OFFICIAL_MODELS_URLS`：官方 Models 列表端点，响应含 id/name/model_id 且 ≤512KB）预置官方端点、可编辑，其余留空；空值回填仅限 base_url 仍为官方默认值的种子行；`INSERT OR IGNORE` 不覆盖用户修改。

### 12A.6 前端交互与提示文案

- 编辑/新增弹窗字段顺序：预设 ID → 名称 → 类别 → 接口 Base URL（端口URL）→ 获取模型ID URL → 模型列表 → 默认模型 ID（下拉 + 获取模型按钮）→ 每分钟连接次数 → 5小时限额次数 → 多模态开关 → 前端显示 →（多模态时）能力配置 + 7 能力文档 URL → 通用文档链接。
- 提示文案：
  - 每分钟连接次数：「留空表示未配置，前端使用默认限流；正整数」
  - 5小时限额次数：「留空表示未配置；5 小时内请求次数上限（正整数）」
  - 获取模型ID URL placeholder：「允许为空，用于「获取模型」按钮」
  - 默认模型 ID placeholder：「从模型列表中选择（允许为空）」
- 列表新增「限流（每分钟/5小时）」列，展示 `rate_per_minute / limit_per_5h`（未配置显示 `-`）。

### 12A.7 验收标准

1. 保存合法 `models_url`/`rate_per_minute`/`limit_per_5h` 成功且响应回显；全留空成功且字段为 null/空。
2. 非法 URL（`ftp://`）、非法数字（`-1`/`1.5`/`'abc'`/超上限）、默认模型不在模型列表、未知能力文档键 → 均 400 且错误信息含字段名。
3. 默认模型 ID 以下拉选择；点击「获取模型」成功回填模型列表与默认模型，失败不改动已有数据。
4. fetch-models 对私网解析/重定向/非 JSON/超时分别返回 400，且普通用户 403。
5. 多模态编辑弹窗显示 7 个固定能力文档 URL 输入框，保存后 `capability_doc_links` 对应键为单元素数组。
6. 预设目录与桌面端代码事实一致：default_model ∈ models、rate_per_minute 与桌面静态表一致、limit_per_5h 为空；models_url 仅白名单预设预置官方端点（与 base_url 推导一致），其余为空（防估算污染）。

---

## 12A.9 自包含管理员登录（2026-08-10，替代 orchestrator 认证依赖）

运营后台为**内部管理工具**（非前端用户使用），不接 Logto 等外部 IdP，也不依赖 platform-orchestrator：

| 项 | 契约 |
|----|------|
| 登录端点 | `POST /api/auth/login`（本地），body `{username, password}`；成功返回 `{token, username, role:"admin"}` |
| 凭据配置 | `OPS_ADMIN_USERNAME` / `OPS_ADMIN_PASSWORD` 环境变量；启动时若 `admins` 表为空则创建（PBKDF2-SHA256 哈希存储） |
| fail-closed | 未配置管理员且表为空 → 登录返回 503「未配置管理员账号，请设置 OPS_ADMIN_USERNAME/OPS_ADMIN_PASSWORD」；**无默认口令** |
| JWT | HS256，`OPS_JWT_SECRET` 签发，payload `{sub, username, role:"admin", exp}`，8h 过期；现有验证中间件不变 |
| 密码安全 | PBKDF2-SHA256、随机 16B salt、200000 迭代、`hmac.compare_digest` 常量时间比较；存储格式 `pbkdf2_sha256$iterations$salt_hex$hash_hex`（字面 `$` 分隔） |
| 限流 | 内存计数（username+IP），5 次失败锁定 60s → 429「尝试次数过多，请稍后再试」；重启/多实例重置（单机内部后台可接受） |
| 密码错误 | 统一 401「用户名或密码错误」，不区分用户是否存在 |
| 当前用户 | `GET /api/auth/me`（受保护） |
| 前端 | Vite `/api/auth` 代理 target → `localhost:8010`（不再指向 orchestrator:8000）；登录页/鉴权 store 路径不变 |
| 迁移影响 | 签发方改为本地；历史由不同 secret 签发的会话 token 将失效，需重新登录 |

## 12A.8 预设目录数据来源（2026-08-10 补充）

运营后台预设目录（`PRESET_CATALOG`）的「已确定」数据项全部来自 Multi-Publish 桌面端代码事实，禁止编造：

| 数据项 | 来源（代码事实） | 说明 |
|--------|------------------|------|
| `base_url`（端口URL） | 适配器 `DEFAULT_BASE_URL`（`apps/desktop/electron/services/adapters/*.js`）；OpenAI 兼容类读 provider 配置，用桌面预设值 | 如 Anthropic `https://api.anthropic.com`（无 `/v1`）、MiniMax `https://api.minimaxi.com/v1`、本地类用适配器默认（localhost:8080/7860/5000/8188 等） |
| `models` | 桌面 `model-provider-seeds.js` `PRESET_PROVIDERS[].models` | 预设可用的模型 ID 白名单 |
| `default_model` | 已知默认值且必须 ∈ models（校验拒绝） | MiniMax 多模态 `MiniMax-M2.7` 等 |
| `capabilities` / `capability_models` | 桌面多模态预设声明（minimax-multimodal） | llm/tts/image/video → 对应模型 |
| `rate_per_minute`（每分钟连接次数） | 桌面 `governor-provider-limits.js` `PROVIDER_LIMITS[].rpm` | 代码常量（如 openai 120、video 类 6）；**与静态表一致，非估算** |
| `limit_per_5h`（5小时限额次数） | **无代码事实** → 空（null） | 由运营在模型设置/运营后台填写；桌面端 `ApiUsageGovernor` 按 provider 级 5h 请求窗口使用 |
| `models_url`（获取模型ID URL） | 官方 Models 列表端点白名单（`OFFICIAL_MODELS_URLS`，2026-08-27 扩展至 24 项；端点响应含 `id`（OpenAI 兼容）/`model_id`（ElevenLabs）/`name`（Gemini `models/xxx`、Ollama tags）且 ≤512KB；排除豆包 Ark `ep-*` 推理接入点、OpenRouter 全量响应实测 ~687KB 超 512KB 上限、多模态 minimax-multimodal 覆盖能力映射） | 白名单预设预置官方端点、可编辑；其余留空。fetch 不带鉴权，直连官方端点需运营另行准备；同一厂商多预设（openai/openai-tts/dall-e/whisper、gemini/imagen/veo 等）共用供应商全量 Models 端点，「获取模型」会以供应商全量列表覆盖 `models`，能力默认模型若不在新列表会被清空 |

- 变更守则：任何桌面适配器端点/模型/限流常量变更，须同步更新本目录并跑 12A.7-6 一致性测试（`test_catalog_facts_consistency`）。
- `models_url` 白名单变更守则：回填仅补空值、端点迁移不自动扩散到存量行——官方端点变更须同步清理存量 `models_url`；新增供应商入白名单前须按官方契约确认：Models 列表响应含 `id`（OpenAI 兼容）或 `model_id`（ElevenLabs）或 `name`（Gemini `models/xxx`、Ollama tags，解析器自动适配）、响应体 ≤ fetch 512KB 上限、且非多模态能力映射预设（Ark `ep-*`、OpenRouter 超限、minimax-multimodal 不入白名单）；同一厂商按模态拆分预设共用全量端点时须接受「获取模型」覆盖该类别模型列表的语义。

## 12A.10 模型目录只读同步端点（catalog，桌面端运行时下发）（2026-08-10 新增）

> 桌面端通过只读目录端点拉取运营配置（限流/模型/能力），实现「运营后台填写 → 桌面端运行时自动下发」，前端限流/模型字段改为只读。详见 Multi-Publish PRD §7.4.5。

### 12A.10.1 端点契约

| 项 | 契约 |
|----|------|
| 方法/路径 | `GET /api/v1/model-presets/catalog`（**在 `/{preset_id}` 动态路由之前注册**，避免被吞） |
| 鉴权 | `X-Catalog-Key` 请求头 == `OPS_CATALOG_API_KEY`（`hmac.compare_digest` 常量时间比较），**无需登录** |
| 未配置 | `OPS_CATALOG_API_KEY` 未配置（空）→ **404**（不暴露端点存在性，fail-closed） |
| Key 错误/缺失 | → **401**「目录同步 Key 无效」 |
| 成功响应 | `{ "items": [...], "count": N, "synced_at": "ISO8601Z" }` |
| 数据范围 | 仅 `is_visible=1` 预设，按 `is_multimodal DESC, category, name` 排序 |
| item 字段 | `id` / `name` / `category` / `base_url` / `models` / `default_model` / `rate_per_minute` / `limit_per_5h` / `is_multimodal` / `capabilities` / `capability_models` / `updated_at`；**不含** api_key、密钥、审计等敏感字段 |
| 数据自洽 | `default_model` 非空必须 ∈ `models`；`rate_per_minute`/`limit_per_5h` 为 `null` 或正整数（`[1,100000]`/`[1,10000000]` 已由写入校验保证） |

### 12A.10.2 桌面端消费契约

| 项 | 契约 |
|----|------|
| 服务 | 主进程 `OpsCenterSync`（`apps/desktop/electron/services/ops-center-sync.js`） |
| 配置存储 | settings `opsCenterSync`：`{url, apiKeyEnc, autoSync, lastSyncedAt}`；API Key 经 safeStorage 加密 base64，`getConfig()` 不返回明文 |
| URL 校验 | 必须 http(s)；非本机回环强制 https；拒绝 URL 内嵌凭据 |
| 拉取 | `{url}/api/v1/model-presets/catalog`；`X-Catalog-Key` 头；禁重定向；10s 超时；≤1MB；JSON 必须含 `items` 数组 |
| 错误映射 | 401/403→Key 无效；404→未启用目录同步；超时→同步请求超时（10 秒）；连接失败→无法连接 Ops Center；其余→HTTP {status} |
| 写入 | `ModelProviderManager.applyCatalog`：合并限流/模型/能力；不覆盖 api_key/enabled/is_default/base_url；缺失行插入（is_preset=1/enabled=0）；本地独有行不清除；限流 null/非法值清除本地并回退默认 |
| Governor | 写库后 `_applyGovernorLimits()`：rate_per_minute→setProviderLimits、limit_per_5h→setProviderTokenWindows(5h) |
| 前端 | 模型设置页「运营后台同步」卡片（地址/Key/自动同步/立即同步/上次同步时间/状态文案）；限流与预设模型列表只读 |

### 12A.10.3 测试

- `ops-center/backend/tests/test_model_catalog_api.py`：正确 Key 返回全部可见预设（≥50 项、minimax-multimodal 命中、default∈models、限流正整数或空）；错误/缺失 Key 401；未配置 404；隐藏项排除。
- 桌面端：`ops-center-sync.test.js`（URL 校验/加密存储/错误映射/超时/大小/JSON/结构/成功落盘/自动同步）、`model-provider-apply-catalog.test.js`（合并/不覆盖/插入/不清除/清空回退/governor 重应用）、`ipc-handlers/ops-center-sync.test.js`、`useOpsCenterSync.test.js`。

### 12A.10.4 未配置时的降级链路（桌面端，2026-08-11 补充）

运营后台未填写 `rate_per_minute` / `limit_per_5h`（null）时，桌面端按以下顺序降级，不报错、不阻塞：

1. **桌面数据库种子默认值**：`model-provider-seeds.js` `PRESET_RATE_LIMITS` 回填 `config.rate_per_minute`（`_syncPresetLimits` diff-merge 仅填缺失键）；数值为代码事实，与桌面静态表一致；
2. **静态表**：`governor-provider-limits.js` `PROVIDER_LIMITS`（已知 provider 的 rpm / maxConcurrent / cooldownMs / retry429）；
3. **类别默认**：`api-usage-governor.js` `DEFAULT_LIMITS`（llm 30/2、tts 10/2、image 10/2、video 4/1、audio 10/2、default 20/2）。

- 运营**显式清空**（null/''/0/布尔）→ `applyCatalog` 删除桌面本地 config 值 → 回退 2/3；`limit_per_5h` 清空 → 清除 provider 级 5h 请求窗口。
- 桌面端排队时序预算：并发队列 30s、RPM 时间槽 180s、冷却 45s；超限返回明确限流文案，429 自适应 ×0.75 下调、成功 +0.05 恢复。详见 Multi-Publish PRD §7.1.8.1 / §7.4.4.3。

## 12A.11 运行时运营策略：公告 / 版本发布 / 内容安全（2026-08-10 新增）

> 运营后台集中维护公告、版本发布策略、内容安全敏感词库；桌面端经 `GET /api/v1/runtime/bootstrap`（与模型目录同鉴权）一次性拉取应用。详见 Multi-Publish PRD §7.4.6。

### 12A.11.1 数据模型与管理端点

| 资源 | 端点（管理，require_admin） | 字段/校验 |
|------|---------------------------|----------|
| 公告 | `GET/POST /api/v1/announcements`、`PUT/DELETE /api/v1/announcements/{id}` | title/content 必填；severity ∈ info/warning/maintenance；时间 ISO 且 until ≥ from；sort_order/enabled |
| 版本发布策略 | `GET/PUT /api/v1/update-policy`（单条 upsert） | 版本号 `x.y.z`（可空）；force ≥ min；gray_ratio 0-100；enabled/note |
| 内容安全策略 | `GET/PUT /api/v1/content-policy`（单条 upsert） | word_list JSON 去重 ≤5000、单项 ≤100；replacement ≤16；enabled |

校验失败返回 400 + 中文字段提示；不合法值拒绝保存。审计沿用 ConfigAuditLog 模式（操作方为 admin）。

### 12A.11.2 运行时只读端点

`GET /api/v1/runtime/bootstrap`：`X-Catalog-Key` 鉴权（`OPS_CATALOG_API_KEY`，常量时间比较；未配置→404；错→401）。返回：
- `announcements`：enabled=1 且在 `[active_from, active_until]` 窗口内的公告（按 sort_order），仅 title/content/severity/窗口；
- `update_policy` / `content_policy`：单条策略对象或 null；
- `synced_at`。

### 12A.11.3 桌面端消费

- `OpsCenterSync.syncNow()` 目录同步后 best-effort 拉取并 `applyRuntime`（失败仅 warn）；
- 公告 → App 顶部横幅（maintenance 常驻不可关闭，info/warning 可关闭）；
- 内容安全 → 重建 `SensitiveFilter`（内置 + 远程词，`sensitive:check/replace` 生效）；
- 版本发布 → auto-updater `applyPolicy`（force 强制 / gray 灰度 / min 提示）。

### 12A.11.4 测试

- ops-center pytest：`test_runtime_policy_api.py` 4 用例（公告 CRUD+校验、版本策略 upsert+校验、内容安全 upsert+校验、bootstrap 鉴权+活动过滤）。
- 桌面端 vitest：ops-center-sync 运行时 4 用例（applyRuntime/敏感词重建/策略消费者/syncNow runtime）、auto-updater 策略 5 用例、sensitive 远程过滤器 2 用例、useOpsCenterRuntime 3 用例、IPC runtime 通道。

## 12A.12 模型调用用量上报与看板（2026-08-10 新增，P0 第二批）

> 桌面端 `model_provider_logs` 脱敏聚合后上报运营后台；看板支撑限流/采购/容量决策。详见 Multi-Publish PRD §7.4.7。

### 12A.12.1 上报端点

`POST /api/v1/usage/ingest`（X-Catalog-Key 鉴权同目录端点，无需登录）：body `{ items: [...], synced_at }`，items 含 usage_date/client_id/provider_id/category/action/calls/ok_count/fail_count/ratelimit_count/latency_ms/tokens_in/tokens_out/cost/latency_buckets。校验：usage_date YYYY-MM-DD、数值非负、provider/action 非空、单次 ≤500 条 → 400。按 `(usage_date, client_id, provider_id, action)` upsert 累加（幂等）。

### 12A.12.2 汇总查询

`GET /api/v1/usage/summary?days=N`（admin，默认 30/上限 90）：totals（调用/成功率/429/平均耗时/成本/活跃服务商）、by_date、by_provider（调用降序）、by_action。

### 12A.12.3 桌面端上报

- `UsageReporter`：读 `model_provider_logs id > 水印`（settings `opsCenterUsageReport.lastId`），按日期+provider+action 聚合，POST ingest；成功推进水印，失败保留重试；启动 5s 首报 + 30min 周期；未配置静默跳过。
- 脱敏：不上报 error_message/model 原文；429 识别（状态/文案含 rate limit/限流/429）。
- 修复：`addProviderLog` INSERT 补 `created_at=datetime('now')`。

### 12A.12.4 前端

「模型用量」页：7/30/90 天切换、汇总卡片、每日趋势 CSS 柱状图、按服务商/按动作表格、空态提示。

### 12A.12.5 测试

- ops-center pytest：`test_usage_api.py` 3 用例（鉴权+幂等累加、输入校验、汇总分组+权限）。
- 桌面端 vitest：`usage-reporter.test.js` 6 用例（分类/静默/无数据/聚合上报+水印+脱敏/失败重试/定时）。

## 12A.13 官方 Key 池配额/成本概览 + 许可证管理（2026-08-10 新增，P0/P1 第三批）

> P0-1 官方 Key 池增强（配额/告警/成本）与 P1-6 许可证管理（签发/吊销/列表）运营后台管理面。桌面端消费（官方 Key 回退路由、许可证服务端验签）需商业模式确认后另行接入，本 change 不触碰桌面端 entitlement 现有合同。

### 12A.13.1 官方 Key 池增强

- `official_keys` 新增列（`ensure_official_key_columns` 幂等迁移）：`rate_per_minute`（每分钟配额，正整数或空）、`daily_limit`（每日上限，正整数或空）、`alert_threshold_cost`（成本告警阈值 ¥，≥0 或空）、`note`。
- upsert 校验：布尔/小数/负数拒绝（400 + 字段提示）。
- `GET /api/v1/secrets/summary`（admin）：总数/活跃/30 天内到期/已过期、近 30 天成本（复用 `model_usage_daily` 按 provider 聚合）、达告警阈值 Key 列表。
- 前端 Key 管理页：新增配额/上限/告警/备注字段 + 池概览卡片。

### 12A.13.2 许可证管理

- `licenses` 表：`license_key`（唯一，自动生成 `MP-XXXX-XXXX-XXXX-XXXX`，去易混淆字符）、`plan`（free/trial/pro）、`device_limit`（≥1）、`expires_at`（ISO 或空=永久）、`status`（active/disabled；expired 由查询派生）、`note`。
- 端点（require_admin）：`GET/POST /api/v1/licenses`、`PUT/DELETE /api/v1/licenses/{id}`。
- 前端「许可证管理」页：签发（展示生成的 Key 一次）、列表（状态标签/过期高亮）、禁用/启用/删除。

### 12A.13.3 测试

- `test_keypool_license_api.py` 3 用例：Key 新字段校验 + 池概览（非 admin 403）、许可证 CRUD + 校验 + 权限、Key 唯一性与过期派生。

## 12A.14 云服务健康巡检（2026-08-11 新增，P1 其余）

> 运营后台一键诊断云服务健康（业务 API / Logto / 存储 / 自定义目标），复用 production-smoke 的探测口径，只读不修改服务状态。

### 12A.14.0 前端菜单入口

- 运营后台侧边栏以「调用失败警告」作为创作诊断页面入口，路由保持 `/diagnostics`。
- 页面展示桌面端脱敏上报的失败率、失败样本、根因分布、阈值告警与处置建议。

### 12A.14.1 探针

| 探针 | 目标 | 判定 |
|------|------|------|
| ops-center 自身 | 进程存活 | ok |
| 业务 API | `OPS_HEALTH_API_URL` → `/api/v1/health` + `/api/v1/ready` | 均 2xx → ok |
| Logto | `OPS_HEALTH_LOGTO_URL` → OIDC discovery（`/oidc/.well-known/openid-configuration`） | 2xx 且含 issuer → ok |
| 存储可写 | config_output_dir / db 目录 | 临时写删成功 → ok |
| 自定义目标 | `OPS_HEALTH_TARGETS` JSON `[{name,url}]` | 2xx → ok |

- 单项 ≤5s 超时；URL 校验（http(s)，非本机回环强制 https）；未配置 → skipped（不计失败）。
- `GET /api/v1/system/health`（admin）：并发探测，返回 `{overall: ok|error, checks:[{name,status,ok,latency_ms,detail}], generated_at}`。

### 12A.14.2 前端

「系统健康」页：一键巡检按钮 + 总体徽章 + 结果表（服务/状态/耗时/详情）；首次进入自动巡检。

### 12A.14.3 测试

`test_health_api.py` 2 用例：未配置跳过 + 权限、自定义目标失败 + 非法目标忽略。


## 12A.16 桌面端功能开关运行时下发（2026-08-11 新增，P0-1）

> 桌面端功能开关（key → typed value）由运营后台统一维护，随 `runtime/bootstrap` 下发；桌面端同步后即时生效。首个真实用例：4K 输出能力开关 `videoCreation.maxOutputResolution`（PRD 7.1.20）。

### 12A.16.1 数据模型与校验

`feature_flags` 表：

| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| key | str PK | 必填、`^[A-Za-z0-9_.-]{1,128}$` | 开关标识（如 videoCreation.maxOutputResolution） |
| value_type | str | 枚举 string/boolean/number，默认 string | 值类型 |
| value | str | 按类型可解析：boolean ∈ true/false/1/0；number 可解析数字 | 存储字符串，下发时转 typed value |
| description | str | ≤200 | 用途说明 |
| enabled | bool | 0/1 | 停用后不下发 |
| updated_at / updated_by | str | 自动 | 审计 |

- key 拒绝 `__proto__`/`constructor`/`prototype`；value ≤512。
- number value 统一 float 解析并校验有限（含科学计数法，前后端一致）。
- POST 重复 key → 409；PUT / DELETE 不存在 → 404；PUT 部分更新（null 不修改、body 中 key 被忽略不可变）；并发冲突 IntegrityError → 409；种子并发冲突幂等忽略。
- 种子：`videoCreation.maxOutputResolution` = '1080p'（默认禁止 4K），已存在即跳过，不覆盖运营修改。

### 12A.16.2 端点与运行时下发

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/feature-flags | 列表（登录可读，含 typed_value） |
| POST | /api/v1/feature-flags | 新增（admin） |
| PUT | /api/v1/feature-flags/{key} | 更新（admin，部分更新） |
| DELETE | /api/v1/feature-flags/{key} | 删除（admin） |
| GET | /api/v1/runtime/bootstrap | 增加 `feature_flags` = `{key: typed_value}`（enabled=1，同 X-Catalog-Key 鉴权） |

### 12A.16.3 桌面端消费

| 项 | 要求 |
|----|------|
| OpsCenterSync | `applyRuntime` 应用 `feature_flags`（仅接受字符串/布尔/数字值，结构非法或 >100 项 → 空对象 fail-closed）；持久化 opsCenterRuntime，重启恢复；`getFeatureFlag(key)` 供主进程/引擎读取；`getRuntimeState()` 暴露 featureFlags（渲染端经现有 `opsCenterSyncRuntime` IPC） |
| 4K 读取优先级 | 环境变量 `MAX_OUTPUT_RESOLUTION` → 运营功能开关 `videoCreation.maxOutputResolution`（phase1 `setFeatureFlagProvider` 注入）→ store 设置 → 默认 1080p（fail-closed） |
| 引擎 | `Story2VideoComposeEngine` 支持 `getMaxOutputResolution` 惰性读取：compose/renderSegment 能力校验时取当前值，构造期静态值兜底 |
| 渲染端 | CreateView `loadMaxOutputResolution`：runtime featureFlags → store → 默认 |

### 12A.16.4 前端「桌面端功能开关」页

- 列表：Key / 类型 tag / 当前值（typed 展示，空显示「（空）」）/ 描述 / 启用开关 / 操作（编辑、删除）；顶部「全部/已启用/已停用」筛选 + 「新增开关」。
- 编辑弹窗：Key（编辑禁用）/ 值类型下拉 / 值输入（布尔提示 true/false、数字提示数字、字符串提示如 1080p/4k）/ 描述 / 启用下发。
- 校验提示：Key 字符集、布尔值枚举、数字可解析；保存失败显示后端 detail。
- 顶部说明文案注明内置 4K 开关用途与 fail-closed 语义。

### 12A.16.5 验收标准

① 首次启动 4K 开关种子存在；② 非法 key/value_type/value → 400；③ POST 重复 → 409、PUT/DELETE 不存在 → 404；④ bootstrap 返回 enabled 开关 typed value；⑤ 桌面端 applyRuntime 应用/持久化/重启恢复；非法结构 → 空对象；⑥ 引擎惰性读取：静态 1080p + 动态 4k → 放行 4K，动态 1080p → 拒绝（fail-closed）；⑦ 未配置同步的桌面端用本地默认（1080p）。
## 12A.15 平台发布元数据管理（2026-08-11 新增，P1 其余）

> 平台发布元数据（标题/内容上限、内容类型分类、是否支持 API、临时下线）从桌面端 `config/platforms.yaml` 迁移到运营后台维护，随运行时 bootstrap 下发；桌面端启动/同步时覆盖同名平台字段，不改写 yaml。

### 12A.15.1 数据模型与校验

`platform_defs` 表：

| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| id | str PK | 必填、≤64 | 平台 id（如 wechat_mp） |
| name | str | 必填、≤100 | 平台名称 |
| category | str | ≤20，默认「中文」 | 中文/海外分组 |
| content_category | str | 枚举 VIDEO/IMAGE_TEXT/MIXED，默认 MIXED | 内容类型分类（PRD F9） |
| type | str | ≤20，默认 mixed | article/mixed 兼容字段 |
| max_title | int | 正整数或空（拒绝布尔/小数/负数） | 标题上限 |
| max_content | int | 正整数或空（同上） | 内容上限 |
| has_api | bool | 0/1 | 是否支持 API 发布 |
| enabled | bool | 0/1 | 临时下线开关（关闭后不下发） |
| note | str | ≤200 | 运营备注 |
| updated_at | str | 自动 | 更新时间 |

- id 字符集 `^[a-z0-9_-]{1,64}$`；category ∈ 中文/海外；type ∈ article/mixed；has_api/enabled 仅接受 true/false/1/0（其余 400）。
- 创建（POST）走全量校验，重复 id → 409；更新（PUT）为**部分更新**语义：与已存在记录合并后做全量校验，null 视为不修改该字段，路径 id 优先，空串清空上限，不存在 → 404。
- 删除为**软删除**（deleted_at + enabled=0）：已删除平台不再列出/下发；种子化遇到已存在记录（含软删）即跳过，**已删种子不复活**；软删后同一 id 可重建（恢复）。
- 种子：对齐 `config/platforms.yaml` 关键平台（wechat_mp/weibo/douyin/bilibili/toutiao/xiaohongshu/zhihu/kuaishou/youtube/tiktok/twitter/facebook），已存在即跳过。

### 12A.15.2 管理端点（admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/platform-defs | 列表（登录用户可读） |
| POST | /api/v1/platform-defs | 新增（admin；校验失败 400） |
| PUT | /api/v1/platform-defs/{id} | 更新（admin；部分更新） |
| DELETE | /api/v1/platform-defs/{id} | 删除（admin；不存在 404） |

### 12A.15.3 运行时下发

- `GET /api/v1/runtime/bootstrap` 增加 `platform_defs`（enabled=1 项，含 id/name/category/content_category/max_title/max_content/has_api），与公告/版本发布/内容安全同链路、同 `X-Catalog-Key` 鉴权。
- 桌面端 `PlatformConfig.applyRemote(defs)`：按 id 覆盖已存在平台的远程字段（仅覆盖远程出现的键）；本地独有平台保留；远程新增平台不自动引入（fail-closed，避免出现无适配器的平台）；**不改写 yaml**；cover_size 字符串同步重建解析尺寸。
- `OpsCenterSync.applyRuntime`：注入 platformConfig 时应用 `platform_defs`（`setPlatformConfig` 由 phase1 接线）；未注入跳过，不影响其他运行时策略。

### 12A.15.4 前端「平台元数据」页

- 列表：ID / 名称 / 类别（中文|海外 tag）/ 内容类型（视频|图文|混合 tag）/ 标题上限 / 内容上限 / 支持 API / 下发开关 / 操作（编辑、删除）；顶部「中文/海外/全部」筛选 + 「新增平台」按钮。
- 编辑弹窗：平台 ID（编辑时禁用）/ 名称（必填）/ 类别 / 内容类型（必填下拉）/ 类型 / 标题上限 / 内容上限（正整数或留空）/ 支持 API / 启用下发（关闭提示「桌面端将不再下发该平台」）/ 备注。
- 下发开关即时保存（部分更新 enabled），成功提示「已启用，将随下次同步下发给桌面端」。

### 12A.15.5 验收标准

① 首次启动种子 12 平台且可编辑；② 非法 content_category / 负数或小数上限 → 400；③ PUT 仅传部分字段可更新（enabled 临时下线）；④ bootstrap 仅返回 enabled=1 项；⑤ 桌面端 applyRemote 覆盖同名平台、本地独有保留、远程新增不引入、yaml 不被改写；⑥ 未注入 platformConfig 时跳过应用不影响其他策略；⑦ 非 admin 写 403、读 200。


## 12A.18 发布数据看板（2026-08-11 新增，P1-3）

> 桌面端把发布指标脱敏聚合上报运营后台，运营看板展示各平台产粮/失败情况（发布总数/成功/失败/成功率/平台排行/每日趋势）。仅计数，不含标题/正文/账号等敏感内容。

### 12A.18.1 数据模型与校验

`publish_metrics_daily`：usage_date（YYYY-MM-DD）/ client_id（设备稳定哈希，脱敏）/ platform / publish_count / ok_count / fail_count / updated_at；唯一约束 (usage_date, client_id, platform)，同桶 upsert 累加（幂等由客户端水印防重）。

| 校验 | 规则 |
|------|------|
| date | `YYYY-MM-DD` |
| platform | `^[A-Za-z0-9_.-]{1,64}$` |
| 计数 | 非负整数；publish_count ≥ ok+fail |
| items | ≤500 |

### 12A.18.2 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/publish/ingest | 上报（X-Catalog-Key；校验失败 400） |
| GET | /api/v1/publish/summary?days=N | 看板（admin，默认 30，上限 90）：totals + by_date + by_platform（含成功率） |

### 12A.18.3 桌面端上报（PublishReporter）

- 聚合 publish-history 记录按 日期+平台 分桶；status success → ok、含 fail/error → fail、监控状态（visible 等）不计（避免同一次发布重复计数）。
- 水印 = 最后上报记录 timestamp（ISO 字典序）；成功推进，失败保留下次重试；启动 5s 首报 + 30min 周期；未配置 URL/Key 静默跳过。
- 仅上报计数，不含标题/正文/账号/平台凭证。

### 12A.18.4 前端「发布数据」页

- 7/30/90 天切换 + 6 张汇总卡片（发布总数/成功/失败/成功率/平台数/设备数）+ 按平台表（发布/成功/失败/成功率）+ 每日趋势 CSS 柱状图（成功绿/失败红）+ 空态提示「尚未收到发布数据上报（桌面端需配置运营后台同步）」；非 admin 403 提示。

### 12A.18.5 验收标准

① 上报校验：非法日期/平台/负数/publish<ok+fail → 400；② 同桶累加正确；③ 未配置 Key 404、Key 错误 401；④ summary 非 admin 403；⑤ 按日期/平台聚合、成功率=ok/publish；⑥ 桌面端分桶正确（监控状态不计数）、水印推进/失败保留、未配置静默；⑦ 不上报敏感内容。
## 12A.17 官方内容模板库下发（2026-08-11 新增，P0-2）

> 官方内容模板库由运营后台统一维护，随 `runtime/bootstrap` 下发；桌面端同步时合并进本地模板（内置标记 builtin），用户自建模板保留。

### 12A.17.1 数据模型与校验

`content_templates` 表：

| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| id | str PK | 必填、`^[a-z0-9_-]{1,64}$` | 模板 id（如 preset-weekly） |
| name | str | 必填、≤100 | 模板名称 |
| category | str | ≤40 | report/marketing/tutorial/event/daily 等 |
| title | str | ≤200 | 模板标题 |
| content | text | ≤20000 | Markdown 正文 |
| platforms | JSON | 非空字符串数组 ≤50 | 适用平台 |
| tags | JSON | 非空字符串数组 ≤50 | 标签 |
| enabled | bool | 0/1 | 停用后不下发 |
| sort_order | int | 非负整数 | 排序 |
| deleted_at | str | 软删 | 软删不复活，可重建 |

- POST 重复 → 409；PUT 部分更新（null 不修改、body 中 id 忽略）+ 404；DELETE 软删 + 404；IntegrityError 兜底 409。
- 种子对齐桌面端 TemplateManager.getPresets() 5 个（preset-weekly/product/tutorial/event/daily），已存在（含软删）即跳过。

### 12A.17.2 端点与运行时下发

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/content-templates | 列表（登录可读） |
| POST | /api/v1/content-templates | 新增（admin） |
| PUT / DELETE | /api/v1/content-templates/{id} | 更新/软删（admin） |
| GET | /api/v1/runtime/bootstrap | 增加 `content_templates`（enabled=1 未软删，sort_order 排序，builtin=true） |

### 12A.17.3 桌面端消费

| 项 | 要求 |
|----|------|
| TemplateManager.applyRemote(templates) | 按 id upsert；官方字段白名单；新增标记 builtin=true；用户自建模板保留；数组 >200 fail-closed 返回 0；变更后 save() 持久化 |
| OpsCenterSync | setTemplateManager 注入（phase1 接线）；applyRuntime 应用 content_templates（数组 + 已注入时），异常仅 warn |

### 12A.17.4 前端「内容模板库」页

- 列表：ID / 名称 / 分类 tag / 标题 / 适用平台 tags / 内置标记 / 下发开关 / 操作（编辑、删除）；分类筛选 + 新增。
- 编辑弹窗：ID（编辑禁用）/ 名称（必填）/ 分类下拉 / 标题 / Markdown 正文（≤20000）/ 适用平台（逗号分隔）/ 标签（逗号分隔）/ 排序 / 启用下发。
- 顶部说明文案注明内置种子与用户模板不受影响。

### 12A.17.5 验收标准

① 首次启动种子 5 个内置模板；② 非法 id/name/platforms/sort/content → 400；③ POST 重复 409、PUT/DELETE 不存在 404；④ bootstrap 返回 enabled 模板（builtin=true）；⑤ 软删种子重启不复活、可重建；⑥ 桌面端 applyRemote 按 id 覆盖/新增/保留用户模板/上限 fail-closed；⑦ 未注入 templateManager 跳过不影响其他策略。


## 12A.20 关键词监测目录下发（2026-08-11 新增，P1-5）

> 运营后台维护关键词监测目录（关键词/飙升阈值/轮询间隔），随 `runtime/bootstrap` 下发；桌面端同步后按目录监测热度，异常飙升触发通知；用户自建监测词不受影响。

### 12A.20.1 数据模型与校验

`keyword_watchlist`：id（代理主键）/ keyword（唯一，2-100 字）/ category（≤40）/ threshold（≥1，飙升倍数）/ interval_minutes（10-10080 整数分钟）/ enabled / sort_order / deleted_at（软删，不复活，可重建）/ updated_at / updated_by。

- POST 重复 keyword → 400；PUT 部分更新 + 404；DELETE 软删 + 404。

### 12A.20.2 端点与运行时下发

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/keyword-watchlist | 列表（登录可读） |
| POST | /api/v1/keyword-watchlist | 新增（admin） |
| PUT / DELETE | /api/v1/keyword-watchlist/{id} | 更新/软删（admin） |
| GET | /api/v1/runtime/bootstrap | 增加 `keyword_watchlist`（enabled=1 未软删，sort_order 排序） |

### 12A.20.3 桌面端消费

| 项 | 要求 |
|----|------|
| KeywordMonitor.applyRemoteWatchlist(entries) | 按 keyword upsert：已存在更新 interval/threshold 并标记 source=remote（重建定时器）；不存在新增（立即首查+定时轮询）；缺席即停止远程监测；用户/恢复条目保留；MAX_KEYWORDS(20) 上限 skip+warn |
| OpsCenterSync | setKeywordMonitor 注入（phase1 接线）；applyRuntime 应用 keyword_watchlist（数组+已注入时，异常仅 warn） |

### 12A.20.4 前端「关键词监测」页

- 列表：关键词 / 分类 tag / 飙升阈值 / 轮询间隔 / 启用开关 / 操作（编辑、删除）；状态筛选 + 新增。
- 编辑弹窗：关键词（编辑禁用，2-100 字）/ 分类 / 飙升阈值（≥1）/ 轮询间隔（10-10080 分钟）/ 启用下发。
- 顶部说明：用户自建监测词不受影响；关闭后桌面端停止监测该词。

### 12A.20.5 验收标准

① 校验：keyword/threshold/interval 非法 → 400；② POST 重复 400、PUT/DELETE 404；③ 软删不复活、可重建；④ bootstrap 仅 enabled 条目；⑤ 桌面端 applyRemoteWatchlist 新增/更新/缺席停止/用户保留；⑥ 未注入跳过不影响其他策略；⑦ 非 admin 写 403。
## 12A.19 兑换码签发/吊销/查询（2026-08-11 新增，P1-4）

> 运营后台批量签发 Pro 激活码，格式与桌面端 `redemption-codes.js` 完全兼容（HMAC-SHA256，`MP-XXXX-XXXX-SIG`）。共享密钥：`OPS_REDEMPTION_SECRET` 必须等于桌面端 `REDEMPTION_SECRET`，否则桌面端无法验证。

### 12A.19.1 数据模型与签发算法

`redemption_codes`：id（代理主键，操作引用）/ code（唯一）/ plan（free|trial|pro）/ batch_id / status（active|revoked）/ expires_at（ISO 或空）/ note（≤200）/ created_at / updated_by。列表始终掩码 `MP-****-****-SIG`，操作按 id。

签发算法（与桌面端逐字符一致）：
- 随机段字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去 I/O/0/1），4 字符 ×2；
- payload = `MP-RAND-RAND`；签名 = `HMAC-SHA256(payload, secret).hexdigest().upper()[:4]`；
- code = `payload-SIG`。

### 12A.19.2 端点（均 admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/redemption-codes/batch | 批量签发（count 1-200、plan 枚举、expires_at ISO、note ≤200；未配置 OPS_REDEMPTION_SECRET → 400 fail-closed） |
| GET | /api/v1/redemption-codes?plan=&status=&limit=&offset= | 列表（掩码） |
| PUT | /api/v1/redemption-codes/{id}/revoke | 吊销（404 兜底） |
| DELETE | /api/v1/redemption-codes/{id} | 删除（404 兜底） |

### 12A.19.3 前端「兑换码」页

- 批量签发弹窗：数量（1-200）/ 套餐下拉（free/trial/pro）/ 过期时间（ISO）/ 备注。
- 签发成功：批次号 + 掩码列表（提示「列表展示为掩码，完整码已存库」）。
- 列表：掩码 / 套餐 tag / 状态 tag（有效|已吊销）/ 批次 / 过期时间 / 签发时间 / 备注 / 操作（有效→吊销、删除）。
- 顶部说明：OPS_REDEMPTION_SECRET 与桌面端 REDEMPTION_SECRET 一致契约。

### 12A.19.4 验收标准

① 签发格式与桌面端 validate() 兼容（签名可复算）；② count/plan/expires_at 非法 → 400；③ 未配置密钥 → 400；④ 列表掩码、操作按 id；⑤ 吊销/删除不存在 → 404；⑥ 非 admin 403。


## 12A.21 流水线所需依赖目录（2026-08-11 新增）

> 列出所有视频创作流水线运行所需的模型类型（推理 / 图片生成 / 视频生成 / TTS 语音 / 语音识别 / 音频生成）与候选供应商，种子对齐代码事实（pipeline-engine.js 流水线定义 + model-provider-seeds.js 供应商目录）；运营可维护，为后续「桌面端配置检查」提供依据。

### 12A.21.1 数据模型与校验

`pipeline_dependencies`：id（代理主键）/ pipeline_id（`^[a-z0-9_-]{1,64}$`）/ pipeline_name（≤100）/ model_type（枚举 llm/tts/speech_recognition/image/video/audio/multimodal）/ required（0=可选）/ provider_candidates（JSON 字符串数组 ≤50，去重保序）/ default_provider（必须在候选内或留空）/ description（≤200）/ enabled / sort_order（非负整数）/ deleted_at（软删，不复活，可重建）/ updated_at / updated_by；唯一约束 (pipeline_id, model_type)。

- POST 重复 (pipeline_id, model_type) → 400；PUT 部分更新 + 404（改 key 撞唯一 → 400 兜底）；DELETE 软删 + 404；IntegrityError 兜底 400。

### 12A.21.2 种子（代码事实，INSERT-OR-IGNORE 不覆盖运营修改）

覆盖 12 个有模型依赖的流水线（story2video-compose / animated-explainer / talking-head / cinematic / animation / avatar-spokesperson / character-animation / clip-factory / documentary-montage / hybrid / localization-dub / podcast-repurpose），共 31 条；供应商候选与默认值对齐 model-provider-seeds.js 预设目录（如 llm 默认 anthropic、image 默认 flux、video 默认 minimax、tts 默认 minimax-tts、speech_recognition 默认 whisper、audio 默认 suno）。
screen-demo（屏幕演示录制）与 framework-smoke（冒烟测试）无模型依赖，不播种。

### 12A.21.3 端点（GET 登录可读；写 admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/pipeline-dependencies?pipeline_id=&model_type= | 列表（筛选） |
| POST | /api/v1/pipeline-dependencies | 新增（admin） |
| PUT | /api/v1/pipeline-dependencies/{id} | 更新（admin） |
| DELETE | /api/v1/pipeline-dependencies/{id} | 软删（admin） |

### 12A.21.4 前端「流水线依赖」页

- 列表：流水线 ID / 名称 / 模型类型 tag / 必选 tag（必选=红 / 可选=灰）/ 默认供应商 / 候选供应商 tags / 说明 / 启用开关 / 操作（编辑、删除）；顶部流水线 ID 输入筛选 + 模型类型下拉筛选 + 「新增依赖」。
- 编辑弹窗：流水线 ID（编辑禁用）/ 名称 / 模型类型（编辑禁用下拉）/ 必选开关（提示「关闭=可选（缺省时该能力降级）」）/ 候选供应商（逗号分隔，提示建议预设）/ 默认供应商（从候选中下拉）/ 说明 / 启用。
- 顶部说明：数据种子对齐代码事实；「必选」表示运行前必须配置该类模型。

### 12A.21.5 验收标准

① 种子 31 条、story2video-compose 含 llm/image/tts/video(可选)；② 校验：pipeline_id 字符集 / model_type 枚举 / default 在候选内 / 候选类型 → 400；③ POST 重复 400、PUT/DELETE 404；④ 软删不复活、可重建；⑤ 筛选正确；⑥ 非 admin 写 403、读 200。
## 12A.22 提示词评测工作台 PromptEval Workbench（2026-08-12 新增）

> 由运营人员在运营后台**真实生成**图片/视频，对「提示词优化引擎」的改写效果进行同屏比对与聚合分析。桌面端 PromptEval（PR #559，eaf067c8）提供评估契约；本功能在运营后台落地「评测工作台」。配套独立文档：`01-docs/PRD-PROMPT-EVAL-OPS-WORKBENCH-2026-08-12.md`。

### 12A.22.1 背景与目标

桌面端 PromptEval v1 已实现「图片评估」（关联度/内容准确性/视觉审美/跨图一致性打分、问题归因、提示词优化点），但评估数据只存在于用户本机，运营/产品完全不可见，无法形成「评估 → 改进 → 复评」的运营侧实证闭环。

本功能在运营后台建设**评测工作台**：运营人员录入「原文文本 + 优化后的提示词（中文）」，后台 LLM 自动生成**英文对照（标注「机器翻译」来源）**，真实调用图片生成模型产出素材，再调用视觉评估模型打分，页面同屏展示 **原文 | 中英提示词 | 生成物 | 评估结果**，支持多次生成对比、历史回溯与聚合分析，为 prompt-engine 改写模板迭代提供运营侧数据依据。

### 12A.22.2 决策点定案（2026-08-12 用户确认）

| 决策点 | 定案 |
|--------|------|
| A 生成 provider 选型 | **A1：ops-center 后端服务端直连模型 API**。v1 图片：`minimax-image`（image-01）与 `flux` 至少其一（可配置多 provider，默认 minimax-image）；v2 视频：minimax / hunyuan |
| A 密钥管理 | ops-center 环境变量 + 后台「模型密钥」配置（复用 `OPS_CATALOG_API_KEY` 管理模式）；密钥仅服务端持有、加密存储、**绝不返回前端** |
| B 中英对照 | **后台 LLM 自动翻译**优化后提示词 → 英文对照，UI 标注「机器翻译」徽标；来源写库可审计；可配置启用/禁用与目标语言（默认 zh→en） |
| 视频范围 | **v1 图片先行；视频 v2**（与桌面端口径一致：mediaType=video 明确拒绝，v2 再实现时序一致性/运动准确性/音画同步维度） |

### 12A.22.3 角色与权限

| 角色 | 能力 |
|------|------|
| 运营（登录） | 创建评测 case、触发翻译、创建/查看 run、查看/对比/删除**自己创建**的评测、查看聚合分析 |
| 管理员（`require_admin`） | 管理「模型密钥」、查看/删除全部评测、清理数据 |
| 未登录 | 不可访问（全部接口 `get_current_user` 起） |

- 读接口：`get_current_user`；写接口（cases/runs/translate）：`get_current_user`；密钥管理：`require_admin`。

### 12A.22.4 数据模型

| 表 | 字段（要点） |
|----|--------------|
| `prompt_eval_cases` | id、title、source_text（原文）、context（可选）、prompt_zh（优化后提示词·中文，必填）、prompt_en（LLM 翻译结果，服务端生成）、prompt_en_source（`machine_translation`/`manual`/null）、prompt_en_translated_at、provider、model、image_count（1-20，默认 1）、aspect_ratio、created_by、created_at、updated_at、deleted_at |
| `prompt_eval_runs` | id、case_id、provider、model、status（`queued/processing/succeeded/failed`）、image_paths（JSON 数组，落盘/COS URL）、video_path（v2 预留）、eval_status（`pending/succeeded/failed`）、overall_score、grade、dimensions（JSON）、problems（JSON）、optimization_points（JSON）、error（阶段+原因）、created_by、created_at、completed_at |
| `prompt_eval_provider_keys`（admin） | provider、model、key_enc（加密）、base_url（可选）、enabled、created_at |

- 生成物只存 URL/路径，不存 base64；删除 case 时级联删除 run 与本地生成物（回收）。

### 12A.22.5 接口契约（`/api/v1/prompt-eval/*`）

| 方法/路径 | 权限 | 说明 |
|-----------|------|------|
| `POST /cases` | 登录 | 创建评测 case（全字段校验，见 12A.22.8） |
| `POST /cases/{id}/translate` | 登录/创建者 | 触发 LLM 翻译 prompt_zh→prompt_en（幂等：同 prompt_zh 已翻译且未过期则复用） |
| `POST /cases/{id}/runs` | 登录/创建者 | 创建 run 并异步执行「生成 → 评估」流水线（立即返回 run，前端轮询） |
| `GET /runs/{id}` | 登录/创建者/管理员 | run 详情（含 status/eval_status/结果），轮询用 |
| `GET /cases` | 登录 | 列表（分页、按创建人/状态/时间筛选） |
| `GET /cases/{id}` | 登录/创建者/管理员 | case + 全部 runs（详情/对比用） |
| `DELETE /cases/{id}` | 创建者/管理员 | 删除 case（级联 runs 与本地生成物） |
| `GET /summary` | 登录 | 聚合分析（记录数/平均分/等级分布/维度均值/问题类别分布/优化点 Top/按 provider·model 对比） |
| `GET/PUT /providers` | admin | 模型密钥目录管理（provider/model/base_url/enabled；返回不含密钥明文） |

### 12A.22.6 异步流程与状态机

```
POST /cases/{id}/runs → status=queued
  → processing：生成图片（有界瞬时重试；429 退避）
      ├─ 失败 → status=failed（error 记录阶段+原因；不静默降级）
      └─ 成功 → 生成物落盘/COS → status=succeeded，eval_status=pending
  → eval_status=evaluating：调用视觉评估 LLM
      ├─ 非法输出（非 JSON/分数越界/白名单外）→ eval_status=failed（生成物保留）
      └─ 合法 → eval_status=succeeded，写入 overall/grade/dimensions/problems/optimization_points
```

- 前端轮询 `GET /runs/{id}`：图片 2-5s；视频 v2 放宽到 10-30s。
- 断点/并发：同一 case 可多次创建 run（多次生成对比）；`POST /cases/{id}/runs` 对进行中 run 不做互斥（允许并行生成，额度由后台配置限制并发 ≤3）。

### 12A.22.7 生成服务与密钥管理（决策点 A）

- 新增 `services/prompt_eval_generation.py`：provider 适配（v1 至少 `minimax-image`、`flux`；OpenAI 兼容 `/images/generations` 或各 provider 原生），HTTP 客户端 + 超时 + 有界重试 + 429 退避；
- 请求参数与桌面端 AssetGenerator 对齐（prompt/style/image_provider/aspect_ratio/image_count）；
- 结果校验：返回必须为受支持图片（扩展名/魔数），空/错误 → run failed（不降级）；
- 密钥：`prompt_eval_provider_keys` 加密存储，admin 维护；未配置任何可用密钥时创建 run 返回可操作错误（**按角色区分**：admin →「未配置可用的图片生成模型，请先在侧边栏「模型密钥」（/model-keys）中配置」；非 admin →「…请联系管理员在「模型密钥」中配置」——因「模型密钥」菜单仅 admin 可见，非 admin 不应被引导到不可见页面）；
- 密钥类型（「模型密钥」页 Provider 下拉）：`minimax-image` / `flux`（生图）、`minimax-llm`（中英对照优化+翻译）、`minimax-vision` / `opencode-go-vision`（生成物视觉评估，OpenAI 兼容 base_url/model/api_key，如 Opencode-Go 视觉模型 base_url=`https://opencode.ai/zen/go/v1`）；LLM/视觉密钥优先读密钥表（视觉候选顺序 minimax-vision → opencode-go-vision），fallback 环境变量 `OPS_PROMPT_EVAL_LLM_*` / `OPS_PROMPT_EVAL_VISION_API_KEY`；
- 与桌面端一致：密钥/凭据不出现在任何响应、日志、评估提示词中；
- **测试连通**：`POST /providers/test`（admin）用表单值或已保存密钥探测连通性——先 `POST {base}/chat/completions`（`max_tokens=1` 最小请求，覆盖 llm/vision/opencode），404/405 时 fallback `GET {base}/models`（覆盖 image 类）；均不可达提示「请用真实生成验证」；不落库、不产生真实生成费用。前端「模型密钥」表单与列表项均提供「测试连通」按钮。
- **修改**：列表项「编辑」回填表单（provider/model 锁定为唯一键），可改 Base URL / 启用状态 / API Key（留空保留原密文）；保存走 `PUT /providers` upsert（存在则更新 key_enc/base_url/enabled/updated_by）；表单含「启用」switch（编辑可停用/启用）。

### 12A.22.8 数据校验（fail closed，对齐桌面端契约）

| 字段 | 规则 |
|------|------|
| source_text | 非空，≤20000 |
| context（可选） | 序列化 ≤20000；**递归**过滤敏感键（password/token/secret/api_key/credential 等，任意嵌套命中即 400） |
| prompt_zh | 非空，≤5000 |
| provider/model | 必须在已配置密钥目录内（否则 400 + 引导文案） |
| image_count | 整数 1-20 |
| aspect_ratio | 枚举：`1:1/16:9/9:16/3:4/4:3` |
| prompt_en | 只能由服务端翻译生成（`prompt_en_source` 服务端标注，客户端不可伪造） |
| 生成结果 | 图片扩展名/魔数校验，空/非法 → run failed |
| 评估结果 | overall 0-100、维度 id 白名单且不重复、score 0-100、evidence 非空、problems/promptOptimizationPoints 必须为数组且白名单；任一违反 → eval_status=failed（不静默降级） |

错误响应统一 `{ code, message, details? }`（对齐桌面端 EVAL_* 语义，前缀 `OPS_PROMPT_EVAL_*`）。

### 12A.22.9 中英对照（决策点 B）

- `services/prompt_eval_translation.py`：LLM 翻译 prompt_zh → prompt_en，输出契约 `{ prompt_en, source: 'machine_translation' }`；
- 幂等：同一 case 同一 prompt_zh 已翻译且 7 天内不重复翻译；翻译失败可重试（不阻塞生图，生图仍用 prompt_zh）；
- UI：英文提示词旁显示「机器翻译」徽标；来源字段可审计；
- 配置：`prompt_eval.translation.enabled`（默认 true）、`target_language`（默认 en）。

### 12A.22.10 评估服务

- 复用桌面端 PromptEval 维度/评分/问题分类/优化点**契约常量**（`IMAGE_DIMENSIONS` 权重、11 类问题、7 类优化点、severity 3 类），以共享常量表或一致性测试保证两端对齐；
- `services/prompt_eval_evaluation.py`：调视觉 LLM（OpenAI 兼容 `image_url` content），构造评估提示词（复用桌面端 prompt-builder 的「输入快照 + JSON 契约」语义：原文/上下文/prompt_zh/prompt_en/图片数）；
- 解析 + 白名单校验 fail closed；评估输入快照存库（可审计、可复现）。

### 12A.22.11 交互逻辑与显示项（前端「评测工作台」页）

**Tab1 新建评测**
- 显示项：标题、原文（多行）、上下文（可选多行）、优化后提示词·中文（多行）、英文对照（只读，生成后显示 + 「机器翻译」徽标）、provider/模型下拉（从密钥配置读取，无密钥时显示引导）、图片数（1-20）、画幅下拉；
- 操作按钮：①「生成英文对照」（调 translate，成功后双语并排显示）②「生成并评估」（创建 run）；
- 校验：字段级错误提示；翻译失败可重试。

**Tab2 评测列表/详情**
- 列表：标题、创建时间、创建人、provider/模型、状态徽章（生成中/评估中/成功/失败）、总体分；
- 详情：**同屏四栏 = 原文 | 中英提示词（英文标「机器翻译」）| 生成图片缩略图（点击放大）| 评估结果**（总分/等级/维度条/问题清单按严重度/提示词优化点）；
- 操作：重新生成（新 run）、删除（二次确认）；同 case 多 run **并排对比**（分数对比表：维度 × run）。

**Tab3 聚合分析**
- 显示项：记录数/平均分/等级分布（优秀/良好/一般/差）、维度均值条形、问题类别 Top（次数+严重度）、优化点类型 Top（含示例）、按 provider/模型分数对比、推荐动作文本。

**关键提示文字（文案清单）**
- 「生成英文对照」「机器翻译」「生成并评估」「评估中（第 {n}/{m} 张）...」「生成失败：{原因}」「评估失败：评估模型未返回有效结果」「请先填写原文与优化后的提示词」「未配置可用的图片生成模型，请先在「模型密钥」中配置」「确认删除该评测及其生成物？」

### 12A.22.12 存储与安全

- 生成物：ops-center 媒体目录（或 COS），记录 URL；删除 case 级联清理；
- 密钥：加密存储、admin 管理、不出现在响应/日志/评估提示词；评估与翻译请求中不携带凭据；
- 敏感上下文递归过滤（对齐桌面端 `assertNoSensitiveContext` 语义）；图片/文案上云为运营自测内容（无用户数据合规风险）。

### 12A.22.13 验收标准

1. 创建 case 全字段校验矩阵通过（pytest）；
2. 中英对照：LLM 翻译成功 → 展示+「机器翻译」标注+来源入库；失败可重试；幂等复用；
3. 真实生图：至少 1 个 provider 真实生成图片并落盘/URL 可访问（外部验收边界：真实 provider 与密钥）；
4. 评估：真实视觉模型对生成图打分并落库；非法响应 → eval_status=failed（fail closed 测试用 mock）；
5. 前端三 Tab 可用；无密钥时给出引导文案；双语标注正确；
6. 聚合分析输出正确（数值与桌面端 analyze 口径一致）；
7. `pytest` 全量通过 + 前端 `npm run build` 通过 + 与桌面端 prompt-eval 契约一致性测试；
8. 视频 v2 预留：`video_path` 字段与 video 维度占位，v1 不暴露视频生成入口。

### 12A.22.14 视频扩展（v2，不在本期实现）

- provider 增加视频生成（minimax/hunyuan）；runs 增加 video_path 与抽帧（首/中/尾）；
- 评估维度增加 `temporal_consistency/motion_accuracy/audio_visual_sync/video_aesthetic_quality`（与桌面端 v2 对齐）；
- 中英对照、聚合分析、鉴权与存储模式不变。

### 12A.22.15 测试策略

- 后端 pytest：cases/runs/summary 接口、校验矩阵、翻译服务（mock LLM）、生成服务（mock provider HTTP + 真实 provider 外部验收）、评估服务（mock 视觉 LLM + 非法响应 fail closed）、鉴权（登录/管理员/未登录）、删除级联；
- 前端：组件测试（表单校验/状态徽章/双语标注/非空数据路径）；
- 契约：桌面端 prompt-eval 维度/错误码一致性断言（两端共享枚举表）。


### 12A.22.16 场景层评测工作流（2026-08-12 调整）

> 运营人员**输入整篇文案原文**，后台按**桌面端分句机制**拆成场景层，逐场景自动展示「场景文字 / 字幕二次分句 / 场景上下文 / 优化后提示词（中英对照）」，并可逐场景「生成图片」+ 评估（复用 12A.22 既有流程，生成部分不变）。

**工作流**：输入整篇文案 → 后台分句（场景级分割 + 字幕二次分句 + 场景上下文提取）→ 场景层列表 → 逐场景生成/展示 中英优化提示词 → 逐场景「生成图片」→ 生成物 + 评估结果 → 多 run 对比 / 聚合分析。

### 12A.22.17 场景层数据模型

| 表/字段 | 说明 |
|---------|------|
| `prompt_eval_cases`（扩展） | 新增 `source_mode`（`manual`=旧整 case 模式 / `scene`=场景层模式）；`scene` 模式时 `source_text` 为整篇文案原文 |
| `prompt_eval_scenes`（新增） | id、case_id（FK）、index、scene_text、subtitle_blocks（JSON）、scene_context（JSON）、prompt_zh、prompt_en、prompt_en_source（machine_translation/manual）、prompt_en_translated_at、created_at、updated_at |
| `prompt_eval_runs`（扩展） | 新增 `scene_id`（可空 FK；NULL=旧模式整 case 生成） |
| subtitle_blocks 结构 | `[{ index, text, start_seconds?, end_seconds?, duration? }]`（对齐桌面端字幕分句输出） |
| scene_context 结构 | 白名单键（对齐桌面端 story-context-engine 语义）：`genre/era/culture/setting/time/characters/props/visual_style/tone/summary/anchors/negative_anchors` |

### 12A.22.18 场景层接口

| 方法/路径 | 权限 | 说明 |
|-----------|------|------|
| `POST /cases`（scene 模式） | 登录 | 传 `source_mode=scene` + 整篇原文 + 分句配置 → 后台分句并创建 scenes，返回 case+scenes |
| `GET /cases/{id}` | 登录/创建者/管理员 | 含 scenes（每场景：scene_text / subtitle_blocks / scene_context / prompt_zh / prompt_en） |
| `POST /cases/{id}/scenes/{sid}/translate` | 登录/创建者 | 按场景生成中英对照（LLM 优化 + 翻译，source=machine_translation，幂等 7 天） |
| `POST /cases/{id}/scenes/{sid}/runs` | 登录/创建者 | 按场景生成图片（prompt 用该场景 prompt_zh；provider/model/画幅/图片数来自 case）→ 复用生成→评估状态机 |
| `GET /runs/{id}`、`GET /summary` | 登录 | 不变；summary 可按 scene 维度聚合 |

**分句配置（scene 模式请求体）**：`target_chars_per_scene`（默认 20，1-200）、`subtitle_min_chars`（默认 8）、`subtitle_max_chars`（默认 15）、`subtitle_timing`（proportional/equal，默认 proportional）、`language`（默认 zh）——与桌面端 story2video-compose split 阶段默认一致。

### 12A.22.19 分句与优化提示词生成（复用桌面端分句机制）

- **分句语义基准**：桌面端 `packages/story2video-engine/src/text-segmentation.ts`（三级分割：句子边界消歧 → 场景级分割 → 字幕级分割，纯本地无网络）与 smart-sentence-splitter（8002）契约；ops-center 后端提供 Python 分句实现（场景级 + 字幕级），**一致性测试**用 node 加载桌面端 `text-segmentation.ts` 对同一输入断言 scenes/subtitle_blocks 一致（参照 prompt_eval_contract 的 node 加载断言模式）。
- **场景上下文**：按桌面端 `story-context-engine.js` 语义提取（白名单键见 12A.22.17），后台实现；提取失败不静默降级（明确错误或标记 degraded）。
- **优化提示词生成**：后台 LLM 以「整篇原文 + 场景文字 + 场景上下文」为输入生成该场景中文优化提示词（prompt_zh），再翻译英文（prompt_en，source=machine_translation）；支持运营编辑覆盖 prompt_zh（编辑后 prompt_en 标记需重新生成）。
- **分句失败处理**：分句服务异常 → 返回可操作错误（「分句失败：{原因}」），不落库、不降级。

### 12A.22.20 交互与显示（场景层评测工作台）

**Tab「新建评测」**新增「场景模式」：
- 输入：整篇文案原文（多行，≤20000）+ 分句配置（折叠高级项）+ provider/模型/画幅/图片数；
- 按钮：「分句并生成场景」→ 调 `POST /cases`（scene 模式）→ 展示场景层列表；
- **每场景卡片四区**：① 场景文字（序号 + scene_text）；② 字幕二次分句（subtitle_blocks 逐条：文字 + 目标时长，来源标注 local/分句服务语义）；③ 场景上下文（scene_context 键值展示：时代/地域/角色/道具/视觉风格/负面锚点等）；④ 优化提示词中英文（中文可编辑 + 英文「机器翻译」徽标 + 「重新生成中英对照」）；
- 每场景操作：「生成图片」（复用生成→评估）+ 评估结果卡（总分/等级/维度/问题/优化点）+ 多 run 对比；
- 可选：「批量生成中英对照」（全部场景一次生成）。

**新增提示文字**：「分句并生成场景」「场景 {n}」「字幕二次分句」「场景上下文」「重新生成中英对照」「批量生成中英对照」「分句失败：{原因}」「请先输入整篇文案原文」。

**校验（scene 模式）**：原文非空 ≤20000；分句配置边界（target_chars_per_scene 1-200、subtitle_min 1-50、subtitle_max min+1..200、subtitle_min < subtitle_max）；provider/model 已配置密钥；场景数上限 100（超出 400）。

### 12A.22.21 验收标准（场景层增补）

1. scene 模式分句：同一输入与桌面端 `text-segmentation.ts` 输出场景数/字幕块一致（一致性测试）；
2. 每场景四区完整展示（场景文字/字幕块/上下文/中英提示词），且「生成图片」→ 评估结果可用（真实 provider 外部验收）；
3. 中英对照幂等、可编辑覆盖；编辑 prompt_zh 后 prompt_en 标记待重生成；
4. 分句失败明确报错不降级；场景数超限 400；
5. pytest（分句/场景接口/一致性）+ 前端 build；12A.22.13 既有验收不回归。

## 12A.23 限流与调度验证（2026-08-13 新增）

> 在运营后台提供「限流与调度验证」闭环，验证「每分钟连接次数（rate_per_minute）/ 5小时限额次数（limit_per_5h）」配置下的并发与排队机制：**契约校验（配置是否合法/合理）→ 参数模拟（与桌面端同契约的确定性模拟）→ 真实观测（用量上报排队/冷却指标）→ 真实自检（桌面端 governor + 假 adapter 对拍）**。
> 背景：运营在「预设模型」页配置限流后，无法确认桌面端调度器会如何执行（并发上限怎么换算、排队预算多少、429 冷却如何自适应、5h 额度何时拒绝）。本功能提供可复现、可审计的验证手段，且不修改既有调度行为（`ApiUsageGovernor` / `model-call-scheduler` 参数不变，只增加观测与验证层）。降级链路见 12A.10.4；桌面端机制详见 Multi-Publish PRD §7.1.8.1 / §7.4.4.3 / §7.4.4.4 / §7.4.4.5。

### 12A.23.1 背景与目标

1. **契约校验**：对全部可见预设批量校验限流配置范围、`default_model ∈ models`、并发换算公式，供运营发现存量脏数据；
2. **参数模拟**：按与桌面端 `ApiUsageGovernor` 同契约的确定性事件驱动模拟器，输入 rpm / 并发上限 / 5h 限额 / 请求数 / 单请求耗时 / 到达间隔 / 429 注入 / 5h 超限开关，输出逐请求时间线、指标与 6 条断言 PASS/FAIL；
3. **真实观测**：桌面端用量上报携带排队/冷却聚合指标，用量看板按服务商展示 429 率、排队/冷却次数、平均排队时长、预算利用率；
4. **真实自检**：桌面端用**独立** `ApiUsageGovernor` + 本地假 adapter（零额度、零网络）真实跑调度，结果可上报运营后台（simulated=0）并与 Python 模拟器对拍。
5. **边界声明**：模拟/自检结果 ≠ 真实 provider 限流；真实 provider 的 429/配额行为属于外部验收，不在本功能断言范围内。

### 12A.23.2 契约常量（模拟器与桌面端同源）

以下常量在 `ops-center/backend/services/scheduler_simulator.py` 与桌面端 `apps/desktop/electron/services/api-usage-governor.js` / `model-call-scheduler.js` 保持同值，由两端常量测试 + 对拍脚本防止漂移：

| 常量 | 值 | 语义 |
|------|----|------|
| 滑动窗口 | 60_000ms | RPM 预算窗口（WINDOW_MS） |
| 并发队列等待上限 | 30_000ms | `MAX_QUEUE_WAIT_MS`：并发信号量等待超过即判限流 |
| RPM 时间槽等待上限 | 180_000ms | `MAX_PACE_WAIT_MS`：RPM 时间槽预约等待超过即判限流 |
| 冷却等待上限 | 45_000ms | `MAX_COOLDOWN_WAIT_MS` |
| 默认冷却时长 | 30_000ms | `DEFAULT_COOLDOWN_MS`（桌面端 cooldownMs 允许 100..60000ms） |
| 429 自适应 | ×0.75，下限 0.2 | `RATE_ADAPT_FACTOR` / `RATE_FACTOR_MIN`；成功后 +0.05 恢复（`RATE_RECOVER_STEP`，上限 1.0） |
| 有效 RPM | max(2, round(rpm × rateFactor)) | `_effectiveRpm`：rateFactor 下调后仍保底 2 |
| 并发换算 | clamp(round(rpm/10), 1, 4) | `maxConcurrent` 未配置时的默认值（JS Math.round half-up 语义） |
| 5h 窗口 | windowMs=5h, field=requests | 请求前预检即拒（QUOTA_EXCEEDED），不消耗真实调用 |
| 参数上限 | rpm≤100000、请求数≤1000、耗时≤60000ms、到达间隔≤60000ms、并发≤8、5h 限额≤10000000 | 越界 400 |

### 12A.23.3 数据模型（scheduler_verification_runs）与字段校验

新表独立（`CREATE TABLE IF NOT EXISTS`，启动时幂等建表，无存量迁移）：

| 字段 | 类型 | 说明/校验 |
|------|------|----------|
| id | INTEGER PK AUTOINCREMENT | run 号 |
| preset_id | VARCHAR NULL | 关联预设 ID（可空，允许手工参数） |
| rpm | INTEGER NOT NULL | 每分钟连接次数，[1,100000] |
| max_concurrent | INTEGER NOT NULL | 并发上限 [1,8]；未传按 clamp 换算后落库 |
| limit_per_5h | INTEGER NULL | 5h 限额 [1,10000000]；空=无 5h 窗口 |
| request_count | INTEGER NOT NULL | 请求数 [1,1000] |
| request_duration_ms | INTEGER DEFAULT 0 | 单请求耗时 [0,60000] |
| arrival_interval_ms | INTEGER DEFAULT 0 | 到达间隔 [0,60000]；0=同时到达 |
| inject_429_at | INTEGER NULL | 注入 429 的请求序号 [1,request_count]；空=不注入 |
| exceed_5h | INTEGER DEFAULT 0 | 模拟 5h 额度超限开关（bool） |
| simulated | INTEGER DEFAULT 1 | 1=运营后台模拟；0=桌面端真实自检上报 |
| engine | VARCHAR DEFAULT 'python-simulator' | 引擎标识：python-simulator / real-governor |
| client_id | VARCHAR DEFAULT '' | 桌面端上报的设备指纹（sha256(userData) 前 16 位） |
| metrics_json | TEXT DEFAULT '{}' | 指标 |
| assertions_json | TEXT DEFAULT '[]' | 断言 |
| timeline_json | TEXT DEFAULT '[]' | 逐请求时间线 |
| status | VARCHAR DEFAULT 'completed' | 状态 |
| created_at / created_by | VARCHAR | 审计字段 |

**参数校验（服务端 `_validate`，非法 → 400 + 中文字段提示，不落库）**：
- `rpm`：必须为 [1,100000] 的整数（拒绝布尔、浮点、字符串）；
- `request_count`：[1,1000] 整数；
- `request_duration_ms`：[0,60000] 整数；
- `arrival_interval_ms`：[0,60000] 整数；
- `max_concurrent`：留空或 [1,8] 整数；留空按 `clamp(round(rpm/10),1,4)` 换算；
- `limit_per_5h`：留空或 [1,10000000] 整数；
- `inject_429_at`：留空或 [1,request_count] 整数（越界 400）；
- `exceed_5h`：bool（缺省 false）；
- 记录字段：`preset_id`/`client_id`/`created_by` 长度截断（64/128/64）；`engine` 缺省 python-simulator。

### 12A.23.4 接口契约（/api/v1/scheduler/*）

全部端点 `require_admin`（非 admin → 403；未登录 → 401）。前端路由 `/rate-limit-verifier`（meta.requiresAuth），菜单「限流验证」。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/scheduler/verify | 运行调度模拟（simulated=1）或接收桌面端真实自检上报（simulated=0），落库并返回结果 |
| GET | /api/v1/scheduler/verify | 验证记录列表（created_at 倒序；preset_id/simulated 过滤；limit 1-200 默认 20；offset；摘要不含 timeline） |
| GET | /api/v1/scheduler/verify/{run_id} | 单条详情（含 timeline JSON）；不存在 → 404「验证记录不存在」 |
| GET | /api/v1/scheduler/contract | 批量契约校验（全部 is_visible=1 预设） |

**POST /verify 请求体**：`preset_id?` / `rpm` / `max_concurrent?` / `limit_per_5h?` / `request_count` / `request_duration_ms?`(0) / `arrival_interval_ms?`(0) / `inject_429_at?` / `exceed_5h?`(false) / `simulated?`(true) / `engine?`('python-simulator') / `client_id?`('') / `created_by?`('admin')。
**成功响应**：`{code:0, run_id, id, preset_id, rpm, max_concurrent, limit_per_5h, request_count, request_duration_ms, arrival_interval_ms, inject_429_at, exceed_5h, simulated, engine, client_id, metrics, assertions, timeline, status, created_at, created_by}`。
**参数非法**：400 + 字段级中文提示（如「rpm 必须是 [1, 100000] 的整数」）。

**GET /contract 输出**：按 `category, name` 排序的可见预设清单，每项 `{preset_id, name, category, rpm, limit_per_5h, max_concurrent(换算), rules:[{rule, pass, actual, expected}]}`。规则：
1. `rate_per_minute 范围`：空 或 [1,100000]；
2. `limit_per_5h 范围`：空 或 [1,10000000]；
3. `default_model ∈ models`：空 或 ∈ models；
4. `并发换算 clamp(round(rpm/10),1,4)`：rpm 有值时必可换算。

### 12A.23.5 调度模拟器功能逻辑（确定性事件驱动，2026-08-13 并发推进升级）

`services/scheduler_simulator.py` 纯标准库实现（heapq + 全局时钟），同参数同结果、无随机，供验证与桌面端对拍。每个请求 i 按以下顺序推进：

1. **到达**：`arrive_at = (i-1) × arrival_interval_ms`；`now = max(now, arrive_at)`；释放所有已完成（finished_at ≤ now）执行；
2. **并发信号量（transfer，2026-08-13 升级）**：当前执行中（started 未 finished）≥ max_concurrent → 接管最早完成槽（等待从本请求到达时刻起算，**不推进全局时钟**——同批到达的后续请求仍可并发竞争，真实 Promise 并发语义）；超时判定 = 本请求**到达时刻 + 30s**（MAX_QUEUE_WAIT_MS，与真实 waiter deadline 一致）→ 状态 `rate_limited`（end_time 记 deadline 墙钟）；否则复用槽位并累计 queue_wait；
3. **RPM 时间槽**：`rpm_eff = max(2, round(rpm × rateFactor))`，`interval_ms = 60000/rpm_eff`；`slot_base = max(t, next_slot_at)`，预约后 `next_slot_at += interval_ms`；`pace_wait = slot_base - t` > 180s（MAX_PACE_WAIT_MS）→ 状态 `rate_limited`（先同步预约再判超时，与桌面端 `_pace` 一致）；推进到槽位时刻后**释放所有已完成执行**（interval < duration 时请求可重叠执行 → 真实并发）；
4. **429 冷却**：`t < cooldown_until` → 等待，> 45s（MAX_COOLDOWN_WAIT_MS）→ 状态 `rate_limited`；否则 `t = cooldown_until`，`cooldown_count+1`；
5. **5h 额度预检**（2026-08-13 后移，与真实 preflight 位置一致）：`used_5h >= limit_per_5h` → 状态 `quota_exceeded`（`started_at=None`，不执行、不消耗调用；被拒请求仍占用已预约的 RPM 槽 → 墙钟 total 含其等待）；
6. **执行**：`started_at = t`，`finished_at = t + request_duration_ms`，`used_5h+1`，状态 `completed`；
7. **记账**：若 `inject_429_at == i` → `cooldown_until = finished + cooldown_ms`，`rate_factor × 0.75`（下限 0.2），`rate_limited_count+1`；否则 `rate_factor + 0.05`（上限 1.0）；追加 factor 曲线点 `{t: finished, factor}`；`now = max(now, t)`。

**timeline 条目**：`{req, arrived_at, queued_at, started_at, finished_at, state, queue_wait_ms, cooldown_wait_ms}`；最终状态 ∈ {completed, rate_limited, quota_exceeded}（前端状态标签还兼容 queued/running 显示映射）。

**metrics**：
- `total_duration_ms`：墙钟口径——全部请求（含被拒/限流的判定时刻）最晚结束时刻 − 起始 0，对齐真实 governor runSelfCheck（2026-08-13 升级；此前仅成功请求 span）；
- `throughput_per_min`：任意 60s 窗口内最大放行（开始）数，与 RPM 预算语义一致；
- `max_concurrent_observed`：观测口径为「实际执行中 = started 未 finished」的峰值（与真实 governor 一致，避免 pace 推迟请求仍在占用导致的假阳性）；
- `max_queue_wait_ms`、`rate_limited_count`、`cooldown_count`、`quota_exceeded_count`、`rate_factor_curve`。

### 12A.23.6 断言库（6 条规则）

| 断言名 | 判定 | 期望 | 说明 |
|--------|------|------|------|
| max_concurrent | 观测并发峰值 ≤ max_concurrent | ≤ 配置值 | 并发预算不超限 |
| no_rate_limited | 未注入 429 时 rate_limited_count == 0 | 0 | 无注入不应限流 |
| throughput | 60s 窗口放行数 ≤ max(rpm, 2) | ≤ 预算（含 effectiveRpm 下限 2） | 吞吐不超预算 |
| max_queue_wait | max_queue_wait_ms < 180000 | < 180000 | RPM 时间槽排队有界 |
| quota_at_limit_plus_1 | exceed_5h 且 limit 有值时：第 limit+1 个请求恰好被预检拒绝（started_at=None） | 1 (req=limit+1) | 5h 额度第 limit+1 个起拒绝（对应真实 governor `used > limit` 修复） |
| fifo | max_concurrent==1 时完成顺序 == 到达顺序 1..N | 1..N | 单并发 FIFO |

### 12A.23.7 前端「限流与调度验证」页（交互逻辑与显示项）

**页面顶部说明（el-alert）**：「验证『每分钟连接次数 / 5小时限额次数』配置下的并发与排队机制（与桌面端 ApiUsageGovernor 同契约）。**模拟结果 ≠ 真实 provider 限流**；桌面端真实自检以 P2『上报自检』记录为准。」

**Tab 1 模拟验证**：
- 参数表单（inline）：
  - 模型预设（select，filterable+clearable，placeholder「选预设自动带出限流」）：选择后带出 `rate_per_minute`（空→20）、`limit_per_5h`（空→null）、并发上限重置为 null、请求数重置 10、单请求耗时重置 100ms；
  - 每分钟连接次数 rpm：1..100000（默认 20）；
  - 并发上限 maxConcurrent：1..8（留空 → hint「未配置按 clamp(rpm/10,1,4)」）；
  - 5小时限额次数：1..10000000（placeholder「留空=无5h窗口」）；
  - 请求数：1..1000（默认 10）；
  - 单请求耗时(ms)：0..60000（默认 100）；
  - 到达间隔(ms)：0..60000（默认 0=同时到达）；
  - 注入 429（第 N 个）：1..1000（placeholder「留空=不注入」）；
  - 模拟 5h 额度超限：switch；
  - 按钮「运行验证」（loading 态）。
- 表单下 hint：「默认并发 = clamp(round(rpm/10),1,4)；排队预算：并发队列 30s / RPM 时间槽 180s / 冷却 45s；429 自适应 ×0.75（下限 0.2）、成功 +0.05。」
- 结果区（成功提示：「验证完成 #N：断言 X/Y 通过」）：
  - 指标卡 ×7：总耗时(ms) / 吞吐(60s 窗口) / 最大并发 / 最长排队(ms) / 限流次数 / 冷却次数 / 额度拒绝；
  - 断言表：断言 / 结果（PASS 绿 / FAIL 红 tag）/ 实际 / 期望 / 说明；
  - 请求时间线表（max-height 360）：# / 到达 / 排队完成 / 开始 / 完成 / 状态（排队中/执行中/已完成/限流/额度超限，色 tag）/ 排队ms / 冷却ms；
  - rateFactor 曲线（文本序列，如 `1 → 0.75 → 0.8 → …`，展示自适应路径）；
  - 落库提示：「验证记录 #N（simulated=true，已落库可审计）」。
- 失败提示：「验证失败: {detail}」。

**Tab 2 契约校验**：
- 顶部 hint：「对全部可见预设校验限流配置范围、default∈models、并发换算（clamp(round(rpm/10),1,4)）」+ 按钮「刷新校验」；
- 表格：预设 ID / 类别 / rpm / 5h 限额（空显示 —）/ 换算并发（空显示 —）/ 校验规则（每规则一行 PASS/FAIL tag + 规则名；FAIL 时红字「实际={actual}（期望 {expected}）」）。
- 失败提示：「契约校验失败: {detail}」。

**Tab 3 验证记录**：
- 顶部 hint：「模拟（simulated=true）与桌面端自检上报（simulated=false + client_id）的历史记录」+ 按钮「刷新」；
- 表格：`#` / 来源（模拟=灰 tag / 真实自检=黄 tag + client_id）/ 预设（空显示 —）/ rpm / maxConcurrent / 指标（hint：并发={max_concurrent_observed} · 限流={rate_limited_count} · 冷却={cooldown_count} · 最长排队={max_queue_wait_ms}ms）/ 时间；
- 点击行 → 详情抽屉（60%）：描述区（预设/rpm/maxConcurrent/请求数/5h 限额/来源（模拟|真实自检）+ engine）、指标 JSON（pre）、断言表、时间线表；
- 分页：20/页（prev/pager/next）；
- 提示：「加载验证记录失败/加载详情失败: {detail}」。

### 12A.23.8 P1 用量健康度（用量看板调度健康度）

**数据来源**：桌面端 30min 用量上报（`POST /api/v1/usage/ingest`，X-Catalog-Key 鉴权）携带可选聚合字段 `queued_count` / `cooldown_count` / `queue_wait_ms` / `cooldown_wait_ms`（非负整数；旧客户端缺失按 0，upsert 幂等累加）；`model_usage_daily` 对应可空列（启动 ensure 幂等 ALTER）。

**用量看板「按服务商」表新增列**（`GET /api/v1/usage/summary`，admin）：

| 列 | 口径 | 阈值/展示 |
|----|------|----------|
| 429率 | ratelimit / calls × 100 | >10% 黄 warning tag，否则绿 success；无调用 0% |
| 排队次数 | queued_count | 数字 |
| 冷却次数 | cooldown_count | 数字 |
| 平均排队ms | queue_wait_ms / queued_count | queued_count=0 显示 `-` |
| 预算利用率 | calls / (天数×1440) / rpm预算 × 100 | >90% 黄 warning；rpm 未配置（null）显示「未配置」 |

- rpm 预算取自 model_presets 目录 `rate_per_minute`（preset_id ↔ provider_id 匹配）；
- 总览卡同步展示「限流(429)次数」等聚合。
- **口径注意**：利用率按「日均每分钟实测调用 ÷ rpm 预算」估算（非实时窗口），rpm 未配置时无法计算，属于正常展示而非错误。

### 12A.23.9 P2 桌面端真实自检与上报

**入口**：模型设置页「运营后台同步」卡片操作区按钮「限流自检」（title 提示：用真实调度网关（假 adapter，不消耗额度）验证并发/排队/限流机制）。

**弹窗「限流自检」**：
- 说明：「使用真实调度网关（ApiUsageGovernor）+ 本地假 adapter 构造并发请求，验证并发上限/排队/429 冷却/5h 限额；不消耗额度、不访问网络。结果可上报运营后台『限流与调度验证』。」
- 参数行：每分钟连接次数 rpm（1..100000，默认 20）/ 并发上限（1..8，留空=clamp(rpm/10,1,4)）/ 请求数（1..1000，默认 10）/ 单请求耗时(ms)（0..60000，默认 100）/ 注入 429（第 N 个，留空=不注入，1..1000）/ 5小时限额次数（留空=不启用，1..10000000）；
- 运行中提示：「自检运行中（真实调度排队，耗时取决于 rpm 预算）...」；
- 结果区：指标（最大并发 / 限流 / 额度拒绝 / 总耗时）+ 断言列表（PASS/FAIL tag + name + message）+ 上报状态文案（「已上报，运营后台验证记录 #N」）；
- 按钮：关闭 / 运行自检（运行中禁用）/ 上报运营后台（无结果时禁用）；
- 提示：「自检完成：断言 X/Y 通过」「自检失败: {原因}」「当前环境无 electronAPI，请使用桌面应用运行自检/上报」「上报失败: {原因}」；
- 非桌面环境（浏览器 Vite）无 `window.electronAPI` → 明确提示，不静默失败。

**IPC（preload 暴露 `rateLimitSelfCheck` / `rateLimitReport`，authenticated）**：
- `rate-limit:self-check`：参数 → `runSelfCheck` → `{code:0, data:{engine:'real-governor', metrics, assertions, timeline}}`；参数非法 `{code:-1, message}`；
- `rate-limit:report`：要求已配置运营后台同步（url + apiKeyConfigured），未配置 → `{code:-1, message:'未配置运营后台同步（地址/Key），无法上报自检结果'}`；构造 body（simulated=false、engine='real-governor'、client_id=sha256(userData)[:16]、metrics/assertions/timeline 原样）POST `{url}/api/v1/scheduler/verify`；10s 超时（AbortController，超时报「上报超时」）、`redirect:'error'`、`X-Catalog-Key` 头；成功返回 `{code:0, run_id, message:'自检结果已上报运营后台'}`。

**runSelfCheck 实现要点**（`services/rate-limit-self-check.js`）：
- **独立** `ApiUsageGovernor` 实例（同契约常量，不污染生产单例的 rateFactor/时间槽/额度窗口）；
- 假 adapter：仅内存 `sleep(requestDurationMs)`，可选注入真实 `ProviderError(RATE_LIMITED)`；全程无 fetch/网络、无额度消耗（断言含 `no_network`，metrics 含 `network_calls`）；
- 5h 窗口（limitPer5h 有值时）`setProviderTokenWindows('selfcheck', [{windowMs:5h, limit, field:'requests'}])`；
- 断言：max_concurrent / no_rate_limited / no_network / quota_at_limit_plus_1（limit 有值时，期望拒绝数 = requestCount − limit，req=limit+1 起）/ fifo（maxConcurrent=1）；
- 校验与模拟器同界：rpm [1,100000]、requestCount [1,1000]、duration [0,60000]、maxConcurrent [1,8]、limitPer5h [1,10000000]、inject429At [1,requestCount]、cooldownMs [100,60000]。

**鉴权契约（已知差异，P2 待对齐）**：服务端 `/api/v1/scheduler/verify` 当前为 admin JWT（`require_admin`）；桌面端上报按设计契约（OpenSpec design §7 安全条款）发送 `X-Catalog-Key`（`OPS_CATALOG_API_KEY`）。在服务端放开 X-Catalog-Key 前，桌面端「上报运营后台」对 `/api/v1/scheduler/*` 会返回 401；服务端单测以 admin token 覆盖 simulated=0 落库路径。此为 P2 后续对齐项，不阻塞模拟验证与契约校验（均 admin 会话内使用）。

### 12A.23.10 对拍与测试

- **对拍脚本** `scripts/compare-scheduler-models.js`：固定四组输入（rpm=6/并发1/8 请求；rpm=20/并发2/10 请求；注入 429；5h 超限）分别调 Python 模拟器（subprocess）与桌面端 `runSelfCheck`，比对 `max_concurrent_observed` / `rate_limited_count` / `quota_exceeded_count` / 完成顺序（total_duration_ms 允许时钟容差）；
- **parity 测试** `apps/desktop/electron/tests/test_scheduler_parity.test.js`（spec 场景映射）；
- 后端：`ops-center/backend/tests/test_scheduler_simulator.py`（确定性/并发上限/RPM 排队/冷却自适应/5h 预检/断言库/参数 400）+ `test_scheduler_api.py`（admin 403、落库、历史/详情、契约校验、simulated=0 上报落库）；
- 桌面端：`rate-limit-self-check.test.js`（时间线/断言/无网络泄漏——假 adapter 不触发 fetch/不污染生产 governor）、`api-usage-governor.test.js`（observability 计时断言）、`usage-reporter.test.js`（聚合字段）、`ipc-handlers/rate-limit.test.js`、ops-center `test_usage_api.py`（可选字段兼容/累加/看板聚合）。

**对拍状态（2026-08-13 模拟器并发推进升级后）**：`scripts/compare-scheduler-models.js` 六组固定输入**全 PASS（PARITY OK）**——官方四组（短请求）+ `quota-5h-real`（5h 拒绝耗时口径，total 差 <10ms）+ `concurrency-real`（rpm=60/并发2/2.5s×8，两端 `max_concurrent_observed=2`，验证 interval<duration 的并发推进）。模拟器已从串行事件循环升级为并发推进（离散事件仿真：信号量 transfer 不推进全局时钟、RPM 槽推进后释放完成事件、5h 预检移到 pace/cooldown 之后、`total_duration_ms` 改墙钟口径）。剩余 `KNOWN_DIFF_CASES` 仅 `slow-call-concurrency`（elevenlabs 3s×8，interval==duration 临界）：真实 governor 定时器误差产生 1ms 级重叠显示 maxc=2，属**测量噪声非并发能力**（真实时间线严格串行），parity 测试做防漂移断言（噪声存在、total 差 <1.5s）。waiter deadline 已精确模拟（到达时刻+30s 判定）；429 长冷却+同批突发可精确复现（模拟器 rate_limited=4=注入1+排队超时3，反映 governor 内部真实行为；runSelfCheck 对排队超时存在观测盲区仅显示 1）。
### 12A.23.11 验收标准

1. 契约校验：对全部可见预设输出 4 条规则 PASS/FAIL；rpm=0 或 limit_per_5h 负数或 default_model 不在 models → 对应规则 FAIL；rpm=6 → max_concurrent=1、rpm=20 → 2；
2. 模拟验证：rpm=20（换算并发 2）+ 10 请求同时到达 → `max_concurrent_observed ≤ 2` 且未注入时 `rate_limited_count=0`；rpm=6/并发 1/8 请求 → 吞吐 ≤6、最长排队 <180s、FIFO；注入第 k 个 429 → cooldown_count≥1、rateFactor 曲线先 ×0.75 后 +0.05；5h=L 且超限 → 第 L+1 个起全部预检拒绝（started_at 空、不执行）；
3. 参数非法 → 400 + 中文字段提示，不落库；
4. 权限：非 admin 调 `/api/v1/scheduler/*` → 403；
5. 验证记录：每次模拟/上报自动落库；列表倒序 + preset_id/simulated 过滤 + 分页；详情含 timeline；来源区分模拟/真实自检（+client_id）；
6. 用量健康度：按服务商显示 429 率/排队/冷却/平均排队/预算利用率，>10% 或 >90% warning，rpm 未配置显示「未配置」；旧客户端上报无新字段按 0，不报错；
7. 桌面端自检：独立 governor + 假 adapter，断言 `no_network`（fetch 未调用）；结果与 Python 模拟器对拍一致（四组固定输入）；
8. 文档：本 PRD 12A.23 与 `ops-center/docs/OPERATIONS.md` 运营手册同步维护；桌面端机制文档见 Multi-Publish PRD §7.1.8.1 / §7.4.4.3-5。







---

## 12A.24 内容质量评估系统

> 状态：已实现 | 版本：v1.1 | 关联 PR：\#1555

### 12A.24.1 概述

内容质量评估系统（ContentQualityEvaluator）为改写引擎产出的内容提供 15 维度量化质量评估。纯启发式 NLP 评分，不依赖外部 LLM，每个维度 0-100 分，加权综合评分 0-100 分。

### 12A.24.2 评估维度与权重

| 维度 ID | 中文名 | 权重 | 评估方法 |
|---------|--------|------|----------|
| viral_potential | 爆款潜力 | 12% | 标题长度、数据引用、热点词、悬念钩子、数字引用 |
| logic | 逻辑性 | 10% | 因果推理词、转折词、平均句长、段落数 |
| engagement | 趣味性 | 8% | 案例/故事标记、对话感、短句长句交替、互动问句 |
| human_likeness | 去AI味 | 10% | AI模板词检测（扣分）、人类口语特征（加分）、个性化标点、人称交互 |
| compliance | 违规风险 | 10% | 8类敏感词库（政治/色情/暴力/赌博/诈骗/医疗），反向评分 |
| readability | 易读性 | 10% | 平均句长、常用字占比、段落长度、老人儿童友好度 |
| clone_divergence | 克隆差异度 | 6% | 字符集Jaccard相似度、长度比、句子结构差异 |
| information_density | 信息密度 | 6% | 数字/数据引用、专有名词/术语、虚词占比 |
| emotional_resonance | 情感共鸣 | 6% | 正面/负面情感词统计、情感基调 |
| structure | 结构完整性 | 6% | 开头标记、结尾标记、段落过渡词、分点列表 |
| originality | 原创性 | 4% | 个人观点表达、新概念/表达、陈词滥调检测 |
| platform_fitness | 平台适配度 | 4% | 6大平台关键词匹配、平台特定规则（抖音短句/知乎长文/小红书emoji） |
| keyword_density | 关键词密度 | 3% | n-gram频率分析、核心关键词分布、堆砌检测 |
| call_to_action | 调用行动力 | 3% | CTA语句检测（关注/点赞/分享/点击/行动号召） |
| brand_consistency | 品牌一致性 | 2% | 正式/口语语气一致性检测 |

> **v1.1 维度适用性**：每个维度新增 `applicable` 字段（默认 `true`）。无原文时
> `clone_divergence` 为 `applicable=false`，其 `score`/`weighted` 为 0，不参与综合分、
> 低分警告、优化建议与最近 100 篇该维度均值；综合分按适用维度权重归一化。
> 固定 15 维外形保持不变。

### 12A.24.3 评分等级

| 分数 | 等级 | 标签 | 建议 |
|------|------|------|------|
| ≥90 | A+ | 优秀 | 适合直接发布 |
| 80-89 | A | 良好 | 适合直接发布 |
| 70-79 | B | 一般 | 建议优化短板后发布 |
| 60-69 | C | 较差 | 存在明显短板，建议针对性优化 |
| <60 | D | 差 | 多项维度不达标，建议重新改写 |

### 12A.24.4 数据校验

**输入校验**：
- `content` 必填，不能为空，至少 20 个字符
- `original_content` 可选，非空时触发克隆差异度评估
- `title` 可选，非空时用于爆款潜力评估
- `platform` 可选，默认"通用"，支持：微信/抖音/小红书/知乎/微博/B站/通用
- `style` 可选，默认"通用"

**输出结构**：
```json
{
  "overall_score": 62.9,
  "grade": "C",
  "grade_label": "较差",
  "word_count": 255,
  "dimensions": [
    {
      "id": "viral_potential",
      "label": "爆款潜力",
      "score": 64.0,
      "weight": 0.12,
      "weighted": 7.68,
      "applicable": true,
      "evidence": ["标题长度适中(15字)", "含2处数据引用"]
    }
  ],
  "summary": "内容质量较差（63分），存在明显短板，建议针对性优化后发布。",
  "warnings": ["[情感共鸣] 评分过低 (40/100)"],
  "suggestions": ["增加案例和故事...", "增加情感色彩词汇..."]
}
```

### 12A.24.5 流程逻辑

**单篇评估流程**：
1. 用户输入改写内容（可选原文、标题、平台、风格）
2. 前端调用 `POST /api/v1/quality-eval/evaluate`
3. 后端调用 `ContentQualityEvaluator.evaluate()`
4. 15 维度逐一评分，加权计算综合分
5. 生成等级、摘要、警告、建议
6. 评估结果持久化到 `quality_eval_records` 表
7. 返回完整评估报告

**改写引擎集成**：
- `AggregationService.rewrite()` 在返回结果前自动调用评估
- 评估失败不影响改写主流程（降级为 logger.warning）
- `RewriteResult.quality_report` 携带评估结果

### 12A.24.6 交互逻辑

**运营中心前端页面**（`ContentQualityEval.vue`）：
- **Tab 1 — 单篇评估**：左侧输入区（原文/改写内容/标题/平台/风格）+ 右侧结果区（综合评分/等级标签/维度进度条/警告/建议）
- **Tab 2 — 批量统计**：最新 100 篇评估记录的平均值、等级分布图、维度平均分、最近记录列表

### 12A.24.7 显示项

- 综合评分（大号数字 + 等级标签颜色）
- 评级摘要（成功/警告/错误 Alert）
- 15 维度评分进度条（绿/黄/红三色）
- 警告标签（红色）
- 优化建议标签（灰色）
- 字数统计
- 等级分布柱状图
- 最近评估记录表格（ID/评分/等级/字数/风格/平台/摘要/时间）

### 12A.24.8 提示文字

| 场景 | 提示文字 |
|------|----------|
| 内容为空 | 内容为空 |
| 内容过短 | 内容过短，至少需要 20 个字符 |
| 评估失败 | 评估失败: {error} |
| 加载统计失败 | 加载统计失败: {error} |
| 单篇评估空态 | 输入内容后点击「开始评估」 |
| 综合评分≥80 | 内容质量{等级}（{分数}分），整体表现优秀，适合直接发布。 |
| 综合评分≥70 | 内容质量{等级}（{分数}分），基本达标，建议优化短板维度后发布。 |
| 综合评分≥60 | 内容质量{等级}（{分数}分），存在明显短板，建议针对性优化后发布。 |
| 综合评分<60 | 内容质量{等级}（{分数}分），多项维度不达标，建议重新改写。 |

### 12A.24.9 质量标准

**达标线**：最近 100 篇改写结果的平均分 ≥ 70 分（B 级）。

**持续优化策略**：如果平均值低于 70 分，分析短板维度（如去AI味、逻辑性、趣味性等），针对性优化改写引擎的提示词和策略，持续迭代直到达标。

> **达标口径（v1.1）**：平均值只统计适用维度归一化后的综合分；N/A 维度不计入
> 短板分析。旧记录缺 `applicable` 时，仅克隆差异度按已存原文是否非空回退判定。

### 12A.24.10 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/quality-eval/evaluate` | 单篇评估，自动持久化 |
| GET | `/api/v1/quality-eval/records?limit=100` | 最近评估记录列表 |
| GET | `/api/v1/quality-eval/stats?limit=100` | 最近 N 篇统计（平均值/等级分布/维度平均分） |

### 12A.24.11 数据库

**表名**：`quality_eval_records`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| original_content | TEXT | 原文内容（截断10000字） |
| rewritten_content | TEXT | 改写后内容（截断10000字） |
| style | TEXT | 改写风格 |
| length | TEXT | 长度控制 |
| word_count | INTEGER | 字数 |
| overall_score | REAL | 综合评分 |
| grade | TEXT | 等级 |
| grade_label | TEXT | 等级标签 |
| dimensions_json | TEXT | 维度评分 JSON |
| summary | TEXT | 评估摘要 |
| warnings_json | TEXT | 警告列表 JSON |
| suggestions_json | TEXT | 建议列表 JSON |
| platform | TEXT | 目标平台 |
| title | TEXT | 标题（截断200字） |
| created_by | TEXT | 创建者 |
| created_at | TEXT | 创建时间 |

索引：`idx_qe_created_at`（created_at DESC）、`idx_qe_score`（overall_score）

### 12A.24.12 验收标准

1. 评估引擎可正确导入并运行，15 维度评分在 0-100 范围内
2. 改写引擎 `rewrite()` 返回结果包含 `quality_report` 字段
3. 评估失败不影响改写主流程
4. 运营中心后端 API 三端点正常响应
5. 运营中心前端页面可正常加载和交互
6. 敏感内容合规评分正确降低（测试：合规=0分）
7. AI 味内容去AI味评分明显低于人类书写内容
8. 数据库表自动创建和索引生效


## 12A.25 运营端菜单设置（左侧菜单排序）（2026-09-21 补充规格 + 一致性修复）

### 背景与定位

运营中心（OpsCenter 前端）左侧边栏的菜单顺序支持个性化调整。「菜单设置」页（路由 `/settings`，`SettingsView.vue`）是唯一的排序管理入口，与侧边栏（`App.vue`）共同消费同一数据源。

### 数据模型与单一事实源

- **菜单目录**：`src/config/menuItems.js` 的 `MENU_ITEMS`（当前 36 项），每项含 `path / label / icon`，可选 `adminOnly: true`；`DEFAULT_MENU_ORDER = MENU_ITEMS.map(i => i.path)` 为默认排序。
- **adminOnly 项（5 个）**：`/rewrite-hard-constraints` 改写硬约束、`/pipeline-options` 选项控制、`/app-menu` 应用菜单、`/feedback` 用户反馈、`/model-keys` 模型密钥。
- **可见性口径（单一事实源）**：`stores/menu.js` 的 `visibleForRole(role)` —— `!item.adminOnly || role === 'admin'`。侧边栏与菜单设置页**必须**调用该函数，禁止在消费方各自实现过滤（规则漂移是本章节修复的事故根因）。
- **持久化**：排序存 `localStorage['ops_menu_order']`（JSON 数组，仅 path 序列），重启后保留。

### 功能逻辑

1. **读取（水合）**：`readOrder()` 解析 localStorage；非法 JSON / 非数组 → 回落默认排序。
2. **数据校验（前向兼容）**：水合时过滤未知 path（防脏数据/已下线菜单残留）；默认排序中存在但已保存序列缺失的 path 追加到尾部（新增菜单项自动出现在设置页与侧边栏，无需清缓存）。
3. **上移/下移**：`move(path, ±1)`，越界（首项上移、末项下移）安全忽略；按钮在首/末行禁用。
4. **拖拽排序**：`reorderByPath(fromPath, toPath)` 按 path 定位（视图列表是角色过滤后的子集，下标与完整 order 不一致，按下标重排会移动错项——adminOnly 项造成下标漂移）。
5. **恢复默认排序**：`reset()` 将序列重置为 `DEFAULT_MENU_ORDER` 并持久化。
6. **自动保存**：每次变更立即写 localStorage，无「保存」按钮。

### 交互逻辑与显示项

- 列表行显示：拖拽把手图标、序号（从 1 起，按当前角色可见序列计）、菜单图标、菜单名称、上移/下移链接按钮。
- **显示项与角色一致性（本次修复核心）**：设置页可操作的菜单项集合必须与左侧真实侧边栏在**同一登录角色**下完全一致：
  - admin：36 项全部可操作（含 5 个 adminOnly 项）；
  - 非 admin：仅 31 个公共项（与其侧边栏一致）。
- 提示文字（卡片顶部）：「拖拽菜单项调整左侧菜单顺序，或点击箭头微调；设置会自动保存。」
- 页面标题「菜单设置」；Tab 名称「菜单排序」。

### 权限

- 路由 `/settings` 仅要求登录（`requiresAuth`）；adminOnly 菜单项对非 admin 既不在侧边栏显示、也不在设置页出现（同一口径函数保证）。

### 2026-09-21 事故与修复记录

- **现象**：admin 登录后，菜单设置页仅 31 项，侧边栏实际 36 项，用户反馈/模型密钥/改写硬约束/选项控制/应用菜单 5 项无法排序。
- **根因**：`SettingsView.vue` 硬编码 `!item.adminOnly` 过滤，未考虑角色；侧边栏用 `!adminOnly || role==='admin'`。两处规则各自维护、无单一事实源（系统性漏洞：测试场景缺失——从未断言两消费方口径一致）。
- **修复**：新增 `menuStore.visibleForRole(role)` 单一事实源；`App.vue` 与 `SettingsView.vue` 一律改为调用它。
- **回归保护**：`src/stores/menu-visibility.test.js` 4 条用例——admin 全集与 `MENU_ITEMS` 一致、非 admin 仅公共项、5 个 adminOnly 项对 admin 必须可见、重排后顺序跟随且不影响他角色视图。全量 17/17 通过，`npm run build` 通过。

### 验收标准

- [x] admin 登录：设置页行数 == 侧边栏菜单项数 == 36。
- [x] 非 admin 登录：设置页行数 == 侧边栏菜单项数 == 31。
- [x] 拖拽/上移/下移后侧边栏实时同步，刷新后顺序保留。
- [x] 恢复默认排序后回到 `MENU_ITEMS` 声明顺序。
- [x] localStorage 含未知 path 时不渲染幽灵项；新增菜单项自动补到尾部。

## 12A.26 运营端安全加固与会话治理（2026-09-22 新增，全仓代码体检整改 audit-remediation-20260922）

> 承接 `01-docs/PRD.md`「全仓代码体检整改：安全加固与质量门禁需求」总章，本节只写**运营端（ops-center）可感知**的校验规则、流程、交互与文案。
> 落地 PR：#2214（P0）、#2226（P1-5/P0-7 对齐）、#2239（P1-15 会话 + P0-6 矩阵）、#2252（N+1 / 单事务 / 行数与依赖门禁）。

### 数据校验

**启动闸门（fail-closed：任一项不通过 ⇒ 进程 `SystemExit`，服务不启动）**

| 校验 | 规则 | 失败提示（逐字，可 grep `[P0-`） |
|---|---|---|
| JWT 密钥强度 | 长度 ≥ 32 | `[P0-2] JWT secret too short (N chars); require >= 32. Generate with: openssl rand -hex 32` |
| JWT 弱值 | 命中已知弱值集合（`dev-secret-change-in-production`、`dev-secret-key-for-local-testing-2026`、`secret`、`changeme`、`default`、`admin`） | `[P0-2] JWT secret matches known weak value; refuse to start.` |
| JWT 弱前缀 | 以 `dev-` / `test-` / `changeme` / `default` 开头 | `[P0-2] JWT secret starts with '{prefix}' (development pattern); production must use a strong random secret.` |
| 管理员口令 | 不在弱口令表、生产非空、长度 ≥ 8 | `[P0-2] Admin password is in known-weak list; choose a strong password (>= 8 chars).` / `[P0-2] Admin password must be set in production (OPS_ADMIN_PASSWORD).` / `[P0-2] Admin password too short (N); minimum 8 characters.` |
| CORS | `credentials=True` 时 `allow_origins` 禁 `*` | `[P0-6] CORS allow_origins='*' with credentials=True is insecure; specify explicit whitelist (e.g. https://app.example.com).` |
| 加密主密钥 | `OPS_ENCRYPTION_KEY` 必填；仅 `OPS_ALLOW_EPHEMERAL_KEY=true` 可临时放行（必打 warn） | `[P0-4] OPS_ENCRYPTION_KEY not configured. Generate: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| 运行时签名私钥 | 未配置 ⇒ `/api/v1/runtime/bootstrap` 返回 404（不下发未签名配置） | — |

**会话 Cookie 属性**：`session_cookie_name=ops_session`、`httponly=True`（不可配置）、`session_cookie_samesite ∈ {lax,strict,none}` 默认 `lax`、`session_cookie_secure: Optional[bool]=None`（`None` ⇒ 非 development 即 `True`）、`max_age` 由 `session_cookie_max_age_hours` 推导、`path=/`（签发与清除必须同 path）。

**配置项密文**：`is_secret=1` 的 `ConfigItem.value` **写库前** Fernet 加密；审计日志只存掩码；客户端回填的掩码回显值不覆盖真实凭据（留痕 `[P1-5] {config_id}: 提交了掩码回显值，保留原凭据不覆盖`）。批量接口与单条接口共用 `_apply_upsert`，敏感判定以**库中既有标记**为准（批量入参不含 `is_secret`，防止把敏感项降级成明文写入）。

### 功能逻辑

1. **双通道鉴权**：`Authorization: Bearer <jwt>` 优先（桌面端/脚本/scheduler 上报，不受 CSRF 头约束；Bearer 非法直接 401，**不回落** Cookie）；无 Bearer 时读 HttpOnly 会话 Cookie。
2. **CSRF 第二层**：`SameSite=Lax` 只挡跨站子请求/POST，故非幂等方法（除 `GET/HEAD/OPTIONS/TRACE` 外）必须再带自定义头 `X-Ops-Session`（`settings.csrf_header` 可改）。跨站页面无法设置自定义头（过不了预检），据此判定请求来自本前端。
3. **安全响应头中间件**（`setdefault`，不覆盖 nginx/CDN 已下发值）：`Content-Security-Policy`（`default-src 'self'` + `frame-ancestors 'none'` + `object-src 'none'` + `base-uri 'self'` + `form-action 'self'`；**配置为空串 ⇒ 显式不下发**，避免双重头被取交集后失效）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`。
4. **SSRF 守卫**：`test_provider_connection` 与 `fetch_models_from_url` 共用 `_validate_target_url`（无 hostname、`localhost`/`0.0.0.0`/`::1`/`[::1]`/`metadata.google.internal` 及私网解析结果一律拒绝）；async 路由内的 DNS 解析走 `await asyncio.to_thread(...)`，不阻塞事件循环。**已声明残余风险**：校验解析与实际连接是两次独立 DNS 解析，存在 DNS 重绑定窗口。
5. **批量更新单事务**：`batch_upsert_configs` = 1 次按主键批量预取 + 逐条 `_apply_upsert(commit=False)` + 单次 `COMMIT`，异常统一 rollback 后上抛（旧实现逐条 commit，中途失败留半更新状态）。
6. **N+1 消除**：配置计数与审计日志掩码改为批量预取（`get_configs_by_ids` / `get_secret_flags`，`id.in_(ids)`），替代逐行 SELECT（原最多 1000 次）。

### 交互逻辑（管理后台前端）

- 登录成功响应体**不含 token**，只回 `{username, role, expires_in, csrf_header}`；会话状态由浏览器 Cookie 承载，`document.cookie` 读不到 ⇒ XSS 无法外带凭据。
- 所有请求走统一客户端 `src/api/http.js` 的 `createApiClient()`：`withCredentials: true`，写操作自动注入 `X-Ops-Session: 1`。
- **401**（无凭据 / 令牌无效或过期）→ 清理内存登录态并跳登录页，杜绝「半登录态」。
- **403**（权限不足 或 缺 CSRF 头）→ 属业务/调用方问题，**不清登录态**，避免一次误操作把管理员踢下线。
- 会话水合入口：`GET /api/auth/me`（别名 `GET /api/auth/session`，同一实现）；登出 `POST /api/auth/logout` 不要求认证与 CSRF 头（无副作用，且会话过期时也必须可点）。
- 登录限速保持：同 `username|ip` 连续 5 次失败锁 60 秒。

### 显示项与提示文字

| 场景 | 码 | 文案 |
|---|---|---|
| 无凭据 | 401 | `未提供认证令牌` |
| 令牌无效/过期 | 401 | `令牌无效` |
| 口令错误 | 401 | `用户名或密码错误` |
| 尝试过多 | 429 | `尝试次数过多，请稍后再试` |
| 缺 CSRF 头 | 403 | `跨站请求伪造防护：基于 Cookie 会话的写操作必须携带自定义头 X-Ops-Session（前端 axios 拦截器默认注入）` |
| 非管理员 | 403 | `需要管理员权限` |
| JWT 密钥未配置 | 503 | `认证服务配置不完整` |
| 未配置管理员账号 | 503 | `未配置管理员账号，请设置 OPS_ADMIN_USERNAME/OPS_ADMIN_PASSWORD` |
| SSRF 拦截 | 400（ValueError 上抛） | `[P0-7] URL has no hostname` / `[P0-7] Blocked internal address: {hostname}` |
| 启动成功 | 日志 | `[P0] All startup security checks passed.` |

### 回归保护（QM-5 第四步）

- 后端：`tests/test_p1_15_session_cookie.py`（Cookie 只落 HttpOnly、401/403 语义、缺头 403、登出清 Cookie、密钥缺失 503）、`tests/test_auth_login.py`、`tests/test_p0_security.py`（启动闸门）、`tests/test_p4_txn_and_queries.py`（单事务回滚 + 批量预取）。
- 前端：`tests/http-client.test.js`、`tests/auth-store.test.js`、`tests/menu-store.test.js`。
- CI 防复发：**Gate 18** `node .github/scripts/check-ops-session-hygiene.js`（必存在结构：`response.set_cookie(`、`httponly=True`、`samesite=settings.session_cookie_samesite`、`def logout`、`delete_cookie(`、`async def security_headers` + 三类头、`export const CSRF_HEADER = 'X-Ops-Session'`、`withCredentials: true`、`status === 401`；禁用模式：view 自建 axios、token 落 localStorage）；**Gate 17** IPC 守卫覆盖（桌面端）。
- 债务门禁：`node .github/scripts/check-max-lines.js`（含 Python 对等口径，`model_preset_service.py` / `prompt_eval_service.py` 已挂账）、`node scripts/check-dep-audit.js`（npm + pip-audit 实跑，29 条挂账带 `decision` 与 `reviewBy`）。

### 运维指引

- 密钥与令牌轮换、双钥宽限期、`EnvironmentFile=` 注入与 `User=ops-center` 降权：见 `ops-center/deploy/KEY-ROTATION-GUIDE.md`、`ops-center/deploy/ops-center.service`、`ops-center/deploy/setup-service.sh`。
- 反向代理需下发/透传 `X-Ops-Session` 允许的自定义头，并把 CORS 白名单与实际前端 origin 一一对应（子域需显式列出）。

### 验收标准

- [x] 危险组合（CORS `*` + credentials）启动即拒绝，断言测试存在且通过。
- [x] 登录成功后 `document.cookie` 无法读到会话令牌；清 localStorage 不影响已登录会话。
- [x] 写操作缺 `X-Ops-Session` ⇒ 403 且前端不清登录态；401 ⇒ 清态并跳登录。
- [x] `is_secret` 配置项在库中为 Fernet 密文；掩码回显提交不覆盖真实凭据；批量更新中途失败整批回滚。
- [x] Gate 17/18、max-lines、dep-audit 四项在 CI 阻断回退写法。
- [ ] `routers/env.py` 的 JWT 对齐诊断端点：在非 orchestrator 环境恒返回 `unknown`，处置为「在 orchestrator/trendscope 环境补跑或移除该端点」（体检报告 v5 裁定，属部署配置问题，非死代码）。
