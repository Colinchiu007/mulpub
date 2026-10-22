# tasks — film-pipeline-prompt-triple-and-guards

> 纪律：**先写测试（红）→ 实现（绿）→ 重构**；每个任务完成后回填证据（命令 + 结果）。
> 交付形态：按 PR 拆分，共 **10 个 PR**（PR-1 方案 docs-only + PR-2 ~ PR-9 实现），逐个 CI 全绿后合并（见 proposal §五）。
> **PR-2/3/4/5/6a/6b/7 从最新 `origin/main` 重新开分支**；依赖边：PR-1 → PR-2 / PR-3 → PR-4；PR-5 → PR-6a → PR-6b；PR-4 → PR-6b → PR-7；PR-8 独立。

---

## PR-1 · 方案（docs-only）

- [ ] 1.0 方案件与 PRD 入库（openspec 五件套 + 评审记录 + PRD）

## PR-2 · F-A 分镜提示词三分

- [ ] 2.1  方案件入库：`proposal.md` / `design.md` / `tasks.md` / `specs/film-engineering/spec.md` / `.openspec.yaml` / `review-brief.md` / `ccg-plan-review-record.md`
- [ ] 2.2  `openspec validate film-pipeline-prompt-triple-and-guards --strict` 通过
- [ ] 2.3  **TDD-RED**：`kit-loader.test.js` 新增「三分归一化」用例（存量 153 条 → 三字段非空 / `prompt` 不变）
- [ ] 2.4  **TDD-RED**：`kit-loader.test.js` 新增「三分字段非法（非字符串 / 超单字段上限）→ fail-closed」用例
- [ ] 2.5  **TDD-RED**：`video-gen.test.js` 新增「图片用 imagePrompt / 视频用 videoPrompt / 缺 videoPrompt 回落 imagePrompt」用例
- [ ] 2.6  实现：`shot-prompts.js` 归一化 + 字段级校验（单字段上限 `FILM_PROMPT_MAX_LEN`；**不设**合计上限 —— 验证层评审 i4 已删）
- [ ] 2.7  实现：`auto-plan.js` 派生三分（首帧全文 / 视频精简 / 尾帧 frame_constraint）
- [ ] 2.8  实现：`video-gen.js` 消费三分
- [ ] 2.9  `SCHEMA.md` 补三字段规格与字段级校验口径（无合计上限）
- [ ] 2.10 验证：影视工程定向测试全绿；`shot-library.json` 零改动断言（`git diff --stat` 为空）
- [ ] 2.11 QM-1 打包：`electron-builder --win --x64` exit 0 + asar 清单核对
- [ ] 2.12 文档：`01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md` 起草（数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字）
- [ ] 2.13 执行记录：`openspec/records/film-pipeline-prompt-triple-and-guards.md`（含 `| 远程同步 | 由门禁推导 |` 表行 + 对应 bullet）
- [ ] 2.14 门禁：`classify-docs-only --base=origin/main --head=HEAD`（commit 之后）+ `check-gate-record-debt` + `check-no-brand-residue` + `check-locale-sync`
- [ ] 2.15 PR-1 推送 → CI 全绿 → 自动合并 → **回读 main push 的 workflow 读数**
---

## PR-3 · F-I 任务级提示词接入规划 + F-H 方法论分区补全

> 决策定稿见 `design.md` D18 / D20 / D21 与 `review-brief-pr3.md`（决策层 3 轮共 24 条意见已逐条处置）。
> 判据分两类：**合成夹具**（固定数据 + 固定阈值）与**真实 kit 巡检**（只断言一致性 + 打印读数）—— 资产更新不会让任何一类变红。

### 3.1 契约层（判据先行）

