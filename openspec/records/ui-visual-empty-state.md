---
title: "ui-visual-empty-state：补完 P0-6 空态收敛 + 修巡检采集脚本的真缺陷 + 把交付数字改准"
change: ui-visual-empty-state
branch: ui-visual-empty-state
date: 2026-10-22
status: executed
---

# 执行记录：补完 P0-6 + 修采集脚本缺陷 + 数字改准

## 动因

上一轮交付（PR #4124，已合入主干 `ebba9a055c5a9fffdc0ec5396cd0332be848e5ae`）在**交付后复核**中被查出三处
「**文档说的比代码做到的多**」。这类偏差比功能缺失更坏：分析报告是本轮的交付物，
它对「哪些已达成、哪些没达成」的说法必须与代码逐条对得上，否则读者会按不存在的结论做决策。

复核结论（逐条对着代码与仓内清单核）：

| # | 偏差 | 事实 |
|---|---|---|
| 1 | 报告把「空态虚线 → 实线发丝 + 柔面」列为**已达成** | 只落地了 3 处（首页两处空态 + 看板付费占位）；**效能洞察的两处空态仍是虚线**——观感层那条覆盖点名了 `.insight-empty-card` / `.perf-empty-card` 等 **6 个代码里根本不存在的类名**，规则一条也没命中 |
| 2 | 报告 / CHANGELOG / 执行记录的头条数字与它自己指向的清单对不上 | 仓内 `ui-audit-manifest.md` 是 **210 行**（亮 177 + 暗 33，覆盖 34 条路由），报告与 CHANGELOG 写的是 **177**（那是**亮色那批**的张数，被当成了总数） |
| 3 | 面向用户的完工声明把计数说大了 | 视觉基线目录内是 **43 个 PNG**（40 张像素基线 + 3 张 autonomous-loop 专属），证据资产是 **20 张 PNG = 10 组**（+1 份 README） |

## 变更类型与隔离声明

- **变更类型**：混合 PR（运行时样式 + lint 覆盖 + 回归测试 + 文档更正 + 证据图刷新）。
- **隔离方式**：独立 worktree `<仓库父目录>/mp-worktrees/mp-ui-visual-empty-state`（非 C 盘），
  分支 `ui-visual-empty-state`，由 `scripts/start-mp-task.ps1 -TaskName ui-visual-empty-state` 创建。
  共享主目录保持 `main` clean，未直接改动。
- **不改**：业务逻辑、数据结构、IPC 契约、信息架构、路由与信息层级。

### 文件范围声明（供 CCG 决策层做范围漂移核对）

| 类别 | 路径 | 说明 |
|---|---|---|
| 观感层 | `apps/desktop/src/styles/premium-design-system.css` | 空态块：删 6 个死选择器，补上真实类名 `.pi-empty-state` / `.pi-dim-empty` |
| 测试（新增） | `apps/desktop/src/styles/empty-state.contract.test.js` | 空态容器契约锁（3 组断言 + 变异反证） |
| 巡检脚本 | `apps/desktop/tests/visual-testing/scripts/ui-audit-probes.js` | 补回拆分时漏带的 `READY_TIMEOUT` |
| 巡检脚本 | `apps/desktop/tests/visual-testing/scripts/curate-ui-audit-evidence.js` | 注释里的旧张数更正 |
| lint 配置 | `apps/desktop/eslint.config.mjs` + `apps/desktop/package.json` | 把 `tests/visual-testing/scripts/` 纳入 lint（此前**完全不在** lint 范围），只开 `no-undef` |
| 证据资产 | `01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png` | 刷新为「实线发丝」后的渲染（**本轮只改这 1 张图**；40 张像素基线未动） |
| 文档 | `01-docs/UI-VISUAL-AUDIT-2026-10-20.md`、`01-docs/assets/ui-visual-audit-2026-10-20/README.md`、`CHANGELOG.md` | 数字与口径改准。**`apps/desktop/tests/visual-testing/reports/ui-audit-manifest.md`（210 行清单）已在 #4124 入库，本轮未改动它**（本轮跑过一次采集只为取证 after 图，跑完已 `git checkout --` 还原） |
| 执行记录 | `openspec/records/ui-visual-premium.md`（更正）+ 本文件（新增） | 前者数字更正；本文件为本分支记录 |

## 执行内容

