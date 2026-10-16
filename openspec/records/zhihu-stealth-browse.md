---
record: zhihu-stealth-browse
task: 修复内嵌浏览器（浏览/账号标签）不达主世界的反检测，并只按真机对照修 4 项实测指纹异常
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个 docs 会话（按 AGENTS.md「合并后收尾清单」回填并销账）
---

## 本次执行记录：内嵌浏览器主世界反检测（zhihu-stealth-browse，2026-10-15）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/**`、`apps/desktop/scripts/**`、`apps/desktop/vitest.config.js`）⇒ 隔离 worktree `D:/Data/projects/mp-worktrees/mp-zhihu-stealth-browse`、裸分支 `zhihu-stealth-browse`（`rev-parse --abbrev-ref HEAD` 实证） |
| 第一性原因（QM-5 ①） | ✅ | 两个独立缺陷：D1 `contextIsolation:true` 下 preload 在隔离世界 ⇒ patch 主世界不可见（存量，PRD-OSS-RPA-HARDENING §3.1 E4b）；D2 账号标签 `tab-lifecycle.js:153` 挂的是 `monitor-preload.js`，反检测从未接线。另有 D3：旧补丁**内容**对 3 项本就正常的信号动手（见下） |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：`stealth-preload.js` 无任何测试文件（本次新增 4 个）；②测试执行层：`electron/stealth/**` 不在 vitest include 白名单，直接放会**一个都不跑而 CI 全绿**（同族：`startup-compat.test.js` 的 historical 逃逸）⇒ 本片先在 `vitest.config.js` 登记；③夹具层：首版夹具把 `Notification.permission` 写成数据属性、jsdom UA 无 `Chrome/<major>`、直接赋值不可写属性 ⇒ 三处"夹具替实现撒谎"，均先红后修 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 57 用例（evasions 21 / inject 22 / preload-path 7 / monitor-preload 7），全绿；既有回归锁更新 1 处（`webview-manager.test.js` 的 preload 断言放宽为 monitor 家族**并新增**「不得是 home-shell preload」，意图不变判据更严）；反向锁专锁"不许碰的项"（源码不得出现 webdriver/plugins/mimeTypes/chrome.runtime/languages 改写、不得含 `Native Client` 假插件） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`evasions.js` 内嵌**实测对照表**并把"不修项 + 理由"写进源码注释；②两个 harness 入库（`probe-main-world-injection.js` / `probe-browser-fingerprint.js`）使"通道是否达主世界""指纹是否与真实 Chrome 一致"可复现取证，不再依赖想象；③`preload-path.test.js` 断言**三个 bundle 均已产出**且确实内联源码（漏跑 `build:preload` 即红）；④learnings 沉淀"没做对照就补 = 自己制造破绽" |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（下详） |
| 接线棘轮 | ✅ | 新增 4 个 `*.test.js` 已登记进 `apps/desktop/vitest.config.js` 的 include 白名单（未登记等于没写，本片把这一步前置） |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：改动落在 `apps/desktop/electron/` ⇒ 已执行打包 + 启动判据（下详）。QM-4：未触碰任何 `.vue` / 样式 / locale 文件，无视觉面变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道（`codeagent-wrapper` 类工具未探测到）；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin zhihu-stealth-browse` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段并销账 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按 2026-10-15「旧载体冻结」政策**零改写**）| 远程同步 PENDING

### 实测对照（本片全部技术判断的依据）

同机、同 GPU、同时段，真实 Electron 43.7.7 vs 真实 Chrome 155 逐项对照，raw 产物入库
`01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/`（4 个文件）。**三项 v1.0 推断被证伪**：

| v1.0 推断 | 实测 | 处置 |
|-----------|------|------|
| `navigator.plugins` 为空是强指纹 | Electron **已是 5 项且名称与 Chrome 逐字相同** | 不修（并删掉旧文件的假插件清单——现代 Chrome 无 Native Client） |
| WebGL 软件渲染是强指纹 | 同机同 GPU 下取值**与 Chrome 完全一致** | 不修 |
| `chrome.runtime` 缺失是异常 | 真实 Chrome 网页上**也是 `undefined`** | 不修（旧文件造它反而自曝） |
| `navigator.webdriver` 需处理 | 两边都是 `false` | 不修 |
| `outerWidth/Height` 比例异常 | Chrome 无头态报 `0/0`，**不可比** | 不修 |

**实测确认的 4 项异常（本片修复）**：`Object.keys(window.chrome)` 空数组 vs `['loadTimes','csi','app']`；
`userAgentData.brands` 缺 `Google Chrome`；`Notification.permission` = `granted` vs `default`；
`permissions.query` 对 5 项全 `granted` vs 全 `prompt`。

**A/B 证据**（同一生产 preload，`MP_BROWSER_STEALTH` 开/关）：
关闭时 4 项全为异常值；开启后 4 项与 Chrome 基线一致，且
`permissionStatus instanceof PermissionStatus === true`（保原型）、
主世界标记 `done=1 / applied=4 / failed=0`、隔离世界标记在主世界仍为 `undefined`（隔离未被破坏）、
`plugins/webdriver/vendor/chrome.runtime` **未被改动**。

### 顺带确认（本片仅补证据，未改代码）

UA 净化**确实生效**：A/B 实测净化前 `… Chrome/150.0.7871.250 Electron/43.7.7 Safari/537.36`、
净化后 `… Chrome/150.0.7871.250 Safari/537.36`。该函数历史上曾因读错宿主属性（`app.userAgent` 不存在）
而从未执行过一次（`learnings.md:1497`），本片把它从"单测绿"升级为"真机 A/B 有证据"。

### 未闭合（不假装已闭合）

1. **只改报告值，未收紧实际权限授予**：报告 `prompt`，页面真去请求仍可能拿到（Electron 未装权限处理器时
   一律放行，实测 `setPermissionRequestHandler` 未设即 granted）。收紧需按权限名逐项白名单
   （`fullscreen`/`pointerLock` 一并拒绝会真实破坏站点功能），属独立变更 ⇒ 登记为后续项。
2. **`navigator.languages` 不修**：Electron `['zh-CN','zh-Hans-CN']` vs Chrome `['zh-CN','zh']`。
   只改 JS 读数会与 `Accept-Language` 请求头不一致，制造**新**破绽；正确取值取决于本机语言配置，属未取证项。
3. **`Sec-CH-UA` / DNS / QUIC / TLS(JA3) 指纹未取证**，故未做任何"优化"。
4. **网络侧未动**：openclash 分流属用户侧配置。若 A/B 实验证明主因是出口 IP，应用侧修复不改变该结论。
5. **平台风控不可控**：若账号已被历史标记，环境全修好也可能仍需一次短信验证。
