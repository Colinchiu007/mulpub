# PRD：统一渲染引擎 Adapter（RenderEngineAdapter）

- **编号**：PRD-RENDER-ENGINE-ADAPTER-2026-09-23
- **优先级**：P0（视频创作模块架构奠基项，源自整合规划方案 G1）
- **阶段**：质量节拍 Phase 0.3（PRD）→ 待 Phase 1.1 架构细化
- **状态**：修订 v0.2 —— 已经过 CCG 对抗评审（1 轮收敛，`.adversarial/render-engine-adapter-prd-20260923/`），**待 CEO 签字**
- **作者角色**：PM
- **关联**：`~/projects/research/ai-video-agent/integration-plan.md` §3.1、`reuse-checklist.md`
- **参考实现（许可证干净）**：html-video `EngineAdapter` RFC-01（Apache-2.0）；MP 自家 `BaseAdapter` capability 单一来源范式（`apps/desktop/electron/services/adapters/base.js`，QM 门禁背书）

---

## 1. 背景与问题（现状核实）

Multi-Publish 视频成片有三条渲染后端，选路集中于 `packages/python-backend/src/multi_publish/video_creation/providers/video/video_compose.py`（**2551 行**），按 `edit_decisions.render_runtime` 分派。**精确现状**（经 CCG 评审 C5 校正）：HyperFrames 已委派给独立工具 `hyperframes_compose.py`，真正内联在 video_compose 里的是 remotion 与 ffmpeg 路径；问题不是"三后端全内联"，而是"三条路径无统一契约、能力散文化"：

| render_runtime | 落地方式 | 相关文件 |
|----------------|---------|---------|
| `remotion` | `npx remotion render`（React 组件逐帧渲染） | video_compose.py 内联 + `remotion_caption_burn.py` |
| `hyperframes` | `npx hyperframes`（HTML/CSS/GSAP，已集成 heygen/Apache-2.0） | `hyperframes_compose.py`（1015 行，lint/validate/render/doctor/scaffold） |
| `ffmpeg` | FFmpeg 合成 | `video_compose.py` / `video_stitch.py` |

**既有优点（须保留）**：
- `render_runtime` 在 proposal 阶段锁定、全程不变，**禁止静默切换**（`runtime_governance`）；缺失即治理违规报错。
- preflight 分别上报每个 runtime 可用性；`slideshow_risk.py` 接收 `render_runtime` 做维度评分。
- 风格桥 `lib/hyperframes_style_bridge.py`：同一份 OpenMontage playbook YAML → remotion 转 `themeConfig`、hyperframes 转 CSS 变量。

**核心问题（本 PRD 要解）**：
1. **选路是字符串 if/elif**（remotion/ffmpeg 内联，hyperframes 经转调），引擎专属逻辑（可用性、能力、校验、渲染）**没有统一接口**。
2. **引擎能力是散文描述**（`runtime_governance` 是给人读的大段文字），agent 在 proposal 阶段无法**程序化**按 capability 决策"这个用例选哪个引擎"。
3. **加一个新引擎要改核心**（违反开闭原则），未来接 Motion Canvas / Revideo 等成本高。
4. **风格转换按引擎各写一份**，remotion/hyperframes 路径重复，新引擎要再重复。
5. MP 发布侧/provider 侧**已有** `BaseAdapter`（`KNOWN_METHODS`/`capabilities()`/`supports()`/`validateConfig()`）并被 QM 门禁"Adapter capability 单一来源"强制守护——**渲染侧却是这套范式的盲区**，认知与工具都割裂。

---

## 2. 目标用户与价值

| 用户 | 价值 |
|------|------|
| 创作 Agent（proposal 阶段选引擎） | 用结构化 `capabilities()` 编程化选引擎，不再靠读散文猜 |
| 平台开发者（加/维护引擎） | 加引擎=加一个 adapter 类，不动 video_compose 核心 |
| CTO / Review | 渲染侧与 provider 侧共用同一套 adapter 契约与 CI 门禁，审查心智统一 |
| 终端创作者 | 间接获益：引擎能力边界更清晰，避免"选了不支持逐字字幕的引擎"这类静默劣化 |