- [ ] 3.1.1 **TDD-RED · 合成夹具**：`shot-prompt-task.test.js`（新建）—— ① 7 变量齐备 ⇒ 渲染无 `{{}}` 残留 + `missing` 为空 + `deliverable===true`；② byDesign ⇒ 保留 `{{style_prefix}}` + `deliverable=false`；③ assetMissing ⇒ 渲染空串 + 进清单；④ 模板多出的变量与非法变量名都计入 `missing`；⑤ 尾帧约束取自 `frame_constraint` 块 / 超 50000 截断且出声 / 缺 `en` 回落 `zh` 并记 `fallbackLocales`；⑥ 同输入两次渲染**逐字相等** + `sourceHash` 随 locale 与回退变化、同输入稳定
- [ ] 3.1.2 **TDD-RED · 合成夹具**：`auto-plan.test.js` —— ⑦ 缺 doctrine ⇒ W10 + `blockedExport===true`（**plan 级、持久化**）；⑧ 缺 promptLibrary ⇒ W11 + `blockedExport===true`；⑨ 不传 kit ⇒ `prompt` 与三分字段**逐字不变**（F-A 零回归锁延续）
- [ ] 3.1.3 **TDD-RED · 合成夹具**：`auto-project.test.js` —— ⑩ 项目文件里**不出现**方法论长文本的逐镜副本（`frameConstraint` 与 `system`/`user` 原文只出现一次）
- [ ] 3.1.4 **TDD-RED · 真实 kit 巡检（非阻断）**：`auto-plan.test.js` —— ⑪ 抽样 20 镜 ⇒ **命中数与 `missing` 清单与实测一致**（断言一致性、**不设阈值**）并打印读数
- [ ] 3.1.5 **TDD-RED · 合成夹具**：`FilmEngineeringView` 渲染测试 —— ⑫ 方法论分区渲染 `recipes` 与 `failureLedger`，且**只读**（无写操作入口）
- [ ] 3.1.6 **TDD-RED · 合成夹具**：`FilmAutoPanel.test.js` —— ⑬ 接入状态面板显示 `N/7` 命中、阻断变量与原因、`deliverable=false` 的提示、导出已阻断

### 3.2 实现

- [ ] 3.2.1 `shot-prompt-task.js`（新建）—— 变量装配（7 变量 + **四类缺失分级**）+ 模板渲染（`getTaskPrompts` + `renderTemplate`）+ **统一 locale 回退**（`pickLocaleText`）+ `sourceHash`（含 `v1` + locale + 回退事实）+ 尾帧约束派生（plan 级，design D21.1/D21.2/D21.3）
- [ ] 3.2.2 `auto-plan.js` 接 kit 上下文（`kit` 入参，**纯增量**）+ 派生 `endFramePrompt`（仍为空）/ `promptVars` / `promptMissing` + W10/W11（含 plan 级 `blockedExport`）
- [ ] 3.2.3 IPC `film-engineering:auto-plan` 传 kit 上下文；规划结果额外返回 `renderText` / `deliverable` / `blockedVars`（**不落盘**）
- [ ] 3.2.4 `auto-project.js` 落 plan 级 `promptContext`（含 `frameConstraint` 一次 + `sourceHash` + `fallbackLocales` + `blockedExport`）与逐镜 `promptVars` / `promptMissing`
- [ ] 3.2.5 `FilmEngineeringView.vue` 补两个只读分区（**可丢弃的独立提交**）：`recipes`（含 `blockKeys`）、`failureLedger`（symptom/cause/fix/tags）
- [ ] 3.2.6 `FilmAutoPanel.vue` 补**只读「方法论接入状态」**面板（plan 级：N/7 命中 + 阻断变量与原因 + 可否直送 + 尾帧约束状态 + 导出已阻断 + `sourceHash` 前 8 位）
- [ ] 3.2.7 i18n `locales/film-engineering/{zh,en}.js` 新增 **12 个 key 成对**（清单见 `review-brief-pr3.md` §四末）

### 3.3 收尾

- [ ] 3.3.1 QM-4 视觉：真机截图留证（两个分区 + 接入状态面板）
- [ ] 3.3.2 文档同步（PRD / SCHEMA / spec / design / tasks）+ 执行记录（两形态）+ 门禁 + PR-3

## PR-3b · F-J 资产导入（严格模式；写路径，单独过安全评审）

- [ ] 3b.1 **设计**：导入面设计（选目录 → `requireAssets: true` 校验 → 原子落盘 → 失效缓存）+ 写路径安全清单（只拷白名单文件 / 不跟随符号链接 / 半份 kit 不留 / 失败回滚）
- [ ] 3b.2 **决策层评审**：写路径单独一轮对抗性审查（不与只读接线混批）
- [ ] 3b.3 **TDD-RED**：`kit-import.test.js` —— 严格模式校验失败 ⇒ 不落盘；成功 ⇒ userData/film-kit 齐备且 service 缓存已失效；符号链接 ⇒ 拒绝；中途失败 ⇒ 无半份 kit
- [ ] 3b.4 实现：`kit-import.js`（新建）+ IPC `film-engineering:import-kit` + service 缓存失效
- [ ] 3b.5 i18n + UI 入口 + 文档同步 + 执行记录 + 门禁 + PR-3b

## PR-4 · F-E 锁镜 / F-G 乐观锁 / G-8 时长落盘

