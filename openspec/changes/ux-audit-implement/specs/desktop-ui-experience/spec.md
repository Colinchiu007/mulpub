# desktop-ui-experience

## ADDED Requirements

### Requirement: 破坏性写入口必须经确认动作

系统 MUST 保证：渲染端任何调用破坏性 API（名称由 `apps/desktop/src/api/**` 的导出按动词后缀 `Delete|Clear|Remove|Revoke|Erase|Destroy|Purge` 动态派生）的函数，其**函数作用域内**存在确认动作；未成立的调用点 MUST 在 `scripts/danger-confirm-debt.json` 带 `reason` 登记，A 档（该文件看不到任何确认动作）还 MUST 带 `confirmed_by` 指明确认落点或"该操作可重做故不锁"的理由。登记清单只能缩小。

`scripts/check-danger-confirm.js` MUST 只依赖 node 内置模块（该判据接进无依赖安装的 CI 作业），并区分退出码 `0` 合规 / `1` 违规或陈旧登记 / `2` 判据自身故障。

#### Scenario: 未确认时底层删除 API 调用次数为 0

- **WHEN** 用户触发删除但取消确认（点取消、按 ESC 或点遮罩）
- **THEN** 底层 API MUST NOT 被调用，且入口返回"未执行"
- **AND** 不得先删再回滚、也不得因取消而弹错误提示

#### Scenario: 确认写在别的函数里不算成立

- **WHEN** 某函数调用 `draftDelete(...)`，同文件的**另一个**函数里有确认动作
- **THEN** 判据 MUST 报该调用点（A 或 B 档），MUST NOT 因"同文件出现过确认"而放行

#### Scenario: 同名定义点与文本出现不得当成调用

- **WHEN** 源码里存在与破坏性 API 同名的局部函数定义，或该名字出现在注释/正则字面量中
- **THEN** 判据 MUST NOT 计入调用点

#### Scenario: 豁免清单退化即红

- **WHEN** 某登记项对应的调用点已消失，或某 A 档登记缺少 `confirmed_by`
- **THEN** 门禁 MUST 以 rc=1 失败并点名该键

### Requirement: 不可逆操作的确认文案必须点名对象并披露后果

所有面向用户的破坏性确认文案 MUST 满足：来自 locales 且 zh/en 成对；点明被操作对象（标题/任务名/文件数与体积等）；明确说明是否可恢复。MUST NOT 使用"确定吗"这类无后果披露文案，MUST NOT 在视图内拼中文字面量。

#### Scenario: 删除发布草稿点名被删草稿

- **WHEN** 用户在发布页删除一条草稿
- **THEN** 确认文案 MUST 含该草稿标题（无标题时以"（无标题）"占位，MUST NOT 出现 `undefined`）
- **AND** MUST 说明"不入回收站、删除后不可恢复"

#### Scenario: 同一概念的后果披露口径一致

- **WHEN** 单账号删除与批量删除同属不可逆操作
- **THEN** 两处文案 MUST 都披露"不可恢复"，MUST NOT 只有批量侧披露

### Requirement: 模态原语的安全默认值与关闭语义

`UiModal` MUST 默认 `trapFocus=true`、`closeOnEsc=true`、`closeOnOverlay=true`（默认值不得低于其替换的 Element Plus 对话框）。`progress` 变体 MUST 继续豁免焦点抢占与全局键盘监听（modeless 观察窗）。绑在关闭路径上的 MUST NOT 是破坏性动作。

#### Scenario: 不传参时焦点与 Esc 行为成立

- **WHEN** 调用方未显式传 `trap-focus` / `close-on-esc`
- **THEN** Tab 循环 MUST 留在弹窗内，Esc MUST 触发 `close`

#### Scenario: 破坏性动作不得绑在关闭路径

- **WHEN** 一个 `UiModal` 的模板块内含删除/清空/撤销类处理器
- **THEN** 其 `@close` 表达式 MUST NOT 调用该破坏动作；承载点清单 MUST 只能缩小

### Requirement: 未保存内容在两条出口都不得静默丢失

未在 keep-alive include 内的编辑态视图 MUST 提供离开拦截：路由切换时经统一确认原语询问，关闭窗口/刷新时经 `beforeunload` 提示。守卫的脏判据 MUST 是内容级（恒真或恒假都不成立），且 `isDirty` 非函数时 MUST 抛错而非静默不拦。

覆盖面 MUST 由扫描得出而非人工清单：`src/unsaved-leave-contract.test.js` MUST 枚举含正文输入（`<textarea v-model>`）的视图，每个视图 MUST 满足"保活 / 已挂守卫 / 带实测理由的欠账"三者之一，欠账 MUST NOT 增长。

