"""反证对 A（制造方）：故意在账号真源里留下一行且不清理。

配套 `test_zz_conftest_isolation_b_consumer.py` 使用。两个文件合起来证明
`conftest.isolate_account_store_per_test` 是**承重**的，而不是装饰性的：

- fixture 正常工作时：每个用例的 `ACCOUNTS_FILE` 落在自己的 `tmp_path` 下，
  B 读到的是空库，两个文件都绿。
- 把 fixture 改成「所有用例共用同一个固定路径」后：A 留下的行会被 B 读到，
  B 必须**立刻变红**。若 B 仍绿，说明 fixture 没在起作用，或 B 的断言是恒真的。

⚠ 反证时**不要**把 fixture 改成彻底 no-op：那会让本文件把行写进 `server` 的模块默认
`ACCOUNTS_FILE`，在本机即真实的 `userData/backend-data/accounts.json`，等于污染用户数据。
正确做法是把 fixture 内的 `tmp_path` 换成一个固定的临时目录（保持「有指向、但不隔离」），
跑完还原。文件名前缀 `test_zz_` 保证按字母序 A 先于 B 被收集执行。
"""

import server

PROBE_ID = "zz-conftest-isolation-probe"


def test_a_wrecker_leaves_a_row_in_the_account_store():
    accounts = server._load_accounts()
    accounts[PROBE_ID] = {
        "id": PROBE_ID,
        "platform": "toutiao",
        "name": "隔离反证探针",
    }
    server._save_accounts(accounts)

    # 自证写入确实落到了当前 ACCOUNTS_FILE（否则 B 的空断言就没有意义）
    assert PROBE_ID in server._load_accounts()
