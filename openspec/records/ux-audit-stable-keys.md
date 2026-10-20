---
record: ux-audit-stable-keys
task: 阶段 4.8 首批——把列表键从数组下标换成条目身份（只改"子树持有 DOM 状态"的那一类）
date: 2026-10-20
sync_status: PENDING
sync_reason: 本 PR 尚未合并；合并后由 scripts/lib/merge-ledger.js 按主干历史推导收口，不手工改写状态词、不另开回填 PR
sync_backfill_owner: 无需回填（派生收口）；旧载体存量行仍由后续会话按既有通道处理
---

## 本次执行记录：列表稳定键首批（ux-audit-stable-keys，2026-10-20）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/**`）⇒ 由 `scripts/start-mp-task.ps1 -TaskName ux-audit-stable-keys` 建隔离 worktree（`<仓库父目录>/mp-worktrees/mp-ux-audit-stable-keys`，裸分支 `ux-audit-stable-keys`，基线 `53fe4f0f5`）。`rev-parse --abbrev-ref HEAD` 当场读到 `ux-audit-stable-keys`；依赖链 `pnpm install --frozen-lockfile` + `ensure-electron.js` + `verify-worktree-deps.js` 三档 rc=0，后者打印「消费方解析通过 11 项」 |
| 第一性原因（QM-5 ①） | ✅ | `v-for` 的键取了数组下标。键在 Vue 里决定**节点与条目的对应关系**，下标键把这份对应关系交给"位置"；批量创作弹窗的文案行又恰好是唯一一类"每行有模型不拥有的状态"的列表（textarea 的焦点、光标、撤销栈、IME 合成串都在 DOM 上）。因此缺陷不是渲染错，而是**用户正在交互的那个节点被卸载** |
| 逃逸分析（QM-5 ②） | ✅ | ①**类型/单测层**：此前没有任何用例断言"删除靠前条目后，正在编辑的那个 DOM 节点还在"，既有 9 条批量创作用例只断模型值（值确实一直是对的）；②**像素层**：结构截图里文字正确 ⇒ 完全失明；③**审查层**：审计把 4.8 记成"38 处计数任务"，按计数做完就算完，没有按"有没有 DOM 状态"分类，于是真缺陷被埋在卫生项堆里 |
| 系统性漏洞（QM-5 ③） | ✅ | 测试场景缺失（焦点/节点身份这一维没进测试面）+ 判据缺失（仓内没有"位置键是否有害"的分类口径，只有条数）。本批把口径写进 PRD《列表键必须是条目身份》第一节的两栏表 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `useBatchCreate.js` 真源改为带身份的行 `state.s2vBatchTextRows`，对外仍给 `s2vBatchTextsView`（`Object.freeze`）；三个行操作 `add/remove/setS2VBatchTexts` 是唯一写口；`CreateView.vue` 模板 `:key="row.id"` + `v-model="row.text"`，图片两处按本文件既有先例改 `img.preview \|\| i`；`ReferenceFinder.vue` 在"离开第三方响应的第一站"给每行分配 `_rid`（接口无 id 且 url 可重复/需再过 safeHttpUrl），键与 `data-testid` 都用它。回归锁：`CreateView.batch-create.test.js` 新增 3 条（节点身份存活 / 派生视图只读 / 结构锁扫源码键形态）+ `ReferenceFinder.test.js` 新增 2 条（行身份存在且互不相同 / 键不得退回位置形态） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①结构锁锚点带**命中数下界**（命中 0 处判"扫描器失明"而不是"已收敛"）；②反向锁按**形态**匹配（`\w+` 位置别名）而不是硬编码变量名 `idx`，换名也拦得住；③派生视图冻结把"静默丢写"变成当场抛错，并有 `Object.isFrozen` + 写它必须抛 + 写完原值不变三条断言；④PRD/learnings/审计行都写明"启发式只用于缩小候选集，定罪必须逐个读现场"（假阳率实测 1/5） |

## 读数（当场实测，非估算）

- 该文件 `CreateView.batch-create.test.js` **12 passed**（既有 9 + 本批 3）；`ReferenceFinder.test.js` **9 passed**（既有 7 + 本批 2）。
- **消费者并集**（`git grep -l -e useBatchCreate -e s2vBatchText -e batchCreateRefs` 取得，不是"我改过的文件"）：5 个测试文件 **333 passed / 0 failed**。
- **变异电池 6 道逐条 CAUGHT**，控制趟 `GREEN(21)`，收尾 `RESTORED_byte_exact=true`：M1 键退回下标 / M2 写进派生视图 / M3 取消行身份分配 / M4 图片键退回 `i` / M5 结果行键退回位置形态 / M6 摘掉 `Object.freeze`。红集互不相同。
- eslint 5 个受影响文件零告警。
- 行尾对账：`CHANGELOG.md` 与 `01-docs/learnings.md` 的 `git diff --cached --numstat` = **9/0 与 13/0**（纯插入），与 `--ignore-cr-at-eol` 同口径逐文件相等。

## 我自己的两处错误（如实登记）

