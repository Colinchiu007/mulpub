---
record: s2v-bgm-legacy-repair
task: 故事讲述流水线：背景音乐/音量自「画面」归位「声音」分组 + 历史音频（已选音频·未入库）存在性核验、状态化文案与一键修复，丢失文件阻断启动
date: 2026-10-17
---

## 本次执行记录：背景音乐归位「声音」分组 + 历史音频存在性修复（s2v-bgm-legacy-repair，2026-10-17）【混合 PR · 运行时代码】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（apps/desktop 运行时代码 + 文档 + openspec change），`classify-docs-only` 必判 false。worktree `<仓库父目录>/mp-worktrees/mp-s2v-bgm-legacy-repair`（D 盘非 C），裸分支 `s2v-bgm-legacy-repair`，起点 origin/main `c120b5a06`；经 `scripts/start-mp-task.ps1 -TaskName s2v-bgm-legacy-repair` 创建，`verify-worktree-deps` OK（消费方解析通过 11 项）；共享根保持 main clean |
| 第一性原因（QM-5 ①） | ✅ | ①分组错位：`S2vConfigPanels.vue` 把 `voice.bgm`/`voice.bgmVolume` 两控件物理放在 `appearance` 折叠区，而运营选项目录（PRD-S2V-PIPELINE-PAGE-UX §11.4）与 optionKey 早已登记为 `voice.*`——实现与目录双源。②「已选音频（未入库）」：`CreateView.s2vLegacyBgmPath` 只做内存索引成员判定，主进程从未提供“该 BGM 路径能否被 compose 读取”的只读通道；2026-08-14 前的 BGM 走 `%TEMP%/story2video/selected-media`（`gcImportedMedia` 7 天惰性老化 + 系统临时目录清理），`lastOptions` 快照/配置快照/历史记录持久化该绝对路径，文件被清后快照悬空；素材库只迁移“新选择”，未校验旧路径 |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试：`s2vLegacyBgmPath` 用固定字符串断言“不在库即显示”，从不校验文件存在；组件测试：无「文件已丢失」用例（`CreateView.test.js` 只断言路径等于给定值）；集成/E2E：真实 Electron 验证只覆盖“新选 BGM → 受控临时路径”，未覆盖“7 天后旧路径失效”；审查：把「未入库」当纯兼容分支未追问文件还在不在，compose 的 `bgmSkipped` 降级被当兜底，掩盖前置可发现性 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①主进程 `Story2VideoBgmLibrary.inspectPath`（判定顺序与 compose `resolveReadableMediaFile` 同源：入参→绝对路径→扩展名 **stat 前**拒绝→lstat→类型→空/超15MB→允许媒体根→复核→库内命中）+ 只读 IPC `story2video:bgm-library-status`（PUBLIC_CHANNELS/PUBLIC_METHODS/preload/publisher 四层接线）。②渲染层状态机 `idle/checking/available/missing/unusable/unknown`（请求代际防旧响应覆盖；`mapInspectResultToLegacyStatus` 单一映射点）；`available`→【加入素材库】复用 `bgm-library-add` 成功后自动选中库内新路径；`missing/unusable`→【清除背景音乐选择】+ 启动阻断（`canStartPipeline` 短路 + `blockedReason.bgmLost/bgmUnusable` + `handleStartPipeline` 有历史路径时先 await 核验）；`unknown` 失败开放。③回归锁：服务层 8 例（含“非音频扩展名不得先 stat”探针）、IPC 2 例、preload/权限 1 例 + 键数锁（publish 131 / 总 344）、composable 6 例（代际/adopt 失败保留）、面板 4 例（归属 + 三状态渲染）、壳 4 例；变异反证见下行 |
| 变异反证 | ✅ **1/1 CAUGHT** | M1：删除 `CreateView.canStartPipeline` 里的 `if (this.s2vLegacyBgmBlockedState) return false` 一行（Git for Windows Bash 外 PowerShell 原生编辑，变异前取 SHA-256 基线）→ `vitest run -t "历史 BGM 文件已丢失"` 当场红（1 failed / 299 skipped）；还原该行后该用例复绿，`git diff --numstat` 复核仅含本 PR 预期改动（66/3），无残留。还原采用文本精确回插而非 `git checkout`（变异发生在未提交工作树上），故“还原后与变异前同哈希”不作声明；判定以「变异红 + 还原绿 + diff 仅预期改动」三件套为准 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①机械锁已落测试：面板测试断言「voice 内存在 / appearance 内不存在」三个 testid（再迁回当场红）；壳测试断言 missing 阻断 + 清除恢复 + unknown 不阻断；服务层探针断言「`.exe` 路径即使不存在也必须返回 format_unsupported（先 stat 会得到 missing）」。②契约单一来源：状态映射只在 `mapInspectResultToLegacyStatus` 一处，面板只读状态不自行解释 reason；PRD-S2V-PIPELINE-PAGE-UX §12 把「归属/判定顺序/门禁/失败开放」写成实现合同，改动必须先改该章。③learnings 置顶两章：「未入库不是一种状态，是三种状态的合并」（可发现性 > 降级兜底）与「CJK 基线按文件+文案内容对账 / 面板测试父级桩要绑真实语义」（含把既有中文模板字面量当受基线保护的合同文本的判据）。④未做且刻意不做：不做启动时自动迁移历史 BGM 入库（未授权副作用，多快照会重复复制），改为显式一键操作——该取舍写入 PRD §3.2/§16 |
| 行尾与 diff 对账 | ✅ | 提交后以 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐值相等复核（见 PR 正文；本轮全部编辑经 edit/write 工具与 PowerShell 原生 `D:\` 路径，CRLF 未被改写） |
| 接线棘轮 | ✅ | 未新增独立测试文件，全部改动落在既有已接线测试文件（`story2video-bgm-library.test.js`、`story2video.test.js`、`preload.test.js`、`useBgmLibrary.test.js`、`S2vConfigPanels.test.js`、`CreateView.test.js` 及两份挂载夹具的 API mock）；`check-unwired-tests` OK（91 个域内测试全部接线或按欠账登记） |
| QM-1 打包 | ✅ | `apps/desktop`：`pnpm run build:vue` rc=0（preload `index.bundle.js` 95,962 B 重生成）→ `pnpm exec electron-builder --win --dir --publish never` rc=0（`win-unpacked/Multi-Publish.exe` 239,075,328 B；`app.asar` 153,519,434 B）；asar 清单含 `electron/services/story2video-bgm-library.js`、`electron/ipc-handlers/story2video.js`、`electron/preload/index.bundle.js`；asar extract 后纯 Node require `electron/services/story2video-bgm-library.js` 通过；打包 exe 以 `scripts/lib/qm1-child-env.js#buildChildEnv`（显式剔除 `ELECTRON_RUN_AS_NODE`）拉起 8 秒存活，stderr 为空（三层判据第③层） |
| QM-4 视觉 | N/A（默认像素态不变，未动基线） | 迁移的两控件只在折叠区内部移动（`s2vOpenSections` 默认仅 basic 展开）；`create-story2video-detail` 像素基线可见面唯一受影响点是「声音」组摘要，已按「未选 BGM 不追加摘要片段」实现（`s2vBgmLibrarySummaryText()` 空串不拼接），默认态摘要逐字节不变。检查过基线清单（`base-screenshots/create-story2video-detail(-dark).png` 存在）与判据覆盖面后才判 N/A；未使用 `--update-baseline`，CI QG Visual（6% 阈值）为独立复核面 |
| QM-6 CCG 双模型外部评审 | 见判定器 | 以 `.ccg/reviews/<sha>.json` 产物为准（pre-commit 生成）；本 PR 两轮 dual 评审全部 `self_play_resolved` 闭环，3 份记录随 PR 入库，upheld 项（i2/i4/i5 + i7）已修复并带回归锁 |
| main push 回读 | PASS | `gh run list --workflow=quality-gate.yml --commit 27bd5d72b` → run `39030092778`（push 事件）；合并后回读 main push 判据见本行与本记录合并后补记 |
| 远程同步 | PASS | PR #3815 已 squash 合并，merge SHA `27bd5d72b9c5ac75f9ada205f2bb04d1dde105a2`（2026-10-17T19:48:22+08:00）；远端分支 `s2v-bgm-legacy-repair` 已删（`git ls-remote --heads origin s2v-bgm-legacy-repair` 0 行）；`git log origin/main --grep='(#3815)$'` 恰好 1 行；PR 侧 22 项 required check 全绿 + main push 回读见下 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅（`check-no-brand-residue` rc=0） | 文档同步 ✅（PRD×3 + spec delta + change 五件套） | 远程同步 PASS

