# PRD：参考产品 4.0 功能复用到 Multi-Publish

> **项目名称**：Multi-Publish 参考产品对标复用
> **版本**：v1.0
> **状态**：草案
> **日期**：2026-07-16

---

## 1. 项目背景与目标

### 1.1 背景

Multi-Publish v2.3.53 是一个 Electron 多平台内容发布工具，已具备基础的 RPA 发布能力（Python + Playwright），以及 API 发布引擎。参考产品 4.0（v4.13.19）是市场上成熟的多平台内容发布桌面应用，拥有完整的账号管理、内容发布、数据看板、评论管理等功能体系。

### 1.2 目标

通过逆向分析参考产品 4.0 的架构和功能实现，将经过市场验证的功能设计和架构经验复用到 Multi-Publish 中，目标是让 Multi-Publish 在功能完整度和用户体验上达到与参考产品同等水平，同时在菜单布局之外实现界面和功能的一致性。

### 1.3 成功标准

- 覆盖参考产品 90% 以上的核心功能（P0 + P1）
- 复用率 >= 60% 的架构设计理念
- 账号管理、内容发布、数据统计三大核心模块对齐
- 打包后 app 大小合理（不引入不必要的依赖）

---

## 2. 目标用户

| 用户类型 | 特征 | 核心需求 |
|---------|------|---------|
| 自媒体创作者 | 多平台运营，日更 1-5 篇 | 一键多平台发布、定时发布 |
| 营销团队 | 管理 5-50 个账号矩阵 | 批量发布、团队协作、数据报表 |
| MCN 机构 | 管理 50+ 账号 | 账号分组、权限管理、批量操作 |

---

## 3. 功能清单

### 3.1 功能分级说明

- **P0（必须）**：对标参考产品核心流程，用户每日高频使用
- **P1（重要）**：提升效率和体验的关键功能
- **P2（增强）**：差异化竞争力或特定场景功能

---

### 3.2 P0 功能（必须实现）

| 编号 | 功能模块 | 功能点 | Multi-Publish 现有状态 |
|------|---------|--------|----------------------|
| P0-01 | 侧边栏导航 | 首页/发布/账号/数据/工具/评论/创作/小蚁AI/团队/素材 导航 | 已有侧边栏，需对齐功能项 |
| P0-02 | 发布-多平台选择 | 支持至少 8 个平台（抖音/视频号/快手/小红书/知乎/百家号/微博/B站） | 已支持部分平台 |
| P0-03 | 发布-图文编辑器 | 富文本编辑、图片上传、封面选择、标签/话题/@好友 | 需增强编辑器功能 |
| P0-04 | 发布-视频发布 | 视频上传、封面截取、标题/简介/标签设置 | 已有基础功能 |
| P0-05 | 发布-定时发布 | 选择定时发布时间 | 已有部分实现 |
| P0-06 | 发布-多平台同步 | 一篇文章同时发布到多平台 | 已有基础功能 |
| P0-07 | 账号管理-登录 | 各平台扫码/账号密码登录（BrowserView） | 已有 qrcode-login.js |
| P0-08 | 账号管理-列表 | 已登录账号展示、状态管理 | 已有 account-manager.js |
| P0-09 | 账号管理-分组 | 账号分组管理 | 暂无 |
| P0-10 | 数据-总览仪表盘 | 发文数、粉丝增长、阅读量等概览 | 暂无 |
| P0-11 | 发布记录 | 已发布内容的状态跟踪（成功/失败/审核中） | 已有 publish-monitor.js |
| P0-12 | 草稿箱 | 保存/编辑/发布草稿 | 暂无 |
| P0-13 | 内容安全检测 | 敏感词检测、内容合规提示 | 已有 sensitive-filter.js |

---

### 3.3 P1 功能（重要）

