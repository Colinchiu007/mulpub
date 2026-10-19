# Design: qm6-review-backend-config

## 1. 功能逻辑

```
                 scripts/ccg-review-backends.list   ← 唯一真源（第一行 critic，第二行 proposer）
                        │
        ┌───────────────┴────────────────┐
        │ node 读取方                     │ shell 读取方
        │ scripts/lib/ccg-review-backends.js │ scripts/lib/ccg-backends.sh（被两个入口 source）
        └───────────────┬────────────────┘
                        │ 解析优先级：CLI 旗标 > env(MP_QM6_*) > 清单
        ┌───────────────┼───────────────────────────┐
        │               │                           │
  ccg-review-decider  deep-review.sh            plan-review.sh
  · detectBackends   · report_backends          · report_backends
    按名单探 PATH       按 backend_table 遍历      同左
  · 目标文案           · 裸名自检                 · 裸名自检
    formatTarget()   · exec 时转发               · exec 时转发
  · 记录写               --proposer/--critic        --proposer/--critic
    reviewBackends        （仅覆盖时）                （仅覆盖时）
        │                                           │
        ▼                                           ▼
  .ccg/reviews/<sha>.json                 驱动 cfg（proposer/critic）
  { reviewBackends{critic,proposer,from,overridden}, deepReview{status,performedBy} }
        │
        ▼
  check-pr-exec-record.js :: judgeBackendMismatch
     overridden===true ∧ status≠self_play_resolved ∧ performedBy 非空
     ∧ performedBy 记号集 ∩ {critic,proposer} = ∅   ⇒ 判未闭合（后端不符）
```

判据本体是**纯函数**（`judgeBackendMismatch(rec)`），`evaluateDeepReviewDebt` 只负责把它接到
真文件上。这样"四种不适用"和"相符的三种写法"都能不搭 git 夹具就逐条证到。

## 2. 数据校验

| 位置 | 判据 | 不成立时 | 为什么这样选 |
|---|---|---|---|
| 后端名形态 | `^[A-Za-z][A-Za-z0-9._-]{0,31}$` | node 侧抛错；shell 侧 rc=2 并点名来源三处 | 名字最终被拼进 `--backend <name>` 交给 codeagent-wrapper，这是**注入边界**不是风格问题；也正因过了这道闸，shell 里 `for x in $RB_NAMES` / `$BACKEND_ARGS` 才允许不加引号拆词 |
| 清单有效行数 | 恰好 2 | 抛错 / rc=2 | 多一行少一行会让两个读取方各取到"错的那一格"，而在表格里这种错位完全静默 |
| 清单注释与空行 | 忽略 | — | 清单要能自带说明，否则每个改它的人都要先来问格式 |
| 空串/纯空白 | 视为**未提供**，向下一档回落 | 不报错 | CI 表达式里 `VAR=""` 就是"没配"；判成故障会把所有 PR 打红 |
| 非空但不合法 | 抛错，**不回落** | rc=2 | 静默回落默认值 = 重新制造"以为换了后端其实没换" |
| 清单文件缺失 | 回落 DEFAULTS **且出声**（stderr / `notes`） | 不阻断 | 缺文件是仓库完整性问题；但 pre-commit 不该因此炸，而静默回落不可接受 |
| CLI 打印模式数 | 恰好 1 | rc=2 | 0 个 ⇒ 入口拿不到输出却以为"解析成功"；>1 个 ⇒ 两个模式共用一份参数，没人知道最后打的是哪个 |
| 文案含分隔符 `\|` | 抛错 | — | shell 侧 `IFS='\|' read` 会错位；这条自证在 lib 的 CLI 路径上 |
| `role/hint` 两表 | sh 与 node 逐字节对账 | 测试红 | 两张表必然漂移，唯一让"两份实现"安全的是**外部对账**而不是"各自等于常量" |

## 3. 流程

1. 提交时 pre-commit → `ccg-review-decider.js`：按解析结果打印目标文案，并把 `reviewBackends` 写进 `.ccg/reviews/<sha>.json`。
2. 推送前 → `sh scripts/deep-review.sh [--critic <名>]`：先 `resolve_review_backends`（失败即 rc=2 早退），再体检、再 `exec node $DRIVER --sha $SHA [--proposer --critic]`。
3. 驱动跑完回填 `deepReview.status` + `performedBy`。
4. PR 判定 → `check-pr-exec-record.js --mode=enforce`：闭环词表判一遍，**再**按 `reviewBackends` 与 `performedBy` 对账；不符即阻断合并。

## 4. 交互逻辑

