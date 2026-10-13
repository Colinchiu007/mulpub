# 融媒宝 `view-ai-clip`（一键成片）模块拆解报告

- **分析时间**：2026-10-13 21:00 (Asia/Shanghai)
- **分析对象**：`D:\Program Files (x86)\融媒宝\Asset\dist\view-ai-clip\`（只读，未修改任何源文件）
- **产出目的**：为 mulpub（pnpm + Vue3 + Electron 43 多平台发布应用）提取可复用技术点
- **证据纪律**：结论均带 `文件名:行号`。**观察到的**＝代码直接写着；**推断：**＝附依据的推理；读不到/看不懂的写「**未确认**」并说明卡点。

---

## 目录

- [0. 文件清单与分析方法](#0-文件清单与分析方法)
- [1. 模块定位与用户可见功能](#1-模块定位与用户可见功能)
- [2. 架构真相：这不是 Electron（含两处自我纠正）](#2-架构真相这不是-electron含两处自我纠正)
- [3. 完整交互流程与调用链](#3-完整交互流程与调用链)
- [4. 与宿主的通信机制（逐字引用）](#4-与宿主的通信机制逐字引用)
- [5. 依赖的后端接口与平台能力](#5-依赖的后端接口与平台能力)
- [6. 值得 mulpub 借鉴的实现](#6-值得-mulpub-借鉴的实现)
- [7. 缺陷清单（分级）](#7-缺陷清单分级)
- [8. 未确认事项与卡点](#8-未确认事项与卡点)
- [9. 给 mulpub 的落地建议](#9-给-mulpub-的落地建议)

---

## 0. 文件清单与分析方法

### 0.1 必读文件（全部逐行读完）

| 文件 | 字节 | 物理行数 | 状态 |
|---|---|---|---|
| `main/methods.js` | 93,427 | 3,721 | ✅ 全量 |
| `index.html` | 74,174 | 2,513 | ✅ 全量 |
| `js/compose.js` | 9,827 | 374 | ✅ 全量 |
| `main/create.js` | 4,710 | 170 | ✅ 全量 |
| `main/data.js` | 4,337 | 218 | ✅ 全量 |
| `js/config.js` | **0** | 0 | ✅ 确认空文件 |
| `css/index.scss` | 11,984 | 784 | ⚠️ 读 120 行（仅为了解布局，见 6.6） |

> **行号口径**：PowerShell `Measure-Object -Line` 不统计空行（`methods.js` 非空 3,161 + 空行 560 = 3,721）。本文一律用**物理行号**，已用 CRLF 计数交叉验证（3,721 个 CRLF、0 个孤立 CR）。

### 0.2 为回答 Q3/Q4 而额外读的依赖文件

`view-ai-clip` 自身**不含**桥接层与 HTTP 层，全部依赖兄弟目录（`index.html:2498-2511` 的 script 列表）。不读它们无法回答「怎么和宿主通信／依赖哪些接口」，故一并只读：

| 文件 | 字节 | 在链路中的作用 |
|---|---|---|
| `view-smart-clip/js/clientApi.js` | 10,515 | **桥接层核心**：`interface` 对象 |
| `view-smart-clip/index.html` | 7,563 | **宿主 shell**，持有 `aiClipIframe` |
| `common/request.js` | 2,283 | `Ajax`/`POST_J` + 业务端点 |
| `view-smart-clip/js/request.js` | 881 | 行为投递端点 |
| `js/charToPy.js` | 5,890 | `contentTransition`（TTS 文本协议） |
| `js/utils.js` | 22,446 | 通用工具（61 函数） |
| `js/tools.js` | 2,982 | `escapeSpecialChars` 等文本工具 |
| `store/useClip.js` | 47,506 | 全部 UI 配置常量（2,298 行） |
| `js/storage.js` | 1,004 | `$local`/`$session` |
| `view-smart-clip/js/colorPocker.js` | 2,029 | `_PredefineColors`/`_selectColors` |
| `js/CaretUtil.js`、`store/upload.js` | — | 仅定位被引用函数的定义行 |

---

## 1. 模块定位与用户可见功能

### 1.1 一句话定位

**「一键成片」：用户上传 5–20 段视频素材并填写营销文案要素，由大模型生成 N 组分镜脚本与口播文案，前端自动完成素材组合、TTS 配音、字幕/标题/花字/转场/BGM 编排，最后把一份 JSON 编排数据交给本地原生合成引擎批量出片。**

依据：页面标题「一键成片」（`main/data.js:28`、`index.html:6`）；埋点事件名贯穿全链 `enter_slicing`（`create.js:76`）、`upload_slicing`（`methods.js:229`）、`synthetize_slicing`（`methods.js:1137`）、`download_slicing`（`methods.js:3693`）；成片出口为 `interface.FnJsCreateWork`（`methods.js:3683`）。

### 1.2 用户可见功能（均出自 `index.html` 模板绑定）

| 分组 | 功能 | 证据 |
|---|---|---|
| 素材 | 上传（≤20 个；单段 2s–120s 校验）、原声开关、预览、删除 | `methods.js:196-216,234-251,281-283,270-278` |
| 文案 | AI 生成「产品卖点」候选词（点击采纳/刷新） | `methods.js:286-331`；`index.html:238-249,303-324` |
| 文案 | 字段可增删：视频主题/产品卖点/突出关键词 + 行业/店铺/优惠/人群/痛点 | `store/useClip.js:23-123`；`methods.js:334-346` |
| 配音 | 全局音色选择 + 「情绪主播」情绪子选；停顿优化开关 | `index.html:369-404,1986-2196`；`methods.js:2124-2328,1044-1058` |
| 音乐 | 素材库选择 / 本地上传 / 音量 | `index.html:760-875`；`methods.js:360-427,2539-2681` |
| 输出 | 9:16 / 16:9；生成数量 1–100（受创点约束）；立即生成 | `create.js:80-91`；`data.js:50`；`methods.js:524-531,534-587` |
| 结果 | 展开收起、全选/单选、批量下载、**拖拽框选** | `methods.js:1270-1286,3402-3544` |
| 编辑 | 4 Tab 抽屉：字幕/标题/音乐/转场 | `index.html:878-1950`；`data.js:90-116` |
| 字幕 | 逐句编辑、Enter 拆行、粘贴自动分句、1000 字上限 | `methods.js:1569-1693` |
| 字幕 | 多音字纠正、插入停顿、数字读法 | `methods.js:1745-1788,1806-1815`；`useClip.js:926-932` |
| 样式 | 字体族/字号/颜色（含最近使用色）/粗斜下划线/对齐/字体样式/花字 | `methods.js:1900-2121` |
| 标题 | 最多 100 条，含开始时间/持续时间 | `methods.js:2430-2501`；`index.html:1316-1576` |
| 转场 | 随机转场开关 / 自选 / 清空 | `methods.js:2694-2743` |
| 预览 | 播放器（播放/暂停/拖拽进度/音量/全屏）+ 大窗「查看视频」 | `methods.js:2858-3261`；`index.html:2286-2460` |
| 杂项 | 草稿（保存/保存并退出/直接退出）、下载路径、剩余创点+购买引导、教程外链、渠道(OEM)文案 | `methods.js:117-162,181-190,46-75,1257-1267,31-43` |

### 1.3 技术栈（观察到的）

**Vue 3**（Options API，`create.js:1`）+ **Element Plus 2.9.6**（`index.html:17,20-21`）+ **jQuery 3.5.0 并存**（模板事件里 `$(cls).eq(0).attr(...)`，`methods.js:20`；jQuery 直接操作音视频元素，`methods.js:415-423,1471,3030`）+ **big.js**（时长浮点，`methods.js:240-242,1211-1247`）+ **dayjs** + **VueUse**（`methods.js:3174`）。

**源码未压缩、未打包、带中文注释，逐个 `<script>` 加载**——这不是 bundle，就是原始源码。

---

## 2. 架构真相：这不是 Electron（含两处自我纠正）

### 2.1 三层结构（观察到的）

```
原生宿主（C++/CEF，不在本模块内）
  注入 window.Js*（JsSwitchPage/JsCreateWork/JsTextToAudio/JsStartSelectVideo/JsSaveDraft…）
   ↑ 下行 RPC                              ↓ 上行回调（见 4.2）
        ↕
Shell 页  view-smart-clip/index.html   ← pageId 路由 + interface 定义
  · window.clientSwitchPage / clientSetLoginUser        :177-178
  · 持有 6 个 iframe，含 <iframe id="aiClipIframe">      :80-86
        ↕ iframe.contentWindow.clientSet*
业务页  view-ai-clip/index.html        ← 本次分析对象
  · created() 注册 5 个 window.clientSet* 回调          create.js:9-13
  · 全文通过 interface.FnJs* 走宿主                     methods.js
