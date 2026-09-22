# PRD / 变更规格：全仓代码体检第二批落地（P1 功能缺陷与数据治理）

> 入库副本：`docs/audit-remediation-batch2-2026-09-22.md`（本文件）。`01-docs/*.md` 被 `.gitignore` 忽略，属本地交付产物目录，那里保留的是同内容阅读副本 —— 修订请改本文件。

| 项 | 内容 |
|---|---|
| 日期 | 2026-09-22 |
| 来源 | `.adversarial/codebase-audit-20260922/proposal-v7.md`（对抗评审收敛后的最终方案）第二批：问题 5 / 9 / 10 / 11 / 12 / 13 |
| 分支 | `codex/audit-p1-defects`（worktree 隔离，基点为含 P0 第一批的 main） |
| 影响模块 | ops-center 后端（配置中心）、packages/collection-engine、packages/shared-utils、packages/video-clone-engine、packages/python-backend（角色动画）、apps/desktop（渲染端文案） |
| 门禁 | ops-center 409 pytest / collection-engine 104 vitest / shared-utils 273 vitest / video-clone-engine 151 node--test / desktop i18n+collect-error+useVideoClone 78 vitest / python-backend 55 pytest（-k character） |
| 兼容性 | **无数据库迁移、无破坏性 API 变更**；仅新增响应字段 `is_encrypted`、新增错误码 `VIDEOCLONE_LINK_BLOCKED`、新增函数 `configurePublishHistory` |

---

## 0. 变更总览

| # | 问题 | 用户可见影响 | 数据/契约影响 |
|---|---|---|---|
| P1-5 | 敏感配置明文入库、审计表留明文 | 配置详情出现「已加密」状态；改错密钥时导出会明确报错而不是悄悄产出空凭据 | `config_item.value` 敏感项改为 `enc:v1:` 自描述密文；`config_audit_log` 只存掩码；列表接口新增 `is_encrypted` |
| P1-9 | B 站适配器是返回固定样例的桩；空壳响应被记为成功 | 采集失败会在采集记录里显示为失败并退回配额，健康度/熔断统计不再虚高 | `collect()` 新增失败原因 `empty_content` |
| P1-10 | shared-utils 顶层 `require('electron')`，纯 Node 环境一引入就崩 | 无（内部治理）；崩溃从 `TypeError: Cannot read properties of undefined` 变为可操作提示 | 新增 `configurePublishHistory()`；`publishHistory` 从入口导出；electron 声明为 optional peerDependency |
| P1-11 | 链接克隆把任意 https URL 直传 yt-dlp，构成 SSRF | 内网/元数据地址给出「指向内网或本机地址」专属提示，不再冒充「视频私密」 | 新增 `src/adapters/url-guard.js`；新增错误码 `VIDEOCLONE_LINK_BLOCKED`；新增环境变量 `VIDEOCLONE_ALLOW_ANY_HOST` |
| P1-12 | Playwright 逐帧截图中途抛错即泄漏浏览器进程 | 长批次角色动画预览不再越跑越慢/句柄耗尽 | 无 |
| P1-13 | 人物名惯用语排除表漏登刘备 | 「刘备借荆州」不再被当成人物台词上下文，剧本一致性提示更准 | `IDIOM_EXCLUSIONS` 数据表变更；导出 `filterIdiomHits` |

---

## 1. P1-5 敏感配置写库前加密（ops-center 配置中心）

### 1.1 问题与目标

`config_item.value` 对 `is_secret=1` 的项（平台 AppSecret、模型 API Key、数据库口令等）以明文落库；`config_audit_log.old_value/new_value` 同样写明文，等于把凭据复制进第二张表。目标是：**密文入库、掩码入审计、明文只在内存里短暂存在、且不可解时 fail-closed**。

### 1.2 存储格式与数据校验

