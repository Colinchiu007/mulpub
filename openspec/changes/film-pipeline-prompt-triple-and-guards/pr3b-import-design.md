# PR-3b · F-J 资产导入（写路径）· 方案

> 决策层对抗评审的意见**已逐条落地**（**逐轮原文与处置见同目录 `pr3b-import-critiques.md`**，逐轮叙述见 `pr3b-import-review-record.md`；本文件**不重复轮次与条数**，以免与评审引擎每轮改写的抬头冲突）⇒ 本文件是**决策清单**：每条 = 一个**可断言的决定**；**理由、例外与诚实边界**一律在证据文件里，本文件只留决定本身。
> **图例**：`§` 小节 ｜ `⓪`–`⑦` 换入顺序 ｜ `S0`–`S20` 安全清单 ｜ `A`/`B`/`C` 组 验收判据 ｜ `reason` 失败原因枚举。
> **术语对照**：`⓪`=pre-check（预检）｜ `换入`=swap-in（整体替换目标 kit）｜ `落盘`=persist（写入磁盘）｜ `判据`=assertion（可执行断言）｜ `祖父条款`=limits-apply-to-source-only（限额只管源目录）｜ `残留`=residue（崩溃/失败留下的中间态）。
> 契约正文（白名单/枚举/审计/恢复/取舍）写进 **`film-kit/SCHEMA.md` 这份已存在的文件里新增的「导入契约」小节** —— 文件已存在，**小节**才是本批交付物（实施时写入，与代码**同 PR 同提交** ⇒ 测试运行时该小节必然存在）。
> worktree `film-kit-import`（非 C 盘）。依据：`tasks.md` PR-3b 段 + `design.md` D19（写路径单独一批）。

## 零、目标与现状

用户可导入**自己的一份**完整影视工程资产，之后「自动」标签的规划基于**用户的资产**而非随包 min 版。
现状（已核实）：资产随包写死在 `electron/film-kit/`；`userData/film-kit`（回退链首级）**存在但永远为空** —— 产品里**没有任何入口**往里写。
**为何单独一批**（D19）：导入是**写路径**，PR-3 整批是**只读**接线，混批会让安全判据互相干扰。

## 一、流程与边界

| 段 | 做什么 | 用现成的什么 |
|----|--------|--------------|
| ① 选目录 | IPC 层（**handler 内部**）`await dialog.showOpenDialog({properties:['openDirectory']})`；返回路径须 `fs.stat().isDirectory()` | 先例 `ipc-handlers/pipeline.js` 的 `story2video:pick-batch-files`（`dialog` 由 `deps` 注入、运行时兜底 `require('electron').dialog`；**mock 契约**：`{ canceled: boolean, filePaths: string[] }`，写在 `kit-import.js` 注释里供测试照抄） |
| ② 严格校验 | 源目录上 `loadFilmKit({kitDir, requireAssets:true})` | `kit-loader.js` 里 `loadFilmKit` 的 `requireAssets` 开关（其注释明说「导入校验」用它） |
| ③ 原子落盘 | 两遍扫描（S6）→ 拷到 `film-kit.staging-<ts>` → 再校验 staging → 目录级换入（§二） | `auto-project.js` 的「原子写（.tmp+rename）」是**单文件**；kit 是**目录** ⇒ 需目录级 |
| ④ 失效缓存 | 置「导入中」标记 → 清 service 缓存 → 成功后删标记 | `_kit`/`_loadError`/`_shotLibrary`/`_scriptAdapter` 是 `film-engineering-service.js` 的**实例字段** |

**边界（写死）**

1. **`dialog` 在 IPC 层**，service 只收 kitDir 字符串，不碰 Electron UI 原语。
2. **入参不含路径**：`film-engineering:import-kit` 的**入参为空** ⇒ 路径**只能**来自 handler 内部对话框的返回值 ⇒ renderer 无法指定替换内容（只能触发一次选目录框）；若将来允许 renderer 传路径，则该路径**必过** `isDirectory` + 严格校验（校验不通过即拒、不落盘）。
3. **授权边界**：窗口级/组件级授权**不在本批**，处置**只写在 §四 取舍③**（此处不重复）。本批做法 = `withSenderCheck` + **S20 的 sender 路由前缀硬断言**（路由不在 `/film-engineering` ⇒ 拒绝）+ 全量审计。
4. **取消域**：取消**只发生在进入 ⓪ 之前**（此时**无锁**、无任何写操作）⇒ 取消路径不需要清锁；**⓪ 内部各步是不可分割的原子块**，进入 ⓪ 即**没有取消通道**（无 abort token、无取消消息）⇒ 导入进行中**不可中止**；⓪ 之后若因**异常**中止 ⇒ `finally` **删锁 + 删 staging**（兜底）。
5. **用户可见**：i18n `filmKitImporting` 必须写明「**导入进行中不可中断，请勿关闭应用**」+ 中断后的恢复说明（删 `userData/.import-lock`）；`SCHEMA.md` 写**最长等待量级**（上限 256 MB ⇒ 本地磁盘拷贝秒级到分钟级）与**手动恢复步骤**。**UI 层约束（写死）**：点导入 ⇒ ① 入口按钮**禁用** + **模态**「导入进行中，不可中断」（模态**不提供取消**）⇒ ② 导入结束（成功/失败/取消）⇒ 关模态、恢复按钮。

