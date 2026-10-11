# PRD：微信公众号图文发布的正文与封面完整性 + 发布历史真实封面缩略图

> 关联 change：`openspec/changes/wechat-mp-article-content-cover/`
> 分支：`wxmp-article-content-cover` ｜ 记录：`openspec/records/wxmp-article-content-cover.md`
> 日期：2026-10-12 ｜ 类型：缺陷修复（跨渲染层 + 主进程）

---

## 1. 背景与问题陈述

用户用**同一条文案**分别发布图文到快手与微信公众号，观察到的差异：

| 平台 | 正文 | 封面 | 用户判断 |
| --- | --- | --- | --- |
| 快手 | 有 | 有（自动生成的封面图） | 符合预期 |
| 微信公众号（草稿箱） | **无** | **无** | 「是不是发布动作时没有把合适的内容传过去？」 |

用户同时提出两个追问：

1. 「发布图文时，页面填写的信息中，如果没有封面图片，系统是不是自动生成一个封面图片，然后发布时应用这张封面图片？」
2. 「发布的历史记录页，发布任务的缩略图，好像不是发布的真实的封面图片。修复一下。」

**结论（三问都有代码级确定答案，且答案都是「否」）**：

| 用户问题 | 事实 | 一句话结论 |
| --- | --- | --- |
| 发布动作没把内容传过去？ | 封面：`_publish_wechat_mp` **完全没有封面上传这一步**；正文：用 `innerHTML` 直写模型驱动编辑器（ProseMirror），不进模型 | **是**——不是「传错了」，是封面**根本没传**、正文**传了但没进模型** |
| 没封面时自动生成并用它发布？ | 自动封面兜底存在，但触发集合不含 `wechat_mp`，且只写 `images` 不写 `cover_path` | **只对一半**——「生成了」但「没有应用到公众号封面字段」 |
| 历史缩略图不是真实封面？ | 两个落库点**一个封面键都没写**，读侧表达式恒空 → 回退平台图标 | **不是「取错图」，是「数据从来不存在」** |

### 1.1 三个缺陷同源

**「本次发布实际用了哪张封面」从来没有被当作一等数据**：既没有在公众号链路里上传，也没有在表单兜底里落到封面字段，也没有在发布历史里落库。

### 1.2 为什么「同文案发快手正常」不是巧合

快手走 `_publish_generic`，它同时具备三样东西：图片上传段（`article.images` → `file_input` / 拖拽区）、封面段（`article.cover_path` → `cover_input`）、以及 2026-10-07 补的硬字段 fail-closed（`fillReport`）。微信公众号走**平台专用分支**，这三样一个都没有 —— **平台能力不对等**是本次的根本形态，而不是某个字段名写错。

---

## 2. 目标与非目标

### 2.1 目标

- **G1** 微信公众号草稿箱里，一次图文发布的结果**有标题、有正文、有封面**三项齐全。
- **G2** 未提供封面图片时，自动生成的封面必须**同时**作用到「要求至少一张图的平台」与「封面必填的平台」。
- **G3** 发布历史页的缩略图显示**该次发布实际使用的封面**；确实没有封面时回退平台图标（回退是兜底，不是默认）。
- **G4** 上述三项在链路的任一步未真正生效时，**不得**把这次发布记成成功。

### 2.2 非目标

- 不改 `publisher-router.js` 的 `buildPublishArticle` 字段解析优先级。
- 不改图片型平台（小红书 / 快手 / 抖音 / 头条）既有图片上传拓扑与草稿语义。
- 不引入新第三方依赖、不新增 IPC 通道、不改 `cover:read-data` 契约。
- 不改发布历史 JSONL 的既有键语义（**只增** `cover_path` / `cover_url`）。
- 不为公众号增加「从正文选择封面」（`从正文中选择` 菜单项）这一支；本期只走「从图片库选择 / 上传图片」。

---

## 3. 功能逻辑

### 3.1 F1 自动封面兜底的触发完备性（渲染层）

**位置**：`apps/desktop/src/composables/usePublishFlow.js`

**触发条件（四项必须同时成立）**：

