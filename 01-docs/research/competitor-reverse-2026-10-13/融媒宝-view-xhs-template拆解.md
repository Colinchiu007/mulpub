# 融媒宝 `view-xhs-template` 模块拆解报告

- **分析时间**：2026-10-13
- **分析对象**：`D:\Program Files (x86)\融媒宝\Asset\dist\view-xhs-template\`（只读，未修改源文件）
- **分析目的**：为 mulpub（Electron 多平台内容发布）寻找可复用技术点
- **方法**：全量静态阅读（无运行、无反编译）。任务书指定的 11 个文件 100% 逐行读完；宿主侧 `view-smart-clip/js/clientApi.js`、`common/request.js`、`js/utils.js`、`js/storage.js` 按需精读

> **证据纪律**：每条结论均带 `文件名:行号`。推测一律以「**推断：**」开头并给依据；未确认事项见 §11。

## 目录

1. [文件清单](#1-文件清单) ｜ 2. [结论速览](#2-结论速览) ｜ 3. [问题一：模块定位](#3-问题一模块定位) ｜ 4. [问题二：`config.js` 实质](#4-问题二jsconfigjs-的实质) ｜ 5. [问题三：交互流程与调用链](#5-问题三交互流程与调用链) ｜ 6. [问题四-A：`lineBreaks.js` 逐函数](#6-问题四-ajslinebreaksjs-逐函数) ｜ 7. [问题四-B：`calculateContainers.js` 逐函数](#7-问题四-bjscalculatecontainersjs-逐函数) ｜ 8. [问题五：宿主通信](#8-问题五它怎么和宿主通信) ｜ 9. [问题六：可借鉴点](#9-问题六值得-mulpub-借鉴的实现) ｜ 10. [问题七：坑与缺陷](#10-问题七明显的坑与缺陷) ｜ 11. [未确认事项](#11-未确认事项) ｜ 12. [纠正记录](#12-纠正记录)

---

## 1. 文件清单

### 1.1 目标模块（11 个必读文件全部读完）

| 文件 | 字节 | 行数 | 角色 |
|---|---|---|---|
| `index.html` | 22,156 | 744 | Vue3 外壳 + 全部 DOM 模板 + 脚本装载顺序 |
| `js/config.js` | **63,055** | **2,173** | 模板排版规则 `_ruleList` + 模板目录 `_templateList` |
| `main/methods.js` | **43,935** | **1,740** | 主逻辑（`MethodsUtil`，Vue methods 全量） |
| `js/creation.js` | 17,879 | 679 | AI 文本→结构化条目；DOM 渲染；高亮/选区工具 |
| `js/lineBreaks.js` | 13,848 | 531 | 选区→视觉行映射（划重点用） |
| `js/calculateContainers.js` | 12,257 | 485 | **自动分页引擎**（测量+装箱+二分切分） |
| `main/create.js` | 6,527 | 262 | Vue 装配、生命周期、BroadcastChannel |
| `js/mock.js` | 3,972 | 55 | 2 段测试文案 |
| `main/data.js` | 3,535 | 152 | 响应式初值 `_data` + 持久化键 `_dataKey` + `spanStyle` |
| `js/base.js` | 3,134 | 221 | 枚举常量（图片/分类/划重点/字体） |
| `js/request.js` | 700 | 35 | 3 个 HTTP 封装 |

配套：`css/{index.css 21888, index.scss 13988, font-family.css 3387, highlight.css 909, loading.css 1547}`、`icon/*.svg` 21 个、`img/*.png` 7 个。注意 `css/index.scss`（源文件，13,988 字节）与构建产物 `index.css` 同时进了发行目录。

### 1.2 直接依赖（模块外）

`view-smart-clip/js/clientApi.js`（445 行，定义全局 `interface`，**本模块是它的 iframe 子页面**）、`common/request.js`（118 行，`POST_J`/`GET_J`/`Ajax`/全局 `TerminateButton`）、`js/utils.js`（899 行，`deepClone:517`、`generateRandomString:634`、`removeAllTags:787`、`randomSelection:866`、`isEmptyObj:897`）、`js/storage.js`（56 行，`$local`/`$session`）、`view-smart-clip/index.html`（323 行，宿主壳页）、`view-smart-clip/my-draft.html`（249 行，草稿页）。

脚本装载顺序（`index.html:727-742`）：`config.js`→`base.js`→`request.js`→`creation.js`→`calculateContainers.js`→`lineBreaks.js`→`main/data.js`→`main/methods.js`→`main/create.js`。全部是**传统全局脚本**（无 ESM/打包），跨文件函数互调依赖装载顺序——例如 `main/methods.js:1102` 用的 `GetElTotalHeight` 实际定义在 `js/calculateContainers.js:141`。

---

## 2. 结论速览

| 维度 | 结论 |
|---|---|
| 一句话定位 | 「输入主题 → AI 生成整套小红书图文 → Canvas 编辑器排版微调 → 导出 N 张 3:4 图片」的**图文卡片生成与排版编辑器** |
| `xhs` 含义 | **确认 = 小红书**（6 条独立证据，§3.1，非推测） |
| `config.js` 实质 | **23 套模板的排版几何规则 + 23 条模板目录**；不是模板 HTML、不是字段映射。运行时被远端 `templateConfig.json` 整体覆盖 |
| 核心算法 | `calculateContainers.js`：**测量驱动贪心装箱 + 二分字符切分 + 标点吸附**分页器。`lineBreaks.js` 名字像断行器，实际是**选区划重点**的视觉行测量工具，且 65% 是死代码 |
| 最值得借鉴 | ① 几何规则外置 + 测量驱动自动分页；② `box-decoration-break: clone` 跨行高亮；③ `getClientRects` 把「视觉换行」当一等公民 |
| 最严重缺陷 | ① `onElToThumbnail` catch 自递归 → Promise 永不 settle → **生成流程死锁**；②「JPG」选项实际输出 PNG 字节；③ 测量模型漏算 icon 与 margin → **渲染溢出** |

---

## 3. 问题一：模块定位

### 3.1 `xhs` = 小红书：证据确认（否证「疑似」）

6 条互相独立的证据，结论是**确认**而非推断：

1. **模块标题写中文**：`index.html:6` → `<title>AI生成红薯模版</title>`（「红薯」是小红书在创作者圈层的通用昵称）。
2. **宿主壳页注册表写死名字与 URL**：`view-smart-clip/index.html:152-156` → `{ id: 6, name: "红薯模版", url: "./../view-xhs-template/index.html" }`；同表 `id:5` 是「AI写作模版」（`:148-151`）、`id:4` 是「一键成片」（`:142-146`）。
3. **原生桥入参注释直接点名**：`clientApi.js:166-169` → `// 1、2、3混剪购买创点、4购买字符、5红薯模版购买创点`，而本模块调用点正是 `methods.js:181` → `interface.FnJsBuyCreatePoints(5)`，参数 `5` 与注释严格对应。
4. **接口路径用拼音首字母**：`js/request.js:4` → `POST_J("https://public.17van.com/dmx/xhs", data)`。
5. **埋点键与草稿分类用 XHS**：`methods.js:277` `"xhs_click_suc"`、`:1710` `"xhs_download_suc"`、`:541` `categroy:"XHSMB"`、`main/create.js:210` `$local.get("XHSMB_SOURCE")`、宿主 `clientApi.js:331-333` → `if (a === 6) localStorage.setItem("XHSMB_OPENED","1")`。
6. **画布是竖版 3:4**：`main/data.js:85-86` → `zoomElWidth:1242` / `zoomElHeight:1660`；`css/index.css:619-622` → `.zoom-container{min-width:1242px}`。
   **推断**：1242×1660（比值≈0.748）对应小红书竖版 3:4。依据：比例与业界通行的 1242×1656 同量级，且模板分类全是小红书常见选题——`js/base.js:25-46` 的 `TemplateCategory`=全部/旅游路线攻略/教培攻略/备忘录/科普攻略；`js/mock.js:1-48` 是典型小红书图文（`# 上海三天两夜怎么玩？这份保姆级攻略让你不踩雷！` + `## 🗺️ 第一天` 分节 + 结尾「**预设社交分发文案**：标题/正文/预设评论1提问式/2补充式/3共鸣式」）。

### 3.2 定位与功能

> **「AI 长文 → N 张 3:4 小红书图文卡片」的生成器 + WYSIWYG 排版编辑器 + 批量导出器**，以 iframe 子页面形式挂在融媒宝「红薯模版」一级菜单下。

| 区域 | 功能 | 位置 |
|---|---|---|
| 首页 | 主题输入、2 个推荐词（点击填入）、创点余额、按钮角标「1」、4 张预览图 | `index.html:87-125`；`methods.js:85-87`；`data.js:46-64` |
| 生成中 | 进度条 + 动态文案 + 「返回」中止 | `index.html:48-76`；`methods.js:90-98` |
| 模板侧栏/详情 | 当前模板卡片、推荐列表、4 分类筛选、展开收起；封面/内页切换预览、应用整套模板 | `index.html:278-341`、`:649-687`；`methods.js:689-693` |
| 画板条 | 切换/复制/删除画板、添加封面、添加内页；画板数上限 `maxCanvas:100` | `index.html:577-642`；`data.js:70` |
| 缩放/撤销 | 按容器算 `Math.min(w/1242,h/1660)` 并监听 resize；前进后退，栈上限 100 | `methods.js:293-309`、`:1591-1604`、`:1584-1587` |
| 文字工具 | 加粗/斜体/下划线/删除线（`base.js:173-198`）、左/中/右对齐（`base.js:200-221`，两端对齐被注释 `:216-220`） | `index.html:411-573` |
| 划重点 | 3 大类（背景/划线/圈圈，`base.js:48-61`）×每类 4 预设（首个是「取消」，`base.js:63-171`）、粗细滑杆 1-100、调色、重置 | `index.html:468-572` |
| 内联编辑 | 粘贴/拖拽纯文本、回车插 `\n` 而非 `<br>`、`Ctrl+Z/Y` 交给自定义历史 | `methods.js:1177-1198`、`:1142-1162`、`:1077-1083` |
| 模板高亮 | 用 AI 抽出的「重点词」自动套用模板预设高亮 | `methods.js:1530-1563` |
| 下载 | 类型 JPG/PNG（`base.js:1`）、尺寸 0.5/1/1.5/2/3×（`base.js:2-23`）、范围 全部/当前画板、目录更改/打开 | `index.html:171-274`；`methods.js:1624-1715` |
| 草稿 | 生成/下载后自动存；草稿页可恢复整个画布 | `methods.js:535-557`、`:560-584`；`my-draft.html:140-197` |

技术栈：Vue 3 + Element Plus 2.9.6（`index.html:16-19`）、jQuery 3.5.0（`index.html:22`，`methods.js:453` 用 `$()`）、marked（`creation.js:4`）、html2canvas（`methods.js:464`）、dayjs（`methods.js:1658`）。渲染层是 `contenteditable` + 绝对定位 div 手工搭建，**无编辑器框架**。

---

## 4. 问题二：`js/config.js` 的实质

只有两个顶层常量，无任何可执行逻辑：

| 常量 | 行范围 | 条目数 | 内容 |
|---|---|---|---|
| `_ruleList` | `config.js:1-1986` | **23** | 每套模板的**排版几何 + 字体规则 + 高亮预设** |
| `_templateList` | `config.js:1988-2173` | **23** | 每套模板的**展示条目**（缩略图 + 分类 + 默认标记） |

### 4.1 `_ruleList` 单条结构（`template03`，`config.js:89-173`，注释为原作者所写）

```js
{ id:"template03", coverUrl:".../t3_cover.png", innerPageUrl:".../t3_page.png",  // :90-92
  cover: { titleLength:18,                                        // :94 封面标题最大兼容字数
           left:189, top:276, width:864, height:660,              // :95-98
           font:{label:"字魂扁桃体", value:"ZiHun-BianTao",
                 size:180, light:220, weight:500,
                 align:"center", color:"#F386AF"},                // :99-107
           highlight:{} },                                        // :109 空=不做高亮
  title:  { titleLength:24, left:114, top:164, width:1015, height:240,
            spacing:40, font:{...}, highlight:{} },                // :111-129 内页「标题」框
  subtitle: { icon:"", iconSize:{w:60,h:60},
            spacing:24,                                           // :136 段落间距（以副标题为一段）
            ml:96,                                                // :137 副标题相对正文容器左缩进
            mb:12, font:{...}, highlight:{} },                    // :130-149
  mainText: { icon:"", iconSize:{w:0,h:0},
            left:124, top:380, width:1006, height:1070,           // :156-159
            ml:0, mb:32, font:{...}, highlight:{} } }             // :150-172
```

字段语义（全部由消费点反证）：`cover/title.{left,top,width,height}` → 绝对定位文本框几何（`methods.js:356-373`）；`cover.titleLength` → **封面能容纳的最大标题字数**，用于自动挑模板（`methods.js:229-231`）；`*.font.size`/`.light` → 字号/行高（`methods.js:364-365`、`creation.js:228-229`）；`*.font.value` → `font-family`，与 `css/font-family.css` 的 `@font-face` 名对应；`*.font.align` → `text-align`（`methods.js:368`）；`title.spacing` → 标题框与正文框间距，挂在正文框 `marginTop`（`creation.js:244`）；`subtitle.{spacing,ml,mb}` → 段落间距/左缩进/段内间距（`creation.js:352-361`、`calculateContainers.js:104-113`）；`*.highlight` → 高亮预设 `{type,id,color,size,radius}`（`methods.js:1530-1563`）。

**总量与形态**：

- 23 个 id：`template01,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,21,23,25,26,30`（`config.js:3,90,175,260,352,437,528,619,704,795,880,965,1046,1131,1216,1307,1392,1477,1562,1647,1732,1817,1902`）。**缺 02/20/22/24/27/28/29 共 7 个**——历史上增删过的编号空间，非连续全集。
- `cover.titleLength` 跨度 **12~50**（最小 `template04` `:179`；最大 `template16` `:1220`）。
- `font.value` 去重 **9 种**：`SourceHanSansCN-{Bold,Regular,Medium}`、`ZiHun-BianTao`、`HuXiaoBo NanShen`、`PangMen`、`YanShi-FoXi`、`HappyZcool-2016`、`ZhanKu-KuHei`。
- `highlight` **仅 6 处非空**：`template01.cover`（`:21-27` type1 背景 #DF0D00）、`template05.cover`（`:279-285` type2 size88）、`template07.subtitle`（`:495-501` type1 #78C4F4）、`template08.cover`（`:547-553` type2 size64）、`template10.cover`（`:723-729` type3 圈圈 radius50%）、`template16.cover`（`:1235-1241` type2 size46）。`title.highlight` 与 `mainText.highlight` 全为 `{}`。
- `subtitle.icon` **仅 2 处非空**：`template05`（`:307`，64×64，`mr:24`）、`template23`（`:1688`，72×72）。单位统一 px，设计基准宽 1242。

### 4.2 `_templateList`（`config.js:1989-1996`）

```js
{ id:"template01", category:"2", coverUrl:".../l1_cover.png",
  innerPageUrl:".../l1_page.png", isDefault:false, show:true }
```
`category` 取值 1/2/3/4 对应 `base.js:25-46`；`"0"` 是「全部」筛选项，不出现于数据。分布：cat1=3（18/25/30）、cat2=6（01/04/06/10/16/26）、cat3=7（05/07/08/09/11/15/17）、cat4=7（03/12/13/14/19/21/23），合计 23。`onChangeCategory`（`methods.js:689-693`）把筛选结果写回每条自己的 `show`，由 `index.html:327` 的 `v-show="item.show"` 消费。

### 4.3 关键机制：本地只是兜底，远端整体覆盖

```js
// methods.js:19-29
const result = await GetRuleAndTemplate()
if (result._ruleList.length)     { this.ruleList     = deepClone(result._ruleList) }     // :22-24
if (result._templateList.length) { this.templateList = deepClone(result._templateList) } // :26-28
```
`GetRuleAndTemplate` 拉 `https://static2.17van.com/images/xhs-template/templateConfig.json?timemap=1767003138952`（`request.js:14-17`）。所以这 63 KB 是**离线兜底 + 开发期默认值**，线上真值由 CDN 决定。
**推断**：`timemap` 是固定缓存击穿参数（约 2025-12-29），写死而非运行时生成 —— 等于把「模板配置更新」绑到客户端发版。依据是 `request.js:15` 里它是字面量、无任何变量插值。

### 4.4 一个易踩的语义细节

`font.label` 与 `font.value` **不一致**，说明 `label` 只给人看、`value` 才被浏览器消费：`config.js:141-142`（label「思源黑体-加粗」/ value `SourceHanSansCN-Medium`）、`:163-164` 同、`:402-403`（label「思源黑体」/ value `SourceHanSansCN-Bold`）。**推断**：改版时改了 value 忘了改 label——同一模板内同名 label 对应了 3 个不同 value。**任何按 label 做字体匹配的代码都会错**。
另：`_ruleList` 与 `_templateList` 的图片不同源——`t1_cover.png`（`:4`，排版底图，参与合成）vs `l1_cover.png`（`:1992`，列表缩略图），仅首字母之差。

---

## 5. 问题三：交互流程与调用链

### 5.1 主链：主题 → 画布

1. **输入与校验**：`index.html:87-92` 输入 → `v-model="creativeCont"`；`:111` 点「开始生成」→ `onStartCreation`（`methods.js:101`）。`:102-107` 校验非空且含非 ASCII（`/[^\x00-\xff]/`）；`:109-112` 创点 < 1 则买点弹窗 return；`:114-116` `loadingCreation=true`、`progressText="正在分析文案"`。
2. **拉模板规则**：`methods.js:117` `await onGetRuleAndTemplate()` → `request.js:12-22` GET `templateConfig.json` → `methods.js:22-28` 覆盖 `ruleList`/`templateList`。`:119-125` 起 `setInterval(350ms)` 假进度，涨到 90 自停。
3. **扣创点**：`methods.js:127` → `onCountCreationPoints`（`:188-200`）→ `DeductCreatePoint({create_num:1,type:2})` → `common/request.js:93-104` POST `interface.17van.com/UserExtend/deductCreate`。成功时 `:129-134` 广播 `{type:"Points",value:num*10}`；失败时 `:157-161` 刷新创点 + 买点弹窗。
4. **调 AI 生成正文**：`methods.js:136-145` → `AiCreationTemplate({type:11, stream:0, model:"deepseek-r1-0428", prompt:JSON.stringify({"[key1]":this.creativeCont})})` → `request.js:2-9` POST `public.17van.com/dmx/xhs`。`:147-148` 取 `result.choices[0].message.content` → `onFormatData`；失败分支 `:150-156` 取 `result.message||result.msg` 弹错并关加载。**观察**：`prompt` 只含 `"[key1]"` 一个键 → prompt 模板在**服务端**，客户端只填槽。
5. **文本结构化**（`methods.js:215-284`）：`:216` `FormatAiContent(v)`（`creation.js:2-71`）——`:73-77` `removeBeforeFirstHash` 截掉第一个 `#` 之前；`:86-114` `removeListMarkers` 剥掉 `-/*/+` 与 `1.` 列表符（保留缩进）；`:4` `marked.parse()` → HTML；`:117-128` `SplitByTagsDOM` 用 `DOMParser` 取 `body.children` 逐个 `outerHTML`；`:14-54` **硬编码标签分派**：`<h1>→titleData{type:"1"}`、`<h2>→{type:"2"}`、`<h3>→{type:"3"}`、`<p>→` 先按 `/(?=\n?\d+、)/` 再切「1、2、3、」式枚举后每段 `push({type:"4"})` + `removeAllTags`；`:57-61` 用 `createIdFactory("editable_")` 统一重发 id。
6. **选模板**（`:218-245`）：有默认模板直接用（`:218-227`）；否则在 `ruleList` 里筛 `cover.titleLength >= 标题字数`（`:229-231`），筛不出则退回 `fixedTemplateIds=["template01"]`（`:232-239`，`data.js:8`）。均用 `randomSelection("1",…)` 随机取一（`utils.js:866-894`，type1=`pickOne`）。
7. **第二次 AI 调用提「重点词」**（`:247-274`）：`:251-258` `AiCreationTemplate({type:12,…})`（同端点靠 `type` 区分）→ 成功 `SplitObtainKeywords`（`creation.js:136-147`）→ `processTitle` 找 `重点：` 且标题含该词时截断（`:150-170`）；失败 `splitTitle=[标题,""]`（`:264`）。`:267-268` 写回 `titleData.htmlStr`/`.keywords`。
8. **进画布**：`:270-277` 写 `canvasTitleData`/`canvasMainText`/`useTemplateId`/`useTemplateRules`，`pageType="Canvas"`，埋点 `xhs_click_suc`；`:279-283` `$nextTick` → `onLazyLoading`+`onInitZoomScale`+`onMeasuringContainer`。
9. **渲染**（`onMeasuringContainer`，`methods.js:312-353`）：`:315` `CreateMeasurementContainer()`（`creation.js:400-418`）建屏外容器挂 body；`:316-321` `await onRenderCover()`（`:376-429`）→ `editor-shell > img(coverUrl)` + 绝对定位 `editor-board` + `contenteditable`（含高亮 span）；`:322-325` `await onRenderMainText()`（`:432-447`）→ `getStarted(...)`（★ 分页引擎，§7）→ `RenderContainers`（`creation.js:212-344`，每页一个 `editor-shell`）；`:327-329` `await onElToThumbnail()` → 逐页 html2canvas（`scale:1`、`toDataURL("image/jpeg",0.1)`，`:464-476`）→ `thumbnailUrls`（**截断为 8**，`:328`）；`:331-333` 把 `editorShellWrap` **搬进** `.zoom-container`（测量容器只是中转站）；`:335-338` `onSaveDraft({container:innerHTML})`；`:340-352` 拆容器、`percentage=100`、100ms 后关加载。
10. **存草稿**（`onSaveDraft`，`:535-557`）：`:536` `source = session XHSMB_SOURCE==="DRAFT" ? 2 : 1`；`:537-543` `draftTitle="红薯模版-"+标题`、`categroy="XHSMB"`、`contetCover`；`:544` `_dataKey`（`data.js:131-143`，11 键）全量入草稿；`:546-549` 首次生成 `generateUUID()` 并写 session；`:551-556` `interface.FnJsSaveDraft(3, source, this.draftUuid, JSON.stringify(draftData))` → `clientApi.js:123-125` → `window.JsSaveDraft(...)`【原生桥】。

### 5.2 编辑链（划重点，技术密度最高）

1. `creation.js:421-448` `CommonBindFn` 给每个 `.editable` 绑 `focus/blur/keydown/copy/paste/drop/mouseup/keyup`；`methods.js:1201` `onEditableMouseup` → `onCheckSelection()`。
2. **视觉行校正**（`methods.js:1297-1329`，关键）：`:1307-1308` 统计选中文本里的真实换行符个数；`:1310-1321` 若 `newlineCount < 1`：`range.getClientRects()` → `mergeDomObjectsByBottom`（`lineBreaks.js:139-186`）→ `getVisualLinesFromSelection`（`lineBreaks.js:1-50`）→ 若恰好 2 组且 2 行，则把两行 `join("\n")` 当选中文本；`:1323-1328` 存 `selectionInfo{text,length}` 与 `savedRange`（`cloneRange`）。
3. `index.html:461` 点「划重点」→ `onOpenHighlightPop`（`:1259-1274`）先 `onRestoreSelection` 还原选区再开弹层。
4. `methods.js:1383-1465` `onSetHighlight(data,item,index)`：`:1409-1419` 已有同类样式则移除（`item.id!=="001"` 时还 `remove()` 外层元素）；`:1421-1445` 按类别构造样式——`data.id==="1"`（背景）→`{borderRadius,backgroundColor}`、`"2"`（划线）→`{borderBottom:"Npx solid|dashed color"}`（`007` 是 dashed）、`"3"`（圈圈）→`{borderRadius,border}`；`:1447-1450` `span.style = styleObjectToString({...commonStyle, ...spanStyle})` ← `spanStyle` 见 `data.js:145-152`；`:1455-1456` `range.deleteContents(); range.insertNode(span)`；`:1457-1461` 把 `savedRange` 指向新 span。
5. `methods.js:1468-1492` `onShowHigTool`：算 `rowIndex=floor(index/3)`、`insertIndex=(rowIndex+1)*3`，把工具条 DOM `insertBefore` 进 `.highlight-options[data-categoryId=X]` 网格（**「就地工具条」手法**）。
6. 调粗细/颜色/重置：`methods.js:1495-1527` 改 `highlightList` 对应项后**重放** `onSetHighlight`。

### 5.3 下载链（`onStartDownload`，`methods.js:1624-1715`）

1. `:1631-1637` 假进度条（同样 350ms 涨到 90）；
2. `:1639-1654` 克隆 DOM 到测量容器：范围 `"1"` 克隆整个 `.editor-shell-wrap`，`"2"` 只克隆 `[data-id=thumbnailId]`；
3. `:1656-1676` 逐页：`:1662-1663` 强制 `style.width/height=1242/1660`；`:1665-1669` `processMultipleSpans(.editable)`（`creation.js:508-515`）→ `wrapEachCharacter` → `processBorderSpan`（`creation.js:547-599`）按 `\n` 把带样式 span 拆成「每行一个 span + `<br>`」并摘掉父元素 style（**为 html2canvas 正确绘制跨行高亮**）；`:1671` `onElementToBase64`（`:1718-1739`）→ `html2canvas(scale=imageSize)` → `canvas.toDataURL()`；
4. `:1678-1685` 逐张落盘：`name=红薯模版_${time}\${i+1}.${imageType.toLowerCase()}`；`file=base64.replace("data:image/png;base64,","")`；`interface.FnJsWriteBase64File(name,file)`【原生桥】；
5. `:1687-1693` `interface.FnJsCreateWork(4, draftUuid, JSON.stringify({title,type:4,worklist}))`，`worklist` 是绝对路径数组（`:1688-1692`）；
6. `:1695-1699` 再存草稿；`:1710-1714` 埋点 `xhs_download_suc(页数)` + 「下载成功！」。

### 5.4 草稿恢复链（跨 iframe）

1. `my-draft.html:140-175` `onEdit(v)`（`v.categroy==="XHSMB"`）→ `localStorage.setItem("DraftData",…)`（`:167` 或 `:172`）→ `setItem("XHSMB_SOURCE","DRAFT")`（`:190`）→ `interface.FnJsSwitchPage(1,20)`（`:196`，formId 20 = 红薯模版来源）；
2. `view-smart-clip/index.html:271-281` 读到 `source==="DRAFT"` → 重建 `xhsTemplateUrl`（带新 timestamp）→ `pageId=6` → iframe 重载；
3. `main/create.js:210-220` `created()`：读 `$local.get("XHSMB_SOURCE")` → **立刻搬进 sessionStorage 并删 localStorage** → 若为 `"DRAFT"` 则 `loadingCreation=true`、`progressText="正在分析草稿"`、`onSetDraftData()`；
4. `methods.js:560-584` `onSetDraftData()`：`await onGetRuleAndTemplate()` → 读 `$local.get("DraftData")`，`draftUuid=result.bid`，11 个 `_dataKey` 键回填 → `$nextTick` 里 `zoom-container.innerHTML=JSON.parse(result.container)` → 给所有 `.editable` 重绑事件 → `$local.remove("DraftData")`。

**推断**：`create.js:210-213` 那段「读 localStorage → 写 sessionStorage → 删 localStorage」的绕行，是为绕开宿主壳页的**启动清空逻辑**——`view-smart-clip/index.html:163-172` 在 `created()` 里把 localStorage 里除 3 个白名单键外**全部删掉**。依据是两处键名与执行时序严格互补，且草稿交接必须活过壳页的 `created()`。

---

## 6. 问题四-A：`js/lineBreaks.js` 逐函数

> **⚠️ 先纠正命名误导**：`lineBreaks.js` 与「正文排版断行」**无关**。它全部 7 个函数都在做同一件事——**把 `window.getSelection()` 的选区映射成「视觉行」**，唯一服务对象是「划重点」（`methods.js:1314-1321`）。真正的断行/分页在 `calculateContainers.js`（§7）。

### 6.1 可达函数（3 个在跑 + 2 个辅助）

**① `mergeDomObjectsByBottom(domObjects)` — `lineBreaks.js:139-186`**
输入是 `Array.from(range.getClientRects())`（`methods.js:1314`）。`:144-152` 以 `obj.bottom.toString()` 为键分组 → 同一 `bottom` 值 = 同一视觉行。`:159-180` 逐组输出：单元素组原样；多元素组合并——`left=min(...)`、`right=max(...)`、`top/height/y` 取组内第一个、**`width=Σ width`**。返回 `{data, index:<组数>}`；消费方 `methods.js:1317` 只判断 `index===2`（矩形恰好落在 2 个不同 `bottom` 上 = 视觉跨 2 行）。
**观察到的内部不自洽**：`:169` 的 `width` 是各矩形宽度**之和**，而 `:172/:174` 的 `left/right` 是 min/max——同行两矩形间若有未选中内容则 `width ≠ right-left`。因唯一调用方只消费 `index`，属**潜在死数据**，暂未致障。

**② `getVisualLinesFromSelection(range)` — `lineBreaks.js:1-50`**
意图：从选区起点遍历到终点，把沿途每个文本节点按视觉行切开，每行产出 `{text, range, node}`。`:5-6` 取 `{node,offset}` 起终点；`:12` 主循环条件 `!isAfterPoint(...)`；`:13-37` 对文本节点取被选中的 `[startIdx,endIdx)` 调 `splitTextNodeByLines` 切行、每行 `document.createRange()` 后 push；`:40-46` 用 `getNextNodeInRange` 取下一节点，取不到则 `break`。
**🔴 关键缺陷**：`:40` 调用的 `getNextNodeInRange` **恒返回 `null`**（见 ⑤），因此 `while` **最多只处理起始文本节点一次就 break**。
**推断**：这正是 `methods.js:1317` 只敢在「2 行短选区」用的原因——作者知道它处理不了跨节点选区。依据是那里加了 `index===2 && visualLines.length===2` 双重严格前置条件，而非直接采信 `visualLines`。

**③ `splitTextNodeByLines(textNode, startOffset, endOffset)` — `lineBreaks.js:52-113`（本文件唯一有独立复用价值的算法）**

给定一个文本节点及其字符区间，用 DOM Range 测量出「视觉行」切分点；**对每一行做一次二分**：

```
currentStart = startOffset
while (currentStart < endOffset) {
    low = currentStart; high = endOffset; bestEnd = currentStart
    while (low <= high) {                                     // :66-95
        mid = ceil((low + high) / 2)
        measuringRange.setEnd(textNode, mid)                  // :68
        rects = measuringRange.getClientRects() 过滤 width===0 // :70-77
        if (rects.length === 0) break                         // :79-81
        if (rects.length === 1 || |firstRect.top - lastRect.top| < 2) {  // :87
            bestEnd = mid; low = mid + 1                      // 同一行 → 试更长
        } else { high = mid - 1 }                             // 已换行 → 试更短
    }
    if (bestEnd > currentStart) { push({start, end:bestEnd, text}); currentStart = bestEnd }
    else { currentStart++ }                                   // :104-107 防死循环
    measuringRange.setStart(textNode, currentStart)           // :109
}
```
判据 = `getClientRects()` 首末矩形 **top 差 < 2px**（`:87`），即「渲染在同一基线高度上」，允许 2px 亚像素误差。复杂度 `O(行数 × log₂(区间字符数))` 次 `getClientRects()`，每行约 8~11 次强制布局查询。`bestEnd<=currentStart` 时 `currentStart++`（`:106`）是**行中间强制断开**的兜底，保证不死循环（代价是可能把单字切成一行）。

**④ `isAfterPoint(node, offset, endPoint)` — `lineBreaks.js:115-121`**
```js
const range = document.createRange()
range.setStart(node, offset); range.setEnd(endPoint.node, endPoint.offset)
return range.collapsed
```
语义：起点若已在终点之后，按 DOM 规范该 Range 折叠 → `collapsed===true` → 视为「已到达终点」。**很省事的游标越界判定**，不写任何比较逻辑，直接借浏览器的规范化行为。

**⑤ `getNextNodeInRange(currentNode, endPoint)` — `lineBreaks.js:123-137`**
**🔴 空壳**：函数体只在 `if (currentNode.nodeType === Node.TEXT_NODE)` 里算了个 `maxOffset` 局部变量（`:126-129`）然后什么都不做，注释自陈「这里简化处理，实际应该使用 TreeWalker 遍历」（`:131`），最后 `return null`（`:136`）。

### 6.2 死代码（定义齐全、全模块 grep 无调用点）

| 函数 | 行范围 | 说明 |
|---|---|---|
| `getSelectionLineInfo()` | `:188-276` | 用 `getClientRects` 求选区 top/bottom → 用 `getComputedStyle().lineHeight` **整除**反推行号（`:262-263`）；内部 `TreeWalker` 做 `node→(textNode,offset)` 归一化（`:205-234`）。**从未被调用** |
| `safelyBreakSelectedTextByLines()` | `:279-354` | **逐字符** `setStart/setEnd(i,i+1)` + `getBoundingClientRect()`，按 `Math.round(rect.top)` 变化判换行（`:309-335`）。O(字符数) 次布局查询，最贵的一种。**仅被同为死代码的 `:188` 调用** |
| `getSelectedLinesSimple()` | `:357-422` | 用 `Math.round(rect.width/8)` **估算**每矩形覆盖多少字符（`:387-388`）—— 8px/字符的硬编码启发式，对中英文/各字号均不成立；末尾有长度对账补丁（`:411-414`）。**从未被调用** |
| `getSelectionLinesRobust()` | `:424-531` | 与 `:279` 同思路但改用 `TreeWalker` + `range.intersectsNode(node)`（`:440-457`）过滤文本节点，并做长度对账（`:510-514`）。**从未被调用** |

**结论**：531 行中 **`:188-531`（约 344 行、65%）是 4 个同名异构的「选区按行切分」实验版本，全部未接线**；生产路径只用 `:1-50`、`:52-121`、`:139-186`。且**真正正确的跨节点实现就在死代码区**（`getSelectionLinesRobust` 的 `TreeWalker`+`intersectsNode`，`:440-457`）——像做完之后忘了接线。

---

## 7. 问题四-B：`js/calculateContainers.js` 逐函数

整个模块**最有工程价值**的文件：把任意长度的结构化文本，按模板几何约束自动切成 N 页。

**模块级状态**：`let mainData=[]`（`:1`，待分页条目）、`let rulesData={}`（`:2`，当前模板规则）、`const itemHeights=new Map()`（`:3`，条目 id→实测高度，跨次累积从不清空）、`const fixedRemainHeight=20`（`:4`，残余高度阈值 px）。三者都是模块级。

**`getStarted(canvasMainText, useTemplateRules)` — `:7-17`**
`mainData=deepClone(canvasMainText)`（`:9`，避免污染 Vue 响应式数据）→ `rulesData=useTemplateRules`（`:10`）→ `await calculateContainersWithSplit()`（`:12`）。catch 只 `console.error`（`:14-16`）→ **失败返回 `undefined`**，调用方 `methods.js:437` 会立刻在 `result.containers` 上抛错。

**`calculateContainersWithSplit()` — `:20-48`**
① `:22-23` 建隐藏测量容器并 `appendChild(document.body)`；② `:27-34` **逐个测量原始条目真实渲染高度**写入 `itemHeights`（`for (const item of mainData) { const h = await measureTextHeight(...); itemHeights.set(item.id,h) }`，`await` 串行、每次至少一帧）；③ `:37-39` `distributeItemsByHeightSimple([...mainData])` 分页；④ `:42-47` `finally` 移除测量容器（**异常安全**，比本文件其他地方做得好）。

**`createMeasuringContainer()` — `:51-61`**
```js
container.style.position = "absolute"                     // :53
container.style.left = "-10000px"                         // :54  移出视口但保持布局有效
container.style.width = rulesData.mainText.width + "px"   // :56  ★ 与真实正文容器同宽
container.style.visibility = "hidden"                     // :57
container.style.pointerEvents = "none"; container.style.zIndex = "-1000"  // :58-59
```
**核心思想**：把测量容器放到屏幕外但**保持布局有效性**（不能用 `display:none`），并强制与目标容器**同宽**。只有宽度一致，文字自动换行位置才一致，测出的高度才有意义——这是整个分页器成立的物理前提。

**`measureTextHeight` — `:64-76`** 与 **`createStyledElement` — `:79-95`**
```js
const element = createStyledElement(text, item)   // :66
measuringContainer.appendChild(element)           // :67
requestAnimationFrame(() => {                     // :70  ★ 等一帧确保样式/字体应用
    const { totalHt } = GetElTotalHeight(element) // :71
    measuringContainer.removeChild(element)       // :72  立刻移除，不累积
    resolve(totalHt) })
