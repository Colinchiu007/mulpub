# Tasks: film-full-corpus-production

> 实施分支：`codex/film-full-corpus-production`（隔离 worktree，经 `scripts/start-mp-task.ps1` 创建）。
> 依赖序：组 1 → L1（组 2-4）→ L2（组 5）→ L3（组 6-8）→ 验证收尾（组 9-10）。L1/L2 可作为独立交付里程碑先行合入。

## 1. 前置校验（顺序依赖与风险 POC）

- [x] 1.1 **前置 change 收口**：完成 `film-engineering-video-gen` 的 `openspec sync/archive`（三同步：spec 归档 + CCG task + 质量节拍复盘），本 change specs delta 以合并后主 spec 复核基线（"成片合成与产物合同"等 4 条需求落进主 spec 后再动手）
  <!-- 2026-09-23 POC：抽 10 条不同月份桶 kit resultUrl（mp4），curl 下载+ffprobe 双验证 10/10 全命中（单镜 4.5-8.5MB），报告 .agent_context/film-fix/poc-resulturl-2026-09-23.json。回收通道可行，L3 不收缩。 -->
  <!-- 2026-09-23 对账结论：完整规范化 SHA1 口径 uniqueVideoPrompts=6,500 / adoptedShots=6,558 / 超限 0；差异根因=取证 2,795 为前缀约500字符截断去重（prefix500 实测 2,768 吻合）。收紧视频口径排除 soul_cinematic 等图片模型后 totalVideoJobs=133,053 与取证 133,083 对齐。已回写 design/proposal/tasks 并 raise renderManifest 上限 5,000→10,000。证据 .agent_context/film-fix/dryrun-full-stats-20260923.json。 -->

## 2. L1 导入器扩容（scripts/film-engineering/fetch-hell-grind-kit.py，TDD pytest）

- [x] 2.1 RED：fixture jsonl 单测——prompt 规范化（trim+折叠空白）+ SHA1 去重键、同键末次 completed job 为采纳版、`iterationCount`/`adoptedJobAt` 统计、is_favourite 不被依赖
- [x] 2.2 GREEN：实现 `--full` 全量模式（每场景全部唯一分镜）；保留既有精选模式为默认（向后兼容）
- [x] 2.3 shot 字段扩展：`durationSec/width/height/aspectRatio/model/resultUrl/iterationCount/adoptedJobAt`；`FILM_PROMPT_MAX_LEN=50000` 常量与超限拒绝；film-manifest 写入 `allowedHosts`（resultUrl 域名清单）
- [x] 2.4 落点与原子性：`--out` 指定 userData kit 目录（默认共享锚点下 `film-kit/`），`.tmp` → rename 原子写 + `import-report.json`（镜数/场景数/拒绝清单）
- [x] 2.5 真实导入执行：对 `E:\hell-grind-full` 跑 `--full`，落盘全量 kit（shots≈6,558，1.3 修正口径），报告归档 change 目录
  <!-- 2026-09-23 实测：shotCount=6,558 / sceneCount=162 / rejected=0 / totalVideoJobs=133,053 / uniqueVideoPrompts=6,500（与 1.3 对账口径完全吻合）；maxPromptLength=39,801 < 50,000；allowedHosts=[d8j0ntlcm91z4.cloudfront.net]。落盘 shared-user-data/film-kit/（80MB shot-library），报告 evidence/import-report-20260923.json。 -->

## 3. L1 两级 kit 加载与 schema（apps/desktop/electron，TDD vitest）

- [x] 3.1 RED：kit-loader 单测矩阵——userData 全量优先 / 全量损坏回退 asar 精简（错误可见非静默）/ 两级缺失 `FILM_KIT_UNAVAILABLE` / 校验错误含文件与条目索引 / `FILM_PROMPT_MAX_LEN` 导出为单一常量
  <!-- 2026-09-23 RED 确认：新增 10 测试全失败（loadFilmKitChain/validateShotSceneRefs is not a function 等），既有 13 通过。 -->
- [x] 3.2 GREEN：loader 两级探测与独立校验实现；`services/film-engineering/` 全部 kit 读取点改经 loader（grep 无残留直读 `electron/film-kit/`）
  <!-- 2026-09-23：loadFilmKitChain 实现；FilmEngineeringService._ensureKit 改两级链（userData-full → asar-bundled，status 新增 kitSource）；container.setup 接线 app.getPath('userData')/film-kit。grep 收口确认：全仓非测试代码 kit 读取仅经 kit-loader（stages 显式 params.kitDir 亦走 loadFilmKit）；ipc-handlers/film-engineering.js 无直读。service 层新增 4 个链接线回归测试。 -->
- [x] 3.3 schema 校验器扩展字段（类型/取值范围/shotId-sceneId 交叉引用）+ 正反用例
  <!-- 2026-09-23：validateShotLibrary 增 durationSec/aspectRatio("W:H")/iterationCount(非负整数)/adoptedJobAt(数值) 校验；validateShotSceneRefs 孤儿 sceneId fail-closed 并入 loadFilmKit（校验错误带文件名前缀）；正反用例含 prompt 恰达上限/超一字符边界。 -->
- [x] 3.4 回归：film-engineering 既有单测全量通过；`node scripts/verify-worktree-deps.js` 门禁
  <!-- 2026-09-23：vitest electron/services/film-engineering/ 11 文件全绿（改造前 94 tests；接线后 service+kit-loader 37/37）；verify-worktree-deps OK（11 项解析）。 -->

## 4. L1 查询契约与前端浏览

