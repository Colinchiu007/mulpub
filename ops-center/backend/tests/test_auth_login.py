"""Tests for ops-center 自包含管理员登录（替代 orchestrator 认证）。"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from jose import jwt

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Override paths for testing
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), "ops_auth_test.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), "ops_auth_test_configs")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"

import models  # noqa: F401
from config import settings


def _make_token(payload_extra=None, exp_delta=None, secret=None):
    payload = {
        "sub": "admin",
        "username": "admin",
        "role": "admin",
        "iat": datetime.now(timezone.utc),
        "exp": exp_delta or (datetime.now(timezone.utc) + timedelta(hours=1)),
    }
    if payload_extra:
        payload.update(payload_extra)
    return jwt.encode(payload, secret or settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)


@pytest_asyncio.fixture(autouse=True)
async def setup_db(monkeypatch):
    from database import engine, Base, async_session
    from services.auth_service import ensure_admin_seeded
    from services import auth_service as _auth_svc

    # 清理跨用例共享的登录失败计数
    _auth_svc._login_attempts.clear()

    # P1-15：httpx 的 cookie jar 在 http://test 上不会回传 Secure cookie，
    # 本文件统一关闭 Secure（Secure 语义由 test_p1_15_session_cookie.py 专测）。
    monkeypatch.setattr(settings, "session_cookie_secure", False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 默认配置管理员 admin/admin123（测试种子）
    monkeypatch.setattr(settings, "admin_username", "admin")
    monkeypatch.setattr(settings, "admin_password", "admin123")
    async with async_session() as db:
        await ensure_admin_seeded(db)

    yield

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import AsyncClient, ASGITransport
    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_login_success_sets_session_cookie_and_me():
    """P1-15 契约变更：登录不再回传 token，凭据只落在 HttpOnly 会话 Cookie 里。

    历史断言 `data["token"]` 锁住的正是本次要消除的缺陷面（token 出库 → 前端存
    localStorage → 任意 XSS 即可外带并接管管理员会话），因此这里改为双重断言：
      - 响应体**不得**含 token / access_token；
      - 会话可用性改由浏览器自动携带的 Cookie 证明（含 CSRF 头名回传）。
    """
    async with _client() as client:
        resp = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["role"] == "admin"
        assert data["username"] == "admin"
        assert "token" not in data and "access_token" not in data, "JWT 不得再出现在响应体"
        assert data["csrf_header"] == settings.csrf_header
        assert data["expires_in"] == settings.get_session_max_age_seconds()

        # /me 受保护可用（凭 Cookie 会话，无需手工拼 Authorization 头）
        me = await client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["username"] == "admin"
        assert me.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_bearer_channel_regression_for_desktop():
    """Bearer 通道回归：桌面端 / 脚本仍可用 Authorization 头，不依赖 Cookie。"""
    from services.auth_service import create_access_token

    token = create_access_token("admin")
    async with _client() as client:
        me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200, me.text
        assert me.json()["username"] == "admin"
        assert me.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_login_wrong_password_and_unknown_user_both_401():
    async with _client() as client:
        r1 = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r1.status_code == 401
        r2 = await client.post("/api/auth/login", json={"username": "nobody", "password": "whatever"})
        assert r2.status_code == 401
        # 文案不区分用户不存在/密码错误
        assert r1.json()["detail"] == r2.json()["detail"]


@pytest.mark.asyncio
async def test_login_fail_closed_when_admin_not_configured(monkeypatch):
    # 清空管理员配置并删除种子 → 503
    from database import async_session
    from models import AdminUser
    from sqlalchemy import delete

    monkeypatch.setattr(settings, "admin_username", "")
    monkeypatch.setattr(settings, "admin_password", "")
    async with async_session() as db:
        await db.execute(delete(AdminUser))
        await db.commit()

    async with _client() as client:
        resp = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert resp.status_code == 503
        assert "OPS_ADMIN_USERNAME" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_rate_limit_after_5_failures(monkeypatch):
    # 提速：把限流阈值临时降到 3 以便快速触发
    from services import auth_service

    monkeypatch.setattr(auth_service, "MAX_LOGIN_FAILURES", 3)
    async with _client() as client:
        for _ in range(3):
            r = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
            assert r.status_code == 401
        # 第 4 次触发锁定 → 429
        r4 = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r4.status_code == 429
        assert "稍后再试" in r4.json()["detail"]
    # 清理计数，避免影响后续用例
    auth_service._login_attempts.clear()


@pytest.mark.asyncio
async def test_invalid_token_401_and_non_admin_403():
    async with _client() as client:
        # 无效 token
        r = await client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"})
        assert r.status_code == 401
        # 非 admin role → 403（require_admin 契约）
        token = _make_token({"role": "user"})
        r2 = await client.get("/api/v1/model-presets?include_hidden=true", headers={"Authorization": f"Bearer {token}"})
        assert r2.status_code == 403


@pytest.mark.asyncio
async def test_expired_token_401():
    token = _make_token(exp_delta=datetime.now(timezone.utc) - timedelta(minutes=1))
    async with _client() as client:
        r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


def test_pbkdf2_hash_roundtrip():
    from services.auth_service import hash_password, verify_password

    stored = hash_password("secret-password")
    assert stored.startswith("pbkdf2_sha256$200000$")
    assert verify_password("secret-password", stored) is True
    assert verify_password("wrong", stored) is False
    assert verify_password("secret-password", "garbage") is False

@pytest.mark.asyncio
async def test_missing_authorization_header_returns_401():
    """缺 Authorization 头 → 401（统一 401 契约，而非 403）。"""
    async with _client() as client:
        r = await client.get("/api/v1/model-presets")
        assert r.status_code == 401
        r2 = await client.get("/api/auth/me")
        assert r2.status_code == 401


@pytest.mark.asyncio
async def test_token_with_wrong_secret_401():
    token = _make_token(secret="different-secret")
    async with _client() as client:
        r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_body_length_limits():
    """超长 username/password 直接拒绝（防未认证 PBKDF2 CPU DoS）。"""
    async with _client() as client:
        long_user = "a" * 200
        r = await client.post("/api/auth/login", json={"username": long_user, "password": "x"})
        assert r.status_code == 422  # Pydantic max_length 拒绝
        long_pwd = "p" * 500
        r2 = await client.post("/api/auth/login", json={"username": "admin", "password": long_pwd})
        assert r2.status_code == 422


@pytest.mark.asyncio
async def test_lock_expires_after_window(monkeypatch):
    from services import auth_service as _auth
    import time as _time

    monkeypatch.setattr(_auth, "MAX_LOGIN_FAILURES", 3)
    monkeypatch.setattr(_auth, "LOGIN_LOCK_SECONDS", 60)
    # 锁定期内错误尝试不延长锁；过期后恢复
    async with _client() as client:
        for _ in range(3):
            await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        r = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 429
        # 锁定期内尝试不延长
        r2 = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r2.status_code == 429
        # 快进锁定期 → 恢复
        monkeypatch.setattr(_auth, "_now_ts", lambda: _time.time() + 120)
        r3 = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r3.status_code == 200, r3.text
    _auth._login_attempts.clear()


@pytest.mark.asyncio
async def test_existing_admin_survives_env_clear(monkeypatch):
    """表中有管理员时，env 清空不影响登录（fail-open 场景：以表为准）。"""
    monkeypatch.setattr(settings, "admin_username", "")
    monkeypatch.setattr(settings, "admin_password", "")
    async with _client() as client:
        r = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200, r.text
