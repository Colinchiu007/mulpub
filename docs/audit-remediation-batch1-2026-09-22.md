# 全仓代码体检整改 · 第 1 批（P0 安全应急，2026-09-22）

> **范围**：`.adversarial/codebase-audit-20260922/proposal-v7.md` 的「第一批（安全应急，P0 全部 + P1 中的 3/4/6/7/8）」，
> 即问题 **1、2、3、4、6、7、8** 共 7 条（问题 8 经 v-final 从 P1 晋升 P0；问题 5 属 P1，在第 2 批）。
> **交付**：PR **#2214**（squash `b2cdd29b17`，+537/−20，10 文件，2026-09-22 15:11:47 UTC）；
> 补漏 PR **#2276**（squash `8d4098948c`，+94/−0，2026-09-23 09:33:29 UTC）；桌面端信任锚收口 **#2291**（squash `55cd32baaa`）。
> **本文口径**：所有行号/文案均取自合并后的 `origin/main`（`git show origin/main:<path>`），非提案稿的计划位置。

## 〇、两条启动闸门（先读这张图）

后端有两道独立闸门，都在 `ops-center/backend/main.py` 接：

| 闸门 | 位置 | 触发时机 | 失败行为 |
|---|---|---|---|
| `Settings.validate_security()` → `get_jwt_secret()` | `config.py:158` / `main.py:37`（lifespan 内，早于 `init_db()`） | 每次进程启动 | `RuntimeError("未配置安全的 OpsCenter JWT 密钥")`（`config.py:125-126`），空值或等于 `INSECURE_DEFAULT_SECRET` 即拒 |
| `run_startup_security_checks(settings)` | `config.py:187`，`main.py:158` import、`main.py:162` 注册调用 | 应用启动事件 | 逐条 `SystemExit`，**fail-closed：服务不启动**；全过则 `logger.info("[P0] All startup security checks passed.")`（`config.py:222`） |

`run_startup_security_checks` 的判定顺序（`config.py:187-222`）：

1. JWT 秘密强度（仅当配置非空）→ `_validate_jwt_secret`
2. 管理员口令强度（`ENVIRONMENT != "development"` 视为生产）→ `_validate_admin_password`
3. **未展开字面量**：对 `OPS_JWT_SECRET` / `OPS_ENCRYPTION_KEY` / `OPS_ADMIN_PASSWORD` 三个同源变量逐个 `_reject_unexpanded`
4. CORS 危险组合 → `_validate_cors_credentials(cors_origins, allow_credentials=True)`
5. 加密主密钥存在性：缺失且未显式放行 → `SystemExit("[P0-4] ...")`

> `_validate_jwt_secret` 内部第 0 步也调 `_reject_unexpanded`（`config.py:256`），所以 `get_jwt_secret()` 这条路径同样拦得住字面量。
> 单测上下文（`PYTEST_CURRENT_TEST` 非空）会跳过完整强度校验（`config.py:130-132`），只保留「空/默认值」硬拒——测试环境不因弱样例密钥起不来，生产不会。

## 一、问题 1：Ed25519 运行时签名私钥随示例文件入库

- **攻击面**：`/api/v1/runtime/bootstrap` 的验签信任锚与 `.env.example` 里那把可用私钥配对，任何拿到仓库的人可伪造公告 / 版本发布与灰度 / 敏感词词库 / 应用菜单 / pipelineOptions 全链路运行时配置（供应链级）。
- **后端侧修复**：`.env.example` 删除真实 PEM，只留生成命令占位；回归由 `ops-center/backend/tests/test_p0_security.py` 断言「`.env.example` 内容不含 `BEGIN PRIVATE KEY`」锁定。
- **私钥加载**（`config.py:134-156`）：来源二选一——`runtime_signing_key_path`（文件路径，优先）或 `runtime_signing_private_key`（PEM 内容）；
  读不到文件 → `RuntimeError("无法读取运行时配置签名私钥文件: ...")`；非 Ed25519 PEM → `RuntimeError("运行时配置签名私钥非法（须为 Ed25519 PEM）: ...")`；
  **两处都没配 → 返回 `None`，签发端点自身 fail-closed**（不回落任何内置密钥）。
