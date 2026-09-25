# Design: api-publish-engine-w3（签名页基建 + 快手 sig3 spike + 快手/小红书链）

## §0 取证锚点与关键发现（实现前必读，禁止凭记忆）

证据文件（文档域，tracked）：
- `01-docs/rpa-api-publish/evidence/yx-kuaishou-w3-slices.txt`：快手/小红书完整链逐字切片（W3 Group1 补提，含 sig3/getNewSign 外包服务确认、buildPostData 全字段、端点签名单）
- `01-docs/rpa-api-publish/evidence/yx-slices-v2.txt`：`getSign$5@1341838`、`__NS_sig3@1342665/@1343225`、`getUploadArgsResponse$9@1344875/@1357008`、`uploadVideoPart$b@1379772/@1386455`、`publishKuaishouVideo@1389174`
- `01-docs/rpa-api-publish/evidence/yx-bundle-slices.txt`：`checkKuaiShouLogin@1378035/@1425381`、活动链 `__NS_sig3=` 拼接段（URL 前缀 `cp.kuaishou.com/rest/v2/...?__NS_sig3=`）
- bundle 完好性判据沿用 W2 tasks 1.1 的可复现定位法（size/SHA256 钉文件，实际目录名存会话记忆/EverOS，不入 tracked 文档，避 Gate 12）

**关键发现（本波裁决前提）**：`packages/api-publish-engine/src/signer/index.js@23` 现存注册命令 `kuaishou.ns-sig3` = **本地近似公式** `MD5(api_ph | JSON(body))`（`signer-local.getKuaishouSign`，注释自述「此前经第三方远程签名服务」被 Q16 拆除后本地化）。bundle 中 `getSign$5@1341838` 段显示参考产品另有**外包签名服务路径**。两者关系未钉死前，不得默认签名页是唯一出路——**spike 门禁第 0 步先裁决本地公式有效性**（见 §4），若活体探针通过，sig3 归为 Tier-A，小红书 x-s 同样先探针再上基建。

## §1 总体架构

```
apps/desktop/electron/signer/            packages/api-publish-engine/
┌─────────────────────────┐             ┌──────────────────────────────┐
│ signer-page-manager     │  in-proc    │ signer/browser-page-provider │
│  · 隐藏 BrowserWindow    │◄──register──│  registry.register(command,  │
│    persist:signer-<p>   │   bridge fn │    () => bridge(signCommand, │
│  · 域锁 will-navigate /  │             │    payload))                 │
│    setWindowOpenHandler │             │ publish/platforms/kuaishou-  │
│  · webpack 抽取器        │             │   video.js / xiaohongshu.js  │
│  · 拦截法双验证          │             └──────────────────────────────┘
│  · 白名单 IPC signer:*   │
└─────────────────────────┘
```

- 基建在 **electron main 进程**（QM-1 强制面）；引擎侧只拿到一个注入的 bridge 函数（`async ({signCommand, payload}) => signature`），保持引擎包可单测（假 bridge 注入）。
- provider 注册形态对齐 W2 `douyin.ticket-guard-*`：`signer/index.js` 追加注册，真实 bridge 由桌面装配层注入；无 bridge 时求签抛「签名页未就绪」→ 上落到 publishMode 双轨（api-then-dom 降级 DOM，非风控）。

## §2 签名页基建契约（api-publish-signer-page）

1. **生命周期**：`getSignerPage(platform)` 懒建隐藏窗口；加载平台创作者域已登录页面（登录预热复用主窗口同一 `persist:` partition 还是独立 partition+cookie 同步，为 spike 验证项 V-partition，默认尝试复用登录 partition——Q13「Cookie/UA 同源」）。
2. **域锁**：`will-navigate` 与 `setWindowOpenHandler` 白名单=该平台域表（硬编码，如 `cp.kuaishou.com`/`creator.xiaohongshu.com`），非白名单一律拒绝；不加载任何非平台域内容（Q17③）。
3. **抽取器**：`executeJavaScript` 注入一次性脚本：`window.webpackChunk*` push 劫持 → 模块源码按特征码（对已知调用点字符串扫描，如 sig3 参数拼接点）定位 → 函数句柄写入页面槽位 `window.__mpSigner.<key>`。**句柄只存页面 world 内存，绝不序列化回传/落盘/入库/入 git**（Q17②）；主进程只持有 `signCommand` → 槽位名的映射表。
4. **双验证（拦截法）**：hook 页面 `XMLHttpRequest.open/send` 与 `fetch`，捕获页面真发的带签请求，对同 payload 用槽位函数复算比对；一致 → 登记 `verified`；不一致 → 槽位废弃、重扫模块、报告（连续不一致 → 该 command 判 unverifiable）。
5. **求签通道**：引擎 bridge → main `signer:invoke {signCommand, payload}` → 仅允许 `verified` 槽位、payload 尺寸上限、白名单外 command 拒绝。renderer 侧不存在任意 JS 求值通道（Q17①）：`signer:*` IPC 不暴露 `executeJavaScript` 原语。
6. **自愈与降级**：求签异常/特征码失配 → reload + 重抽取，限流 ≤3 次/平台/小时；超限置 `signer.degraded=true`，该平台自动落 DOM RPA 并报告（对齐 publishMode 语义，不新增状态机）。

