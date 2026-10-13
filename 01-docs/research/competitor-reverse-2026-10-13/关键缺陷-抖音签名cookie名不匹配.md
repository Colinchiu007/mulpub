# 🔴 关键缺陷报告：抖音签名 cookie 名不匹配（活体前置检查的产物）

> 日期：2026-10-13
> 来源：执行「抖音链活体裁决」的第一步（门禁测试）与第二步（前置材料自检）时发现
> 严重级别：**阻断级** —— 抖音 API 发布链在真实账号上**必然在 Step 0 失败**
> 状态：**✅ 已修复并合入主干**（PR **#3468** → `994a1fa17`，2026-10-13T16:55:08+08:00；回填 PR #3470 → `94e0cb448`。详见文末 §7「修复落地记录」）

---

## 7. 修复落地记录（2026-10-13 补记）

本报告 §0-§6 是**发现阶段**的取证。修复已按项目质量节拍落地，此处补记结论与验证。

### 7.1 修复方式

在 `packages/api-publish-engine/src/signer/douyin-ticket-guard.js` 建立**单一事实源**：

| 导出 | 作用 |
|---|---|
| `CRYPT_KEY_RE` / `SIGN_DATA_KEY_RE` | **后缀锚定 + 前缀可选**正则：`(?:__security_mc_\d+_|security-sdk\/)?s_sdk_crypt_sdk` |
| `hasSecurityMaterials(cookie)` | 存在性判据（零解密），供各链 Step 0 **复用** |
| `resolveCryptPayload(cookie)` | 保序尝试全部候选，返回第一个能解出非空 `ec_privateKey` 的 |
| `resolveSignDataPayload(cookie)` | 同上，返回第一个含非空 `ticket` 的 |

关键设计决策（对应 §4.2 风险 1）：**代际号写 `\d+`，不硬编码 `mc_1`** ——
`1` 疑似代际号，硬编码会重蹈覆辙。

两条链（`douyin-video.js` / `douyin-image.js`）的 Step 0 改调共享判据；
图文链另有自抄的 `cookieValue`，其 sign_data 解析也改为调共享解析器。
legacy 形态保留为回落，**向后兼容**。

### 7.2 验证结果

| 项 | 结果 |
|---|---|
| 单元 + 链级新增用例 | **+20**（live 形态可签出且公钥可验证 / gen=3,7,12 代际号可变 / legacy 回落 / bare 兜底 / 51 条噪声夹带 / 两代并存取可解码者 / `hasSecurityMaterials` 多形态 / 真实命名不含 `/` / 缺材料零请求 fail-closed / 脱敏不回显） |
| 防再犯结构锁 | **+4**（发布链不得内联裸字面量或裸 `includes`；必须从 signer 导入；代际号必须 `\d+`；两链判据表达式同源） |
| 引擎全量 | **411 passed / 40 files**（同 commit 基线 391，净增 20）+ direct **133/133**、零失败 |
| **变异反证** | ①改回裸 `includes` ⇒ **2 例立红**并精确点名 `douyin-video.js:147`；②正则硬编码 `1` ⇒ **4 例立红**（单测 + 链级 + 结构锁**三层**都守住） |
| **打包产物实跑（A/B 对照）** | 同一组输入下：`live gen=1/5/12` ⇒ **修复前全 THROW / 修复后全 OK**；`legacy` ⇒ 两版皆 OK；缺材料 ⇒ 两版皆 fail-closed |

**A/B 对照是本缺陷最有力的证据**：它同时证明了「缺陷在真实形态下 100% 复现」与「修复确实到达交付产物」。

### 7.3 仍未闭合的边界（不假装已闭合）

修复**只保证 Step 0 不再因命名失配而 fail-closed，不保证发布成功**：

1. 本机真实账号 cookie **全部已过期**（应用账号库 `accounts` 表 **0 行**）⇒
   「真实账号 → Step 0 通过 → 走到网络请求」**未做真机验证**；
2. `web_protect` 载荷在新命名下**是否同步变化未知** —— 名字修好只解决字符串匹配，
   载荷契约仍需活体确认；
3. `_mc_1_` 的 `1` 疑似代际号，已用 `\d+` 与多代际用例防硬编码，
   但无法排除平台改用**非数字**代际标识（如 `_mc_v2_`）；
4. 取证样本来自数周前会话，无法排除平台改回旧命名 —— 已备只读探针脚本供重新登录后复核。

### 7.4 一条跨产品的推论

