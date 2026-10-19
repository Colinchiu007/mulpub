---
record: subtitle-word-integrity
task: 数字/单位完整性与双字搭配守卫 v1.4 —— 8 段复杂文案实测驱动的第二族坏切（三端同构）
date: 2026-10-19
---

## 本次执行记录：字幕分句 v1.4 守卫（subtitle-word-integrity，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 混合 PR（`packages/story2video-engine`、`apps/desktop/electron/services`、向量/金标/锁夹具），在隔离 worktree（D 盘）+ 分支 `subtitle-word-integrity`（**叠在 subtitle-parity-locks #3970 之上**——规则表哈希被 #3970 的对账锁登记，必须同链演进）；sidecar 仓同批（规则表/向量/金标/锁）。共享根健康检查因**其他会话的未跟踪文档 + 外部 worktree `D:/Temp/wt-qm6wb`** 未过，未做任何手动清理，改用现有 worktree 叠分支（入口 `pre-code-edit-guard` 放行） |
| 第一性原因（QM-5 ①） | 通过 | 8 段新文案三端对跑暴露 4 类坏切。git 视角的第一性引入点：**标点累积分支**（`text-segmentation.ts` 标点命中即 push，从不调用 `isSafeCutPosition`——v1.0 起就如此）+ `no_cut_bigrams` 词表缺口。**A/B 反证**：关闭 phrase_boundary 后输出逐字节不变 ⇒ 非 v1.3 引入。`风速每秒 8│米` 的切点是**空格**，`isSafeCutPosition` 拦不住——只改 MAX 兜底不够，必须在累积分支同接 |
| 逃逸分析（QM-5 ②） | 通过 | ① 单元——44 条共享向量无一含「数字│单位接缝」形态；② 集成——`findSafeCutPosition` 的守卫面不含 unit 判定；③ 累积分支——直切完全绕过守卫（本次真凶）；④ 三端——ops-center 简化移植不覆盖词边界子系统（假锁已由 #3970 记录）；⑤ 审查——v1.3 评审聚焦短语右边界，数字完整性不在当时语料 |
| 修复 + 回归保护（QM-5 ④） | 通过 | unit_guard（44 单位 + 双 bind）+ no_cut +7；接入点两处（isSafeCutPosition 第五条件 + 累积分支），TS/Python/JS 三端同构。回归保护 = 7 条 `v1.4_word_integrity_*` 手工真值向量（含 `short_block_exceptions` 显式声明）+ 变异反证 M1/M2 指名变红（2 红/1 红，跑完按字节还原 sha=5b0ff1849a30） |
| 预防措施（QM-5 ⑤） | 通过 | ① `no_cut_bigrams` 准入条款收紧为「每条必须列实测出处」（评审 i2）；② 零误伤预检脚本化读数入记录（评审 i5）——它当场否决了会改变已发布期望输出的 `飘地`；③ learnings 补「临时脚本路径必须用 `__dirname` 锚定自己 worktree」与「`git add` 对冲突标记文件不报错」两坑；④ ops-center 的 esbuild 夹具再次实证过期（内嵌 v1.1），三端对跑必须用当前源码重打包 |

### QM-6 决策层对抗评审（plan-review，claude 后端本轮可用）

| 项 | 读数 |
| --- | --- |
| 判定 | DUAL，跨家族校验通过（proposer=opencode / critic=claude） |
| 轮 1 | 8 条问题（Critical 2），最低分 6；修订应用 14 处 |
| 轮 2（初版方案） | regressed（5 < 6）⇒ 引擎自动回滚到最好版，裁决 blocked |
| 逐条回应 | `review-response.md`：i1 Critical 采纳（数字字符集扩中文数词 + 向量）；i2 采纳（无实证词条移除、准入收紧）；i3 采纳（right_bind 单一算法+反例）；i4 采纳（双登记职责注释）；i5 采纳（零误伤预检）——**预检当场否决 `飘地`** |
| 终审（v3 拆分评审对象/附录后） | **cleared**：Critical 0、无未解决 High ⇒ 放行写码 |

### 测试读数

| 套件 | 结果 |
| --- | --- |
| TS `packages/story2video-engine` 全量 | **263 passed**（44+7 向量 × 多断言 + parity + 金标 + 锁） |
| JS `apps/desktop` 分句域 | **202 passed** |
| Python sidecar 全量 | **611 passed, 9 skipped** |
| 跨仓对账 | PASS（四产物两侧一致，`rules=75151bb8… vectors=b787f83d… golden=fd689f1e…`） |
| 金标回归 | 重生成后 **169 块零变化**（零误伤实证） |
| 8 段文案三端对跑（fresh 夹具） | **8/8 逐字一致**，7 类坏切实例 0 残留 |

### 变异反证

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| M1 删 `word_split.unit_guard` | v1.4_unit 向量红 | **红（2 failed）** |
| M2 删 no_cut 新词条（当成/万人/遗忘/那段/仿佛） | v1.4_word 向量红 | **红（1 failed）** |

### 遗留（如实记录）

- `老槐│树下` 处所短语：开放集合，枚举不完备，待可观测性切片量化后再定。
- `测试/恐慌/看不见` 三词条待真实语料命中后按新准入补录。
- ops-center esbuild 夹具过期问题本轮再次实证（两次对跑被迫重打包）——夹具重建应接进 CI，属 #3970 已记录缺口的延伸。
- PR #3970（依赖前序）仍在 CI 中；本分支与其同链，合并顺序必须 #3970 先。

| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导 |
