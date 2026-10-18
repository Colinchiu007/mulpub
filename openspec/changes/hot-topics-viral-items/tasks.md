# Tasks: hot-topics-viral-items

> 本片**只交付规格**。实现切片一律未勾选，并声明阻塞关系；勾选状态与证据必须双向对账（勾了就给取证落点，没做就不勾）。

## 1. 规格（本片交付物，已完成）

- [x] 1.1 新增 capability `hot-topics-viral-items` 的 Requirement 集（8 条）
  - 证据：`openspec/changes/hot-topics-viral-items/specs/hot-topics-viral-items/spec.md`（判别位必填、三全空丢弃、缺席不兜底、名次量不冒充热度、投影接线锁、`kind` 分流、locale 成对、未核实字段不得入规格），分支 `hot-topics-viral-item-model-spec`（PR 号见执行记录「远程同步」行）
- [x] 1.2 方案对比与选型记录（A 加宽同一对象 / B 并行两条列表 / C 判别联合，选定 C 并写明判据）
  - 证据：`openspec/changes/hot-topics-viral-items/design.md` 决策 1
- [x] 1.3 丢弃点与「字段缺席 ≠ 空值 ≠ 兜底值」三态表
  - 证据：`design.md` 决策 2、决策 3；spec 的 Requirement 2/3
- [x] 1.4 未核实项以 OPEN 登记，不凭想象写字段表
  - 证据：`design.md` 未决表 O-1～O-4（含"文档站为 SPA、本轮只取到样式脚本"的现场否证）；spec Requirement 8
- [x] 1.5 与专项 PRD 的真源关系写明（漂移时以本 change 为验收真源）
  - 证据：`design.md` 末节；`01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md` §6.1
- [x] 1.6 锚点自证：本 change 引用的 PRD 小节与代码文件逐个反查存在
  - 证据：`### 6.1 前置：条目数据模型扩展` 在 PRD 内命中 1 次；`channels.js`/`hot-topics-service.js`/`classifier.js`/`scorer.js`/`HotTopics.vue`/`locales/hot-topics/{zh,en}.js`/`01-docs/i18n-glossary.md` 均经 `ls`/`grep` 核实

## 2. 实现切片（未开工，本片不交付）

- [ ] 2.1 **前置取证**关闭 O-1（抖音官方热门视频榜的权限项/字段/配额/计费）——阻塞 2.3
  - 取证方法：由具备开放平台资质的账号按文档页实测一次，把响应原样落 `01-docs/research/`；取证前 2.3 不得开工
- [x] 2.2 条目模型落地：`kind` 必填 + `author`/`publishTime`/`interaction` 可选段，产出层写判别位
  - 证据（分支 `hot-topics-item-model`，PR 号见执行记录「远程同步」行）：新增单一实现 `apps/desktop/electron/services/hot-topics/item-model.js` + 用例 `apps/desktop/electron/services/hot-topics-item-model.test.js`（**21 passed**）；`channels.js` 13 个解析器逐个产出 `kind: KIND_TOPIC`；`hot-topics-service.js` 两个采集出口接 `filterViableEntries`、`getCache()` 接 `withLegacyKind`（读侧归一不写回）；`ipc-handlers/hot-topics.js` 的 `_sanitizeTopic` 接 `normalizeKind` + `pickContentFields`。
  - 验证读数：消费者并集 8 个测试文件 **170 passed / 0 failed**；`src/href-scheme-contract.test.js` **16/16**；四条变异反证 M1 3/21、M2 1/21、M3 2/21、M4 1/21 全部指名红且还原后 md5 相同；eslint rc=0；`check-debt-budget` 在基线内。
  - 既有断言校订：`hot-topics-service.test.js` 的旧缓存用例按新口径改写并加一条「读路径不得写回」。已落地口径详见 `01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md` §11。
  - 需改：`hot-topics/channels.js`、`hot-topics-service.js` 收集出口（资格判据 + 丢弃 + 指名告警）
  - 回归：spec Requirement 1/2 的每个 Scenario 各一条；含"把丢弃判据改成 no-op 必须变红"的反证
- [ ] 2.3 第一个内容条目源接入（依 2.1 结果在「官方 OpenAPI」与"自托管签名方案"中二选一）
  - 许可证门槛：候选源 MUST 为 MIT/Apache-2.0 或自持实现；GPL-3.0 只能作为用户自托管的外部服务、其代码不入包；无许可证/非商业学习许可一律不得引入
- [ ] 2.4 分类与评分按 `kind` 分流（`classifier.js`、`scorer.js`），含"不混算多榜同现"行为锁
- [ ] 2.5 投影接线锁：逐道白名单含键断言，或一条落盘→store 穿透断言；二选一都要有反证
- [ ] 2.6 渲染层显示项与文案（作者段/互动段/缺席态），locale zh/en 成对 + 术语对齐 `01-docs/i18n-glossary.md`
- [ ] 2.7 归档型热度标签（PRD §5 那片）与本片的合并点：独立字段、不进 `hotValue`、不参与跨渠道加权

## 3. 质量节拍（实现片适用，本片 N/A）

- [ ] 3.1 运行时代码片必须走隔离 worktree（`scripts/start-mp-task.ps1 -TaskName <kebab>`），禁止在共享根落盘 `apps/**`
- [ ] 3.2 QM-1 打包 + 启动三层判据（存活单独断言、子进程 env 剔除 `ELECTRON_RUN_AS_NODE`）
- [ ] 3.3 QM-4：HotTopics 若不在像素门禁 `pixelTests` 判定域内，**登记盲区**并按替代取证方式交证，不得拿「QG Visual 绿」当证据
- [ ] 3.4 QM-6 双模型外部评审（M+ / 涉及状态机与持久化）
- [ ] 3.5 `openspec` 归档三同步（archive + CCG task 归档 + 质量节拍复盘），且同 PR 校订 `.quality-rhythm/**` 镜像契约