- **桌面侧收口（#2291）**：`apps/desktop/electron/services/runtime-trust-anchor.js::resolveTrustAnchor` 四态裁决 ——
  有自定义锚用自定义；无锚 + 未打包回落内置 DEV 公钥（开发/演示自验不受影响）；无锚 + **已打包** → `NO_PRODUCTION_TRUST_ANCHOR`，
  `verifyRuntimeSignature` 直接判失败，整份运行时策略不应用；DEV 公钥被裁 → `NO_PUBLIC_KEY`。
  用户可见提示：`运行时策略验签失败（NO_PRODUCTION_TRUST_ANCHOR），已拒绝应用任何运行时策略：打包版需在「运营中心同步配置」填写自定义 Ed25519 公钥作为信任锚`。
  现象是「下发全部不生效」而非崩溃：公告不展示、更新策略走内置默认、敏感词仅内置词库、应用菜单不定制。
- **运维动作**：`ops-center/deploy/KEY-ROTATION-GUIDE.md`（68 行）——生成新 Ed25519 与 Fernet/JWT 密钥 → 写入 `EnvironmentFile` → **双钥宽限窗口 90 天**
  （`license-access-control.js` 硬编码到期日）→ 7 项泄露面排查清单逐机签字 → 重启验证。
  清单含 `git log -S "MC4CAQAwBQYDK2Vw" --all` 定位引入提交、部署机残留 PEM、unit 文件 `${...}` 字面量、CI secrets/制品库引用。

## 二、问题 2：JWT 弱密钥闸门形同虚设 + 跨服务共享密钥

- **判据**（`config.py:228-233`、`254-269`）：最小长度 **≥32**；黑名单精确值
  `{dev-secret-change-in-production, dev-secret-key-for-local-testing-2026, secret, changeme, default, admin}`；
  前缀黑名单 `("dev-", "test-", "changeme", "default")`。命中即 `SystemExit`：
  - `[P0-2] JWT secret too short (N chars); require >= 32. Generate with: openssl rand -hex 32`
  - `[P0-2] JWT secret matches known weak value; refuse to start.`
  - `[P0-2] JWT secret starts with '<prefix>' (development pattern); production must use a strong random secret.`
- **管理员口令**（`config.py:272-286`）：弱口令表 `{admin123, password, 123456, admin, root, ""}`；生产必须设置；长度 < 8 拒绝。
  文案：`[P0-2] Admin password is in known-weak list; choose a strong password (>= 8 chars).` / `[P0-2] Admin password must be set in production (OPS_ADMIN_PASSWORD).`
- **部署层解耦**：unit 文件不再把 `OPS_JWT_SECRET` 与 orchestrator 的 `PO_SECRET_KEY` 绑成同一把（改 `EnvironmentFile` 注入独立随机值）。
  报告 [v6] 已裁定该条准确性质是「模板层未展开字面量堆叠」，严重度按问题 8 口径理解，而非「攻击者已持有真实跨服务凭据」。

## 三、问题 3：`decrypt_key` 参数错误被裸 except 吞掉（功能从未生效）

- **修复**：`ops-center/backend/services/key_service.py::decrypt_key(ciphertext)` 保持**单参数**（`key_service.py:57`），
  调用方 `model_preset_service.py` 用同签名版本；`except Exception: pass` 收窄为精确异常并把失败上抛为可区分结果。
- **不得改用的方案**（评审 [v3 反转]）：`prompt_eval_service.decrypt_key(secret, value)` 的 `_fernet` 是 `Fernet(base64url(sha256(secret)))`，
  与加密 OfficialKey 用的 `Fernet(settings.encryption_key)` **两套体系互不可解**，换过去只是把 TypeError 换成 InvalidToken。
