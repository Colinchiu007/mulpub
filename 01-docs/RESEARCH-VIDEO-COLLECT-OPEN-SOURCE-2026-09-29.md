# 开源采集项目调研：六平台视频链接采集与分享链接解析（2026-09-29）

> 调研目的：为「采集功能支持 抖音/小红书/视频号/哔哩哔哩/百家号/知乎 视频链接 + 分享文本链接解析」提供开源方案借鉴与复用依据。
> 调研方式：4 个并行子代理逆向分析 GitHub 热门项目源码 + 本机 yt-dlp 真实链接实测。
> 结论速览见 §7 复用清单与 §8 落地建议。

---

## 1. 调研范围与当前管线基线

Mulpub 视频采集管线（`packages/python-backend/src/multi_publish/aggregation/video_service.py`）：

```
分享文本 → 提取真实 URL（前端 Collection.vue extractUrlFromShareText）
  → detect_platform 域名白名单（douyin/xiaohongshu/bilibili/zhihu/channels）
  → yt-dlp --dump-json 元数据探测（>10min 拒绝）
  → yt-dlp 下载（≤500MB/300s）
  → ffprobe 音轨检测 → ffmpeg 提取 16kHz WAV → faster-whisper ASR 转写
  → CollectResult（title/transcript/platform/duration）
```

yt-dlp 失败且错误分类为 `VIDEOCLONE_LINK_ANTI_BOT` 时降级 Playwright 浏览器通道（`browser_fetcher.py`，**目前只实现了抖音配置**）。

已知缺口（本次调研要回答的）：

| # | 缺口 | 现状 |
|---|------|------|
| G1 | 前端 `isVideoPlatformUrl` 只路由 douyin/xiaohongshu 到视频通道 | bilibili/zhihu/视频号/百家号视频链接误走图文采集路径 |
| G2 | 分享文本提取正则在「URL+中文无空格粘连」时吞中文 | `https://v.douyin.com/abc/复制此链接` → URL 带中文尾巴 |
| G3 | 后端 `PLATFORM_DOMAINS` 缺百家号 | detect_platform 直接拒绝 |
| G4 | 浏览器降级通道只有抖音配置 | 小红书/视频号/百家号无降级能力 |
| G5 | 分享文本提取的域名模式缺百家号（baijiahao.baidu.com / mbd.baidu.com） | 百家号分享文本提取后不识别为视频平台 |

---

## 2. yt-dlp 原生支持矩阵（源码核验 + 本机实测）

数据源：yt-dlp 2026.08.19（本机 pip 实装）extractor 源码 + supportedsites.md + GitHub Issues（#17464/#17055/#16867 抖音、#16519/#15467/#10814 小红书、#14830/#17527 B站）。

| 平台 | yt-dlp extractor | _VALID_URL | 本机实测（2026-09-29） | 结论 |
|------|------------------|-----------|----------------------|------|
| 抖音 | `Douyin`（tiktok.py 内） | `douyin.com/video/<id>`；v.douyin.com 靠 generic 重定向落地 | 用户真实分享链 `v.douyin.com/vknKdeN_naU/` → 302 → iesdouyin share → DouyinIE 报 **"Fresh cookies needed"** | 名义支持，实际被反爬击溃（2024-07 起持续，登录 cookies 也大概率失败）→ 必须走 Playwright 降级（已有） |
| 小红书 | `XiaoHongShu` | `www.xiaohongshu.com/(explore\|discovery/item)/<id>`；xhslink.com 靠重定向 | explore 页直连 SSR 的 `__INITIAL_STATE__.noteDetailMap` 为 **空**（带 2024 年 xsec_token 也空）→ "No video formats found" | 匿名直连拿不到笔记数据；需新鲜 xsec_token 或浏览器通道 |
| 哔哩哔哩 | `BiliBili` + 20 余系列 | `bilibili.com/video/(BV\|av)`；b23.tv 靠重定向 | `BV1GJ411x7h7` 元数据 + **完整下载（20.5MB DASH 合流）全部成功，无需 cookies** | ✅ 最成熟，纯 yt-dlp 可用（412 风控为偶发，建议保留 ANTI_BOT 降级路径） |
| 知乎 | `Zhihu` | `zhihu.com/zvideo/<数字id>`，公开 API `api/v4/zvideos/` 免登录 | `zvideo/1342930761977176064` 元数据 + **完整下载（16.5MB）+ ffmpeg 提音频全部成功** | ✅ 可用但低维护（测试数据停在 2021），需冒烟验证+降级预案 |
| 百家号 | ❌ 无 | — | 伪造 id → 302 到 `mbd.baidu.com/newspage/data/error` | 必须自建解析 |
| 视频号 | ❌ 无（`vqq:` 是腾讯视频，无关） | — | channels.weixin.qq.com/platform 为创作者后台（需登录） | 必须自建解析；分享页深锁微信生态 |

