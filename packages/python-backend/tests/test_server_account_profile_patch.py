"""账号资料（昵称/头像/平台ID/粉丝）PATCH 缺席语义契约测试。

背景（PRD-ACCOUNT-PROFILE-INFO-2026-09-23）：主进程在 DOM 提取失败时曾把未命中字段
算成空串一起 PATCH，后端 `is not None` 判定会把空串当作「显式清空」，于是上一次真实
获取到的昵称/头像被反向覆写。后端语义本身是对的（缺席=不修改、显式值=写入），本文件把
这条契约钉死，作为主进程必须「只下发命中字段」的对端证据。
"""

from fastapi.testclient import TestClient

import server


class StubVerifier:
    def __init__(self, subject: str):
        self.subject = subject

    async def verify(self, _token: str):
        return {"subject": self.subject, "scopes": ["account:manage"]}


def _client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.setattr(server, "IDENTITY_AUTH_ENABLED", True)
    monkeypatch.setattr(server, "IDENTITY_AUTH_REQUIRED", True)
    monkeypatch.setattr(server, "IDENTITY_VERIFIER", StubVerifier("sub-a"))
    monkeypatch.setattr(server, "DATA_DIR", tmp_path)
    monkeypatch.setattr(server, "ACCOUNTS_FILE", tmp_path / "accounts.json")
    return TestClient(server.app)


def _headers() -> dict[str, str]:
    return {"Authorization": "Bearer token-a"}


def _seed(monkeypatch, tmp_path) -> tuple[TestClient, str]:
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/accounts",
        headers=_headers(),
        json={
            "platform": "toutiao",
            "name": "今日头条",
            "account_name": "真昵称",
            "avatar": "https://cdn/real.png",
            "platform_account_id": "uid-1",
            "followers": 1200,
        },
    )
    assert created.status_code == 200
    return client, created.json()["data"]["id"]


def test_absent_profile_fields_must_not_overwrite_existing_values(monkeypatch, tmp_path):
    """只回写登录态时，资料字段缺席必须保持原值（这是主进程「不下发空串」的对端契约）。"""
    client, account_id = _seed(monkeypatch, tmp_path)

    patched = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"status": "expired", "last_validated": "2026-09-23T00:00:00+00:00"},
    )

    assert patched.status_code == 200
    data = patched.json()["data"]
    assert data["account_name"] == "真昵称"
    assert data["avatar"] == "https://cdn/real.png"
    assert data["platform_account_id"] == "uid-1"
    assert data["followers"] == 1200
    assert data["status"] == "expired"


def test_only_hit_profile_fields_are_written(monkeypatch, tmp_path):
    """单独下发头像时不得顺带清空昵称；昵称也不得被 name（显示名）冒充。"""
    client, account_id = _seed(monkeypatch, tmp_path)

    patched = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"avatar": "https://cdn/new.png"},
    )

    assert patched.status_code == 200
    data = patched.json()["data"]
    assert data["avatar"] == "https://cdn/new.png"
    assert data["account_name"] == "真昵称"
    assert data["name"] == "今日头条"


def test_empty_string_is_an_explicit_clear_not_a_noop(monkeypatch, tmp_path):
    """空串在后端是「显式清空」而不是「不修改」——所以提取失败方必须省略键，而不是发空串。"""
    client, account_id = _seed(monkeypatch, tmp_path)

    patched = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"account_name": "", "avatar": ""},
    )

    assert patched.status_code == 200
    data = patched.json()["data"]
    assert data["account_name"] == ""
    assert data["avatar"] == ""
    # 未被下发的字段仍必须保持原值
    assert data["followers"] == 1200
