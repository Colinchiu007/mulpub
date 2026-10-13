# Delta Spec: risk-hold-guard

> 能力来源：本次 change 新建。既有实现散落在 `api-publish-engine` 的 W1 §5 切片与桌面 enforcement 切片，
> 但**从没有一份规格**把「什么信号可以挂起、挂到什么粒度、界面凭什么展示」写成可验收的契约 ——
> 本次误判正是这个缺口的下游后果。

## ADDED Requirements

### Requirement: 风控判定必须结构化优先

风控判定 SHALL 按固定顺序取值：**① 调用方显式 `risk_blocked` 标志 → ② 平台风控码族 → ③ 错误文本词表**。前两级命中时，错误文本 MUST NOT 参与判定（不得因文案措辞差异推翻已确定的结构化结论）。

判定结果 SHALL 为四字段对象 `{hit, strength, signal, suspends}`；`signal` SHALL 取自封闭词表记号（`flag` / `code:<码>` / `strong:<词>` / `weak:<词>`），MUST NOT 是原始错误全文。

#### Scenario: 文本无害但结构化标志命中

- **WHEN** 发布结果的错误文本是「网络超时」但适配器已置 `risk_blocked: true`
- **THEN** 判定为 `{hit:true, strength:'strong', signal:'flag', suspends:true}`，文本不参与

#### Scenario: 平台风控码族命中

- **WHEN** 结果携带 `code` 为 `BILI_RISK_601` / `601` / `10000015` / `-1e7` / `RISK_BLOCKED` 之一
- **THEN** 判定为 `strength:'strong'` 且 `suspends:true`，`signal` 形如 `code:<码>`

#### Scenario: 非风控码不构成信号

- **WHEN** 结果携带 `code: 500` 且错误文本为「服务异常请稍后重试」
- **THEN** 判定为 `hit:false`、`suspends:false`

### Requirement: 文本词表必须加边界并分强弱

文本兜底词表 SHALL 分两档：**强信号**（平台风控专属措辞，允许挂起）与**弱信号**（宽泛词，只提示不挂起）。数字记号 SHALL 使用数字边界 `(?<!\d)…(?!\d)`；英文记号 SHALL 使用标识符边界 `(?<![A-Za-z0-9])…(?![A-Za-z0-9])`（下划线算边界，故 `BILI_RISK_601` 可命中，而 `derisk` / `infrequent` / `verified` 不命中）。

**强信号** SHALL 至少覆盖：`风控`、`滑块`、`安全验证`、`验证弹层`、`操作频繁`、`captcha`、`canvas illegal`、`账号存在风险`、`risk control`、`risk_blocked`、`riskBlocked`、`RISK_BLOCKED`、`BILI_RISK`、`验证失败(110)`、`10000015`（带数字边界）。

**弱信号** SHALL 至少覆盖：`验证`、`频繁`、`risk`、`frequent`、`verify`、`601`（后四者带边界）。

判定 MUST 排除自身守卫标记 `risk_suspended`（自触发防线）。

#### Scenario: 误判面回归（修复前会挂起、修复后不得挂起）

- **WHEN** 错误文本为以下任一：`Request failed with status code 601`、`publish id 6019 not found`、`gateway timeout ts=1601846521`、`errno 100000159: bad request`、`infrequent login detected`、`low-risk content flagged`、`身份验证失败`
- **THEN** `suspends === false`（其中 A2–A5 连 `hit` 都为 false，A1/A6/A7 为 `weak`）

#### Scenario: 真风控召回不回归

- **WHEN** 错误文本为抖音 `抖音触发安全验证…` / `抖音验证失败(110)…`、B站 `B站风控(601)…`、快手 `快手返回验证页…疑似风控拦截…`、百家号 `百家号风控拦截…`、小红书 `检测到风控/验证弹层，已停止`、`canvas illegal`、`账号存在风险` 之一
- **THEN** `strength === 'strong'` 且 `suspends === true`

### Requirement: suspends 不变量由单一真源给出

`risk-signals` SHALL 导出不变量 `suspends ⇔ (hit && strength === 'strong')`。所有消费方（桌面 `phase4-events`、引擎 `publish-mode-runner`）MUST 读取 `suspends` 决定是否挂起，**MUST NOT** 自行由 `hit` 或词表推导。

#### Scenario: 弱信号永不挂起

- **WHEN** 任意判定结果的 `strength === 'weak'`
- **THEN** 其 `suspends` 恒为 `false`

### Requirement: 词表为单一真源，禁止双份漂移

风控词表与判定逻辑 SHALL 只存在于 `packages/api-publish-engine/src/publish/core/risk-signals.js`。桌面 `apps/desktop/electron/services/publish-risk.js` SHALL 复用该模块（可保留兼容签名），MUST NOT 再维护第二份词表。需要「像不像风控」的并集判据 SHALL 使用 `isRiskText` / `RISK_ANY_RE`，与「是否允许挂起」区分开。

#### Scenario: 两侧同一函数引用

- **WHEN** 桌面侧导入 `classifyRisk`
- **THEN** 它与引擎 `risk-signals` 导出的 `classifyRisk` 是同一个函数引用（不是复制实现）

#### Scenario: 路由与挂起是两件事

