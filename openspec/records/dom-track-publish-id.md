# 本次执行记录：抖音产物 ID 留档 + 头条视频缺口确认（dom-track-publish-id，2026-10-21）【混合 PR】

- 分支：`dom-track-publish-id`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 electron 代码）
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、改了什么（抖音产物 ID 留档）

### 1.1 动因（PRD §16.22 的未闭合项）
抖音 E2E 首次成功时 `result` 里**没有任何平台侧 ID**，"成功"缺硬证据。
根因：`rpa-view-platforms.js` L1050 只 `return { success:true }`，把 `_waitForResponse`
已 resolve 的 `resp`（含 CDP 采集的 body）整个丢掉。**不是平台不给，是我们没接住。**

### 1.2 实现（三层）

| 层 | 文件 | 内容 |
| --- | --- | --- |
| ① 平台判据 | `rpa-publish-id-extract.js` | 加**抖音专属规则**（`aweme_id`/`group_id`，host 限定 `douyin.com|co` + 值形态 `^\d{10,25}$`），与既有 B 站规则同型（host + 值形态双重门，不按键名盲取） |
| ② 薄封装 | `douyin-dom-publish-id.js`（新） | `extractDouyinPublishId(body, endpoint)`；**独立成模块是因为 `rpa-view-platforms.js` 是 check-max-lines 点名还账文件（零增长容差）** |
| ③ 接线 | `rpa-view-platforms.js` | 成功分支调用 ①+②，把 `publishId` / `publishUrl` 放进返回体 |

### 1.3 真实验证（不是"写了就算"）

```
aweme_id        → "7123456789012345678"  ✅
data.group_id   → "99887766554433"       ✅（嵌套）
非 douyin host  → ""                     ✅（不误采）
短值(形态不符)  → ""                     ✅
HTML / 空       → ""                     ✅（不抛错）
```

纪律落实：取不到留空串、**绝不编造 ID**；解析失败不把成功改成失败。

### 1.4 踩坑：check-max-lines 零增长容差
`rpa-view-platforms.js` 是点名还账文件（目标 1484 行）。我加 6 行 ⇒ 连续 6 次 TARGET_GREW
（1489→1488→1487→1486→1485→1484）。最终靠**压缩 3 处历史注释**（信息无损，3 行→2 行）
+ 去掉自己加的 require 注释才压回 1484。**教训：往零容差文件加代码前，先算好要去哪里省行。**

## 二、头条视频发布：代码缺口确认（非账号问题）

用户新添加**已认证**头条号 `45261bb5` 并授权测试。实测：

```
status: failed
error: 今日头条 视频发布尚未支持：头条视频走西瓜视频上传页，但本仓尚未登记该页的上传入口选择器
       （图文链路不受影响）。本次未向平台提交任何内容，也未占用发布间隔。
submitAttempted: false
```

⇒ **与账号实名无关**；fail-closed 生效（未提交、未占间隔）。

根因（`publish-precondition.js` 头部注释即答案）：
`videoPublishUrls.toutiao` → `profile_v4/xigua/upload-video`（西瓜视频上传页），
而 `PLATFORM_PUBLISH_SELECTORS.toutiao` 是图文文章页那一套且**没有 `file_input`**。
这是 2026-10-17 已定位的缺口，2026-10-18 的门禁把它变成了明确报错。

### ⚠️ 一处认知修正（重要，已写进 PRD §16.23.3）
此前多轮记录写「头条技术链 100% 就绪，唯一阻塞是账号实名」——**这个判断是错的**。
它只对 **API 轨**（`toutiao-video.js`，`tt-full-run.cjs` 预演过）成立；
而实际发布走 **RPA 轨**，RPA 轨缺西瓜上传页选择器。

⇒ 教训：**API 轨预演通过 ≠ 发布链就绪**；判据域必须跟着被测轨道走
（与 §16.18.2「分区凭据结论不能外推到发布链」同型）。

## 三、读数

| 项 | 读数 |
| --- | --- |
| 新增测试 `douyin-dom-publish-id.test.js` | 5 passed（TDD：先 RED 后 GREEN） |
| 相关回归（9 个文件） | **131 passed** |
| `check-max-lines` | ✅（压回 1484） |
| abs-paths / 品牌 / 编码 / unwired | PASS / PASS / OK / OK |
| **QM-1**（改 electron ⇒ 混合 PR） | build:vue 32.85s + electron-builder ✅ + 启动 **PASS（stderr 0 字节）** |
| 真机（头条新认证号） | fail-closed 拒绝（缺选择器），未提交未占间隔 |

## 四、未闭合
- 西瓜视频上传页选择器**未登记**（需真机取证：file_input/标题/描述/封面/发布按钮）—— 这是头条视频发布的真正剩余工作量。
- 抖音 `publishId` 已能提取，但**尚未在真实发布里验证过一次**（需下次复跑）。
- 抖音/视频号/小红书仍未达成"真实发布成功"（抖音已有一次应用侧成功）。

## 五、远程同步

| 远程同步 | 由门禁推导 |
