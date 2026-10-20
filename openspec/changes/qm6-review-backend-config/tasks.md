# Tasks: qm6-review-backend-config

## 1. 单一真源
- [x] 1.1 `scripts/ccg-review-backends.list`（critic/proposer 两行 + 格式说明）
- [x] 1.2 `scripts/lib/ccg-review-backends.js`：`loadSourceList` / `resolveBackends`(CLI>env>清单) /
  `backendNames` / `roleOf` / `installHint` / `formatTarget` + CLI 四模式与参数拒止
- [x] 1.3 `scripts/lib/ccg-backends.sh`：shell 侧同名实现（被两个入口 source），含 `is_valid_backend`
  形态判据与 `backend_table` 渲染
- [x] 1.4 行为锁 `scripts/lib/ccg-review-backends.test.js`（17 条，含四格参数拒止与两条反失明）
- [x] 1.5 接线 Gate 2c6（changes 作业，判据本体无 job 级 `if`）

## 2. 判定器收敛
- [x] 2.1 `detectBackends()` 改按解析名单逐个探 PATH，键名不再固定
- [x] 2.2 目标文案抽成纯函数 `backendNoticeLines(backends, mode)` 并导出（此前埋在 main 里无法取证）
- [x] 2.3 「同族单后端 ≠ 降级」的 `needDistinct` 判据 + 覆盖出声行
- [x] 2.4 `saveRecord` 写 `reviewBackends`（含每格来源与 `overridden`）
- [x] 2.5 禁词锁（剥注释后不得出现 `"claude"`/`"opencode"` 字面量）与两条前提自证

## 3. 入口接线
- [x] 3.1 `deep-review.sh`：while+shift 参数解析、`--critic/--proposer`、未知旗标 rc=2
- [x] 3.2 体检与裸名自检改遍历 `backend_table`，分母改为行数（含同族单后端一档）
- [x] 3.3 `exec` 处只在覆盖时追加 `$BACKEND_ARGS`，并打印"驱动验证层不应用"的如实说明
- [x] 3.4 `plan-review.sh` 同源改造（决策层这条路径覆盖**确实生效**）；未知旗标改为出声不拒
- [x] 3.5 顺带修：`$0` 为 Windows 绝对路径时 ROOT 落到父目录（D7）；`--help` 写死行号区间（D8）

## 4. 追责判据
- [x] 4.1 `check-pr-exec-record.js` 新增纯函数 `judgeBackendMismatch` 并导出
- [x] 4.2 接入 `evaluateDeepReviewDebt` 的 dual 循环，新增「后端不符」理由块（点名两侧值）
- [x] 4.3 行为锁 4 条：四档不适用 / 相符三种写法 / 出声内容 / **真跑门禁**（`checked===3` 反失明 + 全相符对照 + 历史产物不追溯）

## 5. 对账与反证
- [x] 5.1 两个读取方逐字对账锁（四档配置 + 覆盖档与默认档必须确实不同）
- [x] 5.2 `--check-deps` 行为锁（只装 codex 的假 HOME，断言 `· claude` 不出现）
- [x] 5.3 变异反证 M1–M5（每条指名变红，且驱动断言"跑了多少条"而非只看有无红）
- [ ] 5.5 **未做变异反证的新锁**（如实登记，别读成已反证）：外部评审后追加的
  「source 前存在性守卫」「禁词 doesNotMatch(/BACKEND_ARGS/)」「有界子串的两条负控」「署名义务不分覆盖」
  四条锁，其中「署名义务」与「有界子串」各有一条**反向对照**在同一份夹具里（全相符⇒全绿 / 补 overridden⇒变红），
  起到近似反证作用；另两条（守卫与禁词）是结构锁，尚未做"把守卫摘掉必须红"的变异。
  下一轮触碰这两个文件时应顺手补进 本会话临时目录里那份变异驱动脚本的清单（驱动未入库，形态见本文件 5.3）。
- [x] 5.4 既有回归全绿：`ccg-review-decider` 43、`deep-review-deps` 33、`plan-review-deps` 10、
  `ccg-bash-entry` 9、`check-pr-exec-record` 72、`ccg-review-backends` 17

