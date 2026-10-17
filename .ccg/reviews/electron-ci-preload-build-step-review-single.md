# QM-6 外部评审原件（单模型：`mode=SINGLE`，替代通道 opencode/big-pickle）

- change: `electron-ci-preload-build-step`（Electron CI push-only 桌面全量测试补「先重建产物」+ 跨 workflow 配对锁）
- 通道：`opencode-cli run --agent general --model opencode/big-pickle`；任务书已随本目录入库 =
  `electron-ci-preload-build-step-review-brief.md`（评审者被要求读的就是这份，故其结论可复核到输入原文）
- 驱动退出码 0；结论只出现在 stdout（该通道未落文件）。判定口径 = 「产物落盘 **或** stdout 有结论」二者之一成立即算有结论。
- 同一时段 `codeagent-wrapper --backend claude` 三次尝试均以 `status 1` 退出且 wrapper 自删日志、零产物；
  同通道一句短探针（`只回答两个字：就绪`）返回 rc=0 ⇒ 故障定位在「带工具调用的长任务」这一格，不是通道整体不可用。
- `scripts/ccg-review-decider.js` 判定 `mode=SINGLE`（98 行 / 2 个源文件 / 无敏感命中）⇒ 不属双模型强制范围。
- 下文「评审原话」为模型输出逐字粘贴（仅剥 ANSI）；「逐条处置」是我的判定，两者不得混读。

## 评审原话

**C1 正确性**：成立  

依据：
- 失败固定出现在 `Electron CI` 的 push 事件（PR 全部成功），失败步骤 `Unit tests (Vitest, non-Electron, single-worker deterministic)` 位于 `electron-tests` job，YAML 里带 `if: github.event_name != 'pull_request'`（#10），这与“PR 白跑 / push 红”的事件形态完全吻合。
- 根因是 #3782 把 5 个受管构建产物移出版本控制（新增 `.gitignore` 行并删除这 5 个文件），但只在 `quality-gate.yml` 补了三个 job 的“先重建再测”，漏了 `electron-ci.yml`（#14–#17）。本次改动在 `electron-ci.yml` 的测试步之前插入 `Build preload bundles`，并使用与测试步逐字相同的 `if: github.event_name != 'pull_request'`（#26–#29）。因此仅在 main push 执行该构建，PR 不受影响。
- 插入位置在测试步之前，且新增步骤与测试步条件一致，足以在 Vitest 单元测试运行前生成 `apps/desktop/electron/home-shell-preload.bundle.js`、`monitor-preload.bundle.js`、`preload/index.bundle.js`、`services/generated/card-paginator.iife.js`、`services/stealth/stealth-preload-enhanced.bundle.js` 这 5 个产物，修复了 `ENOENT/ Cannot find module`（#11–#12）。  
- 关于“是否有更早的步骤其实也读这些产物（那样红应该更早出现）”：在 `electron-tests` job 内，测试步之前只有 `Checkout`、`Setup pnpm`、`Install dependencies`、`Download Playwright browsers` 等准备步骤，这些步骤不读取上述 5 个 bundle 文件。Vitest 测试才是首个可能直接 `require()`/导入这些构建产物的步骤，因此红点在测试步是合理的，本次补建位置恰当。

**C2 谓词的宽窄**：不成立  

依据：
- 合同测试（#30–#37）用的消费者谓词只认两种命令行形态（`pnpm --filter @multi-publish/desktop run build:preload` 与 `pnpm --filter @multi-publish/desktop run build:paginator`），并把 `test:startup` 明确排除（#44）。排除理由是“build.yml 的 build job 无重建步骤而 push 实测 success”（#44）。但这个排除是基于历史观察而非基于依赖分析，存在把未来真消费者排除的风险。
- 系统性找出真消费者清单的正确做法（#45–#46 要求）：
  1. **按产物反查读取方**：在测试文件和源码中精确搜索这 5 个产物路径或文件名：`rg -n "home-shell-preload\.bundle|monitor-preload\.bundle|preload/index\.bundle|card-paginator\.iife|stealth-preload-enhanced\.bundle" apps/desktop`（同时搜索 `apps/desktop/tests`、`apps/desktop/src`、`apps/desktop/electron`），找出所有直接/间接读取这些 bundle 的测试用例和代码位置。
  2. **按测试用例映射到 job**：将上述命中的测试文件映射回触发它们的 workflow/job（`electron-ci.yml` 的 `electron-tests` job、`quality-gate.yml` 的相关 job），确认哪些 job 真正需要这些产物，而不是只靠“是否跑这两条 pnpm 命令”去推断。
  3. **验证运行时消费**：区分“构建产物是否存在”（文件系统）与“测试是否实际 require/加载”（运行时路径）。某些 job 可能跑不同脚本（如 `test:*`、`vitest` 直接调用）却仍依赖这些 bundle；消费者谓词只看命令行形态无法覆盖这种情况。
- 当前做法只靠命令行形态推断消费者，没有做步骤 1–2 的反查，因此无法排除“未来新增一个真消费者 job 却不匹配这两条命令形态而被排除”的可能性。尤其是 `build.yml` 的历史成功不能证明所有未来消费者都不需要这些产物。

**C3 装饰性风险**：不成立  

