# PR-3b · F-J 资产导入（写路径）· 方案

> 决策层对抗评审 **13 轮**（累计 **103 条**意见，**已逐条落地**；逐条理由与处置见同目录 `pr3b-import-review-record.md`）⇒ 本文件是**决策清单**，不是散文。
>
> **图例**：`§` = 小节 ｜ `⓪`–`⑥` = 换入顺序的步骤 ｜ `S0`–`S20` = 安全清单条目（`S0` = fail-closed 总则） ｜ `A`/`B` 组 = 验收判据分组 ｜ `reason` = 失败原因枚举。
> 每条决策的**理由与逐条处置**见 `pr3b-import-review-record.md`；**契约正文**（白名单/枚举/审计/恢复）写进 `film-kit/SCHEMA.md`（**本批待写入**，不是既有契约；与代码同 PR 落地）。
> worktree `film-kit-import`（非 C 盘）。依据：`tasks.md` PR-3b 段 + `design.md` D19（写路径单独一批）。

## 零、目标与现状

用户可导入**自己的一份**完整影视工程资产，之后「自动」标签的规划基于**用户的资产**而非随包 min 版。
现状（已核实）：资产随包写死在 `electron/film-kit/`；`userData/film-kit`（回退链首级）**存在但永远为空** —— 产品里**没有任何入口**往里写。
**为何单独一批**（D19）：导入是**写路径**，PR-3 整批是**只读**接线，混批会让安全判据互相干扰。

## 一、流程与边界

| 段 | 做什么 | 用现成的什么 |
|----|--------|--------------|
| ① 选目录 | IPC 层 `await dialog.showOpenDialog({properties:['openDirectory']})`；返回路径须 `fs.stat().isDirectory()` | 先例 `ipc-handlers/pipeline.js` 的 `story2video:pick-batch-files`（`dialog` 由 `deps` 注入、运行时兜底 `require('electron').dialog`；`dialogApi` 可注入 ⇒ 可测；**mock 接口契约**：`{ canceled: boolean, filePaths: string[] }`，实现写在 `kit-import.js` 注释里供测试照抄） |
| ② 严格校验 | 源目录上 `loadFilmKit({kitDir, requireAssets:true})` | `kit-loader.js` 里 `loadFilmKit` 的 `requireAssets` 开关（其注释明说「导入校验」用它） |
| ③ 原子落盘 | 两遍扫描（S6）→ 拷到 `film-kit.staging-<ts>` → 再校验 staging → 目录级换入（§二） | `auto-project.js` 的「原子写（.tmp+rename）」是**单文件**；kit 是**目录** ⇒ 需目录级 |
| ④ 失效缓存 | 置「导入中」标记 → 清 service 缓存 → 成功后删标记 | `_kit`/`_shotLibrary`/`_scriptAdapter` 是 `film-engineering-service.js` 的**实例字段** |