参考产品的 `clientSign` 存在**同样的潜在缺陷**（它也不认识 `__security_mc_*`，
且它的 `catch {}` 把失败静默吞掉，很可能一直回退到它的远端签名服务）。
**所以「参考产品已实现本地签名」不能作为「这条路走得通」的证据** ——
它的实现同样从未在真实发布上被验证过。

---

## 0. 结论（发现阶段原文）

**本项目抖音 API 发布链的签名材料命名与实际平台不符，Step 0 前置校验会 100% 抛错。**

```javascript
// packages/api-publish-engine/src/publish/platforms/douyin-video.js  L143
if (!c.includes('s_sdk_crypt_sdk=') || !c.includes('s_sdk_sign_data_key/web_protect=')) {
  throw new DouyinVideoError(FAIL_MSG, errorCode.data_error)   // ← 必然命中
}
```

用户会看到 **「账号信息缺失，请重新授权此账号再试」**——但账号其实是好的、材料也都在，
**只是名字对不上**。重新授权也修不好。

---

## 1. 证据链（四步，全部可复现）

### 证据 1：真实 cookie 库里没有含 `/` 的名字

扫描三个应用（`@multi-publish` / `参考产品4.0` / `Electron`）全部 Electron 分区的
Chromium cookie 库：

```
扫描 cookie 总条数: 948
名字含 '/' 的 cookie 数: 0        ← 关键
名字含空白的 cookie 数: 0
```

**含义**：Chromium 不接受含 `/` 的 cookie 名（RFC 6265 的 token 不允许 `/`）。
因此字符串 `s_sdk_sign_data_key/web_protect=` **不可能**出现在任何 `document.cookie` 里。

> 附：`security-sdk/s_sdk_crypt_sdk` 这种名字在**浏览器里根本存不下来**。

### 证据 2：平台实际的 cookie 名

948 条 cookie 中，抖音安全体系相关的只有这一族：

| 实际名字 | 出现分区数 |
|---|---:|
| `__security_mc_1_s_sdk_crypt_sdk` | 3 |
| `__security_mc_1_s_sdk_sign_data_key_web_protect` | 3 |
| `__security_mc_1_s_sdk_cert_key` | 3 |
| `__security_server_data_status` | 3 |
| `bd_ticket_guard_client_data` | 3 |
| `bd_ticket_guard_client_data_v2` | 2 |
| `bd_ticket_guard_client_web_domain` | 3 |
| `bd_ticket_guard_regenerate_keys_time` | 2 |
| `bd_ticket_guard_ts_sign_id` | 1 |

**对照**：代码要找的 `security-sdk/s_sdk_crypt_sdk` **一条都没有**。

**注意后缀完全一致**：`s_sdk_crypt_sdk`、`s_sdk_sign_data_key_web_protect` ——
只有前缀从 `security-sdk/` 变成了 `__security_mc_1_`。
这是**平台侧改名**（很可能就是为了绕开 `/` 非法字符）。

### 证据 3：参考产品自己也不认识新名字

`参考产品4.0` 安装版本 **4.14.20.1109**，与本次分析的 asar（4.14.20）**同一版本**。
全 asar 搜索：

```
__security_mc      0 处
mc_1_              0 处
_mc_               0 处
security-sdk/s_sdk_crypt_sdk                       28 处   ← 它找的是这个
security-sdk/s_sdk_sign_data_key/web_protect       32 处
```

**但同一台机器上，参考产品自己的运行时会话里是 `__security_mc_1_*`**：

| 分区 | 有效期 |
|---|---|
| `参考产品4.0/auth-96317003369` | **2026-10-15（剩 2 天）** ← 很新的真实会话 |
| `参考产品4.0/auth-7483124731986838587` | 2026-11-23（剩 41 天）|

**含义**：参考产品这一版 `clientSign` 同样取不到私钥 —— 它的 `try { ... } catch {}`
把失败**静默吞掉**了，然后（推测）回退到它的远端签名服务 `qianming.refproduct.cn`。
这解释了为什么它有远端服务这条腿。

### 证据 4：材料确实在 cookie 里（不是 localStorage）

排除「材料其实在 localStorage」这一可能：
- localStorage（leveldb）里只有 `security-sdk/s_sdk_sign_data_key`（**不含** `web_protect`）
- 而 `__security_mc_1_s_sdk_sign_data_key_web_protect` **确实在 cookie 库里**（3 个分区）

所以两类材料都在 **cookie**，只是名字带 `__security_mc_1_` 前缀、`/` 变 `_`。

---

## 2. 影响面

