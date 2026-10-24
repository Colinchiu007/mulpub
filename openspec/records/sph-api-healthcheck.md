# 本次执行记录：视频号 API 轨健康检查（sph-api-healthcheck，2026-10-21）【混合 PR】

- 分支：`sph-api-healthcheck`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动机

§16.28 定位到「API 轨先失败但原因未留档」。本轮做**不浪费发布机会**的排除性检查
（不重启应用、不再发起一次注定无诊断的发布）。

## 二、检查一：API 轨测试全绿

用项目自身 runner：
```
[API 测试] 通过：Vitest（48 个文件）   rc=0
```
⇒ `shipinhao-video-chain.test.js`（私密优先 / post_draft 五步序列 / 鉴权头逐级传递）通过。

### 过程中的命令用错（教训）
直接 `vitest run <file>` 与 `node --test` 都报 `describe is not defined`，一度以为文件坏了。
真因：该文件**依赖 vitest 全局**，必须由 `run-tests.js` 按 `VITEST_FILES` 在册登记走 vitest 分支跑
—— 正是 2026-10-21 `runner-detect.js` 要解决的形态。

⇒ **判测试结果必须用项目自己的 runner**，与 §16.29「判据域跟着被测性质走」同型。

## 三、检查二：两个 CDN 主机均可达

只读 GET 探测（不发布、不传内容）：

| 主机 | 根路径 | helper_upload_params 路径 |
| --- | --- | --- |
| `finder.video.qq.com` | 404 | 404 |
| `finderassistancea.video.qq.com` | 404 | 404 |

⇒ **两主机都能建立 HTTP 连接**（404 而非 DNS/连接错误）⇒ 主机选型不是阻塞点；
404 是「路径不存在」，实际路径由 applyuploaddfs 决定。

## 四、结论

| 项 | 状态 |
| --- | --- |
| API 轨代码 | ✅ 测试全绿（48 文件 rc=0） |
| CDN 主机可达性 | ✅ 两主机均可建立连接 |
| **运行时失败原因** | ❌ **仍未知** |

⇒ 唯一信息缺口是运行时诊断，需要：① 应用重启到含 #4150/#4155 埋点版本；② 复跑一次。

**在拿到 `apiTrackFailed` 之前，不再改代码**（无依据的改动只会引入新变量）。

## 五、客观依据（不是拖延）

electron 主进程启动时间 **15:55:23**，而 #4155（分轨埋点）合并于其后 ⇒
当前进程跑的是**旧二进制**。

## 六、读数

| 项 | 读数 |
| --- | --- |
| `run-tests.js` 全量 | rc=0（48 文件） |
| CDN 探测 | 4/4 返回 404（均可建立连接） |
| 5 个静态门禁 | rc 全 0 |
| 代码改动 | **无**（纯 PRD §16.30） |

## 七、远程同步

| 远程同步 | 由门禁推导 |
