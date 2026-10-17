# 逆向工程成果完整清单（大全集）

> **口径**：截至 **2026-10-17**，凡标注「已进主干」的条目都在 `origin/main` 上（本轮逐条用 `git merge-base --is-ancestor` 核过）。
> 「实测」= 本轮直接读文件/跑命令得到；「引自报告」= 采信既有报告并给出锚点。
> **可核验原则**：每个数字都给出**复核方法**（§10）；不能复核的一律标「未核」。
> **一句话**：22 份报告 / 13,453 行 + 25 个取证脚本 + 134 个数据文件 → 沉淀出 **6 类代码成果、7 份文档、6 篇执行记录、2 篇方法论**，
> 其中 **exe 本体没有代码成果**（加壳反编译失败，见 §5.1）。

---

## 1. 总览数字

| 维度 | 数量 | 说明 |
| --- | ---: | --- |
| 研究素材文件（仓内）| **181** | 全部已 `git ls-files`（22 md + 25 cjs + 134 数据文件）|
| 报告行数 | **13,453** | 实测（`\n` 切分）；总索引自报 21 份 13,191 行（少 36 行，属索引写后微调）|
| 取证脚本 | **25** | 全部只读（无一写源文件）|
| 派生文档（本轮新增）| **3** | DLL 接口契约 / 平台能力矩阵 / 缺陷同型风险清单 |
| 代码成果模块 | **11** | §5（含 3 个算法库 + 分类/指标读取层 + 卡片管线 5 件 + 数据导入器）|
| 落地 PR | **9** | §7 |
| 执行记录 | **6** | §8（5 篇既有 + 1 篇本轮）|
| 未闭合边界 | **15** | §11（13 条既有 + 2 条本轮新增）|

---

## 2. 成果分类总表

| 类 | 载体 | 主要产出 | 状态 |
| --- | --- | --- | --- |
| **A 情报**（竞品拆解与研究）| `01-docs/research/competitor-reverse-2026-10-13/` | 22 份报告 / 13,453 行 | ✅ 已进主干 |
| **B 数据资产** | 同上 + `config/` | 134 数据文件 + 2 份运行时配置 | ✅ 部分进仓（见 §4）|
| **C 代码** | `packages/shared-utils/src/`、`apps/desktop/`、`scripts/`、`config/` | 11 个模块（含 3 算法库）| ✅ 已进主干 |
| **D 文档/PRD** | `01-docs/` | 7 份（PRD / 架构 / 计划 / 目录 / 总览）| ✅ 已进主干 |
| **E 执行记录** | `openspec/records/` | 6 篇 | ✅ 已进主干 |
| **F 方法论** | `01-docs/research/…/` | 2 篇（门禁缺陷案例 / 度量工具同族错误）| ✅ 已进主干 |
| **G 派生工具文档** | `01-docs/research/…/derived/` | 3 份（本轮）| 本轮新增 |

---

## 3. A 类：22 份报告清单（行数为实测）

**竞品拆解（6）**

| 报告 | 行数 | 一句话 |
| --- | ---: | --- |
| `竞品分析报告.md` | 1031 | 总入口：三方技术栈、功能差距、可复用清单 |
| `融媒宝-完整拆解.md` | 1107 | CEF + 原生混合架构、签名页集群、72 功能接口、JS↔C++ 桥接 |
| `Refproduct-完整拆解.md` | 796 | Electron 标准架构、9 窗口、47 IPC、本地签名、CDP 拦截 |
| `融媒宝-data.zip数据集拆解.md` | 413 | **31 平台 / 11,623 分类节点**、5 种 JSON 形态、加密词库判定 |
| `融媒宝-view-ai-clip拆解.md` | 939 | 一键成片：三级降级组合、时间轴模型、**4 个 CRITICAL** |
| `融媒宝-view-xhs-template拆解.md` | 667 | 红薯模版：测量驱动分页器、**22 条缺陷** |

