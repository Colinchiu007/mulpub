# 参考产品 4.0 反编译分析报告

> 目标：研究参考产品桌面端的架构设计，提取可参考的关键技术方案用于优化 Multi-Publish。

---

## 核心结论

**Multi-Publish 当前的架构方向是对的（Python RPA），但参考产品有一个更优的方案值得借鉴：Electron webContents.executeJavaScript() 直接操控页面 DOM，取代 Playwright。**

---

## 一、整体架构

### 应用信息
- 名称：参考产品 4.0（v4.13.8）
- 框架：Electron + React 19 + socket.io
- 构建：Webpack 5（模块联邦，3 个子包）
- 依赖：axios, zod, dayjs, socket.io, lucide-react

### 包结构
```
packages/
  main/dist/index.cjs       ← 主进程（webpack 打包，14 万行）
  preload/dist/index.cjs    ← 预加载脚本
  renderer/dist/*.js        ← React 前端（Vite 打包）
```

### 核心架构模式
```
┌─────────────────────────────────────────────────┐
│                  参考产品 4.0                       │
│                                                   │
│  ┌──────────────┐     ┌──────────────────────┐   │
│  │  Renderer     │     │  Main Process         │   │
│  │  (React UI)   │────▶│  ┌────────────────┐  │   │
│  │               │IPC  │  │ mp-rpa   │  │   │
│  │               │◀────│  │ (platformMaps) │  │   │
│  └──────────────┘     │  └────────────────┘  │   │
│                        │       │               │   │
│  ┌──────────────┐     │       ▼               │   │
│  │  Webview     │◀────│  ┌────────────────┐  │   │
│  │  (平台页面)   │     │  │ executeJS 注入  │  │   │
│  │               │     │  │ DOM 操控        │  │   │
│  └──────────────┘     │  └────────────────┘  │   │
│                        └──────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 二、关键架构发现（最值得借鉴的部分）

### 2.1 替代 Playwright 的方案：webContents.executeJavaScript()

**这是最大的架构差异点。** 参考产品完全不用 Playwright，而是利用 Electron 自带的 `<webview>` / `BrowserView`，通过 `view.webContents.executeJavaScript(code)` 直接向平台页面注入 JavaScript 代码，操控 DOM。

**核心流程（RPA 模式）：**
```
1. 打开隐藏的 Electron BrowserView/webview
2. 导航到平台上传页（如 creator.douyin.com）
3. 注入 cookies + localStorage + IndexedDB 恢复登录态
4. 执行 platform-specific JS code:
   - 上传文件（通过 IPC 读取本地文件 → 创建 File 对象 → dispatchEvent）
   - 填写标题/标签/简介
   - 点击发布按钮
5. 轮询 isDone 标志确认完成
```

**相比 Playwright 的优势：**
| 维度 | Playwright | webContents.executeJS |
|------|-----------|----------------------|
| 启动速度 | 慢（需启动独立浏览器） | 零开销（复用 Electron） |
| 资源占用 | 高（额外 ~200MB） | 低（同进程） |
| 安装复杂度 | 需 `playwright install chromium` | 无需额外安装 |
| 跨平台 | 需配置浏览器路径 | Electron 原生支持 |
| DOM 操作能力 | Playwright API（封装） | 原生 JS（无抽象层） |
| 文件上传 | 通过 `set_input_files()` | 通过 File API + dispatchEvent |

**核心代码模式：**

```javascript
// 注入 JS 到平台页面
const code = `/* 平台特定的 DOM 操作代码 */`;
await view.webContents.executeJavaScript(genBaseCode(code, task.tabId));

// 轮询执行
while (true) {
  await wait(1000);
  // 注入 render 函数
  await view.webContents.executeJavaScript(`render(${JSON.stringify(task)})`);
  // 检查是否完成
  const isDone = await view.webContents.executeJavaScript('isDone');
  if (isDone) break;
}
```

### 2.2 双模式发布：API + RPA

**API 模式**（对抖音视频发布等场景）：
```javascript
// 直接调用平台内部 API，不走浏览器
douyinPublishVideo = async (task) => {
  // 1. 从 cookie/localStorage 提取 SDK token
  ge = await getSdkToken$(cookies);
  
  // 2. 分片上传视频（HTTP）
  uploadVideoPart$(buffer, partNum, ...);
  
  // 3. 校验上传
  check = await checkVideoUpload(token, crc32s);
  
  // 4. 调用发布 API
  publish = await publishVideo(token, metadata);
};
```

**RPA 模式**（对其他所有平台）：
```javascript
douyinRun = videoRun(`/* DOM 操作代码 */`);
// 注入到 webview 执行
```

**选择逻辑：** 对于支持 API 的平台（目前只有 Douyin 视频），走 API 模式；其余全部走 RPA 注入模式。

### 2.3 认证信息捕获（最关键的技术点）

参考产品在登录时捕获三类信息：

| 类型 | 示例（抖音） | 用途 |
|------|------------|------|
| Cookies | `sid_tt`, `bd_ticket_guard_client_data`, `sessionid` | HTTP API 鉴权 |
| localStorage | `security-sdk/s_sdk_crypt_sdk`, `s_sdk_sign_data_key/web_protect` | API 签名/加密 |
| IndexedDB | `secure-store` 中的 `s_sdk_cert_key` 等 | RPA 模式恢复登录 |

**登录恢复流程：**
```javascript
// 1. 写入 localStorage
for (const key in savedData.localStorage) {
  window.localStorage.setItem(key, savedData.localStorage[key]);
}