| 字段 | 变更 | 校验规则 |
|---|---|---|
| `config_item.value` | 敏感项写入时存 `enc:v1:<base64 密文>`；非敏感项保持原样 | 由 `encrypt_secret_value()` 统一生成，**幂等**：入参已带 `enc:v1:` 前缀则原样返回，不会二次加密 |
| `config_item.is_secret` | 语义不变（0/1） | 更新时以**库中既有标记为准**：`secret_flag = int(existing.is_secret) or int(is_secret)`，防止 `PUT /api/v1/config/batch` 这类不带 `is_secret` 的接口把敏感项降级成明文 |
| `config_audit_log.old_value/new_value` | 敏感项只存掩码串 | 掩码在**写库时**完成（读时掩码可被绕过：任何直接查库/导出的动作都会拿到明文） |

前缀 `enc:v1:` 的作用是让密文自描述：

- 无前缀 → 视为**存量明文**，读出时原样返回 → **上线不需要数据迁移**，也不会把老数据读崩；
- 有前缀 → 走 `OPS_ENCRYPTION_KEY` 对称解密；
- 版本位 `v1` 预留给将来换算法（v2 可与 v1 共存读取）。

### 1.3 写入流程（`upsert_config`）

```
入参 value（可能：真值 / 掩码回显串 / 空串 / 已带前缀密文）
  ├─ secret_flag = 库中既有标记 OR 本次入参标记
  ├─ old_plain = plaintext_value(existing)          # 解密取明文，不可解则抛错
  ├─ 若 secret_flag 且新值含 "***" 且与旧明文不同
  │     → 判定为「客户端把掩码回显填回来了」→ 保留原凭据、不覆盖，写 INFO 日志
  ├─ 否则 stored_value = encrypt_secret_value(新值)  # 非敏感项直接存原值
  └─ 审计：old/new 均写 audit_display_value(secret_flag, 明文) → 敏感项掩码、非敏感项原样
```

创建分支同理：`value = encrypt_secret_value(value) if is_secret else value`，`old_value` 审计写空串。

掩码规则（读侧 `_item_to_dict` 与审计 `_mask_audit_value` 共用语义）：

| 输入 | 输出 |
|---|---|
| 长度 > 8 | `前4位 + "***" + 后4位` |
| 长度 ≤ 8 且非空 | `"***"` |
| 空 / None | `""` |
| 已经含 `***` | 原样返回（**幂等**，避免二次掩码把 `abcd***efgh` 改成 `abcd***ugh`） |

> 注意：掩码必须基于**明文**计算。对密文取前后缀会泄露 `enc:v1:` 前缀，且不同明文对应的密文前后缀毫无业务含义。

### 1.4 读取与显示项（API 契约）

`GET /api/v1/config/items`（及单条查询）的每个对象：

| 字段 | 类型 | 说明 |
|---|---|---|
| `value` | string | 敏感项 = 基于明文的掩码串；非敏感项 = 原值 |
| `is_masked` | bool | 是否敏感项（敏感项恒为 true） |
| `is_encrypted` | bool（**新增**） | 该敏感项在库里是否已是受管密文。`false` 表示「存量明文，尚未加密」 |

前端显示建议（已按此语义可直接实现，无需后端再改）：

- `is_masked && is_encrypted` → 值旁显示 `已加密`；
- `is_masked && !is_encrypted` → 值旁显示 `明文存储（建议重新保存以加密）`；
- 保存成功后刷新列表，`is_encrypted` 应变为 `true`（存量明文在**任何一次保存**后自动升级为密文，无需迁移脚本）。

### 1.5 明文消费方（`file_writer` 配置导出）

`services/file_writer.py` 中 12 处 `item.value` 全部改为 `plaintext_value(item)`：导出 `.env` / YAML 必须拿到明文，否则下游服务会拿到 `enc:v1:...` 直接连不上。

**fail-closed 约定**：`plaintext_value()` 在密文不可解时 `raise ValueError`，而不是返回空串。

提示文字（原文）：

```
[P1-5] 配置项 {config_id} 的密文不可解（OPS_ENCRYPTION_KEY 已轮换？），请在运维中心重新录入该值。原因: {异常类型名}
```

