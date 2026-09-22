# PRD：运营中心同步零配置化（方案C）

> 版本：v1.0 | 日期：2026-09-22 | 状态：待评审  
> 关联前序：PR #2168（platform-defs 同步脚本）、Bug1 一次性配置体验痛点

---

## 1. 问题定义

### 1.1 用户痛点

当前「模型提供商」页面的运营中心同步需要用户手动填写：
- **Ops Center URL**（如 `https://ops.example.com`）
- **API Key**（部署级静态密钥，运维发放）

普通用户不知道该填什么、去哪里找，导致同步功能形同虚设。

### 1.2 根因

桌面端用户认证链路（Logto OIDC → JWT → python-backend）与运营中心同步链路（静态 X-Catalog-Key）完全独立，缺少桥接。

---

## 2. 目标用户与核心价值

| 角色 | 价值 |
|------|------|
| 终端用户 | 登录后自动同步，零手动配置 |
| 运维 | 不再需要逐一向用户分发 API Key |
| 开发者 | 通过 `identity-public.json` 统一配置，构建时一次绑定 |

---

## 3. MVP 范围（P0）

1. **自动发现**：桌面端从 `identity-public.json` 读取运营中心 URL，无需手动填写
2. **会话鉴权**：用用户已持有的 Logto access_token（Bearer JWT）访问运营中心同步端点
3. **向后兼容**：手动配置模式保留为 fallback（离线/自托管场景仍可手动填 URL + Key）
4. **UI 只读化**：已登录且自动发现成功时，同步配置区域展示为只读状态 + 同步时间

---

## 4. 功能规格（详细）

### 4.1 数据校验

| 字段 | 校验规则 | 失败行为 |
|------|---------|---------|
| `identity-public.json.opsCenterUrl` | 必须为合法 HTTPS URL（本地开发允许 HTTP 回环）；≤500 字符 | 跳过自动发现，回退手动配置 |
| Logto JWT `exp` | 过期则走 `getAccessToken({forceRefresh:true})` 刷新一次；仍失败则跳过本轮同步 | 日志 warn，不阻塞其他功能 |
| JWT `scope` | 必须包含 `publish:read` | 403 响应，桌面端日志提示"权限不足" |
| bootstrap 响应签名 | Ed25519 验签（沿用现有 `verifyRuntimeSignature`） | fail-closed，拒绝应用任何运行时策略 |

### 4.2 流程

```
桌面启动
  |
  +-- identityAuthEnabled? --- No -> 走现有手动配置路径（不变）
  |                             Yes v
  +-- 用户已登录（authService state=authenticated）? --- No -> 等登录后重试
  |                                                         Yes v
  +-- 读取 OPS_CENTER_URL（来自 identity-public.json）--- 空 -> 走手动配置路径
  |                                                         v
  +-- 获取 access_token（auto refresh）
  |
  +-- GET {OPS_CENTER_URL}/api/v1/model-presets/catalog
  |   Header: Authorization: Bearer <token>
  |   (替代原 X-Catalog-Key)
  |
  +-- GET {OPS_CENTER_URL}/api/v1/runtime/bootstrap
  |   Header: Authorization: Bearer <token>
  |
  +-- applyCatalog + applyRuntime（验签后）-> 更新 lastSyncedAt
```

### 4.3 功能逻辑

#### 后端改造（ops-center）

1. **新增 `services/logto_verifier.py`**
   - 输入：Logto endpoint（从 `OPS_LOGTO_ENDPOINT` 环境变量）
   - 功能：`verify_bearer_token(token: str) -> claims: dict`
   - 验证：issuer + audience（`OPS_LOGTO_API_RESOURCE`）+ JWKS 签名 + 必要 scope
   - JWKS 缓存：复用 `httpx` + 5min TTL 字典缓存
   - 失败抛出 `HTTPException(401/403)`

2. **修改 `routers/runtime.py._require_catalog_key`**
   - 新逻辑：优先检查 `Authorization: Bearer <jwt>`；
     若存在则走 Logto 验签 -> 通过则放行；
     若不存在则回退检查 `X-Catalog-Key`（保持向后兼容）。
   - 两种鉴权方式任一通过即可访问数据。