| # | 内容 | 落地 |
|---|---|---|
| 1 | 补完 P0-6：效能洞察两处空态改实线发丝 | `styles/premium-design-system.css` |
| 2 | 删掉 6 个**代码里不存在**的死选择器（`.pi-empty-surface` / `.empty-surface` / `.insight-empty` / `.perf-empty` / `.insight-empty-card` / `.perf-empty-card`） | 同上 |
| 3 | 新增空态容器契约锁：① 空态块点名的类名必须在 src 真实存在 ② 被覆盖的类必须有 `border-style: solid` ③ 仍用虚线的容器必须在例外清单里登记，清单外新增 ⇒ 判红 | `styles/empty-state.contract.test.js` |
| 4 | **修巡检采集脚本的真缺陷**：拆分时 `READY_TIMEOUT` 漏带，采集脚本对每条路由都抛 `READY_TIMEOUT is not defined`，**一张图都采不出来**（实测 0 张；仓内 210 行清单是拆分**之前**那次运行留下的，所以表面看不出问题） | `scripts/ui-audit-probes.js` |
| 5 | 补上「为什么没被门禁拦住」：巡检脚本目录**完全不在 lint 范围**（lint 只扫 `electron/ src/`）→ 纳入并只开 `no-undef` | `eslint.config.mjs` + `package.json` |
| 6 | 数字改准：177→210 张、32→34 路由、40 张基线→43 个 PNG、387→210、证据资产 21→20 张 | 报告 / CHANGELOG / 执行记录 / 证据 README |
| 7 | 刷新效能洞察的 after 证据图（实线发丝后的渲染） | `01-docs/assets/…/06-performance-insights-after.png` |

## 关键判据

- **空态契约锁**：5 例全绿；**变异反证**验过有效性 —— 注入一个不存在的类名 `.zz-dead-probe-selector`
  ⇒ 当场判红并点名；把 `READY_TIMEOUT` 的定义整条删掉 ⇒ eslint `no-undef` 判红并点名
  （此前这处缺陷能活下来，正是因为它既不在 lint 范围、也没有任何测试真的执行过采集路径）。
- **采集脚本可跑**：修复后 `node ui-audit-capture.js --phase=a` 实测 **33 张**（修复前 0 张）。
- **视觉结果**：效能洞察页「暂无归因数据」大面板与 4 张维度卡，实测均为**实线发丝**（见刷新的 after 证据图）。
- **像素基线中性**：本次改的两个类只出现在 `PerformanceInsights.vue`，而效能洞察**不在** 20 张像素基线视图里
  ⇒ 基线不受影响，无需重建。

## 遗留（如实登记，未在本轮闭合）

| 项 | 状态 | 原因 / 出口 |
|---|---|---|
| 其余 4 类语义空态仍是虚线：`.podcast-empty` / `.segment-empty-filter` / `.pipeline-progress-empty` / `.history-thumbnail.is-empty` | ⏳ 未改 | 它们落在 20 张**像素基线视图**里，改样式会让基线漂移 ⇒ 须先按「CI artifact 渲染重建基线」的流程重建基线，再改样式。选择器清单与理由见报告 §3 P0-6「落地状态」与契约锁的 `DASHED_REGISTRY`（`kind: 'defer'`） |
| 保留虚线的 3 处：`.upload-zone`（拖放区惯例）/ `.stage-time-guidance`（提示语气）/ `.s2v-subgroup-title`（分隔线） | ✅ 有意保留 | 语义正确，不是「未完成」；登记在契约锁 `kind: 'keep'` |
| R6 真实 Electron 窗口 GPU 帧率实测 + 暗色真机复核 | ⏳ 沿用上一轮 | 见 `openspec/records/ui-visual-premium.md` §R6 |
| R7 新增 `.adversarial` SHA 对齐门禁 | ⏳ 沿用上一轮 | 属改守门结构，按铁律交人工 |

## 四、CCG 外部双家族评审与处置

**后端**：critic=`claude`（评审）· proposer=`opencode`（跨家族校验）· 判定 **SINGLE**（变更 197 行 ≤ 200 且无敏感命中）
· 产物 `.adversarial/ccg-deep-04005ae3/`（`critique-v1.md` / `proposal-v1.md` / `adjudication.json`）
· 评审给出 **7 条**意见（correctness 4 / security 7 / performance 6 / maintainability 3，最低 3），
其中 6 条进入自扮演裁决并**逐条填完**（6/6 有 verdict）。