| 编号 | 功能模块 | 功能点 | Multi-Publish 现有状态 |
|------|---------|--------|----------------------|
| P1-01 | 账号管理-收藏账号 | 常用账号收藏/快速切换 | 暂无 |
| P1-02 | 账号管理-分享管理 | 账号共享给团队成员 | 暂无 |
| P1-03 | 数据-账号分析 | 单账号维度数据趋势 | 暂无 |
| P1-04 | 数据-排行榜 | 内容表现排名 | 暂无 |
| P1-05 | 数据-内容管理 | 已发内容列表/编辑/删除 | 暂无 |
| P1-06 | 评论管理-自动回复 | 关键词自动回复规则设置 | 已有 comment-manager.js |
| P1-07 | 评论管理-消息列表 | 多平台评论/私信聚合 | 已有 comment-manager.js |
| P1-08 | 创作-AI 辅助 | AI 文案生成/改写 | 暂无（需集成 AI writer） |
| P1-09 | 创作-热点发现 | 平台热点话题推荐 | 暂无 |
| P1-10 | 素材管理 | 图片/视频素材库 | 暂无 |
| P1-11 | 团队协作 | 团队成员管理 | 暂无 |
| P1-12 | 系统托盘 | 最小化到托盘/后台运行 | 已有 system-tray.js |
| P1-13 | 全局快捷键 | Ctrl+Alt+数字键快速导航 | 已有 hotkeys.js |

---

### 3.4 P2 功能（增强）

| 编号 | 功能模块 | 功能点 | 说明 |
|------|---------|--------|------|
| P2-01 | 实时回调服务器 | HTTP POST 回调 + 59s 心跳（端口 16521） | 已有 callback-server.js |
| P2-02 | OAuth 2.0 认证 | YouTube/TikTok API Token 授权 | 已有 oauth-manager.js |
| P2-03 | 统一 SQLite 持久化 | 替代零散 JSONL | 已有 store.js |
| P2-04 | 批量发布管理器 | 批量编辑/排期/复制 | 已有 batch-manager.js |
| P2-05 | URL 内容采集 | HTTP+Playwright 双模式，og:meta 提取 | 已有 url-collector.js |
| P2-06 | 分屏监控 | 多平台发布实时监控（2/3/4/6 屏） | 已有 webview-manager.js |
| P2-07 | 账号登录状态持久化 | JSONL 持久化登录态 | 已有 account-state-restorer.js |
| P2-08 | 加密凭据存储 | AES-256-GCM 加密 | 已有 credential-store.js |

---

## 4. UI/UX 规格

### 4.1 整体布局

`
+------------------------------------------------------------------+
| 顶部标题栏（窗口控制 + 应用名 + 搜索/通知）                       |
+----------+-------------------------------------------------------+
| 左侧导航  |                                                       |
| +------+ |  主内容区域                                            |
| | 首页  | |                                                       |
| | 发布  | |  （根据导航切换不同视图）                               |
| | 账号  | |                                                       |
| | 数据  | |                                                       |
| | 工具  | |                                                       |
| | 评论  | |                                                       |
| | 创作  | |                                                       |
| |小蚁AI | |                                                       |
| | 团队  | |                                                       |
| | 素材  | |                                                       |
| +------+ |                                                       |
+----------+-------------------------------------------------------+
| 底部状态栏（发布进度/账号状态/网络状态）                           |
+------------------------------------------------------------------+
`

> **详细布局规格见**：[桌面端 UI 布局规格](../../docs/desktop-ui-layout-spec.md)


### 4.2 设计原则

1. **布局对齐**：左侧导航栏 10 项与参考产品完全一致（顺序可微调）
2. **交互一致**：Tab 切换、弹窗样式、表单布局与参考产品保持视觉一致
3. **操作流程**：发布流程、登录流程、数据查看流程与参考产品保持步骤一致
4. **品牌差异**：仅 Logo、配色、字体等品牌元素可自定义
5. **响应式**：支持窗口缩放，最小 1024x768

### 4.3 关键页面截图对照

详见 screenshots/mp/ 目录下 36 张截图，每张截图对应一个 Multi-Publish 待实现页面。

---

## 5. 验收标准

### 5.1 功能验收

| 验收点 | 标准 | 验证方式 |
|--------|------|---------|
| 侧边栏导航 | 10 个导航项全部实现，点击正确切换 | 手动测试 |
| 发布流程 | 从选择平台-编辑-发布-查看记录完整流程 | E2E 测试 |
| 账号登录 | 支持扫码+账号密码两种方式，登录态持久化 | 手动测试 |
| 多平台发布 | 至少 8 个平台可同时发布 | E2E 测试 |
| 数据看板 | 展示发文数/粉丝/阅读量等核心指标 | 视觉测试 |
| 草稿/记录 | 数据正确存储和读取 | 单元测试 |

### 5.2 质量验收

