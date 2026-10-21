---
record: qm6-writeback-review-fixes
task: 把设计评审第 1 轮（critic 7 条 / Critical 3）的逐条处置落进 qm6-closure-writeback 的 design 与 tasks
date: 2026-10-21
---

## 本次执行记录：设计评审处置落稿（qm6-writeback-review-fixes，2026-10-21）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格变更，只改 `openspec/changes/qm6-closure-writeback/{design,tasks}.md` 两份，零代码。正规入口 `scripts/start-mp-task.ps1 -TaskName qm6-writeback-review-fixes -NoDeps`，裸分支同名、起点 `origin/main == 5b6e68237`（即 #4106 的 merge 提交），判据取产物（`git worktree list` 命中 + 分支名回读） |
| 为什么这一片是 follow-up 而不是原 PR 的一部分 | ✅ | **原 PR #4106 被另一个会话在评审进行中合并了**：`gh pr view 4106` → `state=MERGED`、`mergedAt=2026-10-20T16:54:45Z`、merge `5b6e68237`、`--delete-branch` 连带把远端分支删掉，我的 worktree 与**未提交**的三处处置一起随目录消失（现场：`git worktree list` 该路径 0 命中、`git branch --list qm6-tier-writeback` 空、`git ls-remote --heads origin qm6-tier-writeback` 空）。我已按「评审期间冻结被评审对象」刻意**不合并**并正在跑评审，冻结被这次并发合并实质解除。内容无损（`git show origin/main:openspec/changes/qm6-closure-writeback/design.md` 四份文件齐、design 里 `机制（评审 i3 命中` 计数 0 ⇒ 确认处置**没有**进 main，正是本片要补的）。登记为遗留 ③：本仓没有任何机制能让一个 PR 在"评审在飞"期间不被别的会话合掉 |
| 7 条意见逐条处置 | ✅ | **接受 5 条**：i2 规范化规则本身未定义（补进 design §3-D3，含键序/数组序/序列化/摘要/固定行为向量五条）；i3 条件 4「本次刚产出」无实现机制（补进 §3-D2，改为**调用前后字节比对**，并写明为何不用 pid/mtime/临时清单）；i4 `delivery@<hex>` 命名易被读成签名（§3-D3 加代码内出声 + 红文案措辞锁，tasks 4.1c）；i5 行号引用未声明坐标系（§6.1 拆成"仓内取 87f8de7ba / 仓外取本机无锚点版本"两张脸，并给重取命令）；i7 rc 锁没指定文件（§6.4 + tasks 2.2 落点 `scripts/deep-review-entry-rc.test.js`）。**部分接受 1 条**：i1 说"五项推迟均未映射任务 ID"不准确——8.1/8.2/8.3/8.4 在 tasks §8 已编号、8.5/8.6 在 §5 有指针；它说对的是**缺验收标准**，故 §6.3 补一张"推迟项→任务→越界即红"表。**接受问题、拒绝修法 1 条**：i6 自举循环是真的，但它给的两个出口（dry-run 生成模板产物 / 测试预置合规种子）都不能用——前者按 D1 不产交付物，后者是把假产物喂进判据；正解写在 §6.2：测试先证正确性 → 实现片真跑一次自证 → 产不出就修代码，**卡住不许合并就是设计意图** |
| 评审自身的交付现实 | ✅ | `sh scripts/plan-review.sh <design 副本> --force` 实跑 **rc=2**（`echo $?` 取自在同一串里单独保存的 `PLAN_REVIEW_RC`，不是管道末段退出码）。critic=claude 交付 7 条 / Critical 3 / 最低维度分 5；未收敛后调 proposer=opencode **未跑成**：任务提示 9790 + 角色提示 147 = **9944 字符**，超该后端实测上限 **7800**（引擎自报边界 `(8125, 8145]`，非文档承诺）。⇒ 本轮是**单轴意见 + 逐条处置**，不得写成 DUAL 已闭合；跨家族那一半记在 tasks 7.1b，补法是压送审副本（剥 §2/§4 两张给人看的表），仓内 design.md 不动 |
| 送审输入的 slug 碰撞（顺带量到的既有缺陷） | ✅ | 直接把 `openspec/changes/<change>/design.md` 交给 `plan-review.sh` 被 **fail-closed 拒了（rc=2）**：`✗ 产物目录碰撞：.adversarial/ccg-plan-design-claude`，工具自陈根因「引擎 slug 只用方案文件名、不带所在目录」。本仓每个 change 都叫 `design.md` ⇒ 不加临时改名就评审不了。**没有用 `MP_ALLOW_PLAN_COLLISION=1` 绕行**（那是知情放行不是修法），改成复制成带 change 名的唯一文件名送审、字节相同。登记遗留 ④：真正的修法在引擎侧加目录维度，属改外部产物、人工过目，不在本片顺手做 |
| 行尾与 diff 对账 | ✅ | 两份文件工作副本实测 `cr == lf`（全 CRLF、无 lone CR、无缺尾）。只用 Edit 的**单行/短多行锚点**改，不整文件重写；两口径 numstat 必须相等（见 PR 正文读数） |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键。**也未改写 `openspec/records/qm6-tier-writeback.md` 里那行 `QM-6 PENDING`**——那是别的分支的记录，就地改写正好命中本仓要防的"人工改写收口行"形态；真实读数写在**本篇**里，两条由 PR 号互相指认 |
| 品牌残留 / 文档同步 / 绝对路径 | ✅ | 三条判据本地实跑，读数见 PR 正文（`check-doc-abs-paths` 尤其要跑：design §6.1 提到引擎路径，只能写 `~/.claude/...` 占位形态） |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 零代码、零 UI，无新增可测行为 |
| QM-6 CCG 双模型外部评审 | 单轴已跑 | **本片评审的就是方案本身**，第 1 轮结果与逐条处置即上表；跨家族轴因载荷超限未跑成（现实读数在上一行），补跑记在 tasks 7.1b，不写成"双模型完成"。判定器对本次纯文档差量判 `SKIP`，机械链上不强制——强制的是我给它记的这条账 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的读数在 commit 之后取并写进 PR 正文
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 遗留（不假装已闭合）

1. **跨家族那一半还欠着**（tasks 7.1b）。本轮只有 critic 轴交付，design §6 是"单轴意见 + 我方逐条处置"，不是对抗收敛。分数也未达标（最低 5/feasibility），按"分数不达标升级不盖章"，本方案**没有盖章**。
2. **i6 揭示的自举代价已经写进设计**：写回器修好之前实现片无法合并。这是刻意的，但它是**新的阻塞面**——如果实现片发现真跑不出产物，正确反应是修代码，不是回到手写。
3. **并发合并会解除评审冻结，本仓无守卫**。我用不合并来表达冻结，另一个会话照常 `gh pr merge` 就把这个约定击穿了；这次运气好（丢的只是未提交的编辑，可从 critique 重建）。要收口得有执行体——候选是"PR 打上 in-review 标签即禁止自动合并"，属改「谁来守门」，人工过目，不在本片做。
4. **plan-review 的 slug 缺目录维度**是既有缺陷，本片靠"唯一文件名"绕开而非修掉；修法在引擎侧（见上一行现场）。
5. design §2 那组「闭环 × tier」交叉读数仍是孤立手工探针（tasks 0.1b 挂着）；§6.1 只是把"引擎行号不作契约"这件事讲清楚，没消掉 0.1b。
