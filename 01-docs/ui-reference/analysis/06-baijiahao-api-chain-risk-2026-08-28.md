# 百家号视频 API 发布链与风控弹码分析（2026-08-28，Phase C 真实发布 E2E）

## 背景

目标：把本地视频 D:\01.mp4 通过真实环境发布到已登录的百家号测试账号（da8b24f8），对齐参考产品 API 直调链。PR #1201 已合并视频 API 发布链（token → app_id → 预上传 → 分片 → 完成 → 处理轮询 → 发布），本文件记录真实 E2E 中发现的账号级风控规则、参考产品对比结论与客户端改进。

## API 发布链（已落地，Phase C）

BaijiahaoAdapter（packages/api-publish-engine/src/adapters/baijiahao.js）完整移植参考产品逆向分析实现：

1. getBaseToken：GET https://baijiahao.baidu.com/?source=inner → 正则 /BJH__INIT__AUTH__\s*=\s*(['"])([^'"]+)/ 提取 JWT（实测 249 字符）；失败返回空串。
2. getAppId：GET /builder/app/appinfo → data.user.app_id（实测 1874296973470442）。
3. preuploadVideo：POST /builder/author/video/preuploadVideo?app_id=X，body app_id&md5&is_pay_column=0&video_type=short（横版 short）→ upload_key + mediaId。
4. uploadVideoPart：POST https://rsbjh.baidu.com/builder/author/video/uploadVideo?app_id=X，multipart（app_id/md5/id=WU_FILE_0/type=video/mp4/lastModifiedDate/size/name/upload_key/file/chunks/chunk），2MB/片；响应须含 uploadId，否则按失败处理并在"存储服务异常"时换 rsbjh10/11/12.baidu.com/materialui/video/uploadvideo 重试。
5. completeUpload：POST /builder/author/video/compuploadVideo?app_id=X → mediaId + bos_url。
6. waitVideoProcess：POST /pcui/video/process（body mediaId=X）轮询至 data.editVideo.coverImage 以 http 开头；实测首帧封面 URL 形如 https://bjhmedia2.bdstatic.com/...jpg；支持 deadline/signal 止损与取消。
7. publishVideo：POST /pcui/article/publish（draft 时 /pcui/article/save），headers：Cookie、Content-Type: application/x-www-form-urlencoded、Referer: https://baijiahao.baidu.com/builder/rc/edit?type=videoV2、Origin: https://baijiahao.baidu.com、token: <BJH__INIT__AUTH__>；成功判 errno===0 && ret.id。

postData 校验要点（对齐参考产品 buildPostData$r）：

- type=video、video_duration（四舍五入）、title、content（JSON 数组：title/desc/mediaId/videoName/local=1）、desc。
- bjh_video_finger_printing：{"s2l":null,"s2game":null,"bjh":{"duration":N}}。
- tag：逗号分隔标签；position_lat_lng：无位置传空对象 %7B%7D（位置可选，参考产品同样允许空）。
- 封面：cover_layout=one&cover_images=...&_cover_images_map=...（video/process 返回的首帧）。
- 原创声明：original_status 原创 2 / 非原创 0；原创时 announce_id=0&announce_info={"first_publish":1,...}。
- 常驻字段：isBeautify=false、activity_list[0][id]=aigc_bjh_status&is_checked=0、fe_from=BJH_CMS_PC、bjhtopic_info=&bjhtopic_id=、draft_id（草稿续发时）。

错误消息脱敏：只回显 errmsg/error_msg（截断 200），不泄露 upload_key/mediaId/Stoken 等瞬时值；测试断言错误不包含半敏感值。

## 风控弹码根因（证据：三次真实 E2E 抓包）

上传链（步骤 1-6）全部返回 200 成功；唯一失败点是最后 pcui/article/publish，响应：

{"errno":10000015,"errmsg":"您所在网络环境异常，请完成验证",
 "data":{"hit_rule":"30天内注册的百家号作者弹码",
   "pass_auth":[
     {"auth_scene":"bjh_risk_phone","auth_id":"RYf4fbR..."},
     {"auth_scene":"bjh_risk_auth"},
     {"auth_scene":"bjh_risk_face_user"}],
   "feature_info":{"tianshou_info":{"is_first_publish":true,"article_order_by_type":1}}}}

结论：

- 命中规则是账号级（hit_rule: 30天内注册的百家号作者弹码 + is_first_publish: true），与请求头/UA/指纹/IP 无关；三次重试 auth_id 完全一致，属确定性规则。
- 弹码验证方式：bjh_risk_phone（手机号验证，带 auth_id 会话）、bjh_risk_auth（身份验证）、bjh_risk_face_user（人脸验证）。
- 排除项（有抓包证据）：Cookie 完整（BDUSS/STOKEN/PTOKEN/bjhStoken/devStoken）；跨域上传（rsbjh）与只读接口（appinfo）均不受拦；浏览器指纹头（sec-ch-ua 全套 + Sec-Fetch-* + Connection）已对齐后仍被拦；保存草稿（/pcui/article/save）不触发该弹码（errno 0），不能用草稿成功推断发布放行。

## 参考产品对比结论（index.cjs 全量检索）