| 验收点 | 标准 |
|--------|------|
| 单元测试通过率 | >= 95% |
| 视觉回归测试 | 像素对比通过率 >= 90% |
| 内存占用 | 空闲 <= 200MB，发布中 <= 400MB |
| 启动时间 | <= 3 秒 |
| 打包验证 | npx electron-builder --win --x64 exit 0 |

---

## 6. 实施路线图

### Phase 1（2 周）：基础设施
- 对齐侧边栏导航（10项）
- 实现统一 Cookie/登录态管理
- 搭建 executeJS 发布引擎框架
- 实现账号管理页面（列表/登录/登出）

### Phase 2（2 周）：核心发布
- 完善发布编辑器（图文+视频）
- 对接 8 个平台的 executeJS 发布
- 实现草稿箱 + 发布记录
- 实现定时发布

### Phase 3（2 周）：数据与评论
- 数据仪表盘 + 账号分析
- 发布排行榜 + 内容管理
- 评论聚合 + 自动回复
- 敏感词检测

### Phase 4（1 周）：增强功能
- 创作工具 + AI 辅助
- 素材管理
- 团队协作
- 分屏监控

---

## 7. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 平台 API 变更 | 发布功能不可用 | 高 | 双模式（API + executeJS）互为备份 |
| 账号被封 | 用户投诉 | 中 | 限频、代理、行为模拟 |
| 逆向工程代码不全 | 实现遗漏 | 中 | 运行时动态补全分析 |
| 打包体积过大 | 下载成本高 | 低 | Tree-shaking + 按需加载 |
| 跨平台兼容 | 部分功能异常 | 中 | macOS/Linux 专项测试 |

---

## 8. 非功能需求

- **性能**：主进程内存 <= 150MB，渲染进程 <= 100MB
- **安全**：凭据 AES-256-GCM 加密存储，无明文密钥硬编码
- **离线**：核心功能支持离线使用，发布需网络
- **更新**：支持自动更新（已实现）
- **日志**：结构化日志（已实现）
- **国际化**：UI 支持中/英文切换

---

## 8. 2026-08 账号/发布高保真增补

本轮以安装包 v4.13.19、用户更正的逆向目录 D:\Data\projects\_逆向工程_参考产品4.0\ 和当前工作树可复现行为为证据。账号与发布主路径已收敛到 /accounts、/publish、/publish/history；模块导航新增“新建发布”，账号分组支持重命名和平台过滤，批量发布要求每个平台显式绑定账号。

### 8.1 交互验收

- 账号：搜索、状态/平台筛选、卡片/列表、收藏、默认账号、代理、登录状态条、批量启用/禁用/删除。
- 分组：创建、成员勾选、平台过滤、重命名、删除；localStorage 仅作为设备级实现，不承诺团队同步。
- 发布：单篇/批量、媒体与封面文件、标签/话题/@、平台覆盖、定时、草稿、进度、失败重试。
- 历史：平台/时间/状态筛选、详情和重试；记录删除和平台侧统计仍受后端能力约束。
- 批量状态操作只提交当前可见且已选中的账号 ID；非法标签、话题、@好友和文件描述在进入 IPC 前 fail closed。

### 8.2 明确不纳入伪实现

手机号/密码登录、团队分享、跨设备同步、真实第三方发布和平台审核结果必须有对应 IPC/API/远端凭据后再实现。前端只能展示入口、加载态、错误态或“未接入”提示，不能用固定成功数据满足验收。

### 8.3 设计系统债务

全局 token 已存在，但本轮仍保留部分 inline/scoped 样式、平台元数据多源和草稿双列表实现。后续应按“token → shared view-model → page CSS”顺序抽取，避免影响现有发布 IPC 合同。

### 8.4 本轮验证证据

- 桌面 Vitest：341 个文件、5932 个用例通过；账号/发布定向合同覆盖 126 个账号用例和 13 个发布合同用例。
- 视觉：像素门禁 17/17、功能性视觉回归 25/25、单视图机器断言全部通过；账号/发布/发布记录基线已按新工作区人工审阅后刷新。
- 构建：Vue/Preload 构建通过；Windows x64 Electron Builder、asar 清单、`@multi-publish/rpa-engine` require 和 8 秒启动检查均完成。
- 真实平台登录、团队服务和线上发布结果仍属于外部依赖，不计入本地通过率。

## 9. 2026-08 Round 2 布局与代码收敛增补

本轮聚焦布局系统统一和代码多源收敛，不修改 main 进程 IPC 合同。

### 9.1 已完成