理由：静默写空凭据比写失败更危险 —— 下游会拿着空 credential 反复 401，并把「密钥轮换事故」伪装成「服务不稳定」。

例外：列表接口的掩码分支在不可解时降级为 `"***"`（只影响展示，不影响导出），保证配置页在轮换期间仍可访问。

### 1.6 快照与恢复（`snapshot_service`）

| 环节 | 行为 |
|---|---|
| 导出快照 | 存**库中原值**（敏感项即密文）。既不留明文，也可跨密钥轮换回放 |
| 恢复快照 | `secret_flag` 取快照内标记与库中标记的并集；快照值无 `enc:v1:` 前缀时**补加密**，已是密文则原样回放（幂等） |
| 恢复审计 | `old_value` 为解密后的旧明文的掩码；`new_value` 为快照值的掩码 |

### 1.7 运维指引

1. `OPS_ENCRYPTION_KEY` 必须与 P0 第一批的 fail-closed 约定一致：生产缺失即拒绝启动，开发态需显式 `OPS_ALLOW_EPHEMERAL_KEY=true`（临时密钥重启后旧密文必然不可解，属预期）。
2. 轮换密钥后，所有历史密文不可解 → 症状是配置导出报 `[P1-5] … 密文不可解`。处置：在运维中心逐项**重新录入**（保存即重新加密），或按 `ops-center/deploy/KEY-ROTATION-GUIDE.md` 的双密钥宽限期回退。
3. 排查用 SQL：`SELECT id, is_secret, substr(value,1,7) FROM config_item WHERE is_secret=1 AND substr(value,1,7) <> 'enc:v1:';` → 结果集即「仍是明文的敏感项」，逐条重新保存即可清零。

### 1.8 测试矩阵（`ops-center/backend/tests/test_p1_config_secret.py`，13 用例）

| 用例族 | 断言 |
|---|---|
| 加密器 | 带前缀、幂等（二次加密不变）、空值/None 原样、明文（无前缀）可解出 |
| 写入 | 敏感项创建即密文；批量更新不带 `is_secret` 不降级；掩码回显不覆盖真凭据；非敏感项不加密 |
| 审计 | 审计表不含明文；审计值幂等掩码 |
| 导出 | 密文正常导出明文；不可解时抛 `[P1-5]` 且不写出空凭据 |
| 快照 | 快照存密文；恢复明文自动补加密；恢复审计为掩码 |
| 响应契约 | `is_encrypted` 三种组合（敏感+密文 / 敏感+存量明文 / 非敏感）取值正确 |

红验证：`git stash` 掉 5 个源文件后 12 用例失败（1 通过为存量明文用例，符合预期）。

---

## 2. P1-9 B 站采集真发请求 + 空壳响应硬约束（collection-engine）

### 2.1 问题

`bilibili-adapter._doFetch` 是桩：不发网络请求，直接返回硬编码样例。任何"采集成功"其实都是假数据；同时 `collect()` 对"HTTP 200 但正文为空"的响应（风控、签名失效、视频不存在）仍记 `success:true`，健康度、熔断、配额三类指标一起说谎。

### 2.2 网络请求规范

| 项 | 规格 |
|---|---|
| 入口 | `globalThis.fetch`（Node 18+ / Electron 主进程可用），可通过 `new BilibiliAdapter({ http })` 注入替换（测试/代理） |
| 请求头 | `User-Agent`（Chrome 120 串）、`Referer: https://www.bilibili.com/`、`Accept: application/json, text/plain, */*` |
| WBI 签名 | `wts`（秒级时间戳）**先并入参数再算 `w_rid`**。旧实现先算签名后加 `wts`，签的是不含 `wts` 的参数集，平台侧必然判定签名无效 |
| 纯函数 | `generateWbiSign(params, key)` 不改写入参（用 `{...params, wts}` 副本），避免多次调用相互污染 |
| 参数编码 | `bvid` / `aid` 走 `encodeURIComponent`（防 `?`、`#`、中文注入到查询串） |
| 回落 | 真发请求拿到空壳或异常时：若构造时传入了 `this._browser`（浏览器通道）则回落浏览器抓取；否则原样返回由 `collect()` 判失败 |

