# 执行记录 · film-prompt-triple-impl（PR-2 · F-A 分镜提示词三分）

> 分支：`film-prompt-triple-impl`
> OpenSpec：`openspec/changes/film-pipeline-prompt-triple-and-guards/`
> PRD：`01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md`
> 上游：PR #4118（方案，docs-only）

## 本次交付

F-A「分镜提示词三分」的**实现**：把「首帧图 / 视频运动 / 尾帧约束」三种用途的提示词从一段文本里拆开，
让图片生成与视频生成各拿各的。

| 项 | 内容 | 状态 |
|----|------|------|
| schema | Shot 增加 `imagePrompt` / `videoPrompt` / `endFramePrompt`；加载期归一化；**字段级校验**（类型 + 单字段上限 50000，超限 fail-closed；**无「三分合计上限」** —— 验证层评审 i4 已删） | ✅ |
| 派生 | 自动模式规划期派生：`imagePrompt` = 当前拼装（**逐字不变**）、`videoPrompt` = 运动子集、`endFramePrompt` = '' | ✅ |
| 消费 | 图片走 `imagePrompt`、视频走 `videoPrompt`（回落链 `videoPrompt → imagePrompt → prompt`） | ✅ |
| 落盘 | 三分写进项目文件（否则续跑时派生结果丢失） | ✅ |
| 资产 | `SCHEMA.md` 补三字段规格 + 字段级校验口径（无合计上限） | ✅ |
| 测试 | 新增 `film-prompt-triple.test.js`（**20 例**，跨 5 模块的契约） | ✅ |

## 实测修正（先实测再定口径）

方案初稿写「逐镜断言 `videoPrompt.length <= 0.6 * imagePrompt.length`」。**实施时回本仓实测，该阈值不成立**：

- 真实 kit 的块标记分布是**单一**的：153 个模板里只有 `AUDIO` 命中（62 条，其中 29 条真正成块），
  `GEO SPATIAL LAYOUT` / `ACTION TIMING` / `CHARACTER ACTING` / `POSITIVE CONSTRAINTS` 命中 **0** 条
  ⇒ **124** 个模板没有任何可剔除的静态块，运动子集与首帧图**逐字相同**（比值 1.0），逐镜固定比例**必然失败**；
- 实测（153 模板，beat=3 行剧本段落）：首帧图平均 **349** 字符、运动子集平均 **72** 字符，聚合比 **0.207**；
  beat=单行 7 字符时为 **0.146**（比值随 beat 长度变化，故判据取聚合比而非逐镜比）。

⇒ 判据改为：**① 首帧图提示词与变更前逐字相同**（零回归锁，最强）＋ **② 运动子集 ⊆ 首帧图 且 不含静态块**（子集不变量）＋ **③ 全体聚合比 ≤ 0.6×**。
已同步修正 `proposal.md` 与 PRD（PR #4118 的最后一次提交）。

## 验证

| 项 | 结果 |
|----|------|
| RED 证明 | 把 6 个既有源文件回退到实现前（`merge-base` = `ca382558`，新建的 `shot-prompts.js` 留在原位以保证**逐条**变红而不是模块加载期就挂）⇒ 新测试 **15/20 变红**、5 例通过（通过的是不依赖新行为的 4 例 + 「首帧图逐字不变」零回归锁）；恢复后逐字节校验一致 ⇒ 测试真的在测新行为 |
| 拼装等价 | `buildTemplatePrompt` 改造前后 **918 组合零不一致**（153 模板 × 3 段 beat × 2 组角色映射） |
| 影视工程测试 | `vitest run electron/services/film-engineering/` → **29 文件 / 486 例全绿**（基线 466 → 新增 20） |
| 既有零回归 | 基线 466 例在改动后仍全绿（`kit-loader` / `script-adapt` / `auto-plan` / `auto-project` / `video-gen` / `film-engineering-service` 全部原样通过） |
| 运动子集不变量 | 真实 153 模板逐条断言 `motion ⊆ full` 且不含 `GEO SPATIAL LAYOUT`（内联 mock + 真实资产双覆盖） |
| QM-1 打包 | `npx electron-builder --win --x64` **exit 0**；产物 `dist-electron/Multi-Publish.Setup.0.2.0.exe`（267,314,133 字节）；asar 清单 13,143 条，本次改动的 **9 个文件全部命中**（含新建 `shot-prompts.js` 与 2.6MB 的 `shot-library.json`） |
| 门禁 | `classify-docs-only` / `check-gate-record-debt` / `check-pr-exec-record` / `check-no-brand-residue` / `check-locale-sync` 本地 **rc=0**；CI 全绿读数见 PR #4127（按「(merge SHA, workflow)」这一格回读，证据写 PR 评论，不写回本文件） |

## 验证层对抗评审的处置（7 条，全部逐条裁决）

引擎：`.adversarial/ccg-deep-48e45266/`（critic=claude × proposer=opencode，跨家族，DUAL）。
裁决表：同目录 `adjudication.json`（指纹 `429a43247496e713`，与 critique 绑定）。
落盘：`.ccg/reviews/8ab60a….json` —— `status=self_play_resolved` / `performedBy=self-play` / `findings=7 条` / `blocking=[]` / `closureNote` 已写（轮次 + 逐条处置结论）。

