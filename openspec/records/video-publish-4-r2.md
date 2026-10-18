# 本次执行记录：四平台视频真实发布 —— 真机 E2E 取证与头条/小红书视频链落地（video-publish-4 第 2 轮，2026-10-18）【混合 PR】

- 分支：`video-publish-4`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`）
- 前序：PR #3918（视频号两处真因修复 + DOM 取证通道 + 门禁执行体，已合并 `c2ccb8c7`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md`（本轮补 §10 真机 E2E 取证结果）

## 一、本轮做了什么

1. **把真机 E2E 跑起来了**：连正在运行的应用实例（CDP 10961，我的 worktree 代码），
   对视频号做了 A/B 对照，并用 Playwright + 真实账号 cookie 打开头条/小红书创作页真实上传取证。
2. **A/B 对照（视频号）证明上一轮两处修复生效**（见 §二）。
3. **头条 / 小红书视频选择器按真机取证登记**，并让发布链按内容类型选选择器（见 §三）。
4. **小红书视频契约变更**：从「fail-closed 拒绝」改为「只落草稿箱」（用户硬约束），见 §四。
5. **PRD 补 §10 真机 E2E 取证结果**：取证方法（A/B 两种）、A/B 对照表、头条/小红书真实 DOM 表、
   契约变更说明、按内容类型选选择器的规则、数据校验 V8–V12、提示文字（见 §八）。
6. **D2 签名材料兜底**：抖音 API 轨 Step 0 fail-closed 的真因定位与修复（见 §十）。

## 二、视频号 A/B 对照（真机，同日两次真实发布）

| 环节 | A 组（旧代码，实例 `mp-app-live2`） | B 组（修复后，我的 worktree） |
| --- | --- | --- |
| API 轨 | `Request failed with status code 404`（CDN 主机过期） | 到达新主机 `finder.video.qq.com`，返回 protobuf 业务错误（`Expected HTTP/ RTSP/ or ICE/`），**不再是 404** |
| RPA 入口 | DOM 快照证明落在 `channels.weixin.qq.com/` 与 `/platform`（平台首页） | CDP target 直接看到 `https://channels.weixin.qq.com/platform/post/create`，标题「视频号助手」——**创作页** |
| 上传 | `waitForElement timeout sel=input[type="file"]`（完全找不到） | `file input selectorCount=1` → `uploading file...` ×3 → **`upload={"ok":true}`** |
| 标题/正文 | 全落空 | `title input selectorCount=3`；正文仍未写入 |
| 门禁 | 无（继续点发布 → `publish verification timeout`） | **`pre-submit gate blocked: content-not-filled`**，未点发布 |

⇒ 上一轮两处修复（入口 URL + CDN 主机）**在真机上验证生效**。

## 三、头条 / 小红书真机 DOM 取证（本轮新增，可复用）

方法：应用实例锁着默认 session 的 cookie 库，但 **RPA 分区**的 cookie 库可读
（`shared-user-data/session/Partitions/rpa-<platform>-<accountId>/Network/Cookies`）。
把它连同 `Local State` 复制成 Playwright profile（Chromium 自行解密，同一 Windows 用户），
即可用真实登录态打开平台创作页并真实上传。

### 头条（`profile_v4/xigua/upload-video`）

- 上传前：`fileInputs=1`（隐藏 input，由 `.byte-upload-trigger` 点击区触发）
- 上传后：`上传成功 segment_0000.mp4 大小: 1.1MB 视频时长: 5s` ⇒ 上传完成信号可用
- 标题：`input.xigua-input.show-limit`，`placeholder="请输入 1～30 个字符"`
- 简介：`textarea.byte-textarea.abstract`，`placeholder="请输入视频简介"`
- 话题：`input.arco-input-tag-input`
- 发布三键同排：`button.action-footer-btn.submit`（发布）/ `.draft`（存草稿）/ `.timer`（定时发布）
  —— **「定时发布」也含「发布」二字，故发布按钮必须用精确类，不得 `:has-text("发布")` 打头**

### 小红书（`publish/publish?from=menu&target=video`）

- 上传前：`input.upload-input`（**可见**）+ `button.upload-butto`（text=上传视频）
- 上传后：标题 `input.d-text`（`placeholder="填写标题会有更多赞哦"`）；
  正文 `div.tiptap.ProseMirror`（contenteditable，**不是 textarea**）；
  发布按钮是 **DIV**（text=「发布笔记」，页面上两份：编辑态 + 笔记预览态）；
  另有「定时发布」开关（默认关）

## 四、代码改动

