# Rebuttal v1 — 提案方逐条回应

| id | 决定 | 理由/证据 | 落点 |
|----|------|-----------|------|
| C1 | **接受（L1，无异议）** | 评审正确：Remotion/HyperFrames headless 渲染 + H.264 编码非像素确定，把最终像素当唯一门禁不可测。降为『结构等价为主 + 关键帧 pHash 宽松兜底 + 人工抽帧』。这是本 PRD 最大修正。 | §7 验收、§9 测试策略、F-P0-2 |
| C2 | **接受** | 基线必须在干净 HEAD 重构前采集，否则自证。新增 T0，阻塞后续。 | §6 T0 |
| C3 | **接受** | 同改 2551 行单文件不可真并行。T2→T3→T4 串行合入。 | §6 |
| C4 | **接受** | runtime_swap_detected 确为治理核心（proposal vs edit_decisions 比对），此前遗漏。纳入 F-P0-6 与验收。 | §3 F-P0-6、§7 |
| C5 | **部分接受** | 评审对"HyperFrames 已委派"属实，问题陈述确被夸大。但"双层抽象"可避免：HyperFramesAdapter 定为对现有 hyperframes_compose 的**薄 facade**（转调，不重写、不叠第二层业务）。采纳重述。 | §1 问题、F-P0-2 |
| C6 | **接受** | P0 的 ABC 移除 translate_style，改 P1 引入，消除无消费者占位抽象。 | §3、§4 |
| C7 | **部分接受** | 澄清而非搬 recommend：P0 的 capabilities **确有消费者**——`preflight()`（依赖命令 requires_cmd 校验）、`validate()`（word_level_captions/native_transitions 决定某 composition 能否走该引擎）、治理文案（散文→notes）。故非死数据。recommend 仍留 P1（面向上游选路）。在 PRD 明确写清 P0 消费者。 | §3 F-P0-4 |
| C8 | **接受** | 改为可测承诺：本 PRD 只承诺"主调度路径移除全部 `if render_runtime==` 分支（≥3 处）"，不承诺整文件行数下降（theme/audio/caption 等非引擎分派逻辑属后续切片），避免验收虚标。 | §7、§8 |
| C9 | **接受** | 统一 chokepoint 正是收敛命令注入攻击面的时机。契约新增硬性要求：子进程列表传参、禁 shell=True 字符串拼接、路径白名单；加安全用例。 | §4、§7、§9 |
| C10 | **暂缓（L3，交 Phase 1.1）** | "复用门禁模式"指复用其**纪律**（能力单一来源、禁重复 concat），具体是扩展现有 gate 脚本还是新建 render 专用 lint，属实现细节，Phase 1.1 给结论，不阻断 PRD。 | Phase 1.1 |
| C11 | **暂缓（L3，交 Phase 1.1）** | registry 工厂 + 注入 RenderContext、adapter 不跨调用持子进程态，方向认同，schema 细化归 Phase 1.1。 | Phase 1.1 |

## 净结果
- 接受并已在 PRD v0.2 落地：C1 C2 C3 C4 C6 C8 C9；部分采纳：C5 C7；L3 交 Phase 1.1：C10 C11。
- 本轮无 L3 拒绝超限（0/3）。
- 关键收获：C1 纠正了一个会导致整个测试策略失效的 L1 事实错误；C9 补上安全汇聚点；C4 补上被漏掉的治理主校验。
