---
record: fix-deep-review-entry-lib-closure
task: 修主干的 QM-6 写回链测试夹具漏拷 lib 文件（6 个用例红，挡住全仓 PR）
date: 2026-10-24
branch: fix/deep-review-entry-lib-closure
---

# 主干 QM-6 写回链测试夹具漏拷 `lib/exec-record-statuses.js`

## 1. 现象

主干 `c2c0bb085` 的 **QG Changes = failure**，失败步骤：

```
Gate 2b11 - QM-6 closure writeback chain (changes job)
```

CI 日志（`/actions/jobs/120591168460/logs`）里的真实报错：

```
Error: Cannot find module './lib/exec-record-statuses'
Require stack:
- /tmp/mp-dr-entry-10303-*/scripts/check-pr-exec-record.js
- /tmp/mp-dr-entry-10303-*/scripts/ccg-review-writeback.js
  at Object.<anonymous> (scripts/check-pr-exec-record.js:770:41)
```

## 2. 根因

**主干上的一次提交给 `scripts/check-pr-exec-record.js` 新增了一个 require，但没同步测试夹具的文件清单。**

| 事实 | 取证 |
|---|---|
| `scripts/check-pr-exec-record.js:770` 新增了 `require('./lib/exec-record-statuses')` | 最新 main 的文件内容 |
| `scripts/lib/exec-record-statuses.js` **在仓里存在**（常量模块，自身零 require） | 最新 main 的文件内容 |
| `scripts/deep-review-entry-rc.test.js` 的 `SCRIPT_CLOSURE` 清单里**只有** `lib/ccg-backends.sh` / `lib/ccg-review-backends.js` / `lib/ccg-delivery-digest.js` 三个 lib 文件，**没有** `lib/exec-record-statuses.js` | 最新 main 的文件内容 |
| 该测试用 `SCRIPT_CLOSURE` 逐个 `copyFileSync` 造临时目录（`:120-125`）⇒ 被 require 的 lib 没进临时目录 | 同上 |

⇒ **判据本体与测试夹具的依赖清单脱节**：判据多了一个 require，夹具清单没跟着加 ⇒
测试在自己造的临时目录里 require 一个不存在的模块 ⇒ **6 个用例红**。

## 3. 为什么确认是「主干级存量债」而不是某个 PR 的问题

**对照组判据**（换回主干跑同一道门禁做对照）：

| 读数 | 结果 |
|---|---|
| 主干最新 push `c2c0bb085` 的 QG Changes | **failure**，失败步骤**完全相同**：`Gate 2b11 - QM-6 closure writeback chain (changes job)` |
| 本地 `git checkout origin/main` 后 `node --test scripts/deep-review-entry-rc.test.js` | **4 pass / 6 fail**（在**未修**的主干上） |
| 修复后同一条命令 | **10 pass / 0 fail** |

⇒ 主干自己就红 ⇒ **与本 PR 无关**，且因为它是 required 检查，**会挡住全仓所有 open PR**
（包括 docs-only 的 PR）。

## 4. 修法

一行：把被 require 的 lib 文件补进测试夹具的复制清单。

```diff
   'lib/ccg-delivery-digest.js',
+  'lib/exec-record-statuses.js'
 ]
```

**为什么是这个而不是别的**：
- 夹具清单的**职责**就是「把判据跑起来所需的全部文件搬进临时目录」⇒
  判据多了一个 require，清单就少了一项 ⇒ **清单必须跟着判据走**；
- `scripts/lib/exec-record-statuses.js` 自身**只放常量、不 require 任何东西、不读环境、不写文件**
  （模块头注释明写）⇒ 把它加进清单**不会**给夹具带来新的副作用；
- 反向修法（把 require 改回内联常量）会**制造第二份真相源** —— 而该模块存在的全部理由就是消除这个重复
  （模块头注释：「判据与审计都 require 本模块」）。

## 5. 判据

- `node --test scripts/deep-review-entry-rc.test.js` ⇒ **10 pass / 0 fail**（修前 4/6）。
- `node .github/scripts/check-max-lines.js` ⇒ `✅ 无新增超大文件，挂账清单与现实一致。`
- `node scripts/check-no-brand-residue.js` ⇒ PASS。
- 编码完整性：`grep -c $'\xef\xbf\xbd'` = 0。

## 6. 遗留

- **本 PR 只修夹具清单**。判据本体（`check-pr-exec-record.js`）不动 —— 它是对的。
- 同一批新增的其它 lib 文件是否还有别的夹具漏拷，本 PR **不普查**（那是另一件事）；
  若要查，判据是「凡 `require('./lib/…')` 的判据文件，其 lib 依赖都必须出现在对应测试的复制清单里」。
- 本 PR 与 `film-auto-longform-plan`（方案文档 PR）**无文件重叠** ⇒ 可独立合并。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）

## CHANGELOG 条目

# fix(ci): 修 QM-6 写回链测试夹具漏拷 lib 文件（fix-deep-review-entry-lib-closure）

- 症状：主干 `c2c0bb085` 的 QG Changes 在 `Gate 2b11 - QM-6 closure writeback chain` 红，报 `Cannot find module './lib/exec-record-statuses'` ⇒ 6 个用例红，且因是 required 检查，**挡住全仓所有 open PR**。
- 根因：判据 `scripts/check-pr-exec-record.js:770` 新增了 `require('./lib/exec-record-statuses')`，但测试夹具 `scripts/deep-review-entry-rc.test.js` 的 `SCRIPT_CLOSURE` 复制清单**没跟着加这个 lib 文件** ⇒ 临时目录里缺依赖。
- 修法：把 `lib/exec-record-statuses.js` 补进 `SCRIPT_CLOSURE`（一行）。该 lib 是零副作用的常量模块，不会给夹具带来新依赖。
- 验证：修前 4 pass / 6 fail（主干上直接复现）→ 修后 10 pass / 0 fail。
