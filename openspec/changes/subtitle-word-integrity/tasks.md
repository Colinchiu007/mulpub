# Tasks: subtitle-word-integrity

## 1. 规则数据（先数据后代码）

- [ ] 1.1 mulpub `subtitle-rules.json`：新增 `word_split.unit_guard`（units + left_bind + right_bind + min_head_relax）；`no_cut_bigrams` +11
- [ ] 1.2 sidecar `subtitle_rules.json` **同批同步**（LF 归一化逐字节相同）
- [ ] 1.3 两仓 `sidecar-parity.lock.json` 同批更新 `rulesLfSha256`

## 2. TDD 红灯

- [ ] 2.1 新增 6 条 `v1.4_word_integrity_*` 共享向量（手工真值：数字│单位 ×3 + 双字搭配 ×3），mulpub/sidecar 双副本，先跑出红
- [ ] 2.2 金标回归预检：改规则前先确认既有 44 向量 + 18 金标语料的期望输出（作为"零误伤"基线读数）

## 3. 实现两端同构

- [ ] 3.1 TS：`subtitle-phrase-boundary.ts` 或 `text-segmentation.ts` 内新增 `isUnitInterior` + `isSafeCutPosition` 第 5 条
- [ ] 3.2 Python：`_is_unit_interior` + `_is_safe_cut_position` 同款
- [ ] 3.3 跑绿：TS 44+6 向量全绿、Python 同
- [ ] 3.4 金标重生成（sidecar）→ 两仓同步 → 三端金标测试全绿（证明零误伤）

## 4. 验证

- [ ] 4.1 8 段压力文案三端对跑：逐字一致 + 4 类坏切实例清零
- [ ] 4.2 变异反证：删 `unit_guard` ⇒ 新向量红；删 no_cut 新条目 ⇒ 搭配向量红
- [ ] 4.3 全量回归：TS / JS / Python（sidecar）/ ops-center 四套

## 5. 文档与门禁

- [ ] 5.1 `CHANGELOG.md` 两仓 + `01-docs/learnings.md`（若踩新坑）+ `openspec/specs/subtitle-split-quality/spec.md` 数字完整性 Requirement
- [ ] 5.2 `openspec/records/subtitle-word-integrity.md` 执行记录（QM-1 不适用：无 apps/desktop/electron 主进程改动；QM-4 N/A）
- [ ] 5.3 两仓 PR + CI 绿 + squash 合并 + 收尾取证（先 sidecar 后 mulpub，锁字节依赖）
