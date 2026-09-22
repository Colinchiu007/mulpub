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

- [x] 4.1 RED：listShots 分页单测——limit/offset/total、服务端上限保护、缺省全量时的负载上限、未知 sceneId 仍报错（不空数组冒充）

  <!-- 2026-09-23 RED 确认：12 新分页测试先全失败后实现转绿；FULL_LOAD_LIMIT=500/MAX_PAGE_LIMIT=200/DEFAULT_PAGE_LIMIT=100。 -->
- [x] 4.2 GREEN：service + IPC + preload 透传分页参数（参数纯 JSON 脱壳，结构化克隆安全）

  <!-- 2026-09-23：双形态契约（缺省全量数组回归锚 / {limit,offset} 页封装 {shots,total,limit,offset}）；IPC pageOpts 负载守卫 VALIDATION_ERROR；3 文件 63/63。commit 846023bd0。 -->
- [x] 4.3 前端：分镜列表虚拟滚动 + 分页拉取；场景计数取 `scenes[].count` 全量口径；新增文案 locales zh/en 成对（Gate 7）

  <!-- 2026-09-23：useFilmEngineering 增 shotsTotal/shotsOffset/shotsHasMore/shotsLoadingMore + loadMoreShots（每页 100，竞态防护迟到页丢弃，数组形态防御兼容）；View 尾 sentinel IntersectionObserver 自动翻页（无 IO 环境降级手动"加载更多"按钮）+ 已加载 X/共 Y 计数；场景树 badge 改 data.count 全量口径；locales loadedCount/loadMore/selectAllLoaded/loadMoreFailed zh/en 成对；composable+View 测试 22/22，前端回归 78 文件 1836/1836，eslint 0。 -->
- [x] 4.4 规模验证：全量 kit（≈6,558 镜、单场景数百镜）下打开列表与切场景，渲染时间 <1s（CDP 计时记录入 change 目录）— 2026-09-23 达标：userData-full 全量级 6,558 镜下切场景 442/333/907ms 均 <1s，见 evidence/cdp-44-timing-20260923.json；口径修正：scenes[].count 系源 job 计数（D8 假设不成立），badge 改用 shotCount；附带修复 importer aspectRatio 归一化（"auto"→null，pytest 14/14）+ 落盘 kit 数据

## 5. L2 renderManifest 契约（film-render.js，TDD）

- [x] 5.1 RED：manifest 解析单测（2026-09-23 完成：film-render.test.js 新增 L2 契约 describe 9 用例，RED 10 failed/10 既有锚 passed；注：原文"规模上限 5,000"按 D5 修正为 10,000）——orderIndex 从 0 连续校验、sourceKind 枚举、path 受控根内（realpath 后前缀比对，`..` 遍历/junction 逃逸拒绝）、规模上限 5,000、**无 manifest 时既有单批行为逐字节不变**（回归锚）
- [x] 5.2 GREEN：输入解析层分叉（2026-09-23 完成：parseRenderManifest/getFilmMediaRoot/RENDER_MANIFEST_MAX=10000 + executor manifest 分叉，拼接引擎零改动；20/20 全过含 10 既有回归锚） + manifest 模式片段收集；拼接引擎（规格探测→`-c copy` 直拷/最小归一）零改动复用
- [x] 5.3 集成：构造两个临时 run 目录（2026-09-23 完成：film-render.manifest-int.test.js 真实 ffmpeg fixture，三源混合（2 run + 1 下载目录）直拷 3×2s→6s±0.5、归一 720p+360p 2×2s→4s±0.5，ffprobe 实测达标；无二进制环境 skipIf） + 一个下载目录的三源混合 manifest（本地生成 fixture），直拷与归一两条路径各至少一次出片成功，ffprobe 实测时长 = Σ 片段时长（±0.5s）
- [x] 5.4 缺条目 fail-closed（2026-09-23 完成：missing 按 orderIndex 列清单（含 shotId/path），invalid 一次性汇总；executor 拒绝时不产出 final.mp4，output.source 标记清单规模来源）：按 orderIndex 列缺失清单，不产出假成片；报告含清单规模与成片时长

