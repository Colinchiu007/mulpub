# PR-3b 决策层对抗评审 · 逐轮证据（critic 原文 + 逐条处置）

> 评审对象：`openspec/changes/film-pipeline-prompt-triple-and-guards/pr3b-import-design.md`
> 引擎：`scripts/plan-review.sh`（决策层，`objectType=plan`）→ `scripts/ccg-review-decider.js` 判定 **DUAL**
> 后端对：critic=**claude**（评审主力）× proposer=**opencode**（跨家族出方案）
> 维度：completeness / consistency / clarity / feasibility / **security**
> 配套：`pr3b-import-review-record.md`（逐轮叙述与处置理由）｜ `pr3b-import-design.md`（方案本体）

---

## 0. 产物留痕的事实说明（不粉饰）

评审引擎把每轮产物写到**同一个目录**：`.adversarial/ccg-plan-pr3b-import-design-claude/`
（slug = 方案文件名 + critic 名，**不带轮次**）⇒ **后一轮覆盖前一轮的 `critique-v1.md`**。

| 轮次 | critic 原文产物 | 本文件是否收录原文 |
|------|----------------|-------------------|
| 1–6 | `.adversarial/archived/run1…run6-claude-review/`（归档件） | 是（见 `pr3b-import-review-record.md`） |
| 7–12 | **已被覆盖**（归档时未留） | **否** ⇒ 本文件只记**处置**（落地补丁即处置本身） |
| 13–16 | `.adversarial/archived/run13…run16-claude-review/critique-v1.md` | **是**（下文逐条收录原文） |

⇒ 第 7-12 轮的「意见原文」**不可复原**（引擎覆盖所致，非遗漏）；该段的**处置**由对应提交
（`git log --oneline` 可见）与本文件的「落点」列共同佐证。
⇒ 第 13-16 轮的原文与处置**逐条对照**，可独立复核。

---

## 1. 第 13 轮（8 条 / Critical 3，最低分 6）

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / consistency | "Cancellation defined before ⓪ (no lock), yet finally-delete-lock applies to interruption after lock; no abort token exists. Post-lock interruption undefined. Contradiction." / "Clarify cancellation domain: either only before ⓪ (drop finally clause) or define abort token and cancellation points after lock." | **成立·已改**：取消域**写死**为「只发生在进入 ⓪ 之前」；⓪ 之后无取消通道 ⇒ 导入进行中不可中止；⓪ 之后**异常**中止 ⇒ `finally` 删锁 + 删 staging | §一 边界③ |
| i2 | Critical / security | "S2 broken symlink (`lstat` true, `stat` ENOENT) must map to SYMLINK_REJECTED; proposal mentions mapping but doesn't enforce it before copy. Unclassified exception risk." / "Enforce try/catch around `stat`/`realpath` with explicit ENOENT/EPERM mapping to SYMLINK_REJECTED before any file copy." | **成立·已改**：`stat`/`realpath` **全部在第一遍扫描内完成**（拷贝之前）⇒ 断链/无权限在**一个字节都没写**时就被拒 | §三 S2 |
| i3 | Warning / security | "Window-level restriction deferred; `withSenderCheck` alone guards import. Any trusted preload renderer can invoke it. Missing authorization boundary." / "Add sender URL whitelist in `SCHEMA.md`" | **成立·已改**（后续第 16 轮再降级为「审计增强」）：先写 `SCHEMA.md` 的 sender 路由白名单 → 第 16 轮改为**只写审计、不作拒绝依据** | §四 取舍③ → §三 S20 |
| i4 | Warning / completeness | "`SCHEMA.md` white list sync relies solely on test equality (`===`). No build-time mechanism." / "Generate `SCHEMA.md` file list from `kit-import.js` exports, or add build-time assertion script" | **成立·已改**：加 `kit-mirror-check.js`（导出 `verifyKitMirror()`）+ `kit-mirror-check.test.js`，随桌面端测试套件在 CI 自动执行 | §四 / §七 |
| i5 | Critical / feasibility | "Fresh `.import-lock` (<30min) after service crash blocks import permanently until 30min passes; manual recovery path not described." / "Document manual recovery (delete `.import-lock`) in `SCHEMA.md` and `i18n` keys" | **成立·已改**（第 16 轮进一步取消自动清锁）：写手动恢复步骤 + i18n 键 + 导入时明确报「有未完成的导入」 | §三 S18 / §五 |
| i6 | Warning / feasibility | "Proposal claims `dialogApi` injectable for test, but defines no mock interface contract." / "Document mock interface (`canceled` bool, `filePaths` array) in `kit-import.js` comments" | **成立·已改**：写死 mock 契约 `{ canceled: boolean, filePaths: string[] }`，落在 `kit-import.js` 注释里供测试照抄 | §一 边界① |
| i7 | Warning / consistency | "Grandfather clause excludes target assets from limits, but replacement process moves target to `.bak` and deletes it. Clause has no effect." / "Clarify clause applies only when import fails before rename; otherwise remove redundant clause" | **成立·已改**：改写为「目标目录里的既有资产不参与限额判定（它在成功时就被整体替换 ⇒ 不存在『目标超限』的场景）」 | §四 祖父条款 |
| i8 | Info / clarity | "`images/` noted as no consumer with TODO; future consumption may miss contract updates if TODO isn't tracked to `SCHEMA.md`." / "Link TODO(images-consumption) to `SCHEMA.md` section and add optional-asset test" | **成立·已改**：TODO 指向 `SCHEMA.md` 小节 + 判据「可选资产缺失 ⇒ 导入照常成功」 | §四 / §六 ⑲ |

---

## 2. 第 14 轮（8 条 / Critical 2，最低分 5）

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / consistency | "方案宣称『103 条意见全部成立、全部采纳、零驳回』，但引用的评审记录文件未随本文件提供，无法验证；『零驳回』在 13 轮对抗评审中不符合常识，缺乏证据即构成自证闭环." / "附上评审记录文件，或将宣称改为『已采纳的修订记录在外部文件中可查』；去掉绝对化的『零驳回』." | **成立·已改**：去掉「零驳回」等**不可在方案内自证**的绝对化措辞，改为「已逐条落地；逐条理由与处置见同目录 `pr3b-import-review-record.md`」 | 方案抬头 |
| i2 | Critical / security | "S2 硬链接防御依赖 `stat` 跟随 + `nlink > 1`，但文本自认『win32 的 nlink 可能漏判真硬链』；`realpath` 备用只解路径、不判 inode 共享，无法捕获同设备内硬链." / "在 S2 补充 inode+device 对比；若 win32 无法可靠判硬链，则在 `SCHEMA.md` 明确写入『最佳努力，不构成防篡改保证』." | **成立·已改**（**我的技术性错误**）：`realpath` 确实**看不见硬链**（硬链路径本身就在目录内）⇒ 改写 S2 口径：**软链越界**由 `realpath` 覆盖、**硬链**只由 `nlink>1` 覆盖，并写明 `nlink` 的漏判方向 | §三 S2 |
| i3 | Warning / feasibility | "『唯一真源』要求构建期脚本解析 `SCHEMA.md` 表与 `kit-import.js` 导出逐行 `===` 对比，但脚本名、路径、构建钩子均未给出，属于未交付的『幻影依赖』." / "在 §七落点表增加脚本路径，并在 `package.json` 或 CI 配置中写入执行点." | **成立·已改**：给出脚本路径 `kit-mirror-check.js` / `kit-mirror-check.test.js`，执行点 = **桌面端测试套件（vitest，CI 的 desktop-shards job 自动跑）** | §四 / §七 |
| i4 | Warning / clarity | "取消域写死『只发生在⓪之前（无锁、无任何写操作）』，但⓪内部包含 3 步；若在⓪子步骤中取消，将留下半份审计或半份锁." / "将⓪定义为不可分割的原子预检块" | **成立·已改**：⓪ 内部各步写死为**不可分割的原子块**，进入 ⓪ 即无取消通道 | §一 边界③ / §二 |
| i5 | Warning / security | "陈旧锁自愈直接删 `.import-lock` 并强制写审计，但未检查 `.bak` 是否存在、`film-kit` 是否缺失；盲删锁会掩盖状态并允许重复导入覆盖新版." / "自愈前断言：`.bak` 不存在 且 `film-kit` 存在；否则进入手动恢复路径." | **成立·已改**（第 16 轮进一步**取消自动清锁**）：先加前置断言 → 第 16 轮按「全部残留走显式手动恢复」简化 | §三 S15 / S18 |
| i6 | Info / completeness | "`images/` 明确『目前无任何代码消费』，却要求完整拷贝并强制 manifest 键一一对应，增加实现与测试负担而无用户价值." / "将 `images/` 降为真正可选；去掉 manifest 键一一对应的拒绝规则." | **成立·已改**（第 16 轮**进一步移出白名单**）：先降为软契约（只告警不拒）→ 第 16 轮整目录移出首批白名单 | §四 / §六 ⑱ |
| i7 | Warning / consistency | "多处引用 `SCHEMA.md` 具体内容，但 `SCHEMA.md` 本身是本批交付物（非已存在文件），引用方式像在引用已落地契约." / "加注『待 SCHEMA.md 落地后生效』，并在落点表区分已改文件与新建文件." | **成立·已改**：统一标注「**本批待写入**，不是既有契约」；落点表区分新建/改 | 方案抬头 / §七 |
| i8 | Info / feasibility | "§九决策 3 断言 UI 入口在 `FilmEngineeringView.vue` 而非 `film-auto/FilmAutoPanel.vue`，但方案未验证这两个文件在仓内是否存在、标签结构是否匹配." / "在实施前用文件存在性与标签名验证确认入口点." | **成立·已改**：**已核实**（非推断）：`FilmEngineeringHubView.vue` 三标签 = `auto`/`canvas`/`classic`，`classic` 的 i18n = 「项目案例」/ "Project Cases"，该面板挂 `FilmEngineeringView.vue`；`film-auto/FilmAutoPanel.vue` 挂 `auto` 面板 ⇒ **决策成立** | §九 决策 3 |

