# PRD：知乎 API 凭据设置化与按用户隔离（zhihu-api-settings）

> 立项日期：2026-10-15 ｜ 分支：`zhihu-api-settings` ｜ Worktree：`D:\Data\projects\mp-worktrees\mp-zhihu-api-settings`
> 状态：实现中（本文档随实现同步收口）
> 上游功能：`zhihu-favlist`（2026-09-18，#1986）、`zhihu-fav-batch`（2026-10-03，`01-docs/PRD-ZHIHU-FAV-BATCH-2026-10-03.md`）
> 触发问题（用户原话）：「目前项目中用到采集知乎内容等相关功能的知乎数据开放平台 Access Secret，是不是在程序里写死的，我之前提供的。需要改成每个用户自己的 Access Secret，需要在设置里加一个知乎 API，加在飞书 API 下面。」

---

## 0. 背景与摸底结论

### 0.1 事实核查（「是不是写死的」）

| 核查项 | 结论 | 证据 |
|---|---|---|
| 源码里是否存在硬编码的 Access Secret 字面量 | **不存在** | 全仓 `git grep` 检索 `zhihu_access_secret` / `ZHIHU_ACCESS` / `Bearer <literal>`：命中的全是「读设置」的调用点与文档，无任何密钥字面量 |
| 安装包/仓库配置里是否携带密钥 | **不携带** | `config/*.yaml`、`.env.example`、asar 打包清单均无该键；密钥只存在于本机 `multi-publish.db` 的 `settings` 表 |
| 运行时实际来源 | 采集页输入框 → IPC `store:set-setting` → `settings.zhihu_access_secret`（**全局、明文**） | `BatchCollectPanel.vue` 的 `saveZhihuSecret()` + `zhihu-favlist.js` 的 `getAccessSecret()` |
| 当前 live 数据里的取值 | **没有这一行**（既未预置、也非「所有人都用开发者那一份」） | `shared-user-data/multi-publish.db` 与 `%APPDATA%@multi-publish\desktop\multi-publish.db` 实测 `SELECT key ... WHERE key LIKE '%zhihu%'` 均为空 |

**因此本任务不是「删掉写死的密钥」，而是修复四个真实缺陷**（用户直觉指向的正是这一组）：

| # | 缺陷 | 现在的行为 | 后果 |
|---|---|---|---|
| D1 | **明文落盘** | Access Secret 以明文 JSON 写进 `settings` 表 | 与同仓 model-provider / 飞书密钥的 safeStorage 加密姿态不一致；本机任何能读 DB 的进程/备份都能拿到密钥 |
| D2 | **设备级共享，不按用户隔离** | 用的是全局 `getSetting/setSetting`，与登录身份无关 | 同一台机器换登录账号后，第二个用户沿用前一个用户留下的密钥 → 用别人的账号配额、读到别人的收藏夹元数据（归属错乱） |
| D3 | **保存后不回填、每次都要重粘** | 保存了却从不读回输入框；`loadZhihuFavlists` 又要求输入框非空才发请求 | 用户每开一次采集页都要重新粘贴密钥；不粘贴就直接被拦成「请先输入 Access Secret」，而密钥其实早就在库里 |
| D4 | **无状态、无自检、无出口** | 没有「是否已配置」的展示、没有连通性自检、没有清除入口；设置页也没有对应分区 | 用户无法判断配好没有；配错了只能靠采集失败的报错猜；换号/离职后密钥无法在原 UI 内清除 |

### 0.2 本次目标（一句话）

**把知乎 Access Secret 从「采集页就地输入的全局明文设置」升级为「设置 → 知乎 API 分区的、按登录用户隔离的、safeStorage 加密的、可自检可清除的凭据」。**

### 0.3 不做（明确排除）

- 不改知乎开放平台的调用方式、不加新端点、不改批量采集/改写业务逻辑（除读取来源）。
- 不做密钥的云端同步（凭据留在本机；与 model-provider 同口径）。
- 不引入第二种密钥形态（不做 AppID+Secret 两段式：知乎只有一段 Access Secret）。
- 不迁移、不清理用户历史采集数据。

