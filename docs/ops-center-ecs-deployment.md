# 运营中心（Ops Center）部署到 ECS 注意事项

> 适用范围：把运营中心后端（FastAPI）+ 前端（Vue3/Vite）部署到阿里云 ECS，并让桌面端（Multi-Publish）能从运营中心**运行时同步**下发配置（模型目录、公告、版本、敏感词、featureFlags、pipelineOptions、appMenu 应用菜单）。
>
> 本文与 `codex/ops-sync-bearer-fix`（零配置 Bearer 同步修复）配对：该修复解决"桌面端同步永不发起"的前端代码缺陷；本文覆盖 ECS 侧的**配置与部署前提**，二者缺一，菜单/策略都到不了桌面端。
>
> 相关既有文档：`01-docs/PRD-sync-zero-config.md`（方案C 双模鉴权设计）、`01-docs/FEATURE-APP-MENU-2026-09-15.md`（应用菜单）、`ops-center/backend/.env.example`（变量真源）。

---

## 1. 架构与端口拓扑

| 组件 | 进程 / 端口 | 说明 |
|------|------------|------|
| Ops Center 后端 | uvicorn `127.0.0.1:8010` | FastAPI，`main:app`，只监听本机，由 nginx 反代对外 |
| Ops Center 前端 | Vite `:5173`（开发）→ 构建产物静态托管 | 生产 `npm run build` 后拷入 nginx 静态目录 |
| nginx | `:80/:443` | 同源反代 `/ops/` → `:8010/`；API 前缀 `/api/ops/` → `:8010/api/` |
| Logto（身份） | `deploy/logto/docker-compose.yml` | OIDC，签发用户 JWT，供桌面端 Bearer 鉴权 |
| platform-orchestrator | `:8000` | feature_gates 来源、发布编排；ops-center Vite 代理 `/api/auth`→:8000 |

**关键约束：前后端必须同源部署。** 会话 Cookie 是 `HttpOnly + SameSite=Lax`，跨 host 会导致"登录成功但刷新又回登录页"。反代终结 TLS 时后端只看到 http，必须保留 `X-Forwarded-Proto` 且显式设 `OPS_SESSION_COOKIE_SECURE=1`。

---

## 2. 部署形态（ECS 上实际怎么跑）

- **后端进程**：systemd 单元 `ops-center.service`（源文件 `ops-center/deploy/ops-center.service`）。
  - 以专用用户 `ops-center` 运行，`ProtectSystem=strict`、`NoNewPrivileges`、`PrivateTmp`。
  - `EnvironmentFile=/etc/ops-center/env` 注入环境变量（**生产变量都写在这个文件，不写进 unit**）。
  - 持久化路径经 `ReadWritePaths=/data/ops-center /data/configs` 放开（SQLite 库 + 下发配置产物）。
  - `ExecStart=/usr/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 8010`，`Restart=always`。
- **nginx 片段**：`ops-center/deploy/nginx-ops.conf`（含 CSP/nosniff/no-referrer/X-Frame-Options 三层安全响应头，部署到 `/etc/nginx/conf.d/ops-center.conf`）。
- **一键脚本**：`ops-center/deploy/deploy.sh`（`git pull` → `pip install` → seed DB → `npm run build` 前端 → 拷静态 → 更新 nginx → `systemctl restart ops-center` → `curl /health` 自检）。

> ⚠️ **仓库来源需核实**：`deploy.sh` 从 `/root/ops-center`（克隆自独立仓 `github.com/Colinchiu007/ops-center.git`）拉取部署，而本 monorepo 的 `ops-center/` 目录是其镜像。把本仓的 ops-center 后端改动推上 ECS 前，**必须确认两者同步机制**（是否单向 mirror、还是 CI 分发），否则会出现"改了 monorepo、ECS 跑的还是独立仓旧码"。以 `main` 分支保护 + PR 合并为准绳，勿绕过。

---

## 3. 环境变量清单（后端 `OPS_` 前缀，写入 `/etc/ops-center/env`）

> 变量名以 `ops-center/backend/config.py`（`env_prefix="OPS_"`）与 `.env.example` 为真源。

