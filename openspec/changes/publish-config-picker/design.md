# design — publish-config-picker

## 1. 关键决策

### D1：先证伪「只有故事讲述有配置管理」，再决定做什么

用户提出的第二点是「是不是只有故事讲述一个流水线有配置管理功能？其他流水线也要实现同样的配置管理」。开工前逐条核对（PRD §10.2）后确认：**配置档案能力早已覆盖全部视频创作流水线**（创作页共享分支的编排型与 legacy 型 + 视频克隆页 + 影视工程页），既有规格 `story2video-pipeline-config-profiles` 里就有「All video creation pipelines expose managed configuration profiles」这条 Requirement。

因此本片**不重造配置管理**，而是把「去发布」这一步的**入口**补上（选配置 → 带到创作页 → 自动套用）。若按字面新建一套「其它流水线的配置管理」，会与创作页已有的实现形成双源真相——正是本仓反复治理的病根。

**代价**：本片交付的「其它流水线配置管理」在用户感知上表现为「现在能在去发布时选到它们的配置了」，而不是「新增了它们的配置管理页面」。这个差异在 PRD §1.2 与 §2.2 里写明了。

### D2：配置下拉自建，不用 `el-select`

需求原文要「下拉选择框中显示文字『默认』，下拉内容中为空」。三种候选实现：

| 方案 | 「框内显示默认」 | 「下拉内容为空」 | 可选中「默认」退回 | 代价 |
|---|---|---|---|---|
| 原生 `<select>` + 常驻「默认」项 | ✅ | ❌（下拉里有一项） | ✅ | 与需求字面不符 |
| 原生 `<select>` + 零 option | ❌（框是空的，零信息量） | ✅ | ❌ | 用户看到一个看不懂的空框 |
| `el-select` + placeholder | ✅ | ✅ | ❌（placeholder 不可选） | 引入 EP 装配面；与左侧原生 select 视觉割裂；且仓内已有明确先例反对（见下） |
| **自建下拉（采用）** | ✅ | ✅（零配置时菜单节点根本不渲染） | ✅ | 多 ~50 行组件代码 |

采用自建下拉。决定性理由不是「需求字面」，而是**可退回性**：用户选完一条配置后还能选回「默认」，`el-select` 的 placeholder 做不到；而原生 `<select>` 要么塞进一个常驻「默认」项（与「下拉内容为空」冲突），要么留空框。

同时遵守本仓两条既有约束：
- `plugins/element-plus.js` 文件头硬约束①：新增 EP 组件必须登记（还有样式闭包成本）。为一个轻量浮窗引 EP 下拉会扩大装配面。
- 先例 `components/HotTopicsGenVideoPicker.vue` 已明确写下同款理由与做法（自建菜单、零新依赖、零样式导入）。

### D3：配置档案 id 走 URL，快照不走

`configProfile=<id>` 进 query，**快照不进 URL**：URL 长度不可控，且快照是设备级本地数据、不该外泄。创作页按 id 回库取快照——与创作页「我的配置」列表的取数路径完全一致。

**代价**：存在 TOCTOU 窗口（浮窗里选完、到创作页之前配置被删）。按「配置已删除」路径处理（提示 + 按默认参数继续），不崩、不静默。

### D4：交接 query 由一处纯函数构造

三个入口（改写页 / 采集页 / 热门选题页）各自拼 query 是漂移温床：键名对不上 = 用户选的配置静默丢失，且没有任何报错。`buildCreateHandoffQuery()` 收敛到 `features/publish-destination/publish-destination-config.js`。

**关键规则**：空值/非法值**不带该键**，绝不带空串。`configProfile=''` 会被创作页当成「指定了一个叫空串的配置」→ 报「配置不存在」——这是纯函数据此把「空」与「键不存在」区分开的原因。

### D5：创作页套用复用既有 `applyS2VConfigProfileSnapshot`

编排型快照的枚举归一化、失效服务商回退、分辨率按能力上限归一、语音数据重载、折叠组恢复等语义**已经实现且被测过**。本片新增第二套套用逻辑 = 双源真相 + 两处漂移。因此本片只做「取档案 + 校验 + 调用既有套用 + 提示」。

### D6：修掉「恢复上次选项」与「套用配置」的竞态

**这是本片识别出的真缺陷，不是顺手改的**：两者写同一份表单，并发时后写者胜。`restoreS2VLastOptions()` 由 `selectPipeline` 触发（不 await），本片的 `_applyConfigProfileFromRoute()` 由 `mounted` 的 `.then()` 触发——两条链并发。若恢复后到，用户刚在弹窗里挑好的配置会被「上次选项」覆盖，用户感知是「我在弹窗里选了配置，进创作页却不是那套」。

修法：`selectPipeline` 里留住恢复的 promise（`this._s2vRestorePromise`），套用配置前 `await` 它 ⇒ 恢复先写、配置后写 ⇒ **配置档案必胜**（配置是用户显式选择，优先级高于「上次用的」）。

### D7：热门选题页的断链必须一起修

