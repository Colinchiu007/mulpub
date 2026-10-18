# 本次执行记录：四平台视频真实发布（视频号入口/CDN 修正 + DOM 取证 + 门禁执行体）（video-publish-4，2026-10-18）【混合 PR】

- 分支：`video-publish-4`
- worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`（非 C 盘）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md`
- 前序：PR #3905（发布失败 6 平台归因 + 前置门禁）、#3913（CHANGELOG/learnings 收口）

## 一、目标与结论

目标：抖音 / 视频号 / 今日头条 / 小红书（草稿箱）**视频真实发布成功**。

本轮结论：**四平台真因全部定位**（今日真机日志 + 平台静态包取证），其中**视频号两处已修**
（RPA 入口 URL、API 轨 CDN 主机），并新增**真机 DOM 取证通道**与**门禁执行体**；
抖音 / 头条 / 小红书按 §六 未闭合推进。

## 二、取证（只读）

今日日志 `shared-user-data/logs/app-2026-10-18.log`（每平台各 3 次失败）：

| 平台 | API 轨 | RPA 轨 |
| --- | --- | --- |
| douyin | `账号信息缺失，请重新授权此账号再试` | `publish timeout` |
| tencent_video | `Request failed with status code 404` | `publish verification timeout`（停在 `/platform`） |
| toutiao | 无视频 API 轨 | `publish btn not found` |
| xiaohongshu | 路由从不进 API（硬编码 `rpa_vm`） | 主动拒绝（视频草稿链未实现） |

### 视频号 RPA 真因（逐行）

`waitForElement timeout sel=input[type="file"]` → `no-title platform skip` →
`timeout sel=button:has-text("发表")` → `confirm dialog probe: MODAL_NO_MATCH … PAGE_BTNS=关于腾讯/微信视频号运营规范/问题咨询`
→ 验证快照是首页内容（`视频57 关注者50`）⇒ **RPA 落在平台首页**。
根因：`config/platforms.yaml` 的 `tencent_video.publish_url` = `https://channels.weixin.qq.com/`。

### 视频号 API 真因（静态包取证）

- 链里 CDN 主机 `finderassistancea.video.qq.com`：`applyuploaddfs` / `uploadpartdfs` /
  `completepartuploaddfs` 三条路径**全部 404**（真机 HTTP 实测）。
- 创作页自身代码 `finder-helper-web` 的 `chunk-common` 内：`this.HOST = "finder.video.qq.com"`、
  `ReplaceHost = "https://finder.video.qq.com"`；该主机**可达**（返回 protobuf 业务码而非 404）。

### 抖音真因

API 轨 Step 0 `hasSecurityMaterials()` 为假 —— cookie 缺
`__security_mc_<N>_s_sdk_sign_data_key_web_protect`（签名材料），与上一轮快手
`missing kuaishou.web.cp.api_ph` 同族：**cookie 采集不全**，不是发布链缺陷。

### 头条真因

`videoPublishUrls.toutiao` 指向西瓜上传页，但 `PLATFORM_PUBLISH_SELECTORS.toutiao` 是图文文章页
且**无 `file_input`**（真机 `selectorCount=0`）。研究语料给出该平台 API 轨三端点
（`xigua/api/upload/getAuthKey/` → 上传 → `xigua/api/upload/PublishVideo`）。

## 三、本轮改动

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 配置 | `config/platforms.yaml` | 视频号 `publish_url` → `https://channels.weixin.qq.com/platform/post/create`（附取证注释） |
| API 轨 | `packages/api-publish-engine/src/publish/platforms/shipinhao-video.js` | `CDN_HOST_CANDIDATES`：新主机 `finder.video.qq.com` 优先，旧主机保留兜底 |
| 取证 | `apps/desktop/electron/services/rpa-dom-dump.js`（新） | `MP_DOM_DUMP=1` 才采集；nav/uploaded/prepublish 三阶段结构摘要；只采结构不采内容；URL 去 query；异常返回 null |
| 接线 | `rpa-view-platforms.js` / `upload-waiter.js` | 导航后、上传后各采一次；内联门禁块收敛为 `assertReady` 调用 |
| 门禁 | `publish-precondition.js` | 新增 `assertReady()`（取证 + 判定 + 结果形状） |

## 四、TDD

| 文件 | 用例 | 锁的是什么 |
| --- | --- | --- |
| `rpa-dom-dump.test.js`（新） | **10 例** | 默认关闭**且不触碰页面**；只有 `"1"` 才开启；只采结构（无 `value` 字段）；URL 去 query；落盘目录固定；异常返回 null 不抛；采集脚本是单函数字面量 |
| 既有面 | 110 例 | `rpa-view-platforms` / `publish-precondition`(12) / wiring(3) / upload-order(5) 全绿 |
| API 轨 | **442 例** | `packages/api-publish-engine` 全量（含 `shipinhao-video-chain`） |

## 五、门禁读数

| 门禁 | 读数 |
| --- | --- |
| `apps/desktop` 受影响面 | **110 passed**（5 文件） |
| `packages/api-publish-engine` 全量 | **442 passed**（42 文件） |
| `.github/scripts/check-max-lines.js` | **rc=0**（`无新增超大文件，挂账清单与现实一致`） |
| `check-text-encoding-integrity.js` | **OK**（无新增编码损坏） |
| `check-no-brand-residue.js` | **PASS**（10137 tracked 文件） |
| QM-1 `pnpm run build:vue` | **rc=0**（`✓ built in 2m 5s`） |
| QM-1 `electron-builder --win --dir` | **rc=0**（`packaging platform=win32 arch=x64 electron=43.7.7`） |
| QM-1 启动验证 | **PASS**：alive(8s)=true / stderr **0 字节** / stdout 7,284 字节 / 三层判据全过 |
| 启动验证的 profile | 一次性临时目录（主 userData 被另一实例独占锁，SingleInstanceLock 会让重复实例立即退出；只验启动健康度，不验账号） |

## 六、未闭合

1. **抖音**：需补齐 SDK 签名 cookie（重新授权会让安全 SDK 写入；或改采集时机）。
2. **今日头条**：视频 API 轨待实现（三端点已定位）；DOM 轨缺视频页选择器。
3. **小红书**：视频草稿需 API 链视频模态 + `ROUTE_TABLE` 放开 API。
4. **真机 E2E 阻断（如实记录）**：应用正由另一 worktree（`mp-app-live2`）运行，`--user-data-dir`
   指向同一 `shared-user-data`，其 cookie 库被独占锁（`EBUSY`），外部脚本无法复制 cookie 做取证；
   本轮改由**应用内** `MP_DOM_DUMP=1` 通道采集，等待该实例空闲后执行。

## 七、远程同步

| 远程同步 | 由门禁推导（合并后按主干历史收口；不手写状态词） |
