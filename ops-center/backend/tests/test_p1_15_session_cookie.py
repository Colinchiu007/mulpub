"""P1-15（体检报告问题 15）：管理后台会话从 localStorage JWT 迁移到 HttpOnly Cookie。

原缺陷：`POST /api/auth/login` 把 HS256 JWT 直接放在响应体里，前端存 localStorage
（`stores/auth.js`），任何 XSS 都能把 token 外带 → 直接接管管理员会话；与 CORS 配置
叠加后放大成账号接管面。

本文件是 TDD 红→绿双验证的合同测试，锁死以下交付判据：
 1) 登录响应体不再包含 token / access_token；
 2) 会话凭据落在 Set-Cookie：HttpOnly + SameSite=lax + Path=/ + Max-Age=会话 TTL；
 3) 受保护端点可用 Cookie 会话访问；无凭据 401；
 4) 写操作走 Cookie 时必须带自定义头 X-Ops-Session（CSRF 第二层），缺失 403；
 5) 读操作（GET）不要求自定义头（SameSite=Lax 已阻止跨站子请求携带 Cookie）；
 6) Bearer 通道（桌面端/机器对机器）继续可用，且不受 CSRF 头约束；
 7) 登出清除 Cookie（Max-Age=0 / expires 置位）；
 8) 生产默认 Secure=True、可显式覆盖（反向代理 TLS 终结场景）；
 9) 后端响应带 CSP（default-src 'self' 起步 + frame-ancestors 'none'）等安全头。
"""
import os
import re
import sys
import tempfile

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("OPS_DB_PATH", os.path.join(tempfile.gettempdir(), "ops_p115_test.db"))
os.environ.setdefault("OPS_CONFIG_OUTPUT_DIR", os.path.join(tempfile.gettempdir(), "ops_p115_configs"))
os.environ.setdefault("OPS_SECRET_KEY", "test-secret")
os.environ.setdefault("OPS_JWT_SECRET", "p115-test-jwt-secret-min-16-chars")

import models  # noqa: F401,E402  (注册 ORM 元数据)
from config import settings  # noqa: E402

CSRF_HEADER = "X-Ops-Session"
COOKIE_TTL_SECONDS = 8 * 3600


@pytest_asyncio.fixture(autouse=True)
async def setup_db(monkeypatch):
    from database import Base, async_session, engine
    from services import auth_service as _auth_svc
    from services.auth_service import ensure_admin_seeded
    from services.config_seed_service import ensure_projects_seeded

    _auth_svc._login_attempts.clear()
    # httpx 的 cookie jar 不会在 http:// 上回传 Secure cookie，测试固定关闭 Secure，
    # Secure 语义由 test_session_cookie_secure_default 单独断言。
    monkeypatch.setattr(settings, "session_cookie_secure", False)
    monkeypatch.setattr(settings, "admin_username", "admin")
    monkeypatch.setattr(settings, "admin_password", "admin123")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_admin_seeded(db)
        # 写操作契约用例落在 config 表（FK -> projects.code），需先预置项目目录
        await ensure_projects_seeded(db)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import ASGITransport, AsyncClient

    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _login(client):
    return await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})


@pytest.mark.asyncio
async def test_login_body_has_no_token_and_sets_httponly_cookie():
    async with _client() as client:
        res = await _login(client)
        assert res.status_code == 200, res.text
        body = res.json()
        assert "token" not in body and "access_token" not in body, "JWT 不得再出现在响应体（XSS 外带面）"
        assert body["username"] == "admin" and body["role"] == "admin"
        assert body["expires_in"] == COOKIE_TTL_SECONDS

        raw = res.headers.get_list("set-cookie")
        cookie = next((c for c in raw if c.startswith(f"{settings.session_cookie_name}=")), None)
        assert cookie, f"未签发会话 Cookie：{raw}"
        assert "HttpOnly" in cookie
        assert re.search(r"SameSite=Lax", cookie, re.I)
        assert re.search(r"Path=/", cookie)
        assert re.search(rf"Max-Age={COOKIE_TTL_SECONDS}", cookie)
        assert "Secure" not in cookie  # 本用例显式关闭（见 fixture 注释）


@pytest.mark.asyncio
async def test_protected_endpoint_accepts_cookie_session():
    async with _client() as client:
        assert (await _login(client)).status_code == 200
        me = await client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["username"] == "admin"


@pytest.mark.asyncio
async def test_protected_endpoint_without_credentials_is_401():
    async with _client() as client:
        res = await client.get("/api/auth/me")
        assert res.status_code == 401
        assert "未提供认证令牌" in res.json()["detail"]