### 3.1 基础 / 安全（必配）

| 变量 | 用途 | 备注 |
|------|------|------|
| `OPS_DB_PATH` | SQLite 库路径 | 生产 `/data/ops-center/config.db`（unit 已设，env 文件勿冲突） |
| `OPS_CONFIG_OUTPUT_DIR` | 下发配置产物目录 | 生产 `/data/configs` |
| `OPS_ENCRYPTION_KEY` | Fernet 加密 Key | 生成：`python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`；**轮换后旧密文不可解** |
| `OPS_JWT_SECRET` | 内部 JWT 签名 | `openssl rand -hex 32`；已独立于 `OPS_SECRET_KEY` |
| `OPS_SECRET_KEY` | 与 orchestrator 共享密钥 | 同 `PO_SECRET_KEY` |
| `OPS_CORS_ORIGINS` | 允许前端来源 | 逗号分隔，**禁止 `*`**，替换为实际前端域名 |
| `OPS_ALLOW_PROXY_BENCHMARK_IPS` | SSRF 放行代理段 | **ECS/生产保持 `false`**（默认）；仅本机跑 Clash/TUN fake-ip（198.18.0.0/15）时开启，会削弱 SSRF fail-closed |
| `OPS_ADMIN_USERNAME` / `OPS_ADMIN_PASSWORD` | 本地管理员登录 | 生产未配且无管理员时登录 fail-closed |
| `OPS_SESSION_COOKIE_SECURE` | 会话 Cookie Secure | 反代 TLS 场景设 `1` |

### 3.2 同步链路（按需）

| 变量 | 用途 | 未配后果 |
|------|------|---------|
| `OPS_CATALOG_API_KEY` | 静态 Key（`X-Catalog-Key`）鉴权，模型目录/上报通道 | 相关端点 404 fail-closed；生成 `openssl rand -hex 32` |
| `OPS_RUNTIME_SIGNING_PRIVATE_KEY` | **运行时策略 Ed25519 签名私钥**（PEM 内容，双引号包裹） | `/api/v1/runtime/bootstrap` 返回 **404**，桌面端拿不到公告/版本/敏感词/pipelineOptions/appMenu |
| `OPS_RUNTIME_SIGNING_KEY_PATH` | 上面的文件路径形式（**二选一，路径优先**） | 同上 |
| `OPS_LOGTO_ENDPOINT` / `OPS_LOGTO_API_RESOURCE` | Logto OIDC 校验，接受桌面端 Bearer JWT | 未配 = 只认静态 `OPS_CATALOG_API_KEY`，零配置 Bearer 同步不可用 |
| `OPS_LOGTO_JWKS_CACHE_TTL` | JWKS 缓存秒数 | 默认 300 |
| `OPS_FEATURE_GATES_IMPORT_SOURCE` | feature_gates 导入源 | 未配探测默认路径，生产建议显式配 |

---

## 4. ⭐ 运行时同步链路的生产前置条件（本文核心）

桌面端从运营中心拉取运行时策略（含 **appMenu 应用菜单**）走 `/api/v1/runtime/bootstrap`。要让菜单真正同步到桌面端，**前后端三处必须同时成立**：

1. **后端签名私钥已配**：`OPS_RUNTIME_SIGNING_PRIVATE_KEY`（或 `OPS_RUNTIME_SIGNING_KEY_PATH`）。bootstrap 响应对 payload 做 Ed25519 签名；未配 → 端点 404，桌面端同步直接空转。
2. **桌面端验签公钥锚匹配**：桌面端 `ops-center-sync.js` 对响应验签。
   - 未打包（开发）回落内置 DEV 公钥 `DEFAULT_RUNTIME_PUBLIC_KEY`。
   - **打包版无自定义公钥时返回 `NO_PRODUCTION_TRUST_ANCHOR` 并跳过同步**（fail-closed）。
   - 因此生产必须：自行生成 Ed25519 密钥对，私钥给后端，公钥在桌面端「运营中心同步配置」里填入自定义 `runtimePublicKey`（PEM），保证信任锚唯一。
