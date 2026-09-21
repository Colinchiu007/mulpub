# EverOS + Cognee 双记忆系统使用手册

> **日期**：2026-09-02
> **环境**：WSL Ubuntu-E（D:\wsl\Ubuntu-E），Windows 11 宿主机
> **API 提供方**：天翼云 DeepSeek API（OpenAI 兼容格式）
> **无需本地 GPU / Ollama**，全部使用云 API

---

## 0. ⚠️ 2026-09-21 环境变更（必读，与下文 WSL 章节冲突时以本节为准）

**EverOS 已从「WSL + Windows 双实例端口竞争」合并为 Windows 单实例。** 本手册 §2–§8 中的 WSL 命令（`/api/v2`、端口 8002、`~/everos-venv`）为历史记录，仍然适用Cognee；EverOS 部分请按本节执行。

| 项 | 现行事实（2026-09-21 实测） |
|---|---|
| 安装位置 | `C:\Python312\Scripts\everos.exe`，版本 **1.0.2**（WSL 的 1.2.3 已卸载） |
| 监听 | `127.0.0.1:8000`，owner 为原生 `python.exe`（不再是 `wslrelay.exe`） |
| API 前缀 | **`/api/v1/memory/{add,flush,search}`**（不是 v2） |
| 启动 | `everos server start --host 127.0.0.1 --port 8000` |
| 日志 | `C:\Users\<user>\.everos\server-8000.out.log` / `.err.log` |
| 配置文件 | **`~/.everos/config.toml`**（旧文件名 `everos.toml` **从未被加载**）；可经 `EVEROS_CONFIG_FILE` 覆盖 |
| 端口配置段 | **`[api]`**（写成 `[server]` 不生效） |
| 配置优先级 | `init_args` > `EVEROS_*` 环境变量 > `./.env` > `~/.everos/config.toml` > 包内 `default.toml` |
| 向量能力 | `vector_search` / `hybrid_search` **已打开**（1.0.2 无需升级，`/search` 默认即 `hybrid`） |
| embedding | 云端 siliconflow `BAAI/bge-m3`（实测 1024 维），本地 `nomic-embed-text` **保持闲置** |
| WSL 数据归档 | `D:\Data\everos-wsl-archive\everos-wsl-snapshot-20260921T153219.tgz`（23461B / 177 条目） |

### 0.1 写入必须 add + flush 两步（最易踩的坑）

`POST /api/v1/memory/add` 只把消息放进 `session_id` 会话缓冲，返回 `status: accumulated | extracted`；**`accumulated` 不等于已落盘可检索**。必须再调：

```bash
curl -X POST http://localhost:8000/api/v1/memory/flush \
  -H 'Content-Type: application/json' \
  -d '{"session_id": "mcp-20260921", "app_id": "multi-publish", "project_id": "default"}'
# -> {"data": {"status": "extracted"}}  才算真正抽取为 memcell/episode/atomic_fact
# -> "no_extraction"  表示缓冲为空或未被抽取，不得当作成功
```

成功判据只看 `flush == "extracted"`；最终产物可在 `~/.everos/<app_id>/<project>/users/<sender>/{episodes,.atomic_facts}/<date>.md` 逐项 grep 复核。

### 0.2 1024 维硬约束（为何不能接本地 768 维模型）

LanceDB 五张表（`agent_case` / `agent_skill` / `atomic_fact` / `episode` / `foresight`）的 `vector` 列均为 `fixed_size_list<float>[1024]`，`_DIM = 1024` 在源码**硬编码**，`EmbeddingSettings` 无 `dim` 字段，provider 只做 `embedding[:dim]` **截断不补齐**。因此 768 维模型（如 ollama `nomic-embed-text`）既写不进列，零填充也会因跨模型向量空间余弦不可比而让存量 7600+ 条真实向量静默失真。换 embedding 模型的前提是改表结构并全量重建索引。

### 0.3 Windows 文本编码陷阱

写 `config.toml` 等被 `tomllib` 解析的文件时，PowerShell 5.1 的 `Set-Content -Encoding UTF8` **会写 BOM 导致解析失败**，必须用：

```powershell
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
```

MCP 包装脚本（`~/.everos/everos-mcp-server.py`）的 stdin 需 `sys.stdin.reconfigure(encoding="utf-8")`，否则 Windows 默认按 ANSI 码页解码，中文记忆静默乱码。

### 0.4 1.0.2 与 1.2.3 的能观测差异

