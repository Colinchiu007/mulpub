# Proposal: competitor-reuse-account-publish（复用竞品逆向成果，升级账号管理与内容发布）

> **第三版（2026-10-22）**。相比 #4108 / #4140 两版，本版新增：
> ① **小红书发布链的三阶段证据链**（其中 B 阶段是唯一有运行期数据的，判据最强）；
> ② **账号模块**的成果清单（前两版几乎没覆盖）；
> ③ **§5 已失效结论表** —— 7 条被实测推翻的旧结论，照抄会直接犯错。

## Why

两个竞品（融媒宝、参考产品 4.0）的系统性逆向工程已完成，产出沉淀在独立的逆向成果仓库。
其中已验证可用的成果此前只落地了一项（快手 `__NS_sig3` 纯 JS 化，PR #4090），
其余成果仍停留在「分析文档」层，未转化为本项目的实际能力。

同时存在三个具体的未解决问题：

1. **发布链路覆盖不足**：竞品支持的平台/链路中，我方 adapters 存在「有骨架但无验证」
   「签名链路不最优」「完全缺失」三种缺口，缺一份可核对的覆盖度矩阵来定位。
2. **账号管理缺契约来源**：我方账号态/cookie 建模、平台配置字段缺乏与真实平台结构对拍过的依据。
3. **E2E 真机测试不成功**：已知阻塞项。逆向成果中恰好包含各平台发布链路的
   真实时序、请求契约、签名形态——这些正是构造稳定 E2E 假服务器/契约测试所需的
   「外部真值」来源。当前 E2E 失败很可能源于我方对平台契约的假设与真实契约不一致。

本 change 的目的是把这些成果**系统性地**转化为本项目能力，而不是让它们继续沉睡在文档里。

## What Changes

- 产出**平台 API 覆盖度矩阵**（三档：已支持 / 可优化 / 完全缺失），作为后续所有优化的定位基准。
- 按矩阵对账号管理与内容发布做全方面升级优化，**每个落地项独立 PR**。
- 对 **E2E 真机测试不成功**的问题，直接利用逆向成果中的真实链路时序与请求契约，
  以 127.0.0.1 假服务器钉住请求序列/头/body，把「依赖真机与真实账号」的脆刺 E2E
  改造为「契约级可复现」的测试；真机验证降级为最终验收而非唯一手段。
- 复用 `kuaishou-sig3.js` 已验证的三个模式：`verifyKnownVector()` 算法自检、
  `createSigner()` 状态隔离、「fail-closed 边界 + 输入构造单独成测」的测试组织。

## 用户原始需求（原文照录，作为不可裁剪的范围声明）

> 任务：基于竞品逆向成果，优化本项目的账号管理与内容发布。你可以利用以下列出的成果，
> 对于项目中的账号和发布功能，进行全方面的升级和优化。对于E2E真机测试不成功的问题，
> 也可以直接利用逆向成果进行完全的复用、集成和参考。

## 必读材料（顺序即依赖顺序）

> 跨仓材料位于逆向成果仓库，仓内相对路径记作 `<REVERSE-REPO>`；
> 本仓材料路径以仓库根为基准。

1. `<REVERSE-REPO>/00-vendor-originals/README.md` —— 原件清单与研究价值说明，**动手前必须读完**。
2. `<REVERSE-REPO>/01-analysis/交付物总索引.md` —— 114 项成果总入口，从这里按需下钻。
3. `<REVERSE-REPO>/01-analysis/融媒宝-Asset-sign2目录全解与sign6定性.md` —— 签名体系全景。
   **关键认知：`Asset/sign2/` 目录名有误导性** —— 5 个 bundle 里 4 个是小红书，
   只有 `chuangzuozhe.js` 是快手；只有快手与小红书走「页面内 JS 签名」，其余走原生实现。
4. `packages/api-publish-engine/src/signer/kuaishou-sig3.js` —— **已合入 main 的范本实现**，新实现向它看齐。
5. `openspec/records/kuaishou-sig3-purejs.md` —— 完整执行记录（逃逸分析 + 三轮评审处置）。
6. `openspec/changes/competitor-reuse-account-publish/` —— 本 change 自身。

## 成果总览（两大模块）

### 发布模块

| 平台 | 签名方式 | 链路完整度 | 判据强度 |
|---|---|---|---|
| 快手 | `__NS_sig3`（页面 VM → 已白盒为纯 JS） | ★★★ 完整 | **强**（真实服务端 `result:1`） |
| 小红书 | `X-s` / `X-t`（原生 + 前端 bundle 双源） | ★★ 上传链完整，提交链缺 | **强**（真实抓包） |
| 抖音 | `clientSign` + 空 `a_bogus` | ★★ 契约完整 | 中（未活体） |
| 百度 | `verifyToken` | ★ 只见鉴权链 | 弱 |
| 其他 16 平台 | 多为原生实现 | ★ 仅 API 清单 | 弱 |

