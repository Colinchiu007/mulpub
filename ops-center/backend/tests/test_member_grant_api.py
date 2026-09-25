"""Tests for ops-center 会员权益开通（engine admin grant 转发）。"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_mg_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_mg_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"

import models  # noqa: F401
from config import settings


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base

    settings.engine_admin_base_url = ""
    settings.engine_admin_token = ""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import AsyncClient, ASGITransport
    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _admin_headers():
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {"sub": "admin", "username": "admin", "role": "admin", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


class _FakeResp:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class _FakeClient:
    def __init__(self, resp):
        self.resp = resp
        self.calls = []

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return self.resp

    async def aclose(self):
        pass


@pytest.fixture
def fake_engine(monkeypatch):
    from services import member_grant_service

    holder = {}

    def _install(status_code, body):
        fake = _FakeClient(_FakeResp(status_code, body))
        monkeypatch.setattr(member_grant_service, "_new_client", lambda: fake)
        holder["fake"] = fake
        return fake

    return _install


@pytest.mark.asyncio
async def test_not_configured_503(fake_engine):
    fake_engine(200, {"success": True})
    async with _client() as c:
        r = await c.post("/api/v1/member/grants", json={"userId": "u-1", "plan": "pro", "durationDays": 30}, headers=_admin_headers())
    assert r.status_code == 503
    assert r.json()["detail"] == "ENGINE_ADMIN_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_local_validation_rejects_fake(fake_engine):
    fake_engine(200, {"success": True})
    settings.engine_admin_base_url = "http://engine.test"
    settings.engine_admin_token = "admintok"
    async with _client() as c:
        r1 = await c.post("/api/v1/member/grants", json={"userId": "", "plan": "pro", "durationDays": 30}, headers=_admin_headers())
        r2 = await c.post("/api/v1/member/grants", json={"userId": "u-1", "plan": "free", "durationDays": 30}, headers=_admin_headers())
        r3 = await c.post("/api/v1/member/grants", json={"userId": "u-1", "plan": "pro", "durationDays": 0}, headers=_admin_headers())
        r4 = await c.post("/api/v1/member/grants", json={"userId": "u-1", "plan": "pro", "durationDays": True}, headers=_admin_headers())
    assert [r1.status_code, r1.json()["detail"]] == [400, "USER_ID_REQUIRED"]
    assert [r2.status_code, r2.json()["detail"]] == [400, "PLAN_INVALID"]
    assert [r3.status_code, r3.json()["detail"]] == [400, "DURATION_INVALID"]
    assert r4.status_code == 400


@pytest.mark.asyncio
async def test_grant_forwards_with_bearer(fake_engine):
    fake = fake_engine(200, {"success": True, "plan": "pro", "order": {"channel": "admin_grant"}})
    settings.engine_admin_base_url = "http://engine.test/"
    settings.engine_admin_token = "admintok"
    async with _client() as c:
        r = await c.post("/api/v1/member/grants", json={"userId": " u-1 ", "plan": "pro", "durationDays": 30}, headers=_admin_headers())
    assert r.status_code == 200
    assert r.json()["plan"] == "pro"
    call = fake.calls[0]
    assert call["url"] == "http://engine.test/api/v1/admin/member/grant"
    assert call["headers"]["Authorization"] == "Bearer admintok"
    assert call["json"] == {"userId": "u-1", "plan": "pro", "durationDays": 30, "operator": "admin"}


@pytest.mark.asyncio
async def test_upstream_error_passthrough(fake_engine):
    fake_engine(400, {"error": "PLAN_INVALID"})
    settings.engine_admin_base_url = "http://engine.test"
    settings.engine_admin_token = "admintok"
    async with _client() as c:
        r = await c.post("/api/v1/member/grants", json={"userId": "u-1", "plan": "ghost", "durationDays": 30}, headers=_admin_headers())
    assert r.status_code == 400
    assert r.json()["detail"] == "PLAN_INVALID"


@pytest.mark.asyncio
async def test_requires_admin(fake_engine):
    fake_engine(200, {"success": True})
    settings.engine_admin_base_url = "http://engine.test"
    settings.engine_admin_token = "admintok"
    async with _client() as c:
        r = await c.post("/api/v1/member/grants", json={"userId": "u-1", "plan": "pro", "durationDays": 30})
    assert r.status_code in (401, 403)
