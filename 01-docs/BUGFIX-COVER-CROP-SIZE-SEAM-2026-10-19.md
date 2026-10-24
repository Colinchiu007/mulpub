# BUGFIX：封面裁剪自 #1174 起从未可用（cover:crop 恒返回「图片尺寸无效」）

日期：2026-10-19 ｜ 分支：`cover-crop-license-bugs` ｜ 引入点：`f9d1343bd`（PR #1174，2026-08-27，"封面裁剪 Phase A"——原提交主题含参考产品名，按 Gate 12 口径此处只写中性称谓，取证一律以 commit SHA 与 PR 号为准）
存续 **53 天**。归因取证：`git log --diff-filter=A -- apps/desktop/electron/services/cover-cropper.js` 只有一条 `f9d1343bd`；
`git log -S'width: size.width' -- 同一文件` **零命中** ⇒ 该函数**从来没有**返回过宽高，这不是回归（regression），是**原发缺陷**。

---

## 1. 第 1 步：第一性原因

`cropImageFile()` 的数据流是这样接的：

```js
const read = readImageAsDataUrl(imagePath)          // ① 读字节 + base64 dataURL
const n = normalizeRect(rect, read.width, read.height)  // ② 把裁剪框夹进图片边界
```

而 `readImageAsDataUrl()` 的成功分支原样是：

```js
return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), sizeBytes: buf.length }
```

**没有 `width`、没有 `height`**。于是 ② 拿到的是 `undefined, undefined`，
经 `const iw = Number(imageWidth) || 0` 归一为 `0`，命中 `if (iw <= 0 || ih <= 0) return { ok:false, error:'图片尺寸无效' }`。

用户侧症状：拖拽裁剪框点「确认」，弹窗里只出现一句**「图片尺寸无效」**，
而它描述的不是用户的图片，是**我们的解析器没把尺寸交出去**。

同一条链上还有**第二处独立缺陷**，被第一处挡在下游、因此从未显形：

```js
const encode = (q) => win.webContents.executeJavaScript('window.__encode(' + q + ')').then(...)  // 返回 Promise
const picked = pickJpegQuality(encode, maxBytes)   // 同步函数，把 Promise 当 Buffer
```

`promise.length` 是 `undefined` ⇒ `undefined <= maxBytes` 恒为 `false` ⇒ 二分一路退到最低质量，
最后 `fs.writeFileSync(outputPath, picked.buffer)` 收到一个 Promise 而抛 `ERR_INVALID_ARG_TYPE`。
**只修第一处会把用户从「图片尺寸无效」推到「一个没人读过的 TypeError」**，所以两处同批修。

---

## 2. 第 2 步：测试逃逸链

| 层 | 现状 | 为什么没拦住 |
| --- | --- | --- |
| 单元 | `cover-cropper.test.js` 有 `normalizeRect` 用例，宽高是**测试自己传的 1920/1080** | 纯函数被当独立单元测，「谁生产 width、谁消费 width」这条**缝**没有任何用例穿过 |
| 单元 | `cropImageFile` 只测了「文件不存在」这条早退分支 | 真实文件的分支从未执行到 `normalizeRect` |
| 单元 | `pickJpegQuality` 三条用例的 `fakeEncode` 都返回 **Buffer** | 同步夹具对「真实消费者给的是 Promise」结构性免疫 |
| 集成/IPC | 无 `cover:crop` 的端到端用例 | — |
| 视觉 | 裁剪弹窗只在成功后改预览 | 失败路径没有可断言的画面变化 |
| 审查 | 代码形状完全正确（字段名同名、调用签名对得上） | 「注册≠注入≠生效」家族：人眼看不出两个单元各自正确而接缝为空 |

一句话：**`{dataUrl,sizeBytes}` 与 `read.width` 是同名不同源的巧合正确**——写 ① 的人没读过 ②。

---

## 3. 第 3 步：系统性漏洞定位

**测试场景缺失 + 夹具类型与真实类型不同形**（不是断言写错，是断言的对象根本不是生产数据流）。
落点：`apps/desktop/electron/services/cover-cropper.test.js` 缺三类锁 ——
① 接缝数据锁（真实文件 ⇒ 尺寸真的能流进 `normalizeRect`）；② 编码器返回 Promise 的行为锁；
③ 测试 realm 覆盖不到的调用点接线守卫。

---

## 4. 第 4 步：修复内容与完整契约

### 4.1 数据校验（新增/变更的判据）

新增零依赖纯模块 **`packages/shared-utils/src/image-size.js`**：

| 函数 | 输入 | 输出 | 失败语义 |
| --- | --- | --- | --- |
| `readImageSize(buffer)` | Buffer（非 Buffer / 空 / 结构断裂 / 尺寸为 0） | `{width,height}` 或 **`null`** | **不猜、不给 0** |
| `describeImageSizeError(buffer)` | 同上 | `'OK' \| 'EMPTY' \| 'TOO_SHORT' \| 'UNRECOGNIZED'` | 三分必须可区分 |

