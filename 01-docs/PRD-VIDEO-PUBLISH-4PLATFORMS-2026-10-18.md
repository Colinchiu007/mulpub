# PRD — 四平台视频真实发布（抖音 / 视频号 / 今日头条 / 小红书草稿箱）

- 版本：v1（2026-10-18，分支 `video-publish-4`）
- 状态：**进行中**（本轮落地「视频号入口 + CDN 主机修正」「真机 DOM 取证通道」「前置门禁执行体」；抖音/头条/小红书见 §9 未闭合）
- 关联：`01-docs/BUGFIX-PUBLISH-FAILURES-6PLATFORMS-2026-10-18.md`（上一轮 6 平台归因）、`01-docs/PRD-PUBLISH-FAILURE-ATTRIBUTION-2026-10-18.md`（前置门禁判据）、`openspec/records/video-publish-4.md`

---

## 1. 目标

让**视频内容**在这四个平台真实发布成功：

| 平台 | 目标态 | 允许的落点 |
| --- | --- | --- |
| 抖音 | 视频发布成功 | 公开发布（或平台允许的草稿/定时，按平台能力） |
| 视频号 | 视频发布成功 | 公开发表 |
| 今日头条 | 视频发布成功 | 公开发布 |
| 小红书 | **发布到平台草稿箱即可**（用户硬约束：不得真实发布） | 仅草稿箱 |

non-goal：不做批量/定时/多账号并发；不改 v5 发布间隔策略；不实现小红书公开视频发布。

---

## 2. 现状取证（2026-10-18 真机日志 + 静态包取证）

### 2.1 各平台失败面（今日 `app-2026-10-18.log`，每平台各 3 次失败）

| 平台 | 路由 | API 轨结果 | RPA 轨结果 |
| --- | --- | --- | --- |
| 抖音 | `rpa_vm`（API 先试后回落） | `API publish douyin: 账号信息缺失，请重新授权此账号再试` | `publish timeout` |
| 视频号 | `rpa_vm`（API 先试后回落） | `API publish tencent_video: Request failed with status code 404` | `publish verification timeout`（URL 停在 `channels.weixin.qq.com/platform`） |
| 今日头条 | `rpa_vm` | 无视频 API 轨 | `publish btn not found` |
| 小红书 | `rpa_vm` | 路由**从不进入** API（`ROUTE_TABLE` 硬编码 `rpa_vm`） | 主动拒绝：`视频草稿链尚未实现` |

### 2.2 视频号真因（本轮已定位并修复）

RPA 轨逐行证据（`2026-10-18T06:12:45Z` 起）：

```
waitForElement timeout sel=input[type="file"]           ← 上传入口不存在
[tencent_video] no-title platform … skip title_input
waitForElement timeout sel=button:has-text("发表")        ← 发表按钮不存在
[tencent_video] confirm dialog probe: MODAL_NO_MATCH: … PAGE_BTNS=关于腾讯/微信视频号运营规范/问题咨询
publish verify snapshot: {"text":"视频号 · 助手 9 退出登录 … 视频57 关注者50 …"}
publish verification timeout endpoint=https://channels.weixin.qq.com/platform
```

`PAGE_BTNS` 是**平台首页页脚**的链接 ⇒ RPA **根本没进创作页**。根因：`config/platforms.yaml` 的
`tencent_video.publish_url` 写的是平台根地址 `https://channels.weixin.qq.com/`。

API 轨的 404 也定位到了：链里 CDN 主机 `finderassistancea.video.qq.com` 三条路径
（`applyuploaddfs` / `uploadpartdfs` / `completepartuploaddfs`）**全部 404**；
而创作页自身代码（`finder-helper-web` 的 `chunk-common`）里写的是
`this.HOST = "finder.video.qq.com"` 与 `ReplaceHost = "https://finder.video.qq.com"`，
该主机可达（返回 protobuf 业务码而非 404）。

### 2.3 抖音真因（已定位，未修）

API 轨 Step 0 直接 fail-closed：`hasSecurityMaterials()` 为假 —— 账号 cookie 里缺少
`__security_mc_<N>_s_sdk_sign_data_key_web_protect` 这类签名材料（与上一轮快手
`missing kuaishou.web.cp.api_ph` 同族：**cookie 采集不全**）。缺它就无法生成
`bd-ticket-guard-*` 头，`create_v2` 必被风控拒绝。

