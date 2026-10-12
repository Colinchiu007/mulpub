## Why

同一条文案、同一次「图文发布」，快手侧产出的作品**有正文、有封面图**，而微信公众号草稿箱里**只有文章标题**——正文与封面双双为空。用户据此提出的三个问题，逐条都有代码级的确定答案，且答案都是「否」：

1. **「是不是发布动作时没有把合适的内容传过去？」——是，而且分两处缺**。
   - **封面：`_publish_wechat_mp` 从头到尾没有封面上传这一步**。该方法依次填标题、正文、作者、摘要、评论开关，然后直接点保存草稿（`apps/desktop/electron/services/rpa-view-platforms.js` 的 `async _publish_wechat_mp`，全函数 160 余行内不含任何 `cover` 字样）。对比 `_publish_generic`（快手走这条）在第 354 行起有完整的 `article.cover_path` → `input[type=file]` 注入段。**平台间能力不对等，不是「传错了」，是「根本没传」**。而公众号的封面是**必填项**（封面为空时后台保存草稿会带必填校验），所以现象不是「封面丢了」而是「草稿本身不完整」。
   - **正文：填充机制对不上编辑器的模型层**。同一步用的是 `_setElementContentSafe(win, contentSel, article.content)`，其默认分支执行 `el.innerHTML = tmp.innerHTML`。新版公众号编辑器（`appmsg_edit_v2`）的正文是 **ProseMirror** 一类「以内部文档模型为真源」的富文本编辑器——**直接改 DOM 不会被模型接受，甚至会被下一次重渲染回滚**，于是「界面上一度看见文字 → 保存后正文为空」。这与本仓 2026-09-30 已就头条记录过的同族教训完全一致（`_fillInput` 的注释：旧实现「无论是否生效都返回 true」导致「填充未生效被当成成功」）。
2. **「没有封面图片时，系统是不是自动生成一个封面，发布时应用它？」——只对了一半，且恰好漏掉公众号**。
   `usePublishFlow.js` 确有一条自动封面兜底：**当且仅当**所选平台命中 `IMAGE_TEXT_PLATFORMS = ['xiaohongshu','kuaishou','douyin','toutiao']` 且表单无图、标题非空时，调 `cover:generate-ai` 生成（AI 生图优先、本地内容感知标题卡兜底），成功后写进 `article.images` / `article.image_files`。**`wechat_mp` 不在这个列表里**，因此「只发公众号」时一步都不会触发；即便与快手同选触发了，产物也只落到 `images`（图片通道），**从不写 `article.cover_path`**——而封面上传链路消费的正是 `cover_path`。结论：自动封面「生成了」，但「没有应用到公众号封面字段」。
3. **「历史记录页的缩略图好像不是真实的封面」——不是「不是」，而是「从来没有写过」**。
   `PublishHistory.vue` 的 `thumbnailUrl(record)` 读 `record.thumbnail || thumbnailUrl || cover || coverUrl`，而**两个落库点**（`bootstrap/phase4-events.js` 的 `task:success` / `task:failed`）调 `history.addRecord()` 时只写 `platform / title / taskId / status / result / error / publishMode`——**没有任何封面字段**。于是该表达式恒为空，模板回退成**平台图标**（`record-preview` 里的 `platform-icon-thumb` 分支）。用户看到的「不是真实封面」就是平台图标。

三个问题同源：**「本次发布实际用了哪张封面」这件事从来没有被当作一等数据**——既没有在公众号链路里上传，也没有在表单兜底里落到封面字段，也没有在发布历史里落库。

## What Changes

- **`apps/desktop/src/composables/usePublishFlow.js`**：图文自动封面兜底扩到「需要封面的平台」。
  - 新增 `AUTO_COVER_PLATFORMS = IMAGE_TEXT_PLATFORMS ∪ ['wechat_mp']`（单一真源，禁止在别处再列一份）。
  - 触发的**完备**判据：非视频发布 ∧ 命中 `AUTO_COVER_PLATFORMS` ∧ 无 `images`/`image_files` ∧ **无 `cover_path`/`cover_file`/`cover_url`** ∧ 标题去空白后非空。原判据漏了「已有封面」这一项——用户已选封面时不该再生成一张把它盖掉。
  - 生成成功后**双通道落值**：`images`/`image_files`（图片型平台首图，保持原行为）**且** `cover_path`/`cover_file`（封面型平台，本期新增）。
  - 生成失败不阻断发布（保持原语义），但进度面板文案区分「已生成并自动应用」与「生成失败，按无封面继续」。
