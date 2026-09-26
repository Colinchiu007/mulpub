# Tasks: api-publish-engine-w3（签名页基建 + 快手 sig3 spike + 快手/小红书链）

## 0. 环境就绪

- [x] 0.1 worktree 依赖就绪：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`；确认 Write Guard watcher 运行、pre-flight 守卫通过

## 1. 前置取证（design §0 硬约束：未取证块不得凭记忆实现）

- [x] 1.1 按 W2 可复现定位法确认 bundle 完好，补提快手完整链逐字切片：getUploadArgs 请求/响应字段全段 → 分片上传（needParts/分片大小/cancelToken）→ finish（result 语义码表含 109）→ 封面 → 发布提交 body 逐字段（含 `ai_generated` 位、可见性私密/草稿参数）→ `__NS_sig3` 拼接点清单（哪些端点带签/哪些不带），入 `01-docs/rpa-api-publish/evidence/`（品牌词与真实值占位符化，过 Gate 12）
- [x] 1.2 补提小红书完整链切片（上传 + 发布提交 + `x-s`/`x-t` 生成调用点全段）；缺口过大即依 design §6 记录止步裁决（不阻塞后续组）
- [x] 1.3 依据 1.1/1.2 回填 design §5/§6 待钉字段名，消解「以切片为准」占位标注

## 2. 签名页基建（TDD：假页面离线自测先行，design §1/§2）

- [x] 2.1 红测：`packages/api-publish-engine/test/browser-page-provider.test.js`——假 bridge 注入注册/求签/未注入 fail-closed（「签名页未就绪」语义）/仅 `verified` command 服务/返回值必须纯 JSON 字符串；注册表远程通道零命中断言扩展
- [x] 2.2 实现 `signer/browser-page-provider.js`（bridge 注入形态）+ `signer/index.js` 追加注册 `kuaishou.ns-sig3`（browser-page 版按 spike 裁决覆盖或并存）与 `xiaohongshu.x-s` provider 槽；2.1 转绿；VITEST_FILES 登记（node UTF-8 脚本）
- [x] 2.3 红测（Electron 集成，本机临时假 webpack 页面）：`apps/desktop` 侧 signer-page-manager 契约——域锁拒绝导航、webpackChunk push 劫持抽取、拦截法比对一致/不一致两分支、限流第 4 次置 degraded、IPC 白名单外 command 拒绝、注入脚本无 `Function.prototype.toString`/`JSON.stringify(fn)` 回传
- [x] 2.4 实现 `apps/desktop/electron/signer/`（signer-page-manager + 抽取器模板 + 拦截双验证 + `signer:invoke`/`signer:status` 白名单 IPC + preload 桥）；2.3 转绿；**QM-1 打包三件套**（builder --dir → asar list/require 链 → exe 8s 存活 stderr 干净）+ preload sandbox 两模式验证
- [x] 2.5 locales 成对：新增用户可见文案（签名页未就绪/登录已失效/降级提示）zh/en 写入 `apps/desktop/src/locales/`（Gate 7）

## 3. M3 spike 门禁（时间盒 1 个工作日，逐序短路；S0/S2/S3 用户在场门槛）

- [x] 3.1 S0 公式探针（用户在场，最低风险已认证查询端点，零发布副作用）：无 sig3 / 本地公式 sig3 双发比对平台接受性 → 裁决 `kuaishou.ns-sig3` Tier-A 可行性；通过则 S2/S3 短路
  - 结果：**INCONCLUSIVE**（探针端点不校验 sig3，无法区分无签/近似签/真签；本地公式 MD5 为 32 位裸 hex 结构上短于真 sig3 56 字符，本地签名器路线作废）→ 不短路，继续 S2。详见 `evidence/api-w3-kuaishou/spike-verdict.md`
- [x] 3.2 S2 真页抽取+拦截比对（用户在场）：`cp.kuaishou.com` 登录态抠 sig3 函数，同 payload 复算 == 页面真发值；V-partition 复用方式一并验证记录
  - S2a 静态侦察：**Tier-A 方向成立**（sig3 由快手页面自带 `$encode` VM 生成，非第三方外包，不触 §7 grep 门禁）。S2b 活体终判：**Tier-A GO**（页面签名器为我方独立构造请求产出的 sig3 被平台接受，新构造新签新发即时有效）。Group 4/5 放行
- [ ] 3.3 S3 复算直发活体（用户在场）：抽取函数签名直发 1 条真实请求（私密/草稿优先、间隔 ≥18min）
  - 状态：未单独执行；S2b 已证「独立构造请求接受性」核心命题，S3 语义延期至 6.3 发布链集成验收（submit 端点真实发布由用户在场做最终回归），不再阻塞 Group 4/5 开发
- [x] 3.4 M3 裁决记录：S0-S3 结果（含失败现场）写 `evidence/api-w3-kuaishou/spike-verdict.md` + 回写 PRD F12/techdoc v2 修订记录；**no-go → 跳到 6.1 收尾**（Group 4/5 不合并、platforms.yaml 不动、基建单独评审）
  - 裁决：**go**（S2b Tier-A）→ 进入 Group 4；PRD F12/techdoc v2 回写随 6.4 收口

## 4. 快手发布链（仅 spike go；TDD 链契约测试先行）

- [x] 4.1 红测 `kuaishou-video-chain.test.js`：127.0.0.1 假服务器钉全链序列（args→分片→finish→封面→提交）method/URL/headers/body 逐字段对照 1.1 切片；fail-closed 面（api_ph 缺失/视频不存在/签名空或 <40）零请求；`result===109` → login_expired 不降级
- [x] 4.2 实现 `publish/platforms/kuaishou-video.js`（复用 core http-base/contract/errors + 注册表求签分派）；4.1 转绿（链 19 测绿，求签仅经 `kuaishou.ns-sig3-browser` 注册表 command，零 HTTP 签名通道）
- [x] 4.3 `KuaishouAdapter` 变薄委托（对齐 W2 douyin.js 形态，granular 空安全契约）+ `kuaishou-adapter.test.js`；旧骨架远程签名拼参路径下线 + grep 门禁（外包签名服务 URL 片段 `src/adapters`+`src/publish` 零命中，`kuaishou-legacy-chain-gate.test.js`）；既有 e2e/ai-declaration 测试同步适配新 caption 形态
- [x] 4.4 platforms.yaml kuaishou `publishMode` 翻转 api-then-dom（has_api 同步 true）+ publish-mode 回归扩展 kuaishou 行（api-then-dom 入波断言；risk_blocked/login_expired 不降级由 publish-mode-runner 既有契约覆盖）

## 5. 小红书链（1.2 取证通过时执行，否则记录止步跳过）

- [ ] 5.1 红测+实现 `publish/platforms/xiaohongshu.js`（x-s/x-t 按 §6 裁决路径）、`XiaohongshuAdapter` 委托、platforms.yaml 翻转与回归（形态同 Group 4）
- [ ] 5.2 风险信号归一：小红书响应验证页/频率信号 → `outcomeOfResult` risk_blocked 回归（对齐 douyin-risk.test.js 形态）

## 6. 门禁与交付

- [ ] 6.1 全量门禁：api-publish-engine run-tests 全绿 + 桌面受影响 suites + QG 静态（品牌残留/远程通道零命中扩展/__mpSigner 常量扫描）+ QM-1 最终包验证；`openspec validate` 通过
- [ ] 6.2 PR/autoMerge（基建与链可分 PR：基建先行独立可回滚）；CI 全绿自动合并
- [ ] 6.3 （spike go 时）活体裁决验收（用户在场）：快手真实标题私密/草稿 1 条、间隔 ≥18min、前台回查、证据四件套入 `evidence/api-w3-kuaishou/`；风控即停绝不换号
- [ ] 6.4 收口：M3 结论回写 PRD F12/F13 与 techdoc v2；`openspec archive` + learnings/记忆三投
