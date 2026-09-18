"""Tests for ops-center 改写硬约束管理（CRUD/唯一默认/种子/运行时下发）。"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_rhc_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_rhc_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session
    from services.rewrite_hard_constraint_service import ensure_rewrite_hard_constraints_seeded

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_rewrite_hard_constraints_seeded(db)
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


@pytest.mark.asyncio
async def test_seed_provides_default():
    async with _client() as c:
        r = await c.get("/api/v1/rewrite-hard-constraints", headers=_admin_headers())
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        defaults = [x for x in items if x["isDefault"]]
        assert len(defaults) == 1
        assert defaults[0]["id"] == "hard-constraint-default-v1"
        assert "只输出改写后的文案本身" in defaults[0]["content"]


@pytest.mark.asyncio
async def test_runtime_returns_default():
    async with _client() as c:
        r = await c.get("/api/v1/rewrite-hard-constraints/runtime")
        assert r.status_code == 200
        item = r.json()["item"]
        assert item is not None
        assert item["content"]


@pytest.mark.asyncio
async def test_create_update_delete():
    headers = _admin_headers()
    async with _client() as c:
        # 创建
        r = await c.post("/api/v1/rewrite-hard-constraints", headers=headers, json={
            "id": "hc-test-1", "title": "测试约束", "content": "规则1", "description": "",
        })
        assert r.status_code == 200, r.text
        assert r.json()["isDefault"] is False
        # 更新
        r = await c.put("/api/v1/rewrite-hard-constraints/hc-test-1", headers=headers, json={
            "title": "测试约束2", "content": "规则2",
        })
        assert r.status_code == 200
        assert r.json()["title"] == "测试约束2"
        # 删除（非默认可删）
        r = await c.delete("/api/v1/rewrite-hard-constraints/hc-test-1", headers=headers)
        assert r.status_code == 200
        assert r.json()["ok"] is True


@pytest.mark.asyncio
async def test_set_default_unique():
    headers = _admin_headers()
    async with _client() as c:
        # 创建第二个版本
        r = await c.post("/api/v1/rewrite-hard-constraints", headers=headers, json={
            "id": "hc-test-2", "title": "版本2", "content": "规则B",
        })
        assert r.status_code == 200
        # 设为默认
        r = await c.post("/api/v1/rewrite-hard-constraints/hc-test-2/set-default", headers=headers)
        assert r.status_code == 200
        assert r.json()["isDefault"] is True
        # 唯一默认：种子版本被取消默认
        r = await c.get("/api/v1/rewrite-hard-constraints", headers=headers)
        items = r.json()["items"]
        defaults = [x for x in items if x["isDefault"]]
        assert len(defaults) == 1
        assert defaults[0]["id"] == "hc-test-2"
        # runtime 现在返回新默认
        r = await c.get("/api/v1/rewrite-hard-constraints/runtime")
        assert r.json()["item"]["content"] == "规则B"


@pytest.mark.asyncio
async def test_delete_default_rejected():
    headers = _admin_headers()
    async with _client() as c:
        r = await c.delete("/api/v1/rewrite-hard-constraints/hard-constraint-default-v1", headers=headers)
        assert r.status_code == 400
        assert "默认" in r.json()["detail"]


@pytest.mark.asyncio
async def test_validation_errors():
    headers = _admin_headers()
    async with _client() as c:
        # 空 title
        r = await c.post("/api/v1/rewrite-hard-constraints", headers=headers, json={
            "id": "hc-bad", "title": "", "content": "x",
        })
        assert r.status_code == 400
        # 非法 id
        r = await c.post("/api/v1/rewrite-hard-constraints", headers=headers, json={
            "id": "BAD ID!", "title": "t", "content": "x",
        })
        assert r.status_code == 400
        # 重复 id
        r = await c.post("/api/v1/rewrite-hard-constraints", headers=headers, json={
            "id": "hard-constraint-default-v1", "title": "t", "content": "x",
        })
        assert r.status_code == 409
