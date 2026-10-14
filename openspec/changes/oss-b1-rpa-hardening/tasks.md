# Tasks: oss-b1-rpa-hardening

> 分支策略：`mp-oss-rpa-hardening` worktree（`scripts/start-mp-task.ps1 -TaskName oss-rpa-hardening`）；PR-1 / PR-2 两刀；每刀 QM-6 + QM-1。
> TDD 纪律：每个 Code 任务先 RED（测试全挂）再 GREEN；变异反证至少 1 条；禁止 `--no-verify`。
> 数据口径契约（PRD §4）是灰度判定唯一依据，n≥15 前不判去留。

## PR-1：stealth 注入 + 行为层 + isolated world（F1+F2）

### 1. 基线（ spike 已产出，不重跑）
- [ ] 1.1 spike 结论归档（注入通道对比矩阵/时序证据/命令名纠正）随本 change 入库 PRD §3

### 2. F1-c evasions 主世界注入
- [ ] 2.1 结构：`electron/stealth/evasions.js`（从 puppeteer-extra-plugin-stealth 提取 MIT 版，npm 版本锁定+提取脚本 sha256+产物快照 hash 三重锁）
- [ ] 2.2 实现 `electron/stealth/stealth-preload-enhanced.js`：顶层 `executeJavaScriptInIsolatedWorld(0, [{code}], true)` 注入最小集；注入 marker `window.__mpStealthInjected`
- [ ] 2.3 RED→GREEN 单测：假 preload 断言调用与 source 非空；marker 读回；结构锁（版本+sha256+快照）
- [ ] 2.4 `rpa-view-session.js:169` preload 挂载改映射表选变体（现状/增强），映射表进 publish-capabilities.json（douyin/xiaohongshu/shipinhao 默认增强）
- [ ] 2.5 kill-switch 演练：配置关闭单平台 → 该平台无注入（行为锁）
- [ ] 2.6 `stealth-preload.js` 头注修正（错误声明→真实语义+指向增强版）
- [ ] 2.7 H2 风险登记 + 按平台拆分子集（v1 缓解①）

### 3. F1-a/b 行为层
- [ ] 3.1 `electron/stealth/behavior-engine.js`：planMove（贝塞尔+随机控制点+ease+burst+wobble）/planClickSequence（9 字段序列）/planType——移植算法注释保留 MIT 来源
- [ ] 3.2 `electron/services/cdp-input.js`：dispatch/getBounds（DOM.getBoxModel）/typeText（Input.insertText）实现，per-op attach 复用 helpers 模式
- [ ] 3.3 RED：确定性 seed 轨迹断言 + 接口层事件序列断言（假 driver）；变异反证（摘 wobble/改线性/摘 sleep 三条各自变红）
- [ ] 3.4 `rpa-view-session.js` `_click/_fill` 改调行为层；行为层失败回落原生调用并 warn

### 4. F2 isolated world
- [ ] 4.1 `rpa-view-session.js` 增加 isolated evaluate：Page.enable（未启用时）→ getFrameTree → createIsolatedWorld（缓存 contextId）→ Runtime.evaluate({contextId})
- [ ] 4.2 did-navigate 失效重建 contextId（RED 锁）；通信类 binding 不动（v1 范围声明）
- [ ] 4.3 RED：假 debugger 断言路径选择/失效重建/降级回落 main world+warn；结构锁（无裸 executeJavaScript 主世界调用残留于迁移清单内路径）
- [ ] 4.4 通信 binding 留痕评估记录（v1 不动理由入 PRD 决策节）

### 5. PR-1 收口
- [ ] 5.1 QM-6 双模型评审（PR-1 diff）
- [ ] 5.2 QM-1 打包 + 启动 8s stderr 三层判定（AGENTS.md QM-1 新规：stderr 非空未命中红线=NEEDS_REVIEW）
- [ ] 5.3 真机取证启动：B1 数据口径契约计数表建立；首平台灰度 n≥15
- [ ] 5.4 文档同步：CHANGELOG + PRD 取证节更新

## PR-2：camofox 通道 + ddddocr sidecar（F3+F4，依赖 PR-1 合并）

### 6. sidecar-host 基建
- [ ] 6.1 `electron/services/sidecar-host.js`：start(manifest)/health()/stop()/onExit；下载后 sha256 强制校验（拒落地）+ spawn 前完整性复检；Windows 受控路径复制后 spawn
- [ ] 6.2 RED：spawn 失败/端口冲突/异常退出清理/sha256 不符拒落地/篡改拒 spawn 五态
- [ ] 6.3 manifest 建表：camoufox（npm 版本→BUNDLED_CAMOUFOX_RELEASE+sha256）与 ddddocr（requirements 版本+模型 sha256）落 media-tools-lock 同级 speech-sidecar-lock.json

### 7. F3 camofox 通道
- [ ] 7.1 `@askjo/camofox-browser@<pinned>` 依赖 + postinstall 下载路径适配（fail=warn→手动 fetch-bin→通道降级三级）
- [ ] 7.2 `stealth-channel-camofox.js`：CDP-WebSocket 驱动，复用行为层接口（第二个 driver）；仅绑 127.0.0.1+一次性 token
- [ ] 7.3 rpa-view-manager `channel:'stealth'` 路由 + 映射表（publish-capabilities.json）
- [ ] 7.4 RED：路由映射/缺省/sidecar 不可用回落 Electron 通道+warn（禁静默）
- [ ] 7.5 构建期断言：无 `--remote-debugging-port` 非回环监听