## 二、换入顺序（写死，逐段断言）

```
⓪ 预检与校验（**只读源目录，不碰旧 kit**）：⓪a 严格校验源目录 → ⓪b 审计文件**可创建/可写** → ⓪c 审计落「开始」行 → ⓪d 预创建 userData/.import-lock
    （任一步失败即退出，**不碰旧 kit**；**失败时的锁残留**：⓪a/⓪b/⓪c 失败 ⇒ **尚未建锁** ⇒ 无残留；⓪d 建锁失败 ⇒ 独占创建要么成功要么失败，**不留半份锁** ⇒ 无残留；审计写失败 ⇒ 不建锁）
① 置「导入中」标记（**内存态**；落盘态已在 ⓪d 建好 ⇒ 二者合一 = 完整标记）
② 两遍扫描 + 拷到 film-kit.staging-<ts>（S6：第二遍拷贝时**同步算副本哈希**并比对）→ 在 staging 上**再跑一次严格校验**
③ 清 service 缓存（_kit / _loadError / _shotLibrary / _scriptAdapter）
④ rename 旧 film-kit → film-kit.bak-<ts>
⑤ rename film-kit.staging-<ts> → film-kit        ← 原子（同卷）
⑥ 删 film-kit.bak-<ts>
⑦ 删「导入中」标记（内存 + .import-lock）    ← 锁最后删（崩在 ⑥-⑦ 间时锁仍在 ⇒ 状态可辨）
```

**两次校验**：⓪a 在**源目录**上跑严格校验（`loadFilmKit({kitDir, requireAssets:true})`），② 末尾在 **staging** 上再跑一次（同一模式）——**两次都通过**才允许换入；任一次失败 ⇒ 不碰旧 kit（staging 由 `finally` 清）。

`staging`/`.bak`/`.import-lock` 与 `film-kit` **同父目录**（同卷 ⇒ rename 原子）。

**标记的真源 = `.import-lock`（落盘）**：内存标记只是**加速判据** ⇒ **进程重启后 service 初始化读到锁 ⇒ 重建内存标记**；S11 的「不读盘」判据**只认锁文件**。

**Windows（主战场 win32）**：① rename 一个**已存在**的目录会失败（`EEXIST`/`EPERM`）⇒ 必须 ④⑤ 两步；② `ERROR_ACCESS_DENIED`（被占用：杀毒/索引器/编辑器暂存/他进程持句柄）按 S19 分级重试，仍失败 ⇒ **保留 `.bak`** + 报错带出恢复路径；③ 同卷 rename 才原子。

**回滚分档**：⓪/①/② 前失败 ⇒ 清 staging、旧 kit 未动；**④ 失败**（旧 kit rename 不成）⇒ 旧 kit **仍在原处**、staging 清掉、锁删；⑤ 失败（staging→film-kit 不成）⇒ `.bak` 改回 `film-kit` + 删 staging；**回滚也失败** ⇒ `.bak` **保留不删** + 报错写明「旧资产在 `<路径>`，请手动恢复」（i18n `filmKitImportRecover`）；⑥ 失败 ⇒ 不影响生效，提示残留。
**staging 兜底**：**任何**异常（含两遍扫描中断、原子拷贝中断）⇒ 服务层 `finally` **按精确文件清单**清理 staging —— 清单 = **我们自己拷贝出去的那批白名单文件路径**（逐个 `unlink`，**不做目录遍历**）⇒ 再 `rmdir` 空目录（此时已空）⇒ 磁盘上不留半份 staging。⛔ **禁止递归删除目录**（本仓 **R0 铁律**：目录删除一律拒绝、`safe-delete.js` 不接目录；本仓曾因整目录删除出事故）⇒ 清理**一律不用** `rm -rf` / 递归遍历删；⚠ 清单删到一半失败 ⇒ 残留物**保留在原 staging 名下**（不半删成「看着正常其实缺文件」的目录），由下一次导入的 ⓪a 校验发现并报错。

## 三、安全清单（每条 = 一个可断言的决定）

