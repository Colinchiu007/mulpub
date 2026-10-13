# PRD-PLATFORM-TAXONOMY-2026-10-13 — 平台分类体系接入

> **性质**：PRD。把 `ARCH-REUSE-INTEGRATION-2026-10-13.md` §3（R-1）的集成设计**展开成产品规格**，不另起一套。
> **角色**：PM + QA ｜ **状态**：待签字 ｜ **实施计划**：`PLAN-REUSE-ROLLOUT-2026-10-13.md` §2（P0-1~P0-5）
> **资产登记**：`REUSE-CATALOG-2026-10-13.md` C-01 ｜ **判据真源**：`TEST-PLAN-PLATFORM-TAXONOMY-2026-10-13.md`
> **核实口径**：数字分「已核实」（本次直读文件/代码）与「待确认」（转引或存在矛盾）两档，**不混写**。

## 目录

- [0. 一句话结论](#0-一句话结论) ｜ [1. 背景与目标](#1-背景与目标) ｜ [2. 覆盖范围与数据事实](#2-覆盖范围与数据事实)
- [3. 用户故事](#3-用户故事) ｜ [4. 功能逻辑](#4-功能逻辑) ｜ [5. 数据模型](#5-数据模型) ｜ [6. 数据校验](#6-数据校验)
- [7. 流程](#7-流程) ｜ [8. 交互逻辑、显示项与提示文字](#8-交互逻辑显示项与提示文字) ｜ [9. 默认值策略](#9-默认值策略)
- [10. 风险与合规](#10-风险与合规) ｜ [11. 验收判据](#11-验收判据) ｜ [12. 待确认与阻塞项](#12-待确认与阻塞项) ｜ [13. 交叉引用与术语](#13-交叉引用与术语)

---

## 0. 一句话结论

把「中文分类名 → 平台侧分类 ID」这张对照表，从零散硬编码变成 `config/` 下一份**可热更、可校验、可机械验证**的数据文件；
让发布链在调用方指定分类时取到正确 ID，**取不到时如实失败而不是静默发错分类**。

**边界**：15 个受支持平台里**只有 6 个**具备平台侧分类 ID，其中**只有 4 个**还具备可提交的 API 轨（§2.1）。

---

## 1. 背景与目标

### 1.1 问题（三条硬证据）

**A —— 不指定分类时落到硬编码默认值**（已核实）：`bilibili-video.js:77` 的 `tid: Number(taskData.category || taskData.tid) || 21`
（21＝B站「萌宠/日常」）；`adapters/youtube.js:85` 的 `categoryId: taskData.categoryId || "22"`（22＝YouTube「人物与博客」）。
不传就等于**替用户选了分类**。

**B —— 字段通路本来就是通的，缺的只是对照表**（已核实）：`task-data.js:33` 的 `PASSTHROUGH_KEYS` 与
`publish-request.js:39` 的 `ARTICLE_KEYS` **均已含** `category`/`categoryId`。引擎**收得下**分类，
但**没有任何一处**能把「三农」翻译成平台要的 `251`。这是**数据缺口**，不是链路缺口。

**C —— 仓内有分类文件但它是孤儿且不含 ID**：`apps/desktop/electron/services/tag-suggest-data/platform-taxonomy.json`
（110 行 / 1,937 字节，`{version, platforms:{<slug>:{categories:string[], tagStyle}}}`，`categories` 全是裸中文名）；
`git grep -n "platform-taxonomy"` 在 `apps/` 下**零命中**。

### 1.2 现有默认值的危害（已核实）

**危害 1 —— 同一 ID 在图文/视频两套分类里含义不同**：`bilibili` 图文表 `bilibilicategortmap.txt` 的 `21` = **萌宠**，
视频表 `bilibilivideocategortmap.txt` 的 `21` = **日常**。⇒ `tid || 21` **无法用一个数字同时正确表达两个语义**，
这也是产物必须按 `contentType` 分块的原因（§5.4）。

**危害 2 —— 现有 UI 下拉有 4/10 个标签与快照的 ID→名称映射互相矛盾**。`publish-capabilities.json` 的
`overrideFields.bilibili[0].options` 是手写 10 项，逐项对账（直读视频表 143 节点）：

| 注册表显示 | 值 | 快照真实路径 | 判定 |
|---|---|---|---|
| 日常 / 单机游戏 / 电子竞技 / 搞笑 / 鬼畜 / 动物圈 | 21 / 17 / 171 / 138 / 119 / 217 | 生活/日常、游戏/单机游戏、游戏/电子竞技、生活/搞笑、鬼畜、动物圈 | ✅ 6 项一致 |
| **影视** / **科技·数码·手机** / **时尚** / **资讯** | **124 / 231 / 207 / 251** | **知识/社科·法律·心理**、**科技/计算机技术**、**知识/财经商业**、**生活/三农** | ❌ 4 项矛盾 |

**口径（不得过度解读）**：这**不等于**「注册表错了」——两侧都是快照/手写来源，快照本身也已 6 个月未校验（§2.3）。
本条只说明：**同一个 ID 有两个互相矛盾的中文名，而当前产品无法表达这个矛盾** ⇒ 不构成「照抄快照覆盖注册表」的理由，
而构成「选择器须能区分来源 + 须有联网校验路径」的需求（U-2）。

### 1.3 目标

| # | 目标 | 可度量判据 |
|---|---|---|
| **G-1** | 对照表成为**数据**而非代码 | `config/platform-taxonomy.json` 存在；两个硬编码默认值不再**静默**生效（§9） |
| **G-2** | 转换过程**不可能静默少算** | 连跑两次 SHA-256 相同；非空文件解析 0 节点 ⇒ exit 1；`11623` 等 5 个计数对账（§6.1） |
| **G-3** | 有能力的平台能**取到正确 ID** | `resolveCategoryId('douyin','动植物',{contentType:'article'})` ⇒ `ok:true, id:'117'`（快照实测） |
| **G-4** | 取不到时**如实失败** | 显式指定分类但解析失败 ⇒ 该平台发布失败且错误可归因（FL-9/FL-10） |
| **G-5** | 用户**看得见**分类决策 | 四类文案落地 zh/en（§8.3）；未选择时 UI 明示将使用的默认分类名与 ID |

### 1.4 不做什么（out-of-scope）

| # | 不做 | 理由 |
|---|---|---|
| **O-1** | 不覆盖全部 31 个数据平台 | 用户明确决策：P0-1 只覆盖本项目支持的平台。其余平台（`sohu` 2038 节点等）本仓无发布链，导入即死数据 |
| **O-2** | 不为 6 个无数据平台造分类表 | `xiaohongshu` `youtube` `tiktok` `twitter` `instagram` `facebook` 在数据里**完全不存在**（已核实）。编 ID 就是猜 ⇒ `youtube.js:85` 的 `"22"` 保持不动（§9.1） |
| **O-3** | 不把 RPA/DOM 轨的页面选择器一起做 | `weibo`/`zhihu` 有 ID 但 `publishMode: dom-only`（§2.1）⇒ 分类字段**到不了平台**；该接线是另一条链路（审计报告 P1-1 已单列） |
| **O-4** | 不删不改 `tag-suggest-data/platform-taxonomy.json` | 对齐 PLAN §10 X-2：孤儿但被 `PRD-SMART-TAG-SUGGEST-2026-08-31.md` 引用 4 处。新读取层文件头声明「同名不同物」 |
| **O-5** | 不做远端 CDN 下发；不把形态解析带进运行时 | 对齐 PLAN §10 X-10 / X-8：热更已由「替换文件 + 重启」覆盖；远端下发**不解决**「ID 是否仍有效」这个真问题 |
| **O-6** | 不为 `name-only` 平台提交分类 | 那 3 个平台**没有可提交的 ID**（§2.1）。给它们补一个 ID 是编造 |
| **O-7** | 不合并 `publish-capabilities.json` 与本文产物 | 对齐 PLAN §10 X-9：一个管发布能力语义、一个管分类树，合并即让注册表承担两种正交语义 |

---

## 2. 覆盖范围与数据事实

### 2.1 15 个受支持平台的分类能力定档（**本 PRD 最重要的一张表**）

`config/platforms.yaml`（259 行 / 15 平台）∩ 数据集（31 平台）。「有 ID」＝存在该平台 `*categortmap.txt`。

| slug | 平台 id | publishMode | 有分类数据 | 有平台侧 ID | ID 节点数 | 本轮产品能力 |
|---|---|---|---|---|---|---|
| `bilibili` | 23 | api-then-dom | ✅ | ✅ 图文+视频 | 38 + 143 = 181 | **可指定分类（API）** |
| `douyin` | — | api-then-dom | ✅ | ✅ 图文+视频 | 27 + 245 = 272 | **可指定分类（API）** |
| `baijiahao` | 4 | api-then-dom | ✅ | ✅ 仅视频 | 438 | **可指定分类（API，仅视频）** |
| `tencent_video` | ⚠️ 21 | api-then-dom | ✅ | ✅ 仅视频 | 155 | ⚠️ **平台 id 有冲突，见 U-1** |
| `kuaishou` | 35 | api-then-dom | ✅ | ❌ 仅名称 | 0（名称 305） | 只能提示，**不能提交**（O-6） |
| `weibo` | — | **dom-only** | ✅ | ✅ 仅视频 | 190 | **本轮到不了平台**（O-3）；ID 已入库备用 |
| `zhihu` | 12 | **dom-only** | ✅ | ✅ 仅视频 | 33 | 同上 |
| `toutiao` | 3 | **dom-only** | ✅ | ❌ 仅名称 | 0（名称 25） | 只能提示；**且无 API 轨** |
| `wechat_mp` | 1 | **dom-only** | ✅ | ❌ 仅名称 | 0（名称 411） | 只能提示；无 API 轨 |
| `xiaohongshu` `youtube` `tiktok` `twitter` `instagram` `facebook` | 51 / — / — / — / 103 / 104 | 均 dom-only | ❌ | ❌ | — | 无数据（文案①） |

**结论一（用户口径确认）**：9 个平台有分类数据（`bilibili` `douyin` `toutiao` `baijiahao` `weibo` `zhihu`
`tencent_video` `kuaishou` `wechat_mp`），6 个没有（`xiaohongshu` `youtube` `tiktok` `twitter` `instagram` `facebook`）。

**结论二（本次新增，须拍板）**：那 9 个里**只有 6 个有平台侧 ID**；`toutiao` `kuaishou` `wechat_mp` 在数据里
**只有名称**（形态 E：`{名:数组|null}`）。按「只导入带 ID 的映射」不变量，产物 `platforms` 键**恰好 6 个**；
「9 个有数据」由 `platformsWithoutIdData[]` 承载（§5.3）。

**结论三（本次新增，⭐ 影响 P0-5 排期）**：**只有 4 个平台同时具备「平台侧 ID」与「API 轨」** ——
`bilibili` `douyin` `baijiahao` `tencent_video`。PLAN §2 P0-5 写「本轮只做 `baijiahao` + `toutiao`」，
但 **`toutiao` 是 dom-only 且 name-only，本项在它身上双重空转**；建议改为 `baijiahao` + `douyin`（或 `bilibili`）——见 U-3。

### 2.2 数据事实与对账基线（本次直读核实）

数据副本：`01-docs/research/competitor-reverse-2026-10-13/platform-data/`（**已入库，`git ls-files` 计 134 个文件**）。
关键规模：平台 **31**、分类映射文件 **64**（28 个 `*categortmap.txt` 带 ID + 39 个 `*subcategort.txt` 仅名称，
3 个文件名同时命中两模式）、节点总数 **11,623**（64 个文件节点数**求和**，含仅名称镜像，**不是去重值**）；
本项目命中 9 个平台、其中带 ID **6** 个、导入节点 **1,269**（8 个文件）。

| slug | contentType | 源文件 | 原件编码 | 节点数 |
|---|---|---|---|---|
| `bilibili` | article / video | `bilibilicategortmap.txt` / `bilibilivideocategortmap.txt` | GBK / GBK | **38 / 143** |
| `douyin` | article / video | `douyincategortmap.txt` / `douyinvideocategortmap.txt` | GBK / GBK | **27 / 245** |
| `baijiahao` | video | `baijiavideocategortmap.txt` | GBK | **438** |
| `weibo` | video | `weibovideocategortmap.txt` | GBK | **190** |
| `zhihu` | video | `zhihuvideocategortmap.txt` | **UTF-8** | **33** |
| `tencent_video` | video | `tencentvideocategortmap.txt` | **UTF-8** | **155** |
| | | **合计** | | **1,269** |

**已核实的两处「少算事故」（fail-loud 的直接依据）**：早期解析器只认一种形态，把 11,623 报成 **3,838**（少 67%）；
另一版只认 `name` 字段，报成 **2,114**（少 5.5 倍）。⇒ **错误表现是「数字偏小」而不是红灯**，因此对账必须是硬门禁。

### 2.3 冻结快照时效（**必须写进产品行为**）

快照日期 **2026-07-14**；**本轮零联网校验** ⇒ 产物须带 `verifiedOnline: false`。**三条影响与措施**：
① 用户可能选到已失效分类 ⇒ 发布失败**如实上报，不重试、不换 ID**（FL-11），UI 常驻过期提示（文案②）；
② 过期阈值 = `generatedAt - snapshotDate > MP_TAXONOMY_STALE_DAYS`（默认 **180**），非法值回落默认**并出声告警**
（对齐 `account-metrics/constants.js` 的 `resolveIntEnv` 纪律）；③ 分类是**可选字段**，不选即走平台默认。

### 2.4 编码事实（**决定转换器必须逐文件双解码**）

| 层 | 事实 | 核实方式 |
|---|---|---|
| 原始（参考产品 `data.zip` 解出） | **同一目录内混用** GBK 与 UTF-8 | `_taxonomy-summary-v2.json` 的 `files[].enc`：64 个分类文件 **60 GBK / 4 UTF-8** |
| 本项目 8 个 ID 文件 | **6 GBK + 2 UTF-8**（`zhihu*`、`tencent_video*` 为 UTF-8） | 同上逐文件取值 |
| **本仓入库副本** | **121 个 `.txt` 全部合法 UTF-8（0 个 GBK）** | 本次逐文件 `TextDecoder('utf-8',{fatal:true})` 实测 |

**⇒ 两条结论**：① **不能按目录/扩展名批量判定编码**；② **仓内副本已统一转码为 UTF-8，转换器指向仓内副本时永远走不到
GBK 分支** ⇒ GBK 路径的测试必须用**运行时构造的 GBK 字节夹具**；且仓内 `.txt` 受 `check-text-encoding-integrity.js`
约束（域 = `git ls-files`）⇒ **GBK 夹具不得以文件形式入库**。**待确认（口径差）**：原始编码统计在仓内有三个不一致口径
（`78 GBK / 51 UTF-8 / 1 二进制`、`78 / 54`、用户口径 `132 = 54 + 78`）⇒ **不采用任何统计口径作为判据**（U-8）。

### 2.5 形态事实（**解析器必须形态无关**）

| # | 形态 | ID 键 | 实例 |
|---|---|---|---|
| A | `[{code,text}]` | `code` | `douyincategortmap.txt`：`[{"code":117,"text":"动植物"},…]` |
| B | `[{id,name,cates:[{id,name}]}]` | `id` | `qutoutiaocategortmap.txt`（非本项目平台） |
| C | `[{child,id,name}]`，`child` 可 `null` | `id`（**中文串**） | `baijiavideocategortmap.txt`：`{"child":[{"child":null,"id":"军事历史","name":"军事历史"}]}` |
| D | `[{childrenCate,level,parentCate,title,titles,…}]`，任意深度 | `id` | `sohuvideocategortmap.txt`（非本项目平台）：`{"id":300301301,"level":3,"parentCate":300301}` |
| E | `{分类名:[子名…]}` / `{分类名:null}` | **无 ID** | `toutiaovideosubcategort.txt`、`kuaishouvideosubcategort.txt` |
| F | `[{children:[{id,ids?,name}]}]` | `id`（+ `ids` 冗余） | `weibovideocategortmap.txt`：`{"id":"4400850530203370","ids":"4400850530203370","name":"正能量"}` |
| G | `[{id:int,name,children:[…]}]` | `id`（数字） | `bilibilivideocategortmap.txt`：`{"id":160,"name":"生活","children":[{"id":21,"name":"日常"}]}` |
| — | **顶层数组**（元素为任一形态）；**同文件可跨形态** | — | 多个文件；`sohusubcategortmap.txt` 同文件含两种结构 |

形态 F 的 `ids` 与 `id` 实测**逐字节相同**：取 `id`，把 `ids` 当**一致性自检**（不等即记 `warnings[]`），**不静默择一**。

### 2.6 数据内部质量事实（**直接决定 API 语义**，本次实测）

**事实 1 —— `(platform, contentType, id)` 不唯一**：`bilibili/video` 3 组（`36`→{知识,科技}、`86`、`95`）；
`baijiahao/video` 8 组（`其他`×4、`资讯解读`×12、`教学`×18）；其余 6 块为 0。
**事实 2 —— 名称歧义真实存在**：`bilibili/video` 143 中 11（7.7%）、`baijiahao/video` 438 中 60（13.7%）、
`weibo/video` 190 中 17（8.9%）；**视频块合计 1,204 中 88（7.3%）**。
**事实 3 —— `path` 在 `(platform, contentType)` 内唯一：8/8 块、1,269 节点零重复**。

**⇒ 三条结论**：① **`parentId` 不足以重建树**（`bilibili` 有两个一级节点 `id=36`）⇒ 节点须带 `parentPath`；
② **裸名匹配必须 fail-closed**（歧义 ⇒ 不返回命中），UI **不得把歧义名当成一个选项**；
③ **UI 必须级联下钻**，歧义集中在「其他/教学/资讯解读」这类**高频道**词。

**分档**：**已核实** = §1.1 A/B/C、§1.2 危害 1/2、§2.1/2.2/2.4/2.6 全表、§2.5 形态、`path` 唯一性、
在飞 TDD 测试（`scripts/import-platform-taxonomy.test.js`，151 行）与在飞读取层（`platform-taxonomy.js`，324 行）的实际内容。
**待确认** = U-1~U-10（§12）。

---

## 3. 用户故事

| # | 角色 / 故事 | 价值 | 验收 |
|---|---|---|---|
| **US-1** | API 发布到 B 站的用户：我选「生活 > 日常」，发出去就是日常分区 | 不再恒发到 21 号分区（图文语义还是「萌宠」） | `categoryName='生活/日常'` ⇒ `resolved.category === 21`，且**来自我的选择**而非兜底 |
| **US-2** | 批量发布用户：我给抖音选「动植物」，头条那边不会被塞一个抖音的 ID | 平台间不串数据 | `resolveCategoryId('douyin','动植物',{contentType:'article'})` ⇒ `id:'117'`；`hasPlatformCategories('toutiao') === false` 时不写字段 |
| **US-3** | 赶时间用户：我不选分类，但我要**知道**会用哪个默认分类 | 消除「静默替我做决定」 | 未选择时显示文案③，含默认分类中文名与 ID |
| **US-4** | 谨慎用户 / 支持人员：平台没有分类数据时我要一句明确说明；出问题时我要能查到某 ID 来自哪个文件、哪一天 | 不产生「功能坏了」的错觉；有溯源链 | 无数据平台显示文案①且控件不渲染；`sourceFiles` 含 `file`/`encoding`/`nodeCount` |
| **US-5** | 失败用户：我选的分类平台不认，我要知道是分类的问题 | 可自助修复（改选分类） | 平台拒绝分类时错误可归因到分类；**不重试、不换 ID**（FL-11） |
| **US-6** | 维护工程师：换新快照只要替换一个 JSON 并重启 | 不发版即可更新 | `loadTaxonomy({force:true})` 或 mtime/size 变化即重读（§4.2） |

---

## 4. 功能逻辑

### 4.1 转换器 —— `scripts/import-platform-taxonomy.js`（新增，离线工序）

把「装在 `.txt` 里的 JSON」归一成本仓自有的平面表。**形态解析是离线工序**，运行时只读产物（O-5）。

**CLI 契约**（与在飞 TDD 测试对齐）：`node scripts/import-platform-taxonomy.js --source <目录> --out <文件>`。
**无参数** ⇒ 非零退出且 stderr 含 `用法`/`usage`；**`--source` 不存在** ⇒ 非零退出且不产出文件；
**`--source` 不设缺省值**（输入是**仓外**参考产品目录，§10 C-1，写死绝对路径会把机器路径带进仓库）；
**`--out` 缺省 `config/platform-taxonomy.json`**；**任一对账不过 ⇒ exit 1 且不写半成品**（先写临时文件，全通过后原子改名）。

**8 个步骤**：① **枚举** `--source` 下的 `*categortmap.txt` 与 `*subcategort.txt`（文件名里的 `categort` 是参考产品的
拼写错误、**是稳定特征**，但本仓产物**不得**继承该字样，§10 C-2）。② **逐文件双解码试探**（**禁止按目录/扩展名批量判定**）：
UTF-8 严格解码成功 ⇒ UTF-8；否则 GBK 解码后 U+FFFD 计数 `=== 0` ⇒ GBK；两者皆非 ⇒ 记 `unreadable[]`，**不猜**。
③ **形态无关递归遍历**（§2.5），判据是**键的存在性**而非形态名：ID 类键 `id`→`code`→`channel_id`（第一个存在者）；
名称类键 `name`→`text`→`title`；子节点类键 `cates`/`child`/`children`/`childrenCate`；顶层为对象且值非数组 ⇒ **「键即名」形态**。
④ **fail-loud**：非空文件解析出 **0 节点** ⇒ 记 `unreadable[]` 并 **exit 1**（历史少算 67% 的直接防线）。
⑤ **ID 一致性自检**：形态 F 的 `ids` 存在且 `!== id` ⇒ 记 `warnings[]`，取 `id`。
⑥ **slug 映射**（写在脚本里，**未映射一律跳过**并记 `unmappedPlatforms[]`，**禁止猜 slug**）。桥接依据 = `platforms.yaml` 的 `id`
∩ 数据集平台 id 表（`mediadatamgr.ini` 与 `media_url_list.txt` 的注释**双处一致**，已核实）：`1=wechat_mp`、`3=toutiao`、
`4=baijiahao`、`10=weibo`、`12=zhihu`、`23=bilibili`、`35=kuaishou`、`36=douyin`、`51=xiaohongshu`；
**`21=腾讯视频`**、**`53=视频号`**（⚠️ U-1）。**新增桥接自检**：同一 slug 上 `platforms.yaml.id` 与上表必须指向**同一名称**，
不一致 ⇒ 记 `warnings[]` 且**跳过该平台**，除非显式 `--allow-id-conflict <slug>`（实测 8 项一致，
**`tencent_video` 的 `id:21` 与 `name:视频号` 在数据侧不自洽**）。⑦ **只导入带 ID 的节点**（`*subcategort.txt` 只用于计数对账）。
⑧ **确定性**：`platforms`/`platformsWithoutIdData` 按 slug 字典序、节点按 `path` 字典序；**不得**依赖 `readdirSync` 顺序或
`Object.keys` 插入顺序；序列化固定 `JSON.stringify(obj,null,2) + '\n'`。

**合规要求（硬）**：产物只保留「slug + 分类中文名 + 平台侧数字 ID + 层级」这类**事实性数据**；
**禁止**带入参考产品的文件命名、注释文案、树形组织方式的任何**表述**（§10 C-2）。

### 4.2 读取层 —— `packages/shared-utils/src/platform-taxonomy.js`（新增，唯一读取点）

CJS，主进程 + 引擎共用（与 `publish-capabilities.js` 同形态）。**导出 7 个生产符号 + 3 个测试注入**：

| 导出 | 签名 | 语义 |
|---|---|---|
| `loadTaxonomy` | `(opts?) → object`，`{filePath?,force?}` | 载入并缓存（mtime + size 变化才重读，支持热更） |
| `getCategories` | `(platformId, opts) → Node[]`，`opts.contentType` **必填** | 分类节点**深拷贝**；未收录平台返回 **`[]`**（不是 `null`）；**缺 `contentType` 抛错**（猜错会发到错分类，刻意的 fail-loud） |
| `resolveCategoryId` | `(platformId, nameOrId, opts?) → {ok:true,id,name,path,contentType} \| {ok:false,reason,hint}` | 发布链**唯一**取 ID 入口；名称或 ID 都能查；支持 `"生活/日常"` 路径形态；`reason` 区分五种成因（下表） |
| `hasPlatformCategories` | `(platformId, opts?) → boolean` | 是否有**可提交**的 ID（决定 UI 是否渲染控件） |
| `getTaxonomyCoverage` | `(platformId, opts?) → 'id'\|'name-only'\|'absent'` | 档位查询（`name-only` 由 `platformsWithoutIdData[]` 判定） |
| `searchCategories` | `(platformId, keyword, opts?) → Node[]` | 搜索式下拉数据源（大小写不敏感，命中 `name`；**空关键词返回 `[]`**） |
| `validateTaxonomy` | `(opts?) → string[]` | 结构自检，返回问题清单，空数组即健康 |
| 测试注入 | `setTaxonomyPathForTest` / `__resetTaxonomyCacheForTest` / `__clearTaxonomyOverrideForTest` | **生产不调用**；清缓存与清 override **必须分成两个函数**（合并会让测试静默回退到真实 config） |

**`resolveCategoryId` 的失败成因必须可区分**（ARCH 列 4 种，本 PRD 补第 5 种）：

| `reason` | 触发 | 调用方应做什么 |
|---|---|---|
| `platform-absent` | 平台无任何分类数据 | 不写字段，UI 文案① |
| `platform-name-only` | 平台仅有名称（实测为 **`kuaishou`/`wechat_mp`/`tencent_video`**） | 不写字段，UI 文案⑤ |
| `not-found` | 查不到 | **若调用方显式给了名字 ⇒ 失败**（FL-9） |
| `ambiguous` | 命中多个 | 同上，并在 `hint` 里给出候选数 |
| **`content-type-mismatch`**（新增） | 平台有该名但不在请求的 `contentType` 里 | 同上；文案⑧给出可用分类集 |

**实现纪律**：缓存键 = 绝对路径；缓存项 = `{mtimeMs, size, data}`；取数一律**深拷贝**（`publish-capabilities.js:104-108`
已有同因先例：浅拷贝会让调用方突变污染全局冻结表）。**导出接线**：`packages/shared-utils/src/index.js`（现 48 行）
加 1 行 `require` + 1 行 export，**不动现有导出**。

**输入路径解析链（复用既有单一真源，不新造）**：`loadTaxonomy({filePath})` → 否则
`path.join(path.dirname(resolvePlatformConfigPath()), 'platform-taxonomy.json')` ⇒ 天然继承
`MULTI_PUBLISH_CONFIG_PATH > MULTI_PUBLISH_ROOT/config > resourcesPath/config > <仓库>/config`。
`resolvePlatformConfigPath()` 返回的是 **`platforms.yaml` 的文件路径**（不是目录，已核实），所以分类表路径 =
**同目录换文件名**，既有约定**不需要改语义**。⚠️ **已核实的不一致**：桌面端 `path-utils.js:99` 的 `getConfigPath()`
**不读 `MULTI_PUBLISH_ROOT`**（其调用方 `config-resolver.js` 的注释声称支持，实现里没有）⇒ 分类表读取**只走
`shared-utils` 的解析链**，不得据此认为 `MULTI_PUBLISH_ROOT` 在桌面端生效。

### 4.3 发布链怎么取分类

**改动位置**：`apps/desktop/electron/services/publisher-router.js` → `resolvePlatformArticle(task, platform)`（`:158`）。
**插入位置（★ 顺序不变量）**：通用分类解析**必须插在既有精确分支之前**（`if (platform === 'bilibili') {…} else if
(platform === 'youtube') {…}` 在 `:201-212`）。理由已核实：`bilibili.category` 是数字分区 tid、`youtube.categoryId`
是两位数字串；若通用层后跑，会用「分类名解析结果」**覆盖调用方显式给的 tid** ⇒ 既有合同被破坏。

```js
const { resolveCategoryId, hasPlatformCategories, getTaxonomyCoverage } =
  require('@multi-publish/shared-utils/src/platform-taxonomy')
const contentType = task.video && task.video.path ? 'video' : 'article'   // ① 唯一推导点，禁止各处自推
const rawName = override.categoryName                                      // ② 仅当显式给了名字才介入
if (rawName !== undefined) {
  if (!hasPlatformCategories(platform)) {
    return { ok: false, code: 'category-unsupported', platform, coverage: getTaxonomyCoverage(platform) }
  }
  const hit = resolveCategoryId(platform, String(rawName).trim(), { contentType })
  if (!hit.ok) return { ok: false, code: 'category-unresolved', platform, name: String(rawName).trim(), reason: hit.reason }
  resolved.categoryName = rawName    // 原样留痕（日志/进度面板），不进 taskData
  resolved.category = hit.id         // 平台侧 ID
  resolved.categoryPath = hit.path   // 溯源，不进 taskData
}
// ③ 未给名字 ⇒ 什么都不做，交由 §9 默认值策略
```

**关键语义（本 PRD 与 ARCH §3.6(a) 的**刻意分歧**，须拍板确认）**：

| 情形 | ARCH §3.6(a) | **本 PRD** | 理由 |
|---|---|---|---|
| 调用方**没给** `categoryName` | 不写字段 | 不写字段 → 走 §9 默认值 | 一致 |
| 调用方**给了**但解析失败 | 「不写字段（宁可平台用默认分类）」 | **该平台发布失败**，码 `category-unresolved` | 用户明确表达「我要发到 X 分类」。静默回落默认 = **发到错分类且用户不可察**，正是 AGENTS.md「宁可失败不猜」要禁止的形态 |

**改动面提示（诚实声明）**：`resolvePlatformArticle` 现在**没有失败路径**（`:280 return resolved`），下游 `:337/:341`
直接 `if (resolved.category !== undefined) article.category = resolved.category`。引入失败返回需**小重构**
（调用点按 `ok` 分流，失败只影响该平台、不中止整批）。**降级方案**（若 P0 不改此结构）：`console.warn` + 不写字段 +
把码冒泡到发布进度面板的 warnings（**仍不静默**）。二者选一须在 PR 里写明。

**引擎侧适配器（P0-5）**：只读 `taskData.category`/`taskData.categoryId`，**不再自己编默认值**（默认值来源见 §9）。
`task-data.js:33` 与 `publish-request.js:39` 白名单**已含**该两字段，**无需改**（ARCH §3.6(b) 已核实）。
`resolved.categoryName`/`categoryPath` **不进** `taskData`（避免污染请求体），只用于日志与回溯。

### 4.4 渲染层通路（**ARCH §3.6 未覆盖的缺口，本次补齐**）

**已核实的关键事实**：渲染端 `publish-overrides.js:75` 的 `normalizePlatformOverrides()` 是**注册表驱动**的 ——
只保留 `getPlatformOverrideFields(platform,{uiOnly:true})` 返回的字段。**未在 `publish-capabilities.json` 登记的字段
会在 IPC 组装前被静默丢弃**（该文件 `:70-74` 记录了同因事故：「UI 可编辑但发布不生效」）
⇒ **P0-4（注册表登记）是 P0-3（路由）能被 UI 触达的硬前置**。

**四个接线点（缺一不可）**：① 注册表 `publish-capabilities.json` —— 为 6 个平台加
`{key:'categoryName', semantic:'category', type:'category', label:'分类', uiExposed:true, status:'implemented', maxLen:120, placeholder:'留空使用平台默认分类'}`；
② 主进程 `ipc-handlers/publish.js` —— 新增 `taxonomy:categories` handler（参照 `:140` 的 `collection:list`，
用 `helpers.js` 的 `withSenderCheck`）；③ preload `electron/preload/publish.js` —— 加 `listPlatformCategories`，
**必须重打包** `index.bundle.js`（`pnpm run build:preload`，QM-2）；④ 渲染端 `src/api/publisher.js` —— 加同名导出。

**IPC 契约**：`channel: taxonomy:categories`；请求 `{platform, contentType:'article'|'video'}`；
响应 `{code:0, data:{variant, snapshotDate, stale, staleDays, categories:[{id,name,depth,parentId,parentPath,path}]}}`；
错误 `{code:-1|-5, message}`（沿用 `packages/api-publish-engine/src/error-codes.js` 的码表）。

**UI 字段类型新增 `category`**：`PlatformOverridePanel.vue` 加 `v-else-if="field.type === 'category'"` 分支。
**这是「字段类型分支」而非「平台硬编码分支」**，不违反 `PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md` §1.1 禁止的
`v-if platform.id === 'xxx'`。渲染端 `normalizeOverrideValue()`（`publish-overrides.js:32`）对未知 `type` 会走最后的
text 分支（trim + `maxLen` 码点截断）⇒ **`type:'category'` 即便 UI 分支还没做也不会丢弃值**，
这给「先通链路、后做控件」留了安全的两步走路径（§8.2）。
⚠️ **在飞实现另有主张**：`platform-taxonomy.js:44` 的注释把该模块当作**会被渲染进程打包链引用**（`require` 包在 try 里）
⇒ 与本节 IPC 方案冲突（沙箱渲染进程无 `fs`）。见 U-10/A11。

---

## 5. 数据模型

### 5.1 顶层结构与字段规格（`config/platform-taxonomy.json`）

```jsonc
{ "version": 1,                              // number，必填。结构版本；消费层按此分派
  "generatedAt": "2026-10-13T15:04:05.000Z", // string ISO-8601 UTC，必填。产物生成时刻（非快照日期）
  "source":   { /* §5.2 */ },                 // object，必填。来源与规模对账
  "platformsWithoutIdData": [ /* §5.3 */ ],   // string[]，必填。只有名称、不可提交的平台 slug
  "stats":    { "platforms": 6, "nodes": 1269 }, // object，必填。产物自身的规模
  "platforms": { /* §5.4 */ } }               // object<slug,object>，必填。运行时唯一查询面，键恰好 6 个
```

⚠️ **字段名以使在飞实现为准**（`version` / `platformsWithoutIdData` / `stats`）；ARCH §3.2 写的 `schemaVersion` /
`coverage[]` / 扁平计数**未被实现采纳**（U-10/A2）。**在 P0-1 冻结产物形状前必须定稿** —— 否则转换器按一套字段名产出、
读取层按另一套消费，运行时读到空表**且不报错**（最坏形态）。

### 5.2 `source` 段

必填：`snapshotDate`（`"2026-07-14"`，UI 过期提示的唯一依据）、`verifiedOnline`（本轮恒 **`false`**；任何联网校验过的产物
须改 `true` 并在 PR 附证据）、`parserVersion`（semver）、`encoding`（`{utf8,gbk,undecidable}`，**实测**分布，不用转引值）、
`unreadable`（`string[]`，仅文件名；**非空即应 exit 1**，故正常产物恒 `[]`）、`warnings`（`string[]`，非致命告警；
**允许非空，但必须打印到 stdout**）、`unmappedPlatforms`（`string[]`，记录数量与 internal id，不写字面平台名）。
规模对账：`vendorPlatformCount` / `vendorFileCount` / `vendorNodeCount`（本期 `31` / `64` / `11623`）、
`idFileCount`（`28`）、`slugsWithData` / `slugsWithId` / `importedNodeCount`（`9` / `6` / `1269`）。

### 5.3 `platformsWithoutIdData[]` 段

`string[]`，列出**在数据里出现但只有名称**的平台 slug（本期恰好 3 个：`toutiao` `kuaishou` `wechat_mp`）。
`getTaxonomyCoverage` 据此把档位判为 `'name-only'`；其余未收录平台判为 `'absent'`。
**为什么是扁平 slug 数组而不是 `coverage[]` 对象数组**：① 运行时只需回答「这个平台有没有可提交 ID」，
`platforms` 的键集合已经回答了「有」，本数组回答「只有名字」；② 显示名可从 `platforms.yaml` 的 `name` 直接取，
**不重复存储**（避免与 `platforms.yaml` 产生第二份真名源）；③ 与在飞实现一致。
**溯源信息**（哪个文件、什么编码、多少节点）放在 §5.4 的块级 `sourceFile`/`sourceEncoding`/`nodeCount` 上。
⚠️ **在飞实现违反本条的一处**：`validateTaxonomy():289` 校验「块内 `id` 唯一」，而真实数据客观重复
（`bilibili/video` 3 组、`baijiahao/video` 8 组）⇒ **`validateTaxonomy()` 永远非空**，PLAN P0-2 判据 ① 不可满足。
**必须删该条、改校验 `path` 唯一性**（U-10/A1）。

### 5.4 `platforms.<slug>.<contentType>` 段

```jsonc
"platforms": {
  "bilibili": {
    "article": { "sourceFile":"bilibilicategortmap.txt", "sourceEncoding":"gbk", "nodeCount":38,
                 "nodes":[{ "id":"21","name":"萌宠","depth":2,"parentId":"…","parentPath":["生活"],"path":["生活","萌宠"] }] },
    "video":   { "sourceFile":"…", "sourceEncoding":"gbk", "nodeCount":143, "nodes":[/* 143 */] } },
  "douyin": {"article":{"nodeCount":27,…},"video":{"nodeCount":245,…}}, "baijiahao": {"video":{"nodeCount":438,…}},
  "weibo": {"video":{"nodeCount":190,…}}, "zhihu": {"video":{"nodeCount":33,…}}, "tencent_video": {"video":{"nodeCount":155,…}} }
```

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `<contentType>.sourceFile` / `.sourceEncoding` | `string` / `'utf8'\|'gbk'` | ✅ | 源文件名与**实测**原件编码（**仅溯源**；运行时**不得**据此做任何分派） |
| `<contentType>.nodeCount` | `number` | ✅ | 必须 `=== nodes.length`（块级自校验） |
| `<contentType>.nodes` | `Array<Node>` | ✅ | **非空、扁平**数组（非嵌套）。所有消费场景都是「按名/按 ID 找一节点」，扁平 + 路径前缀让检索是 `filter` 而非递归 |
| `Node.id` | `string` | ✅ | 平台侧分类 ID，**统一转字符串**（数据里既有数字也有中文串，如 `baijiahao` 的 `"军事历史"`）。**不得为空** |
| `Node.name` | `string` | ✅ | 分类中文名（**保留平台原始写法**，不做简繁/空格归一） |
| `Node.depth` | `number` | ✅ | 层级，从 **1** 开始（⚠️ 字段名以使在飞实现为准；ARCH 写 `level`，U-10/A5） |
| `Node.parentId` / `.parentPath` | `string\|null` / `string[]\|null` | ✅ | 父节点 `id` / 父节点 `path`；一级均为 `null`。⚠️ **`parentId` 不唯一，树重建与级联下钻只准用 `parentPath`** |
| `Node.path` | `string[]` | ✅ | 从根到本节点的**名称数组**（`["生活","萌宠"]`）。**在 `(platform,contentType)` 内唯一**（实测 1,269/1,269） |

**不变量（`validateTaxonomy()` 逐条断言）**：① `platforms` 键集合 ⊆ `platformsWithoutIdData ∪ platforms` 的 slug 空间，
且与 `stats.platforms` 一致；② 每个 `nodes[]` **非空**，每个 `node.id` 非空字符串；③ **`path` 在 `(slug,contentType)` 内唯一**；
④ `depth===1 ⇔ parentId===null && parentPath===null`；⑤ `depth>1 ⇒ parentPath` 必须存在于同块
（**两遍扫描**：父节点可能排在本节点之后）；⑥ `nodeCount === nodes.length`；⑦ `stats.nodes === Σ nodeCount`；
⑧ `source.verifiedOnline === false`（本快照从未联网校验，不标注会让读者误以为已核验）。

**⚠️ 明确不做的校验**：**不得校验 `id` 在同一块内唯一** —— 数据里客观存在重复（§2.6 事实 1），
写成校验会让产物**永远红**，从而逼人放宽门禁（比没有门禁更糟）。**应校验的是 `path` 唯一性**。
两者**恰好相反**：一个真不变量未被强制、一个假不变量被强制，是同一类错误的两种形态（U-10/A1）。

### 5.5 版本字段与兼容策略

| 值 | 消费层行为 |
|---|---|
| `version: 1` | 正常加载 |
| 未识别（如 `999`）/ 缺省 / 非数字 | ⚠️ **口径待定**（U-10/A2）。ARCH §3.3 要求 **fail-closed（拒绝加载并告警，不猜）**；在飞实现**只检查 `typeof version === 'number'`、不做版本分派**。本 PRD 主张：**不认识的版本必须出声**（`validateTaxonomy()` 非空 + error 日志 + 分类控件不渲染），是否抛错由 U-10 统一拍板 |

**升级规则**：任何**破坏性**变更（删字段、改语义、改 `platforms` 键空间）必须 `+1`；
**新增可选字段**不升版本，消费层按「读不到就当没有」处理。

### 5.6 与 `config/platforms.yaml` 的关系

**互补，不合并**（ARCH §3.2 三条理由：1.5 MB YAML 的解析成本与 diff 噪声、机器重生成会给人手文件带出无意义 diff、
分类需要版本与校验和的自然位置）。**键空间同为 slug，必须一致**。`platforms.yaml` = 发布配置（URL/限额/模式/图标，
**人手维护含注释**，259 行 / ~10 KB，变更低）；本文件 = 分类树（**机器产物**，预估 ≤1.5 MB，变更高）。
**打包**：已核实 `apps/desktop/package.json:159-166` 的 `from:"../../config"` 整体拷贝 + `filter` 只排除 `*.test.js`
⇒ 新文件**零额外构建配置**即进 `resourcesPath/config`。**桥接字段处置**：`platforms.yaml` 的 `id` 字段**保持既有人手事实不动**，
但转换器**必须**把它与数据集平台 id 表对账（§4.1 步骤 ⑥）；**不新增**字段、**不修改**任何现有平台段。

---

## 6. 数据校验

### 6.1 转换期校验（任一不过 ⇒ **exit 1 且不写产物**）

| # | 校验 | 判据 / 失败动作 |
|---|---|---|
| 1 | **形态覆盖** | `unreadable[]` 为空；每个非空文件解析节点数 `> 0`。否则 exit 1，stderr 含「未识别/无法识别」 |
| 2 | **编码判定** | 逐文件双解码；`utf8+gbk+undecidable === 文件总数`；打印实测分布。`undecidable>0` ⇒ exit 1 |
| 3 | **只导入带 ID 的节点** | 产物不存在 `id` 为空/`null` 的节点，否则 exit 1 |
| 4 | **ID 一致性（形态 F）** | `ids` 存在且 ≠ `id` ⇒ `warnings[]`。**不 exit**，取 `id` + stdout 告警 |
| 5 | **slug 映射完整性** | 未映射一律跳过并记 `unmappedPlatforms[]`；**禁止猜 slug**。**不 exit**，stdout 打印未映射数量 |
| 6 | **桥接自检** | `platforms.yaml.id` 与平台 id 表在名称轴一致；不一致 ⇒ `warnings[]` 且**跳过该平台**，除非 `--allow-id-conflict <slug>` |
| 7 | **`path` 唯一性 + 父子链** | `path` 在 `(slug,contentType)` 内唯一；`depth>1` 的 `parentPath` 必须存在；`depth===1 ⇔ parentPath===null`。否则 exit 1 |
| 8 | **节点计数对账** | `vendorNodeCount===11623`、`vendorFileCount===64`、`idFileCount===28`、`slugsWithId===6`、`importedNodeCount===1269`。**任一不等 ⇒ exit 1** 并打印「期望 vs 实际」 |
| 9 | **确定性** | 同输入连跑两次 SHA-256 相同，否则 exit 1（排除遍历顺序依赖） |

**⚠️ 校验 8 的 5 个数字是「本快照的期望值」**，不是永恒常量：换快照时**必须一起改**，且改动要出现在 PR 描述里
（**刻意的人工确认点**，不能被自动化吞掉）。判据 8 的意义正在于此 —— 它把「少算 67% 却不报错」变成红灯。

**★ 对在飞 TDD 测试的修正要求（须拍板）**：`scripts/import-platform-taxonomy.test.js:134` 断言 `withData.length >= 7`，
但实测本项目 15 平台中**只有 6 个**有 ID 文件（§2.1）⇒ 按正确映射该断言**必然为假**。
建议改为 **`=== 6`**，并**新增** `platformsWithoutIdData.length === 3` 的断言 ——
否则「≥7」很容易被"顺手改成 ≥6"消解掉信息量，「9 个有数据」这个事实就没人再验了。

### 6.2 运行期校验

| 场景 | 行为 | 出声 |
|---|---|---|
| 产物缺失 / JSON 非法 / 缺 `platforms` | ⚠️ **口径待定**（U-10/A3）：ARCH 要求**抛错**；在飞实现**返回空壳 + `__loadError`**（理由：分类是增强能力，不该炸掉发布链）。本 PRD 主张：**宽容读 + 把 `__loadError` 变成 `validateTaxonomy()` 的第一条 issue + error 日志**，即「不炸链路但绝不静默」 | error 日志含路径与首行原因 |
| `version` 不认识 | 同 §5.5（出声，不猜结构） | error 日志含实际版本号 |
| 平台不在 `platforms`（含 `name-only`/`absent`） | `hasPlatformCategories → false`；`getCategories → []` | **不报错**（正常档位，不是故障） |
| 平台收录但无该 `contentType` 块 | `getCategories` 返回 `[]`；`resolveCategoryId` 给 `content-type-mismatch` | 不报错 |
| 查表失败 | 看调用方**是否显式给了名字**：给了 ⇒ 该平台发布失败；没给 ⇒ 走默认值 | 失败 error；默认值 info |
| 命中但 ID 非法 | 「非法」**不由本仓判定**，交平台业务错误码裁决 | 如实上报，**不重试、不换 ID** |
| 缓存命中 / 热更生效 | mtime+size 未变 ⇒ 不重读；变了 ⇒ 重读 | 命中无日志；热更 info 含新 `generatedAt` |

### 6.3 fail-loud 原则

**必须报错（禁止静默降级）**：**FL-1** 转换器源目录不存在 ⇒ exit≠0；**FL-2** 转换器非空文件解析出 **0 节点** ⇒ exit 1
（**历史事故的直接防线**）；**FL-3** 转换器未识别形态 ⇒ exit 1 且 stderr 含「未识别」；**FL-4** 转换器双解码均失败
（`undecidable>0`）⇒ exit 1，**不猜编码**；**FL-5** 转换器任一计数对账不等 ⇒ exit 1 并打印期望 vs 实际；
**FL-6** 转换器 `path` 不唯一 / 父子链断裂 ⇒ exit 1；**FL-7** 转换器连跑两次产物不同 ⇒ exit 1；
**FL-8** 读取层产物缺失 / JSON 非法 / 版本不认识 ⇒ **出声**（抛错或 issue + error 日志，口径见 U-10/A2/A3），
**不得静默返回空表继续跑**；**FL-9** 发布链**显式给了** `categoryName` 但解析失败 ⇒ 该平台发布**失败**，
码 `category-unresolved`（带 `reason`）；**FL-10** **显式给了** `categoryName` 但平台无分类能力 ⇒ 该平台发布**失败**，
码 `category-unsupported`；**FL-11** 平台以「分类不存在/非法」拒绝 ⇒ **如实失败**，不重试、不改选别的 ID（ARCH §3.5，沿用）。

**允许静默（但须出声在 level ≥ info）**：**S-1** 调用方**没给**分类 ⇒ 用默认值（可选字段的合法缺省，UI 已用文案③明示）；
**S-2** 平台无分类数据 ⇒ 不写字段（正常档位）；**S-3** `name-only` 平台 ⇒ 不写字段（O-6）；**S-4** 缓存命中不重读。

**判据一句话**：**「用户/调用方明确表达了某个意图而系统做不到」⇒ 必须报错；
「用户没有表达意图」⇒ 允许用默认值，但必须在界面上说明白。**

---

## 7. 流程

### 7.1 转换器执行流程

```
node scripts/import-platform-taxonomy.js --source <DIR> --out <FILE>
  0 参数解析 ── 缺参数 / 源目录不存在 ─────────────────────────► 用法 + exit≠0
  1 枚举 *categortmap.txt + *subcategort.txt
  2 逐文件双解码试探（★ 不可按目录批量判定）
       utf8 严格成功 ► UTF-8 ｜ 否则 GBK 解码 U+FFFD==0 ► GBK ｜ 否则 ► unreadable[] ✖ exit≠0
  3 形态无关递归遍历（判据 = ID键/名称键/子节点键，不是形态名）
  4 该文件节点数 == 0 ? ── 是 ─► unreadable[] + ★ exit 1（fail-loud）
                         └ 否 ─► 5  ids≠id → warnings[]（取 id）
  6 slug 映射（脚本内表）：未映射 → unmapped[] 跳过；
       platforms.yaml.id 桥接自检冲突 → 跳过 + warn（除非 --allow-id-conflict）
  7 只收带 ID 的节点；重算 depth / parentPath / path
  8 校验 1-7 + 计数对账 8（11623/64/28/6/1269）── 不等 ─► exit 1
  9 排序 + 序列化 → 临时文件 → 原子改名到 --out → stdout 摘要 → exit 0
```

**stdout 对账摘要（格式固定，供人工与测试抓取）**：

```
[taxonomy] files=64 (categortmap=28, subcategort=39, overlap=3)   encoding: utf8=<n> gbk=<m> undecidable=<k>
[taxonomy] vendor: platforms=31 nodes=11623    mapped: slugs-with-data=9 slugs-with-id=6 imported-nodes=1269
[taxonomy] per-platform: bilibili/a=38 bilibili/v=143 douyin/a=27 douyin/v=245 baijiahao/v=438 weibo/v=190
           zhihu/v=33 tencent_video/v=155
[taxonomy] unmapped=<n> unreadable=0 warnings=<n>    out=config/platform-taxonomy.json sha256=<hex>
```

### 7.2 发布时取分类流程

（与 §4.3 同一逻辑，此处只画**判定分支**；每步的字段与返回值见 §4.3）

```
渲染端选分类 → override.categoryName="生活/日常"
  → normalizePlatformOverrides（★ 注册表驱动：未登记即静默丢弃 ⇒ P0-4 是硬前置）
  → IPC publish:batch → 主进程 resolvePlatformArticle(task,'bilibili')
        contentType = task.video?.path ? 'video' : 'article'        // 唯一推导点，定稿前不得四处自推
        categoryName === undefined ?
          ├ 是 ─► 【S-1】不写字段 ⇒ §9 默认值（UI 文案③）
          └ 否 ─► hasPlatformCategories ?
                   ├ false ─► 【FL-10】失败 category-unsupported
                   └ true ──► resolveCategoryId(platform,name,{contentType})
                               ├ ok ─► resolved.category=hit.id
                               │        ① 精确层（bilibili/youtube 分支）**在后**跑 ⇒ 显式 tid 胜出
                               │        ② article.category = resolved.category
                               │        ③ adapter 读 taskData.category 写请求体
                               └ !ok ► 【FL-9】失败 category-unresolved（带 reason）
  平台错误码裁决：分类不存在/非法 ─► 【FL-11】如实失败，不重试、不换 ID
```

### 7.3 热更流程

① 取得新快照目录（仓外绝对路径）→ ② 重跑转换器；**若对账数字变化（11623 等）则 exit 1**
⇒ 人工确认新快照规模后更新脚本里的期望常量并重跑（★ 刻意的人工确认点）→
③ 替换发布产物里的 `resourcesPath/config/platform-taxonomy.json`（或源码仓 `config/`）→
④ 重启应用（mtime+size 缓存因此失效），或 `loadTaxonomy({filePath, force:true})` 立即重读 →
⑤ 验收：`getCategories('bilibili',{contentType:'video'}).length === 143`（新快照下为实测值）。**不做**远端 CDN 下发（O-5）。

---

## 8. 交互逻辑、显示项与提示文字

### 8.1 决策一：调用方没给分类时，UI 是否提示？—— **要提示**

**现状问题**：不传分类时静默落到硬编码默认值（§1.1 A），界面上**没有任何地方**显示「你将被发到 21 号分区」，
而 21 在图文/视频两套语义下分别是「萌宠」和「日常」——这是**用户不可察的默认决策**。

**决策**：对每个「有分类能力的平台」**常驻显示当前生效的分类**（三态）：**已选择** ⇒ `分类：生活 > 日常`
（中文名 + 层级路径，弱化显示 `#21`）；**未选择且平台有默认值** ⇒ 文案③（含默认分类中文名与 ID）；
**未选择且平台无默认值** ⇒ 文案⑦。

**为什么不在提交时弹确认框**：发布页已是「编辑 → 点发布」两步结构，额外模态确认会被条件反射点掉；
且按 AGENTS.md 的浮层互斥合同，模态浮层还要接 `useEmbeddedViewSuspension`，成本与收益不成比例。

### 8.2 决策二：选择器的显示项与层级呈现

**决策：级联下钻，主显示中文名，ID 作为弱化副信息。**

| 显示项 | 规格 | 理由 |
|---|---|---|
| **主文本 / 层级** | 分类**中文名**；**级联选择**（先选一级再选下级，最多三级，`baijiahao` 有 3 层） | 用户不认识 `8335388`；§2.6 事实 2 的裸名歧义 7.3% 集中在「其他/教学/资讯解读」这类**高频道**词，扁平框会让用户选错 |
| **已选值展示** | 完整路径用 ` > ` 连接（`生活 > 日常`） | 与产物里的 `/`（数组 join）区分：那是**存储与 API 形态**，` > ` 是**显示形态** |
| **ID 展示** | 选项右侧弱化 `#21`；已选行末尾灰字 `ID 21` | ID 是排障证据（用户报「分类发错」时支持人员要能拿到） |
| **搜索** | 命中 `path` **任一层**即算（`searchCategories`）；命中歧义名时**展开候选路径**而非直接选中 | 438 节点的 `baijiahao` 必须能搜索 |
| **`name-only` / 无数据平台** | **控件不渲染**（`hasPlatformCategories === false`），改显示文案⑤/① | 渲染一个不可用的控件是欺骗 |

**两级落地路径（同一字段键，无迁移成本）**：**P0** `type:'category'` 但面板尚无该分支 ⇒ 渲染成**文本输入**
（`v-else` 的 `<input>`），用户手输路径；主进程 fail-loud 兜底（前置 P0-3 + P0-4）。**P0+（推荐）** 面板新增
`v-else-if="field.type === 'category'"` + `CategoryPicker.vue`，走 IPC 拉取 + 级联。

> ⚠️ **P0 形态的可接受性前提**：手输路径必然有拼写失败 ⇒ **P0 必须同时上线 FL-9（失败可见）**；
> 若回落到「静默不写字段」，**P0 不得以文本输入形态上线**（会把「分类没生效」变成不可察）。

### 8.3 提示文案清单（**中文原文 + 英文对照 + i18n key**）

**落地位置（i18n 约定，本 PRD 只规定不改代码）**：`apps/desktop/src/locales/publish/zh.js`（现有 `publish` 命名空间）
与 `apps/desktop/src/locales/publish/en.js` **成对新增** `category` 子对象。CI Gate 7
`.github/scripts/check-locale-sync.js` 的 `--pair-base` 拦截「只改 zh 不改 en」，`--keys` 拦截「模板里用了
zh/en 都不存在的 key」；**禁止**在 `.vue` 里新增中文字面量（`--cjk` 基线拦截）。

| # | 场景 | i18n key | 中文原文（**逐字照抄**） | English |
|---|---|---|---|---|
| ① | **平台无分类数据** | `publish.category.unsupported` | `该平台暂不支持指定分类，将使用平台的默认分类。` | `This platform does not support choosing a category; the platform default will be used.` |
| ② | **数据可能过期**（冻结快照） | `publish.category.stale` | `分类数据取自 {date} 的快照，平台可能已调整；若提交时提示分类无效，请改选其他分类。` | `Category data is a snapshot from {date} and may be outdated. If the platform rejects the category, choose another one.` |
| ③ | **未选择分类，将使用默认值** | `publish.category.defaultInUse` | `未选择分类，将使用默认分类「{name}」（ID {id}）。` | `No category selected; the default category "{name}" (ID {id}) will be used.` |
| ④ | **分类查表失败** | `publish.category.unresolved` | `未找到分类「{name}」，请从列表中选择。已跳过该平台的发布，以免发到错误分类。` | `Category "{name}" was not found. Pick one from the list. Publishing to this platform was skipped to avoid posting to a wrong category.` |
| ⑤ | **平台只有名称、无 ID** | `publish.category.nameOnly` | `该平台只提供分类名称、没有可提交的分类 ID，因此无法为它指定分类。` | `This platform only exposes category names without submittable IDs, so a category cannot be specified.` |
| ⑥ | **同名分类歧义** | `publish.category.ambiguous` | `「{name}」在该平台有 {count} 个同名分类，请选择完整层级：{paths}。` | `"{name}" matches {count} categories on this platform. Choose the full path: {paths}.` |
| ⑦ | **未选择且平台无默认值** | `publish.category.defaultUnknown` | `未选择分类，将由平台自行决定。` | `No category selected; the platform will decide.` |
| ⑧ | **该内容类型无分类** | `publish.category.contentTypeMismatch` | `该平台仅对{contentTypeLabel}提供分类，当前内容类型不支持指定分类。` | `This platform only provides categories for {contentTypeLabel}; the current content type cannot specify one.` |
| ⑨ | **控件标签** | `publish.category.label` | `分类` | `Category` |
| ⑩ | **控件占位符** | `publish.category.placeholder` | `留空使用平台默认分类` | `Leave empty to use the platform default` |

**文案填值规则（必须与实现一致）**：`{date}` = `source.snapshotDate`（**不本地化格式**，避免歧义）；
`{name}`/`{id}` = 默认分类的 `name`/`id`，**从注册表 `overrideFields[platform]` 中 `semantic==='category'` 的字段
`default` + `options` 反查**（`bilibili` ⇒ `21` ⇒ 「日常」），**反查失败 ⇒ 退回文案⑦**，不得显示 `ID undefined`；
`{paths}` = 候选 `path` 用 `、` 连接，**最多 3 条**，超出加「等」；`{contentTypeLabel}` = `视频`/`图文`（走同一 i18n 表）。
**文案②条件（精确）**：`stale === true`，即 `(now - snapshotDate) > MP_TAXONOMY_STALE_DAYS`（默认 180 天，
非法值回落默认**并出声告警**）；位置：分类控件下方一行灰字，**不弹窗、不阻塞**。
**文案①②⑤⑧由平台档位决定**（`getTaxonomyCoverage`），**不是**「用户操作后才知道」。

### 8.4 显示项汇总与各档位行为

```
┌─ 哔哩哔哩 ───────────────────────────────────────┐  ┌─ 今日头条 / 小红书 ───────────────┐
│ 分类                        ← 文案⑨（field.label）│  │ （分类控件不渲染）                │
│ [ 生活 > 日常                    ▾ ]  ID 21      │  │ 该平台只提供分类名称、没有可提交  │
│   ● 生活                                         │  │ 的分类 ID…            ← 文案⑤    │
│     ○ 日常 ← 已选（#21）  ○ 搞笑 (#138)          │  │ 该平台暂不支持指定分类，将使用    │
│   ● 游戏   ○ 单机游戏 (#17)                      │  │ 平台的默认分类。       ← 文案①    │
│ [搜索分类…]                ← searchCategories    │  └───────────────────────────────────┘
│ 分类数据取自 2026-07-14 的快照…  ← 文案②（stale）│
└──────────────────────────────────────────────────┘
```

| 档位 | 分类控件 | 文案 | 提交时 |
|---|---|---|---|
| `variant='id'` + 有默认值 | 渲染（级联） | 未选⇒③；过期⇒② | 未选⇒默认值；选了⇒解析，失败⇒④ + FL-9 |
| `variant='id'` + 无默认值 | 渲染（级联） | 未选⇒⑦；过期⇒② | 同上（未选⇒不写字段） |
| `variant='name-only'` | **不渲染** | ⑤ | 不写字段（S-3） |
| `variant='absent'` | **不渲染** | ① | 不写字段（S-2） |
| 有数据但无当前 `contentType` 的块 | **不渲染** | ⑧ | 不写字段（S-2） |
| 产物不可读（缺失/非法/版本不认识） | **不渲染** | ①（退化为「无分类数据」） | 不写字段（S-2）+ error 日志 |

---

## 9. 默认值策略

### 9.1 决策

| 默认值 | 位置 | 决策 | 处置 |
|---|---|---|---|
| `tid: Number(taskData.category \|\| taskData.tid) \|\| 21` | `packages/api-publish-engine/src/publish/platforms/bilibili-video.js:77` | **保留数值 21，但「去静默 + 收敛到单一真源」** | 适配器**不再自带** `\|\| 21`；默认值改由**注册表** `overrideFields.bilibili[0].default`（已存在，值 `21`）派生 |
| `categoryId: taskData.categoryId \|\| "22"` | `packages/api-publish-engine/src/adapters/youtube.js:85` | **原样保留，本轮不动** | YouTube **不在数据集里**（§2.1）。无数据支撑的改动＝猜（O-2） |

### 9.2 理由

**为什么保留 21 而不是「无值就不传」**：① `tid` 是 B 站 `add/v3` 的**必填**分区字段，不传是**必然失败**，
不是「平台自选」；② 已核实注册表已声明 `bilibili.category.default === 21` 且 UI 下拉默认选中它 ⇒ 现状**本来就是
「默认 21」**，本 PRD 不改变产品行为，只改变它的**可见性与真源数量**；③ 改成「必须先选」会让**存量批量发布**全部阻塞。

**为什么要「去静默」**：现状下 21 是**隐式**的（代码里硬编码 + 注册表里声明，两处两份真源）。⇒ 适配器不再兜底，
改为 `taskData.category` 缺失时读注册表默认；**UI 用文案③把它说出来**。**两处两份真源本身就是缺陷**
（改一处不改另一处 ⇒ 静默漂移），收敛到注册表是顺带收益。

**为什么 YouTube 的 `"22"` 不能顺手改**：它对应「人物与博客」。我们没有 YouTube 的分类数据（已核实不在数据集），
也没有联网校验（§2.3）。任何改动都是**用一个猜测替换另一个猜测**；登记为遗留项（U-6）。

### 9.3 兼容与迁移

**不需数据迁移**（分类是提交时字段，不落库；ARCH §3.10：回滚成本 = 删 1 `require` + 1 export + 1 JSON）。
**存量任务**（草稿箱里没有 `categoryName` 的历史草稿）：`undefined` ⇒ 走 §9.1 默认值，**行为与改造前一致**（刻意向后兼容）。
**`category`/`categoryId` 直传仍然生效**：调用方直接给数字 ID（老路径）时通用层不介入（它只在
`override.categoryName !== undefined` 时动作），精确层（`bilibili`/`youtube` 分支）照旧胜出 ⇒ **既有 API 合同不变**。

---

## 10. 风险与合规

### 10.1 竞品数据的可用边界（硬约束）

| # | 约束 | 判据 |
|---|---|---|
| **C-1** | 参考产品数据的**原始目录绝不入库** | 转换器读**仓外绝对路径**（`--source` 无缺省值）；`git ls-files` 不得出现该目录 |
| **C-2** | 产物只保留**事实性数据** | slug + 分类中文名 + 平台侧数字 ID + 层级。**不含**树形组织方式的表述、注释文案、文件命名（含其拼写错误 `categort`）。`sourceFile` 是**溯源字段**，代码逻辑**不得**读它做分派 |
| **C-3** | 文档与代码**一律写「参考产品」** | `node scripts/check-no-brand-residue.js` 必须通过；本文与 Test Plan **零品牌名**（对齐 ARCH/PLAN 的 0 出现口径） |
| **C-4** | 平台侧分类 ID 是**平台公开的类目数据** | 不是参考产品的创作成果 —— 这是「可把 ID 用于本产品」的依据 |
| **C-5** | **不引入** RPA 看板 URL / 采集注入规则 / DOM 类名指纹 | 对齐 PLAN §10 X-3：分类映射是平台公开类目，那三类逼近「规避平台技术措施」 |

### 10.2 冻结快照的时效风险（**已核实为高概率**）

**概率高**（快照 2026-07-14，零联网校验，平台类目调整是常态）；**影响中**（用户选到失效分类 ⇒ 平台拒绝 ⇒ 发布失败，
**不是**发到错分类，因为平台会拒）；**缓解**：① UI 常驻文案②；② 阈值 `MP_TAXONOMY_STALE_DAYS`（默认 180）可配；
③ 失败如实上报不重试（FL-11）；④ 分类可选，不选即无此风险；**回滚**：清空某平台 `nodes` ⇒ 退化为「无分类能力」。

**残余风险（不假装已闭合）**：**「平台静默接受了一个语义已变的 ID」本仓无法发现** —— 124 号在平台侧到底是
「影视」还是「社科·法律·心理」，**只有联网校验或真机发布才能判定**（U-2）。本 PRD 不声称已解决。

### 10.3 是否符合平台 ToS

| 项 | 结论 | 依据 |
|---|---|---|
| 分类 ID 的使用 | **符合** | 分类 ID 是平台**公开**类目标识，通过官方创作者后台发布接口提交，用**用户自己账号的 Cookie**（本仓既有形态） |
| 数据来源 | **需人工确认** | 数据集取自参考产品安装包（**第三方**）。入库副本（`01-docs/research/…`）的许可边界**不是本文能判定的**（U-7）。本文处置：**转换器不依赖它**（依赖仓外原件），产物只含事实性数据 |
| 是否规避平台技术措施 | **否** | 不抓取、不绕风控、不破解加密（对齐 PLAN §8.2 C-2/C-3/C-4） |
| 用户数据外发 | **无** | 分类解析全程本地；`resolveCategoryId` 是纯查表，不发任何网络请求 |

### 10.4 其他风险

| # | 风险 | 概率 | 影响 | 缓解 | 回滚 |
|---|---|---|---|---|---|
| R-1 | 形态漏一种 ⇒ 静默少算 | 中 | 分类不全且**不报错** | FL-2/3/4/5 + 计数对账 | 重跑转换器 |
| R-2 | slug 映射错 ⇒ 分类树挂错平台 | 中 | 提交非法 ID | 未映射一律跳过；桥接自检（校验 6） | 从 `platforms` 删该键 |
| R-3 | 破坏 bilibili/youtube 既有合同 | 低 | 分区/分类发错 | 顺序不变量 + 契约锁 | 摘掉通用层那段（单 hunk） |
| R-4 | `categoryName` 未登记 ⇒ 渲染端静默丢弃 | **中高** | 「UI 可编辑但发布不生效」 | P0-4 为 P0-3 硬前置；`publish-overrides.test.js` 加断言 | 补注册表条目 |
| R-5 | preload 改动未重打包 ⇒ 功能静默不可用 | 中 | 控件拉不到数据 | QM-2 强制 + `pnpm run build:preload`（`apps/desktop/package.json:11`） | 重打包 |
| R-6 | 产物字段名三套并存（ARCH / TDD 测试 / 实现） | **高** | 运行时读到空表**且不报错** | **P0-1 出产物前冻结字段名**（U-10/A2） | 统一到实现已消费的字段名 |
| R-7 | 多 PR 并发改 `index.js`/`locales`/`preload` | 中 | 冲突、zh/en 不成对 | 每个 PR 自带 zh+en；worktree 隔离 | rebase，冲突「两侧都保留」 |

---

## 11. 验收判据（可机械验证）

**逐条编号的完整断言清单在 `TEST-PLAN-PLATFORM-TAXONOMY-2026-10-13.md` §4 与 §6**（判据只允许一处真源，
避免两文档漂移）。本节只列**放行条件**：

| 范围 | 放行条件（每条都可由命令/断言判定） |
|---|---|
| **P0-1 转换器** | exit 0 且**连跑两次产物 SHA-256 相同**；`11623/64/28` 与 `9/6/1269` 两组计数全中；`platforms` 键**恰好 6 个**且等于 `{bilibili,douyin,baijiahao,weibo,zhihu,tencent_video}`；8 个块的节点数精确等于 §2.2 表；**无 `id` 为空的节点**；`unreadable` 为 `[]`；`snapshotDate="2026-07-14"` 且 `verifiedOnline=false`；产物全文不含参考产品名；四类 fail-loud 输入（缺参数/源目录不存在/畸形结构/0 节点）均非零退出 |
| **P0-2 读取层** | `validateTaxonomy().length === 0`（**前置：删掉「块内 id 唯一」校验，U-10/A1**）；§4.2 表中的正例与**五种失败成因各一例**（含歧义）全过；`getCategories` 未收录平台返回 `[]`、缺 `contentType` 抛错、返回**深拷贝**；产物不可读时**出声**且不静默返回空表 |
| **P0-3 / P0-5 发布链** | `publisher-router.test.js` **既有用例全绿**；`category`(tid) 与 `categoryName` 同给 ⇒ 精确层胜出；无能力平台给名 ⇒ `category-unsupported` 且**不发请求**；解析失败 ⇒ `category-unresolved`；未给名 ⇒ 不新增字段；每个接入平台有一条**请求体形状断言** |
| **P0-4 注册表 / 渲染层** | `validateRegistry()` 空；6 个平台的 `uiOnly` 字段含 `categoryName`；`normalizePlatformOverrides` **不丢弃** `categoryName`（防「UI 可编辑但发布不生效」）；`semantic:'category'` 由 `semiCommon` 移入 `common` 的快照断言已更新并写入 PR 描述；preload 重打包后 bundle 含新通道；IPC 通道已登记进 `01-docs/ipc-manifest.md` |
| **全局门禁（每个 PR）** | `classify-docs-only.js` 判 `false`（含代码 ⇒ 走完整质量节拍）；`check-no-brand-residue.js` 通过；zh/en 成对；`check-text-encoding-integrity.js` 通过；改 `electron/**` ⇒ QM-1 打包；`check-unwired-tests.js` 通过 |

---

## 12. 待确认与阻塞项

| U | 事项 | 阻塞什么 | 解除方式 | 不解阻时的降级 |
|---|---|---|---|---|
| **U-1** ⛔ | **`tencent_video` 平台 id 冲突**：`platforms.yaml` 写 `tencent_video: id 21, name 视频号`，但数据集两份文件（`mediadatamgr.ini` + `media_url_list.txt`）**双处一致**地写着 **21 = 腾讯视频**、**53 = 视频号** ⇒ 若我们的 slug 指视频号，则 `tencentvideocategortmap.txt`（腾讯视频）**不是它的分类表**，映射即错 | P0-1 的 `tencent_video` 映射 | 确认该 slug 指哪个平台（看 `shipinhao.js` 适配器实际打的接口域名） | **P0-1 不导入 `tencent_video`**（与其挂错不如不挂）；`platformsWithoutIdData` 不含它，档位记 `absent` |
| **U-2** | 注册表 4 项标签（124/231/207/251）与快照矛盾，**谁对未知** | §8.2 的 ID 展示与选项文案 | 联网校验或真机发布一条带分类的内容 | 选择器**只显示快照 `name`**，旧 `options` 保留但标注来源差异；**不覆盖**注册表（避免反向破坏） |
| **U-3** | **P0-5 平台选型**：PLAN 写 `baijiahao + toutiao`，但 `toutiao` 是 dom-only **且** name-only，本项在它身上双重空转（§2.1 结论三） | P0-5 的 2h 预算是否有产出 | 改为 `baijiahao` + `douyin`（或 `bilibili`） | `toutiao` 只做 UI 文案⑤，不做适配器改动 |
| **U-4** | 数据前缀 `weixin`（411 节点，仅名称）对应**微信公众号**还是**微信视频号** | `wechat_mp` 的档位说明准确性 | 读参考产品 `config.ini`（仓内副本无此文件）或用 id 表反查 | 只写 `vendor-provides-names-only`，**不写「公众号」字样** |
| **U-5** | 产物实际体量（预估 ≤1.5 MB） | 打包体积与加载耗时 | 跑一次转换器 | 远超预期 ⇒ 按 `contentType` 拆多文件 |
| **U-6** | YouTube `"22"` 默认值的正确性 | 无（本轮不动） | 官方 API 分类表或联网校验 | 保持 `"22"` 并登记为遗留项 |
| **U-7** | 入库参考数据副本（`01-docs/research/…/platform-data/`，134 个文件）的**许可边界** | 长期合规，不阻塞 P0 | 项目负责人/法务确认 | 转换器**不依赖它**（依赖仓外原件），副本仅作只读参考 |
| **U-8** | 原始文件编码统计的三口径不一致（51 / 54 / 132） | 无（转换器逐文件实测） | 转换器 stdout 的实测分布 | 以实测为准，不引用任何转引数字 |
| **U-9** ⛔ | 在飞 TDD 测试 `scripts/import-platform-taxonomy.test.js` 的三处偏差：① `withData.length >= 7`（实测应为 **6**）；② `makeFixture(...,'gbk')` 用 `Buffer.from(content,'binary')` 写的是 **latin1 而非 GBK**，**测不到 GBK 分支**；③ 未覆盖「同目录混编码」 | P0-1 的测试有效性 | 见 Test Plan §2.5 与 §4.1 的修正清单 | **不放行**：形态与编码两条防线是本项的核心风险（历史少算 67% 的直接成因） |
| **U-10** ⛔ | **在飞读取层（`packages/shared-utils/src/platform-taxonomy.js`，324 行，2026-10-13 23:50 写入）与 ARCH/PLAN/本文的分歧**，3 处阻塞：**(a)** `validateTaxonomy():289` 校验「块内 `id` 唯一」⇒ 真实数据客观重复（3 + 8 组）⇒ **`validateTaxonomy()` 永远非空**，PLAN P0-2 判据 ① 不可满足；**(b)** 顶层字段用 `version`/`platformsWithoutIdData`/`stats`，**无版本 fail-closed**，而 ARCH 用 `schemaVersion`/`coverage[]`/扁平计数 ⇒ **三方字段名不一致，P0-1 的产物形状仍未冻结**；**(c)** `loadTaxonomy` 明确「任何失败都不抛」（`:62`），与 ARCH §3.3 / PLAN P0-2 判据 ⑦ 相反。非阻塞 4 处：`resolveCategoryId` 返回 `ok/reason/hint`（本文已按此定档）、`getCategories` 缺 `contentType` 抛错（本文采纳）、深度字段名 `depth`（ARCH 写 `level`）、`path` 是数组（本文采纳）；另 `searchCategories` 空关键词返回 `[]` | P0-1 产物形状 + P0-2 判据口径 + 渲染端取数路径（A11：模块被渲染进程打包链引用与 IPC 方案冲突） | 拍板三项：① 删 `id` 唯一校验、补 `path` 唯一校验；② 冻结顶层字段名（建议采纳实现已消费的那套）；③ fail-closed 的位置（建议：宽容读 + `__loadError` 进 `validateTaxonomy()` + error 日志，即「不炸链路但绝不静默」） | 三项**必须在 P0-1 出产物前定稿**，否则转换器按一套字段名产出、读取层按另一套消费 ⇒ **运行时读到空表且不报错**（最坏形态，R-6） |

---

## 13. 交叉引用与术语

### 13.1 与配套文档的引用关系

- `ARCH-REUSE-INTEGRATION-2026-10-13.md` §3 —— **唯一设计真源**。三处**刻意分歧**见 §4.3（查表失败 ⇒ 失败而非静默）、
  §5.3/§5.4（字段名与 `contentType` 取代 `channel`）、§6.2/§6.3（fail-closed 的位置，U-10）。
- `PLAN-REUSE-ROLLOUT-2026-10-13.md` §2/§8/§10 —— 任务编号（P0-1~P0-5）、风险合规（C-1~C-7）、不做清单（X-1~X-11）
  的对齐依据；本文对 P0-5 选型提出修正（U-3）。`REUSE-CATALOG-2026-10-13.md` C-01 —— 资产登记，本文补充其三档拆分。
- `PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md` §1.1 —— P0-4 必须复用的声明式注册表机制（**禁止**新增
  `if (platform.id === 'xxx')`）。`PRD-API-PUBLISH-ENGINE.md` —— P0-5 的引擎侧取用点。
  `PRD-SMART-TAG-SUGGEST-2026-08-31.md` —— 引用了同名孤儿文件 4 处，本文不删不改（O-4）。
- 数据集拆解报告（`01-docs/research/competitor-reverse-2026-10-13/`，文件名含参考产品字样）—— 形态与规模的转引来源；
  **本文所有数字均经本次直读复核**。⚠️ `01-docs/platform-publish-options-audit/REPORT.md:79` 的「B站 tid 恒 17」
  与「B站 `has_api:false` ⇒ 走 RPA 通用流程」**已被本次核实推翻**（`bilibili-video.js:77` 实为 `|| 21`；
  `platforms.yaml` 现为 `has_api:true, publishMode:api-then-dom`），引用时须注意时效。
- `AGENTS.md` —— 门禁（QM-1/QM-2、Gate 7 locale、品牌残留、`check-unwired-tests`）与 fail-closed / fail-loud 纪律。

### 13.2 术语（与 ARCH §11.2 共用；此处只登记新增项）

| 术语 | 定义 |
|---|---|
| **分类集 / contentType** | `article`（图文）/ `video`（视频）两套**独立**的平台分类体系。同一 ID 在两者下含义可不同（`bilibili` 21 = 萌宠/日常）。**取代** ARCH §3.2 的 `channel` 字段名 |
| **id 文件 / name-only 文件** | `*categortmap.txt`（带平台侧 ID）/ `*subcategort.txt`（只有名称）。后者只用于计数对账，不进产物 |
| **档位 / variant** | 平台分类能力三档：`id`（可 API 提交）/ `name-only`（只有名称）/ `absent`（数据里没有） |
| **逐文件双解码试探** | UTF-8 严格解码优先，失败则 GBK + U+FFFD 计数为 0；两者皆非 ⇒ 判为不可读（**不猜**）。**禁止**按目录或扩展名批量判定。⚠️ **顺序不可交换**：UTF-8 文件被误按 GBK 解码时 U+FFFD 计数同样可为 0（本次实测 4 样本中 3 个为 0） |
| **形态无关遍历** | 按「ID 类键 / 名称类键 / 子节点类键」的**存在性**递归，而非枚举已知形态名 |
| **`path` 唯一性** | 产物唯一可断言的强不变量：`path` 在 `(slug, contentType)` 内唯一（实测 1,269/1,269）。`id` 与 `name` **均不唯一**，不得承担该角色 |
| **FL-n / S-n / U-n** | fail-loud 清单项（§6.3）/ 允许静默项（§6.3）/ 待确认项（§12），`⛔` 为阻塞 |

---

## 14. 实施期实测修正（2026-10-13，实现 P0-1/P0-2 后回填）

本节记录**实现过程中实测出来、与本文档早前假设不符**的事实。它们改变实施范围，故保留在案而不是
悄悄改掉上文 —— 上文保留原判断，便于回溯「谁在什么时候基于什么改了它」。

### 14.1 P0-3「路由接线」的真实范围只有 2 个平台（原写 `baijiahao + toutiao`）

全仓 grep 实测，**只有 3 处**真正从 `taskData` 读分类：

| 位置 | 代码 | 该平台有分类 ID 数据？ |
| --- | --- | --- |
| `packages/api-publish-engine/src/adapters/youtube.js:85` | `categoryId: taskData.categoryId \|\| "22"` | ❌ 数据集无 `youtube` ⇒ **出范围** |
| `packages/api-publish-engine/src/publish/platforms/baijiahao-article.js:151` | `params.set('category', String(taskData.category == null ? '未分类' : taskData.category))` | ✅ 386 节点 |
| `packages/api-publish-engine/src/publish/platforms/bilibili-video.js:77` | `tid: Number(taskData.category \|\| taskData.tid) \|\| 21` | ✅ 142 节点（视频）+ 38（图文） |

⇒ **P0-3 接线目标 = `bilibili` + `baijiahao`。**
`adapters/toutiao.js` **根本不读分类字段**，且 `getPlatformOverrideFields('toutiao')` 为空
⇒ 原 PLAN 的 P0-5 在 toutiao 上是空转。

**并纠正一处更早的漏项**：项目里共有**三个**硬编码分类默认值，不是两个 —— 除 `tid || 21` 与
`categoryId || "22"` 外，还有 `baijiahao-article.js:151` 的 `'未分类'` 字面量。它同属
「用户没选 ⇒ 静默落到某个值」，而「未分类」是否为百家号侧合法分类**本数据集无法判定**，须在 P0-3 一并处置。

### 14.2 有 ID 数据的平台是 6 个，不是 7 个 —— `tencent_video` 刻意移除

`config/platforms.yaml:93-98` 自带警示：

```
# ⚠️ 命名澄清：本条的 id 是 `tencent_video`，但 name 是「视频号」、publish_url 指向
# channels.weixin.qq.com —— 实际发布目标是**微信视频号**，不是腾讯视频（v.qq.com）。
# 频率策略表里 `tencent_video` 同样指视频号；腾讯视频（v.qq.com）未接入。
```

而数据集里 `tencentvideocategortmap.txt` 属于**腾讯视频**（`mediadatamgr.ini` 实测
`21=腾讯视频`、`53=视频号`）。把腾讯视频的分类 ID 挂到微信视频号上 = **发错平台**。
⇒ 转换器**刻意不导入** `tencent_video`，并把它登记进 `platformsWithoutIdData`。

最终产出：**6 平台 / 1,601 节点**（bilibili 38+142、douyin 27+245、
toutiao 85+380+75、baijiahao 386、weibo 190、zhihu 33）。

### 14.3 源数据自身有歧义，读取层必须拒绝解析而不是猜

| 现象 | 实测证据 | 处置 |
| --- | --- | --- |
| 同一 **id** 配不同 **name** | B站视频表 `tid=36` 同时是「知识」与「科技」（一级分类里 36 出现两次）；`tid=95` 是「数码」也是「手机平板」 | 两侧都保留 + 打 `ambiguous` 标 + 记入 `source.conflicts`；`resolveCategoryId` 返回 `reason:'ambiguous'` 并列候选 |
| 同一 **name** 不同 **id** | B站「日常」图文 `id=15` / 视频 `id=21`，且 `path` 都是 `[生活, 日常]` | 由 `contentType` 维度隔离 —— **这是 contentType 不可省的第二重理由** |
| 完全重复的 `(id,name)` | 百家号源文件里「教学」出现 42 次，共 53 条多余 | 去重（无信息噪音） |

`source.conflicts` 与读取层判定的 `ambiguous` **必须一致**，已有契约测试锁定（两处不能各说各话）。

### 14.4 逐文件解码顺序不可交换 ⇒ **必须 UTF-8 优先**（实测补强）

4 个样本中 3 个「UTF-8 文件被误按 GBK 解码」时 **U+FFFD 计数同样为 0** ⇒
「没有替换字符」**不能**用来证明「按 UTF-8 解是对的」。判定顺序固定为
**先试严格 UTF-8（失败抛错）→ 再按 GBK**；反过来会静默产出乱码且不报错。

### 14.5 读取层的失败语义（口径冻结）

`loadTaxonomy` **不抛异常**（分类是增强能力，不该炸掉发布链），失败时返回空壳并把原因放进
`__loadError`，由 `validateTaxonomy()` 报出。**这是「宽容读 + 绝不静默」，不是「宽容读 + 装作没事」** ——
差别在于 `__loadError` 是否可达、是否被自检覆盖。已有测试锁定
「文件缺失 ⇒ 档位 `absent` 且 `validateTaxonomy()` 含 missing 提示」。

### 14.6 仍未核实的项（不假装已闭合）

- `toutiao` 的 `overrideFields` 为空，是「本就不支持」还是「注册表漏登记」—— 未核，P0-4 前须定。
- 注册表里 bilibili 的 10 项下拉有 4 项标签与快照矛盾（124/231/207/251）—— 谁对未知。
- 数据集为 **2026-07-14 冻结快照，全程未联网校验**（`source.verifiedOnline: false`）。

---

## 15. P0-3 后半段：「名字 → ID」的解析该放在哪一层（2026-10-14 定案）

§14.1 确认了真实接线目标只有 `bilibili` + `baijiahao`，P0-3 前半段的**守卫**已落地
（`api-publish-engine` 的 `publish/category-resolver.js`：非合法平台侧 ID 即抛 `CATEGORY_UNRESOLVED`）。

但「让用户按**中文名**选分类」还需要一步：**把名字解析成 ID**。这一步放哪一层，有三条约束把它挤到同一个答案：

### 15.1 三条约束（逐条实测）

**① 不能放 `api-publish-engine`。**

`cloud-accounts/validate-account.js:84-89` 明写本包是可独立打包的**零 workspace 依赖运行时**
（见 `package.json` 的 `files` 与 Docker runner 的 COPY 清单）⇒ 拿不到 `shared-utils.platformTaxonomy`。

**② 也不能放 desktop 的形状翻译层。**

`apps/desktop/electron/services/api-task-data.js` 是**薄转发**，文件头自带禁令：

> ⚠️ 权威实现在 `@multi-publish/api-publish-engine` 的 `src/publish/task-data.js`，本文件只做转发。
> **请勿在此重新实现形状翻译。**

理由是**三路共用**同一个 `taskData` 构造器：

| 路径 | 位置 |
| --- | --- |
| API 直调 | `apps/desktop/electron/services/publisher-router.js` |
| API-first 分支 | `apps/desktop/electron/services/rpa-view-manager.js` |
| HTTP 发布 API | 本包 `publish-api-server` 的 `/api/v1/publish`、`/api/v1/batch-publish` |

在 desktop 侧加解析 ⇒ 只覆盖前两条，HTTP 那条漏掉，**等于埋下第三份实现**（正是 2026-09-28
形状漂移事故的同型风险）。

**③ 引擎里的 `task-data.js` 只透传，不改语义。**

`PASSTHROUGH_KEYS` 含 `category` / `categoryId`，`buildApiTaskData` 对它们**原样透传**。
把解析塞进去会让一个「形状翻译器」悄悄承担语义解析，且它同样拿不到分类表。

### 15.2 定案：解析放在**渲染端的分类选择处**

```mermaid
flowchart LR
  A["用户选分类（渲染端）<br/>按中文名"] -->|"resolveCategoryId(platform, name, {contentType})"| B["得到平台侧 ID"]
  B --> C["article.category = ID"]
  C --> D["buildApiTaskData<br/>（引擎·三路共用·仅透传）"]
  D --> E["平台链<br/>category-resolver 守卫：非 ID 即抛"]
  F["HTTP API 外部调用方"] -->|"必须直接给 ID"| C
```

**为什么这是唯一不产生重复实现的位置**：

1. **只有渲染端在「用户选分类」的那一刻同时知道** `platform`、`contentType`（图文/视频）、
   以及用户看到的**中文名** —— 三者缺一不可（§1 已论证 `contentType` 不可省）。
2. **渲染端已有 `*.browser.js` alias 先例**（`safe-http-url.browser.js`、`platform-definitions`、
   `publish-capabilities` / `account-name-guard`），由 `apps/desktop/vite.config.js` 指过去。
   本项照此先例加 `platform-taxonomy.browser.js` 即可，**不需要新机制**。
3. **HTTP API 的外部调用方本就该给 ID** —— 它能拿到的是平台 API 文档里的数字，
   不是我们的中文快照名。这条写进 §15.3 的契约。

### 15.3 `article.category` 的字段契约（冻结）

| 项 | 约定 |
| --- | --- |
| **类型** | 平台侧数字 ID 的十进制字符串（如 `"21"`）；空/未提供 ⇒ 平台默认值 |
| **不接受** | 中文分类名、`"未分类"`、小数、十六进制 —— 传了会在平台链处**抛 `CATEGORY_UNRESOLVED`** |
| **谁负责翻译** | 渲染端（用 `resolveCategoryId`）；HTTP API 调用方自己给 ID |
| **失败语义** | 用户明确选了但解析不出（`not-found` / `ambiguous` / `content-type-mismatch`）⇒ **该平台发布失败并提示**，不回落默认分类 |
| **平台无数据时** | `platform-absent` / `platform-name-only` ⇒ 该平台不渲染分类选择器，走平台默认值（**不是错误**）|

### 15.4 与 §14.1 的关系（别混淆两件事）

| | 前半段（已落地，PR #3505）| 后半段（本节，待做）|
| --- | --- | --- |
| 位置 | 平台链（`api-publish-engine`）| 渲染端（`apps/desktop/src`）|
| 做什么 | **守卫**：给了非 ID 就抛 | **翻译**：把用户选的名字转成 ID |
| 没有它会怎样 | 静默发到默认分类（**已在修**）| 用户只能填数字 ID（体验差，但不会错）|

**⇒ 前半段是正确性问题，后半段是易用性问题。** 前半段单独上线即已消除「静默发错分类」，
故两者可分 PR 推进，不必绑定。

### 15.5 后半段的落地清单（供实施者）

1. `packages/shared-utils/src/platform-taxonomy.browser.js` —— ESM 孪生 + vite alias（照
   `safe-http-url.browser.js` 先例；CJS 版用 `require`，浏览器版必须能被打包器静态分析）。
2. 分类选择器组件：平台不支持时**不渲染**（不是渲染成空下拉）；`ambiguous` 时**列出候选让用户选**，
   不替用户挑。
3. i18n 文案按 §8 的 `publish.category.*` 键写入 `apps/desktop/src/locales/{zh,en}.js`（**成对**，
   CI Gate 7 `check-locale-sync.js` 拦截）。
4. 回归锁：① `resolveCategoryId` 的 browser 孪生与 CJS 版**同输入同输出**（parity 锁）；
   ② 选择器在 `platform-absent` 平台**不渲染**；③ 选中后 `article.category` 必须是纯数字串。

## 16. P1-1 / P1-2 落地回填（2026-10-14）

> 本节与 §14/§15 同体例：写**实测出来的东西**，不写计划里的设想。凡与 PLAN 原文不一致处，以本节为准并给出理由。

### 16.1 P1-1：平台指标矩阵（「这个平台能拿到哪些指标」）

**产物**：`config/platform-metric-matrix.json`；转换器 `scripts/import-platform-metric-matrix.js`；
读取层 `packages/shared-utils/src/platform-metric-matrix.js`。

#### 16.1.1 ★ 为什么必须是**二维**结构

厂商源文件 `mediadatamgr.ini` 有**两个段**，且**同名不同义**：

| 段 | 语义 | id=1 | id=3 | 厂商平台数 |
| --- | --- | --- | --- | --- |
| `[1]` | 内容数据 | **总收益** | 图文总阅读数 | **31** |
| `[2]` | 趋势数据 | **收益** | 播放 | **27** |

**压成「平台 → 指标」一维会让两者互相覆盖**（`id=3` 在 `[1]` 是阅读数、在 `[2]` 是播放，
同名不同义）。故产物按 `groups`（组 → 平台 → 指标 id）组织，`metricKeyMap` 也**按组分开**。

> 与 §1 同一条纪律的第二次应用：**字段名相同 ≠ 语义相同**。第一次用在图文/视频两个分类链上，
> 这次用在两个指标段上，下次遇到同类结构先问「这是不是两个命名空间」。

#### 16.1.2 覆盖范围（与 P0-1 同一条纪律）

用户明确要求「**ID 值先只覆盖我的项目目前支持的这些自媒体平台**」。故：

- 收录 **10 个**本项目支持的平台；
- **未映射的 22 个厂商平台如实登记**进 `source.unmappedVendorPlatforms`，**不静默丢弃**
  （静默丢弃会让「厂商没有这个平台」与「我们没做映射」不可区分）。

#### 16.1.3 ★ 一处刻意的小心：`tencent_video` 取厂商 **53（视频号）**，不是 21

厂商矩阵里 21 与 53 是**两个不同平台**：

| 厂商 id | 是谁 | `[1]` 声明 |
| --- | --- | --- |
| 21 | 腾讯视频 | 1, 6, 7 |
| **53** | **视频号** | 6, 7, 8, 9, 10, 11 |

本项目 `config/platforms.yaml:93-98` 明写 `tencent_video` 是**视频号**、指向 `channels.weixin.qq.com`。

> **对照**：P0-1 的分类表只有「腾讯视频」的，故那里**排除**了 `tencent_video`；
> 这里两者都有，故**接入**且取 53。**两处结论相反，依据同一条纪律。**

#### 16.1.4 读取层的三态与两种未知（**这是 UI 文案的依据**）

| 取值 | 含义 | UI 该说什么 |
| --- | --- | --- |
| `declared-available` | 厂商声明有 | 正常显示数值 |
| `declared-unavailable` | 厂商声明**没有** | 「平台不支持」 |
| `unknown-platform` | **我们不认识这个平台** | 「未知平台」 |
| `unknown-metric` | 认识平台、不认识这个指标 | 不显示该列 |

**★ `unknown-platform` 必须与 `declared-unavailable` 分开**：合并会让「我们没查过这个平台」
显示成「这个平台没有这个指标」——**对用户是假信息**。

#### 16.1.5 ★★ 实现纪律（写进接口文档与模块头注）

**`undeclared-but-present` 不是错误。** 矩阵是**厂商的能力边界**，不是本仓的。本仓实测能拿到的，
即使厂商没声明也**应采信实测**；反过来（声明有、实测 `null`）才值得告警。

**不得用于请求门控** —— 只用于 UI 文案 + 测试交叉校验。用它做门控会让「厂商矩阵不全」
变成「本仓拿不到数」，**是方向错误的依赖**。

#### 16.1.6 验收判据（PLAN P1-1 六条，全部通过）

| # | 判据 | 结果 |
| --- | --- | --- |
| ① | `validateMatrix()` 无问题 | ✅ |
| ② | `getMetricSupport('kuaishou','income') === 'declared-unavailable'` | ✅ |
| ③ | `getMetricSupport('baijiahao','income') === 'declared-available'` | ✅ |
| ④ | **未知平台返回 `unknown-platform`**（不是 `declared-unavailable`）| ✅ |
| ⑤ | 未收录平台 `getPlatformMetricCapabilities` 返回 `[]` **而非 `null`** | ✅ |
| ⑥ | 变体反证：改坏 `unknown-platform` 分支 ⇒ **测试必红** | ✅ 见 §16.1.7 |

#### 16.1.7 ★ 判据⑥的形态变更：从「子进程变异反证」改为「结构锁」——**理由与残余风险**

**原设计**：spawn 一个子进程跑被变异的模块副本，证「改了就红」。

**实测撞上一条 required 门禁**：`scripts/check-test-egress-ledger.js` 把测试期**起过的子进程**
逐条落盘、与基线比对，**出现基线之外的键即红** —— 子进程版让 `QG Unit Tests` 报 `+ child::net` 而判红。

**归因尝试**：查了 CI 日志（只有 `git` / `mp-sink-*-cmd` 的 spawn 告警，**没有 `net`**），
本地按同口径跑只产生 3 个键、**没有 `net`**、判定 PASS ⇒ **无法有把握归因**。

**处置**：按「归因不清就不硬猜」——**不登记基线、不编理由，直接移除子进程**。
把不确定的东西登记进基线，等于把门禁的棘轮松开。

**现在的形态**（`platform-metric-matrix.test.js`，共 28 例）：

| # | 断言 |
| --- | --- |
| ① | `unknown-platform` 由 `isKnownPlatform` 的否定分支**直接**返回 |
| ② | 该分支在 `unknown-metric` 与 `declared-unavailable` **之前**（顺序反了会误判）|
| ③ | 白名单恰好四值，且四值都能从公开 API 观察到 |
| ④ | 判据**不是重言式**：真实做一次字符串变异，断言变异体确实不满足 ① |
| ⑤ | 本文件不再起子进程（防这条门禁再次被判红）|

**★ 残余风险（不假装已闭合）**：结构锁**证不了**顺序或语义的细微改动 ——
改宽判据会让 ① 直接失败，**但仅此而已**。

**子进程版的历史代价**（写进注释，免得有人再试）：
① 探针落在 vitest include 之外 ⇒ 跑出 `No test files found` 这种**环境红**，反证等于没做；
② 探针包含本节自身 ⇒ **递归 spawn**，实测单次 **163 秒**、留下 **8 个残留文件**。

### 16.2 P1-2：账号快照的能力字段（把界面上的 `-` 拆成三种东西）

**产物**：`apps/desktop/electron/services/account-metrics/capability.js`；
接入 `account-metrics/index.js`；测试 12 例。

#### 16.2.1 要解决的问题（显示项与提示文字）

账号快照里某指标没值时，界面此前**只能显示 `-`**。但 `-` 把三种完全不同的情况混成同一个样子：

| 情况 | 数据来源 | **应该显示** |
| --- | --- | --- |
| 平台根本没这个指标 | `declared-unavailable` | **「平台不支持」** |
| 平台有、这次没采到 | `declared-available` + 实测空 | `-` / **「暂无」** |
| 我们压根不认识这个平台 | `unknown-platform` | **「未知平台」** |

**⇒ 用户据此才知道：是该换个平台，还是该重试。** 三条文案的 i18n 键待渲染端接入时按 §8 体例登记
（`metrics.capability.*`，zh/en 成对，CI Gate 7 `check-locale-sync.js` 拦截）。

#### 16.2.2 冒烟测试**抓出的两个设计缺陷**（都已修，值得记下来）

**缺陷一：不支持列表恒为空。**
第一版只遍历「该平台**声明过**的指标」再问三态 —— 可是 `kuaishou` 声明的指标里
**根本不含 `income`**，于是永远问不到「它不支持什么」，`unsupportedMetricKeys` 恒为 `[]`，
**UI 说不出「该平台没有收益指标」这句话**。
**修**：遍历**全矩阵指标并集**（17 个）。

| 平台 | 可用 | 不支持（修前恒为空）|
| --- | --- | --- |
| `baijiahao` | 16 | `impressions` |
| **`kuaishou`** | 11 | **`income, incomeYesterday, readTotal, readYesterday, playTotal, impressions`** |
| `xiaohongshu` | 12 | `income, incomeYesterday, readTotal, playTotal, impressions` |

**缺陷二：`declared-but-null` 报 17 条噪声，把真信号埋掉。**
第一版按「矩阵声明过」校验，而适配器目前**只解析少数几个**指标 —— 其余十几个声明指标
全被判成「声明有但实测空」。**这条判据的全部价值就在于让真信号可见**，噪声一多等于没有。
**修**：只校验**适配器这次真的碰过**的键（键出现在任一 item 的 `metrics` 对象里即算碰过，
`null` 也算 —— 那正是要抓的情况）。**17 条 → 1 条。**

#### 16.2.3 数据校验规则（`checkMetrics`）

| 判定 | 含义 | 是否入结果 |
| --- | --- | --- |
| `declared-but-null` | 适配器**解析了**该键、值全空 ⇒ **可疑**（声明过期或解析漏了）| ✅ 入 |
| `undeclared-but-present` | 厂商没声明、适配器**解析出了值** ⇒ **不是错误**（实测优先）| ✅ 入 |
| `consistent` | 声明与实测一致 | ❌ 不入（避免噪声）|
| `unknown` | 无从对账 | ❌ 不入 |

「多条作品里只要有一条有值」就不算 `declared-but-null`（已断言）。

#### 16.2.4 ★★ 它**不是**请求门控（再次强调，因为这里最容易写错）

见 §16.1.5。适配器**不得**改成「先查矩阵再决定要不要请求」。

#### 16.2.5 验收判据（PLAN P1-2 三条）

| # | 判据 | 结果 |
| --- | --- | --- |
| ① | `capability` 字段进入账号快照 | ✅ `entry.capability` |
| ② | 缺指标区分「平台不支持」而非 `-` | ✅ `unsupportedMetricKeys` 非空（见 §16.2.2 表）|
| ③ | 每平台一条 `reconcileObservation`，声明有而实测 `null` 必须被命中 | ✅ 精确断言；且只报真信号 |

### 16.3 与 PLAN 原文的偏差登记

| 项 | PLAN/设计原文 | 实际 | 理由 |
| --- | --- | --- | --- |
| P1-1 指标矩阵结构 | 未指定维度 | **二维**（组 → 平台 → 指标）| 源文件两段同名不同义，一维会互相覆盖（§16.1.1）|
| P1-1 `tencent_video` | 未指定 | 厂商 **53（视频号）** | `platforms.yaml` 明写它是视频号；21 是腾讯视频（§16.1.3）|
| P1-1 判据⑥ 形态 | 变体反证 | **结构锁 + 行为锁** | 子进程版撞 required 的 egress 台账门禁，无法有把握归因（§16.1.7）|
| P1-2 `capability` 形状 | 未指定 | `{state, metrics[], availableMetricKeys[], unsupportedMetricKeys[]}` | UI 需要能直接判「未知平台 ≠ 全不支持」（§16.2.1）|

### 16.4 本节未覆盖的（如实登记）

- **渲染端尚未接入**：§16.2.1 的三条文案键还没有 UI 消费方 —— P1-2 只把**数据**送到了快照里，
  界面改动属后续任务（§15.2 的 browser 孪生先例可直接复用）。
- **指标矩阵不是请求门控**，故「本仓实际能拿到哪些指标」这个问题**仍未由本产物回答** ——
  它回答的是「厂商声称能拿到哪些」。真实能力要靠采集结果反推（这正是 `checkMetrics` 的用途）。
- **P1-2 的能力描述按平台计算，不按账号**：同平台不同账号的权限差异（如未开通收益）
  不在矩阵表达范围内。



