---
# 用法：复制本文件为 `openspec/records/<分支名或任务 slug>.md`。
record: podcast-compliance-badge
task: 落 PRD §8.2.5 的四个 podcast.compliance.* 键与频道页三态徽标（tasks 4.5 的 UI 半片），并让「合规判据缺席」在界面上什么都不显示
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 合并后由后续 docs PR 按既有 PASS 口径回填 merge SHA 与时间，并在同一次提交删除 frontmatter 三字段与 ledger 登记项
sync_backfill_owner: agent 收尾链（回填 = 合并后第一笔 docs PR）
---

# 频道页合规三态徽标（podcast-compliance-badge，2026-10-15）

> 分支 `podcast-compliance-badge`（worktree `D:/Data/projects/mp-worktrees/mp-podcast-compliance-badge`，非 C 盘），起点 `81d9d5b0c` = 当时 origin/main。合同 = PRD §8.2.5 + §8.2.6 锁 7；对应 `openspec/changes/podcast-oneclick-publish/tasks.md` 的 **4.5**。

## 这一片补的是「说给用户听」那半句

音色回退链与 compliance 的三态组装都已在主干落地（#3372 解析层、#3589 主进程标记），但渲染层一直**没有任何消费者**：`apps/desktop/src` 里搜不到 `compliance`，四个 `podcast.compliance.*` 键也不在 locales——那正是上一片刻意留的空位（写进去就是无人消费的死键，AGENTS.md 禁止）。本片把这四处一起补齐，并只补这四处：

- `state=ok` ⇒ **什么都不渲染**。合规良好不是一条信息，给它一条文案就等于让用户去确认一个不需要确认的东西。
- `state=stock` ⇒ 「存量沿用（未重新校验）」。这个词必须出现：它是「这个值来自 §7.9 固化时的旧判定，本轮没有重跑校验」的唯一可见出口。
- `state=invalid` ⇒ 计数句「本条有 {count} 项不符合发布要求」+ 标题「具体原因」+ 逐条原因 + 「本期信息不完整，仍可播出，但建议先修复」。原因**逐字走 `issueText`**（`usePodcastChannel` 里那份唯一实现），展示层不得再抄第二份码→文案映射——§8.2.6 锁 5 要拦的就是这个。
- `compliance` 键**缺席**（旁路降级、主进程没带）⇒ 整块不显示，且**绝不**渲染成「0 项不符合发布要求」。这与 4.4b③ 的 `stock: null` 是同一条纪律的第二处落点：「我不知道」不能写成「一切正常」，也不能写成「没有问题」。

## 落点

| 落点 | 文件 | 承担什么 |
| --- | --- | --- |
| 文案 | `apps/desktop/src/locales/podcast/{zh,en}.js` | `podcast.compliance.*` 四键，zh/en 成对；`invalid` 带 `{count}` 插值 |
| 显示项 | `apps/desktop/src/views/PodcastChannelView.vue` | 单集行内三态徽标（`v-if` 链：stock / invalid，其余不渲染） |
| 回归锁 | `apps/desktop/src/views/PodcastChannelView.test.js` | 7 条：三态各一档 + 缺席不显示 + 四键成对与术语 + 结构锁（徽标块内禁出现第二份码表） |
| 逐字表 | `01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md` | `gen-prd-copy-table.js --apply` 重生成（表行 239，DRIFT 已重写） |

## 执行记录

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码变更（渲染层 + locales）；隔离 worktree `mp-podcast-compliance-badge`（D 盘）+ 裸分支 `podcast-compliance-badge`，起点 `81d9d5b0c`；依赖 `pnpm install --frozen-lockfile` 已就绪 |
| 第一性原因（QM-5 ①） | PASS | 主进程把三态算出来了但渲染层没有消费者 ⇒ 用户看得到「能不能发」却看不到「为什么不能发」，`stock` 档的「未重新校验」这一事实完全不可见 |
| 逃逸分析（QM-5 ②） | PASS | 既有视图测试只钉到 stock 摘要那一行（§7.9.4），没有任何断言看过 `ep.compliance`；「缺席」与「ok」在测试里同形，实现若把两者都渲染成「0 项不符合」不会被任何锁抓到 |
| 修复 + 回归保护（QM-5 ④） | PASS | 7 条新用例（三态各一档 / 缺席不显示 / 四键成对与 `{count}` / zh 用「存量」术语 / 结构锁禁第二份码表）；`PodcastChannelView.test.js` + `glossary.test.js` 合跑 **45 passed / 0 failed**（2 files） |
| 防止再次发生（QM-5 ⑤） | PASS | §8.2.5 表下新增落地状态行；tasks 4.5 追加进度行点名本片落的半句与仍缺的半句；结构锁把「展示层自抄码表」变成会红的判据而不是一句口头约定 |
| 行尾与 diff 对账 | PASS | 五个改动文件均为 i/lf w/crlf；驱动按行保留 CR、以 split/join 回写，插入块的每行继承锚点行行尾；提交前用 numstat 与 ignore-cr-at-eol 两口径对账，两数不等即中止（不提交） |
| QM-1 打包 | N/A | 未触 `apps/desktop/electron`、`packages/rpa-engine`：本片只改渲染层与 locales |
| QM-4 视觉 | 待 CI | 本机不产基线（AGENTS 规则 7：基线只能取自 CI 产物）。频道页单集行新增徽标节点，若 CI 那次渲染里存在 invalid/stock 期数则需按同一次 run 重取基线——判据交给 `QG Visual` 与 `check-baseline-freshness.js`，不在本地判「视觉中性」 |
| QM-6 CCG 双模型外部评审 | 待执行 | 本片改的是展示层判据消费点（缺席/ok 的区别），属需要外部轴复核的语义面；如实登记「未执行」而非跳过 |
| 远程同步 | PENDING | 本 PR 合并后由后续 docs PR 回填 |

## 遗留（不假装已闭合）

- **tasks 4.5 的「来源三态标注」这半句没在本片做**：PRD §7.4.0 第 1 条要求 ②用户偏好 / ③capability 默认 命中时界面标注来源。解析层已返回 `origin`/`resolvedBy`，但它**没有**进入 `episode:list` 或频道读取的任何 IPC 载荷——要标注必须先扩那条投影（触主进程 ⇒ QM-1），那是另一片的体量，本片刻意不带。
- 像素基线是否漂移未在本机判（见上表 QM-4），以 CI 为准。

## 远程同步

| 远程同步 | PENDING | 本 PR（podcast-compliance-badge）合并后由后续 docs PR 回填 merge SHA 与时间，并在同一次提交删除本文件 frontmatter 的 sync_* 三字段与 `scripts/gate-record-debt-ledger.json` 的登记项 |
