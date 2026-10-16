# PRD：采集页知乎收藏批量采集与批量发布/视频（zhihu-fav-batch）

> 立项日期：2026-10-03 ｜ 分支：`zhihu-fav-batch` ｜ Worktree：`mp-worktrees/mp-zhihu-fav-batch`（已按 R1-R5 清理，路径改为相对写法以免留下失效绝对路径）
> 状态：实现中（本文档随实现同步收口）
> 上游功能：`zhihu-favlist`（2026-09-18 PR #1986 合入的最小可用版本，此后零迭代）

> **2026-10-15 凭据来源变更（zhihu-api-settings）**：本文档中「Access Secret 由采集页输入框提供」的设计**已被取代**。
> 密钥改在「设置 → 知乎 API」分区配置，按登录用户隔离并以 safeStorage 加密存储；采集页不再就地输入，
> 只显示凭据状态（徽标 + 遮罩）与「前往设置」出口。解析优先级为「本用户加密配置 > 旧版全局明文（只读兼容）」，
> 旧明文在用户保存/清除时销账。详见 `01-docs/PRD-ZHIHU-API-SETTINGS-2026-10-15.md`。
> 下文 §2.1 的 `accessSecret` 行与 §3.1 的采集页交互描述按新口径阅读。

---

## 0. 背景与摸底结论

2026-09-18 合入的「知乎收藏夹批量采集」（`zhihu-favlist-service.js` + `ipc-handlers/zhihu-favlist.js` + `Collection.vue`）是一次性合入、此后零迭代的最小可用版本。12 维 Gap 核查结论：

| # | 维度 | 现状 | 本次处置 |
|---|------|------|---------|
| 1 | 采集范围 | 仅支持单个收藏夹；无「全部收藏」聚合 | 新增（A1） |
| 2 | 数量参数 | 无数量 N；favTime 透传未消费、无排序 | 新增（A2/A3） |
| 3 | 全量模式 | 分页到 IsEnd，2500 条封顶，无终点反馈 | 新增显式开关 + 200 封顶（A2） |
| 4 | 内容类型 | 不分类型一律抽 URL；想法/视频无解析 | 降级语义（B2/B3/B4） |
| 5 | 正文图片 | 零图片处理，正文纯文本，img 全丢 | 新建本地化工具（C1） |
| 6 | 去重 | 仅内存 ContentCache；渲染层无去重、无已采集标记 | 新增持久化去重（C2） |
| 7 | 批量发布图文 | 无多选、无批量通道 | 新建（D3/D4） |
| 8 | 批量生成视频 | S2V 批量队列与采集结果零打通 | 新建衔接（D4/D7） |
| 9 | 批量发布视频 | 不存在 | 新建（D4/D7） |
| 10 | 进度与失败 | 无 IPC 进度事件（违反双边界契约）；**P0 字段丢失 bug** | 修复 + 补齐（C3/D6） |
| 11 | batch-rewrite | **黑盒**：结果写入后全仓无展示/消费点 | 接通（C3/D2） |
| 12 | UI | Secret 输入/下拉/批量采集/改写/取消已有 | 扩展直选清单（D1） |

本次任务 = 修复（P0 bug + 改写黑盒）+ 补齐（范围/数量/去重/图片/进度）+ 打通（采集 → 自动改写 → 批量发布图文/生成视频/发布视频）。

## 0.1 术语约定

| 术语 | 定义 |
|---|---|
| 收藏夹清单 | 从官方 API 拉取的收藏条目**预览列表**（标题/类型/收藏时间/作者/链接/已采集标记），仅登记元数据，不含正文 |
| 采集 | 通过 url-collector 拉取正文并入库 collected_items 的动作 |
| 已采集标记 | collected_items 中已存在同 sourceUrl 的条目（见 C2 去重语义） |
| 自动改写 | 「采集并改写」动作内，每条采集成功后自动触发 AI 改写，写回 `rewrittenContent` 并在 UI 展示 |
| 改写失败回退 | 单条改写失败/超时/空结果时保留原文继续，条目标注「改写失败用原文」，结束汇报计数 |
| 本批 | 单次「采集并改写」动作产出/更新的条目集合（用于「本批生成 → 本批发布视频」） |
| 图文型条目 | 含正文的回答/文章/专栏/想法登记条目；视频型条目不属图文型 |

