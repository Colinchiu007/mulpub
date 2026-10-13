---
record: reuse-p0-p3-wire
task: P0-3 分类守卫 —— 让「给了非 ID 值」从静默回落默认分类变成显式失败
date: 2026-10-14
branch: reuse-p0-p3-wire
---

## 本次执行记录：P0-3 分类守卫（reuse-p0-p3-wire，2026-10-14）

### 变更类型与隔离

运行时代码变更（`packages/api-publish-engine/`），已在隔离 worktree 完成：
`D:\Data\projects\mp-worktrees\mp-reuse-p03`（D 盘），分支 `reuse-p0-p3-wire`。
依赖就绪：`pnpm install --frozen-lockfile` + `node scripts/ensure-electron.js` + `node scripts/verify-worktree-deps.js`（三项均 exit=0）。

### 做了什么

修掉三处硬编码分类默认值里**最隐蔽的那一处**：

| 位置 | 改前 | 洞 |
| --- | --- | --- |
| `bilibili-video.js:77` | `Number(taskData.category \|\| taskData.tid) \|\| 21` | `Number('动画')` = NaN ⇒ `NaN \|\| 21` = **21** |
| `baijiahao-article.js:151` | `String(cat == null ? '未分类' : cat)` | 非 ID 值被原样写进表单，平台侧如何解释无从得知 |
| `youtube.js:85` | `categoryId \|\| "22"` | 同型（本数据集无 youtube，本轮不动，已在 PRD §14.1 记明） |

即**用户以为按「动画」发了，实际发到 21 号分类，且全程无报错**。

新增 `packages/api-publish-engine/src/publish/category-resolver.js`：未提供 ⇒ 交回调用方走平台默认值（行为不变）；合法平台侧 ID ⇒ 放行；**两者都不是 ⇒ 抛 `CATEGORY_UNRESOLVED`**。

### 一个被架构约束逼出来的更好设计

初版把「中文名 → 平台侧 ID」的**解析**写进了 `api-publish-engine`，被否掉：
`cloud-accounts/validate-account.js:84-89` 明写本包是**可独立打包的零 workspace 依赖运行时**
（见 `package.json` 的 `files` 与 Docker runner 的 COPY 清单），因此**不能 require('@multi-publish/shared-utils')**。

想清楚后发现**解析本来就不属于这一层**：`taskData` 按契约是已备好的数据；把中文名翻成 ID 需要分类表
与 5 种失败语义，那是 `shared-utils.platformTaxonomy.resolveCategoryId` 的职责，
**由上游（桌面主进程）在组包前完成**。本层只做守卫，而守卫不需要分类表 —— 代码量与耦合都更小。
该约束已写成**机械锁**：测试直接读源码断言「不得出现 `require('@multi-publish/*')`」。

### 另一处「登记即生效」的坑

`packages/api-publish-engine/scripts/run-tests.js` 用**硬编码 `VITEST_FILES` 清单**收集测试；
不在册的文件改用 `node --test` 跑，而 vitest 风格文件依赖 `describe/it` 全局 ⇒
`ReferenceError: describe is not defined`，表现是 **runner exit=1 且测试文件数不增**（极难察觉）。
已把 `category-resolver.test.js` 登记在册。

### 验证

| 项 | 结果 |
| --- | --- |
| `category-resolver.test.js` | **9/9**（含「中文名必须抛错」「数字 0 不是空值」「零 workspace 依赖机械锁」）|
| 本包全量（`node scripts/run-tests.js`） | **41 文件 / 420 用例全过，exit=0**（登记前为 40/411 + exit=1）|
| `bilibili-upos.test.js` | 7/7 无回归 |
| `topic-inline-contract.test.js` | 15/15 无回归 |
| 对照证伪 | 在**未含本改动**的 worktree 上跑同一 runner 得 `exit=0`，据此把「exit=1」定位到**登记缺失**而非逻辑错 |

> 对照那一步不可省：只看「411 全过但 exit=1」很容易误判成自己写坏了逻辑，
> 而真实原因是 runner 的清单没登记新文件。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | N/A | 本 PR 未改 `apps/desktop/electron/` 或 `packages/rpa-engine/`；改的是 `packages/api-publish-engine/`（独立打包运行时，其依赖闭包未变、未新增第三方依赖）|
| QM-2 代码必检项 | ✅ | require 路径逐个核对存在；无新第三方依赖；`module.exports` 无多余逗号；注释 `/* */` 成对 |
| QM-4 视觉 | N/A | 无 UI 变更 |
| QM-6 双模型评审 | 未执行（如实登记）| 本机无 `codeagent-wrapper` |
| 远程同步 | PENDING | 待 PR 合并后回填 merge SHA |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
