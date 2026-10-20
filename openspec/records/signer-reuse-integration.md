# 本次执行记录：竞品逆向成果复用 —— signer 遗留假签名收口（signer-reuse-integration，2026-10-21）【混合 PR】

- 分支：`signer-reuse-integration`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 前序：`openspec/records/fix-xhs-api-chain-contract.md` 第 36/52 行登记过
  「`getCsdnSign` / `getKuaishouSign` 仍是简化实现（形态通过、语义未验证），本次只治理小红书，其余留待专项」
  ⇒ **本文件就是那个专项**。

## 一、合规边界（先声明，再动手）

按竞品原件仓库 `00-vendor-originals/README.md`（外部研究仓，路径见本机约定）的五条边界执行：
**不分发/不入库厂商原件、不用于规避平台技术措施**。本轮只做两件事中的前者——
**复用本仓自己的逆向产物**（A 级：已入 main 的 `src/signer/kuaishou-sig3.js`），
厂商 bundle 一行未取。层级划分按任务书：A 级复用、B 级参考架构、C 级仅作情报。

## 二、复用了什么（A 级模式，非代码搬运）

| 复用点 | 来源（A 级范本） | 本轮用法 |
| --- | --- | --- |
| `verifyKnownVector()` 已知向量自检 | `src/signer/kuaishou-sig3.js` | 给 `getCsdnSign` 补**独立复算**的已知向量断言（HMAC-SHA256+base64 可离线验证） |
| `createSigner()` 状态隔离 | 同上 | 对照验证真 sig3 产出 56 字符 |
| 「fail-closed 边界 + 输入构造单独成测」 | 同上 | `getCsdnSign` 三例：缺 secret 抛错 / 非标量不静默退化 / 已知向量 |

## 三、治理结果

### 3.1 拆除 `getKuaishouSign`（Critical，零调用但仍在导出面）

- 原实现：`MD5(apiPh + "|" + JSON.stringify(body))` → **32 位**裸 hex。
- 判废依据（**真实服务端**，非推测）：无签请求被拒 `500002`；带真 sig3 请求 `result:1`；
  真签 **56 字符**。⇒ 结构上就不等长。
- 风险形态：该函数**没有任何调用方**，但仍挂在 `signer-local.js` 的 `module.exports` 上。
  任何人 `require` 到它就会拿到一个"格式合法但语义错"的签名，让上层误以为已具备签名能力。
- 处置：删除函数体 + 从导出面移除（保留判废注释与替代指向），
  并由 `test/signer-local-legacy.test.js` ① 断言其**不再出现**在导出面。

### 3.2 连带修复（拆除暴露出的既有欠账）

| 文件 | 问题 | 处置 |
| --- | --- | --- |
| `test/signer-local.test.js` | 仍在解构并测 `getKuaishouSign`（3 例） | 整段移除（测的是被否证的假签名），17/17 通过 |
| `test/signer-registry.test.js` | 用「旧函数存在」来证明二者不等 | 改为**就地复算**历史近似值比较，并断言旧函数已拆除；11/11 通过 |
| `scripts/run-tests.js` | 我一度把两个 **node:test 风格**文件登记进 `VITEST_FILES` ⇒ `No test suite found` | 撤下（它们归 direct 直跑分支），仅登记新的 vitest 专项 |

⚠ **本轮踩到的同型坑（第三次）**：「新测试存在 ≠ 被正确 runner 执行」（前有 vite alias、
后有 VITEST_FILES 漏登记）。这次的变体是**反向的**——**误把非 vitest 文件登记进 vitest 列表**。
判据：登记前先确认文件是 `describe/test`（vitest）还是 `require("assert")` 裸脚本（node:test）。

## 四、读数

| 项 | 读数 |
| --- | --- |
| `test/signer-local-legacy.test.js` | **5 passed**（含已知向量自检） |
| `test/signer-local.test.js`（direct） | 17/17 |
| `test/signer-registry.test.js`（direct） | 11/11 |
| `packages/api-publish-engine` 全量 | **rc=0（46 文件）** |
| `check-max-lines` / `check-unwired-tests` | ✅ / OK |
| 源码残留 `getKuaishouSign` 调用 | 0（命中的是门面真函数 `getKuaishouSignature`） |

## 五、远程同步

| 远程同步 | 由门禁推导 |