依据：
- 扫描锁的逻辑（#48–#50）只取“第一个同时含两脚本的 step”（#48），若某个 job 存在两个都包含这两条 build 命令的 step（一个在测试前、一个在测试后），当前实现只检查首个匹配项的索引是否 < 测试步索引。虽然测试步之后那个多余的 build step 不影响修复，但锁本身无法检测“是否恰好只有一个必要的重建步且位置正确”，也无法保证不出现冗余/错误配置。
- `if` 配对断言（#49–#50）要求 `build` 步与 `test` 步的 `if` 字段必须相等。如果两步都缺省 `if`（undefined），在 YAML 中它们“都没有 if”，但在对象比较层面会是 `undefined == undefined`，配对断言会静默通过；这不能保证“应该共享同一条件”的意图被实际表达出来。换言之，缺省（隐式全跑）和显式写相同条件在语义上相同，但锁没法区分“忘记加 if”与“故意相同”。此外，如果 build 步有 if、test 步缺省，或反之，也会因 undefined 比较导致漏判。
- 变异反证（#36–#37）列出了 5 道反证 + 1 正控：A1 摘掉整步、A2 让 `if` 漂移、A3 漏一条脚本、A4 把消费者谓词改成永不命中、A5 把顺序那一支改成永不成立，各自让指名的那条变红。这些变异覆盖了主要路径，但没有覆盖上述两种情形（重复 build 步的首个匹配语义、两步均缺省 if 的配对语义），因此锁仍存在未覆盖的装饰性风险。

**C4 副作用**：不成立  

依据：
- `.github/scripts/check-max-lines.js` 用 `readdirSync` 遍历工作树且不读 `.gitignore`（#51–#52）。在构建前，它只看到 git 管理的文件（不含这些 bundle）；但一旦 `Build preload bundles` 步骤先于该检查运行（在任何 job 中），工作树里就会出现这 5 个 >1700 行的 gitignored 构建产物，`check-max-lines.js` 会把它们识别为“工作树文件”并报 `NEW_OVER_LIMIT`，导致相关 job 失败。
- 这 5 个文件在当前仓库中是构建产物（#18–#22），按 `.gitignore` 规则应被忽略。检查器如果不尊重 `.gitignore`（或至少排除这组已知构建产物），就会把构建产物误判为新增文件超限。
- 因此需要确认 CI 中是否存在“先构建产物、后跑该检查”的 job（#53）。如果 `quality-gate.yml` 的静态检查 job（或其他 job）在某些路径下会先执行构建（或允许构建产物残留）再跑 `check-max-lines.js`，本次改动就会间接引入红灯。修正方式是：让 `check-max-lines.js` 的扫描域排除 `.gitignore` 匹配的路径（或显式排除这 5 个 bundle 路径/`apps/desktop/electron/**.bundle.js`、`apps/desktop/electron/services/generated/**` 等构建产物目录），或者确保静态检查在构建前运行且构建产物不进入检查范围。

结论：C1 成立；C2 不成立；C3 不成立；C4 不成立。
OC_RC=0
## 逐条处置（当场取证后）

- **C1 成立**（评审同意根因与修法）。补充一条它没问到的现场：同 job 内 `Electron smoke test` 排在测试步之后，
  也被这次重建覆盖（此前该 job 在测试步就断掉，smoke 从未跑到 ⇒ 那一步的现状是未知的，本 PR 顺带把它恢复可运行）。
- **C2 不成立 = 接受为已登记的遗留，不采纳其修法**。它要求的"从产物反查读取方 → 映射到 job"我当场做了：
  `apps/desktop` 里提到这 5 个名字的用例共 10 个，其中真读盘的 9 个即红名单，另 2 个只做形状断言/喂 mock 路径
  （`webview-manager.test.js` 的 `toMatch(/monitor-preload(\.bundle)?\.js$/)`、`home-shell-title.test.js` 的 `/fake/monitor-preload.bundle.js`），
  与根因一致。但它建议"把消费者谓词扩到更多命令行形态"——实测全域当前**没有**任何 job 用 `working-directory: apps/desktop`
  或直接 `vitest run`（两条 grep 均 0 命中），为一个不存在的形态加分支只会得到一条无现场覆盖的死判据，故不加，
  只把它写进「遗留」作为下一次的收敛方向（并保留 A4 那条"谓词永不命中必须红"的正控）。
- **C3 部分成立，已采纳其 (b)**。它指出"两步都缺省 `if` 时 `undefined == undefined` 会静默通过" ⇒ 已把关系型判据
  升级为绝对值判据（新测试：两步的 `if` 必须等于字面量 `github.event_name != 'pull_request'`）。
  但采纳后实测修正了它的严重度：同一文件里既有的「CI 提速契约」第 5 项**已经**锁住测试步必须限定非 PR，
  A6（两处 if 一起删）的红集同时命中两处 ⇒ 本条从"补一个失明洞"降级为"把配对称显式化 + 覆盖到新增的重建步"。
  其 (a)（同一 job 里两个重建步）不采纳：本锁守的是"有重建且早于测试"，多一个冗余重建步不构成缺陷，不为其加判据。
- **C4 不成立 = 否证**。它的前提是"存在先构建、后跑 `check-max-lines` 的 job"。实测：`check-max-lines` 只被
  `debt-guard.yml` 调用（该 workflow 无任何构建步骤，且各 job 各有独立检出，electron-ci 的构建不会泄漏进去），
  `electron-ci.yml` 内该检查出现 0 次 ⇒ 本 PR 不引入新红。checker 自身"遍历工作树不读 .gitignore"的缺陷属实，
  已另立任务单独处理（动判据域属"改谁来守门"，不在本 PR 顺手做）。

## 反证复跑（采纳 C3(b) 之后，六道 + 一正控）

A1 摘掉整步 / A2 只让重建步 if 漂移 / A3 漏 build:paginator / A4 消费者谓词永不命中 /
A5 顺序那一支永不成立 / A6 两处 if 一起删 —— 全部 CAUGHT 且红集互不相同；A0 未变异 42/42 全绿。
每道跑完按 md5 逐字节还原。