### 2.4 头条真因（已定位，未修）

`videoPublishUrls.toutiao` 指向西瓜视频上传页，但 `PLATFORM_PUBLISH_SELECTORS.toutiao`
是**图文文章页**那套且**没有 `file_input`** ⇒ 真机 `file input hasVideo=true selectorCount=0`
⇒ 上传整段被跳过。研究语料给出该平台走 **API 轨**：
`https://mp.toutiao.com/xigua/api/upload/getAuthKey/` → 上传 → `.../xigua/api/upload/PublishVideo`。

### 2.5 小红书真因（已定位，未修）

API 草稿三步链（`permit → COS PUT → web_api/sns/v2/note`）**已实现但从未执行**：
`ROUTE_TABLE` 把平台硬编码成 `rpa_vm`。且该链目前只有**图片**模态。

---

## 3. 本轮改动（功能逻辑）

### 3.1 视频号入口（配置层，1 行 + 取证注释）

- `config/platforms.yaml`：`tencent_video.publish_url` 由 `https://channels.weixin.qq.com/`
  改为 `https://channels.weixin.qq.com/platform/post/create`（与
  `videoPublishUrls.tencent_video`、竞品逆向的 `post_create` / `helper_upload_params` 同源）。
- 影响：RPA 首次导航即进创作页，`input[type=file]` / 描述框 / 发表按钮才有意义。

### 3.2 视频号 CDN 主机（API 轨）

- `packages/api-publish-engine/src/publish/platforms/shipinhao-video.js`：
  `CDN_HOST_CANDIDATES = ['https://finder.video.qq.com', 'https://finderassistancea.video.qq.com']`，
  `DEFAULT_CDN_BASE` 取第一个；旧主机保留为最后兜底（部分网络只能连旧边缘）。

### 3.3 真机 DOM 取证通道（新模块）

`apps/desktop/electron/services/rpa-dom-dump.js`：

- **默认关闭**，仅 `MP_DOM_DUMP=1` 开启；关闭时**一次都不读页面**（零开销，有测试锁）。
- 在三个节点采集页面**结构摘要**：导航后（`nav`）、上传后（`uploaded`）、点发布前（`prepublish`）。
- 采集项：`input[type=file]`（accept/visible/class）、文本 input、textarea、contenteditable、
  按钮（文本/禁用/可见）、上传区候选；**只采结构不采内容**（只记 `valueLength`/`textLength`）。
- URL 只保留 `origin + pathname`（丢掉 query，避免 token 落盘）。
- 落盘：`<%TEMP%>/mp-dom-dump/<platform>-<stage>-<ts>.json`。
- 任何异常返回 `null`，**绝不打断发布主链**。

### 3.4 前置门禁执行体

`publish-precondition.assertReady({...})`：先取证（`prepublish` 阶段 dump）再判定，
命中即返回可直接 `return` 的失败结果（带 `definitelyNotSent`）。`_publish_generic` 里的
内联块收敛为一次调用（同时给行数熔断让出空间）。

---

## 4. 流程（发布态机，四平台统一）

```
派发 → 路由选择
  ├─ API 轨（若平台 has_api）
  │    抖音: sdkToken → auth/v5 → VOD 上传 → create_v2(bd-ticket-guard)
  │    视频号: helper_upload_params → CDN 分片 → post_create|post_draft
  │    小红书: permit → COS PUT → note(draft=true)
  │    头条: getAuthKey → 上传 → PublishVideo            ← 待实现
  └─ 失败 → 回落 RPA（api-then-dom）
       导航 → 登录态早退 → DOM 取证(nav) → 上传 → 取证(uploaded)
       → 标题/正文 → 取证(prepublish) → 前置门禁 → 点发布 → 验证
```

**门禁四判据（P1–P4）不变**：平台有视频入口 / 上传被确认 / 标题写入 / 正文写入；
不成立 ⇒ 不发车、`preSubmitBlocked + definitelyNotSent`、回滚发布间隔窗口。

---

## 5. 数据校验