| # | 条件 | 判据 | 不满足时 |
| --- | --- | --- | --- |
| V1 | 非视频发布 | `isVideoMode === false`（由注入的 `activeMode` ref 决定，**不是** `article.video_path`） | 不触发 |
| V2 | 选中平台命中自动封面集合 | `selectedPlatforms ∩ AUTO_COVER_PLATFORMS ≠ ∅` | 不触发 |
| V3 | 无图片 | `image_files` 与 `images` 均为空数组 | 不触发 |
| V4 | **无任何封面** | `cover_path` / `cover_file` / `cover_url` 三者皆空（空白串视为空） | 不触发，并提示「已使用你选择的封面图」 |
| V5 | 标题可用 | `article.title.trim()` 非空 | 不触发（无标题会被前置校验拦下） |
| V6 | 生成返回码 | `code === 0 && data.coverPath` 非空 | 不阻断发布，进度面板记失败 |

**`AUTO_COVER_PLATFORMS` 的定义（单一真源）**：

```
AUTO_COVER_PLATFORMS = IMAGE_TEXT_PLATFORMS ∪ ['wechat_mp']
IMAGE_TEXT_PLATFORMS = ['xiaohongshu', 'kuaishou', 'douyin', 'toutiao']   // 要求至少一张图
'wechat_mp'                                                              // 封面必填
```

**为什么 V4 是本次新增且必须**：原判据只有 V1/V2/V3/V5。用户「已选封面但没选图片」时会**再生成一张**，既白跑一次生图调用（可能计费），又让「用户选的封面」与「系统生成的封面」在同一次发布里并存。

### 3.2 F2 自动封面的双通道落值（渲染层）

生成成功后必须**同时**写两个通道：

| 通道 | 字段 | 服务的平台 | 不写的后果 |
| --- | --- | --- | --- |
| 图片通道 | `article.image_files = [f]`、`article.images = [f.path]` | 小红书 / 快手 / 抖音 / 头条（要求 ≥1 张图） | 这些平台图文发布必然失败 |
| 封面通道 | `article.cover_file = f`、`article.cover_path = f.path` | 微信公众号（封面必填） | 公众号草稿缺封面（本次报障） |

**配套约束（快手）**：`_publish_kuaishou` 在**图文模式**下把 `cover_input` 显式置空。原因是 `_publish_generic` 的封面段判据是 `article.cover_path && sel.cover_input`，图片已由 `file_input` / `drag_area` 上传后，封面通道会**再注入同一张图** ⇒ 重复图片。快手图文的语义本就是「首图即封面」，此处空是正确表达。

### 3.3 F3 微信公众号正文注入（主进程）

**位置**：`apps/desktop/electron/services/wechat-mp-article.js`

**通道按保真度降级，每一步都回读校验**：

| 序 | 通道 | 适用 | 保真度 | 失败后 |
| --- | --- | --- | --- | --- |
| A | `window.__MP_Editor_JSAPI__.invoke({ apiName: 'mp_editor_set_content', apiParam: { content: html } })` | 新版后台（`isNew=1`） | **HTML 全保真** | 降级 B |
| B | 合成 `paste`（`ClipboardEvent` + `DataTransfer('text/html')`） | 新版后台 | HTML（走编辑器自己的粘贴处理链） | 降级 C |
| C | CDP `Input.insertText`（本仓既有 `_insertTextTrusted`） | 通用框架编辑器 | 纯文本 | 降级 D |
| D | `_setElementContentSafe`（`innerHTML` 直写） | 旧版 ueditor | 纯文本，**未验证模型** | 降级 E |
| E | `_fillInFrame`（`iframe#ueditor_0` 内注入） | 旧版 iframe 编辑器 | 纯文本，**未验证模型** | 失败 |

**编辑器候选（按优先级）**：
`#js_editor .ProseMirror` → `.rich_media_content .ProseMirror` → `#js_editor_content` → `.ProseMirror` → `.ql-editor` → `[data-lexical-editor="true"]` → `[contenteditable="true"]`；
旧版 iframe：`iframe#ueditor_0` → `iframe[src*="ueditor"]`。

**注入前后处理（每一步）**：