- **布局统一**：`App.vue` 挂载 `MpSidebar`，`isMpWorkspace` 从 3 条路由白名单改为排除式黑名单，覆盖全部主导航路由（`/`、`/accounts`、`/publish`、`/publish/history` 等）。
- **首页重写**：`Home.vue` 完全重写为参考产品风格仪表盘（问候语+快捷操作、4 列数据概览、6 宫格快捷入口、支持平台展示、近期动态）。
- **导航动态化**：`MpSidebar` 用户名/头像从 `identityStore` 读取，许可证标签从 `licenseStore` 读取；`MpModuleNav` 新增 homeTabs、publishTabs 加入"新建发布"。
- **代码收敛**：`accounts.js` 新增 `ensureLoaded()` 幂等加载；`PublishHistory.vue` 平台名/图标/视频判断统一到 `platformStore`；新建 `PublishDraftList.vue` 共享草稿列表组件。
- **测试更新**：`MpSidebar.test.js`、`MpModuleNav.test.js` 同步更新。

### 9.2 待后续完成

- `Publish.vue` 中仍有 inline style 未迁移到 scoped CSS + token（平台覆盖面板、定时发布控件等）。
- 弹窗组件（`AccountLoginDialog`、`AccountProxyDialog`、`AccountGroupManager`）的样式微调。
- `publish-contract.js` 中 `PLATFORM_LABELS` 尚未完全废弃（待全量迁移后删除）。
- 视觉像素对比测试（需参考产品截图基线）。

## 10. 封面裁剪（2026-08-26，Phase A 交付）

> 参考产品 UE 对标 + 真实发布 E2E 的前置能力：视频封面提取后支持拖拽裁剪，输出体积控制 ≤ 512KB（快手平台限制）。

### 10.1 功能

- **封面裁剪**：发布表单封面行新增「裁剪封面」按钮（封面已提取/选择后可用），打开 CoverCropDialog。
- **裁剪交互**：预览图 + 拖拽裁剪框 + 比例预设（16:9 / 1:1 / 4:3 / 自由）；rect 越界自动收敛到图片边界。
- **体积控制**：主进程 offscreen canvas 裁剪 + JPEG 质量自适应二分压缩，确保输出 ≤ 512KB（快手硬限制）；最低质量仍超限时返回 overLimit 标志供 UI 提示。
- **预览加载**：渲染层无法直接引用 ile:// 图片，经 cover:read-data 读为 dataURL 展示。

### 10.2 数据校验

- ect：必须为含 x/y/width/height 的有限数字对象，宽高为正数，越界裁剪到图片边界。
- imagePath：非空字符串且文件存在；扩展名限 jpg/jpeg/png/webp。

### 10.3 交互流程

1. 视频封面提取/选择 → 封面行显示「裁剪封面」按钮
2. 点击 → CoverCropDialog 打开（预览 + 裁剪框）
3. 拖拽调整 / 选择比例 → 确认 → IPC cover:crop
4. 成功 → 回填 cover_path/coverFileList + Toast 成功；失败 → Toast 错误信息

### 10.4 提示文字（i18n 成对）

| 键 | zh | en |
|---|---|---|
| coverCrop.title | 裁剪封面 | Crop Cover |
| coverCrop.dragHint | 拖动裁剪框调整范围，可选比例后自动锁定 | Drag the crop box to adjust the area; pick a ratio to lock it |
| coverCrop.confirm | 裁剪 | Crop |
| coverCrop.cancel | 取消 | Cancel |
| coverCrop.loadFailed / cropFailed | 封面图片加载失败 / 封面裁剪失败 | Failed to load/crop cover image |
| coverCrop.ratio.* | 自由 / 16:9 / 1:1 / 4:3 | Free / 16:9 / 1:1 / 4:3 |

---

## 11. 百家号视频 API 发布链（Phase C，2026-08-28）

### 11.1 背景与决策

参考产品百家号发布是 **API 直调**（非浏览器 RPA）。本项目历史 RPA 发布路径在百家号反复失败（「用户须知」引导弹窗常驻、位置必填选择器异常、发布点击后 verification timeout），且 RPA 无法稳定覆盖全部弹窗状态。逆向参考产品主进程（D:\Data\mp-extracted\packages\main\dist\index.cjs）确认完整发布链后，决定**将百家号视频发布整体切换到 API 直调**，绕开浏览器自动化不确定性。位置参数在 API 契约中为**可选项**（无位置时传空对象 {} 即可），彻底解决 RPA 位置选择问题。