**边界（写死）**：① `dialog` 在 **IPC 层**，service 只收 kitDir 字符串，不碰 Electron UI 原语；② 导入通道沿用 `withSenderCheck`（仓内 IPC 信任边界 = `app://localhost` 或 app 目录内 `file://`，**不按视图限定**）⇒ 窗口级/组件级授权的处置**只在 §四 取舍③ 一处说**（此处不重复）；本批做法 = **写审计日志**（含 sender 路由，S20 **只做审计增强、不作拒绝依据**）+ §一 边界① 的「**目录只能由用户原生选**」；⚠ **触发导入 ≠ 完成导入**：目录**只能由用户在原生对话框里选**（**renderer 无法传路径**）⇒ 任意可信渲染进程最多**弹一次选目录框**，无法指定替换内容；③ 取消 ⇒ `{cancelled:true, reason:'CANCELLED'}`，**不写、不清缓存、不写审计**（取消发生在 ⓪ 之前 ⇒ 锁尚未建）；**取消域（写死）**：取消**只发生在进入 ⓪ 之前**（此时**无锁**、无任何写操作）⇒ 取消路径不需要清锁；**⓪ 内部四步（严格校验 → 审计预检 → 审计落「开始」行 → 预创建锁）是一个不可分割的原子块**，一旦进入 ⓪ 即**没有取消通道**（无 abort token、无取消消息）⇒ 导入进行中**不可中止**；⓪ 之后若因**异常**中止 ⇒ `finally` **删锁 + 删 staging**（兜底）。**导入进行中不可中止**（无 abort token、无取消通道）⇒ `SCHEMA.md` 明写这一点（用户要中止只能等它结束或删锁自愈）—— ⇒ **用户可见**：i18n `filmKitImporting` 的文案**必须写明「导入进行中不可中断，请勿关闭应用」** + 中断后的恢复说明（删 `userData/.import-lock`）；`SCHEMA.md` 写**最长等待量级**（上限 256 MB ⇒ 本地磁盘拷贝**秒级到分钟级**）与**手动恢复步骤**。**UI 层约束（写死）**：点导入 ⇒ ① 入口按钮**禁用** + **模态**「导入进行中，不可中断」（模态**不提供取消**）⇒ ② 导入结束（成功/失败/取消）⇒ 关模态、恢复按钮。

## 二、换入顺序（写死，逐段断言）

```
⓪ 预检与校验（**只读源目录，不碰旧 kit**）：⓪a 严格校验源目录 → ⓪b 审计文件**可创建/可写** → ⓪c 审计落「开始」行 → ⓪d 预创建 userData/.import-lock
    （任一步失败即退出，**不碰旧 kit**；审计写失败 ⇒ 不建锁）
① 置「导入中」标记（**内存态**；落盘态已在 ⓪d 建好 ⇒ 二者合一 = 完整标记）
② 清 service 缓存（_kit / _shotLibrary / _scriptAdapter）
③ rename 旧 film-kit → film-kit.bak-<ts>
④ rename film-kit.staging-<ts> → film-kit        ← 原子（同卷）
⑤ 删 film-kit.bak-<ts>
⑥ 删「导入中」标记（内存 + .import-lock）    ← 锁最后删（崩在 ⑤-⑥ 间时锁仍在 ⇒ 状态可辨）
```

**两次校验**：⓪ 之内先在**源目录**上跑一次严格校验（`loadFilmKit({kitDir, requireAssets:true})`），④ 换入之前在 **staging** 上再跑一次（同一严格模式）——**两次都通过**才允许换入；任一次失败 ⇒ 不碰旧 kit（staging 由 `finally` 清）。

**标记的真源 = `.import-lock`（落盘）**：内存标记只是**加速判据** ⇒ **进程重启后 service 初始化读到锁 ⇒ 重建内存标记**（⇒ 不会「重启 ⇒ 标记丢失 ⇒ 静默回落随包 kit」）；S11 的「不读盘」判据**只认锁文件**。

`staging`/`.bak`/`.import-lock` 与 `film-kit` **同父目录**（同卷 ⇒ rename 原子）。

**Windows（主战场 win32）**：① rename 一个**已存在**的目录会失败（`EEXIST`/`EPERM`）⇒ 必须 ③④ 两步；② `ERROR_ACCESS_DENIED`（被占用：杀毒/索引器/编辑器暂存/他进程持句柄）**可重试**（上限/间隔见 S19），仍失败 ⇒ **保留 `.bak`** + 报错带出恢复路径；③ 同卷 rename 才原子。

