---
record: risk-batch3
task: 第三批同型风险锁：R7（mime↔后缀单一真源 + 独立映射表结构锁）+ R11（模块级状态只增审计面）+ 兑现共享 mask/FN 库抽取承诺（code-mask.js）+ EverOS/gstack/仓内三层记忆沉淀 + 文档同步
date: 2026-10-17
branch: risk-batch3
---

## 本次执行记录：同型风险第三批（risk-batch3，2026-10-17）

- 保留门禁：QM-1 打包 **N/A**（image-mime 进 shared-utils 但仅新增数据模块，未改 `apps/desktop/electron/` 既有代码逻辑——4 个消费文件的映射来源替换见下）｜ 行数门禁 ✅ ｜ 品牌残留 ✅ ｜ 远程同步 PASS（c8a3ea408e320f694b7d5767be62db25773d1535）

### 做了什么（三件事）

**① R7：mime↔后缀单一真源 + 结构锁**（竞品 X-C2：选 JPG 下载内容却是 PNG）

抽表前实测：同一张 mime↔ext 映射在仓内有 **5 处独立字面量**（cover-cropper / media-downloader /
story2video-media-server / prompt-eval-engine / api-publish-engine media-fetch）。

- **真源**：`packages/shared-utils/src/image-mime.js`（⚠ 位置是实测决策：`scripts/` 不进 asar，
  运行时 require 会 ENOENT；shared-utils 进 workspace 与打包）。
  语义与四份历史表对账：`.jpg`/`.jpeg` 同 mime；mime→ext **确定性归一 `.jpg`**
  （fromEntries 后写胜出会让 `.jpeg` 覆盖 `.jpg` —— 夹具当场抓出，改为 reduce 保留首条）；
  未知格式返回 null **不猜**。
- **迁移 4 文件**（桌面链，行为等价）：cover-cropper（mimeMap→extToMime，未知格式分支不变）、
  story2video-media-server（图片条目 spread 真源，audio/video/gif 保留本表）、
  media-downloader（整表换真源 + 保留非规范兼容条目 `image/jpg`——真实平台回包出现过，删了会落 `.bin`）、
  prompt-eval/engine（图片三族换真源 + 保留 gif/bmp 扩展格式）。
- **架构豁免 1 文件**：`api-publish-engine/src/publish/media-fetch.js` —— 该包是
  「可独立打包的零 workspace 依赖运行时」（category-resolver.js 头注释的约束），**不能** require shared-utils；
  显式登记进 R7 豁免清单（写明理由与 fail-closed 失效模式），不是漏改。
- **结构锁**：`R7-independent-mime-map` —— 同对象字面量内同时出现 `image/jpeg` 与 `.jpg`/`.png` 对
  ⇒ 红（`image/jpg` 非规范兼容条目单独出现不算信号）。
- **行为锁**：`scripts/image-mime.test.js` 6 例（映射正确性 / 大小写 / 往返归一 / 不猜纪律 / dataUrl / 四表对账）。

**② R11：模块级状态只增审计面**（竞品 X-8 型：分页单例 itemHeights 只增不清）

形状 = 模块顶层 `new Map()/Set()` + 有 `.set/.add` + 无 `.delete/.clear` ⇒ **出声不拦截**
（R5 同款纪律：宽判据假阳多）。真实仓 11 个模块级集合，2 条出声：
`notify.js` 的 `rateBuckets`（限流桶，语义即只增按 key 覆盖）、`window.js` 的 `_completedIpcRegistrars`
（幂等登记，防重复注册）—— 都是有意的只增语义，出声逼作者写理由注释。
**实现期自纠**：tail 范围最初传 `matchBrace`（从声明尾 `)` 配对 ⇒ 把下一个函数体当范围，把后面的 delete 全截掉），
夹具当场红 —— 改为「声明到文件尾」（模块级集合天然服务全文件）。

**③ 兑现共享库承诺**：`scripts/lib/code-mask.js`（maskNonCode 统一 API `strings:'mask'|'keep'` + matchBrace）。
两批旧模块换**薄包装**（旧选项签名不动），**16+14 例基线零改动**全绿；
等价性取证先于抽库（行为 10/10 夹具 + matchBrace 逐字节相同），等价性本身落成 3 条测试锁。

