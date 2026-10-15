# Design: zhihu-api-settings

## 1. 方案对比

| 方案 | 做法 | 评估 |
|---|---|---|
| **A（选定）** 独立凭据服务 + 设置页分区 + 旧明文只读兼容 | `services/zhihu-credential.js` 作唯一真源；设置页读写；采集链只调服务 | 一处实现、两处消费，杜绝双口径；迁移平滑；与飞书/model-provider 同姿态。代价：新增一个模块与 4 条 IPC |
| B 直接把采集页的 `storeSetSetting` 换成 `setSetting` 加密版 | 在 handler 里就地加解密 | 解析规则会出现两份（设置页一份、采集链一份），「已配置 vs 未配置」必分叉；且没有迁移路径，存量明文用户升级即失效 |
| C 把密钥放进环境变量 / 打包配置 | 由构建期注入 | 直接违背需求（要「每个用户自己的」）；且密钥随包分发 = 最坏形态 |
| D 云端托管密钥 | 服务端存 | 需要后端与鉴权改造，远超本任务范围；且引入「密钥离开本机」的新威胁面 |

**选 A**：最小改动同时满足「按用户隔离 + 加密 + 可迁移 + 单一真源」。

## 2. 关键决策与理由

### D1 存储键与作用域

- 新键 `zhihu_api_config`，走 `setUserSetting/getUserSetting`（用户域，键名 `user:<sha256(sub)>:<key>`）。
- 理由：需求是「每个用户自己的」；用户域是库内既有机制（`settings-store.js`），不必新造。
- 边界（如实声明）：身份服务缺席时 `_resolveOwnerSubject()` 回落 legacy 档 ⇒ 等价设备级。这是既有口径，不在本片扩大。

### D2 为什么保留旧版明文只读兼容

- 历史版本已经把用户的密钥写进全局明文行。方案二选一：
  - 直接停用旧键 ⇒ 存量用户升级即「配置凭空消失」，且他们会重复粘贴 → 更差的体验；
  - **只读兼容 + 保存/清除时销账**（选定）⇒ 不丢配置，同时明文只会在「用户从未打开设置页」的机器上暂时留存，并在下一次保存/清除时消失。
- 明文销账失败**不**影响「保存成功」：新配置已可用，销账是收口动作，失败下次重试。

### D3 为什么加密失败要拒绝保存（而不是明文兜底）

与 `services/crypto.js` 头部既有决策一致：safeStorage 不可用时拒绝存储 + UI 显示原因。明文兜底会让「加密」变成有条件成立，等于把安全承诺降级成运气。

### D4 为什么写路径必须读回校验

`setUserSetting` 在身份服务存在但取不到 sub 时**静默 no-op**（`_resolveOwnerSubject` 返回 null ⇒ 早退）。不读回就会出现「界面报保存成功、实际什么都没写、采集仍然说未配置」这种最难的争议形态。读回校验把静默失败变成显式错误。

### D5 为什么 `testConnection` 复用收藏夹列表端点

新造一个 `/ping` 类探测端点会出现「探测通过但功能失败」（同一鉴权模型不等于同一配额/作用域）。复用功能自身要用的那条调用，绿灯才有意义。

### D6 为什么「传入明文测试」不写 `verifiedAt`

用户还没点保存就点测试时，那个值并没有被确认为「要留存的配置」。给它写 `verifiedAt` 会制造一个「已验证」但配置并不存在的状态。只有「测已存配置」这条路径才产生验证证据。

### D7 为什么用两步内联确认而不是 `ElMessageBox`

设置弹窗本身就是应用级模态，且已按 overlay-suspension 合同挂起内嵌视图；再叠一层模态确认会引入新的挂起/恢复配对与层级竞争，收益仅是视觉习惯。内联两步确认（【清除配置】→【确认清除】/【取消】）同样能防误触，且**可单测**（首次点击不发请求）。

### D8 可读性三态（`configured` / `readable` 分离）

只用一个 bool 会把「密文在但解不开」（换机、凭据保护不可用）误报成「未配置」，用户于是反复粘贴而问题不在密钥。分离后 UI 能说清「已保存但无法读取，请重新保存」。同时解析时仍回落到旧版明文（若存在），保证可用性优先。

### D9 采集页可用性判据 = `source !== 'none'`

若用 `readable` 作判据，只有旧版明文的用户会被误判为「不可用」而按钮禁用——但服务端解析其实能拿到密钥。判据必须与解析实现同源。

### D10 访问级别：配置通道 authenticated

`zhihu-favlist:*` 曾按 public 开放（读用户自己的收藏内容）。配置通道写的是**凭据**，与 `feishu:*` 同级定为 authenticated；`license-access-control.js` 中写明这条不对称，防后来者「顺手对齐」。

### D11 `requestSettingsDialog` 用 `{tab, seq}` 而不是裸字符串

给 ref 赋**相同字符串**不会触发 watch ⇒ 用户第二次点「前往设置」无反应。带 `seq` 的对象每次身份都变，重复请求可靠。

## 3. 数据流

```
渲染端（设置页）                     主进程
  zhihuSaveConfig(明文)  ──IPC──▶  zhihu:save-config
                                     ├─ credential.validateSecret
                                     ├─ crypto.encrypt（safeStorage）
                                     ├─ store.setUserSetting('zhihu_api_config', {accessSecret: base64, …})
                                     ├─ 读回校验（失败 ⇒ -1，不谎报）
                                     └─ store.setSetting('zhihu_access_secret', null)  ← 销账旧明文
  zhihuTestConnection(明文?) ─IPC─▶  zhihu:test-connection
                                     ├─ 明文? → 用它测（不落盘、不写 verifiedAt）
                                     └─ 无参 → resolveSecret → 测 → 成功则 markVerified
  zhihuGetConfig()        ──IPC──▶  zhihu:get-config → credential.readConfig（只回遮罩/状态）

采集链（BatchCollectPanel → zhihu-favlist:*）
  zhihu-favlist.js:getAccessSecret() ⇒ credential.resolveSecret(store).secret
  （与设置页同一实现；加密配置优先，其次旧版明文）
```

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 身份服务缺席时用户域退化为设备级 | 文档如实声明（PRD §3.2 / §10）；不改变既有 `settings-store` 口径 |
| `preload` 忘了重打包 | 改动 `preload/aggregation.js` 后必须跑 `pnpm run build:preload`；`ipc-contract.test.js` 断言每个 preload 通道都有主进程 handler |
| 新 IPC 未注册 | `ipc-handlers/index.js` 登记 + 注释说明缺登记的后果；`ipc-contract.test.js` 兜底 |
| 新文案漏 key | `check-locale-sync.js --keys`（实测已抓到一次 `configNotConfigured` 漏配） |
| 采集页样式硬编码色值 | `collection-tokens.test.js`（实测已抓到 `#67c23a`，改语义令牌后通过） |
| 明文滞留 DOM | 组件不预填 + 保存后清空，有回归锁 |
| 旧明文长期留存（用户从不打开设置页） | 已登记为未闭合项（PRD §10.5）；不假装已闭合 |

## 5. 测试策略

- **TDD 两段实跑**：先写测试 ⇒ 33 红（两个新测试文件全红，模块不存在）；补实现 ⇒ 63 绿。
- **变异反证**：8 条（见 PRD §8），全部要求指名红 + 字节级还原校验。
- **消费者并集**：按 `git grep -l` 取受影响面（设置弹窗、采集页、IPC 契约、preload 构建、locale 门禁）全量复跑。
- **QM-1/QM-4**：改动含 `apps/desktop/electron/**` 与可见 UI ⇒ 必须打包与像素回归。
