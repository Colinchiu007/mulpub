# tasks — film-pipeline-prompt-triple-and-guards

> 纪律：**先写测试（红）→ 实现（绿）→ 重构**；每个任务完成后回填证据（命令 + 结果）。
> 交付形态：按 PR 拆分，逐个 CI 全绿后合并（见 proposal §五）。**PR-2/3/4 从最新 `origin/main` 重新开分支**。

---

## PR-1 · 方案 + F-A 分镜提示词三分

- [ ] 1.1 方案件入库：`proposal.md` / `design.md` / `tasks.md` / `specs/film-engineering/spec.md` / `.openspec.yaml`
- [ ] 1.2 `openspec validate film-pipeline-prompt-triple-and-guards --strict` 通过
- [ ] 1.3 **TDD-RED**：`kit-loader.test.js` 新增「三分归一化」用例（存量 153 条 → 三字段非空 / `prompt` 不变）
- [ ] 1.4 **TDD-RED**：`kit-loader.test.js` 新增「三分合计超上限 → fail-closed」用例
- [ ] 1.5 **TDD-RED**：`video-gen.test.js` 新增「图片用 imagePrompt / 视频用 videoPrompt / 缺 videoPrompt 回落 imagePrompt」用例
- [ ] 1.6 实现：`kit-loader.js` 归一化 + 合计上限（`FILM_PROMPT_BUNDLE_MAX_LEN`）
- [ ] 1.7 实现：`auto-plan.js` 派生三分（首帧全文 / 视频精简 / 尾帧 frame_constraint）
- [ ] 1.8 实现：`video-gen.js` 消费三分
- [ ] 1.9 `SCHEMA.md` 补三字段规格与合计上限口径
- [ ] 1.10 验证：影视工程定向测试全绿；`shot-library.json` 零改动断言（`git diff --stat` 为空）
- [ ] 1.11 QM-1 打包：`electron-builder --win --x64` exit 0 + asar 清单核对
- [ ] 1.12 文档：`01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md` 起草（数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字）
- [ ] 1.13 执行记录：`openspec/records/film-pipeline-prompt-triple-and-guards.md`（含 `| 远程同步 | 由门禁推导 |` 表行 + 对应 bullet）
- [ ] 1.14 门禁：`classify-docs-only --base=origin/main --head=HEAD`（commit 之后）+ `check-gate-record-debt` + `check-no-brand-residue` + `check-locale-sync`
- [ ] 1.15 PR-1 推送 → CI 全绿 → 自动合并 → **回读 main push 的 workflow 读数**

---

## PR-2 · F-I / F-H / F-J 资产接线与 UI

- [ ] 2.1 **TDD-RED**：`auto-plan.test.js` 新增「规划期走 prompt-library `generate_shot_prompt` 任务模板」用例
- [ ] 2.2 实现：`auto-plan.js` 接入 `prompt-library`（新增 doctrine blocks/rules 消费）
- [ ] 2.3 **TDD-RED**：方法论分区渲染用例（11 blocks + failureLedger + recipes + glossary）
- [ ] 2.4 实现：`FilmEngineeringView.vue` 方法论分区（**只读**，不改既有四标签结构）
- [ ] 2.5 实现：导入 IPC 传 `requireAssets: true`（资产缺失在导入时暴露）
- [ ] 2.6 i18n：`locales/film-engineering/{zh,en}.js` 新增文案成对
- [ ] 2.7 QM-4 视觉：真机截图留证（方法论分区渲染）
- [ ] 2.8 文档同步 + 执行记录 + 门禁 + PR-2

---

## PR-3 · F-E 锁镜 / F-G 乐观锁 / G-8 时长落盘