```
`createStyledElement` 建 `editorBoard`（`style=styleObjectToString(RenderStyles(item))`，`:85`，`data-id=item.id`）+ 内层 `contenteditable.measure-editable`（`:90`）`innerHTML=text`（`:91`）。
**性能含义**：每次测量 = 1 次 DOM 插入 + 1 帧等待（≈16ms）+ 1 次 `offsetHeight` 强制布局；所有测量 `await` 串行（`:28`、`:424`），**无并行**。
**🔴 关键缺陷**：这里**完全不创建 icon**（对比渲染侧 `creation.js:300-317`）→ 见 §10-3a。

**`RenderStyles(v)` — `:98-138`（测量侧样式，必须与渲染侧逐字段对齐）**

| `item.type` | 用哪套 rules | 关键样式 |
|---|---|---|
| `"2"` 副标题 | `rulesData.subtitle` | `display:flex`；`marginTop=(是否**全局**首个副标题?0:rules.spacing)`；`marginBottom=rules.mb`；`lineHeight=font.light` |
| `"3"`/`"4"` | `rulesData.mainText` | `display:flex`；`paddingBottom=rules.mb`；`lineHeight=font.light` |

`_noMarginTop` 为真时强制 `marginTop:"0px"`（`:115-117`、`:132-134`）。**两处对齐缺陷**（详见 §10-3b/3c）：① `:101-103` 判据是「全局第一个 type 2 条目」（`mainData.find(i=>i.type==="2")`），而渲染侧 `creation.js:350` 是「本容器第一项」（`v.id===containerItems[0].id`）——**语义不同**；② `_noMarginTop` 只在测量侧被读，渲染侧 `creation.js:347-378` **完全没有这个分支**。

**`GetElTotalHeight(element)` — `:141-159`**
```js
const contentHt = element.offsetHeight                  // :148  已含 padding+border
const totalHt = contentHt + marginTop + marginBottom    // :149  只再加 margin
```
语义：`totalHt` = border-box 高度 + 上下 margin。`paddingTop/Bottom` 算出来但**调用方不用**（`methods.js:71`、`:1102` 只取 `totalHt` 或 `marginTop`）。命名 `contentHt` 其实是 border-box 高度，名不副实。

**`distributeItemsByHeightSimple(items)` — `:162-259`（主分页循环）**

```
availableHeight = rulesData.mainText.height            // :167  ★ 单页正文区高度
newItemHeights  = new Map(itemHeights)                 // :169  拷贝（会回写拆分段）
queue           = items.map(item => ({...item}))       // :174；建测量容器并挂载 :170-171

