# 本次执行记录：西瓜上传页入口疑云（xigua-studio-entry，2026-10-21）【混合 PR】

- 分支：`xigua-studio-entry`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动因（按用户新指示复查）

用户指示：「跟自媒体账号和发布相关功能的实现方法，**首选去复用两个竞品的逆向成果**，不用费时间自己研究」。

本轮修完 `toutiao-bridge-content-type`（漏传 article）后，按该指示复查头条视频上传入口，**发现一处未验证的差异**。

## 二、竞品逆向成果的实际入口

`04-rea-evidence/<参考产品>-主进程清点.json` 的 URL 清点：

| 用途 | 竞品 URL | count |
| --- | --- | --- |
| **上传页** | `https://studio.ixigua.com/upload?from=post_article` | **6** |
| 上传页（带 gid） | `https://studio.ixigua.com/upload?gid=` | 2 |
| 创建条目 | `https://studio.ixigua.com/api/upload/CreateItem/?_signature=_` | 2 |
| 上传授权 | `https://studio.ixigua.com/api/upload/getAuthKey/?params=%7B%22type%22:%22` | 1 |
| 话题建议 | `https://studio.ixigua.com/ugc/publish/post/v1/suggest/?words=` | 1 |
| 内容列表 | `https://studio.ixigua.com/api/content/list` | 1 |
| VOD | `https://vas-lf-x.ixigua.com/video/openapi/v1/` | 1 |

`studio.ixigua.com` 该 host **count=41**（远比 `mp.toutiao.com` 的 xigua 路径热）
⇒ 竞品实际主战场是 `studio.ixigua.com`（西瓜创作平台）。

## 三、我们当前登记的入口

`packages/api-publish-engine/src/platform-entries.js` L12：
```js
toutiao: "https://mp.toutiao.com/profile_v4/xigua/upload-video"
```

⇒ **与竞品不同域**。哪一个对？**未验证**。

## 四、验证尝试与结论边界

用头条分区 cookie 在应用外探测两个 URL：

| URL | 落地 | file input |
| --- | --- | --- |
| `mp.toutiao.com/profile_v4/xigua/upload-video` | → `mp.toutiao.com/login/?redirect_url=...` | 0 |
| `studio.ixigua.com/upload?from=post_article` | → **`creator.douyin.com/`** | 0 |

⇒ 两者都落登录页 ⇒ **应用外无法验证**（分区凭据读不出，见 §16.21）。

⚠ 但第二个结果本身是线索：`studio.ixigua.com` 跳到 **`creator.douyin.com`**
⇒ 西瓜创作平台可能已并入抖音创作者中心（字节产品整合）。若如此，
我们登记的 URL 与 `toutiao_video` 选择器**都可能过期**。

## 五、待办（需应用内已登录态验证）

1. 应用内分别打开两个 URL，看哪个落在真实上传页（有 `input[type=file]`）；
2. 若竞品 `studio.ixigua.com/upload` 是对的 ⇒ 更新 `platform-entries.js`，
   并按竞品成果核对 `CreateItem` / `getAuthKey`（**优先复用，不自己研究**）；
3. 重新真机取证该页 DOM 选择器（现有 `toutiao_video` 是 10-18 对 `mp.toutiao.com` 取的）。

## 六、流程落实（round 56 教训）

本轮**先跑完 5 个门禁确认 rc 全 0，再 commit/push**（上一轮是 FAIL 后才修）。
过程中 `check-no-brand-residue` 一度 FAIL（我在 PRD 里写了竞品真实文件名），
已按仓库纪律改成 `<参考产品>-主进程清点.json` 后转 PASS。

## 七、读数

| 项 | 读数 |
| --- | --- |
| abs-paths / brand / encoding / max-lines / unwired | rc=0 / rc=0 / rc=0 / rc=0 / rc=0 |
| 代码改动 | **无**（纯 PRD 追加 §16.24） |
| 真机探测 | 两 URL 均落登录页（应用外不可验证） |

## 八、远程同步

| 远程同步 | 由门禁推导 |
