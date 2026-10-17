---
record: everos-mcp-cross-app-grids
task: 把本机 EverOS 记忆服务接入 DSH（MCP 注册 + 跨 app 检索面修复 + 探测残留清理）
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 不存在
sync_backfill_owner: 下一个会话（合并后回填 PASS + merge SHA 并删除本段三个 sync_* 字段）
---

## 本次执行记录：EverOS MCP 接入 DSH + 跨 app 检索面修复 + 探测残留清理（everos-mcp-cross-app-grids，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档变更**：只改 `01-docs/learnings.md` + 新增本记录文件 ⇒ 走 docs-only 快速通道，共享主工作区就地编辑 + PR 落地，不进 worktree。`git status --porcelain` 在开写前为空，`git merge --ff-only origin/main` 已把 `e7473cdb4` → `f818c214e`（上游对 `learnings.md` 的 44 行新增已吸收，无未吸收上游改动） |
| 本仓运行时代码 | ✅ 未触碰 | 两处**非本仓**改动按其自身机制走，不经本仓门禁：① `<user-home>/.dsh/profiles/desktop/cordis.patch.yml` 追加 `mcp-everos` 条目（DSH 自身 cordis patch 层，备份 `cordis.patch.yml.bak-everosmcp-20261017-002210`，`yaml.safe_load` 解析 9 条目、目标条目字段逐项核对，CRLF=0/LF=248/BOM=False）；② `~/.everos/everos-mcp-server.py` v1.8 → v1.9（EverOS 自有仓，备份 `.bak-dsh-crossapp-20261017-004135`，`py_compile` 通过） |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未触 `apps/desktop/`、`packages/`，无打包面、无 UI 变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机 `codeagent-wrapper` 不可用；本片为文档沉淀 + 外部服务配置，无本仓代码可评审。如实登记为**未执行** |
| 行尾与 diff 对账 | ✅ | 追加式写入，两口径 `--numstat` 与 `--ignore-cr-at-eol --numstat` 一致（无行尾改写） |
| 品牌残留 | ✅ | 无竞品品牌词；EverOS 是自有开源组件名，非门禁对象 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin everos-mcp-cross-app-grids` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

### 交付物与判据

| 项 | 判据 | 实测 |
|---|---|---|
| EverOS 服务可达 | `/health` 200 + cascade healthy | v1.4.1，`healthy=true`、`pending=0`；`GET /health` 三次 42/156/956ms |
| MCP 握手 | 独立进程跑 JSON-RPC `initialize` + `tools/list` | `everos-memory v1.9.0-cross-app-grids`，4 工具：`everos_search` / `everos_add` / `everos_get` / `everos_health` |
| 写入契约三层 | ①接口 ②落盘 ③检索读回 | ①`add=accumulated`→`flush=extracted`；②`episode-2026-10-16.md` grep 到哨兵 `DSHUSAGEPROBE7`；③`search` 命中 score=0.294 |
| 跨 app 检索面 | v1.9 后 `dsh/` 分区可见 | 同一查询命中 `[dsh/Mulpub-17875af60fc6@to_co] score=0.40`，v1.8 下该格完全不可见；有效命中 27 条 score≥0.25 |
| 并发收益 | 12 格端到端 | 串行 12.0s → 并发 **3.08s**（含进程启动） |
| 探测残留清理 | 删除数 + 哨兵消失 + 保真 | episode 删 1（`ep_20261016_00000010`）、atomic_fact 删 3（`af_141/142/143`）；`entry_count` 11→10 / 167→164；哨兵与 `dsh-probe-20261016` 在两个文件与索引中均 0 命中；CRLF=LF（0 裸 LF）、无 BOM、条目编号连续；10-16 真实条目 00000001~00000009 + 00000011 完整保留 |

### 配置写入位置（DSH MCP 注册的实证路径）

本机 DSH 的 MCP 服务器配置**不在** `~/.dsh/settings.yaml`（该文件当前不存在，只有历史 `.bak-*`），也不在 `profiles/web/cordis.patch.yml`。实际生效面是**当前会话所用 profile 的 cordis patch 层**：

```
<user-home>/.dsh/profiles/desktop/cordis.patch.yml
```

判定「哪个 profile 是当前会话」用的是**交叉证据**而非猜：该文件 `agent-default-model` 段写的 `provider: workbuddy-manager` + `model: cn:hy4-preview-f`，与本会话实际模型一致；且该文件 mtime 与其它会话活动吻合。

配置形态取自 `app.asar` 内 `@deepseek-ai/dsh-mcp-client` 的 schema 与官方 README（字段逐一对照，非猜测）：`transport: stdio`、`serverName`（须匹配 `^[A-Za-z0-9_-]{1,32}$`）、`command`（**绝对路径**）、`args`、`failOnStartupError`、`reconnect`。`command` 用 `<python-exe>` 而非 `python` —— PATH 上的 `python` 解析到 `<python-cmd-stub>`（31 字节的转发存根），对 stdio 型 MCP 是风险面。

### 残留风险（不假装已闭合）

1. **MCP 注册尚未在本会话生效**：工具列表在会话启动时加载，本轮改动（cordis 注册 + 脚本 v1.9）需重启 DSH 后才可见。**未验证「重启后 everos_* 出现在工具列表」**——这是本次交付最大的未闭合项。
2. **`READ_GRIDS` 是快照，会漂移**：12 格来自 2026-10-17 一次固定查询的实测排序，新写入的 project/owner 不会自动进入清单（只会在调用方显式指定 `project` 时被覆盖）。清单本身加了「加格安全、删格危险」的约定，但没有任何机械锁保证它被更新。
3. **`agent-memory-import`、`qoder/mulpub-17875af6@to_co` 等低分格未纳入默认清单**：实测 best=0.14 / 0.19，低于 0.25 门槛，纳入只会增加请求数而不产生有效命中。这是权衡而非遗漏。
4. **DSH 配置的 profile 判定依赖交叉证据**：没有找到「当前会话用哪个 profile」的权威 API，若将来 desktop/web 双 profile 同时活跃，需要在 `profiles/web/cordis.patch.yml` 同步一份（该文件 2026-09-30 起注释记录 `mcp-ruflo` 因疑似卡死被禁用，加 MCP 条目需评估同类风险）。
5. **EverOS 侧 3 条 `failed_permanent` 未处置**：与本次改动无关的历史脏数据（`/health` 报 `failed_permanent=7`），不影响读写，但会让「永久失败」这个指标长期非零，属既有状态而非本次引入。
