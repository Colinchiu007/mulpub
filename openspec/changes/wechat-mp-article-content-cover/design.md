# Design — wechat-mp-article-content-cover

## 1. 根因链（逐条取证）

### 1.1 公众号草稿只有标题

| 症状 | 取证位置 | 判据 |
| --- | --- | --- |
| 无封面 | `apps/desktop/electron/services/rpa-view-platforms.js` `async _publish_wechat_mp` | 该方法体内 `grep -c cover` = 0；对照 `_publish_generic` 第 354 行 `if (article.cover_path && sel.cover_input)` |
| 无正文 | 同上，`await this._setElementContentSafe(win, contentSel, article.content)` | `rpa-view-helpers.js` 的 `_setElementContentSafe` 默认 `useInnerHTML: true` → `el.innerHTML = tmp.innerHTML`（直接改 DOM，不经编辑器模型） |
| 无正文（第二因） | `packages/rpa-engine/src/platform-selectors.js` | 公众号选择器表里 **没有** `content_input` / `cover_input`，平台分支（非 generic）自己硬编码选择器字符串 |

**为什么「无正文」会被判成功**：`_setElementContentSafe` 的返回值只表示「元素找到且未抛错」，与「编辑器是否接受」无关；调用点没有读回校验。而同仓 `_fillInput` 早在 2026-09-30 就补上了读回校验（注释原文：「本函数此前**无论是否生效都返回 true**，导致「填充未生效」被当成成功」）——**同一族缺陷，修了一处没修另一处**。

**为什么现象是「只有标题」而不是发布失败**：保存草稿只看 `appmsgid` 出现（URL 或保存 XHR 响应），标题写进去了 → 保存成功 → `mediaId` 拿到 → 返回 `success: true`。正文/封面缺失不参与成功判据。

### 1.2 自动封面没应用到公众号

- 触发集合：`usePublishFlow.js` 第 63 行 `const IMAGE_TEXT_PLATFORMS = ['xiaohongshu', 'kuaishou', 'douyin', 'toutiao']`（`wechat_mp` 不在其中）。
- 触发条件（第 456-459 行）：`!isVideoMode && selectedPlatforms.some(p => IMAGE_TEXT_PLATFORMS.includes(p))`，且 `hasImages` 为假，且 `article.title.trim()` 非空。
  - **漏掉「已有封面」**：表单已选 `cover_path` 但没选图片时，仍会生成第二张封面并写进 `images`（多花一次生图调用，且让「用户选的封面」与「系统生成的封面」在同一次发布里并存）。
- 落值：`article.image_files = [coverFile]`、`article.images = [coverFile.path]`——**只落图片通道**。`buildArticleData()`（第 239-240 行）只在 `cover.cover_path` / `cover.cover_file` 存在时写 `data.cover_path` / `data.cover_file`，而这里从未写 `article.cover_path`。
- 结果：公众号拿到 `cover_path = null` → 无封面（与 1.1 叠加，即使补了上传段也仍然无图可传）。

### 1.3 历史缩略图不是真实封面

- 生产端：`bootstrap/phase4-events.js` 第 106 行（success）与第 207 行（failed）的 `history.addRecord({...})` 均**不含**任何封面键。
- 消费端：`PublishHistory.vue` 第 1012 行 `thumbnailUrl(record)` 读 `thumbnail | thumbnailUrl | cover | coverUrl` → 全 `undefined` → 模板第 223 行回退平台图标。
- 结论：**不是「缩略图取错了图」，是「缩略图数据从来不存在」**。修法是补生产端落库 + 消费端能把本地路径渲染出来。

### 1.4 为什么「同文案发快手正常、发公众号不正常」是必然

快手走 `_publish_generic`，它有：图片上传段（`article.images` → `file_input`/`drag_area`）、封面段（`article.cover_path` → `cover_input`）、`fillReport` 硬字段 fail-closed（2026-10-07 加的）。公众号走**平台专用分支**，这三样一个都没有。**平台能力不对等**是本次的根本形态。

