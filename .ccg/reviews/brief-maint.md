你是独立评审者（可维护性/集成风险轴）。被评审代码在绝对目录 D:/Data/projects/mp-worktrees/mp-ux-audit-accounts-text-tokens （git 分支同名，已暂存未提交）。

⛔ 三条硬规矩：
1. 只读那个目录里的文件（一律绝对路径）。不要读 D:/Data/projects/Mulpub（共享主工作区，是 main 的旧副本）。
2. 你唯一可以写的文件是 D:/Data/projects/mp-worktrees/mp-ux-audit-accounts-text-tokens/.ccg/reviews/accounts-text-tokens-review-maint.md 。禁止创建/修改其它任何文件，禁止任何 git 写操作。
3. 结论写进上面那个文件，同时打印到 stdout。每条 finding：严重度 + 文件绝对路径:行号 + 一句主张 + 一句证据。不超过 40 行，不要复述代码。

这批做了什么：把 apps/desktop/src/views/Accounts.vue 里 30 处裸 hex 文字色换成设计令牌 var(--color-*)，并新增一把"两档主题下 WCAG AA 对比度"的判据（apps/desktop/src/views/Accounts.text-contrast.test.js）、一个把判据机制收敛成一份的实现（apps/desktop/src/styles/color-token-reader.js）、一份只能缩小的欠账基线（同目录 .json）。

请重点回答四问：
Q1 仓里已有四份"读 token 算对比度"的测试（搜 apps/desktop/src 下的 tokens.slots / tokens.aliases / sidebar.tokens / ep-theme.tokens 四个文件名）。新增的第五份有没有和前四份重复实现同一判据？如果有，指出应该收敛到哪一份、以及会不会有前四份里已有的断言被这次新实现"看似覆盖"其实没覆盖。
Q2 新实现只在测试里被消费（不是运行时模块）。有没有"注册了但没人调用"的接线风险？请用具体证据回答：谁 require/import 了 color-token-reader.js。
Q3 该文件有两个 style 块，判据靠遍历所有块。这个假设在什么真实编辑动作下会静默失效（例如有人把 style 合并成一块、或加了第三个非 scoped 块、或把颜色写进 template 内联 style）？点名你认为需要补的锁。
Q4 基线 json 里 status 有两类：needs-design（现值不过 AA 且换任何 token 都过不了）与 compliant-bare（现值过 AA 但没收成 token）。这两类的销账路径在测试里有没有被机械区分？如果一个人把 needs-design 的 selector 改名，测试会红还是会安静放过？

必须引用到这几个只在新代码里存在的符号名才算读到了被评审的代码：effectiveBg、compliant-bare、SURFACES、surfaces。引用不到请在结论第一行写 NO_READ。
