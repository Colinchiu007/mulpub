# QM-6 外部评审 · 前端/可维护性轴结论（change: max-lines-git-domain，被审提交 1aecfedeb）

VERDICT: PASS

本轴核过四类证据：被审 diff（git show 1aecfedeb）、两份门禁脚本现状、
`debt-guard.yml` 消费者、以及在本 worktree 上的只读复现（两脚本均以检查模式运行，无写盘）。
未发现会让门禁行为出错的 Critical；以下均为可维护性层面的 Warning / Info。

## Critical

无。

## Warning

- W1（问题 1）「域」判据现在是两份实现：`.github/scripts/check-max-lines.js` 已收成 git 域
  （`gitDomain`，check-max-lines.js:117，main 只取一次传下去 :463/:469/:473），但
  `scripts/check-debt-budget.js` 仍是磁盘域（`fs.readdirSync` / `readFileSync`，
  scripts/check-debt-budget.js:41 / :49），且 `debt-guard.yml` 里它排在逐文件门禁**之前**
  （debt-guard.yml:34 vs :42）。实测偏离已量化：本机带产物时 filesOver500=97 vs CI 95 基线 101
  （余量 4 恰好兜住）——两个 >500 行的产物（index.bundle 1803 / home-shell-preload 1752）正是
  修复前那两条 NEW_OVER_LIMIT 的同一根因，说明这是 #3782 的**同型假红**，只是被聚合口径吞了。
  「只修一个」**可接受**：方向是「本机更红」，CI 检出不带产物恒等于基线口径，merge 面不受
  影响；但本片**缺一份遗留登记**——.gitignore 注释（.gitignore:409-419）与提交信息都只谈
  check-max-lines，没有一行提醒「debt-budget 仍是磁盘域、偏差 +2、余量 4」。若未来 5 个产物里
  再过线一个、或基线经 --update 下调，本机 debt-budget 会先红而 CI 绿（复制本次假红形态）。
  若收敛，不建议本片顺手抽共享模块（扩大风险面）；最省的做法是 debt-budget 复用同一协议
  （`git ls-files -z` ∪ `--others --exclude-standard` 空集抛错），SCAN_DIRS 等字面量已有比对防漂移。

- W2（问题 2）`gitEnv` 的「屏蔽机器态配置」只做到**全局**维度，system 维度没关死：
  check-max-lines.test.js:415-416 把 `GIT_CONFIG_GLOBAL` 指到空文件、`delete GIT_CONFIG_SYSTEM`，
  但后者只是"不覆盖"——git 仍读默认 system 配置路径（`$(prefix)/etc/gitconfig`），
  且未设真正的开关 `GIT_CONFIG_NOSYSTEM`。装 system 级 `core.excludesFile` 或
  `init.templateDir` 的机器上，「夹具唯一变量是这份 .gitignore」（test:407）不成立。
  本机实测无 global/system excludesFile、无 init template，故当前机器与 CI runner 大概率干净，
  但没有代码级防护——这是测试"绿但依赖机器态"的残留口。补一行 `env.GIT_CONFIG_NOSYSTEM = '1'`
  即可闭合。

## Info

- I1（问题 2）gitEnv 每次调用在 `os.tmpdir()` 落一个 `maxlines-gitcfg-<pid>-<basename>.txt`
  空文件（test:413），且从不清理（rmRf 只删 fixture root）；本片 5 处调用，每跑一次测试 tmpdir
  多 5 个文件，Windows 下不会自动清。绝对量小，属碎片泄漏；建议 in fixture teardown 里一并删。
  「配置必须落在被测目录之外」本身**必要且充分**（必要：写进 root 会被 `git add -A` 拉进索引，
  T6「空仓库」夹具非空、空域判据点不到火——test:409-410 注释理由成立；充分：对全局维度成立，
  对 system 维度见 W2）。

- I2（问题 3）同一概念双名：`walkDir(..., domain)` 函数签名（check-max-lines.js:138）与内部
  `domain` 局部叫 `domain`，但 `scanFiles` / `scanTestFiles` 里又写
  `const set = domain || gitDomain(root)`（check-max-lines.js:199 / :162）——一个「该不该被量
  的集合」在两个函数里分别叫 `domain` 和 `set`，下一个读者会以为两者不是同一判据。
  建议统一起名（如都叫 `domain`）。

- I3（问题 3）术语「受管 / 域」并存：顶部已把「域」定义为首选口径（check-max-lines.js:27-32 /
  :109-116），但 `scanAllLines` 的 JSDoc 仍写「扫描全部受管源文件」（check-max-lines.js:189），
  `collectOverLimit` 注释也混用（:206），测试断言里再有「不受管的路径」（test:514）——读代码
  的人要在两词间做映射。建议把 :189/:206 改为「域内」；并在 `gitDomain` JSDoc（:117）或
  留痕文案（:468「(git 索引 ∪ 未忽略的未跟踪文件)」）加一句「集合内路径是相对扫描根的」——
  防止 `--root` 指向子目录时对坐标系想当然（与本仓既有事故同型，纯注释保护）。

- I4（问题 1 / 2 交叉）真实仓交叉探针（test:495-515）不套 `gitEnv`、探针与实现同读机器配置
  ——这是正确的设计（比的不再是配置差异），注释已写明（test:501）；同样地，留痕双通道
  （plain `domain=` :468 / JSON `domainSize` :556，测试 :525-535 两向锁住）也是本片少有的
  「声称与实现互证」好样板，值得其它门禁沿用。