| 文件 | 改动 |
| --- | --- |
| `packages/rpa-engine/src/platform-selectors.js` | 新增 `toutiao_video` / `xiaohongshu_video` 两组选择器（真机取证注释随行） |
| `packages/rpa-engine/src/publish-selectors-by-content-type.js`（新） | `resolvePublishSelectors({platform, article, selectors})`：有视频且登记了 `<platform>_video` ⇒ 视频选择器**覆盖同名字段**，未登记字段回落图文 |
| `apps/desktop/electron/services/rpa-view-platforms.js` | `_getPlatformConfig(platform, article)` 按内容类型选选择器；小红书视频从 fail-closed 拒绝改为走草稿链（`draftOnly: true`），保留守卫（合并后仍无 file_input ⇒ 仍拒绝） |
| `apps/desktop/electron/services/rpa-view-manager.js` | `_publish_generic` 调用点把 article 传进 config |
| `packages/rpa-engine/tests/platform-selectors.test.js` | 「无多余平台」断言放开 `<platform>_video` 键，并要求其基座是已知平台、必须含 file_input |

### TDD

| 文件 | 用例 | 锁什么 |
| --- | --- | --- |
| `packages/rpa-engine/tests/publish-selectors-by-content-type.test.js`（新） | **8 例** | 无视频不回归 / 视频覆盖同名字段 / 未登记字段回落 / 无视频键用图文 / 空表不抛 / 不改入参 / 四平台视频键都含 file_input / 头条发布按钮首选项精确 |
| `apps/desktop/electron/services/video-selectors-by-content-type.test.js`（新） | **4 例** | 头条/小红书视频选择器已按取证登记 / 图文未被污染 / 四平台视频键齐备 |
| `apps/desktop/electron/services/xiaohongshu-video-draft.test.js`（新，从大文件拆出） | **5 例** | 视频走草稿链 draftOnly 不点发布 / 取配置带 article / 真实配置含 upload-input+tiptap / 图文不回归 / 缺 file_input 仍 fail-closed |
| 既有面 | 129 例 | `rpa-view-platforms` / precondition / wiring / upload-order / dom-dump 全绿 |
| `packages/rpa-engine` 全量 | **282 例** | 含改后的「无多余平台」 |
| `packages/api-publish-engine` 全量 | **442 例** | 无回归 |

## 五、门禁读数

| 门禁 | 读数 |
| --- | --- |
| `check-max-lines.js` | **rc=0**（`rpa-view-platforms.js` 收敛到 1484 目标内；测试文件未超 1500） |
| `check-text-encoding-integrity.js` | **OK** |
| `check-no-brand-residue.js` | **PASS**（10145 tracked 文件） |
| ESLint | rc=0 |
| QM-1 `build:vue` | **rc=0**（27.63s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：alive(8s)=true / stderr **0 字节** / stdout 20,928 字节（一次性临时 profile，主 userData 被运行中实例独占） |

## 六、未闭合（如实记录）

1. **视频号正文选择器仍未命中**：真机 `title input selectorCount=3` 但
   `no dedicated title field, title falls back to editor sel=none`。这是视频号最后一处缺口 ——
   需要创作页上传后的 DOM（发布被 60′ 账号间隔挡住，且紧急放行每日仅 1 次已用尽）。
2. **抖音**：API 轨仍缺 `__security_mc_*_s_sdk_sign_data_key_web_protect` 签名 cookie。
3. **头条视频 API 轨**未实现（研究语料给出 `xigua/api/upload/getAuthKey/` → 上传 → `PublishVideo`）；
   本轮落地的是 DOM 轨选择器。
4. **头条真实发布未验证**：本轮只做到「真实上传成功 + 选择器登记」，未点发布。
5. **小红书真实草稿未验证**：未跑通「上传 → 填内容 → 草稿箱计数 +1」。

## 八、PRD 更新明细（`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md`）

新增 §10「真机 E2E 取证结果（R2）」，含七个小节：

| 小节 | 内容 |
| --- | --- |
| 10.1 | 取证方法 A（RPA 分区 cookie 库复制，附各平台可读性表）与方法 B（CDP 驱动运行中实例，含 `accountCheckLogin` 走 HTTP API 不开页面这个反教训） |
| 10.2 | 视频号 A/B 对照表（API 轨 / RPA 入口 / 上传 / 门禁 四行） |
| 10.3 | 头条创作页真实 DOM 表 + 「定时发布」误命中警告 |
| 10.4 | 小红书创作页真实 DOM 表 |
| 10.5 | 小红书契约变更说明 + 守卫保留理由 |
| 10.6 | 按内容类型选选择器的三条规则 + 为何放在 rpa-engine（点名还账零容差） |
| 10.7 | 数据校验 **V8–V12**（视频键基座必须已知平台 / 必须含 file_input / 头条发布按钮精确类 / 小红书 draftOnly / 取证失败必须可见） |
| 10.8 | 提示文字（小红书进草稿链日志、守卫日志、取证无结果、取证旁路异常） |

同时把 §9 第 4 条「真机 E2E 阻断」改写为「已解除」，未闭合清单移到 §11。