---

## 1. 用户旅程

```
① 进入「设置」（左侧导航齿轮 / 任何页面的「前往设置」入口）
        ↓
② 点左侧「知乎 API」（紧挨「飞书 API」之下）
        ↓
③ 看到状态行：未配置 / 已配置（含遮罩与时间）
        ↓
④ 粘贴 Access Secret → 【保存配置】
        ↓  成功：绿色提示「知乎配置已保存（本机加密存储）」+ 状态行变「已配置」+ 输入框清空
        ↓  失败：红色提示 + 主进程给出的具体原因（凭据保护不可用 / 长度不足 / 写入未生效…）
⑤ 【测试连接】（可先用输入框里未保存的值试；也可在保存后留空直接测已存配置）
        ↓  成功：绿色提示「连接成功，读取到收藏夹数量 N」并在已存配置上记「最近验证」
        ↓  失败：红色提示 + 归一原因（频率限制可重试 / 每日配额已用尽 / 无效或已过期 / 网络连接失败）
⑥ 【清除配置】（两步确认）→ 状态回到「未配置」，加密行与旧版明文行一并清除
        ↓
⑦ 回到「采集」页 → 知乎收藏文章分组：状态徽标显示「已配置」+ 遮罩 + 【获取收藏夹】可用
        ↓  （若未配置：徽标「未配置」+ 引导文案 + 【前往设置】按钮就地直达本分区）
```

---

## 2. 数据校验

### 2.1 Access Secret 输入校验（`zhihu:save-config` / `zhihu:test-connection`）

| 字段 | 类型 | 校验规则 | 违规提示（zh） | 错误码 |
|---|---|---|---|---|
| `accessSecret` | string | 必须是非空字符串；先 `trim()` | 「Access Secret 不能为空」 | -2 |
| 同上 | | 裁剪后长度 ≥ 8 | 「Access Secret 长度不足（至少 8 位）」 | -2 |
| 同上 | | 裁剪后长度 ≤ 512 | 「Access Secret 过长（最多 512 位）」 | -2 |
| 同上 | | 不得含控制字符/换行（U+0000–U+001F、U+007F） | 「Access Secret 不能包含换行或控制字符」 | -2 |
| 非 string（数字/对象/数组/null） | — | 一律拒绝 | 「Access Secret 不能为空」 | -2 |

> 为什么长度下界是 8 而不是更严：知乎 Access Secret 的实际长度由平台决定且可能变化，**过严的下界会把将来合法的短密钥挡在门外**；这里只用 8 位挡住「手抖粘贴了一个字符」这一类，真正对不对由「测试连接」判定。

### 2.2 配置写入校验

| 校验项 | 规则 | 失败结果 |
|---|---|---|
| safeStorage 可用性 | `crypto.isAvailable()` 必须为真 | `{ code: -1 }` +「系统凭据保护不可用，无法加密保存知乎 Access Secret」；**不落任何行**（拒绝明文兜底） |
| 用户设置存储可用性 | store 必须具备 `getUserSetting` / `setUserSetting` | `{ code: -1 }` +「用户设置存储不可用，无法保存知乎 Access Secret」 |
| 写入读回校验 | 写入后必须能读回同一行且含非空 `accessSecret` | `{ code: -1 }` +「配置写入未生效（用户设置存储不可用）」——防「身份不可解析导致 setUserSetting 静默 no-op」被报成成功 |
| 旧版明文销账 | 保存成功后必须把 `zhihu_access_secret` 置 null | 销账失败**不**改变「保存成功」结论（新配置已可用），仅不消灭旧明文（下次保存/清除重试） |

### 2.3 连通性测试校验（`zhihu:test-connection`）