### 11.2 发布链（8 步，与参考产品逐行为对齐）

| 步骤 | 接口 | 关键参数 | 成功判据 | 失败处理 |
|---|---|---|---|---|
| 1. getBaseToken | GET /?source=inner | Cookie + host | 正则提取 BJH__INIT__AUTH__ 引号内 token | 空 → fail-fast「Cookie 无效或页面结构变更」 |
| 2. getAppId | GET /builder/app/appinfo | Cookie + referer | data.user.app_id | 空 → fail-fast「Cookie 无效或接口变更」 |
| 3. preuploadVideo | POST /builder/author/video/preuploadVideo?app_id=X | body: app_id/md5/is_pay_column=0/video_type=**short**；header: cookie/token（含 UA/Accept 等浏览器头） | upload_key | errno → 「preuploadVideo 失败: {errmsg/errno}」 |
| 4. uploadVideoPart（分片） | POST https://rsbjh.baidu.com/.../uploadVideo?app_id=X | FormData: app_id/md5/id=WU_FILE_0/type=video/mp4/lastModifiedDate/size/name/upload_key/file/chunks/chunk | 每片响应含 uploadId | 「uploadVideoPart 分片 i/N 失败」；「存储服务异常」时切换 rsbjh10/11/12.baidu.com/materialui/video/uploadvideo 重试（参考产品原样 `rsbjh1${ne%3}`） |
| 5. completeUpload | POST /builder/author/video/compuploadVideo?app_id=X | body: upload_key/chunks/name(enc)/size/is_pay_column=0/column_videotype=/type=video/video_type=**short** | bos_url（同时取 mediaId 供发布） | 「compuploadVideo 失败: {errmsg/errno}」 |
| 6. waitVideoProcess | POST /pcui/video/process（body mediaId=X） | cookie/token/referer | 轮询至 data.editVideo.coverImage 以 http 开头 | 180 次/1.5s（4.5 分钟）上限；未返回封面 → 降级为空封面（_cover_images_map=，**不阻断发布**）；连续 10 次异常提前止损；任务级 deadline 超时 → 「任务级超时」 |
| 7. buildVideoPostData | 纯函数 | 见 11.4 | — | — |
| 8. publishVideo | POST /pcui/article/publish（pubType=0 时 /save） | cookie/token/referer/Origin | errno===0 && ret.id | 「发布失败 {errmsg}」 |

> 分片契约：块大小 2097152 字节（2 MiB）；13.5MB 视频切 7 片；video_type=short 为横版（竖版需另一接口，见 11.7 限制）。
> 参考产品差异对照：getUploadArgsResponse$6 / uploadVideoPart$7 / uploadCompleteResponse / getVideoCover / buildPostData$r / publish$9 参数逐一对齐。

### 11.3 真实发布流程接入（PublisherRouter api 模式）

- publisher-router.js ROUTE_TABLE 新增模式：baijiahao: { mode: 'api', timeout: 300000 }。
- 新增 ApiPublisher 类：凭证加载（复用 loadAuthForTask，accountId → credentialStore 加密凭证 → cookies 过滤平台域）→ cookie 字符串拼接（name=value; ...）→ ffprobe 探测视频宽高/时长（横版校验 width>=height）→ publishViaApi（api-publish-engine 标准入口，锚定 adapter.execute）→ 结果规范化 {success, postId, url, mode:'api'}。
- 取消语义：signal 透传到分片上传循环与 video/process 轮询循环，中断即返回「任务已取消」；任务级超时 300s（ROUTE_TABLE.timeout）作为 deadline 在轮询/发布前强制收口（adapter.execute 读取 opts.timeout，非仅文档承诺）。
- Cookie 域：baijiahao 白名单含 baidu.com 父域（BDUSS/BAIDUID 由 passport 设置在 .baidu.com），仅精确匹配父域、拒绝 *.baidu.com 子域冒充（.evil.baidu.com 不通过）。
- 凭证缺失 → 「平台 Cookie 缺失（账号 X 未登录或凭证不可用）」；无视频路径/探测失败/竖版均有明确错误文案。
- 无媒体工具时 probeVideoInfo 抛 FFPROBE_UNAVAILABLE，可注入（测试/后端特化）。
- 安全：发布 URL 经 sanitizePublishResultUrl 脱敏（token/cookie/sign 等 query 参数删除）。

