"""Tests for OpsCenter model preset catalog API."""
import json
import os
import sys
import tempfile

import pytest
import pytest_asyncio
import socket

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Override paths for testing
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), "ops_model_presets_test.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), "ops_mp_test_configs")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
# 测试环境关闭启动自动 fetch（避免真实网络请求与测试库被官方列表覆盖）
os.environ["OPS_PRESET_SEED_FETCH_ENABLED"] = "0"

# Import models early so Base.metadata knows about them
import models  # noqa: F401


def _admin_token():
    from datetime import datetime, timedelta, timezone
    from jose import jwt
    from config import settings
    payload = {
        "sub": "admin",
        "username": "admin",
        "role": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)


def _user_token():
    """普通登录用户 token（orchestrator 签发形态：无 role 字段）。"""
    from datetime import datetime, timedelta, timezone
    from jose import jwt
    from config import settings
    payload = {
        "sub": "user-uuid",
        "username": "regular-user",
        "tier": 1,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create fresh test tables and seed catalog."""
    from database import engine, Base, async_session
    from services.model_preset_service import ensure_catalog_seeded

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as db:
        await ensure_catalog_seeded(db)

    yield

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_backfills_missing_rate_per_minute():
    """已存在但 rate_per_minute 为 NULL 的预设行按目录默认值回填（2026-08-13 默认初始值）。"""
    from database import async_session
    from models import ModelPreset
    from sqlalchemy import select
    from services.model_preset_service import ensure_catalog_seeded, PRESET_CATALOG

    async with async_session() as db:
        row = (await db.execute(select(ModelPreset).where(ModelPreset.id == "kling"))).scalar_one()
        assert row.rate_per_minute is not None  # 种子已填
        row.rate_per_minute = None  # 模拟旧目录版本遗留 NULL
        await db.commit()

        await ensure_catalog_seeded(db)

        row2 = (await db.execute(select(ModelPreset).where(ModelPreset.id == "kling"))).scalar_one()
        catalog_rpm = next(i["rate_per_minute"] for i in PRESET_CATALOG if i["id"] == "kling")
        assert row2.rate_per_minute == catalog_rpm


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_keeps_manual_rpm():
    """回填不覆盖运营手工设置过的 rpm（仅补 NULL）。"""
    from database import async_session
    from models import ModelPreset
    from sqlalchemy import select
    from services.model_preset_service import ensure_catalog_seeded

    async with async_session() as db:
        row = (await db.execute(select(ModelPreset).where(ModelPreset.id == "kling"))).scalar_one()
        row.rate_per_minute = 99  # 运营手工值
        await db.commit()

        await ensure_catalog_seeded(db)

        row2 = (await db.execute(select(ModelPreset).where(ModelPreset.id == "kling"))).scalar_one()
        assert row2.rate_per_minute == 99


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_backfills_missing_models_url():
    """已存在但 models_url 为空（旧版本遗留）的预设行按官方清单回填（2026-08-27 新增 Models 端点预置）。"""
    from database import async_session
    from models import ModelPreset
    from sqlalchemy import select
    from services.model_preset_service import ensure_catalog_seeded, OFFICIAL_MODELS_URLS

    async with async_session() as db:
        row = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
        assert row.models_url == OFFICIAL_MODELS_URLS["openai"]  # 种子已预置
        row.models_url = ""  # 模拟旧目录版本遗留空值
        await db.commit()

        await ensure_catalog_seeded(db)

        row2 = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
        assert row2.models_url == OFFICIAL_MODELS_URLS["openai"]


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_keeps_manual_models_url():
    """回填不覆盖运营手工设置过的 models_url（仅补空值）。"""
    from database import async_session
    from models import ModelPreset
    from sqlalchemy import select
    from services.model_preset_service import ensure_catalog_seeded

    async with async_session() as db:
        row = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
        row.models_url = "https://manual.example.com/v1/models"  # 运营手工值
        await db.commit()

        await ensure_catalog_seeded(db)

        row2 = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
        assert row2.models_url == "https://manual.example.com/v1/models"


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_skips_customized_base_url():
    """回填不注入与官方 base_url 不一致的自定义行（防止给内网网关代理行塞官方端点）。"""
    from database import async_session
    from models import ModelPreset
    from sqlalchemy import select
    from services.model_preset_service import ensure_catalog_seeded

    async with async_session() as db:
        row = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
        row.models_url = ""  # 模拟旧版本遗留空值
        row.base_url = "http://10.0.0.8:8080/v1"  # 运营改指向内部网关
        await db.commit()

        await ensure_catalog_seeded(db)

        row2 = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
        assert row2.models_url == ""  # 自定义 base_url 行不得被回填


@pytest.mark.asyncio
async def test_list_presets_requires_authentication():
    """未携带 token 时列表返回 401（未认证）。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/model-presets")
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_presets_allows_regular_user():
    """普通登录用户可读运营目录（默认不含隐藏项）。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_user_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/model-presets", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] > 0
        # 默认不返回隐藏项（种子目录全部可见，这里至少能读）
        assert all(p["is_visible"] for p in data["presets"])


@pytest.mark.asyncio
async def test_include_hidden_requires_admin():
    """普通用户请求 include_hidden=true 返回 403。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    user_headers = {"Authorization": f"Bearer {_user_token()}"}
    admin_headers = {"Authorization": f"Bearer {_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/model-presets?include_hidden=true", headers=user_headers)
        assert resp.status_code == 403

        resp = await client.get("/api/v1/model-presets?include_hidden=true", headers=admin_headers)
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_hidden_preset_hidden_from_regular_user_list():
    """普通用户列表默认不含隐藏项（先隐藏一项再验证过滤）。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    admin_headers = {"Authorization": f"Bearer {_admin_token()}"}
    user_headers = {"Authorization": f"Bearer {_user_token()}"}
    body = {
        "id": "minimax-tts",
        "name": "MiniMax TTS",
        "category": "tts",
        "models": ["speech-2.8-turbo"],
        "is_visible": False,
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.put("/api/v1/model-presets/minimax-tts", json=body, headers=admin_headers)

        resp = await client.get("/api/v1/model-presets", headers=user_headers)
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.json()["presets"]]
        assert "minimax-tts" not in ids

        resp = await client.get("/api/v1/model-presets?include_hidden=true", headers=admin_headers)
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.json()["presets"]]
        assert "minimax-tts" in ids


@pytest.mark.asyncio
async def test_hidden_preset_single_get_blocked_for_regular_user():
    """普通用户按 ID 读取隐藏预设返回 404（与 include_hidden 语义一致）。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    admin_headers = {"Authorization": f"Bearer {_admin_token()}"}
    user_headers = {"Authorization": f"Bearer {_user_token()}"}
    body = {
        "id": "minimax-tts",
        "name": "MiniMax TTS",
        "category": "tts",
        "models": ["speech-2.8-turbo"],
        "is_visible": False,
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.put("/api/v1/model-presets/minimax-tts", json=body, headers=admin_headers)

        resp = await client.get("/api/v1/model-presets/minimax-tts", headers=user_headers)
        assert resp.status_code == 404

        resp = await client.get("/api/v1/model-presets/minimax-tts", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == "minimax-tts"


@pytest.mark.asyncio
async def test_write_operations_require_admin():
    """新增/编辑/删除模型预设必须 admin（普通用户 403）。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    user_headers = {"Authorization": f"Bearer {_user_token()}"}
    body = {
        "id": "user-blocked",
        "name": "User Blocked",
        "category": "llm",
        "models": ["m1"],
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=user_headers)
        assert resp.status_code == 403

        resp = await client.put("/api/v1/model-presets/minimax-tts", json=body, headers=user_headers)
        assert resp.status_code == 403

        resp = await client.delete("/api/v1/model-presets/minimax-tts", headers=user_headers)
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_presets_returns_catalog():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/model-presets", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] > 0
        ids = [p["id"] for p in data["presets"]]
        assert "minimax-multimodal" in ids

        mm = next(p for p in data["presets"] if p["id"] == "minimax-multimodal")
        assert mm["is_multimodal"] is True
        assert set(mm["capabilities"]) == {"llm", "tts", "image", "video"}
        assert mm["capability_models"]["llm"] == "MiniMax-M2.7"
        assert mm["default_model"] == "MiniMax-M2.7"
        assert len(mm["doc_links"]) <= 10

        tts = next(p for p in data["presets"] if p["id"] == "minimax-tts")
        assert tts["default_model"] == "speech-2.8-turbo"


@pytest.mark.asyncio
async def test_update_preset_toggles_visibility_and_links():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "minimax-tts",
        "name": "MiniMax TTS",
        "category": "tts",
        "base_url": "https://api.minimaxi.com/v1",
        "models": ["speech-2.8-turbo"],
        "doc_links": ["https://platform.minimaxi.com/docs/guides/speech-t2a-async"],
        "is_visible": False,
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.put("/api/v1/model-presets/minimax-tts", json=body, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_visible"] is False
        assert data["doc_links"] == ["https://platform.minimaxi.com/docs/guides/speech-t2a-async"]

        hidden = await client.get("/api/v1/model-presets?include_hidden=false", headers=headers)
        assert all(p["id"] != "minimax-tts" for p in hidden.json()["presets"])


@pytest.mark.asyncio
async def test_doc_links_capped_at_10():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "test-cap",
        "name": "Cap Test",
        "category": "llm",
        "models": ["m1"],
        "doc_links": [f"https://example.com/{i}" for i in range(11)],
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_multimodal_capability_requires_model_mapping():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "test-mm",
        "name": "Test MM",
        "category": "multimodal",
        "is_multimodal": True,
        "capabilities": ["llm", "image"],
        "capability_models": {"image": "image-01"},  # llm 缺默认模型
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 400
        assert "缺少默认模型" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_update_delete_roundtrip():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "custom-mm",
        "name": "Custom MM",
        "category": "multimodal",
        "is_multimodal": True,
        "models": ["m1", "m2"],
        "capabilities": ["tts"],
        "capability_models": {"tts": "m1"},
        "capability_doc_links": {"tts": ["https://example.com/tts"]},
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["is_multimodal"] is True

        resp = await client.delete("/api/v1/model-presets/custom-mm", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["deleted"] == "custom-mm"

        resp = await client.get("/api/v1/model-presets/custom-mm", headers=headers)
        assert resp.status_code == 404


# ─────────────────────────────────────────────────────────────
# 新增：运营信息字段（models_url / rate_per_minute / limit_per_5h）
# ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_save_new_info_fields():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "info-test",
        "name": "Info Test",
        "category": "llm",
        "base_url": "https://api.example.com/v1",
        "models_url": "https://api.example.com/v1/models",
        "models": ["m1", "m2"],
        "default_model": "m1",
        "rate_per_minute": 30,
        "limit_per_5h": 1000,
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["models_url"] == "https://api.example.com/v1/models"
        assert data["rate_per_minute"] == 30
        assert data["limit_per_5h"] == 1000

        resp = await client.get("/api/v1/model-presets/info-test", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["base_url"] == "https://api.example.com/v1"


@pytest.mark.asyncio
async def test_new_info_fields_allow_empty():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "empty-fields",
        "name": "Empty Fields",
        "category": "tts",
        "models_url": "",
        "rate_per_minute": None,
        "limit_per_5h": "",
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["models_url"] == ""
        assert data["rate_per_minute"] is None
        assert data["limit_per_5h"] is None


@pytest.mark.asyncio
async def test_invalid_models_url_rejected():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "bad-url", "name": "Bad URL", "category": "llm", "models_url": "ftp://example.com/models"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 400
        assert "models_url" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_invalid_numbers_rejected():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    for field, bad in [("rate_per_minute", -1), ("rate_per_minute", "abc"), ("rate_per_minute", 100001),
                       ("limit_per_5h", -5), ("limit_per_5h", 10000001), ("limit_per_5h", 1.5)]:
        body = {"id": "num-test", "name": "Num Test", "category": "llm", field: bad}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
            assert resp.status_code == 400, f"{field}={bad} should fail"
            assert field in resp.json()["detail"]


@pytest.mark.asyncio
async def test_default_model_must_be_in_models():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "default-mismatch",
        "name": "Default Mismatch",
        "category": "llm",
        "models": ["m1", "m2"],
        "default_model": "not-in-list",
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 400
        assert "默认模型 ID 必须在模型列表中" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_unknown_capability_doc_key_rejected():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "bad-capdoc",
        "name": "Bad Cap Doc",
        "category": "multimodal",
        "is_multimodal": True,
        "capabilities": ["llm"],
        "capability_models": {"llm": "m1"},
        "capability_doc_links": {"hacking": ["https://example.com"]},
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 400
        assert "未知的能力文档键" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_multimodal_seven_doc_keys_allowed():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    caps = ["llm", "image", "video", "tts", "voice_clone", "speech_recognition", "vision"]
    body = {
        "id": "seven-caps",
        "name": "Seven Caps",
        "category": "multimodal",
        "is_multimodal": True,
        "capabilities": caps,
        "capability_models": {c: f"{c}-model" for c in caps},
        "capability_doc_links": {c: [f"https://example.com/{c}"] for c in caps},
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert set(data["capability_doc_links"].keys()) == set(caps)



def _fake_async_client(fake_response):
    """构造支持 async with 的 httpx.AsyncClient fake。"""
    from unittest.mock import AsyncMock
    client = AsyncMock()
    client.get = AsyncMock(return_value=fake_response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client
# ─────────────────────────────────────────────────────────────
# 新增：获取模型ID 端点（fetch-models）
# ─────────────────────────────────────────────────────────────
class _FakeResponse:
    def __init__(self, status_code=200, content=None, json_data=None):
        self.status_code = status_code
        if content is None:
            content = json.dumps(json_data if json_data is not None else []).encode("utf-8")
        self.content = content
        self._json = json_data

    def json(self):
        return self._json


@pytest.mark.asyncio
async def test_fetch_models_requires_models_url():
    import socket
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    # 使用未配置 models_url 的自定义预设
    body = {"id": "fetch-nourl", "name": "Fetch NoURL", "category": "llm", "models": [], "default_model": ""}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/model-presets", json=body, headers=headers)
        resp = await client.post("/api/v1/model-presets/fetch-nourl/fetch-models", headers=headers)
        assert resp.status_code == 400
        assert "models_url" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_fetch_models_requires_admin():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    user_headers = {"Authorization": f"Bearer {_user_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets/openai/fetch-models", headers=user_headers)
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_fetch_models_success_contract():
    import json as _json
    from unittest.mock import AsyncMock, patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "fetch-ok",
        "name": "Fetch OK",
        "category": "llm",
        "models_url": "https://api.example.com/v1/models",
        "models": ["old-a"],
        "default_model": "old-a",
    }
    fake = _FakeResponse(status_code=200, json_data={"data": [{"id": "new-a"}, {"id": "new-b"}, "", 123]})
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]), \
         patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
            assert resp.status_code == 200
            resp2 = await client.post("/api/v1/model-presets/fetch-ok/fetch-models", headers=headers)
            assert resp2.status_code == 200, resp2.text
            data = resp2.json()
            assert data["models"] == ["new-a", "new-b"]
            assert data["count"] == 2
            # default_model 不在新列表 → 清空
            assert data["default_model"] == ""

            # 回写已持久化
            got = await client.get("/api/v1/model-presets/fetch-ok", headers=headers)
            assert got.json()["models"] == ["new-a", "new-b"]


@pytest.mark.asyncio
async def test_fetch_models_non_json_rejected():
    from unittest.mock import AsyncMock, patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "fetch-badjson", "name": "Fetch BadJSON", "category": "llm",
            "models_url": "https://api.example.com/v1/models", "models": ["keep"], "default_model": "keep"}
    fake = _FakeResponse(status_code=200, content=b"<html>not json</html>")
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]), \
         patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-badjson/fetch-models", headers=headers)
            assert resp.status_code == 400
            assert "JSON" in resp.json()["detail"]
            # 失败不修改已有 models
            got = await client.get("/api/v1/model-presets/fetch-badjson", headers=headers)
            assert got.json()["models"] == ["keep"]


@pytest.mark.asyncio
async def test_fetch_models_redirect_rejected():
    from unittest.mock import AsyncMock, patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "fetch-redirect", "name": "Fetch Redirect", "category": "llm",
            "models_url": "https://api.example.com/v1/models", "models": [], "default_model": ""}
    fake = _FakeResponse(status_code=302, content=b"")
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]), \
         patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-redirect/fetch-models", headers=headers)
            assert resp.status_code == 400
            assert "302" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_fetch_models_ssrf_private_ip_rejected():
    import socket
    from unittest.mock import AsyncMock, patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "fetch-ssrf", "name": "Fetch SSRF", "category": "llm",
            "models_url": "https://internal.example.com/v1/models", "models": [], "default_model": ""}
    fake = _FakeResponse(status_code=200, json_data={"models": ["m1"]})
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))]), \
         patch("httpx.AsyncClient", return_value=AsyncMock(get=AsyncMock(return_value=fake))):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-ssrf/fetch-models", headers=headers)
            assert resp.status_code == 400
            assert "私网" in resp.json()["detail"]



@pytest.mark.asyncio
async def test_fetch_models_proxy_benchmark_segment_allowed():
    """198.18.0.0/15（RFC 2544 基准测试段）是 Clash/TUN 类代理接管公网流量的网段；
    公网模型 API 域名在代理环境下会解析到该段，应放行而不是当作私网拒绝。"""
    import socket
    from unittest.mock import patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "fetch-proxybench", "name": "Fetch ProxyBench", "category": "llm",
            "models_url": "https://api.example.com/v1/models", "models": [], "default_model": ""}
    fake = _FakeResponse(status_code=200, json_data={"models": ["m1", "m2"]})
    with patch("services.model_preset_service.settings.allow_proxy_benchmark_ips", True), \
         patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.241", 443))]), \
         patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-proxybench/fetch-models", headers=headers)
            assert resp.status_code == 200, resp.text
            assert resp.json()["models"] == ["m1", "m2"]


@pytest.mark.asyncio
async def test_fetch_models_proxy_benchmark_segment_rejected_when_disabled():
    """开关 OPS_ALLOW_PROXY_BENCHMARK_IPS 默认关闭：198.18.0.0/15 仍按私网拒绝（fail-closed）。"""
    import socket
    from unittest.mock import patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "fetch-proxybench-off", "name": "Fetch ProxyBench Off", "category": "llm",
            "models_url": "https://api.example.com/v1/models", "models": [], "default_model": ""}
    fake = _FakeResponse(status_code=200, json_data={"models": ["m1", "m2"]})
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.241", 443))]), \
         patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-proxybench-off/fetch-models", headers=headers)
            assert resp.status_code == 400
            # 关闭开关时 198.18.0.0/15 仍被拒绝，但提示必须明确为 fake-IP 代理场景（可操作）
            detail = resp.json()["detail"]
            assert "198.18" in detail
            assert "fake-IP" in detail
            assert "OPS_ALLOW_PROXY_BENCHMARK_IPS" in detail


@pytest.mark.asyncio
async def test_fetch_models_benchmark_off_message_distinct_from_real_private():
    """回归保护：198.18.0.0/15（代理基准段，开关关闭）必须给出 fake-IP 指引，
    而真实私网 10.x 必须给出「私网」提示，两者文案必须可区分（Bug #agnes-llm 获取模型误报）。"""
    import socket
    from unittest.mock import patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}

    # 1) 代理基准段（开关默认关闭）
    bench_body = {"id": "fetch-bench-guidance", "name": "Fetch Bench Guidance", "category": "llm",
                  "models_url": "https://api.example.com/v1/models", "models": [], "default_model": ""}
    fake = _FakeResponse(status_code=200, json_data={"models": ["m1", "m2"]})
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.241", 443))]), \
         patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=bench_body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-bench-guidance/fetch-models", headers=headers)
            assert resp.status_code == 400
            bench_detail = resp.json()["detail"]
            assert "fake-IP" in bench_detail and "OPS_ALLOW_PROXY_BENCHMARK_IPS" in bench_detail
            assert "私网" not in bench_detail  # 明确区分：不是真实私网

    # 2) 真实私网 10.x：提示必须含「私网」，且不应出现 fake-IP 代理指引
    priv_body = {"id": "fetch-priv-distinct", "name": "Fetch Priv Distinct", "category": "llm",
                 "models_url": "https://internal.example.com/v1/models", "models": [], "default_model": ""}
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))]), \
         patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=priv_body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-priv-distinct/fetch-models", headers=headers)
            assert resp.status_code == 400
            priv_detail = resp.json()["detail"]
            assert "私网" in priv_detail
            assert "fake-IP" not in priv_detail  # 明确区分：真实私网不应出现代理指引


