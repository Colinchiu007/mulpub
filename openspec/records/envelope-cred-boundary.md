# 本次执行记录：信封库凭据"绕开 GUI 取用"排查（envelope-cred-boundary，2026-10-21）【docs-only】

- 分支：`envelope-cred-boundary`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（files=3）
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动机

Round 51 发现应用未启动（electron=0），无法复跑抖音 E2E。
于是想：能否**不启动 GUI** 就取到凭据验证发布链？

依据是 PRD §16.18.2 已确立的事实 —— 发布链主源是**信封库** `authData.cookies`，
分区 cookie 只是回退（此前用分区 cookie 探测被 300330 误导过）。
若能在 Node 里解出信封库凭据，就等于拿到了发布链真实输入。

## 二、三条路全堵（实测，非推测）

| # | 路径 | 结果 |
| --- | --- | --- |
| ① | 纯 Node + PBKDF2/AES-256-GCM | masterKey 文件是 `safeStorage:v1:<base64>` 形态，**被 Electron `safeStorage.encryptString()` 包过**，不是裸 hex ⇒ 拿不到 PBKDF2 输入 |
| ② | PowerShell + DPAPI（`ProtectedData`/CurrentUser） | 报 **"The data is invalid"** ⇒ safeStorage 在 DPAPI 外层还有自己的格式头，不是裸 DPAPI 密文 |
| ③ | Electron Node 模式（`ELECTRON_RUN_AS_NODE=1`） | `require('electron')` 返回的对象**没有 safeStorage**（该模式只暴露部分 API） |

## 三、结论

**信封库凭据只能经 GUI 应用取得** —— 安全边界按设计生效，这不是缺陷。

⇒ 留档价值：证明"绕开 GUI 取凭据"这条路走不通，**后续会话不必重试**。
（这条正是我这几轮反复强调的"不要把工具的失明读成结论"的反向应用：
   这里是确实走不通，而不是"我没试出来"。）

## 四、产物

`scripts/dump-envelope-credentials.cjs` —— 保留代码作为排查记录，**头部注释明确标注"当前解不开"**与三条路各自的失败原因。

> 刻意保留一个"暂不可用"的脚本，是因为：删掉它，下一个会话会从零开始重试这三条路。
> 但绝不让它以"可用工具"的面目存在 —— 注释里写清了状态与原因。

若将来要支持，唯一正道是让 GUI 应用暴露一个**受控的**导出 IPC（带授权与审计），
而不是在进程外破解凭据。

## 五、远程同步

| 远程同步 | 由门禁推导 |
