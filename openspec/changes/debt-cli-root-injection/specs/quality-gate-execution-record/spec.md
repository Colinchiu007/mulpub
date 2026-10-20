## ADDED Requirements

### Requirement: 账本判据 CLI 的取证根必须可注入，且注入必须对全部取源生效

`scripts/check-gate-record-debt.js` 的 `main()` MUST 接受 `--root=<路径>` 作为取证根。**未给出该旗标时，取证根 MUST 逐字保持既有形态**（`path.resolve(__dirname, '..')`），即默认路径下 CI 与本机行为零变化——本 Requirement 改变的是"能不能测它"，不是"它测什么"。

给出该旗标时，**所有**读生产仓库的取源 MUST 一并切到该根：账本（`loadLedger`）、旧载体冻结基线（`loadCarrierFreeze`）、合并账本的 git 取证目录（`buildLedger`）、人工改写差量的 git 取证目录（`buildClosureDiff`）。MUST NOT 出现"载体读夹具、冻结基线或 git 证据读真仓"的混合态——那比没有这个旗标更坏，因为它会产出一条**看起来由夹具支撑、实际掺了真仓事实**的结论。

`--root` MUST NOT 接受裸旗标（无 `=<值>`）或未知拼写：这类输入 MUST 抛错并走"判据自身故障"档，MUST NOT 静默回落默认根。指向不存在或非法内容的根 MUST fail closed 并出声（把"路径打错了"读成"扫过了且没问题"是本仓反复记录的静默放行形态）。

「未收口欠账 ⇒ 非零退出」这条出口 MUST 同时具备两道锁且不得互相替代：一道**结构锁**（映射仍在 `main()` 体内、且剥掉块注释与整行注释后才参与匹配）与一道**行为锁**（用夹具根真跑 CLI 并断言退出码）。

#### Scenario: 不注入时取证根与改前逐字相同

- **WHEN** 不带 `--root` 运行该 CLI
- **THEN** 取证根 MUST 仍为仓库根（`__dirname` 的上一级），MUST NOT 改用 `process.cwd()` 或环境变量推断
- **AND** 同一份真仓状态下，改前与改后的退出码与首行读数 MUST 相同（默认路径的零影响要有对照证据，不是靠"我看代码没动那行"）

#### Scenario: 注入的根对全部取源生效

- **WHEN** 带 `--root=<夹具>` 运行，且夹具里只有账本被写成非法形状（非字符串登记项）
- **THEN** CLI MUST 按**夹具那份**账本判并出声点名键
- **AND** 真仓账本 MUST NOT 参与该次判定——若真仓账本合法而结论报"合法"，即为混合态，MUST 判为实现缺陷

#### Scenario: 旧载体冻结基线不得留在真仓

- **WHEN** 注入根下缺少 `scripts/gate-carrier-freeze.json`
- **THEN** CLI MUST 抛"冻结基线缺失"并走自身故障档（读不到基线 ≠ 没有漂移）
- **AND** 该抛错路径 MUST NOT 被当成"阻断生效"的证据：行为锁 MUST 区分"因异常退出"与"因未收口欠账退出"，两者退出码可能同为 1

#### Scenario: 裸旗标与未知拼写不得静默生效

- **WHEN** 命令行出现 `--root`（无 `=`）或 `--roots=<路径>`
- **THEN** `parseFlags` MUST 抛错，MUST NOT 回落默认根
- **AND** 该抛写进既有旗标白名单机制（同一函数已为 `--carrier-mode` 立过"拼错被静默忽略"的教训）

#### Scenario: 结构锁与行为锁并列存在

- **WHEN** 摘掉 `main()` 里 `hasBlocking ⇒ process.exit(1)` 的映射
- **THEN** 结构锁与行为锁 MUST **都**变红，且红的是各自那条用例
- **AND** 只有一道变红即视为覆盖不足：结构锁测"映射在不在"，行为锁测"真造出阻断时真会拦"，二者不可互替
