# design — Electron CI 整轮单测分片落地

## 1. 作业形状（本次的核心改动）

```
jobs:
  changes:                      # 不变（docs-only 判定）

  electron-tests-shards:        # 新增：承载「整轮单测」被切成 N 片后的执行
    name: Unit tests (shard ${{ matrix.shard }}/${{ strategy.job-total }})
    runs-on: windows-latest
    needs: [changes]
    if: needs.changes.outputs.docs-only != 'true' && github.event_name != 'pull_request'
    strategy:
      fail-fast: false          # 任一片失败都要跑完其余片，否则拿不到「哪几片红了」
      matrix:
        shard: [1, 2, 3, 4]    # 恰 4 片（片数变少会抬高均值上界 ⇒ 反向判据会漏）
    steps: checkout → pnpm → node → install → restore runtimes →
           verify electron checksum → install electron runtime →
           build preload bundles → unit tests (--shard=i/N) →
           vitest failure diagnostics (if: failure())

  electron-tests:              # 保留这个 id ⇒ check 名仍是 required context `electron-tests`
    name: electron-tests
    runs-on: windows-latest
    needs: [changes, electron-tests-shards]
    if: always() && needs.changes.outputs.docs-only != 'true'
    steps:
      - name: Fail when a unit test shard failed      # 汇入：任一片红 ⇒ 本作业红
        if: needs.electron-tests-shards.result == 'failure' || needs.electron-tests-shards.result == 'cancelled'
        run: exit 1
      - name: Report unit test shard result
        run: echo "unit test shards: ${{ needs.electron-tests-shards.result }}"
      ...（原有步骤：install / restore / checksum / electron runtime /
           build preload bundles / smoke / build vue / deps / circular）
```

**为什么必须是两个作业而不是"给 matrix 作业起个名"**：
matrix 作业的 check 名恒带后缀（`electron-tests-shards (1)`），**无论怎么写 `name:` 都不会变成
`electron-tests`**（2026-10-20 实测：给 matrix 作业加静态 `name: electron-tests`，check 名仍是
`electron-tests (1)`）。而 ruleset `main-ci-gate`（id 23749994）要求的 context 里**有** `electron-tests`
⇒ 只能由一个**非 matrix**、**id 与 check 名都叫 `electron-tests`** 的作业把它报出来。

**为什么汇入作业用 `if: always()`**：分片作业被跳过（docs-only 短路）或失败时，汇入作业仍要跑，
否则 required context 那一格会**不出现**（= 另一种 "Expected — waiting for status to be reported"）。
`always()` 让它出现，且由第一步把"任一片失败"翻译成"本作业失败"。

**为什么 `fail-fast: false`**：`fail-fast: true` 时首片失败会把其余片 cancel 掉 ⇒ 拿不到"哪几片红"，
且 `needs.*.result` 会变成 cancelled 之外的混合态，诊断成本更高。

## 2. 单片预算怎么取（不许抬预算冒充分片）

判据链（与 `docs/electron-ci-step-budget-baseline.md` 同源）：

1. **整轮实测**取自 runner 日志的 `[electron-ci-timeout-budget] elapsed=…s` 行（**步骤级**，
   不是 job 总时长）。2026-10-21 取到的新数据见该文档。
2. **按片摊薄**：单片健康 ≈ 整轮健康 ÷ N。**整轮基线不能直接卡单片**（否则会得出"必须 ≥ 2100s"
   这种把分片收益又吐回去的结论）。
3. **再按负载放大留余量**：整轮在 runner 负载下曾整轮跑不完（elapsed 撞 2100s 墙）⇒
   负载放大系数 = 撞墙时长 ÷ 健康时长。单片最坏耗时 ≈ 整轮最坏 ÷ N，
   单片预算必须**高于**它，否则分片只是把墙均分，红的位置没变。
