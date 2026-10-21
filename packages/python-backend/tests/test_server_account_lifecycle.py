"""平台账号凭证目录与 Logto owner 生命周期测试。"""

from fastapi.testclient import TestClient

import pytest

import server


class StubVerifier:
    def __init__(self, subject: str):
        self.subject = subject

    async def verify(self, _token: str):
        return {"subject": self.subject, "scopes": ["account:manage"]}


def _client(monkeypatch, tmp_path, verifier: StubVerifier) -> TestClient:
    monkeypatch.setattr(server, "IDENTITY_AUTH_ENABLED", True)
    monkeypatch.setattr(server, "IDENTITY_AUTH_REQUIRED", True)
    monkeypatch.setattr(server, "IDENTITY_VERIFIER", verifier)
    monkeypatch.setattr(server, "DATA_DIR", tmp_path)
    monkeypatch.setattr(server, "ACCOUNTS_FILE", tmp_path / "accounts.json")
    return TestClient(server.app)


def _headers(token: str = "token-a") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_load_accounts_accepts_utf8_bom(monkeypatch, tmp_path):
    accounts_file = tmp_path / "accounts.json"
    accounts_file.write_bytes(b'\xef\xbb\xbf{"account-a": {"id": "account-a"}}')
    monkeypatch.setattr(server, "ACCOUNTS_FILE", accounts_file)

    assert server._load_accounts() == {"account-a": {"id": "account-a"}}


def test_create_delete_metadata_account_never_creates_credential_files(monkeypatch, tmp_path):
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    created = client.post(
        "/api/accounts",
        headers=_headers(),
        json={
            "platform": "douyin",
            "name": "账号 A",
        },
    )

    assert created.status_code == 200
    account_id = created.json()["data"]["id"]
    account_dir = tmp_path / "accounts" / "douyin" / account_id
    assert not account_dir.exists()
    stored = server._load_accounts()[account_id]
    assert stored["owner_subject"] == "sub-a"
    assert "cookies" not in stored
    assert "auth_data" not in stored

    legacy_auth_file = tmp_path / "auth_douyin.json"
    legacy_cookie_file = tmp_path / "cookies_douyin.json"
    legacy_auth_file.write_text('{"token": "legacy"}', encoding="utf-8")
    legacy_cookie_file.write_text('[{"name": "sid"}]', encoding="utf-8")

    deleted = client.delete(f"/api/accounts/{account_id}", headers=_headers())

    assert deleted.status_code == 200
    assert not account_dir.exists()
    assert account_id not in server._load_accounts()
    assert not legacy_auth_file.exists()
    assert not legacy_cookie_file.exists()


def test_cookie_endpoint_is_disabled_before_owner_lookup_and_metadata_remains_isolated(monkeypatch, tmp_path):
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    created = client.post(
        "/api/accounts",
        headers=_headers(),
        json={
            "platform": "douyin",
            "name": "账号 A",
        },
    )
    account_id = created.json()["data"]["id"]

    verifier.subject = "sub-b"
    update = client.put(
        f"/api/accounts/{account_id}/cookies",
        headers=_headers("token-b"),
        json={"cookies": []},
    )
    delete = client.delete(f"/api/accounts/{account_id}", headers=_headers("token-b"))

    assert update.status_code == 410
    assert update.json()["detail"] == "CREDENTIAL_ENDPOINT_DISABLED"
    assert delete.status_code == 404
    stored = server._load_accounts()[account_id]
    assert stored["owner_subject"] == "sub-a"
    assert "cookies" not in stored
    assert "auth_data" not in stored


def test_create_account_duplicate_by_platform_account_id_returns_409(monkeypatch, tmp_path):
    """相同 platform_account_id（强标识）重复添加返回 409。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 A", "platform_account_id": "uid-123"},
    )
    assert first.status_code == 200

    dup = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 A 改名", "platform_account_id": "uid-123"},
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "此账号已添加过"


def test_create_account_both_ids_empty_same_name_allows_multi_account(monkeypatch, tmp_path):
    """双方 platform_account_id 均为空 + 同名 → 允许添加（同平台多账号契约）。

    v4/v5 曾据此判 409，那是把 `name`（document.title 落盘位）当身份标识的结果；
    头条号等平台采不到 ID 时 name 一律回落平台名，三个号会全部被误判成同一个。
    """
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "抖音"},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "抖音"},
    )
    assert second.status_code == 200


def test_create_account_one_side_has_id_same_name_allows_multi_account(monkeypatch, tmp_path):
    """一方有 platform_account_id 一方没有 + 同名 → 允许添加（v5 错误判据的反向锁）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "抖音", "platform_account_id": "uid-123"},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "抖音"},
    )
    assert second.status_code == 200


