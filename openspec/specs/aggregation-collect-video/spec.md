# aggregation-collect-video Specification

## Purpose
定义采集页对多平台（抖音/小红书/B站/知乎/视频号）图文与视频作品链接的采集行为契约：视频作品经「元数据探测 → 下载 → 音频提取 → ASR 转写」管线提取口播文案，yt-dlp 被风控拦截时自动降级浏览器通道，与图文采集结果统一进入采集列表，含输入校验、资源上限、错误分类与进度反馈。
## Requirements
### Requirement: 视频链接识别与路由
采集页 SHALL 在用户触发采集时识别 URL 域名：匹配抖音（douyin.com 及子域、v.douyin.com 短链）、小红书（xiaohongshu.com 及子域、xhslink.com 短链）、B站（bilibili.com、b23.tv）、知乎（zhihu.com）、视频号（channels.weixin.qq.com）域名的链接 SHALL 路由到视频采集通道；其余链接 SHALL 走现有图文采集通道。路由失败时 SHALL 回退到现有图文采集降级链路（aggregation → url-collector），不得静默丢弃。

用户粘贴平台分享混合文本（文案+emoji+短链+引导语）时，前端 SHALL 先提取真实 http(s) 链接再路由；提取不到链接时提示「未在输入内容中找到有效链接」且不发起采集。

#### Scenario: 抖音视频链接路由
- **WHEN** 用户在 URL 输入框粘贴 https://v.douyin.com/xxxx/ 短链并点击采集
- **THEN** 前端调用视频采集通道（collect-video），不调用图文 collect 通道

#### Scenario: 小红书链接路由
- **WHEN** 用户粘贴 https://www.xiaohongshu.com/explore/xxxx 或 https://xhslink.com/xxxx 链接
- **THEN** 前端调用视频采集通道

#### Scenario: 非目标平台链接不受影响
- **WHEN** 用户粘贴知乎/微信公众号/普通网页链接
- **THEN** 走现有图文采集链路，行为与变更前完全一致

#### Scenario: 分享混合文本解析
- **WHEN** 用户粘贴「0.02 P@x.FH ... https://v.douyin.com/vknKdeN_naU/ 复制此链接...」混合文本并点击采集
- **THEN** 前端提取 https://v.douyin.com/vknKdeN_naU/ 回填输入框，走视频采集通道

#### Scenario: 分享文本无链接
- **WHEN** 用户粘贴不含任何 http(s) 链接的纯文本
- **THEN** 提示「未在输入内容中找到有效链接」，不发起任何采集请求

#### Scenario: 图文笔记含视频的处理
- **WHEN** 目标链接为抖音/小红书作品且元数据探测判定其含音轨
- **THEN** 走视频管线（下载 → 提音频 → ASR 转写）
- **WHEN** 目标链接判定为纯图文（无音轨/无视频流）
- **THEN** 提取标题与正文描述进入图文结果，不触发 ASR，并在结果中标注 media_type=article

### Requirement: 视频采集管线
视频采集通道 SHALL 按顺序执行四个阶段：① 元数据探测（yt-dlp --dump-json，获取标题/时长/平台/作者/封面，不下载文件；探测期时长超 10 分钟直接拒绝）；② 视频下载（yt-dlp，上限 500MB / 30 分钟；yt-dlp 被 ANTI_BOT 类错误拦截时自动降级浏览器通道）；③ 音频提取（ffmpeg 转 16kHz 单声道 WAV）；④ ASR 转写（引擎抽象层）。每阶段失败 SHALL 返回该阶段专属错误信息，不得继续后续阶段。

浏览器降级通道（browser_fetcher）SHALL：解析短链 302 Location 提取视频 ID → Playwright 桌面 Chrome 访问视频页 → 监听平台 detail API 响应提取播放地址 → 带 Referer 下载。降级仅对 ANTI_BOT 类错误触发（Fresh cookies/风控/验证码）；私密/会员/地区限制/已删除类错误不降级。浏览器通道也失败时 SHALL 返回「该链接需要平台登录态，自动采集暂不可用」。

