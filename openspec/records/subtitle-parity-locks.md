---
record: subtitle-parity-locks
task: 跨仓 sidecar 对账锁 + Python 金标 + ops-center 能力声明互证（判据类变更，零运行时行为改动）
date: 2026-10-19
---

## 本次执行记录：跨仓对账锁与 Python 金标（subtitle-parity-locks，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 混合 PR（含 `packages/`、`apps/desktop/electron/services/`、`scripts/`、`.github/workflows/`、`ops-center/`），已在隔离 worktree `<worktrees>/mp-subtitle-split-quality`（D 盘，非 C 盘）+ 裸分支 `subtitle-parity-locks`（基线 `origin/main` = `09af45d44`）；跨仓 `smart-sentence-splitter` 用独立 worktree `<worktrees>/sss-subtitle-phrase-boundary` + 分支 `sidecar-parity-lock`（基线 `origin/main` = `8f1922a`） |
| 第一性原因（QM-5 ①） | 通过 | 三条遗留都不是「有 bug 没修」而是**没有任何判据会红的静默失效面**：① 规则表/向量是两仓手工副本，两仓单测各读自己那份、全绿，跨仓漂移无判据（现场：`no_cut_bigrams` 尾 9 元素顺序已漂，集合相同所以行为没变，正说明「会漂且无人拦」）；② `ops-center` 的 Python↔TS 对照三重失效（`ops-center-ci.yml` 触发路径只含 `ops-center/**` ⇒ 改 TS 时一次都不跑；被比的是无词边界子系统的简化移植；语料 9 条标点丰富句式）；③ 我自己在 `learnings.md` 写的副本数三处皆错（4 份实现写成 3 份、2 份数据写成 1 份、2 份向量写成 3 份） |
| 逃逸分析（QM-5 ②） | 通过 | ① 单元 —— 向量测试明令「禁止把实现输出写入向量」，但**没有任何判据覆盖「本地实现与线上 sidecar 是否一致」**；② 集成 —— `parity.test.js` 只比 TS vs JS，Python 侧无对照；③ 端到端 —— 真实 8002 链路 E2E 需手工起服务，默认不进 PR 门禁；④ 跨仓 —— 无任何判据能同时看见两个 checkout；⑤ 代码审查 —— `prompt_eval_segmentation.py` 头部「完整移植」四字就是审查盲区的成因：读者看到这行会以为有保护 |
| 修复 + 回归保护（QM-5 ④） | 通过 | 修复见下方「变更清单」；回归保护 = 4 条新判据 + 6 个变异反证（见下条）。**判据本体的接线**：`scripts/check-sidecar-parity.test.js` 接进 `quality-gate.yml` 新增 Gate 12f（changes job，每个 PR 都跑），避免「判据没被任何 workflow 点名」——本仓 `scripts/*.js` 被 `.gitignore:106` 整体忽略，漏 negation 时 CI 上表现为 MODULE_NOT_FOUND（读起来像"判据坏了"） |
| 预防措施（QM-5 ⑤） | 通过 | ① `learnings.md` 更正错述 + 两条新 lesson（单仓锁看不见跨仓漂移 / 参考实现快照不是真值）；② 每次改数据时的四步修法写进 `sidecar-parity.lock.json` 的 `howToUpdate` 与两仓测试的失败文案（可直接复制）；③ 金标的「不是真值」说明写进生成器 docstring、TS 测试头、JS 测试头三处；④ `openspec/changes/subtitle-sidecar-parity-lock/` 记录设计取舍与被否方案 |

### 数据校验（逐项实测）

| 项 | 判据 | 读数 |
| --- | --- | --- |
| 对齐前两仓规则表差异面 | 深比 JSON | 9 条，全在 `word_split.no_cut_bigrams` 尾部，是**旋转**（集合相同） |
| 顺序是否影响行为 | 读实现，不假定 | Python `WORD_NO_CUT_PHRASES = set(...)`，三处用法为真值判定 / 最长匹配 ⇒ 与顺序无关 |
| 对齐后两仓规则表 | LF 归一化 sha256 | 两侧同为 `07c14ae28144607402a0d8a8a03220907608eaf625bf49fbd0ac98eb70705d4f` |
| 两仓向量 | LF 归一化 sha256 | 两侧同为 `c6072781e330de6cabfe5c6022f258f0f350737870e70449dabbe370957b635b`（对齐前即相同） |
| 锁文件两仓一致 | **LF 归一化后**比较 | 一致。第一版用**原字节**比，真实跑当场稳定假红：四条数据哈希全等，仅锁文件因两仓检出行为不同（mulpub `text=auto`→CRLF；sidecar→LF）而字节不同。已改为与数据同一口径，并补回归测试（同内容/不同行尾 ⇒ 不报；真不同 ⇒ 报） |
| 四份共享产物两侧一致 | 跨仓对账脚本 | PASS —— `rules=07c14ae28144… vectors=c6072781e330… corpus=0f4595f371ad… golden=43feac3f0572…` 两侧全等 |
| 金标规模 | 生成器输出 | 18 例 / 169 块；provenance 三个哈希均与锁/当前语料一致，`commit=8f1922a…` |
| sidecar 全量回归 | `pytest tests/` | **577 passed, 9 skipped**（含 6 例新对账/金标新鲜度锁） |
| ops-center 分句 | `pytest tests/test_prompt_eval_segmentation.py` | **23 passed**（含 3 例新声明互证锁；与 TS 的 esbuild 对照仍绿） |
| 安全扫描器 | `security_scanner.js`（CCG verify-security） | 首次提交被「路径遍历」高危**阻断**；改法不是 `SKIP_CCG_GATE`，而是去掉生成器的命令行路径参数 → 复检 **✓ 通过（0 高危）** |

