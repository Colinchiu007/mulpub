# QM-6 前端轴（opencode）——三次尝试全部零交付（2026-10-15，PR #3620）

被审对象：`gate9-ratchet` 分支的实现 diff（`.github/scripts/agent-review-gate.js`、
`scripts/gate9-classify.js`、`.github/workflows/quality-gate.yml` 及其三个测试文件）。

模型名不写在本文档里；唯一真源是 `~/.claude/.ccg/config.toml` 的 `[routing.frontend].primary`，
本次读到的值是 `opencode`。调用形态：`codeagent-wrapper --backend opencode --lite "<prompt>" .`，
cwd 与 workdir 均为该 worktree。

## 三次尝试与各自结局

| # | 日志 | 结局 | 归因 |
| --- | --- | --- | --- |
| 1 | `D:/Temp/qm6-3620-frontend.log`（6093 字节） | 跑完，交付的是散文式分析（`## Relevant Files` + Next Step），**没有一个可解析的 findings JSON 数组** | 已知形态「跑完但没 findings」的一种：逐起点试解析（含 stream-json `result` 事件回退）均 `NO_FINDINGS_PAYLOAD` |
| 2 | `D:/Temp/qm6-3620-frontend2.log`（992 字节） | **根本没跑到模型**：`'Warning' 不是内部或外部命令` + `Using stdin mode for task due to: double-quote` + `opencode exited with status 255` | **我的错误，不是模型失败**：提示词里写了 `{"severity":"Critical|Warning|Info",...}`，双引号让 wrapper 改走 stdin，而 `|` 在 Windows 命令行上把参数截断成一条以 `Warning` 开头的命令去执行。这正是 AGENTS 明令禁止的「内联参数里带引号/管道嵌套」——本仓已记过至少四次，这次仍犯 |
| 3 | `D:/Temp/qm6-3620-frontend3.log`（4820 字节） | 跑完，又是只交计划（`Relevant Files` + 下一步）就停在 `SESSION_ID` | 与 #1 同族；提示词已改为无引号、无管道、纯中文加文件路径 |

按 `adversarial-review-loop` / 质量节拍 QM-6 的口径「前端模型失败最多重试 2 次，3 次全败才跳过」：
第 2 次虽属我自己造成的调用形态错误，但它确实没有产出评审，计入尝试次数；三次已用满 ⇒ **跳过前端轴**。

## 因此本片如何记账

- 记为 **critic-only（后端 `claude` 单轴）+ 主代理逐条处置**，**不写成「双模型通过」**，不自扮演豁免。
- 后端轴的 findings 与逐条处置见同目录 `gate9-ratchet-review-backend.md`；对每条的接受/拒绝与理由见 `gate9-ratchet-review-response.md`。
- 若后端轴最终同样零交付，本片将如实记「外部评审未获得」，并把它列进合并前必须补的欠账，而不是拿本机自审冒充外部轴。

## 可复用的两条（下次不再重踩）

1. **提示词里禁止出现双引号与 `|`**：需要表达 JSON 形状时改用中文描述字段名（「每项含四个字段：severity、file、issue、fix」），不要用示例 JSON。带双引号会触发 wrapper 的 stdin 分支，而管道会在 cmd 层把参数截断成一条**真的会被执行的命令**。
2. **「跑完」不等于「交付」**：判据只能是有没有一个结构可解析的 findings 数组，不能看进程退出码或日志是否在涨。
