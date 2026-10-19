# desktop-ui-wired-gates — Spec Delta

## ADDED Requirements

### Requirement: 声明 props 却零引用的组件必须被机械检出

系统 SHALL 提供 `scripts/check-ui-wired.js`：扫描 `apps/desktop/src` 下全部 `.vue`，
对**声明了 props**（`defineProps(...)` / `defineProps<...>()` / `props: {}` / `props: []` 四种写法）
且在**生产代码面零引用**的组件判红。引用识别 MUST 满足两条：

1. 搜索前 MUST 剥掉整行注释（`//`、`<!-- -->`、块注释续行 `*`），
   否则「文档里提到该组件」会被读成「代码里在使用它」；
2. 消费者集合 MUST 排除测试面（`*.test.js` / `*.spec.*` / `tests/**`），
   否则每个组件都被自己的用例"引用"，判据恒不成立。

欠账清单 `scripts/ui-wired-debt.json` MUST 逐条带 `reason`，且**只能缩小**；
命中数与登记数 MUST 相等（多命中 = 新死组件，少命中 = 陈旧登记）。

#### Scenario: 注释里提到组件不算被使用
- **WHEN** 仓库里某组件的唯一文本命中是另一文件的整行注释
- **THEN** 判据输出 `UNWIRED <该组件>`，退出码 1

#### Scenario: 组件被自己的用例挂载不算接线
- **WHEN** 某组件仅被同名的 `*.test.js` import 并挂载
- **THEN** 判据仍输出 `UNWIRED <该组件>`

#### Scenario: 真实使用不得被判死
- **WHEN** 某组件在生产 `.vue` 模板里以 `<Foo />` 或 `<foo-bar />` 出现
- **THEN** 判据不输出该组件

#### Scenario: 清空欠账清单不构成免检
- **WHEN** `ui-wired-debt.json` 被改成 `{}`
- **THEN** 退出码 1，且逐个点名每一条本该登记的决定

### Requirement: 有写无读的 store 字段必须被机械检出

系统 SHALL 提供 `scripts/check-field-consumed.js`：扫描 `apps/desktop/src/stores`，
对 `ref()` / `shallowRef()` 声明且**存在赋值左值写入**、但**读次数与跨文件消费数均为 0** 的字段判红。
口径 MUST 满足：

1. store 自身的 `return { X }` 清单行 MUST NOT 计为消费（暴露 ≠ 消费）；
2. `X.value` 后紧跟赋值 / `++` / `--` 的 MUST NOT 计为读；
3. 其它生产文件里出现裸 `X`（含 `{ X: alias } = storeToRefs(store)` 这类带冒号的解构）MUST 计为消费，
   判据 MUST NOT 使用 `(?!\s*:)` 型排除（该形态在本仓造成过一次假阳性，须回归锁化）；
4. 测试面 MUST NOT 计为消费。

#### Scenario: 重命名解构算消费
- **WHEN** 某字段仅被 `const { currentBoard: board } = storeToRefs(store)` 取用
- **THEN** 该字段 MUST NOT 被判死字段

#### Scenario: 只写不读算死字段
- **WHEN** 某字段有 `X.value = ...` 写入，且全仓生产面（含本文件读位置）无一次读取
- **THEN** 输出 `DEAD_FIELD <store>#<字段>`，退出码 1

### Requirement: 两条判据必须打印自身覆盖面，且必须接在 fail-fast 的位置

两条判据 MUST 每次都打印 `域=… / 候选=… / 命中=… / 登记=…` 现场读数；
扫描域为空、store 文件数为 0、扫描根缺失、文件读不到时 MUST 以退出码 2（判据自身故障）
与「发现违规」的 1 分档 —— 把工具的失明读成通过是本仓「装饰性门禁」的同型。
两者本体与自测 MUST 接在 `quality-gate.yml` 中整体为 `shell: bash` 的步骤（Gate 2b），
MUST NOT 接在多条命令共享一个 `$LASTEXITCODE` 的 pwsh 步骤里。

#### Scenario: 规模退化即判探针失明
- **WHEN** 真实仓扫描得到的文件数 / 组件数 / 候选 ref 数退化到个位数
- **THEN** 自测判红（下界断言），而不是把「零候选」读成「零违规」

#### Scenario: 未知旗标不得静默放宽
- **WHEN** 调用时传入未识别的旗标
- **THEN** 判据仍按真实域执行并给出结论，不得因未知旗标跳过检查