**管线错误分类建议**（yt-dlp stderr → ANTI_BOT 降级触发条件）：
- 抖音 `Fresh cookies (not necessarily logged in) are needed`（已覆盖 ✅）
- B站 HTTP 412 / API code -412/-352（**未覆盖，需补**）
- 小红书 `No video formats found` / 短链 404（**未覆盖，需补**）

---

## 3. MediaCrawler（NanmiCoder，65.9k ⭐）

- 其 API 端点/签名机制/字段路径属事实知识，可直接采用。
- 架构：Playwright 登录保存登录态 → httpx 直调 web API，签名用 execjs 执行平台 JS 或纯算法库；`media_platform/{平台}/core.py + client.py + help.py + media.py` 分层。
- 关键事实知识：
  - **小红书**：API host `edith.xiaohongshu.com`，笔记详情 `POST /api/sns/web/v1/feed`，body 必带 `xsec_token`；签名 x-s/x-t 由 **xhshow 库（Cloxl/xhshow，MIT，可独立引入）** 生成；视频字段 `note_card.video.media.stream[].master_url`，无水印源片 `video.consumer.origin_video_key` 拼 `sns-video-bd.xhscdn.com`；错误码 300012=IP 封、471/461=验证码、-510000=笔记不存在。
  - **抖音**：短链解析 = 不跟随重定向读 302 `Location`（与我们 `resolve_short_link` 同思路）；detail API 需 cookie `s_v_web_id`（=verifyFp）+ UIFID；无水印地址 `play_addr.url_list` **reversed 后第一个**；`bit_rate[]` 按码率排序。
  - **B站**：`GET /x/web-interface/view/detail`（免签名）+ `GET /x/player/wbi/playurl`（WBI 签名，算法源自 bilibili-API-collect 公开文档，fnval=4048 DASH 分轨）。
  - **知乎**：只做元数据不做视频下载（README 明确），zvideo 走页面 `js-initialData`，签名 x-zse-96 需 cookie `d_c0` —— **无可复用实现，视频必须走我们自己的通道**。
- 分享文本提取：**无通用「文案+短链+引导语」提取函数**（只有按逗号/换行分割 + 平台 URL 正则），此块需自研。

---

## 4. 抖音生态三项目横向对比