## 0.2 决策记录（用户拍板，Q 编号对应拷问轮）

| 决策 | 内容 | 来源 |
|---|---|---|
| Q1/A1 | 知乎侧真实收藏夹：全部收藏流 + 指定收藏夹两种范围 | 第一轮 |
| Q2/A2 | N ∈ 1–100 默认 50；倒序取最新 N 篇；全量模式独立开关；不做时间范围过滤 | 第一轮 |
| Q3/B1-B4 | 回答+文章正文采集；专栏单条登记；想法仅登记；视频型仅登记不发布 | 第一轮+Q28/Q29 |
| Q4/C1 | 图片本地化可配置，默认开；失败回退原链并标注 | 第一轮 |
| Q5 | 不做版权提示、不强制出处，发布内容由用户负责 | 第一轮 |
| Q6/D8 | 全平台清单，按内容形态自动预筛 | 第一轮 |
| Q7 | 复用 Story2Video 批量投入，视频型条目跳过并提示 | 第一轮 |
| Q8/B4 | 发布平台全清单；视频型收藏第一版不下载不发布 | 第一轮 |
| Q9/D4 | 三个独立按钮，无一条龙 | 第一轮 |
| Q10/C2 | URL 全局去重 + 已采集标记 + 强制重采开关 | 第一轮 |
| Q11/D9 | 跳过继续+结束汇报；数量不符明确提示 | 第一轮 |
| Q12/D6 | 整体进度条 + 可展开逐条清单 | 第一轮 |
| Q13 | worktree `mp-zhihu-fav-batch`、分支 `zhihu-fav-batch` | 第一轮 |
| Q15 | 独立 PRD + 主 PRD 索引条目 | 第一轮 |
| Q16/D1/D2 | **直选式**：拉取收藏夹清单勾选条目；采集后**自动改写**（用户调整项） | 第二轮 |
| Q17/D3 | 多选对所有采集来源通用 | 第二轮 |
| Q18/D2 | 改写自动执行（并入 Q16 调整），改写失败回退原文 | 第二轮 |
| Q20/D5 | 三个批量动作执行前均二次确认（条数×平台×账号，无版权文案） | 第二轮 |
| Q21/A2 | 全量模式 200 封顶，超出提示分批 | 第二轮 |
| Q22/D7 | 「本批已生成 N 个视频」仅本批可勾选→批量发布视频 | 第二轮 |
| Q23/C2 | 历史重复数据不清洗，只做增量去重 | 第二轮 |
| Q24/A4 | 用户 Access Secret 可用且实际跑通过，真机可实测 | 第二轮 |
| Q25/C3 | P0 bug 必修 + 改写黑盒必须接通 | 第二轮 |
| Q26/D3 | 发布内容一律用改写稿；无改写稿/改写失败的条目用原文并标注 | 第二轮 |
| Q27/D6 | 采集进度=页面内进度卡（HotTopics 模式）；发布/生成进度走 App 级面板 | 第二轮 |
| Q28/B2 | 专栏第一版按单条采集，展开为后续增强 | 第二轮 |
| Q29/B3 | 想法第一版仅登记不解析正文 | 第二轮 |
| Q30/D7 | 批量生成视频单批 ≤10 条 | 第二轮 |
| Q31/A4 | 同 Q24 | 第三轮 |
| Q32/A1 | 全部收藏=遍历所有收藏夹合并去重（API 列表上限 50 个、无分页，PRD 写明） | 第三轮 |
| Q33 | 用户旅程 ①选范围+数量 → ②拉清单 → ③勾选→采集并改写 → ④多选→批量动作→确认→执行 | 第三轮 |

---

## 1. 用户旅程（Q33 确认）