### 2.3 空内容判定（`BaseAdapter.isEmptyContent`）

| 输入 | 判定 |
|---|---|
| `null` / `undefined` / `''` | 空 |
| 字符串 | `trim()` 后为空即空 |
| 对象 | `text`（回退 `desc`）与 `title` **同时**为空才算空；任一非空即视为有内容 |

即：只有"标题和正文都没有"才判空壳，避免把"只有标题的短内容"误杀。

### 2.4 采集结果契约

`collect()` 的返回：

| 场景 | 返回 | 副作用 |
|---|---|---|
| 正常 | `{ success: true, content }` | 计成功、记配额、写缓存 |
| **空壳（新增）** | `{ success: false, reason: 'empty_content', content: null }` | `log.blocked(platform, accountId, 'empty_content', {url, status})`；`healthMonitor.record({success:false, reason:'empty_content'})`；`circuitBreaker.recordFailure(...)`；`strategy.refundBudget(...)` |
| 风控 | `{ success:false, reason: <detectBlock 原因> }` | 同上（既有逻辑） |
| 网络异常 | `{ success:false, reason:'error', error }` | 记 `timeout`/`network_error` + 退预算 |
| 熔断/限流 | `{ success:false, reason:'circuit_open' / <rateLimiter reason> }` | 退预算（不计失败） |

### 2.5 交互与显示项

- 采集记录列表：空壳不再出现「成功 + 空正文」的行，而是失败行，原因列显示 `empty_content`（映射建议文案：**「内容为空或被平台拦截，稍后重试」**）。
- 配额：空壳退预算，因此"失败 20 次"不会把当日配额烧光。
- 账号健康度 / 熔断计数：空壳计入失败，连续空壳会触发熔断 → 这是期望行为（说明该账号已被风控）。

### 2.6 测试矩阵（`packages/collection-engine/tests/bilibili-adapter.test.js`，11 用例）

签名顺序（`wts` 入签）、`generateWbiSign` 纯函数性、URL 参数编码、`_doFetch` 真发请求（注入 http 桩）、响应字段解析、空壳回落浏览器、空壳无浏览器时 `collect` 判失败且退预算/记失败、`isEmptyContent` 边界（空串/空白/只有标题/只有正文/null/对象无字段）。

---

## 3. P1-10 shared-utils 的 Electron 依赖治理

### 3.1 根因

`publish-history.js` 顶层 `const { app } = require('electron')`，而 shared-utils 的 `package.json` **从未声明 electron**。后果有两层：

1. 纯 Node 环境（CI 脚本、vitest node 环境、服务端复用）一 require 就崩；
2. 更隐蔽的是：仓库里确实装了 electron，纯 Node 下 `require('electron')` **不抛错**，而是返回"可执行文件路径字符串"，于是 `app` 为 `undefined`，真正的崩点被推迟到 `app.getPath('userData')`，报错是毫无信息量的 `TypeError`。

### 3.2 注入式配置 API

```js
const { publishHistory } = require('@multi-publish/shared-utils')
publishHistory.configurePublishHistory({ userDataDir })   // 或 { filePath } / { app }
```

| 注入项 | 生效优先级 | 用途 |
|---|---|---|
| `filePath` | 1（最高） | 完全指定 `<绝对路径>/publish-history.jsonl`，脚本/自定义存储位置 |
| `userDataDir` | 2 | 指定目录，内部拼接文件名；**纯 Node 环境用这个即可，完全不需要 Electron** |
| `app` | 3 | 桌面端传 `electron.app`，走 `app.getPath('userData')` |
| 都没注入 | 4 | 懒加载 `require('electron').app`；拿不到就抛可操作错误 |

