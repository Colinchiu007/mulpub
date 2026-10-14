"""E2E API Tests -- FastAPI backend integration tests."""

import os
from pathlib import Path

from fastapi.testclient import TestClient

import server
from server import app

client = TestClient(app)


class TestRuntime:
    def test_server_uses_configured_log_directory(self):
        assert server.LOG_DIR == Path(os.environ["MULTI_PUBLISH_LOG_DIR"])


class TestHealth:
    def test_health_returns_ok(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"

    def test_health_reports_own_pid(self):
        # 桌面端用该字段做端口归属校验：端口「有响应」不等于「响应者是它刚
        # spawn 的子进程」。2026-10-14 事故中孤儿后端占用端口并正常应答，
        # 被误判为「本次启动就绪」⇒ restartCount 清零 ⇒ 熔断失效 ⇒ 16.5 小时
        # 2645 次无效重启。缺该字段会让桌面端降级为不校验，等于把事故入口留着。
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["pid"] == os.getpid()


class TestPlatforms:
    def test_list_platforms(self):
        resp = client.get("/api/platforms")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        platforms = body["data"]
        assert isinstance(platforms, list)
        assert len(platforms) > 0

    def test_platform_fields(self):
        resp = client.get("/api/platforms")
        platforms = resp.json()["data"]
        for p in platforms:
            assert "key" in p
            assert "name" in p

    def test_major_platforms_present(self):
        resp = client.get("/api/platforms")
        names = [p["key"] for p in resp.json()["data"]]
        major_keys = ['wechat_mp', 'zhihu', 'weibo', 'douyin', 'xiaohongshu']
        for expected in major_keys:
            assert expected in names


class TestPipelines:
    def test_list_pipelines(self):
        resp = client.get("/api/pipelines")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        pipelines = body["data"]
        assert isinstance(pipelines, list)
        assert len(pipelines) > 0

    def test_pipeline_has_fields(self):
        resp = client.get("/api/pipelines")
        pipelines = resp.json()["data"]
        for p in pipelines:
            assert "name" in p
            assert "description" in p


class TestAccounts:
    def test_list_empty(self):
        resp = client.get("/api/accounts")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)

    def test_create_missing_fields(self):
        resp = client.post("/api/accounts", json={})
        assert resp.status_code == 422

    def test_create_invalid_platform(self):
        resp = client.post("/api/accounts", json={"platform": "nonexistent", "name": "test"})
        assert resp.status_code in (400, 422)

    def test_create_rejects_credential_payload(self, tmp_path, monkeypatch):
        monkeypatch.setattr(server, "ACCOUNTS_FILE", tmp_path / "accounts.json")
        resp = client.post(
            "/api/accounts",
            json={
                "platform": "douyin",
                "name": "test",
                "cookies": [{"name": "sid", "value": "secret"}],
                "auth_data": {"cookies": [{"name": "sid", "value": "secret"}]},
            },
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "ACCOUNT_METADATA_ONLY"
        assert not (tmp_path / "accounts.json").exists()

    def test_create_rejects_empty_legacy_credential_fields(self, tmp_path, monkeypatch):
        monkeypatch.setattr(server, "ACCOUNTS_FILE", tmp_path / "accounts.json")
        resp = client.post(
            "/api/accounts",
            json={
                "platform": "douyin",
                "name": "test",
                "cookies": [],
                "auth_data": None,
            },
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "ACCOUNT_METADATA_ONLY"
        assert not (tmp_path / "accounts.json").exists()

    def test_metadata_account_does_not_persist_secret_fields(self, tmp_path, monkeypatch):
        accounts_file = tmp_path / "accounts.json"
        monkeypatch.setattr(server, "ACCOUNTS_FILE", accounts_file)
        resp = client.post("/api/accounts", json={"platform": "douyin", "name": "test"})
        assert resp.status_code == 200
        stored = accounts_file.read_text(encoding="utf-8")
        assert "cookies" not in stored
        assert "auth_data" not in stored

    def test_cookie_endpoints_are_disabled(self, monkeypatch):
        monkeypatch.setattr(server, "_load_accounts", lambda: {"account-1": {"id": "account-1", "platform": "douyin"}})
        get_response = client.get("/api/accounts/account-1/cookies")
        put_response = client.put(
            "/api/accounts/account-1/cookies",
            json={"cookies": "malformed-but-disabled"},
        )
        assert get_response.status_code == 410
        assert get_response.json()["detail"] == "CREDENTIAL_ENDPOINT_DISABLED"
        assert put_response.status_code == 410
        assert put_response.json()["detail"] == "CREDENTIAL_ENDPOINT_DISABLED"

    def test_legacy_python_login_endpoint_is_disabled(self, monkeypatch):
        called = False

        def mark_called(_platform):
            nonlocal called
            called = True
            return True

        monkeypatch.setattr(server.publisher_mgr, "is_supported", mark_called)
        resp = client.post("/api/login", json={"platform": "douyin"})
        assert resp.status_code == 410
        assert resp.json()["detail"] == "LEGACY_LOGIN_ENDPOINT_DISABLED"
        assert called is False


class TestErrors:
    def test_404_unknown_route(self):
        resp = client.get("/api/nonexistent")
        assert resp.status_code == 404

    def test_account_not_found(self):
        resp = client.get("/api/accounts/nonexistent-id")
        assert resp.status_code in (404, 500)