```
① 选范围（全部收藏 / 某收藏夹）+ 设数量 N（或全量开关）
        ↓
② 拉取收藏夹清单（元数据预览：标题/类型/收藏时间/作者/已采集标记）
        ↓
③ 勾选条目 → 点「采集并改写」
        ↓  后台逐条：采集正文（+图片本地化）→ 自动 AI 改写（失败回退原文并标注）
        ↓  进度卡实时反馈（整体进度条 + 可展开逐条状态清单）
        ↓
④ 采集结果列表（全来源通用多选）→ 点三个批量按钮之一：
   a. 批量发布图文 → 确认框 → batchCreate/batchExecute → App 级进度面板
   b. 批量生成视频 → 确认框 → story2video-batch-queue → 完成后"本批已生成"
   c. 批量发布视频 →（对本批已生成视频）确认框 → batch 通道（video_path）
```

## 2. 数据校验

### 2.1 采集范围与数量

| 字段 | 类型/枚举 | 默认 | 校验规则 | 违规提示（zh） |
|---|---|---|---|---|
| `scope` | `all` \| `favlist` | `favlist` | 非法枚举拒绝 | 「采集范围无效」 |
| `urlToken` | string | — | scope=favlist 时必填；scope=all 时忽略 | 「请先获取收藏夹并选择一个收藏夹」 |
| `count` | number | 50 | 整数 1–100；全量模式下忽略 | 「采集数量需在 1–100 之间」 |
| `fullMode` | boolean | false | true 时 count 失效，上限 200 | 「全量采集上限 200 条，超出请分批」（触发即中止并提示，不部分执行） |
| `forceRecollect` | boolean | false | true 时已采集条目重新采集并覆盖更新原条目 | — |
| `imageLocalization` | boolean | true | 可配置开关（C1） | — |
| `accessSecret` | string | 本用户加密配置 `zhihu_api_config`（旧版明文 `zhihu_access_secret` 只读兼容） | 缺失时禁止拉取清单 | 「请先在「设置 → 知乎 API」中配置 Access Secret」 |

### 2.2 收藏夹清单拉取（②）

| 校验项 | 规则 | 提示（zh） |
|---|---|---|
| Secret 有效性 | API 401/403 → 归一错误 | 「Access Secret 无效或已过期，请检查设置」 |
| 频率限制 | 错误码 30001 → 可重试（沿用 service 归一） | 「知乎接口频率受限，请稍后重试」 |
| 每日配额 | 错误码 30002 → 不可重试 | 「今日知乎接口配额已用尽，请明日再试」 |
| 收藏夹数量 > 50 | API 硬约束：列表仅返回前 50 个、无分页（service 文件头注释） | 「收藏夹超过 50 个，仅显示前 50 个（平台接口限制）」 |
| 全部收藏为空 | 所有收藏夹内容条数为 0 | 「收藏夹暂无内容」 |
| 数量不符 | 申请 N 篇但清单实际 < N：按实际数量处理并明确提示 | 「该范围共 X 条（少于申请的 N 条），已全部列出」 |

### 2.3 采集与改写执行（③）

| 校验项 | 规则 |
|---|---|
| 未勾选提交 | 「请先勾选要采集的条目」 |
| 勾选数 > 100 | 「单次最多采集 100 条，请分批勾选」 |
| 已采集条目 | 默认跳过并计入汇报；`forceRecollect=true` 时重采并覆盖原条目（保留原 id/createdAt，更新 content/coverImage/rewrittenContent/updatedAt） |
| 单条采集失败 | 跳过继续（Q11），原因归类：内容被删除 / 仅自己可见（匿名采集上下文无凭证，预期失败类型）/ 解析失败 / 超时 |
| 单条改写失败 | 保留原文继续（D2），条目标注 `rewriteFailed: true` |
| 改写风格 | 沿用现有风格下拉 5 枚举；非法值回退默认 |
| 任务互斥 | 沿用 code -3：同类型任务进行中拒绝并发 |
| 内容完整性 | 采集结果无标题且无正文 → 标记异常条目不入 collected_items，计入失败汇报 |

### 2.4 批量动作（④）