```

证据链：iframe 声明 `view-smart-clip/index.html:80-86`；路由表 `:121-157`（`id:4` → `./../view-ai-clip/index.html`）；`interface` 定义与 iframe 转发 `clientApi.js:1,382-386,424-440`；业务页注册回调 `create.js:9-13`。

### 2.2 ⚠️ 纠正 1：我最初判断「这是 Electron renderer」——错了

**推翻依据**：① 桥接是 `window.Js*` 全局函数 + `interface.FnJs*` 包装（`clientApi.js:51-209`），**不是** `ipcRenderer.invoke`/`contextBridge`；② 业务页是被 shell 用 `<iframe>` 嵌入的（`view-smart-clip/index.html:80-86`），不是 `BrowserWindow`/`WebContentsView` 模型；③ 重活（合成）委托原生 `FnJsCreateWork`，页面只做编排——典型的 **CEF 混合应用（native shell + embedded web UI）**。

**对 mulpub 的启示**：桥接风格不可照抄（我们只有 IPC），但**「前端只产编排 JSON、重活交后端/原生」的职责切分完全可移植**。
**未确认**：宿主框架（CEF / WebView2 / 自研）——本模块无框架指纹，`interface` 与 `window.Js*` 是宿主无关命名。

### 2.3 ⚠️ 纠正 2：`js/config.js` 不是配置源

**最初判断**：任务清单把它列为必读，推测是模块配置中心。
**推翻依据**：① 实测 **0 字节**；② 全模块 grep `config.js` **零命中**——`index.html:2498-2511` 的 13 个 `<script>` 里**没有它**；③ 真正的配置源是 `store/useClip.js`（47,506 字节 / 2,298 行，`index.html:2505` 加载）。

**结论**：`view-ai-clip/js/config.js` 是**随包发布的 0 字节死文件**（很可能是打包时误套 `view-smart-clip/js/config.js` 流程留下的空壳）。本报告后续「配置」一律指 `store/useClip.js`。

---

## 3. 完整交互流程与调用链

### 3.1 进入页面

```
Shell created()
 ├─ 清洗 localStorage，仅保留 3 键                view-smart-clip/index.html:163-172  ⚠️ 见 4.6
 ├─ window.clientSwitchPage / clientSetLoginUser  :177-178
 └─ 点「一键成片」→ onSwitchPage(4)                :215
     ├─ 读 localStorage "AICLIP_SOURCE"            :229
     │   ├─ "HOME"/"DRAFT" → loading + 200ms 延迟  :231-244
     │   └─ 其他 → 切页 + postMessage{type:"buy"}  :245-261
     └─ aiClipUrl = url?did=…&channel=…&timestamp= :307-317
 → <iframe id="aiClipIframe"> 载入业务页            :80-86

create.js created()
 ├─ 注册 5 个 window.clientSet* 回调               :9-13
 ├─ new BroadcastChannel("smart-clip")             :16
 ├─ interface.getUrlParams()                       :17
 ├─ loginInfo = $local.get("AICLIPLOGIN") || interface.loginInfo  :18
 ├─ pageTitle = session AICLIP_PAGETITLE || `一键成片_${dayjs}`   :21-23
 ├─ onInspectChannel() → GetChannelList            :26  / methods.js:31-43
 ├─ onInspectCreatePoint() → 读 $local 判创点       :27  / methods.js:46-65
 ├─ 恢复 $local: AICLIP_MUSIC/ANCHOR/DUBPAUSE      :30-32
 ├─ AICLIP_SOURCE 分流（DRAFT → onDisplayDraft）    :35-47
 └─ onInitDubMusic() → GetVoiceActor + GetMusic    :49  / methods.js:878-962
mounted()
 ├─ broadcastVal.onmessage: login/buy              :54-66
 ├─ storagePath.create = $local.get("CreatePath")  :68
 ├─ resize → debounce(onCalculateAspectRatio, 150) :70-72
 └─ 埋点 "enter_slicing"                           :76
```

### 3.2 素材上传（原生选择 → 回调注入）

```
点「添加素材」→ onShowUploadFile(evt)      index.html:163/214 → methods.js:195-216
 ├─ materialList < 20 ? → disabledCreation=true
 │    interface.FnJsStartSelectVideo(3,"AICLIP_LENS1",1)          methods.js:199
 └─ 否则弹「素材超过上限」（最多 20）                              methods.js:202-214
 ↓ 原生文件选择器
clientSetFileSrc(json,"AICLIP_LENS1")  clientApi.js:346-348 → create.js:9
 └─ onClientSetFileSrc(data,id)                                  methods.js:219-230
     ├─ materialList = FnSetFileSrc(data, materialList)   store/upload.js:17
     ├─ 逐个 interface.FnJsGetVideoInfo(3,item.uuid,item.url)     methods.js:226
     └─ 埋点 "upload_slicing"                                    methods.js:229
 ↓ 原生抽帧/探时长
clientSetVideoInfo(v,uuid)             clientApi.js:339-343 → create.js:10
 └─ onClientSetVideoInfo(v,uuid)                                 methods.js:233-252
     ├─ v.duration > 2000ms → 写 cover/duration_old/duration_new
     │    /duration_audio/duration_video；disabledCreation=仍有素材无 cover  :246-247
     └─ 否则剔除该素材 + 「不允许添加时长不超过两秒的素材」          :249-250
```

### 3.3 「立即生成」主链（核心）

```
onCreate()                                    index.html:500 → methods.js:534-587
 ├─ 校验：素材≥5 / 主题非空 / 数量非空 / 数量≤剩余创点            :538-553
 └─ onStartCreation()                                            :564-587
     ├─ labelMap = ["视频主题:x","产品卖点:a、b",…]               :565-573
     ├─ onFormatResItem → createResList.unshift()
     │    · id=Date.now(), status="2", model="deepseek-r1-0428"   :592,606
     │    · materialList=deepClone(materialList), videoW/H         :597,603-604
     ├─ createResList.length > 20 → pop() 丢弃最旧                 :579-582
     └─ onSafeAsyncAssign(newItem)                                :584 / :612-732
         ├─ setInterval 假进度 1→90（500ms +1）                    :615-621  ⚠️ M2
         ├─ AIModelCreation({type:2, model, prompt:
         │    JSON.stringify({"[key1]":min(limit,5),
         │    "[key2]":"150-300字","[key3]":titleMap.join(",")})}) :623-633
         ├─ 对象已被移除？→ throw                                 :635-638
         ├─ 懒加载主播/音乐表                                      :640-646
         ├─ finish_reason === "content_filter" → 提示+shift()+解禁  :649-658
         ├─ resultCont = choices[0].message.content                :660
         ├─ onFormatDubItem(resultCont,limit) → subT[]             :663 / :735-797
         │    按 /【方案\d+】/ 切分 → trimChineseQuotes →
         │    splitSymbolText → processText（每 13 字断行）         :737-747
         ├─ mlt = FnCompositeVideo(materialList, limit)            :676 / compose.js:7
         ├─ 每个组合 push 一个 child（cover/status/percentage/
         │    materialIds/subT/ft/dub/tle/music/transition）        :681-710
         ├─ desc = "…为您生成<span>N</span>条视频…"                 :713
         └─ onTextToAudio("1", originItem)  ← 进入批量 TTS          :716
```

### 3.4 TTS 文本转语音（批量 → 逐条回调）

```
onTextToAudio("1", data)                                       methods.js:965-1004
 ├─ 筛 hasSpaceValue(text) && voiceText !== text                :972-984
 ├─ setInterval 150ms 逐条发                                     :987-997 ⚠️ M1
 │    interface.FnJsTextToAudio(3, textMap[count])              :991
 │      → clientApi.js:153-159：
 │         b.input = setConvertWrap(
 │                    contentTransition(
 │                       escapeSpecialChars(b.input), b), true)
 │         window.JsTextToAudio(a, JSON.stringify(b))           :158 ⚠️ C1
 └─ toAudioList[data.id]={total,convert:0}；toAudioCount++       :999-1004
 ↓ 原生 TTS
SetTextToAudioResult(a,b,c,d,e,f,g,h)     clientApi.js:316-318
 └─ IframeWindowClip(h).clientSetTextAudio(c,g,a,b,d,e,f)       :317 ← 参数重排，见 4.3
     → window.clientSetTextAudio(code,msg,id,text,path,channels,duration)  create.js:11
     → onClientSetTextAudio(...)                                methods.js:1061-1207
        ├─ ids = fnSplitAndConvert(id)   // "dataId-workId-dlgId"  :1062
        ├─ obj = toAudioList[ids[0]]; obj.convert += 1             :1065-1066
        ├─ createRes = createResList.find(id===ids[0])             :1068 ⚠️ H2
        ├─ code===1 → 写 voiceText/voicePath/voiceChannels/voiceDuration :1073-1077
        ├─ 本作品全部有 voicePath？
        │    → works.totalDuration=ΣvoiceDuration; status="1";
        │      works = fnCreateVideo(works, materialList)          :1089-1098
        └─ obj.convert === obj.total（本任务全部完成）
            ├─ onGetCreationPoints() 计费（30s=0.5 点）             :1101 / :1235-1250
            ├─ onCountCreationPoints() → DeductCreatePoint         :1102 / :1219-1234 ⚠️ C2
            ├─ postMessage{type:"Points", value:num*10}            :1105-1108
            ├─ 仍有未配音台词？→ 递归 onTextToAudio("1")            :1111-1120
            ├─ onFormatConvertDub(createRes)  // 补空 subT          :1122 / :800-815
            ├─ percentage=100→status="1"→percentage=0 清定时器      :1124-1130
            ├─ disabledCreation = false                            :1132
            ├─ onInitDragSelect(createRes)                         :1133-1135 ⚠️ H3
            ├─ 埋点 synthetize_slicing / dubbing_synthesis          :1137-1142
            └─ onSaveDraft("create")                               :1144
```

### 3.5 编辑作品（右侧抽屉，4 Tab）

```
onEditWorks(i,j)                    index.html:608 → methods.js:1289-1299
 ├─ createResItem=i；worksItem=deepClone(j)   ← 深拷贝=可取消编辑
 └─ drawerVisible=true
    el-drawer @opened → onOpenDrawer()   index.html:889 → methods.js:1302-1309
     ├─ onSetDialogCursor(0)
     ├─ createColorPickerEl(".ColorPickerCtn","AICLIP_COLORS",this)  :1304
     └─ $nextTick → onCalculateAspectRatio(".model-view-wrap")       :1306-1308

Tab 切换 onSetConfigTabs(v)                                        methods.js:1318-1335
 ├─ 1/2 → previewType 切换 + 定位光标
 ├─ 4   → onShowTransition() 回填 checked
 └─ 有音乐在播 → onAuditionMusic(isMusic,0) 停掉

字幕 Tab
 ├─ 聚焦 onDialogFocus（debounce 120ms）  :1446 / index.html:953
 │   ├─ onPreviewDialog(id) → previewDub 合成预览样式      :1353-1358
 │   ├─ onDialogWatch() 注册 input/composition*           :1509-1531
 │   └─ onShowFirstFrame() 跳到该句首帧                    :1456-1499
 ├─ Enter 拆行：type = 光标 0→"1"(前插) / 中间→"2"(拆分) / 末尾→"3"(新增)
 │                                            :1570-1593 / :1849-1897
 ├─ Backspace 合并/删除                                    :1595-1623
 ├─ 粘贴 → splitSymbolText 自动多段                        :1627-1675
 └─ 单句配音 onControlVoice("1") → onTextToAudio("2")       :1696-1717 → :1015