主循环（:177-230）每轮只看队首：
  if (currentHeight + itemHeight <= availableHeight) {          // :182 情况1 放得下
      currentContainer.push({...queue.shift(), isSplit:false}); currentHeight += itemHeight
  } else if (availableHeight - currentHeight > fixedRemainHeight) {  // :188 情况2 剩 >20px
      拆 → part1 入当前容器（:201）; queue.unshift(part2)（:208）; 拆不动则 break（:212）
      break                                                     // :216 ★ 拆完必须收页
  } else { break }                                              // :219 情况3 剩 ≤20px
  if (currentHeight >= availableHeight * 0.9 || queue.length === 0) {  // :223 ★ 90% 提前收页
      if (currentContainer.length > 0) { containers.push([...currentContainer]); 重置 } }
循环外（:233-246）：flush 当前容器 → 队列若仍有剩余交给 processRemainingItems
返回 {containerCount, distribution, containers, itemHeights}
```
**三个设计要点**：① **90% 阈值（`:223`）**——填到 90% 就主动收页而非等填满，是**产品取向启发式**（宁可少放，也不让最后一段紧贴底边）；对比 `template01` 的 `mainText.height=1164`（`config.js:75`），90%=1047.6px，最多浪费约 116px。② **20px 阈值（`:4`+`:188`/`:290`）**——剩不到 20px 不尝试拆分，因为拆出来只有一两个字，视觉上是碎片。③ **`break` 的双重语义（`:212`/`:216`/`:219`）**——这三处 `break` 不是「放弃」，而是**把控制权交给 `processRemainingItems`**，构成「主循环精细装箱 + 尾巴函数粗放兜底」的两段式设计。

**`processRemainingItems(...)` — `:262-327`**
与上面的循环体**几乎逐行重复**（约 60 行），但有一条关键差异：`if (container.length === 0 || containerHeight + itemHeight <= availableHeight)`（`:278-281`）。`container.length===0 ||` 保证**即使单个条目比整页还高也能独占一页**，不会死循环；主循环没有这条（会落到情况 2/3 然后 break）。**这是本文件最大的可维护性问题**：两套高度相似但规则微妙不同的实现必须同步维护。

**`splitAndMeasureItemText(...)` — `:330-405`**
```js
const splitIndex = await findOptimalSplitPointWithMeasurement(text, availableHeight, item, mc)  // :345
if (splitIndex <= 0 || splitIndex >= text.length - 5) return result        // :352 ★ 拒绝退化切分
const currentText = text.substring(0, splitIndex).trim()                   // :358
const remainingText = text.substring(splitIndex).trim()                    // :359
const currentPartHeight   = await measureTextHeight(currentText,   item, mc)  // :362 ★ 拆完必须重测
const remainingPartHeight = await measureTextHeight(remainingText, item, mc)  // :367
result.currentPart    = { ...item, id:`${item.id}_part1`, value:currentText,
                          isSplit:true, splitIndex:1, totalParts:2,
                          originalLength:text.length, measuredHeight:currentPartHeight, processed:true }  // :373-383