| # | 决定 |
|---|------|
| S0 | **总则（fail-closed）**：凡**白名单内条目**的输入（形状/内容/大小/路径/类型）+ 目标父目录的权限/状态，不满足本清单任一条 ⇒ **一律拒绝**并映射到 `reason` 枚举 —— **不逐项开特例**；后续新增边界情况默认走这条，**不新增规则**。⚠ **白名单外的条目不适用本总则**（它们**不拷入**，不是「不合格」）；⚠ **唯一的检测边界（不是规则的例外）**：跨目录硬链**检测不到**（部分文件系统 `nlink` 不可靠）⇒ 该维度**无判据**（不是「规则不满足」）⇒ 补偿控制四条：S21（限额只管源目录）、S22（**只收本机本地目录源**）、S2 的同目录 `(dev,ino)` 去重（可靠判据）、审计固定记 `hardlink_check=best-effort`（不虚报已防护） |
| S1 | **只拷白名单列出的路径**：扫描时枚举源目录，**白名单外的条目一律不拷入、也不递归进入其子目录**（如 `extra/`、`.git/` 整目录跳过）⇒ **不因多余文件拒绝整次导入**；**白名单内**条目不合格 ⇒ 一律拒绝 |
| S2 | **链与越界（判据分级）**：软链（`lstat().isSymbolicLink()`）⇒ 拒；断链（`isSymbolicLink()` 真但 `stat` 失败）⇒ 拒；`fs.realpath` 取真实路径须**仍在源目录内**（ENOENT/EPERM ⇒ **必须 try/catch** ⇒ 映射 `SYMLINK_REJECTED`/`VALIDATION_ERROR`）。**硬链**：**同目录**内非软链 `(dev, ino)` 相同 ⇒ 拒（**可靠**，任何文件系统都成立）；**跨目录**硬链只靠 `nlink > 1` ⇒ **最佳努力**（FAT/exFAT/网络盘 `nlink` 恒 1 ⇒ 漏判方向是「接纳」）⇒ **不列入 fail-closed 断言**，`SCHEMA.md` 明写「**非防篡改边界**」+「建议在**本机可信卷（NTFS）**上选取导入目录」；⇒ **可观测**：审计行固定带 `hardlink_check=best-effort`（不虚报已防护）。⚠ 上述 `stat`/`realpath` **全部在第一遍扫描内完成**（拷贝之前） |
| S3 | 半份 kit 不留：失败 ⇒ staging 不存在、旧 kit 逐字未变。⛔ **清理方式写死**：**按精确文件清单逐个 `unlink` + 空目录 `rmdir`**，**禁止递归删除目录**（本仓 **R0 铁律**，目录删除一律拒绝、`safe-delete.js` 不接目录）⇒ 清单 = 自己拷贝出的白名单文件路径，**不做目录遍历** |
| S4 | 失败回滚；**回滚也失败 ⇒ `.bak` 保留不删** + 报错带出恢复路径（旧资产不丢） |
| S5 | 只写 `userData/film-kit` 及其同父的 staging/.bak/.import-lock **与审计文件 `userData/film-kit-import.log`**（共**五**个路径；断言没有对这五者之外的路径写入） |
| S6 | **两遍扫描 + 逐文件哈希对账**：第一遍 `lstat` 全量算形状/大小 + **内容哈希（SHA-256）** ⇒ 不合格立即拒、**一个字节都不写**；第二遍拷贝到 staging 时**同步算副本哈希** ⇒ 拷完**逐文件**断言两条：① **副本 SHA-256 == 第一遍记录的源 SHA-256**；② **拷贝完成后再次 `stat` 源文件**，其 `(dev, ino, size, mtime)` 与第一遍记录**一致**（⇒ 源在拷贝期间没被改；⚠ **不比副本的 inode** —— 副本 inode 必然不同于源，比了会恒假、把所有导入全拒）⇒ 任一不符即拒（`VALIDATION_ERROR`）⇒ 挡住「原地改内容（同尺寸）」与「拷贝过程中被改」两类 TOCTOU |
| S7 | 不写 kit 之外的用户数据（同 S5） |
| S8 | 严格模式失败 ⇒ 一律不落盘（`userData/film-kit` 不存在，原存在的也不变） |
| S9 | 相对路径越界（**两步互补**）：① `path.isAbsolute(rel)` ⇒ 拒（绝对路径**不进入**第二步）；② 对**非绝对**的 `rel` 用 `core/ipc-security.js` 已有的 `isPathInside(stagingRoot, path.resolve(stagingRoot, rel))` 判（`path.relative` 口径天然处理分隔符归一化） |
| S10 | 固定深度 + 隐藏名 + 扩展名（**只作用于白名单内条目**）：`prompts/tasks` 的深度**基准 = `prompts/tasks`**（导出常量 **`BASE_PROMPT_PATH = "prompts/tasks"`**（**路径基准**，不是业务任务；字面值写死），代码与 `SCHEMA.md` 同值、镜像检查按同一基准解析）⇒ 恰 **3 层**（`prompts/tasks/<task>/<lang>/<file>`，少一层即拒）；**候选路径的任何组件（目录或文件）以 `.` 开头 ⇒ 拒**；扩展名 ∈ `{json, md}` |
| S11 | 导入中 ⇒ service 不从磁盘重读 kit：标记 = 内存标志 **+ `userData/.import-lock` 落盘文件**（**真源 = 锁文件**；内存标志只是加速判据，**进程重启时按锁重建内存标志**）；`_ensureKit()` 见标记 ⇒ **抛可识别错误、不读盘** ⇒ 绝不静默回落到随包 kit |
| S12 | 缓存失效在 rename 之前；标记**先置后删**、与 `.import-lock` 同生命周期；**锁最后删** |
| S13 | 文件头魔数：`*.json` 头须 `{`/`[`（去 BOM/空白）⇒ 不匹配即拒、**不写盘** |
| S14 | 上限与重试常量**单一定义**：`kit-import.js` 顶部导出 `MAX_KIT_FILE_BYTES` / `MAX_KIT_TOTAL_BYTES` / `RETRY_MAX` / `RETRY_MS`（数值只在代码里存在一次；`SCHEMA.md` 与测试**同名导入断言**） |
| S15 | **崩溃/失败残留三档**：① `film-kit` **缺失** + `.bak` = 旧 kit（崩在 ④ 后⑤ 前）⇒ **必须手动 rename 恢复**（锁**不自动清**）；② `film-kit` = 新的 + `.bak` = 旧 kit（崩在 ⑤ 后⑥ 前，**或 ⑥ 删 `.bak` 自身失败**）⇒ 锁可自动清（S18）+ **提示可安全删 `.bak`**；③ `film-kit` = 新的 + 无 `.bak` + 只剩锁（崩在 ⑥ 后⑦ 前，**或 ⑦ 删锁自身失败**）⇒ 锁可自动清（S18），资产已就位。⇒ 三档**覆盖全部失败点** |
| S16 | 第 0 步预检与校验（**全程只读源目录**，= §二 ⓪a-⓪d）：① 严格校验源目录 → ② 审计文件可创建/可写（判**父目录**可写）→ ③ 审计落「开始」行 → ④ 预创建锁文件；任一步失败 ⇒ 立即退出、**绝不动旧 kit** |
| S17 | **审计契约**进 `SCHEMA.md`：文件 `userData/film-kit-import.log`；字段（时间 / sender URL / **sender 路由** / **触发组件**〔renderer 传入 ⇒ **可伪造**，仅事后线索、**不作判据**〕 / 所选目录 / 结果 / reason / **`post_check`**（PASS / FAIL_WITH_RECOVERY）/ **`recovery_state`**（仅 `post_check=FAIL_WITH_RECOVERY` 时有值 ∈ {`MISSING_KIT`, `BAK_LEFT`, `LOCK_LEFT`}，对应 S15 三档）/ `.bak` 保留时**必带恢复路径**；**`reason` × `post_check` × `recovery_state` 的对应表写进 `SCHEMA.md` 审计小节**（测试逐行断言）—— 表的**生成规则**（表本体是机械展开）：`post_check=PASS` ⇔ 导入成功且 staging 严格校验通过；`post_check=FAIL_WITH_RECOVERY` ⇔ 发生回滚或留有残留 ⇒ `recovery_state` 按 S15 三档填（`MISSING_KIT`/`BAK_LEFT`/`LOCK_LEFT`）；`post_check` 不出现 ⇒ 导入在换入前被拒（`reason` 直接给出原因，无恢复动作）；**行格式**（UTC ISO8601 + 制表符分隔 + UTF-8 + `\n` ⇒ `SCHEMA.md` 给一行**示例行**供测试断言）；**写入时机**（每次 IPC 调用后，成功与失败都写）；**保留**（单文件追加；**> 10,000 行或 > 10 MB ⇒ 拒绝写入并拒绝新的导入**（**不追加、不截断** ⇒ 审计文件停在阈值前、数据不丢；截断会丢审计）+ i18n `filmKitImportAuditFull`）；**写入失败 ⇒ 拒绝导入**；权限（可追加、不可改写）；追加 `fs.open({flags:'a'})`，**互斥由 `.import-lock` 的独占创建（`wx`）实现** ⇒ 第二个导入进程建锁失败即拒（`LOCK_CREATE_FAILED`）⇒ 不会行间交错；同一时刻只允许一个导入。⚠ **诚实边界**：审计防「**静默**」，**不防恶意篡改** |
| S18 | **锁与审计的落盘顺序闭合**（= §二 ⓪b-⓪d 的同一条顺序，不另起一套）：① 审计文件预检可创建/可写（⚠ `fs.access` 对**不存在**的文件返 ENOENT ⇒ 判**父目录**可写；**首次导入时审计文件不存在是合法的**）→ ② 审计落「开始」行 → ③ 预创建锁 → ④ **审计写失败 ⇒ 立即退出、不创建锁、不碰旧 kit**。**锁的存活判定用「租约心跳」，不用 PID**（PID 会被复用 ⇒ 误判；租约不会）：锁文件内容 = 一行 JSON `{ "pid": <创建者 PID，仅审计线索>, "nonce": "<32 位随机>", "startedAt": <ISO8601>, "senderUrl": "<url>" }`；导入期间**每 5 秒刷新一次锁的 mtime**（心跳）；读锁 ⇒ **mtime 年龄 ≤ 60 秒 ⇒ 租约有效 ⇒ 仍有导入在跑 ⇒ 拒绝**；**> 60 秒 ⇒ 租约过期 ⇒ 崩溃残留** ⇒ **清锁条件 = 租约过期 ∧ `film-kit` 存在**（= S15 档位②③）⇒ **自动清锁 + 强制写审计**；`film-kit` 缺失（档位①）⇒ **不清锁**（资产可能只在 `.bak` 里）⇒ 走手动恢复（i18n `filmKitImportRecoverMissing`）。**执行点与顺序（写死，两个入口都走同一条）**：① service 初始化、② 导入 IPC 入口 ⇒ **读锁 → 判租约（mtime 年龄）→ 判 S15 档位 → 清锁或抛错** ⇒ 租约有效 ⇒ 抛 `LOCK_HELD`（i18n `filmKitImportRecoverLock`）；档位① ⇒ 抛 `LOCK_HELD` + i18n `filmKitImportRecoverMissing`；档位②③ ⇒ 清锁 + 审计行记 `recovery_state`（`BAK_LEFT`/`LOCK_LEFT`）⇒ service 侧清锁后**不置内存标记**（锁已消失 ⇒ 无导入在跑）⇒ 正常读盘。⛔ **nonce 认领（互斥的最后一格）**：删锁前**读锁内 nonce 与自己写入的 nonce 比对**，**不一致 ⇒ 不删**（那是别人的锁）；`finally` 清理 staging 时**只认领 nonce/时间戳属于自己这一份**的 staging ⇒ 租约被误判过期、第二个进程接管后，第一个进程的 `finally` **既不会删掉别人的锁、也不会删掉别人的 staging** |
| S19 | `ERROR_ACCESS_DENIED` 的重试分级：`RETRY_MAX`=3、`RETRY_MS`=500（**基数**），退避 `RETRY_MS * 2^(n-1)`（500ms/1s/2s ⇒ 总等待 ≤ 3.5s）。**A 类（可重试）** = 文件 `copyFile`（套退避循环）；**B 类（目录 `rename`）** 在 NTFS 上常因占用**不可重试** ⇒ 仅在 `ERROR_ACCESS_DENIED` 时做**一次立即重试**，**不套退避循环**；**审计追加不重试**（失败即拒）。`SCHEMA.md` 写同一组值 |
| S21 | **祖父条款（限额只管源目录）**：`MAX_KIT_*` **仅作用于用户选定的源目录**（kitDir）；**目标** `userData/film-kit` 在成功时**整体替换**、**不参与**限额判定（否则用户**重导入自己的资产**时会被自己的旧资产限死）⇒ 代码头部注释与 `SCHEMA.md` 的 `## 祖父条款（限额只管源目录）` 小节**双写**这一行 |
| S22 | **只接受本机本地目录源**：源路径必须是**本机本地目录** ⇒ UNC/网络路径（`\\host\share`）、压缩包、URL、非目录 ⇒ 一律拒（`NOT_A_DIRECTORY`）⇒ ① 跨目录硬链只能指向**同一台机器**上的文件（本机主人对那些文件本就有读权限 ⇒ 无额外暴露）；② 压缩包/网络来源不在本批范围（§八） |
| S20 | **写路径的 sender 路由断言（硬）**：`film-engineering:import-kit` 解析 `event.senderFrame.url` 的 **hash 路由段**（本仓是 `createWebHashHistory` ⇒ 路由在 `#` 之后，**`pathname` 恒为 `/` ⇒ 不参与判断**）—— **解析口径写死**：`new URL(url).hash` ⇒ 去前导 `#` ⇒ 取 `?` 之前的部分 ⇒ 去尾斜杠 ⇒ 与前缀 `/film-engineering` 比较；**写路径一律 fail-closed**：路由前缀不匹配**或**路由解析不出（`hash` 缺失/为空）⇒ **拒绝**（`reason: UNAUTHORIZED_SENDER`）+ 审计行（含 sender URL 与路由）；⚠ **诚实边界**：该断言只能判到「调用方**当前在**影视工程路由」，**判不到组件**（SPA 同一文档承载三标签页）⇒ **组件级授权仍不做**；⚠ **另一道不依赖 URL 的屏障**：handler **入参为空**、路径只能来自原生对话框 ⇒ 任意可信渲染进程**无法指定替换内容** |

