# Proposal: subtitle-word-integrity

## Why

`subtitle-phrase-boundary-v1.3` 合并后，用 **8 段新复杂文案**（政治评论续篇 / 历史叙事 / 科技解说 / 口语短视频 / 生活叙事 / 无标点压力段 ×2）对真实引擎做三端对跑实测，暴露出一族 v1.3 未覆盖的坏切。**A/B 反证**（关闭 `phrase_boundary` 开关后输出逐字节不变）证实这族坏切不是 v1.3 引入的，而是 `no_cut_bigrams` 词表覆盖缺口 + MAX 分支裸切的既有缺陷在新语料上的呈现。

实测证据（当前输出 → 期望）：

| 坏切实例 | 归因 | 类型 |
| --- | --- | --- |
| `风速每秒 8 │ 米`、`套现约 3.2 │ 亿元`、`提升了 │ 60%`、`制程是 │ 3 纳米` | 数字与量词/单位被拆散 | **数字完整性**（任何文案里都是坏切，确定性规则可防） |
| `当 │ 成`、`千 │ 万人`、`遗 │ 忘`、`那 │ 段`、`轻飘飘 │ 地用` | 双字搭配被劈开 | **词表缺口**（`no_cut_bigrams` 的语义恰好就是"切点不得落在相邻字对内部"） |

复核后**不修**的（如实记录）：`在煤山的一棵老槐 │ 树下`（专名处所短语，逐例登记可防但不完备，记为已知限制）；`先想三秒： │ 这钱花出去`（冒号尾块 + 后块完整，两块都通顺，不算坏切）。

## What

1. **规则表新增 `word_split.unit_guard`**（确定性规则，非枚举）：
   - `units`：量词/单位字符表（`纳米|%,％|度|米|秒|分|时|年|月|日|元|块|亿|万|千|个|台|辆|架|艘|层|米每秒|公里|克|吨|升|毫升|瓦|千瓦|兆瓦|伏|安|赫兹|像素|帧|比特|字节|GB|MB|KB|TB`，实现按最长匹配）。
   - `left_bind`：数字左侧粘连判定——切点左边以数字结尾、右边以单位开头 ⇒ 拒绝。
   - `right_bind`：数字右侧粘连判定——切点左边以"数字+单位"结尾、右边还有该单位的后续字符（`%` 后的数字已在左）⇒ 拒绝。
   - 覆盖三种实测形态：`8│米`（数字│单位）、`3.2│亿元`（数字│单位）、`是│3 纳米`（│数字+单位，左块以"是/约/到"等引导词结尾时右移）。
2. **`no_cut_bigrams` 扩充**（+11 对，全部来自实测命中）：`当成`、`千人`（`万│人`由`万人`覆盖）、`遗忘`、`那段`、`飘地`（`轻飘飘│地用`的接缝对）、`仿佛`、`亿元`、`纳米`、`测试`、`恐慌`、`看不见`。同时**必须同步 sidecar 仓**（`sidecar-parity.lock.json` 的跨仓字节判据）。
3. **两端实现同构接入**：TS（`text-segmentation.ts` 的 `findSafeCutPosition`/`wordSafeSplit` 拒绝点）+ Python（`_find_split_pos` 同位拒绝）；Electron JS 镜像经 parity 锁自动对齐。
4. **金标重生成**：改规则表 ⇒ 重跑 `gen_subtitle_python_golden.py`，更新两仓的 corpus/golden 副本与锁。
5. **共享向量补充**：新增 6 条 `v1.4_word_integrity_*` 向量（数字│单位 ×3、双字搭配 ×3），手工真值，两端消费。

## Capabilities

- 修改 `subtitle-split-quality` 的「无标点长块硬切」与「保护短语」两个 Requirement 的 Scenarios；新增「数字与单位完整性」Requirement。

## Impact

- `packages/story2video-engine/src/text-segmentation.ts`、`subtitle-rules.json`、向量/金标夹具；sidecar 仓 `subtitle_segmenter.py`、`subtitle_rules.json`、金标/语料/锁；两仓 CHANGELOG/learnings。
- **回归面**：既有 44 条共享向量 + 18 条金标语料必须零变化（`unit_guard` 与 no_cut 扩充只影响新形态；`当│成` 类切点此前靠 MAX 兜底，属"坏点被拒绝后重找"）。
- **范围外**：`老槐树下` 型专名短语（不完备，已记）；`max_chars_per_block` 上限本身的调整（独立讨论）。
