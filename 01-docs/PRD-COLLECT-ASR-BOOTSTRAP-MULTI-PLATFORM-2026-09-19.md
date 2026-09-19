# PRD — 采集页 ASR 依赖引导安装 + 多平台视频采集 + 分享链接解析 + 反爬降级

- 文档编号：PRD-COLLECT-ASR-BOOTSTRAP-MULTI-PLATFORM-2026-09-19
- 状态：已实现（Phase 1）
- 关联分支：codex/fix-collect-asr-bootstrap
- 关联模块：apps/desktop/src/views/Collection.vue、apps/desktop/electron/services/asr-installer.js、packages/python-backend/src/multi_publish/aggregation/{video_service,browser_fetcher,asr_engine}.py
- 创建日期：2026-09-19

## 1. 背景与问题

### 1.1 用户报错

采集页粘贴抖音链接点击采集，报错「语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper」。该提示要求用户手动开终端执行命令，对非技术用户不友好。

### 1.2 根因链（三层问题叠加）

1. **依赖缺失无引导**：faster-whisper 是可选依赖（pyproject [asr] 组），缺失时只返回一条文案（asr_engine.py:160 install_hint），无弹窗、无自动安装。
2. **抖音采集被风控**：yt-dlp 2026.8.19 对抖音报「Fresh cookies (not necessarily logged in) are needed」，该错误落入兜底分类「视频下载失败，请检查链接后重试」，用户无从下手。
3. **分享文本无法解析**：抖音「复制链接」是「文案+emoji+短链+引导语」混合文本，直接当 URL 用会解析失败。

### 1.3 实测证据（2026-09-19）

- Playwright 桌面 Chrome 访问 douyin.com/video/{id} + 监听 aweme/v1/web/aweme/detail/ API 可拿到 play_addr url_list
- 带 Referer: https://www.douyin.com/ 下载播放地址返回 206 OK（无 Referer 返回 403）
- 全链路（浏览器取址→下载→ffmpeg 提音频→faster-whisper 转写）65.7s 视频实测 17-23 秒完成

## 2. 功能范围

### 2.1 ASR 依赖安装引导弹窗（P0）

**触发条件**：视频采集返回 -6（ASR 引擎不可用）时，自动弹出安装引导弹窗（不再显示错误横幅）。

**弹窗内容**：

| 显示项 | 内容 |
|--------|------|
| 标题 | 安装语音转写组件 |
| 说明文字 | 首次使用视频采集需要安装语音转写组件（faster-whisper，约 500MB 依赖 + 141MB 模型）。安装过程自动选择国内镜像源，失败时自动切换备用镜像。安装完成后即可采集视频口播文案。 |
| 主按钮 | 立即安装 |
| 次按钮 | 暂不安装 |
| 进度区 | 阶段文字 + 详情行 + 进度条（蓝色填充，宽度按 percent） |
| 失败区 | ❌ 错误信息 + 手动安装命令（可选中复制）+ 重试按钮 |

**安装阶段与进度事件**（asr-install:progress IPC 事件推送）：

| stage | 用户提示 | percent |
|-------|---------|---------|
| checking | 正在检查 Python 环境... | - |
| installing | 正在安装 faster-whisper（国内镜像加速）... | 5-10（pip 输出行实时更新 detail） |
| switching | 当前镜像源不可用，正在切换备用镜像... | - |
| installed | faster-whisper 安装成功 | 100 |
| model-checking | 检查语音模型缓存... | - |
| model-downloading | 正在下载语音模型（约 141MB，国内镜像加速）... | 30 |
| model-downloaded | 模型下载完成 | 100 |
| done | 安装完成，即将开始采集 | 100 |
| failed | 安装失败 | - |

**pip 镜像源优先级**（自动切换）：

1. https://pypi.tuna.tsinghua.edu.cn/simple（清华）
2. https://mirrors.aliyun.com/pypi/simple/（阿里）
3. https://mirrors.cloud.tencent.com/pypi/simple（腾讯）
4. https://pypi.org/simple（官方 PyPI 兜底）

**模型下载源优先级**（Python 侧 asr_engine 内置）：

1. 用户显式 HF_ENDPOINT 环境变量（尊重配置不覆盖）
2. https://hf-mirror.com（HEAD 探测 5s 超时）
3. https://huggingface.co（直连兜底）