确认生成 onConvertDubbing()             index.html:1788 → methods.js:2746-2774
 ├─ onConfirmVoice() 全部已配音？                          :2941-2953
 │   ├─ 是 → onResetTransition() 随机化 xfade
 │   │      写回 createResItem.worksList[id]={...worksItem,status:"2"}
 │   │      setInterval +10/100ms 到>60 → percentage=10/status="1"
 │   │      →「生成成功!」                                  :2759-2769 ⚠️ M2 假进度
 │   └─ 否 → player.status="Generate"；onTextToAudio("3")   :2770-2773
```

### 3.6 预览与播放（三入口共用一个播放器）

```
入口 A 抽屉内播放  onPlayPreviewVideo()   index.html:1893 → methods.js:2858-2907
入口 B 查看视频    onOpenRealPreview()    index.html:629  → methods.js:3280-3294
                    → onOpenedRealPreview() index.html:2294 → methods.js:3296-3307
入口 C 进度拖拽    onMoveProgressBar()    index.html:1937/2447 → methods.js:3166-3202

播放模型（data.js:183-196 player + playTimer）
 ├─ 主时钟 = setInterval 200ms 手动累加 progressBar      methods.js:3038-3059
 │   （不是 video 的 timeupdate）
 ├─ onPlaying() → onPlayingMaterial / Dubbing / Title
 │   · 素材：curTime >= getCurrentPlayItem.stopTime → videoPlayId+1
 │   · 配音：curTime >= getCurrentDubItem.stopTime → dubPlayId+1 + onLoadDialog
 │   · 标题：filter(playTime > currentTime) + 按 beginTime/playTime 补入
 └─ 结束 onEndPreviewVideo() → repeatPlay=true, status=""
```

**关键设计**：`worksItem.newMaterial[i]` 携带 `beginTime/endTime/playTime/xfadeDuration/stopTime/newId/show`，全部由 `compose.js:210-319 fnCreateVideo()` 一次算好；播放器只做**整数索引查找**，不建时间轴数据结构（见 6.2）。

### 3.7 合成下载

```
onDownloadDialog(t,i,j) debounce 200ms  index.html:586/610 → methods.js:3550-3561
 ├─ downDisabled 防重入；downType "1"批量/"2"单条
 └─ onClientParams()                                          methods.js:3563-3694
     ├─ 组装原生合成 DTO：
     │   {title, type:3, videowidth, videoheight, bgmusicvol:40,
     │    bgmusicdata[], globalsubtitledata[][], globaltextdata[][],
     │    lenslist[0].{videolist[],…}, worklist[]}             :3568-3589
     ├─ 每条作品 child={globalsubtitleindex,globaltextindex,
     │                  bgmusicindex,lens[],bgmusicvol}          :3604-3610
     ├─ 字幕节点 onFormatClientSubT + align + setConvertWrap
     │   + audiopath/channels/duration(ms)                      :3625-3638
     ├─ 标题节点 begintime/duration(ms) + align:7                :3645-3653
     ├─ 素材节点 videoindex/xfade/xfadeduration:800/begintime/endtime :3660-3672
     ├─ console.log(clientData)                                 :3680 ⚠️ m8
     └─ interface.FnJsCreateWork(2, bid, JSON.stringify(clientData)) :3683
         ├─ 提示「合成中,请在任务中心查看」                        :3687
         └─ onSaveDraft("create") + 埋点 download_slicing         :3686,3693
```

### 3.8 草稿

```
保存 onSaveDraft(type)              index.html:56 → methods.js:117-145
 ├─ source = session AICLIP_SOURCE === "DRAFT" ? 2 : 1        :118
 ├─ draftData={draftTitle,createTime,categroy:"AICLIP",contetCover} :119-124
 ├─ _dataKey（10 键）逐个拷入            data.js:207-218 / methods.js:125
 ├─ createResList 只留 status==="1"                            :127-129
 ├─ source===1 → draftUuid=generateUUID()；session AICLIP_SOURCE="DRAFT" :131-134
 └─ interface.FnJsSaveDraft(2, source, draftUuid, JSON.stringify(draftData)) :136-141

恢复 onDisplayDraft()                                          :93-114
 ├─ result = $local.get("DraftData")
 ├─ _dataKey.forEach(k => this[k] = result[k])   ← 白名单回填   :103
 ├─ $nextTick → onInitDragSelect(每条)                          :105-109
 ├─ this.draftUuid = result.bid                ⚠️ H4（result.bid 从未被写入）
 └─ $local.remove("DraftData")
```

---

## 4. 与宿主的通信机制（逐字引用）

### 4.1 下行 RPC：业务页 → 宿主

业务页**只**调 `interface.FnJs*`，不直接碰 `window.Js*`。`interface` 是 shell 页定义的全局对象（`clientApi.js:1`），经 iframe 同源 `window` 共享。

**本模块用到的全部下行通道**（逐字引用）：

```js
interface.FnJsBuyCreatePoints(3)                     // methods.js:60   购买创点
interface.FnJsSwitchPage(3, 3)                        // methods.js:70   跳页
interface.FnJsSaveDraft(                              // methods.js:136-141 保存草稿
    2, source, this.draftUuid, JSON.stringify(draftData)
)
interface.FnJsStartSelectFolder(3, "Download")        // methods.js:182  选下载目录
interface.FnJsStartSelectVideo(3, "AICLIP_LENS1", 1)  // methods.js:199  选素材
interface.FnJsGetVideoInfo(3, item.uuid, item.url)    // methods.js:226  抽帧/探时长
interface.FnJsStartSelectMusic(3, this.uploadMusicId, 0) // methods.js:391 选音乐
interface.FnJsTextToAudio(3, textMap[count])          // methods.js:991  文字转语音（另见 :1015/:1033/:2520）
interface.FnJsDownloadFont(3, item.value)             // methods.js:1918 下载字体
interface.FnJsCreateWork(2, bid, JSON.stringify(clientData)) // methods.js:3683 提交合成
```

包装实现（逐字引用，`clientApi.js`）：

```js
FnJsStartSelectVideo: (a, b, c) => { window.JsStartSelectVideo(a, b, c) },   // :138-140
FnJsCreateWork: (a, b, c) => { window.JsCreateWork(a, b, c) },               // :108-110
FnJsSaveDraft: (a, b, c, d) => { window.JsSaveDraft(a, b, c, d) },           // :123-125
window.JsTextToAudio(a, JSON.stringify(b))                                   // :158
```

**首参约定（观察到的，已用兄弟模块交叉验证）**：

| 调用族 | 一键成片（本模块） | 批量混剪（兄弟模块） | 语义 |
|---|---|---|---|
| `FnJsTextToAudio`/`FnJsStartSelectVideo`/`FnJsStartSelectFolder`/`FnJsSwitchPage` 首参 | `3` | `2` | **iframe 标识**：`clientApi.js:427-434` `iframeMap2 = { 2: clipIframe, 3: aiClipIframe }` |
| `FnJsCreateWork`/`FnJsSaveDraft` 首参 | `2` | `1` | **作品来源类型**（1=批量混剪，2=一键成片） |

交叉证据：`view-smart-clip/main/clipMethods.js:243`（`FnJsTextToAudio(2, child)`）、`:4984`（`FnJsCreateWork(1,…)`）、`:4601`（`FnJsStartSelectFolder(2,"Download")`）、`view-smart-clip/index.html:194`（`FnJsSwitchPage(2,3)`）。
**未确认**：`FnJsSwitchPage(3, 3)` 第二参语义；`FnJsBuyCreatePoints` 的 2 与 3 的套餐差异（`clientApi.js:166` 注释仅说明「1、2、3 混剪购买创点、4 购买字符、5 红薯模版购买创点」）。

### 4.2 上行回调：宿主 → 业务页（跨两跳）

`interface` 是**全局变量**（`clientApi.js:1` `var interface = {…}`，即 `window.interface`），宿主可按名触达其方法（如 `SetVideoInfo`/`FnSetFolder`/`SetTextToAudioResult`）；shell 另在 `window` 上直接挂了两个：`window.clientSwitchPage`、`window.clientSetLoginUser`（`view-smart-clip/index.html:177-178`）。宿主侧具体解析方式**未确认**（推断：宿主按注册的"web interface 对象"名字解析 `interface.<Method>`，因为 `LoginUserChange` 等函数定义在该对象内且必须被宿主触发，`clientApi.js:216-243`）。

shell 再通过 `iframe.contentWindow.clientXxx(...)` 转发进业务页。逐字引用：

```js
// clientApi.js:316-318   文字转语音结果（参数被重排！见 4.3）
SetTextToAudioResult: (a, b, c, d, e, f, g, h) => {
    IframeWindowClip(h).clientSetTextAudio(c, g, a, b, d, e, f)
},

// clientApi.js:339-343   视频素材信息
SetVideoInfo: (a, b, c, d, e) => {
    d = d.replace(/[\\]/g, "\\\\")
    let result = isJsonType(d) && c === 1 ? JSON.parse(d) : ""
    IframeWindowClip(e).clientSetVideoInfo(result, a)
},

// clientApi.js:346-353   素材/音乐文件列表
FnTransferFileSrc: function (a, b) { IframeWindowClip(false).clientSetFileSrc(JSON.parse(a), b) },
FnSetMusicUrl: a => { IframeWindowClip(false).clientSetMusicFile(JSON.parse(a)) },

