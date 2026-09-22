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


def test_create_account_duplicate_by_name_when_both_ids_empty_returns_409(monkeypatch, tmp_path):
    """双方 platform_account_id 均为空时，同名（弱标识）重复添加返回 409。"""
    verifier = StubVerifier("sub-a")
    client = _client(monkeypatch, tmp_path, verifier)
    first = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 A"},
    )
    assert first.status_code == 200

    dup = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "douyin", "name": "账号 A"},
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "此账号已添加过"


def test_create_account_duplicate_when_one_side_has_id_same_name(monkeypatch, tmp_path):
    """一方有 platform_account_id 一方没有 + 同名 → 判定为重复（名称是稳定兜底标识）。"""
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
        json={"platform": "douyin", "name": "账号 A"},
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "此账号已添加过"


def test_create_account_not_duplicate_when_only_one_side_has_id_different_name(monkeypatch, tmp_path):
    """一方有 platform_account_id 一方没有 + 不同名 → 不判定重复（避免提取失败误判）。"""
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


def test_startup_dedup_removes_duplicate_accounts(tmp_path):
    """启动时去重：同平台+同owner+同名账号，保留最新一条。"""
    import server as srv
    monkeypatch = __import__('_pytest.monkeypatch').monkeypatch.MonkeyPatch()
    monkeypatch.setattr(srv, "ACCOUNTS_FILE", tmp_path / "accounts.json")

    # 构造 3 个同名百家号账号（不同 id，不同 created_at）
    srv._save_accounts({
        "a1": {"id": "a1", "platform": "baijiahao", "name": "百家号账号", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "a2": {"id": "a2", "platform": "baijiahao", "name": "百家号账号", "owner_subject": "sub-a", "created_at": "2025-01-02T00:00:00"},
        "a3": {"id": "a3", "platform": "baijiahao", "name": "百家号账号", "owner_subject": "sub-a", "created_at": "2025-01-03T00:00:00"},
        "b1": {"id": "b1", "platform": "kuaishou", "name": "快手账号", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
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
        "a1": {"id": "a1", "platform": "baijiahao", "name": "百家号", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
        "b1": {"id": "b1", "platform": "kuaishou", "name": "快手", "owner_subject": "sub-a", "created_at": "2025-01-01T00:00:00"},
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
