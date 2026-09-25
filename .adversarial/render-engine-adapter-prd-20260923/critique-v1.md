# Critique v1 — RenderEngineAdapter PRD（红队逐条挑刺）

评审立场：尽力反驳"该 PRD 可直接进 Phase 1.1"。证据等级 L1（事实性错误，成立则评审认错的反面，即提案方必须改）/ L2（需求遗漏，强烈建议改）/ L3（架构权衡，可辩论）。

## 逐条问题（JSON）

```json
[
  {"id":"C1","level":"L1","dim":"feasibility",
   "issue":"验收黄金标准定为『成片逐帧一致（像素 diff 阈值内）』不可达成。Remotion/HyperFrames 经 headless Chromium 渲染 + H.264 编码，跨运行/字体/驱动/npx 包版本不保证 bit 级或像素级确定，该门禁要么永远红、要么被迫放宽到无意义，会拖垮整个测试策略。",
   "evidence":"竞品 freecut 自己的 render-frame-decomposition-plan.md 即承认逐帧合成是『静默回归、错像素不崩溃、自动化套件不在像素级 exercise』的高危区；把最终像素当唯一门禁与之矛盾。",
   "fix":"改主门禁为『结构等价』：对同一 composition fixture，断言重构前后生成的渲染命令/参数、composition JSON、hyperframes manifest、ffmpeg 命令等中间产物等价；成片侧只做采样关键帧的感知哈希（pHash）宽松阈值 + 人工抽帧兜底。"},

  {"id":"C2","level":"L2","dim":"feasibility",
   "issue":"缺少『重构前采集黄金基线』的前置任务。T1-T7 里没有 T0=建立三引擎 fixture 与基线指纹；若在改后才采基线，等于拿重构后的实现当『正确答案』，黄金测试失去意义。",
   "fix":"新增 T0（3h，阻塞 T2-T5）：在干净 HEAD 上为每引擎各≥2 场景录制结构等价物 + pHash 基线。"},

  {"id":"C3","level":"L2","dim":"feasibility",
   "issue":"T3/T4『并行』抽取同改 video_compose.py 2551 行单文件，一个 worktree 内必冲突，不可真并行；与 subagent 并行铁律（无共享状态才可并行）相悖。",
   "fix":"T2→T3→T4 串行（每片独立回归合入再下一片），或明确各自只切自己引擎代码段且顺序合入。"},

  {"id":"C4","level":"L2","dim":"completeness",
   "issue":"F-P0-6『治理语义不变』漏了 runtime_swap_detected：video_compose 用 proposal_packet.production_plan.render_runtime 比对 edit_decisions.render_runtime 来拦『中途换引擎』，这是最重要的治理校验之一，PRD 未提。",
   "evidence":"代码注释明确 final_review compares ... runtime_swap_detected。",
   "fix":"把 runtime_swap 比对纳入 adapter 契约承接范围 + 验收治理用例。"},

  {"id":"C5","level":"L2","dim":"consistency",
   "issue":"问题陈述夸大为『三后端都是上帝文件内联 if/elif』。实际 HyperFrames 早已委派给独立工具 hyperframes_compose.py，真正内联的只有 remotion+ffmpeg。据此 HyperFramesAdapter 若再包一层，形成『Compose 工具 + Adapter』双层抽象冗余。",
   "fix":"诚实重述问题域（remotion/ffmpeg 内联 + 无统一契约）；明确 HyperFramesAdapter = 对现有 hyperframes_compose 工具的薄 facade（复用而非重写），避免双层。"},

  {"id":"C6","level":"L2","dim":"consistency",
   "issue":"translate_style 出现在 P0 的 ABC（F-P0-1），但真正落地在 P1（F-P1-1）。P0 阶段该 ABC 方法对所有引擎都 raise NotSupported = 带一个无消费者的占位抽象，违反本 PRD 自己的『过度设计』缓解。",
   "fix":"P0 的 ABC 不含 translate_style；P1 再加。"},

  {"id":"C7","level":"L2","dim":"completeness",
   "issue":"F-P0-4 把 capabilities 定为 P0 交付，但唯一『编程化使用 capabilities 选引擎』的能力 recommend 在 P1。P0 交付的结构化能力若无消费者 = 数据建好没人读（YAGNI）。",
   "fix":"要么把 recommend 提到 P0（让 capabilities 有真实消费者），要么明确 P0 消费者=preflight/validate/治理（若确实读它）。需说清谁在 P0 消费 capabilities。"},

  {"id":"C8","level":"L2","dim":"clarity",
   "issue":"『video_compose 显著变薄』无量化目标；该文件 2551 行里还含 theme 构建、音频混挂、caption 处理、validation、proposal diff 等，只搬三引擎分派未必显著变薄，验收不可测。",
   "fix":"给可测目标：主调度函数行数/删除的 render_runtime 分支数 ≥N；或明确本 PRD 只承诺移除引擎分派，不承诺整文件瘦身（避免验收虚标）。"},

  {"id":"C9","level":"L2","dim":"security",
   "issue":"渲染引擎统一走 npx/ffmpeg 子进程 + composition 派生参数，正是命令注入的高危汇聚点；PRD 除 fail-fast 外无任何子进程参数加固/白名单要求。做统一 chokepoint 重构是顺手收敛攻击面的最佳时机，却缺席。",
   "evidence":"AGENTS.md 阶段6 CTO 必检『Shell 注入』；QM 门禁关注命令构造。",
   "fix":"契约层要求 adapter 对传入子进程的参数做校验/转义（禁 shell=True 拼接、列表传参、路径白名单），并加对应安全用例。"},

  {"id":"C10","level":"L3","dim":"consistency",
   "issue":"『契约同构但独立、不合并』与『CI 门禁模式复用』有张力：QM『Adapter capability 单一来源』门禁是针对 provider BaseAdapter.KNOWN_METHODS 的脚本；渲染引擎是否复用同一 gate 脚本、还是新建 gate，未说明。",
   "fix":"Phase 1.1 明确：gate 是扩展到 RenderEngineAdapter 还是新建独立 lint；给结论。"},

  {"id":"C11","level":"L3","dim":"clarity",
   "issue":"RenderEngineRegistry 生命周期/DI 未定：adapter 需配置（路径/env/子进程句柄），registry 持实例还是工厂？在 python-backend 工具边界（ToolResult 需可序列化）下如何注入上下文？",
   "fix":"Phase 1.1 定 registry 用工厂 + 注入 RenderContext，adapter 不跨调用持有子进程态。"}
]
```

## 分维度评分（0-10）

```json
{
  "completeness": 6.5,
  "consistency": 7.0,
  "clarity": 7.0,
  "feasibility": 5.5,
  "security": 6.0,
  "weighted": 6.35,
  "verdict": "NOT CONVERGED (< 8.0)。可行性被 C1 像素确定性的 L1 硬伤 + C2/C3 排序问题压到 5.5。须出 v0.2 修订。"
}
```
