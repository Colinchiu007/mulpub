你是独立评审者（逻辑/正确性轴）。被评审代码在绝对目录 D:/Data/projects/mp-worktrees/mp-ux-audit-accounts-text-tokens （git 分支 mp-ux-audit-accounts-text-tokens，已暂存未提交）。

⛔ 三条硬规矩：
1. 只读那个目录里的文件（一律用绝对路径）。不要读 D:/Data/projects/Mulpub（那是共享主工作区，是 main 的旧副本，不是被评审的代码）。
2. 你唯一可以写的文件是 D:/Data/projects/mp-worktrees/mp-ux-audit-accounts-text-tokens/.ccg/reviews/accounts-text-tokens-review-logic.md 。除此之外禁止创建或修改任何文件，禁止执行任何 git 写操作（add/commit/checkout/stash/merge）。
3. 结论必须落在上面那个文件里，同时也把全文打印到 stdout。每条 finding 给 严重度(Critical/Warning/Info) + 文件绝对路径:行号 + 一句主张 + 一句你据以判断的证据。总长不超过 40 行，不要复述代码。

必读文件（全部在上述 worktree 内）：
- apps/desktop/src/styles/color-token-reader.js （新增：CSS token 解析 + WCAG 相对亮度比 + 阈值分档 + style 块扫描）
- apps/desktop/src/views/Accounts.text-contrast.test.js （新增：判据）
- apps/desktop/src/views/Accounts.text-contrast-baseline.json （新增：欠账基线，只能缩小）
- apps/desktop/src/views/Accounts.vue （改动：30 处 color 声明由裸 hex 换成 var(--color-*)）
- apps/desktop/src/styles/tokens.css （既有 token 真源，只读）

请重点回答四问：
Q1 判据会不会"恒真"？特别是：解析器把文件读空/读成空集合时，测试是变红还是安静通过？请指名具体行。
Q2 阈值分档（3:1 与 4.5:1）的取法有没有会把真缺陷读成合规的口子？大文本判据依赖 font-size 经 var() 解析，解析不出来时落在哪一档，方向是严还是松？
Q3 该测试用"规则自己的 background，否则页面 inset 底色"当文字底色。这个模型在什么形状的真实 CSS 上会算出错的比值？给出你能在该 worktree 里指认的具体选择器，没有就明说没有。
Q4 把裸 hex 换成 token 会改变浅色档的像素。请在 Accounts.vue 的 diff 里找出「浅色档计算值发生了变化」的那些点（对比原字面值与 token 浅色值），判断有没有哪一处换完会让语义变掉（例：删除类动作的颜色、警示色、主操作色）。点名选择器。

必须引用到这几个只在新代码里存在的符号名才算你读到了被评审的代码：effectiveBg、scanStyleRules、compliant-bare、needs-design。引用不到就说明你没读到，请在结论第一行写 NO_READ。
