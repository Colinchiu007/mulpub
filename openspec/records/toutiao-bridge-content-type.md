# 本次执行记录：头条桥按内容类型取选择器（toutiao-bridge-content-type，2026-10-21）【混合 PR】

- 分支：`toutiao-bridge-content-type`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 packages/ 运行时代码）
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动因（真机实证，2026-10-21）

用户新添加**已认证**头条号 `45261bb5` 并授权测试视频发布。结果被 fail-closed 拒绝：

```
error: 今日头条 视频发布尚未支持：头条视频走西瓜视频上传页，但本仓尚未登记该页的上传入口选择器
       （图文链路不受影响）。本次未向平台提交任何内容，也未占用发布间隔。
submitAttempted: false
```

⇒ 门禁工作正常（未提交、未占间隔），但**结论是错的**：选择器其实早已登记。

## 二、定位过程（三层排查，非猜测）

| 步 | 动作 | 结论 |
| --- | --- | --- |
| ① | 读 `platform-selectors.js` | `toutiao_video` **已登记**（2026-10-18 真机取证，file_input/title_input/desc/publish_btn 齐全） |
| ② | Node 复现 `resolvePublishSelectors` | 合并逻辑**正确**：传 `article.video_path` ⇒ `file_input` 有 3 个候选；不传 ⇒ `undefined` |
| ③ | 追头条实际发布路径 | 头条走**专用链** `_publish_toutiao` → `toutiao-direct-bridge.publishToutiao()`，**不经** `_publish_generic` 的选择器体系 |

**根因**（`toutiao-direct-bridge.js`）：
```js
const config = host._getPlatformConfig('toutiao')   // ← 漏传 article
const contentType = article.video_path ? 'video' : 'image'  // ← 这里却用了 article
```
⇒ `_getPlatformConfig` 内部 `resolvePublishSelectors({platform:'toutiao', article: undefined})`
⇒ `wantsVideo=false` ⇒ 返回**图文**选择器（无 `file_input`）⇒ 门禁误判"未实现"。

（旁证：`_publish_generic` L206 的诊断日志会打 `hasVideo=false`，正是 article 没传进去所致。）

## 三、修法（一行 + 注释）

```js
const config = host._getPlatformConfig('toutiao', article)
```

## 四、竞品逆向成果核查（按用户指示优先复用）

查 `D:\Data\reverse-two-competitors\01-analysis\`：
- `mtm-platform-apis.md` 有西瓜上传页的**完整 API 链**（`xigua/api/upload/getAuthKey`、
  `xigua/api/upload/PublishVideo`、`profile_v4/xigua/content-manage-v2`、`vas-lf-x.ixigua.com` VOD）
  —— 与我们的 `toutiao-video.js` API 轨同源，**API 轨无需重做**；
- 但竞品成果里**没有**上传页 DOM 选择器结构（其重点是 API 清单）。
- ⇒ DOM 选择器用我们自己 2026-10-18 的真机取证（更贴合当前页面），**未重复研究**。

## 五、TDD

`packages/rpa-engine/tests/toutiao-bridge-content-type.test.js`（3 例）：
- ① 取平台配置必须传 article —— **先 RED**（精确暴露缺陷），修后 GREEN
- ② contentType 仍按 video_path 判（不被破坏）
- ③ 传给 `_publish_generic` 的 article 含 video_path

## 六、读数

| 项 | 读数 |
| --- | --- |
| `rpa-engine` 全量 | **9 文件 285 passed** |
| 新增测试 | 3 passed（RED → GREEN） |
| max-lines / unwired / abs-paths / 品牌 / 编码 | ✅ / OK / PASS / PASS / OK |
| **QM-1**（改 `packages/rpa-engine/`） | build:vue 1m7s + electron-builder ✅ + 启动 **PASS（stderr 0 字节）** |

## 七、未闭合
- 修复**尚未在真机验证**（应用 `mp-app-live2` 跑的是旧代码，需重启到含本修复的版本）；
- 修复后仍需真机取证西瓜上传页的实际上传完成信号（`toutiao_video` 选择器是 10-18 取的，页面可能已改版）。

## 八、远程同步

| 远程同步 | 由门禁推导 |