1.0.2 的 `/health` 只返回 `{"status":"ok"}`，**没有** `capabilities` / `disabled_features` 字段；能力开关必须靠功能实测判断（同一 query 下 `keyword` 与 `hybrid` 的排序/条数是否变化）。

---

## 目录

0. [⚠️ 2026-09-21 环境变更（必读）](#0-️-2026-09-21-环境变更必读与下文-wsl-章节冲突时以本节为准)
1. [架构概览](#1-架构概览)
2. [前置：配置 API Key（仅需一次）](#2-前置配置-api-key仅需一次)
3. [EverOS 使用指南](#3-everos-使用指南)
4. [Cognee 使用指南](#4-cognee-使用指南)
5. [两者配合：组合使用模式](#5-两者配合组合使用模式)
6. [Agent 接入指南](#6-agent-接入指南)
7. [多设备迁移](#7-多设备迁移)
8. [日常运维](#8-日常运维)
9. [故障排查](#9-故障排查)

---

## 1. 架构概览

```
┌────────────────────────────────────────────────────────────┐
│                    你的所有 Agent                           │
│  Claude Code / Codex / OpenCode / Hermes / DSH / Trae ...  │
│         │                    │                    │        │
│         └────────────────────┼────────────────────┘        │
│                              │ MCP 协议                     │
│              ┌───────────────┼───────────────┐             │
│              ▼               ▼               ▼             │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │    EverOS :8002  │  │   Cognee :8000   │               │
│  │  Markdown 存储层  │  │  知识图谱检索层   │               │
│  │                  │  │                  │               │
│  │  ~/.everos/      │  │  ~/.cognee/      │               │
│  │  ├── memcells/   │  │  ├── data/       │               │
│  │  ├── profiles/   │  │  ├── logs/       │               │
│  │  └── wiki/       │  │  └── graph/      │               │
│  └────────┬─────────┘  └────────┬─────────┘               │
│           │                     │                          │
│           └──────────┬──────────┘                          │
│                      │                                     │
│              天翼云 DeepSeek API                            │
│              https://eaichat.ctyun.cn                       │
│              (OpenAI 兼容格式)                               │
└────────────────────────────────────────────────────────────┘
```

**两个系统的分工**：

| 职责 | EverOS | Cognee |
|---|---|---|
| **存储格式** | Markdown 文件（人类可读） | 嵌入式数据库（SQLite+LanceDB+Ladybug） |
| **核心能力** | 记忆写入→提取→索引→检索 | 知识图谱构建→实体关系→多跳推理 |
| **检索方式** | BM25（关键词）+ 向量（语义） | 知识图谱遍历 + 向量相似度 |
| **适合场景** | 日常记忆、事实记录、偏好存储 | 复杂关系查询、跨记忆关联发现 |
| **可迁移性** | ⭐⭐⭐⭐⭐ Git 版本化 Markdown | ⭐⭐⭐⭐ cogx 归档导出导入 |
| **人类可读** | ✅ 直接 `cat`/`grep` | ❌ 需通过 CLI/API 查询 |

---

## 2. 前置：配置 API Key（仅需一次）

### 获取你的天翼云 API Key

在 DSH 中运行：
```
查看当前使用的 API Key
```

或者在 DSH 的设置中查看 `TIANYI_DP4F_API_KEY` 的值。

### 注入到 EverOS 和 Cognee

拿到 key 后，运行以下命令（我已经帮你写好，只需替换 `YOUR_KEY_HERE`）：

```bash
# 进入 WSL
wsl -d Ubuntu-E

# 设置 API Key
export TIANYI_KEY="YOUR_KEY_HERE"

# 注入 EverOS
sed -i "s|api_key = .*|api_key = \"$TIANYI_KEY\"|" ~/.everos/everos.toml

# 注入 Cognee 环境变量
echo "export LLM_API_KEY=\"$TIANYI_KEY\"" >> ~/.cognee-env
echo "export LLM_BASE_URL=\"https://eaichat.ctyun.cn/ai/platform/v2/cp\"" >> ~/.cognee-env
echo "export LLM_MODEL=\"deepseek-v4-flash-0731-oc\"" >> ~/.cognee-env

# 验证
cat ~/.everos/everos.toml | grep api_key
source ~/.cognee-env && echo $LLM_MODEL
```

> **注意**：天翼云 API 可能不支持 embedding（`text-embedding-3-small`）。如果 EverOS 启动时报 embedding 错误，改为 keyword-only 模式即可（见故障排查）。

---

## 3. EverOS 使用指南

### 3.1 启动服务

```bash
# 进入 WSL
wsl -d Ubuntu-E

# 设置 PATH
export PATH="$HOME/.local/bin:$PATH"

# 启动 EverOS（前台，可以看到日志）
everos server start

# 或后台启动
nohup everos server start > /tmp/everos.log 2>&1 &

# 验证
curl http://localhost:8002/health
```

### 3.2 写入记忆

```bash
# 单条记忆
curl -X POST http://localhost:8002/api/v2/memory/add \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "my-session-001",
    "user_id": "me",
    "app_id": "default",
    "project_id": "default",
    "messages": [
      {"role": "user", "content": "抖音晚8点发布科技类内容互动率比早间高35%"}
    ]
  }'

# 多条记忆（一次写入多轮对话）
curl -X POST http://localhost:8002/api/v2/memory/add \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "my-session-001",
    "user_id": "me",
    "app_id": "default",
    "project_id": "default",
    "messages": [
      {"role": "user", "content": "抖音晚8点发布科技类内容互动率比早间高35%"},
      {"role": "user", "content": "知乎长文（>1500字）比短文效果好，收藏率高出2倍"},
      {"role": "user", "content": "微博带图片的帖子转发率比纯文字高3倍"}
    ]
  }'
```

### 3.3 刷新记忆（flushing）

EverOS 写入后不会立即索引——需要 **flush** 才会触发 LLM 提炼和索引：

```bash
curl -X POST http://localhost:8002/api/v2/memory/flush \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "my-session-001",
    "app_id": "default",
    "project_id": "default"
  }'
```

flush 后 EverOS 会：
1. LLM 提炼原子事实（atomic facts）
2. 写入 Markdown 文件（`~/.everos/memcells/`）
3. 更新 BM25 + 向量索引
4. 触发 reflection（如果有足够数据）

### 3.4 检索记忆

```bash
# 关键词检索（不需要 embedding，零 API 调用）
curl -X POST http://localhost:8002/api/v2/memory/search \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "me",
    "app_id": "default",
    "project_id": "default",
    "query": "抖音什么时间发布效果好",
    "method": "keyword",
    "top_k": 5
  }'

# 混合检索（需要 embedding 配置）
curl -X POST http://localhost:8002/api/v2/memory/search \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "me",
    "app_id": "default",
    "project_id": "default",
    "query": "什么平台适合长文",
    "method": "hybrid",
    "top_k": 5
  }'
```

### 3.5 查看 Markdown 记忆文件

```bash
# 直接查看记忆目录
ls ~/.everos/memcells/
cat ~/.everos/memcells/*.md

# Git 版本化（可选但推荐）
cd ~/.everos
git init
git add -A && git commit -m "记忆快照 $(date +%Y%m%d)"
```

### 3.6 5 维正交检索

EverOS 支持 5 维隔离，你可以按不同维度组织记忆：

| 维度 | 含义 | 示例 |
|---|---|---|
| `user_id` | 用户 | "me" / "alice" |
| `agent_id` | Agent | "ai-writer" / "prompt-engine" |
| `app_id` | 应用 | "multi-publish" |
| `project_id` | 项目 | "douyin-campaign" |
| `session_id` | 会话 | "session-2026-09-02" |

```bash
# 写入时指定维度
curl -X POST ... -d '{
  "user_id": "me",
  "agent_id": "ai-writer",
  "app_id": "multi-publish",
  "project_id": "douyin-campaign",
  ...
}'

# 检索时按维度过滤
curl -X POST ... -d '{
  "user_id": "me",
  "agent_id": "ai-writer",
  "project_id": "douyin-campaign",
  "query": "发布效果",
  ...
}'
```

---

## 4. Cognee 使用指南

### 4.1 启动服务

```bash
# 进入 WSL
wsl -d Ubuntu-E

# 加载环境变量
source ~/.cognee-env

# 启动 Cognee（本地模式，端口 8000）
cognee-cli -ui

# 验证
curl http://localhost:8000/health
```

### 4.2 写入记忆（remember）

```bash
# 单条记忆
cognee-cli remember "抖音晚8点发布科技类内容互动率比早间高35%"

# 多条记忆
cognee-cli remember "抖音晚8点发布科技类内容互动率比早间高35%。知乎长文比短文收藏率高2倍。微博带图转发率比纯文字高3倍。"

# 也可以从文件导入
cognee-cli remember /path/to/notes.md
```

### 4.3 检索记忆（recall）

```bash
# 关键词检索
cognee-cli recall "抖音什么时间发布效果好"

# 语义检索
cognee-cli recall "哪个平台适合长篇内容"

# 跨记忆关联
cognee-cli recall "科技类内容在哪些平台效果好"
```

### 4.4 知识图谱操作

```bash
# 查看知识图谱
cognee-cli recall "show me the knowledge graph"

# 忘记某条记忆
cognee-cli forget --id <memory_id>

# 改进记忆（让 LLM 重新提炼）
cognee-cli improve
```

### 4.5 导出/导入（多设备迁移）

```bash
# 导出记忆归档
cognee-cli export --format cogx --output /tmp/my-memories.cogx

# 复制到新电脑后导入
cognee-cli remember /tmp/my-memories.cogx
```

---

## 5. 两者配合：组合使用模式

### 模式 1：双写（推荐）

每次重要信息同时写入两个系统：

```bash
# 发布一条抖音后，记录效果
MEMORY="抖音9月1日晚8点发布科技类内容，2小时互动率4.2%，比均值3.1%高35%"

# 写入 EverOS（Markdown 存储，人类可读，Git 版本化）
curl -X POST http://localhost:8002/api/v2/memory/add \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"publish-$(date +%s)\",\"user_id\":\"me\",\"app_id\":\"multi-publish\",\"project_id\":\"default\",\"messages\":[{\"role\":\"user\",\"content\":\"$MEMORY\"}]}"

# 写入 Cognee（知识图谱，关联检索）
source ~/.cognee-env
cognee-cli remember "$MEMORY"
```

### 模式 2：EverOS 为主，Cognee 为索引

```
Agent 写入 → EverOS（canonical source）
                  │
                  ▼
          ~/.everos/memcells/*.md
                  │
                  ▼
          Cognee 定期导入（cognee-cli remember ~/.everos/memcells/）
                  │
                  ▼
          知识图谱（实体关系、多跳推理）
```

实现：

```bash
# 每天定时同步一次
cognee-cli remember ~/.everos/memcells/
```

### 模式 3：检索时双路查询

```bash
# 查询"什么内容在抖音效果好"
# 路径 1：EverOS 关键词检索 → 精确匹配
curl -X POST http://localhost:8002/api/v2/memory/search \
  -d '{"user_id":"me","app_id":"default","project_id":"default","query":"抖音效果好","method":"keyword","top_k":5}'

# 路径 2：Cognee 语义检索 → 关联发现
source ~/.cognee-env
cognee-cli recall "抖音效果好"
```

### 模式 4：EverOS 读，Cognee 发现

- **日常查询**：用 EverOS（快速、精确、可读 Markdown）
- **深度分析**：用 Cognee（发现"科技类内容"和"晚8点"之间的关联，发现"微博带图"和"转发率"的因果关系）

---

## 6. Agent 接入指南

### 6.1 Claude Code 接入

在 Claude Code 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "cognee": {
      "command": "wsl",
      "args": ["-d", "Ubuntu-E", "bash", "-c", "source ~/.cognee-env && cognee-mcp"]
    },
    "everos": {
      "command": "wsl",
      "args": ["-d", "Ubuntu-E", "bash", "-c", "everos-mcp"]
    }
  }
}
```

### 6.2 Codex 接入

Codex 通过 MCP 协议接入，配置同上。

### 6.3 DSH（已在 WSL 内）接入

DSH 与 EverOS/Cognee 同在 WSL 内，直接 localhost 访问：

```yaml
# DSH MCP 配置
mcp:
  servers:
    cognee:
      command: bash
      args: ["-c", "source ~/.cognee-env && cognee-mcp"]
    everos:
      url: http://localhost:8002
```

### 6.4 Hermes / OpenClaw 接入

与 DSH 相同的 MCP 配置。

### 6.5 自定义 Agent 接入

```javascript
// Node.js 通过 REST API 调用
// EverOS
const response = await fetch('http://localhost:8002/api/v2/memory/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: 'me',
    app_id: 'multi-publish',
    project_id: 'default',
    query: '抖音什么时间发布效果好',
    method: 'keyword',
    top_k: 5
  })
});

// Cognee
const { execSync } = require('child_process');
const result = execSync(
  'wsl -d Ubuntu-E bash -c "source ~/.cognee-env && cognee-cli recall \'抖音效果好\'"',
  { encoding: 'utf-8' }
);
```

---

## 7. 多设备迁移

### 7.1 EverOS 迁移（Markdown + Git）

```bash
# 旧电脑
cd ~/.everos
git init && git add -A && git commit -m "完整记忆备份"
git remote add origin <your-git-repo>
git push -u origin main

# 新电脑
git clone <your-git-repo> ~/.everos
everos server start
```

### 7.2 Cognee 迁移（cogx 归档）

```bash
# 旧电脑
cognee-cli export --format cogx --output ~/memories-backup.cogx

# 新电脑
cognee-cli remember ~/memories-backup.cogx
```

### 7.3 完整 WSL 发行版迁移

```bash
# 旧电脑：导出整个 WSL 发行版
wsl --export Ubuntu-E D:\wsl-export\ubuntu-e.tar

# 新电脑：导入
wsl --import Ubuntu-E D:\wsl\Ubuntu-E D:\wsl-export\ubuntu-e.tar
```

---

## 8. 日常运维

### 启动所有服务

```bash
# 在 WSL 中
export PATH="$HOME/.local/bin:$PATH"

# 启动 EverOS
nohup everos server start > /tmp/everos.log 2>&1 &

# 启动 Cognee
source ~/.cognee-env
nohup cognee-cli -ui > /tmp/cognee.log 2>&1 &

# 验证
curl http://localhost:8002/health  # EverOS
curl http://localhost:8000/health  # Cognee
```

### 停止所有服务

```bash
pkill -f "everos server"
pkill -f "cognee-cli"
```

### 备份记忆

```bash
# EverOS: Git 自动备份
cd ~/.everos && git add -A && git commit -m "auto-backup $(date +%Y%m%d-%H%M)"

# Cognee: 导出归档
cognee-cli export --format cogx --output ~/backups/cognee-$(date +%Y%m%d).cogx
```

### 查看日志

```bash
tail -f /tmp/everos.log
tail -f /tmp/cognee.log
tail -f ~/.cognee/logs/*.log
```

---

## 9. 故障排查

### 问题 1：EverOS 启动报 "LLM api_key is not configured"

**原因**：API key 未注入或不正确。

**解决**：
```bash
# 检查配置
cat ~/.everos/everos.toml | grep api_key

# 如果为空，手动填入
vim ~/.everos/everos.toml
# 将 api_key = "" 改为 api_key = "你的天翼云key"
```

### 问题 2：EverOS 启动报 embedding 错误

**原因**：天翼云 API 可能不支持 `text-embedding-3-small`。

**解决**：使用 keyword-only 模式（不需要 embedding）：
```bash
# 检索时指定 method: keyword
curl ... -d '{"method":"keyword",...}'
```

或者配置支持的 embedding 模型（如 bge-m3 via SenseNova）。

### 问题 3：Cognee 启动报 LLM 连接错误

**原因**：环境变量未加载。

**解决**：
```bash
source ~/.cognee-env
echo $LLM_API_KEY  # 应该显示你的 key
echo $LLM_BASE_URL # 应该显示 https://eaichat.ctyun.cn/ai/platform/v2/cp
```

### 问题 4：Windows Agent 无法访问 WSL 服务

**原因**：WSL2 网络问题。

**解决**：
```powershell
# 在 Windows PowerShell 中
# 重启 WSL 网络
wsl --shutdown
wsl -d Ubuntu-E

# 重新启动服务
wsl -d Ubuntu-E bash -c "everos server start"
```

### 问题 5：端口被占用

```bash
# 查看端口占用
ss -tlnp | grep -E "8000|8002"

# 杀死占用进程
kill -9 <PID>
```

---

## 附录：快速命令速查

```bash
# === 进入 WSL ===
wsl -d Ubuntu-E

# === EverOS ===
everos server start                           # 启动
curl http://localhost:8002/health             # 健康检查
curl -X POST .../memory/add -d '{...}'        # 写入记忆
curl -X POST .../memory/flush -d '{...}'      # 刷新（触发提炼）
curl -X POST .../memory/search -d '{...}'     # 检索记忆

# === Cognee ===
source ~/.cognee-env                           # 加载环境变量
cognee-cli -ui                                 # 启动
cognee-cli remember "..."                      # 写入记忆
cognee-cli recall "..."                        # 检索记忆
cognee-cli forget --id <id>                    # 删除记忆
cognee-cli export --format cogx --output <file> # 导出
cognee-cli remember <file.cogx>                # 导入

# === 备份 ===
cd ~/.everos && git add -A && git commit -m "backup"  # EverOS 备份
cognee-cli export --format cogx --output ~/backup.cogx # Cognee 备份
```

---

*本手册由实际安装配置生成，所有命令已在 WSL Ubuntu-E 环境中验证路径正确。*