## 6. 文档同步（AGENTS「门禁断言随实现迁移同步」）
- [x] 6.1 AGENTS.md QM-6「执行方式」段：模型名真源改为清单 + 覆盖入口，并如实说明
  `config.toml` 对 `ccg-deep-review.js` 无效（旧那句"唯一真源是 config.toml"是被实测否证的）
- [x] 6.2 `check-pr-exec-record.js` 与其测试里「dual → 双模型(claude + opencode)」的映射注释改为
  "由真源派生"，不再钉死字面串
- [x] 6.3 `openspec/changes/qm6-review-backend-config/specs/` 能力增量
- [x] 6.4 CHANGELOG 一条标题块；执行记录 `openspec/records/qm6-critic-configurable.md`
- [ ] 6.5 `docs/session-isolation-automation.md` 等无关文档不动

## 7. 明确不做（留给人工裁决）
- [ ] 7.1 D-R1 修上游驱动验证层的覆盖分支（在 `~/.claude/skills/…`，不属本仓）
- [ ] 7.2 D-R2 把 adversarial-review-loop 引擎 vendor 进 `scripts/`（vendor 后本仓对其行为负责，
  属改"谁来守门"，须人工过目并另立 change 定同步纪律）
- [ ] 7.3 收紧 `self_play_resolved`（本刀刻意不碰）


## 8. Follow-up：评审时请求值回写（2026-10-19，修本 change 自带的假红）

- [x] 8.1 `applyReviewRequestToRecord(recordPath, resolved, fsImpl)` 纯函数 + 三条不变式
  （①不销毁提交时请求 → `commitRequest`/`rewrittenAt`；②只在覆盖时写；③读不到不新建）
- [x] 8.2 CLI 动作模式 `--record-request <path>`：与打印模式互斥、缺值 rc=2、未覆盖 rc=2
- [x] 8.3 `deep-review.sh` 覆盖分支在 **exec 之前**调用；失败 `say + exit 2`，驱动不起来；
  dry-run 不回写但出声；刻意不加 `[ -f "$REC" ]` 前置（不可达分支不写文案）
- [x] 8.4 `plan-review.sh` 不回写 —— 决策层无 `reviewBackends × performedBy` 消费者（D13）
- [x] 8.5 lib 行为锁 17 → **26**：幂等重跑不叠层 / 同值不留假档 / 四类坏输入不新建不改字节 /
  存量产物允许补 / CLI 三档退出 + "被拒绝的调用不得留痕迹"
- [x] 8.6 deps 行为锁 35 → **40**：真跑 bash + **桩驱动**（`<fixture>/scripts/ccg-deep-review.js`
  是入口定位驱动的第一候选，故 CI 上同样执行、不静默跳过）。桩驱动启动时自己再读一次记录，
  把「回写早于 exec」编进产物而不是源码位置；另三条：回写跳失败 fail-closed 且驱动未起来、
  dry-run 字节不变、默认路径字节不变
- [x] 8.7 消费方全复跑（改的是判据的输入，不是只改判据）：decider 52 / ccg-bash-entry 9 /
  plan-review-deps 10 / check-pr-exec-record 81，全 0 fail
- [x] 8.8 变异反证 M1-M7 逐条实测 CAUGHT（红集互不相同；驱动断言 tests>0 ∧ fail>0 ∧ 指名命中）
- [x] 8.9 文案同步：`--target` 那条既有期望正则按新模式清单改窄（2 处），AGENTS QM-6 段
  那句"请求值随判定记录落盘"补上**由谁在哪一跳落**
- [x] 8.10 未新增 `*.test.js`（两段锁追加进已接线文件）⇒ 不动 `quality-gate.yml`、不动
  `check-unwired-tests` 域
- [ ] 8.11 遗留：驱动验证层仍不应用覆盖（D-R1/D-R2 未变）；旧记录的 `commitRequest` 不追溯补齐

## 11. QM-6 第三轮（rebase 后对新判定记录 `348a2650…json` 真跑双模型，critic 出 8 条、进裁决 5 条）

