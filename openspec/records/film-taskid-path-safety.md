---
record: film-taskid-path-safety
task: 修影视工程 5 个 taskId 入口共用的路径遍历防护判据——拒绝 . / .. 与含分隔符的 taskId，跨平台同结果
date: 2026-10-23
branch: film-production-identity-followup
---

## 本次执行记录：taskId 路径安全段合同（film-taskid-path-safety，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 代码变更（4 个源文件 + 3 个测试文件 + 2 个 openspec 工件）。`classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（含代码，不走 docs-only 快速通道）。分支 `film-production-identity-followup`，经 PR 落地，未直推 main |
| 规格工件 | PASS | openspec change `film-taskid-path-safety`（proposal / tasks / specs delta）。delta 已并入主 spec：MODIFIED「失败分镜单镜重试」+ ADDED「任务标识的路径安全段合同」；主 spec Scenario 总数 61，**全部含 WHEN/THEN**（脚本校验 0 缺失） |
| 第一性原因（QM-5 ①） | PASS | **spec 自身把有洞的判据写成了合同**：`openspec/specs/film-engineering/spec.md:215` 原文「`taskId` 非空且满足 `taskId === path.basename(taskId)`（路径遍历防护）」⇒ 不是「实现偏离 spec」，是「spec 判据本身有洞」，故走 MODIFIED Requirements 而非纯 bug fix |
| 逃逸分析（QM-5 ②） | PASS | 见下「逃逸分析」。**该缺陷已长期挂在 main 上**，此前被登记为「与本次改动无关的既有失败」而未追 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 **3 条**用例（危险 taskId 全拒 / 合法 taskId 不误拒 / 判据与 path.basename 解耦）。**1 组变异反证实测**：把 `isSafeTaskId` 换回 `!== path.basename()` ⇒ **2 条红**；还原 ⇒ 33/33 绿 |
| 防止再次发生（QM-5 ⑤） | PASS | ① 判据收敛为**单一真源** `isSafeTaskId`（`production-driver.js` 导出），5 个入口全部复用，消除「每处各拼一次」的结构；② spec 新增独立 Requirement 写明判据、平台无关性与「只多拒、不少拒」的收紧方向；③ 用例直接锁住「与 `path.basename` 解耦」，防止有人改回平台相关写法 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 相等；改动文件纯 LF（`CR=0 / NUL=0 / BOM=False`） |
| 接线棘轮 | N/A | 未新增 `*.test.js` 文件（全部在既有测试文件内追加） |
| QM-1 打包 | PASS | 运行时代码变更 ⇒ 适用。证据取自 CI `build` job。未新增依赖、未改 `package.json` / `files` glob |
| QM-4 视觉 | N/A（已确认非跳过） | **未触碰任何 `.vue` / `.css`**。改动落在 `production-driver.js` / 两个 ipc-handlers 的**校验逻辑**，零 UI 变化 |
| QM-6 CCG 双模型外部评审 | **未执行（环境不具备）** | 本仓 REST API 对当前 token 全 404（git 通 ≠ API 通），`claude` / `opencode` / `codeagent-wrapper` 三后端均不可用；曾派独立 Verifier 对上一轮方案做对抗评审，**因 Token Plan 用量上限（HTTP 422/code 2067）未能运行**。本次改动**未获独立评审**，按 SELF-REVIEW 记录于 `openspec/changes/film-taskid-path-safety/proposal.md` 的影响面说明 |
| 远程同步 | 由门禁推导 | 合并后由门禁按主干历史推导（`attr.state==='PR' && attr.merged===true`），不手工回填 |

## 缺陷溯源（QM-5 ①）

原判据 `taskId !== path.basename(taskId)` 有两个洞：

