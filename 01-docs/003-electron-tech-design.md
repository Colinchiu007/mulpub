# PROJECT-003：多平台一键发布 - Electron + Playwright 技术设计方案

> **文档版本**：v0.1.0  
> **创建日期**：2026-06-07  
> **作者**：CEO (QClaw)  
> **状态**：草案（待技术评审）

---

## 一、技术路线变更决策

### 1.1 原方案（已废弃）❌

**方案**：Web SaaS（FastAPI + Jinja2 + 浏览器自动化）  
**问题**：
1. ❌ **跨域操作**：Web 前端 JS 不能操作抖音/小红书/公众号的页面 DOM
2. ❌ **登录态托管**：用户 cookie/session 不能集中存服务器（安全+风控）
3. ❌ **视频上传成本**：用户视频 → 服务器 → 再转发，带宽爆炸 + IP 被风控

### 1.2 新方案（当前）✅

**方案**：Windows 桌面客户端（Electron + Playwright + Python 后端）  
**优势**：
1. ✅ **本地浏览器实例**：Playwright 直接控制 Chromium，模拟真人操作
2. ✅ **登录态本地存储**：Cookie 加密存在用户电脑，不碰服务器
3. ✅ **视频直传**：用户本地浏览器直传平台，不走服务器中转
4. ✅ **绕过平台风控**：用户本地 IP + 真人操作模式，不容易被检测

---

## 二、技术架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                   用户本地电脑                         │
│                                                     │
│  ┌─────────────────────────────────────────────┐     │
│  │          Electron 桌面客户端                │     │
│  │                                             │     │
│  │  ┌───────────┐  ┌──────────────────┐   │     │
│  │  │  Vue.js   │  │  Playwright      │   │     │
│  │  │  前端界面  │  │  浏览器自动化    │   │     │
│  │  └───────────┘  └──────────────────┘   │     │
│  │         │                  │               │     │
│  │         └──────────┬───────┘               │     │
│  │                    │                          │     │
│  │  ┌───────────────▼──────────────┐         │     │
│  │  │  主进程 (Main Process)       │         │     │
│  │  │  - 窗口管理                 │         │     │
│  │  │  - Playwright 启动控制      │         │     │
│  │  │  - WebSocket 服务 (可选)    │         │     │
│  │  └─────────────────────────────┘         │     │
│  └─────────────────────────────────────────────┘     │
│                     │                               │
│                     ▼                               │
│  ┌─────────────────────────────────────────────┐     │
│  │        Python FastAPI 后端 (独立进程)       │     │
│  │                                             │     │
│  │  - 账号管理 (shared_modules/auth/)        │     │
│  │  - 发布任务队列 (Celery/Redis)           │     │
│  │  - 数据存储 (PostgreSQL)                  │     │
│  │  - WebSocket 服务 (与 Electron 通信)      │     │
│  └─────────────────────────────────────────────┘     │
│                     │                               │
│                     ▼                               │
│  ┌─────────────────────────────────────────────┐     │
│  │         Chromium 浏览器实例 (Playwright)    │     │
│  │                                             │     │
│  │  - 账号1：微信公众号 (Cookie 持久化)      │     │
│  │  - 账号2：知乎 (Cookie 持久化)           │     │
│  │  - 账号3：抖音 (Cookie 持久化)           │     │
│  └─────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│              目标发布平台                    │
│                                             │
│  - 微信公众号 (mp.weixin.qq.com)          │
│  - 知乎 (zhihu.com)                      │
│  - 微博 (weibo.com)                       │
│  - 抖音 (creator.douyin.com)              │
│  - B站 (bilibili.com)                     │
└─────────────────────────────────────────────┘
```

---

### 2.2 模块设计

#### 2.2.1 Electron 主进程 (Main Process)

**职责**：
1. 创建浏览器窗口（Vue.js 前端界面）
2. 启动 Playwright，管理 Chromium 实例
3. 提供 WebSocket 服务（与 Python 后端通信）
4. 处理系统托盘、全局快捷键

**关键技术**：
```javascript
// main.js (Electron 主进程)
const { app, BrowserWindow, ipcMain } = require('electron');
const { chromium } = require('playwright');

let mainWindow;
let playwrightBrowser;

app.whenReady().then(async () => {
  // 1. 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: __dirname + '/preload.js'
    }
  });
  mainWindow.loadURL('http://localhost:8080'); // Vue.js 开发服务器

  // 2. 启动 Playwright (Chromium)
  playwrightBrowser = await chromium.launchPersistentContext({
    headless: false, // 显示浏览器界面（方便调试）
    userDataDir: './browser-data/' // Cookie 持久化目录
  });

  // 3. 启动 WebSocket 服务 (与 Python 后端通信)
  startWebSocketServer(8081);
});
```

---

#### 2.2.2 Vue.js 前端界面 (Renderer Process)

**职责**：
1. 账号管理（添加/删除/启用/禁用）
2. 内容编辑（标题、正文、标签、封面）
3. 发布任务队列（查看进度、取消任务）
4. 发布记录（历史记录、失败重试）

**技术栈**：
- Vue 3 + Element Plus (UI 组件库)
- Vue Router (页面路由)
- Pinia (状态管理)
- WebSocket (与 Python 后端实时通信)

**关键页面**：
| 页面 | 路径 | 功能 |
|------|------|------|
| 账号管理 | `/accounts` | 添加/删除/启用/禁用账号，扫码登录 |
| 内容编辑 | `/editor` | 编辑标题、正文、标签、封面，选平台 |
| 任务队列 | `/tasks` | 查看发布进度，取消/重试任务 |
| 发布记录 | `/history` | 查看历史发布记录，失败原因 |

---

#### 2.2.3 Python FastAPI 后端

**职责**：
1. 账号管理（CRUD，加密存储 Cookie）
2. 发布任务队列（异步并发、失败重试、定时发布）
3. 数据存储（PostgreSQL）
4. WebSocket 服务（与 Electron 前端通信）

**技术栈**：
- FastAPI (Web 框架)
- SQLAlchemy (ORM)
- Celery + Redis (任务队列)
- PostgreSQL (数据库)
- WebSockets (实时通信)

**关键 API**：
| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/accounts` | GET/POST/PATCH/DELETE | 账号管理 |
| `/api/tasks` | GET/POST/DELETE | 发布任务管理 |
| `/api/tasks/{id}/cancel` | POST | 取消任务 |
| `/api/tasks/{id}/retry` | POST | 重试任务 |
| `/ws/tasks` | WebSocket | 实时任务进度推送 |

---

#### 2.2.4 Playwright 浏览器自动化层

**职责**：
1. 模拟真人操作（点击、填表、上传文件）
2. 绕过平台风控（隐藏 `navigator.webdriver`、随机延迟）
3. Cookie 持久化（避免反复扫码登录）

**技术关键点**：
```javascript
// publisher-wechat.js (微信公众号发布器)
const { chromium } = require('playwright');

async function publishToWeChat(article) {
  const browser = await chromium.launchPersistentContext({
    headless: false,
    userDataDir: './browser-data/wechat/'
  });
  const page = await browser.newPage();
  
  // 1. 打开微信公众号后台
  await page.goto('https://mp.weixin.qq.com/');
  
  // 2. 检查登录状态（如果 Cookie 过期，则扫码登录）
  if (await page.locator('text=扫码登录').isVisible()) {
    await page.pause(); // 等待用户扫码
  }
  
  // 3. 点击"新建图文"
  await page.click('text=新建图文');
  
  // 4. 填写标题、作者、正文
  await page.fill('[placeholder="标题"]', article.title);
  await page.fill('[placeholder="作者"]', article.author);
  await page.fill('.editor-content', article.content);
  
  // 5. 上传封面
  await page.setInputFiles('input[type="file"]', article.coverImage);
  
  // 6. 点击"保存并群发"
  await page.click('text=保存并群发');
  
  // 7. 确认发布
  await page.click('text=确定');
  
  await browser.close();
}
```

---

### 2.3 数据流设计

