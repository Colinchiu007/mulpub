# 任务：已否证清单 + 轮次上限

> **状态：未开工。** 本篇只落合同（proposal / spec delta / 本文件），代码一格未动。
> 顺序纪律：先测后码；每条判据各配一条变异反证；上限与清单**都不得有静默档**。

## 0. 前置读数（不做这步，后面的设计都是猜）

- [ ] 0.1 现取一次"记录名会随重投改变"的证据链（本 change 的核心前提，不能只引 proposal 的八轮表）：
  在同一 worktree 里改一行注释 → 重提交 → 比对 `git diff HEAD^ HEAD -- . ':(exclude).ccg' | sha256sum` 与新旧记录名。
  **预期不等**；若哪天相等了（比如钩子改了寻址），本 change 的落点决策要重做。
- [ ] 0.2 实测仓外引擎能否接受外部注入：`ccg-deep-review.js` 拼 critic 任务提示的那一段是否留有
  参数化入口（`--rebuttal-file` / env / 已有 payload 包装点）。读不出就**当场记为"需 vendor 改动"**，
  不得假设能行——本 change 依赖它，而它是仓外制品（改动需人工授权，先例：`verificationSeverityVerdict` 那一刀）。
- [ ] 0.3 量一次现状基线：`grep -c '"verdict": "dismissed"'` 在 `.ccg/reviews/*.json` 与
  `.adversarial/*/adjudication.json` 上各是多少（决定清单要不要兼容"历史上没有证据的否证"）。
- [ ] 0.4 确认钩子的记录暂存 glob 确实不跨 `/`（用真实 worktree 实测一次，别照抄注释）：
  在 `.ccg/reviews/probe/` 放一个 `.json`，看 `git status` 是否被 `:(glob).ccg/reviews/*.json` 收走。
  这条决定"账本为什么不能放 `.ccg` 下"，是**判据前提**不是风格偏好。

## 1. 轮次上限（先做这把，它不依赖 vendor）

- [ ] 1.1 TDD 红：入口按 **change 维度** 递增轮次——同一 change 连跑两次入口（假驱动，零模型调用），
  第二次读数 MUST 是 `external-round=2`；**重投提交后**（记录名变）再跑 MUST 是 `3`，不得回到 1。
- [ ] 1.2 TDD 红：上限默认 3；`MP_QM6_MAX_ROUNDS` 可覆盖；非法值回落 3 并打印告警。三档各一条，
  且非法值那条 MUST 断言"告警出现过"（静默回落是本仓定性的失败）。
- [ ] 1.3 TDD 红：超限 ⇒ 打印 `escalated` +「已达轮次上限，交人工」，且
  `check-pr-exec-record.js` 对该条 dual 产物 MUST 仍判未闭合（**这条是防"超限变自动放行"的唯一闸**）。
- [ ] 1.4 账本落点 `openspec/changes/<change>/external-rounds.json`：受管、可 diff、随 PR 走。
  写它 MUST 走原子替换（复用 `scripts/lib` 现成实现，不得再抄一份 rename 重试）。
- [ ] 1.5 变异反证：① 把计数键从 change 换成记录名 ⇒ 1.1 必须红（这一条若不变红，1.1 就是空断言）；
  ② 把"超限即 escalated"改成"超限即放行" ⇒ 1.3 必须红；③ 删掉回落告警 ⇒ 1.2 必须红。
- [ ] 1.6 接线：新测试文件登记进 `quality-gate.yml`（Gate 号现取，防撞号；并过
  `scripts/check-unwired-tests.js`），`.gitignore` 的 `scripts/*.js` 若命中则按既有惯例补 negation。

## 2. 已否证清单（依赖 §0.2 的结论，可能要多一次 vendor 授权）