@pytest.mark.asyncio
async def test_write_with_cookie_requires_csrf_header():
    write_url = "/api/v1/config/platform-orchestrator/app/p115.csrf"
    body = {"value": "1"}
    async with _client() as client:
        await _login(client)
        # 读放行
        assert (await client.get("/api/auth/me")).status_code == 200
        # 写缺少自定义头 → 403（跨站表单/脚本无法设置自定义头，故可判定非本站发起）
        res = await client.put(write_url, json=body)
        assert res.status_code == 403, res.text
        assert CSRF_HEADER in res.json()["detail"]
        # 带自定义头 → 已过 CSRF 关卡（业务层可能 404/422，但不得再是 401/403）
        ok = await client.put(write_url, json=body, headers={CSRF_HEADER: "1"})
        assert ok.status_code not in (401, 403), ok.text


@pytest.mark.asyncio
async def test_bearer_channel_still_works_without_csrf_header():
    """桌面端 / 脚本用 Authorization: Bearer（不经浏览器 Cookie）→ 不受 CSRF 头约束。"""
    from services.auth_service import create_access_token

    token = create_access_token("admin")
    async with _client() as client:
        res = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200, res.text
        write = await client.put(
            "/api/v1/config/platform-orchestrator/app/p115.bearer",
            json={"value": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert write.status_code not in (401, 403), write.text


@pytest.mark.asyncio
async def test_bearer_takes_precedence_over_cookie():
    from jose import jwt
    from services.auth_service import create_access_token

    async with _client() as client:
        await _login(client)
        other = create_access_token("ops-bot")
        res = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {other}"})
        assert res.status_code == 200
        assert res.json()["username"] == "ops-bot"


@pytest.mark.asyncio
async def test_garbage_cookie_is_401_not_500():
    async with _client() as client:
        client.cookies.set(settings.session_cookie_name, "not-a-jwt")
        res = await client.get("/api/auth/me")
        assert res.status_code == 401
        assert "令牌无效" in res.json()["detail"]


@pytest.mark.asyncio
async def test_logout_clears_session_cookie():
    async with _client() as client:
        await _login(client)
        assert client.cookies.get(settings.session_cookie_name)
        res = await client.post("/api/auth/logout")
        assert res.status_code == 200, res.text
        set_cookie = " ".join(res.headers.get_list("set-cookie"))
        assert re.search(r"Max-Age=0", set_cookie) or "expires=Thu, 01 Jan 1970" in set_cookie
        assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_login_rate_limit_still_applies(monkeypatch):
    """会话迁移不得削弱既有登录限速（5 次失败锁 60s）。"""
    async with _client() as client:
        for _ in range(5):
            res = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password"})
            assert res.status_code == 401
        locked = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert locked.status_code == 429


@pytest.mark.asyncio
async def test_session_cookie_secure_default_and_override(monkeypatch):
    """未显式配置时按 ENVIRONMENT 判定 Secure；显式配置优先（反代 TLS 终结可强制开）。"""
    monkeypatch.delattr(settings, "session_cookie_secure", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert settings.is_session_cookie_secure() is True
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert settings.is_session_cookie_secure() is False
    monkeypatch.setattr(settings, "session_cookie_secure", True, raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert settings.is_session_cookie_secure() is True


@pytest.mark.asyncio
async def test_settings_repr_masks_secrets():
    """Settings 的 repr 会出现在校验异常消息与启动日志里（本次改造中已实际观察到），
    必须脱敏，否则密钥明文进日志/堆栈。"""
    from config import Settings

    probe = Settings(
        _env_file=None,
        jwt_secret="jwt-should-be-masked",
        secret_key="sk-should-be-masked",
        redemption_secret="redemption-should-be-masked",
        encryption_key="fernet-should-be-masked",
        admin_password="pwd-should-be-masked",
        runtime_signing_private_key="PEM-BODY-should-be-masked",
    )
    rendered = repr(probe)
    for leak in (
        "jwt-should-be-masked",
        "sk-should-be-masked",
        "redemption-should-be-masked",
        "fernet-should-be-masked",
        "pwd-should-be-masked",
        "PEM-BODY-should-be-masked",
    ):
        assert leak not in rendered, f"Settings repr 泄露敏感值：{leak}"
    assert "***" in rendered
    # 脱敏不影响功能：真实值仍可读取
    assert probe.get_jwt_secret() == "jwt-should-be-masked"


@pytest.mark.asyncio
async def test_security_headers_on_api_responses():
    async with _client() as client:
        res = await client.get("/health")
        assert res.status_code == 200
        csp = res.headers.get("content-security-policy", "")
        assert "default-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp
        assert "script-src 'self'" in csp
        assert "object-src 'none'" in csp
        assert res.headers.get("x-content-type-options") == "nosniff"
        assert res.headers.get("referrer-policy") == "no-referrer"


@pytest.mark.asyncio
async def test_csp_can_be_disabled_by_config(monkeypatch):
    monkeypatch.setattr(settings, "content_security_policy", "")
    async with _client() as client:
        res = await client.get("/health")
        assert "content-security-policy" not in res.headers