- [ ] 4.1 **TDD-RED**：`auto-runner.test.js` 新增「重跑跳过 locked 镜」用例 + 「单镜重生成仍可作用于 locked 镜」用例
- [ ] 4.2 实现：`auto-project.js` shot 加 `locked`；**patch 白名单加 `locked`（复用既有通道，不新增 IPC）**
- [ ] 4.3 实现：`auto-runner.js` 重跑跳过 `locked`
- [ ] 4.4 **TDD-RED**：`auto-project.test.js` 新增「陈旧 `expectedRevision` 写入 → 冲突 fail-closed 且原文件不变」用例
- [ ] 4.5 实现：`auto-project.js` 加 `revision` + `expectedRevision` 比对（缺省不检查，向后兼容）
- [ ] 4.6 实现：`auto-start` 路径携带 `revision`
- [ ] 4.7 **TDD-RED**：`auto-project.test.js` 新增「`shots[0].durationMs` 与计划一致」用例
- [ ] 4.8 实现：`auto-project.js` 落 `durationMs` / `durationSource` / `durationRawSec`
- [ ] 4.9 UI：`FilmAutoPanel.vue` 逐镜行显示锁标记 + 锁定/解锁交互 + **失败回滚为服务端真值** + i18n 成对
- [ ] 4.10 断言 `preload.test.js` 的通道计数**不变**（锁镜未新增 IPC 通道）
- [ ] 4.11 文档 + 执行记录 + 门禁 + PR-4

---

## PR-5 · F-B 就绪度闸门

- [ ] 5.1 **TDD-RED**：`shot-readiness.test.js`（新建）逐条 reasonCode 用例
- [ ] 5.1b **TDD-RED**：**`facts` 缺失/不完整时必须 fail-closed**——判决器 SHALL 返回 `notReady`（reasonCode `SHOT_FACTS_MISSING`），SHALL NOT 静默当作就绪（纯函数拿不到事实就判缺陷，评审 i6）
- [ ] 5.2 实现：`shot-readiness.js`（新建，纯函数、零 IO）
- [ ] 5.3 **TDD-RED**：`video-gen.test.js` 新增「`costCheck.readiness` 内联 + provider 调用数 = 0」用例
- [ ] 5.4 实现：`video-gen.js` 的 `costCheck` 加 `readiness`（含 `SHOT_LOCKED`，依赖 PR-3）
- [ ] 5.5 **断言既有锁未被削弱**：`film-video-checkpoint-integration.test.js` **只读不改**且仍绿
- [ ] 5.6 文档 + 执行记录 + 门禁 + PR-5

---

## PR-6 · 纯重构：出站下载实现独立成模块

- [ ] 6.1 **前置**：`video-gen.test.js` 既有 19+7 例全绿（基线）
- [ ] 6.2 抽出 `apps/desktop/electron/services/film-engineering/film-video-downloader.js`（**行为完全不变**，仍是现有裸实现）
- [ ] 6.3 `video-gen.js` 改为调用新模块（**行为零变化**）
- [ ] 6.4 **TDD-RED**：新模块等价性用例（http 允许 / 3xx 跟随 / 写目标文件 —— 与原实现逐项对齐）
- [ ] 6.5 验证：`video-gen.test.js` 19+7 例仍全绿；「无行为差异」声明写入执行记录
- [ ] 6.6 执行记录 + 门禁 + PR-6

---

## PR-7a · 零行为抽取 egress-guard

- [ ] 7a.1 **前置**：`shot-downloader.test.js` 既有 23 例全绿（基线）
- [ ] 7a.2 **TDD-RED**：`egress-guard.test.js`（新建）覆盖抽取前的**同一套**判据（https-only / 私网段 / DNS 校验 / 逐跳重校验 / 体积上限 / `.part`→ffprobe→rename / 受控媒体根）
- [ ] 7a.3 实现：把 `shot-downloader.js` 的出站合同**原样**抽成 `egress-guard.js`（**行为零变化**）
- [ ] 7a.4 实现：`shot-downloader.js` 改为调用 `egress-guard`（依赖单向：`shot-downloader` → `egress-guard`）
- [ ] 7a.5 验证：`shot-downloader.test.js` 既有 23 例全绿；`egress-guard.test.js` 全绿
- [ ] 7a.6 执行记录 + 门禁 + PR-7a

## PR-7b · F-C 出站安全加固

