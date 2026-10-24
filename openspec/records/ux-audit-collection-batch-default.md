# 执行记录：采集页批量平台默认值改由平台目录数据流驱动（ux-audit-collection-batch-default）

- 分支：`ux-audit-collection-batch-default`
- 日期：2026-10-24
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=false**（含运行时代码），
  走完整质量节拍 + 独立 worktree + PR。规模 S（2 文件、约 +25/-2），故未另建 openspec change 目录，
  规格变更以本记录 + 审计文档 2.3 行的更正承载。

## 1. 这条是从哪来的（复核审计项 2.3 时发现，不是原条目本身）

`01-docs/UX-AUDIT-2026-10-17.md` 阶段 2.3 写的是「`Publish.vue`/`Collection.vue`/`PodcastChannelView`
onMounted 改 `allSettled`（audit-63）」。动手前逐个读现状，三个视图的真实状态与条目描述**不一致**，
必须分开记：

| 视图 | 现状 | 结论 |
| --- | --- | --- |
| `Collection.vue` | onMounted 早已是 fire-and-forget（前批完成），**但**同帧读 `batchPlatformOptions` 赋默认值 | 条目所述缺陷不存在；另有一条由"不 await + 同帧读派生值"派生出来的真缺陷 ⇒ 本 PR 修它 |
| `PodcastChannelView.vue` | 已用 `Promise.allSettled`，但把两批独立请求写成 `await allSettled([loadChannel()])` 之后再 `await allSettled([loadEpisodes(), loadEndpoints()])` | 真串行，属本条目未完成部分（另批，见 §5） |
| `Publish.vue` | `loadDrafts → loadAccounts → loadPrecheckPreference → applyRouteHandoff` 全串行 await，但相邻两步之间有真实数据依赖（默认账号要等平台/账号清单） | 不能机械改并行，需按依赖重排（另批，见 §5） |

## 2. 缺陷本体与用户可见症状

```js
if (!platformStore.loaded) { Promise.resolve(platformStore.load()).catch(() => {}) }   // 不 await（正确）
...
if (!batchPlatformScope.value && batchPlatformOptions.value.length) {                   // 同帧就读（错）
  batchPlatformScope.value = batchPlatformOptions.value[0].id
}
```

`batchPlatformOptions` 是 `computed(() => batch.usablePlatforms('imageText'))`，其数据来自
`platformStore.platforms`；全仓**没有** app 级预加载（`platformStore.load()` 由 8 个视图各自懒触发）。
于是冷启动**直接落在采集页**（刷新停在 `#/collection`、从 404 兜底页点回、外链/快捷键直达）时：
目录还在飞 ⇒ options 是空数组 ⇒ 这个 if 不成立 ⇒ 而它是 `batchPlatformScope` 的**唯一**赋值点，
目录到位后没人再补。用户侧表现：批量图文/批量发布的「目标平台」是空的，必须手选一次；
连带 `batchAccountOptions = accountsOf(batchPlatformScope.value)` 也是空 ⇒ 账号区看起来"没有账号"。

⚠️ 这与本仓既有口径是一对反例：**"不阻塞首屏"做对了，但把默认值的来源从数据流改成了时机** ⇒
静默地造出一个"只在冷启动出现、切回来就正常"的缺陷（这类"时机驱动"正是 AGENTS
「等待/就绪判据必须锚定最小出口」那条的同型）。

## 3. 修法

删掉 onMounted 里那两行赋值，改为由平台目录这条数据流驱动（`immediate:true` 覆盖"目录已在场"那一支，
即从别的路由切回采集页时仍立刻补默认值）：

```js
watch(batchPlatformOptions, (list) => {
  if (!batchPlatformScope.value && list.length) batchPlatformScope.value = list[0].id
}, { immediate: true })
watch(batchVideoPlatformOptions, (list) => { …同形… }, { immediate: true })
```

三条不可破：
1. **不得为了拿默认值把 `load()` 改回 `await`** —— 那等于把这条重新变成阻塞首屏（QM-2 明禁），
   由结构锁第 4 条钉住；
2. **默认值只能有一个写者** —— 保留原 onMounted 那行会得到"两处决定同一件事"，
   由结构锁第 1 条按赋值点计数钉住（**恰好 1**，0 处同样红：那说明改动丢了）；
3. **用户已手选过不得被目录后到冲掉** —— 赋值带 `if (!scope.value)` 前置，且 `immediate` 那次读到的
   是空清单不会写。