| 编号 | 严重度 | 裁决 | 处置 |
|------|--------|------|------|
| i1 | Critical | 驳回 | 指控前提不成立：散文块从来就不在首帧图提示词里（`buildTemplatePrompt` 只收五类块标记，改造前既有行为）。按建议加 `else → motionParts` 已实跑否证（运动/首帧比 0.146 → **48.7**，破坏 `motion ⊆ full`）。误加分支已回退；不变量改为可执行判据 |
| i2 | Critical | 成立·已由重新生成消解 | 指控对象 `d860c72` 是上一轮失败运行的产物，自带 `status=error` + `validationErrors`（忠实标记失败），且 `mode=single` 不在欠账扫描域；本轮 critique 的四个维度名全部合法并已通过引擎校验 |
| i3 | Critical | 成立·已修 | `c23c5bb` 的 `status` 与 `blocking` 不同向 ⇒ 已清空 `blocking`（4 → 0），`status` 保持 `self_play_resolved`（那 4 条在原 closureNote 里均已「成立 + 已修 + 落点」，缺陷在「修完没清账」） |
| i4 | Warning | 成立·已修 | 「三分合计上限」与单字段上限同值 ⇒ 永不触发且误杀三段各自顶格的合法资产 ⇒ 判据**整体删除**（代码 + 测试 + SCHEMA/PRD/spec/design/proposal 各留一处「已删除」说明），改由字段类型 + 单字段长度校验把关 |
| i5 | Warning | 成立·已修 | `if (!fs.existsSync(KIT)) return` 让「资产缺失」被读成「用例通过」⇒ 改为缺失即红 + 新增「资产在仓内」独立判据；三条不变量改用**内联 mock**，真实 153 模板降为第二层覆盖 |
| i6 | Warning | 成立·已修 | `required=true` 而产物未完成即入库 ⇒ 由「把评审做完」消解（填完 7 条裁决 → 重跑 `deep-review` 复用存档 critique → 写 `self_play_resolved` → 补 `closureNote`）。产物保留在仓（删产物不等于完成评审） |
| i7 | Info | 部分采纳 | 「分离评审元数据与代码变更」机制上不可行（记录名 = 暂存 diff 的内容地址，拆分会让引擎寻址落空）；「在提交信息中说明元数据更新规则」已采纳（见本次提交信息） |

## 交付物一致性收口（本 PR 一并修掉的口径不一致）

- **删掉「三分合计上限」的全部残留**：代码 2 处、测试 1 处、文档 8 处（含 `design.md` D2、`spec.md` 的 Requirement 与 Scenario、`proposal.md` V-2、`tasks.md` 2.4/2.6/2.9/7b.9b、PRD §3.1/V-2/风险表、SCHEMA.md §2.2）。
- **重建 `tasks.md` PR-2 段的条目号**（PR-1 遗留：条目号被拆到独立行，`2.10` 还变成了 `2.` + `0 验证`）⇒ 恢复为 `2.1`–`2.15`；`§10 验证（贯穿）` 的编号从 `8.x`（与 PR-8 段撞号）改回 `10.x`。
- **对齐各段末尾的 PR 引用与依赖图**：各段末尾原写着「上一段」的 PR 号（PR-3 段写 +PR-2 …），已改成本段自己的 PR 号；`proposal.md` §5 的依赖图是**插入 F-A 为 PR-2 之前**的旧编号（没列 F-A，后面整体错位一位），已按 §5.0 表格重建。
- **回填实测数字**：PRD 与执行记录里的派生比例（0.177 / 344 / 67 / 123 个模板）改为实测值（0.207 或 0.146，取决于 beat 长度 / 349 / 72 / **124** 个模板），并写明测量条件。
- 历史记录类文档（`review-brief.md` / `ccg-plan-review-record.md`）**原文不改**，只加「后续修订说明」——它们是送审时与决策层 5 轮评审的历史快照，改写等于伪造历史。

## 未做（明确不在本 PR）

- ❌ **尾帧约束文本的派生**：尾帧约束来自任务级提示词库（`prompt-library` 的 `generate_shot_prompt` / doctrine 的 `frame_constraint`），随 **PR-3（F-I 任务级提示词接入规划流程）** 落地；本批次只落字段与「只产出不消费」的消费口径。
- ❌ **存量 153 条分镜的视频提示词重算**：存量 `prompt` 里 29 条可剔掉 `AUDIO` 块、其余 124 条是散文自由文本；机械重算对后者是恒等变换、对前者会丢运镜信息（比长 prompt 更糟）；归一化口径用 `videoPrompt ??= ''` 让边界**在数据上可见**。治理路径（一次性重算 + 人工审核）是后续项。
- ❌ **「项目案例」标签的剧本套用路径不派生三分**：该标签不在本次改动边界内。
- ❌ **散文正文不进首帧图拼装的既有缺口**：`shot[0].prompt` 原文 13,922 字符，但**改造前既有**的 `buildTemplatePrompt` 只取五类块标记内容，角色外观等散文正文本就不在拼装结果里 —— 与本次变更无关（本次对首帧图拼装**逐字不变**），已登记在 PRD §3.1，治理路径同上一条。
- ❌ **新增用户可见文案**：本次无新增文案，`apps/desktop/src/locales/` **零改动**（`check-locale-sync` 自然满足）。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #4127
