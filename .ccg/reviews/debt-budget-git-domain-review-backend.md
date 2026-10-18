# QM-6 后端轴评审：debt-budget-git-domain

被审对象：分支 `debt-budget-git-domain`，实现提交 `a8c0e29f9`（基于 `b00b8ca56`，7 文件 +573/-59）。

VERDICT: PASS（无 Critical；2 条 Warning 建议合前小修或合并后跟进，其余为 Info）

## Findings

Warning | scripts/check-debt-budget.js:242-247（配合 :36） | `--root` 允许指向本仓任意子目录并“全零通过”；`BASELINE_PATH` 固定在 `scripts/debt-baseline.json`，`--root` 换树时基线坐标系不跟着换 | 实测 `node scripts/check-debt-budget.js --root scripts` → rc=0、`domain=217`、`maxFileLines: 0`、`filesOver500: 0`；`node -e` 探针显示 `git -C scripts ls-files -z` 输出相对子目录（sample `["README.md",...]`），域与 SCAN_DIRS 不再同坐标系 | 建议 fail-closed：`git rev-parse --show-toplevel` 必须等于 root，或要求至少一个 SCAN_DIR 存在且扫描文件数 > 0；若要支持换树完整比对，增加 `--baseline`（对齐 check-max-lines 既有选项）

Warning | scripts/check-debt-budget.test.js:163-190 | 声称锁住“CLI 三档 rc”，实际只覆盖 rc=0、rc=2；`process.exit(1)`（确实超基线）路径没有任何用例，`check()` 也无直接单测 | `rg -n "strictEqual\(r\.rc, 1|status, 1|rc, 1" scripts/check-debt-budget.test.js scripts/lib/git-domain.test.js` 零命中；`rg -n "check\(" scripts/check-debt-budget.test.js` 零命中；`node --test scripts/check-debt-budget.test.js` 11/11 通过但只证明 0/2 档 | 建议补一条“baseline 小于 current”的夹具断言 rc=1 且输出含违规行

Info | scripts/lib/git-domain.test.js:123 | 断言 `!d.has('.gitignore') || d.has('.gitignore')` 恒真，属装饰性断言（与本 PR 宣称要消灭的 M11 同型） | 直接读文件确认该表达式恒真；`node --test scripts/lib/git-domain.test.js` 10/10 通过，该行无法提供任何区分度 | 改为 `assert.ok(d.has('.gitignore'))`（夹具 `addAll` 已把 .gitignore 纳入索引）或删除该行

Info | scripts/check-debt-budget.js:169-172 | 注释写“只持久化这 5 个数值口径”，但 `PERSISTED_KEYS` 实际是 7 个键且含非数值的 `maxFilePath`；`--update` 还会丢弃旧账本的 `scannedAt`/`circularDepDetails`，且没有针对新落盘形状的测试 | 读源码确认；`scripts/debt-baseline.json` 现有 `scannedAt`、`circularDepDetails`，均不在 `PERSISTED_KEYS` | 校正注释，并加一条 `--update` 只写 `PERSISTED_KEYS` 的断言，确认丢弃旧键是有意行为

Info | scripts/check-debt-budget.js:74-82 | `measureModelProviderFanOut` 不经域过滤（直接 existsSync/readFileSync）；真仓该文件受管、无行为变化，但 `--root` 换树时若该路径是“磁盘存在但被忽略”的产物仍会计入，与“域 = 该不该被量”不一致 | 读源码确认；未实测该边角（不写文件） | 加 `domain.has(MODEL_PROVIDER_PATH)`，或在 `--root` 文档说明该项按单文件磁盘存在读

Info | scripts/check-debt-budget.test.js:34-43、87、104 | 夹具构造了隔离 env，但 `collectMetrics`/`gitDomain` 调用都不传 `{env}`，实际走测试进程的 `process.env`（git-domain.js:45 默认 process.env）；机器 global/system 配置若命中夹具路径，测试会随机器态漂移 | 读测试源码确认 `B.collectMetrics(f.root)`、`B.gitDomain(f.root)` 均无 opts；本机 11/11 通过 | 给 `collectMetrics` 增加可选 `opts.env` 透传，或测试改调 `gitDomain(f.root, {env: f.env})`

Info | scripts/lib/git-domain.test.js（全文件） | 声称“git-domain.test.js 11 条”，实测只有 10 条；模块顶部“六条语义 ①-⑥”编号（git-domain.js:11-25）与测试用例 ①-⑩ 编号不对应（doc ①=不退回磁盘全量，test ①=受管文件） | `rg -n "^test\(" scripts/lib/git-domain.test.js | Measure-Object` → 10；`node --test scripts/lib/git-domain.test.js` 汇总 `tests 10`；两文件比对确认编号错位 | 订正提交信息/任务书里的计数；统一两处编号或互相引用

## 独立验证记录

- `git show a8c0e29f9 --stat`：7 文件、+573/-59，与任务书一致。
- `node scripts/check-debt-budget.js` → rc=0、`[debt-budget] domain=10050`、`filesOver500: 95 (baseline: 101)`、`filesOver1000: 28 (baseline: 32)`、`circularDeps: 0`。声称的 `domain=10048` 在本树不可复现（域 = 索引 ∪ 未忽略未跟踪，含评审 brief 等树状态文件；差异属机器/树状态，按设计）。
- 同树 A/B（系统临时目录最小 git 夹具，未触碰被审工作树）：旧实现 `filesOver500=2`、新实现 `=1`，DELTA=1，与声称的 96→95 同机制且独立复现。
- `node --test scripts/lib/git-domain.test.js` → 10/10；`node --test scripts/check-debt-budget.test.js` → 11/11（内含计数锁：child `tests=11 pass=11 declared=11`）；`node --test .github/scripts/check-max-lines.test.js` → 36/36。
- `node scripts/check-unwired-tests.js` → OK（检查域内 102 个测试文件全部接线）。
- 函数身份：`node -e` → `{budget:true, max:true}`，两个消费者与共享实现是同一 `gitDomain` 函数对象。
- CI 接线：两个新套件位于 `quality-gate.yml` changes job 内（102-103 行）、docs-only 短路与非 PR 早退之前；`check-unwired-tests` 通过。
- 退出码分档：真仓 rc=0、非工作树 rc=2、`--root` 缺值 rc=2 均实测；rc=1 未覆盖（见 Warning）。

全程未跑任何写型命令；除本评审文件外未在评审工作树创建/修改文件。工作树中 `CHANGELOG.md` 的修改与 `openspec/records/debt-budget-git-domain.md` 的新增为并发会话状态，未触碰。
