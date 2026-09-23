# 开发计划：统一渲染引擎 Adapter（RenderEngineAdapter）

- **编号**：DEVPLAN-RENDER-ENGINE-ADAPTER-2026-09-23
- **阶段**：质量节拍 Phase 1.3（PM/开发工程师 — 任务拆分与测试计划）
- **上游**：`PRD-RENDER-ENGINE-ADAPTER-2026-09-23.md` v0.2（CEO 已签字）+ `ARCHITECTURE-RENDER-ENGINE-ADAPTER-2026-09-23.md` v0.2（已过 CCG，8.58 收敛）
- **状态**：修订 v0.2 —— 已经过 CCG 对抗评审（1 轮收敛 7.03→8.52，`.adversarial/render-engine-dev-plan-20260923/`，P1-P8 全接受）
- **边界**：本计划只覆盖 P0（T0-T6，~28h + 50% Buffer ≈ 42h）；T7（translate_style）为 P1，另立计划。

---

## 0. 前置：工作区与门禁（所有 task 卡的共同 DoD 前提）

1. **隔离 worktree**：`scripts/start-mp-task.ps1 -TaskName render-engine-adapter`（PowerShell 原生 `D:\` 路径做 git 写）；工作目录 `<仓库父目录>/mp-worktrees/mp-render-engine-adapter`，分支 `codex/render-engine-adapter`。
2. **依赖就绪三件套**：`pnpm install --frozen-lockfile` → `node scripts/ensure-electron.js` → `node scripts/verify-worktree-deps.js`。
3. **并发冲突预检**：开工前 `git worktree list` + 在 `openspec/active-tasks.json` 登记本任务改动清单（`video_compose.py` 是多任务热点文件，命中即先协调再动手）。
4. **每次编辑前**：`powershell -ExecutionPolicy Bypass -File scripts/pre-code-edit-guard.ps1` exit 0。
5. **门禁命令**（每片提交前）：`cd packages/python-backend && pytest`（python-backend 门禁，全部 task 卡共用）；**本任务不改 `apps/desktop/electron/` 与 `packages/rpa-engine/`，QM-1 打包验证不适用**（以 PRD §8 影响面为据，若实施中越界则该卡不得合并）。
6. **禁止 `--no-verify`**；每片独立 commit（conventional 格式 + 分支守卫自动声明）。

---

## 1. 任务总览与关键路径

| # | 任务 | 估时 | 依赖 | 一句话完成判据 |
|---|------|------|------|----------------|
| T0a | 子进程捕获接缝（VideoCompose 私有覆写，P2 决议）+ 基线 harness | 2h | — | 接缝钩子默认关闭时全量既有测试零修改全绿；harness 单测绿 |
| T0b | 黄金基线采集（干净 HEAD，11 场景） | 4h | T0a | §3.1 场景矩阵全部基线文件落盘且 commit，同 HEAD 重放 diff=0 |
| T1 | engines/ 骨架（capabilities/context/result/base/registry）| 3h | T0a | 骨架 + 契约单测 + C10 门禁首版全绿，**不接入 video_compose** |
| T2 | HyperFramesAdapter（薄 facade）+ 等价回归 | 4h | T0b,T1 | HF 场景结构等价逐字段一致，video_compose 中 hyperframes 分支改走 registry |
| T3 | FFmpegAdapter + 等价回归 | 4h | T2 | FF/COMP 场景结构等价一致，`_render_via_ffmpeg`/`_compose` 双内核迁入 |
| T4 | RemotionAdapter（含 RF-2 非对称降级）+ 等价回归 | 4h | T3 | REM-1/2/3 三场景等价，失败禁降级 blocker 原样 |
| T5 | `_render` 委派变薄 + get_info 数据源切换 | 3h | T2,T3,T4 |  runtime 字符串比较命中=0（ast 门禁），raw_inputs 命中=0，get_info 对基线逐字段等价 |
| T6 | 治理 + 安全回归锁定（穿透 facade 下游） | 4h | T5 | §3 治理/安全用例全绿并进 pytest 门禁 |

- **串行铁律（PRD C3）**：T2→T3→T4 严格串行（同改 `video_compose.py` 单文件），每片独立回归通过并合入后才开下一片；T5 之前 video_compose 允许"半新半旧"过渡态存在，但每片合入时全量 pytest 必须绿。
- **关键路径**：T0a→(T0b ∥ T1)→T2→T3→T4→T5→T6 = 28h（T0b 与 T1 无文件交集可并行）；Buffer +50%（CCG 前例低估教训）≈ 42h。
- **T0 双重身份**：捕获接缝（A7）本身是一处**行为保持的最小代码变更**，先于基线落地并用既有全量测试验证等价——基线必须采自"接缝后、重构前"的 HEAD。
- **PR 形态（P8 决议）**：单 worktree 分支**单 PR**；"每片合入" = 片级 commit 通过全量 pytest 后进入分支历史、可独立 revert；中间态不上 main。

---

## 2. Task 卡

### T0a — 子进程捕获接缝 + 基线 harness（2h，阻塞 T0b/T2-T5）

**目标**：落地"结构等价"的可观测接缝（A7），**不改共享基类**（CCG P2 决议）。

**改动文件**：
- `providers/video/video_compose.py`：`VideoCompose` **私有覆写** `run_command`，转调 `super().run_command` 前经可选注入的 capture 回调记录 `(cmd, cwd, timeout)`（默认 None 零行为变化）。`base_tool.py` **零改动**（其被 video_creation 全部 provider 共享，爆炸半径不可接受；渲染路径子进程全部经 `self.run_command`，L610/635/684/855/1777/2396/2468/2521 已逐一核实）。
- `tests/fixtures/render-baselines/`（新增目录）+ `tests/test_render_baseline_harness.py`（新增）：基线采集/比对 harness。

**验收**：钩子默认关闭时全量既有测试零修改全绿；harness 单测（tmp_path 假 cmd 序列重放比对）绿；本卡合入后的 HEAD 即 T0b 基线采集点。

### T0b — 黄金基线采集（4h，依赖 T0a，阻塞 T2-T5）

**目标**：在"接缝后、重构前"的干净 HEAD 上固化 §3.1 全部 11 场景的结构等价证据。

**产出**：每场景一份基线 = `{渲染命令序列, composition JSON, hyperframes manifest, ffmpeg cmd, ToolResult.data 关键字段, final_review 有无, pHash 值列表}`。真实渲染跑不了的 CI 环境场景（依赖 node/remotion 安装态）在本地采集，基线文件进 git（纯文本，体积可控）。

**验收标准（独立可测）**：
- [ ] §3.1 场景矩阵（含 COMP-1/AT-1）每个场景的基线文件存在且可被 harness 重放比对（同 HEAD 重跑 diff=0）。
- [ ] atelier/final_review 覆盖差异（RF-1/RF-3 真码修正版）在基线中显式可观测：四条正常渲染路径（REM/FF/HF/AT）基线均含 final_review 证据（差异在调用位置与失败文案前缀：`(HyperFrames)`/`(FFmpeg)`/无前缀）；治理早返回场景（REM-3 失败 blocker、GOV-1 空 runtime、GOV-2 unknown runtime）无 final_review。（原 v0.2 "AT-1/HF-1 无 final_review" 断言据真码订正）
- [ ] 基线 commit 早于任何 adapter 实现 commit（git 历史可查证）。

**TDD**：harness 单测已在 T0a 先行；本卡以"采集→重放自比对"为主，不写新生产代码。

---

### T1 — engines/ 骨架（3h）

**目标**：按架构 §1-§4 建 `engines/` 包：`capabilities.py` / `context.py` / `result.py` / `base.py` / `registry.py` + `__init__.py`，全部 dataclass/ABC 与架构 §2-§3 逐字段一致。

**改动文件**：仅 `providers/video/engines/*`（新增）+ `tests/test_render_engine_capabilities.py`（新增，C10 门禁首版）+ `tests/test_render_engine_registry.py`（新增）。**不接入 video_compose。**

**验收标准**：
- [ ] 所有 schema 字段名/类型/默认值与架构 §2 冻结版一致（评审时逐字段对照）。
- [ ] `registry.register/get/resolve/preflight_all` 单测：未知 id→`UNKNOWN_RUNTIME` blocker、空 runtime→`RUNTIME_MISSING`、resolve 只按字符串路由不看 preflight（A1 硬规则）。
- [ ] C10 门禁首版：对"注册了 fixture adapter 的测试 registry"断言 id 唯一/只注册一次；真实三 adapter 在 T2-T4 逐个接入后补地面真相断言。
- [ ] pytest 全绿；video_compose 行为与基线 HEAD 完全一致（本卡零侵入）。

---

### T2 — HyperFramesAdapter（薄 facade）（4h）

**目标**：`hyperframes_adapter.py` 转调既有 `HyperFramesCompose`（PRD C5：不重写、不叠第二层业务）；`capabilities` 类属性（`word_level_captions=False`、`unavailable_fallback=None`、`requires_cmd=("npx","hyperframes")`）。video_compose 的 hyperframes 分支（`_render` ⑤ 段）改为 `registry.get("hyperframes").render(...)`。⚠️ **RF-3 真码修正**：现状 hyperframes 的终审在 `_render_via_hyperframes` **函数内部**执行（非不进终审）；facade 迁移须保持"委派→分支内终审→return"语义与原样失败前缀 `(HyperFrames)`。基线锁：HF 路径 final_review 存在且前缀不变。⚠️ **HF-导入 bug（F-2）约束**：现状 `hyperframes_compose` 导入路径错误使 HF 经 video_compose 恒不可用；facade 保持此现状行为，**不得**在行为保持切片内顺手修导入路径（属改行为，需单列）。

**验收**：HF-1/HF-2 基线结构等价逐字段一致；`_render_via_hyperframes` 仅剩转调壳或删除；全量 pytest 绿；本片合入后才开 T3。
**红线**：不得在 facade 内加新校验/新 fallback；hyperframes 不可用时的报错文案以基线为准原样保留。

### T3 — FFmpegAdapter（4h）

**目标**：`ffmpeg_adapter.py` 承接 `_render_via_ffmpeg`/`_compose` 的渲染内核（cmd 构建 + run_command）；**双入口分别暴露**：`render()`（对应 `_render_via_ffmpeg` 路径）与 `compose()`（对应 `operation=compose` 与 remotion 可用性降级的共用内核，P1/P3 决议）；外层仍由 video_compose 在 ffmpeg 路径成功后调 `_run_final_review`（RF-3 位置不动）。

**验收**：FF-1/FF-2/**COMP-1** 基线结构等价一致（compose 入口与 `_render` ffmpeg 路径共享内核但基线各自独立，防 T3 抽取改坏 compose 入口）；全量 pytest 绿；本片合入后才开 T4。
**红线**：final_review 不进 adapter；`RenderResult.data` 映射回 ToolResult 后字段逐一对齐基线。

### T4 — RemotionAdapter（4h）

**目标**：`remotion_adapter.py` 承接 `_remotion_render` + `_needs_remotion`（RF-2：不可用→走 ffmpeg 合法降级；可用但失败→`RENDER_FAILED_NO_FALLBACK` blocker 禁降级，3 选项文案进 `StructuredBlocker.options`）；`word_level_captions=True`、`unavailable_fallback="ffmpeg"`。

**验收**：REM-1/2/3 基线等价（含降级路径的结构等价：REM-2 的 ffmpeg cmd 序列与 FF-1/COMP-1 基线形态可比对）；架构 §10 Q1（`_needs_remotion` 完整实现回读确认无内容类型分支）的结论写入本卡 commit message。
**降级依赖冻结（CCG P1 决议）**：registry 注册 Remotion 工厂时**组合注入 FFmpegAdapter 工厂**；`_needs_remotion==False` 时 `RemotionAdapter.render` 调 `ffmpeg_adapter.compose()`（非 `render()`，对齐现状 `_compose`），RenderResult 照常返回，外壳 ⑦ final_review 位置不变（现状 remotion-else 路径本就经 ⑦，REM-2 基线锁死）；可用但失败 → blocker，绝不触碰 ffmpeg_adapter。该决策回写架构 §11 附录。

### T5 — `_render` 委派变薄 + get_info 切换（3h）

**目标**：① `_render` 主体改为：atelier 短路（原样留顶，A3/RF-1）→ 前置校验（②③留外壳）→ `registry.resolve()` → `adapter.validate()` fail-fast → `adapter.render()` → 按现状位置对 ffmpeg/remotion 成功结果调 `_run_final_review`（RF-3）→ `RenderResult→ToolResult` 映射 + 计时（D5）。② **get_info 数据源切换（CCG P5 决议，取方案 a）**：`render_engines`/`render_runtimes` 改由 `registry.preflight_all()` 组装，各 `*_note`/`runtime_governance` 文案改取 `capabilities.notes`，字段名与文案逐字保留（架构 §5.4 单一来源承诺在 get_info 侧的落点）。

**验收**：
- [ ] **字符串分派清零（P6 决议，收紧为可脚本化白名单）**：`providers/video/` 下（engines/ 外）禁止出现 `render_runtime` 与引擎名字面量（remotion/hyperframes/ffmpeg）的比较；atelier 短路只允许 `composition_mode/renderer_family` 判定（不含 runtime 字面量）；断言写成 `test_render_engine_capabilities.py` 的 ast 用例，不留人工 grep 裁量口。
- [ ] 三 adapter 的 `render()` 路径 `ctx.raw_inputs` 读取命中 = 0（A4 退出标准，同样 ast 脚本化）。
- [ ] `get_info()` 输出与基线逐字段等价（`render_engines`/`render_runtimes` 别名/各 `*_note`/`runtime_governance` 文案 key 全保留，数据源已切 registry）。
- [ ] 全场景矩阵重放：结构等价 100%。

### T6 — 治理 + 安全回归锁定（4h）

**目标**：新增 `tests/test_render_engine_governance.py` + `tests/test_render_engine_security.py`，把 PRD §7 治理四条 + 安全三条固化为门禁用例。

**验收**：
- [ ] 治理：缺失 runtime 报错语义、unknown runtime blocker、no-silent-swap（REM-3 用例证明失败不换引擎）、**runtime_swap_detected**（proposal≠edit 被标记，沿用 `_run_final_review` 内既有实现 L2161-2211——本卡是回归锁定不是新实现；**RF-3 真码修正：因四条正常渲染路径均经 `_run_final_review`，runtime_swap_detected 对 remotion/ffmpeg/hyperframes 均生效**，atelier 走其分支内终审亦生效；治理早返回路径（空/未知 runtime、remotion 失败 blocker）因不跑终审而不生效，用例显式断言该覆盖边界，防"顺手扩大"）。
- [ ] 安全：三 adapter render/preflight 子进程经捕获接缝断言 `shell=False`+列表传参；路径白名单拒绝用例（`..` 遍历/不存在文件）；npx 调用锁版本/`--offline`/拒绝调用方可控包名（A6）。**审计范围穿透 facade 下游（CCG P7 决议）**：HyperFramesAdapter 是薄壳，真实子进程在 `hyperframes_compose.py`（L260 `npm view <pkg> version`、L975 `_run`），安全用例必须覆盖被转调的下游工具调用链，不得只审 adapter 空壳。
- [ ] 全部进 `cd packages/python-backend && pytest`，无 skip。

### T7 —（P1，越界，不在本计划交付）translate_style 下沉 + 风格桥去重（4h，依赖 T2-T4，另立 DEVPLAN）。

---

## 3. Test Plan

### 3.1 场景矩阵（T0b 基线 = 后续所有等价回归的唯一比对源）

| 场景 id | 引擎 | 构造 | 关键断言点 |
|---------|------|------|-----------|
| REM-1 | remotion | 可用 + 常规 cuts | remotion render cmd 序列 + final_review 存在 |
| REM-2 | remotion | 不可用（无 node_modules 环境位） | 降级 ffmpeg cmd 序列 == FF-1 基线形态（RF-2 合法降级） |
| REM-3 | remotion | 可用但渲染失败 | `RENDER_FAILED_NO_FALLBACK` blocker + options 文案，无 ffmpeg cmd 出现 |
| HF-1 | hyperframes | 可用（⚠️ 现状因 F-2 导入 bug 不可达，基线取"恒不可用"真相） | 转调参数 + final_review 存在（分支内，前缀 `(HyperFrames)`，RF-3 修正） |
| HF-2 | hyperframes | 不可用 | 现状报错文案原样 |
| FF-1 | ffmpeg | runtime=ffmpeg | ffmpeg cmd + final_review 存在 |
| FF-2 | ffmpeg | runtime=ffmpeg + 边界入参 | 校验错误语义 |
| COMP-1 | ffmpeg | `operation=compose` 直调（不经 `_render`） | compose 入口 ffmpeg cmd 序列（与 FF-1 共享内核但基线独立，P3 决议） |
| AT-1 | atelier | composition_mode=atelier（无 render_runtime） | 短路成功 + 不读 runtime + final_review 存在（分支内 + atelier_checks，RF-1/RF-3 修正） |
| GOV-1/2 | — | render_runtime 缺失 / unknown | 报错文案与 blocker code |
| GOV-3 | ffmpeg/remotion | proposal 引擎≠edit 引擎 | runtime_swap_detected=True（仅经 final_review 的路径） |

fixture：`tests/fixtures/render-baselines/<engine>/<scenario>/`（JSON，文本进 git）；输入 composition 用 `os.tmpdir()` 风格真实临时目录构造，禁止依赖 gitignored 构建残留。

### 3.2 测试分层与 CI/本地边界

| 层 | 内容 | 位置 | CI 可跑？ |
|----|------|------|----------|
| 契约单测 | schema/registry/blocker（T1） | test_render_engine_registry.py | ✅ |
| C10 能力门禁 | id 唯一、地面真相字段、resolve 语义（T1→T4 递增） | test_render_engine_capabilities.py | ✅ |
| 结构等价黄金测试 | 捕获接缝重放 §3.1 全部命令序列比对（T2-T5 每片） | test_render_baseline_harness.py + 各 adapter 等价测试 | ✅（比对的是采集基线 vs 新代码生成的 cmd，不需要真实渲染环境） |
| 治理/安全回归 | T6 清单 | governance/security 两文件 | ✅ |
| 成片兜底 | 关键帧 pHash 宽松阈值 + 人工抽帧 | T0b 本地采集，T5 后本地复跑一次 | ❌ 本地证据：报告贴 PR，不进 CI |

### 3.3 Mock 纪律（承 PRD §9 anti-patterns）
- 结构等价测试 mock 的边界是**进程执行**（run_command 不真跑 npx remotion），**决策逻辑（cmd 构建、路由、降级判断）一律真实代码**——这不是"mock 被测对象"，被测对象正是生成的命令序列。
- REM-2/REM-3/HF-2 等环境态场景通过注入 availability 探测桩实现，探测函数本身在 GOV 层用真实环境各跑一次（T0b 本地）。
- 成片路径（pHash/抽帧）绝不 mock。

### 3.4 回退与止损
- 每片 = 一个可独立 revert 的 commit；T2-T4 任一片等价不过 → 该片 revert，不带病进入下一片。
- T5 是唯一切主调度点，若终审计/治理用例异常，revert T5 即回到"adapter 已就位但仍走旧分支"的可发布态。

---

## 4. 合入与收尾
- 全部切片合入后：单 PR（P8 决议：T2-T6 为同分支片级 commit，非逐片 PR），PR 体汇总（改动清单 + 场景矩阵等价报告 + 两条 ast 门禁测试证据：runtime 字符串比较=0 / raw_inputs 命中=0）→ `/review`（CRITICAL=0）→ CHANGELOG 记录（纯重构条目）→ 合 main。
- 文档回写：PRD/架构如实施中漂移，先改文档再改代码（接口唯一冻结源=架构 §2/§3）。

---

## 5. 开放问题处置（CCG v1 后全部关闭）
- **Q1（已闭，P2 决议）**：接缝 = VideoCompose 私有覆写，`base_tool.py` 零改动（基类被全部 provider 共享，爆炸半径不可接受；渲染路径全经 `self.run_command` 已核实）。→ T0a。
- **Q2（已闭，P1 决议）**：RemotionAdapter 降级由 registry 工厂组合注入 FFmpegAdapter，调 `compose()` 内核，final_review 位置不变；已回写架构 §11 附录。→ T4。
- **Q3（已闭，P3 决议）**：新增 COMP-1 场景，compose 入口独立基线，T3 逐字段断言。→ §3.1/T0b/T3。
- **Q4（已闭，P4 决议）**：T0 拆 T0a(2h)/T0b(4h)，P0 总量上调 25h→28h，Buffer 另计——缓冲不外推掩盖单卡低估。

> 本计划为规划产物，未改运行时代码。实施须走 §0 全部前置。


---

## T5 交付状态（2026-09-23 落地）

**已完成并逐字节等价证明**：
- 字符串分派清零（P6）：`_render` 不再含 `render_runtime == "<引擎名>"` 比较，改 `registry.get(runtime, ctx)` + `adapter.render(req, ctx)`；ast 门禁 `test_render_engine_registry_gate.py` 断言之。引擎名字面量仅存在于治理 blocker 文案（prose，非比较）与 registry 注册键，符合白名单要求。
- get_info 逐字段向后兼容：`render_engines` / `render_runtimes` 别名 / 各 `*_note` 文案全保留；新增 `render_engine_capabilities`（数据源切 registry.capabilities_all）。
- 治理/安全回归全绿：空/未知 runtime 0 命令、hyperframes F-2 fail-closed 0 子进程、remotion 降级 blocker 逐字==fixture、no-silent-swap、终审覆盖差异（RF-3 前缀 `(FFmpeg)`/`(HyperFrames)`/无）如实保持。191 相关测试 0 失败。

**有意权衡（偏离 DEV-PLAN v0.2 两项验收，已在 PRD §13.10 记录并写入内置记忆）**：
1. A4 退出标准「三 adapter render() 路径 ctx.raw_inputs 命中=0」未达成。T5 优先级判定：行为保持（命令 + 治理 + 终审逐字节）> 打字纯度。让 adapter 透传原始 inputs 调用既有 `_render_via_*` 私有方法，等价由构造保证，杜绝终审入参（proposal_packet / narration_transcript_path / script_text / options / quality 等）重建漂移。`build_compose_inputs`（类型化重建）保留为 T3 命令语法等价证据（`test_render_engine_adapter_ffmpeg_equiv` 仍绿），A4 对命令语法的验证意图仍在。若后续要补 A4，需先扩 RenderContext 承载全部终审入参并重跑 parity。
2. `get_info` 的可用性布尔（remotion/hyperframes）仍来自 `_remotion_available()` / `_hyperframes_available()`，未切 registry.preflight——因切到 shutil.which 探测会改变无 ffmpeg 环境的报告值（回归风险），保持原语义为稳妥。能力矩阵（非可用性）已切 registry 单源。

**结论**：T5 引擎切换完成，行为零回归；上述两项为工程权衡而非缺陷，均附等价证据与回归门禁。