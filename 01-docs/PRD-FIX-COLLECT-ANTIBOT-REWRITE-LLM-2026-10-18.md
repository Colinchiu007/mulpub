# PRD：百家号采集反爬验证页 + AI 改写误报「未配置 Key」（fix-collect-antibot-rewrite，2026-10-18）

> 状态：全文定稿（§0–§13）。§10–§13 已于代码冻结（2026-10-18 13:1x）后回填实际坐标与实跑计数；
> §12.3 列的 QM-1 打包 / QM-4 视觉 / 接线棘轮 / 行尾对账 / QM-6 评审由 Lead 在提交前补跑并回填。
> 证据根：`<TEMP>\baijiahao-probe*.js`、`<TEMP>\baijiahao-probe-out\*`（只读使用，未修改）。

## 0. 结论速览

| 项 | 结论 |
|---|---|
| 故障 1 | 单篇 URL 采集「成功」，但正文是「百度安全验证」滑块页提示文字；该文字再随「去发布」进入发布页正文输入框 |
| 故障 2 | 桌面「模型设置」已配置文字推理模型（Agnes 多模态模型的 llm 能力），改写仍报「需要配置 API Key」 |
| 根因 1（已实证） | ① 采集路由把 `baijiahao.baidu.com` 固定打到 headless stealth 浏览器；② 浏览器通道的生产解析器对验证页 HTML 返回 `success: true`（title=「百度安全验证」、正文 101 字）；③ 渲染层唯一的安全验证守卫只挂在 Python 聚合路径上，而百家号自 2026-09-29 起已不走该路径 |
| 根因 2（已实证） | 采集页 stealth 分支的自动改写调用 Python `POST /aggregation/rewrite`；该后端只读进程环境变量（`LLM_API_KEY` / `PO_OPENAI_API_KEY`），桌面「模型设置」的默认模型从未进入请求 |
| 修复方向 | 采集：百家号 HTTP 优先 → 验证页判据 fail-closed → 浏览器有界重试（每次换新 context）；改写：stealth 分支改走桌面引擎 `aiRewrite`，桌面默认 llm 注入 Python 请求，新增稳定错误码 `LLM_NOT_CONFIGURED` |
| 反例纪律 | 「UA 截断导致验证」本次**未复现**（普通 HTTP 20/20 成功），不作为根因，只作防御性加固；挑战是概率性的（stealth 实测 3/6 命中），因此修复不得写成「换 UA / 换 IP 就永远不触发」 |

## 1. 背景与用户可见现象

### 1.1 用户原话（逐字引用，来源：2026-10-18 用户报障会话）

> 采集页，单篇URL采集，url框中输入：https://baijiahao.baidu.com/s?id=1879211845239319012&wfr=spider&for=pc 但是出现这个提示文字：✅ 百度安全验证百度安全验证 请完成下方验证后继续操作 正在验证... 验证通过 图片未转正 网络不给力，请刷新重试 加载中... 图片由AI生成 拖动左侧滑块使图片为正 扫码验证| 意见反馈 |刷新...

（上句「出现这个提示文字：…」之后的部分即**截图/提示条文字**，逐字保留，未做清洗。）

> 这个有办法解决吗，就是采集百家号文章时，不触发这个验证。如果需要，可以在网上找解决这个问题的开源项目来研究。

> 此时，点击它会把百度安全验证的相关提示文字，带入发布页的正文输入框内容中

> AI 改写功能需要连接智能写作服务，但尚未完成服务配置。请在应用的「模型设置」中配置 AI 服务商的 API Key（支持 OpenAI 兼容接口），保存后重新点击改写……

> 但是我在设置中，已经配置了文字推理的模型的Key，是多模态模型Agnes中的文字推理能力。你查一下。

### 1.2 现象拆解

| # | 用户动作 | 期望 | 实际（修复前） | 用户可感知后果 |
|---|---|---|---|---|
| P1 | 采集页粘入百家号文章链接，点「采集」 | 拿到文章正文 | 提示里以 ✅ 开头，条目内容却是「百度安全验证 … 拖动左侧滑块使图片为正」 | 以为采集成功，实际 0 字正文 |
| P2 | 在采集条目上点「去发布」 | 发布页正文是文章 | 发布页正文输入框里是验证提示文字 | 未发布即已产出错误草稿；人工发现前可能直接发布 |
| P3 | 配置了文字推理模型后点「改写」 | 改写成功 | 提示「AI 改写功能需要连接智能写作服务，但尚未完成服务配置…」 | 误以为是自己没配 Key，反复配置无果 |

「✅」来自成功通知分支（修复前代码在采集成功处只调 `notifySuccess('collection.collectSuccess')`，`Collection.vue:1206/1234/1268/1289`）；
紧随其后的验证文案来自被当作正文入库的采集条目（title=「百度安全验证」、正文 101 字，见 §2.1 E3）。

### 1.3 影响面

| 维度 | 结论 |
|---|---|
| 受影响用户 | 所有在采集页采集百家号图文 URL 的用户（百家号是内置平台之一，采集中不可回避） |
| 受影响数据 | 采集条目（`collected_items`）、草稿（`drafts`）、发布页正文；一经发布即污染线上内容 |
| 触发概率 | 非线性：stealth 浏览器实测 3/6 被挑战（desktop 2/3、mobile 1/3）；即「同一 URL 同一段代码」时好时坏 |
| 次生影响 | 采集失败被记成成功 → 指标失真；用户对「模型设置是否生效」失去判断依据 |

## 2. 根因证据（2026-10-18 现场）

### 2.1 证据坐标表（每行都可复跑）

