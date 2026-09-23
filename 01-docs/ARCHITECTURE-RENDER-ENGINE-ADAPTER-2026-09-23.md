# 架构设计：统一渲染引擎 Adapter（RenderEngineAdapter）

- **编号**：ARCH-RENDER-ENGINE-ADAPTER-2026-09-23
- **阶段**：质量节拍 Phase 1.1（架构师）
- **上游**：`01-docs/PRD-RENDER-ENGINE-ADAPTER-2026-09-23.md` v0.2（已 CEO 签字）
- **状态**：修订 v0.2 —— 已经过 CCG 对抗评审（1 轮收敛，`.adversarial/render-engine-adapter-arch-20260923/`）—— 待确认进入 Phase 1.3 开发计划
- **目标**：把 PRD 的接口契约细化为决策完备、可实现、行为保持的架构；收敛 PRD 遗留 L3（C10 门禁复用、C11 registry DI）。

---

## 0. 现状精确模型（真码核实，架构必须逐一承接）

`video_compose.py::VideoCompose(BaseTool)` 的 `operation` 入口：`compose`(FFmpeg) / `render`(路由器) / `remotion_render` / `burn_subtitles` / `overlay` / `encode`。**`_render` 是治理路由器**，其真实控制流（L1340-1490）为：

```
_render(inputs):
  ① atelier 短路：composition_mode=="atelier" 或 renderer_family=="bespoke"
        → _render_via_atelier(...)      # 不要求 render_runtime，早于任何 runtime 检查返回
  ② asset_manifest 必填校验；cuts 非空校验；resolved_cuts（asset id→path）
  ③ _pre_compose_validation 前置门
  ④ render_runtime = edit_decisions.render_runtime.strip().lower()
       空 → ToolResult(success=False, 治理文案)         # 缺失即违规
  ⑤ "hyperframes" → _render_via_hyperframes(...)  # 委派后在其【函数内部】跑终审，成功/失败各自 return（不回到 ⑦）
     "ffmpeg"      → _render_via_ffmpeg(...)      # 同样在其函数内部跑终审后 return
     != "remotion" → ToolResult(success=False, Unknown render_runtime)
     "remotion":
        if _needs_remotion(resolved_cuts):
            _remotion_render(...)
            失败 → ToolResult(success=False, 治理 blocker)   # ⛔ 绝不静默降级 ffmpeg（此早返回不跑终审）
        else:
            _compose(...)                                    # 简单场景走 FFmpeg（在同一 remotion runtime 声明内）
  ⑦ [仅 remotion 分支] render_result.success 且产物存在 → _run_final_review(...)  # 横切终审，挂到 ToolResult.data
```

**三个必须原样承接、不得"顺手统一"的行为事实（行为保持红线）：**

- **RF-1 atelier 正交于 render_runtime**：它在 ① 步早返回，**不读 render_runtime**。重构后 `resolve()` 必须保持"atelier 优先短路"的判定顺序，否则给 bespoke 草稿强塞 render_runtime 会改行为。
- **RF-2 remotion 分支内非对称降级**：`_needs_remotion` **仅当 Remotion 不可用时**返回 False → 走 FFmpeg `_compose`（这是 remotion runtime 对"引擎未安装"的合法可用性降级）；但 Remotion **可用而渲染失败**时**禁止**降级（治理 blocker，见 L1442 注释）。两种"走 ffmpeg"语义完全相反，adapter 必须分别建模，不可合并成统一"fallback"。
- **RF-3 `_run_final_review` 覆盖差异＝"位置与文案前缀不同"，而非"有无不同"（真码核实，2026-09-23 实现期修正）**：`_render` 的四条正常渲染路径 **全部会执行终审**，差别只在终审调用点与失败文案前缀：① hyperframes 在 `_render_via_hyperframes` **函数内部**（video_compose.py L1610-1631，失败前缀 `FAILED (HyperFrames)`）；② ffmpeg 在 `_render_via_ffmpeg` **函数内部**（L1668-1688，前缀 `FAILED (FFmpeg)`）；③ remotion 在 `_render` **外壳** ⑦ 段（L1494-1519，**无前后缀**）；④ atelier 在 `_render_via_atelier` 函数内部（另加 `_run_atelier_checks`）。**唯一不跑终审的是治理早返回**：remotion 可用但渲染失败时的 `RENDER_FAILED_NO_FALLBACK` blocker（L1457）、空/未知 runtime、前置校验失败——这些在产物生成前就 return。⚠️ 早期版本误记为"hyperframes/atelier 不经过终审"，已按真码订正；基线（T0b）与 §5.3、DEV-PLAN §3.1/AT-1/HF-1 断言据此修正为"四类路径终审计均存在，差异在位置与前缀"。行为保持要求：重构后必须原样保留各路径终审的存在性、调用位置语义与失败文案前缀（不"顺手统一"）。