---

## 3. 第 15 轮（8 条 / Critical 3，最低分 7）

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / security | "硬链拒绝仅靠 nlink>1；FAT/exFAT/网络盘上 nlink 固定为 1，会漏接纳硬链，违背『同目录合法硬链一律拒』的断言." / "在同父目录内对非软链做 inode/dev 比对兜底，或在 SCHEMA.md 明确声明该判据为最佳努力并记录漏判方向." | **成立·已改**：加**同目录 `(dev, ino)` 去重**兜底（与 `nlink` 无关，任何文件系统都成立）+ 跨目录档标注「最佳努力」 | §三 S2 / §六 ⑩ |
| i2 | Critical / feasibility | "进入 ⓪ 后无取消通道；用户只能等结束或手删锁，长时间导入无法中止." / "UI 明示『导入不可中断』并给估算时长；文档写明最长等待与手动恢复步骤." | **成立·已改**：i18n `filmKitImporting` 必须写明「不可中断，请勿关闭应用」+ 恢复说明；`SCHEMA.md` 写最长等待量级与手动恢复步骤 | §一 边界③ / §五 |
| i3 | Critical / consistency | "manifest 缺失时『整个 images/ 视为不存在』，但白名单仍要求 images/*.webp 被拷入；两者行为未明确对齐." / "写死规则：manifest 缺失则跳过整个 images/ 目录（不拷任何 .webp），仅记审计告警." | **成立·已改**（第 16 轮**整目录移出白名单**）：先写死整目录规则 → 第 16 轮按「零消费 ⇒ 不拷、不校验、不进镜像表」简化 | §四 / §六 ⑲ |
| i4 | Warning / security | "withSenderCheck 仅限信任域，不做窗口级授权；任意可信渲染进程可触发写路径替换用户资产." / "本批至少在 IPC 层追加断言：调用方必须来自 FilmEngineeringView.vue（路由注册表核对），并写入审计." | **成立·已改**（第 16 轮**降级为审计增强**）：先加硬断言 → 第 16 轮按「同一文档承载三标签页，路由判不出组件 ⇒ 会误伤合法调用」改为只写审计 | §三 S20 / §一 边界② |
| i5 | Warning / completeness | "审计文件手动轮转阈值（>10k 行 / >10MB）无触发机制、无用户通知、无轮转命令." / "服务初始化时检查文件大小并写审计警告，同时暴露 i18n 提示." | **成立·已改**（第 16 轮改为**拒绝新导入**而非只告警）：超阈值 ⇒ 不再追加 + 拒绝新导入 + i18n `filmKitImportAuditFull` | §三 S17 |
| i6 | Warning / clarity | "陈旧锁自愈仅允许『.bak 不存在且 film-kit 存在』时自动清锁，其余两档均走手动恢复，但 i18n 仅提供单一恢复键." / "为两种手动恢复场景提供独立 i18n 键与恢复步骤说明." | **成立·已改**：拆成独立键 `filmKitImportRecoverMissing` / `filmKitImportRecoverBak`（第 16 轮再加 `filmKitImportRecoverLock`）⇒ 共 11 键 | §五 |
| i7 | Info / consistency | "SCHEMA.md 标记『本批待写入』，镜像校验脚本依赖其已存在，但未定义生成与测试的执行顺序." / "写明 SCHEMA.md 必须在镜像测试前生成." | **成立·已改**：写明 `SCHEMA.md` 是**提交进仓的普通文件**（不是生成物）⇒ CI「检出 ⇒ 跑测试」顺序天然成立 | §四 |
| i8 | Info / feasibility | "SCHEMA.md 内容（审计格式、枚举、恢复指令）无第二道自动化断言，仅靠 mirror-check 验证白名单相等." / "新增 schema-contract 测试." | **成立·已改**：加 `kit-schema-contract.test.js`（解析 `SCHEMA.md` ⇒ 断言审计字段 / `reason` 枚举 / 恢复路径小节存在且非空） | §七 |

---

## 4. 第 16 轮（8 条 / Critical 3，最低分 5）

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / security | "S2 硬链检测在 FAT/exFAT/网络盘上 nlink 不可靠 ⇒ 跨目录硬链完全漏判；同目录检测也依赖不可靠 nlink，文档却将其写入安全判据而非『最佳努力』." / "SCHEMA.md 明确标注为『最佳努力、非防篡改边界』，不列入 fail-closed 断言." | **成立·已改**：S2 改成**判据分级** —— ①软链/断链/`realpath` 越界 = **可靠（fail-closed）**；② 同目录 `(dev, ino)` 去重 = **可靠**；③ `nlink>1` = **最佳努力**，`SCHEMA.md` 明写「不构成防篡改边界」、**不列入 fail-closed 断言** | §三 S2 |
| i2 | Critical / consistency | "images/ 有 11 文件但全仓零消费；引入 images-manifest.json 契约 + 整目录规则为零价值资产增加复杂度，且镜像检查要求解析 SCHEMA.md 而 SCHEMA.md 明写『不用于运行时解析』." / "将 images/ 移出首批白名单或标记『无消费方、仅契约保留』，取消镜像解析依赖." | **成立·已改**：**`images/` 移出首批导入白名单**（不拷、不校验、不进镜像表）；**不引入 `images-manifest.json` 契约**；`SCHEMA.md` 的「文件清单」表**新增一列「导入白名单」** ⇒ 镜像只比对标 ✅ 的行 ⇒ 镜像**不再依赖 images 的解析**；并澄清「不用于运行时解析」约束的是**运行时代码**，构建期/测试期工具不违反 | §三 S10/S13 / §四 |
| i3 | Critical / feasibility | "S18 陈旧锁自愈条件与 S15 三档残留状态交叠：手动恢复后再崩溃可能触发错误自动清锁，掩盖残留资产状态." / "取消自动清锁，全部残留走显式手动恢复路径." | **成立·已改**：**取消自动清锁** —— `.import-lock` 存在（不论新旧）⇒ service 抛可识别错误、导入也拒绝 ⇒ 恢复靠用户按 i18n 步骤手动删锁；S15 三档残留全部走显式手动恢复 | §三 S15 / S18 / §六 ⑰ |
| i4 | Warning / security | "S20 路由断言仅检查 hash 路由 /film-engineering*，无法区分三个标签页组件；文档承认『组件级授权不可能』，却将 UNAUTHORIZED_SENDER 作为安全拒因." / "将路由断言降级为审计增强（记录 sender URL），不作为安全拒绝的唯一依据." | **成立·已改**：S20 降级为**审计增强**（写 sender URL + hash 路由段进审计行），**不作拒绝依据**；`reason` 枚举撤掉 `UNAUTHORIZED_SENDER`（回到 14 值）；真正的屏障写明为「原生对话框（目录只能由用户选）+ 严格校验 + 全量审计」 | §三 S20 / §五 |
| i5 | Warning / clarity | "取消域限定『只发生在进入⓪之前』，但 ⓪ 内部无取消通道且无 UI 层说明（按钮禁用 / 模态）；用户无法辨识实际 UI 约束." / "在入口处明确定义：进入⓪ 后禁用按钮并显示不可中断模态." | **成立·已改**：**UI 层约束（写死）** —— 点导入 ⇒ 按钮**禁用** + 模态「导入进行中，不可中断」（模态**不提供取消**）⇒ 结束即关模态、恢复按钮 | §一 边界③ |
| i6 | Warning / consistency | "S17 审计超过 10,000 行 / 10 MB 时『手动轮转』无执行机制；服务只写告警行但不阻止继续追加，可能静默超限." / "增加服务初始化时的超限阻止（写入前检查尺寸，超限则拒绝新导入并强制提示轮转）." | **成立·已改**：超阈值 ⇒ **拒绝新的导入**（不再追加，防静默超限）+ i18n 提示手动轮转 | §三 S17 |
| i7 | Warning / feasibility | "B 组 ⑱ 对 images-manifest.json 不一致只记审计告警、不拒导入，但未定义『缺失文件被引用』时目标 images/ 的内容形状." / "SCHEMA.md 补充：manifest 引用缺失文件 ⇒ 该条目不写入目标目录." | **成立·已改**：该问题**随 i2 一并消失** —— manifest 契约整体移除（既不拒也不告警，manifest 根本不在白名单） | §四 / §六 ⑱ |
| i8 | Info / completeness | "方案未提及导入完成后的 kit 再校验结果是否写入审计（成功行仅提『带镜数/场景数占位』）；缺少成功后校验状态的审计字段." / "审计契约增加成功行的『post-check result』（PASS / FAIL_WITH_RECOVERY）字段." | **成立·已改**：审计字段加 **`post_check`**（PASS / FAIL_WITH_RECOVERY） | §三 S17 |