| 校验项 | 规则 | 提示（zh） |
|---|---|---|
| 未勾选条目 | 禁止 | 「请先勾选内容条目」 |
| 图文平台全不支持 | 勾选条目均为视频型/无正文 | 「所选条目暂无可发布的图文平台」 |
| 发布账号未选择 | 发布类动作需要 | 「请至少为一个平台选择账号」 |
| 生成视频勾选 > 10 | D7 | 「单批最多生成 10 个视频，请分批」 |
| 生成视频含视频型条目 | 跳过并在确认框中列出 | 「N 条视频型内容将跳过（暂不支持）」 |
| 生成模型缺失 | 沿用 CreateView 现成提示逻辑 | 「未检测到可用的图像/语音模型，请先在设置中配置」 |
| 批量发布视频无本批产物 | 本批无已完成视频 | 「本批尚无已生成的视频可发布」 |
| S2V 队列占用 | 现有批量队列运行中 | 沿用现有排队/互斥语义 |

## 3. 流程与功能逻辑

### 3.1 收藏夹清单拉取（新增/改造 `zhihu-favlist-service.js` + IPC）

1. **scope=all**：`listFavlists()` 取回全部收藏夹（≤50 个）→ 逐收藏夹调 `getFavlistContents`（复用现有分页遍历）→ 合并全部条目 → 按 `urlToken+itemId`（无则 URL）去重 → 按 `favTime` 降序排序 → 截取前 N（或全量 ≤200）。
2. **scope=favlist**：单收藏夹分页遍历 → favTime 降序 → 截取。
3. 每条清单项字段：`{ itemId?, url, title, contentType, summary, favTime, likeCount, kind, collected: boolean }`（`kind` 由 `classifyZhihuUrl(url)` 判定：answer/article/pin/video/column/unknown；`collected` 由渲染层比对 collected_items 的 sourceUrl 集合得出；官方 API 不返回作者字段，显示用 likeCount 替代）。
4. 清单项**只读元数据**，不触发正文采集、不计入 ContentCache、不消耗反爬预算。
5. 超量截断必须反馈：`truncated: true` + 提示文案（§2.2/§5）。

### 3.2 「采集并改写」编排（改造 `zhihu-favlist:batch-collect` 语义或新增通道 `zhihu-fav-batch:run`，实现时择一，契约如下）

1. 输入：`{ scope, urlToken?, count?, fullMode, forceRecollect, imageLocalization, rewriteStyle, items: [{url, itemId, contentType}] }`（items=用户勾选的清单条目）。
2. 主进程串行逐条（BatchRateController 默认 8s+4s 抖动、退避 30s×2、3 次熔断、支持取消）：
   - **start 边界**：发 IPC 进度事件 `{phase:'start', index, total, url}`（对齐批量进度双边界契约）；
   - 采集：urlCollector（`manual:false`）；
   - 内容类型路由：zvideo → 不采集正文，登记视频型条目（`kind:'video'`）；pin → 仅登记（`kind:'pin'`，无正文）；专栏 → 单条登记（标题+简介+链接）；
   - 图片本地化（imageLocalization=true 且为图文型且采集器返回 imageUrls）：下载正文内联图片到 `{userData}/collected-images/<sha8>/`，Referer 伪装 `https://www.zhihu.com/`（zhimg 防盗链）；**正文为纯文本，不做内联引用改写**——本地路径写入条目 `images: [本地路径]` 数组（与发布侧 ARTICLE_FIELDS.images 契约对齐，可直接供图文平台发布使用）；单图失败该图回退记录进 `imageFallbacks: [原链]`；
   - 去重判定（C2）：sourceUrl 已存在于 collected_items 且 !forceRecollect → 跳过采集，结果记 `skipped_duplicated`；
   - 自动改写（图文型且采集成功）：单条 rewrite（复用 Python `/aggregation/rewrite`，风格=rewriteStyle）→ 成功写 `rewrittenContent`；失败/超时/空结果 → `rewriteFailed:true` 保留原文；**done 边界**：发 `{phase:'done', index, total, result:{status, reason?}}`；
