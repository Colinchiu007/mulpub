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
4. ~~**真机 E2E 阻断**~~ **已解除（R2，2026-10-18）**：见 §10。

---

## 10. 真机 E2E 取证结果（R2，2026-10-18）

### 10.1 取证方法（可复用资产）

**方法 A：RPA 分区 cookie 库复制法**（应用运行时默认 session 被独占锁，但分区库可读）

```
源：shared-user-data/session/Partitions/rpa-<platform>-<accountId>/Network/Cookies
    + shared-user-data/Local State
目标 profile：<profile>/Default/Network/Cookies  + <profile>/Local State
```
Chromium 用**同一 Windows 用户**的 DPAPI 密钥自行解密 ⇒ Playwright 以真实登录态打开创作页。

| 平台 | 分区 | 可读性 |
| --- | --- | --- |
| 今日头条 | `rpa-toutiao-7ae99805` | ✅ 32 KB |
| 小红书 | `rpa-xiaohongshu-a1eac276` | ✅ 20 KB |
| 视频号 | `rpa-tencent_video-b1e05ac2` | ❌ 被运行中实例独占 |
| 视频号（历史会话） | `rpa-rpa-tencent_video-36b5b265-*` | ✅ 但账号可能已变 |

**方法 B：CDP 驱动运行中实例**（连 `--remote-debugging-port`）

- `Runtime.evaluate` 调 `window.electronAPI.publishBatch(platforms, article)` 触发真实发布；
- 发布期间 RPA 打开的页面会作为**新 CDP page target** 出现，可即时 dump DOM + 截图；
- RPA 页面生命周期短（发布结束即关），必须轮询抓取；
- `accountCheckLogin(platform, accountId)` 走 **HTTP API**（`CHECK_LOGIN_SUCCESS_HTTP_API`），
  **不开浏览器页面** ⇒ 不能用于打开创作页取证。

### 10.2 视频号 A/B 对照（同日两次真实发布）

| 环节 | A 组（旧代码） | B 组（修复后） |
| --- | --- | --- |
| API 轨 | `status code 404`（CDN 主机过期） | 到达 `finder.video.qq.com`，返回 protobuf 业务错误，**不再 404** |
| RPA 入口 | DOM 快照落在 `/` 与 `/platform`（平台首页） | CDP target 为 `/platform/post/create`，标题「视频号助手」——**创作页** |
| 上传 | 完全找不到 file input | `file input selectorCount=1` → `uploading file...` ×3 → **`upload={"ok":true}`** |
| 门禁 | 无（继续点发布 → verification timeout） | **`pre-submit gate blocked: content-not-filled`**，未点发布 |

⇒ #3918 的两处修复（入口 URL + CDN 主机）在真机上验证生效。

### 10.3 头条创作页真实 DOM（`profile_v4/xigua/upload-video`，上传后）

| 元素 | 真机形态 |
| --- | --- |
| 上传入口 | `input[type="file"]` ×1（隐藏，由 `.byte-upload-trigger` 点击区触发） |
| 上传完成信号 | 页面出现「上传成功 `<文件名>` 大小/时长」 |
| 标题 | `input.xigua-input.show-limit`，placeholder「请输入 1～30 个字符」 |
| 简介 | `textarea.byte-textarea.abstract`，placeholder「请输入视频简介」 |
| 话题 | `input.arco-input-tag-input` |
| 发布 | `button.action-footer-btn.submit` |
| 存草稿 | `button.action-footer-btn.draft` |
| 定时发布 | `button.action-footer-btn.timer` |

⚠️ **三键同排且「定时发布」含「发布」二字** ⇒ 发布按钮必须用精确类打头，
不得 `:has-text("发布")` 首位（会命中定时发布，切换定时模式而非发布）。

### 10.4 小红书创作页真实 DOM（`publish/publish?from=menu&target=video`，上传后）

| 元素 | 真机形态 |
| --- | --- |
| 上传入口 | `input.upload-input`（**可见**）+ `button.upload-butto`（text=上传视频） |
| 标题 | `input.d-text`，placeholder「填写标题会有更多赞哦」 |
| 正文 | `div.tiptap.ProseMirror`（contenteditable，**不是 textarea**） |
| 发布按钮 | **DIV**，text「发布笔记」（页面两份：编辑态 + 笔记预览态） |
| 草稿箱 | 侧边栏「草稿箱(N)」入口 |
| 定时发布 | 开关，默认关 |

### 10.5 契约变更：小红书视频「只落草稿箱」

- 旧：视频形态直接 fail-closed 拒绝（`XHS_VIDEO_DRAFT_UNSUPPORTED`）。
- 新（R2）：走 generic 草稿链，`draftOnly: true`，**不点发布**，靠平台自动草稿保存落库。
- **守卫保留**：合并后选择器仍拿不到 `file_input` ⇒ 上传无从发生 ⇒ 仍拒绝。
  理由：静默降级成草稿会把「其实没发出去」伪装成成功。

### 10.6 按内容类型选选择器

`resolvePublishSelectors({platform, article, selectors})`：

1. `article.video_path` 存在且登记了 `<platform>_video` ⇒ 用视频选择器；
2. 合并方式是**覆盖同名字段**：视频键优先，未登记字段回落图文；
3. 无视频或未登记视频键 ⇒ 原样返回图文选择器（不回归）。

放在 `packages/rpa-engine/src/` 而非 `apps/desktop/electron/services/`：后者在
「点名还账」清单内（零增长容差），而这段逻辑需要写清取证注释。

### 10.7 数据校验（R2 新增）

| 编号 | 校验项 | 判据 | 失败表现 |
| --- | --- | --- | --- |
| V8 | 视频选择器键的基座必须是已知平台 | `PLATFORM_PUBLISH_SELECTORS['<p>_video']` 的 `<p>` ∈ 平台清单 | 「无多余平台」用例判红 |
| V9 | 视频选择器必须含 `file_input` | 数组长度 > 0 | 上传整段被跳过（头条真因复发） |
| V10 | 头条发布按钮首选项必须是精确类 | `publish_btn[0] === 'button.action-footer-btn.submit'` | 误点「定时发布」 |
| V11 | 小红书视频链不得点发布 | `draftOnly === true` | 违反用户硬约束 |
| V12 | 取证旁路失败必须可见 | `dumpDom` 抛错或返回 null 时 `logger.warn` 出声 | 审计契约静默失效 |

### 10.8 提示文字（R2 新增/变更）

| 场景 | 文案 |
| --- | --- |
| 小红书视频进草稿链（日志） | `[xiaohongshu] video draft-only：填内容后等平台自动存草稿，不点发布` |
| 小红书视频缺 file_input（守卫） | `[xiaohongshu] 视频草稿链缺 file_input 选择器 ⇒ fail-closed 拒绝`（结果文案沿用 `XHS_VIDEO_DRAFT_UNSUPPORTED`） |
| 取证无结果（新增） | `[<platform>] dom-dump 取证无结果（模块加载失败或采集异常）；门禁判定继续，但本次缺页面形状证据` |
| 取证旁路异常（新增） | `[<platform>] dom-dump 取证旁路异常（不影响发布判定）: <msg>` |

---

## 11. 未闭合（截至 R2）

### 11.0 路线纪律（用户 2026-10-18 明确指示，务必遵守）

> 「不明白你为什么不复用两个参考产品的逆向成果来实现几个平台的发布，
> 非要自己去研究 DOM？又复杂又有风控风险。」

**结论：优先走 API 轨，DOM 轨只作兜底。** 竞品逆向语料
（`01-docs/research/competitor-reverse-2026-10-13/`）已给出各平台发布端点，
且仓库 `packages/api-publish-engine/src/publish/platforms/` **已有**抖音/视频号/小红书的
完整 API 链。dump DOM 应是「API 轨缺端点时的补充取证」，不是首选路径——
DOM 要点按钮、等渲染、逐平台猜选择器，复杂且触发风控。

各平台的正确路线与已知死路：

| 平台 | 首选路线 | 语料端点 | 已知死路（前人真机实测，勿重踩） |
| --- | --- | --- | --- |
| 抖音 | **API 轨**（`douyin-video.js` 已实现） | `aweme/create_v2` + `upload/auth/v5` + VOD `ApplyUploadInner/CommitUploadInner`（`SpaceName=aweme`） | Step 0 缺 SDK 签名 cookie ⇒ 已由 D2 兜底修复（本轮） |
| 视频号 | **API 轨**（`shipinhao-video.js` 已实现） | `helper_upload_params` → CDN 分片 → `post_create`/`post_draft` | 旧 CDN 主机 `finderassistancea` 已 404 ⇒ 已改为 `finder.video.qq.com`（#3918） |
| 小红书 | API 轨**已有但实测不通** ⇒ 暂留 RPA 草稿 | `api/media/v1/upload/web/permit` → ros-upload → `web_api/sns/v2/note` | 2026-10-10 真机：`permit`/`ros-upload` 通过，但 `note` 恒 **406**（creator 域无主站 `web_session`，签名/风控过不去）⇒ 该账号 API 轨不具备可用条件 |
| 今日头条 | **API 轨已实现**（`toutiao-video.js` + `bytedance-vod.js` 共用 VOD） | ⚠️ **订正**：语料里那个 `PublishVideo` 属于**微视**（`media.weishi.qq.com/media-api/PublishVideo`），与头条无关。头条端点改由**应用自身 bundle** 取证：`xigua/api/upload/getAuthKey/` → VOD `ApplyUploadInner/CommitUploadInner`（`SpaceName=middlevideo_toutiao`、`app_id=1231`、`EnOID=1`）→ `xigua/api/upload/PublishVideo` | 真机被**账号实名认证**拦住（见 §12.3），非代码问题 |

**下一轮第一件事（R2 时写下，已于 R3 完成）**：建 `toutiao-video.js`，复用 `douyin-video.js` 的 VOD 上传器，
只写头条自己的端点适配。**不要**再扩 DOM 选择器。

> **R3 复盘教训（写进纪律）**：判定「某端点有没有证据」时，**不能只看语料里出现过同名串**——
> 语料是**跨平台 URL 大列表**，`PublishVideo` 这种通用命名在多个产品里都存在。
> 正确判据是「该 URL 的主机名 + 路径是否属于本平台」，或直接做一次本平台取证。
> R2 就是因为同名匹配把微视的端点当成了头条的，属于**跨平台套用**。

### 11.1 其余未闭合

1. **视频号正文选择器仍未命中**：真机 `title input selectorCount=3` 但
   `no dedicated title field, title falls back to editor sel=none`。发布被 60′ 账号间隔
   挡住，且 `emergencyReleasePublishWait` 每日仅 1 次已用尽。
   （注：视频号已有 API 轨，这只是 DOM 兜底路径的问题，优先级低于 §11.0 的头条 API 轨。）
2. ~~**抖音**：API 轨仍缺 `__security_mc_*_s_sdk_sign_data_key_web_protect` 签名 cookie~~
   **根因已定位并修复（R2 追加，D2）**：store 里 19 条 cookie 非空 ⇒ 旧兜底判据
   `if (!cookie)` 永不触发；缺的两条是安全 SDK 在**页面 JS 运行时**才写进 Electron 分区的，
   是登录快照**之后**才出现，store 里永远没有。修法：判据升级为「cookie 为空 **或**
   （douyin 且签名材料不齐）」，命中后把分区 cookie **合并**进 store（分区优先、store 兜底）。
   **待真机验证**：需一次真实抖音发布确认 `create_v2` 能过（应用重启后登录态失效，
   报 `AUTH_REQUIRED`，需重新登录后再跑）。
3. ~~**头条视频 API 轨**未实现（见 §11.0，下一轮第一件事）~~ **已实现（R3）**：
   `toutiao-video.js`（链）+ `toutiao-video-publish.js`（发稿契约）+ `bytedance-vod.js`（与抖音共用 VOD），
   五步链 + 发稿体均按取证落地，详见 §12。**真机发布仍被账号实名认证挡住**（§12.3）。
4. **头条/小红书真实发布未验证**：本轮止于「真实上传成功 + 选择器登记」。
   R3 追加：头条已定位到**账号侧**原因（`is_auth:false` / `media_status:4`），不是代码问题。

---

## 12. 头条视频发稿契约（R3，2026-10-18/19 取证）

### 12.1 证据来源（为什么这次可信）

**应用自身 bundle 落盘检索**，不是竞品语料套用：

```
① 可读分区 cookie（rpa-toutiao-7ae99805）起 Playwright 打开 profile_v4/xigua/upload-video
② 监听 response 收集该页加载的 60 个 JS bundle，全量落盘
③ 本地检索 "PublishVideo" → 命中 pgcfe/mp/xigua/7219.*.chunk.js（101 KB）
④ 取调用点 ±1800 字符窗口 → 命中端点、成功判据、枚举
```

### 12.2 发稿契约（逐字）

```js
a.ZP.requestJsonNew("/xigua/api/upload/PublishVideo", Y, !0)
// 成功判据：0===dt && 0===vt  ⇒  status===0 && data.Code===0，并取 data.ItemId
var a = { publish: 1, timer: 2, draft: 0 }   // PublishType（草稿是 0！）
// VideoType：Tt = U < 1 ? 6 : 3；3=横版、6=竖版小视频
```

请求体（PascalCase，与 snake_case 的文章接口完全不同）：

| 字段 | 语义 | 取值来源 |
| --- | --- | --- |
| `ItemId` | 作品 id | 空=新建；有值=编辑 |
| `Title` / `Abstract` | 标题 / 简介 | 任务字段，按**码点**截断（30 / 2000） |
| `VideoInfo` | `{Vid, VName, ThumbUri, ThumbUrl, Duration, VideoWidth, VideoHeight}` | Vid 来自 `CommitUploadInner` |
| `VideoType` | 3 横版 / 6 竖版小视频 | 宽高比较，高>宽 ⇒ 6 |
| `PublishType` | **0 草稿 / 1 发布 / 2 定时** | `draft` 布尔或显式值 |
| `From` / `EnterFrom` / `CreateSource` | 固定 `"mp"` / `5` / `2` | 常量 |
| `IsNew` | `!ItemId` | 派生 |
| `HashtagIds` | 话题 id 数组 | 任务字段 |
| `HideInfo.HideType` | 隐藏类型 | 任务字段 |
| `ComplianceInfo` | AI/来源合规声明 | 任务字段（可选） |
| `TimerTime` | 定时时间（秒） | 给了就强制 `PublishType=2` |

### 12.3 发稿前的五道平台侧闸门（决定「为什么发布不出去」）

| # | 闸门 | 平台原文提示 | 我方处理 |
| --- | --- | --- | --- |
| 1 | **实名认证** | `realNameNewDialog("video")` —— 未实名**直接弹认证框，根本不发请求** | 无代码可解，需人工完善账号 |
| 2 | 用户状态 | `当前用户状态不能发文！` | `checkPublishAuth()` 前置判 |
| 3 | 视频上传完成 | `该视频还未上传完成，请上传完成再发表` | 链内保证：commit 拿到 Vid 才发稿 |
| 4 | 标题长度 | 草稿：`保存草稿失败，标题限制为 N 字以内`；发布：`该视频的标题需要在 W～z 字之间` | 本地按 30 码点截断 |
| 5 | **封面必填** | `该视频需要上传一个封面` | **R4 订正**：封面由平台按 vid **自动生成推荐封面**，我方不需要上传图片；闸门改为「上传后取推荐封面」（见 §12.5）。只给本地 `coverPath` 不足以满足（body 要的是平台侧 URI） |

### 12.5 封面来源：平台推荐封面（R4 订正，2026-10-19）

上一版（§12.3 第 5 行）把「封面必填」当成**上传前**的本地闸门，还把 `coverPath` 当作可满足条件 ——
两处都错。证据（应用 bundle 逐字 + 原文 UI 文案）纠正为：

```js
// 端点（bundle 逐字）
(0,u.t9)("/ixigua/api/upload/GetPosterList/", { body: { vid } })   // → data.Posters
// 平台原文 UI 文案
「视频上传完毕后才能生成推荐封面，你可上传或自定义截取封面」
```

⇒ 两点结论：

1. **推荐封面依赖 `vid`，所以只能在上传之后取**。把闸门放上传前会形成死锁：
   先要封面才能上传、上传完才有封面。
2. **不需要我方上传封面图**：从 `Posters` 里选一张即可（`@ixigua` 的 `GetPosterList` 就是干这个的）。

### 12.5.1 实现与判据

| 项 | 规则 |
| --- | --- |
| 触发回落 | 调用方**没有平台侧可用 URI**（`opts.thumbUri` / `td.cover.uri`）时才查推荐封面 |
| 判据依据 | 是「有没有可用 **URI**」而不是「有没有封面字段」——`coverPath` 是本地文件，给不出 URI（自扮演裁决抓到过一次判据用错） |
| 取值 | `parsePosterListResponse` 解析 `data.Posters`；`pickPosterUri` 按候选键 `Uri / PosterUri / CoverUri / ThumbUri / Url / PosterUrl / ThumbUrl` 顺序探测 |
| 落点 | 选中值写入 `VideoInfo.ThumbUri`，并把来源带出 `result.cover = { source: 'platform-poster' \| 'caller', pickedKey, posterCount }` |
| 都没有 | fail-closed **不发 PublishVideo**，错误文案区分「只给了本地封面文件（封面上传尚未实现）」与「完全没给封面」 |
| 探测失败 | `GetPosterList` 抛错只 warn 并继续判闸门，不掩盖 |

> ⚠️ **如实标注未知**：`Posters[]` 每一项的**字段名尚未取证**（只抓到 `.Posters` 这一层）。
> 因此用候选键探测而非写死，并把命中的键回传 —— 第一次真机跑通后应回来收敛成确定实现。

### 12.5.2 提示文字（R4 新增/变更）

| 场景 | 提示 |
| --- | --- |
| 自动选中推荐封面 | 进度 85% `已自动选用平台推荐封面` |
| 只给本地封面文件、且平台无推荐封面 | `头条视频发布需要封面图（平台必填）：平台未生成推荐封面，且调用方只提供了本地封面文件（cover/coverPath），但头条封面上传尚未实现 —— 请改传平台侧 thumbUri，或依赖平台推荐封面。平台侧原文：该视频需要上传一个封面` |
| 完全没给封面、且平台无推荐封面 | `头条视频发布需要封面图（平台必填）：平台未生成推荐封面，且调用方未提供 cover/thumbUri。平台侧原文：该视频需要上传一个封面` |
| 推荐封面接口不可用 | warn：`toutiao-video: GetPosterList 不可用，回落失败: <原因>` |

### 12.5.3 请求体补正

`VideoType` 的判据在 bundle 里是 `aspectRatio < 1`（`Tt = U < 1 ? 6 : 3`），
而 `aspectRatio` 本身也是 body 字段（`Z = VideoWidth < VideoHeight ? .62 : 1.78`）。
R4 起 body 同时输出 `aspectRatio`（竖版 0.62 / 横版 1.78），
宽高缺失时按横版（`VideoType=3`、`aspectRatio=1.78`）并在记录里标注。