`configurePublishHistory(opts)` 会**整体替换**上一次注入（传 `{}` 即清空），并返回归一化后的配置，便于测试与调试。同时从入口 `index.js` 导出 `publishHistory`（此前未导出，调用方各自 require 内部路径，治理无从下手）。

### 3.3 提示文字（原文）

```
[shared-utils/publish-history] 未检测到 Electron 运行时：请在桌面端调用，或先 configurePublishHistory({ userDataDir }) 指定存储目录
```

约束：错误信息里**不得**出现 `Cannot find module 'electron'`，也不得出现 `getPath`（说明"其实拿到了 app"的实现泄漏）。

### 3.4 依赖声明

```json
"peerDependencies": { "electron": ">=20.0.0" },
"peerDependenciesMeta": { "electron": { "optional": true } }
```

即：装了能用、不装也不报错，且不会被 hoist 成"隐式可用"。

### 3.5 测试矩阵（`packages/shared-utils/tests/publish-history.test.js`，8 用例）

源码扫描（顶层不得 require electron，且 electron 只出现在有缩进的非注释行）、纯 Node require 不抛错、入口导出校验、未注入时报错文案可操作、`userDataDir` 全链路（写→查→单条→统计）、`filePath` 优先于 `userDataDir`、注入 stub `app` 走 `getPath('userData')`、package.json optional peerDependency 且不进 dependencies。

> 该测试在编写过程中反向暴露了两个真实缺陷：① `_resolveApp()` 只捕获异常、没校验 `.app` 是否存在；② `getHistoryPath()` 在读 `userDataDir` 之前就先解析 Electron，使注入形同虚设。二者都已修复（用例 4/5 现在能钉住）。

---

## 4. P1-11 链接克隆的 SSRF / 域名白名单守卫（video-clone-engine）

### 4.1 威胁模型

用户在"从链接导入"里填任意 URL，engine 把它交给 yt-dlp，yt-dlp 会**真实建连并跟随重定向**。于是：

- `https://169.254.169.254/latest/meta-data/iam/...` → 云元数据读取（AK/SK 泄露）；
- `https://localhost:8788/`、`https://127.0.0.1:5000/` → 本机服务探测（桌面端与自建网关同机部署时尤其现实）；
- `https://10.x/`、`https://192.168.x/` → 内网网段扫描。

### 4.2 白名单（`PLATFORM_HOSTS`，唯一事实来源）

| 平台 | 允许域名（含子域） |
|---|---|
| douyin | douyin.com |
| xiaohongshu | xiaohongshu.com、xhslink.com |
| kuaishou | kuaishou.com |
| bilibili | bilibili.com、b23.tv |
| shipinhao | weixin.qq.com、channels.weixin.qq.com |
| youtube | youtube.com、youtu.be |
| tiktok | tiktok.com |
| instagram | instagram.com |

匹配规则：去掉 `www.` 后「精确相等」或「以 `.` + 域名结尾」。**刻意不做子串匹配**，`evil-douyin.com`、`douyin.com.attacker.io`、`notxhslink.com` 都不命中。`ingest-url.js` 里原有的重复域名表已删除，`hintPlatform` 委托给守卫，避免两份表漂移。

### 4.3 校验顺序与错误码

`assertSafeIngestUrl(url, { resolveAddr, resolveDns = true, allowAnyHost })`：

| 顺序 | 条件 | 结果 |
|---|---|---|
| 1 | URL 不可解析 / 协议非 `https:` / hostname 为空 | `VIDEOCLONE_SOURCE_UNSUPPORTED` |
| 2 | host 是内网/回环/链路本地/元数据/ULA 字面量 | `VIDEOCLONE_LINK_BLOCKED`（**新增码**） |
| 3 | host 不在白名单且未放开 | `VIDEOCLONE_SOURCE_UNSUPPORTED` |
| 4 | DNS 解析抛错 或 解析结果为空 | `VIDEOCLONE_LINK_UNAVAILABLE`（fail-closed，绝不回退成放行） |
| 5 | 解析出的任一地址是内网 | `VIDEOCLONE_LINK_BLOCKED`（防"公网域名 → 内网 IP"重绑定） |
| 6 | 全部通过 | 返回 `{ url, host, platform }` |