**数据资产（5）**：`wemedia-article-preview.md` 723 ｜ `wemedia-data-analysis.md` 470（**已被 data.zip 那份取代**）｜ `wemedia-feature-apis.md` 196 ｜ `Refproduct-platforms.md` 220 ｜ `Refproduct-renderer.md` 96

**原生层（4）**：`原生层分析报告.md` 646（**66,199 函数 / 13,120 字符串 / 5 导出 / 15 种 ffmpeg**）｜ `原生层分析补充报告.md` 281 ｜ `mtm-platform-apis.md` 1532（**1,339 端点**）｜ `mtm-strings-analysis.md` 2352

**签名与安全（3）**：`深挖补充报告-第5轮.md` 464（5 种签名策略全景）｜ `签名方案深度分析.md` 470（要不要做 + 小红书三次反转教训）｜ `关键缺陷-抖音签名cookie名不匹配.md` 333（**唯一闭环到合入的竞品缺陷**）

**平台覆盖（1）**：`平台覆盖差距分析.md` 135（缺 38 / 独有 5 / 视频号 P0）

**复盘与方法论（2）**：`案例-门禁缺陷出路④恒不可达.md` 189 ｜ `方法论-度量工具的五次同族错误.md` 167

**索引（1）**：`交付物总索引.md` 226

**总入口（1，在 `01-docs/` 根）**：`RESEARCH-COMPETITOR-REVERSE-2026-10-13.md` 433 —— 一站式回答「做了什么、得到什么」

---

## 4. B 类：数据资产

| 资产 | 规模 | 位置 | 是否进仓 |
| --- | --- | --- | --- |
| `platform-data/`（分类映射原文 + 统计）| **134 文件** | 仓内研究目录 | ✅ |
| `wemedia-data-zip/data/`（data.zip 解出物）| 130 文件 / 1.57 MB | 仓外工作区 | ❌（体积）|
| 参考产品 asar 解出源码 | 44 文件 / 9.5 MB（主进程 bundle **7.45 MB / 108,243 行 / 566 模块**）| 仓外工作区 | ❌（合规：竞品混淆产物不入库）|
| `mtm-strings-all.json`（DLL 字符串全量）| 1.5 MB / 13,115 条 | 仓外工作区 | ❌ |
| 参考产品原始证据导出 | **172 MB** | 仓外工作区 | ❌（一般不必读）|
| **分类对照表（运行时）** | **228.8 KB / 6 平台 / 1,601 节点** | `config/platform-taxonomy.json` | ✅ **已进主干** |
| **指标矩阵（运行时）** | 7,146 B / 2 组（11+7 指标）/ 10 平台 | `config/platform-metric-matrix.json` | ✅ **已进主干** |

⚠️ **必须说清的差额**：研究阶段是 **31 平台 / 11,623 节点**，进仓只有 **6 平台 / 1,601 节点（13.8%）**。
原因不是漏做，而是 `scripts/import-platform-taxonomy.js` 的 `PLATFORM_PREFIXES` 只映射「本项目已支持且确有条目 ID 数据」的 6 个平台；
`PLATFORMS_WITHOUT_ID_DATA` 显式登记了 `kuaishou`/`wechat_mp`/`tencent_video`（后者是**刻意排除**：数据集的表属腾讯视频而非视频号）。
细节与审计发现见 `derived/平台能力矩阵.md` §3。

---

## 5. C 类：代码成果（11 个模块，全部已进主干）

### 5.1 先否证「exe 代码成果」

| 目标 | 结论 | 证据 |
| --- | --- | --- |
| 融媒宝 `WEMedia.exe` | ❌ **不可反编译** | `.text` 12.4 MB + 加壳，三档超时（默认/30/60 min）**全失败** |
| 参考产品 exe（196.4 MB）| ❌ **不可反编译** | 超 REA 128 MB 快照预算 |
| `MediaTaskMgr.dll` | ⚠️ **只有伪代码片段** | 5 个导出里仅 `InitMediaTaskMgr` 有 `procedure_pseudo_code`（6,019 字符，`authority: shipped-artifact`）；**未做成可编译组件** |