| 场景 | 规则 | 提示（zh） |
|---|---|---|
| 传入未保存的明文 | 先按 §2.1 校验；**不落盘**、**不写 verifiedAt** | 校验失败同 §2.1 |
| 未传参 | 解析已存凭据（加密配置优先，其次旧版明文） | 都没有 → -1「未配置知乎 Access Secret，请先在「设置 → 知乎 API」中配置」；**一次都不出站** |
| 平台返回频率限制（Code 30001） | 归一为可重试 | 「知乎 API 频率限制，请稍后重试」（`data.retryable=true`） |
| 平台返回配额用尽（Code 30002） | 归一为不可重试 | 「知乎 API 每日配额已用完，请明天再试」 |
| 其他业务码 | 原样带码 | 「知乎 API 错误（<code>）：<message>」 |
| 网络异常 | 归一 | 「网络连接失败: <err.message>」 |
| 成功（未传参路径） | 记录 `verifiedAt` 与 `favlistCount` | — |

> 测试用的就是**收藏夹列表**这一条真实鉴权调用（不新造探测端点）：新端点会出现「探测通过但功能失败」的假绿灯。

### 2.4 状态三态语义（读侧，`zhihu:get-config`）

| 状态 | 判据 | 含义 | UI 呈现 |
|---|---|---|---|
| 已配置可用 | `configured=true && readable=true` | 本用户加密配置存在且能解密 | 徽标「已配置」+ 遮罩（首 4/末 4）+ 保存时间 + 最近验证时间（无则「尚未验证」） |
| 已保存但读不出 | `configured=true && readable=false` | 密文在，但当前解不开（换机 / 系统凭据保护不可用） | 徽标「已保存但无法读取」+ 红色提示「已保存的密钥当前无法解密…请重新输入并保存」 |
| 仅旧版明文 | `configured=false && legacyDetected=true`（`source='legacy'`） | 历史版本写入的全局明文仍在 | 徽标「未配置」+ 中性提示「检测到旧版明文密钥：保存一次即以加密方式迁移，并清除明文记录。」**采集仍可用** |
| 未配置 | `configured=false && legacyDetected=false` | 从来没有配置 | 徽标「未配置」+ 中性提示（采集页引导去设置） |

`readConfig` 返回体（**永不包含明文**）：

```json
{
  "configured": true,
  "readable": true,
  "maskedSecret": "zhih****7890",
  "updatedAt": "2026-10-15T12:00:00.000Z",
  "verifiedAt": "2026-10-15T12:05:00.000Z",
  "favlistCount": 7,
  "legacyDetected": false,
  "source": "config"
}
```

---

## 3. 存储与安全

### 3.1 落盘形状

| 项 | 取值 |
|---|---|
| 设置键 | `zhihu_api_config`（用户域，经 `setUserSetting`，键名为 `user:<sha256(sub)>:zhihu_api_config`） |
| 行内容 | `{ accessSecret: <base64 密文>, enabled: true, updatedAt: <ISO>, verifiedAt: <ISO\|null>, favlistCount: <number\|null> }` |
| 加密 | `services/crypto.js` → Electron `safeStorage.encryptString`（Windows DPAPI / macOS Keychain / Linux libsecret）；密文再 `base64` 落盘 |
| 旧版键 | `zhihu_access_secret`（全局、明文）仅保留**只读兼容**；保存/清除时置 null |
| 出站 | `Authorization: Bearer <明文>`（只在主进程内存与 HTTP 头里出现） |

### 3.2 按用户隔离的边界（如实声明）

- 应用已登录（身份服务可用）时：配置**按身份 sub 隔离**，A 用户看不到、也用不到 B 用户的密钥。
- 应用未登录/身份服务未配置时：`_resolveOwnerSubject()` 回落 legacy 档，此时配置等价于**设备级**（与 `settings-store.js` 既有口径一致，不是本功能新引入的行为）。
- 渲染端永远拿不到明文：`zhihu:get-config` 只回遮罩；输入框在挂载后为空，保存成功后立即清空。

### 3.3 威胁模型（写清边界，不夸大）

