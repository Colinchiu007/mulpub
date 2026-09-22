# Test Plan — 爆款库四链路数据结合（viral-library-integration）

> 版本：v1.0 ｜ 日期：2026-09-22 ｜ 上游：PRD/Feature List 同名文档（2026-09-22）
> 策略基线：TDD（先红后绿）；每 PR 全量 vitest 绿 + QM-1 打包 + 视觉回归后才允许 auto-merge。

## 1. 测试策略总览

| 层级 | 范围 | 工具/位置 | 门禁时机 |
|---|---|---|---|
| L1 单元 | 纯函数（数字解析、normalize、sanitize、URL norm、均值口径） | `*.test.js`（vitest / node 测试，随既有文件） | 每次提交 |
| L2 组件 | Vue 视图行为（透传、徽标、null 显示、预填） | `apps/desktop/src/views/*.test.js`（vue-test-utils + ipc-mock） | 每次提交 |
| L3 集成 | 端到端数据流（采集 fixture→store→分析引擎；灌 600 条→队列） | 临时 sqlite（`os.tmpdir()` 自建，禁依赖 gitignored dist 残留） | 每 PR |
| L4 E2E（CDP） | 真实 Electron 窗口走采集入库→爆款页 F3/F7 可见结果 + 截图 | 零依赖 CDP 驱动（本会话已验证方法：`MP_CDP_ALLOW_ALL_ORIGINS=1` 注入父 shell、Runtime.evaluate + captureScreenshot） | 每 PR 合入前手动 |
| L5 视觉回归 | F3 卡片区、爆款库表格（`-`/tooltip/提示条）、改写报告强度行 | `npm run test:visual:pixel`（项目既有 QM-4 框架） | PR 合入前 |

**核心防护思想**：本特性最大的风险不是"新功能不工作"，而是**口径变更污染既有行为**——所以每个 PR 都配一条"逐字节回归锁"（见 §3 各 PR 的 R 组），存量数据集在新代码下分数/排序/渲染必须与基线一致。

## 2. 场景矩阵（横切三 PR）

| 场景维度 | 取值枚举 |
|---|---|
| metrics 状态 | 真值>0 / 真值=0 / NULL(解析失败) / 字段缺失(undefined) / 负数 / `1.2万`格式 / `3.4w` / `1,234` / 超 MAX_SAFE |
| 样本构成（引擎均值） | 全真值 / 混合 NULL / 全 NULL / 单条 / 空列表 |
| source 维度 | collection / analysis(置零设计保留) / manual |
| 回采结果 | 变大 / 变小(拒绝) / 相等 / URL 不匹配 / 写回抛错(fail-open) |
| 热榜可用性 | 正常 / 超时800ms / 抛错 / preservedStaleCache / 空 |
| 队列水位 | <200 / 200-500 / >500 / 回落跨阈值 |
| 打包状态 | 开发态 / `app.isPackaged`（既有门禁条目，涉及路径逻辑时覆盖） |
| i18n | zh / en 双语渲染（CJK 基线 + locale 成对 CI Gate 7） |

## 3. 测试用例清单

### PR-1（P0）

**单元（url-collector.test.js 扩展）**
- U-101 `万/w/逗号/纯数字/空白串` 五格式解析正确（1.2万→12000）。
- U-102 负数/NaN/Infinity/超 MAX_SAFE/非字符串 → null（**不出现 clamp 到 0 的路径**）。
- U-103 平台 fixture 页（知乎 HTML 片段、B站初始化 JSON、小红书内联 JSON）→ likes/comments 提取正确；无计数字段页面 → 两字段 null。
- U-104 页面明确显示 `0` → 产出 0（真零语义与 NULL 分离的关键用例）。

**单元（knowledge-library-store.test.js）**
- U-105 normalize：undefined/null/''/负/NaN/超界 → 列为 NULL；0 → 0；ratio 在 collections NULL 时 → NULL。
- U-106 addViralItem 写入 NULL 列 → getViralItem 读回 null（非 0）；INSERT OR REPLACE 语义不变。
- U-107 searchViralItems：NULL 条目与 0 条目排序行为一致（沉底）、created_at 次序稳定。

**单元（viral-engine-local.test.js）——均值污染回归（本 PR 灵魂用例）**
- U-108 likes=[5000,5000,5000] vs [5000,5000,5000,null] → overall_score **相等**（NULL 不进分母）。
- U-109 likes=[5000,5000,5000,0] → 分数**低于** U-108（真 0 进分母），差值符合权重量级（≈15 分）。
- U-110 全 NULL 样本 → 走回退分支，输出与今日基线逐字节一致。
- U-111 trend：混合 NULL 不影响 rising 判定阈值口径；全 NULL → stable。
- R-110 **存量回归锁**：既有 fixture 数据集（无 NULL，全 0/正数）改造前后分数、factor、trend 逐字节相等。

**组件（ViralAnalysis.test.js / Collection 相关 / ViralLibraryTable 若已有测试文件则扩展，否则新建）**
- C-101 `addCollectedToViral`：fixture collectedResult 带 engagement → addViralToLibrary 入参含 likes/comments/published_at；不带 → 入参**无这三个键**（不是 0、不是 undefined 字面量）。
- C-102 IPC mock 返回 likes:null → F7 条目不渲染「赞」副标题；likes:0 → 同样不渲染（>0 才渲染）；likes:523 → 渲染。
- C-103 formatNum(null)→`-`；formatNum(0)→`0`（列表现今口径不破坏真零显示）。
- C-104 F8 角标：like_count null 条目不渲染角标（untracked 口径）。

