---
record: hot-carrier-edit-gate
task: 落 tasks 3.x —— 热写面禁改门禁以 advisory 档接进 changes 作业（changelog-record-carrier 片3）
date: 2026-10-21
---

## 本次执行记录：热写面禁改门禁 advisory 档（hot-carrier-edit-gate，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`scripts/check-*` 判据本体 + `.github/workflows/quality-gate.yml` + `.gitignore`）。正规入口 `scripts/start-mp-task.ps1 -TaskName hot-carrier-edit-gate -NoDeps`；判据取产物（`rev-parse --abbrev-ref HEAD` == 分支名、起点 `origin/main` == `c5087351d`、`dirty=0`），随后 `merge --ff-only` 对齐 |
| TDD 顺序 | ✅ | 先写 `scripts/check-no-hot-carrier-edit.test.js` 并见证红：判据本体不存在时是 LOADFAIL（`Cannot find module ... check-no-hot-carrier-edit.js`），不是指名红 —— 两种红语义不同，分开记 |
| 夹具自身的两次错（不写成"实现有缺陷"） | ✅ | ① 第一轮 7 条红：夹具**漏传 `--root=<夹具>`** ⇒ 判据拿真仓取证，真仓差量里没有台账于是全判 PASS —— 这是**假绿**，比假红危险，已在 `run()` 里注释成永久提醒；② T5/T7 两条：merge-base 在只有一笔提交时不存在 / 台账改动与授权文件被拆成两笔提交（后者会让用例"看着在测、实际什么都没测"）。均为测试侧错误，改正前后 11→13 条全绿 |
| 行为锁 | ✅ | 14 条全绿（`# tests 14 / pass 14 / fail 0`）。关键几条：T1 点名并给正解、T4 **他人改台账+我 rebase ⇒ 判 PASS**、T5b 坐标对但路径未登记不放行、T6/T6b/T6c 常驻通行证三形态、T8 两档点名内容一致只在是否阻断上分档、T9 取证失败与非法 mode 一律 rc=2、T10 只允许 node 内置、T11 清单不外溢到 AGENTS.md |
| 变异反证 | ✅ | 8 条各让**指名**用例变红、红集互不相同：MA 判据读工作树现状→T4；MB advisory 也阻断→T8；MC 授权只看存在→T6c；MD 不核坐标→T7；ME 清单被撑大→T11；MF 取证失败静默→T9；MG 红文案无正解→T1；MH 未登记路径也放行→T5b。驱动断言 `# tests >= 14`；还原 md5 一致 |
| MC 第一次 NOT_CAUGHT 的归因（防御重叠，不是锁没牙） | ✅ | 第一版 MC 报 `red=0`。查因：`addedAuth` 被绕过后，`readAuth` 读的是 **head blob** 而非工作树，旧授权在 feature 的 head blob 里不存在 ⇒ 第二道独立守卫挡住了，测试无法把这一格单独归因给 `addedAuth`。正解是**拆重叠**造 T6c：让授权同时存在于工作树与 head blob，且 `applies_to_base` 恰等于本次 merge-base（对应 CI 里"PR 建好后 main 未前进"的 base.sha 形态）—— 此时唯一还能拒绝的就只剩"必须是本次差量新增"。重跑后 MC 指名红 T6c |
| 接线（新测试必须被执行） | ✅ | 三处同改：`.gitignore` 反选判据本体（第 106 行 `scripts/*.js` 会静默忽略新建脚本）、`quality-gate.yml` 新增 `Gate 2b9 - Hot-carrier edit gate (changes job, advisory)`、`check-unwired-tests.js::MUST_LIVE_IN_UNGATED_JOB` 登记。**并同 PR 改 `check-unwired-tests.test.js` 那份 deepEqual 钉死的清单** —— 上一片就是因为漏了这一步把 required 的 `QG Static` 跑红（教训已写进 `openspec/records/changelog-carrier-aggregate.md` 的 learnings） |
| 落点为什么是 changes 作业 | ✅ | 台账与记录路径全部命中 `CI_IGNORED_PATHS`；接在被 `docs-only != 'true'` 门控的 job 里等于给自己关掉校验（AGENTS「进白名单的前提锁」，同 Gate 2b2/2b8 口径）。编号取 **2b9**：`2b2–2b8` 已被占（`#3724` 合入后 `Gate 2b5 - CCG evidence anchor` 也在用），同号撞名 |
| base 口径 | ✅ | 取 `merge-base`（不是 `github.event.pull_request.base.sha` 原值、更不是 `origin/main`），与 `Gate 2c3` 同口径；算不出时回落 base ref（更严方向）。T4 就是把这条钉住的用例 |
| 与既有基线的差异审计 | ✅ | 动代码前查到 `openspec/changes/hot-carrier-atomic-landing/`（规格已合入、实现未做）：其 D4 明确把 `AGENTS.md`/`CHANGELOG.md`/`01-docs/learnings.md` **移出**它的热点载体清单，且 tasks 1.2(d) 计划立锁"防止下个会话顺手补全"。逐条读 D4 原文后判定为**不同机制不同读数**（它量共享根未提交窗口，我量跨 worktree 的 PR 差量冲突），故不冲突但必须写边界 —— 已在 spec delta 新增一条 Requirement 明令两份清单 MUST NOT 合并，并写明本判据的读数**不满足**它设定的重进前提 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | PENDING | 本片命中高危面前缀 `scripts/check-`（判据自指）与 `.github/workflows/` ⇒ 按收口矩阵只认 `tier=external` + 可核 evidence。提交后真跑 `sh scripts/deep-review.sh` 再回填；取不到外部产物时如实记欠账，不用 `closureNote` 冒充高危面闭合 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 读数写在 PR 正文（本片含 workflow 与判据本体，预期 `docs-only=false`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 绝对路径账本未放宽 ✅