// 2. 写入 IndexedDB
await writeToIndexedDB(webContents, {
  "security-sdk/s_sdk_cert_key": "...",
  "security-sdk/s_sdk_sign_data_key/web_protect": "...",
  "security-sdk/s_sdk_crypt_sdk": "..."
});

// 3. 添加 cookies
// 通过 session.cookies.set() 或 Set-Cookie header
```

**这对我们 Multi-Publish 的意义：**
- 当前我们的 Douyin 发布器只保存了 cookies，缺失了 IndexedDB 和 localStorage
- 对于抖音 API 模式来说，IndexedDB 中的 `s_sdk_crypt_sdk` 和 `s_sdk_sign_data_key` 是必需的
- **这是 RPA 模式频繁丢失登录态的根因** — 只恢复 cookies 不够

### 2.4 平台适配器架构（插件化）

```javascript
// 主进程中的 AutoAuth 类
const authAuth = new (class AutoAuth {
  get() {
    // 动态加载平台映射，支持热更新
    if (!fs.existsSync(rpaFilePath)) {
      return _mp_rpa__.platformMapsIn;  // 内置的
    }
    // 从外部文件加载（可独立更新）
    return require(rpaFilePath).platformMapsIn;
  }
})();

// 平台映射
platformMapsIn = {
  DouYin: douyinAuth,
  KuaiShou: kuaishouAuth,
  XiaoHongShu: xiaohongshuAuth,
  WeiXinGongZhongHao: gongzhonghaoAuth,
  // ... 共 37 个平台
};
```

**插件化思路：** 平台适配器可以独立于主应用更新。`rpaFilePath` 指向一个外部的 `mp-rpa` 包，修改平台逻辑无需发布新版本。

### 2.5 浏览器交互层设计

**`videoRun` / `imageRun` 工厂函数：**
```javascript
function videoRun(code, key) {
  return async (task) => {
    const view = getView(task.tabId);
    
    // 注入加载指示器（SVG 动画浮层）
    await view.webContents.executeJavaScript(genBaseCode(code, task.tabId));
    
    // 轮询执行平台代码
    while (true) {
      await wait(1000);
      if (view.webContents.isLoading()) continue;
      
      // 注入 renderVideo 进行视频上传
      await view.webContents.executeJavaScript(`renderVideo(${JSON.stringify(task)})`);
      
      // 注入 render 检查发布结果
      const isDone = await view.webContents.executeJavaScript('isDone');
      if (isDone) break;
    }
  };
}
```

`code` 参数是平台特定的 JS 代码字符串，编译时打包进 webpack bundle。每个平台有独立的 `renderVideo`、`renderImage` 和 `render` 函数。

### 2.6 文件上传技巧

```javascript
// 1. IPC 读取文件到 Buffer（主进程）
window.app.ipcRenderer.invoke("read-file-buffer", filePath);

// 2. 创建 File 对象
function uint8ArrayToFile(uint8Array, fileName, mimeType) {
  const blob = new Blob([uint8Array], { type: mimeType });
  return new File([blob], fileName, { type: mimeType });
}

// 3. 手动触发 change 事件
function manualDispatchFileEvent({ dom, element, elementKey, event, value }) {
  const proto = Object.getOwnPropertyDescriptor(element.prototype, elementKey);
  if (proto && proto.set && dom) {
    proto.set.call(dom, value);
    dom.dispatchEvent(new Event(event, { bubbles: true }));
  }
}

// 4. 使用 DataTransfer 处理多文件
const files = new DataTransfer();
files.items.add(file);
manualDispatchFileEvent({
  dom: input,
  element: HTMLInputElement,
  elementKey: "files",
  value: files.files,
  event: "change"
});
```

### 2.7 DOM 查找工具

```javascript
// XPath 基础的元素查找（比 querySelector 更可靠）
function getElementByText(dom, text, container = document) {
  const xpathResult = document.evaluate(
    `//${dom}[text()='${text}']`,
    container, null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
  );
  return xpathResult.singleNodeValue;
}

