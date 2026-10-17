# 上游 issue 草案：self-play 出口无法被「外部复核凭证」解除，且高危域是按文本正则重算的

> 目标制品：本地安装的 skill `adversarial-review-loop`（`~/.claude/skills/adversarial-review-loop/scripts/`）。
> 该制品内无版本号、无 repository 字段（`engine.js` 头部只写着 `reference implementation`），故本文按**函数名 + 实测行为**定位，不按版本号；提交通道请维护者指定。
> 全部读数为 2026-10-17 在同一份安装副本上实跑所得，可用文末脚本复现。

## 一句话

验证层只跑一轮 critic 且刻意把轮次字段报成 `cfg.maxRounds` ⇒ 三个停止出口里**只有 ③（maxRounds → self-play）可达**；而 ③ 既**不认调用方显式给出的 `highRiskDomains`**（按文本正则重算），也**没有任何入口能让「这条已由外部模型复核过 / 已在其后提交修复」解除阻断** ⇒ 这类 diff 的深度审查闭环在机制上到不了，reviewer 做多少工作都不改变结果。

## 实测读数

### 1）③ 是唯一可达出口

现读自源码的参数：`maxRounds=3`(engine.js:165)、`scoreThreshold=8.0`(engine.js:166)、`stallRounds=2`(engine.js:41)、`stallScoreDelta=0.5`(engine.js:42)、`selfPlay={enabled:true, confidenceWeight:0.6}`(ccg-deep-review.js:108)；驱动在 ccg-deep-review.js:1029 与 :1140 写 `currentRound: cfg.maxRounds`。

| 输入形状 | `engine.convergenceDecision` / `isStalled` 读数 |
| --- | --- |
| 单轮 + `currentRound=3` | `stop=true reason=selfPlay status=self_play` |
| 单轮 + `currentRound=1` | `reason=continue stop=false`（非终态；这就是驱动要谎报轮次的原因） |
| `isStalled([单轮])` | `stalled=false（轮次不足）` ⇒ ② 在验证层恒不成立 |
| 第 2 轮打到 8 | `status=converged` ⇒ ① 本身可达，缺的是轮次 |

### 2）高危域是**按文本正则**判的，且会覆盖调用方给的字段

`engine.HIGH_RISK_DOMAINS` 三项：`auth`、`crypto`、`datamigration`，每项一个 `/i` 正则。`crypto` 的原文（实测打印）：

```
/(crypto|cipher|encrypt|decrypt|bcrypt|scrypt|argon2|pbkdf2|\bhash\b|salt|password|secret|private[_-]?key|credential|\baes\b|\brsa\b|\bdes\b|\bhmac\b|\bmd5\b|\bsha[\-_]?(1|224|256|384|512)\b|signature|signing|\bdigest\b|\bnonce\b|\breplay\b)/i
```

`function classifyHighRisk(text)` 的入参是**一个字符串**，不是条目对象。两条后果：

- **散文即可触发域标签**。实测 `classifyHighRisk('本 PR 未触碰任何加解密代码，只在文案里提到加密')` 返回 `["crypto"]`。而 `credential` / `secret` / `password` / `sha256` / `hash` 这些词在工程文档里极其常见 —— 我们现场就撞上一次：某 PR 的改动集里**没有任何加解密代码**，评审条目却被打了 `crypto` 标签，因为 critic 写的 finding 文本里出现了这个字样。
- **调用方显式提供的 `highRiskDomains` 不被采纳**。实测：向 `convergenceDecision` 传 `critique.issues=[{id:'i2', highRiskDomains:['crypto']}]`，返回的 `selfPlay.items[0].highRiskDomains` 是 `[]`，同时 `selfPlay.reason` 却是 `partial_high_risk` —— 域是按文本重算的，我给的字段被丢掉了。

### 3）阻断集合在**驱动侧**，且对高危域项不看裁决

`blockingFromAdjudication` 在 `ccg-deep-review.js`（**不在** engine 的导出表里），两条 push 语句实测原文：

```js
blocking.push({ id: i.id, severity: i.severity, reason: 'high_risk_requires_external', domains: i.highRiskDomains });
blocking.push({ id: i.id, severity: i.severity, reason: 'self_play_upheld' });
```

第一条只问「有没有域标签」，**不问 `verdict`** ⇒ 高危项在 ③ 里永解不开。第二条使「agent 判 upheld」的普通项也计阻断，而**没有任何字段能表达「已在其后提交修复」**。

## 后果（不是"审查太严"，是下游被迫二选一）

同一周内两笔 PR 因此停在人工合并：

- PR A：`.ccg/reviews/24cf2d8f…json` ⇒ `status=self_play_blocked`，2 条 findings 带 `crypto`，`blocking=3`
- PR B：两条判定记录均 `self_play_blocked`；其中两条指控**都已修复并各带回归锁**，记录状态却没有任何一格能表达这件事