1. **清空**：聚焦 → 全选 → `execCommand('delete')` → 读回「注入前基线」与「清空后长度」。
2. **注入**（按上表通道）。
3. **静置** 800ms（等编辑器把 `input` 事件并入内部文档模型）。
4. **回读**：读编辑器 `innerText` 去空白长度。**> 0** 才算进模型。

**判据不落在 Helper 返回值上**：这是本仓踩过的坑（`rpa-view-helpers.js` 的 `_fillInput` 注释原文：「旧实现**无论是否生效都返回 true**，导致「填充未生效」被当成成功」）。本模块只认页面真实回读。

**HTML 归一规则**：

- 正文含真标签（正则 `/<(?=[a-zA-Z/!?])[^>]*>/`，**不**把 `价格 <100 元` 当标签）⇒ 视为 HTML。
- 正文为纯文本 ⇒ 按行转 `<p>` 段落，并转义 `& < >`（不制造标签注入面）。
- 纯文本由 Node 侧 `stripHtmlToPlainText`（仓库既有单一实现）产出，供通道 B/C/D/E 使用。
- 通道 A 在页面内先经 `DOMParser` 净化：移除 `script / iframe / object / embed / link[rel=import]` 与全部 `on*=` 属性（与 `_setElementContentSafe` 同口径）。

### 3.4 F4 微信公众号封面上传（主进程）

**位置**：`apps/desktop/electron/services/wechat-mp-cover.js`

**交互序列**：

```
① 打开封面入口   #js_cover_area .js_cover_btn_area → #js_cover_area
                 → .select-cover__btn → .appmsg_cover → .cover_ct
                 → （全失配）页面内按文案兜底：设置封面/编辑封面/上传封面/选择封面
② 等弹层挂载     1800ms
③ 点菜单项       #js_cover_null .js_imagedialog → #js_cover_area .js_imagedialog
                 → #js_cover_null .js_selectCoverFromContent
                 → （全失配）按文案：从图片库选择 / 图片库 / 素材库 / 上传图片 / 从正文中选择
④ 等弹层挂载     1800ms
⑤ 注入文件       弹层内 input[type=file] 逐个尝试（DataTransfer + change/input 事件）
                 被受控组件拒绝时回退 CDP DOM.setFileInputFiles（逐个候选选择器）
⑥ 点确认         裁剪页「下一步 / 确定 / 确认 / 完成 / 使用 / 保存」（最多 4 次）
⑦ 校验生效       见下
```

**生效判据（按证据强度，任一成立即算生效）**：

| 强度 | 判据 | 依据 |
| --- | --- | --- |
| ① 最强 | 封面 CDN 链接出现：`.js_cover_preview_new` 等预览节点的 `background-image`，或 `#js_cover_area` 的 HTML 里出现 `mmbiz.qpic.cn` | 封面地址只活在 React state 与 CDN URL 里 |
| ② 强 | 预览节点（`.js_cover_preview_new` / `.select-cover__preview` / `.weui-desktop-publish__cover__thumb`）存在**且**背景图非空、非 `data:` | 预览节点是封面上屏的必然后果 |
| ③ 最弱 | 封面容器内 `img` 数**超过注入前基线** | 仅作兜底 |

⛔ **不得把 ③ 当主判据**：新版封面预览是 `background-image` 的 div，常常一个 `img` 都不加 —— 用它会把上传成功判成失败，直接把公众号发布打死。
⛔ **不得用「占位文案消失 / 容器变空」当判据**：有第三方项目明确记录过「封面已设置但 `#js_cover_area` 仍显示占位文案」。

### 3.5 F5 发布历史记录封面落库（主进程）

**位置**：`apps/desktop/electron/services/publish-record-cover.js`（单一真源）+ `apps/desktop/electron/bootstrap/phase4-events.js`（两个落库点）

**取值优先级**：`cover_path`（本地）→ `cover_file.path` → `images[0]`；本地候选全失配时再按同序取第一个合法 `http(s)`（`cover_url` 字段自身排在最前）。

**互斥规则**：本地封面胜出时 `cover_url` **必须为空串**。依据是仓库既有结论（`publish-upload-file.js` 的 `resolveCoverFields`：「本地封面胜出时清空 URL，残留 URL 不得遮蔽用户刚选中的文件」）—— 记录里留两个非空值，会把消费端的优先级规则重新变成两处判据。