| 洞 | 实测 | 后果 |
|---|---|---|
| `.` / `..` 自身即 basename ⇒ 恒等式成立 | `path.basename('..') === '..'` | **放行** ⇒ `path.join(root,'production','..','recycled')` = `<mediaRoot>/recycled`，**逃出 `production/` 一层**；且 `taskId: '..'` 与名为 `recycled` 的任务落同一目录 |
| `path.basename` 的分隔符语义**平台相关** | POSIX 上 `\` 是合法文件名字符 ⇒ `path.basename('a\\b') === 'a\\b'` | **放行** ⇒ 同一份代码在 POSIX/Windows 上对同一输入给出不同结论 |

**5 个受影响入口**（改动前均用该判据）：

| 入口 | 位置 |
|---|---|
| `production-plan` / `production-run-batch` / `production-status`（共用 `validateProductionArgs`） | `ipc-handlers/film-engineering-production.js` |
| `production-retry-shot` | `ipc-handlers/film-engineering-production.js` |
| `download-recycled` | `ipc-handlers/film-engineering.js` |
| `runProduction` 驱动入口 | `services/film-engineering/production-driver.js` |

## 逃逸分析（QM-5 ②）

**该缺陷不是「没测」，而是「测试测了但没人看结果」。**

`electron/ipc-handlers/film-engineering.test.js` 里有一条例外的用例：

```js
{ taskId: 'a\\b', items: [...] }   // 期望被拒
```

它在 **Linux 上恒失败**：`a\b` 放行 → 落到下载分支 → 测试注入的 `_testDownloadShot` mock
返回 `undefined` → `results[i] = r.ok` 抛 `TypeError: Cannot read properties of undefined`。

**这条失败在 main 上长期存在**，此前被登记为「与本次改动无关的既有失败」
（`openspec/records/film-production-artifact-identity.md` 的遗留段），**没人往「守卫有洞」上想**。

**逃逸的机制**：该用例所在文件的失败被同文件另一条（真正无关的）失败**淹没**，
且失败信号是 `TypeError` 而非「断言未命中」——**看起来像测试写错，不像实现有洞**。
CI 上它一直红，但因为 required check 判的是 job 整体结论、而 Windows CI 上该用例
（`a\b` 被正确拒绝）**是绿的** ⇒ **同一份代码两个平台一个绿一个红**，
这个平台差异没人注意。

**教训**：一条「Windows-only 通过、Linux 恒红」的用例不是环境噪声，
**它本身就是跨平台语义分叉的探测器**。判「既有失败、与我无关」之前，
应先问「它在另一个平台上是绿的吗」——若是，则绿的那个平台才是异常的。

## 修复与回归保护（QM-5 ④）

新增 `isSafeTaskId(value)`（`production-driver.js` 导出，**单一真源**）：

```js
typeof value === 'string' && value && value === value.trim()
  && value !== '.' && value !== '..'
  && !value.includes('/') && !value.includes('\\')
```

**为什么不用字符集白名单** `/^[A-Za-z0-9._-]{1,64}$/`（前端已有规则）：那会把后端收紧到与前端完全同口径，
后端不再接受含中文或空格的 taskId；而当前后端判据允许这些，存量 taskId 就是这么产生的。
**改用「精确路径语义」⇒ 只多拒 `.`/`..`/含分隔符/空/首尾空白五类，其余原本能用的全部继续能用。**

| 文件 | 动作 |
|---|---|
| `production-driver.js` | 新增并导出 `isSafeTaskId`；自身守卫改用它 |
| `film-engineering-production.js` | 2 处守卫改用它（`production-retry-shot` / `production-status`） |
| `film-engineering.js` | 1 处守卫改用它（`download-recycled`） |
| `production-driver.test.js` | 新增 3 条用例 |

**变异反证**：`isSafeTaskId` 换回 `!== path.basename()` ⇒ **2 条红**；还原 ⇒ 33/33 绿。

## 测试证据

| 范围 | 结果 |
|---|---|
| `electron/services/film-engineering/production-driver.test.js` | ✅ 33/33 |
| `electron/services/film-engineering/` + `electron/ipc-handlers/film-engineering*.test.js` | ✅ **600 passed / 0 failed**（**含此前长期红的 `download-recycled` 用例**） |

运行环境：`/tmp`（overlayfs）工作树副本。`/workspace` 为 NFS，实测装依赖 5 小时量级 vs `/tmp` 33 秒；
`/tmp` 会被沙箱反复清空，需按需重建。Linux 上跑本仓部分测试须先 `export TMPDIR=/tmp TEMP=/tmp TMP=/tmp`
（否则 `os.tmpdir()` 在测试的 env 恢复后变成字符串 `"undefined"`）。

## 遗留（不假装已闭合）

- **auto 模式的批次产物身份漂移**（另立 change）：auto 模式按**批内序号**命名产物 `shot_NNN.mp4`，
  而 `project.shots` 是可编辑状态。删除中间一个镜后，后续镜的产物错位一位，
  `collectMissingShots` 仍判「齐备」⇒ 成片内容错位。**已实跑复现**（见 proposal 遗留段）。
  **修法与本 change 不同**：不能照搬手动出片的批次指纹——auto 的分镜集是活状态，
  加指纹会让用户改一个字就丢光已生成视频；auto 需要自己的按 shotId 寻址方案。
- 本 change **未经独立评审**（见 QM-6 行）。
