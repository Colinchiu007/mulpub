# QM-6 后端/逻辑轴评审：max-lines-git-domain（提交 1aecfedeb）

VERDICT: NEEDS_REVISION

## Critical

- 检出后磁盘上生成、因历史 `git add -f` 而“被跟踪但命中 .gitignore”的产物（.gitignore:415-419
  刚在 #3782 移出跟踪，`git ls-files` 会按索引无条件列出它们）会在加回跟踪瞬间重新成为超限假红；
  这不是本提交引入的错误（“被跟踪就该被量”语义自洽），但回归锁缺这一格。每条引用见下。

## Warning

- “索引里有但磁盘已删”时域包含该文件、`readFileSync` 静默 skip（check-max-lines.js:151、
  test 的 179 同式），未挂账的超限幽灵被无声放过；真实仓 dirty worktree 里暂存删除即可达，
  `ls-files` 不随磁盘删除消失，且没有显式测试锁这个行为。
- `--root` 指向仓库子目录时 `git ls-files` 的输出相对该 cwd，`scanFiles` 的 rel 同以 root 为基准，
  两者坐标系一致；但嵌套仓（root 内另有 .git）时域切到内层仓，无守卫无测试。当前 CI 只有全仓根，
  可达性低，建议加注释或断言，不必为此改分档。
- 真实仓交叉探针只覆盖了 gitDomain 的默认 `ROOT`（check-max-lines.test.js:496-497），而“域 ==
  status 口径”只对根成立；对 `--root` 子目录这一受支持模式没有任何探针，故障只能靠同一套函数联调发现。

## Info

- 退出码 2：CI 由 actions/checkout 提供 git，git 不可达时红是合理 fail-closed；空仓本就不该跑此门禁，
  浅克隆/detached HEAD/只读检出都不影响 `ls-files`，set.size==0 抛错可达但属预期。若想区分“环境不可达”
  与“判据坏了”，可用 rc=3 + workflow continue-on-error，但没有证据表明必须。
- 64MB maxBuffer 对本仓够（domain≈9943 条，估算远小于 1MB），并将 SCAN_DIRS 作为 pathspec 传入
  `ls-files -z` 两处可把域缩小到扫描用部分且不改变判定结果：受管文件仍被 `ls-files` 列全、`--others
  --exclude-standard` 在 pathspec 内语义不变；但 `真实仓交叉探针` 的账本键全仓校验会失去对象，
  收窄时需同步缩小该断言。`--exclude-standard` 仍是承重旗标，收窄不得去掉它。
- 探针的 tracked 半边与实现逐字同命令（check-max-lines.js:128、test 503），只有 untracked 半边
  经 status 独立验；同源同向故障不会现形，这正是“域必须等于 git status 口径”锁的实际上限。
  其余六条新锁均为变量可测：gitignored 夹具可同时截获 M1/M5，未跟踪夹具截获 M2，
  非工作树 CLI rc=2 截获 M3、空域直接断言截获 M4、留痕两向锁截获 M6；-z 解析对 `?? ` 记录
  slice(3) 正确，`R`/`A` 记录因 `--no-renames` 与“只加 ?? ”而不会被误吞。

核证证据：check-max-lines.js:117-136（域构造）、138-153（扫描与静默 skip）、448-470（rc=2 与留痕）；
check-max-lines.test.js:454-465（ignored 夹具）、467-474（unignored 夹具）、477-492（fail-closed CLI）、
495-514（真实仓交叉探针）、517-522（空域）、525-534（留痕）；.gitignore:409-419（bundle-untrack 五件套）。
