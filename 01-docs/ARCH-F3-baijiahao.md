# 百家号 RPA 发布器 — 技术方案

> **架构师**: PROJECT-003 | **日期**: 2026-06-13
> **依赖**: PM-PRD-v1.1.md F3.1

---

## 一、平台调研

| 项目 | 信息 |
|------|------|
| **平台** | 百家号 (baijiahao.baidu.com) |
| **登录方式** | 百度账号（扫码/密码）+ Cookie 持久化 |
| **发布模式** | 纯 RPA（无公开 API） |
| **发布类型** | 图文、视频 |
| **编辑器** | 富文本编辑器（支持排版/图片/视频） |
| **封面要求** | 16:9 推荐，≥ 1200×675 |
| **标签** | 支持，最多 5 个 |
| **发布流程** | 编辑 → 设置封面 → 添加标签 → 提交审核 |

---

## 二、方案

### 方案 A：Playwright RPA（同现有 10 个平台）

继承 `BaseRPAPublisher`，实现 `checkLogin()` / `waitForLogin()` / `publish()`。

| 维度 | 评分 |
|------|:----:|
| **实现成本** | ⭐⭐⭐⭐（复用已有基类） |
| **稳定性** | ⭐⭐⭐（RPA 固有风险） |
| **推荐** | ✅ **采纳** |

**与 F1/F2 集成**：
- 发布前调 `formatAdapter.formatForPlatform(html, 'baijiahao')` 格式化内容
- 封面图调 `coverProcessor.processCover(input, 'baijiahao', dir)` 处理

---

## 三、详细设计

### 3.1 文件

```
packages/rpa-engine/src/publishers/
  baijiahao-rpa.js      ← 百家号发布器
```

### 3.2 发布流程

```
publishArticle(article)
  │
  ├─ 1. init() → 打开 Playwright 页面
  ├─ 2. checkLogin() → 检查 Cookie 是否有效
  │     └─ 失败 → waitForLogin() → 扫码登录
  ├─ 3. navigate to writer.baijiahao.baidu.com
  ├─ 4. 点击「写文章」
  ├─ 5. 填写标题
  ├─ 6. 填写正文 (粘贴 HTML / 纯文本)
  ├─ 7. 设置封面图 (上传或 URL)
  ├─ 8. 添加标签
  ├─ 9. 点击「发布」
  └─ 10. 等待发布结果 → 返回 { success, postId, url }
```

### 3.3 验收标准

- [ ] 语法正确，注册到 registry
- [ ] checkLogin() 能检测已登录/未登录状态
- [ ] 发布流程覆盖：标题/正文/封面/标签
- [ ] 发布结果返回正确结构
- [ ] cleanup() 正确关闭

---

> **注意**：百家号编辑器页面可能有嵌套 iframe，需要额外处理。
---

## 四、方案更新：参考产品 API 直调链（2026-08-28，Phase C）

> 原方案 A（Playwright RPA）在真实发布中反复失败（「用户须知」引导弹窗、位置必填选择器、publish verification timeout）。逆向参考产品 4.0 主进程确认百家号为 **API 直调**（非浏览器 RPA），本文档自 Phase C 起**视频发布切换到 API 模式**，作为发布路由首选。

### 4.1 端到端调用链（8 步）

```
getBaseToken(GET /?source=inner → BJH__INIT__AUTH__)
  → getAppId(GET /builder/app/appinfo → user.app_id)
  → preuploadVideo(POST /builder/author/video/preuploadVideo?app_id → upload_key)
  → uploadVideoPart(POST rsbjh.baidu.com/.../uploadVideo，2MiB/片 multipart → uploadId)
  → completeUpload(POST /builder/author/video/compuploadVideo → bos_url + mediaId)
  → waitVideoProcess(POST /pcui/video/process 轮询 → editVideo.coverImage)
  → buildVideoPostData（字段契约见 PRD 11.4）
  → publishVideo(POST /pcui/article/publish → errno===0 && ret.id)
```

### 4.2 模块归属

- **适配层**：`packages/api-publish-engine/src/adapters/baijiahao.js`（BaijiahaoAdapter，execute 全链）
- **路由层**：`apps/desktop/electron/services/publisher-router.js`（ROUTE_TABLE baijiahao: mode='api'；ApiPublisher 凭证加载/ffprobe 横版校验/结果规范化）
- **入口**：publish:batch → taskQueue → ApiPublisher → api-publish-engine.publishViaApi

### 4.3 关键契约

- video_type=**short**（横版）；分片 2097152B；每片响应必须含 uploadId；complete 成功判据 bos_url。
- 位置 position_lat_lng 可选：无位置传空对象 `{}`（URL 编码 %7B%7D）。
- 封面：无用户封面时由 video/process 返回首帧自动封面（cover_source=upload）。
- 原创声明：original_status=2 + announce_id=0 + announce_info（first_publish/tp_author/tp_url）。
- 凭证：credentialStore 加密凭证 + 平台域过滤；缺失/过期 → 明确错误信息（需重新扫码登录）。
- 横版限定（width>=height）；竖版与封面上传图片链为后续迭代（当前 API 模式检测到用户自定义封面会显式拒绝发布并提示，不静默忽略）。

### 4.4 验收

- [x] baijiahao-api-chain.test.js 10 用例（RED→GREEN）
- [x] publisher-router.test.js ApiPublisher 6 用例 + 受影响引用方 76/76
- [x] 真实 E2E 驱动（real-video-publish.js）已能走通至平台校验（凭证有效即可发布）
- [ ] 真实发布成功回查（需有效账号凭证；当前 profile 凭证需重新扫码登录）
