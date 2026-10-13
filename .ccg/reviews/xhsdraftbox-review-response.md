# QM-6 逐条处置回应（xhs-draft-box-restore，2026-10-13）

两轴结论：backend 轴 VERDICT=CHANGES_REQUESTED，frontend 轴 VERDICT=PASS。
下表按"正文说了什么"处置，不按标签——**backend 轴两条被标 Critical 的，正文实为确认**
（一条写"两处行为一致……无放宽成功路径"，一条写"符合 fail-closed，无永不退出风险"），
照正文不处置；本仓已有先例记录"Critical 标签可能是误标确认"，故一律核正文再动。

## 采纳并已改（同 PR 内）

| 出处 | 正文主张 | 处置 |
|------|----------|------|
| backend Warning#1 + frontend Info#1 | `await_draft_box_increment` 的 `baseline` 无类型注解，而同模块 `visible_texts`/`visible_count`/`risk_present`/`await_control` 全有 | 补 `baseline: int | None` 与返回注解 `tuple[bool, int | None]`。这是全仓纪律"注解要么全有要么全无，别只注解一半" |
| frontend Warning#1 | `draft_box_count` 在「节点可见、文本读到了、但正则不命中」时**零日志**，与「读不到节点」同形；超时那条 warning 只说"读不到节点"，会把显示形态漂移误读成时序问题 | 加 `logger.debug` 分支（级别刻意压低：它在轮询里会重复打，出声位置由 `await_draft_box_count` 在超时处统一承担），并把超时文案改成「既读不到可见节点、或读到了但文本解析不出计数」两种成因；新增 `test_unparsable_counter_text_leaves_its_own_trace` 钉这条留痕，变异 M3（`if texts:` 改 `if False:`）实测该用例红 |
| frontend Warning#2 | 计数通道失效时确认全压向 `draft_title_present`，而该选择器**自承未经活体取证**；双通道同时不灵则每次保存都 `XHS_UNCONFIRMED`，且日志无法区分"少一条证据"与"判据整体失效" | 区分度由上一条的文案 + debug 现场提供，方向不改（fail-closed 是对的）；「给 `DRAFT_BOX_ITEM_SELECTOR` 排活体取证」进执行记录的未收口清单——本轮没有真机取证条件，**不得**为凑判据编造选择器结论 |
| frontend Info#3 + #4 | 类 docstring 与用例 docstring 重复叙述同一事故；且我的类 docstring 写着"清理冲突标记时选错侧"——这个归因**已被我自己在 re-sync 前实测否证** | 两处措辞按实测改写为「实现半边从未落地」，并把内部面那条锁的定位改诚实：既有 `monkeypatch.setattr(dom, …)` 型用例在成员缺失时**同样会红**，本锁不可替代处只剩「入口函数装配 + 主判据先于整页兜底的顺序」两点。评审指出我的锁有重复叙述，这条批评成立，比辩护有价值 |

## 不采纳（给理由，不静默）

| 出处 | 正文主张 | 不采纳理由 |
|------|----------|------------|
| backend Warning#3 | AST 外部面锁应给 `read_text`/`ast.parse` 加 try/except，否则异常被 CI 读成"基建问题" | 反了。这条锁的失效方向必须是**响**：读不到文件或 AST 解析不了，正说明"引用完整性无从判定"，此时静默返回空集合才是装饰性门禁。既有 `len(referenced) >= 5` 下界已经覆盖"集合退化"这一支，异常支保持抛出 |
| backend Warning#4 | spy 内部面锁的盲区是实现改用局部闭包/热替换 | 评审自己已确认"本仓无此模式"。为不存在的写法加防御即违反"不为不可能的场景加错误处理" |
| backend Info#1 | 三处 docstring 都写"读不到返回 None"，建议合并 | 三条是三个不同函数的**各自契约**（谁在什么条件下不得把 None 当 0），不是同一规则被抄了三遍；合并会把契约推给读者跨函数拼接 |
| frontend Info#2 | `scan_cap` 与 `limit`/`probe_cap` 三套成本闸命名，建议改名 `item_cap` | 三者量的是不同东西（可见文案条数 / 节点探测次数 / 列表项扫描数），`draft_title_present` 的 docstring 已写明它专指列表项扫描数并解释为什么必须有闸。改名不增加信息，且 `item_scan_cap` 在调用方与既有常量名里已成对出现 |
| frontend Info#1 后半 | `baseline` 在 `recheck_draft_box` 是位置参、在 `await_draft_box_increment` 是 keyword-only，位置约定不统一 | 有意的：`recheck_draft_box` 是发布器侧唯一入口、参数顺序与 `_confirm_saved(page, monitor, title, baseline)` 的既有位置形态对齐；内层函数一律 keyword-only 防"两个 float 互换"。统一成一种反而更危险 |

## 复核证据

- 改后 `tests/test_xiaohongshu_dom_hardening.py` **62 passed**（原 61 + 留痕用例 1）；
  gui-test 同口径五文件 **119 passed**（原 118 + 同一条）。两处都是当场实跑读数，非换算。
- 变异驱动 **BASELINE rc=0 / 3 passed** → M1（改 `set_cover` 名）、M2（改 `draft_title_present` 名）、
  M3（`if texts:` 改 `if False:`）各自让**指定那一条**变红，三次 `RESTORE_BYTES_EQUAL=true`，
  `VERDICT=ALL_CAUGHT`