## 6. L3 原片下载通道（TDD）

- [x] 6.1 RED：shot-downloader 单测（2026-09-23 完成：shot-downloader.test.js 16 用例——仅 https、allowedHosts 精确匹配（父域/通配/后缀伪装条目全拒绝）、500MB 上限（超限截断+清理）、.part 流式写 + probe 通过才 rename、失败/流中断清理、合同不通过零网络请求）——仅 https、allowedHosts 精确匹配（不通配）、单文件 500MB 上限、`.part` 流式写 + ffprobe 验证通过才 rename、失败清理临时文件、无显式触发不下载
- [x] 6.2 GREEN：下载 service + IPC（2026-09-23 完成：shot-downloader.js downloadShot（fetchImpl/lookupImpl/probeImpl 三 seam，零真实网络测试）+ IPC film-engineering:download-recycled（URL 一律取 kit resultUrl、renderer 传 url 被忽略；落盘 <媒体根>/production/<taskId>/recycled/shot_NNN.mp4；并发 4（D7）；单项失败隔离；条目 {shotId,path,sourceKind:'downloaded',orderIndex} 直接可进 renderManifest）+ service.getAllowedHosts + preload/access-control/license 公共通道；ipc 测试 7 用例 RED→GREEN，456/456 全过）（单镜/批量回收）+ 落盘 `<taskId>/recycled/shot_NNN.mp4` 并产出可进 manifest 的条目
- [x] 6.3 SSRF 回归（2026-09-23 完成：302 跳出白名单拒绝（仅一跳即停）、302 降级 http 拒绝、跳转链超 MAX_REDIRECTS=3 防环、每次请求（含每跳）DNS lookup 解析 IP 校验——重绑定第二次解析到 127.0.0.1 拒绝、解析含内网 IP 请求前拒绝、DNS 失败 fail-closed；对照既有 _validateExternalUrl 模式新增"主机名判断非唯一防线"（lookup IP 双防线））：302 跳出白名单、DNS 重绑定场景测试（对照项目既有 SSRF 防御模式，主机名判断不可作为唯一防线）

## 7. L3 全量分批出片驱动（TDD）

