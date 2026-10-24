---
record: dep-audit-baseline-refresh-2026-10-24
task: 登记 2026-10-24 新涌出的 7 条依赖公告（fast-uri × 4 / undici × 3），解全仓 PR 连红
date: 2026-10-24
branch: dep-audit-baseline-refresh-2026-10-24
---

# 依赖漏洞审计基线刷新（2026-10-24）

## 1. 现象

`#4354`（登记 2026-10-23 那批 3 条公告）于 2026-10-24T00:50:21Z 合并后，
**全仓 PR 的「依赖漏洞审计门禁」仍然连红**——因为**又涌出一批新公告**。

实测三次快照（同一天内）：

| 时刻 | 未登记的新公告 | npm 域命中数 |
|---|---|---|
| 第一次 | 1 条（zod） | 24 |
| 第二次 | 3 条（+ body-parser、electron） | 26 |
| 第三次 | **7 条**（fast-uri × 4、undici × 3） | **33** |

⇒ 公告涌入速率约 **每小时 2–7 条**；`命中=33 / 挂账=27`，缺口随时间单调扩大。
⇒ 同时期全仓多条 PR 一起红（#4351 / #4342 / #4341 / #4328 / #4344 …），
其中包括**只动 `01-docs/` 与 `openspec/records/` 的纯文档 PR**（本 PR 与 #4344 都是）。

## 2. 根因（机制层，已逐条回源码核实）

| # | 机制事实 | 证据 |
|---|---|---|
| ① | 门禁**对所有 PR 跑全量扫描**，与本 PR 改了什么无关 | `.github/workflows/dep-audit.yml:8-11`：`on: pull_request` **无 paths 过滤**，且注释明写「不得配置 paths-ignore：workflow-contract.test.js 全量扫描禁止」 |
| ② | 基线**只能靠人手写** | 同文件 `:12-13` 的 `schedule: '0 3 * * 1'` 跑的**仍是同一个 job**（`:74-77` `node scripts/check-dep-audit.js`，**只检查不 `--update`**）；全仓 grep `check-dep-audit --update` 只出现在脚本注释与本条记录里，**没有任何自动提交基线的通路** |
| ③ | **没有「先登记、后补结论」的机械路径** | `scripts/check-dep-audit.js:54` `VALID_DECISIONS = ['upgrade-tracked','accepted-risk','not-exploitable','no-fix-available']` —— **不含 `TODO`**；而 `--update` 给新条目写的就是 `decision:'TODO'`（`:461`）⇒ `:580-581` 立刻判 `BASELINE_META_INVALID` 阻断。脚本自己在 `:395` 写明：「新增条目只带 TODO 决策（**必须人工补结论**，否则 META_INVALID 立刻拦下）」 |
| ④ | 进基线的合法 decision **多数需要真实安全判断** | `accepted-risk` / `not-exploitable` / `no-fix-available` 都要人给结论；只有 `upgrade-tracked` + `targetVersion` 是**机械可判**的（`checkTargetEscapes`（`:487-521`）只验：targetVersion 存在、是 `x.y.z` 字面量、且 ≥ `patched` 的每段下界） |
| ⑤ | 顶层 `reviewBy` 到期即拦 | 基线顶层 `reviewBy = 2026-12-31`；`:17` 列出「reviewBy 已过期 → 阻断」 |

⇒ **合并成本 = 每条新公告一次真实安全评估 + 一个 PR**；
而公告涌入速率（每小时 2–7 条）**远超**人工评估速率 ⇒ **全仓 PR 被周期性挡住是当前机制的必然结果，不是某次疏漏。**

## 3. 本 PR 做了什么（以及明确没做什么）

**做了**：把当前这 7 条**机械登记**进 `scripts/dep-audit-baseline.json`：

| 公告 | 模块 | 严重度 | 修复下界 | 本仓 lockfile 实测 | decision / targetVersion |
|---|---|---|---|---|---|
| `GHSA-333x-w4r6-6crp` | fast-uri | low | ≥3.1.9 | fast-uri@**3.1.8** | upgrade-tracked / 3.1.9 |
| `GHSA-w74x-v6f9-j3xg` | fast-uri | moderate | ≥3.1.9 | 同上 | upgrade-tracked / 3.1.9 |
| `GHSA-wjr9-j795-jxcr` | fast-uri | moderate | ≥3.1.9 | 同上 | upgrade-tracked / 3.1.9 |
| `GHSA-xhq7-xmqj-769h` | fast-uri | low | ≥3.1.9 | 同上 | upgrade-tracked / 3.1.9 |
| `GHSA-4qv8-2p9j-2685` | undici | moderate | ≥7.30.1 | undici@**7.30.0** | upgrade-tracked / 7.30.1 |
| `GHSA-f72v-6w45-q472` | undici | moderate | ≥7.30.1 | 同上 | upgrade-tracked / 7.30.1 |
| `GHSA-xjj6-f33q-929c` | undici | **high** | ≥7.30.1 | 同上 | upgrade-tracked / 7.30.1 |