3. 汇总终事件：`{phase:'summary', success, failed, skipped, rewriteFailed, duplicateSkipped, total, cancelled?, circuitBroken?}`。
4. 进度事件通道：新增 `zhihu-fav-batch:progress`（webContents.send 推送），渲染端订阅（复用 asr-install:progress 先例模式）。保留现有 `zhihu-favlist:cancel` 取消语义并扩展到新编排。
5. 结果入库：成功条目 unshift 进 collected_items（渲染层，与现有批量采集一致），**必须经 `normalizeCollectedItem` 单一出口**（修复 9 处构造点中本链路的构造），新增字段：`kind`（article/answer/column/pin/video）、`rewrittenContent`、`rewriteFailed`、`imageFallbacks`、`favTime`、`batchId`（本批标识，uuid）。

### 3.3 去重与已采集标记（C2，新增 `features/collection/dedupe.js` 或等价模块）

1. 真源：collected_items 的 `sourceUrl` 集合（渲染层内存 + settings 持久化同步）。
2. 清单拉取时标记 `collected`；采集编排时主进程以 IPC 查询或渲染层预过滤（实现时按层职责定，PRD 锁行为：**已采集默认跳过 + 强制重采开关生效 + 汇报含 duplicateSkipped 计数**）。
3. 历史重复数据不清洗（Q23A）：只做增量判定。
4. 内存 ContentCache 的 cache_hit 空内容绕过问题：本链路对 cache_hit 结果视为失败处理（不产生空壳条目），并在 PRD 记录该已知行为。

### 3.4 批量发布图文（D4a，新建渲染端衔接 `useCollectionBatchPublish` 或等价 composable）

1. 勾选条目（collected_items 多选，全来源通用）→ 校验（§2.4）→ 确认框（条数×平台×账号）→ 构造 `batchCreate` articles：`{title: 改写稿标题||原标题, content: rewrittenContent||content, cover: coverImage→cover_url 映射, images: 本地化图片路径列表, batchId}`。
2. **发布内容一律改写稿**（Q26C）：`rewrittenContent` 非空用改写稿；为空（未改写/改写失败）用原文并在确认框列出「N 条将使用原文」。
3. 发布通道：现有 `batchCreate → batchExecute → taskQueue`（useBatchPublish 的主进程契约），平台×账号由发布页既有选择器决定；**平台清单按条目形态预筛**（D8：纯视频平台不出现在图文条目的平台选择中）。
4. 进度：App 级 publishProgress store + PublishProgressPanel（零新增，自动获得失败重试/落历史/失败草稿回存）。
5. **封面字段修复**：采集条目→发布草稿映射补 `coverImage → cover_url`（摸底发现的字段名断裂，本 PR 一并修复，附回归测试）。

### 3.5 批量生成视频（D4b）

1. 勾选图文型条目 → 校验（≤10、模型存在、视频型跳过列出）→ 确认框 → 调 `story2video:batch:create`，texts = 改写稿||原文（与 3.4 同一取稿规则）。
2. 沿用批量队列：并行 2、单批 ≤10、固定全自动模板、不注入 publish 配置（只生成不发布）。
3. 进度：CreateView 既有 3s 轮询 + `pipeline:update` 推送模式；Collection 页内显示「已提交批量生成：N 条」+ 跳转链接。
4. **本批产物绑定**（D7/Q22）：生成完成的 run（projectId + videoPath）记入 `本批生成清单`（内存 + 随批次持久化）；「批量发布视频」仅对本批产物开放勾选。

### 3.6 批量发布视频（D4c）

1. 对本批已生成视频勾选 → 确认框 → 构造 batchCreate articles `{video_path: project.videoPath, title, cover}` → batchExecute（视频任务 30min 超时既有契约）。
2. 平台预筛：仅视频类平台（douyin/tencent_video/kuaishou/youtube/tiktok/bilibili + MIXED）。
3. 本批无产物时禁用按钮 + §2.4 提示。

### 3.7 P0 缺陷修复（C3a，QM-5 五步）

