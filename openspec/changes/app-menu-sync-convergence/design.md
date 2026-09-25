# Design：应用菜单跨端同步收敛

## 决策 D1：页面与下发的真源统一方式 —— 让 DB 跟随 CATALOG，而不是让页面跟随 DB

现状两侧各读一处：页面列表读 DB（`list_items`），下发载荷遍历 `CATALOG`（`get_bootstrap_app_menu`）。两种可选收敛方向：

| 方案 | 做法 | 结论 |
|------|------|------|
| A（采用） | DB 为运营态存储，但**始终按 CATALOG 增量供给**：读/写/下发前补齐缺失行，已有行不动 | 保留运营者的显隐/排序；新增菜单项自动出现在运营端，无需人工干预 |
| B | 页面直接遍历 CATALOG 渲染，DB 只存「被改过的项」 | 需要重写列表与保存两端语义与前端行模型，且「恢复默认」与增量存储的边界更难说清；改动半径明显大于 A |

选 A。**关键约束**：供给必须是「只补不改」——若顺手覆盖已有行，运营者的配置会在每次打开页面时被抹掉，那比缺行更糟。

## 决策 D2：下发缺行的兜底序号取目录位置而非 0

`sort_order` 兜底 0 会让缺行项在应用端排到分组最前。取 `index`（CATALOG 遍历序号）后，即便某次供给因并发/权限异常未落库，下发顺序仍与目录一致。这是纵深防御，不替代 D1。

## 决策 D3：模型目录与运行时策略改为并行独立，而非调换串行顺序

最初实现把 runtime 提到 catalog 之前（串行），全量测试立刻暴露代价：既有「超时（10 秒）」用例挂死到用例级超时——两条请求变成 10s + 10s，最坏整体预算翻倍，手动「立即同步」会有约 20s 无反馈。

改用 `Promise.allSettled` 并行：

- 任一条失败都不门控另一条（修掉根因）；
- 整体超时预算保持单请求 10s（保持既有契约，无需放宽任何断言）；
- 两条通道的失败彼此只影响自己返回的字段（`code/message` 属目录，`runtimeApplied/runtimeSyncedAt` 属运行时）。

代价：`模型服务未就绪` 分支单独走一次 runtime 拉取（helper `_syncRuntimeBestEffort`），避免在目录不可用时把运营配置也一起拒掉。

## 决策 D4：免重启生效用「主进程广播 + 渲染端重拉」，不做服务端推送

`applyRuntime` 成功后经注入的 `setOnRuntimeUpdated` 通知器向主窗口 `webContents.send('ops-center:runtime-updated', { syncedAt })`，`MpSidebar` 订阅后重拉 `ops-center-sync:appMenu`。

- 与既有的 `callback:received` / `offline:restored` / `keyword-monitor` 广播完全同构，不引入新机制；
- 通知器经 setter 注入而非构造函数参数：服务在 phase1 构造，那时主窗口还不存在；
- 载荷只带一个时间戳，**不携带配置内容**，渲染端仍走原有 IPC 读取路径，避免把未验签数据塞进事件通道；
- 该监听注册进 `PUBLIC_METHODS`：订阅本身不返回运营数据，而事件到达后的重拉仍受 `authenticated` 门控，未登录态不会因此获得配置。

## 决策 D5：重拉失败保留上一份有效配置

`loadAppMenu` 原实现在任何异常时把 `appMenuConfig` 置 `null`，即整体回退本地默认菜单。首帧这样是对的（fail-open）；但在「已有一份生效配置 → 手动同步时网络抖动」的场景下，它会让用户菜单瞬间变形再变回。

改为只在取到有效配置时整体替换。风险与边界：若运营端主动撤回配置（下发变 null），应用端会保留旧配置直到下次成功拉取——这是可接受的，因为撤回的语义本来就经由显隐字段表达，而非「不返回 appMenu」。

## Rejected

- **服务端主动推送（SSE/WebSocket）**：运营中心与桌面端之间目前是「拉取 + Ed25519 验签」模型，引入长连接要新设鉴权、心跳、重连与签名失效策略，半径远超本 Bug。D4 已消除「必须重启」这一实际痛点。
- **配置版本化 / 乐观锁**：当前是单运营者编辑场景，无并发写证据。
- **清理 DB 脏 key（不在 CATALOG 的历史行）**：删除是破坏性且不可逆的；下发侧本就按 CATALOG 过滤，脏 key 不会到达应用端。保留可见以便人工判断，不在本次范围内。

## 测试策略

| 层 | 锁住什么 |
|----|---------|
| ops-center pytest | 缺行时列表补齐；回填不覆盖 `library` 的 `visible=false/sort_order=42`；页面与下发的 key 集合恒等于 `CATALOG_KEYS`；缺行项下发序号 == 目录序号 |
| 桌面端 vitest（服务） | 目录 500 时 `runtimeApplied=true` 且 `appMenu` 落缓存；`模型服务未就绪` 时仍拉 runtime；`onRuntimeUpdated` 被调且抛错不影响应用结果；超时用例同时断言两条通道各被请求一次 |
| 桌面端 vitest（接线） | `setOnRuntimeUpdated` 已接线；广播发出正确 channel；窗口未创建/已销毁时静默跳过不抛 |
| 桌面端 vitest（渲染） | 事件到达后免重启更新一级导航；重拉失败保留上一份；卸载时取消订阅 |
| 桌面端 vitest（composable） | 目录失败 + runtimeApplied → 走 `syncPartialSuccess` 且不落 `syncError` |

夹具注记：`test_app_menu_api.py` 的 autouse  fixture 每例 `drop_all/create_all` 重建**空表**，因此原有用测在结构上不可能覆盖「非空库 + 目录演进」这条路径——这正是漂移逃逸 10 天的原因。新增用例改为先用 `_provision_from_catalog` 建全量库、再 `_drop_row` 删掉一项来模拟历史库。
