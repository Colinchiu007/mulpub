# 行为对照：修复前 vs 修复后

> 生成于 rewrite-default-strategy-fix 分支，输入为用户实际粘贴的 5557 字科技深度报道
> （D:\Temp\rewrite-eval\orig.txt）与各典型用户设置组合。

## 用户的那篇 5000 字深度报道

| 场景 | 修复前 | 修复后 | 说明 |
|---|---|---|---|
| 全空输入（RewriteView 默认） | strategy-viral-storytelling（故事化爆款/短视频编剧） | **strategy-knowledge-dry（干货知识）** | 核心修复目标：长文成稿不再被交给编剧人设 |
| 全空 + 传入原文 content | 同上（content 根本不传） | **strategy-knowledge-dry** | 新链路：原文形态参与兜底 |

## 用户显式表达意图时（修复后还能不能选对）

| 用户设置 | 修复后选中 | 是否正确 |
|---|---|---|
| industry=technology | strategy-knowledge-dry | ✅ 科技行业 → 干货 |
| platform=douyin | strategy-douyin-viral | ✅ 抖音 → 抖音爆款（修复前是 storytelling） |
| platform=xiaohongshu | strategy-xiaohongshu-种草 | ✅ 小红书 → 种草 |
| platform=wechat_mp | strategy-viral-storytelling | ✅ 公众号 → 故事化（公众号长文合理） |
| platform=bilibili / zhihu | strategy-knowledge-dry | ✅ B站/知乎 → 干货 |
| tone=casual（Collection 默认） | strategy-ecommerce-convert | ⚠️ 见下 |

## 关于 tone=casual 命中电商策略

这是**用户显式选择**驱动的正确命中（casual 是电商/抖音策略声明的语气），不是本次要消灭的「静默错配」——原始缺陷的特征是「用户什么都没选，结果被数组顺序决定」。用户在采集页选了「口语化」语气，匹配器据此选口语化权重最高的策略，行为可解释、可预期。

若运营上希望「口语化 ≠ 带货腔」，正解是调整 strategy-ecommerce-convert 的 tone 声明（它是 ops 可运营数据），或在采集页把语气选项与策略声明对齐——属于策略配置层面的运营决策，不是匹配器缺陷。