| 步骤 | 内容 |
|---|---|
| ① 根因溯源 | `Collection.vue:786` `...x.data.data` 多一层 `.data`；引入点 `f7fde3df`（2026-09-18 首次合入），当时 IPC 结果形状为 `{index, ok, data: collectorResult}`，代码误写两层取值，意图是展开采集结果 |
| ② 逃逸分析 | 单元层：`Collection.test.js:1388-1406` 的 mock 写成扁平 `{data:{...}}` 与真实 IPC 形状不一致（Mock 边界漏洞）→ 断言只查 length 未查字段（断言不精确）→ 双重失效；集成/E2E 层：无收藏夹批量采集端到端用例（无测试）；审查层：合入 PR #1986 评审未覆盖结果映射（审查盲区） |
| ③ 系统性漏洞 | Mock 形状与真实 IPC 契约无一致性校验（测试覆盖漏洞 + Mock 边界漏洞）；修复处：新增回归测试使用**与 zhihu-favlist.test.js handler 相同的真实返回形状**构造 mock |
| ④ 修复+回归 | `...x.data` 修正；回归测试断言入库条目 title/content/sourceUrl 非空（精确断言，非 length） |
| ⑤ 预防措施 | 本 PRD §3.2 结果入库强制 `normalizeCollectedItem` 单一出口（AGENTS.md 已有契约，本链路接入）；learnings.md 记录「mock 形状必须复制 handler 真实返回形状」教训 |

### 3.8 改写黑盒接通（C3b）

1. `rewrittenContent` 在采集结果卡片展示（改写稿/原文切换或折叠展示，实现定，PRD 锁行为：**用户可见改写结果**）。
2. 文案库（copy_library）写入：自动改写成功条目同步 `fromKey='collect:<id>'` 写入改写文案库（复用现有幂等：同来源仅留最新）。
3. 现有「批量改写」按钮保留（手动触发、优先本次清单来源），与新自动改写共用 style 枚举与通道，互斥由任务互斥码 -3 保证。

## 4. 交互逻辑

| 场景 | 交互 |
|---|---|
| 选范围 | 收藏夹区块顶部新增范围单选：「指定收藏夹」（默认）/「全部收藏」；选 all 时收藏夹下拉禁用置灰 |
| 数量输入 | number 输入框（1–100，默认 50）+「全量（≤200）」checkbox；勾选全量时数量框禁用 |
| 拉取清单 | 「获取收藏夹」按钮行为不变；新增「加载收藏内容」按钮 → 拉取清单并渲染预览列表（虚拟滚动或分批渲染，清单 >100 条时） |
| 清单项勾选 | checkbox 单选/全选/反选；已采集条目 checkbox 默认不勾且显示「已采集」标记；「包含已采集」开关（=forceRecollect）打开后可勾选 |
| 采集并改写 | 主按钮；进行中变「采集中...」并显示取消按钮；进度卡（D6）：整体 el-progress（x/N）+ 可展开逐条清单（状态图标：✅成功/❌失败(原因)/⏭跳过(重复)/✍️改写失败用原文）+ 单条重试按钮（失败项） |
| 结果多选 | 采集结果卡片列表头部新增全选 checkbox + 计数；卡片左侧 checkbox；勾选后底部浮出批量操作条（三个按钮 + 已选计数） |
| 确认框 | 三个批量动作统一 ElMessageBox.confirm：列出「将处理 N 条 × 平台 M 个 × 账号 K 个」+（发布图文时）「其中 X 条将使用原文」+（生成视频时）「M 条视频型内容将跳过」；无任何版权/出处文案（Q5C） |
| 批量发布视频入口 | 仅当本批存在已完成视频时可用；显示「本批已生成 N 个视频」清单供勾选 |
| 旧入口兼容 | 现有「批量采集」（按收藏夹整夹直采）与「批量改写」按钮保留，与本新流程并存；新旧互斥由任务互斥码保证 |

## 5. 显示项与提示文字（locale zh/en 成对）

### 5.1 显示项

