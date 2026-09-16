# BUGFIX：获取模型 SSRF 拒绝误报 fake-IP 代理基准段（2026-09-16）

> 关联 PR：fix(ops-center) 获取模型 SSRF 拒绝文案区分 fake-IP 代理基准段
> 模块：`ops-center/backend/services/model_preset_service.py`（`fetch_models_from_url` / `_is_private_or_reserved` / 新增 `_is_benchmark_segment`）
> 影响：运营后台「预设模型 → 编辑 → 获取模型」按钮

---

## 1. 现象（用户报告）

运营中心 → 预设模型 → 编辑 `agnes-llm` → 点击「获取模型」→ 报错：

```
获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）
```

但 `agnes-llm` 的「获取模型ID URL」(`models_url`) 是**合法公网 HTTPS 端点**，并非内网地址。这是 SSRF 守卫的**误报**。

---

## 2. 根因

`198.18.0.0/15` 是 RFC 2544 定义的**基准测试段（TEST-NET-2）**，IANA 保留，本不分配给任何真实主机。

- 用户本机开启了 **fake-IP / DNS 劫持模式的代理**（Clash、Surge、Mihomo、sing-box 等）。该类代理用 `198.18.0.0/15` 接管公网流量：开启 fake-IP 后，所有公网域名经系统 `getaddrinfo` 解析会被改写为 `198.18.x.x`。
- `fetch_models_from_url` 在发起请求前对 `models_url` 主机名做 DNS 解析（`socket.getaddrinfo`），逐条 IP 调用 `_is_private_or_reserved` 判私网/保留。
- `198.18.0.0/15` 在 **Python ≥3.12** 被 `ipaddress` 标记为 `is_private=True`（实测本机 `python`：`ip_address('198.18.0.241').is_private == True`，`in ip_network('198.18.0.0/15') == True`）。
- `_is_private_or_reserved` 默认 `settings.allow_proxy_benchmark_ips=False` 时，该段落入 `is_private` 分支被拒绝 → 抛出笼统的「解析到私网/保留地址」。
- **真正的缺陷不是拒绝本身，而是错误文案不具可操作性**：用户无法区分「真实内网」与「代理假象」，更不知道有 `OPS_ALLOW_PROXY_BENCHMARK_IPS` 这条放行开关或「关闭代理 fake-IP」这条路径，于是卡死。

> 注：机制本身在 #1165 已落地（`OPS_ALLOW_PROXY_BENCHMARK_IPS` 开关 + `198.18.0.0/15` 放行），但默认 fail-closed 且文案笼统——本次修复聚焦「文案可操作化 + 两类拒绝区分」，不改动安全默认。

---

## 3. 复现条件

| 条件 | 说明 |
|------|------|
| 环境 | 运行 ops-center 的主机开启了 fake-IP / DNS 劫持代理 |
| 触发 | 「获取模型ID URL」为公网域名（如 agnes-llm、MiniMax、OpenAI 官方 `/v1/models`） |
| 配置 | `OPS_ALLOW_PROXY_BENCHMARK_IPS` 未设置或为 `false`（默认） |
| 结果 | `socket.getaddrinfo` 返回 `198.18.x.x` → 被判为私网/保留 → 400 拒绝 |

---

## 4. 修复方案（代码）

文件：`ops-center/backend/services/model_preset_service.py`

### 4.1 新增辅助函数

```python
def _is_benchmark_segment(ip: str) -> bool:
    """是否为 RFC 2544 基准测试段 198.18.0.0/15（Clash/TUN fake-ip 代理接管公网流量的网段）。"""
    try:
        return ipaddress.ip_address(ip) in _BENCHMARK_V4
    except ValueError:
        return False
```

（`_BENCHMARK_V4 = ipaddress.ip_network("198.18.0.0/15", strict=False)`，模块级常量，#1165 已定义。）

### 4.2 拒绝循环区分两类场景

原逻辑（笼统）：

```python
for entry in resolved:
    ip = entry[4][0]
    if _is_private_or_reserved(ip):
        raise ValueError("获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）")
```