#### 2.3.1 发布任务流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Vue.js 前端 │────▶│  FastAPI    │────▶│  Celery    │
│  (用户操作)  │     │  后端       │     │  任务队列   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                   │
                                                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  发布结果    │◀────│  Playwright │◀────│  任务执行器 │
│  (存数据库)  │     │  浏览器自动化│     │  (Worker)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

**详细步骤**：
1. 用户在 Vue.js 前端编辑内容，选择发布平台，点"一键发布"
2. Vue.js 前端调用 FastAPI 后端 `POST /api/tasks`，创建发布任务
3. FastAPI 后端将任务推入 Celery 任务队列
4. Celery Worker 取出任务，调用 Playwright 浏览器自动化脚本
5. Playwright 启动 Chromium，模拟真人操作，完成发布
6. Playwright 返回发布结果（成功/失败，失败原因）
7. Celery Worker 将结果写回 FastAPI 后端（更新任务状态）
8. FastAPI 后端通过 WebSocket 推送结果给 Vue.js 前端

---

#### 2.3.2 账号登录流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Vue.js 前端 │────▶│  Playwright │────▶│  平台登录页 │
│  (点"登录")  │     │  打开浏览器  │     │  (如微信公众 │
└─────────────┘     └─────────────┘     │     号后台)  │
                                               └──────┬──────┘
                                                      │
                                                      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  登录成功    │◀────│  保存 Cookie │◀────│  用户扫码/  │
│  (通知前端)  │     │  到本地文件  │     │  输入账号密码│
└─────────────┘     └─────────────┘     └─────────────┘
```

**详细步骤**：
1. 用户在 Vue.js 前端点"添加账号" → 选择平台（如微信公众号）
2. Vue.js 前端调用 Electron 主进程 `ipcRenderer.invoke('login', platform)`
3. Electron 主进程启动 Playwright，打开平台登录页
4. 用户扫码或输入账号密码登录
5. Playwright 保存 Cookie 到本地文件（加密）
6. 登录成功，通知 Vue.js 前端"账号已添加"
7. 后续发布任务直接使用保存的 Cookie，不需要重复登录

---

### 2.4 关键技术难点与解决方案

#### 2.4.1 平台风控检测 → 反检测策略

**问题**：平台会检测自动化操作（如 `navigator.webdriver = true`）  

**解决方案**：
```javascript
// 隐藏自动化标志
await page.addInitScript(() => {
  delete navigator.webdriver;
});

// 随机延迟（模拟真人操作）
await page.waitForTimeout(Math.random() * 2000 + 1000); // 1~3 秒

// 模拟鼠标移动
await page.mouse.move(100, 100, { steps: 10 });
```

---

#### 2.4.2 Cookie 过期 → 自动重新登录

**问题**：Cookie 会过期，需要重新扫码登录  

**解决方案**：
```javascript
// 检查登录状态
async function checkLoginStatus(page) {
  await page.goto('https://mp.weixin.qq.com/');
  if (await page.locator('text=扫码登录').isVisible()) {
    // Cookie 过期，需要重新登录
    await page.pause(); // 等待用户扫码
    await saveCookies(page.context()); // 保存新 Cookie
  }
}

// 保存 Cookie
async function saveCookies(context) {
  const cookies = await context.cookies();
  await fs.promises.writeFile(
    './browser-data/wechat/cookies.json',
    JSON.stringify(cookies, null, 2)
  );
}

// 加载 Cookie
async function loadCookies(context) {
  const cookies = JSON.parse(
    await fs.promises.readFile('./browser-data/wechat/cookies.json')
  );
  await context.addCookies(cookies);
}
```

---

#### 2.4.3 多账号管理 → 独立浏览器上下文

**问题**：多账号需要隔离（不能串 Cookie）  

**解决方案**：
```javascript
// 每个账号独立浏览器上下文
const contexts = {};

