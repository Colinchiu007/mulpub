---
record: billing-sample-intake-hardening
task: 依首条真实上游样本加固账单交接口径（额度vs已用量校验、计量口径、供给资格三判据）
date: 2026-10-11
---

## 本次执行记录：上游账单口径与供给资格判据加固（billing-sample-intake-hardening，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（files=5：`01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`、`01-docs/PRD-OFFICIAL-COMPUTE-STOPGAP-2026-10-09.md`、`openspec/records/billing-sample-intake-hardening.md`、`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/规格变更 ⇒ 就地编辑共享主工作区（**未进 worktree**），开头先 `git merge --ff-only origin/main` 同步到 `6dceb20b7`；经 PR 落地，不直推 main |
| 输入来源（可复核） | ✅ | 运营方提供首条真实样本（MiniMax coding plan，实付 ¥49，声称额度 8.79B Token，有效期至 2026-11-04）＋ 用量导出 `token_plan_usage` CSV（2026/10/01 21:00 ~ 2026/10/11 12:00，95 行）。原始文件位于仓库外，**未入库**（§4 纪律）；本文只记归一化后结论 |
| 发现 1（抓到一个真实填报错误） | ✅ | 导出四项合计 **8,789,898,170（8.7899B）** 与填报「额度 8.79B」**精确吻合（差 0.0012%）** ⇒ 该数字是**已用量**而非总额度。按此反算的单价 ¥0.0056/1M 比常识区间低一到几个数量级，据此定价会超送积分。**已固化为校验规则**（交接口径 §2.4-1：额度与用量合计吻合即判可疑）并写入 PRD §4.2 F1 |
| 发现 2（计量口径约 40 倍差异） | ✅ | 同一 8.79B：四项总计口径 ¥0.0056/1M vs 仅输入+输出口径 ¥0.22/1M（**差 39.4 倍**）；实测缓存读取占 **97.5%**，输入 : 缓存读 ≈ **1 : 40.8**（样本 cache 命中率 95–99%）。⇒ 计量口径升为**必采字段**，口径缺失不得参与定价比较 |
| 发现 3（供给资格） | ✅ | 该样本为**个人自用 coding plan**：① 条款通常禁止转售/供第三方；② 大额度 + 强速率限制 ⇒ **瓶颈在速率不在额度**；③ 有效期仅 24 天。⇒ 新增**供给资格三判据**（条款/速率/期效）写入 PRD §4.2 F1，不满足者状态 `reference_only`、只能作参考单价不得进池 |
| PRD 同步 | ✅ | §4.2 F1：字段补 `计量口径`/`速率限制`/`套餐类型细分`/状态加 `reference_only`；新增供给资格三判据与「口径缺失不得定价」两条；校验补「额度≠已用量」与「到期前 7 天告警 + 到期自动摘出全部供给池」 |
| 交接口径文档同步 | ✅ | `01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`：§2.1 字段扩为 13 项（含套餐类型/计量口径/速率限制/用途条款）；新增 §2.4 交叉校验四条；§3 增「供给资格」行；§5 坑清单 8→11 条；新增 **§8 首条参考样本与实测发现**（含 8.1–8.4 四段与样本局限声明） |
| 行尾与编码对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；改动文件字节扫描无 U+FFFD |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` PASS |
| 记录欠账门禁 | ✅ | `node scripts/check-gate-record-debt.js` OK（顶部记录带行、两形态一致、无陈旧登记项） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无代码/样式变更） |
| QM-6 CCG 双模型外部评审 | N/A（docs-only 通道豁免） | 本文档为数据校验规则与资格判据，非设计裁决；结论均附可复核算式 |
| 远程同步 | PASS | 已合并 #3347 = `5fc2cecdf34b389fa23f50d71f58ef7c603d3270`，committer 2026-10-11T21:54:08+08:00。取证：`git log origin/main --grep="(#3347)" --format="%H %cI"` 唯一命中，`git ls-remote --heads origin billing-sample-intake-hardening` 返回 **0 行**（远端分支已删）；本行与记录文件远程同步行、frontmatter 三 `sync_*` 字段删除、`scripts/gate-record-debt-ledger.json` 登记项删除已在**同一次提交**完成 |

### 遗留（不假装已闭合）

- **总额度仍未取得**：样本只提供了已用量（8.79B）与实付（¥49）。真正的「额度」需运营方在控制台核对后补报；**在补齐前，本样本不得用于推导单价或赠送量**。
- **样本代表性不足**：仅 10.6 天、单一供应商、单一模型（M3.1-Flash-Preview 占输入 99.9%）、全部来源为 `MiniMax Code`（coding agent 形态）⇒ 不可外推到视频/图片/TTS 类业务，也不代表开放平台 API 套餐的用量结构。
- **计量口径的机器可读性未定**：目前只在文档层规定「必采」，落在数据模型上是哪个字段（枚举？自由文本？逐模型？）留待第二阶段迁移设计一并定。
- **供给资格判据的落地方式未定**：`reference_only` 是新增状态值，如何进入既有 `status` 枚举、以及「速率上限是否够用」如何量化（阈值从哪来）均未定案。
- **上游供应商清单仍不完整**：运营方已声明后续会补充多个供应商（订阅套餐与按量付费并存），本文只覆盖首条样本。