**一句话**：把已验证有效的 `BaseAdapter` capability 单一来源范式平移到渲染引擎，用统一 `RenderEngineAdapter` 契约收敛三后端，消除字符串选路与能力散文，且不改变既有治理语义（锁定、禁静默切换、preflight、slideshow risk 全保留）。

---

## 3. 功能列表（MoSCoW）

### P0（必须，本 PRD 交付边界）
- **F-P0-1 `RenderEngineAdapter` 抽象基类**（Python）：定义
  `id` / `name` / `upstream_version` / `capabilities()` / `validate(composition)` / `render(request, ctx)` / `preflight()`。可选 `preview()`（默认 NotSupported）。**`translate_style` 不进 P0 ABC**（避免无消费者占位抽象，随 P1 引入）。
- **F-P0-2 三个引擎实现**：`RemotionAdapter` / `HyperFramesAdapter` / `FFmpegAdapter`，把 video_compose 内现有的按引擎分支逻辑搬进各自 adapter，**行为保持（behavior-preserving refactor）**。其中 **`HyperFramesAdapter` = 对现有 `hyperframes_compose.py` 工具的薄 facade（转调，不重写、不叠第二层业务）**，避免"Compose 工具 + Adapter"双层抽象。
- **F-P0-3 `RenderEngineRegistry`**：注册/发现 adapter；按 `render_runtime` 取 adapter；未知 runtime → 结构化 blocker（保留现有 fail 语义）。
- **F-P0-4 结构化 `EngineCapabilities`**：声明式数据（支持范式、输出格式、maxResolution、是否支持逐字/卡拉OK字幕、是否支持 3D/粒子、依赖命令如 `npx remotion`/`npx hyperframes`/`cmd:ffmpeg`）。取代 `runtime_governance` 散文（散文降级为 capabilities 的 `notes` 字段）。**P0 即有消费者（非死数据）**：`preflight()` 读 `requires_cmd` 校验依赖、`validate()` 读 `word_level_captions`/`native_transitions` 判定某 composition 能否走该引擎、治理文案取 `notes`；`recommend()` 面向上游选路留 P1。
- **F-P0-5 video_compose 变薄**：主流程改为 `adapter = registry.get(render_runtime); adapter.validate(...); adapter.render(...)`；**删除**散落的 `if render_runtime == "..."` 分支。
- **F-P0-6 治理语义不变**：locked-at-proposal、no-silent-swap、**runtime_swap_detected 比对（proposal_packet.production_plan.render_runtime vs edit_decisions.render_runtime，拦中途换引擎）**、缺 render_runtime 报错、preflight 逐引擎可用性上报，全部由 adapter 契约承接，回归测试锁定。

### P1（应做，可拆后续迭代）
- **F-P1-1 风格桥统一入口**：`translate_style(playbook)` 收进各 adapter，消除 remotion/hyperframes 重复实现，公共部分下沉基类。
- **F-P1-2 proposal 阶段 capability 驱动选引擎**：暴露 `registry.recommend(composition_requirements)` 供上游 skill 编程化决策。

### P2（可做，明确非本次）
- **F-P2-1 新引擎接入模板**（Motion Canvas/Revideo 等，仅保证"加 adapter 不改核心"这条路径通畅，不实际引入）。
- **F-P2-2 `preview()`（本地预览 server）** —— 与整合方案 G2（前端 WebCodecs/渲染队列）合流，不在本 PRD。

### 非目标（Out of Scope，防范围蔓延）
- ❌ 不新增任何渲染引擎（只重构选路架构）。
- ❌ 不做前端 WebCodecs 导出（G2/P2）。
- ❌ 不做对话式分镜 Agent（G5/P2）。
- ❌ 不改生成 provider（image/audio/video 各 provider 不动）。
- ❌ 不改变最终产物像素/编码结果（纯架构重构，行为等价）。

---

## 4. 接口契约（架构级，供 Phase 1.1 细化）

