# 本次执行记录：头条视频真因定位（xigua-nologin-rootcause，2026-10-21）【混合 PR】

- 分支：`xigua-nologin-rootcause`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动机

§16.23 把头条视频失败归因为「缺西瓜上传页选择器」，§16.24 又疑「URL 域错了」。
两节都是**基于代码/竞品清单的推断**。本轮在应用内已登录态直接实测，拿到服务端答案。

## 二、实测（三个判据，逐层收窄）

| 步 | 动作 | 读数 |
| --- | --- | --- |
| ① | 打开 `mp.toutiao.com/profile_v4/xigua/upload-video` | URL 保持（**未被重定向到登录页** ⇒ 该域已登录）；文案「网络异常，请刷新重试~」；`fileInputs=0` |
| ② | 刷新 3 次 | **稳定复现**：仍无 fileInput / `input.xigua-input` / `textarea.byte-textarea` / `.action-footer-btn` |
| ③ | 直接打上传接口 `xigua/api/upload/getAuthKey/` | **HTTP 200 `{"status":-12,"message":"no login"}`** |
| ④ | 对照 `mp.toutiao.com` 另一接口 | `v2/user/info/` → 502（瞬时网关错误，另一条线索） |

## 三、真因

**该账号在西瓜上传接口上没有登录态**（`status:-12 no login`）。

⇒ 上传区渲染不出来（"网络异常"文案）⇒ 无 `file_input` ⇒ 被发布前置门禁 fail-closed 拒绝。
链路完整闭合，每一环都有实测读数。

## 四、前两节归因的修正（如实）

| 猜测 | 实测结论 |
| --- | --- |
| §16.23「缺选择器」 | ❌ 选择器早已登记；#4170 修了漏传 article 后仍失败 |
| §16.24「URL 域错了该用 studio.ixigua.com」 | ❌ `mp.toutiao.com` 域**已登录**（200、无重定向）；`studio.ixigua.com` 反而跳 `/welcome`（未登录） |
| **「西瓜上传接口未登录」** | ✅ **服务端 `status:-12 no login`**，且解释了"网络异常"文案 |

## 五、机制

`mp.toutiao.com`（头条号后台）与 `xigua/api/upload/*`（西瓜视频上传）是**两套登录态**——
前者走头条号 session，后者需西瓜/中视频额外授权（竞品成果里 `studio.ixigua.com`
是独立域名独立登录，正与此吻合）。

⇒ 与 §16.21 同型教训：**"页面能打开" ≠ "接口已授权"**。

## 六、剩余工作（重排优先级）

| # | 事项 | 性质 |
| --- | --- | --- |
| 1 | 应用内打开西瓜上传页完成授权/登录 | **用户动作** |
| 2 | #4170「传 article」修复 | 仍必要，但**不是**真因 |
| 3 | 授权后重跑，用真实 `ItemId` 留档 | 验证 |

⇒ 阻塞点从"代码"移回"账号授权"，但**这次有服务端明确判据**，不再是猜测。

## 七、读数

| 项 | 读数 |
| --- | --- |
| 上传页 HTML | 200 / 59699 字节 |
| `getAuthKey` | 200 / `{"status":-12,"message":"no login"}` |
| `v2/user/info/` | 502（瞬时） |
| 上传元素（刷新 3 次） | 全 0 |
| 5 个静态门禁 | rc 全 0 |
| 代码改动 | **无**（纯 PRD §16.25） |

## 八、远程同步

| 远程同步 | 由门禁推导 |
