---
record: podcast-voice-source-spec
task: 为播客音色来源三态标注写合同（PRD §8.2.9），并如实登记 4.5 仍缺的那半句与其落点事实
date: 2026-10-16
---

# 播客音色来源三态标注的合同（podcast-voice-source-spec，2026-10-16）

> 分支 `podcast-voice-source-spec`（复用 worktree `mp-backfill-3676`，非 C 盘），起点为当时 origin/main。**本片是 docs-only 规格片：locales 一把键都没加。**

## 为什么这一片只写字

PRD §7.4.0 第 1 条要求「②用户偏好 / ③capability 默认 命中时界面必须标注来源三态」。要标，得先有一个能标的地方。实测三个事实否掉了"顺手加个标签"：

- `git grep voiceRef -- apps/desktop/src` → **0 个文件**。渲染层从来不知道音色是什么。
- `podcast/zh.js` 里没有任何音色相关键，`voice|音色` 全文检索 0 命中。写进去就是无人消费的键，AGENTS.md 禁止为不可达路径建文案。
- 解析层 `podcast-tts-voice.js` 只在出期链路里算 `{voiceId, origin, resolvedBy}`，`origin` 闭集 `channel|preference|providerDefault`，而这个值**从未进入任何 IPC 载荷**。

所以缺的不是文案，是**一条只读投影 + 一个落点 + 一把键**，而且它触主进程 ⇒ QM-1 必跑。把合同写清楚，下一片就不必重新推导；实现留在那一片，且明写"这不是实现"。

## 合同要点（七条验收判据全文见 PRD §8.2.9）

- 只读 IPC `podcast:voice-preview` 内部走既有 `resolveVoiceRef`，**禁止**在 IPC 层重抄回退顺序；渲染层与 IPC 里不得出现 `defaultVoiceId` / `tts-voice-preference:` 字面量（那两个只在主进程一处）。
- 落点是出期浮层 `PodcastEpisodeEntry.vue` 表单底部，不是频道页——频道页没有"将要发出去"的语义，把来源标在那里会被读成频道属性，而它实际是这一次出期的解析结果。
- `origin=channel`（①命中）**不显示**；②③命中才标；闭集外的值 ⇒ 不显示并 warn，不得兜底成"取自频道"。
- 解析拒绝 ⇒ 显示既有拒绝文案（走 `issueText`），不是空字符串；这是旁路，不得改变出期按钮的可用性（§8.2.3 主路不被旁路毁掉）。

## 执行记录

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | docs-only 规格片（`classify-docs-only.js` 判定见下），在 D 盘工作区提交，不动共享根 |
| 行尾与 diff 对账 | PASS | 插入按各文件锚点行的行尾继承；提交前 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账，不等即中止 |
| 品牌残留 | 待跑 | 本机 `check-no-brand-residue.js` 从 worktree 根调用报用法错误，未跑通即不写 PASS，交 CI Gate 12 |
| 文档同步 | 待 CI | `openspec-sync-check` / doc-gate 由 CI 跑；本片新增 PRD 小节与 tasks 进度行成对 |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 纯规格片，未触运行时代码、未触 locales、未加键 ⇒ 无产物面也无新测试面 |
| QM-6 双模型外部评审 | 未执行 | 规格片不强制（AGENTS：纯文档变更不强制 QM-6），如实登记 |

## 遗留

- **4.5 父项仍未勾**：实现要做 §8.2.9 的七条，且触 `ipc-handlers` / `preload` ⇒ QM-1 必跑。
- 一条我在 #3676 收尾时抓到的判据缺口照此登记：`check-gate-record-debt.js` 对「同一篇记录里两条 `| 远程同步 |` 行且互相矛盾」是绿的（实测 rc=0、#3684 全绿合并），补「同篇不得多于 1 条」属改门禁本体，须人工过目，本片不动它。

## 远程同步

| 远程同步 | PASS（merge `165bfcc00dc77e330eef035223042782fa7309f6`，2026-10-16T02:59:56Z） |
