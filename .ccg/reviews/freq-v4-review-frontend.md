# QM-6 外部评审原件（只读档）— publish-frequency-policy-v4
- 轴：前端（模式/可维护性/集成风险）
- 模型：`opencode/big-pickle`
- 通道：本机 CC Switch 网关 `127.0.0.1:15721` 当场实测 `Test-NetConnection -InformationLevel Quiet` = **False**，
  两个 primary（codex / claude）都绑它 ⇒ 按既有降级口径走 `opencode run --agent plan`（只读档；正控 `PROBE_OK` 先行）
- 采集时间：2026-10-15 22:47–22:52（本机）
- 评审对象：分支 `publish-frequency-v4` head=`e5d1ee253` 的 `origin/main` 差分（附件 `freq-v4-impl.diff`，8 文件）
  —— 本 PR 的 QM-6 采纳项（运行期自检 / 地板锁 / 逐平台交叉锁 / describe 改名）是**本原件回文之后**才落的。
- 取证边界：模型为只读静态判读，未复跑测试套件；逐条处置见 `openspec/records/publish-frequency-v4.md` 的「QM-6 发现处置」表
- 本文件只留结论段：`===STDERR===` 之后的过程转录（含对仓库文件的读取回显与本机绝对路径）刻意不入库，。

---

我先读取必读材料的相关文件，再逐项攻击 brief 列出的 7 个面。
继续读取其余必读材料。
继续读取 policy 真源剩余部分与其余必读材料。
核对完成，7 个攻击点全部取证完毕。以下为 QM-6 前端轴评审报告（只读，未改任何文件）。

---

## Critical

该轴无发现。

## Warning

该轴无发现。

## Info

### I-1 日配额输入上界 `999` 与代码/env 侧无上界不对称（PRD 已自认，记录在案）
- **文件:行号**：`apps/desktop/src/components/PublishFrequencySettings.vue:47/51/55`（三处 `:max="999"`）；对照 `packages/shared-utils/src/publish-frequency-policy.js:227,236`（env `MP_PUBLISH_DAILY_MAX_*` 覆盖链无上界，校验仅要求「>=0 的整数」）。
- **用户可见症状**：env 可配出超过 999 的日配额（如 `MP_PUBLISH_DAILY_MAX_SHORT=5000`）。load 回显 5000 后，用户一旦触碰该输入框即被 el-input-number 钳到 999，保存即静默把 5000 砍成 999——「改了别的字段顺手保存」就会发生，且无任何告警。默认值 200/350/500 均 < 999，默认路径不受影响。
- **修法建议**：抬高 UI 上界（如 9999）与代码侧对齐，或在 `load` 回显时对超界值出声（`ElMessage.warning` + 标注「env 覆盖，编辑将被钳到 UI 上界」）。PRD §5（line 67）已自认「代码侧无 999 上界」，故仅记 Info，不阻断。

### I-2 任务书取整措辞与实现不一致（任务书过期，非代码缺陷）
- **文件:行号**：实现两处均为 `Math.max(1, Math.round(ms / 60000))` —— `apps/desktop/electron/bootstrap/phase4-events.js:302`（含「round 不用 ceil」的 QM-6 前端轴 W1 镜像注释）与 `apps/desktop/src/components/PublishProgressTaskRow.vue:43`；PRD §6（line 86）文档口径同为 `max(1, round(...))`。任务书附件写的是 `Math.ceil`。
- **用户可见症状**：无。两侧公式逐字相同、各有锁（`phase4-events.test.js` / `PublishProgressPanel.test.js`），文档与实现一致。
- **修法建议**：同步任务书措辞即可，不动代码。

### I-3 测试 describe 标题遗留 v2 版本号
- **文件:行号**：`apps/desktop/src/components/PublishFrequencySettings.test.js:65`（describe 标题仍为「publish-frequency-policy-v2 设置页」，内容断言已是 v4）。
- **用户可见症状**：无（纯测试维护面）；症状是下次改版时按标题索引会误判该文件未更新。
- **修法建议**：改成不带版本号的中性标题（如「publish-frequency-policy 设置页」），一次消除此后每版的漂移点。

## 逐点核对结论（7 攻击点）

1. **新文案真值性**：成立。`TIER_PRESETS`（policy.js:74-78）long 5′/1′、clip 3′/1′、short 1′/1′，账号间隔均 ≥ 平台间隔且短内容档相等；机制侧「取较严者」由 guard `check()` 两条独立窗口实现（guard.js:302-320，`platformRemaining > remainingMs` 取更严），文案两半句与代码逐字对应；env 调大平台间隔的情形被文案后半句自己覆盖。
2. **`currentTierText` 分组塌缩**：不塌。分组签名含 `accountMinMs`/`accountDailyMax`（vue:162），v4 三档在账号间隔（5/3/1′）与日配额（200/350/500）上均不同，仍出 3 行；平台间隔统一 1′ 不参与塌缩。
3. **`:max="999"` 非对称**：见 I-1（Info）。
4. **`0` 语义**：三处一致且未被 UI 反向表达。guard `_remaining` 对 `<=0` 直接返回 0（guard.js:243）、日配额 `>0` 才判（guard.js:294）、账号窗口 `>0` 才查（guard.js:306）——`0 = 关闭/不限` 与 zh.js:35/37-39 标签吻合。
5. **等待分钟取整**：见 I-2（Info）。
6. **locale 成对**：zh/en 同键同序、无死键；`platformIntervalHint`（zh:36/en:34）挂载于 vue:43，`dailyMaxPendingConfirm`（zh:42/en:40）保持 v3 的动态读数、无写死数字。
7. **夹具同形**：`POLICY_RES.platforms[p]` 四键（test.js:30-32）与生产 `guard._intervals(p)` 返回（guard.js:210-215/226-231）逐字同形（含 `tier`）；夹具注释如实记录了此前「自造生产不存在字段致假绿」的教训；顶层缺 `emergencyStatus` 属可选缺席，组件有 `—` 兜底，注释的「同形」声明精确限定在 `platforms[p]`，无夸大。

PRD 已登记的已知缺口（F-I5 `fmtMin` 中文界面英文单位、F-I6 `effectiveRangeText` 不看平台档）不在本片范围，未重复计入。

---

已读：`PublishFrequencySettings.vue`（全文）、`PublishFrequencySettings.test.js`（1-259）、`locales/settings/zh.js` / `en.js`（全文）、`ipc-handlers/publish-frequency.js`（1-168）、`phase4-events.js`（288-317）、`PublishProgressTaskRow.vue`（25-69）、`publish-frequency-policy.js`（1-424）、`publish-interval-guard.js`（205-342）、PRD（§5 61-76、§6 78-94）、附件三件（brief / diff / index.d.ts）。

本会话处于 plan mode：以上均为只读评审结论；若需落地 I-1/I-3 的改动，需要切换 agent 后执行。