## 四、白名单与资产事实

**唯一真源 = 代码里的机器可读白名单**（`kit-import.js` 导出）；`film-kit/SCHEMA.md` 的「文件清单」表**新增一列「导入白名单」** ⇒ 它是白名单的**人读镜像**（镜像只比对标 ✅ 的行），两者**排序后逐行 `===` 相等由测试断言**，并加**断言脚本** `kit-mirror-check.js`（导出 `verifyKitMirror()`）+ `kit-mirror-check.test.js`（同目录、同 vitest 框架 ⇒ 随桌面端测试套件在 CI 自动执行）。⚠ `SCHEMA.md` **首段明写「本文件不用于运行时解析」** —— 该约束只管**运行时代码**；`kit-mirror-check.js` / `kit-schema-contract.test.js` 是**构建期/测试期工具**，不在运行路径上 ⇒ **不违反**该声明；`SCHEMA.md` 是**提交进仓的普通文件**（不是生成物）⇒ CI「检出 ⇒ 跑测试」顺序天然成立。
**若 `SCHEMA.md` 的「导入契约」小节缺失 ⇒ 镜像/契约测试直接失败（fail-closed），不是跳过**：两个测试的**第一步**就是断言该小节存在，不存在 ⇒ 直接失败并打印**自解释信息**「导入契约小节未写入：<绝对路径>；本批要求它与代码同 PR 同提交」⇒ 失败不依赖 CI 顺序假设，也不产生「谜之红」。

