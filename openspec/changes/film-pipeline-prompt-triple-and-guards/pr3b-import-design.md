# PR-3b · F-J 资产导入（写路径）· 方案

> 决策层对抗评审 **13 轮**（累计 **103 条**意见，**已逐条落地**；逐条理由与处置见同目录 `pr3b-import-review-record.md`）⇒ 本文件是**决策清单**，不是散文。
>
> **图例**：`§` = 小节 ｜ `⓪`–`⑥` = 换入顺序的步骤 ｜ `S0`–`S19` = 安全清单条目（`S0` = fail-closed 总则） ｜ `A`/`B` 组 = 验收判据分组 ｜ `reason` = 失败原因枚举。
> 每条决策的**理由与逐条处置**见 `pr3b-import-review-record.md`；**契约正文**（白名单/枚举/审计/恢复）写进 `film-kit/SCHEMA.md`（**本批待写入**，不是既有契约；与代码同 PR 落地）。
> worktree `film-kit-import`（非 C 盘）。依据：`tasks.md` PR-3b 段 + `design.md` D19（写路径单独一批）。

## 零、目标与现状

用户可导入**自己的一份**完整影视工程资产，之后「自动」标签的规划基于**用户的资产**而非随包 min 版。
现状（已核实）：资产随包写死在 `electron/film-kit/`；`userData/film-kit`（回退链首级）**存在但永远为空** —— 产品里**没有任何入口**往里写。
**为何单独一批**（D19）：导入是**写路径**，PR-3 整批是**只读**接线，混批会让安全判据互相干扰。

## 一、流程与边界

| 段 | 做什么 | 用现成的什么 |
|----|--------|--------------|
| ① 选目录 | IPC 层 `await dialog.showOpenDialog({properties:['openDirectory']})`；返回路径须 `fs.stat().isDirectory()` | 先例 `ipc-handlers/pipeline.js` 的 `story2video:pick-batch-files`（`dialogApi` 可注入 ⇒ 可测；**mock 接口契约**：`{ canceled: boolean, filePaths: string[] }`，实现写在 `kit-import.js` 注释里供测试照抄） |
| ② 严格校验 | 源目录上 `loadFilmKit({kitDir, requireAssets:true})` | `kit-loader.js` 里 `loadFilmKit` 的 `requireAssets` 开关（其注释明说「导入校验」用它） |
| ③ 原子落盘 | 两遍扫描（S6）→ 拷到 `film-kit.staging-<ts>` → 再校验 staging → 目录级换入（§二） | `auto-project.js` 的「原子写（.tmp+rename）」是**单文件**；kit 是**目录** ⇒ 需目录级 |
| ④ 失效缓存 | 置「导入中」标记 → 清 service 缓存 → 成功后删标记 | `_kit`/`_shotLibrary`/`_scriptAdapter` 是 `film-engineering-service.js` 的**实例字段** |

**边界（写死）**：① `dialog` 在 **IPC 层**，service 只收 kitDir 字符串，不碰 Electron UI 原语；② 导入通道沿用 `withSenderCheck`（仓内 IPC 信任边界 = `app://localhost` 或 app 目录内 `file://`，**不按视图限定**）⇒ 本批**不引入窗口级限定**（另开切片），改为**写审计日志**，该边界写进 `SCHEMA.md`；③ 取消 ⇒ `{cancelled:true, reason:'CANCELLED'}`，**不写、不清缓存、不写审计**（取消发生在 ⓪ 之前 ⇒ 锁尚未建）；**取消域（写死）**：取消**只发生在进入 ⓪ 之前**（此时**无锁**、无任何写操作）⇒ 取消路径不需要清锁；**⓪ 内部三步（审计预检 → 审计落「开始」行 → 预创建锁）是一个不可分割的原子块**，一旦进入 ⓪ 即**没有取消通道**（无 abort token、无取消消息）⇒ 导入进行中**不可中止**；⓪ 之后若因**异常**中止 ⇒ `finally` **删锁 + 删 staging**（兜底）。**导入进行中不可中止**（无 abort token、无取消通道）⇒ `SCHEMA.md` 明写这一点（用户要中止只能等它结束或删锁自愈）。

