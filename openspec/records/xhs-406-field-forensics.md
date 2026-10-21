# 本次执行记录：小红书 406 字段级取证（xhs-406-field-forensics，2026-10-21）【混合 PR】

- 分支：`xhs-406-field-forensics`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动机

§16.11/§16.12/§16.15 已排除「缺请求头」「缺 /api 前缀」「sign-URI 形态」三条假设，
结论是「406 = 服务端对 `note` 端点请求体字段/格式的拒绝」。本轮做**字段级对照取证**，
并按用户指示**先查竞品逆向成果**。

## 二、竞品逆向成果（先查）

| 来源 | 内容 |
| --- | --- |
| `05-<参考产品>-materials/RPA分析报告.md` §2.4 | 只有**上传**（腾讯云 COS 分片 + `x-cos-security-token`）、数据分析、内容删除 —— **没有发布/草稿 API 路径** |
| `04-rea-evidence/<参考产品>-主进程清点.json` | `edith.xiaohongshu.com/web_api/sns/v2/note` **4**、`publish/publish` **4**、`api/media/v1/upload/web/permit` **2**、`api/galaxy/user/info` **1** |

⇒ 发布链 = **permit → 上传 → `web_api/sns/v2/note`**。

## 三、我们的实现已与竞品同款（不是端点错）

`xiaohongshu-draft.js` 的链：`POST permit` → `ros-upload` 分片 → `POST edith .../web_api/sns/v2/note`（draft=true）。
与竞品清点**完全一致** ⇒ 406 不是端点/链路选型问题。

## 四、线上 bundle 取证（公开可下，无需登录）

主 bundle：`fe-static.xhscdn.com/formula-static/ugc/public/resource/js/project-publish-vue.<hash>.js`（2.25MB）

**① 端点常量**
```js
POST_NOTE: "/web_api/sns/v2/note"
USER_INFO: "/api/galaxy/user/my-info"
```

**② 该端点登记在「必须签名」清单**
```js
"creator-platform": { signIncludesUrl: [
  { pattern: "web_api/sns/v5/creator/topic/template/list", mode: "endsWith" },
  { pattern: "web_api/sns/v2/note", mode: "endsWith" } ] }
```
⇒ 与我们的 signer 一致（§16.15 已验证「签名有效、得 406 而非 401」）。

**③ 笔记模型字段族（前端 store 真实键名）**
```
title  type  desc  ats  hash_tag  cover  video_info  metadata
post_loc  post_locs  scheduled_post_time  post_timing  order_cooperate
privacy  images_list  biz_relations  label_map
```
要点：用 `type` 不是 `note_type`；用 `desc` 不是 `content`；用 `images_list`/`video_info` 不是 `images`/`video`；
`hash_tag` 是独立字段（话题不内联在 desc）。

## 五、一处已确认的路径偏差（与本 406 无关，但应修）

| 位置 | 我们 | 线上 bundle |
| --- | --- | --- |
| 用户信息 | `/api/galaxy/user/info` | **`/api/galaxy/user/my-info`** |

不影响 note 提交（不同端点），但影响「登录态/用户信息」探测准确性，应单独核实。

## 六、结论（按证据强度分层）

| 结论 | 强度 |
| --- | --- |
| 发布链与端点选型正确 | **实测**（竞品清点 + 线上 bundle 常量） |
| `note` 在必须签名清单内且我们已签 | **实测**（bundle `signIncludesUrl`） |
| payload 字段族应为 `type/desc/hash_tag/images_list/video_info/...` | **实测**（bundle store 键名）；**是否全部必填未知** |
| 406 的具体缺项 | **未证实** —— 仍需抓一次真实请求做逐字段 diff |

## 七、下一步

用 §16.32.1 的「发布窗口实时采样」同法：应用内打开小红书创作页，驱动页面点**存草稿**，
用 CDP `Network` 域捕获该次真实 `POST /web_api/sns/v2/note` 的**请求体与请求头**，逐字段 diff。
（顺带：若页面侧存草稿成功，则草稿目标已达成 —— 两条收益一次取证。）

## 八、读数

| 项 | 读数 |
| --- | --- |
| 5 个静态门禁 | rc 全 0 |
| 代码改动 | **无**（纯 PRD §16.33） |
| 取证方式 | 公开静态资源，零副作用（未登录、未发布） |

## 九、远程同步

| 远程同步 | 由门禁推导 |
