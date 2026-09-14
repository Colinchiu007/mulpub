# PRD：平台发布选项 P0-P3 实施计划落地

日期：2026-09-12 | 分支：codex/platform-publish-p0p3 | 状态：P0-P2 + P3 主体已实施（投票按用户要求不做）

## 背景

基于《全平台发布选项调研 + AI 生成内容能力比对报告》（01-docs/platform-publish-options-audit/REPORT.md，CCG 双模型审查修订版）发现的缺口，实施 P0-P3 计划。实施过程参考同类产品 4.0 逆向工程（D:/Data/mp-extracted/）的「统一 publishData 超集字段 + 每平台 worker 按需消费」架构。

## 参考产品实现方法复用清单

| 参考产品机制 | Multi-Publish 复用点 |
|-----------|---------------------|
| 统一 publishData 字段容器（title/desc/statement/visibleType/location/collection/subCategory/prePubTime 超集） | platformOverrides + resolvePlatformArticle 统一解析层 |
| 每平台 Worker 按需消费（DouYinWorker 读 poi_id/mix_id，BiliBiliWorker 读 tid/season_id） | adapter buildPostData 按平台取 taskData 字段 |
| 声明枚举（DouYinStatementType: AI生成=3/不适=4/虚构=5/危险=6） | zhihu declare 0-5 枚举 + kuaishou/baijiahao ai_generated |
| collection → {sourceId, sourceName} 统一合集模型 | baijiahao collection{id,name} → bjhtopic_info |
| createType original→copyright 1 / forward→2（B站版权映射） | bilibili copyright 1=自制 2=转载 |
| RPA 注入脚本按平台 DOM 选择器填字段 | rpa-view-platforms.js + platform-selectors.js（已有） |

## P0 — 修复断链（已完成 ✅）

### P0-1 AI 写稿三处适配
- **数据校验**：prompt 非空；type 必须 'llm'（TYPE_TO_METHOD 契约，ai-generator.js:17-24）；响应字段 content（非 text）
- **流程**：aiWrite() → modelProviderGetDefault('llm') 查默认 provider → aiGenerate('llm', providerId, {prompt}) → r.data.content 回填 quickText
- **功能逻辑**：provider 为 null 时走 python-bridge（/api/ai/generate 是队列占位 stub），必须先查默认 provider
- **显示项**：AI 写稿按钮（CreateView 快速渲染区）
- **提示文字**：成功静默回填；失败「AI 写稿失败: {message}」
- **文件**：apps/desktop/src/api/publisher.js（+aiGenerate/+modelProviderGetDefault 导出）、CreateView.vue:6274-6286

### P0-2 批量模式补 AI 声明
- **数据校验**：aiGenerated !== false 默认 true（fail-safe，与单篇 usePublishFlow.js:209 一致）
- **流程**：addArticle 模板初始化 aiGenerated: true → duplicateArticle 继承 → batchCreate payload 透传
- **文件**：apps/desktop/src/composables/useBatchPublish.js:204,236,402

### P0-3 平台特有字段三层透传
- **数据校验**（resolvePlatformArticle，publisher-router.js）：
  - bilibili：category 正整数（默认不透传，adapter 兜底 17）、copyright ∈ {1,2}（兜底 2）
  - youtube：categoryId 两位数字（兜底 "22"）、privacy ∈ {public,unlisted,private}（兜底 public）
  - tiktok：privacyLevel ∈ {PUBLIC,PRIVATE,FRIENDS}（兜底 PUBLIC）
  - baijiahao：original boolean、location 对象（须含 uid）或 locationName 手输转换
- **流程**：platformOverrides[platform] → resolvePlatformArticle → buildPublishArticle → taskData → adapter buildPostData
- **文件**：apps/desktop/electron/services/publisher-router.js:105-200,374-410

## P1 — 平台特有字段 UI（已完成 ✅）