| 类别 | 文件 | 必填 | 形状/内容 |
|------|------|------|----------|
| 核心 4 件 | `film-manifest.json` / `shot-library.json` / `reference-registry.json` / `prompt-doctrine.json` | ✅ | 根 `.json` |
| v7 增强 4 件 | `shot-grammar.json` / `compliance-checklist.json` / `palette.json` / `prompts/tasks/**` | 严格模式下 ✅ | 根 `.json`×3；任务库固定 3 层、`.md` |
| 可选 1 类 | `prompt-doctrine.zh.md` | ❌（要拷，但**可选**） | `.md` |

**已核实的资产事实**：① `images/`（11 文件）**全仓无任何代码消费**（非注释命中 0）—— **核实方法（可复跑）**：`grep -rn "images/" apps/desktop/electron apps/desktop/src --include=*.js --include=*.vue | grep -v "^[^:]*:[0-9]*: *[*#/]"` ⇒ 只剩注释与文档命中；结论**不靠推断**，且已写进 `SCHEMA.md` 与 `kit-import.js` 注释（将来引入消费方时这两个文件会与本条冲突 ⇒ 冲突即提醒）⇒ **移出首批导入白名单**（不拷、不校验、不进镜像表）；随包 kit 里的 `images/` **不受影响**；**不引入 `images-manifest.json` 契约**（无消费方 ⇒ 契约零价值却带来镜像解析依赖）；将来若引入消费方，另开切片把它连同 manifest **一起加回**。`SCHEMA.md` 与 `kit-import.js` 注释都**显式写**「`images/` 目前无消费方 ⇒ 不在导入白名单内」，`kit-import.js` 头部留 **TODO(images-consumption)** 指向 `SCHEMA.md` 的说明小节。② `shot-library.json`/`reference-registry.json` 的媒体路径指向 **kit 之外**的媒体产物目录 ⇒ 不在白名单内、导入**不**碰。