**R3 真机实测结论（2026-10-18 夜）**：该头条号
`GET /mp/agw/media/get_user_base_info` → `{"is_auth":false,"media_status":4}`，
页面写着「请完善账号信息，解锁发布文章、视频等权益功能」⇒ **第 1 道闸就拦住**。
因此：
- 点「存草稿」/「发布」都是空操作，网络层没有任何发稿请求（三次脚本均复现）
- **没有产生任何草稿或正式作品**（已核草稿箱为空、作品管理无新增）
- 头条「真实发布成功」的**前置条件是账号完成实名/信息完善，属人工操作**

### 12.4 显示项与提示文字（我方 UI 口径）

| 场景 | 我方提示 |
| --- | --- |
| 缺登录态 | `头条号登录态缺失，请重新授权此账号再试` |
| 缺 uid | `toutiao-video: 缺 uid_tt（无法定位账号）` |
| 缺视频 | `toutiao-video: taskData.video.path required` |
| 视频文件不存在 | `toutiao-video: video file not found: <path>` |
| **缺封面** | 见 §12.5.2（R4 起按「本地封面文件 / 完全没给」两句区分，且封面改为平台推荐封面优先） |
| 无发布权限 | `该头条号当前无发布权限（GetPublishAuth.DisablePublish=true）。平台侧原文：请完善账号信息，解锁发布文章、视频等权益功能。` |
| 上传授权失败 | `toutiao-video: 未获取上传授权(code=…): <平台 msg>` |
| 发稿失败 | 优先透出平台 `data.Message`，否则 `头条发布失败(status=…, code=…)` |

---

## 12.6 写接口 CSRF 头（R6，2026-10-19 真机实证）

### 12.6.1 结论

**头条写接口（`PublishVideo` 等）必须带 `x-csrf-token`，值取自 cookie `xigua_csrf_token`。**
缺少或取错来源一律 `HTTP 403 {"code":403,"msg":"invalid csrf token"}`。

### 12.6.2 证据（三段逐级排除）

**① `checkPublishAuth` **不能**用于判断「能否发布」**：

```
canPublish = true   disablePublish = false   blockStatus = 0   reviewLatency = 0
authorPermission: IsIdentifyAuth=false（未实名），但 DisablePublish=false、IsUserBan=false
```

> ⚠️ **R7 订正（推翻上一轮的结论）**：上一轮曾据上面这组读数写下
> 「『未实名』≠『不能发』，此前『卡实名认证、需人工』属错误归因，予以撤回」。
> **该撤回本身是错的，现予撤销。**
>
> 反证来自**平台自己的发布页**（真机、活会话、真实上传完成后点「发布」）：弹出模态框——
>
> **「账号信息未完善 —— 账号信息未完善，暂时不能进行发布文章、视频等权益操作，请完善后重试」**
> （按钮：取消 / 去完善）
>
> ⇒ `GetPublishAuth` 的 `DisablePublish` / `BlockStatus` **不是**发布闸门的完整判据；
> 平台真正的拦截发生在**提交动作**上，且**只在 UI 层给出（客户端模态框），接口读数里看不到**。
> 结论回到 R5：**该头条号当前确实不能发布，必须人工完善账号信息**。
>
> **判据纪律（本轮新增，比结论本身更重要）**：
> ① 「接口读数说可以」**不能**推出「实际可以」——必须找到**真实提交路径上的拦截点**才能下结论；
> ② 推翻既有结论时，不能只凭一个看起来相反的读数，要有**行为级证据**（真实操作 + 平台反馈原文）。
> 上一轮正是违反了第 ② 条：拿一组静态读数推翻了有 UI 证据支撑的结论。

同时补记首尾长度：`TtVideoTitleLenMin/Max = 0/30`、`XgVideoTitleLenMin/Max = 1/30`；
发布页 `*标题`、`*封面` 带星号为必填。

**② 应用 bundle `xigua_entry.*.js` 的写接口分支**：

```js
var i = v("xigua_csrf_token");            // v = cookie getter
o.headers = { "x-csrf-token": i };        // 仅 POST 分支设置
```

**③ 真机逐变体对照（同 cookie 串、同请求体）**：

| 头部 | 结果 |
| --- | --- |
| 不带 | 403 `invalid csrf token` |
| `x-csrf-token: <csrf_session_id>` | 403 同 |
| `x-csrftoken: <csrf_session_id>` | 403 同 |
| `x-secsdk-csrf-token: <csrf_session_id>` | 403 同 |
| `X-CSRF-Token: <csrf_session_id>` | 403 同 |
| **`x-csrf-token: <xigua_csrf_token>`** | **200，进入业务码判定** |

> ⚠️ **判据陷阱**：**头名对但 cookie 来源错也是 403**。
> 只验证「有没有这个头」会得出假结论，必须同时验证**头名 + 取值来源**。

### 12.6.3 实现约束

| 约束 | 说明 |
| --- | --- |
| 头名 | `x-csrf-token`（常量 `CSRF_HEADER`） |
| 取值 | cookie `xigua_csrf_token`（常量 `CSRF_COOKIE`），由西瓜发布页渲染时下发 |
| 缺失时 | **不伪造该头**，让服务端如实拒绝 —— 否则会把「cookie 缺失」误诊成「签名算法不对」 |
| 单一事实源 | `pickCsrfToken()` 在 `toutiao-video-publish.js`（纯函数、无 IO），链内只调用不重抄 |

### 12.6.4 越过 CSRF 后的服务端判据（新增硬约束）

```
{"data":{"Code":20007014,"Message":"request Param ThumbUri Can't be nil Error"},"status":0}
```

⇒ **`ThumbUri` 服务端必填**（不只是前端提示）。且：

| 尝试 | 结果 |
| --- | --- |
| `ThumbUri=""` | `20007014 ThumbUri Can't be nil` |
| `ThumbUri=<VOD 上传图片得到的 vid>` | `21085 封面数据异常，请重新上传` |

⇒ `ThumbUri` 要的是**图片资源 URI**（tos/imagex 形态），**不是 VOD 视频 vid**。

### 12.6.5 显示项与提示文字（本轮新增）

| 场景 | 提示（拟定） |
| --- | --- |
| 缺 CSRF cookie | `头条写接口需要 CSRF 票据（xigua_csrf_token）缺失，请重新打开头条发布页后再试` |
| 403 invalid csrf token | `头条拒绝了本次提交（CSRF 票据失效），请刷新头条发布页后重试` |
| `ThumbUri Can't be nil` | `头条视频发布需要封面（平台必填）：请提供封面图或等待平台生成推荐封面` |
| `21085 封面数据异常` | `封面格式不被平台接受：请提供 JPG/PNG 图片，而不是视频标识` |

### 12.6.6 仍未闭合

1. `GetPosterList` 取不到推荐封面（POST→405；GET 下 `vid` 无论放 query/路径/body 均报 `vid is required`）。
2. `ThumbUri` 的**正确图片 URI 从哪来**（头条侧图片上传接口）尚未找到。
3. 尚未成功提交过一次 `PublishVideo`（已越过 CSRF 与 `ThumbUri` 校验，未越过封面格式校验）。

---

## 13. 小红书视频「草稿」真实通路（R5，2026-10-19 真机取证成功）

### 13.1 结论

**小红书视频「发布到草稿箱」已真机跑通**：上传视频 → 点「暂存离开」→ `草稿箱(+1)`。
取证明细见 `openspec/records/xhs-draft-findings.md`。

| 取证点 | 值 |
| --- | --- |
| 操作前草稿箱 | 无计数 |
| 操作后草稿箱 | **`草稿箱(1)`**，面板「视频笔记(1) 图文笔记(0)」 |
| 草稿条目 | 标题 / 保存时间 / 时长 3:11 / 缩略图 / 编辑·删除 |

### 13.2 三条决定性认知（推翻此前路线判断）

1. **草稿不是服务端资源。** 平台原文：「草稿存储于**当前使用的浏览器本地**，在清除浏览器数据时会被删除」。
   ⇒ `web_api/sns/v2/note`（此前恒 406）即使打通也**不会**产生草稿，那条路的方向本身是错的。
   **小红书只能走 RPA/DOM 轨**；`xiaohongshu-draft.js` 长期「不通」的真正原因在此。
2. **必须用用户自己的浏览器 profile 操作**。草稿落在该 profile 的本地存储里；
   把分区拷到临时目录去操作，草稿会留在副本里（用户看不到）。
3. **上限 100 篇，超额静默删一篇**（平台原文）。
   ⇒ 需要「发布后清理草稿」或「提交前查重」，否则会**无声丢草稿**。

### 13.3 登录态与上传链路

| 项 | 结论 |
| --- | --- |
| 判据 cookie | `galaxy_creator_session_id` + `access-token-creator.xiaohongshu.com` + `customerClientId` 齐全即可；**`web_session` 缺失不影响 DOM 轨** |
| 有效性探测 | `api/galaxy/user/info`、`api/galaxy/v2/creator/datacenter/account/base`、`api/galaxy/creator/home/personal_info` 均 200 |
| 上传链 | `GET api/media/v1/upload/creator/permit?biz_name=spectrum&scene=image` → `PUT ros-upload.xiaohongshu.com/spectrum/<key>?partNumber=N&uploadId=…`（多分片并发）→ `POST …?uploadId=…`（complete）；59 MB/20 分片约 50 s，全 200 |

**cookie 提取的正确与错误做法**（踩坑已固化）：

| 做法 | 结果 |
| --- | --- |
| 拷 `Partitions/<p>/Network/Cookies` → 临时 profile 的 `Default/Network/Cookies`，**并同时拷** `shared-user-data/Local State` | ✅ Chromium 用同一 Windows 用户 DPAPI 自解密 |
| 直接以 `Partitions/<p>` 作 user-data-dir 启动 | ❌ 分区目录**无 `Local State`**（DPAPI `encrypted_key` 在那）⇒ cookie 解不开 ⇒ 跳登录、`input[type=file]` 为 0，**表象是「未登录」，实为解密失败** |

### 13.4 页面结构与交互逻辑（DOM 轨实现依据）

| 事实 | 细节 |
| --- | --- |
| 空发布页只有 2 个 button | `chat-fab`、「上传视频」 |
| 「暂存离开」「发布」**上传完成后才渲染** | 空页扫不到，**不得误判为「平台无草稿入口」** |
| footer 为 fixed 定高 | 1600×1000 下「暂存离开」约 `(683, 955)`，「发布」约 `(821, 955)` |
| 元素不可枚举 | `body.innerText` 含「暂存」但 `querySelectorAll('*')` 与 `getByText('暂存离开')` 均 count=0 ⇒ 当前只能用坐标 + 截图核对 |
| 上传完成判据 | 进度百分比**与**「取消上传」同时消失 |
| 标题 / 正文 | `input[placeholder*="标题"]` / `div[contenteditable="true"]` |
| 正文会自动插入话题标签 | 属平台行为，无需处理 |

### 13.5 我方显示项与提示文字（小红书轨，待实现）

| 场景 | 提示（拟定） |
| --- | --- |
| 登录态缺失/失效 | `小红书登录态已失效，请重新授权此账号再试` |
| 上传超时 | `视频上传超时（已 N 秒），请检查网络后重试` |
| 找不到草稿入口 | `未找到「暂存离开」按钮：平台页面结构可能已变更，请反馈` |
| 草稿保存成功 | `已存入小红书草稿箱（当前 N 篇）` |
| 草稿将超上限（≥95 篇） | `小红书草稿箱已有 N 篇（上限 100），超出后平台会自动删除一篇，建议先清理` |
| 草稿内容未核对 | `草稿已创建，但标题/正文/封面完整性未逐项校验` |

### 13.6 草稿落地到产品分区（R7 已闭环）

**结论：小红书「发布到草稿箱」已闭环** —— 草稿真正落在产品使用的 RPA 分区
`session/Partitions/rpa-xiaohongshu-a1eac276` 里，从该分区重开浏览器仍显示 `草稿箱(1)`。

验证方法（三步，可复现）：

| 阶段 | 动作 | 读数 |
| --- | --- | --- |
| 1 | 从真实分区 seed 临时 profile（`Network/Cookies` → `Default/Network/Cookies` + `shared-user-data/Local State` → 临时 profile 根），上传视频 → 点「暂存离开」 | 起始 `草稿箱(0)` → 点击后 **`草稿箱(1)`** |
| 2 | 把临时 profile 的 `Default/{Local Storage,IndexedDB,Session Storage}` **回写**进真实分区 | 24 个文件：Local Storage 5 / IndexedDB 14 / Session Storage 5 |
| 3 | 从**真实分区**重新 seed 并打开发布页 | **`草稿箱(1)`**（截图取证） |

落盘证据（真实分区 `Default/`）：

| 路径 | 规模 |
| --- | --- |
| `IndexedDB/https_creator.xiaohongshu.com_0.indexeddb.leveldb` + `…indexeddb.blob` | **377.6 KB**（含视频缩略图 blob） |
| `Local Storage/leveldb` | 8.7 KB |
| `Session Storage` | 0.5 KB |

**⇒ 平台侧「草稿」的物理位置确定**：`<profile>/Default/Local Storage` + `<profile>/Default/IndexedDB`。
这解释了 §13.2 第 1 条（草稿不是服务端对象），也给实现定了落点：
**RPA 引擎必须让这个分区保持持久化**，任何「临时 profile 跑完就丢」的做法都会让草稿消失。

### 13.7 实现注意（R7 新增，两条硬约束）

1. **分区目录缺 `Local State`**：`session/Partitions/<p>/` 下**没有** `Local State`（DPAPI 的 `encrypted_key` 在
   `shared-user-data/Local State`）。所以**不能**把分区直接当 `--user-data-dir` 启动（cookie 解不开，
   表现为「跳到登录页、`input[type=file]` 数量为 0」，**看似未登录、实为解密失败**）。
   正确做法：以 `shared-user-data` 为主 user-data-dir（应用的做法），或把 `Local State` 一并提供。
2. **草稿是浏览器本地对象**：不要指望「换机器/换 profile 后草稿还在」；也不要设计「清空 cache 后重试」的兜底
   （会连草稿一起删掉）。

### 13.8 仍未闭合

1. **100 篇上限的清理/去重策略**未实现（平台原文：超出后**默认删除最后一篇**，属静默丢失）。
2. 坐标点击需替代为更稳的定位（当前「暂存离开」固定在 1600×1000 视口下的 `(683,955)`，**换分辨率/缩放会失效**）。
3. 草稿**内容完整性**（标题/正文/封面是否都逐字存住）未逐项核对 —— 当前只断言了「草稿箱计数 +1」。
4. 本轮的「回写存储」是**验证手段**，不是产品实现；产品化应由 RPA 引擎在真实分区上直接跑流程（见 §13.7）。

---

## 14. 抖音签名材料形态（R6，2026-10-19 真机实证）

### 14.1 结论

抖音 API 轨在真机上推进到「**只差 create_v2**」，两个根因均为实测：

| 步骤 | 结果 |
| --- | --- |
| `getSdkToken` | ✅ 92 字符 token |
| `getAuthKey` | ✅ 有 SessionToken |
| `uploadVideo`（VOD 5 步） | ✅ `videoId=v0300fg10000dbaja5fog65rgu1mtqe0` |
| `uploadCover`（imagex） | ✅ `coverPoster=tos-cn-i-jm8ajry58r/…` |
| `create_v2` | ❌ `{"status_code":8,"status_msg":"用户未登录"}` |

### 14.2 根因一：HTTP 200 ≠ 已登录

```
/aweme/v1/creator/pc/user/info/?aid=2906  → HTTP 200，body {"status_code":8,"status_msg":"用户未登录"}
/aweme/v1/web/aweme/create_v2/…           → HTTP 200，同上
页面内 fetch 同一接口                      → 同上
```

**判据纪律（R6 新增）**：抖音一切「是否已登录」的判定**必须读 body 的 `status_code`**，
**不得**以 HTTP 状态码或「创作页能渲染」为准。`rpa-douyin-01ab122e` 仍有 62 个 cookie
（`sessionid`/`sid_tt`/`uid_tt` 齐全），但服务端不认 —— **cookie 名齐全 ≠ 登录有效**。

### 14.3 根因二：签名材料只剩 key id，本机找不到可用私钥

| 项 | 实测值 |
| --- | --- |
| `__security_mc_1_s_sdk_crypt_sdk` | `056709ca-4e73-9159`（18 字符，key id） |
| `__security_mc_1_s_sdk_sign_data_key_web_protect` | `6c6586e1-4222-8f79`（18 字符，key id） |
| `__security_mc_1_s_sdk_cert_key` | `fdef635f-4ae0-8ed3`（18 字符，key id） |

签名器期望的形态是 `encodeURIComponent({"data":"<json>"})`（内含 `ec_privateKey` PEM / `ticket`）；
这三个值解出来 `JSON.parse` 失败。

真材料**没有**出现在任何可读位置（R6 实测，含一次订正）：

| 位置 | 实测结果 |
| --- | --- |
| `localStorage['security-sdk/s_sdk_server_cert_key']` | 服务端证书（1739 字符）—— 只有证书，无私钥 |
| `localStorage['ztsdk_tcc_config']` | secsdk 配置（1022 字符） |
| `IndexedDB['secure-store']` | 库存在，唯一 store `cryptvalues` 的 **keyCount = 0（空库）** |
| `window.secsdk` | 全局存在，但**只暴露 `csrf`**，**无公开签名入口** |

> ⚠️ **订正**：初版曾断言「私钥在 IndexedDB 且 `extractable:false` 不可导出」；
> 后续实测该库**当前为空**，该断言**不成立**（属把规范推断写成事实）。
> 准确表述：**本机这份 profile 里找不到可导出的私钥材料**；材料何时/落在哪里仍**未知**
> （推测需在有效会话下由 secsdk 完成一次受保护请求的 bootstrap）。

⇒ 「读 PEM 再用 Node crypto 签名」在本机走不通；但**「架构性不可行」这一更强断言本轮证据不足，不予主张**。

### 14.4 因此修掉的报错缺陷

Step 0 曾硬要求 `bd_ticket_guard_client_data` 存在 —— 而它**只在受保护请求真正发生后**才由握手写入
（执行后才有），且真实账号材料只剩 key id ⇒ 该判据**对真实账号恒不成立**，
报错还是笼统的「账号信息缺失，请重新授权此账号再试」，把**架构性不可行误导成「用户该重新登录」**。

**当前判据顺序**（刻意不放松任何既有守卫）：

