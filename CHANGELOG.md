# docs(film): 新增影视工程「自动」模式长篇化改造实施落地方案（film-auto-longform-plan）

- 新增 `01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md`：把「自动模式能否从剧本文案产出 30 分钟以上短剧成片」的调研结论，转成可执行的落地方案（14 条需求 + 8 个里程碑 + 29 条可断言验收 + 10 条风险登记）。
- 结论：**当前不具备**该能力 —— 目标时长被硬编码在 600 秒（10 分钟），1800 秒在输入校验阶段即被拒；仓库里唯一 30 分钟以上的成片路径是「重生成一部既有参考片」，不是从新剧本文案生成。
- 方案给出三个**必须先做的前置取证**并设为门禁：视频 Provider 是否真的产出对白音轨（实测 9 个适配器**无任何** audio 参数）、是否接受应用下发的镜长（实测**只有 2/9** 消费 `numFrames`）、以及出片成功路径首次真机跑通。
- 明确音轨不单建（对白与声音交给视频生成模型统一完成），但据此把「台词长度 vs 镜长」与「提示词结构化台词」提升为核心需求；并修正一处既有规则冲突：模板的音频语义块此前被当作静态内容从视频提示词中剔除。

# [未发布] feat(视频创作): 参考视频 + 非 Flash 模型 + 生成成本可见；编辑页「生成 AI 视频」接入场景已选定的图

- feat(视频创作): 暴露非 Flash 的 `agnes-video-2.5`（支持 720P/1080P/1K/2K、参考图 ≤8、**参考视频 ≤1**）。动因：Flash **服务端硬拒**参考视频（400 `videos is not supported`），而支持它的非 Flash 模型在产品上完全没露出来。能力与端点**解耦**——端点仍由用户在「模型设置」里配置（官方标注非 Flash 在国际站上线，本仓 base_url 是中国站，代码不替用户猜）。
- feat(视频创作): 参考素材模式新增**参考视频**上传位，**仅当模型能力声明支持时才渲染**（UI 里没有一行模型名；非 Flash 选中自动出现、Flash 选中自动不出现）。以 Data URI 提交（官方对参考视频写的是「公网可访问 URL」，但参考视频时长受限 2–12 秒、短片 base64 后体积可控 ⇒ 先按 Data URI 交付，零新基建；被拒则改走 OSS 托管，原语已备好）。客户端把关：单文件 ≤20MB、类型限 mp4/mov/webm/mkv、数量按能力。
- feat(视频创作): 参数区显示**预计成本**。官方计费口径是「输出秒数 + **输入视频秒数**」相加——8 秒输出 + 3 秒参考视频 = 11 秒 × ¥0.15 = ¥1.65，比不带参考视频的 ¥1.20 **多 37%**。免费模型显示「限时免费」而不是 ¥0.00；有参考视频时明示「其时长另计」（**时长客户端读不到**，需 ffprobe ⇒ 不虚报总额，只给可确定的输出部分）。
- feat(视频创作): 视频任务编辑页「生成 AI 视频」**接入该场景已选定的图片**作为 provider 参考输入 ⇒ 人物/商品跨镜头一致性可落地。零额外图片生成、零串行化、零成本（该场景的图由用户在编辑页挑过，一定存在）。读图过三道防线：受控媒体根（拒绝越界/软链接/非文件/扩展名不符）、体积 ≤5MB、**魔数嗅探**（只信内容不信扩展名）。任一关不过则降级为纯文本，不阻断该段生成。
- fix(视频创作): 上一轮规划里「主流水线每段视频用分镜图做参考」的**前提是错的**——视频场景**根本不生成图片**（图片只是视频失败时的回退），且视频提交**早于**该分镜图片的生成请求，manual 模式同理 ⇒ 任何模式下视频生成时该分镜的图都不存在。要让它存在需把资产策略改成「每个视频场景也先生成图 + 该段视频等这张图」（多出 V 次图片生成 + 阶段内串行化），与 2026-08-13 的并行优化直接冲突 ⇒ **属产品决策，未做**，改做前提成立的编辑页路径。
- refactor(视频创作): `story2video-project-service.js` 在「点名还账」清单里（target=2527、**容差 0**）⇒ 参考构造整体挪进新模块 `scene-video-reference.js`，调用点只留 1 行 + 1 行展开；同函数内两处 `if { throw }` 压成单行（行为不变）⇒ **净增长 0**（2527 → 2527）。
# [未发布] feat(视频创作): 快速渲染接入 Agnes Video 2.5 Flash 全能力（文生 / 首尾帧 / 参考素材）+ 真实进度

- feat(视频创作): 快速渲染的 AI 视频能力从「只有文生视频」扩为三模式——**文生视频**（`mode=text`）、**首尾帧**（`mode=keyframe`，首帧/尾帧至少一个）、**参考素材**（`mode=reference`，参考图 ≤5 / 参考音频 ≤3）。动因：`agnes-multimodal` 适配器**早已完整实现** Agnes Video 2.5 Flash 协议（首尾帧、参考图、参考音频、seconds、aspect_ratio、seed），但链路三层都在丢弃这些参数（`generateSceneVideo` 只传 6 个字段、IPC 契约只有 `{ prompt }`、渲染层无入口）⇒ 模型已具备的能力在产品上**一个都不可见**。
- feat(视频创作): 参数区补齐——**时长 4–12 秒**、**随机种子**（0 是合法值，不再被当作空值丢弃）、**分辨率档位**（按模型能力，单档位时控件禁用）、**输出平台 → 画幅映射**（6 平台 → 6 个合法 `aspect_ratio`）。其中「输出平台」此前在 AI 视频路径上**完全失效**（选了 YouTube 横屏也出竖屏，因为它压根没传进 IPC）——本次一并修掉。
- fix(视频创作): AI 视频**进度条失真**的两层根因一并修复：① 主进程此前只在提交前推一次进度、轮询期间无回调；② **载荷形状不匹配**——preload 的 `onRenderProgress` 把 IPC 载荷原样传给回调（对象 `{ percent, stage }`），而渲染层按 `(pct, stg)` 两个位置参数解构 ⇒ `pct` 拿到整个对象。现改为按对象读取，并区分「排队中 / 生成中」（服务端原始状态 `queued` / `in_progress`，归一化后两者都是 `processing`）。**百分比如实透传服务端 `progress`，不伪造连续增长**（服务端只有 10 / 100 两档）。
- refactor(视频创作): `generateSceneVideo` 及其依赖（`downloadVideoToFile` / `probeVideoFile` / `pickFrameCountForSceneDuration` / `MAX_VIDEO_FILE_BYTES`）抽到新模块 `electron/services/scene-video-generator.js`。动因是**硬约束**：`story2video-stages.js` 在「点名还账」清单里（target=4081、容差 0）且当时正好 4081 行 ⇒ **加一行即主干变红、全仓 PR 被挡**；抽出后该文件降到 3906 行（债已还，target 条目保持不动）。`CreateView.vue` 同样净减 109 行（5528 → 5419）。
- refactor(视频创作): 快速渲染视图抽成独立组件 `src/views/video-creation/QuickRenderPanel.vue`（+ `QuickRenderMaterials.vue` + `useQuickRenderMaterials.js` + `quick-render-constants.js`）。三个新文件全部 < 500 行，避免 `NEW_OVER_LIMIT`；素材区与参数判据与渲染逻辑分离，改判据不会漏改渲染。
- feat(视频创作): 能力描述收敛为**单一真源** `electron/services/adapters/agnes-video-models.js`（按模型 ID 给出尺寸档位 / 素材上限 / 是否支持参考视频 / 合法画幅），**未知模型保守回落**（只支持文生视频）。判据落在**模型的能力属性**上而非「providerId 名单」——名单判据对新增对象默认不成立：将来换一个讲同一套协议的 provider，不必记得去改任何中央名单。
- feat(视频创作): 模式 ↔ 媒体契约收敛到 `packages/shared-utils/src/agnes-video-request.js`，**渲染层与主进程共用同一判据**（text 禁媒体 / keyframe 至少一首尾帧且禁参考素材 / reference 至少一类素材且禁首尾帧）。违规返回**领域码**（如 `keyframe-requires-frame`），渲染层据此取本地化文案，**不把英文码原样透给用户**。
- fix(视频创作): 服务端必然拒收的参数在**客户端**拦下（`size` 非 720P、参考图 >5、参考音频 >3、参考视频不受支持、时长越界、画幅非白名单），省掉一次白跑的请求；【取消】如实提示「已停止等待，远端任务可能仍在生成」（上游未公开任务取消端点，`renderCancel` 只取消本地 Remotion 渲染）。
- i18n: 新增文案全部走 `create.story2video.ui.quick*`（zh/en 成对）；渲染端**零新增硬编码中文**（CJK 门禁按 file+content 增量比对基线，新文件里的中文即视为新增硬编码）。
- docs(视频创作): PRD 增补 §3.1.42（模式集合 / 能力判据 / 参数区 / 素材上限 / 进度载荷形状 / 取消语义 / 模块归属 / 验收边界）；openspec change `agnes-video-flash-quick-render` 承载 proposal / design / spec delta / tasks。
- **明确不做**：参考视频（Flash 服务端硬拒 `videos is not supported`，需非 Flash 模型 + 公网素材托管，另立 change）；`n > 1`（服务端仅支持 1）；`width/height/fps/num_frames` 直传；`negative_prompt`（2.5 Flash 拒收该字段）。

# fix(gate): QM-6 入口夹具漏抄新模块导致 Gate 2b11 对所有 PR 转红（fix-qm6-entry-fixture-closure）

- 修一处**与改动无关却让所有 PR 变红**的断链：#4093 给 QM-6 写回入口加了新依赖
  `scripts/lib/exec-record-statuses.js`，但没把新文件抄进该门禁的测试临时仓 ⇒
  入口一加载就抛「找不到模块」，该门禁的 6 条用例同形失败。已补齐夹具的 require 闭包。
- 顺带补上审计路径的懒依赖，让闭包真正完整。
- **加一条机械守卫**：被复制进临时仓的脚本，其本地依赖若没进复制清单，当场变红并指名缺哪个模块 ——
  把「加了 require 记得同步清单」从靠自觉变成拦得住。已做变异验证：删掉一行清单即变红。
- 这类红的形态值得记住：**本机跑是绿的**（真仓里那个模块存在），只有夹具把它排除时才崩，
  所以本机复现不出来；而门禁在每个 PR 上都跑 ⇒ 红在所有 PR 头上，与谁改了什么无关。
# docs(openspec): 归档 ccg-decider-merge-skip 并同步主规格 ccg-review-decider（ccg-decider-merge-skip-archive）

- 把已合并的 `ccg-decider-merge-skip` change 归档进 `openspec/changes/archive/2026-10-23-ccg-decider-merge-skip/`，并新增主规格 `openspec/specs/ccg-review-decider/spec.md`（5 Requirement / 10 Scenario）。
- 归档时补齐了 delta 与实现之间两处漂移：第 4 条 Requirement 缺 Scenario（此前 `openspec validate --strict` 判不合法）、第 5 条「探测失明与『真的不在合并中』分开」整条未进规格（实现与 T9 早已合入）。
- 能力目录从 change slug 改名为语义名 `ccg-review-decider`，避免 `openspec/specs/` 出现以变更命名的能力。
# feat(video): 数字人支持多服务商切换，并接入飞影 HiFly（digital-human-multiprovider）

- 「数字人口播」流水线新增「数字人服务商」下拉：已配置 HeyGen 与飞影 HiFly 两家时可在两者间切换，切换后自动重拉形象、音色与克隆列表，并清空已选形象/音色（避免误选另一家资源）。只配置了一家时下拉禁用并提示如何去添加。
- 新增飞影 HiFly 数字人 adapter，覆盖视频生成、任务查询、形象/音色列表、形象与声音克隆、素材上传全链路；形象与音色列表的分页在 adapter 内消化，上层仍拿全量数组。
- 克隆形象改为按服务商隔离存放：在 HeyGen 克隆的形象不会出现在飞影的下拉里，反之亦然；切换服务商不影响另一家已创建的克隆形象。
- 修正数字人 provider 的解析方式：此前 provider 名在两处硬编码为 HeyGen，现在统一按 `digital_human` 能力解析，新增第三家只需在种子数据里声明能力并写一个 adapter。
# feat(视频创作): AI 讲解视频流水线可零凭据端到端复跑，并修掉「默认音色下成片完全没旁白」等四处缺陷（explainer-cdp-e2e）

- fix(视频创作): **默认音色下成片完全没有旁白**。用默认音色且没配 TTS 服务商时（走内置的免 Key 语音合成），edge-tts 会收到 `'default'` 这个占位串当音色名，直接报错，于是旁白被静默降级成每段 3 秒静音 —— 成片能播、有音轨，但**一个字都没有**，界面也不报任何错。根因是「未指定音色」的占位值只在模型服务商那条路径上被识别，语音合成这条路径没识别；现已把占位值收敛成单一常量、两条路径共用同一套判据。
- fix(模型设置): **本地模型服务商不再被强制要求 API Key**。内置的「Ollama (本地)」「本地 Whisper」在管理器里被要求必须填 Key（可它们自己的适配器明写「Key 可空」），用户被迫填一个毫无意义的假串；在系统安全存储不可用的机器上（Linux 无头/容器）连假串都存不进去，直接报「系统安全存储不可用」。根因是免 Key 判据写成了硬编码的服务商名单，而不是「地址在回环接口上」这一属性；现改为按地址判定 —— 远端服务商**仍严格要求 Key**，安全姿态不变。
- fix(开发环境): 启动桌面端时 Electron 会被**反复拉起**（实测进程数冲到 189 个、内存吃满后把开发服务器挤掉，表现为「窗口刚起来就没了」）。根因是等待开发服务器就绪的逻辑缺少「只启动一次」的一次性守卫，响应超时重试与成功回调会各拉起一次；现已加守卫。
- feat(开发环境): 新增 `MP_ELECTRON_PASSWORD_STORE` 开关，用于在无头/容器环境指定 Chromium 的口令存储后端（默认不设置 ⇒ Windows/macOS 行为一字不变；取值非法直接报错而不是静默忽略）。
- feat(视频创作): 新增「AI 讲解视频」流水线的**零凭据端到端复跑**能力：本地 Provider 桩（OpenAI 兼容的 LLM 端点 + Stable Diffusion WebUI 兼容的出图端点，均免 Key、不外网）+ 原生 CDP 驱动（不经 Playwright 的 connectOverCDP），可连续跑多轮并把「成片存在 / 可播放 / 规格合规 / **音轨非静音**」变成可断言的验收条件。此前这条八阶段链路只能靠人工点界面验证，出了问题也只能在真实账号上复现。
- docs(视频创作): PRD 增补 §12「AI 讲解视频离线可复跑与四处缺陷收口」，写清启动入参与校验、模型能力前置校验、本地桩的协议契约、**标题安全区**（合成默认的放大动效会裁掉左右各 10%，本地出图的文字必须留够边距，否则成片里首尾字被吃掉且不报错）、八阶段流程与产线口径、两种驱动方式的交互逻辑、阶段显示名与提示文字逐条对齐、验收矩阵、无凭据复跑操作手册，以及四个缺陷的第一性原因/逃逸分析/防再犯措施与未闭合项。
# fix(公众号): 账号卡显示账号头像，昵称取平台解码后的值（fix-account-profile-extra-endpoints）

- 公众号账号现在显示账号本人头像（此前恒为空，只能看到灰色通用图标），头像与昵称取自同一个已有请求，不新增网络请求。
- 公众号昵称不再显示转义残渣（平台对昵称做过一次编码，现优先取它解码后的那份）。
# fix(desktop): 应用内页面在外部网页标签活动时可见（会员中心点击无反应修复）（member-center-overlay-visibility）

- 修复：打开自媒体账号创作者中心等外部网页标签后，点击左下角头像菜单里的「会员中心」界面无反应 —— 路由变了但活动标签没变，会员中心页面被原生网页图层整块盖住；现在会先切回应用首页标签再打开，会员中心正常显示。
- 修复：同源的「升级 Pro」入口与 9 个全局快捷键导航（数据看板 / 内容采集 / 账号管理 等）一并改为可见导航，外部网页标签活动时同样有效。
- 修复：「故事讲述」生成任务在后台完成时弹出的通知模态，之前会被外部网页图层盖住导致「生成完成」信号丢失，现在通知可见可交互。
- 新增：统一的应用内导航原语，三步契约（内嵌主页实例定向投递 → 切回首页标签 → 路由跳转），后续新增入口不再需要各自实现一遍。
# docs(openspec): 立项零人工高危面收口机制——把"谁签字"换成"每条意见的可重放处置"，并先造"判据变宽"的探测器（qm6-zero-human-closure）

- **背景**：QM-6 收口矩阵要求高危面只认 `deepReview.tier=external` + 可核 `evidence`，而 `tier` 的唯一生产方
  要求 `performedBy` 等于本轮 critic；评审引擎在仍有 Critical 未决时降级自扮演、把 `performedBy` 写成 `self-play…`
  ⇒ **评审真发现问题的路径上，高危面没有任何机械出口**。现场实证：PR #4261 唯一失败格是 `Gate 2b11`，
  其余 required 格全绿；主干存量已闭环 339 条里 `tier=self-play` 40 条、`tier` 整段缺席 202 条（普查工具当场取，活数）。
- **两条独立病根**：① 收口判据把"签字者身份"当充分条件；② **没有任何机械判据能区分"合理收窄"与"为过闸而放宽"**
  —— 这正是 AGENTS 把守门面清单划给人工过目的唯一原因。只治 ① 不治 ②，人工闸门是被转移而非被消除。
- **方案（两刀，顺序是合同）**：第 3 刀先上——`scripts/qm6-judgment-corpus.jsonl`（只可追加的真实历史案例输入面）
  + 差分判据 `新命中集 ⊇ 旧命中集` + 覆盖计数棘轮（维度覆盖数不降 / 新维度初始 > 0 / 总条数不降，三条独立红文案）；
  第 1 刀随后——每条评审意见带封闭分档的 `resolution`（`code-fix` 红→绿双读数、`false-positive` 引用 #4297 的
  `rebuttals[]`、`deferred` 锚未勾任务行逐字内容、`unsupported`/`accepted-risk` 在高危面拦）。
- **可行性经现场核实，不是设想**：判据入口已接受全注入输入面（`evaluate()` 纯数据、CLI 已有 `--statuses=<json>`、
  产物读取器是注入参数），且两份判据 require 集合为零第三方依赖 ⇒ 重放器可以待在 CI 的 `changes` 作业里。
  **D3 不需要为可重放重构生产代码**，唯一一处生产改动是给散文 `reasons` 补一个并行结构化出口 `hits`。
- **成本实测**：近 60 笔已合并 PR 交付时长 p50 1.54h / p90 7.92h / max 17.79h（两次读数与漂移一并写入文档）；
  40 条语料重放约 5 分钟串行、可并行、可按守门面命中裁选择集。增量成本落在"改闸门那次提交"，不落在每个 PR。
- **本文只提案**：零行实现代码。第 4/5/6 刀（跨家族共识组装、严重度标尺、异常自动收紧）刻意不做并写明理由，
  其中第 4 刀的三个数没量到、拒绝写进文档当依据。#4148 的 QM-6 收口保持未闭合交人工，本片不为它开后门；
  守门面清单条目（现读 10 条）一字不改。属"改谁来守门"，不自动合并。
# feat(ci): 定时作业补上「心跳」判据——抓"一次 run 都没有"的那种失败（schedule-heartbeat-lock）

- 新增每日巡检作业「定时作业心跳巡检」：每条声明了 `on.schedule:` 的工作流都会被告警——不是"跑失败了"，
  而是"根本没跑"（cron 写错、作业被删或禁用、runner 长期排队）以及"跑迟了"。迟到阈值取周期 + 8 小时宽限，
  可用 `MP_SCHEDULE_HEARTBEAT_SLACK_HOURS` 覆盖；写错值会回落并打印告警，不会静默。
- 「没跑过 / 跑迟了 / 判据自己取不到数」是三个可区分的出口（退出码 1 / 1 / 2）：取不到数一律按未证实出声，
  绝不被读成"那天真的没跑"，也不会被读成"全部正常"。
- CI 失败自动报警的名单新增这一条作业；定时作业"是否被报警覆盖"与"是否真的按时跑过"由两把锁互相咬住，
  任一把漂了都会在 PR 侧当场红。
- 行为锁每次 PR 都跑（`quality-gate.yml` 新增 Gate 2b14），线上读数每日跑；新作业的预算格进全仓超时注册表。
# docs(ci): 定时作业报警那把锁的注释改准 —— 连红 9 次定时 run，并把取证指针集中到一处（schedule-watch-doc-count）

- 现场：#4234 把执行记录里的"连红 8 天"按 `gh run list` 重取改成"连续 9 次定时 run"（run `38385152658`…`39570873661`，最后一次成功 `38239617921`），但同一个被否证的数字还抄在这把锁自己的 5 处注释里（两份 workflow 的动因说明、判据本体头、行为锁头）。注释里的事实断言也是断言：下一个读这段动因的人无法分辨哪一份是被推翻的旧值，而这几行文字唯一的用途就是把根因说准。
- 修法：5 处一次改准；run 号只留在动因那一行并显式指向取证所在（`openspec/records/schedule-failure-watch.md` 与 PR #4234），**不把出处抄四份** —— 多份副本正是本刀立项要防的那种漂移。
- 附带一条工程口径：本仓 workflow blob 是混行尾，所以任何"改几行文字"都必须做**行内**替换并断言 CR/LF 计数不变，禁止按多数派探测行尾后统一回写（那会把每次 diff 变成整文件重写）。
# feat(video): 飞影数字人支持克隆自己的声音，克隆面板补配套声音指引（voice-clone-multiprovider）

- 飞影 HiFly 接入声音克隆：在「配音 → 音色复制 / 克隆」上传录音即可克隆，克隆成功后可在数字人音色下拉中选择。此前只有 HeyGen 支持。
- 数字人「管理克隆形象」面板新增能力提示：当前服务商支持克隆声音时告知入口位置，不支持时明确说明只能用现成音色，不再让用户以为形象和声音必须捆绑。
# feat(video): 数字人形象克隆 —— 上传照片/视频生成可长期复用的 HeyGen 形象（avatar-voice-clone）

- 视频创作「数字人口播」新增「管理克隆形象」：上传一张照片或一段视频，克隆出属于自己的数字人形象，训练完成后直接进形象下拉（带「我上传的」标识），可反复使用。
- 克隆形象按账号隔离存在本地 registry，跟着账号走；删除时同步删 HeyGen 侧资源，远端删除失败会保留本地记录并标记待删、下次重试。
- 首次使用展示一次性法律提示（肖像权/声音权归上传者所有），不强制勾选；创建/删除/重命名/训练状态变更全部落 append-only 审计日志。
- 修正 HeyGen adapter 的克隆端点族：克隆走 `/v3`（`POST /v3/avatars`、`POST /v3/voices/clone`、`DELETE /v3/avatars/looks/{id}`），与视频生成的 `/v2`、状态查询的 `/v1` 分段取值，不再硬拼前缀。
# fix(评审链): deep-review/plan-review 的 --force 不再承诺做不到的事（ccg-force-flag-honest）

评审链两个入口的 `--force` 都是装饰性旗标，且各自以不同方式空转。`scripts/deep-review.sh --force` 只挡自己那一格早退，驱动仍按判定记录里的 `mode` 自行决定——实测 `mode=skip` 时它 `rc=0`、一个后端都不起，**却把那条记录的 `deepReview` 整块覆写成 `skipped_by_mode`**（原先的 `cleared` / `tier=external` / 评审出处随之消失）；而两份已合并的执行记录把这条命令写成"唯一能真正补审的路径"。`scripts/plan-review.sh --force` 保护的是一个**不可达分支**：判定器对方案输入恒不产出可跳过的那一档（两种路径形状实测都是 SINGLE），那句"跳过（--force 可强制）"永远不会打印。

现在：验证层带旗标遇到 `skip` 会**早于依赖体检**出声拒绝（`rc=2`），说破为什么做不到、继续跑会毁掉什么，并给出现前真能用的两条出路；决策层删掉死码分支与无对象的旗标。判定产物在任何参数组合下都不会再被"没跑的审查"改写——这条有字节级回归锁。新增 9 条锁（含 3 条把"将来的退化"钉住的取证性锁）；`--help` 的说明书文本本身成了被测面。
# fix(ci): 债务重算轮次"一条都没量"不再报成功，量不到时点名到具体那一步（debt-recheck-zero-measurement-fail）

- 落地后第一次真实运行会**变红**——如果 CI 上那 15 笔仍在合成提交/只读检出阶段失败。这不是新故障，是原来那条假的绿被取消：以前整轮 `UNJUDGEABLE=30`、判据一次没跑，作业照样 conclusion=success，谁都不知道守门基线从没被用来量过在飞 PR。
- 退出码新增一条**不依赖原因名单**的判据：一轮拉到了 PR 却一笔都没量到（且不是每个人都在跟主干冲突）⇒ 非零退出。全 `conflict` 的一轮仍退 0，但会打印 `MEASURED=0(all-conflict)`，让"没量到"和"量了都合规"在日志里两种形状。
- `UNJUDGEABLE` 现在带**失败阶段与现场**：`worktree-setup`(工具没装配) / `merge-commit-failed`(合成提交) / `merge-worktree-failed`(只读检出) 三个档名分开，并附该命令 stderr 首行。维护者不用再从"哪一步坏了"倒推。
- 原因归类改成一张表持有，词表与故障清单都由它派生，非法归类在模块加载即抛——本次事故（名单两抄、漏一档）不可能再静默发生。
- 宿主环境带 `GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE` 时，重算会剔除它们并**出声一次**：实测 `git -C <repo>` 挡不住 `GIT_DIR`，不剔除时整轮会去量别人的仓库而产物完全同形。
- 附带：重算工具按依赖形态拆成"纯判决核 / 真 git 装配 / CLI 门面"三份（撞上行数红线的正解是拆结构不调基线），读源码的结构锁扫描域同步扩到三份并加规模下界。
# fix(账号): 账号卡显示平台真实昵称、头像与粉丝数（fix-account-profile-avatar）

- 账号页多个平台不再显示灰色通用头像或平台名：抖音/小红书/知乎显示账号真实昵称，头条/小红书显示账号本人头像而不是平台 logo 或默认图。
- 账号页新增粉丝数显示（抖音/头条/B 站/小红书/视频号）。
- 头像或粉丝数取不到时，卡片上明确提示「未获取到…，点『验证』可重新获取账号资料」，不再是一个无从判断的灰色图标。
# fix(rewrite): 长度「精简」档目标字数 400 → 800，并在长度下拉显示各档目标字数（fix-length-compress-target-800）

- **改前**：长度「精简」档的目标是 **400 字**，而这个数字**不是按平台需求定的**——它是 2026-09 按
  keep 档 1500 的 1/4 人工取的相对档（375 取整 400），推导过程没有记录。
  400 字够短视频口播与短文案，**不够**知乎回答（常见 1000–3000 字）与公众号正文（1500–3000 字）；
  而自动流水线文章与视频都支持，一个固定值无法同时满足。界面上「精简」两个字也不带任何字数提示，
  用户点完才知道拿到多少字。
- **改后**：`compress` 档目标 **400 → 800**（`min`/`max` 与其它两档目标一行未动）；
  长度下拉三项改为显示目标字数：「保持原文（约 1500 字）/ 精简（约 800 字）/ 扩写（约 2500 字）」，
  默认档仍是「保持原文」。
- **字数显示不是写死的文案**：显示值取自渲染层镜像常量，并由**跨语言结构锁**保证
  === Python 后端 `_LENGTH_RANGES` 的 target（只改一边 ⇒ 测试红）。
- **回归**：Python 断言更新 + 单调性契约继续成立（800 < 1500）+ 文案渲染断言（禁止残留 `{count}` 占位符）。
# fix(gates): 补两处真机暴露的 Critical —— too-stale 曾不拦、弱网下判据几乎必然 rc=4（fix-main-red-too-stale）

- `maxStale` 以前只是「生产者返回值里的一个字段」，判据消费端没有读它：明明 `staleness=4 > maxStale=3`，
  仍然给出「主干绿、本 PR 无红」。现在 `too-stale` 会在差集之前单独拦成「未证实」，且读数行打 `newRed=na`
  （「未计算」不再被涂成「零新增红」）。
- 一次基线选择要连续成功 10 次以上 GitHub 接口调用，而本机实测单次失败率约 20% ⇒ 连续成功概率只有约 10%，
  判据在弱网下几乎必然报「自身故障」。现在每次调用都带小重试（2 次 × 1.2 秒），只对瞬时错误重试，
  凭据/路径错仍然立刻失败。
- 这两处都是 PR #4221 合并之后才暴露的：一个测了「函数返回对了」没测「调用方用了它」，
  一个把「请求数量放大」误当成「工具坏了」。
# docs(openspec): 新增 main-red-liveness 提案，诊断合并门禁 8 小时卡死的结构性根因（main-red-liveness）

- **背景**：PR #4186（账号资料兜底修复）被合并门禁卡约 8 小时，而它本身 24 项检查全程全绿、`mergeable=MERGEABLE`、`mergeStateStatus=CLEAN`。
- **根因（三条，均有现场取证）**：① TOCTOU——`check-main-red.js` 取 `origin/main` 当前 tip，与真正合并之间有时间差；② 把「主干有检查在跑」误当「主干有红」，主干越活跃越合不进去；③ 缺「基础设施类红」整个类别——本次主干红是 `[electron-ci-timeout-budget] elapsed=2101s budget=2100s rc=124`（超时预算差 1 秒，非断言失败），而唯一豁免出口 `--allow-main-red` 的语义是「本 PR 正是去修那条红」，这类红没有任何 PR 能修 ⇒ 全仓 PR 一起冻住。
- **关键事实**：实测分支保护两套机制（classic 4 条 + ruleset `main-ci-gate` 7 条），`strict_required_status_checks_policy=false` ⇒ **GitHub 本身并不要求「主干绿」**。这条是本仓自加的更严策略，目标正确但实现方式不可满足。
- **方案**：四阶段——主干基线化（约 0.5 天）／基础设施类红登记（约 1 天）／Merge Queue（约 3–5 天）／缩短 `electron-tests`（已由 `electron-ci-budget-rescale` 认领）。
- **本文只提案**：阶段 1/2/3 均属「改谁来守门」，`tasks.md` 0.1–0.4 列为前置裁决，未获人工批准不实施。

---
# feat(gates): 主干侧读数改为「最后一次完整结论」，解掉判据自身的「永不可绿」（main-red-run-baseline）

- 闸门不再要求「主干此刻全部检查都已完成」。主干每 15–30 分钟前进一次、整条质量门禁要 44 分钟，
  那个窗口的期望时长为负 ⇒ 以前常态落在「未证实」。现在改看「主干最后一次完整跑完的那一版」。
- 实测效果：一份 24 项检查全绿、`mergeable=MERGEABLE` 的 PR 从 `rc=3`（未证实）变为 `rc=0`（可以合）。
- 三条口径不可让：先判红再判未完成（反过来会把中间的真红读成绿）；某一版没有跑过任何作业时必须
  跳过而不是当成全绿；找不到绿基线一律按「未证实」处理（永不把 `rc=2` 放宽成 `rc=0`）。
- 两个改动必须配套：先去噪（下一条），再改判定语义；只做前者仍会被噪声卡住。

# fix(gates): 主干红闸门改读该 tip 的 run 集合 + 读数稳定窗重试（main-red-run-baseline）

- 并发合并时主干读数不再被同名噪声淹没：闸门原先读该 commit 上的全部检查，
  而 CI 失败处理器这类「由别的 CI 触发」的工作流会被 GitHub 挂到主干 tip 上，
  实测 102 行里 81 行是同一个名字的噪声——现在主干基准只认主干自己跑的作业。
- 读数期间主干被推进时，这次读数自动作废并重试（默认 3 次 × 90 秒），
  不再把「读的是旧主干」的结果当成当前主干的状态。
- 拿不到读数时会说清是「未证实」而不是含糊地说主干红；PR 自己的红仍会被点名。
# feat(podcast): 播客刀 4 第 3 片·下半——出期编排层（podcast-episode-tts-run）

- 新增出期编排层：一次 prepare（零出站：依赖校验 → 音色 → 分块 → 展示量估算）把音色/口语化/分块/合成
  四层串成一次出期，并给出「本期按原文播出（改写不可用）」这条提示文字的唯一依据位。
- 用户可感知：出期前能看到「共 N 字 / 将合成 N 段 / 预计 X–Y 分钟」三项预估；音色解析不出来时在**任何
  计费出站之前**就被拒（不烧 LLM 与 TTS 的钱）；口语化不可用时按原文出本期而不是整期失败。
- 同时对齐主干的音色契约改判：回退链已是两层（用户偏好 → capability 默认音色），本层不再消费已撤档的
  「频道 voiceRef」，定位键改为必填的默认 provider；`origin` 由三态收敛为「用户偏好 / provider 默认」两态。
- 回归锁 20 条，零真实出站；两条变异反证各自指名红（不透传默认 provider ⇒ 12 条红；把已撤档的档位塞回
  实现 ⇒ 恰好 1 条红）。
# fix(qm6): 闭合 #4151 留下的那条 dual 判定记录，并把「自扮演收口拿不到 tier=external」登记成合同（qm6-4151-ext-review）

> 标题末尾按合同写 **record 名（= 分支名）**。本条按 `changelog-record-carrier` 的合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` 零改动（那两个是聚合器专属的归档写面）。

- **解决的问题**：PR #4151（QM-6 收口值改由驱动侧写回器产出）合入时，随附的判定记录停在 `status=pending` 进了主干——当时全仓没有任何生产方会写 `tier`，那正是那一片要造的东西，于是它只能带着未闭合收口合入。
- **修法**：不改判据、不手写 `tier`。以 `critic=claude` 对**同一份载荷**重跑深审，逐条处置自扮演出口的 4 条争议（含把其中高危域那一条交独立外部复核，三格出处填进裁决文件、公开评论 URL 可点），重跑入口后记录收口为 `self_play_resolved`；出处按非高危面的 `closureNote` 档给（轮次标记 + 逐条处置结论）。
- **一条此前无人知道的事实**：判定记录名是**内容寻址**（`stagedDiffHash`），不是 commit sha ⇒ squash 后的主干提交逐字哈希回同一份载荷，深审入口可直接命中，不需要重建提交。
- **被实测否证的一句合同**：「做完外部复核后 `tier=external` 应由写回器自动产出」在自扮演这一档不成立——引擎把记录级 `performedBy` 写成 `self-play`，与写回器合取③（须逐字等于本轮 critic）结构互斥，写回器两次真跑两次如实拒写（`not-closed`、`backend-mismatch`）。自扮演收口本就不该盖 external，所以这是合同的适用范围问题，不是写回器的缺陷；已登记并把三个候选落点写明「属改谁来守门，须人工过目」。
- **顺带登记的真实缺口**：两张守门表（`RULES.sensitivePaths` × `HIGH_RISK_SURFACES`）没有同步机制——判据本体在表内、它消费的摘要库在表外，改库不改表则矩阵对「谁在守门」始终失明（外部复核指认，比本仓原先记的「漏登记一行前缀」深）。
# fix(ci): 定时作业全部接进失败自动报警，并加一把防漂移锁（schedule-failure-watch）

- 现场：`Cleanup Artifacts` 的 schedule run 连红 9 次无人发现（run `38385152658`…`39570873661`，2026-10-13 ~ 10-21；最后一次成功是 run `38239617921`，10-12）。报警装置其实早就有（`ci-failure-handler.yml`：`workflow_run` 失败 ⇒ 自动开 Issue + PR 留言），但它的工作流名单是手抄的 5 个名字，仓里 4 条带 `on.schedule:` 的作业一条都不在里面 —— 定时作业没有 PR、不参与 required check，红了只落在 Actions UI 里。
- 修法：名单补齐 4 条定时作业；新增判据本体 `scripts/check-schedule-failure-watch.js`，**双向**对账（带 schedule 的必须被覆盖 / 名单里的名字必须还存在），三种"工具失明"统一判 `SCANNER_FAULT` 而不是退化成"没有定时作业 ⇒ 全绿"；接进 `quality-gate.yml` 的 `changes` 作业 `Gate 2b13`（放 `static-gates` 等于给自己关校验，因为 `.github/workflows/**` 在 docs-only 白名单里）。
- 行为锁 13 条（夹具正反控 + 真仓规模下界 + 接线自检 + 驱动追踪锁 + 缩进弹性 + 合取条件反形夹具）；变异驱动入仓，10 条变异终跑 `CAUGHT=9 / MISSED=1 / PROBLEM=0`，唯一那条 MISSED（空扫描域守卫）的重叠由另一条变异 m4b 机械证明。驱动首跑时 7 条里 5 条 MISSED，查出 3 条是测试写空（单向夹具、匹配不上的锚点、摘断言本身），补成 T10 / 重写 T3 / 把反证靶子改到 workflow 接线行；第二轮又给驱动加了两道自我校验（"声明冗余却被抓住"与"写后回读不符"），当场否证了我贴在 m3 上的"冗余"标签。
# docs(video): 用户手册数字人章节补 HeyGen 角色表与数据流（user-manual-avatar-heygen-flow）

- 视频创作手册「数字人口播」新增两节：HeyGen 在四阶段管线里的职责边界（只负责 generate，且是唯一数字人供应商），以及从拉形象/音色列表到提交、轮询、下载的完整数据流。
- 明确数字人分支与通用文生视频不是同一条链路，避免用户误以为切换默认视频模型会影响数字人。
# fix(ci): artifact 清理定时作业改为逐页列举 + 重试，首页失败不再被读成"没有待删条目"（artifact-cleanup-resilient）

- 症状：`Cleanup Artifacts` 自 2026-10-21 回溯连续 8 天 `completed failure`，日志只有一句 `unexpected end of JSON input`，看着像脚本坏了。
- 真因：GitHub 的 artifacts 列举接口对本仓（`total_count=5350`，约 54 页）返回**间歇性 500 空体**（实测同一 URL 一次 500 一次 200），而 `gh api --paginate` 把全部页绑成一条管道、无重试，`set -euo pipefail` 于是每天必退出。
- 修法：逻辑从 `run:` 块搬进 `scripts/cleanup-artifacts.js` —— 逐页列举 + 每页重试；首页彻底失败判 `UNPROVEN` 且一条都不删，半途失败判 `DEGRADED`（已列举部分照常处理、结论不得是 OK）；默认 dry-run，真删要显式 `--write`；DELETE 带 `--silent`（204 空体与上面的 500 同形，属潜伏的第二颗雷）。
- 两条边界口径（外部双模型评审命中后补）：**仓库坐标由调用点在命令行上显式给**，禁止只在 workflow 的 `env:` 里声明一个脚本不读的键；**上游返回的 id 进 DELETE 路径段前按形状收口**（只接受正整数），其余计入首行的 `rejected=` 并把结论压成 `REJECTED_PRESENT`、非零退出 —— "有条目被我拒了"不许被读成"清理做完了"。
- 新增行为锁 15 条 + 变异反证 11 条全指名，**变异驱动本体也入仓**（`scripts/cleanup-artifacts.mutation.js`，自带"脏树拒绝 + 锚点命中恰为 1 + 多靶子 + 还原后再跑一次被测锁"四条前置），接进 `quality-gate.yml` 的 `changes` 作业（`Gate 2b12`），使这段逻辑从此在每次 PR 上被执行过。
# fix(gates): 合并提交按「两侧交集」判档、零语义合并判 skip 且不落盘，判定记录补尾换行（ccg-decider-merge-skip）

- **现场（遗留 10，不是理论风险）**：`scripts/ccg-review-decider.js` 在**合并提交**上读的是 `git diff --cached`，
  而 merge 提交的暂存面语义是「ours tip → 合并结果」，也就是**对方那一侧**的全部改动。实测一份 merge 提交的
  pre-commit 产物：`mode=dual` / `deepReview.status=pending` / `stats.changedLines=1880` / `fileCount=27` /
  `codeFileCount=20`，而这批改动里**没有一行**是本分支写的。后果不是「多跑一次审查」，而是把「需不需要 CCG 审查」
  机械地推向 `dual`，并让一份待审记录永久挂在那里（`check-pr-exec-record.js` 的欠账面按 `mode=dual` 取）。
- **修法（判定范围收敛）**：`detectMergeState()` 用 `git rev-parse --verify MERGE_HEAD` 探测合并态——
  不硬编码 `.git/MERGE_HEAD`，因为 linked worktree 的 `.git` 是**文件**、那条路径在那里恒不存在，
  硬编码会让修法在 worktree 里静默失效（而本仓所有运行时代码任务都在 worktree 里做）。
  `collectMergeStaged()` 以 `merge-base HEAD MERGE_HEAD` 为 base，两侧各取
  `git diff --name-only --no-renames <base> <rev>` 后取**交集**，再以交集为 pathspec 走既有 `collectFromDiff`
  ⇒ 判定范围回到「双方都动过的文件」。
- **为什么是「交集」而不是并集 / 单侧 / 只取冲突文件**：并集把对方整侧导入又搬回来（原缺陷本身）；单侧会漏掉
  「我方和对方都改了同一文件」里对方那一份；冲突文件列表在**无冲突合并**上恒为空，而后者是最常见的形态。
  副作用是**保守放大**（交集内按 `HEAD` 统计），已在 `design.md` §9 作为残余风险登记，不假装精确。
- **零语义合并**：交集为空 ⇒ `judge()` 在阈值链**之前**显式判 `skip`，理由写「交集为空」而不是「≤10 行」——
  后者会让「普通小改动」与「合并没带来双方共同改动」两个事实共用同一句话。`main()` 在 `mode==='skip' && mergeScope`
  时**不落盘**（`skip` 本来就不是待审记录）。
- **pathspec 必须用 `:(literal)` magic**：交集里的文件名可能含 glob 元字符（`[`/`]` 在 Windows 文件名里合法且仍是
  pathspec 元字符），裸路径会被当成模式**放大**判定范围。
- **内容寻址键与判定范围同源**：`saveRecord` 新增第 6 参 `opts.diffPaths`，默认值与历史配方逐字节相等 ⇒
  非合并态路径**零行为变化**；合并态让「判定范围」与 `stagedDiffHash` 用同一组 pathspec，否则记录名按全域算、
  内容按交集算，读的人无从比对。
- **遗留 7（尾换行）**：两处写盘抽成单点 `recordBody()` = `JSON.stringify(record, null, 2) + "\n"`；
  不回溯清理历史存量（存量缺尾换行的量级见本文「遗留 7 的行为证据」）。
- **评审派生项**：i1 把「探测失明」与「不在合并中」分开（`probeError` 出声告警，仍 fail-open）；
  i6 在判定域漏进非交集文件时**升 `dual`（fail-closed）**并告警，不抛错（交集内两侧相同改动的文件不进 numstat，
  故取上界判据，`files.length` 合法地更小）。
- **测试与反证**：既有 59 例 + T1–T11 = **70/70 全绿**（真 git 仓库夹具，`git merge --no-ff --no-commit` 保持
  `MERGE_HEAD`；含 linked worktree 档与 CLI 级接线锁）；变异 M1–M14 **全部 CAUGHT**，且 M12/M13/M14 红集互不相交
  （M15 为预测项，未实测，不计入）。
- **遗留（明确不在本 PR 范围）**：6 `STALE_REQUIRED` 处方文案、8 CHANGELOG 长度无门禁、9 `CreateView.test.js`
  单文件 A/B。其中 6 与 8 属「改谁来守门」，须人工过目，不走 agent 自动合并。
# feat(gates): 发版门禁改为先取证再判 —— 台账未由聚合器收口时直接拦下（changelog-rollout-release-gate）

- `scripts/release-gate.mjs` 现在在任何"读 CHANGELOG 内容"的判据**之前**取聚合器读数，并把三类失败拆成三条文案：`AGGREGATE_FAIL`（取不到数 / 聚合器 rc≠0 / `records=0` 采集面退化 / 数值读不出）、`AGGREGATE_PENDING`（确有 N 条待搬，逐字给出 `node scripts/aggregate-changelog.js --write`）、原有的 `CHANGELOG 未收口`。合并成一句会让人去手改 CHANGELOG 而不是修聚合器，这是本条的全部动机。
- 校验侧**只读取数不写台账**（旗标清单 `AGGREGATE_READ_ARGS = ['--dry-run']` 是唯一的、且由 R13 + R10/R12 的实收 argv 双向钉住）：CI 在 tag push 上是一次性检出，写出的改动没人能提交。
- `openspec/records/_TEMPLATE.md` 补上 `## CHANGELOG 条目` 与 `## learnings` 两个小节和形状说明，AGENTS.md 的 `CHANGELOG.md` 条目改写为"PR 不得直接编辑台账、只写自己的执行记录"，并写清发版顺序 `--write → 收口版本小节 → bump → tag`。
- 行为锁 23 条（既有 9 条同步改为必须带聚合器读数；深审后追加 R14）+ 变异反证 7 条全指名、采纳 i5–i8 后在最终基线重跑一遍仍全指名；真仓现场：`release-gate` 实跑报 `AGGREGATE_PENDING … 2 条（CHANGELOG 1 / learnings 1, records=619）` rc=1，`check-pr-exec-record --mode=enforce` rc=0。
# fix(accounts): 保存账号时用平台 API 兜底昵称/头像，修 SPA 平台回落成平台名（fix-account-profile-fallback）

- **问题**：头条号等 SPA 后台登录成功后，保存的账号「账号名」显示成平台名（如「今日头条」）、头像为空，用户无法区分同平台的多个账号。
- **根因**：不是选择器写错，而是**采集时机早于 SPA 渲染完成**。登录成功判据命中 URL 后，`_scheduleAutoCompletion` 只等 3000ms 就提取资料，而日志实测头条号后台页面渲染持续了 56 秒——昵称节点那时还没出现，DOM 采集跑在空 DOM 上返回 `{}`，`profileForCreate` 遂把 `account_name` 回落成 `name`（平台显示名）。用户随后点「保存账号」也已晚：登录尝试早被自动完成消费并关闭，那一下没有重新采集。
- **修复**：新增 `fillProfileFromHttpApi()`，`saveCapturedAccount` 在 DOM 采集后调用。判据是「没有拿到真昵称（回落成了 name）」；命中则用**已捕获的 Cookie** 调平台创作者 API，逐个判空补位（昵称/平台 ID/粉丝/头像），不覆盖 DOM 已拿到的值、不改变 `name`。任何失败只记 warn，**绝不阻断账号创建**。8 个平台（抖音/头条/视频号/B站/快手/小红书/知乎/公众号）共用同一批已注册端点，不新增端点。
- **不做的**：不调大 `_scheduleAutoCompletion` 的 3 秒延时（会拖慢每个平台的登录完成感知，而 API 兜底已能拿到结构化数据）；不给 extract 补头像字段（需逐个平台找，属独立任务）。
- **已知限制**：当前 8 个平台的 extract 都不返回头像，所以修复后昵称与平台 ID 能补上，**头像仍可能为空**；头像回填依赖用户点账号卡片「检测登录态」时的 DOM/HTTP 回填路径。
- **提示文字**：零改动，不新增/不修改任何 i18n 键。
- **回归保护**：`account-manager.test.js` 新增 4 例（DOM 失败时补真实昵称/ID/粉丝、DOM 成功时不发请求、兜底只补空位不覆盖已命中昵称、兜底失败不阻断创建）；变异反证通过（摘掉修复，2 个核心用例当场变红）。
- **文档**：PRD 新增 §「账号资料采集兜底：SPA 平台昵称/头像回落」；新增 `01-docs/PRD-ACCOUNT-PROFILE-FALLBACK-2026-10-21.md`。

---
# fix(deps): 长度三档映射的 max 统一提到 50000，与引擎输出上限对齐（fix-length-range-max-50000）

- **改前**：`_LENGTH_RANGES` 三档的 max 是 **3000 / 800 / 5000**——那是 2026-09（全局输出上限还是 6000 字时）定的，
  引擎在 `rewrite-limits-50000`（2026-10-19）把上限放到 50000 后**它们没跟着放大** ⇒
  走 length 路径的改写最多只能出 3000 字，成了整套体系里最紧的一道「暗上限」。
- **改后**：三档 max 统一 **50000**（与引擎 `MAX_OUTPUT_CHARS` 对齐）：
  `keep` (300,50000,1500) / `compress` (100,50000,400) / `expand` (800,50000,2500)。
  这三档是**有活 UI 的**用户选项（自动流水线视图的「长度」下拉：保持原文 / 精简 / 扩写）。
- **target 保持原值**：它才是 prompt 里「目标 N 字」的锚（实际篇幅的落点），max 只是硬上界——
  改 max 解除人为上限，改 target 才会改变实际篇幅（那是另一件事，本次不做）。
- **数字来历已写进代码注释**（免得下次再考古）：`keep` 的 (300,3000,1500) 是外部引擎 `RewriteConfig` 的
  **默认值逐字**；`compress`/`expand` 是 2026-09-06 `d0a9b00ba` 里人工挑的相对档（以 keep 为轴约缩 1/4 / 放大约 5/3），
  该提交未记录推导过程。
- **回归**：新增用例把「三档 max == 引擎上限」钉成可执行契约，将来谁写小就红。
# fix(video): HeyGen 数字人 Adapter 按官方 v2 契约修正请求体、轮询端点与认证头（heygen-adapter-contract）

- 修复数字人流水线首次真实调用必失败的三处契约错位：`video_inputs[].character/voice` 改为官方对象形状（含 `dimension`），轮询改为 `GET /v1/video_status.get?video_id=`，认证改为单一 `X-Api-Key`。
- 回归锁改为按官方契约断言（旧测试断言的是自家错误形状，等于把 bug 写成期望值），并新增「不得发送 `Authorization`」的反向断言。
# feat(gates): 热写面禁改门禁以 advisory 档接进 changes 作业（hot-carrier-edit-gate）

- **拦什么**：`CHANGELOG.md` / `01-docs/learnings.md` 的 PR 顶插。实测 4/4 个可判定的 CONFLICTING PR 冲突文件只有这两个，20/30 笔 main 提交动过台账 —— CI 全绿也合不进去，还要再跑一轮 25–30 分钟。
- **判据输入是 PR 差量（merge-base..head），不是文件现状**：按现状写会把别人刚并入 main 的台账行算到我头上（本仓实测全树比较 5 例里 3 例这类假阳性）。`T4` 专门站在"我 rebase 之后工作树里确实有别人的台账改动"的形态上判 PASS，变异 MA（退回读现状）指名让它变红。
- **先 advisory 不 enforce**：在飞 PR 绝大多数已按旧规改了台账，一上来就阻断会把它们全判红，而那不是它们的错。档位由判据首行 `MODE=` 自己声明，两档点名内容逐字一致、只在是否阻断上分档（`T8`）。转档前置条件写在 tasks 4.3。
- **授权出口必须是"本次差量新增"**：沿用 `changelog-dedup-authorization.json` 那条已验证形态 —— 坐标核对 + 常驻通行证不生效。此处踩过一条有代表性的坑：变异 MC 第一次报 NOT_CAUGHT，原因是 `readAuth` 读 head blob 独立挡住了，属**防御重叠不可分辨**而非锁没牙；补 `T6c`（授权同时在工作树与 head blob、坐标恰等于本次 merge-base，对应 CI 里 PR 建好后 main 未前进的形态）把重叠拆掉后才指名变红。
- **差异审计**：动代码前查到 `hot-carrier-atomic-landing`（规格已合入、实现未做）的 D4 明确把这两个路径移出它的热点清单，理由是"没量过"。两者量的是不同失效（共享根未提交窗口 vs 跨 worktree PR 冲突），已在 spec 里新增一条 Requirement 禁止把两份清单"顺手统一"，并写明本读数不满足它的重进前提。
- **CI 上取的 head 必须是 PR head sha，不能是 `HEAD`**：`pull_request` 事件 `actions/checkout` 检出 merge ref，`base.sha..HEAD` 于是把别人在 base 之后并入 main 的台账改动算成本 PR 的（现场 run `39536655940`：`命中热写面=2 判定=FAIL`，那两个文件不是本 PR 改的）。今天 advisory 不拦，转 enforce 那天会拦下每一个 base 落后的 PR。锁：`T12`（merge ref 形态）+ `T13`（接线锁：`CL_HEAD` 必须真在 `env:` 里）+ 变异 `M11`（删掉装配面必须红）。
- 行为锁 16 条 + 变异反证 9 条全指名；本 PR 零改动台账与 learnings。
# docs(memory): PR-2 影视工程提示词三分（F-A）的 7 条可复用教训（mem-film-prompt-triple-impl）

- **本次只沉淀记忆，零运行时改动**：上游 PR #4127（F-A 分镜提示词三分）已合并（`05e83ddf1`），本篇把这轮**验证层对抗评审**里最值钱的 7 条教训写成仓内可检索形态。
- **落在执行记录而不是台账**：`CHANGELOG.md` 与 `01-docs/learnings.md` 的写入方只能是聚合器 `scripts/aggregate-changelog.js`（`changelog-record-carrier` 新合同），PR 差量里动这两个文件会被热写面门禁点名（当前 advisory 档，2026-10-21 由 #4145 落地）。
- **三路记忆同批写入**：内置记忆（`~/.dsh/profiles/`）、外部记忆（本机 gstack `learnings.jsonl` + 仓内本篇）、EverOS（`add → accumulated` → `flush → extracted`，并**回读 episode 文件**核验 —— 接口返回码不算成功证据）。
- **7 条教训的性质**：自扮演裁决的机械语义（`upheld` 不是闭环）、引擎回写会**整体替换** `deepReview`、评审产物名是暂存 diff 的**内容地址**、「不要丢内容」要先看清相对**哪一份**内容、写阈值前先量资产形态、RED 证明只能回退实现前就存在的文件、同类产物的结尾换行有两套惯例。
# feat(账号): 「添加账号」的平台选择器改为应用内自绘浮层——图标 / 搜索 / 分组 / 键盘全可控（platform-picker-ux）

> 标题末尾按合同写 **record 名（= 分支名）**。
> 本条按 `changelog-record-carrier` 的新合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面）。

- **用户现场**：账号管理页点「+ 添加账号」，展开「平台」下拉时看到的是**操作系统绘制的系统列表**——系统蓝高亮、直角、无平台图标、15 个平台平铺一条、没有搜索也没有分组；列表还从弹窗里「长」出来盖住底部的「打开登录页 / 取消」按钮。用户反馈：「这个 UI 界面非常粗糙，不精致」。
- **第一性原因（不是样式问题，是控件选型问题）**：`UiSelect` 用的是原生 `<select>` + `appearance: none`。`appearance: none` 只能去掉**收起态**的原生外观（箭头、边框）；一旦展开，弹出列表由**操作系统**绘制 ⇒ **CSS 完全无法介入**。圆角、配色、图标、分组、搜索、动效全都不归本应用管 —— 这不是「样式没写好」，是「控件选错了」。任何在原生下拉上做的视觉优化都改不动展开态。
- **修复（换成应用内自绘的浮层）**：新增 `AccountPlatformPicker`，展开态完全由本应用绘制——
  - **平台图标**：复用现成的 `PlatformIcon`（15 个平台真实品牌 SVG，无图时回退品牌色首字块），不再是一行行纯文字；
  - **搜索**：按平台显示名与平台 id **双路**匹配（大小写不敏感），`dou` 命中抖音、`XiaoHongShu` 命中小红书；纯空格输入等价于空输入（不误伤「随手打一个空格结果列表全没了」）；
  - **分组**：按平台目录的分类分成「国内平台 / 国际平台」两组（口径与发布页同源），**空组整组不渲染**，不留空标题；
  - **收起态**：显示已选平台的**图标 + 名称**，随时能确认「我现在选的是哪个」；未选时用更浅的占位色（不靠字号区分）；
  - **已选项**：列表里带勾选标记 + 主色底 + 主色文字三重表达，颜色不是唯一信息载体；
  - **键盘全可达**：`role="combobox"` + `role="listbox"` + `aria-activedescendant`；↑↓ 移动、Enter 选中、Esc 收起并把焦点交还触发器；下方空间不足时**向上翻转**，浮层宽度与触发器对齐。
- **顺带修掉三处观感问题**（真实渲染出图后逐条对照）：① 搜索框焦点环原是「描边叠在边框上」的粗重双层紫环 ⇒ 改为与既有 `UiSelect` 同口径的「主色边框 + 14% 柔光环」；② 浮层最大高度 320px 时只能露出 5 个平台 ⇒ 提到 420px（可见 8 个，其余滚动）；③ 浮层宽度取 320 会比触发器宽出一截、右边缘对不齐 ⇒ 取 300，在本仓 360px 弹窗里恰好等于触发器宽度；另把「鼠标点开时预置首项高亮」改为「**不预置**（不出现『鼠标并不在那儿却像被悬停』的幽灵高亮），已选平台则作为激活项，让用户看到『我现在在哪个平台上』」。
- **连带把一个死组件接上线**：`PlatformIcon.vue` 自 2026-10-19 起挂在「未接线组件」欠账清单上（生产面零引用），本 PR 复用它 ⇒ 欠账清单对应条目销账（清单只能缩小）。复用现成的 15 平台图标实现，比在新组件里再造一份图标表更少漂移。
- **分组口径的一处结构缺口**：平台目录的分类值是中文「中文 / 海外」，UI 层若直接拿它比字符串，就得在渲染端代码里写中文字面量（本仓 `locale-sync --cjk` 门禁对新增硬编码中文零容忍）。故在 `stores/platforms.js` 新增 `getCategoryGroup(id)`，把分类翻成 `domestic` / `international` 结构键 —— **中文值只留在 store 与 locale 两处**，新的调用方不会再写第二份。
- **回归保护**：新增 `AccountPlatformPicker.test.js` **22 例**（展开/收起、显示名过滤、id 过滤且大小写不敏感、纯空格等价空输入、两种空态、点击选项 emit 并收起、已选项勾选态、键盘上下移动与边界不循环、Esc、点击外部、焦点回收、重复 id 去重、缺失 label 回退、禁用态、无幽灵高亮、激活项落已选平台）；`stores/platforms.test.js` 新增 2 例；`AccountLoginDialog.test.js` 更新 stub 并新增 1 例。视觉侧新增 `accounts-platform-picker` 工作流（开弹窗 → 展开浮层 → 搜索 → Esc → 关弹窗 → 复位），覆盖交互级回归。
- **如实留白**：**「浮层展开态」的像素基线尚未建立** —— 本仓基线必须与 CI 同一次渲染逐像素相等（Gate 7b 判 0 px），本机截图当基线被明确禁止；且视图注册表是路由级的，渲染不出「浮层已展开」这个交互态。本 PR 补的是**交互层**保护，像素基线留作后续一刀（给视觉套件补一条带 `prepare` 钩子的用例，由 CI 产出同源渲染后再落 PNG）。
# feat(qm6): 把 QM-6 的立项读数从一次性手工探针收进仓内普查工具（qm6-writeback-survey-tab）

> 标题末尾按合同写 **record 名（= 分支名）**。本条按 `changelog-record-carrier` 的合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` 零改动（那两个是聚合器专属的归档写面）。

- **解决的问题**：design §2 那三条立项读数（判定域规模、闭环 × `tier` 交叉表、野值条数）此前由会话临时手写探针量出来、抄进文档，下一次会话无法重取，也分不清「量过一次没人再量」和「现状」。
- **修法**：`scripts/ccg-artifact-shape-survey.js` 改为库 + CLI 双形态，交叉表由 `summarizeClosedTier` 产出，**工具自报它量的是哪个 commit**（`REF=origin/main@<9位>`）——主干每几分钟长一块，不带 commit 的数无法归因（实测同一条命令隔 4 分钟 1658→1662）。闭环词表与 tier 词表**都不在工具里抄**：`closedSet` 与 `vocabOf` 是调用方显式透传的注入参数，缺任一当场抛错；词表由判据的 `classifyEvidenceTier` 现问，避免第二份事实。
- **口径变更不可比**：旧探针按 `{external, unknown, 其它}` 分桶（`其它` 里混着 `self-play`），工具按判据词表分桶。22→3 这类数字**不能**读成"欠账少了 19 条"。
- **门禁**：`Gate 2b10`（changes 作业，`shell: bash`）跑其单测并自带判定域非空与两条形状下界；真仓全量采集**刻意不进 CI**（逐文件 `git show` 在 1.6k 份产物上实测 4 分钟）。
- **读数**：`node scripts/ccg-artifact-shape-survey.js --ref=origin/main` 的 `[闭环×tier]` 一行（活数，引用时现跑）。

# feat(qm6): QM-6 的 `tier=external` 改由驱动写回，收口不再需要人手写（qm6-writeback-survey-tab）

- **解决的问题**：收口矩阵要求高危面必须有 `deepReview.tier=external` + 可核 `evidence`，但**全仓没有任何组件写这两个字段**——仓外评审引擎的 `writeBack` 是 `rec.deepReview = deepReview` 的整体替换（会把判定器初值里的 `tier`/`evidence` 键吃掉），引擎全文 `tier` 出现 0 次。后果不是"少个字段"，而是**跑了真评审在结构上比什么都没做更差**，合规的人只能手写（#3987 / #4071 的 `tier` 都是会话手写的）。
- **修法**：① `scripts/lib/ccg-delivery-digest.js` 收住唯一一份规范化（对象递归按**键名码点**升序、数组保序、`JSON.stringify(v, null, 0)`、sha256 小写 64 hex），写回器与判据都 require 它；② `scripts/ccg-review-writeback.js` 按**五条合取**决定写不写：闭环 status / `deepReview.findings` 是非空数组 / `performedBy` 等于上层透传的期望后端 / 动手前后**字节与去掉 `at` 的语义指纹都变了** / 记录路径由上层显式透传。任一不成立 ⇒ 不写、不改 status、点名缺哪一条（`not-closed` / `empty-findings` / `backend-mismatch` / `no-write` / `no-new-delivery` / `before-state-missing` / `record-unreadable`）；③ `scripts/deep-review.sh` 的两条真跑 `exec` 改为「取动手前哈希 → 调驱动 → 立刻 `_wb_rc=$?` → 写回 → `exit "$_wb_rc"`」，`--dry-run` 与引擎缺失出口不引入写回；④ 判据侧 `evidenceForm()` 增 `delivery` 档并**就地重算**（不只看形状），失配降 `external-unverified`，红文案只说「摘要与本记录重算值不符」，不说"伪造"。
- **强度边界（不夸大）**：`delivery@` 摘要任何填写方一条命令可自算，它提供的是"写回器与判据可互验"，**不是签名、不防伪造、不抬高成本**；手写 `tier` 仍然能过判据，但那属代用，必须同次在记录里写明。
- **两条由自测抓出的真 bug**（都不是评审提的）：① 入口用 `sha256sum` 量原始字节、写回器一度 `sha256Hex(bytes.toString('binary'))` 会把非 ASCII 按 utf8 重编码 ⇒ 两侧永远不等 ⇒ `no-write` 永久点不到火；② `beforeSha` 为空时原实现整格跳过并照样打勾 ⇒ 新增 `before-state-missing` fail-closed。
- **外部深审第 2 轮抓出的 Critical（i1）**：`④` 的第二半（"只有时间戳在变不算新交付"）原先只在调用方给 Buffer 时才生效，而生产入口只传十六进制串 ⇒ 真跑路径上那一格永远不触发，"只刷 `at` 的旧闭环"会被写上 `tier=external`。修法是把 ④ 的两半都变成**必需**：入口在调驱动之前用共享实现取动手前语义指纹（`lib/ccg-delivery-digest.js --print-fingerprint`），与字节哈希一起透传；缺一半 ⇒ `before-state-missing` 拒写。同一轮还补了「夹具 require 闭包必须由真实 require 图推出、不得手抄」的完整性锁。
- **证据**：`scripts/deep-review-entry-rc.test.js`（9 条，真跑入口、假驱动、rc 逐字相等与信号终止的**实测**读数）、`scripts/ccg-review-writeback.test.js`（19 条）、`scripts/ccg-delivery-digest.test.js`（8 条，含写死的规范化行为向量与两条"换一个就改数"对偶）、`scripts/ccg-closure-writeback-chain.test.js`（3 条，示踪弹）；变异反证 6 条全部指名红并逐条还原核对。接线：`Gate 2b11`（changes 作业）。
- **本片刻意不做**：跨仓 parity 锁（D5 / tasks §5）随下一片走，理由三条写在 tasks §5 段首，spec delta 里那条 Requirement 已整条移出——规格不写没实现的要求。
# refactor(改写): 改写页视图解耦 —— RewriteView.vue 拆 3 个 composable + 外置样式（1430 → 977 行）（rewrite-view-decompose）

> 标题末尾按合同写 **record 名（= 分支名）**，本条即 `rewrite-view-decompose`。
> 按 `changelog-record-carrier` 的合同，本条写在执行记录里，`CHANGELOG.md` 与
> `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面，由
> `node scripts/aggregate-changelog.js --write` 在发版时统一搬运，幂等键是 record 名）。

- **问题**：`apps/desktop/src/views/RewriteView.vue` 实测 **1430 行**，正好等于行数门禁的**登记值**（`.github/scripts/max-lines-baseline.json` 的 `files` 表）。门禁 `growthAllowance = 200` ⇒ 硬天花板 **1630 行** ⇒ **这个文件此刻一点余量都没有**：下一次给改写页加功能（哪怕只加 201 行）就会撞 `LEDGER_GREW` 阻断。PR #4141 的 CHANGELOG 已把这条记进仓库（「解法是**拆 composable**……但 PR 未落地」），本次把那把刀补上。
- **拆法**（**用户可见行为零变化，模板一行未改**）：① 全部 `<style scoped>`（321 行）外置为 `apps/desktop/src/views/rewrite-view.css`，视图改用 `<style scoped src="./rewrite-view.css">`（`scoped` + `src` 由 Vue SFC 编译器施加同一 scope id，`:deep()` 语义相同；仓库已有 5 处同型用法）；② 字数区间（状态 + 校验接线 + 自适应推导）→ `composables/useRewriteWordCount.js`；③ 策略（列表加载 + 预览 + 竞态守卫 + 300ms 防抖）→ `composables/useRewriteStrategy.js`；④ 文案库回写（两条互斥写入路径 + djb2 哈希）→ `composables/useRewriteLibrarySync.js`。
- **结果**：`RewriteView.vue` **1430 → 977 行**，距天花板余量 200 → **653 行**；顺带把聚合债务账 `filesOver1000` 由 **29 降到 28**（`scripts/check-debt-budget.js` 实测读数）。
- **回归保护**：3 个新测试文件共 **29 例**。其中「手动置位后自适应不得覆盖用户值」「竞态守卫」「300ms 正文防抖」三条是**搬出视图后第一次有独立测试锁住**的契约 —— 它们在视图里只是「一个 `let previewSeq` 加一个定时器」「一行 `if (!wordCountManuallySet)`」，此前没有任何测试守过。
- **既有结构锁一条未削弱**：`utils/rewrite-lineage.test.js`（要求 `RewriteView.vue` 源码里能读到 `aiRewrite(` 与 `utils/rewrite-lineage` 引用）与 `views/CopyLibraryView.test.js`（要求能读到 `podcast.activeChannelId.value`、不得有 `|| await ensureChannel()` 死分支）—— 这正是「`aiRewrite` 调用 / 归因链 / 文本出期入口**不搬走**」的原因。
- **顺带修掉一处脚手架脆弱点**：`RewriteView.sensitive-warning.test.js` 首测的 10s 预算被「Vite 一次性编译整张依赖图」（实测 3706ms → 4190ms）吃光，冷缓存同片并发时超时。改法：把一次性编译挪进 `beforeAll` 并给显式预算，**每条用例的断言窗口仍是 10s**（首测 6235ms → **159ms**）。**不全局抬 `testTimeout`** —— 那会让真正挂死的用例也一起放宽。
- **CCG 外部双家族评审**：critic=claude（8 条问题 / 4 个维度 / 最低分 5）+ proposer=opencode（跨家族校验通过）。6 条争议逐条裁决：**i1 / i4 / i5 成立并已修**（策略监听收进 effectScope、补构建产物级证据、视觉契约断言改判据）；**i2 高危域**走外部复核（claude 独立判定不成立，证据在 PR 评论）；**i3 / i6 不成立**（i3 有 A/B 与 CI 两档读数，i6 有现网 16 条同类条目为证）。
- **明确不做**（各自需另开 PRD）：改任何用户可见行为；拆**模板**成子组件（父组件 `scoped` 样式不作用于子组件内部元素）；下调 `max-lines-baseline` 登记值（属「改谁来守门」，需人工过目）；改 djb2 回写 key 算法（会让既有文案库记录失联）；全局抬高 `testTimeout`；处理其它 28 个 ≥1000 行的文件。
- **文档**：新增 `01-docs/PRD-REWRITE-VIEW-DECOMPOSITION-2026-10-21.md`（逐模块写清数据校验判据与阈值、流程、功能逻辑、交互逻辑、显示项、提示文字原文）；`PRD-REWRITE-PAGE-UI-2026-09-16.md` / `PRD-REWRITE-WORD-COUNT-CONTROL-2026-09-12.md` / `PRD-REWRITE-STRATEGY-UI-2026-09-15.md` 各补一节「归属变更」附注。
# feat(ci): 收紧债务基线后重算在飞 PR 并点名陈旧结论——pull_request 的绿 run 钉在旧 merge ref 上，新红线从没量过它（debt-baseline-recheck）

- **一句话**：`pull_request` 的 run 固定在**触发那一刻**的 merge ref 上，主干前进不会重跑；于是收紧 `scripts/debt-baseline.json` 之后，一笔带着**旧基线绿结论**的 PR 照样满足 required check、照样被自动合并，主干当场变红——红线是新收紧的，可没有任何东西拿它量过这笔 PR。
- **动因是当下主干上的读数，不是推演**（探针逐条取 `check-runs` 的 `completed_at` 与基线最近一次变更时刻比大小）：open PR 30 个，**4 笔顶着陈旧绿**，最久的 #3376 那条绿 run 完成于 2026-10-12、基线 2026-10-19 收紧 ⇒ **陈旧 7 天**；另有 7 笔一条 check 都没生成（属另一族，见 `openspec/records/*` 与「不做」条）。频率侧：近 30 天基线变更 **12 次**、判据本体 `check-debt-budget.js` 变更 1 次 ⇒ 触发 `paths:` 必须**同时盯这两份**，只盯数据文件会漏掉"度量口径被收紧"那一半。单次重算本机实测 **1.9 秒** ⇒ 30 笔的判据部分约 57 秒；CI 侧 fetch/合成提交/worktree/评论写入**未测**，所以要求首次运行逐笔打印实测再回填，而不是先估一个"约 N 分钟"。
- **修法（只做「重算 + 点名」，刻意不阻断）**：新增 `scripts/check-debt-recheck.js`（一切外部依赖注入、测试面零网络，生产走 `--live`）与 `.github/workflows/debt-baseline-recheck.yml`（主干上那两份守门输入变化时触发，外加 `workflow_dispatch`）。逐笔 PR 用 `git merge-tree --write-tree` 造合并态 ⇒ `commit-tree` 封成合成提交 ⇒ `worktree add --detach` 只读检出 ⇒ **在那个树里**跑 `check-debt-budget.js`。它是**非 required** 作业，不申请 `checks: write`，不改任何分支保护/ruleset，不自动 rebase 别人的 PR。
- **合并态天然解决基线归属，没有特例**：PR 没动基线 ⇒ 读到的是主干当下收紧后的那份（正是本刀要量的那一格）；PR 自己改了基线 ⇒ 读到的是它提议的那份（不得没收一个正在还债的 PR 的提议）。这条"不特例"由**真 git 临时仓库集成用例**证明——读源码证明不了 merge-tree 的产物归属。
- **⛔ 两条被自家实测否证的写法，必须留字**：① 初稿写"真冲突时 `merge-tree` 首行不是树 oid"，实测**假**——真冲突是 `rc=1`、**首行仍是那个冲突树的 oid**、stdout 含 `Auto-merging`/`CONFLICT`、**stderr 零字节**；按首行或按 stderr 分类都会把真冲突读成"合并成功"，而拿冲突树去量指标**一定**判"在基线内"，是这条链最坏的静默失效。② 浅历史给的**不是**假冲突而是 `rc=128 / refusing to merge unrelated histories` ⇒ 必须独立成 `unrelated-histories` 一档并让整轮非零退出、只归因一次；否则一次 `fetch-depth` 配错会在 30 个 PR 上刷出 30 条"你的 PR 合不进主干"的假判决。附带一条夹具纪律：本地路径 `clone --depth 1` 会**忽略** `--depth`（实测 warning），要量浅历史必须走 `file://`。
- **四档 + 封闭 reason 词表 + 空集出行**：`IN_BASELINE / VIOLATES / UNJUDGEABLE / CHECKER_FAILED`，后两档不得折叠成"通过"；`UNJUDGEABLE` 的 `reason` 取自封闭词表 `{conflict, unrelated-histories, ref-missing, worktree-setup, unknown-shape}`——`worktree-setup` 那一格是外部评审 i4 逼出来的：**"工具没装配好"与"你的 PR 有冲突"必须可分辨**，否则一次 seam 漏传会在 30 个 PR 上刷出 30 条假判决。计数行 `rows=<n> IN_BASELINE=… VIOLATES=…` **空集也必须出行**（本仓实测过"空数组被读成检查已通过"）。退出码语义单列一节：**量到了就退 0（哪怕全部违规）**，只有工具侧故障才非 0——把"有债"判成 CI 红会诱导人去改评论而不是改债。
- **评论幂等 + 写入面默认关**：正文首行机器标记 `<!-- debt-baseline-recheck:v1 base=… judged=… -->`，命中即 PATCH 不叠加；判据**只认标记前缀**，`base=`/`judged=` 是给人看的现场（纳入判定会把自家历史评论全判成过期，反复叠评论）。写入本身由纯函数 `shouldCommentOn(env)` 把关，**严格只认字符串 `"1"`**，workflow 里显式 `MP_RECHECK_COMMENT: "0"` ⇒ 首轮只打印结论、不动别人的 PR；开启后还有两道边界（同一格的外部复核后续 W3）：每轮上限 `MP_RECHECK_MAX_COMMENTS`（默认 10，`0` = 只点名不写，非法值回落并出声）与**每次写入前重新核查该 PR 仍为 `OPEN`**（读不到状态按未证实处理 ⇒ 不写）。这一格是 QM-6 实现层评审的 i3（`highRiskDomains:["auth"]`，引擎明打「高危域必须外部复核 1 条」）逼出来的，不得读成"顺手加的开关"。
- **TDD 与反证**：先写 11 条锁并当场见证红（红因就是 `Cannot find module './check-debt-recheck.js'` ⇒ 那条链确实还不存在），实现 + 结构锁 + 评审后的门闩、行为锁、端点形状锁与守门输入派生锁收在 **25 条**；最终基线（rebase 后、W3/W4 落码后）控制跑 `tests=25 fail=0 loadFail=false`。变异 **M1–M14 逐条指名红**（M1 UNJUDGEABLE 折进通过 ⇒ 2 红；M2 用主干 blob 覆盖 ⇒ D2 集成用例红，并顺带撞上指标名结构锁，因变异文本本身含 `maxFileLines`；M3 空集不出行 ⇒ 1 红；M4 把 `base=` 纳入幂等判定 ⇒ 1 红；M5 脚本内点名指标 ⇒ 1 红；M6 摘掉每轮写入上限 ⇒ 「写入预算」红；M7 摘掉写前状态复查 ⇒ 「写前复查 PR 状态」红；M8 把门闩退回 truthy 判定 ⇒ 「写入门闩」红；M9 写前查询退化成硬编码 OPEN ⇒ 3 条行为用例红；M10 取消写入资格（合规条目也进写路径）⇒ 「写入资格」红；M11 拒写归因退化回通用尾巴 ⇒ 「拒写可归因」红；M12 更新端点退回缺 `issues/` 那一层 ⇒ 「端点形状」红；M13 无视 `continue-on-error` ⇒ 「集合派生」与「真实对账」两条红；M14 不再派生账本文件 ⇒ 三条红（含专为把它与 M13 分开而加的无软门禁夹具那条）），`有红集=14/14 / 互不相同红集=14`，跑完判据文件按字节还原 `md5=2a4ba86763`（前 10 位，按工作树字节算——同一份内容在另一种行尾档下是另一个数，引用它必须连带说"哪一份内容、哪一档"）。一条诚实补充：**M5 的红集是 M2 红集的子集**（两者共用指标名结构锁），所以"5 个互不相同"不等于"5 对 5 独占"。驱动自己也被抓到一条坑：`Number('') === 0` 且 `!Number.isNaN(0)` ⇒ "没传参数"被解析成"只跑索引 0"，一轮只验了第一条变异就报全通过——过滤器必须先滤空串再按整数校验。
- **边界（不假装已闭合）**：本刀**不阻断**，交付后陈旧绿仍可能被合进去，变化只是"合并前 PR 上有名字"取代"合并后靠 main 变红才知道"；真要阻断只有三条路（打开 ruleset/classic 的 `strict`、由 CI 写 required 上下文、启用 Merge Queue），三条都属改守门、已由用户 2026-10-20 明确选择在四档里取本档。触发 `paths:` 与注入文件清单是第二处真源，未配锁（为"将来可能新增基线文件"预建判据属猜需求）。CI 耗时与 GitHub 评论写入的二级速率限制都是**未证事实**，首次真实运行后才允许被写进任何结论。
# [未发布] test(parity): `python simulator failed:` 不再抛空消息 —— 缺 python / 被超时杀 / 真崩 三档分开上报（parity-spawn-blindness）

- **同一句空消息第三次复发，且前两次已经留下过根因**：`grep -na "python simulator failed" .quality-gates.md` 实测 2 条历史命中 —— 第 1 次（`:3261`）判环境性失败后 `rerun --failed` 收口；第 2 次（`:10018-10026`）**已经把根因写了出来**（「只判 `res.status`、不读 `res.error` ⇒ 超时或缺 python 都抛空消息」）并附改进建议，当时以「避免扩大战线」没做；第 3 次就是今天，我合并 PR #4072 之后 main push run `39398401923` 的 `QG Coverage → Gate Result` 双红，又是一轮定责 + 一次重跑。读一个 `res.error` 的成本极低，**没做的代价就是这一整轮**（该口径已沉进内置记忆：低成本取证/建议不许写成遗留）。
- **根因形状**：`spawnSync` 在最坏的两类情形下 stderr 与 stdout **都是空的** —— python 不在 PATH（`error.code=ENOENT`、`status=null`）与命中 `timeout:30000` 被 SIGTERM 杀（`ETIMEDOUT` + `signal` + `status=null`）。旧代码 `if (res.status !== 0) throw new Error('python simulator failed: ' + (res.stderr || res.stdout))` 于是把「环境不具备」「负载抖动」「python 真崩」三种成因压成同一句空消息，人的唯一出路就是 rerun。
- **修法**：① 新增 `formatSpawnFailure(res, ctx)` 纯函数持有全部三档，各带 `cause`/`signal`/本次 `timeout` 与下一步动作（档1 给核验命令 `python --version`，档2 明说「属 runner 负载，可重跑，不是模拟器算错」，档3 带 stderr 尾 6 行），返回值**永不为空**；② `resolveSpawnTimeout` 让 `MP_PARITY_PYTHON_TIMEOUT_MS` 可覆盖，但 `0`/`NaN`/负值一律回落 30000 且**出声**（`timeout:0` 在 Node 里等于关掉超时，比 30s 更坏）；③ `status=0` 而末行非 JSON 新增一档 `PYTHON_OUTPUT_UNPARSEABLE`（带末行与行数），不再抛裸 `JSON.parse` 栈；④ spawn 后端可注入（`opts.spawnImpl`），失败路径这才在测试里可达。⛔ 预算数值 30000 一字未动——调它要先有分布。
- **对上一轮建议的部分否证（这条最要紧）**：那条建议的另一半是「python 不可用时明确 skip 而非红整个作业」。**不做**：对拍只在 main push 跑（`if: github.event_name != pull_request`），静默 skip 等于把守门关掉还报通过，是本仓记过的「装饰性门禁」同型。处置是让红保持红，但从此红得可归因；理由写进代码注释与执行记录，免得下一个会话把 skip 当成「没做完的那半」补上。
- **TDD / 反证**：先红 `8 failed | 36 passed`（红因全是机制缺席）⇒ 实现后 `node --test` **44 pass / 0 fail**；真 python 跑 `node scripts/compare-scheduler-models.js` 仍 `PARITY OK` rc=0（注入缝没动活路径）。变异 **P1–P5 逐条指名变红且按字节还原**（P1 改回被禁拼接 / P2 摘 ENOENT 档 / P3 摘超时档判据 / P4 放行 `timeout=0` / P5 退回裸 JSON.parse）。P3 顺手量出一条锁的边界：「三档互不相同」只挡**文案塌缩**、不挡**判据塌缩**（摘掉 `if (code==='ETIMEDOUT'…)` 后三句仍两两不同）—— 该局限直接写进用例注释，挡那个形态的是「档2」本身。另记一处我自己的错：P3 的期望清单多认领了一条不经该判据的用例，处置是改正期望 + 写下局限，没有改断言凑红、也没删弱锁。
- **边界**：锁加在既有 `scripts/compare-scheduler-models.test.js`（已点名进 `quality-gate.yml` Gate 2b，每 PR 都跑 ⇒ 无新接线）；同形态第二处（其他 CI 脚本的 `spawnSync` 只判 status）未做全仓收敛，登记为遗留；本片**不含** `publish-history.test.js` 那条把接线棘轮跑到 10s 框架超时的红（那是另一族，任务 #89）。执行记录：`openspec/records/parity-spawn-blindness.md`。
# [未发布] fix(i18n): TabBar 标签兜底文案收进 locales —— 并把"谁在决定可见文案"这条层间关系钉成断言（ux-audit-nav-locales）

- `TabBar.vue` 的 `getTabLabel` 两处字面量换成既有键：`‘首页’` → `t(‘nav.home’)`、`‘新标签页’` → `t(‘tabs.newTabTitle’)`。可见文案逐字不变 ⇒ **像素中性**，不动 locale 文件（两个键与英文侧早已存在，只多消费一次）。
- **写测试时才发现审计稿指错了层**：模板是 `{{ tab.title || getTabLabel(tab) }}` —— title 优先，`getTabLabel` 只是 fallback。真正决定首页标签文字的是 `stores/tab.js:97/:220` 里写死的 `title: ‘首页’`。所以"改了 TabBar 就等于标签国际化"是错的。
- 判别性证据只能是**非默认语言档**：zh 档下新旧实现产出完全相同，抽取是否真接上 i18n 不可观测。新增 `TabBar.test.js`「标签文字随语言切换」4 例（zh 档文案、en 档产出 `Home`/`New Tab`、结构锁禁字面量、层间关系 title 优先）。两道变异（把两个 `t()` 退回字面量）各让 ≥1 条指名用例变红，`RESTORED_OK=true`。
- 层间关系那条**不是**"en 档应该显示 Home"的缺陷断言，而是**入口证据**：谁把 store 的 title 也改成随语言走，它会立刻红，逼那次改动显式改判据并交代已持久化标签数据的迁移（属阶段 3.2）。
- 词典新增《首页 / 主页 术语边界》一节：`nav.home=首页` 与 `sidebar.home=主页` 同指 `/`（四份真源的两份），写作规范定为「新文案一律取 `nav.home`，要区分就改键名不改词」；并登记审计稿 3.1 的 `MpModuleNav.vue:37-47` 半条**已被实况否证** —— 该组件由 #3951 删除，按 `git ls-files` 核过在位状态才动手。
- **同批第二次命中（由 CI 当场抓出，本机漏跑）**：`QG Desktop Shards (2/2)` 红在 `src/i18n/glossary.test.js`，
  报「术语「位置 / 现值」在 zh 已出现、en 未出现」。根因不在词典内容，而在**判据的输入选错了**：
  `parseGlossary` 把「任何以 `|` 开头、第二列不等于 `zh` 的行」都当术语对，于是本批新增那张说明表的**表头自己成了一条术语**。
  修法是把判定域收敛到「表头前两列是 `zh` / `en` 的表」，非表格行即退出术语模式；另加三条锁 ——
  真实词典判定域形态检查（术语列不得含反引号/箭头）、**规模下界 `>= 100`**（防"解析退化把域清空"读成零欠账：
  零条术语 ⇒ 逐条一致那条锁循环零次、完全恒绿）、解析器行为合同（合成文档 `toEqual` 精确断言只收到 3 条真术语）。
  4 条变异（表外行也收 / 整体退回旧解析器=事故原形 / 非表格行不退出 / 分隔行恒不识别）全部 CAUGHT 且各红在指名用例。
  **为什么本机没抓到**：我只跑了 `src/layouts` 与 `TabBar.test.js`——这条锁读的是 `01-docs/i18n-glossary.md`，
  而我改了那个文件却没把"读它的测试"纳入验证域。AGENTS「改被多文件消费的模块，验证范围取消费者并集」在本仓的
  新落点：**被测试读取的数据文件也算消费者面**，改它就要跑读它的那把测试。


<<<<<<< HEAD
# [未发布] feat(hot-topics): 条目模型加 kind 判别位与内容段，不合格条目在采集出口即丢（hot-topics-item-model）

- **第一性问题不是"渠道不够"而是"盒子不对"**：`hot-topics/channels.js` 的统一产物 `{channel, rank, topic, hotValue, url, rawCategory}` 没有作者 / 发布时间 / 互动数，所以"给热门选题加近期爆款视频"这句话在数据结构层面无法表达。本片只把盒子改对，**不接任何新源**，因此用户可见行为逐字不变。
- **单一实现** `apps/desktop/electron/services/hot-topics/item-model.js`：`normalizeKind`（非法值返回 null，不"修好"）、`pickContentFields`（`author` ≤128 且不截断、`publishTime` 必须 ISO 形态、`interaction` 只认 `like/comment/share/play` 且非负整数——**0 保留**、空对象算缺席）、`validateEntry`（四种拒绝码）、`filterViableEntries`（采集出口过滤，warn 只记渠道/计数/原因，不记条目文本）、`withLegacyKind`（旧缓存读作 topic，已有值含非法值原样保留）。
- **丢弃点为什么在主进程**：`kind='item'` 但三个内容字段全空，一旦进列表就会继续被 classifier 归类、被 scorer 计入"多榜同现"、被界面用渠道名兜底作者——四个消费层各自把同一份坏数据兜成不同形状，症状只是"看着不太对"。这是本仓"装饰性升级/装饰性链路"的同型，故在入口就拦。
- **三处手工白名单同批改**（AGENTS.md「新增字段必须同时改所有投影白名单，两侧各自单测都会绿」那条）：服务层两个采集出口 + IPC 收藏 `_sanitizeTopic`；并配一条**读源码的接线守卫**（两个出口各调一次判据、`kind: x.kind` 与 `...pickContentFields(` 在位、缓存读取接 `withLegacyKind`），带"解析器数 ≥13"的反失明下界。
- **读路径不写回**：`getCache()` 只做读取侧归一；既有断言"returns persisted cache"按新口径改写，并新增一条 `store.setSetting` 未被调用的断言——把历史数据改写成当下口径，事后就分不清"当年没有"与"当年没这个字段"。
- **验证**：新增 21 条行为用例全绿；消费者并集 8 个测试文件 170 passed / 0 failed；href 契约测试 16/16；eslint rc=0；债务指标在基线内。**四条变异反证**（判据恒通过 / 摘掉一个出口调用 / 空对象当有效互动 / 连非法 kind 也修好）分别红 3/21、1/21、2/21、1/21，全部指名且还原后 md5 相同。
- **规格同步**：`openspec/changes/hot-topics-viral-items/tasks.md` 勾 2.2；PRD 新增 §11「已实现切片」，并如实标明 §6.2–§6.4（抖音官方热门视频榜、小红书条目自采、视频号）仍是合同——其中 O-1 的字段/权限/配额**未取证**，规格里没有凭想象写过任何一个字段名。

# [未发布] fix(登录): 头条号登录期观测的覆盖面补正——真实生效的验证码入口此前既不在监测域、也不匹配锚点

- fix(登录): 头条号登录期观测的**监测域补两条**（`yhgfb-cn-static.com` 验证码中心、`bytetos.com` 风控 glue）。动因是 2026-10-22 从 `https://mp.toutiao.com/` 的**实际登录页 HTML** 静态引用里抓到资源清单，发现上一刀（PR #4237）的监测域清单**漏了这两条**——而漏掉的恰恰是**真正生效**的图形验证码入口所在域：该域的请求此前**根本进不了** `webRequest` 过滤面 ⇒ 它的失败请求、HTTP≥400、慢请求**一条都不记**。
- fix(登录): 图形验证码组件的判定新增**组合锚点**：路径**同时**含 `/sec_sdk_build/` 与 `/captcha/` 才算命中（真实形态 `…/obj/rc-verifycenter/sec_sdk_build/<ver>/captcha/index.js`）。为什么不用单段锚点：只认 `/captcha/` 会把无关资源误判、噪声淹没真信号；只认 `/sec_sdk_build/` 会把同目录下非验证码资源算成组件 ⇒ 「灰显遮罩结束的时刻」这个读数提前且失真。老形态（`secsdk-captcha` / `webmssdk`）与「只认路径、不认查询串/域名」的既有约束**一字不动**，未登记平台（微信/腾讯）的过滤面**一字不动**。
- fix(登录): 上一刀承诺的「记录图形验证码组件加载完成（灰显遮罩结束的时刻）」在真实链路上**不生效**——两处同时漏（域没登记 ⇒ 进不了过滤面；路径形态不匹配锚点 ⇒ 不会被判成组件）。现场读数：真实验证码入口 77,476 B，冷时首包 **2.65~2.96s**、命中边缘后 **0.13s** ⇒ 高度间歇，正是「灰显几秒」那段波动的来源，也正是最需要被观测到的一段。补正后该时刻第一次能被日志直接读出。
- docs(登录): PRD 增补 §5.6「观测面覆盖补正」（动因/判据/不做什么）；排障手册增补 §1.1 复测读数与 §3.2 清单补正提示（OpenClash 域清单 10 → 12 条，**仍不进仓内文档**，见 PR 评论）。
- refactor(登录): 验证码组件判定抽出**具名谓词** `isCombinedCaptchaAnchor(path)`（此前是写在返回语句里的复合 `&&`，对后来的维护者是「哪一段是必要、优先级如何」的隐式表达），并补**优先级测试**：不经 URL 解析层直接断言「两段缺一不可」与空输入不命中。
- docs(登录): 监测域清单处补**显式边界守卫**（只读 / 不外发 / 不拦截 / 不记凭证）：扩大监测域清单只等于扩大「被看见的请求集合」，**不等于**扩大数据出站面 —— 这条以前只是隐式假设，现写成看得见的四条。
- fix(登录): 按第三/四轮外部评审把观测边界从**注释变成可执行契约**——每条边界各带
  `forbidden`（源码里不得出现的形态）与 `required`（源码必须出现的形态）两把锁，回归锁逐条扫
  **去注释后的代码**；并如实登记观测层唯一的请求级动作是「**默认关闭**的登录噪声取消」
  （需 `MP_LOGIN_NOISE_CANCEL=1` 显式开启、只取消噪声 URL、不改写任何内容），由两道
  `required` 锁住 —— 此前那四条「不拦截 / 只读」的声明没有对应代码消费，是装饰性的。
- test(登录): 变异反证 harness **入仓**（`openspec/changes/login-observe-domain-coverage/evidence/mutation-harness.cjs`），
  证据因此**可复现**；11 条变异（实现文件 8 条 + 读体闸门 3 条：删掉 / 改成永真 / 挪到读体调用之后）
  **全 CAUGHT**，跑后**每个被变异文件分别**比对 md5（monitor 与 diagnostics 各 MATCH）。
- fix(登录): 变异 harness 补**原子回滚**（**循环开始前**为每个被变异文件各落一份原始内容备份，
  写在**系统临时目录**而非源文件同目录 —— 进程被强杀时 `finally` 不执行，备份留在源目录会变成脏文件；
  整个循环包在 `try/finally` 里从备份**逐字节还原**）——此前直接写源文件，若脚本中途被 kill / 磁盘满，
  源文件会**永久停在损坏状态**；同时去掉 `shell: true`（改用 node 直接跑 vitest 的 js 入口），
  让「命令不存在」与「用例失败」不再撞进同一个错误通道，环境故障单独计数、单独退出码，
  不再与「变异逃逸」混为一谈；另加**整体时限**（单条 600s × 11 条最坏超过 110 分钟，此前无上限）。
- fix(登录): **刻意排除**的域（`www.douyin.com`）从「只写在文档里」改为**编码进代码**
  （`EXCLUDED_HOSTS` + 排除理由），并加断言：被排除的域不得出现在任何平台的监测域清单里。
- test(登录): 加断言——读体平台清单必须与诊断层的端点匹配器**键集逐字一致**（两边漂移 ⇒
  读体面悄悄变了没人知道），所有计时平台（头条/微信/腾讯视频）一律不在清单里；
  同一平台多次取匹配器必须返回**同一正则对象**（缓存未被破坏）。
- docs(登录): 移除一份**零行变更**的评审档案（`changedLines=0` 的空记录），它只给审计添噪。
- docs(登录): 域来源证据快照补抓取内容 **SHA-256** 与抓取命令（证据完整性可事后核对：重抓哈希相同 ⇒ 登录页没变）；
  执行记录瘦身（现场读数归位到 change 的 `design.md` §D6，记录只留执行与证据）。
- test(登录): 新增用例（真实验证码入口命中 rc1/rc2 两个冗余节点、域覆盖双向断言、泛化反例 ×8、常量断言、具名谓词优先级、**每条边界各有锁的逐条扫描**、**域来源证据必须在仓内**）。**变异反证 M1~M9 全 CAUGHT**；其中 **M4 首轮 ESCAPED 暴露出一条弱负例**——URL 路径里没有真正的 `/captcha/` 段 ⇒ 去掉条件也不变、钉不住，补强后 CAUGHT。原始 harness 输出与 md5 逐文件比对已附进 `.ccg/reviews` 的评审记录（证据而非叙述）。

# [未发布] fix(ui): 补完 P0-6 空态收敛 + 修巡检采集脚本的静默失效 + 把交付数字改准（ui-visual-empty-state）

- **动因**：上一轮交付（#4124）在交付后复核中被查出三处「**文档说的比代码做到的多**」——分析报告是那轮的交付物，它对「哪些已达成、哪些没达成」的说法必须与代码逐条对得上。
- **① 空态**：观感层那条覆盖点名了 `.insight-empty-card` / `.perf-empty-card` 等 **6 个代码里根本不存在的类名**（规则一条也没命中），于是**效能洞察的两处空态至今仍是虚线**，而报告把它列成了「已达成」。本轮删掉 6 个死选择器、补上真实类名 `.pi-empty-state` / `.pi-dim-empty`（实线发丝；圆角与底色沿用组件自身口径——它们是卡片网格里的卡片，改柔面会显脏），付费占位的品牌色边条此前已落地未动。**新增回归锁** `apps/desktop/src/styles/empty-state.contract.test.js`（5 例）：空态块点名的类名必须在 src 真实存在（检索域排除本文件，否则锁成恒绿的自证）／被覆盖的类必须有 `border-style: solid` 覆盖／仍用虚线的容器必须在例外清单登记（清单外新增虚线空态 ⇒ 判红；清单里标 defer 的已不虚线 ⇒ 清单陈旧 ⇒ 判红）。扫描用**嵌套感知**的规则抽取（`@media` 内的规则各自抽出）——第一版用贪婪匹配，@media 里的虚线空态被静默漏掉；修完立刻多扫出 **2 个之前漏掉的**（`.is-placeholder` / `.video-preview-placeholder`），已登记。**变异反证**：注入一个不存在的类名，当场判红并点名。
- **② 数字**：仓内清单 `ui-audit-manifest.md` 是 **210 行**（亮 177 + 暗 33，覆盖 34 条路由），而报告 / CHANGELOG / 执行记录写的是 **177**（那是**亮色那批**的张数被当成了总数）；视觉基线目录是 **43 个 PNG**（40 张像素基线 + 3 张 autonomous-loop 专属），证据资产是 **20 张 PNG = 10 组**（+1 份 README）。报告 / CHANGELOG / 两份执行记录 / 证据 README 已全部改准。
- **③ 顺带挖出一个真缺陷**：巡检采集脚本为过行数门禁拆成三份时，探针文件引用了 `READY_TIMEOUT`，而这个常量**定义留在了被拆走的编排文件里** ⇒ 采集脚本对**每一条路由**都抛 `READY_TIMEOUT is not defined`，**一张图都采不出来**（实测 0 张；仓内那份 210 行清单是拆分**之前**那次运行留下的，所以表面上看不出问题）。之所以没被门禁拦住：① 冒烟测试只断言「模块能被 require」；② **巡检脚本目录完全不在 lint 范围**（lint 脚本只扫 `electron/ src/`），`no-undef` 从未生效。本轮补回常量，并把 `tests/visual-testing/scripts/` **纳入 eslint 范围、只开 `no-undef`**（不整包启用 recommended——那会把该目录既有的 `no-useless-assignment` 等无关告警一并变成错，属于借修缺陷之名扩大改动面）；**变异反证**：把 `READY_TIMEOUT` 的定义整条删掉 ⇒ eslint `no-undef` 判红并点名。**修复后实测**：`node ui-audit-capture.js --phase=a` 采出 **33 张**。
- **验收**：空态契约锁 5/5 · eslint（新增覆盖后）exit 0 · 采集脚本 33 张 · 本机像素回归亮/暗各 20/20 · 对比度审计 0 处低对比度 · `max-lines` / `debt-budget` / `gate-record-debt` / `doc-abs-paths` / `changelog-growth` / `visual-coverage` 全 exit 0。**像素基线中性**：本次改的两个类只出现在 `PerformanceInsights.vue`，而效能洞察不在 20 张像素基线视图里 ⇒ 基线不受影响，无需重建。
- **CCG 外部双家族评审**（critic=claude / proposer=opencode，判定 SINGLE，7 条意见）：6 条进入裁决并逐条填完（i1/i5/i7 dismissed、i2/i3/i4/i6 upheld），据评审改了扫描器（i3）、注册表补到 10 项（i3/i4）、断言失败信息给出处置动作（i2）、措辞澄清（i5/i7）、eslint 覆盖（i6）。产物 `.adversarial/ccg-deep-04005ae3/` 已入库，逐条处置见 `openspec/records/ui-visual-empty-state.md` §四。
- **遗留（如实登记）**：其余 **4 类语义空态仍是虚线**（`.podcast-empty` / `.segment-empty-filter` / `.pipeline-progress-empty` / `.is-empty`）——它们落在 20 张**像素基线视图**里，改样式会让基线漂移，须先按「CI artifact 渲染重建基线」的流程重建基线；**有意保留虚线的 6 项**（拖放区 / 视频预览位 / 提示块 / 分隔线 / 估算占位标记 ×2）语义正确，不是「未完成」。R6（真实 Electron 窗口 GPU 帧率实测 + 暗色真机复核）与 R7（新增 `.adversarial` SHA 对齐门禁，属改守门结构）沿用上一轮，交人工。

# [未发布] feat(登录): 登录视图按平台复用分区（缓存跨次留存）+ 头条号登录期网络观测（login-slot-reuse-and-toutiao-diagnostics）

- fix(登录): 登录视图与扫码登录改为**按平台复用同一分区目录**（`auth-auth-<platform>-slot`），只清凭证、**不清 HTTP 缓存** ⇒ 第三方登录页的静态资源与风控 SDK 第二次起命中缓存。动因是 2026-10-21 的头条号现场复现：点「获取验证码」后平台灰显好几秒才弹图形验证码，实测该图形验证码组件（`webmssdk.js` 520KB + `secsdk-captcha/captcha.js` 784KB）在冷缓存下各要 ~1.1s，而登录视图此前每次都用 `Date.now()` 新建空分区 ⇒ 缓存每次从零开始（普通 Chrome 早就缓存了 ⇒「浏览器正常、app 慢」，这个差异是本仓造成的）。
- fix(登录): 复用槽位带来的凭证隔离改由**开局清**显式保证（导航前清掉槽位里的旧 Cookie/存储，保留 HTTP 缓存；空槽位零 IO；带 1200ms 硬上限且失败不阻断导航）——否则第二次打开登录页会直接命中上一个账号的登录态，用户想加**第二个**同平台账号时会静默存成**同一个账号**。清理由「每次新建空分区」这个隐式隔离改成显式实现，是本次的必配项，不是顺手优化。
- fix(登录): 「本轮是否取到凭证」改为**按轮次**判定（登录承载方显式传给回收端）——槽位跨轮次同名，按分区名判会把「上一轮成功」误当「本轮成功」，导致本轮没登录成、槽位里还留着上一轮会话时该清的没清（实测三条既有用例当场变红正是这条）。
- feat(登录): 槽位名取 `auth-auth-<platform>-slot`（落在发布链兜底读取端的既有前缀下）⇒ 读取端**零改动**即可读到，且按字典序排在时间戳目录之后 ⇒「从新到旧逐份探」先探槽位、槽位空时落到旧目录，**回退链完整保留**；槽位同时被显式排除出一次性分区回收面（回收端永不删它）。
- feat(登录): 头条号进入登录期观测面：会话级记监测域内的失败请求与 HTTP≥400（字节自家 CDN 的 504 此前完全无痕），CDP 记**慢请求耗时**、**图形验证码组件加载完成**（用户看到的灰显遮罩结束的时刻）与监测域请求失败；未登记平台的过滤面**一字不变**，观测层**永不读响应体**。
- refactor(登录): 按仓内行数门禁拆出三个模块（`auth-login-slot.js` 槽位规则 / `login-network-monitor.js` 观测口径 / `auth-view-saved-account.js`「打开已保存账号」纯平移，特征测试先钉住当前行为）；监测域匹配改为按平台编译正则并缓存（O(1) 查表）。
- docs(登录): 新增 `01-docs/PRD-LOGIN-SLOT-REUSE-2026-10-21.md`（数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 不做什么 / 取舍）与 `01-docs/TROUBLESHOOT-TOUTIAO-LOGIN-SLOW-2026-10-21.md`（用户侧排障手册）。

# [未发布] feat(ci): electron-ci 桌面全量收回单一实现 —— 同一步两片并行 + 共享预算 2700s + 剥 ANSI/时间戳的现场计数

- **动因（2026-10-21 现取读数）**：`electron-ci.yml` 的 `Unit tests (Vitest…)` 步骤在 main push 最近 12 趟里 **8 趟非绿**，逐趟下作业日志核对后 **8/8 都是预算墙**（`rc=124`×1、`TIMEOUT_BUDGET_EXCEEDED`×2、**断言红=0**）；红趟作业墙钟 2177–2215s，成功趟 1511/1542/1820/1934s ⇒ 贴脸逼近 2100s 步骤预算。
- **形状**：30 行内联 bash 收回 `scripts/electron-ci-desktop-step.js`（workflow 只调用不判定，同 `agent-review-gate.js` / `main-red.js` 先例）。**同一个作业内**并起 `--shard=1/2` + `--shard=2/2` 共享一份预算 ⇒ 作业名仍是 `electron-tests`，**不动** ruleset `main-ci-gate` 的 required context（matrix 会给名字加后缀，那属"改谁来守门"）。`--maxWorkers=1 --no-file-parallelism` 保留，确定性语义与「main 侧第二次独立运行」的 flake 检出原意不丢。
- **预算 2100 → 2700 的理由（不是"给同样的活加宽墙"）**：`max(单片成功值)=23.2min × 1.5 = 2091s` 对 2100s 只剩 9 秒，而那批样本是**每片独占一个 runner** 测的（`QG Desktop Shards` 7 趟 14 片：min 11.2 / p50 18.6 / max 23.2）；本步是同 runner 两片并行，**争用倍数未测**。贴脸按本仓口径是事前证据 ⇒ 取 `2700s ≈ max × 1.94`，属**单调放宽**（不会让任何原本通过的运行变红），且不与 job 级 `timeout-minutes: 70` 倒挂（其余带 timeout 的步骤合计 20 min，20+45=65<70，由锁逐步骤实算）。
- **修掉一处计数器失明**：旧 `grep -cE '^[[:space:]]+[✓×↓-]'` 对 vitest 真实行恒 0（`od -c` 实测行首是 `033[32m✓033[39m`，第一个字符是 ESC；Actions 日志还要再剥每行时间戳前缀），于是"跑满预算"被读成"一条都没跑"。按修好的锚重读同一批红趟是 **✓×行=18156–18929、摘要=0** —— 其中 `摘要=0` 是被杀趟的**正确读数**，文案不得读成工具坏。
- **四档 verdict 各自可分辨**（timeout / ok / failed / crashed）：`rc=124` 与 `rc=1` 的修法相反，并档等于把预算墙读成用例坏。「全部收敛」用 `Promise.allSettled` 而非 `race(h.done)` —— race 在第 1 片收敛时即报 all，慢的一片既没被等也没被归类（现场形态是 verdict 整格缺席，比判错更坏）。
- **复测入口落在仓库里**：新增 `scripts/electron-ci-shard-audit.js`（读新形状的逐片 `elapsed=`，取不到时退回老基线并自报"这是下界"）；`verdict` 分 NO_SAMPLES / BELOW_FLOOR / HUGGING / OK 四档，**零样本与自身故障都以非零码出声**（把"没量到"读成"预算没问题"是本仓反复出现的同型事故）。输出字段与 `STEP_BUDGET_PROVENANCE` 逐字段对齐，由结构锁钉住。
- **一次真实拦阻（不是事后追认）**：`workflow-contract.test.js` 的「消费者覆盖面下界 3」在本次改动中途报红（实测 2）。根因是委托判据取**第一个** `node scripts/*.js` 命中，而我在同步写的注释里点名了另一个脚本 ⇒ `electron-tests` 整片从覆盖面消失。正解不是改措辞，而是扫**全部**候选按语义判定，并补两类对照：注释遮挡形态必须仍判 true、只有那个不跑桌面全量的脚本必须判 false。
- **第二处被现场红的判据（`QG Static`，本机绿/CI 红）**：换调用形态后还有**第三个消费者**不认委托形态 —— `check-desktop-test-prereqs.js` 自己那套形态识别器看不到 `node scripts/…` ⇒ `electron-ci.yml#electron-tests` 从它的域内消失、登记表被判 `STALE_REQUIRED`；而红文案给的"正解"（删掉这条登记）等于**关掉一条 required 检查的前置构建覆盖**。已加第六形态 `delegate`（认委托成立的条件仍是**被点名脚本自己的源码**里三条锚齐命中，读不到文件按"没有委托" fail-closed），并顺带修掉一处设计缺陷：委托判据原先硬编码读 `REPO_ROOT/scripts/…`，与 `collect({root})` 不同源 ⇒ 夹具的正控分支结构性不可表示。新增 4 个夹具 job + 一条 T10（含"该步不得再有任何非 delegate 的桌面命令命中"，把"两份实现"焊死）。**验证口径随之改定**：改调用形态时按 `git grep` 枚举全部消费者逐个跑，而不是靠自己想到的清单。
- **测试与接线**：新增 `scripts/electron-ci-desktop-step.test.js`（12 条）与 `scripts/electron-ci-shard-audit.test.js`（9 条），都点名进 `quality-gate.yml` 的 `changes` job（不被 docs-only 短路、且在非 PR 早退之前）；`.gitignore` 补两条 `!scripts/*.js` 反选（第 106 行会把新建脚本静默忽略 ⇒ 本地全绿、CI 上 `Cannot find module`，同族第 5/6 次）。既有三锁迁移到委托形状：`workflow-contract.test.js` 45/45、`gui-ci-exit-contract.test.js` 46/46（预算取自模块 + 真 `bash -e -o pipefail` 执行 + 接线判据按代码区剥注释）。
- **反证 T1–T10 逐条 CAUGHT**，还原后逐字节相同：串行 / `race` 代替 `allSettled` / 不剥 ANSI / 锚要求行首空白 / timeout 与 failed 并档 / provenance 的 max 抬高 / workflow 退回内联 bash / 摘掉逐片 `elapsed=` 打印 / 摘掉时间戳剥离 / 零样本判成通过。
- **遗留（如实登记）**：① 并行争用倍数只有第一次 CI 真跑才知道 ⇒ 上线后必须跑 `node scripts/electron-ci-shard-audit.js` 按现场重定数；② `realSpawn` 的输出缓冲 32MB 上限会截断**计数用**的副本（不改判定，只可能让 `completed=` 偏小），已注释标明；③ `runStep` 的等待块形如 `while{…break}` 实为单次等待，属可读性异味，未在本片收敛；④ issue #2458 档 4（`CI Failure Handler` 把 `exit 124` 且无摘要行归类为 `ci-timeout-budget`）仍未做。


======

# [未发布] feat(collect): 知乎收藏批量改写支持字数区间，并显示改写稿实际字数（feat-zhihu-fav-batch-wordcount）

- **改前**：知乎收藏批量「采集并改写」的稿子长度**写死**——面板没有字数入口，请求体固定 `{content, style, length:'keep', llm}`，
  Python 侧走 `_LENGTH_RANGES['keep']`（目标 1500 字 / 区间 300-3000），用户改不了；改写稿多长也**看不见**
  （结果区只显示原文字数；Python 响应里明明有 `word_count`，主进程只取 `result_content` 把它丢了）；
  且批量摘要行一直是**空的**（调用了不存在的 locale key `collection.zhihuFav.progressSummary`，实际在 `zhihuFavlist` 下）。
- **改后**：面板出现「字数」区间（默认 800-2000，与采集页**同一组件、同一校验口径**），非法即红字 + 禁用按钮 + 早退不发 IPC；
  区间真的生效（透传为 Python 的 `min_word_count`/`max_word_count`；**缺省/非法则不带字段**，Python 回落 length 三档 ⇒ 旧行为不变）；
  采集结果卡片显示「改写 N 字」并与原文字数**并排**；超出设定上限的条数在批量摘要里告知。
- **顺带修掉 Python 的目标篇幅语义**：显式区间原先一律用**区间中点**当目标（`target=(min+max)//2`）——
  用户设 0-6000 会让 300 字的知乎回答被要求写 3000 字、5000 字的长文被砍掉四成。
  改为**只有 `min==0`（不设下限）**时取 `min(原文长度, 上限)`（与 Node 引擎的同族语义一致），
  `min>0` 的中点语义与 `length` 三档**一行未动**；目标推导抽成纯函数 `_resolve_target_word_count` 并直接单测。
- **不硬截断**：Python 侧的 `max_word_count` 只是 prompt 里的软指令（`content_aggregator_shared._parse_response` 不按 max 截断），
  截断=静默丢内容（可能切在半句）⇒ 本片选择**告知**（摘要 + 卡片字数），与本仓「可见化而非静默」的理念一致。
- **结构债**：主进程 handler 当时 498 行、距行数门禁天花板（500）只剩 2 行，加不动 ⇒
  把「单条改写 + 失败诊断脱敏 + 字数区间归一」整体搬成独立模块 `electron/services/zhihu-fav-rewrite.js`（纯搬迁，行为逐字不变），
  handler 降到 463 行；两个未登记在 max-lines 账本里的 collection locale 文件（>= 500 即阻断）新增 key 只能并到既有行。
- **回归**：四层新增 12 例（主进程区间透传/字数回传/超限计数、渲染层面板契约、映射层派生值形状、Python 目标篇幅语义）；
  既有套件 Python 聚合 53 例、桌面端相关 90 例全绿。
- **外部双家族评审**：`sh scripts/deep-review.sh` 实跑 opencode(proposer) + claude(critic)，跨家族校验通过，
  critic 给出 4 维度评分与 4 条争议项（**0 条高危域**）⇒ 逐条裁定 **upheld 2 / dismissed 2**：
  - **i2**（成立）防御层把上游的**非法态**（清空输入，`Number('')===0`）翻译成了另一个**合法态**（显式下限 0）
    ⇒ 已修：空值一律按「没给」处理（回落旧行为），回归锁 5 断言；
  - **i4**（成立）兜底字数用 UTF-16 `.length`，与 Python `len()`/引擎的**码点**口径不一致
    （带 emoji 的文本两处显示不同数字）⇒ 已把三处「字数」统一为码点（`rewriteOne` 兜底、
    `normalizeCollectedItem` 原文字数、`useCopyLibrary` 写库字数），回归锁 3 断言；
  - i1 / i3 驳回（附取证依据：未超限的 locale 文件不该登记账本，正确处置是别让它长过线；
    `rewriteOne` 从未导出、仓内唯一调用点已同步）。
# [未发布] fix(门禁): 锁预算复测脚本的采样域补上 workflow 轴 —— 判据按 (workflow, jobName) 二元组成立（lock-audit-workflow-axis）

- **同族残缺的第二层，上一片写进注释而没写进判据**：`scripts/lock-timing-audit.js` 只列 `WORKFLOW = 'quality-gate.yml'` 一个坐标，而 `electron-ci.yml` 的 `electron-tests` 作业跑同一批桌面 vitest。当场取证（run `39569099718` / job `119118831343`）：该作业 11 行 `[windows-file-lock]` 握手，其中 **mock=false 7 行**、max=4282ms ⇒ 它真产样本，此前一条都采不到。
- **这一维比作业名轴更阴，值得单独一轴**：作业名漏了表现为「样本少」，workflow 漏了**照样打印得出总样本数**，且与「那个 workflow 恰好没跑」逐字同形 —— 单看读数分不清两者。所以判据必须是二元组 `isProducer(workflow, jobName)`，不是两张独立集合的笛卡尔积（`electron-tests` 在 quality-gate.yml 里必须不命中，`QG Coverage` 在 electron-ci.yml 里也必须不命中）。
- **修法**：显式登记表 `PRODUCERS` + `isProducer` / `producerWorkflows` / `pickProducerJobs`；采集端按 workflow 逐个列 run，`by_job` 的键带上 workflow 前缀（否则同名作业并成一个数、样本来源不可归因）；覆盖不足（PARTIAL）与零样本出口都**按轴点名**，不再合并成一个总数。
- **TDD / 反证**：先红 1 条（新锁，红因是 `缺 isProducer`）⇒ 实现后 vitest **25 passed / 0 failed**。变异 Q1-Q8 八条各自红在指名的锁上（Q1 丢 workflow 等值 / Q2 删登记表一行 / Q3 判据恒真 / Q4 写死字面量绕过登记表 / Q5 清单塌回单坐标 / Q6 丢 status 过滤 / Q7 缺坐标读成通配 / Q8 常量改名）。Q8 是**模块级**变异、四条一起红，其期望已从两条改正为两条→四条并在驱动里写明局限；定向证据由 Q1 与 Q5 承担。
- **不对称纪律**：扩面后做过 8+8 run 定点复测（`runs_total=16 jobs=32 samples=168 ready.max=10933ms`，其中 electron-ci.yml/electron-tests 独贡 56 条）。该读数**低于**既有 provenance 的 12762ms ⇒ **不收紧预算**；定点窗口也不构成「扩面后 max 不会更高」的证据，`--runs=26` 的足量重测仍是欠账，已写进 `source` 与执行记录。
- **过程自错两条（改正的是期望与驱动，不动断言）**：① 驱动把 vitest 全绿时不打 `Tests N failed` 段读成「不健康」，整轮误报 PROBE_BLIND；② 变异锚写 `\n` 而该文件工作副本是 **CRLF**（`i/lf w/crlf`）⇒ ANCHOR_MISS，现驱动按文件真实行尾展开锚。同族第 N 次踩行尾，所以归一化进驱动而不是靠人记。
- **边界**：回归锁加在既有 `apps/desktop/electron/services/windows-file-lock.test.js`（已点名进 `quality-gate.yml` Gate 2b），未新增测试文件；`docs/windows-lock-budget-provenance.md` §4 第 6 条同步改写，避免「本片未扩」那句自述在扩完后仍留在原地。

# [未发布] fix(离线): 主进程补上「进入离线」方向的推送通道，断网横幅不再只靠浏览器事件（ux-audit-offline-live 第二半）

- **问题**：断网（拔网线 / 关 WiFi）时，横幅只能等 Chromium 网络栈派发 `offline` 事件才出现；主进程其实**已经**知道自己离线了，却什么都不告诉渲染层。
- **根因**：`apps/desktop/electron/services/offline-manager.js::onNetworkChange` 只有恢复分支——`if (wasOffline && !isOffline) { … notifyFrontend() }`，**没有 else**。而 `startMonitoring` 的两侧监听是对称注册的（`net.on("online")` / `net.on("offline")`），所以状态机两侧都在跑，只有通知这一侧缺。这是「方向性静默」：不报错、不崩，只是永远不会有人知道。
- **修复**：新增 `!wasOffline && isOffline` 分支 → 写日志 + 向渲染层推 `offline:lost`，载荷 `{isOffline:true, cachedCount}`；`cachedCount` 直接取主进程缓存队列真源。恢复侧一字未动。判据是**状态迁移**而不是事件计数：已在离线态时重复的 offline 事件不重发。
- **接线四段**：`preload/system.js` 暴露 `onOfflineLost` → `preload/access-control.js` 登记 → `preload.test.js` 两处计数 141→142 / 339→340 → `src/api/publisher.js` 走 `bridgeOn("OfflineLost")` → `useOfflineStatus` 订阅并**随后复核**（载荷字段缺席时由复核补回真值，不得当成 0）。`dispose()` 改为按 `[通道名, 取消函数]` 成对解绑，失败文案点名是哪条通道。
- **明确不做**：不给 `license-access-control.js` 的 `PUBLIC_CHANNELS` 加 `offline:lost`。该表管的是**请求型**通道（`ipcMain.handle`），而推送型通道 `offline:restored` 从来不在表内——加进去是一条永不命中的死条目。核对方式是先查表语义与既有同类通道，不是想当然。
- **顺带修掉一条装饰用例**：`tests/offline-manager.test.js` 里那条名字写着 `onNetworkChange sends offline:restored event` 的用例**从来没断言过 send**（只查 `isOffline()`），且文件顶部 `var mockSend = vi.fn()` 全文件零引用。根因之一在宿主夹具：`test-setup.js` 的 `webContents.send` 是空函数而不是 `vi.fn`，所以「有没有发」在这个夹具里结构性不可表示。本轮改为按实例把 `send` 换成探针再断言。
- **回归保护**：主进程侧 4 条（断网必须推 / 重复不重发 / 恢复仍推（正控）/ 两个监听都注册（正控））+ 渲染层侧 4 条（立即置离线并采纳队列深度 / dispose 成对解绑 / 宿主不支持订阅时不抛且浏览器事件仍生效 / 载荷缺 `cachedCount` 由复核补回）。红侧取证：订阅门改 `if (false && …)` 后 `3 failed | 13 passed`；两条正控在该变异下仍绿，证明夹具能观测到 send。
- **验证**：定向四文件（含 `electron/preload.test.js`）`425 passed / 0 failed`，无 `Errors` 行；QM-1 打包与全域复跑读数见 `openspec/records/ux-audit-offline-live.md` §七。
- **第三轮 QM-6 抓到并修掉的不对称（i1，Critical）**：新鲜度守卫 `readEpoch` 只在**断网**那条边上生效 —— `offline:lost` 的回调末尾调 `reconcile()`（其内部 `const epoch = ++readEpoch` 就是「作废在途」这个动作本身），而 `offline:restored` 只赋值、不作废。后果：一次更早发出的 `offlineStatus()`（例如浏览器 `offline` 事件触发的那次）可以在**恢复推送之后**才落地，把横幅从「已恢复」改回「离线」，而两次读各自的日志都完全正常 —— 这是「谁最后到达谁说话」，不是「谁最新发起谁说话」。修法＝对称化（恢复回调末尾同样调 `reconcile()`），**不新增第二份 epoch 写法**。先写红用例（把那次复核做成慢响应、在 restored 之后释放）⇒ `1 failed | 16 passed`，红的正是新加那条；修复后 `useOfflineStatus.live.test.js` + `tests/offline-manager.test.js` **44 passed / 0 failed**。
- **本轮评审自身的读数（不美化）**：不带 `CCG_ARL_DIR` 时驱动 rc=2 的含义是「一条都没跑」（引擎不在仓内，真源在 `~/.qoder-cn/skills/adversarial-review-loop/scripts`）；带上之后轮 1 调 claude 回来的是**输出被截断**（括号计数配平 12/12 但结尾不是 `}`），同样 rc=2。两种 rc=2 形状相同、含义不同，都**不得**被读成「评审过了没问题」。可复现的下一步是分批 + 收窄提问（只挑 Critical / Warning），不是重跑同样的输入 —— 见执行记录 §八。


# [未发布] fix(ui): 去掉窗口顶部那行系统菜单 File/Edit/View/Window（remove-native-menu-bar）

- **问题**：主窗口顶部一直挂着一行系统菜单 `[File] [Edit] [View] [Window]`。它不是本产品的功能入口（左侧导航栏才是），却白占一整行窗口高度，还把「汤姆鱼」品牌栏和内容区整体往下挤。用户截图指认要去掉这一行。
- **根因**：Electron 默认给应用装一份「默认应用菜单」，本仓从未替换过它——`Menu.setApplicationMenu` 全仓**零调用**，所以每个窗口都自带这行菜单。**它不是渲染层画出来的 DOM，是原生窗口框架的一部分**，改 CSS 改不掉。
- **修复**：新增 `apps/desktop/electron/services/native-menu.js` 作单一真源，分两级移除：① **全局** `Menu.setApplicationMenu(null)` 移除默认菜单**模板**（根因级，之后创建的窗口不再自带这行）；② **窗口** 主窗 `autoHideMenuBar: true` + `win.setMenu(null)`，把「这个窗口没有菜单栏」钉死在窗口自己身上——将来即便有人再调 `setApplicationMenu` 装了个菜单，主窗口也不会重新长出这行，按 Alt 也唤不回。两级缺一不可：只做全局，窗口若先于菜单设置创建仍会带菜单；只做窗口，其它窗口（登录窗、授权窗）仍会带菜单。
- **平台策略**：macOS **保留**原生菜单（它的菜单在屏幕顶部且承载 Cmd+C/V/Q 等平台级快捷键，移除会破坏平台惯例）；本仓 electron-builder 只配了 win（nsis），保留 darwin 分支是为了将来出 mac 包时不至于静默坏掉。
- **明确不做**：不动托盘右键菜单（`system-tray.js` 是另一套，用户要的是窗口内那一行）、不动应用内导航菜单（`app-menu-config.js` 是运营中心下发的侧边栏配置）、不改任何既有快捷键语义、内嵌视图布局不受影响（`view-bounds.js` 早已统一走 `getContentBounds()` 客户区，菜单栏消失后视图自动铺满新客户区，无任何硬编码偏移）。
- **回归保护**：新增 `electron/services/native-menu.test.js` 15 例（平台策略 / 全局移除 / 窗口移除 / API 缺失不抛错 / 幂等 / **真实依赖锁**：直接读已安装 Electron 的 `electron.d.ts` 核对 `Menu.setApplicationMenu(Menu|null)`、`BrowserWindow.setMenu(Menu|null)`、`autoHideMenuBar?: boolean` 三处签名，不靠记忆）+ `window.test.js` 2 例（`autoHideMenuBar=true`、`setMenu(null)`）+ `main.test.js` 2 例（启动即置空应用菜单、且发生在窗口创建之前）。
- **变异反证**：撤掉实现（删 `removeWindowMenuBar(mainWindow)` / `autoHideMenuBar` / `removeApplicationMenu`）后 **4 条新锁当场变红**（window 2 条 + main 2 条），确认不是「恒绿的装饰性断言」。
- **验证**：3 个测试文件 101 例全绿；eslint（改动 6 文件）rc=0；**QM-1 打包 PASS**（`electron-builder --win --x64` exit 0，产出 `Multi-Publish.Setup.0.2.0.exe`）；**真机验证**：启动打包产物并抓原生窗口截图，标题栏下**直接就是侧边栏与内容区**，File/Edit/View/Window 那一行已消失。


# [未发布] docs(changelog): 把 #2842 squash 漏带的那一行「顺带修复」条目逐字节搬回主干（restore-2842-changelog-entry）

- docs(changelog): 现场取证 —— 落地判据对 `fix-rewrite-paragraph-preserve` 报一行 LOST（`落地版本=版本不同@1292b6555(主干独有0行/我这版独有1行)`、`份数=short 1(base=0 tip=1 main=0 可解释容量=0)` ⇒ `onlyInMerge=0`），`--allow-different-landing` 按 §12 收紧后的谓词**拒绝放行**；逐 blob 比对给出的方向是：squash 落地的 CHANGELOG blob `a12acd8a8` 与分支倒数第二笔 `49165a742` **逐字节同一份**，而那一行由最后一笔 `214cbb2e2` 写下，其提交时间 14:55:12Z 比合并时刻 14:43:15Z **晚 12 分钟** ⇒ 产物是 tip 的严格子集，不是"另一版"。
- docs(changelog): 正解只有"逐字节搬回"这一种：判据按行比较，改写那一行（哪怕补一句出处）不会清除 LOST，只会把一条记录变成两条互相对不上的记录。实质内容当年已由 `e5fb069b7`（#2852，提交主题直写「#2842 合并时序错位漏带」）追平落地，所以本片补的是**记录**不是**行为**，零运行时变更。
- docs(prd): `01-docs/PRD-BRANCH-MERGED-CHECKER-2026-10-16.md` 追加 §13 ——「合并之后又往分支推提交」这一形态判据只能读成 `onlyInMerge=0` 的 different，是 §12 那一刀（谓词要求 `onlyInMerge>0`）第一次在真实分支上拒绝放行；同时如实留下一格未关：没有任何门禁在看"closed PR 之后 head 又动了"这件事。

# [未发布] fix(gates): CLI e2e 用例预算的采样域补齐两根轴——workflow × 作业名的生产者登记表，覆盖度逐轴判（case-timeout-audit-coverage-domain）

- **这是 PR #4072 记下的同族第二处，且已当场取证**：`scripts/case-timeout-audit.js` 过去把「域」写成**两个单数常量各持一根轴**（`WORKFLOW = quality-gate.yml` + `JOB_RE = /QG Desktop Shards/`），于是「还有别的 workflow 在跑这条用例吗」这个问题在代码里不可表示。逐份作业日志按**目标用例全名**过滤 verbose 行实测：`QG Coverage` 1 条 = **1705ms**、`Shards (1/2)` 1 条 = 1261ms、`Shards (2/2)` **0 条**；而**另一个 workflow** `electron-ci.yml` 的 `electron-tests` 也产同一行 = **1331ms**（同 run 的 `Changes` 作业 0 条）⇒ 两条都不在旧域里，现存 `maxObservedMs=12744` 是旧域读数 = **下界**。
- **为什么不在 #4072 里顺手改，而在这里改完两根轴**：#4072 当时把它记成「未判定」，结果缺陷又多活了一次合并。教训是**取证成本极低（一次日志 grep）的遗留应当场做完**；本轮取证为「是」后一次把两根轴都做完整，而不是再扩一次作业名轴、把 workflow 轴留下当 #4072 那样的第二处遗留。
- **修法**：① `PRODUCERS` 显式登记表（每条 = workflow × jobRe，注释里带当场读数与 run 号）；② 三个纯函数 `isProducer / producerWorkflows / pickProducerJobs`，A/B 负控直接打在纯判据上（无需网络）；③ `listRuns(workflow, …)` 按 workflow 各列一份窗口，`collect` 循环 `producerWorkflows()`；④ **覆盖度逐轴判**并产出 `shortWorkflows`——合并 run 总数会让稀少那条轴静默采不满而读数照样「够 8 个 run」；⑤ 删掉两个单数常量与导出键 `JOB_RE`（改导出前先做**未截断** `git grep` 清点消费者）；⑥ `source` 文案写明下界方向与「更低值不构成收紧理由」。预算取值 `60000ms` 一字未动。
- **一条必须留名的 shard 陷阱**：`QG Desktop Shards (2/2)` 本次 0 命中，很容易被「顺手精确化」排除掉——但该用例落进哪一片由 vitest `--shard` 决定，文件数/顺序一变就重分片，按「今天落在哪片」来排除等于埋一颗静默丢样的雷。所以 A 臂**显式断言 `(2/2)` 必须命中**（变异 K5 实测红）。
- **现场端到端对照**（`node scripts/case-timeout-audit.js --runs=1`）：`wf=electron-ci.yml … hits=1 max=1331` + 两条 `wf=quality-gate.yml … max=1525/1632` ⇒ `runs=2 jobs=3 samples=3 max=1632 drift=OK_BELOW_RECORD` 且 rc=0；**同一窗口旧域只会采到 1 条**。`errors=1` 是 `(2/2)` 那趟 0 命中的留痕（不是静默跳过）。`drift=OK_BELOW_RECORD` 且**没有**据此把 12744 改小——不对称纪律现场兑现；回填要的是整窗 `--runs=8`（约 32 份日志、十分钟级），已登记为遗留 #1。
- **TDD / 反证 / 一处自我纠正**：先红 `2 failed | 44 passed`（红因 = `PRODUCERS` 缺席、`source` 未点名生产者）⇒ 实现后 **46 passed**；变异 **K1–K6 逐条指名变红且按字节还原**（K1 退回单条登记 / K2 抹平 workflow 轴 / K3 退化成扫所有作业 / K4 循环写死单 workflow / K5 排除 `(2/2)` / K6 覆盖度搬到循环外）。两处判据自错记录在案：① 正向锚最初按我设想的写法（循环 `PRODUCERS`）锚，实现选了按 workflow 去重分组 ⇒ **改锚点形状**（锁「循环取域并喂进 listRuns」这条可执行链 + `listRuns(` 后不得跟字面量），不放宽强度，K4 照样红；② 最初把 1705/1261 报成「该文件全部 43 条 verbose 行的 max」，按用例全名重过滤后确认这两个数恰好就是该用例的耗时（它是该文件最慢一条）——结论未变，但**用全体取 max 冒充单用例**这个推导是错的。
- **边界**：`lock-timing-audit.js` 的 workflow 轴仍未扩（#4072 记录 §4 第 3 条）——本片只把 `case-timeout-audit.js` 的两根轴做完整；两个脚本取数对象不同（握手行 vs verbose 行），修法同源但登记表不能共用一份。无 UI / locale / 主进程运行面改动，QM-1 与 QM-4 判 N/A。执行记录：`openspec/records/case-timeout-audit-coverage-domain.md`。

# [未发布] feat(ui): 桌面端视觉系统升级 —— 统一表面层级、品牌渐变与高级感细节（ui-visual-premium）

- **一句话**：把「视觉」从**每页各写各的**收敛成**一套分层令牌 + 一套观感口径** —— 表面五层、圆角六档、品牌渐变统一、标题与数字排版归一、P0-6 点名的四类空态不再用虚线；并落一套**机器可复跑的界面面巡检**（34 路由 / 210 界面面：亮 177 + 暗 33 / 每张标注页面·位置·操作状态）。
- **动因是当场量的，不是推测**：用户反馈「视觉不统一、混乱、粗糙、不精致」。用 `ui-audit-recon.js` 逐路由枚举可见元素的计算样式，得到 **142 种颜色值**（其中 10 种是肉眼难辨的灰）、**22 种圆角**（设计系统只定义了 6 档）、**143 种间距组合**、**3 套字体栈**、**3 种页面标题色**（品牌紫 / 墨色 / 链接蓝）、以及 `19.5px` / `13.3333px` 一类小数像素字号。数字把"感觉不统一"变成了可指认的失败面。
- **改法（分层，不是换色）**：① **令牌层** `tokens.css` 新增表面/描边/高度/渐变/玻璃/动效/统一字体栈，亮暗两套**同构**（暗底上描边变成"发光的边"而不是"更深的边"）；② **契约层** `cohere-design-system.css` 保持只管「有哪些类、语义是什么」；③ **观感层** `premium-components.css` + `premium-design-system.css` 管「这些类看起来应该怎样」。**观感与契约混在一份文件里，改一次观感就会顶破逐文件行数门禁的登记目标**（实测 TARGET_GROW 1794 > 1698）——分层后契约文件回到 1696 行。
- **几个具体决定与它们的理由**：卡片与页面底**同色**（都是 `#fff`，只靠 1px `#efefef` 分隔）→ 引入表面阶梯，卡片改白色浮层 + 发丝描边 + 投影；卡片 hover **整块泛粉**（`--soft-stone` #faf6f8）→ 改「升起 + 影加深 + 描边加强」；主按钮是**纯平** `#5048E5` → 改品牌渐变 + 柔光（白字压渐变两端 ≥ 4.5:1，实测 4.91:1 / 5.51:1，亮端锁死在 `#8B3FD9`——再提亮会跌到 3.96:1 不合格）；标题三色并存 → 统一墨色（品牌色只留给图标/状态/CTA）；数据看板数字用 `JetBrains Mono`（本机未装，回退系统等宽体）与首页数字**不同字形** → 统一展示字族 + `tabular-nums`（多卡小数点对齐）；空态与付费占位用**虚线**（产品语义 = "没做完/出错了"）→ 付费占位改柔面 + 品牌色边条；空态改实线发丝——**本轮落地的是 P0-6 点名的四类**（首页两处 + 效能洞察两处），其余 4 类语义空态与像素基线视图耦合、改样式会动基线，已连同选择器清单登记为下一阶段（报告 §3 P0-6「落地状态」）。
- **配套的机器守卫**：① `ui-audit-recon.js` 逐路由统计色/圆角/间距/字体的碎片度；② `ui-audit-capture.js` 按 6 个维度穷举界面面并逐面截图，标注「页面 / 位置 / 操作状态」；③ `ui-audit-scripts.test.js` 的**路由覆盖守卫**——解析 router 全路径与巡检清单求差集，**新增路由漏登记即红**（巡检的价值全在覆盖完整，漏页若无守卫会安静地让报告看着仍然完整）。
- **守门与代价**：视觉基线属**有意变更**，由 **CI artifact 的渲染重建**后提交（仓库规矩：基线不得用本机 `test:visual:update-baseline` 的产物——本机与 CI runner 字体/渲染环境不同，同一份代码两边实测差 12~20384 px，在 CI 侧会逐张判 `BASELINE_STALE`；重建后判据本体复跑 **40/40 逐像素相等、违规 0**，本机像素回归亮/暗各 20/20 通过）；CCG 外部双家族评审（critic=claude / proposer=opencode）三轮 8 条意见**逐条裁决并全部处置**（毛玻璃 GPU 成本→半径 20px 降到 14px + `prefers-reduced-transparency` 守卫；暗色同构漏检→补断言；正则注入→补 `escapeRegExp`；零单测→补 6 例含路由覆盖守卫与变异反证；外部证据可核→补可 API 复核的公开评论）；`debt-budget` / `max-lines` 两套行数门禁**全程靠拆分与单键清账消化，一处基线都没抬**（`tokens.css` 压到 499 行、巡检脚本拆成四份、Home 样式搬到域级 CSS 后 `--prune` 单键清账）。
- **文档**：巡检报告与优化方案 `01-docs/UI-VISUAL-AUDIT-2026-10-20.md` · 产品规格 `01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md` · 令牌口径 `01-docs/design-system-usage.md` §四之二 · 执行记录 `openspec/records/ui-visual-premium.md` · 前后对照证据 `01-docs/assets/ui-visual-audit-2026-10-20/`（10 组关键页面 = **20 张 PNG**，约 3.5MB；巡检清单收录的 **210 张**按仓库约定留在 gitignored 目录不入库，清单本身入库）。
# [未发布] feat(门禁): 给「主干红着就别往里合」装执行体，并在自己的 PR 上把它跑红过四次（podcast-ci-new-red-gate）

- feat(门禁): 给「主干红着就别往里合」装上执行体——新增 `scripts/check-main-red.js` + 判据本体 `scripts/lib/main-red.js`，`merge-when-green.sh` 与 `merge-when-green.ps1` 两个合并入口都强制在 REST 合并动作之前调用它（AGENTS「PR 自动合并」判据第 2 条从此不再靠会话临场判断）。动因是实测：该判据比 GitHub 的 required 清单更严却只以散文存在，一条**非 required** 的分片红先随窗口合进 main，main 转红后反过来把之后每个 PR 的 required `Gate Result` 判红，两个 PR 被冻约 40 分钟，而冻住它们的不是自己的改动。
- feat(门禁): 判据是**差集归因**而不是"有红就拦"——`新增红 = 本 PR 失败集 ∖ 主干失败集`；五档退出码各自可分辨（0 可合 / 1 本 PR 新增红 / 2 主干红着停手 / 3 未证实：pending 或零检查 / 4 判据自身故障），把工具的失明读成"没有红"被显式挡在 4 档。主干红时即使本 PR 全绿也不许往里合；唯一出口是本 PR 正是去修那条红的，此时显式传 `--allow-main-red "<归因+run 号>"`，它**只豁免差集外的既有红、不豁免新增红**。
- fix(门禁): 检查形状归一必须同时认两种真实响应——`gh pr checks` 的 `{name, state}`（大写枚举）与 `gh api .../check-runs` 的 `{name, status, conclusion}`（status 小写、结果在 conclusion，未完成时 conclusion 为 null）。只认其一会把另一种整列读成 `unknown`，而 `unknown` 既不算红也不算绿 ⇒「一条红都没找到」其实是探针失明；`completed` 却缺 `conclusion` 一律不猜。
- test(门禁): 回归锁 21 条并接进 `quality-gate.yml` 的 **Gate 2b8**（落 changes 作业——static-gates 带 docs-only 门槛，守门判据落在会被自己防的那道短路里等于给自己关掉校验）。含一条**接线锁**：两个入口调用的路径必须逐字等于 `scripts/check-main-red.js` 且该文件存在，并必须排在合并动作之前。变异反证 4 条 N1-N4 全部 CAUGHT；其中 **N3 第一版是假 CAUGHT**——驱动只看"输出里有没有那个用例名"，而 ok 行同样带标题，于是 rc=0/14 pass 被读成抓到；同时暴露接线锁只 match 子串、把调用改名为 `_nope-check-main-red.js` 仍算通过，判据已收紧为按被调用路径本身判定。
- docs(门禁): 刻意**不**把 `QG Desktop Shards` / `QG Coverage` 加进 required 清单——那是改「谁来守门」，AGENTS 明写必须人工过目。本判据的作用是让"main 红"变得可见且可归因（读数首行自带 `MAIN-RED verdict=… main=<sha> newRed=<k>`），而不是替人改分支保护；差集按检查名对齐的**局限**也一并写进读数行，防止"同名红"被读成"已解释的红"。
- fix(门禁): 第三轮 QM-6 外部评审（critic=claude，7 条发现、最低维度分 4）指出的四处已修，其中一条 **Critical**：`judge()` 在**全部行都落进 `unknown`** 时一路走到最后一档，打印「主干绿、本 PR 无红」并 exit 0——把「没测出来」读成「测出来是绿的」，正是本判据自己开头写要防的同型；现在 PR 侧或主干侧任一条不认识即 exit 4 并列出条数与示例，读数行新增 `unknown=<pr>/<main>`。另三条：差集的**优先级**（一条已落地的红不得被「别的格子还没跑完」降级成 INCOMPLETE，新增红先于 pending 判定）、**主干侧 pending 使基准不稳**（此时判「新增红」是把未证实当证据，一律 INCOMPLETE）、`--paginate` 配数组形 jq 会在翻页时拼出非法 JSON（改为逐行解析并点名行号，单页多页同形）。回归锁从 14 条增至 21 条，变异反证累计 9 条 N1-N9 全部 CAUGHT（N1-N4 为第二轮，N5-N9 为第三轮）；其中 **N7**（把 pending 判定挪回新增红之前）一次打红 6 条——红集首条是既有的「本 PR 有红且主干无同名红」，第三轮新增那条也在红集内，如实记为红集重合而不是"锁没牙"。
- fix(门禁): 第四轮 QM-6 外部评审又给出 **1 Critical + 4 Warning，全部 upheld 并已修**——① 整段 diff **没有任何 fetch**，读的是本地 `origin/main` 这个 remote-tracking ref（worktree 里它只是上次 fetch 的快照），主干刚在远端变红时闸门会把「远端已红」读成绿并 exit 0 放行：**本片要防的失效被自己的前置条件重新打开**；现在 `mainSha()` 先 fetch 再 rev-parse，顺序由结构锁钉住（只断言「调用过 fetch」不够，顺序反了照样读旧快照）。② 空 `check-runs` 被第三轮改成抛错，于是 judge 的「零检查 ⇒ INCOMPLETE(3)」档在生产里**永不可达**——写了档位却永远走不到就是装饰性分支；现改为返回空数组，**这条修复当场在自己的 PR 上显形**：`#4024` 之前被自家闸门判 `SELF_FAULT：check-runs 返回空文本`，现在如实报 `INCOMPLETE「本 PR 一条检查都没有」`。③ 主干侧 pending 从「整批降级成未证实」收窄成**按名字**：同名检查还没落地时判新增红是把未证实当证据，但主干上一条无关的 pending 不该让 PR 侧已落地的红判不出来。④ 主干确红那一档挪回 PR 侧 pending **之前**，否则「主干 3 条红 + PR 有 1 条在跑」被报成 INCOMPLETE 且只字不提主干红——「得有人去修 main」这个信号被自己的未完成态藏掉。⑤ `--allow-main-red` 必须**点名**至少一条真实失败检查名，否则判 SELF_FAULT：任意非空字符串即全量放行等于「写个非空串」就是出口，而 AGENTS 写的出口是「本 PR 正是去修那条红的」。回归锁增至 **25 条**，变异反证累计 **14 条（N1-N9 + R1-R5）全部 CAUGHT**，R3 一次打红 3 条（如实记为红集重合）。
- fix(门禁): 修掉本 PR 自己在 CHANGELOG 顶部留下的 orphan 标题（QM6 第三轮 i4）——`check-changelog-growth` 按标题计数，而并集式解冲突把下一个块的标题行重复插了一遍，形成一条**没有任何正文**的 `# [未发布] feat(gates): UX 审计阶段…`；它与 325 行那条真块同名，审计者读到会以为那个 change 有两个未收口的块。判据按**标题行形态**数，不按字样数（字样也会被正文引用）：`^# \[未发布\] feat\(gates\): UX 审计阶段` 的出现次数本文件=1、`origin/main`=1。
- fix(门禁): 第五轮由**只读 fresh-context 对抗评审**（子代理，不是 QM-6 那一轴、不产闭环状态）命中四处会让这道闸门重新变成「一次都拦不了」或「拦错东西」的形态，逐条现场取证后全部成立并已修：① **Critical** 判据只给 PR 侧设了零检查档，主干侧 `mainRows=[]` 时三个集合全空，一路走到最后一档打印「主干绿、本 PR 无红」并 exit 0（与文件开头要防的「把工具的失明读成结论」同型，且这个输入正是第四轮 i3 自己写下的真实形态）；② 闸门在两个合并入口里被排在「本 PR 失败清单」之后，于是在**立项的那个场景**（主干红 ⇒ 每个 PR 的 required `Gate Result` 跟着红）它一次都不会执行、rc=2 在入口路径上不可达，而接线锁当时只断言「在 REST 合并之前」——那个弱性质照样成立，所以 25 条锁全绿却测不到它；③ `--allow-main-red` 点到任意一条主干红就放行整批，且 `indexOf` 是裸子串匹配（`Gate Result` 会在 `Gate Result 2：修它` 里命中并替相邻键名顶罪），未点名的红连名字都不再出现在读数里；④ `merge-when-green.ps1` 的 `Fail()` 在 `$ErrorActionPreference='Stop'` 下先 `Write-Error` 抛终止错误、`exit $code` 永不执行，本机对照实跑 `stop_rc=1 / host_rc=7` ⇒ 文档化的 2/3/4/5/6/7 全塌成一档。另两处顺带收紧：接线锁改为**剥注释**（注释里的同款文字不得再算接线）、合并请求必须带 `-f "sha=<被验过的那个 head>"`（不传时 GitHub 合的是执行那一刻的 head）。三个 commit status 态 `EXPECTED/NO_STATE/STARTING` 归 pending 而不是 unknown（评审自己标注「本仓现在没有 commit status，属将来时」，但落 unknown 的后果是接了外部 CI 后闸门恒 rc=4）。回归锁 25→32 全绿（7 条新锁先见证指名红再实现），新增变异反证 R6-R14 共 9 道全部 CAUGHT、逐条还原 md5 相同；两个入口改完都过真解释器（`bash -n` OK、`Parser::ParseFile` 在 5.1 与 pwsh 7 各一遍 `TOKENS=716 ERRORS=0`）。
- docs(门禁): 第六/七轮补跑真外部评审并逐条处置——claude 后端 2026-10-20 因 403 额度经用户裁决跳过，10-21 复测探针回 `OK` 后按 `sh scripts/deep-review.sh` 真跑两轮（critic=claude / proposer=opencode）：评中间态那轮 8 条（2 Critical + 5 Warning + 1 Info，最低维度分 3），采纳三条并**先让新锁见证指名红**再实现——`counts`/读数行补出 `uncertain=`（此前"被主干同名 pending 摘掉的那几条红"只活在 reason 散文里，机器面看不见）、无名或非对象的行一律判 `SELF_FAULT`（`bucketOf(null)` 归 unknown 但 `namesBy` 先按名字过滤，这类行既不进 fail 也不进 unknown 集合 ⇒「一条红都没找到」其实是探针失明）、`Fail()` 除 stdout 外同时写 `[Console]::Error`（按 stderr 判失败的调用方原本会漏捕）。其余五条逐条否证并留可当场重取的证据：`NEW_RED` 先于 `STOP_MAIN_RED` 不掩盖主干红（`check-main-red.js` 自第五轮起无条件打印主干失败格子，且两档都拦）；把 `Fail()` 拆进三个文件属重构非缺陷；`.ccg/reviews/*.json` 是 QM-6 机械闭环链的载体，gitignore 等于拆掉守门；`parseCheckRunLines` 拒绝多余键会让 GitHub 每次新增字段就把整道闸门判成故障，而语义层的未知值已经判 4 档。
- test(门禁): 两处驱动自曝（都记下来，因为它们是"看起来在测"的标准形态）——① 变异驱动写成了 `mutated.replace(() => newS)`，第一参数被当成**查找串**，于是变异从未生效，而它如实报了 `MISSED rc=0`；正解是 `split/join` 并加一条 `NO_OP` 档（替换后字节不变就不许进任何结论）。② 行为锁的夹具**手抄了一份 `Fail()`**，所以我改生产文件它测不到；改成从 `merge-when-green.ps1` 直接切函数体灌进探针脚本，rc=7 与 stderr 两条同时绿。回归锁 32→34，变异 R1-R18 全 CAUGHT（R15-R18 是这两轮新增的四条，逐条还原 md5 相同）。
- fix(门禁): 第八/九轮把「主干红被降级成未证实」这一格的两个入口都补上——① `prRows.length === 0` 的早退排在主干红之前，导致「PR 零读数 + 主干已红」只报 INCOMPLETE，操作者只会去等 runner；② 更要紧的是 `--allow-main-red` 覆盖全部主干红后**直接返回 OK**，完全不看 `prPending`，把「本 PR 还没被测过」豁免成"可以合并"。两处各自加了守卫（豁免不覆盖「PR 侧根本没读数」），并把 `uncertain` / `prPending` / `mainPending` 一起写进 `counts` 与读数行，理由与机器面同口径。锁 32→36（每条都带正控：合规形态必须仍然放行），变异 R15-R21 共 7 道全部指名 CAUGHT。

# [未发布] fix(rewrite): 敏感词 warnings 从红色错误区改到 warning 级——改写页与 AI 面板（fix-rewrite-warning-severity）

- **问题**：PR #4103 关了引擎的前置敏感词拦截，方案「B+」是「关前置、留后置」——改写结果若仍含敏感词，引擎在 warnings 里提醒人工审核。但 `RewriteView.vue` 与 `AiWriterPanel.vue` 把 warnings 写进 `rewriteError` / `panelError`，而这两个变量渲染的是 `role="alert"` 的**红色错误区**，且同一时刻 `notifySuccess` 刚弹了成功提示、`rewriteResult` 已赋值 ⇒ 用户看到「红色错误 + 成功提示 + 有结果」三者并存，视觉语义自相矛盾：要么以为改写失败了，要么以为这个错误可以忽略。采集页 4 入口的同类问题已在 PR #4141 修掉，本轮补齐剩下两个消费点。
- **根因**：warnings 与 error 共用一个状态变量，而这两个语义相反——一个是「成功但需注意」，一个是「失败」。
- **修复**：两处各新增独立状态（`rewriteSensitiveWarnings` / `panelSensitiveWarnings`）+ warning 级呈现。RewriteView 侧把呈现抽成独立组件 `apps/desktop/src/components/RewriteSensitiveWarning.vue`（复用截断横幅的暖橙 warning 样式类，刻意不用红色错误样式）。复位逻辑补在 `startRewrite` / `doRewrite` 入口，避免上一轮的警告残留着警告这一轮的新结果。
- **回归保护（新增 5 例）**：`RewriteView.sensitive-warning.test.js`（3 例）+ `AiWriterPanel.test.js` 追加 2 例，锁住 ① 有 warnings 时 `role="alert"` **不得**出现；② warnings 以 warning 级提示元素呈现；③ **真正的失败（success:false）仍然进红色错误区**——防止后续有人把两者一起放宽。**此前两个测试文件的 mock 都带 `warnings: []`，无一例覆盖 warnings 非空路径**，空数组让 `if (data.warnings && data.warnings.length > 0)` 永不成立，病灶被永久掩盖。
- **变异反证**：把 warnings 改回写进 `rewriteError` / `panelError`（恢复旧病灶）⇒ 对应测试**双双当场红**；恢复后 grep 确认零残留。
- **顺带修 CI 的 RED（用户裁决）**：`RewriteView.vue` 在 origin/main 上已 **1418/1419** 行（贴住 max-lines 上限），199 行历史漂移由 #4123/#4078/#4063/#4032 等多个他人 PR 累积，本 PR 只净增 12 行却触发 `LEDGER_GREW`。已按用户裁决把基线单键精准更新（1219 → 1430，**diff 仅 1 行且完全可归因**），**未使用 `--update --rewrite`**（脚本注释明确警告它会掩盖他人漂移）。
- **验证**：`RewriteView.sensitive-warning.test.js` 3 例 + `AiWriterPanel.test.js` 25 例全绿；三文件同跑 126 例全绿；隔离验证（单独 / 与 AiWriterPanel 同跑）全绿；稳定性 5 轮同跑 + 2 组隔离共 7 次 0 失败；7 道静态门禁全 PASS。QM-1 非强制（只改渲染层）；QM-4 本地 20 视图 9 失败但**失败清单里没有 rewrite**，且同一套基线在 CI 的 `QG Visual` 为 success，判定为本地环境缺失、非本 PR 引入，未刷新任何基线。
- **踩坑（已写进 learnings）**：① 新增用例最初多文件同跑时偶发失败，两种想当然的修法（改 `mockResolvedValue`、把信封下沉进 mock 工厂）都无效甚至更糟，**真正生效的是每个用例末尾 `w.unmount()`**——前一个用例未卸载组件的 async 链路会跨用例残留；② 用 Node 脚本批量替换 `vi.mock` 段把文件结构改坏了，症状是「no tests」而非语法错误，极易误判。
- **遗留（不假装已闭合）**：`RewriteView.vue` 仍是贴住上限走的文件（彻底解法是拆 composable，属独立重构任务）；本地 QM-4 视觉回归未通过（9 个失败均与本 PR 无关，未刷新基线）。

# [未发布] fix(播客): 撤掉音色回退链第①档（频道 voiceRef 在代码路径上无写侧）（podcast-drop-channel-voiceref）

- fix(播客): 撤掉音色回退链的第①档「频道 voiceRef」——取证（扫描域经外部评审纠正）`git grep -n voiceRef -- apps/desktop/electron apps/desktop/src packages` 的命中逐条归类后只剩「请求载荷路径 + 测试夹具」两类，没有对 `meta.voiceRef` 的赋值：频道 meta 白名单不产出该字段、频道页无音色控件、渲染层从不发送，全仓唯一触点只有那个"读给它自己听"的注入。这一档在代码路径上恒为空；但频道存储面 `podcast-channel-service.js:296` 不滤未知键、`validateChannel` 不剥未知字段，走 API 或手工改盘仍能把该字段写进 meta，故对这类存量频道撤档会改行为——已加一条 warn 出声，不静默。留着的代价是一条不可达的档位会让下一个读者以为"频道可以配音色"而不去补真正需要的入口（tasks 4.5b② 经用户裁决改判「撤档」，PRD 新增 §7.4.1.2 记录裁决与取证）。
- fix(播客): 回退链口径随之收敛为两层——① 用户偏好 → ② capability `defaultVoiceId` → ③ 都拿不到拒绝出期；`podcast-tts-voice.js` 删 `channelRef` 入参 / `channelRefParts` / `VOICE_ORIGIN.CHANNEL`，`podcast-episode-plan-preview.js` 的 `REQUIRED_DEPS` 4→3，`ipc-handlers/podcast.js` 删掉读 `meta.voiceRef` 的注入。入参形状层的「三段同存或同缺」判据仍只在 `voiceRefIssues` 一处，没有因这次删除而失去落点。
- fix(播客): 预览的「频道存在性」判据改为显式一次只读——原先这条由 `channelRefOf` 那次读取**顺带**完成，撤档会把它一起带走，而它已被现存用例契约化（`podcast-plan-preview-ipc.test.js`「频道不存在时由服务如实拒绝」）。现在 handler 里显式 `getService(cid).getChannel()`（只读，`assertChannelWritable` 仍一次都不许被调）；变异 M3 实测摘掉这一行 ⇒ 该用例指名变红。
- feat(播客): 渲染层来源标注由三态改为两态——`ORIGIN_KEYS` 删 `channel`，那张「要不要出声」的表（`ANNOTATED_ORIGINS`）在闭集只剩两档后与闭集完全重合，一并删除（§8.2.9 判据 2 随其对象退役，不是被放宽）；`podcast.episode.originChannel` 的 zh/en 两把键同 PR 下线（已无消费者，AGENTS 禁止留死键）。
- test(播客): 撤档锁 5 条 + 变异反证 6 条（M1-M6，第三轮补 M4 重定向与 M5/M6 两条）——`podcast-tts-voice.test.js` 删 5 条第①档用例、新增「闭集只剩两档」与「源码剥注释后不得再出现频道三段读取形状」（剥注释配 `require(` 正控，防切片切错把"禁词全不命中"读成通过）；`preview.test.js` 新增「`REQUIRED_DEPS` 恰三键且不含 `channelRefOf`」「接线处 0 命中」「预览本体无 `channelRef`」。消费者并集 46 文件 818 passed / 0 failed（口径本轮扩到 6 个被改/相邻模块，上一轮记的 39 文件是 3 模块口径）；QM-1 打包 PASS（三个改动模块包内 blob 与工作树逐字节相同，启动 8s 存活、stderr 0 字节）。
- fix(播客): 第三轮 QM-6 外部评审（critic=claude，7 条发现：2 Warning + 5 Info，最低维度分 6）指出的四处已修——① 存量口径只写了「原本命中频道档」一侧，漏了「原本被半配置/非对象硬拒、撤档后变成通过」这一侧（PRD §7.4.1.2 现补全两个方向并新增用例钉住）；② 出声判据从「truthy 即出声」收紧为逐格对齐旧守卫 `ref != null && (typeof ref !== 'object' || Array.isArray(ref))`，`{}` 与三段全空不再误报（给未受影响的数据发告警会把真那条埋掉）；③ 存在性读取的**位置**改为排在 `previewEpisodePlan` 之后——主干上它发生在分块与形状校验之后，挪到前面会让「正文太短」被频道错误抢先，那是两个不同的用户可见错误码；④ 因此第一版那个 `if (String(cid||'').trim())` 门控被删（它是同一判据的第二份），空白/畸形 id 由形状层拒、根本走不到服务。另有两处文档债：渲染层断言从 `not.toContain('频道')` 改成整行等值（文案将来合法含「频道」时前者会误红），模块头不再复述撤档取证（真源只有 PRD §7.4.1.2，抄三处必漏两处）。
- docs(播客): 撤档顺带照出一处一直存在的断链，记为 tasks 4.5b④——`resolveEpisodeVoice` 的生产调用方只有只读预览一个；真出期 `podcast-episode-host.js` 取的是请求载荷 `p.voiceRef`，而渲染层从不发送 ⇒ `getConfiguredProvider` 拿不到 `voice_provider` ⇒ 落 edge-tts，再落 `anullsrc` 静音。即"浮层承诺的音色"与"实际发声者"由两条不同的链算出，且 §7.4.3 明写的"三段同缺合法，由主进程按两层取"在代码里没有对应实现。接上它会当场改变已配默认 provider 账号的成片发声者，属用户可感知行为变更，故单独成片（合同半步先写进 PRD §7.4.1.2 与 tasks）。
- fix(播客): 第五轮由**只读 fresh-context 对抗评审**（子代理，不是 QM-6 那一轴、不产闭环状态）命中三处留痕机制的方向性缺陷，逐条现场取证后全部成立并已修——① **出声整段排在 `await` 之后**，于是「撤档把命中频道档的成功变成两层全空的拒绝」这一格（最需要留痕的那格）一次都不出声；② **出声范围把非对象标量也算成受影响**：范围其实由主干那行注入 `typeof === 'object'` 的滤网与旧守卫**两段合起来**决定，`''`/`0`/`false`/裸串当年就被滤成 null、走 fallthrough，撤档没改它们 ⇒ 原版给未受影响的数据发告警，还把四格误报钉成了正确预期（PRD §7.4.1.2 同句一并纠正）；③ 存在性读取相对**音色解析**也后移了，「频道已删除 + 音色两层全空」的用户可见码从 `PODCAST_CHANNEL_NOT_FOUND` 变成 `PODCAST_TTS_VOICE_UNRESOLVED`（把人支去翻一个没问题的地方）——catch 里只对该一个码补读、让频道错误照常抢先，其它码一律不补读，否则 `COPY_TOO_SHORT` 会被抢先，那是同一处判据的反面。另三处：留痕按 `channelId` 去重（撤档不回填 ⇒ 状态常驻，不去重就每次开框刷屏，与本文件两条既有去重先例同口径）且消息带 channelId；`{providerId: 0}` 从「保守留下的误报」纠正为**真阳性**（当年半配置当场拒绝、撤档后通过）；预览通道的「只读」承诺收窄为「不请求可写句柄」并如实记下首触频道会顺带触发存量固化旁路写（与 `podcast:channel:get` 同路径）。两处锁的口径也补齐：禁词锁改为剥注释后匹配（同文件两条锁原本一把剥一把不剥）、主进程 `VOICE_ORIGIN` 值集 ↔ 渲染层 `ORIGIN_KEYS` 键集加集合相等锁（否则将来加第三档的漂移方向是「UI 静默不标注」而全量测试仍全绿）。**并自曝一处**：第一版为 P2 加的 `typeof` 短路被自己的变异反证 M8 判为**不可观察**（规范键名扫描对非对象天然取不到键）⇒ 删掉判据只留说明。回归锁 66→71 passed；变异反证重定向后 **M1-M12 全部 CAUGHT + 一条绿控 G1**（把禁词写进注释必须放行），每条还原 md5 相同。
- fix(播客): 第六轮补跑真外部评审并把留痕判据拆成独立模块——claude 后端 2026-10-20 因 403 额度由用户裁决跳过，10-21 复测探针回 `OK` 后按 `sh scripts/deep-review.sh` 真跑（critic=claude / proposer=opencode，6 条发现：2 Critical + 3 Warning + 1 Info，最低维度分 4 ⇒ 自扮演出口，高危域 0）；逐条裁决全部 dismissed，各带回可当场重取的证据（其中一条被主干代码逐字否证：`resolveEpisodeVoice` 先 `cleanId` 把 0 归一成 '0' 再交给 `voiceRefIssues` ⇒ `{providerId:0}` 当年确为半配置当场拒绝，采纳评审的 `typeof === 'string'` 修法会关掉这条唯一可观测的行为变更）。本片自己的闸门（PR #4024 的执行体）在合并前把本 PR 判红 `NEW_RED`（`FILES_OVER_500` 96 > 95），处置是拆结构而非 `--update` 上调基线 ⇒ 纯函数 `legacyChannelVoiceRefCarriesContent` 独立成 `electron/services/podcast-legacy-voice-ref.js`，`ipc-handlers/podcast.js` 回到 488 行。回归 71 passed、变异 M1-M12 + 绿控 G1 全 CAUGHT、QM-1 重打包 PASS、`check-pr-exec-record.js --mode=enforce` rc=0。





# fix(deps): 清掉依赖审计基线里已被 #4111 升级付清的 5 条公告登记（chore-dep-audit-prune-resolved）

> 标题末尾按合同写 **record 名（= 分支名）**。本条按 `changelog-record-carrier` 的新合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面）。

- **起因**：#4111 升级了 `follow-redirects`（1.16.0→1.16.1，两个 lock 域）与 `vite`（6.4.3→6.4.4），这 5 条公告**已不再命中**；#4117 随后把同样这 5 条登记进 `scripts/dep-audit-baseline.json`（`decision=upgrade-tracked`）⇒ main 的依赖审计按 `RESOLVED_STILL_BASELINED`（基线腐化）判红。**这笔红不在 #4111 的 PR 面上**（它的 required check 全绿），只出现在合并后的 main push 上。
- **修法**：外科式清账——以 `origin/main` 的基线为底，**只删门禁点名「已不再命中」的条目**（本次 7 条：`follow-redirects` ×4 = `GHSA-8R9P-F939-6H3C` / `GHSA-Q3JH-WRC6-JGQ8` / `GHSA-8r9p-f939-6h3c` / `GHSA-q3jh-wrc6-jgq8`，`vite` ×3 = `GHSA-698v-4r3x-3vcv` / `GHSA-587h-7wmj-h5pm` / `GHSA-r825-w8mm-5pxw`），其余条目**逐字不动**。
  其中 `vite` 的后两条是合并期间主干 #4120 新补登的（advisory 库持续增补）——**同一笔 `vite` 6.4.4 升级一并把它们也付清了**，所以它们同样属于「已不命中」。
- **冲突处置**：rebase 到含 #4120 的主干时基线文件冲突。按「两侧记录都保留」处理：取**主干**版本为底，再由**门禁自己的读数**点名要清哪几条（不靠人记清单）⇒ 主干新补的条目、以及所有仍命中的条目都完整保留，只删真正失效的那 7 条。
- **刻意不做**：不跑 `node scripts/check-dep-audit.js --update` 整份重写。实测它会把 5 条既有条目的 `patched` 从「>=1.1.x」改写成「>=5.0.x」（npm 公告的多段 vulnerable 区间被解析成另一段），而 `targetVersion` 仍是 1.1.x ⇒ 立刻触发 `DECISION_CONTRADICTS_PATCHED`——**用一个红换另一个红**。
- **门禁读数**：`node scripts/check-dep-audit.js` → 命中 28 = 挂账 28，「无新增已知漏洞公告，基线与现实一致且结论完整」，rc=0。
# feat(video-creation): 「去发布」浮窗新增「配置选择」，视频创作可一键套用已保存的配置档案（publish-config-picker）

- **新增**：「去发布」浮窗（改写页 / 采集页 / 热门选题页共用）的视频创作分支，在「流水线选择」旁新增**「配置选择」**下拉，列出**所选流水线**已保存的配置档案（按 `pipelineId` 过滤、`updatedAt` 倒序，非法条目逐条丢弃、其余保留）。
- **空态**：该流水线**一条配置都没有**时，下拉框显示文字「**默认**」且**不可展开（下拉内容为空）**，并给出一行说明「该流水线还没有保存过配置，可在创作页用「保存配置」创建」。加载中 / 加载失败 / 无配置三态互斥且都有可见文案——**加载失败不会被伪装成「没有配置」**。
- **联动**：切换流水线立即替换配置列表并作废此前选中的配置（配置档案按流水线分域，跨流水线套用是错误语义）；配置在库中消失时回落「默认」，不留悬空选中态；浮窗每次打开重新读取配置库。
- **流水线选项集合扩大**：「流水线选择」由写死的「故事讲述」一项，扩为全部**文案型**视频创作流水线（`story2video-compose` / `talking-head` / `localization-dub` / `animated-explainer` / `documentary-montage` / `animation` / `character-animation` / `hybrid` / `avatar-spokesperson`），判据与创作页「带文案进入时灰显非文案型」同源（为此给 `@/i18n/pipeline-labels` 补只读导出 `TEXT_BASED_PIPELINE_IDS`，枚举与判定共用一份真源）。素材型 / 录屏型 / 内部冒烟 / 独立页流水线**不出现**（它们接不了「一段改写文案」）。
- **交接**：`publish-video` 事件第一个参数仍是流水线 id（既有调用方零改动兼容），第二个参数新增 `{ configProfileId, configProfileName }`；跳转到创作页的 query（`draft` / `pipeline` / `configProfile`）收敛到**一处纯函数** `buildCreateHandoffQuery()`，空值/非法值一律**不带该键**（绝不传空串——空串会被创作页当成「指定了一个叫空串的配置」而报错）。
- **创作页自动套用**：新增 `CreateView._applyConfigProfileFromRoute()`，在**选中流水线之后**执行，复用既有 `applyS2VConfigProfileSnapshot()` 语义（枚举归一化 / 失效服务商回退 / 分辨率按能力上限归一 / 语音数据重载 / 折叠组恢复全部复用，不新增第二套套用逻辑），套用成功后记录已应用配置名并提示「已应用配置」。
- **修掉一处竞态**：创作页的「恢复上次选项」与本片的「套用配置档案」写的是同一份表单，并发时**后写者胜**——若恢复后到，用户刚挑好的配置会被覆盖（用户感知：「我在弹窗里选了配置，进创作页却不是那套」）。现把恢复的 promise 留住并在套用前 `await` 它，保证**配置档案（用户显式选择）必胜**。
- **修掉一处断链**：热门选题页的「生成视频」去向最终跳 `/create?draft=<id>`，**不带流水线**（弹窗里选的流水线被静默丢弃）。现随队列项一路带上 `pipeline` 与 `configProfile`；不选流水线时 query 不带 `pipeline` 键，行为与改动前一致。
- **失败路径全部可见**：配置已删除 / 跨流水线 / 套用失败 / 无法确定流水线 / **配置列表载入失败**，五种各有提示文案，且**都不阻断创作**（按流水线默认参数继续）。其中「载入失败」用**独立**提示文案，不复用「配置不存在」——配置可能好好地存在、只是这次没载入成功，说成「已被删除」是误导。

### 「其它流水线有没有配置管理」的结论

逐条核对后确认：**不是只有故事讲述有配置管理**。配置档案能力早已覆盖**全部**视频创作流水线——创作页共享分支（编排型 `story2video-compose` + legacy 型其余全部流水线，「保存配置 / 我的配置」按钮显示条件为 `v-if="selectedPipeline?.name"`，与流水线类型无关）、视频克隆页、影视工程页（均复用 `components/ConfigProfileManager.vue`）。既有规格 `openspec/specs/story2video-pipeline-config-profiles/spec.md` 的 Requirement「All video creation pipelines expose managed configuration profiles」即该契约。

因此本次**不重建**配置管理（重建会与创作页已有实现形成双源真相），而是把已有能力接到「去发布」这一步：让其它流水线的配置**在去发布时也能被选到并落地生效**。核对口径见 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md` §10.2。

### 不做什么

- 不做配置的云同步 / 账号同步 / 跨设备备份（沿用既有「设备级本地」语义）。
- 不在「去发布」浮窗里新增保存 / 重命名 / 删除（弹窗只做「选」，管理仍在创作页与两个独立页）。
- **不改**主进程配置档案服务与四个 `story2video:config-profile-*` IPC 通道、preload、`ConfigProfileManager.vue`、`api/publisher.js`——本片只消费既有契约。

### 验证

- TDD：先写断言实跑红，再实现。纯函数 `publish-destination-config.test.js` **15/15**；交接模块 `apply-config-profile-handoff.test.js` **17/17**（QM-6 第 1 轮 i4 采纳后新增 12 例，第 2 轮 i2 采纳后 +1 例「载入失败不抛异常且给独立提示」，第 3 轮 i3 采纳后 +2 例「恢复失败调用 onRestoreError」「未提供回调也不抛异常」）；组件 `PublishDestinationModal.test.js` **19/19**（既有 7 例 + 新增 12 例，含 5 例键盘可达：↓ 展开、↑/↓/End/Esc、Enter 选中、空格选中、Home+空格选中「默认」）；创作页 `CreateView.config-profile-handoff.test.js` **4/4**。本片 4 文件合计 **55/55**。
- 回归：`CreateView.test.js` + `RewriteView.test.js` + `Collection.test.js` + `HotTopics.test.js` **570/570**；另 `ConfigProfileManager` / `HotTopicsGenVideoPicker` / `rewrite-handoff` / `hot-topics-publish-ux` / `S2vConfigPanels` **60/60**。
- 门禁本机实跑：ESLint rc=0；locale 三档（`--pair-base` / `--cjk` / `--keys`）rc=0；行数两门禁（`check-max-lines` / `check-debt-budget`）rc=0；字号 / 颜色 / CSS 变量 / 前端一致性 / Vue 样式解析 rc=0；接线棘轮 / 品牌残留 / 编码完整性 / 文档绝对路径 / 冲突标记 / 视觉覆盖 / 执行记录债务 rc=0；`openspec validate --strict` rc=0；渲染层 `build:vue` rc=0。

### 文档

- 新增 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md`（详细 PRD：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 边界 / 验收 / 测试映射）。
- `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` 新增 §14「「去发布」浮窗的配置选择器契约」。
- change `openspec/changes/publish-config-picker/`（proposal / tasks / design / spec）+ 本篇执行记录。
# feat(gates): CHANGELOG 与 learnings 的热写面收敛第一步——条目真源移向执行记录，台账改由聚合器写入（changelog-carrier-aggregate）

> 标题末尾按合同写 **record 名（= 分支名）**，不是 change slug。本 PR 两者不同（分支 `changelog-carrier-aggregate`，规格 `changelog-record-carrier`），正说明键只能有一个来源：取 record 名，因为它是"每 PR 一份、路径唯一"的那个保证；change slug 会被人在 PR 中途改名，键跟着漂就会把已落条目重搬一遍。

- **动因是实测而不是印象**：当场对 4 个可判定的非 MERGEABLE PR 跑 `git merge-tree --write-tree origin/main <pr-head>`，冲突文件**只有** `CHANGELOG.md`（其中一个外加 `01-docs/learnings.md`），没有第三类文件；在飞 35 个 PR 里 5 个 CONFLICTING、22 个 UNKNOWN；最近 30 笔 main 提交有 20 笔动了 CHANGELOG。根因是形状——两个文件都要求在第 1 行插入，任意两个在飞 PR 必然抢同一位置。
- **`scripts/aggregate-changelog.js`**：把台账写入者收敛成一个。幂等键刻意取 **record 名**而不是标题文本——主干上同一标题存在多份历史副本，按标题判"已落"会把该搬的一条误判成已搬，症状是**静默少一条**，比多搬一条更难发现。现存 CHANGELOG 标题末尾括号本来就写着 change slug，与 `openspec/records/<slug>.md` 同名 ⇒ 键对存量现状直接生效，不会把已合并条目搬第二遍。
- **逐行保留行尾，禁止统一回写**（AGENTS 实测：统一回写一次改写 26 行，且此后任何并发合并都变成整文件冲突）。变异反证 7 条各自让指名的用例变红；其中 M3 第一版 NOT_CAUGHT，原因是它只改了返回值而没改落盘那一步——**那我的锁就没被验过，不是锁没牙**，改正后重跑。
- **接线三处同改**：`.gitignore` 反选本体（`scripts/*.js` 会静默忽略新建脚本）、`quality-gate.yml` 新增 `Gate 2b8`、`check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB` 登记。落点必须是 `changes` 作业，因为聚合器读的三类输入全部命中 docs-only 白名单——接在会被 docs-only 短路的 job 里等于给自己关掉校验。
- **本 PR 自己就是第一个用户**：`CHANGELOG.md` 与 `01-docs/learnings.md` 零改动，条目原文就写在本篇这个小节里；CI 上 `--dry-run` 会把自己列进 `LAND`，这是"链路通"的现场证据而不是靠读代码相信。
- **刻意不做**：不拆存量历史（实测 `3,026,950` 字节 / 577 条）、不提前摘 `check-branch-merged.js` 的共用写面登记（顺序错了会让收尾判据退回整文件比较，是已实测的假阳性来源）。原计划里"不在本次清那批重复标题键"这条**已被现场否证**：本次重取冗余为 **0 份**，那批副本在本刀之前就被清理收掉了，所以这里没有欠账可还。
- **QM-6 高危面外部评审未闭合**（本片同时命中 `scripts/check-` 与 `.github/workflows/` 两类高危前缀，`closureNote` 在高危面不够格）；如实留 PENDING，不用自扮演冒充。
# fix(rewrite): 采集页「字数」区间真实生效——修契约键（targetWordCount→wordCountRange）+ min=0 语义 + 结果字数与截断可见化（collect-rewrite-wordcount）

> 标题末尾按合同写 **record 名（= 分支名）**，不是 change slug：本 PR 两者不同（分支 `fix-collect-rewrite-wordcount`，record `collect-rewrite-wordcount`），正说明键只能有一个来源。
> 本条按 `changelog-record-carrier` 的新合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面）。

- **用户现场**：采集页把字数区间设成 **0-6000**，点「AI 改写」出来的稿子只有 **1229 字**，原文 **3515 字**，读起来像一份**摘要**、「像是没有写完」，且界面**零提示**（无字数、无截断、无异常）。按码点计数确认结果**不是被砍尾**（1229 不落在任何策略上限 800/1500/1500/2000/3000 上）⇒ 是模型自己写短了。
- **第一性原因（区间从未送达）**：采集页 `rewriteViaEngine()` 下发的是 `userSettings.targetWordCount`，而引擎（`packages/rewrite-engine`）只读 `userSettings.wordCountRange`——`targetWordCount` 在整个引擎包里 **0 处引用**。同一个错键让**三处**下游同时失效：① `_getWordCountInstruction()` 返回空 ⇒ prompt 里**根本没有【字数要求】**；② `_postProcess()` 的截断上限回落策略 `postProcess.maxLength`（用户设的 6000 变 1500）；③ 主进程桥接层 `max_tokens` 推导回落 3000 口径。引入于 `83ac2706a`（2026-09-13「length 下拉已移除」那次改造）。
- **逃逸分析**：① `/rewrite` 页（RewriteView）传的是 `wordCountRange`，**天然正确** ⇒ 缺陷只在采集页出现，表现为「同一个功能两个页面行为不一致」，第一直觉容易归因成「模型抽风」；② 引擎侧对**未知键**是静默降级（无指令 + 策略上限兜底），不报错 ⇒ 用户与开发者都拿不到失败信号；③ 该缺陷当时已被登记在 `openspec/records/rewrite-segment-contract.md` 的「遗留」节，但只记了**症状**（「max_tokens 回落 3000 口径」），没记**机制**（区间从未送达），也没记 `min=0` 语义 ⇒ 挂着没修。
- **修复（四处，缺一不可）**：① 采集页改下发 `wordCountRange: { min, max }`，**删除死键** `targetWordCount`（留着只会让人误以为设置生效）；② 区间改从共享 composable `useWordCountValidation` 新增的 `range` 取（与红字校验同一套判定）：合法下限 **0** 原样透传（旧写法 `Number(min) || 800` 会把 0 吞成 800），非法区间（浮点/非数字/max<min）⇒ 早退不发 IPC；③ 引擎 `min=0` 的指令形态由「0 到 6000 字之间」改为「**不得超过 {max} 字。目标篇幅约 {target} 字（与原文篇幅相当）；不要把原文压缩成摘要，不得省略原文的信息点**」——「0 到 N」是把「不设下限」说成「可以任意短」的坏指令，模型会照着下限写；`target = min(原文码点数, max)` 保证「目标篇幅」与硬上限**不自相矛盾**。`min>0` 的指令形态**逐字不变**（不回归 `/rewrite` 页）；④ 采集页此前**收进了**引擎的 `meta` 却**从不展示** ⇒ 新增「改写后 N 字（原文 M 字）」字数行，并复用 `utils/rewrite-truncation.js` 把**引擎砍尾**（调大字数上限有效）与**模型侧截断**（调大不一定有效）分型展示。
- **附带修正**：`collection.wordCountMinInvalid/MaxInvalid` 残留着旧上限「0-5999 / 1-6000」，与真实合法域（0-49999 / 1-50000，`rewrite-limits-50000` 起）不符 ⇒ 校正（`/rewrite` 页同款文案早已更新）。
- **顺带还了一笔结构债（CI 实测触发）**：`rewrite-engine-core.js` 的行数挂账（`check-max-lines.js` 的 LEDGER_GREW，登记值 578 + 容差 200 = **778 行天花板**）在主干上只剩 4 行余量，本次直接改核心文件 ⇒ 797 行 ⇒ LEDGER_GREW 红（这条红会卡住**别人**的 PR，因为门禁看文件当前行数而非本 PR 增量）。按门禁处方「拆分」：新增 `word-count-instruction.js`（字数指令措辞）与 `structure-headings.js`（结构标题剥离，原 `_stripStructureHeadings` 逐字搬出）两个独立模块，核心文件瘦回 **750 行**。**区间校验与两个上限常量必须留在核心文件**——渲染层结构锁直接读该文件源码，断言 `const MAX_OUTPUT_CHARS = (\d+)` 与字面串 `range.max <= MAX_OUTPUT_CHARS` 逐字存在。
- **顺带还了一笔全局安全债（CI 实测触发，非本 PR 引入）**：`依赖漏洞审计` 判红于**新发布**的公告——`follow-redirects` 两条 high（GHSA-8R9P-F939-6H3C / GHSA-Q3JH-WRC6-JGQ8，修复版 >=1.16.1），补做时又出现一条 `vite` moderate（GHSA-698v-4r3x-3vcv，修复版 >=6.4.4）。**本 PR 未动任何依赖**：同一判据在 `origin/main` 上当场复跑同样红，且该门禁卡的是**全部在飞 PR**（当时在飞 30 个）。两处都用**版本没动**的反证确认不是本 PR 引入（`follow-redirects@1.16.0`、`vite@6.4.3` 在 HEAD 的 lockfile 里就是这些版本）。处置按仓库先例（#2613「提升 undici/fast-uri 到安全修复版下限，解阻塞全部 open PR 的依赖审计红」）：`pnpm-lock.yaml` 与 `ops-center/frontend/package-lock.json` **两个域**的 `follow-redirects` 升到 1.16.1；`vite` 解析版本 6.4.3 → 6.4.4 并把**声明下限**抬到 `^6.4.4`（`apps/desktop` 与 `packages/ui`）防回退。门禁当场转绿（命中 28 = 挂账 28，基线与现实一致）。**没有**走"登记进基线挂账"那条路——那是把可修的公告写成欠账。
- **回归保护**：引擎新增 5 例（W7 `min=0` 不再出现「0 到 N」/ W8 目标篇幅=原文长度 / W9 目标篇幅=上限不与硬上限冲突 / W10 `min>0` 形态不变 / W11 浮点区间不注入）；采集页新增 9 例（契约键 + `min=0` 透传 + 非法区间不发 IPC + 浮点不发 IPC + 字数行 + 两条截断横幅**及其派生物形状** + 未截断不出现横幅 + 清空后元信息一并复位）；composable 新增 8 例（锁「校验口径与下发口径合一」）。引擎全量 268 例、桌面端采集/改写相关 116 例全绿。
- **外部双家族评审（QM-6）**：pre-commit 判 `mode=dual` ⇒ `sh scripts/deep-review.sh` 实跑 **opencode(proposer) + claude(critic)** 两个后端（`--check-deps` 体检：两个后端裸名自检均通过）。critic 给出 4 维度评分（correctness 7 / security 9 / performance 9 / maintainability 6）与 6 条争议项，5 条进入自扮演裁决并**逐条回源码核对**后裁定：**upheld 2 条、dismissed 3 条**。两条成立项已修并补回归锁：**i1** 引擎不校验区间整数性（浮点会注入「1.5 到 6000 字之间」）⇒ 引擎加 `Number.isInteger` 防御 + 前端改为从 `range` 取值；**i6** 页面派生值形状无锁（横幅会静默失效）⇒ 补 `toEqual` 形状断言。三条驳回项的取证依据（调用链逐行可查、计数口径逐字同源、locale 命名空间全局注册）见本记录下节与 PRD §10.2。
- **已知遗留（不在本次范围）**：知乎收藏批量改写（`BatchCollectPanel` / `zhihuFavBatchRun`）**没有**字数区间 UI，不存在「设置不生效」的问题，其引擎回落策略上限属既有设计；Python 旁路（`aggregationRewrite`）用自有字段名与中值语义，与桌面主链路不是同一契约（桌面主链路早已 Node 化）。
# [未发布] fix(rewrite): 采集页消费后置敏感词 warnings + _sensitiveCheck 拆模块腾 max-lines 余量（fix-rewrite-warnings-consume）

- **动因**：收尾 PR #4103（敏感词前置拦截放宽为不拦截）留下的两项遗留，均由外部对抗审查（subagent CTO 角色 + 19 次变异）点出。① 「保留后置检测提醒人工审核」这半条防线在**采集页实际不成立**——`rewriteViaEngine` 成功分支只挑 `result_content/knowledgeRefs/meta`，引擎 warnings 被静默丢弃，而 4 个改写入口（视频转写 / stealth 自动 / 聚合回退 / 手动改写）零提示；② `rewrite-engine-core.js` 离 max-lines 上限只剩约 29 行，而敏感词语义是会被反复改动的活跃面，注释一厚就踩 `LEDGER_GREW`（PR #4103 期间真的超限 4 行）。
- **采集页消费 warnings**：`rewriteViaEngine` 成功分支把 `warnings` 归一化后收进 `rewriteSensitiveWarnings` 状态与 `meta.warnings`（旧版引擎信封无该字段 ⇒ 归一化为空数组，不臆造警告也不炸）；`clearRewriteResult` 一并复位，避免「清空后残留上一轮的警告」；**漏斗内唯一发声点** `notifyWarning`（四个入口各写一遍必然漂移，漏一个即该入口静默丢弃）；结果卡新增 `data-testid="collection-rewrite-sensitive"` 提示条 + CSS `col-warn-banner`，用 **warning 语义而非红色错误条**——改写成功了，只是提醒人工审核，两者语义不能混；locale zh/en 成对新增 `rewritePage.rewriteSensitiveWarning`。
- **拆模块**：新建 `packages/rewrite-engine/src/sensitive-check.js`（59 行，含完整语义说明：为何关前置、KB「双零命中」连带约束、如何恢复拦截），`_sensitiveCheck` 改为委托。core **749 → 741 行**，余量从约 29 行提升到约 37 行；语义逐字节等价（`blocked` 恒 false、hits 照算、fail-open 留痕不变）。
- **回归保护（新增 13 例 + 更新 2 处形状断言）**：`Collection.rewrite-sensitive-warning.test.js`（6 例：warnings 透传 / 无警告不制造噪音 / 字段缺失不抛错 / 提示条渲染 / **warning 级而非 error 级** / 清空复位）+ `sensitive-check.test.js`（7 例：未注入过滤器 / 命中不拦截但上报 hits / 后置同语义 / 缺 hits 字段归一化 / 抛错留痕带 stage 与 error / logger 缺失不抛错 / 非 Error 对象归一化 `unknown`）+ `Collection.rewrite-input-limit.test.js` 补 1 例 warnings 透传。**形状断言抓到了本次改动**：该文件原有的两处 `toEqual` 锁 meta 四字段，加 `warnings` 后当场红——这正是「评审 i6：断言完整形状」规则应有的行为，红的是我的改动而非测试失效。
- **变异反证**：把 `sensitive-check.js` 的 `blocked` 改回 `stage === 'pre' && hits.length > 0`（恢复前置拦截）⇒ 端到端 X1 与模块级「命中不拦截」**双层同时红**；恢复后全量复跑确认。
- **验证**：`packages/rewrite-engine` 18 文件 **290 例全绿**；`apps/desktop` Collection 系列 + 渲染层 12 文件 **298 例全绿**；electron 相关 3 文件 **100 例全绿**；QM-1 `electron-builder` rc=0 + 启动三层判据 **PASS**（窗口期内存活 + stderr 为空，env 显式剔除 `ELECTRON_RUN_AS_NODE`），asar 内确认含 `sensitive-check.js`；6 道静态门禁全 PASS。
- **踩坑（本轮新遇到，已写进执行记录）**：① 用 `git checkout -- <file>` 恢复**未入库的新文件**必然失败，而我用 `grep 'blocked: false,'` 自证时命中的是同文件另一处正常返回，误判「已恢复」——是 `grep blocked:` 列出全部 4 处命中才看出变异还在。**自证必须列全部命中点，不能只 grep 一个字符串就下结论。** ② 新 worktree 跑 `ipc-contract.test.js` 会因缺 `index.bundle.js` ENOENT，先 `pnpm run build:preload` 即通过——环境缺失，不是回归。
- **遗留（不假装已闭合）**：① `RewriteView.vue:890` 与 `AiWriterPanel.vue` 仍把 warnings 写进**红色错误区**（`rewriteError` / `panelError`），与「改写成功了」视觉语义矛盾——本轮只修用户点名的采集页，正解是 warnings 与 `rewriteError` 分离，需单独一轮；② QM-4 视觉回归未跑（新增提示条是新元素非改版，现有单测断言 DOM 存在性与文案，不锁像素）；③ `rewrite-engine-core.js` 仍是贴着上限走（741/778），彻底解法是继续拆 `_postProcess` 等独立语义，而非继续压缩注释。

# [未发布] fix(gates): 审查模式判定不再消费判定器自己写下的产物（ccg-decider-exclude-self-artifacts）

- **一句话**：`scripts/ccg-review-decider.js` 决定"这次改动要几路外部审查"，它把结论写进 `.ccg/reviews/<sha>.json`，而**那份产物本身会被 git 收进同一个提交**；产物是 `.json`、`.json` 在 `codeExtensions` 里 ⇒ 它正文里逐字复述的方案/执行记录/上一次理由，会被下一次判定当成"源码变更行"。于是判定器开始消费自己的判决。
- **动因是当场量的，不是推测**：对在飞 PR `#4079` 的同一份差量分别按两档取证面各判一次 —— 事后补跑档 `changedLines=191 / fileCount=9 / 敏感内容命中 3 / mode=dual`，提交时档 `132 / 8 / 0 / single`。把那 3 处命中**逐条归属到文件**（并用"我的归属计数 == 判据自报的 `sensitiveContentHits`"这条交叉核对自证探针通路有效，两数不等即不得下结论）：3/3 全在 `.ccg/reviews/*.json`，命中的词是该 PR 自己 proposal 里的「授权」二字 —— 即"我为什么被允许改判据"这句话被读成了"这次改动涉及加密"。面上读数：origin/main 最近 **120 笔**合并提交两档各判一次，**44 笔（37%）mode 因此改变**（`dual→single` 15、`dual→skip` 15、`single→skip` 14），其中"≤200 行却因敏感命中被顶成 dual"那一类 20 笔的命中行扩展名分布是 `{".json": 47}`，**一条不落在真实源码里**。
- **为什么这是真代价而不是"更严格"**：`scripts/check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 要求变更集内**每条 `mode=dual` 产物**的深度审查状态闭合。多出来的 dual 不挡任何缺陷，只**凭空造出一笔必须真跑一次外部模型才能平的债** —— 而外部后端本日仍不可得（proposer 轴 IP 级封禁）。本会话已实地撞上两次：一笔 20 行的测试改动被判 dual、以及补跑档与提交档互不认账。
- **修法（排除动作只住一处）**：新增按路径的谓词 `isSelfArtifact()`（`.ccg/` 之下即为判定器自己的输出；判路径不判扩展名），`judge()` 的源码规模过滤、`collectFromDiff()` 的变更行分流、`isDocsOnly()` 的资格判定三处共调它；产物行另归第三类 `ccgChangedLines`（与既有 `codeChangedLines`/`docChangedLines` 并列），产出 **report-only** 计数 `ccgSensitiveContentHits` 并在 CLI 点名。`collectStaged()` 两个 stats 参数里的 `:(exclude).ccg` **摘掉** —— 留着它，`.ccg` 在 git 层就消失、JS 层收不到，新计数在暂存档恒为 0，"唯一观测点"只剩补跑档有。`stagedDiffHash` 那次**独立** git 调用照旧带 pathspec（它管记录命名，不是取证面；已读源码确认两处不同调用）。
- **阈值一字未动**：`dualLineThreshold: 200` 与五条敏感词表全部原样。规模读数从 191 变 132 是**取证面收敛**的结果，不是把尺子放宽 —— 现场两档读数已写进本条与执行记录，免得下一个人读成"这次改动真的更小"。
- **设计层 QM-6 critic 交付 4 条（2 Critical / 2 Warning），两条 Critical 都改了方案本身**：Critical#1「只断两档相等是恒真的 —— 谓词退化成恒真时两档一起落到同一个错值」⇒ 补**绝对参考锁**（含真敏感行的 `.js` 在两档各判一次都必须 `dual`）；Critical#2「暂存档留着 pathspec ⇒ 新计数恒 0，两档观测不对称」⇒ **否证了我 design 初稿写的"两处幂等重叠"**，决策点从方案 B 换成方案 C（排除只住在 JS 一处）；Warning#3「计数无消费者 ⇒ 死字段」⇒ 半接受：补 CLI 打印行为锁（断言打印的数与 `judge()` 读数同源），**拒绝**升成阻断判据并给实测证据（既有同构字段 `docSensitiveContentHits` 全仓除打印外零出现，本仓 i3 的既有设计就是面向人的观测点）；Warning#4 与 #1 同因 ⇒ 变异清单加指名要求。
- **TDD 与反证**：先写行为锁并**当场见证红**（那一跑落在"尚未拆出分辨率用例"的版本上：`# tests 57 / # fail 4`，红因逐条核过是"产物仍被计入取证面"，例如 `实际 reason=变更 6 行但命中 auth/数据库/加密：敏感内容 2 处`）⇒ 实现落地并拆出分辨率用例后 `# tests 58 / # pass 58 / # fail 0`（既有 52 ⇒ 现值 58）。变异 **M1–M6 逐条指名变红且红集互不相同（6 把尺子测 6 个格）**，跑完判据文件按字节还原（`FINAL md5=f075dcafab restored=true`）；控制跑自带健康断言（`fail=0 && loadFail=false` 才产出 verdict）。两条如实记录的过程修正：① M5/M6 首跑红集**逐字相同** —— 根因是 `not ok` 的粒度是用例名，两种退化撞在同一条用例的不同断言上 ⇒ 把"采集面是否收到产物行"拆成独立用例后才分辨得开（**塞进同一条用例等于没有这把锁**）；② 新用例首跑报 `Cannot read properties of null` —— 区间档在第二次提交前 `HEAD~1` 不存在，那是**探针拿错坐标**不是判据红，夹具顺序按 T3 改正。
- **边界与遗留（不假装已闭合）**：① 决策层 `plannedPathHits` 从方案正文抽"路径样 token"再跑敏感**路径**规则，实测 1499 份产物里 **1 条**命中（且命中的是散文里的一个正则字面量 `sso/i.test`），发生率与代价都不支持为它动判定面 ⇒ 留数不修；② `.ccg/` 下还有 plan 档产物与人工放入的资产，本刀只保证"判定器不消费 `.ccg/`"，**不承诺**该目录里没有需要被守的东西 —— 正因如此才保留 report-only 计数而非整目录抹出扫描域；③ 若将来评审产物写到 `.ccg/` 之外，该目录会重新进入取证面且**没有任何东西会因此变红**，谓词是单一出处、改一处即可，但不为"未来的目录布局"预建判据。仓内 `ccg-review-decider.js` 实测只有 1 份物理副本（`find` 排除 `node_modules` 单命中），`.quality-rhythm/installer/` 不含门禁脚本本体 ⇒ 本刀无"两张表必须同改"的联动面；规格 delta 刻意落新 capability `ccg-review-mode-decider` 而非 `openspec-integration`，以免顺带背上 vendored 镜像同步与 Purpose 计数改写的债。
# [未发布] fix(qm6): 评审时换后端必须回写判定记录——修 #3927 自带的假红（qm6-review-request-writeback）

- **假红的形状**：#3927 把「请求值随判定记录落盘」写进了 proposal 与 AGENTS，实现里却只有 **pre-commit 的 decider** 那一跳在写，写的是**提交那天清单里的值**。评审时 `deep-review.sh --critic codex` 把请求交给了驱动，但没有任何一跳把它落进记录。于是 `check-pr-exec-record.js::judgeBackendMismatch` 两侧读的是两个时刻——`reviewBackends`(提交时) × `deepReview.performedBy`(评审时)——**每一次合法覆盖都被判"该条深度审查未闭合"**。这是工具自己造的假红，不是审查发现，所以修法不是放宽判据。
- **第一性原因不是"忘了写字段"，是"跨时刻一致性没有测试面"**：`ccg-review-backends.test.js` 只锁"解析出什么"，不锁"解析结果去过哪里"；`deep-review-deps.test.js` 里那批入口锁全是**结构锁**（源码里有没有那段 exec 文本），结构锁对"调用了但没写产物"完全免疫；而 `check-pr-exec-record.test.js` 的 backendMismatch 用例**手搓记录**（夹具直接给出 `reviewBackends:{critic:"codex"}`），等于替上游把这一跳做完了——同型于本仓「契约夹具不得替对方剥壳」。四层同时漏过的组合是：假红要等到下一次真覆盖才显形。
- **回写落在入口、不落在 decider**：decider 只在 pre-commit 跑，压根不知道评审时请求了谁。新纯函数 `applyReviewRequestToRecord(recordPath, resolved, fsImpl)` 由 `deep-review.sh` 在覆盖分支、**exec 之前**调用；记录路径**复用入口已解析到的那一个**（HEAD sha → HEAD^ sha → stagedDiffHash 三档回退的结果），不另写第二份查找——两份查找必然在内容寻址那一档漂移，而漂移的表现是"写了一份没人读的文件"。
- **三条不变式，各有一条反向锁**：① **不销毁审计链**——提交时那份整份挪进 `commitRequest` 并带 `rewrittenAt`，只覆盖顶层会让一次换后端抹掉"提交时请求的是谁"；② **只在覆盖时写**——默认路径 MUST NOT 碰任何判定产物，否则每个 PR 的产物都被无关写者改一遍 mtime 与键顺序，而"谁改过判定产物"正是这条链要审计的东西；该不变式由 CLI 机械执行（`--record-request` 在请求值与清单一致时直接 rc=2）；③ **读不到不新建**——新建判定产物等于伪造判定，四类坏输入（缺失 / 坏 JSON / 顶层数组 / 顶层标量）一律 `ok:false` 且原字节不动。重跑幂等：同值不叠层，`commitRequest` 与 `rewrittenAt` 原样保留。
- **顺序被编进产物而不是源码位置**：deps 新增 4 条**真跑 bash + 桩驱动**的行为锁。桩驱动落在 `<fixture>/scripts/ccg-deep-review.js`——那是入口定位驱动的第一候选路径，所以本锁**不需要本机有真引擎、CI 上同样执行**（不是 `test.skip`）；桩驱动启动时**自己再读一次记录**并把读数写进产物，于是"回写排到 exec 之后"这一形态会让 `sawCritic=codex` 当场红——只按源码位置断言顺序证不出来，因为摘掉调用后两个串仍然都在。
- **dry-run 与失败路径各一档**：dry-run 不回写（预览不改产物）但**必须出声**说没回写，否则读者会拿这份记录去对账；回写这一跳失败（lib 坏 / 记录中途被删）一律 `exit 2` 且**驱动一次都不能起来**——带着不一致的记录跑出来的结论不可用。刻意**不加** `[ -f "$REC" ]` 前置：能走到那一行意味着 MODE 已从某个 REC 读出，加了它就是给不可达分支写文案，而不可达分支上的"跳过回写"会被下一个人读成"存在合法的无记录覆盖路径"。
- **验证**：`ccg-review-backends.test.js` 17 → 26 → **28**（28/28 pass；第二轮评审处置又加了两条回归锁）、`deep-review-deps.test.js` 35 → 40 → **41**（41/41 pass，`# tests 41 # fail 0`；+1 条即 i2 一致性锁）；消费同一对入口/lib 的四文件全部复跑——`ccg-review-decider` 52、`ccg-bash-entry` 9、`plan-review-deps` 10、`check-pr-exec-record` 81 → **113**，各 0 fail（这四个数在最终基线 `f8730eeb8` 上重取过：52 / 9 / 10 / 113 + 28 + 41 = **253 passed / 0 fail**）（改的是判据的**输入**，只复跑判据自己等于没验证）。变异反证 M1-M7 逐条实测 **CAUGHT** 且红集互不相同：M1 摘掉回写调用（3 红）/ M2 回写挪进 dry-run（2 红）/ M3 失败改为 `|| true`（指名 1 红）/ M4 返回 ok 却不写盘（4 红）/ M5 去掉"未覆盖不写"守卫（指名 1 红）/ M6 覆盖时销毁提交时请求（2 红）/ M7 读不到时退化成新建（2 红）。驱动对每条同时断言 `tests>0 ∧ fail>0 ∧ 期望名字在失败清单里`——只看"有没有红"会把"整片没跑"读成"已反证"。
- **既有锁随文案同步 2 处**：`--record-request` 加入模式清单后，"只能指定一个**打印**模式"这句期望必须改成"只能指定一个模式"，否则 lib 会对一个**合法**的调用形状说谎。同步由补丁脚本断言替换处数恰为 2，不是顺手全局替换。
- **`plan-review.sh` 刻意不回写**：决策层链路上没有 `reviewBackends × performedBy` 的消费者，也不解析"某 commit 的判定记录"这一形状；真实缺口只有一处时不在第二处铺同类机制。**驱动验证层仍不应用覆盖**这件事在仓外（`~/.claude/skills/adversarial-review-loop`），本刀只让**记录说真话**——它不改变"谁在评审"，只改变"记录是否声称了错误的评审者"。
- **QM-6 第三轮的两条 upheld 已当场修**：① 连换两次**不同**后端时 `commitRequest` 被换成「上一次的回写值」，审计锚从「提交时请求的是谁」漂成「上一次评审请求的是谁」（既有锁只盖了同值重跑那一格）——修成 `before.commitRequest || before` 且 `rewrittenAt` 锚在第一次改写，spec 同步补一条 Scenario；② `applyReviewRequestToRecord` 只校验 `critic` 不校验 `proposer`，缺半边时 `undefined` 被 `JSON.stringify` 静默丢键 ⇒ 记录看着像写过了、对账却只读到半个真源。
- **本轮两条 dismissed 都给了可核对出处，并如实登记一条没抓到的反证**：「从非根 cwd 起脚本必败」不成立（入口 `:55` 已按脚本自身位置 `cd ROOT`）；「欠账按 inner sha 归属会记到父提交名下」不成立（判据按变更集路径扫 `.ccg/reviews/*.json`，从不读 `rec.sha`）。新补的 i2 一致性锁在「入口分支门禁改恒真」这版变异下指名变红，在「改 shell 侧覆盖判据」那版下**没有**变红 —— 它的强度只覆盖前者，写成两条都 CAUGHT 就是假证据。
- **落地形态**：未新增 `*.test.js`（两段锁追加进已接线文件）⇒ 不动 `quality-gate.yml`、不动"谁来守门"；`scripts/` 工具脚本自身 ⇒ 混合 PR，不走 docs-only 通道。隔离入口 `start-mp-task.ps1` 被 `mp-worktree-health.ps1 -RequireClean` 拒绝（他人在飞改动），故在共享根就地编辑、用 plumbing 从 `origin/main` 构建单笔提交，`CHANGELOG.md` / `AGENTS.md` 两个热点写面**取 origin/main 的 blob 再插行**（本地工作副本滞后 4 笔，就地编辑会反向撤销上游那几行）。**本行的到达方式**：功能 PR #3988 是混合 PR，每 rebase 一次要重跑约 50 分钟全量 CI，而主干 CHANGELOG 顶插约每 20 分钟多一笔，两者相乘使合并窗口追不上（现场三次 CONFLICTING、一次 `gh pr merge` 被 GitHub 以 merge conflicts 拒），故该行经用户裁决从 #3988 的净差量拆出、由这一笔 docs-only PR 落——Gate 2c3 的 `check-changelog-growth.js` 是「只可增长」棘轮、不要求每个 PR 自带条目，实测拆出后 `base 576 条 → head 576 条` 仍 PASS。全过程记 `openspec/records/qm6-review-request-writeback.md`，规格增量记 `openspec/changes/qm6-review-backend-config/`（第 10 节 + 新 Requirement，`openspec validate --strict` rc=0）。

# [未发布] fix(ci): 时钟位移引信巡检补上「先重建构建产物」，并把「跑桌面测试的 job 必须先备好产物」做成按 job 的跨 workflow 装配锁（electron-ci-preload-build）

- 现场与归属：上游 `826fa7e13`（PR #3782，change `bundle-untrack`）把 5 个受管构建产物移出版本控制后，
  只给 `quality-gate.yml` 的三个消费 job 补了「先重建再测」。`electron-ci.yml` 那半边已由 PR #3837
  （`1bed4ad2c`）补齐；**第三个消费面是 `clock-shift-oracle.yml`** —— 它经 CLI
  （`node scripts/check-clock-shift-oracle.js`）跑全域候选（含 `apps/desktop`）。它在 PR 上看不出来的原因
  与 `electron-ci` 那半边不同：该 workflow 只有 `schedule` + `workflow_dispatch`，PR 事件上根本不排队。
- 为什么它躲过了既有的同族锁：`workflow-contract.test.js:1256` 那条锁的**扫描域**其实覆盖全部 workflow
  （#3837 已把它从「写死 `quality-gate.yml` 一个文件」扩开），漏的是**消费者谓词**
  （`desktopStepsRunSuite`，同文件 `:1233-1238`）—— 它只认 `--filter @multi-publish/desktop
  test|test:all|test:coverage` 的单行与参数数组两种命令行形态，而 oracle job 是经 **CLI** 消费桌面用例的
  ⇒ 该 job 对它结构性不可见。判据本身没有缺陷，是它的消费者定义域不含这条通道。
- 定性（**不依赖「oracle 现在已红」**，那一点已被实测否证）：`826fa7e13` 之后 oracle 只有一次历史 run
  （`38638645067`，2026-10-14 schedule success，早于改动落地）；单文件 A/B（同一判据文件、产物在场/缺席
  两档各 300 例）实测**两档都是 300/300 通过** ⇒ 该文件在缺产物档下的红与产物无关（属负载/时序类），
  把它当「产物缺失的红」就是拿没验过的因果当论据。正当性来自两条结构性理由：① 接线一致性
  （`826fa7e13` 的「先重建再测」论证漏了第三个消费面）；② **权威性保全** ——
  `scripts/check-clock-shift-oracle.js:354-357` 在基线段出现任何红时打印 `ORACLE_NOT_AUTHORITATIVE`
  并 `return 0`，于是缺产物导致基线红时呈现是**绿灯**，而「该域内无引信」这句结论已经失效。
  准确的表述是「**绿得看不出问题**」（丢的是权威性），不是「红得看不见」。
- 修法：① `clock-shift-oracle.yml` 在整套候选跑之前插入 `Build preload bundles`（`build:preload` +
  `build:paginator`）；② 判据升级为**按 job 扫全部 workflow** 的装配锁
  `.github/scripts/check-desktop-test-prereqs.js` + 登记表 `desktop-test-prereq-jobs.json`
  （「谁在域内」的唯一真源，未登记 / 陈旧登记双向报红），消费者形态 5 种
  （`desktop-filter` / `pnpm-verb` / `root-nx` / `nx-direct` / `oracle-cli`）外加脚本闭包解析，
  并额外要求满足器**排在消费者之前**；③ 锁接进 `quality-gate.yml` 的 **Gate 2b**（`shell: bash`，
  任一条命令非零即中止，不是那条会被「最后一条绿」掩盖的 pwsh 步骤）。
- 与 #3837 的关系（**不是严格超集**，各有比对方严的维度；两条都保留、未删改其任何一条）：本片在
  **消费者形态面**是扩展（前者对经 CLI 消费桌面用例的 job 结构性不可见）；在**重建步形状**上更宽松
  （接受满足器分处两步，前者要求同一步同时含两个脚本）；在**事件门槛**上只输出 `[NOTE]`（明示「PR 全绿
  不构成这条在 CI 上跑过的证据」），而前者对 `electron-ci` 的两条 `if` 作字面量相等断言；在**域管理与
  自故障**上是新增面（登记表 + 三档退出码 0 合规 / 1 有问题 / 2 扫描器自身故障）。
- 本机读数（逐条可复跑）：锁用例 **9/9**；锁 CLI rc=0（`workflows=14 jobs=29 entries=47 in-domain=4`、
  `problems: fatal=0 debt=0`，四条域内 job 由判据自己点名并给出消费者步号与形态）；
  `check-unwired-tests` rc=0（检查域内 101 个测试文件）；`check-workflow-structure` rc=0 且其用例 6/6；
  `check-step-failfast` rc=0（38 个受管 run 块）；`workflow-contract` **43/43**；oracle `--dry-run` rc=0
  （`domain=1001 candidates=183`，属当次活计数）；`verify-worktree-deps` / `check-no-brand-residue` /
  `openspec-sync-check` 各 rc=0；`git diff --check` rc=0。
- 变异反证 7 道（各改判据的**一个**判定面，红集互不相同、逐条命中期望用例）：V1 摘掉 `desktop-filter`
  的散文守卫 → T5/T6；V2 满足器闭包传递失效 → T3/T6/T9；V3 顺序判据反向 → T1/T3/T4/T5/T6/T9；
  V4 `oracle-cli` 的 `--dry-run` 域外判定掐死 → T1/T2/T3/T4/T5/T6/T9；V5 形态上界
  `MAX_FORM_COUNTS` 失效 → T6；V6 登记表条目级形状早退失效 → T7；V7 PR 侧被 `if` 跳过的步骤不留
  NOTE → T1/T9。7 次还原后 md5 逐次回到基线。
- 遗留（不假装已闭合）：oracle 的退出码语义（「权威性不足」与「确实没有引信」共用 `rc=0`）**不在本 PR** ——
  把「非 0 即拦」做成常量红本身就是反模式（缺产物档确有一份负载/时序类红会让它常态变红），
  需另开 change 定义独立出口；首次受影响的 schedule 是 **2026-10-21**（周三 18:00 UTC），合并后按
  「(merge SHA, workflow)」回读，无 run 时如实记 `NO_RUN(by design)` 而不是把它读成「证据丢了」。
# [未发布] fix(rewrite-engine): 敏感词前置拦截放宽为不拦截 —— 8000 字长文不再被「爆炸」一词整篇拒绝（rewrite-sensitive-precheck-relax）

- **问题**：用户在改写引擎粘贴约 8000 字长文（越南排华史料），点改写得到「内容包含敏感词，无法改写」，整篇被拒。实测命中的是内置词库里的「爆炸」一词（出自「石油加工厂发生爆炸和火灾」），8000+ 字仅此一词被拦。
- **第一性原因**：`rewrite-engine-core.js` 的 `_sensitiveCheck()` 对 `stage==='pre'` 且 `hits>0` 返回 `blocked:true`，`rewrite()` 据此返回 `SENSITIVE_CONTENT` 整篇拒绝。而这个判据的前提从未被检验：词库是**内置示例级 24 词**（硬编码于 `packages/rewrite-engine/src/sensitive-filter.js:63`），**既不吃运营中心 `content_policy.word_list` 远程词库**（那条只喂 IPC 手动检测链，`ops-center-sync.js:656` 与引擎注入链是两条独立路径），**也无 UI 开关或白名单注入**（`addWhitelistWord()` 存在但服务层一次都没调）。一个不可配置、不可申诉的前置闸门，挡的是用户自己的输入。
- **取舍（经用户确认，方案 B+）**：关**前置**拦截（原文命中不再整篇拒绝）；留**后置**检测（改写结果命中仍进 `warnings` 提醒人工审核）；留**知识库「双零命中」条件**（`preCheck.hits` 与 `postCheckHits` 均零才 `recordFeedback`，命中敏感词的内容不进 KB，避免固化成学习样本）；留 **fail-open 留痕**。
- **实现**：`_sensitiveCheck` 恒返回 `blocked:false`（hits 照算，供 KB 条件与后置警告使用）。`rewrite()` 内的 blocked 分支成为**死路径**，加注释说明为何保留——将来恢复拦截只需改 `_sensitiveCheck` 一处，调用点（`rewrite()` / `segment-rewriter.js`）无需改。
- **回归保护（7 例，此前 79 例中零例覆盖敏感词语义）**：`X1` 前置命中不再拦截（端到端 success）/ `X2` 后置仍进 warnings+sensitiveHits / `X3` 检测异常仍 fail-open / `X4` 未注入过滤器行为不变 / `X5` KB 双零命中条件未被破坏（前置或后置任一命中即不写 KB）。逃逸根因：被测的是「过滤器能否识别词」，无人测「**拦截阈值是否合理**」。
  **X6/X7 是外部对抗审查后补的关键一例**：原 5 例全用手写 `detect` 桩，「内置 24 词 → detect → 引擎放行」这条用户报障的真实链路**零覆盖**——若有人改坏 `sensitive-filter.js` 的词库（如手滑删掉「暴力」分类），X1-X5 会全绿而用户故障复发。X6 用真 `new SensitiveFilter()` + 含「爆炸」的长文 + 前提自证断言钉住它；已做双向变异验证：删词库里的「爆炸」⇒ X6 红；把 `blocked` 改回 `true` ⇒ X1 与 X6 同时红。
- **验证**：`packages/rewrite-engine` 16 文件 **268 例全绿**；`apps/desktop` 相关 7 文件（sensitive IPC / ops-center-sync / rewrite-engine-error / AiWriterPanel / RewriteView×3）**239 例全绿**；QM-1 `electron-builder --win --dir` 成功 + 启动三层判据 **PASS**（窗口期内存活 + stderr 为空，env 显式剔除 `ELECTRON_RUN_AS_NODE`）；端到端用用户真实文案 `success:true`（旧行为 `SENSITIVE_CONTENT`），分段路径（51039 码点 / 963 处前置命中）同样放行。
- **踩坑（max-lines 门禁）**：第一版注释写太厚，`rewrite-engine-core.js` 到 782 行，超登记值 578 + 容差 200 = **778 上限 4 行** ⇒ CI `债务熔断检查` 判 `LEDGER_GREW` 红。压缩注释至 773 行转绿，**没有上调 baseline 消红**（`segment-rewriter.js` 头部注释早已警告过这个门禁）。
- **遗留（不假装已闭合）**：前置关闭后用户可把任意内容（含运营方本想拦的高危词）送进 LLM，这是用户明确选择的取舍；词库本身仍是内置示例级且无运营入口，将来若要「严格模式」，正解是把 `content_policy.word_list` 接进引擎注入链并加用户级开关（本次不做）。`REWRITE_CONTENT_SENSITIVE` 文案码在引擎侧已无触发路径，作为兼容层保留未清理。

# [未发布] perf+feat(desktop): 视频任务编辑页 UX 补齐 —— 令牌容量/滑动过期 + 滚动节流 + 失败摘要卡 + 分段搜索筛选 (#待填)

- **动因**：上游 PR #4064（`f6a61d24c`）修掉了用户直接看到的现象，但复查**代码**发现两类遗留：① 媒体令牌登记容量只有 **128** 且 FIFO 淘汰，而 169 段 × 最多 5 个媒体位 = **最多 845** 个 URL ⇒ 展开到约 26 段就开始淘汰，被淘汰 == 该段图 404 == 渲染端 `@error` 兜底显示「未生成」，**用户最初抱怨的破图会回归**；② 令牌 TTL **固定 15 分钟**，在编辑页停留超过 15 分钟即全部失效 ⇒ 图片整片变「未生成」。另外滚动高亮**无节流**（169 段全展开时每个 scroll 事件 169 次 `getBoundingClientRect`，强制重排）。
- **令牌容量 / 滑动过期**：`DEFAULT_MAX_ENTRIES` 128 → **1024**（覆盖到 200 段，并留写后刷新时新旧令牌并存余量）、`MAX_REGISTRY_ENTRIES` 256 → **2048**（不抬上限会被 `min()` 静默钳回 256）；命中即续期（`expiresAt = now + ttl`），使活跃使用期间一直有效，**但停止使用超过 TTL 仍失效**（滑动过期 ≠ 永不过期）。三方回归锁：845 个 URL 全部可访问、每 800ms 访问累计 4000ms 仍 200、续期后静置 >TTL 必须 404。
- **滚动节流（前沿）**：`onSegmentScroll` 改为**本帧第一次立即算**、同帧后续只清帧标记 ⇒ 每帧最多 1 次重排，且高亮**不滞后**。选择前沿而非 trailing 的原因有实测：trailing 会让程序化重算（删除/移动后）被同帧吞掉，高亮滞留在**被删掉的那一段**上。程序化重算走 `recalcSegmentHighlight()`（清帧标记后立即算），不受节流影响。
- **失败摘要卡**（新组件 `ResultPreviewPlaceholder.vue`）：占位区块从「一句通用说明」升级为能回答「为什么没成片」——失败/完成段数、聚合后的主要原因（同因合并且按次数降序）、内容政策定位提示、**定位到首个失败段**。原因码 → 文案走 `FAILURE_REASON_LABEL_KEYS` 单一真源，**未知码回落「其他原因」，不编造**。上游 PR 里 `completionSummary` 被关在 `v-if="videoPath"` 分支，失败任务连「完成了几段」都看不到，本轮一并解决。
- **分段搜索与筛选**：三档筛选（全部 / 只看失败 / 只看政策标记，计数为 0 的模式自动禁用）+ 跨全量分段的关键词搜索（文案/提示词/视频提示词/字幕）。**硬约束：筛选后 `absoluteIndex` 仍是全量下标**——上移/删除/导出命名/政策徽标全按全量下标寻址，若退化成筛选序号，在「只看失败段」模式下点删除会删到别的段（回归锁断言 `[1,3]` 而不是 `[0,1]`）。
- **长列表操作**：计数文案「已显示 20 / 共 169 段」（原来只有「显示更多分段」，169 段要点 8 次且不知道还剩多少）、**展开全部**（先确认，取消则不做任何事）、**回到顶部**（`scrollY > 600` 才出现）、**roving tabindex**（整组只占 1 个 Tab 位，方向键/Home/End 移动，`Tab` 不拦截）、**跳转中态**（大跳要渲染上百张卡，`pending` 数字给「点了在做事」的即时反馈）。
- **结构性处理**：`ResultView.vue` 是 max-lines 的 **targets 点名还账对象**（零增长容差），第一版直接写进宿主当场红（`TARGET_GREW … 现 2060 行已超过点名目标 1890 行` + `TEST_LEDGER_GREW … 膨胀 453 行`）。按仓库既有做法拆出 `ResultPreviewPlaceholder.vue` / `ResultSegmentJumpBar.vue` / `composables/useSegmentNavigation.js` 与独立测试文件，宿主 **2060 → 1886 行**（净降 174），**没有上调 targets 消红**。
- **验证**：新增 26 条回归（composable 20 + 独立 UX 文件 16 含改写 2 条），先红后绿；消费方并集 12 文件 **317 passed / 0 failed**；门禁逐条 rc=0（max-lines / unwired / cjk / pair / brand / debt / doc-abs-paths）；eslint 13 文件 **0 error**（唯一 warning 是基线已有的 `IMAGE_MIME_TO_EXT` 未用）。
- **QM-1 打包（改 `electron/` 必做）**：`pnpm run build:vue` + `electron-builder --win --x64` ⇒ rc=0，asar 内含 `electron/services/story2video-media-server.js`，产物内 `defaultMaxEntries=1024`/`maxRegistry=2048`；启动窗口期 8s 存活、**stderr 0 字节** ⇒ PASS。**踩坑**：第一次只跑 `electron-builder` 没先 `build:vue`，产物没有前端 ⇒ 启动 `ERR_FILE_NOT_FOUND`，进程却仍存活、rc 仍 0 —— 只判「打包成功」或「进程还在」都会**假绿**，正是三层判据第 ② 层存在的理由。
- **遗留（不假装闭合）**：未做虚拟滚动（1000 段级需变高 windowing + 锚点补偿，会同时影响成功任务滚动体验）；未做渲染端 `revoke`（容量 1024 覆盖到 200 段，>200 段仍会淘汰，彻底修法需改 preload 契约）；IPC 次数本身未降（服务端批量签 URL 独立议题）；原因码只聚合后端已给的 `failureCode`；`expandAll` 仍用原生 `window.confirm`；搜索无防抖（本地过滤 <1ms）。
# [未发布] feat(rewrite): 采集页四个改写入口接入取消通道（rewrite-cancel-collection）

## 问题

#4078 建好了 `ai:rewrite-cancel` 通道，但**只接到了改写页**（`RewriteView.vue`）。
采集页（`Collection.vue`）是长文最常出现的入口 —— 知乎回答 / 公众号长文 / 视频转写，也是最初报错（#3979）的页面 ——
却仍然无法取消：「一键改写」点下去，粘错链接或选错正文也只能等全程，后续片段继续计费。

**机制存在 ≠ 能力可用**：#4078 的验收标准写的是「改写中显示取消按钮」，测试文件只挂载 `RewriteView`，
于是其余 3 个 `aiRewrite` 消费点无人检查。

## 改动

- `Collection.vue`：在唯一漏斗 `rewriteViaEngine` 内 `beginRun()` 生成 runId 并注入 `params.runId`，
  `finally { endRun() }` 释放；收到 `data.cancelled === true` ⇒ `notifyInfo('rewritePage.rewriteCancelled')`
  并返回 `{ __cancelled: true }`。
- 四个调用点（视频转写 / stealth 自动 / 普通采集 / 手动改写）把 `else` 收紧为
  `else if (!(result && result.__cancelled))` —— **取消不再被当成「AI 改写失败」弹错**。
- 模板新增「取消改写」按钮：`rewriting || oneClickRewriting` 时可见，复用 `col-btn col-btn--secondary`；
  采集阶段（`collecting`）禁用并注明「采集不可取消」。
- i18n **复用** `rewritePage.cancelRewriteBtn / cancellingBtn / rewriteCancelled / cancellingHint`，
  不新增键（`locales/collection/zh.js` 已 498 行，紧贴 500 行硬限；两页措辞也保持一致）。

## 验证

- **147 passed**（新增 `Collection.cancel.test.js` 5 例 + 既有采集页/改写页套件无回归）
- eslint rc=0；unwired OK / locale keys PASS(2180) / locale CJK PASS / max-lines ✅ / brand PASS
- `build:vue` rc=0；`electron-builder --dir` rc=0
- **产物级断言**：66 个 dist chunk 中命中 `collection-rewrite-cancel-btn`、`aiRewriteCancel` 桥、
  `cancellingHint` 文案各为 true（源码含 ≠ 产物含）

## 遗留

- `AiWriterPanel.vue` 仍未接取消（同法可接，本轮聚焦采集页）
- `HotTopics` / `useHotTopicsGenVideo` 不做：`mode:'create'` 输入是短主题种子，不会触发分段
- 采集阶段不可取消（采集链路无取消通道）

# [未发布] fix(s2v): 历史记录失败卡片直出英文技术原文 —— compose 预检失败稳定错误码契约 + 全量排查（error-message-user-friendly-audit）

- **问题**：「视频创作 → 历史记录 → 执行失败」标签的任务卡片，失败原因显示 `Input media exceeds the total size limit`（API 返回的原始英文技术信息），违反项目「所有提示/报错用用户友好自然语言说明并给出建议、且支持多语言」的铁律。
- **四层逃逸链（缺任何一层都不会漏）**：① 主进程 `story2video-compose-engine.js` 预检分支只返回英文 `message`，无稳定 `errorCode`；② `stage-executor.js` COMPOSE 失败分支只透传 `error` 字符串，结构化字段丢在 stage 边界；③ `pipeline-engine.js` `_finalizeRun` 与 `run-state-store.js` 快照只存 `error`；④ `pipeline-error-formatter.js` 的「长度 < 120 且无技术标记 ⇒ 透传原文」分支把 41 字符的英文技术句判成自然语言，直接显示给用户。
- **归因不止「漏改一处」**：2026-08-11 `prompt-user-friendly-i18n` 覆盖的是 IPC 拒绝路径（`license-access-control.js` / `model-provider-manager.js`），compose 引擎经 `service-bus → stage-executor → pipeline-engine` 落库、不在射程内；2026-08-19 `s2v-history-error-message-hardening` 只修 `{sceneText}` 占位符，规则表按「已知错误文本」逐条加，没回填「新增英文 message 必须同步归一化」的契约；CJK 门禁只扫 `apps/desktop/src` 与 `packages/python-backend/src`，**不扫 `apps/desktop/electron`** —— 主进程新增英文 message 完全在门禁视野外。**系统性漏洞是三套渲染路径都靠匹配英文原文还原语义**。
- **修复（四层全堵）**：主进程新增 `COMPOSE_ERROR_CODES`（8 个封闭码）+ `composeFailure()` 组装器 + `bytesToSize()` 自适应单位；`stage-executor` → `buildStageFailureError()` → `_finalizeRun` 分别落 `run.error`（**字符串契约不变**，恢复门控 `RESUME_BLOCKING_ERROR_PATTERN` 与阶段摘要零影响）/ `run.errorCode` / `run.errorParams`；`getRunSnapshot` 与 run-state 快照增补同名字段（IPC 边界输出 `null` 而非 `undefined`）。
- **渲染端三通道双轨归一化**：`notification-error-patterns.js` 新增 3 个 compose 预检模式（判定顺序早于 `COMPOSE_STAGE_PATTERN` 与「短自然语言直出」分支）；`story2video-notifications.js` 新增 3 个 key + 参数归一化分支（兜底词走 locale，不硬编码）；`pipeline-error-formatter.js` 新增 `compose_input_size_exceeded` 规则；`CreateViewHistory.formatError` 重构为「原文归一化 → 稳定码显式映射 → 原文透传 → 通用兜底」，参数展开合并。**存量历史数据（只有英文 `run.error`）同样归一化**，不要求用户重跑。
- **locale zh/en 成对新增 8 条**：`compose_input_size_exceeded` / `compose_scene_media_unreadable` / `compose_scene_audio_unreadable` / `compose_audio_duration_exceeded` / `compose_ffmpeg_not_found` / `compose_invalid_asset_manifest` + 兜底标签 `labels.currentScene` / `labels.unknownSize`；每条含具体原因 + 可操作建议。
- **机械门禁防再犯（本 change 的核心增量）**：新增 `scripts/check-compose-error-codes.js`，校验「主进程常量 / 渲染端 `COMPOSE_ERROR_KEY_MAP` 显式映射 / zh+en 文案 / `messageParams` 占位符」四侧一致；接入 `quality-gate.yml` 的 `changes` job（**Gate 12g**，不被 docs-only 短路、位于非 PR 早退之前），并登记到 `check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB`。`.gitignore` 同步反选 `!scripts/check-compose-error-codes.js`（第 106 行 `scripts/*.js` 会静默忽略门禁本体，同 #3011 家族）。
- **回归保护**：新增测试 26 例（compose-engine 5 / pipeline-engine 3 / notifications 5 / formatter 4 / CreateViewHistory 2 / 门禁自测 7）。门禁 6 道变异反证（删映射 / 删 zh / 删 en / 改占位符 / 删主进程常量 / 清空映射表）全部 CAUGHT。
- **过程教训（已落测试）**：第一轮用 PowerShell `-replace` 做变异，`{scene}` 被 .NET 正则当成量化表达式写成 `\{scene\}`，**变异已应用但门禁 PASS**（假阴性）；改用 Node 脚本并在 `mutate()` 内断言「变异确实改变文件内容」后立刻 CAUGHT。另两条：门禁自测的沙箱副本必须放 `<sandbox>/scripts/`（脚本按 `__dirname/..` 定位仓库根）；组件测试的 i18n mock 语义差异用独立的 `templateAwareT` 承接，不改全局约定。
- **文档**：`01-docs/PRD-USER-FACING-ERROR-MESSAGES-2026-10-20.md`（数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字全表）、`01-docs/BUGFIX-HISTORY-CARD-RAW-ENGLISH-ERROR-2026-10-20.md`（QM-5 五步：根因溯源 / 逃逸链 / 系统性漏洞 / 回归保护 / 预防措施）、`PRD-S2V-PIPELINE-PAGE-UX.md` §3.2.1、`01-docs/PRD.md` 稳定错误码合同条目、openspec change 五件套。
- **已知限制（不假装已闭合）**：compose **执行阶段**（ffmpeg 子进程）20+ 处英文 message 未全面 errorCode 化（已由既有 `compose_failed` 文案覆盖为可操作建议，列为后续 change）；`looksTechnical` 不加英文技术词表（误报风险高）。
# [未发布] fix(desktop): 知识库等 9 处错误提示不再直出后端原文 —— 新增调用点口径 `userFacingErrorMessage` 与全域禁形态棘轮（ux-audit-knowledge-error-classify）

- **修的是「看不懂的文案 + 内部信息外泄」同一处**：`ElMessage.error((res && res.message) || t('…'))` 把 IPC/后端的英文原文（`Error: write ECONNREFUSED 127.0.0.1:8000`、`Command failed: …`、内部路径）当用户提示直出。收敛 9 处（知识库面板 4 + 发布频率设置 4 + 表现洞察 1），改后判据是枚举 `matched ∈ {errorCode, code, pattern}` 才采纳分类文案，`fallback`/`passthrough` 退回调用方的页面专属兜底。
- **为什么不能直接写 `formatUserError(x).message`**：它在认不出时给通用「操作失败，请稍后重试」，把「草稿加载失败」这种页面专属信息换成信息量更低的通用串；而 `matched='passthrough'` 那档**原样透出**技术串，等于没修。这条边界由两条锁钉住，并配「先断言分类器确实产出 passthrough」的前提自证。
- **判据用「非空」是陷阱**：`fallback`/`passthrough` 两档的 `message` 同样非空，非空判据会把技术串放行 —— 采纳条件必须写枚举。
- **锁的三处反失明设计**：全域棘轮除「存量为 0」外，还断言扫描域文件数 > 100 且域内出现 `ElMessage.error(` 的文件数 > 10（否则「零命中」可能只是扫描器没读到任何文件）；M4 变异（掏空扫描域）实测只让那条反失明断言红。
- **四道变异逐条指名红、红集互不相同**：M1 把调用点退回禁形态（点名锁 + 棘轮双红）；M2 把分类门改成「message 非空」（passthrough 锁 + 空输入锁双红）；M3 在**未点名**的 `Dashboard.vue` 回潮禁形态（只有棘轮红，同时断言点名清单里的锁不得因此红 —— 证明两条锁保护面不同而非同一条）；M4 掏空扫描域。每道跑完文件 md5 回原值。
- **行尾不是噪声，本轮当场抓到一次自造全文改写**：插入 import 的锚点若写成 `/^import … from 'vue'\r?$/m`，`\r?` 会把行尾的 `\r` 吞进锚点、后续切片从 `\n` 起 ⇒ 拼出 `\r\r\n` + 裸 `\n` 两处畸形；`* text=auto` 对**混合行尾**的文件不做转换，于是整份文件以 CRLF 入 blob，`git diff --numstat` 报 496/495 而 `--ignore-cr-at-eol` 报 6/5。正解是把那一行自己的终止符原样带过去再补一行（`^(import …)(\r?\n)` → `$1$2 + 新行 + $2`），改后两口径逐字相等。
- 验证：消费者并集 16 个测试文件 301 passed / 1 skipped；`check-locale-sync --cjk`（基线 1330 / 现场 1125，无新增硬编码）、`check-max-lines`、`check-no-brand-residue`、`check-doc-abs-paths` 全部 RC=0。分支 `ux-audit-knowledge-error-classify`。

# [未发布] test(gates): 账本判据 CLI 加 `--root` 取证根注入 —— "阻断会落到退出码"从读代码相信变成真跑一次（debt-cli-root-injection）

- **动因是我自己写下的一条假边界**：#4001 记录里我写「`main()` 无 `--root` 注入点 ⇒ 造不出"夹具里确有阻断"的行为态，补成行为锁须人工过目」。前半句真（取证根写死在仓库根），**后半句被本仓自己的代码否证**——既有 `端到端：真历史上一笔回填 PR 必须让 CLI 判红并点名那篇记录` 一直经 `--base-ref`/`--head-ref` spawn 真进程并断言 `rc===1`。所以本刀不是补缺口，是把"少一个旗标"造成的不可测消掉，并顺手删掉那条不存在的技术边界。授权：2026-10-20 用户明示「第 2、3 条授权你改判据」。
- **一条真实存在的假绿通道被顺手堵掉**：`loadCarrierFreeze` 原先读 `__dirname` 那份**真仓**冻结基线，与 root 无关。只按直觉加 `--root`（只切账本）就会造出"夹具载体 + 真仓基线"的混合态——那比没有旗标更坏，因为结论看起来有夹具支撑。现在账本、冻结基线、两处 git 取证目录一起切。
- **默认路径零影响是对照出来的，不是看代码看出来的**：同一份真仓状态下，用 `origin/main` 那份判据与改后判据各跑一次不给 `--root` 的 CLI —— `rc=0/0`、首行逐字相同（`MERGE-LEDGER prs=2150 … 派生收口=572 byDesign=0`）。
- **四条变异逐条指名红、红集互不相同**：M-A 映射包进块注释 ⇒ 新行为锁 + 既有接线锁 + 端到端 3 红；M-B 冻结退回 `__dirname` ⇒ 恰 1 红；M-C 默认根改成 `process.cwd()` ⇒ 恰 1 红；M-D 白名单去掉 `root` ⇒ 四条 CLI 用例全失能。跑完判据文件 md5 回原值。
- **M-C 第一次报的是 NOT_CAUGHT，抓到一条恒真断言**：我最初的默认根断言写作 `parseRoot([]) === path.resolve(__dirname, '..')`，而 `node --test` 进程的 cwd **恰好就是仓库根** ⇒ "默认改成取 cwd"这种退化在它面前完全不可见。修法不是放宽变异，是把断言变可失败：① 在**外来 cwd** 下调 `parseRoot`；② 从外来 cwd **真跑一次 CLI** 断言读数仍来自仓库。**恒真断言的又一形态：期望值由被测实现自己的输入算出来。**
- `rc=1` 有两种成因（**判据阻断** 与 **未捕获异常**），退出码相同 ⇒ 每条 CLI 断言都必须同时看 stdout 的点名行与 stderr 的"无异常"，否则测试会因为崩了而通过。这条纪律是本轮现场逼出来的，不是设计时想到的。
- **`openspec validate` 的可信度又降了一格**：对它做四格负控——「Requirement 无 Scenario」红、「缺 delta 段头」红，但「**Scenario 缺 `THEN`**」与「**Requirement 空标题**」两格它照样判 valid ⇒ "validate 通过"能证明的下限比上一刀记的更窄。规格保真因此继续靠"归档块逐行全等 + 名称级 A/B"。
- 套件 **116 → 122 全绿**，新增 5 条用例按**名字**出现在通过清单里（"pass 数"不算覆盖证据）。
# [未发布] fix(自动化页): 后台失败/恢复通知的注册提前到首屏请求之前 —— 窗口期内那条通知不再永久丢失（ux-audit-automation-notify-first）

- `AutomationView.vue` 的 `onMounted` 原为 `await load()` 之后才 `onAutomationNotification(...)`。通知是推送语义（不排队、不补发），于是「进入页面 → 首屏列表请求在飞 → 后台任务此刻失败/恢复」这段窗口没有监听者，那一条**永久丢失**，用户看到的是「任务失败了但页面什么都没显示」，日志里也没有第二处痕迹。审计 2.4。
- 修法只有一处顺序调整：先注册、再 `await load()`；分档（error / 其余走 recovered）、空载荷直接 return、`onUnmounted` 收口与「每次挂载只注册一次」全部保持既有语义。
- 新增 `AutomationView.notify-registration.test.js` 4 条：顺序锁 + 窗口期内失败/恢复各一条行为锁 + 空载荷负控。反证按被禁形态原样重造 ⇒ 4 条指名变红，还原后逐字节相同。
- 方法学收获（写进 PRD 验收锚点）：顺序断言第一版把期望写成了**被禁形态** `['list','register']`，它在修复前后都红 —— 是"红之后去读实际读数"才发现错的是期望而不是代码。这类断言首次变红时必须先判"代码错还是期望错"，否则顺手把期望改对就会把缺陷钉成契约。
- 文档：`01-docs/PRD.md` 新增《自动化页后台通知的注册时机合同》（顺序 / 为什么不补发 / 分档 / 空载荷 / 显示项与提示文字 / 验收锚点）；执行记录 `openspec/records/ux-audit-automation-notify-first.md`。既有 `AutomationView.test.js` 同跑通过。

# [未发布] fix(s2v): 克隆音色成功后「语音 / 音色 ID」自动切换 —— 修回滚空操作、失败文案死分支与刷新抹选（s2v-voice-clone-auto-select）

- **需求与现状判定**：用户诉求「在音色复制/克隆区新添加本地音色样本后，有了新的自定义音色，默认语音 / 音色 ID 的下拉列表中所选 ID 自动切换为新添加的自定义音色」。主路径在基线里**早已实现**（`tts-voices-clone.js` 的 `addS2VVoiceClone`：入库 → 写 `voiceId` → `selectS2VVoice` → toast），happy-path 测试也是绿的；但有三个缺陷让它在普通使用中失效或给出错误反馈。本次是**修缺陷 + 补合同 + 补测试**，不是新写功能。
- **R1 回滚空操作（Critical）**：`addS2VVoiceClone` 在调 `selectS2VVoice` **之前**写 `voiceId = voice.id`，而 `selectS2VVoice` 的回滚锚点取「进入函数时的 `s2vConfig.voiceId`」⇒ 锚点已是新值 ⇒ 失败时写回同一个 id，**字面意义上的空操作**。后果：偏好持久化失败（`VOICE_PREFERENCE_STORE_UNAVAILABLE` 等）时，下拉停留在一个**从未保存成功**的音色上；下次启动流水线主进程按偏好回退默认音色 ⇒ 界面与运行行为不一致。修法：`selectS2VVoice(voiceId, rollbackVoiceId?)` 新增可选第二参（显式回滚锚点，不传时行为与旧版逐字节一致），`addS2VVoiceClone` 在写 `voiceId` **之前**捕获旧值传入；同时让该路径在 `selectS2VVoice` 返回 `false` 时**不弹成功 toast**——克隆事实成立，但不得谎报「已添加并已设为默认」。
- **R2 失败文案死分支（Major）**：`friendlyVoiceCatalogError(m) || formatUserError(...).message ? friendlyVoiceCatalogError(m) : d.t('...Failed')` —— `||` 优先级高于 `?:`，条件恒为真 ⇒ `selectionSaveFailed` / `defaultVoiceRestoreFailed` 两个兜底键**从不显示**，用户一律看到「语音列表加载失败」而非真实原因。改为 `friendlyVoiceCatalogError(m) || d.t('<兜底键>')`，并移除不再使用的 `formatUserError` import。
- **R3 刷新失败抹掉选中项（Major）**：选中项归一的 `else` 分支无条件清空 `voiceId`，未区分「目录返回了但音色不在其中」与「目录这次根本没返回」。后果：用户刚克隆的音色（独立于 catalog 存在）被一次失败的「刷新音色列表」抹掉且无任何提示，违反 PRD「当前已保存的 voiceId 即使不在最新目录，也必须作为保留选项，不能静默丢失」。新增 `else if (configuredVoiceId && !catalogData)` 空分支（刻意只写注释不写代码）。
- **回归保护（6 例，`useTtsVoices.test.js` 新 describe「克隆成功后自动切换『语音 / 音色 ID』选中项」）**：克隆成功切换 + MiMo `mimo-clone-` 分支（此前**零覆盖**）+ 偏好失败回滚 + 并发上下文变更丢弃过期结果 + 删除回退 + 目录失败不清空。变异反证：M1 删锚点入参 / M2 锚点改回 / M3 删不清空分支 / M5 让 toast 无条件弹 ⇒ 各 1 failed；**M4（恢复死三元）0 failed 存活**——兜底文案可达性无机械锁，已改用 PRD「禁止写法」做流程面约束并如实标注。
- **文档**：`01-docs/PRD.md` 音色域合同 4 处补充（数据校验 3 行含「禁止写法」与后果 / 流程第 3、4 步补回滚锚点合同与自动切换 6 步合同 / 交互逻辑 2 行 / 不变式 T9-T11）；新增详细 PRD `01-docs/PRD-S2V-VOICE-CLONE-AUTO-SELECT-2026-10-20.md`；`01-docs/learnings.md` 顶部 3 条教训（回滚锚点被污染 / 三元混搭死代码 / 刷新失败≠音色不存在）；执行记录 `openspec/records/s2v-voice-clone-auto-select.md`。
- **回归基线**：`useTtsVoices.test.js` 22/22、`src/views/video-creation` 145/145、`CreateView.test.js` + 删除守卫 + 选项自动保存 310/310、运行时/批量/UE 契约 21/21、主进程音色域 4 套件 115/115；Gate 7 `--cjk` PASS（1331→1146）/ `--keys` PASS（2152 key）；QM-1 Vite build + electron-builder 双 exit 0，启动 9s 存活且 stderr 0 行。模板/DOM/样式/locale 文件零改动（`S2vConfigPanels.vue` 未进 diff）。
- **如实记不修**：QM-6 双模型外部评审未完成（本机 claude/opencode/codex CLI 均超时不可用，CI 侧该判据 advisory 不阻断）；`s2vPersistedVoiceId` 写了没人读（四处写、零运行时消费方），属独立清理未在本次动。
# [未发布] fix(门禁): 跨家族第 2 轮复审的四条真缺陷与三处口径收敛（qm6-highrisk-r2-reinforce）

- **这片只干一件事：把"规则对、装配错"的四格补上**。PR #3987（高危面收口矩阵 + 转变检测）在热主干窗口里被 auto-merge 合走时，跨家族轴（codex）第 2 轮复审抓出的 4 条真缺陷还在工作树里未提交 —— 已合并的 `3e69148d7` 不含它们，因此修复走 follow-up 分支，不追改已合并内容。四条的共同根因不是"判据写错"，是**判据的规则、判据的装配、判据给出的补救文案三者由不同会话写下、彼此没有一条对账**。
- **`C`（复制）不是删除**：`expandRenames` 原先把 `R` 与 `C` 一起合成「旧路径 = D」，于是复制一份未闭环评审记录会被读成"删了一条未闭环记录"并误红别人。回归锁 `X2-6` 的动因值得单记：既有用例名写着 `R100/C75`，夹具**只构造过 `R100`** —— `C` 那一格在测试里根本不可表示，所以它不是"测得松"，是"测不到"。
- **改名这条出口本来是自己打自己**：红文案教人"把闭环状态与新路径一起带过去"，而 D 方向只看 base 侧的未闭环状态、从不回看新路径在 head 是否已合规 ⇒ 照文案做完仍判欠账。现由 `renamedCarriesClosure` 回看新路径（`X2-7`）。这是本仓「门禁给的出口被门禁自己判红」的第四种落点。
- **高危清单补 `scripts/lib/ccg-review-`（现 10 条）**：那条是 QM-6 评审后端对的**真源**（决定"谁来评"），原先落在清单外 ⇒ 改它不触发任何收口要求。`评审#4` 的成员钉用例与 `2.1` 的逐条归因用例同时红，新增条目必须同时改这两处基线。
- **判定行接上转变读数（`OK` 与"探针失明"不再同形）**：`transition` 挂在 `deepDebt` 上、`report()` 拿的却是 `evaluate()` 的结果对象，且判定行只在 `r.ok` 分支走 `verdictLine` —— 于是「未证实=7」与「一条都没核到」在末行逐字相同，而 `verdictLine` 的纯函数单测全绿。现统一由 `verdictLine` 产出行，`未证实 + 无出处 > 0` 时输出 `OK（但转变核对有 N 条没核到…）`；用例 `X2-11` + 接线锁 `X2-12`（"函数对、装配错"这一类只能按本仓既有惯例用接线锁钉）。
- **一处"正解"被实测否证**：跨家族轴建议把前缀匹配从子串改成 `startsWith` 根锚定。现量结果是 `scripts/check-` 的**非根位**命中有 42 个真判据本体（`.github/scripts/` 40 + `apps/desktop/scripts/` 2），钉到仓库根等于给 CI 侧那批门禁脚本整体免检；而段起点唯一的实测误伤是 `.quality-rhythm/.github/workflows/mechanism-check.yml`（上游技能制品的嵌套 workflow，GitHub 只调度仓库顶层那一份、它永不排队执行）。正解因此是**保留段起点匹配 + 按 `VENDORED_SUBTREES` 排除子树**，清单只能缩小；变异 P25（改根锚定）与 P34（退回任意子串）双向指名红，`X2-8` 同时钉住"42 个真命中不得被削掉"与"1 个误伤必须排除"。
- **`unrecognized` 的红文案现在把闭集念出来**：现量发现主干最近 40 笔里已有 **3 条自造 `tier` 值**（`docs-false-positive` / `superseded` / `dual`，`closureNote` 全空）—— 发明词汇的人不是坏，是看不见清单。同时新增 `X2-14`：每条 `why` 里写的「实测命中 N 个」必须等于 `highRiskPrefixOf` 的归因数，`scripts/check-` 那个数因此从过期的 100 改成 106 —— 把"注释里的数字"从一次性测量变成当场红。
- **路径形态的证据必须真有其物（X2-5，Critical）**：`evidence` 原先只判形状，`reports/根本不存在.md` 与真文件逐字同权，而高危面只认 `external` ⇒ 编一个像样的路径就能收口。现由 `existsAtHead`（`git cat-file -e <head>:<path>`）做**注入式**存在性探针：验不到即降 `external-unverified`，不注入时保持原形状语义（单测与仓外调用方不受影响）。范围如实划出：只验"该 revision 里有这个对象"，不验内容；oid/uuid/PR/会话四档指向仓外对象，无法在本仓上下文验，不得假装这条覆盖了它们。
- **`merge-base` 只算一次，注释里那句"真同源"从此成真**：原实现是 `changedFileStatuses` 内部算一次、取 base 侧 blob 时再算一次，两次之间 base ref 若前进（本仓 main 高频），`wasClosed` 就被读成别人的闭环 ⇒ 凭空收口静默放行。现在算出的那个 SHA 同时喂给变更集与 blob 读取，`X2-4` 接线锁断言 「merge-base」 实参只准出现一次。**两条我自己写的锁一开始是永不命中的**：正则里的 `$` 未转义（`${blobBaseRef}` 在模式中是行尾锚点）与少写两个反引号，都是靠"写盘前先跑一次 `re.test(code)`"才暴露 —— 一条永不命中的禁词断言被登记成"已反证"是本仓点名的同型错误。
- **覆盖率与债务扫描同一个域**：`TIER-CHECK` 用的 `dualClosedDeepReviews` 原先只过原始 statuses，改名展开出来的 `A` 不进读数 ⇒ 同一个 PR 两行读数各说各话（`X2-10`）。另把误伤测量换成一把覆盖全五条分支的探针：上一轮那句「矩阵新红=0」里有一部分是**探针失明**（旧探针只打印 4 个桶、合计 13 ≠ 19，对 `unrecognized`/`external-unverified` 完全不可见），按五条分支重算得 **6 条会红**（`c2=3`、`c3=3`），结论修正已写进记录 §七。
- **两条评审修法被拒绝，理由带实测**：① 「高危面上的 `single` 也要求闭环」= 复现缺陷G 那条无法闭合的循环（`single` 不要求闭环是既有契约，`2.3 边界` 钉住）；② 「8.1b 落地前高危分支保持 report-only」= 把刚建的门禁整条关掉。CI 侧本判据仍是 `--mode=advisory` 这一事实登记为 tasks 8.6：「QG Changes 绿」不等于「QM-6 已闭合」，读数必须看它自己打印的 `MODE=`。
- **读数**：`scripts/check-pr-exec-record.test.js` 118 → 125 用例（新增 7 条全部指名红），消费者并集 `scripts/ccg-review-decider.test.js` 52/52；变异反证 **41 条全 CAUGHT（escaped=0 anchorfail=0）**，每条还原后 md5 与快照一致。静态门禁本机点名跑：`check-unwired-tests` 111 个测试文件 OK、`.github/scripts/check-max-lines.js` ✅（超限 95 / 挂账 95）、`check-debt-budget` 四项指标全等基线、`check-doc-abs-paths` PASS、`check-gate-record-debt` OK 且 `MERGE-LEDGER prs=2140 归属可解析记录=580 派生收口=562 byDesign=1`。两口径 numstat 逐文件相等。
- 现场记 `openspec/records/qm6-highrisk-r2-reinforce.md`；合同对账见 `openspec/changes/ccg-review-degradation-ladder/tasks.md` 第 8 节（8.1 判据侧补齐说明 + 新增 8.5/8.6 两条人工裁决项）。

# [未发布] fix(gates): 锁预算复测脚本的采样域漏掉整个 QG Coverage 作业族 —— 最需要大预算的那个作业从不在样本里（lock-timing-audit-coverage-domain）

- **动因**：`scripts/lock-timing-audit.js` 用 `JOB_RE = /QG Desktop Shards/` 枚举「哪些作业跑了这把锁」，而实测**跑它的作业有两族**。当场重取（origin/main 最近 4 次 main push × 3 个作业 = 12 份作业日志，逐作业统计 `[windows-file-lock] ready=` 行）：`QG Coverage count=44 max=17466ms` | `QG Desktop Shards (2/2) count=16 max=14402ms` | `QG Desktop Shards (1/2) count=28 max=3773ms` ⇒ **尾部最大的那个作业根本不在采样域内**，而 `LOCK_BUDGET_PROVENANCE.maxObservedReadyMs=12762` 与「45000 预算余量 3.53×」这句结论都是在这个被切掉一半的集合上量出来的。这不是「采不到」（那有 rc=3 出口兜着），是「采到了、数也自洽、但域是残缺的」⇒ 判据必须带**扩面方向**的 A/B 负控，光加零样本出口挡不住这一类。
- **第二个坑：日志行数 ≠ 样本数**。夹具只在**真跑**时记进程内台账（`options.spawnImpl` 一律不记），但 `[windows-file-lock] ready=…` 那行是**无条件** `console.log` 的 ⇒ 单元用例注入的假握手（`ready=0ms`）同样落在 CI 日志里；旧探针把整批行当样本，「样本量下限 ≥50」这条可以被假数据凑满。
- **修法三条，一条都不落进第二份事实**：① 握手行自带 `mock=true|false` 标签，且**打印与解析同一处实现**（`test-helpers/windows-file-lock.js` 的 `formatTimingLine` / `parseTimingLine`），复测脚本必须调它 —— 变异 N4（脚本自己抄一份正则）与 N3（打印摘掉标签）各自指名变红；② `JOB_RE` 扩为 `/QG Desktop Shards|QG Coverage/`，并刻意**不退化成「扫所有作业」**（那会让样本来源无法归因），A/B 两臂钉住：不跑该夹具的 `QG Static / QG Unit Tests / QG Changes / GUI Gate Result / build` 必须**不命中**；③ 三档分列 `samples / mock / legacy`，其中 **legacy 只报 max、不报 samples**（假握手 ready 恒 0，只会压低不会抬高 ⇒ 无标签行的最大值仍是可信**下界**），并把无标签累加排在 `n === 0` 早退**之前**（标签上线前那一整趟复测里每个作业都早退，放后面等于那份现场永远取不到；变异 N8 实测红）。
- **零样本出口现在分两档，且两者正解相反**：`LEGACY_ONLY`（日志早于标签上线 ⇒ 等窗口攒够，**不是**坐标坏了）vs `NO_SAMPLES`（探针坐标可能过期 ⇒ 去查那七个坑）。两档共用 `process.exitCode = 3`。现场实证两条各跑一次：不可达 repo `MP_AUDIT_REPO=… --runs=2` ⇒ `RC=3` 并打印 `NO_SAMPLES…`；真仓库 `--runs=4` ⇒ 同一出口打印 `LEGACY_ONLY：取到 88 条**无标签**握手行 … 逐作业（按 max 降序）：QG Coverage count=44 max=17466ms | …`。那句判词只允许存在一份实现（`LEGACY_ONLY` 在脚本里出现 2 次即红，变异 N7 实测）。
- **⛔ 现存的这组数是下界，不是分布**：`LOCK_BUDGET_PROVENANCE` 保留的是**旧探针**读数（域只含 Shards、且未辨真伪）⇒ `maxObservedReadyMs` 是**下界**、`samples` 是**上界**，这个方向已写进该常量的 `source` 字段与 `docs/windows-lock-budget-provenance.md` §2 的偏差表。带标签的日志攒够窗口后必须重测再回填；按既有不对称纪律，**重测量出更低值不构成收紧预算的理由**。
- **TDD 与反证**：先写红（`2 failed | 22 passed`，红因分别是 `legacyMax` 为 undefined、`formatLegacyNotice` 不是函数）再实现 ⇒ `24 passed`；变异 N1–N8 逐条**指名**变红且跑后按字节还原（`restored=true` ×8），控制跑自带健康断言（`rc=0 && passed=24`，不健康则 PROBE_BLIND 且不产出任何 verdict）。消费者并集全部实跑：`windows-file-lock` + `account-state-restorer` + `credential-store` = **51 passed**；`packages/api-publish-engine/test/api-key-manager-atomic-write.test.js` = **1 passed**（它 require 同一份夹具）。清点用未截断的 `git grep`（上一轮把清点接了 `head` 恰好削掉一个真消费者，那笔教训见上一条 PR 的记录）。
- **还有一层没扩，写清楚免得被读成「域已完整」**：脚本的 workflow 坐标只有 `quality-gate.yml`，而 `.github/workflows/electron-ci.yml` 的 `electron-tests` 作业（步骤「Unit tests (Vitest, non-Electron, single-worker deterministic)」，`if: github.event_name != 'pull_request'` ⇒ 仅 main push 跑，#4061 后按 `--shard` 切三片）**跑同一批桌面 vitest**，那里也产握手行。扩它要给采集端加第二个 workflow 轴并配同形的 A/B 负控，属另一片的工作量 ⇒ 登记为遗留（执行记录 §4 第 3 条），并把边界同时写进 `JOB_RE` 上方注释与 `docs/windows-lock-budget-provenance.md` §4 第 6 条。**结论的适用范围因此是：现存 max 至今仍是下界，不是全量分布。**
- **边界**：预算取值本身一字未动（45000 / 12000 / 20000），改的是「量它的尺」；无 UI / locale / 主进程运行面改动，QM-1 与 QM-4 判 N/A。文档同步落在 `docs/windows-lock-budget-provenance.md`（§2 偏差表、§3 rc=3 两档与 rc=5、§4 新增第 6/7 两个坑），并按当场读数更正了该文件 §5 里「`CHANGELOG.md` 含 NUL 字节、被 git 判为 binary」这句已过期前提（上游 control-bytes-sweep 后实测 NUL=0，本轮置顶插入即为现场反证）。
# [未发布] feat(rewrite): 分段截断汇总可见化 + ai:rewrite 取消通道（rewrite-cancel-and-truncation-summary）

## 问题

`rewrite-segment-and-finish-reason` 交付后留下两条真实欠账：

1. **分段截断静默**：`segment-rewriter.js` 合并时**硬写 `modelTruncated: false`**，理由是「单段无法归属整篇」。
   但「至少一段被截」本可如实表达 —— 结果是 5 段里第 3 段被模型截断时，正文中间缺一块而界面**无任何提示**
   （正是上一刀想消灭的静默截断，换到分段路径重现）。
2. **`ai:rewrite` 无取消通道**：`ai.js` 13 个 `ai:*` 通道一条取消都没有，而
   `pipeline/render/video-clone/queue/podcast/zhihu-favlist` 全有。分段把改写从秒级变成分钟级后，
   「粘错文章也只能等全程、后续片段继续计费」成为可感知伤害。

## 改动

- **引擎**：分段循环收集 `truncatedSegments`（1-based 段号），`modelTruncated = truncatedSegments.length > 0`；
  该字段**条件展开**进结果 ⇒ 单次路径形状零变化。段边界检查 `signal.cancelled`，命中即返回
  `{success:false, errorCode:'CANCELLED', cancelled:true, cancelledAtSegment, completedSegments}`，无半成品、不写 KB。
- **IPC**：`activeRewrites` 登记表（`finally` 必删，无泄漏）；`ai:rewrite` 带 `runId` 才注入 signal
  （无 runId ⇒ 与改动前逐字节等价）；新增 `ai:rewrite-cancel`（owner 校验 + `not_running`/`not_owner` 分支，
  同 runId 并发 ⇒ `DUPLICATE_RUN`）。
- **preload**：`aiRewriteCancel`，键数锁 140→141 / 338→339 同步更新。
- **渲染层**：新增 `composables/useRewriteCancel`（runId 生命周期 / beginRun / cancel / endRun）与
  `utils/rewrite-truncation`（三个纯派生 + 单测）；改写中显示「取消改写」按钮，`CANCELLED` 走 info 不弹错误；
  模型截断横幅新增**点名段号**文案（避免「整篇残缺」误读）。`RewriteView.vue` 从 1465 行拆回 1339 行。

## 明确不做

- **in-flight 中止**：信号需穿过 4 层到 `fetch`，而 `model-provider-manager.js:294/303` 只为熔断使用
  `runtimeOptions`、未下传 adapter —— 改它等于给全部 LLM 调用加通路，波及面远超本需求。取消在**段边界**生效。
- **取消退款/断点续跑**：已消耗片段不保留、费用不退，重试从头开始（与「任一段失败即整篇丢弃」同语义）。

## 验证

- 引擎 **263 passed**（+8：T1-T4 截断汇总、C1-C4 取消）。
- 渲染层/IPC **152 + 515 passed**（取消通道 7 例、纯派生 10 例、IPC 8 例、preload 375 例全绿）。
- `build:vue` rc=0；`electron-builder --dir` rc=0；asar 核验通道与方法在包内。
- 静态门禁：unwired OK / locale keys PASS(2181) / locale CJK PASS / max-lines ✅ / brand PASS / doc-abs PASS。

# [未发布] docs(openspec): 归档 shape-lock 规格 delta —— 那条 Requirement 不再自己打自己（archive-shape-lock-scenario）

- **动因**：#4001 带进来的 `align-shape-lock-empty-ledger-scenario` 已合并但没归档，它的 MODIFIED delta 因此还没落进主规格——主干上那条 Requirement 至今**正文写「键数本身不设数字下限」、末个 Scenario 写「键数为 0 ⇒ MUST 红（规模下界）」**，两句互斥；而 `openspec validate quality-gate-execution-record --type spec --strict` 实测照判 `is valid`（它查结构必需段与场景覆盖，**不查条目内自洽**），所以这类矛盾能随归档一路进主干。
- **归档保真（逐行量出来，不是声明）**：`git mv` 被识别为 **4 个 `R100`**（零内容漂移）；主规格目标块与归档块 **44 行逐行全等**、块内 Scenario 两侧都是 **6**、Requirement 计数 **4 → 4**、矛盾句 `规模下界` 在主规格里残留 **0** 处。delta 的形状按三个度量分开报，免得一个数被读成三种意思：被改写的行 **2**（就是那对 `WHEN/THEN`，不是丢内容）、净新增行 **8**、位置比对不同 **8**（含纯下移）；块内非空行数 **22 → 28**。5 条原 Scenario 标题**逐字保留**。
- **`openspec validate --all --strict` 做名称级 A/B**：共享根（=`origin/main`，未归档）`passed=200 failed=28` vs 本刀 `passed=199 failed=28`，**新失败集为空、原失败集一条没少**；唯一的 passed 项差异恰是归档后不再作为活动 change 被计数的那一条。**只比计数会骗人**——"28 == 28"对失败的是哪些条目完全失明，与本仓记过的装饰性对账同型。
- **镜像不联动是读源码读出来的**：`scripts/quality-rhythm-spec-mirror.test.js:13` 的 `LIVE_SPEC` 写死 `openspec/specs/openspec-integration/spec.md`，本刀 delta 落在 `quality-gate-execution-record` ⇒ **不同步** vendored 镜像（上一刀要同步是因为它的 delta 落进被镜像的那个 capability）。判据一律取锁源码，不取历史先例。仍跑一次留"没被碰坏"的证据：`# pass 8 / # fail 0`。
- **行尾**：主规格工作副本实测 `cr=166 lf=166`、terminator tally 全 CRLF；但**没有**因此做"探测多数派后统一回写"——而是把文件解析成 `(文本, 结束符)` 对，写前先做 **scanner roundtrip 自证**（重新序列化必须逐字节等于原文，否则后面所有断言都无意义），只给被替换块的新行取**该块自己的**结束符（块内 tally 亦 37/37 CRLF），块外前缀 129 行与后缀逐元素比对 `text`/`term` 双相等。顺带钉一条口径：**`CR 数 == LF 数` 不足以证明行尾单一**（一个裸 CR 配一个裸 LF 就能配平），它只配当告警，不配当判据。
- **隔离入口这次通了**：`scripts/start-mp-task.ps1 -TaskName archive-shape-lock-scenario` 正常建出 `mp-worktrees/mp-archive-shape-lock-scenario`（裸分支、起点 == `origin/main`、`verify-worktree-deps.js` OK）。前几刀挡路的两个条件（标准根之外注册着 2 个 worktree、共享根有他人未跟踪文件）已由持有方清掉——**这是当场重测的结果，不是我的成果**，所以那条「%TEMP% detached 工作树」的降级出口本刀没有用。
# [未发布] fix(gates): 收敛出口探针改为现读 vendor 是否能表达外部复核，旧结论不再写死（ccg-probe-external-review）

- **动因不是"想加读数"，而是一条常驻判据开始说谎**：本机给 vendor 驱动加了 `externalReviewSatisfied` + `expectedExternalBackend`（高危域项填齐三格即可解除无条件阻断，不再是永久不可达）。而 `scripts/ccg-convergence-probe.js` 每次 PR 都在 Gate 2b6 打印「self-play 对 crypto 项无条件计阻断 ⇒ 深度审查闭环不可达」——补丁一生效，这句结论就与现场不符。会说谎的常驻判据比没有判据更糟，因为它会让人以为"这事已经量过了"。
- **判定收敛成一个纯谓词 `externalReviewCapable(driverSrc)`，且要求两条同时成立**：解除谓词是被**定义**的函数（不是注释/散文里出现该字样，那种写法在 design 文档里天天有）+ 驱动把期望后端写进裁决模板。缺任一格 ⇒ 沿用旧结论。它同时进 `--json`（机器档字段）与人读档的结论正文。
- **一条不越界的约束**：「在位」不得进 `problems`，也就是不得改退出码。三档语义（0 合规 / 1 读数偏离 / 2 探针失明）必须稳定 —— runner 上根本没有 vendor 引擎，把「结论变了」混进 1 档，等于把「探针没看见」读成「判据变了」，那是本仓反复点名的同型错误。
- **只测纯谓词、不做端到端，理由是覆盖得住**：CI 的 `changes` 作业无 vendor 文件，端到端断言在那里永远不执行（写了也是装饰）。谓词纯测之后，两条锁每次 PR 都真跑。TDD 现场：先只加测试 ⇒ `10 tests / 8 pass / 2 fail`（P9、P10 各自指名红，其余 8 条不受影响，红可归因），实现后 10/10。
- **变异反证两条各用判别输入、红集互不相同**：E-M1 把在位判定退回恒 `false` ⇒ 只红 P9（旧结论会被永久说下去）；E-M2 退回恒 `true` ⇒ 只红 P10（散文里提一句也算在位）。驱动自己断言 `collected > 0`（只看"有没有红"会把一条测试都没跑的驱动读成通过），还原后逐字节自证。
- **现场回读**：本机跑探针 rc=0，结论行已是「vendor **已能表达外部复核** ⇒ 高危域项填齐三格后可闭合为 `self_play_resolved`，旧结论自此次表达起失效、不得再沿用」。
- **故意不在本刀**：① vendor 那份是**本机补丁**（原文件 sha256 `8e3d65c6…` 记在补丁注释里），未投上游、也无「技能升级后是否还在位」的防护 —— 一次重装就会静默回到旧形态，届时探针会如实报旧结论，但至少不再说谎；② 三格仍是形状 + 一致性判据，不联网核评论真伪（真绑定属上游 issue）；③ #3919 的台账双读 + 载荷锚不在本刀范围 —— 它改的判据函数一天内被 #3927/#3941/#3987 三片重写 459 行，逐字 rebase 会静默削掉别人的收口矩阵，等那波停笔再重放。
# [未发布] test(gates): 账本合法清空不再被钉成禁态，并给 hasBlocking⇒退出码补一道接线锁（qm6-critic-dispositions）

- **动因是补跑成功的 QM-6 critic 轴**：`claude` 过额度日重置后两字探针活了（rc=0 / 17.6s / 265 B），于是把 #3949 那笔合并的差量（45,521 字节，直接附进提示词、不让评审者自己 `git diff`）真派了一次外部评审，交回 2 条 findings。派发前那一步救了一次命：**上一轮我判"该轴零交付"用的解析器只认「行首的 `[`」，而它的数组落在偏移 56,481 处** —— 63,796 字节真交付差一点被读成"没话说"。
- **F1 成立并修**：两条读真实账本的用例用 `assert.ok(keys.length > 0)` 把"账本被逐条销账到空"钉成禁态，而每条登记项的原因里都写着"回填后删除本条"——合法终态。摘掉下限后，"防靠清空变绿"完全由夹具机制锁 `清空账本不得变绿` 承担（它测的是"载体有未收口行 + `ledger:{}` ⇒ 判红并进阻断出口"，与真实账本此刻有几条无关）。**双向反证**：把真实账本临时置为 `{}` 时修后两条用例 **GREEN-AS-DESIGNED**、装回旧断言的那一条当场 **假红**（正是被修的那个缺陷的现场复现）；M6（`loadLedger` 静默丢条目）仍被"键数与文件条数相等"这条抓住红 ⇒ 摘下限没把牙一起摘掉。
- **F2 的两个读法都被代码否证，而我当时写的"内核成立"也是错的（本条已按本片变异证据改写）**：`main()` 第 33 行本就是 `if (hasBlocking(r, …)) process.exit(1)` ⇒ 阻断确实落到退出码，不是活 bug；但**这条映射当时确实在被一道行为锁看着**——我先前写的「没有任何东西在看」是错的：`端到端：真历史上一笔回填 PR 必须让 CLI 判红并点名那篇记录` 那条用例 spawn 真 CLI（`--base-ref`/`--head-ref`）并 `assert.strictEqual(r.status, 1)`，本次两次变异（摘掉映射、把映射包进块注释）里它都**指名变红**；缺的是「这道锁存在」被我读漏，不是缺锁。补一道结构接线锁（把匹配锚进 `main()` 函数体，并给"剥注释"这一步配负控+正控），**反证 MW2a/M-W2c：把映射包进块注释、或把它挪到 `main()` 外的诱饵函数，接线锁与 #74 那条行为锁一起指名变红。**
- **全集回归**：`check-gate-record-debt.test.js` **116 例全绿**（既有用例不退化 + 新增 1 条接线锁）；M1–M11 + C1 全集重跑（本刀动了测试文件）逐条仍 CAUGHT / 合规形态仍绿，跑后判据/测试/账本三文件 md5 与跑前逐一相等。
- **顺手记一条我自己的工具性错误**：写盘前那条"账本里不许再出现 `keys.length > 0`"的自检**命中了我自己写的解释性注释**（"这里**不写** `keys.length > 0`"）——存在性/禁词类判据不剥注释就会假报，这是本仓记过的同族第三次，改法是先剥整行注释再统计，而不是放宽判据。
- **同批补一道规格 delta（`align-shape-lock-empty-ledger-scenario`）**：今天归档进主干的那条 Requirement **自己打自己**——正文写「键数本身不设数字下限」，末个 Scenario 却写「键数为 0 ⇒ 该用例 MUST 红（规模下界）」。`openspec validate quality-gate-execution-record --type spec --strict` 实测仍判 `is valid`（它查结构与必需段，**不查条目内自洽**），所以矛盾随归档进了主干；本刀把代码改成"不设下限"之后，规格就成了相反的那一半。两条原 Scenario 标题**逐字保留**、只重写末个的正文，并新增一条"防清空由与条数无关的行为判据承担"——这不是修辞调整：`openspec` 的 MODIFIED 是**整块替换**，改标题会被校验器按"omits scenario(s) the current spec still has"拒掉（实测被拒一次，那个拒绝本身是有用的防丢场景机制）。


# [未发布] fix(a11y): 两族按钮建立即时键盘焦点环 —— 只写基类等于零覆盖这一形态被真浏览器抓到（ux-audit-focus-ring）

- **缺陷本体**：`.ui-btn` 与 `.cohere-btn-*` 两族按钮在 `origin/main` 上**没有任何 `:focus-visible` 规则**（`git grep` 实测命中 0；只有 `s2v-btn-*` 一族有 4 条），设计系统里同时躺着 `--focus-blue` 的两档声明、**零消费者**。键盘用户 Tab 到主操作按钮时看不到焦点落点（WCAG 2.4.7）。
- **⛔ 最值得记的一条：「只写基类」是零覆盖修复**。实测 180 个 `.vue` 模板里 134 处按钮 class **全部只带变体类**（`class="cohere-btn-primary"`），一处都不带基类 `cohere-btn` —— 只写 `.cohere-btn:focus-visible` 在源码里看起来"已经修了"，对那 134 个按钮完全无效。因此 group selector 逐个点名变体，锁的**判据域从模板清点得出**而不是抄一份清单。
- **第二落点：`transition: all` 把 outline 一起淡入**。第一次真浏览器读数里，4 个带 `transition: all` 的变体在 Tab 后 0ms 仍是过渡起点（`3px solid currentColor / offset 0`），不带 `all` 的立刻正确。修法是在焦点环规则里显式 `transition: outline-color 0s, outline-width 0s, outline-offset 0s`，并让判据同时读 **t=0 与 t=450ms**。
- **取证**：本机 Chromium 加载**真实** CSS 文件与 `UiButton.vue` 的 `<style scoped>` 原文，键盘 `Tab` 进焦点态读 computedStyle —— 8 个类 × 浅暗两档 = **16 项两时刻全 OK**（浅 `2px solid rgb(96,58,249) off=2px`，暗 `rgb(123,116,255)`）；非文本对比度 light 6.05 / dark-canvas 4.78 / dark-card 4.30，全部 ≥3:1。回归锁 `src/styles/focus-ring.test.js`（12 例），7 道变异逐条指名变红、`RESTORED_OK=true`。
- **边界**：3.6 主体（571 处 `<button>` 迁移、双轨合一）不在本批；`<div @click>`（阶段 4.4）刻意排除在判据域外；裸 `<button>` 仍由 UA 焦点环服务（实测 src 内 37 处 `outline: none` 全落在输入框/文本域，未波及按钮）。无新增 locale 键。
# [未发布] feat(gate): ops-center 前端纳入一致性门禁 —— 跨应用规则 + 反向边界 + 域健康三档失明守卫，并修掉该应用唯一那处原生 window.confirm（ux-audit-opscenter-gate）

- **先证明缺陷真存在再动手**：`git show origin/main:ops-center/frontend/src/views/PromptEvalWorkbench.vue | grep -c window.confirm` ⇒ **1**（第 440 行 `if (!window.confirm('确认删除该评测及其生成物？')) return`）。而同应用的 `Announcements.vue:128` / `AppMenu.vue:286` / `ContentCategories.vue:194` 早已全是 `ElMessageBox.confirm` ⇒ 这是孤例，不是"该应用用原生框"。
- **同一个函数体里还有第二个沉默缺陷**：原实现 `await deletePromptEvalCase(id)` 完全没有 try/catch —— 删除接口 500/404 时异常直冒、界面零提示（该文件其余入口一律写 `errorMsg.value = '…：' + apiErrorMessage(e)`）。一并补上，不新增文案键。
- **`doDelete(row.id)` 改成 `doDelete(row)`**：文案必须点名被删对象（title + ID），只传 id 就取不到 title；模板调用点同步改。取消语义按 `try { await ElMessageBox.confirm(...) } catch { return }` —— 取消/ESC/遮罩全部 reject ⇒ 什么都不做（fail-closed），不得写成"catch 里继续删"。
- **扩域按"跨应用是否成立"分配规则，不是一把尺子量两个应用**：`windowConfirm` 两应用都守；新增 `opsElectronApi` 反向边界（`window.electronAPI` 只在桌面端渲染进程存在，ops 引用即运行期恒 undefined 的静默 no-op）；`rendererIpcDirect`（依赖桌面端 `src/api` 白名单）与 `appleAlias`（依赖桌面端 `tokens.css` 资产）**明确不扩** —— 套过去只会造出既不可修也不可解释的"存量"。
- **ops 侧必须走全域遍历**：`RENDERER_DIRS` 是按桌面端目录结构写的（views/components/composables/stores/features/layouts/story2video/i18n/router/utils），ops 的 `api/ config/ constants/` 一个都不在表里。回归锁直接在三个盲区目录各放一处违规并断言全部被看见（旧口径一条都扫不到）。
- **本批最要紧的一条是"扩了域但只有名字扩了"的防护**：`domainStats()` 每根每桶出声（现场 `desktop(renderer=375,anySrc=540) ops(renderer=54,anySrc=83)`），`assertDomainHealthy()` 三档失明（根不存在 / 域为空 / 低于下界）一律走**退出码 2**，与"发现违规"的 1 分开 —— 扩域最危险的失败形态不是报错，而是路径写错 ⇒ 扫到 0 个文件 ⇒ 0 违规 ⇒ 被读成通过。下界的键集另有一条锁要求它**恰好等于**被消费的 (根,scope) 组合集：给没人用的组合留下界是死配置，有没人守的组合是漏守。
- **两条被实测否证的自写用例（改夹具而不是放宽断言）**：① 变异 FC-M2（缓存键退回 scope 单键）第一次跑报 `MISSED(照绿)` —— 我的分键夹具让两根各走**不同** scope 字面量，而不同字符串本来就不相撞；正解是强制两根同 scope，另加一把"`domainStats` 读数必须等于非缓存遍历结果"的交叉量。② FC-M10 的期望清单写错（把声明面的用例列进消费面变异的红集），当场报成"红了但没红在指名用例"。
- **32 例回归全绿；10 道变异 FC-M1…FC-M10 全部 CAUGHT，红集互不相同，`RESTORED_OK=true`（md5 自证还原）**。基线只新增一键 `opsElectronApi: 0`（`evaluateBaseline` 对缺键 fail-closed ⇒ 基线必须与代码同批落），他方键 `colorLiterals=129` / `cssVarUndefined=64` 原样保留。
- **现场发现的更大问题（不在本批修，判据已登记在执行记录末尾）**：`grep -rla "ops-center/frontend" .github/workflows/*.yml` 命中 **0** —— 运营中心前端的 `vite build` 与 `vitest run` 在 CI 上完全没有覆盖。本批因此只能退而用仓库根的 `@vue/compiler-sfc` 手工解析该 SFC（`parse errors: 0`、`template errors: 0`、`compileScript ok`），**这不是 `vite build` 的等价物**。补它属"改谁来守门"，且包管理器口径与落点必须先定。
- **没有**动 `.github/workflows/`（判据早已接在既有步骤里），没有动 `CI_IGNORED_PATHS`，没有动分支保护。桌面端运行时、locale、视觉基线均未触碰 ⇒ QM-1 / QM-4 N/A。
# [未发布] feat(门禁): 闭环值不等于闭环成立 —— 高危面收口矩阵与收口转变检测落码（qm6-highrisk-matrix）

- **要防的是「有人写了个词」被当成「评审发生过」**：`scripts/check-pr-exec-record.js` 原有的闭环判据只看 `deepReview.status` 落不落白名单 `{cleared, needs_revision, self_play_resolved}`。上一轮 QM-6 外部评审实测四种伪造 `cleared`（含 `evidence:"x"`）全部被接受，而 `self_play_resolved` 本来就在白名单里 —— 「外部模型一个都没跑」在机械上完全满足这条门禁。AGENTS 里那句「高危域不得自扮演豁免」从来没有执行体。本片把它落成判据：闭环成立 = 状态在白名单 **∧** 出处可核，可核的宽度按路径是否落在高危面分两档。
- **高危面清单 9 条、逐条带实测出处**：`HIGH_RISK_SURFACES` 取「路径前缀 + 显式自指」，不取内容指纹（`stats.sensitivePathHits` 主干 877 份产物里非空仅 2 份 = 构造性零，而指纹路线已被外部评审否证：改动源码可以躲在任何注释密集的非高危路径里）。命中数当场量得 `credential-` 3 / `account-state-lock.js` 1 / `api-publish-engine/src/auth/` 18 / `login-state.js` 1 / `fingerprint` 9 / `.github/workflows/` 15 / `scripts/check-` 100 / `scripts/ccg-review-` 3 / `scripts/deep-review` 2，全部写进条目 `why`。用例逐条断言「前缀在主干命中 ≥1 个受管文件」，命中 0 的前缀当场红 —— 装饰性条目比没有条目更坏。
- **一条变异暴露的「两处各抄一遍」**：首版反证把 `isHighRiskSurface` 摘成恒 `false`，期望三条红，实跑只红 1/3 —— 收口矩阵走的是 `highRiskHits` 里**另写的一份**前缀匹配。收敛成唯一实现 `highRiskPrefixOf` 后同一变异 3/3 指名红，并加一条结构锁用例（`2.1 单一匹配实现`：清单遍历与前缀比较只准出现在那一处）；反证里专门留一格「行为逐字不变、只把匹配再抄一遍」（P6），用来证明这条结构锁有牙。
- **收口转变检测（凭空把 pending 改成闭环值要有出处）**：产物在本次变更集是 `M`、base 非闭环、head 闭环，而出处既不是 `tier=external` 也不是 `closureNote` ⇒ 点名「收口无出处」并给出 `base=<状态> → head=<状态>`。`base` 取不到时**不报红**（不得把工具失明变成假红），但必须计入新增读数行 `TRANSITION-CHECK … 已核对= / 无出处= / 未证实=` —— 「未证实」与「已核对」在日志里必须不同形。**已知失明如实登记**：本次新增（`A`）的产物没有 base 可比，凭空伪造在判据层结构性不可判，正解是「闭环值只能由工具写」，而引擎在仓外（`~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`，当场核实 `tier` 出现 0 次、只写 `status`/`performedBy`）。
- **同一条读数打印两遍这个形态也一并收掉**：`--no-remote` 与远端清单取不到时会对 `r` 和 `r2` 各调一次 `applyDeepDebt`，现场 `TRANSITION-CHECK` 逐字出现两遍而 `TIER-COVERAGE` 只有一遍（当时只给后者加了护栏）。判据求值与读数打印上移到调用点之前，各恰好一行，并补计数断言 —— 理由不是美观：「打两遍」与「量了两次得出两个数」在 CI 日志里无法分辨。
- **两处刻意不拦，都带负控用例钉住不许被「顺手加严」**：① `tier` 缺失（`unknown`）不拦 —— 判定器对新产物初始化 `tier:"unknown"`，而它只有跑过真外部评审才翻成 `external`，按合同字面「unknown ⇒ 一律欠账」实现会当场造出无法闭合的循环（与缺陷G 同型），代价登记在记录遗留；② 非高危面上的 `self-play` 收口仍算闭环 —— 一刀收紧会让主干所有在飞 PR 判红，欠账交给「机械对抗产物作为降级货币」那片（tasks 4.x）。
- **QM-6 现场记一条后端可达性的新形态**：`opencode` 轴 rc=0、stdout **0 字节**，stderr 原文是服务方按 IP 拒绝提供 free 模型 —— 属「跑完但零交付」，按产物判即不成立，不得记成通过；改用 `codex` 作跨家族第二轴。同时暴露 `backendAvailability` 只测「CLI 在不在 PATH」（当场记 `count=2/2, onPath=[claude, opencode]`），不测「后端能否应答」，正是 tasks 3.5 那三档（不可达 / 可达但交付无效 / 证据不足）要解决的形态。
- **读数**：`scripts/check-pr-exec-record.test.js` 81 → 113 用例（首轮 +11 条，含三条边界负控；QM-6 两轴处置再 +21 条），`113 passed / 0 failed`；变异 21 条全部指名红、`escaped=0`、逐条还原 md5 一致。消费者并集同跑：`ccg-review-decider` 52 / `check-record-qm5-rows` 19 / `classify-docs-only` 27 / `lib/ccg-review-backends` 17 各 0 失败；`.github/scripts/workflow-contract.test.js` 43 passed（本 worktree 未装 `js-yaml`，用共享根同一份库经 `NODE_PATH` 跑通，不代替 CI）。静态门禁逐条 rc=0：`check-unwired-tests`（域内 108 个测试文件）/ `check-step-failfast`（39 个多命令步骤）/ `check-workflow-structure`（files=14 violations=0）/ `check-gate-record-debt` / `check-record-qm5-rows`（域内记录 246）/ `check-visual-coverage` / `check-no-brand-residue` / `check-doc-abs-paths` / `openspec-sync-check`。`classify-docs-only` → `docs-only=false files=3` ⇒ 混合 PR，按完整质量节拍走。
- **两轮外部评审的处置口径**：第 1 轮两轴共 17 条（claude 6 + codex 11）逐条处置，接受 12、部分接受 2、否证 2 —— 其中"按记录自身路径判高危"这条**必须否证**：判定记录本来就是 PR 级的，`.ccg/reviews/<hash>.json` 永远不落在任何前缀上，照那个修法改等于把刚建立的矩阵整条关掉（实测归因恒空）。第 2 轮 8 条里又拦住一条真后门：高危面上「本次新增即写 cleared 而 `tier` 缺席」既不受转变检测管辖（没有 base 可比）也不被矩阵拦（unknown 放过）—— 那是"给自己贴一张已通过"的零成本路径，现在拦。跨家族轴第 2 轮**未交付**（`429` 两次、`503` 一次，清单里的 `opencode` 仍是 IP 级拒绝），所以处置引入的那部分改动只有单轴复审，这条如实记在记录 §六 第 13 条而不是写成"双模型完成"。
- 现场记 `openspec/records/qm6-highrisk-matrix.md`；合同对账见 `openspec/changes/ccg-review-degradation-ladder/tasks.md` 第 2 节（2.1–2.5 已勾，2.3 的偏差逐字写明）与 8.1（**不勾**，只落判据侧那一半，另一半拆成 8.1b）。

# [未发布] fix(ci): 接通 Electron CI 串行单测的自证块（#2525 承诺而从未执行的诊断）

- **现象**：`electron-tests` 在 main push 上间歇性红，日志**零条** `×`、零条 `FAIL`、零条 vitest 摘要行，
  只有 `exit code 124`。近 12 次 main push 里 5 次失败，且同一形态在**不是本仓 PR 内容**的
  `715391c88` 上复现 ⇒ 与具体改动无关。
- **第一性原因**：`bef5fb72c`（#2525，2026-09-28）的标题是「让超时失败能自证」，正文也写了
  `RC=${PIPESTATUS[0]}` 与整段 `TIMEOUT_BUDGET_EXCEEDED` 诊断，但它们被放在
  `timeout … | tee` **之后**；而该 job 的 shell 是 `bash -e -o pipefail`，`timeout` 返回 124 时
  `-e` **立刻退出步骤**，其后每一行都不执行。**该自证块自合入起从未运行过一次** ——
  它专门为之设计的那个场景，恰恰是它唯一不出现的场景。
  旁证：同一 `run:` 目录下的 `Electron smoke test` 早就用着正确的 `set +e … set -e` 写法。
- **修法**：`set +e` … `RC=${PIPESTATUS[0]}` … `set -e`。行内 `set -e` 只影响本步骤的子 shell。
- **回归保护：判据域从「字符串存在」升级为「行为成立」**。旧锁只断言那四行**存在于 YAML**，
  而被测性质是**运行时执行路径** —— 判据域错位，于是锁一直绿、自证一直死。
  新锁取该步骤 `run` 原文，只替换两个量（预算→1s、`pnpm …`→`sleep 2`），在
  `bash -e -o pipefail` 下**真跑**，断言 `status===124` 且 stdout 含 `[electron-ci-timeout-budget] elapsed=`、
  `rc=124`、`TIMEOUT_BUDGET_EXCEEDED`、`已完成测试行数`（最后一条证明控制流走到了诊断尾部）。
  **变异反证已做**：摘掉 `set +e` → 立刻红，报「自证行缺席 ⇒ 自证块又被 -e 提前杀掉了」。
- **同轮修掉的另一处真 bug**（由 CI 首次跑这条锁时抓到）：`packages/shared-utils` 的
  `ledgerCommandName` 对 `spawn(file,args)` 传的**裸路径**切首 token，含空格的路径
  （如 Git Bash 的安装路径）会被折成 `Program` —— 真实命令被无意义键盖住，而运行时出站台账的
  全部意义就是「谁在起子进程」。`shellFirstToken` 只处理了**带引号**的形态。修法是裸串且整串
  据**文件存在性**解析成文件时取真实 basename；回归锁 +1 例（含负控「不得是 `my`」），
  基线登记 `child::bash.exe` 并写全理由。
- **未落地（明确记为遗留）**：按 `--shard` 把整轮切开这件事本轮**没有做**。三轮尝试证明它被
  required context 卡住：ruleset `main-ci-gate` 要求的 context 是 `electron-tests`，而 matrix
  作业无论加不加静态 `name` 都只报 `electron-tests (1)` 这种带后缀的名 ⇒ 22 项全绿的 PR 仍判
  `base branch policy prohibits the merge`；另加一个 `name: electron-tests` 的汇入作业又会让整份
  workflow 被判不可解析（幻影 push run + 0 job，两种 `if` 写法都复现）。正解需要把 matrix 作业改 id
  并同步 `.github/scripts` 里多条结构性锁，属另一件事。接通自证之后，下一次超时会**首次**产出
  `elapsed=` 读数，届时可以据此定片数与预算。
- **教训**：GitHub 有**两套并存**的分支保护面（legacy protection 与 rulesets），只查一套就得出
  「不受约束」的结论，等同于「查到第一个空结果就收工」——与本条主线要修的毛病同型。

# [未发布] chore(debt): 债务熔断基线 re-sync 到主干现状——接受漂移不是清理，并登记拆分红利（debt-baseline-resync）
- **现场**：`debt-guard.yml` 的「债务熔断检查」从今天起在**每一个** rebase/merge 到今天主干的
  pull request 上判红：`MAX_FILE_LINES: 5359 > baseline 5239`、`FILES_OVER_1000: 29 > baseline 28`。
  本会话的 #3898 / #3992 / #4010 同时被卡（#4010 是以另一种形状：
  `scripts/lib/git-domain.test.js` ⑩「消费者套件必须整份真的跑了」把 `check-debt-budget` 的失败
  原样抬成红 ⇒ 一条下游锁把上游债务变成了自己的失败，这正是该锁设计要防的"读起来像通过"的反面）。
- **归因两条并列，都是当场量的**：① 在**刚由 `session-init.sh` 从主干创建、未做任何改动**的
  worktree 里跑同一条判据，读数与 CI 逐字相同 ⇒ 不在任何本会话分支上；
  ② `git show origin/main:apps/desktop/src/views/CreateView.vue | wc -l` = **5358**，
  而 `git show origin/main:scripts/debt-baseline.json` 的 `maxFileLines` = **5239**
  ⇒ **主干自己的树违反自己的基线**。增量大户是当日已合并的 #3969 / #3946 / #3936，
  三条都落在 `CreateView.vue` 这条链上。
- **本次只做一件事：把两个数改成实测现状。** `git diff` 全文只有 `maxFileLines`、
  `filesOver1000`、`scannedAt` 三行；`maxFilePath` 仍指向 `CreateView.vue`
  （**没有换文件来绕开上涨**），也没有动判据口径、没有动扫描域。这是 AGENTS.md 里
  「debt-baseline 更新即如实记录现状，须在 PR 说明是接受漂移而非清理」那条的正面执行。
- **不认领"顺手拆一个大文件"**：`CreateView.vue` 今天有三个并发会话在改，在热文件上做结构搬迁
  会把三批归因搅在一起，且 `create-*` 像素基线需重取并人工审核。拆的**判据**已经写清：
  必须让 `maxFileLines` 与 `filesOver1000` **同时下降**，否则等于白搬。
- **顺手记下这个基线缺的那道锁**（留给门禁批次，不在本 PR 夹带）：现在 `--update` 是
  "重算即接受"，缺"调大必须与一次真实清理同 PR"的约束。可抄的同型判据是
  `check-doc-abs-paths.js` 的 `judgeLedgerDrift`（为容忍自己的新增而调大账本 ⇒ 当场判
  「账本被放宽」红）。差别在于 debt 基线**确实存在"如实记录主干现状"的正当场景**，
  所以正解不是禁掉调大，而是要求调大时**点名哪条真实清理没做**。
- **验证**：`node --test scripts/check-debt-budget.test.js` ⇒ 15 pass / 0 fail（含"基线形状不许变"
  与"域口径必须与 `git status` 一致"两条，本次形状与域都没动）；re-sync 后
  `node scripts/check-debt-budget.js` ⇒ 「所有债务指标在基线内，通过」；
  `classify-docs-only` ⇒ `docs-only=false files=1`（工具面数据文件，不借快速通道）；
  行尾两口径 numstat 一致。QM-1 / QM-4 / TDD 均 N/A（无代码行为变更）。
  QM-6 双模型外部评审**未执行**（本机无可用通道，pre-commit 如实打印跳过）。
- 执行记录 `openspec/records/debt-baseline-resync.md`（含归因两条、影响面与两个跟进项判据）。

# [未发布] feat(rewrite): >50000 长文分段改写 + 渲染层不再预截断 + 截断两态分型（rewrite-segment-long-input）

## 问题

第一刀把 `_rewriteOnce` 抽出、`_validate` 只保空内容校验后，**>50000 输入无路可走**——旧限制拆掉了、新能力没装上。
三条评审预警的同型缺陷也随之暴露：① 渲染层 `prepareRewriteInput` 预截断让分段路径在采集页**永不可达**（死代码）；
② 段级区间若照搬 ratio，5 段合计上限 72000 > 全篇 50000，合并必砍 22000 字（「为免截断而分段、分段反而制造截断」）；
③ 任一段失败若返回半成品，用户会把残缺稿当成品。

## 改动

- 新增 `packages/rewrite-engine/src/segment-splitter.js`：三级切分（段落贪心合并 → 句子边界 → **码点硬切兜底**），
  保证 segment 永不超 `SEGMENT_SIZE=12000`（= `max_tokens 64000 ÷ 2` 安全线），emoji 代理对不劈；
  **无损性契约**：每段都是原文连续子串且顺序覆盖（测试断言，防丢段/重复段/编造段）。
- 新增 `packages/rewrite-engine/src/segment-rewriter.js`：分段编排（独立模块，避免核心文件撞 max-lines 基线）——
  逐段复用 `_rewriteOnce`、prompt 注入「长文分片 i/n」、合并后**复用 `_postProcess`**（不新造第三条截断语义）；
  失败整篇失败 + `segmentIndex`/`segmentCount`（不返回半成品、不写知识库）；段级区间按**份额**分配
  （`deriveSegmentRange`，各段上限之和 ≤ 全篇上限）。
- 引擎 `rewrite()`：`> MAX_INPUT_CHARS` 分流到分段路径；`_validate` 移除长度硬拒（只保空内容校验）。
- 渲染层：`prepareRewriteInput` **不再预截断**（只做空内容归一）+ 新增 `shouldSegmentRewrite`；
  采集页/改写页在超阈值时**事前** info 提示「将分段改写（耗时与费用增加、其他 AI 功能可能变慢、可能有一致性折损）」；
  结果卡 meta 行新增「分段改写 ×N」；采集页成功分支新增 `meta` 四字段透传（修「引擎可见字段被静默丢弃」）；
  新增模型截断横幅（`data-testid="rewrite-model-truncated"`），文案明确「这是模型侧限制，调大字数控制不一定有效」。
- 错误与文案：`REWRITE_SEGMENT_FAILED`（1-based `{index}`/`{total}` 插值）；删除已无调用点的
  `collection.rewriteTruncated`（预截断取消后它与分段提示互相矛盾）。

## 验证

- 引擎 **255 passed**（segment-splitter 11 + S1–S5 五例 + 既有 239；W3 改写为「50001 走分段成功」）。
- 渲染层 **274 + 136 passed**（跨两组汇总覆盖全部受影响面：模型截断横幅分型、分段 meta、meta 透传、分段失败文案、
  结构锁改写）。
- `build:vue` rc=0；`electron-builder --dir` rc=0；asar 实测：`segment-splitter.js` / `segment-rewriter.js` /
  `llm-result.js` 均在包内，核心文件已委派 `require('./segment-rewriter')`、含 `> MAX_INPUT_CHARS` 分流，
  切分器含硬切兜底、分段器含段级区间推导。
- 静态门禁：unwired-tests OK、locale keys PASS（2167）、locale CJK PASS、max-lines ✅、brand-residue PASS、doc-abs-paths PASS。

# [未发布] feat(rewrite): finish_reason 全链路透传 + Python 字数上限对齐 50000 + rewrite() 抽取 _rewriteOnce（rewrite-segment-contract）

## 问题

rewrite-limits-50000 放开上限后暴露三条契约尾巴（change rewrite-segment-and-finish-reason 第一刀）：
1. provider `finish_reason` 在 adapter 已返回（openai.js:158 / anthropic.js:174 / minimax-llm.js:137，其余 OpenAI 兼容子类继承），但 ai-generator→llmClient→引擎全链路只传 string ⇒ **模型侧输出截断完全不可见**，与引擎侧截断混淆无法归因；
2. Python 聚合链路 `RewriteRequest` 字数上界仍钉 5999/6000，与 JS 引擎 50000 不一致；
3. 引擎 `rewrite()` 是 160 行单体，无单次改写子方法 ⇒ >50000 分段改写无可复用单元。

## 改动

- 新增 `packages/rewrite-engine/src/llm-result.js`：`normalizeChatResult`（string/object 双形态单点归一化）+ `isTruncatedFinishReason`（`length`/`max_tokens` ⇒ 截断；`stop`/`content_filter`/null ⇒ 否）。
- 两个消费点共用归一化：`RewriteEngine._rewriteOnce`（归一化后判空，`{text:''}` 仍走 EMPTY_RESULT）与 `extractWithLLM`（关键词兜底——不归一化会让「chat 返回 object」静默杀死关键词兜底且无报错）。
- 主进程 `rewrite-engine.js` llmClient.chat 返回 `{text, finishReason}`；`rewrite()` 结果新增 `modelTruncated`（纯增量字段）。
- Python `models.py`：`min_word_count` 5999→49999、`max_word_count` 6000→50000（真源注释指向 JS `MAX_OUTPUT_CHARS`）。
- **保形抽取** `_rewriteOnce`（第二刀分段改写的前置件）：`rewrite()` 变薄编排（校验/敏感词前置/策略匹配全篇一次 → `_rewriteOnce` → 全篇级副作用一次 → `_assembleResult`）；KB recordFeedback 与 viralScorer 上移全篇级，分段路径由此天然获得「一篇一次」语义。

## 验证

- 引擎 **239 passed**（新增 llm-result 10 + modelTruncated/EMPTY_RESULT/LLM_ERROR 七例 + keyword object 三例）；渲染层 **192 passed**；Python **51 passed**（50000 合法 / 50001 越界新边界）。
- 保形抽取零行为变化：229 例既有引擎测试全绿。
- `build:vue` rc=0；`electron-builder --dir` rc=0；asar 实测含 `normalizeChatResult`。

# [未发布] fix(gates): 测试接线棘轮的判定域改成 git 的域，并消掉反向的「本机私产伪造接线」（unwired-tests-git-domain）

- **动因（实测两例，同一根因）**：`scripts/check-unwired-tests.js` 的域是**磁盘遍历**，于是本机才有的未跟踪产物被当成「仓库里的东西」。① 共享根里另一会话留下的 `.adversarial/arl-patched/.github/workflows/ci.yml`（实测命中 `.gitignore:417`）⇒ `NESTED_WORKFLOW_NOT_EXECUTED` rc=1，而 CI 的检出态里没有这个路径；② 上一轮为 `.agent_context` 给剪枝清单加过一条目录名（那次共享根 3546 行、其中 3543 行来自它），但**按具体路径打补丁只能事后追认已发现的噪声**，第二例照样红。这是 #3876（check-max-lines）/#3900（check-debt-budget）同根因的第三处，也是最后一处判据本体在 `scripts/`、扫全仓的那一处。
- **改法**：判定域改取 `scripts/lib/git-domain.js`（`git ls-files` ∪ `--others --exclude-standard` = `git status` = CI 检出态），一次取域、四条枚举共用；`walkRepoFiles` 与 `PRUNE_DIRS` 连同两个导出键一起删除。**同文件里 `readWorkflowText`/`listJobBlocks` 的目录枚举也一起换**——那是同一缺陷的反向（假绿）面：本机在 `.github/workflows/` 放一份被 gitignore 的 yml 就能伪造「这条测试已接线」，而 CI 永远不会执行它。三份退化出口按方向分开：目录不存在 / 域里零个 workflow / **域里有但磁盘读不到**（索引与工作树不一致，拒绝「跳过那一份」）。
- **夹具换形（这才是该 Bug 的真正逃逸原因）**：既有 33 条用例的夹具是玩具目录（`mkdtemp` + 写文件，不是 git 仓），对「域从哪里取」这个变量**结构性免疫**——磁盘实现与 git 实现在它上面给出的结论只差「我写了几个文件」，所以判据取哪一盘都绿。现 `makeFixture` 走 `init -b main` + `add -A` + `commit` 建真仓，并**自带** `core.excludesFile` 与 `core.hooksPath` 钉住（判据本体按调用方 git 环境如实取域，机器态解耦只能由夹具自己做）。
- **回归锁 33 → 39，逐条 TDD 先红**：域正控 / 负控 A（被忽略的 workflow 与被忽略的 `*.test.js` 都不得进判据）/ 负控 B（**未跟踪但未忽略必须仍在域内**，否则「新写的测试没接线」永久隐身）/ 夹具钉住压过机器 global 档（含「不钉就被藏掉」的负控半区）/ 取域失败点名出声 / root 不存在抛错 / 两条假绿方向行为锁 / 反向结构锁「磁盘遍历与剪枝清单不得回来」。实跑 39/39；`git-domain.test.js` 12/12；`workflow-contract.test.js` 44/44。
- **反证 7 条，红集互不相同**：M1 取域退回磁盘递归遍历（**被禁止的形态本身**，9 红）/ M2 域收窄成只看被跟踪文件（4 红）/ M3 取域失败静默返回空集（3 红）/ M4 判据自带一份 git 调用、不引用共享实现（8 红）/ M5 摘掉夹具的 excludesFile 钉住（**1 红**）/ M6「有哪些 workflow」退回磁盘目录枚举（3 红）/ M7 域里有但磁盘读不到时跳过那一份（**1 红**）；每条跑完按备份字节还原并回读 `restored_byte_equal=true`。
- **A/B（同环境、同 `--root`，只换实现）**：共享根 A 修复前 **rc=1** 并报出那份 gitignored 的嵌套 workflow、B 修复后 **rc=0**，两档「检查域内测试文件」都是 **101** ⇒ 换域只排除「本机才有」的东西。同树差集探针另证 `tests_lost=[] tests_gained=[]`（111 vs 111），嵌套清单两档相同；`git 域(10805) > 磁盘域(6789)` 是因为旧遍历按前缀剪掉 `apps/ packages/ ops-center/`，于是嵌套 workflow 的检测面**变宽**，实测真实仓库无新增未承认项。
- **两条 fail-closed 断言由 M3 当场证伪后收紧**：原写 `/git|工作树|work tree/i`，而任何含 `.github` 的文案都命中 `git` 子串 ⇒ 恒真。改为点名真实出口「无法从 git 取得扫描域」。**驱动侧同课**：变异锚点最初按 LF 拼，而本仓 `scripts/*.js` 工作副本实测 CRLF ⇒ 三条变异报「锚点未命中」——那不是「锁抓不到」，是探针自己失明；改按目标文件真实 EOL 拼锚点后全部命中。
- **QM-6**：按用户指定自演两轴（9 条发现：1 CRITICAL / 3 MAJOR / 3 MINOR / 2 INFO，逐条给落点见执行记录），**如实标注这不是外部模型产出**；机械链上 `.ccg/reviews/<sha>.json` 由 pre-commit 生成，其「是否真的跑过外部模型」这一维度本仓仍无判据（AGENTS「残留风险」，未闭合）。
- 执行记录 `openspec/records/unwired-tests-git-domain.md`。遗留未动：`scripts/lib/mask-coverage-ab.js` 仍自带一份剪枝清单 + 磁盘遍历（那是覆盖率 A/B 探针，它的域「该不该」含未跟踪产物需单独取证，不顺手收敛）；三条等人工的项照旧（`~/.local/bin/env` 缺 `exec` 转发、共享根游离空目录、`scripts/doc-abs-paths-baseline.json` 进 `CI_IGNORED_PATHS` 属改「谁来守门」）。
# [未发布] docs(openspec): 归档最后一个频率 change，把「启动期裁剪」与「死接口禁令」并入主干规格（openspec-archive-unwired-surfaces）

- **动因**：归档从来不在 AGENTS 的「合并后收尾清单」里 ⇒ 每个 change 合并后目录永久留在 `openspec/changes/`、其 delta 也从未进主干。本篇是频率这条线的最后一处残留：`publish-frequency-unwired-surfaces` 随 PR #3712 合并（2026-10-16）后原地躺了 4 天，主干规格读起来像「频率契约只有 22 条」，而实现里已有启动期日计数裁剪与「不得保留没有调用点却承诺了能力的接口」两条纪律。
- **动手前的三项前提核对**（缺一即不许跑 CLI，见记忆「归档收尾」）：主干 capability 存在且已同步（实测 Requirement 22、MODIFIED 目标 `间隔维度与策略单一真源` 在第 32 行）；两条 ADDED 名字在主干 `grep -c` = 0；MODIFIED 块的 scenario 集合是主干那块（2 条）的**超集**（我 4 条）⇒ CLI 的「主干有而 delta 没有 ⇒ 中止」fail-closed 不误伤，也不需要 `--skip-specs`。
- **归档落点判据**：`openspec archive … -y` 自报 `Totals: + 2, ~ 1, - 0`；`git diff --cached --name-status` = **3 条 R100 + 1 条 R080 + 1 条 M**（三个文件纯移动、tasks.md 移动+两处编辑、只有主干规格被改）。归档后主干 Requirement **22 → 24**，两条新 Scenario（第 60 / 67 行）与两条新 Requirement（第 521 / 558 行）逐个 `grep -n` 命中，`TBD` = 0，`openspec validate publish-frequency-control --type spec --strict` = valid。
- **归档前纠过期勾选，两类处置不混**：`tasks.md` 顶部新增「归档处置对账」表。4.4 **补勾**（四个条件各有当场产物：merge SHA `456214660…`、合并前 23 pass/0 fail/0 pending、回填销账 #3744、worktree 与分支退役现场 + retire 标签在位）；3.6 **保持未勾随档案带走**——它要的是「双模型**外部**评审 + 原件入库」，三条外部通道实测不可用（CC Switch `:15721` CLOSED、opencode 宽任务书 65 分钟零产物、窄任务书 240s 零字节），随后用户指定自演双轴并命中 C-1。**自演不等于外部交叉审查，补勾就是拿替代做法冒充未建立的能力。**
- **顺手删掉一处会持续说谎的散文**：主干 Purpose 写着「共 6 条」——这个数字早在 #3910（22 条）时就已失效，本片归档后是 24 条。改成「判据只认本文件当前列出的 Requirement 与其 Scenario，不在此写死计数」，**把随归档漂移的量从文本里删掉，而不是换成一个新数字继续漂**。
- **现场对照（计数差必须先看集合差）**：`openspec-sync-check` 两测都 rc=0 且 **tasks 计数不变（387）**、archives 241→242；`openspec validate --all --strict` 从 26 红变 27 红，集合差**只有一条** `change/member-tier-contract` —— 它随基线 `4fa810d95`（PR #4051，他人会话）进来，与本分支路径不相交（两份失败清单里 grep 本分支触碰名 = 0）。已如实上报，不由本片顺手改别人的规格。
- **本次实测到的一个复发型工具错误（已修，写法记进执行记录）**：给 tasks.md 打补丁时用 `String.replace(anchor, text)`，而 text 里含取证命令串 `--grep='(#3712)$'` —— JS 把 `$'` 解释成「匹配之后的全部文本」，于是把 4.5 整块复制进我的续行中间，产出「4.5 出现两次 + 4.4 续行被拦腰截断」。抓到它的不是眼看，是 `openspec-sync-check` 报的 `TASKS_MD_DUPLICATE_TASK_ID`。修复**不是删掉多出来的那份**，而是从 HEAD 原始 blob 重建该文件、只施加声明式编辑，并用行多重集断言 `head_missing=0 / unexpected_extra=0`；第一次重建还因 `encoding: "binary"` 把 UTF-8 读成 latin1 而被首行标题断言当场拦下（写盘前抛错、零损坏）。口径：**文档正文里 `$'` / `$&` / `$1` 是常态，任何以字符串为替换体的文本编辑一律 split/join 或函数式替换**。
- 执行记录 `openspec/records/openspec-archive-unwired-surfaces.md`。遗留不假装闭合：归档仍未写进 AGENTS「合并后收尾清单」（改它属人工过目）；Purpose 与 Requirement 全集的同步无任何机械判据（本片只删掉了会漂移的计数，闭合需新增门禁）。
# [未发布] fix(tests): 给「夹具只准落在临时目录」装上执行体 —— check-docs-sync.test.sh 会把垃圾写进工作树（docs-sync-fixture-leak）
## 干了什么
- `scripts/check-docs-sync.test.sh` 的 `make_repo` 没关 git 的 stdout，而调用方是 `repo="$(make_repo …)"`；
  一旦继承 MSYS 的路径转换开关，`/tmp/tmp.XXXX` 被 bash 与原生 git.exe 解析成两个不同位置 ⇒ seed 提交变空 ⇒
  git 把 `On branch main / Initial commit / nothing to commit …` 打到 stdout，整段被吞进 `$repo` ⇒
  之后的 `mkdir -p "$repo/…"` **相对 cwd** 落盘，实测在别的 worktree 里留了 11 个未跟踪文件（目录名就是那段 status 原文）。
- 五道锁全部落在同一个自测文件里：① 入口 `unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL`（环境免疫）；
  ② `make_repo` 每条 git 调用 `> /dev/null`，函数唯一 stdout 出口是路径；③ `repo` 必须逐字等于 `$TMP/case-<n>`，
  且判断排在**任何写入之前**；④ 夹具完整性自检（`rev-parse HEAD` 存在 + `README.md` 在索引里）；
  ⑤ cwd 条目快照对账，出现任何新增即 FATAL 并点名泄漏。

## 根因（QM-5 ①）
- 命令替换会吞被调函数写进 stdout 的一切；而"用例 rc 对不对"与"夹具成没成形"是两件事 ——
  事发那次（p124 现场日志）第 1 行就是 `README.md: No such file or directory`，第 20 行照样打印 `PASS:`。

## 反证（10 组，逐条在沙箱 cwd 跑，垃圾只落沙箱）
- 摘 `unset` ⇒ `没有任何提交` 拦下；再摘 commit 的 `> /dev/null` ⇒ `stdout 被污染` 拦下且不落盘；
  再摘等值闸 ⇒ 泄漏 1 条被完整性闸截断；把 seed 改名 ⇒ 只有 README 闸红；
  **再把 README 闸摘掉 ⇒ `PASS: 8`（空 seed 夹具照报全绿）** —— 这条证明该闸非装饰；
  把夹具目录改成相对 cwd（夹具本身合法）⇒ 只有隔离对账会红（stray=16）。

## 遗留
- `check-unwired-tests.js` 的 `NESTED_WORKFLOW_NOT_EXECUTED` 判定域是**磁盘**而非 `git ls-files`，
  于是本机垃圾会把公共仓 required 门禁判红一次（与 #3876 同族的磁盘域/检出域分叉），另立任务；
- 同类面已清点到 `*.sh` 全集（按 `$(mktemp -d)` 扫仅命中本文件），但 vitest/pytest/ps1 的夹具落仓库内风险仍无统一判据。

# [未发布] feat(film-engineering): 提示词资产层批次一 —— 镜头语法/合规清单/剧组色盘/任务级提示词库 + 单镜时长来源链

- **动因（研究报告实测缺口）**：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md` §3.20 实测出三处硬缺口——
  ① 单条分镜提示词最长 **13,922 字符**一段到底（FireRed 失败模式表警告的「过长丢约束」已常态化）；
  ② 只有全局三档 `AUTO_SHOT_SECONDS=[5,8,10]`，**没有单镜时长维度**（四方对照里 mulpub 是唯一缺失该维度的实现）；
  ③ 提示词资产仅 `prompt-doctrine.json` 单文件（FireRed 14 个 / waoowaoo 33 个）。
- **新增四份数据资产（`apps/desktop/electron/film-kit/`）**：`shot-grammar.json`（10 景别 / 12 运镜 / 8 机位 /
  6 光线 / 8 特效 / 3 情绪档 / 4 时长档，含 `chain` 链式校验与 `risk` 风险分级——high 档必须单独试镜）；
  `compliance-checklist.json`（12 条：blocker 5 / warn 7，每条含「问题→通过判据→不通过怎么改」）；
  `palette.json`（4 主色 + 2 扩展色 + 5 条情绪色彩映射 + 漂移治理四步）；
  `prompts/tasks/**`（4 任务 × 2 语种 × 2 文件 = 16 个 `.md`，**目录即契约**，加任务只建目录不改代码）。
- **方法论扩容（`prompt-doctrine.json` schemaVersion 1→2）**：blocks 7→**11**（新增长台词 T1-T7 / 动作戏 17 条 /
  首尾帧 21 条 / AI 转场介质掩护）、rules 10→**14**（新增禁代词 / 时长由台词推算 / 首尾帧单一物理事件 /
  形变必须有介质）、新增 **recipes 2 档**（full 全量 / firstline 首行精华，后者明令不用于终版）、
  新增 **failureLedger 8 条**（症状→原因→修法，改提示词前先查台账）、glossary 6→10。
- **新增模块 `prompt-library.js`（~290 行）**：任务化提示词库加载 + `{{var}}` 模板渲染 + **路径穿越防护**
  （任务名/语种先过白名单，再断言解析后路径仍在 `tasksRoot` 内）。渲染时**未提供的变量保留原样**并列入
  `missing`——不静默替换为空串，漏填要能被看见。中文任务名与非法大写占位符一律不参与替换。
- **新增模块 `shot-duration.js`（~250 行，纯函数零 IO）**：F2 时长推算（中文按字 / 英文按词，
  **中英混排分别折算后相加**——单一语速乘总数会系统性低估英文、高估中文；括号内舞台提示不计入；
  原始秒数**只向上吸附**档位，向下会切掉台词尾巴）+ F34 来源优先级链
  （**user > tts > formula > tier**）。非法值一律**降级并出声**，不静默：用户超上限时文案明确写
  「请改用拆镜而不是压缩时长」。
- **`kit-loader.js`：缺失 vs 损坏两种失败形态分开（本 PR 最重要的设计决定）**：初版把新资产做成硬必填，
  结果 6 个测试文件 41 例当场失败——那 41 例测的是 shot-library 逻辑、与资产完整性无关，这个失败本身就是
  「硬必填把所有消费方耦合到最新资产」的信号。改判：**fail-closed 的对象是「损坏的数据」，不是「不存在的增强」**。
  损坏（存在但非法）→ 整级不可用；缺失（不存在）→ 可用 + `kit.assetWarnings`（可见不静默）+
  `requireAssets: true` 严格模式（`loadFilmKitChain` 透传，缺失时回退 asar 内置包，**老用户升级拿到随包新资产
  而不是瘫痪**）。另新增 `kit.grammarIndex` 六张 Map 供按 key 查表。
- **`auto-plan.js`：时长字段纯增量**。每镜派生 `durationMs`/`durationSec`/`durationSource`，顶层新增
  `estimatedDurationSec`/`durationSourceCount`，偏差 >20% 追加 W8 警告。**既有 `seconds` 与 `plannedDurationSec`
  语义一字不动**（有测试锁定）——`seconds` 是用户档位意图，`durationMs` 是按台词的物理估计，替换它属
  不必要的破坏性变更。
- **色盘注入串要校验「含全部主色」**：色盘价值不在文件里存 4 个颜色，而在**每次生成都原样粘贴同一串**；
  注入串漏一个色，模型就自行补一个，漂移从这一刻开始。故 `validatePalette` 断言 `paletteLine.<locale>`
  包含每个 `primary[].hex`——把文档纪律变成机械判据。
- **测试**：新增 `prompt-library.test.js` 28 例 + `shot-duration.test.js` 37 例（两者**先跑红再实现**）；
  `kit-loader.test.js` 23→**51** 例（补缺失/损坏/严格模式/回退链/四组新校验器）；`auto-plan.test.js` 44→**51** 例。
  film-engineering 全量 26 文件 **407** 例、含 `src/views/film-auto` 共 29 文件 **456** 例全绿。
- **两处测试契约同步（是「实现更正确后契约要改」，不是掩盖失败）**：① `shot-library.real-kit.test.js` 的
  `BLOCK_HEADINGS` 断言原为「严格等于方法论块标签」（当时同为 7），方法论扩到 11 后失效——经判定
  `BLOCK_HEADINGS` 是「从随包 153 镜语料抽取块」的集合，与方法论块数**不是同一概念**，改为断言真实不变量
  （抽取集合 ⊆ 方法论块 + 新增四块确实存在），**没有**把新块塞进 `BLOCK_HEADINGS`（那会让抽取器去找语料里
  不存在的标题）；② `kit-loader.test.js` 夹具随 `KIT_FILES` 4→7 同步补三份 JSON 与 `prompts/tasks`。
- **QM-1 打包验证（真抓到过东西）**：`electron-builder --win --x64` **rc=0**；asar 清单 film-kit 共 **52** 条目，
  新增三 JSON 与 **16 个 prompt `.md`** 全部在包内（首轮用错正则误判过一次 MISS，核对真实路径后确认无缺失）；
  启动验证 **PASS**（8s 窗口存活 + stderr 0 字节）。**如实记录环境告警**：父环境带有
  `ELECTRON_RUN_AS_NODE=1`，已在子进程显式剔除——该变量会让 Electron 以纯 Node 模式静默退出，
  与「启动干净」完全同形，故存活断言单独做、不因 stderr 空而判绿。
- **worktree 必须在 NTFS 上（本轮踩坑）**：首次建在 `F:\mp-worktrees`，写 JSON 报 `EISDIR`——F 盘是 **exFAT**，
  不支持硬链接，而原子写入走「临时文件 + 硬链接」。已按 R1-R5 用 `safe-worktree-remove.ps1` 清理并迁到 D 盘 NTFS。
- **零运行时行为改动**：未触碰 TTS / 渲染 / 生产驱动 / IPC；未做 F8 三维提示词与 F15 身份锚点强制（属批次二）。

# [未发布] docs(openspec): 归档 v2/v3/v4 并把 12 条频率契约并入主干规格（openspec-archive-frequency 第二批）

## 干了什么
- 三个 change 的 delta capability 目录名**收敛到主干真名** `publish-frequency-control`（原本 v2/v3/v4 各自叫
  `publish-frequency-policy-v2` / `-v3` / `publish-frequency-v4`，与主干无一对齐 ⇒ CLI 必然 fail-closed）。
- 主干 Requirement 计数 **10 → 15（v2 +5）→ 19（v3 +4）→ 22（v4 +3）**，每一步 `validate --strict` 都过。
- **按现状重写，不搬历史数字**：v2 删掉两条被后续版本推翻的 MODIFIED（20/10/3、平台档 2′），5 条 ADDED 补齐 v3–v5 的事实
  （`definitelyNotSent` / `submitUncertain` / `_disableRollbackForPlatform`、`MAX_DAILY_QUOTA` 严格大于最大默认、
  `DEFAULT_JITTER_RATIO` 回落出声、`checkBaselineStrength()`、紧急放行四态与 10′ 冷却、真实通道名 `publishFreq:emergencyRelease`）；
  v3 只重写「频率数值按档单一落点并可派生」（账号档现归逐平台表，`long > clip > short` 单调只对未偏离平台成立）并删两个过期 Scenario；
  v4 把无法应用的 MODIFIED 转写成 ADDED「回落基线的两维不弱于判据（间隔取上界、配额取下界）」。
- 归档前**逐格核 v2 的 44 项勾选**（只读代理 + 我抽样复核）：28 格补勾（每格带 `文件:行号`/符号名证据）、
  14 格判 PARTIAL、2 格判未做（4.2 校准脚本无测试无接线；7.3 视觉三处 0 命中）——留空但写明缺什么，不再靠沉默说谎。
  v3 两格交付项按 merge SHA `469cf7b52…` 补勾。

## 根因（QM-5）
- 与第一批同一条：**归档不在合并后收尾清单里** ⇒ delta 从未并入主干、capability 名漂移无人问、tasks 勾选表与事实漂移（v2 实测 18/44）。
- 复核修正了前置审计的两处偏差：它说"真残留只有 3 项"（实为 14 PARTIAL + 2 NOT_DONE，低估），且个别行号坐标错
  （`definitelyNotSent` 在 `publish-not-submitted.js` 不在 `task-queue-frequency.js`）⇒ 本批只采信可当场复现的**符号名**证据。

## 遗留
- `scripts/calibrate-publish-frequency.js` 无测试无 CI 接线（本批只写明不补）；v2 的 QM-4 视觉一格三处 0 命中；
  `task-queue.js` 注释自称"结构锁"名实不符（改注释属代码改动，不在 docs 批做）；
  `publish-frequency-unwired-surfaces` 仍未归档（与 v5 同指一个 capability，需一次覆盖排序判断）；归档积压依然无判据。

# [未发布] feat(collection): 采集页整体 UI/UE 统一与精致化（collection-page-ui-ue-refine）

用户真机走查反馈采集页「整体布局和细节元素和用户交互体验，视觉上都很散乱，不够统一和清晰，也不够精致高级」。
逐条取证定位到三层根因，本轮一次性收口：

- **六套按钮方言并存**：`cohere-btn-primary`（32px 药丸）/`cohere-btn-secondary`（幽灵文字）/`card-actions button`（药丸描边）/
  `zb-*`/`tag-*`/`library-filter-btn` 各一套。新增 `features/collection/collection-page.css` 规范层（+拆分产物
  `collection-page-legacy.css`），定义按钮三档 `col-btn--primary/secondary/danger/ghost`、输入控件一档 `col-field`、
  卡片两档 `col-panel`/`col-card`、徽标一档 `col-badge`、横幅一档 `col-banner`；既有类名保留（测试在用），
  视觉声明统一引用新变量组。`tokens.css` 新增 9 个 `--col-*` 槽（亮暗两档）。
- **两个死类被三处消费（本批最关键）**：`is-primary`（`CollectedResultsList.vue:99/100`）与 `class="primary"`
  （`Collection.vue:328`、`CollectionDraftsPanel.vue:56`）在**全仓 0 处样式定义** ⇒ 「创建草稿/发布是 primary、
  查看/视频创作为 secondary」这条分级在视觉上完全不成立（两者长得一模一样）；`collection-tab-badge`
  （两个页签组件在用）同样无定义 ⇒ 角标是裸文本。原有测试只断言 class 名存在、不断言它有样式，
  所以功能测试全绿也看不见。修法：死类清零 + 新增 `collection-page-css-contract.test.js` 的
  **「消费⇒有定义」**机械判据（枚举模板静态 class token，逐个在规范层找规则）。
- **页面级统一**：页头与内容区同底（原页头白、内容灰形成硬切）；页签 aria 补全（`aria-controls` + 内容容器
  `role="tabpanel"`）；快捷操作区 6 张平铺卡重排为「新建/草稿/素材来源」三组并**移除 emoji 图标**
  （✏️✧❓📰 跨平台字体渲染不一致，是「不高级」的直接来源之一）；文案库/结果卡/草稿箱卡操作分级统一落地；
  错误/进行中/警告三套横幅统一为 `.col-banner` 三档；页签角标 >99 截断为 `99+`。
- **硬编码 hex 收编（原门禁盲区）**：`QuickCollectPanel.vue` 11 处 + `WordCountRangeInput.vue` 1 处 +
  `Collection.vue` 1 处兜底 hex → 语义槽；hex 门禁 SCOPE 扩到 `QuickCollectPanel`/`QuickCollectCommandDialog`/
  `CollectionDraftsPanel`（此前不在任何扫描范围内 ⇒ 门禁照绿、代码照脏）。
- **文案迁 locale**：7 处裸中文字符串（副标题/placeholder/采集按钮/重试/结果标题/快捷卡标签/chip 行按钮）
  → `collection.*` key，zh/en 成对；CJK 基线 1374→1208（净减 166，零新增）。
- **删死文件**：`views/Collection.polish.css`（49 行全仓零 import，与 scoped 重复定义的亮色硬编码源头）。

**验证**：新增 2 个测试文件 48 例（CSS 契约 41 + 页面结构 7）；采集域+styles+components 全集
**1081/1081 全绿**；eslint 0 error；locale 三项 PASS（pair-base/keys/cjk）；`check-max-lines` PASS
（规范层超 500 行硬限 ⇒ 按门禁处方拆为两个文件，未挂账）；品牌残留 PASS。




# [未发布] fix(视频创作): MiniMax 克隆「套餐不支持」原样透传，不再误报「暂时不可用请重试」（s2v-clone-plan-unsupported）
# [未发布] fix(desktop): 流水线进度浮层阶段子进度条统一对齐（s2v-stage-bar-align）

- **动因与取证**：用户截图（红框标注）显示视频创作流水线进度浮层中「提示词优化」阶段的子进度条比其他阶段短。逐行像素扫描四个已完成阶段（条高 5px，行 y=235/376/518/661）：文案拆分/内容增强/AI 视频场景选择填充宽均为 **928px**（x=86..1018），提示词优化仅 **878px**（x=86..968），**短 50px**。
- **排除的三个假设都做了实测**：① 不是轨道长度不同（四条左端同为 x=86，stage-status 列左边界同为 x≈1019/1036）；② 不是 CSS 双来源冲突（`stage-progress.css` 与 `create-view.css` 同名 `.stage-sub-*`，但后者只给外层加 `display:flex; width:100%`，未动内层 bar，不改变条长）；③ 不是 optimize percent 偏小（`story2video-stages.js:2716` 完成时即发 `percent: 100`）。
- **根因**：`StageProgress.vue` 的 `stageProgressPercent()` 只在 `stage.progress.percent` 为合法有限数时返回值，否则返回 `null`，模板据此 `v-if` **整条不渲染**。optimize 的历史/续跑快照里 `stage.progress` 常只带 `messageKey/summaryKey/detail` 而不带 `percent`（`optimize_progress` 只驱动 detail 文案、不驱动条形），该阶段遂无子进度条，视觉上短一截。
- **修复**：`stageProgressPercent()` 增加完成态对齐补齐——`status === 'completed'` 且取不到合法 percent 时返回 `100`，使全部已完成阶段子进度条满格等长。`skipped` 不补（无进度语义，补 100% 即假完成）；`running/pending/failed/waiting` 不补，保持真实 percent；越界与非有限值仍不渲染。
- **回归测试**（TDD，RED 先行：未改实现时根因用例 `bar.exists()` 为 false）：新增 3 例锁契约——四完成阶段 `aria-valuenow` 全 100 且集合大小 1（等长）、optimize 缺 percent 补齐 100、running 保持 37% 不被抬到 100。
- **验证**：`video-creation/` 142 例 / `CreateView.test.js` 300 例 / `story2video-stages.test.js` 154 例全绿；eslint 两文件 rc=0；debt-budget / brand-residue / locale-sync 全 PASS；QM-4 视觉回归 19/20，唯一失败 `collection` 1.44% 经 **stash A/B 对照**确认与本次无关（两次运行差异图 SHA-256 完全相同）。
- **影响面**：复用 `StageProgress.vue` 的三处入口（CreateView / HotTopics 一键生成视频弹窗 / FilmAutoPanel）共用同一方法，一并获得对齐修复。纯渲染层变更，不触碰主进程阶段执行、IPC 契约与 `optimize_progress` 数据语义，无新增用户可见文案。

# [未发布] docs(prd): 新增「键盘可达与可访问名合同」一节（UX 审计 3.6 / 4.3 / 4.4 / 4.5 的产品口径）

- **焦点可见性**：写死显示项（2px 实线 + offset 2px、颜色只取 `--color-focus-ring`）与双档实测对比度（亮 6.05:1；暗 4.78:1 / 卡片底 4.30:1，并说明暗色沿用亮色值会掉到约 1.9:1）；写死"焦点规则必须显式把 `outline-*` 过渡归零"这一交互前提（`transition: all` 会让 Tab 后 0ms 读到过渡起点，实测 3px currentColor）。覆盖范围改为**逐变体类**，并记下理由：134 处按钮 class 只带变体类、基类规则零覆盖，"基类=公共形态"是心智模型不是事实。
- **可点元素键盘可达**：四件套（role/tabindex/Enter/Space 且 keydown 表达式与 click 逐字一致）；硬禁令"补了 `role="button"` 的元素不得有可见可聚焦后代"（leaf 角色会把子树打成 presentational，实测 3 处把容器内真按钮从 a11y 树上抹掉）；并要求行为测试配 `@click`-only 负控。
- **标签↔控件可访问名**：label 文本即控件名、禁止用 placeholder 承担名称；五条数据校验（DOM 事实判据、labelable 封闭清单、第三方转发面必须实测、id 生成优先级与禁 `Math.random()`、`aria-required` 必须落在控件上）。写清本批**不新增 locale 键**，关联属属性面改造、不引入新文案。
- **存量与节奏**：孤岛 label 逐文件基线 139 → 127（23 个文件）只能缩小；`UiField` 26 处待逐点绑定；「CLI」标签改名等待产品决策、不由实现侧改词。
- **验收锚点**：列出六处锁文件与用例数（12 / 13 / 7+3 / 20 / 3 / 6），并要求每条锁都做一次"写回被禁形态"的变异反证。纯文档，未改任何代码与门禁。


# [未发布] docs(agents): 增补三条门禁纪律与一条表单关联契约（无障碍批次的系统性收尾）

- **新增 QM-2 必检项「第三方组件的属性转发面必须实测，标签↔控件关联的判据只能取 DOM 事实」**：现场依据是本日两次实测——Element Plus 的 `ElInput` 会**整个丢弃 `id`**（根 div 与内层 input/textarea 三处全空），但会转发 `aria-labelledby`；本仓自研 `UiInput` 此前没有 `id` prop，导致 `Publish.vue:456` 的 `<label for="publish-tags">` 自写下之日起指向根 `div`，属规范级无效（labelable 只有 `button/input/meter/output/progress/select/textarea`，指到 div 不报错、不降级、也不回退到相邻文本）。规则要求关联类断言一律取 `control.labels` / `label.htmlFor`，宿主转发面 mount 一次实测并钉成契约锁，造 id 用 `useId()` 而**禁止 `Math.random()`**（同页撞车时 label 会指到别人的控件，比缺失更坏）。
- **新增纪律「禁令与存在性判据必须按语义位置切，不得按字符串出现切」**：同族错法一天内三次打红——注释里的 `<UiButton>` 被 `Publish.test.js` 的模板扫描当成一次用法（连带 QG Desktop Shards、QG Coverage 两个 required check 红）、注释里的 `Math.random()` 被结构锁当成违规、注释里的 `for="fa-script"` 被契约锁当成退回死关联。同条收进反向漏法：变异实测「只摘 `<input>` 的 `:id`、留着 `<textarea>` 的」时文件级存在性判据全绿（另一分支替它顶罪）⇒ 判据作用域必须等于风险的语法位置（逐标签遍历 + 标签数下界），并配「写回被禁形态必红 / 只出现在注释里必绿」两条对照。
- **新增纪律「计数型棘轮必须先认识同一合规目标的全部合法通道」**：把 EP 那条死 `for` 改成「label 带 `id` + 控件带 `aria-labelledby`」后，孤岛判据把它重新数成孤岛（存量 +1、棘轮红），即**判据会惩罚修得好的人**。正解是让扫描器认识替代通道，而不是改大基线；同时保留"上涨红、未登记新文件红、下降未销账红"三条。
- **本 PR 只写规则，不带门禁代码**：实现层的两把锁与孤岛基线在 `ux-audit-label-for` 分支上，等并发 PR #4034 的机制层合入后按互补面 reconcile 再走一次 PR。"规则先于门禁存在"的窗口是刻意登记的，不抢跑。
- 纯文档变更：`classify-docs-only` 判定与两口径 numstat 对账见 `openspec/records/agents-a11y-gate-rules.md`；未动 `.github/workflows/`、未动 `CI_IGNORED_PATHS`，不改任何"谁来守门"的机械判据。


## 问题
- 2026-10-19 真实事故：MiniMax 订阅套餐账号克隆音色被服务端拒绝（`model_provider_logs` id=10030：`your current token plan not support model, voice_clone`，latency 1125ms——请求真实到达、鉴权通过、参数合规）。adapter 把它误判为额度类（`token\s*plan` 被 isQuota 吃掉），service 折叠成 `VOICE_CLONE_PROVIDER_UNAVAILABLE`，用户看到「音色克隆服务暂时不可用，请稍后重试」——重试永不成功，误导用户反复尝试。

## 改动
- `provider-error.js`：新增 `PLAN_UNSUPPORTED` 错误码（category=config，retryable=false）。
- `minimax-tts.js`：`classifyBaseRespError` 增加 `isPlanUnsupported`（statusCode=2038 官方「语音克隆功能被禁用」短路 + `token plan not support` / `voice_clone ... forbidden|disabled|not support` / 中文「套餐不支持」族正则），**置于 isQuota 之前**，避免额度类误吃。
- `tts-voice-clone-service.js`：`cloneFailureFromAdapterError`——throw 与结构化 errorCode 两条路径统一：PLAN_UNSUPPORTED → `VOICE_CLONE_PLAN_UNSUPPORTED` + `data.detail`=供应商原话；其余保持 PROVIDER_UNAVAILABLE。点名还账文件零增长（等价折叠抵消）。
- 渲染层：`friendlyVoiceCatalogError` map + zh/en locale 新增 `VOICE_CLONE_PLAN_UNSUPPORTED`（zh 含「MiniMax 的音色复制需要另付费 9.9 元购买音色，不能直接使用订阅套餐」）。

## 验证
- 定向测试：18 文件 / 599 passed（adapter 3 例新用例：plan 归类 / 2038 归类 / balance 不误判为 plan；service 2 例：throw 透传 + 结构化透传且不落 registry；CreateView 映射 2 断言）。
- 门禁：eslint rc=0；tsc --noEmit rc=0；locale --keys/--cjk PASS；check-max-lines ✅（点名文件 1748=target 零增长）；check-unwired-tests OK；QM-1 electron-builder exit 0（读数见执行记录）。
- 执行记录：`openspec/records/fix-s2v-clone-plan-unsupported.md`。
## [2026-10-20] 视频任务编辑页：失败任务进入不再「无限加载后空白」

### 问题
历史记录页进入失败任务（无成片）的编辑页时：① 视频预览区持续显示加载态很久，最后空白；② 未生成的图片区先呈现「错误链接样式」，数秒后才显示「未生成」；③ 页面进入非常慢（169 段任务）。

### 根因
三个缺陷是同一条链路的三个表现：`ResultView.loadProject()` 对**全量 169 段**申请媒体 URL（每段 5 个媒体位 ≈ 845 次 `story2video:create-share-url` IPC），`loading` 要等它跑完才置 false；而失败任务 `videoPath` 为 null，`<video>` 因 `v-if="videoPath"` 根本不渲染，于是用户看到骨架挂很久后空白。`<img>` 无 `loading="lazy"`，169 张图同时发起请求，未完成时浏览器渲染破图。

### 改动
- **预览区三态**：新增 `resolveSegmentMediaPlan`，无 `videoPath` 时直接进入 `empty` 态——**不发起任何成片/旁白媒体 URL 申请**，改为渲染与 `<video>` 同构的占位区块（固定高度 + 标题 + 说明 + 「重新合成」行动位），两种终态页面高度一致，无布局跳变。无成片时也不再弹「预览缺失」提示（那是加载失败，不是没有成片）。
- **分段素材 URL 分批**：首屏只解析前 20 段（≈100 次 IPC，较 845 次降约 88%）；未进入渲染窗口的分段不提前取 URL。
- **追加式渲染窗口 + 哨兵**：新增 `resolveSegmentRenderWindow`，窗口恒从 0 开始、按 `renderedCount + 20` 增长（滑窗会让已渲染段从 DOM 消失，导致滚动高亮/refs/政策徽标错位）；列表尾哨兵进入视口（`rootMargin: 240px`）自动追加下一批，并保留「显示更多分段」手动兜底按钮。
- **图片懒加载**：分段图与素材槽图加 `loading="lazy" decoding="async"`，未入视口不请求；`@error` 兜底保留（清坏 URL + 标记素材位不可用，保留来源路径供恢复）。
- **focusScenes 点名段强制入首屏**：内容政策失败任务的定位场景即使落在窗口外也并入首屏，政策徽标与定位能力不因分批失效。
- **结构分层**（`ResultView.vue` 是 max-lines 点名还账对象、零增长容差）：新增 `composables/useResultPreviewMedia.js`（纯函数策略，21 条单测）、`video-creation/ResultSegmentCard.vue`（单个分段卡片）、`video-creation/ResultSegmentEditor.vue`（分段编辑区 + 窗口 + 哨兵）；宿主只留 props/emits 接线，**行数由 1860 降至 1741**。

### 验证
- 新增 28 条回归（`useResultPreviewMedia.test.js` 21 条 + `ResultView.test.js` 7 条行为用例），先红后绿：红的三种形态分别是「模块不存在」「哨兵点击后段数不增（滑窗缺陷）」「80 段任务的 focusScenes 49/73/74 全部不在前 20 段（政策徽标被分批破坏）」。
- 消费方并集 **577 passed / 0 failed**：ResultView 122、ResultView.model-info 32、story2video-ue-contract 5、views-deep/views-deep2/views-coverage/views-coverage2/CreateViewHistory 合计 76、CreateView + i18n + locales 合计 362。
- 本地门禁逐条 rc=0：max-lines（无新增超大文件，ResultView 低于点名目标）、unwired-tests（111 个测试文件）、locale-sync `--cjk`（无新增硬编码）与 `--pair-base`（zh/en 成对）、no-brand-residue、debt-budget、gate-record-debt；eslint 8 个改动文件 0 error 0 warning。
- 文档：`01-docs/PRD-S2V-RESULT-VIEW-PERF-2026-10-20.md`（含数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字全表 / 组件契约 / 验收标准 / 已知局限）、`openspec/records/s2v-result-view-perf.md`。
- **QM-6 审查修订（跨家族对抗审查，12 条 + D12 全覆盖）**：pre-commit 判定 `mode=dual`（变更 2051 行 > 200 行阈值），但评审后端 claude 对 2051 行 diff 输出 20392 字符被单次输出上限砍断、JSON 解析失败（重试一次仍失败）⇒ 按子代理降级规则改派独立 subagent 执行跨家族审查。**抓出并修掉 7 项真缺陷**：
  1. **A1（Critical）**：`ResultSegmentCard` 第一版用 `segmentDraft` 浅拷贝 + `watch(segment, deep)` 同步，而宿主 `refreshSegmentImageUrls()` 是**原地改** `segment.imageUrl/...`——宿主改自己 data 数组里的对象，卡片侧 deep watch 不触发、浅拷贝展开拿旧值 ⇒ 保存/重试/重新合成后显示旧图或空白；且 `v-model` 写在副本上、`saveSegments()` 读宿主对象 ⇒ **用户打的字存不进去**。改为 `draft` getter 直接返回 prop，加 3 条回归锁（`reactive()` 包裹才复现；普通对象不触发子组件重渲染会造假红）。
  2. **A6**：`loadNextSegmentBatch` 用 `from = segmentRenderCount`（初始 0）⇒ `slice(0,20)` **把已解析过 URL 的首批再解析一遍**。根因是窗口公式 `to = rendered + step` 与「已渲染数」语义不一致、三处各算一次步长；统一为 `to = min(total, rendered > 0 ? rendered : step)`，让 `renderWindow.to` 同时是「已渲染上界」与「下次追加起点」。
  3. **A7**：右侧「分段定位」跳到未渲染分段时**高亮跳了但视口纹丝不动**（`segmentItemRefs[index]` 为空 ⇒ 静默跳过）。169 段点第 150 段正是本 PR 核心场景。改为一步把窗口扩到覆盖目标（不逐批循环，避免串行十几次 IPC），只解析新增段，`$nextTick` 后滚动。
  4. **A3**：`onSegmentScroll` 把**稀疏 refs 数组**（点名段并入首屏后中间全是空洞）的 `length` 当连续下标上界、遇空洞 continue ⇒ 高亮落在「有 ref 的最大位次」而非用户实际看到的段。改 `Object.keys` 遍历实际挂上的 ref。
  5. **A12**：编辑器自持 `segmentRenderCount` 本地计数，而宿主「分段定位」也要改窗口 ⇒ **两份计数漂移**（宿主扩了窗口、编辑器按自己计数渲染 ⇒ 视口不动，正是 A7 的现象）。改为受控 prop `renderedCount`，单一真源在宿主。
  6. **A9**：「加载失败」与「任务本来没有成片」共用空态「没有可预览的视频」，用户关掉弹窗后会误以为任务本来就没视频——同一误导形态只修了一半。新增 `loadFailed` + 独立空态（标题 + 重试），locale 键 zh/en 成对。
  7. **A2**：写后刷新仍对全量 169 段跑一遍（上限 ~845 次 IPC）。缺省作用域改为 `renderedSegments`（已渲染段）；未渲染段不在 DOM、用户改不到，其 URL 等进窗口时再取。
  另**清理 8 处死代码**（A10）：`shouldRequestSegmentMedia`、`PREVIEW_LOADING_STATES`、`previewState`/`firstPaintMediaPaths`、`resolveSegmentMediaPlan` 的死参数、`segmentUrlBatchCursor`（三写零读）、编辑器孤儿 emit `clear-material-unavailable` + `voiceOptionIds`/`isSegmentBusy`、卡片孤儿 prop `voiceContext`。**`renderWindow` 反向保留**——现在有真实消费者（追加起点）。
  **两条被审查提出但经核实不成立**：D12「两组测试互斥」（子代理自陈读到的是中间版本；当前 `ResultSegmentCard.test.js:71` 与 `ResultView.test.js:2075` 断言一致）；B5「每段最多 4 个媒体位」（逐位核对 `refreshSegmentImageUrls` + `refreshSceneMaterialUrls` 共 **5 个条件位**，audio 有 `if (segment.audioPath)` 会发 IPC，845/100 的原始数字正确）。

### 已知局限
IPC 次数本身未降（本轮是「按需申请」，单段仍 5 次 IPC；服务端批量签 URL 需改 IPC 契约，记入 backlog）；窗口步长固定 20，未按视口高度动态估算；未做实机 wall-time 复测；QM-4 视觉回归因基线仓库级失效未跑（同 `result-view-back-btn-style` 结论）。

# [未发布] feat(story2video): 视频提示词中文翻译 + 提示词/翻译成对 + 分段编辑区默认折叠（s2v-video-prompt-translation）

- **补齐视频提示词中文翻译（用户诉求，附截图）**：成品编辑页此前只有图片提示词带中文翻译，视频提示词没有。根因是图片翻译链路（`translatePromptsForLocale` + compose 并行任务 + `promptTranslation` 落库）自 2026-08-12 建立，而 `videoPrompt` 是 2026-08-15 才新增的字段，其生成链路从未接入翻译。本次在 `regenerateScenePrompt kind=video` 成功后调用 LLM 生成译文并持久化到新字段 `videoPromptTranslation`（≤2000 字符）。
- **复用而非复制翻译实现**：新增 `translateVideoPromptForLocale`，内部复用 `translatePromptsForLocale` 的批量调用、严格 JSON 系统提示、markdown fence 剥离、平衡 JSON 提取、HTML/marker 包装防御与逐行兜底——不写第二份翻译实现（漂移风险）。fail-open：LLM 不可用/抛错/超时/非法内容 → `videoPromptTranslation=null`，**不影响 `videoPrompt` 本体与分段状态**；译文与原文相同视为未翻译（不展示冗余）；重写时**先清后写**，翻译失败不留上一轮陈旧译文。
- **`updateSegments` 不接收 `videoPromptTranslation`**：白名单外字段丢弃，防前端伪造译文。compose/草稿/`ensureProjectFromRun` 三条分段构造路径按稳定 source index 回填该字段（与 `videoPrompt` 同源治理），重新合成后译文不丢失。
- **提示词/翻译改为上下紧邻成对**：原实现把唯一翻译块放在「图片提示词 textarea + 视频提示词 textarea + 两枚重新生成按钮」之后，与它描述的提示词隔了一整个区块。现图片提示词下方紧邻图片翻译块、视频优化词下方紧邻视频翻译块，各带归属标签（「图片提示词中文翻译」/「视频提示词中文翻译」），弱化样式（左边框 + 次级底色 + 只读）与可编辑 textarea 形成层级差。
- **分段可编辑主体默认折叠**（内容过多的正解）：分段卡片默认紧凑态，只保留序号/状态/素材区概览；编辑主体按需展开，且**展开态互斥**（一次只编辑一个分段）。方案选型：左右分栏已否决（中英文都是长文本，各砍 50% 宽度导致英文滚 6-8 行、中文大量留白）；tooltip 已否决（长文本需静读，浮层易消失）；采用 Progressive Disclosure + 上下紧邻，与本项目既有 `QuickCollectPanel`/`BatchCollectPanel`/`FilmAutoPanel` 折叠实现同族。删除展开分段时自动收起，避免残留指向已删除 id 的展开态。
- **locales zh/en 成对新增 5 条**：`videoPromptTranslationLabelZh`/`videoPromptTranslationLabelOther`/`expandEditor`/`collapseEditor`（对齐 `#4064` 的 `promptTranslationLabelZh/Other` 两档口径）；`check-locale-sync --cjk` PASS（无新增硬编码中文）、`--keys` PASS。
- **测试**：`ResultSegmentCard.test.js` 新增 5 例（成对 DOM 顺序/占位/en 判据/折叠态只留素材区/展开态 `aria-expanded` + 上抛）、新建 `ResultSegmentEditor.test.js` 5 例（默认全折叠/只展开一个/互斥/幂等收起/删除展开分段清空状态）、`ResultView.test.js` 6 个既有用例补「先展开」步骤；主进程侧 `story2video-video-prompt-translation.test.js` 12 例 + `story2video-project-service.test.js` 123 例 + `story2video-stages.test.js` 161 例。回归 6 个套件 **436 例全绿**，`eslint --quiet` rc=0。
- **已知限制**：存量项目无 `videoPromptTranslation`，只在用户重新生成视频优化词后补齐第一份译文，未做批量回填；`uiLocale` 固化于任务创建时（与图片提示词翻译同源）；流水线自动路径未覆盖（若后续要在成片生成时同步产出，应扩展 `prompt_translations_pending` 机制而非复制逻辑）。详见 `01-docs/PRD-video-creation.md` §3.1.31。
- **落地位随 `#4064` 组件化调整**：分段编辑区已被 `#4064` 抽为 `ResultSegmentCard.vue` / `ResultSegmentEditor.vue`，本特性随之迁移（提示词成对渲染在卡片、展开态唯一真源在编辑器、宿主只留接线）；折叠范围收窄为**文本编辑主体**，缩略图与四素材槽保持可见。行为契约不变，详见 PRD §3.1.31 第 10) 小节。
# [未发布] feat(subtitle): 数字/单位完整性与双字搭配守卫 v1.4 —— 8 段复杂文案实测驱动的第二族坏切（subtitle-word-integrity）

- **动因与取证**：v1.3 合并后用 8 段不同风格文案（政治评论续篇/历史叙事/科技解说/口语短视频/生活叙事/无标点压力段×2）对真实引擎做三端对跑，暴露一族 v1.3 未覆盖的坏切。**A/B 反证**（关掉 phrase_boundary 输出逐字节不变）证实非 v1.3 引入：是 `no_cut_bigrams` 词表缺口 + 标点累积分支直切不经守卫的既有缺陷。实测证据：`风速每秒 8│米`、`套现约 3.2│亿元`、`提升了│60%`、`制程是│3 纳米`、`当│成`、`遗│忘`、`那│段`、`千│万人`。
- **`unit_guard`（确定性规则，非枚举）**：`word_split.unit_guard.units`（44 个量词/单位，最长优先）+ 两条 bind 判定——left_bind（左边数字串│右边单位开头，**数字串含中文数词**`一二三四五六七八九十百千万亿兆两零〇`，容忍尾部一个排版空格 `'8 米'`）；right_bind（向左跳空白/标点取引导字 c ∈ `是约到达了超足低高等` 且右侧以 ASCII 数字开头、中间无汉字）。**接入点两处**：`isSafeCutPosition` 第五条件 + **标点累积分支**（该分支此前直切不经守卫——`8│米` 正是空格切点，只改 findSafeCutPosition 拦不住）。TS/Python/JS 三端同构。
- **`no_cut_bigrams` +7，逐条带实测出处**：`当成`（A 例）、`万人`（G 例）、`遗忘`（G 例）、`那段`（G 例）、`仿佛`（E 例）、`亿元`/`纳米`（F/B 例，与 unit_guard 双登记是纵深防御——本表管短语内部任意位置，unit_guard 只管数字-单位接缝，职责注释已写进规则表防误删）。
- **对抗评审拦下 3 处真问题（claude 后端本轮可用，轮 1 真实跑出 8 条发现）**：① i1 Critical——数字判定若只认 ASCII，`一百五十│元` 中文数词同形坏切会漏 ⇒ 数字字符集扩中文数词并加向量；② 零误伤预检（i5，把口头承诺变机械读数）**当场否决 `飘地` 词条**——它命中既有 v1.3 向量 `qing_piao_piao` 的块间接缝，会改变已发布期望输出；③ i2 准入自洽——`测试/恐慌/看不见` 无实测出处，从本次移除记待补录。评审回应逐条落盘 `openspec/changes/subtitle-word-integrity/review-response.md`。
- **回归面（零误伤实证）**：既有 44 条共享向量 `expected_blocks` 零变化；金标重生成后 **169 块零变化**（`rulesLfSha256=75151bb8…` 已随 #3970 的对账锁同批登记，两仓 LF 归一化逐字节一致，跨仓对账 PASS）。
- **新增 7 条 `v1.4_word_integrity_*` 共享向量**（数字│单位 ×3 含中文数词压力例 + 双字搭配 ×3 + 万人 ×1，手工真值 + `short_block_exceptions` 显式声明）；TS 263 / JS 202 / Python 611 全绿；变异反证 M1（删 unit_guard ⇒ 2 红）/ M2（删 no_cut 新词条 ⇒ 1 红）各自指名变红；8 段文案三端对跑 8/8 逐字一致、7 类坏切实例 0 残留（用**当前源码重打的 esbuild 夹具**——旧夹具内嵌 v1.1 规则表，再次实证其"假锁"属性）。
- **如实记不修**：`老槐│树下`（处所短语开放集合，枚举不完备，待可观测性切片）；`先想三秒：│这钱花出去`（冒号尾块两块都完整，不是坏切）。
# [未发布] feat(gates): 跨仓 sidecar 对账锁 + Python 金标 + ops-center 能力声明互证（subtitle-sidecar-parity-lock）

- **锁文件自身的比较也必须走同一口径**（真实运行抓到的假红）：第一版用**原字节**比锁文件，四条数据哈希明明全等却稳定报「锁不一致」——两仓检出行为不同（mulpub 的 .gitattributes 是 	ext=auto，Windows 工作树 CRLF；sidecar 检出 LF），同一份登记表的原字节必然不同。教训不是「再小心」，而是**判据里只要有一处口径与其余部分不一致，它就会在最不该红的地方稳定假红、然后被当成噪声关掉**。现改为与数据同一口径（只抹平 CRLF），并补两条回归（同内容/不同行尾 ⇒ 不报；内容真不同 ⇒ 报）。
- **跨仓数据第一次有了机械判据**：新增 `packages/story2video-engine/tests/fixtures/sidecar-parity.lock.json`（与 smart-sentence-splitter 仓**逐字节相同**），登记规则表与共享向量的 **LF 归一化 sha256**；两仓各一条断言本地文件匹配登记值。此前这两份数据是两仓手工副本，**没有任何东西会告诉你「只改了一边」**——两仓单测各读自己仓的副本，全绿，而线上 8002 跑的是 sidecar 副本、本地降级路径跑的是 mulpub 副本。顺带把已漂的 `no_cut_bigrams` 尾 9 元素顺序对齐（集合相同；Python 侧是 `set` + 真值/最长匹配，读实现确认与顺序无关，且 sidecar 全量 `577 passed, 9 skipped`）。
- **口径选「LF 归一化字节哈希」而不是 JSON 语义比较**：语义比较放过键序/缩进/行尾；各语言自己做 canonical JSON 更糟——`json.dumps(sort_keys=True)` 与 `JSON.stringify` 在浮点、转义、非 ASCII 上不同，等于在判据里埋一个自己就会漂的组件。代价是数据文件任何格式差异都会红，那是有意的：跨语言场景下「格式不同但语义相同」就是漂移温床。
- **单仓锁缺的那一格由 `scripts/check-sidecar-parity.js` 补**：它同时读两个 checkout，比较「两个锁逐字相同 / 各自数据匹配自己的锁 / 跨仓数据哈希相同」。存在的理由是一条单仓判据**结构上看不见**的形态——A 仓把「数据+锁」一起更新（CI 全绿），B 仓还是旧的。该脚本**不挂 PR**（要 clone 另一个仓库，把第三方可用性变成 PR 红点只会让它被豁免），而是 `sidecar-parity.yml` 的 `schedule` + `workflow_dispatch`；**判据本身的检出能力**由 `scripts/check-sidecar-parity.test.js`（13 例，含 0/1/2 三档退出码与锁行尾口径）锁住，接在 `quality-gate.yml` 新增的 **Gate 12f**（changes job，每个 PR 都跑）——把「判据会跑」和「判据没坏」分成两条。
- **Python 金标对账（sidecar → TS / JS 各自直比，不靠传递）**：新增 `subtitle_parity_corpus.json`（18 例、**只有输入**）与 `subtitle_python_golden.json`（生成器产出，18 例 / 169 块）。分工必须写清否则会误用：**金标不是真值**，它回答「本地实现与线上 sidecar 是不是同一份行为」；「这样切对不对」仍由手工向量定义（向量测试明令禁止把实现输出写入向量）。三端一起漂时金标不红、手工向量红，二者互补。金标带 provenance（生成时的规则表/向量/**语料**三个哈希），改了任一方不重生成会红——这是设计意图的摩擦，不是误报。
- **生成器不接受命令行路径参数**（这条是被判据逼出来的，但结论是设计变对了）：首版写成 `--corpus/--out`，提交时 CCG 安全扫描器把「`Path(` 同行出现 `args`」判为**路径遍历高危并阻断提交**，而该扫描器**没有任何抑制机制**（源码核实：只有注释行跳过）。可以靠改名变量躲过那条正则，但那是「为通过判据而改代码」，与本案要建立的东西相反。正解是让脚本只读 `tests/vectors/` 下的固定输入、只写固定输出——一个只做这件事的脚本本来就不需要任意路径能力。复检 0 高危。
- **语料与金标也是跨仓副本，因此也进跨仓对账**：sidecar 侧不消费金标、mulpub 侧不看 sidecar，两者若漂了**单仓判据里没有一只眼睛能看见**（过期金标仍会被复制过去并通过对方的测试，只是它描述的是旧行为）。`check-sidecar-parity.js` 因此从比 2 条产物扩到比较**四份**（规则表 / 向量 / 语料 / 金标），缺一侧如实报「只在一侧存在」而不读成一致；sidecar 侧另加一条「金标 provenance 与本仓数据版本一致」的断言防过期。
- **ops-center 的「假锁」改诚实**：`prompt_eval_segmentation.py` 头部原写「完整移植桌面端 text-segmentation.ts」，实测**缺整个词边界子系统**（`good_lead`/`good_tail`/`semantic_lead`/`no_cut_bigrams`/`phrase_boundary` 全无），而它的 esbuild 对照测试**只在 `ops-center/**` 变更时触发**——改桌面端 TS 时那条对照一次都不跑。本次把声明改成如实的 `PORTED_SURFACE` / `NOT_PORTED_SURFACE` 两个常量，并加 3 条**声明与源码互相印证**的锁（未移植清单必须点名词边界子系统；源码里必须确实没有那些实现标识；只扫代码形态标识、不扫散文——docstring 里刻意写了这些名字用于说明缺口，裸词匹配会把说明本身判成实现）。
- **不加 `ops-center-ci.yml` 的触发路径**（有意）：该 job 已长期卡在 10 分钟超时临界（main 上最近 7 次有 3 次 cancelled），加触发只会加剧取消率；真问题是移植保真度而非触发频率。缺口如实记录，补偿是 `packages/story2video-engine` 侧的 TS↔Python 金标对账。
- **纠正我自己写错的 learnings**：原文「三个文件 + 一份共享数据 + 三份向量副本」三处都错——实现是 **4 份**（漏了 ops-center 的简化 Python）、数据是 **2 份**手工副本、向量是 **2 份**。另加两条 lesson（单仓锁看不见跨仓漂移；参考实现快照不是真值）。
- **零运行时行为改动**：本次全部是判据、注释与文档，切分逻辑一行未动；`sidecar-parity.lock.json` 缺失或 `phrase_boundary` 缺省时的 v1.2/v1.3 行为不变。
# [未发布] fix(a11y): 18 处非按钮可点元素补 role=button + tabindex + Enter/Space（阶段 4.4），并把"给容器加 role"的错误修法钉成判据（ux-audit-clickable-roles）

- **域先被自己的探针错过两次**：第一版按类名前缀猜"是不是按钮"，把 `<span class="ui-btn-spinner">`（aria-hidden 装饰节点）算成缺口；同时把 `UiButton`/`el-button`/`router-link` 这些**内部渲染原生 button/a 的组件**算成缺口 —— 150 个"缺口"里 109 个是假阳性。改成按「这个 class 挂在什么元素上」分类后，真实域收到 **31 个站点**。
- **本批改了 18 处**（标签芯片、阶段节点、卡片/缩略图、日历日、模板项、平台条目、评论平台条、take 卡、时间轴行、上传区、能力芯片、URL 移除按钮等）：统一加 `role="button" tabindex="0" @keydown.enter.prevent/@keydown.space.prevent`，且**表达式逐字镜像 @click**（漏一个修饰键就是行为分裂，由锁断言这条）。
- **⛔ 最值钱的一条：给容器加 `role="button"` 会让子树变成 presentational。** 我第一版把 `role=button` 加到了 CreateView 两个上传区和 CreatorMonitor 的列表项上，而它们内部有**可见**的「移除 / 立即检测 / 取关 / 取消关注」按钮 —— 那不是修无障碍，是把 5 个真控件从 a11y 树上抹掉。判据固化为「已补 role 的元素不得有可见可聚焦后代」，并用变异 K3 把**我撤销掉的那个错误形态**重新造出来验证它真的会变红。这 3 处改为登记欠账（正解是把动作提为区内显式 `<button>`）。
- **13 处登记为欠账，逐条给原因**：`<th>` 排序表头 ×4（加 role 会剥夺单元格语义，正解是 th 内放 button）、`<h3>` 折叠头 ×1（失去 heading 跳读）、遮罩 `@click.self` 关闭 ×6（键盘等价物是 Esc，加 role 会把整个对话框子树压掉）、上传区 ×2。清单**只能缩小**，新缺口未登记即红、键漂移即红。
- **证据**：`src/views|components|features` 全量 `3529 passed | 2 skipped`（218 files）；新锁 `clickable-roles.contract.test.js` 7 例 + 行为锁 `clickable-roles.behavior.test.js` 3 例（Enter/Space 真触发同一 emit，并含一条"只有 @click 时 Enter 必须不产生事件"的负控，防两条行为用例变成假证）；5 道变异 K1–K5 全部指名变红、`RESTORED_OK=true`；`pnpm run build:vue` rc=0（21 个模板全部编译通过）。
- **顺带发现（未在本批修，已登记）**：`PodcastScriptEntry.vue` 的遮罩用的是 `@click` 而不是 `@click.self`（其余四例都是 `.self`）——点击对话框内部会冒泡触发取消。这是行为缺陷，不属键盘可达域，已写进执行记录留给浮层批次。
- 无新增 locale 键；role/tabindex 不改变任何计算样式，像素基线不随之变化。

# [未发布] fix(a11y): 「更多」菜单补 roving tabindex + 方向键 + Esc + 焦点归还（UX 审计 4.5 / audit-31）

- **修什么**：侧边栏「更多」容器早就声明了 `role="menu"` / `role="menuitem"`，但没有任何键盘行为 ——
  展开后焦点掉回 `document.body`，方向键无效，Esc 不收尾，Tab 走开后菜单还挂着。
  **给了角色却不给该角色的操作方式，比不给角色更坏**：读屏会 announce「菜单」并据此期待方向键可用。
  这是人工读模板才发现的（审计条目 audit-31），此前不在任何机械判据的视野内。

- **交互口径**：停在「更多」上按 ↓ 展开并把焦点放进菜单；↑/↓ 在**可见项之间循环**（末位再按回第一项）；
  Home/End 直达首末项；Esc 收起并**把焦点归还触发器**；Tab 收起但不抢焦点、不 preventDefault；
  鼠标点某项后该项即成 roving 位，随后方向键从**它**继续；焦点离开菜单且未落在触发器上则自动收起。
  展开起点取「当前路由命中项」而非第 0 项（`initialMoreIndex`），运营隐藏某项后索引不漂移（`visibleMoreIndexes`）。

- **实现层硬约束（踩过的坑）**：元素表必须是**普通数组** —— 写成 `ref([])` 并在模板 `:ref` 回调里赋新数组会
  形成 render → ref 回调 → 改状态 → 再 render 的自循环，组件立刻抛 `Maximum recursive updates exceeded in component <MpSidebar>`。
  另：`<router-link>` 的模板 ref 拿到的是**组件实例**，可直接 `focus()` 的是它渲染的 `<a>`，统一走 `focusableOf()`。

- **验证**：`vitest run src/layouts` → 49 passed / 5 files（其中新增 `MpSidebar.more-keyboard.test.js` 13 条，
  夹具路由全部由渲染结果反推，不手抄菜单配置）；变异反证 7 条（退回 `tabindex="0"` / 摘 `@focus` roving 迁移 /
  回绕改夹住 / Esc 不归还焦点 / 起点写死 0 / 摘 `aria-controls` / focusout 不豁免触发器）**各红在指名用例**，
  控制跑 rc=0、还原后逐字节相同。**两条方法论收获**：① 反证报 MISSED 时先问"我的断言有没有覆盖那条边"，
  不是"这处代码不重要"（MK-2 正是这样发现判据的洞）；② 变异驱动必须自证探针活着 ——
  v1 用了 vitest 4 已移除的 `--reporter=basic`，每跑都是 Startup Error rc=1，把 7 条「一条都没跑」报成 7 条 CAUGHT。

- **刻意没做**：`sidebar.cloudPublish` 的标签「CLI」不改成业务语义名（属产品命名决定，zh/en 现均为 `CLI`，待口径后走成对 locales 小 PR）；13 项仍扁平不分组（动它会把选中态、运营配置主键与像素基线一起牵进来）。

- 涉及文件：`apps/desktop/src/layouts/MpSidebar.vue`、`apps/desktop/src/layouts/MpSidebar.more-keyboard.test.js`（新）、
  `openspec/records/ux-audit-more-keyboard.md`（新）、`01-docs/UX-AUDIT-2026-10-17.md`（audit-31 就地指针 + 4.5 行状态）。

# [未发布] fix(story2video): 克隆样本魔数嗅探 —— 「改名容器」在克隆入口拦截（s2v-clone-sample-sniff）

- **事故**：任务 `mvf29iv8_cgll`（2026-10-19 17:37，story2video-compose，14 场景）在 `generate_assets` 整阶段失败：图片 14/14 成功，TTS 0/14 —— 13 个场景 MiMo 返回 `Param Incorrect`、1 个叠加 429 限流。根因是用户克隆音色的样本文件**扩展名 `.mp3`、真实容器是 MP4/AAC**（魔数 `ftypmp42`，ffprobe 判定 `mov,mp4,m4a` + `aac`）。
- **根因链**：`tts-voice-clone-service.js` 的 `_prepareOneSample` 只按扩展名定 `contentType`（`.mp3` → `audio/mpeg`，引入自 68b890039，2026-08-04）；合成时 `asset-generator` 把样本转 `data:audio/mpeg;base64,…` 放进 `audio.voice`，克隆服务端按真实容器解码、发现声明 MIME 与容器不符即拒绝。这是 `2026-08-23-fix-mimo-tts-param-incorrect`（预置音色默认值 `default`→`mimo_default`）之后同错误码的第二种成因，两者互相独立。
- **修法（黑名单式嗅探）**：`_prepareOneSample` 读取 buffer 后新增 `sniffSampleContainerMismatch`——只拦**可可靠识别的「容器错名」**（.mp3 内容为 ftyp/RIFF-WAVE/OggS/fLaC、.wav/.m4a 内容为 ID3 或 MPEG 帧同步等互串形态），命中抛 `VOICE_CLONE_SAMPLE_EXTENSION_UNSUPPORTED`，在克隆入口前置拒绝并复用既有本地化文案。未知/占位字节维持旧行为放行，由 ffprobe 时长探测 fail-closed 兜底——白名单式强校验会误伤既有测试夹具与罕见封装，黑名单恰好覆盖事故形态且零误伤。
- **回归锁**：`tts-voice-clone-service.test.js` 新增 2 例——「改名容器」三形态拒绝（ftypmp42 假 MP3、ID3 假 M4A、RIFF 假 M4A，均不调 adapter/不写 registry）与「真实容器不误伤」（ID3 头 MP3、870B 双静音帧裸 MP3、RIFF/WAVE 全部正常克隆通过）。
- **文件**：`apps/desktop/electron/services/tts-voice-clone-service.js`、`tts-voice-clone-service.test.js`。回归：clone 域 155 例全绿（service 50 + integrity 8 + provider 122 内 asset/mimo 部分 + catalog/service 33）。


# [未发布] docs(audit): 更正 audit-60 的 harm 陈述 —— ElMessage 根节点其实已带 role="alert"，阶段 4.6 因此收窄（ux-audit-toast-a11y-correction）

- **动工前核了库的真实产物**（本机 element-plus 2.14.2）：`message.vue` 编译产物里 `role` 出现 1 次、值为 `"alert"`、挂在 `.el-message` 根 div 的属性表上；5 个 message 实现文件里 `aria-` 计数**全为 0**；`MessageHandler` 只有 `close()`，**没有 DOM 句柄**。
- **于是原 finding 的结论断了一半**：「250 次 ElMessage 作为主要反馈通道，读屏用户听不到成功/失败」**不成立** —— `role="alert"` 是隐式 `aria-live="assertive"`，每条都会被播报。按字面去「补 role」会造出**第二个播报源**（同一双次朗读），比现状更差。
- **成立的是另一半**：不分类型统一 assertive ⇒ **礼貌级无法区分**（成功/信息本该 polite 不打断），批量发布连发多条会**连续打断**。这是真实残留问题，但解法是**限频/合并与按类型分流**，不是加 role。
- **4.6 改成**：不在应用侧新增 live region；不给 `.el-message` 加 `aria-hidden`（框内有可聚焦的关闭按钮，隐藏容器会连带破坏焦点可达性）；限频/分组收在 `showToast` 单点化（PR #3996）的那一个出口；若确要按类型分礼貌级，先做真机（NVDA/Narrator）取证再决定，不得凭规范推断直接改 DOM。取证前，现状按**已接受**处理，不是待修的沉默缺陷。
- **方法论（写进审计稿文末《第三轮更正》）**：审计里任何 `X 计数很低 ⇒ 用户得不到 Y` 的句子，动工前必须先回答**「还有哪条通道在承载 Y」**（含依赖库与宿主默认行为）。这是 AGENTS「宿主 API 字段归属必须先核实」的第二落点：第一次用它挡住了读不存在的 `getVisibilityState`，这次用它挡住了一处会加倍播报的"修复"。

# [未发布] feat(gates): UX 审计阶段 5.3/5.4 两条新门禁 —— 未接线组件与死观测字段必须被机械检出（ux-audit-phase34）
- **修什么**：审计 §1 的核心结论「机制在、最后一公里没接」里的两族形状，此前**没有任何东西在检测**：
  ① 组件写好、props 接口定好、**全仓零引用**（audit-6/audit-66 四例：AnnouncementBanner / TrialBanner /
  LoadingState / StaggeredList）；② store 字段**有写无读**（`lastEventAt` 写 4 读 0；本轮又抓到
  `backlot.js#lastApprovalDismissed`）—— 即本仓记作「装饰性链路」的那一类。两族在人工审查里都不可见，
  原因相同：**它们各自的测试全绿**（组件测试自己 import 并挂载它，store 测试自己断言写入后的值），
  所以「有测试」在这两类上根本不是证据。
- **新增判据**：`scripts/check-ui-wired.js`（`apps/desktop/src` 生产代码面里声明 props 且零引用的 `.vue` ⇒ 红）
  + `scripts/check-field-consumed.js`（store 里 `ref`/`shallowRef` 有赋值左值写入、却无任何读位置与跨文件消费 ⇒ 红）。
  四条口径决定判据有没有牙：① 搜索前**剥整行注释**（TrialBanner 的唯一命中就是一句注释，不剥即漏判）；
  ② **测试面不算消费者**（不排即 110 个组件全被自己的用例"引用"，判据恒不成立）；
  ③ store 自己的 `return { X }` 清单行不算消费（那只是暴露）；
  ④ `{ X: alias } = storeToRefs(store)` 这种**带冒号的解构必须算消费** —— 判据第一版在这里加了
  `(?\!\s*:)` lookahead，当场把 `currentBoard` 判成死字段（假阳性），已改正判据并回归锁化；
  同批还有两条假阳性被逐条 grep 核实后修掉（`dashboardUrls` / `qrCodePlatforms` 的读在本文件 getter 里
  ⇒ 读判据必须同时覆盖本文件读位置）。**处置方式是修判据，不是把误报从清单里删掉。**
- **反失明与棘轮**：两条判据每次打印 `域 / 候选 / 命中 / 登记` 现场读数；空域、store 数为 0、
  扫描根缺失、文件读不到一律走 **rc=2**（与"发现违规"的 1 分档）—— 把工具的失明读成通过是本仓
  「装饰性门禁」的同型。两份欠账清单（`ui-wired-debt.json` 6 条 / `field-consumed-debt.json` 1 条）
  只可缩小、条目必须带 reason、命中数必须等于登记数；「清空清单」与「删掉某条登记」都当场红并被点名。
- **判据的牙住在装配层（本轮最贵的一条方法论）**：上述 ①②③④ 都不在纯函数里，而在 `main()` 的取数过程中
  ⇒ 只测纯函数的自测对它们**结构性免疫**。为此给判据开 `--scan-root=` / `--debt=` 注入口，
  自测用 `os.tmpdir()` 下的 fixture 树**整跑 `main()`**（「注释-only」与「测试-only」两种假引用必须都判死、
  真实使用不得判死）。四条变异反证逐条实跑变红、还原后 md5 逐字节 IDENTICAL（`uw=49bfaf42 / fc=3f8a2aa1`）：
  A 摘 `stripComments` / B 取消测试面排除 / C 把 store 自身源码算进跨文件消费 / D 退回被禁的 lookahead。
  A 与 B 落在同一条 fixture 用例的**不同断言**上（A 让 CommentOnly 逃检、B 让 TestOnly 逃检），C 与 D 红集互不相同。
- **接线与防再犯**：本体 + 自测接进 `quality-gate.yml` **Gate 2b**（该步骤整体 `shell: bash`，任一非零即中止；
  Gate 3 默认 pwsh 且只有最后一条命令的 `$LASTEXITCODE` 决定成败 ⇒ 接进去等于新造一条装饰门禁，理由写进 workflow 注释）。
  `.gitignore` 一次补齐 4 条显式反选（第 106 行 `scripts/*.js` 会把新脚本静默忽略，同 #3011 家族：
  本地在盘跑得通、CI 上 Cannot find module）。`check-workflow-structure` violations=0、
  `check-step-failfast` 39 步全 OK、`workflow-contract.test.js` 43/43、`check-unwired-tests` 域内 110 文件全接线、
  `check-max-lines` / `check-doc-abs-paths` / `check-no-brand-residue` / `check-gate-record-debt` / `openspec-sync-check` 全 PASS；
  两条自测 `node --test` 分别 10/10 与 8/8。
- **基线不"顺手清理"**：6 条未接线组件与 1 条死字段全部带 reason 登记，**本批一律不处置** ——
  删除不可逆，而「是否仍要该 UI」属产品/IA 决策；`AccountGroupManager.vue` / `PlatformAccountGroup.vue`
  的零引用是 origin/main 的 S1a 重构**取代而未删**造成的，判定取代关系本身要人拍板；
  `lastApprovalDismissed` 是**功能缺陷候选**（写了它却无人读 ⇒ dismiss 实际不抑制任何东西，
  症状可能是审批提醒反复出现），按 QM-5 五步留作后续 Bug 单，不与门禁批混做（同一次提交改两个变量会让归因失效）。
- **文档**：`openspec/changes/ux-audit-implement-phase5/`（proposal + tasks + 新增能力
  `desktop-ui-wired-gates` 3 条 Requirement / 10 个 Scenario）、执行记录 `openspec/records/ux-audit-phase34.md`
  （域测量读数、四条口径的失败形态、假阳性归因、变异表、QM-1/QM-4 不适用的理由、QM-6 未跑的如实登记）。
### 同 PR 续做：QG Visual 的通过路径被一个清理动作判了红（Gate 7 退出码收敛）
- **现场（判据取产物）**：本 PR 的 `QG Visual` 报红，而该步骤日志末行是 `[GATE-7] All visual tests passed`，
  读数 `pixel=0 views=0 views-supplement=0 dark=0 workflows=0 workflows-supplement=0` —— 六套全 0。
- **根因**：Gate 7 的四条 `exit` 分支各管一种失败，**通过路径没有任何 exit**；GitHub 的 pwsh wrapper 以
  `$LASTEXITCODE` 收尾，而本步骤 `finally` 里清理 dev server 的 `taskkill /PID ... /T /F` 在进程已退出时
  返回非零 ⇒ 守门步骤的成败由**清理动作**决定。这是"装饰性门禁"的反向形态：不是恒绿，而是恒不可信。
- **修法**：判定值单点初始化 `$gateVerdict = 0`，四条分支改为 if/elseif 单链、各自只赋码
  （优先级逐字不变：就绪 3 > 像素 `$pixelExit` > 校验型 1 > agent `$judgeExit`），出口收敛为一处
  `exit $gateVerdict`，通过文案之后补显式 `exit 0`。`$darkExit` 与各套件退出码仍是**留痕**，未收紧也未放松。
- **新锁 + 三条反证**：`workflow-contract.test.js` 新增一条（判定值单点初始化 / 四格码值齐全 / 唯一出口排在
  通过文案之前 / `exit 0` 排在其后 / 四条分支不得退回各自 exit）；M1 摘掉 `exit 0`、M2 把码 3 改成 1、
  M3 把 agent 分支退回 `exit $judgeExit`，三条**各自指名变红**，跑后 workflow 与测试两文件 md5 逐字节还原。
- **另配一把 pwsh 真跑 oracle**（本机 pwsh 7，判定块逐字从真实 workflow 提取、不抄第二份）：六格优先级表
  （含"`$checksFailSuites = $null` 不得炸"）、"摘掉 `exit 0` ⇒ 被污染值 7 判红"的缺陷复现档、以及
  `[Parser]::ParseFile` 语法档，全部通过。
- **改判据时两处自伤，按本仓规矩记下来**：① 我新写的注释里原样引用了 `All visual tests passed` 这句裸短语，
  而两条既有顺序锁用 `indexOf('All visual tests passed')` 定位 —— 注释顶掉了可执行行，锁当场变红；正解是把
  锚点取成 `Write-Host "[GATE-7] All visual tests passed"` 这一整行，并把我注释里的字样改掉（双保险）。
  ② 为"两种形状都合法"把 `indexOf('if ($pixelExit -ne 0)')` 放宽成裸短语 `search(/\$pixelExit -ne 0/)` 后，
  正文里一处散文注释（"经 $pixelExit -ne 0 拦住"）同样把锚点顶掉 —— **放宽形状不得顺手放弃行锚定**，
  最终形态是行锚定的 `(?:\} elseif|if) \(`。存在性/顺序锁的锚点必须指向可执行语句，注释里的同名引用一律算污染。
- **同一次改动里我自己制造的第二个事故，也记下来**：给 CHANGELOG 插本小节时，脚本用
  `src.includes('\r\n') ? '\r\n' : '\n'` 探测"多数派行尾"后整文件回写，把这份 `i/lf w/crlf` 的工作副本
  从 44 个 CR 改写为 22546 个 CR —— 正是 AGENTS.md「行尾不是噪声」那条点名的旧错法（本仓 2026-10-05 已实测
  这三份历史 CRLF 文档的 blob 现为纯 LF，磁盘 CRLF 只是 checkout 转换）。正解：`split('\n')` 后**逐行保留
  各自结尾**，插入行取锚点那一行的结尾，改完用 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 对账。
# [未发布] feat(rewrite): 改写引擎输入/输出字数上限放开到 50000 + 输出截断可见化（rewrite-limits-50000）

## 问题

- 输入 6000 码点上限把知乎长文 / 视频转写常态化拒之门外（#3979 只能用「截取前 6000 字」缓解，尾部丢失）。
- 输出侧 `_postProcess` 按 字数区间.max > 策略.maxLength > 3000 砍尾时**完全静默**——用户拿到不完整的稿子且不知道，比 `TOO_LONG` 更隐蔽。
- 大多数 LLM adapter 不传 `max_tokens` 走服务商默认（OpenAI 4096），输出在模型默认值处被截断且无法归因。

## 改动

- 输入上限 6000 → **50000**（`MAX_INPUT_CHARS`），输出显式区间合法域 → **50000**（新增 `MAX_OUTPUT_CHARS`）；无显式区间的兜底 3000 与策略级 800/1500/2000/3000 **保持不变**（用户显式区间优先级高于策略上限）。
- 上限单一真源：渲染层 `rewrite-engine-limits.js` 同值常量 + 结构锁读引擎源码比对（输入/输出两把锁，判据必须消费常量，`len > 6000` / `range.max <= 6000` 字面量回潮即红）。
- **输出截断可见化**：`_postProcess` 返回 `{text, truncatedAt}`，`rewrite()` 结果新增 `outputTruncated` / `outputLength`；改写页结果卡顶部暖橙横幅（`data-testid="rewrite-output-truncated"`）提示实际字数与上限，zh/en 成对文案。
- 主进程桥接 `max_tokens: 64000`（CJK 1 字 ≈ 1~1.6 token × 倍余量；Anthropic 必填字段原默认 4096 同步受益）。
- UI 字数区间校验（`useWordCountValidation`）与 `deriveWordCountRange` 自适应上界改读常量：12000 字原文自适应 max = 14400，不再被压回 6000。
- locale 同步：placeholder / 越界错误文案 / 截断横幅（zh/en）。

## 验证

- 引擎 219 passed（新增 L1/L2/L3 截断可见化 + W3/W8 重写为 50000 口径 + 6001 走通正控）；渲染层定向：limits 10 + defaults 19 + error 8 + user-facing-error 32 + Collection 输入上限 6 + RewriteView 100 + Collection 回归 125 全绿。
- 变异面：`rewrite-engine-limits.test.js` 结构锁×2（改一边必红）；横幅出现/缺省两态断言。
- `build:vue` rc=0；`electron-builder --dir` rc=0；asar 实测含 `MAX_INPUT_CHARS = 50000` / `MAX_OUTPUT_CHARS = 50000` / `outputTruncated`。
- 文档：`01-docs/PRD-REWRITE-LIMITS-50000-2026-10-19.md`（限额体系/数据校验/交互/显示项/流程全量）。

# [未发布] feat(侧栏): 折叠按钮改为可表意的语义化图标并补齐可发现性（sidebar-toggle-ux）

- **用户反馈是「样式太不明显，根本让人注意不到」，不是功能坏了**：折叠功能本身在 PR #3916 已正确（切换/持久化/跨进程同步/多窗口广播），缺陷全在呈现层。三处独立成因：**①图形不表意** —— 双向 chevron（「<>」）在通行图标语义里读作「代码」或「展开更多」，与「收起侧栏」无关；**②两态共用同一图形** —— 收起/展开只靠颜色区分（primary vs secondary），是单通道编码，对色觉障碍用户完全失效，普通用户也无法从图标判断当前处于哪个状态；**③常态几乎不可见** —— 图标色对 TabBar 背景亮色实测 4.40:1（差 0.1 不达 WCAG AA 4.5:1），边框与底色都是 `transparent`。
- **三处初始假设在实装前被实测推翻，方案据此改写**（详见 `openspec/changes/sidebar-toggle-ux/proposal.md`）：(a) 原估「现状约 3:1」偏高 —— 实测亮色 4.40:1、暗色 7.79:1，问题只在亮色；(b) 原计划的「用 `--color-border` 做常态边框」实测对 TabBar 背景只有 **1.04:1**，**等于不存在**，这正是现状看不见的技术原因，故改用品牌色倾向的半透明描边；(c) 原计划的「用 `--color-bg-card` 做底色」实测 1.11:1，无区分度，只作辅助。⇒ 主判据定为「图形对比度 + 图形语义化」，边框降级为辅助暗示。
- **状态差异进形状而非颜色**：图标改为「左侧面板矩形 + 方向箭头」——展开态**实心面板 + 左向箭头**，收起态**虚线面板 + 右向箭头**。两态外轮廓完全一致（只换内部填充），用户感知到的是「同一按钮换了内部状态」而不是「换了个东西」；与颜色（`--color-primary` vs `--color-text-primary`）构成冗余编码，任一通道失效都可读。
- **收起态新增 2px 品牌色恢复锚点**：侧栏收起后按钮落在窗口最左侧、是**唯一**的恢复入口，而原实现仅靠颜色从 primary 变 secondary 几乎不可察觉。用 `position: absolute` 伪元素实现，不占布局、32×28 命中区不变；实测对比度亮 6.18:1 / 暗 5.13:1，均过非文本 UI 组件的 3:1 要求。
- **图标对比度提升 3.6 倍**：`--color-text-secondary` → `--color-text-primary`，亮色 4.40:1 → **15.99:1**、暗色 7.79:1 → **12.80:1**；按钮 30×28 → 32×28、图标 16 → 18px。`margin` 逐字保留，`TabBar(36) + NavBar(40) = BROWSER_CHROME_TOP(76)` 契约未动。
- **面板几何按截图观感修正过一次**：初版面板 5×12 配左箭头，数据全绿但**看图**发现它读作媒体播放器的 `|◀`（「跳到开头」）；加宽到 6.5×11、圆角 1→1.8 后才读作「面板」。**计算样式全对不等于观感正确**，这一步只能靠人眼看图发现，已写入记录。
- **测试从「锚实现细节」改为「锚退化形态」**：原用例断言「svg 有 2 条 path」，把双 chevron 这个具体实现写成了契约 ⇒ 样式层怎么改都不会红。新的 `SidebarToggleIcon.test.js`（6 例）改用**图形签名**比较两态（对几何微调不敏感、对「退化成同图形换色」敏感），`SidebarToggleButton.test.js` 从 5 例扩到 13 例，新增常态图标色/非透明边框且**不得用 `--color-border`**/非透明底色/尺寸/收起态竖条三要素/hover-focus-reduced-motion 不回退。先红 `10 failed / 9 passed`，后绿 `23 passed`。
- **视觉证据用「局部截图 + 计算样式」，但基线必须重建——这一条我初判错了，被 CI 当场纠正**：像素门禁 `PIXEL_THRESHOLD=0.06`（整图 6%）下按钮仅占 1280×720 的 **0.1%**，实测亮 20/20 + 暗 20/20 全通过，我据此写下「基线零变化、无需重建」。**CI 推翻它**：红的是 **`Gate 7b - Baseline freshness`**，它判「基线 == 同一次 CI 渲染，**0 px**」，报 `检查 43 张 / 违规 38 张`。**两个判据度量的是不同命题**——6% 管"有没有大面积变化"，0 px 管"基线是否与当前渲染对得上"；我的改动让按钮区域必然变了，所以前者过、后者不过。**修法也不是 `update-baseline`**：那条走像素套渲染，而 Gate 7b 优先取 views 套件渲染，两套在同一 run 内实测差几百像素（dashboard 350 px / collection 67870 px，确定性非噪声），用它更新会让基线立刻再次脱离（`check-baseline-freshness.js` 文件头记的 #2623 正是这段历史）；`test-runner.js:561` 的 `UPDATE_BASELINE` 又只在基线缺失时创建。**实际做法**：下载同一次 CI run 的渲染产物（artifact `quality-gate-visual-reports`）覆盖基线 ⇒ **36 张更新 / 2 张未变 / 5 张无渲染**（3 张是 autonomous-loop 专属的 `KNOWN_UNCOVERED`，2 张本次未产图、Gate 7b 在 partial 下记 skipped 放行）。可见性证据仍另用真实浏览器 `getComputedStyle` 逐项前后对比（含 `::before` 伪元素计算值，jsdom 取不到）+ 明暗双主题局部放大截图。
- 未改任何主进程代码（`apps/desktop/electron/**` 零改动）⇒ QM-1 按口径不适用；现场记 `openspec/records/sidebar-toggle-ux.md`。

# [未发布] feat(update): 强制升级安全机制 —— 重大版本硬阻断弹窗 + 服务端版本门 426（forced-update-gate）

- **要解决的问题**：已发布版本出现重大问题/漏洞并已发新版时，需要一个"必须升级才能继续使用"的机制：用户打开或登录应用时弹出不可关闭的弹窗、仅"立即升级"一个按钮；并防止破解者 patch 掉弹窗绕过。原链路（update_policy min_version 提示 / force_version 自动下载 / gray_ratio 灰度）三个语义都不是"不升级不能用"。
- **双层架构（grilling Q1-Q12 全部按推荐定案）**：①劝导层 = 桌面主进程 `services/enforce-gate.js` 状态机（evaluate 纯函数 + 72h 离线宽限 + `userData/enforce-gate-state.json` tmp+rename 原子缓存 + 时钟回拨 >24h WARN 兜底）+ 独立置顶无边框弹窗（close 拦截、主窗隐藏、视图机 blocking/downloading/error/verify-failed、复用 `installNow()` 三态幂等与新增 `onProgress` 订阅器）；②执法层 = ops-center `services/version_gate.py`：三个桌面端真实消费的机器端点（model-presets/catalog、runtime/ack、telemetry/degradation）在 `enforce_enabled=1` 且 `X-Client-Version` 低于 `enforce_min_version` 时返回 **426 Upgrade Required**。**机器通道缺头/坏头 fail-closed 也按旧版拒**——存量旧客户端不发新头正是执法对象；豁免面仅 Cookie 会话（运营后台）与 bootstrap（策略通道自锁排除）。事实修正：原推荐挂 `/api/v1/member/*`，探查证实该 router 仅 admin 手动开通端点、桌面端不调用（桌面会员 API 走外部服务 auth.iart.work），故修正挂点。
- **检查时机三处**（Q5）：启动水合（含离线缓存回放）+ 登录成功（`auth-service.onAuthenticated` → `syncNow`）+ 每 6h 轮询（unref）。策略缺失/`enforce_enabled=false` → 零行为变化（默认部署安全）；阻断判定不受 gray_ratio 灰度影响（全员一致）。
- **防破解定位如实声明**：exe 未签名（sign:false），客户端判定是劝导层、服务端 426 是执法层，破解者 patch 掉弹窗后机器端点仍拒绝；fuses/代码签名/下载镜像列后续路线图（design §7）。存量更老版本无 gate 能力，随下一次常规更新下发（Q12）。
- **回归锁**：pytest 16 例（upsert 校验 5 + 版本门 8 + 接线断言 + `_cmp_version` 语义）+ `auth_surface` 清单重生成（157 路由，`enforce_version_gate` 登记 `version-gate` 语义）；vitest 32 例（evaluate 状态机 8 + 72h 宽限边界 6（71.9h/72.1h/回拨）+ 窗口管理层 6 + 契约锁 12——四条接线钩子缺一即红）；相邻回归 auto-updater/ops-center-sync/window 176 例全绿。locale 走主进程字典 `enforce-gate-text.js`（zh/en 键集合一致性锁；渲染端 src 零改动、不受 CJK 基线约束）。管理页 UpdatePolicy.vue 新增阻断卡片（启用前二次确认 + 400 文案透出）。验证全程记 `openspec/records/forced-update-gate.md`，规格 `openspec/changes/forced-update-gate/`，PRD `01-docs/PRD-FORCED-UPDATE-GATE-2026-10-19.md`。
# [未发布] fix(封面裁剪): 接缝从未产出宽高，cover:crop 自 #1174 起恒返回「图片尺寸无效」（cover-crop-license-bugs）

- **原发缺陷不是回归**：`readImageAsDataUrl()` 的成功分支只返回 `{dataUrl,sizeBytes}`，**从来没有**返回过
  `width/height`，而 `cropImageFile()` 把 `read.width / read.height` 喂给 `normalizeRect()` ——
  `Number(undefined) || 0` 得 0 ⇒ 每一次裁剪都走 `图片尺寸无效`。取证两条一起做才算归因成立：
  `git log --diff-filter=A -- cover-cropper.js` 唯一命中 `f9d1343bd`（PR #1174，2026-08-27），
  而 `git log -S'width: size.width' -- 同一文件` **零命中** ⇒ 该字段从未存在过，不是"被谁删了"。存续 53 天。
- **用户读到的是我们的失效模式，不是他的图片坏了**：`图片尺寸无效` 这句文案描述的对象被搞错了——
  尺寸不是图片的属性没读出来，是**我们的解析器没把尺寸交出去**。修法是补一个零依赖的字节头解析器
  （新 `packages/shared-utils/src/image-size.js`，PNG IHDR / JPEG **按段结构** / WebP VP8·VP8L·VP8X），
  并把失败原因分成 `EMPTY / TOO_SHORT / UNRECOGNIZED` 三种可区分读数；
  **解析不出返回 `null` 而不是 `{width:0}`** —— 0 会被上游同一把判据读成"尺寸无效"，
  等于把「工具不认识」伪装成「用户的文件坏了」，正是原 Bug 的形状。
- **同一条链上还有第二处缺陷，被第一处挡在下游所以从未显形**：`pickJpegQuality` 是同步函数，
  而它唯一的真实消费者传进来的编码器包的是 `webContents.executeJavaScript` ⇒ 返回 Promise。
  `promise.length` 是 undefined、`undefined <= maxBytes` 恒 false，二分一路退到最低质量，
  最后 `fs.writeFileSync(path, picked.buffer)` 收到一个 Promise 而抛 `ERR_INVALID_ARG_TYPE`。
  **只修第一处会把用户从「图片尺寸无效」推进一个没人读过的 TypeError**，所以两处同批修。
- **为什么四层门禁全绿**：`normalizeRect` 的单测里宽高是**测试自己传的 1920/1080**；
  `cropImageFile` 只测了「文件不存在」这条早退分支；`pickJpegQuality` 的三条夹具一律返回 Buffer。
  三层各自正确，**A 产出对象 → B 消费字段**这条缝没有任何用例穿过 —— 这是本仓
  「注册≠注入≠生效」家族在**函数接缝**上的落点：字段同名、签名对得上，人眼也看不出接缝为空。
- **JPEG 判据必须按容器走，不能扫字节**：EXIF（APP1）里可以塞一张缩略图，而缩略图自己就带 SOF0 且
  出现在主图 SOF **之前**；朴素扫描会把 160×120 当主图尺寸，裁剪框被一个不存在的边界夹住 ⇒
  **静默裁错而不是报错**。实现按段长度整段跳过 APPn，并有一条专门的负控用例钉住（M4 退回朴素扫描即红）。
- **不用 sharp**：它不在 `apps/desktop` 的 dependencies 里（只在 `.cover-rasterize-worker.js` 以传递依赖被用），
  为几个字节的头加一条生产依赖边要付打包体积与「生产依赖闭包」门禁的连锁。
- **回归保护 17 例 + 五条反证**：真实文件夹具的真值来自**当场实测的两把独立尺子**
  （System.Drawing 与 sharp 对 PNG 512×904、JPEG 1024×576 读数逐字一致）；
  WebP 512×286 / 512×219 **只有 sharp 一把**（本机 System.Drawing 无 webp 编解码器），
  单尺子在列、不假装双尺子，另用逐字节手写的规范夹具覆盖 VP8L/VP8X 这两条真文件覆盖不到的分支。
  另有一条「两张不同尺寸的图必须给出不同读数」——夹具若对所有输入同形，
  「按输入区分」这一整类缺陷对它结构性免疫。反证 M1–M5 各自指名变红、红集互不相同，
  跑后实现文件 md5 逐字节还原。
- **QM-1 全通过**：`build:dir` rc=0；`scripts/qm1-scheduled-publish-verify.cjs` 四段全 PASS，
  打包产物内 `readImageSize` 对三张真图给出 512×904 / 1024×576 / 512×286，8 秒存活且 **stderr 长度=0**
  （三层判据的第③层），asar 清单 15061 条带规模下界断言（防"解析退化成空集合 ⇒ 零缺失读成通过"）。
- **驱动与夹具自己的四个坑，一并记进 BUGFIX 文档**：`pnpm` 是 `.CMD` shim，`execFileSync` 不走 shell 会 ENOENT
  而 `e.status` 是 undefined ⇒ 会被读成"红了但一条 FAIL 都没解析到"；vitest 在被捕获的子进程里仍然上色，
  `FAIL\s+path` 必须**先剥 ANSI**；正则 `\S*(…\.test\.js)` 的贪婪前缀会把路径吞成只剩 `r.test.js` 的尾巴；
  JPEG 段长度字段**含其自身 2 字节**，第一版夹具写成 payload 长度，判据当场把自己的夹具判红 ——
  夹具不合法时的"解析失败"读起来和"判据坏了"一模一样。
- 全过程与完整契约（数据校验 / 流程 / 交互 / 显示项 / 提示文字逐条含新增与退役）见
  `01-docs/BUGFIX-COVER-CROP-SIZE-SEAM-2026-10-19.md`；执行记录见 `openspec/records/cover-crop-license-bugs.md`。
  QM-6 双模型外部评审**未执行**（本机无可用通道，pre-commit 亦如实打印跳过），不得读成"已外部复核"。


# [未发布] fix(播客): 音色来源标注只给 ②③ 出声，闭集外取值不伪造来源并出声（podcast-voice-origin-tristate）

- **`originLabel` 原先是一张表兼两件事，于是三档全出声**：`ORIGIN_KEYS` 同时回答「有哪些档」（闭集）与「哪些档要出声」（标注资格），而 PRD §8.2.9 判据 2 要的是后者——① 频道自己填的东西不需要再被界面告诉一遍来源。现拆成 `ORIGIN_KEYS`（闭集）+ `ANNOTATED_ORIGINS`（白名单），判据三段：无 origin → 空、闭集外 → `console.warn` + 空（**不得兜底成"取自频道"，那是伪造来源**）、非白名单 → 空。
- **那个 span 当初没有 `data-testid`，所以落地时一条断言都没写过它**：`PodcastScriptEntry.test.js` 里 `PLAN_OK` 只喂过 `preference` 一档，且只断言三段音色含 `prov_x`——「三档全出声」与「只有该出声的档出声」在那套夹具下**完全同形**，这是判据 2 能静默缺失一整个 PR 的原因。补齐 4 条：②③ 各一条正向（断言真实 locale 值而不是键名）、`origin=channel` 一条「标注不出现但**三段照常显示**」、闭集外一条「不出现 + 不兜底 + warn 恰好一次」。
- **闭集外那条排障日志走 ASCII**：首版写成中文，被本机按 CI 清单点名跑的 `check-locale-sync.js --cjk` 逐行点名判红；正解不是 `--update-baseline`（那是把自己新增那一格改成契约），也不是塞进 `locales` 造一对界面永不消费的死键。
- **五条变异全部指名红**：M1（白名单放进 `channel`）与 M2（清空白名单）**红集不同**——这是"两轴真分开"的证据，若仍是一张表两条变异会打在同一格；M3（摘 warn）与 M4（兜底成频道文案）**红集重合**（同一条用例的两个方向），如实写成"不是两道独立的闸"；M5（撤标注时把三段一起撤掉）红在第二组断言上，这条变异的存在理由就是判据 2 常被写过头。**末态 17 passed**；现场记 `openspec/records/podcast-voice-origin-tristate.md`。
- **`tasks 4.5b②` 记的是一个产品裁决而不是实现欠账**：频道 `voiceRef` 只有读侧没有写侧，回退链第 ① 档恒为空；写侧需要频道页的音色录入控件，而 §8.2.9「故意不做」第二条禁的是「全局默认音色选择器」（那东西在本仓不存在），与频道级 `voiceRef` 不是同一件事——但 PRD 从未写过这个控件的字段、交互与文案，按「先文档再代码」不临场发明。另拆 `4.5b③`：视频出期浮层 `PodcastEpisodeEntry.vue` 至今 `voice|origin` 命中 0，§8.2.9 原定落点那半未做。

# [未发布] docs(openspec): 归档 normalize-debt-ledger-entry-shape —— 主规格拿到「登记项只准承载原因」这条需求（archive-debt-ledger-shape）
- **归档落点**：`openspec/changes/normalize-debt-ledger-entry-shape/` 移入 `openspec/changes/archive/2026-10-19-normalize-debt-ledger-entry-shape/`，主规格 `openspec/specs/quality-gate-execution-record/spec.md` 的 Requirement 由 3 条增至 4 条；新增块 **36 行 / 5 个 Scenario**，与 change 的 delta **逐行全等**（一次性驱动从两侧各取该块比对，任一行不等即抛错并打印首个差异）。
- **为什么不联动 vendored 契约镜像**：镜像锁 `scripts/quality-rhythm-spec-mirror.test.js` 的比对目标写死是 `openspec/specs/openspec-integration/spec.md`，本刀动的是另一个 capability ⇒ 不联动。不靠记忆答题：归档前后各跑一次，两次均 **8 passed / 0 failed**，主规格与镜像的 Requirement 计数两侧均 **13** 未变。
- **`openspec validate --all --strict` 做真 A/B**（在同一份 `origin/main` 上另建 detached 工作树跑基线，而不是拿历史数字对比）：归档前 **223 items / 201 passed / 22 failed** → 归档后 **222 / 200 / 22**，离开 changes 域的恰是本刀这 1 项，失败集逐条不变。
- **Purpose 占位没有新增**：`TBD - created by archiving…` 只在归档器**新建** spec 文件时才写；本刀目标 spec 已存在，实测归档后该文件 `TBD` 计数为 **0**，`check-spec-purpose.js` 前后均「扫描 154 份主规格、违规 0」。
- **两条正规隔离入口本刀都被别人的现场挡住**：`start-mp-task.ps1` 因标准根之外注册着 2 个 worktree 判 `ok:false`（`clean/hooks/writeGuard` 全绿），`session-init.sh` 因共享根有 7 项他人未跟踪文件而拒绝。纯文档改刀按既有纪律走 `%TEMP%` 下的 detached 工作树出口，共享根全程停在 `main` 未动；这三条机器卫生事实已如实上报，不代删。

# [未发布] feat(视频创作): 移除流水线详情页与结果页的「返回」按钮——顶部导航与历史记录 tab 已承接（remove-video-back-btn）

- **动因（用户实测反馈）**：视频创作流水线（详情页、结果页）的「← 返回」按钮与既有的页面内导航重复——顶部 ←/→ 浏览箭头、三个视图 tab、左侧菜单都在，多一个冗余返回反而占位。要求按图删除。
- **删除面（两页各一）**：`CreateView.vue` 流水线详情态的 `.back-btn`（唯一调用者 `goToHistory()` 一并下线，避免留死方法）；`ResultView.vue` 视频预览页的 `.back-to-list`（`goBackToHistory()` 同步删除）。`PromptEvalView`、`HotTopics` 的返回按钮属其它模块，不动。
- **连带的去重逻辑解除**：`create-view.css` 原有一行「详情态隐藏顶部导航箭头」——其存在理由是「详情页已有 .back-btn 提供返回语义，箭头与之重复」。按钮删除后前提失效，该隐藏规则一并移除，详情态现在可见 ←/→ 浏览箭头；`.back-btn` 三行样式与 reduced-motion 引用清干净（最后一个使用者已消失）。`backToHistory` locale key（zh/en 成对）下线。
- **返回语义的承接（完整性自查）**：详情态离开途径有三条——顶部 ← 箭头（viewHistory，对已入栈的 film-engineering 路径有效）、三个视图 tab 恒可见（点「历史记录」即经 `switchView` → `detachPipelineView` 清态回历史）、左侧菜单。结果页经浏览器/应用级导航或「去创作」「重新创作」按钮返回。没有留下任何只进不出的死态。
- **回归锁 2 条**：CreateView 详情态「不渲染 .back-btn + 历史 tab 仍可点离」；ResultView「按钮与 goBackToHistory 均不存在」。先红后绿（改前 2 failed / 改后 415 passed 全绿）。
- **QM-4 视觉（含一次流程纠偏，如实留痕）**：首轮用本机 `PIXEL_ONLY + UPDATE_BASELINE` 重捕了 4 张基线——这违反 QM-4 第 7 条「本机重捕产物不得提交」，CI Gate 7b 两轮点名 `create-result` 亮/暗确定性漂移（亮 150 px / 暗 8292 px）当场抓住。正解照 #3916/#3951 先例：从 CI `quality-gate-visual-reports` artifact 取同源渲染重建这两张（重建后与 CI round1/round2 双轮渲染均 **0 px**）；`create-story2video-detail` 亮/暗两张实测与 CI 渲染逐像素相等（0 px），保留。另一处误判一并修正：`collection` 本机 1.44% 失败不是「他人 PR 的既有漂移」——CI 上它两轮干净，那 1.44% 是**本机渲染环境 vs CI 渲染**的系统性差异，恰是 Gate 7b 存在的理由。QM-1 打包 rc=0，asar 产物逐符号确认 `goToHistory`/`goBackToHistory`/`backToHistory`/`.back-btn` 零残留。

# [未发布] fix(播客): 出期音频对象键随期变化，修掉同频道第二期原地覆盖第一期（podcast-audio-key-per-episode）
- **用户可见症状**：同一个播客频道连发两期，第二期 PUT 把第一期的音频**原地覆盖**了——两次发布都报成功、日志零异常，而订阅端旧期 `<item>` 的 enclosure 指向的直链现在播的是新期的声音。RSS 里两期都在、音频只有一份。
- **根因（第一性引入点 `46736edf5`，PR #3302，2026-10-11）**：当时为"临时产物归拢"定了两个名字——目录 `runDir = <tmpRoot>/episode-<runId>` 与文件基名 `outBase = <runDir>/episode`。**目录带 runId、文件不带**；而下游 `publishAudio` 拼的对象键是 `<prefix>/audio/<channelId>/<basename>.<ext>`，`runDir` 那一层在进 key 时被 `path.basename` 整个丢掉 ⇒ 同频道每一期都算出同一个键 `episode.mp3`。跨频道由 `channelId` 挡住，跨期没人挡。存续 8 天。
- **这条不是"没想到"，是自家写下的判据只跑通了一半**：`publishAudio` 头注释原文就写着「key 必须带 channelId，两期写进同一层＝后一次发布静默覆盖前一期」——实现挡住了跨频道那一半，跨期那一半没接。修法因此是把这句判据补全（`channelId` 挡跨频道、`stem` 挡跨期，两个方向是同一条不变式），而不是新加一条规则。
- **为什么四层门禁都没拦住**：①单测层 `podcast-hosting-audio.test.js:51` 断言的是 `toContain('/audio/ch_aaaaaaaaaaaa/')`——**前缀断言对"末段恒为常量"完全免疫**（前缀对、文件名错也照绿）；同域另有一条整键断言 `toContain('/audio/ch_abcd1234/ep001.mp3')` 看着是对的，但它是**测试自己把 stem 喂给被测函数**的——生产链那个恒定基名从没进入这条用例的作用域，所以"断言写全了"在这里照样抓不到；②集成层每条用例只发一期，缺的不是输入维度而是**实体维度**；③产物层键冲突语义只在真 OSS 才有，本机零出站纪律看不到 PUT 落点；④#3302 的 QM-6 盯的是持锁/取消/降级，对象键唯一性不在其清单。
- **修复取最小落点**：`outBase = <runDir>/episode-<runId>`——键的身份跟着这一次发起走。同一次发起重发仍是同一个键（重试不该新开对象）；**不取标题当身份**，标题是用户可改的显示量，拿它当身份会让"改标题再发一期"凭空新开对象，而真正该分开的两期反而可能撞。`publishAudio` 本身不改：它按调用方给的 stem 建键是对的，错在上层没给随期变化的量。
- **回归保护 2 条行为锁 + 1 道变异**：视频链与文本链各一条「同频道两期不得写进同一个音频对象键」，并同时断言 `stem` 含本次 `runId`；两条都**先见证红**（改前 `expected 'episode' not to be 'episode'`）。变异把 `outBase` 退回固定基名 ⇒ `collected=53 failed=2`，红的恰好这两条新锁、零旁路红。驱动第一版把过滤器写成只匹配「对象键」三字，而第二条锁的标题里没有这个词，于是 CAUGHT 被误报成 CHECK——**驱动的过滤器也是探针，写窄了就是自盲**，现按两条标题分别命中并要求红集恰为这两条。
- **顺带记一条"同形不同义"，防止下一个会话顺手统一**：feed 的键固定成 `feed.xml` 是**对的**（一个频道一份 feed，本来就该被覆盖），音频固定成 `episode.mp3` 是**错的**（一期一份）。判据不是"键要不要唯一"，而是"这一段区分的是谁"。
- **系统性预防落进 AGENTS.md QM-2**：新增一条——凡"身份由多个字段拼成的外部键"（对象键、缓存键、文件名、幂等指纹），必须有一条「两个不同实体 ⇒ 两个不同键」的行为锁，且**禁止只用前缀 `toContain` 断言**。这是「文本结构断言」那条在**对象键**上的落点。
- **验证**：消费者并集（6 个测试文件）在最终树全跑 **114 passed**——`podcast-episode-host` 53、`podcast-hosting-service` 30、`podcast-hosting-audio-key` 11、`podcast-hosting-audio` 7、`podcast-episode-ipc` 6、`podcast-script-ipc` 7；QM-1 按三层判据重取（打包产物归属自证 = 包内 blob 与工作树逐字节相同，另带两个我没改动的同域文件作对照组），ESLint/Gate 7 四档、`check-max-lines`、`check-gate-record-debt`、`check-record-qm5-rows`、`check-doc-abs-paths`、`check-pr-exec-record --mode=enforce` 均 rc=0；QM-6 判定档位为 `single`，**未调用外部模型**，不得读成"已双模型复核"。全过程记 `openspec/records/podcast-audio-key-per-episode.md`。
# [未发布] fix(gate): 欠账账本拒收「会自己腐化的第二份事实」—— 登记项只留原因字符串（normalize-debt-ledger-entry-shape）
- **动因是当场量出来的两处腐烂**：`scripts/gate-record-debt-ledger.json` 的 23 条登记项有两种值形态（14 字符串 / 9 对象 `{reason,status,line}`）。逐条核对载体现状后：`line` **9/9 全部指不到自己的 `远程同步` 行**（3 条越界/指空，6 条指到别的 QM 行），`status` **已有 1 条说谎**（登记 `PENDING`，载体是 `执行中`）。而 `loadLedger` 只取 `reason`，全仓无任何 `entry.status` / `entry.line` 读取 —— 即"读它的人拿不到真值，不读它的人以为它是真的"。
- **为什么必然腐化**：`.quality-gates.md` 是置顶追加型台账，每合并一次块整体下移，行号指针结构上不可能长期正确；`status` 则是判据本来就会从载体测出来的量的第二份拷贝。两份都会漂，漂移方向是"下一个会话把它当坐标用"。
- **删字段而不是补校验**（design D2）：给 `line` 加"仍指向该行"的校验会当场红 9 条，而那 9 条账该由作者本人取证销账、不该由本刀代改别人的记录；删字段零信息损失（消费者为零），并把这类指针永久逐出数据面。
- **判据侧同时从宽容读改成 fail-closed**：`loadLedger` 不再"是对象就取 reason"，非字符串值**当场抛错并点名是哪个键**；空原因仍按旧口径抛错，两条判据不得互相掩盖。宽容读等于允许这个形状再生。
- **迁移只解包，不动语义**：9 条对象塌成各自的 `reason`；当场对账——键数 23→23、键序与键内容逐字相等、原因文本逐字相等、判据读数不变（仍打印「已登记欠账 23 条」，rc=0）。不销任何一笔账、不改 `.quality-gates.md` 任何一行、不动 carrier-freeze 基线。
- **回归锁 112 例全绿（77→108→112）**：新增 4 条（拒收对象并点名键 / 空原因旧判据不被挤掉 / 真仓形状锁含"清空账本不得读成合规"的下界 / 账本文件名在判据里只允许一处）。**变异反证 M1–M5 全部指名变红**，红集互不相同；M5（迁移漏一条）实测抓在真仓形状锁上；跑后判据/测试/账本三文件 md5 与跑前逐一相等。
- **我自己上一轮的错判，按本仓规矩记下来**：我曾断言"判据读不到 `status`，六成欠账状态只活在散文里"——**没读 `loadLedger` 就下结论**。实际它两种形态都读得动（只取 reason），真实缺陷相反：那两个字段无人消费且已在静默腐化。结论形状从"补齐读取"翻成"删掉字段 + 拒收"，代价是小刀方向整个换掉；凡"某字段读不到/没人用"这类断言，必须先读消费者再开口。
# [未发布] docs(播客): 出期崩溃对账按顺序先落合同——spec 第 14 条 Requirement + 4 个 Scenario（podcast-crash-reconcile-spec）
- **只写合同、不写实现，而且是规定的顺序**：`tasks 3.6b②` 与 PRD §13 第 13 条都明文写着「落地顺序不得反：先在 spec delta 加 Requirement（现 13 条无一涉及对账），再落跨重启凭据 → `channel:get` 投影 → 频道页横幅 + zh/en 键」。本刀收在第一步，`3.6b②` **保持未勾**，PRD 那条也补了"不得因合同已写而改判"。
- **写合同的输入全部当场量**：忙标记是模块级 `Map`（`podcast-channel-locks.js:121`），`:91-92` 的注释写着「崩溃随进程消失，**残留由启动对账接管（只提示不自动修复）**」——它把"启动对账"当成已存在的东西来陈述，而 `publishInFlight` 在代码里**命中 0**（`git grep -c` 对 `apps/desktop/electron`+`packages` = 0 行，命中只落在 `.adversarial/`、`.ccg/` 产物）。**没有任何既有状态可扫** ⇒ 合同只能写成"链进入时留一份跨重启凭据"，而不是"启动时扫一遍"。另确认 `episodes.json` 只在链末尾写（`podcast-channel-service.js:40`）⇒ 用结果文件反推在途态正是本条要消灭的黑洞。
- **两条写进合同的取舍（不是实现细节，后来者不得顺手改）**：① **凭据写入失败 ⇒ fail-closed 拒绝发起**——与 AGENTS「进度事件是旁路、发送失败不得冒泡」**刻意相反**，理由是进度丢了只影响观感、凭据丢了下次启动就无从对账，做成静默旁路会把"磁盘满"变成"发布照常成功但中间态永远不可知"；② **对账只报告、绝不自动重发**——`meta.guid` 至今没有任何一层传过（`podcast-rss.js:238` 令 guid 回落成音频 URL ⇒ 重复发布的产物是**第二条 item**），所以重发只能是用户显式发起，身份来源待 `tasks 5.1b③`。这条同时把两刀之间的**依赖方向**钉死：3.6b② 不许靠"自动重发"实现，否则会把一个还没定的问题变成事故。
- **投影复用既有读侧**：走 `channel:get` 已有的 `feedSync` 通道（`ipc-handlers/podcast.js:185` → `PodcastHostingCard.vue:45-47,95-104`），Requirement 明文 MUST NOT 为对账新造第三条状态源——同一份"上次发布怎么了"有两个真源时，界面必然读到过期那一个。
- 四个 Scenario：强杀后如实报告（且对账路径**零出站**）/ 正常收尾后重启不得出现横幅（凭据文件不存在也不报错）/ 凭据写不进去就不发起（返回带领域码的失败、忙标记照常释放）/ 对账不把"重发"当修复（入口走正常链、新 `runId`，文案不得声称"已自动恢复"）。
- **本刀没做的五项**点名留档，防止被"合同已写"读成"事已办"：跨重启凭据文件与写入/收尾时机、`channel:get` 的 `interrupted` 字段、频道页横幅与 `podcast.episode.*` zh/en 键、强杀再启动的真机复现、"凭据写失败"那条领域码。
- 规格面读数：spec delta 的 `### Requirement` 计数 13 → **14**。零运行时代码 ⇒ QM-1 / QM-4 / TDD 不触发，QM-6 走 docs-only 通道且**未调用外部模型**。三处补丁都由"行尾均匀 + 锚点恰命中 1 + `CR==LF` + 单行替换不改 CR 数"驱动落地，两口径 `--numstat` 逐文件相等（spec 30/0、tasks 1/0、PRD 1/1）。全过程记 `openspec/records/podcast-crash-reconcile-spec.md`。
# [未发布] fix(collect): 一键改写对超长正文截取前 6000 字并明确提示；引擎业务错误不再退化成「AI 改写失败」（fix-collect-rewrite-too-long）
## 问题
- 用户实测：采集页输入知乎回答链接
  （`https://www.zhihu.com/question/715577762/answer/2095239383058329672`）点「一键改写」，
  采集成功后弹「AI 改写失败」，无任何具体原因。
- 证据链：采集正文 6766 码点 > 改写引擎 6000 码点硬上限
  （`packages/rewrite-engine/src/rewrite-engine-core.js` 的 `_validate`）⇒ 引擎返回
  `TOO_LONG`；该时段 `model_provider_logs` 无记录（LLM 未被调用，失败在入口校验）；
  采集页漏斗把 IPC 信封 `{code:0,data:{success:false,error,errorCode}}` 原样交给
  `formatUserError`，后者只读顶层 `errorCode/message` ⇒ 具体原因丢失、只剩兜底文案。
  对照样本：同链路 5899 字文章 8 分钟前改写成功。
- 第一性引入点：#3915 把采集页 stealth 分支的改写从 Python 聚合层切到桌面引擎时，
  错误字段位置从「平铺」变成「嵌在 data 里」，消费点未同步归一化。
## 改动
- 新增 `apps/desktop/src/utils/rewrite-engine-limits.js`：6000 码点上限（与引擎常量结构锁）、
  `prepareRewriteInput` 按码点截断（不劈开代理对）。
- 采集页 `rewriteViaEngine`：超长截取前 6000 码点继续改写 + `collection.rewriteTruncated`
  提示；采集原文保持不变（视频转写 / stealth 自动 / 聚合回退 / 手动改写四个调用点共用漏斗）。
- 新增 `apps/desktop/src/utils/rewrite-engine-error.js`：把引擎业务错误归一化到顶层
  `errorCode/message/params`，并映射稳定文案码（`TOO_LONG` / `SENSITIVE_CONTENT` 新增 zh/en
  文案；`EMPTY_RESULT` / `LLM_ERROR` / `NO_LLM_CLIENT` / `EMPTY_CONTENT` 复用既有码）。
- 引擎侧把 6000 提为具名常量 `MAX_INPUT_CHARS`（行为不变），供渲染层结构锁对齐。
## 验证
- `apps/desktop` 定向：`rewrite-engine-limits` 9 + `rewrite-engine-error` 8 +
  `user-facing-error` 32 + `Collection.rewrite-input-limit` 5 = 54 passed；
  `Collection.test.js` + `rewrite-lineage.test.js` = 129 passed；
  `packages/rewrite-engine` = 194 passed。
- 变异反证：禁用截断 ⇒ 1 例红；回退「原样透传信封」⇒ 2 例红。
- `build:vue` rc=0；locale pair/keys rc=0；max-lines rc=0；unwired-tests rc=0。