@pytest.mark.asyncio
async def test_fetch_models_flag_on_still_rejects_real_private():
    """开关开启仅放行 198.18.0.0/15（代理基准段）；真实私网 10.x 仍必须拒绝。"""
    import socket
    from unittest.mock import patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "fetch-flag-on-private", "name": "Fetch FlagOn Private", "category": "llm",
            "models_url": "https://internal.example.com/v1/models", "models": [], "default_model": ""}
    fake = _FakeResponse(status_code=200, json_data={"models": ["m1", "m2"]})
    with (
        patch("services.model_preset_service.settings.allow_proxy_benchmark_ips", True),
        patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))]),
        patch("httpx.AsyncClient", return_value=_fake_async_client(fake)),
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/model-presets", json=body, headers=headers)
            resp = await client.post("/api/v1/model-presets/fetch-flag-on-private/fetch-models", headers=headers)
            assert resp.status_code == 400
            assert "私网" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_url_with_userinfo_rejected():
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {"id": "userinfo-url", "name": "Userinfo URL", "category": "llm",
            "models_url": "https://user:pass@api.example.com/v1/models"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
        assert resp.status_code == 400
        assert "models_url" in resp.json()["detail"]


# ─────────────────────────────────────────────────────────────
# 新增：目录与桌面端代码事实一致性（预设回填防回退）
# ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_catalog_facts_consistency():
    """目录完整性：覆盖全部桌面预设；default ∈ models；rate_per_minute 正整数或空；
    limit_per_5h 无代码事实 → 必须为空；models_url 仅官方清单（OFFICIAL_MODELS_URLS）预置，其余留空（防估算污染）。"""
    from services.model_preset_service import PRESET_CATALOG, OFFICIAL_MODELS_URLS

    assert len(PRESET_CATALOG) >= 50, "预设目录应覆盖桌面端全部预设（>=50）"
    ids = [x["id"] for x in PRESET_CATALOG]
    assert len(ids) == len(set(ids)), "预设 id 必须唯一"
    for item in PRESET_CATALOG:
        assert item.get("name") and item.get("category"), f"{item['id']} 缺少 name/category"
        assert item.get("base_url"), f"{item['id']} base_url 不应为空（本地服务用适配器默认端点）"
        assert item.get("models"), f"{item['id']} models 不应为空"
        dm = item.get("default_model") or ""
        if dm:
            assert dm in item["models"], f"{item['id']} 默认模型不在模型列表"
        rpm = item.get("rate_per_minute")
        assert rpm is None or (isinstance(rpm, int) and rpm >= 1), f"{item['id']} rate_per_minute 非法"
        assert item.get("limit_per_5h") is None, f"{item['id']} limit_per_5h 无代码事实必须为空"
        if item["id"] in OFFICIAL_MODELS_URLS:
            assert item.get("models_url") == OFFICIAL_MODELS_URLS[item["id"]], (
                f"{item['id']} models_url 必须与官方清单 OFFICIAL_MODELS_URLS 一致")
        else:
            assert not item.get("models_url"), f"{item['id']} models_url 无代码事实必须为空"
    # 互斥核对：目录中预置了 models_url 的预设必须与官方清单一一对应
    catalog_prefilled = {x["id"] for x in PRESET_CATALOG if x.get("models_url")}
    assert catalog_prefilled == set(OFFICIAL_MODELS_URLS), "预置 models_url 的预设必须与官方清单一一对应"
    # 与 base_url 的一致性锚定：models_url = base_url 归一 + 显式 path。
    # path 表是对供应商端点契约的显式声明、与 base_url 解耦——base_url 合法变更时只需同步本表，
    # 防止推导式断言把「成对写错的 URL」或「过期 base_url」固化成代码事实。
    OFFICIAL_MODELS_PATHS = {
        "anthropic": "/v1/models",
        "openai": "/models",
        "openai-tts": "/models",
        "dall-e": "/models",
        "whisper": "/models",
        "deepseek": "/models",
        "mimo-llm": "/models",
        "grok-image": "/models",
        "grok-video": "/models",
        "recraft": "/models",
        "opencode-go": "/models",
        "agnes-llm": "/models",
        "agnes-image": "/models",
        "agnes-video": "/models",
        "sensenova-llm": "/models",
        "tianyiyun-coding-plan": "/models",
        "cogvideo": "/models",
        "minimax-tts": "/models",
        "minimax-image": "/models",
        "minimax": "/models",
        "elevenlabs": "/models",
        "gemini": "/v1beta/models",
        "imagen": "/v1beta/models",
        "veo": "/v1beta/models",
        "ollama": "/api/tags",
    }
    catalog_by_id = {x["id"]: x for x in PRESET_CATALOG}
    for pid, path in OFFICIAL_MODELS_PATHS.items():
        base = catalog_by_id[pid]["base_url"].rstrip("/")
        assert OFFICIAL_MODELS_URLS[pid] == base + path, f"{pid} models_url 与 base_url+path 不一致"
    assert set(OFFICIAL_MODELS_PATHS) == set(OFFICIAL_MODELS_URLS), "path 表必须与白名单一一对应"
    # 白名单 URL 安全基线：镜像 fetch 运行时规则（非本机必须 https）+ 无 userinfo + 非私网/本机/保留地址。
    # 注：ipaddress 分支仅拦截字面 IP（白名单目前全是域名，属未来防护）；
    # 域名的真实防护由 fetch 运行时 DNS 解析（_is_private_or_reserved）兜底
    import ipaddress
    from urllib.parse import urlparse

    for pid, url in OFFICIAL_MODELS_URLS.items():
        parsed = urlparse(url)
        assert parsed.scheme in ("http", "https") and parsed.netloc, f"{pid} models_url 必须为 http(s) 地址"
        assert not parsed.username and not parsed.password, f"{pid} models_url 不允许包含 userinfo"
        host = (parsed.hostname or "").lower()
        if host in ("localhost", "127.0.0.1", "::1"):
            assert parsed.scheme == "http", f"{pid} 环回地址应使用 http（镜像 fetch 运行时规则）"
            continue
        assert parsed.scheme == "https", f"{pid} 非本机地址必须使用 https（镜像 fetch 运行时规则）"
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            continue  # 域名：不静态断言，交由 fetch 运行时解析防护
        assert not (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_multicast or ip.is_reserved or ip.is_unspecified), \
            f"{pid} models_url 不得指向私网/本机/保留地址"


@pytest.mark.asyncio
async def test_catalog_minimax_multimodal_facts():
    """MiniMax 多模态能力映射与桌面端一致（代码事实）。"""
    from services.model_preset_service import PRESET_CATALOG

    mm = next(x for x in PRESET_CATALOG if x["id"] == "minimax-multimodal")
    assert mm["base_url"] == "https://api.minimaxi.com/v1"
    assert mm["capabilities"] == ["llm", "tts", "image", "video"]
    assert mm["capability_models"] == {
        "llm": "MiniMax-M2.7", "tts": "speech-2.8-turbo",
        "image": "image-01", "video": "MiniMax-Hailuo-2.3",
    }
    assert mm["default_model"] == "MiniMax-M2.7"
    assert mm["rate_per_minute"] == 20


def test_catalog_agnes_multimodal_facts():
    """Agnes-AI 多模态能力映射与桌面端一致（2026-09-18 同步，中国站统一端点）。"""
    from services.model_preset_service import PRESET_CATALOG

    ag = next(x for x in PRESET_CATALOG if x["id"] == "agnes-multimodal")
    assert ag["name"] == "Agnes-AI"
    assert ag["category"] == "multimodal"
    assert ag["base_url"] == "https://api.agnes-ai.cn/v1"
    assert ag["is_multimodal"] == 1
    assert ag["models"] == ["agnes-3.0-flash", "agnes-image-2.5-flash", "agnes-video-2.5-flash"]
    assert ag["capabilities"] == ["llm", "image", "video"]
    assert ag["capability_models"] == {
        "llm": "agnes-3.0-flash", "image": "agnes-image-2.5-flash", "video": "agnes-video-2.5-flash",
    }
    assert ag["default_model"] == "agnes-3.0-flash"
    assert ag["rate_per_minute"] == 20
    # 与桌面端 model-provider-seeds.js 的能力声明一致（跨端同步锚定；cwd=ops-center/backend）
    seeds_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "desktop", "electron", "services", "model-provider-seeds.js")
    desktop_seeds = open(seeds_path, encoding="utf-8").read()
    assert "agnes-multimodal" in desktop_seeds and "api.agnes-ai.cn/v1" in desktop_seeds, \
        "桌面端预设种子必须包含 agnes-multimodal（跨端同步前提）"