result.remainingParts = [{ ...item, id:`${item.id}_part2`, value:remainingText,
                          isSplit:true, splitIndex:2, totalParts:2,
                          originalLength:text.length, measuredHeight:remainingPartHeight,
                          _noMarginTop:true }]                              // :386-398
commonItemHeights.set(currentPart.id, currentPartHeight)                    // :401
commonItemHeights.set(result.remainingParts[0].id, remainingPartHeight)     // :402
```
`:352` 拒绝「尾巴只剩 4 个字符」的切分，避免视觉孤儿。**`:362`/`:367` 拆完必须重测是必要的正确性保障**：`substring().trim()` 改变文本后，两段各自的行数分布 ≠ 原高度累加（`paddingBottom`/`marginBottom` 会被重复计算一次），这也是性能成本主要来源。`_noMarginTop:true` 只标在 part2（`:396`），意图是「续接段不该再有段前间距」——但渲染侧没读这个标记（§10-3b）。

**`findOptimalSplitPointWithMeasurement(...)` — `:408-446`**
```js
let low = 10; let high = totalLength - 5; let bestSplitIndex = 0   // :417-419
while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const testHeight = await measureTextHeight(text.substring(0, mid).trim(), item, mc)  // :423-424 ★ 每次都真测量
    if (testHeight <= availableHeight) { bestSplitIndex = mid; low = mid + 1 }  // :430-433
    else { high = mid - 1 } }                                                  // :435-437
