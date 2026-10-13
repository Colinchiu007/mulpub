# QM-6 外部评审原件 · 前端轴（opencode/ling-3.1-flash-free）

- 日期：2026-10-13
- 被评审 head：xhs-draft-box-restore（re-sync 后的 commit 序列，代码 diff 见 ``code.diff``）
- **通道降级（必须如实登记）**：本仓 QM-6 正道是 ``codeagent-wrapper`` + ``~/.claude/.ccg/config.toml``
  的 ``[routing].primary``（backend=codex / frontend=claude），两个后端都绑本机 CC Switch ``:15721``。
  本轮实测 ``Test-NetConnection 127.0.0.1 -Port 15721`` = **False** ⇒ 按既有替代通道走
  ``opencode run --model opencode/ling-3.1-flash-free``，并把任务书收窄到 5 问、输出 ≤45 行（``-free`` 对长生成会 504）。
  因此本件是"替代通道上的一次独立视角"，**不得**被读成 CCG 双模型原样证据。
- 任务书：只读、禁止写文件、结论进 stdout（``--agent plan`` 会因"禁止写文件"而 rc=0 零结论，故不采）。
- stdout 原样粘贴于下方，未做删改；驱动 rc=0，stderr 另存 1086 字节未入库（内容为本仓绝对路径的
  读取日志，无结论性文字）。

---

Info | xiaohongshu_dom.py:await_draft_box_increment:144 | Q1 baseline 缺类型注解（visible_texts/visible_count/risk_present/await_control 全部注解），且同一 baseline 在 recheck_draft_box:333 为 positional、此处为 keyword-only，同一概念两种位置约定 | 补 baseline: int | None 注解与返回注解，位置约定二选一统一
Info | xiaohongshu_dom.py:draft_title_present:299 | Q1 模块出现第三个成本上限命名 scan_cap（既有 limit/probe_cap），语义虽异但同一"成本闸"概念三种写法 | 文档注明 scan_cap 专指列表项扫描数，或改名 item_cap 对齐 probe_cap
Warning | test_xiaohongshu_dom_hardening.py:test_recheck_path_reaches_the_draft_box_helpers:1142 | Q2 删除检测与既有 3 条用例重复（monkeypatch 缺属性即红、标题兜底正例必经 draft_title_present、增量委托由 wait-constants 用例钉住），唯一不可替代处是「增量先于兜底」的顺序钉（互换顺序属行为等价重构，现有用例全绿） | 顺序断言并入 test_counter_unchanged_is_not_a_confirmation 后删除本测 spy 脚手架；AST 外部面锁（1123）全新无重复，保留
Info | xiaohongshu_dom.py:await_draft_box_count:127 | Q3 末段「读不到判据/读到没增长是两件事」是模块两函数分工的元说明，不描述本函数行为 | 移到模块头或 await_draft_box_increment 文档
Info | test_xiaohongshu_dom_hardening.py:TestDomWiringContract:1111 | Q3 类 docstring 与 1142 的 test docstring 重复叙述同一事故经过（取证段落按仓规必须保留，去重即可） | 事故叙事只在类级留一份，测试 docstring 仅留断言意图
Info | xiaohongshu_dom.py:draft_box_count:108 | Q3 容错原则段与 test_counter_text_shape_is_tolerated 的 docstring 近乎逐字重复（跨文件双写同一"为什么"） | 一处留取证原文，另一处引用
Warning | xiaohongshu_dom.py:draft_box_count:99 | Q4 文案变形（去括号/角标数字/数字移出节点）时正则不命中→静默 None：计数通道是"少一条证据"而非失败，但「节点可见、文本在、解析不出」零日志，且基线读（xiaohongshu.py:236）会烧满 30s 超时才由 await_draft_box_count 留一条与「读不到节点」同形的 warning | 在 draft_box_count 加"有文本但正则不命中"分支告警，超时文案改为"读不到或解析不出"
Warning | xiaohongshu_dom.py:recheck_draft_box:348 | Q4 计数通道失效时确认全部压向 draft_title_present，而该选择器自承未经活体取证——两者同时不灵则每次保存都 XHS_UNCONFIRMED（"永远报失败"形态），且日志无法区分"少证据"与"全失效" | 给 DRAFT_BOX_ITEM_SELECTOR 排活体取证；双通道连败时升级一条 warning
Info | xiaohongshu_dom.py:DRAFT_BOX_COUNTER_RE:99 | Q5 未发现为让测试通过而写的实现；唯一候选是正则容错（全角括号/空格）超出活体取证样本（仅见半角），但 docstring 给出设计原则（显示格式非协议）支撑，属刻意放宽非测试倒逼 | 保持；收紧前先补活体取证
Info | test_xiaohongshu_dom_hardening.py:test_publisher_dom_references_all_resolve:1134 | Q5 下界 5 紧贴当前引用数（实现形态镜像），但注释已声明防解析退化意图且 AST 锁是新覆盖；1178 的 seen 顺序钉是语义（廉价主判据先于昂贵兜底）非实现细节 | 保持；引用数变化时同步抬下界
VERDICT=PASS

