---
record: ux-audit-notify-spec
task: 阶段 2.7 首批——toast 通道的 duration / grouping / 未知 level / 未命中留痕 从"传了没人消费"变成有合同
date: 2026-10-20
sync_status: PENDING
sync_reason: 本 PR 尚未合并；合并后由 scripts/lib/merge-ledger.js 按主干历史推导收口，不手工改写状态词、不另开回填 PR
sync_backfill_owner: 无需回填（派生收口）；旧载体存量行仍由后续会话按既有通道处理
---

## 本次执行记录：toast 通道参数合同（ux-audit-notify-spec，2026-10-20）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/composables/useNotify.js`）⇒ `scripts/start-mp-task.ps1 -TaskName ux-audit-notify-spec` 建隔离 worktree（裸分支 `ux-audit-notify-spec`，基线 `53fe4f0f5`）；`rev-parse --abbrev-ref HEAD` 当场读回本分支名；`pnpm install --frozen-lockfile` + `verify-worktree-deps.js` 均 rc=0（后者打印「消费方解析通过 11 项」） |
| 第一性原因（QM-5 ①） | ✅ | 出口把实参装配成 `ElMessage.success(text)` 这种**只有一个槽位**的糖形态，于是 `options.duration` 从未被读取；而 level 分发写成 `const show = {…}[level]; if (show) show()` ⇒ 未登记的 level 是**静默 no-op**，紧接着仍 `reportNotify(...)` 并 return 文案。两者同源：通道的参数与错误分支都没有消费者 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：既有 10 条 useNotify 用例断言的是"文案对不对、上报没上报、映射对不对"，没有任何一条问"调用方传的 duration 到没到达宿主 API"；②**审查层**：AGENTS 已有「静默配置失败必须留日志」这条纪律，但它当时只约束启动期配置函数，没被当作"未知枚举值"的通用判据；③**运行日志层**：拼错 messageKey 的调用点在日志里零痕迹，`notify:log` 也不记（未命中根本不上报）⇒ 只能靠用户报"这里怎么没提示" |
| 系统性漏洞（QM-5 ③） | ✅ | 测试场景缺失（参数抵达性这一维没进测试面）+ 判据缺失（仓内没有"参数化出口的每个参数必须有消费者"这条口径）。口径已写进 PRD《Toast 通道参数合同》 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一装配出口 `showMessage(level, text, options)`（`duration` 经 `resolveDuration`、`grouping` 恒 `true`）；`resolveDuration`：非法值回落 3000 并出声、超上限夹到 8000 并出声；`maxDurationMs()` **按调用时**读 `MP_NOTIFY_MAX_DURATION_MS`，非法覆盖回落默认上限并出声；未知 level ⇒ `console.warn` 点名 + 按 `info` 展示；非 error 级未命中 ⇒ 按 key 去重出声一次。回归锁 `useNotify.toast-spec.test.js`（8 条，vitest 既有 `src/**/*.test.js` 域自动收集） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①唯一装配点：新增等级必须显式进 `LEVEL_BY_ALIAS`，否则按未知值出声（不做"静默当无事"）；②env 类参数一律调用时读，并由变异 N6 钉住（挪到模块加载即红）；③PRD 合同写明三条禁止项（第二处参数装配 / 未知 level 改回静默 / 用 `duration: 0` 表达"常驻"）；④learnings 6 条含本批最贵的一条（下一条） |

## 本批最贵的一课：改调用形态 = 改契约，验证域必须按消费者取并集

把实参从裸字符串换成 `{message, duration, grouping}` 后，我只跑了改动面的两个文件（34 passed）。按 `git grep -l useNotify` 取到 **21 个测试文件** 的消费者并集全跑才暴露 `usePublishFlow.test.js` 有 **13 处**断言锁着旧形态。

修这些断言时又踩到第二层：**批量改写脚本的正则只认 `toHaveBeenCalledWith`，漏了 `toHaveBeenLastCalledWith`** ⇒ 679 行那条没被改到而变红，但 vitest 报出来的失败**是 685 行的另一个用例**（`addProgress 追加进度条目` 看到模块级单例的脏状态）。归因两次都可能错，所以做了两步控制对照：

1. 只还原 `usePublishFlow.test.js` 到 HEAD（保留实现）⇒ 13 failed / 68 passed = 全是形态断言；
2. 再把 `useNotify.js` 也还原 HEAD（两侧都净）⇒ **81 passed 全绿**。