`get_info()`（preflight，L261-332）：`render_engines={ffmpeg:True,remotion:ok,hyperframes:ok}` + 别名 `render_runtimes` + 各引擎 `*_note` 散文 + `runtime_governance` 散文。探测靠 `_remotion_available()`（npx+composer 工程+node_modules）、`_hyperframes_available()`（可 import + doctor）。

`HyperFramesCompose(BaseTool)`（1015 行，独立工具，operations: doctor/scaffold_workspace/lint/validate/render/add_block）——`_render_via_hyperframes` 实为转调它。故 **HyperFramesAdapter = 对它的薄 facade**（PRD C5）。

provider 侧 `BaseAdapter`（`apps/desktop/electron/services/adapters/_base/base.js`）范式：`KNOWN_METHODS` 白名单 + `supports(method)` 自动探测子类覆盖 + `capabilities()` 扫描 KNOWN_METHODS + `ADAPTER_VERSION`（registry 注册时查兼容）+ config 拆 credentials/options。**本次同构平移这套纪律到渲染引擎（语言不同、域不同，复用范式不复用代码）。**

---

## 1. 模块布局（新增目录，全部在 worktree 内实现）

```
packages/python-backend/src/multi_publish/video_creation/providers/video/engines/
├── __init__.py
├── capabilities.py     # EngineCapabilities + 各引擎常量（单一来源）
├── context.py          # RenderContext / RenderRequest / RenderResult
├── result.py           # PreflightResult / ValidationResult / StructuredBlocker
├── base.py             # RenderEngineAdapter ABC
├── registry.py         # RenderEngineRegistry（工厂 + resolve 决策）
├── remotion_adapter.py # 含 _needs_remotion 可用性非对称降级（A3：atelier P0 不转 adapter）
├── hyperframes_adapter.py  # 薄 facade → HyperFramesCompose
└── ffmpeg_adapter.py   # 原 _render_via_ffmpeg / _compose 内核
```

`video_compose.py` **保留为 BaseTool 外壳**（name/operation schema/get_info 兼容输出不变），`_render` 内部改为向 registry 委派；atelier/终审计等**编排职责留在 video_compose**，不进 adapter（见 §5）。

---

## 2. 数据结构（Python dataclass，最终 schema）

