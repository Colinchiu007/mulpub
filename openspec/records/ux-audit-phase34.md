---
record: ux-audit-phase34
task: UX 审计阶段 5 首两批新门禁 —— 5.3 未接线组件（check-ui-wired）+ 5.4 死观测字段（check-field-consumed），含基线登记、接线与四条变异反证
date: 2026-10-19
sync_pr: pending
sync_status: PENDING
sync_reason: 混合 PR（scripts/ 判据 + .github/workflows 接线 + .gitignore + 文档），合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：UX 审计阶段 5.3 / 5.4 两条新门禁（ux-audit-phase34，2026-10-19）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码工具变更 ⇒ 独立 worktree（`<仓库父目录>/mp-worktrees/mp-ux-audit-phase34`，非 C 盘），分支 `ux-audit-phase34`；本批不改 workspace 消费面，故 `verify-worktree-deps` 未触发 |
| 判据域测量先于判据 | ✅ | 探针先跑：`域=877 文件 / 生产面 vue=180 / 声明 props=110`，`store=31 / ref 候选=66`；未接线 6 条、死字段 1 条**逐条 grep 人工核实后**才登记 |
| 自测 | ✅ | `node --test scripts/check-ui-wired.test.js` → tests 10 / pass 10 / fail 0；`node --test scripts/check-field-consumed.test.js` → tests 8 / pass 8 / fail 0 |
| 反证（4 条） | ✅ | A 摘 `stripComments`、B 取消测试面排除、C 把 store 自身源码算进跨文件消费、D 退回被禁的 `(?\\!\\s*:)` lookahead ⇒ 全部 CAUGHT；还原 md5 `uw=49bfaf42 / fc=3f8a2aa1` 逐字节 IDENTICAL |
| 接线 | ✅ | 本体 + 自测接进 `quality-gate.yml` Gate 2b（`shell: bash` fail-fast 档）；`check-workflow-structure.js` violations=0（files=14）、`check-step-failfast.js` 39 个多命令步骤全 OK、`workflow-contract.test.js` 43/43、`check-unwired-tests.js` 域内 110 文件全接线 |
| 静态门禁 | ✅ | `check-max-lines.js` PASS（无新增超限）、`check-locale-sync --keys/--cjk` 不适用本批（未改渲染端文案，仍实跑 PASS）、`check-doc-abs-paths.js` PASS（记录与 workflow 注释一律用占位路径）、`check-no-brand-residue.js` PASS |
| QM-1 / QM-4 | N/A | 本批不改 `apps/desktop/electron/**`、`packages/rpa-engine/**`，也不改任何渲染端视觉面（判据只读 src） ⇒ 打包与像素门禁不触发；理由写在这里而不是留给下一个会话猜 |
| QM-6 双模型 | 未跑 | 本机无 CCG（pre-commit 实测打印「[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁」），如实登记为未执行，不伪造 cleared |

## 一、为什么这两条门禁必须由机械判据承担

审计 §1 的 11 条「已建好但没接上电」里有 4 条（audit-6 / audit-66）的具体形态就是
**组件写好、props 接口定好、全仓零引用**；本仓另有成族记录叫「装饰性链路」：
**字段被写入、从不被读取**（`lastEventAt` 写 4 读 0；审核回查 `task.id` vs `record.id` 恒 `updated:false`）。
两族在人工审查里都不可见，原因相同：**它们各自的测试全绿**。
组件测试自己 import 并挂载它；store 测试自己断言写入后的值。
所以「有测试」在这两类上根本不是证据 —— 只有跨文件引用面才是。

## 二、判据的牙住在装配层（本轮最贵的一条方法论）

两条判据的核心口径都不在纯函数里，而在 `main()` 的**取数过程**中：

- `check-ui-wired`：① 搜索前剥整行注释（否则 TrialBanner 唯一那句注释会被当成消费者）；
  ② 消费者集合排除测试面（否则 110 个有 props 的组件全被自己的用例"引用"）。
- `check-field-consumed`：③ store 自己的 `return { X }` 那一行不得计为消费；
  ④ `{ X: alias } = storeToRefs(store)` 这种带冒号的解构**必须**计为消费。

因此自测必须能**整跑 `main()`**：为此给判据开了 `--scan-root=` / `--debt=` 注入口，
用 `os.tmpdir()` 下的 fixture 树断言「注释-only」与「测试-only」两种假引用都被判死、
真实使用不被判死。**如果只测纯函数，变异 A/B 全都逃得掉** —— 这条是本仓
「注册≠注入≠生效」在自测层的镜像：测了组件不等于测了装配。

## 三、判据自己先错过一次（假阳性，不是假阴性）

`check-field-consumed` 第一版对跨文件消费加了 `\\bX\\b(?!\\s*:)` 的 lookahead，
意图是"别把对象字面量的 key 当消费"。后果是把
`apps/desktop/src/composables/useBacklot.js:69` 的
`const { currentBoard: board } = storeToRefs(store)` 判成零读取 ⇒ `currentBoard` 假红。
发现方式：探针报 3 条死字段后逐条 `grep` 核实，`currentBoard` 明显有消费方。
修法不是"从清单里删掉这条"，而是**去掉 lookahead 并补一条指名用例**
（「跨文件消费三种写法都要认」），使这个形态永久可回归。
同源还有第二条：`dashboardUrls` / `qrCodePlatforms` 也被第一版误报 ——
它们的读取在本文件 getter 里（`return dashboardUrls.value[id]`），
而探针的"读"只算了跨文件 ⇒ 第二条修正：读判据必须**同时覆盖本文件读位置**。

## 四、首版基线与处置归属（不含"顺手清理"）

6 条未接线组件 + 1 条死字段全部**带 reason 登记**，本批一律不处置：

- 删除是不可逆动作（R0 同源纪律），且 `AccountGroupManager.vue` / `PlatformAccountGroup.vue`
  的"未被引用"是 origin/main 的 S1a 重构**取代但未删除**造成的 —— 判定"取代关系"属产品/IA 决策；
- `TrialBanner.vue` 要不要展示、`CardsRenderPanel.vue` 预览面板是否仍要，都需人拍板；
- `lastApprovalDismissed` 是**功能缺陷候选**：写了它却无人读 ⇒ dismiss 实际不抑制任何东西，
  可能表现为"审批提醒反复出现"。已按 QM-5 的五步留作后续 Bug 单来源（本批不同时改两个变量，
  否则门禁有效性与产品修复的归因会互相污染）。

## 五、与本仓既有纪律的衔接

- 退出码三档（0/1/2）+「空域一律非零」+「规模下界」：见「观察器必须报告自己的失明」。
- 清单只可缩小 + 缺 reason 判红 + 陈旧登记判红：见「计数/比例型门禁三条」。
- 接线的落点必须是 fail-fast 的步骤：Gate 3 是 `pwsh` 且多条命令只有最后一条的 `$LASTEXITCODE`
  决定成败，接进去等于新造一条装饰门禁（实测先例见 `check-step-failfast.js` 头注释）。
- `.gitignore` 第 106 行 `scripts/*.js` 静默忽略新脚本（#3011 家族）：4 条反选一次补齐，
  并在注释里写明"漏 negation 时本地跑得通、CI Cannot find module"。

## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`，PR 号见本 PR 页面）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红（change: `ban-record-closure-backfill-pr` / `gate-record-sync-derived-status`）。main push 回读证据写在 PR 评论里，不写回本文件。 |