### 现场读数（提交前在 `origin/main == c5087351d` 上取；活数，引用前重取）

| 判据 | 读数 |
| --- | --- |
| `node --test scripts/check-no-hot-carrier-edit.test.js` | `# tests 14 / pass 14 / fail 0`（git 夹具重，约 28–34s，在 changes 作业预算内） |
| 变异驱动（一次性，落 `%TEMP%`） | 8/8 CAUGHT，红集互不相同，还原 md5 一致 |
| `node scripts/check-no-hot-carrier-edit.js --base=<实际 merge-base> --head=HEAD --mode=enforce`（对本 PR 自己） | **提交后实跑**，读数随 PR 评论给出（此刻工作树未提交，跑它得到的是空差量，不构成证据） |
| `node scripts/check-unwired-tests.js` / `check-step-failfast.js` / `check-workflow-structure.js` / `workflow-contract.test.js` | 全 rc=0；本机按 CI 的 `Gate 2c` 完整 argv 整条复跑（上一片漏跑自测导致 required 红的直接后果） |

### 遗留（不假装已闭合）

1. **advisory 只留痕不拦 ⇒ 现在"热写面已守住"是假话**。窗口内既有旧写法也有新载体；`missing` 计数会持续变大。转 enforce 的前置条件写在 tasks 4.3（当场重取的在飞 CONFLICTING/UNKNOWN 清零），那一步属"改谁来守门"，须人工过目。
2. **判据只认路径逐字相等，不认大小写/斜杠变体**。本仓台账路径只有一个写法，且 Windows 下 `git diff` 输出恒为 POSIX 正斜杠 —— 这是**观察**不是证明；若将来出现 `changelog.md` 变体，T11 的"清单不外溢"锁会把它挡在门外（不命中即不拦），需要补显式判据而不是靠运气。
3. **未做**：`scripts/hot-carrier-paths.json`（另一 change 的东西）、records 小节的强制校验、AGENTS.md 规范改写、release-gate 接线 —— 都在片4。

