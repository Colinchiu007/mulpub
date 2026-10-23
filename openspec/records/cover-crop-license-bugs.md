---
record: cover-crop-license-bugs
task: 修复封面裁剪 cover:crop 自 #1174 起恒返回「图片尺寸无效」（接缝从未产出宽高 + 异步编码器被当 Buffer）
date: 2026-10-19
---

## 本次执行记录：封面裁剪尺寸接缝修复（cover-crop-license-bugs，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/services/cover-cropper.js`、`packages/shared-utils/src/image-size.js` 及两份测试）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-cover-crop-license-bugs`、裸分支 `cover-crop-license-bugs`（`session-init.sh` 创建，`rev-parse --abbrev-ref HEAD` 实证）；依赖就绪 `verify-worktree-deps` 11 项通过 |
| 第一性原因（QM-5 ①） | ✅ | 引入点 `f9d1343bd`（PR #1174，2026-08-27）。`readImageAsDataUrl()` 成功分支只返回 `{dataUrl,sizeBytes}`，**从未返回 width/height**，而 `cropImageFile()` 把 `read.width/read.height` 喂给 `normalizeRect()` ⇒ `Number(undefined)||0=0` ⇒ 恒「图片尺寸无效」。同链第二处缺陷：`pickJpegQuality` 是同步函数而真实编码器返回 Promise（`promise.length` undefined ⇒ 二分退到底 ⇒ `writeFileSync(Promise)` 抛 `ERR_INVALID_ARG_TYPE`），被第一处挡在下游从未显形。归因取证：`git log --diff-filter=A` 唯一命中 #1174；`git log -S'width: size.width'` 零命中 ⇒ **原发缺陷不是回归** |
| 逃逸分析（QM-5 ②） | ✅ | ①单元层：`normalizeRect` 的宽高是**测试自己传的 1920/1080**，A→B 那条缝没有任何用例穿过；②`cropImageFile` 只测「文件不存在」早退分支；③`pickJpegQuality` 三条夹具一律返回 Buffer ⇒ 对 Promise 契约结构性免疫；④视觉层：失败路径没有可断言的画面变化；⑤审查层：字段同名、签名对得上，人眼看不出接缝为空 |
| 系统性漏洞（QM-5 ③） | ✅ | 测试场景缺失 + **夹具类型与真实类型不同形**。落点 `cover-cropper.test.js` 缺三类锁：接缝数据锁 / Promise 编码器行为锁 / 本 realm 测不到处的接线守卫 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增零依赖 `packages/shared-utils/src/image-size.js`（`readImageSize` 返回 `{w,h}|null`，`describeImageSizeError` 三分 EMPTY/TOO_SHORT/UNRECOGNIZED）；`readImageAsDataUrl` 带出宽高并在解析失败时给出**可区分**的新文案；`pickJpegQuality` 改 async 并在调用点 await。新增测试 17 例：`image-size.test.js` 12（真实 PNG 512×904 / JPEG 1024×576 经 System.Drawing 与 sharp **两把独立尺子**实测一致；WebP 512×286、512×219 **只有 sharp 一把，单尺子在列不假装双尺子**；EXIF 缩略图负控；「两张不同尺寸的图必须给出不同读数」防同形夹具）+ `cover-cropper.test.js` 5（接缝数据 / 返回键集 / 非图片字节的新错误 / cropImageFile 不再停在旧文案 / 接线守卫四处字面）。全套读数：shared-utils 12 passed、cover-cropper 23 passed |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`01-docs/BUGFIX-COVER-CROP-SIZE-SEAM-2026-10-19.md` 完整写「数据校验 / 流程 / 交互 / 显示项 / 提示文字逐条（含新增与退役）」；②文内第 6 节四条预防措施（接缝必须由数据穿过、夹具类型必须与真实消费者同形、新增图片格式必须同时登记 `image-mime.FORMATS` 与 `image-size` 解析分支、字节判据必须按容器长度前进）；③learnings 沉淀「同名不同源的巧合正确」这一族 |
| 行尾与 diff 对账 | ✅ | 提交前 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐一相等（无行尾被改写） |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：`pnpm run build:dir` rc=0 + `node scripts/qm1-scheduled-publish-verify.cjs` **全部通过**（asar 15061 条含规模下界；`image-size.js`/`image-mime.js`/`cover-cropper.js` 三条 IN_ASAR；解包树内四条修复字面均在位；打包产物内 `readImageSize` 对三张真图给出 512×904 / 1024×576 / 512×286；8 秒存活且 **stderr 长度=0**＝三层判据第③层）。QM-4：未触碰 `.vue` / 样式 / locale，无视觉面变更 |
| 反证（变异） | ✅ | M1 摘掉返回宽高 / M2 `readImageSize` 恒 null / M3 循环摘 await / M4 JPEG 退回"扫第一个 SOF" / M5 调用点摘 await ⇒ **五条各自指名变红**，红集互不相同，跑后两文件 md5 逐字节还原。驱动自身三坑（pnpm 是 .CMD shim 需 shell、vitest 子进程仍上色需先剥 ANSI、`\S*(…\.test\.js)` 贪婪会把路径吞成尾巴）与夹具一坑（JPEG 段长度含其自身 2 字节）一并记入 BUGFIX 文档 |
| QM-6 CCG 双模型外部评审 | 未执行 | pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`；本机无可用外部评审通道 ⇒ **如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`）；合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；预写 `PASS` 会被 `prematureClaims` 判红。main push 回读证据写在 PR 评论里，不写回本文件 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按「旧载体冻结」政策**零改写**）| 远程同步 PR #（开单后由门禁推导）