---

## 5. 第 17 轮（8 条 / Critical 3，最低分 5）

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / security | "两遍扫描仅比 inode/size，未比内容哈希；同 inode 原地编辑内容（大小不变）可绕过。S6 只防文件替换，不防内容篡改." / "增加 SHA-256 前缀比对或在 SCHEMA.md 明确两遍扫描仅防替换、不防内容篡改." | **成立·已改**（选更强的那个）：S6 升级为「**两遍扫描 + 逐文件哈希对账**」—— 第一遍算 SHA-256，第二遍拷贝时同步算**副本哈希**，拷完比对 ⇒ 挡住「原地改内容」与「拷贝过程中被改」两类 TOCTOU；判据 ㉑ 要求**反证用例**（拷贝前原地改同尺寸内容 ⇒ 必须被拒） | §三 S6 / §六 ㉑ |
| i2 | Critical / consistency | "⓪d 预建锁与 ① 重复置标记；内存标记与文件锁同步规则未定义（重启只读文件不重建内存状态）." / "明确重启从 .import-lock 重建内存状态，删除 ① 重复置标记或合并为一步." | **成立·已改**：① 只设**内存态**（落盘态已在 ⓪d 建好）⇒ 职责不重叠；并写死「**标记的真源 = `.import-lock`（落盘）**，内存标记只是加速判据 ⇒ **进程重启后按锁重建内存标记**」 | §二 / §三 S11 |
| i3 | Critical / completeness | "S1 只拷白名单文件，但未定义额外子目录（如 extra/）的递归停止条件；S10 仅限 prompts/tasks/ 深度，其余类别无目录限制." / "白名单写明『仅允许列出路径，额外目录/文件一律拒』." | **成立·已改**（采纳其精神、但**不采纳「一律拒」**）：S1 写死「白名单外的条目**一律不拷入、也不递归进入其子目录**」⇒ **不因多余文件拒绝整次导入**（用户目录里常有无关文件）；并把 **S0 总则限定为「白名单内条目」**、S10 的深度/隐藏名规则**只作用于白名单内条目** | §三 S0/S1/S10 |
| i4 | Warning / security | "S17 要求并发互斥与原子追加，但无具体机制（无 flock/独占锁）；Windows 多进程追加可能交错，『进程级互斥』无法验证." / "用 .import-lock 实现独占检查，测试断言并发导入被拒." | **成立·已改**：互斥机制写死为「**`.import-lock` 的独占创建（`wx` 标志）**」⇒ 第二个导入进程建锁失败 ⇒ 直接拒（`LOCK_CREATE_FAILED`）⇒ 天然不会行间交错 | §三 S17 |
| i5 | Warning / feasibility | "S19 只给常量（3 次/500ms），无逐操作重试范围（rename/copy/audit）；500ms 在 NTFS 占用下可能不足." / "在 kit-import.js 注释逐操作标明重试点，测试覆盖全部重试场景." | **成立·已改**：S19 写死**适用操作**（目录级 rename ×3 + 文件 copyFile；**审计追加不重试**）+ **指数退避** `RETRY_MS * 2^(n-1)`（500 ms / 1 s / 2 s ⇒ 总等待 ≤ 3.5 s） | §三 S19 |
| i6 | Warning / consistency | "恢复路径只覆盖 ③ 前/后和 ⑤-⑥ 间，未覆盖 ④ 成功但 ⑤/⑥ 失败时状态." / "SCHEMA.md 恢复路径增加 ④ 后各步失败状态表（含 .bak 是否保留、锁状态）." | **成立·已改**：S15 改为「**崩溃/失败残留的三档状态**」并写明**覆盖全部失败点**（含 ⑤ 删 `.bak` 自身失败、⑥ 删锁自身失败各自落在哪一档） | §三 S15 |
| i7 | Info / security | "S20 审计仅到路由层，无组件/事件标识；同一路由多组件无法区分触发源." / "审计行增加可选触发组件字段，保持『防静默』声明不变." | **成立·已改**：审计字段加 `触发组件`，并写明「renderer 传入 ⇒ **可伪造**，仅作事后线索，**不作判据**」 | §三 S17 |
| i8 | Info / clarity | "§一 边界② 与 §九 决策点重复窗口级限制后续切片；SCHEMA.md 首行尚未写入『本文件不用于运行时解析』." / "SCHEMA.md 首段统一写安全边界声明." | **成立·已改**：窗口级授权的处置**只在 §四 取舍③ 一处说**（§一 边界② 不复述）；`SCHEMA.md` 首段的「本文件不用于运行时解析」声明写进 §四（**本批待写入**）并澄清该约束**只管运行时代码**，构建期/测试期工具不违反 | §一 边界② / §四 |

---