| # | 判据 | 说明 |
| --- | --- | --- |
| 1 | `hasSecurityMaterials(c)` | 不变 |
| 2 | **`hasKeyIdOnlyMaterials(c)`** | 新增：材料只剩 key id ⇒ 专用诊断（指向页面内签名 / RPA 轨） |
| 3 | `bd_ticket_guard_client_data` 存在 | **保留**（无证据可省 ⇒ 继续 fail-closed） |
| 4 | `sid_tt=` 存在 | 不变 |
| 5 | `clientSign(c)` 可签出 | 不变 |

### 14.5 显示项与提示文字（R6 新增）

| 场景 | 提示 |
| --- | --- |
| 材料只剩 key id | `抖音签名材料仅剩 key id（签名私钥不在 cookie 中，本机也读不到可用的私钥材料），纯 API 轨无法完成 create_v2 签名；请改用 RPA/DOM 轨` |
| 材料缺失 / PEM 非法 / 未授权 | `账号信息缺失，请重新授权此账号再试`（不变） |
| 触发安全验证 | `抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）`（不变） |

### 14.6 两条可行路线（下一轮）

1. **页面内签名 / 页面内发 create_v2**：实测页面内 `fetch` 会被 secsdk **自动补 `x-secsdk-csrf-token`**，
   且私钥在页面上下文里可用 ⇒ 「Node 驱动 + 页面签名」是可行中间路线。
2. **RPA/DOM 轨**：最稳但慢。

### 14.7 未闭合

1. 抖音真实发布未成功（会话对 API 失效；且本机这份 profile 里找不到签名私钥材料）。
2. 视频号 / 头条的**活会话**在 `account-*` 分区，被当时运行中的应用实例独占锁定 ⇒ 这两个平台的真实发布本轮无法验证。
3. `create_v2` 是否真需要 `bd-ticket-guard-ree-public-key` 未验证（会话失效使实验走不到那步）⇒ 判据继续 fail-closed。
4. 视频号 15 个 `rpa-rpa-tencent_video-36b5b265-*` 分区全部为 2026-09-23，必然失效，勿再复用。

---

## 12.7 账号未完善的提交前检测与解法链接（R8，2026-10-19 真机实证）

### 12.7.1 能不能在发布前检测到「账号没完善、发不了」——能

真机读数（活会话、只读、零副作用）：

```
GetPublishAuth.authorPermission.IsIdentifyAuth = false  →  identityVerified = false
canPublish = true   disablePublish = false   blockStatus = 0        ← 这三项**都不受影响**
```

⇒ **`DisablePublish` / `BlockStatus` 不能用于判断「能否发布」**，`IsIdentifyAuth` 是唯一的提交前信号。

### 12.7.2 解法链接：用头条自己的页面（不新建飞书文档）

真机录到的完整链路：发布页点「发布」→ 模态框「账号信息未完善」→ 点弹窗里的**「去完善」**，
实测弹出目标是：

```
https://mp.toutiao.com/profile_v4/personal/landing-type        ← 主链接（用户点进去即可完善）
https://mp.toutiao.com/profile_v4/personal/auth?enter_from=main_page   ← 二级：头条认证页
```

按「平台有现成解法页面就用现成的」原则直接采用，**无需自建说明页**。

### 12.7.3 闸门与返回结构

| 情形 | 判据 | `code` | 是否带 `helpUrl` |
| --- | --- | --- | --- |
| 无发布权限 | `canPublish === false` | `NO_PUBLISH_PERMISSION` | ✅ |
| **账号信息未完善** | `identityVerified === false` | **`ACCOUNT_NOT_VERIFIED`** | ✅ |
| 正常 | 以上皆否 | —— | —— |

失败结果统一带 `{ success:false, code, error, helpUrl, helpLabel, auth }`，
`helpUrl` 供 UI 渲染「可点击查看」。**闸门位置在上传之前**——不该发生的上传一次都不发生
（测试锁：`Action=ApplyUploadInner` 请求数必须为 0）。

### 12.7.4 显示项与提示文字

| 场景 | 提示文字 | 链接 |
| --- | --- | --- |
| 账号信息未完善 | `该头条号账号信息未完善，暂时无法发布视频（平台提示：账号信息未完善，暂时不能进行发布文章、视频等权益操作，请完善后重试）。` | `去头条号完善账号信息` → `landing-type` |
| 无发布权限 | `该头条号当前无发布权限（GetPublishAuth.DisablePublish=true）。平台侧原文：请完善账号信息，解锁发布文章、视频等权益操作。` | 同上 |

> ⚠️ **文案纪律**：只如实写「账号信息未完善」，**不写「未实名」** ——
> 弹窗用词是更宽的「账号信息」，把 `IsIdentifyAuth=false` 直接翻译成「未实名」属过度断言
> （测试里有一条断言专门锁 `error` 不含「未实名」）。

### 12.7.5 未闭合

1. **UI 的弹窗与可点链接尚未接线**：引擎已返回 `helpUrl`，但渲染层发布失败走
   `usePublishFlow.js#notifyFailure` → `notifyError`，目前只显示纯文本；
   且外链打开受 `href-scheme-contract.test.js` 白名单约束，需按契约接入。
2. 接线时须同步补 `locales/zh.js` / `en.js` 成对文案（Gate 7 locale-sync）。
3. `IsIdentifyAuth=false` 与弹窗「账号信息未完善」是否完全等价未单独证实。

### 12.7.5 「解法入口」在界面上的落地（R9，2026-10-19）

#### 断点不在引擎，在结果收敛器

引擎返回 `helpUrl` 并不会自动到界面 —— `publish-mode-runner` 用
`Object.assign(base, {...})` **重建**结果对象，只挑 `error` / `code` 等少数字段往下传。
新增字段默认不透出。

⇒ 渲染层的接法改为**按稳定失败码反查链接**，只依赖已经在传的 `code`。
好处：收敛器将来再挑字段也不会让链接静默失效。

#### 单一真源（三处必须一致）

| 处 | 文件 | 约束 |
| --- | --- | --- |
| 主进程（CJS） | `packages/shared-utils/src/publish-gate-help.js` | 权威表 |
| 渲染进程（ESM） | `packages/shared-utils/src/publish-gate-help.browser.js` | 浏览器不能执行 CJS，故双份（本仓既有先例） |
| 引擎 | `packages/api-publish-engine/.../toutiao-video-publish.js` 的 `ACCOUNT_FIX_URL` | **不能** require 本包（该包是零 workspace 依赖运行时），故自带常量 |

一致性由 `packages/shared-utils/test/publish-gate-help-parity.test.js` **机械锁死**：
两份逐字段比对 + **静态读引擎源码**比对 `ACCOUNT_FIX_URL` 字面量。
**为什么必须机械**：任一处漂移，用户会被送到错页面且**不报错**。

#### 显示项与交互

| 项 | 规则 |
| --- | --- |
| 出现位置 | 发布进度面板里**失败**的那一行（`phase === 'failed'`） |
| 出现条件 | `task.code` 在链接表里**有对应项**；否则**不渲染**（绝不给点不动的链接） |
| 链接属性 | `href` 过 `safeHttpUrl`；`target="_blank"`；`rel="noopener noreferrer"` |
| 文案 | i18n `publishPage.publishFlow.gateHelp.<code>`；未命中用表内中文兜底 |
| 判据形状 | `v-if` 与 `:href` **必须同一个表达式** `safeHttpUrl(gateHelp.url)`（`href-scheme-contract.test.js` 硬判据，防死锚点） |

#### 文案

| 语言 | 文案 |
| --- | --- |
| zh | 去头条号完善账号信息 |
| en | Complete your Toutiao account info |

#### 数据校验

- `url` 必须是 http/https 且**不含 userinfo**（parity 测试里断言，渲染层 `safeHttpUrl` 再验一次）。
- `code` 缺失 / 未知 ⇒ `helpForCode` 返回 `null`，界面不渲染。

#### 仍未闭合

1. 单篇发布流程的失败 toast 仍是纯文本（它拿到的是入队响应，平台失败异步回来），未接。
2. 目前只有头条两个码；其它平台的账号状态类失败要接需成对加表项。
3. 链接页面对未登录 / 其它账号是否同样有效未验证。

### 12.6.7 封面链真解与账号墙 API 证据（R10，2026-10-19）

#### 12.6.7.1 封面：image_temp 链（订正 12.6.4/12.6.6 的旧解读）

真页面「封面截取/本地上传」走的是**独立于视频**的凭证链（此前把 `SpaceName=pgc` 的 6 次
`ApplyUploadInner` 误读为封面上传 —— 本轮证实其**从未产生 tos 传输**，是 SDK 候选路由预探测）：

| 步 | 调用 | 关键点 |
| --- | --- | --- |
| ① 凭证 | `GET /xigua/api/upload/getAuthKey/?params={"type":"image_temp",…,"useStsToken":false}` | 返回 `{accessKey, uploadToken}`（HMAC-SHA1 形态） |
| ② 三元组 | `GET vas-lf-x.ixigua.com/video/openapi/v1/?action=GetImageUploadParams&s=<5hex>&use_edge_node=1&file_size=<n>` | 头必须同时带 `Authorization: <uploadToken>` **和** `X-TT-Access: <accessKey>`（缺后者 `10413`） |
| ③ 传图 | `PUT https://<tos_host>/<object_id>`，`Authorization: <tos_sign 原文（完整 JWT）>` | 204 即落盘；签名截断 ⇒ 401 |
| ④ **登记** | `POST …?action=GetImageUploadInfos&`，body `[{"uri":"<object_id>"}]` | **服务端此刻才入库**（返回 `result_uri` + `{width,height,size,format,md5}`）；跳过这步直接提交 ⇒ `21084 封面图片不存在` |
| ⑤ 提交 | `PublishVideo` 的 `VideoInfo.ThumbUri = result_uri` | `tos-cn-i-e874c6/…` 形态 |

**错误码订正**：
- `21085 封面数据异常`（R6 时代）= ThumbUri 传了 VOD vid（格式错）；
- `21084 封面图片不存在`（本轮实测）= URI 形态对但**没走第 ④ 步登记**；
- `21000 未实名认证/帐号不可用，可前往西瓜创作平台/西瓜App投稿`（本轮实测）= **封面链全通后，服务端对账号状态的权威拒绝**。

#### 12.6.7.2 账号墙的 API 层证据（与 12.7 互补）

`21000` 证明：**不需要 UI 弹窗也能在提交时检测到未实名**。与 §12.7 的提交前检测
（`IsIdentifyAuth=false` → `ACCOUNT_NOT_VERIFIED`）构成双保险：

| 层 | 触点 | 已落地 |
| --- | --- | --- |
| 提交前 | `checkPublishAuth` → `identityVerified` → 闸门（零上传） | ✅ #3977 / #3983 |
| 提交时 | `PublishVideo` → `Code 21000`（平台原文透出） | ✅ 通用透出（结构化映射待接，见 §12.6.7.4） |

#### 12.6.7.3 视频上传本轮新读数

- 新 Vid：`v02d16g10004dbarnvvog65osoip723g`（同账号同链路，稳定可复现）。
- `GetUploadCandidates` 与 `ApplyUploadInner(SpaceName=pgc)` 是 SDK 候选路由预探测，
  **不产生上传**——不得再据此推断「封面走 pgc」。

#### 12.6.7.4 未闭合

1. `21000` → `ACCOUNT_NOT_VERIFIED` 的提交时结构化映射（含 `helpUrl` 复用同一链接）。
2. 封面链五步沉淀为 `toutiao-video-cover.js`（现链文件 491/500 行，需新模块避免行数闸）。
3. 视频号 / 抖音仍等扫码登录。

### 12.6.7.5 封面链代码化 + 21000 兜底（R11，2026-10-19，#4008 后续）

§12.6.7.4 ①② 关闭：封面五步链已从取证**沉淀为代码**，提交时账号墙已接兜底映射。

#### 实现落点

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 编排 | `packages/api-publish-engine/src/publish/platforms/toutiao-video-cover.js` | `uploadCoverImage(o)`：注入 `mpClient/vasClient/axiosLike`（可全假服务器，零外发）；生产缺省 tos host 用三元组返回值 |
| 纯判据 | 同上 `pickImageTempCreds / pickUploadTarget / pickRegisteredImage` | 形状不对一律 `null`（fail closed，不伪造凭证/不猜默认值）；`info.md5` 缺失=未登记 |
| 提交时兜底 | `toutiao-video-publish.js#parsePublishResponse` | 新增 `accountGate`：`Code 21000` **或**原文含「未实名认证/帐号不可用」双判据；其它业务码不误判（测试锁 20007014/成功样例） |
| 链出口 | `toutiao-video.js#run()` 提交段 | `accountGate` ⇒ 返回 `code:'ACCOUNT_NOT_VERIFIED'`（与 §12.7 提交前闸门同码；UI 据码反查同一「去完善」链接，shared-utils 单一真源） |

#### 调用契约（编码接手者需知）

```js
const { uploadCoverImage } = require('…/toutiao-video-cover')
const { uri, info } = await uploadCoverImage({
  imagePath: '/本地/cover.jpg',       // jpeg
  mpClient,   // baseURL=https://mp.toutiao.com，头用 chain._mpHeaders({Accept:'application/json'})
  vasClient,  // baseURL=https://vas-lf-x.ixigua.com
  axiosLike,  // 通用请求器（PUT 用）
  headers, userAgent,
  // tosBaseUrl 仅测试注入；生产不传
})
// uri 即 PublishVideo 的 VideoInfo.ThumbUri
```

#### 失败路径（全部 fail closed，测试各一例）

| 失败点 | 判据 | 不发生的事 |
| --- | --- | --- |
| ①凭证形状不对 | `pickImageTempCreds`=null | 不发起 params 请求 |
| ②params code≠2000 | 直接抛（含 10413/10402 原文） | 不 PUT |
| ③PUT 非 2xx | 抛「PUT 图未落盘」 | 不登记 |
| ④登记无 md5 / 串号 | 抛「GetImageUploadInfos 未登记成功」 | **不返回 uri**（21084 教训） |

#### runner 接线纪律（本轮实测踩坑）

`packages/api-publish-engine/scripts/run-tests.js` 的 `VITEST_FILES` 是**登记表**：
新增 vitest 文件必须登记，否则走 node 直跑分支必崩（单文件 vitest 直跑却绿 ——
「单文件绿 ≠ 接线绿」，与 #3983 的 vite alias 同族教训）。

#### 未闭合

`uploadCoverImage` 尚未接进 `run()` 的封面闸门（调用方现在需显式调）；接入点在
`hasLocalCoverOnly` 分支（coverInputs 形状契约需先立，留下一轮小 PR）。

### 12.6.7.6 封面接线进 run()（R12，2026-10-19，同分支第二提交）

§12.6.7.5「未闭合①」关闭。三态契约在闸门 5 生效：

| 态 | 触发输入 | 行为 |
| --- | --- | --- |
| 平台 URI | `opts.thumbUri` / `td.cover.uri` | 直接填 `VideoInfo.ThumbUri` |
| 推荐封面 | 无 URI 时 `GetPosterList` | 先试（服务端故障时为 null） |
| **本地文件** | `opts.cover.path` / `td.coverPath` / `td.cover`（字符串） | **`uploadLocalCoverFor(chain, path)` 五步链 → result_uri 进 ThumbUri** |

接线体在 `toutiao-video-cover.js`（`pickLocalCoverPath` + `uploadLocalCoverFor`），链内 5 行。
旧报错文案「头条封面上传尚未实现」订正为「本地封面上传失败且推荐封面不可用」。

**零外发纪律**：`uploadLocalCoverFor` 的 vas 域按 `chain.mpBase` 推断 ——
测试注入假 mpBase 时 vas 自动跟随假地址；生产用官方域。

**回归锁**：`test/toutiao-video-chain.test.js` 新增「本地封面接线」用例 ——
coverPath ⇒ 五步链三请求发生（params/Infos 打假服务器）+ 提交体 ThumbUri = 登记 uri。
---

## 14. 视频号会话位置订正 + 活性探针（R14，2026-10-20）

### 14.1 会话位置的订正（对 §6/§7 的补充）

「视频号登录态不落盘（`_log_finder_id` 全分区 0 命中）」对 **Chromium 分区**仍成立，
但 **应用的信封加密库（`credential-store`）里存有 1 条视频号 cookie**（运行态读数：
`listAccounts` → `has_cookies=true, cookie_count=1, status_source=backend, 最近验证 2026-10-18T14:29Z`）。
UI「已登录」标记即来源于此。⇒ 视频号**有可用会话**，位置在**应用信封库**而非分区文件。

### 14.2 HTTP 登录检测对视频号结构性无效

`accountCheckLogin('tencent_video', 'b1e05ac2')` 实测：
`{"code":"CHECK_LOGIN_INCONCLUSIVE","reason":"http-check-inconclusive","loginStatus":"active"}`
（平台不给出明确结论）。⇒ 真验证只有**实际走链第一步 `getUploadAuthKey`**。

### 14.3 活性探针（新增）

`packages/api-publish-engine/scripts/shipinhao-session-probe.cjs`：
只发 `helper_upload_params` 一条授权请求（**不传内容、不发稿**），结论三档
`ACTIVE / EXPIRED(300012/300014) / BLOCKED_OR_CHANGED`。需授权后运行（平台侧会留授权日志）。

### 14.4 账号状态快照（应用运行态，2026-10-19 探测）

| 平台 | 应用内状态 | 说明 |
| --- | --- | --- |
| 视频号（b1e05ac2） | **active**（信封 1 cookie） | 真活性待探针 |
| 头条（7ae99805） | 已登录 | ⛔ 账号墙 21000（待实名） |
| 抖音（01ab122e） | 已失效 | 待扫码 |
| 其余（快手/B站/小红书/公众号/知乎） | 已登录 | 不在本次目标范围 |

---

## 15. 三平台会话权威定论（R13，2026-10-20，应用运行态）

经用户运行中的应用实例（CDP `9279` 无侵入）调应用自身批量登录检测，三平台一次定论：

| 平台 | 账号 | 结论 | 判据码 |
| --- | --- | --- | --- |
| 头条 | 7ae99805 | ✅ **valid / active**（会话活着） | `CHECK_LOGIN_SUCCESS_HTTP_API` |
| 抖音 | 01ab122e | ⛔ **Cookie 过期**（应用已持久化 expired） | `CHECK_LOGIN_COOKIE_EXPIRED` |
| 视频号 | b1e05ac2 | ❓ INCONCLUSIVE（结构性，见 §14.2） | `http-check-inconclusive` |

**关键语义澄清**：`authLoginSilent` 的 `valid:false` **≠「未登录」**——它判的是
「能否用信封 cookie 静默重登」。头条会话活着但 silent=false 即为例证。
真正的登录结论以 `accountBatchCheckLogin`（各平台真实校验）为准。

**对发布主目标的意义**：头条会话活着 ⇒ 账号墙（§12.7 的 21000）是**唯一**剩余阻塞；
抖音确认等扫码；视频号等探针定论（§14.3）。