### 账号模块（本版新增）

| 主题 | 成果 | 位置 |
|---|---|---|
| 平台 API 全清单 | 498 端点 / 10 host | `mtm-platform-apis.md` |
| 平台配置结构 | top10 平台配置拆解 | `融媒宝-平台配置拆解-top10.md` |
| 账号态/cookie 结构 | 各平台 cookie 字段语义 | `mtm-strings-analysis.md` |
| 抖音 cookie 名缺陷 | 签名材料 cookie 名不匹配（我方已知缺陷） | `关键缺陷-抖音签名cookie名不匹配.md` |
| ticket-guard 契约 | 账号安全验证的契约形态 | `Refproduct-完整拆解.md` |
| 可复用代码清单 | 参考产品侧可直接参考的实现 | `05-参考产品-materials/可复用代码分析.md` |
| RPA 侧账号流 | 参考产品 RPA 的账号管理 | `05-参考产品-materials/RPA分析报告.md` |

## 可复用成果分级（严格区分，误用即越线）

### A 级：可直接复用（代码/实现已在生产）

**发布侧**
- 快手 `__NS_sig3` 纯 JS 实现（`kuaishou-sig3.js`）
- `verifyKnownVector()` 自检模式、`createSigner()` 状态隔离模式
- 「fail-closed 边界 + 输入构造单独成测」的测试组织方式

**账号侧**
- 平台 API 端点清单（498 个）—— 核对我方 adapters 覆盖度
- 各平台 cookie 字段语义表 —— 我方账号态建模的依据
- 平台配置字段结构 —— 扩充 `config/platforms.yaml`

**复用方式**：这些是已验证的事实，可直接作为我方实现的判据来源，不需要重新逆向。
按本项目自己的测试重新实现即可。

### B 级：参考架构与流程（参考设计，按本项目测试重新实现）

**发布侧**
- 各平台发布链路时序：
  - 快手：`upload/pre → finish → cover → submit`
  - 小红书：`permit → PUT ros-upload → suggest/topics → （提交，未拿到）`
  - 抖音：`getSdkToken → getAuthKey v5 → aws4 分片上传 → finish → cover → create_v2`
- 请求体/签名头的结构形态（如快手 `{url, type, params}` payload 契约）
- `scene` 参数三态设计（`image` / `video` / `preview_video`）—— 小红书上传的场景分流

**账号侧**
- 竞品对「多平台账号统一管理」的建模方式
- ticket-guard 等账号安全验证的契约形态
- 抖音 `bd-ticket-guard-*` 头组与 cookie msToken 的组织方式

### C 级：仅作情报（了解存在，不作为实现依据）
- 竞品 UI/交互细节
- 未定性的模块（如 `AgComment`、`DouyinBd`）
- `pro.xiaohongshu.com`（企业号域，与发布无关）
- 任何未做真实服务端验证的结论

## 小红书专题（本版重点，三阶段证据链）

A/C 是静态分析，**B 是唯一有运行期数据的**，判据强度最高。

### 已确认的事实

**① 完整图文上传链（B 阶段真实抓包）**
```
GET  /api/media/v1/upload/creator/permit
        ?biz_name=spectrum&scene=image&file_count=1&version=1&source=web
PUT  ros-upload-d4.xhscdn.com/spectrum/<fileId>
POST /api/galaxy/v2/creator/recommend/suggest/topics
        {"file_ids":["spectrum/<fileId>"], "topic_round_start_time":<ms>}
```
- `scene` 三态：`image` / `video` / `preview_video`
- `file_id` 形态：`spectrum/<base64url>`
- 上传后**立即**被 `suggest/topics` 消费 —— 「上传成功→进入发布流程」的衔接点

**② `X-s` 签名契约（A 前端 + C 原生双源互证）**
```
X-s = MD5([X-t, r, e, body].join(""))
  r    已溯源 = getRealUrl 规范化后的 URL
  body = a ? JSON.stringify(t) : ""     （空请求体为空串）
  优先 window._webmsxyw，缺失回退本地 encrypt_sign
```
原生层三个函数：`get_xiaohongshu_x_s` / `get_xiaohongshu_x_t_param` / `getxiaohongshuuserinfo`

**③ 16 个只读端点全部 200 `success=true`**（真实响应字段已记录）
`galaxy/user/info`（userId/userName/redId/role/permissions/phone）、
`galaxy/creator/home/personal_info`、`latest_note_data`、
`galaxy/v2/creator/datacenter/*`、`galaxy/v2/creator/notice` 等

**④ 风控面**
- `as.xiaohongshu.com/api/sec/v1/shield/webprofile` —— 11 KB 设备指纹
- `as.xiaohongshu.com/api/sec/v1/scripting` / `sbtsource` —— 安全脚本/人验源
- `edith/api/sns/web/racing_get` —— AB 实验分流（带 `web_id` + `user_id`）

