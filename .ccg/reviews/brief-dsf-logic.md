# 评审任务书（逻辑/正确性轴）— PR #3357 desktop-shard-flag

## 你在审什么

分支 `desktop-shard-flag`，仓库根 = 当前工作目录，head `b680f413044f85b03cd03c6b317324004b025fa5`（PR #3357）。
主题：`.github/workflows/quality-gate.yml` 的 `Desktop tests shard` 步骤里有一个裸 `"--"`，pnpm 原样交给脚本，
vitest 在 `--` 处停止解析选项 ⇒ 七个旗标（含 `--shard`）全部静默失效，两个 matrix 腿各跑全量 873 个文件。

取证命令：`git show b680f4130`、`git diff origin/main...HEAD`、读
`scripts/check-desktop-shard-forwarding.js` / `.test.js`、`openspec/records/desktop-shard-flag.md`、
`.ccg/reviews/shardflag-mutations.txt`、`.ccg/reviews/shardflag-ps3state.txt`。
可跑的**只读**测试：`node --test scripts/check-desktop-shard-forwarding.test.js`、
`node scripts/check-desktop-shard-forwarding.js`。

## 必须逐项回答（每条给"文件:行 + 实测/读数"，不许凭印象；没有发现也要明确写 NO_FINDING）

1. **探针与被测对象是否同形**。行为层的"被调用方"是临时 workspace 里一个叫 `@mpfwd/probe` 的假包，
   它只打印自己收到的 argv。请判定：这**能**证明 pnpm 把旗标送到了脚本，**不能**证明什么？
   特别是"vitest 是否真的按 `--shard=1/2` 只跑一半文件"这件事，现在的锁有没有任何一环覆盖到；
   若没有，请给出**最小**补证方案（不要提出跑全量 vitest 那种重方案），并说明它该落在哪个文件。
2. **续行扫描的漏判形态**。`findContinuationSevers` 现在只判"反引号续行的下一行是注释行"。请实测或推演
   并逐条回答：① 下一行是**空行**时 PowerShell 会怎样（这是我在 workflow 里加注释时最容易顺手写出的另一种形态）；
   ② 同一行行尾有**两个**反引号；③ 续行符出现在**双引号字符串内部**（例如 `"abc\``）；
   ④ 注释行前面是制表符而非空格；⑤ 注释在续行**之前**（合规）会不会被误判。
   哪些是真漏、哪些是假阳，各给一个具体串并说明现在红不红。
3. **锚点抹空是否把问题挪走了**。`parseShardArgv` 现在把 `^\s*#` 开头的行整行替换成空串再起锚。
   请核：① YAML 层的注释与 pwsh 层的注释被同一规则一并抹掉，会不会让正则跨过一个真实存在的
   `-ArgumentList @(` 而去匹配**下一个 job** 的同名数组（跨步骤串台）；② 4000 字符窗口截尾在注释被抹空后
   是否仍然够；③ 有没有"抹空后行号/偏移错位导致 slice 边界算错"的具体形态。
4. **定数结论是否自洽**。记录说"本 PR 使 `PROVENANCE.shardMaxSuccessMin`(29.77) 立即过期，但不收紧预算"。
   请对照 `scripts/gate-budget.js` 的 `checkSizing()`（`HARD_RATIO=0.9`、`WARN_RATIO=0.8`、`×1.5` 直查、
   `MIN_SAMPLE_GATE4_SUCCESS=20`）判定：这句话与该文件自己的规则是否矛盾；
   以及"贴脸时要截尾样本"这条在分片真的生效后会不会把下一个会话推向"重定一个没问题的数"。
5. **三处自述有没有互相矛盾或过度声明**。同一件事写在
   ①`scripts/check-desktop-shard-forwarding.js` docblock、②`openspec/records/desktop-shard-flag.md`、
   ③`CHANGELOG.md` 顶部那条、④PR 正文（见 `.ccg/reviews/brief-dsf-logic.md` 同目录无正文，可用
   `gh pr view 3357 --json body`）。请逐处读，指出任何一处说了另外三处没有支撑的话，
   特别是"两个 matrix 腿各跑全量"这一结论是否被"两腿日志汇总逐字相同"唯一确定（有无第三种解释）。
6. **CI 会不会真的兜住**。`node --test … scripts/check-desktop-shard-forwarding.test.js` 接在 Gate 3、
   `node scripts/check-desktop-shard-forwarding.js` 是否也被点名执行（请读 workflow 正文确认，不要信记录）。
   若只有 `--test` 被接、本体没接，说明"注册≠注入"的缺口在哪里。

## 硬约束

- **只读**。不得修改、创建、删除任何文件；不得 `git commit/checkout/reset`、不得跑变异脚本、不得跑 pnpm install。
  只允许 `git show/diff/log`、`gh pr view`、读文件、跑上面两条现成的只读检查。
- 结论**必须全部打进 stdout**，每条一行，格式 `SEVERITY | 文件:行 | 问题 | 建议`，最后 `TOTAL=<条数>`。
  若选择写文件，只准写 `.ccg/reviews/dsf-logic.json`，且 stdout 仍要有同样结论。
- 标签要诚实：不确定就写 INFO，不要把"我核过了没问题"标成 CRITICAL。
