---
sync_pr: 0
---

## 播客刀 4 第 3 片·下半（上）：口语化层（podcast-tts-colloquialize）

- 范围：新增 `apps/desktop/electron/services/podcast-tts-colloquialize.js` 与同名行为锁 16 条；PRD §7.4.2.1 写全九项口径（prompt 边界、结构不变量、不抄第二份标点表、旁路方向、计费前置、围栏剥壳、非字符串返回、platform 不入 prompt、出站归宿主）。
- QM-1 打包 **PASS**（2026-10-11）：本机 `electron-builder --win --dir` rc=0；`asar list` 命中唯一一行 `\electron\services\podcast-tts-colloquialize.js`；`asar extract` 后从**解包产物** require 成功，导出逐字为 `COLLOQUIALIZE_REASONS,SYSTEM_PROMPT,buildColloquializePrompt,checkStructure,colloquializeCopy,unwrapFence`（且 require 列表为空（零依赖，出站通道由宿主注入））。本层无任何宿主接线点，真实 Electron 窗口的端到端验证随接线片交付（届时才存在会被加载的调用方）。
- 本机实跑：`vitest run electron/services/podcast-tts-colloquialize.test.js` → **1 file / 16 tests passed**。
- **本层不接线**：不改 `podcast-episode-host.js`、不新增 IPC/preload、不加 locale 键；口语化目前不影响真实发布链，这是刻意切片边界（同 §7.4.2.1 末段），不是遗漏。
- 过程中被自己的锁抓出的一处假红：结构扫描没剥注释，而模块注释如实写着宿主将绑定的 `chatCompletion` ——判据把文档当代码命中。已改为**先剥注释再扫代码**（同仓「结构锁不剥注释 = 幽灵通道」的镜像形态）。


## QM-6 后端评审逐条处置（2026-10-11，verdict=no_critical：Critical 0 / Warning 2 / Info 4）

- F1（Warning，已修）：prompt 教模型按空行分段，而本层校验器与下游 planChunks 都按单个换行分段——判据引用的口径与自己实现不一致，模型忠实守约的合法重排会被整份白拒。修法：段的定义全链收敛为单个换行（prompt 措辞与校验器注释同改），并补两条锁（prompt 必含「不得增加、删除、合并任何换行」且不得再出现「空行分段」；三段合并成一行的输出必须 STRUCTURE_REJECTED）。
- F2（Warning，已修）：异常分支把未净化的 message 原样拼进 warn，违反本层自述的 warn 不含用户正文。改法：只记错误类型；锁同时断言日志不含正文也不含 message 原文。
- Info：围栏剥壳丢弃闭合后内容已如实写进注释并说明为何不是静默错用；与 rewrite-engine 同名不同义的私有方法在两侧注释互相指名。
- 附带修掉 QG Static 的真红：no-useless-assignment（let raw 的初值永不被读）。本机 eslint rc=0、18 tests passed。教训：新增 let x = 哨兵值 时先问 catch 是否必定 return。
- 前端 opencode 未产出结构化 findings ⇒ critic-only（后端单模型）+ 主代理逐条处置，不冒充双模型通过。
## 远程同步

| 远程同步 | PASS | 已合并：PR #3368，merge db0b0fc2258fb163733b22a71c956d55f4f19e17（2026-10-12，squash）。取证：`git log origin/main --grep "(#3368)$" --format=%H|%cI`；本次回填同一次提交删除 ledger 登记项，并在带 frontmatter 的记录文件里删 sync_ 字段 |
