# Tasks: 电影工程流水线扩展——分镜视频生成与成片合成

## 1. 视频生成核心（TDD）

- [x] 1.1 RED：编写 `video-gen.test.js` 失败测试——提示词原文直送（提交 prompt 与导出文本逐字符 diff 相等，含 `<<<uuid>>>` 令牌）；prompt-engine 优化器 spy 被调用即 fail；provider 未配置返回 `VIDEO_MODEL_NOT_CONFIGURED`（含引导字段）；批次 >10 拒绝（测试目标：specs「分镜视频生成阶段」4 场景）
- [x] 1.2 GREEN：实现 `services/film-engineering/video-gen.js`——`getDefault('video')` 解析、`generateVideo` 提交（画幅 16x9/9x16/source → width/height 映射、时长 5/8/10s → 帧数换算、num_frames/frame_rate 双写兼容）、轮询（10s 间隔/10min 上限、taskId 多字段兼容）、下载到 run 目录 `shot_NNN.mp4`、`mapWithModelBudget` 并发、部分失败 partialFailure 清单；`MAX_VIDEO_BATCH = 10`（过 1.1）
- [x] 1.3 RED→GREEN：注册 `film_generate_videos` stage executor（container.setup.js 装配点），等待态 checkpoint payload 携带逐镜 shotId/标题/画幅/时长；测试文件覆盖 checkpoint 载荷合同（specs「成本确认 checkpoint·确认卡内容」）

## 2. 流水线接线与 checkpoint 语义

- [x] 2.1 `pipeline-engine.js` film-engineering stageDefs 追加 `film_generate_videos`（checkpointRequired=true）与 `film_render`，流水线完整执行/阶段失败上报测试更新为六阶段（specs「流水线阶段契约」3 场景）
- [x] 2.2 RED→GREEN 集成测试：mock `manager.callAdapter` + 本机临时 HTTP 假 mp4 下载源（真实 callAdapter 路径，禁 mock 终函数），覆盖——advance 前零 provider 调用；advance 后逐镜生成落盘；重启恢复（resumeFromCheckpoint）仍停在成本闸不绕过（specs「成本确认 checkpoint」全场景）
- [x] 2.3 验证流水线进度事件将 checkpoint 等待态透传至电影工程页订阅链（D2 注记：字段缺失补流水线公共层并加回归，不在 film 侧特判）

## 3. 成片合成阶段（TDD）

- [x] 3.1 RED：编写 `film-render.test.js`——规格一致走 `-c copy` 直拷（断言 ffprobe 参数）；规格不一致 scale+pad 归一后拼接成功；磁盘缺镜 → fail 并输出缺失序号清单、不产出 final.mp4；产物清单以 run 目录扫描为准（生成阶段内存态标失败但磁盘已补 → 视为可用）（specs「成片合成与产物合同」3 场景）
- [x] 3.2 GREEN：实现 `film_render` executor（ffprobe 预检 → concat demuxer / 归一重编码 → `film-engineering/<runId>/final.mp4`，受控媒体根校验沿用 `getAllowedMediaRoots`），测试在 `os.tmpdir()` 自建片段，禁止依赖构建残留

## 4. 单镜重试 IPC（TDD）

- [x] 4.1 RED：`film:retryShot` 通道测试——非受信 sender 拒绝；runId/镜序号非法或不属于该 run 拒绝（带字段名错误）；合法重试以原文直送合同单镜提交→下载→覆盖 `shot_NNN.mp4` 且不迁移流水线阶段状态（specs「失败分镜单镜重试」2 场景 + IPC 校验合同）
- [x] 4.2 GREEN：实现重试通道（withSenderCheck + event-first 转发，防 withKit 参数错位历史坑回归）接入 `video-gen.js` 单镜路径

## 5. 前端（FilmEngineeringView）

- [x] 5.1 「生成视频」按钮 + 发起面板（画幅 16:9 默认/9:16/源规格、时长 5/8/10s 默认 5、>10 镜前端拦截 + 后端兜底）；选中分镜负载 `JSON.parse(JSON.stringify())` 脱壳后走 `pipeline:start`
- [x] 5.2 成本确认 checkpoint 卡（逐镜清单+参数+确认/取消 → pipeline advance）、逐镜结果列表（成功/失败/重试按钮，数据源=run 目录扫描）、成片完成态（打开所在文件夹/另存）；provider 未配置引导跳模型设置
- [x] 5.3 locales zh/en 成对新增全部文案 + `01-docs/i18n-glossary.md` 补「成本确认/成片/单镜重试」，自检 CI Gate 7（渲染端非 locales 文件零新增中文字面量）
- [x] 5.4 视觉回归：FilmEngineeringView 新增区块像素基线更新并跑 `test:visual:pixel` 确认无既有页面回归

## 6. E2E 门禁与冒烟

- [x] 6.1 扩展电影工程打包 E2E 门禁（不计费项）：按钮存在、provider 未配置引导、确认卡渲染、确认前零 provider 调用、选中分镜数组参数化 IPC 不错位；无默认视频 provider 环境下验证 fail-closed 文案。落地于 `apps/desktop/tests/e2e/film-engineering-real.js`（fe-video-entry/idle 面板/成本确认卡/确认前 `.el-tag--success` 计数为 0/confirm→fail-closed 引导分类），纯函数 `classifyVideoOutcome` 由 `film-engineering-real.test.js` node --test 覆盖；打包执行属 release-only build.yml 门禁。2026-09-21 本机真机执行（打包 exe + 临时 profile）：未登录 profile 下 `pipeline:start-orchestrated` 属 authenticated 通道，E2E 终态三分类自适应——license-gated 分支验证许可证门 fail-closed（拒绝启动且零逐镜成功）并对成本闸两项标 SKIP（诚实标注），全路径需登录环境（并入 6.2 手动冒烟）；`classifyVideoOutcome` 四态（done/cost-gate/fail-closed/license-gated）
- [ ] 6.2 opt-in 真实 provider 冒烟脚本（手动触发不进 CI）：最短 + 最长 kit 分镜各出 1 镜 5s 片，记录真实返回规格（消化 design OQ2：source 画幅行为）
- [x] 6.3 QM-1：`electron-builder --win --dir` 打包 + asar 清单 + require 链 + 启动 8 秒 stderr 无新告警

## 7. 文档与收尾

- [x] 7.1 CHANGELOG 追加 + 电影工程使用说明更新（01-docs：短剧端到端流程含视频生成/合成章节）
- [ ] 7.2 `openspec validate --strict` 通过、`.quality-gates.md` 自检清单勾选、PR 描述附 grilling 共识基线摘要，等待 review 后合入