## 2. 决策与备选方案

### 决策 1：正文注入用「焦点 + 全选 + `execCommand('insertText')`」而不是 `innerHTML`

- **选它**：`execCommand('insertText')` 走浏览器编辑管线，产出真实的 DOM 变更，ProseMirror/Quill/Lexical 的 `DOMObserver` 会把它同步进内部文档模型。本仓 `_fillInput` 的 contenteditable 分支已经是这个实现（且在知乎 Draft.js 上实测可用）。
- **不选 `innerHTML`**：直写 DOM 绕过模型，视觉上「有字」、模型里「没字」，保存即丢——**正是本次要修的形态**。
- **不选 `pause`/`paste` 模拟**：需要剪贴板权限与 `beforeinput` 合成，隐藏窗口下不稳定。
- **备选兜底**：`insertText` 抛错（老编辑器 `iframe#ueditor_0` 场景）时退回 `_fillInput` 的 `innerHTML` 分支——但此时判据不再是返回值，而是**稳定性回读**（注入后静置 800ms 再读一次 `innerText`，值被回滚即判未生效）。

### 决策 2：封面失败 fail-closed（不让不完整的草稿记 success）

- **选它**：公众号封面是必填项（`01-docs/platform-publish-options-audit/REPORT.md` 第 23 行：「封面图｜公众号必填」）。产出「无封面的草稿」并把这次发布记成 success，就是本次用户报障的形态本身。本仓同族判例：小红书草稿「内容未写入却报 success」已按假成功修掉（PR #3038），`_publish_generic` 的 `draftOnly` 也用 `fillReport` fail-closed。
- **不选「警告后继续」**：那是把「必填缺失」降级成静默——用户拿到的是一个自己还得手工补封面的草稿，且历史里显示成功。
- **风险与回退**：若真机上封面选择器失配，公众号发布会**从「成功但缺封面」变成「失败并给出原因」**。这是有意的方向（缺封面是必填违规），但必须给出**可操作的错误文案**（见 §4）并在真机取证后按选择器实况收敛；因此本期同时保留**正文/封面各自独立的诊断日志**（DOM dump + 候选命中的是哪一个），使一次真机失败即可定位到选择器层。

### 决策 3：封面数据用两个新键 `cover_path` / `cover_url`，不复用 `result.cover`

- **选它**：`record.result` 是发布器返回的原始对象，跨平台形态不一（部分平台返回 `cover_url`，多数不返回）。把展示面所需的封面**在落库时归一**成两个稳定键，消费端就不必理解各平台返回形状。
- **不选**「把封面塞进 `result`」：会让「平台返回值」与「我们补的展示字段」混在一起，后续任何 `result` 形状变更都会连带影响历史页。
- **不选**「新增第三个键 `thumbnail`」：`PublishHistory.vue` 现有优先级里 `thumbnail` 在最前，但该键语义模糊（既可能是远程也可能是本地）；用**语义明确**的 `cover_path`（本地）/ `cover_url`（远程）让「本地优先」这条规则在数据层就成立。

### 决策 4：本地封面路径的渲染走既有 `cover:read-data` IPC

- **选它**：渲染层 CSP 的 `img-src` 不含 `file:`（`useCoverPreview.js` 首段注释已写明），本地绝对路径不能直接当 `<img src>`。`cover:read-data` 是既有通道，已有单测与发送方校验。
- **不选**「新增 `media://` 自定义协议」：本仓 `media://` 属另一子系统（创作历史），为一张缩略图新增协议注册面不划算。
- **不选**「渲染层用 `file://`」：CSP 直接拒，且要改 CSP（安全面），代价远大于收益。

### 决策 5：新逻辑拆文件而不是塞进既有大文件