if (bestSplitIndex > 0) return findOptimalPunctuationSplit(text, bestSplitIndex)  // :441-443
return 0                                                                          // :445
```
二分查找「能放下的最大字符数」。单调性假设：`text.substring(0,n)` 的高度随 `n` 单调不减（纯文本 + 固定宽度容器成立）。每次探测 = 一次完整 DOM 测量（含一帧）；候选区间 `[10,len-5]` → 约 8~12 次探测。二分给出**字符级最优解**但不保证落在语义边界 → 交给下一步吸附。

**`findOptimalPunctuationSplit(text, targetIndex)` — `:449-485`（标点吸附，5 级优先级，均从 `targetIndex` 向前回退）**

| 级 | 搜索目标 | 窗口 | 返回 | 行号 |
|---|---|---|---|---|
| ① | `[".","。","!","！","?","？"]` 句末标点 | 50 字符 | `i+1`（切在标点**之后**） | `:450`、`:454-458` |
| ② | `clauseEndings` | 30 字符 | `i+1` | `:451`、`:461-465` |
| ③ | 空格（英文分词） | 20 字符 | `i`（切在空格**之前**） | `:468-472` |
| ④ | CJK 存在时找 `[，。！？；]` | **10 字符** | `i+1` | `:475-481` |
| ⑤ | 兜底 | — | `targetIndex` | `:484` |

**🔴 观察到的死分支**：`const clauseEndings = []  // [";","；",",","，"]`（`:451`）——数组为空，`[]` 里永远找不到元素 → **② 级恒不命中**。④ 级是 `；` 的唯一入口（`；` 不在 ① 里，② 又空），但窗口只有 10 字符。

**算法总评**：`一次分页测量次数 ≈ N + 切分次数 × (10~14)`。这是**「以 DOM 实测为唯一真值」的分页器**——不做任何字体度量学的字符宽度估算，全部依赖浏览器真实排版结果。优点：**换字体/字号/模板都不用改算法**；代价：每次测量都要一次强制布局且必须等帧。

---

## 8. 问题五：它怎么和宿主通信

### 8.0 拓扑

本模块**不是**独立窗口，而是**嵌在宿主壳页里的 iframe**：
```html
<!-- view-smart-clip/index.html:96-102 -->
<iframe v-show="pageId === 6" :src="xhsTemplateUrl"
        id="xhsTemplateIframe" class="iframeTemp-wrap" frameborder="0"></iframe>
```
注册表：`view-smart-clip/index.html:152-156` → `{ id:6, name:"红薯模版", url:"./../view-xhs-template/index.html" }`。因此通信有 **4 条独立通道**（+1 个全局变量槽位）。以下为**逐字引用**。

### 8.1 通道 A：iframe → 原生桥（`interface.FnJs*` → `window.Js*`）

包装层在 `view-smart-clip/js/clientApi.js`（由 `index.html:731` 引入）。所有 `FnJs*` 都是 `window.Js*` 的直通包装（去掉 `Fn` 前缀）。

| 用途 | 包装定义（clientApi.js） | 调用点（methods.js） |
|---|---|---|
| 保存草稿 | `:123-125` `FnJsSaveDraft:(a,b,c,d)=>{window.JsSaveDraft(a,b,c,d)}` | `:551-556` `interface.FnJsSaveDraft(3, source, this.draftUuid, JSON.stringify(draftData))` |
| 写 base64 文件 | `:207-209` `FnJsWriteBase64File:function(a,b){window.JsWriteBase64File(a,b)}` | `:1682` `interface.FnJsWriteBase64File(name, file)` |
| 登记作品 | `:108-110` `FnJsCreateWork:(a,b,c)=>{window.JsCreateWork(a,b,c)}` | `:1693` `interface.FnJsCreateWork(4, bid, JSON.stringify(clientData))` |
| 选下载目录 | `:177-179` `FnJsStartSelectFolder:(a,b)=>{window.JsStartSelectFolder(a,b)}` | `:1608` `interface.FnJsStartSelectFolder(4, "XhsImage")` |
| 打开文件夹 | `:93-95` `FnJsOpenFolder:a=>{window.JsOpenFolder(a)}` | `:1613` `interface.FnJsOpenFolder(this.downloadLink)` |
| 购买创点 | `:166-169`（注释 `5红薯模版购买创点`）`FnJsBuyCreatePoints:a=>{window.JsBuyCreatePoints(a)}` | `:181` `interface.FnJsBuyCreatePoints(5)` |

**终止请求**（不是原生桥，是 Ajax 全局槽位）：`methods.js:90-98` → `if (TerminateButton) { TerminateButton.abort(); ... }`；`common/request.js:35` `var TerminateButton = null`；`:4-5` `beforeSend: function (xhr) { TerminateButton = xhr; ...`。

### 8.2 通道 B：宿主 → iframe（跨 iframe 直接调全局函数）

```js
// clientApi.js:365-375（FnSetFolder 的 "XhsImage" 分支）
} else if (b === "XhsImage") {
    interface.SetCreateXhsImagePath(a)                  // 写 localStorage "XhsImagePath"（:270-273）
    const xhsTemplateEl = document.getElementById("xhsTemplateIframe")
    if (xhsTemplateEl) {
        xhsTemplateEl.contentWindow.clientSetSelectFolder(b, a)     // ★ 逐字引用
    }
    interface.FnJsCreateXhsImagePathUpdate(a); return
}
// main/create.js:203（注册）
window.clientSetSelectFolder = this.onClientSetFolder // 客户端设置选择的目录
// main/methods.js:1617-1621（接收）
onClientSetFolder(id, val) { if (id === "XhsImage") { this.downloadLink = val } },
```
**注意参数顺序反转**：请求 `FnJsStartSelectFolder(4,"XhsImage")` 传 `(4,key)`，回调 `clientSetSelectFolder(b,a)` 传 `(key,path)`。

### 8.3 通道 C：`BroadcastChannel("smart-clip")`

建通道：iframe `main/create.js:205`；宿主 `view-smart-clip/index.html:175`。
**iframe 收**（`main/create.js:225-236`）：
```js
switch (e.data.type) {
    case "login":         _this.loginInfo = JSON.parse(e.data.value); break
    case "RE_ENTER_PAGE": _this.onGenerateThumbnail(); break
}
```
**宿主发 login**（`view-smart-clip/index.html:300-305`）：`postMessage({type:"login", value: JSON.stringify(v)})`；**宿主发 RE_ENTER_PAGE**（`index.html:288-291`，当 iframe 已存在、用户再次进入第 6 页）。
**iframe 发 Points**（`methods.js:131-134` 与 `:207-210`）：`postMessage({type:"Points", value: num * 10})` ← ★ 乘 10；**宿主收**（`index.html:200-202`）：`case "Points": interface.SetCreatePoints(e.data.value)`；**汇入登录态**（`clientApi.js:276-285` → `:227-243`）：`createpoints: createpoints / 10`（`:234` ← ★ 除 10），并 `localStorage.setItem("AICLIPLOGIN", …)`（`:241`）。
**换算闭环**：桥协议层用「创点×10」整数、UI 层用真实值；iframe 发 `×10`（`methods.js:133`），桥收后 `/10`（`clientApi.js:234`）落盘，iframe 启动读回（`create.js:207`）。宿主自身广播路由处理 `page`/`Reload`/`Points`（`index.html:185-206`）；iframe 只发 `Points`、只收 `login`/`RE_ENTER_PAGE`。

### 8.4 通道 D：iframe 自己直连 HTTP（**不经过宿主进程**）

```js
// request.js:2-9    AI 生成 + 关键词提取（同一端点，靠 data.type 区分 11/12）
const result = await POST_J("https://public.17van.com/dmx/xhs", data)                        // :4
// request.js:12-22  远端模板规则（覆盖本地 config.js）
const result = await GET_J("https://static2.17van.com/images/xhs-template/templateConfig.json?timemap=1767003138952", data)  // :14-17
// request.js:25-35  埋点
const result = await POST_J("https://action.17van.com/action/collection", data)              // :27-30
```
三处 catch 都各自 `return {}`（`request.js:7`、`:20`、`:33`）。
**鉴权头**（`common/request.js:7-11`）：`xhr.setRequestHeader("loginToken", login.logintoken)`，`login` 取自 `localStorage.AICLIPLOGIN`。
**AI 参数**（`methods.js:136-145`、`:251-258`）：`{type:11, stream:0, model:"deepseek-r1-0428", prompt:JSON.stringify({"[key1]": this.creativeCont})}` 与 `{type:12, …, prompt:JSON.stringify({"[key1]": result.titleData.value})}`。**观察**：`prompt` 只含 `"[key1]"` 一个键 → prompt 模板在**服务端**，客户端只填槽。
**埋点字段**（`methods.js:4-16`）：`{type:2, event:key, uid, did, isSubUser, version, channel, msg: this.creativeCont, num}` —— ★ `msg` 会把**用户输入的主题原文**上报。`event` 取值 `xhs_click_suc`（`:277`）、`xhs_download_suc`（`:1710`）。
**字体**（`css/font-family.css:1-116`，29 条 `@font-face`）：全部直连 `https://toolsdownload.17van.com/font/*.ttf|otf`。`clientApi.js:171-174` 存在 `FnJsDownloadFont`（`window.JsDownloadFont`）但本模块**无任何调用点**（全模块 grep `interface.` 只有 8 处调用，不含此项）。

### 8.5 通道 E：URL 参数与页面级存储