def test_create_account_not_duplicate_when_only_one_side_has_id_different_name(monkeypatch, tmp_path):
    """一方有 platform_account_id 一方没有 + 不同名 → 不判定重复（保留提取失败保护）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 A", "platform_account_id": "uid-123"},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 B"},
    )
    assert second.status_code == 200


# ─── 同平台多账号去重契约（fix-multi-account-same-platform） ─────────────────
# 背景：v5（c84325baa）为补「一方有 ID 一方没有 + 同名」的漏检，把 `name` 当成了
# 账号身份标识。而 `name` 是 auth-view-manager `document.title` 的落盘位
# （见 apps/desktop/src/utils/account-display-name.js:14），不是稳定标识：
# 头条号/百家号等平台的 `platform_account_id` 选择器只认 `[data-account-id]`，
# 采不到时 name 一律回落平台名（resolveCapturedDisplayName → getPlatformName），
# 于是同一平台的多个不同账号会因同名被误判为「已添加过」。
# 本组用例锁定修正后的契约：只有 platform_account_id 才是账号身份。


def test_create_account_same_platform_different_account_no_id_not_duplicate(monkeypatch, tmp_path):
    """同平台第二个账号、双方都无 platform_account_id → 必须允许添加（回归本 Bug）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "account_name": "头条号甲"},
    )
    assert first.status_code == 200

    # 第二个头条号：采集不到 ID，name 同样回落平台名「今日头条」
    second = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "account_name": "头条号乙"},
    )

    assert second.status_code == 200
    assert second.json()["message"] == "账号添加成功"


def test_create_account_same_platform_same_account_id_is_duplicate(monkeypatch, tmp_path):
    """同一 platform_account_id 重复添加仍是 409（强标识去重能力不得退化）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "account_name": "头条号甲", "platform_account_id": "uid-tt-1"},
    )
    assert first.status_code == 200

    dup = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "account_name": "头条号乙", "platform_account_id": "uid-tt-1"},
    )

    assert dup.status_code == 409
    assert dup.json()["detail"] == "此账号已添加过"


def test_create_account_same_platform_different_id_not_duplicate(monkeypatch, tmp_path):
    """同平台不同 platform_account_id（无论名称是否相同）→ 不判定重复。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "account_name": "头条号甲", "platform_account_id": "uid-tt-1"},
    )

    second = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "account_name": "头条号甲", "platform_account_id": "uid-tt-2"},
    )

    assert second.status_code == 200


def test_create_account_asymmetric_id_same_name_not_duplicate(monkeypatch, tmp_path):
    """一方有 ID 一方没有 + 同名 → 不判定重复（v5 的错误判据，本测试是其反向锁）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "platform_account_id": "uid-tt-1"},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条"},
    )

    assert second.status_code == 200


def test_create_account_duplicate_id_is_scoped_to_platform(monkeypatch, tmp_path):
    """同一 platform_account_id 在不同平台不构成重复（ID 是平台内标识）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "platform_account_id": "uid-shared"},
    )

    second = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "baijiahao", "name": "百家号", "platform_account_id": "uid-shared"},
    )

    assert second.status_code == 200


def test_create_account_duplicate_is_scoped_to_owner(monkeypatch, tmp_path):
    """同一 platform_account_id 属于不同 owner 不构成重复（多租户隔离）。

    同时锁 CCG 深度审查 i4 的性质：调用方只能看到/撞到**自己 owner** 下的 ID，
    构造别人的 ID 不会触发 409（_is_owned_by 挡住）。
    """
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    client.post(
        "/api/accounts",
        headers=_headers("token-a"),
        json={"platform": "toutiao", "name": "今日头条", "platform_account_id": "uid-tt-1"},
    )

    verifier.subject = "sub-b"
    second = client.post(
        "/api/accounts",
        headers=_headers("token-b"),
        json={"platform": "toutiao", "name": "今日头条", "platform_account_id": "uid-tt-1"},
    )

    assert second.status_code == 200


