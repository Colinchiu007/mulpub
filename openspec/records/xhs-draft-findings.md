# 本次执行记录：小红书视频「草稿」真实通路取证（xhs-draft-findings，2026-10-19）【docs-only】

- 分支：`xhs-draft-findings`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（仅 `01-docs/` + `openspec/records/`）
- 性质：**只记录真机取证结论**，不含代码变更。实现落在后续 PR。

## 一、结论先行：小红书「发布到草稿箱」拿到了真实成功

真机在 `rpa-xiaohongshu-a1eac276` 分区上跑通「上传视频 → 暂存离开 → 草稿箱(+1)」：

| 取证点 | 值 |
| --- | --- |
| 操作前草稿箱 | 无计数（`null`） |
| 操作后草稿箱 | **`草稿箱(1)`** |
| 面板 | 「视频笔记(1) 图文笔记(0) 长文笔记(0) 播客笔记(0)」 |
| 草稿条目 | 「自动化草稿自检 591519」/「保存于 2026-10-19 04:16:34」/ 时长 3:11 / 缩略图 / 编辑·删除 |
| 平台原文警告 | 「草稿存储于当前使用的浏览器本地，在清除浏览器数据时会被删除；视频笔记最多支持保存100篇草稿，超出后将默认删除最后一篇草稿，请及时发布。」 |

截图证据：`xhs-draft-ok-*/03-after-click.png`（草稿箱面板 + 条目）。

## 二、三条产品级影响（改变此前的路线判断）

### 2.1 小红书草稿**不是服务端资源**，API 轨永远做不出来

平台原文已经把答案写在脸上：「草稿存储于**当前使用的浏览器本地**」。
因此 `web_api/sns/v2/note`（此前实测恒 **406**）就算打通，**也不会产生草稿** ——
那条路的努力方向本身是错的。**小红书只能走 RPA/DOM 轨。**

> 这同时解释了 `packages/api-publish-engine/src/publish/platforms/xiaohongshu-draft.js` 为什么一直「不通」：
> 不是签名/风控问题，而是它想创建的「草稿」在服务端并不存在。

### 2.2 必须在**用户自己的浏览器 profile** 上操作

草稿落在该 profile 的本地存储里。首次验证时我把分区**拷贝**到临时目录再操作，
草稿箱计数确实变成 1，但那份 profile 是副本 ⇒ 用户的草稿箱里看不到。
⇒ 实现必须直接用应用的 RPA 分区 profile。

### 2.3 上限 100 篇，超额**静默**删掉一篇

平台原文：「视频笔记最多支持保存 100 篇草稿，超出后将默认删除最后一篇草稿」。
⇒ 必须有「发布后清理草稿」或「提交前查重」策略，否则会**无声丢草稿**（用户收不到任何提示）。

## 三、会话与上传链路的取证

### 3.1 登录态判据（19 个 cookie，且**没有** `web_session`）

```
galaxy_creator_session_id                 ✅
access-token-creator.xiaohongshu.com      ✅
customerClientId                          ✅
web_session                               ❌ 无
```

`creator.xiaohongshu.com/api/galaxy/user/info`、`/creator/datacenter/account/base`、
`/creator/home/personal_info` 均 200 ⇒ 登录态有效。
再次印证：creator 域靠 `galaxy_creator_session_id` 即可，`web_session` 缺失正是服务端 note 接口 406 的原因，
但对 DOM 轨无影响。

### 3.2 上传链路（全 200，59 MB / 20 分片约 50 s）

```
GET  /api/media/v1/upload/creator/permit?biz_name=spectrum&scene=image&file_count=1&version=1
PUT  ros-upload.xiaohongshu.com/spectrum/<key>?partNumber=N&uploadId=<id>     （多分片，并发）
POST ros-upload.xiaohongshu.com/spectrum/<key>?uploadId=<id>                  （complete）
```

### 3.3 cookie 提取：**必须连 `Local State` 一起拷**

| 做法 | 结果 |
| --- | --- |
| 拷 `Partitions/<p>/Network/Cookies` → 临时 profile 的 `Default/Network/Cookies`，**同时**拷 `shared-user-data/Local State` | ✅ 成功：Chromium 用同一 Windows 用户 DPAPI 自解密 |
| 直接 `launchPersistentContext('<...>/Partitions/<p>')` | ❌ 失败：分区目录**没有 `Local State`**（DPAPI 的 `encrypted_key` 在那里面）⇒ cookie 解不开 ⇒ 跳登录、`input[type=file]` 数量为 0，**看起来像「未登录」但其实是解密失败** |

要直接用真实分区，得按应用自身做法：`--user-data-dir=<shared-user-data>` + `--profile-directory=session`，
且此刻应用在跑会独占 `session/Network/Cookies`，需先关应用。

## 四、页面结构与操作要点（这是 DOM 轨的实现依据）

| 事实 | 细节 |
| --- | --- |
| 空发布页只有 2 个 button | `chat-fab`、「上传视频」 |
| 「暂存离开」「发布」**在上传完成后才渲染** | 空页扫不到，别误判为「无草稿入口」 |
| footer 为 fixed 定高（1600×1000 视口） | 「暂存离开」约 `(683, 955)`；「发布」约 `(821, 955)` |
| `body.innerText` 含「暂存」但元素扫不到 | `document.querySelectorAll('*')` 与 `getByText('暂存离开')` 均 count=0 ⇒ **坐标点击是当前最稳的**；配截图核对 |
| 上传完成判据 | 进度百分比**与**「取消上传」同时消失 |
| 正文区 | `div[contenteditable="true"]`；标题 `input[placeholder*="标题"]` |
| 编辑区会自动插入话题标签 | 填空后出现 `#标识设计` 等，属平台行为，不必处理 |

> ⚠️ 如实记录方法论警示：本轮为了找到「暂存离开」试了 4 版脚本（DOM 扫描 / Playwright 文本定位 / 滚底等待 / 坐标），
> 前 3 版全部失败。**这正是用户批评过的「DOM 又复杂又有风控风险」的现场证据**——
> 小红书没有可用 API 轨，只能忍耐这个成本；其它平台不应照抄这条路径。

## 五、未闭合（不假装）

1. **草稿落在用户分区**这一步尚未复验：当前成功是在**拷贝出的** profile 上完成的。
   下一步需在应用关闭状态下用 `--user-data-dir=shared-user-data --profile-directory=session` 复验。
2. 100 篇上限的**清理/去重策略**未实现。
3. 坐标点击需替换为更稳的定位，并补断言「草稿箱计数 +1」；
   当前坐标是从 1600×1000 截图量的，**换分辨率/缩放会失效**，必须改为「截图定位」或「按 footer 相对定位」。
4. 「暂存离开」是否等同于「保存草稿」在语义上已由草稿箱 +1 证实，但**草稿内容完整性**（标题/正文/封面是否都存住）
   尚未逐项核对。

## 六、远程同步

| 远程同步 | 由门禁推导 |