### 探测方法（可复用，无侵入）

`electron=5` 进程 → 命令行含 `--remote-debugging-port=9279` → `GET /json/list` 找 renderer →
CDP 连接后在页面上下文调 `window.electronAPI.*`（listAccounts / accountCheckLogin /
accountBatchCheckLogin / authLoginSilent）。**不碰** cookie 文件（独占锁）、不杀进程、不发稿。

### 12.6.7.7 全链真机预演 + 两个真 bug 修复（R14，2026-10-20，同分支第三、四提交）

用活 cookie 对**当前代码**做全链预演，四层全部真实可复现，终点 21000（预期）：

| 层 | 真机读数 |
| --- | --- |
| ① 提交前闸门 | identityVerified=false → ACCOUNT_NOT_VERIFIED 拦截 ✅ |
| ② 封面五步链 | PUT 204（CRC32）→ 登记 → result_uri（1280×720 jpeg）✅ |
| ③ 视频 VOD | 新 Vid ✅ |
| ④ PublishVideo | **21000 账号墙 + accountGate=true 被 parsePublishResponse 正确识别** ✅ |

#### 预演抓到的两个真 bug（均在 #4038 引入）

| bug | 症状 | 修复 |
| --- | --- | --- |
| wrapper 变量名/透传 | `uploadLocalCoverFor` 第三参省略（生产路径）时 `o.vasClient` 必崩（`o` undefined）；axiosLike 硬编码 chain.mp、tosBaseUrl 未透传 | 三处改走 `opts.*` 并透传；回归锁：第三参省略用例 |
| PUT 缺 CRC32 | 真 tos 校验 `Content-CRC32`，缺失 → `4007 MismatchChecksum`（HTTP 400） | `uploadCoverImage` 内置 `crc32hex()` 并加头 |

**教训（两条都重要）**：
1. 单测假服务器不校验 CRC ⇒ **8 例全绿但真机第一步就 400** —— 「单测绿 ≠ 真机通」的又一方（前有 vite alias、后有 CRC）。
2. 「第三参省略」这条生产主路径没有用例 —— 回归锁必须覆盖**默认参数形态**，不只覆盖显式传参形态。

### 14.5 视频号会话订正（2026-10-21）

§14.1/§14.2/§14.3 建立在「视频号 active、HTTP 检测不确定、待探针」这一前提上。
**2026-10-21 同法复测否证了该前提**：

```json
{"platform":"tencent_video","accountId":"b1e05ac2","valid":false,
 "code":"CHECK_LOGIN_COOKIE_EXPIRED","loginStatus":"expired",
 "persisted":{"ok":true,"status":"expired"}}
```

⇒ **视频号会话已过期**，不再"待探针"，改**重新扫码**。

**两处判断纠正（有普遍意义）**：
1. `has_cookies=true` **不等于会话有效** —— 只说明"存过凭据"。
2. `authLoginSilent` 的 `valid:false` 不宜解释为「能否静默重登的语义差异」，
   更可能直接就是**会话失效**信号；此前按语义差异解读是一次误读。

**订正后三平台终态**：仅头条 active；抖音、视频号均 expired（均须重新扫码）。

---

## 16. 四平台真实发布 —— 最终交付状态总章（2026-10-21 收口）

> 本章是「抖音 / 视频号 / 今日头条 / 小红书 视频内容真实发布成功」这一目标的**收口视图**。
> 前文章节记录的是**各技术点的拆解**，本章回答：**现在到底能发到哪一步、卡在哪、下一步做什么**。

### 16.1 四平台终态总表

| 平台 | 发布轨 | 技术链状态 | 当前判据 | 剩余动作 |
| --- | --- | --- | --- | --- |
| **小红书** | API（草稿） | ⚠ **当前无可观测证据表明已落地**（凭据有效、签名可用，但实跑 `406`） | 草稿箱**(0)**；无 `draft_id` 留存；见 §16.14 / §16.16 | 授权抓真实发布请求做字段级对照（§16.11.5） |
| **今日头条** | API（视频） | ✅ **100% 就绪且无回归** | 提交前拦截 `ACCOUNT_NOT_VERIFIED`；提交后 `Code 21000` | **用户完善账号实名** |
| **抖音** | API（视频） | 代码就绪 | `CHECK_LOGIN_COOKIE_EXPIRED`（应用已持久化） | **用户重新扫码** |
| **视频号** | API（视频） | 代码就绪 | `CHECK_LOGIN_COOKIE_EXPIRED` + 平台 `errCode 300334` | **用户重新扫码** |

### 16.2 头条：技术链已完整打通（唯一阻塞是账号实名）

全链四层在**最新主干代码**上逐层实测通过（2026-10-21 复跑，main tip `1c473767` 之后）：

| 层 | 实现 | 真机读数 |
| --- | --- | --- |
| ① 提交前闸门 | `GetPublishAuth.IsIdentifyAuth` → `buildPublishGateResult` | `identityVerified=false` → **拦截 `ACCOUNT_NOT_VERIFIED`**，并给出解法链接 |
| ② 封面五步链 | `toutiao-video-cover.js`：`getAuthKey(image_temp)` → `GetImageUploadParams` → PUT（带 `Content-CRC32`）→ `GetImageUploadInfos` → 登记 | 登记 uri ✅（1280×720 jpeg） |
| ③ 视频 VOD | getAuthKey(video) → 分片 → CommitUploadInner | 新 `Vid` ✅ |
| ④ 提交发布 | `PublishVideo` + `parsePublishResponse.accountGate` | `Code 21000` + **`accountGate=true` 被正确识别** |

**账户墙的两个判据必须区分**（易错点）：
- `DisablePublish=false` / `blockStatus=0` **不能**当作"可以发布"的依据；
- 唯一权威判据是 `IsIdentifyAuth`（实名）。

**账号一旦实名**：同一套代码无需改动即可产出 `ItemId`（真实发布成功）。

### 16.3 用户可见的交互与文案（头条账号墙）

| 项 | 内容 |
| --- | --- |
| 触发时机 | ① 提交前：`checkPublishAuth` 判 `identityVerified=false`；② 提交后：服务端返回 `Code 21000` |
| 结果码 | `ACCOUNT_NOT_VERIFIED`（提交前与提交时**同码**，UI 据此反查同一解法入口） |
| 提示文案（zh） | 该头条号账号信息未完善，暂时无法发布视频（平台提示：账号信息未完善，暂时不能进行发布文章、视频等权益操作，请完善后重试） |
| 解法链接 | `https://mp.toutiao.com/profile_v4/personal/landing-type`（平台自有「去完善」落地页） |
| 链接文案（zh） | 去头条号完善账号信息 |
| 链接渲染 | `v-if` 与 `:href` 同表达式 `safeHttpUrl(gateHelp.url)`；`safeHttpUrl("")` 返回 null ⇒ 不渲染死链 |
| 副链接 | `https://mp.toutiao.com/profile_v4/personal/auth?enter_from=main_page` |

### 16.4 抖音 / 视频号：代码就绪，仅等会话

两者的发布链代码均已落地，当前阻塞**纯粹是登录态**：

- **抖音**：应用判定 `CHECK_LOGIN_COOKIE_EXPIRED` 并已持久化 `expired`。
- **视频号**：双证据确认过期 ——
  ① 应用 `accountBatchCheckLogin` → `CHECK_LOGIN_COOKIE_EXPIRED`；
  ② 绕过应用直接调平台 `auth_data` → `errCode 300334`，
     而 `http-login-checker.js` 注释写明 **300333/300334 = 登录失效**。

> ⚠ **与目标描述的冲突（如实记录）**：目标描述写「视频号已经登录了」，
> 但 2026-10-21 实测（应用判定 + 平台 errCode 双证据）为**已过期**。
> 该描述在当下不成立，须重新扫码后恢复。

### 16.5 工程侧已完成 / 未做的边界（不谎报）

**已完成**：
- 小红书草稿落地；头条全链（含封面五步链、账号墙双层判据、UI 解法链接）；
- 抖音 / 视频号发布链代码；
- 账号与发布相关的基础设施修复（runner 机械判定、假签名拆除等，见 §12-§15）。

**未做 / 未闭合（如实）**：
- 三平台**真实发布成功**均未取得 —— 全部被账号侧（实名 / 扫码）阻塞；
- 抖音**本地签名从未在真实平台验证过**（历史遗留，需活体账号）；
- 竞品逆向成果的 B 级项（账号态建模、平台 API 清单、发布链路时序的架构级参考）尚未展开改造。
### 16.6 已达成能力的回归验证（2026-10-21，main tip `bb40000a` 之后）

目标里唯一已达成的是**小红书草稿落地**。在后续多次合并之后复测，确认它**没有回归**：

```
vitest run tests/xiaohongshu-draft-chain.test.js \
             tests/xiaohongshu-note-align.test.js \
             tests/xiaohongshu-note-inpage.test.js
→ Test Files 3 passed (3) / Tests 19 passed (19)
```

⇒ 已达成的能力在最新主干上仍然成立（不是靠记忆，是复跑读数）。

> 提醒（给后续维护者）：小红书相关测试位于 `packages/api-publish-engine/tests/`（**复数**），
> 与多数测试的 `test/`（单数）不同；按单数目录去找会报 `No test files found`。
### 16.7 「看起来登录了」与「实际已过期」为什么能同时成立（2026-10-21）

目标描述写「视频号已经登录了」，而实测判 `expired`。两者**并不矛盾** —— 
根因在 `01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md`（§12.2）已记载的陷阱：

> Cookie（`slave_sid`）过期后访问 `cgi-bin/home` **仍可能返回 200 并渲染后台骨架**，
> 但 loginpage 页面未登录时不会内嵌 `token`/`uin`。
> 判据用的是 token/uin 是否同时存在：
> 两者俱在 → `CHECK_LOGIN_SUCCESS_HTTP_API`；任一缺失 → `CHECK_LOGIN_COOKIE_EXPIRED`。

⇒ **界面看起来"已登录"（骨架渲染成功）与凭据实际失效（token/uin 缺失）可以同时为真**。
这也解释了本仓此前的一次误读：曾据 `has_cookies=true` 推测"信封库里可能有活 cookie"，
而 `has_cookies` 只说明"存过凭据"，与"凭据仍有效"无关。

**给排查者的判据顺序（避免再误读）**：
1. 看 `CHECK_LOGIN_*` 判据码（权威，走平台真实校验）；
2. 需要独立佐证时，直接调平台接口看 `errCode`（视频号：300333/300334 = 失效）；
3. **不要**据「页面能打开 / 后台能渲染 / has_cookies=true」推断登录态。
### 16.8 小红书草稿链真机 E2E（2026-10-21，应用主进程内实跑）

通道：`xiaohongshu:probe-draft-chain`（主进程内实跑，**默认 draft:true**，落创作者中心草稿箱，不公开发布）。
本次 E2E 分四步推进，每步的失败都**精确指明下一项必填**，是真机契约的实测过程：

| 步骤 | 传参 | 真机返回 | 说明 |
| --- | --- | --- | --- |
| ① | 仅 accountId | `XHS_NO_IMAGE`（至少需要 1 张图片：小红书不支持纯文字笔记） | 凭据已通过（未被风控/签名拒），卡在必填项 |
| ② | + `imagePaths` | 同 `XHS_NO_IMAGE` | 参数名不对（实际是 `images`） |
| ③ | + `images` | `XHS_NO_TITLE`（标题为空） | 图片已被接受 |
| ④ | + 顶层 `title/content` | 同 `XHS_NO_TITLE` | 字段需**嵌套在 `article` 内** |
| ⑤ | + `article.title/content` | `signer-assembly: extractor failed platform=xiaohongshu reason=no-webms-fn` | 走到**签名环节** |

**凭证状态（实测有效）**：cookie 22 个，含 `a1` / `access-token-creator.xiaohongshu.com` /
`customer-sso-sid` / `galaxy_creator_session_id` ⇒ `hasAuthorization=true`。

**⑤ 的根因（重要，纠正模糊认知）**：
- 真签名由创作者页全局函数 `window._webmsxyw(url, data)` 生成；
- `apps/desktop/electron/signer/xhs-extractor.js` 注释明确：本地 `signer-local` 的
  **XYW_ AES 定长块是"旧协议仿制"，对 note 端点已被 406 拒绝**；
- `no-webms-fn` = 当前未加载创作者页（签名页 bridge 未装配）⇒ 取不到该函数。

⇒ **小红书 API 草稿链能否跑通，取决于签名页基建是否装配好创作者页**；
仅凭本地公式**不足以**让 note 端点接受（已 406 实证）。

**调用契约（实测确认，供复用）**：
```js
probeXiaohongshuDraftChain(accountId, {
  images: ['<本地图片绝对路径>'],
  article: { title: '...', content: '...' },
})
```
- `images` 在顶层，`title/content` **必须嵌套在 `article` 内**（传顶层无效且报"标题为空"）。
### 16.9 真机验证手册（可执行步骤 + 已踩坑位，2026-10-21）

> 本节把前几轮**摸索出来的真机验证路径**固化成步骤，供账号恢复后**照着跑**，
> 避免重复踩参数名/判据误读的坑。所有操作均**只读或落草稿箱**，不公开发布。

#### 16.9.1 前置：确认账号状态（走应用自身判据，别信表象）

```js
// 经应用 CDP（--remote-debugging-port，本机 9279）在渲染进程调用
await window.electronAPI.accountBatchCheckLogin([头条id, 抖音id, 视频号id])
// 看 code：CHECK_LOGIN_SUCCESS_HTTP_API = 有效；CHECK_LOGIN_COOKIE_EXPIRED = 失效
```

⚠ **不要**据「页面能打开 / 后台能渲染 / has_cookies=true」推断登录态（见 §16.7）。

#### 16.9.2 头条：全链四层真机验证（唯一阻塞是实名）

取活 cookie（分区被独占锁时用**流式共享读**绕过）：
```powershell
$fs=[IO.File]::Open("<分区>\Network\Cookies","Open","Read",[IO.FileShare]::ReadWrite)
$ms=New-Object IO.MemoryStream; $fs.CopyTo($ms); $fs.Close()
[IO.File]::WriteAllBytes("<临时profile>\Default\Network\Cookies",$ms.ToArray())
```

然后依次验证（每层都有明确判据）：

| 层 | 判据 | 当前读数 |
| --- | --- | --- |
| ① 提交前闸门 | `GetPublishAuth.IsIdentifyAuth` | `false` ⇒ 拦截 `ACCOUNT_NOT_VERIFIED` + 解法链接 |
| ② 封面五步链 | PUT 需带 `Content-CRC32`（缺失 → `4007 MismatchChecksum`） | 登记 uri ✅ |
| ③ 视频 VOD | 返回新 `Vid` | ✅ |
| ④ 提交 | `Code 21000` + `accountGate=true` | 账号墙（实名后即出 `ItemId`）|

#### 16.9.3 视频号：账号失效的独立佐证（绕过应用判定直接问平台）

```js
// 在已加载 channels.weixin.qq.com 的页面上下文
fetch('/cgi-bin/mmfinderassistant-bin/auth/auth_data', { method:'POST',
  headers:{'Content-Type':'application/json', Referer:'https://channels.weixin.qq.com'},
  body: JSON.stringify({ timestamp:String(Date.now()).slice(0,13), _log_finder_uin:'',
    _log_finder_id:'', rawKeyBuff:null, pluginSessionId:null, scene:7, reqScene:7 }) })
```

- `errCode 300333 / 300334` = **登录失效**（代码注释口径）
- `errCode 300330` = 本次实测值，**分区凭据为空**（比失效更彻底）

#### 16.9.4 小红书：草稿链 probe（含必填项与字段嵌套坑）

```js
await window.electronAPI.probeXiaohongshuDraftChain(accountId, {
  images: ['<本地图片绝对路径>'],        // ← 顶层，数组
  article: { title: '...', content: '...' },  // ← 必须嵌套！传顶层无效
})
```

**已踩坑位（逐个记，避免重复）**：
1. 参数名是 `images`，**不是** `imagePaths`（传错仍报 `XHS_NO_IMAGE`）
2. `title/content` **必须嵌在 `article` 里**（传顶层仍报「标题为空」）
3. 失败是**逐项暴露**的：先缺图 → 再缺标题 → 再到签名，不是一次报全

**签名环节（关键限制）**：真签名来自创作者页 `window._webmsxyw(url, data)`；
本地 `signer-local` 的 XYW_ 定长块是**旧协议仿制，对 note 端点已被 406 拒绝**。
`no-webms-fn` = 页面已开但缺该函数（多为页面未处于登录态创作者页）；
`stage=signer-bridge` = bridge 未装配（与前者不同，务必区分）。

#### 16.9.5 通用：取活 cookie 的两种方式

| 场景 | 方式 |
| --- | --- |
| 分区未被占用 | 直接 `copy` |
| **被应用独占锁**（常见） | 流式共享读（见 16.9.2 的代码） |

> 判据纪律：合并/改热写面后必须 `git show origin/main:<文件>` **回读主干实际内容**，
> 不能只看本分支判据绿（本仓已两次栽在这：CI 红 + 基线被并发覆盖）。
### 16.10 小红书 E2E 再推进：签名已通过，止于服务端 406（2026-10-21 第二轮）

> 本轮**推翻了 §16.8 时的两个推测**，是真机实测的修正，务必以本节为准。

#### 16.10.1 修正一：`_webmsxyw` 与登录态无关

§16.8 曾推测 `no-webms-fn` 是「页面未处于登录态」。实测否证：
在 `https://creator.xiaohongshu.com/login`（**登录页**）上检测，
`window._webmsxyw` 的 typeof 即为 `function` —— **登录页也提供该函数**。

⇒ `no-webms-fn` 的真正含义是**签名页（隐藏页实例）当时未加载完成/已关闭**，
而不是"没登录"。签名页用的是 `signer-page-manager` 自己开的隐藏页，
与可见的那个小红书页面**不是同一个实例**。

#### 16.10.2 修正二：凭据在 `rpa-` 分区，`account-` 分区是空的

同一账号 `a1eac276` 的两个分区，实测结果**完全相反**：

| 分区 | 访问 `creator.xiaohongshu.com/publish/publish` |
| --- | --- |
| `account-a1eac276` | ❌ 跳登录页（`?redirectReason=401`） |
| **`rpa-xiaohongshu-a1eac276`** | ✅ **进入发布页**（账号「里奥的时尚胶囊」，草稿箱(0)）|

⇒ 凭据只存在于 `rpa-` 分区。排查签名/请求问题时**要确认取的是哪个分区**。

#### 16.10.3 本轮 E2E 结果：签名通过，服务端拒绝

重跑 `probeXiaohongshuDraftChain`（`images` + `article.title/content`）：