3. **新增 config 字段**（`config.py`）
   - `logto_endpoint: str = ""` -- Logto issuer（自动追加 `/oidc`）
   - `logto_api_resource: str = ""` -- audience
   - `logto_jwks_cache_ttl: int = 300`
   - `logto_trusted_jwks_hosts: str = ""` -- 逗号分隔域名

#### 桌面端改造

4. **`identity-public.json` 新增字段**
   - `opsCenterUrl: string`（可选，不填 = 禁用自动发现）
   
5. **`identity-runtime-config.js` 白名单扩展**
   - `ALLOWED_FIELDS` 新增 `opsCenterUrl`
   - `RUNTIME_ENV_KEYS` 新增 `OPS_CENTER_URL`
   - 解析逻辑：optional，非空时验证为合法 URL

6. **`ops-center-sync.js` 改造**
   - 新增 `_getAutoContext(): {url, getToken} | null`
     - 从 `process.env.OPS_CENTER_URL` 读取 URL
     - 从 `authService`（注入）获取 token 获取函数
   - 改造 `syncNow()` -> `_syncNowInner()` 优先用 auto context
   - 改造 `_fetchJson(path, apiKey)` -> `_fetchJson(path, auth)`
   - `autoSyncOnStart()` 条件扩展：`cfg.url || autoUrl` 即可触发

7. **bootstrap.js 接线**
   - 构造 OpsCenterSync 时注入 `getAccessToken` 回调

#### 渲染层改造

8. **同步配置 UI 只读化**
   - 条件：`identityAuthEnabled && autoUrl && isLoggedIn`
   - 显示：只读状态卡片 + 同步时间
   - 隐藏：URL 输入框、API Key 输入框
   - 保留：[立即同步] 按钮 + autoSync 开关

### 4.4 交互逻辑与提示文字

| 场景 | 显示 | 提示文字 |
|------|------|---------|
| 自动发现成功 + 已登录 | 只读状态卡片 | "已通过登录会话自动连接运营中心" |
| 自动发现成功 + 未登录 | 灰色提示 | "登录后将自动启用同步" |
| 自动发现失败 + 未手动配置 | 手动表单（现状） | "请填写运营中心地址和 API Key" |
| 自动发现失败 + 已手动配置 | 手动表单（可修改） | 现状不变 |
| 同步进行中 | Loading spinner | "正在同步..." |
| 同步成功 | 最后同步时间 | "上次同步：2026-09-22 10:30" |
| 401/403 | 错误提示 | "登录会话已过期，请重新登录" |
| 网络不可达 | 静默（后台）/ 手动时提示 | "无法连接运营中心，请稍后重试" |

### 4.5 显示项

只读模式下展示：
- 运营中心地址（来自 identity 配置，不可编辑）
- 同步状态：已启用 / 等待登录 / 未启用
- 最后同步时间
- [立即同步] 按钮
- [x] 启动时自动同步（可切换）

---

## 5. 安全设计

1. **JWT 验证**：复用 Logto OIDC discovery + JWKS 模式（与 python-backend 一致）
2. **Scope 最小化**：同步端点只要求 `publish:read`
3. **回退安全**：未启用 Logto 验证时（`OPS_LOGTO_ENDPOINT` 为空），行为与改动前完全一致
4. **密钥不变**：静态 `X-Catalog-Key` 仍可用作运维级 bypass
5. **传输安全**：自动发现 URL 强制 HTTPS（回环除外）
6. **响应验签**：Ed25519 签名验证不受鉴权方式变化影响

---

## 6. 非功能需求

- 兼容 `identityAuthEnabled=false` 的开发环境：跳过自动发现，不报错
- 不影响 CI/CD：所有改动在现有测试框架内覆盖
- 运营中心不配置 `OPS_LOGTO_ENDPOINT` 时：新逻辑不激活

---

## 7. 验收标准

- [ ] 打包应用通过 Logto 登录后，无需任何手动配置即可自动同步
- [ ] `identity-public.json` 无 `opsCenterUrl` 时，现有手动配置 UI 不受影响
- [ ] ops-center 未配置 `OPS_LOGTO_ENDPOINT` 时，现有端点正常
- [ ] 单元测试覆盖：JWT 验证通过/过期/scope不足/无效签名
- [ ] 集成测试覆盖：桌面端 auto context -> fetch -> apply 全链路
- [ ] CHANGELOG / locale 成对更新
