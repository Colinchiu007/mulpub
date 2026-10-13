# ARCH-REUSE-INTEGRATION-2026-10-13 — 竞品可复用项集成设计与详细实现方案

> **日期**：2026-10-13 ｜ **Worktree**：`mp-reuse-rollout`（分支 `reuse-rollout-2026-10`）
> **依据**：`D:\Data\projects\rea\analysis\`（22 份逆向报告 + 25 个取证脚本）、`01-docs/MP-REUSABLE-ACTUAL-PLAN.md`、`01-docs/PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md`、`01-docs/PRD-API-PUBLISH-ENGINE.md`
> **配套计划**：[PLAN-REUSE-ROLLOUT-2026-10-13.md](./PLAN-REUSE-ROLLOUT-2026-10-13.md)
> **性质**：设计文档，本文**不含任何代码改动**。

## 目录

§0 [核实范围说明（必读）](#0-核实范围说明必读) ｜ §1 [两条基线复核](#1-两条基线的独立复核) ｜ §2 [素材侧编码与形态修正](#2-素材侧的编码与形态修正) ｜ §3 [R-1 平台分类体系](#3-r-1-平台分类体系接入) ｜ §4 [R-2 指标能力矩阵](#4-r-2-平台指标能力矩阵) ｜ §5 [R-3 素材组合](#5-r-3-素材组合三级降级算法) ｜ §6 [R-4 时间轴拍平](#6-r-4-时间轴绝对时间拍平模型) ｜ §7 [R-5 卡片分页引擎](#7-r-5-测量驱动贪心装箱分页引擎) ｜ §8 [R-6 多源搜索](#8-r-6-多源搜索清单中文源) ｜ §9 [R-7 平台覆盖扩展](#9-r-7-平台覆盖扩展) ｜ §10 [已核实/待确认/不做](#10-已核实--待确认--不做-汇总) ｜ §11 [交叉引用与术语表](#11-交叉引用与术语表)

**每个 R 项固定 8 段**：目标模块与文件路径 → 数据模型/接口签名 → 集成点 → 与现有代码的关系 →
测试策略 → 验收判据 → 风险与回滚。（R-1/R-5 因复杂度额外含算法步骤与已修缺陷。）

---

## 0. 核实范围说明（必读）

**核实定义**：本文对**每一个「新增 X」主张**都执行了 `git grep` / `git ls-files` / 文件直读，
命令与命中结果**原样贴在正文**。未取证的一律标 `【待确认 U-n】` 并给出核实方法。

**为什么是硬前置**：`01-docs/MP-REUSABLE-ACTUAL-PLAN.md`（2026-09-11）记录了一次真实失败 ——
原方案假设 7 项缺失，审计发现 **6 项已存在**，真缺口只有 2 项。根因不是判断错，而是
**没在写方案前检索代码库**。本文不重复该错误。

**三条口径**：**已核实**（有 `文件:行号` 或零命中证据）｜ **待确认**（需真机/联网/运行时）｜
**不适用**（本仓无此概念，附零命中证据）。

**三个最重要的已核实负面结论**：

| # | 结论 | 证据 |
|---|---|---|
| **N-1** | `tag-suggest-data/platform-taxonomy.json` 是**孤儿文件**（存在但全仓零读取点），且**不含平台侧 ID**；生效规则硬编码在 `platform-rules.js` | §3.1 |
| **N-2** | 本仓**没有**「长文 → N 张固定尺寸卡片」能力；也**没有** html2canvas/dom-to-image 依赖 | §7.1 |
| **N-3** | 本仓**没有**任何素材组合（多排列）算法 | §5.1 |

**R-2 与 R-4 的特殊结论**：这两项的**目标在本仓已实现**（R-2 §4.1，R-4 §6.1），
因此正确形态是「**交叉校验 / 收敛**」而非「新增能力」。
**真实价值集中在 R-1 / R-5 / R-3**（见 §10）。

---

## 1. 两条基线的独立复核

### 1.1 ✅ 基线一成立：`rpa-view-manager.js` 已桥接 `CancelToken`

```js
// apps/desktop/electron/services/rpa-view-manager.js（文件头 + publish() 的 RPA 分支）
const { CancelToken } = require('@multi-publish/api-publish-engine/src/base-adapter')
const token = new CancelToken();  this._activeTokens[key] = token
```
```
> git grep -n "CancelToken" -- apps/desktop/electron/services/rpa-view-manager.js
…:const { CancelToken } = require('@multi-publish/api-publish-engine/src/base-adapter')
…:this._activeTokens = {}
…:const token = new CancelToken()
```
**结论**：`MP-REUSABLE-ACTUAL-PLAN.md` 的 Task 1 **已完成**，本文不重复设计。

### 1.2 ❌ 基线二成立：`ipc-handlers/validate.js` 确不存在

```
> git ls-files apps/desktop/electron/ipc-handlers/
（130+ 文件，含 helpers.js / publish.js / account.js …，无 validate.js）
```
**但本文不采纳旧计划的 Task 2**（新增统一校验中间件），理由见 §10.3-X-1。

---

## 2. 素材侧的编码与形态修正

### 2.1 分类映射是 **6 种**形态，不是 5 种

上轮报告称 5 种。本文**直读 8 个样本**后确认至少 6 种（样本均在 `wemedia-data-zip/data/`）。

| # | 形态 | ID 键 | 样本 | 实测片段 |
|---|---|---|---|---|
| A | `[{code,text}]` | `code`（数字） | `douyincategortmap.txt` | `[{"code":117,"text":"动植物"}, …]` |
| B | `[{id,name,cates:[{id,name}]}]` | `id` | `sohusubcategortmap.txt` | `[{"cates":[{"id":"1468","name":"国防观察"}],"id":"10","name":"军事"}]` |
| C | `[{child,id,name}]` | `id`（**中文串**） | `baijiavideocategortmap.txt` | `{"child":[{"child":null,"id":"军事历史","name":"军事历史"}]}` |
| D | `[{childrenCate,level,parentCate,title,titles,…}]` | `id`（数字，任意深度） | `sohuvideocategortmap.txt` | `{"id":300301301,"level":3,"parentCate":300301,"title":"国内","titles":"搞笑,脱口秀,国内"}` |
| E | `{名:[名…]}` / `{名:null}` | **无 ID** | `kuaishouvideosubcategort.txt`、`dayuvideosubcategort.txt` | `{"三农":["种植业",…]}`、`{"社会":null,…}` |
| **F**（新增） | `[{children:[{id,ids?,name}]}]` | `id` + **`ids`** | `weibovideocategortmap.txt` | `{"id":"4400850530203370","ids":"4400850530203370","name":"正能量"}` |
| **G**（新增） | `[{id:int,name,children:[…]}]` | `id`（数字） | `bilibilivideocategortmap.txt` | `{"id":160,"name":"生活","children":[{"id":21,"name":"日常"}]}` |

形态 F 的 `ids` 与 `id` 实测**逐字节相同**：取 `id`，把 `ids` 当**一致性自检**（不等即报警），
**不要静默择一**。`sohusubcategortmap.txt` 同文件含 B 与两级结构 ⇒ 同平台可跨形态。

### 2.2 ⚠️ 编码修正：指标矩阵文件是干净 UTF-8，「GBK 一刀切」被证伪

上轮报告 §3.4 转贴的样本呈 `#1:总收益 2、昨日收鐩?` 混合乱码，并据此把 `mediadatamgr.ini`
算进「78 GBK」。本文逐字节复核（1857 字节，UTF-8 解码）：`#1:总收益 2、昨日收益 3、图文总阅读数
4、昨天图文阅读数 5、总视频播放数 6、昨天视频播放数`，**U+FFFD 计数 = 0**。
⇒ 干净 UTF-8；上轮样本的乱码是**转贴过程中的二次编码损伤**，非文件属性。

