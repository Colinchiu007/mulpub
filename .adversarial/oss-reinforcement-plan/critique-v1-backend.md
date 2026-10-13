# 后端轴评审：Multi-Publish 开源强化方案（2026-10-13）

**评审方**：CCG 后端轴（claude）｜**对象**：4 份方案文档 v3
**总体结论：需修改后实施**（详见文末）

## 1. 许可证判定复核（7 条）

| # | 项目 | 判定 | 依据 |
|---|------|------|------|
| 1.1 | CloakBrowser 二进制专有 + OEM | **已核实** | BINARY-LICENSE v1.3 的「订阅 + 禁再分发 + OEM/SaaS 捆绑/对外提供浏览器能力即触发」描述与上游已知授权模型一致；「把隐身浏览器能力作为产品功能给终端客户=命中 OEM」是保守且方向正确的商业判定，OEM 咨询并行、工程知识（贝塞尔算法）事后提取的路径合理。微瑕：豁免条款解读建议以「默认需授权」定调 |
| 1.2 | camofox 许可链（MIT wrapper + MPL-2.0 camoufox-js + Firefox fork） | **已核实** | MPL-2.0 是文件级 copyleft，未修改依赖/二进制不传染闭源宿主，Firefox/Camoufox 本体 MPL 亦允许再分发；「postinstall 用户本机下载=非我们分发」表述偏保守但无害——即使自分发，MPL 也仅是「提供源码+保留声明」，无谈判点，链上无阻塞 |
| 1.3 | XTTS-v2 权重 CPML 禁商用 | **已核实** | 代码 MPL-2.0 覆盖不了模型权重；CPML 禁商用，TTS 功能的实质资产是权重，排除结论正确 |
| 1.4 | DrissionPage 自定义禁商用 | **已核实** | 自定义许可「限学习/非盈利」，与作者并行运营商业版的商业事实互证；NOASSERTION 元数据反向佐证，代码零复用结论正确 |
| 1.5 | yt-dlp Unlicense 可捆奠 | **已核实** | Unlicense 公有领域，捆奠分发无署名/copyleft 义务，属最宽松档；注意锁官方构建并以三件套复核其捆奠的第三方 Python 依赖许可（yt-dlp 刻意规避 GPL 依赖，基本无虞） |
| 1.6 | MediaCrawler 非商用学习许可 | **已核实** | 自定义非商用许可，「仅思路、代码零复用」结论正确（F10 已按零复用自实现，合规） |
| 1.7 | RSSHub AGPL 仅限未修改直跑边界 | **需修正（复核项）** | 「AGPL 未修改独立服务直跑不传染宿主」的边界逻辑成立，但**「RSSHub=AGPL-3.0」这个事实标定本身需复核**——按其历史长期为 MIT，2026 年是否改授未证实（若真为 MIT，则「改一行即触发开源义务」是虚构约束；若确为 AGPL，边界成立但「独立服务向产品客户供数据」仍需按网络交互面处理）。执行前三件套复核并写明复核日期 |

## 2. 安全/合规风险清单（含文档未覆盖）

| 风险 | 文档覆盖 | 评审要点 |
|--------|-----------|---------|
| sidecar 供应链 | 部分（V2/V3 + hash 纪律） | ①camofox 二进制 postinstall **TOFU 下载、无 sha256 钉死**（与项目铁律冲突，见 FIND-3）；②ddddocr 直接复制 `api/server.py` 需保留 MIT 头，且**仓库内** onnx 模型文件的许可未单独核；③ yt-dlp/BBDown/whisper.cpp/libcurl 走 media-tools 范式有锁，OK；④ Windows 可写目录 spawn 无签名二进制 = **DLL 劫持**（见 FIND-10） |
| 反检测与验证码的 ToS | V6「仅本人账号」 | 核心缺口：文档把 ToS 风险框在「本人账号」维度，实际风险是**产品向第三方客户出售「规避平台风控 + 自动过验证码」能力**——国内已有平台起诉批量发布破解工具的判例，海外 CFRA 类法条对「破解访问控制」更严。红线约束无法传递到终端客户（见 FIND-1，Critical） |
| 声音克隆隐私 | F6 红线（仅本人+隐私声明） | 起步良好但缺细节：声音属**敏感个人信息（PIPL）**，需单独授权、用途限制、存储加密、一键删除、撤回。重档未启动，前瞻登记即可（见 FIND-9） |
| 代理池 | F13 红线（来源自持） | 红线方向正确但应**硬编码默认关闭抓取**——proxy_pool 默认自带免费代理爬虫，节点可能被攻陷/黑名单/涉非法活动，产品默认启用=替用户与被攻陷节点之间的数据泄露担责；免费代理本身是平台风控黑名单高发源，反而放大 F13 要解决的判据（见 FIND-8） |
| CDP 攻击面 | H2（init script 可枚举） | 文档正确覆盖 fingerprint 面，但漏了两点：①`webContents.debugger` 常驻 attach 的生命周期与 detach 清理无单测锁；② **任何路径开 `--remote-debugging-port` 且非回环监听 = 本机任意进程可完全控制已登录账号的 RPA 窗口**。camoufox server 的 CDP/WebSocket 也须仅绑 127.0.0.1 + token（见 FIND-5） |