### 11.4 buildVideoPostData 字段契约（逐字段）

video_duration、type=video、usingImgFilter=false&source_reprinted_allow=0&nryx_mount_list=&is_consultant_card=、image_edit_point=&ducut_info=&cover_source=upload&bjhmt=&aigc_rebuild=、title（encodeURIComponent）、content（JSON [{title,desc,mediaId,videoName,local:1}]）、desc、bjh_video_finger_printing（JSON {s2l:null,s2game:null,bjh:{duration}}）、tag（逗号拼接，最多 5 个——渲染层截断）、position_lat_lng（有 location.uid 传 10 字段对象 {addr,city,poi_type,type,city_id,lng,lat,name,pid,tag}，否则**空对象 %7B%7D**）、封面三件套（cover_layout=one + cover_images[{src,cropData,machine_chooseimg:0,isLegal:1}] + _cover_images_map[{src,origin_src}]；无封面时仅 _cover_images_map=）、vertical_cover、original_status（original?2:0）、announce_id=0 + announce_info（首发 {first_publish:1}；转载 +tp_author/tp_url）、draft_id、常驻 isBeautify=false、activity_list[0][id]=aigc_bjh_status&activity_list[0][is_checked]=0、fe_from=BJH_CMS_PC、bjhtopic_info=&bjhtopic_id=。

### 11.5 数据校验

- 任务输入：title/content 非空（desc 剥 HTML 后长度 ≤2 回退 title）；video.path 必须存在（fs.existsSync）；宽高必须由 ffprobe 提供（1920x1080 横版通过）。
- Cookie：accountId 必须可解析出 ≥1 个平台域 cookie，否则发布前失败。
- 上传：md5 全文件（hex）；分片数与文件大小严格对应；complete 后 bos_url 缺失即失败。
- 发布结果：errno===0 且 ret.id/ret.article_id 任一存在才算成功，否则抛错进队列失败历史。

### 11.6 交互与提示

- 发布入口不变：发布页 → publish:batch → 任务队列 → ApiPublisher；进度事件 publish:progress 按阶段（准备/解析/上传/处理/发布）推送，UI 复用现有发布进度展示。
- 失败提示原文（抛错文案）见上文各步骤；队列重试 3 次（复用 taskQueue.retry 语义）。
- 错误消息均以「{步骤名} 失败: {服务端 errmsg/errno}」格式输出（脱敏后的字段摘要，不整体回显响应体，避免 upload_key/mediaId 等瞬时值进入队列失败历史与 UI）；敏感响应不落日志（脱敏在 sanitizePublishDiagnostics）。

### 11.7 已知限制（后续迭代）

- 横版视频专用（width>=height）；竖版需移植 publishBaijiahaoMiniVideo 链。
- 封面默认使用 video/process 自动生成的首帧封面（cover_source=upload）；用户自定义封面图的图片上传链（builder/author/picture/uploadproxy + CuttingPicproxy 裁剪）待移植——**当前 API 模式检测到自定义封面（taskData.cover）会显式拒绝发布并提示「API 发布暂不支持自定义封面」，不会静默忽略**；届时 cover_path 全链路生效（与 Phase A 封面裁剪 UI 对接）。
- 视频发布仅 API 模式；图文仍走 RPA（publish$a 图文链同为 API，可后续迁移）。
- 快手视频 API 链（kuaishou.web.cp.api_ph）已逆向待移植；真实发布 E2E 需要该平台账号凭证有效（当前 profile 凭证经 safeStorage/DPAPI 绑定原机器或已过期，需重新扫码登录）。

### 11.8 测试覆盖

- packages/api-publish-engine/test/baijiahao-api-chain.test.js：18 用例（token 正则 / getAppId / preupload（video_type=short+浏览器头断言） / uploadVideoPart 分片端点+uploadId 判据 / 存储服务异常 rsbjh10/11/12 重试 / completeUpload（video_type=short+bos_url） / waitVideoProcess 轮询+deadline/signal 中断 / buildVideoPostData 位置空对象+原创声明+duration 取整 / publish 端点+draft→/save+基类 cancelToken 形态拒绝 / execute 真实上传链（临时文件 3MiB→2 片、不 stub uploadVideo） / 错误脱敏 / 封面显式拒绝 / 视频缺失可读错误 / 取消中断）。
- apps/desktop/electron/services/publisher-router.test.js：新增 10 用例（ROUTE_TABLE api 模式 / createPublisher ApiPublisher / 成功路径含 publishViaApi 参数断言（draft:false、timeout 300s） / draft 任务透传 / 父域 .baidu.com cookie（BDUSS）通过域过滤 / 竖版拒绝 / 缺失 cookie 抛错 / adapter 失败抛错 / 探测失败抛错）。
- 回归：api-publish-engine 全量 42 vitest + 独立套件通过；desktop router 42/42、受影响引用方（video-clone/webview-manager）27/27；shared-utils 全量 242 通过。