## §3 数据校验（每步合同，假服务器钉死 + 活体抽检）

| 步骤 | 校验断言（失败动作） |
|------|---------------------|
| getUploadArgs | 上传地址/照片标识/参数组非空；否则 `data_error` 可重试≤3 |
| 分片上传 | HTTP 2xx 且偏移/ETag 应答存在；单片重试≤3，连续 2 片失败中止 |
| complete/finish | **`result===1` 成功；`result===109` → login_expired 停任务不降级**；其余码错误映射 |
| 封面上传 | coverKey/pic_id 非空 |
| 发布提交 | `result==1` 且作品 ID 非空；风控信号（非 JSON 验证页/频率文案）→ risk_blocked 挂起 |
| 签名字段 | 提交前本地断言：签名串非空、`sig3` 长度阈值 ≥40（技术方案 §5）、仅拼进白名单参数名（`__NS_sig3`/`x-s`/`x-t`） |

## §4 Spike 门禁执行序（M3，时间盒 1 个工作日，逐序短路）

- **S0 公式探针裁决**（活体，用户在场）：用已登录快手账号 cookie 对最低风险已认证 GET/查询端点（从切片端点中选无副作用者，如 creator 查询类）分别以「无 sig3 / 本地公式 sig3」发起，比对平台接受性。S0 通过 → sig3 判 Tier-A，S2-S3 短路跳过，直接进 Group 4 链实现（签名页基建仍交付但仅作 xiaohongshu 备胎与评审对象）。
- **S1 假页面自测**（离线）：本机假 webpack 页面钉抽取器/双验证/域锁/限流降级行为（组 2 测试）。
- **S2 真页抽取+比对**（活体，用户在场）：`cp.kuaishou.com` 登录态抠出 sig3 函数，拦截法同 payload 复算 == 页面真发值。
- **S3 复算直发活体**（活体，用户在场）：抽取函数产出的签名直发 1 条真实请求（私密/草稿优先，Q15）。
- **裁决记录**：S0-S3 任一失败 → **止步**：快手/小红书保持 DOM RPA，platforms.yaml 不动，Group 4/5 不合并（隔离分支留存），签名页基建按代码可用性单独评审是否合并；spike 比对记录（含失败现场）入 `evidence/api-w3-kuaishou/`。⛔ 不做任何绕过：不换号、不自动验证、不重试刷签名。

## §5 快手发布链（api-publish-kuaishou-chain，仅 spike go）

步骤（字段名已回填，源自 `evidence/yx-kuaishou-w3-slices.txt` §1.1-§1.11）：
1. 前置校验：cookie 中 regex `/kuaishou\.web\.cp\.api_ph=([a-z0-9]+)/` 提取 api_ph，fail-closed 零请求
2. `getUploadArgs`：POST `/upload/pre?__NS_sig3=`，body=`{uploadType:1, api_ph}` → `{token, endPoints[0]}`
3. 分片上传：POST `{endpoint}/api/upload/fragment?upload_token&fragment_id`，Content-Range `bytes s-e/total`，4MiB/片 → `{checksum}`
4. complete：POST `{endpoint}/api/upload/complete?fragment_count&upload_token`，空 body → result==1
5. finish：POST `/upload/finish?__NS_sig3=`，body=`{token,fileName,fileTyp:"video/mp4",fileLength,api_ph}` → `{fileId}`
6. 封面：POST `/upload/cover/upload` multipart FormData(file, api_ph) → `{coverKey}`
7. buildPostData：组装提交 body（caption/coverKey/coverType/fileId/api_ph/photoStatus/photoType/publishTime/domain/secondDomain/coverCropped:false 等，详见切片 §1.7）
8. submit：POST `/video/pc/submit?__NS_sig3=` → `{result,currentTime}`; result==1 成功, publishId=currentTime.substring(0,10)
9. 回查：POST `/photo/list` queryType:"2" 近 5min → match unPublishCoverKey → 确认 photoId
- 错误语义：result==109 → login_expired 停任务不降级; 外包签名 URL 片段 grep 门禁(src/adapters+src/publish 零命中)
- `KuaishouAdapter` 变薄委托（对齐 W2 `douyin.js` 形态）；旧骨架远程签名拼参路径下线
- platforms.yaml kuaishou `publishMode` 翻转 api-then-dom + publish-mode 回归扩展 kuaishou 行
- __NS_sig3 带签端点清单：upload/pre, upload/finish, video/pc/submit, creator 查询类; 不带签：fragment, complete, cover, photo/list

