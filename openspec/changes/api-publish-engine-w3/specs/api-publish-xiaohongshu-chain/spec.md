# api-publish-xiaohongshu-chain (delta)

## ADDED Requirements

### Requirement: 小红书链前置取证硬门槛
小红书 API 发布链的实现 MUST 以完整链逐字切片为前置：从完好 bundle 补提上传、发布提交与 `x-s`/`x-t` 生成调用点全段入文档域证据；补提后仍存在无法钉死的字段面或签名生成路径时，本波 MUST 止步（小红书并入后续波次或保持 DOM RPA），MUST NOT 凭记忆或推测实现请求契约。

#### Scenario: 取证缺口过大
- **WHEN** 补提切片后发布提交 body 的关键字段名仍不可确定
- **THEN** 小红书链不实现，platforms.yaml 不翻转，裁决与缺口清单记录入证据文档

### Requirement: x-s/x-t 经签名页求签与探针裁决
`x-s`/`x-t` MUST 经进程内签名注册表 `xiaohongshu.x-s` 命令获得；既有本地近似实现（`getXiaohongshuSign(path, body)`）MUST 先经最低风险端点活体探针裁决，探针不通过则 MUST 走浏览器辅助签名页 provider（复用 `api-publish-signer-page` 基建契约），二者皆不可得即止步。运行时代码 MUST NOT 含外包签名服务 URL 常量或远程求签通道；求签失败/未就绪按 publishMode 双轨降级 DOM。

#### Scenario: 本地公式探针不通过
- **WHEN** 最低风险已认证端点拒绝本地公式产出的 x-s
- **THEN** 该 command 只能由签名页 `verified` 槽位服务；签名页不可用时链以「签名页未就绪」失败并降级 DOM

### Requirement: Adapter 变薄委托与双轨翻转
spike 与取证双门槛均通过后，`XiaohongshuAdapter` SHALL 变薄委托新链，`config/platforms.yaml` xiaohongshu `publishMode` SHALL 翻转为 `api-then-dom`；风控信号 MUST 归一 `risk_blocked` 挂起账号、绝不自动换号；活体验收 MUST 遵循真实标题、私密/草稿优先、同账号间隔 ≥18 分钟并留证据四件套。

#### Scenario: 活体私密验收
- **WHEN** 小红书链通过全部离线契约测试后进入活体窗口
- **THEN** 以真实标题发布 1 条私密/草稿内容，前台回查截图 + 作品 ID + 链接 + 降级标记入 `evidence/api-w3-xiaohongshu/`