| 威胁 | 本功能是否缓解 | 说明 |
|---|---|---|
| 同机其他用户读取本用户密钥 | ✅ 缓解 | 用户域隔离 + safeStorage（OS 级密钥保护） |
| 备份/同步 `multi-publish.db` 泄露密钥 | ✅ 缓解 | 盘上是密文，脱离本机 OS 凭据无法解密 |
| 同机同用户的恶意进程读取 | ❌ 不缓解 | 与 model-provider / 飞书密钥同一信任边界（可调用同一 OS 解密能力） |
| 渲染进程 XSS 窃取密钥 | ⚠️ 部分缓解 | 明文不过 IPC 回程；但 XSS 仍可调用 `zhihu:test-connection` 触发一次出站 |
| 密钥出现在日志 | ✅ 不出现 | 服务层只记录 count/urlToken；`get-config` 不回明文；错误信息不含密钥 |

---

## 4. 功能逻辑

### 4.1 凭据解析优先级（唯一实现：`services/zhihu-credential.js`）

```
resolveSecret(store):
  1) 读用户域 zhihu_api_config → 有密文 → 解密成功且非空 ⇒ { secret, source: 'config' }
  2) 否则读全局 zhihu_access_secret → 非空 ⇒ { secret, source: 'legacy' }
  3) 都无 ⇒ { secret: '', source: 'none' }
```

**为什么要保留第 2 步**：历史版本已让用户把密钥粘进采集页并落进全局明文行；升级瞬间直接删掉会让这些人「配置凭空消失」。保留只读兼容 + 保存时销账，是「不丢配置」与「消灭明文」同时成立的唯一路径。反向也刻意不选：永不销账 ⇒ 明文长留盘上。

### 4.2 采集链的可用性判据

采集页**不再看输入框**，而是看 `source !== 'none'`：

- `source='config'`：正常路径；
- `source='legacy'`：仍可用，但界面提示去设置里重新保存以完成加密迁移；
- `source='none'` 且 `configured=true`（密文解不开）：提示「已保存的密钥无法读取，请到设置中重新保存」；
- `source='none'` 且 `configured=false`：提示「请先在「设置 → 知乎 API」中配置 Access Secret」+ 【前往设置】。

### 4.3 IPC 契约

| 通道 | 参数 | 成功返回 | 失败返回 | 访问级别 |
|---|---|---|---|---|
| `zhihu:get-config` | — | `{code:0, data:<§2.4 形状>}` | `-1` | authenticated（与 `feishu:*` 同档） |
| `zhihu:save-config` | `accessSecret: string` | `{code:0, data:{configured:true, maskedSecret, updatedAt}}` | `-2` 校验 / `-1` 环境或写入 | authenticated |
| `zhihu:test-connection` | `accessSecret?: string` | `{code:0, data:{ok:true, favlistCount}}` | `-2` 校验 / `-1` 调用失败（含 `retryable`） | authenticated |
| `zhihu:clear-config` | — | `{code:0, data:{cleared:true}}` | `-1` | authenticated |

> **有意的不对称**：`zhihu-favlist:*`（读用户自己的收藏内容）保持 public 未登录可用；新增的四条配置通道写的是**凭据**，按 authenticated 处理（与 `feishu:*` 同级）。分界线是「读内容」vs「写密钥」。

### 4.4 preload 暴露

`preload/aggregation.js` 新增 `zhihuGetConfig` / `zhihuSaveConfig(accessSecret)` / `zhihuTestConnection(accessSecret?)` / `zhihuClearConfig`，经 `index.js` 聚合进 `electronAPI`；`index.bundle.js` 与 `home-shell-preload.bundle.js` 必须重打包（受管产物随仓提交）。

---

## 5. 交互逻辑与显示项

### 5.1 设置 → 知乎 API 分区（`components/ZhihuSettingsTab.vue`）