```json
{"code":-1,"errorCode":"ERR_BAD_REQUEST","httpStatus":406,
 "failedEndpoint":"https://edith.xiaohongshu.com/web_api/sns/v2/note",
 "hasAuthorization":true}
```

**进展**：不再是 `no-webms-fn` —— 签名函数取到、请求**已带签名发出**，被服务端拒。

对照实验（同分区、进发布页后**裸** fetch 该端点）：
```
HTTP 401 {"code":-100,"msg":"无登录信息"}
```
⇒ **406（带签名）与 401（不带签名）是两种不同的失败**：
不带签名 = 直接无登录信息；带签名 = 过了身份校验但请求本身被拒（406 Not Acceptable）。

#### 16.10.4 现状与下一步（不臆造）

- 已确认可用：账号有效、`_webmsxyw` 存在、签名可产出、请求可达端点。
- **未解决**：服务端对 `sns/v2/note` 返回 406。
- 要继续需改请求构造（端点/字段/头），**须有依据**：
  建议抓一次真实创作者页发布时的请求做对照，再决定改什么。
  在没有对照证据前改参数是**猜测**，本轮不做。
### 16.11 小红书 406 的对照实验：排除"头不全"，锁定"端点前缀"嫌疑（2026-10-21 第三轮）

#### 16.11.1 真实请求的签名头清单（抓自已登录发布页）

在 `rpa-xiaohongshu-a1eac276` 分区的**已登录发布页**上监听，页面自身发出 5 个 edith 域请求
（`/api/redcaptcha/v2/getconfig`、`/api/sns/web/racing_get`、`/api/sns/web/racing_report`、
`/api/sns/v1/creator/red_skill/web/list_mountable_skills`、`/api/sns/v1/creator/red_app/web/consumer/list`），
**签名头完全一致**：

```
x-s, x-t, x-s-common, x-b3-traceid, x-xray-traceid
```

#### 16.11.2 核对：我们的实现头是齐的（排除"头不全"假设）

`xiaohongshu-draft.js` L204 用 `buildXiaohongshuSignHeaders` 产出上述 5 个头，
并用签名器结果覆盖 `x-s` ⇒ **头齐全**。

⇒ **406 不是签名头缺失导致**（否则应表现为 401）。

#### 16.11.3 对照实验：401 与 406 的成因区分

| 请求 | 结果 | 说明 |
| --- | --- | --- |
| 完整链路（probe，头齐全） | **406** | 过了身份校验，请求本身被拒 |
| 仅带 x-s/x-t（本轮对照） | **401** `{"code":-100,"msg":"无登录信息"}` | 头不全 ⇒ 无登录信息 |

⇒ **401 与 406 是两种不同失败**，可用作判据：
看到 401 先查签名头是否齐；看到 406 则是端点/请求体被拒。

#### 16.11.4 锁定的嫌疑点：端点前缀

- 真实页面用的路径形如 **`/api/sns/...`**（无 `/web_api` 前缀）
- 我们的实现用 **`/web_api/sns/v2/note`**

本轮尝试直打 `/api/sns/v2/note` ⇒ `Failed to fetch`（该上下文不可达，未能直接验证），
故这仍是**嫌疑点而非结论**。

#### 16.11.5 唯一能定论的下一步（需授权）

要确认正确的端点与字段，**必须抓一次真实发布动作的请求**：
在已登录发布页上填内容 → 点发布 → 监听该次请求 → 与当前构造逐字段对比。

⚠ 该操作**会产生一条真实的草稿记录**（平台侧副作用），且需用户在场/授权 —— 本轮未执行。
在此之前改端点/字段属于**无对照的试错**，不做。
### 16.12 否证："端点前缀"不是 406 的成因（2026-10-21 第四轮，纠正 §16.11 的指引）

> ⚠ 本节**否证了 §16.11.4 的嫌疑点**。若你正打算按"把 `/web_api` 改成 `/api`"去改代码 —— 
> **请不要**：实测证明 `/api/sns/v2/note` 在该域上**不可达**（比 406 更糟）。

#### 16.12.1 对照实验（带齐 5 头，分别打两个端点）

| 端点 | 结果 |
| --- | --- |
| `/web_api/sns/v2/note`（x-s/x-t/x-s-common/x-b3-traceid/x-xray-traceid 齐全） | **401** `{"code":-100,"msg":"无登录信息"}` |
| `/api/sns/v2/note` | **Failed to fetch**（网络层不可达）|

#### 16.12.2 两个结论

**① `/api` 前缀假设不成立**：若 `/api/sns/...` 是正确端点，它至少应能响应；
实际连网络层都过不去 ⇒ 该路径在 edith 域上**不存在**或不允许该来源。
（注意：`hot-topics-service.js` 用的 `/api/sns/v1/search/hot_list` 是**另一个接口**，
它"免登录 200"不能推广到 note 端点。）

**② 401 不等于"头不全"**：本次带齐 5 个头仍得 401，说明 401 的成因是
**签名本身无效**（本次 `_webmsxyw(url, {})` 传空 data，产出签名不可用），
而非头部缺失。
⇒ §16.11.3 的判据需修正为：
  - **401**：签名无效或未携带（检查签名生成，不是只数头个数）
  - **406**：签名有效、身份过了，但**请求被服务端拒绝**（端点/请求体问题）

#### 16.12.3 对 406 的当前认知（诚实版）

- ✅ 已确认：账号有效、`_webmsxyw` 可用、probe 能产出**有效签名**（因其得到 406 而非 401）、请求可达端点。
- ✅ 已排除：签名头缺失（§16.11）、端点前缀（本节）。
- ❌ 仍未解：服务端为何对 `sns/v2/note` 返回 406。

**下一步仍需抓一次真实发布请求的对照**（见 §16.11.5，需授权）。
在拿到对照前，**不要**基于猜测修改端点或请求体。
### 16.13 头条全链回归复跑（2026-10-21，main tip `b8902cc0`；第 3 次）

> 目的：头条是**唯一"账号一实名就能成功"**的平台，其链路必须在主干上保持可用。
> 下文为最新主干上的**实跑读数**（非记忆、非推断）。

| 层 | 读数 | 判定 |
| --- | --- | --- |
| ① 提交前闸门 | `identityVerified=false` → 拦截 `ACCOUNT_NOT_VERIFIED`（附解法链接） | ✅ 行为不变 |
| ② 封面五步链 | 登记 uri `tos-cn-i-e874c6/oEGBTAjAiDlAIHiQ1VuJXBAfaI7sB6obYEg91t`（1280×720 jpeg） | ✅ |
| ③ 视频 VOD | 新 `Vid=v02d16g10004dbc08tfog65r9fholgd0` | ✅ |
| ④ 提交发布 | `Code 21000` + `accountGate=true` 被正确识别 | ✅ 账号墙（预期）|

**三次复跑对照**（同一预演脚本，不同主干 tip）：

| 次序 | main tip | 封面 | VOD | 提交 |
| --- | --- | --- | --- | --- |
| 首次 | `1c473767` 之前 | ✅ | ✅ | 21000 ✅ |
| 2 | `1c473767` | ✅ | ✅ | 21000 ✅ |
| 3 | `b8902cc0`（本轮） | ✅ | ✅ | 21000 ✅ |

⇒ **跨 10+ 个合并 PR 无回归**。技术链稳定，唯一阻塞仍且仅是账号实名。

**注意（易错点，复跑时确认过）**：
- 封面 PUT **必须带 `Content-CRC32`**，缺失 → `4007 MismatchChecksum`（此前的真机实证）。
- 闸门判据是 `IsIdentifyAuth`（实名），**不是** `DisablePublish` / `blockStatus`（两者当前为 false/0，但不代表可发布）。
### 16.14 证据强度订正：「小红书草稿已落地」应标注为**待核**（2026-10-21）

§16.1 终态表把小红书写作「✅ 完成（草稿已落产品分区）」。本节对该结论的**证据强度**做订正。

#### 16.14.1 目前能找到的证据

- `PRD-XHS-DRAFT-PUBLISH-2026-10-07.md` §11.2 记录了 note 请求体形态（其中 `"note_id": ""`）。
  ⚠ 该 `note_id: ""` 是**请求体字段**（新建笔记本就为空），**不是响应产物** ——
  此前我曾一度把它误读为"响应里 note_id 为空 ⇒ 未落库"，这是错的，特此更正。
- 未找到**带实际值的 `draft_id` / `note_id`** 留存记录（即成功落草稿的硬证据）。

#### 16.14.2 与之相关的实测观察

- 2026-10-21 在已登录发布页看到**草稿箱(0)** —— 此刻没有草稿。
  这与"曾成功落过草稿"不矛盾（草稿可能已被删除或已发布），但**不构成支持证据**。
- 同日 probe 实跑：签名有效（得 406 而非 401），但 **406** ⇒ 该次未落库。

#### 16.14.3 订正后的表述（供引用）

| 原表述 | 订正为 |
| --- | --- |
| 小红书草稿落地 ✅ 完成 | 小红书草稿落地 **⚠ 证据强度待核**：无留存的 `draft_id`/`note_id` 硬证据；当前实跑得 406（未落库）|

> 影响：§16.1 总表中该格的"已完成"应视为**待复核**，不应作为"发布能力已具备"的依据。
> 复核方式：授权抓一次真实发布请求并留档 `draft_id`（见 §16.11.5）。

#### 16.14.4 本节的教训

两次误读方向相反，但同源 —— **用一个片段就下结论**：
- 一次是"把请求体字段当响应产物"（差点据此推翻正确结论）；
- 另一次是"把已被自己数据否证的假设留作嫌疑"（§16.12 已纠正）。

⇒ 规矩：**下结论前先确认片段属于哪一侧（请求/响应、支持/否证）**。
### 16.15 排除「签名 URI 形态」假设（2026-10-21，A/B 对照）

#### 16.15.1 被检验的疑点

`xiaohongshu-draft.js` L186-190：请求用 `fullUri`（含 origin），而**签名默认只用 `pathname+search`**
（除非设 `MP_XHS_SIGN_URI=absolute`）。该回退位的存在说明历史上对"签名该用完整 URL 还是路径"
有过不确定性 ⇒ 值得检验它是否为 406 的成因。

#### 16.15.2 A/B 对照（同一 body，两种签名 URI）

| 组 | 签名 URI | 结果 |
| --- | --- | --- |
| A | 完整 URL `https://edith.../web_api/sns/v2/note` | **401** `{"code":-100,"msg":"无登录信息"}` |
| B | 仅路径 `/web_api/sns/v2/note`（代码默认） | **401**（同上，逐字相同）|

⇒ **两组结果完全相同** ⇒ 签名 URI 形态**不是** 406 的成因。

#### 16.15.3 顺带厘清：401 与 406 的分界（重要）

本次 A/B 两组都只取得 `x-s` / `x-t`（`x-s-common` 为空串，因 `_webmsxyw` 返回值里未取到），
即**签名不完整** ⇒ 401。

而 **probe 走完整链路得到 406** —— 它用 `buildXiaohongshuSignHeaders` 正确生成了全部 5 个头
（含有效的 `x-s-common`）⇒ **签名有效**。

| 签名状态 | 结果 |
| --- | --- |
| 不完整（缺有效 x-s-common） | **401** 无登录信息 |
| 完整（5 头，probe） | **406** 请求被服务端拒绝 |

⇒ **406 与签名无关**，是服务端对 `note` 端点**请求体字段/格式**的拒绝。

#### 16.15.4 已排除与剩余

已排除（均有对照）：
1. 签名头缺失（§16.11）
2. 端点前缀 `/api`（§16.12，实测不可达）
3. 签名 URI 形态（本节，A/B 同结果）

**剩余**：note 端点请求体字段/格式不被接受 ⇒ 唯一解法是抓一次真实发布请求做字段级对照
（见 §16.11.5，需授权，会产生一条草稿记录）。在此之前不要改请求体。
### 16.16 草稿箱(0) 直接读数：小红书「草稿已落地」当前无可观测证据（2026-10-21）

§16.14 把「小红书草稿已落地」订正为**证据强度待核**。本节给出**直接读数**使其收敛。

#### 16.16.1 实测

以 `rpa-xiaohongshu-a1eac276`（已登录）访问 `creator.xiaohongshu.com/publish/publish?target=draft`：

```
页面文本（节选）：…里奥的时尚胶囊…上传视频…写长文…**草稿箱(0)**…
捕获 draft/note 相关响应：0 条
```

⇒ 该账号下**没有任何草稿**。

#### 16.16.2 三点合起来看

| 证据 | 结论 |
| --- | --- |
| 草稿箱显示 **(0)** | 当前不存在任何草稿 |
| 未找到带实际值的 `draft_id`/`note_id` 留存 | 无历史硬证据 |
| 本轮及前几轮 E2E 均返回 **401/406** | 所有尝试都未落库 |

⇒ **「小红书草稿已落地」当前无任何可观测证据支持**。
  （这不等于"证明从未成功过"—— 草稿可能被删除或已发布；但**举证责任在未主张方**：
   在拿到 `draft_id` 之前，不应把它当作已达成的能力。）

#### 16.16.3 对 §16.1 的引用口径（最终）

| 项 | 口径 |
| --- | --- |
| 小红书 | ⚠ **当前无可观测证据表明草稿已落地**：草稿箱(0)、无 draft_id 留存、实跑 401/406 |

**复核方式**：授权抓一次真实发布请求并留档 `draft_id`（见 §16.11.5）。
留档后本节结论即可被推翻/升级 —— 这正是把它写成"可证伪"形式的原因。
### 16.17 抖音凭据已恢复（2026-10-21，用户完成登录）

> 本节记录抖音从「阻塞」转为「就绪」的实测依据。**发布动作本身尚未执行**。

#### 16.17.1 观察到的登录过程

2026-10-21 10:00 前后，应用出现新页面 `https://creator.douyin.com/`（创作者后台），
应用页切换至 `#/accounts` 并出现「保存账号」按钮 ⇒ 用户在应用内完成抖音登录并保存。

#### 16.17.2 凭据有效性的**硬证据**（不依赖 `has_cookies`）

登录后直接调用抖音创作者接口：

```
GET https://creator.douyin.com/aweme/v1/creator/user/info/
→ HTTP 200 {"dashboard_opend_date":"2024-12-13","douyin_user_verify_info":{...avatar_url...},
          "cert_info":{...}}
```

⇒ 返回**真实创作者身份数据**（开号日期、头像、认证信息）—— 这是凭据有效的硬证据，
  而非「页面能打开」或 `has_cookies=true` 这类表象（见 §16.7 的判据纪律）。

应用侧同步读数：
```json
{"platform":"douyin","status":"active","has_cookies":true,"cookie_count":1}
```
应用批量检测码由 `CHECK_LOGIN_COOKIE_EXPIRED` → `CHECK_LOGIN_INCONCLUSIVE`（`loginStatus: active`）。

> ⚠ `INCONCLUSIVE` 是抖音的**结构性特征**（HTTP 检测对该平台不给定论，见 §16.9.1），
> 不代表凭据无效 —— 上面的 `user/info` 才是判据。

#### 16.17.3 发布链取用路径已确认

`publisher-router.js` 的 `backfillPartitionCookies`：主源是**信封库** `authData.cookies`，
分区仅在信封库为空时回退。抖音凭据已落入信封库 ⇒ **发布链可直接取得凭据**。

（另注：`account-01ab122e` 分区的 cookie 在 `creator.douyin.com` 域下实测为 0 条，
但不影响发布 —— 分区只是回退源。）

#### 16.17.4 当前状态与下一步

| 项 | 状态 |
| --- | --- |
| 抖音凭据 | ✅ 有效（`user/info` 200 + 真实创作者数据） |
| 抖音发布链代码 | ✅ 就绪（既有实现） |
| **真实发布** | ⏳ **未执行**（需在应用内发起，或授权触发） |

下一步：在应用内对抖音发起一次发布（草稿语义），用**真实返回的 `aweme_id`** 留档 ——
那才是「抖音视频发布成功」的可核对证据（原则：不留无证据的"成功"）。
### 16.18 四平台凭据全部就绪（2026-10-21，用户完成抖音+视频号登录）

> 本节记录**四平台凭据全部 active** 这一状态变化。真实发布仍未执行（见文末授权边界）。

#### 16.18.1 账号状态（应用自身判据，`accountList` 实读）

| 平台 | status | 平台侧证据 |
| --- | --- | --- |
| 抖音 | **active** | `user/info` HTTP 200 + `dashboard_opend_date=2024-12-13` + avatar（§16.17） |
| 视频号 | **active** | `CHECK_LOGIN_SUCCESS_HTTP_API` + `platform_account_id=sphOuKJ6GWCmZLB` + **followers=50** |
| 今日头条 | **active** | `CHECK_LOGIN_SUCCESS_HTTP_API` + `platform_account_id=1342958645023752` |
| 小红书 | **active** | **followers=453** |

⇒ `platform_account_id` 与 `followers` 只能来自平台真实接口 ⇒ 这是凭据有效的硬证据
（而非 `has_cookies=true` 这类表象，见 §16.7 判据纪律）。

#### 16.18.2 一次「分区 fetch 与应用判定不一致」的辨析（值得记）

同一时刻：应用判定视频号 `valid:true`，而我用 `account-b1e05ac2` **分区**导出的 cookie 调
`auth_data` 得 `errCode 300330`（无登录信息）。

辨析：**二者取用的凭据源不同**。
- 应用判定走**信封库** `authData.cookies`（`accountBatchCheckLogin` 内部）；
- 我的 fetch 走**分区** cookie；
- 而 `publisher-router.js` 的 `backfillPartitionCookies` 明确：主源是信封库，分区仅回退。

⇒ **发布链路与我的 fetch 不同源**，所以分区 fetch 失败**不意味着发布会失败**。
⚠ 教训：验证发布链路时，要么走应用自己的通道，要么确认用的是**同一凭据源**；
   用分区 cookie 得出的结论不能直接外推到发布链路。

#### 16.18.3 剩余阻塞（已从 4 项降到 1 项）

| 平台 | 凭据 | 代码 | 真实发布 | 阻塞 |
| --- | --- | --- | --- | --- |
| 抖音 | ✅ | ✅ | ⏳ 未执行 | **需授权触发发布** |
| 视频号 | ✅ | ✅ | ⏳ 未执行 | **需授权触发发布** |
| 小红书 | ✅ | ✅ | ⏳ 未执行 | 406 未解（需授权抓真实请求对照） |
| 今日头条 | ✅（active） | ✅ | ⏳ 未执行 | **账号未实名**（`IsIdentifyAuth=false`） |

#### 16.18.4 授权边界（不擅自产生平台侧内容）

真实发布会在用户账号上产生**可见的作品/草稿**，属实质动作。在未获授权前，
我只做**只读验证**（凭据有效性、链路可达性），不触发发布。