**回滚分档**：⓪/② 前失败 ⇒ 清 staging、旧 kit 未动；**③ 失败**（旧 kit rename 不成）⇒ 旧 kit **仍在原处**、staging 清掉、锁删 ⇒ 旧 kit 未动；③ 后（④ 失败）⇒ `.bak` 改回 `film-kit` + 删 staging；**回滚也失败** ⇒ `.bak` **保留不删** + 报错写明「旧资产在 `<路径>`，请手动恢复」（i18n `filmKitImportRecover`）；⑤ 失败 ⇒ 不影响生效，提示残留。
**staging 兜底**：**任何**异常（含两遍扫描中断、原子拷贝中断）⇒ 服务层 `finally` **递归删 staging** ⇒ 磁盘上不留半份 staging。

## 三、安全清单（每条 = 一个可断言的决定）

| # | 决定 |
|---|------|
| S0 | **总则（fail-closed）**：凡**白名单内条目**的输入（形状/内容/大小/路径/类型）+ 目标父目录的权限/状态，不满足本清单任一条 ⇒ **一律拒绝**并映射到 `reason` 枚举 —— **不逐项开特例**。⇒ 后续新增的边界情况默认走这条，**不新增规则**（新增规则 = 新增不变量 = 新可挑面）。⚠ **白名单外的条目不适用本总则**（它们**不拷入**，不是「不合格」） |
| S1 | **只拷白名单列出的路径**：扫描时枚举源目录，**白名单外的条目一律不拷入、也不递归进入其子目录**（如 `extra/`、`.git/` 整目录跳过）⇒ **不因多余文件拒绝整次导入**（用户目录里常有无关文件）；**白名单内**条目的形状/内容规则（S2/S10/S13）不满足 ⇒ **一律拒绝**（fail-closed） |
| S2 | **链与越界（判据分级）** —— **可靠（fail-closed）**：① `lstat().isSymbolicLink()` ⇒ 拒（软链不跟随）；② `isSymbolicLink()` 为真但 `stat` 失败 ⇒ **断链** ⇒ 拒；③ `fs.realpath` 取真实路径，断言**仍在源目录内**（`realpath` 对断链/无权限抛 ENOENT/EPERM ⇒ **必须 try/catch** ⇒ 映射 `SYMLINK_REJECTED`/`VALIDATION_ERROR`）。**硬链**：④ **同目录内**对非软链做 **`(dev, ino)` 去重** ⇒ 同 inode ⇒ 拒（**这条与 `nlink` 无关，在任何文件系统上成立**）—— **跨目录**硬链只能靠 `nlink > 1` ⇒ **最佳努力**（FAT/exFAT/网络盘 `nlink` 恒 1 ⇒ 漏判方向是「接纳」）⇒ `SCHEMA.md` 明写「硬链检测为**最佳努力，不构成防篡改边界**」⇒ **不列入 fail-closed 断言**（另：硬链只防**误含**，本机主人对目标文件本就有读权限）。⚠ 上述 `stat`/`realpath` **全部在第一遍扫描内完成**（拷贝之前）⇒ 断链/越界在**一个字节都没写**时就被拒 |
| S3 | 半份 kit 不留：失败 ⇒ staging 不存在、旧 kit 逐字未变 |
| S4 | 失败回滚；**回滚也失败 ⇒ `.bak` 保留不删** + 报错带出恢复路径（旧资产不丢） |
| S5 | 只写 `userData/film-kit` 及其同父的 staging/.bak/.import-lock（断言没有对这三者之外的路径写入） |
| S6 | **两遍扫描 + 逐文件哈希对账**：第一遍 `lstat` 全量算大小与形状 + **内容哈希（SHA-256）** ⇒ 不合格立即拒、**一个字节都不写**；第二遍拷贝到 staging 时**同步算副本哈希** ⇒ 拷完比对 **副本哈希 == 第一遍源哈希** ⇒ 不一致 ⇒ 拒（`VALIDATION_ERROR`）⇒ 杜绝「扫描后被**原地改内容**（同尺寸）」与「拷贝过程中被改」两类 TOCTOU（⚠ 只比 `ino`/`size` **挡不住**原地改内容）；另比对 `ino`/`size`：**软链已在 S2 全部拒掉** ⇒ 这里对**非软链**文件用 **`stat`（跟随）** 取目标 inode ⇒ 目标在两遍间被换成同尺寸文件也**挡得住**；⚠ 对**软链**用 `lstat` 只看得到链接自身、察觉不到目标被换 —— 故软链不能靠这道判据兜底，必须在 S2 就拒 |
| S7 | 不写 kit 之外的用户数据（同 S5） |
| S8 | 严格模式失败 ⇒ 一律不落盘（`userData/film-kit` 不存在，原存在的也不变） |
| S9 | 相对路径越界（**两步互补**）：① `path.isAbsolute(rel)` ⇒ 拒（绝对路径**不进入**第二步，`path.resolve` 会忽略 `stagingRoot`）；② 对**非绝对**的 `rel` 用 `core/ipc-security.js` 已有的 `isPathInside(stagingRoot, path.resolve(stagingRoot, rel))` 判（`path.relative` 口径天然处理 `\`/`/` 归一化） |
| S10 | 固定深度 + 拒绝隐藏名 + 限制扩展名（**只作用于白名单内条目**）：`prompts/tasks/` 只允许固定 3 层（**基准 = 相对 `prompts/` 根**：`prompts/tasks/<task>/<lang>/<file>` 恰 3 层，`prompts/tasks/A.md` 少一层 ⇒ **拒**）；**候选路径的任何组件（目录或文件）以 `.` 开头 ⇒ 拒**；扩展名须在允许集内（`{json,md}`） |
| S11 | 导入中 ⇒ service 不从磁盘重读 kit：标记 = 内存标志 **+ `userData/.import-lock` 落盘文件**（**真源 = 锁文件**；内存标志只是加速判据，**进程重启时按锁重建内存标志**）；`_ensureKit()` 见标记 ⇒ **抛可识别错误、不读盘** ⇒ 绝不静默回落到随包 kit |
| S12 | 缓存失效在 rename 之前；标记**先置后删**、与 `.import-lock` 同生命周期；**锁最后删** |
| S13 | 文件头魔数：`*.json` 头须 `{`/`[`（去 BOM/空白）⇒ 不匹配即拒、**不写盘** |
| S14 | 上限常量与 `reason` 枚举**单一定义**：常量在 `kit-import.js` 顶部**导出**（`MAX_KIT_FILE_BYTES`/`MAX_KIT_TOTAL_BYTES`）⇒ 测试与 `SCHEMA.md` 同名导入断言（数值只在代码里存在一次） |
| S15 | **崩溃/失败残留的三档状态**进 `SCHEMA.md`（**全部走显式手动恢复，无自动清理**）：① `film-kit` **缺失**、`.bak` = 旧 kit（崩在 ③ 后 ④ 前）⇒ **必须手动 rename 恢复**；② `film-kit` = 新的、`.bak` = 旧 kit（崩在 ④ 后 ⑤ 前，**或 ⑤ 删 `.bak` 本身失败**）⇒ 可安全删 `.bak`；③ `film-kit` = 新的、无 `.bak`、只剩锁（崩在 ⑤ 后 ⑥ 前，**或 ⑥ 删锁本身失败**）⇒ 只需删锁。⇒ 三档**覆盖全部失败点**（含各步自身失败） |
| S16 | 第 0 步预检与校验（**全程只读源目录**，= §二 ⓪a-⓪d）：① 严格校验源目录（`loadFilmKit({kitDir, requireAssets:true})`）→ ② 审计文件可创建/可写（判**父目录**可写）→ ③ 审计落「开始」行 → ④ 预创建锁文件；任一步失败 ⇒ 立即退出、**绝不动旧 kit** |
| S17 | **审计契约**进 `SCHEMA.md`：文件 `userData/film-kit-import.log`、字段（时间/sender URL/**sender 路由**/**触发组件**（renderer 传入 ⇒ **可伪造**，仅作事后线索，**不作判据**）/所选目录/结果/reason/**`post_check`**（PASS / FAIL_WITH_RECOVERY）/`.bak` 保留时**必带恢复路径**）、**行格式**（UTC ISO8601 时间戳 + 制表符分隔 + UTF-8 + `\n` 换行 ⇒ `SCHEMA.md` 给一行**示例行**供测试断言）、写入时机（**每次 IPC 调用后**，成功与失败都写）、保留（单文件追加；**> 10,000 行或 > 10 MB ⇒ 拒绝新的导入**（**不再追加**，防静默超限）+ i18n `filmKitImportAuditFull` 提示手动轮转；**不自动截断**——自动截断会丢审计）、**写入失败 ⇒ 拒绝导入**（审计不可静默丢失）、权限断言（可追加、不可改写）、追加方式（`fs.open({flags:'a'})`；**互斥由 `.import-lock` 的独占创建（`wx` 标志）实现** —— 第二个导入进程建锁失败 ⇒ 直接拒（`LOCK_CREATE_FAILED`）⇒ 天然不会行间交错；同一时刻**只允许一个导入**）—— ⚠ **诚实边界**：本机主人**能改自己的文件** ⇒ 审计防的是「**静默**」，**不防恶意篡改**，不假装它是防篡改日志 |
| S18 | **锁与审计的落盘顺序闭合**（= §二 ⓪ 的同一条顺序，不另起一套）：① 审计文件**预检可创建/可写**（⚠ `fs.access` 对**不存在**的文件返回 **ENOENT** ⇒ 预检要判**父目录**可写；**首次导入时审计文件不存在是合法的**（ENOENT ⇒ 视为「可创建」）；② 审计落「开始」行；③ 预创建锁；④ **审计写失败 ⇒ 立即退出、不创建锁、不碰旧 kit**（S17 的「写失败即拒」在此落地）⇒ 不出现「锁在、审计无」的不可恢复态。**锁不做自动清理**：`.import-lock` 存在（**不论新旧**）⇒ service 抛**可识别错误**、导入也**拒绝** ⇒ 恢复靠用户按 i18n 步骤**手动删锁**（错误信息带锁路径与锁年龄）；⚠ 删锁前必须确认**没有导入在进行**（否则可能读到半换入的 kit） |
| S19 | `ERROR_ACCESS_DENIED` 的**重试上限与间隔**：导出 `RETRY_MAX` / `RETRY_MS`（3 次 / 500 ms **基数**），退避 = `RETRY_MS * 2^(n-1)`（500 ms / 1 s / 2 s ⇒ 3 次总等待 ≤ 3.5 s）；**适用操作**：目录级 `rename`（旧 kit→`.bak`、`staging`→`film-kit`、回滚改名）与文件 `copyFile`；**审计追加不重试**（失败即拒）；`SCHEMA.md` 写同一组值 |
| S20 | **sender 路由只做审计增强（不作为拒绝依据）**：`film-engineering:import-kit` 把 `event.senderFrame.url` 及其 **hash 路由段**（本仓是 `createWebHashHistory` ⇒ 路由在 `#` 之后，`pathname` 恒为 `/`）写进**审计行** ⇒ 事后可查「谁在什么路由上触发的导入」；⚠ **不据此拒绝**：SPA 同一文档承载 `auto`/`canvas`/`classic` 三个标签页 ⇒ 路由**无法区分组件**（同一路由下任意组件都能触发）⇒ 拿它做安全拒绝会**误伤合法调用**、也挡不住同一文档内的注入 ⇒ **真正的屏障是原生对话框**（目录**只能由用户选**，renderer 不能传路径）+ 严格校验 + 全量审计 |

## 四、白名单：真源、形状、内容

**唯一真源 = 代码里的机器可读白名单**（`kit-import.js` 导出）；`film-kit/SCHEMA.md` 的「文件清单」表**新增一列「导入白名单」**（`images/*` 等无消费方资产标 ❌）⇒ 它是白名单的**人读镜像**（镜像只比对标 ✅ 的行） ⇒ 两者**逐行 `===` 相等由测试断言**，**并且**加一个**断言脚本** `apps/desktop/electron/services/film-engineering/kit-mirror-check.js`（导出 `verifyKitMirror()`：读 `kit-import.js` 的白名单导出 + 解析 `apps/desktop/electron/film-kit/SCHEMA.md` 的「文件清单」表 ⇒ 排序后逐行比对）+ 用例 `kit-mirror-check.test.js`（同目录、同 vitest 框架 ⇒ **随桌面端测试套件在 CI 自动执行**，不是未交付的幻影依赖）⇒ 漂移在 CI 就红；⚠ `SCHEMA.md` **首行明写「本文件不用于运行时解析」** —— 运行时代码**禁止**解析它做判据；**执行顺序**：`SCHEMA.md` 是**提交进仓的普通文件**（**不是生成物**）⇒ `kit-mirror-check.test.js` 直接读仓内已存在的它 ⇒ CI「检出 ⇒ 跑测试」顺序天然成立，**不存在「先生成后校验」两步**；⚠ 「不用于运行时解析」约束的是**运行时代码**，而 `kit-mirror-check.js` / `kit-schema-contract.test.js` 是**构建期/测试期工具**（不在运行路径上）⇒ **不违反**该声明。

| 类别 | 文件 | 必填 | 形状/内容 |
|------|------|------|----------|
| 核心 4 件 | `film-manifest.json` / `shot-library.json` / `reference-registry.json` / `prompt-doctrine.json` | ✅ | 根 `.json` |
| v7 增强 4 件 | `shot-grammar.json` / `compliance-checklist.json` / `palette.json` / `prompts/tasks/**` | 严格模式下 ✅ | 根 `.json`×3；任务库固定 3 层、`.md` |
| 可选 1 类 | `prompt-doctrine.zh.md` | ❌（要拷，但**可选**） | `.md` |

**两条已核实的事实**：① `images/`（11 文件）**目前无任何代码消费**（全仓非注释命中 0）⇒ **移出首批导入白名单**（不拷、不校验、不进镜像表）—— 随包 kit 里的 `images/` **不受影响**（那是打包资产，不是导入契约）；**不引入 `images-manifest.json` 契约**（无消费方 ⇒ 契约零价值却带来镜像解析依赖）⇒ 将来若引入消费方，另开切片把它连同 manifest **一起加回**白名单；`SCHEMA.md` 与 `kit-import.js` 注释都**显式写**「`images/` 目前无消费方 ⇒ 不在导入白名单内」，并在 `kit-import.js` 头部留 **TODO(images-consumption)** 指向 `SCHEMA.md` 的说明小节（要有可追踪凭据，否则会被误当成 bug）；② `shot-library.json`/`reference-registry.json` 的媒体路径指向 **kit 之外**的媒体产物目录 ⇒ 不在白名单内、导入**不**碰。


**祖父条款**：限额**只约束源目录**（用户选的那份）；**目标**目录里的既有资产**不参与**限额判定（它在成功时就被整体替换 ⇒ 不存在「目标超限」的场景）——否则用户**重导入自己的资产**时会被自己的旧资产限死。

**三处取舍写进 `SCHEMA.md`**（防被误读为遗漏）：① `nlink > 1` **一律拒绝**是设计选择（不做跨目录 inode/dev 对比）；② `.bak` 残留的两种恢复路径（S15）；③ **窗口级写限制是后续切片** —— 本批只做 `withSenderCheck` + **审计（含 sender 路由）**，**不**假装已有视图级/组件级授权；**不**引入「路由不匹配即拒绝」的硬断言（S20 已给出理由：同一文档承载三标签页，路由判不出组件 ⇒ 只会误伤合法调用）。缓解三层（受信来源 / **目录只能由用户原生选**（renderer 不能传路径 ⇒ 任意可信渲染进程最多弹一次选目录框）/ 严格校验不落盘 + 全量审计），信任域内的越权**由审计可见**。

## 五、失败原因枚举与 i18n

`reason` 闭集（服务端只回这些值，枚举写在 `SCHEMA.md`，**测试可逐个断言**）：
`VALIDATION_ERROR` / `NOT_A_DIRECTORY` / `PATH_ESCAPE` / `SYMLINK_REJECTED` / `HARDLINK_REJECTED` /
`HIDDEN_NAME_REJECTED` / `EXT_NOT_ALLOWED` / `MAGIC_MISMATCH` / `SIZE_EXCEEDED` / `PARENT_NOT_WRITABLE` /
`LOCK_CREATE_FAILED` / `SWAP_FAILED` / `ROLLBACK_FAILED` / `CANCELLED`（**14 值**）。

i18n 键（`filmEngineering.auto.*`，zh/en 成对，**共 11 键**）：`filmKitImport`（入口）/ `filmKitImportHint`（说明会替换当前资产）/
`filmKitImporting`（**必须写明「不可中断」+ 中断自愈**）/ `filmKitImportSuccess`（带镜数/场景数占位）/ `filmKitImportFailed`（带 `reason` 占位）/
`filmKitImportCancelled`（取消**不**算失败）/ `filmKitImportRecover`（回滚也失败的兜底，带 `.bak` 路径占位）/
`filmKitImportRecoverLock`（**存在未完成的导入** ⇒ 手动删 `userData/.import-lock` 的步骤 + 锁路径与年龄）/ `filmKitImportRecoverMissing`（**崩在 ③ 后④ 前**：`film-kit` 缺失 ⇒ 手动 rename `.bak` 恢复）/ `filmKitImportRecoverBak`（**有锁 + `.bak` 残留**：`film-kit` 已是新的 ⇒ 可安全删 `.bak`）/
`filmKitImportAuditFull`（审计日志已满 ⇒ 请手动轮转）。**文案全文写进 PRD §9.c**（方案只定键与语义，不定文案）。

## 六、验收判据（TDD-RED，`kit-import.test.js`）

**A 组（原 `tasks.md` 4 条）**：① 严格模式校验失败 ⇒ 不落盘；② 成功 ⇒ `userData/film-kit` 齐备 + service 缓存已失效；③ 含符号链接 ⇒ 拒；④ 换入中途失败 ⇒ 无半份 kit、旧 kit 逐字未变。

**B 组（新增 17 条）**：⑤ 白名单外文件不被拷入；⑥ 超限 ⇒ 拒且未开始拷；⑦ 没写到 staging/.bak/.import-lock 之外；⑧ 换入失败后旧 kit 逐字未变；⑨ 相对路径越界或绝对路径 ⇒ 拒、没写到 staging 之外；⑩ 硬链接 ⇒ 拒（**同目录内 `(dev,ino)` 相同** ⇒ 拒；**跨目录**硬链依赖 `nlink>1` ⇒ 在 `nlink` 不可靠的文件系统上是**最佳努力**，不构成防篡改保证）；⑪ 隐藏名（含**目录名**）或 `prompts/tasks/` 深度不符 ⇒ 拒；⑫ 回滚本身失败 ⇒ `.bak` 仍在 + 报错带出恢复路径；⑬ 导入中 `_ensureKit()` 抛可识别错误、不读盘，标记先置后删且 `.import-lock` 同生命周期；⑭ 代码白名单集合 == `SCHEMA.md` 文件清单表解析集合（排序后逐行 `===`）；⑮ `.json` 魔数不匹配 ⇒ 拒且不写盘；⑯ 父目录不可写或锁文件建不出来 ⇒ 立即退出、旧 kit 逐字未动；⑰ **存在 `.import-lock` ⇒ service 抛可识别错误、不读盘；导入也拒绝**（**不自动清锁**）⇒ 恢复靠用户按 i18n 步骤手动删锁（错误信息带锁路径与年龄）；⑱ **`images/` 不在导入白名单** ⇒ 目标目录里**没有** `images/`（镜像表里也没有 `images/*` 行）；⑲ **可选资产缺失（`prompt-doctrine.zh.md` 不存在）⇒ 导入照常成功**；⑳ **sender URL 与其 hash 路由段写入审计行**（S20；**不作为拒绝依据**）；㉑ **第二遍拷出的副本哈希 == 第一遍源哈希** ⇒ 不一致即拒（**TOCTOU 反证用例**：拷贝前把源文件**原地改成同尺寸内容** ⇒ 必须被拒）。

**win32 专项**：① 硬链判定在 win32 上的语义要有覆盖断言：**(dev,ino) 同目录去重**（**可靠**，任何文件系统都成立）+ `nlink>1`（**最佳努力**，文件系统不维护时漏判方向是「接纳」⇒ 已在 `SCHEMA.md` 声明，不作防篡改保证）；② NTFS 的 `.` / `..` **不得**被当成合法目录项（`lstat` 的 `isDirectory()` 对它们为真 ⇒ 靠**路径片段**判别，不靠 `isDirectory()`）；③ `ERROR_ACCESS_DENIED` 的重试上限/间隔要断言（≤ `RETRY_MAX`）。

## 七、落点

| 层 | 文件 |
|----|------|
| 服务（新建） | `services/film-engineering/kit-import.js`（核心：拷贝 + 校验 + 换入 + 回滚 + 锁 + 审计；fs/dialog/时钟全部可注入 ⇒ 可测；顶部导出 `MAX_KIT_*`/`RETRY_*`；头部写「`images/` 目前无消费方」+ TODO） |
| 服务（改） | `film-engineering-service.js`（缓存失效方法 + 读 `.import-lock` + **有锁时抛可识别错误**；⚠ 失效必须**同时重置 `_kit`/`_loadError`/`_shotLibrary`/`_scriptAdapter` 四个字段** —— `_loadError` 是**失败缓存**，漏重置会让旧失败永久存活） |
| IPC（**新建**） | `ipc-handlers/film-engineering-import.js`（注册 `film-engineering:import-kit`：`withSenderCheck` + 入参校验 + `isDirectory` + 审计 + dialog 在这一层；⚠ **不塞进 `film-engineering-auto.js`** —— 该文件已 **446 行**、`check-max-lines` 硬限 **500**，再加就撞线；写路径与只读分文件也与 D19 同向）+ `ipc-handlers/index.js`（多一行 `require` 接线） |
| preload / 渲染端 | `preload/access-control.js` + `preload/film-engineering.js`（通道 + API）/ `src/api/electron-bridge.js` + **`src/views/FilmEngineeringView.vue`（「**项目案例**」标签顶部入口 —— ⚠ **不是** `film-auto/FilmAutoPanel.vue`：那是「自动」标签的**只读规划区**，写操作不入只读区，见 §一 边界②） |
| i18n / 测试 / 文档 | `locales/film-engineering/{zh,en}.js`（§五 11 键）/ `kit-import.test.js`（§六 A/B 组 21 条 + win32 专项 3 条）/ `kit-mirror-check.js` + `kit-mirror-check.test.js`（白名单镜像断言，§四）/ `kit-schema-contract.test.js`（**第二道自动化断言**：解析 `SCHEMA.md` ⇒ 断言「审计字段」「`reason` 枚举」「恢复路径小节」三处存在且非空）/ `film-kit/SCHEMA.md`（**本批待写入**：导入契约 —— 白名单/形状/魔数/枚举/审计/恢复/取舍/祖父条款）+ `PRD-FILM-PIPELINE-V2`（§9.c）+ 本文件 + `tasks.md` + 执行记录 |

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