| 编号 | 结论 | 取法（复跑命令） | 原始输出摘录 |
|---|---|---|---|
| E1 | stealth 浏览器通道会被概率性挑战 | `node <TEMP>\t3-extract-html.js`（读 `<TEMP>\baijiahao-probe-out\*.html`） | 6 份落盘：desktop 2/3 命中 `title="百度安全验证"`、mobile 1/3 命中 |
| E2 | 验证页体积/结构稳定 | 同上 | 3 份 CHALLENGE 页 38499–38517 B、`p=5`、纯文本 123 字 |
| E3 | **生产解析器把验证页判成成功** | `node <TEMP>\t3-challenge-parse.js`（调生产 `_parseHtml`） | 3/3 输出 `success=true title="百度安全验证" contentLen=101`，正文以「百度安全验证 请完成下方验证后继续操作…」开头 |
| E4 | 正常文章页解析质量可用 | `node <TEMP>\t3-parse-and-ua.js`（解析 `<TEMP>\baijiahao-http-ok.html`） | `success=true titleLen=37 contentLen=3832`（标题与正文均为真实文章） |
| E5 | 普通 HTTP 直连稳定可用 | `node <TEMP>\t3-probe-http16.js`（日志 `<TEMP>\t3-probe-http16.log`） | `TOTAL runs=16 challenge=0 ok=16`，每次 `status=200 len=70271` |
| E6 | 仓库现用截断 UA 不是判别因子（本批未复现） | `node <TEMP>\t3-parse-and-ua.js` | `repoUA runs=4 challenge=0 ok=4`（UA 原文 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`） |
| E7 | 桌面确实配置了文字推理能力 | `node <TEMP>\t3-db-focus.js`（只读打开 `shared-user-data/multi-publish.db`，不打印 Key） | `model_providers` 55 行；`is_default=1` 共 **0** 行；`agnes-multimodal`：`enabled=1`、`api_key` 明文为空、`api_key_enc` 82 B、`capabilities=["llm","image","video"]`、`capability_defaults` 同、`capability_models.llm="agnes-3.0-flash"` |
| E8 | 代码路径（基线 `f0c5d1faf`） | 见 §2.2 / §2.3 的行号 | — |

E1 的挑战概率与 E5/E6 的直连成功率共同决定修复形态：**不能只换一个因子**，必须「优先走成功率高的通道 + 对失败形态 fail-closed + 有界重试」。

### 2.2 采集侧根因链（五层，逐层有代码坐标）

| 层 | 位置（基线 `f0c5d1faf`） | 事实 | 后果 |
|---|---|---|---|
| L1 路由 | `apps/desktop/electron/services/url-collector.js:174-180`（`_needsBrowser(hostname)` 为真即走浏览器）、`:376-381`（`ANTI_CRAWL_HOSTNAMES` 含 `baijiahao.baidu.com`） | 百家号被硬编码进「反爬站点」清单 → 永远走 headless stealth 浏览器 | 放弃了成功率更高的普通 HTTP 直连（E5：16/16） |
| L2 判定 | `url-collector.js:240-333`（`_parseHtml`）、`:288-304`（百家号分支）、`:320-332`（返回 `success: true`） | 解析器**没有任何验证页判据**，`<title>` 原样当标题、正文原样取「段落最多的元素」 | 验证页被读成 `{success:true, title:"百度安全验证", content:"…滑块…"}`（E3 实测 101 字） |
| L3 缓存 | `url-collector.js:183`（成功后 `_contentCache.mark`）、`:164-167`（`hasUrl` 命中直接返回 `{success:true, title:'', content:''}`）、`packages/collection-engine/src/content-cache.js:32-41/59-79`（无 TTL，仅 LRU maxSize=10000） | 失败形态被当作成功写入缓存；同 URL 二次采集在会话内直接返回空内容 | 「成功」可被放大成「空壳成功」，二次采集更不可诊断 |
| L4 渲染层守卫错位 | `apps/desktop/src/views/Collection.vue:1093-1101`（`isSecurityChallenge` 定义）、`:1251`（唯一调用点，在 Python 聚合分支内）、`:1222-1236`（stealth 分支）、`:1406-1448`（一键采集+改写的 stealth 分支） | 守卫**只覆盖 Python 聚合路径**；百家号走的是 stealth 分支 → 守卫形同虚设 | 验证页结果直接 `unshift` 进采集条目并 `saveCollectedItems()`（`:1230-1234`） |
| L5 去向 | `Collection.vue:1668-1675`（`goPublishFromItem`）、`:1566-1575`（`getDraftFromItem`，`content: src.content`）、`:971-973`（`goPublish`） | 采集条目的 `content` 原样成为草稿正文 → 跳转 `/publish?draft=<id>` | 用户报障 P2 复现：验证文字进入发布页正文输入框 |

补充一条路径细节：`Collection.vue:1161`（`isVideoPlatformUrl`）对 `https://baijiahao.baidu.com/s?id=…` 返回 true（`Collection.test.js:762` 已锁），
所以百家号链接**先**走视频采集通道，`VIDEOCLONE_NO_VIDEO` 后再落回图文链路（`:1177-1187`）——这解释了为什么「验证页正文」出现在图文条目而不是视频条目里。

### 2.3 改写侧根因链

| 层 | 位置 | 事实 |
|---|---|---|
| R1 调用点 | `Collection.vue:1406-1448`（修复前 `:1423` 调 `api.aggregationRewrite`） | 一键采集+改写的 stealth 分支，改写走 Python 聚合层，**不是**桌面引擎 |
| R2 后端前置校验 | `packages/python-backend/src/multi_publish/aggregation/service.py:218-220` | `api_key = os.environ.get("LLM_API_KEY") or os.environ.get("PO_OPENAI_API_KEY","")`；为空即 `raise UserVisibleError("LLM_KEY_MISSING", …)` |
| R3 后端装配 | 同文件 `:289-307`（`_build_llm_adapter` 同样只读 env）、`:381-392`（`_build_pipeline_config` 的 `llm` 三件套也只来自 env） | 后端**没有**任何「请求级配置」入口 |
| R4 前端映射 | `apps/desktop/src/utils/user-facing-error.js:120-123` | `LLM_KEY_MISSING` 命中后渲染「未配置 LLM API Key…」类文案（用户看到的 P3 文案） |
| R5 桌面本可读到配置 | `apps/desktop/electron/services/rewrite-engine.js:96-108`（`llmClient` → `aiGenerator.generateWithDefault('llm')`）→ `ai-generator.js:114-148`（`getDefault('llm')` + `resolveProviderDefaultModel`）→ `model-provider-manager.js:1089-1098`（先查多模态能力默认，再查 category 默认） | 桌面 `aiRewrite` 链路**能**解析到 `agnes-multimodal` 的 llm 能力（E7 的 `capability_defaults` 含 `llm`） |
| R6 数据证明 | E7 | 配置真实存在：`enabled=1` + 加密 Key 非空（82 B）+ `capability_defaults` 含 `llm` + `capability_models.llm=agnes-3.0-flash` |

结论：同一台机器上「桌面引擎能改写」而「Python 改写说没配 Key」，差异只因**配置来源不同**，不是用户未配置。

### 2.4 为什么既有防护与测试没拦住

| 逃逸层 | 事实 | 为什么没拦住 |
|---|---|---|
| 单测 | `apps/desktop/src/views/Collection.test.js:351-376` 有「安全验证页 → 回退而非误报成功」用例 | 该用例测的是 **Python 聚合路径**（`aggregationCollect`）；同文件 `:352-353` 注释自陈「2026-09-29 起百家号链接先走视频通道（无视频回退 stealth），不再经聚合层」——**回归测试守的路径已不是出事路径** |
| 单测 | 渲染层用例用假 `result` 对象 | 从未用真实 CHALLENGE HTML 过一遍生产 `_parseHtml`，因此测不到「解析器说 success」（E3） |
| 单测 | 改写链路用例（`user-facing-error.test.js:111-136`） | 只验证「`LLM_KEY_MISSING` 能否渲染成友好文案」，即**把误报渲染得更友好**，没有验证「配置存在时不该报这个错」 |
| 集成 | 无「采集 → 去发布」端到端断言正文来源 | 验证文字进入发布页这条链路只能靠真机发现 |
| 审查 | 两个缺陷都在「已有错误处理」的分支旁 | 已有守卫（`isSecurityChallenge`）造成「这里已经处理过」的错觉，掩盖了分支覆盖缺口 |

