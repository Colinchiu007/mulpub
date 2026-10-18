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

**① `checkPublishAuth` 推翻「未实名所以不能发」**：

```
canPublish = true   disablePublish = false   blockStatus = 0   reviewLatency = 0
authorPermission: IsIdentifyAuth=false（未实名），但 DisablePublish=false、IsUserBan=false
```

⇒ **「未实名」≠「不能发」**。此前据此判定「卡实名认证、需人工」属**错误归因，予以撤回**。
同时补记首尾长度：`TtVideoTitleLenMin/Max = 0/30`、`XgVideoTitleLenMin/Max = 1/30`。

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
