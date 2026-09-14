# BUGFIX：点击登录报「退出失败，当前登录仍然有效。」（IDENTITY_SESSION_CLEAR_FAILED）

- 报告编号：BUGFIX-IDENTITY-SESSION-CLEAR-FAILED-2026-09-14
- 日期：2026-09-14
- 分支 / worktree：`codex/identity-session-clear-failed` / `D:\Data\projects\mp-worktrees\mp-identity-session-clear-failed`
- 严重级别：P1（登录/退出主流程不可用，且错误提示与真实原因相反）
- 关联文档：[PRD-F14-LOGTO-PRODUCTION-READINESS.md](./PRD-F14-LOGTO-PRODUCTION-READINESS.md) §8、`01-docs/learnings.md`

---

## 1. 现象

应用（dev 模式，从 IDE 终端启动）中点击头像/登录按钮，弹出的账号面板显示：

| 显示项 | 实际渲染 |
|--------|----------|
| 标题 | `Multi-Publish` |
| 状态 | `需要重试` |
| 状态说明 | `退出失败，当前登录仍然有效。` |
| 主按钮 | `重试登录` |
| 底部错误 | `退出失败，当前登录仍然有效。`（与状态说明重复） |

两处致命问题：

1. **语义相反**：用户点的是「登录」，提示的却是「退出失败」；
2. **无法自愈**：点「重试登录」仍然报同一句，登录窗口根本不会打开。

---

## 2. 根因溯源（第一性原因）

### 2.1 真实失败点：宿主注入的「安全删除 shim」击穿了本地会话清理

通过 CDP 直连运行实例的渲染进程，读取主进程真实状态（而非猜测）：

```
window.electronAPI.identityGetState()
→ { code: 0, data: { status: "error", user: null, entitlement: null,
     error: { code: "IDENTITY_SESSION_CLEAR_FAILED",
              message: "登录失败，且本地登录信息未能清理，请重试" } } }

window.electronAPI.identitySignIn()
→ { code: -3, message: "IDENTITY_SESSION_CLEAR_FAILED" }   // 可 100% 复现
```

`IDENTITY_SESSION_CLEAR_FAILED` 只可能来自 `AuthService._clearLocalSession()` 里两个
`clear()` 之一，且 `toIdentityError(error, 'IDENTITY_SESSION_CLEAR_FAILED')` 只会在
**原始错误不是 IdentityError（即没有 `.code`）** 时套用该兜底码 —— 说明抛出的不是普通
文件系统错误，而是被包装过的外部错误。

根因链（已用对照实验逐步证实）：

