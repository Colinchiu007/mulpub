---
record: ux-audit-toast-a11y-correction
task: 更正审计稿 audit-60 的 harm 陈述（读屏用户听不到 toast）—— 实测 element-plus 2.14.2 的 ElMessage 根节点已硬编码 role="alert"，并据此收窄阶段 4.6 的范围
date: 2026-10-19
---

## 本次执行记录：audit-60 更正（ux-audit-toast-a11y-correction，2026-10-19）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 结果与文件清单见本 PR 正文（改动集只含 `01-docs/UX-AUDIT-2026-10-17.md`、`CHANGELOG.md`、本篇记录）
- 保留门禁：行尾对账 ✅（两口径逐文件一致，34/2 与 34/2）| 品牌残留 ✅（本 worktree 内实测 PASS，扫描 10704 个受管文件）| 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件 | 远程同步 PR #（合并后由门禁推导）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/流程变更 ⇒ 按 AGENTS 分层规则不要求隔离 worktree；本批仍按会话隔离铁律建在 `<仓库父目录>/mp-worktrees/mp-ux-audit-toast-a11y-correction`（裸分支同名），共享根保持 main clean，经 PR 落地 |
| 第一性原因（QM-5 ①） | ✅ | 审计稿把「`aria-live` 只出现 12 次」直接推成「读屏用户听不到成功/失败」。**计数证据是真的，推理断了一环**：它默认"播报只由 `aria-live` 承载"，而没有去问**还有哪条通道在承载 Y**。本例的另一条通道是组件库自己 —— `role="alert"`（隐式 `aria-live="assertive"`）。所以这不是"数少了"，是"换了载体就不成立"。 |
| 逃逸分析（QM-5 ②） | ✅ | ① 审计层：三轮人工/外部评审都读了 finding 的文字，没有一条去 `node_modules` 核 `ElMessage` 的实际 DOM 属性（当时的探针是 grep 本仓 `src/`，天然看不见依赖里的模板）；② 测试层：本仓没有 a11y 语义检查（axe 在 CI 判据里 0 命中），所以"有没有播报"这件事从来没有可执行 oracle；③ 流程层：排期表把 finding 的结论原样抄成任务（「toast 容器补 role」），丢失了"这是待验证主张"的标记。归类：审查盲区 + 测试场景缺失。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `01-docs/UX-AUDIT-2026-10-17.md`：① 在 audit-60 那一节**就地加指针**（不改写原结论，历史是事实快照），声明其 harm 陈述已被否证；② 排期表 4.6 行改为「按实测收窄」，明写「**不得**再叠加第二个 live region 造成双重播报」；③ 文末新增《第三轮更正》给出四条实测读数表（role 出现 1 次值为 alert 且挂在根 div / 5 个 message 实现文件 `aria-` 计数全 0 / `MessageHandler` 只有 `close()` 无 DOM 句柄 / 12 次 aria-live 本身成立）与收窄后的范围。证据全部是**当场跑的取数命令**，下一个会话可一句话重取。 |
| 防止再次发生（QM-5 ⑤） | ✅ | 写进更正段的方法论条目：审计里任何 `X 计数很低 ⇒ 用户得不到 Y` 的句子，动工前必须先回答**"还有哪条通道在承载 Y"**（含依赖库/宿主默认行为）；并把它挂到 AGENTS「宿主 API 字段归属必须先核实」这条既有纪律的**第二个落点**（第一次是读 `electron.d.ts` 判 `getVisibilityState` 不存在，这次是读库的编译产物判 `role=alert` 存在）。同族纪律：任何外部评审/审计给出的主张，先测**可达性**再动工。 |
| 不做的事 | ✅ | **没有**按 4.6 字面去加 `role="status"` 或新 live region（那会造成同一文案双次播报）；**没有**给 `.el-message` 加 `aria-hidden`（框内有可聚焦的关闭按钮，隐藏容器会连带破坏焦点可达性）；**没有**改任何代码 —— 本批是文档更正 + 范围决策，真正该收的"连发打断"面在 `showToast` 单点化（PR #3996）的出口上。 |
| TDD / QM-1 / QM-4 | N/A | 无代码改动，无运行行为变化；无视觉面变化（不改任何样式/模板/文案键）。 |
| QM-6 CCG 双模型外部评审 | 未执行 | pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`；docs-only 通道亦不强制 QM-6。如实记未执行，不以自审冒充通过。 |
| 行尾与 diff 对账 | ✅ | 审计稿工作副本是**纯 CRLF**（830 行 lf==crlf，插入后 862 行仍 lf==crlf，驱动在混行尾时直接抛错）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等（34/2）。**没有**整体改写行尾。 |
| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导；预写 `PASS` 会被 `prematureClaims` 判红 |