| 编号 | 校验项 | 判据 | 失败表现 |
| --- | --- | --- | --- |
| V1 | 入口 URL 是否创作页 | `publish_url` 必须含平台创作路径（视频号 `/platform/post/create`、头条 `/xigua/upload-video`、抖音 `/creator-micro/content/upload`、小红书 `/publish/publish`） | 落首页 ⇒ 全链落空 |
| V2 | CDN 主机存活 | 上传主机不得返回 404 | API 轨首步 404 ⇒ 回落 RPA |
| V3 | 签名材料齐备（抖音） | `hasSecurityMaterials()` 为真 | Step 0 fail-closed：`账号信息缺失，请重新授权` |
| V4 | 上传被平台确认 | `fillReport.upload.ok === true` | 不点发布（P2） |
| V5 | 标题/正文写入 | `readback > 0` | 不点发布（P3/P4） |
| V6 | 发布被验证 | URL/响应/DOM/产物列表任一正信号 | `publish verification timeout`（文案已改「未确认发出」） |
| V7 | 小红书仅草稿 | `draft=true`，不得出现公开发布请求 | 违反用户硬约束 |

---

## 6. 交互逻辑与显示项

- 进度浮层阶段不变（prepare → upload → fill → publishing → verifying），门禁拦截时直接落「失败」，不播放不存在阶段。
- **新增诊断可见项**（`MP_DOM_DUMP=1` 时）：日志新增一行
  `[<platform>] dom-dump <stage> files=N inputs=N editables=N buttons=N -> <path>`。
- 失败条目文案沿用四段结构（平台 / 环节 / 是否已发出 / 下一步）。

---

## 7. 提示文字（本轮新增/变更）

| 场景 | 文案 |
| --- | --- |
| 视频号 API 轨 404（修复前） | `Request failed with status code 404`（技术串，用户不可读）→ 修复后应不再出现；若仍出现，日志会带 CDN 主机候选与阶段 |
| 抖音缺签名材料 | `账号信息缺失，请重新授权此账号再试`（**保留**：这是用户可执行的唯一动作；需在文档中说明「重新授权会补齐 SDK cookie」） |
| 平台未实现视频入口（头条现状） | `<平台> 视频发布尚未支持：…本次未向平台提交任何内容，也未占用发布间隔。请改用图文发布，或改用其他平台。` |
| 上传未确认 | `<平台> 视频上传未完成（未检测到上传完成信号…），已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。请重试；若反复失败请确认视频文件可正常播放、体积未超平台上限。` |

---

## 8. 诊断手册（下次真机排障用）

```text
① 先看路由：route-selected mode=?          ← rpa_vm 但日志有 using API publish engine 说明先试了 API
② 看 API 轨首错：API publish <p>. <msg>     ← 404=主机/路径过期；账号信息缺失=cookie 材料缺
③ 看 RPA 是否进对页：dom-dump nav .urlPath  ← 是否为目标创作页（不是首页/登录页）
④ 看页面有没有控件：dom-dump nav .files/.editables/.buttons
⑤ 看上传是否被确认：dom-dump uploaded + fillReport.upload
⑥ 最后才看 publish timeout / verification timeout（它们是症状）
```

---

## 9. 未闭合（本轮不假装完成）

1. **抖音**：缺 SDK 签名 cookie ⇒ 需重新授权或在采集时等待安全 SDK 写入后再保存 cookie。
   修复点已定位在「cookie 采集时机」，不在发布链本身。
2. **今日头条**：视频 API 轨未实现（`getAuthKey → 上传 → PublishVideo`）；DOM 轨缺视频页选择器。
   计划：先补 API 轨（研究语料已给出三个端点），以 API 优先、DOM 兜底。
3. **小红书**：视频草稿需 API 链的**视频模态**（permit scene=video + 视频 note schema + `x-s` 签名），
   且 `ROUTE_TABLE` 需放开 API 轨。
4. **真机 E2E 阻断**：应用正在运行（另一 worktree `mp-app-live2` 的实例，`--user-data-dir` 指向同一
   `shared-user-data`），其 Chromium cookie 库被独占锁（`EBUSY`），导致外部脚本无法复制 cookie 做取证。
   **下一步**：由该实例的所有者在空闲时退出应用，或改由应用内 `MP_DOM_DUMP=1` 采集（本轮已具备该通道）。
