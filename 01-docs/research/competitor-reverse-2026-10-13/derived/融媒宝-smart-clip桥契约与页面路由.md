# `view-smart-clip` 的 31 个原生桥怎么协作 —— 一个门面 + 5 个页面 + 45 个接口

> **文档性质**：纯静态读码（`dist/view-smart-clip/` 下 15 个 js/html，共 341 KB），不执行、不联网。
> **取证日期**：2026-10-19 ｜ **脚本**：`02-analysis-scripts/extract-smart-clip-contract.cjs`
> **机器可读**：`04-rea-evidence/融媒宝-smart-clip桥契约.json`
>
> **此前只数出「这里挂了 31 个桥」**（见 `融媒宝-前端功能面权威清点.md` §2.1）。
> 本篇回答的是**它们怎么协作**：31 个不是 31 个独立功能，而是
> **一个门面文件 + 5 个页面 + 正向 31 / 反向 14 的对称契约**。

---

## 1. 一句话结论

> 整个智能剪辑模块的原生边界**收敛在单个 445 行文件里**：
> `js/clientApi.js` 定义 `interface` 对象，把 31 个原生桥一对一包成 `FnJs*`；
> 反向的 14 个原生回调也全在同一个对象的「网页接口」段里声明。
> **两头都在同一个文件**，中间靠 iframe + `localStorage.PageId` 路由。

这就是为什么这个 view 有 31 个桥却只有 15 个文件 ——**桥不是散落的，是收口的**。

---

## 2. 门面结构：一个对象，两段，方向严格对称

`clientApi.js` 用注释把文件切成了三段：

```
interface = {
  urlParams      { did, channel, version, osversion, showvideomix }
  loginInfo      { logintoken, uid, usertype, issubuser, isteam, istryvip, createpoints, remaininglimit, parentuid }
  storagePath    { type, draft, works, create, xhsImage }

  /** 客户端接口 - Start */    ← ① 正向：JS → 原生，31 个 FnJs*
  /** 客户端接口 - End   */
  /** 网页接口   - Start */    ← ② 反向：原生 → JS，14 个，被调用
  /** 网页接口   - End   */
}
```

| 方向 | 数量 | 命名 | 谁调谁 |
| --- | --- | --- | --- |
| 正向 | **31** | `FnJsXxx(a,b,c)` → `window.JsXxx(...)` | 页面调门面，门面调原生 |
| 反向 | **14** | `clientXxx(...)` | **原生调页面**（门面把结果转给 iframe）|

⇒ **45 个接口，方向对称。** 这是竞品前端与原生之间**唯一**的对接面。

---

## 3. 正向 31 个桥：按能力分 6 组

桥名不是随意取的，**按前缀就能分组**，而分组恰好对应 6 个能力域：

| 组 | 数量 | 桥名 | 返回方式 |
| --- | --- | --- | --- |
| **① 文件 I/O** | 11 | `JsReadLocalFile` `JsReadLocalJsonFile` `JsReadFileDataPiece` `JsWriteLocalFile` `JsWriteBase64File` `JsDeleteFile` `JsPathFileExist` `JsGetFileSize` `JsOpenFolder` `JsDeleteFolder` `JsLocateFile` | **4 个同步返回**（Read*2 / PathFileExist / GetFileSize），其余即发即忘 |
| **② 作品 / 草稿** | 7 | `JsCreateWork` `JsDeleteWork` `JsCreateWorkPathUpdate` `JsSaveDraft` `JsDeleteDraft` `JsDraftStatuChange` `JsCreateXhsImagePathUpdate` | 经反向接口回填 |
| **③ 媒体** | 4 | `JsStartSelectVideo` `JsGetVideoInfo` `JsStartSelectMusic` `JsTextToAudio` | 经反向接口回填 |
| **④ 付费** | 4 | `JsBuyCreatePoints` `JsCreatePointsUpdate` `JsBuyVip` `JsBuyVipPageOpenUrl` | 即发即忘 |
| **⑤ 任务** | 2 | `JsCancelTask` `JsCloseTaskCenter` | 即发即忘 |
| **⑥ 导航 / 其他** | 3 | `JsSwitchPage` `JsDownloadFont` `JsStartSelectFolder` | 混合 |