### 落地文件

| 文件 | 性质 |
| --- | --- |
| `packages/shared-utils/src/image-mime.js` | 新增（真源，进 asar）|
| `scripts/lib/image-mime.js` | 新增（re-export 桥）|
| `scripts/lib/code-mask.js` | 新增（共享屏蔽/配对）|
| `scripts/lib/same-type-risk-locks-r3.js` | 新增（R7/R11 扫描器）|
| `scripts/image-mime.test.js` / `scripts/same-type-risk-locks-r3.test.js` | 新增（6 + 13 例）|
| `scripts/lib/same-type-risk-locks.js` / `-r2.js` | 改（薄包装切共享库）|
| `apps/desktop/electron/services/cover-cropper.js` 等 4 文件 | 改（映射来源替换）|
| `scripts/check-same-type-risk-locks.js` | 改（八锁汇总）|
| `.github/workflows/quality-gate.yml` | 改（Gate 2c6 加 r3 + image-mime 测试）|

### 实测终态

```
扫描 2877 文件：R7 对象=71,333 独立映射=0 ｜ R11 模块级集合=11 有写无清=2（出声）
PASS（八条锁全部通过：L1-L4 + R5/R9a + R7/R11）
测试：16 + 14 + 13 + 6 = 49 例全绿
```

### 开发期被自己抓住的错（5 处，全部夹具/门禁当场红）

1. **薄包装重名**：`const { matchBrace } = require(...)` + `function matchBrace` 同名声明 ⇒ SyntaxError；去掉重复声明直接复用。
2. **真源归一失败**：`Object.fromEntries` 后写胜出，`MIME_TO_EXT['image/jpeg']` 被 `.jpeg` 覆盖 ⇒ 往返断言红；改 reduce 保留首条。
3. **R7 侦察漏了 2 个文件**：只 grep `new Map/Set` 没覆盖「对象字面量映射表」⇒ 真实仓首扫 9 处命中（含 story2video-media-server、media-fetch 两张此前未知的表）—— **锁比侦察强**正是它的价值。
4. **R11 tail 范围错**：matchBrace 从声明尾 `)` 配对 ⇒ delete 被截掉（误报写清完整为只写）；改声明到文件尾。
5. **scripts/ 不进 asar**：真源第一版放 `scripts/lib/` 会让运行时 require ENOENT —— 迁移前用 `apps/desktop/package.json` 的 `files` 字段证实，改放 shared-utils。这条避免了「本地全绿、打包后 Cannot find module」的第 5 次同族事故。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 未改 `apps/desktop/electron/` 代码逻辑；映射来源替换的 4 文件不在 electron-builder 增量风险面（数据来源等价替换，行为锁 + 既有链路测试覆盖）|
| QM-2 代码必检项 | ✅ | 新模块纯数据/纯函数；require 路径已核（shared-utils 在 asar node_modules 内）；无同步 CPU 密集、无网络、无写盘 |
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | 见下 | diff > 200 行 ⇒ dual，走引擎 |
| 远程同步 | PASS | PR #3845 已合并，merge SHA c8a3ea408e320f694b7d5767be62db25773d1535（2026-10-17 22:06 +08:00）|

### 未闭合（不假装已闭合）

| # | 项 |
| --- | --- |
| 1 | R7 判据只认对象字面量形态；`new Map([['.jpg','image/jpeg'],…])` 数组构造形态不覆盖 |
| 2 | R11 只看「有无 delete/clear」；「有 clear 但从不调用」的形态不覆盖（需调用图）|
| 3 | api-publish-engine 的映射表是**架构豁免**而非消除 —— 该包解除零依赖约束时应回迁真源 |
| 4 | 12 类中剩余 R5 可见面 4 条 finally 外复位、R8（await 无兜底）、R10（隐式全局，ESLint 已覆盖）未加锁/未复核 |
| 5 | code-mask 的 regex-literal 形态（`/regex/` 中的引号）仍按普通字符处理，未复现问题但未覆盖 |
