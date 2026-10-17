# 第 2 轮：QM-6 双模型外部评审（打在设计文档上，动手前）

后端轴（`--backend claude`，按 `~/.claude/.ccg/config.toml` 的 `[routing.backend].primary` 取值，非本文档写死）：
交付 **22 条 findings（9 Critical / 7 Warning / 6 Info）**，原件 `r2-findings-backend-claude.json`。载荷形态与决策层不同（`finding` 字段为空、实质在 `falsifiable_proof`），逐字段试解析后才读出内容——记这笔是因为**按惯性只读 `finding` 会把这 22 条全读成空**。

前端轴（`--backend opencode`）：rc=0 但**未交付 findings**，只回了一份会话状态（读到一半列出"仍需读 AGENTS.md / _TEMPLATE.md / 三个未归档 change"）。按仓规「评审成败一律按产物判，不按 rc 判」，本轮**不算完成**；它顺手指出的两处真矛盾已被处置（proposal 与 design 在 `sync_pr` 是否作为收口依据上打脸；1924 vs 1926 未注测量时点）。归档顺序、AGENTS.md 逐行矛盾清点改由本会话自行完成（AGENTS.md 需改的行：65、67、110、114、116–117、744；25 与 82 属历史叙述保留）。

## 9 条 Critical 的处置（分类，不笼统接受也不笼统驳回）

| 类别 | 条目 | 落点 |
|---|---|---|
| 命中，且揭出本设计的**事实错误** | `GIT-1`（改名会把归属重指到改名提交，原文写"解析不到"）、`GIT-3/GIT-4`（原文"保留首个新增"与探针实现 newest-wins 相反） | 失败模式表重写 + `ABSENT` 定义收紧 + tasks 2.10/2.11 + 反证 M11/M12；规格 Scenario「改名不自动跟随」改为如实声明重指 |
| 两条互相打脸，**按实验裁决** | `D3-1` 取证称改名后 `--diff-filter=A -- <新名>` 无输出；`GIT-1` 称输出改名提交 | 临时仓库实测 `a.md(#100) → git mv → b.md(#200)` ⇒ 输出 `#200`。D3-1 的取证描述错误，其担忧的实质形态由 GIT-1 承接 |
| 接受并补强为可机械执行 | `D5-1`（优先级反转打开预写通道）、`D6-1`（可见项不打印即永久静默）、`LEDGER-1`（浅检出）、`TASKS-4`（活主干上对账不可复现） | 不变式「ABSENT 永不进入 blobClosed」+ tasks 2.12/2.13 + 2.6 改为必须钉死 `baseRef` SHA（M13） |
| 前轮修订已覆盖，不重复改 | `LEDGER-2`（空账本出声，i3→tasks 1.7）、`GIT-2`（quotepath，tasks 1.3）、`D2-1`（自建枚举，已补 Scenario） | — |
| 驳回：不是设计缺陷 | `TASKS-1/2`（QM-6 与 PR 自查无法机械化）| 本就把它们列为人工卡点（仓规「判据第 5 条是 agent 自查而非机械闸门」），设计不假装相反 |
