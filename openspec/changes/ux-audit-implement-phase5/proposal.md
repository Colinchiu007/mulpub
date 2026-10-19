# Proposal: UX 审计阶段 5.3 / 5.4 两条新门禁（未接线组件 / 死观测字段）

## Why

审计 `01-docs/UX-AUDIT-2026-10-17.md` §1 的核心结论是「机制在、最后一公里没接」共 11 条同一形状，
其中 4 条（audit-6 / audit-66）的具体形态就是**组件写好了、props 接口也定了、全仓零引用**；
另一族记在本仓 learnings 里叫「装饰性链路」：**字段被写入、从不被读取**
（`lastEventAt` 写 4 次读 0 次；审核回查按键错配 `task.id`/`record.id` 恒 `updated:false`）。

两族的共同点是**没有任何东西在检测**：

- 组件的自有测试全绿 —— 测试自己 import 并挂载它，所以「有测试」从不等于「被接上电」；
- store 字段的写入点有日志、有断言，读侧却是零 —— 排障时「有字段」被当成「有消费方」。

靠人每次审查发现，等于依赖自觉；本仓已经四次实测「自觉挡不住」（见 AGENTS.md 删除守卫那条的
同类结论）。所以按审计 §阶段5 落地两条机械门禁。

## What Changes

- 新增 `scripts/check-ui-wired.js` + `scripts/ui-wired-debt.json`：
  `apps/desktop/src` 生产代码面里**声明了 props 且零引用**的 `.vue` ⇒ 判「未接线组件」。
  两条决定判据有没有牙的口径：**剥整行注释**（否则「文档里提到」被读成「代码里在用」）、
  **测试面不算消费者**（否则每个组件都被自己的用例"引用"）。
- 新增 `scripts/check-field-consumed.js` + `scripts/field-consumed-debt.json`：
  store 里**有写动作却无任何读取**的 `ref` ⇒ 判「死观测字段」。
  store 自己的 `return { X }` 清单行**不算消费**（那只是暴露）；
  `storeToRefs` 的重命名解构 `{ X: alias }` **必须算消费**（第一版加了 `(?!\s*:)` lookahead
  在这一格假红过一次，已回归锁化）。
- 两条判据都带**反失明读数**（域文件数 / 组件数 / 候选 ref 数 / 命中数 / 登记数一律打印）
  与**只可缩小的欠账棘轮**（缺 reason、清单被清空、登记陈旧 ⇒ 当场红）。
- 接线：两条判据本体 + 自测接进 `.github/workflows/quality-gate.yml` 的 **Gate 2b**
  （该步骤整体 `shell: bash`，任一非零即中止；接进 Gate 3 等于接进装饰门禁，理由见 workflow 内注释）。
- `.gitignore` 为 4 个新文件补显式反选（第 106 行 `scripts/*.js` 会把它们静默忽略，同 #3011 家族）。

## Impact

-  Affected specs: 新增能力 `desktop-ui-wired-gates`
-  Affected code: 仅 `scripts/`（两条判据 + 两份欠账清单 + 两份自测）+ `.github/workflows/quality-gate.yml`
  + `.gitignore` + 文档。**不改任何运行时行为**，故 QM-1 打包与 QM-4 像素门禁不适用（判据当场声明理由）。
- 首版基线读数（2026-10-19 实跑）：未接线组件 **6**（PlatformIcon / StaggeredList / TrialBanner /
  AccountGroupManager / PlatformAccountGroup / CardsRenderPanel），死观测字段 **1**
  （`stores/backlot.js#lastApprovalDismissed`）。两批**都不在本 change 内处置**：
  删除是不可逆动作、接线属产品决策（TrialBanner 要不要展示、审批提醒该不该被抑制），
  所以先让它"红着并被登记"，把裁决点交给阶段 3.7 / 3.9 批次。
- 其中 `lastApprovalDismissed` 是**功能缺陷候选**：dismiss() 写了它，但生产无人读 ⇒
  「已 dismiss」从未抑制任何东西。已在欠账 reason 里写明，作为后续 Bug 单来源。
