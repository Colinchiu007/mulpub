---
record: fix-douyin-security-cookie-names
task: 抖音签名 cookie 名两代形态修复——单一事实源解析 + legacy 回落 + 防再犯结构锁
date: 2026-10-13
# ↓ 只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除（登记随文件走，不进 gate-record-debt-ledger.json）
sync_status: PENDING
sync_reason: 本 PR（#3468）尚未合并，merge SHA 还不存在，无法收口
sync_backfill_owner: 下一个会话（docs 回填 PR）
---

## 本次执行记录：抖音签名 cookie 名不匹配修复（fix-douyin-security-cookie-names，2026-10-13）【混合 PR】

- **变更类型**：运行时代码（`packages/api-publish-engine/**`）+ 文档 ⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-douyin-security-cookie-names`（D 盘），裸分支 `fix-douyin-security-cookie-names`（基线 `origin/main` = `7851bd62e`）。
- **本 PR 不是 docs-only**：含运行时代码，`classify-docs-only.js` → false ⇒ 完整质量节拍。
- **共享根保持 main clean**：任务全程只在 worktree 落盘；`pre-code-edit-guard.ps1` 在共享根 exit 1（正确拒绝）、在 worktree exit 0；写保护 `Session Isolation Write Guard` = Running。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-fix-douyin-security-cookie-names`（D 盘）+ 裸分支；`verify-worktree-deps.js` OK（11 消费方 / 9 workspace 包解析到本 worktree）；共享根全程 `git status --porcelain` 为空、停留 main |
| 第一性原因（QM-5 ①） | PASS | **引入点 `fcb469822`（2026-09-25，#2370「W2 抖音准自包含 API 发布链」，作者 ColinChiu）**，二次扩散 `cbd3ad815`（2026-10-04 图文链）。命名来源是参考产品的 bundle 切片文件——**以逆向对手产物为唯一事实源，未用真实账号 cookie 库交叉验证**；而真实账号的 cookie 名是 `__security_mc_<N>_*`，且 cookie 名**不允许含 `/`**（RFC 6265 token），故 legacy 形态在实际浏览器中**不可达**。放大因素：`_assertPreconditions` 用 `includes` 做**半匹配**——第一个判据 `'s_sdk_crypt_sdk='` 因新名恰好以该后缀结尾而**通过**，第二个含 `/` 的判据失败，于是错误表现为「材料全缺」而非「名字不对」，掩盖了真正原因 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链**五层**：**单元层**——`douyin-client-sign.test.js` 的 `makeCookie()` 与实现共享同一错误假设（自证自洽），16 例全绿；**链级层**——`douyin-video-chain.test.js` 与 `douyin-image-chain.test.js` **各自复制了一份 `makeCookie`**，同一错误假设被复制 3 次而非收敛到 1 处，且链级用 127.0.0.1 假服务器 + 手写 JSON fixture；**端到端层**——`e2e-publish-full-chain.test.js` 同为 mock，无真实 cookie 进入过该链；**真机验收层**——W2 §6.2 活体裁决**从未执行**（`evidence/api-w2-douyin/` 不存在）；**审查层**——审查对象是「是否与参考产品切片逐字对齐」，**对齐了，但真值本身是错的** |
| 系统性漏洞定位（QM-5 ③） | PASS | ①**知识多点复制**：cookie 名在 3 个实现文件各写一遍、3 个测试文件各抄一遍 = 同一假设复制 6 次；②**逆向产物被当真值**：参考产品的 bundle 切片文件无「待真实账号验证」标记，审查时无从区分「平台真值」与「对手实现」；③**半匹配判据掩盖失配**：`includes` 判据对新形态部分成立，使故障表现偏离根因；④**假绿结构**：fixture 与实现共享假设时，测试只会**强化**错误而非暴露它 |
| 修复 + 回归保护（QM-5 ④） | PASS | 在 `signer/douyin-ticket-guard.js` 建立**单一事实源**：`CRYPT_KEY_RE`/`SIGN_DATA_KEY_RE`（**后缀锚定 + 前缀可选**，`__security_mc_\d+_` 用 `\d+` **不硬编码代际号**）+ `hasSecurityMaterials()` 存在性判据 + `resolveCryptPayload()`/`resolveSignDataPayload()`（**保序尝试全部候选直到解出可用材料**）。两条链（`douyin-video.js` / `douyin-image.js`）的 Step 0 改调 `hasSecurityMaterials`，图文链的 sign_data 解析改调共享 `resolveSignDataPayload`（消除各链自抄）。legacy 形态保留为回落。**新增 20 例**：单测 +14（live 形态可签出且公钥可验证 / gen=3,12 代际号可变 / legacy 回落 / bare 兜底 / 51 条噪声夹带 / 两代并存取可解码者 / `hasSecurityMaterials` 8 种输入 / 真实命名无斜杠 / fail-closed / 脱敏），视频链 +3（真实形态走通全链且 `create_v2` 带合法 client-data / gen=7 / 缺材料零请求 fail-closed），图文链 +3（真实形态表现为 `io_error` 而非 `data_error` = 已过 Step 0 / gen=7 / 缺材料零请求） |
| 防止再次发生（QM-5 ⑤） | PASS | **新增结构锁**（`douyin-client-sign.test.js` 的「防再犯结构锁」describe，4 例）：①发布链**不得**内联 `s_sdk` 裸字面量或裸 `includes` 判据（忽略纯注释行）；②发布链**必须**从 signer 导入共享解析器；③signer 是唯一保留 legacy 回落的位置，且代际号必须写成 `\d+`（**不得硬编码具体数字**）；④两条链的 Step 0 判据表达式必须同源（`if (!hasSecurityMaterials(c))`）。判据按**文件内容**读，注释里的字样不算 |
| 变异反证 | PASS | **变异 1（重新引入原缺陷）**：把 `douyin-video.js` 的 `hasSecurityMaterials(c)` 改回 `includes('s_sdk_crypt_sdk=') \|\| includes('s_sdk_sign_data_key/web_protect=')` ⇒ **2 例立红**，精确点名 `publish/platforms/douyin-video.js:147 裸 includes 判据`；按字节还原 ⇒ 全绿。**变异 2（硬编码代际号）**：把 signer 正则里的 `__security_mc_\d+_` 改成 `__security_mc_1_` ⇒ **4 例立红**（单测「代际号可变 gen=3/12」+「两代并存」+ 结构锁「不得硬编码」+ **链级**「gen=7」），证明单测/链级/结构锁**三层**都守得住；还原后复绿。**反证的是锁本身**（改实现即立红），不是只证「业务改动变红」 |
| 相关域测试 | PASS | 引擎全量 `node scripts/run-tests.js` → **411 passed / 40 files**（基线同 commit 为 391，本 PR **净增 20 例**，算术 391+20=411 已对账）+ direct 组 **133/133**、零失败、退出码 0；桌面端受影响的 5 个文件（`signer-assembly` 19 / `signer-page-manager` 19 / `signer-provider` 2 / `signer-bridge` 7 / `douyin-rpa-create-v2-pattern` 4）→ **51 passed** |
| 消费者影响面 | PASS | 全仓 `douyin-ticket-guard` 消费者共 5 处：两条链（已改）、`signer/index.js`（仅用 `clientSign`/`extractReePublicKey`，两导出**保持不变**）、`apps/desktop/electron/services/rpa-view-platforms.js:1060`（**仅在注释里引用 `CREATE_V2_PATH`**，代码用的是字面量 `'aweme/create_v2'` 做等待模式，无代码依赖）。本次改动为**纯增量导出 + 放宽匹配**，对既有调用方向后兼容 |
| 行尾与编码 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径**逐行一致**（6 文件） |
| 品牌残留 | PASS | `node scripts/check-no-brand-residue.js` → `扫描 8532 个 tracked 文件，无品牌残留`，exit 0。取证报告写在 **mulpub 仓库之外**（`D:\Data\projects\rea\analysis\`），竞品名不进本仓 |
| QM-1 打包（交付产物验证） | PASS | `cd apps/desktop && pnpm run build:dir` → **rc=0**（renderer built in 21.89s；`dist-electron\win-unpacked\Multi-Publish.exe` 生成，asar 144.4 MB）。产物验证：asar 清单含本 PR 三个改动模块（`\node_modules\@multi-publish\api-publish-engine\src\signer\douyin-ticket-guard.js` 与两条链）。**从解包产物实跑判定（A/B 对照）**：同一组输入下——`live gen=1/5/12` ⇒ **修复前全 THROW、修复后全 OK**；`legacy` ⇒ 两版皆 OK（向后兼容）；缺材料 ⇒ 两版皆按预期 fail-closed；`hasSecurityMaterials` live/legacy/empty ⇒ `true/true/false`。⇒ **修复确实进入交付产物，且证明该缺陷在真实形态下 100% 复现** |
| QM-4 视觉 | N/A | 未触及渲染层与任何 `.vue`/样式文件 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`（与同仓其他记录一致：`QM-6 未执行（本机无 codeagent-wrapper）`）。**如实登记为未执行，不冒充已闭合** |

