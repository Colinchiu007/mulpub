# PR-3b · F-J 资产导入（写路径）· 方案

> 决策层对抗评审 4 轮（16+8 条已落地），逐条处置见 `pr3b-import-review-record.md`。
> 本文件只出方案，**不含运行时代码**。worktree：`film-kit-import`（非 C 盘）。依据：`tasks.md` PR-3b 段 + `design.md` D19。

## 零、目标与现状

**目标**：用户可导入**自己的一份**完整影视工程资产，之后「自动」标签的规划基于**用户的资产**而非随包 min 版。

**现状（已核实）**：资产随包写死在 `electron/film-kit/`；`userData/film-kit`（回退链首级）**存在但永远为空** —— 产品里**没有任何入口**往里写。

**为何单独一批**（D19）：导入是**写路径**，PR-3 整批是**只读**接线；混批会让安全判据互相干扰。

## 一、流程

| 段 | 做什么 | 用现成的什么 |
|----|--------|--------------|
| ① 选目录 | `dialog.showOpenDialog({properties:['openDirectory']})`；返回路径须 `fs.stat().isDirectory()` | 先例：`ipc-handlers/pipeline.js` 的 `story2video:pick-batch-files`（`dialogApi` 可注入 ⇒ 可测） |
| ② 严格校验 | 源目录上跑 `loadFilmKit({kitDir, requireAssets:true})` | 已存在：`kit-loader.js` 里 `loadFilmKit` 的 `requireAssets` 开关（其注释明说「导入校验」用它） |
| ③ 原子落盘 | 两遍扫描（§三 S6）→ 拷到 `film-kit.staging-<ts>` → 再校验 staging → 目录级换入（§二） | 原子写先例：`auto-project.js` 的「原子写（.tmp+rename）」是**单文件**；kit 是**目录** ⇒ 需目录级 |
| ④ 失效缓存 | 先置「导入中」标记 → 清 service 缓存 → 换入成功后删标记 | `_kit`/`_shotLibrary`/`_scriptAdapter` 是 `film-engineering-service.js` 的**实例字段** |

**架构边界（写死）**：① `dialog` 在 **IPC 层**（`ipc-handlers/`），**service 只收已选定的 kitDir 字符串**，不碰 Electron `dialog`；
② 导入通道沿用 `withSenderCheck`（**已核实**的仓内 IPC 信任边界 = `app://localhost` 或 app 目录内 `file://`，**不按视图限定**）⇒ 本批**不引入窗口级限定**（另开切片），改为**写审计日志**（时间/sender/目录/结果），边界写进 `SCHEMA.md`。

## 二、换入顺序（写死，逐段断言）

```
⓪ 预检：userData 可写 + 预创建 userData/.import-lock   （失败即退出，不碰旧 kit）
① 置「导入中」标记（内存 + .import-lock 文件）
② 清 service 缓存（_kit / _shotLibrary / _scriptAdapter）
③ rename 旧 film-kit → film-kit.bak-<ts>
④ rename film-kit.staging-<ts> → film-kit        ← 原子（同卷）
⑤ 删「导入中」标记（内存 + .import-lock 文件）
⑥ 删 film-kit.bak-<ts>
```

`staging`/`.bak`/`.import-lock` 与 `film-kit` **同父目录**（同卷 ⇒ rename 原子）。任一步失败 ⇒ §二末的回滚分支。

**Windows 语义（主战场是 win32）**：① rename 一个**已存在**的目录会失败（`EEXIST`/`EPERM`）⇒ 必须 ③④ 两步；② `ERROR_ACCESS_DENIED`（被占用：杀毒/索引器/编辑器暂存/他进程持句柄）**可重试**，仍失败则**保留 `.bak`** + 报错带出恢复路径；③ 同卷 rename 才原子。

**回滚分支**：⓪/② 之前失败 ⇒ 清 staging、旧 kit 未动；③ 之后（④ 失败）⇒ `.bak` 改回 `film-kit` + 删 staging；**回滚也失败** ⇒ `.bak` **保留不删** + 报错写明「旧资产在 `<路径>`，请手动恢复」（i18n `filmKitImportRecover`）；⑥ 失败 ⇒ 不影响生效，提示残留。

**`.bak` 去留（已拍板）**：成功路径**立即删**（⑥），不留历史（保留历史需定义「几份/何时清理/回退入口」，是另一个功能）；**回滚也失败时必须留**（最后一道保险）。

## 三、写路径安全清单

