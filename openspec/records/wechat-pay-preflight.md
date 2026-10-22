---
record: wechat-pay-preflight
task: 支付上线预检命令（配置 / 凭据 / 装配 / 迁移 四合一）
date: 2026-10-23
---

# 支付上线预检

## 1. 为什么还要做这个

前两轮把「前端能不能付款」的两类缺口修掉了（compose 透传、provider 接线）。但这两类缺口的共同点是
**不报错、不红测试，只表现为「前端功能不存在」**：

| 缺口 | 现象 | 当时靠什么发现 |
|---|---|---|
| compose 没透传 | 前端恒「支付通道暂未开放」 | 人工比对 `.env.example` 与 compose |
| provider 从未构造 | 同上 | 人工读 `logto-runtime.js` |

靠人工比对不可持续。运维在真正启用支付时，需要一条**能自己跑、能给出可操作结论**的命令。

## 2. 命令做什么

`packages/api-publish-engine/scripts/payment-preflight.js`

| 检查项 | 查什么 | 对应哪个已知缺口 |
|---|---|---|
| `provider-kind` | `PAYMENT_PROVIDER` 取值；`none` ⇒ SKIP 并结束 | — |
| `env` | 7 个支付变量的存在性与形状（复用 `validateProductionConfig`） | 少变量/形状错 |
| `credentials` | 私钥与平台公钥能否被 `crypto` **解析**（不只判非空） | PEM 粘错、路径错 |
| `provider` | **provider 真的能被构造出来** | 缺口 ②「从未被构造」 |
| `database` | `assertReady()`：`identity_payment_customers` 等关系是否都在 | 「不迁移则整站不可用」 |

退出码：`0` 全通过 / `1` 有失败项 / `2` 用法错误。
`--json` 机器读，`--skip-db` 只查配置。

### 刻意不做的事

**不访问微信服务器。** 本命令证明的是「我们这边准备好了」，不证明「微信会接受」——
后者只有真机 E2E（PRD §11.4）。把这两件事混在一份"通过"里，就是在制造虚假信心。

## 3. 判据

新增 **15 例**（`test/payment-preflight.test.js`）：

| 用例 | 断言 |
|---|---|
| `none` | 只 SKIP，`ok=true`（可选能力不该报错） |
| 非法 provider | FAIL |
| 缺变量 | env FAIL 且逐条点名 |
| 好凭据 | credentials PASS + **provider PASS** |
| 垃圾凭据 | credentials FAIL、provider **SKIP**（不假装验过） |
| `--skip-db` | database SKIP 且提示「上线前必须查一次」 |
| 迁移已应用 / 未应用 | PASS / FAIL 且指向 `migrate-postgres.js` |
| 连接必被关闭 | `close()` 被调用（不泄漏连接） |
| CLI | `--help` rc=0、未知参数 rc=2、检查失败 rc=1 |

### 变异反证（两条，均双向）

| 变异 | 结果 |
|---|---|
| 凭据失败也记 `PASS` | **13 pass / 2 fail**，凭据用例精确变红 |
| 不关闭 repository 连接 | **13 pass / 2 fail**，关闭用例精确变红 |

均逐字节还原 True。

## 4. ⚠️ 过程事故：我把文件写到了共享根

写这个脚本时，我用绝对路径直接写进了 `D:\Data\projects\mulpub\packages\api-publish-engine\scripts\`
——**共享主目录，运行时代码禁止落盘**。

**写保护按设计收缴了它**：

```
quarantine\20261023-015209547-packages_api-publish-engine_scripts_payment-preflight.js
```

共享根 `git status` 干净，没有任何残留。我从隔离区把文件取回，放进合法 worktree
`mp-wechat-pay-preflight` 后继续。

**这条要记的不是"我犯了个错"，而是"守卫有效"**：如果没有 `guard-shared-root-writes.ps1`，
这个文件会静静躺在共享根的 main 工作区里，下一轮任何人 `git add -A` 就把它带进一个不属于它的 PR。
这类污染不会报错，只会让 review 看到莫名其妙的文件。

## 4.5 外部评审处置（1 Critical + 1 High + 2 Medium + 1 Low，**全部成立并已修**）

| # | 评审意见 | 处置 |
|---|---|---|
| 1 | **Critical**：`await repo.close().catch(...)` 兜不住**同步**抛错；异常会顶掉刚算出的 database 结论，操作者看到退出码 2、看不到「迁移过没过」 | **已修**：改 `try { await repo.close() } catch (_) {}` |
| 2 | **High**：`--database-url --json` 会把 `--json` 当连接串 | **已修**：下一个参数以 `-` 开头即判 `PAYMENT_PREFLIGHT_ARGUMENT_INVALID` |
| 3 | Medium：错误分类只看 `error.code` 里的 `CERT`，Node crypto 原生错误没有 code ⇒ 「PEM 粘错」被报成「装配失败」 | **已修**：加 message 兜底（`key|cert|crypto|pem|asn1|decoder|der routines|unsupported|wrong tag|no start line`） |
| 4 | Medium：没有覆盖「close 同步抛」的测试 | **已修**：新增 4 例（含同步抛、无 code 的 crypto 错误） |
| 5 | Low：`PAYMENT_PROVIDER=none` 时提前 return，结果里**完全没有** database 项 ⇒ 操作者以为查过了 | **已修**：补一条 `database: SKIP「支付未启用，未检查迁移」` |

评审这次的质量明显高于上一次（上次那条 High「签名要带域名」是错的）：**五条全部指向"会不会谎报"，而不是风格**。
尤其 #1 是我自己没想到的资源处理细节 —— `close()` 同步抛是真实存在的情形（构造已失败的对象尤其容易）。

### 判据

新增 4 例（总计 **20 例**）。变异反证：把 `try/catch` 改回 `.catch()` → **18 pass / 2 fail**，Critical 用例精确变红；逐字节还原 True。
## 5. 文档

PRD §15.3 重写：把预检命令放在第一位，给出五项检查的**失败原因对照表**与退出码语义，
并保留原先的三条常规自检（就绪探针 / 端点存在性 / 完整配置校验）。
明确写：「预检只能证明我们这边准备好了，不能证明微信会接受」。

## 6. 仍未做

| 项 | 阻塞 |
|---|---|
| `tasks.md` `0.3` / `8.8`（真机凭据与 E2E-1~7） | 需要真机凭据 |
| 生产注入、商户平台回调配置、网关放行、灰度、回滚演练 | 运营 / 运维 |

本 PR 让「最后一步」变成可执行、可自证的一条命令；但它替代不了真机支付。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
