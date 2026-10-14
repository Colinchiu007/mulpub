# Spike 证据归档 — F1-c/F2 通道实测（2026-10-14）

> 执行：`D:\Temp\oss-spike\`（main.js 五组实验 + main-e3.js isolated world 补测 + page.html 时序探针）
> 环境：本仓 `node_modules/electron/dist/electron.exe`（Electron 43.x），RPA 同构 webPreferences（`contextIsolation:true, sandbox:true, backgroundThrottling:false, preload`，partition `persist:oss-spike`）
> 原始输出：`result.json` / `result-e3.json`（本文件同目录存档副本）

## 实验矩阵与结论

| # | 实验 | 结果 | 判定 |
|---|------|------|------|
| E1 | fresh window 直接 `Page.enable` | **HUNG**（3s 超时未 resolve） | 确证 `webview-manager/utils.js` 的 about:blank bootstrap 必要性；bootstrap 后 362-389ms RESOLVED |
| E2 | `Page.addScriptToEvaluateOnNewDocument` | 返回 `{identifier:"1"}` | 配合 E1b 的 Page.enable 后注入生效（Page.enable 缺失会静默 no-op——utils.js 既有教训复现） |
| E3a | `Page.createIsolatedWorld({})` 空参数 | `Invalid parameters` | 参数 bug（缺 frameId），非协议不可用 |
| E3b | `Page.createIsolatedWorld({frameId})` | **OK**，`executionContextId: 3` | F2 路径 createIsolatedWorld 可行 |
| E3c | `Runtime.evaluateInWorld` | `wasn't found` | **该命令不存在**（Puppeteer 封装名误导）；真实路径=`Runtime.evaluate + contextId` |
| E3d | `Runtime.evaluate({contextId})` | OK，返回 `{iso:true, webdriver:'false', seesMainVar:'undefined'}` | F2 路径 evaluate 可行 |
| E3e | iso world 写 `__isoMarker` → 主世界读 | 主世界 `seesIsoMarker:'undefined'` | **隔离语义成立**（iso 写主不可见） |
| E4a | CDP 注入读回 | `cdpInjected:'yes'`、`cdpWebdriver:'false'`、`mainWorldWebdriver:'false'` | debugger 通道主世界注入生效 |
| E4b | preload 直 patch 读回 | `preloadRanSeenInMain:null`、主世界 webdriver 未被 `PRELOAD-PATCHED` 污染 | **H1 隔离间隙运行时确证**：现有 stealth-preload.js 的 patch 对页面无效（存量缺陷） |
| E4c | preload `executeJavaScriptInIsolatedWorld(0)` 读回 | `preloadIsoPatchSeenInMain:'yes-injected-into-main-world'` | **sandbox preload 可注入主世界** |
| E5 | sandbox preload 的 `require('electron')` | `require-ok` / `webFrame: available` / `executeJavaScriptInIsolatedWorld: callable` | sandbox:true 下 webFrame 暴露（非推断，实测） |
| E6 | 时序（page.html `atScriptStart`） | `preloadIsoPatch` 与 `cdpInjected` 在页面脚本执行瞬间**均已存在** | 两通道均早于页面脚本（document_start 语义成立） |

## 对架构决策的输入

1. **F1-c 选 preload 通道**（PRD D1）：`executeJavaScriptInIsolatedWorld(0)` 零 attach 生命周期 vs debugger 四类失败模式（HUNG/bootstrap/挂起竞速/单例冲突）
2. **F2 真实命令名**：`Page.createIsolatedWorld({frameId})` → `Runtime.evaluate({contextId})`；研究文档中的 `Runtime.evaluateInWorld` 写法以此为准更正
3. **存量缺陷记录**：`stealth-preload.js` 头注错误声明 + patch 实际无效，随 B1 PR-1 同 PR 修正

## 复现方式

```bash
# 目录方式跑五组主实验（package.json main=main.js）
& "D:\Data\projects\mulpub\node_modules\electron\dist\electron.exe" "D:\Temp\oss-spike"
# 文件方式跑 isolated world 补测（否则 package.json main 会覆盖 ArgumentList）
& "D:\Data\projects\mulpub\node_modules\electron\dist\electron.exe" "D:\Temp\oss-spike\main-e3.js"
# 输出：SPIKE_OUT 环境变量指定 result.json / result-e3.json
```