- **回归**：`ops-center/backend/tests/test_key_service.py` 断言「解密明文 == 真实 Key」，并覆盖「加密密钥未配置」「历史密文不可解」两条路径
  （防 DoD 虚转绿）。不可解时抛 `InvalidToken("Ciphertext undecryptable (key rotation?)")`（`key_service.py:63-64`），由上层按条降级为掩码。

## 四、问题 4：加密主密钥缺失时静默自生成

- **判据**（`key_service.py:15-40`）：`OPS_ENCRYPTION_KEY` 为空时——
  - `OPS_ALLOW_EPHEMERAL_KEY=true` → 生成临时密钥并 `logger.warning("[P0-4] OPS_ENCRYPTION_KEY not set; ephemeral key generated. DEVELOPMENT ONLY — encrypted data unrecoverable after restart.")`
  - 测试/`ENVIRONMENT=development` → 临时密钥 + warn（不阻塞开发）
  - **其余（生产）→ `SystemExit("[P0-4] OPS_ENCRYPTION_KEY is required. Generate: python3 -c \"from cryptography.fernet import Fernet; ...\"")`**
- **交互影响**：`GET /secrets` 不再因单条历史密文不可解而整表 500，改为**按条降级掩码 + 结构化留痕**，不自动清洗数据。
- **顺序依赖**：问题 3 先行修复；本条与掩码降级预案同批交付并先预发布验证，防启动阻断。

## 五、问题 6：CORS 全开 + credentials

- **判据**（`config.py:289-295`）：`allow_credentials=True` 且 `cors_origins` 含 `*` → `SystemExit("[P0-6] CORS allow_origins='*' with credentials=True is insecure; specify explicit whitelist (e.g. https://app.example.com).")`
- **默认值**：`cors_origins: str = "http://localhost:5173,http://localhost:5174"`（`config.py:182`），白名单精确匹配，子域需显式列出。
- 与第 3 批 P1-15（Cookie 会话/CSP/CSRF）构成「会话安全矩阵」，两侧互相引用验收。

## 六、问题 7：`test_provider_connection` 缺 SSRF 守卫

- **判据**（`model_preset_service.py::_validate_target_url`，异步包装 `_validate_target_url_async` 走 `asyncio.to_thread`，避免同步 DNS 阻塞事件循环）：
  1. scheme 仅 `http/https`，否则 `ValueError("[P0-7] Unsupported URL scheme: ...")`；无主机名 → `[P0-7] URL has no hostname`
  2. 主机名字面量黑名单 `{localhost, 0.0.0.0, ::1, [::1], metadata.google.internal}` → `[P0-7] Blocked internal address: ...`
  3. 字面 IP：`is_private / is_reserved / is_loopback / is_link_local` 任一 → `[P0-7] Blocked private/reserved IP: ...`
  4. 域名：对 `getaddrinfo` 的**每一个** A 记录重复第 3 步 → `[P0-7] <host> resolves to private IP: ...`
- **例外开关**：`OPS_ALLOW_PROXY_BENCHMARK_IPS=true` 才放行 RFC 2544 基准段 `198.18.0.0/15`（Clash/TUN fake-ip 会用它接管公网）；
  CGNAT `100.64.0.0/10` 因各 Python 版本 `is_private` 覆盖不一致而显式补入常量。命中该拦截时给出二选一处置文案：
  「① 在运行 ops-center 的环境设置 `OPS_ALLOW_PROXY_BENCHMARK_IPS=true` 后重启服务；② 关闭代理的 fake-IP / DNS 劫持模式后重试」，
  另有中文业务文案「获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）」。
- **重定向口径（易被写错）**：两个外呼点都是 `httpx.AsyncClient(..., follow_redirects=False)`（`fetch_models_from_url`、`test_provider_connection`），
  即 **3xx 不跟随**，因此不存在「跳转后再访问内网」的路径；**不是**「逐跳复验」。真正的逐跳复验在 JS 侧
  `apps/desktop/electron/services/film-engineering/shot-downloader.js`（`redirect: 'manual'`，每跳重新过白名单 + DNS）。