def test_create_account_cross_owner_id_does_not_block_second_owner(monkeypatch, tmp_path):
    """sub-b 先用别人的 ID 撞一次 409 后，仍能用同一 ID 之外的身份正常添加。

    锁 i4 的防御性质：构造已知 ID 最多挡住调用方自己，不影响其他账号入库。
    """
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    client.post(
        "/api/accounts",
        headers=_headers("token-a"),
        json={"platform": "toutiao", "name": "今日头条", "platform_account_id": "uid-tt-1"},
    )

    verifier.subject = "sub-b"
    # sub-b 撞同一个 ID：sub-a 的那个不归它所有，故不判重
    blocked = client.post(
        "/api/accounts",
        headers=_headers("token-b"),
        json={"platform": "toutiao", "name": "sub-b 的号", "platform_account_id": "uid-tt-1"},
    )
    assert blocked.status_code == 200
    # 且 sub-b 自己的第二个号（无 ID）照样能加
    second = client.post(
        "/api/accounts",
        headers=_headers("token-b"),
        json={"platform": "toutiao", "name": "今日头条"},
    )
    assert second.status_code == 200


def test_startup_dedup_keeps_same_platform_accounts_without_ids(tmp_path):
    """启动去重不得再把「同平台+同名+无 ID」的多个账号清成一条（与创建路径同契约）。"""
    import server as srv
    monkeypatch = __import__('_pytest.monkeypatch').monkeypatch.MonkeyPatch()
    monkeypatch.setattr(srv, "ACCOUNTS_FILE", tmp_path / "accounts.json")

    srv._save_accounts({
        "a1": {"id": "a1", "platform": "toutiao", "name": "今日头条", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "a2": {"id": "a2", "platform": "toutiao", "name": "今日头条", "owner_subject": "sub-a", "created_at": "2025-01-02T00:00:00"},
        "b1": {"id": "b1", "platform": "toutiao", "name": "今日头条", "owner_subject": "sub-a", "platform_account_id": "uid-tt-1", "created_at": "2025-01-03T00:00:00"},
    })

    srv._dedup_accounts_on_startup()

    accounts = srv._load_accounts()
    assert "a1" in accounts
    assert "a2" in accounts
    assert "b1" in accounts
    assert len(accounts) == 3


def test_startup_dedup_still_removes_same_id_duplicates(tmp_path):
    """启动去重仍须清理同一 platform_account_id 的存量重复（能力不退化的另一面）。"""
    import server as srv
    monkeypatch = __import__('_pytest.monkeypatch').monkeypatch.MonkeyPatch()
    monkeypatch.setattr(srv, "ACCOUNTS_FILE", tmp_path / "accounts.json")

    srv._save_accounts({
        "a1": {"id": "a1", "platform": "toutiao", "name": "今日头条", "platform_account_id": "uid-tt-1", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "a2": {"id": "a2", "platform": "toutiao", "name": "今日头条", "platform_account_id": "uid-tt-1", "owner_subject": "sub-a", "created_at": "2025-01-02T00:00:00"},
    })

    srv._dedup_accounts_on_startup()

    accounts = srv._load_accounts()
    assert "a2" in accounts
    assert "a1" not in accounts
    assert len(accounts) == 1


def test_startup_dedup_ignores_platform_fallback_names(tmp_path):
    """「两个号都回落成平台名」不得再被判为重复而清掉一个（本 Bug 的启动侧形态）。"""
    import server as srv
    monkeypatch = __import__('_pytest.monkeypatch').monkeypatch.MonkeyPatch()
    monkeypatch.setattr(srv, "ACCOUNTS_FILE", tmp_path / "accounts.json")

    srv._save_accounts({
        "t1": {"id": "t1", "platform": "toutiao", "name": "今日头条", "account_name": "头条号甲", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "t2": {"id": "t2", "platform": "toutiao", "name": "今日头条", "account_name": "头条号乙", "owner_subject": "sub-a", "created_at": "2025-01-02T00:00:00"},
        "t3": {"id": "t3", "platform": "toutiao", "name": "今日头条", "account_name": "头条号丙", "owner_subject": "sub-a", "created_at": "2025-01-03T00:00:00"},
    })

    srv._dedup_accounts_on_startup()

    accounts = srv._load_accounts()
    assert len(accounts) == 3


def test_create_account_rejects_non_string_platform_account_id(monkeypatch, tmp_path):
    """platform_account_id 必须是字符串：Pydantic 在 HTTP 层即 422，不进入判重。

    锁 i3（CCG 深度审查）：写入侧类型由模型把关，非字符串 ID 到不了
    _account_identity_key；读取侧的脏值则由该函数自身按 fail-safe 收敛（见
    test_account_identity_key_non_string_returns_none）。
    """
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)

    bad = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 A", "platform_account_id": 12345},
    )

    assert bad.status_code == 422
    assert server._load_accounts() == {}


def test_create_account_non_string_stored_id_does_not_break_create(monkeypatch, tmp_path):
    """存量 accounts.json 里 platform_account_id 是脏类型时，创建不得被它打死。

    读侧 fail-safe：脏值按「无强标识」处理，允许继续创建（与
    _normalize_account_status/_normalize_account_active 同向）。
    """
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    server._save_accounts({
        "legacy1": {
            "id": "legacy1",
            "platform": "douyin",
            "name": "老账号",
            "platform_account_id": 12345,  # 历史脏值：数字而不是字符串
            "owner_subject": "sub-a",
            "created_at": "2025-01-01T00:00:00",
        }
    })

    created = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "新账号", "platform_account_id": "uid-1"},
    )

    assert created.status_code == 200


