# 后端轴评审 — B1 PRD v1.0（claude，session cebf1a2d，2026-10-14）

**对象**：PRD-OSS-RPA-HARDENING v1.0（开源强化 B1：F1 stealth + F2 isolated world + F3 camofox + F4 ddddocr）
**总体结论：需修改后开发（条件通过）**——核心选型方向正确，3 个严重安全/正确性问题 + 2 个规格缺口须开发前补齐，F7/F8 随 PR-1 收口。

## Findings

- **F1（严重）D1 选型②未覆盖注入时序竞态**：preload 早失败时页面 JS 已读原生 navigator，marker 读回属 post-hoc（检测晚于损害）。修复：preload 首行同步最小 navigator patch（独立 try/catch 不阻断后续）+ inj-start marker 首行写入三态观测；新增「延迟注入」变异反证。
- **F2（严重）D3 contextId 缓存失效边界缺失**：只列 SPA 导航，漏 iframe（独立 frameId/contextId）、弹窗（新 renderer 需重建）、preload 崩溃后 contextId 悬挂。修复：frameId+documentId 双键缓存 + navigate 清理重建；显式声明 v1 仅 top frame（iframe  warn+回落）；execute 前探活。
- **F3（警告）「不动 exposeBinding」范围不可执行**：文字声明锁不住后人扩范围。修复：`BINDING_ISOLATED_ALLOWLIST` 硬编码白名单守卫 + 测试断言「allowlist 外走 isolated 抛错」。
- **F4（警告）sha256 信任来源未见**：hash 与二进制同出一元则校验不增安全。修复：签名优先（PGP/证书）+ GitHub Releases API 与 npm 锁文件两路独立交叉取 hash；manifest 注明「复检防磁盘篡改、不防首次下载污染」+ 信任锚说明。
- **F5（严重）ddddocr sidecar 本地 HTTP 端口无鉴权**：默认 uvicorn 可能 0.0.0.0:端口，截图含账号/发布内容；onnx 权重许可未核。修复：强绑 127.0.0.1 + 随机 token header 鉴权；onnx 权重 LICENSE 核验记录；截图仅内存不落盘声明。
- **F6（警告）风控判定归属未定义**：自动映射误判网络错误，人工标注不可规模化；A/B 错峰与同账号 TaskQueue 通道串行的相互作用未算（「错峰」实为排队）。修复：分层归类判定器（状态码+失败模式→风控/非风控/未知→人工抽检）；A/B 改述为同账号纵向交替（pair+ctrl）+ 排他由通道调度保证。
- **F7（警告）测试计划缺口**：PR-2 无体积/打包断言、sidecar 生命周期缺进程级单测、i18n 死键检查缺位。修复：体积阈值 CI 断言（≤250MB）；真实 spawn python 子进程的 sidecar 生命周期测试；i18n 键一致性扫描接 CI。
- **F8（信息）QM 映射与三重锁真源**：QM 纪律未落到每 F 验收路径；evasions 三重锁有「哪层是真源」歧义。修复：PRD 加 QM 映射节；明确 npm 版本=单一真源，sha256+快照=防回归冗余。

## 处置

16 条（含前端轴 8 条）全部接受并落入 PRD v1.1，见 `rebuttal-backend-v1.md`；修订版 v1.1 为开发入口态。

---

**provenance**：CCG 后端轴 claude，codeagent-wrapper --backend claude --lite，内联禁读文件式 prompt。
