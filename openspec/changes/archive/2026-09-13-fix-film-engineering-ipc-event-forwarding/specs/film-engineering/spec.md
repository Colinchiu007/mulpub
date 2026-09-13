## MODIFIED Requirements

### Requirement: IPC 参数校验与 sender 校验

film-engineering 全部 IPC 通道 SHALL 经过 withSenderCheck 校验（仅受信窗口可调用），并对入参执行运行时校验（film-kit 查询类：sceneId/shotId 为字符串；套用类：script 非空 <=10000、characterMap <=10 键且值非空、shots 数组 <=50 项且每项 prompt 非空 <=50000）；通过校验的参数化通道 MUST 将原始 IPC event 作为第一个参数、将业务参数按调用顺序转发给业务逻辑；非法入参 SHALL 返回带原因的拒绝错误，不得进入业务逻辑。

#### Scenario: 非受信 sender 拒绝

- **WHEN** 非受信窗口（如外部 file:// 或未注册 sender）调用 film-engineering IPC
- **THEN** 调用被拒绝并记录安全日志，业务逻辑不执行

#### Scenario: 非法入参拒绝

- **WHEN** script 为空、超过 10000 字符或 shots 数组超过 50 项
- **THEN** IPC 返回明确校验错误（含字段名与边界），不进入套用逻辑

#### Scenario: 合法参数按原顺序转发

- **WHEN** 受信窗口以合法 sceneId、shotId 或选中分镜参数调用参数化 film-engineering IPC
- **THEN** 业务逻辑收到原始 IPC event 和未错位的业务参数，调用成功且不返回参数校验错误

#### Scenario: 导出/生成负载可被结构化克隆

- **WHEN** renderer 对选中分镜调用 export 或 generate-selected，且分镜包含 refTokens 数组
- **THEN** 传给 ipcRenderer.invoke 的负载必须为纯 JSON（可被 structuredClone 复制），不得携带 Vue 响应式代理，也不得触发 “An object could not be cloned”