⇒ 结论：那一条红是**我的实现改动经形态断言级联**出来的，不是既有失败；把匹配器清单扩成 `toHaveBeen(?:Last)?CalledWith` 后 21 文件 **550 passed / 0 failed**。

## 读数（当场实测，非估算）

- 新增 `useNotify.toast-spec.test.js` **8 passed**；`useNotify.test.js`（3 处形态断言同步改写）+ `notifyCore.test.js` 全绿。
- **消费者并集 21 个测试文件：550 passed / 0 failed**（10 文件 236 + 12 文件 314，两次跑合计，同一份代码）。
- 变异电池 **7 道逐条 CAUGHT**，控制趟 `GREEN(20)`，收尾 `RESTORED_byte_exact=true`：N1 关 grouping / N2 摘夹上限 / N3 非法 duration 静默采纳 / N4 未知 level 退回静默 no-op / N5 摘掉未命中留痕 / N6 env 读死在模块加载 / N7 摘掉按 key 去重。红集互不相同（N1 还连带红在既有"notify 命中 key"那条上，因为那条也被我改成看 `grouping`）。
- eslint 零告警；文档面 `git diff --cached --numstat` 为 CHANGELOG 9/0、learnings 11/0、PRD 40/0（全纯插入），审计行 1/1 为就地改写。
- 行尾：本 worktree 的 `CHANGELOG.md` / `learnings.md` 的 **HEAD blob CR=0**、工作副本 CR=23096/21870。我第一版自检查写成"插入后 CR 必须仍为 0"，把一次**正确**的插入判成失败（写入只给我的新行用 LF，未碰任何既有行的行尾）。正解判据只有一条：`git diff --cached --numstat` 的**删除数为 0**；CR 只要求"前后不变"。

## QM-6：proposer 后端 opencode 仍被 IP 信誉封锁

`node scripts/ccg-review-decider.js`（不带 `--base` 判暂存区；带 `--base origin/main` 在**未提交**时会因 `origin/main...HEAD` 为空而报"未判定"，那不是"无需审查"）⇒ **mode = DUAL**（260 行 > 200 行阈值，4 源文件，无敏感命中），要求后端对 `critic=claude / proposer=opencode`（取 `scripts/ccg-review-backends.list`）。

- **proposer 不可用**：`opencode run --model opencode/big-pickle` 秒回 `OpenCode's free models aren't available from your current network because we've detected abusive traffic from this IP address`，**rc=0 但零产物**；与 `ux-audit-token-aliases` / `ux-audit-stable-keys` 同一 IP 级封锁，换模型名无效。
- **规定驱动在本 worktree 也跑不起来**：`sh scripts/deep-review.sh` 直接 `✗ 找不到 ccg-deep-review.js` 并建议「设置 CCG_ARL_DIR 指向引擎目录」，而该脚本自己的注释承认这个变量在 Process/User/Machine 三级作用域都不该被去找（它是误导项）。真正可用的路径是把 `CCG_ARL_DIR` 指到 gitignored 的**已打补丁引擎副本的 `scripts` 目录**（`CCG_ARL_DIR` 的取值是"目录/ccg-deep-review.js"，所以必须指到 `.../arl-patched/scripts`，指到技能根会二次失败）。在 accounts 单元上这条路已经跑通并产出了 critic 结论（见 `openspec/records/ux-audit-accounts-text-tokens.md` 同日第二轮）。
- 本单元**不使用** `self_play_resolved` 冒充闭环（AGENTS 明写那一条"外部模型一个都没跑也可能判绿"），`deepReview.status` 保持 `pending`，产物不手工改写；proposer 缺位与三条出路（等 IP 封锁解除 / 订阅 OpenCode Go / 改 backends 清单属"改谁来守门"）随 PR 上报人工裁决。


## 遗留（不假装已闭合）

1. 「`ElMessage` 直用 85 处按文件收编 + 只可缩小棘轮」未做 —— 新清单需人工批准（AGENTS 新门禁上线三步序）。本批只保证**新代码**没有第二处参数装配出口（`showMessage()` 单点）。
2. toast 容器的 `aria-live` 礼貌级分档属审计 4.6，与本条正交，未做。
3. `level` 的合法值集合仍只有代码里一张表；若要把"调用点用了表外的 level"变成 CI 判据，属新增门禁，需人工批准。