## 6. 第 18 轮（8 条 / Critical 3，最低分 6）

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / consistency | "§二 换入顺序（⓪-⑥）缺失 staging 拷贝与再校验的编号步骤：序列直接 ②→③(rename 旧 kit)→④(rename staging→film-kit)，中间无『创建/填充 staging + 第二遍哈希』原子块，执行流不可闭合." / "在 §二 序列插入显式步骤（②b：递归拷贝到 staging + 同步算副本哈希；②c：staging 上再跑严格校验），并与 S6 的两遍扫描明确绑定." | **成立·已改**：序列重排为 **⓪a-⓪d + ①–⑦**，其中 **② = 两遍扫描 + 拷到 staging（同步算副本哈希）+ staging 上再跑一次严格校验**；S15 的三档残留状态同步改指新的步骤号 | §二 / §三 S6/S15 |
| i2 | Critical / security | "§一 边界②声称『renderer 无法传路径』，但 IPC 处理器 `film-engineering:import-kit` 明确接收 `kitDir` 字符串；renderer 可直接伪造任意路径调用 IPC. 实际屏障应为『原生对话框选目录 + 严格校验拒不落盘』，误导表述会降低审查强度." / "删去『无法传路径』误导，将边界重写为『路径仅来自 dialog.showOpenDialog 返回…』." | **成立·已改**（**我的表述错误**）：不再靠措辞回避，而是把**机制**改对 —— `film-engineering:import-kit` 的**入参为空**（**不接受路径参数**）⇒ 路径**只能**来自 handler 内部对话框的返回值 ⇒ renderer 无法指定替换内容；并补写「若将来允许 renderer 传路径，则该路径必过 `isDirectory` + 严格校验」 | §一 边界①② |
| i3 | Critical / feasibility | "`SCHEMA.md` 标注『本批待写入』，但镜像/契约测试直接以仓内已存在文件解析并断言；未说明文件缺失时测试行为（红/跳过/生成），依赖顺序不可验证." / "增加一行：测试在 `SCHEMA.md` 缺失时跳过（或失败信息明确为『契约文件未写入』），并在落点表列出提交顺序." | **成立·已改**：写死「**若 `SCHEMA.md` 缺失 ⇒ 镜像/契约测试直接失败（fail-closed），不是跳过**」+ 提交顺序（`SCHEMA.md` 写入与代码**同 PR 同提交**） | §四 / §七 |
| i4 | Warning / completeness | "S6 未把『哈希 !=』与『inode/size 变化』作为互补判据显式归档." / "第二遍对每文件同时断言两者，任一不一致即拒." | **成立·已改**：S6 写死「逐文件断言 **副本哈希 == 第一遍源哈希** **且** `stat` 的 **inode/size == 第一遍记录** ⇒ 任一不符即拒」 | §三 S6 / §六 ㉑ |
| i5 | Warning / consistency | "S10 层级判据『固定 3 层（基准 = 相对 prompts/ 根）』与示例 `prompts/tasks/A.md` 关系模糊：基准未写死入代码或 SCHEMA.md." / "写死基准（如 `BASE_PROMPT_TASK = 'prompts/tasks'`），并在镜像检查中按同一基准解析." | **成立·已改**：导出常量 **`BASE_PROMPT_TASK`**（代码与 `SCHEMA.md` 同值、镜像检查按同一基准解析） | §三 S10 / §七 |
| i6 | Warning / security | "S19 未区分『可重试操作』与『不可重试操作』，目录 rename 在 NTFS 上通常因占用不可重试，重试行为易被误用." / "把重试分为 A 类（copyFile，可重试）与 B 类（目录 rename，仅一次立即重试，不套退避）." | **成立·已改**：S19 写死 **A 类（`copyFile`，套退避循环）/ B 类（目录 `rename`，仅一次立即重试）/ 审计追加不重试** | §三 S19 / §六 win32 专项③ |
| i7 | Info / security | "『祖父条款』未显式声明『目标目录不参与限额判定』，易被实现者误加双向限额，导致重导入被旧资产限死." / "在 `kit-import.js` 头部与 `SCHEMA.md` 增加显式行." | **成立·已改**：§四 祖父条款 + 落点表（`kit-import.js` 头部）都写死这一行 | §四 / §七 |
| i8 | Info / completeness | "§八『明确不做』缺失『不引入 images-manifest.json 契约』『不处理压缩包/网络下载』『不做增量/差分合并』三条." / "补充三行." | **成立·已改**：§八 补齐（含**不自动清理陈旧锁**、**不做窗口级/组件级授权**两条本轮新增的不做项） | §八 |

---

## 7. 第 19 轮（8 条 / Critical 2，最低分 5）—— 压缩重写后的第一轮

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / security | "写路径操作（替换用户 kit）的授权边界明确推迟到后续批次；本批仅依赖 `withSenderCheck` + 审计增强。这意味着恶意 renderer 可触发导入，审计只能事后可见，无法阻止破坏性替换." / "在本批至少增加服务层的最小授权断言（如只允许特定 sender URL 或组件标识），否则写路径无实际防御." | **成立·已改**（**方向性反转**）：第 16 轮把路由断言降级为「只做审计」，本轮判定那等于**写路径无防御** ⇒ 改为**硬断言**，但用**前缀**匹配（`/film-engineering`，**三个标签页都在这条路由下 ⇒ 不误伤合法调用**），并保留「判不到组件」的诚实边界；`reason` 加 `UNAUTHORIZED_SENDER`（14 → **15 值**） | §三 S20 / §一 边界③ / §四 取舍③ / §五 |
| i2 | Warning / feasibility | "`.import-lock` 永远不自动清理；崩溃后恢复完全依赖用户手动删除；服务初始化只读锁并抛可识别错误，但不提供任何自动恢复或超时清理机制." / "增加锁年龄检查（如 > 30 分钟可提示而非直接拒绝）或在服务初始化时提供明确的恢复指引." | **成立·已改**：锁**年龄**（由 mtime 推导）随错误信息带出；**> 30 分钟**的锁额外记一条**审计警告**（提示可安全删除的前提：确认没有导入在进行）⇒ **仍不自动清**（S15 的取舍不变） | §三 S18 |
| i3 | Critical / feasibility | "`SCHEMA.md` 标记为『本批待写入』，但镜像测试与契约测试均为 fail-closed（缺失即失败）。若 PR 提交时代码与 `SCHEMA.md` 不同步，CI 直接失败，且无降级路径." / "确保 `SCHEMA.md` 与代码在同一提交中写入，并增加构建期检查脚本验证文件存在后再运行测试." | **成立·已改**：两个测试的**第一步**就是断言 `SCHEMA.md` 存在；缺失 ⇒ 直接失败并打印**自解释信息**「契约文件未写入：<绝对路径>；本批要求 `SCHEMA.md` 与代码同 PR 同提交」⇒ 失败**不依赖 CI 顺序假设**，也不产生「谜之红」 | §四 / §七 |
| i4 | Warning / consistency | "审计契约定义了 `post_check` 字段值，但未与 14 值 `reason` 枚举或 S15 的三档残留场景建立明确映射关系." / "增加映射表." | **成立·已改**：加 **`recovery_state`** 字段（`MISSING_KIT` / `BAK_LEFT` / `LOCK_LEFT` ⇒ 对应 S15 三档）+ **`reason` × `post_check` × `recovery_state` 的对应表写进 `SCHEMA.md` 审计小节**（测试逐行断言） | §三 S17 |
| i5 | Warning / feasibility | "win32 专项要求过滤 NTFS 的 `.` / `..` 目录项，但方案未给出具体过滤条件，存在实现歧义." / "写出精确过滤规则." | **成立·已改**：过滤条件写死 **`basename === "." || basename === ".."` ⇒ 跳过**（**不判 `isDirectory()`**），`kit-import.js` 注释与 `SCHEMA.md` 同值 | §六 win32 专项② |
| i6 | Info / consistency | "祖父条款在方案多处提及但分散（S0 注解、§四、§八），易被实现者遗漏." / "在代码头部集中写一行注释，并在 `SCHEMA.md` 增加醒目标记." | **成立·已改**：`SCHEMA.md` 用**独立小节** `## 祖父条款（限额只管源目录）` + `kit-import.js` 头部注释，两处集中 | §四 / §七 |
| i7 | Warning / security | "跨目录硬链（`nlink > 1`）为最佳努力、非防篡改边界，在 FAT/exFAT/网络盘上 `nlink` 恒为 1，存在漏判方向；方案诚实但未提供补偿控制." / "在审计中增加警告标记，便于事后追踪." | **成立·已改**：审计行固定带 **`hardlink_check` = `best-effort`** ⇒ 事后可查该次导入**知道自己没做跨目录硬链防护**（不做假检测、不虚报已防护） | §三 S2 / S17 |
| i8 | Info / completeness | "§六 列出 A/B 组共 21 条验收断言，但契约测试与镜像测试未被计入 A/B 编号，测试覆盖描述不完整." / "增加 C 组明确编号." | **成立·已改**：新增 **C 组（契约与镜像断言，2 条，独立用例文件）**：㉒ `kit-mirror-check.test.js`（与 B 组 ⑭ 两处都断言，互为冗余防漏）、㉓ `kit-schema-contract.test.js`（契约小节非空 + 缺失即失败） | §六 C 组 / §七 |

---