**同批 `U+FFFD` 计数（UTF-8 / GBK）**：`mediadatamgr.ini` **0**/0 与 `tencentvideocategortmap.txt`
**0**/0 ⇒ 二者是**声称为 GBK 的 UTF-8 文件**，故上轮「未置 UTF-8 标志位 ⇒ 按 GBK 读」**是错的**。
纯 GBK 文件（UTF-8 坏字符 / GBK 坏字符）：`douyincategortmap.txt` 92/**0**、
`weibovideocategortmap.txt` 807/**0**、`bilibilivideocategortmap.txt` 620/**0**、
`deepsearchercat.txt` 189/**0**、`sohusubcategort.txt` 28/**0**、
`kuaishouvideosubcategort.txt` 1430/**0**、`baijiavideocategortmap.txt` 3846/**0**。
⇒ **R-1 的转换器必须逐文件双解码试探**（§3.4 步骤 1）。

### 2.3 规模数字为**转引**，非本次实测

31 平台 / 11,623 节点 / 64 个分类映射文件 / 26 个带 ID。来源：`rea/analysis` 的
「数据集拆解报告」§3.2–§3.3。**本文未重跑 `analyze-wemedia-taxonomy-v2.cjs`**；
R-1 的转换器自带对账（§3.4 步骤 6）。

---

## 3. R-1 平台分类体系接入

### 3.1 核实：本仓现状（五条证据）

**A —— 存在孤儿分类文件，全仓零读取点**：
```
> git ls-files | Select-String "platform-taxonomy"
apps/desktop/electron/services/tag-suggest-data/platform-taxonomy.json
> git grep -n "platform-taxonomy"
.ccg/tasks/archive/2026-08/smart-tag-suggest-v2/architecture-design.md:39  ← 设计稿
01-docs/PRD-SMART-TAG-SUGGEST-2026-08-31.md:59,80,311,702                ← PRD
（apps/ 下零命中）
```
**B —— 该文件无平台侧 ID**：110 行 / 1,937 字节，结构
`{version, platforms:{<slug>:{categories:string[], tagStyle}}}`；`categories` 全是裸中文名
（`"科技"、"财经"`），**无任何 ID 字段**。

**C —— 生效规则硬编码在 JS**：
```js
// apps/desktop/electron/services/tag-suggest/platform-rules.js:20-28
const PLATFORM_STYLES = {
  zhihu:{prefix:'',max:10,mode:'plain'}, weibo:{prefix:'#',max:10,mode:'hash'},
  xiaohongshu:{prefix:'#',max:10,mode:'hash'}, bilibili:{prefix:'',max:10,mode:'plain'},
  toutiao:{prefix:'',max:10,mode:'plain'}, douyin:{prefix:'#',max:10,mode:'hash'},
  wechat_mp:{prefix:'',max:10,mode:'plain'},
}
```
**结论 N-1**：分类数据的**载体已存在但无人消费且无 ID**。本项是「扩展一个孤儿文件 + 新建消费层」，
**不是从零新增**。

**D —— 只有两个平台有分类 ID 通路，且来源是调用方自己填空**：
```
> git grep -n "categoryId" -- apps/desktop/electron/services/publisher-router.js
…:208  // YouTube 分类 categoryId + 可见性 privacy
…:209  const categoryId = String(override.categoryId ?? base.categoryId ?? '').trim()
…:210  if (/^\d{1,2}$/.test(categoryId)) resolved.categoryId = categoryId
> git grep -n "const category" -- apps/desktop/electron/services/publisher-router.js
…:204  const category = Number(override.category ?? base.category)   // B 站分区 tid
…:205  if (Number.isInteger(category) && category > 0) resolved.category = category
```
其余 13 平台**完全没有分类字段**，且**没有可选项清单供给 UI**。

**E —— 两条已核实的落地先例**：
```jsonc
// apps/desktop/package.json（build.extraResources 含）
{ "from": "../../config", "to": "config", "filter": ["**/*", "!**/*.test.js", …] }
```
```js
// apps/desktop/electron/services/path-utils.js
function getConfigPath(filename) {
  if (isPackaged() && process.resourcesPath) return path.join(process.resourcesPath,'config',filename);
  return path.join(getProjectRoot(), 'config', filename);
}
// 使用先例：apps/desktop/electron/services/publisher-router.js:746
const resolvedPath = configPath || getConfigPath('platforms.yaml')
// 引擎侧对称入口：packages/api-publish-engine/src/runtime-config-path.js
//   resolvePlatformConfigPath() 支持 MULTI_PUBLISH_CONFIG_PATH / MULTI_PUBLISH_ROOT
```

### 3.2 数据落地形态

**新增文件**：`config/platform-taxonomy.json`（机器生成，可热更）。

**为什么放 `config/`**：① 已被 `extraResources` 整体打包到 `resourcesPath/config`，**零额外构建配置**；
② 主进程有 `getConfigPath()`、引擎有 `resolvePlatformConfigPath()`，**两侧都能读到**；
③ 热更只需替换文件 + 重启，无需发版。

**与 `config/platforms.yaml` 的关系：互补，不合并。** `platforms.yaml` = 发布配置（10 KB / 15 平台 /
**人手维护含注释** / 变更低）；本文件 = 分类树（≤1.5 MB / 26 平台 / **机器产物** / 变更高）。
键空间同为 `<slug>`，**必须一致**。**不合并的三条理由**：(a) 1.5 MB YAML 的解析成本与 diff 噪声
不可接受；(b) 机器重生成会给人手文件的注释带出大段无意义 diff；(c) 分类需要**版本与校验和**，
YAML 无自然位置放。

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-13T00:00:00Z",
  "source": { "kind": "vendor-data-zip",
    "archiveMtime": "2026-07-14T21:34:00+08:00",   // 冻结快照日期，必须显式
    "parserVersion": "1.0.0", "nodeCount": 11623, "platformCount": 26 },
  "platforms": {
    "douyin": { "displayName": "抖音", "vendorPlatformId": 36,
      "idKey": "code", "variant": "id", "channel": "video",
      "nodes": [{ "id": "117", "name": "动植物", "level": 1, "parentId": null, "path": ["动植物"] }] },
    "kuaishou": { "displayName": "快手", "vendorPlatformId": 35,
      "idKey": null, "variant": "name-only", "channel": "video",
      "nodes": [
        { "id": null, "name": "三农", "level": 1, "parentId": null, "path": ["三农"] },
        { "id": null, "name": "种植业", "level": 2, "parentId": "三农", "path": ["三农","种植业"] } ] }
  }
}
```
**字段语义**：`schemaVersion` 结构版本，消费层按此分派，**不认识的版本 fail-closed**（拒绝加载并告警），不猜；
`source.archiveMtime` 数据冻结日期，**必须显式**（报告 §6.5：这是 2026-07-14 快照）；
`idKey` 节点 ID 的**原始键名**（`code`/`id`/`channel_id`/`null`），仅作溯源与重生成对账；
`variant` = `'id'`（可 API 发布）/`'name-only'`（**不能** API 发布，只能供 UI 提示）；
`channel` 区分图文/视频分类集（竞品对同平台有 `*categortmap.txt` 与 `*videocategortmap.txt` 两套）；
`nodes[].path` 从根到本节点的名称路径，**扁平化存储** —— 所有消费场景都是「按名搜一节点取 ID」，
扁平 + 前缀路径让检索是 `filter` 而非递归。

**键名桥接（必做）**：竞品用**整型平台 ID**，本仓用 slug。顶层键**必须是 slug**；
原始整型 ID 存进 `vendorPlatformId`（只作溯源，**不参与运行时分派**）。

### 3.3 接取层接口签名

**新增**：`packages/shared-utils/src/platform-taxonomy.js`（CJS，主进程 + 引擎共用）

- `UNKNOWN_ID = null` —— 未知节点 id 的哨兵（与「真的是空字符串」区分）。
- `loadTaxonomy(options?: {filePath?, force?}) => object` —— 缓存（mtime+size 变了才重读，支持热更）。
  **@throws** 文件缺失 / JSON 非法 / `schemaVersion` 不认识 —— 一律抛错（fail-closed）。
- `getCategories(platformId, filter?) => Array<{id:string|null,name,level,parentId,path}>` ——
  返回副本（防突变污染缓存）；未收录平台返回 **空数组**（不是 `null`，空数组对 `for` 天然安全）。
- `resolveCategoryId(platformId, categoryName, options?) => {id,name,path}|null` ——
  发布链**唯一**取 ID 入口，支持 `"三农/种植业"` 路径形态。`null` 四种成因：
  平台未收录 / `variant=name-only` / 匹配不到 / **匹配到多个（歧义）**。
- `hasPlatformCategories(platformId) => boolean` —— 平台是否具备可提交的分类 ID。UI 据此决定是否渲染分类控件。
- `searchCategories(platformId, keyword, options?) => Array` —— 供 UI 的搜索式下拉（大小写不敏感，命中 `path` 任一层即算）。
- `validateTaxonomy() => string[]` —— 结构自检，返回问题清单，空数组即健康。
  参照 `publish-capabilities.js` 的 `validateRegistry()` 先例。

**导出接线**：`packages/shared-utils/src/index.js`（现 48 行，模式明确）加 1 行 `require` + 1 行 export。

### 3.4 转换器（一次性离线工序）

**新增**：`scripts/import-platform-taxonomy.js`。**输入** `rea\analysis\wemedia-data-zip\data\`（只读）；
**输出** `config/platform-taxonomy.json`。

> ⚠️ **合规边界（硬）**：输入来自竞品安装包，**不得复制进本仓**。转换器读**仓外绝对路径**；
> 产物只保留「平台 + 分类名 + 平台侧 ID」这类**事实性数据**（平台公开的类目 ID，不是竞品创作成果）。
> **禁止**把竞品的树形组织方式、注释文案、文件命名（含其拼写错误 `categort`）带进产物。

1. **逐文件双解码试探**（**不可**按 zip 标志位一刀切 —— §2.2 已证伪）：`utf8bad === 0 → UTF-8`；
   否则 `gbkbad === 0 → GBK`；两者皆非 0 ⇒ 记 `unreadable[]`，**不猜**。
2. **形态无关遍历**（6 种）：元素含 `{code,text}` / `{id,name}` / `{child}` / `{childrenCate}` /
   `{children}` 分别递归；顶层为对象且值非数组 ⇒ **键即名**形态（值为 `null` 或子名数组）。
3. **fail-loud**：非空文件解析出 0 节点 ⇒ 写入 `unreadable[]` 并 **exit 1**。
   **依据**：上轮 v1 因静默返回 0 把 11,623 少算成 3,838（**少 67%**），错误表现为「数字偏小」而非红灯。
4. **ID 一致性自检**：形态 F 的 `ids` 存在且 ≠ `id` ⇒ 记 `warnings[]`，取 `id`。
5. **slug 映射**（映射表写在脚本里，**未映射一律跳过**该平台并记 `unmappedPlatforms[]`，**禁止猜 slug**）：
   报告 §6.3 注释佐证 `1=wechat_mp`/`3=toutiao`/`4=baijiahao`/`5=yidian`/`6=qie`/`7=dayu`/`8=sohu`/
   `10=weibo`/`11=wangyi`/`12=zhihu`/`15=sinakandian`/`16=dongfang`/`17=dafeng`/`19=kuaichuan`/
   `20=aiqiyimedia`/`21=tencent_video`/`22=sohu_video`/`23=bilibili`；
   **`35=kuaishou`/`36=douyin`/`51=xiaohongshu`/`53=shipinhao`/`58=acfun`/`72=xueqiu` 由
   `mediadatamgr.ini` 的 `#快手`/`#抖音`/`#小红书`/`#视频号`/`#ACFUN`/`#雪球号` 注释直接佐证（本次实测）**。
6. **对账断言**（任一不过即 exit 1）：打印 `platformCount`/`nodeCount`；`nodeCount === 0 ||
   platformCount < 20` 报错；`variant:'id'` 平台**全部**节点有非空 `id`；`variant:'name-only'`
   平台**全部**节点 `id === null`；重算 `path` 与 `parentId` 链一致。

**验收**：连跑两次产物**逐字节相同**（确定性，排除遍历顺序依赖）。

### 3.5 版本与校验

1. **不把「有 ID」当「ID 有效」**：发布链取到 ID 后照常提交，由平台业务错误码裁决；
   平台报「分类不存在/非法」时**如实失败**，不重试、不猜别的 ID。
2. **过期可见**：距冻结日期 > 180 天时分类控件显示「数据可能过期」，阈值经 `MP_TAXONOMY_STALE_DAYS`
   覆盖，**非法值回落默认并告警**（对齐 `account-metrics/constants.js` 的 `resolveIntEnv` 纪律）。
3. **热更路径**：`loadTaxonomy({filePath})` > `MULTI_PUBLISH_CONFIG_PATH` > `MULTI_PUBLISH_ROOT/config`
   > `resourcesPath/config` > 仓库 `config/`。**不做**远端 CDN 下发（见 §10.3-X-10）。

### 3.6 集成点

| 层 | 文件 | 动作 |
|---|---|---|
| 数据 | `config/platform-taxonomy.json` | **新增**（机器产物） |
| 转换 | `scripts/import-platform-taxonomy.js` | **新增**（离线，可重跑） |
| 读取 | `packages/shared-utils/src/platform-taxonomy.js` | **新增**（唯一读取点） |
| 导出 | `packages/shared-utils/src/index.js` | **改** 2 行 |
| 路由 | `apps/desktop/electron/services/publisher-router.js` | **改**（下） |
| 注册表 | `packages/shared-utils/src/publish-capabilities.json` | **改**（加 `semantic:'category'` 字段） |
| UI | `apps/desktop/src/features/publish/components/PlatformOverridePanel.vue` | **改**（走注册表驱动） |

**(a) `publisher-router.js`：通用分类解析插在既有精确分支之前**
```js
const { resolveCategoryId, hasPlatformCategories } =
  require('@multi-publish/shared-utils/src/platform-taxonomy')
// 通用分类：仅当平台有分类能力且调用方给了名字时才解析。
// 既有 bilibili(category)/youtube(categoryId) 精确分支保持原样在后，仍然胜出。
if (hasPlatformCategories(platform) && override.categoryName !== undefined) {
  const hit = resolveCategoryId(platform, String(override.categoryName || '').trim(), { channel })
  if (hit) resolved.category = hit.id
  // 命中不到 ⇒ 不写字段（fail-closed：宁可平台用默认分类，也不提交编造的 ID）
}
```
**顺序不变量的理由**：`bilibili` 的 `category` 是数字分区 tid、`youtube` 的 `categoryId` 是两位数字串；
通用层产出的 `resolved.category` 是平台侧原始 ID 字符串。若通用层先跑，会用分类名解析结果
**覆盖调用方显式给的 tid** —— 这是「既有合同被破坏」的典型形态。

**(b) 引擎侧白名单：已核实无需改**
```js
// packages/api-publish-engine/src/publish/task-data.js:33 附近（已核实）
//   'category', 'copyright', 'categoryId', 'privacy', 'privacyLevel',
// packages/api-publish-engine/src/publish/publish-request.js:39（已核实，同）
```
两处**均已含** `category`/`categoryId`。需改的是**各平台适配器**：现在只有
`adapters/youtube.js:85` 读 `taskData.categoryId`（默认 `"22"`），其余不读分类。
新增平台分类消费时，**在对应适配器里读 `taskData.category`**。
★ 这是「核实后缩小改动面」的实例：原以为要改两处白名单，实测都已含该字段。

**(c) UI 走注册表，禁止新增 `v-if` 硬编码**
`PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md` §1.1 已把
「`PlatformOverridePanel.vue` 8 个平台硬编码 `v-if platform.id === 'xxx'`」列为**已识别问题**，
解法是 `publish-capabilities.json` 的 `overrideFields` 声明式注册表。
**本项必须复用该机制**：为有分类能力的平台加一条
`{key:'categoryName', semantic:'category', uiExposed:true, status:'implemented', …}`，
由 `getPlatformOverrideFields(platform,{uiOnly:true})` 驱动渲染。**禁止**新增 `v-if` ——
那会反向加重该 PRD 要修的债。**已核实**：`publish-capabilities.js` 已导出该函数与
`validateRegistry()`（后者已校验 `platform-capable` 字段必须带 `note` 证据）；
`classifyPublishFields()` 会自动把 `semantic:'category'` 归类（≥3 平台 → `common`）。

### 3.7 与现有代码的关系

| 关系 | 对象 | 说明 |
|---|---|---|
| **扩展** | `config/`（extraResources） | 加文件，不改构建配置 |
| **扩展** | `shared-utils/src/index.js` | 加导出，不动现有导出 |
| **扩展** | `publish-capabilities.json` | 加字段条目，不动现有条目 |
| **共存·不替换** | `tag-suggest-data/platform-taxonomy.json` | **本次不删不改名**（改名牵动 PRD 4 处引用）。二者**同名不同物**：新文件=平台分类 ID 树，旧文件=标签书写风格 + 6 个示意类目。处置：在 `packages/shared-utils/src/platform-taxonomy.js` 文件头显式声明区别（JSON 不能写注释） |
| **共存·不替换** | `tag-suggest/platform-rules.js` | 标签前缀/上限语义与分类 ID 无关，保持原样 |
| **不破坏合同** | `publisher-router` 的 bilibili/youtube 分支 | 通用层插其前，精确层仍胜出 |

### 3.8 测试策略

- **单测** `packages/shared-utils/src/__tests__/platform-taxonomy.test.js`：6 种形态的**精确节点数**断言；
  `idKey` 正确；`resolveCategoryId` 的 **4 种 null 成因各一例**；`variant` 与 `id` 一致性；
  同名歧义 ⇒ 返回 `null`（**不得择一**）。**为何必锁**：歧义静默择错 = 内容发到错误分类，**用户不可察**。
- **数据自检**（同上）：`validateTaxonomy()` 空数组；`platformCount >= 20`；`nodeCount === 11623`
  （与转换器对账数字一致）。
- **确定性** `scripts/import-platform-taxonomy.test.js`：同输入跑两次，产物 SHA-256 相同。
- **契约锁** `apps/desktop/electron/services/publisher-router.test.js`（**追加**）：
  ① 精确分支仍胜出（`category` + `categoryName` 同给 ⇒ 结果是 `category`）；
  ② 未知平台给 `categoryName` ⇒ `resolved.category` 未定义；③ 解析不到 ⇒ 字段不出现。
- **回归锁** `packages/shared-utils/src/__tests__/publish-capabilities.test.js`：
  新增 `semantic:'category'` 后 `classifyPublishFields()` 快照不意外变化。

### 3.9 验收判据

1. `node scripts/import-platform-taxonomy.js <src> <out>` 退出码 0，**连跑两次产物 SHA-256 相同**。
2. `source.nodeCount === 11623` 且 `Object.keys(platforms).length >= 20`。
3. `validateTaxonomy().length === 0`。
4. `resolveCategoryId('douyin','动植物').id === '117'`（实测值，§2.1 形态 A）。
5. `resolveCategoryId('kuaishou','三农/种植业') === null`（`name-only` 不得返回 ID）。
6. `resolveCategoryId('douyin','不存在的分类') === null`。
7. `publisher-router.test.js` **既有用例全绿**（未破坏 bilibili/youtube 合同）。
8. `hasPlatformCategories('douyin') === true`、`hasPlatformCategories('youtube') === false`
   （YouTube 不在竞品数据里，走既有专用通路）。

### 3.10 风险与回滚

| 风险 | 概率 | 影响 | 缓解 | 回滚 |
|---|---|---|---|---|
| **数据过期**（2026-07-14 快照 / 【U-1】） | **高** | 提交的 ID 被平台拒 | 失败如实上报不重试；UI 过期提示；分类是**可选字段**，无值走平台默认 | 清空该平台 `nodes` ⇒ 退化为「无分类能力」 |
| 形态识别漏一种 | 中 | 静默少算 | 转换器 fail-loud + `unreadable[]` + nodeCount 对账 | 重跑转换器 |
| slug 映射错 | 中 | 分类树挂错平台 | 未映射**一律跳过**；映射表逐条带注释佐证 | 从 `platforms` 删该键 |
| 破坏 bilibili/youtube 合同 | 低 | 分区/分类发错 | 插入顺序 + 契约锁（§3.8） | 摘掉通用层那段 |

**回滚成本**：删 1 `require` + 1 export + 1 JSON。**零数据迁移**（分类是提交时字段，不落库）。

---

## 4. R-2 平台指标能力矩阵

### 4.1 核实：本仓**已实现**该目标

```
> git ls-files apps/desktop/electron/services/account-metrics/
adapters.js 17857 / adapters.test.js 12078 / constants.js 6926 / cookies.js 3255
http.js 3144 / index.js 21505 / index.test.js 20003 / link.js 8468 / link.test.js 8429
signer-bridge.js 4751 / signer-bridge.test.js 2477 / throttle.js 5049 / throttle.test.js 4383
```
`adapters.js` 文件头**已写明**本项要立的判据（逐字引用）：
```
 * ⛔ 三条不可破的判据（PRD §3.1/§3.2）：
 *   ① 平台没有该字段 ⇒ `null`，**不是 0** —— 0 是「平台说这条是 0」，null 是「没这个字段」；
 *      小红书无分享数、抖音/头条无收藏，「补 0」就是把缺失伪造成数据（V10）。
 *   ② 解析失败（结构不符）⇒ 抛错由编排层记 failed，**不得返回空数组冒充「这个账号没作品」**。
 *   ③ 适配器不碰 Cookie 内容、不拼 Authorization
```
**结论**：R-2 的**目标（能力边界显式、不得编造拿不到的数）在本仓已实现**，位置是
`account-metrics/adapters.js` 的 `toCount()`（非法值一律 `null`）与 `pickCount()`。

**因此 R-2 的正确形态**：把竞品矩阵当**独立取证来源**，用于 ①UI 诚实显示能力边界
②**测试交叉校验**本仓适配器实现是否与声明一致。**直接新增平行矩阵会制造第二份真源**，
与本仓 `publish-capabilities` 立的「唯一真源」纪律冲突。

### 4.2 数据落地形态

**新增**：`config/platform-metric-matrix.json`。**定位：参考数据，不是运行时真源**
（运行时真源仍是 `account-metrics/adapters.js` 的实际字段解析）。

```jsonc
{
  "schemaVersion": 1,
  "source": { "kind": "vendor-ini", "archiveMtime": "2026-07-14T21:34:00+08:00",
    "note": "指标口径为厂商自定义分组，可能与本仓 metric key 不同名 —— 映射必须显式声明" },
  "groups": {
    "1": { "label": "内容数据", "metrics": {
      "1":"总收益","2":"昨日收益","3":"图文总阅读数","4":"昨天图文阅读数","5":"总视频播放数",
      "6":"昨天视频播放数","7":"粉丝数","8":"昨日评论数","9":"昨日点赞数","10":"昨日分享数","11":"昨日涨粉数" } },
    "2": { "label": "趋势数据", "metrics": {
      "1":"收益","2":"推荐","3":"播放","4":"评论","5":"点赞","6":"分享","7":"新增粉丝" } }
  },
  "platforms": {
    "wechat_mp":   { "vendorPlatformId": 1,  "groups": { "1":["1","2","4","6","7","10","11"], "2":["1","3","7"] } },
    "toutiao":     { "vendorPlatformId": 3,  "groups": { "1":["1","2","3","4","5","6","7","8","9","11"], "2":["1","2","3","4","5","7"] } },
    "baijiahao":   { "vendorPlatformId": 4,  "groups": { "1":["1","2","3","4","5","6","7","8","9","10","11"], "2":["1","3","4","5","6","7"] } },
    "douyin":      { "vendorPlatformId": 36, "groups": { "1":["1","2","6","7","8","9","10","11"], "2":["1","3","4","5","6","7"] } },
    "xiaohongshu": { "vendorPlatformId": 51, "groups": { "1":["4","6","7","8","9","10","11"], "2":["3","4","5","6","7"] } },
    "kuaishou":    { "vendorPlatformId": 35, "groups": { "1":["6","7","8","9","10","11"], "2":["3","4","5","6","7"] } },
    "bilibili":    { "vendorPlatformId": 23, "groups": { "1":["1","2","3","4","5","6","7","8","9","10","11"], "2":["1","3","4","5","6","7"] } }
  },
  "metricKeyMap": {
    "1": { "1":"income","2":"incomeYesterday","3":"readTotal","4":"readYesterday","5":"playTotal",
           "6":"playYesterday","7":"fans","8":"commentsYesterday","9":"likesYesterday",
           "10":"sharesYesterday","11":"fansGainYesterday" },
    "2": { "1":"income","2":"impressions","3":"play","4":"comments","5":"likes","6":"shares","7":"fansGain" }
  }
}
```
**矩阵原始数据（本次实测逐条录入，UTF-8）**：`[1]` 段各平台可用指标如下 ——
`1=1,2,4,6,7,10,11`（微信公众号）、`3=1,2,3,4,5,6,7,8,9,11`（头条号）、
`4=1,2,3,4,5,6,7,8,9,10,11`（百家号）、`5=1,2,3,4,5,6,7`（一点号）、`6=1,3,4,5,6,7`（企鹅号）、
`7=1,2,4,6,7`（大鱼号）、`8=1,2,3,4,5,6`（搜狐号）、`10=1,2,4,6,7`（微博）、`11=1,2,3,4,5,6,7`（网易）、
`12=1,2,3,4,5,6,7`（知乎）、`15=1,4,6`（新浪看点）、`16=2,3,5,7`（东方号）、`17=1,2,3,4,5,6,7`（大风号）、
`19=1,2,3,4,5,6,7`（快传号）、`20=1,2,5,6,7`（爱奇艺）、`21=1,6,7`（腾讯视频）、`22=7`（搜狐视频）、
`23=1,…,11`（哔哩哔哩，全 11 项）、`26=1,2,5,6,7`（秒拍）、`32=1,2,5,6,7,8,9,10,11`（西瓜视频）、
`35=6,7,8,9,10,11`（快手）、`36=1,2,6,7,8,9,10,11`（抖音）、`44=6`（百花号）、`48=5,6,7`（皮皮虾）、
`49=7`（微视）、`51=4,6,7,8,9,10,11`（小红书）、`53=6,7,8,9,10,11`（视频号）、`58=4,6,7`（ACFUN）、
`71=1,2,3,4,5,6,7`（凯迪号）、`72=3,4,5,6,7`（雪球号）、`85=1,2,6,7,8,9,10,11`（抖音代运营）。

> ⚠️ **`[2]` 段（趋势数据）本次也已取到，其口径为
> `1:收益 2、推荐 3、播放 4、评论 5、点赞 6、分享 7、新增粉丝`，与 `[1]` 不同名不同义**。
> 因此 `groups` 必须是**二维结构**（组 → 平台 → 指标），不能压成「平台 → 指标」一维。
> **这是上轮报告未指出的结构约束。**

### 4.3 接取层接口签名

**新增**：`packages/shared-utils/src/platform-metric-matrix.js`（CJS）

- `loadMatrix(options?) => object` —— 缓存 + mtime 失效。**@throws** 文件缺失 / JSON 非法 / `schemaVersion` 不认识。
- `getPlatformMetricCapabilities(platformId) => MetricCapability[]`，其中
  `MetricCapability = {metricKey, label, group:'content'|'trend'}`；未收录平台返回 **空数组**。
- `getMetricSupport(platformId, metricKey) => 'declared-available'|'declared-unavailable'|'unknown-platform'|'unknown-metric'`
  —— **三态查询**：必须区分「平台没这指标」与「我们不知道这个平台」。压成 boolean 会让二者都显示成「无」。
- `reconcileObservation(observation) => {verdict, note?}`，`verdict` 取
  `'consistent'|'declared-but-null'|'undeclared-but-present'|'unknown'` —— 交叉校验（供测试）。
  `declared-but-null` = 声明拿得到但实测 `null`（可疑：声明过期或适配器漏解析）；
  `undeclared-but-present` = 声明拿不到但实测有值。
  **★ `undeclared-but-present` 不是错误 —— 这条必须写进接口文档**：厂商矩阵是**他们产品的**
  能力边界，不是本仓的。本仓实测能拿到的即使厂商没声明也**应采信实测**；反过来（声明有、实测 `null`）才值得告警。
- `validateMatrix() => string[]` —— 结构自检，返回问题清单。

### 4.4 与 `PRD-PUBLISH-CAPABILITY-REGISTRY` 的关系

| 维度 | `publish-capabilities.json` | `platform-metric-matrix.json` |
|---|---|---|
| 方向 | **发布方向**（写进去什么字段） | **回收方向**（拿回来什么指标） |
| 平台范围 | 15（本仓全部） | ~30（厂商覆盖，含本仓没有的） |
| 真源地位 | **运行时唯一真源** | **参考数据**；运行时真源是 `account-metrics/adapters.js` |
| 消费层 | `publish-capabilities.js`（已存在） | `platform-metric-matrix.js`（新增） |
| 校验器 | `validateRegistry()`（已存在） | `validateMatrix()`（新增，**同构**） |

**关系声明（写入新文件头）**：二者**同构但不同向**（发布能力 vs 数据指标能力），
命名与校验器风格**刻意对齐**（`validate*()` 返回问题清单、`load*()` 带缓存、`get*()` 返回冻结副本），
便于心智迁移，**但不得合并** —— 合并会让注册表承担两种正交语义。

### 4.5 集成点

| 文件 | 动作 | 说明 |
|---|---|---|
| `config/platform-metric-matrix.json` | **新增** | 产物 |
| `scripts/import-platform-metric-matrix.js` | **新增** | 解析 ini（**UTF-8**，§2.2）→ JSON |
| `packages/shared-utils/src/platform-metric-matrix.js` | **新增** | 读取层 |
| `packages/shared-utils/src/index.js` | **改** | 2 行 |
| `apps/desktop/electron/services/account-metrics/index.js` | **改（极小）** | 编排层把 `getMetricSupport()` 结果并入账号快照的 `capability` 字段，供 UI 显示「该平台无此指标」而非 `-` |
| `account-metrics/adapters.test.js` | **改（追加）** | 每适配器加一条 `reconcileObservation` 交叉校验 |

**关键实现纪律**：适配器**不得**改成「先查矩阵再决定要不要请求」。矩阵是**参考**，
用它做**请求门控**会让「厂商矩阵不全」变成「本仓拿不到数」——方向错误的依赖。
**只用于 ①UI 文案 ②测试交叉校验。**

### 4.6 测试策略

- `shared-utils/src/__tests__/platform-metric-matrix.test.js`：`getMetricSupport` **4 种返回值各一例**
  （含 `unknown-platform` 与 `unknown-metric` 的区分）；未收录平台返回 `[]` 不是 `null`；
  `validateMatrix()` 空数组；`groups` 二维结构正确（同一 `metricKey` 在两 group 下 label 不同）。
- `account-metrics/adapters.test.js`（追加）：每平台一条 `reconcileObservation`：声明有的指标实测
  `null` 时**必须**被 `declared-but-null` 命中（防「适配器悄悄漏解析」）。
- `account-metrics/index.test.js`（追加）：`capability` 字段进入账号快照；缺指标显示「平台不支持」而非 `-`。
- **反证要求**：至少一条测试证明「把 `getMetricSupport` 改成恒返回 `declared-available` 会让测试变红」。

### 4.7 验收判据

1. `validateMatrix().length === 0`。
2. `getMetricSupport('wechat_mp','readTotal') === 'declared-unavailable'`
   （微信 `1=1,2,4,6,7,10,11` 不含 `3`=图文总阅读数，**本次实测值**）。
3. `getMetricSupport('baijiahao','income') === 'declared-available'`（百家号含全部 11 项）。
4. `getMetricSupport('not-a-platform','income') === 'unknown-platform'`（**不是** `'declared-unavailable'`）。
5. 变体反证：把 `unknown-platform` 分支改成返回 `'declared-unavailable'`，测试必红。

### 4.8 风险与回滚

- 「矩阵被误当真源用于请求门控」→ 文件头 + 接口文档双处声明；测试锁 `reconcileObservation` 语义。
  回滚：删 require 与 export。
- 「`metricKeyMap` 映射错」→ 每条映射带 `note`；`declared-but-null` 交叉校验会暴露错配。
  回滚：修 JSON，无需改码。

**整体回滚：1 require + 1 export + 1 JSON。零数据迁移。**

---

## 5. R-3 素材组合三级降级算法

### 5.1 核实：确为缺失

```
> git grep -l -iE "combination|combinat|permutation|组合" -- "packages/*/src"
（零命中）
```
**结论 N-3**：本仓**没有任何素材组合（多排列）算法**。**同时已核实有真实消费者**：
`packages/story2video-engine/` 与 `packages/remotion-composer/` 都需要
「N 段素材 → M 条不同排列」（`PRD-STORY2VIDEO-*`、`01-docs/PRD-video-creation.md`），
但**当前无一份代码做排列** ⇒ 缺口真实。

### 5.2 目标模块与放置理由

**`packages/shared-utils/src/media-combination.js`**（CJS）。不用 `remotion-composer` 的理由：
后者是 **TS + JSX**（`module: ESNext`，`outDir: ./dist`）且依赖 react/remotion/@remotion/*；
本文件**零依赖**（只需 `Math.random` + 数组）；**主进程也需要它**（先算好 N 条排列再派发渲染任务），
放渲染包会让主进程无法使用或被迫接受 TS 构建依赖。报告 §6.1 亦建议「可原样搬入 `packages/shared-utils`」。

### 5.3 接口签名与边界用例

文件头注释（**必须原样写入实现**）：
```
 * media-combination — 素材组合三级降级算法
 * 来源：参考产品「一键成片」的组合算法（纯函数、零依赖、质量分层）。
 * 三级降级顺序**不可调整**：先给保持素材原序的组合（观感最自然），不够才用打乱版。
 * 三条不可破：
 *   ① 三级顺序固定：noRepetition → lowRepetition → ordinary
 *   ② 「够 max 即停」—— 不许算完再截断（全排列在 N=20 时是 20! 级）
 *   ③ 输出必须按 join(separator) **去重**；去重后不足 max 时**如实返回不足**，
 *      不得重复填充凑数（重复排列 = 重复成片，比少几条更糟）
