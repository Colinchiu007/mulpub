# Tasks: UX 审计阶段 5.3 / 5.4

## 1. 判据本体

- [x] 1.1 `scripts/check-ui-wired.js`：props 检测四写法 + 剥注释 + 排除测试面 + 只可缩小的欠账棘轮 + 三档退出码（0/1/2）
- [x] 1.2 `scripts/check-field-consumed.js`：`ref`/`shallowRef` 写读分类，export 行不算消费、重命名解构算消费、测试面不算消费
- [x] 1.3 两条判据都打印现场读数（域 / 候选 / 命中 / 登记），空域与读不到一律 rc=2
- [x] 1.4 判据支持 `--scan-root=` / `--debt=` 注入（否则装配层的两处口径无法用 fixture 整跑验证）

## 2. 基线与判据域测量（先量后写，不凭印象）

- [x] 2.1 未接线组件首版基线 = 6 条，逐条 `grep` 人工核实为真阳性后才登记（含"唯一命中是一句注释"的 TrialBanner）
- [x] 2.2 死观测字段首版基线 = 1 条；探针第一版曾报 3 条，其中 2 条经核实是**假阳性**（`dashboardUrls` / `qrCodePlatforms` 在本文件 getter 里被读），据此改正判据而不是放宽清单
- [x] 2.3 登记 reason 写明归属批次与终局（阶段 3.7 / 3.9），并标注 `lastApprovalDismissed` 为功能缺陷候选

## 3. 回归锁

- [x] 3.1 `scripts/check-ui-wired.test.js` 10 条（props 四写法、剥注释、测试面、三种引用形态、规模下界、命中=登记、无 reason 判红、清空清单判红、fixture 整跑 main、缺根 rc=2、未知旗标不静默跳过）
- [x] 3.2 `scripts/check-field-consumed.test.js` 8 条（写而不读、赋值左值不充读、export 行不算消费、三种跨文件消费、测试面排除、规模下界、清空清单、无 reason）
- [x] 3.3 四条变异反证逐条实跑变红、还原后 md5 逐字节一致：
  A 摘掉 stripComments / B 取消测试面排除 / C 把 store 自身源码算进跨文件消费 /
  D 退回被禁的 `(?!\s*:)` lookahead。A、B 落在 fixture 用例的**不同断言**上
  （A 让 CommentOnly 逃检、B 让 TestOnly 逃检），C、D 红集互不相同

## 4. 接线与防再犯

- [x] 4.1 本体 + 自测接进 `quality-gate.yml` Gate 2b（`shell: bash`，fail-fast；理由写进 workflow 注释，不接 Gate 3）
- [x] 4.2 `.gitignore` 补 4 条显式反选（第 106 行 `scripts/*.js` 会静默忽略，同 #3011 家族）
- [x] 4.3 `scripts/check-unwired-tests.js` / `check-step-failfast.js` / `check-workflow-structure.js` / `workflow-contract.test.js` 全部当场跑绿
- [ ] 4.4 6 条未接线组件的处置（接上电或删除）归阶段 3.7 / 3.9 批次 —— 本 change 只负责让它无法再沉默
- [ ] 4.5 `lastApprovalDismissed` 的功能裁决（是否应当抑制重复提醒）归后续 Bug 单（QM-5 五步）