⇒ 所谓「exe 后的代码成果」实际来自：**DLL 伪代码（1/5 导出）+ JS 层源码（asar / CEF 前端）**。

### 5.2 已落地的模块

| 模块 | 行数 | 用例 | 来源 | 合入 |
| --- | ---: | ---: | --- | --- |
| `packages/shared-utils/src/media-combination.js` | 230 | 20 | 竞品「一键成片」三级降级组合 | PR #3533 `c32b2da78` |
| `packages/shared-utils/src/timeline-flatten.js` | 239 | 23 | 竞品时间轴绝对时间拍平 | PR #3534 `faa153b2a` |
| `packages/shared-utils/src/card-paginator-core.js` (+`.browser.js`) | 269 (+272) | 22 + 8(parity) | 竞品「红薯模版」测量驱动分页器 | PR #3535 `b7bf918e6` |
| `packages/shared-utils/src/platform-taxonomy.js` (+`.browser.js`) | 341 (+239) | 22 | data.zip 分类体系读取层 | P0 |
| `scripts/import-platform-taxonomy.js` | 306 | 10 | 同上（GBK/UTF-8 双解码 + fail-loud）| P0 |
| `packages/shared-utils/src/platform-metric-matrix.js` | 256 | — | `mediadatamgr.ini` 指标矩阵 | P1-1 |
| `apps/desktop/electron/services/account-metrics/capability.js` | 156 | — | 指标 → 账号能力字段 | P1-2 |
| `apps/desktop/electron/services/generated/card-paginator.iife.js` | 190 | — | 分页器 esbuild 产物（P2-2 接线）| P2 |
| `apps/desktop/src/features/cards/useArticlePagination.js` | 129 | ✅ | 正文 → 分页器 items | P2-6 |
| `apps/desktop/src/features/cards/useCardsPipeline.js` | 144 | ✅ | 分页 → 渲染 串联 | P2-5/6 |
| `apps/desktop/src/features/cards/useCardsRender.js` + `CardsRenderPanel.vue` | 143 + 129 | ✅ | 卡片渲染交互 | P2-5 |

### 5.3 唯一「从发现到修复」的竞品缺陷（真实生产修复）

抖音 API 链按 `s_sdk_sign_data_key/web_protect=`（含 `/`）找 cookie，而 **Chromium 拒绝含 `/` 的 cookie 名**（948 条 cookie 中含 `/` 的为 0）⇒ Step 0 恒 `fail-closed`，抖音 API 发布**从未成功**。
修复：单一事实源（后缀锚定 + 代际号 `\d+`）。验证：引擎 **411 passed** + 4 条防再犯结构锁 + **变异反证** + 打包产物 A/B。
合入：PR #3468 → `994a1fa17`；回填 PR #3470 → `94e0cb448`。

### 5.4 P3 平台覆盖前置（判据加固）

| PR | commit | 内容 |
| --- | --- | --- |
| #3604 | `0fc916fee` | 三个既有平台补 `enabled`（把「已登记缺口」改成棘轮）|
| #3610 | `a91b5d947` / `6a62a45b3` | 修判据⑨ 假绿（正则缺 `m`，6/15 平台从未被检查）+ 链名别名 |
| #3621 | `91dfc3fb9` | 修判据 7/8 过严（TAG_STYLES 缺席走默认兜底）+ 四层反向锁 |
| #3722 | `3e78471f1` | P3-2 四项遗留（B/C/D/E）+ CCG 八轮 upheld 全修 |

---

## 6. D 类：文档与 PRD