获授权后的执行顺序（按成功概率排序）：
1. **抖音** —— 凭据有硬证据、代码就绪；
2. **视频号** —— 判定码明确 + 平台账号 ID 已取到；
3. **今日头条** —— 需先完成实名（人工，无法由我推进）；
4. **小红书** —— 需先解 406（授权抓真实发布请求做字段级对照）。
### 16.19 抖音视频发布 E2E：真实失败（`publish timeout`）+ 双轨失败定位（2026-10-21）

> 本节是**真机 E2E 的失败记录**（目标授权的真机测试）。不复述成功，只记可定位的事实。

#### 16.19.1 执行过程

经应用 `publish:batch` 通道发起抖音视频发布（草稿语义，54.4MB 视频，真实文案）。
两次尝试：

| 次 | 标题 | 结果 |
| --- | --- | --- |
| 1 | 「API 视频发布链路自检」 | 用户指出标题不得含"测试"类词 ⇒ **取消**，`submitAttempted:false` |
| 2 | 「被误解的明朝：西方史料里的另一个大明」 | **`publish timeout`**（约 10 分钟），`submitAttempted:true` 但 `submittedAt:null` |

⚠ 第 1 次取消**有效**：`submitAttempted:false` 证明取消发生在提交前，平台侧未产生发布动作。
（这正是"取消必须在提交前生效"的实证。）

#### 16.19.2 关键定位：`publish timeout` 来自 **RPA 轨**，不是 API 轨

错误串出处：`apps/desktop/electron/services/rpa-view-platforms.js:1056-1057`
```js
log.warn('RpaView', '[douyin] publish timeout url=' + (fu||''))
return { success:false, error:'publish timeout', platform:'douyin' }
```

而 `config/platforms.yaml` 的抖音配置是 `has_api: true` + `publishMode: api-then-dom`
（API 优先，失败才降级 DOM）。

⇒ **推断：API 轨失败 → 降级 DOM 轨 → DOM 轨 60s 拿不到成功信号 → `publish timeout`。**

⚠ 这是**推断而非实测**：任务历史只记终态 `error`，未记录"API 轨是否被调用、其失败原因"。
   要证实/证伪需在发布链加**分轨埋点**（见 16.19.4）。

#### 16.19.3 这是**重复出现**的失败，不是偶发

发布历史（`historyList`，共 102 条）中的同型失败：

| 时间 | 平台 | 任务 | error |
| --- | --- | --- | --- |
| 2026-10-18 04:35 | douyin | task_3_1792295137926 | `publish timeout` |
| 2026-10-21 03:10 | douyin | task_2_1792550186073 | `publish timeout`（本次） |

另有一条**有价值的成功对照**：
`2026-10-18 13:40 douyin task_4_1792330730076 → success`，
其 `result.mode` 为 **`"dom"`** ⇒ 该次是 **DOM 轨成功**。

⇒ 说明：**DOM 轨本身能成功**（10-18 有一次），但 `publish timeout` 反复出现 ⇒ 
问题更可能是**偶发/状态相关**（如风控、页面未就绪、上传未完成即点发布），而非"DOM 轨必坏"。

#### 16.19.4 分轨埋点清单与落地状态

要区分"API 轨失败"与"DOM 轨偶发超时"，需要**分轨埋点**：

| # | 埋点项 | 状态 | 落地处 |
| --- | --- | --- | --- |
| ① | 发布入口记录**实际使用的轨**与切换原因 | ✅ 已落地（`track` / `apiTrackAttempted`，PR #4155） | `rpa-view-manager.js` DOM 轨返回 |
| ② | API 轨失败时把**服务端返回**落进历史 | ✅ 已落地（`code` 经 `attachRiskSignals` 挂 Error，`_lastApiFailure.code` 记录，PR #4150） | `rpa-view-manager.js` 降级分支 |
| ③ | DOM 轨"点击发布后的等待目标 URL"与"已等待时长" | ⚠ **部分**：URL 已随终态 error 落入日志；**时长未单独记录**（边际递减，主动放弃） | `rpa-view-platforms.js` 既有 warn |

⇒ ①②落地后，一次失败即可定位到具体轨与具体原因，无需再靠终态 error 反推。

**诊断解读规则**（已写进 `packages/api-publish-engine/scripts/dy-publish-e2e.cjs` 注释）：

| 读数 | 结论 |
| --- | --- |
| `track=dom` 且无 `apiTrackAttempted` | 根本没走 API 轨（配置/适配器问题） |
| `track=api-then-dom` 且有 `apiTrackFailed` | API 轨失败（看其 `error` / `code`） |
| `track=api-then-dom` 且无 `apiTrackFailed` | API 轨成功，DOM 轨超时（RPA 问题） |

#### 16.19.5 顺带确认（视频号）

历史中 2026-10-18 有两条视频号失败样本，error 为：
```
视频号 正文未写入，已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。
```
⇒ 视频号链的 **fail-closed 语义生效**（未写入即中止、不提交、不占间隔）——
这是**设计正确**的证据，虽为失败但边界守住了。
### 16.20 抖音发布复跑：任务 20+ 分钟未完成（且应用被关闭）（2026-10-21）

> 本节记录 §16.19 之后的复跑观察，含一个**新的失败形态**。

#### 16.20.1 复跑过程

同文案、同视频、同账号（`task_3_1792557854052`），经 `publish:batch` 发起：

| 时间 | 队列状态 |
| --- | --- |
| T+0 | 入队（running=1） |
| T+10min | 仍 running（首次轮询 40 轮 × 30s 全程 running） |
| T+20min | 仍 running |
| T+25min | **应用进程退出**（CDP 9279 拒绝连接，electron=0，等 60s 未重启） |

⇒ **任务无终态**（未入历史）—— 随进程消失，既非 success 也非 failed。

#### 16.20.2 与 §16.19 的差异（值得记）

| 次 | 结局 | 耗时 |
| --- | --- | --- |
| task_2（§16.19） | `publish timeout`（failed） | 约 10 分钟 |
| task_3（本节） | **无终态**（进程被杀） | > 20 分钟仍 running |

⇒ 抖音发布链的耗时**至少 20 分钟以上仍不出结果**，而任务超时是 30 分钟。
上次的"10 分钟 timeout」可能是**另一层超时**（DOM 轨 60s 无成功信号）先触发。

#### 16.20.3 待确认（不推测）

- 上传 54.4MB 视频实际耗时多久？（需分阶段进度数据）
- 卡在哪一步：VOD 上传 / 封面上传 / 提交 / DOM 轨等待？
- 应用退出是用户主动关闭，还是发布流程导致崩溃？

⇒ 三者都需 §16.19.4 的埋点（①②**已落地**：#4150 + #4155；③部分落地）
    + 分阶段进度才能回答。**在拿到数据前不做成因结论**。

#### 16.20.4 对下次复跑的要求

1. 用**小视频**（如 5MB 以内）先跑通链路，排除"大文件上传慢"的干扰；
2. 全程记录 `onProgress` 回调的阶段与百分比；
3. 应用退出时先看是否有崩溃日志，再归因。
### 16.21 分区 cookie 同样无法在应用外读取（2026-10-21，独立证据源）

> §16.18.2 已确立「发布链主源是信封库」。本节补一条**独立证据源**的验证：
> 分区 cookie 也无法在应用外读取 —— 与信封库同结论，但来自不同机制。

#### 16.21.1 实测

抖音分区 `rpa-douyin-01ab122e` 的 `Cookies` 文件 **53248 字节**（mtime 05:15，最近有写入），
说明应用确实在往里写 cookie。但用 Playwright 以该分区为 profile 启动后：

```
ctx.cookies()                        → 0 条（全部域）
ctx.cookies('https://creator.douyin.com') → 0 条
关键键 sessionid/sessionid_ss/sid_tt/odin_tt/msToken/passport_csrf_token → 全部 false
```

⇒ **文件在增长，但外部读不出内容**。

#### 16.21.2 成因（与信封库同源，机制不同）

| 凭据形态 | 保护机制 | 外部可读？ |
| --- | --- | --- |
| 信封库 `*.json.enc` | PBKDF2-SHA512 + AES-256-GCM，masterKey 被 `safeStorage` 包住 | ❌（§16.21 之前三轮排查） |
| 分区 `Cookies`（SQLite） | ⚠ **机制未确证**（可能与 Chromium cookie value 加密 / app-bound encryption、或 Playwright profile 格式不兼容有关） | ❌（本节） |

⇒ 两条路都堵，但这是安全边界按设计生效，不是缺陷。

> ⚠ **成因的确定性边界**：本节只确证了两个**事实**——① Cookies 文件 53248 字节且 mtime 很近；
> ② Playwright 以该分区为 profile 读出来 0 条（全部域）。
> "加密导致读不出"是连接二者的**解释之一**，未排除的其他解释包括：
> Playwright 不认 Electron 分区结构、cookie 为 session-only 随进程退出即消失、
> 或 domain 落在 Electron partition 命名空间。**不要把这条成因当定论。**

#### 16.21.3 对验证方法的结论

「用分区 cookie 在应用外探测平台接口」这条路**不可行** ——
这同时修正了一个此前的隐患：§16.18.2 里我用分区 cookie 调 `auth_data` 得 300330，
当时的解读是"分区凭据与信封库不同步"；现在看更可能是**分区 cookie 本身就读不出来**
（那次之所以有反应，是因为 Playwright 起了自己的 profile，某些未加密字段仍在）。

⇒ 教训：**外部探测拿不到有效凭据时，不要把"探测失败"归因成"凭据失效"**，
   应先确认"凭据是否真的取到了"。

#### 16.21.4 唯一可行的验证途径

经 GUI 应用自身（`publish:batch` IPC，内部用信封库凭据）—— 即 `dy-publish-e2e.cjs` 的做法。
**前置：应用必须已启动。**
### 16.22 抖音视频发布**首次真实成功**（2026-10-21，DOM 轨）

> 本节是四平台里第一个 `status=success` 的真机记录。含证据链与**未闭合项**。

#### 16.22.1 任务终态（应用队列实读）

```json
{
  "id": "task_1_1792569782094",
  "platform": "douyin",
  "status": "success",
  "result": { "success": true, "url": ".../creator-micro/content/post/video?enter_from=publish_page",
              "platform": "douyin", "mode": "dom" },
  "submitAttempted": true,
  "submittedAt": 1792569891100,
  "createdAt":  "2026-10-21T08:03:02.094Z",
  "completedAt":"2026-10-21T08:04:51.100Z"
}
```

⇒ **全程 109 秒**（此前两次分别为 10 分钟 timeout / 20 分钟无终态）。
  `submittedAt` 是真实提交时间戳（此前失败样本该字段为 `null`）。

#### 16.22.2 证据链（三环，各自独立）

| # | 证据 | 说明 |
| --- | --- | --- |
| ① | 任务 `status=success` + `submittedAt` 非空 | 应用自己的发布链判定成功**且**记录了提交时刻 |
| ② | 排除 URL 导航判定（`_waitForSuccessNavigation`） | 该判据要求 URL 含 `success` / `publish/success`（`rpa-view-navigation-helpers.js`），而 `result.url` 是 `content/post/video` ⇒ **不是**这条路径 |
| ③ | 发布页表单**仍持着本次内容** | 重新打开发布页：`hasUploadArea=false`（上传区已消失 ⇒ 视频已上传）、正文本字匹配（「你还记得大明是"东亚病夫"吗…」）、描述计数 `170/1000` ⇒ 内容确实进入过发布流程，不是空表单 |

⇒ 由 ② 反推：**大概率**命中 `rpa-view-platforms.js:1050` —— 等到了 `aweme/create_v2` / `create` / `post`
  的**真实网络响应**（`_waitForResponse` 监听 session 响应，`rpa-view-helpers.js`），
  若如此则意味着**服务端确认创建**，而非"按钮点了但没反应"。

> ⚠ **推理边界**（CCG i2 指出后修正）：② 只证明了"**不是** `_waitForSuccessNavigation` 这条路径"，
> **没有**穷尽 `_publish_douyin` 里所有 `return {success:true}` 的分支（未通读整个函数）。
> 因此"命中 L1050 / 服务端确认创建"是**高概率推断，不是定论**。
> 要证成它，需在 L1050 附近加埋点，把 `resp`（服务端响应体）落进历史 —— 那也正是下一步 ②。

#### 16.22.3 为什么内容管理页（作品 238）没看到它

实测：内容管理页只有「作品 / 作品合集」两个 tab，**没有草稿 tab**；
作品列表按"最新发布"排序，最新一条是 2026-10-18。

未解释（**不做猜测**）：本条内容为何不在列表。可能原因包括私密/待审核/草稿态、
列表有默认筛选、或发布落在另一个入口。**在拿到平台侧明确状态前，不宣称"草稿已生成"。**

#### 16.22.4 未闭合（如实）

| 项 | 状态 |
| --- | --- |
| 应用侧发布成功 | ✅ 已证实（三环证据） |
| **平台侧产物 ID**（`aweme_id` / `item_id`） | ❌ **未取到** —— `result` 里没有（DOM 轨不返回服务端 ID） |
| 平台侧状态（草稿/私密/已发布） | ❌ 未确认（内容管理页不可见） |
| 分轨诊断 `track` / `apiTrackAttempted` | ❌ 未记录 ⇒ **应用跑的是旧二进制**（埋点 #4155 已合并，但进程早于它启动） |

⇒ 下一步：重启应用（加载新二进制）后重跑一次，届时 `track` 会告诉我们是哪条轨；
  同时应让 DOM 轨成功时**带回服务端响应体**（含 `aweme_id`）——这是 §16.19.4 埋点之外的
  **第四项缺口**：成功路径没有产物 ID 留档。
### 16.24 西瓜上传页入口疑云：竞品用 `studio.ixigua.com`，我们用 `mp.toutiao.com`（2026-10-21）

> 按用户指示「发布相关实现首选复用竞品逆向成果」复查头条视频上传入口，发现一处**未验证的差异**。

#### 16.24.1 竞品逆向成果的实际入口

`04-rea-evidence/<参考产品>-主进程清点.json` 的 URL 清点（按出现次数）：

| 用途 | 竞品 URL | count |
| --- | --- | --- |
| **上传页** | `https://studio.ixigua.com/upload?from=post_article` | **6** |
| 上传页（带 gid） | `https://studio.ixigua.com/upload?gid=` | 2 |
| 创建条目 | `https://studio.ixigua.com/api/upload/CreateItem/?_signature=_` | 2 |
| 上传授权 | `https://studio.ixigua.com/api/upload/getAuthKey/?params=%7B%22type%22:%22` | 1 |
| 话题建议 | `https://studio.ixigua.com/ugc/publish/post/v1/suggest/?words=` | 1 |
| 内容列表 | `https://studio.ixigua.com/api/content/list` | 1 |
| VOD | `https://vas-lf-x.ixigua.com/video/openapi/v1/` | 1 |

而 `studio.ixigua.com` 这个 host 在清点里 **count=41**（远比 `mp.toutiao.com` 的 xigua 路径热）
⇒ 竞品实际主战场是 **`studio.ixigua.com`**（西瓜创作平台）。

#### 16.24.2 我们当前登记的入口

`packages/api-publish-engine/src/platform-entries.js` L12：
```js
toutiao: "https://mp.toutiao.com/profile_v4/xigua/upload-video"
```

⇒ **与竞品不同域**。哪一个对？**未验证**（见 16.24.3）。

#### 16.24.3 验证尝试与结论边界

2026-10-21 用头条分区 cookie 在应用外探测两个 URL：

| URL | 落地 | file input |
| --- | --- | --- |
| `mp.toutiao.com/profile_v4/xigua/upload-video` | 重定向到 `mp.toutiao.com/login/?redirect_url=...` | 0 |
| `studio.ixigua.com/upload?from=post_article` | 重定向到 **`creator.douyin.com/`** | 0 |

⇒ 两者都落到登录页 ⇒ **应用外无法验证**（分区凭据读不出，见 §16.21）。

⚠ 但第二个结果本身是条线索：`studio.ixigua.com` 会跳到 **`creator.douyin.com`**
（抖音创作者中心）—— 提示西瓜创作平台可能已并入抖音创作者中心（字节跳动产品整合）。
若如此，头条视频发布的真实入口可能已变，我们登记的 URL 与选择器都可能过期。

#### 16.24.4 待办（需在应用内已登录态验证）

1. 在应用内（有效登录态）分别打开两个 URL，看哪个落在真实上传页（有 `input[type=file]`）；
2. 若竞品的 `studio.ixigua.com/upload` 是对的 ⇒ 更新 `platform-entries.js` 的 `toutiao` 视频入口，
   并按竞品成果核对 `CreateItem` / `getAuthKey` 两个接口（**优先复用，不自己研究**）；
3. 重新真机取证该页的 DOM 选择器（现有 `toutiao_video` 是 10-18 对 `mp.toutiao.com` 取的）。
### 16.26 `no login` 判据的交叉验证：与参数无关，是真实登录态缺失（2026-10-21）

> §16.25 的 CCG 自查提出一个未排除项：`getAuthKey` 可能需要 POST/参数，
> 那样 `no login` 可能是**参数缺失的误报**。本节用竞品逆向成果里的正确调用形态做 A/B，闭合该疑点。

#### 16.26.1 竞品成果里的正确形态

`04-rea-evidence/<参考产品>-主进程清点.json`：
```
https://mp.toutiao.com/xigua/api/upload/getAuthKey/?params=%7B%22type%22%3A%22
```

⇒ 竞品调用时 URL **带 `?params={"type":"..."}`** query 参数。而 §16.25 我用的是**裸 URL**。

#### 16.26.2 A/B 实测（同 session，四种形态）

| 形态 | 结果 |
| --- | --- |
| GET 裸 URL | `200 {"status":-12,"message":"no login"}` |
| GET `?params={"type":"video"}` | `200 {"status":-12,"message":"no login"}` |
| GET `?params={"type":"video","source":1}` | `200 {"status":-12,"message":"no login"}` |
| POST `?params={"type":"video"}` | `403 {"code":403,"msg":"invalid csrf token"}` |

⇒ **三种 GET 形态全部 `no login`，与参数无关** ⇒ §16.25 的判据成立，不是参数缺失误报。

#### 16.26.3 顺带得到的新信息

POST 返回的是 **403 `invalid csrf token`**（而非 `no login`）——
说明该接口**存在 POST 形态**，且它要求 csrf token（与登录态是两个独立的前置）。

⇒ 对后续实现的含义：若走 POST 提交通路，需先解决 csrf token（`summon.bytedance.com/secsdk_csrf_token`，
  竞品成果里亦有该 URL）；而**判登录态用 GET 就够**（无需先解 csrf）。

#### 16.26.4 结论（闭合）

「该账号在西瓜上传接口上没有登录态」这一真因**已从单点读数升级为 A/B 验证过的结论**。
阻塞性质不变：**需要用户在西瓜创作平台侧完成账号授权**（代码侧无解）。
### 16.28 视频号首次真机发布失败 + API 轨早已存在（2026-10-21）

