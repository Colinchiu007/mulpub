# Critique v1 — DEV-PLAN v0.1 对抗性评审（逐条挑刺 + 分维度评分）

评审对象：`01-docs/DEV-PLAN-RENDER-ENGINE-ADAPTER-2026-09-23.md` v0.1
上游约束：PRD v0.2（签字）、架构 v0.2（RF-1/2/3、A1-A7 决议为既定边界，不得被计划悄悄改写）

## 逐条问题

```json
[
  {
    "id": "P1", "sev": "HIGH", "dim": ["可行性", "一致性"], "evidence": "L2",
    "issue": "计划自设开放问题 Q2（REM-2 降级需调 FFmpeg 实现，T3 后 _compose 内核已迁 FFmpegAdapter——跨 adapter 依赖未冻结）却仍把 T4 标为'可独立验收'。Phase 1.3 的产物必须决策完备：实现者读到 Q2 时无路可走。且现状行为是 remotion 降级 _compose 后仍进 ⑦ final_review（架构 §0 伪码：remotion 分支落入 ⑦），任何跨 adapter 设计都不得改变该编排位置。",
    "demand": "在计划内冻结注入方式（建议：RemotionAdapter 构造时由 registry 工厂组合注入 FFmpegAdapter 实例/工厂，降级调 ffmpeg_adapter.render，结果仍经外壳 ⑦），并声明该决策回写架构附录。"
  },
  {
    "id": "P2", "sev": "HIGH", "dim": ["安全性", "可行性"], "evidence": "L2",
    "issue": "Q1 已有现成答案但计划没有拍板：T0 接缝改 `base_tool.run_command` 会把爆炸半径扩到 video_creation 全部 provider（audio/image/capture 十余处共用基类），与'行为保持'任务的安全边界冲突。而渲染路径的 subprocess 全部经 `self.run_command`（video_compose L610/635/684/855/1777/2396/2468/2521 逐一核实），基类不动、video_compose 私有覆写即可拿到同等捕获能力。",
    "demand": "冻结：接缝 = VideoCompose 子类覆写 run_command（或注入 capture 回调），base_tool.py 零改动，从 T0 改动文件清单中移除 base_tool.py。"
  },
  {
    "id": "P3", "sev": "MAJOR", "dim": ["完整性"], "evidence": "L2",
    "issue": "Q3 同样'提了问题没给答案'：`operation=compose` 是对外 operation，与 `_render` 的 ffmpeg 路径共享 `_compose` 内核（L381）。T3 抽内核时 compose 入口同样可能被改坏，但 §3.1 场景矩阵没有任何 compose 入口基线——T3 的'全量 pytest 绿'不能替代结构等价，因为既有 test_video_compose.py 不逐字段断言 ffmpeg cmd。",
    "demand": "矩阵新增 COMP-1（operation=compose 直调）场景，T0 采集、T3 等价断言；或明确论证 compose 不消费被迁移代码并给出 grep 证据。"
  },
  {
    "id": "P4", "sev": "MAJOR", "dim": ["可行性"], "evidence": "L3",
    "issue": "T0=3h 承载'接缝开发+单测+harness+10 场景真实环境基线采集'不可信：REM/HF 场景需要真实 node/remotion/hyperframes 环境各跑通一次渲染（单场景 5-30 分钟属常态），REM-2/HF-2 还要构造'引擎不可用'环境位。架构轮 summary 已点名'CCG 前例严重低估'，T0 恰恰是最易被环境烧时间的切片。",
    "demand": "T0 拆 T0a（接缝+harness 单测，2h）/ T0b（场景基线采集，4h），P0 总量修正为 28h 并如实重报 Buffer。"
  },
  {
    "id": "P5", "sev": "MAJOR", "dim": ["一致性"], "evidence": "L1",
    "issue": "T5 验收含'get_info() 输出与基线逐字段等价（由 preflight_all + notes 组装）'，但 T5 的目标段只列了 `_render` 委派，改动清单不含 get_info——要么验收项指向一个没有工作项支撑的改动（不可达），要么语义是'get_info 不动故天然等价'（那验收表述误导）。两文档间还有一处实质漂移：架构 §5.4 明确 get_info'由 registry.preflight_all() + capabilities.notes 组装'，计划从未安排这个切换，C10/架构承诺的单一来源在 get_info 侧没有落点。",
    "demand": "二选一并写死：(a) T5 增加 get_info 数据源切换工作项 + 等价断言；(b) P0 不切 get_info，架构 §5.4 改标'后续切片'，T5 验收改为'get_info 实现零改动 + 既有输出对基线等价'。禁止含糊。"
  },
  {
    "id": "P6", "sev": "MINOR", "dim": ["清晰度"], "evidence": "L3",
    "issue": "T5 证据条款'`if render_runtime ==` 出现次数=0（atelier 判定除外）'的除外子句是自由裁量口——实现者可把任意 runtime 判断都辩称'atelier 判定相关'。",
    "demand": "收紧为可脚本化白名单：`providers/video/` 下（engines/ 之外）字符串 remotion/hyperframes/ffmpeg 与 render_runtime 的比较仅允许出现在 `_render` 顶部 atelier 短路的 composition_mode/renderer_family 判定（不含 runtime 字面量），grep/ast 断言写成测试文件而非人工检查。"
  },
  {
    "id": "P7", "sev": "MAJOR", "dim": ["安全性"], "evidence": "L2",
    "issue": "A6/npx 供应链审计范围有洞：T6 只审'三 adapter 的 render/preflight'，但 HyperFramesAdapter 是薄 facade，真实 subprocess 在 `hyperframes_compose.py`（L260 `npm view <pkg> version`、L975 `_run` 子进程）。facade 不改变这些调用——安全用例若止步于 adapter 边界，等于审了个空壳。",
    "demand": "T6 审计与用例明确穿透到 hyperframes_compose 的子进程调用链（转调路径上的 shell/参数/包名控制），验收项改写为'含被 facade 转调的下游工具'。"
  },
  {
    "id": "P8", "sev": "MINOR", "dim": ["清晰度"], "evidence": "L3",
    "issue": "C3'每片独立回归通过并合入'的'合入'语义未定义：T2-T4 每片开 PR 合 main，还是单 PR 内的分支级 commit 序列？前者四次 CI/评审开销且中间态上 main（video_compose 处于半新半旧），后者才符合'每片 commit 级绿'。§4 只说'PR 汇总'，两义。",
    "demand": "写死：单 worktree 分支单 PR；'每片合入'= 片级 commit 通过全量 pytest 后进入分支历史，可独立 revert；main 只见最终态。"
  }
]
```