```

| 导出 | 签名 | 语义 |
|---|---|---|
| `combineMedia` | `(items: T[], options?) => CombinationResult` | 三级降级主编排 |
| `noRepetitionCombinations` | `(n) => number[][]` | 一级：循环移位（**保序**），N 素材产 N 条。每条都是原序列的一个起点偏移 |
| `lowRepetitionCombinations` | `(n) => number[][]` | 二级：低重复轮转（步长递增 + 跳重），约 `(N-3)×(N-2)` 条 |
| `ordinaryCombinations` | `(n, {cap?, rng?}) => number[][]` | 三级：全排列（N≤6）或确定性随机采样（N>6），上限 `ordinaryCap`，按 join 去重 |

`CombinationOptions = {max=1, separator='\u0001', rng=Math.random, ordinaryCap=1000}`；
`CombinationResult = {combinations: number[][], reachedLevel, totalPossible}`；
`reachedLevel: 'noRepetition'|'lowRepetition'|'ordinary'|'insufficient'`
（`insufficient` = 三级都试过仍不足 max，**必须**显式回报）。
`combinations` 每条是**原数组下标**的排列（**不复制素材对象**）。
`max` 非法（`<=0` 或非整数）⇒ 回落 1 **并告警**。

**边界用例（逐条必进测试）**：

| 输入 | 期望 | 依据 |
|---|---|---|
| `combineMedia([], {max:3})` | `{combinations:[], reachedLevel:'insufficient', totalPossible:0}` | 空素材不得产出空排列（下游会当成 1 条空成片） |
| `combineMedia([a], {max:5})` | `{combinations:[[0]], 'noRepetition', totalPossible:1}` | 单素材只有 1 种排列 |
| `combineMedia([a,b], {max:1})` | 长度 1，`'noRepetition'` | 「够 max 即停」—— 不许继续算 |
| `combineMedia([a,b], {max:10})` | 长度 **2**，`'insufficient'` | 2 素材只有 2 种循环移位；`insufficient` 必须显式 |
| `combineMedia(6 个, {max:1000})` | 全部 720 种不重复 | N≤6 走全排列 |
| `combineMedia(20 个, {max:100})` | 恰好 100 条，无重复，耗时 **< 50 ms** | 三级路径必须避免 20! 爆炸 |
| `combineMedia(20 个, {max:Infinity})` | 不挂起；`<= ordinaryCap` | 非法 `max` 回落 |
| `combineMedia(3 个, {max:2, rng:()=>0.5})` | 确定性输出（两次调用相同） | 可测性 |
| 两个不同下标序列 join 后相同 | 只保留一条 | 分隔符碰撞防护 |
| 素材内容含分隔符 | **不适用** —— 本函数只处理**下标** | ★ 相对原实现的关键修正（§5.5） |

### 5.4 三级判定与降级顺序（精确）

```
combineMedia(items, {max})
  ├─ n = items.length
  ├─ if (n === 0) → {combinations:[], reachedLevel:'insufficient', totalPossible:0}   【立即返回】
  ├─ if (max <= 0 || !Number.isInteger(max)) → max = 1（并告警）                      【非法回落】
  ├─ 级1：out = noRepetitionCombinations(n)          # 恒 n 条，**保序**
  │        if (out.length >= max) → 截断，reachedLevel='noRepetition'      【够即停】
  ├─ 级2：out += lowRepetitionCombinations(n)        # 约 (n-3)(n-2) 条
  │        out = dedupe(out)                          # join(separator) 去重
  │        if (out.length >= max) → 截断，reachedLevel='lowRepetition'
  ├─ 级3：out += ordinaryCombinations(n, {cap:ordinaryCap, rng})
  │        out = dedupe(out)
  │        reachedLevel = out.length >= max ? 'ordinary' : 'insufficient'
  └─ return {combinations: out.slice(0, max), reachedLevel, totalPossible}