热门选题页的「生成视频」去向最终只跳 `/create?draft=<id>`，流水线被丢弃。本片若不修，「配置属于哪条流水线」无从判断——配置档案按 `pipelineId` 分域，创作页拿到一个没有流水线的 query 时无法套用（会落到「未能确定流水线」分支）。因此这不是范围蔓延，是**本片功能的必要前提**。

### D8：纯函数与组件分离

「哪些流水线能选」「某条档案算不算合法」「切流水线后旧选择还算不算数」「query 键怎么拼」都是纯数据决策，抽到 `features/publish-destination/publish-destination-config.js`：

- 纯函数测试可以穷举数据校验分支（15 例），不挂组件；
- 组件测试只验交互（19 例），不重复数据校验。

### D9：交接模块的**决策**与**副作用**分离，宿主用显式依赖注入（QM-6 第 1 轮 i4 采纳）

初版把整个 CreateView 实例当宿主传进模块（`applyConfigProfileFromRoute(host)`），模块内部出现 `host.$route` / `host.showS2VOptionsToast` 这类「宿主专属」调用。后果有两个：该模块**只能**被 CreateView 用、也**测不了**（单测要造一个 Vue 实例）；决策与副作用缠在一起，失败分支没法穷举。

改为两层：

- `resolveConfigProfileTarget({ profileId, pipelineId, profiles })` —— **纯决策函数**，不碰任何 IO，返回 `skipped` / `no-pipeline` / `not-found` / `wrong-pipeline` / `apply` 之一，五个分支可被单测穷举；
- `applyConfigProfileFromRoute(deps)` —— **副作用编排**，入参是普通数据 + 普通函数（`getProfiles` / `loadProfiles` / `applySnapshot` / `setActiveProfile` / `showToast` / `awaitRestore`），模块**不认识 Vue**。

**为什么 `getProfiles` 是取函数而不是值**：载入配置库会**整体替换**宿主那份数组快照（不是原地 push），模块若在调用前抓一次快照，载入后拿到的仍是旧数组 ⇒ 配置被误判为「已删除」。取函数让它在载入**之后**重新取一次。

这条拆分的收益在第 2 轮立刻兑现：i2（`loadProfiles` 缺 `try/catch`）能被精确断言，因为「同函数内 `awaitRestore` 有 catch、唯独 `loadProfiles` 没有」在纯依赖注入下是可断言的观察点。

### D10：键盘「选中」收敛到单一入口 `commitActive()`（QM-6 第 2 轮 i1 采纳）

PRD §3.3.4 写下了「`Enter` / `Space` = 选中当前焦点项并关闭菜单」，但实现只落了方向键 / Home / End / Esc——**文档承诺了、测试也绿、唯独代码没有**（详见执行记录 learnings）。第 2 轮 critic 以 Critical 指出。

修法不是「在两个分支里各写一遍选中逻辑」，而是收敛到**一个入口** `commitActive()`：按下 `Enter` / 空格时按当前键盘焦点下标选中，菜单下标 0 = 「默认」、其后依次是各条配置（与 `options` 同序）；`activeIndex < 0`（无焦点项）时**不做任何事**——绝不凭空选中一条配置。

**为什么值得单独记一条决策**：同一个「选中」语义有三条入口（鼠标点 `li`、Enter、空格），不收敛就会出现「鼠标能选、键盘不能选」这类分裂。收敛后鼠标点击也是走 `select(id)`，与键盘共用同一份「下标 → 配置 id」映射。

### D11：「载入失败」与「配置不存在」必须是两个事实（QM-6 第 2 轮 i2 采纳）

`await d.loadProfiles()` 起初没有 `try/catch`（同函数的 `awaitRestore` 有）——失败会沿 mounted 链冒泡成**未捕获拒绝**，用户看到的是「创作页出错了」，而语义上「配置是锦上添花，不能因为它让用户做不了正事」。

修法不只是加 `try/catch`，还要**给它独立提示**：

- 不复用 `create.story2video.configProfile.loadFailed`（那是配置管理界面的「可稍后重试」语义）；
- 不复用 `create.story2video.configProfile.notFound`（那是「已被删除」语义）；
- 新增 `create.story2video.configProfile.handoffLoadFailed`：「未能载入配置列表，无法套用所选配置，已按流水线默认参数继续」。

理由：配置可能**好好地存在**、只是这次没载入成功。把「没载入成功」说成「不存在」是**误导**——用户会以为自己的配置丢了而重新建一遍。

### D12：拆分不是审美选择，是门禁的强制输出（附行数读数）

QM-6 第 3 轮 critic 质疑「两处拆分是为门禁而拆、增加了跨组件追踪成本」。这条质疑的**症状**属实，但**病因**不是「门禁逼出了坏边界」。为免下一个人重开这个话题，把**行数证据**固化在这里（都是本仓实测读数，不是估算）：