| 维度 | [Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)（20.4k ⭐） | [f2](https://github.com/Johnserf-Seed/f2)（2.7k ⭐） | [TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader)（16.4k ⭐） |
|------|------|------|------|
| 许可证 | **Apache-2.0 ✅ 可复制**（含 NOTICE） | **Apache-2.0 ✅ 可复制** | **GPL-3.0 ⛔ 禁复制**（一行都不能进闭源仓库） |
| 分享文本正则 | **最完善**：CJK 排除字符类 + 裸主机白名单 + 尾部标点清理（`src/dtk/urls/patterns.py`） | 最弱：`https?://\S+`（`f2/utils/string/formatter.py`） | 居中：CJK 标点排除 + 19 位定长 ID 锚定（`src/link/extractor.py`） |
| 短链解析 | 单跳 Location + 每跳 host 白名单复检（SSRF 防护，`src/dtk/urls/expand.py`） | httpx follow_redirects（无白名单） | curl_cffi TLS 仿真 + follow_redirects |
| 签名 | a_bogus 纯 Python + msToken（实测可伪造）+ **x-secsdk-web-signature md5 完整实现** | a_bogus + **x-tt-argus 占位头实测可过**（网关只查存在性） | a_bogus + websign（改编自 Evil0ctal，谱系单一） |
| 风控判据 | `status_code ∈ {8,2154,2156,10000,10001}` 或空 `aweme_detail` = 风控 | — | — |
| 无水印 | `play_addr.url_list`（watermark=False）+ `bit_rate[].play_addr`；`download_addr` 是烧录水印版（兜底） | `bit_rate` **分辨率优先**选流（H.265 高清码率可能低于 1080p H.264，#214） | bit_rate 排序 + 原画质端点 `/aweme/v1/play/?video_id={uri}&ratio=default`（事实知识，代码不可抄） |

**可直接复用的核心资产（Apache-2.0）**：

1. **分享文本 URL 提取正则**（Evil0ctal `src/dtk/urls/patterns.py`）——从机制上解决 G2（URL+中文粘连）：

```python
_URL_BODY = (
    r"[^\s<>\"'`\\"
    r"\u2018\u2019\u201c\u201d"      # 弯引号
    r"\u3000-\u303f"                  # CJK 标点（含【】《》）
    r"\u3400-\u4dbf"                  # CJK 扩展A
    r"\u4e00-\u9fff"                  # 汉字
    r"\uff00-\uffef"                  # 全角形式
    r"\U0001f000-\U0001faff"          # emoji
    r"]"
)
URL_IN_TEXT_RE = re.compile(rf"https?://{_URL_BODY}+", re.IGNORECASE)
TRAILING_JUNK = ".,;:!?)]}>'\"" + "\u3001\u3002\uff0c\uff01\uff1f\uff09\u3011\u300b\u201d\u2019"
```

2. **短链解析 SSRF 防护设计**：每跳重定向后重新校验 host 白名单（label 边界匹配防 `douyin.com.evil.com`、拒十进制 IP/nip.io）；「canonical URL 重复 = 已到达」防误报循环。
3. **风控判据**：`RISK_STATUS_CODES = {8, 2154, 2156, 10000, 10001}` + 「结构完整但 aweme_detail 为空 = 风控而非 schema 变化」——直接用于 Playwright 通道响应判读。
4. **选流策略**（f2）：`bit_rate` 按 `max(width,height)` 分辨率优先、码率次之排序，避免 H.265/H.264 码率倒挂漏选高清。
5. **实战情报**：msToken 抖音不校验（可伪造）；ttwid 可经 `ttwid.bytedance.com/ttwid/union/register/`（ixigua 通道）自助注册；短链标准两跳 `v.douyin.com → iesdouyin.com/share/video/{id} → douyin.com/video/{id}`（本机实测吻合）。

**Playwright 通道无需移植签名代码**：三家纯 HTTP 通道都在跟 a_bogus/x-secsdk-web-signature 的军备竞赛（维护成本高）；而浏览器页面 JS 自动完成全部签名——Mulpub 现有「访问视频页 + 拦截 detail API」路线是社区验证过的唯一稳定出路（yt-dlp #17055 的 workaround 结论相同）。

---

## 5. B站 / 小红书 / 知乎 / 百家号 / 视频号专项调研

### 5.1 哔哩哔哩 —— yt-dlp 直下（P0，成本最低）

- **yt-dlp 原生支持含 b23.tv**：`bilibili.py` 的 `_VALID_URL` 不含 b23.tv，但 generic extractor 请求后发现重定向会 `url_result(new_url)` 重新分派给 BiliBiliIE——无需额外开发（本机实测 B 站全链路 ✅）。
- **[BBDown](https://github.com/nilaoda/BBDown)（MIT ✅ 可复制）**：短链解析 = HEAD 请求读最终 URL；播放地址 = `api.bilibili.com/x/player/wbi/playurl?...&fnval=4048&try_look=1&wts={ts}&w_rid={sign}`（WBI 签名：`nav` API 拿 img/sub key → mixinKeyEncTab 混淆表取前 32 → MD5）；页面兜底正则 `window.__playinfo__=([\s\S]*?)<\/script>`；PCDN 域名（`://.*:\d+/`）替换 `upos-sz-mirrorcoso1.bilivideo.com`。
- yt-dlp 源码已把 `-352` 风控标记为预期场景 → ANTI_BOT 降级通道有真实价值（降级实现可直接抄 BBDown 的 `__playinfo__` 正则，MIT）。

### 5.2 百家号 —— 纯 HTTP 静态解析（P0，五平台最简单，实测验证）

- **无任何开源实现**（GitHub 搜索仅命中发布工具 dorisoy/ShortVideo.AutoPublisher），yt-dlp/you-get 均不支持；但调研代理 + 主会话双重实测真实文章页（`baijiahao.baidu.com/s?id=1877446299628255783`，人民日报，含 01:40 视频）完全摸清结构：
  1. **`<video>` 标签直嵌 mp4**（主会话独立验证 ✅）：`<video src="http://vd3.bdstatic.com/mda-xxx/360p/h264/.../mda-xxx.mp4" poster="...">`
  2. **全局变量 `window.jsonData`**（结构化优先，主会话独立验证 ✅）：提取正则须用 `window\.jsonData\s*=\s*(\{.*?\})\s*;\s*window\.`（**JSON 后跟 `;window.firstScreenTime = Date.now();` 再 `</script>`**，直接锚定 `</script>` 会匹配失败）；路径 `bsData.superlanding[0].itemData.sections[]` 中 `type:"mthvideo"` 项 → `content.https.file`（https mp4 直链）/ `content.base.src`（http）/ `content.base.mediaId` / `content.base.long`（时长 "01:40"）/ 封面 / 宽高；标题在 `itemData.header`
  3. **无需登录、无需签名、无需 API** —— 普通 HTTP GET + HTML 解析即可，不需要 Playwright