### PlatformOverridePanel 扩展
- **B站**：分区下拉（10 常用分区：日常21/单机17/电竞171/影视124/科技231/搞笑138/鬼畜119/动物217/时尚207/资讯251）+ 版权声明下拉（转载2/自制1）
- **YouTube**：分类下拉（10 常用：人物博客22/音乐10/游戏20/娱乐24/科技28/教育27/体育17/旅行19/喜剧23/新闻25）+ 可见性下拉（公开/不公开列出/私享）
- **TikTok**：可见性下拉（所有人/朋友/仅自己）
- **百家号**：原创声明 checkbox + 位置输入（60 字截断）
- **交互逻辑**：启用差异化开关后显示；字段变更即时 emit update:modelValue；非法值自动回落默认
- **提示文字**：「为不同平台设置独立标题或正文，留空时使用默认内容」
- **文件**：apps/desktop/src/features/publish/components/PlatformOverridePanel.vue

## P2 — 合集与 AI 生成接入（已完成 ✅）

### P2-1 合集/播放列表全链路
- **B站**：collectionId（数字）→ adapter season_id + new_draft=1（选集模式）
- **YouTube**：playlistId（5-60 安全字符）→ videoBody.playlistId
- **百家号**：'ID' 或 'ID:名称' 格式输入 → collection{id,name} → bjhtopic_info/bjhtopic_id
- **数据校验**：B站正整数、YouTube 安全字符白名单、百家号正则解析
- **UI**：三平台差异化面板各加一个输入框

### P2-2 AI 封面生成
- **IPC**：cover:generate-ai（prompt 2-500 字符校验、style 7 枚举白名单、ratio 5 枚举白名单、sender 校验）
- **引擎**：复用 asset-generator.generateImage（Story2Video 生图链路，provider 优先 + ffmpeg 兜底）
- **输出**：%TMP%/multi-publish-cover-ai/img_N.png
- **UI**：视频表单封面区「AI 生成封面」按钮 → 弹窗（描述 textarea 500 字 + 风格下拉 7 项 + 比例下拉 5 项）
- **流程**：生成成功 → cover_path + cover_file + coverFileList 同步 → 可继续裁剪
- **提示文字**：zh/en 双语（aiGenerateCover/aiCoverPromptLabel/aiCoverStyle.*/aiCoverRatioLabel/aiCoverGenerating/aiCoverGenerated/aiCoverGenerateFailed/aiCoverCancel）
- **文件**：ipc-handlers/publish.js（handler）、preload/publish.js（桥接）、api/publisher.js（封装）、Publish.vue（UI）、locales/zh.js+en.js（文案）

## P3 — 长尾（待排期 ⏳）

### P3 第三批实施（2026-09-12 ✅，投票按用户确认不实施）

**P3-6 B站 RPA 分区 + 版权声明**
- 流程：_publish_generic B站分支调 _prepBilibili → 版权 radio（value=1/2 或文本「自制/转载」匹配）→ 分区搜索框输入 categoryName → 点选下拉候选
- 数据校验：copyright 仅 1|2（默认 2 转载）；categoryName 字符串（UI 层提供分区名）
- 选择器：category_selector（分区搜索/下拉）+ copyright_radio（自制/转载）

**P3-7 合集列表 API 拉取（替代手输 ID）**
- IPC：collection:list（platform 白名单 bilibili|baijiahao；按账号取 cookie；sender 校验）
- adapter：bilibili.listCollections（seasons API）、baijiahao.listCollections（topic list API）
- UI：B站/百家号面板「拉取我的合集」按钮 + 下拉选择（保留手输 ID 兜底）
- 提示文字：「拉取我的合集」「拉取中…」「不加入合集」「（先拉取或手输）」「或手输合集 ID」

**P3-1 商品字段透传（抖音/小红书）**
- 数据校验：goods 数组 ≤10 项 {id ≤64字, title ≤100字}，空 id 过滤
- adapter：douyin goodsInfoList、xiaohongshu shopping_cart.items（参考产品映射）

**P3-2 任务/活动字段透传（抖音）**
- 数据校验：taskId 安全字符 1-64（A-Za-z0-9_-）
- adapter：douyin hot_sentence（参考产品映射 hot_event）

