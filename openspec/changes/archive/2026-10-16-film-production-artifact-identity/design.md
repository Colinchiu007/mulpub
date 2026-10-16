# Design: film-production-artifact-identity

> 记录关键决策与被否决的备选方案。每条给出「为什么选 X 不选 Y」。

## D1 批次 runId 怎么带上分镜身份

### 被否决：A. 产物旁写 sidecar（`shot_000.json` 记 shotId）

- 优点：不动 runId、不动目录名，续跑兼容性最好。
- 否决理由：**治标不治本**。`runId` 仍相同 ⇒ 两组分镜仍写进同一目录 ⇒ 目录里同时躺着 A 组和 X 组的 `shot_000.mp4`（互相覆盖或按先后残留）。sidecar 只是让复核"能发现问题"，但问题发生时产物已经污染了。而且**每次复核都要读 N 个 sidecar**，把一个 O(1) 存在性检查变成 O(N) 文件读。
- 真正需要 sidecar 的只有一种情况：runId 不可变但要追认历史产物。本 change 不需要——存量台账自带 runId。

### 选定：B. runId 携带分镜集指纹（`prod-<taskId>-<fp10>-b<N>`）

- 换分镜 ⇒ 指纹变 ⇒ 目录变 ⇒ **物理隔离**，旧产物根本不在新任务的路径上。
- 复核逻辑不变，仍是 O(1) 的 `existsSync`。

### 指纹口径

```js
fp10 = sha1(shotIds.join('\n')).slice(0, 10)
```

- **按批次算，不按整个任务算**：`runId` 是 per-batch 的，batch 0 的分镜变了不该影响 batch 1 的目录。
- **长度 10 而非 8**：8 位（32 bit）在万级批次规模下碰撞概率已不可忽略（生日界 ≈ 10^4 量级）；10 位（40 bit）在 10^6 批次下碰撞概率仍约 10^-6，可接受。SHA1 截断在此处只作身份标识、不作安全用途。
- **用 `join('\n')` 而非 `join(',')`**：shotId 理论上可含逗号（当前是 UUID，不含），换行分隔可避免 `[a,b]` 与 `[a,b]` 之外的歧义碰撞。

### 存量台账为什么零影响（关键论证）

断点续跑的 runId **不是重新派生的，是从台账里读的**：

```
production-driver.js:97-105  resolveResumePlan(ledger, {probe})
  → ledger.batches.map(b => probe(b.runId, ...))     // b.runId 来自台账
production-driver.js:127     buildRenderManifest(ledger, {probe})
  → path.join(mediaRoot, b.runId, shotFileName(i))   // b.runId 来自台账
```

而 `createLedger`（唯一调用派生的入口）只在 `!sameShape` 时执行——即台账**缺失、损坏、或分镜集不匹配**。分镜集不匹配时重建台账**本就是期望行为**（#3110 的修复），此时用新格式 runId 反而是对的。

**结论：旧台账文件里的 `b.runId` 是历史事实，直接沿用；新台账用新格式。无需任何迁移脚本。**

### `runIdFor` 注入缝的签名扩展

现状：`runIdFor?: (taskId: string, batchIndex: number) => string`

改为：`runIdFor?: (taskId: string, batchIndex: number, shotIds: string[]) => string`

**为什么不改 auto-runner**：`auto-runner.js:25` 的 `autoRunIdFor(taskId, batchIndex)` 是 2 参函数。JS 多传实参不报错，auto 模式拿不到 `shotIds` 仍是两参语义，**行为完全不变**。这是既有注入缝的设计意图（`#2248` 已用它支持两套派生），沿用即可，不扩大爆炸半径。

## D2 单镜重试怎么定位批次

### 被否决：C. 让 `retry-shot` 先查流水线 run、再回落查台账

- 优点：不动 IPC 签名。
- 否决理由：**保留了两套真相源**。同一个 `runId` 字符串在两条路径下语义不同（流水线 runId vs 批次 runId），一旦某天 `prod-*` 恰好撞上某个流水线 runId，就会命中错误的那份数据。而且前端仍需拼 runId——**缺陷 B 的根因（渲染端复刻派生规则）原样保留**。

### 被否决：D. 把批次 runId 注册进 `pipelineEngine._runs`

- 优点：复用现成的 `retry-shot`。
- 否决理由：**污染流水线引擎的语义**。`_runs` 是流水线运行态（带阶段、进度、checkpoint），出片批次不是流水线 run，硬塞进去会让 `listRuns` / 历史清理 / 进度查询全部看到一堆假 run。为修一个 bug 往核心引擎塞假数据，不划算。

### 选定：E. 新增 `production-retry-shot` 通道，按台账定位

```
前端 {taskId, batchIndex, shotIndex, aspect?, seconds?}
  → 主进程 loadLedger(<mediaRoot>/production/<taskId>)
  → 找 batchIndex 匹配的批次 → shotId = batch.shotIds[shotIndex]
  → service.getShot(shotId) 取原文 prompt（逐字符，不经优化器）
  → generateShotVideo 写入 getFilmRunDir(batch.runId)/shot_NNN.mp4
```

- **前端不再拼任何 runId**——派生规则回到单一真源（`production-driver.js`），DRY。
- 校验照抄既有 `retry-shot` 的 fail-closed 形态：taskId 路径安全、batchIndex/shotIndex 边界、台账缺失、批次不存在、shotIndex 越界、prompt 为空，逐条拒绝。
- **不打 checkpoint、不改阶段状态机**，与既有单镜重试合同一致。

### 为什么不复用 `production-status` 返回的批次信息让前端传回

看似可行（`production-status` 已返回 `batches[].needRun` 等），但仍要前端组装一个复合标识传回主进程，等于把「批次身份」在两侧各表达一次——正是本次要消灭的模式。传 `taskId + batchIndex` 两个标量即可，批次身份由主进程从台账解析。

## D3 边界与风险

| 风险 | 处置 |
|---|---|
| 指纹碰撞导致两个不同分镜集共用目录 | 40 bit 指纹，10^6 批次下碰撞率 ~10^-6；且碰撞时表现为"目录复用"，与当前 bug 同类但概率低两个数量级。远期可换完整 sha1 或加自增盐 |
| 存量台账与新代码并存 | 已论证零影响（见 D1）。回归锁专门覆盖这一条 |
| 磁盘空间增长 | 换分镜会新建目录而不清理旧目录。**本 change 不自动清理**——产物在系统临时目录，用户可通过既有「影视工程缓存」清理入口回收。自动清理是独立议题 |
| `runId` 变长 | 旧 `prod-<taskId>-b<N>` → 新增 11 字符。路径长度风险可忽略（taskId 上限 64） |
| auto 模式未同步加固 | 明确记入遗留。auto 模式的项目身份需另行取证，不在本 change 猜测 |

## D4 验证策略

三组**变异反证**必须实测（把修复拆掉 ⇒ 锁必须变红）：

1. 拆掉指纹（runId 回到旧格式）⇒ 换分镜复用旧目录的用例必须红
2. `production-retry-shot` 改回用 `getRunSnapshot` 查 ⇒ 出片台账重试用例必须红
3. `runIdFor` 多传 shotIds 改成两参（指纹丢失）⇒ 指纹相关用例必须红
