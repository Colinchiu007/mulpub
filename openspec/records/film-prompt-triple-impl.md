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
| schema | Shot 增加 `imagePrompt` / `videoPrompt` / `endFramePrompt`；加载期归一化；**三分合计上限**（50000 字符，超限 fail-closed） | ✅ |
| 派生 | 自动模式规划期派生：`imagePrompt` = 当前拼装（**逐字不变**）、`videoPrompt` = 运动子集、`endFramePrompt` = '' | ✅ |
| 消费 | 图片走 `imagePrompt`、视频走 `videoPrompt`（回落链 `videoPrompt → imagePrompt → prompt`） | ✅ |
| 落盘 | 三分写进项目文件（否则续跑时派生结果丢失） | ✅ |
| 资产 | `SCHEMA.md` 补三字段规格 + 合计上限口径（数值/单位/计量对象/超限处置） | ✅ |
| 测试 | 新增 `film-prompt-triple.test.js`（16 例，跨 5 模块的契约） | ✅ |

## 实测修正（先实测再定口径）

方案初稿写「逐镜断言 `videoPrompt.length <= 0.6 * imagePrompt.length`」。**实施时回本仓实测，该阈值不成立**：

- 真实 kit 模板是**散文自由文本**（不是 7 块结构），153 个模板里 **123 个没有任何可剔除的静态块**
  ⇒ 运动子集与首帧图**逐字相同**（比值 1.0），逐镜固定比例**必然失败**；
- 实测：自动模式拼装后首帧图平均 **344** 字符、运动子集平均 **67** 字符，**全体 153 模板聚合比 0.177**。

⇒ 判据改为：**① 首帧图提示词与变更前逐字相同**（零回归锁，最强）＋ **② 派生镜严格短于** ＋ **③ 全体聚合比 ≤ 0.6×**。
已同步修正 `proposal.md` 与 PRD（PR #4118 的最后一次提交）。

## 验证

| 项 | 结果 |
|----|------|
| RED 证明 | 撤掉实现（`git stash` 6 个源文件）后新测试 **13/16 变红**；恢复后全绿 ⇒ 测试真的在测新行为 |
| 拼装等价 | `buildTemplatePrompt` 改造前后 **918 组合零不一致**（153 模板 × 3 段 beat × 2 组角色映射） |
| 影视工程测试 | `vitest run electron/services/film-engineering/` → **29 文件 / 482 例全绿**（基线 466 → 新增 16） |
| 既有零回归 | 基线 466 例在改动后仍全绿（`kit-loader` / `script-adapt` / `auto-plan` / `auto-project` / `video-gen` / `film-engineering-service` 全部原样通过） |
| QM-1 打包 | ⏳ 待跑（改 Electron 主进程 → 必须打包验证） |
| 门禁 | ⏳ 待跑（`classify-docs-only` / `check-gate-record-debt` / `check-pr-exec-record` / `check-no-brand-residue`） |

## 未做（明确不在本 PR）

- ❌ **尾帧约束文本的派生**：尾帧约束来自任务级提示词库（`prompt-library` 的 `generate_shot_prompt` / doctrine 的 `frame_constraint`），随 **PR-3（F-I 任务级提示词接入规划流程）** 落地；本批次只落字段与「只产出不消费」的消费口径。
- ❌ **存量 153 条分镜的视频提示词重算**：存量 `prompt` 是无块标记的自由文本，机械重算会丢运镜信息（比长 prompt 更糟）；归一化口径用 `videoPrompt ??= ''` 让边界**在数据上可见**。治理路径（一次性重算 + 人工审核）是后续项。
- ❌ **「项目案例」标签的剧本套用路径不派生三分**：该标签不在本次改动边界内。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #NNNN