// 带重试的等待
async function retry(fn, maxRetries = 5) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      const result = await fn();
      if (result) return;
    } catch {}
    attempts++;
    await wait(1000);
  }
}
```

---

## 三、平台支持列表（37 个）

与我们的 12 个对比，参考产品多了这些平台：

| 类别 | 参考产品独有平台 |
|------|--------------|
| 长文平台 | 简书、CSDN、豆瓣、雪球 |
| 视频平台 | 爱奇艺、腾讯视频、AcFun、咪咕、美拍 |
| 电商 | 得物、WiFi万能钥匙 |
| 汽车 | 易车、车家号 |
| 垂直 | 饿了么（蜂鸟）、大鱼号、趣头条 |

**对 Multi-Publish 的启示：** 优先覆盖核心平台（微信、微博、知乎、抖音、小红书、B站），再逐步扩展长尾平台。

---

## 四、对 Multi-Publish 的优化建议

### P0 — 立即采纳

1. **抛弃 Playwright，改用 Electron webContents.executeJavaScript()**
   - 移除 `playwright` 依赖和 `playwright install chromium` 步骤
   - 利用 Electron 自带的 `<webview>` 加载平台页
   - 大幅降低安装复杂度，提升稳定性
   - 用户无需额外下载浏览器（当前 Electron 自带 Chromium）

2. **登录捕获 localStorage + IndexedDB**
   - 当前只保存 cookies，导致抖音发布时频繁失效
   - 需要同步捕获 localStorage 中的 `security-sdk/*` 值
   - 需要写入 IndexedDB `secure-store` 存储
   - 登录恢复时：写 cookies → 写 localStorage → 写 IndexedDB → 重载页面

### P1 — 近期优化

3. **双模式发布架构**
   - 优先走 API 模式（直接调用平台内部 API）
   - 降级到 RPA 注入模式（webview + executeJS）
   - 平台适配器使用统一接口：`{ auth, publish, validate }`

4. **平台适配器插件化**
   - 将各平台发布逻辑抽成独立包，支持热更新
   - 主应用通过 `require()` 或 IPC 动态加载

5. **DOM 交互工具库**
   - 实现 `getElementByText()`（XPath）
   - 实现 `manualDispatchFileEvent()`（文件上传）
   - 实现 `retry()` 重试机制
   - 复用这些工具到所有平台

### P2 — 后续改进

6. **使用 Electron BrowserView 替代弹出窗口**
   - 用户无感的后台浏览器操作
   - 避免窗口切换干扰

7. **统一进度管理**（参考产品已有 publishStatusEnum）
   - `preparing → uploading → publishing → done/failed`
   - 每个阶段精确百分比

8. **平台分类**（参考产品至少分 3 类）：
   - 纯视频平台（抖音、快手、视频号）
   - 图文平台（微信公众号、知乎、简书）
   - 混合平台（微博、小红书、B站）

---

## 五、当前 Multi-Publish 架构 vs 参考产品

| 维度 | Multi-Publish (当前) | 参考产品 | 差距 |
|------|-------------------|--------|------|
| RPA 引擎 | Playwright（独立进程） | Electron webContents.executeJS | 参考产品更轻量 |
| 平台数 | 12 | 37 | -25 |
| API 模式 | ❌ 仅有 RPA | ✅ API + RPA 双模 | 需补 |
| 登录信息 | 仅 cookies | cookies+localStorage+IndexedDB | 需补 |
| 文件上传 | set_input_files | File dispatchEvent | 差距不大 |
| 插件化 | ❌ 硬编码 | ✅ 独立包动态加载 | 需补 |
| 稳定性 | 依赖 Playwright 版本 | 纯 JS 无外部依赖 | 参考产品更稳 |

---

## 六、结论

**最核心的差异化建议：** 将 RPA 引擎从 Playwright 迁移到 Electron webContents.executeJavaScript()。这样不仅更轻量、更稳定，而且可以完全掌控 DOM 操作逻辑，不受 Playwright 版本更新或浏览器兼容性影响。

**最紧急的 bug 修复：** 抖音发布器当前只保存 cookies，缺少 localStorage 和 IndexedDB 中的 `security-sdk/*` 值，这是登录态频繁失效的根本原因。登录时需要完整捕获这三类信息。

> 详情可查看反编译源码：`D:\Program Files\mp\resources\app.asar`