未覆盖补充：截图/音频等账号上下文经 captcha/ASR HTTP 管线传输（须仅回环 + token）；AV 对自动化浏览器 exe 的误报是真实支持成本；RSSHub 许可待定本身是合规风险。

## 3. 可行性 verdict

- **F1-c evasions 主世界注入（修订版）**：✅ **成立**。Electron `contextIsolation:true + sandbox:true` 下 preload 与页面主世界确实分属不同 JS context，旧方案（preload patch navigator）被证伪是对的；`webContents.debugger` + `Page.addScriptToEvaluateOnNewDocument` 在主世界 document_start 注入，正是 Playwright/puppeteer-extra 同款注入机制，且同仓已有同型实现与回归锁可复用。遗留工程细节（attach 生命周期、目标就绪等待）已列 spike；init script 可枚举 hash（H2）三选一缓解保留。
- **ddddocr sidecar**：✅ **成立（附拓扑前提）**。FastAPI + `/slide_match` 技术无阻塞；但「零改代码」以 **python-backend 部署拓扑**为前提——若 python-backend 在服务端，则本机 RPA 截图须跨机传输（隐私+延迟）；若在桌面端，opencv/onnxruntime wheel 体积须计入（见 FIND-7）。
- **Kokoro onnxruntime-node**：✅ **成立（补 ABI 纪律）**。同型号 WASM/onnx 运行已有 ttsbro 实证；但 `onnxruntime-node` 是原生 `.node` 模块，与 nodejieba 同型，F6 **漏了 electron-rebuild ABI 处理**（F8 有先例却未复用），打包后必崩（见 FIND-4）；另建议 utilityProcess 隔离主进程内崩溃。
- **isolatedWorld（F2）**：⚠️ **部分成立（通道描述需修正）**。`webFrame.executeJavaScriptInIsolatedWorld` 是 renderer/preload 可用；主进程 `webContents.executeJavaScript` 没有 isolated world API——文档「webContents.executeJavaScript + isolated world API」组合在 Electron 中不存在。正确路径是 CDP `Page.createIsolatedWorld` + `Runtime.evaluateInWorld`，或经 preload webFrame。spike 的目标应改测该路径；降级方案合理（见 FIND-6）。

## 4. AGENTS.md 铁律一致性

| 铁律 | 一致性 | 备注 |
|------|--------|------|
| QM-1（打包/体积/媒体工具） | **基本一致** | F12 进 extraResources、模型按需不捆奠、F3「打包后二进制就绪」验收、F11 libcurl 依赖闭包——均对齐。**偏差**：F6 onnxruntime-node 属原生依赖但未走 QM-1 的 ABI/体积台账 |
| QM-6（双模型评审） | **一致** | 每批次一次、B1 拆两 PR 不省共同评审，且先改一 PR 的 QM-6 覆盖批次，合并后补 |
| worktree 隔离 | **一致** | 每批次独立 worktree + `start-mp-task.ps1`，禁共享根，B3/B3+ 并行无冲楚 |
| 单一真源 | **部分** | F8 例外「同 PR 登记 AGENTS」与「同 PR 修正 preload 错误声明」处置正确；但 F1-c 复用 webview-manager 注入基建需声明**「注入实现唯一真源」**并在 AGENTS 登记，避免 rpa 与采集侧各自演化成两份实现 |

## 5. Findings

**严重度分级 + 定位 + 问题 + 修复建议：**