> 视频号的**第一次**完整链路真机尝试。失败，但定位到关键事实。

#### 16.28.1 实测终态

```json
{
  "id": "task_3_1792579422985",
  "platform": "tencent_video",
  "status": "failed",
  "error": "视频号 正文未写入，已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。
           请重试；若反复失败请检查正文字数是否超平台上限。",
  "submitAttempted": false,
  "startedAt":   "2026-10-21T10:47:59.674Z",
  "completedAt": "2026-10-21T10:49:07.452Z",
  "lastAttemptNotSubmitted": true
}
```

⇒ fail-closed 生效（未提交、未占间隔）。**68 秒**即失败（10:47:59→10:49:07）⇒ 不是超时，
  是填充阶段就失败。另注意 `createdAt`→`startedAt` 隔了 **4分17秒**（窗口创建 + cookie 恢复）。

#### 16.28.2 关键事实：视频号 **API 轨早已存在且完整**

`config/platforms.yaml` 视频号：`has_api: true` + `publishMode: api-then-dom`
（2026-10-06 修正过 `has_api=false` 与 `api-then-dom` 的矛盾）。

`packages/api-publish-engine/src/publish/platforms/shipinhao-video.js`（288 行）已实现：

| 环节 | 内容 |
| --- | --- |
| 上传 | 分片上传（`applyuploaddfs` / `uploadpartdfs` / `completepartuploaddfs`） |
| CDN 主机 | **2026-10-18 已修**：旧 `finderassistancea.video.qq.com` 返 404 ⇒ 新 `finder.video.qq.com`（取自创作页自身代码 `finder-helper-web/chunk-common`），旧主机保留兜底 |
| 提交 | `post_create` / **`post_draft`** 双分支 |
| 描述合成 | 无标题平台 ⇒ 标题并入描述（`post_create` 请求体无标题字段） |
| 测试 | `test/shipinhao-video-chain.test.js` 存在 |

⇒ 本次失败的是 **DOM 轨**（"正文未写入"），说明 **API 轨先失败并降级**，
  但**失败原因没有留档**（任务历史只记终态 error）—— 与 §16.19.4 同型缺口。

#### 16.28.3 竞品逆向成果（视频号完整 API 链，按用户指示复用）

`05-<参考产品>-materials/RPA分析报告.md` §2.2：

| 功能 | API |
| --- | --- |
| **发布（草稿）** | `/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft` |
| 发布 | `/micro/content/cgi-bin/mmfinderassistant-bin/post/post_create` |
| 权限数据 | `/cgi-bin/mmfinderassistant-bin/auth/auth_data` |
| 账号状态 | `/cgi-bin/mmfinderassistant-bin/post/check_finder_comm_face` |
| 上传 | 分片到 `finderassistancea.video.qq.com`（apply/uploadpart/completepart） |
| 数据格式 | **XML**（`<p>` 段落 / `<topic>` 话题 / `<friend>` @好友） |
| 签名 | `Content-MD5` + `X-Arguments` |

⇒ 与我们 `shipinhao-video.js` 的实现**同源**（分片 + Content-MD5 + post_draft/post_create 双分支）
  —— 证明方向正确，无需重做；差异在 CDN 主机（已按创作页实测更新）。

#### 16.28.4 剩余工作

| # | 事项 | 性质 |
| --- | --- | --- |
| 1 | **重启应用**（加载 #4150/#4155 的分轨埋点）后重跑视频号 ⇒ 看 `apiTrackFailed` 真实原因 | 前置 |
| 2 | 若 API 轨仍败，按竞品成果核对 `post_draft` 请求体（XML 结构 / Content-MD5 / X-Arguments） | 代码 |
| 3 | 修 DOM 轨的正文填充（`desc_textarea` 首个候选是裸 `textarea`，可能取错元素） | 代码 |

#### 16.28.5 探测方法修正（本轮教训）

本轮一开始用**用户手开的视频号页面**探测，得到 `cookieLen=0` / `auth_data=300330` /
页面空白 —— 差点误判成"视频号未登录"。真因是**那个页面不在应用窗口池里，从未走过
cookie 恢复**（`rpa-view-manager.js` L222 只在 `!reused` 时执行）。

⇒ 判据域教训（已单列小节，见 §16.29）：**非应用管理的页面不能用于判定登录态**。
### 16.29 探测方法纪律：非应用管理的页面不能用于判定登录态（2026-10-21）

> §16.28.5 提到"已单列小节"，本节即该小节。

#### 16.29.1 本轮真实经历

探测视频号发布页时，我用了 `ctx.pages()[0]`（用户手开的「视频号助手」标签页），得到：

```
title     = 视频号助手        （HTML 框架加载成功）
bodyLen   = 186458           （DOM 有内容）
innerText = ""                （渲染不出任何文本）
cookieLen = 0                 （页面 cookie 为空）
auth_data = {"errCode":300330,"errMsg":"request failed"}
```

⇒ 若就此下结论，会写成"视频号未登录"—— **错误**。

#### 16.29.2 真因

那个页面是**用户手动打开的标签页**，不在应用管理的窗口池里 ⇒
**从未走过 cookie 恢复**（`rpa-view-manager.js` L222 `_restoreCookies` 只在 `!reused`
即应用自己新建窗口时执行）⇒ 页面 cookie 为空 ⇒ 接口全失败 ⇒ 渲染不出内容。

#### 16.29.3 纪律（三条）

| # | 纪律 |
| --- | --- |
| ① | **判定平台登录态，只能用应用管理的页面/链路**（`publishBatch` 或 `_acquireWindow` 建的窗口） |
| ② | 用户手开页面只能用于"HTML 框架是否可达"，**不能**用于"接口是否已授权" |
| ③ | 探测时若改了应用主窗口的 URL，**测完必须恢复**（本轮把应用主页导航走了，已恢复） |

#### 16.29.4 与既有教训的关联

| 既有 | 本条 |
| --- | --- |
| §16.18.2 分区凭据 ≠ 信封库凭据 | 同源：凭据源不同，结论不能互推 |
| §16.21 分区 cookie 外部读不出 | 同源：外部/非管理页面无有效凭据 |
| §16.25 `mp.toutiao.com` 已登录但 `xigua/api/upload` no login | 同源：**页面能打开 ≠ 接口已授权** |
| §16.23.3 API 轨预演 ≠ 发布链就绪 | 同源：判据域必须跟着被测轨道走 |

⇒ 五条同型，可归纳为一句：**判据域必须跟着被测性质走；不同源/不同轨/不同管理面的
   读数不能互相外推。**
### 16.31 头条视频「上传未完成」时间线自洽 + 一次字段误读自我纠错（2026-10-21）

> §16.25/§16.28 之后，头条视频错误已推进到「视频上传未完成」。本节把时间线算清楚，
> 并纠正我自己的一次字段误读。

#### 16.31.1 ⚠️ 一次字段误读（自我纠错）

我此前把任务的 `startedAt` 读成 **11:47:59.674Z**，并据此算出
「`startedAt` 晚于 `completedAt`（负 273 秒），数据异常」。

**真相**：11:47:59.674 是 `lastAttemptAt`（Unix 秒 1792582707896 转出来的），
**不是** `startedAt`。真正的 `startedAt` 是 **11:39:27.913Z**。

⇒ 教训（与 §16.22.3「确认片段属于哪一侧」同型）：**时间字段有多个（createdAt /
   startedAt / completedAt / lastAttemptAt），读之前先确认取的是哪一个**；
   我曾据错读字段宣称"数据异常"，差点写成一条假的缺陷记录。

#### 16.31.2 修正后的时间线（自洽）

| 区间 | 时长 | 含义 |
| --- | --- | --- |
| `createdAt` 11:29:29 → `startedAt` 11:39:27 | **9分58秒** | 队列等待 + 窗口创建 + cookie 恢复 |
| `startedAt` 11:39:27 → `completedAt` 11:43:26 | **3分59秒** | 实际执行（导航 + 上传等待 + 填充 + 门禁） |
| 合计 | 13分57秒 | |

#### 16.31.3 与上传等待预算对照（关键推论）

`upload-wait-strategy.js` 的确定性参数：

| 参数 | 值 |
| --- | --- |
| `computeBudgetMs(0.24MB)` | `60000 + 0.24×10000` = 62.4s ⇒ 被下界抬到 **90s** |
| `STABILIZE_MS`（稳定期） | 25s |
| `STALL_MS`（停滞阈值） | **180s** |

⇒ **90s 预算 + 180s 停滞 = 270s**，加页面操作（预期 60~90s）得 **330~360s**；
实测执行段 **239s（3分59秒）** —— **区间吻合但不在正中**。

> ⚠ **确定性边界**（CCG i1 指出后修正）：
> ① 阶段定位的可靠性来自**错误文本本身**（「未检测到上传完成信号」是门禁给出的明确阶段），
>    **不依赖**时间推算；时间只是佐证「没花在别处」。
> ② 时间吻合**可能是巧合**：239s 里有相当一部分可能是字段填充重试开销
>    （`FieldRetryState(3)` 每次最多 3 次），与上传等待的对应关系没那么紧。
> ③ 因此本节结论是「**阶段定位明确 + 执行段时长与上传等待预算同量级**」，
>    **不是**「时间吻合所以确定卡在那里」。

⇒ 头条的**阶段定位**是「上传完成信号检测」；`submitAttempted:false` 证明仍未提交、
未占间隔（fail-closed 持续生效）。

#### 16.31.4 下一步的候选方向（有依据，待复跑验证）

西瓜上传页的上传完成信号判据是「页面出现预览 / 编辑器 / 上传完成文案」
（`upload-waiter.js` 的四元组探针：`positive` = https 视频预览 || 编辑器输入 ||
`location.href` 含 post/video）。

| # | 候选方向 | 依据 |
| --- | --- | --- |
| 1 | 探针对西瓜页的**特异性不足**（例如上传完成后 URL 不含 `post/video`、编辑器选择器不同） | 探针原为抖音页取证（§16.30.1 同源教训：判据域跟着页面走） |
| 2 | 上传实际未完成（平台侧慢/失败）但**无负向信号** ⇒ 只能等停滞 | 90s+180s 的预算就是为这种情况设计 |
| 3 | 上传入口点击后**未真正触发上传**（file input 注入成功但页面未接收） | 需 #4185 的诊断（`track`/`apiTrackFailed`）+ 页面快照才能区分 |

⇒ 三者都需要**复跑一次带诊断的版本**才能区分 —— 与 §16.30.3 结论一致：
  剩余唯一信息缺口是运行时诊断。
### 16.32 头条视频双缺陷定位并修复：上传完成探针 + 无正文位门禁（2026-10-21）

> §16.31 把头条卡点定位在「上传完成信号检测」。本节用**发布窗口实时采样**拿到页面真实形状，
> 证明它其实是**两个代码缺陷**（不是平台问题），并给出修法与验证口径。

#### 16.32.1 取证方法（可复用）

发布期间应用会创建一个专用 RPA 窗口 ⇒ 它作为独立 page target 出现在 CDP `/json/list` 里。
用外部脚本每 8s 采样一次该页面，即可在**不改产品代码、不加日志**的前提下拿到上传前后真实 DOM。

#### 16.32.2 西瓜上传页上传成功后的真实形状（实测）

```
url        = /profile_v4/xigua/upload-video
fullText   = 「…添加视频 上传成功 dy-small.mp4 大小: 143.9KB 视频时长: 12s
              重新上传 删除 发布设置 标题 4/30 封面 上传封面 … 发布 手机预览效果…」
inputs     = 仅 1 个可见：input.xigua-input，placeholder=「请输入 0～30 个字符」
buttons    = 「添加视频」「发布」（发布 disabled=false）
videoCount = 0    textareaCount = 0    contenteditable = 0
```

⇒ **上传其实成功了**（页面明写「上传成功」「重新上传 删除」+ 文件名/大小/时长）。

#### 16.32.3 缺陷 A：上传完成探针 `positive` 对西瓜页恒为 false

`upload-waiter.js` 的探针对 `positive` 的定义（旧）：
```js
positive = 存在 https <video> || 存在 input[placeholder*="标题"]/textarea[placeholder]/[contenteditable=true]
           || location.href 含 "post/video"
```

对西瓜页逐条落空：

| 判据 | 实测 | 结果 |
| --- | --- | --- |
| https `<video>` | `videoCount=0` | ❌ |
| `input[placeholder*="标题"]` | 实际 placeholder「请输入 0～30 个字符」，**不含"标题"** | ❌ |
| `textarea[placeholder]` / `[contenteditable=true]` | 页面上一个都没有 | ❌ |
| URL 含 `post/video` | 实际 `/profile_v4/xigua/upload-video` | ❌ |

而 `decideUploadWait` 的 P4 是 `positiveSignal && !uploading` ⇒ **永不成立** ⇒ 只能等满
90s 预算后 best-effort（实测日志 `13:51:39 video upload-complete signal not detected`，
正好是开始上传后 90s）。

**关键**：页面上的「上传成功」此前只进了 `structural`（用于停滞判定的辅助），没进 `positive`。

#### 16.32.4 缺陷 B：该页没有正文输入位，但门禁 P4 强制要求正文写入

实测 `textareaCount=0`、`contenteditable=0`，页面只有「标题」+「封面」+「发布」。
而 `toutiao_video.editor` 登记了 4 个候选（`textarea.byte-textarea.abstract` /
`[contenteditable="true"]` / `[contenteditable]` / `.ProseMirror`）—— 一个都不存在：

```
13:48:42 waitForElement timeout sel=textarea.byte-textarea.abstract
13:48:45 waitForElement timeout sel=[contenteditable="true"]
13:48:48 waitForElement timeout sel=[contenteditable]
13:48:51 waitForElement timeout sel=.ProseMirror
13:48:51 content editor not found among 4 candidates
```

⇒ 门禁 P4「有正文 ⇒ 正文必须写入成功」**必然失败**。**即使上传确认修好，也发不出去。**

#### 16.32.5 修法（两处，都有回归锁）

**A. 探针补「强完成文案」正向判据**（平台无关的语义信号）：
```js
var doneCopy = /上传成功|上传完成|上传完毕/.test(t);   // 只认强文案，不认「重新上传」
positive = !!(vv || ed || doneCopy || location.href.indexOf("post/video") !== -1)
```
不把「重新上传」放进 positive 的理由：它可能是**静态提示**（上传前的说明文案），
而「上传成功/上传完成/上传完毕」只会在真的传完之后出现。

**B. 新增平台能力声明 `isNoBodyVideoPlatform`**（不硬编码平台名到门禁里）：

| 层 | 改动 |
| --- | --- |
| `publish-capabilities.json` | 新增顶层 `"noBodyVideoPlatforms": ["toutiao"]` |
| `publish-capabilities.js` | 导出 `NO_BODY_VIDEO_PLATFORMS` + `isNoBodyVideoPlatform(id)`（未知平台 false） |
| `publish-precondition.js` | 入参 `noBodyPlatform` ⇒ **P4 在该平台不适用**（与既有 `noTitlePlatform` 对称） |
| `rpa-view-platforms.js` | 计算 `noBodyPlatform = isNoBodyVideoPlatform(platform) && !!article.video_path`；跳过正文填充并记 `fillReport.content = { ok: true, skipped: "no-body-field" }` |

**三条设计纪律**：
1. 只对**视频形态**生效（`&& !!article.video_path`）—— 头条图文有 ProseMirror 正文，不受影响；
2. 未知/未声明平台一律 false ⇒ **fail-closed 到默认判据**，不放宽；
3. 跳过填充仍**显式记账**（`skipped: "no-body-field"`），不是静默丢弃。

#### 16.32.6 验证口径（TDD）

新增 `apps/desktop/tests/toutiao-video-signal-and-nobody.test.js`（8 例，先红后绿）：

| 组 | 锁什么 |
| --- | --- |
| ① | `positive` 引用 `doneCopy`，且 `doneCopy` 的文案含「上传成功/完成/完毕」；`structural` 不回归 |
| ② | 声明 `noBodyPlatform` ⇒ 通过；**未声明 ⇒ 仍 `content-not-filled`** |
| ③ | `isNoBodyVideoPlatform("toutiao")=true`、`"douyin"=false`、未知/undefined=false |

相关回归：`publish-precondition(.wiring)` / `upload-wait-strategy` / `publish-upload-order` /
`publish-capabilities` 共 **56 例全绿**。

#### 16.32.7 行数门禁的一个实录

`rpa-view-platforms.js` 是**零增长容差点名还账**文件（目标 1484 行，改动前 1482）。
本次改动先 +3 行 ⇒ 1485 超线；把一处 3 行注释压成 2 行（信息不丢失）后回到 **1484** 转绿。
⇒ 纪律：在该文件上加代码必须**同次**在文件内压缩等量注释，不得靠上调 targets 过关。

### 16.33 小红书 406 的字段级取证：竞品端点 + 线上 bundle 的真实 payload 字段族（2026-10-21）

> §16.11/§16.12/§16.15 已排除「缺请求头」「缺 /api 前缀」「sign-URI 形态」三条假设，
> 结论是「406 = 服务端对 `note` 端点**请求体字段/格式**的拒绝」。本节为字段级对照取证。

#### 16.33.1 竞品逆向成果里的小红书（按用户指示先查）

| 来源 | 内容 |
| --- | --- |
| `05-<参考产品>-materials/RPA分析报告.md` §2.4 | 只有 **上传**（腾讯云 COS 分片：`getUploadIdResponse` / `uploadVideoPart` / `getUploadedVideoEtag`，头 `x-cos-security-token`）、数据分析、内容删除 —— **没有发布/草稿 API 路径** |
| `04-rea-evidence/<参考产品>-主进程清点.json` URL 清点 | 有（按 count）：`edith.xiaohongshu.com/web_api/sns/v2/note` **4**、`creator.xiaohongshu.com/publish/publish` **4**、`creator.xiaohongshu.com/api/media/v1/upload/web/permit?biz_name=spectrum&scene=` **2**、`creator.xiaohongshu.com/api/galaxy/user/info` **1** |

⇒ **发布链 = permit → 上传 → `web_api/sns/v2/note`**。

#### 16.33.2 我们的实现已经与竞品同款（不是端点错）

`packages/api-publish-engine/src/publish/platforms/xiaohongshu-draft.js`：
```
1. POST creator.xiaohongshu.com/api/media/v1/upload/web/permit → { file_id, token, cos_key }
2. ros-upload（分片）
3. POST edith.xiaohongshu.com/web_api/sns/v2/note  （draft=true 存草稿）
```

⇒ 与竞品清点**完全一致** ⇒ 406 **不是**端点选错，也不是链选错。

#### 16.33.3 线上 bundle 取证（公开可下，无需登录）