## §6 小红书链（api-publish-xiaohongshu-chain，前置取证不满足即止步）

**Group 1 补提结论（详见 `evidence/yx-kuaishou-w3-slices.txt` §2.1-§2.7）**：
- `getNewSign(path, body)` 输入=`JSON([path, encodeURIComponent(body)])`，输出=`{X-s, X-t, a1, X-S-Common?}`，signCommand="newxiaohongshu"，与快手共用同一外包签名服务。
- 发布提交：POST `edith.xiaohongshu.com/web_api/sns/v2/note`，X-s/X-t 必填，`!sig["X-s"]` → throw; code==0 && data.id → 成功。
- 视频链：getUploadArgs("video") → getUploadId(XML) → 5MiB分片 → fileIds[0]; buildPostData$K(nodes/cover/topics max10).
- 图文链：getUploadArgs("image") → uploadImage$8(buffer→uploadAddr) → fileIds[0]; publish$j 同 endpoint.
- **止步裁决**：x-s/x-t 算法完全依赖外包服务，无反推本地公式的已知路径，本地 getXiaohongshuSign 为未验证近似。小红书链保持 Tier-B 待验证，**不阻塞快手链**；若签名页基建 W3 验证不通过即止步入 W4。
- `xiaohongshu.x-s` 注册表 provider 槽预留（签名页基建可服务），但本波不激活链实现。

## §7 风控接线与合规墙

- 复用 W1 `outcomeOfResult`/`risk-suspender`：快手/小红书风控信号 → `risk_blocked` → 挂起 `platform::accountId`、二次请求零发出、绝不自动换号（Q8）。
- 登录失效码（快手 109 等）→ `login_expired` 停任务不降级（技术方案 §5）。
- 频率：活体同账号两次 API 发布间隔 ≥18min（Q4）。
- CI/本地门禁：`refpub`/外包签名服务 URL 零命中扩展至 electron 新增代码；`__mpSigner` 不得作为字符串常量出现在 `packages/`、`apps/` 运行时代码（注入脚本模板内允许，测试断言扫描口径区分）；函数句柄序列化防护（bridge 返回值必须是字符串/纯 JSON，测试断言注入脚本不含 `JSON.stringify(fn)`/`Function.prototype.toString` 回传）。
- i18n：新增用户可见文案（「签名页未就绪」「登录已失效」等）locales zh/en 成对（Gate 7）。

## §8 QM-1 与验证矩阵

- 触碰 `apps/desktop/electron/`：`pnpm exec electron-builder --win --dir --publish never` → asar list 含 signer 模块 → extract require 链 → exe 8s 存活且 stderr 无新错。修改 preload 后 sandbox:true/false 两模式 `window.electronAPI` 可用验证。
- 引擎包全量门禁：run-tests（vitest + direct）；新测试登记 VITEST_FILES（node UTF-8 脚本，禁 PowerShell Set-Content）。
- worktree 依赖：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`（Electron 真实 IPC 验证前必跑）。

## §9 回退面

| 场景 | 回退动作 |
|------|---------|
| S0-S3 任一失败 | 止步留 DOM；平台代码留存隔离分支；证据记录失败现场；M3 记 no-go |
| spike go 但链实现受阻 | 平台保持/回拨 dom-only（独立小 PR），基建与其余平台不受影响 |
| 签名页基建回归破坏桌面 | QM-1 失败即不许合并；基建与链分 PR 提交（基建先行 PR 可独立回滚） |
