# Tasks: subtitle-sidecar-parity-lock

## 1. 跨仓数据对齐（前置：没有这一步，字节级锁永远红）

- [x] 1.1 精确定位两仓规则表差异面：`no_cut_bigrams` 尾部 9 元素顺序旋转（集合相同）
- [x] 1.2 读实现确认「顺序不影响行为」而非假定：Python 侧 `WORD_NO_CUT_PHRASES = set(...)`，三处用法分别是真值判定与最长匹配 ⇒ 与顺序无关
- [x] 1.3 字节级把 sidecar 侧 `"展现"` 从 `"那些"` 后移到 `"想当"` 后（保留该区块原有 LF 行尾）
- [x] 1.4 证明对齐后两仓规则表 LF 归一化哈希完全一致（`07c14ae2…`）
- [x] 1.5 sidecar 全量测试 `pytest tests/` → **577 passed, 9 skipped**（证明重排无行为影响）

## 2. 对账锁

- [x] 2.1 `packages/story2video-engine/tests/fixtures/sidecar-parity.lock.json`（含 `howToUpdate`）
- [x] 2.2 sidecar 侧 `tests/vectors/sidecar-parity.lock.json`，与 mulpub 侧**逐字节相同**
- [x] 2.3 TS 断言 `packages/story2video-engine/tests/sidecar-parity.test.ts`（4 例）
- [x] 2.4 Python 断言 `tests/unit/test_sidecar_parity_lock.py`（4 例）
- [x] 2.5 行尾不敏感反证：未归一化时两值必须不同（否则断言空转）

## 3. 跨仓校验脚本 + 定时 workflow

- [x] 3.1 `scripts/check-sidecar-parity.js`（零依赖；`compareParity` 纯函数 + `--json` + `--mulpub` 便于测试）
- [x] 3.2 覆盖面从 2 条产物扩到 **4 条**（规则表 / 向量 / 语料 / 金标），缺一侧如实报「只在一侧存在」
- [x] 3.3 `scripts/check-sidecar-parity.test.js`（13 例：纯函数 7 + 哈希口径 1 + 锁行尾口径 2 + 端到端 0/1/2 三档）
- [x] 3.4 `.gitignore` 加 `!scripts/check-sidecar-parity.js` negation（`scripts/*.js` 会静默忽略判据本体）
- [x] 3.5 `quality-gate.yml` 新增 Gate 12f（changes job）跑该自测 —— 每个 PR 都跑
- [x] 3.6 `.github/workflows/sidecar-parity.yml`：`schedule` + `workflow_dispatch`，**不挂 PR**
- [x] 3.7 实跑跨仓对账 → PASS（四份产物两侧哈希全等）

## 4. Python 金标

- [x] 4.1 `subtitle_parity_corpus.json`（18 例，只有输入），两仓各一份副本
- [x] 4.2 sidecar `scripts/gen_subtitle_python_golden.py`，**无命令行参数**（输入输出均仓内固定位置）
- [x] 4.3 生成 `subtitle_python_golden.json` → 18 例 / 169 块；provenance 含 rules/vectors/corpus 三个哈希
- [x] 4.4 TS 断言 `packages/story2video-engine/tests/sidecar-golden.test.ts`（22 例）
- [x] 4.5 JS 断言 `apps/desktop/electron/services/story2video-segmentation-golden.test.js`（20 例）
- [x] 4.6 sidecar 侧断言金标 provenance 与本仓数据版本一致（防过期副本被复制过去）
- [x] 4.7 首次提交被 CCG 安全扫描器以「路径遍历高危」阻断（无抑制机制）→ 去掉路径参数而非绕过（见 design §4.4）

## 5. ops-center 假锁改诚实

- [x] 5.1 `prompt_eval_segmentation.py` 头部从「完整移植」改为如实覆盖声明 + 未覆盖范围
- [x] 5.2 新增 `PORTED_SURFACE` / `NOT_PORTED_SURFACE` 两个声明常量
- [x] 5.3 既有测试文件加 3 条声明/源码互证锁（只扫代码形态标识，不扫散文）
- [x] 5.4 `pytest tests/test_prompt_eval_segmentation.py` → 23 passed（含与 TS 的 esbuild 对照仍绿）

## 6. 文档

- [x] 6.1 `openspec/changes/subtitle-sidecar-parity-lock/{.openspec.yaml,proposal.md,design.md,tasks.md}`
- [x] 6.2 `01-docs/learnings.md`：更正副本数错述 + 两条新 lesson
- [ ] 6.3 `CHANGELOG.md` 追加本次变更
- [ ] 6.4 `openspec/records/subtitle-parity-locks.md` 执行记录

## 7. 质量门禁

- [ ] 7.1 变异反证 M1–M6 各自指名变红，跑完按字节还原
- [ ] 7.2 全仓测试：TS / JS / Python（sidecar）/ Python（ops-center）四套
- [ ] 7.3 `check-max-lines`（新文件 + `.gitignore` / workflow 改动）
- [ ] 7.4 `check-unwired-tests`（新 `scripts/*.test.js` 必须被 workflow 点名）
- [ ] 7.5 `workflow-contract.test.js`（新 workflow 是否违反契约）
- [ ] 7.6 `check-no-brand-residue` / `check-doc-abs-paths` / `check-changelog-growth`
- [ ] 7.7 两仓 PR + CI 绿 + 合并 + 收尾取证