// clientApi.js:356-386   选择目录（多播到两个 iframe）
FnSetFolder: (a, b) => {
    interface.storagePath.type = b
    if (b === "Download") { interface.SetCreateWorkPath(a); interface.FnJsCreateWorkPathUpdate(a) }
    else if (b === "Works") { … } else if (b === "Draft") { … }
    …
    const aiClipEl = document.getElementById("aiClipIframe")
    if (aiClipEl) { aiClipEl.contentWindow.clientSetSelectFolder(b, a) }
},

// clientApi.js:241-242   登录态（先写 localStorage 再通知 shell）
localStorage.setItem("AICLIPLOGIN", JSON.stringify(info))
window.clientSetLoginUser(info)

// clientApi.js:424-440   iframe 选择器
function IframeWindowClip(from) {
    let clipIframe = document.getElementById("clipIframe")
    let aiClipIframe = document.getElementById("aiClipIframe")
    const iframeMap  = { 1: clipIframe, 4: aiClipIframe }
    const iframeMap2 = { 2: clipIframe, 3: aiClipIframe }
    const result = from ? iframeMap2[from] : iframeMap[localStorage.getItem("CLIP_PAGEID")]
    return result ? result.contentWindow : {}
}
```

**业务页注册的 5 个回调**（逐字引用，`create.js:9-13`）：

```js
window.clientSetFileSrc = this.onClientSetFileSrc           // 客户端设置素材地址
window.clientSetVideoInfo = this.onClientSetVideoInfo       // 客户端设置素材信息
window.clientSetTextAudio = this.onClientSetTextAudio       // 客户端设置文本音频
window.clientSetMusicFile = this.onClientSetMusicFile       // 客户端设置文本音频 ← 注释复制错误，实为音乐
window.clientSetSelectFolder = this.onClientSetSelectFolder // 客户端设置选择的目录
```

**跨帧契约签名表**：

| shell/宿主调用 | 业务页实现 | 形参 |
|---|---|---|
| `clientSetFileSrc(json, id)` | `methods.js:219` | `(data, id)` |
| `clientSetVideoInfo(v, uuid)` | `methods.js:233` | `(v, uuid)` |
| `clientSetTextAudio(c,g,a,b,d,e,f)` | `methods.js:1061` | `(code,msg,id,text,path,channels,duration)` |
| `clientSetMusicFile(json)` | `methods.js:2540` | `(data)` |
| `clientSetSelectFolder(id, val)` | `methods.js:186` | `(id, val)` |

### 4.3 ⚠️ 参数重排陷阱（全模块最脆弱的接口）

`SetTextToAudioResult(a,b,c,d,e,f,g,h)` 在 `clientApi.js:317` 被**重排**为 `clientSetTextAudio(c, g, a, b, d, e, f)`，而业务页形参名是 `(code, msg, id, text, path, channels, duration)`。反推映射：

| 宿主入参 | 传给业务页位置 | 业务页形参 |
|---|---|---|
| `c` | 1 | `code`（1=成功） |
| `g` | 2 | `msg` |
| `a` | 3 | `id`（`"dataId-workId-dlgId"`） |
| `b` | 4 | `text` |
| `d` | 5 | `path`（音频文件路径） |
| `e` | 6 | `channels` |
| `f` | 7 | `duration`（ms） |
| `h` | — | 仅用于选 iframe |

**7 个位置参数、跨语言（C++→JS）、跨两跳（宿主→shell→iframe）、两端参数名部分不一致（`g`→`msg`）、且无任何校验**。任一端调序都会静默错位（例如把音频路径当 `code`）。同源问题：`clientApi.js:341` 用数字入参 `c === 1` 当类型开关。

### 4.4 BroadcastChannel：`"smart-clip"` 跨 iframe 事件总线

业务页：`this.broadcastVal = new BroadcastChannel("smart-clip")`（`create.js:16`）。

**本模块发出**（逐字引用）：

```js
// methods.js:83-86   取消/关闭「退出」「购买」弹窗 → 让 shell 重建 iframe
this.broadcastVal.postMessage({ type: "Reload", value: 4 })

// methods.js:1105-1108   扣点后同步剩余创点（注意 ×10）
this.broadcastVal.postMessage({ type: "Points", value: num * 10 })
```

**本模块接收**（`create.js:54-66`）：`"login"` → `loginInfo = JSON.parse(e.data.value)` + `onInspectCreatePoint()`（来源 shell `view-smart-clip/index.html:300-305`）；`"buy"` → `onInspectCreatePoint()`（来源 shell `:257-260`）。

**shell 侧消费**（`view-smart-clip/index.html:185-206`）：

| `type` | 处理 |
|---|---|
| `"page"` | `onSwitchPage(value)` |
| `"Reload"`=1 | 重建 `smartClipUrl` + `FnJsSwitchPage(2, 3)`（`:194`） |
| `"Reload"`=4 | 重建 `aiClipUrl` + `FnJsSwitchPage(3, 3)`（`:197`） |
| `"Points"` | `interface.SetCreatePoints(value)`（`:201`） |
| `"buy"` | 由 shell 发出（`:257`），非 shell 消费 |
| `"RE_ENTER_PAGE"` | 红薯模板专用（`:288-291`） |

**为什么用 BroadcastChannel 而非 iframe 直接调用**：`Reload` 需要**重建 iframe**（`onResetUrl` 追加 `&timestamp=` 强制刷新，`view-smart-clip/index.html:307-317`），此时业务页正在销毁，无法自己完成——必须先广播给 shell 拆 iframe。

**`Points` 的 ×10 换算**：业务页 ×10 广播（`methods.js:1107`），shell `SetCreatePoints(value)` → `LoginUserChange` 内直接存（不除 10，`clientApi.js:281`），但宿主入参处做了 `createpoints / 10`（`clientApi.js:234`）。**推断**：宿主↔JS 之间创点以 0.1 为单位传输，JS 展示用整数。依据：`methods.js:544` 用整数 `createpoints` 与生成数量比较，而 `onGetCreationPoints` 返回 0.5 粒度小数（`methods.js:1239-1245`）。**未确认**宿主侧单位定义。

### 4.5 存储约定

`$local`/`$session` 是 localStorage/sessionStorage 薄包装（`js/storage.js:1-56`）；`get()` **自动 JSON.parse**（`storage.js:5`），但 `set()` **不序列化**（`storage.js:10-12`）——调用方必须自己 `JSON.stringify`（如 `methods.js:406`）。

| 键 | 域 | 用途 |
|---|---|---|
| `AICLIPLOGIN` | local | **登录态 + 剩余创点（含 token）**，`clientApi.js:241` 写入 |
| `AICLIP_SOURCE` | session（先经 local 搬运） | HOME/DRAFT，决定是否重建 iframe（`create.js:35-47`） |
| `AICLIP_PAGETITLE` | session | 标题续存（`methods.js:168`） |
| `AICLIP_MUSIC` / `AICLIP_ANCHOR` / `AICLIP_DUBPAUSE` | local | 音乐配置 / 默认音色 / 停顿开关（`methods.js:406,2248,431`） |
| `AICLIP_COLORS` | **session** | 最近使用颜色（`colorPocker.js:83`） |
| `DraftData` | local | 草稿载荷（`methods.js:94,113`） |
| `CreatePath`/`WorksPath`/`DraftPath` | local | 目录（`clientApi.js:247,256,265`） |
| `PageId`/`CLIP_PAGEID` | local | shell 当前页（`view-smart-clip/index.html:216,263`） |
| `AICLIP_OPENED` | local | 已开启标记（`methods.js:71,82,329`） |

### 4.6 ⚠️ Shell 启动时的 localStorage 大清洗

逐字引用（`view-smart-clip/index.html:163-172`，shell 的 `created()`）：

```js
const allKeys = Object.keys(localStorage)
const keysToKeep = [ "AICLIP_ANCHOR", "AICLIP_MUSIC", "AICLIP_DUBPAUSE" ]
const keysToRemove = allKeys.filter(key => !keysToKeep.includes(key))
keysToRemove.forEach(key => { localStorage.removeItem(key) })
```

**观察到的**：进入 AI 创作 shell 时，除 3 个白名单键外清空整个 localStorage——含 `AICLIPLOGIN`（token+创点）、`CreatePath`、`PageId`、`DraftData`、`CLIP_*`。

**纠正在此处的早期判断**：我最初怀疑这会**打断草稿流程**（`onDisplayDraft` 依赖 `DraftData`）。
**推翻依据**：`created()` 属于 **shell 顶层页**，shell 只在进入该模块时加载**一次**；而 `DraftData`/`AICLIP_SOURCE` 是由**已加载 shell 内部**的 `my-draft.html`（iframe pageId 3）在点「编辑草稿」时才写入（`view-smart-clip/index.html:225-244` 消费）。清洗发生在此之前，**不冲突**。

**仍然成立的结论**：清洗与宿主推送登录态存在**强时序依赖**——`AICLIPLOGIN` 被删后必须由宿主重新触发 `LoginUserChange`（`clientApi.js:216-243`）才能恢复；否则 `create.js:18` 拿到空值 → `loginInfo.createpoints = 0`（`data.js:4` 默认）→ `onCreate` 对任何生成数量都报「预计生成创点不足」（`methods.js:544`），且 `SetCreatePoints` 因键缺失而**静默 return**（`clientApi.js:280`）使「Points」同步失效。
**未确认**：宿主是否在每次 shell 启动后主动重推登录态。**这是本报告最重要的未确认项**（见 8.2）。

---

## 5. 依赖的后端接口与平台能力

### 5.1 HTTP 端点（全部列出）

业务页加载 `common/request.js`（`index.html:22`）与 `view-smart-clip/js/request.js`（`:2499`）。

| JS 函数 | 方法 | URL | 成功判据 | 定义 / 调用 |
|---|---|---|---|---|
| `GetChannelList` | POST | `https://interface.17van.com/users/getOem` | `code === "200"` | `common/request.js:46-57` / `methods.js:36-42` |
| `AIModelCreation` | POST | `https://public.17van.com/dmx/PopV1` | `isEmptyOrNull(code) && result.model` | `common/request.js:60-67` / `methods.js:299,633` |
| `GetVoiceActor` | POST | ⚠️ `http://public.17van.com/voice/VoiceTemplate` | `code === 1` | `common/request.js:70-80` / `methods.js:885` |
| `GetMusic` | POST | ⚠️ `http://public.17van.com/voice/Music` | `code === 1` | `common/request.js:83-90` / `methods.js:937` |
| `DeductCreatePoint` | POST | ⚠️ `http://interface.17van.com/UserExtend/deductCreate` | `code === "200" && data === "1"` | `common/request.js:93-104` / `methods.js:1222` |
| `RefreshCreatePoint` | POST | ⚠️ `http://interface.17van.com/UserExtend/getCreate` | — | `common/request.js:107-118` / **本模块未调用** |
| `ActionDeliver` | POST | `https://action.17van.com/action/collection` | 忽略返回 | `view-smart-clip/js/request.js:28-38` / `methods.js:4` |
| `AiActionDeliver` | POST | `https://action.17van.com/action/deliver` | — | `:41-47` / **未调用** |
| `AiDeductionToken` | POST | `https://public.17van.com/dmx/AbnormalToken` | — | `:2-12` / **未调用** |
| `GetUserSources` | POST | `https://public.17van.com/dmx/GetCommonNum` | — | `:15-25` / **未调用** |