- 主进程 index.cjs（8.4MB）检索 10000015/bjh_risk/pass_auth/网络环境异常/弹码 全部零命中：参考产品没有任何账号级弹码绕过逻辑。
- 参考产品唯一通用防御是全局 createHttpInstance()：Edge 116 UA（Mozilla/5.0 ... Edg/116.0.1938.69）、sec-ch-ua: "Microsoft Edge";v="117", "Not;A=Brand";v="8", "Chromium";v="117"、Accept-Encoding/Language、Connection、Sec-Fetch-Site/Mode/Dest、adapter:"http"（Node TLS）、200s 超时、网络错误重试 4 次、validateStatus: s>=0 && s<800。
- publish$9（视频发布，char≈1862838）请求头与我们一致：URL /pcui/article/{publish|save} 无 query、Content-Type: application/x-www-form-urlencoded、referer videoV2、Origin、token。
- 因此：同一"30 天内新号首发"账号，参考产品同样会被弹码拦截；它"不触发"的前提是账号已完成过验证或注册超 30 天。

## 客户端改进（PR 待合并）

- base-adapter.js：Accept=*/*、去掉 Cache-Control/Pragma、补 Accept-Encoding/Connection/Sec-CH-UA 全套/Sec-Fetch-*（same-origin）、UA 保持 Chrome/120（可切换参考产品同款 Edge 指纹，防御性而非决定性）。
- baijiahao.js：publishVideo 识别 errno 10000015 → 明确提示"百家号发布被风控拦截（30天内注册的百家号作者弹码）。请先在浏览器中登录百家号完成验证（bjh_risk_phone/bjh_risk_auth/bjh_risk_face_user），验证通过后重新发布"，不再回显误导性"网络环境异常"。
- 调试开关：BJ_DEBUG_TRACE=1 + BJ_DEBUG_LOG=<path> 时在请求/响应层抓包写文件（默认关闭；Cookie 值脱敏为 key+长度）。
- 测试：baijiahao-api-chain.test.js 新增 10000015 识别与 errmsg 透传用例，共 20 用例；api-publish-engine 全量 44 用例通过。

## 外部边界（不做假证据）

- 弹码验证本身（发手机验证码/提交）必须由账号持有者在浏览器或真实环境完成，客户端不伪造验证通过状态。
- 真实发布成功与否、账号是否完成验证，以 pcui/article/publish 实际响应为准（errno 0 + ret.id 才算发布成功）。
- 快手真实发布、账号验证状态、跨设备同步均属外部验收。

## 追加：真实 E2E 收尾修复与账号状态证据（2026-08-28 晚）

### 1. E2E 账号选择根因链（此前 12:05 轮失败的真正原因）

上一轮 E2E 报「平台 Cookie 缺失（账号 d39af89b 未登录）」并非简单选错账号，而是三层叠加：

1. accounts 表为空：E2E profile（real-publish-scan-run-profile）的 multi-publish.db accounts 表 0 行，发布页目标选择器渲染「请先添加账号」，没有任何账号复选框。
2. 假 PASS：原脚本 targetBox.isChecked().catch(() => true) 在 locator 不存在时静默通过，「勾选 baijiahao 账号」显示 PASS 实际未勾选。
3. 硬编码 fallback：targets 构造 ids[0] || "d39af89b" 兜底选中无凭证账号 → Executor 报 Cookie 缺失。

修复（real-video-publish.js）：账号列表为空 → 明确 FAIL；无凭证匹配 → 明确 FAIL 并列出页面账号/本地凭证；勾选后再次 isChecked 硬断言；移除硬编码 fallback，任一平台无账号即中止发布。

### 2. Cookie 过期 vs 代码问题的判据（BJ_DEBUG 抓包实锤）

用 d39af89b（08-17 添加）真实发布时，GET /builder/app/appinfo 返回：

{"errno":10001401,"errmsg":"账号已退出，请重新登录","data":null}

请求头完整（BDUSS/STOKEN/PTOKEN/bjhStoken/devStoken 等全量 Cookie、sec-ch-ua 全套、Accept: */*），排除请求头改动导致接口异常的假设；且同日 09:15 用新登录账号（da8b24f8）同一代码走到发布风控，证明链路本身可用。结论：旧账号 Cookie 过期属平台会话时效（10+ 天），必须重新登录，代码无法"续期"。

### 3. 封面提取契约（视频模式）

- UI 侧：点击「从视频提取封面」调 IPC cover:extract（主进程 CoverExtractor 输出 D:Tempmulti-publish-coverscover-<ts>.jpg），写入 article.cover_path 与 coverFileList，重复提取命中缓存（Cover already exists）。
- API 发布侧：BaijiahaoAdapter.execute 对 taskData.cover 显式拒绝（"API 发布暂不支持自定义封面（仅视频首帧封面）"）——封面由平台 video/process 自动处理（editVideo.coverImage，bjhmedia2.bdstatic.com），与参考产品一致。E2E 校验「提取封面后 cover_path 非空」作为功能验收，payload 不携带 cover_path（避免被拒）。


### 4. 发布终态判定（E2E 最后一轮仍 unknown 的原因）

页面终态正则（发布成功/失败）在任务结束后未命中：进度面板文案与正则不一致，且任务失败信息主要在 app 日志 Executor 行。E2E 判定最终以 app profile 日志（Executor Publish failed/success）为唯一依据，页面文本仅作辅助截图。测试证据链：report.json checks + app log 行 + BJ_DEBUG 抓包三者对照。

### 5. 浏览器验证为唯一前置（风控放行）

da8b24f8 命中 30 天新号弹码（bjh_risk_phone/bjh_risk_auth/bjh_risk_face_user）；d39af89b Cookie 过期。两个测试账号当前均无法直接发布：百家号需在真实浏览器完成一次弹码验证（手机验证码即可），随后重跑 E2E 预期 errno 0 + ret.id；快手（9d5ef9b7，10+ 天 Cookie）同样需在应用内重新登录刷新凭证。