| 位置 | 显示项 |
|---|---|
| 清单预览行 | checkbox、标题（超长省略）、类型徽标（回答/文章/专栏/想法/视频）、收藏时间（YYYY-MM-DD HH:mm）、赞数、「已采集」标记 |
| 进度卡 | 整体进度条 + x/N 文案 + 展开/收起逐条清单 + 取消按钮 |
| 批量操作条 | 「已选 N 条」+ 三按钮（批量发布图文/批量生成视频/批量发布视频[条件可用]）|
| 汇总条 | 「完成：成功 X · 失败 Y · 跳过重复 Z · 改写失败 W（已取消/已熔断 后缀）」 |
| 条目标注 | 「改写失败用原文」「N 张图片回退原链」「视频型·暂不支持发布」「想法·暂不支持正文采集」 |

### 5.2 提示文字（全部进 `src/locales/zh.js` + `en.js` 成对，禁止渲染端硬编码中文）

| key（建议） | zh | en |
|---|---|---|
| `collection.zhihuFav.scopeAll` | 全部收藏 | All favorites |
| `collection.zhihuFav.scopeFavlist` | 指定收藏夹 | Specific favlist |
| `collection.zhihuFav.loadContents` | 加载收藏内容 | Load items |
| `collection.zhihuFav.collectAndRewrite` | 采集并改写 | Collect & rewrite |
| `collection.zhihuFav.countPlaceholder` | 采集数量（1-100） | Count (1-100) |
| `collection.zhihuFav.fullMode` | 全量采集（≤200） | Full collection (≤200) |
| `collection.zhihuFav.fullModeCap` | 全量采集上限 200 条，超出请分批 | Full collection capped at 200; split into batches |
| `collection.zhihuFav.includeCollected` | 包含已采集（强制重采） | Include collected (force re-collect) |
| `collection.zhihuFav.favlistsCapped` | 收藏夹超过 50 个，仅显示前 50 个（平台接口限制） | Only the first 50 favlists are shown (platform limit) |
| `collection.zhihuFav.fewerThanRequested` | 该范围共 {actual} 条（少于申请的 {requested} 条），已全部列出 | {actual} items found (fewer than {requested} requested); all listed |
| `collection.zhihuFav.markCollected` | 已采集 | Collected |
| `collection.zhihuFav.noSelection` | 请先勾选要采集的条目 | Select items to collect first |
| `collection.zhihuFav.selectionCap` | 单次最多采集 100 条，请分批勾选 | Up to 100 items per batch |
| `collection.zhihuFav.progressSummary` | 完成：成功 {success} · 失败 {failed} · 跳过重复 {skipped} · 改写失败 {rewriteFailed} | Done: {success} ok · {failed} failed · {skipped} duplicates · {rewriteFailed} rewrite failed |
| `collection.zhihuFav.rewriteFailedBadge` | 改写失败用原文 | Rewrite failed, using original |
| `collection.zhihuFav.imageFallbackBadge` | {count} 张图片回退原链 | {count} images fell back to original URLs |
| `collection.zhihuFav.kindVideo` | 视频 | Video |
| `collection.zhihuFav.kindPin` | 想法 | Pin |
| `collection.zhihuFav.kindColumn` | 专栏 | Column |
| `collection.batch.noSelection` | 请先勾选内容条目 | Select items first |
| `collection.batch.publishImages` | 批量发布图文 | Batch publish as posts |
| `collection.batch.generateVideos` | 批量生成视频 | Batch generate videos |
| `collection.batch.publishVideos` | 批量发布视频 | Batch publish videos |
| `collection.batch.confirmTitle` | 确认批量操作 | Confirm batch action |
| `collection.batch.confirmBody` | 将处理 {items} 条 × {platforms} 个平台 × {accounts} 个账号 | {items} items × {platforms} platforms × {accounts} accounts |
| `collection.batch.originalFallbackNote` | 其中 {count} 条将使用原文 | {count} item(s) will use original text |
| `collection.batch.videoSkipNote` | {count} 条视频型内容将跳过（暂不支持） | {count} video-type items will be skipped |
| `collection.batch.videoGenCap` | 单批最多生成 10 个视频，请分批 | Up to 10 videos per batch |
| `collection.batch.noVideosInBatch` | 本批尚无已生成的视频可发布 | No generated videos in this batch yet |
| `collection.batch.noImagePlatforms` | 所选条目暂无可发布的图文平台 | No image-text platforms available for selected items |
| `collection.batch.needAccount` | 请至少为一个平台选择账号 | Select at least one account |
| `collection.batch.batchGenerated` | 本批已生成 {count} 个视频 | {count} videos generated in this batch |

