[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose 审查播客一键发布刀 2 的实现（git diff origin/main...HEAD，分支 podcast-hosting）：正确性/边界/安全/规格合规。重点：1) podcast-hosting-service.saveHosting 的凭证合并语义（缺席=保持、clearSecret、拒空覆写、crypto 失败不半落盘、owner=null fail-closed）；2) publishFeed 的先建回滚点再覆盖主键顺序与失败形状；3) putObject 读流 error 监听与 2xx 不掩盖读体失败；4) ipc-handlers/podcast.js 新增 4 条通道与 subCode 透传；5) validateHosting 的 pathPrefix 出声拒绝是否重复了 normalizePathPrefix 的职责。逐条给 severity(Critical/Warning/Info)+文件行号+具体失败场景，输出 JSON。
  PID: 28112
  Log: （本机 runner 临时日志，非交付物；会话产物以上述 Session-ID 为准）
  Session-ID: 85dc8181-6796-48c2-86a3-9e24dd9f3be9
我已完成对刀 2 全链的逐项审查（托管服务、upload 规则层、registry 落盘、channel-locks、IPC handler/test、preload 桥接、渲染层 composable/卡片/视图，以及 spec 逐条对照）。以下是评审结论。

```json
[
  {
    "severity": "Warning",
    "file": "apps/desktop/electron/services/podcast-hosting-service.js",
    "line": "190-204",
    "verdict": "CONFIRMED",
    "summary": "只改 accessKeyId 不重输 secret 且已有旧凭证时，新 AK 会与旧 secret 配对保存并通过全部校验，留下 configured=true 但每次上传 403 的静默坏态",
    "failure_scenario": "用户已配置 AK=A、SK=S。之后在表单只把 accessKeyId 填成新的 B、accessKeySecret 留空（渲染层对空白 secret 不提交，见 usePodcastHosting.js:87-91）。saveHosting 走 keyId=B、inputSecret=''、secret=''||prevSecret.accessKeySecret=S → validateHosting 见 B 与 S 均非空、其余字段合法 → 通过；saveCredential 落盘 {accessKeyId:B, accessKeySecret:S}。此后 index.hosting.credentialRef 指向该凭证且 configured=true，但 B/S 是错配键，每次发布 403、feedSync 落 failed。这正是模块头部注释及 publishFeed 注释三段强调要防的『半新半旧』（podcast-hosting-service.js:190-195 只防『空 secret 覆写』，未防『新 AK+旧 secret』）。",
    "fix": "若 patch.accessKeyId 非空且其 trim 值与 prevSecret.accessKeyId 不同、而 patch.accessKeySecret 缺席，则按 SECRET_MISSING 拒绝（要求成对重填），或强制二者成对提交。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-hosting-service.js",
    "line": "200",
    "verdict": "CONFIRMED",
    "summary": "SECRET_MISSING 以 {issues: []} 抛出，被 toIpcError 的 Array.isArray([]) 真值判据送进 VALIDATION_ERROR 分支，envelope.code 语义与注释意图不符",
    "failure_scenario": "saveHosting 在『无旧凭证且未带 secret』时 throw err(SECRET_MISSING, ..., { issues: [] })。toIpcError（ipc-handlers/podcast.js:52-54）判 `const issues = Array.isArray(err.issues)?err.issues:null` 得 []，`if ([ ])` 为真（空数组 truthy）→ 返回 { code: EC.VALIDATION_ERROR, subCode:'PODCAST_HOSTING_SECRET_MISSING' }。代码注释（service:160-163）明确想让它与『字段不合格』区分开，实际却标成了校验类；因渲染层只用 subCode 取文案（usePodcastHosting.js:63），用户无感知，但 envelope.code 在语义上是错值。",
    "fix": "SECRET_MISSING 不带 issues 抛出，或将 toIpcError 判据改为 `Array.isArray(issues) && issues.length`。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-hosting-service.js",
    "line": "274-282",
    "verdict": "CONFIRMED",
    "summary": "回滚点内容是『本次新建 feed』而非『上次成功 feed』：buildFeed 先覆写本地 feed.xml，copyFileSync 复制的是当前产物，本地 feed.prev.xml 恒等于本次内容",
    "failure_scenario": "首次发布后（feed.prev.xml=v1，OSS feed.<ts1>.xml=v1），用户删一期再发布：buildFeed 覆写本地 feed.xml=v2 → copyFileSync(v2→feed.prev.xml)＝ 本地 prev 变 v2，上一版 v1 从本地 prev 丢失。真正的上一版只以首次发布留下的 OSS 孤儿副本 feed.<ts1>.xml 残存（每次发布各留一个、永不清理，会随发布次数累积）。与发布函数头部注释『主键写坏就没有任何一份「上次成功的 feed」可退』的表述不符——本地 prev 从不是上一版。",
    "fix": "若要把 feed.prev.xml 当上一版，应在发布结束（成功）后用【本次已成功发布】的 feed 覆盖 prev，或在 buildFeed 前先复制旧文件；否则删掉误导性注释、把 OSS 时间戳副本的孤儿清理纳入对账。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-hosting-service.js",
    "line": "287-295",
    "verdict": "CONFIRMED",
    "summary": "主键 PUT 失败后 writeFeedSync 若抛错（channel.json 损坏/锁超时），{state:'failed'} 结果对象被吞，调用方只得到 REQUEST_ERROR，上传 code/status 不可见",
    "failure_scenario": "主上传返回 403 → 进入失败分支 → channelPublishPass.run(id, () => svc.writeFeedSync(...))。若此时 channel.json 损坏或 index 锁超时，writeFeedSync 抛 STORE_CORRUPT/LOCK_WAIT_TIMEOUT，异常向上冒泡取代预期返回的 { state:'failed', code, status }，IPC 给渲染层回 REQUEST_ERROR+subCode=PODCAST_STORE_CORRUPT，『公网未更新、可重试』的失败形状丢失。",
    "fix": "把失败态写 feedSync 包一层 try/catch，写失败只记 warn，仍返回 { state:'failed', code, status, feedSync:null }。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-hosting-upload.js",
    "line": "71-74",
    "verdict": "CONFIRMED",
    "summary": "pathPrefix 校验仅对 .. / . / 前导斜杠出声拒绝，空格等字符仍被 persist 层 normalizePathPrefix 静默改写为 '-'，与注释『不得静默改路径』立场边界不一致",
    "failure_scenario": "用户填 pathPrefix='a/b c'：validateHosting 不触发 PREFIX_UNSAFE（无 .. / 前导斜杠）→ 通过；persist 层 normalizePathPrefix 把该段改成 'a/b-c'。用户感知的填值与真正生效的发布路径又不一致——正是本段注释声称要避免的『悄悄改掉你的发布路径』，只是对空格/特殊字符合法化。本逻辑与 normalizePathPrefix 属合理的『输入层拒 / 落盘层兜底』双层，不算重复职责（评审点 5 结论），但双层边界不完全对齐。",
    "fix": "要么把特殊字符也纳入出声拒绝，要么在 UI 提示『前缀中的空格/特殊字符会被清洗』并回显清洗后的结果。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-hosting-service.js",
    "line": "216-239",
    "verdict": "CONFIRMED",
    "summary": "checkHosting 用 PUT 写固定对象 <prefix>/probe.txt，若 bucket 既有该路径对象会被覆写；探测应尽量无副作用",
    "failure_scenario": "用户 bucket 下已有名为 podcast/probe.txt 的对象（或目录），点击『检查』会以 body='probe' 覆写该对象。探测本意只验证凭证/可达，却产生真实写入副作用。",
    "fix": "改用 HEAD 探测或使用带随机/探测语义的 keyservice。"
  }
]
```

