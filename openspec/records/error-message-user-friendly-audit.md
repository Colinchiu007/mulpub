---
task: 修复历史记录失败卡片直出英文技术原文（Input media exceeds the total size limit），建立用户可见失败的稳定错误码契约并做全量排查
branch: error-message-user-friendly-audit
worktree: <仓库父目录>/mp-worktrees/mp-error-message-user-friendly-audit（D 盘非 C 盘）
base: 42ba5860f（当时 origin/main）
date: 2026-10-20
delivered_by_pr: 4062
---

# 本次执行记录：用户可见失败信息友好化 + 稳定错误码契约（error-message-user-friendly-audit）

## 远程同步

| 项 | 值 |
| --- | --- |
| 远程同步 | 由门禁推导（PR #4062，分支 `error-message-user-friendly-audit`，提交 `b18e2b73d`） |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 债务预算 ✅ | unwired 棘轮 ✅ | 远程同步 PR #4062

## 1. 用户原始诉求

> 视频创作-历史记录中-执行失败标签，任务卡片上的失败原因，显示"Input media exceeds the total size limit"
> 这是 API 接口返回的实际信息吧？没有做用户友好化的处理。
> 之前就在项目中制定过原则：所有的提示或报错信息，都应该用用户友好的自然语言说明，并给出建议或解决方法。并且文字要支持多语言版。
> 这个情况怎么又违法了原则？查一下为什么不进行处理。并且进行全部提示和错误信息的排查。
>
> • 如果修改代码，以独立分支/worktree 隔离本次修复，在非 C 盘上进行。
> • 把有价值的内容保存到内置记忆、外部记忆和 EverOS 中；
> • 相关更新内容，要补充进 PRD 和相关文档，尽量写详细，包括数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字以及其他相关的，都详细写出来；
> • 应用质量节拍 Skill；
> • 推送 github，创建 PR，CI 通过后自动合并分支；

## 2. 变更总览

| 维度 | 读数 |
| --- | --- |
| 改动文件 | 29 个（20 改 + 9 新增） |
| 代码改动 | 4 个主进程文件 + 6 个渲染端文件 + 1 个 workflow + 1 个 .gitignore |
| 新增门禁 | `scripts/check-compose-error-codes.js` + 自测 7 例，接入 `quality-gate.yml` Gate 12g |
| 新增测试 | 26 例（含门禁自测 7 例，6 道变异反证） |
| 新增 locale 文案 | 8 条（6 条错误文案 + 2 个兜底标签），zh/en 成对 |
| 新增文档 | 详版 PRD + BUGFIX 复盘 + openspec change 四件套 + 执行记录 |
| 隔离 | 独立 worktree `<仓库父目录>/mp-worktrees/mp-error-message-user-friendly-audit`（D 盘），裸分支 `error-message-user-friendly-audit` |

## 3. 根因（第一性原因）

`story2video-compose-engine.js` 预检分支把英文技术 message 当作唯一失败载荷，四层逃逸链缺一不可：

1. 主进程无稳定 `errorCode`；
2. `stage-executor.js` COMPOSE 失败分支只透传 `error` 字符串；
3. `pipeline-engine.js` `_finalizeRun` 与 `run-state-store.js` 快照只存 `error`；
4. `pipeline-error-formatter.js` 的「长度 < 120 且无技术标记 ⇒ 透传原文」分支把 41 字符的英文技术句判成自然语言。

**系统性漏洞**：三套渲染路径都靠匹配英文原文还原语义——这不是"漏改一处"，是契约缺失。归因：2026-08-11 整改只覆盖 IPC 拒绝路径；2026-08-19 只修 `{sceneText}` 占位符；CJK 门禁不扫 `apps/desktop/electron`。

## 4. 关键设计决策

| 决策 | 理由 |
| --- | --- |
| `run.error` 保持字符串契约 | 恢复门控 `RESUME_BLOCKING_ERROR_PATTERN` / 阶段摘要 / `getHistory()` 都读字符串；结构化字段另起 `run.errorCode` / `run.errorParams` |
| 错误码 → locale key 用显式映射表 | 第一版用字符串推导（`replace(/^COMPOSE_/,'compose_').toLowerCase()`），拼错会静默渲染成 i18n key 原文 |
| 三个时长码不合并 | 单段/成片/旁白三者的用户建议不同（拆分该段 vs 缩短文案）；requested/composed 与成片建议相同故复用 |
| 保留「短自然语言直出」分支 | `PROMPT-TEXT-SPEC.md` 要求「已是自然语言的原因文本原样透传保留信息」，删掉会让「排期失败：任务不存在」退化成通用文案 |
| 门禁住 `changes` job | 输入含 `locales/**` 与 `src/**`，只改文案的 PR 会被判 docs-only 短路 `static-gates` |
| 兜底词走 locale 不硬编码 | 第一版硬编码「该场景/允许上限」被 CJK 门禁当场判红（这验证了门禁确实在守） |