```
**三个「为什么」**：
1. **为什么级 1 是循环移位而非「前 N 条」**：用户传 5 段素材要 3 条成片时，「前 3 条」会让第 4、5 段
   **永远不出现**。循环移位保证**每段素材都出现在每一条里**，只改开头 —— 这才是「保序」的真正含义，
   也是报告 §6.1 说它「观感最自然」的原因。
2. **为什么「够即停」是硬约束**：N=20 的全排列是 20! ≈ 2.4×10¹⁸。原实现在这里用「上限 1000 + 去重」
   压成常数。**任何先算完再截断的实现都会挂起。**
3. **为什么去重后不足必须如实回报 `insufficient`**：重复排列 = 用户拿到两条一样的成片。
   **少几条比重复几条更可接受**；UI 据此提示「素材偏少，建议再加 2 段」。

### 5.5 相对原实现的两处刻意修正

| 修正 | 原实现 | 本设计 | 理由 |
|---|---|---|---|
| **只处理下标，不处理素材对象** | 对素材对象 `deepClone` 后排列 | 返回 `number[]` | ① 素材可能是大对象，clone 成本随规模线性上升；② 调用方按下标取原对象，**引用同一份素材**；③ 纯 `number[]` 可 JSON 序列化，能进任务队列持久化 |
| **分隔符用 `\u0001` 而非 `''`** | `join("")` | `join('\u0001')` | 原实现下**下标序列 `[1,23]` 与 `[12,3]` 连接后都是 `"123"`** ⇒ 去重会把两条**不同**排列误判为重复（`n > 9` 时必然发生）。用不可见控制字符可根除 |

> 第 2 条是**原实现的真实缺陷**，非风格偏好。回归锁必须含「`n = 12` 时不发生错误去重」用例。

### 5.6 集成点

| 文件 | 动作 |
|---|---|
| `packages/shared-utils/src/media-combination.js` | **新增**（纯函数，零依赖） |
| `packages/shared-utils/src/index.js` | **改** 2 行 |
| `packages/shared-utils/src/__tests__/media-combination.test.js` | **新增** |
| 消费者（`story2video-engine` / `remotion-composer`） | **本次不改** |

**为什么本次不接线**：接线需要决定「组合结果如何进入 `ScenePlan`」（即 §6 的时间轴模型），
两个任务耦合。分开做可各自独立验收，且纯函数无接线也能被测试完全覆盖。
【待确认 U-7】竞品「一键成片」的素材组合与我们的目标口径是否一致（视频段 vs 图片）。

### 5.7 测试策略

- **边界**：§5.3 边界用例表**逐条**。
- **性质**：① 输出无重复（100 组随机参数断言 `new Set(joined).size === combinations.length`）；
  ② 每条形如 `[0..n-1]` 的**排列**；③ 级 1 的 `n` 条中**每段素材都出现**（对每个 `i`，存在某条以 `i` 开头）。
- **反证**：`separator: ''` 在 `n=12` 下 **必须**产生重复（证明修正 2 不是空谈）；
  再把实现改回 `join('')` ⇒ 主测试必红。
- **性能**：`n=20, max=100` 断言耗时 < 50 ms（防全排列退化）。
- **确定性**：注入 `rng` 后两次调用结果完全相同。

### 5.8 验收判据

1. `combineMedia(new Array(20).fill(0), {max:100}).combinations.length === 100`，耗时 < 50 ms。
2. `combineMedia([1,2], {max:10}).reachedLevel === 'insufficient'`。
3. `combineMedia([], {max:1}).combinations.length === 0`。
4. 性质测试 ② 对 100 组随机 `(n, max)` 全通过。
5. 反证：`separator: ''` 在 `n=12` 下产生重复（显式断言，锁住「为什么不能改回空串」）。

### 5.9 风险与回滚

- 「被『优化』成先算完再截断」→ 性能测试 + `n=20` 用例。回滚：删导出（纯新增，零耦合）。
- 「`separator` 被改回 `''`」→ 反证测试。回滚同上。
- 「下游按下标取对象时数组被突变」→ 返回 `number[]` 副本；每条组合是**新数组**（非共享引用）。回滚同上。

**回滚成本：零**（纯新增，无消费者）。

---

## 6. R-4 时间轴绝对时间拍平模型

### 6.1 核实：本仓**已有**两套同构实现

**A —— `scene-builder.ts` 已有绝对时间拍平（秒制 + 重叠已拍平）**：
```ts
// packages/remotion-composer/src/scene-builder.ts:52-61
const cuts: Cut[] = lines.map((line, i) => ({
  id: `scene-${i}`, type: 'text_card', text: line.trim(),
  in_seconds: i * (sps - overlap), out_seconds: (i + 1) * sps - i * overlap,
}));
// :43 const FPS = 30;  :42 const DEFAULT_TRANSITION_OVERLAP = 0.5;
// :59-60 durationInFrames: Math.ceil((cuts[last].out_seconds + 1) * FPS)
```
**B —— `segment.ts` 已有秒制字幕时间轴**：
```ts
// packages/story2video-engine/src/segment.ts:425-431
export interface SubtitleTimelineItem {
  text: string; startTime: number; endTime: number;
  /** 每个字符的结束时间（秒，相对 startTime） */ charTimings: number[];
}
// :439 export function buildSubtitleTimeline(text, totalDuration): SubtitleTimelineItem[]
```
**结论**：本仓**已有**「绝对时间拍平 + 秒制 + 可查找」模型，但**分布在两个包、两套字段名**
（`in_seconds/out_seconds` vs `startTime/endTime`）。
**R-4 的真实工作是「收敛到一份带索引的中间表示」，不是「新增时间轴」。**

> ⚠️ **与任务书的偏差说明**：任务书提示「注意原实现出参全体 ×1000」。复核报告 §6.2 后确认，
> ×1000 指**竞品出参转毫秒**（`methods.js:3594-3596,3632,3650-3651,3661-3662`），
> **不是本仓 `scene-builder`**（本仓已是秒制）。因此本项**不需要单位转换**，
> 而是**把「秒是内部单位、毫秒只出现在边界」显式化并加锁**。

### 6.2 数据结构与接口签名

**新增**：`packages/shared-utils/src/timeline-flatten.js`（CJS）。文件头（**必须原样写入实现**）：
```
 * timeline-flatten — 时间轴「绝对时间拍平」中间表示
 * 定位：把「多轨（画/字/音）+ 转场重叠」编排成**单一扁平秒制时间表**。
 * 本仓已有两处同构实现（remotion-composer/scene-builder.ts 的 cuts[]、
 * story2video-engine/segment.ts 的 SubtitleTimelineItem），字段名与能力不同。
 * 本层提供统一中间表示，两处逐步收敛到它（收敛不在本次范围）。
 * ⛔ 单位约定（唯一，不可协商）：
 *   - **内部一切时间字段是秒（number，浮点）**
 *   - 毫秒只出现在**边界**：平台/编码器/竞品接口的入参出参
 *   - 边界转换只经 toMilliseconds() / fromMilliseconds()，**禁止**其他任何地方写 *1000 或 /1000
 *   理由：竞品把「秒为主、出参 ×1000」散落在 6 处调用点（报告 §6.2），
 *   任何新增出参都可能漏乘；收敛到两个函数后，「漏乘」变成可测问题。