- **WHEN** 错误文本仅命中弱信号（如 `抖音安全 verify 拦截`）
- **THEN** 路由判据 `isRiskText` 为 `true`（API 轨命中仍停报不降级），而 `suspends` 为 `false`（不挂起账号）

### Requirement: 挂起粒度与账号解析

挂起决策 SHALL 遵循：**强信号 + 有账号 ⇒ 账号级**；**强信号 + 无账号 ⇒ 平台级**（覆盖该平台所有账号）；**弱信号或未命中 ⇒ 不挂起（任意账号维度）**。

账号解析 SHALL 优先 `task.article.accountId`，其次任务级归一字段 `task.accountId`，两者皆空才是 `null`。

#### Scenario: 弱信号 + 无账号不降级平台级

- **WHEN** 任务无任何账号字段，错误文本为「请先完成实名验证」（弱信号）
- **THEN** 零挂起、零 `publish:risk-suspended` 广播、零 `publish:risk-hold` IPC

#### Scenario: 强信号 + 无账号仍平台级

- **WHEN** 任务无任何账号字段，错误文本为「账号存在风险，请前往创作者中心发布作品」
- **THEN** 挂起键为 `platform::*`（覆盖全平台）

#### Scenario: 任务级账号兜底避免误升平台级

- **WHEN** `task.article` 无 `accountId` 但 `task.accountId` 为 `acc-task`，文本为强信号
- **THEN** 挂起键为 `platform::acc-task`（账号级），不是平台级

### Requirement: 结构化风控信号必须跨传输层保全

发布链计算出的 `code` 与 `risk_blocked` 标志 SHALL 随错误一路传到风控判定点：引擎 `publishViaApi` 与桌面三个发布器抛错时 SHALL 把 `code`/`riskBlocked`/`loginExpired` 挂到 `Error` 上；`task-queue` 捕获时 SHALL 落到 `task.errorCode` / `task.riskBlocked`（`errorCode` 缺省为 `null`，`riskBlocked` 缺省为 `false`，MUST NOT 留 `undefined`）。`risk_blocked` 下划线形态 SHALL 同样被识别。

#### Scenario: 结构化信号到达判定点

- **WHEN** 执行器抛出的 `Error` 携带 `code='BILI_RISK_601'` 与 `riskBlocked=true`
- **THEN** `task:failed` 的 task 上 `errorCode === 'BILI_RISK_601'` 且 `riskBlocked === true`，后续判定走结构化优先路径

### Requirement: 挂起记录携带可展示的判定依据

挂起记录 SHALL 在 `{platform, accountId, reason, at}` 之外可选携带 `signal`（非空字符串，SHALL 截断至 ≤64 字符）与 `strength`（SHALL 仅接受 `'strong'` / `'weak'`，其它值 MUST NOT 写入）。记录 MUST NOT 携带原始错误全文。

`signal`/`strength` SHALL 在持久化、水合与渲染层归一三处均不丢失。升级前无这两个字段的旧记录 SHALL 保持缺失（UI 据此不渲染依据项，MUST NOT 猜测或兜底成强档）。

#### Scenario: 重启后依据不丢

- **WHEN** 以 `{signal:'strong:风控', strength:'strong'}` 挂起后，用新实例重新水合同一 store
- **THEN** 恢复出的记录仍含 `signal:'strong:风控'` 与 `strength:'strong'`

#### Scenario: 非法 strength 不落库

- **WHEN** 以 `strength:'bogus'` 调用 `suspend`
- **THEN** 记录中不含 `strength` 字段（渲染层据此不显示依据）

#### Scenario: 旧记录不伪造依据

- **WHEN** store 中是升级前的 `{platform, accountId, reason, at}`
- **THEN** 水合后 `signal`/`strength` 为 `undefined`，横幅不渲染判定依据项

### Requirement: 风控横幅的显示项与粒度表达

账号页风控横幅 SHALL 逐条展示：平台名、**粒度标签**（`accountId == null` ⇒ 「全平台账号」，否则显示账号）、**检测时间**（`at` 合法时按本地 `HH:mm`）、**判定依据**（`strength` 存在时显示 strong/weak 对应文案，缺失时不渲染该显示项）、恢复按钮。

标题 SHALL 分流：清单**全部**为平台级挂起时用 `publish.riskHold.suspendedAllAccounts`，否则用 `publish.riskHold.suspended`。清单为空时 SHALL 整块不渲染。

恢复 SHALL 经人工确认（`confirm` 缺省拒绝），MUST NOT 存在自动恢复/自动换号路径。

#### Scenario: 平台级与账号级可区分

- **WHEN** 挂起清单含一条 `accountId == null` 与一条 `accountId == 'acc-1'` 的记录
- **THEN** 前者渲染「全平台账号」粒度标签（title 为 `guidanceAllAccounts`），后者渲染账号名；标题用通用文案

#### Scenario: 时间与依据缺省时不渲染

- **WHEN** 记录 `at` 非法或缺失、且无 `strength`
- **THEN** 时间与判定依据两个显示项都不渲染（不得出现 `Invalid Date` 或猜测的结论）

#### Scenario: 恢复必须人工确认

- **WHEN** 用户点击「恢复发布」但在确认框中取消
- **THEN** 返回 `{ok:false, reason:'cancelled'}`，挂起态不变、无任何 IPC 调用