```python
# capabilities.py
@dataclass(frozen=True)
class EngineCapabilities:
    id: str                         # "remotion" | "hyperframes" | "ffmpeg" | "atelier"
    name: str
    upstream_version: str           # ADAPTER_VERSION 对位，registry 兼容校验
    paradigms: tuple[str, ...]      # ("react-component",) / ("html-css-gsap",) / ("filtergraph",)
    output_formats: tuple[str, ...] # ("mp4",)
    max_resolution: tuple[int, int] # (3840, 2160) 等，逐引擎取真值
    word_level_captions: bool       # remotion=True（caption_burn 事实）；其余 False
    native_transitions: bool
    unavailable_fallback: Optional[str]  # remotion="ffmpeg"(仅引擎缺失时降级) / hyperframes=None / ffmpeg=None / atelier=None
    requires_cmd: tuple[str, ...]   # ("npx","remotion") / ("npx","hyperframes") / ("ffmpeg",)
    requires_env: tuple[str, ...]   # ("node>=22",) 等 doctor 前置
    # —— 原 runtime_governance/各 note 散文降级到此，仍供人读 ——
    notes: str = ""

# context.py
@dataclass(frozen=True)
class RenderContext:
    output_path: Path
    profile: Optional[dict]         # resolution/fit 等（compose_target 归一后）
    asset_lookup: dict[str, dict]   # id -> asset info（resolved_cuts 前置）
    proposal_packet: Optional[dict] # 供 runtime_swap 比对
    raw_inputs: dict                # 逃生舱：仅过渡期只读；禁承载已被本 dataclass 字段表达的入参（A4）；T5 退出标准=三 adapter render 路径 raw_inputs 命中为 0

@dataclass(frozen=True)
class RenderRequest:
    edit_decisions: dict       # 原始（cuts 可含未解析 asset id），仅供元数据/治理字段
    resolved_cuts: list[dict]  # 权威 cuts：asset id 已解析为路径；adapter 一律读此（A2）
    asset_manifest: dict

@dataclass
class RenderResult:
    success: bool
    output_path: Optional[Path]
    error: Optional[str] = None
    blocker: Optional["StructuredBlocker"] = None   # 治理类失败用结构化 blocker
    data: dict = field(default_factory=dict)         # 映射进 ToolResult.data
    # review_fail_label（实现期新增，A11）：T5 将三处终审收敛为统一块时，用此字段逐字
    #   承载失败文案前缀差异（"(HyperFrames)" / "(FFmpeg)" / ""），使行为与现状 byte-identical。
    #   默认 ""（remotion 外壳路径无前缀）。hyperframes/ffmpeg 若终审仍留在各自分支函数内，
    #   此字段可保持默认，仅统一收敛方案需要。
    review_fail_label: str = ""
    # 注意：不含 duration_seconds —— 由 video_compose 外壳统一计时（保持现有 execute 计时语义）

# result.py
@dataclass(frozen=True)
class PreflightResult:
    available: bool
    reason: str = ""                # 不可用原因（承接 *_note 的否定分支）
@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    reason: str = ""
@dataclass(frozen=True)
class StructuredBlocker:
    code: str                       # "UNKNOWN_RUNTIME" | "RUNTIME_MISSING" | "RENDER_FAILED_NO_FALLBACK" | "RUNTIME_SWAP" ...
    message: str
    options: tuple[str, ...] = ()   # 承接现状 Remotion 失败 blocker 的 3 选项文案
```

**ToolResult 边界**：`video_compose._render` 负责 `RenderResult → ToolResult(success/error/data, duration_seconds)` 映射，adapter **不直接产 ToolResult**，保证工具 schema 对外零变化。

---

## 3. RenderEngineAdapter ABC（P0 冻结契约）

```python
# base.py
class RenderEngineAdapter(ABC):
    capabilities: EngineCapabilities        # 类级声明（单一来源，见 §6 门禁）

    @abstractmethod
    def preflight(self, ctx: RenderContext) -> PreflightResult: ...
    @abstractmethod
    def validate(self, req: RenderRequest, ctx: RenderContext) -> ValidationResult: ...
    @abstractmethod
    def render(self, req: RenderRequest, ctx: RenderContext) -> RenderResult: ...
    # translate_style 不进 P0（PRD C6）；P1 再加。

    # 硬性安全约束（PRD C9）：render()/preflight() 内启动子进程一律
    #   subprocess.run([...], shell=False)；参数列表传；路径过白名单。禁字符串拼接 shell。
    #   供应链（A6）：`npx <pkg>` 调用必须锁版本/走本地 node_modules 解析（--offline），
    #   doctor/render 不接受调用方可控的任意包名参数（防 npx 拉取执行任意 npm 包）。
```

> **接口权威性（A5）**：本文档是渲染侧接口的**唯一冻结源**；PRD §4 的 `def capabilities(self)` 为示意伪代码，以本架构的**类属性 `capabilities: EngineCapabilities`** 为准（PRD 已加勘误链接）。

- `capabilities` 定为**类属性**（不是方法），对齐"能力是声明式静态数据"，也便于 §6 门禁静态扫描；provider BaseAdapter 的 `capabilities()` 是方法（因 JS 动态探测），此处 Python 用 frozen dataclass 更合适——差异在 §6 说明。

---

## 4. RenderEngineRegistry（收敛 PRD C11：工厂 + 决策优先级）

