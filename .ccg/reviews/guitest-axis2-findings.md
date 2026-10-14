# 轴 2（可维护性 / 命名 / 集成风险）外部评审结论原件
# 审查对象 = 提交 37c31668d（含轴 1 处置与 GUI Gate Result 聚合作业）
# 模型 opencode/big-pickle；VERDICT: PASS（无 Critical，1 Warning + 2 Info）
# 该轴自陈：只读约束下**未自行运行 vitest**，"锁有牙"是采信记录里的变异反证，非本轴实测；
# 因此记录里"双轴"的表述必须区分：轴 1 的断言被我逐条重放/取证，轴 2 为建议性意见。
## Q1 判据脚本：命名 / 导出面 / 注释

**命名**：`scripts/ci-gui-relevance.js` —— 与既有 `ci-pr-changeset.js`、`classify-docs-only.js` 同族命名，语义自明（"CI 用"+"GUI 相关性"），**无问题**。

**导出面**：`module.exports = { GUI_PATHS, isGuiRelevant, matchesPattern }`（L92），最小且够用；三个名字各有一个真实读者（workflow 的 `changes` 作业经 CLI 消费、测试文件按路径 `require`）。

**"下一个会话能否知道往哪加路径"**：能。注释 L27 明写「往 `GUI_PATHS` 加项前，先确认它落在这两种形态之内，否则要连 `matchesPattern` 一起增强」，且 L20-27 逐条登记它与 GitHub 原生 paths 的两处语义差异（大小写敏感、只支持 `dir/**` 与字面量）。**这是本变更做得最好的一处**。

**是否会诱出第二份 glob/diff 实现**：不会。
- `grep -n "picomatch\|minimatch\|rev-list" scripts/ci-gui-relevance.js` → 唯一命中是 L23 的注释，**无第二实现**。
- L16 `const { matchesPattern, changedFileStatuses } = require('./classify-docs-only')` 为唯一来源；L10 注释明写「两份必然漂移」。

> **Warning | scripts/ci-gui-relevance.js:28 与 .github/workflows/gui-test.yml:13 | `GUI_PATHS`（5 项）与 `push.paths`（5 项）是同一张清单的两份拷贝，但没有任何锁或注释把二者关联；且 `push` 侧那条锁只覆盖 3/5 项、无长度下界，删除 `package.json` / `pnpm-lock.yaml` 不会变红（见下证据）| 建议：在两侧各加一行交叉引用注释（"此清单与 X 保持同集，改一处须核另一处"），或把 `push` 锁补成完整 5 项 + `length` 断言。**

证据（`sed -n '318,335p' apps/desktop/tests/gui-ci-exit-contract.test.js`）：
```
expect(workflow.on.push.paths).toEqual(expect.arrayContaining([
  'apps/desktop/**',
  'packages/**',
  '.github/workflows/gui-test.yml',
]));
```
→ 只断言 3 项，且**无** `expect(...length).toBe…`。对照 `GUI_PATHS` 锁（L174-182）断言 5 项 + `length>=5`。两清单当前内容相同（`sed -n '13,18p' gui-test.yml` 与 `ci-gui-relevance.js L28-34` 逐字相等）——**无锁把"应保持相同"这件事钉住**。

> **Info | apps/desktop/tests/gui-ci-exit-contract.test.js:180 | `GUI_PATHS` 的"不缩水"锁是单向的（`arrayContaining` + `length>=5`）：删项变红，加项恒绿 | 这是有意设计（允许增长），仅提示：向 `GUI_PATHS` 新增路径不会被任何锁要求"同步进 `push.paths`"，与上一条 Warning 同源。**

---

## Q2 workflow 可读性 / 门控表达式

**`GUI Changes` 与既有 `Changes` / `QG Changes` 的关系**：清晰。`grep -n "name:" .github/workflows/gui-test.yml` → L31 `name: GUI Changes`、L220 `name: GUI Gate Result`，与 `QG Changes` / `Gate Result` 名称均不冲突；L318-320 有一条锁**显式断言** `names` 含 `GUI Gate Result` 且不含 `Gate Result`，防显示名撞车。

**事件谓词与 output 谓词混在一个 `if` 里**：可接受——L70 `if: github.event_name != 'pull_request' || needs.changes.outputs.gui-relevant == 'true'` 上方 L67-69 有 3 行注释解释为何非 PR 分支必须留（否则 main push / tag 被一并短路），且下方配 L206-213 行为锁。**无问题**。

**`GUI Gate Result` 的必要性**：注释（L215-218 与 workflow L226-250）把裁决表写清，且 body 本身对 `changes != success`、非 `success/skipped`、`skipped` 理由不成立三种情形 fail-closed。**可读性良好，无问题**。

