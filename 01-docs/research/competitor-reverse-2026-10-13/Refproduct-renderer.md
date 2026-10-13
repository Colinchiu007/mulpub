# 参考产品渲染层结构分析

> 来源：`analysis/refproduct-asar/packages/renderer/dist/`
> 主包 `main-BTf-V4ZI.js`（124.7 KB，React 19 打包产物）

---

## 1. 多窗口架构（9 个独立 HTML 窗口）

参考产品把不同界面拆成**独立 Electron 窗口**，每个窗口是独立的 React SPA：

| 窗口 | `<title>` | 入口 JS | 用途推断 |
|---|---|---|---|
| `index.html` | （空） | `main-BTf-V4ZI.js` | **主窗口**（标签页 + 分屏浏览器） |
| `collect.html` | **加载错误** ⚠️ | `collect-CRh-pEpX.js` | **采集窗口**（标题是模板复制 bug） |
| `error.html` | 加载错误 | `error-DSGktFUz.js` | 错误页 |
| `notice.html` | （空） | `notice-3DOZPZSS.js` | 通知窗口 |
| `online.html` | 在线状态 | `online-D5HJKZAH.js` | 在线状态指示 |
| `placeholder.html` | 新标签页 | `placeholder-C3yQyJfc.js` | 新标签占位页 |
| `splitPlaceholder.html` | 新标签页 | `splitPlaceholder-BzUxLLqP.js` | **分屏占位页** |
| `tool.html` | **Tool** ⚠️ | `tool-BHbYCDPK.js` | 工具页（标题未本地化） |
| `update.html` | **Tool** ⚠️ | `update-BtqyzxYt.js` | 更新页（标题误抄 tool.html） |

### 1.1 代码质量观察：9 个窗口里 3 个标题错误

| 问题 | 文件 | 现象 |
|---|---|---|
| 模板复制未改 | `collect.html` | 采集窗口的标题写成「加载错误」——从 `error.html` 抄模板时漏改 |
| 模板复制未改 | `update.html` | 更新页标题写成「Tool」——从 `tool.html` 抄模板时漏改 |
| 未本地化 | `tool.html` | 标题是英文 `Tool`，而产品是纯中文界面 |

> 这类问题在手工维护多入口 HTML 时很常见。
> **本项目对照**：本项目是单入口 Vue SPA（`apps/desktop/src/`），
> 不存在多 HTML 入口的标题漂移问题；且 i18n 有 `locales/zh.js` / `en.js` **成对提交门禁**
> （CI Gate 7 `check-locale-sync.js`），不会出现「中文产品里混英文标题」。

### 1.2 每个窗口都有 CSP

所有窗口统一声明：
```html
<meta content="script-src 'self' blob:" http-equiv="Content-Security-Policy" />
```

**评估**：`script-src 'self' blob:` 阻止了内联脚本与外部脚本，是合理的加固。
但未见 `object-src` / `base-uri` / `frame-ancestors` 等指令，属**部分加固**。
本项目 `apps/desktop/electron/core/ipc-security.js` + `access-level.js` 的安全面更完整。

---

## 2. 渲染层技术特征

| 特征 | 出现次数 | 说明 |
|---|---:|---|
| `React` | 2 | React 19 运行时 |
| `useState` | 17 | 函数组件状态 |
| `useEffect` | 15 | 副作用 |
| `useMemo` | 14 | 记忆化 |
| `useRef` | 35 | 引用 |
| `createContext` | 9 | Context |
| `lucide` | 12 | lucide 图标库 |
| `className` | 59 | JSX |

---

## 3. 渲染层调用的 IPC 通道

从渲染层主包中提取到 **0** 个桥接调用点：

```
```

---

## 4. 中文界面文案（功能线索）

共提取 **17** 条中文字符串，前 120 条（反映功能面）：

```
关闭标签页
新建标签页
更新账号
保存账号
复制失败
后退
前进
刷新
搜索或输入网址
复制当前url
恢复为普通标签页
收藏
更多
批量发布
切换水平标签栏
切换垂直标签栏
更新
```
