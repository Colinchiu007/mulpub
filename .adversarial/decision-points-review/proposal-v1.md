# Proposal v1 — 决策点专项对抗评审（decision-points-review）

> 出方案方：opencode-hosted（step-5-preview）｜评审方：claude（CCG backend primary，家族校验通过）
> 评审对象：《决策点分析与建议-2026-10-13.md》中的 5 个决策点（已随 PR #3472 合入 origin/main）
> 背景：4 文档整体已过 CCG 双轴 + 3 轮对抗循环（25 条 findings 全采纳，Round 3 收敛 9.0），但**决策点受审不均衡**——决策 1/3/5 有 findings 命中并修订，决策 2 零命中，决策 4 仅间接波及。本提案专为补此缺口。
> 评审方纪律：只读本文件与决策点文档（工作目录根下 `决策点分析与建议-2026-10-13.md`），最多 4 次文件读取；时间预算 10 分钟；逐条给 verdict + 证据；输出 findings（Critical/Warning/Info）+ 收敛判定。

---

## 5 个决策点的当前结论（v3.1 已评审态）

### 决策 1：F3 隐身浏览器选型 → camofox-browser（主选）
- 理由：许可零风险（MIT wrapper + MPL 二进制 + 用户本机 postinstall 下载）；CloakBrowser 二进制专有（订阅+禁再分发+OEM 条款，产品向终端客户提供浏览器能力命中 OEM）→ 降备选，并行发 OEM 咨询邮件但不阻塞；BotBrowser 未源码验证仅备胎
- 改判触发：OEM 免费授权→重评；camofox A/B 拦截率不低于 Electron+F1/F2→降级/换胎；camoufox 国内下载持续失败→换胎或弃用
- 已受审：后端轴 1.1（定调改「默认需授权」）✅

### 决策 2：F5 本地 STT 引擎 → whisper.cpp 主选 + small 模型按需（75MB）；faster-whisper 不做；whisperX 一次性 A/B
- 理由：①桌面产品不背 Python 依赖（用户环境不可控是结构性硬伤）②whisper.cpp 与项目已有 ffmpeg 捆绑同范式（hash 锁定+许可证纪律现成）③75MB 有先例（用户安装包已含 ~170MB Chromium）④whisperX 是验证器不是组件（先花半天验证 audio-aligner 再决定 500MB 依赖）
- 改判触发：small 中文 WER>15%→升级 medium/FunASR；audio-aligner 落后→换 whisperX 管线；GPU 用户占比高且要求速度→加 faster-whisper 档
- **受审状态：零 findings 命中。**

### 决策 3：F6 TTS/克隆 → 先只落 Kokoro-82M JS（Apache-2.0，零 Python）；克隆待产品确认后再上 GPT-SoVITS
- 理由：克隆是产品需求不是工程需求（无 PRD/反馈支撑）；Kokoro 与 SoVITS 共用 provider 基建（契约/模型下载/音频格式），先建基建克隆随时可加；隐私红线（PIPL）内建
- 改判触发：克隆进三个月路线图→启动 SoVITS（LICENSE 逐文件审计+隐私授权流+法务评审双门禁）；用户反馈 Kokoro 中文音色不可用→评估社区音色库/SoVITS
- 已受审：后端轴 FIND-9（PIPL 双门禁）✅

### 决策 4：F11 TLS 指纹 → 先做半天探针，不直接集成 impers
- 理由：无真实 403 数据支撑；impers 引入 libcurl 原生二进制（生产依赖闭包成本）；探针同时输出 F1/F2 的 TLS 层暴露面认知（边际价值最高）
- 改判触发：探针显示百家号/头条网关校验 JA3→升级完整 F11；生产 403 定位 TLS 层→触发；新增抖音协议轨→随平台评估
- **受审状态：仅间接波及（无 finding 直接挑战）。**

### 决策 5：批次范围 → B 递进；B1 拆两 PR（F1+F2 / F3+F4）
- 理由：B1 是唯一「不动架构、纯增强」批次；递进让后续投入按真实数据启停；单 PR 评审面减半、数据回流提前
- 改判触发：用户要求全量→A；资源 1-2 周→C（F1+F4）；B1 数据不及预期→暂停 B2/B3 先根因分析
- 已受审：前端轴 H4（数据口径契约 7 要素）✅

---

## 出方案方自查（先自曝，请评审裁决）

**S1（我自查发现，未受外部评审）**：决策 2 的核心理据①「桌面产品不背 Python 依赖（用户环境不可控是结构性硬伤）」**被项目自身架构部分否证**——本项目 python-backend 本就随桌面应用分发（AGENTS.md F8「自动安装 Python 依赖」、python-bridge 进程桥接已存在），faster-whisper sidecar 走的是**已有基建**而非新增用户负担。该论据若弱化，「faster-whisper 不做」的结论是否需要重评？（注意：论据②③④仍成立。）

**S2（覆盖面自查）**：决策 4 的触发条件依赖「探针显示网关校验 JA3」——但若探针**无法得出确定结论**（网关行为视请求类型而异），当前只写了「升级完整 F11」和「不触发」，没有第三条路（如仅对特定 API 端点启用 impersonation）。

## 供评审裁决的架构事实（不需要读仓库）

- 本项目 = Electron 33 桌面应用 + **随应用分发的 Python FastAPI 后端**（python-backend），主进程经 python-bridge（BasePythonBridge）管理 Python 子进程；安装时自动安装 Python 3.12+ 及 pip 依赖
- 现有本地推理先例：Ollama 在 provider 清单（用户自装）；媒体二进制（ffmpeg/ffprobe）随包捆绑 + hash 锁定（media-tools 纪律）
- B1 数据口径契约已定义风控拦截率指标（每平台每臂 n≥15）
- 实施计划 F5 原设计：whisper.cpp 二进制捆绑（media-tools 同范式）；faster-whisper  originally 被拒的理由即 S1

## 评审焦点（按优先级）

1. **S1 裁决**：决策 2 的论据①是否成立？「faster-whisper 不做」结论是否应重评（如改为「whisper.cpp 默认 + faster-whisper 可选 sidecar」）？
2. **S2 裁决**：决策 4 的触发条件是否需要第三条路？
3. **决策 2/4 的改判触发条件可证伪性**（与已受审的决策 1/3/5 同标准）
4. **决策 1/3/5 修订后是否引入新矛盾**（与四周文档的一致性）
5. 每个决策是否遗漏了「改判触发」之外维度（如成本/时序/依赖面）

## 收敛判据

最低维度分（证据强度/逻辑一致性/可证伪性/完备性）≥8.0 且无未裁决焦点项。出方案方对每条可接受/拒绝（拒绝须给证据）。
