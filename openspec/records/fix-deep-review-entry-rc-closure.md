---
record: fix-deep-review-entry-rc-closure
task: 补上入口测试夹具的 require 闭包清单（两个新模块），修主干 QG Changes 红
date: 2026-10-24
branch: fix-deep-review-entry-rc-closure
---

# 夹具的 require 闭包漏了两个新模块 ⇒ 主干 `QG Changes` 在所有 PR 上红

## 1. 现场

主干 `9a84c4bc9` / `c2c0bb085` / `40e1fb1ba` 三个 commit 上的 `QG Changes` 作业红，
失败清单固定是这 6 条：

```
not ok 35 - ① 驱动 rc=0 ⇒ 入口 rc=0，且盘里的记录被写回 tier=external + delivery@ 摘要
not ok 36 - ② 驱动 rc=1 ⇒ 入口 rc 逐字等于 1（写回器恒 0 不得顶掉评审的失败）
not ok 38 - ④ 驱动 rc 与写回成败无关：写回被拒（backend-mismatch）时入口 rc 仍是驱动的 rc
not ok 39 - ⑤ 上一轮已闭环、本轮驱动没写过 ⇒ reason=no-write，记录逐字节不变
not ok 40 - ⑥ 驱动交付了但未收口（status 仍 pending）⇒ reason=not-closed，不得补 tier
not ok 44 - ⑪ 驱动只刷新时间戳 ⇒ 入口侧 reason=no-new-delivery，且不得写上 tier
```

错误原文（本地在 origin/main 上复跑 `node --test scripts/deep-review-entry-rc.test.js` 实测）：

```
Error: Cannot find module './lib/exec-record-statuses'
```

## 2. 根因

#4093（`feat(gate): QM-6 记录欠账只读审计档 --audit + Electron CI 分片方案`）给
`scripts/check-pr-exec-record.js` 引入了**两个**新模块：

```js
const { auditHistoricalDebt, formatText } = require('./lib/exec-record-audit')   // 第 469 行
const { CLOSED_DEEP_REVIEW_STATUSES } = require('./lib/exec-record-statuses')  // 第 770 行
```

而 `scripts/deep-review-entry-rc.test.js` 的夹具靠一份**手写**的 `SCRIPT_CLOSURE` 清单
把入口脚本及其 require 闭包复制进临时仓库再真跑。清单里没有这两个新模块
⇒ 夹具里的入口脚本 require 不到 ⇒ **在「写回步骤」之前就崩** ⇒ 整组用例红。

⇒ #4093 自身在**主干上**是绿的（它没改这个测试文件）⇒ 这条红是**落地后才暴露**的：
主干 CI 的 `QG Changes` 作业因此在**所有 open PR 上**红，required `Gate Result` 连带红。

**教训（与 #4093 同一族）**：require 闭包靠人记得同步 ⇒ 必须有一条**机械**核对，
否则同一个坑会再踩（本次就是「加模块」与「加进夹具清单」分在了两个提交里）。

## 3. 改法

① `SCRIPT_CLOSURE` 补两个成员（`lib/exec-record-statuses.js`、`lib/exec-record-audit.js`）；
② **加一条机械锁**：从入口脚本的源码里解析出它真实 `require` 的每个仓内模块
（`require('./…')`，忽略 `node:` 内置与包名），断言每个都在 `SCRIPT_CLOSURE` 里。
   比较前统一补 `.js` 后缀 —— require 侧可以省略后缀（`require('./lib/x')`），清单侧写全名。

## 4. 验证

- `node --test scripts/deep-review-entry-rc.test.js`：
  改前 **4 passed / 6 failed**（错误原文 `Cannot find module './lib/exec-record-statuses'`）
  → 改后 **11 passed / 0 failed**（原 10 条 + 新增机械锁 1 条）。
- 机械锁**当场抓到了第二个漏项**（`lib/exec-record-audit`）—— 若只补第一个模块，
  锁仍会红 ⇒ 这条锁不是装饰。
- 主干侧其余门禁在 origin/main 上实跑全绿（max-lines / gate-record-debt /
  text-encoding / brand-residue / doc-abs-paths / record-qm5-rows / changelog-growth /
  changelog-dup / debt-budget 共 9/9 rc=0）。

## 5. 遗留

- 本片只修**夹具清单 + 加锁**，不改 `check-pr-exec-record.js` 的任何判定逻辑。
- 同族风险仍在：别的测试文件若也用「手写 require 闭包清单」复刻入口，同样会漏。
  本片把锁加在**这个**夹具上；全仓是否还有同形夹具，本轮未逐个清点（登记为遗留）。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |
