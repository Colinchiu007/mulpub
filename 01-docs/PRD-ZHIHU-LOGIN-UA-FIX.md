# PRD-ZHIHU-LOGIN-UA-FIX：知乎登录 10001 报错修复（UA 净化）

> **日期**：2026-09-11
> **类型**：Bug 修复
> **影响模块**：apps/desktop/electron/startup-compat.js、apps/desktop/electron/main.js、apps/desktop/vitest.config.js
> **关联页面**：账号管理（Accounts.vue）→ 添加账号 → 知乎 → 浏览器登录
> **分支**：codex/fix-zhihu-login-10001

---

## 一、问题现象

在账号管理页点击「添加账号」，选择知乎，在打开的登录页中输入手机号后，
点击「获取短信验证码」按钮，页面弹出报错：

```
10001:请求参数异常，请升级客户端后重试
```

## 二、根因分析

### 2.1 报错来源：知乎平台风控

该错误码由**知乎平台风控**产生，不是应用逻辑 bug。公开技术社区中大量
Selenium/Puppeteer 自动化场景出现完全相同的报错，公认原因是知乎登录风控
识别出**非标准浏览器客户端指纹**（UA 异常/自动化特征）后拒绝下发验证码。

### 2.2 触发源：Electron 默认 UA 暴露桌面壳标识

应用内嵌登录视图（WebContentsView）此前使用 Electron 默认 User-Agent：

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Multi-Publish/2.7.0 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36
```

其中 Multi-Publish/2.7.0 与 Electron/43.1.1 两个 token 明确暴露了
「桌面壳应用」身份，被知乎风控判定为非标准浏览器。全仓检索确认此前无任何
setUserAgent/userAgentFallback 调用。

### 2.3 参考方案：参考产品同类实现

参考产品 4.0（成熟同类多平台发布工具）在 Electron 主进程入口显式设置
app.userAgentFallback 为标准浏览器 UA（伪装 360 浏览器 Chrome/138），
彻底去掉 Electron 标记。其登录视图同样使用 WebContentsView + persist:auth
分区，与本应用架构一致。

## 三、修复方案

startup-compat.js 新增 configureUserAgentFallback()，在 main.js
启动时（任何 BrowserWindow 创建前）调用。采用 token 白名单机制：

- 白名单：Mozilla、Chrome、Safari、AppleWebKit、Gecko、like、Edg
- 剔除：Electron/x.y.z、Multi-Publish/x.y.z 等非浏览器 token
- 相比参考产品的硬编码 UA，本方案动态跟随 Chromium 内核版本（从
  app.userAgent 读取后净化），不会随内核升级而过期
- 幂等性：UA 无 Electron 标记时不写入
- 最小侵入：仅设置 userAgentFallback，不改动各 session/视图

净化后 UA：

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.114 Safari/537.36
```

## 四、测试逃逸修复（附带）

startup-compat.test.js 自 5093a330（2026-07-31）引入起**从未被 vitest
include 覆盖**——CI desktop-shards 使用同一 vitest.config，该文件从未在任何
CI 环境执行过。本次：

1. 纳入 vitest include（electron/startup-compat.test.{js,ts}）
2. 修复 4 个 Windows 路径分隔符断言（测试写死 / 分隔，Windows path.join
   返回反斜杠；改用 path.join() 构造期望值实现跨平台）
3. 新增 5 个 UA 净化测试（标准净化/幂等/边界/空格/Edg token）

## 五、验收标准

- [x] startup-compat 15/15 + main 22/22 测试全绿
- [x] tsc --noEmit、eslint 通过
- [x] electron-builder --win --dir 打包成功
- [x] asar 内含修复代码（extract 后验证 main.js 含调用）
- [x] 模拟真实 Electron UA 验证净化后无 Electron/AppName 标记且保留 Chrome 版本
- [x] opencode 外部审查通过（Critical: none；Edg token 建议已采纳）
- [ ] 真实知乎登录验证（获取短信验证码成功）需在打包应用中人工操作确认
      ——CI/单测无法替代第三方平台真实验收

## 六、影响面评估

UA 净化对全部平台登录视图生效（同一 session 池），但净化后的 UA 是
**标准 Chrome 浏览器形态**，对其他平台（微信/微博/抖音等）只会更接近
真实用户环境，无已知副作用。