### 变异反证（每条判据必须指名变红，跑完按字节还原）

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| M1 改本仓规则表一个字符（不更新锁） | 锁判据红 | **红**（`tests/sidecar-parity.test.ts` failed=2） |
| M2 改锁登记值（数据没动） | 锁判据红 | **红**（同上 failed=2） |
| M3 改金标里一个 block | TS 金标 + JS 金标都红 | **红**（TS failed=1 ｜ JS failed=1） |
| M4 删金标一条用例 | 一一对应红 | **红**（failed=2） |
| M5 篡改金标 provenance 哈希 | 版本对账红 | **红**（failed=1） |
| M6 语料新增一条但金标不补 | 一一对应红 | **红**（failed=2） |

还原自检：4 个被变异文件跑后 sha 与跑前一致（`subtitle-rules.json`=`e4f53b04…`、锁=`bfd4f2f3…`、金标=`0631c329…`、语料=`0f4595f3…`）。

### 测试读数

| 套件 | 结果 |
| --- | --- |
| TS `packages/story2video-engine` 全量（新增 2 文件） | **242 passed / 8 files**（原 216 + 26 新增） |
| JS `apps/desktop` 分句四件套（新增 1 文件） | **188 passed / 4 files**（原 168 + 20 新增） |
| `node --test scripts/check-sidecar-parity.test.js` | **13 passed** |
| 跨仓对账 `node scripts/check-sidecar-parity.js --sidecar …` | PASS（四份产物两侧一致），退出码 0 |
| sidecar Python 全量 | **577 passed, 9 skipped** |
| sidecar 对账/金标单个文件 | 6 passed |
| ops-center Python | 23 passed |

### 变更清单

- 新增 `packages/story2video-engine/tests/fixtures/sidecar-parity.lock.json`（两仓同一份）
- 新增 `packages/story2video-engine/tests/fixtures/subtitle_parity_corpus.json`（18 例，只有输入）
- 新增 `packages/story2video-engine/tests/fixtures/subtitle_python_golden.json`（生成器产出）
- 新增 `packages/story2video-engine/tests/sidecar-parity.test.ts`、`sidecar-golden.test.ts`
- 新增 `apps/desktop/electron/services/story2video-segmentation-golden.test.js`
- 新增 `scripts/check-sidecar-parity.js` + `scripts/check-sidecar-parity.test.js`
- 新增 `.github/workflows/sidecar-parity.yml`（`schedule` + `workflow_dispatch`）
- 修改 `.github/workflows/quality-gate.yml`（新增 Gate 12f）、`.gitignore`（`!scripts/check-sidecar-parity.js`）
- 修改 `ops-center/backend/services/prompt_eval_segmentation.py`（如实声明 + 两个常量）、`ops-center/backend/tests/test_prompt_eval_segmentation.py`（3 条互证锁）
- 修改 `01-docs/learnings.md`（更正错述 + 2 lesson）、`CHANGELOG.md`
- sidecar 仓：`src/splitter/scene_subtitle/subtitle_rules.json`（顺序对齐）、`tests/vectors/sidecar-parity.lock.json`、`tests/vectors/subtitle_parity_corpus.json`、`tests/vectors/subtitle_python_golden.json`、`tests/unit/test_sidecar_parity_lock.py`（6 例）、`scripts/gen_subtitle_python_golden.py`、`CHANGELOG.md`

### 遗留（如实记录，不算闭合）

- `pairs` 短语表仍是显式枚举，有覆盖上限。下一步不是盲目挖语料，而是**先量化「走到 MAX 裸切的比例」**（可观测性优先），属独立切片。
- 只修了「无标点长块硬切」一族；其他坏切族需要真实样本分类，不是代码问题。
- `ops-center` 的触发路径缺口**本次有意不补**（该 job 已长期卡 10 分钟超时临界，7 次里 3 次 cancelled；加触发会加剧取消率，而真问题是移植保真度）。补偿是 `packages/story2video-engine` 侧的 TS↔Python 金标对账。
- 定时跨仓 workflow 依赖第三方仓库可用性；失败不阻塞任何 PR（这是设计取舍，不是闭合）。

| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导，本行不手写状态词 |
