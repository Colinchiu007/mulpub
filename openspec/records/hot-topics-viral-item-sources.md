---
record: hot-topics-viral-item-sources
task: 热门选题短视频平台「近期爆款」数据源调研 + PRD 落盘（开源参照系实测、许可证门禁判定、第一刀归档方案合同）
date: 2026-10-17
---

## 本次执行记录：热门选题短视频爆款数据源调研 + PRD（hot-topics-viral-item-sources，2026-10-17）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=true（files=3）**：`01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md`、本记录文件、以及 pre-commit 自动落盘的 CCG 判定产物 `.ccg/reviews/aad6b377…json`（三份均命中文档白名单）
- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | Gate 12c 绝对路径 ✅ | 文档同步 ✅ | 执行记录取证 ✅ | 旧载体冻结 ✅ | 远程同步 PASS

## 0. 变更类型与隔离声明

| 项 | 内容 |
|---|---|
| 变更类型 | **纯文档**（调研报告 + PRD + 合同）。零运行时代码、零依赖、零 CI 改动 |
| 分层判定 | 按 AGENTS.md「分层判定只看是否影响运行行为」：本变更不影响运行行为 ⇒ 在共享主工作区 `main` 就地编辑，**不进 worktree** |
| 落地方式 | 本地 main 上 commit → `git branch` 保住提交 → `git reset --keep origin/main` → 推分支开 PR。**不存在直推 `refs/heads/main` 这条路**（分支保护 GH011） |
| 开工前对齐 | 共享根原落后 origin/main 1 个提交，已 `git merge --ff-only origin/main` 到 `5e8c50ff7` 再动笔；并用 `git log HEAD..origin/main -- 01-docs/` 确认无未吸收的上游文档改动（避免反向撤销他人那一行） |
| 写保护 | 目标路径 `01-docs/`、`openspec/` 属 `guard-shared-root-writes.ps1` 的放行清单；共享根保持 main clean |
| 决策来源 | 用户 2026-10-17 明确要求：先检索「能拿到抖音/小红书/视频号当日或近期爆款视频、热榜、排行榜」的开源项目，目的是给热门选题增加**近期具体爆款视频内容**；随后在两个出口中选定「先落调研+PRD 文档」，第一刀选定「douyin-hot-hub 历史归档（零风控）」 |