| 远程同步 | 由门禁推导 | 状态列不手写：合并后由 scripts/lib/merge-ledger.js 按主干历史推导收口；合并证据回读写在 PR 评论里，不写回本文件（AGENTS 2026-10-18「禁止记录收口回填 PR」） |

- 保留门禁：行尾对账 ✅（纯插入，删除数为 0）| 品牌残留 随 CI（本批未写竞品名）| 文档同步 随 CI doc-gate | 受管文档绝对路径 随 CI Gate 12c（本记录一律用 `<仓库父目录>` 占位）| 执行记录载体 ✅（`openspec/records/ux-audit-notify-spec.md`）| 远程同步 PR 待创建

## 第二轮（2026-10-20，QM-6 critic 轴 5 条 + CI 红的真实成因）

- **评审通道**：`CCG_ARL_DIR=<仓库父目录>/Mulpub/.adversarial/arl-patched/scripts` + `node .adversarial/arl-patched/scripts/ccg-deep-review.js --sha 9bd3e6db…`（cwd 必须是被审 worktree，引擎 `REPO = process.cwd()` ⇒ 产物落对地方）；提交判定 DUAL（315 行）。critic=claude 真实交付 9 条问题 / 4 维度 / 最低分 7；proposer=opencode 跨家族校验通过；**裁决**为引擎自扮演出口（`adjudicatedBy=self-play`、`confidenceWeight=0.6`、`requiresExternalReview` 本轮 0 条）。5 条逐条填写完毕（全 upheld；i1 的辩护与 i5 的行为半区被现场取证否证），原件 `.adversarial/ccg-deep-9bd3e6db/`，入库副本 `.ccg/reviews/plan-review-9bd3e6db-{critique-v1.md,adjudication.json,family-snapshot.json}`。
- **代码变更**：`useNotify.js`（删除 env 覆盖通道 → 常量上限 `DEFAULT_DURATION_MS=3000` / `MAX_DURATION_MS=8000`；两类成因分别归因 + `成因|key` 去重 + `WARN_DEDUP_CAP=200` + `__resetNotifyDiagnostics()`；诊断串改 ASCII；`notifyConfirm` 未命中留痕；JSDoc 去掉 `confirm` 合法值）；`useNotify.toast-spec.test.js`（+4 条：源码反向锁 / 成因归因 / 去重上界 / confirm 留痕）；消费者断言批量改写 9 个测试文件 63 处（另 2 处退回字符串半区）。
- **为什么第一轮没发现 CI 会红**：第一轮把验证域取成"含 `useNotify` 字样的测试文件"，这是**按引用文本取并集**，而真实消费者是"渲染了用 useNotify 的组件"的测试 —— 结构性漏掉。本轮一律跑桌面 `src` 全量。
- **取证读数**：`node .github/scripts/check-locale-sync.js --cjk` → `CJK scan PASS（基线 1330 条，当前 1125 条，无新增硬编码）`；四个曾红的文件定点 152 passed；`npx vite build` rc=0（产物取证用）；桌面 `src` 全量（`npx vitest run src`，`Duration 778.89s`）→ `Test Files 2 failed | 385 passed (387)` / `Tests 2 failed | 6147 passed | 2 skipped (6151)`。**两条失败与本次改动无关**：`src/overlay-view-suspension.test.js` 与 `src/shell-mode-6b.test.js` 读 `electron/preload/index.bundle.js` 的 ENOENT，该文件在 `.gitignore:443` 里是**构建产物**（全新 worktree 天然没有）；`node scripts/build-preload.js` 生成后这两个文件 `29 passed / 29` ⇒ 本次改动零失败。
- **待人工/产品裁决（不代拍）**：toast 时长要不要给用户设置项（本轮只删了假 env 通道）；审计 2.7 余量「85 处直连 `ElMessage`」的收编与只可缩小棘轮（新门禁需人工批准）。
- **合并状态（由引擎自己落，不手改）**：重跑引擎走「复用存档 critique + 已填裁决」短路（**零模型调用**）回填 `.ccg/reviews/9bd3e6db….json` → `status=self_play_blocked`、`blocking=5`、`requiresExternalReview=[]`。引擎口径是「`verdict=upheld` 一律算阻断，自扮演无权豁免」，**与"这条是否已经修完"无关** —— 5 条修订都已落在本 PR。所以 `check-pr-exec-record.js --mode=enforce` 判未闭合 ⇒ **不自动合并**，合并决定交回人工；正解是补跑一轮真外部评审（2026-10-20 当天 claude 轴可出货），而不是把 status 改成闭环词。