## 二、换入顺序（写死，逐段断言）

```
⓪ 预检：① 审计文件**可创建/可写** → ② 审计落「开始」行 → ③ 预创建 userData/.import-lock
    （任一步失败即退出，**不碰旧 kit**；审计写失败 ⇒ 不建锁）
① 置「导入中」标记（内存 + .import-lock）
② 清 service 缓存（_kit / _shotLibrary / _scriptAdapter）
③ rename 旧 film-kit → film-kit.bak-<ts>
④ rename film-kit.staging-<ts> → film-kit        ← 原子（同卷）
⑤ 删 film-kit.bak-<ts>
⑥ 删「导入中」标记（内存 + .import-lock）    ← 锁最后删（崩在 ⑤-⑥ 间时锁仍在 ⇒ 状态可辨）
```

**两次校验**：⓪ 之内先在**源目录**上跑一次严格校验（`loadFilmKit({kitDir, requireAssets:true})`），④ 换入之前在 **staging** 上再跑一次（同一严格模式）——**两次都通过**才允许换入；任一次失败 ⇒ 不碰旧 kit（staging 由 `finally` 清）。

`staging`/`.bak`/`.import-lock` 与 `film-kit` **同父目录**（同卷 ⇒ rename 原子）。

**Windows（主战场 win32）**：① rename 一个**已存在**的目录会失败（`EEXIST`/`EPERM`）⇒ 必须 ③④ 两步；② `ERROR_ACCESS_DENIED`（被占用：杀毒/索引器/编辑器暂存/他进程持句柄）**可重试**（上限/间隔见 S19），仍失败 ⇒ **保留 `.bak`** + 报错带出恢复路径；③ 同卷 rename 才原子。

**回滚分档**：⓪/② 前失败 ⇒ 清 staging、旧 kit 未动；**③ 失败**（旧 kit rename 不成）⇒ 旧 kit **仍在原处**、staging 清掉、锁删 ⇒ 旧 kit 未动；③ 后（④ 失败）⇒ `.bak` 改回 `film-kit` + 删 staging；**回滚也失败** ⇒ `.bak` **保留不删** + 报错写明「旧资产在 `<路径>`，请手动恢复」（i18n `filmKitImportRecover`）；⑤ 失败 ⇒ 不影响生效，提示残留。
**staging 兜底**：**任何**异常（含两遍扫描中断、原子拷贝中断）⇒ 服务层 `finally` **递归删 staging** ⇒ 磁盘上不留半份 staging。

## 三、安全清单（每条 = 一个可断言的决定）