def test_account_identity_key_non_string_returns_none():
    """_account_identity_key 只认字符串：None/空串/空白/数字/列表都返回 None。"""
    import server as srv

    assert srv._account_identity_key(None) is None
    assert srv._account_identity_key("") is None
    assert srv._account_identity_key("   ") is None
    assert srv._account_identity_key(12345) is None
    assert srv._account_identity_key(1.5) is None
    assert srv._account_identity_key(["uid"]) is None
    assert srv._account_identity_key({"uid": 1}) is None
    assert srv._account_identity_key("  uid-1  ") == "uid-1"


def test_startup_dedup_ignores_non_string_stored_ids(tmp_path):
    """启动去重遇到非字符串 ID 不得抛异常，也不得把两条脏值账号误判为重复。"""
    import server as srv
    monkeypatch = __import__('_pytest.monkeypatch').monkeypatch.MonkeyPatch()
    monkeypatch.setattr(srv, "ACCOUNTS_FILE", tmp_path / "accounts.json")

    srv._save_accounts({
        "a1": {"id": "a1", "platform": "douyin", "name": "甲", "platform_account_id": 12345, "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "a2": {"id": "a2", "platform": "douyin", "name": "乙", "platform_account_id": ["uid"], "owner_subject": "sub-a", "created_at": "2025-01-02T00:00:00"},
        "a3": {"id": "a3", "platform": "douyin", "name": "丙", "platform_account_id": "uid-3", "owner_subject": "sub-a", "created_at": "2025-01-03T00:00:00"},
    })

    srv._dedup_accounts_on_startup()  # 不得抛异常

    accounts = srv._load_accounts()
    assert len(accounts) == 3


def test_startup_dedup_removes_duplicate_accounts(tmp_path):
    """启动时去重：同平台+同owner+同一 platform_account_id，保留最新一条。"""
    import server as srv
    monkeypatch = __import__('_pytest.monkeypatch').monkeypatch.MonkeyPatch()
    monkeypatch.setattr(srv, "ACCOUNTS_FILE", tmp_path / "accounts.json")

    # 构造 3 个同一 platform_account_id 的百家号账号（不同 id，不同 created_at）
    srv._save_accounts({
        "a1": {"id": "a1", "platform": "baijiahao", "name": "百家号账号", "platform_account_id": "uid-bjh", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "a2": {"id": "a2", "platform": "baijiahao", "name": "百家号账号", "platform_account_id": "uid-bjh", "owner_subject": "sub-a", "created_at": "2025-01-02T00:00:00"},
        "a3": {"id": "a3", "platform": "baijiahao", "name": "百家号账号", "platform_account_id": "uid-bjh", "owner_subject": "sub-a", "created_at": "2025-01-03T00:00:00"},
        "b1": {"id": "b1", "platform": "kuaishou", "name": "快手账号", "platform_account_id": "uid-ks", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
    })

    srv._dedup_accounts_on_startup()

    accounts = srv._load_accounts()
    # 百家号应只剩 a3（最晚），快手 b1 保留
    assert "a3" in accounts
    assert "a1" not in accounts
    assert "a2" not in accounts
    assert "b1" in accounts
    assert len(accounts) == 2


def test_startup_dedup_keeps_unique_accounts(tmp_path):
    """无重复账号时，启动去重不误删。"""
    import server as srv
    monkeypatch = __import__('_pytest.monkeypatch').monkeypatch.MonkeyPatch()
    monkeypatch.setattr(srv, "ACCOUNTS_FILE", tmp_path / "accounts.json")

    srv._save_accounts({
        "a1": {"id": "a1", "platform": "baijiahao", "name": "百家号", "platform_account_id": "uid-bjh", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "b1": {"id": "b1", "platform": "kuaishou", "name": "快手", "platform_account_id": "uid-ks", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
    })

    srv._dedup_accounts_on_startup()

    accounts = srv._load_accounts()
    assert len(accounts) == 2
    assert "a1" in accounts
    assert "b1" in accounts


# ─── 登录态持久化真源（status） ──────────────────────────────────────────
# 背景：一键检测的结论此前没有任何持久化落点（后端无 status 字段，渲染层误写
# Electron SQLite），导致「检测出失效 → 重进账号页仍显示已登录」。
# 以下用例锁定 accounts.json 作为登录态唯一真源的契约。


def test_create_account_initializes_status_unverified(monkeypatch, tmp_path):
    """新建账号从未检测过，status 必须是 unverified（不冒充已登录）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)

    created = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 A"},
    )

    assert created.status_code == 200
    account_id = created.json()["data"]["id"]
    assert created.json()["data"]["status"] == "unverified"
    assert server._load_accounts()[account_id]["status"] == "unverified"


def test_patch_account_persists_status_and_echoes_on_list(monkeypatch, tmp_path):
    """PATCH status=expired 必须 200 且落盘，GET 回显同一值（重启后仍是失效）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "toutiao", "name": "头条号"}
    ).json()["data"]["id"]

    patched = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"status": "expired", "last_validated": "2026-09-22T15:38:27.000Z"},
    )

    assert patched.status_code == 200
    assert patched.json()["data"]["status"] == "expired"
    assert server._load_accounts()[account_id]["status"] == "expired"
    assert server._load_accounts()[account_id]["last_validated"] == "2026-09-22T15:38:27.000Z"

    listed = client.get("/api/accounts", headers=_headers())
    assert listed.status_code == 200
    item = next(a for a in listed.json()["data"] if a["id"] == account_id)
    assert item["status"] == "expired"
    assert item["last_validated"] == "2026-09-22T15:38:27.000Z"


@pytest.mark.parametrize("status", ["active", "expired", "unverified"])
def test_patch_account_accepts_all_valid_statuses(monkeypatch, tmp_path, status):
    """三态（含未确认）都必须可写回，否则「未确认」无法固化。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "douyin", "name": "账号 A"}
    ).json()["data"]["id"]

    patched = client.patch(
        f"/api/accounts/{account_id}", headers=_headers(), json={"status": status}
    )

    assert patched.status_code == 200
    assert patched.json()["data"]["status"] == status
    assert server._load_accounts()[account_id]["status"] == status


def test_patch_account_rejects_unknown_status_without_mutation(monkeypatch, tmp_path):
    """非法 status 必须 400 且不改动已存值（避免脏写污染真源）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "douyin", "name": "账号 A"}
    ).json()["data"]["id"]
    client.patch(f"/api/accounts/{account_id}", headers=_headers(), json={"status": "expired"})

    bad = client.patch(
        f"/api/accounts/{account_id}", headers=_headers(), json={"status": "logged_in"}
    )

    assert bad.status_code == 400
    assert bad.json()["detail"] == "ACCOUNT_STATUS_INVALID"
    assert server._load_accounts()[account_id]["status"] == "expired"