## 3. 数据校验（判据、阈值与反例）

### 3.1 验证页判据强弱矩阵

判据单一真源 = `apps/desktop/electron/services/url-collector-antibot.js`（主进程），渲染层经
`apps/desktop/src/utils/collected-content-guard.js` 转发同一份词表（两端同判由 `collected-content-guard.test.js` 逐条比对锁定）。
判定原则：**结构化信号优先、文本信号从严、宁漏不误杀**。

| 信号 | 强度 | 单独出现是否判真 | 依据 |
|---|---|---|---|
| 最终 URL 命中 `wappass.baidu.com/static/captcha/` | 强（结构性） | **是** | 实测跳转落点为该端点（probe 的 `page.url()` 判据） |
| `<title>` 含「百度安全验证」 | 强（结构性） | **是** | 3 份 CHALLENGE 页 title 逐字相同（E1/E2） |
| 正文含 ≥2 个强标记 | 强（组合） | **是** | 强标记=「请完成下方验证后继续操作」「拖动左侧滑块使图片为正」「图片未转正」「扫码验证」；验证页 4 项全中，正常页 0 项（E3 vs E4） |
| 正文含 1 个强标记且正文 <300 字 | 中 | **是** | 验证页正文 101 字；正常页 3832 字，留 3 倍以上余量 |
| 弱标记（「网络不给力，请刷新重试」「正在验证」「验证通过」「加载中」「图片由AI生成」） | 弱 | **否** | 均为合法文章可能引用的抱怨语/加载态/图片说明 |
| 正文长度 <60 且含「安全验证」类词（**修复前**旧判据） | 弱 | 旧判据曾判真 | 旧判据只看 60 字，且只在已失效的分支上生效（§2.4） |

### 3.2 误杀反例（必须写成回归测试）

| 反例 | 为什么危险 | 期望判定 |
|---|---|---|
| 长文《一次宽带 DNS 故障排查记录》，正文写着「页面老是提示『网络不给力，请刷新重试』」 | 命中弱标记，但属正常文章 | **不判真**（弱标记单独不成立） |
| 文章正文引用「图片由AI生成」作为配图说明 | 同上 | **不判真** |
| 文章标题含「验证」二字（如《如何设计短信验证码》） | 标题含「验证」但非「百度安全验证」 | **不判真**（只认完整标记词） |
| 正文很短的技术短文（<300 字）含 1 个强标记 | 边界情形 | 判真，且**这是刻意取舍**：验证页正文实测 101 字，宁可漏掉极少数 300 字以下的撞词短文，也不能放过验证页（fail-closed） |

### 3.3 阈值与取值依据

| 参数 | 取值 | 依据 |
|---|---|---|
| 强标记数量阈值 | `>=2` | 验证页实测命中 4 项；正常页 0 项（E3/E4），取 2 是「至少两个互不相干的验证页专属短语同时出现」 |
| 短正文上限 | `300` 字 | 验证页 101 字 vs 正常页 3832 字；300 位于两者之间且离两侧都留余量 |
| 浏览器重试次数 | 有界（默认 2 次，上限 5） | 每次重试换新 context，成本≈一次页面导航；成功率随次数上升但边际递减，且有封 IP 风险，禁止无限重试 |
| HTTP 正文上限 | 沿用现有 50000 字截断（`url-collector.js:300/317`） | 与既有约定一致，不新增阈值 |

### 3.4 内容缓存规则（不得写入失败）

| 规则 | 修复前 | 修复后要求 |
|---|---|---|
| 写缓存条件 | `result.success === true` 即写（含验证页） | **仅**通过验证页判据且正文非空的成功结果可写 |
| 命中缓存返回 | `{success:true, title:'', content:''}` | 保持现有契约不变，但**不得**让验证页进入缓存（否则命中即空壳） |
| 验证页是否算失败 | 算成功（E3） | 算失败：返回稳定结构 `{success:false, reason:'security_challenge', error:…}` |
| 缓存 TTL | 无（仅 LRU/进程内） | 本片不改 TTL（残余限制，见 §8），只保证失败不写入 |

### 3.5 旧数据兼容

| 场景 | 处置 |
|---|---|
| 历史采集条目里已经是验证页文字（`collected_items`） | **不批量删除**：在「创建草稿 / 去发布」入口按同一判据拦截并提示（`collection.draftBlockedSecurityChallenge`），用户可自行删除 |
| 历史草稿正文已是验证文字 | 不在本片迁移（草稿是用户可编辑数据，静默改写属越权）；拦截只作用于「本次采集→新建草稿」链路 |
| 既有「安全验证」错误文案 | 更新文案（见 §6），错误码/分类不变，避免影响既有断言 |
| Python 侧旧部署只配 env | 保留 env 兜底：桌面解析不到模型时**不注入**，不打断历史行为（不是「没配就报错」） |

## 4. 流程

### 4.1 采集状态机（修复后）

```
用户点「采集」
  ├─ 链接解析/校验失败 → 既有错误分类（invalid_url / protocol / internal_url）
  ├─ 视频平台域名（含百家号）→ 视频采集通道
  │     └─ VIDEOCLONE_NO_VIDEO → 落回图文链路（下游同下）
  └─ 图文链路（主进程 url-collect:fetch，按 routeFor(hostname) 分派）
        ├─ route = browser（知乎）→ stealth 浏览器（新 context）→ 验证页判据
        │      └─ 命中 → 换新 context 重试（≤2）→ 仍命中 → security_challenge 失败
        └─ route = http-first（百家号 / mbd 落地页）
               ├─ HTTP 直连（完整浏览器请求头）→ 解析 → 验证页判据 / 正文非空
               │      └─ 成功且非验证页 → 返回文章（不写失败缓存）
               └─ 失败（验证页 / 正文空 / 提取失败）→ stealth 浏览器有界重试 → 仍失败 → security_challenge
  → 渲染层第二道守卫（isVerificationContent）→ 命中即报错并中止（不入库）
  → 入库：{title, content, ...} → collected_items
```

要点：
1. **HTTP 优先只给百家号**（`baijiahao.baidu.com`、`mbd.baidu.com`）；知乎仍是浏览器优先（知乎裸连 403 是另一形态，见 `url-collector.js:366-367` 既有注释）。
2. 渲染层的 `needsStealth` 语义从「必须浏览器」扩展为「必须走 Node 采集通道」，并携带 `mode`（`browser` / `http-first`）供日志与诊断区分。
3. 任何一步命中验证页都**不得**返回 `success:true`（fail-closed）。