- [ ] 3.1 **TDD-RED**：`auto-runner.test.js` 新增「重跑跳过 locked 镜」用例 + 「单镜重生成仍可作用于 locked 镜」用例
- [ ] 3.2 实现：`auto-project.js` shot 加 `locked`；patch 白名单加 `locked`
- [ ] 3.3 实现：`auto-runner.js` 重跑跳过 `locked`
- [ ] 3.4 **TDD-RED**：`auto-project.test.js` 新增「陈旧 `expectedRevision` 写入 → 冲突 fail-closed 且原文件不变」用例
- [ ] 3.5 实现：`auto-project.js` 加 `revision` + `expectedRevision` 比对（缺省不检查，向后兼容）
- [ ] 3.6 实现：`auto-start` 路径携带 `revision`
- [ ] 3.7 **TDD-RED**：`auto-project.test.js` 新增「`shots[0].durationMs` 与计划一致」用例
- [ ] 3.8 实现：`auto-project.js` 落 `durationMs` / `durationSource` / `durationRawSec`
- [ ] 3.9 UI：`FilmAutoPanel.vue` 逐镜行显示锁标记 + 可锁定交互 + i18n 成对
- [ ] 3.10 文档 + 执行记录 + 门禁 + PR-3

---

## PR-4 · F-B 就绪度 / F-C 出站安全 / F-D 工具体检

- [ ] 4.1 **TDD-RED**：`shot-readiness.test.js`（新建）逐条 reasonCode 用例
- [ ] 4.2 实现：`shot-readiness.js`（新建，纯函数、零 IO）
- [ ] 4.3 **TDD-RED**：`video-gen.test.js` 新增「`costCheck.readiness` 内联 + provider 调用数 = 0」用例
- [ ] 4.4 实现：`video-gen.js` 的 `costCheck` 加 `readiness`
- [ ] 4.5 **断言既有锁未被削弱**：`film-video-checkpoint-integration.test.js` **只读不改**且仍绿
- [ ] 4.6 **TDD-RED**：`egress-guard.test.js`（新建）私网段/https-only/逐跳重校验/体积上限/半成品清理用例
- [ ] 4.7 实现：`egress-guard.js`（新建）
- [ ] 4.8 实现：`shot-downloader.js` 改为复用 `egress-guard`（**行为逐字不变**，既有 23 例全绿）
- [ ] 4.9 实现：`video-gen.js` 的 `downloadToFile` 改走 `egress-guard`
- [ ] 4.10 **TDD-RED**：`tool-doctor.test.js`（新建）存在性/缺失/版本解析用例
- [ ] 4.11 实现：`tool-doctor.js`（新建）+ `video-gen.js` 出片前体检 + 可操作错误码
- [ ] 4.12 文档：出站合同与体检口径写进 PRD
- [ ] 4.13 QM-1 打包 + 文档 + 执行记录 + 门禁 + PR-4

---

## PR-5 · F-F 身份锚点 + 参考图优先级

- [ ] 5.1 **TDD-RED**：锚点提取用例（骨相/五官/发色/唇色四类；硬上限 4 条；截断标记 `anchorTruncated`）
- [ ] 5.2 实现：`story-context-engine.js` 新增独立函数（**不改**既有 `detectDynasty` 等分支）
- [ ] 5.3 **TDD-RED**：optimize 阶段 context 注入用例（优先级声明 + 最早参考图标为身份锚 + 防串脸约束）
- [ ] 5.4 实现：`story2video-stages.js` optimize 阶段注入
- [ ] 5.5 提示词外置：`film-kit/prompts/tasks/generate_shot_prompt/{zh,en}/` 增补三类提示词；**断言未内联进 `.js`**
- [ ] 5.6 文档 + 执行记录 + 门禁 + PR-5

---

## 7 · 验证（贯穿）

- [ ] 7.1 每个 PR：影视工程定向测试全绿 + `check-locale-sync --keys/--cjk` + `check-no-brand-residue` + `check-gate-record-debt` + `check-pr-exec-record`
- [ ] 7.2 每个 PR：`classify-docs-only --base=origin/main --head=HEAD`（**commit 之后**跑）
- [ ] 7.3 涉及主进程的 PR：QM-1 打包证据
- [ ] 7.4 涉及 UI 的 PR：QM-4 视觉证据
- [ ] 7.5 每次合并：**回读 main push 的 workflow 读数**（按「(merge SHA, workflow)」这一格判）
- [ ] 7.6 全部合并后：PRD / ARCH / 用户手册同步；沉淀记忆（内置 / 外部 / EverOS）
