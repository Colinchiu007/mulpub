# QM-6 外部评审原件 · 后端轴（opencode/nemotron-3-ultra-free）

- 日期：2026-10-13
- 被评审 head：xhs-draft-box-restore（re-sync 后的 commit 序列，代码 diff 见 ``code.diff``）
- **通道降级（必须如实登记）**：本仓 QM-6 正道是 ``codeagent-wrapper`` + ``~/.claude/.ccg/config.toml``
  的 ``[routing].primary``（backend=codex / frontend=claude），两个后端都绑本机 CC Switch ``:15721``。
  本轮实测 ``Test-NetConnection 127.0.0.1 -Port 15721`` = **False** ⇒ 按既有替代通道走
  ``opencode run --model opencode/nemotron-3-ultra-free``，并把任务书收窄到 5 问、输出 ≤45 行（``-free`` 对长生成会 504）。
  因此本件是"替代通道上的一次独立视角"，**不得**被读成 CCG 双模型原样证据。
- 任务书：只读、禁止写文件、结论进 stdout（``--agent plan`` 会因"禁止写文件"而 rc=0 零结论，故不采）。
- stdout 原样粘贴于下方，未做删改；驱动 rc=0，stderr 另存 27367 字节未入库（内容为本仓绝对路径的
  读取日志，无结论性文字）。

---

Now I have all the information needed. Let me provide my review findings.

**SEVERITY(Warning) | xiaohongshu_dom.py:119-121 | await_draft_box_count 签名的第 3 参数是 `probe_cap: int`，但调用方 xiaohongshu.py(未读但测试揭示)与测试 `test_draft_box_wait_is_fed_the_draft_box_constants` 传参显示应为 `probe_cap: int` —— 此处一致，但 `baseline` 参数在 `await_draft_box_increment` 中无类型注解（L144），测试传入 `baseline=1` 为 int，实现应加 `baseline: int | None` 以匹配 `baseline is None` 判断语义**  

**SEVERITY(Critical) | xiaohongshu_dom.py:157-158 | `await_draft_box_increment` 在 `baseline is None` 时直接返回 `(False, None)`，这是 fail-closed；但 `recheck_draft_box` (L348-354) 只有 `baseline is not None` 时才走增量通道，`baseline is None` 时直接跳过到标题兜底 —— 两处行为一致（均不把 None 当 0），无放宽成功路径**  

**SEVERITY(Warning) | test_xiaohongshu_dom_hardening.py:1123-1139 | AST 扫描那条锁在以下情况会退化成空集合并误判通过：① `xhs.__file__` 指向的文件读不到（IOError 被吞掉未处理）② AST 形状变了如 `import xiaohongshu_dom as d` 而非 `as dom` ③ 变量重命名为非 `dom` 标识符。当前代码无 try/except 保护 `Path.read_text` 与 `ast.parse`，任一抛错会让测试报错而非静默绿，但「集合为空时 `len >= 5` 直接红」是正确的防御，真正的隐患是异常导致测试框架标记 error 而非 failure、被 CI 误判为基建问题**  

**SEVERITY(Warning) | test_xiaohongshu_dom_hardening.py:1142-1178 | spy 包住原实现那条锁在 `recheck_draft_box` 内部直接 `import` 并调用函数（而非通过 `dom.` 模块属性）时会测不到——但实现里全是 `await await_draft_box_increment(...)` 即模块属性访问，monkeypatch 生效。唯一盲区：若 `orig_increment`/`orig_title` 被闭包捕获后实现被热替换（本仓无此模式），spy 仍指向旧函数。**  

**SEVERITY(Critical) | xiaohongshu_dom.py:129-141 / 159-174 | `await_draft_box_count` 与 `await_draft_box_increment` 的轮询均用 `asyncio.sleep(interval_s)` 且仅在循环顶部检查 `loop.time() >= deadline` —— 若 `interval_s` 过大（如测试用 0.011s/0.02s 无害但生产常量 0.5s）会导致最后一次 `sleep` 跨过 deadline 后仍再轮询一次，延迟最多 `interval_s`；更严重的是 `baseline is None` 时直接返回 `(False, None)`，符合「不拿 0 顶替」规格，但 `recheck_draft_box` 在此分支直接跳过增量通道落入标题兜底，若标题兜底也因 `scan_cap` 截断未命中则返回 False → `XHS_UNCONFIRMED`，符合 fail-closed，无永不退出风险**  

**SEVERITY(Info) | xiaohongshu_dom.py:333-357 vs 119-141 | 计数解析逻辑在 `draft_box_count` 与 `await_draft_box_count`、`await_draft_box_increment` 共用，无重复实现；但「读不到节点返回 None」的语义在三处文档字符串各写一遍（L105、L123、L151），属口径分裂风险，建议提取为模块级常量文档字符串或单一实现注释**  

**VERDICT=CHANGES_REQUESTED**