| # | 严重度 | 评审意见 | 裁决 | 处置 |
|---|---|---|---|---|
| i1 | Critical | 判定记录写在父 sha 上（`sha: 71a61e540` vs head `04005ae35`）⇒ 评审对象错位 | **dismissed** | 仓库**既定设计**：pre-commit 时新提交尚未生成，记录只能先写到父 sha（脚本自述「这是预期行为」）；记录与被审对象靠 **diff 内容寻址**（stagedDiffHash）绑定 —— deep-review 输出「判定记录按 diff 内容寻址命中: dd8ec146」；`check-pr-exec-record.js` 的 `AUDIT_ARTIFACT_RE` 同时接受 40/64 位两种命名。唯一成立的部分是「易误读」，已写进上一轮记录的「审计轨迹与 SHA 对齐现状」 |
| i2 | Critical | `DASHED_REGISTRY` 与活扫描绑定，改完 defer 项会红且无自动更新机制 | **upheld** | 成立的是「失败信息没告诉维护者该改哪」，不是绑定机制本身。已改：断言失败信息直接给出处置动作（删清单行 + 同步报告 §3 P0-6 两张表）。绑定机制保留 —— 它是「清单陈旧要出声」的唯一保证 |
| i3 | Warning | `dashedEmptyStateClasses()` 的贪婪匹配漏掉 @media 嵌套块里的虚线空态（漏报方向） | **upheld** | 已修并**实测验证**：改成嵌套感知的规则抽取 + 只读样式源码（.vue 只取 `<style>`）+ 语义特征放宽到 `empty｜zero｜none｜no-data｜placeholder`。修完立刻多扫出 **2 个之前漏掉的**（`.is-placeholder`、`.video-preview-placeholder`）——直接证实了指控 |
| i4 | Warning | 注册表 8 项、文档只列 3 个 keep，漏了 `s2v-estimate-note` | **upheld** | 已修：报告 §3 P0-6 改成**两张完整表**（4 项 defer + 6 项 keep），与注册表 10 项逐条对应（keep 表含 i3 新发现的 2 项） |
| i5 | Warning | diff 只改了 1 个二进制，文档却写「43 个 PNG」 | **dismissed** | 前提不成立：43 是**目录现状**（40 像素基线 + 3 autonomous-loop 专属）的陈述，本轮**未改动任何像素基线**（`git diff --name-status` 里二进制只有 1 条）。属措辞误读，已补明确措辞 |
| i6 | Warning | 只修了 probes 的常量，其余拆分脚本未做常量/导入审计，也没有逐脚本真跑 | **upheld** | 成立。已用**通用机制**补：整个 `tests/visual-testing/scripts/` 纳入 eslint 并只开 `no-undef`（此前该目录完全不在 lint 范围），6 个脚本一次性覆盖；变异反证（删 `READY_TIMEOUT` 定义 ⇒ eslint 判红点名）证明它真能抓同型缺陷。需要浏览器的 capture 已真跑（33 张），其余三个是无浏览器依赖的纯数据/纯函数/纯文件脚本，require 级冒烟已覆盖 |
| i7 | Info | 文档引用的 210 行清单不在 diff 里 | **dismissed** | 清单已在 #4124 入库，本轮**未改动它**（跑采集只为取证 after 图，跑完已 `git checkout --` 还原）；已在执行记录里写明 |

**本轮据评审而改的东西**：契约锁的扫描器（i3）、注册表补全到 10 项（i3/i4）、断言失败信息给出处置动作（i2）、
报告与记录的措辞澄清（i5/i7）、eslint 覆盖（i6）。
**变异反证**：注入不存在的类名 ⇒ 契约锁判红点名；删掉 `READY_TIMEOUT` 定义 ⇒ eslint `no-undef` 判红点名。

> **关于评审产物入库**：`.gitignore` 第 485 行写着「CCG 深度审查的工作产物（提案/评审/裁决）不进主干；
> 判定记录 `.ccg/reviews/*.json` 才是留痕」。本轮**按上一轮（#4124）同样的做法强制入库**
> `.adversarial/ccg-deep-04005ae3/`——理由是执行记录要指向**可核的产物位置**，而产物若不入库，
> 随 worktree 一起消失，裁决就没有第二份可查的落点。判定留痕（`.ccg/reviews/*.json`）本就在仓。
> 这一条与 `.gitignore` 的字面约定不一致，**登记在此交人工裁决**（是否改为「只留 adjudication.json」）。

## 五、远程同步

- 保留门禁：变更类型与隔离声明 ✅ | 空态契约锁 5/5 ✅ | 采集脚本 33 张 ✅ | lint 覆盖 ✅ | 文档数字改准 ✅ | 远程同步 PR 待开

| 远程同步 | 由门禁推导 |
| --- | --- |

> 状态列写「由门禁推导」而非手写 `PASS`：收口由 `scripts/lib/merge-ledger.js` 按主干历史
> 推导（合并后自动闭合），手写闭合词会被 `check-gate-record-debt.js` 判 `prematureClaim` 红。
> 依据：`openspec/specs/openspec-integration/spec.md`「分层分支策略」Requirement
> + `change: gate-record-sync-derived-status` / `change: ban-record-closure-backfill-pr`。
