# 任务

## 1. 取证（动手前，防止把不存在的缺口当已知前提修）

- [x] 1.1 证明"无注入点"是真的：`main()` 第一行 `const root = path.resolve(__dirname, '..')`（`scripts/check-gate-record-debt.js:945`），且 `parseFlags` 的白名单只有 `carrier-mode / base-ref / head-ref`（同文件 `:929`），传 `--root=…` 会被当"未知旗标"抛错。
- [x] 1.2 证明"没有任何东西在看这行映射"是**假的**（我自己写错过一次）：`scripts/check-gate-record-debt.test.js:1211` 那条 `端到端：真历史上一笔回填 PR 必须让 CLI 判红并点名那篇记录` 经 `--base-ref/--head-ref` spawn 真进程并 `assert.strictEqual(r.status, 1)`；两次变异（包进块注释 / 挪进 `main()` 外的诱饵函数）里它与结构锁一起指名变红，读数记在 `openspec/records/qm6-critic-dispositions.md` 的《二、本片自身差量的 critic 轴》。
- [x] 1.3 量清"注入根之后哪些取源必须跟着切"：逐个列出 `main()` 里所有读生产仓库的调用（账本 / 冻结基线 / `buildLedger` 的 git cwd / `buildClosureDiff` 的 git cwd），逐个标注是否已随 `root` 走。**未列全就动手 = 留一半真仓证据**（本仓"取源必须成对"的同族）。 **→ 落点**。落点：`main()` 里读生产仓库的共 4 处 —— `loadLedger(root)`／`loadCarrierFreeze()`（**原先无参，读 `__dirname` 那份真仓基线，不跟 root**）／`buildLedger({cwd: root})`／`buildClosureDiff({cwd: root})`。冻结基线这一处就是"只切一半"的真实现场，已被 3.3/M-B 钉住

## 2. 合同

- [x] 2.1 `specs/quality-gate-execution-record/spec.md` 的 ADDED Requirement 落笔：默认可覆盖、注入必须全域生效、裸旗标必须抛错、行为锁与结构锁并列存在。 **→ 落点**。`openspec/changes/debt-cli-root-injection/specs/quality-gate-execution-record/spec.md`：1 条 Requirement + 5 个 Scenario（默认零影响／注入全域生效／冻结跟根走／裸旗标与拼写／两把锁并列）
- [x] 2.2 `openspec validate debt-cli-root-injection --strict` 通过；**并做一次真 A/B**：故意把 Requirement 写成缺 Scenario 的形态跑一次，确认校验器会红（否则"validate 通过"不构成任何证据）。 **→ 落点**。`openspec validate debt-cli-root-injection --strict` → `is valid`；**四格负控**：V1「Requirement 无 Scenario」红、V4「缺 delta 段头」红、**V2「Scenario 缺 THEN」绿=校验器漏**、**V3「Requirement 空标题」绿=校验器漏** ⇒ validate 的可信下限比上一刀记录的更窄，改后已还原（`bytes_restored=true`、还原后 rc=0）

## 3. 实现（TDD：先看红，再写绿）

- [x] 3.1 先写行为用例并**当场见证它红**（红因必须是"没有 `--root` 这个旗标"，不是别家失败）：夹具根里放"载体有未收口行 + 账本不登记"，spawn 真 CLI 带 `--root=<夹具>`，断言 `rc === 1` 且 stdout 点名该记录标题。 **→ 落点**。先红后绿：红时 `# tests 120 / fail 4`，红因逐条核过 —— #117 是「输出必须点名那条未登记欠账，实际首行：<空>」（未知旗标 ⇒ 无 stdout），#119 是"没抛冻结缺失"，都不是别家失败
- [x] 3.2 实现 `--root`：进 `parseFlags` 白名单与 `needValue`；`main()` 取 `argv` 里的值解析，不给时**逐字保持** `path.resolve(__dirname, '..')`。 **→ 落点**。`parseRoot(argv)`：不给 → `path.resolve(__dirname, '..')`（逐字保持）；给了 → `path.resolve(raw)`；空值与不存在的目录一律抛错不回落。`parseFlags` 白名单与 `needValue` 同步加 `root`
- [x] 3.3 注入生效的**全域性**补一条断言（不是靠读代码）：夹具根下 `loadLedger` 读的是夹具那份，真仓账本不得参与判定——用"夹具账本写成非法形状 ⇒ CLI 必须按夹具的错抛/报"来证。 **→ 落点**。两条独立断言：#118（夹具账本写非法形状 ⇒ CLI 必须点名夹具那个键，真仓合法不得掺入）+ #119（夹具缺冻结基线 ⇒ 必须抛"旧载体冻结基线缺失"并点名**夹具内**路径）。M-B（把 freeze 退回 `__dirname`）**恰 1 红且红的是 #119** ⇒ 这条断言是可失败的，不是措辞
- [x] 3.4 非法值三档各自出声：未知拼写（`--roots=`）、裸旗标（`--root`）、指向不存在路径的值。前两档必须抛错；第三档必须 fail closed 并说明为何不静默回落（回落默认根会让"打错路径"读成"扫了真仓且没问题"）。 **→ 落点**。三档：未知拼写 `--roots=.` 与裸旗标 `--root` 由 #120 覆盖（M-D 去掉白名单 ⇒ 四条 CLI 用例全红）；不存在的目录由 `parseRoot` 抛错覆盖；另外默认路径零影响由改前/改后 CLI 对照覆盖（`rc=0/0`，首行逐字相同）