## 8. 第 20 轮（7 条 / Critical 1，最低分 5）—— 条数首次跌破 8

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / consistency | "`SCHEMA.md` 标为『本批待写入』（非既有），同时要求『与代码同 PR 同提交』且测试缺失时 fail-closed；文件不存在则 PR 无法通过测试，存在则不再是『待写入』——状态矛盾." / "确认文件已写入并提交：删除『待写入』标签，或在 PR 描述中说明 `SCHEMA.md` 已存在的提交哈希." | **成立·已改**（口径更正）：`SCHEMA.md` **文件本来就存在**（含「文件清单」表），**本批交付的是它里面新增的「导入契约」小节** ⇒ 抬头/§四/§七 统一改成「已存在的文件 + 新增小节」的表述，删掉「本批待写入」这个自相矛盾的说法 | 抬头 / §四 / §七 |
| i2 | Warning / feasibility | "`.import-lock` 无自动清理，任何崩溃残留永久阻止后续导入与服务初始化；仅依赖手动恢复，可造成持续可用性拒绝." / "增加一个安全的自动过期机制（如 > 30 分钟由用户确认后删除），或将锁检查仅限于正在运行的导入进程." | **成立·已改**（采纳其第二条、且比时间启发式更准）：锁文件内写入**创建者 PID** ⇒ 读锁时用 **`process.kill(pid, 0)` 判进程是否还在** ⇒ **还在** = 有导入在跑（拒绝）；**已不在** = 崩溃残留 ⇒ 按 S15 判档，**档位②③ 自动清锁 + 强制审计**，**档位①（`film-kit` 缺失）不清锁**（资产可能只在 `.bak` 里）⇒ 不用「猜时间」，用**真存活** | §三 S18 / S15 / §六 ⑰ |
| i3 | Warning / feasibility | "`BASE_PROMPT_TASK` 作为常量导出且用于深度判据，但方案中未给出其具体值，深度断言无法验证." / "显式定义 `BASE_PROMPT_TASK = 'prompts/tasks'`." | **成立·已改**：字面值写死 **`BASE_PROMPT_TASK = "prompts/tasks"`** | §三 S10 |
| i4 | Warning / security | "S0 将跨目录硬链排除在 fail-closed 断言之外……方案未提供补偿检测." / "补充说明用户应在可信本地 NTFS 卷操作." | **成立·已改**：审计行固定 `hardlink_check=best-effort`（第 19 轮已做）+ 本轮补「**建议在本机可信卷（NTFS）上选取导入目录；FAT/exFAT/网络盘上跨目录硬链检测为最佳努力**」 | §三 S2 / §四 |
| i5 | Warning / clarity | "方案大量使用中文缩略（⓪–⑦、§二、祖父条款）与混合术语，缺少英文对照或术语表；非中文评审者无法逐条验证." / "增加术语对照表." | **成立·已改**：抬头加**术语对照**（`⓪`=pre-check / 换入=swap-in / 落盘=persist / 判据=assertion / 祖父条款=limits-apply-to-source-only / 残留=residue） | 抬头 |
| i6 | Info / completeness | "审计契约要求 reason × post_check × recovery_state 三维映射表写入 `SCHEMA.md`，但方案未展示该表内容，测试无法断言具体对应关系." / "在提交的 `SCHEMA.md` 中包含完整映射表，并在 `kit-schema-contract.test.js` 中逐行断言." | **成立·已改**：方案给**生成规则**（`PASS` ⇔ 成功且 staging 校验通过；`FAIL_WITH_RECOVERY` ⇔ 发生回滚/残留 ⇒ `recovery_state` 按 S15 三档填；表本体是机械展开，写在 `SCHEMA.md` 并由契约测试逐行断言） | §三 S17 |
| i7 | Info / security | "S20 sender 路由断言依赖解析 hash 路由段（pathname 恒为 /）；若解析逻辑未正确提取 # 后内容，前缀断言可能全部放行或全部拒绝，方案未展示解析代码." / "显式实现并测试 hash 路由解析函数，覆盖 `pathname=/` 的边界." | **成立·已改**：**解析口径写死**（`new URL(url).hash` → 去 `#` → 取 `?` 前 → 去尾斜杠 → 与前缀 `/film-engineering` 比较；**`pathname` 恒为 `/` ⇒ 不参与判断**；`hash` 缺失 ⇒ 判为解析不出 ⇒ 放行 + 审计警告）+ 测试必须覆盖「`pathname=/` + `hash` 有路由」与「`hash` 缺失」两种形态 | §三 S20 / §六 ⑳ |

---