- **宿主拼 URL**（`view-smart-clip/index.html:307-317`）：`` `${page}?did=${did}&channel=${channel}&version=${version}&osversion=${osversion}&showvideomix=${showvideomix}&timestamp=${new Date().getTime()}` ``；**iframe 解析**：`main/create.js:206` → `interface.getUrlParams()`（`clientApi.js:11-24`，`URLSearchParams`），用途 = 埋点（`methods.js:9-12`）。
- **共享 localStorage 键**：`AICLIPLOGIN`（写 `clientApi.js:241`／读 `create.js:207`、`methods.js:129`、`common/request.js:7`）、`DraftData`（写 `my-draft.html:167/172`／读 `methods.js:563`，读完即删 `:582`）、`XHSMB_SOURCE`（写 `my-draft.html:190`／读 `create.js:210-213`）、`XhsImagePath`（写 `clientApi.js:271`／读 `create.js:238`）、`PageId`（写 `index.html:216`／读 `clientApi.js:249/258/289/296`）、`XHSMB_OPENED`（写 `clientApi.js:332`／读 `my-draft.html:145`）、sessionStorage `XHSMB_SOURCE`（写 `create.js:212`／读 `methods.js:536`、`:588`）。
- **⚠️ 宿主会清空 localStorage**（`view-smart-clip/index.html:163-172`）：`created()` 里把除 `["AICLIP_ANCHOR","AICLIP_MUSIC","AICLIP_DUBPAUSE"]` 之外的键**全部 remove**。这就是草稿恢复必须走「壳页写 → 切页 → iframe 立刻搬到 sessionStorage」这条时序敏感窄路的原因（§5.4）。

### 8.6 通道汇总

| # | 方向 | 机制 | 字面量 |
|---|---|---|---|
| A | iframe→原生 | `window.Js*` 全局函数 | `JsSaveDraft`/`JsWriteBase64File`/`JsCreateWork`/`JsStartSelectFolder`/`JsOpenFolder`/`JsBuyCreatePoints`/`JsSwitchPage` |
| B | 宿主→iframe | `contentWindow` 直调 | `clientSetSelectFolder(b, a)`（`clientApi.js:370`） |
| C | 双向 | `BroadcastChannel` | 频道 `"smart-clip"`；消息 `login`/`RE_ENTER_PAGE`/`Points`/`page`/`Reload`/`buy` |
| D | iframe→外网 | jQuery `$.ajax` | `public.17van.com/dmx/xhs`、`static2.17van.com/.../templateConfig.json`、`action.17van.com/action/collection`、`toolsdownload.17van.com/font/*` |
| E | 双向 | URL query + Web Storage | 6 个 query 参数；7 个 localStorage 键 |
| — | — | 全局变量槽位 | `TerminateButton`（`common/request.js:35`） |

**值得注意**：**没有一条通道是 Electron IPC**——全部是 Web 原生机制（全局函数、`contentWindow`、BroadcastChannel、localStorage、XHR），iframe 与宿主之间甚至没有 `postMessage` 结构化握手。
**推断**：宿主很可能是 CEF/WebView 而非标准 Electron。依据是 `window.Js*` 是**同步**函数——如 `FnJsPathFileExist: a => { return window.JsPathFileExist(a) }`（`clientApi.js:78-80`）同步返回文件是否存在，而 Electron 的 `ipcRenderer.invoke` 必然是异步 Promise。**此推断未做二进制层验证**，列于 §11-2。

---

## 9. 问题六：值得 mulpub 借鉴的实现

### 9.1 ★★★ 测量驱动的自动分页引擎（`js/calculateContainers.js` 全文）

**借鉴什么**：把「任意长度文章 → N 张固定尺寸卡片」的切分，做成**以 DOM 实测为唯一真值、以模板几何为唯一输入**的独立引擎。接口极简：`getStarted(items /* [{id,type,value}] */, rules /* _ruleList 单条 */) → {containerCount, distribution, containers, itemHeights}`。

**为什么值得借鉴**：① **与 mulpub 痛点直接对位**——mulpub 目前把正文写进平台字段（`packages/api-publish-engine/src/content-formatter.js`），而「长文 → 多图卡片」是纯文本承载平台完全缺失的能力。② **算法与内容解耦**：引擎只认 `{id,type,value}` 与一套几何常量；因为高度是**实测**而非估算，换模板/字体/字号**都不用改算法**——这是它最大的架构优势。③ **规则完全外置**（23 套 `_ruleList`），运营可改、可远端下发（`methods.js:20-28`），可直接沿用这套 JSON 数据契约。④ 代码量小：核心 485 行、单文件、零外部依赖（只用 DOM API）。

**可直接移植的 4 个子技术**：

| 子技术 | 位置 | 价值 |
|---|---|---|
| 同宽屏外测量容器（`left:-10000px` + `width=正文宽` + `visibility:hidden`，**不能用 `display:none`**） | `:51-61` | 高。任何「布局前测量」场景的通用前提 |
| 二分字符切分（`substring(0,mid).trim()` 逐次实测高度） | `:408-446` | 高。把「切在哪」从猜测变成求解 |
| 标点吸附（句末→分句→空格→CJK 标点逐级回退） | `:449-485` | 高。让机械切分读起来不像机械切分 |
| 90% 提前收页 + 20px 残余阈值 | `:4`、`:223`、`:188` | 中。产品取向参数，可暴露为配置 |

**移植难度：中**。注意点：① 依赖 DOM（`offsetHeight`/`getClientRects`/`requestAnimationFrame`），**只能在渲染进程用**，不能下沉到 Node 侧——若要在主进程预分页需改用字体度量（如 `opentype.js`）重写测量层，那会引入字体一致性问题。② 必须提供等价于 `.editor-shell`/`.editable` 的 CSS（`index.css:642-668`）；**测量元素与渲染元素的 CSS 必须逐字段对齐**，否则重现 §10-3 那类「测出来和画出来不一样」。③ 建议先把 `distributeItemsByHeightSimple` 与 `processRemainingItems` **合并成一份**（§10-9）。④ 性能预期 ≈ `(条目数 + 切分次数 × 12) × 16ms`，2000 字/20 段/切 5 次 ≈ 1.3s；批量生成需自行加并发或缓存。

### 9.2 ★★★ 跨行高亮的 `box-decoration-break: clone`

```js
// main/data.js:145-152
const spanStyle = { display:"inline !important", maxWidth:"100%",
    wordBreak:"break-all", whiteSpace:"pre-wrap",
    "box-decoration-break":"clone", "-webkit-box-decoration-break":"clone" }
```
配合 `highlightKeyword`（`creation.js:450-489`）只包**第一个匹配**（`text.indexOf(keyword)` 单次替换）生成 `<span style="...">关键词</span>`。
**为什么值得借鉴**：该属性让 `background-color`/`border`/`border-bottom` 在**被折行 span 的每一行碎片上独立绘制**，而不是只画在首尾之间——这是「小红书手账风荧光笔高亮」「下划线圈选」跨行不断裂、不拉出空白的唯一 CSS 手段。
**附带一个更深的坑也一并借鉴**：html2canvas 对 `box-decoration-break` 支持不完整，所以该模块在**导出前**做了一次 DOM 重写——`methods.js:1665-1669` 调 `processMultipleSpans` → `creation.js:547-599` 的 `processBorderSpan`，按 `\n` 把带样式 span **拆成「每行一个 span + `<br>`」并摘掉父元素 style**，然后才截图。**这是「浏览器能画 ≠ 截图库能画」的实战补丁**，mulpub 用 html2canvas/dom-to-image 导出时同样会遇到。
**移植难度：低**（纯 CSS 属性 + 一个 20 行字符串替换函数）；截图补丁部分中等（需针对实际截图库做适配验证）。

### 9.3 ★★ 用 `getClientRects` 把「视觉换行」当一等公民

在 `contenteditable` 里，用户「看到的换行」与「DOM 里的 `\n`」是两件事。该模块用两个纯几何函数对齐：`mergeDomObjectsByBottom`（`lineBreaks.js:139-186`）按 `rect.bottom` 分组、组数即视觉行数；`splitTextNodeByLines`（`:52-113`）二分 + 首末 `top` 差 < 2px 判定「同一行」。消费点 `methods.js:1310-1321`：选区**不含 `\n`** 但**视觉跨 2 行**时把两行用 `\n` 连接当选中文本——这样划重点跨行时会生成两个独立视觉块而非一个大块。
**为什么值得借鉴**：任何基于 `contenteditable` 的编辑器都会遇到；且 `splitTextNodeByLines` 的「二分 + 容差」写法比同文件那种「逐字符测」（`:279-354`）高效一到两个数量级。
**移植难度：低~中**。两函数自包含、可直接复制；但**必须同时处理 `getVisualLinesFromSelection` 的局限**（依赖空壳 `getNextNodeInRange`，跨文本节点不可用）——建议移植时**直接重写该函数**，参考同文件里那个未接线的正确实现 `getSelectionLinesRobust`（`:440-457`，`TreeWalker`+`intersectsNode`）。

### 9.4 ★★ 模板配置「远端优先、本地兜底」

本地 63 KB（`config.js`）作为**出厂默认**，远端 `templateConfig.json` 作为**可热更真值**，两者同结构、同字段名（`methods.js:19-29`）。
**为什么值得借鉴**：模板/规则这类「运营频繁改、代码不该跟着发版」的数据，这是最省事的双轨方案——不需要下发 SDK、不需要灰度开关、不需要迁移脚本。**移植难度：低**，但**必须修掉异常穿透**（`result._ruleList` 为 `undefined` 时 `.length` 抛 TypeError，见 §10-4），正确写法 `if (result?._ruleList?.length)`。

### 9.5 ★ 缩略图与导出分流的两套截图参数

缩略图（体积优先）：`{scale:1, useCORS:true, allowTaint:false, backgroundColor:null}` → `toDataURL("image/jpeg", 0.1)`（`methods.js:464-476`）。正式导出（质量优先）：`{scale:Number(this.imageSize), useCORS:true, backgroundColor:this.bgColorVal}` → `toDataURL()`（`:1719-1735`）。
**为什么值得借鉴**：① 缩略图 `scale:1` + JPEG 0.1，一屏 8 张的内存/CPU 成本可控；② `allowTaint:false` + 对 `17van.com` 图片显式设 `img.crossOrigin="anonymous"`（`:457-461`）保证 canvas 不被污染；③ **`imgUrl === "data:,"` 判空**（`:481`）是识别「canvas 导出失败」的可靠手法（污染画布的 `toDataURL` 返回 `"data:,"`）。**移植难度：低**。

### 9.6 ★ 命令式撤销栈（闭包对，而非状态快照）

`methods.js:1566-1588` `onSaveHistory(type, execute, undo)`：当前位置不在栈顶时先 `slice(0,pos+1)` 截断分支；push `{type,timestamp,execute,undo}`；超 100 条 `shift()` 并 `historyPosition--`（`:1584-1587`）。`:1591-1604` 的 backward/forward 只调 `undo()`/`execute()`。调用方每次传一对闭包，例如样式切换传同一个 toggle 函数当 execute/undo（`:1216-1232`）、对齐切换传「设为新值/恢复旧值」（`:1246-1254`）。
**为什么值得借鉴**：对 DOM 密集型编辑器，**存闭包比存快照便宜得多**（不必序列化 innerHTML），且天然支持不可逆操作的补偿语义；代价是闭包持有 DOM 引用 → 元素被删后 undo 会操作游离节点（本模块就踩了，§10-11）。**移植难度：低**。建议改进：① execute/undo 里加「节点是否仍在文档中」检查；② 100 提为配置；③ 用 `splice(0,overflow)` 一次裁多笔并同步修正 `historyPosition`，而非 `shift()`+`--`（后者连续溢出时正确性依赖逐次递减）。