新逻辑（可操作 + 区分）：

```python
for entry in resolved:
    ip = entry[4][0]
    if _is_private_or_reserved(ip):
        # 区分「真实私网/保留地址」与「fake-ip 代理基准段」：后者不是真实内网目标，
        # 仅因代理 DNS 劫持才解析到 198.18.x.x，给出可操作的指引而非笼统拒绝。
        if _is_benchmark_segment(ip) and not settings.allow_proxy_benchmark_ips:
            raise ValueError(
                "获取模型ID URL 在 fake-IP 代理环境下解析到 198.18.x.x（RFC 2544 基准测试段），"
                "被 SSRF 守卫按保留地址拒绝。这不是真实内网目标，而是 Clash/TUN 类代理接管公网流量的正常现象。"
                "请二选一解决：① 在运行 ops-center 的环境设置 OPS_ALLOW_PROXY_BENCHMARK_IPS=true 后重启服务；"
                "② 关闭代理的 fake-IP / DNS 劫持模式后重试。"
            )
        raise ValueError("获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）")
```

要点：
- 命中基准段且开关关闭 → **可操作错误**（含 `fake-IP` / `198.18` / `OPS_ALLOW_PROXY_BENCHMARK_IPS` 三个关键词）。
- 命中基准段且开关开启 → `_is_private_or_reserved` 已返回 `False`，不进入拒绝循环，正常拉取（既有行为不变）。
- 真实私网（`10.x` / `192.168.x` / `172.16–31.x` / `127.x` / `169.254.x` / CGNAT `100.64–127.x` / 组播 / 未指定）→ `_is_benchmark_segment` 为 `False` → 走原「私网/保留地址」文案（保持原样）。

---

## 5. 数据校验 / 流程（fetch-models 完整链路）

顺序不变（仅第 4 步文案区分）：

1. `models_url` 必须 `http(s)` 且长度 ≤500（`ftp://` 等拒绝）。
2. 环回主机（`localhost`/`127.0.0.1`/`::1`）允许 `http`；非环回主机强制 `https`。
3. `socket.getaddrinfo(hostname, port)` 解析；解析失败 → 「无法解析…主机名」。
4. **逐条 IP 判私网/保留**：`_is_private_or_reserved`；基准段且开关关 → 上述可操作错误；真实私网 → 原错误。
5. `follow_redirects=False`：任何 3xx → 视为失败（HTTP ≥300 → 400）。
6. 超时 10s（`httpx.AsyncClient(timeout=10.0)`）。
7. 响应体 ≤512KB，否则 400。
8. JSON 契约提取：支持 `{models:[...]}` / `{data:[...]}` / `{data:[{id:...}]}` / `{model_ids|modelIds}` / `{items}` / 纯数组；元素优先级 `id` → `model_id`/`modelId` → `name`（Gemini `models/xxx` 剥离前缀）；非空去重，最多 500；无模型 ID → 400「未找到任何模型ID」。

**TOCTOU 说明**：步骤 3（DNS 解析）与 `httpx` 实际连接为两次独立解析，存在 DNS 重绑定时间窗；`follow_redirects=False` 已防 3xx 跳转，本端点不声称阻断 DNS 重绑定。`198.18.0.0/15` 判别仅在「解析结果」层生效，不改变连接层行为。

**配置映射**：`allow_proxy_benchmark_ips` ← `OPS_ALLOW_PROXY_BENCHMARK_IPS`，经 `pydantic-settings` `env_prefix="OPS_"`，默认 `False`（fail-closed）。

---

## 6. 功能逻辑 / 交互逻辑 / 显示项 / 提示文字