### 真机边界（不假装已闭合）

**本修复只保证 Step 0 不再因命名失配而 fail-closed，不保证发布成功。** 真实账号的 cookie 材料在这台机器上**全部已过期**（最新样本 `__security_mc_1_*` 有效期至 2026-08-31，已过期 43 天；应用账号库 `accounts` 表 **0 行**），因此：

1. 「真实账号 → Step 0 通过 → 走到网络请求」这一段**未在真机验证**，只有单元 + 链级证据（假服务器）。
2. `web_protect` 载荷内部结构、`ticket` 语义在新命名下**是否同步变化，未知**——名字修好只解决字符串匹配，载荷契约仍需活体确认。
3. `_mc_1_` 中的 `1` 疑似**代际号**，本次已用 `\d+` 与「gen=3/7/12」用例防硬编码，但**无法排除**平台未来改用非数字代际标识（如 `_mc_v2_`）。
4. 关键取证环境（分区 cookie 库）来自**数周前**建立的会话，无法排除平台在样本之后改回旧命名；已备好只读探针脚本供重新登录后复核。

### 取证与复现材料（在本仓之外）

取证报告与 5 个**只读**诊断脚本位于 `D:\Data\projects\rea\analysis\`（`关键缺陷-抖音签名cookie名不匹配.md`、`diag-douyin-signing-materials.cjs`、`scan-douyin-security-cookie-names.cjs`、`verify-security-sdk-storage.cjs`、`diag-account-store.cjs`）。全部以 `readOnly` 打开 cookie 库副本，**只输出 cookie 名/域/有效期，不读取、不打印、不落盘任何 value / 私钥 / ticket**。

### 过程中的自我纠错（如实记录）

1. **变异测试命令中途失败导致变异残留**：变异 1 的还原与变异 2 的注入写在同一条 PowerShell 里，因复合引号解析失败而中断，**还原未执行、缺陷被留在工作副本**；下一次核对时发现 `douyin-video.js:147` 仍是变异态 ⇒ 立即用版本守卫的 `edit` 工具按内容还原并复验。教训：**变异与还原必须是可独立验证的两步**，不能把「注入 A + 还原 A + 注入 B」塞进一条命令。
2. **路径基准错误**：首次变异用 `Set-Location` + 相对路径，而 .NET `[IO.File]` 解析的是**进程目录**（共享根），语句指向了 `D:\Data\projects\mulpub\src\...`。因该路径不存在而失败，**未造成任何写入**；改用绝对路径后重做。
3. **测试计数差异追查**：worktree 首跑 40 文件 / 411 例 vs 早先共享根基线 39 / 333，差额 78 ≠ 自身新增 20 ⇒ 逐文件比对定位到 `risk-signals.test.js`(+54)、`douyin-risk`(+3)、`risk-suspender`(+1) 三个文件的时间戳均为 **15:20:53**，落在首次基线（15:11）与 worktree 创建（15:41）之间，由**并发会话合入 #3455**（`93794a46`，合并时间 15:10:08）带来；共享根复跑得 40 / 391，**391+20=411 闭合**。结论：**不是静默漏测、与本次改动无关**；已留证不臆断。
4. **CI 抓到的缺陷（本地子集漏网）**：首轮 CI `QG Changes` 红，报 `❌ 记录文件整块缺 远程同步 行 1 篇：fix-douyin-security-cookie-names.md —— 整块缺 远程同步 行`。真因：我把「远程同步」行只写进了 `.quality-gates.md`，**没有同写进本记录文件**，而 `check-gate-record-debt.js` 的 `ROW_RE = /^\|\s*远程同步\s*\|/` 要求**每一篇记录文件独立可查**。教训（与同仓 `observability-messagekey` 那次同型）：**跨文件登记契约对「只跑受影响文件子集」的本地验证天然免疫**——本轮本地只跑了 `api-publish-engine` 全量测试，没跑 CI 侧的仓库级门禁脚本。已在本文补上行，并复跑 `node scripts/check-gate-record-debt.js` 验证。

### 远程同步回填说明

本 PR 合并后由后续 docs 回填 PR 完成，**同一次提交内**：

1. 本文与 `.quality-gates.md` 的 `| 远程同步 |` 行由 `PENDING` 改写为 `PASS` + merge SHA；
2. **删除本文件 frontmatter 的 `sync_status` / `sync_reason` / `sync_backfill_owner` 三字段**（连同上方注释行）——文件源载体的未收口登记**随文件走**，**不得**往 `scripts/gate-record-debt-ledger.json` 加键（那套 JSON 键只匹配 `.quality-gates.md` 的 `## 标题`，混用会当场报「陈旧登记」红）；
3. 若 `.quality-gates.md` 侧仍有未收口行，则按标题删除 ledger 中对应的登记项。

| 远程同步 | PENDING |