**祖父条款**：`MAX_KIT_*` **仅作用于用户选定的源目录**（kitDir）；**目标** `userData/film-kit` 在成功时**整体替换**、**不参与**限额判定（否则用户**重导入自己的资产**时会被自己的旧资产限死）⇒ `kit-import.js` 头部与 `SCHEMA.md` 的**独立小节**（标题 `## 祖父条款（限额只管源目录）`）**都要显式写这一行**（集中一处，不散落在各节）。

**取舍（写进 `SCHEMA.md`，防被误读为遗漏）**：⓪ **禁止递归删除目录**（本仓 R0 铁律）—— staging/`.bak` 的清理一律**按精确文件清单**逐个 `unlink` + 空目录 `rmdir`；ⓘ **不做磁盘空间预检**（`statfs`）—— ENOSPC 发生在**拷贝阶段** ⇒ 导入失败 + 按清单清 staging + **旧 kit 未动**（S3/S4 兜底）⇒ 只是失败得晚一点，**不产生损坏**；① `nlink` 判据 = **最佳努力、非防篡改边界**（S2）；② 崩溃残留三档恢复路径（S15）；③ 窗口级/组件级授权**不在本批** —— 本批做 `withSenderCheck` + **S20 的 sender 路由前缀硬断言**（路由不在 `/film-engineering` ⇒ 拒绝；**前缀**匹配 ⇒ 三个标签页都放行、**不误伤合法调用**），但**组件级授权做不了也不假装做**（同一文档承载三标签页，路由判不出组件）；缓解四层（**受信来源 = preload 白名单登记的 `filmEngineering.importKit` 接口**（`access-control.js` 的 `PUBLIC_METHODS` 登记 ⇒ 未登记的方法默认不可达）+ **路由前缀断言**（S20，写路径解析不出路由即拒）+ **目录只能由用户原生选**（入参不含路径 ⇒ 无法指定替换内容）+ 严格校验不落盘 + 全量审计），信任域内的越权**由审计可见**。

## 五、失败原因枚举与 i18n

`reason` 闭集（**15 值**，服务端只回这些值，枚举写在 `SCHEMA.md`，**测试可逐个断言**）：
`VALIDATION_ERROR` / `NOT_A_DIRECTORY` / `PATH_ESCAPE` / `SYMLINK_REJECTED` / `HARDLINK_REJECTED` /
`HIDDEN_NAME_REJECTED` / `EXT_NOT_ALLOWED` / `MAGIC_MISMATCH` / `SIZE_EXCEEDED` / `PARENT_NOT_WRITABLE` /
`LOCK_CREATE_FAILED` / `SWAP_FAILED` / `ROLLBACK_FAILED` / `CANCELLED` / `UNAUTHORIZED_SENDER` /
`AUDIT_UNAVAILABLE`（审计不可写 / 已超阈值 ⇒ 拒绝写入并拒绝导入）/ `LOCK_HELD`（租约有效 ⇒ 拒入；或档位① 需手动恢复）（**17 值**）。

