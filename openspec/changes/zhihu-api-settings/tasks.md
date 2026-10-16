# Tasks: zhihu-api-settings

## 1. 规格与文档
- [x] 1.1 事实核查：确认源码无硬编码密钥、live 数据无该行（PRD §0.1）
- [x] 1.2 专项 PRD `01-docs/PRD-ZHIHU-API-SETTINGS-2026-10-15.md`（数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字全量）
- [x] 1.3 spec delta `openspec/changes/zhihu-api-settings/specs/zhihu-api-settings/spec.md`
- [x] 1.4 proposal.md / design.md（方案对比 + 11 条决策与理由 + 风险表）

## 2. TDD（先红后绿，两段实跑留证）
- [x] 2.1 `electron/services/zhihu-credential.test.js`（20 条）：校验规则、加密落盘、读回形状、三态、优先级、销账、写失效、fail-safe
- [x] 2.2 `electron/ipc-handlers/zhihu-settings.test.js`（13 条）：4 通道契约、错误码分档、不落盘/不回明文、verifiedAt 只走已存配置路径
- [x] 2.3 `electron/services/zhihu-favlist-service.test.js`（+5 条）：`testConnection` 复用收藏夹列表端点
- [x] 2.4 `electron/ipc-handlers/zhihu-favlist.test.js`（+2 条）：采集链与设置页共用凭据真源
- [x] 2.5 `src/components/ZhihuSettingsTab.test.js`（14 条）：三态展示、明文不回显、保存清空、两步清除、权限提示
- [x] 2.6 `src/components/SettingsDialog.test.js`（改）：6 Tab + 知乎紧邻飞书 + `initialTab` 只在打开时生效
- [x] 2.7 `src/stores/settings-dialog.test.js`（4 条）：打开请求的 seq 语义
- [x] 2.8 `src/features/collection/batch-collect-panel-behavior.test.js`（改+新）：状态条/可用性判据/前往设置/关闭弹窗刷新 + 既有 P0 锁全保留
- [x] 2.9 RED 取证：先写测试 ⇒ 33 红；补实现 ⇒ 63 绿（4 文件）

## 3. 实施
- [x] 3.1 新增 `electron/services/zhihu-credential.js`（唯一真源：validate/read/resolve/save/markVerified/clear）
- [x] 3.2 新增 `electron/ipc-handlers/zhihu-settings.js`（4 通道）
- [x] 3.3 `electron/ipc-handlers/index.js` 注册 + 缺登记后果注释
- [x] 3.4 `electron/ipc-handlers/zhihu-favlist.js` 改用凭据服务
- [x] 3.5 `electron/ipc-handlers/license-access-control.js`：写明配置通道 authenticated 的有意不对称
- [x] 3.6 `electron/services/zhihu-favlist-service.js` 新增 `testConnection`
- [x] 3.7 `electron/preload/aggregation.js` 暴露 4 个绑定 + 重打包 `index.bundle.js` / `home-shell-preload.bundle.js`
- [x] 3.8 新增 `src/components/ZhihuSettingsTab.vue`
- [x] 3.9 `src/components/SettingsDialog.vue`：Tab 顺序 + `initialTab`
- [x] 3.10 `src/stores/settings-dialog.js` + `src/App.vue`：`requestSettingsDialog` 接线
- [x] 3.11 `src/features/collection/BatchCollectPanel.vue`：状态条 + 前往设置 + 可用性判据 + 关闭弹窗刷新
- [x] 3.12 locales zh/en 成对（`locales/zh.js`+`en.js`、`locales/collection/zh.js`+`en.js`），删除已无消费者的 `secretPlaceholder`/`secretRequired`

## 4. 门禁与验证
- [x] 4.1 定向单测全绿；消费者并集复跑（electron 契约/构建 + 采集页 + 设置弹窗 + stores）
- [x] 4.2 `check-locale-sync.js --keys` / `--cjk` PASS
- [x] 4.3 `check-max-lines.js` PASS（无新增超大文件）
- [x] 4.4 `collection-tokens.test.js` PASS（硬编码色值改语义令牌）
- [x] 4.5 `ipc-contract.test.js` PASS（4 个新 preload 通道均有主进程 handler）
- [x] 4.6 变异反证 8 条，全部指名红 + 字节级还原校验（M4 首跑逃逸已定位为观察通道缺口并补锁，M7 首跑锚点因 CRLF 失配已修驱动）
- [x] 4.7 QM-1 打包（`build:dir` rc=0）+ asar 清单/逐文件 sha256 内容同一性 + 启动存活与 stderr 三层判据（stderr 长度 0）
- [x] 4.8 QM-4 视觉回归（含「端口被并发会话占用 ⇒ 量错对象」的假红证伪 + 去掉本次改动的对照组归因）
- [x] 4.9 `check-pr-exec-record.js --base=origin/main --mode=enforce` OK

## 5. 交付收口
- [x] 5.1 执行记录 `openspec/records/zhihu-api-settings.md`（含门禁表 + 远程同步两形态）
- [x] 5.2 上游 PRD（`PRD-ZHIHU-FAV-BATCH-2026-10-03.md`）与主 PRD 索引同步
- [ ] 5.3 推送 + PR + CI 全绿 + 自动 squash 合并
- [ ] 5.4 回填 PR（记录远程同步行 PENDING→PASS + 删除 sync_* 三字段）
- [ ] 5.5 记忆沉淀（内置记忆 / 外部记忆 / EverOS）+ worktree 按 R1-R5 清理
