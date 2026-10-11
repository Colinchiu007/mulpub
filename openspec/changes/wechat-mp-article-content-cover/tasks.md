# Tasks — wechat-mp-article-content-cover

> 验收目标：公众号草稿**有标题 + 有正文 + 有封面**；历史记录缩略图是**本次实际使用的封面**（取不到时回退平台图标这条兜底不允许当默认）。
> 真机边界：微信后台 DOM 选择器以本文件 §7 的复核任务为最终门槛，未复核前不得声称端到端已通。

## 1. 复现与根因（QM-5 ①）

- [x] 读码取证：`_publish_wechat_mp` 全函数无 `cover` 字样（对照 `_publish_generic` L354 封面段）
- [x] 读码取证：正文注入走 `_setElementContentSafe` 的 `innerHTML` 分支，无读回校验
- [x] 读码取证：`IMAGE_TEXT_PLATFORMS` 不含 `wechat_mp`（L63），自动封面只落 `images`（L466-467）
- [x] 读码取证：`phase4-events.js` 两个 `addRecord` 均无封面键；`PublishHistory.vue` L1012 读不到 → 回退平台图标
- [ ] 真机复现：用运行中的应用发一条图文到公众号，导出草稿箱 DOM 取证「只有标题」（待有可用公众号账号时执行；本机现有会话不具备）

## 2. 契约层（纯函数，先测试后实现）

- [ ] `apps/desktop/electron/services/publish-record-cover.test.js`：优先级 4 级、空值写空串、非 http(s) URL 被丢弃、`cover_file.path` 兜底
- [ ] `apps/desktop/electron/services/publish-record-cover.js`：`resolveRecordCover(article)`

## 3. 公众号注入/上传实现（mock host 单测）

- [ ] `apps/desktop/electron/services/wechat-mp-article.test.js`：
  - 正文：无正文跳过；ProseMirror 命中走 `insertText`；回读 0 → `ok:false`；回读未超基线 → `ok:false`；iframe 兜底
  - 封面：无封面跳过；文件不存在 / 超 2MB → `ok:false` 且不点击；注入后 img 数超基线 → `ok:true`；未超基线 → `ok:false`
- [ ] `apps/desktop/electron/services/wechat-mp-article.js`：`fillWechatMpContent` / `uploadWechatMpCover`

## 4. 接线（主进程）

- [ ] `rpa-view-platforms.js`：`_publish_wechat_mp` 接入上述两段并 fail-closed（保留既有导航/保存/群发语义与顺序）
- [ ] `rpa-view-platforms.js`：`_publish_kuaishou` 图文模式 `cover_input: []`
- [ ] `rpa-view-platforms.test.js`：扩公众号段（有封面时的点击序、正文失败即中止、无封面时不新增点击/JS 调用——**既有 6 条断言不得改**）
- [ ] `bootstrap/phase4-events.js`：两个 `addRecord` 接入 `resolveRecordCover`
- [ ] `phase4-events*.test.js`：成功/失败记录均含 `cover_path`/`cover_url`

## 5. 渲染层

- [ ] `usePublishFlow.test.js`：V1–V6 触发矩阵（含 wechat_mp 命中、已有封面不生成、生成失败不阻断）；断言双通道落值
- [ ] `usePublishFlow.js`：`AUTO_COVER_PLATFORMS` + 触发条件 + 双通道落值
- [ ] `useHistoryCoverThumbnails.test.js`：本地优先、远程次之、存量键兼容、读取失败降级、缓存去重、迟到响应丢弃
- [ ] `useHistoryCoverThumbnails.js`
- [ ] `PublishHistory.test.js`：有 `cover_path` 渲染真实封面、无封面回退平台图标、读取失败回退
- [ ] `PublishHistory.vue`：单点接线（行数增量 ≤6）

## 6. 文案与文档

- [ ] `locales/zh.js` + `locales/en.js`：`coverGeneratedFailed` / `coverAlreadySet` 成对
- [ ] `01-docs/PRD-WECHAT-MP-ARTICLE-PUBLISH-2026-10-12.md`（含数据校验表 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字）
- [ ] `01-docs/PRD.md` 索引挂链
- [ ] `CHANGELOG.md` 收口
- [ ] `.quality-gates.md` 本次执行记录
- [ ] `openspec/records/wechat-mp-article-content-cover.md`

## 7. 真机复核（交付门槛，未完成即标注 PENDING）

- [ ] 导出 `appmsg_edit_v2` 编辑器 DOM：确认正文编辑器根节点与封面入口/弹层的真实选择器
- [ ] 按实况收敛 `wechat-mp-article.js` 的选择器常量表（只改常量，不改判据）
- [ ] 真机发布一条图文 → 公众号草稿箱核对「标题 + 正文 + 封面」三项齐全
- [ ] 历史页核对缩略图 = 该次发布使用的封面

## 8. 隔离、评审与落地

- [ ] 变异反证：摘掉封面 fail-closed / 摘掉回读判据 / 退回「只落 images」，对应用例必须变红
- [ ] `node .github/scripts/check-max-lines.js` 通过（重点盯 `PublishHistory.vue` / `rpa-view-platforms.js`）
- [ ] lint + 相关 vitest 全量
- [ ] CCG/对抗评审（QM-6）并逐条裁决
- [ ] push + PR + CI 全绿 + squash 合并 + 回填 `.quality-gates.md` 远程同步
