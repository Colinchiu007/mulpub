# 参考产品二次挖掘 — 补充发现

> 基于对主进程（141,499 行 webpack bundle）和前端（React 19）的深度分析，补充第一版报告中遗漏的关键技术方案。

---

## P0 — 立即采纳

### 1. Network Response 拦截（替代 DOM 轮询）

**发现源**：`listenFetch()` 函数（index.cjs ~line 110287）

参考产品在所有 RPA 页面中通过 **Chrome DevTools Protocol** 直接拦截 XHR/Fetch 响应来判断发布结果，而不是轮询 DOM：

```javascript
// 注入 CDP debugger 拦截网络响应
await view.webContents.debugger.attach();
await view.webContents.debugger.sendCommand("Fetch.enable", {
  patterns: [
    { urlPattern: `*douyin.com*create*`, resourceType: "XHR", requestStage: "Response" },
    { urlPattern: `*douyin.com*post*`, resourceType: "Fetch", requestStage: "Response" },
  ]
});

view.webContents.debugger.on("message", async (_, method, params) => {
  if (method !== "Fetch.requestPaused") return;
  const { body, base64Encoded } = await view.webContents.debugger.sendCommand(
    "Fetch.getResponseBody", { requestId: params.requestId }
  );
  const data = JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString() : body);
  if (data.code === 0) { /* 发布成功 */ }
  await view.webContents.debugger.sendCommand("Fetch.continueRequest", { requestId });
});
```

**对 Multi-Publish 的意义**：

当前 `_do_publish()` 中，检测发布是否成功靠的是 `wait_for_selector('.upload-success', timeout=600s)` + `asyncio.sleep(5)` —— 极度不可靠。Platform UI 一改版就废。

改用 CDP 拦截后：
- 直接监听平台后端 API 的 JSON 响应 → 100% 准确
- 不需要等待 DOM 渲染 → 更快（响应到即知成败）
- 不受 UI 改版影响

**Playwright 实现方式**（可直接用于 douyin.py）：

```python
# Playwright 也支持 CDP（Chrome DevTools Protocol）
page = await context.new_page()
# 附加 CDP session
cdp_session = await context.new_cdp_session(page)
await cdp_session.send("Fetch.enable", {
    "patterns": [{
        "urlPattern": "*douyin.com/web/api/media/aweme/create/*",
        "resourceType": "XHR",
        "requestStage": "Response"
    }]
})

# 监听响应
cdp_session.on("Fetch.requestPaused", lambda params: ...)
```

### 2. Per-Field 重试状态机

**发现源**：`renderTaskMap`（index.cjs ~line 109589）

参考产品的 RPA 代码对每个表单字段（标题、描述、标签、视频、位置）**各自维护独立的 retry 计数器**，而非全局重试：

```javascript
const renderTaskMap = { video: 0, title: 0, description: 0, local: 0 };
const retryCount = 5;

async function render(config) {
  if (renderTaskMap.video < retryCount) return;        // 等视频上传完

  if (renderTaskMap.title < retryCount) {
    const titleDom = document.querySelector('input[...]');
    if (titleDom) {
      await onSendInput(titleDom, config.title);
      renderTaskMap.title = retryCount;                 // 标记完成
    }
    renderTaskMap.title++;                               // 计数 +1
  }

  const taskList = Object.keys(renderTaskMap)
    .filter(key => renderTaskMap[key] < retryCount);
  if (!taskList.length) isDone = true;                   // 全部完成
}
```

**对 Multi-Publish 的意义**：

当前 `_do_publish()` 中，标题填写失败 → 整个发布失败。实际场景中，标题可能因为 DOM 选择器失效而失败，但视频已经上传成功了。

per-field 状态机的好处：
- 标题填不上 → 不影响视频上传状态
- 每个字段独立跑满 5 次重试后才放弃
- 所有字段完成后自动推进到下一步

---

## P1 — 近期优化

### 3. 进度事件节流阀（UploadEmitGate）

**发现源**：`UploadEmitGate` 类（index.cjs ~line 145）

```javascript
class UploadEmitGate {
  constructor(fileSize, totalParts) {
    this.fileSize = fileSize;
    this.totalParts = totalParts;
    this.lastEmitTime = 0;
    this.lastEmitPercent = 0;
  }
  shouldEmit(currentPart) {
    if (this.fileSize > 100 * 1048576) {  // > 100MB: 5秒限频
      return Date.now() - this.lastEmitTime >= 5000;
    }
    // 小文件: 每 10% 进度发一次
    const progress = currentPart / this.totalParts;
    if (this.totalParts > 10 && progress - this.lastEmitPercent < 0.1) return false;
    this.lastEmitPercent = progress;
    return true;
  }
}
```

