# Tasks: digital-human-multiprovider

## 1. Provider 能力化（第一步：去硬编码）

- [x] 1.1 新增 `electron/services/digital-human-provider.js`：`resolveDigitalHumanProviderId` / `listDigitalHumanProviders` / `DIGITAL_HUMAN_CAPABILITY`（TDD：11 例）
- [x] 1.2 `digital-human-stages.js` 的 `resolveDigitalHumanProvider` 改为调用能力解析，`DIGITAL_HUMAN_PROVIDER` 降级为兜底常量
- [x] 1.3 `pipeline-model-preflight.js` 的第二处硬编码同样改走能力解析（两处漂移的根因消除）
- [x] 1.4 `model-provider-seeds.js`：heygen 补 `capabilities: ['video','digital_human']`，新增 hifly 种子
- [x] 1.5 `governor-provider-limits.js` + `PRESET_RATE_LIMITS` 补 hifly（与 heygen 同档：异步任务制 8rpm/2 并发）
- [x] 1.6 `videogen-stages.digital-human.test.js` 夹具升级（加 `listProviders` + capabilities），新增 2 例多 provider 用例

## 2. 飞影 HiFly Adapter（第二步）

- [x] 2.1 `adapters/hifly.js`：视频生成 / 状态查询 / 形象音色列表 / testConnection（TDD：33 例）
- [x] 2.2 `adapters/hifly-clone.js`：形象克隆（photo/digital_twin）+ 声音克隆 + 素材上传两段式 + 克隆任务状态（max-lines 拆出，与 heygen-clone 同型）
- [x] 2.3 `_base/base.js` 的 `KNOWN_METHODS` 登记 `createAvatar` / `getAvatarStatus` / `deleteAvatar` / `getVoiceCloneStatus`
- [x] 2.4 `model-provider-manager.js` 注册 hifly adapter

## 3. 克隆产物 provider 隔离

- [x] 3.1 `avatar-clone-registry.js` 新增纯函数 `buildRegistryKey` / `buildSampleRelativeDir`（同一套 provider 分段规则）
- [x] 3.2 `isSafeSampleStorage` 放行 4 段新目录，同时兼容 3 段老目录（升级前已克隆的用户不被误标「素材已缺失」）
- [x] 3.3 `avatar-clone-service.js`：owner 带 `providerId`，`_normalizeRequest` / `normalizeCreateRequest` / `normalizeIdRequest` 透传
- [x] 3.4 `avatar-clone-storage.js` 的 `persistSample` 改为只从 `descriptor.relativeDir` 派生路径（修「registry 写成功但 existsSync 为 false」的幽灵故障）
- [x] 3.5 `avatar-clone-lock.js`：registry 写锁抽出（service 537 → 481 行）
- [x] 3.6 `avatar-clone-helpers.js`：工具方法抽出
- [x] 3.7 新增 4 例 provider 隔离回归测试

## 4. 前端服务商切换

- [x] 4.1 数字人配置区加「数字人服务商」下拉（只列声明 `digital_human` 能力的）
- [x] 4.2 `switchAvatarProvider`：清空已选形象/音色 + invalidate 目录缓存 + 带新 providerId 重拉克隆列表
- [x] 4.3 `useAvatarClone` 的 load/create/delete 全部透传 providerId
- [x] 4.4 locale zh/en 各新增 6 键；新增 2 例切换用例

## 5. 文档

- [x] 5.1 提案 `openspec/changes/digital-human-multiprovider/proposal.md`
- [x] 5.2 PRD 补充（`01-docs/PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19.md`）
- [x] 5.3 user-manual §9.3.1 补「切换数字人服务商」
- [x] 5.4 执行记录 `openspec/records/digital-human-multiprovider.md`

## 6. 验证

- [x] 6.1 全量回归 333/333
- [x] 6.2 max-lines / debt-budget / no-brand-residue / same-type-risk-locks / font-size 全过
- [x] 6.3 locale --keys / --cjk 全过
- [x] 6.4 QM-1 打包 + 启动烟测

## 7. 遗留（不假装已闭合）

- [ ] 7.1 **真实飞影 Token 首跑未执行**：端点与字段来自用户提供的官方文档本地版，但真实 Token 下的响应形状（尤其 `avatar/list` 的 `kind` 语义与分页 `total`）未经核对。首跑 checklist：
  1. `GET /account/credit` 验认证（应返回 `left` 积分）；
  2. `GET /avatar/list?page=1&size=20&kind=1` 核对返回数组与 `total` 是否如文档所示在 `data` 里；
  3. `POST /tool/create_upload_url` 换 file_id → PUT 上传一段 mp4；
  4. `POST /avatar/create_by_video` 拿 task_id → `GET /avatar/task` 轮询到 `status=3` 并取到 `avatar`；
  5. `POST /voice/create`（voice_type=8）→ `GET /voice/task` 轮询到 `voice`；
  6. `POST /video/create_by_tts` 用上面的 avatar+voice 跑一条，轮询 `/video/task` 取 `video_Url`。
- [ ] 7.2 **前端切到飞影后的端到端未验证**：需真实 Token 才能跑通「切到飞影 → 克隆 → 用它生成视频」全链。
- [ ] 7.3 **声音克隆前端入口未做**：adapter 已就绪，但 UI 仍只有形象克隆的照片/视频两个入口；上传录音的入口需另行立项。