### 4.2 失败结构（IPC → 渲染层）

| 字段 | 值 | 消费方 |
|---|---|---|
| `code` | 非 0（沿用 `-1`/`REQUEST_ERROR` 语义） | `Collection.vue` 采集失败分支 |
| `reason` | `security_challenge` | `classifyCollectError` **结构化 reason 优先**（白名单内直接采信） |
| `message` | 人可读中文短句（不含技术栈） | `formatUserError` 兜底 |

### 4.3 改写链路（修复后）

```
采集成功
  └─ 桌面改写引擎：aiRewrite → RewriteEngineService.rewrite
        └─ llmClient.chat → aiGenerator.generateWithDefault('llm')
              └─ ModelProviderManager.getDefault('llm')
                    ├─ 命中 → 组装请求（model 由 capability_models.llm 解析）
                    └─ 未命中/无 Key/无模型 → errorCode: LLM_NOT_CONFIGURED（稳定码）
  └─ Python 聚合改写（其它入口仍可用）
        └─ ipc aggregation:rewrite → resolveRewriteLlmPayload(modelProviderManager)
              ├─ 解析成功 → payload.llm = { provider_id, api_key, base_url, model }
              ├─ 用户确实没配（无默认/无 Key/无模型）→ 短路 { code:-400, errorCode:'LLM_NOT_CONFIGURED' }（**不发请求**）
              └─ 模型服务未就绪/依赖缺失 → 不注入，保留后端 env 兜底
```

### 4.4 Python 侧注入顺序（契约，已落地为逐字段回退）

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | `request.llm`（桌面下发，模型 `LlmOverride`） | 本片新增：请求级配置；**存在即优先**，不得被 env 覆盖；三字段（`api_key`/`base_url`/`model`）各自独立回退 |
| 2 | `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 历史标准环境变量 |
| 3 | `PO_OPENAI_API_KEY` / `PO_OPENAI_BASE_URL` / `PO_OPENAI_MODEL` | 旧 content-aggregator 约定（向下兼容） |
| 4 | 内置默认（base_url=`https://api.openai.com/v1`，model=`gpt-4o-mini`） | 无 Key 时以 `LLM_KEY_MISSING` 终止，不发起网络请求 |

实现坐标：`packages/python-backend/src/multi_publish/aggregation/service.py:212`（`_resolve_llm_settings`，逐字段回退）、
`:326`（`_build_llm_adapter`）、`:422`（`_build_pipeline_config`）；请求模型见 `models.py:152/177`。
桌面侧解析与注入决策见 `apps/desktop/electron/services/llm-runtime-config.js:96/186/227`。

安全约束：`api_key` 只进请求 payload，**不写日志、不进错误文案**；失败 `detail` 只含原因与模型名
（`RESOLVE_REASON` 四值：`MANAGER_UNAVAILABLE` / `NO_DEFAULT` / `NO_API_KEY` / `NO_MODEL`）。

## 5. 功能逻辑与交互逻辑

### 5.1 采集按钮态

| 状态 | 触发 | 表现 |
|---|---|---|
| 空闲 | — | 「采集」可点；「一键采集+改写」可点 |
| 采集中 | 点击后至返回 | 两按钮同时禁用，文案切「采集中…」；重复点击无效 |
| 成功 | 非验证页 | 条目入列表 + 成功通知；同步写入采集记录 |
| 失败（验证页） | 判据命中 | 错误卡片（`security_challenge` 文案）+ 可重试按钮；**不入库**、**不弹成功** |
| 失败（其它） | 分类器结论 | 既有分类型错误卡片（超时/限流/不可达…）；`retryable` 决定是否显示重试 |

### 5.2 错误卡片与重试

| 项 | 规则 |
|---|---|
| 卡片位置 | 采集结果区顶部（沿用 `col-error-banner`） |
| 文案来源 | `collection.collectErrors.<reason>`；`security_challenge` 走 §6 新文案 |
| 重试 | `retryCollect()` 重放同一 URL；重试不改路由（HTTP 优先→浏览器兜底仍在主进程内完成） |
| 不重试 | `NON_RETRYABLE` 集合内分类（如 `invalid_url`）不显示重试 |
| 连续失败 | 仍受主进程冷却/熔断约束（既有八层防护不改） |

### 5.3 「去发布 / 存草稿」拦截

| 场景 | 规则 |
|---|---|
| 新采集条目 → 去发布/存草稿 | 落库前用同一判据判 `{title, content}`；命中则**阻断**并提示 `collection.draftBlockedSecurityChallenge`，不创建草稿、不跳转 |
| 历史条目（已是验证文字） | 同上拦截（这是旧数据的唯一处置手段，见 §3.5） |
| 空白草稿 | `allowEmpty` 路径不受拦截（避免误伤「新建空白草稿」） |
| 拦截后的用户操作 | 重新采集原文，或删除该条记录；卡片上不提供「强制继续」（防止把污染内容放进发布页） |

### 5.4 改写按钮态

| 状态 | 触发 | 表现 |
|---|---|---|
| 可改写 | 有采集结果 | 「改写」可点；字数区间非法时禁用并提示 |
| 改写中 | 请求发出至返回 | 「改写」与「一键采集+改写」禁用，按钮文案切「改写中…」 |
| 成功 | 拿到结果 | 展示改写结果与对比区；写入文案库（幂等 `fromKey`） |
| 失败可重试 | 可重试分类 | 显示重试按钮（`RETRYABLE_CODES`） |
| 失败-未配置模型 | `LLM_NOT_CONFIGURED` | 错误卡片用 `userErrors.LLM_NOT_CONFIGURED` 文案（指引「模型设置 → 文字推理 → 默认标记」），**不显示**「未配置 API Key」式误报 |
| 失败-配置存在但调用失败 | 其它 LLM 错误 | 原样透出可诊断信息（脱敏后），不折叠成「未配置」 |

## 6. 显示项与提示文字（zh/en 全量，locale 必须成对）

> locale 成对规则：`apps/desktop/src/locales/**` 的 zh/en 必须同键（CI Gate 7 拦截）；新增文案一律双写。