### ★ 草稿是浏览器本地存储（硬约束）

小红书页面原文：

> 草稿存储于当前使用的浏览器本地，在清除浏览器数据时会被删除；
> 图文笔记最多支持保存 100 篇草稿，超出后将默认删除最后一篇草稿，请及时发布。

**这解释了「同账号草稿箱 10 vs 0」** —— Playwright profile / Edge / 应用内 WebView
是三个独立容器，本地草稿库互不相通。不是 bug。

**对集成的硬约束**：

| 影响面 | 结论 |
|---|---|
| 跨浏览器读小红书草稿箱 | **不可能实现，不要做这个需求** |
| 我方草稿能力 | **只能写自己的草稿库**，不能依赖小红书的 |
| 草稿上限 | 100 篇 FIFO，超出删最后一篇 |
| 清理风险 | 清浏览器数据 ⇒ 草稿全失，产品层需提示用户 |
| 发布链路 | **不受影响** —— 发布是云端动作 |

### 发布提交态拿不到（12 轮实证）

「暂存离开」（= 存草稿）按钮无法通过自动化稳定触发：`setInputFiles` 后页面重导航
（URL 出现 `from=tab_switch`），底部操作栏不再渲染。`body.innerText` 与
`querySelectorAll` 均不可见，截图却看得到，无 iframe/shadow DOM 可解释。

**这是本项目保留 Tier-B（浏览器签名器）的直接实证** —— `submit` 不可逆，
不值得为它反复自动触发。与 PR #4090 保留 `-browser` 回退通道的设计一致。

**若要闭合**：改用 `page.on('filechooser')` + `setFiles()`（真实对话框路径）、
上传后用 `waitForURL` 而非固定 sleep、轮询 `getByText('暂存离开').count() > 0`；
**或退一步**只抓上传链 + 只读链（已足够支撑 API 集成），发布提交态交给人工点一次抓 HAR。

## ⚠️ 已失效/被推翻的结论（不要照抄，会犯错）

| 旧结论 | 实际 | 出处 |
|---|---|---|
| `create.xiaohongshu.com` 是上传域 | **`ros-upload-d4.xhscdn.com`** | C 阶段据 DLL 字符串推断，B 阶段实测推翻 |
| 小红书有两套签名（`X-s` + `X-s-common`） | `X-s-common` 是**腾讯云 COS 上传签名** | C 阶段自我更正 |
| `X-t` 是手势轨迹埋点 | `X-t` 与 `X-s` 同函数产出，`X-s` 由它算出 | A 阶段自我更正 |
| `sign6.js` 属 B站/百家号 | **小红书**（363 次平台词命中） | sign6 定性篇 |
| `Asset/sign2/` 是小红书目录 | 5 个 bundle 里 4 个是小红书，`chuangzuozhe.js` 是快手 | 同上 |
| `sign3.js` 是快手 sig3 | `sign3.js` 是 **SM3（抖音线）**，快手 sig3 在 `chuangzuozhe.js` | 同上 |
| 抖音本地签名已可用的旧结论 | 从未在真实平台验证过；实测 cookie 已过期未取得基线 | sig3 专题 |

**教训（多处同型）**：凭「名字像」/「相邻索引」/「二进制里有这个字符串」下结论，
没看上下文或没做运行期验证。**复用这些成果时，对每条结论先问「判据是什么」。**

## Capabilities

### New Capabilities

- `api-publish-competitor-reuse`: 定义把竞品逆向成果转化为本项目能力的**过程契约**——
  覆盖度矩阵的判据、A/B/C 分级的使用边界、E2E 契约化改造的要求、执行红线与
  未验证边界的标注义务。

### Modified Capabilities

（无。本 change 第一阶段只产出矩阵与流程约定，不改任何既有 Requirement；
后续每个落地项各自开 change 修改对应 capability。）

## Impact

- **代码面**：第一阶段零代码改动。后续落地项各自独立 PR，各自声明影响面。
- **测试面**：引入「用逆向成果中的真实契约构造假服务器」的 E2E 改造模式，
  预期显著降低对真机与真实账号的依赖。
- **文档面**：`evidence/` 存放矩阵与逐项证据；`01-docs/` 不放绝对路径（Gate 12）。
- **账号面**：新增账号模块的契约来源（498 端点清单、cookie 字段语义、平台配置结构），
  用于账号态建模与 `config/platforms.yaml` 扩充。
- **风险**：
  - E2E 契约化可能把「真机才暴露的问题」推到线上，因此**契约测试之外仍保留真机验收**
    作为最终判据（见 tasks §6）；
  - **凭证安全**：逆向仓内 `04-rea-evidence/raw/`、`.pw-profile-xhs/`、
    `mtm-ghidra-snapshot` 含未脱敏抓包与真实登录态，**永不入仓、永不 `git add -f`**。