#### Scenario: 有脏数据时导航被拦

- **WHEN** 改写页有内容且尚未保存草稿，用户切换路由
- **THEN** 守卫 MUST 弹确认；用户拒绝时 MUST 留在原页

#### Scenario: 已落真源后不再打扰

- **WHEN** 内容已保存为草稿（`savedDraftId` 有值）且其后未再变化
- **THEN** 导航 MUST 直接放行，不弹确认

#### Scenario: 已被保活的页面不挂守卫

- **WHEN** 某视图在 `App.vue` 的 `keep-alive :include` 内
- **THEN** 判据 MUST 认定其无需拦截，MUST NOT 因"顺手加一层"而新增拦截

### Requirement: 导航只有一份实现

侧边栏点击与全局快捷键导航 MUST 共用 `useHomeShellNavigation`（三段式：内嵌主页实例定向 → 切回首页标签 → 主窗口 `router.push`）。MUST NOT 存在第二份实现，MUST NOT 在快捷键落点使用裸 `router.push`。

#### Scenario: 停在网页标签时键盘导航可见

- **WHEN** 用户聚焦普通网页标签并按下导航类全局快捷键
- **THEN** 系统 MUST 先切回首页标签再改路由，使用户看得见结果

#### Scenario: 定向失败只停那一步

- **WHEN** 内嵌实例定向 IPC 失败、未接管或抛错
- **THEN** MUST 继续走后续两段并留痕，MUST NOT 升级成整次导航失败

### Requirement: 已注册但无消费者的组件与字段属缺陷

系统 MUST NOT 长期保留"已实现但无人渲染/无人读取"的前端产物。任何被 store 写入的状态字段 MUST 至少有一个读取方；任何 `src/components/*.vue` 的导出组件 MUST 有模板消费者或在登记表中说明去向（该门禁由阶段 5.3/5.4 补齐，本批先落 `lastEventAt` 的读取方）。

#### Scenario: 观测字段必须被消费

- **WHEN** store 写入 `lastEventAt`
- **THEN** MUST 有判据读取它并产生用户可见结论（停滞提示 + 关闭按钮解禁）
- **AND** 取不到事件锚点时 MUST 沉默，MUST NOT 谎报停滞

### Requirement: 网络与进度观测通道必须双向

离线能力 MUST 同时具备"进入离线"与"恢复在线"两个方向的渲染层可见通道，且 MUST NOT 依赖渲染层轮询来弥补方向缺失。任何网络恢复后的计数 MUST 回真源取值，MUST NOT 凭猜测清零。监听器 MUST 成对释放。

#### Scenario: 断网即时可见

- **WHEN** 应用运行中途网络丢失
- **THEN** 横幅 MUST 出现（主进程推送或 `window` 事件任一通道成立即可），MUST NOT 等到下一次请求失败才暴露

#### Scenario: 主窗口不可发送时不影响状态机

- **WHEN** 通知时拿不到可用窗口或 `send` 抛错
- **THEN** 网络监测本身 MUST 照常工作，MUST NOT 冒泡异常

### Requirement: 未知路由必须有可行动的兜底

路由表 MUST 含 catch-all，MUST 渲染可行动错误页（回首页 / 返回上一页），并 MUST 回显用户尝试访问的 path。MUST NOT 回显 query。已登记路由 MUST NOT 被 catch-all 抢占。

#### Scenario: 打错地址不再是一片空白

- **WHEN** 用户访问未登记路径
- **THEN** `router.resolve` MUST 给出 `NotFound` 且视图 MUST 呈现出口与说明

### Requirement: 宿主具名引用必须在单元测试阶段可验

对宿主库（图标包等）的具名 import MUST 能被单元测试用**真实模块**核对存在性，MUST NOT 只在打包阶段暴露。用于 mock 宿主的测试夹具 MUST 不掩盖名字不存在这一事实（存在性锁 MUST 使用未 mock 的真模块）。

#### Scenario: 写错图标名在测试阶段变红

- **WHEN** 某视图 import 了宿主图标包中不存在的名字
- **THEN** 存在性锁 MUST 变红并点名文件与符号

### Requirement: 首运引导只有一个真源且完成标记只由用户动作写入

引导完成状态 MUST 由单一存储持有（`userData/first-run-done`）。启动流程 MUST NOT 写该标记；
MUST 只有「用户退出或跳过引导」这一动作能写。任何第二条表达同一语义的通道
（第二个标记文件、第二个 IPC 面、推送与拉取并存的双真相）MUST 被移除而非并存。

