# Proposal: 语言感知基准语速覆盖静态默认的回归护栏

## Why

参数治理文档（PRD 7.1.19 §5）记录 Python YAML `baseWordsPerSecond:3.3`「非语言感知」为候选清理项。深入调查确认：桌面流程中 `resolveRuntimeStageOptions`（pipeline-engine.js:1657）以 normalizer 的 `stageOptions.split.base_words_per_second`（语言感知表：zh 4.5 / en 2.8 / 其余 3.3）恒覆盖 bundled/YAML 静态默认 3.3——**不存在被静态默认覆盖的语言缺口**。但该保证缺少端到端回归护栏：若未来 `resolveRuntimeStageOptions` 合并顺序或 normalizer 输出被改动，静态 3.3 可能静默生效。本变更补一条契约测试锁定「语言感知值恒覆盖静态默认」，并把该候选项在 PRD 中标记为「已核实无桌面缺口」。

## What Changes

- `pipeline-story2video-contract.test.js` 新增用例：中文（zh）提交运行 split 阶段时，`serviceBus.splitText` 收到 `config.scene.base_words_per_second === 4.5`（语言表值，覆盖 bundled 静态 3.3）；en → 2.8；auto → 3.3（与语言表一致）。
- PRD 7.1.19 §5：`baseWordsPerSecond` 候选项标记「已核实：resolveRuntimeStageOptions 语言表值恒覆盖静态默认（契约测试锁定）」，Python YAML 3.3 仅影响绕过 JS 语言表的直接 Python 调用（既有行为，保留）。
- CHANGELOG、learnings 小条目。

## Capabilities

- **Modified Capabilities**: `story2video-parameter-governance`（PRD 7.1.19 合同对应能力：候选清理项状态更新）

## Impact

- 测试：`apps/desktop/electron/tests/pipeline-story2video-contract.test.js`
- 文档：`01-docs/PRD.md`、`CHANGELOG.md`、learnings
- 无生产代码变更；无契约破坏。