i18n 键（`filmEngineering.auto.*`，zh/en 成对，**共 11 键**）：`filmKitImport`（入口）/ `filmKitImportHint`（说明会替换当前资产）/
`filmKitImporting`（**必须写明「不可中断」+ 恢复说明**）/ `filmKitImportSuccess`（带镜数/场景数占位）/ `filmKitImportFailed`（带 `reason` 占位）/
`filmKitImportCancelled`（取消**不**算失败）/ `filmKitImportRecover`（回滚也失败的兜底，带 `.bak` 路径占位）/
`filmKitImportRecoverLock`（**存在未完成的导入** ⇒ 手动删 `userData/.import-lock` 的步骤 + 锁路径与年龄）/ `filmKitImportRecoverMissing`（**崩在 ④ 后⑤ 前**：`film-kit` 缺失 ⇒ 手动 rename `.bak` 恢复）/ `filmKitImportRecoverBak`（**有锁 + `.bak` 残留**：`film-kit` 已是新的 ⇒ 可安全删 `.bak`）/
`filmKitImportAuditFull`（审计日志已满 ⇒ 请手动轮转）。**文案全文写进 PRD §9.c**（本方案只定键与语义，不定文案）。

## 六、验收判据（TDD-RED，`kit-import.test.js`）

**A 组（原 `tasks.md` 4 条）**：① 严格模式校验失败 ⇒ 不落盘；② 成功 ⇒ `userData/film-kit` 齐备 + service 缓存已失效；③ 含符号链接 ⇒ 拒；④ 换入中途失败 ⇒ 无半份 kit、旧 kit 逐字未变。

**B 组（新增 17 条）**：⑤ 白名单外文件不被拷入（且**不递归进入**其子目录）；⑥ 超限 ⇒ 拒且未开始拷；⑦ 没写到 staging/.bak/.import-lock/审计文件 之外；⑧ 换入失败后旧 kit 逐字未变；⑨ 相对路径越界或绝对路径 ⇒ 拒、没写到 staging 之外；⑩ 硬链接 ⇒ 拒（同目录 `(dev,ino)` 相同 ⇒ 拒；跨目录靠 `nlink>1` ⇒ **最佳努力**，不构成防篡改保证）；⑪ 隐藏名（含**目录名**）或 `prompts/tasks/` 深度不符 ⇒ 拒；⑫ 回滚本身失败 ⇒ `.bak` 仍在 + 报错带出恢复路径；⑬ 导入中 `_ensureKit()` 抛可识别错误、不读盘，标记先置后删且 `.import-lock` 同生命周期；⑭ 代码白名单集合 == `SCHEMA.md` 文件清单表**标 ✅ 的行**解析集合（排序后逐行 `===`）；⑮ `.json` 魔数不匹配 ⇒ 拒且不写盘；⑯ 父目录不可写或锁文件建不出来 ⇒ 立即退出、旧 kit 逐字未动；⑰ **锁的存活判定 = 租约**（mtime 心跳，5 s 刷新 / 60 s 过期；**不用 PID**，PID 会被复用 ⇒ 误判）+ **nonce 认领**（删锁前比对 nonce，不一致 ⇒ 不删）：**租约有效 ⇒ service 抛可识别错误、不读盘，导入也拒绝**；**租约过期 ⇒ 按 S15 判档**：档位②③（`film-kit` 存在）**自动清锁 + 强制审计**，档位①（`film-kit` 缺失）**不清锁** ⇒ 手动恢复；⑱ **`images/` 不在导入白名单** ⇒ 目标目录里**没有** `images/`（镜像表里也没有 `images/*` 行）；⑲ **可选资产缺失（`prompt-doctrine.zh.md` 不存在）⇒ 导入照常成功**；⑳ **sender URL 与其 hash 路由段写入审计行**，且**路由前缀不在 `/film-engineering` ⇒ 拒绝**（S20 硬断言，`reason=UNAUTHORIZED_SENDER`；`hash` 解析不出 ⇒ **同样拒绝**，写路径不 fail-open）；㉑ **两条对账同时成立**：① 副本 SHA-256 == 第一遍源 SHA-256；② 拷贝完成后**再次 stat 源文件**，`(dev, ino, size, mtime)` 与第一遍记录一致 ⇒ 任一不符即拒（**TOCTOU 反证用例**：拷贝前把源文件**原地改成同尺寸内容** ⇒ 必须被拒）。

**C 组（契约与镜像断言，2 条，独立用例文件）**：㉒ `kit-mirror-check.test.js`：代码白名单集合 == `SCHEMA.md` 标 ✅ 行解析集合（**排序后逐行 `===`**；与 B 组 ⑭ **两处都断言**，互为冗余防漏）；㉓ `kit-schema-contract.test.js`：`SCHEMA.md` 的**审计字段 / `reason` 枚举 / 恢复路径小节存在且非空**，且 `SCHEMA.md` **缺失时失败**并打印「契约文件未写入」。

**win32 专项**：① 硬链判定语义要有覆盖断言：**(dev,ino) 同目录去重**（**可靠**）+ `nlink>1`（**最佳努力**）；② NTFS 的 `.` / `..` **不得**被当成合法目录项 —— **枚举阶段就跳过**：`basename === "." || basename === ".."` ⇒ **不作为条目**（不是「判为不合格」）；**其余**以 `.` 开头的组件（S10）⇒ 一律拒 —— 两处是**同一条规则的两半**（`.`/`..` 先跳过，其余隐藏名才拒），`kit-import.js` 注释与 `SCHEMA.md` 写同一句；③ `ERROR_ACCESS_DENIED` 的重试分级要断言（A 类套退避、B 类只做一次立即重试、审计不重试）。

