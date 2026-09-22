# Design: 电影工程全量语料量产（film-full-corpus-production）

## Context

数据取证（2026-09-23，本地全量语料 `E:\hell-grind-full`，161 文件夹 / 155,123 job 逐行扫描）：

| 指标 | 数值 |
|------|------|
| 原片时长（kit filmMeta.durationSec） | 5,706s = 95.1 min |
| 视频 job 总数 | 133,083（seedance_2_0 占 132,242） |
| **唯一分镜提示词（按 prompt 去重）** | **2,795**（151 个含视频文件夹） |
| 当前 kit 导入镜数 | 153（每场景文件夹仅取 1 代表镜，`pick_representative`） |
| 丢失率 | 94.5% |
| 视频 job 平均时长 | 12.4s（params.duration 5~30s） |
| 采纳版信号 is_favourite | API dump 中全为 false，**不可用作筛选** |
| 每条 job 的 `results.min/raw.url` | HiggsField CDN 原片直链，可下载回收 |

现有约束：`MAX_VIDEO_BATCH=10`；`videoConcurrency` 默认 2；轮询 10s 间隔 / 单镜 10min deadline；`film_render` 以单 run 目录 `shot_NNN.mp4` 磁盘扫描 fail-closed；kit 随包 asar 且有 "<6MB 精选版" 历史预算；主 spec `prompt <= 20000` 与 kit 实际存在 39,470 字符镜矛盾（本 change 收口）。

**前置依赖**：`film-engineering-video-gen` change 的 `film-engineering` delta（含"成片合成与产物合同"）尚未 sync 进主 spec；本 change apply 前必须先完成该 change 的 sync/archive，specs delta 以合并后主 spec 为基线复核。

## Goals / Non-Goals

**Goals**
- G1（L1）：kit 全量导入——每场景全部唯一分镜（≈2,795 镜）+ 采纳版启发式 + 规格元数据（duration/宽高/画幅/model/resultUrl），数据落点迁至用户数据目录。
- G2（L2）：`film_render` 接受跨 run 的 renderManifest，保持磁盘为准 fail-closed 与既有拼接合同；单批模式零破坏。
- G3（L3）：全量分批出片驱动（自动切批、逐批过成本闸、台账续跑）+ 原片 resultUrl 下载回收通道，支持"回收做基准 + 重生成逐镜替换"混合工作流，终态可产出 95 分钟级全片 final.mp4。

**Non-Goals**
- 不处理 133k 全部迭代 job（只导唯一分镜采纳版）；不做图像类资产重导入（reference-registry 既有全量扫描保持）。
- 不做转场/调色/音轨等剪辑功能（render 合同保持"最小归一直拷"）。
- 不做多用户/云端分发；单用户本地数据规模（百 MB~GB 级）可接受。
- 不引入自动绕过成本闸的"一键全量授权"（保守逐批确认，见 D9）。

## Decisions

### D1: 三层一个 change，按 L1→L2→L3 依赖序分阶段交付
三层共享取证数据与契约面，拆三个 change 会让 renderManifest 契约来回改。tasks 按层分组，L1/L2 可先行合入交付（L1 单独即修复 94.5% 数据丢失，L2 单独即打通跨 run 合成），L3 依赖前两者。

### D2: kit 两级来源（asar 精简包 + userData 全量包）
全量 kit 由导入工具生成到**用户数据目录**（共享数据锚点下的 `film-kit/`，与 multi-publish.db 同级；git 外、不入 asar），体积预算解除（提示词库 ~30-60MB + 可选参考图）。加载器按 userData 全量 → asar 精简两级探测，各自独立 schema 校验；全量损坏回退精简并显式报错（不静默）。随包精简 kit 保留现状 153 镜，保证新装即用。
- 备选（全量直接入 asar）：否决——打包体积 +50MB 且每次更新重下；数据本质是用户本地资产。
- 备份归属：全量 kit 落锚点目录后自动被既有 `.backups` 快照机制覆盖，无需新增备份面。

### D3: 采纳版启发式 = 每唯一 prompt 的末次完成 job
去重键 = 规范化 prompt（trim + 折叠连续空白）的 SHA1；同键多 job 按 `created_at` 取最后一个 `status=completed` 且有 results 的为**采纳版**（作者最后迭代即定稿，与现行 pick_representative 的"取末次"哲学一致，只是粒度从文件夹细化到唯一 prompt）。`is_favourite` 经取证不可用（dump 全 false），不做依赖。shot 增加 `iterationCount`（该唯一 prompt 的 job 数）与 `adoptedJobAt` 供人工复核排序。

### D4: prompt 上限收口 FILM_PROMPT_MAX_LEN = 50000
主 spec 的 20,000 与 kit 既有 39,470 字符镜、fetch 脚本注释"上限 50000"三方矛盾。统一为导出常量 50,000（导入器、loader schema、IPC 校验、前端展示截断阈值引用同一常量），spec 同步修订（见 delta）。超限镜导入时拒绝并报告（语料实测最大 39,470，无实际受害者）。