而且判定记录按**父提交**入库、`deep-review` 只服务当前 HEAD ⇒ 一旦 `self_play_blocked` 就**永久无法回补**，只能整条重跑一轮模型评审（实测 20–40 分钟/轮）。rebase 之后（squash 工作流下很常见）连原来的 run 目录都对不上，存档 critique 的复用路径也失效。

于是下游只能：要么长期人工合并（我们现在的状态），要么放宽闭合白名单 —— 而后者是在改「谁来守门」。我们**主动拒绝**了第三种做法：在仓侧自造「已修」标记，或直接手改 `status` 字段。那会让这道闸变成装饰。

## 建议改法（按代价从小到大）

1. **给每个 item 增加一个可选的复核凭证字段**，并让 `blockingFromAdjudication` 认它：

   ```jsonc
   {
     "id": "i2", "severity": "Critical", "highRiskDomains": ["crypto"], "verdict": "upheld",
     "externalReview": {                    // ← 新增，可缺省 ⇒ 完全向后兼容
       "performedBy": "claude",             // 必须通过既有 familyCheck（与 proposer 不同家族）
       "evidenceRef": ".ccg/reviews/24cf2d8f…json#i2",
       "reviewedAt": "2026-10-17T08:01:20.554Z"
     }
   }
   ```

   判据：`highRiskDomains` 非空的条目，当且仅当 `externalReview` 三字段齐备**且** `performedBy` 通过既有跨家族校验时，从 `blocking` 移出、计入新的 `resolvedByExternalReview`；缺任一字段 ⇒ 维持阻断（fail-closed）。这只给 ③ 增加一个输入，不动收敛判据本身。

2. **新增一个闭环状态值**（如 `externally_reviewed_resolved`），让「有外部凭证」与「self-play 自证清白」在状态上可区分；下游可以按策略只认前者，而不必把白名单整体放宽。

3. **裁决后的阻断项允许携带"已被后续提交解决"的引用**（哪怕是 `resolvedBy: <commit>` 这种弱形式）。现状是 upheld ⇒ 永久 blocked，逼使用者去改 `verdict`（把真问题写成 dismissed）来让 CI 变绿 —— 这个反向激励比缺字段本身更危险。

4. **`classifyHighRisk` 的两处收口**：
   - 若调用方已显式提供 `highRiskDomains`，MUST 以其为准（或至少出声），不要静默重算覆盖 —— 现在传 `['crypto']` 回来的是 `[]`，两个口径同时存在且互不认账；
   - 域标签的输入面建议限定到**改动集**（路径/符号/ diff 文本），而不是评审条目自由文本。按现有正则，一句只谈文档的散文就能把一次审查钉成不可闭合。

5. （可选）**让 resume 路径跨提交可用**：把存档 critique 与 commit sha 解耦（按 diff 内容寻址），否则 squash/rebase 工作流里每次改一笔提交都要重付一轮模型成本。

## 复现（只依赖引擎导出，不依赖本仓）

```bash
node - <<'EOF'
const path=require('path');
const home=process.env.HOME||process.env.USERPROFILE||'';
const e=require(path.join(home,'.claude/skills/adversarial-review-loop/scripts/engine.js'));
const cfg={maxRounds:3,scoreThreshold:8,stallRounds:2,stallScoreDelta:0.5,selfPlay:{enabled:true,confidenceWeight:0.6}};
const item={id:'i2',severity:'Critical',highRiskDomains:['crypto']};
const r1={round:1,minScore:4,critique:{issues:[item]},
  processed:{accepted:[],rejected:[],rejectedWithEvidence:[],partiallyAccepted:[]}};
console.log('③ 独占：', JSON.stringify(e.convergenceDecision({currentRound:3,rounds:[r1]},cfg)));
console.log('② 不可达：', JSON.stringify(e.isStalled([r1],cfg)));
console.log('散文触发域标签：', JSON.stringify(e.classifyHighRisk('本 PR 未触碰任何加解密代码，只在文案里提到加密')));
EOF
```

期望：第一行 `status=self_play`（且返回体里该 item 的 `highRiskDomains` 变成 `[]` ⇒ 第 4 条）；第二行 `stalled=false`；第三行 `["crypto"]`。阻断侧要再看驱动 `blockingFromAdjudication` 对 `verdict:"dismissed"` 的高危项仍 push `high_risk_requires_external`。

## 非目标

不建议：整类摘掉高危域阻断、把 `blockingFromAdjudication` 直接改宽、或让下游门禁接受 `self_play_blocked`。这三条都能让 CI 立刻变绿，代价是把闸门变成装饰 —— 恰是上面「凭证字段」想替换掉的东西。

## 我们这边的现状（供你们判断优先级）

探针与回归锁已落在使用方仓库（`scripts/ccg-convergence-exit` 那次改动），能把「③ 独占」变成可复跑读数并在 CI 上守；但**闭合缺口本身在使用方无法修**，只能靠本 issue。两笔 PR 现按人工合并处理。