**空值规则**：无封面时写**空串**而不是 `undefined`。`JSON.stringify` 会丢掉 `undefined` 键，消费端就分不清「这次没有封面」与「这个字段从来没被写过」。

**同源规则**：`task:success` 与 `task:failed` **必须**调用同一个 `resolveRecordCover` —— 用户恰恰要在失败记录里确认「当时用的是哪张封面」；两个落库点各写一份优先级，漂移的方向必然是失败记录没有封面。

### 3.6 F6 历史页真实封面缩略图（渲染层）

**位置**：`apps/desktop/src/composables/useHistoryCoverThumbnails.js` + `PublishHistory.vue`（单点接线）

**解析优先级**：

1. `record.cover_path` 是本地路径 ⇒ 经 `cover:read-data` IPC 转 dataURL 后渲染。
2. 否则取第一个合法 `http(s)`：`cover_url` → `coverUrl` → `thumbnailUrl` → `thumbnail` → `cover`（全部过共享协议判据 `safeHttpUrl`）。
3. 否则取第一个本地路径形态的存量键 ⇒ 同 1。
4. 都取不到 ⇒ 返回空串，模板回退**平台图标**。

**为什么本地路径必须经 IPC**：渲染层 CSP 的 `img-src` 不含 `file:`，本地绝对路径不能直接当 `<img src>`（`useCoverPreview.js` 同源结论）。

**竞态**：本地封面**仍在读取**时返回空串（不得先闪远程图或平台图标再跳成真实封面）；读取**失败**时允许回退远程候选；组件卸载（`onScopeDispose`）递增代号，**迟到响应不得写回**——错误证据比没有证据更糟。

---

## 4. 数据校验规则表

### 4.1 公众号封面文件（主进程，上传前）

| # | 校验项 | 判据 | 失败 detail | 用户可见文案 |
| --- | --- | --- | --- | --- |
| C1 | 是否提供了封面 | `cover_path` 去空白后非空 | —（`skipped`，不阻断） | — |
| C2 | 是否本地路径 | `isLocalImagePath`（盘符 / UNC / POSIX 绝对 / `file://`） | `not-a-local-file` | 封面图需为本地图片文件（当前是网络地址，DOM 轨道无法直接使用） |
| C3 | 文件是否存在 | `fs.existsSync` | `not-found` | 封面图文件不存在（<文件名>） |
| C4 | 文件可读 | `fs.statSync` 不抛错 | `stat-failed` | 封面图文件不可读 |
| C5 | 非空文件 | `size > 0` | `empty-file` | 封面图文件不可读 |
| C6 | **大小上限 2MB** | `size <= 2 * 1024 * 1024` | `too-large` | 封面图不能超过 2MB |
| C7 | 内容可读 | `readFileSync` 成功且 base64 非空 | `read-failed` | 封面图文件不可读 |
| C8 | 上传生效 | 见 §3.4 三条证据 | `cover-not-applied` | 封面图上传未取得生效证据 |

> C6 的口径与 `packages/python-backend/src/multi_publish/publishers/wechat_mp.py` 的 `_upload_image`（2MB 限制）一致 —— API 轨与 DOM 轨不得给出两个上限。
> C2 的存在理由：`publisher-router.js` 的 `buildPublishArticle` 写的是 `cover_path: cover_url || cover_path`，所以 `article.cover_path` **可能是 URL**；不显式区分就会退化成误导性的「文件不存在」。

### 4.2 公众号正文（主进程）

| # | 校验项 | 判据 | 失败 detail | 结果 |
| --- | --- | --- | --- | --- |
| B1 | 正文是否为空 | 去空白后为空 | —（`skipped`） | 跳过注入，不视为失败 |
| B2 | 归一后是否为空 | 剥标签后仍为空 | —（`skipped`） | 同上 |
| B3 | 编辑器是否存在 | 逐个候选探测，命中即用 | `editor-not-found` | 失败 |
| B4 | 注入是否生效 | 静置后回读 `innerText` 去空白长度 > 0 | `readback-zero` | 失败 |
| B5 | 注入面净化 | 通道 A 内 `DOMParser` 移除 `script/iframe/object/embed/link[rel=import]` 与 `on*=` | — | 强制 |
| B6 | HTML 判定 | `/<(?=[a-zA-Z/!?])[^>]*>/` | — | 纯文本按行转 `<p>` 并转义 |

