# api-signer-registry (delta)

## ADDED Requirements

### Requirement: 进程内签名注册表
签名能力 SHALL 以进程内注册表提供：`register(signCommand, implFn)` / `sign(signCommand, payload) → signature`；未知或未注册的 signCommand MUST fail-closed（抛错，绝不静默返回空串继续发布）。

#### Scenario: 未知命令
- **WHEN** 调用未注册的 signCommand
- **THEN** 抛出明确错误，发布链在发出请求前终止

#### Scenario: Tier-A 本地签名
- **WHEN** 视频号 Content-MD5、B站 csrf、百家号 token 等本地算法被调用
- **THEN** 结果与现 signer-local.js 行为一致（收编迁移，回归测试锁定）

### Requirement: 远程签名通道零出口
引擎代码 MUST NOT 保留任何形态的远程签名服务调用路径（含环境变量驱动的对比通道）；运行时代码中 MUST NOT 出现第三方签名服务域名字面量。

#### Scenario: 后门拆除
- **WHEN** 设置任意远程签名相关环境变量后运行发布
- **THEN** 行为与未设置完全一致（代码中已无该通道）；grep 检查 `MP_SIGNER_BASE`、`getRemoteSign`、`refpub` 在 `packages/api-publish-engine`、`apps/desktop` 为 0 命中

#### Scenario: 无网络出口
- **WHEN** 单测断言 registry 全部内置实现
- **THEN** 不存在注入 axios/http 客户端到 registry 的路径；tmpdir 扫描确认无签名函数序列化文件

### Requirement: 签名句柄内存驻留（Tier-B 前瞻约束）
从平台页面抽取的签名函数句柄（W3 起）MUST 只驻留内存，禁止序列化到磁盘、数据库或 git；抽取脚本与句柄不得进入安装包 files glob。

#### Scenario: 句柄不落盘
- **WHEN** 任何签名实现产出结果后
- **THEN** 磁盘/数据库无函数源码或句柄序列化产物；`package.json` files glob 不含抽取脚本