| 文档 | 行数 | 作用 |
| --- | ---: | --- |
| `01-docs/RESEARCH-COMPETITOR-REVERSE-2026-10-13.md` | 433 | 研究总览（含取代旧文档族的理由）|
| `01-docs/ARCH-REUSE-INTEGRATION-2026-10-13.md` | 1353 | 复用架构（数据流、模块边界、接线点）|
| `01-docs/PLAN-REUSE-ROLLOUT-2026-10-13.md` | 685 | P0–P3 落地计划（任务粒度 / 依赖 / 工时）|
| `01-docs/REUSE-CATALOG-2026-10-13.md` | 902 | 可复用资产目录 |
| `01-docs/PRD-PLATFORM-TAXONOMY-2026-10-13.md` | 1402 | 分类体系 PRD（含 §16 实施期实测修正）|
| `01-docs/TEST-PLAN-PLATFORM-TAXONOMY-2026-10-13.md` | 374 | 分类体系测试计划 |
| `01-docs/PRD-CARD-PAGINATION-RENDER-2026-10-14.md` | — | 卡片分页渲染 PRD |
| `derived/DLL-MediaTaskMgr-接口契约.md` | 本文新增 | 原生引擎接口契约与调用时序 |
| `derived/平台能力矩阵.md` | 本文新增 | 三方能力对齐（数据驱动判断）|
| `derived/竞品缺陷同型风险清单.md` | 本文新增 | 12 类同型风险 + 4 条建议锁 |

---

## 7. E 类：落地 PR 索引（9 个）

| PR | merge commit | 内容 |
| --- | --- | --- |
| #3533 | `c32b2da78` | 素材组合三级降级 |
| #3534 | `faa153b2a` | 时间轴绝对时间拍平 |
| #3535 | `b7bf918e6` | 分页纯逻辑层 |
| #3468 | `994a1fa17` | 抖音签名 cookie 名缺陷修复 |
| #3470 | `94e0cb448` | 上条的回填 |
| #3604 | `0fc916fee` | 三平台补 `enabled` |
| #3610 | `a91b5d947` | 判据⑨ 假绿修复 |
| #3621 | `91dfc3fb9` | 判据 7/8 过严修复 |
| #3722 | `3e78471f1` | P3-2 四项遗留 + CCG 八轮 |

---

## 8. F 类：执行记录与方法论

**执行记录（`openspec/records/`）**：`reuse-p0-p3-wire.md` 71 ｜ `reuse-rollout-2026-10.md` 57 ｜ `reuse-taxonomy-browser.md` 107 ｜ `docs-prd-p1-landing.md` 43 ｜ `p25-cards-entry.md` 127 ｜ 本轮新增 1 篇

**方法论（可直接复用）**：
1. `案例-门禁缺陷出路④恒不可达.md` —— 判据「出路④」恒不可达 7 天的第一性根因、四层逃逸、双会话平行修复、一次误判自纠。
2. `方法论-度量工具的五次同族错误.md` —— 一天内 5 次同型度量错误 + 3 个工具自身 bug；两条根因 + 三层机械防线（含变异反证）。

---

## 9. 仓外产物（不入库，但属本工作）

| 位置 | 内容 |
| --- | --- |
| `<REA_WORKSPACE>/analysis/` | 报告与脚本工作副本、`mtm-strings-all.json`（1.5 MB）、**asar 原始证据导出**（`*-asar-evidence.json`，172 MB，一般不必读）、asar 解出源码 44 文件 |
| `<REA_WORKSPACE>/使用手册.md`（28.7 KB）| REA 173 工具分类、Ghidra 12.1.4 + JDK 21 配置、实战流程、故障排查 |

> **合规说明**：竞品 asar 解出源码**刻意不入库** —— 报告本身就把「原样搬平台混淆产物」判为高风险不学，竞品源码同理，只作只读比对。

---

## 10. 每个数字怎么复核

```powershell
# 报告数与行数（逐份打印）
Get-ChildItem 01-docs/research/competitor-reverse-2026-10-13 -Filter *.md |
  ForEach-Object { $_.Name + ' = ' + ([IO.File]::ReadAllText($_.FullName) -split "`n").Count }