```
`TimelineEntry = {id, kind:'visual'|'text'|'audio', startSeconds, endSeconds, durationSeconds,
stopSeconds, order, payload?}`；`Timeline = {entries, totalSeconds, fps, durationInFrames, warnings}`。

| 导出 | 签名 | 语义 / 关键约束 |
|---|---|---|
| `flattenTimeline` | `(items, options?) => Timeline` | `items=[{id,kind?,durationSeconds,payload?}]`；`options={transitionOverlapSeconds=0.5, fps=30, clampOverlap=true}`。**@throws** `TypeError`：`items` 非数组 / 某条 `durationSeconds` 非有限正数（**不跳过、不补默认**） |
| `entryAt` | `(timeline, seconds) => TimelineEntry\|null` | 实现为**二分查找 `stopSeconds`**（entries 按 stop 单调不减）。早于首条起点或晚于末尾返回 `null` |
| `locate` | `(timeline, seconds) => {entry, localSeconds}\|null` | 「跳到 t」的局部时间换算（与竞品 `methods.js:3203-3246` 同语义） |
| `toMilliseconds` | `(seconds) => number` | **唯一**的 ×1000 发生地 |
| `fromMilliseconds` | `(ms) => number` | **唯一**的 ÷1000 发生地 |
| `validateTimeline` | `(timeline) => string[]` | 结构自检：单调性、区间合法、`durationSeconds` 与 `end-start` 一致 |

**为什么存冗余 `durationSeconds` 与 `stopSeconds`**：① `stopSeconds` 是二分索引，不预计算就得每次遍历
（竞品用线性查找，O(n) 每 tick）；② `durationSeconds` 冗余让消费方**不必做减法**（减法在多处出现会有
浮点误差累积）；③ `validateTimeline()` 断言三字段互相一致 —— **冗余 + 自检**比「单一字段 + 到处算」更安全。
**`stopSeconds` 是累计最大值而非简单累加** —— 转场重叠会让 `endSeconds` 非严格单调，
用累计最大值才能保证 `stopSeconds` 单调不减（二分查找的前提）。

### 6.3 与 `scene-builder.ts` 的关系

**关系：`scene-builder.ts` 保持不动，`flattenTimeline` 是其泛化。** 逐项差异：输入从
「纯文本行 / 图片数组」泛化为「任意带 `kind` 的条目」；时长从「统一 `secondsPerScene`」改为
「**每条自带** `durationSeconds`」；输出从 `ScenePlan.cuts[]`（`in_seconds`/`out_seconds`）改为
`Timeline.entries[]`（`start`/`end`/`stop`）；新增 `entryAt()` 二分查找与 `locate()`；
帧数从 `ceil((lastOut + 1) * FPS)` 改为 `ceil(total * fps)`。重叠两者同为全局、同默认 0.5。

**收敛路径（不在本次范围）**：`buildTextPlan` 可改写为「生成 `items` → 调 `flattenTimeline` →
映射成 `Cut[]`」。**本次不做**，因为会动 `scene-builder.test.ts`（11,708 字节既有测试）。本次只**新增**。

**一处刻意差异必须写明**：`scene-builder` 的 `durationInFrames` 是 `ceil((lastOut + 1) * FPS)`
—— **末尾多加 1 秒**（给收尾留余量）。`flattenTimeline` **不加**这 1 秒（只描述素材占用的时间）。
收敛时由调用方决定是否 +1。**这是既有行为，不得在无证据下改。**

### 6.4 集成点

`packages/shared-utils/src/timeline-flatten.js` **新增**（纯函数，零依赖）；
`packages/shared-utils/src/index.js` **改** 2 行；
`packages/shared-utils/src/__tests__/timeline-flatten.test.js` **新增**；
`packages/remotion-composer/src/scene-builder.ts` 与 `packages/story2video-engine/src/segment.ts` **本次不改**。

### 6.5 测试策略

- **基础**：3 条 `durationSeconds=[5,5,5]`、`overlap=0.5` ⇒ `startSeconds=[0,4.5,9]`、`totalSeconds=14`
  （**与 `scene-builder` 公式逐值对齐**，同参数比对两处）。
- **单位**：`toMilliseconds(1.5)===1500`；`fromMilliseconds(1500)===1.5`；往返 1000 组随机值**精确相等**
  （用 `toBe` 而非 `toBeCloseTo` —— 不等说明实现用了复合运算）。
- **查找**：1000 条上二分查 1000 点，与线性扫描**逐点相同**；边界点（恰等于某条 `endSeconds`）
  **归后一条**（`[start,end)` 半开区间）。
- **重叠超限**：`durationSeconds=[0.3,5]`、`overlap=0.5` ⇒ 不抛错，`warnings` 含一条，
  第二条起点 = 0.15（收敛到前一条一半）。
- **非法输入**：`flattenTimeline([{id:'a',durationSeconds:0}])` ⇒ **抛 `TypeError`**（不跳过、不补默认）。
- **自检**：`validateTimeline(flattenTimeline(...))` 返回 `[]`；手工构造 `stopSeconds` 不单调的 ⇒ 非空。
- **跨语言契约**：用 `scene-builder.test.ts` 已有参数组合，断言 `flattenTimeline` 的 `(start,end)` 与
  `Cut.in_seconds/out_seconds` **逐值相等**（除末尾 +1 秒差异）。
  ★ 这是**跨语言契约锁**（CJS ↔ TS），把「两套实现不会漂移」变成机械判据，也为后续收敛提供安全网。

### 6.6 验收判据

1. `flattenTimeline([{id:'a',durationSeconds:5},{id:'b',durationSeconds:5}], {transitionOverlapSeconds:0.5})`
   ⇒ `entries[1].startSeconds === 4.5`、`totalSeconds === 9.5`。
2. `validateTimeline(flattenTimeline(合法 items))` 长度 `0`。
3. `fromMilliseconds(toMilliseconds(x)) === x` 对 1000 组随机 `x`（3 位小数）成立。
4. `entryAt(t, 某条 endSeconds)` 返回**后一条**（半开区间语义）。
5. `flattenTimeline([{id:'a',durationSeconds:0}])` **抛错**。
6. 契约锁：与 `scene-builder.test.ts` 同参数逐值对齐。

### 6.7 风险与回滚

- 「第三套时间轴加剧分裂」→ 文件头声明关系；契约锁钉住与 `scene-builder` 一致；收敛路径写入后续计划。
  回滚：删导出（无消费者）。
- 「浮点误差累积」→ 冗余 `durationSeconds`；`validateTimeline` 自检；单位往返精确断言。回滚同上。
- 「『末尾 +1 秒』差异被误当 bug 修掉」→ §6.3 显式写明；契约锁显式排除该 1 秒。回滚同上。

**回滚成本：零**（纯新增）。

---

## 7. R-5 测量驱动贪心装箱分页引擎

### 7.1 核实：确为缺失，且替代路线本仓已有

```
> git grep -l -iE "imageCarousel|image_carousel|cardImage|图文卡片|carousel" \
    -- "packages/*/src" "apps/desktop/electron" "apps/desktop/src/features"
apps/desktop/electron/services/story2video-stages.js      ← 唯一命中（**视频分镜**，非固定尺寸卡片）
> git grep -n "html2canvas|dom-to-image|modern-screenshot" -- "*/package.json"
（零命中 —— 本仓**没有**任何 DOM 截图库依赖）
```
**结论 N-2**：本仓**没有**「长文 → N 张固定尺寸卡片」能力。本项**纯新增**。

**已核实的替代路线（本仓既有，直接复用）**：
```js
// apps/desktop/electron/services/cover-cropper.js:5-6（文件头）
 *  - offscreen BrowserWindow 加载原图 → canvas 按 rect 裁剪 → JPEG 编码
 *  - 输出体积 > maxBytes（快手限制 512KB）时二分降质量重编码
// 截图先例：apps/desktop/electron/services/rpa-view-platforms.js:602,926
//   const image = await win.webContents.capturePage()
// 安全传值原语：apps/desktop/electron/core/js-eval-payload.js
//   buildEvalScript(paramNames, values, body)  ← 转义 ' < > & U+2028 U+2029
```
**这决定本项实现形态**：分页引擎在**主进程编排下、offscreen 窗口内**执行，而不是在渲染进程的
Vue 组件里。**这是对报告建议的一处修正** —— 报告说「只能在渲染进程用」，那是因为**竞品是 iframe 架构**；
本仓有 offscreen BrowserWindow，主进程同样能跑 DOM。

### 7.2 接口签名

**（1）纯逻辑层**：`packages/shared-utils/src/card-paginator-core.js`（CJS，**无 DOM**）。
拆分理由（写入文件头）：分页引擎分两半 —— 「测量」（必须 DOM）与「决策」（纯计算）。
决策层可单测、可跨进程复用、可脱离 Electron 跑；混在一起会让 90% 的 bug（边界、退化切分、
残余阈值）无法单测。来源：参考产品 `view-xhs-template` 的分页器（报告 §9.1），
但**修掉其 4 个已知缺陷**（§7.5）。

| 导出 | 签名 | 语义 |
|---|---|---|
| `paginate` | `async (items, options) => PaginateResult` | 测量驱动贪心装箱分页。**@throws** `TypeError`：`availableHeightPx` 非有限正数 / `measure` 非函数 |
| `snapToPunctuation` | `(text, targetIndex) => number` | 标点吸附（**修正版**，§7.5 缺陷③）。从 `targetIndex` 向前回退，5 级优先级找语义边界；返回吸附后的切点（可能等于 `targetIndex`） |
| `SENTENCE_ENDERS` | `['。','！','？','.','!','?']` | **导出**以便测试逐级断言，且禁止实现内联第二份 |
| `CLAUSE_ENDERS` | `['；',';','，',',']` | ★ 修正：原实现此表是**空数组** |
| `CJK_ENDERS` | `['，','。','！','？','；']` | 同上 |
| 常量 | `DEFAULT_MIN_REMAINDER_PX=20` / `DEFAULT_FILL_RATIO=0.9` / `DEFAULT_MIN_TAIL_CHARS=5` / `DEFAULT_MIN_SPLIT_CHARS=10` | 见 §7.3 |

`PaginateItem = {id, type, value, noMarginTop?, iconHeight?}`；
`PaginateOptions = {availableHeightPx, measure:(text,item)=>Promise<number>, …常量覆盖, maxPages=100}`；
`PaginateResult = {pages, pageCount, measuredHeights:Map<string,number>, warnings:string[]}`；
`warnings` 取值 `'page-limit-reached'|'degenerate-split-skipped'|'item-exceeds-page'`。

**（2）测量层（主进程）**：`apps/desktop/electron/services/card-capture.js`

| 导出 | 签名 | 语义 |
|---|---|---|
| `renderCardsToPng` | `async (params) => {pages:Buffer[], pageCount, warnings}` | **@throws** 窗口创建失败 / 脚本注入失败 / 任一步截图失败（**不吞错、不返回空数组**） |
| `buildMeasurementScript` | `(params) => string` | 仅供测试：纯函数（不建窗口） |
| `buildPageScript` | `(pageIndex, params) => string` | 同上 |

`params = {html, contentCss, blocks, widthPx, heightPx, scale=1, timeoutMs=30000}`。

### 7.3 算法步骤（精确到可复现）

```
paginate(items, {availableHeightPx, measure, …})
  ├─ 0. 参数校验（**fail-closed**）：availableHeightPx 有限正数；measure 是函数；非法抛 TypeError
  ├─ 1. 逐条测量原始高度（**串行**，DOM 测量不能并发）
  │     for item: h = await measure(item.value, item)   // 内含 icon 高度（修正 ①）
  │     measuredHeights.set(item.id, h)
  ├─ 2. 主循环（**单份实现**，合并原实现两套重复循环 —— 修正 ④）
  │     queue = items.map(clone); currentPage = []; currentHeight = 0
  │     while (queue.length):
  │        if (pages.length >= maxPages): warnings.push('page-limit-reached'); break
  │        item = queue[0]; h = heightOf(item)
  │        # 情况 0（**原主循环缺这条**）：单条比整页还高 ⇒ 独占一页，避免死循环
  │        if (currentPage.length === 0 && h > availableHeightPx):
  │            currentPage.push(item); queue.shift()
  │            warnings.push('item-exceeds-page'); flush(); continue
  │        # 情况 1：放得下
  │        if (currentHeight + h <= availableHeightPx):
  │            currentPage.push({...item, isSplit:false}); currentHeight += h; queue.shift()
  │        # 情况 2：放不下且剩得够多 ⇒ 二分切分
  │        else if (availableHeightPx - currentHeight > minRemainderPx):
  │            split = await splitAndMeasure(item, availableHeightPx - currentHeight)
  │            if (!split): warnings.push('degenerate-split-skipped'); flush(); continue
  │            currentPage.push(split.part1); queue[0] = split.part2
  │            flush()                                    # ★ 拆完必须收页
  │        # 情况 3：剩得太少 ⇒ 收页
  │        else: flush(); continue
  │        # 提前收页：填到 fillRatio 就收（产品取向，宁可少放）
  │        if (currentHeight >= availableHeightPx * fillRatio): flush()
  │     flush() = 若 currentPage 非空 ⇒ pages.push(currentPage)；重置 height
  ├─ 3. splitAndMeasure(item, budgetPx)
  │     low = minSplitChars; high = item.value.length - minTailChars
  │     if (high <= low) → return null                    # 拒绝退化切分
  │     while (low <= high):
  │        mid = floor((low+high)/2)
  │        h = await measure(item.value.slice(0, mid).trim(), item)      # ★ 真测量
  │        if (h <= budgetPx): best = mid; low = mid + 1
  │        else: high = mid - 1
  │     if (best <= 0) → return null
  │     cut = snapToPunctuation(item.value, best)          # 标点吸附
  │     ★ 拆完**必须重测两段**（substring+trim 改变行数分布；
  │       paddingBottom/marginBottom 会被重复计算一次）
  │     h1 = await measure(part1Text, item)
  │     h2 = await measure(part2Text, {...item, noMarginTop: true})
  │     return { part1:{...item, id:`${id}_p1`, value:part1Text, isSplit:true,
  │                      partIndex:1, totalParts:2, noMarginTop:item.noMarginTop},
  │              part2:{...item, id:`${id}_p2`, value:part2Text, isSplit:true,
  │                      partIndex:2, totalParts:2, noMarginTop:true} }
  └─ 4. return { pages, pageCount, measuredHeights, warnings }