1. **把 CRLF 写进了 LF blob**。`CHANGELOG.md` / `01-docs/learnings.md` 的 HEAD blob 实测 `CR=0`（纯 LF），而工作副本呈 CRLF。我第一版插入脚本"逐行保留工作副本的 `\r`"，结果 `git diff --numstat` 报 **23008 增 / 22999 删**——整份文件被判为逐行改写，正是 AGENTS 里"幽灵行"那一条。当场按精确路径 `git restore --source=HEAD --worktree -- CHANGELOG.md 01-docs/learnings.md` 退回（未用宽目录、未用 stash），再按**基线形态**（blob 是 LF ⇒ 写 LF）重插，`--numstat` 两口径回到 9/0 与 13/0。教训形式：动手前测的必须是**将要提交的那一侧**（blob/索引），只测工作副本会得出反向结论——这与 2026-10-19 记的"行尾必须分源量（HEAD blob / 索引 / 工作副本）"是同一件事的第三次落地。
2. **变异期望清单写错 + 解析器只认 `ms`**。M2 我预测由「s2vBatchTexts 仍是字符串数组」那条契约用例抓，实跑它绿——因为 computed 缓存让"写到派生数组"在下次读时看起来成功；真正红的是两条启动用例。同时第一版红名解析用 `\d+ms`，vitest 对 >1s 的用例打 `1.4s`，于是把"解析没匹配"读成"这条变异没生效"（第一轮整批 `PROBE_BLIND`）。两条修法：改正期望并把"这条锁抓不到什么"写进驱动注释；单位改 `(ms|s)` 并加一条"kind=RED 但红名为 0 也要打印原始输出"的自失明出口。M2 的结论进一步促成把派生视图冻起来（M6），让那格静默丢失变成抛错。

## QM-6：双模型外部评审——proposer 后端本日仍不可用（如实记，不改写产物）

- `node scripts/ccg-review-decider.js --base=origin/main` ⇒ **DUAL**（217 行 > 200 行阈值；5 源文件；无敏感命中），审计产物 `.ccg/reviews/6e432795….json` 由 pre-commit 生成并自动 stage。
- 判定期望的后端对取 `scripts/ccg-review-backends.list`：**critic=claude / proposer=opencode**。
- **opencode 实测不可用**（同 `ux-audit-token-aliases` 单元）：`opencode run --model opencode/big-pickle` 返回 `OpenCode's free models aren't available from your current network because we've detected abusive traffic from this IP address`，rc=0 但**零产物**（判成功只看产物）。本机未走代理（路由器透明代理、本机无监听、git 全局无 proxy），所以不是"代理没关"那一类病因，**换模型名不解决 IP 级封锁**。
- 因此本单元的 `deepReview.status` **保持 pending，不手工改写**，也不得写 `performedBy` 里含 `opencode`（`check-pr-exec-record.js` 按符号集对账，那属伪造）。三条出路（等 IP 封锁解除 / 订阅 OpenCode Go / 把 proposer 换成可用后端并承认它是**改「谁来守门」**）都需人工裁决，已随本轮上报。

## 遗留（不假装已闭合）

1. `loading="lazy"` 那一半未做，理由与前置取证写在上文审计行 4.8 与本节 §边界；必须先确认像素采集器是否滚动全页。
2. 剩余 41 处位置键未逐个裁定。已判定的是"子树无 DOM 状态 ⇒ 位置键可接受"这一类**不是缺陷**，但仓内没有机械判据能区分它们与未来新增的真缺陷。
3. 全仓 `index-key` 棘轮**需要人工批准**（AGENTS 新门禁三步序），本批未建。
4. `ReferenceFinder.vue` 仍有 imperative 改样式（`@mouseover="e => e.target.style…"`）。我原本为它写了行为用例，**修复前就绿**——因为两次搜索之间 `searching` 会把结果块整体 `v-if` 掉再重建，节点必然全新挂载，"旧条目样式残留在新条目上"这一形态在该组件结构性不可达。该用例已删除，imperative 样式改造另批处理（它需要一个 `<style>` 规则与真浏览器 hover 取证，不是本单元的键问题）。

| 远程同步 | 由门禁推导 | 状态列不手写：合并发生后由 scripts/lib/merge-ledger.js 按主干历史（哪个带 (#NNNN) 尾注的已合并提交最近一次把这篇记录带进 main）推导收口。合并证据回读写在 PR 评论里，不写回本文件（AGENTS 2026-10-18「禁止记录收口回填 PR」）。 |

- 保留门禁：变更类型与隔离 ✅（运行时代码 ⇒ 隔离 worktree + 裸分支）| 行尾对账 ✅（CHANGELOG 9/0、learnings 13/0，两口径逐文件相等）| 品牌残留 随 CI（本批未写竞品名）| 文档同步 随 CI doc-gate | 受管文档绝对路径 随 CI Gate 12c（本记录一律用 <仓库父目录> 占位）| 执行记录载体 ✅（openspec/records/ux-audit-stable-keys.md）| QM-6 双模型 ⛔ 未闭合（proposer=opencode 被 IP 信誉封锁，详见上节）| 远程同步 PR 待创建
