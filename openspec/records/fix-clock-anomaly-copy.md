---
branch: fix-clock-anomaly-copy
date: 2026-10-17
---

# 本次执行记录：时钟倒挂处置口径修正——用户「无需处理」+ 区分「校时只对本机时间落后有效」（fix-clock-anomaly-copy，2026-10-17）【混合 PR】

> task: 用户质疑 #3731 的「请校准系统时间」建议——「为什么要进行设置 → 时间和语言 → 立即同步？用户会比较疑惑」

## 一、QM-5 第①步：第一性原因

**缺陷不是文案不好看，是「排障动作被写成了用户步骤」，而且那个动作对一半情形无效。**

- 引入点：#3731（`3ff90dfc`，本会话上一笔）在 `publish-interval-guard.js` 的告警里写了
  「请校准系统时间或使用紧急放行」，并把它原样搬进 `PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md` §13.4 的用户处置第 ① 条。
- 当时的意图：时钟域损坏的「根因」是时间不对，所以给出根因处置。**意图没错，错在没分情形**。
- 为什么写错：写那段时只想到「时钟快进」这一种成因，没意识到同一判据 `now − ts < 0` 还有
  「本机时间落后」这种**方向相反但同形**的成因；而这两种成因下「校时」的有效性恰好相反。
- 判据（可复核）：守卫里 `elapsed = now - Number(lastTime)`；`elapsed < 0` 时
  ① `lastTime > 真实时间`（未来戳，校时后 `now`=真实时间仍 `< lastTime`）→ 校时无效；
  ② `lastTime == 真实时间 && now < 真实时间`（本机落后）→ 校时后 `now` 跳到真实时间，立刻越过。

## 二、QM-5 第②步：测试逃逸链

| 层 | 为什么没拦住 |
| --- | --- |
| 单元测试（守卫） | C1–C8 只断言**行为**（钳位值、去重、自愈、形状），**没有一条断言告警文案的内容**。文案被视为「附带输出」，属断言真空 |
| 组件测试（面板） | U1/U2 断言的是「标签渲染 + zh/en 成对 + 精确串」，它们**忠实锁住了错误的文案**——测试绿恰恰证明文案写错了也会绿，因为判据是「与我写的一致」而不是「对用户是否成立」 |
| PRD 文档检查 | doc-gate 只查「文档与代码是否同步」，不查「处置建议是否对目标读者成立」 |
| E2E / 视觉 | 标签是纯文本追加，视觉回归对此无感 |
| 代码评审（QM-6） | 深度评审的 4 条裁决也**没有一条**质疑处置建议的正确性——它审的是实现是否按设计工作，不审「设计对用户是否成立」 |

**共性**：所有层都在检查「实现与自述一致」，没有一层检查「自述对用户是否成立」。这类缺陷只能由**用户反问**或**角色代入**发现——本次正是用户反问发现的。

## 三、QM-5 第③步：系统性漏洞

1. **文案类断言只锁「存在性/成对性」，不锁「内容纪律」**（`PublishProgressPanel.test.js` U2）：
   判据写成 `expect(zh).toContain('<我写的串>')` ⇒ 改文案必须同改测试，但**没有任何一条**禁止
   出现故障词、内部术语、或遗漏「无需处理」。
2. **告警文案没有断言真空的兜底**（`publish-interval-guard-clock-anomaly.test.js`）：
   行为测试齐全，告警内容零断言。
3. **PRD 的「处置」小节没有读者角色维度**（§13.4 原样）：把用户与排障者的动作混在一个编号列表里。

## 四、QM-5 第④步：修复 + 回归保护

| 改动 | 文件 | 回归保护 |
| --- | --- | --- |
| 用户文案改为「无需处理」且禁用故障词/内部术语 | `apps/desktop/src/locales/publish-page/{zh,en}.js` | `PublishProgressPanel.test.js` **U1**：`toContain` 新文案 + **两条 `not.toContain`**（「时钟异常」「钳位」）；**U2** 精确串 + zh/en 成对 |
| 告警改为「用户无需操作 + 校时仅对『本机时间落后』有效」 | `packages/shared-utils/src/publish-interval-guard.js` | `publish-interval-guard-clock-anomaly.test.js` **C2b**：`toContain` 三条（无需操作 / 仅对「本机时间落后」有效 / 紧急放行）+ `not.toContain('请校准系统时间')` |
| PRD §13.3 文案纪律 + §13.4 按角色分层 + §13.4.1 两情形判别表 | `01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md` | 人工复核（文档），并作为文案断言的口径来源 |

**TDD 见证（先红后绿）**：
- 新增 `C2b` 后、实现前：`Tests 1 failed | 8 passed`，红在 `:67`（`toContain('用户无需操作')`）。
- `U1/U2` 改断言后、实现前：`Tests 2 failed | 30 passed`。
- 实现后：守卫域 `64 passed`；面板 `32 passed`。

## 五、QM-5 第⑤步：预防措施（已落地）

1. **文案纪律变成断言**（不是文档纪律）：`U1` 的两条 `not.toContain` 是机械拦截——任何把
   「异常/钳位」写回用户文案的改动当场红。
2. **告警文案进入断言面**：`C2b` 让「这一行写给谁」变成可执行判据（含反向断言旧措辞必须消失）。
3. **PRD 处置小节增加「读者角色」维度**：§13.4 改为表格（用户 / 排障者两行），并把「校时对哪种成因无效」写进 §13.4.1。
4. **learnings 沉淀**（`01-docs/learnings.md` 2026-10-17 节）：pitfall「未来时间戳进间隔库会变成幽灵等待」、
   pattern「处置建议必须按角色分层且先分情形再给动作」、pattern「用户可见文案三条机械纪律」、
   preference「共享根未提交的文档随时会被别人的整树重写清掉」。
   本 bug 的 pitfall（`future-timestamp-in-interval-store-becomes-ghost-wait`）已由 **#3795** 代提交进 main，
   本 PR 不重复沉淀（原先那段与主干内容重复，已在提交前删除，避免同一教训两份口径）。

## 六、门禁与取证

| 门禁 | 读数 |
| --- | --- |
| TDD | 先红：C2b 1 红 / U1+U2 2 红；后绿：64 + 32 passed |
| 变更类型判定 | `node scripts/classify-docs-only.js` → 混合 PR（含 `packages/`、`apps/`），走完整节拍 |
| locale 成对 | `.github/scripts/check-locale-sync.js --keys` |
| 受管文档绝对路径 | `node scripts/check-doc-abs-paths.js` |
| 品牌残留 | `node scripts/check-no-brand-residue.js` |
| 逐文件行数 | `node .github/scripts/check-max-lines.js` |
| 执行记录 | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` |
| CCG 提交门禁 | pre-commit 5 项（结果见提交输出） |
| QM-1 打包 | 本 PR **未改** `apps/desktop/electron/`（改的是 `packages/shared-utils` + `apps/desktop/src/locales`），按 QM-1 触发条件不适用；`apps/desktop/src`（渲染端）由 `PublishProgressPanel.test.js` 覆盖 |
| QM-6 深度评审 | 见 `.ccg/reviews/<sha>.json` 与 `.adversarial/` 产物 |
| 回填型补充 | 混合 PR 走全量模板，但为满足「两形态同写」仍补声明式 bullet |

- 远程同步 PASS（PR #3801 → `befa196c`，回填与 sync_* 删除同一次提交）

| 远程同步 | PASS（PR #3801 squash 合并 → `befa196c79340bcd2d2f5a88643988fd8f9d5bd3`，2026-10-17T17:33:35+08:00；回填与本删除同一次提交） |
