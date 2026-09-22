# Feature List — 爆款库四链路数据结合（viral-library-integration）

> 版本：v1.0 ｜ 日期：2026-09-22 ｜ 上游：`PRD-VIRAL-LIBRARY-INTEGRATION-2026-09-22.md`
> 粒度约束：每项 ≤ 4h、可独立测试、标注依赖。⛔ 无一项引入新表/新 IPC 通道/DB 迁移。

## 图例

- 优先级 = PR 归属：P0→PR-1、P1→PR-2、P2→PR-3（各 PR 内部按编号顺序实现）
- 层：主=Electron 主进程，渲=渲染端，包=packages/*，CI=测试/门禁

## PR-1（P0）采集→爆款库互动数据契约修复

| ID | 功能点 | 层 | 涉及文件 | 依赖 | 验收锚点 |
|---|---|---|---|---|---|
| F-101 | `_parseEngagement` 数字格式解析器（`1.2万/3.4w/1,234`→int；负/NaN/超 MAX_SAFE→null），纯函数先行 | 主 | url-collector.js（新私有方法）+ test | — | AC-P0-1 单元层 |
| F-102 | 平台规则接入：知乎/B站 HTTP(JSON-LD+选择器)、小红书 browser 内联 JSON；失败→null | 主 | url-collector.js | F-101 | AC-P0-1 |
| F-103 | `_collectViaBrowser` 结果补 `engagement` 字段（HTTP 路径透传 publishTime 已具备） | 主 | url-collector.js | F-102 | — |
| F-104 | `addCollectedToViral` 透传 likes/comments/published_at（undefined 不落字段） | 渲 | Collection.vue L1602-1623 | F-103 | AC-P0-1 |
| F-105 | `normalizeViralItem` NULL 语义：undefined/null/负/NaN/超界→NULL；真 0 保留；ratio 在 collections 未知时→NULL | 主 | knowledge-library-store.js L16-44 | — | AC-P0-2/3 |
| F-106 | `viral-engine-local` 均值口径：null 跳分母；全 null→回退现行为；trend 同口径 | 主 | viral-engine-local.js L190-221 | F-105 | AC-P0-2 |
| F-107 | `searchViralItems` 排序 IFNULL + `VIRAL_SORT_COLUMNS` 路径核对 | 主 | knowledge-library-store.js L203 | F-105 | 排序不回归 |
| F-108 | F7 回填 `like_count: item.likes ?? null` + F8 角标 null→untracked 不渲染 | 渲 | ViralAnalysis.vue L630-649 | F-105 | AC-P0-2 |
| F-109 | `ViralLibraryTable.formatNum(null)`→`-`；F7 条目副标题「赞 {n}」（非 null 且 >0） | 渲 | ViralLibraryTable.vue、ViralAnalysis.vue、locales zh/en 成对 | F-105 | 显示口径 |
| F-110 | 存量回归锁：全 0 数据集分析分与基线逐字节一致快照测试 | CI | viral-engine-local.test.js | F-106 | AC-P0-3 |
| F-111 | QM-1 打包 + CJK 基线 + locale 成对门禁自测 | CI | — | 全部 | AC-P0-4 |

**PR-1 净规模估计**：约 3 个工作日（解析器占大头），文件 ≤6 个。

## PR-2（P1）数据回流闭环 + 选题并源 + 队列保护

| ID | 功能点 | 层 | 涉及文件 | 依赖 | 验收锚点 |
|---|---|---|---|---|---|
| F-201 | `_normUrlForMatch`（协议/大小写/尾斜杠/utm 参规范化）纯函数 + 表驱动测试 | 主 | 新 util 或 recrawl 服务内 | — | AC-P1-1 |
| F-202 | `updateViralEngagementByNormUrl` store 方法：单调不减、NULL 可补、变小拒绝+warn | 主 | knowledge-library-store.js | F-105, F-201 | AC-P1-1 |
| F-203 | 回采成功路径挂旁路写回（fail-open try/catch，不回滚原事务） | 主 | performance-recrawl-service.js | F-202 | AC-P1-1 |
| F-204 | 回采条目 tooltip「互动数据已自动回采更新」（有 updated_at>created_at 且 source=collection 时） | 渲 | ViralLibraryTable.vue + locales | F-203 | 显示项 |
| F-205 | F3 `loadTrending` 并 hotlist 源：800ms Promise.race、来源徽标、hotlist 恒前、截 12 | 渲 | ViralAnalysis.vue L506-542 + locales | — | AC-P1-2/4 |
| F-206 | `countPendingPatternCards` store 查询 + 入队前同 norm_url 复用卡片检查 | 主 | viral-pattern-store.js、pattern-extraction-service.js | F-201 | AC-P1-3 |
| F-207 | `deferred` 状态：>500 入队转 deferred；巡检 <200 批量回落；状态列登记（枚举一致性检查含前端筛选 UI 不误显示） | 主 | pattern-extraction-service.js、viral-pattern-store.js | F-206 | AC-P1-3 |
| F-208 | 爆款库页头 backlog 提示条（deferred>0；分析功能不受影响的措辞） | 渲 | ViralLibraryTable.vue + locales | F-207 | 显示项 |
| F-209 | 600 条灌入集成测试（临时 sqlite，断言 pending≤边界、deferred 计数、回落） | CI | pattern-extraction-service.test.js | F-207 | AC-P1-3 |
| F-210 | QM-1 + 视觉回归（F3 卡片区、表格 tooltip/提示条）+ 门禁 | CI | — | 全部 | — |

## PR-3（P2）强度注入改写 + 选题联动

| ID | 功能点 | 层 | 涉及文件 | 依赖 | 验收锚点 |
|---|---|---|---|---|---|
| F-301 | viral-signal store 快照追加 `engagement`（avgLikes/avgComments/sampleCount，分析成功时从因子回填） | 渲 | stores/viral-signal.js | PR-1 F-106 | — |
| F-302 | sessionStorage 中转（`mp-viral-signal` 键，改写页读后即删）替换超长 query | 渲 | ViralAnalysis.vue goRewrite、RewriteView.vue onMounted | F-301 | AC-P2-2 |
| F-303 | `_sanitizeEngagement`（<3 样本/非有限→整段不注入；均值取整百） | 包 | rewrite-engine-core.js | — | AC-P2-1 |
| F-304 | 引擎「## 爆款强度参考」注入段（与 viralAngles 同区、防二次展开、控制字符过滤复用） | 包 | rewrite-engine-core.js L338-349 区 | F-303 | AC-P2-1 |
| F-305 | 改写报告区展示强度锚点行（有注入时；无则不渲染，回归锁同 V7 范式） | 渲 | RewriteView.vue + locales | F-304 | — |
| F-306 | `buildViralContext` 按 `IFNULL(expected_lift,0)` 降序优先采样（NULL 排后不丢弃） | 主 | knowledge-context-builder.js | — | AC-P2-4 |
| F-307 | HotTopics 条目「爆款分析」按钮 → `/viral-analysis?topic=`（不自动分析） | 渲 | HotTopics 视图 + ViralAnalysis.vue onMounted query 预填（trim+200 截断）+ locales | — | AC-P2-3 |
| F-308 | 预填提示条「主题已从热门选题带入…」+ 手动清除 | 渲 | ViralAnalysis.vue + locales | F-307 | 显示项 |
| F-309 | 引擎/组件/集成三层测试 + 未携带信号逐字节回归锁 | CI | rewrite-engine-core.test.js 等 | 全部 | AC-P2-1 |
| F-310 | QM-1 + 视觉回归 + 门禁 | CI | — | 全部 | — |

## 跨 PR 序列约束

1. 严格 P0→P1→P2 合入序（NULL 口径是回采写回与强度注入的前提）。
2. locales 追加型冲突预防：三 PR 的 zh/en 新键集合互斥，按序登记（历史经验：并发 PR 头部 prepend/尾部 append 冲突）。
3. P2 开发可与 P1 并行开工（仅 §5.3 热榜联动软依赖 P1 的 F-205 徽标风格），但合入仍在 P1 后。