**传输层**（`common/request.js:1-43`）：jQuery `$.ajax`，`crossDomain: true`，`beforeSend` 统一加鉴权头，`type === "text"` 时用 `getBaseString()` 解 base64（`utils.js:32`）：

```js
xhr.setRequestHeader("loginToken", login.logintoken)      // common/request.js:10
```

⚠️ `GetVoiceActor`/`GetMusic`/`DeductCreatePoint` 走**明文 http**却照发 `loginToken`（`:73,85,96`）→ 见 H1。

**AI 请求体契约（重要）**：客户端不掌握 prompt 文本，只填**位置占位键**，由服务端按 `type` 选模板：

```js
// methods.js:290-297  卖点词生成
const params = { type: 3, stream: 0, model: "glm-4-air",
                 prompt: JSON.stringify({ "[key1]": this.aiLabel[0].value }) }

// methods.js:623-632  分镜文案生成
const params = { type: 2, stream: 0,
    model: originItem.model, // deepseek-r1阿里云 glm-4-air	glm-4-plus智谱清言 deepseek-r1-0428火山引擎
    prompt: JSON.stringify({
        "[key1]": originItem.limit > 5 ? 5 : originItem.limit,
        "[key2]": "150-300字",
        "[key3]": originItem.titleMap.join(",") }) }
```

模型名硬编码无配置：`glm-4-air`（`:293`）、`deepseek-r1-0428`（`:606`）、失败降级 `glm-4-plus`（`:719,729`）。返回体形状为 OpenAI 风格 `{code, model, choices:[{finish_reason, message:{content}}]}`（`methods.js:300-312,650-660`）。

### 5.2 宿主（原生）能力通道

| 能力 | 通道 | 业务页调用点 |
|---|---|---|
| 文件/目录选择 | `JsStartSelectVideo` / `JsStartSelectMusic` / `JsStartSelectFolder` | `methods.js:199,391,2520,182` |
| 抽帧与时长探测 | `JsGetVideoInfo` → 回调 `SetVideoInfo` | `methods.js:226` |
| 字体下载 | `JsDownloadFont` | `methods.js:1918` |
| TTS | `JsTextToAudio` → 回调 `SetTextToAudioResult` | `methods.js:991,1015,1033` |
| 视频合成 | `JsCreateWork`（`type:3`） | `methods.js:3683` |
| 草稿存取 | `JsSaveDraft` | `methods.js:136` |
| 创点购买页 | `JsBuyCreatePoints` | `methods.js:60` |
| 页面跳转 | `JsSwitchPage` | `methods.js:70` |
| 外链打开 | `FnClientOpenUrl` → 实为 `window.JsBuyVipPageOpenUrl` | `methods.js:1260,1262`；定义 `clientApi.js:187-189` |
| 登录态推送 | `clientSetLoginUser` → `LoginUserChange` | `clientApi.js:216-243` |

**已暴露但本模块未用**（说明 `clientApi.js` 是全模块共享层）：`JsReadLocalFile`、`JsReadLocalJsonFile`、`JsReadFileDataPiece`、`JsDeleteFile`、`JsPathFileExist`、`JsWriteLocalFile`、`JsGetFileSize`、`JsOpenFolder`、`JsDeleteFolder`、`JsLocateFile`、`JsDeleteWork`、`JsDeleteDraft`、`JsDraftStatuChange`、`JsCreatePointsUpdate`、`JsCloseTaskCenter`、`JsCancelTask`、`JsWriteBase64File`（`clientApi.js:56-209`）。

### 5.3 静态资源与三方库

- 图片基址硬编码：`baseImgSrc: "https://static2.17van.com/images/view-ai-clip"`（`data.js:7`）
- 音色头像**在代码里做域名字符串替换**：`child.portrait.replace("https://static.laiqu.work/img","https://static2.17van.com/images")`（`methods.js:891-894`）——服务端返回旧域名、前端改写，属技术债
- 本地库：`vue3.min.js`、`jquery3.5.0.min.js`、`element-plus@2.9.6.min.js`+locale、`dayjs.main.js`、`big.js`、`pinyin.dict.js`、`CaretUtil.js`、`shared@10.11.0.min.js`、`core@10.11.0.min.js`（`index.html:18-30`）

---

## 6. 值得 mulpub 借鉴的实现

> 难度按 mulpub 现状（Vue3 + Electron + pnpm 单仓多包）：**低**＝可直接抄思路；**中**＝需适配一层；**高**＝需重写/引入依赖。

### 6.1 素材组合算法：三级降级组合（`js/compose.js:7-207`）★★★ 最值得抄

```
FnCompositeVideo(list, max)                          compose.js:7-36
 ├─ 1级 NoRepetitionCombination  循环移位（保序，观感最自然）  :43-52   → N 条
 ├─ 2级 LowRepetitionCombination 低重复轮转（步长递增+跳重）    :68-98   → (N-3)×(N-2) 条
 └─ 3级 OrdinaryCombination      全排列(N≤6)/随机 1000 条      :115-127
        + fnRemoveDuplicate 按 join("") 去重                  :193-207
每次够 max 即停，不浪费算力                              :19-33
```

**为什么值得抄**：① **质量分层**——先给保持素材顺序的 N 条（最自然），不够才用打乱版，直接决定成片观感；② **成本可控**——全排列在 N=20 时是 20! 级，用「先降级、够用即停 + 上限 1000 + 去重」压成常数（`:124,202-204`）；③ **纯函数零依赖**（只用 `Math.random` 与数组，外部仅需 `deepClone`/`getRandomInt`/`getRandomArbitrary`/`retainDecimalPlaces`）。
**移植难度：低**——可原样搬入 `packages/shared-utils`。

### 6.2 时间轴：用「索引 + 累计 stopTime」代替时间轴结构（`compose.js:210-374`）★★★

**借鉴什么**：不建时间轴对象树，而是把每个素材的绝对时间点**一次算好写回素材对象**：

```
newMaterial[i] = { newId, beginTime, endTime, playTime,
                   xfadeDuration, xfade, show, stopTime }    compose.js:235-244,292-293
```
- `stopTime` 是**累计和**（`count.plus(playTime)`，`:291-293`）→「t 属于第几段」＝**线性查找第一个 `stopTime >= t`**（`methods.js:2912,3205`；`compose.js:353`）
- 播放主时钟是 `setInterval 200ms` 累加（`methods.js:3041-3058`），每 tick 只做三个比较（`:3071,3092,3116`）
- 「跳到 t」＝ 找索引 → `currentTime = t - 前段 stopTime + beginTime`（`methods.js:3203-3246`）
- 平均时长分配处理素材长短不一：短素材累计 deficit（`diffVlaue`）补给下条长素材（`compose.js:246-284`）；`xfade` 0.8s 参与补偿（`:214,221-227,295-304`）

**为什么值得抄**：音/字/画三轨同步最易写崩。这套「绝对时间预先拍平 + 线性查找 + 单一主时钟」**无嵌套状态、可序列化（直接作为 `FnJsCreateWork` 的 JSON）、可断点恢复**，比引入时间轴库轻得多。mulpub 的 `remotion-composer` 若做「多素材自动成片」，这是现成的中间表示。
**移植难度：中**——算法直白，但要与渲染层对齐单位：本模块**秒为主、出参转毫秒**（`methods.js:3594-3596,3632,3650-3651,3661-3662` 全部 ×1000），此边界约定必须保留。

### 6.3 TTS 文本预处理协议：方括号标记 → SSML（`js/charToPy.js:124-233`）★★

**借鉴什么**：不让 UI 直接写 SSML，而是定义**易编辑的方括号标记**，发送前统一翻译成两种引擎方言：

| 标记 | 语义 | anchorType==1 | 其他 |
|---|---|---|---|
| `[=pīnyīn]` | 多音字纠音 | `<phoneme alphabet="sapi" ph="pi 1">字</phoneme>` | `<phoneme alphabet="py" ph="pi1">字</phoneme>` |
| `[break=1000]` | 停顿 | `<break time="1000ms" />` | 同左 |
| `[number=123]` | 逐位读 | `<say-as interpret-as="number_digit">` | `<say-as interpret-as="digits">` |
| `[value=123]` | 数值读 | `<say-as interpret-as="cardinal">` | 同左 |
| `[tel=…]` | 电话读 | `<say-as interpret-as="telephone">` | 同左 |

证据：`charToPy.js:124-212`；声调表 `:93-122`；拼音字典用 `String.fromCharCode(i + 19968)` 建表（`:8`）——覆盖 CJK 基本区 20902 字，O(1) 查表。

**双管道设计（关键）**：同一份字幕文本走两条路——
- **送 TTS**：`escapeSpecialChars` → `contentTransition`（注入 SSML）→ `setConvertWrap(...,true)`（**删除所有换行**）（`clientApi.js:154-157`）
- **送显示/合成**：`extractContentText`（**剥掉** `[=]`/`[break=]`，保留 `[number=]` 等的值）（`charToPy.js:215-233`；调用点 `methods.js:1365,1556,3629`）

