# ContentPipeline 拆分评估报告

## 1. 当前状态

Phase 2 完成时，所有 v1 引擎代码已迁移至 content-aggregator-shared。
CA 仓库剩余代码: v2 FastAPI backend (~2000 行), v2 Vue 前端 (~1500 行), ContentPipeline (~400 行), Docker 部署。

## 2. ContentPipeline 分析

**决策: ContentPipeline 留在 CA，不迁移到 shared。**
- 编排层 vs 能力层，不包含可复用算法
- shared 应保持零业务逻辑
- ~400 行维护成本低

## 3. v2 FastAPI Backend

**决策: 不迁移。**
- 核心能力已通过 shared 库覆盖
- 竞品监控可后续评估
- 依赖 PG+Redis+Celery 与桌面部署冲突

## 4. v2 Vue 前端

**决策: 不迁移。**
- 已有 Collection.vue
- API 契约不一致

## 5. 总结

| 组件 | 决策 |
|------|------|
| ContentPipeline | 留在 CA |
| v2 backend | 不迁移 |
| v2 前端 | 不迁移 |

CA 最终形态: 编排薄壳 + re-export shim。
长期: Multi-Publish 自行实现异步编排。