```python
# engines/base.py（新增）
@dataclass(frozen=True)
class EngineCapabilities:
    paradigms: tuple[str, ...]        # "react-component" / "html-css" / "ffmpeg-filtergraph"
    output_formats: tuple[str, ...]   # "mp4" ...
    max_resolution: tuple[int, int]
    word_level_captions: bool         # 逐字/卡拉OK字幕（remotion 独有，见 remotion_caption_burn 约束）
    native_transitions: bool
    requires_cmd: tuple[str, ...]     # "npx remotion" / "npx hyperframes" / "ffmpeg"
    notes: str = ""                   # 原 runtime_governance 散文降级到此

class RenderEngineAdapter(ABC):
    id: str
    name: str
    upstream_version: str
    @abstractmethod
    def capabilities(self) -> EngineCapabilities: ...
    @abstractmethod
    def preflight(self) -> PreflightResult: ...          # 逐引擎可用性（承接现有逻辑）
    @abstractmethod
    def validate(self, composition) -> ValidationResult: ...  # fail-fast + reason，不实际渲染
    @abstractmethod
    def render(self, request: RenderRequest, ctx: RenderContext) -> RenderResult: ...
    # translate_style(playbook) 不进 P0 ABC（CCG C6）；P1 引入。
    # 硬性约束（CCG C9）：render()/preflight() 内启动子进程必须参数列表传参、
    #   禁 shell=True 字符串拼接、路径过白名单；否则不得合并。

# engines/registry.py（新增）
class RenderEngineRegistry:
    def get(self, runtime_id: str) -> RenderEngineAdapter          # 未知 → StructuredBlocker
    def all(self) -> list[RenderEngineAdapter]
    def recommend(self, requirements) -> list[RenderEngineAdapter] # P1
```

> **接口权威性勘误（CCG-arch A5）**：上方 §4 为示意伪代码；渲染侧接口的唯一冻结源已转移至 `01-docs/ARCHITECTURE-RENDER-ENGINE-ADAPTER-2026-09-23.md`（capabilities 定为类属性、resolve 优先级、atelier 不转 adapter 等以架构为准）。

**与既有 `BaseAdapter`（provider 侧）的关系**：契约**同构但独立**——不合并（一个管外部生成 API、一个管本地渲染进程），但**沿用同一命名/测试纪律/capabilities 单一来源原则**，CI 门禁模式复用。

---

## 5. 数据流（重构前后）

```
重构前：video_compose.py(2551行)
  edit_decisions.render_runtime ──if "remotion"──► 内联 remotion 逻辑 ┐
                             ├─if "hyperframes"─► hyperframes_compose ├─► mp4
                             └─if "ffmpeg"──────► 内联 ffmpeg 逻辑     ┘
  （能力=散文；加引擎=改这个文件；风格转换=各写一份）

重构后：video_compose.py（薄调度）
  registry.get(render_runtime) ─► adapter.validate ─► adapter.render ─► mp4
                ▲                    ▲ RemotionAdapter / HyperFramesAdapter / FFmpegAdapter
   capabilities()/preflight()/translate_style() 各自内聚
  （治理不变：locked/no-silent-swap/preflight/slideshow_risk 由契约承接）
```

---

## 6. 开发计划（拆 ≤4h 任务，TDD）

> 全部在**独立 worktree** 进行（运行时代码：`packages/python-backend/`），`scripts/start-mp-task.ps1 -TaskName render-engine-adapter`。

| # | 任务 | 估时 | 依赖 | 类型 |
|---|------|------|------|------|
| **T0** | **（CCG C2）在干净 HEAD 上为三引擎各≥2 场景采集黄金基线**（结构等价物：渲染命令/参数、composition JSON、manifest、ffmpeg cmd + 关键帧 pHash） | 3h | — | 前置（**阻塞 T2-T5**） |
| T1 | `EngineCapabilities` + `RenderEngineAdapter` ABC + `registry` 骨架 + 单测 | 3h | — | 测试先行 |
| T2 | 抽 `HyperFramesAdapter`（**对 hyperframes_compose 薄 facade**）+ 等价性回归 | 4h | T0,T1 | 行为保持 |
| T3 | 抽 `FFmpegAdapter`（video_compose 内 ffmpeg 路径）+ 等价性回归 | 4h | T0,T1,T2 | 行为保持 |
| T4 | 抽 `RemotionAdapter`（video_compose 内 remotion 路径 + caption_burn 约束进 capabilities）+ 等价性回归 | 4h | T3 | 行为保持 |
| T5 | video_compose 改薄为 registry 调度，删字符串分支 | 3h | T2-T4 | 重构 |
| T6 | 治理语义回归锁定（locked/no-silent-swap/**runtime_swap_detected**/缺失报错/preflight/slideshow_risk）+ 子进程安全用例 | 4h | T5 | 回归 |
| T7 | （P1）translate_style 下沉基类 + 风格桥去重 | 4h | T2-T4 | 重构 |