| Key | zh | en |
|---|---|---|
| `collection.collectErrors.security_challenge`（更新） | 目标页面触发了安全验证（如百度安全验证 / 知乎反爬），本次没有拿到真实正文，已阻止把验证提示当作采集内容。建议：1) 等待 1-2 分钟后重试（多数情况会自动通过）；2) 在浏览器中打开该链接确认可访问；3) 换用同平台其他文章链接。 | The target page triggered a security check (e.g. Baidu security verification / Zhihu anti-scraping). No real article body was obtained and the verification notice was prevented from being treated as content. Suggestions: 1) wait 1-2 minutes and retry (most cases pass automatically); 2) open the link in a browser to confirm it is accessible; 3) use another article link from the same platform. |
| `collection.draftBlockedSecurityChallenge`（新增） | 该条采集内容实际是「安全验证」页提示文字，不是文章正文，已阻止创建草稿 / 进入发布页。请重新采集原文，或删除该条采集记录。 | This collected item is actually a security-check page notice, not the article body. Creating a draft / opening the publish page has been blocked. Please re-collect the article or delete this record. |
| `userErrors.LLM_NOT_CONFIGURED`（新增） | 未找到可用的默认文字推理模型。请打开「模型设置」，在「文字推理」（LLM）分类中为它选择默认模型；若使用的是多模态模型，请在该模型中勾选「文字推理」的默认标记；填写 API Key 并保存后重试。 | No default text-reasoning model is available. Open Model Settings and choose a default model under the Text Reasoning (LLM) category; if you use a multimodal model, tick the Text Reasoning default marker on that model; then add the API key, save, and try again. |

落地核对要求（Phase 2）：
1. 上述 3 组文案在 worktree 的 zh/en 文件中**逐字一致**（以代码为准，本表若与代码不符以代码回填本表）；
2. 不新增「未配置 API Key」类误作文案；
3. 不出现竞品品牌名（需过 `node scripts/check-no-brand-residue.js`）。

## 7. 验收标准（可机械验证）

| 编号 | 判据 | 验证方式（机械） |
|---|---|---|
| AC-1 | 生产解析器对 CHALLENGE 页 HTML 不再返回 `success:true` | 单测：用 `<TEMP>\baijiahao-probe-out\*-CHALLENGE.html` 同款正文/标题构造输入，断言 `success!==true` 且 `reason==='security_challenge'` |
| AC-2 | 百家号路由不再是「浏览器优先」 | 单测断言 `routeFor('baijiahao.baidu.com')==='http-first'`、`routeFor('zhuanlan.zhihu.com')==='browser'` |
| AC-3 | 验证页判据不误杀长文 | 单测：长文含 1 个弱标记 / 含「验证」二字标题 → 判 false；验证页正文 → 判 true |
| AC-4 | 渲染层与主进程判据同判 | 单测逐条比对两端常量 + 同一输入同结果 |
| AC-5 | 验证页结果不入库 | 组件测：`urlCollectFetch` 返回验证页数据 → `collectedItems` 长度不变、出现错误横幅 |
| AC-6 | 验证页不得进入发布页正文 | 组件测：历史验证文字条目点「去发布/存草稿」→ 草稿未创建、提示 `draftBlockedSecurityChallenge` |
| AC-7 | 成功采集才写缓存 | 单测：验证页结果不落 `_contentCache`；正常结果照旧命中缓存 |
| AC-8 | 桌面已配模型时改写不再误报 | 单测：`modelProviderManager.getDefault('llm')` 可解析时，`aggregation:rewrite` payload 含 `llm.api_key`；解析不到时返回 `LLM_NOT_CONFIGURED` 且**未调用**后端 |
| AC-9 | 显式 `payload.llm` 不被覆盖 | 单测：renderer 传 `llm` 时原样透传（不得被默认模型替换） |
| AC-10 | Key 不落日志 | 单测：`resolveDefaultLlmRuntime` 失败 detail 不含 Key 明文；成功路径日志不含 `api_key` 值 |
| AC-11 | 失败不冻结为「成功」 | 日志断言：`url-collect` 事件序列含 `collect-challenge` / `collect-challenge-exhausted`（WARN/ERROR），成功路径含 `collect-ok` 且 `mode` 为 `http`/`browser` |
| AC-12 | 真机判据（人工一次） | 百家号文章 URL 采集 → 正文 >1000 字且不含「拖动左侧滑块」；断网/风控场景 → 显示安全验证文案而非成功 |

## 8. 残余限制

| 限制 | 说明 | 处置 |
|---|---|---|
| HTTP 仍可能被挑战 | 百度风控是概率性、按 IP/UA/频率动态调整的；本批 16/16 只是「当次」读数 | 失败即 fail-closed + 有界重试，不承诺「永不触发」 |
| 浏览器兜底仍可能失败 | stealth 浏览器实测 3/6 命中；百度校验持续升级 | 有界重试（≤2）+ 明确错误文案；长期方案见 §9 的 CDP/指纹路线 |
| Cookie / 登录态复用未做 | 本片不引入登录态池（隐私与合规成本高，且百家号文章页多数无需登录） | 记为后续可选方向（§9.2） |
| 缓存无 TTL | `ContentCache` 仅 LRU，进程内；本片只保证失败不写入 | 不扩范围；如需 TTL 另开片 |
| 旧数据不迁移 | 历史采集条目/草稿中的验证文字保留原样 | 用拦截 + 提示引导用户重采/删除 |
| Python env 兜底仍在 | 桌面未就绪时仍可能落到 env 路径 | 属兼容设计，不作为缺陷；日志区分「未注入」原因 |
| 判决依赖中文标记 | 若百度改文案（如去掉「拖动左侧滑块」），文本判据会漏 | 同时保留结构性判据（URL/title），并在日志留 `collect-challenge` 便于事后校准 |
| 未覆盖批量采集路径 | 本片聚焦单篇采集（用户报障路径）；批量链路的同类守卫另行评估 | 在 §10 记录实际覆盖范围 |

## 9. 参考方案（开源调研，2026-10-18）

> 调研限制（如实记录）：本机 `web_fetch` 对 `github.com` / `pypi.org` 等域名返回
> `URL hostname resolves to a non-public IP address`，**无法读取仓库 README 全文**；
> 下列结论来自搜索结果页的标题与摘要（可点击链接见下），未引用未读到的细节。
> 结论用途：判断「哪条策略值得借鉴」，不构成对任何项目行为的断言。

### 9.1 结论表