内网判定（IPv4/IPv6）：`localhost`、`*.localhost`、`::1`、`0.0.0.0`、`127/8`、`10/8`、`192.168/16`、`169.254/16`、`172.16-31`、`fc00::/7`、`fe80::/10`、`::ffff:<v4>`（映射后递归判定）、`*.internal`、`*.local`、`*.lan`、`metadata.google.internal`。
IP 字面量场景跳过 DNS（无域名可解析）。

### 4.4 用户提示文字

| 错误码 | zh | en | 可重试 |
|---|---|---|---|
| `VIDEOCLONE_LINK_BLOCKED` | 该链接指向内网或本机地址，出于安全限制无法采集，请改用公开可访问的视频链接 | This link points to a private or local address and is blocked for security. Use a publicly accessible video link | 否 |
| `VIDEOCLONE_SOURCE_UNSUPPORTED` | 暂不支持该来源，请使用支持的平台或本地文件 | Source not supported, use a supported platform or a local file | 否 |
| `VIDEOCLONE_LINK_UNAVAILABLE` | 链接无法访问，请确认链接有效后重试 | Link unavailable, verify the link and retry | 是 |

> 为什么不复用 `LINK_PRIVATE`：其文案是"该视频为私密内容，无法获取"，会把一次安全拦截误导成内容权限问题（用户会去找作者开权限，或提工单说视频看不了）。Python 采集侧（`aggregation/video_service.py`）对同一场景给的是独立文案「不支持内网地址链接」，此次 JS 侧对齐到"独立错误码 + 独立文案"。

### 4.5 环境变量与拦截时机

- `VIDEOCLONE_ALLOW_ANY_HOST=true`：放开第 3 步白名单（自建场景要下白名单外的源时用）。**只放开白名单，不放开内网拦截**（第 2/5 步依旧生效）。
- 拦截发生在 `mkdtemp` 与调用 yt-dlp **之前**：不产生临时目录、不启动下载进程（用例 14 以"计数器为 0"钉死）。

### 4.6 残余风险（须知）

yt-dlp 内部跟随的 30x 重定向不经过本守卫。当前保证的是"初始目标域名在白名单内且解析到公网"。若需覆盖任意重定向，必须在下载器侧加代理/出口 ACL（列入第 4 批技术债）。

### 4.7 测试矩阵（`test/adapters/url-guard.test.js`，16 用例）

内网判定矩阵（含误判负例 `172.15.0.1`/`172.32.0.1`/`11.0.0.1`/`192.169.1.1`）、`isIpLiteral`、后缀伪装、`PLATFORM_HOSTS ↔ PLATFORMS` 一一对应、协议/非法 URL、内网字面量族（11 条）、非白名单域、DNS 重绑定（含多解析结果任一内网）、DNS 抛错/空结果、放行路径返回值、`allowAnyHost` 与 env 的边界、`resolveDns=false` 与 IP 字面量不触发 DNS、`ERROR_CATALOG` 契约、`createUrlIngest` 拦截时机、`createUrlIngest` 成功路径不回归。

---

## 5. P1-12 Playwright 浏览器生命周期（python-backend 角色动画）

`character_animation_utils._render_preview_mp4()`：`p.chromium.launch()` 之后的 `new_page` / `goto` / 逐帧 `screenshot` 全部包进 `try`，`browser.close()` 放进 `finally`。

- 原缺陷：任一帧抛异常就跳过 `close()`，每次失败泄漏一个 Chromium 进程组；批量跑角色动画时表现为"越跑越慢 → 句柄/内存耗尽 → 莫名 500"。
- 约定（与 `browser_fetcher.py` 一致）：**launch 之后必须紧跟 try/finally**，`with sync_playwright()` 只保证 playwright 驱动退出，不保证 browser 关闭。
- 验收（`packages/python-backend/tests/test_character_animation_lifecycle.py`，5 用例，注入 fake playwright，不依赖真实浏览器）：正常路径关闭一次；`goto` 抛错时仍关闭；`screenshot` 中途抛错时仍关闭；异常原样上抛不被吞；`browser.close` 至多一次。红验证 3 用例失败。

