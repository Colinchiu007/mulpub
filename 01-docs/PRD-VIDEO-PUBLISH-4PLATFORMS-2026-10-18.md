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