**E2E（L4，独立实例，复用本会话已验证的零依赖 CDP 方法）**
- E-101 起 mp-app-live2 profile 副本实例（未登录权益门双态已知，采集入库为本地功能不受权益门影响）→ 采集知乎 fixture 本地 HTTP 页 → 入爆款库 → CDP 读 store 断言 likes>0 → 打开爆款库表格截图（数字非 `-`）。

### PR-2（P1）

**单元**
- U-201 norm_url 表驱动：http/https、大小写 host、尾斜杠、`?utm_source=x&y=1`、`#fragment` → 同一 norm 键；不同路径不误合。
- U-202 updateViralEngagementByNormUrl：NULL→补写；5000→6000 更新；6000→5000 拒绝+warn 断言；相等 no-op。
- U-203 recrawl 写回抛错 → 原 performance 域写入不回滚（fail-open 断言 warn 被调用）。
- U-204 队列：countPending>500 时新入队 → deferred；巡检回落 <200 → 批量转 pending；499/501 边界。

**组件**
- C-201 F3：hotlist mock 正常 → hotlist 项排前 + `热榜` 徽标；mock 抛错/超时（fake timers 推过 800ms）→ 渲染结果与改造前快照一致（降级回归锁）；双空 → 空态卡。
- C-202 表格 tooltip：updated_at>created_at 且 source=collection → 出现回采文案；analysis 来源不出现。
- C-203 backlog 提示条：deferred=0 不渲染；>0 渲染含计数。

**集成**
- I-201 600 条灌入（临时 sqlite + 桩 aiGenerator）：pending 峰值 ≤ 边界、deferred 计数准确、每轮仍 ≤10、全部处理完无卡死（condition-based waiting，禁 waitForTimeout）。
- I-202 同 URL 重复入库 → 卡片复用不重建（aiGenerator 调用次数断言）。

**视觉回归**：F3 三态（纯本地/并源/降级）、表格提示条、tooltip —— 各出基线截图。

### PR-3（P2）

**单元（rewrite-engine-core.test.js 扩展）**
- U-301 `_sanitizeEngagement`：<3 样本 / 非有限 / 字符串注入尝试（含 `{placeholder}` 字面量与控制字符）→ null 整段不注入。
- U-302 注入段存在时位置正确（模板替换之后追加，防二次展开——复用 V1-V3 断言范式）。
- U-303 avgLikes 取整百：5234→5200 呈现，防精确数抄写。
- R-304 **逐字节回归锁**：params 无 engagement → userPrompt 与改造前完全一致（同 V7 范式）。

**组件**
- C-301 sessionStorage 中转：写入→跳转→读取→**键已删除**；二次进入无残留；JSON 损坏 → 改写照常（chip 不出现）。
- C-302 报告区强度行：有注入 → 渲染；无 → 不渲染且三维报告不受影响。
- C-303 HotTopics 按钮 → 路由 query 预填：trim+200 截断、不自动发起分析（doAnalyze 未被调用的 spy 断言）；预填提示条可清除。

**集成**
- I-301 buildViralContext 混合样本（带 lift/无 lift/卡片 pending）排序断言：pending 等同 NULL 排后不丢弃。

### 门禁与CI（每 PR）

- 全量 `pnpm vitest run`（含 views-coverage/ai-handler/ipc-contract 套）0 失败。
- QM-1：`electron-builder --win --dir` + asar require 链 + 8s 启动无 stderr 崩溃（改了主进程 services 一律必跑）。
- CI Gate 7 locale 成对 + CJK 字面量基线扫描。
- 文档同步：PRD/Feature-List/Test-Plan 三件套随 PR-1 入库（`01-docs/*.md` 被 .gitignore 忽略，须 `git add -f`）——这是 Doc-Sync 硬门禁（代码变更须同步 `01-docs/`）的强制要求；PRD §3.6 回写 PR-1 落地实况。CHANGELOG 入库。

## 4. 已知风险与对策

| 风险 | 对策 |
|---|---|
| 选择器随平台改版漂移（U-103 fixture 失效） | 解析失败→null 的 fail-open 已内建；fixture 注明来源抓取日期；季度巡检更新 |
| 均值口径变更引发用户"分数变了"困惑 | 这是修复而非回归：CHANGELOG 明确写"采集条目此前按 0 稀释均值"；R 组回归锁保证存量无 NULL 数据不变 |
| F3 并热榜拉长首屏 | 800ms race + 降级回归锁（C-201）；benchmark 对比 P95 |
| sessionStorage 信号跨标签泄漏（多窗口） | 读后即删 + 仅 home 虚拟标签内 SPA 导航（既有架构约束），E2E 覆盖二次进入 |
| Vue 受控赋值 CDP 自动化抖动 | 复用已验证范式：原生 setter + dispatchEvent('input')；截图前 wait 条件而非固定延时 |

## 5. 出口标准（Phase 2→3 门禁）

1. 三 PR 各自：L1-L3 全绿 + R 组回归锁在案 + L5 视觉基线更新 + QM-1 通过。
2. PR-1 额外：L4 E2E 真实入库 likes>0 截图证据存档。
3. CI 全绿 → auto-merge（main ruleset 六项 required 既有流程）；合并后 `mp-app-live2` 同步复验启动。
4. 复盘：三 PR 合入后跑 /retro + /learn，NULL/0 语义分离模式沉淀入 learnings 与 EverOS。