**为什么值得抄**：①「用户可编辑标记 + 编译期翻译」比暴露 SSML 安全（先转义再注入标签，见 `clientApi.js:154-157` 的调用顺序，顺带挡住 SSML 注入）；② 标记与显示分离，用户看到干净文本；③ 双引擎方言适配集中在 20 行内。
**移植难度：低-中**（标记语法与翻译函数可整体搬；`pinyin.dict.js` 是数据文件；换云端 TTS 只需替换目标方言）。

### 6.4 配置驱动 UI：把「文案/枚举/样式」全抽到常量层（`store/useClip.js`）★★

UI 只读 47KB 的纯数据文件，不内联字面量。收益点：
- 信息配置字段的**全部差异**（label/placeholder/max/必填/可删/AI 生成开关）都在数据里：`useAiLabel`（`:23-60`）+ `useAiKeyword`（`:62-123`）→ 模板一个 `v-for` 通吃（`index.html:234-325`）
- 字体样式/字号/字体族白名单：`useFtCategor`（`:636`）、`useFtSize`（`:355`）、`useFtFamily`（`:454`）
- **花字模板三件套**同时定义 CSS 预览样式与原生参数：`style`（预览）/`baseStyle`（列表缩略）/`attribute`（**直接进原生 payload**，`useClip.js:979-986` ← 消费点 `methods.js:3718`）
- 转场列表带 `gif_src` 预览图（`useTransitionList`，`:802`；消费 `index.html:1757-1763`）
- 数字读法枚举（`useNumerReading`，`:926`）、停顿档位 `[0.5,1,1.5,2,2.5,3,5]`（`:933`）

**为什么值得抄**：mulpub 平台多、字段多，这类「枚举+文案+样式+原生参数」四元组最适合数据化——**新增一个花字/字段只改数据不改模板**。须固化「预览用 style、缩略图用 baseStyle、出片用 attribute」三者同步的约定。
**移植难度：低**（避开本模块的坑：`data.js:41` 用 `splice` 改全局，见 M10）。

### 6.5 对话框/浮层的统一状态对象（`data.js:16-25` + `methods.js:23-28`）★

```js
dialogConfig: { visible, type, title, text, confirmText, confirmColor, confirmFn, cancelText }
```
一个对象驱动全局弹窗，`type` 兼作语义标签（`"buy"`/`"exit"`/`"warning"`）并在关闭回调分支（`methods.js:68-90`）；统一提示走 `handleErrorMessage(message, type)` → `ElMessage`（`methods.js:23-28`）。**好处**：比各处散弹 `ElMessageBox` 更可控（能统一禁用 ESC/点遮罩关闭，`index.html:710-711`）。mulpub 已有 `useEmbeddedViewSuspension` 治理 `WebContentsView` 遮挡——**把全局弹窗对象与挂起 owner 绑定**，一次覆盖所有模态框。**移植难度：低**。

### 6.6 逐字符断行 + 字体度量归一化（`tools.js:69-86`、`methods.js:3696-3706`）★

- **断行**：每 13 字插 `\n`（`counter >= 13`），去末尾换行（`tools.js:79-85`）
- **度量归一化**：UI 字号 → 原生字号，按字体族分三桶：

```js
// methods.js:3696-3706
const value = useFtSerifL.includes(family) ? size
            : useFtSerifB.includes(family) ? parseInt(size / 0.8)
            : parseInt(size / 0.75)
```
**为什么值得抄**：「前端所见字号 ≠ 渲染器所用字号」是视频合成必修课；**按度量特征分组、每组一个系数**比逐字体调参可维护。同时 `onCountFontSize` 的存在说明预览与出片必然有偏差，所以页面给了免责声明（`index.html:2298-2300`：预览仅供参考、转场无法预览）。**移植难度：低**（但系数须按 mulpub 渲染器重新标定，**不能照抄 0.8/0.75**）。

### 6.7 真实进度反馈：抄兄弟模块的 SSE，而非本模块的假进度 ★★★

**本模块做法（反面教材）**：进度条是**纯客户端定时器**——外层 `percentage` 1→90 每 500ms +1（`methods.js:615-621`，页面写「正在分析文案」`index.html:682`）；内层 +10/100ms 到 >60 后直接 `status="1"` + 提示「生成成功!」（`methods.js:2759-2769`）。真实工作在原生任务中心（提示语「合成中,请在任务中心查看」，`methods.js:3687`）。

**同仓兄弟模块 `view-smart-clip` 用的是真 SSE**：

```js
this.sseEvtSource = new EventSource(     // view-smart-clip/main/clipMethods.js:1236
```
配套齐全：`onopen`（`:1243`）/`onmessage`（`:1265`）/`onerror`（`:1377`）/显式 `close()`+置 `null`（`:1389-1391`），并以 `if (this.sseEvtSource)` 做重入保护（`:1169`）。

**为什么值得抄**：这是**同一产品内已验证可行的对照方案**。假进度的代价：用户看到 90% 后长时间无变化、实际失败却显示成功、刷新丢状态。mulpub 的 `task-queue` 与发布链已有真实状态，**应把队列事件流式推给渲染层**（SSE/IPC 事件/WebSocket 皆可），不要抄定时器。**移植难度：中**（主要工作是把 TaskQueue 进度事件接到前端；参考其 `onerror` → 降级轮询的兜底写法）。

### 6.8 其他可借鉴小点

| 点 | 位置 | 价值 | 难度 |
|---|---|---|---|
| 草稿白名单持久化（10 键）+ 只存 `status==="1"` | `data.js:207-218`、`methods.js:127-129` | 不把半成品/大对象写进草稿 | 低 |
| 深拷贝编辑副本实现「取消即回滚」 | `methods.js:1291` | 抽屉编辑的天然事务边界 | 低 |
| 拖拽框选批量勾选（5px 阈值区分点击/拖拽、负方向处理） | `methods.js:3402-3544` | 结果列表批量选择完整实现 | 低-中 |
| 中文输入法组合态保护（`compositionstart/end` 跳过 input） | `methods.js:1509-1531` | 中文编辑必做，否则拼音阶段就触发校验 | 低 |
| 粘贴自动分句（按 `[,;，；。！!]` 切） | `methods.js:1645-1667`、`tools.js:58-67` | 从外部文案快速建多条字幕 | 低 |
| 字数上限**实时**删减（超限即 `substring`+重置光标） | `methods.js:1534-1557` | 比「超限报错」体验好 | 低 |
| 容器自适应（宽高取小、上限 800、`zoom` 缩放整层） | `methods.js:449-496,3361-3387` | 9:16/16:9 预览自适应 | 低 |
| 音量三级联动（`player.volume × music.volume / 10000`） | `methods.js:2686,2848,3031` | 混音比例关系清晰 | 低 |

---

## 7. 缺陷清单（分级）

### 🔴 CRITICAL

#### C1. `escapeSpecialChars` 把 `/` 替换成字面量 `"undefined"` —— TTS 文案被静默损坏

```js
// js/tools.js:5-15
const escapeSpecialChars = str => {
	const escapeMap = {
		"&": "&amp;", "<": "&lt;", ">": "&gt;",
		'"': "&quot;", "'": "&apos;"
	}
	return str.replace(/[&<>"'/]/g, m => escapeMap[m])
}
```
字符类 `[&<>"'/]` **含 `/`**，但 `escapeMap` **无 `"/"` 键** → 替换函数返回 `undefined` → 按规范被转成字符串 `"undefined"` 插入。

**影响面（主路径，必然触发）**：所有送 TTS 的字幕文本都过它：`methods.js:991/:1015/:1033` → `interface.FnJsTextToAudio` → `clientApi.js:153-159`：`b.input = setConvertWrap(contentTransition(escapeSpecialChars(b.input), b), true)`。
**后果**：字幕里任何 `/` 都会被念成「undefined」。常见命中：日期 `9/10`、`他/她`、`和/或`、分数、网址、英文缩写。**属用户可感知的内容损坏。**
**修复**：`escapeMap` 补 `"/": "&#47;"`，或从正则中移除 `/`。

#### C2. `onCountCreationPoints` 无限重试：无上限、无退避上限、无 UI 反馈、无法取消

```js
// main/methods.js:1219-1234
async onCountCreationPoints(totalPoints) {
	while (true) {
		try {
			const result = await DeductCreatePoint({ create_num: totalPoints, type: 1 })
			if (result.code === "200" && result.data === "1") return totalPoints
		} catch (error) { console.error("请求失败:", error) }
		await new Promise(resolve => setTimeout(resolve, 1000))   // 添加延迟避免高频请求
	}
}
```
任何非 `{code:"200",data:"1"}` 响应——**包括「创点不足」这类正常业务拒绝**——都会让循环永不退出：每秒一次请求**永久打服务端**；**永不 resolve** → 调用点 `.then()`（`methods.js:1102-1109`）永不执行 → 创点不同步、无提示；且 `disabledCreation = false`（`:1132`）在其后 → **「立即生成」永久置灰**（`:535` 直接 return）。
**修复**：限制最大重试次数，区分「可重试」与「业务拒绝」，后者提示并复位按钮。

#### C3. AI 失败分支无上限递归 + 按钮永久禁用

```js
// main/methods.js:717-731
} else {
	if (originItem.model !== "glm-4-plus") {
		originItem.model = "glm-4-plus"
		this.onSafeAsyncAssign(originItem)          // 降级后重试（合理）
	} else {
		this.handleErrorMessage("生成字幕失败，请稍后再试")
		this.createResList = this.createResList.filter(i => i.id !== target.id)
	}                                // ← 未复位 disabledCreation！
} else {
	originItem.model = "glm-4-plus"
	this.onSafeAsyncAssign(originItem)   // ← 不判断 model、无次数上限：永久重试
}
```
三个问题叠加：① `:728-731`（接口失败/返回空）**不检查 model**，每次失败都递归 → 服务端持续故障时**无限重试**、无用户可见反馈；② `:721-726`（字幕失败）过滤掉任务项却**未复位 `disabledCreation`** → 与 C2 同因，按钮永久置灰；③ 每次递归在 `:615` 新建 `percentageTimer`，叠加假进度。

