---
record: kuaishou-sig3-purejs
task: 把快手 __NS_sig3 的 Tier-A 从错误的 MD5 近似式换成完整还原的纯 JS 算法，并让发布链默认走它（保留页面签名器回退）
date: 2026-10-20
---

## 本次执行记录：快手 sig3 纯 JS 接管 Tier-A（kuaishou-sig3-purejs，2026-10-20）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`packages/api-publish-engine/src/signer/**`、`src/signer.js`、`src/publish/capabilities/**`、`src/publish/platforms/**`）⇒ 隔离 worktree `mp-kuaishou-sig3-purejs`，分支 `kuaishou-sig3-purejs` |
| 第一性原因（QM-5 ①） | ✅ | 旧 Tier-A 是 `MD5(api_ph + "\|" + JSON(body))` —— 一个**从未与真签名对拍过的近似式**（32 位裸 hex）。真 sig3 是 56 字符的 VM 产物。2026-09-25 的 W3 spike S0 判定它结构上不等价并"作废"，但当时**没有替换品**，主链路遂改用 Tier-B 页面签名器（Playwright/CEF） |
| 逃逸分析（QM-5 ②） | ✅ | 三处系统性漏洞见下「逃逸链」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 38 个用例（`kuaishou-sig3-purejs.test.js` 23 + `kuaishou-sign-command.test.js` 15），全绿；既有回归锁**有意更新 1 处**（32 位断言 → 56 位，理由见下） |
| 防止再次发生（QM-5 ⑤） | ✅ | 见下「机制性修复」 |
| 行尾与 diff 对账 | ✅ | 见下实测 |
| QM-1 打包 | N/A | 改动落在 `packages/api-publish-engine/`，不在 AGENTS.md 的 QM-1 触发面（`apps/desktop/electron/`、`packages/rpa-engine/`）内 |
| QM-4 视觉 | N/A | 未触碰任何 `.vue` / 样式 / locale |
| QM-6 双模型外部评审 | 未执行（待补） | CCG decider 判定**需要**双模型（`mode=dual`，769 行 > 200 行阈值，`decidedAt=2026-10-20T11:07:18Z`）；后端 `claude` 与 `opencode` 均在 PATH 上、`backendAvailability.count=2/2`；但 `deepReview.status=pending`，**尚未实际执行**。如实记录，不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 见 PR |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件

---

### 一、变更实质

| 项 | 变更前 | 变更后 |
|---|---|---|
| `kuaishou.ns-sig3`（Tier-A） | `MD5(api_ph + "\|" + JSON(body))`，32 位，**从未与真签名对拍** | 竞品 VM 算法**完整还原**为纯 JS，56 位，与 VM 逐字节对拍 **10/10** |
| 发布链默认签名命令 | `kuaishou.ns-sig3-browser`（需 Playwright/CEF 隐藏页） | `kuaishou.ns-sig3`（纯 JS，零浏览器依赖） |
| 回退能力 | 无（Tier-A 不可用） | `{ signCommand: 'kuaishou.ns-sig3-browser' }` 显式回退 |
| 单次签名耗时 | 页面往返（数百 ms 起） | **0.08–0.17 ms** |

算法与证据来源（不在本仓，属另一研究仓）：
- 与竞品 VM 逐字节对拍 10/10（样本含空串 / ASCII / 中文 / emoji / 跨块长度 55·100·200）
- 真实服务端验证：无签 → `500002` 被拒；带签 → `result:1` 通过（另含 `sr` 取 1 天前、1 年前同样通过的对照）

### 二、逃逸链（为什么这个错误近似式活了下来）

| 层 | 为什么没拦住 |
|---|---|
| 单测层 | 原断言是「registry 输出 == `signer-local.getKuaishouSign` 输出，且长度 32」—— **自己和自己比**，从来没有和真签名比过。32 位这个数字本身就是错的，却被当成契约固定下来 |
| 集成层 | `MIN_SIG_LEN = 40` 的门槛已能容纳 56 位，但没有任何用例验证"签名是否被真实服务端接受" |
| Spike 层 | S0 探针选的 `POST /upload/pre` **不在快手的带签白名单**内，不带签也返回 `result:1`，于是拿不到判据 → 结论是「无法确立」而非「作废并替换」 |
| 审查层 | 「本地近似公式」的命名让它看起来像已实现，而不是占位 |

**共性根因**：把「与自身另一份实现一致」当成了「与平台一致」。这是"用工具的自洽冒充外部真值"的同型错误。

### 三、机制性修复（防止再次发生）

