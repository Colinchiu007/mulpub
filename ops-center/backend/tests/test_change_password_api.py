"""更改密码（POST /api/auth/change-password）契约测试。

背景（第一性原因）：`services/auth_service.ensure_admin_seeded` 只在 `admins` 表为空时
写入，**从不更新已有行**（auth_service.py:74-76：`existing is not None: return`）。
PRD §6.4 与 OPERATIONS.md §11.3 都写明「改 `.env` 口令不会同步进库，要么用『修改密码』
流程，要么清空 admins 后重启重新 seed」——但**该流程此前并不存在**，文档指向的是一条
断掉的链路。本文件即补上这条流程并锁死其安全契约。

锁死的安全契约：
  1) 必须验证原密码（防离开工位被改密接管）；
  2) 新密码须过弱口令表与长度门槛（与启动期同一判据，不写第二套规则）；
  3) 新密码不得等于原密码（否则「改密」不产生任何安全收益）；
  4) 写操作走 Cookie 会话必须带 X-Ops-Session（CSRF 第二层），缺失 403；
  5) 改密成功后**旧会话立即失效**（强制重新登录）——本用例按用户决策；
  6) 改密失败不得改动库中哈希（事务一致性）；
  7) 改密有自己的限流，防在线爆破原密码。
"""
import os
import re
import sys
import tempfile

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("OPS_DB_PATH", os.path.join(tempfile.gettempdir(), "ops_change_pwd_test.db"))
os.environ.setdefault("OPS_CONFIG_OUTPUT_DIR", os.path.join(tempfile.gettempdir(), "ops_change_pwd_configs"))
os.environ.setdefault("OPS_SECRET_KEY", "test-secret")
os.environ.setdefault("OPS_JWT_SECRET", "change-pwd-test-jwt-secret-min-16")

import models  # noqa: F401,E402
from config import settings  # noqa: E402

CSRF_HEADER = "X-Ops-Session"
OLD_PWD = "admin123"
NEW_PWD = "N3w-S3cure-Passphrase!"


@pytest_asyncio.fixture(autouse=True)
async def setup_db(monkeypatch):
    from database import Base, async_session, engine
    from services import auth_service as _auth_svc
    from services.auth_service import ensure_admin_seeded

    _auth_svc._login_attempts.clear()
    if hasattr(_auth_svc, "_change_pwd_attempts"):
        _auth_svc._change_pwd_attempts.clear()
    monkeypatch.setattr(settings, "session_cookie_secure", False)
    monkeypatch.setattr(settings, "admin_username", "admin")
    monkeypatch.setattr(settings, "admin_password", OLD_PWD)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_admin_seeded(db)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import ASGITransport, AsyncClient

    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _login(client, password=OLD_PWD):
    return await client.post("/api/auth/login", json={"username": "admin", "password": password})


def _payload(old=OLD_PWD, new=NEW_PWD, confirm=None):
    return {"old_password": old, "new_password": new, "confirm_password": confirm if confirm is not None else new}


# ── 正常路径 ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_change_password_success_then_old_fails_and_new_works():
    """改密成功 → 旧密码登录失败、新密码登录成功（哈希真实落库）。"""
    async with _client() as client:
        assert (await _login(client)).status_code == 200
        res = await client.post("/api/auth/change-password", json=_payload(), headers={CSRF_HEADER: "1"})
        assert res.status_code == 200, res.text

        # 旧密码立即失效
        old_login = await _login(client, OLD_PWD)
        assert old_login.status_code == 401
        # 新密码可用
        new_login = await _login(client, NEW_PWD)
        assert new_login.status_code == 200, new_login.text