- **边界**：纯视频类百家号链接会 302 到 `haokan.baidu.com`（好看视频，实测确认）——图文内嵌视频留在文章页；haokan 页面需单独适配或如实报不支持。

### 5.3 知乎 —— lens API 免鉴权（P1；yt-dlp 已实测可用）

- **无热门专用项目**（GitHub 最大 7 星且多停更）；zvideo 独立页无任何专门开源实现。
- 三个小项目（[you-get](https://github.com/soimort/you-get)（MIT ✅）、zhihu-video-hunter（MIT）、download_zhihu_video（可参考思路））验证同一路径：
  1. 回答/专栏页 HTML 正则 `data-lens-id="(\d+)"` 提取 video_id
  2. **lens API**：`GET https://lens.zhihu.com/api/videos/{id}` → `playlist.{hd|sd|ld}.play_url`（m3u8，ffmpeg 合并）；新版 `POST zhihu.com/api/v4/video/play_info` → `video_play.playlist["mp4"][0]["url"][0]`（直接 mp4）
  3. **免登录、免签名、免特殊 header**
- **zvideo 独立页**：yt-dlp 的 Zhihu extractor 走公开 `api/v4/zvideos/{id}`（本机实测元数据+下载+提音频全链路 ✅）——**主通道用 yt-dlp 即可**；lens API 仅作回答/专栏内嵌视频的扩展路径（当前目标场景是视频链接，zvideo 页已覆盖）。

### 5.4 小红书 —— Playwright 页面监听（P1，社区验证的正路）

- **[ReaJason/xhs](https://github.com/ReaJason/xhs)（MIT ✅ 可复制）**：API `edith.xiaohongshu.com/api/sns/web/v1/feed`（POST，**必须带 xsec_token**）；HTML 兜底正则 `window.__INITIAL_STATE__=({.*})</script>`，路径 `note.note_detail_map[note_id].note`；视频 URL = `note.video.consumer.origin_video_key` 拼 `sns-video-{qc,hw,bd,qn}.xhscdn.com` 四 CDN 随机。
- 签名 `x-s`/`x-t`/`x-s-common` 需 cookie `a1`/`webId`；README 警告本地 sign() 已过时，**官方签名服务器示例本身就是用 Playwright 执行页面 `window._webmsxyw(url, data)`** —— Playwright 路线是社区验证的正路。
- **落地**：Playwright 加载分享 URL（302 解析 xhslink.com 后带 xsec_token 的落地页）→ 监听 `edith` feed API 响应或读水合后 `__INITIAL_STATE__` → `video.media.stream[].master_url`（MediaCrawler 字段情报）或 `origin_video_key` 拼 CDN（xhs help.py MIT 可直接移植）。

### 5.5 微信视频号 —— 不可行，建议如实标注暂不支持

- 生态很活跃但**全部是「PC 微信客户端 + 本地系统代理 + 自签证书 + 视频流解密」架构**（res-downloader 20.3k ⭐ Apache-2.0 / wx_channels_download 9.5k ⭐ 非标协议证 ⚠️ / wechatVideoDownload 5.8k ⭐ 无 License ⚠️），无一解析网页链接。
- 分享页 `channels.weixin.qq.com/web/shares/video/` 实测为创作者平台域（需微信扫码登录）；视频流本身加密，解密参考库 Hanson/WechatSphDecrypt **已被删除（404）**，法律敏感度高。
- **三重障碍**：登录墙（自动化扫码属灰色地带）、加密流（解密实现已下架）、现有工具依赖「用户本机 PC 微信+系统代理+证书」无法在 Mulpub 后台复现。
- **产品建议**：视频号链接采集如实报「需要微信登录态，暂不支持自动采集」；未来可考虑集成 res-downloader 式本地代理（Apache-2.0）作为独立可选功能。

---

## 6. 本机管线实测记录（2026-09-29）

| 测试 | 输入 | 结果 |
|------|------|------|
| yt-dlp 安装 | `pip install yt-dlp` | 2026.08.19，含 Douyin/XiaoHongShu/Zhihu/BiliBili extractor |
| 抖音分享链（用户目标原文） | `v.douyin.com/vknKdeN_naU/` | 302 → `iesdouyin.com/share/video/7686432847778982833` → DouyinIE "Fresh cookies" → 归类 ANTI_BOT → 走浏览器降级（符合预期） |
| 知乎 zvideo 元数据+下载+提音频 | `zhihu.com/zvideo/1342930761977176064` | dump-json ✅ / 下载 16.5MB ✅ / ffmpeg 16kHz WAV 4.5MB ✅ / ffprobe 有音轨 ✅ |
| B站 元数据+下载 | `bilibili.com/video/BV1GJ411x7h7` | dump-json ✅ / 下载 20.5MB（bv*+ba DASH 合流）✅，无需 cookies |
| 小红书直连 | explore 页 + 2024 年 xsec_token | SSR `noteDetailMap:{}` → "No video formats found"（确认匿名直连不可行） |
| 百家号文章页（真实 id 1877446299628255783） | GET + HTML 解析 | `<video src>` mp4 ✅；`window.jsonData` mthvideo sections ✅（https.file/base.src/mediaId/long=01:40/标题齐全）；纯 HTTP 可采集 |
| 前端分享文本提取（现有代码） | 6 组样例（含用户目标原文） | 空格分隔 ✅；**URL+中文无空格粘连 → 中文被吞进 URL（G2 缺陷确认）**；百家号域名不在识别表（G5） |
| 短链解析（现有 resolve_short_link） | v.douyin.com | 302 Location 读取 ✅（仅支持 v.douyin.com/xhslink.com，b23.tv 未列入但 yt-dlp 自身可跟随） |

---

## 7. 复用清单（分梯队）

### 第 1 梯队（直接落地，Apache-2.0 / MIT / 事实知识）

| # | 复用点 | 来源 | 许可证 | 目标位置 | 工作量 |
|---|--------|------|--------|---------|--------|
| 1 | 分享文本 URL 提取正则（CJK 排除字符类 + 尾部清理） | Evil0ctal `src/dtk/urls/patterns.py` | Apache-2.0 | 前端 `Collection.vue` extractUrlFromShareText（JS 版）+ 后端兜底 | 小 |
| 2 | 短链解析 host 白名单 + 每跳复检 | Evil0ctal `src/dtk/urls/expand.py` 设计 | Apache-2.0 | `browser_fetcher.resolve_short_link` | 小 |
| 3 | 抖音风控判据（status_code 表 + 空 aweme_detail） | Evil0ctal `parser.py` | Apache-2.0 | `browser_fetcher` 响应判读 | 小 |
| 4 | bit_rate 分辨率优先选流 | f2 `utils.py` | Apache-2.0 | `browser_fetcher` 播放地址选择 | 小 |
| 5 | 小红书视频字段路径 `video.media.stream[].master_url` + `origin_video_key` 无水印 | MediaCrawler 事实知识 + yt-dlp XiaoHongShu extractor 同源验证 + xhs help.py（MIT） | 事实知识/MIT | 小红书浏览器通道 | 中 |
| 6 | 百家号页面结构 `window.jsonData` mthvideo sections + `<video src>` 兜底 | 专项代理实测（2026-09） | 事实知识 | 百家号纯 HTTP 采集通道 | 小 |
| 7 | 知乎 lens API `lens.zhihu.com/api/videos/{id}`（免鉴权） | you-get（MIT）验证 | 事实知识/MIT | 知乎回答/专栏内嵌视频扩展 | 小 |
| 8 | B站页面兜底正则 `window.__playinfo__` + PCDN 域名替换 | BBDown（MIT） | MIT | B站 Playwright 降级通道 | 小 |
| 9 | xhshow 签名库（小红书 x-s/x-t） | Cloxl/xhshow | MIT | 小红书纯 HTTP 通道备选（P2） | 中 |

### 第 2 梯队（思路借鉴，自行重写）

| # | 借鉴点 | 来源 | 说明 |
|---|--------|------|------|
| 10 | 19 位定长 aweme_id 锚定 | TikTokDownloader（GPL，只借思路） | ID 提取正则极短，重写成本≈0 |
| 11 | 原画质端点 `/aweme/v1/play/?video_id={uri}&ratio=default` | TikTokDownloader（GPL，URL 形态不受版权保护） | 需带 cookie，作画质兜底 |
| 12 | B站 WBI 签名 + DASH | bilibili-API-collect 公开文档 / BBDown | 仅当需要绕过 yt-dlp 自建 B 站通道时 |
| 13 | curl_cffi TLS 指纹仿真 | TikTokDownloader 选型思路 | 纯 HTTP 通道防 TLS 指纹识别的正确依赖 |
| 14 | 下载器防御性设计（Content-Range 语义/Content-Type 校验防错误页/Accept-Encoding: identity） | MediaCrawler 思路 | 206 剩余长度≠总长度、gzip 致大小校验误判、200+text/html 假视频三类坑 |

### 禁区（许可证红线）

- **TikTokDownloader（JoeanAmier）GPL-3.0**：一行代码不可进 Mulpub 闭源仓库。
- **MediaCrawler**：采用其 API 端点/字段路径等事实知识。
- 两者的「思路」不受版权限制，但落地时一律从 Apache-2.0 源（Evil0ctal/f2）或公开社区文档取材。

---

## 8. 对 Mulpub 的落地实施建议（映射到缺口 G1-G5）

按「采集成功率 × 实现成本」排序的平台方案矩阵：

| 平台 | 主通道 | 降级/扩展通道 | 实现成本 | 预期结果 |
|------|--------|--------------|---------|---------|
| 哔哩哔哩 | **yt-dlp 直下**（含 b23.tv，实测 ✅） | Playwright 读 `window.__playinfo__`（BBDown MIT 正则） | 极低 | ✅ 可采集 |
| 知乎 | **yt-dlp 直下**（zvideo，实测 ✅） | lens API（回答/专栏内嵌视频扩展） | 极低 | ✅ 可采集 |
| 百家号 | **纯 HTTP 解析 `window.jsonData` + `<video src>` 兜底**（实测 ✅） | — | 低 | ✅ 可采集（图文内嵌视频）；纯视频链接 302 到好看视频需单独处理 |
| 抖音 | yt-dlp（大概率 Fresh cookies）→ **Playwright 降级（已有）** | — | 已实现 | ✅ 可采集 |
| 小红书 | yt-dlp（匿名拿不到数据）→ **Playwright 降级（需新增）** | xhshow 纯 HTTP（P2 备选） | 中 | ✅ 补齐降级后可采集 |
| 视频号 | ❌ 不可行（登录墙+加密流+解密库下架） | res-downloader 式本地代理（远期独立功能） | 高 | ⚠️ 如实报「需要微信登录态，暂不支持」 |

具体改动清单：

1. **G1 前端路由**（`isVideoPlatformUrl`）：域名表扩到六平台（+ bilibili.com/b23.tv、zhihu.com、channels.weixin.qq.com、baijiahao.baidu.com、mbd.baidu.com），B站/知乎/百家号视频链接改走视频通道。
2. **G2 分享文本提取**：按 Evil0ctal CJK 排除字符类重写正则（JS 版），尾部标点清理表对齐 `TRAILING_JUNK`；补百家号域名。
3. **G3 后端平台白名单**：`PLATFORM_DOMAINS` 增加百家号（baijiahao.baidu.com、mbd.baidu.com）。
4. **G4 采集通道扩展**：
   - **百家号**：新增纯 HTTP 通道（requests GET 文章页 → 解析 `window.jsonData` mthvideo sections → `content.https.file` mp4 直链 → 下载），无需 Playwright。
   - **小红书**：`browser_fetcher._BROWSER_FETCH_CONFIGS` 增加小红书配置（加载分享页 → 监听 `edith.xiaohongshu.com/api/sns/web/v1/feed` 或读水合后 `__INITIAL_STATE__` → `video.media.stream[].master_url`）。
   - **视频号**：detect_platform 接受域名但采集时报明确错误「视频号需要微信登录态，暂不支持自动采集」。
5. **错误分类补齐**：B站 412/-412/-352、小红书 "No video formats found"/404 → ANTI_BOT 降级触发。
6. **平台标签**：前端 `PLATFORM_KEYS`/`platformLabel` 与 locales（zh/en 成对）补 bilibili/zhihu/channels/baijiahao。

---

*调研执行：4 个并行子代理（yt-dlp 矩阵 / MediaCrawler / 抖音生态 / B站-小红书-知乎-百家号-视频号专项）+ 主会话本机实测。子代理报告原文已在本文件各节整合。*
