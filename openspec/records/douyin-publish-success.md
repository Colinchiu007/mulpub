# 本次执行记录：抖音视频发布首次真实成功（douyin-publish-success，2026-10-21）【docs-only】

- 分支：`douyin-publish-success`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 PRD 文档；本仓 PRD 路径在白名单外）
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、发生了什么

用户重启应用（electron=5，CDP 9279 可用）后，用 `dy-publish-e2e.cjs` 发起抖音视频发布：

- 任务 `task_1_1792569782094` → **`status: "success"`**
- `result.mode: "dom"`、`submitAttempted: true`、`submittedAt: 1792569891100`
- **全程 109 秒**（此前两次：10 分钟 `publish timeout` / 20 分钟无终态）

## 二、证据链（三环，各自独立）

| # | 证据 | 说明 |
| --- | --- | --- |
| ① | 任务 `success` + `submittedAt` 非空 | 应用自身判定成功，且记录了真实提交时刻（失败样本该字段为 null） |
| ② | **排除** URL 导航判定 | `_waitForSuccessNavigation` 要求 URL 含 `success`/`publish/success`（`rpa-view-navigation-helpers.js`），而 `result.url` 是 `content/post/video` ⇒ 不是这条路径 |
| ③ | 发布页表单仍持着本次内容 | 重开发布页：上传区已消失（视频已上传）、正文本字匹配、描述计数 `170/1000` ⇒ 内容确实进入过发布流程 |

⇒ 由 ② 反推：只可能命中 `rpa-view-platforms.js:1050` —— 等到了 `aweme/create_v2`/`create`/`post` 的**真实网络响应**（`_waitForResponse` 监听 session 响应）。⇒ 服务端确认创建。

## 三、为什么内容管理页（作品 238）没看到它

内容管理页只有「作品 / 作品合集」两个 tab，**无草稿 tab**；列表最新是 2026-10-18。

**未解释，不做猜测**：可能私密/待审核/草稿态、列表有默认筛选、或发布落在另一入口。
**在拿到平台侧明确状态前，不宣称"草稿已生成"。**

## 四、未闭合（如实）

| 项 | 状态 |
| --- | --- |
| 应用侧发布成功 | ✅ 已证实（三环） |
| **平台侧产物 ID**（`aweme_id`） | ❌ **未取到** —— DOM 轨不返回服务端 ID |
| 平台侧状态（草稿/私密/已发布） | ❌ 未确认 |
| 分轨诊断 `track`/`apiTrackAttempted` | ❌ 未记录 ⇒ 应用跑的是**旧二进制**（#4155 已合并但进程早于它启动） |

## 五、下一步（有依据）

1. **重启应用**（加载含埋点的新二进制）后重跑一次 ⇒ `track` 会说明是哪条轨；
2. **补第四项埋点缺口**：让 DOM 轨成功时**带回服务端响应体**（含 `aweme_id`）——
   这是 §16.19.4 三项之外的缺口：**成功路径没有产物 ID 留档**。
   （本次 `mode:"dom"` 的成功之所以缺 ID，正是因为 L1050 只 `return {success:true}` 丢了 `resp`。）

## 六、读数

| 项 | 读数 |
| --- | --- |
| `check-doc-abs-paths` | PASS |
| `check-text-encoding-integrity` | OK |
| `check-no-brand-residue` | PASS |
| 真机 E2E | 任务 success，109 秒，三环证据齐 |

## 七、远程同步

| 远程同步 | 由门禁推导 |