def test_extract_model_ids_supported_shapes():
    """解析器支持 id / model_id / name（Gemini models/ 前缀剥离、Ollama tags、ElevenLabs 真实形状）。"""
    from services.model_preset_service import _extract_model_ids

    assert _extract_model_ids({"models": [{"name": "models/gemini-2.0-flash"}, {"name": "models/gemini-1.5-pro"}]}) == [
        "gemini-2.0-flash", "gemini-1.5-pro"]
    assert _extract_model_ids({"models": [{"name": "llama3:latest"}, {"name": "qwen2:7b"}]}) == ["llama3:latest", "qwen2:7b"]
    # ElevenLabs 真实响应形状：model_id（API 标识）优先于 name（人类显示名）
    assert _extract_model_ids([
        {"model_id": "eleven_multilingual_v2", "name": "Eleven Multilingual v2"},
        {"model_id": "eleven_turbo_v2_5", "name": "Eleven Turbo v2.5"},
    ]) == ["eleven_multilingual_v2", "eleven_turbo_v2_5"]
    assert _extract_model_ids({"data": [{"id": "gpt-4o", "name": "gpt-4o"}, {"id": "o3-mini"}]}) == ["gpt-4o", "o3-mini"]
    assert _extract_model_ids(["a", "b"]) == ["a", "b"]
    assert _extract_model_ids({"models": ["x"]}) == ["x"]
    assert _extract_model_ids({"data": [{"foo": "bar"}, {"id": ""}]}) == []
    # id 为空时回落到 name（Gemini 形态，剥离 models/ 前缀）
    assert _extract_model_ids({"data": [{"id": "", "name": "models/gemini-2.0-flash"}]}) == ["gemini-2.0-flash"]
    # 仅 name 字段剥离 models/ 前缀；id/model_id 以 models/ 开头是真实标识，不得改写
    assert _extract_model_ids({"data": [{"id": "models/gpt-4o"}, {"name": "models/gemini-1.5-pro"}]}) == [
        "models/gpt-4o", "gemini-1.5-pro"]
    # camelCase modelId 兜底
    assert _extract_model_ids({"data": [{"modelId": "client-model-1"}]}) == ["client-model-1"]