# 全部已进 git
git ls-files 01-docs/research/competitor-reverse-2026-10-13 | Measure-Object
# 代码成果确在主干
git merge-base --is-ancestor c32b2da78 origin/main   # 同理 3534/3535/3468/3604/3610/3621/3722
# 运行时配置的真实覆盖
node -e "console.log(require('./config/platform-taxonomy.json').stats)"
node -e "const m=require('./config/platform-metric-matrix.json');console.log(Object.keys(m.groups), Object.keys(m.groups[1].platforms).length)"
```

---

## 11. 未闭合边界（15 条，不假装已闭合）

**需要真实账号 / 联网**
1. 抖音本地签名**从未在真实平台验证**（活体裁决始终未做；实测所有真实 cookie 已过期）
2. 分类 ID 是 **2026-07-14 冻结快照**，未做任何联网校验
3. 竞品端点 1,339 条同样是冻结快照

**证据不足（要动态调试）**
4. 宿主是否在清洗 localStorage 后重推登录态
5. `web_protect` 载荷在新命名下的形态
6. `_mc_1_` 里 `1` 的语义
7. `comment_media_js.json` 注入的 JS 内容（未见实际脚本）
8. 平台内部整型 ID → 平台名映射未完全确认

**刻意不解**
9. `sensitivelibrary.txt` 793 KB 加密词库（只判形态，不破解）
10. QM-6 双模型外部评审（本机无 `codeagent-wrapper`）

**可继续挖**
11. 参考产品 89 个功能密集模块细节
12. 三方平台配置的**逐字段**对比
13. DLL 导出契约：4/5 个导出仍无反编译证据（§5.1）
14. **本轮新增**：`xiaohongshu` 在导入器两张清单里都没登记（读取层无法区分「无数据」与「漏导入」）
15. **本轮新增**：竞品端点总览逐行相加 1,338 vs 文档头 1,339（差 1 未追）

---

## 12. 已知矛盾与作废（引用前必看）

| 项 | 说明 |
| --- | --- |
| `wemedia-data-analysis.md`（470 行）vs `融媒宝-data.zip数据集拆解.md`（413 行）| 分析同一批数据；前者解析器只认一种形态，把分类报成 2,114（**少算 5.5 倍**）⇒ **取数一律用后者** |
| `analyze-wemedia-taxonomy.cjs` v1 | 少算 67%（3,838 vs 11,623），**保留作反例** |
| 1 处仍分歧的判断 | 融媒宝把大鱼号/企鹅号/搜狐号/一点号按 HTML 处理，我们登记为纯文本承载 ⇒ 两者必有一个更优，**需一次真机复核** |

---

## 13. 时间线（R1–R9 与 P0–P3）

| 阶段 | 时间 | 产出 |
| --- | --- | --- |
| R1 | 10-13 01:33–03:48 | asar 提取、字符串扫描、PE 导入表 |
| R2 | 10-13 10:41–10:56 | 三方平台对比、DLL 原生分析（1,338 API）|
| R3 | 10-13 11:15–11:53 | 原生层分析报告 + 补充 |
| R4 | 10-13 12:34–12:39 | 融媒宝 data/ 解析、功能 API 清册 |
| R5 | 10-13 13:42–13:56 | 签名方案深度分析、两份完整拆解、第 5 轮深挖 |
| R6 | 10-13 15:16–17:15 | **抖音 cookie 缺陷**诊断 → 修复 → 打包取证 → 合入（#3468/#3470）|
| R7 | 10-13 20:56–21:14 | data.zip 解开 + view-ai-clip + view-xhs-template 拆解 |
| R8 | 10-13 21:24–21:31 | 度量方法审计 + 3 个工具硬化 |
| R9 | 10-13 21:36– | 完备性审计（案例 / 方法论 / 总索引）|
| P0 | 10-14 | 分类体系进仓（配置 + 读取层 + 导入器）|
| P1 | 10-14 | 指标矩阵 + 素材组合（#3533）+ 时间轴拍平（#3534）|
| P2 | 10-14 | 分页纯逻辑（#3535）→ IIFE 接线 → offscreen 测量 → IPC → 渲染层 |
| P3 | 10-14 → 10-17 | 平台覆盖前置（#3604/#3610/#3621）+ 四项遗留（#3722）|
| 本轮 | 10-17 | 3 份派生文档（接口契约 / 能力矩阵 / 缺陷清单）+ 本大全集 |
