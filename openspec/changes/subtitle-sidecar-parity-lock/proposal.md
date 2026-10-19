# Proposal: subtitle-sidecar-parity-lock

## Why

`subtitle-phrase-boundary-v1.3` 的遗留清单里有四条，本次处理其中三条并顺带纠正一处我自己的错述。
它们的共同点：**都是「没有任何判据会红」的静默失效面**，而不是已知 bug。

1. **跨仓数据靠两份手工副本，没有任何东西会告诉你「只改了一边」。**
   字幕规则表 `subtitle-rules.json` 与切割向量 `subtitle_segmentation_vectors.json` 在
   mulpub 与 smart-sentence-splitter 各存一份。两仓单测各读自己仓的副本，全绿；线上 8002
   跑的是 sidecar 副本，本地降级路径跑的是 mulpub 副本。两者只在 sidecar 不可用那一刻
   才会同时出现在同一条链路上。
   （旁证：`no_cut_bigrams` 的顺序已经在两仓之间漂了 9 个元素，集合相同所以行为没变，
   但这正说明「副本会漂且无人拦」。）

2. **Python↔TS 的自动比对是「假锁」。** 此前我把这条记成「无 CI 自动比对」，复核后
   发现说法不准确也不到点上：`ops-center/backend/tests/test_prompt_eval_segmentation.py`
   确实用 esbuild 打包桌面端 TS 做输入→输出对照，但它三重失效：
   ① `ops-center-ci.yml` 的触发路径只有 `ops-center/**`，**改桌面端 TS 时它一次都不跑**；
   ② 被比的 Python 是**简化移植**（无 `good_lead`/`good_tail`/`semantic_lead`/
   `no_cut_bigrams`/`phrase_boundary` 整个词边界子系统），却自称「完整移植」；
   ③ 语料是硬编码的少量标点丰富句式，覆盖不到无标点长块。
   也就是说：**它看起来像有保护，实际保护不到本次改动的那一面。**

3. **`subtitle-phrase-boundary-v1.3` 的 learnings 里我写错了副本数。**
   原文「三个文件 + 一份共享数据 + 三份向量副本」，三处都错：实现是 4 份（漏了 ops-center
   的简化 Python）、数据是 2 份手工副本（不是 1 份）、向量是 2 份（不是 3 份）。
   learnings 是被当权威读的，错述比缺失更贵。

## What

- **跨仓对账锁**：新增 `sidecar-parity.lock.json`（两仓逐字相同），登记规则表与共享向量的
  LF 归一化 sha256；两仓各一条断言本地文件匹配登记值。顺带把 `no_cut_bigrams` 的顺序对齐
  （集合相同，行为无关，但字节级判据要求逐字节相同）。
- **Python 金标对账**：新增 `subtitle_parity_corpus.json`（18 例，**只有输入**）与
  `subtitle_python_golden.json`（由 sidecar 生成器产出），TS 与 Electron JS 各自断言逐字复现。
  金标带 provenance（生成时的规则表/向量/语料哈希），改了任一方不重生成金标会红。
  生成器**不接受命令行路径参数**（输入输出都在 sidecar 仓内固定位置）；两仓各存一份语料与
  金标副本，侧车侧另加「金标与本仓数据版本一致」断言防止过期副本被复制过去。
- **跨仓校验脚本** `scripts/check-sidecar-parity.js`（零依赖）+ 定时 workflow
  `sidecar-parity.yml`（`schedule` + `workflow_dispatch`，**不挂 PR**），补上「单仓锁看不见的
  那一格」，并逐个比较**四份**共享产物（规则表 / 向量 / 语料 / 金标）。判据本体的检出能力由
  `scripts/check-sidecar-parity.test.js`（13 例）锁住，接在 `quality-gate.yml` 的 Gate 12f
  （changes job，每个 PR 都跑）。
- **ops-center 假锁改诚实**：`prompt_eval_segmentation.py` 头部从「完整移植」改为如实的
  覆盖/未覆盖声明（`PORTED_SURFACE` / `NOT_PORTED_SURFACE` 两个常量），并加一条
  **声明与源码互相印证**的一致性锁（未移植清单必须点名词边界子系统；源码里必须确实没有
  那些实现标识）。语料边界也写进测试文件 docstring。
- **learnings 更正 + 两条新 lesson**。

## Capabilities

- 新增 `subtitle-sidecar-parity`（跨仓数据一致性与跨实现行为一致性的判据集合）。

## Impact

- `packages/story2video-engine`（fixtures + 2 条测试）、`apps/desktop/electron/services`（1 条测试）、
  `scripts/`（1 脚本 + 1 自测）、`.github/workflows/`（1 新 workflow + quality-gate 1 步）、
  `.gitignore`（1 条 negation）、`ops-center/backend`（1 注释 + 3 条测试）、文档。
- **不改变任何运行时行为**：本次全部是判据与文档，切分逻辑零改动。
- 跨仓：`smart-sentence-splitter` 侧需要同批提交（规则表顺序对齐 + 锁文件 + 金标生成器 +
  对账测试），否则两仓锁不一致、跨仓对账会红。
- **不在本次范围内（如实记录）**：
  - `ops-center-ci.yml` 不加 `packages/story2video-engine/**` 触发路径。该 job 已长期卡在
    10 分钟超时临界（main 上最近 7 次有 3 次被 cancelled），加触发只会加剧取消率；真问题是
    移植保真度而不是触发频率，本次先把声明改诚实并记录缺口。
  - `pairs` 短语表仍是显式枚举，有覆盖上限。该做的不是盲目挖语料，而是先量化「走到 MAX
    裸切的比例」——属独立切片。
  - 「只修了无标点长块硬切一族」：需要真实坏切样本才能分类，不是代码问题。
