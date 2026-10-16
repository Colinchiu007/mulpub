---
record: fix-mavis-trash-env
task: safe-delete.js 的「可恢复删除」外包给本机不存在的 mavis-trash，四道闸全过、--dry-run 允许、实跑必失败而 12 例测试全绿——本机先补命令，随后按用户指示把脚本改为自足（后端解析链内置平台回收站）
date: 2026-10-16
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
---

## 本次执行记录：safe-delete 删除后端 mavis-trash 缺失的根治（fix-mavis-trash-env，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | 改 `scripts/` 工具脚本自身 ⇒ docs-only=false（classify 实测 files=6）。隔离 worktree `D:\Data\projects\mp-worktrees\mp-trash-fix` + 裸分支 `fix-mavis-trash-env`（PowerShell 原生 git 写）；共享根保持 main、dirty=0 |
| 第一性原因（QM-5 ①） | ✅ | **缺陷不是「mavis-trash 没装」，而是设计缺口**：`safe-delete.js` 把 R0 的核心语义「可恢复删除」外包给一个未随仓库交付、未声明出处、**未做存在性检测**的外部命令。根因追溯：`safe-delete.js:169` `cp.spawnSync('mavis-trash', …)`；本仓 ≥11 处记录从 2026-10-09 起登记「本机缺失 ⇒ 真删除恒 rc=1」而长期未修（`fix-agents-safe-delete-filename.md` 遗留项明写「需用户指示后动」）——本轮用户指示「修该命令的环境」，并追加授权「如有必要可改 safe-delete.js」 |
| 逃逸分析（QM-5 ②） | ✅ | **逃逸链**：单元层——`safe-delete.test.js` 12 例全测 `judge()/isInside()` 判据层，删除路径**零覆盖**；结构层——唯一相关锁是字符串存在性（`assert.match(src, /mavis-trash/)`），锁「源码写了名字」不锁「命令可用」；流程层——每次清理都先跑 `--dry-run` 判据全过，FAILURE 只出现在最后一步且被审计日志吸收，会话到此结束 ⇒ 无人跟进。**系统性漏洞分类：测试场景缺失（删除路径零行为覆盖）+ 判据失真（把「能力存在」锁成「名字存在」）** |
| 修复 + 回归保护（QM-5 ④） | ✅ 两层 | ①**脚本自足**（根治）：`deleteRecoverable()` 后端解析链——`mavis-trash`（external，向后兼容已装机器）→ 平台内置（builtin）：win32=PowerShell+`Microsoft.VisualBasic` 送回收站 / darwin=osascript 经 Finder / linux=gio trash；候选逐试，全败返回 `{ok:false,error}` 且**文件原样保留**（绝不退化为不可恢复删除）；判据层四道闸一字未动；CLI 输出与审计日志记录实际 backend。②**本机命令**（兼容加速）：`%USERPROFILE%\.local\bin\mavis-trash.{cmd,ps1}` 回收站包装（`.cmd` 用 `%~dp0` 自定位规避中文用户目录字面量编码陷阱）。回归保护：`safe-delete.test.js` **12→17 例**，全部先红（4 例 RED 实证：13/14/15/17 not ok）后绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | 新锁补上缺失的层：每平台 ≥2 候选且必含 `builtin`（防再次单点外包）；`mavis-trash` 恒排第一（兼容）；注入空后端必须失败**且文件仍在**（防静默假成功）；删除路径禁用 `fs.rm/unlink` 等不可恢复原语；后端解析必须覆盖三平台。**回归锁意图升级**：L166 的字符串锁保留（兼容语义），但「能力可用」改由行为锁承载 |
| 变异/行为反证 | ✅ | **两个实现陷阱都由「真跑 CLI」行为验证抓出、`node --test` 全绿看不见**：① CLI 入口在后置 const `BUILTIN_BACKENDS` 之前 ⇒ 真跑 TDZ（`ReferenceError: Cannot access 'BUILTIN_BACKENDS' before initialization`），而 node --test 只 require 不执行 main ⇒ 17/17 绿的同一份代码 CLI 立即崩 ⇒ 入口移到文件末尾并注释原因；② `powershell -Command <脚本> <路径>` 把实参**拼接进脚本文本**（盘符冒号被当新表达式记号 ⇒ ParserError「意外的标记 D:\...」）⇒ 路径改经环境变量 `MAVIS_TRASH_PATH` 传入。三场景终验：A external 优先 ✅；B PATH 移除 mavis 后自动落 `windows-recycle`（ASCII+中文路径）✅；C 注入空后端 ⇒ 失败且文件保留 ✅ |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 相等（parity=True） |
| 接线棘轮 | ✅ | `check-unwired-tests` OK（测试改动均落在已接线的 `safe-delete.test.js`，未新增未接线文件） |
| TDD | ✅ | 先 4 红（新锁对旧实现 not ok 13/14/15/17）→ 实现 → 17/17；原 12 例未动仍绿 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与任何视觉面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本 PR 判定为 single（见 .ccg/reviews/<HEAD>.json）；如终提交超阈值产生 dual，将按白名单语义执行并落盘裁决。本机 `codeagent-wrapper` 可用但本片属小面工具修复，按 §12.6 阈值判定走引擎决定 |
| 门禁命令取证 | ✅ | `check-gate-record-debt --carrier-mode=visible` rc=0（冻结漂移在 PR 档为可见项：合并预览必然含上游新块，判据本身在 L549-553 写明）；`check-unwired-tests` OK；`check-no-brand-residue` PASS（9370 文件）；行尾 parity=True |
| 已知边界 | ✅ | ① 「可恢复」在 Linux 依赖 `gio`（GNOME 环境标配），无桌面环境的裸 CI/容器上 `gio trash` 会失败 ⇒ 后端链返回失败、文件保留（fail-closed，不静默丢数据）——这是守卫语义的正确行为，不是缺陷；② `mavis-trash` 外部命令保留为第一候选是为了兼容已装机器与未来独立实现，其「缺失不再致瘫」由 builtin 兜底保证；③ Windows 回收站删除极深路径由 PowerShell 的 .NET API 承接，未单测 MAX_PATH 场景（判据层拒目录 ⇒ 深目录不会被整棵送入） |
| 远程同步 | PASS | PR #3695 已 squash 合并，merge SHA `e5e06a23fb035b2cb7b7241a4db55ff23d9c7498`（2026-10-16T04:36:51Z）；远端分支 `fix-mavis-trash-env` 已删（`git ls-remote` 0 行）；`git log origin/main --grep='(#3695)
` 恰好 1 行 |