- 入口不接受"部分覆盖"的静默：`--critic` 缺值、缺下一个参数、或值是另一个旗标 ⇒ rc=2。
- 未知旗标在 `deep-review.sh` 一律 rc=2（参数不得静默忽略）；`plan-review.sh` 历史上对 `-*` 宽容，
  本刀**保持不拒**但改为出声 `⚠ 忽略未知旗标：X`，避免把别的会话的调用一起打死。
- 覆盖生效时入口必须打印来源档位（`critic 来源 env` / `cli` / `list`），并说明"请求值随记录落盘、
  由欠账门禁对账"。
- `--check-deps` 与主流程共用同一条解析路径（体检的分母因此不可能与实际名单脱节）。

## 5. 显示项

| 场景 | 输出 |
|---|---|
| 默认（未覆盖） | 与改动前逐字相同：`· claude [ABS] …（评审后端（主力））` / `· opencode …（出方案后端 / 跨家族校验）`，**不多打任何行** |
| env 覆盖 | 多一行 `ℹ 评审后端已覆盖：critic=codex proposer=opencode（critic 来源 env，proposer 来源 list）` + 两行对账说明 |
| 旗标覆盖 | 同上，来源列显示 `cli`；执行前再打一行 `→ 已向后端请求覆盖：--proposer opencode --critic codex` |
| 同族单后端（critic==proposer） | 体检只列一行；就绪时打 `ℹ 同族单后端…按配置**不参与**跨家族交叉验证`，**不打**"只剩单后端"的降级 |
| 部分可用 | `⚠ 仅 1/2 个后端可用 —— …`（分母来自解析出的名单，不是写死的 2） |
| 全不可用 | `✗ 没有任何评审后端可用 —— 深度审查根本起不来。` + 逐个给 `npm i -g <pkg>`；未登记的名字给 `对应 CLI` 而非编造包名 |
| 清单缺失 | `⚠ 评审后端清单缺失（scripts/ccg-review-backends.list），已回落默认 critic=claude proposer=opencode。` |
| 参数/形态非法 | `✗ …` 一行说明 + 一行点名三个可能来源 |

## 6. 提示文字（终端文案，逐字）

本刀是工具链变更，不新增渲染层文案，故**不涉及 `src/locales/**` 的 zh/en 成对义务**（Gate 7 不适用；
`check-locale-sync` 与 i18n 词典锁均无新增键）。终端文案清单：

- `ℹ 评审后端已被覆盖：proposer=%s(%s) critic=%s(%s)`（判定器）
- `ℹ 评审后端已覆盖：%s（critic 来源 %s，proposer 来源 %s）`（入口）
- `→ 已向后端请求覆盖：%s`
- `⚠ 驱动**验证层**（评审 diff）当前不应用这两个参数（覆盖块只挂在决策层分支），…`
- `✗ 旗标 %s 缺值（必须紧跟一个后端名，例如 --critic codex）`
- `✗ 未知旗标：%s（本入口只认 --force / --dry-run / --check-deps / --critic <名> / --proposer <名> / --help）`
- `⚠ 忽略未知旗标：%s（本入口不认它；…）`（plan-review.sh，出声不拒）
- `✗ 评审后端名不合法：%s（只允许字母开头的 [A-Za-z0-9._-]，长度 ≤ 32）。`
- `✗ 评审后端清单形态不合法：%s 有效行数=%s（必须是 2 行：第一行 critic、第二行 proposer）。`
- `⚠ 评审后端清单缺失（%s），已回落默认 critic=claude proposer=opencode。`
- `  ℹ 同族单后端（critic=proposer=%s）：能跑，但按配置**不参与**跨家族交叉验证。`
- `  ⚠ 仅 %s/%s 个后端可用 —— 评审能跑，但跨家族交叉验证会缺失。`
- `  · %s  [%s] %s（%s）` / `  · 裸名自检 %s → %s`
- `CCG 深度审查欠账（后端不符）%d 条 —— …请求 %s ≠ %s`（欠账门禁）

## 7. 关键决策

