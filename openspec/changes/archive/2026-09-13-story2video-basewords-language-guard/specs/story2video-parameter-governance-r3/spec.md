## Purpose

为「语言感知基准语速（baseWordsPerSecond）恒覆盖流水线静态默认」提供回归护栏，并更新参数治理合同的候选清理项状态，消除 Python YAML 3.3 非语言感知的疑虑。

## ADDED Requirements

### Requirement: 语言感知值覆盖静态默认
story2video-compose 流水线运行 split 阶段时 SHALL 使用 normalizer 按 split.language 派生的 base_words_per_second（zh 4.5 / en 2.8 / 其余 3.3），覆盖 bundled/YAML 静态默认 3.3。契约测试 SHALL 锁定该行为：中文提交 → 4.5、英文提交 → 2.8、自动 → 3.3。

#### Scenario: 中文提交走语言表
- **WHEN** renderer 提交 `story2videoTextConfig.split.language='zh'` 并启动流水线执行 split 阶段
- **THEN** `serviceBus.splitText` 收到 `config.scene.base_words_per_second === 4.5`（非静态 3.3）

#### Scenario: 英文与自动
- **WHEN** split.language='en' / 'auto'
- **THEN** splitText 收到 base_words_per_second === 2.8 / 3.3（语言表一致）

### Requirement: 合同候选项状态更新
PRD 7.1.19 §5 SHALL 将 baseWordsPerSecond 非语言感知候选项标记为「已核实无桌面缺口（resolveRuntimeStageOptions 语言表值恒覆盖静态默认，契约测试锁定）」；Python YAML 3.3 保留为仅影响绕过 JS 语言表的直接 Python 调用的既有行为说明。

#### Scenario: 文档核实
- **WHEN** 查询 PRD 7.1.19 §5
- **THEN** 候选项状态为已核实，附回归护栏测试引用
