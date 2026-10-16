# OpenSpec 变更归档审计（2026-10-16）

> 回答一个问题：**`openspec/changes/` 里哪些是「已合并却迟迟没归档」的，哪些现在就能安全归档。**
> 结论：51 个活跃变更里，**只有 1 个**满足"可立即归档"，本轮已归档它；其余 50 个各有一道**具体**的前置条件没满足，
> 分三类，每类的责任人和修法都写在下面。

## 一、判据（先定义"可安全归档"，再按它分桶）

一个变更可以归档，当且仅当三条同时成立：

1. **任务全勾**：`openspec/changes/<id>/tasks.md` 里没有 `- [ ]`。
   这条是 openspec 的归档语义本身——归档即宣告该变更已完成。
2. **spec delta 已进主规格**：`openspec/changes/<id>/specs/<cap>/spec.md` 里每个
   `### Requirement:` 的**整块文本**（标题 + 正文 + 场景）都能在 `openspec/specs/<cap>/spec.md` 里找到。
   **只比标题名不算**（同一标题下正文不同就是丢规格）；本轮用空白规范化后的块包含判据，
   实测 `film-production-artifact-identity` 的 3 个块在 `film-engineering`（16 条规格）里 **3/3 命中**。
   这条就是既有教训「主 spec 已同步就别跑 CLI」的可执行版本：判据成立时才允许**纯目录搬迁**，
   否则归档会把还没进主规格的规格永久留在暗处。
3. **合并证据**：`gh pr list --search <id>` 给出 `state=MERGED` 与 merge 时间。
   注意 1+2 **不能替代** 3——任务全勾只说明写的人认为做完了，不等于代码进了主干。

## 二、分类读数（51 个活跃变更，2026-10-16 现场）

| 类 | 含义 | 数量 | 本轮处置 |
|----|------|------|---------|
| **A** | 三条判据全满足 ⇒ 可立即归档 | **1** | 已归档（见§三） |
| **B** | 任务全勾，但 delta 还没进主规格 | 3 | **不动**。先做 spec 同步，再归档 |
| **C** | `tasks.md` 仍有未勾项 | 43 | **不动**。逐个判"是故意不做还是没做完" |
| **D** | 根本没有 `tasks.md` | 4 | **不动**。形状不合 openspec 约定，属另一类欠账 |

复现读数的办法（不依赖任何本地脚本，三条命令）：

```bash
# 活跃变更清单
git ls-tree -d --name-only origin/main:openspec/changes | grep -v '^archive$'
# 每个变更的未勾任务数（>0 即落 C 类）
git show origin/main:openspec/changes/<id>/tasks.md | grep -c '^[[:space:]]*- \[ \]'
# delta 是否已进主规格：取 delta 里的 requirement 标题，逐个回查主规格
git show origin/main:openspec/changes/<id>/specs/<cap>/spec.md | grep '^### Requirement:'
git show origin/main:openspec/specs/<cap>/spec.md              | grep '^### Requirement:'
```

**但上面第三条是标题级判据，只够用来分桶**；真要动手归档前必须换成"整块包含"，
也就是§一.2 那条——这是本次审计刻意收紧的地方，因为标题同名、正文少一段，是规格丢失最常见的形状。

## 三、本轮归档的那一个：`film-production-artifact-identity`

| 判据 | 实测 |
|------|------|
| 任务 | `tasks.md` 27 条**全部已勾**，未勾 0 |
| delta 落点 | 唯一 capability `film-engineering`，delta 内 3 个 Requirement |
| 主规格 | `openspec/specs/film-engineering/spec.md` 共 16 个 Requirement，3/3 整块命中（空白规范化后逐块包含） |
| 合并 | PR **#3427**（head `codex/film-production-artifact-identity`）`state=MERGED`，merge 时间 2026-10-13T17:11:24Z，merge SHA `e82c1d3f797be4578339e97a859de354b9b349a2` |
| 动作 | 纯目录搬迁 `openspec/changes/film-production-artifact-identity` → `openspec/changes/archive/2026-10-16-film-production-artifact-identity`（6 个文件全部 rename，内容零改写；`.openspec.yaml` 不含状态字段，归档语义**只由目录位置表达**，与既有归档项 `2026-10-10-dedup-changelog-history` 同形） |
| 归档后判据 A/B | 搬迁前后各跑一次 `node scripts/openspec-sync-check.js`：两边**输出逐字节相同**（同为 `rc=2 / 14 条`），即本次搬迁**没有引入任何新违规** |

那 14 条是本工作树**基于 main** 的既有状态，正是 PR **#3693** 在修的存量违规（main 上审计器从未被任何门禁跑过，所以一直没人看见）。
因此有一条**落地顺序**要如实写在这里：

