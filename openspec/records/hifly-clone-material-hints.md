---
record: hifly-clone-material-hints
task: 克隆面板补录音素材要求提示（飞影失败不返回原因的 UI 兜底）
date: 2026-10-24
---

> **本记录随改动一起并入 PR #4341**，不单独开 PR。
> 原因：改动依赖 #4341 新增的 `AvatarVoiceClone.vue`；且若单独开 PR，
> rebase 会把 #4341 未合并时的他人提交一并带入差集，触发
> `check-pr-exec-record.js` 的「高危面前缀 ⇒ 只认 tier=external」而无法收口。
> 详细决策过程见「六、为什么并入 #4341」。

## 本次执行记录：克隆素材要求提示（hifly-clone-material-hints）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | worktree `mp-hifly-clone-material-hints`（位于 `<worktree 根目录>/mp-<task>`，非 C 盘） |
| TDD | ✅ | `CreateView.avatar-clone.test.js` +2 例（素材提示渲染 + locale 走键）；先 RED 后 GREEN |
| 回归零破坏 | ✅ | 12 个相关测试文件 **267/267** 全绿 |
| locale 成对 | ✅ | zh/en 各 +1 键；`--keys` PASS（2280）、`--cjk` PASS（1115）、`src/i18n/i18n.test.js` **17/17** |
| 超大文件 / 债务 / 依赖审计 | ✅ | max-lines 无新增、debt-budget 五项全过、`check-dep-audit.js` **rc=0** |
| 同型风险锁 / 品牌 / 绝对路径 | ✅ | r3 18/0、no-brand-residue PASS、doc-abs-paths PASS |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；本行不手写状态词 |

## 一、为什么做这个

上一轮真实首跑（`hifly-clone-realrun`）暴露：飞影 `voice/create` 失败时 `message` 是**空串**
（服务端未按文档「失败时返回错误信息」返回），应用只能提示通用文案。

而**最常见的失败原因是素材不合格**——本轮首跑就是用 5 秒纯静音 WAV，得到 `status: 4` 且无任何原因。
用户拿到这种失败会完全无从下手。

所以：**服务端不给原因，UI 就必须主动把约束说清楚。**

## 二、实现

| 文件 | 改动 |
|---|---|
| `AvatarVoiceClone.vue` | 在「选择本地录音文件」按钮**上方**新增常驻提示行（`data-testid="avatar-clone-voice-material-hint"`） |
| `src/locales/create/avatar/zh.js` | 新增 `avatarCloneVoiceMaterialHint` |
| `src/locales/create/avatar/en.js` | 同上（成对） |

文案（zh）：

> 要求 mp3 / m4a / wav，≤20MB，时长 5 秒～3 分钟，且**必须包含清晰人声**（静音或纯音乐会导致克隆失败）。

## 三、四个设计点

| 设计点 | 理由 |
|---|---|
| **常驻显示**而非折叠/悬浮 | 三个硬约束 + 人声要求是「看一次就够、不看就踩坑」的信息；折叠起来等于没提示 |
| **放在按钮上方**而非下方 | 用户阅读顺序是先看说明再点按钮；放下方会被「已选录音」状态提示挤掉 |
| **明确写出「静音或纯音乐会导致克隆失败」** | 这是真实首跑踩到的坑。不写这句话，用户不会想到「没声音」也是问题——而它恰恰是最常见的失败原因 |
| **走 locale 不写中文字面量** | CI Gate 7 的 CJK 基线扫描会拦渲染端新增中文字面量 |

## 四、文档改动只做了一半（如实记录）

原计划同时在 PRD A.5.5 与 user-manual 补说明，**最终都没落地**：

- **PRD A.5.5「素材要求」节不在本分支上**——那节是 PR #4362 新增的，当时未合并。
- **user-manual 的克隆小节当时是旧版**（还写着「填音色名称」的过时流程）——新版是 PR #4341 重写的。

中途发现后**主动撤销了已改的 user-manual**（`git checkout --`），避免在错误基线上造出互相矛盾的文档。

**结论：文档补充必须等 #4341 与 #4362 合并后再做。**本轮只交付 UI + locale + 测试。

## 五、仍未做的 UI 兜底

克隆失败时的**具体原因**依然拿不到（飞影 `message` 空串），所以失败提示只能给通用文案。
若未来要做得更好，需要：

1. 前端在上传前做**本地预检**（ffprobe 探测时长、音量检测判断是否含人声）——需主进程新增探测能力，
   且飞影不接受预检结果，只是提前拦住明显不合格的素材；
2. 或等飞影服务端补上失败原因（已超出应用可控范围）。

## 六、为什么并入 #4341（决策过程）

最初是单独开 PR 的，但 `check-pr-exec-record.js --mode=enforce` 判 rc=1，理由：

```
本 PR 变更文件 115 个（A=58 M=57 D=0）
本次变更集命中高危面前缀 .github/workflows/ / scripts/check- / scripts/deep-review
⇒ 本集内所有收口只认 tier=external + 可核 evidence
```

**根因不是我的改动**：本分支 rebase 到 `origin/hifly-voice-subtitle-parity` 时，
把该分支上**他人已合入 main 的 8 个提交**（QuickRender、agnes-video、qm6-tier-watermark、
dep-audit #4361 等）一并带进了与 origin/main 的差集，其中含 `.github/workflows/` 与
`scripts/check-*`，于是触发「高危面只认 external」这一档。

而这 8 个提交**本该随 #4341 一起合并**（#4341 的 tip 就已包含它们），
单独开 PR 只会让它们被重复计算一次。

**结论**：本改动（4 文件、49 行净增）是 #4341 功能的直接延伸且依赖其新文件，
并入 #4341 作为同一 PR 合并最干净。

## CHANGELOG 条目

# feat(video): 克隆面板补录音素材要求提示，避免无原因的克隆失败

- 「管理克隆形象」→「克隆我的声音」区现在常驻显示录音素材要求：**mp3 / m4a / wav、≤20MB、5 秒～3 分钟，且必须包含清晰人声**。
- 补充说明「静音或纯音乐会导致克隆失败」——这是最常见的失败原因，而服务商在失败时不返回具体原因，用户此前无从判断。