- **FIND-1【Critical】** 定位：F1/F3/F4 整体 + 红线「仅本人账号」（实施计划 §F3/F4 红线、报告 V6）。问题：反检测 + 自动过验证码是 B1 的**核心价值主张**，但也是向第三方付费客户提供「规避平台访问控制」能力的法务放大面——「仅本人账号」约束无法传递给终端用户，平台诉讼/政策封禁/支付与商店渠道风险由闭源商用产品独占承担；多账号矩阵+代理轮换显著信号化「批量营销/水军」。修复：B1 启动前补法务评审线——目标平台 ToS 授权边界逐平台成文、自动破解默认关（白名单+人工兜底为默认路径）、销售条款明示「合规使用承诺」、官方 API 优先路线登记；结论进 PRD 合规节并升级为里程碑门禁（QM-6 前置）。
- **FIND-2【Warning】** 定位：分析报告 7.1 #44 / 实施计划 F12 附注。问题：RSSHub 许可标定（AGPL-3.0）与已知历史（长期 MIT）冲突，而 F12 附注的「未修改直跑边界」完全依赖该标定；标错则成文错误，标对（AGPL）则「独立服务向产品客户供数据」仍需按 AGPL 网络交互面处理。修复：实施前 LICENSE 三件套复核并记录复核日期；若确认长期 MIT，删除「改一行即触发开源义务」表述；若 AGPL，转正式独立服务部署评审。
- **FIND-3【Warning】** 定位：F3 postinstall / sidecar-host（实施计划 §F3、V2）。问题：camoufox 二进制 TOFU（首次信任）下载、失败仅 warn、无版本+sha256 钉死——与项目「新二进制：hash 锁定 + license 原文」铁律冲突；下载通道被攻破 = 用户机执行任意二进制。修复：下载后强制校验官方 sha256/签名再落地；镜像源同样带 hash；sidecar spawn 前逐次完整性校验，防 DLL/文件篡改。
- **FIND-4【Warning】** 定位：F6 轻档（Kokoro/onnxruntime-node）。问题：`onnxruntime-node` 为原生 `.node` 模块，与 nodejieba 同型；F8 明写 electron-rebuild + verify-worktree-deps（V7），F6 未提 ABI——打包后主进程加载即崩，且体积（~30-60MB）未进 QM-1 预算。修复：F6 补 electron-rebuild 纪律 + 打包结构锁 + 体积预算；建议 utilityProcess 承载推理（崩溃隔离 + 不阻塞主进程）。
- **FIND-5【Warning】** 定位：F1-c/F2/F3（debugger attach + CDP sidecar 端口）。问题：`webContents.debugger` 常驻 attach 的 detach/窗口关闭清理无锁；若任何路径开 `--remote-debugging-port` 且非回环监听，本机任意进程可经 CDP 完全控制已登录的 RPA 窗口（会话、凭证全暴露）。修复：attach 生命周期单测（attach→导航→关闭→detach 四态）+ 构建期断言无 remoteDebuggingPort；camoufox/F13 等服务仅绑 127.0.0.1 + token。
- **FIND-6【Warning】** 定位：F2 前置 spike / 主实现（实施计划 §F2）。问题：主进程不存在「`webContents.executeJavaScript` + isolated world API」组合——该 API 仅在 renderer（preload/webFrame）侧；文档通道描述不成立。修复：spike 改验 CDP `Page.createIsolatedWorld`+`Runtime.evaluateInWorld`（debugger 通道，与 F1-c 同基座）或 preload webFrame 中继两条路径；不等价即按现降级方案走。
- **FIND-7【Info】** 定位：F4 ddddocr sidecar。问题：`api/server.py`「零改代码」依赖 python-backend 部署拓扑未定；服务端拓扑则本机截图跨机（隐私+延迟），桌面拓扑则 opencv/onnxruntime wheel 体积进安装包；复制 server.py 需保留 MIT 头、仓库 onnx 模型文件许可未单独核。修复：先定拓扑再承诺「零改」；衍生文件保留许可头；模型文件三件套复核。
- **FIND-8【Info】** 定位：F13 代理池。问题：proxy_pool 自带免费代理爬虫，节点被攻陷/黑名单/涉非法活动时由产品与用户共同担责；「由用户自持」是红线但非硬门禁。修复：抓取器默认关闭、仅对接用户自有/合规供应商 API、UI 明示——红线落成硬编码默认值而非条款。
- **FIND-9【Info】** 定位：F6 重档（GPT-SoVITS 克隆）红线。问题：克隆交付时声音是 PIPL 敏感个人信息，需授权/用途限制/存储加密/删除/撤回；「隐私声明进 PRD+UI」缺少操作细节。修复：与「克隆进路线图」改判条件绑定：功能启动 = 隐私授权流 + 法务评审双门禁。
- **FIND-10【Info】** 定位：sidecar-host（F3/F4/F5/F12 共用宿主）。问题：Windows 从可写目录（%LOCALAPPDATA%/缓存）spawn 无签名二进制，DLL 搜索顺序劫持；AV 对自动化浏览器/下载器误报是实际支持成本。修复：二进制落受保护目录或签名校验后 spawn；新 exe 纳入签名/AV 白名单台账；误报预案进支持文档。

## 总体结论

**需修改后实施。**

工程路径整体成立：F1-c 主世界注入修订正确（debugger + `Page.addScriptToEvaluateOnNewDocument`，Playwright 注入机制同源），6/7 条许可证判定核实、唯一阻塞性许可事实（RSSHub）在执行前可低成本复核，M4 已把它挂到「同一 PRD」而非写死排期。阻断项集中在**两个后端轴问题**：① FIND-1 反检测/验证码规避作为商用卖点的法务放大——这是 B1 的核心价值主张，「仅本人账号」无法约束终端客户，须在启动前升级为法务门禁；② F2 通道描述（主进程 isolated world）不成立，spike 目标需修正后才可进 RED。其余为可执行期消化的 Warning/Info。建议按决策 5 的 B 递进推进，但以 FIND-1/FIND-2/FIND-6 设为 B1 两个 PR 的合并前置门禁。