- #3693 先合 ⇒ 主上数据已修，本 PR 直接干净；
- 本 PR 先合 ⇒ #3693 re-sync 后那 14 条的修法**不受影响**（本 PR 没碰任何 `task.json`，也没新增 change 引用）。

两种顺序都不需要回头改对方，这点由上面的 A/B 相同证出，不是推测。

## 四、B 类三个：为什么不能顺手归档

| 变更 | 未进主规格的 delta | 缺的是哪一面 |
|------|-------------------|-------------|
| `collection-ui-refinement` | `collection-ui`：采集页批量采集区折叠分组 / 批量进度展示统一 / 采集结果卡片信息层级 | 主规格 `openspec/specs/collection-ui/spec.md` **整份不存在** |
| `quick-collect` | `quick-collect`：快捷采集指令是显式的可校验数据结构 / 内置指令是只读目录 / 自定义指令跨会话持久化 | 主规格 `openspec/specs/quick-collect/spec.md` 整份不存在 |
| `wechat-mp-publish-track` | `wechat-mp-publish-track`：公众号发布方式三态 / API 轨发送判据 fail-closed / 发布路径前置检查 | 主规格不存在（同名的 `wechat-mp-api-publish-track` 是另一份 delta，未同步） |

这三个的 `tasks.md` 都是全勾的，**看起来**最像"该归档了"，但归档动作本身不会把 delta 搬进主规格——
真归档了，这三组需求就只活在 `archive/` 里，主干规格面从此缺这三条。这正是本审计把"delta 是否已进主规格"
设成硬前置的原因，也是它必须用**整块**而不是标题名判的原因。

**归属建议**：分别交给 `collection`、`quick-collect`、`wechat_mp` 三条能力线的会话做 spec 同步
（openspec 的 `sync-specs` 路径），同步完再各开一个归档 PR。**本轮不代做**——同步主规格是要逐条对账的实质动作，
把它塞进一次"卫生清理"PR 里会让两种风险混在一起。

## 五、C 类四十三：未勾项不等于"没做完"

抽样读数（完整清单见文末附表的分类计数）：未勾数从 **1** 到 **55** 跨度极大，
其中 `fix-scheduled-publish-gaps`/`publish-capability-registry`/`publish-logging-observability`/
`quick-collect-cn-sources`/`publish-topic-inline-description` 等都只差 1 项，
而 `compute-key-envelope-migration`(55)、`wechat-mp-api-publish-track`(34)、`oss-b1-rpa-hardening`(31)、
`ops-center-resilience`(29) 有整片未勾。

这两端在语义上几乎一定不同（前者多半是"故意不做/收尾一项没打勾"，后者是"真的没做完"），
但**本轮没有逐个判**——逐个判要读每个 `proposal.md` 的"本期不做"节并与实现对账，
那是 43 次实质核查，不属于一次卫生审计。所以这里如实留成欠账，并给出下一步的**判据形状**：

> 对每个未勾项，先问"它在 `proposal.md`/`design.md` 里是否被显式列为不做项"，
> 是 ⇒ 把该行改写成显式的「本期不做 + 理由」并勾上（或直接删除该勾选项），
> 否 ⇒ 该变更仍在进行中，不许归档。

## 六、D 类四个：形状欠账

`platform-side-schedule`、`real-machine-scheduled-publish-verification`、
`verify-scheduled-publish-completeness`、`visual-baseline-domain` 四个 change **没有 `tasks.md`**。
它们既不算"任务没勾完"也不算"勾完"，是第三种状态：**任务面缺席**。
本轮把它们单列而不是塞进 C 类，是为了不让"未勾 0"被误读成"全勾"——
计数脚本里这类返回 `-1` 并显式标注，判据不静默把缺当满足。

## 七、本轮边界（不假装已闭合）

- **没有新建机械门禁**去持续盯"A 类攒了几个"。加一条 `CHANGE_READY_TO_ARCHIVE` 判据是明确该做的事，
  但它属于 `scripts/openspec-sync-check.js` 的判据面，而那条判据正在 #3693 里被改造与接线；
  在同一时间窗里改它的判据集，会让两个 PR 的判据变更无法分别归因。**留给 #3693 落地之后**，
  并把判据形状写在这里以免丢失：任务全勾 ∧ delta 整块已进主规格 ∧ 存在 MERGED 证据 ⇒ 出声（不拦），
  因为"该归档没归档"只影响可维护性，不该拦住任何 PR。
- 本审计的读数绑在 `origin/main` 的某一刻；main 每几十分钟前进一次，下一个会话请**重取**而不是引用本文数字。
- C 类的 43 个未逐个判（见§五）。
- 归档动作只搬目录，**没有**顺手改 `proposal.md` 措辞、也没有补 `self-review.md`（那是各自的实质内容，不在本 PR 范围）。