- [ ] 4.1 RED：listShots 分页单测——limit/offset/total、服务端上限保护、缺省全量时的负载上限、未知 sceneId 仍报错（不空数组冒充）
- [ ] 4.2 GREEN：service + IPC + preload 透传分页参数（参数纯 JSON 脱壳，结构化克隆安全）
- [ ] 4.3 前端：分镜列表虚拟滚动 + 分页拉取；场景计数取 `scenes[].count` 全量口径；新增文案 locales zh/en 成对（Gate 7）
- [ ] 4.4 规模验证：全量 kit（≈6,558 镜、单场景数百镜）下打开列表与切场景，渲染时间 <1s（CDP 计时记录入 change 目录）

## 5. L2 renderManifest 契约（film-render.js，TDD）

- [ ] 5.1 RED：manifest 解析单测——orderIndex 从 0 连续校验、sourceKind 枚举、path 受控根内（realpath 后前缀比对，`..` 遍历/junction 逃逸拒绝）、规模上限 5,000、**无 manifest 时既有单批行为逐字节不变**（回归锚）
- [ ] 5.2 GREEN：输入解析层分叉 + manifest 模式片段收集；拼接引擎（规格探测→`-c copy` 直拷/最小归一）零改动复用
- [ ] 5.3 集成：构造两个临时 run 目录 + 一个下载目录的三源混合 manifest（本地生成 fixture），直拷与归一两条路径各至少一次出片成功，ffprobe 实测时长 = Σ 片段时长（±0.5s）
- [ ] 5.4 缺条目 fail-closed：按 orderIndex 列缺失清单，不产出假成片；报告含清单规模与成片时长

## 6. L3 原片下载通道（TDD）

- [ ] 6.1 RED：shot-downloader 单测——仅 https、allowedHosts 精确匹配（不通配）、单文件 500MB 上限、`.part` 流式写 + ffprobe 验证通过才 rename、失败清理临时文件、无显式触发不下载
- [ ] 6.2 GREEN：下载 service + IPC（单镜/批量回收）+ 落盘 `<taskId>/recycled/shot_NNN.mp4` 并产出可进 manifest 的条目
- [ ] 6.3 SSRF 回归：302 跳出白名单、DNS 重绑定场景测试（对照项目既有 SSRF 防御模式，主机名判断不可作为唯一防线）

## 7. L3 全量分批出片驱动（TDD）

- [ ] 7.1 RED：台账/切批单测——144 镜 → 15 批（14×10+1×4）边界（0/1/10/11 镜）、批次 runId 分配、磁盘产物复核的重入协议（已完成批次零 provider 调用）、单批失败隔离、全批收口自动生成 renderManifest
- [ ] 7.2 GREEN：production-driver 实现（切批 → 逐批子 run 至 generate_videos checkpoint → 过闸 → merge → 台账 `ledger.json` 持久化 userData）
- [ ] 7.3 崩溃恢复集成：mock provider 下模拟进程中断，重入从断点继续且已完成镜不重调（台账 + 磁盘双核）
- [ ] 7.4 进度事件：批次级 + 逐镜状态经既有 onStageEvent 通道上报（节流合并），IPC 负载守卫

## 8. L3 前端出片面板

- [ ] 8.1 "全量出片"入口：批次计划预览（批次数/镜数/磁盘占用估算/墙钟估算）与发起确认
- [ ] 8.2 逐批 costCheck 确认面板：该批价格 + 剩余批次数 + 累计已确认预算（D9 缓解项）
- [ ] 8.3 批次进度视图：批/镜双层状态、失败镜单镜重试（复用 filmRetryShot）、断点续跑按钮、回收通道"先回收后精修"引导（D10）
- [ ] 8.4 全量交互回归：进度刷新不重置用户展开态、组件卸载监听清理；locales 成对

## 9. E2E 与真实冒烟

- [ ] 9.1 CDP E2E（模拟 provider）：全量 kit 加载 → 分页浏览 → 12 镜全量出片（2 批过闸）→ manifest 合成 final.mp4 成功
- [ ] 9.2 回收链路 E2E（POC 存活 URL）：5 镜下载验证 + 2 镜生成产物混合出片
- [ ] 9.3 真实 provider 小规模冒烟：1 批（≤10 镜）重生成 + 5 镜回收混合成片，产物与过程证据落 `.agent_context/film-fix/` 并回填 change
- [ ] 9.4 QM-1 打包验证：`electron-builder --win --dir` 成功；确认全量 kit **未**入 asar（asar 清单抽查）、精简 kit 随包完好

## 10. 文档与收尾

- [ ] 10.1 文档：模块文档 + 用户指南（全量导入操作、两级 kit 行为、全量出片/回收流程、磁盘预期）、CHANGELOG
- [ ] 10.2 OQ 处置：OQ1（非采纳版）/OQ2（会话级授权）/OQ3（图片扩充）显式标记 resolved/wontfix + 依据；design 假设记录回查
- [ ] 10.3 spec 覆盖审计：delta 每需求每场景 ↔ 测试映射核查；proposal 基线 vs 现状差异复核（禁重复规格化）
- [ ] 10.4 经验沉淀：本 change 踩坑/方法论写入 `.learnings/` 与记忆
- [ ] 10.5 归档前置：1.1 的前置 change 状态、10.1-10.4 完成核查 + 无未勾任务后 archive 本 change
- [ ] 10.6 远端收尾：PR（关联本 change）→ 盯 CI 全绿 → auto-merge → `git merge-base --is-ancestor <合并提交> origin/main` 验证，记录 remoteStatus
