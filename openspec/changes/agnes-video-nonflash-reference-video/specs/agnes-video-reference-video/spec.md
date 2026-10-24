## ADDED Requirements

### Requirement: 参考视频素材的形态与能力门控

参考素材模式 SHALL 支持第三类素材——**参考视频**。该上传位 SHALL 仅在当前视频模型的能力声明 `supportsReferenceVideo` 为真时渲染；能力不声明支持时 SHALL NOT 渲染（不写死模型名单，由能力驱动）。

参考视频 SHALL 以 Data URI 形式提交（`{ url: "data:video/mp4;base64,…" }`），客户端 SHALL 限制：单文件 ≤20MB、类型限于 mp4 / mov / webm / mkv、数量不超过模型声明的上限（Flash 为 0，即不渲染该位）。

#### Scenario: 能力不支持时不渲染参考视频位

- **WHEN** 当前模型的能力声明 `supportsReferenceVideo` 为假
- **THEN** 参考素材模式 SHALL NOT 渲染参考视频上传位

#### Scenario: 支持时提交 Data URI

- **WHEN** 当前模型支持参考视频，用户选入一个 mp4 并提交
- **THEN** 提交载荷 SHALL 含 `videos` 数组，其元素的 `url` 为 `data:video/mp4;base64,…` 形态

#### Scenario: 超过体积上限时不入列

- **WHEN** 选入的参考视频超过 20MB
- **THEN** 该文件 SHALL NOT 被加入素材，页面 SHALL 提示单文件体积上限，且 SHALL NOT 发起网络请求

### Requirement: 非 Flash 视频模型可被选择

模型种子与模型清单 SHALL 暴露 `agnes-video-2.5`（支持 720P/1080P/1K/2K、参考图 ≤8、参考视频 ≤1）。端点 SHALL 保持由用户在模型设置中配置（能力与端点解耦）。

#### Scenario: 能力描述反映非 Flash 的差异

- **WHEN** 查询模型 `agnes-video-2.5` 的能力描述
- **THEN** `sizes` 含 `1080P` / `1K` / `2K`，`maxImages` 为 8，`maxVideos` 为 1，`supportsReferenceVideo` 为真

### Requirement: 生成成本可见

页面 SHALL 显示预计成本：输出秒数 × 分辨率档位的现行单价。若模型有参考视频，SHALL 额外明示「参考视频的时长另计」（客户端读不到视频时长，故不虚报总额）。现行单价为 0（限时免费）时 SHALL 显示免费提示而非金额。

#### Scenario: 计费模型显示金额

- **WHEN** 当前模型 `agnes-video-2.5`、时长 8 秒、720P
- **THEN** 成本提示 SHALL 显示 8 秒 × ¥0.15/秒 = ¥1.20

#### Scenario: 免费模型显示免费提示

- **WHEN** 当前模型 `agnes-video-2.5-flash`（现行价 ¥0）
- **THEN** 成本提示 SHALL 显示限时免费，SHALL NOT 显示 ¥0.00

#### Scenario: 有参考视频时明示另计

- **WHEN** 参考素材模式下已选入参考视频
- **THEN** 成本提示 SHALL 在金额之后附加「参考视频的时长另计」的说明