4. **反向判据**：单片预算必须**低于它取代的那个数**（现行整轮预算 2100s）**且**低于原始魔数 1200s
   ⇒ 「单片墙更矮 + 每片工作量 1/N」才是分片；「数字变大」是抬预算。
   ⚠️ 三个数必须分清（CCG 第 2 轮 i3：混用会削弱论证的可验证性）：
   - **1200s** = *原始* `timeout(1)` 魔数（`--kill-after=30s 20m`，#1913/#1906 时代，早已废弃）
   - **2100s** = *现行*整轮预算（本次分片把它换成"单片预算"，所以单片墙必须比它小）
   - **1759s** = 整轮*当前实测*（2026-10-21 main push 两次成功运行的 `elapsed=` 自证行）
   结构锁对这三个数分别断言（`toBeLessThan(currentWholeRoundBudgetSeconds)` /
   `toBeLessThan(measuredWholeRoundSeconds)` / `toBeLessThan(originalMagicWallSeconds)`），
   并另钉 `toBeLessThanOrEqual(1100)` 防将来被一路抬高。

## 3. 成本

分片作业每片都要跑一遍 setup（checkout / pnpm / install / restore runtimes / electron runtime /
build preload bundles）⇒ runner 分钟数约 ×N。这是**用成本换"不再撞墙 + 失败可归因"**，本刀不假装它免费。

## 4. 锁的改动（判据域不变，改的是"锁指向哪个作业"）

| 锁 | 原来指向 | 改后 | 为什么 |
|---|---|---|---|
| `gui-ci-exit-contract`：冒烟步骤 | `jobs['electron-tests']` | 不变 | 冒烟仍在这个作业 |
| `gui-ci-exit-contract`：runs-on / timeout-minutes | `jobs['electron-tests']` = 70 | 分片作业的新预算 + 汇入作业的新预算 | 单测步移走 ⇒ 汇入作业的 job 级不再要容下 35min 内层 |
| `gui-ci-exit-contract`：步骤顺序（install→restore→checksum→electron→单测） | 同一作业内 | 拆两段：分片作业内 install→restore→checksum→electron→单测；汇入作业内 install→restore→checksum→electron→build | 两条顺序都仍要成立 |
| `gui-ci-exit-contract`：env / 媒体工具跳过 | `jobs['electron-tests'].env` | 两个作业都要 | 分片作业跑同一批测试 ⇒ 同样的 env |
| `gui-ci-exit-contract`：串行 watchdog 与失败诊断 | 单测步在 `jobs['electron-tests']` | 改指分片作业 | 步搬走了 |
| `gui-ci-exit-contract`：预算挂实测 + 不与 job 级倒挂 | 整轮 794s | 单片基线（整轮 ÷ N） | 换算规则见 §2.2 |
| `gui-ci-exit-contract`：自证块真执行（行为锁） | 同上 | 改指分片作业 | 同上 |
| `workflow-contract`：每个跑全量的 job 必须先重建 5 个产物 | `electron-ci.yml:electron-tests` | `electron-ci.yml:electron-tests-shards` | 消费者换了作业 |
| `workflow-contract`：重建步与测试步的 if 必须是字面量 | `wf.jobs['electron-tests']` | `wf.jobs['electron-tests-shards']` | 同上 |

**新增锁**（守住这次踩过的坑）：

1. 汇入作业**必须存在**，且作业 id 与 `name:` **都**是 `electron-tests`（required context 靠它出现）。
2. matrix 作业**不得**用 `electron-tests` 这个 id/name（否则两条同名检查、聚合语义失效）。
3. matrix 作业**不得**与汇入作业同名；汇入作业必须 `needs` 分片作业且带 `always()`。
4. 分片数**恰好** N（不是 `>= 2`）：片数变少会把均值上界抬高，反向判据就漏了（上一轮评审 i3）。
5. 单片预算 **≤ 上界**（钉住现值），防止将来有人把单片预算一路抬高。

## 5. 风险与回退

| 风险 | 处置 |
|---|---|
| 汇入作业把 `electron-tests` 报成红，而实际只是分片被 skip | 汇入只在 `failure`/`cancelled` 时红；`skipped`（docs-only）放行 |
| 分片作业里缺某样产物 ⇒ 某些片必红 | 分片作业**照抄**原作业的 setup 顺序（含 build preload bundles 与 electron runtime），只把单测步换成分片版 |
| PR 侧重复跑整轮 | 分片作业**只在非 PR 事件**跑（沿用原单测步的字面量 `if`）；PR 侧仍由 QG desktop-shards 承担 |
| 成本 ×N | 记在文档与执行记录里，不假装免费 |
| 回退 | 把分片作业删掉、单测步搬回 `electron-tests` 即可（锁会挡住"只删一半"） |