### 3.1 只有 4 个桥是**同步返回值**的

这是关键区分 —— 其余 27 个都是「发出去，结果走反向接口回来」：

```javascript
FnJsReadLocalFile: a => {
    let result = window.JsReadLocalFile(a)          // ← 直接拿返回值
    return isJsonType(result) ? JSON.parse(result) : []
},
FnJsPathFileExist: a => window.JsPathFileExist(a),  // ← 同步布尔
FnJsGetFileSize:   a => window.JsGetFileSize(a),    // ← 同步数字
FnJsReadLocalJsonFile: a => { ... JSON.parse(result) : {} },
```

⇒ 原生侧的 `JsReadLocalFile` 等**必须在 CEF 消息循环里同步返回**（`ExecuteJavaScript` 的返回值），
其余 27 个是纯通知（fire-and-forget）。**这是 CEF 桥设计的两种模式**，不是统一模式。

### 3.2 有一个桥在门面里做了**预处理**（唯一一个）

```javascript
FnJsTextToAudio: (a, b) => {
    b.input = setConvertWrap(contentTransition(escapeSpecialChars(b.input), b), true)
    window.JsTextToAudio(a, JSON.stringify(b))     // ← 序列化后传
},
```

⇒ 文字转语音的入参不是裸文本，而是**先转义 → 转换 → 包装成结构**再 `JSON.stringify`。
唯一的「门面里带业务逻辑」的桥。

### 3.3 创点数用**十分位**存储

```javascript
LoginUserChange: (logintoken, ..., createpoints, ...) => {
    const info = { ..., createpoints: createpoints / 10, ... }   // ← 原生传 10 倍
```

⇒ 原生传整数（×10），前端除 10 显示。**用十分位避免浮点**。
且 `SetCreatePoints` 反向做了乘法闭合：

```javascript
SetCreatePoints: a => {
    let val = JSON.parse(localStorage.getItem("AICLIPLOGIN"))
    val.createpoints = a
    const arr = [...Object.values(val)]
    interface.LoginUserChange(...arr)      // ← 靠 Object.values 的顺序回填位置参数
}
```

⚠ 这里有个**脆弱点**：`Object.values(val)` 的顺序依赖对象的插入顺序，
一旦 `loginInfo` 的字段顺序被改，`LoginUserChange(...)` 的 9 个位置参数就会错位。
**能用，但脆。**

---

## 4. 反向 14 个接口：原生怎么把结果送回页面

全部是 `client*` 前缀，共 14 个（`clientApi.js` 里声明并转发）：

| # | 接口 | 语义 | 门面怎么处理 |
| --- | --- | --- | --- |
| 1 | `clientSetLoginUser` | 登录用户变化 | 写 `localStorage.AICLIPLOGIN` |
| 2 | `clientSwitchPage` | 切换页面 | 记 `*_OPENED` 标记 |
| 3 | `clientSetVideoInfo` | 视频信息回填 | **路由到 iframe** |
| 4 | `clientSetFileSrc` | 选中的视频列表 | **路由到 iframe** |
| 5 | `clientSetMusicFile` | 选中的音乐列表 | **路由到 iframe** |
| 6 | `clientSetSelectFolder` | 选中的目录 | **广播到多个 iframe** |
| 7 | `clientSetTextAudio` | 文字转语音结果 | **按 8 参里的 h 路由** |
| 8 | `clientAddDraft` | 新增草稿 | 仅 `PageId==3` 时 |
| 9 | `clientUpdateDraft` | 更新草稿 | 仅 `PageId==3` 时 |
| 10 | `clientAddWork` | 新增作品 | 仅 `PageId==2` 时 |
| 11 | `clientUpdateWork` | 更新作品 | 仅 `PageId==2` 时 |
| 12 | `clientAddTask` | 新增任务 | 拼一个完整任务对象再转 |
| 13 | `clientUpdateTask` | 更新任务 | 直转 |
| 14 | `clientClearTask` | 清空任务中心 | 直转 |

