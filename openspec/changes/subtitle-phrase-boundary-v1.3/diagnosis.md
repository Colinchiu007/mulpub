# 字幕层分句坏切根因诊断（2026-10-18）

## 1. 调用链确认（用户问题一：是否走了分句引擎）

**结论：走的是分句引擎，不是降级方法。**

实测证据（本地 8002 真实 `/v1/split` 响应 → `normalizeServiceSplitResult`）：

| 路径 | subtitleSource | degraded | 场景数 | 字幕块数 |
| --- | --- | --- | --- | --- |
| 在线（引擎返回 subtitles） | `smart-sentence-splitter` | false | 14/14 采纳 | 100 |
| 离线降级（`createLocalSplitResult`） | `local-typescript` | true | 28 | 100 |

- 在线路径：`withSubtitleBlocks` 的 `validateEngineSubtitles` 对全部 14 个场景通过（顺序连续覆盖 + 保护短语边界），无一回退。
- 离线路径与在线路径块级差异仅 2 处（`了` 后宾语保护），证明双实现语义一致。
- **即：用户看到的坏切就是引擎算法本身的输出，与「是否降级」无关。**

## 2. 坏切清单（用户问题二：是否有很多不合理断句）

100 个字幕块中，逐条人工评审出 **11 处不合理断句**，全部属于「无标点长块硬切」：

| # | 场景原文 | 当前输出（坏切处以 ｜ 标注） | 问题类型 |
| --- | --- | --- | --- |
| 1 | 是选举年为了拉拢某些特定票仓的无奈之举 | 是选举年为了拉拢某｜些特定票仓的 | 劈开「某些」 |
| 2 | 我们常常会被宏大的地缘政治术语淹没 | 我们常常会被宏大的地｜缘政治术语 | 劈开「地缘政治」 |
| 3 | 是外交官和国际关系专家才该操心 | 是外交官和国际关系｜专家才该操心 | 劈开「专家」 |
| 4 | 他人的“毫无遗憾”就再也无法刺痛你的 | 他人的“毫无遗憾”就｜再也无法刺 | 切在「再也」中间 |
| 5 | 最终会体现为日常生活中的隔阂与偏见 | 最终会体现为日常｜生活中的隔阂 | 劈开「日常生活」 |
| 6 | 那么和平就不再是理所当然的默认选项 | 那么和平就不再是｜理所当然的 | 劈开「理所当然」 |
| 7 | 而变成了一种需要时刻捍卫的特权 | 而变成了一种需要｜时刻捍卫的 | 劈开「时刻」 |
| 8 | 去理解那段历史对今天的世界格局意味着什么 | 去理解那段历史｜对今天的… | 「对今天」黏连上块 |
| 9 | 不能被轻飘飘地用“无遗憾”三个字抹去 | 不能被轻飘飘地｜用“无遗憾”三个 | 切在「地用」中间 |
| 10 | 当被问及那些关于历史定罪的言论 | 当被问及那些关于｜历史定罪的言论 | 切在「关于」中间 |
| 11 | 轻描淡写地说出了那句让无数人血脉偾张 | 轻描淡写地说出了那｜句让无数人血 | 劈开「那句」 |

## 3. 根因（插桩定位）

链路：`subtitleLengthSplit` → MAX 分支（`cur.length >= 15`）→ `findSplitPos` 无标点返回 -1 → `wordSafeSplit(cur, 1, 14, 8, 8)` → `isGoodCut` 全拒 → 返回 -1 → `findSafeCutPosition` 在 `[1, 14]` 内**只校验「安全」不校验「语义」** → 用算术位置裸切。

### 3.1 `isGoodCut` 的判定面过窄

插桩输出（`REJECT no-good-tail(prev=X next=Y)` 表示两侧字符都不在规则集内）：

```
cur=是选举年为了拉拢某些特定票仓的  wordSafeSplit 扫描 i=14→1 全拒
  i=14 REJECT no-good-tail(prev=仓 next=的)
  i=13 REJECT no-good-tail(prev=票 next=仓)
  ...
  i=8  REJECT no-good-tail(prev=拢 next=某)   ← 唯一分词边界，仍被拒
```

现有三类好切点判据：
1. `semantic_lead`（提/把/还/绝/已/依 + 后续约束）
2. `good_lead`（和与及而但或把被从向对为于并且且成）
3. `good_tail`（的得了是就都也还要会能可将则若虽因着过地得正于，、；：在个）

