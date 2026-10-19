# 本次执行记录：头条封面改用平台推荐封面（toutiao-poster-cover，2026-10-19）【混合 PR】

- 分支：`toutiao-poster-cover`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：PR #3948（头条发稿体按 bundle 取证订正，已合并 `b14d69fd72`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §12.5（本轮新增）

## 一、为什么有这一轮

R3（PR #3948）把头条发稿体按 bundle 订正了，但留下一个**死锁**：

```
闸门 5「封面必填」放在上传前 ⇒ 没封面不许上传
可封面（推荐封面）要 vid 才能生成 ⇒ 上传后才有
∴ 走不通
```

本轮回到 bundle 找答案，发现是我把语义理解错了。

## 二、证据（应用 bundle，逐字）

```js
// 端点
(0,u.t9)("/ixigua/api/upload/GetPosterList/", { body: { vid } })   // → data.Posters

// 同一段代码里的平台原文 UI 文案（决定性）
「视频上传完毕后才能生成推荐封面，你可上传或自定义截取封面」
```

两条结论：

1. **推荐封面依赖 `vid`** ⇒ 只能在上传之后取，闸门必须放在上传后（死锁由此解开）。
2. **不需要我方上传封面图片** ⇒ 从 `Posters` 里选一张即可。

顺带又读到一条判据：`VideoType` 来源于 `aspectRatio`（`Tt = U < 1 ? 6 : 3`），
而 `aspectRatio` 本身也是 body 字段（`Z = VideoWidth < VideoHeight ? .62 : 1.78`）。

## 三、代码改动

| 文件 | 改动 |
| --- | --- |
| `publish/platforms/toutiao-video-publish.js`（231 行） | 新增 `POSTER_LIST_PATH`、`ASPECT_RATIO`、`parsePosterListResponse`、`pickPosterUri`（候选键探测）；body 增加 `aspectRatio` |
| `publish/platforms/toutiao-video-probes.js`（新，94 行） | **只读探测**独立成模块：`probePublishAuth`（发布权限/审核延迟）、`fetchPosterList`（推荐封面）。拆分依据是「有无副作用」，不是行数 |
| `publish/platforms/toutiao-video.js`（489 行） | 新增 `getPosterList()`；`checkPublishAuth()` 委托探测模块；`run()` 把封面闸门挪到**上传后**并按「有无可用 URI」触发推荐封面回落；返回值新增 `cover: {source, pickedKey, posterCount}` 便于真机排障 |
| `test/toutiao-video-chain.test.js` | 23 → **31 例**：新增推荐封面自动选用（含 `Url` 候选键命中）、无推荐封面时 fail-closed 且**不发 PublishVideo**、`parsePosterListResponse`/`pickPosterUri` 边界（空数组/null/空串）、e2e 顺序不变量加入 poster 步骤 |

### 关键判据修正（自扮演裁决抓到）

第一版我用「调用方有没有封面字段」（`hasCallerCover`）触发回落 —— **判据用错**：

- `coverPath` 是**本地文件路径**，body 需要的是**平台侧 URI**；
- 只给 `coverPath` 时 `hasCallerCover=true` ⇒ 回落被跳过 ⇒ `thumbUri` 仍为空 ⇒ 必然失败。

改成按「有没有可用 **URI**」（`hasUsableCoverUri`）触发，并在错误文案里**区分**两种情况：
「只给了本地封面文件（封面上传尚未实现）」vs「完全没给封面」。

## 四、显示项 / 提示文字

| 场景 | 提示 |
| --- | --- |
| 自动选中推荐封面 | 进度 85% `已自动选用平台推荐封面` |
| 只给本地封面文件且平台无推荐封面 | `…调用方只提供了本地封面文件（cover/coverPath），但头条封面上传尚未实现 —— 请改传平台侧 thumbUri，或依赖平台推荐封面…` |
| 完全没给封面且平台无推荐封面 | `…调用方未提供 cover/thumbUri…` |
| 推荐封面接口异常 | warn `toutiao-video: GetPosterList 不可用，回落失败: <原因>` |
| 命中候选键 | info `toutiao-video: 推荐封面命中字段 <Key>` |

## 五、取值来源（数据校验）

| 字段 | 来源 | 校验 |
| --- | --- | --- |
| `VideoInfo.ThumbUri` | 调用方 `thumbUri` / `cover.uri`，否则推荐封面 | 空则 fail-closed，不发 PublishVideo |
| `Posters[].*` | `GetPosterList` 响应 `data.Posters` | 非数组退化为 `[]`；项非对象跳过；空串跳过 |
| `aspectRatio` | 宽高比较 | 均为 0/缺失 ⇒ 横版 `1.78` |
| `VideoType` | `aspectRatio < 1 ? 6 : 3` | 与 bundle 同式 |

## 六、测试读数

| 套件 | 读数 |
| --- | --- |
| `test/toutiao-video-chain.test.js` | **23 → 31 passed** |
| `test/toutiao-adapter-routing.test.js` | 8 passed |
| `packages/api-publish-engine` 全量 | **rc=0**（44 vitest 文件 + 全部直跑用例） |
| 文件行数 | `toutiao-video` **489** / `toutiao-video-publish` 231 / `toutiao-video-probes` 94（均 < 500） |

## 七、质量节拍读数

| 门禁 | 读数 |
| --- | --- |
| `check-max-lines.js` | **✅**（489 / 231 / 94，均 < 500） |
| `check-unwired-tests.js` | **OK** |
| 编码 / 品牌 / 绝对路径 / 记录债务 | **OK / PASS / PASS / OK**（10,376 / 4,166 文件） |
| 平台自检 toutiao | **13 条判据全 PASS** |
| QM-1 `build:vue` | **rc=0**（27s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：alive(8s)=true / stderr **0 字节** / stdout 20,701 字节 |

## 八、还没做完（不假装）

1. **`Posters[]` 每项字段名仍未取证**（只拿到 `.Posters` 这一层）⇒ 候选键探测 + 回传命中键，
   第一次真机跑通后应收敛为确定实现。这是本 PR 唯一的"带未知的代码"。
2. **头条真机发布仍被账号实名认证挡住**（`is_auth:false` / `media_status:4`），外部前置条件。
3. 本地视频探元数据（宽高/时长）仍未接进链 ⇒ `aspectRatio` 默认横版。
4. 头条封面上传（imagex）**未实现**，本轮证明也**不需要** —— 推荐封面即可；但若业务要求自定义封面，
   仍需补齐上传链路。

## 九、远程同步

| 远程同步 | 由门禁推导 |