### 4.1 ⚠ 有一个反向接口是**空的**

```javascript
SetDownloadFontResult: (a, b, c, d) => {},      // ← 空函数体
```

⇒ 原生会调 `SetDownloadFontResult`，但前端**什么都不做**。
配套的正向桥 `JsDownloadFont` 却存在 ⇒ **下载字体这条路是「调用通、结果丢弃」的半截实现**。
（同类现象见 `融媒宝-百度风控verifyToken与死代码.md` 的死代码 —— 这个竞品有相当多的「接了但没接完」。）

---

## 5. 页面路由：5 个页面共用一套桥，靠 `PageId` 分流

### 5.1 页面 ID 全表（实测）

| PageId | 页面 | 实证 |
| --- | --- | --- |
| **1** | 混剪 | `a === 1 → localStorage["CLIP_OPENED"]="1"` |
| **2** | 作品（my-works）| `PageId == 2` 时刷新 / `clientAddWork` 只在此页 |
| **3** | 草稿（my-draft）| `PageId == 3` 时刷新 / `clientAddDraft` 只在此页 |
| **4** | 一键成片（AICLIP）| `a === 4 → localStorage["AICLIP_OPENED"]="1"` |
| **6** | 红薯模版（XHSMB）| `a === 6 → localStorage["XHSMB_OPENED"]="1"` |

（5 未在门面出现，推断为任务中心 —— 见 §7 未闭合。）

### 5.2 iframe 分发器：两张映射表

```javascript
function IframeWindowClip(from) {
    let clipIframe = document.getElementById("clipIframe")
    let aiClipIframe = document.getElementById("aiClipIframe")
    const iframeMap  = { 1: clipIframe, 4: aiClipIframe }    // ← 用于「按 CLIP_PAGEID」
    const iframeMap2 = { 2: clipIframe, 3: aiClipIframe }    // ← 用于「显式传 from」
    const result = from ? iframeMap2[from]
                        : iframeMap[localStorage.getItem("CLIP_PAGEID")]
    return result ? result.contentWindow : {}
}
```

**两张表不是冗余，是两种语义**：

| 表 | 键 | 含义 |
| --- | --- | --- |
| `iframeMap` | 1 / 4 | **编辑页**（混剪 / 一键成片）|
| `iframeMap2` | 2 / 3 | **列表页 → 归属哪个编辑页**（作品→混剪、草稿→一键成片）|

⇒ `clientAddWork` 在「作品列表（2）」时，要通知的是**混剪编辑器**（`clipIframe`）；
`clientAddDraft` 在「草稿列表（3）」时，要通知的是**一键成片编辑器**（`aiClipIframe`）。
**谁产生结果 ≠ 谁接收结果**，这就是为什么需要两张表。

### 5.3 三个 iframe 容器

```
clipIframe      ← 混剪编辑器
aiClipIframe    ← 一键成片编辑器
xhsTemplateIframe ← 红薯模版（独立，不参与 IframeWindowClip）
myIframe        ← 作品 / 草稿列表（IframeWindowMy）
```

`FnSetFolder`（选择目录的结果）是**唯一会广播**的：

```javascript
FnSetFolder: (a, b) => {
    interface.storagePath.type = b
    if (b === "Download") { SetCreateWorkPath(a); FnJsCreateWorkPathUpdate(a) }
    else if (b === "Works")   { SetWorkListFilePath(a) }
    else if (b === "Draft")   { SetDraftListFilePath(a) }
    else if (b === "XhsImage") {
        SetCreateXhsImagePath(a)
        xhsTemplateIframe.contentWindow.clientSetSelectFolder(b, a)
        FnJsCreateXhsImagePathUpdate(a)
        return                                    // ← 红薯模版走单独分支后直接返回
    }
    clipIframe.contentWindow.clientSetSelectFolder(b, a)      // ← 其余广播给两个编辑器
    aiClipIframe.contentWindow.clientSetSelectFolder(b, a)
}
```