### 4.3 自动封面（渲染层）

见 §3.1 的 V1–V6。

### 4.4 历史记录封面字段（主进程）

| # | 规则 | 判据 |
| --- | --- | --- |
| H1 | 键只增不改 | 既有 `platform/title/taskId/status/result/error/publishMode` 不动 |
| H2 | 空值写空串 | 无封面时 `cover_path: ''`、`cover_url: ''` |
| H3 | `cover_url` 白名单 | 必须过 `safeHttpUrl` |
| H4 | 本地优先且互斥 | 有本地封面 ⇒ `cover_url` 为空串 |
| H5 | 只认首图 | `images[0]`；不向后扫（避免把正文插图当封面） |

### 4.5 历史页缩略图（渲染层）

| # | 规则 | 判据 |
| --- | --- | --- |
| T1 | 本地优先 | `cover_path` 非空且是本地路径 |
| T2 | 协议白名单 | 远程候选一律过 `safeHttpUrl` |
| T3 | 读取中不闪 | 本地仍在读 ⇒ 返回空串 |
| T4 | 失败降级 | IPC 返回非 0 或抛错 ⇒ 回退远程候选，再回退平台图标；**不渲染破图** |
| T5 | 缓存去重 | 同一路径被多条记录引用只读一次 |
| T6 | 竞态 | 卸载/换代后迟到响应丢弃 |

---

## 5. 流程

### 5.1 端到端主流程（图文发布，含公众号）

```
用户填写标题/正文 ──► 点「一键发布」
        │
        ├─ 前置校验（标题非空 / 正文非空 / 账号可用 / 敏感词 / 排期合法）
        │
        ├─【F1】自动封面兜底判定
        │     ├─ 命中且无封面无图片 ⇒ cover:generate-ai（AI 生图优先 → 本地内容感知标题卡兜底）
        │     │        └─ 成功 ⇒【F2】双通道落值 + 进度「封面已生成并自动应用」
        │     │        └─ 失败 ⇒ 进度「封面图生成失败，本次按无封面继续发布」（不阻断）
        │     └─ 已有封面 ⇒ 进度「已使用你选择的封面图，不再自动生成」
        │
        ├─ buildArticleData() → publishBatch 入队（cover_path / cover_file / images 随载荷）
        │
        └─ 主进程 TaskQueue 逐平台执行
              ├─ 快手 → _publish_kuaishou → _publish_generic
              │     images → file_input / drag_area；cover_input 已置空（不重复插图）
              └─ 公众号 → _publish_wechat_mp
                    ① 首页取 token → appmsg_edit_v2 编辑器
                    ② 填标题（#title +【F3】.title-editor__input .ProseMirror 可信注入）
                    ③【F3】正文多通道注入 + 回读；未生效 ⇒ fail-closed
                    ④ 作者 / 摘要 / 评论开关
                    ⑤【F4】封面上传 + 生效校验；未生效 ⇒ fail-closed
                    ⑥ 勾同意 → 保存草稿（等 appmsgid / 保存 XHR）
                    ⑦ 可选群发
                    └─ 结果回传 →【F5】history.addRecord 落 cover_path / cover_url
        │
        └─ 历史页刷新 →【F6】缩略图 = 本次实际使用的封面（取不到回退平台图标）
```

### 5.2 失败语义（fail-closed 的边界）

| 场景 | 行为 |
| --- | --- |
| 未提供正文，也未提供封面 | 与本变更前一致（只填能填的），**不新增阻断** |
| 提供了正文但注入未生效 | 中止保存，error =「微信公众号正文未写入编辑器，已中止保存」 |
| 提供了本地封面但未取得生效证据 | 中止保存，error =「微信公众号<原因>，已中止保存」 |
| 提供了远程封面 URL（无本地文件） | 中止保存，error =「微信公众号封面图需为本地图片文件…」 |
| 未提供封面 | 跳过封面段，正文照常注入并校验 |