1. **测试断言的锚点换成外部真值**：`kuaishou-sig3-purejs.test.js` 的 4 条硬基线是**与竞品 VM 逐字节对拍固化下来的值**，不是本次现算后填进去的。任何人改动算法都会当场红。
2. **输入构造单独成测**：`buildSignatureInput` 的期望值来自**真实服务端返回 `result:1` 的那次请求**，把"payload 构造错了"这类缺陷从"签名算法错了"里分离出来。
3. **源码注释写清三个不可"修正"的坑**：`pad` 的长度字段是 `bitLen + 512`（非标准）、字保持有符号、`compress` 必须 `slice` IV（竞品会就地改写）。
4. **回退开关 + 回归锁**：`kuaishou-sign-command.test.js` 锁住「默认纯 JS / 可显式回退 / 常量自洽」，避免将来有人静默改回或改坏。
5. **合规红线测试**：断言 `kuaishou-sig3.js` 内不含任何网络模块引用（`axios` / `node:http` / `fetch(` 等）。

### 四、有意更新的既有回归锁（不是"改测试凑绿"）

`test/signer-registry.test.js` 原用例：

```js
const expected = local.getKuaishouSign(body, "PH123");
assertEqual(await signerMod.registry.sign("kuaishou.ns-sig3", {...}), expected);
assertEqual(expected.length, 32);
```

**它锁的正是被证伪的实现**。本次拆成两条：
- 「产出真 sig3（56 hex）」
- 「不再等于旧的近似式」（同时断言 `legacy.length === 32`，把"旧式确实短一半"变成可见证据）

并在文件中写明变更理由。

### 五、实测对照（共享根 vs worktree，同机同依赖）

| 测试 | 共享根（未改动基线） | worktree（本次改动） | 判定 |
|---|---|---|---|
| `signer-registry.test.js` | 0 | 0 | 均为绿 |
| `kuaishou-capabilities.test.js` | 0 | 0 | 均为绿 |
| `browser-page-provider.test.js` | 0 | 0 | 均为绿 |
| `kuaishou-sig3-purejs.test.js` | 1（文件不存在） | **0** | 新增，绿 |
| `kuaishou-sign-command.test.js` | 1（文件不存在） | **0** | 新增，绿 |
| `signer.test.js` | 1 | 1 | 预存在失败（两侧同） |
| `signer-default-path.test.js` | 1 | 1 | 预存在失败（两侧同） |
| `kuaishou-video-chain.test.js` | 1 | 1 | 预存在失败（两侧同） |

**回归数：0 —— 但这张表本身是不够的（见下）。**

> 过程中出现过一次假回归：worktree 初建时缺 `node_modules`，`kuaishou-capabilities.test.js` 报 `MODULE_NOT_FOUND` 被判 REGRESSION。
> 装依赖后复测为 0/0。

#### ⚠️ 更正：上表是**选择性取样**，曾掩盖了 4 个真实回归

上表只挑了 7 个"看起来相关"的测试文件。跑**全量** `node scripts/run-tests.js` 后暴露 3 文件 / 4 用例失败：

| 文件 | 失败用例 | 根因 |
|---|---|---|
| `test/kuaishou-video-chain.test.js` | 求签调用形态：command=kuaishou.ns-sig3-browser | 断言默认命令名，本次已改为纯 JS |
| `test/signer.test.js` | getKuaishouSignature 本地计算：MD5(api_ph\|body) | 断言被证伪的近似式 |
| `test/signer.test.js` | getKuaishouSignature 缺 api_ph 返回空签名 | 新输入不含 api_ph，拦截点在前置校验 |
| `test/signer-default-path.test.js` | 链无 opts.signer 时缺省走注册表 | 断言 `['kuaishou.ns-sig3-browser']` |

四者**全部是有意的行为变更所必需同步的断言**，不是代码 bug；但**漏改会让 main 变红**。

已全部更新（并各自写明变更理由），更新后全量 `run-tests.js` **rc=0**。

**教训**：用手挑的文件集做回归对照，等于用"我以为相关的测试"当判据 ——
这与本 PR 要修的根因（用"自己和自己比"当判据）是同一类错误。
正确做法是跑**全量测试套件**，让失败自己浮现。

### 六、已知边界（不假装已闭合）

1. **`submit` 端点尚未用纯 JS 做活体回归** —— 本次验证覆盖的是只读端点（`account/current`）。带发布副作用的 `video/pc/submit` 未盲发（合规要求），因此默认切纯 JS 后，该步骤需在有真实发布意图时走一次 S3 语义回归。这也是保留 `-browser` 回退的原因。
2. **`startupRandom` 时间窗口**：实测服务端不校验（`sr` 取 1 天前、1 年前均通过）。但不同端点策略可能不同，实现仍使用当前时间。
3. **`count` 并发**：进程内单调递增；多进程/多实例并发签名时各自独立计数，是否被平台判定异常未验证。

### 七、合规

- 本 PR 的代码**不发起任何网络请求**（有测试断言），只做纯计算。
- 研究阶段对生产 API 的探测为只读端点、单次、无重试、无发布，详见另一仓的证据文件。
- 未在任何 tracked 文件落 cookie / token / api_ph / api_st 明文。
