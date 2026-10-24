---
record: dep-audit-multi-family-merge
task: 修 npm 域多族公告的 patched 覆盖口径（一族被覆盖 ⇒ 债被低估 + 承诺被上游改写带着抖）
date: 2026-10-24
---

## 本次执行记录：多族公告 patched 合并口径（dep-audit-multi-family-merge，2026-10-24）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动落在 `scripts/**` ⇒ **混合 PR**（`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 判 docs-only=false）。分支 `dep-audit-multi-family-merge`（**基于最新 main**，只 cherry-pick 本刀），经 PR 落地，未直推 `refs/heads/main` |
| 第一性原因（QM-5 ①） | ✅ | 公告库对**同一个 GHSA 的每个修复族各报一条**（各带自己的 `patched_versions` 与命中的依赖链）。实测 2026-10-24 真 `pnpm audit --prod --json`：**26 个 GHSA 里 7 个是多族**，例：`GHSA-3jxr-9vmj-r5cp` → `>=1.1.16`（apps__desktop 链命中 brace-expansion@1.1.15）+ `>=5.0.7`（根链命中 brace-expansion@5.0.6）。而 `parseNpmAudit` 用 `out.set(id, entry)` **覆盖** ⇒ 台账只记了后一族 ⇒ **另一族的命中从台账上消失（债被低估）**；且 `patched` 随 advisory 枚举顺序在两轮扫描间**翻转** ⇒ 人被迫反复把 `targetVersion` 追着上游改写跑（台账里那几条 note 的「上游公告 patched 区间已改写为 >=5.0.10，targetVersion 同步更新（原值低于下界，账永远闭不了）」就是这个循环的现场） |
| 逃逸分析（QM-5 ②） | ✅ | ①**本地夹具全是单族** ⇒ 覆盖与合并在单族下**同形**，70 例里没有一例能区分；②**域间口径漂移**：`parseNpmAuditV2`（npm-opscenter 域）本来就是**合并**的，npm 域（pnpm v1 advisories）却是覆盖 ⇒ 同一个 GHSA 在两个域给出两个答案，而本仓**两个域都在扫**；③**判据用基线自己的 `patched` 校验承诺**（`evaluate` 拿基线条目的 `patched` 去跑 `checkTargetEscapes`），所以「台账记的修复下界偏小」会被当成真下界 ⇒ **一个只闭一族的 `targetVersion` 也能过门禁**（实测：`GHSA-3jxr` 现台账 `targetVersion: 1.1.16`，而 5.0.6 那份 copy 要 ≥5.0.7 ⇒ 这笔账**闭不上**而门禁**不报**） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`parseNpmAudit` 改为**合并**：`patched` 取各族的并集（', ' 连接）、`module`/`roots` 取并集、severity 取最新 —— 与 `parseNpmAuditV2` **逐字同口径**；②新增 `mergePatched`（空串不参与合并：它表示「这条没有修复版」，不是「另一族的修复版」）；③**回归锁 2 例**（`scripts/check-dep-audit.test.js` **72/72 绿**）：①多族必须合成并集且 roots 要全，并断言「只闭一族的 targetVersion 必须判红、逃出全部族才算闭得上」；②**两个域对同一 GHSA 的 `patched` 必须相等**（域间口径漂移锁）。另注：`roots` 不做跨域比较 —— 两种报告格式里 roots 的**语义本来就不同**（v1 是依赖路径、v2 是 effects 包），不是口径漂移 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**判据照抄被测代码**：合并后的 `patched` 仍是**一段一族的原形**（`>=1.1.16, >=5.0.7`），而 `checkTargetEscapes` 既有的「逐段都逃出」语义**正好给出正确承诺**（要闭账就得升到能同时满足所有族的下界）⇒ **门禁判据一个字没改**，改的是它**看到的事实**；②**真实数据回归**：拿真 `pnpm audit` 输出实跑，7 条多族公告合并后 `patched` 全部两段、其中**2 条的现台账 `targetVersion` 不足**（`GHSA-3jxr` 1.1.16→需 5.0.7、`GHSA-rgw5` 1.1.18→需 5.0.9）⇒ 旧口径下这 2 笔债是**隐形**的；③**域间口径一致性有断言**（不是靠注释约定） |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致（`git diff origin/main...HEAD --numstat` 与 `--ignore-cr-at-eol --numstat` 同值），全部是新增/替换行 |
| 接线棘轮 | ✅ | 新增用例写进**已接 CI 的** `scripts/check-dep-audit.test.js`，未新增需要另行点名的测试文件 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（只改 `scripts/**`） |
| QM-6 CCG 双模型外部评审 | 未执行 | 本环境未探测到 `codeagent-wrapper` 类外部评审通道；**如实记为未执行，不以自审冒充通过**。替代验证：真 `pnpm audit` 输出的 26 公告全量实跑 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 实测证据（真数据，不是夹具）