- [ ] 2.1 定义 `rebuttals[]` 条目形状：`{fingerprint, finding, severity, verdict, evidence{kind, value}, dismissedAt}`。
  `evidence.kind` 闭集只收 `file-line` 与 `command`，其它一律拒进清单（MUST NOT "顺手放宽成字符串"）。
- [ ] 2.2 证据可核性判据（本仓有先例，复用不重抄）：`file-line` 形态 MUST 现场读那一行、
  行内容 MUST 与被指控对象的语义位置对得上（`grep` 到文件名不算）；`command` 形态 MUST 至少一条用例
  证明"命令跑出的摘要与登记的摘要不等时，该否证被拒"。
- [ ] 2.3 指纹算法 MUST 复用 `scripts/lib/ccg-delivery-digest.js` 的规范化实现（唯一一份），
  MUST NOT 在清单侧另写一份规范化——两份必然漂移，而漂移的表现是"重复指控永远判不出来"。
- [ ] 2.4 注入：把清单渲染成送审载荷的一段。失败/不支持 ⇒ `rebuttal-injection=absent` 一档出声，
  且 MUST NOT 同时打印"本轮无重复指控"（两条同现即假绿，各配一条用例）。
- [ ] 2.5 去重判定：同指纹 + 无新证据 ⇒ `duplicate_rebutted`，不计阻断但**留在记录里**；
  同指纹 + 有新证据 ⇒ 正常计阻断（MUST NOT 变成"否证过就永久免疫"，那会把闸拆掉）。
  "新证据"的判据形态与 2.2 同源，MUST NOT 自造第二套。
- [ ] 2.6 变异反证至少四条：① 指纹算法退回"取前 40 字符" ⇒ 2.5 红；② 注入档与"无重复"合并成一句 ⇒ 2.4 红；
  ③ 允许 `evidence` 为空串进清单 ⇒ 2.1/2.2 红；④ "否证过即永久跳过"（不看有没有新证据） ⇒ 2.5 红。
- [ ] 2.7 与 `qm6-closure-writeback` 的对账：本 change MUST NOT 触碰
  `CLOSED_DEEP_REVIEW_STATUSES` / `HIGH_RISK_SURFACES` / 收口矩阵；加一条结构锁钉住"这三个符号未被本 change 修改"，
  并在实现 PR 里回读该锁的读数（防"顺手统一"）。

## 3. 落账与交人工

- [ ] 3.1 执行记录 `openspec/records/<分支名>.md`（唯一强制载体）：八轮读数以**演进链**写，
  引用前现跑；未跑的范围点名交给 CI。
- [ ] 3.2 本 change 属"改谁来守门" ⇒ **不自动合并**，交人工；PR 正文须写明它**没有**改变"什么算闭合"。
- [ ] 3.3 与 #4148 的关系写清：#4148 的收口仍以"一轮零 Critical"为唯一机械出口，
  本 change 不为其提供新出口；若第 1 条（处置型收口）另行采纳，需与本 change 分别裁决、分别接线。

## 4. 已知的两个待决设计岔口（要人拍板，agent 不擅决）

- [ ] 4.1 **轮次怎么算"一轮"**：只计"真外部调用"（含模型调用）？还是含"复用存档 critique"的短路重跑？
  本 change 现按前者（短路重跑零模型调用，不该消耗预算），但这是**价值判断**，不是事实——需确认。
  注意选错的后果很具体：若计入短路重跑，"填完裁决再跑一次"这种**必须的**动作会白烧配额。
- [ ] 4.2 **清单跟着走还是留在原地**：`external-rounds.json` 放在 change 目录里 ⇒ 随 PR diff 可见、可审，
  但每次重跑都产生一次真实提交（本仓热点写面之一）。替代是放 `.ccg/` 下不受管——
  那等于把"上限有没有被绕过"变成只有本机知道的事，本 change 明确选**受管**。
  若你更在意提交噪声，正解是加"同一 PR 内多次重跑合并为一次记录更新"的写策略，而不是搬到不受管区。