**为什么 `upgrade-tracked` 是机械可判的、且不是「降低门禁」**：
- `checkTargetEscapes`（`:487-521`）只验「目标版本能逃出该公告的漏洞区间」⇒ `targetVersion` = 修复下界即可通过；
- `upgrade-tracked` 的语义是「**已登记、待升级**」，**不是「已接受风险」**；
- 与 `#4354`（当日合并）登的 3 条**同一个 decision、同一套字段**，口径一致；
- 顶层 `reviewBy`（2026-12-31）仍然生效 ⇒ 到期前必须完成升级或改判并给依据。

**明确没做（留给人工）**：
- **没做可利用性评估**（每条 note 首句即写明「**未经可利用性评估**」）；
- **没做实际升级**（fast-uri → ≥3.1.9、undici → ≥7.30.1 并刷新 lockfile）；
- **没写 `accepted-risk` / `not-exploitable` / `no-fix-available`** ⇒ 任何「这条不用管」的结论都不是本 PR 做的。

**数据完整性自检**（`git show origin/main:` 与改后逐条比对）：
- 条数 30 → 37；**丢失 0 条**；**旧条目内容一字未改**；
- 排序合规（`sortEntries` = `(source+id).localeCompare`）；
- `node --test scripts/check-dep-audit.test.js` ⇒ **58/58 绿**。

## 4. 待决：机制缺的那半步（本 PR 不做，属仓库级治理决策）

§2 的 ①–⑤ 合起来是一句话：**「基线追公告」是纯人工工作，而公告机器产出、人力跟不上。**
结构性解法有两个方向，**都需要团队决策**：

- **方向一（放宽登记态）**：给 `VALID_DECISIONS` 增加一个「**已登记、待复核**」的值（如 `pending-review`），
  并配一条**自到期**规则（登记后 N 天仍未给结论 ⇒ 转为阻断）。
  ⇒ 把「每条都要开 PR 改基线」降级成「每条只需补一个结论」，而「登记」由机器做。
  ⚠ 必须配套自到期，否则等于永久挂账。
- **方向二（让机器做机械的那部分）**：`upgrade-tracked` + `targetVersion` 已被证明是机械可判的
  ⇒ 可让 weekly cron 在扫描后**自动开一个「补 decision」的 PR**（只对机械可判的条目自动写 `upgrade-tracked`，
  其余留待复核）。**方向二依赖方向一**（否则 `--update` 产出的 `TODO` 会立刻 `META_INVALID`）。
- **方向三（缩小门禁范围）**：让门禁只在「本 PR 改了依赖文件」时才跑。
  ⚠ **当前不可行**：`.github/workflows/dep-audit.yml:10-11` 明写 `paths-ignore` 被
  `workflow-contract.test.js` 全量扫描禁止（理由是「一旦因路径过滤缺失会让纯文档 PR 永久 BLOCKED」），
  而这条禁令**本身就是这个问题的症状**。若要动它，须先改契约测试并说明新的失败语义。

> **本 PR 只做方向二的前置事实（把机械可判的 7 条登记掉），不代做方向一/二/三的任何一条。**

## 5. 判据

- `node --test scripts/check-dep-audit.test.js` ⇒ **58 pass / 0 fail**；
- `node scripts/check-no-brand-residue.js` ⇒ PASS（扫描 12,388 个 tracked 文件）；
- `node scripts/check-gate-record-debt.js` ⇒ OK；
- `node .github/scripts/check-max-lines.js` ⇒ `✅ 无新增超大文件，挂账清单与现实一致。`；
- 数据完整性：30 → 37 条，丢失 0，旧条目零改动，排序合规（详见 §3）。

## 6. 遗留

- 实际升级（fast-uri ≥3.1.9、undici ≥7.30.1）尚未执行，**本 PR 只登记不修**；
- 7 条的可利用性未评估，note 已逐条标明；
- §4 的三个方向待决策。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）

## CHANGELOG 条目

# fix(dep-audit): 登记 2026-10-24 新涌出的 7 条依赖公告，解全仓 PR 连红（dep-audit-baseline-refresh-2026-10-24）

- 症状：#4354 合并 3 条公告后，全仓 PR（含纯文档 PR）仍红在「依赖漏洞审计门禁」—— 实测同一天内新公告从 1 条涨到 3 条再到 **7 条**（fast-uri × 4、undici × 3），npm 域命中数 24 → 26 → 33。
- 修法：把这 7 条按**机械可判**的口径登记进基线 —— `decision: upgrade-tracked` + `targetVersion` = 修复下界（fast-uri 3.1.9、undici 7.30.1），本仓 lockfile 实测 fast-uri@3.1.8 / undici@7.30.0 均低于下界。
- 边界：只登记、不接受风险 —— 未做可利用性评估（每条 note 首句标明）、未做实际升级、未写 `accepted-risk` / `not-exploitable`；顶层 `reviewBy`（2026-12-31）仍强制到期收口。
- 同时记录机制缺口：门禁对所有 PR 跑全量扫描且禁止 paths 过滤、weekly cron 只检查不刷新、`TODO` 不在 `VALID_DECISIONS` 里（故无「先登记后补」的路径）⇒ 每条新公告都需一次真实安全评估 + 一个 PR，而公告涌入速率远超人工处理速度。三个结构性方向已写入执行记录，待团队决策。
