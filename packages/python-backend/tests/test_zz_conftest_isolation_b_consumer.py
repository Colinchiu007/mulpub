"""反证对 B（消费方）：不建库、不清库，断言自己拿到的是空账号存储。

与 `test_zz_conftest_isolation_a_wrecker.py` 成对使用；单独看这个文件毫无价值，
它的唯一作用是当 A 泄漏了状态时**必须变红**。

判据：把 `conftest.isolate_account_store_per_test` 里的 `tmp_path` 换成一个固定共享目录
（即「有指向、但用例之间不隔离」），重跑这两个文件，B 必须以
`AssertionError: ... zz-conftest-isolation-probe ...` 失败。若 B 仍然通过，说明
per-test 隔离并没有真正生效，或者本断言写成了恒真 —— 两种情况都意味着这把锁是假的。
"""

import server

# 与 A 文件中的常量保持一致。刻意不跨文件 import：tests/ 是包（含 __init__.py），
# 在 pytest 的 prepend 导入模式下 `from test_zz_..._a_wrecker import X` 会解析失败。
PROBE_ID = "zz-conftest-isolation-probe"


def test_b_consumer_starts_from_an_empty_account_store():
    accounts = server._load_accounts()

    assert accounts == {}, (
        "账号真源不是空的 —— conftest 的 per-test 隔离失效，"
        f"上一个用例泄漏了 {sorted(accounts)!r}"
    )
    assert PROBE_ID not in accounts