@pytest.mark.asyncio
async def test_change_password_invalidates_current_session():
    """改密成功后当前会话立即失效（强制重新登录）—— 旧凭据不得在 TTL 内继续可用。"""
    async with _client() as client:
        await _login(client)
        assert (await client.get("/api/auth/me")).status_code == 200

        res = await client.post("/api/auth/change-password", json=_payload(), headers={CSRF_HEADER: "1"})
        assert res.status_code == 200, res.text

        # 旧 Cookie 被服务端作废：要么被清除，要么服务端不再认
        me = await client.get("/api/auth/me")
        assert me.status_code == 401, f"改密后旧会话仍可用：{me.text}"


@pytest.mark.asyncio
async def test_change_password_rotates_hash_with_salt():
    """新哈希必须换盐：同口令两次哈希不同，且格式仍是 pbkdf2_sha256$200000$..."""
    from database import async_session
    from models import AdminUser
    from services.auth_service import verify_password
    from sqlalchemy import select

    async def _stored_hash():
        async with async_session() as db:
            row = (await db.execute(select(AdminUser).where(AdminUser.username == "admin"))).scalar_one_or_none()
            return row.password_hash if row else None

    before = await _stored_hash()
    async with _client() as client:
        await _login(client)
        assert (await client.post(
            "/api/auth/change-password", json=_payload(), headers={CSRF_HEADER: "1"}
        )).status_code == 200

    after = await _stored_hash()
    assert before != after, "哈希未变化"
    assert after.startswith("pbkdf2_sha256$200000$")
    assert verify_password(NEW_PWD, after) is True
    assert verify_password(OLD_PWD, after) is False


# ── 异常路径：凭据与鉴权 ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_change_password_rejects_wrong_old_password():
    async with _client() as client:
        await _login(client)
        res = await client.post(
            "/api/auth/change-password", json=_payload(old="not-the-old"), headers={CSRF_HEADER: "1"}
        )
        assert res.status_code == 401, res.text
        assert "原密码" in res.json()["detail"]


@pytest.mark.asyncio
async def test_change_password_requires_auth():
    """未登录直接改密 → 401（不得 403，与既有统一契约一致）。"""
    async with _client() as client:
        res = await client.post("/api/auth/change-password", json=_payload(), headers={CSRF_HEADER: "1"})
        assert res.status_code == 401


@pytest.mark.asyncio
async def test_change_password_requires_csrf_header():
    """走 Cookie 会话的写操作缺 X-Ops-Session → 403。"""
    async with _client() as client:
        await _login(client)
        res = await client.post("/api/auth/change-password", json=_payload())
        assert res.status_code == 403, res.text
        assert CSRF_HEADER in res.json()["detail"]