**投票/交叉发布：按用户要求不实施（2026-09-12 确认）**

第三批测试：router 49/49（商品/任务透传+过滤）、publish IPC 31/31（collection:list 3 场景）、Panel+rpa 87/87、preload+bundle 362/362、局部回归 608/608、债务熔断全绿。

### P1-4/P1-5/P2-3/P3-3 收尾（2026-09-12 第二批实施 ✅）

**P1-4 公众号摘要（digest）**
- 数据校验：120 字截断；platformOverrides.wechat_mp.digest 优先，其次 article.digest
- 流程：PlatformOverridePanel 摘要 textarea → buildArticleData → buildPublishArticle（override_digest）→ wechat_mp adapter digest 字段 + RPA _publish_wechat_mp digest 填充（#digest 选择器，折叠时点「摘要」label 展开）
- 交互逻辑：留空时平台自动取正文开头（公众号默认行为）
- 提示文字：「摘要 最多 120 字，留空自动取正文开头」/「公众号图文摘要（选填）」

**P1-5 作者字段全平台透传**
- 数据校验：60 字截断，空值 null
- 流程：article.author（UI 已有输入）→ buildArticleData（已有 L201）→ buildPublishArticle（新增 author 字段）→ wechat_mp adapter + RPA（原仅 RPA 硬编码消费，现 adapter 也带）

**P2-3 AI 视频生成入口**
- 交互逻辑：视频表单视频区下方「用 AI 生成视频」按钮 → router.push('/create') 跳转创作页
- 设计决策：不在发布页内嵌视频生成（Story2Video 流水线已完整，避免重复实现），引导用户生成后回来发布
- 提示文字：「用 AI 生成视频」/「跳转到视频创作页，用 Story2Video 流水线生成后回来发布」（zh/en 双语）

**P3-3 公众号评论开关**
- 数据校验：boolean，默认 true（开评论=公众号默认行为）
- 流程：PlatformOverridePanel「开启留言（评论）」checkbox → buildPublishArticle openComment → adapter need_open_comment（0/1）+ RPA 关闭时点击 #js_comment_open
- 提示文字：「开启留言（评论）」

第二批测试：router 48/48（新增 digest/openComment/author 透传）、Panel 10/10（新增公众号摘要+评论开关）、局部回归 679/679、债务熔断全绿。

| 项 | 内容 | 依赖 |
|----|------|------|
| P3-1 | ✅ 商品字段透传已实施（UI 输入待后续） | — |
| P3-2 | ✅ 任务字段透传已实施（UI 输入待后续） | — |
| P3-3 | ✅ 已实施（第二批） | — |
| P3-4 | ❌ 投票/交叉发布按用户要求不实施 | 用户确认 |
| P3-5 | 国内平台必填性 RPA 实测（修正「待确认」标注） | 需真实账号 |
| P3-6 | ✅ 已实施（本批） | — |
| P3-7 | ✅ 已实施（本批） | — |

## 测试覆盖

| 模块 | 测试 | 结果 |
|------|------|------|
| publisher-router（透传+过滤+locationName 转换） | 47 tests | ✅ |
| PlatformOverridePanel（4 新平台字段+枚举校验） | 9 tests | ✅ |
| publish IPC（cover:generate-ai 4 场景） | 28 tests | ✅ |
| useBatchPublish（aiGenerated payload） | 54 tests | ✅ |
| CreateView（aiWrite 新契约） | 277 tests | ✅ |
| api/publisher（导出完整性） | 236 tests | ✅ |
| baijiahao-api-chain（bjhtopic 改动回归） | 24 tests | ✅ |
| 全量桌面套件 | 运行中 | 见 CI |

## 证据边界

- youtube.test.js 与 adapters-interface.test.js 的 `describe is not defined` 为预存问题（stash 验证与本次改动无关）
- B站分区在 API 路径生效（tid 透传）；RPA 路径（has_api:false 实际路径）无分区选择器，P3-6 补
- 合集 ID 需用户从平台后台手动获取（P3-7 改为 API 拉下拉）