### 8. F4 ddddocr
- [ ] 8.1 python-backend captcha 托管路由（ddddocr api/server.py 子进程，拓扑=桌面端 python-backend）
- [ ] 8.2 `electron/services/captcha-solver.js`：检测→截图→HTTP /slide_match|/object_detection→轨迹换算→行为层 dispatch→失败升级
- [ ] 8.3 默认关+白名单+开启理由记录；频控 ≥5min/账号/次
- [ ] 8.4 publishProgress `PHASE_ENUM` captcha 相位三处同步 + zh/en 文案（publishProgress.captchaDetected/captchaManualFallback）
- [ ] 8.5 RED：sidecar 不可达 fail 人工/置信度阈值/频控/轨迹换算精度/默认关锁（白名单空=零自动破解）
- [ ] 8.6 夹具图 8 张（滑块 5+点选 3）识别率 ≥95% 取证

### 9. PR-2 收口
- [ ] 9.1 QM-6 双模型评审（PR-2 diff）
- [ ] 9.2 QM-1 打包（体积账：ddddocr python 栈；超预算触发按需下载备选——R1 决策点）
- [ ] 9.3 真机 A/B：camofox vs Electron 双通道（同任务同账号错峰，每平台每臂 n≥15）
- [ ] 9.4 国内网络下载失败演练（镜像/fetch-bin/降级三级）
- [ ] 9.5 文档同步 + 决策 1/4 改判链数据回填

## 10. 复盘（B1 末）
- [ ] 10.1 /health + 数据口径最终表 + 决策改判记录（F3 去留/F11 探针是否启动/B2 PRD 输入）

## 11. v1.1 评审补丁（CCG 双轴 16 findings 落地项，随对应 PR 完成）

### PR-1 追加
- [ ] 11.1 evasions 注入顺序重构：首行最小 navigator patch + inj-start marker 三态读回（后端 F1）
- [ ] 11.2 「延迟注入」变异反证（推迟 500ms 必须红）（后端 F1）
- [ ] 11.3 exposeBinding `BINDING_ISOLATED_ALLOWLIST` 白名单守卫 + 「allowlist 外走 isolated 必须抛错」单测（后端 F3）
- [ ] 11.4 contextId 双键缓存（frameId+documentId）+ did-navigate 清理重建 + top-frame 范围声明（iframe 内选择器 warn+回落）+ execute 前探活重建（后端 F2）
- [ ] 11.5 captcha 未知相位 fallback 渲染（禁透传 code 原值）+ 单测断言 `PHASE_ENUM ⊆ emitter` 且 `TERMINAL_PHASES` 派生自 PHASE_ENUM（前端 FE2）
- [ ] 11.6 capture 状态机入 PRD 但 UI 留 PR-2：PR-1 只入枚举+fallback+同步单测（前端 FE2 范围裁定）

### PR-2 追加
- [ ] 11.7 camofox hash 信任链：官方签名优先 + GitHub Releases API 与 npm 锁文件两路独立交叉取 hash，不一致拒落地；manifest 注明「复检防磁盘篡改、不防首次下载污染」（后端 F4）
- [ ] 11.8 ddddocr sidecar 强绑 127.0.0.1 + 随机 token header 鉴权（Electron 生成持有）；截图仅内存不落盘；4 个 onnx 权重 LICENSE 逐件核验入 manifest（后端 F5）
- [ ] 11.9 风控分层归类判定器（状态码+失败模式→风控/非风控/未知→人工抽检）；A/B 表述勘误为「同账号通道串行天然纵向交替，排他由通道调度保证」（后端 F6）
- [ ] 11.10 打包体积阈值 CI 断言（ddddocr 栈 ≤250MB 超限红）+ sidecar 生命周期进程级单测（真实 spawn python 子进程测端口冲突/退出清理/健康检查）+ i18n 键存在性 CI lint（成对+引用扫描+孤儿键）（后端 F7）
- [ ] 11.11 captcha 人工兜底状态机 UI：三动作按钮（重试自动识别/我已完成/放弃本通道）+ T1=15s/T2=120s 可配（MP_CAPTCHA_T1_MS/T2_MS 非法值回落+告警）+ manual 阻塞语义说明（前端 FE1）
- [ ] 11.12 通道降级提示一次性事件（channel+runId 去重）+ toast 与进度面板常驻行双承载 + 发布结果 stealthChannelFallback reason 留痕 + run 内不回切（前端 FE3）
- [ ] 11.13 风控设置表单：开启理由必填（预设枚举+备注≤50字）；即时保存（乐观更新→失败整体回滚快照+禁重复点击+错误 toast）；白名单/理由级联规则（关总开关不清空仅置灰）；空态/错误/加载三态（前端 FE4）
- [ ] 11.14 reason code × i18n 键映射表落地为验收项（PRD §9 六键 + translate 未命中降级文案+上报+params 插值）（前端 FE5）
- [ ] 11.15 设置页组件体积说明行（「本地识别组件占用约 XXX MB，随应用安装」，数值取打包实测）+ 更新公告条目（前端 FE7）
- [ ] 11.16 像素基线新增并纳入 CI 像素门禁：captcha 三态×zh/en、降级提示出现态、风控表单四态（默认/空白名单/校验失败/保存回滚）（前端 FE8）
