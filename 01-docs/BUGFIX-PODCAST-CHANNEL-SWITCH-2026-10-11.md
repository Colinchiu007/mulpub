# BUGFIX · 播客切频道整条路径不可用（刀 1 遗留，QM-6 前端评审暴露）

日期：2026-10-11　分支：`podcast-feed-sync-ui`（PR #3286）　引入提交：`5fdb97b8b`（刀 1，PR #3279）　存续：约 2 天，跨 3 次 QM-6 外部评审未被发现

---

## 1. 第一性原因（根因溯源）

`apps/desktop/src/composables/usePodcastChannelPicker.js` 的 `switchChannel()` 函数体写了：

```js
channel.value = null
episodes.value = []
feedResult.value = null
verifyResult.value = null
try {
  await loadChannel()
  await loadEpisodes()
```

这五个标识符（`channel` / `episodes` / `feedResult` / `verifyResult` / `loadChannel` / `loadEpisodes`）**在 picker 的词法作用域里不存在**——它们属于页面域 `usePodcastChannel.js`。picker 声明并解构的依赖只有 `{ call, ipcException, onChannelActivated }`，而 `onChannelActivated` 被解构之后**一次都没有被调用**。

`5fdb97b8b` 的意图（写在 picker 文件头注释里）是：「切换频道时要清什么由页面域说，不由目录模块猜」。实际落地时注释写对了、函数体却是把页面域原来的实现**整段原地留下**没换成回调。于是用户侧症状为：

- 在播客页点频道切换器选另一个频道 → `channel.value` 求值即抛 `ReferenceError: channel is not defined`；
- 该异常发生在 `switchingChannel = true` 之后、`try` 之前，`finally` 不在范围内 → **`switchingChannel` 永久停留在 true**，切换器从此禁用，只有重进页面才能恢复；
- 用户看到的是「点了没反应，然后切换器再也点不动」。

`git blame` 定位到引入点，`git show 5fdb97b8b^:…Picker.js` 不存在（该文件由该提交新建），故这是一次**拆分时新写的坏函数**，不是搬代码搬丢的。

## 2. 逃逸链（为什么四层都没拦住）

| 层 | 结论 | 为什么漏 |
|---|---|---|
| 单元 / 集成（vitest 全量） | 未拦 | **全仓没有任何用例引用过 `switchChannel`**（`grep -rna switchChannel apps/desktop/src --include=*.test.js` = 0 命中）。被拆出去的页面域那几个标识符在原文件里有定义，拆分后新文件里的引用从未被执行过，vitest 不做未执行路径的类型检查（项目是 JS 不是 TS，无编译期未定义标识符检查）。 |
| IPC 桥接结构锁 | 未拦 | 它数的是通道字面量与 preload 方法，与 composable 内部标识符无关。 |
| 视觉回归 | 结构性失明 | 基线是单帧截图，频道切换是交互；且没有登记「切换后的视图」这一用例。 |
| QM-2 自审 + 前两轮 QM-6 | 未拦 | 评审看的是 diff 增量。刀 1 的 diff 里这段函数体是「新增文件的一部分」，1500+ 行的多频道改造里没人逐行核对新文件的每个标识符是否可解析。 |
| 真机验收 | 未做 | 刀 1 交付时只跑了 IPC 级手工验证（配置/发布），没有点过切换器。 |

**共同形态**：这是 AGENTS.md 记过的「装饰性链路」同族——代码存在、导出存在、调用点存在，唯独没有一条证据说明它被执行过。

## 3. 系统性漏洞

1. **拆分型重构没有「每个新函数至少被执行一次」的门禁**：`check-unwired-tests.js` 管的是测试文件接没接进 CI，不管「某个导出的函数有没有任何测试引用」。
2. **JS 项目缺少未定义标识符的编译期检查**：ESLint 的 `no-undef` 能精确抓到本案（`channel` 未定义），但本仓 `apps/desktop/src` 的 lint 不在任何 CI 门禁的阻断路径上。
3. **交互路径不进视觉基线**，而 composable 层又没有「切频道要清哪几样」的行为锁——两不管。

## 4. 修复 + 回归保护

**修复**（两处，方向不同）：

- `usePodcastChannelPicker.js`：`switchChannel` 改为调用 `await onChannelActivated()`（它自己声明的契约）+ `await refreshQuota()`，删除对页面域标识符的直接引用。
- `usePodcastChannel.js`：`onChannelActivated` 的清理清单补 `feedSync.value = null` —— 横幅的判据必须随频道归属一起失效，否则 A 的 `failed` 挂到 B 名下，而重试按钮拿的是 B 的 `channelId`（QM-6 前端评审 #1，Critical：面向错误目标的不可逆外发覆盖）。读取失败分支保持 `null`，不回填旧值。

**回归锁**：`apps/desktop/src/composables/usePodcastChannel-switch.test.js`（5 条，真实 composable + 真实 picker + 只 mock `@/api/podcast-channel` 的函数引用）：

1. `switchChannel` 必须 resolve（**这条就是本 Bug 的坐实用例**：修复前 `ReferenceError: channel is not defined`，5 条全红已实测）；
2. `channel:get` 往返窗口内 `feedSync` 必须已是 `null`（用 deferred gate 精确制造「在飞」状态）；
3. 切频道后读取失败 → `feedSync` 保持 `null`，不残留上一频道旧证据；
4. 切到真带 `failed` 的频道 → 横幅数据必须是新频道自己那份（防止「清空」退化成「永远清空」）；
5. 接线结构锁：picker 的 `switchChannel` **函数体**（按花括号配平取、剥行注释）不得出现页面态标识符，必须出现 `onChannelActivated()`；页面域 `onChannelActivated` 函数体必须出现 `feedSync.value = null`。

第 5 条的实现细节两条都是本仓踩过的坑：锚点用花括号配平而不是「下一个函数名」（搬走函数会让 `indexOf` 变 -1、区间静默放大）；判据前剥掉 `//` 注释行（否则注释里举例说明「曾经写错了什么」的字面量会幽灵命中——本次实测就绊了第一次）。锚点缺失一律抛错，不静默返回空串。

## 5. 预防措施（落到文件，不是「以后注意」）

- **反证**：把 `onChannelActivated()` 改回直接引用页面态标识符 ⇒ 用例 1 红；摘掉 `feedSync.value = null` ⇒ 用例 2/3/5 红；把「清空」改成「读失败时回填旧值」⇒ 用例 3 红。三条均实测（见 `.quality-gates.md` 本记录）。
- **PRD §8 新增两条交互契约**：「横幅与频道归属同进同退」「一次失败的三个承载面是分层不是重复」，把判据写成句子而不是留给下一个人猜。
- **spec 新增 Scenario**：「切换频道不得把上一频道的同步状态带过去」（Requirement 内已加 SHALL 级约束：`feedSync` 与 `activeChannelId` 同进同退）。
- **同族欠账登记**：本仓 `apps/desktop/src/composables/` 下由拆分产生的新模块，其「回调契约」目前只有注释在守。刀 3 的发布状态机接线时会顺带检查 `usePodcastChannelActions.js` 是否有同形问题（它也在拆分产物里）；不在本片扩大范围，记入 `openspec/records/podcast-feed-sync-ui.md` 的未闭合项。
- **方法论入记忆**：拆分型重构的完成判据必须包含「每个新导出函数至少被一条用例执行过」，`grep` 引用数 = 0 即视为未验证，不得写进交付证据。
