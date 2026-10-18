---
record: fix-s2v-subgroup-assertion-stale
task: 修掉 main 自 2e108e7a6 起持续红的一条 required 面用例（断言前提随 PR #3946 迁移而用例没跟着迁）
date: 2026-10-19
---

## 本次执行记录：S2vConfigPanels 子分区断言随实现迁移（fix-s2v-subgroup-assertion-stale，2026-10-19）

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ | 只改一个测试文件 `apps/desktop/src/views/video-creation/S2vConfigPanels.test.js`（5/1）。隔离 worktree `mp-fix-s2v-subgroup-assertion-stale`（`scripts/start-mp-task.ps1` 创建）。**这是别人那一片（PR #3946）留下的红，不是本 PR 引入**——认领的依据是对照面，见 QM-5 ①。 |
| 第一性原因（QM-5 ①） | ✅ | 引入点 **`2e108e7a6`（PR #3946「语音模型改由程序+运营决定，移除「语音模型」下拉」`voice-model-program-resolved`）**。那片把渲染条件从"用户选了模型"改成"程序静默解析出的 context model 非空"：`S2vConfigPanels.vue:359` 的 `v-if="s2vConfig.voiceProvider && s2vVoiceContextModel"`，其中 `s2vVoiceContextModel` 经 `:788` 从 state 转发（真源 `tts-voices-state.js:172`）。用例只设了 `vm.s2vConfig.voiceModel`（那是**被移除的下拉**写的那个字段），没设 `s2vVoiceContextModel` ⇒ v-if 恒假、`语音 / 音色 ID` 标签不渲染，断言 `toContain('语音 / 音色 ID')` 当场红。**属 AGENTS「门禁断言随实现迁移同步」的漏更，不是新缺陷。** |
| 逃逸分析（QM-5 ②） | ✅ | ①**PR 侧 CI 没能拦**：该用例落在 `QG Desktop Shards (2/2)`，实测 GitHub 侧 required 清单（ruleset 23749994）是 `QG Static / QG Unit Tests / electron-tests / 文档同步检查 / 债务熔断检查 / 单元测试 + Lint / GUI Gate Result` 七条，**分片作业不在其中** ⇒ 一片红不拦合并。②**但合并后它反过来拦住了所有人**：main 自那次合并起 `QG Coverage` + `Gate Result` 一起红（`Gate Result` 是 required），后续每个改动运行时面的 PR 都合并不了。③本机预跑没抓到：那片当时按"消费者并集"跑的是 `model-provider*` / `voice-model-resolution-parity` 等，`S2vConfigPanels.test.js` 不在被改 `useTtsVoices`/`state` 的消费者清单里——**改的是共享 state，消费者却按文件名反查**，这类"字段换了名字/来源"的迁移要按**被消费的 state 符号**反查消费者，不是按被改文件。 |
| 系统性漏洞（QM-5 ③） | ✅ | 两处：**(a)** 一条决定 UI 渲染的判据从 config 字段迁到 state 派生值时，没有任何东西要求"同步所有断言该 UI 存在的测试"；**(b)** `QG Desktop Shards` 非 required，使得"分片红可以合进 main"，而 main 的红又通过 required 的 `Gate Result` 传染给之后每一个 PR。本刀修的是 (a) 的那一条具体断言；(b) 属"改谁来守门"，**不在本刀动**（要动的是把分片收进 required，或给 main 红加一道阻断合并在飞 PR 的机制），留给用户裁决。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修法是把用例的前提改成**与新实现同源**：在该用例里补 `vm.s2vVoiceContextModel = 'speech-2.8-turbo';`（同文件 `:127` 已有同样写法，属既有正例，不是新造的字段），并把那条注释从"仅在已选语音模型时渲染"改成"v-if 读的是 state 派生的 context model"。**红灯→绿灯实测**：改前本机 `vitest run src/views/video-creation/S2vConfigPanels.test.js` = **`1 failed \| 23 passed (24)`**，红点逐字为 `AssertionError: expected 'create.story2video.subgroups.voiceNar…' to contain '语音 / 音色 ID'`、落点 `S2vConfigPanels.test.js:290:30`；改后同一条命令 = **`24 passed (24)`**。正负两侧现均有锁：同文件 `:123-145`（**由 #3946 自己写的那条**）场景 1 设 `s2vVoiceContextModel` 断言两字段都在、场景 2 置空断言两者都不渲染。**顺手记一条形态**：同一批改动里一处按新判据写、另一处仍按旧判据写——这就是"断言随实现迁移"漏更的典型形状，**不是没人知道新判据，是迁移只做了一半**；所以这类迁移的核查清单应该是"所有断言该 UI 存在的测试"，而不是"我改过的测试文件"。 |
| 防止再次发生（QM-5 ⑤） | ✅ | 三条落地：① 本记录把"判据从 config 字段迁到 state 派生值 ⇒ 必须按**被消费的 state 符号**反查测试消费者"写成可复算手法；② 归因现场写进 PR 正文，让 #3946 的作者与后续会话都能查到这条红从哪一笔起；③ 把 (b) 那半（分片是否入 required）升级成待裁决项交用户，不在刀里自作放宽。**不做的事**：不把断言改成"只查 `语音生成器`"来绕过、不给 `toContain` 加 `||` 兜底、不把该文件摘出分片——那三条都是把缺陷改成契约。 |
| 行尾与 diff 对账 | ✅ | 工作副本 CRLF。补丁驱动先断言行尾均匀再统一 join；锚点要求恰命中 1，**第一次就因为 `vm.s2vConfig.voiceModel = 'speech-2.8-turbo';` 在文件里出现两次而拒绝改写**，正解是改成"相对那条唯一注释定位 + 逐字校验相对位置"，不是取第一个匹配、更不是放宽计数。两口径 `git diff --numstat` / `--ignore-cr-at-eol --numstat` 相等（5/1）。 |
| 接线棘轮 | N/A | 不新增测试文件；`S2vConfigPanels.test.js` 由 vitest 按 workspace 收集，`QG Desktop Shards` 覆盖。 |
| QM-1 / QM-4 | N/A | 未改 `apps/desktop/electron/**` ⇒ QM-1 不触发；未改任何 `.vue`/样式/组件 ⇒ QM-4 不触发（本刀只改测试文件，渲染真源一字未动，因此像素基线不涉及）。 |
| QM-6 | N/A | 单文件测试前提修正，`ccg-review-decider` 档位非 `dual`；**未调用外部模型**，本行不得读成"已复核"。替代证据是同一条命令的红灯→绿灯对照。 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 推导；main push 回读写进 PR 评论，不写回本文件。 |

## 现场读数

- 判"这条红与 main 同源、不是本刀引入"的对照面（全部现取）：main push 结论 `33e0940e5` success → **`2e108e7a6` failure** → `e5ed32f52` / `5736b3ed2` / `950af9f3b` 三条 `QG Desktop Shards (2/2)` 全 failure；`2e108e7a6` 那次同时红 `QG Coverage` 与 `Gate Result`。另有两个互不相干的在飞改动集（#3955 音色三态、#3958 音频键）在同一分片报**同一条**用例红。
- 日志取法一条工具事实：`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs` 对这条 job 返回 **0 字节**（探针失明，读起来像"没有失败"）；全文必须走 `gh run view <run> --job <id> --log`（本次 5,197,906 字节，从中读到 `Failed Tests 1` 与 `1 failed \| 508 passed \| 1 skipped (510)`）。