## 5. 测试与门禁取证

### 5.1 单元/组件测试（全绿）

| 文件 | 结果 |
| --- | --- |
| `electron/services/story2video-compose-engine.test.js` | 158 passed |
| `electron/tests/pipeline-engine.test.js` | 72 passed |
| `electron/tests/stage-executor.test.js` | 77 passed |
| `electron/tests/pipeline-story2video-contract.test.js` | 27 passed |
| `electron/services/run-state-store.test.js` | 20 passed |
| `src/story2video/story2video-notifications.test.js` | 66 passed |
| `src/utils/pipeline-error-formatter.test.js` | 31 passed |
| `src/views/CreateViewHistory.test.js` | 39 passed |
| 前端相关 11 文件合计 | 516 passed |
| `scripts/check-compose-error-codes.test.js` | 7 passed（基线 + 6 变异） |

### 5.2 门禁（全绿）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 新门禁本体 | `node scripts/check-compose-error-codes.js` | PASS（8 码四侧一致） |
| locale 成对 | `check-locale-sync.js --pair-base origin/main` | PASS |
| CJK 硬编码 | `check-locale-sync.js --cjk` | PASS（基线 1331 → 当前 1147，无新增） |
| key 存在性 | `check-locale-sync.js --keys` | PASS（2153 个 key） |
| 品牌残留 | `check-no-brand-residue.js` + 自测 | PASS（10810 文件） |
| 未接线测试棘轮 | `check-unwired-tests.js` | OK（检查域 112 个测试文件） |
| 行尾两口径 | `git diff --cached --numstat` vs `--ignore-cr-at-eol` | EOL-CONSISTENT（29 文件） |

### 5.3 变异反证（6 道全部 CAUGHT）

| 变异 | 结果 |
| --- | --- |
| M1 删渲染端映射条目 | CAUGHT |
| M2 删 zh locale 文案 | CAUGHT |
| M3 改文案占位符为主进程不提供的名字 | CAUGHT |
| M4 删主进程错误码常量 | CAUGHT |
| M5 删 en locale 文案（zh 仍在） | CAUGHT |
| M6 清空整个映射表 | CAUGHT |

> ⚠️ 过程教训：第一轮用 PowerShell `-replace` 做变异，`{scene}` 被 .NET 正则写成 `\{scene\}`，变异已应用但门禁 PASS（假阴性）。改用 Node 脚本 + `assert.notStrictEqual` 后立刻 CAUGHT。

## 6. 已知限制（如实登记）

1. **compose 执行阶段（ffmpeg 子进程）20+ 处英文 message 未全面 errorCode 化**——已由既有 `compose_failed` 文案覆盖为「视频合成失败 + 检查磁盘/从断点继续」，用户可操作；本次只做预检类。列为后续 change。
2. **`looksTechnical` 不认英文句子**——只匹配通道名/大写下划线码/栈信息/IP:端口。要覆盖需英文技术词表，误报风险高，本次不做。
3. **存量历史记录不会自动补 errorCode**——只有新产生的失败运行带 `errorCode`；存量走原文模式通道归一化（行为已由测试锁定一致）。
4. **QM-4 视觉回归未跑**——本次失败原因文案长度变长（约 60-80 字），可能影响历史卡片布局。已在 PRD 中要求「历史卡片只展示自然语言摘要，避免被技术细节撑宽」，但未做像素级取证。**待 CI 的 QG Visual 结果确认**。

## 7. 提交与合并

- 分支：`error-message-user-friendly-audit`（worktree `<仓库父目录>/mp-worktrees/mp-error-message-user-friendly-audit`）
- PR：#4062

## 8. CCG 外部双模型评审（QM-6 / deepReview 闭环证据）

两条判定记录被判 `mode=dual`（`required=true`），且本 PR 命中**高危面**（`.github/workflows/`、`scripts/check-*` 判据本体），按 `check-pr-exec-record.js` 的收口矩阵只能以 `tier=external` + 可核出处闭环。实际执行：`ccg-deep-review.js`（proposer=opencode / critic=claude，跨家族校验通过）。

### 8.1 轮次与结论

| 记录 | 评审对象 | 结论 | 处断 |
| --- | --- | --- | --- |
| `.ccg/reviews/919e1a2b…json`（主修复，1710 行） | `git diff d1106011b^...d1106011b` | critic 提出 **8 条**（2 Critical / 4 Warning / 2 Info），维度分 correctness 4 / security 8 / performance 9 / maintainability 5 | 8 条全部实修，逐条裁决见记录内 `deepReview.findings` |
| `.ccg/reviews/5e5f4778…json`（baseline 上调，10 行） | `git diff b18e2b73d^...b18e2b73d` | critic 提出 **5 条**（3 Warning / 2 Info），最低分 5 | i1/i2 upheld → 已修；i3 dismissed（机制在途形态，附源码出处） |