---

## 10. 问题七：明显的坑与缺陷

🔴 = 功能不可用或产物错误；🟠 = 特定条件下出错或显著增加维护成本；🟡 = 脆弱写法/死代码。

### 🔴 1. `onElToThumbnail` catch 自递归 → Promise 永不 settle → 生成流程死锁

```js
// methods.js:486-497（节选）
if (urls.length === elements.length) { urls.sort(...); resolve(urls) }   // :486-491 唯一 resolve
...
.catch(error => { this.onElToThumbnail() })                              // :494-496 ★ 重调整个函数
```
**机制**：html2canvas 对**任意一个**元素失败 → 该分支进 catch → catch 重新发起**完整**截图流程（新 `urls`、新 resolve）→ 原 Promise 的 `resolve(urls)` 永不调用。
**后果**：所有 `await this.onElToThumbnail()` 永久挂起——`methods.js:327`（首次生成）、`:717`、`:745`、`:816`、`:890`。而这些 await 之后才执行收尾（`loadingCreation=false`、`loadingInit=false`、`onSaveDraft`），因此**界面永远停在加载遮罩**，用户唯一出路是点「返回」（`:90`）。
**触发条件**：任一图 CORS 失败 / 字体未加载致 canvas 污染 / html2canvas 内部异常。而 `img.crossOrigin="anonymous"`（`:459`）是在 `src` 已赋值**之后**才设的（元素由 `creation.js:263-265` 创建并赋 src），对已发出的请求无效——这本身就提高了污染概率。
**修法**：catch 里 `resolve` 带失败标记的结果，或对单元素重试并补进 `urls`；同时把 `crossOrigin` 提前到 `src` 赋值**之前**。

### 🔴 2. 选「JPG」下载，文件内容是 PNG

四处配合造成：`base.js:1` UI 提供 `["JPG","PNG"]` → `data.js:75` 默认 `"JPG"` → `methods.js:1673` 扩展名取 `this.imageType.toLowerCase()` → `methods.js:1681` `item.value.replace("data:image/png;base64,","")` 前缀剥离写死 png → `methods.js:1735` `canvas.toDataURL()` **不传 mime，HTML 规范默认返回 `image/png`**。
**结果**：默认选项「JPG」产生 `.jpg` 后缀 + PNG 内容；副作用是「PNG」选项反而正确。**修法**：改用 `canvas.toDataURL("image/jpeg", quality)` 并让前缀剥离跟随 mime，或删掉 JPG 选项。

### 🔴 3. 测量模型与渲染模型不一致（3 个独立成因，都会造成页面溢出）

该模块正确性完全建立在「测量高度 == 渲染高度」之上（§7 的同宽前提只是其中一半）。以下三处破坏它：

**3a. 测量完全不渲染 icon，渲染会插入 icon**：测量侧 `calculateContainers.js:79-95` 的 editorBoard 内**只有**一个 `.measure-editable`，无 icon；渲染侧 `creation.js:300-317` 在 `if (iconData.src)` 时插入 `iconContainer`（`<img>` 的 `width/height/marginRight` 来自 `iconSize`，`mr` 缺省 4px，`:305`）。受影响模板：`template05`（`config.js:307-312`，64×64 + `mr:24`）、`template23`（`:1688-1692`，72×72，`mr` 缺省→4px）。横向：icon + marginRight 吃掉 68~88px 宽度 → 文字可用宽度变窄，实际换行行数可能多于测量值；纵向：icon 高（64/72）超过该段 `lineHeight`（`template05` subtitle lineHeight=60，`config.js:320`）时 flex 行被撑高。**推断**：渲染高度 **大于** 测量高度，末尾内容向下溢出正文容器；依据是 icon 在 flex 行内同时占宽与高，而测量模型完全未计入这两项。

**3b. `_noMarginTop` 只在测量侧生效**：测量侧 `calculateContainers.js:115-117`（type2）、`:132-134`（type3/4）有 `if (v._noMarginTop) styles.marginTop = "0px"`，`_noMarginTop:true` 由 `:396` 设置在 part2 上；渲染侧 `creation.js:347-378` 的 `RenderItemStyles` **完全没有该分支**。**后果**：被拆分段落的后半段（`_part2`）若 type 为 `"2"`，测量时 `marginTop=0`，渲染时 `marginTop = rules.subtitle.spacing`（type 2 分支只在它是容器首项时才置 0，`creation.js:350-354`）。`spacing` 在各模板取 16~50（如 `config.js:53`=24、`:1610`=32、`:1419`=220）。**推断**：渲染高度 **大于** 测量高度，按 `spacing` 量级溢出（通常 16~50px）。

**3c. 副标题首项判据两处语义不同**：测量侧 `calculateContainers.js:101-106` 判「**全局**第一个 type 2 条目」，只有全文第一段副标题 marginTop=0；渲染侧 `creation.js:350` 判「**本容器**第一项且 type 为 2」，每页首项若为副标题也 marginTop=0。**推断**：以副标题开头的第 2..N 页，测量时多算了 `spacing` 段前距而渲染时没有 → 该页**内容比预留空间矮 `spacing`**，底部留多余空白，也可能少排一段。方向与 3b 相反。

### 🔴 4. `onGetRuleAndTemplate` 无兜底，接口失败即抛异常并卡在加载层

```js
// methods.js:19-29
const result = await GetRuleAndTemplate()   // 失败时 request.js:20 → return {}
if (result._ruleList.length) { ... }        // :22 ★ undefined.length → TypeError
if (result._templateList.length) { ... }    // :26 同上
```
调用点 `methods.js:117`（`onStartCreation` 内）发生在 `loadingCreation=true`（`:115`）与 `progressText`（`:116`）**之后**，而假进度定时器 `:119` 才启动。异常抛出后：进度条停在 0、文案停在「正在分析文案」、遮罩不消失、**无任何错误提示**。`onStartCreation` 是 async，Vue 不捕获其 rejection → unhandled rejection。用户可点「返回」自救，但没有任何提示说明发生了什么。调用点 `methods.js:561`（`onSetDraftData` 内）由 `create.js:218` 调用且未 await，同样静默卡死。**修法**：`if (result?._ruleList?.length)`，异常/空结果时用本地 `_ruleList` 继续（本地兜底数据本就在 `config.js` 里）。

### 🟠 5–12（中危）

| # | 缺陷 | 证据与后果 |
|---|---|---|
| 5 | **`ruleItem` 是隐式全局变量**：`methods.js:219`/`:233`/`:238` 三处赋值均无 `let/const/var`；对 `Asset\dist` 全量 grep `(let\|const\|var)\s+ruleItem` **零命中** → 隐式挂 `window`。风险：① `"use strict"` 下 `ReferenceError`；② **跨次调用的共享状态**，第二次生成时若在消费点 `:247` 之前异常会保留上次模板规则；③ 不在 `_data` 里 → 非响应式，模板切换不触发视图更新（这也是 `:248` 要手工 `this.currentTemplate = templateItem` 的原因） | `methods.js:219`、`:233`、`:238`、`:247`、`:248` |
| 6 | **`lineBreaks.js` 65% 死代码 + 核心遍历函数是空壳**：4 个死函数约 344 行，`getNextNodeInRange`（`:123-137`）恒返回 `null` 使跨节点分支（`:40-46`）永不可达 | 详见 §6 |
| 7 | **`findOptimalPunctuationSplit` 的分句符表是空数组**：`calculateContainers.js:451` 的 `const clauseEndings = []` 被注释掉 → `:461-465` 恒不命中，逗号/分号吸附能力丧失，只剩 `:475-481` 那条 10 字符窗口。中文长句常以逗号分层，这一级失效会让切分点更容易落在句子中间 | `:451`、`:461-465`、`:475-481` |
| 8 | **分页引擎是模块级单例且状态不清空**：`:1-3` 的 `mainData`/`rulesData`/`itemHeights` 都是模块级；`itemHeights` 只 `set` 从不 `clear`（`:33`）→ **跨次生成持续累积、内存只涨不落**（条目 id 每轮由 `createIdFactory` 重发 `creation.js:57-61`，故旧条目不会被误用）；`mainData`/`rulesData` 在 `:9-10` 于 `await` 之前赋值 → 两次调用交错时后者会覆盖前者正在用的规则（本模块串行，故未爆） | `:1-3`、`:9-10`、`:33` |
| 9 | **两套几乎重复的分页实现**：`distributeItemsByHeightSimple`（`:162-259`）与 `processRemainingItems`（`:262-327`）约 60 行重复，规则还不同（后者多 `container.length === 0 \|\|`，`:278-281`）。任何高度相关修复都必须改两处 | `:162-259`、`:262-327` |
| 10 | **`maxCanvas=100` 与硬编码 `8` 冲突**：`data.js:70` 为 100；`methods.js:328` `urls.slice(0, 8)`（首次生成截断 8）；`:960` `length < 8`（撤销删除上限）；而 `:697/769/859` 新增画板判 `>= this.maxCanvas`（100）。**后果**：首次生成最多 8 页，撤销只允许恢复到 8 页，新增却允许到 100 页——三处上限不一致，`maxCanvas` 实际管不住首次生成。**推断**：`8` 是早期画板上限残留（小红书单篇常见 9 图以内），改成 100 后漏改这两处 | `data.js:70`；`methods.js:328`、`:960`、`:697/769/859` |
| 11 | **`TerminateButton` 是「最后一次请求」的全局槽位**：`common/request.js:4-5` 每次 `beforeSend` 都覆盖 `TerminateButton = xhr`；`methods.js:90-98`「返回」调 `.abort()`。`onStartCreation` 期间至少有 4 类请求经过 `Ajax`（模板配置 `:117`、扣点 `:190`、AI `:145`、埋点 `:5`）。**中止语义 = 中止最后一个发出的请求**，与用户「取消生成」意图不必然对应 | `common/request.js:4-5/35`；`methods.js:90-98` |
| 12 | **`createIdFactory` 的唯一性保证被误用**：factory 用闭包内 `Set` 保证唯一（`creation.js:197-209`），但 `creation.js:289-298` 把 `createIdFactory("editable_")` **建在 `forEach` 内部**（`:297`）→ 每 item 一个新 factory、每次都是空 `Set` → 「唯一」只在单次 factory 生命周期内成立（同类问题见 `methods.js:268/272`、`:297`）。**为什么仍算缺陷**：这些 `data-id` 被当 `querySelector` 选择器直接使用（`methods.js:1351`、`:874`、`:923-926`、`:1642-1650`），一旦重复会静默操作错误元素且**无任何校验**。随机串长 10 位（`utils.js:636`，62 进制）故实际碰撞概率极低，但**保证机制是假的** | `creation.js:197-209`、`:289-298` |