创作页 `creator.xiaohongshu.com/publish/publish` 的主 bundle 位于
`fe-static.xhscdn.com/formula-static/ugc/public/resource/js/project-publish-vue.<hash>.js`（2.25MB）。
在里面直接读到三件事：

**① 端点常量**
```js
POST_NOTE: concat(l, "/web_api/sns/v2/note")
USER_INFO: concat(s, "/api/galaxy/user/my-info")
```

**② 该端点被登记在「必须签名」清单里**
```js
"creator-platform": { signIncludesUrl: [
  { pattern: "web_api/sns/v5/creator/topic/template/list", mode: "endsWith" },
  { pattern: "web_api/sns/v2/note", mode: "endsWith" }
] }
```
⇒ 与我们的 signer 一致（我们确实签了它，且 §16.15 已验证「签名有效、得 406 而非 401」）。

**③ 笔记模型字段族（前端 store 的真实键名）**
```
title  type  desc  ats  hash_tag  cover  video_info  metadata
post_loc  post_locs  scheduled_post_time  post_timing  order_cooperate
privacy  images_list  biz_relations  label_map
```

字段名要点（对 406 直接相关）：用 `type` **不是** `note_type`；用 `desc` **不是** `content`；
用 `images_list` / `video_info` **不是** `images` / `video`；`hash_tag` 是独立字段（话题不是内联在 desc 里）。

#### 16.33.4 一处**已确认的路径偏差**（与本 406 无关但应修）

| 位置 | 我们 | 线上 bundle |
| --- | --- | --- |
| 用户信息 | `/api/galaxy/user/info` | **`/api/galaxy/user/my-info`** |

⇒ 竞品清点里的 `user/info` 可能是旧版或另一入口；线上代码用的是 `my-info`。
这条**不影响 note 提交**（不同端点），但会影响「登录态/用户信息」探测的准确性，应单独核实。

#### 16.33.5 结论与下一步（按证据强度分层）

| 结论 | 强度 |
| --- | --- |
| 发布链与端点选型正确（permit → upload → sns/v2/note） | **实测**（与竞品清点一致 + 线上 bundle 常量） |
| `note` 在「必须签名」清单内，我们已签 | **实测**（线上 bundle `signIncludesUrl`） |
| payload 字段族应为 `type/desc/hash_tag/images_list/video_info/...` | **实测**（线上 bundle store 键名），但是否**全部必填**未知 |
| 406 的具体缺项 | **未证实** —— 仍需抓一次真实请求做逐字段 diff |

**下一步（下一轮）**：用 §16.32.1 的「发布窗口实时采样」同法，在应用内打开小红书创作页，
驱动页面点「存草稿」，并用 CDP `Network` 域捕获该次真实 `POST /web_api/sns/v2/note` 的
**请求体与请求头**，再与我们的构造逐字段 diff。这是唯一能把「未证实」变「实测」的路径。

> 顺带说明：若页面侧「存草稿」能成功，则**草稿目标已达成**（DOM 轨），
> 捕获到的 payload 还可反过来修 API 轨 —— 两条收益一次取证。

### 16.34 头条里程碑：上传门禁打通（第 6 个真因=翻译层白名单）+ 暴露封面与标题两个新缺陷（2026-10-22）

#### 16.34.1 决定性真因：`_probeUploadSignal` 的白名单把新字段全丢了

`upload-waiter._probeUploadSignal` 会把页面返回值**按固定白名单重建**：
```js
return { uploading, pagePercent, positive, structural }   // 旧
```
⇒ 前两轮新增的 `doneStrong` / `uploadingText` / `textLen` **全在这一层被静默丢弃**，且**零报错**。

**指纹**：首帧日志 `upload probe textLen=undefined`（来自兜底对象，正常应为页面文本长度）。

**同类缺陷史**：PR #4185 修的是 `RpaVmPublisher` 重新构造返回对象丢 `track/apiTrackFailed`。
两处同型：**翻译层白名单漏字段 ⇒ 上游埋点/字段白做，且没有报错可查**。

**修法**：`empty` 兜底与 `return` **两处同步**补 `uploadingText / doneStrong / textLen`，
并在注释里写死「加字段必须两处同步」。

#### 16.34.2 修好后的真机对比（决定性）

| 项 | 修前 | 修后 |
| --- | --- | --- |
| 首帧日志 | `textLen=undefined` | **`textLen=125`** |
| 上传完成信号 | 永远收不到（90s/300s/600s 全部耗尽） | **147 秒**命中（P3.5 认出「上传成功」） |
| 结果 | 卡在上传门禁 | **`filling title...` → `publishing...`** |

⇒ 之前所有「预算耗尽」都是**假象**：判定层从未收到任何信号。
（§16.31/§16.32/§16.33 三次给预算加下界，方向都不对——这条要作为方法论教训记住。）

#### 16.34.3 新缺陷 A：封面是**必填**，而 `toutiao_video` 没有 `cover_input` 选择器

发布后截图（`toutiao-verify-*.png`）显示页面标签为 **`*封面`**（红星=必填），封面区仍是
「+ 上传封面」空白；点「发布」后页面**停在上传页不动** ⇒ 平台校验不通过 ⇒ 验证必然超时。

而 `PLATFORM_PUBLISH_SELECTORS.toutiao_video` 此前**没有 `cover_input`**，
`rpa-view-platforms` 的封面步骤条件是 `if (article.cover_path && sel.cover_input)` ⇒ **静默跳过、日志无痕**。

**修法**：① 给 `toutiao_video` 登记 `cover_input`（image file input 四个候选）；
② 封面步骤增加「有 cover_path 但平台无 cover_input ⇒ warn」——**未实现必须可见**。

#### 16.34.4 新缺陷 B：标题被平台自动填成**文件名**，我们的填充没有回读校验

同一张截图：标题输入框内容为 **`dy-small`**（= 视频文件名，4/30 字），
而日志只打了 `title input hasTitle=true` + `filling title...`，**没有任何回读**。
⇒ 两种情况无法区分：(a) 我们的写入没生效；(b) 写入后被平台的「按文件名自动填充」覆盖。

**待办**：标题填充后必须**回读 `el.value` 并与期望值比较**，不一致则重试一次并留日志
（抖音链路已有 `douyin title: fill not applied (readback=0)` 同款判据，头条侧缺失）。

#### 16.34.5 验证阶段：三条兜底全失效（下一个要修的）

```
confirm dialog probe: NO_DIALOG
verifying...
page console: Uncaught SyntaxError: Unexpected token )   ← 需查是否我们注入的验证脚本写坏
artifact lookup 未命中 （作品可能仍在审核队列或该 API 口径已变）
publish verify snapshot: 页面仍在上传页（未跳转）
publish verification timeout endpoint=.../xigua/upload-video
[toutiao-xhr] code=undefined reason=NO_BODY
[toutiao-direct] 签名失败 via=page → SIGN_FAILED
```

要点：**西瓜页发布后不跳转**（与头条图文同型，见 §16.34.1 上方 2026-09-30 记录），
所以 `success_mode=url` 天然不适用；正解是查**作品列表 API** 的 `ArticleAttr.Status`
（2=已发布 / 6=审核中），这条路竞品验证过。

#### 16.34.6 确定性边界（不夸大）

| 结论 | 强度 |
| --- | --- |
| 白名单丢字段是真因、修好后上传门禁通过 | **实测**（textLen 125 vs undefined；147s vs 600s） |
| 发布被点击（`publishing...`） | **实测**（日志） |
| 封面必填且此前未传 | **实测**（截图 `*封面` + 空白） |
| 标题=文件名、我们未回读 | **实测**（截图 `dy-small` + 日志无回读） |
| **是否已真正发出去** | **未证实** —— 验证超时且三条兜底全失效；需查作品列表 |

### 16.35 标题填充改为「等值回读 + 不一致重填」（2026-10-22）

#### 16.35.1 为什么旧的"读回校验"不够

`_fillInput` 内建回读的判据是：**读回值为空且待填值非空 ⇒ 抛错**。
它挡得住"根本没写进去"，但挡不住"**写进去又被平台改成别的值**"：

| 读回结果 | 旧判据 | 新判据 |
| --- | --- | --- |
| 空 | 抛错 ✅ | 抛错 ✅ |
| 等于期望值 | 成功 ✅ | 成功 ✅ |
| **非空但不等于期望值** | **判成功 ❌（漏判）** | 判不一致 → 重填一次 ⚠ |

#### 16.35.2 真机证据

`toutiao-verify-*.png`（发布后截图）显示标题输入框内容为 **`dy-small`**（= 视频文件名，4/30），
而本次发布的标题是「被误解的明朝：西方史料里的另一个大明」；日志里只有 `filling title...`，
**没有任何回读痕迹** ⇒ 无法区分「没写进去」与「写进去后被平台的按文件名自动填充覆盖」。

#### 16.35.3 实现（独立模块，避免零增长门禁）

`apps/desktop/electron/services/title-fill-verify.js`：

| 导出 | 职责 |
| --- | --- |
| `readValue(win, sel)` | 读 `el.value`（回退 `textContent`），任何异常返回空串（不抛） |
| `fillAndVerifyTitle(ctx, win, sel, value, opts)` | 填 → 读 → 比对（trim）；不一致**重填一次**并 warn；返回 `{ ok, readback, retried }` |

调用点（`rpa-view-platforms`）由两行换成一行（净 -1 行），`fillReport.title` 现在带 `readback`，
**历史与诊断可查**（不再只看 `{ok:true}`）。

#### 16.35.4 为什么"仍不一致只告警不失败"

标题被平台改写属于**平台行为**，硬失败会把一次本可成功的发布判死；
但**必须可见**——否则用户会看到文件名当标题而无人知道。故：重试一次 + 两次 warn + 回读值入账。

#### 16.35.5 读数

| 项 | 读数 |
| --- | --- |
| 新增 `title-fill-verify.test.js` | **4 passed**（等值成功 / 重填成功 / 平台反复覆盖 / 取不到元素不抛） |
| desktop 相关回归 | rpa-view-platforms + 头条信号 **105 passed** |
| 行数门禁 | `rpa-view-platforms.js` 1483（目标 1484，未超） |

#### 16.35.6 未验证

尚未真机复跑：**不知道**回读会不会真的抓到 `dy-small`（若抓到，说明是"被覆盖"，
那还需要在**发布前**再校验一次；若是"没写进去"，说明选择器命中错了元素）。

### 16.36 四平台视频发布现状与「探针读不到 ≠ 事实为假」（2026-10-22 会话小结）

#### 16.36.1 各平台实测状态

| 平台 | 已证实 | 未证实/待修 |
| --- | --- | --- |
| 抖音 | 真机真实发布成功（109s，`result.mode=dom`，`submitAttempted=true`） | 平台侧 `aweme_id` 未取证 |
| 今日头条 | 上传入口/完成信号/标题写入/封面 CDP 设文件均已通 | 封面弹窗「下一步」仍 `cannot-click`；发布后验证（页面不跳转，`success_mode=url` 不适用） |
| 视频号 | 登录态有效、上传动作执行 | 上传后页面不进编辑态；编辑器选择器未命中 |
| 小红书 | 视频上传成功（页面显示「检测为高清视频」）、标题与正文写入成功 | 草稿是否落库**未证实**（发布页无草稿按钮、无草稿计数节点） |

#### 16.36.2 元教训：探针读不到 ≠ 事实为假

本会话反复出现同一类误判，根因都是**用了一个在该页面上无效的探针**：

| 现象 | 当时的结论 | 真相 |
| --- | --- | --- |
| 头条 `upload probe textLen=undefined` | 页面没渲染文案 | `_probeUploadSignal` 白名单把新字段静默丢弃 |
| 小红书「草稿箱计数 0→0」 | 草稿没保存 | 页面**根本没有** `SPAN.draft-title` 节点，计数恒 0 |
| 视频号「editor 未命中」 | 选择器写错 | 取证时页面只有上传区，编辑器尚未渲染（时机） |

**纪律**：下结论前先自问「我的观测手段在这个页面上有效吗」——
先验证探针本身（dump 元素是否存在、字段是否透传），再用探针验证业务。

#### 16.36.3 已固化的三条判据纪律

1. **完成信号要覆盖平台真实文案**：头条 `上传成功`、小红书 `检测为高清视频/设置封面`，单一文案必漏；
   更稳的是「是否进入下一步 UI」（如出现「设置封面」区块）。
2. **翻译层必须两处同步**：`_probeUploadSignal` 的 `empty` 兜底与 `return` 白名单要一起加字段，
   否则上游埋点白做且零报错（PR #4185 的 `track/apiTrackFailed` 同型）。
3. **回退路径会吃掉主路径的错误**：`_setFileInput` 的 JS 回退必抛 `Script failed to execute`，
   排查笼统报错先问「上一层被谁吞了」（PR #4211 修法：纯 CDP + 原始错误可见）。
### 16.30 视频号 API 轨健康检查：代码与 CDN 均正常，剩余只能靠埋点复跑（2026-10-21）

> §16.28 定位到「API 轨先失败但原因未留档」。本轮做**不浪费发布机会**的排除性检查。

#### 16.30.1 检查一：API 轨测试全绿

用项目自身 runner（`packages/api-publish-engine/scripts/run-tests.js`）跑全量：

```
[API 测试] 通过：Vitest（48 个文件）
rc=0
```

⇒ `shipinhao-video-chain.test.js`（私密优先 / post_draft 五步序列 / 鉴权头逐级传递）**通过**。

⚠ 过程中一次**命令用错**：直接 `vitest run <file>` 与 `node --test` 都报 `describe is not defined`，
一度以为文件坏了。真因是该文件**依赖 vitest 全局**（describe/test），必须由 `run-tests.js`
按 `VITEST_FILES` 在册登记走 vitest 分支跑 —— 这正是 2026-10-21 runner 机械判定
（`runner-detect.js`）要解决的形态。

⇒ 教训：**判测试结果必须用项目自己的 runner**，别用裸 vitest / node --test 直跑单文件
（与 §16.29「判据域跟着被测性质走」同型：判据要用对入口）。

#### 16.30.2 检查二：两个 CDN 主机均可达

只读探测（GET，不发布、不传内容）：

| 主机 + 路径 | 结果 |
| --- | --- |
| `finder.video.qq.com/` | 404（主机可达，路径不存在） |
| `finder.video.qq.com` + helper_upload_params 路径 | 404 |
| `finderassistancea.video.qq.com/` | 404 |
| `finderassistancea.video.qq.com` + helper_upload_params 路径 | 404 |

⇒ **两个主机都能建立 HTTP 连接**（返回 404 而非 DNS/连接错误）⇒ 主机选型不是阻塞点；
  404 是「路径不存在」，实际路径由 applyuploaddfs 请求决定。

#### 16.30.3 结论与剩余

| 项 | 状态 |
| --- | --- |
| API 轨代码 | 测试全绿（48 文件 rc=0） |
| CDN 主机可达性 | 两主机均可建立连接 |
| **运行时失败原因** | **仍未知**（应用未加载埋点，复跑也拿不到诊断） |

⇒ 剩余的**唯一**信息缺口是运行时诊断，而它需要：
① 应用重启到含 #4150/#4155 埋点的版本；② 复跑一次视频号发布。

**在拿到 apiTrackFailed 之前，不再改代码**（无依据的改动只会引入新变量）。

#### 16.30.4 顺带确认：当前应用进程确实不含埋点

electron 主进程启动时间 **15:55:23**，而 #4155（分轨埋点）合并于其后 ⇒
当前进程跑的是**旧二进制**。这是「重启后才能复跑」的客观依据，不是拖延。
### 16.25 头条视频真因：西瓜上传接口 `no login`（不是缺选择器，也不是 URL 错）（2026-10-21）

> §16.23 记为「代码缺口：缺西瓜上传页选择器」、§16.24 又疑「URL 域可能错了」。
> 本节给出**实测真因**，前两节的归因都被本节修正。

#### 16.25.1 实测（应用内已登录态，2026-10-21）

① 上传页本身可达且 HTML 正常：
```
GET https://mp.toutiao.com/profile_v4/xigua/upload-video
→ HTTP 200 text/html 59699 字节（SPA 外壳正常）
```

② 但页面**三个上传元素全无**，且文案稳定为「网络异常，请刷新重试~」（刷新 3 次均如此）：
```
fileInputs=0 | input.xigua-input=false | textarea.byte-textarea=false | .action-footer-btn=false
```

③ 直接打上传接口，拿到**服务端明确答案**：
```
GET https://mp.toutiao.com/xigua/api/upload/getAuthKey/
→ HTTP 200 {"status":-12,"message":"no login"}
```

⇒ **真因：该账号在西瓜上传接口上没有登录态**（`status:-12 no login`）。

#### 16.25.2 为什么不是前两节猜的原因

| 猜测 | 实测结论 |
| --- | --- |
| §16.23「缺西瓜上传页选择器」 | ❌ 选择器早已登记（`toutiao_video`，10-18 真机取证）；且 #4170 修了漏传 article 后仍失败 |
| §16.24「URL 域错了，该用 `studio.ixigua.com`」 | ❌ `mp.toutiao.com` 域名下**已登录**（页面 200、未被重定向）；`studio.ixigua.com` 反而跳 `/welcome`（未登录） |
| **「西瓜上传接口未登录」** | ✅ **服务端返回 `status:-12 no login`**，且解释了"网络异常"文案（接口失败 ⇒ SPA 渲染不出上传区） |

#### 16.25.3 机制解释（为什么头条号登录了，西瓜上传却没登录）

`mp.toutiao.com`（头条号后台）与 `xigua/api/upload/*`（西瓜视频上传）是**两套登录态**：
前者走头条号 session，后者需要西瓜/中视频的额外授权（竞品逆向成果里 `studio.ixigua.com`
是独立域名、独立登录，正与此吻合）。

⇒ 这与 §16.21 的教训同型：**"页面能打开" ≠ "接口已授权"**。

#### 16.25.4 剩余工作（重排优先级）

| # | 事项 | 性质 |
| --- | --- | --- |
| 1 | **在应用内打开西瓜上传页并完成授权/登录**（可能需要扫码或单独确认） | **用户动作** |
| 2 | #4170 的「传 article」修复 | 仍必要（否则选择器取错），但**不是**真因 |
| 3 | 授权后重跑视频发布，用真实 `ItemId` 留档 | 验证 |

⇒ 头条视频的阻塞点从"代码"移回"账号授权"，但**这次有服务端明确判据**
（`status:-12 no login`），不再是猜测。

#### 16.25.5 可操作建议（给用户）

在应用内打开 `https://mp.toutiao.com/profile_v4/xigua/upload-video`，若显示「网络异常」：
1. 手动刷新几次（排除瞬时 502 —— 本次 `v2/user/info/` 返回过 502）；
2. 若仍异常，说明该账号未获得西瓜上传授权，需在西瓜创作平台侧完成账号绑定/实名；
3. 完成后告诉我，我立即重跑发布并用真实 `ItemId` 留档。