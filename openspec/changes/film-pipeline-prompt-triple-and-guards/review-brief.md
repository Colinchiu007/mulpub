# 影视工程流水线 v2 · 评审简报（决策层）

预计改动 ~2200 行（含测试与文档），运行时源码 ~820 行，6 个 PR。
**边界**：只动 ①影视工程「自动」标签 ②视频创作「提示词优化」阶段（stage `optimize`）。画布 / 快速渲染 / 历史记录 / 项目案例**只允许只读接线**。

依据：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md`（19 个 AI 影视开源项目调研）§4.2 梯队 + §5.2 批次二/三。
**批次一已落地**（PR #4052，2026-10-20）：`film-kit` 已有 `shot-grammar.json` / `compliance-checklist.json` / `palette.json` / `prompts/tasks/**`；`prompt-doctrine` v2（11 blocks）；`shot-duration.js`（`durationMs` 四级来源链）。**本批次不重复做这些。**

> **后续修订说明（2026-10-21，验证层评审之后）**：本简报是**送审时**的快照，原文不改。其中 C1 描述的「合计上限 `FILM_PROMPT_BUNDLE_MAX_LEN=50000`」已在验证层评审 i4 中**删除**（该值与单字段上限同值 ⇒ 永不触发且误杀三段顶格的合法资产），现行口径为「**逐字段校验 + 不设合计上限**」，见 `design.md` D2 与 `specs/film-engineering/spec.md`。
> 另：PR 编号在 F-A 插入为 PR-2 后整体前移过一轮，现行编号以 `proposal.md` §5.0 表格为准（PR-1..PR-9 + PR-7a/PR-7b 共 10 个）；本简报抬头写的「6 个 PR」是送审时的旧数。

## 一、选定项与许可证结论

| 编号 | 内容 | 来源 | 许可证 | 结论 |
|------|------|------|--------|------|
| F-A | 分镜提示词三分 `imagePrompt`/`videoPrompt`/`endFramePrompt` | moyin-creator | AGPL-3.0 | 🟡 仅思路，禁止抄源码；提示词文本不受版权保护可重写 |
| F-B | 生成就绪度（内联既有 `costCheck`） | Jellyfish | Apache-2.0 | 🟢 可抄代码（保留 NOTICE） |
| F-C | 出站下载安全（**复用本仓既有 `shot-downloader` 合同**） | waoowaoo | Elastic 2.0 | 🟢 本仓自有实现更完整，不新建模块 |
| F-D | 外部工具体检（只做存在性） | app.yumcut | PolyForm NC | 🟡 仅思路；自研 |
| F-E | 单镜锁定 `locked` | ai-art-engine | GPL-3.0 | 🟡 仅思路，禁止抄源码 |
| F-F | 角色身份锚点 + 参考图优先级 | moyin-creator | AGPL-3.0 | 🟡 仅思路 + 提示词可重写；文本外置 |
| F-G | 项目文件乐观锁 `expectedRevision` | Toonflow-app | MIT | 🟢 可抄代码 |
| F-H/I/J | 方法论 UI 分区 / 任务级提示词接入规划 / 导入严格模式 | — | 本仓资产 | 🟢 批次一遗留接线 |

**实测推翻报告两处判断**（证据见 proposal §2.3）：F11b 落点（报告说"本仓无防护"，实为 `shot-downloader.js` 已实现完整合同）、F11d 落点（影视工程走 Electron 主进程 ffmpeg，不经 python-backend）。

## 二、现状缺口（实测）

| # | 缺口 | 证据 | 后果 |
|---|------|------|------|
| G-1 | Shot 只有单一 `prompt` | `shot-library.json:5`；`kit-loader.js:121`；全目录 grep `imagePrompt\|videoPrompt\|endFramePrompt` 零命中 | 单镜提示词最长 13,922 字符 → 模型注意力衰减、中段约束被忽略、重试无效 |
| G-2 | 成本闸是全批次级，无逐镜就绪度 | `video-gen.js:279-307`；`costCheck.shots[]` 仅 `{index,shotId,title,aspect,seconds}`（`:297-303`） | 缺提示词/坏参考图的镜**确认后才失败** |
| G-3 | 成片下载出站**完全裸奔** | `video-gen.js:116-145 downloadToFile`：**允许 http**、3xx **无限递归**、**无私网段拦截**、**无 DNS 校验**、**无大小上限**、**直接写目标文件** | provider 回传 `http://169.254.169.254/` 可打穿云元数据；下载中断留半成品 mp4 被当完成 |
| G-4 | ffmpeg 缺失在**合成期**才暴露 | `film-render.js:278-279` `findFfmpeg()` 失败 → 跑到合成才报「FFmpeg 不可用」 | 用户跑完 8 镜才发现环境缺件 |
| G-5 | 重跑覆盖人工精修过的镜 | `auto-project.js:295` patch 白名单仅 `prompt/refPaths/seconds/title`；全目录无 `locked` | 人工确认的成果被批量重跑冲掉 |
| G-6 | 并发写无版本保护 | `auto-project.js:246-259 writeProject` 直接覆盖；`auto-plan-fingerprint.js` 是**审计指纹**不是锁 | 两会话同时改同一任务 → 后写覆盖先写 |
| G-7 | 提示词优化阶段无身份锚点/参考图优先级 | `story2video-stages.js:1747-1798` 只有 `negativeAnchors`/`characters` 文本锚点；story2video 主管线**不传参考图** | 跨镜角色漂移；多角色同框串脸 |
| G-8 | 逐镜时长断在项目文件 | `auto-project.js:209-221` shot 结构**不落** `durationMs` | 规划层算出的时长在续跑/重生成时丢失，回落全局 `seconds` |

## 三、关键契约

**C1 提示词三分 + 存量零迁移**：`prompt` 字段保留不动；加载期归一化 `imagePrompt ??= prompt`、`videoPrompt ??= prompt`、`endFramePrompt ??= ''`；下游**不再有 `?? prompt` 分支**。单字段上限沿用 `FILM_PROMPT_MAX_LEN=50000`（不改）；新增**合计上限** `FILM_PROMPT_BUNDLE_MAX_LEN=50000`，超限 → kit 加载 **fail-closed**（不静默截断）。`shot-library.json` 153 条**零改动**。

**C2 未消费字段台账（统一判据：消费路径是否已定义）**：`imagePrompt`/`videoPrompt` 本批次消费；`endFramePrompt` **消费路径已定义但前置缺**（① provider 支持参考图注入 `video-reference-inputs.js:30-34` 仅 3 家 ② 该镜已绑参考图 ③ 公网图床 F28 未落地）⇒ 只产出不入请求；`viewpointId` **消费路径未定义** ⇒ 本批次**不做**。

**C3 就绪度内联，不新增第二道闸**：成本闸被 `film-video-checkpoint-integration.test.js:140-172` 锁死（"任何恢复路径都须重过闸"）⇒ `costCheck` 内新增 `readiness`（与既有 `references` 同级），**不新增 checkpoint**。判据只取"必然失败"项：`SHOT_PROMPT_EMPTY` / `SHOT_REFERENCE_UNRESOLVED` / `SHOT_DURATION_OUT_OF_RANGE` / `SHOT_ASPECT_UNSUPPORTED` / `SHOT_SECONDS_UNSUPPORTED` / `SHOT_LOCKED`，每条给可操作 `reason`。

**C4 出站合同复用 + IP pinning**：`shot-downloader.js` 已有完整合同（https-only `:60` / 私网段 `:43,:65` / 每跳 DNS 校验 `:130-144` / 3xx 逐跳重校验 `:154-166` / 500MB 上限 `:12` / `.part`→ffprobe→rename `:210`）。**新增 IP pinning**：解析一次 → 校验 → 把已校验 IP 集 **pin 进 socket 的 `lookup` 覆写**，消除"校验用 A 解析、连接用 B 解析"的 TOCTOU 窗口（不强制公共 DNS——会破坏本地 DNS/hosts/内网可用性）。成片下载**不做域名白名单**（provider 域名不固定），信任边界 = "响应经已认证轮询通道取得"。

**C5 工具体检只做存在性**：`film-render.js:278` 的 `findFfmpeg()` 复用；出片**前**体检，缺失给可操作错误；版本号只展示不阻断（报告已警告硬钉 7.1.1 会误判大量环境）。

**C6 锁镜只挡批量重跑**：用户**显式单镜重生成**仍对 `locked` 镜生效（否则失去逃生口）。

**C7 乐观锁与 `needsReconfirm` 并存不合并**：前者答"有没有并发写覆盖"，后者答"用户确认是否仍作数"（`auto-project.js:350-358`）。`expectedRevision` **缺省时不比对**（向后兼容，单会话串行写不误报）。

**C8 身份锚点**：骨相/五官/发色瞳色/唇色四类，**硬上限 4 条**；截断时显式回传 `anchorTruncated` + 被截角色名，不静默。参考图优先级：**最早 = 身份锚，后续仅场景/光线/构图/情绪**。多人同框加防串脸约束（禁止交换身份/肢体/说话归属/动作归属）。三类提示词**外置**到 `film-kit/prompts/tasks/generate_shot_prompt/{zh,en}/`，**禁止内联进 .js**。

**C9 不做（显式）**：F12 VLM 质检（`adapters/_base/base.js` 无视觉方法，且自动重试会绕过被锁死的成本闸）/ F7 `viewpointId`（无消费路径）/ F10 剪映草稿（需 spike）/ F8c·F8d（需 `tpad`/`loudnorm`，打包滤镜白名单仅 11 个 `stage-media-tools.js:10-22`）/ F13·F14·F16·F17·F18·F19（批次四）/ **不动 `packages/python-backend/`**。

## 四、PR 拆分

PR-1 方案+F-A → PR-2 F-I/F-H/F-J → PR-3 F-E/F-G/G-8 → PR-4a F-B → PR-4b F-C → PR-4c F-D；PR-5 F-F（独立）。
PR-4 拆 4a/4b/4c 的理由：三者都碰 `video-gen.js`，叠一起会互相掩盖回归面。

## 五、请评审确认

1. **C1 合计上限 50000 是否合理**？现有单镜 prompt 最长 13,922 字符，三分后合计上限会不会把合法资产判死？
2. **C4 的 IP pinning 是否足够**？域名白名单缺席是否可接受，还是必须补"provider 域名从配置派生"？
3. **C3 就绪度判据是否过严/过松**？`SHOT_LOCKED` 放进就绪度是否会与 C6 冲突（锁镜到底是"不就绪"还是"本次不参与"）？
4. **C8 锚点硬上限 4 条 + 无 VLM 验证闭环**是否可接受？
5. **C9 不做项**是否有遗漏的"其实该做且成本低"的项？
