---
record: s2v-video-model-source
task: 修复任务详情页「视频模型」项在生产环境恒不显示的缺陷（follow-up to #3929）
branch: s2v-video-model-source
date: 2026-10-19
base: main @ 5f2e21770（s2v-result-model-info 的 merge SHA）
type: runtime-code
---

## 本次执行记录：视频模型改读真实落盘字段

### 症状

`s2v-result-model-info`（PR #3929）上线的四项模型信息里，**「视频模型」在真实项目清单上永远不显示**。其余三项（文本/语音/图片）正常。

### 根因（第一性）

| 环节 | 事实 |
|---|---|
| 读侧（首版实现） | 门控读 `project.options.videoMode` |
| 写侧白名单 | `story2video-project-service.js` 的 `_safeOptions` 的 `keys` 数组 = `transition`…`sceneDurationMode` 共 25 键，**无任何 video 键** |
| 真实落点 | `normalizeStory2VideoTextParams` 产出的 `story2videoTextConfig.config.video = { mode, provider, model, fixedRatio, … }`（`story2video-text-config.js` L520-534 构造、L601 挂到 `config.video`），由 `_persistTextConfig` 落盘为 `project.story2videoTextConfig` |
| 后果 | `options.videoMode` 恒 `undefined` ⇒ 门控恒 false ⇒ 视频模型项恒不渲染 |

### 为什么首版测试全绿（真正的逃逸点）

`ResultView.model-info.test.js` 的 5 条视频用例把 `videoMode` 塞进了 `options` —— 那是个**不存在的数据位置**。夹具自造形状、实现读该形状、断言通过，等于"用想象验证想象"。不是漏写断言，是**夹具与真实数据路径脱钩**。

### 修法

保持 PRD 已定的门控语义（`fixed`/`ai-judged` 才算启用），只换数据源：

- 门控：`story2videoTextConfig.config.video.mode`，回退 `options.videoMode`（历史清单兼容）
- 取值：`segments[].videoMeta.model` → `.provider` → `config.video.model` → `.provider` → `options.videoModel` → `options.videoProvider`
- 依据：`safeAssetMeta` 落盘时保留 `videoMeta` 的 `provider`/`model`（`story2video-project-service.js` L112-113），故「实际执行 > 配置」口径在视频侧同样成立

### 门禁读数（本地实跑）

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | PASS | 共享根实测 `main` + 3 个他人未跟踪文件；`scripts/start-mp-task.ps1 -TaskName s2v-video-model-source` 建 worktree 于 `<仓库父目录>/mp-worktrees/mp-s2v-video-model-source`、裸分支 `s2v-video-model-source`；`verify-worktree-deps.js` OK（11 个 `@multi-publish/*` 解析到本 worktree） |
| TDD 红 | PASS | 新增 8 例先红：首跑 **4 failed / 28 passed**，失败文本「收到 `语音模型: … · 图片模型: …`」逐字复现「视频项缺席」 |
| TDD 绿 | PASS | 改实现后 **32 passed** |
| 变异反证 | PASS | 实现退回「只读 `options`」即 4 例当场红（与 TDD 红同一现场，非构造） |
| 消费者并集回归 | PASS | `ResultView.test.js` 115 + `ResultView.model-info.test.js` 32 + `story2video-prompt-meta.test.js` 17 + `story2video-project-service.test.js` 119 + `element-plus.test.js` 7 = **290 passed / 0 failed** |
| eslint | PASS | 0 error |
| 构建层 | PASS | `pnpm run build:vue` 成功（Vite/Rollup 通过，ESM 导出照旧） |
| `check-max-lines` | PASS | rc=0，无新增超大文件 |
| locale `--cjk` / `--keys` | PASS | CJK 基线 1331 / 当前 1188，无新增硬编码；2123 key 全部存在 |
| `check-doc-abs-paths` | PASS | rc=0，无新增本机绝对路径 |
| QM-1 打包 | ➖ N/A | 零 `electron/**` 改动（只改 `src/` 下 composable 与测试） |
| QM-4 视觉回归 | 交 CI | 本机不冒充跑像素门禁，责任点名 `QG Visual`；本次是「多显示一项」，空态契约用例仍断言 `格式: MP4` |
| QM-6 双模型评审 | ⚠️ 未取得读数 | 见下方遗留；归因已纠正为「单次调用超 600s 上限被杀」 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导，不手写状态词（change `gate-record-sync-derived-status`）；回读读数写在 PR 评论而非本文件 |

- 保留门禁：品牌残留 ✅ | 文档同步 ✅ | 行尾/编码对账 ✅ | 远程同步 PR #3940

### CHANGELOG / learnings 有意不在本 PR 落地（✅ 已核实门禁不要求）

