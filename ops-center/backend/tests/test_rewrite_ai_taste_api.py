"""Tests for ops-center 去 AI 味词库管理（ai-taste-ops-center：CRUD/toggle/import/种子/runtime 下发）。"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_rat_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_rat_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session
    from services.rewrite_ai_taste_service import ensure_rewrite_ai_taste_seeded

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_rewrite_ai_taste_seeded(db)
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


def _user_headers():
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {"sub": "op", "username": "op", "role": "operator", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_s1_seed_matches_builtin_engine_map():
    """S1 种子幂等播种且与引擎内置词表对齐（抽 3 条核对 + 总量一致）。"""
    from services.rewrite_ai_taste_service import BUILTIN_AI_TASTE_SEED

    assert len(BUILTIN_AI_TASTE_SEED) >= 100
    by_word = {e["word"]: e for e in BUILTIN_AI_TASTE_SEED}
    assert by_word["综上所述"]["replacement"] == "说到底"
    assert by_word["综上所述"]["severity"] == "S1"
    assert by_word["深入分析"]["replacement"] == "细看"
    assert by_word["In conclusion"]["replacement"] == "Bottom line"
    async with _client() as c:
        r = await c.get("/api/v1/rewrite-ai-taste", headers=_admin_headers())
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= len(BUILTIN_AI_TASTE_SEED)


@pytest.mark.asyncio
async def test_s2_crud_roundtrip():
    """S2 CRUD 往返。"""
    async with _client() as c:
        r = await c.post("/api/v1/rewrite-ai-taste", headers=_admin_headers(), json={
            "word": "测试套词", "replacement": "测试真词", "severity": "S2", "description": "",
        })
        assert r.status_code == 200, r.text
        assert r.json()["word"] == "测试套词"
        r = await c.put("/api/v1/rewrite-ai-taste/%E6%B5%8B%E8%AF%95%E5%A5%97%E8%AF%8D", headers=_admin_headers(), json={
            "replacement": "测试改词",
        })
        assert r.status_code == 200, r.text
        assert r.json()["replacement"] == "测试改词"
        r = await c.delete("/api/v1/rewrite-ai-taste/%E6%B5%8B%E8%AF%95%E5%A5%97%E8%AF%8D", headers=_admin_headers())
        assert r.status_code == 200
        r = await c.get("/api/v1/rewrite-ai-taste", headers=_admin_headers())
        assert all(x["word"] != "测试套词" for x in r.json()["items"])


@pytest.mark.asyncio
async def test_s3_duplicate_word_409():
    """S3 重复 word 409。"""
    async with _client() as c:
        body = {"word": "重复词甲", "replacement": "替换甲", "severity": "S2"}
        r = await c.post("/api/v1/rewrite-ai-taste", headers=_admin_headers(), json=body)
        assert r.status_code == 200
        r = await c.post("/api/v1/rewrite-ai-taste", headers=_admin_headers(), json=body)
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_s4_toggle():
    """S4 toggle 启停（Q7 禁用语义）。"""
    from urllib.parse import quote
    async with _client() as c:
        await c.post("/api/v1/rewrite-ai-taste", headers=_admin_headers(), json={
            "word": "启停词", "replacement": "启停替", "severity": "S2",
        })
        r = await c.post(f"/api/v1/rewrite-ai-taste/{quote('启停词')}/toggle", headers=_admin_headers())
        assert r.status_code == 200
        assert r.json()["enabled"] == 0
        r = await c.post(f"/api/v1/rewrite-ai-taste/{quote('启停词')}/toggle", headers=_admin_headers())
        assert r.json()["enabled"] == 1


@pytest.mark.asyncio
async def test_s5_validation_reject_table():
    """S5 校验拒绝表（Q8 判据逐条）。"""
    bad_bodies = [
        {"word": "换行\n词", "replacement": "x", "severity": "S2"},
        {"word": ".", "replacement": "x", "severity": "S2"},
        {"word": "^", "replacement": "x", "severity": "S2"},
        {"word": "好词", "replacement": "", "severity": "S2"},
        {"word": "好词", "replacement": "x", "severity": "S4"},
        {"word": "好" * 31, "replacement": "x", "severity": "S2"},
        {"word": "好词", "replacement": "长" * 51, "severity": "S2"},
        {"word": "控词\x01", "replacement": "x", "severity": "S2"},
        {"word": "", "replacement": "x", "severity": "S2"},
    ]
    async with _client() as c:
        for i, body in enumerate(bad_bodies):
            r = await c.post("/api/v1/rewrite-ai-taste", headers=_admin_headers(), json=body)
            assert r.status_code == 400, f"case {i} should 400: {body}"


@pytest.mark.asyncio
async def test_s6_import_atomic():
    """S6 import 原子性（部分非法整批拒绝）。"""
    async with _client() as c:
        entries = [
            {"word": "批量词一", "replacement": "批一", "severity": "S2"},
            {"word": "批量词二", "replacement": "批二", "severity": "S2"},
            {"word": "坏词\n", "replacement": "x", "severity": "S2"},
        ]
        r = await c.post("/api/v1/rewrite-ai-taste/import", headers=_admin_headers(), json={"entries": entries})
        assert r.status_code == 400
        r = await c.get("/api/v1/rewrite-ai-taste", headers=_admin_headers())
        words = [x["word"] for x in r.json()["items"]]
        assert "批量词一" not in words and "批量词二" not in words
        ok_entries = [{"word": f"批量词{n}", "replacement": f"批{n}", "severity": "S2"} for n in range(20)]
        r = await c.post("/api/v1/rewrite-ai-taste/import", headers=_admin_headers(), json={"entries": ok_entries})
        assert r.status_code == 200
        assert r.json()["imported"] == 20


@pytest.mark.asyncio
async def test_s7_runtime_includes_disabled():
    """S7 runtime 下发含 enabled=0 条目（桌面端需要知道哪些内置词被禁用）。"""
    from urllib.parse import quote
    async with _client() as c:
        r = await c.get("/api/v1/rewrite-ai-taste", headers=_admin_headers())
        first = r.json()["items"][0]["word"]
        await c.post(f"/api/v1/rewrite-ai-taste/{quote(first)}/toggle", headers=_admin_headers())
        r = await c.get("/api/v1/rewrite-ai-taste/runtime", headers=_user_headers())
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x["word"] == first and x["enabled"] == 0 for x in items)


@pytest.mark.asyncio
async def test_s8_auth_matrix():
    """S8 鉴权矩阵（未登录 401；非 admin 403；runtime 现已需登录）。

    `runtime` 原先在本矩阵里被断言为「免鉴权（200）」，2026-10-16 起改为与同资源列表端点
    一致的 `get_current_user`（change: harden-runtime-endpoints-auth）。此处保留它在本矩阵中，
    正是为了把这次的**语义反转**留在原处可见，而不是让旧断言悄悄消失。
    完整契约（含伪造令牌、非 admin 放行、白名单反向断言）见
    `tests/test_runtime_endpoints_require_auth.py`。
    """
    async with _client() as c:
        r = await c.get("/api/v1/rewrite-ai-taste")
        assert r.status_code == 401
        r = await c.post("/api/v1/rewrite-ai-taste", headers=_user_headers(), json={
            "word": "越权词", "replacement": "x", "severity": "S2",
        })
        assert r.status_code == 403
        # runtime：未登录 401，登录后 200（曾经是「免鉴权 ⇒ 恒 200」）
        r = await c.get("/api/v1/rewrite-ai-taste/runtime")
        assert r.status_code == 401
        r = await c.get("/api/v1/rewrite-ai-taste/runtime", headers=_user_headers())
        assert r.status_code == 200