**中文里大量安全切点不落在这三类**，例如：
- 「为了｜拉拢」：块尾「为」虽在 good_lead，但这里是块**尾**，判据只看块首
- 「宏大｜的」：块首「的」不在 good_lead
- 「那段历史｜对今天」：块首「对」在 good_lead，但 i=7 < minHead=8 被跳过

### 3.2 `minHead = minChars = 8` 与窗口过窄的双重挤压

`wordSafeSplit(cur, lo=1, hi=14, minHead=8, tailMin=8)` 的准入条件：
```
i >= minHead(8)  或  (tailMin>0 且 i >= minHead-2(6) 且 tail >= tailMin(8))
```
即 `i ∈ [8, 7]` 为空集，`i ∈ [6,7]` 要求 `tail = 15-i >= 8` 即 `i <= 7` ⇒ 只有 i=6,7 且 tail>=8。而实际好切点在 i=4,5,8,9,10 等位置，被切碎。

### 3.3 兜底路径缺少语义层

`wordSafeSplit` 末尾的第二段 for 只排除 `WORD_BAD_FOLLOWERS`（强黏着后缀），不要求任何正向语义特征。`findSafeCutPosition` 更只是「不劈保护短语/代理对/小数点」的安全校验。

**三者叠加的结果：语义层完全缺失时，就用算术位置裸切** —— 这正是 openspec 规范 `subtitle-split-quality` 明确禁止的：「不得用固定算术位置绕过保护合同」。

### 3.4 分词器不可作为硬判据（关键约束）

实测 jieba(Python) 与 segmentit(JS/TS) 在同一文本上的分词跨度 **8/8 行全部不一致**：

```
文本：那声清脆的快门声，在东京永田町的走廊里显得格外刺耳。高市早苗…
py : [[0,2],[2,4],[5,7],[10,12],...]
js : [{2,5},{5,7},{10,12},{12,15},...]     ← 起始/结束位置系统性偏移
```

且 `segmenterSpans` 的贪心对齐策略（`text.indexOf(word, cursor)` + `idx < cursor` 跳过）在中文连续文本上会**丢掉大量边界**：
```
cur=是选举年为了拉拢某些特定票仓的
  allSpans=[[1,3],[4,6],[6,8],[8,10],[11,13]]     ← 「为了」「某些」的边界都在
cur=我们常常会被宏大的地缘政治术语
  allSpans=[[0,2],[3,5],[6,9],[9,11],[11,13],[13,15]]  ← 「宏大」的边界 6,9 都在
```

**结论：不能把「分词边界」升级为跨实现的硬判据**，否则会立刻破坏三端逐字一致的既有契约（`story2video-segmentation-parity.test.js` + `subtitle-vectors.test.ts` + Python `test_subtitle_vectors.py`）。

## 4. 修复方向（TDD 待验证）

必须走**字符规则可判定**路径，才能同时落在 Python/TS/JS 三端：

1. **扩展 `word_split` 规则表的正向判据集**（单源 `subtitle-rules.json`，三端同步加载）：
   - 新增 `phrase_tail`：高频双字词/短语的末字集（动词、形容词、名词右边界），作为块尾收束判据
   - 新增 `phrase_head`：对应的高频短语首字集，作为块首引导判据
   - 二者同时命中才构成「短语边界」（单侧命中不构成），避免把「某｜些」这类假边界放进来
2. **放宽 `wordSafeSplit` 的头块下限**：`minHead` 从 `minChars(8)` 放宽到 `minChars - 2`，与既有的 `tailMin` 软约束对齐（规范已有先例：「v1.2.2 软约束：头块欠长但 >= minHead-2 且尾块 >= tailMin 时仍接受」）
3. **兜底路径增加语义排序**：`wordSafeSplit` 第二段 for 从「第一个非黏着后缀」改为「短语边界优先，其次非黏着后缀」，消灭纯算术裸切

## 5. 三端一致性验证基线

修复前后必须保持：
- Python（smart-sentence-splitter `tests/unit/test_subtitle_vectors.py`）
- TS（`packages/story2video-engine/tests/subtitle-vectors.test.ts`）
- JS（`apps/desktop/electron/services/story2video-segmentation-vectors.test.js`）
- parity（`apps/desktop/electron/services/story2video-segmentation-parity.test.js`）

四组测试对同一份 `subtitle_segmentation_vectors.json` 逐字一致。