```python
# registry.py
class RenderEngineRegistry:
    def __init__(self):
        self._factories: dict[str, Callable[[RenderContext], RenderEngineAdapter]] = {}
    def register(self, id: str, factory): ...           # 注册工厂，不注册实例（无跨调用子进程态）
    def get(self, runtime_id: str, ctx) -> RenderEngineAdapter | StructuredBlocker
        # 未知 id → StructuredBlocker(code="UNKNOWN_RUNTIME")，不抛、不静默换
    def resolve(self, edit_decisions, ctx) -> RenderEngineAdapter | StructuredBlocker:
        # 【A1 硬规则】resolve 只看 composition_mode + render_runtime 字符串，
        #   preflight()/validate() 绝不参与路由（它们只供 get_info 上报与 render 前置 fail-fast）。
        # 复刻 _render 真实现顺序（承接 RF-1）：
        #   1. composition_mode=="atelier" 或 renderer_family=="bespoke" → 由 _render 顶部短路直接调 _render_via_atelier（不经 registry，A3）
        #   2. render_runtime 空 → StructuredBlocker(code="RUNTIME_MISSING")
        #   3. 否则 get(render_runtime)  # remotion/hyperframes/ffmpeg；remotion 不可用仍照路由（降级在 adapter.render 内，RF-2）
    def preflight_all(self, ctx) -> dict[str, PreflightResult]   # 供 get_info 组装 render_engines
```

- **DI**：registry 由 video_compose 在 `__init__`/首次 `_render` 惰性构建并注入（配置：composer 目录、node/npx 探测结果）。adapter 实例**每次 render 按 ctx 现取**，不缓存有状态实例。
- **atelier（A3 收缩）**：P0 **不**抽 AtelierAdapter。`_render_via_atelier`/`_run_atelier_checks` 原样留在 video_compose 作为顶部短路，不进 registry；避免超 PRD 三引擎边界与扩大行为保持爆炸半径。atelier 转 adapter 另立后续项。

---

## 5. video_compose 委派后的编排职责（留在外壳、不进 adapter）

`_render` 变薄后仍由 video_compose 负责（横切、非引擎专属）：
1. atelier 短路决策 → **留在 `_render` 顶部原样不动**（RF-1、A3），不经 `registry.resolve()`。
2. `asset_manifest`/`cuts`/`resolved_cuts`/`_pre_compose_validation` 前置校验（跨引擎共用）。
3. `_run_final_review`（RF-3 修正版）：**位置与覆盖范围原样不动**——四条正常渲染路径均执行终审，但调用点不同：hyperframes/ffmpeg 的终审仍留在各自 `_render_via_*` 分支函数内（各自带 `(HyperFrames)`/`(FFmpeg)` 失败前缀），remotion 的终审留在 `_render` 外壳 ⑦ 段（无前缀）；治理早返回（remotion 失败 blocker、空/未知 runtime、前置校验失败）不跑终审。T5 若要把三处终审收敛为一个统一块，须用 `RenderResult.review_fail_label`（§2 扩展字段）逐字承载前缀差异，并用 T0b 基线锁死"终审存在+文案前缀+早返回不跑终审"三点，任一 diff 即 revert。
4. `RenderResult → ToolResult` + `duration_seconds` 计时。
5. `get_info()` 输出结构（`render_engines`/`render_runtimes`/各 `*_note`/`runtime_governance`）**逐字段等价**：由 `registry.preflight_all()` + 各 `capabilities.notes` 组装，字段名与文案保持向后兼容（proposal skill 读这些 key）。

> 删除的仅是 ⑤ 段的 `if render_runtime == "..."` 字符串分派（PRD F-P0-5/C8 可测承诺）。②③④⑦ 等前置/终审/计时逻辑**不动**。

---

## 6. 能力"单一来源"门禁（收敛 PRD C10）

