# 本次执行记录：封面五步链沉淀 + 21000 提交时兜底（toutiao-cover-module，2026-10-19）【混合 PR】

- 分支：`toutiao-cover-module`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：#4008（封面链真解取证 `7ebea9fb`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §12.6.7.4 ①②（本轮关闭）

## 一、这轮把取证变成代码

上一轮（#4008）只把封面五步链**取证**进了文档；本轮沉淀为**可执行、可回归的代码**：

| 文件 | 内容 |
| --- | --- |
| `src/publish/platforms/toutiao-video-cover.js`（新增，192 行） | 五步编排 `uploadCoverImage()` + 三个纯函数判据 `pickImageTempCreds / pickUploadTarget / pickRegisteredImage`；模块头完整注释五步与已否证路由（imagex 公共网关 / pgc 预探测），防后人凭记忆改 |
| `test/toutiao-video-cover.test.js`（新增 8 例） | 假服务器逐断言（零外发）：头齐全、PUT 带完整 JWT、登记 body、失败路径 fail closed |
| `src/publish/platforms/toutiao-video-publish.js` | `parsePublishResponse` 增加 `accountGate` 判据：`Code 21000` **或**原文含「未实名认证/帐号不可用」（防平台换码，双判据） |
| `src/publish/platforms/toutiao-video.js` | `run()` 提交出口：`accountGate` ⇒ 返回 `ACCOUNT_NOT_VERIFIED`（与提交前闸门**同码**，UI 据码反查同一「去完善」链接）；+4 行，491→495（仍 <500） |
| `scripts/run-tests.js` | 新测试登记进 `VITEST_FILES`（漏登记会走 node 直跑分支必崩——本轮实测踩到，见 §三） |
| `test/toutiao-video-chain.test.js` | +2 例（判据双命中/不误判其它业务码；出口同码同链接） |

## 二、设计取舍（自查要点）

1. **21000 用「码或原文」双判据**：平台换码时原文兜底；但**其它业务码绝不误判**
   （测试锁：`20007014 ThumbUri` 不命中、`Code:0+ItemId` 不命中）。
2. **出口复用 `ACCOUNT_NOT_VERIFIED` 而非新码**：UI 的解法链接表在 shared-utils 是**按码反查**
   （#3983），同码 ⇒ 用户看到同一「去头条号完善账号信息」链接，零 UI 改动。
3. **封面模块零依赖链内状态**：注入 `mpClient/vasClient/axiosLike`，生产不传 `tosBaseUrl`
   时用三元组返回的 `tos_host`（真页面同款）。

## 三、本轮踩到并当场修的一个坑（如实记）

新测试**漏登记进 `run-tests.js` 的 `VITEST_FILES`** ⇒ 走 node 直跑分支必崩（`describe is not defined`
同族），单文件 vitest 直跑却是绿的 —— 又一次「单文件绿 ≠ 接线绿」。已补登记并把 45 个文件全量 rc=0
作为判据。此坑与 #3983 的 vite alias 同族：**新文件 ≠ 已被正确 runner 执行**。

## 四、读数

| 项 | 读数 |
| --- | --- |
| `toutiao-video-cover.test.js` | **8 passed** |
| `toutiao-video-chain.test.js` | **34 passed**（32+2） |
| `packages/api-publish-engine` 全量 | **rc=0**（**45** 个 vitest 文件，44→45） |
| `check-max-lines` | ✅（链 495/500） |
| `check-unwired-tests` | OK |
| 编码 / 品牌 / doc-abs-paths / 记录债务 | OK / PASS / PASS / OK |
| QM-1 | build:vue rc=0(45.4s) / electron-builder rc=0 / 启动 PASS（stderr 0 字节） |

## 五、发布链终态（本轮后）

| 步 | 状态 |
| --- | --- |
| 视频上传（getAuthKey(video)→…→CommitUploadInner） | ✅ 代码既有 |
| **封面上传（image_temp 五步）** | ✅ **本轮代码化**（此前只有取证） |
| 提交 PublishVideo | ✅ 代码既有 + **本轮加 21000 兜底映射** |
| 账号墙 | ⛔ 等人工实名（提交前 #3977 检测 + 解法链接 #3983；提交时本轮同码兜底） |

⇒ 账号一实名，头条 API 轨**可直接真实发布**（无需再改代码）。

## 六、未闭合

1. `uploadCoverImage` 尚未接进 `run()` 的封面闸门（现在调用方需显式调；接法：`hasLocalCoverOnly` 分支改为调用本模块 —— 下轮小 PR，因涉及 coverInputs 形状契约，留充分单测空间）。
2. main 的债务熔断红仍归 #3969（见其 PR 评论），本轮未越界处理。

## 七、远程同步

| 远程同步 | 由门禁推导 |
