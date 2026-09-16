# Tasks

## PR-1 检索修复（P0）

- [x] 1. TDD：keyword-extractor.test.js（中文长文/英文混排/纯停用词/空输入/LLM fail-open）
- [x] 2. TDD：store 检索测试（多关键词 OR 命中、评分排序、空结果、touch 保留）
- [x] 3. 实现 keyword-extractor.js（extractSync + extractWithLLM）
- [x] 4. 重构 searchViralItems / searchPersonalItems（关键词化 + 评分）
- [x] 5. buildFullContext async 化 + llmKeywords 接线 + rewrite-engine adapter
- [x] 6. 运行 rewrite-engine 与 store 相关测试套件
- [x] 7. PR-1 双模型审查 + 提交

## PR-2 模式卡片（P1）

- [x] 8. TDD：模式卡片 store 测试（CRUD/状态机/attempts 上限）
- [x] 9. TDD：提取解析容错测试（围栏/非法枚举/金句截断/公式回退）
- [x] 10. store-schema 迁移 viral_pattern_cards + 存量回填
- [x] 11. PatternExtractionService（队列+有界并发+触发时机）
- [x] 12. buildViralContext 聚合风格指导 + 降级链
- [x] 13. Collection.vue 切换 Node 引擎 + 勾选框；HotTopics 默认开
- [x] 14. 模式分析标签页 + list-pattern-cards / reextract-pattern IPC
- [x] 15. DI 三步接线（container.setup → phase1-context → phase5-ipc → 字段断言）
- [x] 16. locales zh/en 成对 + 视觉回归
- [x] 17. PR-2 双模型审查 + 提交

## PR-3 效果闭环（P2）

- [x] 18. TDD：rewrite_history / tracked_content / snapshot / pattern_performance 测试
- [x] 19. store-schema：4 新表 + ALTER publish_history + 迁移
- [x] 20. RewriteEngineService 写 rewrite_history（失败不阻塞）
- [x] 21. 发布关联链路（前端携带 id → task → phase4-events → publish_history + tracked_content）
- [x] 22. platform-metrics 注册表 + 第一批 4 平台 parser
- [x] 23. PerformanceRecrawlService（调度+采样节奏+失败转 manual）
- [x] 24. url-collector 接入指标提取 + Collection 映射
- [x] 25. 发布历史表现列 + 手动录入对话框
- [x] 26. 效果洞察页 + 归因重算任务 + IPC
- [x] 27. DI 三步接线 + 端到端链路集成测试
- [x] 28. locales + 视觉回归 + QM-1 打包验证
- [x] 29. PR-3 双模型审查 + 提交
