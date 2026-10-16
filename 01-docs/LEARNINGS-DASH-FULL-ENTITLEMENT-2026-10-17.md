# 2026-10-17 学习：openspec 执行记录的两条机械门禁 + 看板套餐分级设计

## 一、openspec/records/ 新记录文件的两条硬门禁（CI 会红，不是建议）

写**新的** `openspec/records/<分支名>.md` 时，以下两条必须同时满足，否则 QG Changes 红：

### 1. 未收口状态必须带两个登记字段（Gate 24）

判据在 `scripts/check-gate-record-debt.js:351`：记录文件在「远程同步」未收口（PENDING）时，frontmatter 必须同时有非空的

```yaml
sync_reason: <为什么没回填>
sync_backfill_owner: <谁负责回填>
```

缺任一即报 `缺登记字段`。**回填（改写成 PASS）时必须在同一次提交内删掉这两个字段** —— 判据第 342 行会判 `staleRecordFields`（已 PASS 却仍留登记字段）。

> 实测：PR #3752 第一次提交只写了表格行 `| 远程同步 | PENDING |`，当场红。判据是「登记随文件走」，不再往 `scripts/gate-record-debt-ledger.json` 加键（那属旧载体，新 PR 加键会被 `carrierDrift` 判红）。

### 2. 记录文件里不得写本机绝对路径（Gate 12c）

判据 `scripts/check-doc-abs-paths.js`：全量审计与基线逐文件相等，新增本机路径（如 `D:\Data\projects\mp-worktrees\mp-xxx`）会被判「超出存量基线」—— CI runner 上没有该盘符。

**正解**（判据自己给的）：改写成占位符形态（`<...>` / `$VAR` / 通配），或只写仓库内相对约定。**不是**跑 `--write-baseline` 把新增记进去 —— 那正是本条要拦的形状。

> 实测：PR #3752 第二次提交因为写了 worktree 绝对路径又红一次。现在记录里统一写「隔离 worktree，本机路径按 `mp-worktrees/<任务名>` 约定」。

### 教训的形状

这两条都是「文档写作纪律」被升级成了「机械拦截」—— 与删除守卫（R0）同一思路：**靠自觉拦不住，必须是机器闸**。写记录时不要指望"我记得就行"，直接照字段写。

## 二、Git Bash 跑 `scripts/plan-review.sh` 会失败，要用 PowerShell 入口

裸 `bash scripts/plan-review.sh` 在两个环节失败：

1. 裸 `bash` 解析到 WSL shim → `execvpe(/bin/bash) failed`
2. 即使用 Git Bash，`dirname: command not found`（该脚本依赖 `dirname`）

**正解**：用 PowerShell 入口，它会自动定位 Git Bash 并校验身份：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ccg-review.ps1 -Mode Plan -Proposal <方案文件>
```

## 三、跨家族评审的 opencode 后端有 7800 字符输入上限

`plan-review.sh` 里 proposer=opencode 的修订步骤，输入超过 **7800 字符**（实测边界 (8125, 8145]）会被同步拒绝（~120ms、exit 1、**无任何错误信息**）。

对策：方案文档写太长会让「逐条回应并修订」这一步静默失败、无法收敛。要么把方案拆小分轮评审，要么去掉对 reviewer 无用的内容（历史修订轨迹、意见对应表 —— 那是给人看的，不是评审对象）。

评审产物落在 `.adversarial/<对象名>/critique-v1.md`，即使修订步骤失败，**挑刺意见仍然有效且值得读**（本次 6 条里 2 条 Critical，其中一条直接推翻了方案初稿的一个自相矛盾）。

## 四、看板套餐分级：feature 门禁 vs 体验分级（可复用的判定框架）

给「某块 UI 按套餐显示/隐藏」这类需求时，先分清这两种性质：

| | 访问控制（真门禁） | 体验分级 |
| --- | --- | --- |
| 落点 | 主进程 `CHANNEL_FEATURE_MAP` + `requireEntitlement` | 渲染层不发请求 + 不渲染 |
| 能否绕过 | 不能 | **能**（手动调 IPC 仍可拿到） |
| 文档里该怎么写 | 「权益门禁」 | 「体验分级，**不是访问控制**」——必须写明 |

判定方法：**看该 IPC handler 有没有读套餐**。若 handler 只判身份（如 `performance:overview` 只判 `resolveIpcOwnerSubject`），那么在渲染层做的任何"锁"都只是体验分级，写成"权益门禁"就是谎。

本次踩到的正是这个：PRD 初稿把受该 handler 支撑的区块列为 🔒 full-only，同时声明不改 handler —— 被评审（Critical i1）当场指出互斥。

## 五、渲染层判套餐的两条禁律

1. **禁用 `licenseStore.isPro`**：它是本地二值，**不认三档**，standard 档会被误判成免费。要用服务端 `entitlement`（含 `features` 数组）。
2. **`entitlement` 未登录/未取到时是 `null`**（不是空对象）：必须判空，否则未登录直接崩。`identity.js:89` 初值 `ref(null)`，不会退化成空对象。

另外：`useIdentity()` composable **不导出** `entitlement`（只给 status/user/isAuthenticated），读权益要直接用 `useIdentityStore()`。

## 六、三态必须分开：empty / error / auth

凡是「IPC 信封 → 视图模型」的转换，都要把这三态显式分开：

- `empty` = 合法无数据
- `error` = 取数失败
- `auth` = 不认识我（未登录）

前两种界面上都表现为"空"，但含义**相反**。渲染成同一个空态，用户会把「功能坏了」读成「我还没发过东西」（本项目 `performance-loop.js` 注释里已写过这个教训）。

**推论**：IPC 不可用（浏览器环境 / preload 未就绪）是**合法降级**，应判 empty 而不是 error —— 判成 error 会让用户在纯降级场景看到"加载失败"，那是谎。
