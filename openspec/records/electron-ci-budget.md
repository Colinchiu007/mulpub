# 执行记录：electron-ci-budget（2026-10-20）

**分支**：`electron-ci-budget` ｜ **基线**：`origin/main@aee0642fa`
**性质**：改 `.github/workflows/electron-ci.yml` —— 属「改谁来守门」，按 AGENTS.md **不自动合并**，须人工过目。

## 决策来源

诊断见 `01-docs/PRD-ELECTRON-CI-TIMEOUT-DIAGNOSIS-2026-10-20.md`（在 PR #4094 中）。用户确认「按推荐来」，即：

- ✅ 做问题 1（预算上限）：**3600s**
- ✅ 做问题 2（放宽 + 告警）
- ❌ 不做问题 3（单 job 内并行分片）—— 留待实测加速比与峰值内存后再议
- 授权实施，但 **CI 全绿后不自动合并**，等人工看 diff

## 门禁表

| 门禁 | 结果 | 证据 |
|---|---|---|
| 会话隔离 | ✅ | worktree `<worktree-root>/mp-electron-ci-budget`，非 C 盘，分支裸名；共享根保持 `main` clean |
| 判定「改谁来守门」 | ✅ | 改 `.github/workflows/`；`classify-docs-only` 必为 false（混合 PR），走完整门禁 |
| **自动合并** | **禁止** | 按 AGENTS.md「禁止自动合并的情形」第 2 条：改 `.github/workflows/` 分支保护规则/作业规模须人工过目。本 PR 交付后**停在原地等确认** |
| YAML 语法 | ✅ | `python -c "yaml.safe_load(...)"` 解析通过；`jobs.electron-tests.timeout-minutes=90` |
| 阈值行为（真跑，不只看字符串） | ✅ | 抽出 `run` 原文按题意替换两个量后真跑：7/7（400/794/1200/1588 不告警；1589/2204/3600 告警，ratio 2.0/2.7/4.5） |
| 变异反证 M1（阈值 ×2→×100） | ✅ | **3 例 FAIL**（该告警没告警）—— 判据有辨别力 |
| 变异反证 M2（阈值 ×2→×1） | ✅ | **2 例 FAIL**（不该告警的告警了）—— 双向可辨 |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/`、`packages/rpa-engine/` |
| QM-4 视觉 | N/A | 无 UI 变更 |
| 远程同步 | 由门禁推导 | PR（开 PR 后补） |

## 变更（3 处，全在同一文件）

| 位置 | 改动 |
|---|---|
| job 级 `timeout-minutes` | **70 → 90**（必须与步骤预算一起抬，否则只是把「不可归因的超时」从 `timeout(1)` 换成 Actions 的 job killer） |
| `BUDGET_SECONDS` | **2100 → 3600** |
| 自证行之后 | 新增 `HEALTHY_SECONDS=794` + 偏离告警：`elapsed > 794×2` 时输出 `::warning title=…`，且 `echo` 里多带一个 `healthy=` 字段；超时分支的「下一步」提示从「按 `--shard` 切开」改为指向正确方案（matrix 在本仓不可用） |

## ⚠ 本次自查纠正的一个事实错误（重要）

诊断报告初稿把 **job 级 36m44s ≈ 2204s** 当成了**步骤级**耗时，进而写成「健康耗时的 2.8 倍」。拉失败日志核对后，自证行是：

```
[electron-ci-timeout-budget] elapsed=2100s budget=2100s rc=124
```

**步骤精确打满 2100s 预算被掐断**，即真实需求 **≥2100s（≥健康 2.6 倍）**，上界未知；而 2204s 是**整个 job** 的耗时（含 setup / install / build preload / 冒烟 / 构建）。两者混用正是 `docs/electron-ci-step-budget-baseline.md` 记录过的层级混淆 —— 我在修正版里明确禁止再这样取数。

同一份日志还纠正了另一条推断：诊断报告初稿说「本次失败日志里没有 `[electron-ci-timeout-budget]` 自证行」，实际**有且只有 1 条**（`elapsed=2100s rc=124`）。也就是说 #2525 那次 `set +e` 修复**是生效的**，不是缺口。这条已在 PR #4094 的报告里同步修正。

## 阈值取值理由

- 健康基线 **794s**（历史自证行实测值）。
- 阈值 **×2 = 1588s**：正常波动到 1200s 左右不告警（避免噪音），而真实的越墙需求 ≥2100s（×2.6）落在告警区内。
- 告警**不改变红绿**：`elapsed > budget` 才会被 `timeout` 判 124；比值只写日志与 `::warning` 注解。
- 用 `fi || true` 兜住算术异常：本步骤已恢复 `set -e`，一个统计语句不该把整步打红。

## 残留风险（不假装已解决）

1. **这不是根治**：`--shard` + matrix 在本仓不可用（required context 与 matrix 后缀冲突，详见 AGENTS.md「取证口径」节），可行的是「单 job 内并行分片」，但那需要先实测 4 vCPU 上的真实加速比与峰值内存。
2. **上界仍未知**：步骤被打断在 2100s，真实需求没有测出来。若某次 runner 更慢，3600s 也可能不够。
3. **3600s 让单次 main push 的 job 墙变长**：失败反馈更慢（从 35 分钟变 60 分钟），这是放宽的代价。
4. **告警阈值是静态的（×2 健康基线）**：若代码库增长让健康耗时自然上升，1588s 会变成误报源，届时应重算 `HEALTHY_SECONDS` 而不是调阈值。

## 附：改 workflow 超时常量触发的第二层门禁（已在本次同步）

首轮 CI 在 `Gate 2b7 - Gate timeout registry` 红（`QG Changes` / `Gate Result` 连带红）。原因不是我的改动错了，而是**这类常量有清单棘轮**：

`scripts/gate-timeout-registry.json` 逐格登记了每个作业的 `timeoutMinutes`，`scripts/check-coverage-budget.test.js` 的两条断言要求**注册值与 workflow 实际值逐字相等**：

- `19 缩进纪律`：断言 `scan.cells.get('electron-tests') === 70`（我改成 90 后变红）；
- `22 真实仓全量对账`：遍历注册表每一格，要求 `parseJobTimeout(workflow) === j.timeoutMinutes`。

**同步的两处**：

| 文件 | 改动 |
|---|---|
| `scripts/gate-timeout-registry.json` | `electron-tests.timeoutMinutes`: **70 → 90**（单点替换，1 行 diff） |
| `scripts/check-coverage-budget.test.js` | 两条断言的期望值 70 → 90，并把测试名里的「实测把 70 读成 10」改为「历史上把 70 读成 10」（那段是当初缩进 bug 的叙述，不该被本次改动改写） |

**关键辨析 —— 这不是「为消红改注册值」**：

注册表 `note` 明确写着「禁止为了让判据变绿去改本文件的数值 —— 只能重采样」。禁令针对的是**判据红了就去改数字骗过它**。本次是相反的形态：我**先**做了业务决策（把墙从 70 抬到 90），被治理的常量变了，登记必须同步 —— 这是同一次变更的两侧，不是绕过判据。

另外 `provenance.ceilingMinutesSampled` **保留 70 不动**：它记录的是「采样时那条天花板的值」，属历史事实；工具自己也把这两个字段分开读（输出里明确写 `censored_at_ceiling=0(绑 70 分那条天花板，非当前值)`）。

**这条经验值得记住**：改 `.github/workflows/` 里的 `timeout-minutes`，成本不只是「改一个数字」——同步要求散落在 `gate-timeout-registry.json` + 测试断言两处，且两处的语义（当前值 vs 采样时值）不同。这正是「改谁来守门」需要人工过目的具体含义。

验证：`node scripts/check-coverage-budget.js` rc=0（`timeout=90 需≥46 余量=44 分`）；`node --test scripts/check-coverage-budget.test.js` **26 pass / 0 fail**。