## 1. 门禁结果

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离声明 | PASS | 见 §0：docs-only 就地编辑 + PR 落地，不进 worktree；分支守卫由 pre-commit 按 `.agent_context/expected-branch` 校验 |
| QM-1 打包 | N/A | docs-only 通道明确跳过（与运行行为无关），判定见 §0 与 AGENTS.md「docs-only 快速通道」 |
| QM-2 代码必检项 | N/A | 同上：本次无任何代码/依赖/CI 文件进入改动集 |
| QM-4 视觉 | N/A | 同上：未触碰 `apps/desktop/src/**` |
| TDD | N/A | 本次无代码变更；测试计划在 PRD §8 以验收表形式先行落盘（A1–A10 + 三条变异反证要求） |
| QM-6 双模型评审 | N/A | docs-only 通道不强制（AGENTS.md：纯文档/流程变更不强制 QM-6） |
| 行尾两口径对账 | PASS | `git diff --numstat origin/main HEAD` 与 `git diff --ignore-cr-at-eol --numstat origin/main HEAD` 的改动行合计**均为 4088** ⇒ 无行尾被改写。两份新文件为 LF 新建（`git add` 时的 `LF will be replaced by CRLF` 告警是 checkout 转换，不是内容改动） |
| 品牌残留 `check-no-brand-residue.js` | PASS | 实跑输出 `PASS（扫描 9904 个 tracked 文件，无品牌残留）` rc=0。文档里的 GitHub 项目名属开源参照系、非竞品品牌；PRD §4.3 对付费数据服务一律以能力名表述 |
| 受管文档绝对路径 `check-doc-abs-paths.js`（Gate 12c） | PASS | 实跑输出 `counts=1185 domain=3794 files=564 canJudge=true` + `PASS … 无新增本机绝对路径`，账本未放宽 ⇒ PRD 与本记录只用相对路径与占位符（`<仓库父目录>` 形态未出现、`userData/...` 为逻辑路径） |
| 文档同步（doc-gate） | PASS | `bash scripts/check-docs-sync.sh --base=main --head=HEAD` → `✅ 文档同步检查通过！` rc=0。注意该脚本的 `--base` 取**分支名**（内部自行前缀 `origin/`），传 `origin/main` 会变成 `refs/heads/origin/main` 而 fetch 失败——那是用法错，不是门禁红 |
| 执行记录取证 `check-pr-exec-record.js --mode=enforce` | PASS | 输出 `本 PR 变更文件 3 个（A=3 M=0 D=0）｜新增记录 1 篇 … OK: 本 PR 携带执行记录或带原因的豁免` rc=0 |
| 旧载体冻结 | PASS（按规执行） | **未**往 `.quality-gates.md` 插块、**未**往 `scripts/gate-record-debt-ledger.json` 加键 ⇒ `carrierDrift` 不应触发 |
| CHANGELOG 收口 | N/A（如实登记） | 本 PR 只新增未实现的 PRD，用户可见行为零变化；按 docs-only 通道「CHANGELOG 收口（如适用）」判定为不适用。真正适用的是实现那一刀（届时随 §8 的验收项一并写） |
| 远程同步 | PASS | 已合并：PR #3866 于 2026-10-18T00:36:35+08:00 squash 进 main，merge SHA `95142a64d8906f27b3984afba4145cb56522c2c1`（取证 `git log origin/main --grep'(#3866)$' --format=%H|%cI` 恰好 1 行）；`git ls-remote --heads origin hot-topics-viral-item-sources` 返回 **0 行**（远端分支随合并删除）。main push 回读：`quality-gate.yml` 的 push 触发层 `paths-ignore` 覆盖本次全部三类落点（`01-docs/**`、`openspec/**`、`.ccg/**`），故该 merge SHA 上 **NO_RUN(by design)**（`gh run list --workflow=quality-gate.yml --commit 95142a64d…` 返回 `[]`）；改判据未动，转核该 workflow 最近一次 main push 读数 = **success**（`b7c618d9c`，2026-10-17T15:00:27Z）。本回填与删除上方 `sync_*` 三字段发生在**同一次提交**内 |
## 2. 本次产出物

| 文件 | 内容 |
|---|---|
| `01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md` | §1 现状与第一性问题（条目字段缺席是结构性的）；§3 开源参照系三档实测表（star/许可证/最后推送全部经 `gh api` 现取）；§3.4 本机四条探针读数；§4 抖音/小红书/视频号逐平台可用性判定；§5 第一刀（归档型热度标签）的**六维度规格**（数据校验 §5.7、流程 §5.3、功能逻辑 §5.4、交互逻辑 §5.5、显示项 + 提示文字 §5.6）；§6 后续片合同（条目数据模型字段表 + 校验不变式，明写「这是合同不是实现」）；§7 非目标；§8 验收 A1–A10；§9 风险登记 |
| `openspec/records/hot-topics-viral-item-sources.md` | 本记录 |

## 3. 关键取证（全部为 2026-10-17 现场读数，不得凭记忆复述）

