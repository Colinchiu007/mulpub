# tasks — Electron CI 整轮单测分片落地

## 1. 取证（先有数据再改预算）
- [x] 1.1 取最近 main push 的**步骤级** `elapsed=` 实测（不取 job 总时长）：1678s / 1759s 两次成功、2100s 两次撞墙
- [x] 1.2 取 ruleset 真相：required contexts 含 `electron-tests`（id 23749994 main-ci-gate）
- [x] 1.3 复核文档里"electron-tests 不在 required checks 里"那段（上一轮取证取错）并更正

## 2. TDD：先让新锁见证指名红
- [x] 2.1 `gui-ci-exit-contract.test.js`：单测相关锁改指分片作业 + 新增"分片形状/汇入作业/单片预算"三条锁
- [x] 2.2 `workflow-contract.test.js`：消费者锁与字面量锁改指分片作业 + 新增"分片作业与汇入作业各司其职"
- [x] 2.3 `workflow-contract.test.js`：docs-only 短路锁为两个新作业加**带理由**的豁免（放宽形状、保留意图）
- [x] 2.4 行为锁补一条：GitHub 表达式 `${{ … }}` 必须先物化再喂 bash（否则读数变成"退出码 1"而不是 124）

## 3. 实现
- [x] 3.1 `electron-ci.yml`：新增 `electron-tests-shards`（matrix 4 片 + 单片墙 1100s + 自证块）
- [x] 3.2 `electron-ci.yml`：`electron-tests` 改为汇入作业（id/name 都是 electron-tests、needs 分片、always()）
- [x] 3.3 `electron-ci.yml`：汇入作业里加"任一片失败即失败"的判定步骤
- [x] 3.4 文档 `docs/electron-ci-step-budget-baseline.md`：换掉过时的 794s、写入分片换算、更正 ruleset 矛盾段

## 4. 变异反证（锁是否真有牙）
- [x] 4.1 M1 摘掉 `set +e` ⇒ 行为锁指名红
- [x] 4.2 M2 分片作业改名成 `electron-tests` ⇒ 汇入作业锁指名红
- [x] 4.3 M3 删掉汇入作业的失败判定步骤 ⇒ 汇入失败传播锁指名红
- [x] 4.4 M4 片数 4→2 ⇒ 片数锁指名红
- [x] 4.5 M5 单片预算 1100→2000 ⇒ 预算关系锁指名红
- [x] 4.6 M6 去掉 `--shard` 参数 ⇒ 分片参数锁指名红
- [x] 4.7 还原后逐字节相同（md5 比对）+ 锁全绿

## 5. 门禁与评审
- [x] 5.1 `node --test .github/scripts/workflow-contract.test.js` 全绿（45 pass / 0 fail）
- [x] 5.2 `apps/desktop/tests/gui-ci-exit-contract.test.js` 全绿（47/47）
- [x] 5.3 其余静态门禁（行数 / 品牌残留 / 接线棘轮 117 文件 / openspec validate --strict）
- [x] 5.4 CCG 外部双家族评审（claude + opencode，3 条：i1/i4 假阳性 dismissed、i2/i3 upheld 已改）

## 6. 落地
- [x] 6.1 提交（`2f8211bb0`）+ 推分支
- [ ] 6.2 门禁全绿后 squash 合并 + 删远端分支
- [ ] 6.3 回读 merge SHA 上的 main push CI
- [x] 6.4 执行记录 `openspec/records/shard-electron-unit-round.md`