| # | 约束（含判定要点；对应判据见 §六） |
|---|------|
| S1 | 只拷白名单文件（不递归拷贝未知文件） |
| S2 | 不跟随符号链接（`lstat().isSymbolicLink()` ⇒ 拒）、不接受硬链接（`stats.nlink > 1` ⇒ 拒） |
| S3 | 半份 kit 不留：失败 ⇒ staging 不存在、旧 kit 逐字未变 |
| S4 | 失败回滚；**回滚也失败 ⇒ `.bak` 保留不删** + 报错带出恢复路径（旧资产不丢） |
| S5 | 只写 `userData/film-kit` 及其同父的 staging/.bak/.import-lock（断言没有对这三者之外的路径写入） |
| S6 | **两遍扫描**：第一遍 `lstat` 全量算大小与形状（超限/软链/硬链/隐藏名/超深/扩展名/魔数）⇒ 不合格立即拒、**一个字节都不写**；第二遍才写 |
| S7 | 不写 kit 之外的用户数据（同 S5） |
| S8 | 严格模式失败 ⇒ 一律不落盘（`userData/film-kit` 不存在，原存在的也不变） |
| S9 | 相对路径越界：`path.isAbsolute(rel)` ⇒ 拒；再用 `core/ipc-security.js` 已有的 `isPathInside(stagingRoot, path.resolve(stagingRoot, rel))` 判（`path.relative` 口径天然处理 `\`/`/` 归一化）⇒ 拒 |
| S10 | 固定深度 + 拒绝隐藏名 + 限制扩展名：`images/` 只允许深度 1（白名单写 `images/*`，不递归）；`prompts/tasks/` 只允许固定 3 层；**任何路径组件（目录或文件）以 `.` 开头 ⇒ 拒**；扩展名须在允许集内（根文件与任务库 `{json,md}`；`images/` `{webp,json}`） |
| S11 | 导入中 ⇒ service 不得从磁盘重读 kit：标记 = 内存标志 **+ `userData/.import-lock` 落盘文件**（重启/服务重建不丢，service 初始化时读它）；`_ensureKit()` 见标记 ⇒ **抛可识别错误、不读盘** ⇒ 绝不静默回落到随包 kit |
| S12 | 缓存失效在 rename 之前；标记**先置后删**且与 `.import-lock` 同生命周期、与 `.bak` 状态对齐 |
| S13 | 二进制资产做文件头魔数校验：`*.webp` 头须 `RIFF….WEBP`、`*.json` 头须 `{`/`[`（去 BOM/空白）⇒ 不匹配即拒、**不写盘**（防多态文件/注入内容进 userData） |
| S14 | 上限常量与 `reason` 枚举单一定义：常量在 `kit-import.js` 顶部**导出**（`MAX_KIT_FILE_BYTES`/`MAX_KIT_TOTAL_BYTES`）⇒ 测试与方案引用**同一源**；`SCHEMA.md` 记录数值与复核机制 |
| S15 | `.bak` 残留的手动恢复说明进 `SCHEMA.md`（「`.bak` 存在且 `film-kit` 完整 ⇒ 可安全删；`.bak` 存在且 `film-kit` 缺失 ⇒ 手动 rename 恢复」——⑤-⑥ 间崩溃会留下这种状态） |
| S16 | 第 0 步预检父目录可写 + 预创建锁文件：`fs.access(userData, W_OK)` + 预创建 `.import-lock`；失败 ⇒ 立即退出、**绝不动旧 kit**（否则中途崩溃后连锁与回滚日志都写不下） |

## 四、白名单：真源、形状、内容

**真源** = `film-kit/SCHEMA.md` 的「文件清单」表（核心 4 件 + v7 增强 4 件 + 可选 2 类）。导入代码维护一份**机器可读**白名单，
**测试断言两个集合排序后逐行 `===` 相等**（防各自漂移）。

| 类别 | 文件 | 必填 | 形状/内容 |
|------|------|------|----------|
| 核心 4 件 | `film-manifest.json` / `shot-library.json` / `reference-registry.json` / `prompt-doctrine.json` | ✅ | 根 `.json` |
| v7 增强 4 件 | `shot-grammar.json` / `compliance-checklist.json` / `palette.json` / `prompts/tasks/**` | 严格模式下 ✅ | 根 `.json`×3；任务库固定 3 层、`.md` |
| 可选 2 类 | `prompt-doctrine.zh.md` / `images/*` | ❌（但要拷） | `.md`；`images/` 单层：`.webp` + `images-manifest.json`（`.json`） |

**两条已核实的事实**：① `images/`（11 文件）**目前无任何代码消费**（全仓非注释命中 0，仅 `kit-loader.js` 文件头注释提到它）
⇒ 要拷（契约完整性），但**只做魔数校验**、不做语义校验，且**必须在 `SCHEMA.md` 与 `kit-import.js` 注释里写明「`images/` 目前无消费方」**（否则会被误当成 bug）；
② `shot-library.json`/`reference-registry.json` 的媒体路径指向 **kit 之外**的媒体产物目录 ⇒ 不在白名单内、导入**不**碰。

**两处取舍要写进 `SCHEMA.md`**（避免被误读为遗漏）：① `nlink > 1` **一律拒绝**是**设计选择**（**不做**跨目录 inode/dev 对比，故同卷多目录硬链也会被拒）；
② `.bak` 残留的手动恢复路径（S15）。

## 五、失败原因枚举与 i18n

`reason` 闭集（服务端只回这些值，枚举写在 `SCHEMA.md`，**测试可逐个断言**）：
`VALIDATION_ERROR` / `NOT_A_DIRECTORY` / `PATH_ESCAPE` / `SYMLINK_REJECTED` / `HARDLINK_REJECTED` /
`HIDDEN_NAME_REJECTED` / `EXT_NOT_ALLOWED` / `MAGIC_MISMATCH` / `SIZE_EXCEEDED` / `PARENT_NOT_WRITABLE` /
`LOCK_CREATE_FAILED` / `SWAP_FAILED` / `ROLLBACK_FAILED` / `CANCELLED`。

i18n 键（`filmEngineering.auto.*`，zh/en 成对）：`filmKitImport`（入口）/ `filmKitImportHint`（说明会替换当前资产）/
`filmKitImporting` / `filmKitImportSuccess`（带镜数/场景数占位）/ `filmKitImportFailed`（带 `reason` 占位）/
`filmKitImportCancelled`（取消**不**算失败）/ `filmKitImportRecover`（回滚也失败的兜底，带 `.bak` 路径占位）。
`reason` 必须是服务端回传的具体原因（不写「导入失败，请重试」这种无信息文案）。

## 六、验收判据（TDD-RED，`kit-import.test.js`）

**A 组（原 `tasks.md` 4 条）**：① 严格模式校验失败 ⇒ 不落盘；② 成功 ⇒ `userData/film-kit` 齐备 + service 缓存已失效；
③ 源目录含符号链接 ⇒ 拒；④ 换入中途失败 ⇒ 无半份 kit、旧 kit 逐字未变。

**B 组（新增 12 条）**：⑤ 白名单外的文件不被拷入；⑥ 超限 ⇒ 拒且未开始拷；⑦ 没写到 staging/.bak/.import-lock 之外；
⑧ 换入失败后旧 kit 逐字未变；⑨ 相对路径越界或绝对路径 ⇒ 拒、没写到 staging 之外；⑩ 硬链接 ⇒ 拒；
⑪ 隐藏名（含**目录名**）或 `images/` 超深 ⇒ 拒；⑫ 回滚本身失败 ⇒ `.bak` 仍在 + 报错带出恢复路径；
⑬ 导入中 `_ensureKit()` 抛可识别错误、不读盘，标记先置后删且 `.import-lock` 同生命周期；⑭ 代码白名单集合 == `SCHEMA.md` 文件清单表解析集合（排序后逐行 `===`）；⑮ `.webp`/`.json` 魔数不匹配 ⇒ 拒且不写盘；⑯ 父目录不可写或锁文件建不出来 ⇒ 立即退出、旧 kit 逐字未动。

## 七、落点

| 层 | 文件 | 性质 |
|----|------|------|
| 服务（新建） | `services/film-engineering/kit-import.js` | 核心（拷贝 + 校验 + 换入 + 回滚 + 锁文件）；**fs/dialog/时钟全部可注入** ⇒ 可测；顶部**导出** `MAX_KIT_*`（S14）；文件头写「`images/` 目前无消费方」 |
| 服务（改） | `film-engineering-service.js` | 加缓存失效方法 + 读 `.import-lock` |
| IPC（改） | `ipc-handlers/film-engineering-auto.js` | 注册 `film-engineering:import-kit`（`withSenderCheck` + 入参校验 + `isDirectory` 校验 + 审计日志）；**dialog 在这一层** |
| preload（改） | `preload/access-control.js` + `preload/film-engineering.js` | 通道白名单 + API 构造 |
| 渲染端（改） | `src/api/electron-bridge.js` + `src/views/film-auto/FilmAutoPanel.vue` | 桥接 + 「项目案例」顶部入口 |
| i18n（改） | `locales/film-engineering/{zh,en}.js` | §五 7 键，成对 |
| 测试（新建） | `services/film-engineering/kit-import.test.js` | §六 16 条判据 |
| 文档（改） | `film-kit/SCHEMA.md`（**导入契约**小节，内容见 §四/§五/§六/§七）、`PRD-FILM-PIPELINE-V2`（§9.c）、本文件、`tasks.md`、执行记录 | 同步 |

## 八、明确不做

❌ 增量/合并（整体替换）· ❌ 导入历史/多版本 · ❌ 导出 · ❌ 压缩包/下载/扫盘（来源只有本机目录）· ❌ 写 kit 之外的路径 · ❌ 把 `images/` 变成消费方

## 九、决策点（全部已拍板，无开放项）

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| 1 | 成功后 `.bak` 去留 | **立即删**；**回滚也失败时保留** | 「原子落盘」纪律的延续 |
| 2 | 大小上限 | 单文件 **32 MB** / 总量 **256 MB** | 实测随包 kit 36 文件 / **2.848 MB**，最大单文件 `shot-library.json` **2.530 MB** ⇒ 12.6× / 90× 余量（随包是 min 版，完整库更大） |
| 3 | UI 入口位置 | **「项目案例」标签顶部** | 那里是**看**资产的地方，导入是同一件事的另一半；「自动」标签是**消费**资产的地方，写操作放进去会让只读区混入写操作 |

## 十、许可与来源

本批**不引入第三方代码/资产**：只读写用户提供的目录 + 复用仓内 `kit-loader`/`kit-asset-validators`/`film-engineering-service`；
导入**不搬运**研究项目的任何文件。仓内既有代码沿用原仓许可；`SCHEMA.md` 与 `film-kit/**` 是本仓自有资产。