**T2→T3→T4 串行**（CCG C3：同改 video_compose 2551 行单文件不可真并行，每片独立回归合入再下一片）。顺序：T0→T1→T2（拿最独立、已是工具的 hyperframes 做 pilot 验证契约合身）→T3→T4→T5→T6。总估时 25h（含 T0）；另留集成/CI 烧合 Buffer（参考前例严重低估，建议 +50%）。

---

## 7. 验收标准（可验证）

**功能等价（黄金标准，CCG C1 修正）**
- [ ] **主门禁 = 结构等价**：对同一组 fixture（覆盖三引擎各≥2 个 pipeline 场景），重构前后生成的**渲染命令/参数、composition JSON、hyperframes manifest、ffmpeg 命令**逐字段等价（不要求像素/bit 一致，因 headless 渲染+编码非确定）。
- [ ] **成片兜底 = 采样关键帧 pHash 宽松阈值 + 人工抽帧核对**（不做全帧像素 diff）。
- [ ] 现有 video_creation 全量单测 + pytest 门禁（`cd packages/python-backend && pytest`）**全绿**，无 skip 掩盖。

**契约正确**
- [ ] `registry.get("unknown")` 返回结构化 blocker（非崩溃、非静默换引擎）。
- [ ] 三 adapter 的 `capabilities()` 字段完整且各自与实际能力一致（如 `word_level_captions`: remotion=true、hyperframes=false、ffmpeg=false）。
- [ ] `preflight()` 逐引擎上报可用性与重构前 `render_engines`/`render_runtimes` 信息等价。

**治理不回归（关键）**
- [ ] `render_runtime` 缺失 → 仍报错（错误语义与现状一致）。
- [ ] proposal 锁定后不可被下游改；无 silent swap（有测试证明"选定引擎失败时不会自动换引擎，而是抛 blocker"）。
- [ ] **runtime_swap_detected**：proposal 引擎≠edit_decisions 引擎时被拦（与现状一致）。
- [ ] **子进程安全（CCG C9）**：adapter 启动子进程参数列表传参、无 shell=True 拼接；恶意路径/参数被拒的用例。

**代码质量**
- [ ] 主调度路径**移除全部 `if render_runtime ==` 分支（≥3 处）**，改为 `registry.get()`；本 PRD **不承诺整文件行数下降**（theme/audio/caption 等非引擎分派属后续切片），避免验收虚标（CCG C8）。
- [ ] 无对 provider 侧 BaseAdapter 的耦合/误合并。
- [ ] 通过 QM 门禁 + `/review`（CRITICAL=0）。

---

## 8. 非功能需求

- **可维护性**：加新引擎仅需 1 个 adapter 类 + registry 注册，不改 video_compose 核心（开闭原则）。
- **向后兼容**：`edit_decisions.render_runtime` 字段名与取值集合（remotion/hyperframes/ffmpeg）不变；proposal skill 读的 `render_runtimes` 别名保留。
- **错误处理**：所有 adapter 边界 fail-fast 带 reason，禁吞异常。
- **性能**：重构不应引入额外进程启动/序列化开销（等价性含时延不显著劣化）。
- **可观测**：渲染日志保留引擎归属与阶段（validate/render），便于排障。

---

## 9. 测试策略（回归保护重点）