| 改动 | 拆分前 | 触发门禁 | 拆分后 | 复核读数 |
|---|---|---|---|---|
| `components/PublishDestinationModal.vue` | **527 行** | `check-max-lines` 上限 500（首跑红：`NEW_OVER_LIMIT: PublishDestinationModal.vue 527 行 >= 500`） | **304 行**（配置选择器独立成 `PublishDestinationConfigPicker.vue`） | `node .github/scripts/check-max-lines.js` → rc=0「无新增超大文件」 |
| `views/CreateView.vue` | **5379 行** | `check-debt-budget`「单文件最大行数只降不升」基线 5359（首跑红：`MAX_FILE_LINES: 5379 > baseline 5359`） | **5356 行**（交接逻辑独立成 `features/publish-destination/apply-config-profile-handoff.js`，CreateView 只留 1 个方法 + 1 行 import） | `node scripts/check-debt-budget.js` → rc=0「所有债务指标在基线内」 |

拆完之后三个边界（控件 / 弹窗侧数据变换 / 创作页侧交接）与领域边界重合，且接口按 D9 稳定为「纯决策函数 + 显式依赖注入」——该结构是第 2 轮 i1/i2 能被**精确单测定位**的前提（D9 的收益栏）。故维持现状。

## 2. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 流水线下拉选项集合扩大 ⇒ 用户可能选到不接文案的流水线 | 只放**文案型**（与创作页灰显判据同源）；素材型/录屏型/独立页/内部冒烟一律不出现 |
| 热门选题页批量改写后跳创作页带上了流水线，可能影响既有默认行为 | 弹窗里不选流水线时 `pipelineId` 为空 ⇒ query 不带 `pipeline` 键 ⇒ 创作页行为与改动前一致 |
| 选了配置但创作页套用失败 ⇒ 用户以为套上了 | 五种失败各有可见提示（已删除 / 跨流水线 / 载入失败 / 套用失败 / 无法确定流水线），且都不阻断创作 |
| 配置下拉与左侧原生 select 视觉割裂 | 自建下拉复用 `.pipeline-select` 的边框/圆角/字号；同仓先例可对照 |
| 浮窗每次打开都拉配置库 ⇒ 轻微 IO | 一次 IPC 拉全量（本地 JSON 读取），量级可忽略；换来「刚存的新配置立刻可选」 |
| 「未能确定流水线」复用 `applyFailed` 键 ⇒ 键名与文案不完全对齐 | **已消除**：初版复用 `applyFailed` 键 + `translateWithLocaleFallback` 兜底参数区分文案，现改为独立键 `pipelineUnresolved`（D11 同一原则再加 `handoffLoadFailed`） |
| 配置档案来自本地文件，渲染层不做额外授权 | **安全边界声明**：配置档案是**设备级本地数据**（`userData/story2video-config-profiles/config-profiles.json`），由**操作系统用户目录权限**保护，不跨设备、不跨信任边界（不声称云同步，见 PRD §2.2）。本片**渲染层不新增任何授权检查**——那会与既有 `ConfigProfileManager` 形成两套授权口径。桌面端单机场景下，用户目录权限即边界 |
| 每次交互都重建配置列表（过滤 + 排序） | 配置文件是**单个本地 JSON**，一次 IPC 全量读取（不是每条一次 IPC）；过滤是 O(n)、排序 O(n log n)，n = 该流水线的配置条数。**本片不设条数上限**——配置档案由用户自建，无产品级上限（不编造「≤50」这类未验证数字）；实测场景 n 为个位数到几十，渲染开销可忽略。若将来 n 增长到需要缓存的量级，届时再加（届时以实测读数为依据，不预先设计） |

## 3. 不做

见 proposal 的「What Changes」与 PRD §2.2。特别强调：**不改**主进程配置档案服务与四个 IPC 通道——本片只消费既有契约。

## 4. 验证映射

| 规格条目 | 自动化锁 |
|---|---|
| 流水线选项覆盖文案型全集 | `components/PublishDestinationModal.test.js`「流水线默认列出全部文案型流水线」 |
| 无配置显示「默认」+ 下拉为空 | 同文件「该流水线没有配置时：显示「默认」、下拉内容为空、并说明原因」 |
| 加载失败不伪装 | 同文件「配置列表加载失败时如实提示」 |
| 切流水线清空旧选择 | 同文件「切换流水线后配置列表联动，且原先选中的配置作废」 |
| 提交携带配置档案 | 同文件「选了配置后，提交时把配置档案一起带出去」 |
| query 键名单一真源 | `features/publish-destination/publish-destination-config.test.js`「buildCreateHandoffQuery」组 |
| 创作页自动套用 / 三种拒绝 | `views/CreateView.config-profile-handoff.test.js` 4 例 |
| 交接决策五分支可穷举 | `features/publish-destination/apply-config-profile-handoff.test.js`「resolveConfigProfileTarget」组 |
| 交接失败一律「返回 false + 可见提示」，不抛异常 | 同文件「载入配置库失败 ⇒ 不抛异常、提示 handoffLoadFailed、不套用」 |
| 键盘可达（契约表每一行都有锁） | `components/PublishDestinationModal.test.js`：↓ 展开并落焦、↑/↓/End/Esc 移动与关闭、**Enter 选中**、**空格选中**、**Home+空格选中「默认」** |
| 「载入失败」不伪装成「配置不存在」 | `locales/create/{zh,en}.js` 各有独立键 `handoffLoadFailed`；`check-locale-sync --keys` 保证成对 |