- [x] 7.1 RED：台账/切批单测（2026-09-23 完成：production-driver.test.js 19 用例——批大小 10 常量、边界 0/1/10/11 镜、144 镜→15 批（14×10+1×4）保序不重不漏、runId prod-<taskId>-b<idx> 确定性派生重算一致、台账 .tmp+rename round-trip 无 .tmp 残留、损坏 JSON→null fail-closed、重入协议磁盘复核唯一裁决三场景（done+盘齐→needRun false 零调用 / done+盘缺→降级重跑列缺失 / pending+盘齐→双核跳过）、收口双判据（台账全 done+磁盘全过否则 ok:false 列 missing 不产假清单）、单批失败隔离 statuses=[done,failed,done] 且 renderManifest null、taskId/shotIds 非法抛错；RED（模块缺失 require 失败）→GREEN 19/19；film-engineering 全套 14 文件 163/163；eslint 0 问题）——144 镜 → 15 批——144 镜 → 15 批（14×10+1×4）边界（0/1/10/11 镜）、批次 runId 分配、磁盘产物复核的重入协议（已完成批次零 provider 调用）、单批失败隔离、全批收口自动生成 renderManifest
- [x] 7.2 GREEN：（2026-09-23 完成，service/IPC 层接线真实 pipeline：ipc-handlers `runBatchViaVideoGen` 逐批子 run——provider 入口预检（缺失即 VIDEO_MODEL_NOT_CONFIGURED 信封，driver 零调用）→ 逐镜 getShot 取原文 prompt（空白 fail-closed 记 failed）→ generateShotVideo 子跑落 `film-engineering/<runId>/shot_NNN.mp4`，批内并发 2（design 墙钟口径）；批成败不信自报、由 driver 批后磁盘 probe 裁决；台账 ledgerDir=`<媒体根>/production/<taskId>/ledger.json`（userData）；driver 增 runOnlyBatch（D9 逐批确认，非目标批保持 pending，整数校验 fail-closed）；IPC 三通道 production-plan（批次/磁盘/墙钟估算预览）/ production-run-batch / production-status（断点视图，台账+磁盘双核只读）+ preload 四处登记（invoke×3 + onProductionUpdate 返回 unsubscribe）+ bundle 重建。测试：ipc 47/47（production 12 用例含真实 gen 接线断言 runDir/aspect/seconds/providerCfg、多镜 done/failed、status fixture 双核与 manifest null 分支）；driver 21/21（runOnlyBatch 2 用例）；film-engineering 相关全套回归 17 文件 614/614；eslint 0 errors（2 既有 warnings 非本段引入）；前端确认面板 UI 属 8.1-8.4）——切批 → 逐批子 run 至 generate_videos checkpoint → 过闸 → merge → 台账 `ledger.json` 持久化 userData
- [x] 7.3 崩溃恢复集成：（2026-09-23 完成：以可增长磁盘 mock（runBatch 成功才落盘）覆盖——批 0 落盘后"进程被杀"，第二轮同 ledgerDir 重入 calls=[1] 已完成批零 provider 调用（台账+磁盘双核）且收口产出 11 条 manifest；failed 批重入会重试（重入协议对 failed 不豁免，磁盘无信物必重跑）；sameShape 校验（taskId+批数+各批镜数）不符即重建台账不吞着跑。mock provider 下进程中断语义以同进程二次 runProduction 等价模拟，真实 Electron 进程级中断冒烟归组 9 E2E）mock provider 下模拟进程中断mock provider 下模拟进程中断，重入从断点继续且已完成镜不重调（台账 + 磁盘双核）
- [x] 7.4 进度事件：（2026-09-23 完成：批次级事件 running/done/skipped-complete + production:complete 即时上报；逐镜 production:shot-progress 经 EVENT_MERGE_MS=500ms 窗口节流取最新计数（11 次上报→3 事件，doneCount 单调不回退，last=11）；事件负载只带计数/batchIndex/shotIndex，守卫断言不携带 shotIds 数组（IPC 负载守卫）；now 时间源注入使计时测试确定性。emit 为注入 seam，service 层接线既有 onStageEvent 通道随组 8 落地）批次级 + 逐镜状态经既有 onStageEvent 通道上报批次级 + 逐镜状态经既有 onStageEvent 通道上报（节流合并），IPC 负载守卫

## 8. L3 前端出片面板

- [x] 8.1 "全量出片"入口：批次计划预览（批次数/镜数/磁盘占用估算/墙钟估算）与发起确认
      <!-- 证据：FilmEngineeringView.vue 工具栏 fe-production-entry 按钮（选中分镜>0 可用，无单批 20 上限）→ openProductionPanel 自动 planProduction；
      production dialog plan-ready 分支显示 planSummary（批次数×批大小×镜数）/diskEstimate(8MB/镜)/wallclockEstimate(300s/镜)/mediaRoot + taskId 输入（^[a-zA-Z0-9._-]{1,64}$ 前端校验）→ begin()。
      回归：useFilmProduction.test.js 13 用例（8.1 plan 成功/降级 noDesktop/noShots 零 run-batch 调用）+ FilmEngineeringView.test.js 3 用例（按钮 disabled/enabled/点击开面板）。 -->