## 刻意没做的事（防下一个会话顺手扩大）

1. **不迁移错误文案到 locales**：`cover:crop` 这个 handler 的全部消息本就是主进程中文字面量，
   搬它们属「改整个 handler 的文案归属」，与本次「修一条死链」是两批变更，混做会让归因互相污染。
2. **不把 `cropImageFile` 的输出目录改成 PID 唯一路径**：`os.tmpdir()/multi-publish-crop/crop-<md5>.jpg`
   的键含路径+rect+目标宽+maxBytes，是**内容寻址的复用**而非碰撞；改成会话隔离会让"同一张图重复裁剪"
   重新落盘。并发会话写同一键时写的是同一批字节，属可接受。
3. **不改 `normalizeRect` 的判据形状**：它的 `图片尺寸无效` 分支语义本身是对的（调用方传了非正尺寸就该拒），
   错的是上游没把尺寸交出去。修上游而不是放宽下游。

## 补记：rebase 吞提交导致的两处回退已修回（2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 现象 | ✅ | 本 PR rebase 到最新 `origin/main` 后，CI 的 `QG Changes` 红在 `[no-brand-residue] FAIL：发现 1 处品牌残留`，点名 `01-docs/BUGFIX-COVER-CROP-SIZE-SEAM-2026-10-19.md` |
| 第一性原因（QM-5 ①） | ✅ | 本分支的第 2 个提交 `78e757fa4`（115 文件，既含主干内容也含「按 Gate 12/12c 去掉品牌字面与本机绝对路径」这次修复）在 rebase 重放时**被判定为已应用而跳过** ⇒ 品牌字面与本机绝对路径两处修复一并丢失 |
| 逃逸分析（QM-5 ②） | ✅ | 这类回退在**门禁层**可见、在**提交层**不可见：rebase 本身报「成功」，但被跳过的提交携带的唯一修复（不在主干里的那两行）就消失了 ⇒ 只能靠门禁或逐 blob 比对发现 |
| 修复（QM-5 ③④） | ✅ | 把 `78e757fa4` 相对本分支旧 tip（`8a7b6c3d`）的**独有内容**逐行补回：① 文档引用原提交主题处改回中性称谓（品牌字面）；② 执行记录里的本机绝对路径 `D:/Data/projects/mp-worktrees/mp-cover-crop-license-bugs` 改回占位符。两文件与旧 tip 逐 blob 相同（`git diff 8a7b6c3d -- <两文件>` = 0 行差异） |
| 回归保护（QM-5 ④） | ✅ | 本机实跑 `node scripts/check-no-brand-residue.js` → **PASS（rc=0，扫描 12196 个 tracked 文件）**；`node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD` → **PASS（rc=0）** |
| 防止再次发生（QM-5 ⑤） | ✅ | rebase 后必须做**逐 blob 对账**（旧 tip vs 新 tip，限 PR 自己的文件），不能只看 rebase 的 rc 与「无冲突」提示——rebase 报成功与内容完整是两件事 |
