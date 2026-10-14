---
record: p3-2-onboarding-existing
task: P3-2 方案 A —— 给三个既有平台补 enabled（把「已登记缺口」改成棘轮）
date: 2026-10-15
---

## 本次执行记录：P3-2 方案 A（p3-2-onboarding-existing，2026-10-15）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 含 `config/` + `scripts/`
  ⇒ **混合 PR**，走完整质量节拍。

## ★ 先纠正一个方向性错误：P3-2 原计划与用户约束冲突

`PLAN-REUSE-ROLLOUT-2026-10-13.md` §5 的 P3-2 原文是
「单平台试点（推荐 **`dayu`** 或 **`qie`**）」，其真实含义是**新增一个平台**做试点。

用户明确纠正：**「我没有说要新增这些平台啊」**，且目标里写着
**「P0-1 的 ID 值先只覆盖我的项目目前支持的这些自媒体平台」**。

取证（仓库文档）：

| 证据 | 内容 |
| --- | --- |
| `竞品分析报告.md:211` | 「本项目缺失的平台」：视频号、**大鱼号**、一点号、网易号、搜狐号… |
| `融媒宝-data.zip数据集拆解.md:322` | 「本数据集独有、mulpub 未覆盖的平台 20 个」：… `dayu` … `qie` … |
| `config/platforms.yaml` | 15 个平台，**不含** `dayu` / `qie` |

**⇒ `dayu` = 大鱼号、`qie` = 企鹅号，是参考产品有、本项目没有的平台。**

**⇒ 故 B 方案（新增平台）被用户约束排除；本 PR 走 A 方案：
在**用户已有的 15 个平台**上落实扩平台标准动作 —— 这同时满足 P3-2 的原定目标
「用一个平台试点证明标准动作可行」。**

## 现场：把 P3-1 的脚本对**全部 15 个既有平台**跑一遍

```
全 PASS: 4 / 15      有失败: 11
wechat_mp -> 11 | zhihu -> 10 | weibo -> 10,11 | tencent_video -> 4,7,8,11
toutiao -> 10,11 | youtube -> 7,8,9,10,11 | tiktok -> 7,8,10,11
baijiahao -> 4 | twitter -> 7,8,9,10,11 | instagram -> 4,7,8,11 | facebook -> 7,8,11
```

**⇒ 也就是说：P3-1 的验收判据①「对已有平台跑 ⇒ 全 PASS」实测**不成立**。
而这正说明脚本**有用** —— 它第一次全量跑就抓到了真实不一致。**

## 逐条定性（分五类，按「真缺口 / 判据是否适用」）

| 类 | 判据 | 平台 | 定性 |
| --- | --- | --- | --- |
| **A** | 4（缺 `enabled`）| `baijiahao` / `instagram` / `tencent_video` | ✅ **真缺口，本 PR 修** |
| **B** | 9（`has_api:true` 却无链文件）| `youtube` / `twitter` | ⚠️ 与 `publishMode: dom-only` 自相矛盾，需定「谁对」⇒ 本 PR 不动 |
| C | 10（无 `formatArticleBody`）| `zhihu`/`weibo`/`toutiao`/`youtube`/`tiktok`/`twitter` | ⚠️ 图文平台应为真违规；短内容平台可能不适用 |
| D | 7/8（`TAG_STYLES`）| 6 个平台 | ⚠️ 短视频/社交可能大面积不适用 |
| E | 11（测试覆盖）| 9 个平台 | ✅ 真缺口，非阻塞 |

**★ 关键：P3-1 的作者**已经知道** A 类，并把它写进了测试快照：**

```js
const MISSING_ENABLED = ['tencent_video', 'baijiahao', 'instagram']
test('真发现：缺 enabled 字段的平台（一键回滚机制失效）', ...)
    '这是「单平台一键回滚」的可达性问题，请核对'
```

**⇒ 且测试自己写了路径**：「若是有意修好了，请同步更新本快照」。
**⇒ 故本 PR 是**把已登记的真缺陷修掉**，而不是「改测试迎合改动」。**

## `enabled` 的依据（为什么该补）

1. **它是 schema 字段**：`packages/shared-utils/src/platform-config.js:29-34`
   ```js
   // applyRemote 允许覆盖的键与期望类型（allowlist）
   const APPLY_REMOTE_KEY_TYPES = { …, has_api: 'boolean', enabled: 'boolean' }
   ```
2. **它有设计文依据**：`ARCH-REUSE-INTEGRATION` §9.3 回滚成本段（P3-1 测试注释原文）
3. **它是「单平台一键回滚」机制**（同上）
4. **12/15 平台都已声明** ⇒ 3 个缺的属遗漏

