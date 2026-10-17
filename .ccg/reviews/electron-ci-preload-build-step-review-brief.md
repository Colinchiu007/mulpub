> 注：本文件是评审**输入任务书**的原件。其中要求评审者写出的产物路径（.tools/tmp/…）是会话工作目录，未入库；该通道实际把结论打进了 stdout，结论原件见同目录 …-review-single.md。

# 任务：对一份 CI 修复做单模型深度审查（只读，禁止修改任何仓库文件）

## 背景事实（都可复核，不是我的猜测）

GitHub 仓库 Colinchiu007/mulpub 的 `Electron CI` workflow：

- **push 事件**自 2026-10-17T05:36:40Z 起连续 15 次 failure；最后一次 success 是 04:15:58Z（head `0a0d3581b`）。
- 同一条 workflow 在 **pull_request 事件**全部 success。
- 失败作业与步骤固定：`electron-tests` 的 `Unit tests (Vitest, non-Electron, single-worker deterministic)`。
- 该步骤 YAML 里带 `if: github.event_name != 'pull_request'` ⇒ **只有 main push 才跑**，这正是"PR 绿 / push 红"的来源。
- 现场 9 个测试文件红，逐个取证（从 Actions 失败日志读原始行）都是同一形状：
  `ENOENT: no such file or directory` 或 `Cannot find module`，指向上面那 5 个产物之一。

根因：上游 PR #3782（提交 `826fa7e13`，change `bundle-untrack`）把 5 个受管构建产物移出版本控制
（`.gitignore` 新增 11 行并删除这 5 个文件），并给 `quality-gate.yml` 的三个消费 job 各补了一步
"先重建再测"，**漏了 `electron-ci.yml`**。

5 个产物（现均为 gitignored 工作树文件）：
`apps/desktop/electron/home-shell-preload.bundle.js`、`apps/desktop/electron/monitor-preload.bundle.js`、
`apps/desktop/electron/preload/index.bundle.js`、
`apps/desktop/electron/services/generated/card-paginator.iife.js`、
`apps/desktop/electron/services/stealth/stealth-preload-enhanced.bundle.js`。

## 本次改动（2 个文件、98 行，diff 在 `.tools/tmp/ci-fix.diff`）

1. `.github/workflows/electron-ci.yml`：在测试步之前插入 `- name: Build preload bundles`，
   正文两条命令 `pnpm --filter @multi-publish/desktop run build:preload` / `... run build:paginator`，
   并带**与测试步逐字相同**的 `if: github.event_name != 'pull_request'`。
2. `.github/scripts/workflow-contract.test.js`：新增两条契约测试。
   - 扫描锁：遍历 `.github/workflows/*.yml` 的**所有** job，凡跑桌面 vitest 全量者，
     必须存在一步同时重建上述两个脚本、且该步索引小于测试步索引；含"覆盖面下界 >= 3"的反失明断言；
     含 `electron-ci.yml` 重建步与测试步 `if` 必须相等的配对断言；承认清单初始为空、只能缩小。
   - 行为锁：用合成 steps 数组直接喂 `judgeDesktopSuiteJob`，断言
     正确顺序=OK、反顺序=BUILD_AFTER_TEST、缺重建=MISSING_BUILD、
     `test:startup`=NOT_A_CONSUMER、`node --test`=NOT_A_CONSUMER。
   - 已实跑 5 道变异反证 + 1 道未变异正控：A1 摘掉整步 / A2 让 `if` 漂移 / A3 漏一条脚本 /
     A4 把消费者谓词改成永不命中 / A5 把顺序那一支改成永不成立，各自让**指名的那条**变红，正控全绿。

## 请逐条回答（每条都要"成立/不成立 + 依据（文件:行 或 具体机制）"，不要泛泛而谈）

- **C1 正确性**：新步骤能否真正修好上述红？插入位置与 `if` 是否一致且够用？该 job 里是否有**更早**的步骤
  其实也读这些产物（那样红应该更早出现，说明我的根因不完整）？是否有"PR 上白跑"或"dispatch 漏跑"的形态？
- **C2 谓词的宽窄**：消费者谓词只认两种命令行形态，并把 `test:startup` 排除，
  排除依据是"build.yml 的 build job 无重建步骤而 push 实测 success"。
  请判定：这个排除会不会把下一个真消费者放过去。**不要猜**——请给出你认为应如何系统性地找出真消费者清单
  （例如从测试文件侧反查读取这 5 个产物的用例，再映射到 job），并指出我这套做法漏在哪一步。
- **C3 装饰性风险**：新增的两条锁里，有没有哪条断言在任何真实改动下都**不可能**变红？
  特别检查：`buildIdx > testIdx` 那一支在扫描锁里是否真的可达（我的收集器只取"第一个同时含两脚本的步"，
  若某 job 有两个这样的步、一个在前一个在后，判据会怎样？），以及 `if` 配对断言在
  `build`/`test` 两步 `if` 都缺省（undefined）时会否静默通过。
- **C4 副作用**：本仓 `.github/scripts/check-max-lines.js` 用 `readdirSync` 遍历**工作树**且不读 `.gitignore`，
  实测本机跑它会把 `home-shell-preload.bundle.js`(1795 行) 与 `preload/index.bundle.js`(1744 行) 报成
  `NEW_OVER_LIMIT`，把这两个文件挪开后 rc=0。请判定：CI 里是否存在"先构建产物、后跑该检查"的 job
  （若有，本 PR 会让那条门禁新增红），以及该 checker 的域该怎么修才对。

## 输出要求

- 结论**写进文件** `.tools/tmp/ci-review-claude.md`（该路径必须在你被审的那个工作目录内），
  同时把结论原文打到 stdout。
- 允许：读文件、`git diff`/`git log`/`git show`、跑 `node --test` 类只读验证。
- 禁止：修改任何仓库文件、执行写型变异、提交或推送。