| 项 | 影响 |
|---|---|
| **抖音 API 发布链** | 🔴 **完全不可用**（Step 0 必抛，走不到任何网络请求）|
| 抖音图文链（`douyin-image.js`）| 🔴 同样受影响（共用 clientSign）|
| 降级路径 | ✅ **不受影响** —— `publishMode: api-then-dom`，API 抛错后回退 DOM 轨 |
| 用户体验 | ⚠️ 每次抖音发布都先失败一次再降级 → 白等一次超时 + 可能弹出「账号信息缺失，请重新授权」的误导提示 |
| 数据安全 | ✅ 无影响（fail-closed 在零请求阶段，不发任何请求）|

**关键判断**：**降级路径掩盖了这个缺陷。**
因为 `api-then-dom` 会在 API 失败后回退 DOM，用户最终**还是能发布成功**，
所以这个 bug **不会表现为功能不可用，只会表现为「偶发慢 + 偶发莫名提示」**——
这正是它能在 2026-09-25 进代码后存活 18 天没被发现的原因。

---

## 3. 为什么之前没发现

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | `douyin-client-sign.test.js` 的 fixture **自己构造**了 `security-sdk/s_sdk_crypt_sdk=` 形态的 cookie（`makeCookie()`），测试与实现**共享同一个错误假设** → 16 个测试全绿 |
| 链级测试 | `douyin-video-chain.test.js` 用 `127.0.0.1` 假服务器，JSON fixture 同样是手写的 → 全绿 |
| 活体验收 | **从未做过**（W2 §6.2 未勾选），所以真实 cookie 从未进入过这条链 |
| 闸门 | `has_api: false` 在 2026-10-06 之前把整条链闸成死代码 |

**这就是「TDD 全绿 + 从未活体」的典型盲区**：
测试固化了实现者的假设，而假设错了，测试只会**强化**错误。

> 与本轮前面记下的教训同源：**单测全绿不构成「能发布成功」的证据**。
> 小红书 XYW_ 本地签名也是单测全绿、真机 406。

---

## 4. 修复建议（本报告不实施，供决策）

### 4.1 最小修复：兼容新名 + 保留旧名回落

签名材料的读取应改为**按后缀匹配**，并同时支持两代命名：

```javascript
// 伪码：douyin-ticket-guard.js
const KEY_CANDIDATES = {
  cryptSdk: [
    '__security_mc_1_s_sdk_crypt_sdk',      // 当前实际（2026-07 观测）
    'security-sdk/s_sdk_crypt_sdk',          // 历史形态（保留回落）
  ],
  webProtect: [
    '__security_mc_1_s_sdk_sign_data_key_web_protect',
    'security-sdk/s_sdk_sign_data_key/web_protect',
  ],
}
```

同时 `_assertPreconditions()` 的 `includes` 判据要放宽为**后缀匹配**：
```javascript
// 现在是：c.includes('s_sdk_sign_data_key/web_protect=')   ← 依赖 '/'，必失败
// 应改为：/s_sdk_sign_data_key[_/]web_protect=/.test(c)
```

### 4.2 但必须注意三条风险

| # | 风险 | 说明 |
|---|---|---|
| 1 | **`_mc_1_` 可能是版本化的** | `mc_1` 里的 `1` 疑似代际号，将来可能变 `_mc_2_`。**硬编码新名字会重蹈覆辙** → 应做**前缀正则**：`/^__security_mc_\d+_s_sdk_crypt_sdk$/` |
| 2 | **改了也未必能发布成功** | 名字修好只让 Step 0 通过。`web_protect` 的 payload 结构、`ticket` 语义是否也变了，**未知** —— 这正是需要活体验证的部分 |
| 3 | **参考产品也没有解决方案可抄** | 它同样不认识新名字。所以这次**没有现成答案**，必须自己验证 |

### 4.3 建议的推进顺序

```
1. 按 4.1 + 风险 1（正则前缀）做最小修复 —— 纯字符串匹配改动，可单测覆盖
2. 补一条「真实 cookie 形态」的回归测试：
   用本次取证的 __security_mc_1_* 命名构造 fixture（脱敏），
   并断言旧命名仍可用（双形态锁定）
3. 再谈活体裁决 —— 否则活体必然又是 Step 0 失败
4. 活体成功后，把真实响应结构回写 PRD F11
```

### 4.4 一条需要先确认的前提

本次观测样本的 cookie **有效期分别为「已过期 43 天」与「剩 41/2 天」**，
即最新样本也是**数周前**建立的会话。

**无法排除**「平台在某次改版中改回了 `security-sdk/` 命名」。
因此在动手改代码前，**最省事的一步是**：