| 项目/资料 | 链接 | 可复用点 | 采用 | 理由 |
|---|---|---|---|---|
| MediaCrawler | https://github.com/NanmiCoder/MediaCrawler | 多平台内容采集（含知乎等）把「登录态/Cookie」作为采前置条件管理，而不是靠 UA 伪装 | **部分采用** | 采用其「采集前先确认凭证/通道可用」的思路 → 落成 `needsStealth` + `mode` 的显式路由查询；**不采用**其登录态池与批量抓取架构（本项目是桌面端单篇采集，引入 Cookie 池是隐私与合规负担） |
| MediaCrawler PR #963（`--check_session` 预检） | https://github.com/NanmiCoder/MediaCrawler/pull/963 | 「开爬前先验证会话/代理可用」作为独立步骤 | **采用（思路）** | 与本片「先判通道/判验证页再采集」同构；不引入命令行预检工具 |
| Anti-Anti-Spider | https://github.com/yinhangbupt/Anti-Anti-Spider | 针对具体站点的验证码/加密对抗代码合集 | **不采用** | 作者已声明项目暂停；对抗代码与站点版本强耦合、维护成本高；本项目产品化交付要求可维护与合规 |
| puppeteer-extra stealth 失效面（Issue #920） | https://github.com/berstend/puppeteer-extra/issues/920 | stealth 插件对 Cloudflare 类检测存在**公开未解**失败案例 | **不采用「只靠 stealth」** | 与本片实测一致：stealth 通道 3/6 被挑战 → 不能把 stealth 当兜底唯一手段，必须优先低成本通道 |
| Puppeteer Stealth vs Cloudflare（2026 评述） | https://webclaw.io/blog/puppeteer-stealth-cloudflare-2026 | 结论同向：UA/指纹补丁只能降低概率，不能消除挑战 | **参考** | 支撑本片「概率性 → 必须 fail-closed + 重试」的设计选择 |
| playwright-cdp-probe | https://pypi.org/project/playwright-cdp-probe/ | 探测 Playwright/CDP 特征以评估 stealth 有效性 | **不采用（可留作诊断）** | 属诊断工具，非运行时依赖；引入会扩大依赖面 |
| behavioral-biometrics-research | https://github.com/jeffasante/behavioral-biometrics-research | 用行为指纹（光标熵、OS 指纹）区分自动化 | **不采用** | 需真实人类行为模拟，成本与不确定性高；桌面端产品不应朝「绕过风控」方向加固 |
| BaijiaApis（百家号接口逆向） | https://github.com/cv-cat/BaijiaApis | 直接调用平台内部接口取正文 | **不采用** | 依赖未公开签名算法，随平台版本失效；合规风险高 |

### 9.2 未采纳但记录的方向（不进本片范围）

1. **登录态/Cookie 池**（MediaCrawler 思路）：本片不引入。若未来百家号要求登录，再评估「用户本人已登录浏览器的 Cookie 复用」而非服务端池化。
2. **CDP/指纹级伪装**（stealth 增强）：不引入。理由同上（成本、合规、可维护）。
3. **平台内部接口直连**（BaijiaApis 类）：不引入。理由：不可维护 + 合规风险。

### 9.3 采用的落点（与 §4 对应）

| 开源结论 | 本片落点 |
|---|---|
| 先确认通道可用再采集 | `url-collect:needs-stealth` 返回 `{ needsStealth, mode }`；渲染层按显式路由分流，不靠试错 |
| 不把 stealth 当唯一兜底 | 百家号改 HTTP 优先，浏览器仅作兜底 |
| 概率性挑战必须可诊断 | 新增日志事件 `collect-challenge` / `collect-challenge-exhausted`（含 `attempt/maxAttempts`） |
| 配置来源单一化 | 改写配置统一由桌面「模型设置」解析后下发（`request.llm` 优先），避免 env/UI 双真源 |

## 10. 实现落点（文件:行）

> 行号取自 worktree `mp-worktrees/mp-fix-collect-antibot-rewrite`（分支 `fix-collect-antibot-rewrite`），
> 2026-10-18 13:1x 代码冻结后逐条 grep 复核（与 T1/T2 报告一致）。基线 = `origin/main` 的 `f0c5d1faf`。

### 10.1 新增文件

| 文件 | 行数 | 职责 | 关键坐标 |
|---|---|---|---|
| `apps/desktop/electron/services/url-collector-antibot.js` | 255 | 验判据 / 请求头 / 路由清单的**单一真源**（纯函数，不 require 任何第三方模块，保证主进程与渲染层可各自加载） | 站点清单 65-73；`isVerificationPage` 149；`isVerificationContent` 168；`securityChallengeFailure` 176；`buildBrowserHeaders` 193 |
| `apps/desktop/electron/services/url-collector-browser.js` | 108 | 通道编排：浏览器有界重试（每次新 context）+ 百家号 HTTP 优先回退 | `collectViaBrowser` 63；日志事件 75 / 80；`collectHttpFirst` 95 |
| `apps/desktop/src/utils/collected-content-guard.js` | 76 | 渲染层同源判据（词表与主进程逐项相同，两端同判由测试锁定） | `isVerificationContent` 63 |
| `apps/desktop/electron/services/llm-runtime-config.js` | 245 | 桌面「模型设置」默认 llm → 请求 payload 的解析与注入决策 | `resolveDefaultLlmRuntime` 96；`resolveRewriteLlmPayload` 186；`applyLlmToBody` 227 |

新增测试：`url-collector-antibot.test.js`（189 行）、`collected-content-guard.test.js`（93 行）、`llm-runtime-config.test.js`（184 行）。

### 10.2 修改文件

| 文件 | 变更职责 | 关键坐标 |
|---|---|---|
| `apps/desktop/electron/services/url-collector.js` | 三分支路由（browser / http-first / http）+ 完整浏览器头 + 解析前/后双判验证页 + 百家号正文容器 + 验证页失败不计熔断 + `needs-stealth` 返回 `mode` | 路由 177-180；验证页不计熔断 192-207；完整头 237；解析前判据 254；解析后判据 340；百家号容器 298-302；`needs-stealth` 477 |
| `apps/desktop/src/views/Collection.vue` | 渲染层第二道守卫 + 落库守卫 + 结构化 reason 消费 + stealth 分支改写改走桌面引擎 | import 458；`persistDraft` 守卫 920-921；`collectErrorSource` 1081；`isSecurityChallenge` 1121；`abortIfVerificationPage` 1136；三处调用 1272 / 1326 / 1462；stealth 自动改写 1476 |
| `apps/desktop/src/utils/collect-error.js` | 结构化 `reason` 优先（白名单内直接采信） | 白名单 32；采信 83 |
| `apps/desktop/electron/ipc-handlers/aggregation.js` | `aggregation:rewrite` 注入桌面默认 llm / 未配置短路 | handler 126；注入 129 |
| `apps/desktop/electron/ipc-handlers/zhihu-favlist.js` | 批量改写与收藏批量复用同一注入 helper（split 口径 499 行，已压回 500 红线内） | 注入 import 25；short-circuit 148-149；`body.llm` 155；批量路径 288 / 382 |
| `apps/desktop/src/utils/user-facing-error.js` | 新增稳定码 `LLM_NOT_CONFIGURED` | 39 |
| `apps/desktop/src/locales/collection/zh.js`、`en.js` | 更新 `collectErrors.security_challenge`（26）、新增 `draftBlockedSecurityChallenge`（50） | zh/en 成对 |
| `apps/desktop/src/locales/user-errors/zh.js`、`en.js` | 新增 `LLM_NOT_CONFIGURED` 文案 | 24（zh/en 成对） |
| `packages/python-backend/src/multi_publish/aggregation/models.py` | 请求级 `LlmOverride` 模型 | `LlmOverride` 152；`RewriteRequest.llm` 177 |
| `packages/python-backend/src/multi_publish/aggregation/service.py` | LLM 配置解析顺序与装配（`request.llm > env`，逐字段回退） | `_resolve_llm_settings` 212；rewrite 前置校验 247/254；adapter 326/341；pipeline 422/428 |