- `rpa-view-platforms.js` 当前 1475 行，逐文件行数门禁基线 **1422 + 容差 200 = 上限 1622**（`.github/scripts/max-lines-baseline.json`）。本次若把两段实现内联会吃掉大半余量，后续任何小改都会撞线。
- `PublishHistory.vue` 当前 1393 行，基线 **1205 + 200 = 1405**——**只剩 12 行余量**。因此历史缩略图的解析逻辑必须落在新 composable（`useHistoryCoverThumbnails.js`），网页侧只加「引入 + 一处取值 + 模板里一个属性」。
- `usePublishFlow.js` 当前 636 行，上限 **734**，余量 98 行，改动控制在 ~25 行内。

## 3. 数据校验规则表

### 3.1 自动封面触发（渲染层，`usePublishFlow.js`）

| # | 校验项 | 判据 | 不满足时 |
| --- | --- | --- | --- |
| V1 | 非视频发布 | `isVideoMode === false` | 不触发（视频走抽帧封面） |
| V2 | 选中平台命中自动封面集 | `selectedPlatforms ∩ AUTO_COVER_PLATFORMS ≠ ∅` | 不触发 |
| V3 | 无图片 | `image_files` 与 `images` 均空数组 | 不触发 |
| V4 | **无封面（新增）** | `article.cover_path` / `cover_file` / `cover_url` 全部为空 | 不触发（**用户已选封面优先级最高，不得被生成封面覆盖**） |
| V5 | 标题可用 | `article.title.trim()` 非空 | 不触发（生成器需要内容语义；且无标题本身会被前置校验拦下） |
| V6 | 返回码 | `res.code === 0 && res.data.coverPath` 非空 | 不落值、不阻断发布，进度面板记「生成失败」 |

### 3.2 封面取值（主进程，`publish-record-cover.js`）

| 优先级 | 键 | 说明 |
| --- | --- | --- |
| 1 | `article.cover_path` | 用户显式选择的本地封面，或渲染层自动生成后写入的本地封面 |
| 2 | `article.cover_file.path` | 描述符形态的同一张图（`cover_path` 缺失时） |
| 3 | `article.cover_url` | 远程封面地址（须过 `safeHttpUrl`，否则丢弃） |
| 4 | `article.images[0]` | 图文首图（快手/小红书这类「首图即封面」的平台） |

产出的 `cover_path` 必须是**本地绝对路径形态**（含盘符或 `/` 开头或 `file://`）；产出的 `cover_url` 必须是 `http(s)`。两者都可能为空串——**空是诚实值**，不写 `undefined`（`JSON.stringify` 会丢键，导致消费端分不清「没有封面」与「字段从未写过」）。

### 3.3 公众号正文注入（`wechat-mp-article.js`）

| # | 规则 | 判据 |
| --- | --- | --- |
| B1 | 无正文不做任何注入 | `content` 去空白后为空 → 直接返回 `{ ok: true, skipped: true }` |
| B2 | 编辑器候选按优先级尝试 | `#js_editor_content` → `.ProseMirror` → `.ql-editor` → `[data-lexical-editor="true"]` → `#js_editor` → `[contenteditable="true"]` |
| B3 | 旧版 iframe 兜底 | 主 frame 全失配时，尝试 `iframe#ueditor_0, iframe[src*="ueditor"]` 内注入 |
| B4 | 注入后**必须**回读 | 注入后静置 800ms，再读一次编辑器 `innerText` 去空白长度；`0` 且原文非空 → `ok: false` |
| B5 | 注入前后长度对比 | 回读长度与注入前基线比较：**未增长**即判未生效（防止「本来就有占位文字」被当成成功） |
| B6 | 失败即 fail-closed | `ok: false` → `_publish_wechat_mp` 返回 `{ success:false, error:'微信公众号正文未写入编辑器，已中止保存' }` |
| B7 | HTML 净化 | 注入前剥离 `script/iframe/object/embed` 与 `on*=` 属性（与 `_setElementContentSafe` 同口径），避免把上游 HTML 原样灌进特权页面 |

### 3.4 公众号封面上传（`wechat-mp-article.js`）