**安装成功后行为**：弹窗显示「安装完成，即将开始采集」1.2 秒后自动关闭，并自动用原 URL 重试采集（用户无需重新粘贴）。

**数据校验**：

- 安装前校验 Python 可用，失败提示「Python 环境不可用，请确认已安装 Python 3.10+ 并加入 PATH」
- 每个镜像源安装后验证 import faster_whisper 成功才算该源安装成功
- 安装目标解释器 = 应用当前绑定的 MP_PYTHON（与后端一致，避免装错环境）

### 2.2 多平台视频采集扩展（P0）

**平台域名表扩展**（Python PLATFORM_DOMAINS + 前端 VIDEO_PLATFORM_DOMAINS 同步）：

| 平台 | 域名 | 采集方式 |
|------|------|---------|
| 抖音 | douyin.com（含 v.douyin.com 短链） | yt-dlp → 失败自动降级浏览器通道 |
| 小红书 | xiaohongshu.com、xhslink.com | yt-dlp → 失败自动降级浏览器通道 |
| B站 | bilibili.com、b23.tv | yt-dlp（原生支持，19 个 extractor） |
| 知乎 | zhihu.com | yt-dlp（原生支持） |
| 视频号 | channels.weixin.qq.com | yt-dlp 尝试 → 失败提示需微信客户端 |

注：快手无公开视频页 yt-dlp extractor，本次不加入域名表（避免假支持）。

**yt-dlp 失败自动降级（抖音/小红书）**：

collect_video(url) 执行流程：
1. yt-dlp --dump-json 探测 + yt-dlp 下载
2. 成功 → 继续 ffmpeg → ASR
3. 失败且错误分类 = ANTI_BOT（Fresh cookies/风控/验证码）→ 自动降级浏览器通道
4. 浏览器通道步骤：
   - resolve_short_link：v.douyin.com/xxx 302 Location → iesdouyin share/video/{id}
   - extract_video_id：正则提取数字 ID（支持 /video/{id}、/share/video/{id}、?modal_id=）
   - Playwright 桌面 Chrome 访问 douyin.com/video/{id}（UA/viewport/locale 模拟真实用户）
   - page.on('response') 监听 aweme/v1/web/aweme/detail/ API 响应
   - 解析 JSON 路径 aweme_detail.video.play_addr.url_list[0] 得播放地址
   - 带 Referer 下载（抖音 CDN 校验 Referer，缺失 403）
   - 元数据：title=desc、author=author.nickname、duration=毫秒/1000
5. 浏览器通道也失败 → 报错「该链接需要平台登录态，自动采集暂不可用」

**降级触发条件**（仅 ANTI_BOT 类错误降级，其他不降级——降级也不会成功）：

| 错误分类 | 降级 | 原因 |
|---------|------|------|
| Fresh cookies / login required / 风控 / 验证码 | 是 | 浏览器通道可绕过 |
| 私密 / 会员 / 地区限制 / 已删除 | 否 | 内容本身不可访问 |
| 超时 / 网络错误 | 否 | 重试更合适 |

### 2.3 分享文本链接解析（P0）

**触发条件**：输入内容含空白字符（混合文本特征）或不以 http(s) 开头时，采集前先解析。

**解析规则**：

1. 正则提取全部 http(s) 链接（容忍中文/emoji 混排与尾部标点）
2. 清理尾部粘连标点（。，,；;！!？?）)】]）
3. 多链接时优先返回视频平台域名（douyin/iesdouyin/xiaohongshu/xhslink/bilibili/b23/zhihu/channels.weixin）
4. 无视频平台链接时返回第一个链接
5. 提取后回填输入框（用户可见真实链接）+ toast「已从分享文本中提取链接」

**失败场景**：提取不到任何链接且输入不以 http 开头 → toast「未在输入内容中找到有效链接，请粘贴包含链接的分享文本」，不发起采集。

### 2.4 反爬加固（P0）

本次落地的反爬措施：

1. **浏览器降级通道本身就是反爬对策**：桌面 Chrome UA + 真实视口（1280x800）+ zh-CN locale，模拟真实用户访问，绕过纯 HTTP 请求的指纹检测。
2. **Fresh cookies 错误正确分类**：新增 classify_download_error 分支，fresh cookies|cookies are needed|login required|需要登录 → ANTI_BOT（可重试+自动降级），不再落入误导性的「请检查链接」。
3. **既有防护层保持**：限速（抖音 30-90s 间隔）/熔断/冷却池/每日预算/周末衰减（collection-engine default-strategies.json）继续生效。