### 10.3 与门禁相关的规模事实

- 债务熔断（`scripts/check-debt-budget.js`）在 worktree 实跑 **rc=0**：`filesOver500=95 ≤ baseline 101`。
- 过程中发现并已修掉一处跨线：`zhihu-favlist.js` 一度 506 行（split 口径）越过 500 红线，
  T2 抽出 `applyLlmToBody` helper 后回落到 **499（split 口径 499 < 500）**。
- 新增源文件均 < 300 行；`url-collector.js` 保持 497 行（未跨线）。


## 11. 测试清单

### 11.1 定向测试（T1/T2 实跑，命令与计数逐字取自输出）

```
cd apps/desktop && pnpm vitest run \
  electron/services/url-collector.test.js electron/services/url-collector-antibot.test.js \
  src/utils/collected-content-guard.test.js electron/services/llm-runtime-config.test.js \
  electron/ipc-handlers/aggregation.test.js electron/ipc-handlers/zhihu-favlist.test.js \
  src/views/Collection.test.js src/utils/collect-error.test.js src/utils/user-facing-error.test.js
→ Test Files 9 passed (9) / Tests 366 passed (366)
```

| 测试文件 | 本片计数 | 归属 | 覆盖 AC |
|---|---|---|---|
| `electron/services/url-collector-antibot.test.js` | 24 | 新增 | AC-2 / AC-3 / AC-4 / AC-7 |
| `electron/services/url-collector.test.js` | 89 | 扩展（+25 条新用例，含 QM-6-P3-② 熔断回归） | AC-1 / AC-2 / AC-3 / AC-7 / AC-11 |
| `src/utils/collected-content-guard.test.js` | 8 | 新增 | AC-4 |
| `electron/services/llm-runtime-config.test.js` | 12 | 新增 | AC-8 / AC-9 / AC-10 |
| `electron/ipc-handlers/aggregation.test.js` | 23 | 扩展（+5） | AC-8 / AC-9 / AC-10 |
| `electron/ipc-handlers/zhihu-favlist.test.js` | 17 | 扩展（+5） | AC-8 / AC-9 |
| `src/utils/collect-error.test.js` | 50 | 扩展（+4） | AC-5（分类采信） |
| `src/utils/user-facing-error.test.js` | 29 | 扩展（+4） | AC-8（文案稳定码） |
| `src/views/Collection.test.js` | 114 | 扩展（+5，含 QM-6-P3-① 结构化 reason 两例） | AC-5 / AC-6 |

### 11.2 新增用例名（按文件，逐字）

- `url-collector-antibot.test.js`：实测 CHALLENGE 页 → 判验证页 / 只有 HTML 无最终 URL 也能判 / 实测 OK 页 → 不判 / 空输入不抛错 / 脚本内标记不单独判真（噪声隔离） / captcha URL 结构化信号 / title 信号 / 只传 HTML 时 title 从 HTML 提取 / ≥2 强标记 / 1 强标记 + <300 字 / 1 强标记 + ≥300 字不判 / 弱标记全中不判 / **误杀反例：长文含「网络不给力」不判** / 组合页脚单独不判 / 组合页脚 + 另一强标记判真 / failure 结构三字段 / 请求头三项断言 / 两份清单与 `routeFor` 三分支。
- `collected-content-guard.test.js`：title 命中 / 实测 CHALLENGE 正文 / 实测 OK 文章 / 误杀反例 / 弱标记不判 / 空输入 / **常量逐项相等** / **同一输入两端同判（矩阵）**。
- `llm-runtime-config.test.js`：多模态默认 provider 解析 / 单能力 llm 回退 `models[0]` / manager 未就绪（缺失 / 方法不全 / `_ready=false`）→ `MANAGER_UNAVAILABLE` / `NO_DEFAULT` / `NO_API_KEY` / `NO_MODEL` / 失败不含 Key 明文 / 异常不含 Key / `applyLlmToBody` 返回新 body 不改入参 / 未配置 → shortCircuit / 显式 llm 不覆盖 / 无 manager 降级不短路。

### 11.3 Python 侧

```
cd packages/python-backend && python -m pytest tests/test_aggregation.py -q
→ 51 passed in 23.09s（基线 43，+8）
```

新增用例：`test_rewrite_request_accepts_llm_override`、`test_rewrite_request_llm_optional_and_fields_optional` 等（覆盖 `request.llm` 解析、逐字段回退、缺省兼容）。

### 11.4 回归波及（T1/T2 报告，非本片主判据）

`observability-messagekey.test.js` 32、`url-collector-content-ready.test.js` 7、`zhihu-fav-batch` 31、`phase5-ipc` 28 均通过。


## 12. 门禁结果

### 12.1 已实跑（命令 + 输出）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 桌面定向测试 | 见 §11.1 | `Test Files 9 passed (9) / Tests 366 passed (366)` |
| Python 定向测试 | 见 §11.3 | `51 passed in 23.09s`（基线 43，+8） |
| 债务熔断 | `node scripts/check-debt-budget.js` | **rc=0**：`maxFileLines 5098 ≤ 5657`、`filesOver1000 28 ≤ 32`、`filesOver500 95 ≤ 101`、`modelProviderRequireFanOut 65 ≤ 65`、`circularDeps 0` |
| 真机采集（T1，一次性脚本 `<TEMP>\antibot-real-probe.js`） | 对目标 URL 连续 2 次 `collect` | `success:true`、title=真实文章标题、`contentLen=3521`、`verifyMarkersInResult=[]` |
| CHALLENGE 页 fail-closed（T1，生产 `_parseHtml` 6 次入参组合） | 3 份落盘 CHALLENGE × {captcha URL, 普通文章 URL} | **6/6** 返回 `{success:false, reason:"security_challenge", contentLen:0, error:"目标站点返回安全验证页（百度安全验证）…"}` |
| OK 页不误杀（T1） | 3 份落盘 OK 页过生产解析器 | success 且 `contentLen = 3521 / 4639 / 3521`，零标记命中 |
| 判据明细（T1） | 同一输入打印 `evaluateVerification` | `urlHit=true、titleHit=true、textHits=4、weakHits=5、textLength=123` |

### 12.2 T3 独立复核（与 T1/T2 实现无关的第三方复算，2026-10-18 13:0x）

用 worktree 版 `url-collector-antibot.js` 直接跑**已落盘的现场产物**（脚本 `<TEMP>\t3-verify-t1t2.js`，日志 `<TEMP>\t3-verify-t1t2.log`）：