async function getAccountContext(accountId) {
  if (!contexts[accountId]) {
    contexts[accountId] = await chromium.launchPersistentContext({
      userDataDir: `./browser-data/account-${accountId}/`
    });
  }
  return contexts[accountId];
}
```

---

## 三、开发路线图

### 3.1 MVP (最小可行产品) - 2 周

**目标**：验证 Electron + Playwright 技术方案可行性  

**功能范围**：
- [ ] Electron + Vue.js 脚手架搭建
- [ ] Playwright 集成（Chromium 启动、Cookie 持久化）
- [ ] 微信公众号发布器（RPA 自动化，绕过官方 API 限制）
- [ ] 账号管理（添加/删除，Cookie 加密存储）
- [ ] 简单任务队列（一次发一个，无并发）

**交付物**：
- ✅ 可安装 Windows 客户端（`.exe` 安装包）
- ✅ 支持微信公众号发布（RPA 自动化）
- ✅ 账号管理功能

---

### 3.2 V1.0 (正式发布) - 4 周

**目标**：支持多平台，任务队列完善  

**功能范围**：
- [ ] 知乎发布器（RPA 自动化，答题突破）
- [ ] 微博发布器（RPA 自动化）
- [ ] 任务队列（异步并发、失败重试、定时发布）
- [ ] 发布记录（历史记录、失败原因、重试）
- [ ] 与 PROJECT-001 整合（读取改写结果，一键发布）

**交付物**：
- ✅ 支持 3 个平台（微信公众号、知乎、微博）
- ✅ 完整任务队列（并发、重试、定时）
- ✅ 与 PROJECT-001 数据打通

---

### 3.3 V2.0 (高级功能) - 6 周

**目标**：智能发布、数据分析  

**功能范围**：
- [ ] 智能发布时间推荐（根据平台流量高峰）
- [ ] 发布数据分析（阅读量、点赞量、评论量）
- [ ] 多账号切换（一个平台多个账号轮播）
- [ ] 浏览器扩展方案（补充，适合不想装客户端的用户）

**交付物**：
- ✅ 智能发布时间推荐
- ✅ 发布数据分析仪表盘
- ✅ 浏览器扩展（Chrome/Edge）

---

## 四、与 PROJECT-001/002 整合方案

### 4.1 数据共享（PostgreSQL）

**方案**：PROJECT-001 和 PROJECT-003 共享同一个 PostgreSQL 数据库  

**表结构设计**：
```sql
-- PROJECT-001 的 articles 表
CREATE TABLE articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255),
  content TEXT,
  source_url VARCHAR(255),
  rewritten_content TEXT,
  status VARCHAR(50), -- 'pending', 'rewriting', 'rewritten', 'publishing', 'published'
  created_at TIMESTAMP DEFAULT NOW()
);