- [x] 11.0 现场：`[轮 1/3]` critic=claude 出 8 条，`收敛判定: status=self_play reason=selfPlay minScore=4`，
  `待裁决 5 条；其中高危域必须外部复核 0 条` —— 后两格由 vendor 补丁产出（`requiresExternalReview: []` +
  `expectedExternalBackend: "claude"`），与 `ccg-convergence-probe` 的 ladder 逐字同形 ⇒ 探针量的还是真路径
- [x] 11.1 **i1（Critical）upheld 并当场修**：`applyReviewRequestToRecord` 在「第二次换不同后端」时把
  `before`（= 上一次的回写结果）整份塞进 `commitRequest` ⇒ 审计锚从「提交时请求的是谁」漂成「上一次评审请求的是谁」，
  且 `rewrittenAt` 被刷新。既有两条锁只盖了「同值重跑不叠层」，没有盖「不同值二连」。
  修：`before.commitRequest || before` + `before.rewrittenAt || new Date()`；回归锁 2 条 + spec 补一条 Scenario
- [x] 11.2 **i2（Warning）dismissed，但按修正表述补了一致性锁**：critic 假设「入口按 `RB_OVERRIDE_NOTE` 判、
  lib 按 `r.overridden` 判 ⇒ 传清单默认值会被拒写并阻断审查」。取证两侧同判据（`ccg-backends.sh` 比的是
  「与清单值是否不同」，`ccg-review-backends.js` 的 `overridden` 同口径），默认值不进覆盖分支 ⇒ 断言的失效形态不成立。
  但「两口径无一致锁」这半句是真的，所以新增一条**真跑入口**的行为锁（`--critic claude` = 清单第一行 ⇒
  rc=0、无覆盖行、记录逐字节不变、驱动命令行不带 `--critic`）
- [x] 11.3 **i3（Warning）dismissed，有行号证据**：`deep-review.sh:55` 在文件开头就 `cd "$ROOT"`，而 `ROOT` 由
  脚本自身位置算出（`:50`）；回写调用点在 `:873`，那时 cwd 已是仓库根 ⇒ 「从非根 cwd 起脚本必败」不成立。
  在夹具注释里把这条写死，防它被第四次重提
- [x] 11.4 **i4（Warning）upheld 并当场修**：只校验 `critic`、不校验 `proposer` ⇒ `next.proposer=undefined` 被
  `JSON.stringify` 静默丢键，记录缺半边而返回值已报 ok。修：成对校验，拒写时**一个字节都不动**（回归锁断言原字节相等）
- [x] 11.5 **i5（Warning）dismissed，两条各有出处**：① 判据选记录是按**变更集里的路径**扫的
  （`check-pr-exec-record.js` 的 `REVIEWS_DIR_RE`，只匹配 `.ccg/reviews/*.json`），从不按 `rec.sha` 归属，
  所以「欠账记到父提交名下 / 重复计账」这条链路在实现里不存在；② `stats.changedLines` 没有任何消费者
  （`git grep changedLines origin/main -- check-pr-exec-record.js` = 0 命中），529 与整份 diff 的行数差是 decider
  自己的计数域（源文件行），不是谁对错了账
- [ ] 11.6 遗留照旧：驱动**验证层**仍不应用 `--critic/--proposer`（D-R1/D-R2 未变），本 PR 只让记录说实话

### 11.7 反证（红必须指名）

- 变异 = 把 lib 退回 HEAD 版（即修复前）跑 `ccg-review-backends.test.js`：`tests 28 / fail 2`，
  失败用例逐字是「第二次换**不同**后端时…」与「proposer 缺失一律拒写…」⇒ 两条各守自己那一格
- 变异 M-i2b = 把入口覆盖分支门禁 `if [ -n "$RB_OVERRIDE_NOTE" ]` 改成恒真：一致性锁**指名变红**（CAUGHT），
  还原后 md5 与改前相同（`8ff009d9d05f`）
- **如实记一条没抓到的**：另做了一版变异 M-i2（改 `ccg-backends.sh` 侧的覆盖判据为「有没有传旗标」），
  这条新锁**没有**变红。所以它的强度只覆盖「入口那一格」，不覆盖 shell 判据那一格 —— 写清楚，不写成两条都 CAUGHT