| 区块 | 元素 | 显示规则 |
|---|---|---|
| 头部 | 标题 | 「知乎 API」 |
| | 副标题 | 「使用说明」 |
| 状态行 | 状态徽标 | 已配置（成功色）/ 未配置（中性）/ 已保存但无法读取（危险色） |
| | 遮罩 | 仅可读时显示，形如 `zhih****7890` |
| | 保存时间 | 仅可读且有 `updatedAt` 时显示，格式 `YYYY-MM-DD HH:mm` |
| | 最近验证 | 仅可读时显示；无 `verifiedAt` 时显示「尚未验证」 |
| 迁移提示 | 中性提示条 | `legacyDetected` 为真时显示 |
| 不可读提示 | 危险提示条 | `configured && !readable` 时显示 |
| 表单 | 标签 | 「Access Secret」 |
| | 输入框 | `type=password`；占位「粘贴知乎开放平台 Access Secret」；`autocomplete=off`；**不预填任何已存明文** |
| | 显示/隐藏 | 文本在「显示 / 隐藏」间切换 |
| 动作 | 【测试连接】 | 有输入 → 用输入值测；无输入 → 测已存配置；请求中禁用并显示「测试中...」 |
| | 【保存配置】 | 空输入 → 不发请求、提示必填；请求中禁用并显示「保存中...」 |
| | 【清除配置】 | `configured=false` 时禁用；点击进入两步确认（按钮变为【确认清除】+【取消】） |
| | 进度文案 | 「清除中...」 |
| 结果行 | 绿/红提示条 | 成功/失败两态，文案见 §5.3 |
| 底部 | 使用说明 5 行 | 见 §5.3 |

**交互禁令（实现约束）**

1. 已存明文**永不回填**输入框（只给遮罩），保存成功后立即清空输入框。
2. 清除必须两步确认，且**首次点击不发任何请求**。
3. 不做模态确认框（`ElMessageBox`）：设置弹窗本身已挂起内嵌视图，再叠一层模态是无谓的层级与挂起计数风险；两步内联确认同样安全且可单测。
4. 任何失败都必须显示**主进程给出的具体原因**，不得统一显示「操作失败」。

### 5.2 设置弹窗（`components/SettingsDialog.vue`）

- Tab 顺序：模型设置 / 通用设置 / 飞书 API / **知乎 API** / 发布设置 / 账号设置（禁用）。
  - **知乎 API 必须紧邻「飞书 API」之下**（用户明确要求，且有回归锁：`zhihuIdx === feishuIdx + 1`）。
- 新增 `initialTab` 属性：打开那一刻定位到指定 Tab；已打开状态下父级重渲染**不得**把用户拉回（只在 `visible` false→true 时生效）。
- disabled 的 Tab 不接受定位。

### 5.3 文案表（zh / en 成对，键在 `knowledgeBase.zhihu*` 与 `collection.zhihuFavlist.*`）

| 场景 | 中文 | 英文 |
|---|---|---|
| 分区标题 | 知乎 API | Zhihu API |
| 区块小标题 | 使用说明 | Instructions |
| 显示 / 隐藏 | 显示 / 隐藏 | Show / Hide |
| 请求中 | 测试中... / 保存中... / 清除中... | Testing... / Saving... / Clearing... |
| 字段标签 | Access Secret | Access Secret |
| 输入占位 | 粘贴知乎开放平台 Access Secret | Paste your Zhihu Open Platform Access Secret |
| 按钮 | 测试连接 / 保存配置 / 清除配置 / 确认清除 / 取消 | Test Connection / Save Config / Clear Config / Confirm Clear / Cancel |
| 状态徽标 | 已配置 / 未配置 / 已保存但无法读取 | Configured / Not configured / Saved but unreadable |
| 时间 | 保存时间 / 最近验证 / 尚未验证 | Saved at / Last verified / Not verified yet |
| 测试成功 | 连接成功，读取到收藏夹数量 N | Connection successful, favorites found N |
| 测试失败 | 连接失败：<原因> | Connection failed: <reason> |
| 保存成功 | 知乎配置已保存（本机加密存储） | Zhihu config saved (encrypted on this device) |
| 保存失败 | 保存失败：<原因> | Save failed: <reason> |
| 清除成功 | 知乎配置已清除 | Zhihu config cleared |
| 清除失败 | 清除失败：<原因> | Clear failed: <reason> |
| 必填 | 请先输入知乎 Access Secret | Please enter your Zhihu Access Secret first |
| 旧版明文 | 检测到旧版明文密钥：保存一次即以加密方式迁移，并清除明文记录。 | A legacy plaintext secret was found: save once to migrate it to encrypted storage and remove the plaintext record. |
| 不可读 | 已保存的密钥当前无法解密（系统凭据保护不可用，或配置来自其他设备），请重新输入并保存。 | The stored secret cannot be decrypted right now… Please enter and save it again. |
| 权限不足 | 当前账号无权修改知乎 API 配置，请先登录或激活许可证。 | Your current account cannot change the Zhihu API config… |
| 使用说明 1–5 | 见 locale `zhihuInstrLine1..5` | 见 locale |
| 采集页未配置 | 请先在「设置 → 知乎 API」中配置 Access Secret | Configure the Access Secret in Settings → Zhihu API first |
| 采集页前往设置 | 前往设置 | Open Settings |
| 采集页徽标 | 已配置 / 未配置 | Configured / Not configured |
| 采集页不可读 | 已保存的密钥无法读取，请到设置中重新保存 | The saved secret cannot be read; please save it again in Settings |
| 采集页旧版 | 检测到旧版明文密钥，建议到设置中重新保存以完成加密迁移 | A legacy plaintext secret was detected; save it again in Settings… |

