---
record: ui-design-final
task: 桌面端 UI 重设计定稿（靛蓝玻璃外壳 + Hero 系统 + 信号轨），落 01-docs/ui-reference/design-2026-10/
date: 2026-10-24
---

## 本次执行记录：桌面端 UI 重设计定稿（ui-design-final，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离声明 | ✅ | 纯文档/规格变更：`01-docs/ui-reference/design-2026-10/**`（设计稿 HTML + 14 张界面图 + 15 个平台 SVG + 规格 .md）、`openspec/records/ui-design-final.md`、`.gitignore`（仅新增一条 PNG 放行，未改 CI_IGNORED_PATHS 白名单、未动任何分支保护规则）。隔离 worktree `mp-ui-design-final`，分支 `ui-design-final`（裸分支名，规避本机 ref 写入对斜杠分支不可靠的问题）。**未触碰共享主工作区**——预检时共享根位于其它会话的分支 `member-center-audit-v4`，按仓规「已有多个会话绑定同一共享 cwd 时禁止并行 Git 写操作」改走隔离 worktree。 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径一致（设计稿为新增文件，仓库 `.gitattributes` 的 `* text=auto` 负责 LF→CRLF 归一，提交前后两口径行数相同）。 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS（扫描 12,343 个 tracked 文件，无品牌残留；已豁免第三方签名服务域名）。规格文档中参考产品一律写「参考产品」，不写其字面名。 |
| 绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js` → PASS（全量审计 5,685 个受管文件，无新增本机绝对路径）。规格文档内所有路径均为仓内相对路径。 |
| 文档同步（doc-gate） | ✅ | `bash scripts/check-docs-sync.sh --base=origin/main --head=HEAD` → PASS。本次无 `.py/.js/.ts/.vue/.json/.yaml` 代码变更（仅 `.md` / `.html` / `.svg` / `.png`），无对应 PRD 需要同步。 |
| CHANGELOG 收口 | N/A | 本次不触碰任何运行时代码路径，无用户可见行为变更，按 docs-only 通道「如适用」豁免。 |
| 执行记录 | ✅ | 本文件（承载面：`openspec/records/`；按 2026-10-17 起的新载体规则，**不写** `.quality-gates.md`，**不写** `scripts/gate-record-debt-ledger.json`，**不带** `sync_*` 旧登记字段）。 |
| QM-6 外部双家族评审 | ✅ | 真实后端跑通（体检见 `scripts/deep-review.sh --check-deps`）：critic=claude、proposer=opencode。**Round 1**（评审整个 PR，8 条意见）→ 逐条裁决后 **4 条成立**（i2 审计记录半途态、i4 `.gitignore` 注释未覆盖 SVG、i5 规格引用仓内不存在的脚本、i6 「定稿」标题与深色模式未设计的口径冲突）—— 已在本 PR 的修复提交里落实；**3 条驳回**（i1 误读 diff 层 `changedLines` 口径与父 sha 写入机制、i3/i8 单文件自包含是交付形态约束）。**Round 2**（评审修复后的差量，6 条）→ 零阻断，已回写收口：`status=self_play_resolved` / `tier=external` / `performedBy=claude` / `findings` 含 6 条逐条 prosecution / defense / verdict / rationale / `evidence` 用仓内 `scripts/lib/ccg-delivery-digest.js` 算（与判据侧同源）。Round 2 的 i6 落在高危域（命中宽正则的 "token" 一词），按仓规不接受自扮演豁免，已把 critic 的原始输出与逐条处置结论**逐字发布为 PR 评论**作为可核外部证据。 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 从主干历史推导收口状态，无需人工回填 PR（change: `gate-record-sync-derived-status`）。 |

- 保留门禁：判定 docs-only=true（`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`：全部改动文件命中 `01-docs/**` / `openspec/**` / `.gitignore`）| 行尾对账 ✅ | 品牌残留 ✅ | 绝对路径 ✅ | 文档同步 ✅ | CHANGELOG N/A | 执行记录 ✅ | 远程同步 PENDING

### 交付物内容

- `01-docs/ui-reference/design-2026-10/index.html` —— 自包含可交互设计稿（14 屏）。品牌 Logo 内联为 data URI，平台图标为同目录 SVG，双击离线可读。
- `01-docs/ui-reference/design-2026-10/screenshots/*.png` —— 14 张界面图（1440×900）。
- `01-docs/ui-reference/design-2026-10/UI-DESIGN-FINAL-2026-10-24.md` —— 落地规格：决策一览、设计主张、令牌（骨架色阶 / 语义状态色 / 平台身份色 / 字体）、Hero 系统（4 色族 × 3 尺寸 × 浮层形态）、组件规格、落地约束（与现有代码的对齐点）、逐屏清单、空间代价。
- `01-docs/ui-reference/design-2026-10/platforms/*.svg` —— 15 个平台官方图标（取自 `apps/desktop/src/assets/platforms/`，零新增素材）。

### 落地边界（本次不实现）

本 PR **只落规格与设计稿，不改任何渲染层代码**。实现时的对齐点已写进规格文档 §6，其中三条需要产品侧先拍板：

1. 侧边栏宽度 200px → 220px，需同步 `setSidebarWidth` 同步链与折叠态宽度；
2. 信息架构重排为「工作台 / 生产 / 分发 / 洞察」四组，属产品决策，需确认后再改 `MpSidebar.vue`；
3. 深色模式本稿只出浅色，深色按同一套令牌反相，平台色与 Hero 渐变不变。