3. **鉴权通道打通**（二选一）：
   - **零配置 Bearer（方案C，推荐）**：后端配好 Logto（`OPS_LOGTO_ENDPOINT`/`OPS_LOGTO_API_RESOURCE`），桌面端用登录后的用户 JWT（`required_scope=publish:read`）作 `Authorization: Bearer`。此路径依赖本次 `codex/ops-sync-bearer-fix` 修复——修复前零配置态 `syncNow` 被误判为"未配置 API Key"而永不发起。
   - **静态 Key 回退**：桌面端手填 URL + `X-Catalog-Key`（= `OPS_CATALOG_API_KEY`）。

### 4.1 生成签名密钥对（Linux/Windows 通用）

```bash
python3 -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey; from cryptography.hazmat.primitives import serialization; k=Ed25519PrivateKey.generate(); open('runtime-signing-private.pem','wb').write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())); open('runtime-signing-public.pem','wb').write(k.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))"
```

- 私钥 `runtime-signing-private.pem` → 后端（推荐用 `OPS_RUNTIME_SIGNING_KEY_PATH` 指向文件，避免 PEM 换行写进 env）。
- 公钥 `runtime-signing-public.pem` 内容 → 桌面端「运营中心同步配置」的自定义公钥。

---

## 5. 桌面端侧配置

- **运营中心地址 `OPS_CENTER_URL`**：由身份运行时配置（`identity-runtime-config.js`）解析后经 `phase3-services.js` 的 `setOpsCenterUrl()` 注入同步模块（零配置自动发现）。生产域名以实际为准（如 `https://ops.iart.work` / `https://iart.work/ops`）。
- **手动配置态**：在设置里手填 URL + API Key 时走 `X-Catalog-Key`；不手填且有 Logto 登录态时走 Bearer。
- **自定义公钥**：打包版必须在「运营中心同步配置」填自定义 `runtimePublicKey`，否则验签锚缺失、同步被跳过。
- **传递链路**：菜单数据落在运营中心后端的 appMenu，桌面端 `opsCenterSyncNow` 拉取后 applyRuntime 生效；改桌面端 electron/preload 代码需重启应用（preload 只在窗口创建时加载，Vite HMR 不热更 preload）。

---

## 6. 发布与更新

### 6.1 后端（ECS）

```bash
cd /root/ops-center && git pull origin main
systemctl restart ops-center
curl -s http://127.0.0.1:8010/health
```

或跑 `ops-center/deploy/deploy.sh`（含前端重建）。改了 `/etc/ops-center/env` 后须 `systemctl daemon-reload && systemctl restart ops-center`。

### 6.2 桌面端（本 monorepo 运行时代码）

- 走 `分支 → PR → CI（main 保护）→ 合并 main`；`main` 合并触发 `build.yml`（打包 + 捆 Chromium + Release + Gitee 镜像）。
- ECS/用户机上的桌面端靠**应用内自动更新**拉新包，无需手工登录替换文件。
- GFW 网络错误静默失败；真实签名/下载错误不吞。

---

## 7. 部署后验证清单

1. `curl -s http://127.0.0.1:8010/health` 返回健康。
2. `curl` `/api/v1/runtime/bootstrap`（带合法 Bearer 或 `X-Catalog-Key`）**返回 200 且带 `signature`**（非 404 = 私钥已配、鉴权通过）。
3. 桌面端触发同步（`opsCenterSyncNow`）后，`appMenu` 等策略落地生效（可经 CDP 读 `window.electronAPI` 验证）。
4. 打包版桌面端已填自定义公钥且验签通过（日志无 `NO_PRODUCTION_TRUST_ANCHOR`、无 "runtime sync skipped"）。

---

## 8. 常见故障排查