- [ ] 7b.1 **TDD-RED**：IP pinning 用例（注入两组不同 IP，断言连接用已校验的第一组）
- [ ] 7b.2 **TDD-RED**：端口集用例（声明含 8443 ⇒ 放行；未声明 ⇒ 拒绝；443/省略 ⇒ 放行）
- [ ] 7b.2b **TDD-RED**：**重定向每一跳的 pinning 用例**——首跳合法、第二跳指向内网 ⇒ 在**第二跳发起前**被拒；且第二跳的 socket `lookup` 使用**该跳自己校验过的 IP**（不是首跳的 IP）。pinning 只覆盖首跳 ⇒ TOCTOU 在第 2 跳重现（评审 i4）
- [ ] 7b.3 **TDD-RED**：可信主机用例（① = provider API 主机 ⇒ 零配置放行；② 不在集合且未显式授权 ⇒ **拒绝**；③ 已显式授权 ⇒ 放行到私网段检查；④ 私网地址**即使显式授权也拒绝**）
- [ ] 7b.4 实现：`egress-guard.js` 加 pinning + 端口集 + 可信主机策略
- [ ] 7b.5 实现：`film-video-downloader.js` 改走 `egress-guard` 合同
- [ ] 7b.6 实现：`shot-downloader.js` 同步获得加固（既有可观察行为不变 + 新增 pinning）
- [ ] 7b.7 配置面：模型服务商新增可选 `assetDownloadHosts` / `assetDownloadPorts`（缺省 ⇒ 只认 API 同源主机 + 443）
- [ ] 7b.8 实现：确认卡「本次允许从外部素材域名下载」勾选 ⇒ 产生**运行期一次性令牌**（**只存内存、任务结束失效、不落盘**）；`project.json` 中**不得出现任何可放行的授权位**（机械核对：无 `egressAllow` 类字段）；审计只记「发生过授权」这一事实
- [ ] 7b.9 验证：`shot-downloader.test.js` 既有 23 例全绿；`film-video-downloader.test.js` 全绿
- [ ] 7b.9b **TDD-RED**：**真实 kit 的字段级回归**——加载全部 153 条存量分镜，断言逐条 `imagePrompt` 非空且等于原 `prompt`、`videoPrompt` / `endFramePrompt` **全为空串**（走回落，不假装已解决），且逐条 `imagePrompt.length ≤ FILM_PROMPT_MAX_LEN`。实测：最长单镜 `prompt` **39,468** 字符（< 50,000），超限 0 条（2026-10-21）。**不设合计上限**（验证层评审 i4 已删）
- [ ] 7b.10 文档（出站合同 + 可信主机 + 端口集写进 PRD）+ 执行记录 + 门禁 + PR-7b

---

## PR-8 · F-D 外部工具体检

- [ ] 8.1 **TDD-RED**：`tool-doctor.test.js`（新建）存在性 / 缺失 / 版本解析用例（**版本不阻断**）
- [ ] 8.2 实现：`tool-doctor.js`（新建）
- [ ] 8.3 实现：`video-gen.js` 出片前体检 + 可操作错误码
- [ ] 8.4 验证：`film-render.test.js` 既有 20+2 例全绿
- [ ] 8.5 文档 + 执行记录 + 门禁 + PR-8

---

## PR-9 · F-F 身份锚点 + 参考图优先级

- [ ] 9.1 **TDD-RED**：锚点提取用例（骨相/五官/发色/唇色四类；硬上限 4 条；截断标记 `anchorTruncated` + 被截角色名）
- [ ] 9.2 实现：`story-context-engine.js` 新增独立函数（**不改**既有 `detectDynasty` 等分支）
- [ ] 9.3 **TDD-RED**：optimize 阶段 context 注入用例（优先级声明 + 最早参考图标为身份锚 + 防串脸约束）
- [ ] 9.4 **TDD-RED**：参考图序号一致性用例（乱序注入 ⇒ 报错而非静默）
- [ ] 9.5 实现：`story2video-stages.js` optimize 阶段注入
- [ ] 9.6 提示词外置：`film-kit/prompts/tasks/generate_shot_prompt/{zh,en}/` 增补三类提示词；**断言未内联进 `.js`**
- [ ] 9.7 文档 + 执行记录 + 门禁 + PR-9

---

## 10 · 验证（贯穿）

- [ ] 10.1 每个 PR：影视工程定向测试全绿 + `check-locale-sync --keys/--cjk` + `check-no-brand-residue` + `check-gate-record-debt` + `check-pr-exec-record`
- [ ] 10.2 每个 PR：`classify-docs-only --base=origin/main --head=HEAD`（**commit 之后**跑）
- [ ] 10.3 涉及主进程的 PR：QM-1 打包证据
- [ ] 10.4 涉及 UI 的 PR：QM-4 视觉证据
- [ ] 10.5 每次合并：**回读 main push 的 workflow 读数**（按「(merge SHA, workflow)」这一格判）
- [ ] 10.6 全部合并后：PRD / ARCH / 用户手册同步；沉淀记忆（内置 / 外部 / EverOS）