## 12. 真实发布 E2E 与账号风控（Phase C 收尾，2026-08-28 晚）

### 12.1 E2E 账号选择与凭证映射契约

真实发布 E2E（apps/desktop/tests/e2e/real-video-publish.js）的账号选择遵循以下契约，任何一环失败都明确 FAIL（不再静默通过）：

- 发布页账号列表为空：明确 FAIL（此前 isChecked().catch(() => true) 在元素缺失时假 PASS，「勾选账号」显示通过实际未勾选）。
- 页面已勾选账号与本地凭证（accounts 表 / identity-session）必须匹配：无凭证直接 FAIL，并在报告中列出页面账号与本地凭证清单。
- 勾选后硬断言 isChecked() === true；任一平台无账号即中止整轮发布。
- 禁止硬编码账号 fallback（历史 ids[0] || "d39af89b" 曾把无凭证账号兜底选中，误导为 Cookie 缺失错误）。

### 12.2 Cookie 时效判据（过期 vs 代码问题）

- GET /builder/app/appinfo 返回 {"errno":10001401,"errmsg":"账号已退出，请重新登录"}：账号 Cookie 过期（实测 08-17 添加的账号 10+ 天后过期），必须重新登录，客户端无法「续期」。
- 判定过期前先确认请求头完整（BDUSS/STOKEN/PTOKEN/bjhStoken/devStoken 全量 + 现代指纹头），排除请求构造导致的接口异常。
- 只读接口（appinfo）返回正常的账号，发布接口仍可能失败（风控），不能以只读成功推断发布放行。
- 调试开关：BJ_DEBUG_TRACE=1 + BJ_DEBUG_LOG=<path> 在请求/响应层抓包（默认关闭；Cookie 脱敏为 key+长度）。

### 12.3 百家号风控弹码（errno 10000015）

真实发布最后一次调用 pcui/article/publish 返回：

```json
{"errno":10000015,"errmsg":"您所在网络环境异常，请完成验证",
 "data":{"hit_rule":"30天内注册的百家号作者弹码",
   "pass_auth":[{"auth_scene":"bjh_risk_phone","auth_id":"..."},
                {"auth_scene":"bjh_risk_auth"},
                {"auth_scene":"bjh_risk_face_user"}]}}
```

- 触发条件：账号级确定性规则（hit_rule「30 天内注册的百家号作者弹码」+ is_first_publish=true），与请求头/UA/指纹/IP 无关（三次重试 auth_id 一致）。
- 验证场景：bjh_risk_phone（手机验证码）、bjh_risk_auth（身份验证）、bjh_risk_face_user（人脸验证）；验证须由账号持有者在真实浏览器完成，客户端不伪造通过状态。
- 客户端提示（BaijiahaoAdapter 已实现）：「百家号发布被风控拦截（30天内注册的百家号作者弹码）。请先在浏览器中登录百家号完成验证（bjh_risk_phone/bjh_risk_auth/bjh_risk_face_user），验证通过后重新发布」，不回显误导性「网络环境异常」。
- 参考产品对照：index.cjs 对 10000015/bjh_risk/pass_auth 全量检索零命中——参考产品没有弹码绕过逻辑；它「不触发」的前提是账号已完成过验证或注册超 30 天。
- 保存草稿（/pcui/article/save）不触发该弹码（errno 0），不能用草稿成功推断发布放行。

### 12.4 封面契约（视频模式）

- UI 侧：「从视频提取封面」调 IPC cover:extract（主进程 CoverExtractor 输出 D:/tmp/multi-publish-covers/cover-<ts>.jpg），写入 article.cover_path 与 coverFileList；重复提取命中缓存（Cover already exists）。
- API 侧：BaijiahaoAdapter.execute 对 taskData.cover 显式拒绝（「API 发布暂不支持自定义封面（仅视频首帧封面）」）；封面由平台 video/process 自动处理（editVideo.coverImage，实测 bjhmedia2.bdstatic.com 首帧），与参考产品一致。
- E2E 校验：提取封面后 cover_path 非空作为功能验收；发布 payload 不携带 cover_path（避免被拒）。