provider 侧靠 JS 脚本 `.github/scripts/*` 守 `KNOWN_METHODS` 不重复 concat。**渲染侧不复用该 JS 脚本（语言/域不同），新建 pytest 契约门禁** `test_render_engine_capabilities.py`，复用同一"纪律"：
- 断言每个 adapter 的 `capabilities.id` 唯一、在 registry 注册且只注册一次（无重复 concat）。
- 断言 `word_level_captions` 等关键字段与"地面真相"一致：remotion 必须 True（因 `remotion_caption_burn` 存在）、hyperframes/ffmpeg 必须 False。
- 断言 `resolve()` 对未知/缺失 runtime 返回对应 `StructuredBlocker.code`。
- 该门禁进 `cd packages/python-backend && pytest`（既有门禁），无需新增 CI job。

结论：**C10 = 新建 Python 契约测试承接，不复用 JS gate**；文档写明两侧共用"能力单一来源"心智但落地机制各自独立。

---

## 7. 关键设计决策与权衡（ADR 摘要）

| # | 决策 | 理由 | 被否方案 |
|---|------|------|---------|
| D1 | atelier P0 **不**转 adapter，原样留 orchestrator 短路 | 超已签字 PRD 三引擎 P0 边界；_render_via_atelier 逻辑重、覆盖弱，行为保持下风险>收益（CCG A3） | 抽为第 4 adapter（原 v0.1 方案）→ 扩大爆炸半径，已回退 |
| D2 | `_needs_remotion` 非对称降级留在 RemotionAdapter.render 内 | 可用性降级(引擎缺失→ffmpeg) 与 失败禁降级(可用但报错→blocker) 语义相反（RF-2） | 抽到编排层当通用 fallback → 语义错误、会把"失败"也静默降级 |
| D3 | `_run_final_review` 留外壳、覆盖范围原样保留 | 行为保持红线（RF-3）；统一加终审=改行为 | "顺手"给全引擎加终审 → 违反黄金标准 |
| D4 | capabilities 用 frozen dataclass 类属性 | Python 静态声明、可被门禁扫描 | 照搬 JS `capabilities()` 方法探测 → 无必要且难校验 |
| D5 | adapter 不产 ToolResult，外壳映射 | 对外工具 schema 零变化、duration 计时语义不动 | adapter 直返 ToolResult → 耦合工具层、计时漂移 |
| D6 | C10 新建 pytest 门禁而非扩用 JS gate | 域/语言不同，扩用会污染 provider 门禁 | 强行复用 JS 脚本 |

---

## 8. 与 PRD 验收/测试的对接

- **PRD C1（结构等价）**：T0 基线采集每引擎的"渲染命令/参数 + composition JSON + manifest + ffmpeg cmd"结构等价物；atelier/final_review 覆盖差异纳入基线（防重构意外改 RF-3）。
- **治理回归（T6）**：locked/no-silent-swap/**runtime_swap_detected（比对 `ctx.proposal_packet.production_plan.render_runtime` vs `edit_decisions.render_runtime`）**/缺失报错/preflight 逐引擎/slideshow_risk。
- **安全（T6）**：三 adapter 子进程调用 shell=False + 路径白名单用例。
- **能力漂移**：§6 pytest 门禁断言关键字段。

---

## 9. 实现顺序映射（对齐 PRD T0-T7，含本架构新增切片）

- T0 基线（须覆盖 atelier 与 final_review 覆盖差异；**含"子进程调用捕获接缝"——复用 base_tool.run_command 记录入参，A7**）→ T1 capabilities/context/result/base/registry 骨架 → T2 HyperFramesAdapter(facade) → T3 FFmpegAdapter → T4 RemotionAdapter(含 RF-2 可用性非对称降级) → T5 `_render` 委派变薄（保 §5 编排 + atelier 短路不动；**raw_inputs 命中=0 验收**）→ T6 治理+安全回归（含 **npx 供应链用例 A6**）→ T7(P1) translate_style。
- 总估时回到 PRD 的 ~25h（A3 删 T4b）；另留集成/CI 烧合 Buffer（参考 CCG 前例严重低估教训，建议 +50%）。

---

## 10. 开放问题（交 CCG 评审 / Phase 1.3）
- Q1（已回读校准）：`_needs_remotion` 仅按"Remotion 是否可用"判定（非内容类型），故 RF-2 用 `unavailable_fallback` 字段表达；仍需回读 L1194 之后完整实现确认无内容类型分支。
- Q2：`RenderContext.raw_inputs` 逃生舱会不会沦为"什么都不归一"的挡箭牌，使变薄目标落空？需约束其退出计划。
- Q3（已解）：A3 后 atelier 不转 adapter，无复用边界问题；若后续转，建议组合（持 RemotionAdapter 引用而非继承）。