真 `pnpm audit --prod --json --registry=https://registry.npmjs.org`（本机实测，33 条 advisory → **26 个 GHSA**，其中 **7 个多族**）：

| GHSA | 各族（合并前） | 合并后 patched | 现台账 targetVersion | 合并后是否闭得上 |
|---|---|---|---|---|
| `GHSA-3jxr-9vmj-r5cp` | `>=1.1.16` / `>=5.0.7` | `>=1.1.16, >=5.0.7` | 1.1.16 | ❌ 需 ≥5.0.7 |
| `GHSA-rgw5-rvv9-x895` | `>=5.0.9` / `>=1.1.18` | `>=5.0.9, >=1.1.18` | 1.1.18 | ❌ 需 ≥5.0.9 |
| `GHSA-6j4f-fj2g-mc7p` | `>=1.1.19` / `>=5.0.10` | `>=1.1.19, >=5.0.10` | 5.0.10 | ✅ |
| `GHSA-mh99-v99m-4gvg` | `>=1.1.17` / `>=5.0.8` | `>=1.1.17, >=5.0.8` | 5.0.8 | ✅ |
| `GHSA-q2hr-2g5m-vwhr` | `>=1.1.21` / `>=5.0.12` | `>=1.1.21, >=5.0.12` | 5.0.12 | ✅ |
| `GHSA-qhr7-859c-m2p7` | `>=1.1.20` / `>=5.0.11` | `>=1.1.20, >=5.0.11` | 5.0.11 | ✅ |
| `GHSA-27r3-jxmh-p828` | `>=1.20.9` / `>=2.4.0` | `>=1.20.9, >=2.4.0` | 2.4.0 | ✅ |

（与 GitHub Advisory 的 per-family 读数一致：`GET /advisories/GHSA-3jxr-9vmj-r5cp` ⇒ 三族 `<1.1.16`→1.1.16、`>=2.0.0 <2.1.2`→2.1.2、`>=3.0.0 <5.0.7`→5.0.7。）

⇒ 合并后 `patched` 是**稳定**的（不再随枚举顺序翻转）⇒ 人不再需要反复追着上游改写 `targetVersion`。
⇒ 真正闭账的信号仍是**扫描不再报这条**（任一份 copy 还命中就会报）⇒ 承诺值取各族下界的最大值是**保守侧**（假红不假绿）。

### 遗留（不假装已闭合）

- **本刀只改「事实」不改「台账」**：主干的 `scripts/dep-audit-baseline.json` 里那 7 条的 `patched` 仍是单族 ⇒ 要等下一次刷新（`--update`）才会被改写成合并值；届时 `GHSA-3jxr` / `GHSA-rgw5` 两条会因 `targetVersion` 不足而**显红**（此前隐形）⇒ 人需把这两处抬到 5.0.7 / 5.0.9。
- **门禁拿基线自己的 `patched` 校验承诺**（`evaluate` 里 `checkTargetEscapes(item)` 用的是**基线条目**的 `patched`）⇒ 「台账记的修复下界偏小」会被当成真下界 ⇒ 承诺能被 stale 事实蒙混过关。
  **正解是让门禁拿扫描的现值校验**（`evaluate` 里每个 found 条目都有现值 `e.patched`）⇒ 这是**判据语义变更**（改「拿哪份事实当准」），按 AGENTS.md 归人工拍板，本刀**没有代做**。
