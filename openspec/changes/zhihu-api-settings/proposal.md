# Proposal: zhihu-api-settings

## Why

采集页「知乎收藏文章」用的知乎开放平台 Access Secret 当前有三处真实缺陷（2026-10-15 全仓核查，详见 `01-docs/PRD-ZHIHU-API-SETTINGS-2026-10-15.md` §0.1）：

1. **明文落盘**：密钥以明文 JSON 写进本机 `settings` 表的全局键 `zhihu_access_secret`，与同仓 model-provider / 飞书密钥的 safeStorage 加密姿态不一致。
2. **设备级共享、不按用户隔离**：写的是全局键，与登录身份无关——同机换登录账号后会沿用前一个用户的密钥，用别人的配额、读别人的收藏夹元数据。
3. **保存后不回填、无状态、无自检、无出口**：保存了却从不读回，每次开页面都要重新粘贴；不粘贴就被拦成「请先输入 Access Secret」，而密钥其实早已在库里；设置页没有对应分区，无法判断配好没有、也无法清除。

用户明确要求：**改成每个用户自己的 Access Secret，并在设置里加一个「知乎 API」分区，位置在「飞书 API」下面。**

（先澄清一个前提：源码里**没有**硬编码密钥——全仓检索无密钥字面量，运行时的 live 数据里也没有该行；本变更修的是上表三个缺陷，不是「删除写死的密钥」。）

## What Changes

- **新增凭据服务** `electron/services/zhihu-credential.js`（唯一真源）：`validateSecret` / `readConfig` / `resolveSecret` / `saveConfig` / `markVerified` / `clearConfig`。
  - 落盘：用户域键 `zhihu_api_config`，`accessSecret` 经 `services/crypto`（safeStorage）加密后 base64 存储；safeStorage 不可用时**拒绝保存**（不降级明文）。
  - 解析优先级：**本用户加密配置 > 旧版全局明文 > 无**；旧明文只读兼容，在保存/清除时销账（既不丢配置，也逐步消灭明文）。
  - 写路径带**读回校验**：写入被静默丢弃时报错，不谎报成功。
- **新增设置页分区** `components/ZhihuSettingsTab.vue` + 4 条 IPC（`zhihu:get-config` / `save-config` / `test-connection` / `clear-config`）：
  - 设置弹窗 Tab 顺序改为 模型设置 / 通用设置 / 飞书 API / **知乎 API** / 发布设置 / 账号设置，知乎**紧邻飞书之下**（有回归锁）。
  - 状态三态展示（已配置 / 未配置 / 已保存但无法读取）+ 遮罩（首 4/末 4）+ 保存时间 + 最近验证；旧版明文迁移提示；两步内联确认清除。
  - 明文**永不回显**：输入框不预填，保存成功后立即清空。
- **采集页改造** `features/collection/BatchCollectPanel.vue`：移除就地密钥输入框，改为「状态徽标 + 遮罩 + 获取收藏夹 + 前往设置」；可用性判据改为「解析出的凭据来源非 none」（旧版明文用户不被误伤）；关闭设置弹窗后自动刷新凭据状态。
- **就地打开设置**：`stores/settings-dialog.js` 新增 `requestSettingsDialog(tab)`（带 `seq`，同一 Tab 连点两次仍触发），`App.vue` 接线，`SettingsDialog` 新增 `initialTab`（只在打开那一刻生效）。
- **采集链读数来源收敛**：`ipc-handlers/zhihu-favlist.js` 的 `getAccessSecret()` 改为调用同一凭据服务（消除「设置页说已配置、采集说未配置」的双口径风险）。
- **服务层新增** `ZhihuFavlistService.testConnection(secret)`：复用收藏夹列表这一条真实鉴权调用，不新造探测端点。
- **访问级别**：4 条配置通道按 authenticated（与 `feishu:*` 同级；采集通道仍 public），并在 `license-access-control.js` 写明这条有意的不对称。
- **文档**：专项 PRD + 本 change + 执行记录；上游 PRD 与主 PRD 索引同步。

## Impact

- Affected specs: 新建 `openspec/specs/zhihu-api-settings/spec.md`
- Affected code:
  - 新增：`electron/services/zhihu-credential.js`、`electron/ipc-handlers/zhihu-settings.js`、`src/components/ZhihuSettingsTab.vue`
  - 修改：`electron/ipc-handlers/{index,zhihu-favlist,license-access-control}.js`、`electron/services/zhihu-favlist-service.js`、`electron/preload/aggregation.js`（+ 重打包 `index.bundle.js` / `home-shell-preload.bundle.js`）、`src/components/{SettingsDialog.vue,SettingsDialog.test.js}`、`src/features/collection/{BatchCollectPanel.vue,BatchCollectPanel.test.js,batch-collect-panel-behavior.test.js}`、`src/stores/settings-dialog.js`、`src/App.vue`、`src/locales/{zh,en}.js`、`src/locales/collection/{zh,en}.js`
  - 新增测试：`zhihu-credential.test.js`、`zhihu-settings.test.js`、`ZhihuSettingsTab.test.js`、`stores/settings-dialog.test.js`
- 不改：知乎 API 端点与批量采集/改写业务逻辑、数据模型（除新增一个用户域设置键）、许可白名单分级之外的权限模型
- 兼容性：旧版明文密钥**继续可用**（只读兼容），用户主动保存/清除时迁移与销账