#### Scenario: 全新用户首次启动进入向导

- **WHEN** `first-run:check` 成功返回 `setupDone === false` 且当前不在 `/first-run`
- **THEN** App 挂载后 MUST `router.replace('/first-run')`

#### Scenario: 没有证据时不得把用户推进向导

- **WHEN** 桥接缺席、IPC 抛错、响应 `code !== 0`、`data` 缺失或 `setupDone` 字段不是布尔 `false`
- **THEN** MUST 保持当前路由不动，且 MUST NOT 写入完成标记

#### Scenario: 写盘失败不得伪装成用户已确认

- **WHEN** `first-run:complete` 的落盘动作失败或桥接不可用
- **THEN** IPC MUST 返回非 0 码，渲染层 MUST 出声提示，同时仍放行导航

#### Scenario: 第二个引导真源回归即红

- **WHEN** `first-run.js` 重新导出 `runSetup`，或导出面出现 `{checkDeps,isSetupDone,markDone,reset}` 之外的成员
- **THEN** `electron/services/first-run.test.js` MUST 变红

### Requirement: 全局注册组件必须被模板消费，两份注册清单必须同源

`app.component(...)` 注册的每个组件 MUST 在至少一个 `.vue` 模板中被使用。
运行时清单（`main.js`）与单测镜像清单（`test-setup.js`）MUST 逐字相同，
且该一致性 MUST 由机械锁核对（镜像注释不构成证据）。

#### Scenario: 零消费的全局注册变红

- **WHEN** 某个全局注册组件在全仓 `.vue` 模板中零消费
- **THEN** `src/global-components-contract.test.js` MUST 变红并点名该组件

#### Scenario: 清单漂移变红

- **WHEN** `main.js` 与 `test-setup.js` 的注册集合不一致
- **THEN** 同一把锁 MUST 变红，MUST NOT 靠"两边各自都绿"放行

#### Scenario: 扫描域退化不得读成通过

- **WHEN** 解析器取到 0 个注册项或 `.vue` 扫描域为空
- **THEN** 锁 MUST 变红（反失明断言），MUST NOT 因"没有注册 ⇒ 没有违规"而绿

### Requirement: 已建成的反馈与权益组件必须挂载或移除

反馈、权益、公告这类**已实现且自带测试**的组件 MUST NOT 长期处于"存在但无人渲染"状态。
处置只有两种：接入真实消费路径，或连同其测试一并删除。MUST NOT 以"留着以后用"并存死码。

#### Scenario: 试用横幅在会员中心可见且按钮有动作

- **WHEN** 已登录用户的服务端权益不是 `pro`
- **THEN** `.trial-banner` MUST 渲染；点「立即购买」MUST 打开 `UpgradeModal`；点「✕」MUST 只影响横幅本身

#### Scenario: 权益未就位不得把付费用户判成免费版

- **WHEN** `entitlement.plan === 'pro'` 而本地 `licenseStore.info.isPro` 仍为默认 `false`
- **THEN** MUST NOT 渲染免费版横幅

#### Scenario: 全局注册但零消费的原语被删除而非留着

- **WHEN** 某原语（如 `LoadingState`）在全仓模板零消费
- **THEN** MUST 删除其组件、测试与两处注册，并由墓碑断言防止原形态回归

### Requirement: 帮助与支持页的每条指引必须有可达落点

用户可见的"去看文档/联系客服"类文案 MUST 指向确实存在的落点。本仓不存在文档站地址，
因此帮助页 MUST 只指向应用内入口（设置弹窗的具体 Tab、账号页、日志真源），
MUST NOT 写入未经取证的 URL。外链需求出现时 MUST 复用既有受控通道
（`window.open → setWindowOpenHandler → isAllowedExternalUrl`），MUST NOT 新写第二份协议判据。

#### Scenario: 每个入口点击都产生真实动作

- **WHEN** 用户点击帮助页任一入口按钮
- **THEN** MUST 分别触发 `requestSettingsDialog('general'|'model')` 与 `router.push('/accounts')`，
  测试 MUST 断言到具体调用而非"按钮存在"

#### Scenario: 日志读取失败不得显示为没有日志

- **WHEN** `logs:info` 返回非成功码或抛错
- **THEN** MUST 进入 `role="alert"` 的失败态并提供重试；MUST NOT 渲染「0 个日志文件」

#### Scenario: 复制失败不得谎称成功

- **WHEN** `writeClipboard` 返回 `false` 或抛错
- **THEN** MUST 报失败提示且 MUST NOT 报「已复制」；目录为空时复制按钮 MUST 禁用

