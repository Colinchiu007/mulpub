---
record: ops-identity-deploy
task: 桌面端部署配置指向已上线的运营中心（opsCenterUrl + runtimePublicKey）
date: 2026-10-18
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按 AGENTS.md 合并后收尾清单回填并删除本段三字段）
---

## 本次执行记录：桌面端部署配置指向已上线的运营中心（ops-identity-deploy，2026-10-18）【配置变更】

判定证据：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false`**（改 `config/identity-public.json`，属运行时配置，不借道文档快通道）。

### 背景：这一格为什么现在才填得上

此前 `config/identity-public.json` 的两个字段都是**占位/缺失**：

| 字段 | 改前 | 问题 |
|---|---|---|
| `opsCenterUrl` | `https://ops.iart.work` | 该域名**无 DNS 记录**，SSL 不通，桌面端拉不到任何运营配置 |
| `runtimePublicKey` | **缺失** | 打包版（packaged）会命中 `NO_PRODUCTION_TRUST_ANCHOR`，同步被拒 |

要填对这两个值，必须先让**服务端真的可用**。本次前置工作（2026-10-17～18，ops 部署）：

1. **nginx**：在 `www.iart.work` 的 443 server 块加 `location ^~ /ops/` 与 `location ^~ /api/ops/`。
2. **后端**：2026-07-01 版本（111 路由中的大部分都不存在）同步到 `origin/main`。
3. **前端产物**：rebuild（服务器上是旧产物，仍引用裸 `/assets/`，在 `/ops/` 子路径下必然 404 白屏）。
4. **启用运行时签名**：生成 Ed25519 密钥对，私钥入 systemd drop-in。
5. **配置 catalog key**：让 `/api/v1/runtime/bootstrap` 从 fail-closed 404 变为可用。

### 取值依据（全部实测，非推测）

#### `opsCenterUrl = https://www.iart.work/api/ops`

桌面端是 `_fetchJson(base, '/api/v1/runtime/bootstrap')`，**base 直接拼路径**。三个候选实测：

| base | 拼出的 URL | 结果 | 判定 |
|---|---|---|---|
| `/api/ops` | `/api/ops/api/v1/app-menu` | **401 JSON「未提供认证令牌」** | ✅ 已到后端 |
| `/ops` | `/ops/api/v1/app-menu` | 200 **HTML**（SPA 兜底） | ❌ 落在前端页面 |
| ``（根） | `/api/v1/app-menu` | 200 **HTML**（主站） | ❌ 落到主站 |

⇒ 只有 `/api/ops` 能到后端。判据取「返回 JSON 而非 HTML」，因为 HTML 会让应用验签失败。

#### `runtimePublicKey` = 新生成的 Ed25519 公钥

- 后端 `config.py:160` 用 `load_pem_private_key` 且注释要求 **Ed25519 PEM**；
- 桌面端 `verifyRuntimeSignature` 要求签名 **64 字节** —— 正是 Ed25519 的签名长度；
- 私钥 `/etc/ops-center/runtime-signing-private.pem`（600），公钥填在此处。

### 数据校验

| # | 校验 | 判据 | 结果 |
|---|---|---|---|
| V1 | JSON 可解析 | 回读 `JSON.parse` | ✅ |
| V2 | 行尾两口径一致 | `git diff --numstat` vs `--ignore-cr-at-eol --numstat` | ✅ 2/2 |
| V3 | URL 能到后端 | 请求返回 JSON 而非 HTML | ✅ 401/200 JSON |
| V4 | 公钥算法匹配 | 后端 Ed25519 ↔ 前端 64 字节签名 | ✅ |
| V5 | 不改其他字段 | diff 仅 2 行 | ✅ |

### 交付状态

| 项 | 状态 |
|---|---|
| 远程同步 | PENDING | 合并后取 merge SHA 回填，并删除 frontmatter 三个 `sync_*` 字段 |

### 取证

- `/api/ops/api/v1/runtime/bootstrap` → **200 JSON，21723 字节**
- 顶层字段含 **`appMenu`（21 项）** 与 **`signature`（88 字节 base64 = Ed25519 64 字节）**
- 主站回归：`/` 仍 200/67787/标题「汤姆鱼」未变
- 前端产物：新 `index.html` 引用 `/ops/assets/`，裸 `/assets/` = 0

### 遗留（不假装已闭合）

1. **未在本机重启桌面应用做端到端验证**（无头环境不起 GUI）。应用侧行为需人工重启后确认。
2. **`X-Catalog-Key` 未配进桌面端**：bootstrap 走 `verify_bearer_or_catalog_key`，无 key 时匿名仍是 404。该 key 属**运行时凭据**，按设计不入库——需要在应用「运营中心」设置里填一次。这是让菜单真正可见的最后一步。
3. 服务器上 `app_menu_item` 表尚未建（惰性创建，首次调 `list_items` 时由 `_provision_from_catalog` 建）；bootstrap 已能从 catalog 下发 21 项默认值。
4. 引擎高危域误判（QM-6 i5 被标 crypto）未修，见 PR #3841 记录。