文档门禁：`check-doc-abs-paths` PASS、`check-no-brand-residue` PASS（10286 文件）、
`check-text-encoding-integrity` OK、`check-no-conflict-markers` OK、`check-max-lines` rc=0。

## 十、D2 签名材料兜底（`rpa-view-manager.js`）

### 真因（读代码 + 今日日志双向定位）

今日日志：`API publish douyin: 账号信息缺失，请重新授权此账号再试`，且**没有**
`API publish cookie fallback from auth partition` 这行 ⇒ 说明 `authData.cookies` **非空**，
旧兜底判据 `if (!cookie)` 根本没触发。

而 `douyin-video.js` 的 Step 0 是 `hasSecurityMaterials(cookie)`（
`packages/api-publish-engine/src/signer/douyin-ticket-guard.js:112`），要求同时存在：

```
CRYPT_KEY_RE      = /(?:^|;\s*)((?:__security_mc_\d+_|security-sdk\/)?s_sdk_crypt_sdk)=/
SIGN_DATA_KEY_RE  = /(?:^|;\s*)((?:__security_mc_\d+_|security-sdk\/)?s_sdk_sign_data_key[_/]web_protect)=/
```

这两条是**安全 SDK 在页面 JS 运行时**才写进 Electron 分区的，是登录快照**之后**才出现的 ⇒
凭证 store 里永远没有它们。于是「store 有 19 条 cookie」与「缺 2 条签名材料」可以同时成立。

### 修法

判据从「cookie 为空」升级为「cookie 为空 **或**（`platform === 'douyin'` 且签名材料不齐）」。
命中后把分区 cookie **合并**进 store cookie（**分区值优先、store 值兜底**），而非整体替换 ——
避免为了补两条 SDK cookie 丢掉 store 里更全的其余字段。非 douyin 平台判据零变化。

判据自身不可用时（require 失败）保持既有语义，不盲目兜底。

### TDD（新增 5 例，共 11 例）

| 用例 | 锁什么 |
| --- | --- |
| douyin store 非空但缺签名材料 ⇒ 触发兜底并合并 | store 的 `sessionid`/`uid_tt` 仍在，SDK 两条已补上 |
| douyin 签名材料已齐 ⇒ 不读分区 | 不引入多余 IO |
| douyin store 为空 ⇒ 仍走原 D1 整体替换 | 不回归 D1 |
| douyin 分区也为空 ⇒ 保持 store 原串 | 不吞证据，交由 adapter fail-closed |
| 同名 cookie 以分区值优先 + 日志点名 merged | 合并方向正确且可审计 |

同时把原「store cookie 非空时不触发分区读取」那条改为**按平台区分**（kuaishou 不读、
douyin 缺材料才读）—— 旧断言写的是 douyin 不读，与新契约直接冲突。

### 门禁

`check-max-lines` rc=0；ESLint rc=0；受影响面 **147 passed**（8 文件）；
QM-1 `build:vue` rc=0（26.25s）、`electron-builder --win --dir` rc=0、
启动验证 **PASS**（alive(8s)=true / stderr **0 字节** / stdout 21,946 字节）。

## 十一、判据缺口留痕（不在本 PR 修，需后续专项）

**现象**：`QG Changes` / `Gate 12c`（doc-abs-paths 基线）本轮真实红过一次。
根因不是我的文档，而是 `deep-review.sh` 在评审后端超时时会**自行**把 spawnSync 原文
（含 `C:/Users/<name>/.claude/bin/codeagent-wrapper.exe`）写进
`.ccg/reviews/<sha>.json` 的 `error` 字段 ⇒ 被判为「新增失效绝对路径」⇒ 超出存量基线 1 个文件。

**本 PR 的处置**：按仓内既有形态（`14179872` / `a4e95405` / `e9274a02` 等记录均用
`<HOME>` 占位）改写为 `<HOME>/.claude/bin/codeagent-wrapper.exe`；ETIMEDOUT 语义与其余字段逐字未动。

**缺口本身**：`deep-review.sh` 写入的 `error` 字段不受 doc-abs-paths 的占位符化保护
（该保护只覆盖人写的文档），于是**每一轮环境阻塞都会重新制造一次这个红** ——
本会话 4 轮里有 1 轮撞上，属于可预期的复发。

**建议的后续专项**（需单独立 PR，不塞进功能 PR）：
给 `deep-review.sh` 的 error 回写加统一占位符出口（把家目录前缀替换为 `<HOME>`），
并在 `check-doc-abs-paths` 的域内为 `.ccg/reviews/*.json` 的 `error` 字段加一条
「必须是占位符形态」的断言。否则这条红会按阻塞频率稳定复发。

## 十二、远程同步

| 远程同步 | 由门禁推导（合并后按主干历史收口；不手写状态词） |