## 11. 附录：Phase 1.3 开发计划 CCG 回写的架构级决策（2026-09-23，`.adversarial/render-engine-dev-plan-20260923/`）

- **A8（P1 决议）跨 adapter 降级依赖**：registry 注册 Remotion 工厂时组合注入 FFmpegAdapter 工厂；`RemotionAdapter.render` 在 `_needs_remotion==False` 时调 `ffmpeg_adapter.compose()`（FFmpegAdapter 暴露 `render()`/`compose()` 双内核，分别对应 `_render_via_ffmpeg` 与 `operation=compose`/降级共用的 `_compose`）。RenderResult 照常返回，外壳 ⑦ final_review 位置不变（现状 remotion-else 路径本就经 ⑦）。禁用直接 import 单例（可测性）。
- **A9（P2 决议）子进程捕获接缝落点**：接缝 = `VideoCompose` 私有覆写 `run_command` + 可选 capture 回调，`base_tool.py` 零改动（基类被 video_creation 全部 provider 共享，行为保持任务不得扩大爆炸半径）。
- **A10（P5 决议）get_info 数据源在 P0 内切换**：`render_engines`/`render_runtimes` 由 `registry.preflight_all()` 组装、文案取 `capabilities.notes`，字段名与文案逐字保留；否则 §5.4 的单一来源承诺在 get_info 侧无落点。

## 12. 实现期核实发现（2026-09-23，T0a/T1 落地时真码核实，已回写）

- **F-1（RF-3 订正）**：见 §0/§5.3——四条 `_render` 正常路径全部执行终审，差异在调用点与失败文案前缀（`(HyperFrames)`/`(FFmpeg)`/无前缀），仅治理早返回不跑终审。原 v0.2 "hyperframes/atelier 不经过终审" 表述有误，据真码（video_compose.py L1610-1631、L1668-1688、L1494-1519）订正。
- **F-2（HyperFrames 导入路径 latent bug，行为基线关键事实）**：`_hyperframes_available`（L268）与 `_render_via_hyperframes`（L1554）用 `from multi_publish.video_creation.video.hyperframes_compose import HyperFramesCompose`，但真实模块路径为 `multi_publish.video_creation.providers.video.hyperframes_compose`（`video_creation` 下无 `.video` 子包）。`python -c` 已证实前者 `ModuleNotFoundError`。该 import 被外层 `except Exception` 吞掉 ⇒ 经 `video_compose` 路由时 **hyperframes 恒判不可用、`_render_via_hyperframes` 恒返回 `Could not import` 错误**。**行为保持基线必须以此真相为准**：HF-"可用"场景在当前代码不可达（`get_info.render_engines.hyperframes` 恒为 False）。T2 facade 迁移时若要顺带修此路径 bug，属**改行为**，须单列并附回归说明，不得混入行为保持切片。已存入内置记忆（common_pitfalls）。
- **F-3（Q1 结论确认）**：`_needs_remotion`（L1189-1227）确认为"Remotion 不可用→False，其余一律 True"，无内容类型否决分支；RF-2 用 `unavailable_fallback` 字段表达，T4 无额外内容判定。
- **F-4（接缝落点）**：T0a 落地为 `VideoCompose._cmd_capture` 类属性（默认 None）+ 私有 `run_command` 覆写，在 `super()` 前记录逻辑 argv（未经 `base_tool.run_command` 的 Windows `shutil.which` 改写）+ cwd + timeout，基线跨机稳定；`base_tool.py` 零改动（A9/P2）。默认 None 时 61 个既有 video_compose 测试零修改全绿。

> 本文档为规划/架构产物，未改运行时代码。实现须走 worktree 隔离 + TDD + QM 门禁 + Code Review。开发计划见 `01-docs/DEV-PLAN-RENDER-ENGINE-ADAPTER-2026-09-23.md` v0.2（已过 CCG）。