-- PROJECT-003 的 publish_tasks 表
CREATE TABLE publish_tasks (
  id SERIAL PRIMARY KEY,
  article_id INTEGER REFERENCES articles(id),
  platform VARCHAR(50), -- 'wechat', 'zhihu', 'weibo'
  account_id INTEGER,
  status VARCHAR(50), -- 'pending', 'running', 'success', 'failed'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**数据流**：
1. PROJECT-001 采集 → AI 改写 → 存 `articles` 表（`status='rewritten'`）
2. PROJECT-003 读取 `articles` 表（`WHERE status='rewritten'`）
3. 用户选文章 → 选平台 → 创建发布任务（`INSERT INTO publish_tasks`）
4. Celery Worker 执行任务 → 更新 `publish_tasks.status`
5. 发布成功 → 更新 `articles.status='published'`

---

### 4.2 API 互通（PROJECT-001 → PROJECT-003）

**方案**：PROJECT-001 Web UI 添加"一键发布"按钮，调用 PROJECT-003 本地 WebSocket 服务  

**实现步骤**：
1. PROJECT-003 本地启动 WebSocket 服务（`ws://localhost:8081`）
2. PROJECT-001 Web UI 添加"一键发布"按钮
3. 用户点"一键发布" → PROJECT-001 前端调用 `ws://localhost:8081/publish`
4. PROJECT-003 接收消息 → 创建发布任务 → 执行 → 回调结果

**示例代码**：
```javascript
// PROJECT-001 前端 (Vue.js)
async function publishArticle(articleId) {
  const ws = new WebSocket('ws://localhost:8081');
  ws.onopen = () => {
    ws.send(JSON.stringify({
      action: 'publish',
      articleId: articleId,
      platforms: ['wechat', 'zhihu']
    }));
  };
  ws.onmessage = (event) => {
    const result = JSON.parse(event.data);
    console.log('发布结果:', result);
  };
}
```

---

## 五、技术选型对比

### 5.1 桌面客户端技术栈

| 技术方案 | 优点 | 缺点 | 推荐度 |
|----------|------|------|--------|
| **Electron + Playwright** | 生态成熟，Playwright 官方支持 Electron | 包体积大（~150MB） | ⭐⭐⭐⭐⭐ (推荐) |
| **Tauri + Playwright** | 包体积小（~10MB），性能高 | 生态较新，Playwright 集成复杂 | ⭐⭐⭐ (备选) |
| **PyWebView + Playwright** | Python 技术栈，开发快 | 功能受限，不支持 Playwright | ❌ (不推荐) |

**结论**：选 **Electron + Playwright**（参考产品、融媒宝、易媒助手同款方案）

---

### 5.2 浏览器自动化工具

| 工具 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **Playwright** | 官方支持 Electron，反检测能力强 | 学习曲线略陡 | ⭐⭐⭐⭐⭐ (推荐) |
| **Puppeteer** | 生态成熟，Google 维护 | 反检测能力弱于 Playwright | ⭐⭐⭐ (备选) |
| **Selenium** | 支持多浏览器 | 速度慢，配置复杂 | ❌ (不推荐) |

**结论**：选 **Playwright**（微软维护，反检测能力强）

---

## 六、风险与应对

### 6.1 平台风控升级 → 维护成本高

**风险**：平台更新页面 DOM 结构，导致 Playwright 定位元素失败  

**应对**：
- ✅ 建立平台监控机制（每天自动检测页面变化）
- ✅ 快速修复（元素定位失败 → 24 小时内发布补丁）
- ✅ 多策略降级（RPA 失败 → 切换官方 API）

---

### 6.2 账号被封 → 用户体验差

**风险**：平台检测到自动化操作，封禁账号  

**应对**：
- ✅ 限制发布频率（每个账号每天最多发 5 篇）
- ✅ 随机延迟（模拟真人操作间隔）
- ✅ 提示用户（发布前警告"过度发布可能被封号"）

---

### 6.3 Electron 包体积大 → 用户下载慢

**风险**：Electron 打包后 ~150MB，用户下载体验差  

**应对**：
- ✅ 提供在线安装包（.exe 下载器，只下载必要文件）
- ✅ 增量更新（只更新改动的文件，不全量下载）

---

## 七、后续行动

### 7.1 立即执行（本周）

1. ⏳ 搭建 Electron + Vue.js 脚手架（Hello World）
2. ⏳ 集成 Playwright（启动 Chromium，打开微信公众号后台）
3. ⏳ 实现微信公众号发布器（RPA 自动化，绕过官方 API 限制）

### 7.2 短期（2 周内）

1. ⏳ 完成 MVP（微信公众号发布 + 账号管理）
2. ⏳ 打包 Windows 客户端（`.exe` 安装包）
3. ⏳ 内测（自己用，找 Bug）

### 7.3 中期（4 周内）

1. ⏳ 实现知乎、微博发布器
2. ⏳ 完善任务队列（并发、重试、定时）
3. ⏳ 与 PROJECT-001 整合（读取改写结果，一键发布）

---

## 八、批准签字

| 角色 | 姓名 | 签字 | 日期 |
|------|------|------|------|
| CEO（决策）| QClaw | ✅ | 2026-06-07 |
| CTO（技术评审）| 待填写 | | |
| PM（产品评审）| 待填写 | | |
| COO（商业评审）| 待填写 | | |

---

**文档结束**  

*本技术方案为 PROJECT-003 的 Electron + Playwright 架构设计，供技术团队实施。*