### D5: renderManifest 契约与受控根校验
`context.renderManifest: [{ shotId, path, sourceKind: 'generated'|'downloaded', orderIndex }]`，`orderIndex` 从 0 连续。path 必须落在 `film-engineering/` 媒体根内：fs 实时 `realpath` 规范化后前缀比对（复用 story2video media-paths 模式），拒绝符号链接/junction 逃逸出根。无 manifest 时走既有 selectedShots 单批路径——**代码路径分叉仅在输入解析层，拼接引擎（规格探测→直拷/归一）完全复用**。manifest 规模上限 5,000 条（防御性，语料 2,795）。

### D6: 批次台账持久化（断点续跑的唯一事实源）
全量出片任务在 userData `film-engineering/production/<taskId>/ledger.json` 记录：批次清单（batchIndex → runId → shotIds → 每镜状态）。重入协议：读台账 → 对"已完成"批次做**磁盘产物存在性复核**（不信台账内存态）→ 仅对未完成镜发起调用。这与既有"merge 信磁盘不信内存态"（video-gen D 系决策）同构。应用崩溃/重启后 UI 从台账恢复进度视图。

### D7: 下载通道安全合同
仅 https；Host 限定 kit resultUrl 来源域（导入时登记 `higgsfield` CDN 域到 kit 元数据的 allowedHosts，下载器只信该清单，不通配）；单文件上限 500MB、总并发 4、流式写 `.part` 临时文件，ffprobe 验证通过才 rename 为正式片段（杜绝半成品入库）；失败/超时删除临时文件并标记该镜。UI 显式触发，禁止浏览时自动预取。

### D8: 大规模列表虚拟化 + 查询分页
2,795 镜与单场景 241 镜使现有三栏浏览需要：listShots 分页（limit/offset + total，见 specs）；前端分镜列表虚拟滚动；分镜树计数直接取 manifest scenes[].count（全量导入后 count 即真实镜数，无需新接口）。

### D9: 成本闸保持逐批确认（不做批量放行）
144 镜全量 = 15 批 = 15 次 costCheck 确认。保守决策：成本闸是计费护栏，跨批"一次授权全部"会让单批超支预期失效。缓解：确认面板显示"剩余批次数与累计已确认预算"，减少用户心智负担；若实测 15 次点击不可接受，后续 change 再评估会话级授权（记 OQ2）。

### D10: 混合工作流（回收基准 + 生成替换）为推荐路径
B 通道（原片回收）零生成成本、几分钟可得 95 分钟基准成片；A 通道（重生成）逐镜替换不满意的镜。manifest 的 `sourceKind` 使两源混排天然成立；替换某镜 = 生成新产物 + 更新 manifest 该条目 path。此工作流为 UI 默认引导（"先回收、后精修"）。

## Risks / Trade-offs

- **CDN 链接时效**：resultUrl 可能已过期/需要签名。缓解：回收通道失败逐镜降级生成路径；实施任务含"10 镜下载 POC 先行"，若 POC 证实 URL 全灭，L3 范围收缩为纯生成路径（不动 L1/L2）。
- **墙钟时长**：144 镜重生成按并发 2、单镜 deadline 10min，最坏 15 批 × 5 波 × 10min ≈ 12.5 小时（免费档）。台账续跑使其可跨天执行。
- **磁盘占用**：2,795 镜全回收 ≈ 数十 GB；UI 显示占用估算并在发起时提示；产物清理沿用媒体根既有清理策略。
- **IPC 负载**：单镜 prompt 最大 39k 字符，全量列表响应需分页上限保护（specs 已定）。
- **schema 演进**：两级 kit + 扩展字段使校验面变大；用同一 loader 单测矩阵（精简包/全量包/损坏回退）覆盖。

## Migration Plan

1. L1 先行：导入工具产出全量 kit 到 userData；老版本应用（无两级加载）不受影响（只读 asar）。回滚 = 删 userData kit 目录即回精简包。
2. L2 纯增量：无 manifest 时行为不变，可直接合入。
3. L3 依赖 L1（数据）+ L2（契约）。
4. 主 spec 同步时"film-kit 数据资产 schema"需求为 MODIFIED，归档前需确认无并发 change 修改同一需求。

## Open Questions

- OQ1：全量 kit 是否包含非采纳版（同 prompt 中间迭代）以供对比浏览？默认**不包含**（只导采纳版，`iterationCount` 记录迭代数）；如需再开 delta。
- OQ2：D9 的会话级批量授权是否值得做？待逐批确认实测痛感后定。
- OQ3：参考图目录（images/）是否随全量导入扩充？默认维持精选 36 张，图片预算另立任务。

## 假设记录（grilling 结论外的自主判断）

- "多场景压缩镜"表述修正：Scene 42-50 等是原作者文件夹命名（一场内多镜），非提示词压缩；真实丢失机制 = 每文件夹只导 1 镜（D3 已细化到唯一 prompt）。
- 2,795 为"唯一视频分镜"口径（视频 job 的 prompt 去重）；图像 job 的 prompt 不计。
- L3 的"全片"验收基准：以 Hell Grind 采纳版全集（≈2,795 镜中用户勾选子集）经 manifest 合成可播放 final.mp4，时长与所选镜 durationSec 之和一致。