⇒ 一次「选目录」要触发：**4 个 localStorage 键之一 + 1 个正向桥回写 + 最多 3 个 iframe 通知**。

---

## 6. 协作全景：一次「混剪生成」跨了多少层

把上面所有线索串起来，一次生成任务的完整链路：

```
① 用户在 clipIframe（混剪编辑器）点「生成」
② 编辑器调 interface.FnJsCreateWork(a, b, c)                  → 正向桥
③ 原生收到 → 建任务 → 调 interface.AddTask(...)               → 反向接口
④ AddTask 拼成完整任务对象（type/id/title/subtaskcount/
   createtime/status=0/pace=0/success=0/fail=0/path）
   → window.clientAddTask(obj)                                → 通知任务中心
⑤ 原生处理过程中反复调 clientUpdateTask(...) 更新进度
⑥ 用户要取消 → 编辑器调 FnJsCancelTask(v)                      → 正向桥
⑦ 完成后原生调 clientAddWork(a,b,c)（仅当 PageId==2）          → 作品列表刷新
⑧ 若要落盘 → 原生调 SetCreateWorkPath / 用户选目录走 FnSetFolder
```

**跨的层**：编辑器 iframe → 门面 `interface` → `window.Js*` → CEF 桥 → 原生 C++
→ 原生回调 `interface.*` → iframe 分发器 → 目标 iframe。

⇒ **同一次操作里，正向和反向会各走一遍。**这是它设计的核心：
**门面是双向的，不是单向 API。**

---

## 7. localStorage 契约（6 个键，跨页面共享状态）

| 键 | 写入方 | 语义 |
| --- | --- | --- |
| `AICLIPLOGIN` | `LoginUserChange` / `SetCreatePoints` | 登录信息（含创点）|
| `DraftPath` | `SetDraftListFilePath` | 草稿目录 |
| `WorksPath` | `SetWorkListFilePath` | 作品目录 |
| `CreatePath` | `SetCreateWorkPath` | 生成输出目录 |
| `XhsImagePath` | `SetCreateXhsImagePath` | 红薯图文目录 |
| `PageId` | **原生写入**（`document.getElementById("PageId", val)` 形态）| 当前页面路由 |
| `CLIP_PAGEID` | 页面自己 | 编辑器子页 |
| `CLIP_OPENED` / `AICLIP_OPENED` / `XHSMB_OPENED` | `SwitchPage` | 首次打开标记 |

⇒ **`localStorage` 是 5 个页面之间的共享状态总线** —— 因为没有共享内存，
每个 iframe 是独立文档，只能靠 localStorage 通信。这是它唯一的跨页机制。

---

## 8. 复现

```bash
node extract-smart-clip-contract.cjs
```

输出 `04-rea-evidence/融媒宝-smart-clip桥契约.json`：31 正向 + 14 反向 + 参数个数 + 页面映射。

---

## 9. 未闭合

| # | 项 |
| --- | --- |
| 1 | **PageId 5 未取证** —— 门面里没出现，推断是任务中心，但没直接证据 |
| 2 | **原生侧这 45 个接口的实现未取证** | 在 `WEMedia.exe` 里，但该 exe 2 小时预算内分析不完（见 `融媒宝-主程序反编译可行性-实测结案.md`）|
| 3 | **`clientSetTextAudio` 的 8 个参数语义未逐个确认** —— 只知第 8 个是页面路由 |
| 4 | **`SetDownloadFontResult` 为空是刻意还是遗漏** —— 无证据，只能记「调用通、结果丢弃」 |
| 5 | **同步桥的 CEF 实现机制未取证** —— 4 个同步返回的桥需要原生在 `ExecuteJavaScript` 里同步返回，但没看到原生侧写法 |
| 6 | **`Object.values` 回填位置参数的脆弱性未验证是否会实际错位** |