为什么不用 `sharp`：它**不在** `apps/desktop/package.json` 的 `dependencies` 里（只在
`.cover-rasterize-worker.js` 以传递依赖被用），为几个字节的头加一条生产依赖边，代价是打包体积与
「生产依赖闭包」门禁的连锁。支持格式与 `image-mime.js` 的登记表**逐项一致**（jpg/jpeg、png、webp；
GIF 不在登记表内故不实现——新增格式时必须同时改两处，判据在测试里点名）。

三条不显然的解析口径（都有实现级理由）：

1. **JPEG 必须按段结构走，绝不"扫第一个 SOF"**。EXIF（APP1）里可以塞缩略图，缩略图自己就带 SOF0，
   而且它出现在主图 SOF **之前**。朴素扫描会把 160×120 的缩略图当主图 ⇒ 裁剪框被一个不存在的边界夹住，
   结果是**静默裁错**而不是报错。实现读段长度并**整段跳过 APPn**。
2. **WebP 的 `VP8X`（画布尺寸）优先于后续帧**（`VP8 `/`VP8L` 是单帧尺寸）。归一化裁剪框要的是画布。
3. **解析失败返回 `null` 而不是 `{width:0}`**。`0` 会被上游 `Number(x)||0` 的判据读成「尺寸无效」，
   等于把"我的解析器不认识这种文件"伪装成"用户的图片坏了"——**这正是原 Bug 的形状**。

### 4.2 流程（修复后的完整链）

```
渲染层拖框 → coverVideoCover(payload) → IPC cover:crop
  → withSenderCheck → payload 校验（缺对象 / imagePath 非空串 / rect 为对象）
  → cropImageFile(imagePath, {rect,maxBytes,outputWidth})
      1 文件存在性
      2 ext → mime（未知格式拒绝，不猜）
      3 读字节 → readImageSize → 失败即「无法解析图片尺寸（原因）」
      4 normalizeRect（夹进图片真实边界；rect 字段必须有限数、宽高为正）
      5 computeTargetSize（outputWidth 等比缩放、**不放大**；未给用 rect 原尺寸）
      6 offscreen BrowserWindow + canvas drawImage → toDataURL('image/jpeg', q)
      7 await pickJpegQuality(async 编码器, maxBytes)   ← 本次改为 await
      8 写 os.tmpdir()/multi-publish-crop/crop-<md5>.jpg（键含路径+rect+目标宽+maxBytes）
  → 成功 {code:0, data:{path,sizeBytes,width,height,overLimit}, message:'封面裁剪成功'}
  → 失败 {code:REQUEST_ERROR, message:<错误文案>}
```

### 4.3 交互逻辑与显示项

- 渲染层 `CoverCropDialog.vue` 的错误出口是 `emit('error', res?.message || t('publishPage.coverCrop.cropFailed'))`，
  主进程返回的 `message` 原样进入该通道 ⇒ **无需改渲染层**，新文案自动可见。
- `overLimit=true` 属"已尽力压缩但仍超上限"，由调用方决定是否接受（本次未改这层语义）。

### 4.4 提示文字（逐条，含新增与退役）

| 场景 | 文案 | 状态 |
| --- | --- | --- |
| 参数不是对象 | `缺少参数对象` | 既有 |
| imagePath 非法 | `imagePath 必须为非空字符串` | 既有 |
| rect 非法 | `rect 必须为对象` / `rect 字段必须为有限数字` / `rect 宽高必须为正数` | 既有 |
| 文件不存在 | `图片文件不存在: <路径尾部>` | 既有 |
| 扩展名不支持 | `不支持的图片格式: <ext>` | 既有 |
| **字节读不出尺寸** | **`无法解析图片尺寸（EMPTY｜TOO_SHORT｜UNRECOGNIZED，不是"图片坏了"而是"读不出尺寸"）`** | **新增** |
| 尺寸确实为 0（调用方传了坏值） | `图片尺寸无效` | **退役为不可达路径**（尺寸现由解析器产出，解析不出即在上面那行收口） |
| 兜底 | `封面裁剪失败` / 成功 `封面裁剪成功` | 既有 |

口径说明：这些字符串是**主进程中文字面量**，与本 handler 既有全部消息同形（该 handler 早于 i18n 收口，
文案不在 locales 内，AGENTS 的 CJK 基线扫描域是渲染端 `src/` 非 locales 文件，不覆盖 `electron/`）。
本次**不顺手**把它们搬进 locales——那会把"修一条死链"与"改整个 handler 的文案归属"混成一次变更。

---

## 5. 第 5 步：回归保护与反证

新增 `packages/shared-utils/src/__tests__/image-size.test.js`（**12 例**）：
真实文件三条（PNG 512×904、JPEG 1024×576 经 **System.Drawing 与 sharp 两把独立尺子**实测一致；
WebP 512×286 / 512×219 只有 sharp 一把，**单尺子在列不假装是双尺子**）+ 「两张不同尺寸的图必须给出不同读数」
（防"夹具对所有输入同形"）+ PNG 合成 + **EXIF 缩略图负控** + 无 SOF 返回 null + WebP 三种帧头 + 三分错误码。

