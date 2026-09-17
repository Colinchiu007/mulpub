# Design — viral-rewrite-integration

## 架构决策

```
ViralAnalysis.vue ──addViralToLibrary（既有 IPC）──▶ viral_library
        │                                              ▲
        │ goRewrite(title)                              │ searchViral（既有 LIKE 检索）
        ▼                                              │
/rewrite?titleHint= ──▶ RewriteView chip ──ai:rewrite params.titleHint
                                                  │
                       RewriteEngineService.rewrite(params)
                                                  │
                  RewriteEngine.rewrite() ── _sanitizeTitleHint ──▶ userPrompt 软约束块
                          │
                          ├─ 第 8 步：RewriteQualityEvaluator（不变）
                          └─ 第 8.5 步：viralScorer(original) ∥ viralScorer(rewritten)
                                              │
                              ViralEngine.scoreText（container 注入）
                                  orchestrator /api/viral/analyze（8s 超时）
                                  ↘ 失败回退 _localAnalyze（mode: local-fallback）
```

## 关键取舍

1. **result.viral 挂顶层而非 quality.viral**：quality 在评估器失败时为 null，顶层挂载与 quality 生命周期解耦；渲染端独立归一化。
2. **互动数据置零**：scoreText 只评文本因子，original/rewritten 同口径，delta 才可比；真实互动校准留给 P2-F。
3. **mode 一致性门闩**：orchestrator 与 local 分数量纲不同（本地满分 ~37），跨 mode delta 误导 → 丢弃并 warn。
4. **titleHint 追加在模板替换后**：策略模板含 `{industry}` 等占位符，hint 若参与替换会被用户输入中的字面量二次注入（先例：审查 W-51）；追加式彻底规避。
5. **复用 viral_library 而非新表**：IPC/服务/存储/检索零新增；content 报告格式天然命中浅层特征提取（标题模式/关键词）。
6. **纯静态 i18n 键**：项目语料经 `toMessageFunctions` 转 Message Function（Electron CSP 禁 eval），`{param}` 插值不可用 → 标签键 + 模板拼接。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| scoreText 阻塞改写 | 独立 8s 超时 + fail-open（评审 W-1） |
| 本地启发式分数量纲粗 | mode 字段如实标注；delta 同口径对比仍有效 |
| 落库条目互动排序沉底 | 设计使然（likes=0）；P1-E 引入 `source:'analysis'` 筛选 |
| 双实现漂移（JS/Python 标题规则） | 已在 PRD §10-G 登记 P2 专项 |