### 5.4 采集页（`features/collection/BatchCollectPanel.vue`）

- 移除就地密钥输入框（连带删除已无消费者的 `secretPlaceholder` / `secretRequired` 两个键）。
- 新增状态条：状态徽标 + 遮罩（可读时）+ 【获取收藏夹】（未配置时禁用）+ 【前往设置】。
- 状态条下方解释行：未配置 / 不可读 / 旧版明文三种情况各一句（可用且为加密配置时**不显示**，不打扰）。
- 「前往设置」经 `stores/settings-dialog` 的 `requestSettingsDialog('zhihu')` 请求 App 级弹窗，落在知乎 API 分区；`seq` 保证同一 Tab 连点两次也生效。
- 采集页在「设置弹窗关闭」信号（`settingsDialogRevision`）后重新读取凭据状态 ⇒ 用户配好关闭弹窗即看到按钮解禁。

---

## 6. 错误处理与降级

| 失败点 | 行为 |
|---|---|
| `zhihu:get-config` 抛错/权限不足 | 设置页按「未配置」渲染并把原因写进结果行（未登录时给出「请先登录或激活许可证」）；采集页按未配置渲染，不阻塞页面其他功能 |
| preload 未注入（浏览器调试） | 组件在调用前判 `typeof api.xxx === 'function'`，缺方法即静默跳过，不产生 `undefined is not a function` |
| 主进程 IPC 模块未注册 | `get-config` 返回 Electron 原生错误 → 渲染端显示未配置；`ipc-handlers/index.js` 已登记该模块（缺登记会让设置页显示「未配置」而用户明明配过——这正是本次要在注册处写注释的原因） |
| 密文解不开（换机/凭据保护不可用） | 如实报「已保存但无法读取」；解析时回落到旧版明文（若存在），不把用户锁死 |
| 写入被静默丢弃 | 读回校验失败 ⇒ 报错，不谎报成功 |

---