- **等价性黄金测试**（TDD 核心，CCG C1/C2 修正）：**基线必须在重构前的干净 HEAD 采集（T0）**；断言粒度为"输入 composition fixture → 期望的渲染命令/参数 + 中间产物结构"重构前后等价，防止"行为保持"名义下偷偷改了渲染决策；成片侧只做关键帧 pHash 宽松阈值兑底，不做全帧像素 diff。
- **契约单测**：capabilities 字段完整性、supports/validate 边界、registry 未知 id、preflight 结构。
- **治理回归**：locked/no-silent-swap/缺失 render_runtime 三条专门用例（对应 AGENTS.md「静默 fallback between runtimes is forbidden」）。
- **风格桥**（T7）：playbook→themeConfig 与 →CSS props 两路等价性。
- 遵循 testing-anti-patterns：不 mock 被测渲染进程本身，用真实临时 fixture。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| "行为保持"重构实际改了像素（静默回归，freecut 同款高危） | 等价性黄金测试 + 人工抽帧核对，禁只靠 type-check/单测 |
| video_compose 2551 行抽取中漏搬逻辑 | 按引擎分 T2-T4 小切片，每片独立回归后再下一步；T5 才动主调度 |
| 抽契约过度设计（为不存在的引擎留抽象） | 明确非目标 F-P2-1 不做；抽象层只服务现有三引擎的实际差异 |
| 与并发会话改同文件冲突 | worktree 隔离 + `openspec/active-tasks.json` 登记 + 开工前扫同模块活跃 worktree |
| capabilities 与真实能力漂移 | 用 caption_burn/preflight 等既有事实反推校验；CI 断言关键字段 |
| 子进程参数注入（渲染 chokepoint，CCG C9） | 契约硬性要求列表传参/禁 shell=True 拼接/路径白名单；安全用例入 T6 |

---

## 11. 依赖

- 无第三方新依赖（纯内部重构）。
- 参考 html-video RFC-01（**Apache-2.0**，仅借接口设计，Python 重写，保留出处注释即可，无代码搬运）。
- 复用 MP 自家 BaseAdapter 的**测试模式**（非复用其代码，二者域不同）。

---

## 12. 审批

- [x] **CEO 已签字**（2026-09-23）→ 已进入 Phase 1.1 架构细化，产物见 `01-docs/ARCHITECTURE-RENDER-ENGINE-ADAPTER-2026-09-23.md`
- 签字：CEO  日期：2026-09-23

> 本 PRD 为规划/规格文档，未改动任何运行时代码。后续实现须走 worktree 隔离 + TDD + QM 门禁 + Code Review。


---

## 13. 实现期核实与运行时契约（2026-09-23 落地记录，追加）

> 本节把 T0a/T1/T6 落地时对真码 video_compose.py（2565 行）逐行核实到的、对外可见的行为事实固化下来，作为后续 T2-T5 切换与任何回归判定的权威基线口径。含数据校验、流程、功能逻辑、显示项、提示文字。

### 13.1 落地状态

- T0a 子进程捕获接缝：已合入分支 commit 8c881ee。VideoCompose._cmd_capture 类属性（默认 None）+ 私有 run_command 覆写；61 个既有 video_compose 测试零修改全绿。
- T1 engines/ 骨架 + registry + C10 门禁：已合入同 commit。registry 契约测试 + C10 能力门禁测试 9 绿。
- T6 治理 + 安全回归：已完成（本 PR 内）。test_render_engine_governance.py（5 绿）、test_render_engine_security.py（4 绿）锁定现状语义。
- T0b 基线 harness / T2-T4 adapters / T5 _render 切换：未完成（见 13.6）。

### 13.2 _render 终审覆盖矩阵（RF-3 真码修正，显示项/提示文字口径）

operation="render" 路由到 _render，四条正常渲染路径 均执行 _run_final_review，仅调用位置与失败提示前缀不同。任何"统一加/去终审"都属改行为，禁止：

- remotion：终审在 _render 外壳 ⑦ 段；成功显示项 data.final_review、data.final_review_status；失败提示前缀 Post-render self-review FAILED.（无前缀）；治理失败 blocker 早返回 不跑终审。
- ffmpeg：终审在 _render_via_ffmpeg 函数内部；失败前缀 Post-render self-review FAILED (FFmpeg).。
- hyperframes：终审在 _render_via_hyperframes 函数内部；失败前缀 Post-render self-review FAILED (HyperFrames).。
- atelier：终审在 _render_via_atelier 函数内部（另加 _run_atelier_checks）。