| # | 决定 |
|---|------|
| S0 | **总则（fail-closed）**：凡本次导入的**输入**（源目录的形状/内容/大小/路径/类型 + 目标父目录的权限/状态）不满足本清单任一条 ⇒ **一律拒绝**并映射到 `reason` 枚举 —— **不逐项开特例**。⇒ 后续新增的边界情况默认走这条，**不新增规则**（新增规则 = 新增不变量 = 新可挑面） |
| S1 | 只拷白名单文件（不递归拷贝未知文件） |
| S2 | 不跟随软链（`lstat().isSymbolicLink()` ⇒ 拒）、不接受硬链（**`stat` 跟随**取目标 inode 的 `nlink > 1` ⇒ 拒；⚠ `lstat` 对软链返回链接本身的 stat，nlink 恒 1；**同目录内的合法硬链也一律拒** —— ⚠ **口径更正（不得再声称「软链与硬链同时被覆盖」）**：`realpath` 只解决**软链越界**（断链 / 指向源目录外），**看不见硬链**（硬链路径本身就在源目录内，`realpath` 返回的就是它）⇒ **硬链只由 `nlink > 1` 覆盖**；`nlink` 由文件系统维护（win32/NTFS 准确；FAT/exFAT/网络盘可能恒为 1 ⇒ **漏判方向是「接纳」**）⇒ 故它是**最佳努力**判据、**不是安全边界**（本机主人对目标文件本来就有读权限，恶意方可直接复制）⇒ `SCHEMA.md` 写明「win32 硬链检测为**最佳努力**，不构成防篡改保证」；每个待拷文件 ① 先 `lstat` 判**断链**（`isSymbolicLink()` 为真但 `stat` 失败 ⇒ 断链 ⇒ **直接拒**）；② 再用 `fs.realpath` 取**真实路径**，断言它**仍在源目录内**（**只覆盖软链**）—— ⚠ `realpath` 对断链/无权限会抛 **ENOENT/EPERM** ⇒ **必须 try/catch**，统一映射为 `SYMLINK_REJECTED` / `VALIDATION_ERROR`（不能让它变成未分类异常）；⚠ 这些 `stat`/`realpath` 调用**全部在第一遍扫描内完成**（**拷贝之前**）⇒ 断链/无权限在**一个字节都没写**时就被拒） |
| S3 | 半份 kit 不留：失败 ⇒ staging 不存在、旧 kit 逐字未变 |
| S4 | 失败回滚；**回滚也失败 ⇒ `.bak` 保留不删** + 报错带出恢复路径（旧资产不丢） |
| S5 | 只写 `userData/film-kit` 及其同父的 staging/.bak/.import-lock（断言没有对这三者之外的路径写入） |
| S6 | **两遍扫描**：第一遍 `lstat` 全量算大小与形状 ⇒ 不合格立即拒、**一个字节都不写**；第二遍才写（第二遍写入前比对第一次扫描记下的 `ino`/`size`：**软链已在 S2 全部拒掉** ⇒ 这里对**非软链**文件用 **`stat`（跟随）** 取目标 inode ⇒ 目标在两遍间被换成同尺寸文件也**挡得住**；⚠ 对**软链**用 `lstat` 只看得到链接自身、察觉不到目标被换 —— 故软链不能靠这道判据兜底，必须在 S2 就拒） |
| S7 | 不写 kit 之外的用户数据（同 S5） |
| S8 | 严格模式失败 ⇒ 一律不落盘（`userData/film-kit` 不存在，原存在的也不变） |
| S9 | 相对路径越界（**两步互补**）：① `path.isAbsolute(rel)` ⇒ 拒（绝对路径**不进入**第二步，`path.resolve` 会忽略 `stagingRoot`）；② 对**非绝对**的 `rel` 用 `core/ipc-security.js` 已有的 `isPathInside(stagingRoot, path.resolve(stagingRoot, rel))` 判（`path.relative` 口径天然处理 `\`/`/` 归一化） |
| S10 | 固定深度 + 拒绝隐藏名 + 限制扩展名：`images/` 只允许深度 1（白名单写 `images/*`，不递归）；`prompts/tasks/` 只允许固定 3 层（**基准 = 相对 `prompts/` 根**：`prompts/tasks/<task>/<lang>/<file>` 恰 3 层，`prompts/tasks/A.md` 这种少一层的**拒**）；**任何路径组件（目录或文件）以 `.` 开头 ⇒ 拒**；扩展名须在允许集内（根文件与任务库 `{json,md}`；`images/` `{webp,json}`） |
| S11 | 导入中 ⇒ service 不从磁盘重读 kit：标记 = 内存标志 **+ `userData/.import-lock` 落盘文件**（service 初始化时读它）；`_ensureKit()` 见标记 ⇒ **抛可识别错误、不读盘** ⇒ 绝不静默回落到随包 kit |
| S12 | 缓存失效在 rename 之前；标记**先置后删**、与 `.import-lock` 同生命周期；**锁最后删** |
| S13 | 文件头魔数：`*.webp` 头须 `RIFF….WEBP`、`*.json` 头须 `{`/`[`（去 BOM/空白）⇒ 不匹配即拒、**不写盘** |
| S14 | 上限常量与 `reason` 枚举**单一定义**：常量在 `kit-import.js` 顶部**导出**（`MAX_KIT_FILE_BYTES`/`MAX_KIT_TOTAL_BYTES`）⇒ 测试与 `SCHEMA.md` 同名导入断言（数值只在代码里存在一次） |
| S15 | **三种崩溃残留状态**的恢复说明进 `SCHEMA.md`：① 崩在 ③ 后 ④ 前 ⇒ `film-kit` **缺失**、`.bak` = 旧 kit ⇒ **必须手动 rename 恢复**（自动路径不碰）；② 崩在 ④ 后 ⑤ 前 ⇒ `film-kit` = 新的、`.bak` = 旧 kit ⇒ 可安全删 `.bak`；③ 崩在 ⑤ 后 ⑥ 前 ⇒ `.bak` 已删、只剩锁 ⇒ 只需删锁（**只有这一档**满足 S18 的自动自愈前置断言） |
| S16 | 第 0 步预检与校验（**全程只读源目录**）：① 严格校验源目录（`loadFilmKit({kitDir, requireAssets:true})`）→ ② 父目录可写 → ③ 预创建锁文件；任一步失败 ⇒ 立即退出、**绝不动旧 kit** |
| S17 | **审计契约**进 `SCHEMA.md`：文件 `userData/film-kit-import.log`、字段（时间/sender URL/所选目录/结果/reason，`.bak` 保留时**必带恢复路径**）、**行格式**（UTC ISO8601 时间戳 + 制表符分隔 + UTF-8 + `\n` 换行 ⇒ `SCHEMA.md` 给一行**示例行**供测试断言）、写入时机（**每次 IPC 调用后**，成功与失败都写）、保留（单文件追加；**> 10,000 行或 > 10 MB 时手动轮转**——不自动截断，自动截断会丢审计；轮转是**运维约定**）、**写入失败 ⇒ 拒绝导入**（审计不可静默丢失）、权限断言（可追加、不可改写）、追加方式（`fs.open({flags:'a'})` + **进程级互斥** ⇒ 并发导入不会行间交错；同一时刻**只允许一个导入**）—— ⚠ **诚实边界**：本机主人**能改自己的文件** ⇒ 审计防的是「**静默**」，**不防恶意篡改**，不假装它是防篡改日志 |
| S18 | **锁与审计的落盘顺序闭合**（= §二 ⓪ 的同一条顺序，不另起一套）：① 审计文件**预检可创建/可写**（⚠ `fs.access` 对**不存在**的文件返回 **ENOENT** ⇒ 预检要判**父目录**可写；**首次导入时审计文件不存在是合法的**（ENOENT ⇒ 视为「可创建」）；② 审计落「开始」行；③ 预创建锁；④ **审计写失败 ⇒ 立即退出、不创建锁、不碰旧 kit**（S17 的「写失败即拒」在此落地）⇒ 不出现「锁在、审计无」的不可恢复态；**另含陈旧锁自愈**：service 初始化读到 `.import-lock` 且其 mtime **> 30 分钟** ⇒ 判定为上次崩溃残留 ⇒ **自动清理 + 强制写审计**（否则用户永久卡在「不读盘」且无自助路径）—— ⚠ **自动清理有前置断言**：**`.bak` 不存在 且 `film-kit` 存在**（= 崩在 ⑤ 之后⑥ 之前，唯一「无残留资产」的一档）⇒ 满足才自动清锁；**不满足（`.bak` 残留 / `film-kit` 缺失）⇒ 不自动清锁**，改走**手动恢复路径**（报错带出恢复步骤，i18n `filmKitImportRecover`），避免盲删锁掩盖残留状态；⚠ **新鲜锁（< 30 分钟）同样会挡住下一次导入** ⇒ `SCHEMA.md` 写**手动恢复**：删掉 `userData/.import-lock` 即可（并在 i18n 里给出这句提示 + 导入时若检测到**存在**锁就**明确报「有未完成的导入」**而不是泛化失败） |
| S19 | `ERROR_ACCESS_DENIED` 的**重试上限与间隔**：导出 `RETRY_MAX` / `RETRY_MS`（3 次 / 500 ms），`SCHEMA.md` 写同一组值 |

## 四、白名单：真源、形状、内容

**唯一真源 = 代码里的机器可读白名单**（`kit-import.js` 导出）；`film-kit/SCHEMA.md` 的「文件清单」表是它的**人读镜像** ⇒ 两者**逐行 `===` 相等由测试断言**，**并且**加一个**断言脚本** `apps/desktop/electron/services/film-engineering/kit-mirror-check.js`（导出 `verifyKitMirror()`：读 `kit-import.js` 的白名单导出 + 解析 `apps/desktop/electron/film-kit/SCHEMA.md` 的「文件清单」表 ⇒ 排序后逐行比对）+ 用例 `kit-mirror-check.test.js`（同目录、同 vitest 框架 ⇒ **随桌面端测试套件在 CI 自动执行**，不是未交付的幻影依赖）⇒ 漂移在 CI 就红；⚠ `SCHEMA.md` **首行明写「本文件不用于运行时解析」** —— 运行时代码**禁止**解析它做判据。

| 类别 | 文件 | 必填 | 形状/内容 |
|------|------|------|----------|
| 核心 4 件 | `film-manifest.json` / `shot-library.json` / `reference-registry.json` / `prompt-doctrine.json` | ✅ | 根 `.json` |
| v7 增强 4 件 | `shot-grammar.json` / `compliance-checklist.json` / `palette.json` / `prompts/tasks/**` | 严格模式下 ✅ | 根 `.json`×3；任务库固定 3 层、`.md` |
| 可选 2 类 | `prompt-doctrine.zh.md` / `images/*` | ❌（要拷，但**可选**） | `.md`；`images/` 单层：`.webp` + `images-manifest.json`（`.json`） |

**两条已核实的事实**：① `images/`（11 文件）**目前无任何代码消费**（全仓非注释命中 0）⇒ **要拷**（契约完整性）但**只做魔数校验**、不做语义校验（`images/` **无消费方**这一事实写进 `SCHEMA.md`，避免契约与实现各说各话）；`SCHEMA.md` 的「导入契约」小节里**有一行明写**「`images/` 目前无消费方（仅保留契约完整性）」，`kit-import.js` 注释同样明写，并在 `kit-import.js` 头部留 **TODO(images-consumption)** 指向本文件的 `SCHEMA.md` 小节（要有可追踪凭据，否则会被误当成 bug）；② `shot-library.json`/`reference-registry.json` 的媒体路径指向 **kit 之外**的媒体产物目录 ⇒ 不在白名单内、导入**不**碰。

**`images-manifest.json` 契约（软契约）**：manifest 的键应与 `images/` 内文件**一一对应**；**不一致 ⇒ 只记审计告警、不拒导入**（`images/` 无消费方 ⇒ 其自洽性不影响运行期行为；**拷贝完整性由「两遍扫描 + 逐文件魔数」保证** ⇒ 拷进去的一定是源目录里真实存在且通过校验的文件）；⚠ **manifest 缺失 ⇒ 整个 `images/` 视为不存在**（可选资产缺失**不**拒整次导入）。

**祖父条款**：限额**只约束源目录**（用户选的那份）；**目标**目录里的既有资产**不参与**限额判定（它在成功时就被整体替换 ⇒ 不存在「目标超限」的场景）——否则用户**重导入自己的资产**时会被自己的旧资产限死。

**三处取舍写进 `SCHEMA.md`**（防被误读为遗漏）：① `nlink > 1` **一律拒绝**是设计选择（不做跨目录 inode/dev 对比）；② `.bak` 残留的两种恢复路径（S15）；③ **窗口级写限制是后续切片** —— 本批只做 `withSenderCheck` + 审计，**不**假装已有视图级授权；`SCHEMA.md` 追加 **sender URL 白名单**（实施时从**路由注册表**取影视工程相关路由，不手写字符串）作为过渡；缓解仅三层（受信来源 / 严格校验不落盘 / 全量审计），信任域内的越权**由审计可见**。

## 五、失败原因枚举与 i18n

`reason` 闭集（服务端只回这些值，枚举写在 `SCHEMA.md`，**测试可逐个断言**）：
`VALIDATION_ERROR` / `NOT_A_DIRECTORY` / `PATH_ESCAPE` / `SYMLINK_REJECTED` / `HARDLINK_REJECTED` /
`HIDDEN_NAME_REJECTED` / `EXT_NOT_ALLOWED` / `MAGIC_MISMATCH` / `SIZE_EXCEEDED` / `PARENT_NOT_WRITABLE` /
`LOCK_CREATE_FAILED` / `SWAP_FAILED` / `ROLLBACK_FAILED` / `CANCELLED`。

i18n 键（`filmEngineering.auto.*`，zh/en 成对）：`filmKitImport`（入口）/ `filmKitImportHint`（说明会替换当前资产）/
`filmKitImporting` / `filmKitImportSuccess`（带镜数/场景数占位）/ `filmKitImportFailed`（带 `reason` 占位）/
`filmKitImportCancelled`（取消**不**算失败）/ `filmKitImportRecover`（回滚也失败的兜底，带 `.bak` 路径占位）。

## 六、验收判据（TDD-RED，`kit-import.test.js`）

**A 组（原 `tasks.md` 4 条）**：① 严格模式校验失败 ⇒ 不落盘；② 成功 ⇒ `userData/film-kit` 齐备 + service 缓存已失效；③ 含符号链接 ⇒ 拒；④ 换入中途失败 ⇒ 无半份 kit、旧 kit 逐字未变。

**B 组（新增 15 条）**：⑤ 白名单外文件不被拷入；⑥ 超限 ⇒ 拒且未开始拷；⑦ 没写到 staging/.bak/.import-lock 之外；⑧ 换入失败后旧 kit 逐字未变；⑨ 相对路径越界或绝对路径 ⇒ 拒、没写到 staging 之外；⑩ 硬链接 ⇒ 拒；⑪ 隐藏名（含**目录名**）或 `images/` 超深 ⇒ 拒；⑫ 回滚本身失败 ⇒ `.bak` 仍在 + 报错带出恢复路径；⑬ 导入中 `_ensureKit()` 抛可识别错误、不读盘，标记先置后删且 `.import-lock` 同生命周期；⑭ 代码白名单集合 == `SCHEMA.md` 文件清单表解析集合（排序后逐行 `===`）；⑮ `.webp`/`.json` 魔数不匹配 ⇒ 拒且不写盘；⑯ 父目录不可写或锁文件建不出来 ⇒ 立即退出、旧 kit 逐字未动；⑰ **陈旧锁（>30min）⇒ 自动清理 + 强制写审计**，且不再永久拒读盘 —— 但**仅在 `.bak` 不存在 且 `film-kit` 存在**时自动清；否则走手动恢复路径（不盲删锁）；⑱ **`images-manifest.json` 的键与 `images/` 内文件**一一对应**——**软契约**：不一致 ⇒ **导入仍成功** + 审计日志有对应告警行（多/少都**不拒**）；⑲ **可选资产缺失（`images/` 整个不存在）⇒ 导入照常成功**（可选资产不因缺失而失败）。

**win32 专项**：① 硬链判定在 win32 上的语义（`stat` 跟随 + `nlink>1`）要有覆盖断言（**最佳努力**判据：文件系统不维护 `nlink` 时漏判方向是「接纳」⇒ 已在 `SCHEMA.md` 声明，不作防篡改保证）；② NTFS 的 `.` / `..` **不得**被当成合法目录项（`lstat` 的 `isDirectory()` 对它们为真 ⇒ 靠**路径片段**判别，不靠 `isDirectory()`）；③ `ERROR_ACCESS_DENIED` 的重试上限/间隔要断言（≤ `RETRY_MAX`）。

## 七、落点

| 层 | 文件 |
|----|------|
| 服务（新建） | `services/film-engineering/kit-import.js`（核心：拷贝 + 校验 + 换入 + 回滚 + 锁 + 审计；fs/dialog/时钟全部可注入 ⇒ 可测；顶部导出 `MAX_KIT_*`/`RETRY_*`；头部写「`images/` 目前无消费方」+ TODO） |
| 服务（改） | `film-engineering-service.js`（缓存失效方法 + 读 `.import-lock` + 陈旧锁自愈） |
| IPC（改） | `ipc-handlers/film-engineering-auto.js`（注册 `film-engineering:import-kit`：withSenderCheck + 入参校验 + `isDirectory` + 审计 + dialog 在这一层） |
| preload / 渲染端 | `preload/access-control.js` + `preload/film-engineering.js`（通道 + API）/ `src/api/electron-bridge.js` + **`src/views/FilmEngineeringView.vue`（「**项目案例**」标签顶部入口 —— ⚠ **不是** `film-auto/FilmAutoPanel.vue`：那是「自动」标签的**只读规划区**，写操作不入只读区，见 §一 边界②） |
| i18n / 测试 / 文档 | `locales/film-engineering/{zh,en}.js`（§五 7 键）/ `kit-import.test.js`（§六 A/B 组 19 条 + win32 专项 3 条）/ `kit-mirror-check.js` + `kit-mirror-check.test.js`（白名单镜像断言，§四）/ `film-kit/SCHEMA.md`（**本批待写入**：导入契约 —— 白名单/形状/魔数/枚举/审计/恢复/取舍/祖父条款）+ `PRD-FILM-PIPELINE-V2`（§9.c）+ 本文件 + `tasks.md` + 执行记录 |

## 八、明确不做

❌ 增量/合并（整体替换）· ❌ 导入历史/多版本 · ❌ 导出 · ❌ 压缩包/下载/扫盘（来源只有本机目录）· ❌ 写 kit 之外的路径 · ❌ 把 `images/` 变成消费方

## 九、决策点（全部已拍板，无开放项）

| # | 决策 | 结论 | 依据 |
|---|------|------|------|
| 1 | 成功后 `.bak` 去留 | **立即删**（⑤）；**回滚也失败时保留** | 「原子落盘」纪律的延续 |
| 2 | 大小上限 | 单文件 **32 MB** / 总量 **256 MB** | 实测随包 kit 36 文件 / **2.848 MB**，最大单文件 `shot-library.json` **2.530 MB** ⇒ 12.6× / 90× 余量（随包是 min 版，完整库更大） |
| 3 | UI 入口位置 | **「项目案例」标签顶部**（= `FilmEngineeringView.vue`；**不是** `film-auto/FilmAutoPanel.vue`） | 那里是**看**资产的地方，导入是同一件事的另一半；「自动」标签（`film-auto`）是**消费**资产的地方，写操作放进去会让只读区混入写操作。**已核实**：`FilmEngineeringHubView.vue` 的三标签 = `auto`/`canvas`/`classic`，`classic` 的 i18n 文案正是「项目案例」（`filmEngineering.hub.tabs.classic`，zh/en = 「项目案例」/"Project Cases"），该面板挂 `FilmEngineeringView.vue`；`film-auto/FilmAutoPanel.vue` 挂在 `auto` 面板 ⇒ **决策成立** |

## 十、许可与来源

本批**不引入第三方代码/资产**：只读写用户提供的目录 + 复用仓内 `kit-loader`/`kit-asset-validators`/`film-engineering-service`；导入**不搬运**研究项目的任何文件。仓内既有代码沿用原仓许可；`SCHEMA.md` 与 `film-kit/**` 是本仓自有资产。