#### C4. `v-html` + 未转义用户文本 → HTML 注入（XSS）

```js
// store/useClip.js:1962-1973   fnPolyPhonicPopover
poly.polyText.forEach(item => {
	if (item.isActive) {
		html += `<span class="poly_phonic-text active" data-type="polyphonic-text" data-value="${item.list}">${item.val}</span>`
	} else {
		html += item.val          // ← :1969 用户文本原样拼进 HTML，无转义
	}
})
_this.curPolyPhonic.html = html
```
渲染点：`index.html:1974` `<div ref="polyPhonicCtnRef" class="ctn" v-html="curPolyPhonic.html">`。

**数据来源链（已核到源头）**：`methods.js:1746` `textMap = worksItem.subT.list.filter(i => i.text)`（**用户/AI 产出的字幕文本**）→ `methods.js:1751` `fnGetPolyPhonic(textMap)` → `useClip.js:1917-1934` 逐字符 `polyText.push({ val: item.text[i], … })` → `useClip.js:1947` `polyText[index-1].val = polyText[index-1].val + data`，其中 `data` 来自 `item.text.match(/\[=(.+?)\]/g)`（`useClip.js:1937`）——**`.+?` 允许 `<`、`>`、`"` 等全部字符**。

**可达性（观察到的）**：字幕含 `a[=<img src=x onerror=alert(1)>]` 时，`a` 非多音字 → `isActive=false` → 走 `:1969` 原样输出 → `v-html` 渲染 → 脚本执行。用户只需在字幕里粘贴这样一段文本再点「多音字」（`index.html:963`）。**且字幕文本另一来源是大模型返回文案**（`methods.js:663` `onFormatDubItem(resultCont,…)`），故**被污染的模型输出同样可触发**。
**推断（附依据）**：注入点在 ai-clip iframe 内，而该 iframe 自身就能调原生桥 `window.Js*`（`interface.FnJsStartSelectVideo` → `window.JsStartSelectVideo`，`clientApi.js:138-140`，这是上线功能主路径；若绑定未注入该 iframe，功能根本不可用）→ 因此该注入**可获得本地文件操作能力族**（`JsWriteLocalFile`/`JsDeleteFile`/`JsOpenFolder`/`JsCreateWork`…，`clientApi.js:56-209`）。
**修复**：拼接前转义 `&<>"'`，或改为构造 DOM 节点（`createTextNode`）。同类拼接：`SelectPhSymbol` 的 `data-value="${data}"`（`useClip.js:2022`，当前值来自拼音字典，风险低）。
**附带**：`onDialogPaste` 的 IE 兼容分支用 `newNode.innerHTML = oldText` 后 `insertNode`（`methods.js:1637-1642`），绕过 `contenteditable="plaintext-only"`，但需 `window.clipboardData`（Chromium 不可达）→ **死代码**。

### 🟠 MAJOR

#### H1. 明文 `http://` 端点 + 明文发送 `loginToken`

`common/request.js:70-104` 中 `GetVoiceActor`（`:73`）、`GetMusic`（`:85`）、`DeductCreatePoint`（`:96`）、`RefreshCreatePoint`（`:110`）用 `http://`，同文件其他端点用 `https://`（`:49,62`）。传输入口无条件附带鉴权头（`:7-10`）：`xhr.setRequestHeader("loginToken", login.logintoken)`，且 `crossDomain: true`（`:17`）。**后果**：会话令牌走明文信道（可被中间人窃取）。**修复**：全量 HTTPS + 服务端 301。

#### H2. 异步 TTS 回调对索引无守卫，过期回调直接抛错

```js
// main/methods.js:1064-1070
let obj = this.toAudioList[ids[0]]
obj.convert += 1                                   // ids[0] 失效 → TypeError
let createRes = this.createResList.find(i => i.id === ids[0])
let works = createRes.worksList[ids[1]]            // createRes undefined → TypeError
let dialog = works.subT.list[ids[2]]
```
**可达路径（观察到的）**：`createResList` 上限 20，超出即 `pop()` 丢最旧（`methods.js:579-582`），而该条目的 TTS 回调仍会陆续到达 → `find` 返回 `undefined` → 抛错 → **该任务收尾逻辑（`status`、`disabledCreation=false`、`onSaveDraft`、埋点）全部不执行**。
**佐证作者已知此风险**：AI 分支显式做了同类防护——`methods.js:635-638` `const exists = this.createResList.some(item => item.id === originItem.id); if (!exists) { throw new Error("对象已被移除") }`。**同类问题一处防了、一处没防。**
**修复**：`onClientSetTextAudio` 入口校验 `ids[0]/[1]/[2]` 与 `toAudioList` 条目存在，失效即静默返回。

#### H3. `onInitDragSelect` 无清理：重复注册 document 监听 + 重复插入节点

```js
// main/methods.js:3402-3409
const container = document.querySelector(`#wroksList-${data.id}`)
const selectionBox = document.createElement("div")   // 每次新建
container.appendChild(selectionBox)                   // 追加而不复用
…
document.addEventListener("mousemove", function (e) { … })   // :3444
document.addEventListener("mouseup",   function (e) { … })   // :3484
```
调用点：`methods.js:1133-1135`（**每次该任务 TTS 全部完成**）、`methods.js:105-109`（**每次恢复草稿，对全部条目**）。
**后果**：同一 `#wroksList-<id>` 容器积累多个 `.selection-box` 节点与**成倍**的 document 级监听器；每次 mousemove/mouseup 重复执行框选逻辑（`.w-l-item` 遍历 ×N），既漏内存也拖慢交互。**修复**：模块级只注册一次监听（或 `AbortController` 统一回收），`selectionBox` 幂等创建。

#### H4. `draftUuid` 恢复后为 `undefined`（草稿覆盖保存失效）

```js
// main/methods.js:111   恢复时读 result.bid
this.draftUuid = result.bid
// main/methods.js:119-125   保存时构造的 draftData 内没有 bid
const draftData = { draftTitle: this.pageTitle, createTime: …, categroy: "AICLIP", contetCover: … }
_dataKey.forEach(k => (draftData[k] = this[k]))      // _dataKey 也不含 bid
```
全模块 grep 确认：`bid` **只被读（`:111`）或作局部变量（`:3682`），从未被写入 `draftData`**。
**后果**：从草稿进入时（`AICLIP_SOURCE==="DRAFT"`→`source=2`，`:118`）保存不会重生成 uuid（`:131-134` 仅 `source===1` 时生成）→ `FnJsSaveDraft(2, 2, undefined, …)`（`:136-141`）→ **每次保存可能新建草稿而非覆盖**；合成提交同样传空 bid（`:3682-3683`）。**修复**：把 `draftUuid` 写入 `draftData` 并纳入 `_dataKey`。

### 🟡 其余问题

