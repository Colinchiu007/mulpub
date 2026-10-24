## ADDED Requirements

### Requirement: 评审入口不得向调用者承诺它做不到的事

`scripts/deep-review.sh` 的 `--force` SHALL NOT 产生"已按要求强制审查"的任何可读信号。当判定记录的 `mode` 为 `skip` 且调用者带 `--force` 时，入口 MUST 在把控制权交给驱动之前早退，退出码取既有的「环境或配置问题」档（`2`），且输出 MUST 同时说出三件事：该旗标在验证层不可能生效的原因（驱动自己从判定记录读 `mode`）、继续运行会对那份判定产物造成的后果、以及当前**确实可用**的替代路径。

判据 MUST 取入口自身的可观测产物（退出码、输出文案、驱动是否被 exec、判定记录字节是否变动），SHALL NOT 引用仓外引擎源码的行号或字符串——引擎随技能升级漂移，行号判据会退化成装饰。

#### Scenario: skip 记录 + `--force` ⇒ 拒绝且不触达驱动

- **WHEN** `.ccg/reviews/<head>.json` 的 `mode` 为 `skip`，执行 `sh scripts/deep-review.sh --force`
- **THEN** 退出码为 `2`
- **AND** 输出点名「不会强制」这一固定判据串（实现与测试共用同一字面量，不得各写一份"同族词"）；不得只依赖退出码判定——夹具里后端桩齐备，才能证明这句出自拒绝点而非依赖体检那格
- **AND** 驱动一次都不得被启动（桩驱动标记文件不存在）
- **AND** 该判定记录在命令结束后**逐字节不变**

#### Scenario: skip 记录不带旗标 ⇒ 既有跳过语义保持不变

- **WHEN** 同一份 `mode=skip` 记录，执行 `sh scripts/deep-review.sh`（不带 `--force`）
- **THEN** 退出码为 `0` 且驱动不被启动
- **AND** 输出仍按决策矩阵说明跳过——把人为误用与正常跳过做成同一种红，会诱导维护者反过来把整段拒绝删掉

### Requirement: 入口不得让"没有发生的审查"覆写判定产物

`skip` 档下把控制权交给驱动会产生一次真实的产物写入：驱动在该分支回写 `{required:false, status:"skipped_by_mode", performedBy:null, findings:null}`，整块覆盖记录里的 `deepReview`，而 `mode` 字段本身不变（2026-10-22 临时仓实测）。系统 SHALL 使 `skip` 记录在任何参数组合下都不因"跑了一遍入口"而改变判定产物内容，并把这一条以**记录字节相等**的形式纳入回归锁。

#### Scenario: 带旗标的拒绝路径不产生写入

- **WHEN** 对 `mode=skip` 记录执行 `--force`
- **THEN** 记录文件的字节与执行前完全相同
- **AND** 回归锁 MUST 断言字节相等，而不是断言"某个字段没变"（后者对新增字段免疫）

#### Scenario: 已知范围外推边界

- **WHEN** 评估本要求覆盖哪些记录
- **THEN** 仅 `mode=skip` 一格经实测确认；`mode=dual`/`single` 记录下驱动的回写行为 SHALL NOT 被本要求外推，实测前不得写成结论

### Requirement: 不得为不可达的分支保留旗标，两层的差异必须分别成锁

`scripts/plan-review.sh` 的 `SKIP` 早退分支与它的 `--force` 旗标 SHALL NOT 存在——判定器对决策层输入恒不产出 `skip`（`isDocsOnly()` 对 `staged.proposal` 短路），因此那面旗标没有可作用的对象。系统 SHALL 用可执行判据把"决策层不产出 skip"这一事实钉住，而不是留一段注释或一个不会生效的旗标；任何"让方案评审可以按规模跳过"的语义变更都 MUST 先让这些判据变红并经显式裁决（那是新增门禁豁免，属"谁来守门"）。

#### Scenario: 决策层判定器对两种路径形状都不产出 skip

- **WHEN** `node scripts/ccg-review-decider.js --input <方案.md> --print` 的输入分别是裸临时目录里的 2 行方案与落在 `openspec/changes/<slug>/` 下的同名方案
- **THEN** 两次读数都必须是 `SINGLE` 或 `DUAL`，不得为 `SKIP`

#### Scenario: S 复杂度方案照样把控制权交给驱动

- **WHEN** 对该小方案执行 `sh scripts/plan-review.sh <方案>`（不带任何旗标）
- **THEN** 桩驱动必须被启动并落标记；带 `--force` 时行为同形（未知旗标只出声不拦，走既有分支）

#### Scenario: 验证层的四格矩阵必须各自可分辨

- **WHEN** 分别执行「验证层 `skip` ± `--force`」与「决策层 S 方案 ± 旗标」四格
- **THEN** 每格都有独立断言，且任一格退化成与另一格同形时至少一条锁变红（红集相同的两把锁中必有一把是装饰）