def test_patch_account_status_is_orthogonal_to_is_active(monkeypatch, tmp_path):
    """登录态 status 与启用开关 is_active 正交，写 status 不得污染启用状态。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "douyin", "name": "账号 A"}
    ).json()["data"]["id"]

    patched = client.patch(
        f"/api/accounts/{account_id}", headers=_headers(), json={"status": "expired"}
    )

    assert patched.status_code == 200
    assert patched.json()["data"]["is_active"] is True
    assert patched.json()["data"]["status"] == "expired"
    assert server._load_accounts()[account_id]["is_active"] is True


def test_legacy_account_without_status_is_reported_unverified(monkeypatch, tmp_path):
    """历史 accounts.json 无 status 字段：读取时补 unverified，不抛 KeyError。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    server._save_accounts({
        "legacy1": {
            "id": "legacy1",
            "platform": "bilibili",
            "name": "老账号",
            "owner_subject": "sub-a",
            "created_at": "2025-01-01T00:00:00",
        }
    })

    listed = client.get("/api/accounts", headers=_headers())

    assert listed.status_code == 200
    assert listed.json()["data"][0]["status"] == "unverified"
def _account_is_active(client, account_id):
    return client.get(f"/api/accounts/{account_id}", headers=_headers()).json()["data"]["is_active"]