| # | 规则 | 判据 |
| --- | --- | --- |
| C1 | 仅当存在本地封面时执行 | `coverPath` 非空字符串 |
| C2 | 入口候选按优先级点击 | `.js_cover_area` → `#js_cover_area` → `.cover_area` → `.appmsg_cover` → 文本「封面」邻近可点元素 |
| C3 | 文件注入 | 弹层内 `input[type=file][accept*="image"]`（逐个尝试，`DataTransfer` + `change`/`input` 事件），与 `_uploadToutiaoCover` 同款通道 |
| C4 | 生效判据 = **缩略图基线递增** | 读封面容器内 `img` 数作基线，注入后轮询计数 > 基线（复用 `_waitForThumbnailIncrease` 的判据形态） |
| C5 | 确认按钮 | 若弹层存在「确定 / 下一步」，在缩略图出现后点击（候选 `:has-text("确定")`） |
| C6 | 失败即 fail-closed | `ok: false` → `{ success:false, error:'微信公众号封面图上传未生效，已中止保存：<detail>' }` |
| C7 | 文件大小预检 | > 2MB 直接失败并给出「封面图不能超过 2MB」（与 `python-backend/.../wechat_mp.py` 的 `_upload_image` 同口径），避免上传后才报错 |
| C8 | 文件存在性预检 | 路径不存在 → 失败并给出路径尾段（不打印全路径，避免泄露用户目录结构） |

### 3.5 历史记录封面落库（`phase4-events.js`）

| # | 规则 | 判据 |
| --- | --- | --- |
| H1 | success 与 failed 两个落库点**同源** | 都调用 `resolveRecordCover(task.article)` |
| H2 | 只增键 | 不改动既有键（`platform/title/taskId/status/result/error/publishMode`） |
| H3 | 空值写空串 | 无封面时写 `cover_path: ''` / `cover_url: ''`，不写 `undefined` |
| H4 | 不落非 `http(s)` 的 URL | `cover_url` 经 `safeHttpUrl` 过滤 |

### 3.6 历史页缩略图渲染（`useHistoryCoverThumbnails.js`）

| # | 规则 | 判据 |
| --- | --- | --- |
| T1 | 本地路径优先 | `record.cover_path` 非空 → 经 `cover:read-data` 取 dataURL |
| T2 | 远程 URL 次之 | `safeHttpUrl(record.cover_url)` 非空 → 直接作 `<img src>` |
| T3 | 兼容存量键 | 仍认 `thumbnail / thumbnailUrl / cover / coverUrl`（存量记录与既有测试不得破） |
| T4 | 读取失败降级 | IPC 返回非 0 或抛错 → 该条回退平台图标，**不渲染坏的 `<img>`** |
| T5 | 缓存与去重 | 按路径缓存结果（同一封面被多条记录引用时只读一次）；请求带序号，**迟到响应不得写回**（用户快速翻页/筛选时不能串图） |
| T6 | 卸载即作废在途请求 | `onScopeDispose` 递增序号 |

## 4. 交互逻辑与提示文字

### 4.1 关闭「已在图库、仍在生成」的隐形浪费（V4）

改造前：表单已有 `cover_path` 但无图片 → 仍触发一次 AI 生图（可能计费）。改造后：已有任一封面键即不生成。**用户可感知的差异**：不再出现「我明明选了封面，进度里却多了一条『正在生成封面』」。

### 4.2 进度面板文案（`publishPage.publishFlow.*`，zh/en 成对）

| key | zh | en | 触发 |
| --- | --- | --- | --- |
| `generatingCover` | 正在生成封面图… | Generating cover image… | 生成开始（既有键，不改） |
| `coverGenerated` | 封面图已生成并自动应用 | Cover generated and applied automatically | 生成成功（既有键，语义微调为「并应用」） |
| `coverGeneratedFailed`（新增） | 封面图生成失败，本次按无封面继续 | Cover generation failed; publishing without a cover | `code !== 0` 或抛错 |
| `coverAlreadySet`（新增） | 已使用你选择的封面图，不再自动生成 | Using your selected cover; auto-generation skipped | V4 命中且其它条件成立 |