@pytest.mark.asyncio
async def test_fetch_models_gemini_name_shape():
    """Gemini 官方 Models 列表（models[].name=models/xxx）经解析器剥离前缀后成功提取。"""
    from unittest.mock import patch
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    body = {
        "id": "fetch-gemini",
        "name": "Fetch Gemini",
        "category": "llm",
        "models_url": "https://generativelanguage.googleapis.com/v1beta/models",
        "models": ["old-a"],
        "default_model": "old-a",
    }
    fake = _FakeResponse(
        status_code=200,
        json_data={"models": [{"name": "models/gemini-2.0-flash"}, {"name": "models/gemini-1.5-pro"}]},
    )
    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.72.14", 443))]),          patch("httpx.AsyncClient", return_value=_fake_async_client(fake)):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/v1/model-presets", json=body, headers=headers)
            assert resp.status_code == 200, resp.text
            resp2 = await client.post("/api/v1/model-presets/fetch-gemini/fetch-models", headers=headers)
            assert resp2.status_code == 200, resp2.text
            data = resp2.json()
            assert data["models"] == ["gemini-2.0-flash", "gemini-1.5-pro"]
            assert data["count"] == 2


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_auto_fetch_populates_static_seed_models():
    """模型列表仍为目录静态种子值（或为空）的官方预设行，启动 seed 时自动从 models_url 拉取回填。"""
    from unittest.mock import AsyncMock, patch
    from sqlalchemy import select
    from database import async_session
    from models import ModelPreset
    from config import settings
    from services.model_preset_service import ensure_catalog_seeded

    fake_fetch = AsyncMock(return_value=(["gpt-5", "gpt-4.1", "o3"], "gpt-5", "https://api.openai.com/v1/models"))
    settings.preset_seed_fetch_enabled = True
    try:
        async with async_session() as db:
            with patch("services.model_preset_service.fetch_models_from_url", fake_fetch):
                await ensure_catalog_seeded(db)
            row = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
            assert json.loads(row.models) == ["gpt-5", "gpt-4.1", "o3"]
            assert row.default_model == "gpt-5"
    finally:
        settings.preset_seed_fetch_enabled = False


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_auto_fetch_skips_customized_models():
    """运营手工修改过模型列表（非目录种子值）的预设行，自动 fetch 不覆盖。"""
    from unittest.mock import AsyncMock, patch
    from sqlalchemy import select
    from database import async_session
    from models import ModelPreset
    from config import settings
    from services.model_preset_service import ensure_catalog_seeded

    fetched = []
    fake_fetch = AsyncMock(side_effect=lambda db, pid: (fetched.append(pid) or (["x"], "", "")))
    settings.preset_seed_fetch_enabled = True
    try:
        async with async_session() as db:
            row = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
            row.models = json.dumps(["custom-model-1"], ensure_ascii=False)
            await db.commit()
            with patch("services.model_preset_service.fetch_models_from_url", fake_fetch):
                await ensure_catalog_seeded(db)
            fresh = (await db.execute(select(ModelPreset).where(ModelPreset.id == "openai"))).scalar_one()
            assert json.loads(fresh.models) == ["custom-model-1"]
            assert "openai" not in fetched
    finally:
        settings.preset_seed_fetch_enabled = False


