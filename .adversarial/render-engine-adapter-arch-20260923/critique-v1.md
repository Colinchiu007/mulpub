# Critique v1 — RenderEngineAdapter 架构（红队）

立场：尽力反驳"该架构可直接进 Phase 1.3 开发计划"。

```json
[
 {"id":"A1","level":"L2","dim":"consistency",
  "issue":"RF-2 的降级发生在 RemotionAdapter.render 内（remotion 不可用→走 ffmpeg），但架构又给每个 adapter 配 preflight()→available。二义：preflight 报 remotion 不可用时，registry 到底还路不路由到 RemotionAdapter？现状是【照路由，内部降级】。若实现者误读成'preflight 不可用就不选它'，等于改了行为（locked remotion 静默变 ffmpeg 决策路径）。",
  "fix":"显式写死：preflight()/validate() 只用于 get_info 上报与 render 前置 fail-fast，绝不参与 resolve() 路由决策；resolve 只看 composition_mode + render_runtime 字符串。降级唯一入口是 RemotionAdapter.render。"},

 {"id":"A2","level":"L2","dim":"completeness",
  "issue":"RenderRequest 同时带 edit_decisions 与 resolved_cuts，二者 cuts 字段谁是权威未定。现状是 dict(edit_decisions, cuts=resolved_cuts) 覆盖后才交给渲染内核。契约不留神会让 adapter 读到未解析的 asset id，或二次解析。",
  "fix":"规定：adapter 一律读 req.resolved_cuts；req.edit_decisions.cuts 视为原始（可含未解析 id），仅供元数据。写入 §2 schema 注释与 §5。"},

 {"id":"A3","level":"L2","dim":"feasibility",
  "issue":"把 atelier 建模为第 4 adapter（D1/T4b）超出已签字 PRD 的 P0 边界（F-P0-2 只列三引擎），且 atelier 路径(_render_via_atelier + _run_atelier_checks, 约 L739-1006)是含 doctrine-enforcement 的大块手写逻辑，封装成 adapter 远超 3h、测试覆盖最薄弱，反而扩大行为保持的爆炸半径。纯'行为保持'目标下，atelier 最低风险做法是原样留在 orchestrator 短路，不转 adapter。",
  "evidence":"PRD v0.2 非目标'不新增引擎'、P0 只三引擎；行为保持优先于架构整洁。",
  "fix":"降级 atelier：P0 不抽 AtelierAdapter，_render 顶部原样保留 composition_mode==atelier 短路（不经 registry）。atelier 转 adapter 另立后续项。删 T4b，回退 D1。"},

 {"id":"A4","level":"L2","dim":"clarity",
  "issue":"RenderContext.raw_inputs 逃生舱无边界（Q2 自曝）。实现者可用它把 edit_decisions/profile/asset 全塞回去，使 video_compose '变薄'（PRD C8 可测承诺）被悄悄架空。",
  "fix":"加硬约束：raw_inputs 仅过渡期只读、禁止承载已被 context 字段表达的入参；T5 退出标准含'raw_inputs 在 3 adapter 的 render 路径命中次数=0'或白名单清单，写入验收。"},

 {"id":"A5","level":"L3","dim":"consistency",
  "issue":"capabilities 定为类属性(D4)，但已签字 PRD §4 契约写的是 def capabilities(self) 方法。两份文档接口不一致。",
  "fix":"架构声明'PRD 伪代码为示意、以本架构冻结的类属性为准'，并在 PRD 加一行勘误链接，避免 review 期两文档打架。"},

 {"id":"A6","level":"L2","dim":"security",
  "issue":"PRD C9 的 shell=False 只挡住字符串拼接，但 hyperframes/remotion 经 `npx <pkg>` 执行，npx 会按名解析并可拉取执行任意 npm 包（供应链/版本漂移）。架构 requires_env 提了 node>=22 却没提 npx 包版本固定，chokepoint 审计漏了这条真实攻击面。",
  "fix":"§3/§6 补：requires_cmd 的 npx 调用必须带已锁定版本或 --offline/本地 node_modules 解析，doctor/render 不接受调用方可控的任意包名参数；列为安全用例。"},

 {"id":"A7","level":"L2","dim":"feasibility",
  "issue":"T0 要采'渲染命令/参数'结构基线，但现状命令在 _compose/_remotion_render/HyperFramesCompose._render 深处直接 subprocess.run，没有可观测出口。无捕获接缝就无法采基线，T0 低估。",
  "fix":"T0 显式含'加子进程调用捕获接缝（monkeypatch/记录 run_command 入参）'，作为结构等价断言的前置；该接缝复用现成 base_tool.run_command（video_compose 注释已提及集中记录 stderr 处）。"}
]
```

## 分维度评分

```json
{"completeness":7.5,"consistency":7.5,"clarity":8.0,"feasibility":6.5,"security":7.5,
 "weighted":7.33,"verdict":"NOT CONVERGED(<8.0)。可行性受 A3(atelier 超范围扩张)+A7(基线无接缝) 拖累。修订方向是【缩小爆炸半径】而非加东西。"}
```

## 附：值得肯定的地方（评审也要认账）
- RF-1/RF-2/RF-3 三条行为事实的识别（尤其 RF-3 final_review 跨引擎覆盖不一致原样保留）质量很高，是本架构最大价值，避免了"顺手统一"改行为。
- D5（adapter 不产 ToolResult、外壳映射）正确守住了对外工具 schema 零变化。
- C10 结论（新建 pytest 门禁而非污染 JS gate）判断到位。