| 症状 | 根因 | 处置 |
|------|------|------|
| 桌面端报"未配置 Ops Center API Key"但其实是零配置态 | 旧代码 `syncNow` 用被 `getConfig()` 污染的 url 判手动态（本次修复项） | 更新到含 `codex/ops-sync-bearer-fix` 的桌面端版本 |
| bootstrap 返回 404 | 后端未配 `OPS_RUNTIME_SIGNING_PRIVATE_KEY`/`_KEY_PATH`，或 `OPS_CATALOG_API_KEY` 空 | 配签名私钥 / Key |
| 打包桌面端同步被跳过、日志 `NO_PRODUCTION_TRUST_ANCHOR` | 未填自定义公钥 | 「运营中心同步配置」填入与后端私钥配对的公钥 PEM |
| 验签不通过、整份运行时策略不应用 | 前后端密钥对不配对 / canonicalJson 两端不一致 | 用同一对密钥；勿改双端 canonical 序列化 |
| Bearer 401 | Logto 未配或 JWT 无效/缺 `publish:read` scope | 配 `OPS_LOGTO_*`；确认用户已登录且 scope 齐 |
| 菜单改了但桌面端没变 | 只存了 appMenu 数据、未同步下发；或桌面端旧码 | 确认同步链路（§4）通；桌面端更新到修复版 |
| 登录成功但刷新回登录页 | 前后端不同源 / Cookie Secure 未设 | 同源部署 + `OPS_SESSION_COOKIE_SECURE=1` + `X-Forwarded-Proto` |

---

## 9. 变更历史

- 2026-09-23：初版，随 `codex/ops-sync-bearer-fix`（零配置 Bearer 同步修复）配对产出。
---

## 附录：为什么菜单不像既有运营中心功能那样"推数据即生效"（通道差异与新内容类型铺设成本）

运营中心"改配置、前端秒生效"的前提是：**该数据流过一条早已建好并跑通的管道**。appMenu 是**新的可下发内容类型**，需要先把它赖以生效的整条链路建出来 + 修通，这是"一次性铺轨成本"，不是"菜单更难"。管道 ship 后，以后改菜单同样回到"数据即生效"。

桌面端 `syncNow()` 内其实有**两条独立通道**，鉴权与安全前置差异很大：

| 维度 | 模型目录（catalog） | 运行时策略 / 应用菜单（runtime bootstrap） |
|------|--------------------|--------------------------------------------|
| 端点 | `/api/v1/model-presets/catalog`（`_fetchCatalog`） | `/api/v1/runtime/bootstrap`（`_fetchRuntime`，含 appMenu/公告/版本/敏感词/featureFlags/pipelineOptions） |
| 内容性质 | 纯展示数据 | **能改应用行为** |
| 鉴权 | 静态 `X-Catalog-Key`（手填 Key 模式即用，早已跑通） | **零配置 Bearer**（方案C，新链路） |
| 安全门槛 | 低 | 高：Ed25519 验签 + fail-closed + 打包版自定义公钥锚（`NO_PRODUCTION_TRUST_ANCHOR` 跳过同步） |

菜单要改这么多，是三件事叠加：

1. **新内容类型的纵向管道**：后端下发字段 + 桌面归一化（`app-menu-config.js`/`normalizeAppMenu`）+ IPC 通道 `ops-center-sync:appMenu` + 三处 preload 绑定 + 渲染层读取 `getAppMenu()` 构建导航。桌面端原本根本不认 appMenu。
2. **它依赖的零配置 Bearer 链路当时是坏的**：`getConfig()` 把自动发现 URL 并入 `url`，`_syncNowInner` 用 `!cfg.url` 误判手动态 → 零配置下 syncNow 短路返回"未配置 API Key"、runtime 请求根本不发出（`codex/ops-sync-bearer-fix` 所修）。catalog 走的是另一条通道，手填 Key 即可用，从不暴露此 bug。
3. **高权限下发的安全成本**：能改行为的通道必须验签 fail-closed，因此生产 ECS 要配 `OPS_RUNTIME_SIGNING_PRIVATE_KEY` + 桌面端配配对公钥（见 §4）；越能改行为的下发，前置越重，属有意设计。

> 判据：评估一个运营中心新特性是否"零改动即生效"，先问三句——(a) 桌面端有没有该内容类型的消费管道（IPC/preload/归一化/渲染）？(b) 它走 catalog 还是 runtime bootstrap？后者还要验签锚与 Bearer 鉴权是否已跑通？(c) 是不是首个依赖某条新鉴权链路的内容类型？三问任一为"否/新"，就是铺轨期，需要代码投入。