runtime_swap_detected（终审内实现，比对 proposal_packet.production_plan.render_runtime vs edit_decisions.render_runtime）：因四条路径均经终审，故对 remotion/ffmpeg/hyperframes/atelier 均生效；仅治理早返回（空/未知 runtime、remotion 失败 blocker）因产物未生成不跑终审而不生效。

### 13.3 数据校验事实（对外可见，必须保持）

- get_info().render_engines = {ffmpeg: True, remotion: bool, hyperframes: bool}；render_runtimes 是其别名（同一 dict 对象），向后兼容 proposal skill 读取。
- F-2（关键数据校验事实）：_hyperframes_available()（video_compose L268）与 _render_via_hyperframes()（L1554）导入 multi_publish.video_creation.video.hyperframes_compose，但真实模块在 multi_publish.video_creation.providers.video.hyperframes_compose（video_creation 下 无 .video 子包，python -c 已证实 ModuleNotFoundError）。该 import 被 except Exception 吞掉，故经 video_compose 时 render_engines.hyperframes 恒为 False，render_runtime="hyperframes" 恒命中 not self._hyperframes_available() 分支返回治理 blocker。行为保持基线以此真相为准；修此路径属改行为，须单列，不得混入本重构切片。已由 test_hyperframes_import_path_f2_lock 锁定。
- _needs_remotion()（L1189）确认：仅当 _remotion_available() 为假才返回 False；否则（含纯视频 cuts）一律 True。无内容类型否决分支（Q1 结论）。
- Remotion 可用性 _remotion_available()（L233）三查：shutil.which("npx") + remotion-composer/package.json 存在 + remotion-composer/node_modules 存在。

### 13.4 治理 blocker 提示文字（原文，须逐字保留）

1. 空/纯空白 render_runtime（_render L1405）：render_runtime is not set in edit_decisions. Per governance, it MUST be locked at proposal stage (proposal_packet.production_plan.render_runtime) and carried forward through edit_decisions.render_runtime. Valid values: 'remotion', 'hyperframes', 'ffmpeg'. Re-run the proposal stage with an explicit runtime choice - do NOT default this field.
2. 未知 render_runtime（L1436）：Unknown render_runtime {render_runtime!r}. Valid values: remotion, hyperframes, ffmpeg. render_runtime must be set at proposal stage.
3. Remotion 可用但渲染失败（禁静默降级，3 选项）（L1459）：Remotion render failed for renderer_family=... Underlying error: ... 之后列出 Options 1 Fix Remotion setup (cd remotion-composer && npm install) / 2 Re-run with operation=compose for FFmpeg-only (video cuts only) / 3 Approve a degraded FFmpeg render (still images -> Ken Burns)，收尾 Per governance: renderer downgrade requires user approval.
4. HyperFrames 不可用 blocker（L1542）：render_runtime='hyperframes' was locked at proposal, but the HyperFrames runtime is not available on this machine. Per governance this is a BLOCKER ... Requirements: Node.js >= 22, FFmpeg, and npx on PATH.

上述 1、2 及 atelier 短路（RF-1）已由 test_render_engine_governance.py 断言锁定。

### 13.5 安全与接缝契约（C9/A6/A9）

- 渲染子进程一律经 VideoCompose.run_command 到 BaseTool.run_command：subprocess.run(argv_list, shell 默认 False, check=True)，列表传参，禁字符串 shell 拼接（test_run_command_uses_shell_false_and_list_args 锁定）。
- 接缝 run_command 覆写在 super() 前记录 (list(cmd), cwd, timeout)，即未经 Windows shutil.which 改写的逻辑 argv，保证基线跨机稳定。
- npx 供应链约束（A6）：HyperFramesAdapter 迁移时须锁版本或走本地 node_modules（--offline），不接受调用方可控包名；真实子进程在 hyperframes_compose.py（npm view、_run），审计穿透 facade 下游（P7）。

