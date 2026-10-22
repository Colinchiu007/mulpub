## ADDED Requirements

### Requirement: CI Failure Handler 必须让出 Windows 并发额度

CI Failure Handler（`.github/workflows/ci-failure-handler.yml`）的作业 MUST 跑在
`ubuntu-latest` 托管 runner 上，MUST NOT 占用 `windows-latest` 的并发额度。
该工作流只做「解析失败原因 + 开 Issue + 追评 + PR 评论」，只依赖 `gh` CLI、`node` 与
`actions/setup-python`，无任何 Windows 专属依赖。

理由（实测，2026-10-22）：`electron-tests`、`GUI Tests`、CI Failure Handler 三家全在
`windows-latest` 抢同一个托管池，主干 push 的 `electron-tests` 作业实测排队
**46.6 分 / 51.5 分**才起跑；同批次的纯 ubuntu 作业（`quality-gate`）**零排队**。
同型先例：quality-gate 的 `changes` 作业早被锁死为 `ubuntu-latest`，理由原文
「判定只依赖 git+node，必须用 ubuntu（不占 Windows 并发额度）」。

⚠️ **因果只到「预期」为止**（深度评审 i2）：观测事实是「Windows 作业排队长、ubuntu 作业零排队」，
但「handler 占了 `electron-tests` 的位置」这一因果**未被证实**——托管池的实时占用不可观测。
因此本 Requirement 只承诺「handler 不再占 Windows 额度」，
**MUST NOT** 把「Windows 排队因此会缩短」写成已证事实；收益以**预期**措辞记录，
并留一个观测点：迁移后复跑 `electron-tests` 的排队时长读数（与 evidence E3 同一口径可复跑）。

#### Scenario: 契约锁钉住 runner 标签

- **WHEN** 检查 `.github/scripts/workflow-contract.test.js`
- **THEN** MUST 存在一条断言：CI Failure Handler 的作业 `runs-on` 等于 `ubuntu-latest`
- **AND** 该断言 MUST 在把 runner 改回 `windows-latest` 时当场变红（不得是装饰性锁）

#### Scenario: 契约锁的执行机制不得只在本地

- **WHEN** 问「这条锁在 CI 里跑吗」
- **THEN** MUST 可指认接线点：`.github/scripts/workflow-contract.test.js` 由
  `quality-gate.yml` 的 **Gate 2b** 作业执行（PR 与 main push 都跑）
- **AND** MUST NOT 只是一条「本地记得跑」的约定——否则它挡不住 CI 配置写错就合入

#### Scenario: handler 的依赖在 ubuntu 上齐备

- **WHEN** 该工作流在 `ubuntu-latest` 上运行
- **THEN** `gh` CLI、`node`、Python 3.12（`actions/setup-python`）MUST 均可用
- **AND** `.github/scripts/classify-ci-failure.js` MUST NOT 含任何平台专属分支
      （实测：无 `win32` / `windows` / `powershell` 命中）