> 新增文案必须落在 locales（`apps/desktop/src/locales/{zh,en}.js`），渲染端 `src/` 非 locales 文件不得新增中文字符串字面量（CI Gate 7 + 基线扫描）。

### 4.3 公众号失败文案（主进程 error 字符串 → 进度/历史「失败原因」）

| 场景 | error 文案 |
| --- | --- |
| 正文未写入 | `微信公众号正文未写入编辑器，已中止保存` |
| 封面未生效 | `微信公众号封面图上传未生效，已中止保存：<detail>` |
| 封面文件不存在 | `微信公众号封面图文件不存在（…<路径尾段>）` |
| 封面超 2MB | `微信公众号封面图不能超过 2MB，当前 <n>MB` |
| 封面入口找不到 | `微信公众号封面入口未找到，已中止保存` |

历史页「失败原因」行渲染 `record.error`（`recordErrorText(record)`，单行截断 + `title` 悬停全文），因此以上文案必须**单行可读、把关键信息放在前 40 字内**。

### 4.4 历史页缩略图显示项

| 状态 | 显示 |
| --- | --- |
| 有本地封面且读取成功 | 真实封面缩略图（`record-preview` 内 `<img>`，`object-fit: cover`，144×81 风格由既有 CSS 决定） |
| 只有远程封面 URL | 直接渲染远程图（浏览器加载） |
| 两者都无 / 读取失败 | **平台图标**（既有回退，`width=20 height=20`）——保持现状不变 |
| 记录详情/导出 | 不变（本期不扩字段到 CSV） |

## 5. 实施顺序（依赖）

1. 纯函数与契约层先行（可独立单测，无 Electron 依赖）：`publish-record-cover.js`。
2. 公众号注入/上传实现模块（依赖 `host` 注入的 helper 协议，可用 mock host 单测）：`wechat-mp-article.js`。
3. 接线：`rpa-view-platforms.js`（公众号段 + 快手 `cover_input` 置空）、`phase4-events.js`。
4. 渲染层：`usePublishFlow.js` 触发条件与双通道落值、`useHistoryCoverThumbnails.js`。
5. 视图：`PublishHistory.vue` 单点接线。
6. locales 成对。
7. 文档与证据落盘。

## 6. 风险与回退策略

| 风险 | 影响 | 缓解 / 回退 |
| --- | --- | --- |
| 微信公众号后台 DOM 选择器与实现不符 | 公众号发布从「成功但缺内容」变为「失败」 | ①结构化结果 + 候选命中日志（记下命中的是哪个候选），一次真机失败即可定位；②正文与封面**分开 fail**，正文成功而封面失败时 error 文案明确指出是封面；③选择器集中在 `wechat-mp-article.js` 顶部常量表，改一处即收敛；④真机复核前不声称端到端已通 |
| fail-closed 过严导致「本来能存草稿」变成「什么都存不下」 | 用户失去「至少存个标题」的兜底 | 仅对**用户/系统明确提供了**的内容 fail（有正文而没写进去、有封面而没生效）；两项都没有时行为与今天一致（只存标题并如实记录），不新增阻断 |
| `execCommand('insertText')` 在 ProseMirror 上仍被模型忽略 | 正文仍为空 | B4/B5 的**稳定性回读**会把这种静默失败转成显式失败；同时正文注入的 DOM dump 日志保留编辑器类名，便于按实况补选择器 |
| 快手图文重复图片 | 已通的快手链路回归 | `_publish_kuaishou` 图文模式显式 `cover_input: []` + 回归测试断言该配置；且 `_publish_generic` 的封面段本身是 `try/catch` 非致命，双保险 |
| 历史 `cover_path` 泄露本机目录结构 | 隐私 | 历史记录是**本机 owner 隔离**的 JSONL（`owner_subject`），不随云端同步；IPC `cover:read-data` 已有发送方校验；日志只打印路径尾段 |
| `PublishHistory.vue` 行数撞门禁 | CI 红 | 解析逻辑全部落在新 composable，视图侧只加 ≤6 行；提交前跑 `node .github/scripts/check-max-lines.js` |