## 七、落点

| 层 | 文件 |
|----|------|
| 服务（新建） | `services/film-engineering/kit-import.js`（**编排 + 导出面**，≤ 120 行）/ `kit-import-scan.js`（白名单 + 两遍扫描 + 哈希，≤ 250 行）/ `kit-import-swap.js`（拷贝 + 换入 + 回滚 + **精确清单清理**，≤ 250 行）/ `kit-import-lock.js`（锁 + 租约 + nonce 认领 + 清锁，≤ 150 行）/ `kit-import-audit.js`（审计追加 + 轮转判定，≤ 150 行）—— **每个文件都在 `check-max-lines` 的 500 行硬限内**（括号内是预算行数），测试按模块分文件（`kit-import-scan.test.js` 等） |
| 服务（新建） | `services/film-engineering/kit-mirror-check.js` + `kit-mirror-check.test.js`（白名单镜像断言）+ `kit-schema-contract.test.js`（**第二道自动化断言**：解析 `SCHEMA.md` ⇒ 断言审计字段 / `reason` 枚举 / 恢复路径小节存在且非空） |
| 服务（改） | `film-engineering-service.js`（缓存失效方法 + 读 `.import-lock` + **有锁时抛可识别错误**；⚠ 失效必须**同时重置 `_kit`/`_loadError`/`_shotLibrary`/`_scriptAdapter` 四个字段** —— `_loadError` 是**失败缓存**，漏重置会让旧失败永久存活） |
| IPC（**新建**） | `ipc-handlers/film-engineering-import.js`（注册 `film-engineering:import-kit`：`withSenderCheck` + **入参为空** + `isDirectory` + 审计 + dialog 在这一层；⚠ **不塞进 `film-engineering-auto.js`** —— 该文件已 **446 行**、`check-max-lines` 硬限 **500**；写路径与只读分文件也与 D19 同向）+ `ipc-handlers/index.js`（多一行 `require` 接线） |
| preload / 渲染端 | `preload/access-control.js`（`PUBLIC_METHODS` 加 `filmEngineering.importKit`）+ `preload/film-engineering.js`（通道 + API）/ `src/api/electron-bridge.js` + **`src/views/FilmEngineeringView.vue`（「**项目案例**」标签顶部入口 —— ⚠ **不是** `film-auto/FilmAutoPanel.vue`：那是「自动」标签的**只读规划区**，写操作不入只读区） |
| i18n / 测试 / 文档 | `locales/film-engineering/{zh,en}.js`（§五 11 键）/ `kit-import.test.js`（§六 A/B 组 21 条 + C 组 2 条 + win32 专项 3 条）/ `film-kit/SCHEMA.md`（**新增「导入契约」小节**：白名单/形状/魔数/枚举/审计/恢复/取舍/祖父条款）+ `PRD-FILM-PIPELINE-V2`（§9.c）+ 本文件 + `pr3b-import-critiques.md` + `pr3b-import-review-record.md` + `tasks.md` + 执行记录 |

## 八、明确不做

❌ 增量/合并/差分（**整体替换**）· ❌ 导入历史/多版本 · ❌ 导出 · ❌ **压缩包/网络来源/扫盘**（来源只有本机目录）· ❌ 写 kit 之外的路径 · ❌ 把 `images/` 变成消费方 · ❌ **`images-manifest.json` 契约**（无消费方）· ❌ **按时间猜的锁清理**（自动清理**只按进程存活**判定，见 S18）· ❌ **窗口级/组件级授权**（本批只做审计）

## 九、决策点（全部已拍板，无开放项）

| # | 决策 | 结论 | 依据 |
|---|------|------|------|
| 1 | 成功后 `.bak` 去留 | **立即删**（⑥）；**回滚也失败时保留** | 「原子落盘」纪律的延续 |
| 2 | 大小上限 | 单文件 **32 MB** / 总量 **256 MB** | 实测随包 kit 36 文件 / **2.848 MB**，最大单文件 `shot-library.json` **2.530 MB** ⇒ 12.6× / 90× 余量（随包是 min 版，完整库更大） |
| 3 | UI 入口位置 | **「项目案例」标签顶部**（= `FilmEngineeringView.vue`；**不是** `film-auto/FilmAutoPanel.vue`） | 那里是**看**资产的地方，导入是同一件事的另一半；「自动」标签是**消费**资产的地方，写操作放进去会让只读区混入写操作。**已核实**：`FilmEngineeringHubView.vue` 的三标签 = `auto`/`canvas`/`classic`，`classic` 的 i18n 文案正是「项目案例」（`filmEngineering.hub.tabs.classic`，zh/en = 「项目案例」/"Project Cases"），该面板挂 `FilmEngineeringView.vue`；`film-auto/FilmAutoPanel.vue` 挂在 `auto` 面板 ⇒ **决策成立** |

## 十、许可与来源

本批**不引入第三方代码/资产**：只读写用户提供的目录 + 复用仓内 `kit-loader`/`kit-asset-validators`/`film-engineering-service`；导入**不搬运**研究项目的任何文件。仓内既有代码沿用原仓许可；`SCHEMA.md` 与 `film-kit/**` 是本仓自有资产。