---

## Q3 测试组织：CLI 端到端 + 结构锁同放一个 vitest 文件

**现状**：`apps/desktop/tests/gui-ci-exit-contract.test.js` 内既有结构锁（L123-565），也有真 git 仓库 CLI 端到端（L215-283：`execFileSync('node', [scriptPath, …])` 建临时仓库、断言文档判否 / 桌面判是 / 取证失败 `rc=1` 且不写 `GITHUB_OUTPUT` / 空变更集留痕）。

> **Info | apps/desktop/tests/gui-ci-exit-contract.test.js:215 | CLI 端到端放在 vitest 文件里（而非 `scripts/*.test.js` 的 `node --test`），文件名不体现它覆盖了 `scripts/` 层 | 这是**有正当理由的取舍，不建议改**：若拆到 `scripts/`，会被 `.gitignore:106` 的 `scripts/*.js` 静默吞掉（须再补一条 `!scripts/…` negation），且须在 `quality-gate.yml` Gate 2b/2c 显式接线，否则对 `check-unwired-tests.js` 棘轮不可见。留在 vitest 内两处风险都免。唯一代价是可发现性（读者不知此文件覆盖了 `scripts/`）。建议：仅在文件顶部注释里点名它覆盖 `scripts/ci-gui-relevance.js` 进程入口（降低"下次谁来找 CLI 锁找不到"的概率），无需动结构。**

---

## Q4 文档 / 执行记录：边界与"遗留"是否诚实

**结论：无"未做写成已做"。** 记录 `openspec/records/gui-test-required-shape.md` 的「遗留（不假装已闭合）」4 条全部如实：
1. 进 required 应收 `GUI Gate Result` 而非 `gui-test`——明写**未做**（"写入保护/ruleset 属改谁来守门，未随本笔执行"）。
2. 其他 workflow 同类形状仍未被机器拦——明写只有 `gui-test` 有锁。
3. 时长预算未重定——如实给 `p99=592s / max=1431s` vs `timeout-minutes: 30`，并自认余量**未归因**。
4. 2 条环境类失败（≈0.2%）未处理。

**QM-6 行**写「进行中（轴 1 完成并处置；轴 2 待跑）」——与事实相符（轴 2 即本任务）。**无问题**。

---

## Q5 仓库约定符合性

| 约定 | 实测 | 结论 |
|---|---|---|
| `.gitignore` negation | `sed -n '104,113p' .gitignore` → L106 `scripts/*.js` / L109-112 说明注释 + `!scripts/ci-gui-relevance.js` | ✅ 按既有惯例补 negation，且注释写明"漏这条的症状是本地全绿、CI 上 Cannot find module（#3011 第三次）" |
| CHANGELOG 条目形态 | `sed -n '1,12p' CHANGELOG.md` → `# [未发布] …（gui-test-required-shape）` + bullets | ✅ 与相邻未发布条目同形 |
| 执行记录载体 | `openspec/records/gui-test-required-shape.md`，frontmatter `sync_status/sync_reason/sync_backfill_owner` + 表内 `\| 远程同步 \| PENDING \|` 行 | ✅ 载体正确（非 `.quality-gates.md`） |
| 债务账本 | `node scripts/check-gate-record-debt.js` → `rc=0` + `OK: …所有未收口的 远程同步 行均已登记，清单无陈旧项…` | ✅ `openspec/records/*.md` 经自身 frontmatter 登记，**不需**进 `scripts/gate-record-debt-ledger.json`——非缺陷（已核验） |

**无问题。**

---

## 汇总

| 编号 | 严重度 | 位置 |
|---|---|---|
| Q1-a | **Warning** | `ci-gui-relevance.js:28` ↔ `gui-test.yml:13`（两份同集清单无锁，push 锁只查 3/5） |
| Q1-b | Info | `gui-ci-exit-contract.test.js:180`（单向"不缩水"锁） |
| Q3 | Info | `gui-ci-exit-contract.test.js:215`（CLI 锁可发现性） |

**无 Critical。** Q2 / Q4 / Q5 检查通过。变更的注释质量、fail-closed 语义、测试命名与仓库约定的一致性均高于本仓基线；上述两条 Warning/Info 均为**可选的加固建议**（前者不改也不会立刻致错——两清单当前逐字相等；后者属取舍说明），不构成对设计的反对。

**未验证项声明**：本次未运行 `vitest tests/gui-ci-exit-contract.test.js`（只读约束下未执行测试套件），因此"锁真的会红"这一结论引用的是记录中的 12 条变异反证（`MISSED=0 WRONG_CAUSE=0`），**未由本轴独立复跑**，属对记录证据的采信而非本轴实测。

VERDICT: PASS