## 4. 回归与反证

- [x] 4.1 `node --test scripts/check-gate-record-debt.test.js` 全量绿，并打印用例总数（**"pass 数"不是覆盖证据**，要看见新用例名字在通过清单里出现过）。 **→ 落点**。`# tests 122 / # pass 122 / # fail 0`，并按**名字**回读通过清单（`ok 117..122` 六条新用例逐条在场）—— 只看 pass 数不构成覆盖证据
- [x] 4.2 变异反证，逐条要求**指名红**、红集互不相同：M-A 摘掉 `hasBlocking ⇒ process.exit(1)` 映射（新行为锁必须红）；M-B `--root` 只切账本、不切 git 取证 cwd（3.3 那条必须红）；M-C 默认路径改成 `process.cwd()`（防"不给旗标时行为变了"的既有锁必须红）；M-D 裸旗标不再抛错（3.4 必须红）。 **→ 落点**。M-A 3 红（新行为锁 + 接线锁 + 端到端）／M-B 恰 1 红（#119）／M-C 恰 1 红（#121）／M-D 4 红（四条 CLI 用例）；**红集互不相同**，`loadFail=false`，跑完判据文件 md5 回原值 `93c268d6b1`。**M-C 首跑是 NOT_CAUGHT**：断言的期望值与测试进程 cwd 同值 ⇒ 恒真；已改为"外来 cwd 下调 `parseRoot`" + "从外来 cwd 真跑 CLI"两条可失败形态（#121 + 新第 6 条）
- [x] 4.3 既有 `真仓形状锁 / 端到端 / 接线锁` 三条不退化，且**默认调用路径的 rc 与改前一致**（同一份真仓状态改前改后各跑一次对比）。 **→ 落点**。`116 → 122`，既有条目零退化；默认路径对照见 3.4 末（同一份真仓状态，`origin/main` 那份判据与改后判据各跑一次，rc 与首行逐字相同）

## 5. 收尾

- [x] 5.1 CHANGELOG 一个标题块（一条变更一个块，插完跑 `check-changelog-growth.js` 自证没吃掉上一条标题）。 **→ 落点**。CHANGELOG 置顶插入自检：标题块 573 → 574 恰 +1、`cr` 守恒 0、`lf` = base + 10、base 全文原样落在尾部；`check-changelog-growth.js --base=<merge-base>` **PASS**（注：`--base=origin/main` 会因主干在飞期间前进而假红，本仓口径是用 merge-base）；`check-changelog-duplicate-entries.js` OK
- [x] 5.2 执行记录 `openspec/records/debt-cli-root-injection.md`：QM-5 五步、变异红集、`--root` 的授权来源与日期（授权是"能不能改判据"的唯一依据，必须留在仓内而不是只活在对话里）。 **→ 落点**。`openspec/records/debt-cli-root-injection.md`：QM-5 五步 + 变异表 + 授权来源与日期（「第 2、3 条授权你改判据」）+ 本轮三条最值钱发现（恒真断言第四形态 / `rc=1` 双成因 / validate 又窄一格）
- [x] 5.3 消掉旧叙述：#4001 记录里"无 `--root` 注入点 ⇒ 造不出行为态"那句在本刀落地后不再成立，按"不改写历史、追加最新锚点取代旧表述"的口径处理（不改写那一行，在本刀记录里指名它并声明已被取代）。 **→ 落点**。核对结果与预期不同：**不需要新增指针** —— 那句假边界已在 #4001 的第二笔提交里被当场改写（`openspec/records/qm6-critic-dispositions.md` 的 F2 行与「遗留」第一条，红集 MW2a/M-W2c 为据）；本刀记录的第一性原因行再指名一次，历史未被改写
- [x] 5.4 全量本地判据（`classify-docs-only` 必为 `false` —— 本刀动 `scripts/` 自身 ⇒ 混合 PR，走完整质量节拍；`check-unwired-tests`、`check-no-brand-residue`、`check-doc-abs-paths`、`check-gate-record-debt`）。 **→ 落点**。全绿：`classify-docs-only` → `docs-only=false files=9`（动 `scripts/` 自身 ⇒ 混合 PR，不借道 docs-only）；`check-unwired-tests` OK；`check-no-brand-residue` PASS；`check-doc-abs-paths` PASS；`check-changelog-growth --base=<merge-base>` PASS；`check-changelog-duplicate-entries` OK；`check-gate-record-debt` rc=0；`check-record-qm5-rows` rc=0；`check-no-conflict-markers` OK；`check-pr-exec-record --mode=enforce` OK；`openspec validate debt-cli-root-injection --strict` valid（其下限另计，见 2.2）
- [x] 5.5 QM-6：本刀改的是**守门判据本体** ⇒ 必须外部评审；proposer 轴仍 IP 封禁，按 #3949 的既有裁决走"单轴 + 登记欠账"，不得读成双模型通过。 **→ 落点**。critic=claude 交付 4 条 Warning、0 Critical，逐条处置见 `openspec/records/debt-cli-root-injection.md` 第三节（W2/W3 接受、W1 部分、W4 拒绝给证据）；proposer 仍 IP 封禁 ⇒ 本 PR 是**单轴**，已按 #3949 裁决登记为活欠账
- [ ] 5.6 开 PR；满足自动合并判据则 squash + 删分支，产物判据四条取证；main push 按 `(merge SHA, workflow)` 回读，红了就本轮补 follow-up。