| 判据 | 读数与取法 |
|---|---|
| 「本仓已有抖音/小红书热榜渠道」 | 读 `hot-topics-service.js` 的 `CHANNEL_CONFIGS`：`id: 'douyin'`（含 `fallbacks` 两条）与 `id: 'xiaohongshu'` 均在表内 ⇒ 用户诉求的缺口**不是**渠道数量 |
| 「现有产物结构装不下爆款条目」 | `channels.js` 各 `parse*` 统一返回 `{channel, rank, topic, hotValue, url, rawCategory}`，无 `author`/`publishTime`/`interaction` ⇒ PRD 把「扩条目模型」列为所有爆款源的前置 |
| 抖音热榜不含视频条目 | 本机 curl `.../hot/search/list/?...&detail_list=1`：200 / 66,639 字节 / `word_list` 50 条 + `trending_list` 5 条，条目字段仅到 `video_count`、`discuss_video_count`（计数，非条目） |
| 旧公开「热门视频榜」已无数据 | 本机 curl `iesdouyin.com/web/api/v2/hotsearch/billboard/aweme/`：200 / 109 字节 / `status_code:0` / `aweme_list: []`。与 `01-docs/research/hot-topics-sources-douyin-xhs.md`（2026-10-12 记「实测恒为 `[]`」）**相隔 5 天互证** |
| 归档仓库真实形状 | `gh api .../contents/archives/2026-10-16.md`：38,930 字节 / 131 行；小节 `抖音热榜(50)/明星榜(4)/直播榜(4)/音乐榜(31)/品牌榜(34)`；条目 `N. [标题](https://www.douyin.com/search/<urlencode>)`；**热度值出现次数 = 0**；仅一行 `最后更新时间：2026-10-16 23:17:47 +0800` ⇒ 每日只有末次快照 |
| 归档仍在更新（非陈旧仓库） | `archives/2026-10-17.md` 存在；`gh api repos/lonnyzhang423/douyin-hot-hub` → pushed 2026-10-17，license MIT |
| 结构化 JSON 产物已停 | `raw/2026-10-16` 目录 MISSING（`raw/` 只到 2021 年样本）⇒ 合同只敢按 Markdown 归档写，不假设有 JSON |
| newsnow 覆盖度 | 读 `server/sources/*.ts` 适配器清单（47 项）：含 `douyin.ts`、`kuaishou.ts`，**无** 小红书、**无** 视频号 ⇒ 「newsnow 能补齐国内短视频三平台」这一常见误解被否证 |
| DailyHotApi 覆盖度 | 逐行读 README 站点表（45 站）：有抖音热点榜、快手热点榜，**无小红书、无视频号**；pushed 2026-03-11 |
| 60s 的小红书源 | 读 `src/modules/rednote.module.ts` 源码：同一端点 `edith.xiaohongshu.com/api/sns/v1/search/hot_list`，且 `shield` 为硬编码 2023 年 App 指纹 ⇒ 不作依赖，理由写入 PRD §3.1 |
| MediaCrawler 许可证 | 读 `LICENSE` 原文：`NON-COMMERCIAL LEARNING LICENSE 1.1`，含「limited to learning and research purposes only」「may not be used for large-scale crawling」「未经书面同意不得用于任何商业目的」；README 把 HomeFeed 与热搜榜单列在**闭源付费 Pro** ⇒ 判「只能读码、不可进产品」 |
| 无许可证那一批 | `gh api` 的 `.license` 为 null：`cv-cat/Spider_XHS`、`cv-cat/DouYin_Spider`、`3441293738/creatorhub`、`qiye45/wechatVideoDownload`、`lecepin/WeChatVideoDownloader`、`1968820297-hue/tangdan-hot-collector` ⇒ 默认保留所有权利，不可用 |
| GPL 那一批 | `sansan0/TrendRadar`(62,975)、`JoeanAmier/TikTokDownloader`(16,920)、`JoeanAmier/XHS-Downloader`(13,033) 均 GPL-3.0 ⇒ PRD 只允许「用户自托管、应用调其 HTTP 接口」，代码不入包 |
| 视频号开源空白 | 6 组关键词检索（视频号 榜单 / 热榜 / 爆款 / 数据采集 / shipinhao / wxchannels）未命中任何"榜单/推荐流"API；高 star 全是下载器。PRD 表述为「未命中」而非「不存在」，并把"不为凑三平台塞假源"写成非目标 |

## 4. 方法论沉淀（本轮踩到/规避的点）

1. **GitHub contents API 目录列表按名排序且上限 1000 项**：取 `archives` 的「最后一个元素」拿到的是 `2023-09-25`，而仓库今日仍在更新 ⇒ `.[-1]` 在分页目录上不是"最新"。判"是否在更新"必须按**猜测的目标日期名直接取文件**（`archives/2026-10-17.md` → 存在），不能用列表尾元素。这是「截断的输出不构成证据」的又一种落点。
2. **文档里的每一条"实测"必须连着取法一起写**（本记录 §3 整列即为此）：否则下一个会话只能凭"看起来写过"复用旧数，正与本仓「装饰性门禁」同型。
3. **合同先行不等于 over-claim**：PRD 顶部与 §6 标题都写死「未实现 / 代码服从本节」，CHANGELOG 判 N/A 并登记理由 —— 文档完备度不能替功能可用性背书。