- **已知边界（原样记录，不粉饰）**：`model_preset_service.py` 内注释写明——校验用的 `socket.getaddrinfo` 与 httpx 实际连接是两次独立 DNS 解析，
  存在 DNS 重绑（TOCTOU）窗口。收口需自持连接或固定解析结果，登记为后续专项。

## 七、问题 8：systemd 单元把密钥变量注入成公开字面量 + root 运行

- **机制（[v5] 最终裁定）**：systemd `Environment=` **不做** `${VAR}` / `$(...)` 展开，进程收到字面量 `${PO_SECRET_KEY}` 当 JWT 秘密——
  是仓库里可复算的确定性公开常量，旧闸门恰好放行它，外部可伪造 admin 令牌，故晋升 P0。
- **unit 侧修复**（`ops-center/deploy/ops-center.service`）：`EnvironmentFile=/etc/ops-center/env` 注入真实随机值；
  `User=ops-center` + `Group=ops-center`（不再 root）；`NoNewPrivileges/ProtectSystem=strict/ProtectHome/PrivateTmp` + `ReadWritePaths` 限定数据目录。
- **脚本侧修复**（`ops-center/deploy/setup-service.sh`）：首装自动生成 `Fernet` 主密钥与两把 `openssl rand -hex 32`，
  写入 `ENV_FILE` 后 `chown ${SERVICE_NAME}:` + `chmod 600`，并提示 `EDIT OPS_CORS_ORIGINS and OPS_ADMIN_PASSWORD before starting!`；已存在则跳过密钥生成（幂等）。
- **代码侧闸门（#2276 补漏）**：`_reject_unexpanded`（`config.py:241-251`）按**模式**拒绝，不依赖长度判据顺带拦下：
  `_UNEXPANDED_MARKERS = ("${", "$(")`，命中即 `[P0-8] <FIELD> contains unexpanded unit-file reference '<marker>...'; systemd Environment= does not expand ${VAR} — inject a real random value via EnvironmentFile= instead.`
  覆盖三个同源变量（JWT / 加密主密钥 / 管理员口令），空串交由各自判据处理。
- **回归**：`ops-center/backend/tests/test_p0_jwt_literal.py`（53 行）——含「用 `inspect.getsource(config.run_startup_security_checks)` 断言三个字段都进了闸门」的防漂移断言，
  避免以后有人删一行调用而测试仍绿。

## 八、验证与防复发

| 维度 | 事实 |
|---|---|
| 红→绿 | 第 1 批按 TDD 先加 `test_p0_security.py`（189 行）等红用例，后实现转绿；pytest 作为批次门禁 |
| 门禁 | `run_startup_security_checks` 任一失败 = 进程非零退出，CI 起服务即暴露 |
| 防漂移 | `test_p0_jwt_literal.py` 的源码级断言；`test_p0_security.py` 对 `.env.example` 的无 PEM 断言 |
| 文档 | 本文件 + `01-docs/PRD.md`「全仓代码体检整改」第二～三节（含 3.1 信任锚闸门补漏）+ `CHANGELOG.md` #2214/#2276/#2291 条目 + `ops-center/deploy/KEY-ROTATION-GUIDE.md` |
| 复算 | `cd ops-center/backend && python -m pytest -q tests/test_p0_security.py tests/test_p0_jwt_literal.py tests/test_key_service.py` |

## 九、遗留（第 1 批未收口的边界）

1. SSRF 的 DNS 重绑 TOCTOU 窗口（第六节「已知边界」）。
2. 泄露面排查清单 7 项需运维逐机签字，代码侧无法自证（指引已交付）。
3. 双钥宽限窗口 90 天到期后，未升级客户端会被旧公钥拒绝——发版前置检查项。