> 说明：两条记录都因「存在 upheld 指控」被引擎判为 `self_play_blocked`（非闭环值）。本 PR 的处置是**把每一条 upheld 全部实修**，然后以 `self_play_resolved` + 本节的逐条处置表 + `tier=external` 闭环——而不是靠改写 verdict 让它变绿。

### 8.2 主修复评审 8 条与处置（全部实修）

| # | 严重度 | 问题 | 处置 |
| --- | --- | --- | --- |
| i1 | Critical | `zh.js` 的 `labels.currentScene` 写成 `\u6664`（晤）而非 `\u666f`（景），中文兜底文案成错字「该场晤」 | 改回 `\u666f`；新增 `src/locales/story2video-labels-glyph.test.js`（4 例）解码后逐字锁定，并断言与 `sceneLabel` 共用同一个「景」 |
| i2 | Critical | `formatError` 只替换 params 里存在的键：存量原文无体积数字时 `{actualMb}/{limitMb}` **字面残留**给用户（比原英文原文更糟） | ① 增加未解析占位符兜底 + 清零安全网；② 新增无数字变体文案 `compose_input_size_exceeded_no_numbers`（zh/en 成对）；③ 存量用例补 `not.toMatch(/\{[^{}]*\}/)` 与「必须走 no_numbers 变体」正向断言 |
| i3 | Warning | `resolveMessageKey` 硬编码 `'COMPOSE_*'` 字面量，三侧门禁扫不到（第五侧缺口） | 门禁新增第五侧：扫渲染端字面量并要求都在主进程常量集合内；补变异⑦与真实仓库断言（防删文件逃逸），9 例自测全绿 |
| i4 | Warning | `_autoAdvanceRun` 失败路径 `return` 只带 `error` 字符串，丢 `errorCode/messageParams`，与 `executeStage` 契约不一致 | 补齐两字段（与 `buildStageFailureError` 对齐，无值显式 `null`） |
| i5 | Warning | spec 写「稳定码优先」，代码却 `result.key \|\| stableKey`（原文优先），规范与实现矛盾 | 统一为 `stableKey \|\| result.key`，理由写进注释 |
| i6 | Warning | 注释称「必须早于 compose_failed」而实际插在其后，排序无判据 | 规则实体前移；补 `RULES.findIndex` 顺序断言 + 「compose failed: …超限…」行为断言 |
| i7 | Info | 门禁脚本 `}  }` 排版错乱 | 修正缩进 |
| i8 | Info | 体积对纯按出现顺序取，`limit 512MB, actual 780MB` 语序会把上下限**对调** | 改为「紧贴式锚点优先、顺序兜底」（`limit/max/上限/允许` 紧邻数字才认定）；补 3 例语序回归 |

### 8.3 为什么这条评审值得记

- **两条 Critical 都是「测试全绿但用户可见错」**：i1 是 `\uXXXX` 转义的字形无人解码核对；i2 是我自己的用例都显式传了 `errorParams`，恰好绕开真实存量数据形态。这正是本 change 主题（「提示信息必须对用户可用」）在**自身实现上**的重演。
- **i2 的严重性高于原 bug**：原 bug 是英文原文，i2 若上线会变成一串带花括号的中文，属于「越修越差」。若没有这轮外部评审，本次修复会带着这个回归合并。
- **可迁移教训**：凡渲染带占位符的文案，回归测试必须覆盖「参数缺失」这一形态，且断言「输出不含未解析占位符」；`\uXXXX` 风格 locale 需要字形级回归锁，不能只靠 key 存在性校验。

## 9. 提交与合并记录

- 合并：CI 全绿后按 AGENTS.md「PR 自动合并」自动 squash 合并并删除远端分支

## 8. 记忆沉淀

| 类型 | 内容 |
| --- | --- |
| 内置记忆 | `~/.dsh/memory/Mulpub/` 新增条目（稳定错误码契约 + 三条可迁移教训） |
| 外部记忆（仓库） | 本记录 + `01-docs/PRD-USER-FACING-ERROR-MESSAGES-2026-10-20.md` + `01-docs/BUGFIX-HISTORY-CARD-RAW-ENGLISH-ERROR-2026-10-20.md` + `01-docs/learnings.md` 置顶 4 条 + `AGENTS.md` QM-2 新条目 + `CHANGELOG.md` 置顶 + `PRD.md` 合同条目 + `PRD-S2V-PIPELINE-PAGE-UX.md` §3.2.1 |
| 外部记忆（本机 gstack） | `~/.gstack/projects/multi-publish/learnings.jsonl` 追加 |
| EverOS | `POST /api/v1/memory/add` → `flush` → 落盘 grep 哨兵词（判据取产物，不取接口应答） |
