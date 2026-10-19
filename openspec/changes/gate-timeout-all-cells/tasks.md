# Tasks: gate-timeout-all-cells

- [x] 全仓发现：扫出 24 格作业级 + 2 格步级（11 个 workflow）
- [x] 实测采集：逐 workflow 拉 run/jobs，得出每格 samples/max/p90/截尾（probe_errors=0）
- [x] 补采矩阵作业（`QG Desktop Shards`，57 样本）与模板名作业（`Autonomous Loop`，56 样本）
- [x] 数据单点 `scripts/gate-timeout-registry.json`（24 条，12 measured / 12 seeded）
- [x] 加载器 + 严格校验 `scripts/lib/gate-timeout-registry.js`（8 道负控全炸）
- [x] 判据扩展：逐格规则 + 清单棘轮 + seeded 双向
- [x] 采样器扩展：全仓/单格、矩阵归并、模板名前缀、在飞与漏样分离、零样本出声
- [x] 旧 provenance 降为转发 shim（既有消费者零改动）
- [x] 回归锁 20 → 26（新增 17 棘轮①/18 棘轮②/19 缩进纪律/20 seeded 双向/21 校验器/22 真实仓全量）
- [x] 接线：`quality-gate.yml` changes 作业 Gate 2b7 扩范围
- [ ] 归档：本 change 合并后再落 `openspec/specs/`（按仓规，归档前以 PRD 为准）