### 12.5 发布终态判定证据链

- 页面进度文案只作辅助截图；权威依据 = app profile 日志 Executor 行（Publish failed/success）。
- 证据链三源对照：E2E report.json checks + app 日志 + BJ_DEBUG 抓包。
- 终态正则排除中间态（「上传完成」「处理完成」等），只在发布成功/失败文案出现时判定终态。

### 12.6 账号矩阵与外部前置（截至 2026-08-28）

| 账号 | 平台 | 状态 | 证据 |
| --- | --- | --- | --- |
| d39af89b | 百家号 | Cookie 过期（08-17 添加，10+ 天） | appinfo errno 10001401 |
| da8b24f8 | 百家号 | 有效但命中风控（30 天新号弹码） | publish errno 10000015 + hit_rule |
| 9d5ef9b7 | 快手 | Cookie 过期 | 状态 expired，需应用内重新登录 |

真实发布成功与否以平台响应为准（百家号 errno 0 + ret.id）；弹码验证、快手重新登录、跨设备同步均属外部验收。

### 12.7 浏览器登录交互契约（2026-08-28 回归修复）

- 账号页 login-state 横幅仅在扫码（qrcode）模式渲染（v-if 条件为 authViewVisible 且 loginMode 等于 qrcode），含二维码预览与浮动关闭按钮。
- 浏览器（browser）登录 = 全屏登录标签（App.vue isLoginTab）+ 导航栏「保存账号」按钮（调用 completeLogin(browser)）；账号页不再渲染 browser 登录横幅与「我已完成登录」按钮。
- 「已登录状态不显示完成按钮」是设计契约而非缺陷；曾有改动把横幅条件扩大到任意 loginMode 导致既有测试回归（Accounts.test.js「网页登录改为全屏标签呈现」），已恢复并纳入 CI。

## 13. 浏览器标签页首页契约（2026-09-10 修复，PR #1649）

### 13.1 首页标签固定身份

- **首页标签 ID 固定为 `'home'`**（主进程常量 `HOME_TAB_ID`），构造时即赋值，任何方法不得修改。
- 首页标签是**固定虚拟标签**：不占用真实 `WebContentsView`，无 `_tabStates` 记录，`getActiveTab`/`getHomeTab` 在首页活动态返回静态信息（`url:''`、`title:'首页'`、`isHome:true`）。
- 首页标签**不可关闭**：`closeTab('home')` 返回 false。
- 创建浏览器标签（`createNewTabPage`）**不得**改变 `_homeTabId`——首个浏览器标签（`btab-*`）与首页标签是不同身份，禁止共享。

### 13.2 数据校验 / 契约

- `getAllTabs()` 固定返回首页标签且排第一位（`isHome:true`），随后是浏览器标签。
- `closeAll()` 关闭所有浏览器标签后回退到首页标签（`_activeTabId = 'home'`）。
- 从浏览器标签 `switchToTab('home')` 必须隐藏所有 `WebContentsView`（`setVisible(false)`）并广播 `tab-switched`。

### 13.3 交互逻辑

- 侧边栏/模块导航（`router-link`）是 Vue SPA 内部导航，**不会**切换标签。当用户在浏览器标签下点击侧边栏进入采集/发布等 SPA 页面时，`App.vue` 的 `router.beforeEach` 守卫自动切回首页标签以隐藏 `WebContentsView`，露出 router-view 渲染内容。
- 修复前缺陷：`_homeTabId` 被首个浏览器标签覆盖 → `switchToTab('home')` 找不到对应 view → `WebContentsView` 永不隐藏，盖在 router-view 上拦截所有鼠标事件，表现为「采集页 URL 正文提取输入框无法点击、页面按钮无响应」。

### 13.4 回归保护

- `webview-manager.test.js` 固定首页标签测试覆盖：构造后 `_homeTabId` 不变、`getAllTabs` 含首页排首位、`closeTab('home')` 返回 false、`closeAll` 回退首页、切首页时 `setVisible(false)`、`getActiveTab`/`getHomeTab` 虚拟首页返回。
- `window.open` 拦截测试覆盖：创作者中心 `target=_blank` 在当前 tab 内导航，拒绝非 http/https 协议。

