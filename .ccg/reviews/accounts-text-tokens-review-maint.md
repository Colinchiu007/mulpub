# 外部评审（可维护性/集成风险轴）：Accounts 文字色令牌收编（ux-audit-accounts-text-tokens）

- 通道：codeagent-wrapper --backend claude --lite（AGENTS QM-6 的前端 primary，取自 ~/.claude/.ccg/config.toml 的 [routing.frontend].primary=claude）。
- ⛔ 前两次投递均未产出结论：第 1 次 stdout 906 字节、结尾把 tool-call 当正文吐出来；第 2 次报 claude completed without agent_message output（rc=1，wrapper 退出即删自己的日志 ⇒ 现场不可得）。第 3 次把任务书压成单行（避开 stdin 模式）后 rc=0 且结论完整。按 AGENTS「前端失败最多重试 2 次」用满三次。
- **本文正文是逐字复制**：claude 没有按任务书写文件，结论只出现在驱动 stdout ⇒ 由 .agent_context/stage/at-copy-review.mjs 从 driver-maint3.log 的「=== 可维护性轴评审」到下一个代码围栏之间整段摘出（35 行），未改写措辞、未调整严重度标签。处置与逐条核实见 openspec/records/ux-audit-accounts-text-tokens.md。

---

=== 可维护性轴评审：Accounts.text-contrast.test.js 及 color-token-reader ===

[Q1 判据重复]
1. IMPORTANT  "@" (列出如下) — 四份 tokens 测试各自内联实现 WCAG contrast：tokens.slots.test.js:49、
2.   tokens.aliases.test.js:79、sidebar.tokens.test.js:105、ep-theme.tokens.test.js:134，均未 import reader
3.   (color-token-reader.js:4-8 自陈)。新判据 Accounts.text-contrast.test.js:30 是第五份公式的消费方。
4.   结论：新判据正确复用共享模块、未新增重复实现，但「同一对比度判据」实为 5 套并存，收紧公式需改 5 处。

[Q2 接线风险 —— 谁 import reader]
5. IMPORTANT  只有三处接线：Accounts.text-contrast.test.js:31、color-token-reader.test.js:11、生成器
6.   .agent_context/stage/at-check.mjs:8。四份 tokens 测试完全绝缘 —— reader 坏只影响 Accounts 判据+生成器，
7.   四份 tokens 测试照旧用自己的副本 ⇒ 共享实现收编未落地，形成双事实源。

[Q2b 生成/校验契约漂移 —— 最高危单点]
7. RED-CRITICAL  at-check.mjs:49-50 生成 status『no-token-candidate』，但合规测试只认两档
8.   ['needs-design','compliant-bare']（Accounts.text-contrast.test.js:127,129），且 committed 基线用
9.   'compliant-bare'（Accounts.text-contrast-baseline.json:19,43）。重跑 at-check 立刻假红；同时 at-check
10.   只写 exemptions、不产出『surfaces』，而基线含 surfaces 且测试 line 148 断言其数 ⇒ 基线不可再生。

[Q3 双 style 块静默失效的编辑动作]
11. MEDIUM  scanStyleRules 体正则 color-token-reader.js:114 `([^{}\n]+)\{([^{}]*)\}` 遇嵌套即断：
12.   把某条规则包进 @media/@supports/SCSS 嵌套(&:hover)时内层声明整体丢弃，且 :116 选择器首字符白名单
13.   不含『@』，@media 子树整棵被滤。Account 测试 line 59-61 的数下界（rules>10/color>30）在大文件下
14.   仍可能满足 ⇒ 某条未登记的裸 hex 规则平移进 @media 后从判据静默消失（不是红、是看不见）。
15.   （needs-design 登记项因 line 105 反向锁会红，故静默失效仅对「未登记项」成立。）

[Q4 needs-design selector 改名]
16. RED  改名必红、未经置放：①新选择器名若无登记则落入『unaccounted』(line 102)或『裸hex未登记』(line 86)；
17.   ②旧名 no-rule 使 line 112 mismatched（「现场已无该 color 声明」）；③旧名不再 failing 触发 line 105
18.   『fixed 须销账』。so needs-design 改名不会安静放过。
19.   （正是 effectiveBg 入判据(Accounts.text-contrast.test.js:52 / color-token-reader.js:172-176)采规则bg，
20.   保证 rename 后准确的 ratio 不「关机」，而 compliant-bare 同源受保。）

[Summary] 判据逻辑本身自洽，四问中仅 Q1/Q2 暴露结构纠葛 —— 五份对比度公式并存 + 生成器
status 词汇漂移。建议：reader 收编四处副本前先修 at-check 词汇(no-token-candidate → compliant-bare)并补齐 surfaces 写出。