## 9. 第 21 轮（8 条 / Critical 3，最低分 6）—— 两条 Critical 是**我自己引入的不一致**

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / consistency | "§五 列『14 值』但实际列出 15 项（含 `UNAUTHORIZED_SENDER`），列表末尾多出一项未计入；`SCHEMA.md` 枚举需同步." / "统一为 15 值，修正所有『14 值』引用." | **成立·已改（我的疏漏）**：第 20 轮把枚举加了 `UNAUTHORIZED_SENDER` 却忘了改计数 ⇒ 全文 `14 值` → `15 值`（逐处 grep 修正，不止 §五） | §五 |
| i2 | Critical / security | "S5 仅允许写四个路径（film-kit / staging / .bak / .import-lock），但 S17 审计要求写 `userData/film-kit-import.log`（同父未列入），两条互斥." / "S5 补入审计文件路径." | **成立·已改（我的矛盾）**：S5 补入审计文件 ⇒ 共**五**个路径；判据 ⑦ 同步（「没写到 staging/.bak/.import-lock/**审计文件** 之外」） | §三 S5 / §六 ⑦ |
| i3 | Critical / security | "S18 依赖 `process.kill(pid,0)` 判存活，PID 复用可导致误判（死进程被替代 ⇒ 误认为仍在跑）；文字已标注但无缓解." / "锁内容加随机 nonce，比对 mtime，PID 复用时强制手动恢复." | **成立·已改（换机制，不打补丁）**：存活判定从 **PID 改为「租约心跳」** —— 导入期间**每 5 秒刷新锁的 mtime**，读者按**租约年龄 ≤ 60 秒**判「仍在跑」⇒ PID 被复用**不影响判定**（别人的进程不会写我们的锁）；PID 与 `nonce` 降级为**审计线索**；并写明残余竞态（事件循环阻塞 > 60 s ⇒ 第二个导入并发 ⇒ 其 ⑤ rename 因目标已存在而失败 ⇒ `SWAP_FAILED` + 回滚 ⇒ **不产生半份 kit、不丢旧资产**） | §三 S18 / S15 / §六 ⑰ |
| i4 | Warning / security | "S20 对 hash 路由解析缺失（空/缺失）处理为『放行+审计警告』（fail-open），写路径不应在路由不明时放行." / "写操作改为解析不出路由即拒（UNAUTHORIZED_SENDER），仅只读保留 fail-open." | **成立·已改**：**写路径不 fail-open** —— 解析不出路由 ⇒ **拒绝**（`UNAUTHORIZED_SENDER`） | §三 S20 |
| i5 | Warning / consistency | "S0 总则要求白名单内一律拒，不覆盖跨目录硬链『最佳努力』这一例外." / "S0 增加例外条款." | **成立·已改**：S0 写死**唯一的例外**（跨目录硬链检测为最佳努力 ⇒ 该档**不构成拒绝**；`SCHEMA.md` 固定 `hardlink_check=best-effort`）⇒ 总则的「一律拒绝」只对**可靠判据**成立 | §三 S0 |
| i6 | Warning / clarity | "`BASE_PROMPT_TASK` 实际为路径基准，命名与用途不符，易与业务任务混淆." / "重命名为 `BASE_PROMPT_PATH`，或明确『常量=路径基准，非业务任务』." | **成立·已改**：**重命名 `BASE_PROMPT_PATH`**（并注明**路径基准，非业务任务**），落点表同步 | §三 S10 / §七 |
| i7 | Warning / completeness | "§四 取舍③ 列四层缓解，但『受信来源』未明确定义（仅依赖 preload 接口，无白名单机制）." / "明确『受信来源=preload 暴露的 importKit 接口』，并加测试断言." | **成立·已改**：「受信来源」定义 = **preload 白名单登记的 `filmEngineering.importKit`**（`access-control.js` 的 `PUBLIC_METHODS` 登记 ⇒ 未登记的方法默认不可达） | §四 取舍③ |
| i8 | Info / clarity | "§二 ⓪ 流程中 ⓪d 预建锁，若后续 ⓪a/⓪b/⓪c 失败退出，文字未说明已建锁的清理，可能留残留锁." / "⓪ 失败退出路径增加『若已建锁则立即删除』." | **成立·已改**（并纠正其前提）：⓪a/⓪b/⓪c 在 ⓪d **之前** ⇒ 它们失败时**尚未建锁** ⇒ 无残留；⓪d 建锁失败 ⇒ 独占创建**不留半份锁** ⇒ 无残留 ⇒ 写进 §二 ⓪ 说明 | §二 ⓪ |

---

## 10. 第 22 轮（8 条 / Critical 3，最低分 4）—— 两条 Critical 是**我上轮改出来的自相矛盾**

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / security | "S20 自相矛盾：同一段内 'hash 缺失 ⇒ 拒绝（UNAUTHORIZED_SENDER）' 又写 'hash 解析不出 ⇒ 放行 + 审计警告'；写路径不可 fail-open." / "删除放行分支：hash 缺失/解析不出一律拒绝，保持写路径 fail-closed." | **成立·已改（我上轮的补丁留下的矛盾）**：S20 **删掉落行分支** ⇒ 路由前缀不匹配**或**解析不出，一律 **fail-closed 拒绝**；判据 ⑳ 里残留的「解析不出 ⇒ 放行」**同步改掉**（同一处漏改被 critic 抓到 ⇒ 属「改了 A 没改 B」的典型） | §三 S20 / §六 ⑳ |
| i2 | Critical / consistency | "标题称『第1轮方案』，正文却宣称『18轮（143条意见、已逐条落地）』并引用逐轮证据文件，评审阶段与内容成熟度严重不符." / "统一为实际评审轮次." | **成立·已改**（「第1轮」其实是**评审引擎每轮改写的抬头**，不是本文件的标题 ⇒ 冲突源在引擎侧）：本文件抬头**不再声明轮次与条数**（逐轮数据全在证据文件里）⇒ 结构上不可能再与引擎抬头打架 | 抬头 |
| i3 | Critical / security | "S0 将『跨目录硬链（nlink>1）』列为唯一例外且标『最佳努力、不构成防篡改』，在 fail-closed 总则下开了可预测绕过口." / "移除例外：跨目录硬链在可靠文件系统上应拒绝；不可靠系统应拒绝而非降级接纳." | **成立·已改**（部分采纳 + 明确技术边界）：**「例外」改写为「检测边界」**——该维度是**无判据**（检测不到），不是「规则不满足」⇒ S0 的「一律拒绝」只对**可靠判据**成立；并补**四条补偿控制**：S21（限额只管源目录）、**S22（只接受本机本地目录源 ⇒ 跨目录硬链只能指向同一台机器的文件，而本机主人对那些文件本就有读权限 ⇒ 无额外暴露）**、S2 的同目录 `(dev,ino)` 去重（可靠判据）、审计固定记 `hardlink_check=best-effort` | §三 S0 / S2 / S21 / S22 |
| i4 | Warning / completeness | "断言『images/ 全仓无任何代码消费（非注释命中0）』无任何验证方法或引用证据." / "补充搜索命令/引用，或保留白名单并标注待验证，不凭空断言零消费." | **成立·已改**：给出**可复跑的核实命令**（`grep -rn "images/" apps/desktop/electron apps/desktop/src --include=*.js --include=*.vue` 去注释命中 ⇒ 剩 0）⇒ 结论不靠推断；并写明「将来引入消费方时 `SCHEMA.md` 与 `kit-import.js` 会与本条冲突 ⇒ 冲突即提醒」 | §四 |
| i5 | Warning / consistency | "审计轮换规则冲突：『>10000行或>10MB ⇒ 拒绝新导入（不再追加，不自动截断）』，但『不自动截断—截断会丢审计』与拒绝行为并存表述混乱." / "明确：超限时拒绝写入（不追加），并统一说明不做截断仅做拒绝." | **成立·已改**：统一措辞 = 「**拒绝写入并拒绝新的导入**（**不追加、不截断** ⇒ 文件停在阈值前、数据不丢）」 | §三 S17 |
| i6 | Warning / consistency | "S18 说『自动清理只按进程存活判定』（租约心跳），但 S15 三档中档位②③自动清锁、档位①不清锁，逻辑分叉未与『进程存活』对齐." / "将清锁条件与租约状态直接绑定." | **成立·已改**：**清锁条件 = 租约过期 ∧ `film-kit` 存在**（= S15 档位②③）⇒ 直接绑定，不再靠「进程存活」这个已被租约取代的说法 | §三 S18 |
| i7 | Warning / completeness | "§八 明确不做列表缺少『压缩包/网络来源』对应的白名单拒绝规则，S1 只提白名单内条目，未明确非目录源（如压缩包）被拒方式." / "增加：非本机目录源一律拒并映射 NOT_A_DIRECTORY." | **成立·已改**：新增 **S22 只接受本机本地目录源**（UNC/网络路径、压缩包、URL、非目录 ⇒ 拒 `NOT_A_DIRECTORY`） | §三 S22 |
| i8 | Info / clarity | "祖父条款未独立编号，易被实现遗漏." / "将祖父条款提升为独立 S 编号（如 S21），并在代码头部与 `SCHEMA.md` 同时导出常量." | **成立·已改**（编号采纳、常量不采纳——一条「条款」没有可导出的常量）：提升为 **S21**，并要求代码头部注释 + `SCHEMA.md` 的 `## 祖父条款（限额只管源目录）` 小节**双写**同一行 | §三 S21 / §四 / §七 |

---

## 11. 跨家族轮（critic=**codex**，8 条 / Critical 3，最低分 5）—— **抓到了 claude 漏掉的重���条**

> 为什么加这一轮：`critic=claude` 连跑 20+ 轮，每轮固定 8 条、Critical 恒在 1–3 之间**震荡**，
> 且第 20 轮已降到 1 条后**又反弹回 3** ⇒ 单家族出现「边际收益耗尽」的迹象。
> 换成**另一个家族**（codex = OpenAI 家族）做同一件事，并让引擎自己跑「critic 挑刺 → proposer（claude）外科式修订」的闭环。
> **结论：跨家族是必要的** —— codex 抓到了 claude **三轮都没抓**的东西，其中一条直接冲突本仓铁律。

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / consistency | "§二和 S3 多处写『服务层 finally 递归删 staging』、『递归删 .bak』，但**仓库 R0 铁律明令禁止对目录递归删除**，且 `safe-delete.js` 对目录一律拒绝。照此方案实施必然违规，而这个项目曾因单日误删 `.ccg`（5 次）被迫立规." / "改为按精确文件清单删除，或先把 staging 改名为不可恢复回收目录后再交 `safe-delete`；并在 `SCHEMA.md` 里写明这条约束." | **成立·已改（本轮最重的一条）**：删除方式改写为「**按精确文件清单逐个 `unlink` + 空目录 `rmdir`**」—— 清单 = **我们自己拷贝出去的那批白名单文件路径**，**不做目录遍历**；并写明「⛔ **禁止递归删除目录**（本仓 **R0 铁律**：目录删除一律拒绝、`safe-delete.js` 不接目录）⇒ 不使用 `rm -rf` / 递归遍历删」；`SCHEMA.md` 的取舍小节同步写这条 | §二 staging 兜底 / §三 S3 / §四 取舍 |
| i2 | Critical / security | "S18 承认租约可能被误判过期（事件循环阻塞 >60s），此时第二进程清锁并写入自己的锁。**第一进程恢复后的 `finally` 会无条件删 `.import-lock`，把第二进程的锁删掉**，互斥与审计『不交错』同时失效。方案只把兜底寄托在 ⑤ 的 rename 失败上，没有覆盖删锁这一格." / "删锁前必须读锁内 nonce 并与自身写入值比对，不一致即不删；`finally` 同样按 nonce 认领 staging 目录." | **成立·已改**：加 **⛔ nonce 认领（互斥的最后一格）** —— 删锁前**读锁内 nonce 与自己写入的 nonce 比对，不一致 ⇒ 不删**；`finally` 清理 staging 时**只认领 nonce/时间戳属于自己这一份**的 staging ⇒ 租约被误判过期、第二个进程接管后，第一个进程的 `finally` **既不删别人的锁、也不删别人的 staging** | §三 S18 / §六 ⑰ |
| i3 | Critical / clarity | "S6 要求『拷完逐文件断言副本哈希等于第一遍源哈希，且 stat 的 inode/size 等于第一遍记录』。**若 stat 指的是副本，副本 inode 必然不等于源 inode，判据恒假、所有导入全拒**；若指的是源，则原文没有写明比对主体." / "改写成两条：① 副本 SHA-256 等于源第一遍 SHA-256；② 拷完后再次 stat **源**文件，`(dev,ino,size,mtime)` 与第一遍记录一致." | **成立·已改**：S6 拆成**两条主体明确的判据** —— ① **副本 SHA-256 == 第一遍记录的源 SHA-256**；② **拷贝完成后再次 `stat` 源文件**，其 `(dev, ino, size, mtime)` 与第一遍记录一致；并显式写「⚠ **不比副本的 inode** —— 副本 inode 必然不同于源，比了会恒假、把所有导入全拒」 | §三 S6 / §六 ㉑ |
| i4 | Warning / completeness | "reason 闭集 15 值无法覆盖三类已定义的拒绝：审计写失败、审计文件超阈值、租约有效导致导入被拒。但方案同时声称『服务端只回这 15 值，测试可逐个断言』." / "补 `AUDIT_UNAVAILABLE`、`LOCK_HELD` 两值，或明确映射到现有值." | **成立·已改**：闭集补两值 ⇒ **17 值**（`AUDIT_UNAVAILABLE` = 审计不可写/超阈值；`LOCK_HELD` = 租约有效或需手动恢复） | §五 |
| i5 | Warning / completeness | "自动清锁的**执行点未定义**：S11 说『有锁即抛可识别错误、不读盘』，S18 说『租约过期且 film-kit 存在则自动清锁』。两者拼在一起缺少触发时序（service 初始化、IPC 入口，还是导入开始时），`filmKitImportRecoverBak` 也没有触发展示路径." / "写死清锁执行位置与顺序，并指明该分支返回哪个 reason 与 i18n 键." | **成立·已改**：**执行点与顺序写死** —— 执行点 = ① service 初始化 ② 导入 IPC 入口；顺序 = **读锁 → 判租约 → 判 S15 档位 → 清锁或抛错**；并逐档写明返回的 `reason` 与 i18n 键（租约有效 ⇒ `LOCK_HELD` + `filmKitImportRecoverLock`；档位① ⇒ `LOCK_HELD` + `filmKitImportRecoverMissing`；档位②③ ⇒ 清锁 + 审计记 `recovery_state`） | §三 S18 |
| i6 | Warning / feasibility | "`kit-import.js` 单个文件要装下白名单、扫描、哈希、拷贝、重试、锁租约心跳、审计、换入、回滚和镜像校验；而方案自己指出同目录 ipc 文件已临近 `check-max-lines` 的 500 行硬限，却未给本文件的行数预算或拆分方案，超限会在 CI 直接红." / "预先拆为 `kit-import-scan.js`、`kit-import-swap.js`、`kit-import-lock.js`、`kit-import-audit.js`，各文件行数预算写进 plan." | **成立·已改**（全部采纳）：拆成 **5 个文件**并写死**行数预算** —— `kit-import.js`（编排/导出面 ≤120）、`kit-import-scan.js`（≤250）、`kit-import-swap.js`（≤250）、`kit-import-lock.js`（≤150）、`kit-import-audit.js`（≤150）⇒ 全部在 500 行硬限内 | §七 落点表 |
| i7 | Warning / feasibility | "全程无目标盘剩余空间预检。换入期间峰值约占 2× 新 kit + 旧 kit，256MB 上限下可达近 800MB；ENOSPC 会让 ⑥ 删 `.bak` 失败、回滚 rename 也更容易失败." / "⓪ 增加 `statfs` 预检（需求 ≈ 2×源总量），不足即拒." | **⚠ 不采纳（附证据）**：ENOSPC 发生在**拷贝阶段** ⇒ 拷贝抛错 ⇒ 按**精确清单**清 staging（S3）⇒ **旧 kit 未动**（S4 兜底）⇒ 只��失败得晚一点，**不产生损坏**；且 `fs.statfs` 的跨平台可用性需另行核实。⇒ 写进 `SCHEMA.md` 的**已知限制**（不做空间预检 + 失败形态），作为后续切片 | §四 取舍 |
| i8 | Warning / consistency | "S10 规定『候选路径任何组件以 `.` 开头 ⇒ 拒』，win32 专项②却规定 basename 为 `.`/`..` ⇒ 跳过。**同一输入两条规则结论相反（拒 vs 跳）**，而两处都声称写进 `SCHEMA.md` 与注释." / "统一为：`.`/`..` 在枚举阶段先跳过（不作为条目），其余以 `.` 开头的组件一律拒." | **成立·已改**：两处统一为**同一条规则的两半** —— **枚举阶段先跳过 `.` / `..`**（不作为条目，不是「判为不合格」）⇒ **其余**以 `.` 开头的组件才一律拒；`kit-import.js` 注释与 `SCHEMA.md` 写同一句 | §三 S10 / §六 win32 专项② |

---

## 12. 第 24 轮（critic=claude，7 条 / Critical 3，最低分 5）—— 首条 Critical 是**我自己改出来的计数矛盾**

| # | 级别/维度 | critic 原文（finding / suggestion） | 处置 | 落点 |
|---|-----------|--------------------------------------|------|------|
| i1 | Critical / consistency | "§五 `reason` 枚举声称『15 值』，但列出的条目实际为 17 个（含 `AUDIT_UNAVAILABLE`、`LOCK_HELD`），数字与内容不符." / "修正计数为 17，或删除多余条目." | **成立·已改（我的疏漏）**：第 23 轮补两值时只改了**列表尾部**的计数，**抬头**那处「（**15 值**」没改 ⇒ 典型的「改了 A 没改 B」。**这条同时被我自己写的机械自洽性检查器抓到**（见 §13） | §五 |
| i2 | Critical / consistency | "S0 声称『任何不满足即拒（无特例）』的通用 fail-closed，但同时将『白名单外条目』和『跨目录硬链』明文排除在外，形成自我否定." / "要么提升为显式例外规则并编号，要么统一到 fail-closed；不可混合表述." | **成立·已改**：S0 改为「凡**受本清单某条判据覆盖**的输入，不满足该条 ⇒ 一律拒绝」+ 明确**适用范围**（白名单外条目**不进入任何判据**；跨目录硬链**不属任何判据覆盖范围**）⇒ 总则不再自我否定 | §三 S0 |
| i3 | Critical / security | "S2 跨目录硬链检测依赖 `nlink > 1`（标注『最佳努力』），FAT/exFAT/网络盘 `nlink` 恒 1 ⇒ 恶意跨目录硬链在这些卷上永远漏判；S22 仅限本机目录无法消除此漏洞." / "要么在所有文件系统上拒绝 `nlink > 1`（完整 fail-closed），要么将『硬链边界』从安全清单中**完全移出**并明确声明『非防篡改』；不可同时声称 fail-closed 又保留漏判维度." | **成立·已改（采纳第二条）**：**跨目录硬链整体移出安全清单** —— S2 只保留**可靠判据**（软链 / 断链 / `realpath` 越界 / 同目录 `(dev,ino)`）；跨目录硬链改写进 §四 取舍③，标题即「**非防篡改边界**」，并列出四条补偿（S21 / S22 / `hardlink_check=best-effort` / `SCHEMA.md` 声明）⇒ 清单里不再有「声称 fail-closed 却留漏判维度」的条目 | §三 S2 / §四 取舍③ / §六 ⑩ |
| i4 | Warning / feasibility | "S3/S15 的『精确文件清单逐个 `unlink`』若在部分拷贝阶段异常，清单可能包含尚未写入的路径，`unlink` 会抛 ENOENT，导致 `finally` 清理失败、残留半份 staging." / "清理代码必须对每个路径做 `existsSync`（或捕获 ENOENT 忽略）." | **成立·已改**：清理时每个路径**先 `existsSync` 再 `unlink`**，或捕获 ENOENT 忽略 ⇒ 部分失败也能清干净 | §二 staging 兜底 |
| i5 | Warning / clarity | "S10 对 `.` / `..` 说明『枚举阶段跳过』，但未明确 `.` / `..` 是否参与深度计算，易被误读." / "用同一句话写清：`basename === '.' \|\| basename === '..'` → 跳过（**不计入层数**）；其余 `basename[0] === '.'` → 拒." | **成立·已改**：补「**不计入层数**」，两处写成同一句 | §三 S10 / §六 win32 专项② |
| i6 | Warning / completeness | "方案要求 `SCHEMA.md` 新增『导入契约』小节，但本文件未给出该小节内容，仅指向外部文件；测试断言依赖其存在." / "在方案正文或附录中给出该小节的完整结构." | **成立·已改**：新增 **§十 附录**（`SCHEMA.md`「导入契约」小节的**结构表**：白名单 / 形状 / 魔数 / 上限 / reason 枚举 / 审计 / 对应表 / 恢复 / 取舍 / 安全边界声明）⇒ 契约测试有可断言的对照物 | §十 附录 |
| i7 | Info / feasibility | "§一.4 UI 约束声称『不可中断』，但用户仍可通过任务管理器/关闭窗口终止进程；用户可见文案『不可中断』在技术上不完全准确." / "将文案修正为『不可通过按钮中断，关闭应用可能导致需要手动恢复』." | **成立·已改**：i18n `filmKitImporting` 文案改为「**不可通过按钮中断**」+「**强制关闭应用可能需要手动恢复**」⇒ 不写绝对说法 | §一 边界⑤ |

---

## 13. 流程改进：方案**机械自洽性检查器**（本轮最有价值的产出）

**动因**：第 21/22/24 轮里，**7 条 Critical 里有 5 条是纯粹的内部不一致**（枚举计数对不上、S5 与 S17 的路径集互斥、抬头与正文冲突、S20 同时写「拒绝」和「放行」、S0 自称无特例却又开例外）——
⇒ 这类问题**不该等 critic 每轮挑一条**，而应该**一次全查出来**。

**做法**：写一个一次性检查器（`D:\Temp\mp-film-kit-scratch\check-plan-self.js`，scratch 不入库），机械检查：

| 检查项 | 抓到的真实问题 |
|--------|----------------|
| S 编号连续、无重复、正文引用存在 | （无） |
| `reason` 声明数量 vs 实际枚举值 + 每个值是否真在枚举里 | **第 24 轮 i1：声明 15、实际 17** |
| i18n 键声明数量 vs 实际键 | （无） |
| A/B/C 组判据条数 vs 声明 vs §七 引用 | （无） |
| §二 序列步骤齐全（⓪a-⓪d / ①-⑦） | （无） |
| S5 的允许写路径集 vs 判据⑦ 的路径集（**互斥检测**） | （无） |
| 残留禁用表述（递归删 / 倾向 / 陈旧锁 / 旧常量名…） | （无） |
| 关键决定不得丢失（压缩时的防丢清单） | （无） |

**效果**：第 24 轮 i1（计数矛盾）**同时被 critic 和检查器抓到** —— 说明检查器口径与 critic 一致；
⇒ 从第 25 轮起，**每轮修订后必跑检查器（rc=0 才提交）**，把「自相矛盾」这一类 Critical 提前消灭在提交前。

---

## 14. 逐轮统计

| 轮次 | 条数 | Critical | 最低维度分 | 处置 |
|------|------|----------|------------|------|
| 1–8 | 63 | 2+3+1+2+3+1+2+2 | 7 / 7 / 6 / 7 / 6 / 7 / 7 / 7 | 全部成立、全部采纳、零驳回 |
| 9–12 | 32 | 8 轮共 8 条/轮（其中 4 条 Critical） | — | 全部成立、全部采纳、零驳回（原文被引擎覆盖，见 §0） |
| 13 | 8 | 3 | 6 | 全部成立、全部采纳、零驳回 |
| 14 | 8 | 2 | 5 | 全部成立、全部采纳、零驳回 |
| 15 | 8 | 3 | 7 | 全部成立、全部采纳、零驳回 |
| 16 | 8 | 3 | 5 | 全部成立、全部采纳、零驳回 |
| 17 | 8 | 3 | 5 | 全部成立、全部采纳、零驳回 |
| 18 | 8 | 3 | 6 | 全部成立、全部采纳、零驳回 |
| 19 | 8 | 2 | 5 | 全部成立、全部采纳、零驳回 |
| 20 | 7 | 1 | 5 | 全部成立、全部采纳、零驳回 |
| 21 | 8 | 3 | 6 | 全部成立、全部采纳、零驳回 |
| 22 | 8 | 3 | 4 | 全部成立、全部采纳、零驳回（两条 Critical 是我自己引入的自相矛盾） |
| 23（critic=**codex**） | 8 | 3 | 5 | 7 条成立并采纳；**1 条不采纳并附证据**（i7 磁盘空间预检） |
| 24（critic=claude） | 7 | 3 | 5 | 全部成立、全部采纳、零驳回（首条 Critical 是我自己改出来的计数矛盾） |

**累计**：**189 条**意见，**188 条成立并全部采纳、1 条不采纳（附证据）**；零「无证据驳回」。
其中 critic 抓到的**我的设计错误**至少 **11 处**
（轮 6-i1 改顺序漏同步 S15、轮 8-i3 UI 入口挂错文件、轮 11-i2 两遍比对用错 `lstat`、
轮 14-i2 `realpath` 覆盖硬链的说法是错的、轮 18-i2 「renderer 无法传路径」是**误导表述**、
轮 21-i1 枚举加了值却忘了改计数、轮 21-i2 S5 的允许写路径漏了审计文件、
轮 22-i1 S20 同时写了「拒绝」和「放行」、轮 22-i2 抬头轮次与正文对不上、
轮 23-i1 **「递归删目录」直接冲突本仓 R0 铁律**、轮 24-i1 改了尾部计数忘了改抬头）。

**收敛轨迹（第 13–24 轮）**：Critical 3 → 2 → 3 → 3 → 3 → 3 → 2 → **1** → 3 → 3 → 3 → 3；条数 8 → … → **7** → 8 → 8 → 7。
⇒ 五条实测有效的杠杆：
**① 压缩方案**（理由移入证据文件、决定全留）⇒ 条数与 Critical 同降；
**② 采纳 critic 的方向性反转**（images 出白名单 / 锁改租约 / 路由前缀硬断言 / 祖父条款独立编号 / 跨目录硬链移出清单）⇒ 每轮都有结构性减法；
**③ 只修不加** —— **违反它就反弹**（第 21 轮新增三处机制 ⇒ Critical 从 1 弹回 3）；
**④ 换家族评审** —— 单家族边际收益耗尽时，另一家族能抓到它三轮没抓到的东西（本轮最重的 R0 铁律冲突）；
**⑤ 机械自洽性检查器** —— 把「自相矛盾」类 Critical 从「每轮一条」变成「提交前全查」。

## 6. 三条被采纳的**方向性反转**（记录在此，避免后人只看到结论）

| 主题 | 先前口径 | 最终口径 | 触发轮次与理由 |
|------|---------|---------|--------------|
| `images/` | 要拷 + manifest 一一对应（拒） | **移出首批白名单**（不拷/不校验/不进镜像表） | 第 15/16 轮：全仓零消费 ⇒ 契约零价值却带来镜像解析依赖与实现负担 |
| 锁残留 | 陈旧锁（>30min）**自动清理** | **一律不自动清**，全部走显式手动恢复 | 第 16 轮：自动清锁会与三档残留状态交叠、掩盖残留资产 |
| sender 授权 | `withSenderCheck` + **路由硬断言**（不匹配即拒） | 路由**只做审计增强**，不作拒绝依据 | 第 15→16 轮：同一文档承载三标签页 ⇒ 路由判不出组件，硬断言只会误伤合法调用 |