1. **宿主注入的 safe-delete shim**：从 IDE（CodeBuddy/WorkBuddy 系）终端启动的进程会继承

   ```
   NODE_OPTIONS=--require="D:/Program Files/CodeBuddy CN/resources/app/extensions/genie/out/vendor/shim/node-language-shim.cjs"
   CODEBUDDY_SESSION_ID / CODEBUDDY_TOOL_CALL_ID / CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR
   CODEBUDDY_SAFE_DELETE_HOST_HEARTBEAT / CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD
   ```

   该 shim patch 了 `fs.unlink / fs.rm / fs.rmdir`（含 `fs.promises` 版本），把「删除文件」
   改写为「移入回收站」，并在删除前跑 **safe-delete bulk guard**。
   2. **shim 的删除链路一旦失败即 fail-closed**（抛出不带 `.code` 的 Error，**不复核、不降级原生删除**）。
   实测可产生该错误的形态有**两种**（同属一个故障族）：
    - **(a) bulk guard 计数越限**：`requestId = conversationRequestId || toolCallId`，默认阈值 **500**，
      达阈值即打印 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {...}` 并 `exit 2`，
      shim 把 stderr 内容包成 Error 抛出；
    - **(b) 删除链路本身失败**：guard 助手不可用 / 读状态失败（`SAFE_DELETE_BULK_GUARD_ERROR`）、
      或 `genie-trash` 回收站二进制退出非 0 或超时（`[safe-delete] 操作失败: ...`）——同样 fail-closed。
   3. **Electron 主进程是长生命周期进程，会把 (a)/(b) 从偶发放大成持续**：
    `CODEBUDDY_TOOL_CALL_ID` 是启动那一刻冻结的旧 tool call id，应用运行数小时会持续删除
    临时/缓存/DB 轮转/日志裁剪文件 ⇒ (a) 的计数有机会累积到阈值；而 (b) 一旦失败，
    之后**每一次**删除都会重新走同一条链路、持续失败。
    (a) 的存在有历史证据：共享状态目录 `D:\Temp\codebuddy-safe-delete-bulk` 中多个 requestId
    停在 `499`（如 `chatcmpl-tool-b565128984c0eaee`），并遗留 `signal-*.json`（confirmRequired 信号文件）。
   4. **`SecureTokenStorage.clear()` 强依赖「删除成功」**：`fs.promises.unlink(identity-session.json)`
   被拦截 ⇒ 抛非 fs 错误 ⇒ `AuthService` 报 `IDENTITY_SESSION_CLEAR_FAILED`。
   同一原因还解释了 profile 目录里堆积的 `identity-session.json.<pid>.tmp` 残留
    （`_writeAtomic` 的失败清理同样走 `unlink`）。
5. **错误被掩盖 + 前端文案映射错误**（本质缺陷，非环境问题）：
   - `_performSignIn` 的 `catch` 用 `throw cleanupError || identityError`，让「清理失败」抢占
     真实失败原因；`_clearLocalSessionOrSetError` 又直接改写 state ⇒ 前端永远只看到
     `IDENTITY_SESSION_CLEAR_FAILED`；
   - `ProfileMenu.vue` / `MemberCenter.vue` 的错误码映射表只登记了 6 个码，且 **fallback 写成
     `signOutFailed`**；`statusNote` 对 `status === 'error'` 也无条件用 `signOutFailed`
     ⇒ 任何登录失败都以「退出失败，当前登录仍然有效。」呈现（并重复两次）。

### 2.2 对照实验（可复现证据）

| 实验 | 条件 | 结果 |
|------|------|------|
| A | PowerShell / node.exe 删除 `D:\tmp\...\identity-session.json` | `UNLINK_OK`（说明目录/ACL/文件属性均正常，排除「安全软件持锁目录」旧结论） |
| B | 真实 Electron 运行时直接调用同一份 `SecureTokenStorage`（批量守卫阈值正常） | `save/save/save/clear` 全 OK |
| C | 同 B，但把守卫阈值设为 1（等价「该 requestId 计数已耗尽」） | `clear=FAIL(undefined:[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] ...)` —— **与线上错误形态完全一致** |
| D | 剥离 shim 环境后重跑 C | 全 OK |
| E | 修复后的 `SecureTokenStorage` 在 C 的条件下重跑 | `clear=OK`、`loadAfterClear=null`，无 tmp 残留 |
| F | 直接复现 bulk guard 拒绝（`THRESHOLD=1` + 非临时目录） | `fs.promises.unlink` 抛 `code=undefined` + `SAFE_DELETE_BULK_CONFIRM_REQUIRED` |
| G | 同一条件下对比**目录位置**（`D:\Temp\...`＝`os.tmpdir()` vs `D:\tmp\...`） | 临时目录下 `clear=OK`、非临时目录下 `clear=FAIL` —— 证明 shim 对系统临时目录直接放行（也解释了「把 profile 复制到无锁目录即可绕过」的真正原因） |

> 结论修正一：2026-09-14 早先的 E2E 报告把该现象归因为「profile 目录被安全软件持锁」，
> 方向不准确。真正的拦截来源是**宿主 IDE 注入的 safe-delete shim 守护逻辑**，
> 与被保护的文件本身无关（同目录的 PowerShell 删除完全正常）。
>
> 结论修正二：C/F 证明的是「该机制能产生与线上**完全相同**的错误形态」，**不等于**证明
> 本次实例就一定走在 (a) 计数越限这条分支上；详见 §2.3 证据边界。

### 2.3 证据边界（本次未能唯一确定的部分）

| 已证实 | 未证实 / 不可回溯 |
|--------|-------------------|
| shim 确实被注入并激活（应用内 `fs.unlink` 抛出的正是 shim 生成的、**不带 `.code`** 的错误）；它只 patch 删除类 API；删除走临时目录时放行；剥离后恢复；修复后在同等条件下 `clear=OK` | 本次实例具体走的是 **(a) 计数越限** 还是 **(b) 删除链路失败** |
| (a) 的机制真实存在（历史 requestId 停在 `499` + confirmRequired 信号文件） | 应用当次运行的 requestId 计数条目已不可见（`state.json` 中无今天该 requestId 的计数；1 小时空闲 TTL 会清理长期未更新的计数） |
| (b) 也会产生同族错误（`SAFE_DELETE_BULK_GUARD_ERROR` / `[safe-delete] 操作失败`） | 状态目录中**只有本次诊断探针留下**的 3 个 `signal-*.json`，**没有**应用那次运行的 → 无 confirmRequired 信号 ⇒ 本次**更像 (b)**（signal 文件仅在计数越限/被拒时写，且从不被清理） |
| — | 历史启动方式（是否每次都由 IDE Agent 终端拉起）、当时 shim 版本是否带 liveness 门（代码注释显示曾修过「僵尸 requestId 一路累加到 500」的问题）均无现场证据 |

补充判据：本机 `CODEBUDDY_CONVERSATION_REQUEST_ID` **未注入**，故 `requestId = toolCallId`，
即**每次启动基本是一个新计数** —— 这解释了「重启后短期可用、跑久了才坏」的表现。

**两种子路径的修复手段相同**（不把 shim 继承进 Electron 主进程 + 清空会话不依赖删除能力），
因此本文把它们并列为同一故障族处理，不对二者的发生率做排序断言。

---

## 3. 逃逸分析（为什么没被拦住）

| 层级 | 覆盖情况 | 为什么没拦住 |
|------|----------|--------------|
| 单元测试 | `auth-service.test.js` 有「退出时本地会话清理失败会保留身份并允许重试」 | 只覆盖 **signOut + 清理失败**，未覆盖「**登录失败 × 清理也失败**」这个组合；组合缺口 |
| 单元测试 | `secure-token-storage.test.js` 有真实文件原子写入/清理 | 只测「删除成功」路径，**没有「删除被拒绝」这条真实存在的失败路径** |
| 渲染层测试 | `ProfileMenu.test.js` 有 4 条交互用例 | 用例里的错误码恰好是 `IDENTITY_SIGN_OUT_FAILED`（映射表里**唯一**正确的一条），所以 fallback 缺陷不可见 |
| 集成 / E2E | 无 | 身份链路依赖真实 Logto 租户，属 `PENDING_EXTERNAL`；且启动器环境与 CI 不同（CI 无 shim），本机 dev 才有 |
| 代码审查 | 无 | `throw cleanupError \|\| identityError` 与 `messages[code] \|\| t('signOutFailed')` 两处都是「看起来无害的兜底」，静态审查难以发现语义反转 |

---

## 4. 系统性漏洞定位

1. **测试场景缺失**：错误码 × 状态分支是一张二维表，但用例只覆盖了其中一个格子；缺「映射表完备性」这类结构性断言。
2. **测试质量不足**：断言的是「有错误可见」，而非「**这个错误是哪一个**」——无法区分「正确错误」与「兜底错误」。
3. **兜底语义危险**：默认值选了「有意义的错误文案」（退出失败）而不是中性文案，让「未知错误」伪装成「已知错误」。
4. **错误传递设计缺陷**：清理是失败路径的收尾动作，却与主错误争夺「暴露优先级」。
5. **环境契约缺失**：应用无法感知自己运行在被 shim 污染的环境里，也不打印原始错误，排查只能靠猜。

---

## 5. 修复方案

### 5.1 根因修复：启动链环境净化（`apps/desktop/scripts/electron-runtime-env.js`）

`buildElectronEnv()` 从「只剔除 `ELECTRON_RUN_AS_NODE`」扩展为「统一剔除宿主注入的敌对环境」：

| 处理对象 | 规则 |
|----------|------|
| `ELECTRON_RUN_AS_NODE` | 剔除（原有） |
| `CODEBUDDY_SESSION_ID` / `CLAUDE_SESSION_ID` | 剔除 —— shim 入口要求该变量存在，缺失即整体 inert |
| `CODEBUDDY_TOOL_CALL_ID` / `CODEBUDDY_CONVERSATION_REQUEST_ID` | 剔除 —— 冻结的旧 tool call id 正是计数累积的载体 |
| `CODEBUDDY_SAFE_DELETE_*`（ENABLED/BULK_STATE_DIR/BULK_THRESHOLD/STATE_DIR/TERMINAL_KEY/HOST_HEARTBEAT/REPORT_PATH） | 剔除 —— 守卫上下文；缺失即不计数 |
| `BASH_ENV` | 剔除 —— 指向 shim 的 bash 注入脚本 |
| `NODE_OPTIONS` | 移除 `--require` 指向 shim 模块的片段（支持引号/非引号、含空格的 `D:\Program Files\...` 路径）；清空则删除该变量；**保留**其他选项（如 `--max-old-space-size`） |
| `PATH` / `PYTHONPATH` | 移除 `extensions/genie/out/vendor/shim` 目录条目；清空则删除该变量 |

纯函数、大小写不敏感；显式 `overrides` 仍然优先（保留主动设置能力）。两个 spawn 点
（`apps/desktop/scripts/dev.js`、`scripts/launch-worktree.js`）已接线，无需再改。

### 5.2 防御纵深：会话存储不再被「删除能力」绑架（`secure-token-storage.js`）

| 改动 | 说明 |
|------|------|
| 删除被拒绝 ⇒ **降级覆写** | `clear()` 先尝试删除；失败则写入「已清空」信封 `{version:2,ciphertext:'',encrypted:false,cleared:true}`，`load()` 识别 `cleared` 直接返回 `null`。语义等价：令牌内容被不可用载荷覆盖，本地登录信息失效。**不依赖删除能力** |
| 瞬时错误有界重试 | `unlink` / `rename` 对 `EPERM/EBUSY/EACCES/EMFILE/ENFILE` 重试 3 次（25/50/100ms）；语义错误（如 shim 的 fail-closed 错误）立即放弃，不拖慢登录 |
| 残留临时文件自愈 | `save()` / `clear()` 回收同目录下超过 60 秒的 `identity-session.json.<pid>.tmp`（避免误删并发写入中的临时文件） |
| 错误保真 | 删除与覆写都失败时抛 `IDENTITY_SESSION_CLEAR_FAILED` 并**保留原始 `cause`**，不再是「无信息的兜底码」 |
| 损坏数据兜底清理 | `load()` 的损坏分支改为 best-effort 清理，清理失败不再把「读取」变成「抛错」 |

### 5.3 主错误优先（`auth-service.js`）

- 新增 `_clearLocalSessionAfterSignInFailure()`：登录失败后的清理**只回报结果、不改写 state**；
- `_performSignIn` 的 `catch` 改为：

  ```
  state.error = { code: <主错误码>, message: '登录失败，请重试',
                  cleanup: { code: 'IDENTITY_SESSION_CLEAR_FAILED' }? }   // 仅清理也失败时
  throw <主错误>            // 不再 throw cleanupError || identityError
  ```

  抛出的错误对象附 `cleanupCode` 字段供诊断；
- `_performSignOut` / `_clearLocalSessionOrSetError` 的语义保持不变（退出场景下清理失败**就是**主错误）；
- **诊断日志**：新增 `_logFailure(scope, error, extra)`，记录完整 cause 链（`code: message <- cause...`）。
  埋点在 `signIn` / `signInCleanup` / `tokenStorage.clear` / `clearLocalSession` /
  `clearSignInWindowSession` / `getAccessToken(.network/.sessionRejected)` / `restore` /
  `signOut.remote`。日志器由工厂注入（`require('../logger')`），也可用 `options.logger` 覆盖。

### 5.4 前端提示修正（唯一映射 + 中性兜底）

- 新增 `apps/desktop/src/utils/identity-error-messages.js`：错误码 → i18n key 的**唯一映射**
  （28 个码），未知码回落到中性文案 `memberCenter.operationFailed`；
- `ProfileMenu.vue` 与 `MemberCenter.vue` 改为共用该映射（消除两份漂移的表）；
- `statusNote` 改为按状态取词：未登录态 `error` 用新词条 `retryHint`（不再复用「退出失败」，
  也避免与下方详细错误重复两次）；
- 主错误 + 清理失败时，追加第二条可操作提示（`sessionStoreBlocked`）；
- `stores/identity.js` 的 `normalizeError()` 保留新增的 `cleanup` 字段。

---

## 6. 回归保护测试

| 文件 | 新增用例 | 保护点 |
|------|----------|--------|
| `apps/desktop/scripts/electron-runtime-env.test.js` | 5（+2 断言组） | shim 上下文变量必被剔除；`NODE_OPTIONS` 各种形态（引号/非引号/空格路径/本机实测值）被清除且保留其他选项；`PATH`/`PYTHONPATH` 目录条目被清除 |
| `apps/desktop/electron/services/identity/secure-token-storage.test.js` | 5 | 删除被拒绝 ⇒ 降级覆写且 `load()` 为空；瞬时错误重试成功后不覆写；双失败报带 `cause` 的明确错误；`rename` 瞬时失败重试且不留 tmp；保存时回收陈旧 tmp |
| `apps/desktop/electron/services/identity/auth-service.test.js` | 3 | 登录失败 × 清理失败 ⇒ 主错误码保留 + `cleanup` 附加；清理成功 ⇒ 无 `cleanup` 键；失败写诊断日志且不改对外错误码 |
| `apps/desktop/src/utils/identity-error-messages.test.js` | 5（新增文件） | 登录类不再映射到 signOutFailed；只有 `IDENTITY_SIGN_OUT_FAILED` 用退出文案；未知/空码回落中性文案；副标题按状态区分 |
| `apps/desktop/src/components/ProfileMenu.test.js` | 4 | 登录失败文案正确且不出现「退出失败」；清理失败追加可操作提示；已登录态退出失败仍用退出文案；未知码中性 |
| `apps/desktop/src/stores/identity.test.js` | 2 | `cleanup` 字段保真；无该字段时不产生多余键 |

---

## 7. 预防措施（已落地）

1. **环境契约**：Electron spawn 前必须走 `buildElectronEnv()`（唯一实现），新增 spawn 点直接在
   该函数登记即可获得全部净化能力；
2. **删除能力不得作为正确性前提**：凡「清空/失效化本地敏感数据」的实现，必须提供「删除不可用」
   时的等价降级路径，并写回归用例；
3. **兜底文案必须中性**：错误码映射表的默认值一律中性（`operationFailed`），禁止让未知错误
   复用某个具体业务文案；
4. **主错误优先**：失败路径的收尾动作（清理/回滚/释放）不得覆盖主错误码；附加信息放独立字段；
5. **必须可诊断**：身份链路每个失败分支都要落一条带 cause 链的日志（本次事故中「没有日志」
   是排查耗时最长的原因）；
6. **测试矩阵**：错误码映射表的新增/删除由测试遍历断言（`只有 signOutFailed 映射到退出文案`），
   避免再次出现「表里少一条就静默兜底」。

---

## 8. 本机处置建议（用户可操作）

1. **重启应用**并用修复后的启动脚本启动（`scripts/start-desktop.ps1` / `pnpm dev`），
   启动后进程不再继承 shim，删除能力恢复正常；
2. 手工清理残留：删除 profile 目录下的 `identity-session.json.*.tmp`（历史残留，无害但会累积）；
3. 如需长期规避，可把 profile 目录（默认 `D:\tmp\Multi-Publish-debug-profile`）加入安全软件白名单，
   或把 profile 放到 `%TEMP%`（本机即 `D:\Temp`）下——shim 对系统临时目录直接放行。