> 在应用里重新登录一个抖音账号，然后重跑
> `node D:\Data\projects\rea\analysis\diag-douyin-signing-materials.cjs`
> —— 它会直接告诉你当前真实名字是什么。

这个脚本我已经写好并跑通（见 §6）。

---

## 5. 顺带产出的两个结论

### 5.1 前面「会话 cookie 持久化」的对比需要修正

我在 [深挖补充报告-第5轮.md](深挖补充报告-第5轮.md) §4 写了参考产品的
`needHandleSessionCookie`（把 session cookie 提升为持久）。

**本次实测发现：抖音的 security 家族 cookie 全部是 `persist=1 has_exp=1`（持久），
会话级 cookie 数为 0。** 所以至少对抖音而言，那不是瓶颈。

不过那份对比本身仍然成立（它讲的是 13 个平台的通用机制），只是**不适用于抖音的签名材料**。

### 5.2 参考产品「本地签名」这条护城河可能比看起来浅

前几轮我把参考产品的 `clientSign` 当作「已实现本地签名」的证据。
现在看：**它的本地签名在真实会话上取不到私钥**（被 `catch {}` 吞掉），
真正在干活的很可能是它的远端签名服务。

对本项目的含义：**参考产品的本地签名实现不能作为「这条路走得通」的证据** ——
它同样未经真实发布验证。

---

## 6. 复现方式

```powershell
# ① 门禁测试（已完成，全绿：133 direct + 39 vitest / 333 用例）
cd D:\Data\projects\mulpub\packages\api-publish-engine
node scripts/run-tests.js

# ② 前置材料自检（只读；只输出 cookie 名/域/有效期，绝不输出 value）
node D:\Data\projects\rea\analysis\diag-douyin-signing-materials.cjs

# ③ 全盘命名族扫描（948 条 cookie，确认 0 条含 '/'）
node D:\Data\projects\rea\analysis\scan-douyin-security-cookie-names.cjs

# ④ localStorage vs cookie 归属验证
node D:\Data\projects\rea\analysis\verify-security-sdk-storage.cjs

# ⑤ 账号库（确认 accounts 表为空）
node D:\Data\projects\rea\analysis\diag-account-store.cjs
```

**安全声明**：以上脚本全部**只读**——复制 cookie 库到临时目录后以 `readOnly` 打开，
输出中**只有 cookie 名、域、有效期**，**任何 cookie value / 私钥 / ticket 都不读取、不打印、不落盘**。

---

## 附：本次两个前置步骤的结果

### 第一步：W2 门禁测试 —— ✅ 全绿

| 组 | 结果 |
|---|---|
| `direct`（逐文件 node 进程 + egress guard）| **133 / 133 通过** |
| `vitest`（含签名、抖音全链、小红书、快手）| **39 文件 / 333 用例 通过** |
| 退出码 | **0** |

其中与抖音直接相关：
- `douyin-client-sign.test.js` — 16 用例 ✅
- `douyin-video-chain.test.js` — 12 用例 ✅
- `douyin-image-chain.test.js` — 13 用例 ✅
- `douyin-risk.test.js` — 7 用例 ✅
- `signer.test.js`（含「远程通道已物理拆除」）— 6 用例 ✅
- `signer-default-path.test.js` — 4 用例 ✅

> **注意**：这些绿全部建立在「fixture 自己构造 `security-sdk/...` 命名」之上，
> 所以**它们无法发现本报告的缺陷**——这正是 §3 要说明的盲区。

### 第二步：前置材料自检 —— ❌ 不通过（且发现了本缺陷）

| 检查 | 结果 |
|---|---|
| 抖音分区数 | 11（本项目）|
| 有完整登录的分区 | **1**（`auth-auth-douyin-1782959190481`，51 cookies）|
| 其余 10 个 | 仅 6–12 条 cookie，是**未完成/失败的登录** |
| `sid_tt`（登录票据）| ✅ 有，但**已于 2026-08-31 过期** |
| `bd_ticket_guard_client_data` | ✅ 有（同已过期）|
| `security-sdk/s_sdk_crypt_sdk`（代码要找的）| ❌ **不存在** |
| `__security_mc_1_s_sdk_crypt_sdk`（实际存在）| ⚠️ 有，但**代码不认识** |
| 应用账号库 `accounts` 表 | **0 行** —— 没有任何注册账号 |

**若直接做活体，会连续踩两个坑**：先因「无账号/会话过期」失败，
再因 §0 的命名不匹配失败。**两步前置检查把这两个坑都提前拦下了。**
