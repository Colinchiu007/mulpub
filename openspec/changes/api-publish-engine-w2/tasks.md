# Tasks: api-publish-engine-w2（抖音准自包含发布链）

## 1. 前置取证（design §1 硬约束：未取证块不得凭记忆实现）

- [x] 1.1 按 design §1 的可复现定位法（`Get-ChildItem D:\Data -Recurse -Filter index.cjs` 取 size=8401332 且 SHA256=`EC829DA4…8008BC`，实际目录名存于会话记忆/EverOS，不入本 tracked 文档避 Gate 12）确认 bundle 完好，从中补提抖音上传步骤逐字切片：getAuthKey v5 响应字段 → TOS/aws4 upload 全段（endpoint 选择、Key/Auth 字段名、分片 vs 单 PUT、finish 响应 → videoId 字段名）→ uploadCover 全段（coverUri/coverUrl 字段名），入 `01-docs/rpa-api-publish/evidence/`（真实私钥/cookie 值与品牌词均占位符化，过品牌残留门禁）
- [x] 1.2 补提 `buildPostData_v2` body 字段逐字切片（title/video_id/cover/可见性私密草稿参数/AI 声明位），同入库并标注 bundle 偏移量
- [x] 1.3 依据 1.1/1.2 产物回填 design.md §2 步骤 2/3/4/5 的待钉字段名，消解所有「待 2.4/2.4 补提」标注
- [x] 1.4 新增 npm 依赖 `aws4`（本 W2 worktree 为 lockfile 唯一执行点）：`pnpm add aws4` 于 `packages/api-publish-engine`，最小消费冒烟（签名头含 Authorization/x-amz-date 钉结构），commit lockfile

## 2. clientSign 本地签名（TDD，tests 先红）

- [x] 2.1 测试先行：`signer` 单测——自生成 EC 私钥 fixture + 构造 security-sdk cookie，断言 base64 三层结构、`req_content:"ticket,path,timestamp"` 契约、timestamp 秒级单调、`web-version` hash 前缀推导、任一材料缺失/PEM 非法 → throw「账号信息缺失，请重新授权此账号再试」
- [x] 2.2 实现 registry 命令 `douyin.ticket-guard-client-data` 与 `douyin.ticket-guard-ree-public-key`（payload={cookie}，逐字对齐 `yx-slices-v2b.txt @2673500` 双层解码链），注册进 `signer/registry`；2.1 转绿
- [x] 2.3 回归：远程签名通道零命中门禁扩展覆盖 douyin（`MP_SIGNER_BASE` 类禁止回归既有断言保持通过）；签名材料与私钥不落盘/不入日志（错误路径脱敏断言）

## 3. douyin-video 发布链（TDD，链契约测试先行）

- [x] 3.1 红测：`douyin-video-chain.test.js`——127.0.0.1 假服务器钉全链步骤序列（csrf HEAD → auth/v5 → upload → finish → cover → create_v2）与每步 method/URL 前缀/headers 白名单/query 串（含 `a_bogus=` 空值、msToken cookie 提取与 `a12man123masb` 回退伪值）/body 字段（对照 1.1/1.2 切片逐字段）
- [x] 3.2 红测：fail-closed 零请求面——四类签名材料 cookie（s_sdk_crypt_sdk / s_sdk_sign_data_key / bd_ticket_guard_client_data / sid_tt）逐一缺失、视频文件不存在（io_error）、私钥非法，均断言零网络请求
- [x] 3.3 实现 `publish/platforms/douyin-video.js` 步骤 0-1：前置校验（零请求 fail-closed）+ getSdkToken（URL 池 idx%3 轮换、`x-secsdk-csrf-request:1`/`1.2.7`、`x-ware-csrf-token.split(",")[1]`），复用 `publish/core` http-base/contract/errors
- [x] 3.4 实现步骤 2-4：getAuthKey v5（retryCondition=!isJson ≤3）→ aws4 签名上传（region cn-north-1；分片/单 PUT 以 1.1 取证为准，分片对齐 8388608）→ finish 取 videoId → 封面上传
- [x] 3.5 实现步骤 5-6：create_v2 提交（完整 `bd-ticket-guard-*` 头组、client-data 本地签出、Referer/Origin、可见性私密/草稿参数 Q15）+ 响应裁决（`x-tt-verify-passport-decision` → risk_blocked；`status_code===0 && aweme_id` → `{success, publishId, mode:"api"}`；登录失效码族 → login_expired 不降级）；3.1/3.2 转绿

## 4. Adapter 接线与旧骨架下线

- [x] 4.1 `DouyinAdapter.publish` 变薄委托 `publishDouyinVideo`（§4.4 模式，对齐 shipinhao-adapter 测试形态）：`douyin-adapter.test.js` 覆盖成功/失败归一/fail-closed 透传/零请求
- [x] 4.2 旧 `aweme/post` 链与 `getDouyinSignature` 消费点整体删除；grep 门禁：`aweme/post|_signature` 在 `packages/api-publish-engine/src` 运行时代码零命中（测试 fixture 除外，按 W1 门禁脚本模式落断言）
- [x] 4.3 `config/platforms.yaml` douyin `publishMode: dom-only → api-then-dom`；publish-mode 回归套件扩展 douyin 行（api-then-dom 降级 DOM、risk_blocked 不降级）

## 5. 风险接线与门禁

- [x] 5.1 `publish-risk.isRiskBlocked` 新增 douyin 信号（`x-tt-verify-passport-decision` 响应头、`status_code===110` 验证失败语义），命中 → 挂起 `platform::accountId` + `publish:risk-suspended` 广播（复用桌面横幅零新 UI，W1 §5 enforcement 自动覆盖）；补单元回归
- [x] 5.2 全量门禁：api-publish-engine 全测 + 桌面受影响 suites + QG 静态检查；如触碰 `apps/desktop/electron/` 或 `packages/rpa-engine/` 则补跑 QM-1 打包三件套（builder --dir → asar list/extract require 链 → exe 8s 存活）

## 6. 交付与活体裁决（M2）

- [ ] 6.1 commit / push / PR / autoMerge，CI 全绿后合并（harness 常规链）
- [ ] 6.2 M2 活体裁决（用户在场门槛，与 W1 §7.5 共用真实账号窗口）：真实标题私密/草稿优先 1 条、间隔 ≥18min、前台回查、证据四件套入 `evidence/api-w2-douyin/`；风控即停绝不换号；⛔ 不执行 checkByPassword 自动验证（D1）
- [ ] 6.3 裁决结论（go/no-go + 平台响应记录）回写 PRD F11 与 techdoc v2 修订记录；no-go 时 platforms.yaml 回拨 dom-only（独立小 PR）
- [ ] 6.4 收口：`openspec archive` + CCG task 归档 + 质量节拍 learnings/记忆三投