（表为契约清单；实现时允许 key 命名微调，但 zh/en 必须成对、语义一致，过 Gate 7 locale-sync。）

## 6. 错误处理与可观测性

1. 所有 IPC handler try/catch，错误经现有 `classifyCollectError`/`formatUserError` 归一，禁止直出后端 message。
2. 进度事件双边界（start/done）+ summary 终事件；主进程 logger 记录逐条耗时与失败原因（不含用户正文内容）。
3. 取消：复用 `zhihu-favlist:cancel`；取消后已成功条目保留入库，汇总标注「已取消」。
4. 熔断：BatchRateController 连续 3 次退避后熔断中止，汇总标注「已熔断」+ 建议「稍后再试」。

## 7. 非功能需求

1. **频控**：采集串行 8s+4s 抖动（既有默认）；自动改写单条间隔 ≥3s+2s（与现 batch-rewrite 一致）；总时长预期：50 条 ≈ 50×(采集 5–15s + 改写 5–10s + 间隔 8–12s) ≈ 25–35 分钟，进度卡必须可见可取消。
2. **性能**：清单预览 >100 条分批渲染；collected_items 持久化沿用 settings JSON（本 PR 不迁移存储）。
3. **安全**：Access Secret 沿用既有存储键与掩码输入；图片落盘仅 userData 内；不改许可白名单（新 IPC 通道如需注册到 license-access-control.js，按 zhihu-favlist 先例登记为未登录可用级）。
4. **i18n**：所有新增用户可见文案 zh/en 成对。
5. **测试策略**（TDD 先红后绿）：service 层（scope=all 合并去重排序/截断/上限）、IPC 层（参数校验/进度双边界/取消/互斥，mock 使用真实返回形状）、渲染层（清单勾选/已采集标记/批量条构造/封面字段映射/改写稿优先）、回归锁（P0 字段丢失、coverImage→cover_url）。

## 8. 验收标准

1. 全部收藏：多收藏夹合并清单按 favTime 倒序、去重、按 N 截断；收藏夹 >50 有提示。
2. 指定收藏夹：清单含类型徽标/收藏时间/已采集标记；勾选 → 采集并改写 → 结果含正文与改写稿。
3. 已采集条目默认跳过且汇报计数；强制重采覆盖原条目。
4. 改写失败的条目保留原文且卡片可见标注；改写成功条目发布时用改写稿。
5. 批量发布图文：确认框数值正确；发布走 batch 通道，App 级面板可见进度与失败重试；封面不再丢失。
6. 批量生成视频：≤10 条、视频型跳过列出；完成后本批视频可勾选批量发布。
7. 图片本地化：默认开，正文图片本地引用；断网/防盗链失败回退原链并标注。
8. 进度卡双边界事件可见；取消/熔断语义正确。
9. QM-1 打包验证通过；locale Gate 7 通过；全量相关测试绿。
10. 真机验证（用户 Secret 可用）：至少完成「指定收藏夹 N=5 → 采集并改写 → 批量发布图文到 1 个平台」全链路一次。

## 9. 范围外（明确不做）

- 专栏展开为其下文章（后续增强）；想法正文解析；视频型收藏下载与发布；时间范围过滤；一键全链路；版权/出处提示；历史重复数据清洗；collected_items 存储结构迁移。

## 10. 文档与流程绑定

- 本 PRD 登记进 `01-docs/PRD.md` §19.2 子 PRD 索引。
- 质量节拍完整模式：TDD 先红后绿；QM-1 打包；QM-2 必检项；QM-6 双模型评审；`.quality-gates.md` 执行记录（远程同步 PENDING→合并后回填）。
- 记忆三路：`01-docs/learnings.md` 置顶追加（P0 bug 反哺 + mock 形状教训）、内置记忆、EverOS episodes/atomic_facts。
- CHANGELOG.md 收口。