### 关键决策（design 摘要）

- **拒绝自动迁移**：曾考虑启动时把可用历史 BGM 静默复制入库并改写 `bgmPath`（永不复发），但属未授权副作用（静默复制用户文件 + 改写持久化配置），多快照会按恢复次数重复复制；改为显式【加入素材库】。
- **拒绝 renderer 直判文件**：renderer 无 `nodeIntegration`，`%TEMP%` 清理发生在主进程可见域；且判定必须与 compose 同源。
- **拒绝 `libraryId` 主键**：需改 `s2vConfig` 持久化 schema、快照兼容、compose `bgm.path` 合同与历史项目，风险远大于收益，本次不扩字段。
- **`unknown` 失败开放**：核验是增强可发现性，不是安全边界；浏览器态/旧主进程必然无通道，把“无法核验”当“已丢失”会制造假阻断。

### 遗留（不假装已闭合）

1. **核验后到合成前的窗口仍存在**：`available` 通过后、compose 复核前文件被删，仍由 `bgmSkipped` 降级兜底（前端显示既有跳过提示）。要彻底消除需在启动前把文件固化入库（即用户点【加入素材库】），已作为推荐路径写入提示文案。
2. **多历史路径仅核验当前选中项**：下拉里只对当前 `bgmPath` 发起核验；切换选项即时重验（watch `s2vLegacyBgmPath`），不做全库预扫描。
3. **`scripts/qm1-scheduled-publish-verify.cjs` 的 `DESKTOP = path.resolve(__dirname)` 指向仓库根 `scripts/` 而非 `apps/desktop`**（本轮实测：该脚本无 CI/包脚本调用方，仅 AGENTS 引用与自测引用）。QM-1 三步验证本轮按 AGENTS 原文手工执行并留证；该脚本路径缺陷属既有问题，不在本 PR 顺手修（避免混入无关运行面），建议单独任务。
4. **CI 侧 `QG Visual` / `QG Coverage` 等为最终复核面**：本轮本地覆盖定向 + 受影响全量（341 例 6 文件 + 主进程 5 文件 518 例）；未本地重跑全部 13k 单测，依赖 CI 全量与 required checks 阻断。