## 7. 验收标准

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 设置页存在「知乎 API」分区且紧邻「飞书 API」之下 | `SettingsDialog.test.js` 断言 `zhihuIdx === feishuIdx + 1` 且点击可切换 |
| A2 | 保存即加密、盘上无明文 | `zhihu-credential.test.js`：落盘行的 `accessSecret` 不含明文；`get-config` 响应 `JSON.stringify` 不含明文 |
| A3 | 按用户隔离 | 经 `setUserSetting` 落用户域（测试断言写在用户域而非全局域） |
| A4 | 旧版明文可迁移且被销账 | 保存后 `zhihu_access_secret` 为 null；仅旧明文时采集仍可用（`source='legacy'`） |
| A5 | 不做假成功 | 写入读回校验失败 → `ok:false`；测试未保存的明文不写 `verifiedAt` |
| A6 | 采集页不再就地输入、状态可见、有出口 | 行为测试：未配置不发请求且提示带「设置」；已配置显示遮罩；「前往设置」发出定位请求；关闭弹窗后刷新 |
| A7 | 文案 zh/en 成对且无硬编码 | `check-locale-sync.js --keys` / `--cjk` PASS |
| A8 | 采集页样式无硬编码 hex | `collection-tokens.test.js` PASS |
| A9 | preload 通道与主进程 handler 一一对应 | `ipc-contract.test.js` PASS（新增 4 通道均有 handler） |
| A10 | 打包产物可用 | QM-1：`build:dir` rc=0、asar 内含新模块、启动 8s 不崩 |

---

## 8. 回归保护与测试矩阵

| 测试文件 | 用例数 | 锁什么 |
|---|---|---|
| `electron/services/zhihu-credential.test.js` | 20 | 校验规则、加密落盘、读回形状、三态语义、优先级、销账、写失效、fail-safe |
| `electron/ipc-handlers/zhihu-settings.test.js` | 13 | 4 通道契约、错误码分档、不落盘/不回明文、verifiedAt 只在已存配置路径写入 |
| `electron/services/zhihu-favlist-service.test.js`（+5） | 18 | `testConnection` 复用收藏夹列表端点、无 secret 不出站、错误归一 |
| `electron/ipc-handlers/zhihu-favlist.test.js`（+2） | 12 | 采集链与设置页共用凭据真源；加密优先、旧明文回落 |
| `src/components/ZhihuSettingsTab.test.js` | 14 | 三态展示、明文不回显、保存清空、两步清除、权限提示 |
| `src/components/SettingsDialog.test.js`（改） | 9 | 6 个 Tab、知乎紧邻飞书、`initialTab` 只在打开时生效 |
| `src/stores/settings-dialog.test.js` | 4 | 打开请求的 seq 语义（同 Tab 连点仍触发） |
| `src/features/collection/batch-collect-panel-behavior.test.js`（改+新） | 15 | 采集页状态条、可用性判据、前往设置、关闭弹窗刷新、既有 P0 锁全保留 |

**变异反证**：8 个变异（销账缺失 / 冒充未配置 / 优先级反转 / 伪造已验证 / 去掉读回校验 / 不清空输入 / Tab 顺序对调 / 可用性判据收窄）必须全部被**指名用例**抓住；还原用字节快照整文件写回。

---

## 9. 文档与交付

- 本 PRD；`openspec/changes/zhihu-api-settings/{proposal,design,tasks}.md` + `specs/zhihu-api-settings/spec.md`。
- 执行记录 `openspec/records/zhihu-api-settings.md`（含门禁表与远程同步行）。
- 上游 PRD `01-docs/PRD-ZHIHU-FAV-BATCH-2026-10-03.md` 增加「凭据来源变更」指引；`01-docs/PRD.md` 增加索引条目。
- CHANGELOG / `.quality-gates.md` / learnings 按「代码 PR 不带热点载体」纪律由**回填 PR** 落地。

## 10. 未闭合（不假装已闭合）

1. **未做真机验证**：需要用户用自己的知乎账号在真实应用里保存 + 测试连接 + 跑一次收藏夹采集；本次证据止于单测/集成级 + 打包产物级。
2. **未登录档仍是设备级**：身份服务未启用时（`_resolveOwnerSubject` 回落 legacy），「按用户隔离」退化为设备级——这是库内既有口径，本片未改。
3. **不做密钥轮换/过期提醒**：平台侧失效只能靠「测试连接」或采集失败暴露。
4. **XSS 面未收窄**：渲染端仍可调用 `test-connection`（明文不回程，但可触发一次出站）。
5. **未提供旧版明文的自动后台迁移**：只在用户主动保存/清除时销账；没打开过设置页的存量用户，其明文行会一直留到下一次保存或清除。