@pytest.mark.parametrize("target", [False, True])
def test_patch_account_is_active_persists_without_touching_status(monkeypatch, tmp_path, target):
    """is_active 必须能写进唯一真源，且不得污染登录态三态（两者正交）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "douyin", "name": "账号 A"}
    ).json()["data"]["id"]
    client.patch(f"/api/accounts/{account_id}", headers=_headers(), json={"status": "expired"})

    patched = client.patch(
        f"/api/accounts/{account_id}", headers=_headers(), json={"is_active": target}
    )

    assert patched.status_code == 200
    assert patched.json()["data"]["is_active"] is target
    assert patched.json()["data"]["status"] == "expired"
    assert server._load_accounts()[account_id]["is_active"] is target
    assert server._load_accounts()[account_id]["status"] == "expired"


def test_patch_account_is_active_survives_list_endpoint(monkeypatch, tmp_path):
    """停用后列表接口必须回读 is_active=False，否则前端拿不到启用态。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "douyin", "name": "账号 A"}
    ).json()["data"]["id"]

    client.patch(f"/api/accounts/{account_id}", headers=_headers(), json={"is_active": False})
    listed = client.get("/api/accounts", headers=_headers())

    assert listed.status_code == 200
    assert listed.json()["data"][0]["is_active"] is False
    assert _account_is_active(client, account_id) is False


@pytest.mark.parametrize("payload", [{"is_active": "no"}, {"is_active": 1}, {"is_active": [False]}])
def test_patch_account_is_active_rejects_non_boolean(monkeypatch, tmp_path, payload):
    """启用态是严格布尔：不接受隐式真值收敛，避免脏源。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "douyin", "name": "账号 A"}
    ).json()["data"]["id"]

    bad = client.patch(f"/api/accounts/{account_id}", headers=_headers(), json=payload)

    assert bad.status_code == 422
    assert _account_is_active(client, account_id) is True


def test_patch_account_invalid_status_does_not_half_write_is_active(monkeypatch, tmp_path):
    """同一请求里 status 非法时，is_active 不得被半更新（校验先于写盘）。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    account_id = client.post(
        "/api/accounts", headers=_headers(), json={"platform": "douyin", "name": "账号 A"}
    ).json()["data"]["id"]

    bad = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"status": "inactive", "is_active": False},
    )

    assert bad.status_code == 400
    assert bad.json()["detail"] == "ACCOUNT_STATUS_INVALID"
    assert _account_is_active(client, account_id) is True
    assert server._load_accounts()[account_id]["status"] != "inactive"


def test_legacy_account_with_dirty_status_is_normalized_unverified(monkeypatch, tmp_path):
    """历史脏值（曾把启用/停用写进 status）读侧必须降级为 unverified，不冒充已登录。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    server._save_accounts({
        "legacy2": {
            "id": "legacy2",
            "platform": "bilibili",
            "name": "脏状态账号",
            "status": "inactive",
            "owner_subject": "sub-a",
            "created_at": "2025-01-01T00:00:00",
        }
    })

    listed = client.get("/api/accounts", headers=_headers())

    assert listed.status_code == 200
    assert listed.json()["data"][0]["status"] == "unverified"