- **前端入口**：`ops-center/frontend/src/views/ModelPresets.vue` 编辑/新增弹窗内「获取模型」按钮（默认模型下拉旁）→ `POST /api/v1/model-presets/{id}/fetch-models`。
- **成功**：`models` 更新为返回列表；`default_model` 不在新列表则清空；前端回填文本框与下拉；提示「获取成功，共 N 个模型 ID」。
- **失败**：后端返回 `400 + detail`（中文错误），前端 `ElMessage` 弹窗直接展示 `detail` 全文，**不**改写 `models`（失败不改动已有数据）。
- **两类文案在 UI 的视觉差异**：
  - 基准段文案 → 明确出现 **「fake-IP」「198.18」「OPS_ALLOW_PROXY_BENCHMARK_IPS」** → 运营一眼识别为「代理假象」。
  - 真实私网文案 → 仅「私网/保留地址」→ 运营识别为「真内网/地址填错」。
- **运营处理 SOP**：
  - 看到「fake-IP / 198.18」→ 设 `OPS_ALLOW_PROXY_BENCHMARK_IPS=true` 并重启 ops-center，或关闭代理 fake-IP / DNS 劫持后重试。
  - 看到「私网/保留地址」→ 确认 `models_url` 是否误填内网地址（如 `http://192.168.x.x`）。

---

## 7. 两条解决路径（运营/用户自助，不改代码）

1. **放行基准段（推荐，保留 SSRF 默认 fail-closed）**
   - 在运行 ops-center 的环境设置 `OPS_ALLOW_PROXY_BENCHMARK_IPS=true` 并重启服务。
   - 该开关**仅**放行 `198.18.0.0/15`（代理假象段）；真实私网始终拒绝，不削弱 SSRF。
   - ⚠️ 生产 / ECS 环境请保持关闭（避免误放行任何解析到该段的请求）。
2. **关闭代理 fake-IP / DNS 劫持**
   - 让公网域名解析到真实公网 IP，SSRF 守卫自然放行（前提是 `models_url` 确为合法公网 HTTPS 端点）。

---

## 8. 安全边界（明确不改动）

- 默认 `OPS_ALLOW_PROXY_BENCHMARK_IPS=false` 保持 fail-closed。
- 真实私网/环回（非白名单）/链路本地/组播/未指定/CGNAT 段拒绝逻辑**完全不变**。
- 仅对「命中 `198.18.0.0/15` 且开关关闭」这一确切组合改变报错文案，不改变任何放行/拒绝的布尔结果。

---

## 9. 回归保护测试

`ops-center/backend/tests/test_model_presets_api.py`：

- 更新 `test_fetch_models_proxy_benchmark_segment_rejected_when_disabled`：开关关闭、`198.18.0.241` 仍 `400`，`detail` 含 `198.18` / `fake-IP` / `OPS_ALLOW_PROXY_BENCHMARK_IPS`。
- 新增 `test_fetch_models_benchmark_off_message_distinct_from_real_private`：
  - 基准段（开关关）→ 文案含 `fake-IP` + `OPS_ALLOW_PROXY_BENCHMARK_IPS` 且**不含**「私网」；
  - 真实私网 `10.0.0.1` → 文案含「私网」且**不含** `fake-IP`；
  - 确保两类拒绝提示**可区分**（防止未来重构把区分逻辑抹掉）。

---

## 10. 相关文档索引

- `ops-center/docs/PRD.md` §12A.3 / §12A.3.1（权威规格：fake-IP 场景、数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字、两条解决路径）。
- `ops-center/openspec/specs/ops-center/model-preset-info/spec.md`（「获取模型失败」Scenario 同步）。
- `CHANGELOG.md`（未发布 fix 条目）。

---

## 11. 记忆落点

- **内置记忆（EverOS / 项目 MEMORY）**：fake-IP 代理 `198.18.x.x` 被 SSRF 守卫误报的排查结论 + `OPS_ALLOW_PROXY_BENCHMARK_IPS` 放行开关 + 本次文案可操作化修复。
- **用户级 MEMORY.md**：本机代理 fake-IP 模式（`198.18.x.x`）触发各类 SSRF/私网误报的通用排查法（设 allowPrivateNetwork 类开关或关 fake-IP）已在案，本次为 ops-center fetch-models 的具体落点。
