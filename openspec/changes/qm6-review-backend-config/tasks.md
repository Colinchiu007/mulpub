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
  下一轮触碰这两个文件时应顺手补进 `D:/Temp/qm6-mutation-driver.cjs` 的清单。
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