## 分维度评分（v0.1）

| 维度 | 分 | 依据 |
|------|----|------|
| 完整性 (25%) | 7.0 | P3 compose 入口无基线、P5 get_info 无落点、P7 审计洞 |
| 一致性 (20%) | 7.0 | P5 计划与架构 §5.4 漂移（L1 级矛盾）；P1 与架构 Q3'组合而非继承'的暗示未衔接 |
| 清晰度 (15%) | 8.0 | 卡片结构/验收 checklist 化良好；P6/P8 两处措辞留裁量口 |
| 可行性 (25%) | 6.5 | P1 决策不完备直接卡 T4 实施；P4 T0 低估复犯了前例点名要防的错误 |
| 安全性 (15%) | 7.0 | P2 接缝动共享基类、P7 facade 空壳审计 |

**加权 = 0.25×7.0 + 0.20×7.0 + 0.15×8.0 + 0.25×6.5 + 0.15×7.0 = 7.03 < 8.0 → 未收敛，进入 rebuttal。**

## 评审同时认账的地方
- T0 双重身份（'基线必须采自接缝后、重构前的 HEAD'）和'基线 commit 早于实现 commit'的可查证判据，把 C2 落成了 git 历史证据，质量高。
- §3.3 mock 纪律对'mock 进程执行 ≠ mock 决策逻辑'的划界准确，正面回应了 PRD §9 反模式。
- §3.4 每片可独立 revert + T5 可退回'adapter 就位仍走旧分支'的止损设计，把 C3 串行纪律转化成了回退能力。
- GOV-3 主动断言 runtime_swap 对 hyperframes/atelier 不生效的覆盖边界（防'顺手扩大'），是对 RF-3 的正确延伸。
