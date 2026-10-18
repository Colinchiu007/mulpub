# 禁止为改写「远程同步」收口行而开 PR —— 给禁令加执行体

## Why

change `gate-record-sync-derived-status`（PR #3879，merge `b49510794`，2026-10-18 03:43 +08）把「远程同步」收口从**人工回填**改成**按主干历史推导**，并在 `AGENTS.md` 写下：

> **禁止**为改写这一行另开 PR——制造欠账再回填正是旧链路的结构性成本。

**这条禁令只有文字在守，落地后 4 小时内就有 4 笔回填 PR 合进 main**（按 committer 时间对齐）：

| PR | merge 时刻（+08） | 相对禁令 | 标题 |
|---|---|---|---|
| #3889 | 03:49:08 | 禁令后 6 分钟 | 回填 #3876 远程同步 PASS + main push 回读 |
| #3891 | 04:18:46 | 禁令后 36 分钟 | 回填 #3856 远程同步 PASS + merge SHA |
| #3890 | 04:20:53 | 禁令后 38 分钟 | 回填 #3885 远程同步 PASS + main push 回读节 |
| #3884 | 09:15:54 | 禁令后 5.5 小时 | 回填 #3881 远程同步 PASS + merge SHA |

**成因不是有人抗命。** 这些会话的分支在禁令落地前就切出去了，它们的工作树里 `AGENTS.md` 还是旧口径，于是照旧 SOP 干活。这与本仓 R0 删除守卫记录的同一件事完全同型——「写进记忆、文档与提交信息**都没能阻止第 5 次**，因为依赖临场自觉。**所以必须是机械拦截，不能靠自觉。**」

## What Changes

在**已经在 `changes` job 里阻塞运行**的判据 `scripts/check-gate-record-debt.js` 上新增一条拦截面判据：

> 本 PR 的 diff 里，`openspec/records/*.md` 中某行 `| 远程同步 |` 的状态列**从未闭合词变成闭合词**（`PASS` / `N/A` / `✅` / `已…`）⇒ 判红。

红文案给出唯一正解：**这一行现在由 `scripts/lib/merge-ledger.js` 按主干历史推导，不需要人工改写；把它改成「由门禁推导」不红，保持不动也不红。**

不改 `.github/workflows/`：落点已在 `changes` job、已在非 PR 早退之前、`hasBlocking` 已是阻断出口。

## 判据形态为什么不是「只动那一行就算回填」

按字面最省的写法是「本 PR 只改了那一行 ⇒ 判回填」。**实测漏 2/4**：#3890 与 #3891 除了那一行还加了 `### main push 回读` 小节、QM-1/QM-4 行的状态与视觉基线闭合说明。窄判据会把它们放过，然后向读者报"这条锁在守"——本仓把它记作**装饰性门禁**。

改成**行级状态词跃迁**判据后，在 origin/main 最近 **80 个 PR** 上实测：

- 命中 **36 个**
- 其中**非回填标题的命中数 0**（36/36 标题都是「回填 … 远程同步 PASS …」形态）
- 4 笔已知禁令后回填 **全部命中**

命中比例 36/80 = 45%，与改造前调研的「最近 60 个 PR 里 32 个纯回填」（53%）同一量级——两个独立算法给出同一趋势，说明抓的是同一件事。

## 三条边界（不写清楚就会被绕）

1. **旧载体不在扫描域**。关闭 `.quality-gates.md` / `scripts/gate-record-debt-ledger.json` 里**已存在**的历史行仍是合法通道（AGENTS「旧载体冻结」明写：封掉它等于把旧账永远钉红）。判据只看 `openspec/records/*.md`。
2. **迁移方向不拦**。把那一行改成「由门禁推导」是本 change 鼓励的动作，MUST NOT 判红；只有跃迁到**闭合词**才红。否则新机制自己的落地会撞上自己的锁。
3. **main push 回读证据要有别的地方去**。AGENTS 收尾清单第 6 条要求回读本次合并触发的 main push 并把读数留下——而 merge SHA 只在合并后存在，这是与 merge SHA 同源的第二个循环依赖。本 change **不把这条证据逼回仓库文件**：正解是写在 **PR 评论**里（#3892 已这么做过并验证可行），main 真红了才开真正的 follow-up PR。判据形态对此天然无感（加小节不改那一行），但口径必须写进 AGENTS 与模板，否则下一个会话会以为"没地方记"而绕开锁。

## 授权与风险

- **本条红是新增拦截面**，属 AGENTS 定义的「改谁来守门」。强度选项（判红 / 只出声 / 不动判据）与流程档位（建 change / 轻量）由用户于 2026-10-18 本会话明确拍板：**判红 + 建 OpenSpec change**。agent 未自决此项。
- **误报代价**：一条 required check 判红会卡住那个 PR 的自动合并。已用 80 PR 样本量到 0 非回填命中；仍保留 D9 的 fail-closed 档——**diff 取不到读数时判"未证实"并出声，不得把工具的失明读成"没有回填"**（继承上一轮三档不可用纪律）。
- **存量零改**：判据只作用于本次 diff，main 上历史 36 篇手写 `PASS` 原样保留；它们现在也只是"没人读的装饰"，收口已由推导给出。

## Impact

- Affected specs: `quality-gate-execution-record`（MODIFIED 一条 Requirement：收口证据由主干历史推导 ⇒ 追加"不得人工改写为闭合词"的执行体与豁免）
- Affected code: `scripts/check-gate-record-debt.js`（新增判据 + 文案 + `hasBlocking`）、`scripts/check-gate-record-debt.test.js`（回归锁 + 真仓下界）、`scripts/check-unwired-tests.js` 登记表无需改动（测试文件已在 CI 点名）
- Affected docs: `AGENTS.md`（禁令段落补"已有执行体 + 复现命令"）、`openspec/records/_TEMPLATE.md`（那一行旁边写明改写会红 + 回读证据落 PR 评论）
- 不触碰：`.github/workflows/`、`CI_IGNORED_PATHS`、分支保护、`scripts/freeze-gate-carrier.js` 基线