#### Scenario: 全链路成功
- **WHEN** 输入可公开访问的抖音视频链接且各阶段成功
- **THEN** 返回 CollectResult，media_type=video，content 为转写文案全文，transcript 字段同 content，duration 为视频秒数，metadata 含 platform/asr_engine/segments

#### Scenario: 元数据探测失败
- **WHEN** yt-dlp --dump-json 因反爬/链接失效返回错误
- **THEN** 返回错误码 VIDEOCLONE_LINK_ANTI_BOT 或 VIDEOCLONE_LINK_UNAVAILABLE 对应的中文提示，不执行下载

#### Scenario: 视频超限
- **WHEN** 探测到的视频时长 > 30 分钟或下载文件 > 500MB
- **THEN** 返回 VIDEOCLONE_FILE_TOO_LARGE 语义的中文提示（含实际时长/大小），不执行音频提取

#### Scenario: 视频无音轨
- **WHEN** 下载的视频经检测无音频流
- **THEN** 返回错误码 -8 与提示「该视频无音轨，无法进行语音转写」

#### Scenario: 临时文件清理
- **WHEN** 管线完成（无论成功或失败）
- **THEN** 下载的视频与提取的音频临时文件 SHALL 被清理，不在用户磁盘残留

### Requirement: 采集结果模型扩展
CollectResult SHALL 新增可选字段 media_type（"article" | "video"，默认 "article"）、video_url、duration、transcript。旧数据（无这些字段）反序列化时 SHALL 得到默认值，现有图文采集行为与响应结构 SHALL 保持不变。视频采集时 content SHALL 填入转写文案，使下游改写/发布无需感知来源类型。

#### Scenario: 旧数据兼容
- **WHEN** 反序列化一个不含新字段的旧 CollectResult JSON
- **THEN** media_type 为 "article"，video_url/duration/transcript 为空值，无报错

#### Scenario: 视频结果字段完整
- **WHEN** 视频采集成功
- **THEN** 响应含 media_type="video"、video_url（原始链接）、duration>0、transcript 非空、word_count 为转写文案字数

### Requirement: 采集页视频结果显示
采集结果卡片 SHALL 按 media_type 区分显示：article 显示 📄 徽标与字数；video 显示 🎬 徽标、时长（mm:ss 格式）与来源平台标签（如「抖音」）。视频采集详情区 SHALL 显示完整转写文案并标注「🎬 视频口播文案」。转写进行中 SHALL 显示分阶段进度提示（探测元数据 → 下载视频 → 提取音频 → 语音转写）。

#### Scenario: 视频卡片渲染
- **WHEN** 采集列表中存在 media_type=video 的条目
- **THEN** 卡片显示 🎬 徽标、时长（如 3:25）与平台标签，内容预览为转写文案前 120 字

#### Scenario: 分阶段进度显示
- **WHEN** 视频采集任务处于下载或转写阶段
- **THEN** 采集按钮区显示当前阶段中文提示（如「⬇️ 正在下载视频...」「🎙️ 正在语音转写...」），采集按钮保持禁用

#### Scenario: 错误提示
- **WHEN** 视频采集失败（反爬/超限/无音轨/引擎不可用）
- **THEN** 错误区显示对应中文提示，可重试错误（网络类）显示重试按钮

### Requirement: 视频采集错误分类
视频采集通道 SHALL 复用现有下载错误分类语义（私密/会员/地区限制/版权/反爬/不可用）并新增三类错误：ASR 引擎不可用（-6，含安装指引）、转写超时（-7，默认 300 秒）、视频无音轨（-8）。所有错误 SHALL 返回中文用户提示，技术细节仅记录日志。

#### Scenario: ASR 引擎缺失
- **WHEN** faster-whisper 未安装且未配置在线引擎时发起视频采集
- **THEN** 返回错误码 -6 与提示「语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper」

#### Scenario: 转写超时
- **WHEN** ASR 转写超过 300 秒未完成
- **THEN** 返回错误码 -7 与提示「转写超时，请尝试较短的短视频」，临时文件被清理

