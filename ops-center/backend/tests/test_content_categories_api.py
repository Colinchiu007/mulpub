"""Tests for ops-center 统一内容类别管理（热门选题/采集库/账号标签 唯一真源）与下发。"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_cc_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_cc_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session
    from services.content_category_service import ensure_content_categories_seeded

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_content_categories_seeded(db)
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


def _normal_headers():
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {"sub": "u1", "username": "u1", "role": "user", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_catalog_seeded_and_list():
    """目录供给：内置 11 类自动补齐，键名与顺序与桌面端 classifier 一致。"""
    async with _client() as client:
        lst = (await client.get("/api/v1/content-categories", headers=_admin_headers())).json()
        keys = [i["category_key"] for i in lst["items"]]
        assert keys[:11] == [
            "general", "society", "finance", "tech", "ai", "entertainment",
            "sports", "emotion", "education", "health", "international",
        ]
        assert all(i["is_preset"] for i in lst["items"][:11])
        assert len(lst["preset_keys"]) == 11


@pytest.mark.asyncio
async def test_create_update_validation():
    async with _client() as client:
        h = _admin_headers()

        # 非法 key
        r = await client.post("/api/v1/content-categories", json={"category_key": "Bad Key", "name": "坏"}, headers=h)
        assert r.status_code == 400

        # 空名称
        r = await client.post("/api/v1/content-categories", json={"category_key": "x1", "name": "  "}, headers=h)
        assert r.status_code == 400

        # 重复 key（内置）
        r = await client.post("/api/v1/content-categories", json={"category_key": "tech", "name": "科技2"}, headers=h)
        assert r.status_code == 400

        # 重复名称（内置）
        r = await client.post("/api/v1/content-categories", json={"category_key": "x2", "name": "科技"}, headers=h)
        assert r.status_code == 400

        # 名称超长
        r = await client.post("/api/v1/content-categories", json={"category_key": "x3", "name": "a" * 21}, headers=h)
        assert r.status_code == 400

        # 正常创建
        r = await client.post("/api/v1/content-categories", json={"category_key": "x4", "name": "自定义类"}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["is_preset"] is False

        # 改名
        r = await client.put("/api/v1/content-categories/x4", json={"name": "改名后"}, headers=h)
        assert r.status_code == 200 and r.json()["name"] == "改名后"

        # 禁用
        r = await client.put("/api/v1/content-categories/x4", json={"enabled": False}, headers=h)
        assert r.status_code == 200 and r.json()["enabled"] is False

        # 排序值非法
        r = await client.put("/api/v1/content-categories/x4", json={"sort_order": -1}, headers=h)
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_preset_cannot_be_deleted_but_custom_can():
    async with _client() as client:
        h = _admin_headers()
        # 内置类不可删除
        r = await client.delete("/api/v1/content-categories/tech", headers=h)
        assert r.status_code == 400 and "内置类别不可删除" in r.text

        # 自定义类可删除
        await client.post("/api/v1/content-categories", json={"category_key": "x9", "name": "待删"}, headers=h)
        r = await client.delete("/api/v1/content-categories/x9", headers=h)
        assert r.status_code == 200 and r.json()["deleted"] == "x9"

        # 不存在的类 → 404
        r = await client.delete("/api/v1/content-categories/nope", headers=h)
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_reorder_persists_and_is_idempotent_at_boundary():
    async with _client() as client:
        h = _admin_headers()
        # 末位 → top
        r = await client.post("/api/v1/content-categories/international/reorder", json={"action": "top"}, headers=h)
        assert r.status_code == 200 and r.json()["result"] == "changed"
        keys = [i["category_key"] for i in r.json()["items"]]
        assert keys[0] == "international"

        # 已在首位 → noop（不写库）
        r = await client.post("/api/v1/content-categories/international/reorder", json={"action": "top"}, headers=h)
        assert r.status_code == 200 and r.json()["result"] == "noop"

        # 归一化快照（非法 action 之前取，400 响应不含 items）
        orders = [i["sort_order"] for i in r.json()["items"]]
        assert orders == list(range(len(orders)))

        # 非法 action
        r = await client.post("/api/v1/content-categories/international/reorder", json={"action": "sideways"}, headers=h)
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_reset_restores_presets_and_keeps_custom():
    async with _client() as client:
        h = _admin_headers()
        await client.post("/api/v1/content-categories", json={"category_key": "keep_me", "name": "保留我"}, headers=h)
        await client.put("/api/v1/content-categories/tech", json={"name": "被改坏的名字", "enabled": False}, headers=h)

        r = await client.post("/api/v1/content-categories/reset", headers=h)
        assert r.status_code == 200
        items = {i["category_key"]: i for i in r.json()["items"]}
        assert items["tech"]["name"] == "科技" and items["tech"]["enabled"] is True
        assert "keep_me" in items


@pytest.mark.asyncio
async def test_write_requires_admin():
    async with _client() as client:
        nh = _normal_headers()
        r = await client.post("/api/v1/content-categories", json={"category_key": "x8", "name": "无权限"}, headers=nh)
        assert r.status_code == 403
        r = await client.delete("/api/v1/content-categories/x8", headers=nh)
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_bootstrap_only_delivers_enabled():
    """下发载荷只含 enabled=1，且被签名覆盖。"""
    async with _client() as client:
        h = _admin_headers()
        await client.put("/api/v1/content-categories/tech", json={"enabled": False}, headers=h)

        from database import async_session
        from services.runtime_service import get_runtime_bootstrap
        async with async_session() as db:
            payload = await get_runtime_bootstrap(db)

        assert "contentCategories" in payload
        keys = [i["category_key"] for i in payload["contentCategories"]["items"]]
        assert "tech" not in keys
        assert "general" in keys


@pytest.mark.asyncio
async def test_provision_backfills_ai_on_legacy_ten_class_db():
    """存量「10 类」库升级时补出 ai，且补行不覆盖运营已改字段（非空旧状态回归）。

    为什么必须有：本文件其余用例都从空库重建（drop_all/create_all），对
    「先有旧状态、再补行」这类缺陷完全免疫。补 ai 时其 CATALOG 下标为 4，会与既有
    entertainment 的 sort_order=4 相撞，实际呈现顺序靠 (sort_order, category_key)
    的字母序 tiebreak（'ai' < 'entertainment'）落在期望位置 —— 该依赖必须被钉住，
    否则将来有人改 enumerate 起点就会静默改序。
    """
    import sqlalchemy as sa

    from database import async_session
    from models import ContentCategory
    from services.content_category_service import CATALOG_KEYS

    # 模拟旧部署：删掉 ai 行，其余 10 行保持 CATALOG 下标（sort_order 0..9）
    async with async_session() as db:
        await db.execute(sa.delete(ContentCategory).where(ContentCategory.category_key == "ai"))
        await db.commit()

    async with _client() as client:
        lst = (await client.get("/api/v1/content-categories", headers=_admin_headers())).json()

    keys = [i["category_key"] for i in lst["items"]]
    items = {i["category_key"]: i for i in lst["items"]}
    # ai 被补回且是内置类
    assert "ai" in items
    assert items["ai"]["is_preset"] is True
    # 未重排的存量库上，呈现顺序应等于 CATALOG 顺序（ai 紧随 tech）
    assert keys[:11] == list(CATALOG_KEYS)
    assert keys.index("ai") == keys.index("tech") + 1


@pytest.mark.asyncio
async def test_provision_never_overwrites_operator_sort_order_or_name():
    """补行「只补不改」：运营改过的 sort_order / name 必须原样保留。"""
    import sqlalchemy as sa

    from database import async_session
    from models import ContentCategory

    async with async_session() as db:
        await db.execute(sa.delete(ContentCategory).where(ContentCategory.category_key == "ai"))
        await db.execute(
            sa.update(ContentCategory)
            .where(ContentCategory.category_key == "entertainment")
            .values(sort_order=2, name="娱乐（运营改名）")
        )
        await db.commit()

    async with _client() as client:
        lst = (await client.get("/api/v1/content-categories", headers=_admin_headers())).json()

    items = {i["category_key"]: i for i in lst["items"]}
    assert "ai" in items
    # 运营已改字段不得被目录默认值覆盖
    assert items["entertainment"]["sort_order"] == 2
    assert items["entertainment"]["name"] == "娱乐（运营改名）"
    # tech 未被牵连，仍是 CATALOG 下标 3
    assert items["tech"]["sort_order"] == 3