### 13.6 剩余工作（诚实标注，本 PR 未完成）

- T0b 结构等价基线 harness：用接缝捕获 11 场景命令序列（REM/FF/HF/COMP/AT/GOV），落 JSON fixture。
- T2-T4 三 adapter：因 A4 退出标准要求 render 路径 raw_inputs 命中=0，adapter 须为读 RenderContext/RenderRequest 的 真实实现（非薄转发），是本次重构主体工作量。
- T5 _render 委派变薄 + get_info 数据源切换 + ast 门禁：切换点，须以 T0b 基线重放证明命令序列与终审/治理文案逐字等价后方可合入，任一 diff 即 revert。
- 全量 pytest 在本地基线存在 4 个与本改动无关的既有/环境性失败（model-download、ollama、templates-dir 顺序污染、story2video max_length 契约），非本 PR 引入；CI 为权威判定。

> 13 由实现期真码核实追加，未改动运行时代码语义；与 ARCH 12、DEV-PLAN 2/3.1 的 RF-3/F-2/Q1 订正同步。

### 13.7 T0b 基线 harness 落地（追加）

- test_render_engine_baseline.py 经 T0a 接缝冻结 render_runtime='ffmpeg' 规范 2-cut 场景的完整命令序列（2 段编码 + concat + 最终 mux = 4 条 ffmpeg 调用），落 tests/fixtures/render_engine_baseline_ffmpeg.json（tmp 路径归一化为 <TMP>/basename，跨机稳定）。
- 首次运行生成 golden，二次运行断言逐命令等价——T2-T4 FFmpegAdapter 迁移必须重放命中此 golden，任一 diff 即 revert（DEV-PLAN 3.4）。
- remotion/hyperframes 场景基线待补：hyperframes 受 F-2 制约经 video_compose 恒不可用，其真实子进程基线在 hyperframes_compose.py 层单列；remotion 需 node_modules 环境，基线以 CI 环境为准。

### 13.8 T3 FFmpegAdapter 落地（追加，行为保持）

- engines/ffmpeg_adapter.py：FFmpegAdapter 实现 RenderEngineAdapter 三抽象方法
  - preflight(ctx)：shutil.which("ffmpeg") 探测，缺失返回 PreflightResult(available=False, reason="ffmpeg binary not found on PATH")，不抛异常。
  - validate(req,ctx)：req.resolved_cuts 为空返回 ValidationResult(ok=False)。
  - render(req,ctx)：由类型化字段重建 compose_inputs，委派 host._compose（FFmpeg 语法的唯一来源），返回 RenderResult(review_fail_label="(FFmpeg)")。
- RenderContext 扩展 9 个类型化字段：codec(默认 libx264)/crf(23)/preset(medium)/profile_name/subtitle_path/audio_path/subtitle_style/playbook/options，默认值镜像 _compose 的 inputs.get 回退，因此未显式设置的上下文与重构前逐字节同命令。
- A4 退出标准达成：render 路径不读 raw_inputs（无透传），是真实实现而非薄转发。
- 行为保持等价证明（黄金标准）：test_render_engine_adapter_ffmpeg_equiv.py 用与 T0b 相同的 2-cut 场景驱动 FFmpegAdapter.render()，经 T0a 接缝捕获命令序列，归一化后逐条断言 == tests/fixtures/render_engine_baseline_ffmpeg.json（4 条 ffmpeg 调用）。任一 diff 即 revert。
- subtitle_burn 解析逻辑逐字镜像 _render_via_ffmpeg：ctx.subtitle_path 显式优先；否则当 options.subtitle_burn 默认 True 且 edit_decisions.subtitles.enabled+source 时回填。
- C10 能力单源：test_ffmpeg_adapter_capabilities_ground_truth 断言 id=ffmpeg、requires=("ffmpeg",)、unavailable_fallback=None、word_level_captions=False、native_transitions=False。
- 本 PR 未切换 _render（T5），FFmpegAdapter 暂由测试与 registry 装配引用，零运行时行为变化；_render 委派须待 T4 两 adapter 完成且全路径基线证明等价后进行。