@pytest.mark.asyncio
async def test_ensure_catalog_seeded_auto_fetch_respects_switch():
    """OPS_PRESET_SEED_FETCH_ENABLED=0 时自动 fetch 整体关闭（测试环境默认）。"""
    from unittest.mock import AsyncMock, patch
    from database import async_session
    from services.model_preset_service import ensure_catalog_seeded
    from config import settings

    fake_fetch = AsyncMock(return_value=(["a"], "a", "url"))
    settings.preset_seed_fetch_enabled = False
    try:
        async with async_session() as db:
            with patch("services.model_preset_service.fetch_models_from_url", fake_fetch):
                await ensure_catalog_seeded(db)
            fake_fetch.assert_not_awaited()
    finally:
        settings.preset_seed_fetch_enabled = False


@pytest.mark.asyncio
async def test_reorder_model_preset_actions_and_validation():
    """reorder：admin-only、action 校验、404、四动作与归一化 0..n-1、边界幂等。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    admin_headers = {"Authorization": f"Bearer {_admin_token()}"}
    user_headers = {"Authorization": f"Bearer {_user_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/model-presets/minimax-tts/reorder", json={"action": "top"}, headers=user_headers)
        assert resp.status_code == 403
        resp = await client.post("/api/v1/model-presets/minimax-tts/reorder", json={"action": "sideways"}, headers=admin_headers)
        assert resp.status_code == 400
        resp = await client.post("/api/v1/model-presets/no-such-preset/reorder", json={"action": "top"}, headers=admin_headers)
        assert resp.status_code == 404

        # 移到首位 → sort_order=0，全列表归一化为连续 0..n-1
        resp = await client.post("/api/v1/model-presets/minimax-tts/reorder", json={"action": "top"}, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["result"] == "changed"
        orders = sorted(p["sort_order"] for p in body["presets"])
        assert orders == list(range(len(body["presets"])))
        assert body["presets"][0]["id"] == "minimax-tts"

        # 下移一位：与原第二位互换
        second_id = body["presets"][1]["id"]
        resp = await client.post("/api/v1/model-presets/minimax-tts/reorder", json={"action": "down"}, headers=admin_headers)
        presets = resp.json()["presets"]
        assert presets[0]["id"] == second_id
        assert presets[1]["id"] == "minimax-tts"

        # 移到末位
        resp = await client.post("/api/v1/model-presets/minimax-tts/reorder", json={"action": "bottom"}, headers=admin_headers)
        assert resp.json()["presets"][-1]["id"] == "minimax-tts"

        # 边界幂等：首位再上移 → result=noop
        first_id = resp.json()["presets"][0]["id"]
        resp = await client.post(f"/api/v1/model-presets/{first_id}/reorder", json={"action": "up"}, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["result"] == "noop"
        assert resp.json()["presets"][0]["id"] == first_id


@pytest.mark.asyncio
async def test_catalog_items_include_sort_order(monkeypatch):
    """catalog 契约：每个目录项携带 sort_order（int 或 null），桌面端据此排【全部】列表。"""
    from httpx import AsyncClient, ASGITransport
    from main import app
    from config import settings

    monkeypatch.setattr(settings, "catalog_api_key", "catalog-test-key")
    transport = ASGITransport(app=app)
    headers = {"X-Catalog-Key": "catalog-test-key"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/model-presets/catalog", headers=headers)
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert items
        assert all("sort_order" in it for it in items)
        assert all(it["sort_order"] is None or (isinstance(it["sort_order"], int) and it["sort_order"] >= 0) for it in items)

@pytest.mark.asyncio
async def test_reorder_scoped_to_visible_ids_preserves_out_of_scope_positions():
    """visible_ids 作用域：只在当前可见序列内移动，序列外的行（含隐藏/其它类别）相对位置必须不变。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    admin_headers = {"Authorization": f"Bearer {_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        full = (await client.get("/api/v1/model-presets?include_hidden=true", headers=admin_headers)).json()["presets"]
        assert len(full) >= 5
        ids_all = [p["id"] for p in full]
        # 可见序列取不连续的 [0,2,3]，把绝对第 1 行 ids_all[1] 排除在外作为「不动锚点」
        vis = [ids_all[0], ids_all[2], ids_all[3]]
        resp = await client.post(
            f"/api/v1/model-presets/{ids_all[3]}/reorder",
            json={"action": "top", "visible_ids": vis},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["result"] == "changed"
        new_ids = [p["id"] for p in body["presets"]]
        # 作用域外行 ids_all[1] 保持绝对槽位（index 1）不变 —— 旧全量实现会把它挤到 index 2
        assert new_ids[1] == ids_all[1]
        # 可见三项在其占据的槽位 {0,2,3} 内重排：ids_all[3] 升到槽 0，另两项各后移一槽
        assert new_ids[0] == ids_all[3]
        assert new_ids[2] == ids_all[0]
        assert new_ids[3] == ids_all[2]
        assert new_ids[4:] == ids_all[4:]
        assert sorted(p["sort_order"] for p in body["presets"]) == list(range(len(body["presets"])))


@pytest.mark.asyncio
async def test_reorder_visible_ids_boundary_is_noop():
    """可见序列内的边界幂等：可见首行再上移 → noop，不写库。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    admin_headers = {"Authorization": f"Bearer {_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        full = (await client.get("/api/v1/model-presets?include_hidden=true", headers=admin_headers)).json()["presets"]
        assert len(full) >= 3
        vis = [p["id"] for p in full[:3]]
        resp = await client.post(
            f"/api/v1/model-presets/{vis[0]}/reorder",
            json={"action": "up", "visible_ids": vis},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["result"] == "noop"


@pytest.mark.asyncio
async def test_reorder_visible_ids_target_out_of_scope_returns_404():
    """目标 id 不在 visible_ids 内 → 404（所见非所得一律拒绝，避免错位写入）。"""
    from httpx import AsyncClient, ASGITransport
    from main import app

    transport = ASGITransport(app=app)
    admin_headers = {"Authorization": f"Bearer {_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        full = (await client.get("/api/v1/model-presets?include_hidden=true", headers=admin_headers)).json()["presets"]
        assert len(full) >= 4
        ids_all = [p["id"] for p in full]
        vis = ids_all[:2]
        resp = await client.post(
            f"/api/v1/model-presets/{ids_all[3]}/reorder",
            json={"action": "top", "visible_ids": vis},
            headers=admin_headers,
        )
        assert resp.status_code == 404