**设计取向说明**：仅对「用户/系统**明确提供了**的内容」fail-closed。两项都没提供时行为与今天一致。理由：公众号封面是必填项，产出「无封面的不完整草稿」并记 success 正是本次报障的形态；本仓已有同族判例（小红书草稿「内容未写入却报 success」按假成功修掉）。

---

## 6. 交互逻辑与显示项

### 6.1 发布页（`Publish.vue`）不受影响的既有交互

封面选择 / 视频抽帧 / AI 生成封面 / 裁剪 / 远程 URL 输入，五个封面的写入口与优先级**均不变**。

### 6.2 进度面板新增/调整的条目

| 触发时机 | 文案（zh） | 类型 |
| --- | --- | --- |
| 开始生成 | 正在生成封面图… | info |
| 生成成功 | ✓ 封面已生成并附加到内容 | success |
| **生成失败（新增）** | **封面图生成失败，本次按无封面继续发布** | warning |
| **已有封面（新增）** | **已使用你选择的封面图，不再自动生成** | info |

> 新增两条必须落在 `apps/desktop/src/locales/publish-page/{zh,en}.js`（成对）；渲染端 `src/` 非 locales 文件不得新增中文字符串字面量。

### 6.3 历史页显示项

| 状态 | `record-preview` 显示 |
| --- | --- |
| 有本地封面且读取成功 | 真实封面缩略图（`object-fit: cover`，尺寸由既有 CSS 决定） |
| 只有远程封面 URL | 远程图（浏览器直接加载） |
| 本地读取失败且有远程 URL | 远程图 |
| 两者都取不到 | **平台图标**（既有回退，尺寸 20×20，不变） |
| 读取中 | 空（不闪图标、不闪其它图） |
| 存量记录（本期之前） | 与改造前完全一致（平台图标） |

### 6.4 公众号发布失败原因（历史页「失败原因」行 + 通知）

| detail | error 全文（单行，关键信息在前 40 字） |
| --- | --- |
| `not-a-local-file` | 微信公众号封面图需为本地图片文件（当前是网络地址，DOM 轨道无法直接使用），已中止保存 |
| `not-found` | 微信公众号封面图文件不存在（<文件名>），已中止保存 |
| `too-large` | 微信公众号封面图不能超过 2MB，已中止保存 |
| `entry-not-found` | 微信公众号封面入口未找到，已中止保存 |
| `read-failed` / `stat-failed` / `empty-file` | 微信公众号封面图文件不可读，已中止保存 |
| `cover-not-applied` | 微信公众号封面图上传未取得生效证据，已中止保存 |
| 正文 `readback-zero` / `editor-not-found` | 微信公众号正文未写入编辑器，已中止保存 |

---

## 7. 可观测性（日志契约）

| 位置 | 级别 | 关键字段 |
| --- | --- | --- |
| 正文注入 | info | `content via jsapi-set_content / paste-html / cdp-insertText` + `selector` + `chars` |
| 正文降级 | warn | `jsapi set_content readback=0` / `paste-html readback=0` / `cdp-insertText readback=0` |
| 正文未验证路径 | warn | `content via innerHTML-fallback（未验证模型）` / `iframe-legacy（旧版编辑器，未验证）` |
| 封面基线 | info | `[wechat_mp cover] baseline img=<n> file=<名> bytes=<n>` |
| 封面入口/菜单 | info | `entry=<命中的选择器>` / `entry=IN-PAGE(<how>)` / `menu=<how>` |
| 封面确认 | info | `clicked "<下一步/确认>" step=<n>` |
| 封面成功 | info | `OK input#<i> evidence=<cdn/preview-bg/img-delta> hasCdn bgUsable img=<a>→<b>` |
| 封面失败 | warn | `cover not applied detail=<d> file=<名> baseline=<n> evidence=<step:i/poll:i>` |

**日志红线**：不打印完整用户目录路径（只打文件名/路径尾段）；不打印正文内容。

---

## 8. 验收标准