**对 Multi-Publish 的意义**：我们当前的 `_report_progress` 没有限频。对于大文件上传，progress callback 每秒会被调用几十次，徒增 IPC 和磁盘写入开销。应该加一个 throttle。

```python
# 可直接复用的 throttle
class ProgressThrottle:
    def __init__(self, min_interval=5.0, min_percent_delta=10):
        self.last_time = 0
        self.last_percent = 0
        self.min_interval = min_interval
        self.min_percent_delta = min_percent_delta

    def should_report(self, percent: int) -> bool:
        now = time.time()
        if percent == 100:
            return True  # 完成必须报
        if percent - self.last_percent < self.min_percent_delta:
            if now - self.last_time < self.min_interval:
                return False
        self.last_time = now
        self.last_percent = percent
        return True
```

### 4. Per-Account 分区 Session 隔离

**发现源**：`createTab()` 中的 session partition（index.cjs ~line 119927）

```javascript
if (extra?.accountId) {
  ses = session.fromPartition(`persist:auth-${accountId}`);
  await ses.clearData();
  await ses.clearCache();
}
```

蚂参考产品每个账号使用独立的 `persist:auth-{accountId}` session partition。同一个平台的多账号之间 cookie 不会互相干扰。

**对 Multi-Publish 的意义**：我们当前所有账号共享同一个 `browser_data` 目录。当用户要在抖音上切换账号发布时，可能因为残留 cookie 导致登录态错乱。应该为每个 account_id 分配独立的 browser_data 子目录。

### 5. Per-Module 结构化日志 + 轮转

**发现源**：log4js 配置 + winston DailyRotateFile（index.cjs ~line 112125）

```javascript
// 三种不同 scope 的 logger
src_logger     // 主进程
webview_logger // WebviewManager
rpa_logger     // RPA 执行

// 日志轮转配置
new DailyRotateFile({
  filename: path.join(logPath, "publish_service_%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: "3m",     // 3MB 轮转
  maxFiles: "7d",    // 保留 7 天
})
```

**对 Multi-Publish 的意义**：我们当前所有日志往同一个 `loguru` handler 输出。新增 per-module logger 后可分别排查：
- `publish_douyin.log` — 只包含抖音发布日志
- `publish_wechat.log` — 只包含微信发布日志
- `server.log` — 后端服务日志

---

## P2 — 后续可做

### 6. SOCKS5 代理 per-Tab

**发现源**：`createTab()` 中的 proxy 配置（index.cjs ~line 119986）

支持为每个发布任务配置独立的 SOCKS5 代理（含用户名密码认证），并且自动清理。

### 7. 平台间 2 秒间隔 + 并发控制

**发现源**：`rpaVideoStart()` 中的执行循环（index.cjs ~line 111360）

蚁小批批量发布时逐个平台串行，每个平台 fire-and-forget 后 await 2 秒再启动下一个。我们的 `publish_to_platforms` 目前是串行的，但缺少这个间隔，可能导致平台端并发限流。

### 8. URL 复制反馈（小 UX 细节）

点击复制 URL 后，按钮临时变成绿色勾 2 秒再恢复，用户能感知"已复制"。可以在 Multi-Publish 的发布结果页加这个。

---

## 总结：新增可落地项

| # | 方案 | 优先级 | 影响面 | 工作量 |
|---|------|--------|--------|--------|
| 1 | CDP 网络拦截替代 DOM 轮询 | P0 | douyin.py + base.py | ~半天 |
| 2 | Per-Field 重试状态机 | P0 | douyin.py `_do_publish` | ~2小时 |
| 3 | 进度节流阀 | P1 | base.py ProgressThrottle | ~30分钟 |
| 4 | Per-Account Session 隔离 | P1 | base.py + douyin.py | ~半天 |
| 5 | Per-Module 日志轮转 | P1 | 全局 logging 配置 | ~1小时 |

> 之前报告中的项（localStorage/IndexedDB、API 双模式、插件注册表、async_retry、XPath 工具、进度管理）已完成。
> 本次报告补充了 8 个新发现，其中 P0 项 2 个（CDP 拦截、per-field 重试）、P1 项 3 个（节流阀、session 隔离、日志轮转）。