## 4. 门禁与证据（逐条现场读数）

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | `scripts/start-mp-task.ps1` 建 `mp-ux-audit-collection-batch-default`；`verify-worktree-deps.js` OK（11 项） |
| TDD 红证 | ✅ | 修前跑新测试：`1 failed`，断言原文 `默认目标平台必须自动取目录首项: expected '' to be 'douyin'`，**且同一用例里 `平台目录应已就位` 已先断出 options=2** ⇒ 红的是"目录到了但默认值没补"这一格，不是"目录没到" |
| TDD 绿证 | ✅ | 修后 `src/views/Collection.batch-platform-default.test.js` 4 passed；`it(` 计数 4（防插入吞行） |
| 消费者并集 | ✅ | 按 AGENTS「改调用形态就是改契约」取并集：7 个 Collection/批量发布相关文件 **161 passed / 0 failed** |
| QM-2 首屏口径 | ✅ | 未新增 await；结构锁第 4 条钉住 fire-and-forget 原样 |
| QM-4 视觉 | ⏳ 交 CI 判 | 未新增像素用例；`Collection.vue` 无样式改动，`QG Visual` 由 CI 在同一次渲染里判 |
| eslint | ✅ | rc=0（`Collection.vue` 另余 2 条 **既有** warning：`asrInstallPendingUrl` / `ERROR_CODES` 未使用，非本批引入，不认领） |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致后再提交 |
| 台账（CHANGELOG） | ✅ 按新规 | **不直接编辑 `CHANGELOG.md`**，变更说明写进本文件的 §7 由聚合器搬运（AGENTS `CHANGELOG.md` 条） |
| QM-6 | 见 §6 | 规模 S，判定预计 single（<200 行），据实回填 |
| 远程同步 | 见 §6 | PR 号与合并 SHA 在合并后由 `scripts/lib/merge-ledger.js` 推导，不手写状态词 |

## 5. 明确留给另批的（不静默吞掉）

- `PodcastChannelView.vue` 的两批独立请求可合成一批（`loadChannel` 与 `loadEpisodes/loadEndpoints`
  无相互依赖）；改动很小但属该视图自己的首屏口径，需配一条同形态的行为锁。
- `Publish.vue` 的串行链必须按依赖重排（默认账号依赖平台清单已到位），不能机械 `allSettled`；
  该视图历史上因 onMounted 语义合并出过事故（#3986），须单独一刀并带 `applyRouteHandoff` 幂等断言。
- 本条修的是"默认值"，不是"批量选择真源"。`batch.batchSelection.value.imageText.platforms`
  由 `watch([scope…])` 单向灌入，目前无第二写者；若将来面板要直接改它，必须先把这条链显式化。

## 6. 收尾清单（合并后回读，不凭记忆）

- PR：待创建后回填编号。
- merge SHA / 远程同步状态：由门禁按主干历史推导（`MERGE-ledger`），本文件不手写状态词。
- main push 回读：`gh run list --workflow=quality-gate.yml --commit <merge SHA>` 必须有一条且 `conclusion=success`。

## 7. CHANGELOG 条目

# fix(采集页): 批量「目标平台」默认值改由平台目录数据流驱动 —— 冷启动直达采集页不再要求手选（ux-audit-collection-batch-default）

- **问题**：复核审计项 2.3 时发现 `Collection.vue` 的 onMounted 已是 fire-and-forget，
  但**在同一帧**读 `batchPlatformOptions` 赋批量目标平台的默认值，而该 computed 的数据
  来自此刻仍在飞的 `platformStore.load()`（全仓无 app 级预加载）。冷启动直接落在采集页
  （刷新停在 `#/collection`、从 404 兜底页点回、外链/快捷键直达）时 options 为空 ⇒
  这唯一一处赋值不成立，目录到位后再没人补 ⇒ 用户看到「目标平台是空的，必须手选一次」，
  且连带账号区为空。
- **修法**：删掉 onMounted 那两行，改成 `watch(batchPlatformOptions, …, {immediate:true})`
  两个形态各一条 —— 默认值由**数据流**驱动而不是由"挂载那一刻"驱动；`immediate` 覆盖
  "目录已在场"（从别的路由切回来）那一支。三条不可破：不得为了默认值把 `load()` 改回 `await`
  （那是重新阻塞首屏，违反 QM-2）、默认值只能有一个写者（结构锁按赋值点计数恰好 1）、
  用户已手选过不得被目录后到冲掉（`if (!scope.value)` 前置）。
- **本批最有价值的一条**：条目说"改成 allSettled"，三个视图逐个读现状后是三种不同事实
  （Collection 早已并行但默认值时机错、PodcastChannelView 两批独立请求被串成两次 await、
  Publish.vue 相邻步骤有真实数据依赖不能机械并行）。**按条目字面施工会把已完成的部分重做一遍，
  并把真缺陷原样留在原地** —— 现状必须逐个读，不能按审计文档的写成什么样就做什么。
- **测试**：新增 `src/views/Collection.batch-platform-default.test.js`（4 条：目录晚到必须补默认值 /
  已手选不被冲掉 / 视频形态同契约（fixture 里刻意放一个 VIDEO 形态，让那条**非空可断**而不是走进
  else 变恒真）/ 结构锁：唯一写者 + 数据流驱动 + fire-and-forget 未被改回 await）。
  红证为 `默认目标平台必须自动取目录首项: expected '' to be 'douyin'`，
  且同用例先断出 `options.length === 2` —— 红在"目录到了但没人补"，不是一句"目录没到"。
- **验证**：修后 4 passed；消费者并集 7 文件 **161 passed / 0 failed**；eslint rc=0
  （`Collection.vue` 余 2 条既有未使用变量 warning，非本批引入）。
- **台账口径**：本批按 AGENTS 新规不直接编辑 `CHANGELOG.md`，条目由聚合器从本记录搬运。