### 🟡 13–22（脆弱写法与死代码，汇总）

| # | 缺陷 | 证据 |
|---|---|---|
| 13 | **`styleObjectToString(undefined)` 会抛错**：`creation.js:182` 的 `Object.entries(styles)` 无兜底，而 `RenderStyles`（`calculateContainers.js:98-138`）与 `RenderItemStyles`（`creation.js:347-378`）都只处理 type `2/3/4` 且无 else → 返回 `undefined`。当前 `FormatAiContent` 只产 2/3/4 故未触发，属防御性缺口 | `creation.js:182`；调用点 `calculateContainers.js:80`、`creation.js:290`、`methods.js:370/1447` |
| 14 | **`hasBorderStyle` 是死代码且名实不符**：名字叫 Border，查的却是 `["background-color:"]`，全模块无调用点。另 `hasCurrentStyle`（决定「再点同类样式→移除」交互）用 `style` 字符串 `includes` 判断，遇 `border-bottom`/`border` 混用或属性顺序变化语义可能不符预期 | `creation.js:537-544`（死）、`:523-534`（用）；消费点 `methods.js:1409-1419` |
| 15 | **假进度条**：固定 350ms 线性递增到 90 停止，真实完成时直接跳 100；0→90 恒定约 31.5 秒，与真实进度完全无关（AI 5 秒返回则从 ~14% 跳到 100%） | `methods.js:119-125`、`:1631-1637`；跳变 `:344`、`:1705` |
| 16 | **空判定用隐式类型转换**：`if (evt.target.innerText < 1)` —— `innerText` 是字符串，与数字比较会 `Number()`；内容为 `"0"` 或 `"  "` 时被误判为空并清空。应为 `innerText.trim() === ""` | `methods.js:1085-1088` |
| 17 | **`this`/`_this` 混用**：`methods.js:452` 捕获了 `const _this = this` 却在 `:494` 的 catch 里用 `this`。当前靠箭头函数继承能工作，但两种写法混用说明作者对绑定不确定；与缺陷 1 叠加后是「能跑不能改」的典型 | `methods.js:451-452`、`:494-496` |
| 18 | **`templateConfig.json` 缓存参数硬编码**：`timemap=1767003138952`（约 2025-12-29）是固定字面量而非运行时生成 → 恒定 URL、可长期缓存，模板配置更新需改客户端发版；且远端是**整体覆盖**非合并——远端表少一套模板，本地也不会补回 | `request.js:15`；覆盖逻辑 `methods.js:22-28` |
| 19 | **`onEditableBlur` 是空操作**：整个函数体只在 `$nextTick` 里读了一下 `hasRemove` 就返回 | `methods.js:1065-1072` |
| 20 | **`onLazyLoading` 什么都没加载**：`IntersectionObserver` 回调里只有注释「加载资源」，`observerVal` 建了就丢、从不 `disconnect`。占位实现 | `methods.js:61-76` |
| 21 | **`_ruleList` 里 label/value 不一致**：按 label 做字体匹配必错 | `config.js:141-142`、`:163-164`、`:402-403`（详见 §4.4） |
| 22 | **`deepClone` 不能处理 Map/Set/Date/循环引用**（递归 + `hasOwnProperty`）；`_data` 恰好没有这些类型，故当前安全 | `utils.js:517-533` |

---

## 11. 未确认事项

1. **原生桥 `window.Js*` 的真实实现**。所有 `FnJs*` 只是 `window.Js*` 的直通包装（`clientApi.js:51-209`），实现在宿主二进制中。本次未做二进制分析，故**「写文件是否成功」「中止是否真断了网络请求」「目录选择器返回的路径格式」等真实行为未确认**。
2. **宿主是 CEF 还是 Electron**。§8.6 的推断基于「`window.Js*` 是同步函数」（`clientApi.js:78-80` 同步返回文件是否存在），与 Electron `ipcRenderer.invoke` 的异步形态不符。**未做二进制验证**，仅为推断。
3. **`templateConfig.json` 的线上实际内容**。需联网取 `https://static2.17van.com/images/xhs-template/templateConfig.json`。因此**线上真实模板数量、字段是否与本地 `_ruleList` 完全同构、是否真的返回 `_ruleList` 键，均未确认**——这直接影响缺陷 4 的实际触发频率。
4. **AI 接口的响应契约**。代码只处理 `result.choices[0].message.content`（`methods.js:147`、`:261`）与错误形态 `result.message || result.msg`（`:151`）。未实测，故**除成功/错误之外的响应形态（流式、内容审核拦截等）未确认**。
5. **`html2canvas` 具体版本与 `box-decoration-break` 支持程度**。`index.html:27` 引入 `./../assets/js/html2canvas.min.js`，本次未读该文件。故**「导出前 DOM 重写」到底为解决哪个具体渲染缺陷未确认**——只能确认代码确实做了这件事（`methods.js:1665-1669`）。
6. **字体是否由宿主持久化到本机**。`clientApi.js:171-174` 存在 `FnJsDownloadFont`（注释「下载字体」）但本模块无调用点。故「字体是否在别处被预下载并注册为系统字体、从而让 `font-family.css` 的远端 URL 实际不生效」**未确认**。
7. **用户自定义的高亮颜色/粗细是否随草稿保存**。`_dataKey`（`data.js:131-143`）11 个键**不含** `highlightList`，而用户修改写在 `highlightList` 上（`methods.js:1499/1509/1523-1524`）。**推断**：不随草稿保存，恢复后回到 `base.js` 默认值。此结论为静态推断，未实测。
8. **`template01` 缺少字段注释的原因**。`config.js:2-88` 的 `template01` 与 `:965-1044` 的 `template13` 是三套无注释模板中的两套，其余均有注释。**推断**是不同开发者/不同时期加入，未验证。

---

## 12. 纠正记录

### 纠正 1：「`lineBreaks.js` 是正文排版断行算法」—— **否证**

**早期判断**（来自文件命名暗示，我也一度采信）：它负责把正文按行拆分以适配排版。
**推翻证据**：① 全文件 7 个函数的输入都是 `window.getSelection()` 或 `Range`（`:189`、`:358`、`:425`），没有任何一个接受正文文本数组或模板规则；② 唯一生产调用在 `methods.js:1310-1321`，位于 `onCheckSelection()`（划重点的选区检查）内部；③ 真正的正文分页在 `calculateContainers.js`，且它用**高度**而非**行**作切分单位（`:167`）。
**修正结论**：`lineBreaks.js` 是**选区 → 视觉行**的测量工具，服务于「划重点」；其中 65% 是死代码。详见 §6。

### 纠正 2：「`config.js` 可能是 AI 输出到模板字段的映射表」—— **否证**

**早期判断**：文件名 `config.js` + 63 KB 体量，可能是「AI 返回结构 → 模板字段」的映射配置。
**推翻证据**：① 全文件只有两个常量（`:1`、`:1988`），无映射逻辑；② 字段全是几何与样式（`left/top/width/height/font{size,light,weight,align,color}`，`:94-107`），没有任何键指向 AI 响应字段名；③ AI 输出到内部结构的映射实际在 `creation.js:2-71` 的 `FormatAiContent`，且规则是**硬编码标签分派**（`<h1>→type"1"`、`<h2>→"2"`、`<h3>→"3"`、`<p>→"4"`，`:14-54`），与 `config.js` 无关。
**修正结论**：`config.js` 是**排版几何规则 + 模板目录**，运行时还被远端 `templateConfig.json` 整体覆盖。

### 纠正 3：「`xhs` 是否指小红书只能算推测」—— **升级为确认**

**早期判断**：按任务书措辞「疑似指小红书」，需证据。
**证据**：找到 6 条互相独立的直接证据（`index.html:6` 标题「AI生成红薯模版」；宿主注册表 `view-smart-clip/index.html:152-156` `name:"红薯模版"`；原生桥注释 `clientApi.js:166` 与调用点传 `5`；接口路径 `/dmx/xhs`；埋点键 `xhs_click_suc`/`categroy:"XHSMB"`/`XHSMB_OPENED`；1242×1660 画布 + 小红书典型选题分类）。
**修正结论**：**确认**，不再是推测。详见 §3.1。

### 纠正 4：「`lineBreaks.js` 的 7 个函数都在用，只是我还没找到调用点」—— **否证**

**早期判断**：读完 `lineBreaks.js` 后，看到 4 个功能相近的「按行切分」函数（`:188`、`:279`、`:357`、`:424`），先假设它们分别服务不同场景（选区高亮/导出/缩略图）。
**推翻证据**：对 `getSelectionLineInfo`、`safelyBreakSelectedTextByLines`、`getSelectedLinesSimple`、`getSelectionLinesRobust` 四名在**整个模块目录**做 grep，除定义处与 `:266` 那一次内部调用外**零命中**。
**修正结论**：`:188-531`（约 344 行，占全文 65%）是死代码，从未接线。同时发现 `getNextNodeInRange`（`:123-137`）是空壳，使**唯一在用的** `getVisualLinesFromSelection` 也只能处理单文本节点选区。详见 §6.2 与 §10-6。

### 纠正 5：「测量与渲染的差异可能只是我看漏了」—— **确认为真实缺陷（3 处）**

**早期判断**：读到 `calculateContainers.js:98-138`（测量样式）与 `creation.js:347-378`（渲染样式）时，先假设两者严格镜像，差异只是阅读遗漏。
**推翻证据**：逐字段对照后确认 **3 处实质差异**（icon 完全缺失、`_noMarginTop` 渲染侧无分支、副标题首项判据语义不同），每处都能定位到具体行号（§10-3a/3b/3c）。
**修正结论**：不是阅读遗漏，而是真实缺陷。由于该模块正确性**完全依赖**「测量高度 == 渲染高度」，这三处差异会直接表现为内容溢出或底部留白。**注**：溢出/留白的**方向**为推断（已标注），但差异本身是观察到的。

---

## 附：给 mulpub 的行动建议（按性价比排序）

1. **P0** — 移植 `calculateContainers.js` 分页引擎（§9.1），补上「长文 → 多图卡片」的能力空白。移植时**先合并两份重复的装箱实现**，并**补齐 icon 测量与 `_noMarginTop` 渲染分支**，否则会把缺陷 3 一起搬过来。
2. **P1** — `box-decoration-break: clone` 跨行高亮 + 导出前 DOM 重写补丁（§9.2）：低成本、直接提升图文卡片视觉完成度。
3. **P1** — `getClientRects` 视觉行工具（§9.3）：做富文本标注的必备底层能力。移植时**直接重写 `getVisualLinesFromSelection`**，参考同文件里那个未接线的正确实现。
4. **P2** — 模板规则「远端优先、本地兜底」双轨数据契约（§9.4），注意补 `?.` 兜底（缺陷 4）。