**对 5 个审查点的明确结论（附逐条对照）：**

1. **saveHosting 凭证合并语义**（service 165-212）：缺席=沿用、clearSecret 删、空值 trim 后视为缺席、crypto 失败不 await index 前抛 CRYPTO_UNAVAILABLE、owner=null fail-closed —— 这五条**均正确**，且测试齐全。唯一缺口是**新 AK + 旧 secret 错配**（上方 Warning #1），属「半新半旧」同类但未覆盖。

2. **publishFeed 先建回滚点再覆盖主键 + 失败形状**：顺序正确、回滚失败不阻断、PUT 失败返回 clean `{state:'failed',code,status}`、成功写 success、finally 恒释放忙标记。唯一语义是**回滚点装的其实是本次产物**（Info #3）。

3. **putObject 读流 error 监听 + 2xx 不掩盖读体失败**：`stream.on('error')` 记账、2xx 仍查 streamError 抛 BODY_READ_FAILED、finally destroy —— **实现正确且与 spec 场景逐条吻合**（上传后文件删除的迟到 open 被吸收不崩、请求中读体失败不会被 2xx 掩盖）。

4. **ipc-handlers 4 条新通道 + subCode 透传**：hosting:get/save/check + feed:publish 全为 `guarded` 字面量注册，preload 桥接 3 处（源码 + 两个 bundle）对齐，contract 测试已更新为 17 条，subCode 经 preload unwrap → composable `res.subCode→code` → locale 文案链路成立。**一致，无漏**。唯一瑕疵是 SECRET_MISSING 的 `issues:[]` 让 toIpcError 归错分支（Info #2）。

5. **validateHosting 的 pathPrefix 拒绝 vs normalizePathPrefix 职责**：**不重复**。validateHosting 是输入层「出声拒绝」，normalizePathPrefix 是落盘层「清洗兜底」，两处职责不同且注释明确说过故意不做第二份静默改写。唯一问题是两层的拒绝边界不完全对齐（空格等字符仍被静默改写，Info #5）。

未发现 Critical 级别的 fail-open / secret 泄漏 / 主键覆盖失控：上传异常消息只含状态码、index.json 只存 ref 与掩码、渲染层 secret 只在表单 ref 且返回即清空、手势 owner=null 全链路 fail-closed。

---
SESSION_ID: 85dc8181-6796-48c2-86a3-9e24dd9f3be9