| 断言 | 结果 |
|---|---|
| 3 份 CHALLENGE 页 `isVerificationHtml(html, captchaUrl)` | **3/3 true**（每份 `titleHit=true、urlHit=true、textHits=4、textLength=123`） |
| 4 份 OK 页（HTTP 1 份 + stealth 3 份）不得判真 | **4/4 false** |
| 误杀反例（弱标记长文 / 「图片由AI生成」说明 / 标题含「验证」） | **3/3 false**；刻意判真项（1 强标记 + 极短正文）为 **true**（符合 §3.1 取舍） |
| worktree 版 `_parseHtml(CHALLENGE, captchaUrl)` | `success=false / reason=security_challenge`（修复前为 `success=true / contentLen=101`） |
| worktree 版 `_parseHtml(OK, articleUrl)` | `success=true / titleLen=37 / contentLen=3521` |
| 正文容器 `[data-testid="article"]` | 真实 OK 页命中 1 个，提取 3521 字，正文头为文章首段（无「搜索/复制」页面 chrome） |

> 说明 `3832 vs 3521` 的差：§2.1 E4 的 3832 是**旧「最多 `<p>` 容器」启发式**的产出（含页面 chrome）；
> 本片改用 `[data-testid="article"]` 后为 3521（纯正文）。两者都是真实命令输出，不是矛盾。

### 12.3 待 Lead 提交前补跑并回填

| 门禁 | 状态 | 备注 |
|---|---|---|
| QM-1 打包 + 启动三层判据 | ✅ | `pnpm run build:vue` rc=0；`pnpm exec electron-builder --win --dir --publish never` rc=0；asar 含 3 个新主进程模块；`check-asar-test-files` rc=0；启动实测 `aliveAfter12000ms=true / userDataCreated=true / stderrLen=0` ⇒ PASS；`ELECTRON_RUN_AS_NODE=1` 已剔除并告警 |
| QM-4 视觉回归 | N/A（有据） | 未改模板/样式/DOM；locale 仅错误态文案，默认视图不渲染；文案断言由 `Collection.test.js` 锁定（详见执行记录） |
| 接线棘轮（`check-unwired-tests`） | ✅ | `检查域内测试文件 101 个 / OK: 全部测试均已接线或按欠账登记`（rc=0） |
| 行尾两口径对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 逐档完全相同（32 文件；文档读数 524/28/57/21/126，新增文件删除数 0） |
| QM-6 双模型外部评审 | ✅ | 轴 A `codex exec review --uncommitted`（codex-cli 0.144.6）：0 CRITICAL/0 MAJOR、2 P3 → **采纳 2/2**（结构化 reason 被解包丢弃 + security_challenge 计入熔断）；轴 B `claude -p`（Claude Code 2.1.301）：0 CRITICAL/0 MAJOR、7 MINOR → **采纳 0/7**（均属「现状可接受/不影响行为」，理由见执行记录） |
| `classify-docs-only` / PR 号 | ⏳ 待回填 | 混合 PR（运行时代码），预期 `docs-only=false`；`PR #PENDING` |


## 13. 交付记录

| 项 | 值 |
|---|---|
| PR | `PR #PENDING`（合并后由门禁按主干历史推导收口，不手写状态词） |
| 分支 / worktree | `fix-collect-antibot-rewrite` / `mp-worktrees/mp-fix-collect-antibot-rewrite`（运行时代码改动全部在 worktree） |
| 执行记录 | [`openspec/records/fix-collect-antibot-rewrite.md`](../openspec/records/fix-collect-antibot-rewrite.md)（QM-1~QM-6 + QM-5 五步 + 任务勾账） |
| CHANGELOG | `CHANGELOG.md` 顶部条目 `# [未发布] fix(collect): 百家号采集不再把「百度安全验证」页当正文，采集页改写改走桌面模型设置（fix-collect-antibot-rewrite）`（问题 / 改动 / 验证 三段） |
| 产品契约追加 | `01-docs/PRD.md` 末尾新增 `## 附录：采集反爬验证页与改写 LLM 配置契约（2026-10-18，fix-collect-antibot-rewrite）`（指向本 PRD，不重复全文） |
| 记忆沉淀 | `01-docs/learnings.md` 顶部新增 5 条教训（`## 反爬验证页与双份配置源：五条可复用教训（fix-collect-antibot-rewrite，2026-10-18）`） |
| 证据根（只读使用，未修改） | `<TEMP>\baijiahao-probe*.js`、`<TEMP>\baijiahao-probe-out\*`；DB 只读副本 `shared-user-data/multi-publish.db`（未写回、未输出 Key 值） |

### 13.1 本片交付的稳定契约（供后续复用）

1. **验证页判据是单一真源**：主进程 `url-collector-antibot.js` 持有常量与判定，渲染层只经 `collected-content-guard.js` 转发；改一端不改另一端由测试当场判红。
2. **采集路由显式化**：`routeFor(hostname)` 三值（`browser` / `http-first` / `http`）同时用于主进程分派与 `url-collect:needs-stealth` 的 `mode` 返回。
3. **失败结构带 `reason`**：`security_challenge` 走 `classifyCollectError` 的结构化白名单，不再依赖中文文本匹配。
4. **改写配置单源下发**：桌面默认 llm 由 `applyLlmToBody` 统一注入，Python 按「`request.llm` > `LLM_*` > `PO_OPENAI_*`」**逐字段**回退；用户确实未配置时短路 `LLM_NOT_CONFIGURED`（不发请求）。

### 13.2 已知待办（不属本片范围）

见 §8 与执行记录「遗留」节；其中「批量采集链路的同类守卫审计」与「内容缓存 TTL」为最优先的后续候选。


## 附录 A 证据复跑命令

```powershell
# E1/E2：落盘 HTML 的 title / 段落数 / 文本量
node <TEMP>\t3-extract-html.js

# E3：生产解析器对 CHALLENGE 页的判定（关键证据）
node <TEMP>\t3-challenge-parse.js

# E4/E6：生产解析器解析正常页 + 仓库现用截断 UA 的 4 次直连
node <TEMP>\t3-parse-and-ua.js

# E5：普通 HTTP 16 次直连（完整 Chrome UA）
node <TEMP>\t3-probe-http16.js

# E7：DB 只读核对（不打印 Key 值）
node <TEMP>\t3-db-focus.js
```

## 附录 B 术语

| 术语 | 含义 |
|---|---|
| CHALLENGE 页 | 被重定向到百度安全验证（滑块/扫码）后返回的页面；title=「百度安全验证」，正文为验证提示文案 |
| fail-closed | 判据命中即按失败处置（宁可报错，不得把可疑内容当正文返回） |
| http-first | 先走普通 HTTP 直连，失败再回退 stealth 浏览器的路由策略（本片给百家号） |
| 稳定错误码 | 前后端/日志共用的不可变字符串码（如 `LLM_NOT_CONFIGURED`、`security_challenge`），文案由 locale 渲染 |
| 有界重试 | 次数上限内的重试，每次重试换新上下文 |