## 修法

| 文件 | 改动 |
| --- | --- |
| `config/platforms.yaml` | 3 个平台各**补一行** `    enabled: true`（位置与既有 12 个一致：紧随 `publishMode`）|
| `scripts/verify-platform-onboarding.test.js` | ① 快照 `FULLY_COMPLIANT` 加 `baijiahao`　② `MISSING_ENABLED` 改为 `[]` 并把测试从「记录缺口」改成**棘轮**（含规模下界防空转）　③ `YAML_CASES` 的 `baijiahao` 行数 16 → 17 |

**★ 为什么用「块感知」脚本而不是文本替换**：
`baijiahao` 与 `tencent_video` 的 `publishMode:` 行**逐字相同**，文本替换会歧义或误改。
故按平台块定位插入点。

## ★ 反证（真变异跑，不是同义反复）

```
临时抽掉 baijiahao 的 enabled（15 -> 14 行）
=> not ok 14 - 合规版图快照：完全合规的平台集合
   not ok 15 - 棘轮：没有任何平台缺 enabled 字段
   not ok 16 - 步骤 4 确实在查 enabled
   16 tests / 13 pass / 3 fail                    ✅ 三红
还原 => 16 tests / 16 pass / 0 fail               ✅ 全绿
还原后 git diff --numstat -- config/platforms.yaml = 3 0（仅我的 3 行，未污染）
```

**★ 我刻意**没有**在提交版测试里写「负控」**：`buildChecks` 从磁盘读真实 YAML、无法注入夹具；
拿字面量测正则属**同义反复**（假反证），故不写，改用上表这次变异跑作为证据。

## 结果

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 判据 ④ 失败平台数 | 3 | **0** |
| 全 PASS 平台数 | 4 / 15 | **5 / 15**（`baijiahao` 只缺 ④，故整平台转绿）|
| P3-1 脚本自测 | 15 / 16（#11 因快照未同步）| **16 / 16** |

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `node --test scripts/verify-platform-onboarding.test.js` | PASS | **16/16** |
| 全平台判据 ④ | PASS | 失败 0 |
| 真变异反证 | PASS | 抽掉即三红、还原即全绿 |
| check-unwired-tests | PASS | exit=0 |
| check-locale-sync --keys | PASS | exit=0 |
| check-no-brand-residue | PASS | 9090 文件 |
| 行尾对账 | PASS | 两口径一致 |
| Gate 11 ESLint | PASS | exit=0 |
| **QM-1 打包** | **不适用** | 分层判据只要求 `apps/desktop/electron/` 或 `packages/rpa-engine/`；本 PR 只改 `config/` + `scripts/`。**但 `config/platforms.yaml` 会进 asar** ⇒ 故以「`PlatformConfig` 加载校验 + 判据④」作为等价证据，不冒充 QM-1 |
| 远程同步 | PASS —— PR #3604 已合并为 `origin/main` `0fc916fee48f849b480199fcdc9914b5e6da80b3`（2026-10-15T02:03:13+08:00，squash merge）；远端分支随合并自动删除。合并后复核：我改的 3 个文件与 merge SHA **零差异**，主干上判据 ④ 失败 **0** |

- 保留门禁：脚本自测 16/16 ✅ | 判据④ 0 失败 ✅ | 反证 ✅ | unwired ✅ | locale ✅ | 品牌 ✅ | 行尾 ✅ | Gate 11 ✅ | 远程同步 PASS

## 残余（未含，不假装闭合）

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | **B 类**（`youtube` / `twitter`）| `has_api:true` 与「无链文件 + `publishMode:dom-only`」自相矛盾；需平台 owner 定「谁对」，本 PR 不代改 |
| 2 | **C 类**（判据 10）| `formatArticleBody` 是否对所有平台适用**尚未裁定**（P3-1 测试注释亦如此标注）|
| 3 | **D 类**（判据 7/8）| `TAG_STYLES` 对短视频/社交平台可能不适用 ⇒ 需先做**判据适用性评估** |
| 4 | **E 类**（判据 11）| 9 个平台缺 chain 测试 / `content-formatter.test.js` 无该 slug ⇒ 测试覆盖欠账，非阻塞 |

## 教训

**「上游计划里的既定前提」必须拿「用户当前约束」复核一遍。**

P3-2 的原话在我的上下文里躺了很多轮，我一直把它当既定事实，
直到用户问「`dayu` 是什么」才回查 —— 结果发现它是**本项目没有的平台**。

**⇒ 处方：凡是「计划说要新增 X」的条目，动手前先问一句「X 是否在用户/项目当前的支持范围内」。
计划文写的「推荐」不等于用户批准的「范围」。**