| # | 决策 | 备选与否证 |
|---|---|---|
| D1 | 真源落成**清单文件**而非 JS 常量 | 备选"只留 node 常量 + 入口调 node"：被 `--check-deps` 的前提否证——它是"node 可能就是坏的"时的诊断入口，让它依赖 node 等于把要诊断的东西当前提 |
| D2 | 两个读取方 + **逐字对账锁** | 备选"sh 里也调 node"：同 D1。备选"各自断言等于常量"：常量抄两份必漂，本仓已有 `.quality-rhythm/` vendored 镜像漂移的实测教训 |
| D3 | 只在**显式覆盖**时转发参数 | 备选"永远转发"：把本仓默认值钉进命令行 = 再造一个真源，上游改默认时这里会静默覆盖它；也会打旧任何按旧命令行写的锁 |
| D4 | 追责点放在**欠账门禁**而不是入口事后回读 | 备选"入口跑完读产物 performedBy 比对"：评审一次 15–40 分钟，事后才知道白跑；而门禁侧比对在 CI 上必然执行，且不受"本地有人手动跑"影响。入口仍打印警告说明这一分工 |
| D5 | `judgeBackendMismatch` 按 `overridden===true` 收口 | 备选"只要两侧不同就报"：上游默认与本仓清单本来可以合理不同，那会把每个正常 PR 判红。初版用"performedBy 读不出后端名"当第三档，被自己的用例否证——`self-play` 切分后得到 `['self','play']` 两个**完全像后端名**的记号，"读不出名字"永不成立。故一律改按**显式字段**判 |
| D6 | 不碰 `self_play_resolved` | 收紧自扮演豁免属改"谁来守门"，AGENTS 明令须人工过目；本刀不得顺手把它判红，否则是偷改豁免政策 |
| D7 | 顺带修 `$0` 为 Windows 绝对路径时 `ROOT` 落到父目录 | 不是顺手美化：本刀引入 `source` 兄弟依赖后它当场把入口打死。旧版之所以静默无害，是因为脚本里每处仓库相对读都被 `[ -f … ]` 挡成"不存在"——**错位的 cwd 与缺失的文件逐字同形** |
| D8 | `--help` 改为打到 `set -u` 为止 | 原 `sed -n '2,18p'` 在我加用法行后会**静默截断最新几行**，而 `--help` 看起来照样有输出 |

## 8. 失败模式与回归锁

| 失败模式 | 锁 |
|---|---|
| 入口吞掉带值旗标（"传了等于没传"） | `deep-review-deps.test.js`「入口参数不得静默忽略」 |
| sh 与 node 两份读取方漂移 | 同文件「两个读取方必须给出同一份后端表」（四档配置 + `notEqual` 自证） |
| 体检仍按老名单 | 同文件「--check-deps 只检配置里那对后端」（只装 codex 的假 HOME，断言不出现 `· claude`） |
| 覆盖不转发给驱动 | 同文件「验证层 exec 处必须带 `$BACKEND_ARGS`」+「默认必须为空」 |
| `--check-deps` 变成依赖 node | 同文件「后端解析必须早于定位 node」（按锚点位置判，锚点缺失即红） |
| 判定器重新写死后端名 | `ccg-review-decider.test.js`「禁词锁：剥注释后不得出现 `"claude"`/`"opencode"`」+ 两条前提自证 |
| 同族单后端被读成降级 | `ccg-review-decider.test.js`「同族单后端是显式配置」+ 反向"真缺一个必须报降级" |
| 换 critic 后文案不跟着变 | 同上「后端对文案必须由单一真源派生」 |
| 请求值不落进记录 | `ccg-review-decider.test.js`「判定记录必须写下本次请求的后端对」（真调 `saveRecord`，临时 git 仓库） |
| 设了没生效却判通过 | `check-pr-exec-record.test.js` 三条：纯函数四档不适用 / 出声内容 / **真跑 `evaluateDeepReviewDebt`**（含 `checked===3` 反失明与"改成相符就全绿"的对照） |
| 历史产物被追溯判红 | 同上「无 reviewBackends ⇒ null」+ e2e 里 legacy 那条不得被报 |
| 自扮演出口被顺手堵死 | 「self_play_resolved 归自扮演豁免那条管」 |
| 参数被静默忽略（lib 自身） | `ccg-review-backends.test.js`「未知旗标 / 缺值 / 模式数不为 1 一律 rc=2」（六格逐一断言 stderr 命中预期串且 stdout 为空） |
| 解析退化成空集合 | 「反失明：三种输出都不得为空串」+「规模/成员钉」（清单必须两行、DEFAULTS 与驱动现值对齐） |

## 9. 遗留（不假装已闭合）

- 驱动验证层不应用覆盖参数 → 今天 `--critic` 对 diff 评审的**实际效果是"被对账判红"**，不是"换成功"。
  出口两条（D-R1 修上游分支；D-R2 按驱动自己的注释把引擎 vendor 进本仓 `scripts/`）需人工裁决，
  因 vendor 后本仓就要对该驱动的行为负责（属改"谁来守门"）。
- `INSTALL_HINT` 与 `ccg-backends.sh` 的 `case` 表是两份同义表，现由对账锁覆盖四档；
  新增后端时**必须两处同改**，否则对账锁会红（这是设计意图，不是缺陷）。
- 清单文件与 `DEFAULTS` 的一致性只锁到"与驱动现值逐字相同"；若上游 `cfgForMode` 改名，
  本仓会红在 `ccg-review-backends.test.js` 的存在性锁上，需人工判读是跟随还是坚持。