`cover-cropper.test.js` 新增一节 **`readImageAsDataUrl ↔ normalizeRect 的接缝`**（4 例）与
`pickJpegQuality` 的 Promise 编码器锁 1 例：

- 真实 PNG ⇒ `width=512 / height=904`；
- 返回对象**键集**必须等于 `[dataUrl,height,ok,sizeBytes,width]`（只测"我调用过"不构成接缝锁）；
- `.png` 但字节不是图片 ⇒ 报 `无法解析图片尺寸` 且**不等于** `图片尺寸无效`；
- `cropImageFile` 走真实图片 ⇒ 不得再停在 `图片尺寸无效`（**适用范围**：本测试 realm 的 `electron` 是 test-setup
  替身，`new BrowserWindow()` 不是构造函数，所以这条只证明"尺寸这一关过了"，不证明"真的产出了裁剪字节"）；
- 接线守卫（读源码）：`normalizeRect(rect, read.width, read.height)`、`readImageSize(buf)`、
  `await pickJpegQuality(`、`const buf = await encodeFn(mid)` 四处必须在位——
  最后一条存在的理由正是"上一行的行为用例在本 realm 到不了"，测量域不覆盖的格由接线守卫兜。

**反证五条（驱动 `mw-mut-crop.cjs`，每条各自指名变红，跑后两文件 md5 逐字节还原）**：

| 变异 | 红集 |
| --- | --- |
| M1 `readImageAsDataUrl` 退回旧形状（不返回宽高） | cover-cropper.test.js |
| M2 `readImageSize` 恒返回 null | cover-cropper.test.js + image-size.test.js |
| M3 二分循环摘掉 `await encodeFn(mid)` | cover-cropper.test.js |
| M4 JPEG 退回"扫第一个 SOF" | image-size.test.js（红在 EXIF 负控） |
| M5 调用点摘掉 `await pickJpegQuality` | cover-cropper.test.js（红在接线守卫） |

驱动自身踩到三个坑，按本仓规矩记下来：① 被 `pnpm` 是 `.CMD` shim，`execFileSync` 不走 shell 会 ENOENT，
而 ENOENT 的 `e.status` 是 `undefined` ⇒ 会被读成「测试红了但一条 FAIL 都没解析到」；② vitest 在被捕获的
子进程里**仍然上色**，`FAIL\s+path` 必须**先剥 ANSI** 再解析；③ 正则写成 `\S*(...\.test\.js)` 时贪婪的 `\S*`
会把路径吞成只剩 `r.test.js` 的尾巴，于是"红的是哪个文件"这个问题永远答错——必须 `(\S+\.test\.js)` 一次吃满。
另有一条**夹具级**教训：JPEG 的段长度字段**含其自身 2 字节**，第一版夹具写成 payload 长度，
判据当场把自己的夹具判红——**夹具不合法时的"解析失败"读起来和"判据坏了"一模一样**。

### QM-1 打包证据（`node scripts/qm1-scheduled-publish-verify.cjs` 全通过）

产物 `dist-electron/win-unpacked/resources/app.asar`（150,267 KB）内：
`image-size.js` / `image-mime.js` / `cover-cropper.js` 三条 `IN_ASAR`；解包后的真实文件树里
cropper 的 `require(.../image-size)`、`width: size.width`、`await pickJpegQuality(`、
`const buf = await encodeFn(mid)` 四条均在位；**打包产物内** `readImageSize` 对三张真图给出 512×904 / 1024×576 / 512×286；
8 秒启动**进程存活且 stderr 长度=0**（三层判据的第 ③ 层）。asar 清单条目数 15061（规模下界断言在位，
防"解析退化成空集合 ⇒ 零缺失读成通过"）。

---

## 6. 预防措施（已落地项）

1. **接缝必须被数据穿过**：凡「A 产出对象、B 消费其中字段」的跨函数契约，必须有一条用例把 A 的真实返回值
   直接喂给 B（本文的 `read → normalizeRect`），并配一条**键集**断言。只测两端各自的纯函数，
   对"中间字段从来没被产出"这类缺陷结构性免疫。
2. **异步契约的两端类型必须同形**：给"同步纯函数"写夹具时，夹具的返回类型必须与**真实消费者**一致
   （真实是 Promise 就必须有一条 Promise 夹具）。
3. 新增图片格式时，`image-mime.js` 的 `FORMATS` 与 `image-size.js` 的解析分支**必须同时登记**，
   否则会出现「能生成 dataURL、读不出尺寸」这种新的静默失败。
4. 判据看字节要认「容器 vs 载荷」：JPEG 的 APPn、WebP 的 chunk 都必须**按长度整段跳过/前进**，
   任何"在原始字节里找标记"的实现都会在真实文件上给出貌似合理但错误的尺寸。
