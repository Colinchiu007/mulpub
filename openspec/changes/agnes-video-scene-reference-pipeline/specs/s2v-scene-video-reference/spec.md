## ADDED Requirements

### Requirement: 场景 AI 视频的参考图来源

在**视频任务编辑页**对某场景重新生成 AI 视频时，SHALL 尝试把该场景**已选定的图片**（`segment.imagePath`）作为 provider 的参考输入。该图片由用户在此前的素材选择中确定，**已存在** ⇒ 本能力不产生额外图片生成、不引入额外等待。

参考图 SHALL 只在**当前模型的能力声明支持参考输入**时使用；不支持的模型 SHALL 保持纯文本生成（行为与本能力引入前一致）。

#### Scenario: 模型支持首帧锁构图

- **WHEN** 用户在视频任务编辑页对场景 S 触发「生成 AI 视频」，S 已选定图片，且当前模型的能力声明包含 `keyframe`
- **THEN** 提交给 provider 的参数 SHALL 含 `mode='keyframe'` 与该图的 `firstFrame`（Data URI 形态）

#### Scenario: 模型仅支持参考图

- **WHEN** 当前模型的能力声明含 `reference` 但不含 `keyframe`
- **THEN** 提交参数 SHALL 含 `mode='reference'` 与 `images=[该图]`

#### Scenario: 模型不支持参考输入

- **WHEN** 当前模型的能力声明不含 `keyframe` 也不含 `reference`（含未知模型）
- **THEN** 提交参数 SHALL **不含**任何媒体字段，等价于纯文本生成

#### Scenario: 该场景没有已选定的图片

- **WHEN** 目标场景的 `imagePath` 为空
- **THEN** 提交参数 SHALL 不含任何媒体字段，且**不报错**（该段照常按纯文本生成）

### Requirement: 参考图读取的三道防线

构造参考输入时，图片 SHALL 依次通过：**受控媒体根**（拒绝越界路径、软链接、非文件、扩展名不符）、**体积上限**（≤5MB）、**内容魔数嗅探**（PNG/JPEG/WEBP）。任一关不通过 SHALL 降级为纯文本生成并记录可归因的 reason，SHALL NOT 中断该段的视频生成。

#### Scenario: 路径越出受控根

- **WHEN** 该场景的图片路径不在允许读取的媒体根内
- **THEN** 参考输入被跳过（reason 指向「不可读或越界」），该段照常按纯文本生成

#### Scenario: 扩展名是图片但内容不是

- **WHEN** 一个 `.png` 文件的内容不匹配任何图片魔数
- **THEN** 参考输入被跳过（reason 指向「类型不支持」），SHALL NOT 把该字节流当作图片发给 provider

#### Scenario: 体积超限

- **WHEN** 该图片超过 5MB
- **THEN** 参考输入被跳过，该段照常按纯文本生成
