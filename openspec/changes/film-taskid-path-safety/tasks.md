# Tasks: film-taskid-path-safety

> 实施分支：`film-production-identity-followup`
> 依赖序：组 1（判据与收敛）→ 组 2（spec 同步）→ 组 3（验证与收尾）

## 1. 组 1：判据与收敛（TDD）

- [x] 1.1 RED：`production-driver.test.js` 新增 3 条——危险 taskId（`..`/`.`/`a\b`/`../evil`/`foo/../bar`/`a/b`/空/纯空白）被 driver 入口拒绝；合法 taskId（含 `my..task`/中文/内部空格）不被误拒；`isSafeTaskId` 判据与 `path.basename` 解耦
- [x] 1.2 GREEN：`production-driver.js` 新增并导出 `isSafeTaskId`（单一真源），自身守卫改用它
- [x] 1.3 收敛：5 个入口全部改用该判据（`film-engineering-production.js` 2 处、`film-engineering.js` 1 处、`production-driver.js` 1 处）——消除「每处各拼一次」
- [x] 1.4 全仓取证：`grep -rn "path.basename(taskId)" apps/desktop/electron/` 排除注释后 **0 命中**

## 2. 组 2：spec 同步

- [x] 2.1 spec delta：MODIFIED「失败分镜单镜重试」（判据表述）+ ADDED「任务标识的路径安全段合同」
- [x] 2.2 并入主 spec：`openspec/specs/film-engineering/spec.md` 整段替换
- [x] 2.3 自查：主 spec 中不再出现 `taskId === path.basename(taskId)` 作为合同表述；Scenario 全部含 WHEN/THEN

## 3. 组 3：验证与收尾

- [x] 3.1 变异反证：把 `isSafeTaskId` 换回 `!== path.basename()` ⇒ **2 条红**；还原 ⇒ 33/33 绿
- [x] 3.2 回归：`electron/services/film-engineering/` + `electron/ipc-handlers/film-engineering*.test.js` ⇒ **600 passed / 0 failed**（含此前长期红的 `download-recycled` 用例）
- [x] 3.3 门禁：max-lines / debt-budget / eslint / exec-record / 行尾对账 全绿
- [x] 3.4 执行记录 `openspec/records/film-taskid-path-safety.md`

## 4. 明确不做

- **auto 模式批次产物身份漂移**：另立 change。已实跑复现（删中间一镜 ⇒ 后续产物错位一位仍判「齐备」），
  但修法与本 change 不同——照搬手动出片的批次指纹会让用户改一个字就丢光已生成视频。