## 3. 交互流程

用户粘贴抖音分享文本 → 点击「采集」：
1. 分享文本解析：提取 https://v.douyin.com/vknKdeN_naU/ → 回填输入框
2. 域名检测：douyin.com → 视频采集通道
3. 阶段提示：探测→下载→提音频→转写（假进度）
4. Python collect_video：yt-dlp 被 Fresh cookies 拦截 → 分类 ANTI_BOT → 自动降级浏览器通道 → 下载视频 → ffmpeg 提音频 → faster-whisper 转写 → 返回 CollectResult
5. 成功：卡片入列表（🎬 徽标+时长+平台）→ toast「内容采集成功」

若 ASR 引擎缺失（-6）：自动弹出安装引导弹窗 → 用户点「立即安装」→ pip 多镜像自动安装 + 模型下载（进度实时展示）→ 安装成功 → 弹窗自动关闭 → 自动重试原采集请求。

## 4. 错误码与提示文字

| 错误码 | 场景 | 用户提示（zh） | 处理 |
|--------|------|---------------|------|
| -6 | ASR 引擎缺失 | （弹窗）首次使用视频采集需要安装语音转写组件... | 自动安装引导 |
| VIDEOCLONE_LINK_ANTI_BOT | yt-dlp Fresh cookies | （内部）该链接需要登录态才能采集，正在尝试浏览器通道 | 自动降级 |
| VIDEOCLONE_LINK_ANTI_BOT | 浏览器通道也失败 | 该链接需要平台登录态，自动采集暂不可用（{原因}）。请稍后重试或更换链接 | 显示错误 |
| VIDEOCLONE_INVALID_PLATFORM | 不支持的平台 | 仅支持抖音/小红书/B站/知乎/视频号视频链接，当前链接域名不受支持: {url} | 显示错误 |
| ASR_DOWNLOAD_FAILED | 模型下载失败 | 模型下载失败：网络无法连接下载源。请检查网络连接... | 显示错误+重试 |

## 5. 测试计划与结果

| 层 | 文件 | 覆盖 | 结果 |
|----|------|------|------|
| Python 单元 | tests/test_aggregation_video.py | 平台检测（含新平台）/错误分类/降级触发/时长前置检查/镜像多源切换（43 用例） | 43 passed |
| Python 单元 | tests/test_browser_fetcher.py | ID 提取/短链解析/嵌套取值/错误结构（9 用例） | 9 passed |
| IPC 合同 | electron/ipc-handlers/aggregation.test.js | 通道注册/调用参数/错误分类（18 用例） | 18 passed |
| preload | electron/preload.test.js | API 暴露（353 用例） | 353 passed |
| 前端组件 | src/views/Collection.test.js | 分享文本提取/-6 弹窗触发/无链接拦截/既有回归（93 用例） | 93 passed |
| locale | .github/scripts/check-locale-sync.js | zh/en 成对 + CJK 无新增硬编码 | PASS |
| 构建 | npx vite build | 前端编译 | 14.7s 完成 |
| E2E 实测 | 手动 | 抖音分享文本→提取→降级→下载→转写全链路 | 17s 完成 |

## 6. 非功能需求

1. **资源上限不变**：视频 ≤500MB / ≤10 分钟 / 下载超时 300s（浏览器通道 180s）/ 转写超时 300s。
2. **临时文件零残留**：tempfile.TemporaryDirectory 上下文保证。
3. **向后兼容**：CollectResult 字段不变（新增 metadata.fetch_channel）；既有图文采集链路零改动；旧错误码语义不变（-6 仍代表引擎不可用，只是前端处理从横幅变弹窗）。
4. **安全**：短链解析只取一层 302 Location（不跟随多次重定向）；浏览器通道 headless + no-sandbox；pip 安装用应用绑定解释器。

## 7. 已知限制与后续

1. 视频号（channels.weixin.qq.com）域名已入表，但 yt-dlp 无 extractor，实际采集大概率失败并提示需登录态——这是「尽力支持」的预期行为。
2. 浏览器降级通道每次请求启动新 Chromium 实例（约 3-5s 开销）；高频采集场景可优化为单例复用（frame_html.py 已有模式可参考）。
3. pip 安装进度只有行级 detail（pip 不提供结构化百分比）；模型下载进度同理。结构化进度需 Phase 2 任务化改造。