- [x] 8.2 逐批 costCheck 确认面板：该批价格 + 剩余批次数 + 累计已确认预算（D9 缓解项）
      <!-- 证据：batching 分支逐批卡片——每批 确认按钮（confirmBatch(i) 才调 production-run-batch，确认前零调用零计费，测试断言      run-batch 恰 1 次且仅在 confirmBatch 后）+ remainingBatchCount（pending/failed 批计数）+ confirmedShotCount（已确认批镜数合计，与 plan 估算同口径）；
      批负载含 aspect/seconds 选择（复用 video 面板 16x9/9x16/source 与 5/8/10s 枚举）；provider 缺失信封 errorCode=VIDEO_MODEL_NOT_CONFIGURED 透出引导文案。 -->
- [x] 8.3 批次进度视图：批/镜双层状态、失败镜单镜重试（复用 filmRetryShot）、断点续跑按钮、回收通道"先回收后精修"引导（D10）
      <!-- 证据：批列表 el-tag 状态（pending/running/done/failed）+ doneShots/shotCount 计数 + 总进度条（production-update 事件驱动，500ms 节流负载）；
      批明细展开显示逐镜状态，failed 镜显示重试按钮 → retryShotInBatch(runId=prod-<taskId>-b<idx> 确定性派生, prompt 由主进程取原文不随负载)；
      plan-ready/batching 均有 resumeBtn → pdResume 只读 production-status 双核恢复（noLedger 友好提示）；
      recycleAll 分片≤50/片调 download-recycled（orderIndex 全局连续，测试 120 镜 3 片）+ recycleGuide 文案。 -->
- [x] 8.4 全量交互回归：进度刷新不重置用户展开态、组件卸载监听清理；locales 成对
      <!-- 证据：applyStatus/applyProductionEvent 对 batches 就地 mutate 字段不重建数组（测试断言 c.batches.value === arr 引用相等），
      展开态 pdExpandedBatches 以 batchIndex 为键存组件本地 Set 不受进度刷新影响；doneCount Math.max 单调不回退；
      dispose() 清理 production/pipeline 双订阅 + poll 定时器（onBeforeUnmount 接线，测试覆盖 disposed 后事件忽略）；
      locales zh.js/en.js filmEngineering.production.* 各 44 键成对（check-locale-pair.js PAIR_OK + 占位符 PLACEHOLDER_OK，ICU 参数一致）。 -->

## 9. E2E 与真实冒烟

- [x] 9.1 CDP E2E（模拟 provider）：全量 kit 加载 → 分页浏览 → 12 镜全量出片（2 批过闸）→ manifest 合成 final.mp4 成功
  <!-- 证据：film-engineering.e2e-int.test.js 9.1a/9.1b（真实 kit 链 userData 全量优先 + 12 镜两批过闸 + 真实 ffmpeg concat final.mp4），3/3 通过；冒烟修复后全量回归 17 文件 220/220（2026-09-23） -->
- [x] 9.2 回收链路 E2E（POC 存活 URL）：5 镜下载验证 + 2 镜生成产物混合出片
  <!-- 证据：e2e-int 9.2（本机临时 HTTP 真实下载 + 混合 manifest）；另有 9.3 真实 cloudfront 5 镜回收超额覆盖 -->
- [x] 9.3 真实 provider 小规模冒烟：1 批（≤10 镜）重生成 + 5 镜回收混合成片，产物与过程证据落 `.agent_context/film-fix/` 并回填 change
  <!-- 证据：9.3-EVIDENCE.md + g9s-state.json（taskId=g9s-smoke-0923）：5 镜真实出批 done + 5 镜 cloudfront 回收 ok + compose run mud8v775_admc completed，final.mp4 ffprobe 实测 94.58s/1280x720/h264+aac。冒烟暴露 3 集成缺口（前四阶段不认 manifest / 成本闸误暂停 / runDir ENOENT），TDD 修复 RED 3-fail→GREEN 4/4（film-manifest-compose-run.test.js） -->