```
**复杂度**：`测量次数 ≈ N + 切分次数 × (log₂(len) + 2)`。2000 字 / 20 段：`20 + 5 × 13 ≈ 85` 次测量；
每次 = 1 次 DOM 插入 + 等 1 帧（≈16 ms）+ 1 次强制布局 ⇒ **约 1.4 s**（与报告 §9.1 的 ≈1.3 s 估算一致）。

### 7.4 性能预期

| 场景 | 测量次数 | 预期耗时 | 判据 |
|---|---:|---:|---|
| 800 字 / 8 段 / 切 2 次 | ~34 | **< 700 ms** | 单测超时上限 5 s |
| 2000 字 / 20 段 / 切 5 次 | ~85 | **< 1.6 s** | 单测超时上限 8 s |
| 20000 字 / 60 段 / 切 20 次 | ~330 | **< 6 s** | 集成上限 20 s |
| 页数上限触发（20000 字 / `maxPages=8`） | 提前 break | **< 700 ms** | 必须提前退出，不许算完再截断 |

**三条性能纪律**：① **测量串行**（并发化会共享同一屏外容器，产生交叉污染）；
② **每次测量后立刻移除元素**（不累积 —— 竞品做对了，保留）；
③ **`maxPages` 在循环内判定**，不在结果层截断（否则 20000 字仍要跑满 330 次测量）。

### 7.5 相对原实现必须修掉的 4 个缺陷

报告 §10-3 记录了原实现「测量高度 ≠ 渲染高度」的 3 个独立成因。本设计**逐条修正**，
并**新增第 4 条**（合并两套循环）。

| # | 原缺陷 | 原实现位置 | 本设计修正 | 回归锁 |
|---|---|---|---|---|
| ① | **测量不渲染 icon，渲染会插入 icon** ⇒ 渲染高度 > 测量高度 ⇒ 向下溢出 | 测量侧无 icon；渲染侧 `if (iconData.src)` 插 `iconContainer`（`width/height/marginRight` 来自 `iconSize`） | `PaginateItem` 增 `iconHeight`；注入的 `measure` **必须**在同宽容器同时渲染 icon；契约里显式写明 | 一条测试：带 `iconHeight:64` 的条目，测量值 ≥ 无 icon 时 + 60 |
| ② | **`noMarginTop` 只在测量侧生效** ⇒ 续接段渲染多一个段前距（`spacing` 16~50px） | 测量侧有分支，渲染侧无 | `noMarginTop` 进 `PaginateItem`，**并要求渲染层同样消费** —— 由 `buildPageScript` 保证（读同一字段） | 一条测试：`part2.noMarginTop === true` 且 `buildPageScript` 产物含对应 `margin-top:0` |
| ③ | **`clauseEndings` 是空数组** ⇒ 分句级吸附恒不命中 | `const clauseEndings = []  // [";","；",",","，"]`（被注释掉） | `CLAUSE_ENDERS = ['；',';','，',',']` **导出且非空**；窗口 30 字符 | 一条测试：文本含 `，` 时 30 字符窗口内命中逗号（表为空则必退到第 5 级） |
| ④ | **两套几乎重复的装箱循环**（主循环 + 尾巴函数，约 60 行重复且规则不同） | — | **合并为单份**；「单条超页」作为循环内**情况 0** 显式处理 | 一条测试：单条高度 > 整页时产出恰好 1 页且 `warnings` 含 `item-exceeds-page`（原实现只有尾巴函数能处理该输入） |

**另修两处工程问题（非正确性）**：① **模块级状态**（原实现的 `mainData`/`rulesData`/`itemHeights`
是模块级单例，`itemHeights` 只 `set` 从不 `clear` ⇒ 跨次调用持续累积、内存只涨不落）⇒
本设计**全部改函数内局部变量**（`measuredHeights` 随结果返回，由调用方决定是否保留）。
② **`catch` 只 `console.error` 后返回 `undefined`**（调用方随后在 `result.containers` 上抛错）⇒
本设计**抛错**（不返回 `undefined`）。

### 7.6 失败模式（逐条）

**字体未加载**（模板用未注册字体，测量回退字体、渲染用真字体）⇒ `measure` 前
`await document.fonts.ready`，超时（5 s）记 warning 后继续。**单条超页**（一条文本比整页高，
如超长无标点段落）⇒ 独占一页 + `warnings:['item-exceeds-page']`，**不抛错、不死循环**。
**退化切分**（尾部剩余 < `minTailChars`）⇒ 放弃切分、收页 + `degenerate-split-skipped`。
**二分无解**（前 `minSplitChars` 字符就超预算）⇒ 返回 `null` ⇒ 走情况 3 收页。
**页数超限** ⇒ 循环内 break + `page-limit-reached`，**已产出页照常返回**。
**窗口创建失败**（无图形环境 / 资源不足）⇒ **抛错**（不返回空数组冒充「没有页」）。
**截图失败**（GPU/编码问题）⇒ 该页抛错并中止，**已成功的页丢弃**（部分产物比没有更危险 ——
用户会以为发全了）。**超时**（总耗时 > `timeoutMs`）⇒ 销毁窗口 + 抛 `TimeoutError`。
**文本含 HTML** ⇒ 分页前经 `formatArticleBody('plain', text)` 归一（复用本仓既有单一实现，
**禁止**自写剥离）。

### 7.7 集成点

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/shared-utils/src/card-paginator-core.js` | **新增** | 纯逻辑，可单测 |
| `packages/shared-utils/src/index.js` | **改** | 2 行 |
| `packages/shared-utils/src/__tests__/card-paginator-core.test.js` | **新增** | 注入**假 measure**（按字符数线性估算），可完整覆盖算法 |
| `apps/desktop/electron/services/card-capture.js` | **新增** | 主进程 offscreen 渲染 |
| `apps/desktop/electron/services/card-capture.test.js` | **新增** | 测两个 `build*Script` 的**产物字符串** |
| `apps/desktop/electron/ipc-handlers/render.js` | **改** | 加 1 个 IPC 通道（**该通道自己的入参校验不可省** —— §10.3-X-1 说明了为何不引入统一中间件） |
| `apps/desktop/electron/preload/*.js` | **改** | 暴露通道（**改 preload 必须重打包 `index.bundle.js`**，AGENTS.md QM-2） |
| `apps/desktop/src/locales/zh.js` + `en.js` | **改（成对）** | 进度、失败原因 |

**调用链**：
```
渲染层（Vue）用户点「生成图文卡片」
  → window.electronAPI.render.cards({content, templateId, widthPx, heightPx})
  → ipc-handlers/render.js 校验入参 → card-capture.renderCardsToPng()
  → 建 offscreen BrowserWindow（show:false）→ 注入测量容器 + 页模板
      → 逐页 buildPageScript → capturePage() → Buffer
  → 返回 {pages:[Buffer], pageCount, warnings}
  → render.js 写临时 PNG → 返回路径数组
```
**⚠️ 注入策略（本项最大的工程风险）**：`card-paginator-core.js` 是 CJS，而 offscreen 页面
**不能 `require`**。两条路：**A（推荐）** 用 **esbuild** 把 `card-paginator-core.js` 打成 IIFE 字符串，
构建期产出 `apps/desktop/electron/services/generated/card-paginator.iife.js`，运行时用
`buildEvalScript` 注入 —— **算法只有一份实现**（构建期打包，不是复制源码）；
**B** 把算法**重写成页面脚本** —— 两份实现必然漂移，**否决 B**。

**A 的构建接线**：`apps/desktop/package.json` 的 `scripts` 加
`"build:paginator": "esbuild ../../packages/shared-utils/src/card-paginator-core.js --bundle --format=iife --global-name=CardPaginator --outfile=electron/services/generated/card-paginator.iife.js"`，
并在 `build` 前串上。产物落在 `electron/**/*`，**已核实 `files` 数组已覆盖该 glob，无需改 `files`**。
**已核实（V-20）**：`apps/desktop/package.json` 的 `dependencies.esbuild` 为空、
`devDependencies.esbuild = ^0.25.12`。**影响**：构建期可用，但**不能**在运行时 `require('esbuild')`
做按需打包 —— 因此注入策略 A 必须是**构建期产物**，不可改成运行时打包。

### 7.8 测试策略

- **纯逻辑单测** `card-paginator-core.test.js`：注入**确定性假 measure**（如 `h = ceil(len/20)*32`）：
  ① 三情况分支各一例；② 二分产出的 `part1` 恰好不超预算；③ 5 级标点吸附**逐级**各一例
  （含 `CLAUSE_ENDERS` 命中）；④ `noMarginTop` 只标 `part2`；⑤ 单条超页；⑥ `maxPages` 提前 break
  （**断言 measure 调用次数 < 阈值**，证明是提前退出非事后截断）；⑦ 退化切分拒绝；⑧ 非法参数抛错。
  **为何必须在这一层**：算法 90% 的 bug 在这层；假 measure 让它完全确定。
- **脚本产物单测** `card-capture.test.js`：`buildMeasurementScript` 产物含 `left:-10000px`、
  `width:<正文宽>px`、`visibility:hidden`，**不含** `display:none`；
  `buildPageScript(1,{noMarginTop:true})` 产物含 `margin-top:0`。
  这是缺陷 ①② 的修正点，纯字符串断言，无需真窗口。
- **集成（真实 DOM）** `card-capture.integration.test.js`：建真实 offscreen 窗口跑 `renderCardsToPng`：
  页数符合预期、每页 PNG 尺寸 == 期望、**无 `warnings`**（带 icon 模板必须无 `item-exceeds-page`）。
  **为何必须在这一层**：「测量高度 == 渲染高度」只能在真实排版里验证。
- **回归锁**（同上）：**带 icon 模板** + 刚好填满的文本 ⇒ 断言**不溢出**
  （渲染后正文容器 `scrollHeight <= clientHeight`）。这是缺陷 ① 的原始事故形态。
- **跨层契约**（`card-paginator-core.test.js`）：三张标点表**非空**且 `CLAUSE_ENDERS.length > 0`
  —— 直接锁死缺陷 ③。

### 7.9 验收判据

1. 纯逻辑层：注入假 measure，2000 字 / 20 段输入下 `pages.length` 与**手工推算值相同**。
2. `CLAUSE_ENDERS.length === 4` 且 `snapToPunctuation('aaa，bbb', 6)` 返回 `4`（逗号之后）。
3. `buildMeasurementScript({widthPx:1006})` 产物含 `-10000px` 与 `1006px`，不含 `display`。
4. 集成：2000 字输入 `pageCount >= 2` 且 `pages.every(b => b.length > 0)`。
5. 集成：带 icon 模板下正文容器 `scrollHeight <= clientHeight`。
6. 性能：2000 字 / 20 段 < 1.6 s（软界，超时上限 8 s）。
7. `maxPages = 3` 时 `measure` 调用次数 < 全量的 40%（证明提前退出）。
8. 反证：把 `CLAUSE_ENDERS` 改成 `[]` ⇒ 第 2 条测试必红。

### 7.10 风险与回滚

| 风险 | 概率 | 影响 | 缓解 | 回滚 |
|---|---|---|---|---|
| 测量口径与渲染口径不一致（重演原缺陷） | **中高** | 内容溢出卡片 | ① 同一个 `measure` 契约同时服务测量与渲染；② 集成测试直接断言 `scrollHeight <= clientHeight`；③ `noMarginTop`/`iconHeight` 进 `PaginateItem` 而非散在两侧 | 从模板清单移除该模板 |
| 注入策略 A 需构建接线 | 中 | 构建复杂度上升 | 产物进 `electron/**/*`（已被 `files` 覆盖，已核实）；构建失败即红灯 | 删新通道（功能整体下线） |
| 性能不达预期（大文档） | 中 | 用户等待 | `maxPages` 提前退出；页数上限产品侧明示；耗时可测（§7.4） | 降低默认 `maxPages` |
| preload 改动未重打包 | 中 | 功能静默不可用 | AGENTS.md QM-2 强制 + bundle 断言 | 重打包 |
| 字体加载超时致测量偏差 | 低 | 第一页高度偏小 | `document.fonts.ready` + 5 s 超时告警 | — |
| 无卡片模板几何数据 | 中 | 无 `contentCss` 可用 | 【待确认 U-6】`git grep -n "templateId\|cardTemplate"` | 先做内置单模板 |

**回滚成本**：删 2 个新文件 + 1 IPC 通道 + 1 preload 导出 + locales 2 条。**零数据迁移。**

---

## 8. R-6 多源搜索清单（中文源）

### 8.1 核实：抓取层已完备，本项是「加源」

```
> git ls-files | Select-String "content-intelligence"
…/content-intelligence-analysis.js  …/content-intelligence-sources.js(+test)
…/content-intelligence-utils.js(+test)  …/content-intelligence.js(+test)
```
```js
// apps/desktop/electron/services/content-intelligence.js
:114  const sources = opts.sources || ['reddit', 'hackernews', 'github']
:47   const TITLE_SOURCES = ['reddit', 'hackernews']        // GitHub 被排除出「同类标题」
:56   const MENTION_RELEVANCE_ON = ['title', 'snippet', 'author']
```
**结论**：本仓搜索层**架构完备**（源可枚举、`relevanceOn` 按消费者声明且进缓存键、
相关性门禁在共用出口）。R-6 的真实工作是**加源**，不是加机制。
**同时已核实存在两份相关 PRD**：`PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md`（25,660 B）与
`PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md`（89,144 B）。
**【待确认 U-3】**：本次未读其正文，「中文源需求是否已被覆盖」**未验证** —— 加源前**必须**先读。

### 8.2 关键判断：竞品清单是「跳转清单」而非「API 清单」

`deepsearchercat.txt`（3.5 KB / GBK / 73 行）形态为 `{主题分组:[{name, url /* 含 %s */}]}`：
```json
{ "综合": [ {"name":"百度搜索","url":"https://www.baidu.com/s?wd=%s"},
            {"name":"360搜索","url":"https://www.so.com/s?q=%s"},
            {"name":"搜狗搜索","url":"https://www.sogou.com/web?query=%s"},
            {"name":"必应搜索","url":"https://cn.bing.com/search?q=%s"},
            {"name":"中国搜索","url":"http://www.chinaso.com/search/pagesearch.htm?q=%s"} ],
  "知识": [ {"name":"百度知道","url":"https://zhidao.baidu.com/search?word=%s"}, … ] }
```

| | 本仓 `content-intelligence` 的源 | 竞品 `deepsearchercat.txt` |
|---|---|---|
| 形态 | **JSON API** | **HTML 搜索页 URL 模板** |
| 能否结构化返回 | 能 | **不能** |
| 需解析 HTML | 否 | **是** |
| 反爬 | 中（API rate limit） | **高** |
| `relevanceOn` 门禁可用性 | 高（`title`/`snippet`/`author` 齐） | **低**（HTML 需先抽字段，抽取质量即门禁质量） |

**因此本项建议「两段式」，第一段价值远高于第二段。**

#### 第一段（推荐做）：「外部搜索跳转」，不做抓取

**新增**：`apps/desktop/electron/services/search-jump-sources.js`。文件头（**必须原样写入实现**）：
```
 * search-jump-sources — 中文搜索源「跳转清单」（**不抓取**）
 * 与 content-intelligence 的关系：
 *   content-intelligence = **抓取型**源（JSON API，结果回到本应用）
 *   本文件               = **跳转型**源（打开第三方搜索页，结果留在对方站点）
 * 刻意分离：抓取 HTML 搜索页的反爬/合规成本与风险远高于跳转，
 * 且跳转不复制对方内容，规避版权与 ToS 争议。