| 级别 | 问题 | 位置 | 说明 |
|---|---|---|---|
| MAJOR | **假进度条** | `methods.js:615-621,2759-2769`；文案 `index.html:682` | 进度与真实任务无关；兄弟模块有 SSE 正解（`clipMethods.js:1236`） |
| MAJOR | **API 成功判据三套并存** | 字符串 `"200"`：`methods.js:39,1227`；数字 `1`：`methods.js:886,938`；`isEmptyOrNull(code)`：`methods.js:300` | 同一文件三种约定，新增接口极易判错 |
| MAJOR | **TTS 定时器不清除** | `methods.js:987-997` | `textMap` 为空时 `textMap[0].input` 抛错（`:989`），清除语句在其后（`:994-996`）→ 定时器**永不停止**、每 150ms 抛一次。**推断**：正常流程 `textMap` 非空，可达性低，但属未防护缺陷 |
| MAJOR | **AI 返回格式异常导致抛错卡死** | `methods.js:735-797`→`:800-815` | 返回无 `【方案N】` 时 `subT.length===0` → `index % subT.length` = `NaN`（`:777`）→ `originalId: NaN` → `deepClone(res.worksList[NaN])` → `deepClone(undefined)` 返回 `{}`（`utils.js:517-533` 对非对象返回 `{}`，**不抛错**）→ `data.subT` 为 `undefined` → `compose.js:212` `data.subT.list` → **TypeError** → 收尾中断，作品永久停在「生成中」。触发条件是模型输出偏离，**属推断**；代码路径为观察到 |
| MAJOR | **`FnClientOpenUrl` 命名与实现不符** | `clientApi.js:187-189` | 名为「打开外部链接」，实际调 `window.JsBuyVipPageOpenUrl`（VIP 购买页专用）。`methods.js:1260,1262` 用它开教程页——**推断**：依赖该原生函数恰能开任意 URL，语义脆弱 |
| MAJOR | **登录态双源 + 三处写入** | `data.js:4`、`create.js:18/57`、`methods.js:47/547/1103` | `interface.loginInfo` 与 `$local.get("AICLIPLOGIN")` 并存，BroadcastChannel 还会整体覆盖（`create.js:57`） |
| MAJOR | **shell 启动清洗 localStorage（白名单仅 3 键）** | `view-smart-clip/index.html:163-172` | 见 4.6；与宿主登录推送构成强时序依赖（未确认项 8.2） |
| MAJOR | **全局选择器 + 位置索引操作 DOM** | `methods.js:415,1471,2603,3030,3214` | 如 `$(".bgMusicCtn").get(inx).play()`。该类名在**两个容器**都存在（全局音乐抽屉 `index.html:861` 与作品音乐 Tab `index.html:1668`）；`.previewVideoEl` 同样两套（`index.html:1819` 与 `:2323`）。**推断**：两容器同时存在时索引会指向错误元素；当前靠 `destroy-on-close`（`index.html:770,888,2203,2291`）与互斥打开规避，属**脆弱设计**而非已证实的 bug |
| MAJOR | **`hexToUint` 三位色分支为死代码** | `tools.js:36-46` | `hexColor.replace("#","ff")`（`:39`）先执行，`hex.length === 3`（`:41`）永不成立；三位色 `#FFF` → `parseInt("ffFFF",16)` 错误色值。消费点 `methods.js:3712`（送原生的字幕颜色）。**推断**：取色器通常输出 6 位，可达性低 |
| MAJOR | **`onResetDubData` 不重置 `voicePath`** | `methods.js:2174-2188` | 清空 `voiceText/voiceDuration/voiceChannels` 但保留 `voicePath`（对比 `:1081,1168,1186` 均置空）→ 状态残留，靠 `voiceText !== text` 判据在别处兜住（`:1703,2946`），属隐性耦合 |
| MINOR | **`onDownloadVideo` 未定义 + `downloadVisible` 永不为真** | 调用 `index.html:2488`；`data.js:201` | 全模块无该函数定义 → 弹窗（`index.html:2463-2495`「合成并下载」）整体**死代码**；真下载走 `onDownloadDialog`（`:3550`） |
| MINOR | **模板引用未定义变量 `lensData`** | `index.html:1745` | `onDelLensTransition(lensData, trans.id)`；`data.js` 无 `lensData`。因函数首个形参未使用（`methods.js:2718-2723`）而**侥幸正常**，但 Vue 会告警且易误改 |
| MINOR | **`js/config.js` 为 0 字节死文件** | `view-ai-clip/js/config.js` | 见 2.3 |
| MINOR | **`onLoadSingleMaterial` 死函数** | 定义 `methods.js:3346-3358`，全模块无调用 | 与 `onLoadMaterial`（`:3310`）重复 |
| MINOR | **`fnGetPolyPhonic` 内死代码/脆弱写法** | `useClip.js:1943-1945,1951` | `for (let dataKey in data)` 遍历**字符串**得下标，拼出的 `txtNew` 赋给局部 `txt` 后再未使用；`:1951` 用「val 长度」当「待删条目数」，在「单标记+前导 1 字符」时恰等于 `data.length` 而**侥幸正确**，多标记时脆弱 |
| MINOR | **拼音函数循环体内 `return`** | `charToPy.js:47-59` | `for` 首轮两分支都 `return`（`:57-58`）→ **只处理首个字符**。调用点只传单字（`useClip.js:1918,1923`），当前无影响，但埋雷 |
| MINOR | **`downloadImage(url, nmae)` 拼写错误 + 引用未定义全局** | `tools.js:119-121` | 形参 `nmae`，函数体用 `name`（解析为 `window.name`）→ `link.download` 得到窗口名。**本模块未调用** |
| MINOR | **生产环境 `console.log`，含完整合成载荷** | `methods.js:1085,1086,2872,3186,3197,3199,3680` | `:3680` 打印整个 `clientData`（含**本地文件绝对路径**与文案全文）。违反生产代码无 `console.log` 门禁 |
| MINOR | **`event` 全局隐式依赖** | `methods.js:1561,1850,1630` | 依赖 `window.event`（Chromium 可用但已废弃）；`onDialogBlur` 的形参 `evt` 实际被弃用 |
| MINOR | **模板传参与实现签名不符** | `index.html:1035` `onAddDialog('3')` vs 定义 `(type,target,dialog,curCaretPos)`（`methods.js:1849`） | 只对 `type==="3"` 分支有效 |
| MINOR | **`toAudioCount === 2` 魔法判断** | `methods.js:1079` | 用「第几次生成」当状态机，第 3 次及以后行为不同且无注释 |
| MINOR | **`id: Date.now()` 作唯一键** | `methods.js:592` | 同毫秒两次生成会碰撞（当前靠 `disabledCreation` 串行化规避） |
| MINOR | **`data.js:41` 用 `splice` 修改全局常量** | `aiLabel: deepClone(useAiLabel.splice(0, 2))` | 副作用是全局 `useAiLabel` 被永久截成 1 项（id:2「突出关键词」被丢弃）。应用 `slice(0,2)` |
| MINOR | **`beforeUnmount` 移除错引用** | `create.js:161` vs 注册 `create.js:72` | `removeEventListener("resize", this)` 传的是 Vue 实例而非存下的 `resizeRatioFn` → **监听器不会被移除**（页面卸载即消失，实际影响小） |
| MINOR | **`localStorage` 明文存 token 与草稿全文** | `clientApi.js:241`、`methods.js:140` | 无加密；本地页面 + 注入风险（C4）叠加后放大 |

---

## 8. 未确认事项与卡点

### 8.1 原生层实现（最大证据边界）
本模块只能看到 `window.Js*` 的**调用侧**。
- **未确认**宿主是 CEF/WebView2/自研，以及 `window.Js*` 是否对 **sub-frame** 注入。**推断：是**——依据 `clientApi.js:138-140` 等包装必须在该 iframe 内可用，否则上传/合成主路径全部失效。
- **未确认**原生合成实现（ffmpeg/自研）、任务中心并发模型、`FnJsCreateWork` 的 `clientData` schema 是否稳定。
- **未确认**宿主对 `interface` 对象的调用约定（推断为按名解析 `interface.<Method>`，见 4.2）。
- 卡点：需反汇编主程序（`原生层分析报告.md` 已有部分成果，本次未读以免偏题）。

### 8.2 宿主是否在 shell 清洗 localStorage 后重推登录态（最重要）
`view-smart-clip/index.html:163-172` 会删 `AICLIPLOGIN`，恢复它的唯一代码路径是宿主调 `LoginUserChange`（`clientApi.js:216-243`）。
- **未确认**：宿主是否在每次 shell 启动、或每次 `clientSwitchPage` 时主动调它。
- **为何重要**：若不重推，`createpoints` 恒 0（`data.js:4`）→ `onCreate` 恒报「预计生成创点不足」（`methods.js:544`）→ 功能不可用；`SetCreatePoints` 也会静默失效（`clientApi.js:280`）。**产品能上线说明大概率会重推，但这是推断而非观察。**
- 卡点：需动态调试（启动后检查 `localStorage.AICLIPLOGIN` 是否被重建）。

### 8.3 服务端契约
- **未确认** `AIModelCreation` 的 `type:2/type:3` 提示词模板内容与 `[keyN]` 完整定义（客户端只发键值）。
- **未确认** `PopV1` 返回体 `choices[0].message.content` 的**格式保证**——`onFormatDubItem` 完全依赖 `【方案N】` 分隔（`methods.js:737`），服务端改格式即触发 7 中对应 MAJOR 缺陷路径；是否有版本协商未知。
- **未确认** `FnJsTextToAudio` 入参（`methods.js:1044-1058`：`anchorType/voice/volume/speech_rate/pitch_rate/voicestyle/code/input/silenceremove`）在宿主侧的解析口径，尤其 `anchorType`（1=sapi 方言，见 `charToPy.js:140,168`）与 `voicestyle`。
- **未确认**创点单位（×10 约定，见 4.4）。

### 8.4 运行时行为未验证
- **未确认** H3 的监听器在实际使用中的累积量（静态可证重复注册，未实测上限表现）。
- **未确认** `$(".bgMusicCtn")`/`$(".previewVideoEl")` 是否存在真实同时共存场景（依赖 `destroy-on-close` 实际生效时机）。
- **未确认** `js/config.js` 为 0 字节的成因（打包流程缺陷 or 有意占位）。

---

## 9. 给 mulpub 的落地建议

| 优先级 | 借鉴/整改项 | 证据 | 落点建议 |
|---|---|---|---|
| P0 | **令牌绝不过明文信道**；**前端只产编排 JSON、重活交后端** | C1/H1、3.7 | mulpub 已有 HTTPS 与 `api-publish-engine`；建议把「编排 JSON schema」文档化并用 zod 校验 |
| P0 | **杜绝 `v-html` 拼接用户文本**（同类反面样本入库 learnings） | C4 | 与既有 `safe-http-url` 同级增设「HTML 拼接白名单」，或统一 `createTextNode` |
| P1 | **素材组合三级降级算法** | 6.1 | 抽到 `packages/shared-utils`（纯函数零依赖） |
| P1 | **时间轴「拍平+线性查找+单主时钟」模型** | 6.2 | `packages/remotion-composer` 中间表示；注意秒/毫秒边界 |
| P1 | **真实进度流式反馈（抄 SSE 而非定时器）** | 6.7 | 接 `task-queue` 事件 → 渲染层；补 `onerror` 降级轮询 |
| P2 | **TTS 标记协议 + 双管道（送引擎/送显示）** | 6.3 | `packages/ai-writer` 或独立 `tts-text-protocol` 包 |
| P2 | **配置驱动字段/样式（枚举+文案+样式+原生参数 四元组）** | 6.4 | 与 mulpub `platform-definitions` 同构，可并入 |
| P2 | **全局模态弹窗对象 + 与 `useEmbeddedViewSuspension` 绑定** | 6.5 | 一次覆盖所有模态浮层的挂起 owner |
| P3 | 逐字符断行、字体度量分桶、拖拽框选、输入法组合态保护 | 6.6、6.8 | 组件级复用 |
| P3 | 反例清单（无限重试、无上限递归、异步回调无守卫、定时器不清除、假进度）纳入 Code Review 必检项 | C2、C3、H2、TTS 定时器、假进度 | 更新 `.quality-gates.md` |

---

### 核心结论一句话

融媒宝「一键成片」= **CEF 宿主 + 双层 iframe 的 Vue3 页面 + 原生合成引擎**；前端真正的技术含量在**素材组合算法**与**时间轴拍平模型**（值得抄），同时暴露了 **TTS 文案被 `/` 静默损坏**、**创点扣费无限重试**、**多音字弹窗 HTML 注入** 三个高危缺陷，以及**用假进度条冒充真实进度**这一产品级糊弄（同产品兄弟模块已有 SSE 正解）。