@pytest.mark.asyncio
async def test_change_password_bearer_channel_needs_no_csrf():
    """Bearer 通道（桌面端/脚本）不受 CSRF 头约束，与既有双通道语义一致。"""
    from services.auth_service import create_access_token

    token = create_access_token("admin")
    async with _client() as client:
        res = await client.post(
            "/api/auth/change-password",
            json=_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code not in (401, 403), res.text


# ── 异常路径：新密码校验 ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_change_password_rejects_weak_new_password():
    """弱口令表与改密共用同一判据（config._validate_admin_password），不写第二套。"""
    async with _client() as client:
        await _login(client)
        for weak in ("password", "123456", "admin", "root"):
            res = await client.post(
                "/api/auth/change-password", json=_payload(new=weak), headers={CSRF_HEADER: "1"}
            )
            assert res.status_code == 400, f"弱口令 {weak!r} 未被拒绝：{res.text}"


@pytest.mark.asyncio
async def test_change_password_rejects_too_short():
    async with _client() as client:
        await _login(client)
        res = await client.post(
            "/api/auth/change-password", json=_payload(new="Ab1!xyz"), headers={CSRF_HEADER: "1"}
        )
        assert res.status_code == 400, res.text


@pytest.mark.asyncio
async def test_change_password_rejects_mismatched_confirmation():
    async with _client() as client:
        await _login(client)
        res = await client.post(
            "/api/auth/change-password", json=_payload(confirm="Different-Pass-1!"), headers={CSRF_HEADER: "1"}
        )
        assert res.status_code == 400, res.text
        assert "一致" in res.json()["detail"]


@pytest.mark.asyncio
async def test_change_password_rejects_same_as_old():
    """新密码 = 原密码 → 拒绝（改密不产生安全收益，且多为误操作）。"""
    async with _client() as client:
        await _login(client)
        res = await client.post(
            "/api/auth/change-password", json=_payload(new=OLD_PWD), headers={CSRF_HEADER: "1"}
        )
        assert res.status_code == 400, res.text


@pytest.mark.asyncio
async def test_change_password_rejects_overlong_password():
    """超过 PASSWORD_MAX_LEN(128) → 422（防未认证 PBKDF2 CPU DoS）。"""
    async with _client() as client:
        await _login(client)
        res = await client.post(
            "/api/auth/change-password", json=_payload(new="p" * 500), headers={CSRF_HEADER: "1"}
        )
        assert res.status_code == 422, res.text


@pytest.mark.asyncio
async def test_change_password_rejects_empty_password():
    async with _client() as client:
        await _login(client)
        res = await client.post(
            "/api/auth/change-password", json=_payload(new=""), headers={CSRF_HEADER: "1"}
        )
        assert res.status_code in (400, 422), res.text


# ── 事务一致性与限流 ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_failed_change_password_leaves_hash_untouched():
    """改密失败（新密码不合规）不得改动库中哈希。"""
    from database import async_session
    from models import AdminUser
    from sqlalchemy import select

    async def _hash():
        async with async_session() as db:
            row = (await db.execute(select(AdminUser).where(AdminUser.username == "admin"))).scalar_one_or_none()
            return row.password_hash

    async with _client() as client:
        await _login(client)
        before = await _hash()
        res = await client.post(
            "/api/auth/change-password", json=_payload(new="password"), headers={CSRF_HEADER: "1"}
        )
        assert res.status_code == 400
        assert await _hash() == before, "失败请求改写了哈希"
        # 原密码仍然可用
        assert (await _login(client, OLD_PWD)).status_code == 200


@pytest.mark.asyncio
async def test_change_password_rate_limited(monkeypatch):
    """改密端点独立限流：连续错原密码达阈值 → 429（防在线爆破原密码）。"""
    from services import auth_service as _auth

    monkeypatch.setattr(_auth, "MAX_CHANGE_PWD_FAILURES", 3)
    async with _client() as client:
        await _login(client)
        for _ in range(3):
            res = await client.post(
                "/api/auth/change-password", json=_payload(old="wrong"), headers={CSRF_HEADER: "1"}
            )
            assert res.status_code == 401
        locked = await client.post(
            "/api/auth/change-password", json=_payload(), headers={CSRF_HEADER: "1"}
        )
        assert locked.status_code == 429, locked.text


@pytest.mark.asyncio
async def test_change_password_response_leaks_no_hash():
    async with _client() as client:
        await _login(client)
        res = await client.post("/api/auth/change-password", json=_payload(), headers={CSRF_HEADER: "1"})
        body = res.text
        assert "pbkdf2_sha256" not in body
        assert "$" not in res.json().get("detail", "") if isinstance(res.json(), dict) else True


@pytest.mark.asyncio
async def test_change_password_clears_cookie_on_success():
    """成功响应须下发清 Cookie 指令（Max-Age=0 / expires 置位），前端据此跳登录页。"""
    async with _client() as client:
        await _login(client)
        res = await client.post("/api/auth/change-password", json=_payload(), headers={CSRF_HEADER: "1"})
        assert res.status_code == 200, res.text
        set_cookie = " ".join(res.headers.get_list("set-cookie"))
        assert re.search(r"Max-Age=0", set_cookie) or "expires=Thu, 01 Jan 1970" in set_cookie, set_cookie
