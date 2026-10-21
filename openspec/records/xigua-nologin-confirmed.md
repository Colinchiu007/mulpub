# 本次执行记录：`no login` 判据 A/B 验证（xigua-nologin-confirmed，2026-10-21）【混合 PR】

- 分支：`xigua-nologin-confirmed`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动机（闭合上轮 CCG 的未排除项）

§16.25 的 CCG 自查 i1 提出：`getAuthKey` 可能需要 POST/参数，
那样 `no login` 可能是**参数缺失的误报**。本节用竞品逆向成果里的正确调用形态做 A/B。

## 二、竞品成果里的正确形态

`04-rea-evidence/<参考产品>-主进程清点.json`：
```
https://mp.toutiao.com/xigua/api/upload/getAuthKey/?params=%7B%22type%22%3A%22
```
⇒ 竞品调用时 URL **带 `?params={"type":"..."}`**；而 §16.25 我用的是**裸 URL**。

## 三、A/B 实测（同 session，四种形态）

| 形态 | 结果 |
| --- | --- |
| GET 裸 URL | `200 {"status":-12,"message":"no login"}` |
| GET `?params={"type":"video"}` | `200 {"status":-12,"message":"no login"}` |
| GET `?params={"type":"video","source":1}` | `200 {"status":-12,"message":"no login"}` |
| POST `?params={"type":"video"}` | `403 {"code":403,"msg":"invalid csrf token"}` |

⇒ **三种 GET 形态全部 `no login`，与参数无关** ⇒ §16.25 判据成立，**不是误报**。

## 四、顺带得到的新信息

POST 返回 **403 `invalid csrf token`**（而非 no login）⇒
该接口存在 POST 形态且要求 csrf token（与登录态是两个独立前置）。

⇒ 对后续实现：
- 判登录态用 **GET 就够**（无需先解 csrf）；
- 若走 POST 提交通路，需先解决 csrf（`summon.bytedance.com/secsdk_csrf_token`，竞品成果里亦有）。

## 五、结论

「该账号在西瓜上传接口上没有登录态」从**单点读数**升级为 **A/B 验证过的结论**。
阻塞性质不变：需用户在西瓜创作平台侧完成账号授权（代码侧无解）。

## 六、读数

| 项 | 读数 |
| --- | --- |
| 上传页复测（本轮） | 仍 `netError=true`、`fileInputs=0`、`getAuthKey` 仍 `no login` ⇒ 授权未完成 |
| 5 个静态门禁 | rc 全 0 |
| 代码改动 | **无**（纯 PRD §16.26） |

## 七、远程同步

| 远程同步 | 由门禁推导 |