| # | 验收项 | 判据 | 验证方式 |
| --- | --- | --- | --- |
| AC-1 | 只发公众号、无图无封面 ⇒ 生成封面并双通道落值 | `article.images` 与 `article.cover_path` 同时被写入 | `usePublishFlow.autocover.test.js` |
| AC-2 | 已有封面不再生成 | `generateAiCover` 零调用 + 进度含「已使用你选择的封面图」 | 同上 |
| AC-3 | 生成失败不阻断 | `publishBatch` 仍被调用 + 进度含「封面图生成失败」 | 同上 |
| AC-4 | 正文注入未生效 ⇒ 失败且不保存 | error 含「正文未写入编辑器」+ 无保存按钮点击 | `rpa-view-platforms.test.js` |
| AC-5 | 正文优先走 JSAPI / paste | `strategy` 分别为 `jsapi-set_content` / `paste-html` | `wechat-mp-article.test.js` |
| AC-6 | 封面生效判据含 background-image 分支 | `isCoverApplied({preview:true,bgUsable:true,imgCount:0},0) === 'preview-bg'` | 同上 |
| AC-7 | 封面未取得证据 ⇒ 失败且不保存 | error 含「封面图上传未取得生效证据」 | `rpa-view-platforms.test.js` |
| AC-8 | 封面文件存在性 / 2MB / 远程地址三条前置校验 | detail 分别 `not-found` / `too-large` / `not-a-local-file` | `wechat-mp-article.test.js` |
| AC-9 | 发布记录落库 `cover_path` + `cover_url`（成功与失败同源） | 两个 `addRecord` 调用均含两键，空值写空串 | `phase4-events.test.js` |
| AC-10 | 历史页渲染真实封面 | 本地路径经 IPC → `<img src="data:...">` | `PublishHistory.test.js` |
| AC-11 | 读不到封面回退平台图标 | 预览区无破图 `<img>` | 同上 |
| AC-12 | 快手图文不重复插图 | 图文模式 `cover_input: []` | `rpa-view-platforms.test.js` |
| AC-13 | 变异反证 | 6 条变异各自把对应的锁变红 | 见执行记录表 |

---

## 9. 风险与真机边界

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 微信后台 DOM 选择器与实现不符 | 公众号发布从「成功但缺内容」变为**失败** | ①结构化结果带命中的候选；②正文/封面分开 fail，文案指明是哪一步；③选择器集中在两个模块顶部常量表；④**未真机复核前不声称端到端已通** |
| fail-closed 过严 | 用户失去「至少存个标题」的兜底 | 仅对「明确提供了的内容」fail；两项都没有时行为不变 |
| 快手重复图片 | 已通的快手链路回归 | `cover_input: []` + 回归测试断言 |
| 历史 `cover_path` 含本机目录 | 隐私 | 历史 JSONL 本机 owner 隔离、不云同步；日志只打尾段 |
| 行数门禁 | CI 红 | 逻辑落在两个新模块 + 新 composable；`PublishHistory.vue` 单点接线；提交前跑 `check-max-lines.js` |

### 9.1 真机验证边界（不假装已闭合）

本机**无可用公众号账号会话**，因此：

- 已完成：读码级根因取证、契约与判据的单测/结构锁、变异反证、全部静态门禁。
- **未完成**：导出 `appmsg_edit_v2` 真实 DOM 核对选择器、真机发一条图文核对草稿三项齐全、历史页核对缩略图。
- `openspec/changes/wechat-mp-article-content-cover/tasks.md` §7 保留该门槛，未完成前不得声称端到端已通。

---

## 10. 相关文件

| 类型 | 路径 |
| --- | --- |
| 正文/标题注入 | `apps/desktop/electron/services/wechat-mp-article.js` |
| 封面注入 | `apps/desktop/electron/services/wechat-mp-cover.js` |
| 记录封面取值 | `apps/desktop/electron/services/publish-record-cover.js` |
| 平台分支接线 | `apps/desktop/electron/services/rpa-view-platforms.js` |
| 历史落库 | `apps/desktop/electron/bootstrap/phase4-events.js` |
| 自动封面兜底 | `apps/desktop/src/composables/usePublishFlow.js` |
| 历史缩略图 | `apps/desktop/src/composables/useHistoryCoverThumbnails.js`、`apps/desktop/src/views/PublishHistory.vue` |
| 文案 | `apps/desktop/src/locales/publish-page/{zh,en}.js` |
| 规格 | `openspec/changes/wechat-mp-article-content-cover/` |