```
| 导出 | 签名 | 语义 |
|---|---|---|
| `listJumpSources` | `() => JumpSource[]` | 全部跳转源（冻结）。`JumpSource = {id, name, group, urlTemplate, hosts}`；`urlTemplate` 含**恰好一个** `%s`；`hosts` 是允许跳转的 host 白名单 |
| `filterJumpSources` | `(keyword) => JumpSource[]` | 按 `name`/`group` 模糊匹配 |
| `buildSearchUrl` | `(sourceId, query) => string\|null` | **本文件唯一的拼 URL 处**。`null` 成因：未知 `sourceId` / 查询为空 / **组装后未通过 `safeHttpUrl`** |
| `validateJumpSources` | `() => string[]` | 自检：① 每个 `urlTemplate` 恰含一个 `%s`；② host 在 `hosts` 里；③ `id` 唯一 |

**三条硬纪律**：① **`%s` 必须 `encodeURIComponent`**，且**只替换一次**（用 `replace` 而非
`replaceAll`）—— 多个 `%s` 或不同源共用模板会导致注入；② **`buildSearchUrl` 返回值必须过
`safeHttpUrl()`**（`@multi-publish/shared-utils/src/safe-http-url`）—— **依据**：AGENTS.md 明确
「外部可控 URL 绑定可点击锚点前必须过共享协议判据」，本项 URL 由**模板 + 用户输入**拼成，属外部可控；
③ **跳转走本仓既有的受控内嵌视图**（`WebContentsView` / 浏览器标签），**不得**用 `shell.openExternal`
—— 后者把用户带离应用且失去 `allowed_origins` 约束。

**消费方**：`content-intelligence` **不新增方法**，而是新增一个**并列 IPC 通道**。理由：
`search()` 返回 `{results, sources, total}`，语义是「抓回来的结果」；跳转源**没有结果**，
混进同一返回会污染 `total`/`relevanceOn` 门禁语义。

#### 第二段（**本次不做**）：HTML 抓取中文源

**三条理由**（详见 §10.3-X-5）：① **反爬** —— 百度/360/搜狗/必应中文站对无头浏览器有
UA + 行为 + 频率特征识别，成本（代理池 + 指纹）远高于收益且需**持续维护**；
② **合规** —— 抓取搜索结果页并展示属**复制对方内容**，多数中文搜索引擎 ToS 明确禁止自动化查询；
③ **门禁不可靠** —— `content-intelligence` 的核心纪律是「标题级相关性门禁」（AGENTS.md 有长段落规定），
HTML 路径下 `title` 需靠选择器抽取，**抽取质量即门禁质量**，对方 DOM 一改就**静默降级** ——
门禁悄悄失效而**不报错**，这是「更坏的失败」形态。

**若将来要做**，前置三条（写入计划文档）：① 明确的反爬处置方案与预算；② ToS 合规结论；
③ 抽取层 fail-loud（抽不到标题 ⇒ 记 `parse-failed`，**不得**回落成「无结果」）。

### 8.3 集成点

`apps/desktop/electron/services/search-jump-sources.js`（+`.test.js`）**新增**；
既有内容域 IPC handler 文件**改**（加通道，入参校验不可省）；
`apps/desktop/electron/preload/*.js` **改**（重打包 bundle）；
`apps/desktop/src/locales/zh.js` + `en.js` **改（成对）**；选题调研页**改**（加「外部搜索」入口）。

### 8.4 测试策略

- `search-jump-sources.test.js`：① `validateJumpSources()` 空数组；
  ② **每个** `urlTemplate` 恰含一个 `%s`（遍历断言，防新增源漏占位符）；
  ③ `buildSearchUrl('baidu','中文 测试')` **精确等于**
  `https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E6%B5%8B%E8%AF%95`；④ 空查询 → `null`；
  ⑤ 未知 id → `null`；⑥ **注入尝试**：`'x&y=z#frag'` 产物中 `&`/`#` 必须已编码；
  ⑦ 全部产物通过 `safeHttpUrl`；⑧ `filterJumpSources('知识')` 返回该组全部源。
- handler 测试：通道入参非字符串时返回稳定错误合同（不 crash）。

### 8.5 验收判据

1. `validateJumpSources().length === 0`。
2. `buildSearchUrl('baidu','中文 测试') === 'https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E6%B5%8B%E8%AF%95'`。
3. `buildSearchUrl('baidu','x&y=z#frag')` 不含裸 `&` 与 `#`。
4. 全部源 `urlTemplate` 各含**恰好一个** `%s`。
5. 反证：去掉 `encodeURIComponent` ⇒ 第 2、3 条必红。
6. **`search-jump-sources.js` 不含任何 `axios` / `fetch` / `http.request`** ——
   抓取禁令的机械判据，用一条源码扫描测试锁定。

### 8.6 风险与回滚

- 「被误当成『已支持中文源抓取』」→ 命名用 `search-jump-sources`；UI 文案写「在浏览器中打开」；判据 6。
  回滚：删文件与通道。
- 「源 URL 模板随对方改版失效」→ 模板是**数据结构**非硬编码逻辑，改 JSON 即改；
  失效表现为对方站点 404，**不静默**。回滚：从清单删该源。
- 「用户输入拼接出站」→ `encodeURIComponent` + `safeHttpUrl` + host 白名单。回滚同上。

**回滚成本**：删 1 文件 + 1 通道 + 2 条文案。

---

## 9. R-7 平台覆盖扩展

### 9.1 优先级排序（本文**复核后调整**报告结论）

**调整的唯一判据是「能否走 API 发布」**（与本仓 `publishMode` 三态总闸对齐）——
报告只按类目与流量分组，未考虑工程可行性。

| 优先级 | 平台 | 原报告 | 本文调整理由 |
|---|---|---|---|
| **P0** | 微信视频号 | P0 | ✅ **已实现**（见 §9.2，报告列为「缺口」是误读） |
| **P1** | 企鹅号 / 大鱼号 / 网易号 / 搜狐号 | P0-P1 | 保留 P1：四家均有开放创作者 API 或已被竞品证明可 API 化，且竞品 `data.zip` **含其带 ID 分类表**（R-1 就绪） |
| **P2** | CSDN / 简书 | P1 | 降 P2：CSDN 审核门槛高；简书无公开发布 API，只能 RPA，与「API 优先」路线不符 |
| **P2** | 一点号 / 快传号 | P0-P1 | 降 P2：`mediadatamgr.ini` 显示其**指标能力极弱**（各 7 项且**无视频指标**，§4.2 实测） |
| **P3** | 爱奇艺号 / 美拍 / AcFun | P0-P1 | 降 P3：长视频/垂类，投入产出比低 |
| **不做** | 趣头条 / 惠头条 / 五条号 / 开递号 | P3 或不建议 | **沿用报告结论**。补充：与本仓内容质量门禁定位冲突 |
| **不做** | 搜狐视频 / 腾讯微视 / 凤凰号 / 新浪看点 / 东方号 / 大风号 / 百花号 / 搜狗号 / 秒拍 / 皮皮虾 / 豆包 / 雪球号 / 车家号 / 易车号 / 得物 / 拼多多视频 / 美柚 / WiFi万能钥匙 / 小红书商家号 等 | — | ① 竞品对这类平台的分类表多为 `name-only`（**无 ID ⇒ API 发布不可行**，R-1 的 `variant` 可直接判定）；② 与已有平台用户重合度高，边际收益低；③ 单平台接入 8–24 h，38 个 = 300–600 h，远超本周期 |

### 9.2 ⚠️ 已核实的一处报告误读：视频号**已接入**

`平台覆盖差距分析.md` §4.2 把「微信视频号」列为「仅参考产品有（17 个）」的缺口。**这是误读**：
```
> git grep -n "tencent_video" -- config/platforms.yaml
config/platforms.yaml:93   # ⚠️ 命名澄清（publish-frequency-policy-v2 P2-3）：本条的 id 是 `tencent_video`，
config/platforms.yaml:100    name: 视频号
config/platforms.yaml:105    publish_url: https://channels.weixin.qq.com/
config/platforms.yaml:115    publishMode: api-then-dom
> git ls-files | Select-String "shipinhao"
packages/api-publish-engine/src/adapters/shipinhao.js
packages/api-publish-engine/src/publish/platforms/shipinhao-video.js
packages/api-publish-engine/src/publish/platforms/shipinhao-music.js
packages/api-publish-engine/src/publish/capabilities/shipinhao-capabilities.js
```
**结论**：视频号**已接入**（`id: tencent_video`，`name: 视频号`，`publish_url` 指向
`channels.weixin.qq.com`，有完整 API 链 + 音乐链）。报告按**平台名**做集合差，而本仓该条 `id`
是 `tencent_video`（历史原因不可改名）⇒ 漏配。**该条缺口结论作废。**

> 这本身也是「按名字做集合运算」的教训：**字段名相同 ≠ 语义相同**（AGENTS.md 有同型纪律）。
> 评估任何平台缺口前，必须先读 `config/platforms.yaml` 的 `name` 字段，不能只看 `id`。

### 9.3 扩一个平台的标准步骤清单（11 步，全部路径已核实）

| # | 动作 | 文件（**已核实存在**） | 判据 |
|---|---|---|---|
| 1 | 加登录 URL | `packages/shared-utils/src/platform-definitions.js` 的 `PLATFORM_LOGIN_URLS` | `git grep -n "<slug>:" -- 该文件` 命中 3 处 |
| 2 | 加 Dashboard URL | 同上 `PLATFORM_DASHBOARD_URLS` | 同上 |
| 3 | 加登录成功模式 | 同上 `PLATFORM_LOGIN_SUCCESS_PATTERNS` | 同上。**同域平台必须用路径精确匹配** —— 该文件已有微信视频号/头条/百家号三处反例注释，不得重犯 |
| 4 | 加平台配置 | `config/platforms.yaml` | `js-yaml` 载入后该 slug 非空，含 `type`/`content_category`/`max_title`/`max_content`/`has_api`/`publishMode`/`enabled` |
| 5 | 加发布能力元数据 | `packages/shared-utils/src/publish-capabilities.json` | `getPlatformPublishMeta('<slug>') !== null`；`validateRegistry()` 空数组 |
| 6 | 登记正文承载形态 | `packages/api-publish-engine/src/content-formatter.js` 的 `HTML_BODY_PLATFORMS`/`PLAIN_BODY_PLATFORMS` | **未知平台保守按纯文本**已内置（`getArticleBodyKind` 默认 `'plain'`）；登记后符合预期 |
| 7 | 加截断上限 | 同文件的 `CONTENT_LIMITS`/`TITLE_LIMITS`/`TAG_STYLES` | 三表各有该键，**且与 `publish-capabilities.json` 一致**（由 `packages/api-publish-engine/test/content-formatter-registry-sync.test.js` 契约锁钉住，**已核实该文件存在**） |
| 8 | 加标签风格 | 同上 `TAG_STYLES` | 命中 `'#tag'`/`'#tag#'`/`'plain'` 之一 |
| 9 | 加发布链（API 轨）或显式声明无 API | `packages/api-publish-engine/src/publish/platforms/<slug>-*.js` 或 `has_api: false` | 若 `has_api: true` ⇒ 链文件存在且被 `platform-entries.js` 登记 |
| 10 | 加适配器（如适用） | `packages/api-publish-engine/src/adapters/<slug>.js` | 含 `formatArticleBody` 调用（承载形态单一实现，禁止自抄） |
| 11 | 补测试与文案 | ① `content-formatter.test.js` 加**精确**断言（`toContain` 无效）；② 该链的 chain 测试；③ `locales/zh.js` + `en.js` **成对** | 三处均有该 slug；`.github/scripts/check-locale-sync.js`（CI Gate 7，**已核实存在**）通过 |

**★ 顺序不变量（AGENTS.md 硬规定，扩平台时必守）**：话题转换（`convertInlineTopics` /
`stripTopicsFromContent`）**必须先于** `<p>` 包装。反序会让 `(^|\s)#话题` 因井号前是 `>`
而停在单井号形态。**新平台正文链必须复用 `formatArticleBody()`，不得自写转换。**

**单平台工作量估算**：有公开 API + 带 ID 分类表 **8–12 h**；有 API 但无现成分类表
（需人工收集，易过期）**12–16 h**；只能 RPA（DOM，需取证 + 选择器 + 窗口池适配）**16–24 h**。

### 9.4 测试策略

- `packages/api-publish-engine/test/content-formatter.test.js`：新平台**精确产物断言**
  （`toContain` 对「整篇压成一行」免疫，AGENTS.md 已点名）。
- `packages/api-publish-engine/test/content-formatter-registry-sync.test.js`：三张上限表与
  `publish-capabilities.json` 一致（**不许漂移**）。
- `packages/shared-utils/src/__tests__/publish-capabilities.test.js`：`validateRegistry()` 空数组；
  `classifyPublishFields()` 快照。
- `packages/shared-utils/src/__tests__/platform-definitions.test.js`：新平台登录 URL/成功模式存在且非空；
  `.browser.js` 孪生版**同步**（已有完整性锁）。
- 该链的 chain 测试（命名惯例 `<platform>-<content>-chain.test.js`，先例 `baijiahao-article-chain.test.js`）：
  端到端请求体形状。

### 9.5 验收判据

1. §9.3 的 11 条判据逐条通过。（可做一个 `scripts/verify-platform-onboarding.js <slug>` 一次跑完
   —— **本次不新增该脚本**，列为后续。）
2. `git grep -c "<slug>" -- config/platforms.yaml packages/shared-utils/src/publish-capabilities.json` ≥ 2。
3. `getArticleBodyKind('<slug>')` 与预期一致（未知平台必须是 `'plain'`）。
4. `.github/scripts/check-locale-sync.js` 退出码 0。
5. 新平台正文链**不含**自己写的 `<p>` 包装或 HTML 剥离（源码扫描测试锁定）。

### 9.6 风险与回滚

- 「分类表 `name-only` ⇒ API 不可行」→ R-1 的 `variant` 在接入前即可判定；`name-only` 平台**只能 RPA**。
  回滚：不接入。
- 「上限值抄错（三表漂移）」→ 契约锁 `content-formatter-registry-sync.test.js`（已存在）。回滚：改 JSON 一处。
- 「承载形态登记反了」→ 未知平台保守 `'plain'`；精确断言测试。回滚：改登记表。
- 「登录成功模式同域误判」→ `platform-definitions.js` 已有三处同型反例注释。回滚：改模式。

**回滚成本**：单平台回滚 = 在 `platforms.yaml` 把 `enabled: false`（**一键**）。

---

## 10. 已核实 / 待确认 / 不做 汇总

### 10.1 已核实（带检索证据）

| # | 主张 | 出处 | 结论 |
|---|---|---|---|
| V-1 | `rpa-view-manager.js` 已桥接 `CancelToken` | §1.1 | ✅ 已存在（基线一成立） |
| V-2 | `ipc-handlers/validate.js` 不存在 | §1.2 | ✅ 确为缺失（基线二成立） |
| V-3 | `tag-suggest-data/platform-taxonomy.json` 是**孤儿文件**，且无平台侧 ID | §3.1 A/B | ✅ 载体已在但无消费点、无 ID |
| V-4 | 平台标签规则硬编码在 `platform-rules.js` | §3.1 C | ✅ 已存在，本项**不替换** |
| V-5 | 仅 `youtube`/`bilibili` 有分类 ID 通路，来源是调用方填空 | §3.1 D | ✅ 已核实 |
| V-6 | `config/` 已被 `extraResources` 整体打包；`getConfigPath()` 可用 | §3.1 E | ✅ 含 `publisher-router.js:746` 使用先例 |
| V-7 | `account-metrics` 已实现「缺失显式为 null、不补 0」 | §4.1 | ✅ **R-2 的目标已在本仓实现** |
| V-8 | 本仓**无**任何素材组合算法 | §5.1（零命中） | ✅ 确为缺失 |
| V-9 | `scene-builder.ts` 已有绝对时间拍平（秒制 + overlap） | §6.1 A | ✅ 已存在 |
| V-10 | `segment.ts` 已有秒制字幕时间轴 | §6.1 B | ✅ 已存在 |
| V-11 | 本仓**无**「长文→固定尺寸卡片」能力 | §7.1 | ✅ 确为缺失（唯一命中是视频分镜） |
| V-12 | 本仓**无** html2canvas/dom-to-image；走 offscreen BrowserWindow + `capturePage` | §7.1 | ✅ 含 `cover-cropper.js` 先例 |
| V-13 | `content-intelligence` 已是三源聚合 + 相关性门禁 | §8.1 | ✅ 已存在，架构完备 |
| V-14 | 视频号**已接入**，报告称其为缺口是误读 | §9.2 | ✅ 已核实 |
| V-15 | `mediadatamgr.ini` 是**干净 UTF-8**；「GBK 一刀切」被证伪 | §2.2 | ✅ 逐字节核实（U+FFFD 计数 0） |
| V-16 | 分类映射**至少 6 种**形态（非报告的 5 种） | §2.1（8 样本直读） | ✅ 新增形态 F（微博 `ids`）与 G（B站 `children`） |
| V-17 | `task-data.js` / `publish-request.js` 字段白名单**已含** `category`/`categoryId` | §3.6(b) | ✅ 改动面比预期小 |
| V-18 | `publish-capabilities.js` 已导出 `getPlatformOverrideFields`/`validateRegistry` | §3.6(c) | ✅ UI 应复用它而非新增 `v-if` |
| V-19 | `content-formatter-registry-sync.test.js` 存在（契约锁已就绪） | §9.3 步骤 7 | ✅ 已核实 |
| V-20 | `esbuild` 在 `apps/desktop` 是 **devDependency**（`^0.25.12`） | §7.7 | ✅ 已核实 ⇒ 注入策略 A 必须**构建期**打包 |
| V-21 | `.github/scripts/check-locale-sync.js` 存在 | §9.3 步骤 11 | ✅ 已核实 |

### 10.2 待确认（须进一步取证）

| # | 事项 | 核实方法 | 影响 |
|---|---|---|---|
| U-1 | 平台分类 ID 在**当前平台侧**是否仍有效（数据是 2026-07-14 快照） | 真实账号 + 真机发布一条带分类的内容 | 只影响 R-1 的**数据新鲜度**，不影响架构 |
| ~~U-2~~ | ~~esbuild 依赖归属~~ | **本次已闭合**（V-20：devDependency） | — |
| U-3 | 两份 CN 源 PRD 是否已覆盖中文源需求 | 读 `PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md` 与 `PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md` 正文 | 影响 R-6 是否重复建设 |
| U-4 | `config/platform-taxonomy.json` **实际体量**（预估 ≤1.5 MB） | 跑一次转换器 | 影响打包体积与加载耗时 |
| U-5 | 第 7 种分类形态是否存在 | 转换器 fail-loud 后看 `unreadable[]` 是否非空 | 影响 R-1 节点对账数字 |
| U-6 | 本仓是否已有「卡片模板几何」数据（R-5 的 `contentCss` 来源） | `git grep -n "templateId\|cardTemplate"` | 影响 R-5 的模板供给 |
| U-7 | 竞品「一键成片」的素材组合与我们的目标口径是否一致（视频段 vs 图片） | 读 `01-docs/PRD-video-creation.md` 相关章节 | 影响 R-3 的消费者接线设计 |

### 10.3 筛查后建议**不做**的项（含理由）

| # | 项 | 理由 |
|---|---|---|
| **X-1** | **IPC 参数校验中间件**（`MP-REUSABLE-ACTUAL-PLAN.md` Task 2） | ① 真实缺口是 **52+ 个 handler 逐个接线**，中间件本身（约 20 行）不是瓶颈；② 逐改是**侵入性改造**，会触碰账号/发布/许可证等已稳定链路，回归风险高；③ 本仓已有 `ipc-handlers/helpers.js` 的 `withSenderCheck`，**按需在新通道里用**即可；④ 收益（防非法参数 crash）远低于成本（改 130+ 文件）。**结论：新通道必须自校验，存量不批量改。** |
| **X-2** | **`tag-suggest-data/platform-taxonomy.json` 改名或删除** | 其 7 个 `tagStyle` 与 `platform-rules.js` 的 `PLATFORM_STYLES` **内容重复但不完全一致**；删除会牵动 `PRD-SMART-TAG-SUGGEST-2026-08-31.md` 的 4 处引用。**本次不动**，在 R-1 读取层文件头声明区别；长期收敛单独立项 |
| **X-3** | **RPA 看板 URL 表 / 采集注入规则 / DOM 类名指纹** | ① 属竞品 **RPA 数据回收**路线，与本仓「API 优先」的 `publishMode` 三态总闸不同向；② **必然过期**（URL 随改版失效、类名带随机后缀且平台持续换）；③ 报告 §4.3 已明确「不建议照搬类名指纹」。**本仓应走语义特征** |
| **X-4** | **敏感词库**（`sensitivelibrary.txt`） | ① 加密不可直读（报告明确「不尝试破解」）；② 本仓已有 `shared-utils/src/sensitive-filter.js` 与 `tag-suggest-data/compliance-blocklist.json`；③ 合规词库应走正版来源 |
| **X-5** | **中文搜索源 HTML 抓取**（R-6 第二段） | 三条理由见 §8.2（反爬 / 合规 / 门禁不可靠）。**本次只做跳转** |
| **X-6** | **竞品的假进度条模式**（定时器 1→90） | 报告自己列为反面教材。本仓 `task-queue` 与发布链**已有真实状态**（`rpa-progress-throttle.js` / `ProgressEmitter`）。抄它等于倒退 |
| **X-7** | **38 个缺口中除 §9.1 表内 P1 之外的平台** | 见 §9.1；单平台 8–24 h，全量 300–600 h |
| **X-8** | **把 6 种分类形态的解析器写进运行时** | 形态解析是**离线工序**（转换器），运行时只读**归一后的** `config/platform-taxonomy.json`。把形态判断带进运行时会永久背上这段复杂度并每次启动重跑 |
| **X-9** | **`publish-capabilities.json` 与 `platform-metric-matrix.json` 合并** | 二者同构但**不同向**（发布 vs 回收），合并会让注册表承担两种正交语义。见 §4.4 |
| **X-10** | **远端 CDN 下发分类数据** | ① 增量收益（热更）已由「替换本地文件 + 重启」覆盖；② 引入联网依赖与失效面（CDN 不可达时的降级逻辑、签名/完整性校验）；③ 数据本身**已知会过期**，远端下发不解决「ID 是否仍然有效」这个真问题（U-1） |

---

## 11. 交叉引用与术语表

### 11.1 与配套计划文档的交叉引用

| 本文 | 计划文档 |
|---|---|
| §3 R-1 平台分类体系 | [PLAN-REUSE-ROLLOUT-2026-10-13.md](./PLAN-REUSE-ROLLOUT-2026-10-13.md) **P0-1 ~ P0-5** |
| §4 R-2 指标能力矩阵 | 同文 **P1-1 ~ P1-2** |
| §5 R-3 素材组合 | 同文 **P1-3** |
| §6 R-4 时间轴拍平 | 同文 **P1-4** |
| §7 R-5 卡片分页引擎 | 同文 **P2-1 ~ P2-6** |
| §8 R-6 多源搜索（跳转） | 同文 **P2-7** |
| §9 R-7 平台覆盖扩展 | 同文 **P3-1 ~ P3-2**（长线，本周期只做前置） |
| §10.3 不做清单 | 同文「明确不做的」章节 |

### 11.2 术语表（两份文档共用，**不得各写一份**）

| 术语 | 定义 | 出处 |
|---|---|---|
| **R-N** | 本文的可复用项编号（R-1 … R-7） | 本文 |
| **P-N** | 计划文档的任务编号（P0-1 … P3-2） | 计划文档 |
| **slug** | 平台字符串标识（`douyin`/`wechat_mp`），与 `config/platforms.yaml` 顶层键一致 | 本仓既有 |
| **variant** | 分类数据 ID 形态：`'id'`（有平台侧 ID，可 API 发布）/ `'name-only'`（无 ID，只能 RPA） | §3.2 |
| **name-only 平台** | `variant:'name-only'` 的平台，`resolveCategoryId()` 对其恒返回 `null` | §3.2/§3.3 |
| **拍平（flatten）** | 把多轨编排转成单一扁平绝对秒制时间表，每条自带 `start`/`end`/`stop` | §6.2 |
| **stopSeconds** | 累计**最大值**（非简单累加），保证单调不减，是二分查找的索引 | §6.2 |
| **填充比（fillRatio）** | 提前收页阈值（默认 0.9）：填到该比例即主动收页 | §7.2 |
| **残余阈值（minRemainderPx）** | 剩不到该高度（默认 20px）就收页，不尝试拆分 | §7.2 |
| **退化切分** | 切分后尾部剩余字符 < `minTailChars`（默认 5）⇒ 放弃切分 | §7.2 |
| **抓取型源 / 跳转型源** | 前者结果回到本应用（`content-intelligence`）；后者打开第三方页面（`search-jump-sources`） | §8.2 |
| **参考数据 vs 运行时真源** | 参考数据仅供 UI 与测试交叉校验，**不得**用于请求门控；运行时真源是实际解析实现 | §4.2 |
| **fail-closed / fail-loud** | 不确定时**拒绝**而非猜测；识别不到时**报错**而非静默返回 0 | 本仓既有 |
| **承载形态** | 平台正文字段是 HTML（`<p>`）还是纯文本 | `content-formatter.js` 既有 |
| **三态总闸** | `publishMode`：`api-only` / `api-then-dom` / `dom-only` | `config/platforms.yaml` 既有 |
| **孤儿文件** | 被 `git ls-files` 跟踪但**全仓零读取点**的文件 | §3.1 |

### 11.3 与既有文档的引用关系

| 文档 | 本项如何引用 |
|---|---|
| `PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md` | R-1 的 UI 接入**必须复用**其 `overrideFields` 注册表（§3.6c）；R-2 读取层**刻意对齐**其 `validateRegistry()` 风格（§4.4） |
| `PRD-API-PUBLISH-ENGINE.md` | R-1 引擎侧取用点（适配器读 `taskData.category`）；R-5 承载形态归一复用 `formatArticleBody()` |
| `PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12.md` | R-2 的运行时真源（`account-metrics`）出自该 PRD，本项**不替换**它 |
| `MP-REUSABLE-ACTUAL-PLAN.md` | §1 复核其两条缺口结论；§10.3-X-1 解释为何**不采纳**其 Task 2 |
| `平台覆盖差距分析.md` | R-7 的优先级依据；§9.2 纠正其对视频号的误读 |
| 数据集拆解报告（`rea/analysis` 内，文件名含参考产品字样故不在此复述） | §2.1/§2.2 纠正其形态与编码结论 |
| 模板编辑器拆解报告（`rea/analysis` 内，同上） | R-5 的算法来源；§7.4 修正其 4 个缺陷 |
| 一键成片拆解报告（`rea/analysis` 内，同上） | R-3（其 §6.1）与 R-4（其 §6.2）的来源 |

---

**文档结束。** 所有「新增」主张均附检索证据；未取证事项在 §10.2 显式登记；
筛查后决定不做的项在 §10.3 附理由。可施工性以「每个改动点都指名到文件与函数」为准。