## CHANGELOG 条目

# feat(gates): 热写面禁改门禁以 advisory 档接进 changes 作业（hot-carrier-edit-gate）

- **拦什么**：`CHANGELOG.md` / `01-docs/learnings.md` 的 PR 顶插。实测 4/4 个可判定的 CONFLICTING PR 冲突文件只有这两个，20/30 笔 main 提交动过台账 —— CI 全绿也合不进去，还要再跑一轮 25–30 分钟。
- **判据输入是 PR 差量（merge-base..head），不是文件现状**：按现状写会把别人刚并入 main 的台账行算到我头上（本仓实测全树比较 5 例里 3 例这类假阳性）。`T4` 专门站在"我 rebase 之后工作树里确实有别人的台账改动"的形态上判 PASS，变异 MA（退回读现状）指名让它变红。
- **先 advisory 不 enforce**：在飞 PR 绝大多数已按旧规改了台账，一上来就阻断会把它们全判红，而那不是它们的错。档位由判据首行 `MODE=` 自己声明，两档点名内容逐字一致、只在是否阻断上分档（`T8`）。转档前置条件写在 tasks 4.3。
- **授权出口必须是"本次差量新增"**：沿用 `changelog-dedup-authorization.json` 那条已验证形态 —— 坐标核对 + 常驻通行证不生效。此处踩过一条有代表性的坑：变异 MC 第一次报 NOT_CAUGHT，原因是 `readAuth` 读 head blob 独立挡住了，属**防御重叠不可分辨**而非锁没牙；补 `T6c`（授权同时在工作树与 head blob、坐标恰等于本次 merge-base，对应 CI 里 PR 建好后 main 未前进的形态）把重叠拆掉后才指名变红。
- **差异审计**：动代码前查到 `hot-carrier-atomic-landing`（规格已合入、实现未做）的 D4 明确把这两个路径移出它的热点清单，理由是"没量过"。两者量的是不同失效（共享根未提交窗口 vs 跨 worktree PR 冲突），已在 spec 里新增一条 Requirement 禁止把两份清单"顺手统一"，并写明本读数不满足它的重进前提。
- 行为锁 14 条 + 变异反证 8 条全指名；本 PR 零改动台账与 learnings。

## learnings

### lesson: 变异报 NOT_CAUGHT 时先问"缺陷被实现出来了吗"，再问"锁有没有牙"

**现场**：给热写面门禁做变异反证，MC（"授权文件只要存在就生效"）第一次 `red=0`。

**根因**：`addedAuth` 被绕过后，还有第二道独立守卫在挡 —— `readAuth` 读的是 head blob（`git show head:<auth>`），而那条夹具里 feature 分支的 head 根本没有那份文件。于是缺陷没有端到端成立，测试红不起来。**这不是锁失灵，是变异没造出故障。**

**可复用的三条**：
1. 三层红档要分清：**指名红**（有效反证）／**LOADFAIL**（整片没跑，不构成证据）／**防御重叠不可分辨**（缺陷被别处独立挡住，这条变异测不到那一格）。第三层的正确处理是**拆重叠、造一条只有这一格能挡住的夹具**，不是把变异删掉、也不是宣布"已有别的锁保护所以不用测"。
2. 拆重叠的办法是让其他守卫**恰好都成立**：让授权文件同时存在于工作树与 head blob、`applies_to_base` 等于本次 merge-base、`authorizedPaths` 也覆盖 —— 此时唯一还能拒绝它的就是我要测的那条规则。
3. 这类夹具的形态要取自**真实运行现场**：本仓 CI 的 `base.sha` 在"PR 建好后 main 没动"时正好等于引入授权那笔提交，坐标核对那时会成立 —— 用这个形态造的用例才叫可达路径，不是编一个理论状态。