本 PR 最初带 `CHANGELOG.md` 与 `01-docs/learnings.md` 的追加条目，但这两个是**顶部追加型热文件**（几乎每个合并的 PR 都在第 1 行插入）。实测连续 **4 轮** rebase 的冲突点**只有 `CHANGELOG.md`**（`learnings.md` 有时自动合并）：每次 CI 全绿（23 项 pass / 0 fail）后 main 又前进 ⇒ `mergeable=CONFLICTING` ⇒ 必须再 rebase ⇒ 40 分钟 CI 重来，形成**跑步机**。

处置：**去掉这两个文件的改动**，使分支与主干的文件集不相交，此后 main 前进不再产生冲突。**内容并未丢失**，而是落在下面两段（本记录是唯一强制记录载体，见「旧载体冻结」；`check-docs-sync.sh` 实测仍 rc=0 —— 其判据是「代码变更已同步更新文档」，本 PR 的 PRD + openspec 文档足以满足）。

#### 原本要写进 CHANGELOG 的条目

> `# [未发布] fix(s2v): 视频模型项改读真实落盘字段，修掉「生产环境恒不显示」（s2v-video-model-source）`
>
> - **症状与根因**：`s2v-result-model-info` 上线的「视频模型」项在真实清单里**永远不显示**——它读 `project.options.videoMode` 作门控，而 `story2video-project-service.js` 的 `_safeOptions` 白名单（`transition`…`sceneDurationMode` 共 25 键）**一个 video 键都没有**，持久化清单的 `options` 里恒无 `videoMode/videoProvider/videoModel`。视频配置的唯一落盘点是 `normalizeStory2VideoTextParams` 产出的 `story2videoTextConfig.config.video`（`{ mode, provider, model, … }`）。
> - **为什么首版测试全绿**：夹具把 `videoMode` 塞进了 `options`（虚构位置），24 例里 5 条视频用例全部绕过真实数据路径。**「夹具自洽」被当成「契约成立」**——这是真正的逃逸点，不是漏写断言。
> - **修法**：保持 PRD 已定的门控语义（`fixed`/`ai-judged` 才算启用），**只换数据源**——最小改动、零语义漂移。取值优先级 `segments[].videoMeta.model` → `.provider` → `config.video.model` → `.provider` → `options.videoModel` → `options.videoProvider`。
> - **回归锁**：`ResultView.model-info.test.js` 新增 8 例**按真实清单形状**写的用例（`options` 里没有任何 video 字段）；首跑 4 failed / 28 passed，失败文本逐字复现「视频项缺席」，改后 32 passed；退回「只读 options」即当场红（天然变异反证）。
> - **验证**：5 个测试文件 290 passed / 0 failed；eslint 0 error；`build:vue` 成功；`check-max-lines` / locale `--cjk` / `--keys` / `doc-abs-paths` / `gate-record-debt` / `check-pr-exec-record` 全 rc=0。

#### 原本要写进 `01-docs/learnings.md` 的 lesson

**`lesson:fixtures-must-mirror-the-real-persisted-shape`** —— 测试夹具的形状如果由实现者想象，那它验证的是想象，不是数据契约。

判据：
1. **凡是断言「某个 UI 项显示/不显示」的用例，夹具必须逐字段来自真实落盘路径**，并注明该路径。写夹具前先去读生产者：谁写这个对象？它的白名单是什么？
2. **白名单是「会写什么」的唯一权威**。要判断某字段是否存在，读写侧的 `keys` 数组，不要读消费侧代码。本例只要先看一眼 `_safeOptions` 的 `keys`，30 秒就能发现 video 三兄弟根本不在里面。
3. **反向检查法**：对每个被消费的字段，问「谁把它写进去的？写侧白名单里有它吗？」答不上来的字段，它的消费代码就是死分支。
4. 这类缺陷的光滑之处：单测绿、CI 全绿、视觉回归也绿（空态本来就不渲染该项），**只有真实用户打开任务详情页才发现少了一行**。它不靠更强断言能抓到，只能靠夹具形状对。

### 遗留（不假装已闭合）

- **QM-6 双模型外部评审仍未取得读数**。前序 change 两次实跑均 `spawnSync codeagent-wrapper.exe ETIMEDOUT`；本次结论已纠正归因：驱动里 `timeoutMs: 600000` 是**单次调用上限**，报错是子进程超该上限被杀 ⇒ **wrapper 能启动，是评审跑不完**，不是"起不来"。引擎位于 `~/.claude/skills/adversarial-review-loop/scripts/`（仓外、机器级），改其超时属「改谁来守门」，本片不动。**这条门禁本次仍是缺失状态**；本次缺陷能漏过，正是缺了跨家族评审这层——已写入 learnings。
- **`options` 里的 video 兼容分支没有任何真实数据会命中**（真实清单从不写这三个键）。保留它只为防"某天有人把 video 加进白名单"时不必再改读侧；若认为这是死代码，可在下次清理时连同测试一起去掉。
- **未做真机 UI 核对**：本地无 story2video 项目清单（`~/.multi-publish` 为空），无法端到端验证真实项目上的显示。证据链止于「真实落盘形状 + 该形状下渲染正确」。
