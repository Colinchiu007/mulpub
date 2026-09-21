## MODIFIED Requirements

### Requirement: 视频提示词统一经 prompt-engine 优化
所有视频提示词优化路径（videogen 流水线 videogen_generate 前、Story2Video 混合模式 select_video_scenes→generateSceneVideo 前）SHALL 统一调用 prompt-engine 服务（POST /v1/optimize 或 /v1/optimize/batch，请求携带 domain=video），执行视频提示词改写与输出校验；不得绕过 prompt-engine 直接把未经优化的提示词提交视频 provider，也不得把图片优化提示词原样复用为视频提示词。本义务不适用 film-engineering 视频生成路径（film_generate_videos 阶段及失败分镜单镜重试）：该路径的 kit/剧本套用提示词 SHALL 原文直送视频 provider（`<<<uuid>>>` 令牌与块标签逐字符不变），在该路径调用 prompt-engine 优化链路本身构成合同违例。

#### Scenario: videogen generate 前优化
- **WHEN** videogen 流水线执行 videogen_generate 阶段且场景提示词数组非空
- **THEN** 每个场景提示词经 PromptBridge 以 domain=video 提交 prompt-engine 优化，校验通过后的 optimized_prompt 才传入 callAdapter('generateVideo')

#### Scenario: 混合模式视频场景优化
- **WHEN** Story2Video 混合模式选中 useVideo 场景且其提示词来自图片优化结果
- **THEN** 该提示词先经视频优化引擎（domain=video）改写，再提交 generateSceneVideo；不得直接复用图片 optimized_prompt

#### Scenario: 服务不可用明确失败
- **WHEN** prompt-engine（8013）未运行或 /v1/optimize 网络失败（或独立视频引擎 8020 已配置但不可用）
- **THEN** 视频优化阶段返回明确错误（如「prompt-engine 未运行，无法优化视频提示词」），不静默回退到默认 LLM，也不把原 prompt 当作优化结果继续

#### Scenario: film-engineering 直送豁免
- **WHEN** film-engineering 流水线执行 film_generate_videos 阶段或失败分镜单镜重试
- **THEN** 提示词不经任何 prompt-engine 调用直接提交 callAdapter('generateVideo')，提交文本与导出文本逐字符一致；prompt-engine 服务是否在运行对该阶段无影响

#### Scenario: film 路径调用优化器即违例
- **WHEN** film_generate_videos 的执行链路中出现对 prompt-engine（/v1/optimize 或 /v1/optimize/batch，domain=video）的调用
- **THEN** 该行为被合同判定为违例（回归测试以"优化器被调用即失败"的负向用例拦截）
