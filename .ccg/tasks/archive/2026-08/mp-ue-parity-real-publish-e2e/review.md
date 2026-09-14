# 双模型审查报告 — 百家号 API 直调链（Phase C）

## 审查会话
- opencode（provider=opencode-go, model=deepseek-v4-flash）：2026-08-28，SESSION_ID ses_fb958cc2fffeSGkAfPEXo6cgN2，exit 0
- Claude（SDK stream-json）：2026-08-28，SESSION_ID 5bc894af-ddab-43a8-be6a-78a9fd6bd34e，exit 0
- 输入：8 文件 639 ins / 76 del（review-diff.txt）

## 合并结论（去重后）

### Critical（已全部修复）
1. **form-data 未声明为生产依赖**（opencode C1 / QM-2 闭包）→ package.json dependencies 加 form-data@^4.0.6，pnpm install 更新 lockfile。
2. **任务级 300s 超时从未生效**（Claude C1 / opencode M1）→ adapter.execute 读取 opts.timeout 计算 deadline，waitVideoProcess 轮询循环强制收口，超时返回「任务级超时」。
3. **Cookie 平台域过滤可能剔除 BDUSS**（Claude C2）→ PLATFORM_COOKIE_DOMAINS.baijiahao 放行 baidu.com 父域（仅精确匹配，拒绝 .evil.baidu.com 子域冒充）；补平台域测试。

### Major（已修复）
- draft 语义丢失（opencode M2 / Claude W6）→ ApiPublisher 透传 draft 到 taskData 与 opts，publishVideo draft 走 /pcui/article/save，补 draft→save 测试。
- 真实路径测试缺口（opencode M3 / Claude I1）→ execute 测试改为临时文件真实链（3MiB→2 片、uploadId/bos_url/video_type=short 判据断言）；补存储服务异常重试、错误脱敏、取消、封面拒绝、缺失文件、基类 cancelToken 形态测试。
- 签名与基类契约偏离（opencode M4）→ publish 兼容检测：cancelToken 形态无 token 时显式报错。
- headers 缺失浏览器头（Claude W1）→ 全链统一走 this.getHeaders（含 UA/Accept/Sec-Fetch）。
- rsbjh 重试 host 与文档矛盾（Claude W2）→ 回查参考产品原样为 rsbjh10/11/12（代码正确），PRD/CHANGELOG 修正。
- uploadVideo 返回 null TypeError（Claude W3）→ execute 显式「视频文件缺失或无法读取」。
- 取消语义仅检入口/完成（Claude W4）→ signal 透传分片循环与轮询循环。
- 自定义封面静默忽略（Claude W5）→ 显式拒绝「API 发布暂不支持自定义封面」。
- 错误消息携带半敏感响应体（Claude W7）→ errSummary 仅回显 errmsg/errno。
- createPublisher 死代码（opencode / Claude W8）→ 删除重复 return。

### Minor（已修复/已处理）
- 测试 console.log 噪音删除；文件末尾补换行。
- 正则弱匹配升级（单/双引号均可捕获）。
- draft_id 空值 bug → 合并 taskData.draftId 与参数取值。
- desc 阈值 off-by-one → 文档对齐为 ≤2 字符回退。
- duration float → Math.round。
- waitVideoProcess 吞异常空转 → 连续 10 次异常提前止损。
- platforms.yaml has_api false→true（路由一致）。
- readFileSync 大文件内存峰值 → 已知限制记录于 PRD 11.7（不做流式改造）。

### 验证
- baijiahao-api-chain.test.js 18/18；publisher-router.test.js 42/42；api-publish-engine 全量 42 vitest+独立套件；shared-utils 242/242；video-clone/webview-manager 27/27；lockfile 更新；verify-worktree-deps OK。

## 遗留
- 真实发布 E2E 阻塞：debug profile 凭证 safeStorage/DPAPI 绑定原机器无法解密；账号 cookie 也可能已过期（appinfo/preupload 均失败）。需用户本机重新扫码登录（auth:open-login）或提供本机可解密 profile。