---

## 6. P1-13 人物名惯用语排除表（apps/desktop 剧本上下文）

`story-context-engine.js` 的 `IDIOM_EXCLUSIONS` 用于「台词里出现人物名但其实是惯用语/歇后语」时，不把该命中当作人物相关上下文。

当前完整表：

| 人物 | 排除词 |
|---|---|
| 诸葛亮 | 事后诸葛亮 |
| 曹操 | 说曹操曹操到、曹操到 |
| 刘备 | 刘备借荆州、刘备摔阿斗 |

修订要点（对抗评审 v3 订正）：**只登记真实存在的惯用语/歇后语**。原方案里的「孙权称帝」是史实陈述而非惯用语，登记进去等于用排除表掩盖判定缺陷，因此改为由**正向回归用例**锁定（"孙权称帝"必须正常识别人物上下文）。同时导出 `filterIdiomHits` 以便单测直接验证，不再靠端到端间接覆盖。

维护规则（新增人物时按此清单）：① 是固定搭配的成语/惯用语/歇后语吗？② 会不会同时是合法史实/业务表述（若是，宁可写正向回归，不进排除表）？③ 补一条"表内容契约"用例与一条"正常表述不被误伤"用例。

验收：`story-context-engine.test.js` 66 用例通过；红验证**精确**只失败 3 条刘备用例，孙权正向回归保持通过。

---

## 7. 决策记录

| 决策 | 理由 | 被否决的替代方案 |
|---|---|---|
| `enc:v1:` 前缀 + 双读（密文/存量明文） | 零迁移上线，回滚只需停止新写入 | 一次性数据迁移脚本（需要停机、且回滚困难） |
| 审计掩码在**写库时**完成 | 读时掩码可绕过：直接查库/导出即裸奔 | 只在 API 层掩码 |
| 不可解时抛 `ValueError` | 导出空凭据会伪装成"服务不稳定"，掩盖密钥轮换事故 | 静默返回空串 |
| SSRF 新增 `LINK_BLOCKED` 码 | 与 `LINK_PRIVATE`（内容权限）语义正交，文案必须不同 | 复用 `LINK_PRIVATE`（实现省事但误导用户） |
| DNS 解析结果校验 + 解析失败 fail-closed | 白名单域名也可能被重绑定到内网；放行失败等于没有守卫 | 解析失败当作"无内网地址"放行 |
| `configurePublishHistory` 注入式 + 懒加载兜底 | 纯 Node 与 Electron 两条路都可用，错误可操作 | 顶层 require + 让调用方自己 try/catch |
| 「孙权称帝」不进排除表 | 它是史实陈述，进表等于用数据掩盖逻辑缺陷 | 按原评审方案直接登记 |

## 8. 验证汇总（本地）

| 套件 | 命令 | 结果 |
|---|---|---|
| ops-center 后端 | `pytest`（全量） | 409 passed |
| P1-5 新增 | `pytest tests/test_p1_config_secret.py` | 13 passed / 红验证 12 failed |
| collection-engine | `vitest run` | 104 passed |
| shared-utils | `vitest run` | 273 passed（21 文件）/ 红验证 8 failed |
| video-clone-engine | `npm test`（`node --test`） | 151 用例，0 failed，1 skipped（含 url-guard 16）/ 红验证 2 failed |
| apps/desktop（受影响） | `vitest run src/i18n src/utils/collect-error.test.js src/composables/useVideoClone.test.js` | 78 passed |
| story-context-engine | `vitest run` | 66 passed / 红验证精确 3 failed |
| python-backend（character） | `pytest tests -k character` | 55 passed |