- **`apps/desktop/electron/services/rpa-view-platforms.js`**：
  - `_publish_wechat_mp` 正文段改为**编辑器感知注入**，并在正文为空时 fail-closed。
  - `_publish_wechat_mp` 在保存草稿**之前**新增**封面上传段**（含上传后校验）；`article.cover_path` 存在但未生效时**fail-closed**，不再把「无封面的不完整草稿」记成 success。
  - `_publish_kuaishou` 图文模式的 `cover_input` 显式置空：图文模式下图片已由 `file_input`/拖拽区上传，封面通道若同时注入同一张图会造成**重复图片**（这是本次「自动封面也写 `cover_path`」的必要配套）。
- **新增 `apps/desktop/electron/services/wechat-mp-article.js`**：把上述两段的实现与判据从 1475 行的平台 mixin 中拆出（逐文件行数门禁：该文件基线 1422 + 容差 200），暴露 `fillWechatMpContent(host, win, content)` 与 `uploadWechatMpCover(host, win, coverPath)`，两者都返回**结构化结果**（`{ ok, detail, readBack }`），由调用方决定成败。
- **新增 `apps/desktop/electron/services/publish-record-cover.js`**：`resolveRecordCover(article)` 单一真源，按「用户显式选的本地封面 → 自动生成封面 → 远程封面 URL → 首图」优先级产出 `{ cover_path, cover_url }`。
- **`apps/desktop/electron/bootstrap/phase4-events.js`**：`task:success` / `task:failed` 落库时写入 `resolveRecordCover()` 的结果（`cover_path` 与 `cover_url` 两个键，缺值写空串不写 `undefined`）。
- **新增 `apps/desktop/src/composables/useHistoryCoverThumbnails.js`** 与 **`apps/desktop/src/views/PublishHistory.vue`** 接线：历史记录里的**本地封面路径**经既有 `cover:read-data` IPC 转 dataURL 渲染（渲染层 CSP 的 `img-src` 不含 `file:`，本地绝对路径不能直接当 `<img src>`）；远程 `http(s)` 封面经共享协议判据 `safeHttpUrl` 后直接使用；两者都拿不到时保持「平台图标」回退——**回退是兜底，不是默认**。
- **`apps/desktop/src/locales/zh.js` / `en.js`**：新增进度文案成对落地。

**不变的红线**

- 不改 `publisher-router.js` 的 `buildPublishArticle` 字段解析、不改 `image_text` 平台既有图片上传拓扑。
- 不改发布历史 JSONL 的既有键语义，只**新增**两个键；存量记录（无这两个键）渲染行为与今天一致（平台图标）。
- 不引入新的第三方依赖、不改 IPC 通道名、不改 `cover:read-data` 契约。

## Capabilities

### New Capabilities

- `wechat-mp-article-publish`: 微信公众号图文发布的**内容完整性契约**——正文必须经编辑器可信注入并在保存前验证（未生效即失败）；封面必须在保存草稿前上传并验证（有封面而上传未生效即失败）；自动封面兜底必须同时落 `images` 与 `cover_path`；发布历史必须落库本次实际使用的封面并能在历史页渲染出真实缩略图。

### Modified Capabilities

- `publish-history-record`: 发布记录新增 `cover_path` / `cover_url` 两个展示键（只增不改），历史页缩略图优先级随之确定。

## Impact

- **渲染端**：`apps/desktop/src/composables/usePublishFlow.js`、新增 `apps/desktop/src/composables/useHistoryCoverThumbnails.js`、`apps/desktop/src/views/PublishHistory.vue`、`apps/desktop/src/locales/{zh,en}.js`。
- **主进程**：`apps/desktop/electron/services/rpa-view-platforms.js`、新增 `apps/desktop/electron/services/wechat-mp-article.js`、新增 `apps/desktop/electron/services/publish-record-cover.js`、`apps/desktop/electron/bootstrap/phase4-events.js`。
- **测试**：`rpa-view-platforms.test.js`（扩公众号段）、新增 `wechat-mp-article.test.js`、新增 `publish-record-cover.test.js`、`phase4-events*.test.js`、`usePublishFlow.test.js`、新增 `useHistoryCoverThumbnails.test.js`、`PublishHistory.test.js`。
- **文档**：`01-docs/PRD-WECHAT-MP-ARTICLE-PUBLISH-2026-10-12.md`、`01-docs/PRD.md` 索引、`CHANGELOG.md`、`.quality-gates.md`、`openspec/records/<branch>.md`。
- **真机验证边界**：本变更的选择器与注入判据以「结构化结果 + 明确日志 + fail-closed」交付；**微信后台 DOM 的具体选择器需要真机复核**，未复核前不得声称端到端已通（详见 design.md 的「风险与回退」）。
