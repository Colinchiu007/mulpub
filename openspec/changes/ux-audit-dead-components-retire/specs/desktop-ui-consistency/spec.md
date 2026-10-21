# desktop-ui-consistency — 已退役组件不得复活（UX 审计 1.3）

## ADDED Requirements

### Requirement: 组件必须被真实渲染，否则删除；不得长期"存在但无人渲染"

`src/components/*.vue` 里存在但**没有任何生产渲染方**的组件是负债：它占打包体积与全局注册表、
被测试自己 mount 而显得"有覆盖"、并在审计里持续占用一条未接线项。
系统 MUST 要么把它接到用户可达的位置，要么删除；MUST NOT 保留"文件在、测试绿、用户永不可见"的中间态。

#### Scenario: 全局注册但零模板用法

- **WHEN** 某组件在 `main.js` 被 `app.component(...)` 注册，而全仓 `<Xxx>` 模板用法为 0
- **THEN** 该组件 MUST 被删除（连带其注册与测试），MUST NOT 靠"以后会用到"保留

#### Scenario: 只有测试自己 mount 它

- **WHEN** 一个组件的全部引用都是测试文件里 `mount(Itself)`
- **THEN** 判据 MUST 按"有没有生产渲染方"计，MUST NOT 因为"它有测试"而算作已接线

### Requirement: 已退役组件的"防复活"判据必须按代码行与语义切

删除之后 MUST 有一把锁防止它被悄悄加回，且这把锁 MUST NOT 把下面两类误判成违规：
解释"为什么删"的**注释**，以及**断言该组件不存在**的反向守卫（它们必然提到那个名字）。

#### Scenario: 注释与反向守卫不得被判红

- **WHEN** 退役组件的名字只出现在注释行，或出现在 `views/Dashboard.style-guard.test.js`
  / `views/Dashboard.test.js` 这类做缺席断言的文件里
- **THEN** 锁 MUST 通过；判据 MUST 先剥行注释再匹配，并对豁免文件**验证它确实还在做缺席断言**

#### Scenario: 重新接线必须点名

- **WHEN** 任何其它文件的**代码行**重新出现 `TrialBanner` 或 `LoadingState`（import、模板、`app.component`）
- **THEN** 锁 MUST 变红并点名该文件

#### Scenario: 扫描域退化成空集合时不得报通过

- **WHEN** 扫描根解析退化（路径错、目录不存在）导致一个文件都没读到
- **THEN** 锁 MUST 变红（MUST NOT 把"零命中"读成"零引用"）

### Requirement: 「注册表」的验证域必须覆盖 src 之外的镜像注册点

同一份全局组件表在本仓存在**两个**写者：`src/main.js`（运行态）与 `apps/desktop/test-setup.js`（测试态镜像）。
判断"某组件是否还有人用"时，MUST 同时检查两者；MUST NOT 把扫描域钉在 `src/` 里。

#### Scenario: 只 grep src 就删组件

- **WHEN** 依据"`src/` 下零引用"删除组件，而 `test-setup.js` 仍 import 它
- **THEN** 整套测试 MUST 以可归因的红暴露这件事（实测症状：`Failed to resolve import … Does the file exist?`
  且报在**与删除无关的**测试文件上），且本要求 MUST 有一条直接锁住 `test-setup.js` 不再提到该组件
