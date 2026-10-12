---
record: gate4-testid-dedupe
task: 修复 gate4 测试编号重名（我新加的 T21-T24 与既有编号冲突）
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写为 PASS + merge SHA 并删除三个 sync_* 字段
sync_backfill_owner: 下一个会话（或本会话的合并后回填步骤）
---

## 本次执行记录：修复 gate4 测试编号重名（gate4-testid-dedupe，2026-10-12）

- **变更类型**：`scripts/check-gate4-selection.test.js`（门禁自身的测试文件）⇒ 按「`scripts/` 工具脚本自身的 PR 属混合 PR」走完整质量节拍；改动为**纯重命名**，无断言变化。
- **发现路径**：PR #3375 合并后做主干落地核对时，用 `git show origin/main:<file>` 列出该测试文件的既有编号，
  发现既有编号已占到 **T25**（且原本就有 T1–T25 的排布），而我新加的回归锁被命名为 **T21–T24** ⇒ **四条与既有编号重名**。

### 为什么必须修（不是洁癖）

该文件是门禁的测试，编号是**人类引用锚点**（评审、执行记录、`openspec/records` 里都会写「T22 判红」）。
重名会让「T22 判红」在同一个文件里指向两条不同用例——将来有人按编号去查「哪条锁住了单数声明形态」
会拿到错的。这属于**我引入的**可维护性缺陷，故单独修并留记录。

### 改动

| 旧编号 | 新编号 | 用例 |
| --- | --- | --- |
| T21 | **T26** | 单数声明形态（恰好 1 个受影响项目）必须可解析，计数按 1 |
| T22 | **T27** | 单数形态头部点名与清单不一致时必须判 `unparsable` |
| T23 | **T28** | 单数形态下 affected 臂必须判绿（CI 现场回归锁） |
| T24 | **T29** | 单数形态若点名的就是 desktop，仍必须判红 |
| 注释头 `T21-T24` | `T26-T29` | 同步更新 |

**未动**：既有编号（含既有的 `T6` 重复——那是本次之前就存在的，改它属范围外改动，留给文件所有者）；
任何断言、判据、测试数量（仍为 29 例）。

### 门禁表

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 相关测试 | PASS | `node --test scripts/check-gate4-selection.test.js` → **29/29**（与改名前逐例一致） |
| 编号唯一性 | PASS | 按 `test\('T(\d+)` 提取后分组：我引入的编号已无重复（剩余 `T6 x2` 为既有） |
| 行尾 / 编码对账 | PASS | 两口径 `numstat` 一致；`check-text-encoding-integrity.js` 无新增损坏 |
| 品牌残留 | PASS | `check-no-brand-residue.js` |
| 判据未变 | PASS | 纯重命名：`git diff` 仅 5 处字符串（4 个用例名 + 1 处注释头） |
| 远程同步 | PENDING | 本 PR 尚未合并。合并后：`git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 取 merge SHA；`git ls-remote --heads origin gate4-testid-dedupe` 返回 0 行证远端分支已删；回填本行并删除 `sync_*` 三字段（本条**不**加台账登记项：记录文件的 `sync_*` 字段本身就是该源的登记机制，额外加台账键会被判陈旧项——上一轮实测） |

### 遗留

1. 该文件既有的 `T6` 重名未修（范围外，属文件所有者）。
2. 门禁编号无机械唯一性检查 ⇒ 未来仍可能重名。**建议**（未在本 PR 实现，避免范围蔓延）：
   在 `check-gate4-selection.test.js` 内加一条「编号唯一」自检用例，把这条纪律机械化。