- [x] 9.4 QM-1 打包验证：`electron-builder --win --dir` 成功；确认全量 kit **未**入 asar（asar 清单抽查）、精简 kit 随包完好
  <!-- 证据：首轮三验证通过（2026-09-23 早）；冒烟修复后（electron/services 4 文件变更）再跑 --win --dir EXIT=0 + asar 清单抽查（全量 kit 不入包、精简 kit 完好），见 9.3-EVIDENCE.md -->

## 10. 文档与收尾

- [x] 10.1 文档：模块文档 + 用户指南（全量导入操作、两级 kit 行为、全量出片/回收流程、磁盘预期）、CHANGELOG
  <!-- 2026-09-23：新增 PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md（详版：CLI 操作/schema 校验/两级 kit/manifest 合同/出片流程/IPC 表/交互显示项/44 键提示文字/磁盘预期/闸边界）；ARCH-FILM-ENGINEERING 追加 §11；CHANGELOG 顶部条目；ipc-manifest 补 6 通道（download-recycled/production-plan/update event/run-batch/status/retry-shot）；learnings.md 沉淀段落。 -->
- [x] 10.2 OQ 处置：OQ1（非采纳版）/OQ2（会话级授权）/OQ3（图片扩充）显式标记 resolved/wontfix + 依据；design 假设记录回查
  <!-- 2026-09-23：design.md OQ1 wontfix / OQ2 deferred / OQ3 resolved（依据逐条写入原行）；假设记录 L3 验收基准的 2,795 旧口径同步修正为 6,558（并锚定 9.3 冒烟 94.58s 实证）。 -->
- [x] 10.3 spec 覆盖审计：delta 每需求每场景 ↔ 测试映射核查；proposal 基线 vs 现状差异复核（禁重复规格化）
  <!-- 2026-09-23：delta 5 需求/16 场景全映射——kit schema×3→kit-loader.test.js（两级链/fail-closed/上限边界）；查询契约×3→shot-library+service+IPC pageOpts 守卫（分页双形态）；合成合同×6→film-render(.manifest-int)+e2e-int（兼容/concat/normalize/聚合/越界拒绝/缺镜拒绝）；出片驱动×3→production-driver 19/19+film-video-checkpoint-integration（144→15 批/断点 probe/单批隔离）；下载通道×3→shot-downloader+e2e-int 9.2+9.3 真实 cloudfront。proposal 基线（2 ADDED+3 MODIFIED）与 delta 实际一致，renderManifest 上限 5,000→10,000 修正已回写，无重复规格化。 -->
- [x] 10.4 经验沉淀：本 change 踩坑/方法论写入 `.learnings/` 与记忆
  <!-- 2026-09-23：01-docs/learnings.md 顶部新增《真实冒烟是 mock 测试的照妖镜》段（三缺口/checkpoint:false 哨兵合同/IPC 节流/断点事实源/对账口径/工程环境坑）；外部记忆 ~/.gstack learnings.jsonl + EverOS :8000 add/flush 经脚本双写；内置记忆 UpdateMemory。 -->
- [x] 10.5 归档前置：1.1 的前置 change 状态、10.1-10.4 完成核查 + 无未勾任务后 archive 本 change
  <!-- 2026-09-23：前置 change film-engineering-video-gen 已于 e6bc371ca 归档（1.1）；10.1-10.4 完成核查全勾；openspec validate 通过后 archive 为 2026-09-23-film-full-corpus-production，主 spec film-engineering 同步（3 MODIFIED + 2 ADDED 需求并入）。 -->
- [x] 10.5 归档前置：1.1 的前置 change 状态、10.1-10.4 完成核查 + 无未勾任务后 archive 本 change
  <!-- 2026-09-23：前置 change film-engineering-video-gen 已于 e6bc371ca 归档（1.1）；10.1-10.4 完成核查全勾；openspec validate 通过后 archive 为 2026-09-23-film-full-corpus-production，主 spec film-engineering 同步（3 MODIFIED + 2 ADDED 需求并入）。 -->