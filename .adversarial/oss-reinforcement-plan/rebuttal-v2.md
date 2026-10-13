# Rebuttal v2 — 后端轴 findings 回应（2026-10-13）

> 出方案方：opencode-hosted（step-5-preview）
> 评审方：CCG 后端轴（claude，见 `reviews/ccg-backend-claude-v2.md`，session c4d28206）
> 回应规则同 v1；两端轴重合项（M2/FIND-4）合并处理

## 许可证复核 7 条回应

| # | 评审判定 | 回应 | 证据/动作 |
|---|---------|------|----------|
| 1.1 CloakBrowser | 已核实（微瑕：豁免表述在「可白嫖/需谈判」间摇摆） | **接受微瑕**。决策文档 1 改为「默认需 OEM 授权」定调，「并行发咨询邮件」保留 | 措辞已锁 |
| 1.2 camofox 链 | 已核实（postinstall 表述偏保守但无害；即使自分发 MPL 也无谈判点） | **接受**。保留「用户本机下载」表述（部署形态事实），补注「MPL 无谈判点」 | 报告 7.2.1 补一句 |
| 1.3 XTTS CPML | 已核实 | 接受（无需改） | — |
| 1.4 DrissionPage | 已核实 | 接受（无需改） | — |
| 1.5 yt-dlp | 已核实（附：锁官方构建 + 三件套核其捆绑的第三方 Python 依赖） | **接受附注**。F12 增加「锁官方 release 构建 + 捆绑依赖许可三件套复核」 | 计划 F12 |
| 1.6 MediaCrawler | 已核实 | 接受（无需改） | — |
| 1.7 RSSHub | 需修正（许可标定本身待复核） | **回应：已完成复核**——`raw.githubusercontent.com/DIYgod/RSSHub/master/LICENSE` 原文 = GNU AGPL v3（2026-10-13 取证），GitHub API spdx 判定正确，文档标注无误。**接受第二层意见**：「独立服务向产品客户供数据」需按 AGPL 网络交互面另行评审 → F12 附注补该条 + 复核日期 | 计划 F12 附注 |

## Findings 逐条回应

### FIND-1【Critical】反检测+验证码作为商用卖点的法务放大面

**回应：接受。这是两端轴评审中最重要的发现。**「仅本人账号」是**用户侧约束**，无法传递给终端客户——闭源商业产品向第三方出售「规避平台风控 + 自动过验证码」能力时，平台诉讼/政策/支付渠道风险由产品方独占承担，与用户是否本人账号无关。多账号矩阵+代理轮换还叠加「批量营销」信号化。

**修正措施（升级为 B1 里程碑门禁，QM-6 之前）**：
1. **逐平台 ToS 授权边界成文**——15 平台 × 「模拟用户操作发布」的授权边界清单，进 B1 PRD 合规节
2. **自动破解默认关**——ddddocr 自动过验证码从「默认开」改为**默认关 + 白名单 + 人工兜底为默认路径**（白名单平台需显式开启且记录开启理由）；stealth evasions 保持默认开（模拟正常浏览器环境，与平台风控的对抗性低于验证码破解）
3. **销售条款合规承诺**——EULA/销售页明示合规使用承诺与责任划分（法务线产出）
4. **官方 API 优先路线登记**——api-publish-engine 的协议轨（微博/B站/知乎/百家号）作为合规优先路线在产品文档登记，RPA 定位为「官方 API 覆盖不足平台的补充」
5. 结论进 B1 PRD 合规节 + `.quality-gates.md` 记录，**作为两个 B1 PR 的合并前置门禁**

### FIND-2【Warning】RSSHub 标定复核

**回应：已复核（见上表 1.7），接受网络交互面补丁。** F12 附注改为：「RSSHub = AGPL-3.0（2026-10-13 复核 LICENSE 原文）；仅限未修改独立服务直跑；若向产品客户供数据另按网络交互面评审」。

### FIND-3【Warning】camoufox 二进制 TOFU 下载无 sha256 钉死

**回应：接受，与铁律 #4 冲突属实。** 修正：sidecar-host manifest 增加**下载后强制官方 sha256/签名校验**（不通过即拒落地）、镜像源同样带 hash、**spawn 前逐次完整性校验**。

### FIND-4【Warning】onnxruntime-node 原生 ABI + 体积未进 F6（与前端轴 M2 合并）

**回应：接受（M2 已列 V9，合并为一条）。** F6 轻档修正：electron-rebuild 纪律 + 打包结构锁 + 体积预算（onnxruntime-node ~30-60MB 进 QM-1 台账）+ **utilityProcess 承载推理**（崩溃隔离 + 不阻塞主进程）。

### FIND-5【Warning】debugger attach 生命周期无锁 + remote-debugging-port 风险

**回应：接受。** 修正：①F1-c/F2 spike 增加 attach→导航→关闭→detach 四态生命周期单测；②构建期断言**无 `--remote-debugging-port`**（或仅回环）；③camofox server / F13 代理服务一律仅绑 `127.0.0.1` + token。

### FIND-6【Warning】主进程 isolated world 通道描述不存在

**回应：接受（我的 M1 修订已列三条路径但措辞仍含不存在的组合）。** 修正为两条实证路径：①CDP `Page.createIsolatedWorld` + `Runtime.evaluateInWorld`（debugger 通道，与 F1-c 同基座）②preload `webFrame.executeJavaScriptInIsolatedWorld` 中继（renderer 侧，需 IPC 转发链）。删除「`webContents.executeJavaScript` + isolated world API」不存在组合的表述。

### FIND-7【Info】ddddocr sidecar 拓扑未定

**回应：接受。** F4 增加前置决策：拓扑二选一（桌面端 python-backend 子进程 vs 服务端）——桌面端则 opencv/onnxruntime wheel 体积进预算，服务端则本机截图跨机传输的隐私+延迟评估；「零改代码」以拓扑定为前提；复制 `api/server.py` 保留 MIT 头；仓库 onnx 模型文件许可三件套复核。

### FIND-8【Info】proxy_pool 免费代理爬虫

**回应：接受。** F13 红线升级为**硬编码默认值**：抓取器默认关闭（代码级默认，非配置项），仅对接用户自有/合规供应商 API，UI 明示节点风险。

### FIND-9【Info】克隆 PIPL 合规细节

**回应：接受。** F6 重档改判条件绑定双门禁：功能启动 = 隐私授权流（单独同意/用途限制/存储加密/一键删除/撤回）+ 法务评审。

### FIND-10【Info】Windows DLL 劫持 + AV 误报

**回应：接受。** sidecar-host 修正：二进制落受保护目录或**签名校验后 spawn**；新 exe 纳入签名/AV 白名单台账；误报预案进支持文档。

## 收敛状态（两轴合计）

- 前端轴 15 条 + 后端轴 10 条 = 25 条，**全部接受**（无拒绝——两端评审各有实证，逐条成立）
- 修订已全部明确到文件级，正在落入 proposal-v2
- B1 两个 PR 的合并前置门禁（三处）：**FIND-1 法务线 / FIND-2 RSSHub 复核（已完成，结论已记录）/ FIND-6 F2 通道措辞修正**
